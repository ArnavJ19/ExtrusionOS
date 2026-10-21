-- EXOS-AUD-025: for mill-finish output, dispatch readiness checked only that a
-- completed packaging job existed. A 50 kg packaging job unlocked dispatch of the
-- whole QC-approved weight. The ready weight is now capped by the kg recorded on
-- completed packaging jobs with issued material (the finishing route already
-- caps by packaged kg in private.finishing_dispatch_ready_kg).
--
-- Returned shipments: their packing rows keep counting against the production
-- source. Goods that come back are dispositioned into finished stock, quarantine
-- or scrap by the return-disposition workflow (EXOS-AUD-016), and a replacement
-- ships from that stock, so production capacity is never released twice.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
  v_packaged_job_kg numeric;
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
        -- EXOS-AUD-025: release only the kg that completed packaging (with issued material) actually packed.
        select coalesce(sum(p.profile_weight_kg),0) into v_packaged_job_kg from public.packaging_jobs p where p.company_id=v_dispatch.company_id
          and p.order_id=v_dispatch.order_id and p.production_job_id=v_job.id and p.status='completed'
          and exists(select 1 from public.packaging_job_materials m where m.company_id=v_dispatch.company_id and m.job_id=p.id and m.quantity_required>0);
        if v_packaged_job_kg<=0 then
          raise exception 'Production job % must have completed packaging with issued materials before dispatch',coalesce(v_job.job_number,v_job.id::text);
        end if;
        v_ready_kg:=least(v_ready_kg,v_packaged_job_kg);
      end if;
      select coalesce(sum(pli.net_weight_kg), 0) into v_source_used_kg
      from public.packing_list_items pli
      where pli.company_id = v_dispatch.company_id and pli.source_line_id = v_job.id;
      if v_source_used_kg > v_ready_kg + 0.01 then
        raise exception 'Dispatch packing exceeds QC-released and packaged output for production job %', coalesce(v_job.job_number, v_job.id::text);
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
$function$;

commit;
