-- Production job billet handling hardening (material-flow audit H2 + H3).
-- Redefines private.save_production_job_atomic (the public wrapper is unchanged) to:
--   H2: release billets previously linked to a job but no longer selected on edit, so a
--       partial re-plan does not leave stale 'issued' billets that get force-consumed on
--       completion (and over-count the mass balance).
--   H3: enforce, server-side, that every selected billet matches the job profile's required
--       billet diameter and alloy (previously only the bypassable client filter did this).
-- Body is otherwise identical to 20260715000000_atomic_business_workflows.sql.

create or replace function private.save_production_job_atomic(
  p_job_id uuid,
  p_job jsonb,
  p_billet_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
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

  -- H2: release billets previously linked to this job but no longer selected. Consumed
  -- billets are never touched (only 'issued'/'allocated' are freed back to 'allocated').
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
$$;
