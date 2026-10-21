-- EXOS-AUD-015: cancelling a production job stranded its billets, and the job
-- save function edited completed or cancelled jobs.
--
--   * Cancelling a job (transition_production_job_atomic) now releases every
--     allocated or issued billet linked to it. A billet that still has complete
--     order-allocation lineage returns to 'allocated' for its order; otherwise it
--     returns to 'cast' stock. Consumed billets are never touched.
--   * The same release path is used when a billet is deselected in the job save.
--     Previously that update was rejected by the in-house billet guard
--     ("Committed billet status cannot regress"), so deselecting an issued
--     in-house billet could not be saved at all.
--   * The in-house billet guard accepts this release only inside the release
--     helper (per-transaction authorization row, same pattern as the completion
--     authorization), with physical attributes and allocation lineage unchanged.
--   * save_production_job_atomic rejects completed and cancelled jobs, and no
--     longer changes job status (status moves only through the transition and
--     completion workflows).
-- Existing rows are not rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists private.production_billet_release_authorizations (
  transaction_id bigint not null,
  job_id uuid not null references public.production_jobs(id) on delete cascade,
  company_id uuid not null,
  actor_id uuid not null,
  primary key (transaction_id, job_id)
);
revoke all on private.production_billet_release_authorizations from public, anon, authenticated;

create or replace function private.release_production_job_billets(p_company_id uuid, p_job_id uuid, p_keep_billet_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_released integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into private.production_billet_release_authorizations(transaction_id, job_id, company_id, actor_id)
  values (txid_current(), p_job_id, p_company_id, auth.uid())
  on conflict (transaction_id, job_id) do nothing;

  with released as (
    update public.foundry_billets b
    set production_job_id = null,
        status = case when b.order_id is not null and b.allocation_requirement_id is not null
          and b.allocated_at is not null and b.allocated_by is not null then 'allocated' else 'cast' end,
        order_id = case when b.order_id is not null and b.allocation_requirement_id is not null
          and b.allocated_at is not null and b.allocated_by is not null then b.order_id else null end,
        allocation_requirement_id = case when b.order_id is not null and b.allocation_requirement_id is not null
          and b.allocated_at is not null and b.allocated_by is not null then b.allocation_requirement_id else null end,
        allocated_at = case when b.order_id is not null and b.allocation_requirement_id is not null
          and b.allocated_at is not null and b.allocated_by is not null then b.allocated_at else null end,
        allocated_by = case when b.order_id is not null and b.allocation_requirement_id is not null
          and b.allocated_at is not null and b.allocated_by is not null then b.allocated_by else null end,
        updated_at = now()
    where b.company_id = p_company_id
      and b.production_job_id = p_job_id
      and b.status in ('issued','allocated')
      and (p_keep_billet_ids is null or cardinality(p_keep_billet_ids) = 0 or not (b.id = any(p_keep_billet_ids)))
    returning 1
  )
  select count(*) into v_released from released;

  delete from private.production_billet_release_authorizations
  where transaction_id = txid_current() and job_id = p_job_id;
  return v_released;
end;
$$;
revoke all on function private.release_production_job_billets(uuid, uuid, uuid[]) from public, anon, authenticated;

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
  v_release_authorized boolean := false;
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
  if tg_op = 'UPDATE' and old.production_job_id is not null and new.production_job_id is null
    and old.status in ('allocated','issued') and new.status in ('allocated','cast')
    and row(old.weight_kg, old.billet_diameter_inch, old.billet_diameter_mm, old.billet_length_mm, old.alloy, old.temper)
      is not distinct from row(new.weight_kg, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_length_mm, new.alloy, new.temper)
    and (new.status = 'cast' or (old.order_id is not distinct from new.order_id
      and old.allocation_requirement_id is not distinct from new.allocation_requirement_id
      and old.allocated_at is not distinct from new.allocated_at and old.allocated_by is not distinct from new.allocated_by))
    and exists (select 1 from private.production_billet_release_authorizations release_auth
      where release_auth.transaction_id = txid_current() and release_auth.job_id = old.production_job_id
        and release_auth.company_id = old.company_id and release_auth.actor_id = auth.uid()) then
    v_release_authorized := true;
  end if;
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
  if tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'cast' and pg_trigger_depth() < 2 and not v_release_authorized then
    raise exception 'Cast stock status is maintained only by the batch workflow';
  end if;
  if tg_op = 'UPDATE' and not v_release_authorized then
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
$function$;

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
  if p_status = 'cancelled' then
    perform private.release_production_job_billets(v_company_id, v_job.id, null);
  end if;
  return v_job.id;
end;
$function$;

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
  v_existing_status text;
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

    -- H3: selected billets must match the job profile's required diameter and alloy.
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
            and lower(btrim(coalesce(b.alloy, ''))) <> lower(btrim(v_req_alloy)))
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
    select status into v_existing_status from public.production_jobs where id = p_job_id and company_id = v_company_id for update;
    if not found then raise exception 'Production job not found for this company'; end if;
    if v_existing_status in ('completed','cancelled') then
      raise exception 'A % production job cannot be edited; use the output correction workflow for completed jobs', v_existing_status using errcode = '23514';
    end if;
    -- Status moves only through the transition and completion workflows.
    v_payload := v_payload || jsonb_build_object('status', v_existing_status);
    v_job_id := private.update_jsonb_row(
      'public.production_jobs'::regclass,
      p_job_id,
      v_company_id,
      v_payload || jsonb_build_object('updated_at', now())
    );
  end if;

  -- H2: release billets previously linked to this job but no longer selected. Consumed
  -- billets are never touched (only 'issued'/'allocated' are freed back to 'allocated').
  perform private.release_production_job_billets(v_company_id, v_job_id, p_billet_ids);

  if v_expected > 0 then
    update public.foundry_billets
    set production_job_id = v_job_id,
        status = 'issued',
        order_id = v_order_id,
        updated_at = now()
    where company_id = v_company_id and id = any(p_billet_ids);
  end if;
  return v_job_id;
end;
$function$;

commit;
