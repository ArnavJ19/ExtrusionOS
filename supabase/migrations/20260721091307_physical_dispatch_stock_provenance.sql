begin;

alter table public.dispatches
  add column if not exists total_tare_weight_kg numeric(14,3) not null default 0;

alter table public.packing_list_items
  add column if not exists source_kind text,
  add column if not exists reservation_id uuid references public.profile_stock_reservations(id) on delete restrict,
  add column if not exists profile_stock_batch_id uuid references public.profile_stock_batches(id) on delete restrict;

update public.packing_list_items pli
set source_kind = 'production'
where source_kind is null
  and exists (
    select 1 from public.production_jobs pj
    where pj.id = pli.source_line_id and pj.company_id = pli.company_id
  );

update public.packing_list_items pli
set source_kind = 'dealer_stock',
    profile_stock_batch_id = fulfillment.profile_stock_batch_id
from public.order_dealer_stock_fulfillments fulfillment
where pli.source_kind is null
  and fulfillment.id = pli.source_line_id
  and fulfillment.company_id = pli.company_id;

update public.dispatches d
set total_tare_weight_kg = source.total_tare_weight_kg
from (
  select dispatch_id, round(coalesce(sum(tare_weight_kg), 0), 3) as total_tare_weight_kg
  from public.packing_list_items
  group by dispatch_id
) source
where source.dispatch_id = d.id;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispatches_total_tare_nonnegative') then
    alter table public.dispatches
      add constraint dispatches_total_tare_nonnegative check (total_tare_weight_kg >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'packing_list_items_source_kind_check') then
    alter table public.packing_list_items
      add constraint packing_list_items_source_kind_check
      check (source_kind is null or source_kind in ('production','dealer_stock','reservation'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'packing_list_items_stock_provenance_check') then
    alter table public.packing_list_items
      add constraint packing_list_items_stock_provenance_check
      check (
        source_kind is null
        or (source_kind = 'production' and reservation_id is null and profile_stock_batch_id is null)
        or (source_kind = 'dealer_stock' and reservation_id is null and profile_stock_batch_id is not null)
        or (source_kind = 'reservation' and reservation_id is not null and profile_stock_batch_id is not null)
      ) not valid;
  end if;
end
$$;

create index if not exists packing_list_items_reservation_idx
  on public.packing_list_items(company_id, reservation_id, dispatch_id)
  where reservation_id is not null;
create index if not exists packing_list_items_stock_batch_idx
  on public.packing_list_items(company_id, profile_stock_batch_id, dispatch_id)
  where profile_stock_batch_id is not null;

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
  v_reservation record;
  v_packaged_kg numeric;
  v_tare_kg numeric;
  v_source_used_kg numeric;
  v_ready_kg numeric;
  v_approved_kg numeric;
  v_quality_required boolean;
  v_item_count integer;
begin
  select * into v_dispatch
  from public.dispatches
  where id = p_dispatch_id
  for update;
  if not found then return; end if;

  perform 1 from public.orders
  where id = v_dispatch.order_id and company_id = v_dispatch.company_id
  for update;
  if not found then raise exception 'Dispatch order is unavailable for this company'; end if;
  if coalesce(v_dispatch.total_weight_kg, 0) <= 0 then
    raise exception 'Dispatch net aluminium weight must be greater than zero';
  end if;

  select count(*), coalesce(sum(net_weight_kg), 0), coalesce(sum(tare_weight_kg), 0)
  into v_item_count, v_packaged_kg, v_tare_kg
  from public.packing_list_items
  where dispatch_id = p_dispatch_id and company_id = v_dispatch.company_id;
  if v_item_count = 0 then raise exception 'A dispatch requires at least one physical bundle'; end if;
  if v_item_count <> v_dispatch.number_of_bundles then
    raise exception 'Physical bundle count (%) must equal dispatch bundle count (%)', v_item_count, v_dispatch.number_of_bundles;
  end if;
  if abs(v_packaged_kg - v_dispatch.total_weight_kg) > 0.01 then
    raise exception 'Packing net aluminium weight (%) must equal dispatch net weight (%)', v_packaged_kg, v_dispatch.total_weight_kg;
  end if;
  if abs(v_tare_kg - v_dispatch.total_tare_weight_kg) > 0.01 then
    raise exception 'Packing tare weight (%) must equal dispatch tare weight (%)', v_tare_kg, v_dispatch.total_tare_weight_kg;
  end if;

  select coalesce((
    select is_enabled from public.feature_flags
    where company_id = v_dispatch.company_id and module_name = 'quality_compliance'
    limit 1
  ), true) into v_quality_required;

  for v_item in
    select * from public.packing_list_items
    where dispatch_id = p_dispatch_id and company_id = v_dispatch.company_id
  loop
    if coalesce(v_item.gross_weight_kg, 0) <= 0
       or coalesce(v_item.tare_weight_kg, 0) < 0
       or coalesce(v_item.net_weight_kg, 0) <= 0 then
      raise exception 'Every bundle requires positive gross/net weight and non-negative tare';
    end if;
    if v_item.source_record_id is distinct from v_dispatch.order_id
       or v_item.source_line_id is null
       or v_item.source_kind is null then
      raise exception 'Every bundle must identify its order, source type, and source row';
    end if;

    if v_item.source_kind = 'reservation' then
      select id, company_id, order_id, profile_id, profile_stock_batch_id,
             reserved_weight_kg, reserved_length_m, status
      into v_reservation
      from public.profile_stock_reservations
      where id = v_item.reservation_id
      for update;
      if not found
         or v_item.source_line_id <> v_reservation.id
         or v_reservation.company_id <> v_dispatch.company_id
         or v_reservation.order_id <> v_dispatch.order_id
         or v_reservation.profile_id <> v_item.profile_id
         or v_reservation.profile_stock_batch_id <> v_item.profile_stock_batch_id
         or v_reservation.status not in ('active','consumed') then
        raise exception 'Reserved-stock bundle is not linked to an eligible reservation and stock batch';
      end if;
      select coalesce(sum(pli.net_weight_kg), 0) into v_source_used_kg
      from public.packing_list_items pli
      where pli.company_id = v_dispatch.company_id
        and pli.reservation_id = v_reservation.id;
      if v_source_used_kg > v_reservation.reserved_weight_kg + 0.01 then
        raise exception 'Dispatch packing exceeds reserved stock weight';
      end if;
      continue;
    end if;

    select id, company_id, order_id, profile_id, status, actual_quantity_kg, job_number, finishing_type
    into v_job
    from public.production_jobs
    where id = v_item.source_line_id;

    if v_item.source_kind = 'production' and found then
      if v_item.reservation_id is not null or v_item.profile_stock_batch_id is not null
         or v_job.company_id <> v_dispatch.company_id
         or v_job.order_id <> v_dispatch.order_id
         or v_job.profile_id <> v_item.profile_id
         or v_job.status <> 'completed'
         or coalesce(v_job.actual_quantity_kg, 0) <= 0 then
        raise exception 'Production bundle source is not completed production for this order/profile';
      end if;
      v_ready_kg := v_job.actual_quantity_kg;
      if coalesce(v_job.finishing_type, 'mill_finish') <> 'mill_finish' then
        select coalesce(max(output_weight_kg), 0) into v_ready_kg
        from public.finishing_jobs
        where company_id = v_dispatch.company_id
          and production_job_id = v_job.id
          and order_id = v_dispatch.order_id
          and status = 'completed';
        if v_ready_kg <= 0 then
          raise exception 'Production job % requires completed finishing before dispatch', coalesce(v_job.job_number, v_job.id::text);
        end if;
      end if;
      if v_quality_required then
        select coalesce(sum(qi.quantity_checked_kg), 0) into v_approved_kg
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
          raise exception 'Production job % needs QC-approved released quantity before dispatch', coalesce(v_job.job_number, v_job.id::text);
        end if;
      end if;
      if not exists (
        select 1 from public.packaging_jobs pj
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
        raise exception 'Production job % must have completed packaging with issued materials before dispatch', coalesce(v_job.job_number, v_job.id::text);
      end if;
      select coalesce(sum(pli.net_weight_kg), 0) into v_source_used_kg
      from public.packing_list_items pli
      where pli.company_id = v_dispatch.company_id and pli.source_line_id = v_job.id;
      if v_source_used_kg > v_ready_kg + 0.01 then
        raise exception 'Dispatch packing exceeds QC-released output for production job %', coalesce(v_job.job_number, v_job.id::text);
      end if;
      continue;
    end if;

    select id, company_id, order_id, profile_id, profile_stock_batch_id, fulfilled_weight_kg, credited_at
    into v_fulfillment
    from public.order_dealer_stock_fulfillments
    where id = v_item.source_line_id;
    if v_item.source_kind <> 'dealer_stock'
       or not found
       or v_item.reservation_id is not null
       or v_fulfillment.company_id <> v_dispatch.company_id
       or v_fulfillment.order_id <> v_dispatch.order_id
       or v_fulfillment.profile_id <> v_item.profile_id
       or v_fulfillment.profile_stock_batch_id <> v_item.profile_stock_batch_id
       or v_fulfillment.credited_at is not null then
      raise exception 'Dealer-stock bundle is not linked to its exact fulfillment and stock batch';
    end if;
    select coalesce(sum(pli.net_weight_kg), 0) into v_source_used_kg
    from public.packing_list_items pli
    where pli.company_id = v_dispatch.company_id and pli.source_line_id = v_fulfillment.id;
    if v_source_used_kg > v_fulfillment.fulfilled_weight_kg + 0.01 then
      raise exception 'Dispatch packing exceeds dealer-stock fulfillment weight';
    end if;
  end loop;
end;
$$;

create or replace function private.consume_dispatch_reservations(p_dispatch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_dispatch record;
  v_group record;
  v_reservation record;
  v_batch record;
  v_other_consumed numeric;
  v_total_consumed numeric;
  v_consumed_length numeric;
  v_new_weight numeric;
  v_new_pieces integer;
begin
  select id, company_id, order_id into v_dispatch
  from public.dispatches
  where id = p_dispatch_id
  for update;
  if not found then raise exception 'Dispatch not found'; end if;

  for v_group in
    select reservation_id, profile_stock_batch_id, profile_id, round(sum(net_weight_kg), 3) as consumed_weight_kg
    from public.packing_list_items
    where dispatch_id = p_dispatch_id
      and company_id = v_dispatch.company_id
      and source_kind = 'reservation'
    group by reservation_id, profile_stock_batch_id, profile_id
  loop
    select * into v_reservation
    from public.profile_stock_reservations
    where id = v_group.reservation_id
      and company_id = v_dispatch.company_id
      and order_id = v_dispatch.order_id
    for update;
    if not found
       or v_reservation.profile_stock_batch_id <> v_group.profile_stock_batch_id
       or v_reservation.profile_id <> v_group.profile_id
       or v_reservation.status <> 'active' then
      raise exception 'Reservation is stale or no longer available for dispatch';
    end if;

    select coalesce(sum(consumed_weight_kg), 0) into v_other_consumed
    from public.profile_stock_consumptions
    where reservation_id = v_reservation.id
      and company_id = v_dispatch.company_id
      and dispatch_id <> p_dispatch_id;
    v_total_consumed := round(v_other_consumed + v_group.consumed_weight_kg, 3);
    if v_total_consumed > v_reservation.reserved_weight_kg + 0.01 then
      raise exception 'Reservation consumption exceeds reserved weight';
    end if;

    v_consumed_length := case
      when v_reservation.reserved_weight_kg > 0
        then round(v_reservation.reserved_length_m * v_group.consumed_weight_kg / v_reservation.reserved_weight_kg, 3)
      else 0
    end;
    insert into public.profile_stock_consumptions (
      company_id, reservation_id, profile_stock_batch_id, profile_id, order_id,
      dispatch_id, consumed_weight_kg, consumed_length_m, notes, created_by
    ) values (
      v_dispatch.company_id, v_reservation.id, v_reservation.profile_stock_batch_id,
      v_reservation.profile_id, v_reservation.order_id, p_dispatch_id,
      v_group.consumed_weight_kg, v_consumed_length,
      'Consumed from exact dispatch bundle provenance', auth.uid()
    )
    on conflict (company_id, dispatch_id, reservation_id)
    do update set
      consumed_weight_kg = excluded.consumed_weight_kg,
      consumed_length_m = excluded.consumed_length_m,
      notes = excluded.notes;

    if v_total_consumed >= v_reservation.reserved_weight_kg - 0.01 then
      select * into v_batch
      from public.profile_stock_batches
      where id = v_reservation.profile_stock_batch_id
        and company_id = v_dispatch.company_id
      for update;
      if not found or v_batch.total_weight_kg + 0.01 < v_reservation.reserved_weight_kg then
        raise exception 'Reserved stock batch no longer contains the reserved weight';
      end if;
      v_new_weight := round(greatest(v_batch.total_weight_kg - v_reservation.reserved_weight_kg, 0), 3);
      v_new_pieces := case
        when v_batch.total_weight_kg > 0
          then greatest(0, round(v_batch.quantity_pieces * v_new_weight / v_batch.total_weight_kg)::integer)
        else 0
      end;
      update public.profile_stock_batches
      set total_weight_kg = v_new_weight,
          quantity_pieces = v_new_pieces,
          status = case when v_new_weight <= 0.001 then 'dispatched' else 'available' end
      where id = v_batch.id and company_id = v_dispatch.company_id;
      update public.profile_stock_reservations
      set status = 'consumed', released_at = now()
      where id = v_reservation.id and company_id = v_dispatch.company_id;
    end if;
  end loop;
end;
$$;

revoke all on function private.consume_dispatch_reservations(uuid) from public, anon, authenticated;

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
  v_tare_weight numeric := round(coalesce(nullif(p_dispatch ->> 'total_tare_weight_kg', '')::numeric, 0), 3);
begin
  if v_tare_weight < 0 then raise exception 'Total tare weight cannot be negative'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A dispatch requires at least one physical bundle';
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
  v_payload := v_payload || jsonb_build_object('number_of_bundles', jsonb_array_length(p_items));
  v_dispatch_id := private.save_dispatch_atomic(p_dispatch_id, v_payload, p_items, null);
  update public.dispatches
  set delivery_status = 'dispatched',
      total_tare_weight_kg = v_tare_weight,
      updated_at = now()
  where id = v_dispatch_id and company_id = v_company_id;
  perform private.assert_dispatch_ready(v_dispatch_id);
  perform private.consume_dispatch_reservations(v_dispatch_id);
  perform private.assert_dispatch_ready(v_dispatch_id);
  perform private.sync_order_delivery_stage(
    v_company_id,
    nullif(v_payload ->> 'order_id', '')::uuid,
    'Dispatch created from exact physical bundles and source-linked stock.'
  );
  return v_dispatch_id;
end;
$$;

commit;
