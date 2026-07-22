begin;

alter table public.dispatches
  add column if not exists last_status_changed_at timestamptz not null default now(),
  add column if not exists delivered_at timestamptz;

create table if not exists public.dispatch_status_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  remarks text
);

alter table public.dispatch_status_history enable row level security;
drop policy if exists "dispatch status history tenant read" on public.dispatch_status_history;
create policy "dispatch status history tenant read"
on public.dispatch_status_history for select
using (company_id = public.get_current_user_company_id());
create index if not exists dispatch_status_history_dispatch_idx
  on public.dispatch_status_history(company_id, dispatch_id, changed_at desc);

create or replace function private.is_valid_delivery_transition(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
as $$
  select p_from = p_to
    or (p_from = 'pending' and p_to = 'dispatched')
    or (p_from = 'dispatched' and p_to in ('in_transit','delivered','delayed','damaged','returned'))
    or (p_from = 'in_transit' and p_to in ('delivered','delayed','damaged','returned'))
    or (p_from = 'delayed' and p_to in ('dispatched','in_transit','delivered','damaged','returned'))
    or (p_from = 'damaged' and p_to in ('dispatched','in_transit','returned'))
    or (p_from = 'returned' and p_to = 'dispatched')
    or (p_from = 'delivered' and p_to = 'returned')
$$;

create or replace function public.validate_dispatch_transition()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' then
    if new.delivery_status not in ('pending','dispatched') then
      raise exception 'New dispatches must start as pending or dispatched'
        using errcode = '23514';
    end if;
    new.last_status_changed_at := now();
  else
    if new.company_id <> old.company_id or new.order_id <> old.order_id then
      raise exception 'Dispatch company and order cannot be changed after creation'
        using errcode = '23514';
    end if;
    if old.delivery_status <> 'pending'
       and (
         new.total_weight_kg is distinct from old.total_weight_kg
         or new.number_of_bundles is distinct from old.number_of_bundles
       ) then
      raise exception 'Activated dispatch weight and packing totals are immutable'
        using errcode = '23514';
    end if;
    if not private.is_valid_delivery_transition(old.delivery_status, new.delivery_status) then
      raise exception 'Invalid delivery transition from % to %', old.delivery_status, new.delivery_status
        using errcode = '23514';
    end if;
    if new.delivery_status is distinct from old.delivery_status then
      new.last_status_changed_at := now();
    end if;
  end if;

  if new.delivery_status = 'delivered' then
    if coalesce(btrim(new.proof_of_delivery_url), '') = '' then
      raise exception 'Proof of delivery is required before marking a shipment delivered'
        using errcode = '23514';
    end if;
    new.delivered_at := coalesce(new.delivered_at, now());
  elsif tg_op = 'UPDATE' and new.delivery_status is distinct from old.delivery_status then
    new.delivered_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_dispatch_transition on public.dispatches;
create trigger validate_dispatch_transition
before insert or update of company_id, order_id, total_weight_kg, number_of_bundles,
  delivery_status, proof_of_delivery_url
on public.dispatches
for each row execute function public.validate_dispatch_transition();

create or replace function public.guard_active_dispatch_packing()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select delivery_status into v_status
    from public.dispatches
    where id = old.dispatch_id;
    if found and v_status <> 'pending' then
      raise exception 'Packing allocation is immutable after dispatch activation'
        using errcode = '23514';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select delivery_status into v_status
    from public.dispatches
    where id = new.dispatch_id;
    if found and v_status <> 'pending' then
      raise exception 'Packing allocation is immutable after dispatch activation'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists guard_active_dispatch_packing on public.packing_list_items;
create trigger guard_active_dispatch_packing
before insert or update or delete on public.packing_list_items
for each row execute function public.guard_active_dispatch_packing();

create or replace function private.sync_order_delivery_stage(
  p_company_id uuid,
  p_order_id uuid,
  p_remarks text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_current_stage text;
  v_required_kg numeric := 0;
  v_order_kg numeric := 0;
  v_line_kg numeric := 0;
  v_factory_kg numeric := 0;
  v_stock_kg numeric := 0;
  v_delivered_kg numeric := 0;
  v_dispatch_count integer := 0;
  v_open_count integer := 0;
  v_next_stage text;
begin
  select current_stage, coalesce(production_quantity_kg, 0)
  into v_current_stage, v_order_kg
  from public.orders
  where id = p_order_id and company_id = p_company_id
  for update;
  if not found or v_current_stage in ('cancelled','closed','payment_pending') then
    return;
  end if;

  select coalesce(sum(coalesce(quantity_kg, 0)), 0)
  into v_line_kg
  from public.order_items
  where company_id = p_company_id and order_id = p_order_id;

  select coalesce(sum(coalesce(planned_quantity_kg, 0)), 0)
  into v_factory_kg
  from public.production_jobs
  where company_id = p_company_id
    and order_id = p_order_id
    and status <> 'cancelled';

  select coalesce(sum(fulfilled_weight_kg), 0)
  into v_stock_kg
  from public.order_dealer_stock_fulfillments
  where company_id = p_company_id
    and order_id = p_order_id
    and credited_at is null;

  v_required_kg := greatest(v_order_kg, v_line_kg, v_factory_kg + v_stock_kg);

  select
    count(*) filter (where delivery_status <> 'pending'),
    count(*) filter (where delivery_status not in ('pending', 'delivered')),
    coalesce(sum(total_weight_kg) filter (where delivery_status = 'delivered'), 0)
  into v_dispatch_count, v_open_count, v_delivered_kg
  from public.dispatches
  where company_id = p_company_id and order_id = p_order_id;

  if v_dispatch_count = 0 then return; end if;
  if v_required_kg > 0
     and v_open_count = 0
     and v_delivered_kg + 0.01 >= v_required_kg then
    v_next_stage := 'delivered';
  else
    v_next_stage := 'dispatched';
  end if;
  if v_current_stage = v_next_stage then return; end if;

  update public.orders
  set current_stage = v_next_stage, updated_at = now()
  where id = p_order_id and company_id = p_company_id;
  insert into public.order_stage_history(company_id, order_id, stage, changed_by, remarks)
  values (p_company_id, p_order_id, v_next_stage, auth.uid(), p_remarks);
end;
$$;

create or replace function public.record_dispatch_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' or new.delivery_status is distinct from old.delivery_status then
    insert into public.dispatch_status_history(
      company_id, dispatch_id, from_status, to_status, changed_by, remarks
    ) values (
      new.company_id,
      new.id,
      case when tg_op = 'UPDATE' then old.delivery_status else null end,
      new.delivery_status,
      auth.uid(),
      new.remarks
    );
    perform private.sync_order_delivery_stage(
      new.company_id,
      new.order_id,
      concat('Dispatch ', coalesce(new.dispatch_number, new.id::text), ' changed to ', replace(new.delivery_status, '_', ' '), '.')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_dispatch_status_change on public.dispatches;
create trigger record_dispatch_status_change
after insert or update of delivery_status on public.dispatches
for each row execute function public.record_dispatch_status_change();

create or replace function private.assert_dispatch_ready(p_dispatch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_dispatch record;
  v_item record;
  v_job record;
  v_fulfillment record;
  v_packaged_kg numeric;
  v_source_used_kg numeric;
  v_ready_kg numeric;
  v_approved_kg numeric;
  v_quality_required boolean;
  v_item_count integer;
begin
  select *
  into v_dispatch
  from public.dispatches
  where id = p_dispatch_id
  for update;
  if not found then return; end if;

  perform 1 from public.orders
  where id = v_dispatch.order_id and company_id = v_dispatch.company_id
  for update;
  if not found then raise exception 'Dispatch order is unavailable for this company'; end if;

  if coalesce(v_dispatch.total_weight_kg, 0) <= 0 then
    raise exception 'Dispatch weight must be greater than zero';
  end if;

  select count(*), coalesce(sum(gross_weight_kg), 0)
  into v_item_count, v_packaged_kg
  from public.packing_list_items
  where dispatch_id = p_dispatch_id and company_id = v_dispatch.company_id;
  if v_item_count = 0 then
    raise exception 'A dispatch requires at least one ready packing source';
  end if;
  if abs(v_packaged_kg - v_dispatch.total_weight_kg) > 0.01 then
    raise exception 'Packing source weight (%) must equal dispatch weight (%)',
      v_packaged_kg, v_dispatch.total_weight_kg;
  end if;

  select coalesce((
    select is_enabled
    from public.feature_flags
    where company_id = v_dispatch.company_id
      and module_name = 'quality_compliance'
    limit 1
  ), true) into v_quality_required;

  for v_item in
    select *
    from public.packing_list_items
    where dispatch_id = p_dispatch_id and company_id = v_dispatch.company_id
  loop
    if coalesce(v_item.gross_weight_kg, 0) <= 0
       or coalesce(v_item.tare_weight_kg, 0) < 0
       or coalesce(v_item.net_weight_kg, 0) <= 0 then
      raise exception 'Every packing row requires positive gross/net weight and non-negative tare';
    end if;

    if v_item.source_record_id is distinct from v_dispatch.order_id
       or v_item.source_line_id is null then
      raise exception 'Every packing row must trace to this order and a ready source';
    end if;

    select id, company_id, order_id, profile_id, status, actual_quantity_kg, job_number, finishing_type
    into v_job
    from public.production_jobs
    where id = v_item.source_line_id;

    if found then
      if v_job.company_id <> v_dispatch.company_id
         or v_job.order_id <> v_dispatch.order_id
         or v_job.profile_id <> v_item.profile_id
         or v_job.status <> 'completed'
         or coalesce(v_job.actual_quantity_kg, 0) <= 0 then
        raise exception 'Packing row source is not completed production for this order/profile';
      end if;
      v_ready_kg := v_job.actual_quantity_kg;
      if coalesce(v_job.finishing_type, 'mill_finish') <> 'mill_finish' then
        select coalesce(max(output_weight_kg), 0)
        into v_ready_kg
        from public.finishing_jobs
        where company_id = v_dispatch.company_id
          and production_job_id = v_job.id
          and order_id = v_dispatch.order_id
          and status = 'completed';
        if v_ready_kg <= 0 then
          raise exception 'Production job % requires completed finishing before dispatch',
            coalesce(v_job.job_number, v_job.id::text);
        end if;
      end if;
      if v_quality_required then
        select coalesce(sum(qi.quantity_checked_kg), 0)
        into v_approved_kg
        from public.quality_inspections qi
        where qi.company_id = v_dispatch.company_id
          and qi.production_job_id = v_job.id
          and qi.profile_id = v_job.profile_id
          and qi.status = 'approved'
          and (
            (coalesce(v_job.finishing_type, 'mill_finish') = 'mill_finish' and qi.finishing_job_id is null)
            or (
              coalesce(v_job.finishing_type, 'mill_finish') <> 'mill_finish'
              and exists (
                select 1 from public.finishing_jobs fj
                where fj.id = qi.finishing_job_id
                  and fj.company_id = v_dispatch.company_id
                  and fj.production_job_id = v_job.id
                  and fj.status = 'completed'
              )
            )
          );
        v_ready_kg := least(v_ready_kg, v_approved_kg);
        if v_ready_kg <= 0 then
          raise exception 'Production job % needs QC-approved released quantity before dispatch',
            coalesce(v_job.job_number, v_job.id::text);
        end if;
      end if;
      if not exists (
        select 1
        from public.packaging_jobs pj
        where pj.company_id = v_dispatch.company_id
          and pj.production_job_id = v_job.id
          and pj.order_id = v_dispatch.order_id
          and pj.status = 'completed'
          and exists (
            select 1 from public.packaging_job_materials pjm
            where pjm.company_id = v_dispatch.company_id
              and pjm.job_id = pj.id
              and pjm.quantity_required > 0
          )
      ) then
        raise exception 'Production job % must have completed packaging with issued materials before dispatch',
          coalesce(v_job.job_number, v_job.id::text);
      end if;
      select coalesce(sum(pli.net_weight_kg), 0)
      into v_source_used_kg
      from public.packing_list_items pli
      join public.dispatches d on d.id = pli.dispatch_id
      where pli.company_id = v_dispatch.company_id
        and pli.source_line_id = v_job.id;
      if v_source_used_kg > v_ready_kg + 0.01 then
        raise exception 'Dispatch packing exceeds QC-released output for production job %',
          coalesce(v_job.job_number, v_job.id::text);
      end if;
    else
      select id, company_id, order_id, profile_id, fulfilled_weight_kg, credited_at
      into v_fulfillment
      from public.order_dealer_stock_fulfillments
      where id = v_item.source_line_id;
      if not found
         or v_fulfillment.company_id <> v_dispatch.company_id
         or v_fulfillment.order_id <> v_dispatch.order_id
         or v_fulfillment.profile_id <> v_item.profile_id
         or v_fulfillment.credited_at is not null then
        raise exception 'Packing row is not linked to eligible production or dealer-stock fulfillment';
      end if;
      select coalesce(sum(pli.net_weight_kg), 0)
      into v_source_used_kg
      from public.packing_list_items pli
      where pli.company_id = v_dispatch.company_id
        and pli.source_line_id = v_fulfillment.id;
      if v_source_used_kg > v_fulfillment.fulfilled_weight_kg + 0.01 then
        raise exception 'Dispatch packing exceeds dealer-stock fulfillment weight';
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.validate_dispatch_readiness()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.delivery_status <> 'pending' then
    perform private.assert_dispatch_ready(new.id);
  end if;
  return new;
end;
$$;

create or replace function public.validate_packing_dispatch_readiness()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_dispatch_id uuid;
  v_delivery_status text;
begin
  if tg_op = 'DELETE' then v_dispatch_id := old.dispatch_id;
  else v_dispatch_id := new.dispatch_id;
  end if;
  select delivery_status into v_delivery_status
  from public.dispatches where id = v_dispatch_id;
  if found and v_delivery_status <> 'pending' then
    perform private.assert_dispatch_ready(v_dispatch_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists validate_dispatch_readiness on public.dispatches;
create constraint trigger validate_dispatch_readiness
after insert or update of order_id, total_weight_kg, delivery_status
on public.dispatches
deferrable initially deferred
for each row execute function public.validate_dispatch_readiness();

drop trigger if exists validate_packing_dispatch_readiness on public.packing_list_items;
create constraint trigger validate_packing_dispatch_readiness
after insert or update or delete on public.packing_list_items
deferrable initially deferred
for each row execute function public.validate_packing_dispatch_readiness();

create or replace function private.save_ready_dispatch_atomic(
  p_dispatch_id uuid,
  p_dispatch jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_current record;
  v_payload jsonb := p_dispatch;
  v_dispatch_id uuid;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A dispatch requires at least one ready packing source';
  end if;
  if p_dispatch_id is null then
    v_payload := v_payload || jsonb_build_object('delivery_status', 'pending');
  else
    select order_id, delivery_status into v_current
    from public.dispatches
    where id = p_dispatch_id and company_id = v_company_id
    for update;
    if not found then raise exception 'Dispatch not found for this company'; end if;
    if v_current.delivery_status <> 'pending' then
      raise exception 'Activated dispatch packing cannot be edited; use the delivery workflow for status and logistics updates';
    end if;
    if nullif(v_payload ->> 'order_id', '')::uuid <> v_current.order_id then
      raise exception 'Dispatch order cannot be changed after creation';
    end if;
    v_payload := v_payload || jsonb_build_object('delivery_status', v_current.delivery_status);
  end if;
  v_payload := v_payload || jsonb_build_object(
    'number_of_bundles', jsonb_array_length(p_items)
  );
  v_dispatch_id := private.save_dispatch_atomic(
    p_dispatch_id,
    v_payload,
    p_items,
    null
  );
  update public.dispatches
  set delivery_status = 'dispatched', updated_at = now()
  where id = v_dispatch_id and company_id = v_company_id;
  perform private.assert_dispatch_ready(v_dispatch_id);
  perform private.sync_order_delivery_stage(
    v_company_id,
    nullif(v_payload ->> 'order_id', '')::uuid,
    'Dispatch created from QC-approved and completed packing sources.'
  );
  return v_dispatch_id;
end;
$$;

create or replace function public.save_ready_dispatch_atomic(
  p_dispatch_id uuid,
  p_dispatch jsonb,
  p_items jsonb
)
returns uuid language sql security definer set search_path = public, private
as $$ select private.save_ready_dispatch_atomic(p_dispatch_id, p_dispatch, p_items) $$;

create or replace function private.transition_dispatch_delivery_atomic(
  p_dispatch_id uuid,
  p_status text,
  p_proof_of_delivery_url text,
  p_remarks text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_order_id uuid;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied for dispatches' using errcode = '42501';
  end if;
  update public.dispatches
  set delivery_status = p_status,
      proof_of_delivery_url = case
        when nullif(btrim(coalesce(p_proof_of_delivery_url, '')), '') is not null
          then btrim(p_proof_of_delivery_url)
        else proof_of_delivery_url
      end,
      remarks = case
        when nullif(btrim(coalesce(p_remarks, '')), '') is not null then btrim(p_remarks)
        else remarks
      end,
      updated_at = now()
  where id = p_dispatch_id and company_id = v_company_id
  returning order_id into v_order_id;
  if not found then raise exception 'Dispatch not found for this company'; end if;
  return v_order_id;
end;
$$;

create or replace function public.transition_dispatch_delivery_atomic(
  p_dispatch_id uuid,
  p_status text,
  p_proof_of_delivery_url text default null,
  p_remarks text default null
)
returns uuid language sql security definer set search_path = public, private
as $$
  select private.transition_dispatch_delivery_atomic(
    p_dispatch_id, p_status, p_proof_of_delivery_url, p_remarks
  )
$$;

revoke all on function private.is_valid_delivery_transition(text, text) from public, anon, authenticated;
revoke all on function private.sync_order_delivery_stage(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.assert_dispatch_ready(uuid) from public, anon, authenticated;
revoke all on function private.save_ready_dispatch_atomic(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.transition_dispatch_delivery_atomic(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.save_ready_dispatch_atomic(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.transition_dispatch_delivery_atomic(uuid, text, text, text) from public, anon;
grant execute on function public.save_ready_dispatch_atomic(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.transition_dispatch_delivery_atomic(uuid, text, text, text) to authenticated;

commit;
