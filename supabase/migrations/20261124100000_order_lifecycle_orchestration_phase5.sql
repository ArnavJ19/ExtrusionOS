-- Order lifecycle orchestration, Phase 5 — manufacturing and quality connected (directive sections 15-20; strategy
-- phase 5: production runs, first-stage QC, ageing, final QC, partial acceptance, holds, rework, rejection, remelt).
--
--   * Ageing route per job: the profile's active routing (an ageing / heat-treatment step), else its recorded ageing or
--     heat-treatment requirement, else its temper (T5-T9 need artificial ageing; F, O, H and T1-T4 do not). When none of
--     these says, the route is "not documented": nothing is assumed and no ageing work is raised.
--   * Production runs: a start notifies production planning and the production supervisor; a hold of a running job
--     notifies the production manager with the recorded reason and resume condition; a completed run gives QA one
--     "initial QC required" task that closes only when every produced kilogram has a QC decision (held kilograms are
--     covered by their containment task).
--   * Ageing: QC-approved output of a job that needs ageing gives the ageing team a task that closes when that much is
--     loaded into treatment batches. Loading, start, end, interruption and review of each batch are recorded on the
--     order timeline. A running cycle past its recipe's maximum soak plus a grace period gives the ageing team an
--     overdue task; a reading outside the recipe range alerts QA, the production supervisor and factory management
--     once per batch. An ended cycle gives QA a treatment-review task.
--   * Final QC after ageing: QA records the final inspection (properties measured, method, sampling plan, certificate)
--     for kilograms that came out of the treatment review, accepting and/or rejecting a quantity; anything not yet
--     recorded stays awaiting final QC (held for investigation). Acceptance is refused when a measured property is
--     below the profile's recorded minimum. Rejected kilograms reverse the first-stage approval through the Phase 4
--     reversal action (status 'reversed' plus a rejected child), so the approved-kg ledger, packaging caps, supply to
--     the order, reproduction and the remelt approval all follow without being rewritten. QA gets a final-QC task.
--   * Optional control (company setting, default off): material is loaded for ageing only up to its first-stage QC
--     approval, and a job that needs ageing is packed only up to the kilograms released by final QC.
--   * Order lifecycle: an ageing domain, per-job quality flow and the ageing / final-QC quantities; the next action
--     moves from "pack" to the ageing or final-QC step while that work is open.
-- Additive: new table, settings, task kinds, triggers and wrappers. olo_job_consumed_kg is redefined with one added
-- condition (marked "Phase 5"); every other earlier function is wrapped, not rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ---------------------------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------------------------
alter table public.olo_settings
  add column if not exists enforce_qc_route boolean not null default false,
  add column if not exists ageing_overdue_grace_minutes smallint not null default 60 check (ageing_overdue_grace_minutes between 0 and 720);

create or replace function private.olo_settings_for(p_company uuid) returns public.olo_settings
language plpgsql stable security definer set search_path = public, private as $$
declare s public.olo_settings;
begin
  select * into s from public.olo_settings where company_id = p_company;
  if not found then
    s.company_id := p_company; s.billet_rank_threshold := 5; s.die_rank_threshold := 3; s.material_risk_horizon_days := 21;
    s.ack_sla_hours := 4; s.action_sla_hours := 24; s.enforce_die_preparation := false; s.enforce_preheat := false;
    s.delivery_confirmation_days := 3; s.reproduction_tolerance_kg := 1; s.dispatch_release_hours := 48;
    s.enforce_qc_route := false; s.ageing_overdue_grace_minutes := 60;
  end if;
  return s;
end;
$$;

-- The Phase 4 command keeps every command; this wrapper saves the two Phase 5 settings.
alter function public.olo_command(text, jsonb) rename to olo_command_p4;
alter function public.olo_command_p4(text, jsonb) set schema private;
revoke all on function private.olo_command_p4(text, jsonb) from public, anon, authenticated;

create or replace function public.olo_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_payload jsonb := coalesce(p_payload, '{}'::jsonb); a jsonb; v_before public.olo_settings; v_enforce boolean; v_grace integer; v_rest jsonb;
  v_keys text[] := array['enforce_qc_route','ageing_overdue_grace_minutes'];
begin
  if p_command <> 'settings.save' or jsonb_typeof(v_payload) is distinct from 'object' or not (v_payload ?| v_keys) then
    return private.olo_command_p4(p_command, v_payload);
  end if;
  a := private.olo_actor(private.olo_reader_roles());
  if (a ->> 'role') not in ('owner','admin','factory_manager') then
    raise exception 'Only the owner, admin or factory manager can change orchestration settings' using errcode = '42501';
  end if;
  if v_payload ? 'enforce_qc_route' and jsonb_typeof(v_payload -> 'enforce_qc_route') is distinct from 'boolean' then
    raise exception 'The QC route control is on or off' using errcode = '22023';
  end if;
  v_enforce := (v_payload ->> 'enforce_qc_route')::boolean;
  begin
    v_grace := (v_payload ->> 'ageing_overdue_grace_minutes')::integer;
  exception when others then
    raise exception 'Settings must be numbers' using errcode = '22023';
  end;
  if v_grace is not null and v_grace not between 0 and 720 then raise exception 'The ageing overdue grace must be 0 to 720 minutes' using errcode = '23514'; end if;
  v_before := private.olo_settings_for((a ->> 'company')::uuid);
  v_rest := v_payload - v_keys;
  -- The earlier saves write and log their own fields; when only these settings change, the row is created if missing.
  if v_rest <> '{}'::jsonb then
    perform private.olo_command_p4('settings.save', v_rest);
  else
    insert into public.olo_settings(company_id, updated_by) values ((a ->> 'company')::uuid, (a ->> 'actor')::uuid) on conflict (company_id) do nothing;
  end if;
  update public.olo_settings set enforce_qc_route = coalesce(v_enforce, enforce_qc_route),
    ageing_overdue_grace_minutes = coalesce(v_grace, ageing_overdue_grace_minutes), updated_by = (a ->> 'actor')::uuid, updated_at = now()
    where company_id = (a ->> 'company')::uuid;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values ((a ->> 'company')::uuid, (a ->> 'actor')::uuid, 'olo_settings.updated', 'olo_settings', (a ->> 'company')::uuid,
      jsonb_build_object('before', jsonb_build_object('enforce_qc_route', v_before.enforce_qc_route, 'ageing_overdue_grace_minutes', v_before.ageing_overdue_grace_minutes),
        'changes', jsonb_strip_nulls(jsonb_build_object('enforce_qc_route', v_enforce, 'ageing_overdue_grace_minutes', v_grace))));
  return to_jsonb(private.olo_settings_for((a ->> 'company')::uuid)) - 'company_id';
