-- FN private.advance_order_stage
CREATE OR REPLACE FUNCTION private.advance_order_stage(p_company_id uuid, p_order_id uuid, p_stage text, p_remarks text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_current_stage text;
  v_stages constant text[] := array[
    'order_confirmed','die_ready','billet_ready','billet_heating','extrusion_planned',
    'extruded','stretching','cutting','aging','surface_treatment','finishing','packing',
    'dispatched','delivered','payment_pending','closed'
  ];
begin
  select current_stage
  into v_current_stage
  from public.orders
  where id = p_order_id and company_id = p_company_id
  for update;

  if not found or v_current_stage in ('cancelled','closed') then
    return;
  end if;
  if array_position(v_stages, p_stage) is null then
    raise exception 'Unsupported derived order stage: %', p_stage;
  end if;
  if coalesce(array_position(v_stages, v_current_stage), 0) >= array_position(v_stages, p_stage) then
    return;
  end if;

  update public.orders
  set current_stage = p_stage, updated_at = now()
  where id = p_order_id and company_id = p_company_id;

  insert into public.order_stage_history(company_id, order_id, stage, changed_by, remarks)
  values (p_company_id, p_order_id, p_stage, auth.uid(), p_remarks);
end;
$function$


-- FN private.allocate_billet_to_order
CREATE OR REPLACE FUNCTION private.allocate_billet_to_order(p_billet_id uuid, p_order_id uuid)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select private.assign_billet_to_order(p_billet_id,p_order_id,false);
$function$


-- FN private.apply_foundry_source_delta
CREATE OR REPLACE FUNCTION private.apply_foundry_source_delta(p_source_table text, p_company_id uuid, p_old_source_id uuid, p_old_kg numeric, p_new_source_id uuid, p_new_kg numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_ids uuid[];
  v_id uuid;
  v_old record;
  v_new record;
  v_debit numeric := 0;
  v_refund numeric := 0;
  v_refund_on_new numeric := 0;
  v_delta numeric := 0;
  v_rows integer;
begin
  if p_source_table not in ('foundry_aluminium_scrap', 'foundry_external_aluminium_sources') then
    raise exception 'Unsupported foundry source table';
  end if;
  if p_company_id is null then raise exception 'Foundry company is required'; end if;

  select array_agg(x order by x) into v_ids
  from (select distinct unnest(array[p_old_source_id, p_new_source_id]) as x) ids
  where x is not null;

  -- Lock both sides in the same order for every source switch.
  foreach v_id in array coalesce(v_ids, array[]::uuid[]) loop
    execute format('select 1 from public.%I where id = $1 for update', p_source_table)
      using v_id;
  end loop;

  if p_old_source_id is not null then
    execute format('select id, company_id, weight_kg, available_weight_kg, status from public.%I where id = $1', p_source_table)
      into v_old using p_old_source_id;
    if v_old.id is null or v_old.company_id is distinct from p_company_id then
      raise exception 'Previously selected foundry source does not belong to this company';
    end if;
  end if;

  if coalesce(p_new_kg, 0) > 0 and p_new_source_id is null then
    raise exception 'A same-company source is required for every positive foundry charge component';
  end if;

  if p_new_source_id is not null then
    execute format('select id, company_id, weight_kg, available_weight_kg, status from public.%I where id = $1', p_source_table)
      into v_new using p_new_source_id;
    if v_new.id is null or v_new.company_id is distinct from p_company_id then
      raise exception 'Selected foundry source does not belong to this company';
    end if;
    if coalesce(p_new_kg, 0) > 0
      and v_new.status not in ('available', 'reserved')
      and not (v_new.status = 'used' and p_new_source_id = p_old_source_id
        and coalesce(p_new_kg, 0) <= coalesce(p_old_kg, 0)) then
      raise exception 'Selected foundry source is not usable';
    end if;
  end if;

  if p_old_source_id is not null and coalesce(p_old_kg, 0) > 0 then
    if p_old_source_id = p_new_source_id then
      v_delta := coalesce(p_new_kg, 0) - coalesce(p_old_kg, 0);
      if v_delta > 0 then v_debit := v_delta; elsif v_delta < 0 then v_refund := -v_delta; end if;
    else
      v_refund := coalesce(p_old_kg, 0);
    end if;
  end if;
  if p_new_source_id is not null and p_new_source_id is distinct from p_old_source_id then
    v_debit := coalesce(p_new_kg, 0);
  elsif p_old_source_id is null then
    v_debit := coalesce(p_new_kg, 0);
  end if;

  if v_debit > 0 and (v_new.status not in ('available', 'reserved')
    or coalesce(v_new.available_weight_kg, v_new.weight_kg, 0) < v_debit) then
    raise exception 'Selected foundry source does not have enough usable available weight';
  end if;

  if p_old_source_id is not null and p_old_source_id is distinct from p_new_source_id and v_refund > 0 then
    execute format($sql$
      update public.%1$I
      set available_weight_kg = least(weight_kg, coalesce(available_weight_kg, weight_kg) + $2),
          status = case
            when status not in ('available','reserved','used') then status
            when least(weight_kg, coalesce(available_weight_kg, weight_kg) + $2) >= weight_kg then 'available'
            when least(weight_kg, coalesce(available_weight_kg, weight_kg) + $2) <= 0 then 'used'
            else 'reserved'
          end,
          updated_at = now()
      where id = $1 and company_id = $3
    $sql$, p_source_table) using p_old_source_id, v_refund, p_company_id;
  end if;

  if p_new_source_id is not null and (v_debit > 0 or (p_old_source_id = p_new_source_id and v_refund > 0)) then
    if p_old_source_id = p_new_source_id then v_refund_on_new := v_refund; end if;
    execute format($sql$
      update public.%1$I
      set available_weight_kg = coalesce(available_weight_kg, weight_kg) - $2 + $3,
          status = case
            when status not in ('available','reserved','used') then status
            when coalesce(available_weight_kg, weight_kg) - $2 + $3 <= 0 then 'used'
            when coalesce(available_weight_kg, weight_kg) - $2 + $3 >= weight_kg then 'available'
            else 'reserved'
          end,
          updated_at = now()
      where id = $1 and company_id = $4
    $sql$, p_source_table) using p_new_source_id, v_debit, v_refund_on_new, p_company_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'Selected foundry source changed during reservation'; end if;
  end if;
end;
$function$


-- FN private.assert_dispatch_ready
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


-- FN private.assert_dispatch_source_units
CREATE OR REPLACE FUNCTION private.assert_dispatch_source_units(p_dispatch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_dispatch public.dispatches%rowtype;
  v_source record;
  v_available record;
  v_used record;
begin
  select * into v_dispatch from public.dispatches where id = p_dispatch_id for update;
  if not found then raise exception 'Dispatch not found'; end if;

  for v_source in
    select source_kind, source_line_id, reservation_id, profile_stock_batch_id, profile_id,
      round(sum(net_weight_kg), 3) weight_kg, round(sum(net_length_m), 3) length_m,
      sum(number_of_pieces)::integer pieces
    from public.packing_list_items
    where company_id = v_dispatch.company_id and dispatch_id = p_dispatch_id
    group by source_kind, source_line_id, reservation_id, profile_stock_batch_id, profile_id
    order by coalesce(reservation_id, source_line_id)
  loop
    if v_source.source_kind = 'reservation' then
      select r.initial_reserved_weight_kg weight_kg,
        r.initial_reserved_length_m length_m,
        r.initial_reserved_pieces pieces
      into v_available
      from public.profile_stock_reservations r
      where r.id = v_source.reservation_id and r.company_id = v_dispatch.company_id
        and r.order_id = v_dispatch.order_id and r.profile_id = v_source.profile_id
        and r.profile_stock_batch_id = v_source.profile_stock_batch_id and r.status = 'active'
      for update of r;
    elsif v_source.source_kind = 'dealer_stock' then
      select f.fulfilled_weight_kg weight_kg, f.fulfilled_length_m length_m, f.fulfilled_pieces pieces
      into v_available from public.order_dealer_stock_fulfillments f
      where f.id = v_source.source_line_id and f.company_id = v_dispatch.company_id
        and f.order_id = v_dispatch.order_id and f.profile_id = v_source.profile_id and f.credited_at is null
      for update;
    else
      select j.actual_quantity_kg weight_kg, j.actual_meters length_m, j.actual_pieces pieces
      into v_available from public.production_jobs j
      where j.id = v_source.source_line_id and j.company_id = v_dispatch.company_id
        and j.order_id = v_dispatch.order_id and j.profile_id = v_source.profile_id and j.status = 'completed'
      for update;
    end if;
    if not found or v_available.weight_kg is null or v_available.length_m is null or v_available.pieces is null then
      raise exception 'Dispatch source lacks exact kilograms, metres, or piece provenance';
    end if;

    select coalesce(sum(i.net_weight_kg), 0) weight_kg,
      coalesce(sum(i.net_length_m), 0) length_m, coalesce(sum(i.number_of_pieces), 0) pieces
    into v_used
    from public.packing_list_items i join public.dispatches d on d.id = i.dispatch_id and d.company_id = i.company_id
    where i.company_id = v_dispatch.company_id and i.source_line_id = v_source.source_line_id
      and i.dispatch_id <> p_dispatch_id and d.delivery_status <> 'pending';

    if v_used.weight_kg + v_source.weight_kg > v_available.weight_kg + 0.001
      or v_used.length_m + v_source.length_m > v_available.length_m + 0.001
      or v_used.pieces + v_source.pieces > v_available.pieces then
      raise exception 'Dispatch packing exceeds the source remaining weight, metre, or piece balance';
    end if;
  end loop;
end;
$function$


-- FN private.assert_finishing_material_lineage
CREATE OR REPLACE FUNCTION private.assert_finishing_material_lineage(p_company_id uuid, p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_job public.production_jobs%rowtype;
  v_input numeric;
  v_accepted numeric;
  v_rows bigint;
  v_reachable bigint;
begin
  select * into v_job from public.production_jobs where id=p_job_id and company_id=p_company_id;
  if not found or v_job.status<>'completed' or coalesce(v_job.actual_quantity_kg,0)<=0 then
    raise exception 'Finishing must reference captured completed production for this company';
  end if;
  if exists(select 1 from public.finishing_jobs f where f.company_id=p_company_id and f.production_job_id=p_job_id
    and (f.order_id is distinct from v_job.order_id or f.finishing_type is distinct from v_job.finishing_type
      or f.status is null or f.status not in ('planned','sent_to_vendor','in_process','received','completed','rejected','not_required')
      or coalesce(f.input_weight_kg,0)<=0 or coalesce(f.output_weight_kg,0)<0 or coalesce(f.rejection_weight_kg,0)<0
      or (f.status in ('completed','rejected') and (coalesce(f.output_weight_kg,0)+coalesce(f.rejection_weight_kg,0)>f.input_weight_kg+0.01
        or (coalesce(f.output_weight_kg,0)>0 and (f.received_date is null
          or f.received_date>(now() at time zone 'Asia/Kolkata')::date
          or (f.sent_date is not null and f.received_date<f.sent_date))))))) then
    raise exception 'Finishing source, receipt or quantity evidence needs review';
  end if;
  select coalesce(sum(input_weight_kg) filter(where retry_of_finishing_job_id is null),0),
    coalesce(sum(output_weight_kg) filter(where status in ('completed','rejected')),0),count(*)
  into v_input,v_accepted,v_rows from public.finishing_jobs where company_id=p_company_id and production_job_id=p_job_id;
  if v_input>v_job.actual_quantity_kg+0.001 or v_accepted>v_job.actual_quantity_kg+0.001 then
    raise exception 'Finishing root input or accepted output exceeds captured production';
  end if;
  if exists(select 1 from public.finishing_jobs child left join public.finishing_jobs parent on parent.id=child.retry_of_finishing_job_id
    where child.company_id=p_company_id and child.production_job_id=p_job_id and child.retry_of_finishing_job_id is not null
      and (parent.id is null or parent.company_id is distinct from child.company_id or parent.order_id is distinct from child.order_id
        or parent.production_job_id is distinct from child.production_job_id or parent.finishing_type is distinct from child.finishing_type
        or parent.status is distinct from 'rejected'
        or abs(child.input_weight_kg-least(coalesce(parent.rejection_weight_kg,0),greatest(parent.input_weight_kg-coalesce(parent.output_weight_kg,0),0)))>0.01))
    or exists(select 1 from public.finishing_jobs where company_id=p_company_id and production_job_id=p_job_id
      and retry_of_finishing_job_id is not null group by retry_of_finishing_job_id having count(*)>1) then
    raise exception 'Finishing corrective retry lineage or recoverable input needs review';
  end if;
  with recursive source_tree(id) as (
    select id from public.finishing_jobs where company_id=p_company_id and production_job_id=p_job_id and retry_of_finishing_job_id is null
    union
    select child.id from public.finishing_jobs child join source_tree parent on child.retry_of_finishing_job_id=parent.id
      where child.company_id=p_company_id and child.production_job_id=p_job_id
  ) select count(*) into v_reachable from source_tree;
  if v_reachable<>v_rows then raise exception 'Finishing retry lineage has no verified original source'; end if;
end;
$function$


-- FN private.assert_invoice_packing_coverage
CREATE OR REPLACE FUNCTION private.assert_invoice_packing_coverage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_invoice_id uuid;
  v_company_id uuid;
  v_dispatch_id uuid;
  v_packing_count integer;
  v_invoice_count integer;
  v_distinct_source_count integer;
begin
  if tg_op = 'DELETE' then
    v_invoice_id := old.invoice_id;
  else
    v_invoice_id := new.invoice_id;
  end if;

  select company_id, dispatch_id
  into v_company_id, v_dispatch_id
  from public.invoices
  where id = v_invoice_id;

  if not found then
    return null;
  end if;
  if v_dispatch_id is null then
    raise exception 'Invoice must remain linked to a dispatch';
  end if;

  select count(*)
  into v_packing_count
  from public.packing_list_items
  where company_id = v_company_id
    and dispatch_id = v_dispatch_id;

  select count(*), count(distinct source_line_id)
  into v_invoice_count, v_distinct_source_count
  from public.invoice_items
  where company_id = v_company_id
    and invoice_id = v_invoice_id;

  if v_packing_count = 0
    or v_invoice_count <> v_packing_count
    or v_distinct_source_count <> v_packing_count
  then
    raise exception 'Invoice must include every packing row from its dispatch exactly once';
  end if;

  return null;
end;
$function$


-- FN private.assign_billet_to_order
CREATE OR REPLACE FUNCTION private.assign_billet_to_order(p_billet_id uuid, p_order_id uuid, p_reallocate boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company uuid:=private.get_current_user_company_id();
  v_billet public.foundry_billets%rowtype;
  v_order public.orders%rowtype;
  v_req public.order_billet_requirements%rowtype;
  v_old_order uuid;
  v_updated integer;
begin
  if v_company is null or auth.uid() is null then raise exception 'Authentication required' using errcode='28000';end if;
  if coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'You do not have permission to allocate billets' using errcode='42501';end if;
  select * into v_billet from public.foundry_billets where id=p_billet_id and company_id=v_company;
  if not found then raise exception 'Billet not found' using errcode='23514';end if;
  if not p_reallocate and (v_billet.status is distinct from 'cast' or v_billet.order_id is not null
    or v_billet.allocation_requirement_id is not null or v_billet.production_job_id is not null) then
    raise exception 'Only unallocated cast billets without production linkage can be allocated manually' using errcode='23514';end if;
  if p_reallocate and (coalesce(v_billet.status,'') not in ('cast','allocated') or v_billet.production_job_id is not null) then
    raise exception 'Only cast or allocated billets not issued to production are available for reallocation' using errcode='23514';end if;
  v_old_order:=v_billet.order_id;
  -- Both entry points keep parent locks ordered before locking the billet row.
  perform 1 from public.orders where company_id=v_company and id in (p_order_id,v_old_order) order by id for update nowait;
  select * into v_billet from public.foundry_billets where id=p_billet_id and company_id=v_company for update nowait;
  if not found or v_billet.order_id is distinct from v_old_order or coalesce(v_billet.status,'') not in ('cast','allocated')
    or v_billet.production_job_id is not null then raise exception 'Billet allocation changed while this request was waiting' using errcode='23514';end if;
  if not p_reallocate and (v_billet.status<>'cast' or v_billet.order_id is not null or v_billet.allocation_requirement_id is not null) then
    raise exception 'Billet was allocated while this request was waiting' using errcode='23514';end if;
  if v_old_order is not null and not exists(select 1 from public.orders where id=v_old_order and company_id=v_company) then
    raise exception 'Existing billet allocation has inconsistent company/order evidence; review it before reallocation' using errcode='23514';end if;
  if v_billet.status='allocated' and v_old_order is null then
    raise exception 'Existing billet allocation is missing its source order; review it before reallocation' using errcode='23514';end if;
  if v_billet.allocation_requirement_id is not null and not exists(select 1 from public.order_billet_requirements r
    where r.id=v_billet.allocation_requirement_id and r.company_id=v_company and r.order_id=v_old_order
      and lower(btrim(coalesce(r.alloy,'')))=lower(btrim(coalesce(v_billet.alloy,'')))
      and lower(btrim(coalesce(r.temper,'')))=lower(btrim(coalesce(v_billet.temper,'')))
      and r.billet_diameter_inch=v_billet.billet_diameter_inch) then
    raise exception 'Existing billet allocation has inconsistent requirement evidence; review it before reallocation' using errcode='23514';end if;
  select * into v_order from public.orders where id=p_order_id and company_id=v_company;
  if not found then raise exception 'Order not found' using errcode='23514';end if;
  if v_order.current_stage in ('closed','cancelled','delivered','payment_pending') then
    raise exception 'This order is not open for billet allocation' using errcode='23514';end if;
  perform public.rebuild_order_billet_requirements(p_order_id);
  select r.* into v_req from public.order_billet_requirements r where r.company_id=v_company and r.order_id=p_order_id
    and lower(btrim(coalesce(r.alloy,'')))=lower(btrim(coalesce(v_billet.alloy,'')))
    and lower(btrim(coalesce(r.temper,'')))=lower(btrim(coalesce(v_billet.temper,'')))
    and r.billet_diameter_inch=v_billet.billet_diameter_inch and r.billets_allocated<r.billets_required and r.status<>'cancelled'
    and (v_order.current_stage<>'dispatched' or private.order_profile_needs_billet_allocation(v_company,p_order_id,r.profile_id))
    order by r.created_at,r.id limit 1 for update;
  if not found then
    if v_order.current_stage='dispatched' then
      raise exception 'This order has no remaining production eligible for a compatible billet requirement' using errcode='23514';end if;
    raise exception 'No open compatible requirement needs this billet; refresh the order allocation' using errcode='23514';
  end if;
  update public.foundry_billets set order_id=p_order_id,allocation_requirement_id=v_req.id,status='allocated',allocated_at=now(),allocated_by=auth.uid()
    where id=p_billet_id and company_id=v_company;
  get diagnostics v_updated=row_count;
  if v_updated<>1 then raise exception 'Billet allocation was not written; refresh and retry' using errcode='23514';end if;
  if v_old_order is not null and v_old_order<>p_order_id then perform public.refresh_order_billet_allocations(v_old_order);end if;
  perform public.refresh_order_billet_allocations(p_order_id);
  if exists(select 1 from public.orders where id=p_order_id and company_id=v_company and billet_allocation_status='complete') then
    perform public.notify_billet_allocation(v_company,'Billet requirement complete',concat('Order ',v_order.order_number,' has all required billets allocated and is ready for production.'),'success',p_order_id);
  end if;
  return v_req.id;
end;
$function$


-- FN private.assign_business_number
CREATE OR REPLACE FUNCTION private.assign_business_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_prefix text := tg_argv[1];
  v_number text;
  v_date date := coalesce(nullif(to_jsonb(new) ->> tg_argv[2], '')::date, (now() at time zone 'Asia/Kolkata')::date);
begin
  if tg_op = 'UPDATE' then
    if to_jsonb(new) ->> tg_argv[0] is distinct from to_jsonb(old) ->> tg_argv[0] then
      raise exception 'Business numbers are immutable after allocation';
    end if;
    return new;
  end if;
  if tg_table_name in ('quotes','orders','dispatches','invoices') then
    select coalesce(nullif(to_jsonb(s) ->> case tg_table_name when 'quotes' then 'quote_prefix' when 'orders' then 'order_prefix' when 'dispatches' then 'dispatch_prefix' else 'invoice_prefix' end, ''), tg_argv[1])
    into v_prefix from public.company_settings s where company_id = new.company_id;
    v_prefix := coalesce(v_prefix, tg_argv[1]);
  end if;
  v_number := private.next_business_number_locked(tg_relid::regclass, tg_argv[0], new.company_id, v_prefix, v_date);
  new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], v_number));
  return new;
end;
$function$


-- FN private.business_today
CREATE OR REPLACE FUNCTION private.business_today()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$ select (now() at time zone 'Asia/Kolkata')::date $function$


-- FN private.canonicalize_invoice_commercial_lineage
CREATE OR REPLACE FUNCTION private.canonicalize_invoice_commercial_lineage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order_item_id uuid;
  v_quote_item_id uuid;
  v_finish text;
  v_rate numeric(14,2);
begin
  select packing.order_item_id, packing.quote_item_id, packing.finishing_type, packing.net_rate
  into v_order_item_id, v_quote_item_id, v_finish, v_rate
  from public.packing_list_items packing
  join public.invoices invoice
    on invoice.company_id = packing.company_id
   and invoice.dispatch_id = packing.dispatch_id
  where packing.id = new.source_line_id
    and invoice.id = new.invoice_id;
  if not found then raise exception 'Invoice packing lineage is unavailable'; end if;

  new.order_item_id := v_order_item_id;
  new.quote_item_id := v_quote_item_id;
  new.finishing_type := v_finish;
  new.net_rate := v_rate;
  return new;
end;
$function$


-- FN private.canonicalize_invoice_packing_line
CREATE OR REPLACE FUNCTION private.canonicalize_invoice_packing_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid;
  v_dispatch_id uuid;
  v_packing public.packing_list_items%rowtype;
  v_expected_quantity numeric(14,3);
  v_expected_rate numeric(14,2);
  v_expected_total numeric(14,2);
begin
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'Invoice lines cannot be moved between invoices';
  end if;

  select company_id, dispatch_id
  into v_company_id, v_dispatch_id
  from public.invoices
  where id = new.invoice_id;

  if not found or v_dispatch_id is null then
    raise exception 'Invoice lines require a dispatch-backed invoice';
  end if;
  if new.source_line_id is null then
    raise exception 'Invoice line must identify its packing row';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'invoice-packing:' || new.invoice_id::text || ':' || new.source_line_id::text,
    0
  ));

  select *
  into v_packing
  from public.packing_list_items
  where id = new.source_line_id
    and company_id = v_company_id
    and dispatch_id = v_dispatch_id;

  if not found then
    raise exception 'Invoice line does not belong to the selected dispatch packing list';
  end if;

  v_expected_quantity := round(coalesce(
    nullif(v_packing.net_weight_kg, 0),
    nullif(v_packing.gross_weight_kg, 0),
    0
  ), 3);
  v_expected_rate := round(coalesce(nullif(v_packing.net_rate, 0), 0), 2);
  v_expected_total := round(v_expected_quantity * v_expected_rate, 2);

  if v_expected_quantity <= 0 or v_expected_rate <= 0 or v_expected_total <= 0 then
    raise exception 'Every packed line needs a positive shipped weight and commercial rate before invoicing';
  end if;
  if new.quantity is null or abs(new.quantity - v_expected_quantity) > 0.001
    or new.unit_rate is null or abs(new.unit_rate - v_expected_rate) > 0.01
    or new.line_total is null or abs(new.line_total - v_expected_total) > 0.01
  then
    raise exception 'Invoice quantity, rate, and total must match the immutable packing row';
  end if;
  if exists (
    select 1
    from public.invoice_items existing
    where existing.invoice_id = new.invoice_id
      and existing.source_line_id = v_packing.id
      and existing.id is distinct from new.id
  ) then
    raise exception 'A packing row can appear only once on an invoice';
  end if;

  new.company_id := v_company_id;
  new.source_record_id := v_dispatch_id;
  new.source_line_id := v_packing.id;
  new.profile_id := v_packing.profile_id;
  new.quantity := v_expected_quantity;
  new.unit_rate := v_expected_rate;
  new.line_total := v_expected_total;
  return new;
end;
$function$


-- FN private.canonicalize_invoice_supply
CREATE OR REPLACE FUNCTION private.canonicalize_invoice_supply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if tg_op = 'INSERT' or (old.status in ('draft','generated') and old.amount_paid = 0
    and (new.place_of_supply_state_code is distinct from old.place_of_supply_state_code
      or new.supplier_state_code is distinct from old.supplier_state_code
      or (old.supplier_state_code is null and new.place_of_supply_state_code is not null))) then
    select coalesce(nullif(gst_state_code, ''), substring(gst_number from '^([0-9]{2})'))
    into new.supplier_state_code from public.companies where id = new.company_id;
    if new.supplier_state_code is null or new.supplier_state_code !~ '^(0[1-9]|[12][0-9]|3[0-8])$'
      or new.place_of_supply_state_code is null or new.place_of_supply_state_code !~ '^(0[1-9]|[12][0-9]|3[0-8])$'
      or new.supplier_state_code in ('25','28') or new.place_of_supply_state_code in ('25','28') then
      raise exception 'Set the company GST state code and enter the domestic place-of-supply state code';
    end if;
  elsif new.supplier_state_code is distinct from old.supplier_state_code or new.place_of_supply_state_code is distinct from old.place_of_supply_state_code then
    raise exception 'Issued invoice supply states are immutable';
  end if;
  new.cgst_amount := 0; new.sgst_amount := 0; new.utgst_amount := 0; new.igst_amount := 0;
  if new.supplier_state_code = new.place_of_supply_state_code then
    new.cgst_amount := round(new.tax_total / 2, 2);
    if new.supplier_state_code in ('04','26','31','35','38') then
      new.utgst_amount := new.tax_total - new.cgst_amount;
    else
      new.sgst_amount := new.tax_total - new.cgst_amount;
    end if;
  elsif new.supplier_state_code is not null and new.place_of_supply_state_code is not null then
    new.igst_amount := new.tax_total;
  end if;
  return new;
end;
$function$


-- FN private.canonicalize_invoice_tax_line
CREATE OR REPLACE FUNCTION private.canonicalize_invoice_tax_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  select coalesce(nullif(oi.hsn_code, ''), nullif(qi.hsn_code, ''), nullif(p.hsn_code, '')),
    case when exists(select 1 from private.direct_order_requests request where request.order_id=oi.order_id and request.company_id=oi.company_id)
      then oi.gst_percent else coalesce(pl.gst_percent, oi.gst_percent, qi.gst_percent, q.gst_percent) end
  into new.hsn_code, new.gst_percent
  from public.packing_list_items pl
  left join public.order_items oi on oi.id = pl.order_item_id and oi.company_id = pl.company_id
  left join public.quote_items qi on qi.id = pl.quote_item_id and qi.company_id = pl.company_id
  left join public.quotes q on q.id = qi.quote_id and q.company_id = qi.company_id
  left join public.aluminium_profiles p on p.id = pl.profile_id and p.company_id = pl.company_id
  where pl.id = new.source_line_id and pl.company_id = new.company_id;
  if new.hsn_code is null or new.hsn_code !~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' then
    raise exception 'Set a valid HSN code on every invoiced profile';
  end if;
  if new.gst_percent is null or new.gst_percent < 0 or new.gst_percent > 100 then
    raise exception 'Every invoiced source line requires a valid GST rate';
  end if;
  return new;
end;
$function$


-- FN private.canonicalize_packing_commercial_lineage
CREATE OR REPLACE FUNCTION private.canonicalize_packing_commercial_lineage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_quote_item_id uuid;
  v_profile_id uuid;
  v_finish text;
  v_rate numeric(14,2);
  v_is_dealer_source boolean := false;
begin
  select company_id, order_id into v_company_id, v_order_id
  from public.dispatches where id = new.dispatch_id;
  if not found then raise exception 'Packing dispatch is unavailable'; end if;

  if new.source_kind = 'reservation' then
    select reservation.profile_id
    into v_profile_id
    from public.profile_stock_reservations reservation
    where reservation.id = new.reservation_id
      and reservation.company_id = v_company_id
      and reservation.order_id = v_order_id
      and reservation.profile_stock_batch_id = new.profile_stock_batch_id;
    if not found
       or new.source_line_id is distinct from new.reservation_id
       or new.source_record_id is distinct from v_order_id
       or new.profile_id is distinct from v_profile_id then
      raise exception 'Reserved-stock packing source does not match its order, profile, reservation, and stock batch';
    end if;
    new.company_id := v_company_id;
    return new;
  end if;

  select
    fulfillment.order_item_id,
    fulfillment.quote_item_id,
    fulfillment.profile_id,
    fulfillment.finishing_type,
    fulfillment.unit_rate
  into v_order_item_id, v_quote_item_id, v_profile_id, v_finish, v_rate
  from public.order_dealer_stock_fulfillments fulfillment
  where fulfillment.id = new.source_line_id
    and fulfillment.company_id = v_company_id
    and fulfillment.order_id = v_order_id;
  v_is_dealer_source := found;

  if not v_is_dealer_source then
    select
      order_item.id,
      coalesce(order_item.quote_item_id, quote_item.id),
      production.profile_id,
      coalesce(order_item.finishing_type, quote_item.finishing_type, production.finishing_type),
      coalesce(order_item.net_rate, quote_item.net_rate, quote_item.price_per_kg)
    into v_order_item_id, v_quote_item_id, v_profile_id, v_finish, v_rate
    from public.production_jobs production
    left join public.order_items order_item
      on order_item.id = production.source_line_id
     and order_item.company_id = production.company_id
     and order_item.order_id = production.order_id
    left join public.quote_items quote_item
      on quote_item.company_id = production.company_id
     and quote_item.id = coalesce(order_item.quote_item_id, production.source_line_id)
    where production.id = new.source_line_id
      and production.company_id = v_company_id
      and production.order_id = v_order_id;
    if not found then raise exception 'Packing source is unavailable for this order'; end if;
  end if;

  if new.source_record_id is distinct from v_order_id
     or new.profile_id is distinct from v_profile_id then
    raise exception 'Packing source does not match its order and profile';
  end if;
  if v_is_dealer_source and (
    v_order_item_id is null or v_quote_item_id is null
    or coalesce(nullif(btrim(v_finish), ''), '') = ''
    or coalesce(v_rate, 0) <= 0
  ) then
    raise exception 'Dealer-stock packing requires exact quote, order, finish, and rate lineage';
  end if;

  new.company_id := v_company_id;
  new.order_item_id := v_order_item_id;
  new.quote_item_id := v_quote_item_id;
  new.finishing_type := v_finish;
  new.net_rate := v_rate;
  return new;
end;
$function$


-- FN private.canonicalize_packing_tax
CREATE OR REPLACE FUNCTION private.canonicalize_packing_tax()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if new.order_item_id is not null then
    select gst_percent into new.gst_percent from public.order_items
    where id=new.order_item_id and company_id=new.company_id and profile_id=new.profile_id;
  elsif new.quote_item_id is not null then
    select coalesce(qi.gst_percent,q.gst_percent) into new.gst_percent
    from public.quote_items qi join public.quotes q on q.id=qi.quote_id and q.company_id=qi.company_id
    where qi.id=new.quote_item_id and qi.company_id=new.company_id and qi.profile_id=new.profile_id;
  else
    new.gst_percent := null;
  end if;
  if new.gst_percent is null or new.gst_percent < 0 or new.gst_percent > 100 then
    raise exception 'Packing requires an authoritative commercial source and GST rate';
  end if;
  return new;
end;
$function$


-- FN private.complete_production_job_atomic
CREATE OR REPLACE FUNCTION private.complete_production_job_atomic(p_job_id uuid, p_actual_weight_kg numeric, p_actual_pieces integer, p_actual_meters numeric, p_scrap_weight_kg numeric, p_remarks text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_job record;
  v_actual_meters numeric;
  v_linked_billet_count integer := 0;
  v_input_weight_kg numeric := 0;
  v_existing_scrap_kg numeric := 0;
  v_accounted_weight_kg numeric := 0;
  v_tolerance_kg numeric := 0;
  v_has_allocation_requirement boolean := false;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in (
    'owner', 'admin', 'factory_manager', 'production_manager', 'production'
  ) then
    raise exception 'Permission denied for production completion' using errcode = '42501';
  end if;

  select id, company_id, order_id, profile_id, die_id, status, pieces,
    length_per_piece_m, job_number, required_billet_count
  into v_job
  from public.production_jobs
  where id = p_job_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Production job not found for this company';
  end if;
  if v_job.status <> 'in_progress' then
    raise exception 'Start the production job before recording final output';
  end if;
  if coalesce(p_actual_weight_kg, 0) <= 0 then
    raise exception 'Actual output weight must be greater than zero';
  end if;
  if coalesce(p_actual_pieces, 0) < 0 then
    raise exception 'Actual pieces cannot be negative';
  end if;
  if coalesce(v_job.pieces, 0) > 0 and coalesce(p_actual_pieces, 0) <= 0 then
    raise exception 'Actual pieces are required for a piece-planned production job';
  end if;
  if coalesce(p_scrap_weight_kg, 0) < 0 then
    raise exception 'Scrap weight cannot be negative';
  end if;

  perform 1
  from public.foundry_billets
  where company_id = v_company_id
    and production_job_id = p_job_id
    and status in ('allocated', 'issued', 'consumed')
  for update;

  select count(*), coalesce(sum(weight_kg), 0)
  into v_linked_billet_count, v_input_weight_kg
  from public.foundry_billets
  where company_id = v_company_id
    and production_job_id = p_job_id
    and status in ('allocated', 'issued', 'consumed');

  select exists (
    select 1
    from public.order_billet_requirements requirement
    where requirement.company_id = v_company_id
      and requirement.order_id = v_job.order_id
      and requirement.profile_id = v_job.profile_id
      and requirement.billets_required > 0
      and requirement.status <> 'cancelled'
  ) into v_has_allocation_requirement;

  if v_linked_billet_count = 0 then
    if coalesce(v_job.required_billet_count, 0) > 0 or v_has_allocation_requirement then
      raise exception 'Allocate the required billets to this production job before completion'
        using errcode = '23514';
    end if;
  else
    if exists (
      select 1
      from public.scrap_records
      where company_id = v_company_id
        and production_job_id = p_job_id
        and weight_kg < 0
    ) then
      raise exception 'Production scrap records cannot contain negative weight'
        using errcode = '23514';
    end if;
    select coalesce(sum(weight_kg), 0)
    into v_existing_scrap_kg
    from public.scrap_records
    where company_id = v_company_id
      and production_job_id = p_job_id;

    v_accounted_weight_kg := round((
      p_actual_weight_kg + v_existing_scrap_kg + coalesce(p_scrap_weight_kg, 0)
    )::numeric, 3);
    v_tolerance_kg := greatest(0.5, round((v_input_weight_kg * 0.01)::numeric, 3));

    if abs(v_input_weight_kg - v_accounted_weight_kg) > v_tolerance_kg then
      raise exception 'Billet mass balance failed: linked input % kg, accounted output and scrap % kg, tolerance % kg',
        v_input_weight_kg, v_accounted_weight_kg, v_tolerance_kg
        using errcode = '23514';
    end if;
  end if;

  v_actual_meters := coalesce(
    p_actual_meters,
    case
      when coalesce(p_actual_pieces, 0) > 0 and coalesce(v_job.length_per_piece_m, 0) > 0
        then p_actual_pieces * v_job.length_per_piece_m
      else 0
    end
  );
  if v_actual_meters < 0 then
    raise exception 'Actual metres cannot be negative';
  end if;

  update public.production_jobs
  set actual_quantity_kg = p_actual_weight_kg,
      actual_pieces = coalesce(p_actual_pieces, 0),
      actual_meters = v_actual_meters,
      status = 'completed',
      remarks = case
        when coalesce(btrim(p_remarks), '') = '' then remarks
        when coalesce(btrim(remarks), '') = '' then btrim(p_remarks)
        else concat(remarks, E'\nCompletion: ', btrim(p_remarks))
      end,
      updated_at = now()
  where id = p_job_id and company_id = v_company_id;

  if coalesce(p_scrap_weight_kg, 0) > 0 then
    insert into public.scrap_records(
      company_id, order_id, production_job_id, profile_id, die_id,
      scrap_type, weight_kg, reason, recorded_date, recorded_by, notes
    ) values (
      v_company_id, v_job.order_id, v_job.id, v_job.profile_id, v_job.die_id,
      'process_scrap', p_scrap_weight_kg, 'Production completion loss',
      current_date, auth.uid(),
      concat('Recorded while completing ', coalesce(v_job.job_number, v_job.id::text))
    );
  end if;

  return p_job_id;
end;
$function$


-- FN private.consume_dispatch_reservations
CREATE OR REPLACE FUNCTION private.consume_dispatch_reservations(p_dispatch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_dispatch record;
  v_group record;
  v_reservation record;
  v_batch record;
  v_used record;
  v_existing public.profile_stock_consumptions%rowtype;
  v_remaining_weight numeric;
  v_remaining_length numeric;
  v_remaining_pieces integer;
begin
  select id, company_id, order_id into v_dispatch
  from public.dispatches where id = p_dispatch_id for update;
  if not found then raise exception 'Dispatch not found'; end if;

  for v_group in
    select reservation_id, profile_stock_batch_id, profile_id,
      round(sum(net_weight_kg), 3) consumed_weight_kg,
      round(sum(net_length_m), 3) consumed_length_m,
      sum(number_of_pieces)::integer consumed_pieces
    from public.packing_list_items
    where dispatch_id = p_dispatch_id and company_id = v_dispatch.company_id and source_kind = 'reservation'
    group by reservation_id, profile_stock_batch_id, profile_id
    order by reservation_id
  loop
    select * into v_reservation
    from public.profile_stock_reservations
    where id = v_group.reservation_id and company_id = v_dispatch.company_id and order_id = v_dispatch.order_id
    for update;
    if not found or v_reservation.profile_stock_batch_id is distinct from v_group.profile_stock_batch_id
      or v_reservation.profile_id is distinct from v_group.profile_id then
      raise exception 'Reservation is stale or no longer available for dispatch';
    end if;
    if v_reservation.reserved_pieces is null or v_reservation.initial_reserved_weight_kg is null
      or v_reservation.initial_reserved_length_m is null or v_reservation.initial_reserved_pieces is null then
      raise exception 'Legacy reservation lacks exact metre or piece provenance and cannot be consumed';
    end if;

    select * into v_existing from public.profile_stock_consumptions
    where company_id = v_dispatch.company_id and dispatch_id = p_dispatch_id and reservation_id = v_reservation.id
    for update;
    if found then
      if v_existing.order_id is distinct from v_dispatch.order_id
        or v_existing.profile_stock_batch_id is distinct from v_group.profile_stock_batch_id
        or v_existing.profile_id is distinct from v_group.profile_id
        or v_existing.consumed_weight_kg is distinct from v_group.consumed_weight_kg
        or v_existing.consumed_length_m is distinct from v_group.consumed_length_m
        or v_existing.consumed_pieces is distinct from v_group.consumed_pieces then
        raise exception 'Posted dispatch consumption is immutable';
      end if;
      -- Releasing the unconsumed remainder cannot invalidate an exact posted replay.
      continue;
    end if;

    if v_reservation.status is distinct from 'active' then
      raise exception 'Reservation is stale or no longer available for dispatch';
    end if;

    select coalesce(sum(consumed_weight_kg), 0) weight_kg,
      coalesce(sum(consumed_length_m), 0) length_m, coalesce(sum(consumed_pieces), 0) pieces
    into v_used
    from public.profile_stock_consumptions
    where reservation_id = v_reservation.id and company_id = v_dispatch.company_id and dispatch_id <> p_dispatch_id;
    if v_used.weight_kg + v_group.consumed_weight_kg > v_reservation.initial_reserved_weight_kg + 0.001
      or v_used.length_m + v_group.consumed_length_m > v_reservation.initial_reserved_length_m + 0.001
      or v_used.pieces + v_group.consumed_pieces > v_reservation.initial_reserved_pieces then
      raise exception 'Dispatch exceeds the reservation remaining weight, metre, or piece balance';
    end if;

    insert into public.profile_stock_consumptions (
      company_id, reservation_id, profile_stock_batch_id, profile_id, order_id, dispatch_id,
      consumed_weight_kg, consumed_length_m, consumed_pieces, notes, created_by
    ) values (
      v_dispatch.company_id, v_reservation.id, v_reservation.profile_stock_batch_id, v_reservation.profile_id,
      v_reservation.order_id, p_dispatch_id, v_group.consumed_weight_kg, v_group.consumed_length_m,
      v_group.consumed_pieces, 'Consumed from operator-verified packing ledger', auth.uid()
    );

    select * into v_batch from public.profile_stock_batches
    where id = v_reservation.profile_stock_batch_id and company_id = v_dispatch.company_id for update;
    if not found or v_batch.total_weight_kg + 0.001 < v_group.consumed_weight_kg
      or v_batch.length_m + 0.001 < v_group.consumed_length_m
      or v_batch.quantity_pieces < v_group.consumed_pieces then
      raise exception 'Reserved stock batch no longer contains the exact dispatched quantity';
    end if;

    v_remaining_weight := round(v_reservation.initial_reserved_weight_kg - v_used.weight_kg - v_group.consumed_weight_kg, 3);
    v_remaining_length := round(v_reservation.initial_reserved_length_m - v_used.length_m - v_group.consumed_length_m, 3);
    v_remaining_pieces := v_reservation.initial_reserved_pieces - v_used.pieces - v_group.consumed_pieces;

    update public.profile_stock_batches set
      total_weight_kg = round(greatest(total_weight_kg - v_group.consumed_weight_kg, 0), 3),
      length_m = round(greatest(length_m - v_group.consumed_length_m, 0), 3),
      quantity_pieces = greatest(quantity_pieces - v_group.consumed_pieces, 0),
      status = case when total_weight_kg - v_group.consumed_weight_kg <= 0.001 then 'dispatched' else 'reserved' end
    where id = v_batch.id and company_id = v_dispatch.company_id;

    if v_remaining_weight <= 0.001 and v_remaining_length <= 0.001 and v_remaining_pieces = 0 then
      update public.profile_stock_reservations set status = 'consumed', released_at = now()
      where id = v_reservation.id and company_id = v_dispatch.company_id;
    end if;
  end loop;
end;
$function$


-- FN private.convert_quote_to_order_atomic
CREATE OR REPLACE FUNCTION private.convert_quote_to_order_atomic(p_quote_id uuid, p_order jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_quote public.quotes%rowtype;
  v_existing_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_order jsonb;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner','admin','sales','sales_manager') then
    raise exception 'Permission denied for quote conversion' using errcode = '42501';
  end if;

  select * into v_quote
  from public.quotes
  where id = p_quote_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Quote not found for this company'; end if;

  select id into v_existing_id
  from public.orders
  where company_id = v_company_id and quote_id = p_quote_id
  order by created_at
  limit 1;
  if v_existing_id is not null then return v_existing_id; end if;

  if v_quote.status not in ('customer_approved', 'approved_for_sending') then
    raise exception 'Only approved/customer-approved quotes can be converted to orders';
  end if;
  if not exists (
    select 1 from public.quote_items where company_id = v_company_id and quote_id = p_quote_id
  ) then
    raise exception 'Quote has no line items to convert';
  end if;
  if exists (
    select 1 from public.quote_items
    where company_id = v_company_id and quote_id = p_quote_id
      and coalesce(drawing_approval_status, 'Pending') <> 'Approved'
  ) then
    raise exception 'Every quote line requires an approved drawing before conversion';
  end if;

  v_order := private.keep_jsonb_keys(p_order, array['order_date','priority','order_value'])
    || jsonb_build_object(
      'company_id', v_company_id,
      'quote_id', p_quote_id,
      'customer_id', v_quote.customer_id,
      'dealer_id', coalesce(private.get_current_user_dealer_id(), v_quote.dealer_id),
      'current_stage', 'order_confirmed',
      'created_by', auth.uid()
    );
  v_order := v_order || jsonb_build_object(
    'order_number', private.next_business_number_locked(
      'public.orders'::regclass,
      'order_number',
      v_company_id,
      'O',
      coalesce(nullif(v_order ->> 'order_date', '')::date, current_date)
    )
  );
  v_order_id := private.insert_jsonb_row('public.orders'::regclass, v_order);

  for v_item in
    select to_jsonb(qi) from public.quote_items qi
    where qi.company_id = v_company_id and qi.quote_id = p_quote_id
    order by qi.created_at
  loop
    perform private.insert_jsonb_row(
      'public.order_items'::regclass,
      (v_item - array['id','company_id','order_id','created_at','updated_at'])
        || jsonb_build_object(
          'company_id', v_company_id,
          'order_id', v_order_id,
          'source_record_id', p_quote_id,
          'source_line_id', (v_item ->> 'id')::uuid,
          'quote_item_id', (v_item ->> 'id')::uuid,
          'created_at', now(),
          'updated_at', now()
        )
    );
  end loop;

  update public.quotes
  set status = 'converted_to_order', updated_at = now()
  where id = p_quote_id and company_id = v_company_id;
  return v_order_id;
end;
$function$


-- FN private.create_dealer_order_atomic
CREATE OR REPLACE FUNCTION private.create_dealer_order_atomic(p_dealer_id uuid, p_priority text, p_delivery_address text, p_expected_delivery_date date, p_notes text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_user_id uuid := auth.uid();
  v_role text := private.get_current_user_role();
  v_context_dealer_id uuid := private.get_current_user_dealer_id();
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
begin
  if v_company_id is null or v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner','admin','sales_manager','sales','factory_manager','dealer_admin','dealer_staff') then
    raise exception 'Permission denied to create dealer orders' using errcode = '42501';
  end if;
  if p_dealer_id is null or not exists (
    select 1 from public.dealers
    where id = p_dealer_id and company_id = v_company_id and is_active = true
  ) then
    raise exception 'Dealer assignment is not available for this company' using errcode = '23514';
  end if;
  if v_context_dealer_id is not null and v_context_dealer_id <> p_dealer_id then
    raise exception 'Dealer users can only create orders for their own dealership' using errcode = '42501';
  end if;
  if coalesce(p_priority, 'normal') not in ('low','normal','high','urgent') then
    raise exception 'Invalid dealer order priority' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A dealer order requires at least one line item' using errcode = '23514';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if nullif(btrim(v_item ->> 'item_description'), '') is null
       or coalesce((v_item ->> 'quantity')::numeric, 0) <= 0
       or (v_item ->> 'item_type') not in ('profile','hardware','accessory','glass','gasket','fastener','other')
       or (v_item ->> 'unit') not in ('pieces','meters','kg','set','box') then
      raise exception 'Dealer order contains an invalid line item' using errcode = '23514';
    end if;
    if nullif(v_item ->> 'inventory_item_id', '') is not null and not exists (
      select 1 from public.inventory_items
      where id = (v_item ->> 'inventory_item_id')::uuid and company_id = v_company_id
    ) then
      raise exception 'Dealer order line inventory item is not available for this company' using errcode = '23514';
    end if;
  end loop;

  v_order_number := private.next_business_number_locked(
    'public.dealer_orders'::regclass, 'order_number', v_company_id, 'DO', current_date
  );

  insert into public.dealer_orders (
    company_id, dealer_id, order_number, created_by_dealer_user_id,
    priority, delivery_address, expected_delivery_date, notes, status
  ) values (
    v_company_id, p_dealer_id, v_order_number, v_user_id,
    coalesce(p_priority, 'normal'), p_delivery_address, p_expected_delivery_date,
    p_notes, 'dealer_order_submitted'
  ) returning id into v_order_id;

  insert into public.dealer_order_items (
    company_id, dealer_order_id, inventory_item_id, item_type, item_description,
    quantity, unit, finish, size_description, system_type
  )
  select v_company_id, v_order_id,
    nullif(line ->> 'inventory_item_id', '')::uuid,
    line ->> 'item_type', line ->> 'item_description',
    (line ->> 'quantity')::numeric, line ->> 'unit',
    nullif(line ->> 'finish', ''), nullif(line ->> 'size_description', ''),
    nullif(line ->> 'system_type', '')
  from jsonb_array_elements(p_items) as line;

  insert into public.dealer_order_status_history (
    company_id, dealer_order_id, new_status, changed_by, notes
  ) values (v_company_id, v_order_id, 'dealer_order_submitted', v_user_id, p_notes);

  insert into public.notifications (
    company_id, dealer_id, recipient_role, notification_type, severity, title,
    body, related_entity_type, related_entity_id, entity_reference, action_link, created_by
  ) values (
    v_company_id, p_dealer_id, 'factory_manager', 'dealer_order_submitted', 'info',
    'New dealer order submitted', v_order_number || ' is waiting for factory review.',
    'dealer_order', v_order_id, v_order_number, '/dealer-orders/' || v_order_id::text, v_user_id
  );

  insert into public.audit_logs_enterprise (
    company_id, actor_user_id, actor_role, actor_company_id, actor_dealer_id,
    action_type, module_name, entity_type, entity_id, new_value, change_summary
  ) values (
    v_company_id, v_user_id, v_role, v_company_id, v_context_dealer_id,
    'dealer_order_submitted', 'dealer_orders', 'dealer_order', v_order_id,
    jsonb_build_object('orderNumber', v_order_number, 'items', p_items),
    v_order_number || ' submitted as a dealer order'
  );

  return jsonb_build_object('id', v_order_id, 'order_number', v_order_number, 'status', 'dealer_order_submitted');
end;
$function$


-- FN private.create_dealer_order_from_order_atomic
CREATE OR REPLACE FUNCTION private.create_dealer_order_from_order_atomic(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_user_dealer_id uuid := private.get_current_user_dealer_id();
  v_order public.orders%rowtype;
  v_quote public.quotes%rowtype;
  v_dealer_id uuid;
  v_dealer_order public.dealer_orders%rowtype;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','sales','sales_manager','factory_manager','dealer_admin','dealer_staff') then
    raise exception 'Permission denied for dealer orders' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id and company_id = v_company_id for update;
  if not found then raise exception 'Order not found for this company'; end if;
  if v_order.quote_id is not null then
    select * into v_quote from public.quotes where id = v_order.quote_id and company_id = v_company_id;
  end if;
  if v_user_dealer_id is not null
     and not (v_order.dealer_id = v_user_dealer_id
       or v_quote.dealer_id = v_user_dealer_id
       or v_order.created_by = auth.uid()
       or v_quote.created_by = auth.uid()) then
    raise exception 'Dealer users can only link their own orders' using errcode = '42501';
  end if;
  v_dealer_id := coalesce(v_order.dealer_id, v_quote.dealer_id, v_user_dealer_id);
  if v_dealer_id is null then raise exception 'Dealer assignment is required'; end if;
  if v_user_dealer_id is not null and v_dealer_id <> v_user_dealer_id then
    raise exception 'Dealer users can only link their own orders' using errcode = '42501';
  end if;

  select * into v_dealer_order
  from public.dealer_orders
  where company_id = v_company_id and linked_order_id = p_order_id
  order by created_at
  limit 1;
  if found then
    return jsonb_build_object('id', v_dealer_order.id, 'order_number', v_dealer_order.order_number, 'status', v_dealer_order.status);
  end if;

  update public.orders set dealer_id = v_dealer_id, updated_at = now()
  where id = p_order_id and company_id = v_company_id;
  if v_order.quote_id is not null then
    update public.quotes set dealer_id = v_dealer_id, updated_at = now()
    where id = v_order.quote_id and company_id = v_company_id and dealer_id is null;
  end if;

  insert into public.dealer_orders (
    company_id, dealer_id, linked_order_id, quote_id, order_number,
    created_by_dealer_user_id, priority, expected_delivery_date, notes, status
  ) values (
    v_company_id, v_dealer_id, p_order_id, v_order.quote_id, v_order.order_number,
    auth.uid(), coalesce(v_order.priority, 'normal'), v_order.expected_dispatch_date,
    v_order.notes, 'dealer_order_submitted'
  ) returning * into v_dealer_order;

  if v_order.quote_id is not null then
    insert into public.dealer_order_items (
      company_id, dealer_order_id, item_type, item_description, quantity, unit, finish
    )
    select
      v_company_id,
      v_dealer_order.id,
      'profile',
      coalesce(nullif(qi.item_description, ''), nullif(concat_ws(' - ', p.profile_code, p.profile_name), ''), 'Profile item'),
      coalesce(nullif(coalesce(qi.billing_weight_kg, qi.total_weight_kg), 0), nullif(qi.total_meters, 0), nullif(qi.quantity_pieces, 0), 1),
      case when coalesce(qi.billing_weight_kg, qi.total_weight_kg, 0) > 0 then 'kg'
           when coalesce(qi.total_meters, 0) > 0 then 'meters' else 'pieces' end,
      qi.finishing_type
    from public.quote_items qi
    left join public.aluminium_profiles p on p.id = qi.profile_id and p.company_id = v_company_id
    where qi.company_id = v_company_id and qi.quote_id = v_order.quote_id;
  end if;

  insert into public.dealer_order_status_history (
    company_id, dealer_order_id, new_status, changed_by, notes
  ) values (
    v_company_id, v_dealer_order.id, 'dealer_order_submitted', auth.uid(), 'Created from dealer quote order'
  );
  return jsonb_build_object('id', v_dealer_order.id, 'order_number', v_dealer_order.order_number, 'status', v_dealer_order.status);
end;
$function$


-- FN private.create_direct_order_atomic
CREATE OR REPLACE FUNCTION private.create_direct_order_atomic(p_order jsonb, p_items jsonb, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company uuid := private.get_current_user_company_id();
  v_actor uuid := auth.uid();
  v_role text := private.get_current_user_role();
  v_organization text;
  v_customer uuid;
  v_date date;
  v_expected date;
  v_header jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_snapshots jsonb := '[]'::jsonb;
  v_materials jsonb := '[]'::jsonb;
  v_line jsonb;
  v_numeric text;
  v_profile public.aluminium_profiles%rowtype;
  v_die public.dies%rowtype;
  v_profile_id uuid;
  v_die_id uuid;
  v_pieces numeric;
  v_length numeric;
  v_rate numeric;
  v_gst numeric;
  v_metres numeric;
  v_kg numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_weight numeric := 0;
  v_total numeric := 0;
  v_request jsonb;
  v_prior private.direct_order_requests%rowtype;
  v_order uuid := gen_random_uuid();
  v_number text;
  v_signature text;
  v_label text;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if v_role is null or v_role not in ('owner','admin','sales_manager','sales')
    or private.get_current_user_dealer_id() is not null then
    raise exception 'Direct priced orders require an internal owner, admin or sales role' using errcode='42501';
  end if;
  if p_idempotency_key is null then raise exception 'A retry key is required' using errcode='22023'; end if;
  if jsonb_typeof(p_order) is distinct from 'object' or (p_order - array['customer_id','order_date','expected_dispatch_date','priority','notes']) <> '{}'::jsonb
    or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Enter order details and priced profile lines only' using errcode='22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Enter between 1 and 100 priced profile lines' using errcode='22023'; end if;
  v_customer := nullif(p_order->>'customer_id','')::uuid;
  if v_customer is null or coalesce(p_order->>'order_date','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_order->>'priority','') not in ('low','normal','high','urgent')
    or (p_order->>'notes' is not null and jsonb_typeof(p_order->'notes') <> 'string')
    or length(btrim(coalesce(p_order->>'notes',''))) > 2000 then
    raise exception 'Check the customer, dates, priority and notes' using errcode='22023';
  end if;
  v_date := (p_order->>'order_date')::date;
  if nullif(p_order->>'expected_dispatch_date','') is not null then
    if (p_order->>'expected_dispatch_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter a valid expected dispatch date'; end if;
    v_expected := (p_order->>'expected_dispatch_date')::date;
    if v_expected < v_date then raise exception 'Expected dispatch cannot be before the order date'; end if;
  end if;
  v_header := jsonb_build_object('customer_id',v_customer,'order_date',v_date,'expected_dispatch_date',v_expected,
    'priority',p_order->>'priority','notes',btrim(coalesce(p_order->>'notes','')));
  for v_line in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_line) is distinct from 'object'
      or (v_line - array['profile_id','die_id','quantity_pieces','length_per_piece_m','expected_section_weight_kg_per_m','net_rate','gst_percent','hsn_code','finishing_type']) <> '{}'::jsonb then
      raise exception 'Each line must contain profile, dimensions, agreed rate, GST, HSN and finish only';
    end if;
    foreach v_numeric in array array['quantity_pieces','length_per_piece_m','expected_section_weight_kg_per_m','net_rate','gst_percent'] loop
      if jsonb_typeof(v_line->v_numeric) is distinct from 'number' then raise exception 'Line quantities, rates and GST must be finite numbers'; end if;
    end loop;
    v_profile_id := nullif(v_line->>'profile_id','')::uuid;
    v_die_id := nullif(v_line->>'die_id','')::uuid;
    v_pieces := (v_line->>'quantity_pieces')::numeric;
    v_length := (v_line->>'length_per_piece_m')::numeric;
    v_rate := (v_line->>'net_rate')::numeric;
    v_gst := (v_line->>'gst_percent')::numeric;
    if v_profile_id is null or v_pieces not between 1 and 1000000 or v_pieces <> trunc(v_pieces)
      or v_length not between 0.001 and 1000 or v_length <> round(v_length,3)
      or v_rate not between 0.01 and 10000000 or v_rate <> round(v_rate,2)
      or (v_line->>'expected_section_weight_kg_per_m')::numeric not between 0.001 and 10000
      or (v_line->>'expected_section_weight_kg_per_m')::numeric <> round((v_line->>'expected_section_weight_kg_per_m')::numeric,3)
      or v_gst not between 0 and 100 or v_gst <> round(v_gst,2)
      or jsonb_typeof(v_line->'hsn_code') is distinct from 'string'
      or btrim(coalesce(v_line->>'hsn_code','')) !~ '^(\d{4}|\d{6}|\d{8})$'
      or coalesce(v_line->>'finishing_type','') not in ('mill_finish','powder_coating','anodizing','anodized_silver','anodized_bronze','anodized_black','wood_finish','wood_grain','pvdf','other') then
      raise exception 'Check each line: whole pieces, positive length/rate, GST, HSN and finish';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('profile_id',v_profile_id,'die_id',v_die_id,
      'quantity_pieces',v_pieces,'length_per_piece_m',v_length,'net_rate',v_rate,'gst_percent',v_gst,
      'expected_section_weight_kg_per_m',(v_line->>'expected_section_weight_kg_per_m')::numeric,
      'hsn_code',btrim(v_line->>'hsn_code'),'finishing_type',v_line->>'finishing_type'));
  end loop;
  v_request := jsonb_build_object('order',v_header,'items',v_lines);
  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':direct-order:'||p_idempotency_key::text,0));
  select * into v_prior from private.direct_order_requests where company_id=v_company and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_payload is distinct from v_request then
      raise exception 'This retry key already belongs to different order details. Restore the submitted details and retry to review the existing order.' using errcode='23514';
    end if;
    if not v_prior.completed or not exists(select 1 from public.orders where id=v_prior.order_id and company_id=v_company) then
      raise exception 'The original order confirmation needs review';
    end if;
    return v_prior.order_id;
  end if;

  perform 1 from public.customers where id=v_customer and company_id=v_company and deleted_at is null for share;
  if not found then raise exception 'Customer not found for this company' using errcode='42501'; end if;
  select organization_type into v_organization from public.app_users where id=v_actor and company_id=v_company;
  -- Re-read and lock master data; caller-supplied totals and company IDs are never accepted.
  for v_line in select value from jsonb_array_elements(v_lines) loop
    select * into v_profile from public.aluminium_profiles where id=(v_line->>'profile_id')::uuid and company_id=v_company and deleted_at is null for share;
    if not found or v_profile.is_active is distinct from true then raise exception 'Select an active profile from this company'; end if;
    if v_profile.section_weight_kg_per_m is null or v_profile.section_weight_kg_per_m not between 0.001 and 10000
      or nullif(btrim(v_profile.alloy),'') is null or nullif(btrim(v_profile.temper),'') is null
      or coalesce(v_profile.billet_diameter_required_inch,0) <= 0 then
      raise exception 'Complete the profile section weight, alloy, temper and billet diameter before creating a direct order';
    end if;
    if v_profile.section_weight_kg_per_m is distinct from (v_line->>'expected_section_weight_kg_per_m')::numeric then
      raise exception 'The profile section weight changed. Refresh the profile selection and review the line values before creating the order.';
    end if;
    v_die_id := (v_line->>'die_id')::uuid;
    if v_die_id is not null then
      select * into v_die from public.dies where id=v_die_id and company_id=v_company and deleted_at is null for share;
      if not found or v_die.profile_id is distinct from v_profile.id or v_die.die_status not in ('active','approved') or v_die.die_status is null
        or (v_die.billet_diameter_required_inch is not null and v_die.billet_diameter_required_inch <> v_profile.billet_diameter_required_inch) then
        raise exception 'Select an active, compatible die for this profile';
      end if;
    end if;
    v_metres := round((v_line->>'quantity_pieces')::numeric*(v_line->>'length_per_piece_m')::numeric,3);
    v_kg := round(v_metres*v_profile.section_weight_kg_per_m,3);
    v_subtotal := round(v_kg*(v_line->>'net_rate')::numeric,2);
    v_tax := round(v_subtotal*(v_line->>'gst_percent')::numeric/100,2);
    if v_kg <= 0 or v_kg > 99999999.999 or v_subtotal <= 0 or v_subtotal+v_tax > 999999999999.99 then
      raise exception 'This line is too small or too large to bill. Check its pieces, length and rate.';
    end if;
    v_weight := v_weight+v_kg;
    v_total := v_total+v_subtotal+v_tax;
    v_materials := v_materials || jsonb_build_array(jsonb_build_object('profile_id',v_profile.id,
      'alloy',btrim(v_profile.alloy),'temper',btrim(v_profile.temper),'billet_diameter_inch',v_profile.billet_diameter_required_inch,'weight_kg',v_kg));
    v_snapshots := v_snapshots || jsonb_build_array((v_line-'expected_section_weight_kg_per_m') || jsonb_build_object('section_weight_kg_per_m',v_profile.section_weight_kg_per_m,
      'total_meters',v_metres,'quantity_kg',v_kg,'manufacturing_weight_kg',v_kg,'dealer_fulfilled_weight_kg',0,
      'final_line_value',v_subtotal,'order_uom','kg','order_quantity',v_kg,'invoice_calc_uom','kg',
      'cut_length',(v_line->>'length_per_piece_m')::numeric,'section_code',v_profile.profile_code,
      'section_number',v_profile.section_number,'section_name',v_profile.profile_name,'item_description',v_profile.profile_name,
      'drawing_revision',v_profile.drawing_revision,'drawing_approval_status',case lower(v_profile.drawing_approval_status)
        when 'approved' then 'Approved' when 'rejected' then 'Rejected' else 'Pending' end,
      'alloy_standard_id',v_profile.alloy_standard_id,'alloy_id',v_profile.alloy_id,'temper_id',v_profile.temper_id));
  end loop;
  if v_total > 999999999999.99 or v_weight > 99999999.999 then raise exception 'The combined order exceeds the supported value or weight'; end if;
  insert into private.direct_order_requests(company_id,idempotency_key,order_id,request_payload,material_snapshot,transaction_id,actor_id)
    values(v_company,p_idempotency_key,v_order,v_request,v_materials,txid_current(),v_actor);
  v_number := private.next_business_number_locked('public.orders'::regclass,'order_number',v_company,'O',v_date);
  insert into public.orders(id,company_id,customer_id,quote_id,dealer_id,order_number,order_date,expected_dispatch_date,priority,current_stage,
    order_value,requested_weight_kg,manufacturing_weight_kg,dealer_fulfilled_weight_kg,notes,created_by,created_by_user_id,created_by_role,created_by_organization_type,order_origin)
    values(v_order,v_company,v_customer,null,null,v_number,v_date,v_expected,v_header->>'priority','order_confirmed',
      0,v_weight,v_weight,0,nullif(v_header->>'notes',''),v_actor,v_actor,v_role,v_organization,'FACTORY_DIRECT');
  for v_line in select value from jsonb_array_elements(v_snapshots) loop
    perform private.insert_jsonb_row('public.order_items'::regclass,v_line || jsonb_build_object('company_id',v_company,'order_id',v_order));
  end loop;
  perform public.rebuild_order_billet_requirements(v_order);
  if v_weight < 700 then
    select string_agg(signature_part,',' order by signature_part),string_agg(label_part,', ' order by signature_part)
      into v_signature,v_label from (select distinct
        concat_ws('|',upper(alloy),upper(temper),billet_diameter_inch::text) signature_part,
        concat_ws(' / ',alloy,temper,billet_diameter_inch::text||' in') label_part
        from public.order_billet_requirements where company_id=v_company and order_id=v_order and required_weight_kg>0) material;
    insert into public.factory_load_consolidations(company_id,order_id,manufacturing_weight_kg,compatibility_signature,compatibility_label,status,created_by)
      values(v_company,v_order,v_weight,coalesce(v_signature,'ORDER:'||v_order::text),coalesce(v_label,'Material requirement not captured'),'pending',v_actor);
  end if;
  if v_role in ('owner','admin') then perform public.allocate_billets_by_priority(v_company); end if;
  insert into public.order_stage_history(company_id,order_id,stage,changed_by,remarks)
    values(v_company,v_order,'order_confirmed',v_actor,case when v_weight<700 then 'Direct priced order; waiting for factory load consolidation' else 'Direct priced order created' end);
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,metadata_json)
    values(v_company,v_actor,'direct_order_created','order',v_order,jsonb_build_object('source','direct','line_count',jsonb_array_length(v_lines),'weight_kg',v_weight));
  update private.direct_order_requests set completed=true where company_id=v_company and idempotency_key=p_idempotency_key;
  return v_order;
end;
$function$


-- FN private.create_order_from_quote_with_dealer_stock
CREATE OR REPLACE FUNCTION private.create_order_from_quote_with_dealer_stock(p_quote_id uuid, p_order_number text, p_order_date date, p_expected_dispatch_date date, p_priority text, p_dealer_fulfilled_weight_kg numeric, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_user_id uuid := auth.uid();
  v_user_role text := private.get_current_user_role();
  v_user_dealer_id uuid := private.get_current_user_dealer_id();
  v_user_org_type text;
  v_quote public.quotes%rowtype;
  v_dealer_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_requested_weight numeric(14,3);
  v_available_dealer_weight numeric(14,3) := 0;
  v_dealer_weight numeric(14,3);
  v_manufacturing_weight numeric(14,3);
  v_stage text;
  v_fulfillment_notes text;
  v_remaining_dealer_weight numeric(14,3);
  v_line record;
  v_line_remaining numeric(14,3);
  v_batch record;
  v_reserved_weight numeric(14,3);
  v_available_weight numeric(14,3);
  v_consume_weight numeric(14,3);
  v_new_batch_weight numeric(14,3);
  v_new_piece_count integer;
  v_consumed_pieces integer;
  v_consumed_length numeric(14,3);
  v_order_origin text;
begin
  if v_company_id is null or v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if v_user_role is null or v_user_role not in ('owner','admin','sales','sales_manager','dealer_admin','dealer_staff') then
    raise exception 'Permission denied for quote conversion' using errcode = '42501';
  end if;

  p_order_number := private.next_business_number_locked('public.orders'::regclass, 'order_number', v_company_id, 'O', coalesce(p_order_date, (now() at time zone 'Asia/Kolkata')::date));
  select organization_type into v_user_org_type
  from public.app_users where id = v_user_id;

  select * into v_quote
  from public.quotes
  where id = p_quote_id and company_id = v_company_id and deleted_at is null
  for update;
  if not found then raise exception 'Quote not found' using errcode = '23514'; end if;
  if v_quote.status is distinct from 'customer_approved' then
    raise exception 'Only a customer-approved quote can become an order' using errcode = '23514';
  end if;
  if v_user_role in ('dealer_admin','dealer_staff')
     and (v_user_dealer_id is null or v_quote.dealer_id is distinct from v_user_dealer_id) then
    raise exception 'Dealer users can only convert their own quotations' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.orders
    where company_id = v_company_id and quote_id = p_quote_id
  ) then
    raise exception 'This quote is already linked to an order' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.orders
    where company_id = v_company_id and order_number = p_order_number
  ) then
    raise exception 'Order number already exists' using errcode = '23505';
  end if;

  select round(coalesce(sum(coalesce(billing_weight_kg, total_weight_kg, 0)), 0), 3)
  into v_requested_weight
  from public.quote_items
  where quote_id = p_quote_id and company_id = v_company_id;
  if v_requested_weight <= 0 then
    raise exception 'Quote has no billable profile weight' using errcode = '23514';
  end if;

  v_dealer_id := coalesce(v_user_dealer_id, v_quote.dealer_id);
  if v_dealer_id is not null then
    v_available_dealer_weight := public.get_dealer_quote_stock_availability(p_quote_id);
  end if;

  v_dealer_weight := round(greatest(coalesce(p_dealer_fulfilled_weight_kg, 0), 0), 3);
  if v_dealer_weight > 0 and v_dealer_id is null then
    raise exception 'Dealer assignment is required before consuming dealer stock' using errcode = '23514';
  end if;
  if v_dealer_weight > v_requested_weight then
    raise exception 'Dealer fulfilled weight cannot exceed quote weight' using errcode = '23514';
  end if;
  if v_dealer_weight > v_available_dealer_weight + 0.001 then
    raise exception 'Only % kg of finish-compatible, unreserved dealer stock is available',
      v_available_dealer_weight using errcode = '23514';
  end if;

  v_manufacturing_weight := round(v_requested_weight - v_dealer_weight, 3);

  v_stage := case when v_manufacturing_weight >= 700 then 'extrusion_planned' else 'order_confirmed' end;
  v_fulfillment_notes := case
    when v_dealer_weight > 0 then format(
      'Dealer stock fulfilled %s kg from exact quote lines and finish-compatible unreserved batches. Factory balance %s kg.',
      v_dealer_weight,
      v_manufacturing_weight
    )
    else format('Factory manufacturing weight %s kg.', v_manufacturing_weight)
  end;
  v_order_origin := case
    when v_user_dealer_id is not null and v_user_role = 'dealer_admin' then 'DEALER_ADMIN_CREATED'
    when v_user_dealer_id is not null then 'DEALER_EMPLOYEE_CREATED'
    else 'FACTORY_DIRECT'
  end;

  insert into private.quote_fulfillment_authorizations(transaction_id,company_id,quote_id,actor_id)
  values(txid_current(),v_company_id,p_quote_id,v_user_id);

  insert into public.orders (
    company_id, dealer_id, order_number, quote_id, customer_id, order_date,
    expected_dispatch_date, priority, current_stage, order_value,
    requested_weight_kg, dealer_fulfilled_weight_kg, manufacturing_weight_kg,
    fulfillment_notes, notes, created_by, created_by_user_id, created_by_role,
    created_by_organization_type, created_by_dealership_id, order_origin
  ) values (
    v_company_id, v_dealer_id, p_order_number, p_quote_id, v_quote.customer_id, p_order_date,
    p_expected_dispatch_date, p_priority, v_stage, coalesce(v_quote.grand_total, 0),
    v_requested_weight, 0, v_requested_weight,
    v_fulfillment_notes,
    nullif(concat_ws(E'\n', nullif(p_notes, ''), v_fulfillment_notes), ''),
    v_user_id, v_user_id, v_user_role, v_user_org_type, v_dealer_id, v_order_origin
  ) returning id into v_order_id;

  for v_line in
    select item.*, round(coalesce(item.billing_weight_kg, item.total_weight_kg, 0), 3) as required_weight_kg
    from public.quote_items item
    where item.company_id = v_company_id and item.quote_id = p_quote_id
    order by item.created_at, item.id
  loop
    v_order_item_id := private.insert_jsonb_row(
      'public.order_items'::regclass,
      (to_jsonb(v_line) - array['id','company_id','quote_id','created_at','updated_at','required_weight_kg'])
        || jsonb_build_object(
          'company_id', v_company_id,
          'order_id', v_order_id,
          'source_record_id', p_quote_id,
          'source_line_id', v_line.id,
          'quote_item_id', v_line.id,
          'quantity_kg', v_line.required_weight_kg,
          'finishing_type', coalesce(v_line.finishing_type, 'mill_finish'),
          'dealer_fulfilled_weight_kg', 0,
          'manufacturing_weight_kg', v_line.required_weight_kg,
          'created_at', now(),
          'updated_at', now()
        )
    );
  end loop;

  v_remaining_dealer_weight := v_dealer_weight;
  if v_remaining_dealer_weight > 0 then
    for v_line in
      select
        item.id,
        item.profile_id,
        coalesce(item.finishing_type, 'mill_finish') as finishing_type,
        round(coalesce(item.billing_weight_kg, item.total_weight_kg, 0), 3) as required_weight_kg,
        coalesce(item.net_rate, item.price_per_kg) as unit_rate,
        item.line_total_before_gst
      from public.quote_items item
      where item.company_id = v_company_id
        and item.quote_id = p_quote_id
        and item.profile_id is not null
      order by item.created_at, item.id
    loop
      exit when v_remaining_dealer_weight <= 0.001;
      if coalesce(v_line.unit_rate, 0) <= 0 then
        raise exception 'Every dealer-stock quote line needs a positive commercial rate before fulfillment';
      end if;
      select id into v_order_item_id
      from public.order_items
      where company_id = v_company_id
        and order_id = v_order_id
        and quote_item_id = v_line.id;
      if v_order_item_id is null then
        raise exception 'Order line could not be linked to its quote line';
      end if;

      v_line_remaining := least(v_line.required_weight_kg, v_remaining_dealer_weight);
      for v_batch in
        select batch.id, batch.total_weight_kg, batch.length_m, batch.quantity_pieces
        from public.profile_stock_batches batch
        where batch.company_id = v_company_id
          and batch.dealer_id = v_dealer_id
          and batch.profile_id = v_line.profile_id
          and batch.status in ('available','reserved')
          and batch.total_weight_kg > 0
          and regexp_replace(lower(btrim(coalesce(batch.finish,'mill_finish'))),'[^a-z0-9]+','_','g') =
              regexp_replace(lower(btrim(coalesce(v_line.finishing_type,'mill_finish'))),'[^a-z0-9]+','_','g')
        order by batch.created_at, batch.id
        for update
      loop
        exit when v_line_remaining <= 0.001 or v_remaining_dealer_weight <= 0.001;
        select coalesce(sum(greatest(reservation.reserved_weight_kg - coalesce((
          select sum(consumption.consumed_weight_kg)
          from public.profile_stock_consumptions consumption
          where consumption.company_id = v_company_id and consumption.reservation_id = reservation.id
        ),0),0)),0)
        into v_reserved_weight
        from public.profile_stock_reservations reservation
        where reservation.company_id = v_company_id
          and reservation.profile_stock_batch_id = v_batch.id
          and reservation.status = 'active';
        v_available_weight := round(greatest(v_batch.total_weight_kg - v_reserved_weight, 0), 3);
        if v_available_weight <= 0 then continue; end if;

        v_consume_weight := least(v_line_remaining, v_remaining_dealer_weight, v_available_weight);
        v_new_batch_weight := round(v_batch.total_weight_kg - v_consume_weight, 3);
        if coalesce(v_batch.quantity_pieces,0) <= 0 or coalesce(v_batch.length_m,0) <= 0 then
          raise exception 'Dealer stock requires exact piece and metre provenance before fulfillment' using errcode='23514';
        end if;
        v_consumed_pieces := round(v_consume_weight * v_batch.quantity_pieces / v_batch.total_weight_kg)::integer;
        if v_consumed_pieces <= 0 or abs(v_consume_weight - round(
          v_batch.total_weight_kg * v_consumed_pieces / v_batch.quantity_pieces,3)) > 0.001 then
          raise exception 'Dealer stock fulfillment must consume exact whole pieces; record a cutting adjustment first' using errcode='23514';
        end if;
        v_new_piece_count := v_batch.quantity_pieces - v_consumed_pieces;
        v_consumed_length := round(v_batch.length_m * v_consumed_pieces / v_batch.quantity_pieces,3);

        insert into public.order_dealer_stock_fulfillments (
          company_id, order_id, quote_id, quote_item_id, order_item_id,
          profile_id, profile_stock_batch_id, finishing_type, unit_rate,
          quoted_line_value, fulfilled_weight_kg, fulfilled_length_m,
          fulfilled_pieces, notes, created_by
        ) values (
          v_company_id, v_order_id, p_quote_id, v_line.id, v_order_item_id,
          v_line.profile_id, v_batch.id, v_line.finishing_type, v_line.unit_rate,
          v_line.line_total_before_gst, v_consume_weight,
          v_consumed_length,
          v_consumed_pieces,
          'Dealer stock debit with exact quote/order/finish/rate lineage',
          v_user_id
        );

        update public.profile_stock_batches
        set total_weight_kg = v_new_batch_weight,
            quantity_pieces = v_new_piece_count,
            length_m = round(v_batch.length_m - v_consumed_length,3),
            status = case when v_new_batch_weight <= 0 then 'dispatched' else status end,
            updated_at = now()
        where id = v_batch.id and company_id = v_company_id;

        update public.order_items
        set dealer_fulfilled_weight_kg = dealer_fulfilled_weight_kg + v_consume_weight,
            manufacturing_weight_kg = greatest(manufacturing_weight_kg - v_consume_weight,0),
            updated_at = now()
        where id = v_order_item_id and company_id = v_company_id;

        insert into public.inventory_transactions (
          company_id, inventory_item_id, item_type, quantity, unit, inventory_state,
          from_owner_type, from_owner_id, to_owner_type, to_owner_id, order_id,
          created_by_user_id, created_by_role, reason, status
        )
        select
          v_company_id, inventory.id, 'profile', -v_consume_weight, 'kg',
          'dealer_inventory_on_hand', 'dealer', v_dealer_id, 'customer', null,
          v_order_id, v_user_id, v_user_role,
          'Dealer stock debit for quote line ' || v_line.id::text, 'posted'
        from public.inventory_items inventory
        join public.aluminium_profiles profile
          on profile.id = v_line.profile_id and profile.company_id = v_company_id
        where inventory.company_id = v_company_id
          and inventory.item_code = profile.profile_code
        limit 1;

        v_line_remaining := round(v_line_remaining - v_consume_weight, 3);
        v_remaining_dealer_weight := round(v_remaining_dealer_weight - v_consume_weight, 3);
      end loop;
    end loop;
  end if;

  if v_remaining_dealer_weight > 0.001 then
    raise exception 'Could not allocate % kg of dealer stock to exact quote lines and finishes',
      v_remaining_dealer_weight using errcode = '23514';
  end if;

  update public.order_items order_item
  set manufacturing_weight_kg = greatest(
        coalesce(quote_item.billing_weight_kg, quote_item.total_weight_kg, order_item.quantity_kg, 0)
          - order_item.dealer_fulfilled_weight_kg,
        0
      ),
      updated_at = now()
  from public.quote_items quote_item
  where order_item.company_id = v_company_id
    and order_item.order_id = v_order_id
    and quote_item.id = order_item.quote_item_id;

  update public.orders
  set dealer_fulfilled_weight_kg = v_dealer_weight,
      manufacturing_weight_kg = v_manufacturing_weight,
      fulfillment_notes = v_fulfillment_notes
  where id = v_order_id and company_id = v_company_id;

  insert into public.order_stage_history (company_id, order_id, stage, changed_by, remarks)
  values (v_company_id, v_order_id, v_stage, v_user_id, v_fulfillment_notes);

  update public.quotes
  set status = 'converted_to_order', updated_at = now()
  where id = p_quote_id and company_id = v_company_id;
  delete from private.quote_fulfillment_authorizations
    where transaction_id=txid_current() and company_id=v_company_id and quote_id=p_quote_id and actor_id=v_user_id;
  return v_order_id;
end;
$function$


-- FN private.create_order_from_quote_with_dealer_workflow_atomic
CREATE OR REPLACE FUNCTION private.create_order_from_quote_with_dealer_workflow_atomic(p_quote_id uuid, p_order_number text, p_order_date date, p_expected_dispatch_date date, p_priority text, p_dealer_fulfilled_weight_kg numeric, p_notes text, p_minimum_handling text, p_override_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_order_id uuid;
  v_manufacturing_weight numeric(14,3);
  v_status text;
  v_compatibility_signature text;
  v_compatibility_label text;
begin
  if coalesce(p_minimum_handling, 'queue') not in ('queue', 'override') then
    raise exception 'Minimum handling must be queue or override';
  end if;
  v_order_id := private.create_order_from_quote_with_dealer_stock(
    p_quote_id, p_order_number, p_order_date, p_expected_dispatch_date,
    p_priority, p_dealer_fulfilled_weight_kg, p_notes
  );

  if private.get_current_user_dealer_id() is not null then
    perform private.create_dealer_order_from_order_atomic(v_order_id);
  end if;

  select round(coalesce(manufacturing_weight_kg, 0), 3)
  into v_manufacturing_weight
  from public.orders
  where id = v_order_id and company_id = v_company_id;

  select
    string_agg(requirement.signature_part, ',' order by requirement.signature_part),
    string_agg(requirement.label_part, ', ' order by requirement.signature_part)
  into v_compatibility_signature, v_compatibility_label
  from (
    select distinct
      concat_ws('|', upper(coalesce(source.alloy, 'UNKNOWN')), upper(coalesce(source.temper, 'UNKNOWN')), coalesce(source.billet_diameter_inch::text, 'UNKNOWN')) as signature_part,
      concat_ws(' / ', coalesce(source.alloy, 'Unknown alloy'), coalesce(source.temper, 'Unknown temper'), coalesce(source.billet_diameter_inch::text || ' in', 'Unknown diameter')) as label_part
    from public.order_billet_requirements source
    where source.company_id = v_company_id
      and source.order_id = v_order_id
      and source.required_weight_kg > 0
  ) requirement;

  v_compatibility_signature := coalesce(v_compatibility_signature, 'ORDER:' || v_order_id::text);
  v_compatibility_label := coalesce(v_compatibility_label, 'Material requirement not captured');

  if v_manufacturing_weight > 0 and v_manufacturing_weight < 700 then
    if coalesce(p_minimum_handling, 'queue') = 'override' then
      if v_role not in ('owner','admin','factory_manager','production_manager') then
        raise exception 'Only an owner or factory/production manager can override the factory minimum' using errcode = '42501';
      end if;
      if length(trim(coalesce(p_override_reason, ''))) < 8 then
        raise exception 'Enter a clear reason for the below-minimum production release';
      end if;
      v_status := 'overridden';
    else
      v_status := 'pending';
    end if;

    insert into public.factory_load_consolidations(
      company_id, order_id, manufacturing_weight_kg, compatibility_signature, compatibility_label, status,
      release_reason, released_by, released_at, created_by
    ) values (
      v_company_id, v_order_id, v_manufacturing_weight, v_compatibility_signature, v_compatibility_label, v_status,
      case when v_status = 'overridden' then trim(p_override_reason) else null end,
      case when v_status = 'overridden' then auth.uid() else null end,
      case when v_status = 'overridden' then now() else null end,
      auth.uid()
    )
    on conflict (company_id, order_id) do update set
      manufacturing_weight_kg = excluded.manufacturing_weight_kg,
      compatibility_signature = excluded.compatibility_signature,
      compatibility_label = excluded.compatibility_label,
      status = excluded.status,
      release_reason = excluded.release_reason,
      released_by = excluded.released_by,
      released_at = excluded.released_at,
      updated_at = now();

    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (
      v_company_id, auth.uid(),
      case when v_status = 'overridden' then 'factory_minimum_overridden' else 'factory_load_queued' end,
      'order', v_order_id,
      jsonb_build_object(
        'manufacturing_weight_kg', v_manufacturing_weight,
        'minimum_weight_kg', 700,
        'reason', case when v_status = 'overridden' then trim(p_override_reason) else null end
      )
    );
  end if;

  return v_order_id;
end;
$function$


-- FN private.create_order_from_quote_with_dealer_workflow_atomic
CREATE OR REPLACE FUNCTION private.create_order_from_quote_with_dealer_workflow_atomic(p_quote_id uuid, p_order_number text, p_order_date date, p_expected_dispatch_date date, p_priority text, p_dealer_fulfilled_weight_kg numeric, p_notes text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select private.create_order_from_quote_with_dealer_workflow_atomic(
    p_quote_id, p_order_number, p_order_date, p_expected_dispatch_date,
    p_priority, p_dealer_fulfilled_weight_kg, p_notes, 'queue', null
  )
$function$


-- FN private.current_user_has_permission
CREATE OR REPLACE FUNCTION private.current_user_has_permission(permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(private.get_current_user_role() in ('owner','admin'), false)
    or exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.is_active = true
      join public.role_permissions rp on rp.role_id = r.id
      where ur.user_id = auth.uid()
        and ur.company_id = private.get_current_user_company_id()
        and rp.permission_key = permission
        and (permission not in ('manage_users', 'manage_roles') or private.get_current_user_role() = 'owner')
    )
    or exists (
      select 1
      from public.roles r
      join public.role_permissions rp on rp.role_id = r.id
      where r.company_id = private.get_current_user_company_id()
        and r.role_key = private.get_current_user_role()
        and r.is_active = true
        and rp.permission_key = permission
        and (permission not in ('manage_users', 'manage_roles') or private.get_current_user_role() = 'owner')
    );
$function$


-- FN private.derive_quote_header_financials
CREATE OR REPLACE FUNCTION private.derive_quote_header_financials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_subtotal numeric(14,2);
  v_profit numeric(14,2);
  v_low_margin boolean;
  v_gst_percent numeric(7,2);
  v_gst_amount numeric(14,2);
begin
  select
    round(coalesce(sum(item.line_total_before_gst), 0), 2),
    round(coalesce(sum(item.estimated_profit_amount), 0), 2),
    coalesce(bool_or(item.approval_required), false)
  into v_subtotal, v_profit, v_low_margin
  from public.quote_items item
  where item.company_id = new.company_id
    and item.quote_id = new.id;

  v_gst_percent := greatest(least(coalesce(new.gst_percent, 0), 100), 0);
  select coalesce(sum(round(item.line_total_before_gst * coalesce(item.gst_percent, v_gst_percent) / 100, 2)), 0)
  into v_gst_amount from public.quote_items item where item.company_id = new.company_id and item.quote_id = new.id;

  new.gst_percent := v_gst_percent;
  new.subtotal := v_subtotal;
  new.total_margin_amount := v_profit;
  new.total_before_gst := v_subtotal;
  new.gst_amount := v_gst_amount;
  new.grand_total := v_subtotal + v_gst_amount;
  new.low_margin_approval_required := v_low_margin;
  new.estimated_profit_amount := v_profit;
  new.estimated_profit_percent := case
    when v_subtotal > 0 then round(v_profit / v_subtotal * 100, 2)
    else 0
  end;

  return new;
end;
$function$


-- FN private.enforce_customer_accepted_quote_order_link
CREATE OR REPLACE FUNCTION private.enforce_customer_accepted_quote_order_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_quote_company_id uuid;
  v_quote_customer_id uuid;
  v_quote_status text;
begin
  if new.quote_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
     and private.get_current_user_role() not in (
       'owner', 'admin', 'sales', 'sales_manager', 'factory_manager', 'production_manager'
     ) then
    raise exception 'Permission denied for orders' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
    and old.quote_id is not distinct from new.quote_id
    and old.company_id is not distinct from new.company_id
    and old.customer_id is not distinct from new.customer_id
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order-quote:' || new.quote_id::text, 0));

  select q.company_id, q.customer_id, q.status
  into v_quote_company_id, v_quote_customer_id, v_quote_status
  from public.quotes q
  where q.id = new.quote_id;

  if not found then
    raise exception 'Quote not found';
  end if;
  if v_quote_company_id <> new.company_id or v_quote_customer_id <> new.customer_id then
    raise exception 'Quote does not belong to this company and customer';
  end if;
  if v_quote_status <> 'customer_approved' then
    raise exception 'Only customer-approved quotes can be linked to a new order';
  end if;
  if not exists (
    select 1
    from public.quote_items item
    where item.company_id = new.company_id
      and item.quote_id = new.quote_id
  ) then
    raise exception 'A customer-approved quote must contain at least one item before order creation'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.quote_items item
    where item.company_id = new.company_id
      and item.quote_id = new.quote_id
      and lower(coalesce(item.drawing_approval_status, '')) <> 'approved'
  ) then
    raise exception 'Every quote item drawing must be approved before order creation'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.orders existing
    where existing.company_id = new.company_id
      and existing.quote_id = new.quote_id
      and existing.id <> new.id
  ) then
    raise exception 'An order already exists for this quote';
  end if;

  return new;
end;
$function$


-- FN private.enforce_dealer_fulfillment_lineage
CREATE OR REPLACE FUNCTION private.enforce_dealer_fulfillment_lineage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order public.orders%rowtype;
  v_quote_item public.quote_items%rowtype;
  v_order_item public.order_items%rowtype;
  v_batch public.profile_stock_batches%rowtype;
begin
  select * into v_order from public.orders where id=new.order_id and company_id=new.company_id;
  if not found then raise exception 'Dealer fulfillment order is unavailable'; end if;
  if new.quote_item_id is null or new.order_item_id is null then
    raise exception 'Dealer fulfillment requires exact quote and order line identity';
  end if;
  select * into v_quote_item from public.quote_items where id=new.quote_item_id
    and company_id=new.company_id and quote_id=v_order.quote_id;
  if not found then raise exception 'Dealer fulfillment quote line does not belong to the order'; end if;
  select * into v_order_item from public.order_items where id=new.order_item_id
    and company_id=new.company_id and order_id=new.order_id and quote_item_id=new.quote_item_id;
  if not found then raise exception 'Dealer fulfillment order line does not match its quote line'; end if;
  select * into v_batch from public.profile_stock_batches where id=new.profile_stock_batch_id
    and company_id=new.company_id and profile_id=v_quote_item.profile_id;
  if not found or v_order.dealer_id is null or v_batch.dealer_id is distinct from v_order.dealer_id then
    raise exception 'Dealer fulfillment stock batch does not match its quote profile and dealership';
  end if;
  if regexp_replace(lower(btrim(coalesce(v_batch.finish,'mill_finish'))),'[^a-z0-9]+','_','g') <>
    regexp_replace(lower(btrim(coalesce(v_quote_item.finishing_type,'mill_finish'))),'[^a-z0-9]+','_','g') then
    raise exception 'Dealer stock finish does not match the quoted finish';
  end if;
  if coalesce(v_quote_item.net_rate,v_quote_item.price_per_kg,0)<=0 then
    raise exception 'Dealer fulfillment quote line requires a positive commercial rate';
  end if;
  new.quote_id:=v_order.quote_id;
  new.profile_id:=v_quote_item.profile_id;
  new.finishing_type:=coalesce(v_quote_item.finishing_type,'mill_finish');
  new.unit_rate:=coalesce(v_quote_item.net_rate,v_quote_item.price_per_kg);
  new.quoted_line_value:=v_quote_item.line_total_before_gst;
  return new;
end;
$function$


-- FN private.enforce_invoice_credit_settlement_exclusivity
CREATE OR REPLACE FUNCTION private.enforce_invoice_credit_settlement_exclusivity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if tg_table_schema <> 'public' then
    raise exception 'Unsupported credit settlement source';
  end if;

  if tg_table_name = 'payments' then
    if new.payment_status is distinct from 'PAID'
      or not (new.payment_method is not distinct from 'credit_note' or new.payment_type is not distinct from 'ADJUSTMENT') then
      return new;
    end if;
    if tg_op = 'UPDATE' then
      if old.company_id is not distinct from new.company_id and old.invoice_id is not distinct from new.invoice_id
        and old.payment_status is not distinct from new.payment_status and old.payment_method is not distinct from new.payment_method
        and old.payment_type is not distinct from new.payment_type and old.amount is not distinct from new.amount then
        return new;
      end if;
    end if;
  elsif tg_table_name = 'credit_notes' then
    if new.status is distinct from 'issued' then return new; end if;
    if tg_op = 'UPDATE' then
      if old.company_id is not distinct from new.company_id and old.invoice_id is not distinct from new.invoice_id
        and old.status is not distinct from new.status and old.grand_total is not distinct from new.grand_total then
        return new;
      end if;
    end if;
  else
    raise exception 'Unsupported credit settlement source';
  end if;

  -- Both posting paths serialize on the same invoice before inspecting the opposite ledger.
  perform 1 from public.invoices where id=new.invoice_id and company_id=new.company_id for update;
  if not found then raise exception 'Invoice not found for this company' using errcode='23514'; end if;

  if tg_table_name = 'payments' then
    if exists (
      select 1 from public.credit_notes
      where company_id=new.company_id and invoice_id=new.invoice_id and status='issued'
    ) then
      raise exception 'This invoice already has an issued credit note. Reverse that note before recording a standalone credit adjustment.'
        using errcode='23514';
    end if;
  else
    if exists (
      select 1 from public.payments
      where company_id=new.company_id and invoice_id=new.invoice_id and payment_status='PAID'
        and (payment_method='credit_note' or payment_type='ADJUSTMENT')
    ) then
      raise exception 'Reverse the standalone credit adjustment before issuing a return credit note for this invoice.'
        using errcode='23514';
    end if;
  end if;
  return new;
end;
$function$


-- FN private.enforce_one_active_dispatch_invoice
CREATE OR REPLACE FUNCTION private.enforce_one_active_dispatch_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order_id uuid;
  v_customer_id uuid;
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'Invoice company cannot be changed after creation';
  end if;
  if tg_op = 'UPDATE'
     and (
       new.dispatch_id is distinct from old.dispatch_id
       or new.order_id is distinct from old.order_id
       or new.customer_id is distinct from old.customer_id
     )
     and exists (
       select 1 from public.invoice_items item where item.invoice_id = old.id
     ) then
    raise exception 'Invoice source cannot be changed after packing lines are created';
  end if;

  if new.dispatch_id is not null then
    select dispatch.order_id, source_order.customer_id
    into v_order_id, v_customer_id
    from public.dispatches dispatch
    join public.orders source_order
      on source_order.id = dispatch.order_id
     and source_order.company_id = dispatch.company_id
    where dispatch.id = new.dispatch_id
      and dispatch.company_id = new.company_id;
    if not found then
      raise exception 'Invoice dispatch is unavailable for this company';
    end if;
    if new.order_id is distinct from v_order_id
       or new.customer_id is distinct from v_customer_id then
      raise exception 'Invoice order and customer must match the selected dispatch';
    end if;
  end if;

  if new.dispatch_id is not null and new.status <> 'cancelled' then
    perform pg_advisory_xact_lock(hashtextextended(
      'dispatch-invoice:' || new.company_id::text || ':' || new.dispatch_id::text,
      0
    ));
  end if;

  if new.dispatch_id is not null and new.status <> 'cancelled' and exists (
    select 1
    from public.invoices existing
    where existing.company_id = new.company_id
      and existing.dispatch_id = new.dispatch_id
      and existing.status <> 'cancelled'
      and existing.id is distinct from new.id
  ) then
    raise exception 'This dispatch already has an active invoice';
  end if;
  return new;
end;
$function$


-- FN private.enforce_production_schedule_integrity
CREATE OR REPLACE FUNCTION private.enforce_production_schedule_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if new.status not in ('scheduled', 'released') then
    return new;
  end if;

  if new.planned_end_at is null then
    raise exception 'Active press slots require a planned end time' using errcode = '23514';
  end if;

  -- Serialize all writers that can contend for either this press or this job.
  perform pg_advisory_xact_lock(hashtextextended(
    'production-slot-machine:' || new.company_id::text || ':' || new.machine_id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'production-slot-job:' || new.company_id::text || ':' || new.production_job_id::text,
    0
  ));

  if exists (
    select 1
    from public.production_plan_slots slot
    where slot.company_id = new.company_id
      and slot.production_job_id = new.production_job_id
      and slot.status in ('scheduled', 'released')
      and slot.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'This production job already has an active press slot' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.production_plan_slots slot
    where slot.company_id = new.company_id
      and slot.machine_id = new.machine_id
      and slot.status in ('scheduled', 'released')
      and slot.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and new.planned_start_at < slot.planned_end_at
      and new.planned_end_at > slot.planned_start_at
  ) then
    raise exception 'This extrusion press already has an overlapping active slot' using errcode = '23P01';
  end if;

  return new;
end;
$function$


-- FN private.enforce_quote_status_transition
CREATE OR REPLACE FUNCTION private.enforce_quote_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_allowed boolean := false;
  v_role text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order-quote:' || new.id::text, 0));

  v_allowed := case old.status
    when 'draft' then new.status = 'internal_review'
    when 'internal_review' then new.status in ('draft', 'approved_for_sending')
    when 'approved_for_sending' then new.status in ('draft', 'sent')
    when 'sent' then new.status in ('draft', 'customer_approved', 'customer_rejected', 'expired')
    when 'customer_approved' then new.status in ('draft', 'converted_to_order')
    when 'customer_rejected' then new.status = 'draft'
    when 'expired' then new.status = 'draft'
    else false
  end;

  if not v_allowed then
    raise exception 'Quote cannot move from % to %', old.status, new.status;
  end if;

  if coalesce(new.low_margin_approval_required, false)
    and new.status in ('approved_for_sending', 'sent', 'customer_approved')
  then
    v_role := public.get_current_user_role();
    if coalesce(v_role, '') not in ('owner', 'admin', 'sales_manager') then
      raise exception 'This low-margin quote needs owner/admin approval';
    end if;
  end if;

  if old.status = 'customer_approved'
     and new.status = 'draft'
     and exists (
       select 1 from public.orders linked_order
       where linked_order.company_id = new.company_id
         and linked_order.quote_id = new.id
     ) then
    raise exception 'A quote linked to an order cannot return to draft';
  end if;

  if new.status = 'converted_to_order' and not exists (
    select 1
    from public.orders linked_order
    where linked_order.company_id = new.company_id
      and linked_order.quote_id = new.id
  ) then
    raise exception 'A customer-approved quote must be linked to an order before conversion';
  end if;

  if new.status = 'draft' then
    new.approved_by := null;
    new.approved_at := null;
    new.sent_at := null;
    new.customer_decision_at := null;
  elsif new.status = 'approved_for_sending' then
    new.approved_by := coalesce(new.approved_by, auth.uid());
    new.approved_at := coalesce(new.approved_at, now());
  elsif new.status = 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
  elsif new.status in ('customer_approved', 'customer_rejected') then
    new.customer_decision_at := coalesce(new.customer_decision_at, now());
  end if;

  return new;
end;
$function$


-- FN private.enforce_single_active_dispatch_invoice
CREATE OR REPLACE FUNCTION private.enforce_single_active_dispatch_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if new.dispatch_id is null or new.status = 'cancelled' then return new; end if;
  if tg_op = 'UPDATE' and new.dispatch_id is not distinct from old.dispatch_id
    and new.company_id is not distinct from old.company_id and old.status <> 'cancelled' then
    return new;
  end if;
  -- Same key as the invoice writer, so concurrent creations and edits serialize per dispatch.
  perform pg_advisory_xact_lock(hashtextextended('dispatch-invoice:' || new.company_id::text || ':' || new.dispatch_id::text, 0));
  if exists (
    select 1 from public.invoices
    where company_id = new.company_id and dispatch_id = new.dispatch_id and status <> 'cancelled' and id <> new.id
  ) then
    raise exception 'This dispatch already has an active invoice' using errcode = '23505';
  end if;
  return new;
end;
$function$


-- FN private.expense_approval_threshold
CREATE OR REPLACE FUNCTION private.expense_approval_threshold()
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$ select 25000::numeric $function$


-- FN private.expense_live_payment_status
CREATE OR REPLACE FUNCTION private.expense_live_payment_status(p_status text, p_balance numeric, p_due_date date, p_as_of date DEFAULT NULL::date)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'private'
AS $function$
  select case
    when p_status in ('unpaid','partially_paid') and coalesce(p_balance, 0) > 0
      and p_due_date is not null and p_due_date < coalesce(p_as_of, private.business_today()) then 'overdue'
    when p_status = 'overdue' and (coalesce(p_balance, 0) <= 0 or p_due_date is null
      or p_due_date >= coalesce(p_as_of, private.business_today())) then 'unpaid'
    else p_status
  end
$function$


-- FN private.find_duplicate_vendor_bill
CREATE OR REPLACE FUNCTION private.find_duplicate_vendor_bill(p_company_id uuid, p_vendor_id uuid, p_invoice_number text, p_invoice_date date, p_total numeric, p_exclude_id uuid, p_exclude_source_record uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  -- A repeated vendor bill number within the same Indian financial year and the same total
  -- is treated as a duplicate entry. Vendors that restart numbering each year, or split one
  -- bill across cost lines with different totals, remain valid.
  select e.expense_number
  from public.expense_ledger e
  where e.company_id = p_company_id
    and p_vendor_id is not null and nullif(btrim(p_invoice_number), '') is not null
    and e.vendor_id = p_vendor_id
    and upper(btrim(e.invoice_number)) = upper(btrim(p_invoice_number))
    and private.indian_financial_year(e.invoice_date) is not distinct from private.indian_financial_year(p_invoice_date)
    and e.total_amount = p_total
    and e.deleted_at is null
    and e.approval_status not in ('cancelled', 'rejected', 'reversed')
    and (p_exclude_id is null or e.id <> p_exclude_id)
    and (p_exclude_source_record is null or e.source_record_id is distinct from p_exclude_source_record)
  order by e.created_at
  limit 1
$function$


-- FN private.finishing_accepted_output_kg
CREATE OR REPLACE FUNCTION private.finishing_accepted_output_kg(p_company_id uuid, p_job_id uuid, p_finishing_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_output numeric;
begin
  perform private.assert_finishing_material_lineage(p_company_id,p_job_id);
  select output_weight_kg into v_output from public.finishing_jobs where id=p_finishing_id and company_id=p_company_id
    and production_job_id=p_job_id and status in ('completed','rejected') and received_date is not null and output_weight_kg>0;
  return coalesce(v_output,0);
end;
$function$


-- FN private.finishing_dispatch_ready_kg
CREATE OR REPLACE FUNCTION private.finishing_dispatch_ready_kg(p_company_id uuid, p_order_id uuid, p_job_id uuid, p_quality_required boolean)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_finishing record;v_job public.production_jobs%rowtype;v_approved numeric;v_packaged numeric;v_ready numeric:=0;
  v_accepted_count integer;v_legacy_count integer;
begin
  perform private.assert_finishing_material_lineage(p_company_id,p_job_id);
  select * into v_job from public.production_jobs where id=p_job_id and company_id=p_company_id and order_id=p_order_id;
  if not found or coalesce(v_job.finishing_type,'mill_finish')='mill_finish' then raise exception 'Accepted finishing source does not match this order'; end if;
  select count(*) into v_accepted_count from public.finishing_jobs where company_id=p_company_id and production_job_id=p_job_id
    and status in ('completed','rejected') and output_weight_kg>0 and received_date is not null;
  select count(*) into v_legacy_count from public.packaging_jobs where company_id=p_company_id and production_job_id=p_job_id
    and finishing_job_id is null and status<>'cancelled';
  if v_legacy_count>0 and (v_legacy_count<>1 or v_accepted_count<>1 or exists(select 1 from public.packaging_jobs where company_id=p_company_id
    and production_job_id=p_job_id and finishing_job_id is not null and status<>'cancelled')) then
    raise exception 'Legacy packaging has ambiguous finishing receipt provenance; review before dispatch';
  end if;
  for v_finishing in select id,output_weight_kg from public.finishing_jobs where company_id=p_company_id and production_job_id=p_job_id
    and order_id=p_order_id and status in ('completed','rejected') and output_weight_kg>0 and received_date is not null order by id
  loop
    select coalesce(sum(quantity_checked_kg),0) into v_approved from public.quality_inspections where company_id=p_company_id
      and production_job_id=p_job_id and profile_id=v_job.profile_id and finishing_job_id=v_finishing.id and status='approved';
    if v_approved>v_finishing.output_weight_kg+0.01 then raise exception 'QC approval exceeds its accepted finishing portion'; end if;
    select coalesce(sum(p.profile_weight_kg),0) into v_packaged from public.packaging_jobs p where p.company_id=p_company_id
      and p.order_id=p_order_id and p.production_job_id=p_job_id and p.status='completed'
      and (p.finishing_job_id=v_finishing.id or (v_legacy_count=1 and p.finishing_job_id is null))
      and exists(select 1 from public.packaging_job_materials m where m.company_id=p_company_id and m.job_id=p.id and m.quantity_required>0);
    if v_packaged>v_finishing.output_weight_kg+0.001 then raise exception 'Packaged weight exceeds its accepted finishing portion'; end if;
    v_ready:=v_ready+least(v_finishing.output_weight_kg,v_packaged,
      case when coalesce(p_quality_required,true) then v_approved else v_finishing.output_weight_kg end);
  end loop;
  if v_ready>v_job.actual_quantity_kg+0.001 then raise exception 'Released finishing output exceeds captured production'; end if;
  return v_ready;
end;
$function$


-- FN public.accept_invitation_atomic
CREATE OR REPLACE FUNCTION public.accept_invitation_atomic(target_invitation_id uuid, target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_invitation public.invitations%rowtype;
  selected_role public.roles%rowtype;
begin
  select invitation.*
  into selected_invitation
  from public.invitations invitation
  where invitation.id = target_invitation_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if selected_invitation.status = 'accepted' then
    if selected_invitation.accepted_by = target_user_id then
      return jsonb_build_object('status', 'accepted', 'role_key', null);
    end if;
    return jsonb_build_object('status', 'already_accepted');
  end if;

  if selected_invitation.status <> 'pending' then
    return jsonb_build_object('status', 'not_pending');
  end if;

  if selected_invitation.expires_at < now() then
    update public.invitations
    set status = 'expired'
    where id = selected_invitation.id;
    return jsonb_build_object('status', 'expired');
  end if;

  select role.*
  into selected_role
  from public.roles role
  where role.id = selected_invitation.role_id
    and role.company_id = selected_invitation.company_id
    and role.is_active = true
    and role.is_system = true
    and role.role_key = any (array[
      'owner', 'admin', 'sales_manager', 'sales', 'production_manager', 'production',
      'dispatch_manager', 'dispatch', 'accounts', 'quality', 'viewer', 'factory_manager',
      'inventory_manager', 'dealer_admin', 'dealer_staff'
    ]::text[]);

  if not found then
    return jsonb_build_object('status', 'invalid_role');
  end if;

  if selected_invitation.dealer_id is not null and not exists (
    select 1
    from public.dealers dealer
    where dealer.id = selected_invitation.dealer_id
      and dealer.company_id = selected_invitation.company_id
      and dealer.is_active = true
  ) then
    return jsonb_build_object('status', 'invalid_scope');
  end if;

  if selected_invitation.branch_id is not null and not exists (
    select 1
    from public.branches branch
    where branch.id = selected_invitation.branch_id
      and branch.company_id = selected_invitation.company_id
      and branch.is_active = true
  ) then
    return jsonb_build_object('status', 'invalid_scope');
  end if;

  if exists (select 1 from public.app_users app_user where app_user.id = target_user_id) then
    return jsonb_build_object('status', 'user_conflict');
  end if;

  insert into public.app_users (
    id,
    company_id,
    dealer_id,
    branch_id,
    full_name,
    email,
    phone,
    role,
    is_active,
    status,
    invited_by,
    invited_at,
    department,
    sales_region
  ) values (
    target_user_id,
    selected_invitation.company_id,
    selected_invitation.dealer_id,
    selected_invitation.branch_id,
    selected_invitation.full_name,
    lower(selected_invitation.email),
    selected_invitation.phone,
    selected_role.role_key,
    true,
    'active',
    selected_invitation.invited_by,
    selected_invitation.created_at,
    selected_invitation.department,
    selected_invitation.sales_region
  );

  insert into public.user_roles (
    company_id,
    user_id,
    role_id,
    dealer_id,
    branch_id,
    sales_region,
    department,
    is_primary,
    assigned_by
  ) values (
    selected_invitation.company_id,
    target_user_id,
    selected_role.id,
    selected_invitation.dealer_id,
    selected_invitation.branch_id,
    selected_invitation.sales_region,
    selected_invitation.department,
    true,
    selected_invitation.invited_by
  );

  update public.invitations
  set
    status = 'accepted',
    accepted_by = target_user_id,
    accepted_at = now()
  where id = selected_invitation.id;

  return jsonb_build_object('status', 'accepted', 'role_key', selected_role.role_key);
end;
$function$


-- FN public.allocate_billet_to_order
CREATE OR REPLACE FUNCTION public.allocate_billet_to_order(p_billet_id uuid, p_order_id uuid)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'public', 'private'
AS $function$
  select private.allocate_billet_to_order(p_billet_id, p_order_id);
$function$


-- FN public.allocate_billets_by_priority
CREATE OR REPLACE FUNCTION public.allocate_billets_by_priority(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid:=coalesce(p_company_id,private.get_current_user_company_id());
  v_req record;
  v_current public.order_billet_requirements%rowtype;
  v_billet record;
  v_needed integer;
  v_stage text;
  v_previous_status text;
  v_order_status text;
begin
  if v_company_id is null then return;end if;
  if auth.uid() is not null and v_company_id is distinct from private.get_current_user_company_id() then
    raise exception 'Cannot allocate billets outside the active company' using errcode='42501';
  end if;
  if auth.uid() is not null and coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'Permission denied to allocate billets' using errcode='42501';
  end if;

  for v_req in
    select r.*,o.order_number
    from public.order_billet_requirements r
    join public.orders o on o.id=r.order_id and o.company_id=r.company_id
    where r.company_id=v_company_id and r.status in ('pending','partial','shortage')
      and o.current_stage not in ('closed','cancelled','delivered','payment_pending')
      and (o.current_stage<>'dispatched' or private.order_profile_needs_billet_allocation(v_company_id,o.id,r.profile_id))
    order by case o.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
      o.expected_dispatch_date nulls last,o.order_date,o.created_at,o.id,r.created_at,r.id
  loop
    -- A queued requirement can change while another transaction owns its order.
    select current_stage into v_stage from public.orders
      where id=v_req.order_id and company_id=v_company_id for update;
    if not found or v_stage is null or v_stage in ('closed','cancelled','delivered','payment_pending') then continue;end if;
    v_previous_status:=v_req.status;
    perform public.refresh_order_billet_allocations(v_req.order_id);
    select * into v_current from public.order_billet_requirements
      where id=v_req.id and company_id=v_company_id and order_id=v_req.order_id for update;
    if not found or v_current.status='cancelled' then continue;end if;
    v_needed:=greatest(v_current.billets_required-v_current.billets_allocated,0);
    if v_needed<=0 or (v_stage='dispatched' and not private.order_profile_needs_billet_allocation(v_company_id,v_req.order_id,v_current.profile_id)) then continue;end if;

    for v_billet in
      select id from public.foundry_billets
      where company_id=v_company_id and status='cast' and order_id is null and allocation_requirement_id is null
        and production_job_id is null
        and lower(btrim(coalesce(alloy,'')))=lower(btrim(coalesce(v_current.alloy,'')))
        and lower(btrim(coalesce(temper,'')))=lower(btrim(coalesce(v_current.temper,'')))
        and billet_diameter_inch=v_current.billet_diameter_inch
      order by case source_type when 'in_house' then 0 else 1 end,created_at,billet_code,id
      for update skip locked
    loop
      exit when v_needed<=0;
      update public.foundry_billets set order_id=v_req.order_id,allocation_requirement_id=v_current.id,
        status='allocated',allocated_at=now(),allocated_by=auth.uid()
      where id=v_billet.id and company_id=v_company_id and status='cast'
        and order_id is null and allocation_requirement_id is null and production_job_id is null;
      if found then v_needed:=v_needed-1;end if;
    end loop;
    perform public.refresh_order_billet_allocations(v_req.order_id);
    select billet_allocation_status into v_order_status from public.orders where id=v_req.order_id and company_id=v_company_id;
    if v_order_status='complete' and v_previous_status<>'complete' then
      perform public.notify_billet_allocation(v_company_id,'Billet requirement complete',concat('Order ',v_req.order_number,' has all required billets allocated and is ready for production.'),'success',v_req.order_id);
    elsif v_needed>0 and v_previous_status<>'shortage' then
      perform public.notify_billet_allocation(v_company_id,'Billet shortage',concat('Order ',v_req.order_number,' still needs ',v_needed::text,' more billet',case when v_needed=1 then '' else 's' end,'. Schedule a foundry job or outsource compatible billets.'),'warning',v_req.order_id);
    end if;
  end loop;
end;
$function$


-- FN public.apply_breakdown_spare_part_usage
CREATE OR REPLACE FUNCTION public.apply_breakdown_spare_part_usage()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  available_stock NUMERIC(12,3);
  part_rate NUMERIC(12,2);
BEGIN
  SELECT current_stock, average_rate
    INTO available_stock, part_rate
  FROM public.maintenance_spare_parts
  WHERE id = NEW.spare_part_id
    AND company_id = NEW.company_id
  FOR UPDATE;

  IF available_stock IS NULL THEN
    RAISE EXCEPTION 'Spare part not found for this company' USING ERRCODE = '23514';
  END IF;

  IF available_stock < NEW.quantity_used THEN
    RAISE EXCEPTION 'Insufficient spare part stock. Available %, requested %', available_stock, NEW.quantity_used USING ERRCODE = '23514';
  END IF;

  IF NEW.rate <= 0 THEN
    NEW.rate := part_rate;
  END IF;

  NEW.amount := ROUND((NEW.quantity_used * NEW.rate)::numeric, 2);

  UPDATE public.maintenance_spare_parts
  SET current_stock = current_stock - NEW.quantity_used,
      updated_at = now()
  WHERE id = NEW.spare_part_id
    AND company_id = NEW.company_id;

  RETURN NEW;
END;
$function$


-- FN public.apply_expense_approval_policy
CREATE OR REPLACE FUNCTION public.apply_expense_approval_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_role text;
  v_transition boolean := coalesce(current_setting('extrusionos.expense_approval_transition', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if v_transition then
      return new;
    end if;
    if coalesce(new.approval_status, 'draft') not in ('draft', 'pending_approval', 'approved') then
      raise exception 'New expenses start as draft or are submitted for approval' using errcode = '23514';
    end if;
    -- A manual draft stays draft. Every submitted state, including a client-supplied
    -- "approved", is re-evaluated against the threshold and the caller's role.
    if coalesce(new.approval_status, 'draft') = 'draft' and new.source_table is null then
      new.approval_status := 'draft';
      new.approved_by := null;
      new.approved_at := null;
      return new;
    end if;
    v_role := private.get_current_user_role();
    if new.total_amount > 0 and new.total_amount <= private.expense_approval_threshold()
      and v_role in ('owner', 'admin', 'accounts') then
      new.approval_status := 'approved';
      new.approved_by := auth.uid();
      new.approved_at := now();
    else
      new.approval_status := 'pending_approval';
      new.approved_by := null;
      new.approved_at := null;
    end if;
    return new;
  end if;

  if (new.approval_status, new.approved_by, new.approved_at)
    is distinct from (old.approval_status, old.approved_by, old.approved_at) and not v_transition then
    raise exception 'Approval status changes must use the expense approval workflow' using errcode = '42501';
  end if;
  return new;
end;
$function$


-- FN public.apply_packaging_material_stock
CREATE OR REPLACE FUNCTION public.apply_packaging_material_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_delta numeric := 0;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'cancelled' and new.material_id is not null and new.material_quantity_required > 0 then
      v_delta := new.material_quantity_required;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status <> 'cancelled' and old.material_id is not null and old.material_quantity_required > 0 then
      update public.packaging_materials
      set current_stock = current_stock + old.material_quantity_required,
          updated_at = now()
      where id = old.material_id and company_id = old.company_id;

      insert into public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
      values (old.company_id, old.id, old.material_id, 'restore', old.material_quantity_required, auth.uid());
    end if;

    if new.status <> 'cancelled' and new.material_id is not null and new.material_quantity_required > 0 then
      v_delta := new.material_quantity_required;
    end if;
  end if;

  if v_delta > 0 then
    update public.packaging_materials
    set current_stock = current_stock - v_delta,
        updated_at = now()
    where id = new.material_id
      and company_id = new.company_id
      and current_stock >= v_delta;

    if not found then
      raise exception 'Not enough packaging material stock' using errcode = '23514';
    end if;

    insert into public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
    values (new.company_id, new.id, new.material_id, 'issue', v_delta, auth.uid());
  end if;

  return new;
end;
$function$


-- FN public.apply_packaging_material_stock_from_materials
CREATE OR REPLACE FUNCTION public.apply_packaging_material_stock_from_materials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_status text;
  v_delta numeric := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_job_status FROM public.packaging_jobs WHERE id = NEW.job_id;
    IF v_job_status <> 'cancelled' AND NEW.quantity_required > 0 THEN
      v_delta := NEW.quantity_required;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT status INTO v_job_status FROM public.packaging_jobs WHERE id = NEW.job_id;
    
    -- Restore old
    IF v_job_status <> 'cancelled' AND OLD.quantity_required > 0 THEN
      UPDATE public.packaging_materials
      SET current_stock = current_stock + OLD.quantity_required,
          updated_at = now()
      WHERE id = OLD.material_id AND company_id = OLD.company_id;

      INSERT INTO public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
      VALUES (OLD.company_id, OLD.job_id, OLD.material_id, 'restore', OLD.quantity_required, auth.uid());
    END IF;

    -- Apply new
    IF v_job_status <> 'cancelled' AND NEW.quantity_required > 0 THEN
      v_delta := NEW.quantity_required;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT status INTO v_job_status FROM public.packaging_jobs WHERE id = OLD.job_id;
    -- Restore old
    IF v_job_status <> 'cancelled' AND OLD.quantity_required > 0 THEN
      UPDATE public.packaging_materials
      SET current_stock = current_stock + OLD.quantity_required,
          updated_at = now()
      WHERE id = OLD.material_id AND company_id = OLD.company_id;

      INSERT INTO public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
      VALUES (OLD.company_id, OLD.job_id, OLD.material_id, 'restore', OLD.quantity_required, auth.uid());
    END IF;
    RETURN OLD;
  END IF;

  IF v_delta > 0 THEN
    UPDATE public.packaging_materials
    SET current_stock = current_stock - v_delta,
        updated_at = now()
    WHERE id = NEW.material_id
      AND company_id = NEW.company_id
      AND current_stock >= v_delta;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not enough packaging material stock' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
    VALUES (NEW.company_id, NEW.job_id, NEW.material_id, 'issue', v_delta, auth.uid());
  END IF;

  RETURN NEW;
END;
$function$


-- FN public.assign_current_dealer_to_quote
CREATE OR REPLACE FUNCTION public.assign_current_dealer_to_quote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dealer_id uuid;
begin
  v_dealer_id := public.get_current_user_dealer_id();
  if v_dealer_id is not null then
    new.dealer_id := v_dealer_id;
  end if;
  return new;
end;
$function$


-- FN public.assign_dealer_to_order
CREATE OR REPLACE FUNCTION public.assign_dealer_to_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dealer_id uuid;
begin
  v_dealer_id := public.get_current_user_dealer_id();
  if v_dealer_id is not null then
    new.dealer_id := v_dealer_id;
  elsif new.dealer_id is null and new.quote_id is not null then
    select dealer_id into new.dealer_id
    from public.quotes
    where id = new.quote_id and company_id = new.company_id;
  elsif new.dealer_id is null and new.created_by is not null then
    select dealer_id into new.dealer_id
    from public.app_users
    where id = new.created_by and company_id = new.company_id;
  end if;
  return new;
end;
$function$


-- FN public.audit_existing_business_change
CREATE OR REPLACE FUNCTION public.audit_existing_business_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  row_company_id uuid;
  row_id uuid;
  row_ref text;
  actor record;
  action_suffix text;
begin
  row_company_id := coalesce((to_jsonb(new)->>'company_id')::uuid, (to_jsonb(old)->>'company_id')::uuid);
  row_id := coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid);
  row_ref := coalesce(
    to_jsonb(new)->>tg_argv[2],
    to_jsonb(old)->>tg_argv[2],
    row_id::text
  );

  select full_name, email, role, company_id, dealer_id
  into actor
  from public.app_users
  where id = auth.uid();

  action_suffix := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'edited' when 'DELETE' then 'deleted' else lower(tg_op) end;

  insert into public.audit_logs_enterprise (
    company_id,
    actor_user_id,
    actor_name,
    actor_role,
    actor_company_id,
    actor_dealer_id,
    action_type,
    module_name,
    entity_type,
    entity_id,
    entity_reference_number,
    previous_value,
    new_value,
    change_summary,
    status,
    related_order_id,
    related_quote_id,
    related_inventory_id
  ) values (
    row_company_id,
    auth.uid(),
    coalesce(actor.full_name, actor.email, 'System'),
    actor.role,
    actor.company_id,
    actor.dealer_id,
    tg_argv[0] || '_' || action_suffix,
    tg_argv[1],
    tg_argv[0],
    row_id,
    row_ref,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else '{}'::jsonb end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else '{}'::jsonb end,
    initcap(replace(tg_argv[0], '_', ' ')) || ' ' || action_suffix,
    'success',
    case when tg_argv[0] = 'order' then row_id else null end,
    case when tg_argv[0] = 'quote' then row_id else null end,
    case when tg_argv[0] = 'inventory_item' then row_id else null end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$


-- FN public.complete_production_job_atomic
CREATE OR REPLACE FUNCTION public.complete_production_job_atomic(p_job_id uuid, p_actual_weight_kg numeric, p_actual_pieces integer, p_actual_meters numeric DEFAULT NULL::numeric, p_scrap_weight_kg numeric DEFAULT 0, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_job public.production_jobs%rowtype;
  v_meters numeric;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'Permission denied for production completion' using errcode = '42501';
  end if;
  select * into v_job from public.production_jobs where id = p_job_id and company_id = v_company_id for update;
  if not found then raise exception 'Production job not found for this company'; end if;
  v_meters := coalesce(p_actual_meters, case when p_actual_pieces > 0 and coalesce(v_job.length_per_piece_m, 0) > 0 then p_actual_pieces * v_job.length_per_piece_m else 0 end);
  insert into private.production_completion_authorizations(transaction_id, job_id, company_id, actor_id,
    expected_weight_kg, expected_pieces, expected_meters, expected_scrap_kg)
  values (txid_current(), p_job_id, v_company_id, auth.uid(), round(p_actual_weight_kg, 3), p_actual_pieces,
    round(v_meters, 3), round(coalesce(p_scrap_weight_kg, 0), 3));
  perform private.complete_production_job_atomic(p_job_id, p_actual_weight_kg, p_actual_pieces,
    p_actual_meters, p_scrap_weight_kg, p_remarks);
  delete from private.production_completion_authorizations where transaction_id = txid_current() and job_id = p_job_id;
  return p_job_id;
end;
$function$


-- FN public.consume_api_rate_limit
CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(p_identifier text, p_limit integer, p_window_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  current_entry private.api_rate_limits%rowtype;
  current_time timestamptz := clock_timestamp();
begin
  if length(trim(coalesce(p_identifier, ''))) = 0
    or p_limit < 1
    or p_window_seconds < 1
    or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit parameters';
  end if;

  if random() < 0.01 then
    delete from private.api_rate_limits
    where reset_at < current_time - interval '1 day';
  end if;

  insert into private.api_rate_limits (identifier, request_count, reset_at, updated_at)
  values (p_identifier, 0, current_time + make_interval(secs => p_window_seconds), current_time)
  on conflict (identifier) do nothing;

  select * into current_entry
  from private.api_rate_limits
  where identifier = p_identifier
  for update;

  if current_entry.reset_at <= current_time then
    update private.api_rate_limits
    set request_count = 1,
        reset_at = current_time + make_interval(secs => p_window_seconds),
        updated_at = current_time
    where identifier = p_identifier
    returning * into current_entry;
  elsif current_entry.request_count >= p_limit then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'resetAt', (extract(epoch from current_entry.reset_at) * 1000)::bigint
    );
  else
    update private.api_rate_limits
    set request_count = request_count + 1,
        updated_at = current_time
    where identifier = p_identifier
    returning * into current_entry;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(p_limit - current_entry.request_count, 0),
    'resetAt', (extract(epoch from current_entry.reset_at) * 1000)::bigint
  );
end;
$function$


-- FN public.convert_quote_to_order_atomic
CREATE OR REPLACE FUNCTION public.convert_quote_to_order_atomic(p_quote_id uuid, p_order jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.convert_quote_to_order_atomic(p_quote_id, p_order) $function$


-- FN public.correct_completed_production_output_atomic
CREATE OR REPLACE FUNCTION public.correct_completed_production_output_atomic(p_job_id uuid, p_actual_weight_kg numeric, p_actual_pieces integer, p_actual_meters numeric, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_job public.production_jobs%rowtype;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','production_manager') then
    raise exception 'Only an owner, administrator, or production manager can correct completed output' using errcode = '42501';
  end if;
  if coalesce(p_actual_weight_kg, 0) <= 0 or coalesce(p_actual_pieces, 0) < 0 or coalesce(p_actual_meters, 0) < 0
    or length(btrim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Corrected output and a reason of at least eight characters are required';
  end if;
  select * into v_job from public.production_jobs where id = p_job_id and company_id = v_company_id for update;
  if not found or v_job.status <> 'completed' then raise exception 'Completed production job not found'; end if;
  insert into private.production_output_correction_authorizations(transaction_id, job_id, company_id, actor_id, reason,
    expected_weight_kg, expected_pieces, expected_meters)
  values (txid_current(), p_job_id, v_company_id, auth.uid(), btrim(p_reason), round(p_actual_weight_kg, 3),
    p_actual_pieces, round(p_actual_meters, 3));
  update public.production_jobs set actual_quantity_kg = round(p_actual_weight_kg, 3),
    actual_pieces = p_actual_pieces, actual_meters = round(p_actual_meters, 3), updated_at = now()
  where id = p_job_id and company_id = v_company_id;
  delete from private.production_output_correction_authorizations where transaction_id = txid_current() and job_id = p_job_id;
  return p_job_id;
end;
$function$


-- FN public.create_dealer_order_atomic
CREATE OR REPLACE FUNCTION public.create_dealer_order_atomic(p_dealer_id uuid, p_priority text, p_delivery_address text, p_expected_delivery_date date, p_notes text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.create_dealer_order_atomic($1, $2, $3, $4, $5, $6) $function$


-- FN public.create_dealer_order_from_order_atomic
CREATE OR REPLACE FUNCTION public.create_dealer_order_from_order_atomic(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.create_dealer_order_from_order_atomic(p_order_id) $function$


-- FN public.create_direct_order_atomic
CREATE OR REPLACE FUNCTION public.create_direct_order_atomic(p_order jsonb, p_items jsonb, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select private.create_direct_order_atomic(p_order,p_items,p_idempotency_key);
$function$


-- FN public.create_order_from_quote_with_dealer_stock
CREATE OR REPLACE FUNCTION public.create_order_from_quote_with_dealer_stock(p_quote_id uuid, p_order_number text, p_order_date date, p_expected_dispatch_date date, p_priority text, p_dealer_fulfilled_weight_kg numeric, p_notes text)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'public', 'private'
AS $function$
  select private.create_order_from_quote_with_dealer_stock(
    p_quote_id,
    p_order_number,
    p_order_date,
    p_expected_dispatch_date,
    p_priority,
    p_dealer_fulfilled_weight_kg,
    p_notes
  );
$function$


-- FN public.create_order_from_quote_with_dealer_workflow_atomic
CREATE OR REPLACE FUNCTION public.create_order_from_quote_with_dealer_workflow_atomic(p_quote_id uuid, p_order_number text, p_order_date date, p_expected_dispatch_date date, p_priority text, p_dealer_fulfilled_weight_kg numeric, p_notes text)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'public', 'private'
AS $function$
  select private.create_order_from_quote_with_dealer_workflow_atomic(
    p_quote_id, p_order_number, p_order_date, p_expected_dispatch_date,
    p_priority, p_dealer_fulfilled_weight_kg, p_notes
  )
$function$


-- FN public.create_order_from_quote_with_dealer_workflow_atomic
CREATE OR REPLACE FUNCTION public.create_order_from_quote_with_dealer_workflow_atomic(p_quote_id uuid, p_order_number text, p_order_date date, p_expected_dispatch_date date, p_priority text, p_dealer_fulfilled_weight_kg numeric, p_notes text, p_minimum_handling text, p_override_reason text)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'public', 'private'
AS $function$
  select private.create_order_from_quote_with_dealer_workflow_atomic(
    p_quote_id, p_order_number, p_order_date, p_expected_dispatch_date,
    p_priority, p_dealer_fulfilled_weight_kg, p_notes,
    p_minimum_handling, p_override_reason
  )
$function$


-- FN public.credit_dealer_stock_on_order_cancel
CREATE OR REPLACE FUNCTION public.credit_dealer_stock_on_order_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_ledger jsonb;
  v_released_count integer;
begin
  if tg_op<>'UPDATE' or new.current_stage is distinct from 'cancelled' or old.current_stage='cancelled' then return new; end if;
  if auth.uid() is null or v_company is null or v_role is null or v_role not in ('owner','admin')
    or new.company_id is distinct from v_company or old.company_id is distinct from new.company_id or old.id is distinct from new.id then
    raise exception 'Only active company owners and admins may cancel an order' using errcode='42501';
  end if;

  -- The parent UPDATE holds the order lock. Do not wait on a dispatch that
  -- already owns a reservation and may subsequently need this same order.
  perform 1 from public.profile_stock_reservations reservation
  where reservation.company_id=v_company and reservation.order_id=new.id and reservation.status='active'
  order by reservation.profile_stock_batch_id,reservation.id for update nowait;

  v_ledger := private.profile_stock_reservation_ledger_page(1,'','','created_at','desc',new.id);
  if (v_ledger->>'integrity_ok')::boolean is distinct from true then
    raise exception 'Reservation integrity is unavailable. Reconcile this order before cancellation' using errcode='23514';
  end if;

  update public.profile_stock_reservations set status='cancelled',released_at=now()
  where company_id=v_company and order_id=new.id and status='active';
  get diagnostics v_released_count = row_count;

  insert into public.order_stage_history(company_id,order_id,stage,changed_by,remarks)
  values(v_company,new.id,'cancelled',auth.uid(),
    'Order cancelled and unconsumed reservation holds released. Posted fulfillment remains unchanged; physical returns require a recorded receipt.');
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,metadata_json)
  values(v_company,auth.uid(),'order_cancelled_hold_release','order',new.id,
    jsonb_build_object('released_reservation_count',v_released_count,
      'released_weight_kg',(v_ledger->'summary'->>'open_weight_kg')::numeric,
      'physical_stock_changed',false,'previous_stage',old.current_stage));
  return new;
exception when lock_not_available then
  raise exception 'Order reservations are being changed. Refresh and retry cancellation' using errcode='55P03';
end;
$function$


-- FN public.current_portal_user_owns
CREATE OR REPLACE FUNCTION public.current_portal_user_owns(p_company_id uuid, p_customer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.portal_users
    where id = auth.uid()
      and is_active = true
      and company_id = p_company_id
      and customer_id = p_customer_id
  );
$function$


-- FN public.current_user_has_permission
CREATE OR REPLACE FUNCTION public.current_user_has_permission(permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private'
AS $function$
  select private.current_user_has_permission(permission);
$function$


-- FN public.derive_order_value_from_quote
CREATE OR REPLACE FUNCTION public.derive_order_value_from_quote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_quote record;
begin
  if new.quote_id is null then
    select coalesce(sum(coalesce(final_line_value, 0) + round(coalesce(final_line_value, 0) * coalesce(gst_percent, 0) / 100, 2)), 0)
    into new.order_value from public.order_items where order_id = new.id and company_id = new.company_id;
    return new;
  end if;
  select company_id, customer_id, grand_total into v_quote
  from public.quotes where id = new.quote_id;
  if v_quote.company_id is null or v_quote.company_id <> new.company_id then
    raise exception 'Order quote does not belong to the selected company' using errcode = '23514';
  end if;
  if v_quote.customer_id <> new.customer_id then
    raise exception 'Order customer does not match the selected quote' using errcode = '23514';
  end if;
  new.order_value := coalesce(v_quote.grand_total, 0);
  return new;
end;
$function$


-- FN public.enforce_expense_payment_guards
CREATE OR REPLACE FUNCTION public.enforce_expense_payment_guards()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_expense record;
  v_other_paid numeric(14,2);
begin
  select id, company_id, total_amount, approval_status
    into v_expense
  from public.expense_ledger
  where id = new.expense_ledger_id
  for update;
  if not found then
    raise exception 'Expense not found for this payment';
  end if;
  if v_expense.company_id is distinct from new.company_id then
    raise exception 'Expense payment company does not match the parent expense';
  end if;
  if v_expense.approval_status <> 'approved' then
    raise exception 'Expense must be approved before a payment can be recorded (current status: %)', v_expense.approval_status;
  end if;
  select coalesce(sum(amount_paid), 0)
    into v_other_paid
  from public.expense_payments
  where expense_ledger_id = new.expense_ledger_id
    and company_id = new.company_id
    and id <> new.id;
  if round((v_other_paid + coalesce(new.amount_paid, 0))::numeric, 2) > coalesce(v_expense.total_amount, 0) + 0.01 then
    raise exception 'Expense payments would exceed the approved expense total';
  end if;
  return new;
end;
$function$


-- FN public.enforce_production_completion_integrity
CREATE OR REPLACE FUNCTION public.enforce_production_completion_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_auth private.production_completion_authorizations%rowtype;
  v_correction private.production_output_correction_authorizations%rowtype;
  v_input numeric := 0;
  v_scrap numeric := 0;
  v_tol numeric := 0.5;
begin
  if tg_op = 'DELETE' then
    if old.status = 'completed' then raise exception 'Completed production evidence cannot be deleted'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'completed' then raise exception 'Use the audited production completion workflow'; end if;
    return new;
  end if;

  if old.status = 'completed' then
    select * into v_correction from private.production_output_correction_authorizations
    where transaction_id = txid_current() and job_id = old.id and company_id = old.company_id and actor_id = auth.uid()
    for update;
    if not found then
      if new.status is distinct from old.status
        or (to_jsonb(new) - array['remarks','updated_at']) is distinct from (to_jsonb(old) - array['remarks','updated_at']) then
        raise exception 'Completed production job evidence is immutable outside the audited correction workflow';
      end if;
      return new;
    end if;
    if new.status is distinct from 'completed'
      or new.actual_quantity_kg is distinct from v_correction.expected_weight_kg
      or new.actual_pieces is distinct from v_correction.expected_pieces
      or new.actual_meters is distinct from v_correction.expected_meters
      or (to_jsonb(new) - array['actual_quantity_kg','actual_pieces','actual_meters','updated_at'])
        is distinct from (to_jsonb(old) - array['actual_quantity_kg','actual_pieces','actual_meters','updated_at']) then
      raise exception 'Correction is limited to audited completed output fields';
    end if;
    perform 1 from public.finishing_jobs where company_id = old.company_id and production_job_id = old.id for update;
    perform 1 from public.quality_inspections where company_id = old.company_id and production_job_id = old.id for update;
    perform 1 from public.packaging_jobs where company_id = old.company_id and production_job_id = old.id for update;
    if exists (select 1 from public.quality_inspections where company_id = old.company_id and production_job_id = old.id and status <> 'pending')
      or exists (select 1 from public.finishing_jobs where company_id = old.company_id and production_job_id = old.id and status not in ('planned','not_required'))
      or exists (select 1 from public.packaging_jobs where company_id = old.company_id and production_job_id = old.id and status <> 'scheduled')
      or exists (select 1 from public.packaging_material_movements movement join public.packaging_jobs package on package.id = movement.packaging_job_id
        where movement.company_id = old.company_id and package.production_job_id = old.id)
      or exists (select 1 from public.packing_list_items where company_id = old.company_id and source_line_id = old.id) then
      raise exception 'Completed output cannot be corrected after downstream QC, finishing, packaging, or dispatch evidence exists';
    end if;
    if exists (select 1 from public.quality_inspections where company_id = old.company_id and production_job_id = old.id
      and status = 'pending' and quantity_checked_kg > new.actual_quantity_kg + 0.001) then
      raise exception 'Corrected output is below the quantity already assigned to pending QC';
    end if;
    select coalesce(sum(weight_kg), 0) into v_input from public.foundry_billets
    where company_id = old.company_id and production_job_id = old.id and status in ('allocated','issued','consumed');
    select coalesce(sum(weight_kg), 0) into v_scrap from public.scrap_records
    where company_id = old.company_id and production_job_id = old.id;
    v_tol := greatest(0.5, round((v_input * 0.01)::numeric, 3));
    if v_input > 0 and abs(v_input - round((new.actual_quantity_kg + v_scrap)::numeric, 3)) > v_tol then
      raise exception 'Corrected output would violate billet mass balance';
    end if;
    insert into public.production_output_corrections(company_id, production_job_id, changed_by, reason,
      prior_weight_kg, prior_pieces, prior_meters, corrected_weight_kg, corrected_pieces, corrected_meters)
    values (old.company_id, old.id, auth.uid(), v_correction.reason, old.actual_quantity_kg, old.actual_pieces,
      old.actual_meters, new.actual_quantity_kg, new.actual_pieces, new.actual_meters);
    update public.finishing_jobs set input_weight_kg = new.actual_quantity_kg, updated_at = now()
    where company_id = old.company_id and production_job_id = old.id and status = 'planned';
    update public.quality_inspections set quantity_checked_kg = new.actual_quantity_kg, updated_at = now()
    where company_id = old.company_id and production_job_id = old.id and status = 'pending'
      and abs(quantity_checked_kg - old.actual_quantity_kg) <= 0.001;
    update public.packaging_jobs set profile_weight_kg = new.actual_quantity_kg,
      pieces = new.actual_pieces, profile_length_m = new.actual_meters, updated_at = now()
    where company_id = old.company_id and production_job_id = old.id and status = 'scheduled';
    return new;
  end if;

  if new.status = 'completed' then
    select * into v_auth from private.production_completion_authorizations
    where transaction_id = txid_current() and job_id = new.id and company_id = new.company_id and actor_id = auth.uid()
    for update;
    if not found or new.actual_quantity_kg is distinct from v_auth.expected_weight_kg
      or new.actual_pieces is distinct from v_auth.expected_pieces
      or new.actual_meters is distinct from v_auth.expected_meters then
      raise exception 'Only the validated completion workflow can record final production output' using errcode = '42501';
    end if;
    select coalesce(sum(weight_kg), 0) into v_input from public.foundry_billets
    where company_id = new.company_id and production_job_id = new.id and status in ('allocated','issued','consumed');
    select coalesce(sum(weight_kg), 0) into v_scrap from public.scrap_records
    where company_id = new.company_id and production_job_id = new.id;
    v_tol := greatest(0.5, round((v_input * 0.01)::numeric, 3));
    if v_input > 0 and abs(v_input - round((new.actual_quantity_kg + v_scrap + v_auth.expected_scrap_kg)::numeric, 3)) > v_tol then
      raise exception 'Billet mass balance failed: linked input % kg, accounted output and scrap % kg, tolerance % kg',
        v_input, new.actual_quantity_kg + v_scrap + v_auth.expected_scrap_kg, v_tol using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$


-- FN public.enforce_security_log_company_consistency
CREATE OR REPLACE FUNCTION public.enforce_security_log_company_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  resolved_company_id UUID;
BEGIN
  SELECT company_id
    INTO resolved_company_id
  FROM public.app_users
  WHERE id = NEW.user_id;

  IF resolved_company_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve company for user_id %', NEW.user_id USING ERRCODE = '23514';
  END IF;

  IF NEW.company_id IS NULL THEN
    NEW.company_id := resolved_company_id;
  END IF;

  IF NEW.company_id IS DISTINCT FROM resolved_company_id THEN
    RAISE EXCEPTION 'company_id does not match user company' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$


-- FN public.ensure_inventory_item_for_expense_source
CREATE OR REPLACE FUNCTION public.ensure_inventory_item_for_expense_source(p_company_id uuid, p_item_code text, p_item_name text, p_item_category text, p_unit text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item_id uuid;
begin
  select id into v_item_id
  from public.inventory_items
  where company_id = p_company_id and item_code = p_item_code
  limit 1;

  if v_item_id is null then
    insert into public.inventory_items (
      company_id,
      item_code,
      item_name,
      item_category,
      unit,
      current_stock,
      reorder_level,
      average_rate,
      is_active
    )
    values (
      p_company_id,
      p_item_code,
      p_item_name,
      p_item_category,
      p_unit,
      0,
      0,
      0,
      true
    )
    returning id into v_item_id;
  end if;

  return v_item_id;
end;
$function$


-- FN public.expense_apply_totals
CREATE OR REPLACE FUNCTION public.expense_apply_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_paid numeric(14,2) := 0;
  v_refunded numeric(14,2) := 0;
  v_credited numeric(14,2) := 0;
  v_last_payment date;
  v_net numeric(14,2);
  v_derive boolean;
begin
  new.quantity := coalesce(new.quantity, 0);
  new.rate := coalesce(new.rate, 0);
  new.base_amount := coalesce(new.base_amount, 0);
  new.tax_amount := coalesce(new.tax_amount, 0);
  new.freight_amount := coalesce(new.freight_amount, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);
  new.currency := coalesce(nullif(btrim(new.currency), ''), 'INR');

  -- Totals are always derived on insert and whenever any component (or the total itself)
  -- is written. Untouched historical rows keep their stored total until edited, so a
  -- legacy mismatch is reported instead of silently restating an approved payable.
  v_derive := tg_op = 'INSERT' or (new.quantity, new.rate, new.base_amount, new.tax_amount,
    new.freight_amount, new.discount_amount, new.total_amount)
    is distinct from (old.quantity, old.rate, old.base_amount, old.tax_amount,
    old.freight_amount, old.discount_amount, old.total_amount);
  if v_derive then
    if new.base_amount = 0 and new.quantity > 0 and new.rate > 0 then
      new.base_amount := round(new.quantity * new.rate, 2);
    end if;
    new.total_amount := round(new.base_amount + new.tax_amount + new.freight_amount - new.discount_amount, 2);
    if new.total_amount < 0 then
      raise exception 'Expense discount cannot exceed base, tax and freight amounts' using errcode = '23514';
    end if;
  else
    new.total_amount := old.total_amount;
  end if;

  -- Settlement projections are owned by the payment and supplier-credit ledgers.
  if tg_op = 'UPDATE' then
    select coalesce(sum(p.amount_paid) filter (where p.status = 'posted'), 0),
           max(p.payment_date) filter (where p.status = 'posted')
      into v_paid, v_last_payment
    from public.expense_payments p
    where p.company_id = new.company_id and p.expense_ledger_id = new.id;
    select coalesce(sum(c.amount) filter (where c.status = 'posted' and c.credit_type = 'credit_note'), 0),
           coalesce(sum(c.amount) filter (where c.status = 'posted' and c.credit_type = 'refund'), 0)
      into v_credited, v_refunded
    from public.expense_supplier_credits c
    where c.company_id = new.company_id and c.expense_ledger_id = new.id;
  end if;

  if v_refunded > v_paid then
    raise exception 'Supplier refunds cannot exceed posted supplier payments. Reverse the refund first.' using errcode = '23514';
  end if;
  v_net := v_paid - v_refunded;
  if v_net > new.total_amount then
    raise exception 'Posted supplier payments exceed the expense total' using errcode = '23514';
  end if;
  if v_credited > new.total_amount then
    raise exception 'Supplier credit notes exceed the expense total' using errcode = '23514';
  end if;

  new.amount_paid := v_paid;
  new.refunded_amount := v_refunded;
  new.credited_amount := v_credited;
  new.balance_amount := greatest(round(new.total_amount - v_net - v_credited, 2), 0);
  new.supplier_credit_due := greatest(round(v_net + v_credited - new.total_amount, 2), 0);

  if new.approval_status in ('cancelled', 'reversed') then
    new.payment_status := new.approval_status;
  elsif new.total_amount > 0 and new.balance_amount = 0 then
    new.payment_status := 'paid';
  elsif new.balance_amount > 0 and new.due_date is not null and new.due_date < private.business_today() then
    new.payment_status := 'overdue';
  elsif v_net > 0 or v_credited > 0 then
    new.payment_status := 'partially_paid';
  else
    new.payment_status := 'unpaid';
  end if;
  -- The settlement date is the latest posted supplier payment, never the edit date.
  new.paid_date := case when new.payment_status = 'paid' then v_last_payment else null end;

  new.updated_at := now();
  return new;
end;
$function$


-- FN public.expense_generate_number
CREATE OR REPLACE FUNCTION public.expense_generate_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.expense_number is null or btrim(new.expense_number) = '' then
    new.expense_number := concat('EXP-', to_char(now(), 'YYYYMMDDHH24MISS'), '-', upper(substring(replace(new.id::text, '-', '') from 1 for 6)));
  end if;
  return new;
end;
$function$


-- FN private.get_current_user_company_id
CREATE OR REPLACE FUNCTION private.get_current_user_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select company_id from public.app_users where id = auth.uid() and is_active = true;
$function$


-- FN private.get_current_user_dealer_id
CREATE OR REPLACE FUNCTION private.get_current_user_dealer_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select dealer_id from public.app_users where id = auth.uid() and is_active = true;
$function$


-- FN private.get_current_user_role
CREATE OR REPLACE FUNCTION private.get_current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from public.app_users where id = auth.uid() and is_active = true;
$function$


-- FN private.get_financial_collection_events
CREATE OR REPLACE FUNCTION private.get_financial_collection_events(p_start_date date)
 RETURNS TABLE(event_id uuid, payment_date date, amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for collection events' using errcode = '42501';
  end if;
  return query
  select p.id, p.payment_date, case when p.payment_type = 'REFUND' then -p.amount else p.amount end
  from public.payments p
  where p.company_id = v_company_id
    and p.payment_status = 'PAID'
    and p.payment_method <> 'credit_note'
    and (p_start_date is null or p.payment_date >= p_start_date)
  order by p.payment_date, p.id;
end;
$function$


-- FN private.guard_cancelled_order_reservations
CREATE OR REPLACE FUNCTION private.guard_cancelled_order_reservations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_stage text;
begin
  if new.status is distinct from 'active' then return new; end if;
  -- Serialize new holds with cancellation. NOWAIT avoids row/order lock inversion
  -- when a direct reservation UPDATE has already locked its own row.
  select current_stage into v_stage from public.orders
  where id=new.order_id and company_id=new.company_id for update nowait;
  if not found then raise exception 'Reservation order is unavailable' using errcode='23514'; end if;
  if v_stage='cancelled' then raise exception 'A cancelled order cannot acquire active stock reservations' using errcode='23514'; end if;
  return new;
exception when lock_not_available then
  raise exception 'Reservation order is being changed. Refresh and retry' using errcode='55P03';
end;
$function$


-- FN private.guard_completed_billet_inputs
CREATE OR REPLACE FUNCTION private.guard_completed_billet_inputs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_job public.production_jobs%rowtype;
  v_completion_authorized boolean := false;
begin
  if tg_op in ('UPDATE','DELETE') and old.production_job_id is not null then
    select * into v_job from public.production_jobs where id = old.production_job_id and company_id = old.company_id for update nowait;
    if found and v_job.status = 'completed' then
      v_completion_authorized := tg_op = 'UPDATE' and (
        (to_jsonb(new) - array['updated_at']) is not distinct from (to_jsonb(old) - array['updated_at'])
        or (old.status in ('allocated','issued') and new.status = 'consumed'
          and (to_jsonb(new) - array['status','updated_at']) is not distinct from (to_jsonb(old) - array['status','updated_at'])
          and exists(select 1 from private.production_completion_authorizations completion_auth
            where completion_auth.transaction_id=txid_current() and completion_auth.job_id=old.production_job_id
              and completion_auth.company_id=old.company_id and completion_auth.actor_id=auth.uid()))
      );
      if not v_completion_authorized then raise exception 'Billet inputs linked to completed production are immutable'; end if;
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.production_job_id is not null then
    select * into v_job from public.production_jobs where id = new.production_job_id and company_id = new.company_id for update nowait;
    if found and v_job.status = 'completed' then
      v_completion_authorized := tg_op = 'UPDATE' and (
        (to_jsonb(new) - array['updated_at']) is not distinct from (to_jsonb(old) - array['updated_at'])
        or (old.status in ('allocated','issued') and new.status = 'consumed'
          and old.production_job_id is not distinct from new.production_job_id
          and (to_jsonb(new) - array['status','updated_at']) is not distinct from (to_jsonb(old) - array['status','updated_at'])
          and exists(select 1 from private.production_completion_authorizations completion_auth
            where completion_auth.transaction_id=txid_current() and completion_auth.job_id=new.production_job_id
              and completion_auth.company_id=new.company_id and completion_auth.actor_id=auth.uid()))
      );
      if not v_completion_authorized then raise exception 'Billet inputs linked to completed production are immutable'; end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
exception when lock_not_available then
  raise exception 'Production input is being finalized; retry the billet change' using errcode = '55P03';
end;
$function$


-- FN private.guard_completed_production_scrap
CREATE OR REPLACE FUNCTION private.guard_completed_production_scrap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_job_id uuid;
  v_job public.production_jobs%rowtype;
  v_auth private.production_completion_authorizations%rowtype;
  v_job_found boolean := false;
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    v_job_id := old.production_job_id;
    if v_job_id is not null then
      select * into v_job from public.production_jobs where id = v_job_id and company_id = old.company_id for update nowait;
      v_job_found := found;
    end if;
    if v_job_found and v_job.status = 'completed' then
      raise exception 'Scrap linked to completed production is immutable';
    end if;
    if tg_op = 'DELETE' then return old; end if;
  end if;
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    if new.production_job_id is not null then
      select * into v_job from public.production_jobs where id = new.production_job_id and company_id = new.company_id for update nowait;
      v_job_found := found;
    else
      v_job_found := false;
    end if;
    if v_job_found and v_job.status = 'completed' then
      select * into v_auth from private.production_completion_authorizations
      where transaction_id = txid_current() and job_id = new.production_job_id and company_id = new.company_id
        and actor_id = auth.uid() and expected_scrap_kg = new.weight_kg and scrap_inserted = false
      for update;
      if not found then raise exception 'Scrap linked to completed production requires the audited completion workflow'; end if;
      update private.production_completion_authorizations set scrap_inserted = true
      where transaction_id = v_auth.transaction_id and job_id = v_auth.job_id;
    end if;
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Production output is being finalized or corrected; retry the scrap change' using errcode = '55P03';
end;
$function$


-- FN private.guard_configuration_child
CREATE OR REPLACE FUNCTION private.guard_configuration_child()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare c public.system_configurations%rowtype; r jsonb; ref record; valid_ref boolean;
begin
  r := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op='UPDATE' and (new.company_id is distinct from old.company_id or new.configuration_id is distinct from old.configuration_id) then
    raise exception 'Calculation lineage is immutable';
  end if;
  select * into c from public.system_configurations where id=(r->>'configuration_id')::uuid and company_id=(r->>'company_id')::uuid for update;
  if not found then
    -- Parent deletion already passed the lifecycle guard before its FK cascade.
    if tg_op='DELETE' then return old; end if;
    raise exception 'Configuration not found for this company';
  end if;
  if c.order_id is not null or c.quote_id is not null or c.status::text in ('in_production','converted_to_order') then
    raise exception 'Linked configuration calculations are immutable';
  end if;
  for ref in select * from (values ('profile_id','aluminium_profiles'),('glass_id','glass_items'),('hardware_item_id','hardware_items')) as refs(col,tab) loop
    if nullif(r->>ref.col,'') is not null then
      execute format('select exists(select 1 from public.%I where id=$1 and company_id=$2)',ref.tab) into valid_ref using (r->>ref.col)::uuid, c.company_id;
      if not valid_ref then raise exception 'Calculation reference belongs to another company'; end if;
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$


-- FN private.guard_configuration_cut_snapshot
CREATE OR REPLACE FUNCTION private.guard_configuration_cut_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_editable text[] := array['updated_at','drawing_document_id','drawing_revision','drawing_approval_status',
    'section_number','section_code','section_name','customer_component_code','component_description',
    'packing_instruction','customer_packing_requirement','internal_note','item_description'];
begin
  if old.configuration_cut_snapshot is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='DELETE' then raise exception 'Configuration cut lineage and allocated commercial totals are immutable; preserve the source quote'; end if;
  if (to_jsonb(new)-v_editable) is distinct from (to_jsonb(old)-v_editable) then
    raise exception 'Configuration cut lineage and allocated commercial totals are immutable; use an approved new configuration for revised quantities or pricing';
  end if;
  return new;
end;
$function$


-- FN private.guard_configuration_lifecycle
CREATE OR REPLACE FUNCTION private.guard_configuration_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare ref record; valid_ref boolean;
begin
  if tg_op = 'DELETE' then
    if old.order_id is not null or old.quote_id is not null or old.status::text in ('in_production','converted_to_order') then
      raise exception 'Linked configurations cannot be deleted';
    end if;
    return old;
  end if;
  for ref in select * from (values ('customer_id','customers'),('series_id','system_series'),('template_id','system_templates'),('finish_id','finish_options'),('glass_id','glass_items'),('quote_id','quotes'),('order_id','orders')) as refs(col,tab) loop
    if nullif(to_jsonb(new)->>ref.col,'') is not null then
      execute format('select exists(select 1 from public.%I where id=$1 and company_id=$2)',ref.tab) into valid_ref using (to_jsonb(new)->>ref.col)::uuid,new.company_id;
      if not valid_ref then raise exception 'Configuration reference belongs to another company'; end if;
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    if old.company_id is distinct from new.company_id then raise exception 'Configuration company is immutable'; end if;
    if (old.order_id is not null or old.quote_id is not null or old.status::text in ('in_production','converted_to_order'))
      and (to_jsonb(old) - array['updated_at','status','order_id'] is distinct from to_jsonb(new) - array['updated_at','status','order_id']
        or (old.order_id is not null and old.order_id is distinct from new.order_id)
        or new.status::text in ('draft','calculated')) then
      raise exception 'Linked configurations are immutable; create a new configuration for revisions';
    end if;
    if old.status::text = 'in_production' and new.status is distinct from old.status then raise exception 'Production-linked configuration cannot be reset'; end if;
  end if;
  if new.status::text = 'in_production' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if coalesce(private.get_current_user_role(),'') not in ('owner','admin','production_manager','factory_manager') or new.order_id is null
      or not exists (select 1 from public.production_jobs where company_id=new.company_id and order_id=new.order_id) then
      raise exception 'Use the production handoff to enter production' using errcode='42501';
    end if;
  end if;
  return new;
end;
$function$


-- FN private.guard_direct_order_snapshots
CREATE OR REPLACE FUNCTION private.guard_direct_order_snapshots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order uuid;
  v_company uuid;
  v_allowed boolean;
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name='orders' then
    if tg_op in ('UPDATE','DELETE') then v_order:=old.id; v_company:=old.company_id;
    else v_order:=new.id; v_company:=new.company_id; end if;
  else
    if tg_op='DELETE' then v_order:=old.order_id; v_company:=old.company_id;
    else v_order:=new.order_id; v_company:=new.company_id; end if;
    if tg_op='UPDATE' and exists(select 1 from private.direct_order_requests where order_id=old.order_id and company_id=old.company_id) then
      raise exception 'Direct order lines are immutable; create a corrected order after reviewing existing commitments';
    end if;
  end if;
  if not exists(select 1 from private.direct_order_requests where order_id=v_order and company_id=v_company) then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  select exists(select 1 from private.direct_order_requests where order_id=v_order and company_id=v_company
    and transaction_id=txid_current() and actor_id=auth.uid() and not completed) into v_allowed;
  if tg_op='INSERT' and v_allowed then return new; end if;
  if tg_table_name='orders' and tg_op='UPDATE' then
    if jsonb_build_array(new.id,new.company_id,new.customer_id,new.quote_id,new.dealer_id,new.order_number,new.order_date,
      new.requested_weight_kg,new.manufacturing_weight_kg,new.dealer_fulfilled_weight_kg,new.production_profile_id,new.production_die_id,
      new.production_quantity_kg,new.production_pieces,new.billet_diameter_required_inch)
      is not distinct from jsonb_build_array(old.id,old.company_id,old.customer_id,old.quote_id,old.dealer_id,old.order_number,old.order_date,
      old.requested_weight_kg,old.manufacturing_weight_kg,old.dealer_fulfilled_weight_kg,old.production_profile_id,old.production_die_id,
      old.production_quantity_kg,old.production_pieces,old.billet_diameter_required_inch)
      and (new.order_value is not distinct from old.order_value or v_allowed) then return new; end if;
  end if;
  raise exception 'Direct order commercial snapshots are immutable; review commitments and create a corrected order';
end;
$function$


-- FN private.guard_expense_settlement_row
CREATE OR REPLACE FUNCTION private.guard_expense_settlement_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_mutable text[] := array['status','reversed_at','reversed_by','reversal_reason','reversal_idempotency_key','updated_at'];
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('extrusionos.allow_ledger_purge', true), '') <> 'on' then
      raise exception 'Supplier payment and credit history cannot be deleted. Reverse the entry instead.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'posted' and new.status = 'reversed'
    and new.reversed_at is not null and nullif(btrim(coalesce(new.reversal_reason, '')), '') is not null
    and (to_jsonb(new) - v_mutable) = (to_jsonb(old) - v_mutable) then
    return new;
  end if;
  raise exception 'Posted supplier payments and credits are immutable. Reverse the entry and post a correction.' using errcode = '42501';
end;
$function$


-- FN private.guard_finishing_material_lineage
CREATE OR REPLACE FUNCTION private.guard_finishing_material_lineage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if tg_op='UPDATE' and (to_jsonb(new)-'updated_at') is not distinct from (to_jsonb(old)-'updated_at') then return new; end if;
  perform 1 from public.production_jobs where id=new.production_job_id and company_id=new.company_id for update nowait;
  if not found then raise exception 'Finishing production source is unavailable'; end if;
  perform private.assert_finishing_material_lineage(new.company_id,new.production_job_id);
  return new;
exception when lock_not_available then
  raise exception 'Production material is being updated; refresh and retry finishing' using errcode='55P03';
end;
$function$


-- FN private.guard_low_margin_quote_approval
CREATE OR REPLACE FUNCTION private.guard_low_margin_quote_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if auth.uid() is not null and old.low_margin_approval_required and new.status in ('approved_for_sending','sent','customer_approved')
    and private.get_current_user_role() not in ('owner','admin') then
    raise exception 'Only owners and admins may approve low-margin quotations' using errcode='42501';
  end if;
  return new;
end;
$function$


-- FN private.guard_order_item_workflow_writes
CREATE OR REPLACE FUNCTION private.guard_order_item_workflow_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_role text := private.get_current_user_role();
begin
  if auth.uid() is null or v_role in ('owner','admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='INSERT' and current_user<>'authenticated' then
    if exists(select 1 from private.direct_order_requests request
      where request.transaction_id=txid_current() and request.company_id=new.company_id
        and request.order_id=new.order_id and request.actor_id=auth.uid() and not request.completed) then
      return new;
    end if;
  end if;
  if tg_op='UPDATE' and current_user<>'authenticated' then
  if exists(
    select 1 from private.quote_fulfillment_authorizations auth_record
    join public.orders order_record on order_record.quote_id=auth_record.quote_id
      and order_record.company_id=auth_record.company_id
    where auth_record.transaction_id=txid_current() and auth_record.company_id=new.company_id
      and order_record.id=new.order_id and auth_record.actor_id=auth.uid()
  ) then
    if (to_jsonb(new)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','updated_at'])
      is distinct from (to_jsonb(old)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','updated_at'])
      or new.dealer_fulfilled_weight_kg < 0 or new.manufacturing_weight_kg < 0
      or not exists(
        select 1 from public.quote_items source
        where source.id=new.quote_item_id and source.company_id=new.company_id
          and abs(coalesce(source.billing_weight_kg,source.total_weight_kg,0)
            -new.dealer_fulfilled_weight_kg-new.manufacturing_weight_kg)<=0.001
      ) then
      raise exception 'Quote fulfillment may only reconcile its exact source-line balances' using errcode='42501';
    end if;
    return new;
  end if;
  end if;
  if tg_op <> 'INSERT' or current_user = 'authenticated' then
    raise exception 'Order lines must be created or changed through an authorized order workflow' using errcode='42501';
  end if;
  if new.quote_item_id is null or new.source_line_id is distinct from new.quote_item_id or not exists (
    select 1 from public.quote_items qi
    join public.orders o on o.id=new.order_id and o.company_id=new.company_id
    where qi.id=new.quote_item_id and qi.company_id=new.company_id
      and qi.quote_id=o.quote_id
  ) then
    raise exception 'Operational order lines must preserve the approved quote line source' using errcode='42501';
  end if;
  return new;
end;
$function$


-- FN private.guard_order_workflow_writes
CREATE OR REPLACE FUNCTION private.guard_order_workflow_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_role text := private.get_current_user_role();
begin
  if auth.uid() is null or v_role in ('owner','admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if current_user = 'authenticated' then
    raise exception 'Orders must be created or changed through an authorized order workflow' using errcode='42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Only owners and admins may delete orders' using errcode='42501';
  end if;
  if tg_op='UPDATE' and exists(select 1 from private.direct_order_requests request
    where request.transaction_id=txid_current() and request.company_id=new.company_id
      and request.order_id=new.id and request.actor_id=auth.uid() and not request.completed)
    and (to_jsonb(new)-array['order_value','updated_at']) is not distinct from (to_jsonb(old)-array['order_value','updated_at']) then
    return new;
  end if;
  if tg_op='UPDATE' and exists(
    select 1 from private.quote_fulfillment_authorizations auth_record
    where auth_record.transaction_id=txid_current() and auth_record.company_id=new.company_id
      and auth_record.quote_id=new.quote_id and auth_record.actor_id=auth.uid()
  ) then
    if (to_jsonb(new)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','fulfillment_notes','updated_at'])
      is distinct from (to_jsonb(old)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','fulfillment_notes','updated_at'])
      or new.dealer_fulfilled_weight_kg < 0
      or new.manufacturing_weight_kg < 0
      or abs(new.requested_weight_kg-new.dealer_fulfilled_weight_kg-new.manufacturing_weight_kg)>0.001 then
      raise exception 'Quote fulfillment may only reconcile its authorized physical balances' using errcode='42501';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.order_number is distinct from old.order_number
    or new.quote_id is distinct from old.quote_id
    or new.customer_id is distinct from old.customer_id
    or new.dealer_id is distinct from old.dealer_id
    or new.order_date is distinct from old.order_date
    or new.order_value is distinct from old.order_value
    or new.requested_weight_kg is distinct from old.requested_weight_kg
    or new.manufacturing_weight_kg is distinct from old.manufacturing_weight_kg
    or new.production_profile_id is distinct from old.production_profile_id
    or new.production_die_id is distinct from old.production_die_id
    or new.production_quantity_kg is distinct from old.production_quantity_kg
    or new.production_pieces is distinct from old.production_pieces
    or new.billet_diameter_required_inch is distinct from old.billet_diameter_required_inch
  ) then
    raise exception 'Order value, source, identity, and production requirements cannot be changed through the operational order workflow' using errcode='42501';
  end if;
  if tg_op = 'INSERT' and v_role in ('production','production_manager','factory_manager','dispatch_manager','dispatch','inventory_manager')
    and new.quote_id is null and coalesce(new.order_value, 0) <> 0 then
    raise exception 'Operational order creation cannot set a manual commercial value; use an approved quote' using errcode='42501';
  end if;
  return new;
end;
$function$


-- FN private.guard_packaging_evidence_delete
CREATE OR REPLACE FUNCTION private.guard_packaging_evidence_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if old.production_job_id is not null then
    perform 1 from public.production_jobs where id=old.production_job_id and company_id=old.company_id for update nowait;
  end if;
  if old.status in ('completed','cancelled')
    or exists(select 1 from public.packaging_material_movements where packaging_job_id=old.id)
    or exists(select 1 from public.packaging_job_materials where job_id=old.id)
    or (old.production_job_id is not null and exists(select 1 from public.packing_list_items where company_id=old.company_id and source_line_id=old.production_job_id)) then
    raise exception 'Packaging with terminal, material or packing evidence cannot be deleted; retain its recorded history' using errcode='23514';
  end if;
  return old;
exception when lock_not_available then
  raise exception 'Production material is being updated; refresh and retry packaging maintenance' using errcode='55P03';
end;
$function$


-- FN private.guard_packaging_finishing_source
CREATE OR REPLACE FUNCTION private.guard_packaging_finishing_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_job public.production_jobs%rowtype;v_output numeric;v_other numeric;
begin
  select * into v_job from public.production_jobs where id=new.production_job_id and company_id=new.company_id for update nowait;
  if not found or v_job.order_id is distinct from new.order_id or v_job.status<>'completed' then
    raise exception 'Packaging source must be completed production for this company and order';
  end if;
  if tg_op='UPDATE' and (old.company_id is distinct from new.company_id or old.order_id is distinct from new.order_id
    or old.production_job_id is distinct from new.production_job_id
    or (old.finishing_job_id is not null and old.finishing_job_id is distinct from new.finishing_job_id)) then
    raise exception 'Packaging receipt source cannot be changed after assignment';
  end if;
  if new.status='cancelled' then return new; end if;
  if coalesce(v_job.finishing_type,'mill_finish')='mill_finish' then
    if new.finishing_job_id is not null then raise exception 'Mill-finish packaging must not claim a finishing receipt'; end if;
    return new;
  end if;
  if new.finishing_job_id is null then raise exception 'Choose the queued package or accepted finishing receipt before saving packaging'; end if;
  v_output:=private.finishing_accepted_output_kg(new.company_id,new.production_job_id,new.finishing_job_id);
  if v_output<=0 then raise exception 'Packaging requires a final accepted finishing receipt for this production job'; end if;
  select coalesce(sum(profile_weight_kg),0) into v_other from public.packaging_jobs
    where company_id=new.company_id and production_job_id=new.production_job_id and finishing_job_id=new.finishing_job_id
      and status<>'cancelled' and id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid);
  if coalesce(new.profile_weight_kg,0)<0 or v_other+coalesce(new.profile_weight_kg,0)>v_output+0.001
    or (new.status='completed' and coalesce(new.profile_weight_kg,0)<=0) then
    raise exception 'Packaging weight exceeds or lacks its recorded accepted finishing portion';
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Production material is being updated; refresh and retry packaging' using errcode='55P03';
end;
$function$


-- FN private.guard_packaging_material_movement_evidence
CREATE OR REPLACE FUNCTION private.guard_packaging_material_movement_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  raise exception 'Packaging material movements are append-only; retain the posted evidence' using errcode='23514';
end;
$function$


-- FN private.guard_production_order_balance
CREATE OR REPLACE FUNCTION private.guard_production_order_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order public.orders%rowtype;
  v_line public.order_items%rowtype;
  v_target numeric;
  v_committed numeric;
  v_stock numeric;
  v_line_count integer;
  v_exclude_job_id uuid;
begin
  if tg_op = 'UPDATE' then v_exclude_job_id := old.id; end if;
  if tg_op = 'UPDATE' and old.order_id is not distinct from new.order_id and old.source_line_id is not distinct from new.source_line_id
    and old.planned_quantity_kg is not distinct from new.planned_quantity_kg and old.actual_quantity_kg is not distinct from new.actual_quantity_kg
    and old.status is not distinct from new.status then return new; end if;
  if new.order_id is null or new.status = 'cancelled' then return new; end if;
  select * into v_order from public.orders where id = new.order_id and company_id = new.company_id for update nowait;
  if not found or v_order.current_stage in ('closed','cancelled','delivered','payment_pending') then
    raise exception 'Order is not available for production commitment' using errcode = '23514';
  end if;
  select count(*) into v_line_count from public.order_items where company_id = new.company_id and order_id = new.order_id;
  if v_line_count > 0 then
    if new.source_line_id is null then raise exception 'Select the exact order line before committing production quantity'; end if;
    select * into v_line from public.order_items where id = new.source_line_id and company_id = new.company_id and order_id = new.order_id for update nowait;
    if not found then raise exception 'Production order line does not belong to the selected order'; end if;
    v_target := v_line.quantity_kg;
    if v_target is null and v_line_count = 1 then v_target := coalesce(v_order.production_quantity_kg, v_order.manufacturing_weight_kg); end if;
    if v_target is null or v_target <= 0 then raise exception 'Order line lacks an authoritative kilogram quantity for safe production planning'; end if;
    select coalesce(sum(case when job.status = 'completed' and coalesce(job.actual_quantity_kg, 0) > 0 then job.actual_quantity_kg else job.planned_quantity_kg end), 0)
      into v_committed from public.production_jobs job
      where job.company_id = new.company_id and job.order_id = new.order_id and job.source_line_id = new.source_line_id
        and job.status <> 'cancelled' and (v_exclude_job_id is null or job.id <> v_exclude_job_id);
    select coalesce(sum(fulfilled_weight_kg), 0) into v_stock from public.order_dealer_stock_fulfillments
      where company_id = new.company_id and order_id = new.order_id and order_item_id = new.source_line_id and credited_at is null;
  else
    v_target := coalesce(v_order.production_quantity_kg, v_order.manufacturing_weight_kg, 0);
    select coalesce(sum(case when job.status = 'completed' and coalesce(job.actual_quantity_kg, 0) > 0 then job.actual_quantity_kg else job.planned_quantity_kg end), 0)
      into v_committed from public.production_jobs job
      where job.company_id = new.company_id and job.order_id = new.order_id and job.status <> 'cancelled'
        and (v_exclude_job_id is null or job.id <> v_exclude_job_id);
    select coalesce(sum(fulfilled_weight_kg), 0) into v_stock from public.order_dealer_stock_fulfillments
      where company_id = new.company_id and order_id = new.order_id and credited_at is null;
  end if;
  if v_target <= 0 or v_committed + v_stock + (case when new.status = 'completed' then coalesce(new.actual_quantity_kg, 0) else coalesce(new.planned_quantity_kg, 0) end) > v_target + 0.001 then
    raise exception 'Production commitment exceeds the order line remaining kilogram balance';
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Order or line balance is being changed; retry production planning after refresh' using errcode = '55P03';
end;
$function$


-- FN private.guard_profile_reservation_capacity
CREATE OR REPLACE FUNCTION private.guard_profile_reservation_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_batch public.profile_stock_batches%rowtype;
  v_other_weight numeric;
  v_other_length numeric;
  v_other_pieces bigint;
  v_own_weight numeric := 0;
  v_own_length numeric := 0;
  v_own_pieces bigint := 0;
begin
  if tg_op = 'UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.profile_stock_batch_id is distinct from old.profile_stock_batch_id
    or new.profile_id is distinct from old.profile_id
    or new.order_id is distinct from old.order_id
    or new.configuration_id is distinct from old.configuration_id
  ) then
    raise exception 'Reservation source is immutable';
  end if;

  if new.configuration_id is not null then
    perform 1 from public.system_configurations
    where id = new.configuration_id and company_id = new.company_id and order_id = new.order_id
    for update;
    if not found then raise exception 'Reservation configuration must match its order and company'; end if;
  end if;

  select * into v_batch
  from public.profile_stock_batches
  where id = new.profile_stock_batch_id and company_id = new.company_id
  for update;
  if not found or v_batch.profile_id is distinct from new.profile_id then
    raise exception 'Reservation batch must match its profile and company';
  end if;
  if not exists (select 1 from public.orders where id = new.order_id and company_id = new.company_id) then
    raise exception 'Reservation order not found';
  end if;

  if tg_op = 'INSERT' and new.status = 'active' then
    new.initial_reserved_weight_kg := new.reserved_weight_kg;
    new.initial_reserved_pieces := new.reserved_pieces;
    new.initial_reserved_length_m := new.reserved_length_m;
  elsif tg_op = 'UPDATE' then
    if new.initial_reserved_weight_kg is distinct from old.initial_reserved_weight_kg
      or new.initial_reserved_pieces is distinct from old.initial_reserved_pieces
      or new.initial_reserved_length_m is distinct from old.initial_reserved_length_m then
      raise exception 'Initial reservation quantities are immutable';
    end if;
    if old.status in ('released','consumed','cancelled') and new.status = 'active' then
      raise exception 'A terminal stock reservation cannot be reactivated';
    end if;
    if old.status = 'consumed' and new.status is distinct from 'consumed' then
      raise exception 'A consumed stock reservation is terminal';
    end if;
  end if;

  if new.status = 'active' then
    if new.initial_reserved_weight_kg is null or new.initial_reserved_pieces is null or new.initial_reserved_length_m is null then
      raise exception 'Legacy active reservation lacks exact immutable source units and requires data repair';
    end if;
    if v_batch.status not in ('available', 'reserved') then raise exception 'Stock batch is not available'; end if;
    if new.reserved_weight_kg <= 0 or new.reserved_length_m <= 0 or coalesce(new.reserved_pieces, 0) <= 0 then
      raise exception 'Active stock reservations require exact positive kilograms, metres, and whole pieces';
    end if;
    if coalesce(v_batch.quantity_pieces, 0) <= 0
      or abs(new.reserved_weight_kg - (v_batch.total_weight_kg * new.reserved_pieces / v_batch.quantity_pieces)) > 0.01
      or abs(new.reserved_length_m - (v_batch.length_m * new.reserved_pieces / v_batch.quantity_pieces)) > 0.001 then
      raise exception 'Reservation kilograms and metres must match the exact whole-piece source ratio';
    end if;
    if tg_op = 'UPDATE' and old.status = 'active' and (
      new.reserved_weight_kg is distinct from old.reserved_weight_kg
      or new.reserved_length_m is distinct from old.reserved_length_m
      or new.reserved_pieces is distinct from old.reserved_pieces
    ) then raise exception 'Active reservation quantities are immutable'; end if;

    if tg_op = 'UPDATE' then
      select coalesce(sum(consumed_weight_kg), 0), coalesce(sum(consumed_length_m), 0), coalesce(sum(consumed_pieces), 0)
      into v_own_weight, v_own_length, v_own_pieces
      from public.profile_stock_consumptions
      where reservation_id = old.id and company_id = old.company_id;
    end if;

    select
      coalesce(sum(r.reserved_weight_kg - coalesce(c.weight_kg, 0)), 0),
      coalesce(sum(r.reserved_length_m - coalesce(c.length_m, 0)), 0),
      coalesce(sum(coalesce(r.reserved_pieces, 0) - coalesce(c.pieces, 0)), 0)
    into v_other_weight, v_other_length, v_other_pieces
    from public.profile_stock_reservations r
    left join lateral (
      select sum(consumed_weight_kg) weight_kg, sum(consumed_length_m) length_m, sum(consumed_pieces) pieces
      from public.profile_stock_consumptions
      where reservation_id = r.id and company_id = r.company_id
    ) c on true
    where r.profile_stock_batch_id = v_batch.id and r.company_id = v_batch.company_id
      and r.status = 'active' and r.id <> new.id;

    if v_other_weight + greatest(new.reserved_weight_kg - v_own_weight, 0) > v_batch.total_weight_kg + 0.001
      or v_other_length + greatest(new.reserved_length_m - v_own_length, 0) > v_batch.length_m + 0.001
      or v_other_pieces + greatest(new.reserved_pieces - v_own_pieces, 0) > v_batch.quantity_pieces then
      raise exception 'Insufficient stock: active reservations exceed exact batch capacity';
    end if;
  elsif new.status = 'consumed' then
    select coalesce(sum(consumed_weight_kg), 0), coalesce(sum(consumed_length_m), 0), coalesce(sum(consumed_pieces), 0)
    into v_own_weight, v_own_length, v_own_pieces
    from public.profile_stock_consumptions
    where reservation_id = new.id and company_id = new.company_id;
    if new.initial_reserved_weight_kg is null or new.initial_reserved_length_m is null or new.initial_reserved_pieces is null
      or abs(v_own_weight - new.initial_reserved_weight_kg) > 0.001
      or abs(v_own_length - new.initial_reserved_length_m) > 0.001
      or v_own_pieces <> new.initial_reserved_pieces then
      raise exception 'A reservation can be consumed only after its exact reserved units are posted';
    end if;
  end if;
  return new;
end;
$function$


-- FN private.guard_quality_resolution_child
CREATE OR REPLACE FUNCTION private.guard_quality_resolution_child()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_auth private.quality_resolution_authorizations%rowtype;
begin
  if new.resolution_id is null then return new; end if;
  select * into v_auth from private.quality_resolution_authorizations
  where transaction_id = txid_current() and resolution_id = new.resolution_id and actor_id = auth.uid() and children_remaining > 0
  for update;
  if not found then raise exception 'Quality rework resolutions must use the audited resolution action' using errcode = '42501'; end if;
  update private.quality_resolution_authorizations set children_remaining = children_remaining - 1
  where transaction_id = v_auth.transaction_id and resolution_id = v_auth.resolution_id;
  return new;
end;
$function$


-- FN private.guard_quality_resolution_immutability
CREATE OR REPLACE FUNCTION private.guard_quality_resolution_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if old.resolution_id is not null or exists (
    select 1 from public.quality_rework_resolutions resolution
    where resolution.company_id = old.company_id and resolution.source_inspection_id = old.id
  ) then
    raise exception 'Resolved rework source and disposition evidence are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$


-- FN private.guard_quote_cost_writes
CREATE OR REPLACE FUNCTION private.guard_quote_cost_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if auth.uid() is null or private.get_current_user_role() in ('owner','admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if private.get_current_user_role() not in ('owner','admin') then
    raise exception 'Only owners and admins may create or change priced quote lines' using errcode='42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$


-- FN private.guard_quote_header_cost_writes
CREATE OR REPLACE FUNCTION private.guard_quote_header_cost_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if auth.uid() is null or private.get_current_user_role() in ('owner','admin') then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.subtotal,0) <> 0 or coalesce(new.total_before_gst,0) <> 0
      or coalesce(new.gst_amount,0) <> 0 or coalesce(new.grand_total,0) <> 0
      or coalesce(new.total_margin_amount,0) <> 0 or coalesce(new.estimated_profit_amount,0) <> 0
      or coalesce(new.estimated_profit_percent,0) <> 0 then
      raise exception 'Only owners and admins may set priced quote totals' using errcode='42501';
    end if;
    return new;
  end if;
  if new.subtotal is distinct from old.subtotal
    or new.total_before_gst is distinct from old.total_before_gst
    or new.gst_amount is distinct from old.gst_amount
    or new.grand_total is distinct from old.grand_total
    or new.total_margin_amount is distinct from old.total_margin_amount
    or new.estimated_profit_amount is distinct from old.estimated_profit_amount
    or new.estimated_profit_percent is distinct from old.estimated_profit_percent then
    raise exception 'Only owners and admins may change priced quote totals' using errcode='42501';
  end if;
  return new;
end;
$function$


-- FN private.guard_quote_relationship_writes
CREATE OR REPLACE FUNCTION private.guard_quote_relationship_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if auth.uid() is null or private.get_current_user_role() in ('owner','admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Only owners and admins may create quotations' using errcode='42501';
  end if;
  if new.company_id is distinct from old.company_id
    or new.customer_id is distinct from old.customer_id
    or new.dealer_id is distinct from old.dealer_id
    or new.created_by is distinct from old.created_by then
    raise exception 'Quotation company, customer, dealer, and creator cannot be changed through the workflow' using errcode='42501';
  end if;
  return new;
end;
$function$


-- FN private.guard_reserved_stock_capacity
CREATE OR REPLACE FUNCTION private.guard_reserved_stock_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_reserved_weight numeric;
  v_reserved_length numeric;
  v_reserved_pieces bigint;
begin
  select
    coalesce(sum(r.reserved_weight_kg - coalesce(c.weight_kg, 0)), 0),
    coalesce(sum(r.reserved_length_m - coalesce(c.length_m, 0)), 0),
    coalesce(sum(coalesce(r.reserved_pieces, 0) - coalesce(c.pieces, 0)), 0)
  into v_reserved_weight, v_reserved_length, v_reserved_pieces
  from public.profile_stock_reservations r
  left join lateral (
    select sum(consumed_weight_kg) weight_kg, sum(consumed_length_m) length_m, sum(consumed_pieces) pieces
    from public.profile_stock_consumptions
    where reservation_id = r.id and company_id = r.company_id
  ) c on true
  where r.company_id = old.company_id and r.profile_stock_batch_id = old.id and r.status = 'active';

  if new.company_id is distinct from old.company_id or new.profile_id is distinct from old.profile_id
    or new.total_weight_kg + 0.001 < v_reserved_weight
    or new.length_m + 0.001 < v_reserved_length
    or new.quantity_pieces < v_reserved_pieces
    or (v_reserved_weight > 0 and new.status not in ('available', 'reserved')) then
    raise exception 'Release or consume active reservations before changing reserved stock';
  end if;
  return new;
end;
$function$


-- FN private.guard_self_app_user_security_fields
CREATE OR REPLACE FUNCTION private.guard_self_app_user_security_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private'
AS $function$
begin
  if auth.uid() = old.id and (
    new.id is distinct from old.id
    or new.company_id is distinct from old.company_id
    or new.role is distinct from old.role
    or new.dealer_id is distinct from old.dealer_id
    or new.branch_id is distinct from old.branch_id
    or new.is_active is distinct from old.is_active
    or new.status is distinct from old.status
    or new.organization_type is distinct from old.organization_type
    or new.invited_by is distinct from old.invited_by
    or new.invited_at is distinct from old.invited_at
    or new.role_changed_by is distinct from old.role_changed_by
    or new.role_changed_at is distinct from old.role_changed_at
    or new.deactivated_by is distinct from old.deactivated_by
    or new.deactivated_at is distinct from old.deactivated_at
  ) then
    raise exception 'Users cannot modify their own access scope or security status'
      using errcode = '42501';
  end if;

  return new;
end;
$function$


-- FN private.guard_terminal_finishing_evidence
CREATE OR REPLACE FUNCTION private.guard_terminal_finishing_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.status in ('completed', 'rejected', 'not_required') then
      raise exception 'Terminal finishing evidence cannot be deleted; retain the original movement and disposition'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if old.status in ('completed', 'rejected', 'not_required')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'Terminal finishing evidence is immutable; retain the original movement and disposition'
      using errcode = '23514';
  end if;
  return new;
end;
$function$


-- FN private.handoff_system_configuration_to_production_atomic
CREATE OR REPLACE FUNCTION private.handoff_system_configuration_to_production_atomic(p_configuration_id uuid, p_jobs jsonb, p_remarks text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_configuration public.system_configurations%rowtype;
  v_quote_status text;
  v_order_id uuid;
  v_order_number text;
  v_job_number text;
  v_job jsonb;
  v_profile_id uuid;
  v_die_id uuid;
  v_source_line_id uuid;
  v_line_count integer;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if coalesce(v_role,'') not in ('owner', 'admin', 'factory_manager', 'production_manager') then
    raise exception 'Permission denied for production handoff' using errcode = '42501';
  end if;

  select * into v_configuration
  from public.system_configurations
  where id = p_configuration_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'System configuration not found for this company' using errcode = '23514';
  end if;

  if v_configuration.status = 'in_production'
     and v_configuration.order_id is not null
     and exists (
       select 1 from public.production_jobs job
       where job.company_id = v_company_id
         and job.order_id = v_configuration.order_id
         and job.remarks ilike '%' || coalesce(v_configuration.configuration_number, 'System configuration') || '%'
     ) then
    return v_configuration.order_id;
  end if;
  if v_configuration.customer_id is null then
    raise exception 'Link a customer before creating production jobs' using errcode = '23514';
  end if;
  if v_configuration.status::text not in ('calculated', 'quoted', 'approved', 'converted_to_order') then
    raise exception 'Calculate and approve the configuration before production handoff' using errcode = '23514';
  end if;
  if jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) = 0 then
    raise exception 'At least one profile cut with positive weight is required for production jobs' using errcode = '23514';
  end if;

  if v_configuration.quote_id is not null then
    select status into v_quote_status
    from public.quotes
    where id = v_configuration.quote_id and company_id = v_company_id
    for update;
    if not found then
      raise exception 'Linked quote is not available for this company' using errcode = '23514';
    end if;
    if v_quote_status not in ('customer_approved', 'converted_to_order') then
      raise exception 'Customer approval is required before this configuration can enter production' using errcode = '23514';
    end if;
  end if;

  v_order_id := v_configuration.order_id;
  if v_order_id is null and v_configuration.quote_id is not null then
    select id into v_order_id
    from public.orders
    where company_id = v_company_id and quote_id = v_configuration.quote_id
    order by created_at
    limit 1
    for update;
  end if;

  if v_order_id is null then
    v_order_number := private.next_business_number_locked(
      'public.orders'::regclass, 'order_number', v_company_id, 'O', (now() at time zone 'Asia/Kolkata')::date
    );
    insert into public.orders (
      company_id, order_number, quote_id, customer_id, order_date, priority,
      current_stage, order_value, notes, created_by
    ) values (
      v_company_id, v_order_number, v_configuration.quote_id,
      v_configuration.customer_id, (now() at time zone 'Asia/Kolkata')::date, 'normal', 'extrusion_planned',
      coalesce(v_configuration.grand_total, 0),
      'Generated from ' || coalesce(p_remarks, 'system configuration'), auth.uid()
    ) returning id into v_order_id;
  else
    perform 1 from public.orders
    where id = v_order_id and company_id = v_company_id
    for update;
    if not found then
      raise exception 'Linked order is not available for this company' using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1 from public.production_jobs job
    where job.company_id = v_company_id
      and job.order_id = v_order_id
      and job.remarks ilike '%' || coalesce(v_configuration.configuration_number, 'System configuration') || '%'
  ) then
    raise exception 'Production handoff already exists for this configuration' using errcode = '23505';
  end if;

  for v_job in select value from jsonb_array_elements(p_jobs)
  loop
    v_profile_id := nullif(v_job ->> 'profile_id', '')::uuid;
    v_die_id := nullif(v_job ->> 'die_id', '')::uuid;
    if v_profile_id is null or v_die_id is null or coalesce((v_job ->> 'planned_quantity_kg')::numeric, 0) <= 0 then
      raise exception 'Every production job requires a profile, usable die, and positive planned weight' using errcode = '23514';
    end if;
    perform 1
    from public.aluminium_profiles profile
    join public.dies die
      on die.id = v_die_id
     and die.company_id = profile.company_id
     and die.profile_id = profile.id
    where profile.id = v_profile_id
      and profile.company_id = v_company_id
      and profile.is_active is distinct from false
      and die.die_status not in ('inactive', 'dead', 'blocked', 'retired', 'scrapped', 'under_maintenance');
    if not found then
      raise exception 'Every system profile needs a usable matching die before production handoff' using errcode = '23514';
    end if;

    v_source_line_id := nullif(v_job ->> 'source_line_id', '')::uuid;
    if v_source_line_id is null then
      select count(*), (array_agg(id order by id))[1] into v_line_count, v_source_line_id
      from public.order_items where company_id=v_company_id and order_id=v_order_id and profile_id=v_profile_id;
      if v_line_count > 1 then raise exception 'Select the exact order line for this profile'; end if;
    end if;
    if exists(select 1 from public.order_items where company_id=v_company_id and order_id=v_order_id) and v_source_line_id is null then
      raise exception 'No matching order line for this configuration profile';
    end if;
    if v_source_line_id is not null and not exists(select 1 from public.order_items where id=v_source_line_id and company_id=v_company_id and order_id=v_order_id and profile_id=v_profile_id) then
      raise exception 'Production source line must belong to the selected order and profile';
    end if;
    v_job_number := private.next_business_number_locked(
      'public.production_jobs'::regclass, 'job_number', v_company_id, 'J', (now() at time zone 'Asia/Kolkata')::date
    );
    insert into public.production_jobs (
      company_id, order_id, job_number, profile_id, die_id, source_line_id,
      planned_quantity_kg, planned_meters, planned_date, status, remarks, created_by
    ) values (
      v_company_id, v_order_id, v_job_number, v_profile_id, v_die_id, v_source_line_id,
      (v_job ->> 'planned_quantity_kg')::numeric,
      greatest(coalesce((v_job ->> 'planned_meters')::numeric, 0), 0),
      (now() at time zone 'Asia/Kolkata')::date, 'planned', nullif(v_job ->> 'remarks', ''), auth.uid()
    );
  end loop;

  update public.orders
  set current_stage = 'extrusion_planned', updated_at = now()
  where id = v_order_id and company_id = v_company_id;

  insert into public.order_stage_history (company_id, order_id, stage, changed_by, remarks)
  values (
    v_company_id, v_order_id, 'extrusion_planned', auth.uid(),
    'Production jobs created from ' || coalesce(v_configuration.configuration_number, 'system configuration')
  );

  update public.system_configurations
  set order_id = v_order_id, status = 'in_production', updated_at = now()
  where id = p_configuration_id and company_id = v_company_id;

  if v_configuration.quote_id is not null and v_quote_status = 'customer_approved' then
    update public.quotes
    set status = 'converted_to_order', updated_at = now()
    where id = v_configuration.quote_id and company_id = v_company_id;
  end if;

  return v_order_id;
end;
$function$


-- FN private.indian_financial_year
CREATE OR REPLACE FUNCTION private.indian_financial_year(p_date date)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p_date is null then null
    when extract(month from p_date) >= 4 then extract(year from p_date)::integer
    else extract(year from p_date)::integer - 1 end
$function$


-- FN private.insert_jsonb_row
CREATE OR REPLACE FUNCTION private.insert_jsonb_row(p_table regclass, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_columns text;
  v_values text;
  v_id uuid;
begin
  select
    string_agg(format('%I', a.attname), ', ' order by a.attnum),
    string_agg(format('r.%I', a.attname), ', ' order by a.attnum)
  into v_columns, v_values
  from pg_attribute a
  where a.attrelid = p_table
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and a.attidentity = ''
    and p_payload ? a.attname;

  if v_columns is null then
    raise exception 'No writable fields were supplied';
  end if;

  execute format(
    'insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) r returning id',
    p_table, v_columns, v_values, p_table
  ) using p_payload into v_id;
  return v_id;
end;
$function$


-- FN private.invoice_dispatch_is_billable
CREATE OR REPLACE FUNCTION private.invoice_dispatch_is_billable(p_company_id uuid, p_order_id uuid, p_dispatch_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order public.orders%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_cancelled_at timestamptz;
begin
  select * into v_order from public.orders where id=p_order_id and company_id=p_company_id;
  if not found or v_order.deleted_at is not null then return false; end if;
  select * into v_dispatch from public.dispatches where id=p_dispatch_id and company_id=p_company_id and order_id=p_order_id;
  if not found or v_dispatch.delivery_status is null or v_dispatch.delivery_status not in ('pending','dispatched','in_transit','delivered') then return false; end if;
  if v_order.current_stage is distinct from 'cancelled' then return true; end if;

  select max(changed_at) into v_cancelled_at from public.order_stage_history
  where company_id=p_company_id and order_id=p_order_id and stage='cancelled';
  if v_cancelled_at is null or v_cancelled_at::text in ('infinity','-infinity') or v_cancelled_at>now()
    or v_dispatch.delivery_status not in ('dispatched','in_transit','delivered')
    or v_dispatch.actual_dispatched_at is null or v_dispatch.actual_dispatched_at::text in ('infinity','-infinity')
    or v_dispatch.created_at is null or v_dispatch.created_at::text in ('infinity','-infinity')
    or v_dispatch.created_at>v_dispatch.actual_dispatched_at or v_dispatch.actual_dispatched_at>v_cancelled_at
    or v_dispatch.total_weight_kg is null or v_dispatch.total_weight_kg<=0
    or v_dispatch.total_weight_kg::text in ('NaN','Infinity','-Infinity') then return false; end if;

  return (
    with packing as materialized (
      select * from public.packing_list_items where company_id=p_company_id and dispatch_id=p_dispatch_id
    ), source_groups as (
      select source_kind,source_record_id,source_line_id,reservation_id,profile_stock_batch_id,profile_id,
        sum(net_weight_kg) weight_kg,sum(net_length_m) length_m,sum(number_of_pieces) pieces
      from packing group by source_kind,source_record_id,source_line_id,reservation_id,profile_stock_batch_id,profile_id
    ), posted_source_totals as (
      select item.source_kind,item.source_record_id,item.source_line_id,item.profile_id,
        sum(item.net_weight_kg) weight_kg,sum(item.net_length_m) length_m,sum(item.number_of_pieces) pieces,
        bool_and(item.net_weight_kg is not null and item.net_weight_kg>0 and item.net_weight_kg::text not in ('NaN','Infinity','-Infinity')
          and item.net_length_m is not null and item.net_length_m>0 and item.net_length_m::text not in ('NaN','Infinity','-Infinity')
          and item.number_of_pieces is not null and item.number_of_pieces>0) valid_units
      from public.packing_list_items item join public.dispatches dispatch_record
        on dispatch_record.id=item.dispatch_id and dispatch_record.company_id=item.company_id
      where dispatch_record.company_id=p_company_id and dispatch_record.order_id=p_order_id
        and dispatch_record.actual_dispatched_at is not null
      group by item.source_kind,item.source_record_id,item.source_line_id,item.profile_id
    )
    select exists(select 1 from packing)
      and abs((select sum(net_weight_kg) from packing)-v_dispatch.total_weight_kg)<=0.001 and not exists(
      select 1 from packing where profile_id is null or source_kind is null
        or net_weight_kg is null or net_weight_kg<=0 or net_weight_kg::text in ('NaN','Infinity','-Infinity')
        or net_length_m is null or net_length_m<=0 or net_length_m::text in ('NaN','Infinity','-Infinity')
        or number_of_pieces is null or number_of_pieces<=0
        or net_rate is null or net_rate<=0 or net_rate::text in ('NaN','Infinity','-Infinity')
        or operator_verified_by is null or operator_verified_at is null
        or operator_verified_at::text in ('infinity','-infinity') or operator_verified_at>v_dispatch.actual_dispatched_at
        or not exists(select 1 from public.app_users verifier where verifier.id=packing.operator_verified_by and verifier.company_id=p_company_id)
    ) and not exists (
      select 1 from public.profile_stock_consumptions consumed where consumed.dispatch_id=p_dispatch_id
        and not exists(select 1 from source_groups source where source.source_kind='reservation'
          and consumed.company_id=p_company_id and consumed.order_id=p_order_id
          and consumed.reservation_id=source.reservation_id and consumed.profile_id=source.profile_id
          and consumed.profile_stock_batch_id=source.profile_stock_batch_id
          and abs(consumed.consumed_weight_kg-source.weight_kg)<=0.001
          and abs(consumed.consumed_length_m-source.length_m)<=0.001 and consumed.consumed_pieces=source.pieces)
    ) and not exists (
      select 1 from source_groups source where not coalesce(case source.source_kind
        when 'reservation' then exists(
          select 1 from public.profile_stock_reservations reservation
          join public.profile_stock_batches batch on batch.id=reservation.profile_stock_batch_id and batch.company_id=reservation.company_id and batch.profile_id=reservation.profile_id
          join public.profile_stock_consumptions consumed on consumed.reservation_id=reservation.id and consumed.company_id=reservation.company_id
            and consumed.dispatch_id=p_dispatch_id and consumed.order_id=p_order_id
            and consumed.profile_id=reservation.profile_id and consumed.profile_stock_batch_id=reservation.profile_stock_batch_id
          where reservation.company_id=p_company_id and reservation.order_id=p_order_id and reservation.id=source.reservation_id
            and source.source_record_id=p_order_id and source.source_line_id=reservation.id
            and source.profile_id=reservation.profile_id and source.profile_stock_batch_id=reservation.profile_stock_batch_id
            and consumed.created_at is not null and consumed.created_at::text not in ('infinity','-infinity') and consumed.created_at<=v_cancelled_at
            and abs(consumed.consumed_weight_kg-source.weight_kg)<=0.001
            and abs(consumed.consumed_length_m-source.length_m)<=0.001 and consumed.consumed_pieces=source.pieces
        )
        when 'dealer_stock' then exists(
          select 1 from public.order_dealer_stock_fulfillments fulfillment
          join public.profile_stock_batches batch on batch.id=fulfillment.profile_stock_batch_id and batch.company_id=fulfillment.company_id and batch.profile_id=fulfillment.profile_id
          join posted_source_totals posted on posted.source_kind=source.source_kind and posted.source_line_id=source.source_line_id
            and posted.source_record_id=source.source_record_id and posted.profile_id=source.profile_id
          where fulfillment.id=source.source_line_id and fulfillment.company_id=p_company_id and fulfillment.order_id=p_order_id
            and source.source_record_id=p_order_id and fulfillment.profile_id=source.profile_id and fulfillment.credited_at is null
            and (source.profile_stock_batch_id is null or source.profile_stock_batch_id=fulfillment.profile_stock_batch_id)
            and fulfillment.created_at is not null and fulfillment.created_at::text not in ('infinity','-infinity') and fulfillment.created_at<=v_dispatch.actual_dispatched_at
            and fulfillment.fulfilled_weight_kg::text not in ('NaN','Infinity','-Infinity') and fulfillment.fulfilled_length_m::text not in ('NaN','Infinity','-Infinity')
            and posted.valid_units and posted.weight_kg<=fulfillment.fulfilled_weight_kg+0.001 and posted.length_m<=fulfillment.fulfilled_length_m+0.001
            and posted.pieces<=fulfillment.fulfilled_pieces
        )
        when 'production' then exists(
          select 1 from public.production_jobs job
          join posted_source_totals posted on posted.source_kind=source.source_kind and posted.source_line_id=source.source_line_id
            and posted.source_record_id=source.source_record_id and posted.profile_id=source.profile_id
          where job.id=source.source_line_id and source.source_record_id=p_order_id and job.company_id=p_company_id and job.order_id=p_order_id
            and job.profile_id=source.profile_id and job.status='completed'
            and job.completed_at is not null and job.completed_at::text not in ('infinity','-infinity') and job.completed_at<=v_dispatch.actual_dispatched_at
            and job.actual_quantity_kg::text not in ('NaN','Infinity','-Infinity') and job.actual_meters::text not in ('NaN','Infinity','-Infinity')
            and posted.valid_units and posted.weight_kg<=job.actual_quantity_kg+0.001 and posted.length_m<=job.actual_meters+0.001
            and posted.pieces<=job.actual_pieces
        ) else false end,false)
    )
  );
end;
$function$


-- FN private.invoice_live_status
CREATE OR REPLACE FUNCTION private.invoice_live_status(p_status text, p_balance numeric, p_due_date date, p_as_of date DEFAULT NULL::date)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'private'
AS $function$
  select case
    when p_status in ('sent', 'partially_paid') and coalesce(p_balance, 0) > 0 and p_due_date is not null
      and p_due_date < coalesce(p_as_of, private.business_today()) then 'overdue'
    else p_status
  end
$function$


-- FN private.is_owner_or_admin
CREATE OR REPLACE FUNCTION private.is_owner_or_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select role in ('owner','admin') from public.app_users where id = auth.uid() and is_active = true), false);
$function$


-- FN private.is_valid_delivery_transition
CREATE OR REPLACE FUNCTION private.is_valid_delivery_transition(p_from text, p_to text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_from = p_to
    or (p_from = 'pending' and p_to = 'dispatched')
    or (p_from = 'dispatched' and p_to in ('in_transit','delivered','delayed','damaged','returned'))
    or (p_from = 'in_transit' and p_to in ('delivered','delayed','damaged','returned'))
    or (p_from = 'delayed' and p_to in ('dispatched','in_transit','delivered','damaged','returned'))
    or (p_from = 'damaged' and p_to = 'returned')
    or (p_from = 'delivered' and p_to = 'returned')
$function$


-- FN private.issue_dispatch_return_credit_note_atomic
CREATE OR REPLACE FUNCTION private.issue_dispatch_return_credit_note_atomic(p_dispatch_id uuid, p_reason text, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_dispatch public.dispatches%rowtype;
  v_invoice public.invoices%rowtype;
  v_credit_id uuid;
  v_existing public.credit_notes%rowtype;
  v_items jsonb;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role is null or v_role not in ('owner','admin','accounts') then
    raise exception 'Permission denied for credit notes' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Credit note idempotency key is required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then raise exception 'Enter a clear return or damage reason'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_company_id::text || ':dispatch-credit-note:' || p_idempotency_key::text, 0
  ));
  select * into v_existing from public.credit_notes
  where company_id = v_company_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.dispatch_id is distinct from p_dispatch_id
      or trim(v_existing.reason) is distinct from trim(p_reason) then
      raise exception 'This retry key is already used for different credit note details. Refresh the dispatch and review its existing note before starting a correction.';
    end if;
    return v_existing.id;
  end if;

  select * into v_dispatch from public.dispatches
  where id = p_dispatch_id and company_id = v_company_id for update;
  if not found then raise exception 'Dispatch not found for this company'; end if;
  if v_dispatch.delivery_status not in ('returned','damaged') then
    raise exception 'A credit note can only be issued for a returned or damaged dispatch';
  end if;

  select * into v_invoice from public.invoices
  where company_id = v_company_id and dispatch_id = p_dispatch_id and status <> 'cancelled'
  for update;
  if not found then raise exception 'No issued invoice is linked to this dispatch'; end if;
  if v_invoice.status = 'draft' then raise exception 'Cancel the draft invoice instead of issuing a credit note'; end if;
  if exists (select 1 from public.credit_notes where company_id = v_company_id and dispatch_id = p_dispatch_id and status = 'issued') then
    raise exception 'An issued credit note already exists for this dispatch';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) - array['company_id','invoice_id']), '[]'::jsonb)
  into v_items
  from public.invoice_items item
  where item.company_id = v_company_id and item.invoice_id = v_invoice.id;

  insert into public.credit_notes(
    company_id, invoice_id, dispatch_id, credit_note_number, credit_date,
    reason, subtotal, tax_total, grand_total, item_snapshot,
    idempotency_key, created_by
  ) values (
    v_company_id, v_invoice.id, p_dispatch_id,
    private.next_business_number_locked(
      'public.credit_notes'::regclass, 'credit_note_number', v_company_id, 'CN',
      (now() at time zone 'Asia/Kolkata')::date
    ),
    (now() at time zone 'Asia/Kolkata')::date,
    trim(p_reason), v_invoice.subtotal, v_invoice.tax_total, v_invoice.grand_total,
    v_items, p_idempotency_key, auth.uid()
  ) returning id into v_credit_id;

  update public.invoices
  set credited_amount = (
        select coalesce(sum(note.grand_total), 0)
        from public.credit_notes note
        where note.company_id = v_company_id and note.invoice_id = v_invoice.id and note.status = 'issued'
      ),
      updated_at = now()
  where id = v_invoice.id and company_id = v_company_id;
  perform private.recalculate_invoice_collection_state(v_invoice.id, v_company_id);

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (v_company_id, auth.uid(), 'dispatch_credit_note_issued', 'credit_note', v_credit_id,
    jsonb_build_object('invoice_id', v_invoice.id, 'dispatch_id', p_dispatch_id, 'amount', v_invoice.grand_total, 'reason', trim(p_reason)));
  return v_credit_id;
end;
$function$


-- FN private.keep_jsonb_keys
CREATE OR REPLACE FUNCTION private.keep_jsonb_keys(p_payload jsonb, p_allowed text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'private'
AS $function$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from jsonb_each(coalesce(p_payload, '{}'::jsonb)) e
  where e.key = any(p_allowed);
$function$


-- FN private.lock_invoiced_packing_list
CREATE OR REPLACE FUNCTION private.lock_invoiced_packing_list()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid;
  v_dispatch_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_company_id := old.company_id;
    v_dispatch_id := old.dispatch_id;
    perform pg_advisory_xact_lock(hashtextextended(
      'dispatch-invoice:' || v_company_id::text || ':' || v_dispatch_id::text,
      0
    ));
    if exists (
      select 1
      from public.invoices i
      where i.company_id = v_company_id
        and i.dispatch_id = v_dispatch_id
        and i.status <> 'cancelled'
    ) then
      raise exception 'Packing rows are locked after an active invoice is created for the dispatch';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_company_id := new.company_id;
    v_dispatch_id := new.dispatch_id;
    perform pg_advisory_xact_lock(hashtextextended(
      'dispatch-invoice:' || v_company_id::text || ':' || v_dispatch_id::text,
      0
    ));
    if exists (
      select 1
      from public.invoices i
      where i.company_id = v_company_id
        and i.dispatch_id = v_dispatch_id
        and i.status <> 'cancelled'
    ) then
      raise exception 'Packing rows are locked after an active invoice is created for the dispatch';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$


-- FN private.log_expense_supplier_credit_audit
CREATE OR REPLACE FUNCTION private.log_expense_supplier_credit_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (
    coalesce(new.company_id, old.company_id), auth.uid(),
    case when tg_op = 'INSERT' then 'expense_supplier_' || new.credit_type || '_posted'
      when tg_op = 'UPDATE' then 'expense_supplier_' || new.credit_type || '_reversed'
      else 'expense_supplier_credit_deleted' end,
    'expense_supplier_credits', coalesce(new.id, old.id),
    jsonb_build_object('before', case when tg_op <> 'INSERT' then to_jsonb(old) end,
      'after', case when tg_op <> 'DELETE' then to_jsonb(new) end)
  );
  return coalesce(new, old);
end;
$function$


-- FN private.mark_linked_quote_converted
CREATE OR REPLACE FUNCTION private.mark_linked_quote_converted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if new.quote_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.quote_id is not distinct from new.quote_id
     and old.company_id is not distinct from new.company_id
     and old.customer_id is not distinct from new.customer_id then
    return new;
  end if;

  update public.quotes
  set status = 'converted_to_order', updated_at = now()
  where id = new.quote_id
    and company_id = new.company_id
    and customer_id = new.customer_id
    and status = 'customer_approved';
  if not found then
    raise exception 'Linked quote could not be finalized as converted to order';
  end if;
  return new;
end;
$function$


-- FN private.metric_quote_is_open
CREATE OR REPLACE FUNCTION private.metric_quote_is_open(p_status text, p_valid_until date, p_as_of date)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_status in ('approved_for_sending', 'sent', 'customer_approved')
    and (p_valid_until is null or p_valid_until >= p_as_of);
$function$


-- FN private.next_business_number_locked
CREATE OR REPLACE FUNCTION private.next_business_number_locked(p_table regclass, p_number_column text, p_company_id uuid, p_prefix text, p_business_date date)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_stem text := p_prefix || '-' || extract(year from coalesce(p_business_date, (now() at time zone 'Asia/Kolkata')::date))::text || '-';
  v_sequence bigint;
begin
  if nullif(p_prefix, '') is null or p_company_id is null then raise exception 'Number prefix and company are required'; end if;
  if not exists (select 1 from pg_attribute where attrelid = p_table and attname = p_number_column and attnum > 0 and not attisdropped) then
    raise exception 'Invalid business number column';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || p_table::text || ':' || v_stem, 0));
  execute format('select coalesce(max(substring(%1$I from length($2) + 1)::bigint), 0) + 1 from %2$s where company_id = $1 and left(%1$I, length($2)) = $2 and substring(%1$I from length($2) + 1) ~ ''^[0-9]+$''', p_number_column, p_table)
    using p_company_id, v_stem into v_sequence;
  return v_stem || lpad(v_sequence::text, greatest(4, length(v_sequence::text)), '0');
end;
$function$


-- FN private.notification_visible_to_current_user
CREATE OR REPLACE FUNCTION private.notification_visible_to_current_user(p_company_id uuid, p_recipient_user_id uuid, p_recipient_role text, p_dealer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select coalesce(
    auth.uid() is not null
    and p_company_id = private.get_current_user_company_id()
    and (
      p_recipient_user_id = auth.uid()
      or (
        p_recipient_user_id is null
        and (p_recipient_role is null or p_recipient_role = private.get_current_user_role())
        and (
          p_dealer_id is null
          or private.get_current_user_dealer_id() is null
          or p_dealer_id = private.get_current_user_dealer_id()
        )
      )
    ),
    false
  );
$function$


-- FN private.onboard_company_atomic
CREATE OR REPLACE FUNCTION private.onboard_company_atomic(p_company jsonb, p_profile jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_company_id uuid;
  v_company_name text := nullif(trim(p_company ->> 'name'), '');
  v_full_name text := nullif(trim(p_profile ->> 'full_name'), '');
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_company_name is null or v_full_name is null then
    raise exception 'Company name and user name are required';
  end if;

  if exists (select 1 from public.app_users where id = v_user_id) then
    raise exception 'This user already belongs to a company';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  insert into public.companies (
    name, legal_name, gst_number, phone, email, city, state,
    billing_address, created_by
  ) values (
    v_company_name,
    nullif(trim(p_company ->> 'legal_name'), ''),
    nullif(trim(p_company ->> 'gst_number'), ''),
    nullif(trim(p_profile ->> 'phone'), ''),
    v_email,
    nullif(trim(p_company ->> 'city'), ''),
    nullif(trim(p_company ->> 'state'), ''),
    nullif(trim(p_company ->> 'billing_address'), ''),
    v_user_id
  ) returning id into v_company_id;

  insert into public.app_users (
    id, company_id, full_name, email, phone, role, is_active, status
  ) values (
    v_user_id,
    v_company_id,
    v_full_name,
    v_email,
    nullif(trim(p_profile ->> 'phone'), ''),
    'owner',
    true,
    'active'
  );

  insert into public.company_settings (company_id, default_quote_terms)
  values (
    v_company_id,
    'Prices are valid until the mentioned date. GST and transport as mentioned. Delivery depends on die, billet, and finishing availability.'
  );

  insert into public.feature_flags (company_id, module_name, is_enabled, enabled_by, enabled_at)
  select
    v_company_id,
    module_name,
    module_name = any (array[
      'production_planning', 'advanced_inventory', 'quality_compliance',
      'command_center', 'energy_monitoring', 'machine_maintenance',
      'tender_management', 'export_docs', 'bis_compliance',
      'profitability_intelligence'
    ]),
    case when module_name = any (array[
      'production_planning', 'advanced_inventory', 'quality_compliance',
      'command_center', 'energy_monitoring', 'machine_maintenance',
      'tender_management', 'export_docs', 'bis_compliance',
      'profitability_intelligence'
    ]) then v_user_id end,
    case when module_name = any (array[
      'production_planning', 'advanced_inventory', 'quality_compliance',
      'command_center', 'energy_monitoring', 'machine_maintenance',
      'tender_management', 'export_docs', 'bis_compliance',
      'profitability_intelligence'
    ]) then now() end
  from unnest(array[
    'ai_assistant', 'whatsapp_automation', 'dealer_portal', 'advanced_inventory',
    'production_planning', 'quality_compliance', 'export_docs', 'tender_management',
    'energy_monitoring', 'machine_maintenance', 'bis_compliance',
    'profitability_intelligence', 'barcode_tracking', 'accounting_integrations',
    'mobile_floor_app', 'multi_plant', 'systems_configurator',
    'document_intelligence', 'die_intelligence', 'crm', 'report_builder',
    'automation', 'command_center'
  ]) as module_list(module_name);

  return v_company_id;
end;
$function$


-- FN private.order_has_remaining_production
CREATE OR REPLACE FUNCTION private.order_has_remaining_production(p_company_id uuid, p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_header numeric := 0;
  v_line_total numeric := 0;
  v_job_total numeric := 0;
  v_stock_total numeric := 0;
  v_lines integer := 0;
begin
  select coalesce(production_quantity_kg, manufacturing_weight_kg, 0) into v_header
  from public.orders where id = p_order_id and company_id = p_company_id;
  if not found then return false; end if;
  select count(*), coalesce(sum(quantity_kg), 0) into v_lines, v_line_total
  from public.order_items where company_id = p_company_id and order_id = p_order_id;
  if v_lines > 0 then
    return exists (
      select 1 from public.order_items line
      where line.company_id = p_company_id and line.order_id = p_order_id
        and line.quantity_kg is not null and line.quantity_kg > 0
        and line.quantity_kg > coalesce((
          select sum(case when job.status = 'completed' and coalesce(job.actual_quantity_kg, 0) > 0
            then job.actual_quantity_kg else job.planned_quantity_kg end)
          from public.production_jobs job where job.company_id = p_company_id and job.order_id = p_order_id
            and job.source_line_id = line.id and job.status <> 'cancelled'
        ), 0) + coalesce((
          select sum(fulfillment.fulfilled_weight_kg) from public.order_dealer_stock_fulfillments fulfillment
          where fulfillment.company_id = p_company_id and fulfillment.order_id = p_order_id
            and fulfillment.order_item_id = line.id and fulfillment.credited_at is null
        ), 0) + 0.001
    );
  end if;
  select coalesce(sum(case when status = 'completed' and coalesce(actual_quantity_kg, 0) > 0
    then actual_quantity_kg else planned_quantity_kg end), 0)
  into v_job_total from public.production_jobs
  where company_id = p_company_id and order_id = p_order_id and status <> 'cancelled';
  select coalesce(sum(fulfilled_weight_kg), 0) into v_stock_total
  from public.order_dealer_stock_fulfillments
  where company_id = p_company_id and order_id = p_order_id and credited_at is null;
  return greatest(v_header, v_line_total) > v_job_total + v_stock_total + 0.001;
end;
$function$


-- FN private.order_job_has_remaining_production
CREATE OR REPLACE FUNCTION private.order_job_has_remaining_production(p_company_id uuid, p_order_id uuid, p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_header numeric := 0;
  v_line_count integer := 0;
  v_line_id uuid;
  v_target numeric := 0;
  v_committed numeric := 0;
  v_stock numeric := 0;
begin
  select coalesce(production_quantity_kg, manufacturing_weight_kg, 0) into v_header
  from public.orders where id = p_order_id and company_id = p_company_id;
  if not found then return false; end if;
  select count(*) into v_line_count from public.order_items where company_id = p_company_id and order_id = p_order_id;
  if v_line_count > 0 then
    select id, coalesce(quantity_kg, case when v_line_count = 1 then v_header else 0 end) into v_line_id, v_target
    from public.order_items where company_id = p_company_id and order_id = p_order_id
      and id = (select source_line_id from public.production_jobs where id = p_job_id and company_id = p_company_id);
    if not found or v_target <= 0 then return false; end if;
    select coalesce(sum(case when status='completed' and coalesce(actual_quantity_kg,0)>0 then actual_quantity_kg else planned_quantity_kg end),0)
    into v_committed from public.production_jobs where company_id=p_company_id and order_id=p_order_id
      and source_line_id=v_line_id and status<>'cancelled' and id<>p_job_id;
    select coalesce(sum(fulfilled_weight_kg),0) into v_stock from public.order_dealer_stock_fulfillments
    where company_id=p_company_id and order_id=p_order_id and order_item_id=v_line_id and credited_at is null;
  else
    v_target := v_header;
    select coalesce(sum(case when status='completed' and coalesce(actual_quantity_kg,0)>0 then actual_quantity_kg else planned_quantity_kg end),0)
    into v_committed from public.production_jobs where company_id=p_company_id and order_id=p_order_id
      and status<>'cancelled' and id<>p_job_id;
    select coalesce(sum(fulfilled_weight_kg),0) into v_stock from public.order_dealer_stock_fulfillments
    where company_id=p_company_id and order_id=p_order_id and credited_at is null;
  end if;
  return v_target > v_committed + v_stock + 0.001;
end;
$function$


-- FN private.order_profile_needs_billet_allocation
CREATE OR REPLACE FUNCTION private.order_profile_needs_billet_allocation(p_company_id uuid, p_order_id uuid, p_profile_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order public.orders%rowtype;
  v_lines integer;
  v_committed numeric;
  v_stock numeric;
begin
  select * into v_order from public.orders where id=p_order_id and company_id=p_company_id;
  if not found or p_profile_id is null or v_order.current_stage in ('closed','cancelled','delivered','payment_pending') then return false;end if;
  if exists(select 1 from public.production_jobs j where j.company_id=p_company_id and j.order_id=p_order_id
    and j.profile_id=p_profile_id and j.status in ('planned','ready','in_progress','on_hold')) then return true;end if;
  select count(*) into v_lines from public.order_items where company_id=p_company_id and order_id=p_order_id;
  if v_lines>0 then
    return exists(select 1 from public.order_items line where line.company_id=p_company_id and line.order_id=p_order_id
      and line.profile_id=p_profile_id and line.quantity_kg>0
      and line.quantity_kg>coalesce((select sum(case when j.status='completed' and coalesce(j.actual_quantity_kg,0)>0
          then j.actual_quantity_kg else j.planned_quantity_kg end)
        from public.production_jobs j where j.company_id=p_company_id and j.order_id=p_order_id
          and j.source_line_id=line.id and j.status<>'cancelled'),0)
        +coalesce((select sum(f.fulfilled_weight_kg) from public.order_dealer_stock_fulfillments f
          where f.company_id=p_company_id and f.order_id=p_order_id and f.order_item_id=line.id and f.credited_at is null),0)+0.001);
  end if;
  if v_order.production_profile_id is distinct from p_profile_id then return false;end if;
  select coalesce(sum(case when j.status='completed' and coalesce(j.actual_quantity_kg,0)>0
    then j.actual_quantity_kg else j.planned_quantity_kg end),0) into v_committed
    from public.production_jobs j where j.company_id=p_company_id and j.order_id=p_order_id and j.status<>'cancelled';
  select coalesce(sum(fulfilled_weight_kg),0) into v_stock from public.order_dealer_stock_fulfillments
    where company_id=p_company_id and order_id=p_order_id and credited_at is null;
  return coalesce(v_order.production_quantity_kg,v_order.manufacturing_weight_kg,0)>v_committed+v_stock+0.001;
end;
$function$


-- FN private.post_source_inventory_change
CREATE OR REPLACE FUNCTION private.post_source_inventory_change(p_company_id uuid, p_old_item uuid, p_old_qty numeric, p_old_rate numeric, p_new_item uuid, p_new_qty numeric, p_new_rate numeric, p_unit text, p_reference_type text, p_reference_id uuid, p_movement_date date, p_in_type text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_old_qty numeric(14,3) := coalesce(p_old_qty, 0);
  v_old_rate numeric(14,2) := coalesce(p_old_rate, 0);
  v_new_qty numeric(14,3) := coalesce(p_new_qty, 0);
  v_new_rate numeric(14,2) := coalesce(p_new_rate, 0);
  v_stock numeric;
  v_avg numeric;
  v_delta numeric(14,3);
  v_qty_value numeric;
  v_revalue numeric(14,2) := 0;
  v_on_hand numeric;
begin
  if p_old_item is not null and p_new_item is distinct from p_old_item and v_old_qty > 0 then
    select current_stock, average_rate into v_stock, v_avg from public.inventory_items
    where id = p_old_item and company_id = p_company_id for update;
    if found then
      update public.inventory_items
      set average_rate = case when v_stock - v_old_qty > 0 and v_old_rate > 0
            then round(greatest(v_stock * v_avg - v_old_qty * v_old_rate, 0) / (v_stock - v_old_qty), 2) else average_rate end,
          current_stock = greatest(v_stock - v_old_qty, 0), updated_at = now()
      where id = p_old_item and company_id = p_company_id;
      insert into public.inventory_movements(company_id, inventory_item_id, movement_type, quantity, unit, reference_type,
        reference_id, rate, amount, movement_date, notes, created_by)
      values (p_company_id, p_old_item, 'adjustment_out', v_old_qty, coalesce(p_unit, 'kg'), p_reference_type, p_reference_id,
        v_old_rate, round(v_old_qty * v_old_rate, 2), private.business_today(), p_note || ': moved to the corrected item', auth.uid());
    end if;
    v_old_qty := 0;
    v_old_rate := 0;
  end if;
  if p_new_item is null then return; end if;

  v_delta := v_new_qty - v_old_qty;
  if v_delta = 0 and v_new_rate = v_old_rate then return; end if;
  select current_stock, average_rate into v_stock, v_avg from public.inventory_items
  where id = p_new_item and company_id = p_company_id for update;
  if not found then return; end if;
  v_stock := coalesce(v_stock, 0);
  v_avg := coalesce(v_avg, 0);

  v_qty_value := case when v_delta >= 0 then v_delta * v_new_rate else v_delta * v_old_rate end;
  if v_new_rate <> v_old_rate and least(v_old_qty, v_new_qty) > 0 then
    v_on_hand := least(greatest(v_stock, 0), least(v_old_qty, v_new_qty));
    v_revalue := round((v_new_rate - v_old_rate) * v_on_hand, 2);
  end if;

  update public.inventory_items
  set average_rate = case
        when v_stock + v_delta > 0 and (v_new_rate > 0 or v_old_rate > 0)
          then round(greatest(v_stock * v_avg + v_qty_value + v_revalue, 0) / (v_stock + v_delta), 2)
        else average_rate end,
      current_stock = greatest(v_stock + v_delta, 0),
      updated_at = now()
  where id = p_new_item and company_id = p_company_id;

  if v_delta <> 0 then
    insert into public.inventory_movements(company_id, inventory_item_id, movement_type, quantity, unit, reference_type,
      reference_id, rate, amount, movement_date, notes, created_by)
    values (p_company_id, p_new_item, case when v_delta > 0 then coalesce(p_in_type, 'adjustment_in') else 'adjustment_out' end,
      abs(v_delta), coalesce(p_unit, 'kg'), p_reference_type, p_reference_id,
      case when v_delta > 0 then v_new_rate else v_old_rate end, abs(round(v_qty_value, 2)),
      coalesce(p_movement_date, private.business_today()), p_note, auth.uid());
  end if;
  if v_revalue <> 0 then
    insert into public.inventory_movements(company_id, inventory_item_id, movement_type, quantity, unit, reference_type,
      reference_id, rate, amount, movement_date, notes, created_by)
    values (p_company_id, p_new_item, case when v_revalue > 0 then 'adjustment_in' else 'adjustment_out' end, 0,
      coalesce(p_unit, 'kg'), p_reference_type, p_reference_id, v_new_rate, abs(v_revalue), private.business_today(),
      p_note || ': purchase cost revalued from ' || v_old_rate || ' to ' || v_new_rate || ' for ' || v_on_hand || ' on hand', auth.uid());
  end if;
end;
$function$


-- FN private.profile_stock_reservation_ledger_page
CREATE OR REPLACE FUNCTION private.profile_stock_reservation_ledger_page(p_page integer, p_search text, p_status text, p_sort text, p_direction text, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_search text := lower(btrim(coalesce(p_search,'')));
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('owner','admin','production_manager','production','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied to inspect stock reservations' using errcode='42501';
  end if;
  if p_page is null or p_page<1 or p_page>100000 or length(v_search)>100
    or p_status is null or p_status not in ('','active','released','consumed','cancelled')
    or p_sort is null or p_sort not in ('created_at','reserved_weight_kg','status','released_at')
    or p_direction is null or p_direction not in ('asc','desc') then
    raise exception 'Invalid reservation ledger filters' using errcode='22023';
  end if;

  return (
    with consumption as (
      select c.reservation_id,sum(c.consumed_weight_kg) weight_kg,
        case when bool_or(c.consumed_length_m is null) then null else sum(c.consumed_length_m) end length_m,
        case when bool_or(c.consumed_pieces is null) then null else sum(c.consumed_pieces) end pieces,
        bool_and(c.consumed_weight_kg is not null and c.consumed_weight_kg>=0
          and c.consumed_weight_kg::text not in ('NaN','Infinity','-Infinity')
          and (c.consumed_length_m is null or (c.consumed_length_m>=0 and c.consumed_length_m::text not in ('NaN','Infinity','-Infinity')))
          and (c.consumed_pieces is null or c.consumed_pieces>=0)
          and held.id is not null
          and c.order_id is not distinct from held.order_id
          and c.profile_id is not distinct from held.profile_id
          and c.profile_stock_batch_id is not distinct from held.profile_stock_batch_id) valid_source
      from public.profile_stock_consumptions c
      left join public.profile_stock_reservations held on held.id=c.reservation_id and held.company_id=v_company
      where c.company_id=v_company and (p_order_id is null or held.order_id=p_order_id)
      group by c.reservation_id
    ), source as (
      select r.id,r.order_id,r.status,r.created_at,r.released_at,r.notes,
        profile.profile_code,profile.profile_name,order_record.order_number,
        coalesce(nullif(customer.company_name,''),customer.customer_name) customer_name,
        batch.bundle_number,batch.location,
        coalesce(r.initial_reserved_weight_kg,r.reserved_weight_kg) reserved_weight_kg,
        coalesce(r.initial_reserved_length_m,r.reserved_length_m) reserved_length_m,
        coalesce(r.initial_reserved_pieces,r.reserved_pieces) reserved_pieces,
        coalesce(c.weight_kg,0) consumed_weight_kg,
        case when c.reservation_id is null then 0 else c.length_m end consumed_length_m,
        case when c.reservation_id is null then 0 else c.pieces end consumed_pieces,
        coalesce(c.valid_source,true) and profile.id is not null and order_record.id is not null and batch.id is not null valid_source
      from public.profile_stock_reservations r
      left join consumption c on c.reservation_id=r.id
      left join public.aluminium_profiles profile on profile.id=r.profile_id and profile.company_id=v_company
      left join public.orders order_record on order_record.id=r.order_id and order_record.company_id=v_company
      left join public.customers customer on customer.id=order_record.customer_id and customer.company_id=v_company
      left join public.profile_stock_batches batch on batch.id=r.profile_stock_batch_id and batch.company_id=v_company and batch.profile_id=r.profile_id
      where r.company_id=v_company and (p_order_id is null or r.order_id=p_order_id)
    ), quantities as (
      select s.*,greatest(s.reserved_weight_kg-s.consumed_weight_kg,0) remaining_weight_kg,
        case when s.reserved_length_m is null or s.consumed_length_m is null then null else greatest(s.reserved_length_m-s.consumed_length_m,0) end remaining_length_m,
        case when s.reserved_pieces is null or s.consumed_pieces is null then null else greatest(s.reserved_pieces-s.consumed_pieces,0) end remaining_pieces
      from source s
    ), filtered as materialized (
      select q.id,q.order_id,q.profile_code,q.profile_name,q.order_number,q.customer_name,q.bundle_number,q.location,
        q.status,q.created_at,q.released_at,q.notes,q.reserved_weight_kg,q.reserved_length_m,q.reserved_pieces,
        q.consumed_weight_kg,q.consumed_length_m,q.consumed_pieces,
        case when q.status='active' then q.remaining_weight_kg else 0 end open_weight_kg,
        case when q.status='active' then q.remaining_length_m else 0 end open_length_m,
        case when q.status='active' then q.remaining_pieces else 0 end open_pieces,
        case when q.status in ('released','cancelled') then q.remaining_weight_kg else 0 end released_weight_kg,
        case when q.status in ('released','cancelled') then q.remaining_length_m else 0 end released_length_m,
        case when q.status in ('released','cancelled') then q.remaining_pieces else 0 end released_pieces,
        q.valid_source and q.status is not null and q.status in ('active','released','consumed','cancelled')
          and q.reserved_weight_kg is not null and q.reserved_weight_kg>=0 and q.reserved_weight_kg::text not in ('NaN','Infinity','-Infinity')
          and q.consumed_weight_kg<=q.reserved_weight_kg+0.001
          and (q.reserved_length_m is null or (q.reserved_length_m>=0 and q.reserved_length_m::text not in ('NaN','Infinity','-Infinity')))
          and (q.reserved_pieces is null or q.reserved_pieces>=0)
          and (q.reserved_length_m is null or q.consumed_length_m is null or q.consumed_length_m<=q.reserved_length_m+0.001)
          and (q.reserved_pieces is null or q.consumed_pieces is null or q.consumed_pieces<=q.reserved_pieces)
          and (q.status<>'consumed' or (q.remaining_weight_kg<=0.001
            and (q.remaining_length_m is null or q.remaining_length_m<=0.001)
            and (q.remaining_pieces is null or q.remaining_pieces=0))) valid_source
      from quantities q
      where (p_status='' or q.status=p_status)
        and (v_search='' or strpos(lower(concat_ws(' ',q.profile_code,q.profile_name,q.order_number,q.customer_name,q.bundle_number,q.location,q.notes)),v_search)>0)
    ), totals as (
      select count(*) total_count,count(*) filter(where status='active' and open_weight_kg>0) active_count,
        coalesce(sum(open_weight_kg),0) open_weight_kg,coalesce(sum(consumed_weight_kg),0) consumed_weight_kg,
        coalesce(sum(released_weight_kg),0) released_weight_kg,coalesce(bool_and(valid_source),true) integrity_ok
      from filtered
    ), bounds as (
      select least(p_page,greatest(1,ceil(total_count::numeric/10)::integer)) page from totals
    ), page_rows as (
      select f.* from filtered f order by
        case when p_sort='created_at' and p_direction='asc' then f.created_at end asc nulls last,
        case when p_sort='created_at' and p_direction='desc' then f.created_at end desc nulls last,
        case when p_sort='released_at' and p_direction='asc' then f.released_at end asc nulls last,
        case when p_sort='released_at' and p_direction='desc' then f.released_at end desc nulls last,
        case when p_sort='reserved_weight_kg' and p_direction='asc' then f.reserved_weight_kg end asc nulls last,
        case when p_sort='reserved_weight_kg' and p_direction='desc' then f.reserved_weight_kg end desc nulls last,
        case when p_sort='status' and p_direction='asc' then f.status end asc nulls last,
        case when p_sort='status' and p_direction='desc' then f.status end desc nulls last,f.id asc
      limit 10 offset ((select page from bounds)-1)*10
    )
    select jsonb_build_object('page',bounds.page,'page_size',10,'total_count',totals.total_count,'integrity_ok',totals.integrity_ok,
      'summary',jsonb_build_object('active_count',totals.active_count,'open_weight_kg',totals.open_weight_kg,
        'consumed_weight_kg',totals.consumed_weight_kg,'released_weight_kg',totals.released_weight_kg),
      'rows',coalesce((select jsonb_agg(to_jsonb(p)-'valid_source') from page_rows p),'[]'::jsonb))
    from totals cross join bounds
  );
end;
$function$


-- FN private.project_expense_payment_status_to_source
CREATE OR REPLACE FUNCTION private.project_expense_payment_status_to_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if new.source_table is null or new.source_record_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.payment_status is not distinct from old.payment_status then return new; end if;
  if new.source_table in ('foundry_external_aluminium_sources', 'foundry_aluminium_scrap', 'outsourced_billet_batches',
    'packaging_material_purchases', 'breakdown_logs') then
    execute format('update public.%I set payment_status = $1 where id = $2 and company_id = $3 and payment_status is distinct from $1',
      new.source_table) using new.payment_status, new.source_record_id, new.company_id;
  end if;
  return new;
end;
$function$


-- FN public.generate_system_quote_atomic
CREATE OR REPLACE FUNCTION public.generate_system_quote_atomic(p_configuration_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_company uuid;
  v_role text;
  v_config public.system_configurations%rowtype;
  v_settings public.company_settings%rowtype;
  v_quote_id uuid;
  v_profile record;
  v_total_weight numeric;
  v_price numeric;
  v_cost numeric;
  v_tax numeric;
  v_target_price numeric;
  v_target_cost numeric;
  v_target_tax numeric;
  v_used_price numeric := 0;
  v_used_cost numeric := 0;
  v_line_count integer;
  v_index integer := 0;
  v_line_id uuid;
  v_allocations jsonb := '[]'::jsonb;
  v_pair record;
  v_iteration integer;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select company_id,role::text into v_company,v_role from public.app_users where id=auth.uid() and is_active=true;
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role not in ('owner','admin') then raise exception 'Only owners and admins can generate system quotes from internal costing' using errcode='42501'; end if;
  select * into v_config from public.system_configurations where id=p_configuration_id and company_id=v_company for update;
  if not found then raise exception 'Configuration not found for this company'; end if;
  if v_config.quote_id is not null then
    if not exists(select 1 from public.quotes where id=v_config.quote_id and company_id=v_company and system_configuration_id=v_config.id and customer_id=v_config.customer_id) then
      raise exception 'Existing quote link lacks verified configuration lineage; review the legacy conversion before continuing';
    end if;
    return v_config.quote_id;
  end if;
  if v_config.status <> 'calculated' or v_config.customer_id is null then
    raise exception 'Recalculate a valid configuration and link a customer before generating a quote';
  end if;
  perform 1 from public.customers where id=v_config.customer_id and company_id=v_company and deleted_at is null;
  if not found then raise exception 'Customer not found for this company'; end if;
  select * into v_settings from public.company_settings where company_id=v_company;
  v_target_price := round(coalesce(v_config.subtotal,v_config.selling_price,0),2);
  v_target_cost := round(coalesce(v_config.internal_cost,0),2);
  v_target_tax := round(coalesce(v_config.gst_amount,0),2);
  if v_target_price <= 0 or v_target_cost < 0 or v_config.internal_cost is null or v_config.gst_amount is null or v_config.grand_total is null
     or v_config.gst_percent is null or v_config.gst_percent not between 0 and 100
     or round(v_target_price*v_config.gst_percent/100,2) <> v_target_tax
     or round(v_target_price+v_target_tax,2) <> round(coalesce(v_config.grand_total,0),2) then
    raise exception 'Calculated assembly price, cost and GST must reconcile before generating a quote';
  end if;
  perform 1 from public.system_profile_cuts where company_id=v_company and configuration_id=v_config.id order by id for share;
  perform 1 from public.system_beading_cuts where company_id=v_company and configuration_id=v_config.id order by id for share;
  if exists(select 1 from public.system_profile_cuts c left join public.aluminium_profiles p on p.id=c.profile_id and p.company_id=c.company_id
    where c.company_id=v_company and c.configuration_id=v_config.id and (p.id is null or not p.is_active or p.deleted_at is not null or c.quantity <= 0 or c.total_length_m <= 0 or c.total_weight_kg <= 0
      or abs(c.total_length_m-round(c.quantity*c.cut_length_mm/1000,3)) > 0.001
      or abs(c.total_weight_kg-round(c.total_length_m*p.section_weight_kg_per_m,3)) > 0.001))
    or exists(select 1 from public.system_beading_cuts c left join public.aluminium_profiles p on p.id=c.profile_id and p.company_id=c.company_id
      where c.company_id=v_company and c.configuration_id=v_config.id and (p.id is null or not p.is_active or p.deleted_at is not null or c.quantity <= 0 or c.total_length_m <= 0 or abs(c.total_length_m-round(c.quantity*c.cut_length_mm/1000,3)) > 0.001)) then
    raise exception 'Every profile and beading cut must have valid same-company material and exact calculated quantities';
  end if;
  select sum(weight),count(distinct profile_id) into v_total_weight,v_line_count from (
    select c.profile_id,c.total_weight_kg as weight from public.system_profile_cuts c where c.company_id=v_company and c.configuration_id=v_config.id
    union all select c.profile_id,round(c.total_length_m*p.section_weight_kg_per_m,3) from public.system_beading_cuts c join public.aluminium_profiles p on p.id=c.profile_id and p.company_id=c.company_id where c.company_id=v_company and c.configuration_id=v_config.id
  ) cuts;
  if coalesce(v_total_weight,0) <= 0 or v_line_count <= 0 then raise exception 'Calculate all profile cuts before generating a quote'; end if;
  if v_target_price < v_line_count*0.01 then raise exception 'Assembly price must support a positive amount on every profile line'; end if;
  insert into public.quotes(company_id,quote_number,customer_id,quote_date,valid_until,status,gst_percent,
    terms_and_conditions,payment_terms,delivery_timeline,notes,created_by,system_configuration_id)
  values(v_company,private.next_business_number_locked('public.quotes'::regclass,'quote_number',v_company,'Q',v_today),v_config.customer_id,v_today,
    v_today+coalesce(v_settings.default_quote_validity_days,15),'draft',v_config.gst_percent,
    coalesce(v_settings.default_terms_and_conditions,v_settings.default_quote_terms),v_settings.default_payment_terms,v_settings.default_delivery_terms,
    format('Assembly %s / %s / %s x %s mm / quantity %s. Profile lines retain all cuts; shared aluminium, glass, hardware and service costs and selling price are allocated by profile weight, with the final line carrying rounding residuals.',coalesce(v_config.configuration_number,v_config.id::text),v_config.project_name,v_config.width_mm,v_config.height_mm,v_config.quantity),auth.uid(),v_config.id)
  returning id into v_quote_id;
  for v_profile in
    with cuts as (
      select c.id,c.profile_id,c.quantity,c.total_length_m as length,c.total_weight_kg as weight,c.cut_length_mm,'profile' as kind
      from public.system_profile_cuts c where c.company_id=v_company and c.configuration_id=v_config.id
      union all select c.id,c.profile_id,c.quantity,c.total_length_m,round(c.total_length_m*p.section_weight_kg_per_m,3),c.cut_length_mm,'beading'
      from public.system_beading_cuts c join public.aluminium_profiles p on p.id=c.profile_id and p.company_id=c.company_id where c.company_id=v_company and c.configuration_id=v_config.id
    ) select c.profile_id,sum(c.quantity)::integer as pieces,sum(c.length) as length,sum(c.weight) as weight,
      jsonb_agg(jsonb_build_object('cut_id',c.id,'kind',c.kind,'cut_length_mm',c.cut_length_mm,'pieces',c.quantity,'length_m',c.length,'weight_kg',c.weight) order by c.kind,c.id) as cut_snapshot,
      min(p.profile_code) as profile_code,min(p.profile_name) as profile_name
    from cuts c join public.aluminium_profiles p on p.id=c.profile_id and p.company_id=v_company
    group by c.profile_id order by sum(c.weight),c.profile_id
  loop
    v_index := v_index+1;
    v_price := case when v_index=v_line_count then v_target_price-v_used_price else greatest(0.01,floor(v_target_price*v_profile.weight/v_total_weight*100)/100) end;
    v_cost := case when v_index=v_line_count then v_target_cost-v_used_cost else floor(v_target_cost*v_profile.weight/v_total_weight*100)/100 end;
    if v_price <= 0 or v_cost < 0 then raise exception 'Profile price allocation cannot be represented without changing the assembly total; adjust the configuration price'; end if;
    v_allocations := v_allocations || jsonb_build_array(to_jsonb(v_profile)||jsonb_build_object('price',v_price,'cost',v_cost));
    v_used_price := v_used_price+v_price;
    v_used_cost := v_used_cost+v_cost;
  end loop;
  select sum(round((value->>'price')::numeric*v_config.gst_percent/100,2)) into v_tax from jsonb_array_elements(v_allocations);
  -- Move the few paise needed between selling lines before insertion. This
  -- preserves the agreed assembly subtotal and each line's normal GST formula.
  for v_iteration in 1..greatest(v_line_count*2,1) loop
    exit when v_tax=v_target_tax;
    with amounts as (
      select ordinality::integer as idx,(value->>'price')::numeric as price
      from jsonb_array_elements(v_allocations) with ordinality
    ), transfers as (
      select donor.idx as donor,receiver.idx as receiver,delta.cents,
        round((donor.price-delta.cents/100.0)*v_config.gst_percent/100,2)
        +round((receiver.price+delta.cents/100.0)*v_config.gst_percent/100,2)
        -round(donor.price*v_config.gst_percent/100,2)-round(receiver.price*v_config.gst_percent/100,2) as tax_delta
      from amounts donor cross join amounts receiver
      cross join generate_series(1,greatest(100,ceil(100/nullif(v_config.gst_percent,0))::integer)) delta(cents)
      where donor.idx<>receiver.idx and donor.price-delta.cents/100.0>=0.01
    ) select * into v_pair from transfers
      where abs(v_tax+tax_delta-v_target_tax)<abs(v_tax-v_target_tax)
      order by cents,donor,receiver limit 1;
    if not found then raise exception 'Assembly GST cannot be represented by positive profile prices at paise precision; review the calculated quote'; end if;
    v_allocations := jsonb_set(v_allocations,array[(v_pair.donor-1)::text,'price'],
      to_jsonb((v_allocations->(v_pair.donor-1)->>'price')::numeric-v_pair.cents/100.0));
    v_allocations := jsonb_set(v_allocations,array[(v_pair.receiver-1)::text,'price'],
      to_jsonb((v_allocations->(v_pair.receiver-1)->>'price')::numeric+v_pair.cents/100.0));
    v_tax := v_tax+v_pair.tax_delta;
  end loop;
  if v_tax<>v_target_tax then raise exception 'Assembly GST allocation did not converge'; end if;
  for v_profile in select * from jsonb_to_recordset(v_allocations) as allocation(
    profile_id uuid,pieces integer,length numeric,weight numeric,cut_snapshot jsonb,
    profile_code text,profile_name text,price numeric,cost numeric)
  loop
    v_price := v_profile.price;
    v_cost := v_profile.cost;
    insert into public.quote_items(company_id,quote_id,profile_id,item_description,quantity_pieces,length_per_piece_m,section_weight_kg_per_m,
      billet_rate_per_kg,conversion_charge_per_kg,finishing_type,finishing_charge_type,finishing_charge,die_charge,scrap_allowance_percent,
      expected_recovery_percent,minimum_billing_weight_kg,die_amortization_type,die_amortization_quantity_kg,packing_charge,transport_charge,other_charges,
      margin_percent,sales_price_override,minimum_margin_percent,gst_percent,source_record_id,configuration_cut_snapshot,internal_note)
    values(v_company,v_quote_id,v_profile.profile_id,
      format('%s / %s. %s profile pieces, %s m; scalar length is a planning average. Use the exact linked cut list. Shared assembly price allocated by kg.',v_profile.profile_code,v_profile.profile_name,v_profile.pieces,v_profile.length),
      v_profile.pieces,v_profile.length/v_profile.pieces,v_profile.weight/v_profile.length,
      0,0,'mill_finish','fixed',0,0,0,100,0,'waived',0,0,0,v_cost,0,v_price,coalesce(v_settings.minimum_margin_percent,0),v_config.gst_percent,
      v_config.id,v_profile.cut_snapshot,'Assembly internal cost allocated by profile weight; exact pieces/metres/kg retained in configuration cut snapshot')
    returning id into v_line_id;
    if exists(select 1 from public.quote_items where id=v_line_id and (abs(total_meters-v_profile.length)>0.001 or abs(total_weight_kg-v_profile.weight)>0.001 or line_total_before_gst<>v_price or line_subtotal<>v_cost)) then
      raise exception 'Quote line calculation changed its exact profile quantities or allocated price';
    end if;
  end loop;
  select round(coalesce(sum(round(line_total_before_gst*gst_percent/100,2)),0),2) into v_tax from public.quote_items where quote_id=v_quote_id and company_id=v_company;
  if v_tax <> v_target_tax then raise exception 'Per-profile GST rounding failed to preserve the assembly quote'; end if;
  update public.quotes set updated_at=now() where id=v_quote_id and company_id=v_company;
  if not exists(select 1 from public.quotes where id=v_quote_id and company_id=v_company and total_before_gst=v_target_price and gst_amount=v_target_tax and grand_total=v_config.grand_total) then
    raise exception 'Quote totals do not reconcile to the calculated assembly';
  end if;
  update public.system_configurations set quote_id=v_quote_id,status='quoted',updated_at=now() where id=v_config.id and company_id=v_company;
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,metadata_json)
  values(v_company,auth.uid(),'system_quote_generated','system_configuration',v_config.id,jsonb_build_object('quote_id',v_quote_id,'profile_count',v_line_count,'allocation_basis','profile_weight','subtotal',v_target_price,'internal_cost',v_target_cost,'gst',v_target_tax));
  return v_quote_id;
end;
$function$


-- FN public.get_advanced_analytics_snapshot
CREATE OR REPLACE FUNCTION public.get_advanced_analytics_snapshot(p_as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata'::text))::date, p_months integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_company_id uuid;
  v_role text;
  v_finance boolean;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_start date;
  v_end date;
  v_trend_start date;
  v_result jsonb;
begin
  select company_id, role::text into v_company_id, v_role
  from public.app_users where id = auth.uid() and is_active = true;
  if auth.uid() is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner','admin','accounts','sales_manager') then
    raise exception 'Permission denied for management analytics' using errcode = '42501';
  end if;
  if p_as_of is null or p_as_of > v_today or p_months is null or p_months not between 1 and 24 then
    raise exception 'Use an as-of date through today and between 1 and 24 trend months' using errcode = '22023';
  end if;
  v_finance := v_role in ('owner','admin','accounts');
  v_start := date_trunc('month', p_as_of)::date;
  v_end := p_as_of + 1;
  v_trend_start := (v_start - make_interval(months => p_months - 1))::date;

  with orders as materialized (
    select o.id, o.customer_id, o.order_date, coalesce(o.order_value,0) as value,
      o.current_stage, o.expected_dispatch_date
    from public.orders o where o.company_id = v_company_id and o.deleted_at is null
      and o.order_date < v_end
  ), quotes as materialized (
    select q.id, q.status, q.valid_until, coalesce(q.grand_total,0) as value,
      coalesce(q.quote_date, (q.created_at at time zone 'Asia/Kolkata')::date) as activity_date
    from public.quotes q where q.company_id = v_company_id and q.deleted_at is null
  ), shipments as materialized (
    select d.id, d.delivery_status, o.expected_dispatch_date,
      (d.actual_dispatched_at at time zone 'Asia/Kolkata')::date as movement_date,
      coalesce((select sum(p.net_weight_kg) from public.packing_list_items p
        where p.company_id = v_company_id and p.dispatch_id = d.id),0) as weight
    from public.dispatches d join public.orders o on o.id = d.order_id and o.company_id = d.company_id
    where d.company_id = v_company_id and o.deleted_at is null
      and d.delivery_status <> 'pending' and d.actual_dispatched_at is not null
      and exists (select 1 from public.packing_list_items p where p.company_id = v_company_id and p.dispatch_id = d.id and p.net_weight_kg > 0)
  ), production as materialized (
    select p.status, p.planned_date, (p.completed_at at time zone 'Asia/Kolkata')::date as completion_date,
      coalesce(p.planned_quantity_kg,0) as planned, coalesce(p.actual_quantity_kg,0) as actual
    from public.production_jobs p where p.company_id = v_company_id
  ), invoices as materialized (
    select i.id,i.customer_id,i.invoice_number,i.invoice_date,i.due_date,i.status,
      coalesce(i.grand_total,0) as value,coalesce(i.balance_due,0) as balance,
      coalesce(i.customer_credit_due,0) as credit_due
    from public.invoices i where i.company_id = v_company_id and i.deleted_at is null
  ), credit_notes as materialized (
    select n.credit_date, coalesce(n.grand_total,0) as value
    from public.credit_notes n where n.company_id = v_company_id and n.status = 'issued'
  ), expenses as materialized (
    -- Booked spend is approved and undeleted; legacy 'paid' approval labels mean approved.
    select coalesce(e.invoice_date,(e.created_at at time zone 'Asia/Kolkata')::date) as activity_date,
      coalesce(e.total_amount,0) as value,
      coalesce(e.amount_paid,0) - coalesce(e.refunded_amount,0) as paid,
      coalesce(nullif(e.currency,''),'INR') as currency,
      case when e.approval_status in ('approved','paid') then 'booked'
        when e.approval_status = 'pending_approval' then 'commitment' else 'excluded' end as stage
    from public.expense_ledger e where e.company_id = v_company_id and e.deleted_at is null
  ), collections as materialized (
    select p.payment_date, case when p.payment_type = 'REFUND' then -coalesce(p.amount,0) else coalesce(p.amount,0) end as value
    from public.payments p
    where p.company_id = v_company_id and p.payment_status = 'PAID' and p.payment_method <> 'credit_note'
      and p.payment_date >= v_trend_start
  ), quality as materialized (
    select q.status,coalesce((q.inspection_date at time zone 'Asia/Kolkata')::date,(q.created_at at time zone 'Asia/Kolkata')::date) as activity_date
    from public.quality_inspections q where q.company_id = v_company_id
  ), stock as materialized (
    select i.id,i.item_code,i.item_name,i.unit,coalesce(i.current_stock,0) as current_stock,
      coalesce(i.reorder_level,0) as reorder_level,
      case when i.reorder_level > 0 then greatest(0,100 * (i.reorder_level - i.current_stock) / i.reorder_level) else 0 end as shortage_pct
    from public.inventory_items i where i.company_id = v_company_id and i.is_active = true
  ), metrics as (
    select
      (select coalesce(sum(value),0) from orders where order_date >= v_start and current_stage <> 'cancelled') as booked,
      (select count(*) from orders where current_stage not in ('delivered','closed','cancelled')) as active,
      (select count(*) from orders where current_stage not in ('delivered','closed','cancelled') and expected_dispatch_date < v_today) as delayed,
      (select coalesce(sum(value),0) from quotes where activity_date < v_end and private.metric_quote_is_open(status,valid_until,p_as_of)) as pipeline,
      (select count(*) from quotes where activity_date >= v_start and activity_date < v_end and status not in ('draft','internal_review')) as eligible,
      (select count(*) from quotes where activity_date >= v_start and activity_date < v_end and status = 'converted_to_order') as converted,
      (select coalesce(sum(weight),0) from shipments where movement_date >= v_start and movement_date < v_end) as shipped,
      (select count(*) from shipments where movement_date >= v_start and movement_date < v_end and expected_dispatch_date is not null) as shipment_decisions,
      (select count(*) from shipments where movement_date >= v_start and movement_date < v_end and movement_date <= expected_dispatch_date) as on_time,
      (select coalesce(sum(planned),0) from production where planned_date >= v_start and planned_date < v_end and status <> 'cancelled') as planned,
      (select coalesce(sum(actual),0) from production where completion_date >= v_start and completion_date < v_end and status = 'completed') as actual,
      (select coalesce(sum(value),0) from invoices where invoice_date >= v_start and invoice_date < v_end and status in ('generated','sent','partially_paid','paid','overdue','credited')) as invoiced,
      (select coalesce(sum(value),0) from credit_notes where credit_date >= v_start and credit_date < v_end) as credited,
      (select coalesce(sum(balance),0) from invoices where status in ('generated','sent','partially_paid','overdue')) as receivable,
      (select count(*) from invoices where status in ('generated','sent','partially_paid','overdue') and balance > 0 and due_date < v_today) as overdue,
      (select coalesce(sum(credit_due),0) from invoices where credit_due > 0 and status <> 'cancelled') as credit_due,
      (select count(*) from invoices where credit_due > 0 and status <> 'cancelled') as credit_due_count,
      (select coalesce(sum(value),0) from collections where payment_date >= v_start and payment_date < v_end) as collected,
      (select coalesce(sum(value),0) from expenses where stage = 'booked' and currency = 'INR' and activity_date >= v_start and activity_date < v_end) as expense,
      (select coalesce(sum(paid),0) from expenses where stage = 'booked' and currency = 'INR' and activity_date >= v_start and activity_date < v_end) as expense_paid,
      (select coalesce(sum(value),0) from expenses where stage = 'commitment' and currency = 'INR') as commitments,
      (select count(*) from expenses where stage = 'booked' and currency <> 'INR' and activity_date >= v_start and activity_date < v_end) as non_inr,
      (select count(*) from quality where activity_date >= v_start and activity_date < v_end and status in ('approved','rejected','rework')) as quality_decisions,
      (select count(*) from quality where activity_date >= v_start and activity_date < v_end and status = 'approved') as quality_approved,
      (select count(*) from stock where reorder_level > 0 and current_stock <= reorder_level) as low_stock,
      (select count(*) from stock where current_stock <= 0) as out_of_stock,
      (select count(*) from public.tasks t where t.company_id = v_company_id and t.status in ('open','in_progress')) as tasks,
      (select count(*) from public.tasks t where t.company_id = v_company_id and t.status in ('open','in_progress') and t.priority in ('urgent','high')) as urgent,
      (select count(*) from public.dispatches d where d.company_id = v_company_id and d.delivery_status <> 'pending'
        and (d.actual_dispatched_at is null or not exists (select 1 from public.packing_list_items p where p.company_id = v_company_id and p.dispatch_id = d.id and p.net_weight_kg > 0))) as unknown_shipments
  ), trends as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key',to_char(axis.month_start,'YYYY-MM'),'label',to_char(axis.month_start,'Mon YY'),
      'ordersValue',(select coalesce(sum(value),0) from orders where order_date >= axis.month_start and order_date < least(axis.month_start + interval '1 month',v_end::timestamp) and current_stage <> 'cancelled'),
      'dispatchWeight',(select coalesce(sum(weight),0) from shipments where movement_date >= axis.month_start and movement_date < least(axis.month_start + interval '1 month',v_end::timestamp)),
      'invoicedValue',(select coalesce(sum(value),0) from invoices where invoice_date >= axis.month_start and invoice_date < least(axis.month_start + interval '1 month',v_end::timestamp) and status in ('generated','sent','partially_paid','paid','overdue','credited')),
      'creditNoteValue',(select coalesce(sum(value),0) from credit_notes where credit_date >= axis.month_start and credit_date < least(axis.month_start + interval '1 month',v_end::timestamp)),
      'expenseValue',case when v_finance then (select coalesce(sum(value),0) from expenses where stage = 'booked' and currency = 'INR' and activity_date >= axis.month_start and activity_date < least(axis.month_start + interval '1 month',v_end::timestamp)) else 0 end,
      'collectionValue',(select coalesce(sum(value),0) from collections where payment_date >= axis.month_start and payment_date < least(axis.month_start + interval '1 month',v_end::timestamp))
    ) order by axis.month_start),'[]'::jsonb) as value
    from generate_series(v_trend_start::timestamp,v_start::timestamp,interval '1 month') axis(month_start)
  ), top_customers as (
    select coalesce(jsonb_agg(jsonb_build_object('customerId',r.customer_id,'name',r.name,'orderCount',r.orders,'value',r.value) order by r.value desc,r.customer_id),'[]'::jsonb) as value
    from (
      select o.customer_id,coalesce(nullif(c.company_name,''),nullif(c.customer_name,''),'Unknown Customer') as name,
        count(*) as orders,sum(o.value) as value
      from orders o left join public.customers c on c.id = o.customer_id and c.company_id = v_company_id
      where o.current_stage <> 'cancelled'
      group by o.customer_id,c.company_name,c.customer_name order by value desc,o.customer_id limit 8
    ) r
  ), stages as (
    select coalesce(jsonb_agg(jsonb_build_object('stage',r.current_stage,'count',r.count) order by r.count desc,r.current_stage),'[]'::jsonb) as value
    from (select current_stage,count(*) as count from orders where current_stage not in ('delivered','closed','cancelled') group by current_stage) r
  ), low_stock as (
    select coalesce(jsonb_agg(jsonb_build_object('itemCode',r.item_code,'itemName',r.item_name,'unit',r.unit,
      'currentStock',r.current_stock,'reorderLevel',r.reorder_level,'shortagePct',r.shortage_pct) order by r.shortage_pct desc,r.id),'[]'::jsonb) as value
    from (select * from stock where reorder_level > 0 and current_stock <= reorder_level order by shortage_pct desc,id limit 10) r
  ), overdue as (
    select coalesce(jsonb_agg(jsonb_build_object('invoiceNumber',r.invoice_number,'customer',r.customer,'dueDate',r.due_date,'balanceDue',r.balance,'status',r.status) order by r.balance desc,r.id),'[]'::jsonb) as value
    from (
      select i.*,coalesce(nullif(c.company_name,''),nullif(c.customer_name,''),'Unknown Customer') as customer
      from invoices i left join public.customers c on c.id = i.customer_id and c.company_id = v_company_id
      where v_finance and i.status in ('generated','sent','partially_paid','overdue') and i.balance > 0 and i.due_date < v_today
      order by i.balance desc,i.id limit 8
    ) r
  ), credit_due_list as (
    select coalesce(jsonb_agg(jsonb_build_object('invoiceId',r.id,'invoiceNumber',r.invoice_number,'customer',r.customer,'creditDue',r.credit_due,'status',r.status) order by r.credit_due desc,r.id),'[]'::jsonb) as value
    from (
      select i.*,coalesce(nullif(c.company_name,''),nullif(c.customer_name,''),'Unknown Customer') as customer
      from invoices i left join public.customers c on c.id = i.customer_id and c.company_id = v_company_id
      where v_finance and i.credit_due > 0 and i.status <> 'cancelled'
      order by i.credit_due desc,i.id limit 8
    ) r
  ), currency_spend as (
    select coalesce(jsonb_agg(jsonb_build_object('currency',r.currency,'bookedMtd',r.value,'count',r.count) order by r.currency),'[]'::jsonb) as value
    from (
      select currency,sum(value) as value,count(*) as count from expenses
      where v_finance and stage = 'booked' and activity_date >= v_start and activity_date < v_end group by currency
    ) r
  )
  select jsonb_build_object(
    'dataQuality',jsonb_build_object('version','20261020','asOf',p_as_of,'generatedAt',now(),
      'currentStateAt',now(),'unknownShipmentCount',m.unknown_shipments,'financeDetail',v_finance),
    'kpis',jsonb_build_object(
      'bookedRevenueMtd',m.booked,'quotePipelineValueMtd',m.pipeline,'quoteConversionRateMtd',case when m.eligible > 0 then 100.0 * m.converted / m.eligible else 0 end,
      'activeOrders',m.active,'delayedOrders',m.delayed,'dispatchWeightMtd',m.shipped,'dispatchOnTimeRate',case when m.shipment_decisions > 0 then 100.0 * m.on_time / m.shipment_decisions else 0 end,
      'productionPlannedKgMtd',m.planned,'productionActualKgMtd',m.actual,'productionAttainmentPctMtd',case when m.planned > 0 then 100.0 * m.actual / m.planned else 0 end,
      'receivableOutstanding',m.receivable,'overdueInvoices',m.overdue,'invoicedValueMtd',m.invoiced,
      'creditNotesMtd',m.credited,'netInvoicedMtd',m.invoiced - m.credited,'collectionsMtd',m.collected,
      'customerCreditDue',case when v_finance then m.credit_due else 0 end,'customerCreditDueCount',case when v_finance then m.credit_due_count else 0 end,
      'expenseRunRateMtd',case when v_finance then m.expense else 0 end,
      'expensePaidRateMtd',case when v_finance and m.expense > 0 then 100.0 * m.expense_paid / m.expense else 0 end,
      'expenseCommitments',case when v_finance then m.commitments else 0 end,
      'expenseNonInrCountMtd',case when v_finance then m.non_inr else 0 end,
      'qualityPassRateMtd',case when m.quality_decisions > 0 then 100.0 * m.quality_approved / m.quality_decisions else 0 end,
      'inventoryAtRiskCount',m.low_stock,'inventoryOutOfStockCount',m.out_of_stock,'openTasks',m.tasks,'urgentOpenTasks',m.urgent
    ),'trends',trends.value,'topCustomers',top_customers.value,'stageBacklog',stages.value,'lowStock',low_stock.value,
    'overdueInvoiceList',overdue.value,'customerCreditList',credit_due_list.value,'expenseByCurrency',currency_spend.value,
    'risks',to_jsonb(array_remove(array[
      case when m.delayed > 0 then m.delayed || ' current delayed orders need dispatch recovery.' end,
      case when m.overdue > 0 then m.overdue || ' current overdue invoices need receivable follow-up.' end,
      case when v_finance and m.credit_due_count > 0 then m.credit_due_count || ' invoices carry customer credit or refunds due.' end,
      case when m.low_stock > 0 then m.low_stock || ' inventory items are at or below reorder level.' end,
      case when m.urgent > 0 then m.urgent || ' urgent/high-priority tasks are still open.' end,
      case when m.unknown_shipments > 0 then m.unknown_shipments || ' activated shipments lack verified movement timestamps and are excluded from shipment metrics.' end,
      case when v_finance and m.non_inr > 0 then m.non_inr || ' foreign-currency expenses this month are reported separately and excluded from INR spend.' end,
      case when m.planned > 0 and m.actual * 100 / m.planned < 85 then 'Production attainment is below 85% of the plan through the as-of date.' end
    ],null))
  ) into v_result from metrics m cross join trends cross join top_customers cross join stages cross join low_stock
    cross join overdue cross join credit_due_list cross join currency_spend;
  return v_result;
end;
$function$


-- FN public.get_current_user_company_id
CREATE OR REPLACE FUNCTION public.get_current_user_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private'
AS $function$
  select private.get_current_user_company_id();
$function$


-- FN public.get_current_user_dealer_id
CREATE OR REPLACE FUNCTION public.get_current_user_dealer_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private'
AS $function$
  select private.get_current_user_dealer_id();
$function$


-- FN public.get_current_user_role
CREATE OR REPLACE FUNCTION public.get_current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private'
AS $function$
  select private.get_current_user_role();
$function$


-- FN public.get_dashboard_snapshot
CREATE OR REPLACE FUNCTION public.get_dashboard_snapshot(p_as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_company uuid;
  v_role text;
  v_start date;
  v_end date;
  v_commercial boolean;
  v_production boolean;
  v_dispatch boolean;
  v_inventory boolean;
  v_quality boolean;
  v_dies boolean;
  v_result jsonb;
begin
  select company_id,role::text into v_company,v_role from public.app_users where id = auth.uid() and is_active = true;
  if auth.uid() is null or v_company is null or v_role not in ('owner','admin','sales_manager','sales','accounts','factory_manager','production_manager','production','inventory_manager','dispatch_manager','dispatch','quality','viewer') then
    raise exception 'Permission denied for dashboard' using errcode = '42501';
  end if;
  if p_as_of is null or p_as_of > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Use an as-of date through today' using errcode = '22023';
  end if;
  v_start := date_trunc('month',p_as_of)::date;
  v_end := p_as_of + 1;
  v_commercial := v_role in ('owner','admin','sales_manager','sales','accounts');
  v_production := v_role in ('owner','admin','factory_manager','production_manager','production','quality','viewer');
  v_dispatch := v_role in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch','viewer');
  v_inventory := v_role in ('owner','admin','factory_manager','production_manager','production','inventory_manager','quality','viewer');
  v_quality := v_role in ('owner','admin','production_manager','quality','viewer');
  v_dies := v_role in ('owner','admin','production_manager','production','viewer');

  with orders as materialized (
    select o.id,o.order_number,o.customer_id,o.order_value,o.order_date,o.expected_dispatch_date,o.current_stage,o.priority
    from public.orders o where o.company_id = v_company and o.deleted_at is null and o.order_date < v_end
  ), quotes as materialized (
    select q.id,q.quote_number,q.grand_total,q.quote_date,q.status,q.valid_until,q.customer_id
    from public.quotes q where q.company_id = v_company and q.deleted_at is null and q.quote_date < v_end
  ), shortages as materialized (
    select i.id,i.item_code,i.item_name,i.unit,i.current_stock,i.reorder_level,
      100.0 * (i.reorder_level - i.current_stock) / i.reorder_level as severity
    from public.inventory_items i where i.company_id = v_company and i.is_active = true
      and i.reorder_level > 0 and i.current_stock <= i.reorder_level
  ), order_preview as (
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'order_number',r.order_number,'order_value',r.order_value,
      'order_date',r.order_date,'expected_dispatch_date',r.expected_dispatch_date,'current_stage',r.current_stage,'priority',r.priority,
      'customers',jsonb_build_object('customer_name',c.customer_name,'company_name',c.company_name)) order by r.order_date desc,r.id),'[]'::jsonb) as value
    from (select * from orders order by order_date desc,id limit 8) r
    left join public.customers c on c.id = r.customer_id and c.company_id = v_company
  ), quote_preview as (
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'quote_number',r.quote_number,'grand_total',r.grand_total,
      'quote_date',r.quote_date,'status',r.status,'customers',jsonb_build_object('customer_name',c.customer_name,'company_name',c.company_name)) order by r.quote_date desc,r.id),'[]'::jsonb) as value
    from (select * from quotes order by quote_date desc,id limit 5) r
    left join public.customers c on c.id = r.customer_id and c.company_id = v_company
  ), distribution as (
    select coalesce(jsonb_agg(jsonb_build_object('stage',r.current_stage,'count',r.count) order by r.current_stage),'[]'::jsonb) as value
    from (select current_stage,count(*) as count from orders where current_stage <> 'cancelled' group by current_stage) r
  )
  select jsonb_build_object(
    'version','20261008','asOf',p_as_of,'generatedAt',now(),
    'unknownShipmentCount',case when v_dispatch then (select count(*) from public.dispatches d where d.company_id = v_company and d.delivery_status <> 'pending' and (d.actual_dispatched_at is null or not exists (select 1 from public.packing_list_items p where p.company_id = v_company and p.dispatch_id = d.id and p.net_weight_kg > 0))) else 0 end,
    'quoteRows',case when v_commercial then quote_preview.value else '[]'::jsonb end,
    'orderRows',case when v_commercial then order_preview.value else '[]'::jsonb end,
    'monthlyQuoteValue',case when v_commercial then (select coalesce(sum(grand_total),0) from quotes where private.metric_quote_is_open(status,valid_until,p_as_of)) end,
    'monthlyOrderValue',case when v_commercial then (select coalesce(sum(order_value),0) from orders where order_date >= v_start and current_stage <> 'cancelled') end,
    'monthlyQuoteCount',case when v_commercial then (select count(*) from quotes where quote_date >= v_start) end,
    'monthlyOrderCount',case when v_commercial then (select count(*) from orders where order_date >= v_start and current_stage <> 'cancelled') end,
    'activeCustomerCount',case when v_commercial then (select count(distinct customer_id) from orders where order_date >= v_start and current_stage <> 'cancelled') end,
    'pendingQuoteCount',case when v_commercial then (select count(*) from quotes where private.metric_quote_is_open(status,valid_until,p_as_of)) end,
    'productionCount',case when v_production then (select count(*) from public.production_jobs p where p.company_id = v_company and p.status not in ('completed','cancelled')) end,
    'todayJobCount',case when v_production then (select count(*) from public.production_jobs p where p.company_id = v_company and p.planned_date = p_as_of and p.status not in ('completed','cancelled')) end,
    'pendingDispatchCount',case when v_dispatch then (select count(*) from orders where current_stage not in ('delivered','closed','cancelled')) end,
    'dispatchCount',case when v_dispatch then (select count(*) from public.dispatches d where d.company_id = v_company and d.delivery_status <> 'pending' and (d.actual_dispatched_at at time zone 'Asia/Kolkata')::date >= v_start and (d.actual_dispatched_at at time zone 'Asia/Kolkata')::date < v_end and exists (select 1 from public.packing_list_items p where p.company_id = v_company and p.dispatch_id = d.id and p.net_weight_kg > 0)) end,
    'dieCorrectionCount',case when v_dies then (select count(*) from public.dies d where d.company_id = v_company and d.die_status = 'correction') end,
    'qualityHoldCount',case when v_quality then (select count(*) from public.quality_inspections q where q.company_id = v_company
      and (q.status='rejected' or (q.status='rework' and not exists(select 1 from public.quality_rework_resolutions r
        where r.company_id=q.company_id and r.source_inspection_id=q.id)))) end,
    'delayedOrderCount',(select count(*) from orders where expected_dispatch_date < p_as_of and current_stage not in ('delivered','closed','cancelled')),
    'delayedOrders',coalesce((select jsonb_agg(r order by r.expected_dispatch_date,r.id) from (select id,order_number,expected_dispatch_date from orders where expected_dispatch_date < p_as_of and current_stage not in ('delivered','closed','cancelled') order by expected_dispatch_date,id limit 5) r),'[]'::jsonb),
    'lowInventoryCount',case when v_inventory then (select count(*) from shortages) end,
    'lowInventoryRows',case when v_inventory then coalesce((select jsonb_agg(to_jsonb(r) - 'severity' order by r.severity desc,r.id) from (select * from shortages order by severity desc,id limit 5) r),'[]'::jsonb) else '[]'::jsonb end,
    'orderStageDistribution',case when v_role in ('owner','admin') then distribution.value else '[]'::jsonb end
  ) into v_result from order_preview cross join quote_preview cross join distribution;
  return v_result;
end;
$function$


-- FN public.get_dealer_quote_stock_availability
CREATE OR REPLACE FUNCTION public.get_dealer_quote_stock_availability(p_quote_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
$function$


-- FN public.get_dispatch_reservation_ledger_page
CREATE OR REPLACE FUNCTION public.get_dispatch_reservation_ledger_page(p_dispatch_id uuid, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_order_id uuid;
  v_order_number text;
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied to inspect dispatch reservations' using errcode='42501';
  end if;
  if p_dispatch_id is null or p_page is null or p_page<1 or p_page>100000 then raise exception 'Invalid dispatch reservation request' using errcode='22023'; end if;
  select order_id into v_order_id from public.dispatches where id=p_dispatch_id and company_id=v_company;
  if not found then raise exception 'Dispatch reservations are unavailable for this account' using errcode='42501'; end if;
  -- An unlinked dispatch must never turn into an unfiltered company ledger.
  if v_order_id is null then
    return jsonb_build_object('dispatch_id',p_dispatch_id,'order_id',null,'order_number',null,'ledger',null);
  end if;
  select order_number into v_order_number from public.orders where id=v_order_id and company_id=v_company;
  if not found then raise exception 'The dispatch source order is unavailable' using errcode='23514'; end if;
  return jsonb_build_object('dispatch_id',p_dispatch_id,'order_id',v_order_id,'order_number',v_order_number,
    'ledger',private.profile_stock_reservation_ledger_page(p_page,'','','created_at','desc',v_order_id));
end;
$function$


-- FN public.get_financial_collection_events
CREATE OR REPLACE FUNCTION public.get_financial_collection_events(p_start_date date DEFAULT NULL::date)
 RETURNS TABLE(event_id uuid, payment_date date, amount numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select * from private.get_financial_collection_events(p_start_date) $function$


-- FN public.get_finished_production_readiness
CREATE OR REPLACE FUNCTION public.get_finished_production_readiness(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_company uuid:=private.get_current_user_company_id();v_job record;v_quality boolean;v_rows jsonb:='[]'::jsonb;
begin
  if v_company is null or auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied for finished production readiness' using errcode='42501';
  end if;
  if not exists(select 1 from public.orders where id=p_order_id and company_id=v_company) then raise exception 'Order not found for this company'; end if;
  select coalesce((select is_enabled from public.feature_flags where company_id=v_company and module_name='quality_compliance' limit 1),true) into v_quality;
  for v_job in select id from public.production_jobs where company_id=v_company and order_id=p_order_id and status='completed'
    and coalesce(finishing_type,'mill_finish')<>'mill_finish' order by id
  loop
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('production_job_id',v_job.id,
      'ready_weight_kg',private.finishing_dispatch_ready_kg(v_company,p_order_id,v_job.id,v_quality)));
  end loop;
  return jsonb_build_object('company_id',v_company,'order_id',p_order_id,'total_count',jsonb_array_length(v_rows),'rows',v_rows);
end;
$function$


-- FN public.get_finishing_workload
CREATE OR REPLACE FUNCTION public.get_finishing_workload(p_order_id uuid DEFAULT NULL::uuid, p_production_job_id uuid DEFAULT NULL::uuid, p_finishing_job_id uuid DEFAULT NULL::uuid, p_status text DEFAULT ''::text, p_search text DEFAULT ''::text, p_sort text DEFAULT 'planned_date'::text, p_direction text DEFAULT 'asc'::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company uuid:=private.get_current_user_company_id();v_result jsonb;
  v_sort text:=coalesce(nullif(p_sort,''),'planned_date');v_direction text:=coalesce(nullif(p_direction,''),'asc');
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501';end if;
  if coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','production_manager','production','quality','viewer') then
    raise exception 'Permission denied for finishing workload' using errcode='42501';end if;
  if p_page is null or p_page<1 or p_page>100000000 then raise exception 'Invalid finishing page';end if;
  if coalesce(p_status,'') not in ('','planned','sent_to_vendor','in_process','received','completed','rejected','not_required')
    or v_sort not in ('planned_date','created_at','order_number','status','input_weight_kg','output_weight_kg','rejection_weight_kg')
    or v_direction not in ('asc','desc') or length(coalesce(p_search,''))>100 then raise exception 'Invalid finishing filters';end if;

  -- All totals, preview rows, exact retry links and the database page share this statement.
  with recursive scoped as materialized (
    select f.*,j.id source_job_id,j.company_id source_company,j.order_id source_order,j.status source_status,
      j.finishing_type source_finish,j.actual_quantity_kg source_output,o.id verified_order,
      o.order_number,coalesce(c.company_name,c.customer_name) customer_name,j.job_number,v.vendor_name,v.id verified_vendor,o.customer_id source_customer,c.id verified_customer
    from public.finishing_jobs f
    left join public.production_jobs j on j.id=f.production_job_id and j.company_id=v_company
    left join public.orders o on o.id=f.order_id and o.company_id=v_company
    left join public.customers c on c.id=o.customer_id and c.company_id=v_company
    left join public.vendors v on v.id=f.vendor_id and v.company_id=v_company
    where f.company_id=v_company and (p_order_id is null or f.order_id=p_order_id)
      and (p_production_job_id is null or f.production_job_id=p_production_job_id)
      and (p_finishing_job_id is null or f.production_job_id=(select selected.production_job_id from public.finishing_jobs selected
        where selected.id=p_finishing_job_id and selected.company_id=v_company))
  ), children as materialized (
    select retry_of_finishing_job_id parent_id,count(*) child_count,sum(input_weight_kg) retry_input,
      jsonb_agg(jsonb_build_object('id',id,'status',status,'input_weight_kg',input_weight_kg) order by id)->0 corrective_retry
    from scoped where retry_of_finishing_job_id is not null group by retry_of_finishing_job_id
  ), linked as materialized (
    select s.*,parent.id parent_id,parent.company_id parent_company,parent.order_id parent_order,
      parent.production_job_id parent_job,parent.finishing_type parent_finish,parent.status parent_status,
      parent.input_weight_kg parent_input,parent.output_weight_kg parent_output,parent.rejection_weight_kg parent_rejection,
      coalesce(children.child_count,0) child_count,children.corrective_retry,children.retry_input
    from scoped s left join scoped parent on parent.id=s.retry_of_finishing_job_id left join children on children.parent_id=s.id
  ), reachable(id) as (
    select id from scoped where retry_of_finishing_job_id is null
    union
    select child.id from scoped child join reachable parent on child.retry_of_finishing_job_id=parent.id
  ), source_totals as (
    select production_job_id,sum(input_weight_kg) filter(where retry_of_finishing_job_id is null) root_input,
      sum(output_weight_kg) filter(where status in ('completed','rejected')) accepted_output,max(source_output) captured_output
    from scoped group by production_job_id
  ), checked as (
    select coalesce(bool_and(coalesce(source_job_id is not null and verified_order is not null and source_company=company_id
      and source_order=order_id and source_status='completed' and source_finish=finishing_type and source_output>0 and source_output::text not in ('NaN','Infinity','-Infinity')
      and (vendor_id is null or verified_vendor is not null) and (source_customer is null or verified_customer is not null)
      and status in ('planned','sent_to_vendor','in_process','received','completed','rejected','not_required')
      and input_weight_kg>0 and input_weight_kg::text not in ('NaN','Infinity','-Infinity')
      and coalesce(output_weight_kg,0)>=0 and coalesce(output_weight_kg,0)::text not in ('NaN','Infinity','-Infinity')
      and coalesce(rejection_weight_kg,0)>=0 and coalesce(rejection_weight_kg,0)::text not in ('NaN','Infinity','-Infinity')
      and coalesce(output_weight_kg,0)+coalesce(rejection_weight_kg,0)<=input_weight_kg+0.01
      and child_count<=1
      and (status not in ('completed','rejected') or (output_weight_kg is not null and rejection_weight_kg is not null
        and output_weight_kg+rejection_weight_kg<=input_weight_kg+0.01
        and (output_weight_kg=0 or (received_date is not null and received_date<=(now() at time zone 'Asia/Kolkata')::date
          and (sent_date is null or received_date>=sent_date)))))
      and (status<>'not_required' or (coalesce(output_weight_kg,0)=0 and coalesce(rejection_weight_kg,0)=0))
      and (retry_of_finishing_job_id is null or (parent_id is not null and parent_company=company_id and parent_order=order_id
        and parent_job=production_job_id and parent_finish=finishing_type and parent_status='rejected'
        and abs(input_weight_kg-least(parent_rejection,greatest(parent_input-coalesce(parent_output,0),0)))<=0.01)),false)),true)
      and (select count(*) from reachable)=(select count(*) from scoped)
      -- A malformed child outside the selected scope must not make its source retryable.
      and not exists(select 1 from public.finishing_jobs child join scoped parent on child.retry_of_finishing_job_id=parent.id
        where child.company_id is distinct from parent.company_id or child.order_id is distinct from parent.order_id
          or child.production_job_id is distinct from parent.production_job_id or child.finishing_type is distinct from parent.finishing_type)
      and not exists(select 1 from source_totals where coalesce(root_input,0)>captured_output+0.001
        or coalesce(accepted_output,0)>captured_output+0.001) integrity_ok
    from linked
  ), disposition as materialized (
    select l.*,case when status in ('completed','rejected') then greatest(rejection_weight_kg-coalesce(retry_input,0),0) else 0 end remaining_rejected_kg,
      status='rejected' and child_count=0 and least(rejection_weight_kg,greatest(input_weight_kg-coalesce(output_weight_kg,0),0))>0 can_retry
    from linked l
  ), totals as (
    select count(*) scope_count,count(*) filter(where status in ('planned','sent_to_vendor','in_process','received')) active_count,
      coalesce(sum(input_weight_kg) filter(where retry_of_finishing_job_id is null),0) original_input_kg,
      coalesce(sum(output_weight_kg) filter(where status in ('completed','rejected')),0) accepted_output_kg,
      coalesce(sum(input_weight_kg) filter(where status in ('planned','sent_to_vendor','in_process','received')),0) pending_input_kg,
      coalesce(sum(input_weight_kg) filter(where status in ('sent_to_vendor','in_process')),0) at_vendor_input_kg,
      coalesce(sum(input_weight_kg) filter(where status='not_required'),0) not_required_input_kg,
      coalesce(sum(remaining_rejected_kg),0) remaining_rejected_kg,count(*) filter(where can_retry) retry_eligible_count
    from disposition
  ), projected as materialized (
    select d.*,jsonb_build_object('id',id,'company_id',company_id,'order_id',order_id,'production_job_id',production_job_id,
      'finishing_type',finishing_type,'status',status,'color_code',color_code,'shade_name',shade_name,'vendor_id',vendor_id,
      'planned_date',planned_date,'sent_date',sent_date,'received_date',received_date,'created_at',created_at,'updated_at',updated_at,
      'input_weight_kg',input_weight_kg,'output_weight_kg',output_weight_kg,'rejection_weight_kg',rejection_weight_kg,
      'remaining_rejected_kg',remaining_rejected_kg,'retry_of_finishing_job_id',retry_of_finishing_job_id,'corrective_retry',corrective_retry,
      'can_retry',can_retry,'remarks',remarks,'order_number',order_number,'customer_name',customer_name,'job_number',job_number,'vendor_name',vendor_name) payload
    from disposition d
  ), queue_ranked as (
    select payload,status,row_number() over(partition by status order by planned_date asc nulls last,created_at asc,id asc) queue_position
    from projected where status in ('planned','sent_to_vendor','in_process','received','rejected')
  ), matched as materialized (
    select * from projected where (coalesce(p_status,'')='' or status=p_status)
      and (p_finishing_job_id is null or id=p_finishing_job_id)
      and (coalesce(btrim(p_search),'')='' or strpos(lower(concat_ws(' ',order_number,customer_name,job_number,vendor_name,finishing_type,status,color_code,shade_name,remarks)),lower(btrim(p_search)))>0)
  ), ranked as (
    select payload,row_number() over(order by
      case when v_direction='asc' and v_sort='planned_date' then planned_date end asc nulls last,
      case when v_direction='desc' and v_sort='planned_date' then planned_date end desc nulls last,
      case when v_direction='asc' and v_sort='created_at' then created_at end asc nulls last,
      case when v_direction='desc' and v_sort='created_at' then created_at end desc nulls last,
      case when v_direction='asc' and v_sort='order_number' then order_number end asc nulls last,
      case when v_direction='desc' and v_sort='order_number' then order_number end desc nulls last,
      case when v_direction='asc' and v_sort='status' then status end asc,
      case when v_direction='desc' and v_sort='status' then status end desc,
      case when v_direction='asc' and v_sort='input_weight_kg' then input_weight_kg end asc,
      case when v_direction='desc' and v_sort='input_weight_kg' then input_weight_kg end desc,
      case when v_direction='asc' and v_sort='output_weight_kg' then output_weight_kg end asc,
      case when v_direction='desc' and v_sort='output_weight_kg' then output_weight_kg end desc,
      case when v_direction='asc' and v_sort='rejection_weight_kg' then rejection_weight_kg end asc,
      case when v_direction='desc' and v_sort='rejection_weight_kg' then rejection_weight_kg end desc,id asc) position
    from matched
  ), paging as (
    select count(*) total_count,least(p_page,greatest(1,((count(*)+9)/10)::integer)) page from matched
  )
  select jsonb_build_object('company_id',v_company,'order_id',p_order_id,'production_job_id',p_production_job_id,'finishing_job_id',p_finishing_job_id,
    'integrity_ok',checked.integrity_ok,'scope_count',totals.scope_count,'page',paging.page,'page_size',10,'total_count',paging.total_count,
    'summary',jsonb_build_object('active_count',totals.active_count,'retry_eligible_count',totals.retry_eligible_count,
      'original_input_kg',totals.original_input_kg,'accepted_output_kg',totals.accepted_output_kg,'pending_input_kg',totals.pending_input_kg,
      'at_vendor_input_kg',totals.at_vendor_input_kg,'not_required_input_kg',totals.not_required_input_kg,'remaining_rejected_kg',totals.remaining_rejected_kg,
      'recorded_difference_kg',totals.original_input_kg-totals.accepted_output_kg-totals.pending_input_kg-totals.not_required_input_kg-totals.remaining_rejected_kg),
    'status_counts',(select jsonb_object_agg(s.status,(select count(*) from scoped where scoped.status=s.status))
      from unnest(array['planned','sent_to_vendor','in_process','received','completed','rejected','not_required']) s(status)),
    'queues',(select jsonb_object_agg(s.status,coalesce((select jsonb_agg(payload order by queue_position) from queue_ranked q where q.status=s.status and queue_position<=10),'[]'::jsonb))
      from unnest(array['planned','sent_to_vendor','in_process','received','rejected']) s(status)),
    'rows',coalesce((select jsonb_agg(payload order by position) from ranked where position>(paging.page::bigint-1)*10 and position<=paging.page::bigint*10),'[]'::jsonb),
    'vendors',coalesce((select jsonb_agg(jsonb_build_object('id',id,'company_id',company_id,'vendor_name',vendor_name,'vendor_type',vendor_type) order by vendor_name,id)
      from public.vendors where company_id=v_company and is_active and vendor_type in ('powder_coating','anodizing','other')),'[]'::jsonb))
  into v_result from totals cross join checked cross join paging;
  if p_finishing_job_id is not null and (v_result->>'total_count')::bigint=0 then raise exception 'Finishing receipt not found for this company and scope';end if;
  return v_result;
end;
$function$


-- FN public.get_invoice_source_options
CREATE OR REPLACE FUNCTION public.get_invoice_source_options(p_kind text, p_search text DEFAULT ''::text, p_order_id uuid DEFAULT NULL::uuid, p_invoice_id uuid DEFAULT NULL::uuid, p_selected_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_search text := lower(btrim(coalesce(p_search,'')));
  v_invoice public.invoices%rowtype;
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('owner','admin','accounts') then raise exception 'Permission denied for invoice sources' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('order','dispatch') or length(v_search)>100 or (p_kind='dispatch' and p_order_id is null) then
    raise exception 'Invalid invoice source request' using errcode='22023';
  end if;
  if p_invoice_id is not null then
    select * into v_invoice from public.invoices where id=p_invoice_id and company_id=v_company;
    if not found or v_invoice.status is null or v_invoice.status not in ('draft','generated') or coalesce(v_invoice.amount_paid,0)<>0 then
      raise exception 'Invoice source is unavailable or financially locked' using errcode='42501';
    end if;
    if (p_kind='dispatch' and p_order_id is distinct from v_invoice.order_id)
      or (p_selected_id is not null and p_selected_id is distinct from case when p_kind='order' then v_invoice.order_id else v_invoice.dispatch_id end) then
      raise exception 'An existing invoice must retain its original order and dispatch' using errcode='23514';
    end if;
  end if;
  if p_kind='order' then
    return (
      with matches as materialized (
        select source_order.id,source_order.order_number,source_order.customer_id,source_order.current_stage,source_order.order_value,
          customer.customer_name,customer.company_name,source_order.order_date
        from public.orders source_order join public.customers customer on customer.id=source_order.customer_id and customer.company_id=v_company
        where source_order.company_id=v_company and source_order.deleted_at is null
          and (p_invoice_id is null or source_order.id=v_invoice.order_id)
          and (p_selected_id is null or source_order.id=p_selected_id)
          and (v_search='' or strpos(lower(concat_ws(' ',source_order.order_number,customer.customer_name,customer.company_name)),v_search)>0)
          and exists(
            select 1 from public.dispatches dispatch_record
            where dispatch_record.company_id=v_company and dispatch_record.order_id=source_order.id
              and (p_invoice_id is null or dispatch_record.id=v_invoice.dispatch_id)
              and private.invoice_dispatch_is_billable(v_company,source_order.id,dispatch_record.id)
              and exists(select 1 from public.packing_list_items packing where packing.company_id=v_company and packing.dispatch_id=dispatch_record.id)
              and not exists(select 1 from public.invoices used where used.company_id=v_company and used.dispatch_id=dispatch_record.id and used.status<>'cancelled'
                and (p_invoice_id is null or used.id<>p_invoice_id))
          )
        order by source_order.order_date desc nulls last,source_order.id limit 26
      ), visible as (select * from matches order by order_date desc nulls last,id limit 25)
      select jsonb_build_object('kind','order','has_more',(select count(*)>25 from matches),'rows',
        coalesce((select jsonb_agg(to_jsonb(visible)-'order_date' order by order_date desc nulls last,id) from visible),'[]'::jsonb))
    );
  end if;
  if not exists(select 1 from public.orders where id=p_order_id and company_id=v_company and deleted_at is null) then
    raise exception 'Invoice source order is unavailable' using errcode='42501';
  end if;
  return (
    with matches as materialized (
      select dispatch_record.id,dispatch_record.order_id,dispatch_record.dispatch_number,dispatch_record.dispatch_date,
        dispatch_record.delivery_status,dispatch_record.total_weight_kg
      from public.dispatches dispatch_record
      where dispatch_record.company_id=v_company and dispatch_record.order_id=p_order_id
        and (p_invoice_id is null or dispatch_record.id=v_invoice.dispatch_id)
        and (p_selected_id is null or dispatch_record.id=p_selected_id)
        and (v_search='' or strpos(lower(concat_ws(' ',dispatch_record.dispatch_number,dispatch_record.delivery_status)),v_search)>0)
        and private.invoice_dispatch_is_billable(v_company,p_order_id,dispatch_record.id)
        and exists(select 1 from public.packing_list_items packing where packing.company_id=v_company and packing.dispatch_id=dispatch_record.id)
        and not exists(select 1 from public.invoices used where used.company_id=v_company and used.dispatch_id=dispatch_record.id and used.status<>'cancelled'
          and (p_invoice_id is null or used.id<>p_invoice_id))
      order by dispatch_record.dispatch_date desc nulls last,dispatch_record.id limit 26
    ), visible as (select * from matches order by dispatch_date desc nulls last,id limit 25)
    select jsonb_build_object('kind','dispatch','has_more',(select count(*)>25 from matches),'rows',
      coalesce((select jsonb_agg(to_jsonb(visible) order by dispatch_date desc nulls last,id) from visible),'[]'::jsonb))
  );
end;
$function$


-- FN public.get_manual_billet_allocation_options
CREATE OR REPLACE FUNCTION public.get_manual_billet_allocation_options(p_billet_id uuid, p_search text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company uuid:=private.get_current_user_company_id();
  v_billet public.foundry_billets%rowtype;
  v_header jsonb;
  v_result jsonb;
  v_search text:=btrim(coalesce(p_search,''));
begin
  if v_company is null or auth.uid() is null then raise exception 'Authentication required' using errcode='28000';end if;
  if coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'You do not have permission to allocate billets' using errcode='42501';end if;
  if p_page is null or p_page<1 or char_length(v_search)>100 then raise exception 'Invalid allocation search or page' using errcode='22023';end if;
  select * into v_billet from public.foundry_billets where id=p_billet_id and company_id=v_company;
  if not found then raise exception 'Billet not found' using errcode='23514';end if;
  v_header:=jsonb_build_object('id',v_billet.id,'company_id',v_company,'billet_code',v_billet.billet_code,
    'alloy',v_billet.alloy,'temper',v_billet.temper,'billet_diameter_inch',v_billet.billet_diameter_inch,
    'status',v_billet.status,'order_id',v_billet.order_id,'production_job_id',v_billet.production_job_id);
  if coalesce(v_billet.status,'') not in ('cast','allocated') or v_billet.production_job_id is not null then
    return jsonb_build_object('company_id',v_company,'billet',v_header,'search',v_search,'page',1,'page_size',10,'total_count',0,'items','[]'::jsonb);
  end if;
  if (v_billet.status='allocated' and v_billet.order_id is null)
    or (v_billet.order_id is not null and not exists(select 1 from public.orders where id=v_billet.order_id and company_id=v_company))
    or (v_billet.allocation_requirement_id is not null and not exists(select 1 from public.order_billet_requirements r
      where r.id=v_billet.allocation_requirement_id and r.company_id=v_company and r.order_id=v_billet.order_id
        and lower(btrim(coalesce(r.alloy,'')))=lower(btrim(coalesce(v_billet.alloy,'')))
        and lower(btrim(coalesce(r.temper,'')))=lower(btrim(coalesce(v_billet.temper,'')))
        and r.billet_diameter_inch=v_billet.billet_diameter_inch)) then
    raise exception 'Existing billet allocation needs historical review before reallocation' using errcode='23514';
  end if;
  -- A read must not repair legacy links or advertise capacity from stale counters.
  if exists(
    select 1 from public.order_billet_requirements r
    left join public.orders o on o.id=r.order_id and o.company_id=r.company_id
    left join lateral (select count(*)::integer allocated from public.foundry_billets b
      where b.company_id=r.company_id and b.order_id=r.order_id and b.allocation_requirement_id=r.id and b.status in ('allocated','issued','consumed')) actual on true
    where r.company_id=v_company and r.status is distinct from 'cancelled'
      and lower(btrim(coalesce(r.alloy,'')))=lower(btrim(coalesce(v_billet.alloy,'')))
      and lower(btrim(coalesce(r.temper,'')))=lower(btrim(coalesce(v_billet.temper,'')))
      and r.billet_diameter_inch=v_billet.billet_diameter_inch
      and (o.id is null or o.current_stage is null or (o.current_stage not in ('closed','cancelled','delivered','payment_pending') and (
        r.billets_required is null or r.billets_required<0 or r.billets_allocated is null or r.billets_short is null
        or actual.allocated>r.billets_required or r.billets_allocated<>actual.allocated
        or r.billets_short<>greatest(r.billets_required-actual.allocated,0)
        or exists(select 1 from public.foundry_billets b where b.allocation_requirement_id=r.id and b.status in ('allocated','issued','consumed')
          and (b.company_id is distinct from r.company_id or b.order_id is distinct from r.order_id
            or lower(btrim(coalesce(b.alloy,'')))<>lower(btrim(coalesce(r.alloy,'')))
            or lower(btrim(coalesce(b.temper,'')))<>lower(btrim(coalesce(r.temper,'')))
            or b.billet_diameter_inch is distinct from r.billet_diameter_inch
            or (b.production_job_id is not null and not exists(select 1 from public.production_jobs j
              where j.id=b.production_job_id and j.company_id=r.company_id and j.order_id=r.order_id and j.profile_id=r.profile_id))))
        or exists(select 1 from public.foundry_billets b where b.company_id=r.company_id and b.order_id=r.order_id
          and b.allocation_requirement_id is null and b.status in ('allocated','issued','consumed')
          and lower(btrim(coalesce(b.alloy,'')))=lower(btrim(coalesce(r.alloy,'')))
          and lower(btrim(coalesce(b.temper,'')))=lower(btrim(coalesce(r.temper,''))) and b.billet_diameter_inch=r.billet_diameter_inch)
      )))
  ) then raise exception 'Order allocation evidence needs refresh or historical review before choosing an order' using errcode='23514';end if;

  with matching as materialized (
    select r.*,o.order_number,o.priority,o.current_stage
    from public.order_billet_requirements r join public.orders o on o.id=r.order_id and o.company_id=r.company_id
    where r.company_id=v_company and o.current_stage not in ('closed','cancelled','delivered','payment_pending')
      and r.status<>'cancelled' and r.billets_allocated<r.billets_required
      and lower(btrim(coalesce(r.alloy,'')))=lower(btrim(coalesce(v_billet.alloy,'')))
      and lower(btrim(coalesce(r.temper,'')))=lower(btrim(coalesce(v_billet.temper,'')))
      and r.billet_diameter_inch=v_billet.billet_diameter_inch
      and (o.current_stage<>'dispatched' or private.order_profile_needs_billet_allocation(v_company,o.id,r.profile_id))
      and (v_search='' or strpos(lower(o.order_number),lower(v_search))>0)
  ), grouped as materialized (
    select v_company company_id,order_id,order_number,priority,current_stage,count(*)::integer requirement_count,
      sum(billets_required) billets_required,sum(billets_allocated) billets_allocated,sum(billets_required-billets_allocated) billets_short
    from matching group by order_id,order_number,priority,current_stage
  ), metadata as (
    select count(*)::integer total_count,least(p_page,greatest(1,ceil(count(*)/10.0)::integer)) page from grouped
  ), items as (
    select * from grouped order by order_number,order_id limit 10 offset (select (page-1)*10 from metadata)
  ) select jsonb_build_object('company_id',v_company,'billet',v_header,'search',v_search,
    'page',metadata.page,'page_size',10,'total_count',metadata.total_count,
    'items',coalesce((select jsonb_agg(to_jsonb(items) order by order_number,order_id) from items),'[]'::jsonb))
    into v_result from metadata;
  return v_result;
end;
$function$


-- FN public.get_operation_database_page
CREATE OR REPLACE FUNCTION public.get_operation_database_page(p_module text, p_search text DEFAULT ''::text, p_filters jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT NULL::text, p_direction text DEFAULT 'asc'::text, p_page integer DEFAULT 1, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
declare
  v_manifest constant jsonb := '{"orders":{"table":"orders","resource":"orders","search":["order_number","current_stage","priority","notes"],"customer":"customer_id","group":"current_stage","secondary":"priority","date":"expected_dispatch_date","sort":"expected_dispatch_date","sortFields":["expected_dispatch_date","order_number","order_origin","order_source_label","current_stage","priority","billets_required","billets_allocated","billet_allocation_status","order_date","expected_dispatch_date","order_value"],"roles":["owner","admin","sales_manager","sales","production_manager","production","factory_manager","inventory_manager","dispatch_manager","dispatch","quality","accounts","viewer"]},"quotes":{"table":"quotes","resource":"quotes","search":["quote_number","status","notes"],"customer":"customer_id","group":"status","date":"quote_date","sort":"created_at","sortFields":["created_at","quote_number","status","quote_date","valid_until","grand_total"],"roles":["owner","admin","sales_manager","sales","accounts","viewer","dealer_admin","dealer_staff"]},"dispatches":{"table":"dispatches","resource":"dispatches","search":["dispatch_number","delivery_status","transporter_name","vehicle_number","eway_bill_number","lr_number"],"order":"order_id","group":"delivery_status","date":"dispatch_date","sort":"dispatch_date","sortFields":["dispatch_date","dispatch_number","delivery_status","dispatch_date","vehicle_number","transporter_name","total_weight_kg"],"roles":["owner","admin","factory_manager","inventory_manager","dispatch_manager","dispatch","accounts","viewer"]},"production":{"table":"production_jobs","resource":"production","search":["job_number","status","shift","operator_name","remarks","notes"],"profile":"profile_id","order":"order_id","group":"status","date":"planned_date","sort":"planned_date","sortFields":["planned_date","job_number","status","planned_date","pieces","planned_quantity_kg"],"roles":["owner","admin","production_manager","production","factory_manager","quality","viewer"]},"foundry":{"table":"foundry_batches","resource":"foundry","search":["batch_number","furnace_number","furnace_name","alloy","temper","heat_number","status"],"group":"status","secondary":"alloy","date":"production_date","sort":"production_date","sortFields":["production_date","batch_number","furnace_number","status","alloy","temper","billet_count","furnace_efficiency_percent","required_furnace_charge_kg","total_billet_weight_density_kg","production_date"],"roles":["owner","admin","production_manager","production","factory_manager","quality"]},"foundry_external_sources":{"table":"foundry_external_aluminium_sources","resource":"foundry","search":["source_number","item_type","source_origin","alloy","quality_grade","status"],"group":"status","secondary":"item_type","date":"received_date","sort":"received_date","sortFields":["received_date","source_number","item_type","weight_kg","available_weight_kg","quantity","status","received_date"],"roles":["owner","admin","production_manager","production","factory_manager","quality"]},"foundry_billets":{"table":"foundry_billets","resource":"foundry","search":["billet_code","alloy","temper","status","source_type"],"group":"status","date":"created_at","sort":"created_at","sortFields":["created_at","billet_code","source_type","alloy","diameter","weight_kg","status","created_at"],"roles":["owner","admin","production_manager","production","factory_manager","quality"]},"machines":{"table":"machines","resource":"machine_maintenance","search":["machine_code","machine_name","manufacturer"],"group":"status","date":"created_at","sort":"machine_name","sortFields":["machine_name","machine_code","machine_name","machine_type","status","created_at"],"roles":["owner","admin"]},"outsourced_billets":{"table":"outsourced_billet_batches","resource":"foundry","search":["batch_number","alloy","temper","status"],"group":"status","date":"received_date","sort":"received_date","sortFields":["received_date","batch_number","alloy","billet_count","weight_kg","status","received_date"],"roles":["owner","admin","production_manager","production","factory_manager","quality"]},"foundry_scrap":{"table":"foundry_aluminium_scrap","resource":"foundry","search":["scrap_number","scrap_source","scrap_quality","origin_reference","status"],"group":"status","secondary":"scrap_quality","date":"received_date","sort":"received_date","sortFields":["received_date","scrap_number","scrap_source","weight_kg","scrap_quality","status","received_date"],"roles":["owner","admin","production_manager","production","factory_manager","quality"]},"packaging":{"table":"packaging_jobs","resource":"packaging","search":["packaging_number","status","notes"],"order":"order_id","group":"status","date":"scheduled_date","sort":"scheduled_date","sortFields":["scheduled_date","packaging_number","pieces","profile_weight_kg","status"],"roles":["owner","admin","production_manager","production","factory_manager","dispatch_manager","dispatch"]},"packaging_materials":{"table":"packaging_materials","resource":"packaging","search":["material_code","material_name","material_type","location"],"group":"material_type","secondary":"is_active","sort":"material_code","sortFields":["material_code","material_code","material_name","material_type","current_stock","reorder_level"],"roles":["owner","admin","production_manager","production","factory_manager","dispatch_manager","dispatch"]},"packaging_material_purchases":{"table":"packaging_material_purchases","resource":"packaging","search":["purchase_number","invoice_number","notes","payment_status"],"group":"payment_status","date":"received_date","sort":"received_date","sortFields":["received_date","purchase_number","received_date","material","vendor","quantity","rate","total_amount","payment_status"],"roles":["owner","admin","production_manager","production","factory_manager","dispatch_manager","dispatch"]},"packaging_job_materials":{"table":"packaging_job_materials","resource":"packaging","search":["packaging_materials.material_name","packaging_materials.material_code"],"sort":"created_at","sortFields":["created_at","job","quantity_required"],"roles":["owner","admin","production_manager","production","factory_manager","dispatch_manager","dispatch"]},"inventory":{"table":"inventory_items","resource":"inventory","search":["item_code","item_name","item_category","location"],"group":"item_category","secondary":"is_active","date":"updated_at","sort":"updated_at","sortFields":["updated_at","item_code","item_name","item_category","current_stock","reorder_level"],"roles":["owner","admin","sales_manager","sales","production_manager","production","factory_manager","inventory_manager","dispatch_manager","dispatch","quality","viewer","dealer_admin","dealer_staff"]},"customers":{"table":"customers","resource":"customers","search":["customer_name","company_name","contact_person","phone","whatsapp_number","email","gst_number","city","state","pincode","billing_address","shipping_address","customer_type","payment_terms","notes"],"group":"customer_type","secondary":"is_active","date":"created_at","sort":"created_at","sortFields":["created_at","customer_name","company_name","customer_type","city"],"roles":["owner","admin","sales_manager","sales","production_manager","factory_manager","accounts","viewer"]},"profiles":{"table":"aluminium_profiles","resource":"profiles","search":["profile_code","profile_name","application_category","alloy","temper"],"group":"application_category","secondary":"is_active","date":"created_at","sort":"profile_code","sortFields":["profile_code","profile_code","profile_name","application_category","section_weight_kg_per_m","billet_diameter_required_inch"],"roles":["owner","admin","production_manager","factory_manager","inventory_manager","viewer"]},"quality":{"table":"quality_inspections","resource":"quality","search":["batch_number","status","inspector_name","dimensional_variance"],"profile":"profile_id","group":"status","secondary":"surface_finish_ok","date":"inspection_date","sort":"inspection_date","sortFields":["inspection_date","batch_number","status","quantity_checked_kg","inspection_date"],"roles":["owner","admin","production_manager","quality","viewer"]},"invoices":{"table":"invoices","resource":"financials","search":["invoice_number","status","notes"],"customer":"customer_id","group":"status","date":"due_date","sort":"due_date","sortFields":["due_date","invoice_number","status","invoice_date","due_date","grand_total","balance_due"],"roles":["owner","admin","accounts"]},"vendors":{"table":"vendors","resource":"vendors","search":["vendor_name","vendor_type","contact_person","phone","gst_number","city"],"group":"vendor_type","secondary":"is_active","date":"created_at","sort":"created_at","sortFields":["created_at","vendor_name","vendor_type","city"],"roles":["owner","admin","sales_manager","production_manager","accounts"]},"tasks":{"table":"tasks","resource":"orders","search":["title","description","status"],"group":"status","date":"due_date","sort":"created_at","sortFields":["created_at","title","status","priority","due_date"],"roles":["owner","admin","sales_manager","sales","production_manager","production","factory_manager","inventory_manager","dispatch_manager","dispatch","quality","accounts","viewer"]},"payments":{"table":"payments","resource":"financials","search":["reference_number","payment_method","notes"],"group":"payment_status","date":"payment_date","sort":"payment_date","sortFields":["payment_date","payment_date","amount","payment_method","payment_type","payment_status"],"roles":["owner","admin","accounts"]},"expenses":{"table":"expense_ledger","resource":"financials","search":["expense_number","expense_category","expense_subcategory","invoice_number","description","source_module","source_submodule","source_label"],"group":"approval_status","secondary":"payment_status","date":"created_at","sort":"created_at","sortFields":["created_at","expense_number","created_at","expense_category","description","source_module","total_amount","amount_paid","balance_amount","payment_status","approval_status"],"roles":["owner","admin","accounts"]},"expense_payments":{"table":"expense_payments","resource":"financials","search":["reference_number","notes"],"date":"payment_date","sort":"payment_date","sortFields":["payment_date","payment_date","amount_paid","payment_method","reference_number"],"roles":["owner","admin","accounts"]}}'::jsonb;
  v_meta jsonb := v_manifest -> p_module;
  v_company uuid := public.get_current_user_company_id();
  v_role text := public.get_current_user_role();
  v_relation text;
  v_sort text;
  v_sort_expression text;
  v_sql text;
  v_where text;
  v_field text;
  v_value text;
  v_result jsonb;
  v_date_field text;
  v_joins text := '';
  v_projection text := '''{}''::jsonb';
  v_related_search text := '';
begin
  if auth.uid() is null or v_company is null or v_role is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if v_meta is null or not (v_meta->'roles' ? v_role) then
    raise exception 'Permission denied for this database' using errcode='42501';
  end if;
  if p_page is null or p_page < 1 or p_page > 100000 or p_direction is null or p_direction not in ('asc','desc')
     or p_search is null or length(p_search) > 100 or p_filters is null or jsonb_typeof(p_filters) <> 'object'
     or (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to) then
    raise exception 'Invalid search or pagination controls' using errcode='22023';
  end if;
  v_relation := v_meta->>'table';
  if v_relation in ('orders','quotes','production_jobs') then
    v_relation := v_relation || '_authorized';
  elsif to_regclass(format('public.%I',v_relation || '_authorized')) is not null then
    v_relation := v_relation || '_authorized';
  end if;
  v_sort := coalesce(nullif(p_sort,''),v_meta->>'sort');
  if not (v_meta->'sortFields' ? v_sort) then
    raise exception 'Unsupported sort column' using errcode='22023';
  end if;
  if exists (select 1 from pg_attribute where attrelid=to_regclass(format('public.%I',v_relation))
      and attname=v_sort and attnum>0 and not attisdropped) then
    v_sort_expression := format('t.%I',v_sort);
  else
    v_sort_expression := case v_sort
      when 'material' then 't.row_data->''packaging_materials''->>''material_name'''
      when 'vendor' then 't.row_data->''vendors''->>''vendor_name'''
      when 'job' then 't.row_data->''packaging_jobs''->>''packaging_number'''
      when 'diameter' then 't.billet_diameter_inch'
      when 'order_source_label' then 't.order_origin'
      else format('t.%I',v_meta->>'sort') end;
  end if;
  v_where := 't.company_id=$1 and (to_jsonb(t)->>''deleted_at'') is null';
  for v_field,v_value in select key,value from jsonb_each_text(p_filters) loop
    if v_field not in ('status','secondary','customer_id','profile_id','order_id','quote_id',
      'production_job_id','inventory_item_id','expense_ledger_id','source_record_id','material_id','job_id') then
      raise exception 'Unsupported filter' using errcode='22023';
    end if;
    if v_field='status' then v_field := v_meta->>'group';
    elsif v_field='secondary' then v_field := v_meta->>'secondary'; end if;
    if v_value is not null and v_value<>'' and v_field is not null then
      v_where := v_where || format(' and (to_jsonb(t)->>%L)=%L',v_field,v_value);
    end if;
  end loop;
  v_date_field := v_meta->>'date';
  if v_date_field is not null then
    if p_date_from is not null then
      v_where := v_where || format(' and (to_jsonb(t)->>%L)::timestamptz >= ($4::timestamp at time zone ''Asia/Kolkata'')',v_date_field);
    end if;
    if p_date_to is not null then
      v_where := v_where || format(' and (to_jsonb(t)->>%L)::timestamptz < (($5+1)::timestamp at time zone ''Asia/Kolkata'')',v_date_field);
    end if;
  end if;
  -- Each module references only its own lookup providers and their safe fields.
  -- An unrelated revoked provider must not make a permitted database unavailable.
  if v_meta ? 'order' or p_module='foundry_billets' then
    v_joins := v_joins || ' left join (select id,company_id,customer_id,order_number,priority from public.orders_authorized) o on o.company_id=$1 and o.id::text=(to_jsonb(t)->>''order_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''orders'',case when o.id is not null then jsonb_build_object(''order_number'',o.order_number,''priority'',o.priority) end)';
    v_related_search := v_related_search || ' or strpos(lower(coalesce(o.order_number,'''')),lower($2))>0';
  end if;
  if v_meta ? 'customer' or v_meta ? 'order' or p_module='foundry_billets' then
    v_joins := v_joins || format(' left join (select id,company_id,customer_name,company_name,gst_number from public.customers) c on c.company_id=$1 and c.id::text=%s',
      case when v_meta ? 'customer' then '(to_jsonb(t)->>''customer_id'')' else 'o.customer_id::text' end);
    v_projection := v_projection || ' || jsonb_build_object(''customers'',case when c.id is not null then jsonb_build_object(''customer_name'',c.customer_name,''company_name'',c.company_name) end)';
    v_related_search := v_related_search || ' or strpos(lower(coalesce(c.customer_name,'''') || '' '' || coalesce(c.company_name,'''') || '' '' || coalesce(c.gst_number,'''')),lower($2))>0';
    if v_meta ? 'order' then
      v_projection := v_projection || ' || jsonb_build_object(''orders'',case when o.id is not null then jsonb_build_object(''order_number'',o.order_number,''priority'',o.priority,''customers'',case when c.id is not null then jsonb_build_object(''customer_name'',c.customer_name,''company_name'',c.company_name) end) end)';
    end if;
  end if;
  if v_meta ? 'profile' then
    v_joins := v_joins || ' left join (select id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy,temper from public.aluminium_profiles) p on p.company_id=$1 and p.id::text=(to_jsonb(t)->>''profile_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''aluminium_profiles'',case when p.id is not null then jsonb_build_object(''profile_code'',p.profile_code,''profile_name'',p.profile_name,''section_weight_kg_per_m'',p.section_weight_kg_per_m,''alloy'',p.alloy,''temper'',p.temper) end)';
    v_related_search := v_related_search || ' or strpos(lower(coalesce(p.profile_code,'''') || '' '' || coalesce(p.profile_name,'''')),lower($2))>0';
  end if;
  if p_module in ('foundry_external_sources','outsourced_billets','foundry_scrap','packaging_materials','packaging_material_purchases','expenses') then
    v_joins := v_joins || ' left join (select id,company_id,vendor_name,vendor_type,phone from public.vendors) v on v.company_id=$1 and v.id::text=(to_jsonb(t)->>''vendor_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''vendors'',case when v.id is not null then jsonb_build_object(''vendor_name'',v.vendor_name,''vendor_type'',v.vendor_type,''phone'',v.phone) end)';
  end if;
  if p_module in ('packaging_material_purchases','packaging_job_materials') then
    v_joins := v_joins || ' left join (select id,company_id,material_code,material_name,material_type,unit from public.packaging_materials) m on m.company_id=$1 and m.id::text=(to_jsonb(t)->>''material_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''packaging_materials'',case when m.id is not null then jsonb_build_object(''material_code'',m.material_code,''material_name'',m.material_name,''material_type'',m.material_type,''unit'',m.unit) end)';
    v_related_search := v_related_search || ' or strpos(lower(coalesce(m.material_name,'''') || '' '' || coalesce(m.material_code,'''')),lower($2))>0';
  end if;
  if p_module='packaging_job_materials' then
    v_joins := v_joins || ' left join (select id,company_id,packaging_number from public.packaging_jobs) j on j.company_id=$1 and j.id::text=(to_jsonb(t)->>''job_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''packaging_jobs'',case when j.id is not null then jsonb_build_object(''packaging_number'',j.packaging_number) end)';
  end if;
  if p_module in ('packaging','quality') then
    v_joins := v_joins || ' left join (select id,company_id,job_number,profile_id from public.production_jobs_authorized) pj on pj.company_id=$1 and pj.id::text=(to_jsonb(t)->>''production_job_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''production_jobs'',case when pj.id is not null then jsonb_build_object(''job_number'',pj.job_number) end)';
  end if;
  if p_module='production' then
    v_joins := v_joins || ' left join (select id,company_id,machine_name from public.machines) ma on ma.company_id=$1 and ma.id::text=(to_jsonb(t)->>''machine_id'') left join (select id,company_id,die_number,rack_location from public.dies) d on d.company_id=$1 and d.id::text=(to_jsonb(t)->>''die_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''profile'',case when p.id is not null then jsonb_build_object(''profile_code'',p.profile_code,''profile_name'',p.profile_name,''alloy'',p.alloy,''temper'',p.temper) end,''machine'',case when ma.id is not null then jsonb_build_object(''machine_name'',ma.machine_name) end,''die'',case when d.id is not null then jsonb_build_object(''die_number'',d.die_number,''rack_location'',d.rack_location) end,''order'',case when o.id is not null then jsonb_build_object(''order_number'',o.order_number,''priority'',o.priority,''customers'',case when c.id is not null then jsonb_build_object(''customer_name'',c.customer_name,''company_name'',c.company_name) end) end)';
  end if;
  if p_module='packaging' then
    v_joins := v_joins || ' left join (select id,company_id,profile_code,profile_name from public.aluminium_profiles) pp on pp.company_id=$1 and pp.id=pj.profile_id';
    v_projection := v_projection || ' || jsonb_build_object(''production_jobs'',case when pj.id is not null then jsonb_build_object(''job_number'',pj.job_number,''profile'',case when pp.id is not null then jsonb_build_object(''profile_code'',pp.profile_code,''profile_name'',pp.profile_name) end) end)';
  end if;
  if p_module='quality' then
    v_joins := v_joins || ' left join (select id,company_id,finishing_type,status from public.finishing_jobs) f on f.company_id=$1 and f.id::text=(to_jsonb(t)->>''finishing_job_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''finishing_jobs'',case when f.id is not null then jsonb_build_object(''finishing_type'',f.finishing_type,''status'',f.status) end)';
  end if;
  if p_module='foundry_billets' then
    v_joins := v_joins || ' left join (select id,company_id,batch_number from public.foundry_batches) fb on fb.company_id=$1 and fb.id::text=(to_jsonb(t)->>''foundry_batch_id'') left join (select id,company_id,batch_number from public.outsourced_billet_batches) ob on ob.company_id=$1 and ob.id::text=(to_jsonb(t)->>''outsourced_batch_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''foundry_batches'',case when fb.id is not null then jsonb_build_object(''batch_number'',fb.batch_number) end,''outsourced_billet_batches'',case when ob.id is not null then jsonb_build_object(''batch_number'',ob.batch_number) end)';
  end if;
  if p_module='expenses' then
    v_joins := v_joins || ' left join (select id,company_id,item_code,item_name from public.inventory_items) i on i.company_id=$1 and i.id::text=(to_jsonb(t)->>''inventory_item_id'') left join (select id,company_id,machine_name from public.machines) ma on ma.company_id=$1 and ma.id::text=(to_jsonb(t)->>''machine_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''inventory_items'',case when i.id is not null then jsonb_build_object(''item_code'',i.item_code,''item_name'',i.item_name) end,''machines'',case when ma.id is not null then jsonb_build_object(''machine_name'',ma.machine_name) end)';
  end if;
  if p_module='expense_payments' then
    v_joins := v_joins || ' left join (select id,company_id,expense_number,description,total_amount from public.expense_ledger) e on e.company_id=$1 and e.id::text=(to_jsonb(t)->>''expense_ledger_id'')';
    v_projection := v_projection || ' || jsonb_build_object(''expense_ledger'',case when e.id is not null then jsonb_build_object(''expense_number'',e.expense_number,''description'',e.description,''total_amount'',e.total_amount) end)';
  end if;
  v_sql := format($query$
    with matched as materialized (
      select t.*, to_jsonb(t) || %s as row_data
      from public.%I t
      %s
      where %s and (
        $2='' or exists(select 1 from jsonb_array_elements_text($3->'search') field
          where strpos(lower(coalesce(to_jsonb(t)->>field,'')),lower($2))>0)
        %s
      )
    ), page as (
      select t.row_data from matched t order by %s %s nulls last,t.id asc limit 10 offset %s
    )
    select jsonb_build_object('rows',coalesce((select jsonb_agg(row_data) from page),'[]'::jsonb),
      'count',(select count(*) from matched))
  $query$,v_projection,v_relation,v_joins,v_where,v_related_search,v_sort_expression,p_direction,(p_page-1)*10);
  execute v_sql into v_result using v_company,p_search,v_meta,p_date_from,p_date_to;
  return v_result;
end;
$function$


-- FN public.get_profile_stock_consumption_totals
CREATE OR REPLACE FUNCTION public.get_profile_stock_consumption_totals(p_reservation_ids uuid[])
 RETURNS TABLE(reservation_id uuid, consumed_weight_kg numeric, consumed_length_m numeric, consumed_pieces integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
$function$


-- FN public.get_profile_stock_reservation_ledger_page
CREATE OR REPLACE FUNCTION public.get_profile_stock_reservation_ledger_page(p_page integer DEFAULT 1, p_search text DEFAULT ''::text, p_status text DEFAULT ''::text, p_sort text DEFAULT 'created_at'::text, p_direction text DEFAULT 'desc'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select private.profile_stock_reservation_ledger_page(p_page,p_search,p_status,p_sort,p_direction,null);
$function$


-- FN public.get_profitability_summary
CREATE OR REPLACE FUNCTION public.get_profitability_summary(p_dimension text DEFAULT 'customer'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_company_id uuid;
  v_role text;
  v_result jsonb;
begin
  select company_id, role::text into v_company_id, v_role from public.app_users where id = auth.uid() and is_active = true;
  if auth.uid() is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for profitability' using errcode = '42501';
  end if;
  if p_dimension is null or p_dimension not in ('customer','profile','die','salesperson','category','finishing','branch','month') then
    raise exception 'Unsupported profitability dimension' using errcode = '22023';
  end if;

  with base as materialized (
    select b.order_id, coalesce(b.revenue, 0) as revenue, coalesce(b.total_weight_kg, 0) as weight,
      coalesce(b.scrap_cost, 0) as scrap,
      -- Any unknown component makes the row's cost unknown; it is never treated as zero.
      (b.material_cost is null or b.conversion_cost is null or b.finishing_cost is null or b.packing_cost is null
        or b.transport_cost is null or b.scrap_cost is null or b.energy_cost is null or b.die_cost_allocated is null
        or b.overhead_cost is null or b.other_cost is null or b.revenue is null) as incomplete,
      coalesce(b.material_cost,0) + coalesce(b.conversion_cost,0) + coalesce(b.finishing_cost,0) + coalesce(b.packing_cost,0)
        + coalesce(b.transport_cost,0) + coalesce(b.scrap_cost,0) + coalesce(b.energy_cost,0) + coalesce(b.die_cost_allocated,0)
        + coalesce(b.overhead_cost,0) + coalesce(b.other_cost,0) as known_cost,
      coalesce(nullif(btrim(case p_dimension
        when 'customer' then b.customer_name when 'profile' then b.profile_name when 'die' then b.die_code
        when 'salesperson' then b.salesperson when 'category' then b.product_category when 'finishing' then b.finishing_type
        when 'branch' then b.branch else b.month_key end), ''), 'Unassigned') as dimension_key
    from public.order_cost_breakdown b
    where b.company_id = v_company_id
  ), settled as materialized (
    -- Pay days are measured from posted receipts: invoice date to the settling receipt date.
    select i.order_id, avg(i.paid_date - i.invoice_date)::numeric as pay_days
    from public.invoices i
    where i.company_id = v_company_id and i.status = 'paid' and i.paid_date is not null and i.invoice_date is not null
      and i.order_id is not null
    group by i.order_id
  ), outstanding as materialized (
    select i.order_id, avg(private.business_today() - i.invoice_date)::numeric as open_age
    from public.invoices i
    where i.company_id = v_company_id and i.status in ('generated','sent','partially_paid','overdue') and i.balance_due > 0
      and i.invoice_date is not null and i.order_id is not null
    group by i.order_id
  ), rows as materialized (
    select b.*, s.pay_days, o.open_age from base b
    left join settled s on s.order_id = b.order_id
    left join outstanding o on o.order_id = b.order_id
  ), groups as (
    select dimension_key, count(*) as row_count,
      count(*) filter (where incomplete) as incomplete_count,
      sum(revenue) as revenue,
      sum(revenue) filter (where not incomplete) as complete_revenue,
      sum(known_cost) filter (where not incomplete) as total_cost,
      sum(revenue - known_cost) filter (where not incomplete) as margin,
      sum(scrap) as scrap_cost, sum(weight) as weight_kg,
      avg(pay_days) as avg_pay_days, count(pay_days) as settled_count,
      avg(open_age) as avg_open_age, count(open_age) as open_count
    from rows group by dimension_key
  )
  select jsonb_build_object(
    'dimension', p_dimension,
    'totals', (select jsonb_build_object(
      'rows', count(*), 'incompleteRows', count(*) filter (where incomplete),
      'revenue', coalesce(sum(revenue), 0), 'completeRevenue', coalesce(sum(revenue) filter (where not incomplete), 0),
      'totalCost', coalesce(sum(known_cost) filter (where not incomplete), 0),
      'margin', coalesce(sum(revenue - known_cost) filter (where not incomplete), 0),
      'weightKg', coalesce(sum(weight), 0), 'scrapCost', coalesce(sum(scrap), 0),
      'avgPayDays', round(avg(pay_days), 1), 'settledRows', count(pay_days),
      'avgOpenAgeDays', round(avg(open_age), 1), 'openRows', count(open_age)) from rows),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
      'key', dimension_key, 'rows', row_count, 'incompleteRows', incomplete_count, 'revenue', revenue,
      'completeRevenue', coalesce(complete_revenue, 0), 'totalCost', coalesce(total_cost, 0), 'margin', coalesce(margin, 0),
      'marginPct', case when coalesce(complete_revenue, 0) > 0 then round(100.0 * margin / complete_revenue, 2) end,
      'scrapCost', scrap_cost, 'weightKg', weight_kg,
      'avgPayDays', round(avg_pay_days, 1), 'settledRows', settled_count,
      'avgOpenAgeDays', round(avg_open_age, 1), 'openRows', open_count) order by revenue desc, dimension_key)
      from groups), '[]'::jsonb),
    'generatedAt', now()
  ) into v_result;
  return v_result;
end;
$function$


-- FN public.get_unread_notification_count
CREATE OR REPLACE FUNCTION public.get_unread_notification_count()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid := private.get_current_user_company_id();
  v_count bigint;
begin
  if v_user_id is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select count(*)
  into v_count
  from public.notifications notification
  where private.notification_visible_to_current_user(
      notification.company_id,
      notification.recipient_user_id,
      notification.recipient_role,
      notification.dealer_id
    )
    and (
      (notification.recipient_user_id = v_user_id and notification.is_read = false)
      or (
        notification.recipient_user_id is null
        and not exists (
          select 1
          from public.notification_read_receipts receipt
          where receipt.notification_id = notification.id
            and receipt.user_id = v_user_id
            and receipt.company_id = v_company_id
        )
      )
    );

  return v_count;
end;
$function$


-- FN public.guard_active_dispatch_packing
CREATE OR REPLACE FUNCTION public.guard_active_dispatch_packing()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$


-- FN public.guard_foundry_batch_material_integrity
CREATE OR REPLACE FUNCTION public.guard_foundry_batch_material_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_committed boolean;
  v_physical_changed boolean;
  v_rank_old integer;
  v_rank_new integer;
begin
  if tg_op = 'DELETE' then raise exception 'Foundry batches cannot be deleted; cancel a planned batch instead'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'planned' then raise exception 'New foundry batches must start as planned'; end if;
    if coalesce(new.scrap_percentage, 0) > 0 and coalesce(new.scrap_aluminium_kg, 0) > 0 and new.scrap_id is null then
      raise exception 'A same-company scrap source is required for a positive scrap charge';
    end if;
    if coalesce(new.external_aluminium_percentage, 0) > 0 and coalesce(new.external_aluminium_kg, 0) > 0 and new.external_source_id is null then
      raise exception 'A same-company external source is required for a positive external-aluminium charge';
    end if;
    return new;
  end if;

  if old.id is distinct from new.id or old.company_id is distinct from new.company_id then raise exception 'Foundry batch identity is immutable'; end if;
  if old.status = 'cancelled' then raise exception 'Cancelled foundry batches are immutable'; end if;
  if coalesce(new.scrap_percentage, 0) > 0 and coalesce(new.scrap_aluminium_kg, 0) > 0 and new.scrap_id is null then
    raise exception 'A same-company scrap source is required for a positive scrap charge';
  end if;
  if coalesce(new.external_aluminium_percentage, 0) > 0 and coalesce(new.external_aluminium_kg, 0) > 0 and new.external_source_id is null then
    raise exception 'A same-company external source is required for a positive external-aluminium charge';
  end if;

  select exists (
    select 1 from public.foundry_billets b
    where b.company_id = old.company_id and b.foundry_batch_id = old.id and b.source_type = 'in_house'
      and (b.status in ('allocated','issued','consumed','scrap') or b.order_id is not null
        or b.allocation_requirement_id is not null or b.production_job_id is not null
        or b.allocated_at is not null or b.allocated_by is not null)
  ) into v_committed;

  v_physical_changed := row(
    old.scrap_id, old.external_source_id, old.scrap_percentage, old.external_aluminium_percentage,
    old.furnace_efficiency_percent, old.alloy, old.temper, old.alloy_density_kg_m3,
    old.billet_length_mm, old.billet_diameter_inch, old.billet_diameter_mm, old.billet_count,
    old.production_date, old.furnace_number, old.furnace_name, old.batch_sequence,
    old.alloy_composition_default, old.alloy_composition_actual, old.alloy_composition_altered
  ) is distinct from row(
    new.scrap_id, new.external_source_id, new.scrap_percentage, new.external_aluminium_percentage,
    new.furnace_efficiency_percent, new.alloy, new.temper, new.alloy_density_kg_m3,
    new.billet_length_mm, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_count,
    new.production_date, new.furnace_number, new.furnace_name, new.batch_sequence,
    new.alloy_composition_default, new.alloy_composition_actual, new.alloy_composition_altered
  );

  if v_committed and v_physical_changed then
    raise exception 'Foundry batch material is committed; physical, source, mix, and count fields are immutable';
  end if;
  if old.status <> 'planned' and v_physical_changed then
    raise exception 'Foundry batch physical, source, mix, and count fields freeze after planning';
  end if;

  if new.status = 'cancelled' then
    if old.status <> 'planned' or v_committed then
      raise exception 'Only an uncommitted planned foundry batch can be cancelled';
    end if;
    return new;
  end if;

  v_rank_old := case old.status when 'planned' then 0 when 'melting' then 1 when 'cast' then 2 when 'homogenizing' then 3 when 'ready' then 4 when 'issued' then 5 else -1 end;
  v_rank_new := case new.status when 'planned' then 0 when 'melting' then 1 when 'cast' then 2 when 'homogenizing' then 3 when 'ready' then 4 when 'issued' then 5 else -1 end;
  if v_rank_new < v_rank_old then raise exception 'Foundry batch status cannot regress'; end if;

  if new.billet_count < old.billet_count then
    if old.status <> 'planned' or v_committed then
      raise exception 'Billet count cannot shrink after material commitment';
    end if;
    if exists (
      select 1 from public.foundry_billets b
      where b.company_id = old.company_id and b.foundry_batch_id = old.id and b.source_type = 'in_house'
        and b.billet_number > new.billet_count
        and (b.status not in ('planned','cancelled') or b.order_id is not null or b.allocation_requirement_id is not null
          or b.production_job_id is not null or b.allocated_at is not null or b.allocated_by is not null)
    ) then raise exception 'Surplus billets are allocated or otherwise committed and cannot be cancelled'; end if;
  end if;
  return new;
end;
$function$


-- FN public.guard_foundry_billet_material_integrity
CREATE OR REPLACE FUNCTION public.guard_foundry_billet_material_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_batch public.foundry_batches%rowtype;
  v_physical_changed boolean;
  v_new_rank integer;
  v_old_rank integer;
begin
  if tg_op = 'DELETE' then
    if old.source_type = 'in_house' then raise exception 'In-house billet records cannot be deleted'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (old.id is distinct from new.id or old.company_id is distinct from new.company_id
    or old.source_type is distinct from new.source_type or old.foundry_batch_id is distinct from new.foundry_batch_id
    or old.billet_number is distinct from new.billet_number) then
    raise exception 'Billet identity and batch lineage are immutable';
  end if;
  if new.source_type <> 'in_house' then return new; end if;
  if pg_trigger_depth() < 2 and (tg_op = 'INSERT' or old.weight_kg is distinct from new.weight_kg
    or old.billet_diameter_inch is distinct from new.billet_diameter_inch or old.billet_diameter_mm is distinct from new.billet_diameter_mm
    or old.billet_length_mm is distinct from new.billet_length_mm or old.alloy is distinct from new.alloy or old.temper is distinct from new.temper) then
    raise exception 'In-house billet physical attributes are maintained only by the batch calculation';
  end if;

  begin
    select * into v_batch from public.foundry_batches
    where id = new.foundry_batch_id and company_id = new.company_id
    for share nowait;
  exception when lock_not_available then
    raise exception 'Foundry batch is being changed; retry billet update' using errcode = '55P03';
  end;
  if not found then raise exception 'Foundry batch does not belong to this company'; end if;

  if new.billet_code is distinct from concat(v_batch.furnace_number, '-', to_char(v_batch.production_date, 'YYYYMMDD'), '-', v_batch.batch_sequence::text, '-', new.billet_number::text)
    or (tg_op = 'UPDATE' and old.billet_code is distinct from new.billet_code and pg_trigger_depth() < 2) then
    raise exception 'In-house billet code must match its batch identity';
  end if;
  if new.billet_number > v_batch.billet_count and new.status <> 'cancelled'
    or new.billet_diameter_inch is distinct from v_batch.billet_diameter_inch
    or new.billet_diameter_mm is distinct from v_batch.billet_diameter_mm
    or new.billet_length_mm is distinct from v_batch.billet_length_mm
    or new.alloy is distinct from v_batch.alloy or new.temper is distinct from v_batch.temper
    or new.weight_kg is distinct from v_batch.billet_weight_density_kg then
    raise exception 'In-house billet attributes and active number must match the calculated parent batch';
  end if;

  v_physical_changed := tg_op = 'UPDATE' and row(old.weight_kg, old.billet_diameter_inch, old.billet_diameter_mm,
    old.billet_length_mm, old.alloy, old.temper) is distinct from row(new.weight_kg, new.billet_diameter_inch,
    new.billet_diameter_mm, new.billet_length_mm, new.alloy, new.temper);
  if v_physical_changed and (v_batch.status <> 'planned'
    or (old.status <> 'planned' and not (old.status = 'cancelled' and new.status = 'planned'
      and new.billet_number <= v_batch.billet_count and pg_trigger_depth() >= 2))
    or old.order_id is not null or old.allocation_requirement_id is not null or old.production_job_id is not null) then
    raise exception 'Committed billet physical attributes are immutable';
  end if;
  if v_batch.status in ('planned','melting') and new.status in ('cast','allocated','issued','consumed','scrap') then
    raise exception 'Billets cannot become usable before the parent batch is cast';
  end if;
  if tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'cast' and pg_trigger_depth() < 2 then
    raise exception 'Cast stock status is maintained only by the batch workflow';
  end if;
  if tg_op = 'UPDATE' then
    v_old_rank := case old.status when 'planned' then 0 when 'cast' then 1 when 'allocated' then 2 when 'issued' then 3 when 'consumed' then 4 when 'scrap' then 4 when 'cancelled' then 5 else -1 end;
    v_new_rank := case new.status when 'planned' then 0 when 'cast' then 1 when 'allocated' then 2 when 'issued' then 3 when 'consumed' then 4 when 'scrap' then 4 when 'cancelled' then 5 else -1 end;
    if v_new_rank < v_old_rank and not (old.status = 'allocated' and new.status = 'cast'
      and new.order_id is null and new.allocation_requirement_id is null and new.production_job_id is null)
      and not (old.status = 'cancelled' and v_batch.status = 'planned' and new.status = 'planned'
        and new.order_id is null and new.allocation_requirement_id is null and new.production_job_id is null
        and new.billet_number <= v_batch.billet_count and pg_trigger_depth() >= 2) then
      raise exception 'Committed billet status cannot regress';
    end if;
    if old.status in ('issued','consumed','scrap') and (
      old.order_id is distinct from new.order_id or old.allocation_requirement_id is distinct from new.allocation_requirement_id
      or old.production_job_id is distinct from new.production_job_id or old.allocated_at is distinct from new.allocated_at
      or old.allocated_by is distinct from new.allocated_by
    ) then raise exception 'Issued and consumed billet lineage is immutable'; end if;
    if old.status in ('consumed','scrap') and old.status is distinct from new.status then
      raise exception 'Consumed or scrapped billet status is terminal';
    end if;
    if old.status = 'cancelled' and new.status <> 'cancelled' and not (v_batch.status = 'planned'
      and new.status = 'planned' and new.order_id is null and new.allocation_requirement_id is null
      and new.production_job_id is null and new.billet_number <= v_batch.billet_count and pg_trigger_depth() >= 2) then
      raise exception 'Cancelled billet can only be restored by expanding its planned batch';
    end if;
  end if;
  if new.status = 'cancelled' and (new.order_id is not null or new.allocation_requirement_id is not null or new.production_job_id is not null) then
    raise exception 'Linked billets cannot be cancelled';
  end if;
  if new.status = 'allocated' and (new.order_id is null or new.allocation_requirement_id is null
    or new.allocated_at is null or new.allocated_by is null) then
    raise exception 'Allocated billets require complete order and allocation lineage';
  end if;
  if new.status in ('issued','consumed') and (new.order_id is null or new.production_job_id is null) then
    raise exception 'Issued or consumed billets require order and production-job lineage';
  end if;
  if new.status = 'cancelled' and not (pg_trigger_depth() >= 2
    and ((v_batch.status = 'cancelled' and old.status = 'planned')
      or (v_batch.status = 'planned' and old.status = 'planned' and new.billet_number > v_batch.billet_count))) then
    raise exception 'Billet cancellation must be performed by its planned batch';
  end if;
  return new;
end;
$function$


-- FN public.guard_pending_factory_load
CREATE OR REPLACE FUNCTION public.guard_pending_factory_load()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.order_id is not null
     and new.status in ('ready','in_progress','completed')
     and exists (
       select 1 from public.factory_load_consolidations queue
       where queue.company_id = new.company_id
         and queue.order_id = new.order_id
         and queue.status = 'pending'
     ) then
    raise exception 'This order is waiting in the sub-700 kg consolidation queue';
  end if;
  return new;
end;
$function$


-- FN public.guard_production_job_status
CREATE OR REPLACE FUNCTION public.guard_production_job_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$


-- FN public.guard_terminal_packaging_job
CREATE OR REPLACE FUNCTION public.guard_terminal_packaging_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.status in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled packaging jobs are immutable; use a reversal record for corrections'
      using errcode = '23514';
  end if;
  if new.status = 'cancelled'
     and new.production_job_id is not null
     and exists (
       select 1
       from public.packing_list_items item
       where item.company_id = new.company_id
         and item.source_line_id = new.production_job_id
     ) then
    raise exception 'Packaging cannot be cancelled after its production output is allocated to a packing list'
      using errcode = '23514';
  end if;
  return new;
end;
$function$


-- FN public.guard_terminal_packaging_material
CREATE OR REPLACE FUNCTION public.guard_terminal_packaging_material()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status into v_status
    from public.packaging_jobs
    where id = old.job_id;
    if v_status in ('completed', 'cancelled') then
      raise exception 'Materials on completed or cancelled packaging jobs are immutable'
        using errcode = '23514';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select status into v_status
    from public.packaging_jobs
    where id = new.job_id;
    if v_status in ('completed', 'cancelled') then
      raise exception 'Materials on completed or cancelled packaging jobs are immutable'
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$


-- FN public.guard_terminal_quality_inspection
CREATE OR REPLACE FUNCTION public.guard_terminal_quality_inspection()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.status in ('approved', 'rejected', 'rework') then
    raise exception 'Final quality dispositions are immutable; record a new inspection for corrections'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$


-- FN public.handle_available_billet_allocation
CREATE OR REPLACE FUNCTION public.handle_available_billet_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'cast' and new.order_id is null then
    perform public.allocate_billets_by_priority(new.company_id);
  end if;
  return new;
end;
$function$


-- FN public.handle_order_billet_requirements
CREATE OR REPLACE FUNCTION public.handle_order_billet_requirements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  perform public.rebuild_order_billet_requirements(new.id);
  -- Sales can capture a priced order; factory roles retain billet allocation.
  if not exists(select 1 from private.direct_order_requests where order_id=new.id and company_id=new.company_id)
    or auth.uid() is null or private.get_current_user_role() in ('owner','admin','factory_manager','production_manager','production') then
    perform public.allocate_billets_by_priority(new.company_id);
  end if;
  return new;
end;
$function$


-- FN public.handle_packaging_job_status_change
CREATE OR REPLACE FUNCTION public.handle_packaging_job_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN
      -- Job is cancelled, restore all materials
      FOR m IN SELECT * FROM public.packaging_job_materials WHERE job_id = NEW.id LOOP
        UPDATE public.packaging_materials
        SET current_stock = current_stock + m.quantity_required,
            updated_at = now()
        WHERE id = m.material_id AND company_id = m.company_id;

        INSERT INTO public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
        VALUES (m.company_id, NEW.id, m.material_id, 'restore', m.quantity_required, auth.uid());
      END LOOP;
    ELSIF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
      -- Job is un-cancelled (rare, but handle it by issuing materials)
      FOR m IN SELECT * FROM public.packaging_job_materials WHERE job_id = NEW.id LOOP
        UPDATE public.packaging_materials
        SET current_stock = current_stock - m.quantity_required,
            updated_at = now()
        WHERE id = m.material_id AND company_id = m.company_id AND current_stock >= m.quantity_required;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Not enough packaging material stock to restore job' USING ERRCODE = '23514';
        END IF;

        INSERT INTO public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
        VALUES (m.company_id, NEW.id, m.material_id, 'issue', m.quantity_required, auth.uid());
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$


-- FN public.handoff_system_configuration_to_production_atomic
CREATE OR REPLACE FUNCTION public.handoff_system_configuration_to_production_atomic(p_configuration_id uuid, p_jobs jsonb, p_remarks text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_company uuid := private.get_current_user_company_id();
  v_config public.system_configurations%rowtype;
  v_order public.orders%rowtype;
  v_job jsonb;
  v_line public.order_items%rowtype;
  v_profile uuid;
  v_order_id uuid;
  v_jobs jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','production_manager') then
    raise exception 'Permission denied for production handoff' using errcode='42501';
  end if;
  select * into v_config from public.system_configurations where id=p_configuration_id and company_id=v_company for update;
  if not found then raise exception 'System configuration not found for this company'; end if;
  if v_config.quote_id is not null then
    if (select count(*) from public.orders where company_id=v_company and quote_id=v_config.quote_id
      and (v_config.order_id is null or id=v_config.order_id)) <> 1 then
      raise exception 'Convert the approved linked quote to one unambiguous canonical order before production handoff';
    end if;
    select * into v_order from public.orders where company_id=v_company and quote_id=v_config.quote_id
      and (v_config.order_id is null or id=v_config.order_id) for update;
    if not found then raise exception 'Convert the approved linked quote to a canonical order before production handoff'; end if;
    if v_order.customer_id is distinct from v_config.customer_id then raise exception 'Configuration customer does not match its commercial order'; end if;
    if v_config.status='in_production' then
      return private.handoff_system_configuration_to_production_atomic(p_configuration_id,p_jobs,p_remarks);
    end if;
    if p_jobs is null or jsonb_typeof(p_jobs)<>'array' or jsonb_array_length(p_jobs)=0 or jsonb_array_length(p_jobs)>100 then
      raise exception 'Provide every profile exactly once for production handoff';
    end if;
    if (select count(*) from jsonb_array_elements(p_jobs)) <> (select count(distinct value->>'profile_id') from jsonb_array_elements(p_jobs))
      or jsonb_array_length(p_jobs) <> (select count(*) from public.order_items where company_id=v_company and order_id=v_order.id) then
      raise exception 'Provide every commercial profile exactly once for production handoff';
    end if;
    for v_job in select value from jsonb_array_elements(p_jobs) loop
      v_profile := nullif(v_job->>'profile_id','')::uuid;
      if (select count(*) from public.order_items where company_id=v_company and order_id=v_order.id and profile_id=v_profile) <> 1 then
        raise exception 'Each configuration profile requires one unambiguous canonical order line';
      end if;
      select * into v_line from public.order_items where company_id=v_company and order_id=v_order.id and profile_id=v_profile
        and (nullif(v_job->>'source_line_id','') is null or id=nullif(v_job->>'source_line_id','')::uuid) for update;
      if not found or v_line.configuration_cut_snapshot is null or v_line.quote_item_id is null or v_line.quantity_kg is null or v_line.total_meters is null
         or not exists(select 1 from public.quote_items qi join public.quotes q on q.id=qi.quote_id and q.company_id=qi.company_id
           where qi.id=v_line.quote_item_id and qi.company_id=v_company and q.id=v_config.quote_id and q.system_configuration_id=v_config.id
             and qi.configuration_cut_snapshot=v_line.configuration_cut_snapshot and qi.profile_id=v_line.profile_id)
         or abs(coalesce((v_job->>'planned_quantity_kg')::numeric,-1)-v_line.quantity_kg)>0.001
         or abs(coalesce((v_job->>'planned_meters')::numeric,-1)-v_line.total_meters)>0.001 then
        raise exception 'Each profile job must preserve the exact configuration cut snapshot and canonical order line kilograms/metres';
      end if;
      v_jobs := v_jobs || jsonb_build_array(v_job || jsonb_build_object('source_line_id',v_line.id,
        'remarks',format('System configuration %s / profile %s',coalesce(v_config.configuration_number,v_config.id::text),v_line.profile_id)));
    end loop;
    v_order_id := private.handoff_system_configuration_to_production_atomic(p_configuration_id,v_jobs,p_remarks);
    update public.production_jobs j set pieces=line.quantity_pieces,updated_at=now()
    from public.order_items line where j.company_id=v_company and j.order_id=v_order_id
      and line.id=j.source_line_id and line.company_id=v_company and line.order_id=v_order_id
      and j.remarks like 'System configuration ' || coalesce(v_config.configuration_number,v_config.id::text) || ' / profile %';
    return v_order_id;
  end if;
  return private.handoff_system_configuration_to_production_atomic(p_configuration_id,p_jobs,p_remarks);
end;
$function$


-- FN public.is_owner_or_admin
CREATE OR REPLACE FUNCTION public.is_owner_or_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private'
AS $function$
  select private.is_owner_or_admin();
$function$


-- FN public.issue_dispatch_return_credit_note_atomic
CREATE OR REPLACE FUNCTION public.issue_dispatch_return_credit_note_atomic(p_dispatch_id uuid, p_reason text, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.issue_dispatch_return_credit_note_atomic(p_dispatch_id, p_reason, p_idempotency_key) $function$


-- FN public.link_billets_to_production_job
CREATE OR REPLACE FUNCTION public.link_billets_to_production_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    if coalesce(new.actual_quantity_kg, 0) <= 0 then
      raise exception 'Capture actual production output before completing the job'
        using errcode = '23514';
    end if;

    update public.foundry_billets
    set status = 'consumed', updated_at = now()
    where company_id = new.company_id
      and production_job_id = new.id
      and status in ('allocated','issued');

    if coalesce(new.finishing_type, 'mill_finish') = 'mill_finish' then
      insert into public.packaging_jobs(
        company_id, packaging_number, order_id, production_job_id,
        scheduled_date, pieces, profile_weight_kg, profile_length_m,
        status, notes, created_by
      )
      select
        new.company_id,
        concat('PKG-', to_char(current_date, 'YYYY'), '-', substring(new.id::text, 1, 8)),
        new.order_id,
        new.id,
        current_date,
        coalesce(nullif(new.actual_pieces, 0), new.pieces, 0),
        new.actual_quantity_kg,
        coalesce(nullif(new.actual_meters, 0), coalesce(new.length_per_piece_m, 0) * coalesce(nullif(new.actual_pieces, 0), new.pieces, 0)),
        'scheduled',
        'Mill-finish output queued after extrusion. Complete QC release and issue packaging materials.',
        auth.uid()
      where not exists (
        select 1 from public.packaging_jobs existing
        where existing.company_id = new.company_id
          and existing.production_job_id = new.id
      )
      on conflict (company_id, packaging_number) do nothing;
    else
      insert into public.finishing_jobs(
        company_id, order_id, production_job_id, finishing_type,
        planned_date, input_weight_kg, output_weight_kg,
        rejection_weight_kg, status, remarks
      )
      select
        new.company_id,
        new.order_id,
        new.id,
        new.finishing_type,
        current_date,
        new.actual_quantity_kg,
        0,
        0,
        'planned',
        'Auto-created after extrusion. Record send, receipt, accepted output, and finishing QC.'
      where not exists (
        select 1 from public.finishing_jobs existing
        where existing.company_id = new.company_id
          and existing.production_job_id = new.id
          and existing.status <> 'rejected'
      );
    end if;

    perform private.advance_order_stage(
      new.company_id,
      new.order_id,
      'extruded',
      concat('Production job ', coalesce(new.job_number, new.id::text), ' completed with ', new.actual_quantity_kg, ' kg actual output; route ', coalesce(new.finishing_type, 'mill_finish'), '.')
    );
  end if;
  return new;
end;
$function$


-- FN public.list_open_quality_rework_inspections
CREATE OR REPLACE FUNCTION public.list_open_quality_rework_inspections(p_offset integer DEFAULT 0, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, batch_number text, quantity_checked_kg numeric, profile_id uuid, production_job_id uuid, profile_code text, profile_name text, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 10);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null or v_company_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not coalesce(public.get_current_user_role() in ('owner','admin','production_manager','quality','viewer'), false) then
    raise exception 'Role is not authorized to read quality inspections' using errcode = '42501';
  end if;
  return query
  select q.id, q.batch_number, q.quantity_checked_kg, q.profile_id, q.production_job_id,
    p.profile_code, p.profile_name, count(*) over ()
  from public.quality_inspections q
  left join public.aluminium_profiles p on p.id = q.profile_id and p.company_id = q.company_id
  where q.company_id = v_company_id and q.status = 'rework'
    and not exists (
      select 1 from public.quality_rework_resolutions resolution
      where resolution.company_id = q.company_id and resolution.source_inspection_id = q.id
    )
  order by q.inspection_date, q.id
  offset v_offset limit v_limit;
end;
$function$


-- FN public.log_company_settings_change
CREATE OR REPLACE FUNCTION public.log_company_settings_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is not null
    and new.company_id = public.get_current_user_company_id()
    and to_jsonb(old) is distinct from to_jsonb(new)
  then
    insert into public.sensitive_action_logs (
      company_id, user_id, action_type, entity_type, entity_id, description
    ) values (
      new.company_id, actor_id, 'change_company_settings', 'company_settings', new.id::text,
      'Company settings changed'
    );
  end if;
  return new;
end;
$function$


-- FN public.log_expense_audit
CREATE OR REPLACE FUNCTION public.log_expense_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (new.company_id, auth.uid(), 'expense_created', 'expense_ledger', new.id,
      jsonb_build_object('expense_number', new.expense_number, 'source_table', new.source_table,
        'source_record_id', new.source_record_id, 'total_amount', new.total_amount,
        'approval_status', new.approval_status));
    return new;
  end if;
  select coalesce(jsonb_object_agg(n.key, jsonb_build_object('before', o.value, 'after', n.value)), '{}'::jsonb)
    into v_changes
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where n.value is distinct from o.value and n.key not in ('updated_at');
  if v_changes <> '{}'::jsonb then
    insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (new.company_id, auth.uid(), 'expense_updated', 'expense_ledger', new.id,
      jsonb_build_object('expense_number', new.expense_number, 'changes', v_changes));
  end if;
  return new;
end;
$function$


-- FN public.log_expense_payment_audit
CREATE OR REPLACE FUNCTION public.log_expense_payment_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (
    coalesce(new.company_id, old.company_id), auth.uid(),
    case tg_op when 'INSERT' then 'expense_payment_added' when 'UPDATE' then
      case when old.status = 'posted' and new.status = 'reversed' then 'expense_payment_reversed' else 'expense_payment_updated' end
      else 'expense_payment_deleted' end,
    'expense_payments', coalesce(new.id, old.id),
    jsonb_build_object('before', case when tg_op <> 'INSERT' then to_jsonb(old) end,
      'after', case when tg_op <> 'DELETE' then to_jsonb(new) end)
  );
  return coalesce(new, old);
end;
$function$


-- FN public.log_finishing_status_change
CREATE OR REPLACE FUNCTION public.log_finishing_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.status is distinct from new.status then
    insert into public.finishing_status_history(
      company_id, finishing_job_id, from_status, to_status, changed_by, remarks
    ) values (
      new.company_id, new.id, old.status, new.status, auth.uid(), new.remarks
    );
  end if;
  return new;
end;
$function$


-- FN public.log_production_efficiency_change
CREATE OR REPLACE FUNCTION public.log_production_efficiency_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_manager uuid;
begin
  if tg_op = 'INSERT' and new.extrusion_efficiency_percent <> 80 then
    insert into public.production_efficiency_change_logs(company_id, production_job_id, old_efficiency_percent, new_efficiency_percent, changed_by)
    values (new.company_id, new.id, 80, new.extrusion_efficiency_percent, auth.uid());
  elsif tg_op = 'UPDATE' and old.extrusion_efficiency_percent is distinct from new.extrusion_efficiency_percent then
    insert into public.production_efficiency_change_logs(company_id, production_job_id, old_efficiency_percent, new_efficiency_percent, changed_by)
    values (new.company_id, new.id, old.extrusion_efficiency_percent, new.extrusion_efficiency_percent, auth.uid());
  end if;

  if (tg_op = 'INSERT' and new.extrusion_efficiency_percent <> 80) or (tg_op = 'UPDATE' and old.extrusion_efficiency_percent is distinct from new.extrusion_efficiency_percent) then
    select id into v_manager from public.app_users where company_id = new.company_id and role in ('owner','admin','production_manager') and is_active = true order by case role when 'production_manager' then 0 when 'owner' then 1 else 2 end limit 1;
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by)
    values (new.company_id, v_manager, 'production_efficiency_changed', 'warning', 'Production efficiency changed', concat('Job ', coalesce(new.job_number, new.id::text), ' uses ', new.extrusion_efficiency_percent::text, '% extrusion efficiency.'), 'production_job', new.id, auth.uid());
  end if;
  return new;
end;
$function$


-- FN public.log_sensitive_delete_action
CREATE OR REPLACE FUNCTION public.log_sensitive_delete_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
  actor_company_id uuid := public.get_current_user_company_id();
  row_company_id uuid;
  row_id text;
begin
  if tg_op = 'DELETE' then
    row_company_id := (to_jsonb(old)->>'company_id')::uuid;
    row_id := to_jsonb(old)->>'id';
  else
    if (to_jsonb(old)->>'deleted_at') is not null or (to_jsonb(new)->>'deleted_at') is null then
      return new;
    end if;
    row_company_id := (to_jsonb(new)->>'company_id')::uuid;
    row_id := to_jsonb(new)->>'id';
  end if;

  if actor_id is null or actor_company_id is null or row_company_id is distinct from actor_company_id then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  insert into public.sensitive_action_logs (
    company_id, user_id, action_type, entity_type, entity_id, description
  ) values (
    row_company_id, actor_id, tg_argv[0], tg_table_name, row_id,
    case when tg_op = 'DELETE' then 'Record permanently deleted' else 'Record soft-deleted' end
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$


-- FN public.log_user_access_change
CREATE OR REPLACE FUNCTION public.log_user_access_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null
    or new.company_id is null
    or new.company_id is distinct from public.get_current_user_company_id()
  then
    return new;
  end if;

  if old.role is distinct from new.role then
    insert into public.sensitive_action_logs (
      company_id, user_id, action_type, entity_type, entity_id, description
    ) values (
      new.company_id, actor_id, 'change_user_role', 'app_users', new.id::text,
      format('User role changed from %s to %s', old.role, new.role)
    );
  end if;

  if old.is_active and not new.is_active then
    insert into public.sensitive_action_logs (
      company_id, user_id, action_type, entity_type, entity_id, description
    ) values (
      new.company_id, actor_id, 'disable_user', 'app_users', new.id::text,
      'User access disabled'
    );
  end if;

  return new;
end;
$function$


-- FN public.maintain_production_completed_at
CREATE OR REPLACE FUNCTION public.maintain_production_completed_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from new.status then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$function$


-- FN public.mark_notification_read
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid := private.get_current_user_company_id();
  v_recipient_user_id uuid;
  v_read_at timestamptz := now();
begin
  if v_user_id is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select notification.recipient_user_id
  into v_recipient_user_id
  from public.notifications notification
  where notification.id = p_notification_id
    and private.notification_visible_to_current_user(
      notification.company_id,
      notification.recipient_user_id,
      notification.recipient_role,
      notification.dealer_id
    )
  for update;

  if not found then
    raise exception 'Notification not found for this user' using errcode = '42501';
  end if;

  if v_recipient_user_id is null then
    insert into public.notification_read_receipts(notification_id, user_id, company_id, read_at)
    values (p_notification_id, v_user_id, v_company_id, v_read_at)
    on conflict (notification_id, user_id)
    do update set read_at = excluded.read_at, company_id = excluded.company_id;
  else
    update public.notifications notification
    set is_read = true,
        read_at = coalesce(notification.read_at, v_read_at)
    where notification.id = p_notification_id
      and notification.company_id = v_company_id
      and notification.recipient_user_id = v_user_id;
  end if;

  return v_read_at;
end;
$function$


-- FN public.notify_billet_allocation
CREATE OR REPLACE FUNCTION public.notify_billet_allocation(p_company_id uuid, p_title text, p_body text, p_severity text, p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user record;
begin
  for v_user in
    select id from public.app_users
    where company_id = p_company_id
      and is_active = true
      and role in ('owner','admin','production_manager','production')
  loop
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by)
    values (p_company_id, v_user.id, 'billet_allocation', p_severity, p_title, p_body, 'order', p_order_id, auth.uid());
  end loop;
end;
$function$


-- FN public.onboard_company_atomic
CREATE OR REPLACE FUNCTION public.onboard_company_atomic(p_company jsonb, p_profile jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select private.onboard_company_atomic(p_company, p_profile)
$function$


-- FN public.prevent_audit_log_mutation
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'Audit logs are append-only';
end;
$function$


-- FN public.prevent_direct_edit_approved_expense
CREATE OR REPLACE FUNCTION public.prevent_direct_edit_approved_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' and old.approval_status = 'approved' then
    if new.source_module is distinct from old.source_module
      or new.source_submodule is distinct from old.source_submodule
      or new.source_table is distinct from old.source_table
      or new.source_record_id is distinct from old.source_record_id
      or new.expense_category is distinct from old.expense_category
      or new.expense_subcategory is distinct from old.expense_subcategory
      or new.vendor_id is distinct from old.vendor_id
      or new.vendor_name_snapshot is distinct from old.vendor_name_snapshot
      or new.description is distinct from old.description
      or new.quantity is distinct from old.quantity
      or new.unit is distinct from old.unit
      or new.rate is distinct from old.rate
      or new.base_amount is distinct from old.base_amount
      or new.tax_amount is distinct from old.tax_amount
      or new.freight_amount is distinct from old.freight_amount
      or new.discount_amount is distinct from old.discount_amount
      or new.total_amount is distinct from old.total_amount
      or new.currency is distinct from old.currency
      or new.invoice_number is distinct from old.invoice_number
      or new.invoice_date is distinct from old.invoice_date
      or new.due_date is distinct from old.due_date
      or new.cost_center is distinct from old.cost_center
      or new.department is distinct from old.department
      or new.machine_id is distinct from old.machine_id
      or new.inventory_item_id is distinct from old.inventory_item_id
      or new.maintenance_record_id is distinct from old.maintenance_record_id
    then
      raise exception 'Expense % is approved and locked. An owner or admin must reopen it with a reason before its amounts or details change.', old.expense_number
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$


-- FN private.reallocate_billet_to_order
CREATE OR REPLACE FUNCTION private.reallocate_billet_to_order(p_billet_id uuid, p_order_id uuid)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select private.assign_billet_to_order(p_billet_id,p_order_id,true);
$function$


-- FN private.rebuild_direct_order_billet_requirements
CREATE OR REPLACE FUNCTION private.rebuild_direct_order_billet_requirements(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order public.orders%rowtype;
  v_group record;
  v_billet_weight numeric;
  v_count integer;
begin
  select * into v_order from public.orders where id=p_order_id;
  if not found then return; end if;
  delete from public.order_billet_requirements requirement
    where requirement.company_id=v_order.company_id and requirement.order_id=v_order.id
      and not exists(select 1 from public.foundry_billets billet where billet.company_id=requirement.company_id
        and billet.allocation_requirement_id=requirement.id and billet.status in ('allocated','issued','consumed'));
  if v_order.current_stage in ('closed','cancelled') then
    update public.order_billet_requirements set status='cancelled' where company_id=v_order.company_id and order_id=v_order.id;
    update public.orders set billets_required=0,billets_allocated=0,billets_short=0,billet_allocation_status='not_required'
      where id=v_order.id and company_id=v_order.company_id;
    return;
  end if;
  for v_group in
    select material.profile_id,material.alloy,material.temper,material.billet_diameter_inch diameter,round(sum(material.weight_kg),3) weight
    from private.direct_order_requests request
    cross join lateral jsonb_to_recordset(request.material_snapshot)
      material(profile_id uuid,alloy text,temper text,billet_diameter_inch numeric,weight_kg numeric)
    where request.company_id=v_order.company_id and request.order_id=v_order.id
    group by material.profile_id,material.alloy,material.temper,material.billet_diameter_inch
  loop
    if v_group.weight<=0 or v_group.alloy is null or v_group.temper is null or coalesce(v_group.diameter,0)<=0 then
      raise exception 'Direct order material requirements are incomplete';
    end if;
    v_billet_weight:=round((pi()*power(((v_group.diameter*25.4)/2000),2)*(5800/1000.0)*2700)::numeric,3);
    v_count:=greatest(1,ceil((v_group.weight/0.75)/v_billet_weight)::integer);
    insert into public.order_billet_requirements(company_id,order_id,profile_id,alloy,temper,billet_diameter_inch,billet_length_mm,
      required_weight_kg,billet_weight_kg,billets_required,extrusion_efficiency_percent)
      values(v_order.company_id,v_order.id,v_group.profile_id,v_group.alloy,v_group.temper,v_group.diameter,5800,v_group.weight,v_billet_weight,v_count,75)
      on conflict(company_id,order_id,profile_id,alloy,temper,billet_diameter_inch) do update set
        required_weight_kg=excluded.required_weight_kg,billet_weight_kg=excluded.billet_weight_kg,billets_required=excluded.billets_required,
        extrusion_efficiency_percent=75,status=case when public.order_billet_requirements.status='cancelled' then 'pending' else public.order_billet_requirements.status end,updated_at=now();
  end loop;
  with surplus as (
    select billet.id,row_number() over(partition by billet.allocation_requirement_id order by billet.allocated_at desc nulls last,billet.created_at desc) allocation_rank,
      requirement.billets_required
    from public.foundry_billets billet join public.order_billet_requirements requirement
      on requirement.id=billet.allocation_requirement_id and requirement.company_id=billet.company_id
    where requirement.company_id=v_order.company_id and requirement.order_id=v_order.id and billet.status='allocated'
  ) update public.foundry_billets billet set order_id=null,allocation_requirement_id=null,status='cast',allocated_at=null,allocated_by=null,updated_at=now()
    from surplus where billet.id=surplus.id and surplus.allocation_rank>surplus.billets_required;
  perform public.refresh_order_billet_allocations(v_order.id);
end;
$function$


-- FN private.recalculate_invoice_collection_state
CREATE OR REPLACE FUNCTION private.recalculate_invoice_collection_state(p_invoice_id uuid, p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_invoice public.invoices%rowtype;
  v_effective_paid numeric(14,2);
  v_last_payment_date date;
  v_next_status text;
  v_open numeric(14,2);
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Invoice not found for this company'; end if;

  select round(coalesce(sum(
    case
      when payment_status = 'PAID' and payment_type = 'REFUND' then -amount
      when payment_status = 'PAID' then amount
      else 0
    end
  ), 0), 2),
  max(payment_date) filter (where payment_status = 'PAID' and coalesce(payment_type, '') <> 'REFUND')
  into v_effective_paid, v_last_payment_date
  from public.payments
  where invoice_id = p_invoice_id and company_id = p_company_id;

  v_effective_paid := coalesce(v_effective_paid, 0);
  if v_effective_paid < 0 then
    raise exception 'Customer refunds would exceed posted receipts. Reverse the refund before reversing this receipt.'
      using errcode = '23514';
  end if;
  if v_effective_paid > v_invoice.grand_total then
    raise exception 'Effective receipts exceed the invoice total';
  end if;
  v_open := greatest(v_invoice.grand_total - v_effective_paid - v_invoice.credited_amount, 0);

  -- A balance past its due date stays overdue after a partial receipt; paid and partial
  -- amounts remain separately visible in amount_paid and balance_due.
  v_next_status := case
    when v_invoice.status = 'cancelled' then 'cancelled'
    when v_invoice.credited_amount >= v_invoice.grand_total and v_invoice.grand_total > 0 then 'credited'
    when v_invoice.grand_total > 0 and v_effective_paid + v_invoice.credited_amount >= v_invoice.grand_total then 'paid'
    when v_invoice.status = 'draft' then 'draft'
    when v_open > 0 and v_invoice.due_date is not null and v_invoice.due_date < private.business_today()
      and (v_invoice.status <> 'generated' or v_effective_paid > 0 or v_invoice.credited_amount > 0) then 'overdue'
    when v_effective_paid > 0 or v_invoice.credited_amount > 0 then 'partially_paid'
    when v_invoice.status = 'generated' then 'generated'
    else 'sent'
  end;

  update public.invoices
  set amount_paid = v_effective_paid,
      status = v_next_status,
      paid_date = case when v_next_status = 'paid' then v_last_payment_date else null end,
      updated_at = now()
  where id = p_invoice_id and company_id = p_company_id;
end;
$function$


-- FN private.recalculate_invoice_totals
CREATE OR REPLACE FUNCTION private.recalculate_invoice_totals(p_invoice_id uuid, p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_subtotal numeric(14,2); v_tax_total numeric(14,2);
begin
  perform 1 from public.invoices where id = p_invoice_id and company_id = p_company_id for update;
  if not found then raise exception 'Invoice not found for this company'; end if;
  select round(coalesce(sum(line_total), 0), 2), coalesce(sum(round(line_total * gst_percent / 100, 2)), 0)
  into v_subtotal, v_tax_total from public.invoice_items where invoice_id = p_invoice_id and company_id = p_company_id;
  if v_subtotal <= 0 then raise exception 'The selected source has no billable quantity and rate'; end if;
  update public.invoices set subtotal = v_subtotal, tax_total = v_tax_total,
    grand_total = v_subtotal + v_tax_total, updated_at = now()
  where id = p_invoice_id and company_id = p_company_id;
end;
$function$


-- FN private.record_customer_refund_atomic
CREATE OR REPLACE FUNCTION private.record_customer_refund_atomic(p_invoice_id uuid, p_refund jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_invoice public.invoices%rowtype;
  v_existing public.payments%rowtype;
  v_refund_id uuid;
  v_amount numeric(14,2);
  v_date date;
  v_today date := private.business_today();
  v_method text := nullif(btrim(p_refund ->> 'payment_method'), '');
  v_reference text := nullif(btrim(p_refund ->> 'reference_number'), '');
  v_notes text := nullif(btrim(p_refund ->> 'notes'), '');
  v_credit_note_id uuid;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for customer refunds' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Refund idempotency key is required'; end if;
  begin
    v_amount := round(nullif(p_refund ->> 'amount', '')::numeric, 2);
    v_date := coalesce(nullif(p_refund ->> 'refund_date', '')::date, v_today);
    v_credit_note_id := nullif(p_refund ->> 'credit_note_id', '')::uuid;
  exception when others then
    raise exception 'Enter a valid refund amount and date' using errcode = '22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':invoice-payment:' || p_idempotency_key::text, 0));
  select * into v_existing from public.payments where company_id = v_company_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.invoice_id <> p_invoice_id or coalesce(v_existing.payment_type, '') <> 'REFUND'
      or v_existing.amount is distinct from v_amount or v_existing.payment_date is distinct from v_date
      or v_existing.payment_method is distinct from v_method
      or nullif(trim(coalesce(v_existing.reference_number, '')), '') is distinct from v_reference
      or nullif(trim(coalesce(v_existing.notes, '')), '') is distinct from v_notes
      or v_existing.related_credit_note_id is distinct from v_credit_note_id then
      raise exception 'This retry key was already used for different refund details. Refresh the invoice before posting again.';
    end if;
    select * into v_invoice from public.invoices where id = p_invoice_id and company_id = v_company_id;
    return jsonb_build_object('payment_id', v_existing.id, 'invoice_id', p_invoice_id, 'amount_paid', v_invoice.amount_paid,
      'customer_credit_due', v_invoice.customer_credit_due, 'invoice_status', v_invoice.status, 'idempotent_replay', true);
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id and company_id = v_company_id for update;
  if not found then raise exception 'Invoice not found for this company'; end if;
  perform private.recalculate_invoice_collection_state(p_invoice_id, v_company_id);
  select * into v_invoice from public.invoices where id = p_invoice_id and company_id = v_company_id for update;

  if v_invoice.status in ('draft', 'cancelled') then raise exception 'Refunds can only be recorded against an issued invoice'; end if;
  if v_amount is null or v_amount = 'NaN'::numeric or v_amount <= 0 then raise exception 'Refund amount must be greater than zero'; end if;
  if v_amount > v_invoice.customer_credit_due then
    raise exception 'Refund exceeds the customer credit due of %', v_invoice.customer_credit_due;
  end if;
  if v_amount > v_invoice.amount_paid then
    raise exception 'Refund exceeds the cash received on this invoice';
  end if;
  if v_date > v_today then raise exception 'Refund date cannot be in the future'; end if;
  if v_method is null or v_method not in ('bank_transfer', 'upi', 'cheque', 'cash', 'other') then
    raise exception 'Select how the refund was paid';
  end if;
  if v_method in ('bank_transfer', 'upi', 'cheque') and v_reference is null then
    raise exception 'Reference number is required for bank, UPI and cheque refunds';
  end if;
  if length(coalesce(v_notes, '')) < 5 then raise exception 'Enter a clear refund reason'; end if;
  if v_credit_note_id is not null and not exists (
    select 1 from public.credit_notes
    where id = v_credit_note_id and company_id = v_company_id and invoice_id = p_invoice_id and status = 'issued'
  ) then
    raise exception 'The linked credit note is not an issued credit note for this invoice';
  end if;

  insert into public.payments(company_id, invoice_id, order_id, branch_id, payment_date, amount, payment_method, payment_type,
    payment_status, reference_number, notes, recorded_by_user_id, idempotency_key, related_credit_note_id, created_at, updated_at)
  values (v_company_id, p_invoice_id, v_invoice.order_id, v_invoice.branch_id, v_date, v_amount, v_method, 'REFUND',
    'PAID', v_reference, v_notes, auth.uid(), p_idempotency_key, v_credit_note_id, now(), now())
  returning id into v_refund_id;

  perform private.recalculate_invoice_collection_state(p_invoice_id, v_company_id);
  select * into v_invoice from public.invoices where id = p_invoice_id and company_id = v_company_id;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (v_company_id, auth.uid(), 'customer_refund_recorded', 'payment', v_refund_id,
    jsonb_build_object('invoice_id', p_invoice_id, 'customer_id', v_invoice.customer_id, 'amount', v_amount,
      'payment_method', v_method, 'reference_number', v_reference, 'credit_note_id', v_credit_note_id, 'reason', v_notes));

  return jsonb_build_object('payment_id', v_refund_id, 'invoice_id', p_invoice_id, 'amount_paid', v_invoice.amount_paid,
    'customer_credit_due', v_invoice.customer_credit_due, 'invoice_status', v_invoice.status, 'idempotent_replay', false);
end;
$function$


-- FN private.record_expense_payment_atomic
CREATE OR REPLACE FUNCTION private.record_expense_payment_atomic(p_expense_id uuid, p_payment jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_expense public.expense_ledger%rowtype;
  v_existing public.expense_payments%rowtype;
  v_payment_id uuid;
  v_amount numeric(14,2);
  v_date date;
  v_method text := nullif(btrim(p_payment ->> 'payment_method'), '');
  v_bank text := nullif(btrim(p_payment ->> 'bank_account'), '');
  v_reference text := nullif(btrim(p_payment ->> 'reference_number'), '');
  v_notes text := nullif(btrim(p_payment ->> 'notes'), '');
  v_hash text;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for supplier payments' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Payment idempotency key is required'; end if;
  begin
    v_amount := round(nullif(p_payment ->> 'amount_paid', '')::numeric, 2);
    v_date := coalesce(nullif(p_payment ->> 'payment_date', '')::date, private.business_today());
  exception when others then
    raise exception 'Enter a valid payment amount and date' using errcode = '22023';
  end;
  v_hash := md5(jsonb_build_object('expense_id', p_expense_id, 'amount', v_amount, 'date', v_date, 'method', v_method,
    'bank', v_bank, 'reference', v_reference, 'notes', v_notes)::text);

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':expense-payment:' || p_idempotency_key::text, 0));
  select * into v_existing from public.expense_payments
  where company_id = v_company_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception 'This retry key was already used for a different supplier payment. Refresh the expense and review its payments before posting again.';
    end if;
    select * into v_expense from public.expense_ledger where id = v_existing.expense_ledger_id and company_id = v_company_id;
    return jsonb_build_object('payment_id', v_existing.id, 'expense_id', v_existing.expense_ledger_id,
      'amount_paid', v_expense.amount_paid, 'balance_amount', v_expense.balance_amount,
      'payment_status', v_expense.payment_status, 'idempotent_replay', true);
  end if;

  -- Lock the parent before reading its balance so concurrent postings serialize.
  select * into v_expense from public.expense_ledger
  where id = p_expense_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Expense not found for this company'; end if;
  if v_expense.deleted_at is not null or v_expense.approval_status in ('cancelled', 'reversed') then
    raise exception 'Cancelled or deleted expenses cannot be paid';
  end if;
  if v_expense.approval_status <> 'approved' then
    raise exception 'Expense % is %. Only approved expenses can be paid.', v_expense.expense_number, v_expense.approval_status;
  end if;
  if v_amount is null or v_amount = 'NaN'::numeric or v_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if v_amount > v_expense.balance_amount then
    raise exception 'Payment amount exceeds the outstanding expense balance of %', v_expense.balance_amount;
  end if;
  if v_date > private.business_today() then raise exception 'Payment date cannot be in the future'; end if;
  if v_method is null or v_method not in ('bank_transfer', 'upi', 'cheque', 'cash', 'other') then
    raise exception 'Select a valid payment method';
  end if;
  if v_method in ('bank_transfer', 'upi', 'cheque') and v_reference is null then
    raise exception 'Reference number is required for bank, UPI and cheque payments';
  end if;
  if v_reference is not null and exists (
    select 1 from public.expense_payments
    where company_id = v_company_id and expense_ledger_id = v_expense.id and status = 'posted'
      and upper(btrim(reference_number)) = upper(v_reference)
  ) then
    raise exception 'Reference % is already posted against this expense', v_reference using errcode = '23505';
  end if;

  insert into public.expense_payments(company_id, expense_ledger_id, payment_date, amount_paid, payment_method,
    bank_account, reference_number, notes, created_by, status, idempotency_key, request_hash)
  values (v_company_id, v_expense.id, v_date, v_amount, v_method, v_bank, v_reference, v_notes, auth.uid(),
    'posted', p_idempotency_key, v_hash)
  returning id into v_payment_id;

  select * into v_expense from public.expense_ledger where id = v_expense.id and company_id = v_company_id;
  return jsonb_build_object('payment_id', v_payment_id, 'expense_id', v_expense.id,
    'amount_paid', v_expense.amount_paid, 'balance_amount', v_expense.balance_amount,
    'payment_status', v_expense.payment_status, 'idempotent_replay', false);
end;
$function$


-- FN private.record_expense_supplier_credit_atomic
CREATE OR REPLACE FUNCTION private.record_expense_supplier_credit_atomic(p_expense_id uuid, p_credit jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_expense public.expense_ledger%rowtype;
  v_existing public.expense_supplier_credits%rowtype;
  v_type text := nullif(btrim(p_credit ->> 'credit_type'), '');
  v_amount numeric(14,2);
  v_date date;
  v_method text := nullif(btrim(p_credit ->> 'payment_method'), '');
  v_reference text := nullif(btrim(p_credit ->> 'reference_number'), '');
  v_reason text := nullif(btrim(p_credit ->> 'reason'), '');
  v_hash text;
  v_credit_id uuid;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for supplier credits' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Supplier credit idempotency key is required'; end if;
  if v_type is null or v_type not in ('credit_note', 'refund') then raise exception 'Select a supplier credit note or refund'; end if;
  begin
    v_amount := round(nullif(p_credit ->> 'amount', '')::numeric, 2);
    v_date := coalesce(nullif(p_credit ->> 'credit_date', '')::date, private.business_today());
  exception when others then
    raise exception 'Enter a valid amount and date' using errcode = '22023';
  end;
  v_hash := md5(jsonb_build_object('expense_id', p_expense_id, 'type', v_type, 'amount', v_amount, 'date', v_date,
    'method', v_method, 'reference', v_reference, 'reason', v_reason)::text);

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':expense-supplier-credit:' || p_idempotency_key::text, 0));
  select * into v_existing from public.expense_supplier_credits
  where company_id = v_company_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception 'This retry key was already used for a different supplier credit. Refresh the expense before posting again.';
    end if;
    select * into v_expense from public.expense_ledger where id = v_existing.expense_ledger_id and company_id = v_company_id;
    return jsonb_build_object('credit_id', v_existing.id, 'expense_id', v_expense.id, 'balance_amount', v_expense.balance_amount,
      'supplier_credit_due', v_expense.supplier_credit_due, 'payment_status', v_expense.payment_status, 'idempotent_replay', true);
  end if;

  select * into v_expense from public.expense_ledger where id = p_expense_id and company_id = v_company_id for update;
  if not found then raise exception 'Expense not found for this company'; end if;
  if v_expense.deleted_at is not null or v_expense.approval_status <> 'approved' then
    raise exception 'Supplier credits and refunds can only be posted to an approved expense';
  end if;
  if v_amount is null or v_amount = 'NaN'::numeric or v_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if v_date > private.business_today() then raise exception 'Credit or refund date cannot be in the future'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'Enter a clear supplier credit or refund reason'; end if;
  if v_type = 'credit_note' then
    if v_reference is null then raise exception 'Enter the supplier credit note number'; end if;
    if v_amount > v_expense.total_amount - v_expense.credited_amount then
      raise exception 'Credit note exceeds the uncredited expense amount of %', v_expense.total_amount - v_expense.credited_amount;
    end if;
    if exists (select 1 from public.expense_supplier_credits where company_id = v_company_id and expense_ledger_id = v_expense.id
      and status = 'posted' and credit_type = 'credit_note' and upper(btrim(reference_number)) = upper(v_reference)) then
      raise exception 'Supplier credit note % is already posted against this expense', v_reference using errcode = '23505';
    end if;
  else
    if v_method is null or v_method not in ('bank_transfer', 'upi', 'cheque', 'cash', 'other') then
      raise exception 'Select how the supplier refund was received';
    end if;
    if v_method in ('bank_transfer', 'upi', 'cheque') and v_reference is null then
      raise exception 'Reference number is required for bank, UPI and cheque refunds';
    end if;
    if v_amount > v_expense.supplier_credit_due then
      raise exception 'Refund exceeds the supplier credit due of %', v_expense.supplier_credit_due;
    end if;
  end if;

  insert into public.expense_supplier_credits(company_id, expense_ledger_id, credit_type, credit_date, amount,
    payment_method, reference_number, reason, idempotency_key, request_hash, created_by)
  values (v_company_id, v_expense.id, v_type, v_date, v_amount, case when v_type = 'refund' then v_method end,
    v_reference, v_reason, p_idempotency_key, v_hash, auth.uid())
  returning id into v_credit_id;

  select * into v_expense from public.expense_ledger where id = v_expense.id and company_id = v_company_id;
  return jsonb_build_object('credit_id', v_credit_id, 'expense_id', v_expense.id, 'balance_amount', v_expense.balance_amount,
    'supplier_credit_due', v_expense.supplier_credit_due, 'payment_status', v_expense.payment_status, 'idempotent_replay', false);
end;
$function$


-- FN private.record_payment_atomic
CREATE OR REPLACE FUNCTION private.record_payment_atomic(p_invoice_id uuid, p_payment jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_invoice public.invoices%rowtype;
  v_payment_id uuid;
  v_existing public.payments%rowtype;
  v_idempotency_key uuid;
  v_amount numeric(14,2);
  v_payment_date date;
  v_today date := private.business_today();
  v_payment_method text := nullif(p_payment ->> 'payment_method', '');
  v_reference_number text := nullif(trim(p_payment ->> 'reference_number'), '');
  v_notes text := nullif(trim(p_payment ->> 'notes'), '');
  v_payment_type text;
  v_dealership_id uuid;
  v_result public.invoices%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for payments' using errcode = '42501';
  end if;
  begin
    v_idempotency_key := nullif(p_payment ->> 'idempotency_key', '')::uuid;
    v_amount := round(coalesce(nullif(p_payment ->> 'amount', '')::numeric, 0), 2);
    v_payment_date := coalesce(nullif(p_payment ->> 'payment_date', '')::date, v_today);
  exception when others then
    raise exception 'Enter a valid receipt amount, date and retry key' using errcode = '22023';
  end;
  if v_idempotency_key is null then
    raise exception 'Payment idempotency key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_company_id::text || ':invoice-payment:' || v_idempotency_key::text,
    0
  ));

  select * into v_existing
  from public.payments
  where company_id = v_company_id
    and idempotency_key = v_idempotency_key;

  if found then
    if v_existing.invoice_id <> p_invoice_id then
      raise exception 'The idempotency key is already assigned to another invoice';
    end if;
    -- A retry is a replay only when every submitted detail matches the committed receipt.
    if v_existing.amount is distinct from v_amount
      or v_existing.payment_date is distinct from v_payment_date
      or v_existing.payment_method is distinct from v_payment_method
      or nullif(trim(coalesce(v_existing.reference_number, '')), '') is distinct from v_reference_number
      or nullif(trim(coalesce(v_existing.notes, '')), '') is distinct from v_notes
      or coalesce(v_existing.payment_type, '') = 'REFUND' then
      raise exception 'This retry key was already used for a receipt with different details. Refresh the invoice and review receipt % before posting again.', v_existing.id;
    end if;
    select * into v_result
    from public.invoices
    where id = p_invoice_id and company_id = v_company_id;
    return jsonb_build_object(
      'payment_id', v_existing.id,
      'invoice_id', p_invoice_id,
      'amount_paid', v_result.amount_paid,
      'balance_due', v_result.balance_due,
      'invoice_status', v_result.status,
      'idempotent_replay', true
    );
  end if;

  select *
  into v_invoice
  from public.invoices
  where id = p_invoice_id
    and company_id = v_company_id
  for update;

  if not found then
    raise exception 'Invoice not found for this company';
  end if;
  if not exists (
    select 1 from public.customers
    where id = v_invoice.customer_id and company_id = v_company_id
  ) then
    raise exception 'Invoice customer not found for this company';
  end if;
  if v_invoice.order_id is not null then
    select dealer_id
    into v_dealership_id
    from public.orders
    where id = v_invoice.order_id
      and company_id = v_company_id
      and customer_id = v_invoice.customer_id;
    if not found then
      raise exception 'Invoice order and customer lineage is invalid';
    end if;
  end if;
  if v_invoice.dispatch_id is not null and not exists (
    select 1
    from public.dispatches
    where id = v_invoice.dispatch_id
      and company_id = v_company_id
      and order_id = v_invoice.order_id
  ) then
    raise exception 'Invoice dispatch lineage is invalid';
  end if;

  perform private.recalculate_invoice_collection_state(p_invoice_id, v_company_id);
  select *
  into v_invoice
  from public.invoices
  where id = p_invoice_id and company_id = v_company_id
  for update;

  if v_invoice.status not in ('generated', 'sent', 'partially_paid', 'overdue') then
    raise exception 'Payments can only be posted to an issued, unpaid invoice';
  end if;
  if v_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if v_amount > v_invoice.balance_due then
    raise exception 'Payment amount exceeds the outstanding invoice balance';
  end if;
  if v_payment_date > v_today then
    raise exception 'Payment date cannot be in the future';
  end if;
  if v_payment_method is null or v_payment_method not in ('bank_transfer', 'upi', 'cheque', 'cash', 'credit_note', 'other') then
    raise exception 'Select a valid payment method';
  end if;
  if v_payment_method in ('bank_transfer', 'upi', 'cheque') and v_reference_number is null then
    raise exception 'Reference number is required for bank, UPI, and cheque receipts';
  end if;

  v_payment_type := case
    when v_payment_method = 'credit_note' then 'ADJUSTMENT'
    when v_amount = v_invoice.balance_due then 'FINAL_PAYMENT'
    else 'PARTIAL_PAYMENT'
  end;

  insert into public.payments(
    company_id, invoice_id, order_id, branch_id, dealership_id, payment_date, amount, payment_method,
    payment_type, payment_status, reference_number, notes, recorded_by_user_id, idempotency_key, created_at, updated_at
  )
  values (
    v_company_id, p_invoice_id, v_invoice.order_id, v_invoice.branch_id, v_dealership_id, v_payment_date, v_amount,
    v_payment_method, v_payment_type, 'PAID', v_reference_number, v_notes, auth.uid(), v_idempotency_key, now(), now()
  )
  returning id into v_payment_id;

  perform private.recalculate_invoice_collection_state(p_invoice_id, v_company_id);
  select * into v_result
  from public.invoices
  where id = p_invoice_id and company_id = v_company_id;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (
    v_company_id, auth.uid(), 'payment_recorded', 'payment', v_payment_id,
    jsonb_build_object('invoice_id', p_invoice_id, 'order_id', v_invoice.order_id, 'customer_id', v_invoice.customer_id,
      'amount', v_amount, 'payment_method', v_payment_method, 'payment_date', v_payment_date,
      'reference_number', v_reference_number)
  );

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'invoice_id', p_invoice_id,
    'amount_paid', v_result.amount_paid,
    'balance_due', v_result.balance_due,
    'invoice_status', v_result.status,
    'idempotent_replay', false
  );
end;
$function$


-- FN private.refresh_direct_order_value
CREATE OR REPLACE FUNCTION private.refresh_direct_order_value()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if tg_op in ('UPDATE','DELETE') then
    update public.orders set order_value = 0 where id = old.order_id and company_id = old.company_id and quote_id is null;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    update public.orders set order_value = 0 where id = new.order_id and company_id = new.company_id and quote_id is null;
  end if;
  return null;
end;
$function$


-- FN private.refresh_quote_header_after_item_change
CREATE OR REPLACE FUNCTION private.refresh_quote_header_after_item_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.quotes
    set updated_at = now()
    where id = old.quote_id
      and company_id = old.company_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and (tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id) then
    update public.quotes
    set updated_at = now()
    where id = new.quote_id
      and company_id = new.company_id;
  end if;

  return null;
end;
$function$


-- FN private.release_factory_loads_atomic
CREATE OR REPLACE FUNCTION private.release_factory_loads_atomic(p_queue_ids uuid[], p_group_code text, p_override boolean, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_count integer;
  v_weight numeric(14,3);
  v_minimum numeric(14,3);
  v_compatibility_count integer;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager') then
    raise exception 'Permission denied for factory load release' using errcode = '42501';
  end if;
  if coalesce(array_length(p_queue_ids, 1), 0) = 0 then raise exception 'Select at least one queued order'; end if;

  perform 1 from public.factory_load_consolidations
  where company_id = v_company_id and id = any(p_queue_ids)
  order by id for update;

  select count(*), round(sum(manufacturing_weight_kg), 3), max(minimum_weight_kg), count(distinct compatibility_signature)
  into v_count, v_weight, v_minimum, v_compatibility_count
  from public.factory_load_consolidations
  where company_id = v_company_id and id = any(p_queue_ids) and status = 'pending';

  if v_count <> cardinality(p_queue_ids) then raise exception 'Every selected load must be pending in this company'; end if;
  if p_override then
    if length(trim(coalesce(p_reason, ''))) < 8 then raise exception 'Enter a clear manager override reason'; end if;
  elsif v_compatibility_count <> 1 then
    raise exception 'Selected orders have incompatible alloy, temper, or billet-diameter requirements';
  elsif v_weight < v_minimum then
    raise exception 'Combined load is % kg; at least % kg is required', v_weight, v_minimum;
  elsif nullif(trim(coalesce(p_group_code, '')), '') is null then
    raise exception 'Enter the combined load or furnace group reference';
  end if;

  update public.factory_load_consolidations
  set status = case when p_override then 'overridden' else 'consolidated' end,
      consolidation_group = case when p_override then null else nullif(trim(p_group_code), '') end,
      release_reason = case when p_override then trim(p_reason) else 'Released as combined factory load' end,
      released_by = auth.uid(), released_at = now(), updated_at = now()
  where company_id = v_company_id and id = any(p_queue_ids) and status = 'pending';
  get diagnostics v_count = row_count;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  select
    v_company_id,
    auth.uid(),
    case when p_override then 'factory_minimum_overridden' else 'factory_load_consolidated' end,
    'factory_load_consolidation',
    queue.id,
    jsonb_build_object(
      'order_id', queue.order_id,
      'manufacturing_weight_kg', queue.manufacturing_weight_kg,
      'combined_weight_kg', v_weight,
      'compatibility_signature', queue.compatibility_signature,
      'group_code', nullif(trim(p_group_code), ''),
      'reason', case when p_override then trim(p_reason) else 'Released as combined factory load' end
    )
  from public.factory_load_consolidations queue
  where queue.company_id = v_company_id and queue.id = any(p_queue_ids);
  return v_count;
end;
$function$


-- FN private.release_production_schedule_slot_atomic
CREATE OR REPLACE FUNCTION private.release_production_schedule_slot_atomic(p_slot_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_slot public.production_plan_slots%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'factory_manager', 'production_manager', 'production') then
    raise exception 'Permission denied to release production jobs' using errcode = '42501';
  end if;

  select * into v_slot
  from public.production_plan_slots
  where id = p_slot_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Production schedule slot not found for this company' using errcode = '23514';
  end if;
  if v_slot.status <> 'scheduled' then
    raise exception 'Only a scheduled press slot can be released' using errcode = '23514';
  end if;

  perform 1
  from public.production_jobs
  where id = v_slot.production_job_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Production job not found for this schedule slot' using errcode = '23514';
  end if;

  update public.production_plan_slots
  set status = 'released', locked_by = auth.uid(), locked_at = now(), updated_at = now()
  where id = v_slot.id and company_id = v_company_id;

  update public.production_jobs
  set status = 'ready',
      machine_id = v_slot.machine_id,
      planned_date = (v_slot.planned_start_at at time zone 'Asia/Kolkata')::date,
      shift = v_slot.shift,
      updated_at = now()
  where id = v_slot.production_job_id and company_id = v_company_id;

  return v_slot.production_job_id;
end;
$function$


-- FN private.replace_invoice_items_atomic
CREATE OR REPLACE FUNCTION private.replace_invoice_items_atomic(p_invoice_id uuid, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_invoice public.invoices%rowtype;
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('owner','admin','accounts') then raise exception 'Permission denied for invoices' using errcode='42501'; end if;
  select * into v_invoice from public.invoices where id=p_invoice_id and company_id=v_company;
  if not found then raise exception 'Invoice not found for this company'; end if;
  if v_invoice.status is null or v_invoice.status not in ('draft','generated') or coalesce(v_invoice.amount_paid,0)<>0 then raise exception 'Only unpaid draft or generated invoices can regenerate source lines'; end if;
  -- Use the same locked source eligibility, lineage, coverage and audit path.
  return private.save_invoice_atomic(p_invoice_id,to_jsonb(v_invoice),p_items,true);
end;
$function$


-- FN private.replace_profile_quality_plan_atomic
CREATE OR REPLACE FUNCTION private.replace_profile_quality_plan_atomic(p_profile_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_count integer;
begin
  if auth.uid() is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin') then
    raise exception 'Permission denied to change profile quality plans' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then
    raise exception 'Profile quality plan must be an array';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 100 then
    raise exception 'Profile quality plan requires between 1 and 100 parameters';
  end if;

  perform 1 from public.aluminium_profiles
  where id = p_profile_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Profile not found for this company'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(
      inspection_stage text,
      parameter_name text,
      acceptance_criteria text,
      rejection_criteria text,
      inspection_frequency text,
      is_mandatory boolean
    )
    where nullif(btrim(item.inspection_stage), '') is null
      or nullif(btrim(item.parameter_name), '') is null
      or char_length(item.inspection_stage) > 120
      or char_length(item.parameter_name) > 160
  ) then
    raise exception 'Every quality-plan row requires a valid stage and parameter';
  end if;

  update public.profile_quality_plans
  set is_active = false, updated_at = now()
  where company_id = v_company_id and profile_id = p_profile_id and is_active = true;

  insert into public.profile_quality_plans(
    company_id, profile_id, inspection_stage, parameter_name,
    acceptance_criteria, rejection_criteria, inspection_frequency,
    is_mandatory, is_active
  )
  select
    v_company_id,
    p_profile_id,
    btrim(item.inspection_stage),
    btrim(item.parameter_name),
    nullif(btrim(item.acceptance_criteria), ''),
    nullif(btrim(item.rejection_criteria), ''),
    nullif(btrim(item.inspection_frequency), ''),
    coalesce(item.is_mandatory, true),
    true
  from jsonb_to_recordset(p_items) as item(
    inspection_stage text,
    parameter_name text,
    acceptance_criteria text,
    rejection_criteria text,
    inspection_frequency text,
    is_mandatory boolean
  );
end;
$function$


-- FN private.replace_profile_routing_atomic
CREATE OR REPLACE FUNCTION private.replace_profile_routing_atomic(p_profile_id uuid, p_steps jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_count integer;
begin
  if auth.uid() is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin') then
    raise exception 'Permission denied to change profile routing' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_steps, 'null'::jsonb)) <> 'array' then
    raise exception 'Profile routing must be an array';
  end if;
  v_count := jsonb_array_length(p_steps);
  if v_count < 1 or v_count > 50 then
    raise exception 'Profile routing requires between 1 and 50 steps';
  end if;

  perform 1 from public.aluminium_profiles
  where id = p_profile_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Profile not found for this company'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_steps) as step(
      stage_name text,
      is_required boolean,
      department text,
      estimated_duration_hours numeric,
      notes text
    )
    where nullif(btrim(step.stage_name), '') is null
      or char_length(step.stage_name) > 120
      or coalesce(step.estimated_duration_hours, 0) < 0
  ) then
    raise exception 'Every routing step requires a valid stage and duration';
  end if;

  delete from public.profile_routing_steps
  where company_id = v_company_id and profile_id = p_profile_id;

  insert into public.profile_routing_steps(
    company_id, profile_id, step_order, stage_name, is_required,
    department, estimated_duration_hours, notes
  )
  select
    v_company_id,
    p_profile_id,
    step.ordinality::integer,
    btrim(step.stage_name),
    coalesce(step.is_required, true),
    nullif(btrim(step.department), ''),
    step.estimated_duration_hours,
    nullif(btrim(step.notes), '')
  from jsonb_to_recordset(p_steps) with ordinality as step(
    stage_name text,
    is_required boolean,
    department text,
    estimated_duration_hours numeric,
    notes text,
    ordinality bigint
  );
end;
$function$


-- FN private.require_complete_quote_costing
CREATE OR REPLACE FUNCTION private.require_complete_quote_costing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if new.status in ('approved_for_sending','sent','customer_approved','converted_to_order') and exists (
    select 1 from public.quote_items where company_id = new.company_id and quote_id = new.id
      and finishing_charge_type = 'per_sqft' and (not costing_complete or coalesce(surface_area_sqft, 0) <= 0)
  ) then
    raise exception 'Per sqft finishing requires a profile perimeter and a recalculated quote before approval or sending';
  end if;
  return new;
end;
$function$


-- FN private.retire_source_expense
CREATE OR REPLACE FUNCTION private.retire_source_expense(p_company_id uuid, p_expense_id uuid, p_delete boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_expense public.expense_ledger%rowtype;
begin
  if p_expense_id is null then return; end if;
  select * into v_expense from public.expense_ledger where id = p_expense_id and company_id = p_company_id for update;
  if not found then return; end if;
  -- Paid history is never silently removed from spend: cash must be reversed or refunded first.
  if v_expense.amount_paid - v_expense.refunded_amount > 0 then
    raise exception 'Expense % has posted supplier payments. Reverse them or record the supplier refund in Expenses before this source cost is %.',
      v_expense.expense_number, p_reason using errcode = '23514';
  end if;
  if v_expense.approval_status <> 'cancelled' then
    perform private.set_expense_approval_state(v_expense.id, p_company_id, 'cancelled', 'Source ' || p_reason, false);
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (p_company_id, auth.uid(), 'expense_source_retired', 'expense_ledger', v_expense.id,
      jsonb_build_object('expense_number', v_expense.expense_number, 'from', v_expense.approval_status,
        'reason', p_reason, 'source_table', v_expense.source_table, 'source_record_id', v_expense.source_record_id,
        'total_amount', v_expense.total_amount));
  end if;
  if p_delete and v_expense.deleted_at is null then
    update public.expense_ledger set deleted_at = now(), updated_by = auth.uid()
    where id = v_expense.id and company_id = p_company_id;
  end if;
end;
$function$


-- FN private.retry_rejected_finishing_job_atomic
CREATE OR REPLACE FUNCTION private.retry_rejected_finishing_job_atomic(p_rejected_job_id uuid, p_planned_date date, p_remarks text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_source public.finishing_jobs%rowtype;
  v_retry_id uuid;
  v_recoverable_weight_kg numeric;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in (
    'owner', 'admin', 'factory_manager', 'production_manager', 'production'
  ) then
    raise exception 'Permission denied for finishing retry' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('finishing-retry:' || p_rejected_job_id::text, 0)
  );
  select * into v_source
  from public.finishing_jobs
  where id = p_rejected_job_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Rejected finishing job not found for this company';
  end if;
  if v_source.status <> 'rejected' then
    raise exception 'Only a rejected finishing job can create a retry'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.finishing_jobs retry
    where retry.company_id = v_company_id
      and retry.retry_of_finishing_job_id = v_source.id
  ) then
    raise exception 'A retry already exists for this rejected finishing job'
      using errcode = '23505';
  end if;

  v_recoverable_weight_kg := least(
    coalesce(v_source.rejection_weight_kg, 0),
    greatest(
      coalesce(v_source.input_weight_kg, 0) - coalesce(v_source.output_weight_kg, 0),
      0
    )
  );
  if v_recoverable_weight_kg <= 0 then
    raise exception 'Rejected finishing job has no recoverable input weight'
      using errcode = '23514';
  end if;

  insert into public.finishing_jobs(
    company_id, order_id, production_job_id, finishing_type,
    color_code, shade_name, planned_date, input_weight_kg,
    output_weight_kg, rejection_weight_kg, status, remarks,
    retry_of_finishing_job_id
  ) values (
    v_company_id, v_source.order_id, v_source.production_job_id, v_source.finishing_type,
    v_source.color_code, v_source.shade_name, coalesce(p_planned_date, current_date),
    v_recoverable_weight_kg, 0, 0, 'planned',
    concat(
      'Retry of rejected finishing job ', v_source.id::text, '.',
      case
        when nullif(btrim(coalesce(p_remarks, '')), '') is null then ''
        else concat(' ', btrim(p_remarks))
      end
    ),
    v_source.id
  )
  returning id into v_retry_id;

  insert into public.finishing_status_history(
    company_id, finishing_job_id, from_status, to_status, changed_by, remarks
  ) values (
    v_company_id, v_retry_id, 'rejected', 'planned', auth.uid(),
    concat('Retry created from rejected finishing job ', v_source.id::text, '.')
  );

  return v_retry_id;
end;
$function$


-- FN private.reverse_credit_note_atomic
CREATE OR REPLACE FUNCTION private.reverse_credit_note_atomic(p_credit_note_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_note public.credit_notes%rowtype;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','accounts') then
    raise exception 'Permission denied for credit note reversal' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then raise exception 'Enter a clear credit note reversal reason'; end if;

  select * into v_note from public.credit_notes
  where id = p_credit_note_id and company_id = v_company_id for update;
  if not found then raise exception 'Credit note not found for this company'; end if;
  if v_note.status = 'reversed' then return v_note.id; end if;

  update public.credit_notes set status = 'reversed', reversed_at = now(),
    reversed_by = auth.uid(), reversal_reason = trim(p_reason), updated_at = now()
  where id = v_note.id and company_id = v_company_id;

  update public.invoices
  set credited_amount = (
        select coalesce(sum(note.grand_total), 0)
        from public.credit_notes note
        where note.company_id = v_company_id and note.invoice_id = v_note.invoice_id and note.status = 'issued'
      ),
      updated_at = now()
  where id = v_note.invoice_id and company_id = v_company_id;
  perform private.recalculate_invoice_collection_state(v_note.invoice_id, v_company_id);

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (v_company_id, auth.uid(), 'credit_note_reversed', 'credit_note', v_note.id,
    jsonb_build_object('invoice_id', v_note.invoice_id, 'dispatch_id', v_note.dispatch_id, 'amount', v_note.grand_total, 'reason', trim(p_reason)));
  return v_note.id;
end;
$function$


-- FN private.reverse_expense_payment_atomic
CREATE OR REPLACE FUNCTION private.reverse_expense_payment_atomic(p_payment_id uuid, p_reason text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_payment public.expense_payments%rowtype;
  v_expense public.expense_ledger%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for supplier payment reversals' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Reversal idempotency key is required'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Enter a clear reversal reason'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':expense-payment-reversal:' || p_idempotency_key::text, 0));

  select * into v_payment from public.expense_payments where id = p_payment_id and company_id = v_company_id;
  if not found then raise exception 'Supplier payment not found for this company'; end if;
  perform 1 from public.expense_ledger where id = v_payment.expense_ledger_id and company_id = v_company_id for update;
  select * into v_payment from public.expense_payments where id = p_payment_id and company_id = v_company_id for update;
  if v_payment.status = 'reversed' then
    if v_payment.reversal_idempotency_key = p_idempotency_key then
      select * into v_expense from public.expense_ledger where id = v_payment.expense_ledger_id and company_id = v_company_id;
      return jsonb_build_object('payment_id', v_payment.id, 'expense_id', v_expense.id, 'amount_paid', v_expense.amount_paid,
        'balance_amount', v_expense.balance_amount, 'payment_status', v_expense.payment_status, 'idempotent_replay', true);
    end if;
    raise exception 'This supplier payment is already reversed';
  end if;

  update public.expense_payments
  set status = 'reversed', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason),
      reversal_idempotency_key = p_idempotency_key
  where id = v_payment.id and company_id = v_company_id;

  select * into v_expense from public.expense_ledger where id = v_payment.expense_ledger_id and company_id = v_company_id;
  return jsonb_build_object('payment_id', v_payment.id, 'expense_id', v_expense.id, 'amount_paid', v_expense.amount_paid,
    'balance_amount', v_expense.balance_amount, 'payment_status', v_expense.payment_status, 'idempotent_replay', false);
end;
$function$


-- FN private.reverse_expense_supplier_credit_atomic
CREATE OR REPLACE FUNCTION private.reverse_expense_supplier_credit_atomic(p_credit_id uuid, p_reason text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_credit public.expense_supplier_credits%rowtype;
  v_expense public.expense_ledger%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for supplier credit reversals' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Reversal idempotency key is required'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Enter a clear reversal reason'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':expense-credit-reversal:' || p_idempotency_key::text, 0));

  select * into v_credit from public.expense_supplier_credits where id = p_credit_id and company_id = v_company_id;
  if not found then raise exception 'Supplier credit not found for this company'; end if;
  perform 1 from public.expense_ledger where id = v_credit.expense_ledger_id and company_id = v_company_id for update;
  select * into v_credit from public.expense_supplier_credits where id = p_credit_id and company_id = v_company_id for update;
  if v_credit.status = 'reversed' then
    if v_credit.reversal_idempotency_key = p_idempotency_key then
      select * into v_expense from public.expense_ledger where id = v_credit.expense_ledger_id and company_id = v_company_id;
      return jsonb_build_object('credit_id', v_credit.id, 'expense_id', v_expense.id, 'balance_amount', v_expense.balance_amount,
        'supplier_credit_due', v_expense.supplier_credit_due, 'payment_status', v_expense.payment_status, 'idempotent_replay', true);
    end if;
    raise exception 'This supplier credit is already reversed';
  end if;
  update public.expense_supplier_credits
  set status = 'reversed', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason),
      reversal_idempotency_key = p_idempotency_key
  where id = v_credit.id and company_id = v_company_id;
  select * into v_expense from public.expense_ledger where id = v_credit.expense_ledger_id and company_id = v_company_id;
  return jsonb_build_object('credit_id', v_credit.id, 'expense_id', v_expense.id, 'balance_amount', v_expense.balance_amount,
    'supplier_credit_due', v_expense.supplier_credit_due, 'payment_status', v_expense.payment_status, 'idempotent_replay', false);
end;
$function$


-- FN private.reverse_payment_atomic
CREATE OR REPLACE FUNCTION private.reverse_payment_atomic(p_payment_id uuid, p_reason text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_payment public.payments%rowtype;
  v_invoice public.invoices%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for payment reversals' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Reversal idempotency key is required';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Enter a clear reversal reason';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_company_id::text || ':payment-reversal:' || p_idempotency_key::text,
    0
  ));

  select *
  into v_payment
  from public.payments
  where id = p_payment_id
    and company_id = v_company_id
  for update;

  if not found then
    raise exception 'Payment not found for this company';
  end if;
  if v_payment.reversal_idempotency_key = p_idempotency_key
    and v_payment.payment_status = 'CANCELLED' then
    select * into v_invoice
    from public.invoices
    where id = v_payment.invoice_id and company_id = v_company_id;
    return jsonb_build_object(
      'payment_id', p_payment_id,
      'invoice_id', v_payment.invoice_id,
      'amount_paid', v_invoice.amount_paid,
      'balance_due', v_invoice.balance_due,
      'invoice_status', v_invoice.status,
      'idempotent_replay', true
    );
  end if;
  if v_payment.payment_status <> 'PAID' then
    raise exception 'Only a posted receipt can be reversed';
  end if;

  perform 1
  from public.invoices
  where id = v_payment.invoice_id
    and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Linked invoice not found for this company';
  end if;

  update public.payments
  set payment_status = 'CANCELLED',
      reversed_at = now(),
      reversed_by = auth.uid(),
      reversal_reason = trim(p_reason),
      reversal_idempotency_key = p_idempotency_key,
      updated_at = now()
  where id = p_payment_id
    and company_id = v_company_id;

  perform private.recalculate_invoice_collection_state(v_payment.invoice_id, v_company_id);
  select * into v_invoice
  from public.invoices
  where id = v_payment.invoice_id and company_id = v_company_id;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (
    v_company_id,
    auth.uid(),
    'payment_reversed',
    'payment',
    p_payment_id,
    jsonb_build_object(
      'invoice_id', v_payment.invoice_id,
      'amount', v_payment.amount,
      'reason', trim(p_reason)
    )
  );

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'invoice_id', v_payment.invoice_id,
    'amount_paid', v_invoice.amount_paid,
    'balance_due', v_invoice.balance_due,
    'invoice_status', v_invoice.status,
    'idempotent_replay', false
  );
end;
$function$


-- FN private.save_dispatch_atomic
CREATE OR REPLACE FUNCTION private.save_dispatch_atomic(p_dispatch_id uuid, p_dispatch jsonb, p_items jsonb, p_order_stage text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_order_id uuid := nullif(p_dispatch ->> 'order_id', '')::uuid;
  v_dispatch_id uuid;
  v_payload jsonb;
  v_item jsonb;
  v_bundle_number text;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied for dispatches' using errcode = '42501';
  end if;
  perform 1 from public.orders where id = v_order_id and company_id = v_company_id for update;
  if not found then raise exception 'Selected order is not available for this company'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Enter at least one operator-verified physical bundle';
  end if;

  v_payload := private.keep_jsonb_keys(p_dispatch, array[
      'order_id','dispatch_date','number_of_bundles','total_weight_kg',
      'transporter_name','vehicle_number','driver_name','driver_phone','eway_bill_number',
      'lr_number','delivery_status','proof_of_delivery_url','packing_list_url','remarks'
    ]) || jsonb_build_object('company_id', v_company_id, 'order_id', v_order_id);

  if p_dispatch_id is null then
    v_payload := v_payload || jsonb_build_object(
      'dispatch_number', private.next_business_number_locked(
        'public.dispatches'::regclass, 'dispatch_number', v_company_id, 'D',
        coalesce(nullif(v_payload ->> 'dispatch_date', '')::date, (now() at time zone 'Asia/Kolkata')::date)
      )
    );
    v_dispatch_id := private.insert_jsonb_row(
      'public.dispatches'::regclass,
      v_payload || jsonb_build_object('created_by', auth.uid())
    );
  else
    perform 1 from public.dispatches where id = p_dispatch_id and company_id = v_company_id for update;
    if not found then raise exception 'Dispatch not found for this company'; end if;
    v_dispatch_id := private.update_jsonb_row(
      'public.dispatches'::regclass, p_dispatch_id, v_company_id,
      v_payload || jsonb_build_object('updated_at', now())
    );
  end if;

  delete from public.packing_list_items
  where dispatch_id = v_dispatch_id and company_id = v_company_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_bundle_number := nullif(trim(v_item ->> 'bundle_number'), '');
    if v_bundle_number is null then raise exception 'Scan or enter every physical bundle identifier'; end if;
    perform private.insert_jsonb_row(
      'public.packing_list_items'::regclass,
      (v_item - array['id','company_id','dispatch_id','created_at','updated_at','net_weight_kg','operator_verified_at','operator_verified_by'])
      || jsonb_build_object(
        'company_id', v_company_id,
        'dispatch_id', v_dispatch_id,
        'bundle_number', v_bundle_number,
        'operator_verified_at', now(),
        'operator_verified_by', auth.uid(),
        'created_at', now()
      )
    );
  end loop;

  if p_order_stage in ('dispatched', 'delivered') then
    update public.orders set current_stage = p_order_stage, updated_at = now()
    where id = v_order_id and company_id = v_company_id;
  end if;
  return v_dispatch_id;
end;
$function$


-- FN private.save_invoice_atomic
CREATE OR REPLACE FUNCTION private.save_invoice_atomic(p_invoice_id uuid, p_invoice jsonb, p_items jsonb, p_replace_items boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_requested_customer_id uuid := nullif(p_invoice->>'customer_id','')::uuid;
  v_order_id uuid := nullif(p_invoice->>'order_id','')::uuid;
  v_dispatch_id uuid := nullif(p_invoice->>'dispatch_id','')::uuid;
  v_order public.orders%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_existing public.invoices%rowtype;
  v_invoice_id uuid;
  v_payload jsonb;
  v_item jsonb;
  v_requested_status text := coalesce(nullif(p_invoice->>'status',''),'draft');
  v_invoice_prefix text := 'INV';
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('owner','admin','accounts') then raise exception 'Permission denied for invoices' using errcode='42501'; end if;
  if v_order_id is null then raise exception 'Select the source order for this invoice'; end if;
  if v_dispatch_id is null then raise exception 'Select a packed dispatch. Tax invoices cannot bill an order directly.'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'Invoice items must be an array'; end if;

  select * into v_order from public.orders where id=v_order_id and company_id=v_company_id for share nowait;
  if not found then raise exception 'Order not found for this company'; end if;
  if v_requested_customer_id is not null and v_requested_customer_id<>v_order.customer_id then raise exception 'Invoice customer must match the source order customer'; end if;
  if not exists(select 1 from public.customers where id=v_order.customer_id and company_id=v_company_id) then raise exception 'Order customer not found for this company'; end if;

  -- Return/damage and cancellation cannot change while this save uses the manifest.
  -- Fail fast rather than waiting on a delivery writer that may need the order.
  if not pg_try_advisory_xact_lock(hashtextextended('dispatch-invoice:'||v_company_id::text||':'||v_dispatch_id::text,0)) then
    raise exception 'Invoice manifest is being changed. Refresh and retry' using errcode='55P03';
  end if;
  select * into v_dispatch from public.dispatches where id=v_dispatch_id and company_id=v_company_id and order_id=v_order_id for update nowait;
  if not found then raise exception 'Dispatch must belong to the selected order and company'; end if;
  if v_dispatch.delivery_status in ('returned','damaged') then raise exception 'Returned or damaged dispatches cannot be invoiced; resolve the return or create a replacement dispatch first' using errcode='23514'; end if;
  if not private.invoice_dispatch_is_billable(v_company_id,v_order_id,v_dispatch_id) then
    raise exception 'Only verified shipments recorded before cancellation can be invoiced for this order' using errcode='23514';
  end if;
  if exists(select 1 from public.invoices where company_id=v_company_id and dispatch_id=v_dispatch_id and status<>'cancelled'
    and (p_invoice_id is null or id<>p_invoice_id)) then raise exception 'This dispatch already has an active invoice'; end if;

  if p_invoice_id is null then
    if v_requested_status not in ('draft','generated') then raise exception 'New invoices can only start as draft or generated'; end if;
    if not p_replace_items or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'An invoice requires at least one source line'; end if;
  else
    select * into v_existing from public.invoices where id=p_invoice_id and company_id=v_company_id for update nowait;
    if not found then raise exception 'Invoice not found for this company'; end if;
    if v_existing.status is null or v_existing.status not in ('draft','generated') or coalesce(v_existing.amount_paid,0)<>0 then raise exception 'Only unpaid draft or generated invoices can be edited'; end if;
    if v_requested_status not in ('draft','generated','sent') then raise exception 'Use the receipt workflow to change a financial invoice status'; end if;
    if not p_replace_items or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'Editing an invoice requires its source lines to be regenerated'; end if;
  end if;

  select coalesce(nullif(invoice_prefix,''),'INV') into v_invoice_prefix from public.company_settings where company_id=v_company_id limit 1;
  v_invoice_prefix := coalesce(v_invoice_prefix,'INV');
  v_payload := private.keep_jsonb_keys(p_invoice,array['invoice_number','invoice_date','due_date','status','notes','place_of_supply_state_code'])
    ||jsonb_build_object('company_id',v_company_id,'customer_id',v_order.customer_id,'order_id',v_order_id,'dispatch_id',v_dispatch_id,
      'subtotal',0,'tax_total',0,'grand_total',0,'amount_paid',0,'paid_date',null,'status',v_requested_status);
  if p_invoice_id is null then
    if nullif(v_payload->>'invoice_number','') is null then
      v_payload := v_payload||jsonb_build_object('invoice_number',private.next_business_number_locked('public.invoices'::regclass,'invoice_number',v_company_id,
        v_invoice_prefix,coalesce(nullif(v_payload->>'invoice_date','')::date,current_date)));
    end if;
    v_invoice_id := private.insert_jsonb_row('public.invoices'::regclass,v_payload||jsonb_build_object('created_by',auth.uid()));
  else
    v_invoice_id := private.update_jsonb_row('public.invoices'::regclass,p_invoice_id,v_company_id,(v_payload-'invoice_number')||jsonb_build_object('updated_at',now()));
  end if;
  delete from public.invoice_items where invoice_id=v_invoice_id and company_id=v_company_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    perform private.insert_jsonb_row('public.invoice_items'::regclass,
      (v_item-array['id','company_id','invoice_id','created_at','updated_at'])||jsonb_build_object('company_id',v_company_id,'invoice_id',v_invoice_id,'created_at',now(),'updated_at',now()));
  end loop;
  perform private.recalculate_invoice_totals(v_invoice_id,v_company_id);
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,metadata_json)
  values(v_company_id,auth.uid(),case when p_invoice_id is null then 'invoice_created' else 'invoice_updated' end,'invoice',v_invoice_id,
    jsonb_build_object('order_id',v_order_id,'dispatch_id',v_dispatch_id,'customer_id',v_order.customer_id,'status',v_requested_status,
      'retained_after_cancellation',v_order.current_stage='cancelled'));
  return v_invoice_id;
exception when lock_not_available then
  raise exception 'Invoice source is being changed. Refresh and retry' using errcode='55P03';
end;
$function$


-- FN private.save_manual_expense_atomic
CREATE OR REPLACE FUNCTION private.save_manual_expense_atomic(p_expense_id uuid, p_payload jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_existing public.expense_ledger%rowtype;
  v_result public.expense_ledger%rowtype;
  v_id uuid;
  v_quantity numeric(14,3);
  v_rate numeric(14,2);
  v_base numeric(14,2);
  v_tax numeric(14,2);
  v_freight numeric(14,2);
  v_discount numeric(14,2);
  v_total numeric(14,2);
  v_claimed_total numeric;
  v_category text := nullif(btrim(p_payload ->> 'expense_category'), '');
  v_subcategory text := nullif(btrim(p_payload ->> 'expense_subcategory'), '');
  v_description text := nullif(btrim(p_payload ->> 'description'), '');
  v_unit text := nullif(btrim(p_payload ->> 'unit'), '');
  v_currency text := coalesce(nullif(btrim(p_payload ->> 'currency'), ''), 'INR');
  v_vendor_id uuid := nullif(p_payload ->> 'vendor_id', '')::uuid;
  v_machine_id uuid := nullif(p_payload ->> 'machine_id', '')::uuid;
  v_item_id uuid := nullif(p_payload ->> 'inventory_item_id', '')::uuid;
  v_invoice_number text := nullif(btrim(p_payload ->> 'invoice_number'), '');
  v_invoice_date date := nullif(p_payload ->> 'invoice_date', '')::date;
  v_due_date date := nullif(p_payload ->> 'due_date', '')::date;
  v_payment_method text := nullif(btrim(p_payload ->> 'payment_method'), '');
  v_cost_center text := nullif(btrim(p_payload ->> 'cost_center'), '');
  v_department text := nullif(btrim(p_payload ->> 'department'), '');
  v_notes text := nullif(btrim(p_payload ->> 'notes'), '');
  v_submit boolean := coalesce(nullif(p_payload ->> 'submit', '')::boolean, false);
  v_vendor_name text;
  v_duplicate text;
  v_hash text;
  v_replay boolean := false;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for expenses' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Expense details are required' using errcode = '22023';
  end if;
  if p_expense_id is null and p_idempotency_key is null then
    raise exception 'Expense idempotency key is required';
  end if;

  begin
    v_quantity := round(coalesce(nullif(p_payload ->> 'quantity', '')::numeric, 0), 3);
    v_rate := round(coalesce(nullif(p_payload ->> 'rate', '')::numeric, 0), 2);
    v_base := round(coalesce(nullif(p_payload ->> 'base_amount', '')::numeric, 0), 2);
    v_tax := round(coalesce(nullif(p_payload ->> 'tax_amount', '')::numeric, 0), 2);
    v_freight := round(coalesce(nullif(p_payload ->> 'freight_amount', '')::numeric, 0), 2);
    v_discount := round(coalesce(nullif(p_payload ->> 'discount_amount', '')::numeric, 0), 2);
    v_claimed_total := nullif(p_payload ->> 'total_amount', '')::numeric;
  exception when others then
    raise exception 'Expense amounts must be valid numbers' using errcode = '22023';
  end;
  if 'NaN'::numeric in (v_quantity, v_rate, v_base, v_tax, v_freight, v_discount) then
    raise exception 'Expense amounts must be finite numbers' using errcode = '22023';
  end if;
  if least(v_quantity, v_rate, v_base, v_tax, v_freight, v_discount) < 0 then
    raise exception 'Expense quantity, rate and amounts cannot be negative' using errcode = '23514';
  end if;
  if v_category is null or v_category not in ('raw_material','scrap_purchase','external_aluminium_source','packaging_material',
    'spare_parts','maintenance_repairs','dies_tooling','utilities','fuel_oils','chemicals','freight_logistics',
    'labour_vendor_services','office_and_administration','production_consumables','surface_treatment',
    'factory_overheads','miscellaneous') then
    raise exception 'Select a valid expense category' using errcode = '22023';
  end if;
  if length(coalesce(v_description, '')) < 3 then raise exception 'Enter an expense description'; end if;
  if v_currency <> 'INR' then
    raise exception 'Expenses are recorded in INR until currency conversion is available. Convert the bill to INR at the booked rate.' using errcode = '23514';
  end if;
  if v_quantity > 0 and v_rate > 0 then
    if v_base = 0 then
      v_base := round(v_quantity * v_rate, 2);
    elsif abs(v_base - round(v_quantity * v_rate, 2)) >= 0.005 then
      raise exception 'Base amount must equal quantity x rate (%). Clear the rate to enter a lump-sum base.', round(v_quantity * v_rate, 2)
        using errcode = '23514';
    end if;
  end if;
  v_total := round(v_base + v_tax + v_freight - v_discount, 2);
  if v_total <= 0 then raise exception 'Expense total must be greater than zero' using errcode = '23514'; end if;
  if v_claimed_total is not null and abs(v_claimed_total - v_total) >= 0.005 then
    raise exception 'Total amount (%) does not match base + tax + freight - discount (%)', v_claimed_total, v_total
      using errcode = '23514';
  end if;
  if v_invoice_date is not null and v_due_date is not null and v_due_date < v_invoice_date then
    raise exception 'Due date cannot be before the bill date';
  end if;
  if v_vendor_id is not null then
    select vendor_name into v_vendor_name from public.vendors where id = v_vendor_id and company_id = v_company_id;
    if not found then raise exception 'Vendor not found for this company'; end if;
  end if;
  if v_machine_id is not null and not exists (select 1 from public.machines where id = v_machine_id and company_id = v_company_id) then
    raise exception 'Machine not found for this company';
  end if;
  if v_item_id is not null and not exists (select 1 from public.inventory_items where id = v_item_id and company_id = v_company_id) then
    raise exception 'Inventory item not found for this company';
  end if;

  v_hash := md5(jsonb_build_object('expense_id', p_expense_id, 'category', v_category, 'subcategory', v_subcategory,
    'description', v_description, 'quantity', v_quantity, 'unit', v_unit, 'rate', v_rate, 'base', v_base,
    'tax', v_tax, 'freight', v_freight, 'discount', v_discount, 'currency', v_currency, 'vendor', v_vendor_id,
    'machine', v_machine_id, 'item', v_item_id, 'invoice_number', v_invoice_number, 'invoice_date', v_invoice_date,
    'due_date', v_due_date, 'payment_method', v_payment_method, 'cost_center', v_cost_center,
    'department', v_department, 'notes', v_notes, 'submit', v_submit)::text);

  if p_expense_id is null then
    perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':manual-expense:' || p_idempotency_key::text, 0));
    select * into v_existing from public.expense_ledger
    where company_id = v_company_id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.request_hash is distinct from v_hash then
        raise exception 'This retry key was already used for different expense details. Refresh and review expense % before saving again.', v_existing.expense_number;
      end if;
      v_id := v_existing.id;
      v_replay := true;
    end if;
  else
    select * into v_existing from public.expense_ledger
    where id = p_expense_id and company_id = v_company_id
    for update;
    if not found then raise exception 'Expense not found for this company'; end if;
    if v_existing.deleted_at is not null then raise exception 'Deleted expenses cannot be edited'; end if;
    if v_existing.source_table is not null then
      raise exception 'Expense % is posted from %. Edit the source record instead.', v_existing.expense_number, v_existing.source_table;
    end if;
    if v_existing.approval_status not in ('draft', 'pending_approval', 'rejected') then
      raise exception 'Expense % is % and locked. An owner or admin must reopen it before editing.', v_existing.expense_number, v_existing.approval_status;
    end if;
  end if;

  if not v_replay then
    v_duplicate := private.find_duplicate_vendor_bill(v_company_id, v_vendor_id, v_invoice_number, v_invoice_date, v_total, p_expense_id, null);
    if v_duplicate is not null then
      raise exception 'This vendor bill is already recorded as expense % for the same amount in this financial year.', v_duplicate
        using errcode = '23505';
    end if;

    if p_expense_id is null then
      insert into public.expense_ledger(
        company_id, source_module, source_submodule, expense_category, expense_subcategory, vendor_id,
        vendor_name_snapshot, description, quantity, unit, rate, base_amount, tax_amount, freight_amount,
        discount_amount, total_amount, currency, payment_method, invoice_number, invoice_date, due_date,
        cost_center, department, machine_id, inventory_item_id, approval_status, notes, created_by, updated_by,
        idempotency_key, request_hash
      ) values (
        v_company_id, 'manual', 'manual_expense', v_category, v_subcategory, v_vendor_id,
        v_vendor_name, v_description, v_quantity, v_unit, v_rate, v_base, v_tax, v_freight,
        v_discount, v_total, v_currency, v_payment_method, v_invoice_number, v_invoice_date, v_due_date,
        v_cost_center, v_department, v_machine_id, v_item_id,
        case when v_submit then 'pending_approval' else 'draft' end,
        v_notes, auth.uid(), auth.uid(), p_idempotency_key, v_hash
      ) returning id into v_id;
    else
      update public.expense_ledger
      set expense_category = v_category, expense_subcategory = v_subcategory, vendor_id = v_vendor_id,
          vendor_name_snapshot = v_vendor_name, description = v_description, quantity = v_quantity, unit = v_unit,
          rate = v_rate, base_amount = v_base, tax_amount = v_tax, freight_amount = v_freight,
          discount_amount = v_discount, total_amount = v_total, currency = v_currency,
          payment_method = v_payment_method, invoice_number = v_invoice_number, invoice_date = v_invoice_date,
          due_date = v_due_date, cost_center = v_cost_center, department = v_department,
          machine_id = v_machine_id, inventory_item_id = v_item_id, notes = v_notes, updated_by = auth.uid()
      where id = p_expense_id and company_id = v_company_id;
      v_id := p_expense_id;
      if v_submit and v_existing.approval_status in ('draft', 'rejected') then
        perform private.transition_expense_approval(v_id, 'submit', null);
      end if;
    end if;
  end if;

  select * into v_result from public.expense_ledger where id = v_id and company_id = v_company_id;
  return jsonb_build_object('expense_id', v_result.id, 'expense_number', v_result.expense_number,
    'approval_status', v_result.approval_status, 'payment_status', v_result.payment_status,
    'total_amount', v_result.total_amount, 'idempotent_replay', v_replay);
end;
$function$


-- FN private.save_order_atomic
CREATE OR REPLACE FUNCTION private.save_order_atomic(p_order_id uuid, p_order jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_customer_id uuid := nullif(p_order ->> 'customer_id', '')::uuid;
  v_quote_id uuid := nullif(p_order ->> 'quote_id', '')::uuid;
  v_payload jsonb;
  v_order_id uuid;
  v_item jsonb;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() is null then raise exception 'Permission denied for orders' using errcode = '42501'; end if;
  if p_order_id is null and v_quote_id is null then
    raise exception 'Use direct priced order entry with at least one complete priced profile line' using errcode='23514';
  end if;
  if p_order_id is null and private.get_current_user_role() not in ('owner','admin','sales','sales_manager','factory_manager','production_manager') then
    raise exception 'Permission denied for orders' using errcode = '42501';
  end if;
  if p_order_id is not null and private.get_current_user_role() not in ('owner','admin','sales_manager','factory_manager','production_manager','production','dispatch_manager') then
    raise exception 'Permission denied for orders' using errcode = '42501';
  end if;
  perform 1 from public.customers where id = v_customer_id and company_id = v_company_id;
  if not found then raise exception 'Customer not found for this company'; end if;
  if v_quote_id is not null and not exists (
    select 1 from public.quotes where id = v_quote_id and company_id = v_company_id and customer_id = v_customer_id
  ) then
    raise exception 'Quote not found for this customer and company';
  end if;

  v_payload := private.keep_jsonb_keys(p_order, array[
      'quote_id','customer_id','production_profile_id','production_die_id','production_quantity_kg',
      'production_pieces','billet_diameter_required_inch','production_notes','order_date',
      'expected_dispatch_date','priority','current_stage','order_value','notes','dealer_id'
    ])
    || jsonb_build_object('company_id', v_company_id, 'customer_id', v_customer_id);

  if p_order_id is null then
    v_payload := v_payload || jsonb_build_object(
      'order_number', private.next_business_number_locked(
        'public.orders'::regclass, 'order_number', v_company_id, 'O',
        coalesce(nullif(v_payload ->> 'order_date', '')::date, current_date)
      ), 'created_by', auth.uid()
    );
    v_order_id := private.insert_jsonb_row('public.orders'::regclass, v_payload);
  else
    perform 1 from public.orders where id = p_order_id and company_id = v_company_id for update;
    if not found then raise exception 'Order not found for this company'; end if;
    v_order_id := private.update_jsonb_row('public.orders'::regclass, p_order_id, v_company_id, v_payload || jsonb_build_object('updated_at', now()));
  end if;

  if p_order_id is null and v_quote_id is not null then
    for v_item in select to_jsonb(qi) from public.quote_items qi
      where qi.company_id = v_company_id and qi.quote_id = v_quote_id
      order by qi.created_at, qi.id
    loop
      perform private.insert_jsonb_row(
        'public.order_items'::regclass,
        (v_item - array['id','company_id','quote_id','created_at','updated_at'])
          || jsonb_build_object(
            'company_id', v_company_id, 'order_id', v_order_id,
            'source_record_id', v_quote_id,
            'source_line_id', nullif(v_item ->> 'id', '')::uuid,
            'quote_item_id', nullif(v_item ->> 'id', '')::uuid,
            'created_at', now(), 'updated_at', now()
          )
      );
    end loop;
  end if;
  return v_order_id;
end;
$function$


-- FN private.save_packaging_job_atomic
CREATE OR REPLACE FUNCTION private.save_packaging_job_atomic(p_job_id uuid, p_job jsonb, p_materials jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_order_id uuid := nullif(p_job ->> 'order_id', '')::uuid;
  v_production_job_id uuid := nullif(p_job ->> 'production_job_id', '')::uuid;
  v_job_id uuid;
  v_payload jsonb;
  v_material jsonb;
  v_material_id uuid;
  v_quantity numeric;
  v_requested_status text := coalesce(nullif(p_job ->> 'status', ''), 'scheduled');
  v_existing_status text;
  v_source record;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner','admin','production_manager','production','dispatch_manager','dispatch') then
    raise exception 'Permission denied for packaging' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_materials, '[]'::jsonb)) <> 'array' then
    raise exception 'Packaging materials must be an array';
  end if;

  select actual_pieces, pieces
  into v_source
  from public.production_jobs
  where id = v_production_job_id
    and company_id = v_company_id
    and order_id = v_order_id
    and status = 'completed'
  for update;
  if not found then
    raise exception 'Packaging must link to a completed production job for the selected order';
  end if;
  if p_job ->> 'status' = 'completed' and jsonb_array_length(coalesce(p_materials, '[]'::jsonb)) = 0 then
    raise exception 'Select at least one packaging material before completing packaging';
  end if;

  v_payload := private.keep_jsonb_keys(p_job, array[
    'packaging_number','order_id','production_job_id','finishing_job_id','scheduled_date','pieces',
    'profile_weight_kg','profile_length_m','status','notes'
  ]) || jsonb_build_object(
    'company_id', v_company_id,
    'order_id', v_order_id,
    'production_job_id', v_production_job_id,
    'pieces', case
      when coalesce(nullif(p_job ->> 'pieces', '')::integer, 0) > 0
        then nullif(p_job ->> 'pieces', '')::integer
      else coalesce(nullif(v_source.actual_pieces, 0), v_source.pieces, 0)
    end
  );

  if p_job_id is null then
    if nullif(v_payload ->> 'packaging_number', '') is null then
      v_payload := v_payload || jsonb_build_object(
        'packaging_number', private.next_business_number_locked(
          'public.packaging_jobs'::regclass,
          'packaging_number',
          v_company_id,
          'PKG',
          coalesce(nullif(v_payload ->> 'scheduled_date', '')::date, current_date)
        )
      );
    end if;
    if v_requested_status in ('completed', 'cancelled') then
      v_payload := v_payload || jsonb_build_object('status', 'scheduled');
    end if;
    v_job_id := private.insert_jsonb_row(
      'public.packaging_jobs'::regclass,
      v_payload || jsonb_build_object('created_by', auth.uid())
    );
  else
    select status into v_existing_status
    from public.packaging_jobs
    where id = p_job_id and company_id = v_company_id
    for update;
    if not found then raise exception 'Packaging job not found for this company'; end if;
    if v_existing_status in ('completed', 'cancelled') then
      raise exception 'Completed or cancelled packaging jobs cannot be edited; use a reversal record';
    end if;
    if v_requested_status in ('completed', 'cancelled') then
      v_payload := v_payload || jsonb_build_object('status', v_existing_status);
    end if;
    v_job_id := private.update_jsonb_row(
      'public.packaging_jobs'::regclass,
      p_job_id,
      v_company_id,
      (v_payload - 'packaging_number') || jsonb_build_object('updated_at', now())
    );
  end if;

  delete from public.packaging_job_materials
  where job_id = v_job_id and company_id = v_company_id;

  for v_material in
    select value from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
  loop
    v_material_id := nullif(v_material ->> 'material_id', '')::uuid;
    v_quantity := coalesce(nullif(v_material ->> 'quantity_required', '')::numeric, 0);
    if v_material_id is null or v_quantity <= 0 then
      raise exception 'Every packaging material requires a positive quantity';
    end if;
    perform 1 from public.packaging_materials
    where id = v_material_id and company_id = v_company_id and is_active = true
    for update;
    if not found then raise exception 'Packaging material is unavailable for this company'; end if;

    insert into public.packaging_job_materials(
      company_id, job_id, material_id, quantity_required, created_by
    ) values (
      v_company_id, v_job_id, v_material_id, v_quantity, auth.uid()
    );
  end loop;

  if v_requested_status in ('completed', 'cancelled') then
    update public.packaging_jobs
    set status = v_requested_status, updated_at = now()
    where id = v_job_id and company_id = v_company_id;
  end if;

  return v_job_id;
end;
$function$


-- FN private.save_production_job_atomic
CREATE OR REPLACE FUNCTION private.save_production_job_atomic(p_job_id uuid, p_job jsonb, p_billet_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_order_id uuid := nullif(p_job ->> 'order_id', '')::uuid;
  v_profile_id uuid := nullif(p_job ->> 'profile_id', '')::uuid;
  v_job_id uuid;
  v_payload jsonb;
  v_expected integer;
  v_actual integer;
  v_req_diameter numeric;
  v_req_alloy text;
  v_incompatible integer;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_job_id is null and private.get_current_user_role() not in ('owner','admin','production_manager','factory_manager') then
    raise exception 'Permission denied to create production jobs' using errcode = '42501';
  end if;
  if p_job_id is not null and private.get_current_user_role() not in ('owner','admin','production_manager','factory_manager','production') then
    raise exception 'Permission denied to update production jobs' using errcode = '42501';
  end if;
  perform 1 from public.orders where id = v_order_id and company_id = v_company_id for update;
  if not found then raise exception 'Selected order is not available for this company'; end if;

  v_expected := coalesce(cardinality(p_billet_ids), 0);
  if v_expected > 0 then
    perform 1
    from public.foundry_billets b
    where b.company_id = v_company_id and b.id = any(p_billet_ids)
    for update;
    select count(*) into v_actual
    from public.foundry_billets b
    where b.company_id = v_company_id
      and b.id = any(p_billet_ids)
      and b.order_id = v_order_id
      and b.status in ('allocated', 'issued')
      and (b.production_job_id is null or b.production_job_id = p_job_id);
    if v_actual <> v_expected then
      raise exception 'Selected billets are stale, incompatible, or already issued to another production job';
    end if;

    if v_profile_id is not null then
      select billet_diameter_required_inch, alloy
        into v_req_diameter, v_req_alloy
      from public.aluminium_profiles
      where id = v_profile_id and company_id = v_company_id;

      select count(*) into v_incompatible
      from public.foundry_billets b
      where b.company_id = v_company_id
        and b.id = any(p_billet_ids)
        and (
          (v_req_diameter is not null and v_req_diameter > 0
            and (b.billet_diameter_inch is null or abs(b.billet_diameter_inch - v_req_diameter) > 0.001))
          or (v_req_alloy is not null and v_req_alloy <> ''
            and lower(coalesce(b.alloy, '')) <> lower(v_req_alloy))
        );
      if v_incompatible > 0 then
        raise exception 'Selected billets do not match the job profile required billet diameter or alloy';
      end if;
    end if;
  end if;

  v_payload := private.keep_jsonb_keys(p_job, array[
      'job_number','order_id','profile_id','die_id','machine_id','planned_quantity_kg','actual_quantity_kg',
      'planned_meters','actual_meters','pieces','required_billet_count','extrusion_efficiency_percent',
      'length_per_piece_m','planned_date','shift','operator_name','status','remarks','is_active',
      'source_record_id','source_line_id','section_number','section_code','section_name','customer_component_code',
      'component_description','drawing_document_id','drawing_revision','drawing_approval_status','alloy_standard_id',
      'alloy_id','temper_id','cl_uom','cl_per_uom','cl_meter','order_uom','order_quantity','quantity_kg',
      'section_weight_kg_per_m','min_weight','max_weight','weight_tolerance','quantity_calculation_method',
      'packing_mode_id','invoice_calc_uom','standard_length','cut_length','bundle_quantity',
      'pieces_per_m_per_kg_per_bundle','packing_instruction','customer_packing_requirement','material_price',
      'value_added_service_price','other_charges','basic_price','packing_charge','freight_charge',
      'alloy_surcharge_per_kg','re_cutting_charge_per_kg','testing_service_charge_per_kg','die_cost',
      'die_service_charge','packing_in_conversion','include_packing_in_basic','gst_percent','discount','margin',
      'net_rate','final_line_value','input_billet_weight','output_good_weight','rejected_weight','rework_weight',
      'packing_weight','freight_weight','theoretical_weight','actual_weight','internal_cost','supplier_rate',
      'internal_note','revision_number'
    ])
    || jsonb_build_object('company_id', v_company_id, 'order_id', v_order_id);
  if p_job_id is not null then v_payload := v_payload - 'job_number'; end if;
  if p_job_id is null then
    if nullif(v_payload ->> 'job_number', '') is null then
      v_payload := v_payload || jsonb_build_object(
        'job_number', private.next_business_number_locked(
          'public.production_jobs'::regclass,
          'job_number',
          v_company_id,
          'J',
          coalesce(nullif(v_payload ->> 'planned_date', '')::date, current_date)
        )
      );
    end if;
    v_job_id := private.insert_jsonb_row(
      'public.production_jobs'::regclass,
      v_payload || jsonb_build_object('created_by', auth.uid())
    );
  else
    perform 1 from public.production_jobs where id = p_job_id and company_id = v_company_id for update;
    if not found then raise exception 'Production job not found for this company'; end if;
    v_job_id := private.update_jsonb_row(
      'public.production_jobs'::regclass,
      p_job_id,
      v_company_id,
      v_payload || jsonb_build_object('updated_at', now())
    );
  end if;

  update public.foundry_billets
  set production_job_id = null,
      status = 'allocated',
      updated_at = now()
  where company_id = v_company_id
    and production_job_id = v_job_id
    and status in ('issued', 'allocated')
    and (p_billet_ids is null or cardinality(p_billet_ids) = 0 or not (id = any(p_billet_ids)));

  if v_expected > 0 then
    update public.foundry_billets
    set production_job_id = v_job_id,
        status = case when p_job ->> 'status' = 'completed' then 'consumed' else 'issued' end,
        order_id = v_order_id,
        updated_at = now()
    where company_id = v_company_id and id = any(p_billet_ids);
  end if;
  return v_job_id;
end;
$function$


-- FN private.save_production_schedule_slot_atomic
CREATE OR REPLACE FUNCTION private.save_production_schedule_slot_atomic(p_slot_id uuid, p_slot jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_job_id uuid := nullif(p_slot ->> 'production_job_id', '')::uuid;
  v_machine_id uuid := nullif(p_slot ->> 'machine_id', '')::uuid;
  v_start timestamptz := nullif(p_slot ->> 'planned_start_at', '')::timestamptz;
  v_end timestamptz := nullif(p_slot ->> 'planned_end_at', '')::timestamptz;
  v_status text := coalesce(nullif(p_slot ->> 'status', ''), 'scheduled');
  v_existing public.production_plan_slots%rowtype;
  v_job public.production_jobs%rowtype;
  v_slot_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager','production') then raise exception 'Permission denied to schedule production jobs' using errcode = '42501'; end if;
  if v_job_id is null or v_machine_id is null or v_start is null or v_end is null then raise exception 'Production job, extrusion press, start, and end are required' using errcode = '23514'; end if;
  if v_end <= v_start then raise exception 'Planned end must be after planned start' using errcode = '23514'; end if;
  if v_status not in ('draft','scheduled') then raise exception 'Use the release action to release a scheduled slot' using errcode = '23514'; end if;

  select * into v_job from public.production_jobs where id = v_job_id and company_id = v_company_id for update;
  if not found or v_job.status not in ('planned','ready','on_hold') then raise exception 'Production job is not eligible for press scheduling' using errcode = '23514'; end if;
  perform 1 from public.orders order_record where order_record.id = v_job.order_id and order_record.company_id = v_company_id
    and order_record.current_stage not in ('closed','cancelled','delivered','payment_pending')
    and (order_record.current_stage <> 'dispatched' or private.order_job_has_remaining_production(v_company_id, v_job.order_id, v_job.id))
  for update;
  if not found then raise exception 'Production job order has no remaining eligible quantity for press scheduling' using errcode = '23514'; end if;
  perform 1 from public.dies die where die.id = v_job.die_id and die.company_id = v_company_id and die.profile_id = v_job.profile_id
    and die.die_status in ('active','approved') for update;
  if not found then raise exception 'Assigned die is no longer available for production scheduling' using errcode = '23514'; end if;
  perform 1 from public.machines machine where machine.id = v_machine_id and machine.company_id = v_company_id
    and machine.machine_type = 'extrusion_press' and machine.is_active = true and machine.status in ('active','operational','idle')
  for update;
  if not found then raise exception 'Selected extrusion press is not available for planning' using errcode = '23514'; end if;

  if p_slot_id is not null then
    select * into v_existing from public.production_plan_slots where id = p_slot_id and company_id = v_company_id for update;
    if not found then raise exception 'Production schedule slot not found for this company' using errcode = '23514'; end if;
    if v_existing.status = 'released' then raise exception 'Released press slots are locked and cannot be rescheduled' using errcode = '23514'; end if;
    if v_existing.production_job_id <> v_job_id then raise exception 'A schedule slot cannot be reassigned to a different production job' using errcode = '23514'; end if;
    update public.production_plan_slots set machine_id = v_machine_id, planned_start_at = v_start, planned_end_at = v_end,
      shift = nullif(p_slot ->> 'shift',''), sequence_number = greatest(coalesce(nullif(p_slot ->> 'sequence_number','')::integer,0),0),
      capacity_kg = nullif(p_slot ->> 'capacity_kg','')::numeric, status = v_status, locked_by = null, locked_at = null, updated_at = now()
    where id = p_slot_id and company_id = v_company_id returning id into v_slot_id;
  else
    insert into public.production_plan_slots(company_id, production_job_id, machine_id, planned_start_at, planned_end_at, shift,
      sequence_number, capacity_kg, status, created_by)
    values (v_company_id, v_job_id, v_machine_id, v_start, v_end, nullif(p_slot ->> 'shift',''),
      greatest(coalesce(nullif(p_slot ->> 'sequence_number','')::integer,0),0), nullif(p_slot ->> 'capacity_kg','')::numeric, v_status, auth.uid())
    returning id into v_slot_id;
  end if;

  update public.production_jobs set machine_id = v_machine_id,
    planned_date = (v_start at time zone 'Asia/Kolkata')::date,
    shift = nullif(p_slot ->> 'shift',''),
    status = v_job.status,
    updated_at = now()
  where id = v_job_id and company_id = v_company_id;
  return v_slot_id;
end;
$function$


-- FN private.save_quote_atomic
CREATE OR REPLACE FUNCTION private.save_quote_atomic(p_quote_id uuid, p_quote jsonb, p_items jsonb, p_expected_revision integer, p_expected_updated_at timestamp with time zone, p_revision_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_dealer_id uuid := private.get_current_user_dealer_id();
  v_customer_id uuid := nullif(p_quote ->> 'customer_id', '')::uuid;
  v_current public.quotes%rowtype;
  v_quote_id uuid;
  v_quote_number text;
  v_revision integer := 1;
  v_needs_revision boolean := false;
  v_payload jsonb;
  v_item jsonb;
  v_profile_id uuid;
  v_die_id uuid;
  v_subtotal numeric(14,2);
  v_profit numeric(14,2);
  v_gst_percent numeric(7,2);
  v_gst_amount numeric(14,2);
  v_low_margin boolean;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner','admin','sales','sales_manager','dealer_admin','dealer_staff') then
    raise exception 'Permission denied for quotations' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A quotation requires at least one line item' using errcode = '23514';
  end if;

  perform 1 from public.customers
  where id = v_customer_id and company_id = v_company_id;
  if not found then raise exception 'Customer not found for this company'; end if;

  if p_quote_id is not null then
    select * into v_current
    from public.quotes
    where id = p_quote_id and company_id = v_company_id
    for update;
    if not found then raise exception 'Quote not found for this company'; end if;
    if v_current.status = 'converted_to_order' then
      raise exception 'Converted quotes cannot be revised';
    end if;
    if p_expected_revision is null or p_expected_revision <> v_current.revision_number then
      raise exception 'The quote changed while you were editing it. Refresh and try again.'
        using errcode = '40001';
    end if;
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_current.updated_at then
      raise exception 'The quote changed while you were editing it. Refresh and try again.'
        using errcode = '40001';
    end if;
    if v_dealer_id is not null
       and v_current.dealer_id is distinct from v_dealer_id
       and v_current.created_by is distinct from auth.uid() then
      raise exception 'Dealer users can only revise their own quotations' using errcode = '42501';
    end if;
    v_needs_revision := v_current.status in (
      'approved_for_sending','sent','customer_approved','customer_rejected','expired'
    );
    v_revision := v_current.revision_number + case when v_needs_revision then 1 else 0 end;
    v_quote_number := v_current.quote_number;
    v_quote_id := v_current.id;
  else
    v_quote_number := private.next_business_number_locked(
      'public.quotes'::regclass,
      'quote_number',
      v_company_id,
      'Q',
      coalesce(nullif(p_quote ->> 'quote_date', '')::date, current_date)
    );
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_profile_id := nullif(v_item ->> 'profile_id', '')::uuid;
    v_die_id := nullif(v_item ->> 'die_id', '')::uuid;
    perform 1 from public.aluminium_profiles
    where id = v_profile_id and company_id = v_company_id;
    if not found then raise exception 'A quote profile is stale or belongs to another company'; end if;
    if v_die_id is not null and not exists (
      select 1 from public.dies
      where id = v_die_id and company_id = v_company_id and profile_id = v_profile_id
    ) then
      raise exception 'A quote die is stale or does not match its profile';
    end if;
  end loop;

  if p_quote_id is not null and v_needs_revision then
    insert into public.quote_revisions (
      company_id, quote_id, revision_number, snapshot_json, revised_by, reason
    ) values (
      v_company_id,
      v_quote_id,
      v_current.revision_number,
      jsonb_build_object(
        'quote', to_jsonb(v_current),
        'items', coalesce((
          select jsonb_agg(to_jsonb(item) order by item.created_at, item.id)
          from public.quote_items item
          where item.company_id = v_company_id and item.quote_id = v_quote_id
        ), '[]'::jsonb)
      ),
      auth.uid(),
      coalesce(nullif(btrim(p_revision_reason), ''), 'Commercial revision')
    );
  end if;

  v_gst_percent := greatest(least(coalesce((p_quote ->> 'gst_percent')::numeric, 0), 100), 0);
  v_payload := private.keep_jsonb_keys(p_quote, array[
      'customer_id','quote_date','valid_until','terms_and_conditions','delivery_timeline',
      'payment_terms','approval_notes','notes'
    ])
    || jsonb_build_object(
      'company_id', v_company_id,
      'customer_id', v_customer_id,
      'dealer_id', coalesce(v_dealer_id, v_current.dealer_id),
      'quote_number', v_quote_number,
      'status', case when v_needs_revision then 'draft' else coalesce(v_current.status, 'draft') end,
      'revision_number', v_revision,
      'gst_percent', v_gst_percent,
      'subtotal', 0,
      'total_margin_amount', 0,
      'total_before_gst', 0,
      'gst_amount', 0,
      'grand_total', 0,
      'low_margin_approval_required', false,
      'estimated_profit_amount', 0,
      'estimated_profit_percent', 0,
      'approved_by', case when v_needs_revision then null else v_current.approved_by end,
      'approved_at', case when v_needs_revision then null else v_current.approved_at end,
      'sent_at', case when v_needs_revision then null else v_current.sent_at end,
      'customer_decision_at', case when v_needs_revision then null else v_current.customer_decision_at end
    );

  if p_quote_id is null then
    v_quote_id := private.insert_jsonb_row(
      'public.quotes'::regclass,
      v_payload || jsonb_build_object('created_by', auth.uid())
    );
  else
    perform private.update_jsonb_row(
      'public.quotes'::regclass,
      v_quote_id,
      v_company_id,
      v_payload || jsonb_build_object('updated_at', now())
    );
    delete from public.quote_items
    where company_id = v_company_id and quote_id = v_quote_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    perform private.insert_jsonb_row(
      'public.quote_items'::regclass,
      (v_item - array['id','company_id','quote_id','created_at','updated_at','source_record_id','source_line_id'])
        || jsonb_build_object(
          'company_id', v_company_id,
          'quote_id', v_quote_id,
          'revision_number', v_revision,
          'created_at', now(),
          'updated_at', now()
        )
    );
  end loop;

  select
    round(coalesce(sum(item.line_total_before_gst), 0), 2),
    round(coalesce(sum(item.estimated_profit_amount), 0), 2),
    coalesce(bool_or(item.approval_required), false)
  into v_subtotal, v_profit, v_low_margin
  from public.quote_items item
  where item.company_id = v_company_id and item.quote_id = v_quote_id;
  v_gst_amount := round(v_subtotal * v_gst_percent / 100, 2);

  update public.quotes
  set subtotal = v_subtotal,
      total_margin_amount = v_profit,
      total_before_gst = v_subtotal,
      gst_amount = v_gst_amount,
      grand_total = v_subtotal + v_gst_amount,
      low_margin_approval_required = v_low_margin,
      estimated_profit_amount = v_profit,
      estimated_profit_percent = case when v_subtotal > 0 then round(v_profit / v_subtotal * 100, 2) else 0 end,
      updated_at = now()
  where id = v_quote_id and company_id = v_company_id;

  return v_quote_id;
end;
$function$


-- FN private.save_ready_dispatch_atomic
CREATE OR REPLACE FUNCTION private.save_ready_dispatch_atomic(p_dispatch_id uuid, p_dispatch jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_current record;
  v_payload jsonb := p_dispatch;
  v_dispatch_id uuid;
  v_tare_weight numeric := round(coalesce(nullif(p_dispatch ->> 'total_tare_weight_kg', '')::numeric, 0), 3);
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied for dispatches' using errcode = '42501';
  end if;
  if v_tare_weight < 0 then raise exception 'Total tare weight cannot be negative'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A dispatch requires at least one physical bundle';
  end if;
  if p_dispatch_id is null then
    v_payload := v_payload || jsonb_build_object('delivery_status', 'pending');
  else
    select order_id, delivery_status into v_current from public.dispatches
    where id = p_dispatch_id and company_id = v_company_id for update;
    if not found then raise exception 'Dispatch not found for this company'; end if;
    if v_current.delivery_status <> 'pending' then raise exception 'Activated dispatch packing cannot be edited; use the delivery workflow for status and logistics updates'; end if;
    if nullif(v_payload ->> 'order_id', '')::uuid <> v_current.order_id then raise exception 'Dispatch order cannot be changed after creation'; end if;
    v_payload := v_payload || jsonb_build_object('delivery_status', v_current.delivery_status);
  end if;

  v_payload := v_payload || jsonb_build_object('number_of_bundles', jsonb_array_length(p_items));
  v_dispatch_id := private.save_dispatch_atomic(p_dispatch_id, v_payload, p_items, null);
  update public.dispatches set total_tare_weight_kg = v_tare_weight, updated_at = now()
  where id = v_dispatch_id and company_id = v_company_id;
  insert into private.dispatch_activation_authorizations(dispatch_id, transaction_id)
  values (v_dispatch_id, txid_current());
  update public.dispatches set delivery_status = 'dispatched', updated_at = now()
  where id = v_dispatch_id and company_id = v_company_id;
  perform private.assert_dispatch_ready(v_dispatch_id);
  perform private.consume_dispatch_reservations(v_dispatch_id);
  perform private.assert_dispatch_ready(v_dispatch_id);
  perform private.sync_order_delivery_stage(v_company_id, nullif(v_payload ->> 'order_id', '')::uuid,
    'Dispatch created from exact physical bundles and source-linked stock.');
  return v_dispatch_id;
end;
$function$


-- FN private.set_actual_dispatch_activation
CREATE OR REPLACE FUNCTION private.set_actual_dispatch_activation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.delivery_status <> 'pending' or new.actual_dispatched_at is not null then
      raise exception 'Dispatches must be created pending; actual activation time is database recorded';
    end if;
    return new;
  end if;
  if new.actual_dispatched_at is distinct from old.actual_dispatched_at then raise exception 'Actual dispatch activation time is immutable'; end if;
  if old.delivery_status = 'pending' and new.delivery_status = 'dispatched' then
    perform 1 from private.dispatch_activation_authorizations
    where dispatch_id = old.id and transaction_id = txid_current()
    for update;
    if not found then raise exception 'Dispatch activation must use the verified stock posting workflow' using errcode = '42501'; end if;
    delete from private.dispatch_activation_authorizations
    where dispatch_id = old.id and transaction_id = txid_current();
    perform private.assert_dispatch_ready(old.id);
    perform private.assert_dispatch_source_units(old.id);
    new.actual_dispatched_at := clock_timestamp();
  end if;
  return new;
end;
$function$


-- FN private.set_expense_approval_state
CREATE OR REPLACE FUNCTION private.set_expense_approval_state(p_expense_id uuid, p_company_id uuid, p_status text, p_note text, p_approved boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  perform set_config('extrusionos.expense_approval_transition', 'on', true);
  update public.expense_ledger
  set approval_status = p_status,
      approved_by = case when p_approved then auth.uid() else null end,
      approved_at = case when p_approved then now() else null end,
      approval_note = coalesce(p_note, approval_note),
      updated_by = auth.uid()
  where id = p_expense_id and company_id = p_company_id;
  perform set_config('extrusionos.expense_approval_transition', '', true);
end;
$function$


-- FN private.snapshot_invoice_parties
CREATE OR REPLACE FUNCTION private.snapshot_invoice_parties()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if tg_op='INSERT' then
    select jsonb_build_object('name',name,'legal_name',legal_name,'gst_number',gst_number,'billing_address',billing_address) into new.supplier_snapshot from public.companies where id=new.company_id;
    select jsonb_build_object('customer_name',customer_name,'company_name',company_name,'gst_number',gst_number,'billing_address',billing_address,'shipping_address',shipping_address) into new.customer_snapshot from public.customers where id=new.customer_id and company_id=new.company_id;
    if new.supplier_snapshot is null or new.customer_snapshot is null then raise exception 'Invoice parties must belong to the authenticated company'; end if;
  elsif old.supplier_snapshot is distinct from new.supplier_snapshot or old.customer_snapshot is distinct from new.customer_snapshot or old.company_id is distinct from new.company_id or old.customer_id is distinct from new.customer_id then
    raise exception 'Invoice party snapshots and identities are immutable';
  end if;
  return new;
end;
$function$


-- FN private.sync_order_delivery_stage
CREATE OR REPLACE FUNCTION private.sync_order_delivery_stage(p_company_id uuid, p_order_id uuid, p_remarks text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
$function$


-- FN private.transition_dealer_order_atomic
CREATE OR REPLACE FUNCTION private.transition_dealer_order_atomic(p_dealer_order_id uuid, p_status text, p_factory_committed_date date, p_clarification_required boolean, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_user_id uuid := auth.uid();
  v_role text := private.get_current_user_role();
  v_current public.dealer_orders%rowtype;
  v_next_status text := p_status;
  v_dealer_admin_id uuid;
begin
  if v_company_id is null or v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_dealer_id() is not null
     or v_role not in ('owner','admin','factory_manager','production_manager','sales_manager','sales') then
    raise exception 'Only authorized factory users can update dealer order workflow' using errcode = '42501';
  end if;

  select * into v_current
  from public.dealer_orders
  where id = p_dealer_order_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Dealer order not found for this company' using errcode = '23514'; end if;

  if p_clarification_required then
    v_next_status := 'rejected_by_factory';
  end if;
  if v_next_status is null then v_next_status := v_current.status; end if;
  if v_next_status not in ('dealer_order_submitted','accepted_by_factory','rejected_by_factory','material_reserved','production_scheduled','in_production','production_completed','quality_check_pending','quality_check_passed','packed','dispatched','in_transit','delivered_to_dealer','pending_dealer_count','received_confirmed','discrepancy_reported','recount_requested','discrepancy_resolved','closed','cancelled') then
    raise exception 'Invalid dealer order workflow status' using errcode = '23514';
  end if;

  if v_next_status <> v_current.status and not (
    (v_current.status = 'dealer_order_submitted' and v_next_status in ('accepted_by_factory','rejected_by_factory','cancelled'))
    or (v_current.status = 'rejected_by_factory' and v_next_status in ('dealer_order_submitted','cancelled'))
    or (v_current.status = 'accepted_by_factory' and v_next_status in ('material_reserved','rejected_by_factory','cancelled'))
    or (v_current.status = 'material_reserved' and v_next_status in ('production_scheduled','cancelled'))
    or (v_current.status = 'production_scheduled' and v_next_status in ('in_production','cancelled'))
    or (v_current.status = 'in_production' and v_next_status in ('production_completed','cancelled'))
    or (v_current.status = 'production_completed' and v_next_status = 'quality_check_pending')
    or (v_current.status = 'quality_check_pending' and v_next_status = 'quality_check_passed')
    or (v_current.status = 'quality_check_passed' and v_next_status = 'packed')
    or (v_current.status = 'packed' and v_next_status = 'dispatched')
    or (v_current.status = 'dispatched' and v_next_status = 'in_transit')
    or (v_current.status = 'in_transit' and v_next_status = 'delivered_to_dealer')
    or (v_current.status = 'delivered_to_dealer' and v_next_status = 'pending_dealer_count')
    or (v_current.status = 'pending_dealer_count' and v_next_status in ('received_confirmed','discrepancy_reported'))
    or (v_current.status = 'discrepancy_reported' and v_next_status = 'recount_requested')
    or (v_current.status = 'recount_requested' and v_next_status = 'discrepancy_resolved')
    or (v_current.status = 'discrepancy_resolved' and v_next_status = 'closed')
    or (v_current.status = 'received_confirmed' and v_next_status = 'closed')
  ) then
    raise exception 'Illegal dealer order transition from % to %', v_current.status, v_next_status using errcode = '23514';
  end if;

  update public.dealer_orders
  set status = v_next_status,
      last_factory_update_at = now(),
      factory_committed_date = case when p_factory_committed_date is null then factory_committed_date else p_factory_committed_date end,
      accepted_by = case when v_next_status = 'accepted_by_factory' then v_user_id else accepted_by end,
      accepted_at = case when v_next_status = 'accepted_by_factory' then now() else accepted_at end,
      rejection_reason = case when p_clarification_required then nullif(btrim(p_notes), '') else rejection_reason end,
      clarification_required_at = case when p_clarification_required then now() else clarification_required_at end,
      clarification_resolved_at = case when p_clarification_required = false and v_current.status = 'rejected_by_factory' then now() else clarification_resolved_at end,
      updated_at = now()
  where id = v_current.id and company_id = v_company_id;

  insert into public.dealer_order_status_history (
    company_id, dealer_order_id, previous_status, new_status, changed_by, notes
  ) values (v_company_id, v_current.id, v_current.status, v_next_status, v_user_id, p_notes);

  if p_clarification_required then
    select id into v_dealer_admin_id from public.app_users
    where company_id = v_company_id and dealer_id = v_current.dealer_id
      and role = 'dealer_admin' and is_active = true limit 1;
    insert into public.tasks (
      company_id, dealership_id, task_type, title, description, priority, status,
      assigned_to, related_entity_type, related_entity_id, created_by, assigned_by_user_id, due_date
    ) values (
      v_company_id, v_current.dealer_id, 'dealer_order_clarification',
      'Clarify ' || v_current.order_number,
      coalesce(nullif(btrim(p_notes), ''), 'Factory needs clarification before proceeding.'),
      'urgent', 'open', v_dealer_admin_id, 'dealer_order', v_current.id,
      v_user_id, v_user_id, current_date
    );
  end if;

  insert into public.notifications (
    company_id, dealer_id, recipient_role, notification_type, severity, title,
    body, related_entity_type, related_entity_id, entity_reference, action_link, created_by
  ) values (
    v_company_id, v_current.dealer_id, 'dealer_admin',
    case when p_clarification_required then 'dealer_order_clarification_required' else 'dealer_order_status_changed' end,
    case when p_clarification_required then 'warning' else 'info' end,
    case when p_clarification_required then 'Factory needs clarification' else 'Dealer order status updated' end,
    case when p_clarification_required then v_current.order_number || ': ' || coalesce(nullif(btrim(p_notes), ''), 'Please clarify order details.')
         else v_current.order_number || ' is now ' || replace(v_next_status, '_', ' ') end,
    'dealer_order', v_current.id, v_current.order_number, '/dealer-orders/' || v_current.id::text, v_user_id
  );

  insert into public.audit_logs_enterprise (
    company_id, actor_user_id, actor_role, actor_company_id,
    action_type, module_name, entity_type, entity_id, previous_value, new_value, change_summary
  ) values (
    v_company_id, v_user_id, v_role, v_company_id, 'dealer_order_status_updated',
    'dealer_orders', 'dealer_order', v_current.id,
    jsonb_build_object('status', v_current.status),
    jsonb_build_object('status', v_next_status, 'factoryCommittedDate', p_factory_committed_date, 'clarificationRequired', p_clarification_required),
    v_current.order_number || ' moved to ' || replace(v_next_status, '_', ' ')
  );

  return jsonb_build_object('id', v_current.id, 'order_number', v_current.order_number, 'status', v_next_status);
end;
$function$


-- FN private.transition_dispatch_delivery_atomic
CREATE OR REPLACE FUNCTION private.transition_dispatch_delivery_atomic(p_dispatch_id uuid, p_status text, p_proof_of_delivery_url text, p_remarks text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_dispatch public.dispatches%rowtype;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied for dispatches' using errcode = '42501';
  end if;
  select * into v_dispatch from public.dispatches where id = p_dispatch_id and company_id = v_company_id for update;
  if not found then raise exception 'Dispatch not found for this company'; end if;
  if v_dispatch.delivery_status = 'pending' and p_status = 'dispatched' then
    insert into private.dispatch_activation_authorizations(dispatch_id, transaction_id)
    values (v_dispatch.id, txid_current());
  end if;
  update public.dispatches set delivery_status = p_status,
    proof_of_delivery_url = case when nullif(btrim(coalesce(p_proof_of_delivery_url, '')), '') is not null
      then btrim(p_proof_of_delivery_url) else proof_of_delivery_url end,
    remarks = case when nullif(btrim(coalesce(p_remarks, '')), '') is not null then btrim(p_remarks) else remarks end,
    updated_at = now()
  where id = v_dispatch.id and company_id = v_company_id;
  if v_dispatch.delivery_status = 'pending' and p_status = 'dispatched' then
    perform private.consume_dispatch_reservations(v_dispatch.id);
    perform private.sync_order_delivery_stage(v_company_id, v_dispatch.order_id, 'Dispatch activated from verified packing.');
  end if;
  return v_dispatch.order_id;
end;
$function$


-- FN private.transition_expense_approval
CREATE OR REPLACE FUNCTION private.transition_expense_approval(p_expense_id uuid, p_action text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_expense public.expense_ledger%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_next text;
  v_approved boolean := false;
  v_finance_limit boolean;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for expense approvals' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('submit', 'approve', 'reject', 'reopen', 'cancel') then
    raise exception 'Unsupported expense approval action' using errcode = '22023';
  end if;

  select * into v_expense from public.expense_ledger
  where id = p_expense_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Expense not found for this company'; end if;
  if v_expense.deleted_at is not null then raise exception 'Deleted expenses cannot change approval state'; end if;
  -- Accounts may decide expenses up to the threshold; larger ones need owner or admin.
  v_finance_limit := v_role in ('owner', 'admin') or v_expense.total_amount <= private.expense_approval_threshold();

  if p_action = 'submit' then
    if v_expense.approval_status not in ('draft', 'rejected') then
      raise exception 'Only draft or rejected expenses can be submitted';
    end if;
    if v_expense.total_amount <= 0 then raise exception 'Expense total must be greater than zero before submission'; end if;
    if v_expense.total_amount <= private.expense_approval_threshold() then
      v_next := 'approved';
      v_approved := true;
    else
      v_next := 'pending_approval';
    end if;
  elsif p_action = 'approve' then
    if v_expense.approval_status <> 'pending_approval' then raise exception 'Only expenses pending approval can be approved'; end if;
    if not v_finance_limit then
      raise exception 'Expenses above Rs 25,000 need owner or admin approval' using errcode = '42501';
    end if;
    v_next := 'approved';
    v_approved := true;
  elsif p_action = 'reject' then
    if v_expense.approval_status <> 'pending_approval' then raise exception 'Only expenses pending approval can be rejected'; end if;
    if not v_finance_limit then
      raise exception 'Expenses above Rs 25,000 need owner or admin review' using errcode = '42501';
    end if;
    if length(coalesce(v_note, '')) < 5 then raise exception 'Enter a clear rejection reason'; end if;
    v_next := 'rejected';
  elsif p_action = 'reopen' then
    if v_role not in ('owner', 'admin') then
      raise exception 'Only an owner or admin can reopen an approved expense' using errcode = '42501';
    end if;
    if v_expense.approval_status <> 'approved' then raise exception 'Only approved expenses can be reopened'; end if;
    if length(coalesce(v_note, '')) < 5 then raise exception 'Enter a clear reason for reopening this approved expense'; end if;
    if v_expense.amount_paid > 0 or v_expense.credited_amount > 0 or v_expense.refunded_amount > 0 then
      raise exception 'Reverse posted supplier payments and credits before reopening this expense';
    end if;
    v_next := case when v_expense.source_table is null then 'draft' else 'pending_approval' end;
  else
    if v_expense.source_table is not null then
      raise exception 'Cancel a source-linked expense by cancelling or deleting its source record';
    end if;
    if v_expense.approval_status not in ('draft', 'pending_approval', 'rejected', 'approved') then
      raise exception 'This expense cannot be cancelled from its current state';
    end if;
    if not v_finance_limit then
      raise exception 'Expenses above Rs 25,000 need an owner or admin to cancel them' using errcode = '42501';
    end if;
    if length(coalesce(v_note, '')) < 5 then raise exception 'Enter a clear cancellation reason'; end if;
    if v_expense.amount_paid - v_expense.refunded_amount > 0 then
      raise exception 'Reverse posted supplier payments or record the supplier refund before cancelling this expense';
    end if;
    v_next := 'cancelled';
  end if;

  perform private.set_expense_approval_state(v_expense.id, v_company_id, v_next, v_note, v_approved);

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (v_company_id, auth.uid(), 'expense_approval_' || p_action, 'expense_ledger', v_expense.id,
    jsonb_build_object('expense_number', v_expense.expense_number, 'from', v_expense.approval_status,
      'to', v_next, 'note', v_note, 'total_amount', v_expense.total_amount));

  return jsonb_build_object('expense_id', v_expense.id, 'approval_status', v_next);
end;
$function$


-- FN private.transition_finishing_job_atomic
CREATE OR REPLACE FUNCTION private.transition_finishing_job_atomic(p_job_id uuid, p_status text, p_vendor_id uuid, p_sent_date date, p_received_date date, p_output_weight_kg numeric, p_rejection_weight_kg numeric, p_remarks text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_job public.finishing_jobs%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in (
    'owner', 'admin', 'factory_manager', 'production_manager', 'production'
  ) then
    raise exception 'Permission denied for finishing updates' using errcode = '42501';
  end if;
  if p_status not in (
    'planned', 'sent_to_vendor', 'in_process', 'received', 'rejected', 'completed'
  ) then
    raise exception 'Unsupported finishing status';
  end if;

  select * into v_job
  from public.finishing_jobs
  where id = p_job_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Finishing job not found for this company';
  end if;

  if p_vendor_id is not null and not exists (
    select 1 from public.vendors
    where id = p_vendor_id and company_id = v_company_id
  ) then
    raise exception 'Selected vendor is not available for this company';
  end if;

  update public.finishing_jobs
  set status = p_status,
      vendor_id = coalesce(p_vendor_id, v_job.vendor_id),
      -- Keep a recorded movement date when a retry or completion omits it.
      sent_date = coalesce(p_sent_date, v_job.sent_date,
        case when p_status = 'sent_to_vendor' then current_date end),
      received_date = coalesce(p_received_date, v_job.received_date,
        case when p_status in ('received', 'completed') then current_date end),
      output_weight_kg = coalesce(p_output_weight_kg, v_job.output_weight_kg),
      rejection_weight_kg = coalesce(p_rejection_weight_kg, v_job.rejection_weight_kg),
      remarks = case
        when p_remarks is null then v_job.remarks
        else nullif(btrim(p_remarks), '')
      end,
      updated_at = now()
  where id = p_job_id and company_id = v_company_id;

  return p_job_id;
end;
$function$


-- FN private.transition_production_job_atomic
CREATE OR REPLACE FUNCTION private.transition_production_job_atomic(p_job_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_job public.production_jobs%rowtype;
  v_has_released_slot boolean;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager','production') then raise exception 'Permission denied to transition production jobs' using errcode = '42501'; end if;
  if p_status not in ('planned','ready','in_progress','on_hold','cancelled') then raise exception 'Use the completion workflow for completed production jobs' using errcode = '23514'; end if;
  select * into v_job from public.production_jobs where id = p_job_id and company_id = v_company_id for update;
  if not found then raise exception 'Production job not found for this company' using errcode = '23514'; end if;
  if p_status = v_job.status then return v_job.id; end if;
  if not ((v_job.status = 'planned' and p_status in ('on_hold','cancelled'))
    or (v_job.status = 'ready' and p_status in ('in_progress','on_hold','cancelled'))
    or (v_job.status = 'in_progress' and p_status = 'on_hold')
    or (v_job.status = 'on_hold' and p_status in ('in_progress','cancelled'))) then
    raise exception 'Illegal production status transition from % to %', v_job.status, p_status using errcode = '23514';
  end if;
  if p_status in ('in_progress','on_hold') and v_job.machine_id is null then raise exception 'Assign an extrusion press before starting or holding production' using errcode = '23514'; end if;
  if p_status = 'in_progress' then
    select exists (select 1 from public.production_plan_slots slot where slot.company_id = v_company_id
      and slot.production_job_id = v_job.id and slot.machine_id = v_job.machine_id and slot.status = 'released') into v_has_released_slot;
    if not v_has_released_slot then raise exception 'Production job requires a released press slot before it can start' using errcode = '23514'; end if;
  end if;
  update public.production_jobs set status = p_status,
    remarks = case when nullif(btrim(p_reason),'') is null then remarks when nullif(btrim(remarks),'') is null then btrim(p_reason) else remarks || E'\n' || btrim(p_reason) end,
    updated_at = now()
  where id = v_job.id and company_id = v_company_id;
  insert into public.production_job_status_history(company_id, production_job_id, previous_status, new_status, reason, changed_by, changed_by_role)
  values (v_company_id, v_job.id, v_job.status, p_status, nullif(btrim(p_reason),''), auth.uid(), v_role);
  return v_job.id;
end;
$function$


-- FN private.update_jsonb_row
CREATE OR REPLACE FUNCTION private.update_jsonb_row(p_table regclass, p_id uuid, p_company_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_assignments text;
  v_id uuid;
begin
  select string_agg(format('%1$I = r.%1$I', a.attname), ', ' order by a.attnum)
  into v_assignments
  from pg_attribute a
  where a.attrelid = p_table
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and a.attidentity = ''
    and a.attname not in ('id', 'company_id', 'created_at', 'created_by')
    and p_payload ? a.attname;

  if v_assignments is null then
    raise exception 'No writable fields were supplied';
  end if;

  execute format(
    'update %s t set %s from jsonb_populate_record(null::%s, $1) r where t.id = $2 and t.company_id = $3 returning t.id',
    p_table, v_assignments, p_table
  ) using p_payload, p_id, p_company_id into v_id;

  if v_id is null then
    raise exception 'Record not found for this company';
  end if;
  return v_id;
end;
$function$


-- FN private.update_versioned_entity_atomic
CREATE OR REPLACE FUNCTION private.update_versioned_entity_atomic(p_entity_type text, p_entity_id uuid, p_payload jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_table regclass;
  v_prior_state jsonb;
  v_revision integer;
  v_allowed_fields text[];
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_entity_type = 'die' then
    if v_role not in ('owner','admin','sales_manager','production_manager') then raise exception 'Permission denied for dies' using errcode = '42501'; end if;
    v_table := 'public.dies'::regclass;
    v_allowed_fields := array[
      'die_number','die_code','internal_die_reference','customer_die_reference','profile_id','customer_id',
      'ownership_type','die_status','die_type','number_of_cavities','number_of_holes','die_class',
      'application_category','end_use_industry','press_compatibility','priority_level','die_diameter_mm',
      'die_thickness_mm','die_stack_height_mm','backer_diameter_mm','bolster_diameter_mm','bearing_length_mm',
      'entry_angle_degrees','relief_angle_degrees','tongue_ratio','extrusion_ratio','ccd_mm','output_per_stroke_kg',
      'feeder_plate_details','mandrel_details','bridge_details','porthole_details','welding_chamber_details',
      'bearing_corrections','pocketing_details','choke_details','drawing_revision','drawing_approval_status',
      'die_steel_grade','die_vendor_id','purchase_order_reference','manufacturing_date','receipt_date',
      'heat_treatment_status','hardness_before_nitriding','hardness_after_nitriding','hrc_value','hv_value',
      'dimensional_inspection_status','performance_grade','die_blocked_reason','die_retirement_reason',
      'storage_bin','billet_diameter_required_inch','rack_location','total_production_kg','total_runs',
      'last_used_date','die_manufacturer','die_cost','purchase_date','correction_history','drawing_url','notes'
    ];
  elsif p_entity_type = 'profile' then
    if v_role not in ('owner','admin') then raise exception 'Permission denied for profiles' using errcode = '42501'; end if;
    v_table := 'public.aluminium_profiles'::regclass;
    v_allowed_fields := array[
      'profile_code','profile_name','section_number','internal_profile_reference','customer_profile_reference',
      'application_category','product_family','system_type','end_use_industry','section_weight_kg_per_m',
      'actual_weight_kg_per_m','weight_tolerance_percent','alloy','temper','recommended_alloy',
      'temper_requirement','tensile_strength_mpa','yield_strength_mpa','elongation_percent','finish_options',
      'standard_length_m','min_cutting_length_m','max_cutting_length_m','billet_diameter_required_inch',
      'hsn_code','section_perimeter_mm','circumscribing_circle_diameter_mm','nominal_wall_thickness_mm',
      'min_wall_thickness_mm','max_wall_thickness_mm','critical_wall_thickness_mm','profile_classification',
      'number_of_voids','complexity_rating','tolerance_class','bundle_quantity','pieces_per_bundle',
      'meter_per_bundle','kg_per_bundle','surface_area_per_meter_sqm','powder_coating_area_sqm',
      'anodizing_area_sqm','scrap_factor_percent','recovery_target_percent','min_acceptable_recovery_percent',
      'recommended_press','billet_alloy','billet_temperature_range','container_temperature_range',
      'die_temperature_range','ram_speed_range','exit_temperature_range','puller_speed_range','quench_method',
      'stretching_requirement','aging_requirement','cutting_instructions','handling_instructions',
      'special_production_notes','mill_finish_allowed','powder_coating_allowed','anodizing_allowed',
      'wood_finish_allowed','pvdf_allowed','special_finish_allowed','coating_thickness_microns',
      'anodizing_micron_requirement','pre_treatment_requirement','base_rate_per_kg','minimum_order_quantity_kg',
      'packing_cost_per_kg','production_cost_per_kg','energy_cost_per_kg','primary_die_id','backup_die_id',
      'drawing_revision','drawing_approval_status','approval_status','drawing_url','cross_section_image_url',
      'image_url','notes','is_active'
    ];
  else
    raise exception 'Unsupported versioned entity type';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':' || p_entity_type || ':' || p_entity_id::text, 0));
  execute format('select to_jsonb(t) from %s t where t.id = $1 and t.company_id = $2 for update', v_table)
    using p_entity_id, v_company_id into v_prior_state;
  if v_prior_state is null then raise exception 'Record not found or access denied'; end if;

  select coalesce(max(revision_number), 0) + 1 into v_revision
  from public.entity_revisions
  where company_id = v_company_id and entity_type = p_entity_type and entity_id = p_entity_id;
  insert into public.entity_revisions (
    company_id, entity_type, entity_id, revision_number, prior_state, actor_id
  ) values (
    v_company_id, p_entity_type, p_entity_id, v_revision, v_prior_state, auth.uid()
  );
  perform private.update_jsonb_row(
    v_table,
    p_entity_id,
    v_company_id,
    private.keep_jsonb_keys(p_payload, v_allowed_fields)
      || jsonb_build_object('updated_at', now())
  );
  return v_revision;
end;
$function$


-- FN private.validate_production_job_source_line
CREATE OR REPLACE FUNCTION private.validate_production_job_source_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order_line public.order_items%rowtype;
  v_has_order_lines boolean;
  v_requires_billets boolean;
begin
  if tg_op = 'UPDATE'
     and old.status not in ('planned', 'ready')
     and (
       old.order_id is distinct from new.order_id
       or old.profile_id is distinct from new.profile_id
       or old.source_line_id is distinct from new.source_line_id
     ) then
    raise exception 'Production lineage cannot change after the job leaves planning'
      using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.order_items item
    where item.company_id = new.company_id
      and item.order_id = new.order_id
  ) into v_has_order_lines;

  if v_has_order_lines and new.source_line_id is null then
    raise exception 'Select the exact order line before planning production'
      using errcode = '23514';
  end if;

  if new.source_line_id is not null then
    select * into v_order_line
    from public.order_items item
    where item.id = new.source_line_id
      and item.company_id = new.company_id
      and item.order_id = new.order_id;

    if not found or v_order_line.profile_id is distinct from new.profile_id then
      raise exception 'Production source line must belong to the selected order and profile'
        using errcode = '23514';
    end if;
  end if;

  new.source_record_id := new.order_id;

  if new.status = 'in_progress'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select exists (
      select 1
      from public.order_billet_requirements requirement
      where requirement.company_id = new.company_id
        and requirement.order_id = new.order_id
        and requirement.profile_id = new.profile_id
        and requirement.status <> 'cancelled'
        and requirement.billets_required > 0
    ) into v_requires_billets;

    if v_requires_billets and not exists (
      select 1
      from public.foundry_billets billet
      where billet.company_id = new.company_id
        and billet.order_id = new.order_id
        and billet.production_job_id = new.id
        and billet.status in ('issued', 'consumed')
    ) then
      raise exception 'Link at least one allocated billet before starting production'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$


-- FN private.validate_production_slot_release_resources
CREATE OR REPLACE FUNCTION private.validate_production_slot_release_resources()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_job public.production_jobs%rowtype;
  v_order public.orders%rowtype;
  v_die public.dies%rowtype;
  v_machine public.machines%rowtype;
begin
  if (tg_op = 'UPDATE' and old.status = 'released') or new.status <> 'released' then return new; end if;
  select * into v_job from public.production_jobs where id = new.production_job_id and company_id = new.company_id for update nowait;
  if not found or v_job.status not in ('planned','ready','on_hold') or v_job.die_id is null then
    raise exception 'Production job is no longer eligible for press release' using errcode = '23514';
  end if;
  select * into v_order from public.orders where id = v_job.order_id and company_id = new.company_id for update nowait;
  if not found or v_order.current_stage in ('closed','cancelled','delivered','payment_pending')
    or (v_order.current_stage = 'dispatched' and not private.order_job_has_remaining_production(new.company_id, v_job.order_id, v_job.id)) then
    raise exception 'Order is no longer eligible for press release' using errcode = '23514';
  end if;
  select * into v_die from public.dies where id = v_job.die_id and company_id = new.company_id for update nowait;
  if not found or v_die.profile_id is distinct from v_job.profile_id or v_die.die_status not in ('active','approved') then
    raise exception 'Assigned die is no longer eligible for press release' using errcode = '23514';
  end if;
  select * into v_machine from public.machines where id = new.machine_id and company_id = new.company_id for update nowait;
  if not found or v_machine.machine_type <> 'extrusion_press' or v_machine.is_active is distinct from true
    or v_machine.status not in ('active','operational','idle') then
    raise exception 'Selected extrusion press is no longer eligible for release' using errcode = '23514';
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Production resource is being changed; retry release after refresh' using errcode = '55P03';
end;
$function$


-- FN private.validate_production_start_resources
CREATE OR REPLACE FUNCTION private.validate_production_start_resources()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order public.orders%rowtype;
  v_die public.dies%rowtype;
  v_machine public.machines%rowtype;
  v_slot public.production_plan_slots%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'planned' then
      raise exception 'Production jobs must be created as planned and started through the current resource-release workflow' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.status is distinct from 'in_progress' or old.status = 'in_progress' then return new; end if;
  select * into v_order from public.orders where id = new.order_id and company_id = new.company_id for update nowait;
  if not found or v_order.current_stage in ('closed','cancelled','delivered','payment_pending') then
    raise exception 'Order is no longer eligible for production start' using errcode = '23514';
  end if;
  select * into v_die from public.dies where id = new.die_id and company_id = new.company_id for update nowait;
  if not found or v_die.profile_id is distinct from new.profile_id or v_die.die_status not in ('active','approved') then
    raise exception 'Assigned die is no longer eligible for production start' using errcode = '23514';
  end if;
  select * into v_machine from public.machines where id = new.machine_id and company_id = new.company_id for update nowait;
  if not found or v_machine.machine_type <> 'extrusion_press' or v_machine.is_active is distinct from true
    or v_machine.status not in ('active','operational','idle') then
    raise exception 'Assigned extrusion press is no longer eligible for production start' using errcode = '23514';
  end if;
  select * into v_slot from public.production_plan_slots
  where company_id = new.company_id and production_job_id = new.id and machine_id = new.machine_id and status = 'released'
  for update nowait;
  if not found then raise exception 'Production job requires its currently released press slot before start' using errcode = '23514'; end if;
  return new;
exception when lock_not_available then
  raise exception 'Production resource is being changed; retry the start after refresh' using errcode = '55P03';
end;
$function$


-- FN public.reallocate_billet_to_order
CREATE OR REPLACE FUNCTION public.reallocate_billet_to_order(p_billet_id uuid, p_order_id uuid)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'public', 'private'
AS $function$
  select private.reallocate_billet_to_order(p_billet_id, p_order_id);
$function$


-- FN public.rebuild_order_billet_requirements
CREATE OR REPLACE FUNCTION public.rebuild_order_billet_requirements(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order record;
  v_quote_total numeric;
  v_target_weight numeric;
  v_group record;
  v_required_weight numeric;
  v_billet_weight numeric;
  v_required_count integer;
begin
  if exists(select 1 from private.direct_order_requests where order_id=p_order_id) then
    perform private.rebuild_direct_order_billet_requirements(p_order_id);
    return;
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then return; end if;

  delete from public.order_billet_requirements r
  where r.company_id = v_order.company_id
    and r.order_id = v_order.id
    and not exists (
      select 1 from public.foundry_billets b
      where b.company_id = r.company_id and b.allocation_requirement_id = r.id and b.status in ('allocated','issued','consumed')
    );

  if v_order.current_stage in ('closed','cancelled') then
    update public.order_billet_requirements set status = 'cancelled' where company_id = v_order.company_id and order_id = v_order.id;
    perform public.refresh_order_billet_allocations(v_order.id);
    return;
  end if;

  if v_order.quote_id is not null then
    select round(coalesce(sum(coalesce(qi.billing_weight_kg, qi.total_weight_kg, 0)), 0)::numeric, 3)
    into v_quote_total
    from public.quote_items qi
    where qi.company_id = v_order.company_id and qi.quote_id = v_order.quote_id and qi.profile_id is not null;

    v_target_weight := coalesce(nullif(v_order.manufacturing_weight_kg, 0), nullif(v_order.production_quantity_kg, 0), v_quote_total, 0);

    for v_group in
      select qi.profile_id,
             nullif(p.alloy, '') as alloy,
             nullif(p.temper, '') as temper,
             coalesce(v_order.billet_diameter_required_inch, d.billet_diameter_required_inch, p.billet_diameter_required_inch) as billet_diameter_inch,
             round(sum(coalesce(qi.billing_weight_kg, qi.total_weight_kg, 0))::numeric, 3) as group_weight
      from public.quote_items qi
      join public.aluminium_profiles p on p.id = qi.profile_id and p.company_id = qi.company_id
      left join public.dies d on d.id = coalesce(qi.die_id, v_order.production_die_id) and d.company_id = qi.company_id
      where qi.company_id = v_order.company_id and qi.quote_id = v_order.quote_id and qi.profile_id is not null
      group by qi.profile_id, nullif(p.alloy, ''), nullif(p.temper, ''), coalesce(v_order.billet_diameter_required_inch, d.billet_diameter_required_inch, p.billet_diameter_required_inch)
    loop
      v_required_weight := case when coalesce(v_quote_total, 0) > 0 then round((v_group.group_weight * v_target_weight / v_quote_total)::numeric, 3) else 0 end;
      v_billet_weight := round((pi() * power(((v_group.billet_diameter_inch * 25.4) / 2000), 2) * (5800 / 1000.0) * 2700)::numeric, 3);
      v_required_count := case when v_required_weight > 0 and v_billet_weight > 0 then greatest(1, ceil((v_required_weight / 0.75) / v_billet_weight)::integer) else 0 end;

      insert into public.order_billet_requirements(company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billet_length_mm, required_weight_kg, billet_weight_kg, billets_required, extrusion_efficiency_percent)
      values (v_order.company_id, v_order.id, v_group.profile_id, v_group.alloy, v_group.temper, v_group.billet_diameter_inch, 5800, v_required_weight, v_billet_weight, v_required_count, 75)
      on conflict (company_id, order_id, profile_id, alloy, temper, billet_diameter_inch) do update set
        required_weight_kg = excluded.required_weight_kg,
        billet_weight_kg = excluded.billet_weight_kg,
        billets_required = excluded.billets_required,
        extrusion_efficiency_percent = 75,
        status = case when public.order_billet_requirements.status = 'cancelled' then 'pending' else public.order_billet_requirements.status end,
        updated_at = now();
    end loop;
  elsif v_order.production_profile_id is not null and coalesce(v_order.production_quantity_kg, v_order.manufacturing_weight_kg, 0) > 0 then
    select coalesce(v_order.production_quantity_kg, v_order.manufacturing_weight_kg, 0) into v_required_weight;
    for v_group in
      select p.id as profile_id,
             nullif(p.alloy, '') as alloy,
             nullif(p.temper, '') as temper,
             coalesce(v_order.billet_diameter_required_inch, d.billet_diameter_required_inch, p.billet_diameter_required_inch) as billet_diameter_inch
      from public.aluminium_profiles p
      left join public.dies d on d.id = v_order.production_die_id and d.company_id = p.company_id
      where p.id = v_order.production_profile_id and p.company_id = v_order.company_id
    loop
      v_billet_weight := round((pi() * power(((v_group.billet_diameter_inch * 25.4) / 2000), 2) * (5800 / 1000.0) * 2700)::numeric, 3);
      v_required_count := case when v_required_weight > 0 and v_billet_weight > 0 then greatest(1, ceil((v_required_weight / 0.75) / v_billet_weight)::integer) else 0 end;
      insert into public.order_billet_requirements(company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billet_length_mm, required_weight_kg, billet_weight_kg, billets_required, extrusion_efficiency_percent)
      values (v_order.company_id, v_order.id, v_group.profile_id, v_group.alloy, v_group.temper, v_group.billet_diameter_inch, 5800, v_required_weight, v_billet_weight, v_required_count, 75)
      on conflict (company_id, order_id, profile_id, alloy, temper, billet_diameter_inch) do update set
        required_weight_kg = excluded.required_weight_kg,
        billet_weight_kg = excluded.billet_weight_kg,
        billets_required = excluded.billets_required,
        extrusion_efficiency_percent = 75,
        updated_at = now();
    end loop;
  end if;

  with surplus as (
    select b.id,
           row_number() over (partition by b.allocation_requirement_id order by b.allocated_at desc nulls last, b.created_at desc) as allocation_rank,
           r.billets_required
    from public.foundry_billets b
    join public.order_billet_requirements r on r.id = b.allocation_requirement_id and r.company_id = b.company_id
    where r.company_id = v_order.company_id
      and r.order_id = v_order.id
      and b.status = 'allocated'
  )
  update public.foundry_billets b
  set order_id = null,
      allocation_requirement_id = null,
      status = 'cast',
      allocated_at = null,
      allocated_by = null,
      updated_at = now()
  from surplus s
  where b.id = s.id and s.allocation_rank > s.billets_required;

  perform public.refresh_order_billet_allocations(v_order.id);
end;
$function$


-- FN public.recalculate_quote_item_financials
CREATE OR REPLACE FUNCTION public.recalculate_quote_item_financials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total_meters numeric := round(greatest(coalesce(new.quantity_pieces, 0), 0) * greatest(coalesce(new.length_per_piece_m, 0), 0), 3);
  v_total_weight numeric;
  v_effective_weight numeric;
  v_billing_weight numeric;
  v_raw_material numeric;
  v_conversion numeric;
  v_finishing numeric;
  v_die_amortization numeric;
  v_line_subtotal numeric;
  v_margin numeric;
  v_calculated_total numeric;
  v_line_total numeric;
begin
  if coalesce(new.expected_recovery_percent, 100) <= 0 or coalesce(new.expected_recovery_percent, 100) > 100 then
    raise exception 'Recovery must be above zero and at most 100 percent';
  end if;
  if coalesce(new.margin_percent, 0) < 0 or coalesce(new.margin_percent, 0) >= 100 then
    raise exception 'Margin on selling price must be below 100 percent';
  end if;
  select section_perimeter_mm, nullif(hsn_code, '') into new.perimeter_mm, new.hsn_code
  from public.aluminium_profiles where id = new.profile_id and company_id = new.company_id;
  new.surface_area_sqft := v_total_meters * greatest(coalesce(new.perimeter_mm, 0), 0) / 1000 * 10.76391041671;
  new.costing_complete := new.finishing_charge_type <> 'per_sqft' or new.surface_area_sqft > 0;
  if new.gst_percent is null then
    select gst_percent into new.gst_percent from public.quotes where id = new.quote_id and company_id = new.company_id;
  end if;
  if new.gst_percent is null or new.gst_percent < 0 or new.gst_percent > 100 then raise exception 'Invalid line GST rate'; end if;
  v_total_weight := round(v_total_meters * greatest(coalesce(new.section_weight_kg_per_m, 0), 0), 3);
  v_effective_weight := round(v_total_weight * (1 + greatest(coalesce(new.scrap_allowance_percent, 0), 0) / 100), 3);
  v_billing_weight := round(greatest(v_effective_weight, greatest(coalesce(new.minimum_billing_weight_kg, 0), 0)), 3);
  new.billet_input_kg := round(v_billing_weight / (coalesce(new.expected_recovery_percent, 100) / 100), 3);
  v_raw_material := round(v_billing_weight / (coalesce(new.expected_recovery_percent, 100) / 100) * greatest(coalesce(new.billet_rate_per_kg, 0), 0), 2);
  v_conversion := round(v_billing_weight * greatest(coalesce(new.conversion_charge_per_kg, 0), 0), 2);

  v_finishing := case new.finishing_charge_type
    when 'per_kg' then round(v_billing_weight * greatest(coalesce(new.finishing_charge, 0), 0), 2)
    when 'per_meter' then round(v_total_meters * greatest(coalesce(new.finishing_charge, 0), 0), 2)
    when 'fixed' then round(greatest(coalesce(new.finishing_charge, 0), 0), 2)
    when 'per_sqft' then round(new.surface_area_sqft * greatest(coalesce(new.finishing_charge, 0), 0), 2)
    else 0
  end;

  v_die_amortization := case new.die_amortization_type
    when 'waived' then 0
    when 'customer_paid' then 0
    when 'per_kg' then case when greatest(coalesce(new.die_amortization_quantity_kg, 0), 0) > 0
      then round(greatest(coalesce(new.die_charge, 0), 0) / new.die_amortization_quantity_kg * v_billing_weight, 2)
      else 0 end
    else round(greatest(coalesce(new.die_charge, 0), 0), 2)
  end;

  v_line_subtotal := round(
    v_raw_material + v_conversion + v_finishing + v_die_amortization
      + greatest(coalesce(new.packing_charge, 0), 0)
      + greatest(coalesce(new.transport_charge, 0), 0)
      + greatest(coalesce(new.other_charges, 0), 0), 2
  );
  v_calculated_total := round(v_line_subtotal / (1 - coalesce(new.margin_percent, 0) / 100), 2);
  v_margin := v_calculated_total - v_line_subtotal;
  new.sales_price_override := case
    when coalesce(new.sales_price_override, 0) > 0 then round(new.sales_price_override, 2)
    else null
  end;
  v_line_total := coalesce(new.sales_price_override, v_calculated_total);

  new.total_meters := v_total_meters;
  new.total_weight_kg := v_total_weight;
  new.effective_weight_kg := v_effective_weight;
  new.billing_weight_kg := v_billing_weight;
  new.raw_material_cost := v_raw_material;
  new.conversion_cost := v_conversion;
  new.finishing_cost := v_finishing;
  new.die_amortization_amount := v_die_amortization;
  new.line_subtotal := v_line_subtotal;
  new.margin_amount := v_margin;
  new.line_total_before_gst := v_line_total;
  new.estimated_profit_amount := round(v_line_total - v_line_subtotal, 2);
  new.estimated_profit_percent := case when v_line_total > 0
    then round((new.estimated_profit_amount / v_line_total) * 100, 2) else 0 end;
  new.approval_required := new.estimated_profit_percent < greatest(coalesce(new.minimum_margin_percent, 0), 0)
    or new.estimated_profit_amount < 0;
  new.price_per_kg := case when v_billing_weight > 0 then round(v_line_total / v_billing_weight, 2) else 0 end;
  new.price_per_meter := case when v_total_meters > 0 then round(v_line_total / v_total_meters, 2) else 0 end;
  -- PCDA money fields are line totals except net_rate (per billed kg).
  new.quantity_kg := v_billing_weight;
  new.material_price := v_raw_material;
  new.value_added_service_price := v_conversion + v_finishing;
  new.basic_price := v_raw_material + v_conversion + v_finishing + greatest(coalesce(new.other_charges, 0), 0);
  new.freight_charge := greatest(coalesce(new.transport_charge, 0), 0);
  new.die_service_charge := v_die_amortization;
  new.packing_in_conversion := true;
  new.include_packing_in_basic := false;
  new.margin := new.estimated_profit_amount;
  new.net_rate := new.price_per_kg;
  new.final_line_value := v_line_total;
  new.internal_cost := v_line_subtotal;
  return new;
end;
$function$


-- FN public.reconcile_foundry_billet_count
CREATE OR REPLACE FUNCTION public.reconcile_foundry_billet_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (
    select 1 from public.foundry_billets
    where foundry_batch_id = new.id and company_id = new.company_id
      and billet_number > new.billet_count
      and status in ('allocated', 'issued', 'consumed')
  ) then
    raise exception 'Cannot reduce billet count: billets beyond the new count are already allocated, issued, or consumed';
  end if;
  delete from public.foundry_billets
  where foundry_batch_id = new.id and company_id = new.company_id
    and billet_number > new.billet_count
    and status not in ('allocated', 'issued', 'consumed');
  return new;
end;
$function$


-- FN public.record_current_login_event
CREATE OR REPLACE FUNCTION public.record_current_login_event(p_event_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
  actor_company_id uuid;
begin
  if actor_id is null or auth.role() <> 'authenticated' then
    raise exception 'Authentication required';
  end if;

  if p_event_type not in ('login_success', 'logout', 'password_reset') then
    raise exception 'Unsupported login event type';
  end if;

  select company_id into actor_company_id
  from public.app_users
  where id = actor_id and is_active = true;

  if actor_company_id is null then
    return;
  end if;

  insert into public.login_events (company_id, user_id, event_type)
  values (actor_company_id, actor_id, p_event_type);
end;
$function$


-- FN public.record_customer_refund_atomic
CREATE OR REPLACE FUNCTION public.record_customer_refund_atomic(p_invoice_id uuid, p_refund jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.record_customer_refund_atomic(p_invoice_id, p_refund, p_idempotency_key) $function$


-- FN public.record_dispatch_status_change
CREATE OR REPLACE FUNCTION public.record_dispatch_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
$function$


-- FN public.record_enterprise_audit
CREATE OR REPLACE FUNCTION public.record_enterprise_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company_id uuid;
  v_entity_id uuid;
  v_action text;
begin
  if TG_OP = 'DELETE' then
    v_company_id := old.company_id;
    v_entity_id := old.id;
  else
    v_company_id := new.company_id;
    v_entity_id := new.id;
  end if;

  if v_company_id is not null then
    v_action := lower(TG_OP) || '_' || TG_TABLE_NAME;
    insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (
      v_company_id,
      auth.uid(),
      v_action,
      TG_TABLE_NAME,
      v_entity_id,
      jsonb_build_object('table', TG_TABLE_NAME, 'operation', TG_OP, 'schema', TG_TABLE_SCHEMA)
    );
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
exception when others then
  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$


-- FN public.record_expense_payment_atomic
CREATE OR REPLACE FUNCTION public.record_expense_payment_atomic(p_expense_id uuid, p_payment jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.record_expense_payment_atomic(p_expense_id, p_payment, p_idempotency_key) $function$


-- FN public.record_expense_supplier_credit_atomic
CREATE OR REPLACE FUNCTION public.record_expense_supplier_credit_atomic(p_expense_id uuid, p_credit jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.record_expense_supplier_credit_atomic(p_expense_id, p_credit, p_idempotency_key) $function$


-- FN public.record_payment_atomic
CREATE OR REPLACE FUNCTION public.record_payment_atomic(p_invoice_id uuid, p_payment jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.record_payment_atomic(p_invoice_id, p_payment) $function$


-- FN public.refresh_foundry_batch_calculations
CREATE OR REPLACE FUNCTION public.refresh_foundry_batch_calculations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.furnace_number := coalesce(nullif(trim(new.furnace_number), ''), nullif(trim(new.furnace_name), ''));
  new.furnace_name := coalesce(nullif(trim(new.furnace_name), ''), new.furnace_number);
  new.batch_sequence := coalesce(new.batch_sequence, 1);
  new.furnace_efficiency_percent := coalesce(nullif(new.furnace_efficiency_percent, 0), 80);
  new.scrap_percentage := coalesce(new.scrap_percentage, 0);
  new.external_aluminium_percentage := coalesce(new.external_aluminium_percentage, 100 - new.scrap_percentage);
  new.billet_diameter_inch := coalesce(new.billet_diameter_inch, round((new.billet_diameter_mm / 25.4)::numeric, 2));
  new.billet_diameter_mm := round((new.billet_diameter_inch * 25.4)::numeric, 2);
  new.billet_weight_density_kg := round((pi() * power((new.billet_diameter_mm / 2000), 2) * (new.billet_length_mm / 1000) * new.alloy_density_kg_m3)::numeric, 3);
  new.total_billet_weight_density_kg := round((new.billet_weight_density_kg * new.billet_count)::numeric, 3);
  new.required_furnace_charge_kg := case
    when coalesce(new.total_billet_weight_density_kg, 0) > 0 then round((new.total_billet_weight_density_kg / (new.furnace_efficiency_percent / 100))::numeric, 3)
    else 0
  end;
  new.scrap_aluminium_kg := round((new.required_furnace_charge_kg * new.scrap_percentage / 100)::numeric, 3);
  new.external_aluminium_kg := round((new.required_furnace_charge_kg * new.external_aluminium_percentage / 100)::numeric, 3);
  new.ingot_kg := new.external_aluminium_kg;
  new.alloy_composition_default := coalesce(new.alloy_composition_default, '{}'::jsonb);
  new.alloy_composition_actual := coalesce(new.alloy_composition_actual, new.alloy_composition_default, '{}'::jsonb);
  new.alloy_composition_altered := coalesce(new.alloy_composition_altered, new.alloy_composition_actual is distinct from new.alloy_composition_default);
  -- Batch identity is allocated once by aa_assign_business_number.
  return new;
end;
$function$


-- FN public.refresh_order_billet_allocations
CREATE OR REPLACE FUNCTION public.refresh_order_billet_allocations(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_req record;
  v_total_required integer := 0;
  v_total_allocated integer := 0;
  v_total_short integer := 0;
  v_status text := 'not_required';
begin
  select id, company_id into v_order from public.orders where id = p_order_id;
  if v_order.id is null then return; end if;

  perform public.repair_order_billet_requirement_links(p_order_id);

  update public.foundry_billets
  set order_id = null,
      allocation_requirement_id = null,
      allocated_at = null,
      allocated_by = null,
      updated_at = now()
  where company_id = v_order.company_id
    and order_id = p_order_id
    and status = 'cancelled';

  for v_req in
    select r.id, r.billets_required, r.status as old_status,
      count(b.id)::integer as allocated_count
    from public.order_billet_requirements r
    left join public.foundry_billets b on b.company_id = r.company_id and b.allocation_requirement_id = r.id and b.order_id = r.order_id and b.status in ('allocated','issued','consumed')
    where r.company_id = v_order.company_id and r.order_id = p_order_id
    group by r.id, r.billets_required, r.status
  loop
    update public.order_billet_requirements
    set billets_allocated = least(v_req.allocated_count, v_req.billets_required),
        billets_short = greatest(v_req.billets_required - v_req.allocated_count, 0),
        status = case
          when v_req.billets_required <= 0 then 'not_required'
          when v_req.allocated_count <= 0 then 'shortage'
          when v_req.allocated_count < v_req.billets_required then 'partial'
          else 'complete'
        end
    where id = v_req.id;
  end loop;

  select coalesce(sum(billets_required), 0)::integer,
         coalesce(sum(billets_allocated), 0)::integer,
         coalesce(sum(billets_short), 0)::integer
  into v_total_required, v_total_allocated, v_total_short
  from public.order_billet_requirements
  where company_id = v_order.company_id and order_id = p_order_id and status <> 'cancelled';

  v_status := case
    when v_total_required <= 0 then 'not_required'
    when v_total_allocated <= 0 then 'shortage'
    when v_total_allocated < v_total_required then 'partial'
    when v_total_short > 0 then 'partial'
    else 'complete'
  end;

  update public.orders
  set billets_required = v_total_required,
      billets_allocated = v_total_allocated,
      billets_short = v_total_short,
      billet_allocation_status = v_status
  where id = p_order_id and company_id = v_order.company_id;

  update public.orders
  set current_stage = 'billet_ready'
  where id = p_order_id
    and company_id = v_order.company_id
    and v_status = 'complete'
    and current_stage in ('order_confirmed','die_ready');
end;
$function$


-- FN public.refresh_packaging_job_material
CREATE OR REPLACE FUNCTION public.refresh_packaging_job_material()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_method text;
  v_rate numeric;
  v_stock numeric;
begin
  if coalesce(new.profile_length_m,0)=0 and new.production_job_id is not null then
    if new.finishing_job_id is not null then
      select coalesce(nullif(new.profile_length_m,0),coalesce(nullif(j.actual_meters,0),coalesce(j.length_per_piece_m,0)*coalesce(nullif(j.actual_pieces,0),j.pieces,0))*coalesce(nullif(new.profile_weight_kg,0),f.output_weight_kg)/nullif(j.actual_quantity_kg,0)),
        coalesce(nullif(new.profile_weight_kg,0),f.output_weight_kg),
        coalesce(nullif(new.pieces,0),round(coalesce(nullif(j.actual_pieces,0),j.pieces,0)*coalesce(nullif(new.profile_weight_kg,0),f.output_weight_kg)/nullif(j.actual_quantity_kg,0))::integer)
      into new.profile_length_m,new.profile_weight_kg,new.pieces from public.production_jobs j
      join public.finishing_jobs f on f.id=new.finishing_job_id and f.company_id=j.company_id and f.production_job_id=j.id
      where j.id=new.production_job_id and j.company_id=new.company_id;
      if not found then raise exception 'Accepted finishing receipt is unavailable for packaging'; end if;
    else
      select coalesce(length_per_piece_m,0)*coalesce(pieces,0),coalesce(actual_quantity_kg,planned_quantity_kg,0),coalesce(pieces,0)
      into new.profile_length_m,new.profile_weight_kg,new.pieces from public.production_jobs
      where id=new.production_job_id and company_id=new.company_id;
    end if;
  end if;
  -- Later schemas issue multiple materials through their own movement trigger.
  if not (to_jsonb(new) ? 'material_id') then return new; end if;

  if new.material_id is null then
    new.material_quantity_required := 0;
    return new;
  end if;

  select calculation_method, consumption_rate, current_stock
  into v_method, v_rate, v_stock
  from public.packaging_materials
  where id = new.material_id and company_id = new.company_id and is_active = true;

  if not found then
    raise exception 'Active packaging material not found for this company' using errcode = '23503';
  end if;

  new.material_quantity_required := round((case v_method
    when 'per_piece' then coalesce(new.pieces, 0) * v_rate
    when 'per_kg' then coalesce(new.profile_weight_kg, 0) * v_rate
    when 'fixed' then v_rate
    else coalesce(new.profile_length_m, 0) * v_rate
  end)::numeric, 3);

  if tg_op = 'INSERT' and new.status <> 'cancelled' and v_stock < new.material_quantity_required then
    raise exception 'Not enough packaging material stock' using errcode = '23514';
  end if;

  return new;
end;
$function$


-- FN public.refresh_production_billet_requirement
CREATE OR REPLACE FUNCTION public.refresh_production_billet_requirement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_billet_weight numeric;
begin
  select avg(weight_kg) into v_billet_weight
  from public.foundry_billets
  where company_id = new.company_id and order_id = new.order_id and status in ('allocated','issued');

  if coalesce(v_billet_weight, 0) > 0 and coalesce(new.planned_quantity_kg, 0) > 0 then
    new.required_billet_count := greatest(1, ceil((new.planned_quantity_kg / (new.extrusion_efficiency_percent / 100)) / v_billet_weight)::integer);
  end if;
  return new;
end;
$function$


-- FN public.release_factory_loads_atomic
CREATE OR REPLACE FUNCTION public.release_factory_loads_atomic(p_queue_ids uuid[], p_group_code text, p_override boolean, p_reason text)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'public', 'private'
AS $function$ select private.release_factory_loads_atomic(p_queue_ids, p_group_code, p_override, p_reason) $function$


-- FN public.release_production_schedule_slot_atomic
CREATE OR REPLACE FUNCTION public.release_production_schedule_slot_atomic(p_slot_id uuid)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.release_production_schedule_slot_atomic(p_slot_id) $function$


-- FN public.repair_order_billet_requirement_links
CREATE OR REPLACE FUNCTION public.repair_order_billet_requirement_links(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_order record;
  v_req record;
  v_billet record;
  v_needed integer;
  v_updated integer;
begin
  select id,company_id into v_order from public.orders where id=p_order_id;
  if v_order.id is null then return;end if;
  if exists(select 1 from public.foundry_billets b join public.order_billet_requirements r on r.id=b.allocation_requirement_id
    where r.company_id=v_order.company_id and r.order_id=v_order.id and r.status<>'cancelled'
      and b.status in ('allocated','issued','consumed')
      and (b.company_id is distinct from r.company_id or b.order_id is distinct from r.order_id
        or lower(btrim(coalesce(b.alloy,'')))<>lower(btrim(coalesce(r.alloy,'')))
        or lower(btrim(coalesce(b.temper,'')))<>lower(btrim(coalesce(r.temper,'')))
        or b.billet_diameter_inch is distinct from r.billet_diameter_inch
        or (b.production_job_id is not null and not exists(select 1 from public.production_jobs j
          where j.id=b.production_job_id and j.company_id=r.company_id and j.order_id=r.order_id and j.profile_id=r.profile_id)))) then
    raise exception 'Existing billet links are inconsistent; review historical allocation evidence before repair' using errcode='23514';
  end if;
  for v_req in
    select r.id,r.profile_id,r.alloy,r.temper,r.billet_diameter_inch,r.billets_required
    from public.order_billet_requirements r
    where r.company_id=v_order.company_id and r.order_id=v_order.id and r.status<>'cancelled'
    order by r.created_at,r.id
  loop
    -- The stored counter may be stale before refresh; retained links are the evidence.
    select greatest(v_req.billets_required-count(*)::integer,0) into v_needed
    from public.foundry_billets
    where company_id=v_order.company_id and order_id=v_order.id and allocation_requirement_id=v_req.id
      and status in ('allocated','issued','consumed');
    if v_needed<=0 then continue;end if;
    for v_billet in
      select b.id from public.foundry_billets b
      where b.company_id=v_order.company_id and b.order_id=v_order.id and b.allocation_requirement_id is null
        and b.status in ('allocated','issued','consumed')
        and lower(btrim(coalesce(b.alloy,'')))=lower(btrim(coalesce(v_req.alloy,'')))
        and lower(btrim(coalesce(b.temper,'')))=lower(btrim(coalesce(v_req.temper,'')))
        and b.billet_diameter_inch=v_req.billet_diameter_inch
        and (b.production_job_id is null or exists(select 1 from public.production_jobs j where j.id=b.production_job_id
          and j.company_id=v_order.company_id and j.order_id=v_order.id and j.profile_id=v_req.profile_id))
      order by b.allocated_at nulls last,b.created_at,b.billet_code,b.id
      for update skip locked
    loop
      exit when v_needed<=0;
      update public.foundry_billets set allocation_requirement_id=v_req.id,updated_at=now()
      where id=v_billet.id and company_id=v_order.company_id and order_id=v_order.id
        and allocation_requirement_id is null and status in ('allocated','issued','consumed');
      get diagnostics v_updated=row_count;
      v_needed:=v_needed-v_updated;
    end loop;
  end loop;
end;
$function$


-- FN public.replace_invoice_items_atomic
CREATE OR REPLACE FUNCTION public.replace_invoice_items_atomic(p_invoice_id uuid, p_items jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$select private.replace_invoice_items_atomic(p_invoice_id,p_items)$function$


-- FN public.replace_profile_quality_plan_atomic
CREATE OR REPLACE FUNCTION public.replace_profile_quality_plan_atomic(p_profile_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.replace_profile_quality_plan_atomic(p_profile_id, p_items) $function$


-- FN public.replace_profile_routing_atomic
CREATE OR REPLACE FUNCTION public.replace_profile_routing_atomic(p_profile_id uuid, p_steps jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.replace_profile_routing_atomic(p_profile_id, p_steps) $function$


-- FN public.resolve_quality_rework_atomic
CREATE OR REPLACE FUNCTION public.resolve_quality_rework_atomic(p_inspection_id uuid, p_approved_weight_kg numeric, p_rejected_weight_kg numeric, p_inspector_name text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_source public.quality_inspections%rowtype;
  v_resolution_id uuid;
  v_children integer;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','quality_manager','quality') then raise exception 'Permission denied to resolve quality rework' using errcode='42501'; end if;
  if coalesce(p_approved_weight_kg,0)<0 or coalesce(p_rejected_weight_kg,0)<0 or length(btrim(coalesce(p_reason,'')))<8 or length(btrim(coalesce(p_inspector_name,'')))=0 then
    raise exception 'Enter non-negative approved/rejected kilograms, inspector name, and a reason of at least eight characters';
  end if;
  select * into v_source from public.quality_inspections where id=p_inspection_id and company_id=v_company_id and status='rework' for update;
  if not found then raise exception 'Open rework inspection not found'; end if;
  if round(p_approved_weight_kg + p_rejected_weight_kg,3) <> round(v_source.quantity_checked_kg,3) then
    raise exception 'Approved and rejected kilograms must exactly equal the original rework quantity';
  end if;
  if exists(select 1 from public.quality_rework_resolutions where company_id=v_company_id and source_inspection_id=v_source.id) then raise exception 'This rework inspection is already resolved'; end if;
  insert into public.quality_rework_resolutions(company_id,source_inspection_id,production_job_id,finishing_job_id,profile_id,
    source_quantity_kg,approved_weight_kg,rejected_weight_kg,reason,inspector_name,resolved_by)
  values(v_company_id,v_source.id,v_source.production_job_id,v_source.finishing_job_id,v_source.profile_id,
    v_source.quantity_checked_kg,round(p_approved_weight_kg,3),round(p_rejected_weight_kg,3),btrim(p_reason),btrim(p_inspector_name),auth.uid())
  returning id into v_resolution_id;
  v_children := (case when p_approved_weight_kg > 0 then 1 else 0 end) + (case when p_rejected_weight_kg > 0 then 1 else 0 end);
  insert into private.quality_resolution_authorizations(transaction_id,resolution_id,actor_id,children_remaining)
  values(txid_current(),v_resolution_id,auth.uid(),v_children);
  if p_approved_weight_kg > 0 then
    insert into public.quality_inspections(company_id,production_job_id,finishing_job_id,profile_id,inspection_date,batch_number,
      quantity_checked_kg,status,inspector_name,surface_finish_ok,notes,resolution_id)
    values(v_company_id,v_source.production_job_id,v_source.finishing_job_id,v_source.profile_id,now(),v_source.batch_number,
      round(p_approved_weight_kg,3),'approved',btrim(p_inspector_name),true,'Approved by linked immutable rework resolution '||v_resolution_id::text,v_resolution_id);
  end if;
  if p_rejected_weight_kg > 0 then
    insert into public.quality_inspections(company_id,production_job_id,finishing_job_id,profile_id,inspection_date,batch_number,
      quantity_checked_kg,status,inspector_name,surface_finish_ok,notes,resolution_id)
    values(v_company_id,v_source.production_job_id,v_source.finishing_job_id,v_source.profile_id,now(),v_source.batch_number,
      round(p_rejected_weight_kg,3),'rejected',btrim(p_inspector_name),false,'Rejected by linked immutable rework resolution '||v_resolution_id::text,v_resolution_id);
  end if;
  delete from private.quality_resolution_authorizations where transaction_id=txid_current() and resolution_id=v_resolution_id and children_remaining=0;
  return v_resolution_id;
end;
$function$


-- FN public.retry_rejected_finishing_job_atomic
CREATE OR REPLACE FUNCTION public.retry_rejected_finishing_job_atomic(p_rejected_job_id uuid, p_planned_date date DEFAULT NULL::date, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select private.retry_rejected_finishing_job_atomic(
    p_rejected_job_id, p_planned_date, p_remarks
  )
$function$


-- FN public.reverse_credit_note_atomic
CREATE OR REPLACE FUNCTION public.reverse_credit_note_atomic(p_credit_note_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.reverse_credit_note_atomic(p_credit_note_id, p_reason) $function$


-- FN public.reverse_expense_payment_atomic
CREATE OR REPLACE FUNCTION public.reverse_expense_payment_atomic(p_payment_id uuid, p_reason text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.reverse_expense_payment_atomic(p_payment_id, p_reason, p_idempotency_key) $function$


-- FN public.reverse_expense_supplier_credit_atomic
CREATE OR REPLACE FUNCTION public.reverse_expense_supplier_credit_atomic(p_credit_id uuid, p_reason text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.reverse_expense_supplier_credit_atomic(p_credit_id, p_reason, p_idempotency_key) $function$


-- FN public.reverse_payment_atomic
CREATE OR REPLACE FUNCTION public.reverse_payment_atomic(p_payment_id uuid, p_reason text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.reverse_payment_atomic(p_payment_id, p_reason, p_idempotency_key) $function$


-- FN public.route_completed_finishing_to_packaging
CREATE OR REPLACE FUNCTION public.route_completed_finishing_to_packaging()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_job public.production_jobs%rowtype;v_number text;
begin
  if new.status in ('completed','rejected') and coalesce(new.output_weight_kg,0)>0
    and (tg_op='INSERT' or old.status is distinct from new.status) then
    perform private.assert_finishing_material_lineage(new.company_id,new.production_job_id);
    if exists(select 1 from public.packaging_jobs where company_id=new.company_id and production_job_id=new.production_job_id
      and finishing_job_id is null and status<>'cancelled') then
      raise exception 'Existing packaging has no finishing receipt link; review its source before finalizing another receipt';
    end if;
    if exists(select 1 from public.packaging_jobs where company_id=new.company_id and finishing_job_id=new.id) then return new; end if;
    select * into v_job from public.production_jobs where id=new.production_job_id and company_id=new.company_id;
    v_number:=private.next_business_number_locked('public.packaging_jobs'::regclass,'packaging_number',new.company_id,'PKG',current_date);
    insert into public.packaging_jobs(company_id,packaging_number,order_id,production_job_id,finishing_job_id,scheduled_date,pieces,
      profile_weight_kg,profile_length_m,status,notes,created_by)
    values(new.company_id,v_number,new.order_id,new.production_job_id,new.id,current_date,
      round(coalesce(nullif(v_job.actual_pieces,0),v_job.pieces,0)*new.output_weight_kg/v_job.actual_quantity_kg)::integer,
      new.output_weight_kg,
      coalesce(nullif(v_job.actual_meters,0),coalesce(v_job.length_per_piece_m,0)*coalesce(nullif(v_job.actual_pieces,0),v_job.pieces,0))*new.output_weight_kg/v_job.actual_quantity_kg,
      'scheduled','Accepted finishing portion. Verify packing quantities and complete QC/material release.',auth.uid());
    perform private.advance_order_stage(new.company_id,new.order_id,'finishing',
      concat('Finishing receipt retained ',new.output_weight_kg,' kg accepted output; rejected material remains separate.'));
  end if;
  return new;
end;
$function$


-- FN public.save_dispatch_atomic
CREATE OR REPLACE FUNCTION public.save_dispatch_atomic(p_dispatch_id uuid, p_dispatch jsonb, p_items jsonb, p_order_stage text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.save_dispatch_atomic(p_dispatch_id, p_dispatch, p_items, p_order_stage) $function$


-- FN public.save_invoice_atomic
CREATE OR REPLACE FUNCTION public.save_invoice_atomic(p_invoice_id uuid, p_invoice jsonb, p_items jsonb, p_replace_items boolean)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$select private.save_invoice_atomic(p_invoice_id,p_invoice,p_items,p_replace_items)$function$


-- FN public.save_manual_expense_atomic
CREATE OR REPLACE FUNCTION public.save_manual_expense_atomic(p_expense_id uuid, p_payload jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.save_manual_expense_atomic(p_expense_id, p_payload, p_idempotency_key) $function$


-- FN public.save_order_atomic
CREATE OR REPLACE FUNCTION public.save_order_atomic(p_order_id uuid, p_order jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.save_order_atomic(p_order_id, p_order) $function$


-- FN public.save_packaging_job_atomic
CREATE OR REPLACE FUNCTION public.save_packaging_job_atomic(p_job_id uuid, p_job jsonb, p_materials jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.save_packaging_job_atomic(p_job_id, p_job, p_materials) $function$


-- FN public.save_production_job_atomic
CREATE OR REPLACE FUNCTION public.save_production_job_atomic(p_job_id uuid, p_job jsonb, p_billet_ids uuid[])
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.save_production_job_atomic(p_job_id, p_job, p_billet_ids) $function$


-- FN public.save_production_schedule_slot_atomic
CREATE OR REPLACE FUNCTION public.save_production_schedule_slot_atomic(p_slot_id uuid, p_slot jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.save_production_schedule_slot_atomic(p_slot_id, p_slot) $function$


-- FN public.save_quote_atomic
CREATE OR REPLACE FUNCTION public.save_quote_atomic(p_quote_id uuid, p_quote jsonb, p_items jsonb, p_expected_revision integer, p_expected_updated_at timestamp with time zone, p_revision_reason text)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'public', 'private'
AS $function$
  select private.save_quote_atomic(
    p_quote_id, p_quote, p_items, p_expected_revision, p_expected_updated_at, p_revision_reason
  )
$function$


-- FN public.save_ready_dispatch_atomic
CREATE OR REPLACE FUNCTION public.save_ready_dispatch_atomic(p_dispatch_id uuid, p_dispatch jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.save_ready_dispatch_atomic(p_dispatch_id, p_dispatch, p_items) $function$


-- FN public.save_system_configuration_atomic
CREATE OR REPLACE FUNCTION public.save_system_configuration_atomic(p_configuration_id uuid, p_mode text, p_expected_updated_at timestamp with time zone, p_header jsonb, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  c public.system_configurations%rowtype;
  t text;
  r jsonb;
  h jsonb;
begin
  if auth.uid() is null or v_company is null then
    raise exception 'Permission denied' using errcode='42501';
  end if;
  if p_mode='calculation' and v_role not in ('owner','admin') then
    raise exception 'Only owners and admins may calculate internal system costing' using errcode='42501';
  end if;
  if p_mode='draft' and v_role not in ('owner','admin','sales_manager') then
    raise exception 'Permission denied' using errcode='42501';
  end if;
  if p_mode not in ('draft','calculation') or p_mode is null then
    raise exception 'Invalid save mode';
  end if;

  select * into c from public.system_configurations
  where id=p_configuration_id and company_id=v_company for update;
  if not found then raise exception 'Configuration not found'; end if;
  if c.order_id is not null or c.quote_id is not null or c.status::text in ('in_production','converted_to_order') then
    raise exception 'Linked configurations are immutable; create a new configuration for revisions';
  end if;
  if p_mode='calculation' and (p_expected_updated_at is null or p_expected_updated_at is distinct from c.updated_at) then
    raise exception 'Configuration changed; reload and calculate again';
  end if;
  if p_mode='draft' then
    h := private.keep_jsonb_keys(p_header,array['project_name','customer_id','system_type','series_id','template_id','design_reference','location_label','width_mm','height_mm','quantity','no_of_panels','measurement_type','view_direction','panel_layout_json','options_json','finish_id','glass_id','notes'])
      || jsonb_build_object('status','draft','subtotal',0,'gst_amount',0,'grand_total',0,'internal_cost',0,'selling_price',0);
  else
    if coalesce(p_header->>'status','') not in ('draft','calculated') then raise exception 'Invalid calculation status'; end if;
    h := private.keep_jsonb_keys(p_header,array['status','subtotal','gst_amount','grand_total','internal_cost','selling_price','margin_percent','gst_percent']);
  end if;
  foreach t in array array['system_profile_cuts','system_glass_cuts','system_beading_cuts','system_hardware_bom','system_material_summary','profile_optimization_runs'] loop
    execute format('delete from public.%I where configuration_id=$1 and company_id=$2',t) using c.id,v_company;
    if p_mode='calculation' and t <> 'profile_optimization_runs' then
      if jsonb_typeof(p_rows->t) is distinct from 'array' then raise exception 'Every calculation collection must be supplied'; end if;
      for r in select value from jsonb_array_elements(p_rows->t) loop
        perform private.insert_jsonb_row(('public.'||t)::regclass, (r - array['id','created_at','created_by']) || jsonb_build_object('company_id',v_company,'configuration_id',c.id));
      end loop;
    end if;
  end loop;
  perform private.update_jsonb_row('public.system_configurations'::regclass,c.id,v_company,h || jsonb_build_object('updated_at',clock_timestamp()));
end;
$function$


-- FN public.seed_default_roles_for_company
CREATE OR REPLACE FUNCTION public.seed_default_roles_for_company(target_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  role_record record;
begin
  for role_record in select * from (values
    ('owner','Super Admin / Owner','Full system access', array['view_quotes','create_quotes','edit_quotes','delete_quotes','approve_quotes','view_orders','create_orders','edit_orders','cancel_orders','approve_orders','view_inventory','edit_inventory','adjust_inventory','approve_inventory_adjustments','view_dealer_inventory','edit_dealer_inventory','receive_dealer_inventory','view_factory_inventory','manage_shipments','manage_users','manage_roles','view_audit_logs','export_reports','manage_company_settings']),
    ('admin','Admin','Full operational access except critical company settings', array['view_quotes','create_quotes','edit_quotes','delete_quotes','approve_quotes','view_orders','create_orders','edit_orders','cancel_orders','approve_orders','view_inventory','edit_inventory','adjust_inventory','view_dealer_inventory','edit_dealer_inventory','receive_dealer_inventory','view_factory_inventory','manage_shipments','manage_users','manage_roles','view_audit_logs','export_reports']),
    ('sales','Sales Team','Customer, quote, and order access', array['view_quotes','create_quotes','edit_quotes','view_orders','create_orders','view_inventory']),
    ('factory_manager','Factory Manager','Production and dispatch operations', array['view_orders','edit_orders','view_inventory','edit_inventory','view_factory_inventory','manage_shipments']),
    ('inventory_manager','Inventory Manager','Factory stock and approved adjustments', array['view_inventory','edit_inventory','adjust_inventory','view_factory_inventory','manage_shipments']),
    ('dealer_admin','Dealer Admin','Dealer quotes, orders, and dealer inventory control', array['view_quotes','create_quotes','edit_quotes','view_orders','create_orders','edit_orders','view_inventory','edit_inventory','adjust_inventory','view_dealer_inventory','edit_dealer_inventory','receive_dealer_inventory']),
    ('dealer_staff','Dealer Staff','Dealer quotes, orders, inventory updates, and receipt counting', array['view_quotes','create_quotes','view_orders','create_orders','view_inventory','edit_inventory','view_dealer_inventory','edit_dealer_inventory','receive_dealer_inventory']),
    ('accounts','Accountant / Finance','Invoices, payments, ledgers, and reports', array['view_orders','view_quotes','export_reports']),
    ('viewer','Read-Only / Auditor','Selected read-only access and audit logs', array['view_quotes','view_orders','view_inventory','view_dealer_inventory','view_audit_logs'])
  ) as t(role_key, name, description, permissions)
  loop
    insert into public.roles(company_id, role_key, name, description, is_system)
    values (target_company_id, role_record.role_key, role_record.name, role_record.description, true)
    on conflict (company_id, role_key) do update set name = excluded.name, description = excluded.description, is_system = true;

    insert into public.role_permissions(role_id, permission_key)
    select r.id, unnest(role_record.permissions::text[]) from public.roles r where r.company_id = target_company_id and r.role_key = role_record.role_key
    on conflict do nothing;
  end loop;
end;
$function$


-- FN public.set_order_production_pieces_from_quote
CREATE OR REPLACE FUNCTION public.set_order_production_pieces_from_quote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.quote_id is not null and new.production_pieces is null then
    select sum(quantity_pieces)::integer
    into new.production_pieces
    from public.quote_items
    where quote_id = new.quote_id
      and company_id = new.company_id;
  end if;

  return new;
end;
$function$


-- FN public.set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$


-- FN public.submit_dealer_receipt_atomic
CREATE OR REPLACE FUNCTION public.submit_dealer_receipt_atomic(p_shipment_id uuid, p_dealer_id uuid, p_dealer_order_id uuid, p_notes text, p_lines jsonb, p_ip_address text, p_user_agent text, p_device_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company_id uuid := public.get_current_user_company_id();
  v_user_id uuid := auth.uid();
  v_user_dealer_id uuid := public.get_current_user_dealer_id();
  v_shipment public.shipments%rowtype;
  v_existing public.dealer_receipts%rowtype;
  v_normalized_lines jsonb;
  v_request_payload jsonb;
  v_result jsonb;
begin
  if v_user_id is null or v_company_id is null then
    raise exception 'Authentication context is required';
  end if;
  if v_user_dealer_id is null or v_user_dealer_id <> p_dealer_id then
    raise exception 'Dealer ownership does not match the authenticated user';
  end if;
  if not public.current_user_has_permission('receive_dealer_inventory') then
    raise exception 'Permission denied for dealer receipt';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Receipt lines are required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'shipment_item_id', coalesce(line->>'shipment_item_id', line->>'shipmentItemId')::uuid,
      'expected_quantity', coalesce(line->>'expected_quantity', line->>'expectedQuantity')::numeric,
      'reported_received_quantity', coalesce(line->>'reported_received_quantity', line->>'reportedReceivedQuantity')::numeric,
      'inventory_item_id', coalesce(line->>'inventory_item_id', line->>'inventoryItemId')::uuid,
      'unit', line->>'unit',
      'notes', nullif(btrim(coalesce(line->>'notes', '')), '')
    ) order by coalesce(line->>'shipment_item_id', line->>'shipmentItemId')
  ), '[]'::jsonb)
  into v_normalized_lines
  from jsonb_array_elements(p_lines) line;

  v_request_payload := jsonb_build_object(
    'dealer_order_id', p_dealer_order_id,
    'notes', nullif(btrim(coalesce(p_notes, '')), ''),
    'lines', v_normalized_lines
  );

  select * into v_shipment
  from public.shipments
  where id = p_shipment_id
    and company_id = v_company_id
    and dealer_id = p_dealer_id
  for update;
  if not found then raise exception 'Shipment not found'; end if;

  if v_shipment.status in ('received_confirmed', 'discrepancy_reported', 'closed') then
    select * into v_existing
    from public.dealer_receipts
    where company_id = v_company_id and shipment_id = p_shipment_id
    order by created_at desc
    limit 1;
    if not found then raise exception 'Shipment receipt is already closed'; end if;
    if v_existing.request_payload is null then
      raise exception 'This historical receipt cannot be retried safely; reload the recorded receipt';
    end if;
    if v_existing.request_payload <> v_request_payload then
      raise exception 'Receipt retry payload differs from the recorded receipt';
    end if;
    return jsonb_build_object('receiptId', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;

  v_result := public.submit_dealer_receipt_atomic_legacy(
    p_shipment_id,
    p_dealer_id,
    p_dealer_order_id,
    p_notes,
    v_normalized_lines,
    p_ip_address,
    p_user_agent,
    p_device_session_id
  );

  update public.dealer_receipts
  set request_payload = v_request_payload
  where id = (v_result->>'receiptId')::uuid
    and company_id = v_company_id;

  return v_result;
end;
$function$


-- FN public.submit_dealer_receipt_atomic_legacy
CREATE OR REPLACE FUNCTION public.submit_dealer_receipt_atomic_legacy(p_shipment_id uuid, p_dealer_id uuid, p_dealer_order_id uuid, p_notes text, p_lines jsonb, p_ip_address text, p_user_agent text, p_device_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company_id uuid;
  v_user_id uuid := auth.uid();
  v_role text;
  v_user_dealer_id uuid;
  v_shipment public.shipments%rowtype;
  v_existing public.dealer_receipts%rowtype;
  v_receipt_id uuid;
  v_audit_id uuid;
  v_has_mismatch boolean;
  v_line_count integer;
  v_matched_line_count integer;
  v_shipment_line_count integer;
begin
  v_company_id := public.get_current_user_company_id();
  v_role := public.get_current_user_role();
  v_user_dealer_id := public.get_current_user_dealer_id();

  if v_user_id is null or v_company_id is null then
    raise exception 'Authentication context is required';
  end if;
  if v_user_dealer_id is null or v_user_dealer_id <> p_dealer_id then
    raise exception 'Dealer ownership does not match the authenticated user';
  end if;
  if not public.current_user_has_permission('receive_dealer_inventory') then
    raise exception 'Permission denied for dealer receipt';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Receipt lines are required';
  end if;

  select * into v_shipment
  from public.shipments
  where id = p_shipment_id
    and company_id = v_company_id
    and dealer_id = p_dealer_id
  for update;
  if not found then
    raise exception 'Shipment not found';
  end if;

  if v_shipment.status in ('received_confirmed', 'discrepancy_reported', 'closed') then
    select * into v_existing
    from public.dealer_receipts
    where company_id = v_company_id and shipment_id = p_shipment_id
    order by created_at desc
    limit 1;
    if found then
      return jsonb_build_object('receiptId', v_existing.id, 'status', v_existing.status, 'idempotent', true);
    end if;
    raise exception 'Shipment receipt is already closed';
  end if;

  select count(*) into v_line_count
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  );
  select count(*) into v_shipment_line_count
  from public.shipment_items
  where company_id = v_company_id and shipment_id = p_shipment_id;
  if v_line_count <> v_shipment_line_count then
    raise exception 'Receipt must include every shipment line';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_lines) as line(
      shipment_item_id uuid,
      expected_quantity numeric,
      reported_received_quantity numeric,
      inventory_item_id uuid,
      unit text,
      notes text
    )
    group by line.shipment_item_id
    having count(*) > 1
  ) then
    raise exception 'Receipt contains duplicate shipment lines';
  end if;

  select count(*) into v_matched_line_count
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  )
  join public.shipment_items item
    on item.id = line.shipment_item_id
   and item.company_id = v_company_id
   and item.shipment_id = p_shipment_id
   and item.inventory_item_id = line.inventory_item_id
   and item.unit = line.unit
   and item.expected_quantity = line.expected_quantity
  where line.reported_received_quantity >= 0;
  if v_matched_line_count <> v_line_count then
    raise exception 'Receipt line does not match shipment source data';
  end if;

  if p_dealer_order_id is not null and not exists (
    select 1 from public.dealer_orders
    where id = p_dealer_order_id and company_id = v_company_id and dealer_id = p_dealer_id
  ) then
    raise exception 'Dealer order does not match shipment ownership';
  end if;

  select exists (
    select 1
    from jsonb_to_recordset(p_lines) as line(
      shipment_item_id uuid,
      expected_quantity numeric,
      reported_received_quantity numeric,
      inventory_item_id uuid,
      unit text,
      notes text
    )
    where line.reported_received_quantity <> line.expected_quantity
  ) into v_has_mismatch;

  insert into public.audit_logs_enterprise (
    company_id, actor_user_id, actor_role, actor_company_id, actor_dealer_id,
    action_type, module_name, entity_type, entity_id, new_value,
    change_summary, ip_address, user_agent, device_session_id, related_shipment_id
  ) values (
    v_company_id, v_user_id, v_role, v_company_id, p_dealer_id,
    case when v_has_mismatch then 'dealer_reported_quantity_mismatch' else 'dealer_confirmed_receipt' end,
    'dealer_inventory', 'shipment', p_shipment_id, p_lines,
    case when v_has_mismatch then 'Dealer receipt submitted with quantity mismatch' else 'Dealer receipt confirmed' end,
    p_ip_address, p_user_agent, p_device_session_id, p_shipment_id
  ) returning id into v_audit_id;

  insert into public.dealer_receipts (
    company_id, dealer_id, shipment_id, received_by_user_id,
    received_by_role, status, notes, ip_address, user_agent, device_session_id
  ) values (
    v_company_id, p_dealer_id, p_shipment_id, v_user_id,
    v_role, case when v_has_mismatch then 'discrepancy_reported' else 'confirmed' end,
    p_notes, p_ip_address, p_user_agent, p_device_session_id
  ) returning id into v_receipt_id;

  insert into public.dealer_receipt_items (
    company_id, dealer_receipt_id, shipment_item_id,
    expected_quantity, reported_received_quantity, status, notes
  )
  select v_company_id, v_receipt_id, line.shipment_item_id,
    line.expected_quantity, line.reported_received_quantity,
    case when line.reported_received_quantity = line.expected_quantity
      then 'received_confirmed' else 'discrepancy_reported' end,
    line.notes
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  );

  update public.shipment_items item
  set status = case when line.reported_received_quantity = line.expected_quantity
    then 'received_confirmed' else 'discrepancy_reported' end
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  )
  where item.id = line.shipment_item_id and item.company_id = v_company_id;

  insert into public.inventory_transactions (
    company_id, inventory_item_id, item_type, quantity, unit, inventory_state,
    from_owner_type, from_owner_id, to_owner_type, to_owner_id,
    dealer_order_id, shipment_id, created_by_user_id, created_by_role,
    reason, status, audit_log_id
  )
  select v_company_id, line.inventory_item_id, 'other', line.reported_received_quantity,
    line.unit, 'dealer_inventory_on_hand', 'dealer', p_dealer_id, 'dealer', p_dealer_id,
    p_dealer_order_id, p_shipment_id, v_user_id, v_role,
    'Dealer confirmed receipt', 'posted', v_audit_id
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  )
  where line.reported_received_quantity = line.expected_quantity
    and line.reported_received_quantity > 0;

  insert into public.inventory_discrepancies (
    company_id, dealer_id, dealer_order_id, shipment_id, shipment_item_id,
    expected_quantity, reported_quantity, difference_quantity, status,
    reported_by_user_id, reported_by_role
  )
  select v_company_id, p_dealer_id, p_dealer_order_id, p_shipment_id,
    line.shipment_item_id, line.expected_quantity, line.reported_received_quantity,
    line.reported_received_quantity - line.expected_quantity, 'open', v_user_id, v_role
  from jsonb_to_recordset(p_lines) as line(
    shipment_item_id uuid,
    expected_quantity numeric,
    reported_received_quantity numeric,
    inventory_item_id uuid,
    unit text,
    notes text
  )
  where line.reported_received_quantity <> line.expected_quantity;

  update public.shipments
  set status = case when v_has_mismatch then 'discrepancy_reported' else 'received_confirmed' end,
      updated_at = now()
  where id = p_shipment_id and company_id = v_company_id;

  return jsonb_build_object(
    'receiptId', v_receipt_id,
    'status', case when v_has_mismatch then 'discrepancy_reported' else 'confirmed' end,
    'idempotent', false
  );
end;
$function$


-- FN public.sync_breakdown_expense
CREATE OR REPLACE FUNCTION public.sync_breakdown_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_expense_id uuid;
  v_payment_status text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    return old;
  end if;
  if coalesce(new.cost, 0) <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false, 'set to zero');
    return new;
  end if;
  -- The maintenance form records a free-text supplier and bill; map them into the
  -- central payable when the linked vendor/invoice fields are blank (EXP-21).
  v_expense_id := public.upsert_source_expense_v2(new.company_id, 'maintenance', 'breakdown_logs', 'breakdown_logs', new.id,
    concat('MNT-', to_char(new.breakdown_date, 'YYYYMMDD')), 'maintenance_repairs', lower(coalesce(new.machine_type, 'other')),
    new.vendor_id, concat('Machine breakdown repair: ', coalesce(new.issue_description, 'Maintenance service')), 1, 'job',
    round(coalesce(new.cost, 0), 2), round(coalesce(new.cost, 0), 2), 0, 0, 0, round(coalesce(new.cost, 0), 2), null,
    new.payment_method, coalesce(nullif(btrim(new.invoice_number), ''), nullif(btrim(new.bill_number), '')),
    coalesce(new.invoice_date, new.bill_date), new.due_date, null, new.vendor_name);
  select payment_status into v_payment_status from public.expense_ledger where id = v_expense_id and company_id = new.company_id;
  update public.breakdown_logs
  set expense_ledger_id = v_expense_id, payment_status = coalesce(v_payment_status, payment_status)
  where id = new.id and company_id = new.company_id
    and (expense_ledger_id, payment_status) is distinct from (v_expense_id, coalesce(v_payment_status, payment_status));
  return new;
end;
$function$


-- FN public.sync_energy_reading_expense
CREATE OR REPLACE FUNCTION public.sync_energy_reading_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_expense_id uuid;
  v_category text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    return old;
  end if;
  -- A zero-cost reading retires the previously posted payable instead of leaving it (EXP-15).
  if coalesce(new.total_cost, 0) <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false, 'set to zero');
    return new;
  end if;
  v_category := case when new.energy_type in ('diesel', 'furnace_oil', 'lpg') then 'fuel_oils' else 'utilities' end;
  v_expense_id := public.upsert_source_expense_v2(new.company_id, 'energy', 'energy_readings', 'energy_readings', new.id,
    concat(upper(new.energy_type), '-', to_char(new.reading_date, 'YYYYMMDD')), v_category, new.energy_type, null,
    concat('Utility cost from energy reading: ', replace(new.energy_type, '_', ' ')), coalesce(new.consumption, 0),
    coalesce(new.unit, 'units'), coalesce(new.rate_per_unit, 0), round(coalesce(new.total_cost, 0), 2), 0, 0, 0,
    round(coalesce(new.total_cost, 0), 2),
    null, null, null, null, null, null, null);
  update public.energy_readings set expense_ledger_id = v_expense_id
  where id = new.id and company_id = new.company_id and expense_ledger_id is distinct from v_expense_id;
  return new;
end;
$function$


-- FN public.sync_expense_link_for_sources
CREATE OR REPLACE FUNCTION public.sync_expense_link_for_sources()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_table_name = 'foundry_external_aluminium_sources' then
    return public.sync_external_source_inventory_and_expense();
  elsif tg_table_name = 'foundry_aluminium_scrap' then
    return public.sync_scrap_inventory_and_expense();
  elsif tg_table_name = 'outsourced_billet_batches' then
    return public.sync_outsourced_billet_expense();
  end if;

  return coalesce(new, old);
end;
$function$


-- FN public.sync_expense_payment_totals
CREATE OR REPLACE FUNCTION public.sync_expense_payment_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := coalesce(new.company_id, old.company_id);
  v_ids uuid[];
begin
  -- Recompute every affected parent (old and new on reassignment) in a stable lock order.
  select array_agg(distinct parent_id order by parent_id) into v_ids
  from unnest(array[
    case when tg_op <> 'INSERT' then old.expense_ledger_id end,
    case when tg_op <> 'DELETE' then new.expense_ledger_id end
  ]) as parent(parent_id)
  where parent_id is not null;
  if v_ids is null then return coalesce(new, old); end if;
  perform 1 from public.expense_ledger
  where company_id = v_company_id and id = any(v_ids)
  order by id
  for update;
  update public.expense_ledger
  set updated_at = now()
  where company_id = v_company_id and id = any(v_ids);
  return coalesce(new, old);
end;
$function$


-- FN public.sync_external_source_inventory_and_expense
CREATE OR REPLACE FUNCTION public.sync_external_source_inventory_and_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_item_code text;
  v_item_id uuid;
  v_expense_id uuid;
  v_base numeric(14,2);
  v_total numeric(14,2);
  v_payment_status text;
begin
  -- The projection updates below re-enter this trigger; nested calls are no-ops (EXP-19).
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    perform private.post_source_inventory_change(old.company_id, old.inventory_item_id, old.weight_kg, old.rate,
      old.inventory_item_id, 0, old.rate, coalesce(old.unit, 'kg'), 'foundry_external_aluminium_sources', old.id,
      private.business_today(), 'purchase_in', 'External source deleted');
    return old;
  end if;

  v_item_code := concat('RM-EXT-', upper(regexp_replace(coalesce(new.item_type, 'raw'), '[^a-zA-Z0-9]+', '-', 'g')), '-',
    upper(regexp_replace(coalesce(new.alloy, 'GEN'), '[^a-zA-Z0-9]+', '', 'g')));
  v_item_id := public.ensure_inventory_item_for_expense_source(new.company_id, v_item_code,
    btrim(concat('External Aluminium ', replace(coalesce(new.item_type, 'raw_material'), '_', ' '), ' ', coalesce(new.alloy, ''))),
    'billets', coalesce(new.unit, 'kg'));
  perform private.post_source_inventory_change(new.company_id,
    case when tg_op = 'UPDATE' then old.inventory_item_id end, case when tg_op = 'UPDATE' then old.weight_kg else 0 end,
    case when tg_op = 'UPDATE' then old.rate else 0 end, v_item_id, new.weight_kg, new.rate, coalesce(new.unit, 'kg'),
    'foundry_external_aluminium_sources', new.id,
    case when tg_op = 'INSERT' then coalesce(new.received_date, private.business_today()) else private.business_today() end,
    'purchase_in', case when tg_op = 'INSERT' then 'External aluminium source purchase' else 'External aluminium source updated' end);

  v_base := case when coalesce(new.rate, 0) > 0 and coalesce(new.weight_kg, 0) > 0
    then round(new.weight_kg * new.rate, 2) else coalesce(new.base_amount, 0) end;
  v_total := round(v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0), 2);

  if v_total <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false, 'set to zero');
    v_expense_id := new.expense_ledger_id;
  else
    v_expense_id := public.upsert_source_expense_v2(new.company_id, 'foundry', 'external_aluminium_sources',
      'foundry_external_aluminium_sources', new.id, new.source_number, 'raw_material', 'external_aluminium_source',
      new.vendor_id, concat('External aluminium purchase: ', replace(new.item_type, '_', ' '), coalesce(concat(' alloy ', new.alloy), '')),
      new.weight_kg, coalesce(new.unit, 'kg'), coalesce(new.rate, 0), v_base, coalesce(new.tax_amount, 0),
      coalesce(new.freight_amount, 0), coalesce(new.discount_amount, 0), v_total, null, new.payment_method,
      new.invoice_number, new.invoice_date, new.due_date, v_item_id, null);
  end if;
  select payment_status into v_payment_status from public.expense_ledger where id = v_expense_id and company_id = new.company_id;

  update public.foundry_external_aluminium_sources
  set base_amount = v_base, total_amount = v_total, inventory_item_id = v_item_id, expense_ledger_id = v_expense_id,
      payment_status = coalesce(v_payment_status, payment_status), updated_at = now()
  where id = new.id and company_id = new.company_id
    and (base_amount, total_amount, inventory_item_id, expense_ledger_id, payment_status)
      is distinct from (v_base, v_total, v_item_id, v_expense_id, coalesce(v_payment_status, payment_status));
  return new;
end;
$function$


-- FN public.sync_foundry_billets
CREATE OR REPLACE FUNCTION public.sync_foundry_billets()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  i integer;
  v_code text;
  v_status text;
  v_order_ids uuid[];
  v_order_id uuid;
begin
  if new.status = 'cancelled' then
    update public.foundry_billets
    set status = 'cancelled', updated_at = now()
    where company_id = new.company_id and foundry_batch_id = new.id and source_type = 'in_house'
      and status = 'planned' and order_id is null and allocation_requirement_id is null and production_job_id is null;
    return new;
  end if;

  v_status := case when new.status in ('cast','homogenizing','ready','issued') then 'cast' else 'planned' end;
  for i in 1..new.billet_count loop
    v_code := concat(new.furnace_number, '-', to_char(new.production_date, 'YYYYMMDD'), '-', new.batch_sequence::text, '-', i::text);
    insert into public.foundry_billets (company_id, source_type, foundry_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status)
    values (new.company_id, 'in_house', new.id, v_code, i, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_length_mm, new.alloy, new.temper, new.billet_weight_density_kg, v_status)
    on conflict (foundry_batch_id, billet_number) where source_type = 'in_house' do update set
      billet_code = excluded.billet_code,
      billet_diameter_inch = excluded.billet_diameter_inch,
      billet_diameter_mm = excluded.billet_diameter_mm,
      billet_length_mm = excluded.billet_length_mm,
      alloy = excluded.alloy,
      temper = excluded.temper,
      weight_kg = excluded.weight_kg,
      status = case when public.foundry_billets.status in ('allocated','issued','consumed','scrap') then public.foundry_billets.status else excluded.status end,
      updated_at = now();
  end loop;

  update public.foundry_billets
  set status = 'cancelled', updated_at = now()
  where company_id = new.company_id and foundry_batch_id = new.id and source_type = 'in_house'
    and billet_number > new.billet_count and status = 'planned'
    and order_id is null and allocation_requirement_id is null and production_job_id is null
    and allocated_at is null and allocated_by is null;
  if (select count(*) from public.foundry_billets b where b.company_id = new.company_id
      and b.foundry_batch_id = new.id and b.source_type = 'in_house' and b.status <> 'cancelled') <> new.billet_count then
    raise exception 'Active in-house billet count must equal the accepted batch count';
  end if;
  return new;
end;
$function$


-- FN public.sync_foundry_external_source_usage
CREATE OR REPLACE FUNCTION public.sync_foundry_external_source_usage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_old_id uuid;
  v_old_kg numeric;
  v_new_id uuid;
  v_new_kg numeric;
begin
  if tg_op = 'DELETE' then raise exception 'Foundry batches cannot be deleted; cancel a planned batch instead'; end if;
  v_old_id := case when tg_op = 'UPDATE' and old.status <> 'cancelled' then old.external_source_id end;
  v_old_kg := case when tg_op = 'UPDATE' and old.status <> 'cancelled' then old.external_aluminium_kg else 0 end;
  v_new_id := new.external_source_id;
  v_new_kg := case when new.status = 'cancelled' then 0 else new.external_aluminium_kg end;
  perform private.apply_foundry_source_delta('foundry_external_aluminium_sources', new.company_id, v_old_id, v_old_kg, v_new_id, v_new_kg);
  return new;
end;
$function$


-- FN public.sync_foundry_scrap_usage
CREATE OR REPLACE FUNCTION public.sync_foundry_scrap_usage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_old_id uuid;
  v_old_kg numeric;
  v_new_id uuid;
  v_new_kg numeric;
begin
  if tg_op = 'DELETE' then raise exception 'Foundry batches cannot be deleted; cancel a planned batch instead'; end if;
  v_old_id := case when tg_op = 'UPDATE' and old.status <> 'cancelled' then old.scrap_id end;
  v_old_kg := case when tg_op = 'UPDATE' and old.status <> 'cancelled' then old.scrap_aluminium_kg else 0 end;
  v_new_id := new.scrap_id;
  v_new_kg := case when new.status = 'cancelled' then 0 else new.scrap_aluminium_kg end;
  perform private.apply_foundry_source_delta('foundry_aluminium_scrap', new.company_id, v_old_id, v_old_kg, v_new_id, v_new_kg);
  return new;
end;
$function$


-- FN public.sync_outsourced_billet_expense
CREATE OR REPLACE FUNCTION public.sync_outsourced_billet_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_item_code text;
  v_item_id uuid;
  v_expense_id uuid;
  v_base numeric(14,2);
  v_total numeric(14,2);
  v_new_qty numeric(14,3);
  v_old_qty numeric(14,3);
  v_payment_status text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    if coalesce(old.status, 'received') <> 'cancelled' then
      perform private.post_source_inventory_change(old.company_id, old.inventory_item_id, old.weight_kg, old.price_per_kg,
        old.inventory_item_id, 0, old.price_per_kg, coalesce(old.unit, 'kg'), 'outsourced_billet_batches', old.id,
        private.business_today(), 'purchase_in', 'Outsourced billet batch deleted');
    end if;
    return old;
  end if;

  v_item_code := concat('OBB-', upper(regexp_replace(coalesce(new.alloy, 'GEN'), '[^a-zA-Z0-9]+', '', 'g')), '-',
    replace(coalesce(new.billet_diameter_inch::text, '0'), '.', ''));
  v_item_id := public.ensure_inventory_item_for_expense_source(new.company_id, v_item_code,
    btrim(concat('Outsourced billet batch ', coalesce(new.alloy, ''), ' ', coalesce(new.temper, ''))), 'billets', coalesce(new.unit, 'kg'));
  v_new_qty := case when coalesce(new.status, 'received') = 'cancelled' then 0 else coalesce(new.weight_kg, 0) end;
  v_old_qty := case when tg_op = 'INSERT' or coalesce(old.status, 'received') = 'cancelled' then 0 else coalesce(old.weight_kg, 0) end;
  perform private.post_source_inventory_change(new.company_id,
    case when tg_op = 'UPDATE' then old.inventory_item_id end, v_old_qty,
    case when tg_op = 'UPDATE' then old.price_per_kg else 0 end, v_item_id, v_new_qty, new.price_per_kg, coalesce(new.unit, 'kg'),
    'outsourced_billet_batches', new.id,
    case when tg_op = 'INSERT' then coalesce(new.received_date, private.business_today()) else private.business_today() end,
    'purchase_in', case when tg_op = 'INSERT' then 'Outsourced billet purchase' else 'Outsourced billet batch updated' end);

  v_base := case
    when coalesce(new.price_per_kg, 0) > 0 and coalesce(new.weight_kg, 0) > 0 then round(new.weight_kg * new.price_per_kg, 2)
    when coalesce(new.base_amount, 0) > 0 then new.base_amount
    else coalesce(new.total_price, 0)
  end;
  v_total := round(v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0), 2);

  -- A cancelled batch is void: its payable is retired, never left active (EXP-20). Any
  -- cancellation fee is recorded as a separate manual expense against the vendor.
  if coalesce(new.status, 'received') = 'cancelled' or v_total <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false,
      case when coalesce(new.status, 'received') = 'cancelled' then 'cancelled' else 'set to zero' end);
    v_expense_id := new.expense_ledger_id;
  else
    v_expense_id := public.upsert_source_expense_v2(new.company_id, 'foundry', 'outsourced_billets', 'outsourced_billet_batches',
      new.id, new.batch_number, 'raw_material', 'outsourced_billet_purchase', new.vendor_id,
      concat('Outsourced billet batch purchase ', new.batch_number), new.weight_kg, coalesce(new.unit, 'kg'),
      coalesce(new.price_per_kg, 0), v_base, coalesce(new.tax_amount, 0), coalesce(new.freight_amount, 0),
      coalesce(new.discount_amount, 0), v_total, null, new.payment_method, new.invoice_number, new.invoice_date,
      new.due_date, v_item_id, null);
  end if;
  select payment_status into v_payment_status from public.expense_ledger where id = v_expense_id and company_id = new.company_id;

  update public.outsourced_billet_batches
  set base_amount = v_base, total_price = v_total, inventory_item_id = v_item_id, expense_ledger_id = v_expense_id,
      payment_status = coalesce(v_payment_status, payment_status), updated_at = now()
  where id = new.id and company_id = new.company_id
    and (base_amount, total_price, inventory_item_id, expense_ledger_id, payment_status)
      is distinct from (v_base, v_total, v_item_id, v_expense_id, coalesce(v_payment_status, payment_status));
  return new;
end;
$function$


-- FN public.sync_outsourced_billets
CREATE OR REPLACE FUNCTION public.sync_outsourced_billets()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  i integer;
  v_code text;
  v_weight_per_billet numeric;
begin
  if coalesce(new.billet_count, 0) > 0 then
    v_weight_per_billet := round((new.weight_kg / new.billet_count)::numeric, 3);
    for i in 1..new.billet_count loop
      v_code := concat('OUT-', new.batch_number, '-', i::text);
      insert into public.foundry_billets (company_id, source_type, outsourced_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status)
      values (new.company_id, 'outsourced', new.id, v_code, i, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_length_mm, new.alloy, new.temper, v_weight_per_billet, 'cast')
      on conflict (outsourced_batch_id, billet_number) where source_type = 'outsourced' do update set
        billet_code = excluded.billet_code,
        billet_diameter_inch = excluded.billet_diameter_inch,
        billet_diameter_mm = excluded.billet_diameter_mm,
        billet_length_mm = excluded.billet_length_mm,
        alloy = excluded.alloy,
        temper = excluded.temper,
        weight_kg = excluded.weight_kg,
        status = case when public.foundry_billets.status in ('issued','consumed','scrap') then public.foundry_billets.status else excluded.status end,
        updated_at = now();
    end loop;
  end if;
  return new;
end;
$function$


-- FN public.sync_packaging_order_stage
CREATE OR REPLACE FUNCTION public.sync_packaging_order_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    perform private.advance_order_stage(
      new.company_id,
      new.order_id,
      'packing',
      concat('Packaging job ', coalesce(new.packaging_number, new.id::text), ' completed with issued materials.')
    );
  end if;
  return new;
end;
$function$


-- FN public.sync_packaging_purchase_inventory_and_expense
CREATE OR REPLACE FUNCTION public.sync_packaging_purchase_inventory_and_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_material_code text;
  v_material_name text;
  v_material_type text;
  v_material_unit text;
  v_item_id uuid;
  v_expense_id uuid;
  v_base numeric(14,2);
  v_total numeric(14,2);
  v_payment_status text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    perform private.post_source_inventory_change(old.company_id, old.inventory_item_id, old.quantity, old.rate,
      old.inventory_item_id, 0, old.rate, coalesce(old.unit, 'meter'), 'packaging_material_purchases', old.id,
      private.business_today(), 'purchase_in', 'Packaging material purchase deleted');
    return old;
  end if;

  if tg_op = 'UPDATE' and new.material_id <> old.material_id then
    raise exception 'Material cannot be changed for an existing purchase record. Create a new purchase entry instead.';
  end if;
  select material_code, material_name, material_type, unit
    into v_material_code, v_material_name, v_material_type, v_material_unit
  from public.packaging_materials where id = new.material_id and company_id = new.company_id;
  if not found then raise exception 'Packaging material not found for this company'; end if;

  v_item_id := public.ensure_inventory_item_for_expense_source(new.company_id,
    concat('PKG-', upper(regexp_replace(coalesce(v_material_code, 'MAT'), '[^a-zA-Z0-9]+', '-', 'g'))),
    concat('Packaging Material ', coalesce(v_material_name, '')), 'packing_material', coalesce(new.unit, v_material_unit, 'meter'));
  perform private.post_source_inventory_change(new.company_id,
    case when tg_op = 'UPDATE' then old.inventory_item_id end, case when tg_op = 'UPDATE' then old.quantity else 0 end,
    case when tg_op = 'UPDATE' then old.rate else 0 end, v_item_id, new.quantity, new.rate,
    coalesce(new.unit, v_material_unit, 'meter'), 'packaging_material_purchases', new.id,
    case when tg_op = 'INSERT' then coalesce(new.received_date, private.business_today()) else private.business_today() end,
    'purchase_in', case when tg_op = 'INSERT' then 'Packaging material purchase' else 'Packaging material purchase updated' end);

  v_base := case when coalesce(new.rate, 0) > 0 and coalesce(new.quantity, 0) > 0
    then round(new.quantity * new.rate, 2) else coalesce(new.base_amount, 0) end;
  v_total := round(v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0), 2);

  if v_total <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false, 'set to zero');
    v_expense_id := new.expense_ledger_id;
  else
    v_expense_id := public.upsert_source_expense_v2(new.company_id, 'packaging', 'material_purchase',
      'packaging_material_purchases', new.id, new.purchase_number, 'packaging_material', coalesce(v_material_type, 'other'),
      new.vendor_id, concat('Packaging material purchase: ', coalesce(v_material_name, v_material_code, 'Material')),
      new.quantity, coalesce(new.unit, v_material_unit, 'meter'), coalesce(new.rate, 0), v_base, coalesce(new.tax_amount, 0),
      coalesce(new.freight_amount, 0), coalesce(new.discount_amount, 0), v_total, null, new.payment_method,
      new.invoice_number, new.invoice_date, new.due_date, v_item_id, null);
  end if;
  select payment_status into v_payment_status from public.expense_ledger where id = v_expense_id and company_id = new.company_id;

  update public.packaging_material_purchases
  set base_amount = v_base, total_amount = v_total, inventory_item_id = v_item_id, expense_ledger_id = v_expense_id,
      payment_status = coalesce(v_payment_status, payment_status), updated_at = now()
  where id = new.id and company_id = new.company_id
    and (base_amount, total_amount, inventory_item_id, expense_ledger_id, payment_status)
      is distinct from (v_base, v_total, v_item_id, v_expense_id, coalesce(v_payment_status, payment_status));
  return new;
end;
$function$


-- FN public.sync_process_scrap_to_foundry
CREATE OR REPLACE FUNCTION public.sync_process_scrap_to_foundry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if coalesce(new.scrap_type, '') = 'process_scrap' and coalesce(new.weight_kg, 0) > 0 then
    insert into public.foundry_aluminium_scrap (
      company_id, scrap_number, scrap_source, weight_kg, available_weight_kg,
      scrap_quality, status, received_date, origin_reference, created_by
    ) values (
      new.company_id,
      private.next_business_number_locked('public.foundry_aluminium_scrap'::regclass, 'scrap_number', new.company_id, 'SCR', current_date),
      'in_house',
      new.weight_kg,
      new.weight_kg,
      'clean',
      'available',
      coalesce(new.recorded_date, current_date),
      concat('Process scrap from production job ', coalesce(new.production_job_id::text, new.id::text)),
      new.recorded_by
    );
  end if;
  return new;
end;
$function$


-- FN public.sync_production_finishing_route
CREATE OR REPLACE FUNCTION public.sync_production_finishing_route()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.finishing_type is null or btrim(new.finishing_type) = '' then
    select coalesce(oi.finishing_type, 'mill_finish')
    into new.finishing_type
    from public.order_items oi
    where oi.id = new.source_line_id
      and oi.company_id = new.company_id
      and oi.order_id = new.order_id;
  end if;
  if new.finishing_type is null or btrim(new.finishing_type) = '' then
    select coalesce(qi.finishing_type, 'mill_finish')
    into new.finishing_type
    from public.orders o
    join public.quote_items qi
      on qi.company_id = o.company_id
     and qi.quote_id = o.quote_id
     and qi.profile_id = new.profile_id
    where o.id = new.order_id and o.company_id = new.company_id
    order by qi.created_at
    limit 1;
  end if;
  new.finishing_type := coalesce(nullif(btrim(new.finishing_type), ''), 'mill_finish');
  return new;
end;
$function$


-- FN public.sync_scrap_inventory_and_expense
CREATE OR REPLACE FUNCTION public.sync_scrap_inventory_and_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_item_code text;
  v_item_id uuid;
  v_expense_id uuid;
  v_base numeric(14,2);
  v_total numeric(14,2);
  v_payment_status text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    perform private.post_source_inventory_change(old.company_id, old.inventory_item_id, old.weight_kg, old.rate,
      old.inventory_item_id, 0, old.rate, coalesce(old.unit, 'kg'), 'foundry_aluminium_scrap', old.id,
      private.business_today(), 'scrap_in', 'Scrap source deleted');
    return old;
  end if;

  v_item_code := concat('SCRAP-', upper(regexp_replace(coalesce(new.scrap_quality, 'MIXED'), '[^a-zA-Z0-9]+', '-', 'g')));
  v_item_id := public.ensure_inventory_item_for_expense_source(new.company_id, v_item_code,
    btrim(concat('Aluminium Scrap ', replace(coalesce(new.scrap_quality, 'mixed'), '_', ' '))), 'scrap', coalesce(new.unit, 'kg'));
  perform private.post_source_inventory_change(new.company_id,
    case when tg_op = 'UPDATE' then old.inventory_item_id end, case when tg_op = 'UPDATE' then old.weight_kg else 0 end,
    case when tg_op = 'UPDATE' then old.rate else 0 end, v_item_id, new.weight_kg, new.rate, coalesce(new.unit, 'kg'),
    'foundry_aluminium_scrap', new.id,
    case when tg_op = 'INSERT' then coalesce(new.received_date, private.business_today()) else private.business_today() end,
    'scrap_in', case when tg_op = 'INSERT' then 'Incoming aluminium scrap purchase' else 'Aluminium scrap source updated' end);

  v_base := case when coalesce(new.rate, 0) > 0 and coalesce(new.weight_kg, 0) > 0
    then round(new.weight_kg * new.rate, 2) else coalesce(new.base_amount, 0) end;
  v_total := round(v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0), 2);

  if v_total <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false, 'set to zero');
    v_expense_id := new.expense_ledger_id;
  else
    v_expense_id := public.upsert_source_expense_v2(new.company_id, 'foundry', 'scrap_purchase', 'foundry_aluminium_scrap',
      new.id, new.scrap_number, 'raw_material', 'scrap_purchase', new.vendor_id,
      concat('Aluminium scrap purchase: ', replace(new.scrap_quality, '_', ' '), ' (', replace(new.scrap_source, '_', ' '), ')'),
      new.weight_kg, coalesce(new.unit, 'kg'), coalesce(new.rate, 0), v_base, coalesce(new.tax_amount, 0),
      coalesce(new.freight_amount, 0), coalesce(new.discount_amount, 0), v_total, null, new.payment_method,
      new.invoice_number, new.invoice_date, new.due_date, v_item_id, null);
  end if;
  select payment_status into v_payment_status from public.expense_ledger where id = v_expense_id and company_id = new.company_id;

  update public.foundry_aluminium_scrap
  set base_amount = v_base, total_amount = v_total, inventory_item_id = v_item_id, expense_ledger_id = v_expense_id,
      payment_status = coalesce(v_payment_status, payment_status), updated_at = now()
  where id = new.id and company_id = new.company_id
    and (base_amount, total_amount, inventory_item_id, expense_ledger_id, payment_status)
      is distinct from (v_base, v_total, v_item_id, v_expense_id, coalesce(v_payment_status, payment_status));
  return new;
end;
$function$


-- FN public.transition_dealer_order_atomic
CREATE OR REPLACE FUNCTION public.transition_dealer_order_atomic(p_dealer_order_id uuid, p_status text, p_factory_committed_date date, p_clarification_required boolean, p_notes text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.transition_dealer_order_atomic($1, $2, $3, $4, $5) $function$


-- FN public.transition_dispatch_delivery_atomic
CREATE OR REPLACE FUNCTION public.transition_dispatch_delivery_atomic(p_dispatch_id uuid, p_status text, p_proof_of_delivery_url text DEFAULT NULL::text, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.transition_dispatch_delivery_atomic(p_dispatch_id, p_status, p_proof_of_delivery_url, p_remarks) $function$


-- FN public.transition_expense_approval
CREATE OR REPLACE FUNCTION public.transition_expense_approval(p_expense_id uuid, p_action text, p_note text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.transition_expense_approval(p_expense_id, p_action, p_note) $function$


-- FN public.transition_finishing_job_atomic
CREATE OR REPLACE FUNCTION public.transition_finishing_job_atomic(p_job_id uuid, p_status text, p_vendor_id uuid DEFAULT NULL::uuid, p_sent_date date DEFAULT NULL::date, p_received_date date DEFAULT NULL::date, p_output_weight_kg numeric DEFAULT NULL::numeric, p_rejection_weight_kg numeric DEFAULT NULL::numeric, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select private.transition_finishing_job_atomic(
    p_job_id, p_status, p_vendor_id, p_sent_date, p_received_date,
    p_output_weight_kg, p_rejection_weight_kg, p_remarks
  )
$function$


-- FN public.transition_production_job_atomic
CREATE OR REPLACE FUNCTION public.transition_production_job_atomic(p_job_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.transition_production_job_atomic(p_job_id, p_status, p_reason) $function$


-- FN public.update_versioned_entity_atomic
CREATE OR REPLACE FUNCTION public.update_versioned_entity_atomic(p_entity_type text, p_entity_id uuid, p_payload jsonb)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select private.update_versioned_entity_atomic(p_entity_type, p_entity_id, p_payload) $function$


-- FN public.upsert_source_expense
CREATE OR REPLACE FUNCTION public.upsert_source_expense(p_company_id uuid, p_source_module text, p_source_submodule text, p_source_table text, p_source_record_id uuid, p_source_label text, p_expense_category text, p_expense_subcategory text, p_vendor_id uuid, p_description text, p_quantity numeric, p_unit text, p_rate numeric, p_base_amount numeric, p_tax_amount numeric, p_freight_amount numeric, p_discount_amount numeric, p_total_amount numeric, p_payment_status text, p_payment_method text, p_invoice_number text, p_invoice_date date, p_due_date date, p_inventory_item_id uuid)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select public.upsert_source_expense_v2(p_company_id, p_source_module, p_source_submodule, p_source_table, p_source_record_id,
    p_source_label, p_expense_category, p_expense_subcategory, p_vendor_id, p_description, p_quantity, p_unit, p_rate,
    p_base_amount, p_tax_amount, p_freight_amount, p_discount_amount, p_total_amount, p_payment_status, p_payment_method,
    p_invoice_number, p_invoice_date, p_due_date, p_inventory_item_id, null)
$function$


-- FN public.upsert_source_expense_v2
CREATE OR REPLACE FUNCTION public.upsert_source_expense_v2(p_company_id uuid, p_source_module text, p_source_submodule text, p_source_table text, p_source_record_id uuid, p_source_label text, p_expense_category text, p_expense_subcategory text, p_vendor_id uuid, p_description text, p_quantity numeric, p_unit text, p_rate numeric, p_base_amount numeric, p_tax_amount numeric, p_freight_amount numeric, p_discount_amount numeric, p_total_amount numeric, p_payment_status text, p_payment_method text, p_invoice_number text, p_invoice_date date, p_due_date date, p_inventory_item_id uuid, p_vendor_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_existing public.expense_ledger%rowtype;
  v_vendor_name text := nullif(btrim(p_vendor_name), '');
  v_vendor_id uuid;
  v_invoice_number text := nullif(btrim(p_invoice_number), '');
  v_duplicate text;
  v_id uuid;
  v_total numeric(14,2) := round(coalesce(p_base_amount,0) + coalesce(p_tax_amount,0) + coalesce(p_freight_amount,0) - coalesce(p_discount_amount,0), 2);
begin
  -- p_total_amount and p_payment_status are accepted for signature compatibility only:
  -- the total is derived from components and payment state comes from the payment ledger.
  if p_vendor_id is not null then
    select id, vendor_name into v_vendor_id, v_vendor_name from public.vendors where id = p_vendor_id and company_id = p_company_id;
    if v_vendor_id is null then v_vendor_name := nullif(btrim(p_vendor_name), ''); end if;
  end if;

  v_duplicate := private.find_duplicate_vendor_bill(p_company_id, v_vendor_id, v_invoice_number, p_invoice_date, v_total, null, p_source_record_id);
  if v_duplicate is not null then
    raise warning 'Duplicate vendor bill % also recorded as expense %', v_invoice_number, v_duplicate;
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (p_company_id, auth.uid(), 'expense_duplicate_vendor_bill_warning', p_source_table, p_source_record_id,
      jsonb_build_object('invoice_number', v_invoice_number, 'vendor_id', v_vendor_id, 'existing_expense', v_duplicate, 'total_amount', v_total));
  end if;

  select * into v_existing from public.expense_ledger
  where company_id = p_company_id and source_table = p_source_table and source_record_id = p_source_record_id
  for update;

  if not found then
    insert into public.expense_ledger(company_id, source_module, source_submodule, source_table, source_record_id, source_label,
      expense_category, expense_subcategory, vendor_id, vendor_name_snapshot, description, quantity, unit, rate,
      base_amount, tax_amount, freight_amount, discount_amount, total_amount, currency, payment_method,
      invoice_number, invoice_date, due_date, inventory_item_id, approval_status, created_by, updated_by)
    values (p_company_id, p_source_module, p_source_submodule, p_source_table, p_source_record_id, p_source_label,
      p_expense_category, p_expense_subcategory, v_vendor_id, v_vendor_name, p_description, coalesce(p_quantity, 0), p_unit,
      coalesce(p_rate, 0), coalesce(p_base_amount, 0), coalesce(p_tax_amount, 0), coalesce(p_freight_amount, 0),
      coalesce(p_discount_amount, 0), v_total, 'INR', p_payment_method, v_invoice_number, p_invoice_date, p_due_date,
      p_inventory_item_id, 'pending_approval', auth.uid(), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  if v_existing.approval_status = 'cancelled' then
    -- A previously retired source cost that becomes chargeable again needs a fresh approval.
    update public.expense_ledger set deleted_at = null where id = v_existing.id and company_id = p_company_id;
    perform private.set_expense_approval_state(v_existing.id, p_company_id, 'pending_approval', 'Source cost reactivated', false);
  end if;

  update public.expense_ledger
  set source_module = p_source_module, source_submodule = p_source_submodule, source_label = p_source_label,
      expense_category = p_expense_category, expense_subcategory = p_expense_subcategory, vendor_id = v_vendor_id,
      vendor_name_snapshot = v_vendor_name, description = p_description, quantity = coalesce(p_quantity, 0),
      unit = p_unit, rate = coalesce(p_rate, 0), base_amount = coalesce(p_base_amount, 0),
      tax_amount = coalesce(p_tax_amount, 0), freight_amount = coalesce(p_freight_amount, 0),
      discount_amount = coalesce(p_discount_amount, 0), total_amount = v_total, payment_method = p_payment_method,
      invoice_number = v_invoice_number, invoice_date = p_invoice_date, due_date = p_due_date,
      inventory_item_id = p_inventory_item_id, deleted_at = null, updated_by = auth.uid()
  where id = v_existing.id and company_id = p_company_id
    and (source_module, source_submodule, source_label, expense_category, expense_subcategory, vendor_id,
      vendor_name_snapshot, description, quantity, unit, rate, base_amount, tax_amount, freight_amount,
      discount_amount, total_amount, payment_method, invoice_number, invoice_date, due_date, inventory_item_id, deleted_at)
    is distinct from (p_source_module, p_source_submodule, p_source_label, p_expense_category, p_expense_subcategory, v_vendor_id,
      v_vendor_name, p_description, coalesce(p_quantity, 0)::numeric(14,3), p_unit, coalesce(p_rate, 0)::numeric(14,2),
      coalesce(p_base_amount, 0)::numeric(14,2), coalesce(p_tax_amount, 0)::numeric(14,2), coalesce(p_freight_amount, 0)::numeric(14,2),
      coalesce(p_discount_amount, 0)::numeric(14,2), v_total, p_payment_method, v_invoice_number, p_invoice_date, p_due_date,
      p_inventory_item_id, null::timestamptz);
  return v_existing.id;
end;
$function$


-- FN public.validate_completed_packaging_materials
CREATE OR REPLACE FUNCTION public.validate_completed_packaging_materials()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_job_id uuid;v_status text;
begin
  if tg_table_name='packaging_jobs' then
    v_job_id:=new.id;
  elsif tg_op='DELETE' then
    v_job_id:=old.job_id;
  else
    v_job_id:=new.job_id;
  end if;
  select status into v_status from public.packaging_jobs where id=v_job_id;
  if v_status='completed' and not exists(select 1 from public.packaging_job_materials
    where job_id=v_job_id and quantity_required>0) then
    raise exception 'Completed packaging requires at least one issued material' using errcode='23514';
  end if;
  return coalesce(new,old);
end;
$function$


-- FN public.validate_dispatch_readiness
CREATE OR REPLACE FUNCTION public.validate_dispatch_readiness()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if new.delivery_status <> 'pending' then
    perform private.assert_dispatch_ready(new.id);
  end if;
  return new;
end;
$function$


-- FN public.validate_dispatch_transition
CREATE OR REPLACE FUNCTION public.validate_dispatch_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
    if btrim(new.proof_of_delivery_url) not like
       new.company_id::text || '/dispatches/' || new.id::text || '/proof-of-delivery/%'
       or not exists (
         select 1
         from public.technical_documents document
         where document.company_id = new.company_id
           and document.linked_entity_type = 'dispatch'
           and document.linked_entity_id = new.id
           and document.document_type = 'proof_of_delivery'
           and document.storage_bucket = 'documents'
           and document.storage_path = btrim(new.proof_of_delivery_url)
       ) then
      raise exception 'Proof of delivery must be a durable file stored for this company and dispatch'
        using errcode = '23514';
    end if;
    new.delivered_at := coalesce(new.delivered_at, now());
  elsif tg_op = 'UPDATE' and new.delivery_status is distinct from old.delivery_status then
    new.delivered_at := null;
  end if;
  return new;
end;
$function$


-- FN public.validate_finishing_completion
CREATE OR REPLACE FUNCTION public.validate_finishing_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.production_job_id is null then
    raise exception 'Finishing must link to a production job' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.production_jobs pj
    where pj.id = new.production_job_id
      and pj.company_id = new.company_id
      and pj.order_id = new.order_id
      and pj.status = 'completed'
  ) then
    raise exception 'Finishing production job must be completed and belong to this order/company'
      using errcode = '23514';
  end if;
  if new.status = 'completed' then
    if coalesce(new.rejection_weight_kg, 0) < 0 then
      raise exception 'Finishing rejection weight cannot be negative'
        using errcode = '23514';
    end if;
    if coalesce(new.output_weight_kg, 0) <= 0 then
      raise exception 'Capture accepted finishing output before completion'
        using errcode = '23514';
    end if;
    if coalesce(new.output_weight_kg, 0) + coalesce(new.rejection_weight_kg, 0)
       > coalesce(new.input_weight_kg, 0) + 0.01 then
      raise exception 'Finishing output plus rejection cannot exceed input weight'
        using errcode = '23514';
    end if;
    if new.received_date is null then
      raise exception 'Record finishing receipt date before completion'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$


-- FN public.validate_finishing_transition
CREATE OR REPLACE FUNCTION public.validate_finishing_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_retry_source record;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'planned' then
      raise exception 'New finishing jobs must start as planned' using errcode = '23514';
    end if;
  end if;

  if new.retry_of_finishing_job_id is not null then
    select id, company_id, order_id, production_job_id, finishing_type,
      status, input_weight_kg, output_weight_kg, rejection_weight_kg
    into v_retry_source
    from public.finishing_jobs
    where id = new.retry_of_finishing_job_id;
    if not found
       or v_retry_source.company_id <> new.company_id
       or v_retry_source.order_id <> new.order_id
       or v_retry_source.production_job_id is distinct from new.production_job_id
       or v_retry_source.finishing_type <> new.finishing_type
       or v_retry_source.status <> 'rejected' then
      raise exception 'Finishing retry must reference a rejected job for the same company and source'
        using errcode = '23514';
    end if;
    if coalesce(new.input_weight_kg, 0) <= 0
       or abs(new.input_weight_kg - least(
         coalesce(v_retry_source.rejection_weight_kg, 0),
         greatest(
           coalesce(v_retry_source.input_weight_kg, 0)
             - coalesce(v_retry_source.output_weight_kg, 0),
           0
         )
       )) > 0.01 then
      raise exception 'Finishing retry input must equal recoverable rejected weight'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then return new; end if;

  if old.company_id is distinct from new.company_id
     or old.order_id is distinct from new.order_id
     or old.production_job_id is distinct from new.production_job_id
     or old.finishing_type is distinct from new.finishing_type
     or old.retry_of_finishing_job_id is distinct from new.retry_of_finishing_job_id then
    raise exception 'Finishing source and route cannot be changed after creation'
      using errcode = '23514';
  end if;

  if old.status in ('completed', 'rejected', 'not_required')
     and (
       old.input_weight_kg is distinct from new.input_weight_kg
       or old.output_weight_kg is distinct from new.output_weight_kg
       or old.rejection_weight_kg is distinct from new.rejection_weight_kg
       or old.remarks is distinct from new.remarks
     ) then
    raise exception 'Terminal finishing evidence is immutable; record a new finishing job for corrections'
      using errcode = '23514';
  end if;

  if old.status is distinct from new.status then
    if old.status = 'planned' and new.status not in ('sent_to_vendor', 'in_process', 'rejected') then
      raise exception 'Planned finishing can only be sent, started in-house, or rejected'
        using errcode = '23514';
    elsif old.status = 'sent_to_vendor' and new.status not in ('in_process', 'received', 'rejected') then
      raise exception 'Sent finishing can only move in process, received, or rejected'
        using errcode = '23514';
    elsif old.status = 'in_process' and new.status not in ('received', 'completed', 'rejected') then
      raise exception 'Finishing in process can only be received, completed, or rejected'
        using errcode = '23514';
    elsif old.status = 'received' and new.status not in ('completed', 'rejected') then
      raise exception 'Received finishing can only be completed or rejected'
        using errcode = '23514';
    elsif old.status in ('completed', 'rejected', 'not_required') then
      raise exception 'Terminal finishing jobs cannot be reopened'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'sent_to_vendor' then
    if new.vendor_id is null then
      raise exception 'Select a finishing vendor before recording dispatch to vendor'
        using errcode = '23514';
    end if;
    if new.sent_date is null then
      raise exception 'Record the date material was sent to the finishing vendor'
        using errcode = '23514';
    end if;
  end if;
  if new.status in ('received', 'completed') and new.received_date is null then
    raise exception 'Record the finishing receipt date before this transition'
      using errcode = '23514';
  end if;
  if new.status = 'rejected' then
    if coalesce(new.rejection_weight_kg, 0) <= 0 then
      raise exception 'Rejected finishing requires a positive rejection weight'
        using errcode = '23514';
    end if;
    if coalesce(new.input_weight_kg, 0) <= 0
       or coalesce(new.output_weight_kg, 0) < 0
       or new.rejection_weight_kg
          > greatest(new.input_weight_kg - coalesce(new.output_weight_kg, 0), 0) + 0.01 then
      raise exception 'Finishing rejection cannot exceed input weight remaining after accepted output'
        using errcode = '23514';
    end if;
    if coalesce(btrim(new.remarks), '') = '' then
      raise exception 'Rejected finishing requires remarks explaining the disposition'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$


-- FN public.validate_foundry_billet_lineage
CREATE OR REPLACE FUNCTION public.validate_foundry_billet_lineage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_requirement public.order_billet_requirements%rowtype;
  v_job public.production_jobs%rowtype;
begin
  if new.allocation_requirement_id is not null then
    select *
    into v_requirement
    from public.order_billet_requirements
    where id = new.allocation_requirement_id
    for share;

    if not found or v_requirement.company_id <> new.company_id then
      raise exception 'Billet allocation requirement does not belong to the selected company' using errcode = '23514';
    end if;
    if new.order_id is distinct from v_requirement.order_id then
      raise exception 'Billet allocation order does not match its requirement' using errcode = '23514';
    end if;
    if lower(btrim(coalesce(new.alloy, ''))) <> lower(btrim(coalesce(v_requirement.alloy, '')))
      or lower(btrim(coalesce(new.temper, ''))) <> lower(btrim(coalesce(v_requirement.temper, '')))
      or new.billet_diameter_inch <> v_requirement.billet_diameter_inch then
      raise exception 'Billet alloy, temper, and diameter must match the order requirement' using errcode = '23514';
    end if;
  end if;

  if new.production_job_id is not null then
    select *
    into v_job
    from public.production_jobs
    where id = new.production_job_id
    for share;

    if not found or v_job.company_id <> new.company_id then
      raise exception 'Billet production job does not belong to the selected company' using errcode = '23514';
    end if;
    if new.order_id is distinct from v_job.order_id then
      raise exception 'Billet order does not match its production job' using errcode = '23514';
    end if;
    if new.allocation_requirement_id is not null
      and v_requirement.profile_id <> v_job.profile_id then
      raise exception 'Billet requirement does not match the production job profile' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$


-- FN public.validate_invoice_dispatch_billable
CREATE OR REPLACE FUNCTION public.validate_invoice_dispatch_billable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if new.dispatch_id is null or new.status='cancelled' then return new; end if;
  -- Existing receivables must still settle through receipts and return credits.
  -- Creation, reactivation and source changes always revalidate the shipment.
  if tg_op='UPDATE' and old.status is distinct from 'cancelled'
    and new.company_id is not distinct from old.company_id and new.order_id is not distinct from old.order_id
    and new.dispatch_id is not distinct from old.dispatch_id and new.customer_id is not distinct from old.customer_id then return new; end if;
  if not private.invoice_dispatch_is_billable(new.company_id,new.order_id,new.dispatch_id) then
    raise exception 'Invoice dispatch is unavailable: returned/damaged or unverified retained shipment. Review its source and cancellation history' using errcode='23514';
  end if;
  return new;
end;
$function$


-- FN public.validate_operator_dispatch_bundle
CREATE OR REPLACE FUNCTION public.validate_operator_dispatch_bundle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_reservation record;
begin
  if nullif(trim(new.bundle_number), '') is null then raise exception 'Scan or enter the physical bundle identifier'; end if;
  if new.source_line_id is null or new.profile_id is null or new.source_kind is null then
    raise exception 'Every bundle must select its exact production, reservation, or dealer-stock source';
  end if;
  if new.operator_verified_at is null or new.operator_verified_by is null then raise exception 'Every dispatch bundle requires operator verification'; end if;
  if coalesce(new.number_of_pieces, 0) <= 0 then raise exception 'Every physical bundle must record its actual piece count'; end if;
  if coalesce(new.net_length_m, 0) <= 0 then raise exception 'Every physical bundle must record its actual length in metres'; end if;
  if coalesce(new.gross_weight_kg, 0) > 0 and coalesce(new.tare_weight_kg, 0) >= 0 then
    new.net_weight_kg := round(new.gross_weight_kg - new.tare_weight_kg, 3);
  end if;
  if new.source_kind = 'reservation' then
    select initial_reserved_weight_kg, initial_reserved_length_m, initial_reserved_pieces
    into v_reservation
    from public.profile_stock_reservations
    where id = new.reservation_id and company_id = new.company_id and profile_id = new.profile_id
      and profile_stock_batch_id = new.profile_stock_batch_id and status in ('active','consumed')
    for update;
    if not found or coalesce(v_reservation.initial_reserved_pieces, 0) <= 0
      or abs(new.net_weight_kg - (v_reservation.initial_reserved_weight_kg * new.number_of_pieces / v_reservation.initial_reserved_pieces)) > 0.01
      or abs(new.net_length_m - (v_reservation.initial_reserved_length_m * new.number_of_pieces / v_reservation.initial_reserved_pieces)) > 0.001 then
      raise exception 'Reserved-stock bundle units must preserve the exact whole-piece source ratio';
    end if;
  end if;
  if coalesce(new.gross_weight_kg, 0) <= 0 or coalesce(new.tare_weight_kg, 0) < 0 or new.gross_weight_kg <= new.tare_weight_kg then
    raise exception 'Bundle gross weight must be greater than its non-negative tare weight';
  end if;
  new.net_weight_kg := round(new.gross_weight_kg - new.tare_weight_kg, 3);
  return new;
end;
$function$


-- FN public.validate_order_billet_requirement_material
CREATE OR REPLACE FUNCTION public.validate_order_billet_requirement_material()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile record;
  v_order record;
  v_die_diameter numeric;
  v_expected_alloy text;
  v_expected_temper text;
  v_expected_diameter numeric;
begin
  select company_id, alloy, temper, billet_alloy, temper_requirement, billet_diameter_required_inch
  into v_profile
  from public.aluminium_profiles
  where id = new.profile_id;
  if v_profile.company_id is null or v_profile.company_id <> new.company_id then
    raise exception 'Billet requirement profile does not belong to the selected company' using errcode = '23514';
  end if;

  select company_id, billet_diameter_required_inch, production_die_id
  into v_order
  from public.orders
  where id = new.order_id;
  if v_order.company_id is null or v_order.company_id <> new.company_id then
    raise exception 'Billet requirement order does not belong to the selected company' using errcode = '23514';
  end if;

  if v_order.production_die_id is not null then
    select billet_diameter_required_inch into v_die_diameter
    from public.dies
    where id = v_order.production_die_id and company_id = new.company_id;
  end if;

  v_expected_alloy := coalesce(nullif(btrim(v_profile.billet_alloy), ''), nullif(btrim(v_profile.alloy), ''));
  v_expected_temper := coalesce(nullif(btrim(v_profile.temper), ''), nullif(btrim(v_profile.temper_requirement), ''));
  v_expected_diameter := coalesce(v_order.billet_diameter_required_inch, v_die_diameter, v_profile.billet_diameter_required_inch);

  if nullif(btrim(new.alloy), '') is null or v_expected_alloy is null then
    raise exception 'Explicit billet alloy is required on the profile before production planning' using errcode = '23514';
  end if;
  if lower(btrim(new.alloy)) <> lower(v_expected_alloy) then
    raise exception 'Billet requirement alloy does not match the profile master data' using errcode = '23514';
  end if;
  if nullif(btrim(new.temper), '') is null or v_expected_temper is null then
    raise exception 'Explicit billet temper is required on the profile before production planning' using errcode = '23514';
  end if;
  if lower(btrim(new.temper)) <> lower(v_expected_temper) then
    raise exception 'Billet requirement temper does not match the profile master data' using errcode = '23514';
  end if;
  if v_expected_diameter is null or new.billet_diameter_inch <> v_expected_diameter then
    raise exception 'Explicit billet diameter is required and must match the order, die, or profile master data' using errcode = '23514';
  end if;

  return new;
end;
$function$


-- FN public.validate_packing_dispatch_readiness
CREATE OR REPLACE FUNCTION public.validate_packing_dispatch_readiness()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
$function$


-- FN public.validate_production_completion
CREATE OR REPLACE FUNCTION public.validate_production_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' and new.status not in ('planned', 'ready') then
    raise exception 'New production jobs must start as planned or ready'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if old.status = 'planned' and new.status not in ('ready', 'on_hold', 'cancelled') then
      raise exception 'Planned production can only move to ready, on hold, or cancelled'
        using errcode = '23514';
    elsif old.status = 'ready' and new.status not in ('in_progress', 'on_hold', 'cancelled') then
      raise exception 'Ready production can only start, go on hold, or be cancelled'
        using errcode = '23514';
    elsif old.status = 'in_progress' and new.status not in ('on_hold', 'completed', 'cancelled') then
      raise exception 'Running production can only go on hold, complete, or be cancelled'
        using errcode = '23514';
    elsif old.status = 'on_hold' and new.status not in ('ready', 'in_progress', 'cancelled') then
      raise exception 'On-hold production can only return to ready/running or be cancelled'
        using errcode = '23514';
    elsif old.status in ('completed', 'cancelled') then
      raise exception 'Completed or cancelled production cannot be reopened'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'completed' then
    if coalesce(new.actual_quantity_kg, 0) <= 0 then
      raise exception 'Actual output must be greater than zero before production can be completed'
        using errcode = '23514';
    end if;
    if coalesce(new.pieces, 0) > 0 and coalesce(new.actual_pieces, 0) <= 0 then
      raise exception 'Capture actual pieces before completing this production job'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$


-- FN public.validate_production_job_die
CREATE OR REPLACE FUNCTION public.validate_production_job_die()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.die_id is null then
    raise exception 'Production cannot be scheduled without an existing die' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.dies d
    where d.id = new.die_id
      and d.company_id = new.company_id
      and d.profile_id = new.profile_id
      and d.die_status not in ('inactive', 'dead')
  ) then
    raise exception 'Production die must exist, match the profile, and be active/trial/correction/nitriding' using errcode = '23514';
  end if;

  return new;
end;
$function$


-- FN public.validate_production_job_references
CREATE OR REPLACE FUNCTION public.validate_production_job_references()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_company_id uuid;
  v_profile_company_id uuid;
  v_die_company_id uuid;
  v_die_profile_id uuid;
  v_machine_company_id uuid;
  v_machine_type text;
begin
  select company_id into v_order_company_id from public.orders where id = new.order_id;
  if v_order_company_id is null or v_order_company_id <> new.company_id then
    raise exception 'Production job order does not belong to the selected company' using errcode = '23514';
  end if;

  select company_id into v_profile_company_id from public.aluminium_profiles where id = new.profile_id;
  if v_profile_company_id is null or v_profile_company_id <> new.company_id then
    raise exception 'Production job profile does not belong to the selected company' using errcode = '23514';
  end if;

  if new.die_id is not null then
    select company_id, profile_id into v_die_company_id, v_die_profile_id
    from public.dies where id = new.die_id;
    if v_die_company_id is null or v_die_company_id <> new.company_id then
      raise exception 'Production job die does not belong to the selected company' using errcode = '23514';
    end if;
    if v_die_profile_id <> new.profile_id then
      raise exception 'Production job die is not registered for the selected profile' using errcode = '23514';
    end if;
  end if;

  if new.machine_id is not null then
    select company_id, machine_type into v_machine_company_id, v_machine_type
    from public.machines where id = new.machine_id;
    if v_machine_company_id is null or v_machine_company_id <> new.company_id then
      raise exception 'Production job machine does not belong to the selected company' using errcode = '23514';
    end if;
    if v_machine_type <> 'extrusion_press' then
      raise exception 'Production jobs require an extrusion press machine' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$


-- FN public.validate_production_plan_slot_tenant
CREATE OR REPLACE FUNCTION public.validate_production_plan_slot_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1
    from public.production_jobs pj
    where pj.id = new.production_job_id
      and pj.company_id = new.company_id
  ) then
    raise exception 'Production plan slot job must belong to the same company' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.machines m
    where m.id = new.machine_id
      and m.company_id = new.company_id
  ) then
    raise exception 'Production plan slot machine must belong to the same company' using errcode = '23514';
  end if;

  if new.locked_by is not null and not exists (
    select 1
    from public.app_users au
    where au.id = new.locked_by
      and au.company_id = new.company_id
      and au.is_active = true
  ) then
    raise exception 'Production plan slot lock owner must belong to the same company' using errcode = '23514';
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.app_users au
    where au.id = new.created_by
      and au.company_id = new.company_id
      and au.is_active = true
  ) then
    raise exception 'Production plan slot creator must belong to the same company' using errcode = '23514';
  end if;

  return new;
end;
$function$


-- FN public.validate_profile_stock_batch_profile_company
CREATE OR REPLACE FUNCTION public.validate_profile_stock_batch_profile_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1
    from public.aluminium_profiles p
    where p.id = new.profile_id
      and p.company_id = new.company_id
  ) then
    raise exception 'Profile does not belong to the stock batch company';
  end if;
  return new;
end;
$function$


-- FN public.validate_quality_production_link
CREATE OR REPLACE FUNCTION public.validate_quality_production_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_job record;
  v_finishing record;
  v_source_kg numeric;
  v_disposed_kg numeric;
begin
  if new.production_job_id is null then
    if tg_op = 'INSERT' or new.status in ('approved','rejected','rework') then raise exception 'Select the completed production job inspected by this QC record' using errcode = '23514'; end if;
    return new;
  end if;
  select id, company_id, order_id, profile_id, status, actual_quantity_kg, finishing_type
  into v_job from public.production_jobs where id = new.production_job_id for update nowait;
  if not found or v_job.company_id <> new.company_id or v_job.profile_id <> new.profile_id or v_job.status <> 'completed' then
    raise exception 'QC must link to completed production for the same company/profile' using errcode = '23514';
  end if;
  v_source_kg := v_job.actual_quantity_kg;
  if coalesce(v_job.finishing_type,'mill_finish') <> 'mill_finish' then
    if new.finishing_job_id is null then raise exception 'Post-finishing QC must link a final accepted finishing receipt' using errcode = '23514'; end if;
    select id, company_id, production_job_id, status, output_weight_kg into v_finishing from public.finishing_jobs where id = new.finishing_job_id;
    if not found or v_finishing.company_id <> new.company_id or v_finishing.production_job_id <> new.production_job_id or v_finishing.status not in ('completed','rejected') then
      raise exception 'QC requires a final accepted finishing receipt for this production job' using errcode = '23514';
    end if;
    v_source_kg := private.finishing_accepted_output_kg(new.company_id,new.production_job_id,new.finishing_job_id);
    if v_source_kg<=0 then raise exception 'QC requires a final accepted finishing receipt'; end if;
  elsif new.finishing_job_id is not null then raise exception 'Mill-finish QC must not link an unrelated finishing job' using errcode = '23514'; end if;

  if new.status in ('approved','rejected','rework') then
    if coalesce(new.quantity_checked_kg,0) <= 0 then raise exception 'QC disposition quantity must be greater than zero' using errcode = '23514'; end if;
    perform pg_advisory_xact_lock(hashtextextended('qc-disposition:' || new.company_id::text || ':' || new.production_job_id::text || ':' || coalesce(new.finishing_job_id::text,'mill-finish'),0));
    select coalesce(sum(q.quantity_checked_kg),0) into v_disposed_kg from public.quality_inspections q
    where q.company_id=new.company_id and q.production_job_id=new.production_job_id
      and coalesce(q.finishing_job_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(new.finishing_job_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and q.status in ('approved','rejected','rework') and q.id <> coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
      and not exists(select 1 from public.quality_rework_resolutions resolution where resolution.source_inspection_id=q.id);
    if v_disposed_kg + new.quantity_checked_kg > v_source_kg + 0.01 then raise exception 'QC disposition exceeds available source output (%)',v_source_kg using errcode='23514'; end if;
  end if;
  if new.status='approved' then
    if coalesce(btrim(new.inspector_name),'')='' then raise exception 'Approved QC requires an inspector name' using errcode='23514'; end if;
    if new.surface_finish_ok is distinct from true then raise exception 'QC cannot be approved while surface finish is marked failed' using errcode='23514'; end if;
  end if;
  if new.resolution_id is not null and not exists(select 1 from public.quality_rework_resolutions r where r.id=new.resolution_id
    and r.company_id=new.company_id and r.production_job_id=new.production_job_id and r.finishing_job_id is not distinct from new.finishing_job_id and r.profile_id=new.profile_id
    and ((new.status='approved' and new.quantity_checked_kg <= r.approved_weight_kg) or (new.status='rejected' and new.quantity_checked_kg <= r.rejected_weight_kg))) then
    raise exception 'Resolved QC disposition must match its immutable rework resolution';
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Production output is being corrected; retry quality disposition after refresh' using errcode='55P03';
end;
$function$
