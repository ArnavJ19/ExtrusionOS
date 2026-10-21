-- EXOS-AUD-031: saving the production plan marked the selected billets 'issued',
-- so "issued" stock overstated the metal physically at the press.
--
--   * save_production_job_atomic now only links the selected billets to the job
--     (they stay 'allocated'; billets already issued stay issued).
--   * public.issue_production_billets(job, billet_ids) is the physical issue
--     (owner, admin, factory_manager, production_manager, production): linked,
--     allocated billets of a planned/ready/on-hold/running job become 'issued',
--     recorded in public.production_billet_issues.
--   * Starting a job that needs billets still requires at least one issued billet.
-- Billets issued before this migration keep their status.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.production_billet_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  billet_id uuid not null references public.foundry_billets(id) on delete cascade,
  issued_by uuid not null references auth.users(id),
  issued_at timestamptz not null default now(),
  unique (billet_id, production_job_id)
);
create index if not exists production_billet_issues_company_job_idx on public.production_billet_issues(company_id, production_job_id);
alter table public.production_billet_issues enable row level security;
drop policy if exists "production billet issues tenant read" on public.production_billet_issues;
create policy "production billet issues tenant read" on public.production_billet_issues
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.production_billet_issues from public, anon, authenticated;
grant select on public.production_billet_issues to authenticated;

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
    -- EXOS-AUD-031: planning links billets to the job; the physical issue to the
    -- press is a separate step (public.issue_production_billets).
    update public.foundry_billets
    set production_job_id = v_job_id,
        order_id = v_order_id,
        updated_at = now()
    where company_id = v_company_id and id = any(p_billet_ids);
  end if;
  return v_job_id;
end;
$function$;

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
      raise exception 'Issue at least one linked billet to the press before starting production'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function private.issue_production_billets(p_job_id uuid, p_billet_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_status text;
  v_ids uuid[];
  v_count integer;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'Permission denied to issue billets' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_billet_ids, array[]::uuid[])) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Select the billets taken to the press' using errcode = '23514'; end if;
  select status into v_status from public.production_jobs where id = p_job_id and company_id = v_company_id for update;
  if not found then raise exception 'Production job not found for this company' using errcode = '23514'; end if;
  if v_status not in ('planned','ready','in_progress','on_hold') then
    raise exception 'Billets cannot be issued to a % job', v_status using errcode = '23514';
  end if;
  perform 1 from public.foundry_billets where company_id = v_company_id and id = any(v_ids) for update;
  if (select count(*) from public.foundry_billets b where b.company_id = v_company_id and b.id = any(v_ids)
      and b.production_job_id = p_job_id and b.status = 'allocated') <> cardinality(v_ids) then
    raise exception 'Only billets linked to this job and still allocated can be issued' using errcode = '23514';
  end if;
  update public.foundry_billets set status = 'issued', updated_at = now()
  where company_id = v_company_id and id = any(v_ids) and production_job_id = p_job_id and status = 'allocated';
  get diagnostics v_count = row_count;
  insert into public.production_billet_issues(company_id, production_job_id, billet_id, issued_by)
  select v_company_id, p_job_id, x, auth.uid() from unnest(v_ids) x
  on conflict (billet_id, production_job_id) do nothing;
  return v_count;
end;
$$;
revoke all on function private.issue_production_billets(uuid, uuid[]) from public, anon, authenticated;
create or replace function public.issue_production_billets(p_job_id uuid, p_billet_ids uuid[])
returns integer language sql security definer set search_path = public, private
as $$ select private.issue_production_billets(p_job_id, p_billet_ids) $$;
revoke all on function public.issue_production_billets(uuid, uuid[]) from public, anon;
grant execute on function public.issue_production_billets(uuid, uuid[]) to authenticated;

commit;