end;
$$;
revoke all on function public.olo_command(text, jsonb) from public, anon;
grant execute on function public.olo_command(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Task vocabulary
-- ---------------------------------------------------------------------------------------------------------------
alter table public.tasks drop constraint if exists tasks_workflow_shape_check;
alter table public.tasks add constraint tasks_workflow_shape_check check (
  (workflow_key is null and workflow_kind is null and workflow_department is null and workflow_cycle is null and workflow_due_at is null)
  or (workflow_key is not null and workflow_kind in ('billet_allocation','die_preparation','billet_shortage','reproduction','delivery_confirmation',
        'delivery_followup','containment','remelt_approval','remelt_receipt','priority_approval','dispatch_clearance','dispatch_intimation',
        'initial_qc','ageing_release','ageing_cycle','ageing_review','final_qc')
      and workflow_department = any(private.olo_departments()) and workflow_cycle >= 1 and workflow_due_at is not null
      and workflow_escalation_level between 0 and 3));

create or replace function private.olo_guard_workflow_task() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_system boolean := coalesce(current_setting('olo.system', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.workflow_key is not null and not v_system then
      raise exception 'Workflow tasks are created by the order lifecycle engine' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.workflow_key is null and new.workflow_key is null then return new; end if;
  if (new.workflow_key, new.workflow_kind, new.workflow_department, new.workflow_order_id, new.workflow_job_id, new.workflow_source_id, new.workflow_cycle)
     is distinct from (old.workflow_key, old.workflow_kind, old.workflow_department, old.workflow_order_id, old.workflow_job_id, old.workflow_source_id, old.workflow_cycle) then
    raise exception 'The workflow identity of a task cannot be changed' using errcode = '42501';
  end if;
  if not v_system and new.status is distinct from old.status and new.status in ('completed','cancelled') then
    raise exception '%', case old.workflow_kind
      when 'billet_allocation' then 'This task closes when the billets are allocated in the billet records. Allocate them, and the task completes itself.'
      when 'die_preparation' then 'This task closes when the die preparation is recorded as prepared. Record the die check and preparation, and the task completes itself.'
      when 'billet_shortage' then 'This task closes when the billet shortfall is covered by allocated or available compatible billets.'
      when 'reproduction' then 'This task closes when planned production, held material or an approved short closure covers the order.'
      when 'delivery_confirmation' then 'This task closes when the dispatch is recorded as delivered, returned or damaged.'
      when 'delivery_followup' then 'This task closes when the customer disposition of every delivered bundle is recorded.'
      when 'containment' then 'This task closes when QA resolves every kilogram of the contained lot.'
      when 'remelt_approval' then 'This task closes when the factory manager or owner decides the remelt request.'
      when 'remelt_receipt' then 'This task closes when the foundry weighs in the approved material.'
      when 'priority_approval' then 'This task closes when the priority request is decided.'
      when 'dispatch_clearance' then 'This task closes when the payment covers the dispatch under the customer''s terms, or accounts record a release.'
      when 'dispatch_intimation' then 'This task closes when the dispatch update is recorded as sent to the customer.'
      when 'initial_qc' then 'This task closes when every produced kilogram of the run has a QC decision.'
      when 'ageing_release' then 'This task closes when the QC-released material is loaded into an ageing batch.'
      when 'ageing_cycle' then 'This task closes when the ageing cycle is ended or recorded as interrupted.'
      when 'ageing_review' then 'This task closes when QA records the treatment review of the batch.'
      else 'This task closes when QA records the final QC of the material that came out of ageing.' end
      using errcode = '23514';
  end if;
  if not v_system and (new.workflow_escalation_level, new.workflow_escalated_at, new.workflow_due_at, new.completion_evidence, new.resolved_by_system_at)
     is distinct from (old.workflow_escalation_level, old.workflow_escalated_at, old.workflow_due_at, old.completion_evidence, old.resolved_by_system_at) then
    raise exception 'Escalation, due time and completion evidence of a workflow task are kept by the engine' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Ageing route and the quality flow of a job
-- ---------------------------------------------------------------------------------------------------------------
-- 'required', 'not_required' or 'undocumented', with the record it was read from. Nothing is assumed when the
-- profile's routing, ageing requirement and temper are all silent.
create or replace function private.olo_job_route(p_company uuid, p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v_profile uuid; pr public.aluminium_profiles%rowtype; v_steps integer; v_step text; v_text text; v_temper text;
begin
  select pj.profile_id into v_profile from public.production_jobs pj where pj.id = p_job and pj.company_id = p_company;
  if v_profile is null then return jsonb_build_object('state', 'undocumented', 'source', null, 'detail', 'The job has no profile'); end if;
  select * into pr from public.aluminium_profiles where id = v_profile and company_id = p_company;
  -- Whole words only: "packaging" must not read as "aging".
  select count(*), min(rs.stage_name) filter (where rs.is_required and (rs.stage_name ~* '(\mageing\M|\maging\M|\mheat[ _-]?treat|\martificial\M|\moven\M)'
      or coalesce(rs.department, '') ~* '(\mageing\M|\maging\M|\mheat[ _-]?treat)'))
    into v_steps, v_step
    from public.profile_routing_steps rs where rs.company_id = p_company and rs.profile_id = v_profile and rs.is_active;
  if v_steps > 0 then
    return jsonb_build_object('state', case when v_step is not null then 'required' else 'not_required' end, 'source', 'routing',
      'detail', coalesce('Routing step: ' || v_step, 'The profile routing has no ageing step'), 'temper', pr.temper);
  end if;
  v_text := lower(btrim(coalesce(nullif(btrim(pr.aging_requirement), ''), nullif(btrim(pr.heat_treatment_requirement), ''), '')));
  if v_text <> '' then
    return jsonb_build_object('state', case when v_text ~ '^(no|none|nil|n/?a|t4)$' or v_text ~ '(not required|not applicable|natural)' then 'not_required' else 'required' end,
      'source', 'profile', 'detail', left(coalesce(nullif(btrim(pr.aging_requirement), ''), pr.heat_treatment_requirement), 120), 'temper', pr.temper);
  end if;
  v_temper := upper(btrim(coalesce(nullif(btrim(pr.temper), ''), nullif(btrim(pr.temper_requirement), ''), '')));
  if v_temper ~ '^T[5-9]' then
    return jsonb_build_object('state', 'required', 'source', 'temper', 'detail', 'Temper ' || v_temper || ' is artificially aged', 'temper', v_temper);
  elsif v_temper ~ '^(F|O|H[0-9]*|T[1-4])([0-9]*)$' then
    return jsonb_build_object('state', 'not_required', 'source', 'temper', 'detail', 'Temper ' || v_temper || ' needs no artificial ageing', 'temper', v_temper);
  end if;
  return jsonb_build_object('state', 'undocumented', 'source', null, 'temper', nullif(v_temper, ''),
    'detail', 'The profile records no routing, ageing requirement or recognised temper; confirm whether the material is aged');
end;
$$;

-- The first-stage QC of a job is the QC of its own finished output: a mill-finish job is inspected as extruded (no
-- finishing job), a powder-coated or anodized job only after finishing (validate_quality_production_link requires each
-- of its inspections to name an accepted finishing receipt). Every reader of first-stage approvals on the ageing /
-- final-QC path selects inspections by this stage.
create or replace function private.olo_job_qc_after_finishing(p_company uuid, p_job uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce((select coalesce(pj.finishing_type, 'mill_finish') <> 'mill_finish' from public.production_jobs pj
    where pj.id = p_job and pj.company_id = p_company), false)
$$;

-- Kilograms of a job that reach its first-stage QC. Mill finish: the run's output. After finishing: the accepted
-- output of every received finishing receipt (original or corrective retry, each the source a disposition is capped
-- at) plus run output not yet received back from finishing, which still awaits that QC.
create or replace function private.olo_job_qc_source_kg(p_company uuid, p_job uuid, p_produced numeric) returns numeric
language sql stable security definer set search_path = public, private as $$
  select case when not private.olo_job_qc_after_finishing(p_company, p_job) then p_produced
    else coalesce((select sum(f.output_weight_kg) from public.finishing_jobs f where f.company_id = p_company and f.production_job_id = p_job
        and f.status in ('completed','rejected') and f.received_date is not null and f.output_weight_kg > 0), 0)
      + greatest(p_produced - coalesce((select sum(f.input_weight_kg) from public.finishing_jobs f where f.company_id = p_company and f.production_job_id = p_job
        and f.retry_of_finishing_job_id is null and f.status in ('completed','rejected') and f.received_date is not null), 0), 0) end
$$;
revoke all on function private.olo_job_qc_after_finishing(uuid, uuid), private.olo_job_qc_source_kg(uuid, uuid, numeric) from public, anon, authenticated;

-- Each figure describes one physical state of the job's output and comes from its own record; they are never added
-- across states. Final-QC rejections reverse the first-stage approval, so approved + rejected-at-final is what passed
-- first-stage QC.
create or replace function private.olo_job_quality_flow(p_company uuid, p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare j public.production_jobs%rowtype; v_route jsonb; v_tol numeric := (private.olo_settings_for(p_company)).reproduction_tolerance_kg;
  v_produced numeric; v_approved numeric; v_rejected numeric; v_pending numeric; v_rework numeric; v_decided numeric; v_held numeric; v_awaiting numeric;
  v_loaded numeric := 0; v_in numeric := 0; v_aged_ok numeric := 0; v_aged_rej numeric := 0; v_final_ok numeric := 0; v_final_rej numeric := 0;
  v_packed numeric; v_aw_ageing numeric := 0; v_aw_final numeric := 0; v_unaged numeric := 0; v_stage text; v_required boolean;
  v_after boolean; v_source numeric;
begin
  select * into j from public.production_jobs where id = p_job and company_id = p_company;
  if not found then return null; end if;
  v_route := private.olo_job_route(p_company, p_job);
  v_required := v_route ->> 'state' = 'required';
  v_after := private.olo_job_qc_after_finishing(p_company, p_job);
  v_produced := case when j.status in ('in_progress','completed','on_hold') then coalesce(j.actual_quantity_kg, 0) else 0 end;
  v_source := private.olo_job_qc_source_kg(p_company, p_job, v_produced);
  -- First-stage QC is the job's own stage: as extruded for mill finish, after finishing for coated or anodized output.
  select coalesce(sum(qi.quantity_checked_kg) filter (where qi.status = 'approved'), 0), coalesce(sum(qi.quantity_checked_kg) filter (where qi.status = 'rejected'), 0),
    coalesce(sum(qi.quantity_checked_kg) filter (where qi.status = 'pending'), 0),
    coalesce(sum(qi.quantity_checked_kg) filter (where qi.status = 'rework' and not exists (select 1 from public.quality_rework_resolutions rr where rr.source_inspection_id = qi.id)), 0)
    into v_approved, v_rejected, v_pending, v_rework
  from public.quality_inspections qi where qi.company_id = p_company and qi.production_job_id = p_job and (qi.finishing_job_id is not null) = v_after;
  v_decided := v_approved + v_rejected;
  select coalesce(sum(qc.scope_kg - qc.released_accepted_kg - qc.released_rejected_kg), 0) into v_held
    from public.quality_containments qc where qc.company_id = p_company and qc.production_job_id = p_job and qc.status in ('open','partially_resolved');
  v_awaiting := greatest(v_source - v_decided - v_held, 0);
  -- Material that has left QC: packaging jobs that have started, or packed and prepared bundles and stock made from
  -- the job. A 'scheduled'
  -- packaging job is the queue entry created when a mill-finish run completes, not packed material.
  v_packed := greatest(
    coalesce((select sum(x.profile_weight_kg) from public.packaging_jobs x where x.company_id = p_company and x.production_job_id = p_job and x.status in ('in_progress','completed')), 0),
    private.olo_job_released_material_kg(p_company, p_job));
  if v_required then
    select coalesce(sum(ti.quantity_kg) filter (where tb.retreatment_of is null), 0),
      coalesce(sum(ti.quantity_kg) filter (where tb.status in ('loaded','running','ended','interrupted')), 0),
      coalesce(sum(ti.accepted_kg), 0), coalesce(sum(ti.rejected_kg), 0)
      into v_loaded, v_in, v_aged_ok, v_aged_rej
    from public.treatment_inputs ti join public.treatment_batches tb on tb.id = ti.batch_id and tb.company_id = ti.company_id
    where ti.company_id = p_company and ti.production_job_id = p_job;
    select coalesce(sum(f.accepted_kg), 0), coalesce(sum(f.rejected_kg), 0) into v_final_ok, v_final_rej
      from public.final_qc_records f where f.company_id = p_company and f.production_job_id = p_job;
    v_unaged := greatest(v_packed - v_final_ok, 0);
    v_aw_ageing := greatest(v_approved + v_final_rej - v_loaded - v_unaged, 0);
    v_aw_final := greatest(v_aged_ok + v_aged_rej - v_final_ok - v_final_rej, 0);
  end if;
  v_stage := case
    when v_produced <= 0 then 'not_started'
    when v_held > v_tol then 'contained'
    when v_awaiting > v_tol or v_pending + v_rework > v_tol then 'awaiting_initial_qc'
    when not v_required then case when v_approved > 0 then 'released' when v_rejected > 0 then 'rejected' else 'awaiting_initial_qc' end
    when v_aw_ageing > v_tol then 'awaiting_ageing'
    when v_in > v_tol then 'in_ageing'
    when v_aw_final > v_tol then 'awaiting_final_qc'
    when v_final_ok > 0 then 'released'
    when v_rejected > 0 and v_approved <= v_tol then 'rejected'
    else 'awaiting_ageing' end;
  return jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'order_id', j.order_id, 'job_status', j.status, 'route', v_route, 'stage', v_stage,
    'qc_stage', case when v_after then 'after_finishing' else 'production' end, 'qc_source_kg', v_source,
    'produced_kg', v_produced, 'approved_kg', v_approved, 'rejected_kg', v_rejected, 'pending_kg', v_pending, 'rework_open_kg', v_rework, 'held_kg', v_held,
    'awaiting_decision_kg', v_awaiting, 'packed_kg', v_packed, 'loaded_kg', v_loaded, 'in_ageing_kg', v_in, 'aged_accepted_kg', v_aged_ok, 'aged_rejected_kg', v_aged_rej,
    'final_accepted_kg', v_final_ok, 'final_rejected_kg', v_final_rej, 'awaiting_ageing_kg', v_aw_ageing, 'awaiting_final_kg', v_aw_final, 'packed_unaged_kg', v_unaged,
    'tolerance_kg', v_tol);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Final QC after ageing
-- ---------------------------------------------------------------------------------------------------------------
create table public.final_qc_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  record_number text not null,
  production_job_id uuid not null references public.production_jobs(id),
  order_id uuid references public.orders(id),
  profile_id uuid references public.aluminium_profiles(id),
  accepted_kg numeric(14,3) not null default 0 check (accepted_kg >= 0),
  rejected_kg numeric(14,3) not null default 0 check (rejected_kg >= 0),
  results jsonb not null check (jsonb_typeof(results) = 'object'),
  method text not null check (length(btrim(method)) between 2 and 120),
  sampling_reference text not null check (length(btrim(sampling_reference)) between 2 and 120),
  certificate_reference text check (certificate_reference is null or length(btrim(certificate_reference)) between 2 and 80),
  temper_verified text check (temper_verified is null or length(btrim(temper_verified)) between 1 and 10),
  rejection_reason text check (rejection_reason is null or length(btrim(rejection_reason)) between 10 and 500),
  note text check (note is null or length(note) <= 500),
  awaiting_before_kg numeric(14,3) not null check (awaiting_before_kg > 0),
  recorded_by uuid not null references public.app_users(id),
  recorded_by_role text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (company_id, record_number),
  check (accepted_kg + rejected_kg > 0),
  check (accepted_kg + rejected_kg <= awaiting_before_kg + 0.001),
  check ((rejected_kg > 0) = (rejection_reason is not null))
);
create index final_qc_records_list_idx on public.final_qc_records(company_id, recorded_at desc);
create index final_qc_records_job_idx on public.final_qc_records(production_job_id);
create index final_qc_records_order_idx on public.final_qc_records(order_id);
create index final_qc_records_profile_idx on public.final_qc_records(profile_id);
create index final_qc_records_people_idx on public.final_qc_records(recorded_by);
create trigger final_qc_records_append_only before update or delete on public.final_qc_records for each row execute function private.olo_append_only();

create or replace function private.olo_final_qc_number(p_company uuid) returns text language plpgsql security definer set search_path = public, private as $$
declare v_fy text := private.ap_fy_label(private.ist_today()); v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':olo-final-qc-number', 0));
  select count(*) + 1 into v_n from public.final_qc_records where company_id = p_company and record_number like 'FQC/' || v_fy || '/%';
  return 'FQC/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end;
$$;

-- Phase 5: during a final QC after ageing, the job's ageing loads are the material being dispositioned, not material
-- that has moved on. Every other caller sees the same quantities as before. (Migration 20261124200000 also stops
-- counting a packaging job that is only 'scheduled'.)
create or replace function private.olo_job_consumed_kg(p_company uuid, p_job uuid) returns numeric
language sql stable security definer set search_path = public, private as $$
  select greatest(
    coalesce((select sum(x.profile_weight_kg) from public.packaging_jobs x where x.company_id = p_company and x.production_job_id = p_job and x.status <> 'cancelled'), 0),
    coalesce((select sum(x.net_weight_kg) from public.packing_list_items x where x.company_id = p_company and x.source_kind = 'production' and x.source_line_id = p_job), 0)
      + coalesce((select sum(x.gross_weight_kg - x.tare_weight_kg) from public.prepared_physical_bundles x where x.company_id = p_company and x.source_kind = 'production'
          and x.source_line_id = p_job and x.dispatch_id is null), 0),
    case when coalesce(current_setting('olo.final_qc_job', true), '') = p_job::text then 0
      else coalesce((select sum(x.quantity_kg) from public.treatment_inputs x where x.company_id = p_company and x.production_job_id = p_job), 0) end)
$$;
revoke all on function private.olo_job_consumed_kg(uuid, uuid) from public, anon, authenticated;

create or replace function private.olo_final_qc_json(p_company uuid, p_id uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', f.id, 'record_number', f.record_number, 'job_id', f.production_job_id, 'job_number', j.job_number, 'order_id', f.order_id,
    'order_number', o.order_number, 'profile_code', (select profile_code from public.aluminium_profiles p where p.id = f.profile_id),
    'accepted_kg', f.accepted_kg, 'rejected_kg', f.rejected_kg, 'results', f.results, 'method', f.method, 'sampling_reference', f.sampling_reference,
    'certificate_reference', f.certificate_reference, 'temper_verified', f.temper_verified, 'rejection_reason', f.rejection_reason, 'note', f.note,
    'awaiting_before_kg', f.awaiting_before_kg, 'recorded_by_name', (select full_name from public.app_users u where u.id = f.recorded_by), 'recorded_at', f.recorded_at,
    'reversals', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reversal_number', r.reversal_number, 'reversed_kg', r.reversed_kg) order by r.reversed_at), '[]'::jsonb)
      from public.quality_reversals r where r.company_id = f.company_id and r.production_job_id = f.production_job_id and r.reference = f.record_number))
  from public.final_qc_records f join public.production_jobs j on j.id = f.production_job_id left join public.orders o on o.id = f.order_id
  where f.id = p_id and f.company_id = p_company
$$;

-- What QA needs to record the final QC of one job: route, quality flow, treatment batches, profile minimums, records.
create or replace function private.olo_final_qc_job(p_company uuid, p_job uuid, p_role text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare k jsonb; j public.production_jobs%rowtype; pr public.aluminium_profiles%rowtype; v_blocker text; v_containment text;
begin
  select * into j from public.production_jobs where id = p_job and company_id = p_company;
  if not found then return null; end if;
  select * into pr from public.aluminium_profiles where id = j.profile_id and company_id = p_company;
  k := private.olo_job_quality_flow(p_company, p_job);
  v_containment := private.olo_job_containment(p_company, p_job);
  v_blocker := case
    when p_role not in ('owner','quality') then 'Only QA/QC records the final QC.'
    when k -> 'route' ->> 'state' <> 'required' then 'This job''s route has no ageing step: its QC approval is the final release.'
    when v_containment is not null then format('Job output is under QC containment %s. Resolve it there first.', v_containment)
    when (k ->> 'awaiting_final_kg')::numeric <= 0.0005 then 'No material of this job is waiting for final QC: it must come out of a reviewed ageing batch first.'
    else null end;
  return k || jsonb_build_object('order_number', (select order_number from public.orders o where o.id = j.order_id), 'profile_code', pr.profile_code, 'alloy', pr.alloy,
    'temper', pr.temper, 'spec', jsonb_strip_nulls(jsonb_build_object('tensile_strength_mpa', pr.tensile_strength_mpa, 'yield_strength_mpa', pr.yield_strength_mpa,
      'elongation_percent', pr.elongation_percent, 'hardness_requirement', nullif(btrim(pr.hardness_requirement), ''), 'temper_requirement', nullif(btrim(pr.temper_requirement), ''))),
    'batches', (select coalesce(jsonb_agg(jsonb_build_object('batch_id', tb.id, 'batch_number', tb.batch_number, 'status', tb.status, 'recipe', tr.recipe_code || ' rev ' || tr.revision,
        'loaded_kg', ti.quantity_kg, 'accepted_kg', ti.accepted_kg, 'rejected_kg', ti.rejected_kg, 'retreat_kg', ti.retreat_kg, 'retreatment', tb.retreatment_of is not null,
        'started_at', tb.started_at, 'ended_at', tb.ended_at, 'reviewed_at', tb.reviewed_at) order by tb.created_at), '[]'::jsonb)
      from public.treatment_inputs ti join public.treatment_batches tb on tb.id = ti.batch_id and tb.company_id = ti.company_id
      join public.treatment_recipes tr on tr.id = tb.recipe_id and tr.company_id = tb.company_id
      where ti.company_id = p_company and ti.production_job_id = p_job),
    'records', (select coalesce(jsonb_agg(private.olo_final_qc_json(p_company, f.id) order by f.recorded_at desc), '[]'::jsonb)
      from public.final_qc_records f where f.company_id = p_company and f.production_job_id = p_job),
    'containment_number', v_containment,
    'max_accept_kg', greatest(least((k ->> 'awaiting_final_kg')::numeric, (k ->> 'aged_accepted_kg')::numeric - (k ->> 'final_accepted_kg')::numeric,
      (k ->> 'approved_kg')::numeric - (k ->> 'final_accepted_kg')::numeric), 0),
    'can_record', v_blocker is null, 'blocker', v_blocker);
end;
$$;

create or replace function private.olo_final_qc_results(p jsonb) returns jsonb language plpgsql immutable set search_path = public, private as $$
declare k text; v_out jsonb := '{}'::jsonb; v_num numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Record the final QC results' using errcode = '23514'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('hardness_webster','hardness_hb','tensile_strength_mpa','yield_strength_mpa','elongation_percent','conductivity_ms_m','dimensional_ok','surface_ok','samples_tested') then
      raise exception 'Unexpected result: %', k using errcode = '22023';
    end if;
    if jsonb_typeof(p -> k) = 'null' then continue; end if;
    if k in ('dimensional_ok','surface_ok') then
      if jsonb_typeof(p -> k) <> 'boolean' then raise exception 'Dimensional and surface checks are passed or failed' using errcode = '22023'; end if;
      v_out := v_out || jsonb_build_object(k, p -> k);
    else
      if jsonb_typeof(p -> k) <> 'number' then raise exception 'Measured results are numbers' using errcode = '22023'; end if;
      v_num := (p ->> k)::numeric;
      if v_num < 0 or (k = 'hardness_webster' and v_num > 25) or (k = 'hardness_hb' and v_num > 300) or (k in ('tensile_strength_mpa','yield_strength_mpa') and v_num > 1000)
         or (k = 'elongation_percent' and v_num > 100) or (k = 'conductivity_ms_m' and v_num > 70) or (k = 'samples_tested' and (v_num < 1 or v_num > 500 or v_num <> trunc(v_num))) then
        raise exception 'The % result is outside the possible range', replace(k, '_', ' ') using errcode = '23514';
      end if;
      v_out := v_out || jsonb_build_object(k, v_num);
    end if;
  end loop;
  if not (v_out ? 'samples_tested') then raise exception 'Record how many samples were tested' using errcode = '23514'; end if;
  if (select count(*) from jsonb_object_keys(v_out) x where x <> 'samples_tested') = 0 then
    raise exception 'Record at least one measured property or check' using errcode = '23514';
  end if;
  return v_out;
end;
$$;

create or replace function public.final_qc_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare a jsonb := private.olo_actor(private.olo_reader_roles()); v_actor uuid := (a ->> 'actor')::uuid; v_company uuid := (a ->> 'company')::uuid; v_role text := a ->> 'role';
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb); v_page integer := private.olo_page(coalesce(p_payload, '{}'::jsonb)); v_rows jsonb; v_total bigint; v_view text;
  j public.production_jobs%rowtype; pr public.aluminium_profiles%rowtype; k jsonb; v_results jsonb; v_ok numeric; v_rej numeric; v_left numeric; v_take numeric;
  v_id uuid := gen_random_uuid(); v_number text; v_order_number text; qi record; v_reversed jsonb := '[]'::jsonb; v_r jsonb; v_spec text; v_reason text; v_search text; v_sort text; v_dir text;
  v_after boolean; v_fin uuid;
begin
  if p_command = 'queue' then
    -- Server-side search, a filter and sorting, 10 per page.
    perform private.olo_keys(v_payload, array['view','page','search','sort','direction','rejected_only']);
    v_view := coalesce(nullif(v_payload ->> 'view', ''), 'awaiting');
    v_search := lower(btrim(coalesce(v_payload ->> 'search', '')));
    if length(v_search) > 80 then raise exception 'Search for at most 80 characters' using errcode = '22023'; end if;
    v_dir := coalesce(nullif(v_payload ->> 'direction', ''), case when v_view = 'recorded' then 'desc' else 'asc' end);
    if v_dir not in ('asc','desc') then raise exception 'Unknown sort direction' using errcode = '22023'; end if;
    if v_payload ? 'rejected_only' and jsonb_typeof(v_payload -> 'rejected_only') is distinct from 'boolean' then raise exception 'The rejection filter is on or off' using errcode = '22023'; end if;
    if v_view = 'recorded' then
      v_sort := coalesce(nullif(v_payload ->> 'sort', ''), 'recorded_at');
      if v_sort not in ('recorded_at','accepted_kg','rejected_kg') then raise exception 'Unknown sort' using errcode = '22023'; end if;
      select coalesce(jsonb_agg(private.olo_final_qc_json(v_company, x.id) order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
        select y.id, count(*) over () total, row_number() over (order by
            case when v_sort = 'recorded_at' and v_dir = 'asc' then y.recorded_at end asc, case when v_sort = 'recorded_at' and v_dir = 'desc' then y.recorded_at end desc,
            case when v_sort = 'accepted_kg' and v_dir = 'asc' then y.accepted_kg end asc, case when v_sort = 'accepted_kg' and v_dir = 'desc' then y.accepted_kg end desc,
            case when v_sort = 'rejected_kg' and v_dir = 'asc' then y.rejected_kg end asc, case when v_sort = 'rejected_kg' and v_dir = 'desc' then y.rejected_kg end desc,
            y.recorded_at desc, y.id) ord
        from (select f.id, f.recorded_at, f.accepted_kg, f.rejected_kg from public.final_qc_records f
            left join public.production_jobs fj on fj.id = f.production_job_id left join public.orders fo on fo.id = f.order_id
            where f.company_id = v_company and (coalesce((v_payload ->> 'rejected_only')::boolean, false) = false or f.rejected_kg > 0)
              and (v_search = '' or position(v_search in lower(concat_ws(' ', f.record_number, fj.job_number, fo.order_number, f.method, f.sampling_reference, f.certificate_reference))) > 0)) y
        order by ord offset (v_page - 1) * 10 limit 10) x;
    elsif v_view = 'awaiting' then
      v_sort := coalesce(nullif(v_payload ->> 'sort', ''), 'created_at');
      if v_sort not in ('created_at','awaiting_final_kg','awaiting_ageing_kg','job_number') then raise exception 'Unknown sort' using errcode = '22023'; end if;
      select coalesce(jsonb_agg(x.k || jsonb_build_object('order_number', x.order_number, 'profile_code', x.profile_code) order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
        select y.k, y.order_number, y.profile_code, count(*) over () total, row_number() over (order by
            case when v_sort = 'created_at' and v_dir = 'asc' then y.created_at end asc, case when v_sort = 'created_at' and v_dir = 'desc' then y.created_at end desc,
            case when v_sort = 'job_number' and v_dir = 'asc' then y.job_number end asc, case when v_sort = 'job_number' and v_dir = 'desc' then y.job_number end desc,
            case when v_sort in ('awaiting_final_kg','awaiting_ageing_kg') and v_dir = 'asc' then (y.k ->> v_sort)::numeric end asc,
            case when v_sort in ('awaiting_final_kg','awaiting_ageing_kg') and v_dir = 'desc' then (y.k ->> v_sort)::numeric end desc,
            y.created_at, y.id) ord from (
          select pj.id, pj.created_at, pj.job_number, o.order_number, p.profile_code, private.olo_job_quality_flow(v_company, pj.id) k
          from public.production_jobs pj left join public.orders o on o.id = pj.order_id left join public.aluminium_profiles p on p.id = pj.profile_id
          where pj.company_id = v_company and pj.status in ('in_progress','completed','on_hold') and coalesce(pj.actual_quantity_kg, 0) > 0
            and coalesce(pj.completed_at, pj.updated_at, pj.created_at) > now() - interval '120 days'
            and (v_search = '' or position(v_search in lower(concat_ws(' ', pj.job_number, o.order_number, p.profile_code))) > 0)) y
        -- By quantity, not by the job's summary stage: part of a job can await final QC while another part awaits its first QC.
        where y.k -> 'route' ->> 'state' = 'required' and greatest((y.k ->> 'awaiting_ageing_kg')::numeric, (y.k ->> 'in_ageing_kg')::numeric,
          (y.k ->> 'awaiting_final_kg')::numeric) > (y.k ->> 'tolerance_kg')::numeric
        order by ord offset (v_page - 1) * 10 limit 10) x;
    else
      raise exception 'Unknown view' using errcode = '22023';
    end if;
    return jsonb_build_object('view', v_view, 'page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows, 'can_record', v_role in ('owner','quality'),
      'enforced', (private.olo_settings_for(v_company)).enforce_qc_route, 'search', v_search, 'sort', v_sort, 'direction', v_dir,
      'rejected_only', coalesce((v_payload ->> 'rejected_only')::boolean, false));
  end if;

  if p_command = 'get' then
    perform private.olo_keys(v_payload, array['job_id']);
    k := private.olo_final_qc_job(v_company, (v_payload ->> 'job_id')::uuid, v_role);
    if k is null then raise exception 'Production job not found' using errcode = '23514'; end if;
    return k || jsonb_build_object('enforced', (private.olo_settings_for(v_company)).enforce_qc_route);
  end if;

  if p_command = 'record_get' then
    perform private.olo_keys(v_payload, array['id']);
    k := private.olo_final_qc_json(v_company, (v_payload ->> 'id')::uuid);
    if k is null then raise exception 'Final QC record not found' using errcode = '23514'; end if;
    return k;
  end if;

  if p_command <> 'record' then raise exception 'Unknown final QC command' using errcode = '22023'; end if;
  if v_role not in ('owner','quality') then raise exception 'Only QA/QC records the final QC' using errcode = '42501'; end if;
  perform private.olo_keys(v_payload, array['job_id','accepted_kg','rejected_kg','results','method','sampling_reference','certificate_reference','temper_verified','rejection_reason','note']);
  select * into j from public.production_jobs where id = (v_payload ->> 'job_id')::uuid and company_id = v_company;
  if not found then raise exception 'Production job not found' using errcode = '23514'; end if;
  -- One QC decision on this job at a time (the locks the QC disposition check and the reversal take: one per QC stage
  -- source, so each finishing receipt of a coated or anodized job, in a fixed order), then the job row.
  v_after := private.olo_job_qc_after_finishing(v_company, j.id);
  if not v_after then
    perform pg_advisory_xact_lock(hashtextextended('qc-disposition:' || v_company::text || ':' || j.id::text || ':mill-finish', 0));
  else
    for v_fin in select fj.id from public.finishing_jobs fj where fj.company_id = v_company and fj.production_job_id = j.id order by fj.id loop
      perform pg_advisory_xact_lock(hashtextextended('qc-disposition:' || v_company::text || ':' || j.id::text || ':' || v_fin::text, 0));
    end loop;
  end if;
  perform 1 from public.production_jobs where id = j.id for update;
  k := private.olo_final_qc_job(v_company, j.id, v_role);
  if not (k ->> 'can_record')::boolean then raise exception '%', k ->> 'blocker' using errcode = '23514'; end if;
  begin
    v_ok := round(coalesce(nullif(v_payload ->> 'accepted_kg', '')::numeric, 0), 3);
    v_rej := round(coalesce(nullif(v_payload ->> 'rejected_kg', '')::numeric, 0), 3);
  exception when others then raise exception 'Record the kilograms as numbers' using errcode = '22023';
  end;
  if v_ok < 0 or v_rej < 0 or v_ok + v_rej <= 0 then raise exception 'Record the kilograms accepted and/or rejected (more than 0 in total)' using errcode = '23514'; end if;
  if v_ok + v_rej > (k ->> 'awaiting_final_kg')::numeric + 0.0005 then
    raise exception 'Only % of this job is waiting for final QC after ageing', private.olo_fmt_kg((k ->> 'awaiting_final_kg')::numeric) using errcode = '23514';
  end if;
  -- Every kilogram recorded here carries a first-stage approval not yet used by an earlier final QC record.
  if v_ok + v_rej > (k ->> 'approved_kg')::numeric - (k ->> 'final_accepted_kg')::numeric + 0.0005 then
    raise exception 'Only % of this job passed first-stage QC and is not yet released by final QC. Record the first-stage QC of the rest first.',
      private.olo_fmt_kg(greatest((k ->> 'approved_kg')::numeric - (k ->> 'final_accepted_kg')::numeric, 0)) using errcode = '23514';
  end if;
  if v_ok > (k ->> 'max_accept_kg')::numeric + 0.0005 then
    raise exception 'At most % can be accepted: the treatment review accepted % and first-stage QC approved %; % is already released by final QC',
      trim_scale(round((k ->> 'max_accept_kg')::numeric, 3)) || ' kg', private.olo_fmt_kg((k ->> 'aged_accepted_kg')::numeric),
      private.olo_fmt_kg((k ->> 'approved_kg')::numeric), private.olo_fmt_kg((k ->> 'final_accepted_kg')::numeric) using errcode = '23514';
  end if;
  v_results := private.olo_final_qc_results(v_payload -> 'results');
  if length(btrim(coalesce(v_payload ->> 'method', ''))) not between 2 and 120 then raise exception 'Record the test method (2 to 120 characters)' using errcode = '23514'; end if;
  if length(btrim(coalesce(v_payload ->> 'sampling_reference', ''))) not between 2 and 120 then raise exception 'Record the approved sampling plan used (2 to 120 characters)' using errcode = '23514'; end if;
  if v_payload ->> 'certificate_reference' is not null and length(btrim(v_payload ->> 'certificate_reference')) not between 2 and 80 then
    raise exception 'The certificate reference must be 2 to 80 characters' using errcode = '23514';
  end if;
  if v_payload ->> 'temper_verified' is not null and length(btrim(v_payload ->> 'temper_verified')) not between 1 and 10 then
    raise exception 'The verified temper is 1 to 10 characters' using errcode = '23514';
  end if;
  v_reason := nullif(btrim(coalesce(v_payload ->> 'rejection_reason', '')), '');
  if v_rej > 0 and (v_reason is null or length(v_reason) < 10) then raise exception 'Record why material is rejected (at least 10 characters)' using errcode = '23514'; end if;
  if v_rej = 0 then v_reason := null; end if;
  if v_payload ->> 'note' is not null and length(v_payload ->> 'note') > 500 then raise exception 'The note is at most 500 characters' using errcode = '23514'; end if;
  if (coalesce(v_payload ->> 'method', '') || coalesce(v_payload ->> 'sampling_reference', '') || coalesce(v_payload ->> 'certificate_reference', '')
      || coalesce(v_payload ->> 'temper_verified', '') || coalesce(v_reason, '') || coalesce(v_payload ->> 'note', '')) ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'Remove control characters from the final QC details' using errcode = '23514';
  end if;
  -- A rejection reverses first-stage approvals, which the reversal action allows under a containment only for a
  -- revoked approval: the held lot is resolved first.
  if v_rej > 0 then
    select x.containment_number into v_spec from public.quality_containments x where x.company_id = v_company and x.production_job_id = j.id and x.status in ('open','partially_resolved') limit 1;
    if v_spec is not null then
      raise exception 'Job output is under QC containment %. Resolve the held lot before rejecting material at final QC.', v_spec using errcode = '23514';
    end if;
  end if;
  -- Accepting needs results that meet the profile's recorded minimums and temper; nothing is assumed where the
  -- profile is silent.
  if v_ok > 0 then
    select * into pr from public.aluminium_profiles where id = j.profile_id and company_id = v_company;
    v_spec := case
      when nullif(btrim(coalesce(v_payload ->> 'temper_verified', '')), '') is not null and nullif(btrim(pr.temper), '') is not null
        and upper(btrim(v_payload ->> 'temper_verified')) <> upper(btrim(pr.temper))
        then format('The verified temper %s differs from the profile temper %s', upper(btrim(v_payload ->> 'temper_verified')), upper(btrim(pr.temper)))
      when (v_results ->> 'dimensional_ok')::boolean is false then 'The dimensional check failed'
      when (v_results ->> 'surface_ok')::boolean is false then 'The surface check failed'
      when pr.tensile_strength_mpa is not null and (v_results ->> 'tensile_strength_mpa')::numeric < pr.tensile_strength_mpa
        then format('Tensile strength %s MPa is below the profile minimum %s MPa', v_results ->> 'tensile_strength_mpa', trim_scale(pr.tensile_strength_mpa))
      when pr.yield_strength_mpa is not null and (v_results ->> 'yield_strength_mpa')::numeric < pr.yield_strength_mpa
        then format('Yield strength %s MPa is below the profile minimum %s MPa', v_results ->> 'yield_strength_mpa', trim_scale(pr.yield_strength_mpa))
      when pr.elongation_percent is not null and (v_results ->> 'elongation_percent')::numeric < pr.elongation_percent
        then format('Elongation %s%% is below the profile minimum %s%%', v_results ->> 'elongation_percent', trim_scale(pr.elongation_percent))
      else null end;
    if v_spec is not null then
      raise exception '%. Material cannot be accepted on these results: record it as rejected, or leave it awaiting final QC while it is investigated.', v_spec using errcode = '23514';
    end if;
  end if;

  v_number := private.olo_final_qc_number(v_company);
  select order_number into v_order_number from public.orders where id = j.order_id;
  insert into public.final_qc_records(id, company_id, record_number, production_job_id, order_id, profile_id, accepted_kg, rejected_kg, results, method, sampling_reference,
    certificate_reference, temper_verified, rejection_reason, note, awaiting_before_kg, recorded_by, recorded_by_role)
  values (v_id, v_company, v_number, j.id, j.order_id, j.profile_id, v_ok, v_rej, v_results, btrim(v_payload ->> 'method'), btrim(v_payload ->> 'sampling_reference'),
    nullif(btrim(coalesce(v_payload ->> 'certificate_reference', '')), ''), nullif(upper(btrim(coalesce(v_payload ->> 'temper_verified', ''))), ''), v_reason,
    nullif(btrim(coalesce(v_payload ->> 'note', '')), ''), (k ->> 'awaiting_final_kg')::numeric, v_actor, v_role);

  -- Rejected kilograms reverse the first-stage approval (oldest first) through the QC reversal action, so every reader
  -- of approved kilograms, the remelt approval and the reproduction check follow.
  if v_rej > 0 then
    v_left := v_rej;
    perform set_config('olo.final_qc_job', j.id::text, true);
    for qi in select x.id, x.quantity_checked_kg from public.quality_inspections x
        where x.company_id = v_company and x.production_job_id = j.id and (x.finishing_job_id is not null) = v_after and x.status = 'approved'
        order by x.inspection_date, x.created_at, x.id loop
      exit when v_left <= 0.0005;
      v_take := least(v_left, qi.quantity_checked_kg);
      v_r := public.quality_reversal_command('reverse', jsonb_build_object('inspection_id', qi.id, 'reversed_kg', v_take, 'reversed_as', 'rejected',
        'method', left('Final QC after ageing: ' || btrim(v_payload ->> 'method'), 120), 'reason', left(format('Final QC %s after ageing: %s', v_number, v_reason), 500),
        'reference', v_number));
      v_reversed := v_reversed || jsonb_build_array(jsonb_build_object('id', v_r ->> 'id', 'reversal_number', v_r ->> 'reversal_number', 'reversed_kg', v_take));
      v_left := round(v_left - v_take, 3);
    end loop;
    perform set_config('olo.final_qc_job', '', true);
    if v_left > 0.0005 then
      raise exception 'Only % of first-stage QC approval is left to reverse for this job; record the first-stage QC first', private.olo_fmt_kg(v_rej - v_left) using errcode = '23514';
    end if;
  end if;

  perform private.olo_event(v_company, 'qc.final_recorded', j.order_id, j.id, 'quality',
    format('%s: final QC after ageing for job %s — %s accepted%s', v_number, coalesce(j.job_number, '-'), private.olo_fmt_kg(v_ok),
      case when v_rej > 0 then format(', %s rejected (%s)', private.olo_fmt_kg(v_rej), v_reason) else '' end),
    jsonb_build_object('record_id', v_id, 'accepted_kg', v_ok, 'rejected_kg', v_rej, 'results', v_results), 'final-qc:' || v_id);
  if v_ok > 0 then
    perform private.ap3_notify_roles(v_company, private.olo_uniq(private.olo_roles(v_company, 'packaging', 0) || private.olo_roles(v_company, 'production_planning', 0)),
      'olo_final_qc_released', 'success', format('Released by final QC: %s', coalesce(v_order_number, j.job_number)),
      format('%s of job %s (order %s) passed final QC after ageing under %s and can be packed.', private.olo_fmt_kg(v_ok), coalesce(j.job_number, '-'), coalesce(v_order_number, '-'), v_number),
      'production_job', j.id, '/packaging', 'olo-final-released:' || v_id, v_actor);
  end if;
  if v_rej > 0 then
    perform private.ap3_notify_roles(v_company, private.olo_uniq(private.olo_roles(v_company, 'factory_management', 0) || private.olo_roles(v_company, 'quality', 1)
        || private.olo_roles(v_company, 'production_planning', 0)), 'olo_final_qc_rejected', 'critical', format('Final QC rejected material: %s', coalesce(v_order_number, j.job_number)),
      format('Final QC %s after ageing rejected %s of job %s (order %s): %s. The material is quarantined as rejected and can be proposed for remelt; production planning gets a reproduction task if the order is now short.',
        v_number, private.olo_fmt_kg(v_rej), coalesce(j.job_number, '-'), coalesce(v_order_number, '-'), v_reason),
      'production_job', j.id, '/quality/final-qc/' || j.id, 'olo-final-rejected:' || v_id, v_actor);
  end if;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (v_company, v_actor, 'final_qc.recorded', 'final_qc_record', v_id, jsonb_build_object('record_number', v_number, 'job_id', j.id, 'accepted_kg', v_ok,
      'rejected_kg', v_rej, 'reversals', v_reversed));
  perform set_config('olo.engine', 'running', true);
  perform private.olo_evaluate_quality_flow(v_company);
  perform private.olo_evaluate_reproduction(v_company);
  perform private.olo_verify_tasks(v_company);
  perform set_config('olo.engine', '', true);
  return private.olo_final_qc_json(v_company, v_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Optional QC route control (company setting, default off)
-- ---------------------------------------------------------------------------------------------------------------
-- One material release of a job at a time. Each guarded path (ageing loads, packaging starts, packing lines, prepared
-- bundles, stock) checks a per-job aggregate, while the commands that write those rows lock only their own rows and take
-- shared locks on the job and order, so two releases of different rows of one job would each read only their own
-- write and pass the cap together. Every release guard takes this transaction lock before reading its aggregate; the
-- reads after it (statements of a volatile function in read committed) see every release committed before it.
create or replace function private.olo_lock_job_release(p_company uuid, p_job uuid) returns void
language sql volatile security definer set search_path = public, private as $$
  select pg_advisory_xact_lock(hashtextextended('olo-job-release:' || p_company::text || ':' || p_job::text, 0))
$$;
revoke all on function private.olo_lock_job_release(uuid, uuid) from public, anon, authenticated;

-- Ageing loads: only what first-stage QC approved (approved now plus what final QC later rejected, which was approved
-- when it was loaded). Retreatment batches re-load material already in treatment and are not counted again.
create or replace function private.olo_guard_ageing_load() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_retreat uuid; k jsonb; v_loaded numeric; v_cap numeric; v_job text;
begin
  if not (private.olo_settings_for(new.company_id)).enforce_qc_route then return new; end if;
  select retreatment_of into v_retreat from public.treatment_batches where id = new.batch_id and company_id = new.company_id;
  if v_retreat is not null then return new; end if;
  perform private.olo_lock_job_release(new.company_id, new.production_job_id);
  select coalesce(sum(ti.quantity_kg), 0) into v_loaded from public.treatment_inputs ti join public.treatment_batches tb on tb.id = ti.batch_id and tb.company_id = ti.company_id
    where ti.company_id = new.company_id and ti.production_job_id = new.production_job_id and tb.retreatment_of is null;
  -- First-stage approvals of the job's own QC stage (after finishing for coated or anodized output).
  select coalesce(sum(qi.quantity_checked_kg) filter (where qi.status = 'approved'), 0) into v_cap from public.quality_inspections qi
    where qi.company_id = new.company_id and qi.production_job_id = new.production_job_id
      and (qi.finishing_job_id is not null) = private.olo_job_qc_after_finishing(new.company_id, new.production_job_id);
  v_cap := v_cap + coalesce((select sum(f.rejected_kg) from public.final_qc_records f where f.company_id = new.company_id and f.production_job_id = new.production_job_id), 0);
  if v_loaded + new.quantity_kg > v_cap + 0.0005 then
    select job_number into v_job from public.production_jobs where id = new.production_job_id;
    -- "NOV: " messages are shown as written by the heat-treatment screen, which is where batches are loaded.
    raise exception 'NOV: Only % of job % has passed first-stage QC (% already loaded). Material must not go to ageing without an approved QC disposition.',
      private.olo_fmt_kg(v_cap), coalesce(v_job, '-'), private.olo_fmt_kg(v_loaded);
  end if;
  return new;
end;
$$;
create trigger zzz_olo_p5_guard_ageing_load before insert on public.treatment_inputs for each row execute function private.olo_guard_ageing_load();

-- Material of a job that has physically left QC: packing-list lines and prepared bundles not yet on a dispatch (one
-- bundle is never in both: preparing it is consumed when its packing line is written) plus stock made from the job's
-- output (stock derived from it by a bundle transformation is the same material and is not counted again).
create or replace function private.olo_job_released_material_kg(p_company uuid, p_job uuid) returns numeric
language sql stable security definer set search_path = public, private as $$
  select coalesce((select sum(x.net_weight_kg) from public.packing_list_items x where x.company_id = p_company and x.source_kind = 'production' and x.source_line_id = p_job), 0)
    + coalesce((select sum(x.gross_weight_kg - x.tare_weight_kg) from public.prepared_physical_bundles x where x.company_id = p_company and x.source_kind = 'production'
        and x.source_line_id = p_job and x.dispatch_id is null), 0)
    + coalesce((select sum(b.total_weight_kg) from public.profile_stock_batches b where b.company_id = p_company and b.production_job_id = p_job and b.origin_type = 'production_surplus'
        and not exists (select 1 from public.bundle_transformation_lines l where l.company_id = b.company_id and l.stock_batch_id = b.id and l.direction = 'output')), 0)
$$;
revoke all on function private.olo_job_released_material_kg(uuid, uuid) from public, anon, authenticated;

-- Packaging of a job that needs ageing stays within what final QC released: bundles, packing lines and stock made from
-- the job are counted together; started packaging jobs separately. Checked after the
-- row is written, so the row itself is counted. A packaging job is checked when packing starts: the 'scheduled'
-- queue entry that a completed mill-finish run creates is not packing, and refusing it would refuse the completion.
create or replace function private.olo_guard_unaged_packing() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_job uuid; v_total numeric; v_released numeric; v_number text; v_tol numeric;
begin
  if not (private.olo_settings_for(new.company_id)).enforce_qc_route then return null; end if;
  if tg_table_name = 'packaging_jobs' then
    if new.production_job_id is null or new.status not in ('in_progress','completed') then return null; end if;
    v_job := new.production_job_id;
  elsif tg_table_name = 'profile_stock_batches' then
    if new.origin_type is distinct from 'production_surplus' or new.production_job_id is null then return null; end if;
    v_job := new.production_job_id;
  else
    if new.source_kind is distinct from 'production' or new.source_line_id is null then return null; end if;
    v_job := new.source_line_id;
  end if;
  if private.olo_job_route(new.company_id, v_job) ->> 'state' <> 'required' then return null; end if;
  -- Serialize with every other release of this job before reading the totals (see private.olo_lock_job_release).
  perform private.olo_lock_job_release(new.company_id, v_job);
  if tg_table_name = 'packaging_jobs' then
    select coalesce(sum(x.profile_weight_kg), 0) into v_total from public.packaging_jobs x where x.company_id = new.company_id and x.production_job_id = v_job and x.status in ('in_progress','completed');
  else
    -- One total for both bundle records (a dispatched prepared bundle is already marked dispatched when its packing
    -- line is written, so nothing counts twice) plus stock made from the job.
    v_total := private.olo_job_released_material_kg(new.company_id, v_job);
  end if;
  select coalesce(sum(f.accepted_kg), 0) into v_released from public.final_qc_records f where f.company_id = new.company_id and f.production_job_id = v_job;
  v_tol := greatest(1, v_released * 0.005);
  if v_total > v_released + v_tol then
    select job_number into v_number from public.production_jobs where id = v_job;
    raise exception 'Job % needs ageing: % is released by final QC after ageing, and this would make % packed or stocked. Complete the ageing cycle and the final QC first.',
      coalesce(v_number, '-'), private.olo_fmt_kg(v_released), private.olo_fmt_kg(v_total) using errcode = '23514';
  end if;
  return null;
end;
$$;
create trigger zzz_olo_p5_guard_unaged after insert or update of status, production_job_id, profile_weight_kg on public.packaging_jobs for each row execute function private.olo_guard_unaged_packing();
create trigger zzz_olo_p5_guard_unaged after insert on public.packing_list_items for each row execute function private.olo_guard_unaged_packing();
create trigger zzz_olo_p5_guard_unaged after insert on public.prepared_physical_bundles for each row execute function private.olo_guard_unaged_packing();
-- Stock is checked at commit: a bundle split or merge (private.lifecycle_apply) writes each output batch before the
-- bundle_transformation_lines row that marks it as repacked material, so an immediate check would count the input and
-- its outputs together and refuse a repack of released stock as a new release.
create constraint trigger zzz_olo_p5_guard_unaged after insert on public.profile_stock_batches deferrable initially deferred
  for each row execute function private.olo_guard_unaged_packing();

-- ---------------------------------------------------------------------------------------------------------------
-- Evaluation: QC, ageing and final QC work; ageing cycle monitoring; run notifications
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_evaluate_quality_flow(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare r record; b record; k jsonb; t public.tasks%rowtype; v_n integer := 0; s public.olo_settings := private.olo_settings_for(p_company); v_tol numeric;
  v_route text; v_note text; v_ax jsonb; v_order uuid; v_inputs text; v_ev text; v_summary text; ji record; v_held record;
begin
  v_tol := s.reproduction_tolerance_kg;
  for r in select pj.id, pj.job_number, pj.order_id, pj.status, pj.machine_id, pj.die_id, pj.profile_id, o.order_number, m.machine_name, d.die_number, p.profile_code, p.alloy, p.temper
      from public.production_jobs pj left join public.orders o on o.id = pj.order_id and o.company_id = pj.company_id
      left join public.machines m on m.id = pj.machine_id left join public.dies d on d.id = pj.die_id left join public.aluminium_profiles p on p.id = pj.profile_id
      where pj.company_id = p_company and pj.status in ('in_progress','completed','on_hold') and coalesce(pj.actual_quantity_kg, 0) > 0
        and (pj.status <> 'completed' or coalesce(pj.completed_at, pj.updated_at, pj.created_at) > now() - interval '60 days')
        and (o.id is null or (o.deleted_at is null and o.current_stage not in ('closed','cancelled') and o.opening_cutover_id is null))
  loop
    k := private.olo_job_quality_flow(p_company, r.id);
    v_route := k -> 'route' ->> 'state';
    -- Run completed: initial QC of every produced kilogram.
    if r.status = 'completed' and (k ->> 'awaiting_decision_kg')::numeric > v_tol then
      select * into t from public.tasks x where x.company_id = p_company and x.workflow_kind = 'initial_qc' and x.workflow_job_id = r.id order by x.workflow_cycle desc limit 1;
      if t.id is null or t.status not in ('open','in_progress') then
        v_note := case v_route when 'required' then 'Route: artificial ageing required — material that passes goes to the ageing team.'
          when 'not_required' then 'Route: no artificial ageing — this QC approval releases the material to packaging.'
          else 'Route: ageing requirement not documented on the profile — confirm it before releasing the material.' end;
        perform private.olo_event(p_company, 'production.qc_required', r.order_id, r.id, 'quality',
          format('Run %s completed: %s awaiting initial QC', coalesce(r.job_number, '-'), private.olo_fmt_kg((k ->> 'awaiting_decision_kg')::numeric)), k,
          'initial_qc:' || r.id || ':' || (coalesce(t.workflow_cycle, 0) + 1));
        v_n := v_n + private.olo_create_task(p_company, 'initial_qc', 'quality', coalesce(t.workflow_cycle, 0) + 1, r.order_id, r.id, null,
          format('Production run completed — initial QC required: %s', coalesce(r.job_number, r.order_number)),
          format('Job %s (order %s, profile %s, alloy %s %s) completed on %s with die %s. Produced %s; %s has no QC decision yet (approved %s, rejected %s, awaiting plan results %s, awaiting rework %s, held %s). Inspect it under the inspection plan — dimensions, wall thickness, straightness, twist, surface — and record accepted, rejected or held quantities; a lot that is only partly good is split, never approved as a whole. %s',
            coalesce(r.job_number, '-'), coalesce(r.order_number, '-'), coalesce(r.profile_code, '-'), coalesce(r.alloy, '-'), coalesce(r.temper, ''), coalesce(r.machine_name, 'the press'),
            coalesce(r.die_number, '-'), private.olo_fmt_kg((k ->> 'produced_kg')::numeric), private.olo_fmt_kg((k ->> 'awaiting_decision_kg')::numeric),
            private.olo_fmt_kg((k ->> 'approved_kg')::numeric), private.olo_fmt_kg((k ->> 'rejected_kg')::numeric), private.olo_fmt_kg((k ->> 'pending_kg')::numeric),
            private.olo_fmt_kg((k ->> 'rework_open_kg')::numeric), private.olo_fmt_kg((k ->> 'held_kg')::numeric), v_note),
          'high', '/quality/new', null);
      end if;
    end if;
    if v_route = 'required' then
      -- First-stage QC passed: release to the ageing team.
      if (k ->> 'awaiting_ageing_kg')::numeric > v_tol then
        select * into t from public.tasks x where x.company_id = p_company and x.workflow_kind = 'ageing_release' and x.workflow_job_id = r.id order by x.workflow_cycle desc limit 1;
        if t.id is null or t.status not in ('open','in_progress') then
          perform private.olo_event(p_company, 'ageing.release_required', r.order_id, r.id, 'ageing',
            format('%s of job %s released for ageing', private.olo_fmt_kg((k ->> 'awaiting_ageing_kg')::numeric), coalesce(r.job_number, '-')), k,
            'ageing_release:' || r.id || ':' || (coalesce(t.workflow_cycle, 0) + 1));
          v_n := v_n + private.olo_create_task(p_company, 'ageing_release', 'ageing', coalesce(t.workflow_cycle, 0) + 1, r.order_id, r.id, null,
            format('Material released for ageing: %s (%s)', coalesce(r.job_number, r.order_number), private.olo_fmt_kg((k ->> 'awaiting_ageing_kg')::numeric)),
            format('First-stage QC approved %s of job %s (order %s, profile %s, alloy %s, temper %s); %s is not yet in an ageing batch. %s. Allocate an ageing oven, load the material under the approved recipe for this alloy and temper, and start the cycle. Do not mix alloys the recipe does not allow.',
              private.olo_fmt_kg((k ->> 'approved_kg')::numeric + (k ->> 'final_rejected_kg')::numeric), coalesce(r.job_number, '-'), coalesce(r.order_number, '-'), coalesce(r.profile_code, '-'),
              coalesce(r.alloy, '-'), coalesce(r.temper, '-'), private.olo_fmt_kg((k ->> 'awaiting_ageing_kg')::numeric), k -> 'route' ->> 'detail'),
            'high', '/tasks/specialist/new?action=treat.create', private.olo_roles(p_company, 'production_planning', 0));
        end if;
      end if;
      -- Out of ageing: final QC.
      if (k ->> 'awaiting_final_kg')::numeric > v_tol then
        select * into t from public.tasks x where x.company_id = p_company and x.workflow_kind = 'final_qc' and x.workflow_job_id = r.id order by x.workflow_cycle desc limit 1;
        if t.id is null or t.status not in ('open','in_progress') then
          perform private.olo_event(p_company, 'ageing.final_qc_required', r.order_id, r.id, 'quality',
            format('Ageing completed for job %s: %s awaiting final QC', coalesce(r.job_number, '-'), private.olo_fmt_kg((k ->> 'awaiting_final_kg')::numeric)), k,
            'final_qc:' || r.id || ':' || (coalesce(t.workflow_cycle, 0) + 1));
          v_n := v_n + private.olo_create_task(p_company, 'final_qc', 'quality', coalesce(t.workflow_cycle, 0) + 1, r.order_id, r.id, null,
            format('Ageing completed — final QA/QC required: %s', coalesce(r.job_number, r.order_number)),
            format('Job %s (order %s, profile %s, alloy %s, temper %s): the treatment review accepted %s and rejected %s; %s is waiting for final QC. Test it under the approved sampling plan — hardness, tensile, yield, elongation, temper, dimensions and surface as the customer specification requires — and record the accepted and rejected kilograms. Material not yet recorded stays on hold.',
              coalesce(r.job_number, '-'), coalesce(r.order_number, '-'), coalesce(r.profile_code, '-'), coalesce(r.alloy, '-'), coalesce(r.temper, '-'),
              private.olo_fmt_kg((k ->> 'aged_accepted_kg')::numeric), private.olo_fmt_kg((k ->> 'aged_rejected_kg')::numeric), private.olo_fmt_kg((k ->> 'awaiting_final_kg')::numeric)),
            'high', '/quality/final-qc/' || r.id, null);
        end if;
      end if;
      -- Packed without a recorded ageing cycle and final QC: a deviation for QA and factory management.
      if (k ->> 'packed_unaged_kg')::numeric > v_tol then
        perform private.ap3_notify_roles(p_company, private.olo_uniq(private.olo_roles(p_company, 'quality', 0) || private.olo_roles(p_company, 'factory_management', 0)),
          'olo_unaged_packed', 'critical', format('Packed without final QC after ageing: %s', coalesce(r.job_number, r.order_number)),
          format('%s of job %s (order %s) is in packaging or dispatch although its route needs ageing, and only %s is released by final QC. Check whether it was aged; hold or recall it until the ageing and final QC are recorded.',
            private.olo_fmt_kg((k ->> 'packed_kg')::numeric), coalesce(r.job_number, '-'), coalesce(r.order_number, '-'), private.olo_fmt_kg((k ->> 'final_accepted_kg')::numeric)),
          'production_job', r.id, '/quality/final-qc/' || r.id, 'olo-unaged-packed:' || r.id, null);
      end if;
    end if;
  end loop;

  -- Ageing batches: timeline events, the overdue cycle, deviations and the treatment review.
  for b in select tb.id, tb.batch_number, tb.status, tb.started_at, tb.ended_at, tb.retreatment_of, tr.recipe_code, tr.revision, tr.soak_max_minutes, mc.machine_name
      from public.treatment_batches tb join public.treatment_recipes tr on tr.id = tb.recipe_id and tr.company_id = tb.company_id
      join public.machines mc on mc.id = tb.machine_id and mc.company_id = tb.company_id
      where tb.company_id = p_company and tb.created_at > now() - interval '30 days'
  loop
    select (array_agg(pj.order_id order by ti.id) filter (where pj.order_id is not null))[1], string_agg(coalesce(pj.job_number, '-') || ' ' || private.olo_fmt_kg(ti.quantity_kg), ', ' order by pj.job_number)
      into v_order, v_inputs from public.treatment_inputs ti join public.production_jobs pj on pj.id = ti.production_job_id and pj.company_id = ti.company_id
      where ti.company_id = p_company and ti.batch_id = b.id;
    continue when v_inputs is null;
    v_ev := case b.status when 'loaded' then 'ageing.batch_loaded' when 'running' then 'ageing.cycle_started' when 'ended' then 'ageing.cycle_completed'
      when 'interrupted' then 'ageing.cycle_interrupted' else 'ageing.reviewed' end;
    for ji in select ti.production_job_id job_id, pj.order_id, pj.job_number, ti.quantity_kg, ti.accepted_kg, ti.rejected_kg, ti.retreat_kg from public.treatment_inputs ti
        join public.production_jobs pj on pj.id = ti.production_job_id and pj.company_id = ti.company_id where ti.company_id = p_company and ti.batch_id = b.id loop
      v_summary := case b.status
        when 'loaded' then format('Ageing batch %s loaded: %s of job %s (%s rev %s, oven %s)%s', b.batch_number, private.olo_fmt_kg(ji.quantity_kg), coalesce(ji.job_number, '-'),
          b.recipe_code, b.revision, b.machine_name, case when b.retreatment_of is not null then ', retreatment' else '' end)
        when 'running' then format('Ageing cycle %s started in %s', b.batch_number, b.machine_name)
        when 'ended' then format('Ageing cycle %s completed; awaiting treatment review', b.batch_number)
        when 'interrupted' then format('Ageing cycle %s recorded as interrupted', b.batch_number)
        else format('Treatment review of %s for job %s: accepted %s, rejected %s, retreatment %s', b.batch_number, coalesce(ji.job_number, '-'), private.olo_fmt_kg(ji.accepted_kg),
          private.olo_fmt_kg(ji.rejected_kg), private.olo_fmt_kg(ji.retreat_kg)) end;
      perform private.olo_event(p_company, v_ev, ji.order_id, ji.job_id, case when b.status in ('loaded','running','ended','interrupted') then 'ageing' else 'quality' end,
        v_summary, jsonb_build_object('batch_id', b.id, 'status', b.status), 'ageing:' || b.id || ':' || case when b.status in ('loaded','running','ended','interrupted') then b.status else 'reviewed' end || ':' || ji.job_id);
    end loop;
    if b.status = 'running' and b.started_at is not null and b.started_at + make_interval(mins => b.soak_max_minutes + s.ageing_overdue_grace_minutes) < clock_timestamp()
       and not exists (select 1 from public.tasks x where x.company_id = p_company and x.workflow_kind = 'ageing_cycle' and x.workflow_source_id = b.id) then
      perform private.olo_event(p_company, 'ageing.cycle_overdue', v_order, null, 'ageing', format('Ageing cycle %s is past its maximum soak of %s minutes', b.batch_number, b.soak_max_minutes),
        jsonb_build_object('batch_id', b.id), 'ageing-overdue:' || b.id);
      v_n := v_n + private.olo_create_task(p_company, 'ageing_cycle', 'ageing', 1, v_order, null, b.id,
        format('Ageing cycle overdue: %s', b.batch_number),
        format('Batch %s (%s rev %s, oven %s; %s) started %s and is past the recipe''s maximum soak of %s minutes plus %s minutes'' grace. End and unload the cycle, or record it as interrupted; the treatment review then decides the material.',
          b.batch_number, b.recipe_code, b.revision, b.machine_name, v_inputs, to_char(b.started_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), b.soak_max_minutes, s.ageing_overdue_grace_minutes),
        'urgent', '/tasks/specialist/treatment/' || b.id, private.olo_roles(p_company, 'production', 1));
    end if;
    if b.status in ('running','ended','interrupted') then
      v_ax := private.treatment_assess(p_company, b.id);
      if coalesce((v_ax ->> 'out_of_range')::integer, 0) > 0 then
        perform private.olo_event(p_company, 'ageing.deviation_detected', v_order, null, 'quality',
          format('Ageing cycle %s: %s reading(s) outside the recipe range', b.batch_number, v_ax ->> 'out_of_range'), v_ax, 'ageing-deviation:' || b.id);
        perform private.ap3_notify_roles(p_company, private.olo_uniq(private.olo_roles(p_company, 'quality', 0) || private.olo_roles(p_company, 'production', 1)
            || private.olo_roles(p_company, 'factory_management', 0)), 'olo_ageing_deviation', 'critical', format('Ageing cycle deviation: %s', b.batch_number),
          format('Batch %s (%s rev %s, oven %s; %s): %s temperature reading(s) are outside the recipe range (lowest %s °C, highest %s °C). The treatment review must decide the material; accepting it needs an explicit deviation acceptance.',
            b.batch_number, b.recipe_code, b.revision, b.machine_name, v_inputs, v_ax ->> 'out_of_range', coalesce(v_ax ->> 'min_c', '-'), coalesce(v_ax ->> 'max_c', '-')),
          'treatment_batch', b.id, '/tasks/specialist/treatment/' || b.id, 'olo-ageing-deviation:' || b.id, null);
      end if;
    end if;
    if b.status in ('ended','interrupted') and not exists (select 1 from public.tasks x where x.company_id = p_company and x.workflow_kind = 'ageing_review' and x.workflow_source_id = b.id) then
      v_n := v_n + private.olo_create_task(p_company, 'ageing_review', 'quality', 1, v_order, null, b.id,
        format('Ageing %s — treatment review required: %s', case when b.status = 'interrupted' then 'interrupted' else 'completed' end, b.batch_number),
        format('Batch %s (%s rev %s, oven %s; %s) %s. Review the readings and soak against the recipe and record, for each input, the kilograms accepted, rejected or sent for retreatment. Final QC of the accepted material follows.',
          b.batch_number, b.recipe_code, b.revision, b.machine_name, v_inputs, case when b.status = 'interrupted' then 'was interrupted' else 'has ended' end),
        case when b.status = 'interrupted' then 'urgent' else 'high' end, '/tasks/specialist/treatment/' || b.id, null);
    end if;
  end loop;

  -- A running job put on hold: the production manager is told why and what has to happen to resume.
  for v_held in select h.id, h.reason, h.note, h.material_condition, h.resume_condition, h.responsible_name, h.recorded_output_kg, pj.id job_id, pj.job_number, pj.order_id, o.order_number
      from public.production_job_holds h join public.production_jobs pj on pj.id = h.production_job_id and pj.company_id = h.company_id
      left join public.orders o on o.id = pj.order_id
      where h.company_id = p_company and h.status = 'active' and h.previous_status = 'in_progress' and h.held_at > now() - interval '7 days'
  loop
    perform private.olo_event(p_company, 'production.run_interrupted', v_held.order_id, v_held.job_id, 'production',
      format('Run %s interrupted: %s%s', coalesce(v_held.job_number, '-'), replace(v_held.reason, '_', ' '), coalesce(' — ' || nullif(btrim(v_held.note), ''), '')),
      jsonb_build_object('hold_id', v_held.id), 'run-interrupted:' || v_held.id);
    perform private.ap3_notify_roles(p_company, private.olo_roles(p_company, 'production', 1), 'olo_run_interrupted', 'warning',
      format('Production run interrupted: %s', coalesce(v_held.job_number, v_held.order_number)),
      format('Job %s (order %s) stopped: %s%s. Output so far %s. Material: %s. To resume: %s. Responsible: %s.', coalesce(v_held.job_number, '-'), coalesce(v_held.order_number, '-'),
        replace(v_held.reason, '_', ' '), coalesce(' — ' || nullif(btrim(v_held.note), ''), ''), private.olo_fmt_kg(v_held.recorded_output_kg), v_held.material_condition,
        v_held.resume_condition, v_held.responsible_name),
      'production_job', v_held.job_id, '/production/' || v_held.job_id, 'olo-run-interrupted:' || v_held.id, null);
  end loop;
  update public.notifications n set resolved_at = clock_timestamp(), resolution = 'Resolved by system: the hold ended', is_read = true, read_at = coalesce(read_at, now())
    where n.company_id = p_company and n.resolved_at is null and n.condition_key like 'olo-run-interrupted:%'
      and not exists (select 1 from public.production_job_holds h where h.company_id = p_company and h.status = 'active' and 'olo-run-interrupted:' || h.id::text = n.condition_key);
  return v_n;
end;
$$;

-- Verification of the Phase 5 task kinds (earlier kinds stay with their verifiers).
alter function private.olo_verify_tasks(uuid) rename to olo_verify_tasks_b3;
create or replace function private.olo_verify_tasks(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare t public.tasks%rowtype; v_n integer := private.olo_verify_tasks_b3(p_company); k jsonb; v_job public.production_jobs%rowtype; v_status text;
  v_tol numeric := (private.olo_settings_for(p_company)).reproduction_tolerance_kg;
begin
  for t in select * from public.tasks x where x.company_id = p_company and x.workflow_key is not null and x.status in ('open','in_progress')
      and x.workflow_kind in ('initial_qc','ageing_release','ageing_cycle','ageing_review','final_qc') order by x.created_at for update skip locked loop
    if t.workflow_kind in ('initial_qc','ageing_release','final_qc') then
      select * into v_job from public.production_jobs where id = t.workflow_job_id;
      if v_job.id is null or v_job.status = 'cancelled' then
        perform private.olo_close_task(t, false, 'Withdrawn: the production job was cancelled', jsonb_build_object('job_status', v_job.status)); v_n := v_n + 1;
        continue;
      end if;
      select current_stage into v_status from public.orders where id = v_job.order_id;
      if v_status in ('closed','cancelled') then
        perform private.olo_close_task(t, false, 'Withdrawn: the order is ' || v_status, jsonb_build_object('order_stage', v_status)); v_n := v_n + 1;
        continue;
      end if;
      k := private.olo_job_quality_flow(p_company, v_job.id);
      if t.workflow_kind = 'initial_qc' and (k ->> 'awaiting_decision_kg')::numeric <= v_tol then
        perform private.olo_close_task(t, true, format('Verified: every produced kilogram has a QC decision or is held (approved %s, rejected %s, held %s)',
          private.olo_fmt_kg((k ->> 'approved_kg')::numeric), private.olo_fmt_kg((k ->> 'rejected_kg')::numeric), private.olo_fmt_kg((k ->> 'held_kg')::numeric)), k); v_n := v_n + 1;
      elsif t.workflow_kind in ('ageing_release','final_qc') and k -> 'route' ->> 'state' <> 'required' then
        perform private.olo_close_task(t, false, 'Withdrawn: the profile route no longer includes ageing', k -> 'route'); v_n := v_n + 1;
      elsif t.workflow_kind = 'ageing_release' and (k ->> 'awaiting_ageing_kg')::numeric <= v_tol then
        if (k ->> 'packed_unaged_kg')::numeric > v_tol and (k ->> 'loaded_kg')::numeric + v_tol < (k ->> 'approved_kg')::numeric + (k ->> 'final_rejected_kg')::numeric then
          perform private.olo_close_task(t, false, 'Withdrawn: the material moved to packaging without a recorded ageing cycle (QA and factory management alerted)', k);
        else
          perform private.olo_close_task(t, true, format('Verified: %s of the QC-released material is loaded into ageing batches', private.olo_fmt_kg((k ->> 'loaded_kg')::numeric)), k);
        end if;
        v_n := v_n + 1;
      elsif t.workflow_kind = 'final_qc' and (k ->> 'awaiting_final_kg')::numeric <= v_tol then
        perform private.olo_close_task(t, true, format('Verified: final QC recorded (released %s, rejected %s)', private.olo_fmt_kg((k ->> 'final_accepted_kg')::numeric),
          private.olo_fmt_kg((k ->> 'final_rejected_kg')::numeric)), k); v_n := v_n + 1;
      end if;
    else
      select status into v_status from public.treatment_batches where id = t.workflow_source_id;
      if v_status is null then
        perform private.olo_close_task(t, false, 'Withdrawn: the ageing batch no longer exists', null); v_n := v_n + 1;
      elsif t.workflow_kind = 'ageing_cycle' and v_status <> 'running' then
        perform private.olo_close_task(t, true, 'Verified: the cycle is recorded as ' || v_status, jsonb_build_object('status', v_status)); v_n := v_n + 1;
      elsif t.workflow_kind = 'ageing_review' and v_status not in ('loaded','running','ended','interrupted') then
        perform private.olo_close_task(t, true, 'Verified: treatment review recorded — ' || replace(v_status, '_', ' '), jsonb_build_object('status', v_status)); v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

alter function private.olo_run_all(uuid, text) rename to olo_run_all_b3;
create or replace function private.olo_run_all(p_company uuid, p_source text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v jsonb := private.olo_run_all_b3(p_company, p_source);
begin
  return v || jsonb_build_object('quality_flow_tasks', private.olo_evaluate_quality_flow(p_company), 'verified_after_quality', private.olo_verify_tasks(p_company));
end;
$$;

-- Event-driven evaluation for production, QC, ageing and hold records (failures logged, never blocking).
create or replace function private.olo_after_quality_flow_change() returns trigger language plpgsql security definer set search_path = public, private as $$
declare c record;
begin
  if coalesce(current_setting('olo.engine', true), '') = 'running' then return null; end if;
  perform set_config('olo.engine', 'running', true);
  for c in select id from public.companies order by created_at loop
    begin
      perform private.olo_evaluate_quality_flow(c.id);
      perform private.olo_verify_tasks(c.id);
    exception when others then
      insert into public.olo_engine_errors(company_id, source, message) values (c.id, left(tg_table_name || ':phase5', 80), left(sqlerrm, 500));
    end;
  end loop;
  perform set_config('olo.engine', '', true);
  return null;
end;
$$;
create trigger zzz_olo_p5_jobs after update of status, actual_quantity_kg on public.production_jobs for each statement execute function private.olo_after_quality_flow_change();
create trigger zzz_olo_p5_quality after insert or update of status on public.quality_inspections for each statement execute function private.olo_after_quality_flow_change();
create trigger zzz_olo_p5_batches after insert or update of status on public.treatment_batches for each statement execute function private.olo_after_quality_flow_change();
create trigger zzz_olo_p5_inputs after insert or update on public.treatment_inputs for each statement execute function private.olo_after_quality_flow_change();
create trigger zzz_olo_p5_observations after insert on public.treatment_observations for each statement execute function private.olo_after_quality_flow_change();
create trigger zzz_olo_p5_holds after insert or update of status on public.production_job_holds for each statement execute function private.olo_after_quality_flow_change();
create trigger zzz_olo_p5_containments after insert or update on public.quality_containments for each statement execute function private.olo_after_quality_flow_change();
-- Packing that starts or ends changes what is physically packed.
create trigger zzz_olo_p5_packaging after insert or update of status on public.packaging_jobs for each statement execute function private.olo_after_quality_flow_change();

-- A run that starts tells production planning and the production supervisor; its alert clears when the run ends.
create or replace function private.olo_after_run_status() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_order text; v_press text; v_die text; v_profile text;
begin
  if new.status is not distinct from old.status then return null; end if;
  begin
    if new.status = 'in_progress' then
      select order_number into v_order from public.orders where id = new.order_id;
      select machine_name into v_press from public.machines where id = new.machine_id;
      select die_number into v_die from public.dies where id = new.die_id;
      select profile_code into v_profile from public.aluminium_profiles where id = new.profile_id;
      perform private.ap3_notify_roles(new.company_id, private.olo_uniq(private.olo_roles(new.company_id, 'production_planning', 0) || private.olo_roles(new.company_id, 'production', 1)),
        'olo_run_started', 'info', format('Production started: %s', coalesce(new.job_number, v_order)),
        format('Job %s (order %s, profile %s) %s on %s with die %s. Planned %s.', coalesce(new.job_number, '-'), coalesce(v_order, '-'), coalesce(v_profile, '-'),
          case when old.status = 'on_hold' then 'resumed' else 'started' end, coalesce(v_press, 'the press'), coalesce(v_die, '-'), private.olo_fmt_kg(new.planned_quantity_kg)),
        'production_job', new.id, '/production/' || new.id, 'olo-run-started:' || new.id, (select u.id from public.app_users u where u.id = auth.uid()));
    elsif old.status = 'in_progress' then
      update public.notifications set resolved_at = clock_timestamp(), resolution = 'Run ' || replace(new.status, '_', ' '), is_read = true, read_at = coalesce(read_at, now())
        where company_id = new.company_id and condition_key = 'olo-run-started:' || new.id and resolved_at is null;
    end if;
  exception when others then
    insert into public.olo_engine_errors(company_id, source, message) values (new.company_id, 'production_jobs:run_status', left(sqlerrm, 500));
  end;
  return null;
end;
$$;
create trigger zzz_olo_p5_run_status after update of status on public.production_jobs for each row execute function private.olo_after_run_status();

-- ---------------------------------------------------------------------------------------------------------------
-- Order lifecycle: the ageing domain, per-job quality flow and the next ageing / final QC step
-- ---------------------------------------------------------------------------------------------------------------
alter function private.olo_order_core(uuid, uuid, boolean, boolean) rename to olo_order_core_b3;
create or replace function private.olo_order_core(p_company uuid, p_order uuid, p_finance boolean, p_with_gates boolean) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v jsonb := private.olo_order_core_b3(p_company, p_order, p_finance, p_with_gates); v_flows jsonb; v_tol numeric := (private.olo_settings_for(p_company)).reproduction_tolerance_kg;
  v_req integer; v_undoc integer; v_aw_age numeric; v_in numeric; v_aw_final numeric; v_final_ok numeric; v_final_rej numeric; v_aw_dec numeric; v_status text; v_dept text;
  v_first_final jsonb; v_first_age jsonb; v_first_in jsonb;
begin
  select coalesce(jsonb_object_agg(pj.id::text, private.olo_job_quality_flow(p_company, pj.id)), '{}'::jsonb) into v_flows
    from public.production_jobs pj where pj.company_id = p_company and pj.order_id = p_order and pj.status <> 'cancelled';
  select count(*) filter (where f.value -> 'route' ->> 'state' = 'required'), count(*) filter (where f.value -> 'route' ->> 'state' = 'undocumented' and (f.value ->> 'produced_kg')::numeric > 0),
    coalesce(sum((f.value ->> 'awaiting_ageing_kg')::numeric), 0), coalesce(sum((f.value ->> 'in_ageing_kg')::numeric), 0), coalesce(sum((f.value ->> 'awaiting_final_kg')::numeric), 0),
    coalesce(sum((f.value ->> 'final_accepted_kg')::numeric), 0), coalesce(sum((f.value ->> 'final_rejected_kg')::numeric), 0), coalesce(sum((f.value ->> 'awaiting_decision_kg')::numeric), 0)
    into v_req, v_undoc, v_aw_age, v_in, v_aw_final, v_final_ok, v_final_rej, v_aw_dec
    from jsonb_each(v_flows) f;
  select f.value into v_first_final from jsonb_each(v_flows) f where (f.value ->> 'awaiting_final_kg')::numeric > v_tol order by f.value ->> 'job_number' limit 1;
  select f.value into v_first_age from jsonb_each(v_flows) f where (f.value ->> 'awaiting_ageing_kg')::numeric > v_tol order by f.value ->> 'job_number' limit 1;
  select f.value into v_first_in from jsonb_each(v_flows) f where (f.value ->> 'in_ageing_kg')::numeric > v_tol order by f.value ->> 'job_number' limit 1;

  v := jsonb_set(v, '{quantities}', (v -> 'quantities') || jsonb_build_object('awaiting_qc_decision_kg', v_aw_dec, 'awaiting_ageing_kg', v_aw_age, 'in_ageing_kg', v_in,
    'awaiting_final_qc_kg', v_aw_final, 'final_released_kg', v_final_ok, 'final_rejected_kg', v_final_rej));
  v_status := case when v_req = 0 then case when v_undoc > 0 then 'route_undocumented' else 'not_required' end
    when v_aw_age > v_tol then 'awaiting_ageing' when v_in > v_tol then 'in_ageing' when v_aw_final > v_tol then 'awaiting_final_qc'
    when v_final_ok > 0 then 'released' else 'not_started' end;
  v := jsonb_set(v, '{domains}', (v -> 'domains') || jsonb_build_array(jsonb_build_object('key', 'ageing', 'label', 'Ageing and final QC', 'status', v_status,
    'detail', case when v_req = 0 and v_undoc > 0 then format('%s job(s) with output have no documented ageing requirement', v_undoc)
      when v_req = 0 then 'No job of this order needs artificial ageing'
      else format('Awaiting ageing %s · in ageing %s · awaiting final QC %s · released by final QC %s · rejected at final QC %s', private.olo_fmt_kg(v_aw_age),
        private.olo_fmt_kg(v_in), private.olo_fmt_kg(v_aw_final), private.olo_fmt_kg(v_final_ok), private.olo_fmt_kg(v_final_rej)) end)));
  v := jsonb_set(v, '{jobs}', coalesce((select jsonb_agg(case when v_flows ? (e ->> 'id') then e || jsonb_build_object('quality_flow', v_flows -> (e ->> 'id')) else e end)
    from jsonb_array_elements(v -> 'jobs') e), '[]'::jsonb));

  -- Material of an ageing route is not ready to pack after its first QC: the next step is ageing, then final QC.
  v_dept := v -> 'next_action' ->> 'department';
  if (v_dept is null or v_dept = 'packaging') and v ->> 'overall' not in ('cancelled','fully_closed') then
    if v_first_final is not null then
      v := jsonb_set(v, '{next_action}', jsonb_build_object('label', format('Record final QC for %s of job %s after ageing', private.olo_fmt_kg((v_first_final ->> 'awaiting_final_kg')::numeric),
        v_first_final ->> 'job_number'), 'department', 'quality', 'link', '/quality/final-qc/' || (v_first_final ->> 'job_id')));
    elsif v_first_age is not null then
      v := jsonb_set(v, '{next_action}', jsonb_build_object('label', format('Load %s of job %s into an ageing batch', private.olo_fmt_kg((v_first_age ->> 'awaiting_ageing_kg')::numeric),
        v_first_age ->> 'job_number'), 'department', 'ageing', 'link', '/tasks/specialist/new?action=treat.create'));
    elsif v_first_in is not null then
      v := jsonb_set(v, '{next_action}', jsonb_build_object('label', format('Complete the ageing cycle of job %s (%s in treatment)', v_first_in ->> 'job_number',
        private.olo_fmt_kg((v_first_in ->> 'in_ageing_kg')::numeric)), 'department', 'ageing', 'link', '/quality/final-qc/' || (v_first_in ->> 'job_id')));
    end if;
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants, row level security, live screens
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function private.olo_job_route(uuid, uuid), private.olo_job_quality_flow(uuid, uuid), private.olo_final_qc_number(uuid),
  private.olo_final_qc_json(uuid, uuid), private.olo_final_qc_job(uuid, uuid, text), private.olo_final_qc_results(jsonb), private.olo_guard_ageing_load(),
  private.olo_guard_unaged_packing(), private.olo_evaluate_quality_flow(uuid), private.olo_verify_tasks_b3(uuid), private.olo_verify_tasks(uuid),
  private.olo_run_all_b3(uuid, text), private.olo_run_all(uuid, text), private.olo_after_quality_flow_change(), private.olo_after_run_status(),
  private.olo_order_core_b3(uuid, uuid, boolean, boolean), private.olo_order_core(uuid, uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.final_qc_command(text, jsonb) from public, anon;
grant execute on function public.final_qc_command(text, jsonb) to authenticated;

alter table public.final_qc_records enable row level security;
revoke all on public.final_qc_records from public, anon, authenticated;
grant select on public.final_qc_records to authenticated;
create policy final_qc_records_read on public.final_qc_records for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid
       where p.pubname = 'supabase_realtime' and pr.prrelid = 'public.final_qc_records'::regclass) then
    alter publication supabase_realtime add table public.final_qc_records;
  end if;
end;
$$;

-- First evaluation of current records (errors logged, not fatal).
do $$
declare c record;
begin
  perform set_config('olo.engine', 'running', true);
  for c in select id from public.companies order by created_at loop
    begin
      perform private.olo_evaluate_quality_flow(c.id);
      perform private.olo_verify_tasks(c.id);
    exception when others then
      insert into public.olo_engine_errors(company_id, source, message) values (c.id, 'phase5:first_run', left(sqlerrm, 500));
    end;
  end loop;
  perform set_config('olo.engine', '', true);
end;
$$;

commit;
