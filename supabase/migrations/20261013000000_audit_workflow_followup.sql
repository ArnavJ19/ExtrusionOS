begin;

create or replace function public.get_profile_stock_consumption_totals(p_reservation_ids uuid[])
returns table(reservation_id uuid, consumed_weight_kg numeric, consumed_length_m numeric, consumed_pieces integer)
language plpgsql security definer set search_path = public, private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_ids uuid[] := coalesce(p_reservation_ids, array[]::uuid[]);
begin
  if auth.uid() is null or v_company is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if v_role is null or v_role not in ('owner','admin','production_manager','production','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied to inspect stock reservation consumption' using errcode = '42501';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'Request no more than 500 reservation ids at a time' using errcode = '22023';
  end if;
  if cardinality(v_ids) <> (select count(distinct requested.id)::integer from unnest(v_ids) requested(id)) then
    raise exception 'Reservation ids must be unique' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) requested(id)
    left join public.profile_stock_reservations reservation
      on reservation.id = requested.id and reservation.company_id = v_company
    where reservation.id is null
  ) then
    raise exception 'Reservation not found for current company' using errcode = '42501';
  end if;
  return query
    select requested.id, coalesce(sum(consumption.consumed_weight_kg),0),
      coalesce(sum(consumption.consumed_length_m),0), coalesce(sum(consumption.consumed_pieces),0)::integer
    from unnest(v_ids) requested(id)
    left join public.profile_stock_consumptions consumption
      on consumption.reservation_id = requested.id and consumption.company_id = v_company
    group by requested.id;
end;
$$;
revoke all on function public.get_profile_stock_consumption_totals(uuid[]) from public, anon;
grant execute on function public.get_profile_stock_consumption_totals(uuid[]) to authenticated;

-- Quote users receive one compatible free-stock total. Reservation identities,
-- other dealers' stock and internal material costs stay behind their read rules.
create or replace function public.get_dealer_quote_stock_availability(p_quote_id uuid)
returns numeric
language plpgsql security definer set search_path = public, private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_dealer uuid := private.get_current_user_dealer_id();
  v_quote public.quotes%rowtype;
  v_available numeric;
begin
  if auth.uid() is null or v_company is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if v_role is null or v_role not in ('owner','admin','sales_manager','sales','accounts','viewer','dealer_admin','dealer_staff') then
    raise exception 'Permission denied to read quote stock availability' using errcode = '42501';
  end if;
  select * into v_quote from public.quotes
    where id = p_quote_id and company_id = v_company and deleted_at is null;
  if not found or (v_role in ('dealer_admin','dealer_staff')
    and (v_dealer is null or v_quote.dealer_id is distinct from v_dealer)) then
    raise exception 'Quote not found for this account' using errcode = '42501';
  end if;
  if v_quote.status is distinct from 'customer_approved' then
    raise exception 'Select a customer-approved quote before checking fulfillment' using errcode = '23514';
  end if;
  if v_quote.dealer_id is null then return 0; end if;

  with demand as (
    select line.profile_id,
      regexp_replace(lower(btrim(coalesce(line.finishing_type,'mill_finish'))),'[^a-z0-9]+','_','g') finish,
      sum(greatest(coalesce(line.billing_weight_kg,line.total_weight_kg,0),0)) weight_kg
    from public.quote_items line
    where line.company_id = v_company and line.quote_id = v_quote.id and line.profile_id is not null
    group by line.profile_id, regexp_replace(lower(btrim(coalesce(line.finishing_type,'mill_finish'))),'[^a-z0-9]+','_','g')
  ), eligible_batches as (
    select batch.id, batch.profile_id, batch.total_weight_kg,
      regexp_replace(lower(btrim(coalesce(batch.finish,'mill_finish'))),'[^a-z0-9]+','_','g') finish
    from public.profile_stock_batches batch
    where batch.company_id = v_company and batch.dealer_id = v_quote.dealer_id
      and batch.status in ('available','reserved')
  ), holds as (
    select reservation.profile_stock_batch_id,
      sum(greatest(reservation.reserved_weight_kg - coalesce((
        select sum(consumption.consumed_weight_kg) from public.profile_stock_consumptions consumption
        where consumption.company_id = v_company and consumption.reservation_id = reservation.id
      ),0),0)) weight_kg
    from public.profile_stock_reservations reservation
    join eligible_batches batch on batch.id = reservation.profile_stock_batch_id
    where reservation.company_id = v_company and reservation.status = 'active'
    group by reservation.profile_stock_batch_id
  ), free_stock as (
    select batch.profile_id, batch.finish,
      sum(greatest(batch.total_weight_kg - coalesce(holds.weight_kg,0),0)) weight_kg
    from eligible_batches batch left join holds on holds.profile_stock_batch_id = batch.id
    group by batch.profile_id, batch.finish
  )
  select round(coalesce(sum(least(demand.weight_kg,coalesce(free_stock.weight_kg,0))),0),3)
    into v_available from demand
    left join free_stock on free_stock.profile_id = demand.profile_id and free_stock.finish = demand.finish;
  return v_available;
end;
$$;
revoke all on function public.get_dealer_quote_stock_availability(uuid) from public, anon;
grant execute on function public.get_dealer_quote_stock_availability(uuid) to authenticated;

create or replace function public.guard_production_job_status()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_has_released_slot boolean;
begin
  if tg_op = 'INSERT' and new.status <> 'planned' then
    raise exception 'New production jobs must start in planned status' using errcode = '23514';
  end if;
  select exists (
    select 1 from public.production_plan_slots slot
    where slot.company_id = new.company_id and slot.production_job_id = new.id
      and slot.machine_id = new.machine_id and slot.status = 'released'
  ) into v_has_released_slot;
  if new.status = 'in_progress' and not v_has_released_slot then
    raise exception 'Production job requires a released press slot before it can start' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and not (
    (old.status = 'planned' and new.status in ('ready','on_hold','cancelled'))
    or (old.status = 'ready' and new.status in ('in_progress','on_hold','cancelled'))
    or (old.status = 'in_progress' and new.status in ('completed','on_hold'))
    or (old.status = 'on_hold' and new.status in ('in_progress','cancelled'))
    or (old.status = 'on_hold' and new.status = 'ready' and v_has_released_slot)
  ) then
    raise exception 'Use the production transition workflow for status changes' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_production_job_status() from public, anon, authenticated;

commit;
