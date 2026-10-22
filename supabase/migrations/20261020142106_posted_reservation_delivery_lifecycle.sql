-- Acceptance follow-up for R04/R10/R11. Closed holds preserve existing shipments.
-- New dispatches still require an active reservation and the ordinary stock writer.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.closed_reservation_has_exact_dispatch_posting(
  p_dispatch_id uuid, p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_dispatch public.dispatches%rowtype;
  v_reservation public.profile_stock_reservations%rowtype;
  v_posted public.profile_stock_consumptions%rowtype;
  v_group record;
begin
  select * into v_dispatch from public.dispatches where id = p_dispatch_id for update;
  if not found then return false; end if;
  select * into v_reservation from public.profile_stock_reservations
  where id = p_reservation_id and company_id = v_dispatch.company_id and order_id = v_dispatch.order_id
  for update;
  if not found or v_reservation.status is null or v_reservation.status not in ('released','cancelled')
    or v_reservation.initial_reserved_weight_kg is null or v_reservation.initial_reserved_weight_kg <= 0
    or v_reservation.initial_reserved_length_m is null or v_reservation.initial_reserved_length_m <= 0
    or v_reservation.initial_reserved_pieces is null or v_reservation.initial_reserved_pieces <= 0
    or v_reservation.initial_reserved_weight_kg::text in ('NaN','Infinity','-Infinity')
    or v_reservation.initial_reserved_length_m::text in ('NaN','Infinity','-Infinity') then
    return false;
  end if;
  if not exists (
    select 1 from public.profile_stock_batches
    where id = v_reservation.profile_stock_batch_id and company_id = v_reservation.company_id
      and profile_id = v_reservation.profile_id
  ) then return false; end if;

  select * into v_posted from public.profile_stock_consumptions
  where reservation_id = p_reservation_id and dispatch_id = p_dispatch_id
  for update;
  if not found or (select count(*) from public.profile_stock_consumptions
    where reservation_id = p_reservation_id and dispatch_id = p_dispatch_id) <> 1 then return false; end if;

  select count(*) as item_count,
    bool_and(coalesce(
      source_kind = 'reservation' and source_record_id = v_dispatch.order_id
      and source_line_id = p_reservation_id and profile_id = v_reservation.profile_id
      and profile_stock_batch_id = v_reservation.profile_stock_batch_id
      and operator_verified_at is not null and operator_verified_by is not null
      and net_weight_kg > 0 and net_weight_kg::text not in ('NaN','Infinity','-Infinity')
      and net_length_m > 0 and net_length_m::text not in ('NaN','Infinity','-Infinity')
      and number_of_pieces > 0
      and abs(net_weight_kg - v_reservation.initial_reserved_weight_kg * number_of_pieces / v_reservation.initial_reserved_pieces) <= 0.01
      and abs(net_length_m - v_reservation.initial_reserved_length_m * number_of_pieces / v_reservation.initial_reserved_pieces) <= 0.001,
      false
    )) as valid_items,
    round(sum(net_weight_kg),3) as weight_kg,
    round(sum(net_length_m),3) as length_m,
    sum(number_of_pieces) as pieces
  into v_group
  from public.packing_list_items
  where company_id = v_dispatch.company_id and dispatch_id = p_dispatch_id and reservation_id = p_reservation_id;

  return coalesce(
    v_group.item_count > 0 and v_group.valid_items
    and v_posted.company_id = v_dispatch.company_id and v_posted.order_id = v_dispatch.order_id
    and v_posted.profile_id = v_reservation.profile_id
    and v_posted.profile_stock_batch_id = v_reservation.profile_stock_batch_id
    and v_posted.consumed_weight_kg = v_group.weight_kg
    and v_posted.consumed_length_m = v_group.length_m and v_posted.consumed_pieces = v_group.pieces
    and v_group.weight_kg <= v_reservation.initial_reserved_weight_kg
    and v_group.length_m <= v_reservation.initial_reserved_length_m
    and v_group.pieces <= v_reservation.initial_reserved_pieces, false
  );
end;
$$;
revoke all on function private.closed_reservation_has_exact_dispatch_posting(uuid,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.assert_dispatch_ready(p_dispatch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
         or (v_reservation.status not in ('active','consumed')
           and not private.closed_reservation_has_exact_dispatch_posting(p_dispatch_id, v_reservation.id)) then
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
      perform 1 from public.production_jobs where id=v_job.id and company_id=v_dispatch.company_id for update nowait;
      if coalesce(v_job.finishing_type,'mill_finish')<>'mill_finish' then
        v_ready_kg:=private.finishing_dispatch_ready_kg(v_dispatch.company_id,v_dispatch.order_id,v_job.id,v_quality_required);
        if v_ready_kg<=0 then raise exception 'Production job % needs accepted finishing, QC release and completed packaging',coalesce(v_job.job_number,v_job.id::text); end if;
      else
        v_ready_kg:=v_job.actual_quantity_kg;
        if v_quality_required then
          select coalesce(sum(quantity_checked_kg),0) into v_approved_kg from public.quality_inspections
          where company_id=v_dispatch.company_id and production_job_id=v_job.id and profile_id=v_job.profile_id
            and status='approved' and finishing_job_id is null;
          v_ready_kg:=least(v_ready_kg,v_approved_kg);
          if v_ready_kg<=0 then raise exception 'Production job % needs QC-approved released quantity before dispatch',coalesce(v_job.job_number,v_job.id::text); end if;
        end if;
        if not exists(select 1 from public.packaging_jobs p where p.company_id=v_dispatch.company_id
          and p.order_id=v_dispatch.order_id and p.production_job_id=v_job.id and p.status='completed'
          and exists(select 1 from public.packaging_job_materials m where m.company_id=v_dispatch.company_id and m.job_id=p.id and m.quantity_required>0)) then
          raise exception 'Production job % must have completed packaging with issued materials before dispatch',coalesce(v_job.job_number,v_job.id::text);
        end if;
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
$function$
;
revoke all on function private.assert_dispatch_ready(uuid) from public,anon,authenticated;
commit;
