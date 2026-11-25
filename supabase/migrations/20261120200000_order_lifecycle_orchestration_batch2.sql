-- Order lifecycle orchestration, batch 2 (directive sections 16-20, 27-28, 38, 8; batch 1 section G items 1-3, 5-7).
--
--   * QC containment and lot splitting: a failed sample quarantines the affected lot of a production job. The lot stops
--     progressing (packaging, packing lists, prepared bundles, ageing loads and new QC approvals for that job are refused)
--     until QA resolves it. Non-destructive defects need a recorded result for every inspected piece or sublot; destructive
--     tests need the expanded sampling plan's number of passing samples and an engineering disposition. Releases create
--     child lots (accepted / rejected) linked to the parent production lot, its run, die and billets, and write the
--     matching QC inspections so the existing downstream caps and dispositions apply. Unresolved quantity stays held.
--     Material approved before a containment opened stays blocked until the whole lot is resolved.
--   * Remelt authorisation: a scrap (remelt) disposition needs an approval by the factory manager or owner, never the
--     proposer. Approval records the disposition; the scrap lot is reserved until the foundry weighs it in. Any
--     difference between dispositioned and received weight must be explained and alerts the factory manager.
--   * Reproduction: when accepted, held and still-to-be-produced material cannot cover an order after rejections, one
--     reproduction task goes to production planning; held material counts as possible supply, so a later rejection
--     re-opens the shortfall instead of producing it twice.
--   * Delivery: dispatches not confirmed by the expected date get a confirmation task for dispatch; delivered dispatches
--     get an acceptance follow-up for sales that closes when every bundle has a recorded customer disposition.
--   * Change control: an approved order change withdraws the order's open billet, die, shortage and reproduction work
--     and re-evaluates it, so stale work is not completed against an obsolete specification.
--   * Priority changes: a request with reason, decided by production planning authority (not the requester), with the
--     queue impact recorded. The run order still follows the press schedule.
-- Additive only: new tables, functions, guards and wrappers; batch 1 functions are wrapped, not rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

alter table public.olo_settings
  add column if not exists delivery_confirmation_days smallint not null default 3 check (delivery_confirmation_days between 1 and 60),
  add column if not exists reproduction_tolerance_kg numeric(10,3) not null default 1 check (reproduction_tolerance_kg between 0 and 1000);

create or replace function private.olo_settings_for(p_company uuid) returns public.olo_settings
language plpgsql stable security definer set search_path = public, private as $$
declare s public.olo_settings;
begin
  select * into s from public.olo_settings where company_id = p_company;
  if not found then
    s.company_id := p_company; s.billet_rank_threshold := 5; s.die_rank_threshold := 3; s.material_risk_horizon_days := 21;
    s.ack_sla_hours := 4; s.action_sla_hours := 24; s.enforce_die_preparation := false; s.enforce_preheat := false;
    s.delivery_confirmation_days := 3; s.reproduction_tolerance_kg := 1;
  end if;
  return s;
end;
$$;

alter table public.tasks drop constraint if exists tasks_workflow_shape_check;
alter table public.tasks add constraint tasks_workflow_shape_check check (
  (workflow_key is null and workflow_kind is null and workflow_department is null and workflow_cycle is null and workflow_due_at is null)
  or (workflow_key is not null and workflow_kind in ('billet_allocation','die_preparation','billet_shortage','reproduction','delivery_confirmation',
        'delivery_followup','containment','remelt_approval','remelt_receipt','priority_approval')
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
      else 'This task closes when the priority request is decided.' end
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
-- QC containment, results and material lots
-- ---------------------------------------------------------------------------------------------------------------
create table public.quality_containments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  containment_number text not null,
  production_job_id uuid not null references public.production_jobs(id),
  order_id uuid references public.orders(id),
  profile_id uuid references public.aluminium_profiles(id),
  stage text not null check (stage in ('first_stage','final')),
  defect text not null check (length(btrim(defect)) between 5 and 500),
  defect_kind text not null check (defect_kind in ('non_destructive','destructive')),
  inspection_mode text not null check (inspection_mode in ('full_inspection','expanded_sampling')),
  sampling_reference text check (sampling_reference is null or length(btrim(sampling_reference)) between 2 and 120),
  required_samples smallint check (required_samples is null or required_samples between 2 and 500),
  scope_kg numeric(14,3) not null check (scope_kg > 0),
  suspended_approved_kg numeric(14,3) not null default 0 check (suspended_approved_kg >= 0),
  released_accepted_kg numeric(14,3) not null default 0 check (released_accepted_kg >= 0),
  released_rejected_kg numeric(14,3) not null default 0 check (released_rejected_kg >= 0),
  status text not null default 'open' check (status in ('open','partially_resolved','resolved','cancelled')),
  ncr_id uuid references public.quality_ncrs(id),
  opened_by uuid not null references public.app_users(id),
  opened_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  cancelled_by uuid references public.app_users(id), cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(btrim(cancel_reason)) between 10 and 300),
  unique (company_id, containment_number),
  check (released_accepted_kg + released_rejected_kg <= scope_kg + 0.001),
  check (inspection_mode <> 'expanded_sampling' or (required_samples is not null and sampling_reference is not null)),
  check ((status = 'resolved') = (resolved_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null and cancel_reason is not null))
);
create unique index quality_containments_active_key on public.quality_containments(production_job_id) where status in ('open','partially_resolved');
create index quality_containments_company_idx on public.quality_containments(company_id, status, opened_at desc);
create index quality_containments_order_idx on public.quality_containments(order_id);
create index quality_containments_profile_idx on public.quality_containments(profile_id);
create index quality_containments_ncr_idx on public.quality_containments(ncr_id);
create index quality_containments_people_idx on public.quality_containments(opened_by, cancelled_by);

create table public.material_lots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lot_code text not null,
  parent_lot_id uuid references public.material_lots(id),
  kind text not null check (kind in ('production','accepted','rejected')),
  production_job_id uuid not null references public.production_jobs(id),
  order_id uuid references public.orders(id),
  containment_id uuid references public.quality_containments(id),
  quality_inspection_id uuid references public.quality_inspections(id),
  quantity_kg numeric(14,3) not null check (quantity_kg > 0),
  status text not null check (status in ('held','split','released','awaiting_plan_results','rejected')),
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, lot_code),
  check ((kind = 'production') = (parent_lot_id is null))
);
create index material_lots_job_idx on public.material_lots(company_id, production_job_id);
create index material_lots_parent_idx on public.material_lots(parent_lot_id);
create index material_lots_containment_idx on public.material_lots(containment_id);
create index material_lots_inspection_idx on public.material_lots(quality_inspection_id);
create index material_lots_order_idx on public.material_lots(order_id);
create index material_lots_created_by_idx on public.material_lots(created_by);

create table public.containment_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  containment_id uuid not null references public.quality_containments(id),
  reference text not null check (length(btrim(reference)) between 1 and 80),
  result text not null check (result in ('accepted','rejected')),
  quantity_kg numeric(14,3) check (quantity_kg is null or quantity_kg > 0),
  pieces integer check (pieces is null or pieces > 0),
  method text not null check (length(btrim(method)) between 2 and 120),
  measurements jsonb check (measurements is null or jsonb_typeof(measurements) = 'object'),
  note text check (note is null or length(note) <= 500),
  released_lot_id uuid references public.material_lots(id),
  recorded_by uuid not null references public.app_users(id),
  recorded_at timestamptz not null default clock_timestamp()
);
create unique index containment_results_reference_key on public.containment_results(containment_id, lower(btrim(reference)));
create index containment_results_containment_idx on public.containment_results(company_id, containment_id, recorded_at);
create index containment_results_lot_idx on public.containment_results(released_lot_id);
create index containment_results_recorded_by_idx on public.containment_results(recorded_by);
-- Results are evidence: only the release link may be set, once.
create or replace function private.olo_guard_containment_result() returns trigger language plpgsql set search_path = public, private as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'released_lot_id') is distinct from (to_jsonb(old) - 'released_lot_id') or old.released_lot_id is not null then
    raise exception 'Recorded containment results cannot be changed; record a correcting result instead' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.olo_guard_containment_result() from public, anon, authenticated;
create trigger containment_results_immutable before update or delete on public.containment_results for each row execute function private.olo_guard_containment_result();

-- The containment number of an active containment that stops this job's material, or null.
create or replace function private.olo_job_containment(p_company uuid, p_job uuid) returns text
language sql stable security definer set search_path = public, private as $$
  select c.containment_number from public.quality_containments c
  where c.company_id = p_company and c.production_job_id = p_job
    and (c.status = 'open' or (c.status = 'partially_resolved' and c.suspended_approved_kg > 0))
  limit 1
$$;
revoke all on function private.olo_job_containment(uuid, uuid) from public, anon, authenticated;

create or replace function private.olo_guard_contained_material() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_job uuid; v_company uuid := new.company_id; v_number text;
begin
  if tg_table_name = 'packaging_jobs' then
    if new.production_job_id is null or new.status = 'cancelled' then return new; end if;
    if tg_op = 'UPDATE' and old.status = new.status and old.production_job_id is not distinct from new.production_job_id then return new; end if;
    v_job := new.production_job_id;
  elsif tg_table_name in ('packing_list_items','prepared_physical_bundles') then
    if new.source_kind is distinct from 'production' then return new; end if;
    v_job := new.source_line_id;
  elsif tg_table_name = 'treatment_inputs' then
    v_job := new.production_job_id;
  elsif tg_table_name = 'quality_inspections' then
    if new.status <> 'approved' or new.production_job_id is null then return new; end if;
    if tg_op = 'UPDATE' and old.status = 'approved' then return new; end if;
    if coalesce(current_setting('olo.containment_release', true), '') = 'on'
       or exists (select 1 from public.material_lots l where l.quality_inspection_id = new.id and l.kind = 'accepted') then return new; end if;
    select c.containment_number into v_number from public.quality_containments c
      where c.company_id = v_company and c.production_job_id = new.production_job_id and c.status in ('open','partially_resolved') limit 1;
    if v_number is not null then
      raise exception 'Job output is under QC containment %. Release accepted material through the containment, not by a new approval.', v_number using errcode = '23514';
    end if;
    return new;
  end if;
  if v_job is null then return new; end if;
  v_number := private.olo_job_containment(v_company, v_job);
  if v_number is not null then
    raise exception 'This material is under QC containment % and cannot move to packaging, ageing or dispatch until QA resolves it.', v_number using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.olo_guard_contained_material() from public, anon, authenticated;
create trigger zzz_guard_olo_containment before insert or update of status, production_job_id on public.packaging_jobs for each row execute function private.olo_guard_contained_material();
create trigger zzz_guard_olo_containment before insert on public.packing_list_items for each row execute function private.olo_guard_contained_material();
create trigger zzz_guard_olo_containment before insert on public.prepared_physical_bundles for each row execute function private.olo_guard_contained_material();
create trigger zzz_guard_olo_containment before insert on public.treatment_inputs for each row execute function private.olo_guard_contained_material();
create trigger zzz_guard_olo_containment before insert or update of status on public.quality_inspections for each row execute function private.olo_guard_contained_material();

-- ---------------------------------------------------------------------------------------------------------------
-- Remelt approvals
-- ---------------------------------------------------------------------------------------------------------------
create table public.remelt_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  approval_number text not null,
  source_type text not null check (source_type in ('qc_reject','finishing_reject','dispatch_return')),
  quality_inspection_id uuid references public.quality_inspections(id),
  finishing_job_id uuid references public.finishing_jobs(id),
  dispatch_id uuid references public.dispatches(id),
  packing_list_item_id uuid references public.packing_list_items(id),
  production_job_id uuid references public.production_jobs(id),
  order_id uuid references public.orders(id),
  alloy text,
  quantity_kg numeric(14,3) not null check (quantity_kg > 0),
  reason text not null check (length(btrim(reason)) between 5 and 500),
  evidence text check (evidence is null or length(btrim(evidence)) <= 500),
  status text not null default 'proposed' check (status in ('proposed','rejected','awaiting_receipt','received')),
  proposed_by uuid not null references public.app_users(id),
  proposed_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.app_users(id), decided_by_role text, decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 5 and 500),
  material_disposition_id uuid references public.material_dispositions(id),
  foundry_scrap_id uuid references public.foundry_aluminium_scrap(id),
  received_kg numeric(14,3) check (received_kg is null or received_kg > 0),
  variance_kg numeric(14,3),
  variance_note text check (variance_note is null or length(btrim(variance_note)) between 10 and 500),
  weighbridge_reference text check (weighbridge_reference is null or length(btrim(weighbridge_reference)) between 1 and 60),
  received_by uuid references public.app_users(id), received_at timestamptz,
  unique (company_id, approval_number),
  check ((source_type = 'qc_reject' and quality_inspection_id is not null) or (source_type = 'finishing_reject' and finishing_job_id is not null)
    or (source_type = 'dispatch_return' and dispatch_id is not null and packing_list_item_id is not null)),
  check (status = 'proposed' or (decided_by is not null and decided_at is not null and decision_note is not null)),
  check (status not in ('awaiting_receipt','received') or (decided_by_role in ('owner','factory_manager') and material_disposition_id is not null)),
  check ((status = 'received') = (received_at is not null and received_kg is not null and variance_kg is not null)),
  check (variance_kg is null or abs(variance_kg) < 0.0005 or variance_note is not null)
);
create index remelt_approvals_company_idx on public.remelt_approvals(company_id, status, proposed_at desc);
create index remelt_approvals_inspection_idx on public.remelt_approvals(quality_inspection_id);
create index remelt_approvals_finishing_idx on public.remelt_approvals(finishing_job_id);
create index remelt_approvals_dispatch_idx on public.remelt_approvals(dispatch_id);
create index remelt_approvals_packing_idx on public.remelt_approvals(packing_list_item_id);
create index remelt_approvals_job_idx on public.remelt_approvals(production_job_id);
create index remelt_approvals_order_idx on public.remelt_approvals(order_id);
create index remelt_approvals_disposition_idx on public.remelt_approvals(material_disposition_id);
create index remelt_approvals_scrap_idx on public.remelt_approvals(foundry_scrap_id);
create index remelt_approvals_people_idx on public.remelt_approvals(proposed_by, decided_by, received_by);

-- A scrap (remelt) disposition is recorded only under a factory manager or owner approval. Approval by the person
-- who proposed it is refused unless that person is the owner. A factory manager or owner recording scrap directly is
-- their own authorisation and is captured as an approval with their reason.
create or replace function private.olo_guard_remelt_disposition() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_role text := coalesce(new.decided_by_role, private.get_current_user_role()); v_approval uuid := nullif(current_setting('olo.remelt_approval', true), '')::uuid;
  a public.remelt_approvals%rowtype;
begin
  if new.disposition <> 'scrap' then return new; end if;
  if v_approval is not null then
    select * into a from public.remelt_approvals where id = v_approval and company_id = new.company_id;
    if a.id is null or a.status <> 'proposed' or a.decided_by_role not in ('owner','factory_manager') then
      raise exception 'The remelt approval is not in a state that permits the transfer' using errcode = '23514';
    end if;
    return new;
  end if;
  if v_role in ('owner','factory_manager') and new.decided_by is not null then
    insert into public.remelt_approvals(company_id, approval_number, source_type, quality_inspection_id, finishing_job_id, dispatch_id, packing_list_item_id,
      production_job_id, quantity_kg, reason, status, proposed_by, decided_by, decided_by_role, decided_at, decision_note)
    values (new.company_id, private.olo_remelt_number(new.company_id), new.source_type, new.quality_inspection_id, new.finishing_job_id, new.dispatch_id, new.packing_list_item_id,
      new.production_job_id, new.weight_kg, left(new.reason, 500), 'proposed', new.decided_by, new.decided_by, v_role, clock_timestamp(),
      left('Recorded directly by the ' || replace(v_role, '_', ' ') || ': ' || new.reason, 500));
    return new;
  end if;
  raise exception 'Scrap / remelt needs the factory manager or owner to approve it. Propose it under Foundry, Remelt approvals.' using errcode = '42501';
end;
$$;

-- After the disposition: link it to its approval and keep the scrap lot reserved until the foundry weighs it in.
create or replace function private.olo_after_remelt_disposition() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_approval uuid := nullif(current_setting('olo.remelt_approval', true), '')::uuid; v_id uuid;
begin
  if new.disposition <> 'scrap' then return null; end if;
  if v_approval is null then
    select id into v_id from public.remelt_approvals where company_id = new.company_id and status = 'proposed' and decided_by = new.decided_by
      and decided_by_role in ('owner','factory_manager') and material_disposition_id is null and quantity_kg = new.weight_kg
      and coalesce(quality_inspection_id, finishing_job_id, packing_list_item_id) = coalesce(new.quality_inspection_id, new.finishing_job_id, new.packing_list_item_id)
      order by proposed_at desc limit 1;
  else v_id := v_approval;
  end if;
  update public.remelt_approvals set status = 'awaiting_receipt', material_disposition_id = new.id, foundry_scrap_id = new.foundry_scrap_id,
    production_job_id = coalesce(production_job_id, new.production_job_id),
    order_id = coalesce(order_id, (select order_id from public.production_jobs where id = new.production_job_id)),
    alloy = coalesce(alloy, (select alloy from public.foundry_aluminium_scrap where id = new.foundry_scrap_id))
  where id = v_id;
  if new.foundry_scrap_id is not null then
    insert into public.metal_source_dispositions(company_id, source_table, source_id, source_number, disposition, from_status, to_status, reason, recorded_by, recorded_by_role)
      select new.company_id, 'foundry_aluminium_scrap', x.id, x.scrap_number, 'hold', x.status, 'reserved', 'Reserved until the foundry weighs in the material approved for remelt', new.decided_by, coalesce(new.decided_by_role, 'factory_manager')
      from public.foundry_aluminium_scrap x where x.id = new.foundry_scrap_id and x.status = 'available' and new.decided_by is not null;
    update public.foundry_aluminium_scrap set status = 'reserved', notes = left(coalesce(notes || ' ', '') || 'Awaiting foundry receipt under remelt approval.', 1000)
      where id = new.foundry_scrap_id and status = 'available';
  end if;
  return null;
end;
$$;

create or replace function private.olo_remelt_number(p_company uuid) returns text language plpgsql security definer set search_path = public, private as $$
declare v_fy text := private.ap_fy_label(private.ist_today()); v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':olo-remelt-number', 0));
  select count(*) + 1 into v_n from public.remelt_approvals where company_id = p_company and approval_number like 'RMA/' || v_fy || '/%';
  return 'RMA/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end;
$$;
create or replace function private.olo_containment_number(p_company uuid) returns text language plpgsql security definer set search_path = public, private as $$
declare v_fy text := private.ap_fy_label(private.ist_today()); v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':olo-containment-number', 0));
  select count(*) + 1 into v_n from public.quality_containments where company_id = p_company and containment_number like 'QCH/' || v_fy || '/%';
  return 'QCH/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end;
$$;
revoke all on function private.olo_guard_remelt_disposition(), private.olo_after_remelt_disposition(), private.olo_remelt_number(uuid), private.olo_containment_number(uuid)
  from public, anon, authenticated;
create trigger zzz_guard_olo_remelt before insert on public.material_dispositions for each row execute function private.olo_guard_remelt_disposition();
create trigger zzz_olo_remelt_link after insert on public.material_dispositions for each row execute function private.olo_after_remelt_disposition();

-- Remaining disposable kg of a rejected source after recorded dispositions and open remelt requests.
create or replace function private.olo_remelt_source(p_company uuid, p_type text, p_source uuid, p_packing uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v_cap numeric; v_used numeric; v_open numeric; v_job uuid; v_label text;
begin
  if p_type = 'qc_reject' then
    select q.quantity_checked_kg, q.production_job_id, coalesce(q.batch_number, 'inspection') into v_cap, v_job, v_label from public.quality_inspections q
      where q.id = p_source and q.company_id = p_company and q.status = 'rejected';
    select coalesce(sum(weight_kg), 0) into v_used from public.material_dispositions where company_id = p_company and quality_inspection_id = p_source and disposition <> 'quarantine';
    select coalesce(sum(quantity_kg), 0) into v_open from public.remelt_approvals where company_id = p_company and quality_inspection_id = p_source and status = 'proposed';
  elsif p_type = 'finishing_reject' then
    select f.rejection_weight_kg, f.production_job_id, 'finishing rejection' into v_cap, v_job, v_label from public.finishing_jobs f where f.id = p_source and f.company_id = p_company;
    select coalesce(sum(weight_kg), 0) into v_used from public.material_dispositions where company_id = p_company and finishing_job_id = p_source and disposition <> 'quarantine';
    select coalesce(sum(quantity_kg), 0) into v_open from public.remelt_approvals where company_id = p_company and finishing_job_id = p_source and status = 'proposed';
  elsif p_type = 'dispatch_return' then
    select p.net_weight_kg, case when p.source_kind = 'production' then p.source_line_id end, 'bundle ' || p.bundle_number into v_cap, v_job, v_label
      from public.packing_list_items p where p.id = p_packing and p.company_id = p_company and p.dispatch_id = p_source;
    select coalesce(sum(weight_kg), 0) into v_used from public.material_dispositions where company_id = p_company and packing_list_item_id = p_packing and disposition <> 'quarantine';
    select coalesce(sum(quantity_kg), 0) into v_open from public.remelt_approvals where company_id = p_company and packing_list_item_id = p_packing and status = 'proposed';
  end if;
  if v_cap is null then return null; end if;
  return jsonb_build_object('cap', v_cap, 'used', v_used, 'open', v_open, 'remaining', greatest(v_cap - v_used - v_open, 0), 'job_id', v_job, 'label', v_label);
end;
$$;
revoke all on function private.olo_remelt_source(uuid, text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Priority change requests
-- ---------------------------------------------------------------------------------------------------------------
create table public.priority_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  order_id uuid not null references public.orders(id),
  from_priority text not null check (from_priority in ('low','normal','high','urgent')),
  to_priority text not null check (to_priority in ('low','normal','high','urgent')),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  impact jsonb not null default '[]'::jsonb check (jsonb_typeof(impact) = 'array'),
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  requested_by uuid not null references public.app_users(id),
  requested_by_role text not null,
  requested_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.app_users(id), decided_by_role text, decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 5 and 500),
  check (from_priority <> to_priority),
  check (status = 'pending' or (decided_by is not null and decided_at is not null and decision_note is not null))
);
create unique index priority_change_requests_pending_key on public.priority_change_requests(order_id) where status = 'pending';
create index priority_change_requests_company_idx on public.priority_change_requests(company_id, status, requested_at desc);
create index priority_change_requests_people_idx on public.priority_change_requests(requested_by, decided_by);

-- ---------------------------------------------------------------------------------------------------------------
-- Evaluations: reproduction and delivery
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_order_supply(p_company uuid, p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare o public.orders%rowtype; v_target numeric; v_ok numeric; v_pending numeric; v_rej numeric; v_held numeric; v_uninspected numeric; v_open numeric; v_short_closed boolean;
begin
  select * into o from public.orders where id = p_order and company_id = p_company;
  if not found then return null; end if;
  v_target := coalesce(nullif(o.manufacturing_weight_kg, 0), nullif(o.requested_weight_kg, 0), (select sum(i.quantity_kg) from public.order_items i where i.order_id = o.id), 0);
  select coalesce(sum(q.quantity_checked_kg) filter (where q.status = 'approved'), 0), coalesce(sum(q.quantity_checked_kg) filter (where q.status in ('pending','rework')), 0),
    coalesce(sum(q.quantity_checked_kg) filter (where q.status = 'rejected'), 0)
    into v_ok, v_pending, v_rej
  from public.quality_inspections q join public.production_jobs j on j.id = q.production_job_id where q.company_id = p_company and j.order_id = o.id and q.finishing_job_id is null;
  select coalesce(sum(c.scope_kg - c.released_accepted_kg - c.released_rejected_kg), 0) into v_held from public.quality_containments c
    where c.company_id = p_company and c.order_id = o.id and c.status in ('open','partially_resolved');
  select coalesce(sum(greatest(coalesce(j.actual_quantity_kg, 0) - coalesce((select sum(q.quantity_checked_kg) from public.quality_inspections q where q.production_job_id = j.id and q.finishing_job_id is null), 0)
      - coalesce((select sum(c.scope_kg) from public.quality_containments c where c.production_job_id = j.id and c.status in ('open','partially_resolved')), 0), 0)), 0)
    into v_uninspected from public.production_jobs j where j.company_id = p_company and j.order_id = o.id and j.status = 'completed';
  select coalesce(sum(greatest(coalesce(j.planned_quantity_kg, 0) - coalesce(j.actual_quantity_kg, 0), 0)), 0) into v_open
    from public.production_jobs j where j.company_id = p_company and j.order_id = o.id and j.status in ('planned','ready','on_hold','in_progress');
  v_short_closed := exists (select 1 from public.order_delivery_short_closures s where s.company_id = p_company and s.order_id = o.id);
  return jsonb_build_object('target', v_target, 'accepted', v_ok, 'pending', v_pending, 'held', v_held, 'rejected', v_rej, 'uninspected', v_uninspected, 'open_production', v_open,
    'shortfall', greatest(v_target - v_ok - v_pending - v_held - v_uninspected - v_open, 0), 'short_closed', v_short_closed,
    'active', o.deleted_at is null and o.current_stage not in ('closed','cancelled','delivered','payment_pending'));
end;
$$;

create or replace function private.olo_evaluate_reproduction(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare r record; k jsonb; t public.tasks%rowtype; s public.olo_settings := private.olo_settings_for(p_company); v_n integer := 0;
begin
  for r in select o.id, o.order_number from public.orders o where o.company_id = p_company and o.deleted_at is null
      and o.current_stage not in ('closed','cancelled','delivered','payment_pending')
      and exists (select 1 from public.quality_inspections q join public.production_jobs j on j.id = q.production_job_id where j.order_id = o.id and q.status = 'rejected')
  loop
    select * into t from public.tasks x where x.company_id = p_company and x.workflow_kind = 'reproduction' and x.workflow_source_id = r.id order by x.workflow_cycle desc limit 1;
    continue when t.id is not null and t.status in ('open','in_progress');
    k := private.olo_order_supply(p_company, r.id);
    continue when (k ->> 'short_closed')::boolean or (k ->> 'shortfall')::numeric <= s.reproduction_tolerance_kg;
    perform private.olo_event(p_company, 'production.reproduction_required', r.id, null, 'production_planning',
      format('Order %s needs %s more saleable material after rejections', r.order_number, private.olo_fmt_kg((k ->> 'shortfall')::numeric)), k,
      'reproduction:' || r.id || ':' || (coalesce(t.workflow_cycle, 0) + 1));
    v_n := v_n + private.olo_create_task(p_company, 'reproduction', 'production_planning', coalesce(t.workflow_cycle, 0) + 1, r.id, null, r.id,
      format('Reproduction required: %s', r.order_number),
      format('Order %s: target %s; QC accepted %s; awaiting disposition %s; held in containment %s; produced not yet inspected %s; still to be produced %s; rejected %s. Shortfall %s. Held and pending material is counted as possible supply: if it is later rejected this task opens again. Plan the balance, or record an approved short closure.',
        r.order_number, private.olo_fmt_kg((k ->> 'target')::numeric), private.olo_fmt_kg((k ->> 'accepted')::numeric), private.olo_fmt_kg((k ->> 'pending')::numeric),
        private.olo_fmt_kg((k ->> 'held')::numeric), private.olo_fmt_kg((k ->> 'uninspected')::numeric), private.olo_fmt_kg((k ->> 'open_production')::numeric),
        private.olo_fmt_kg((k ->> 'rejected')::numeric), private.olo_fmt_kg((k ->> 'shortfall')::numeric)),
      'high', '/orders/' || r.id || '/lifecycle', private.olo_roles(p_company, 'sales', 1));
  end loop;
  return v_n;
end;
$$;

-- Expected delivery: the confirmed (or requested) end of the dispatch's delivery appointment, else dispatch time plus the
-- company's confirmation interval.
create or replace function private.olo_expected_delivery(p_company uuid, p_dispatch uuid) returns timestamptz
language sql stable security definer set search_path = public, private as $$
  select coalesce(
    (select coalesce(a.confirmed_end, a.requested_end) from public.delivery_appointments a where a.company_id = p_company and a.dispatch_id = p_dispatch
       and a.status not in ('cancelled') order by a.revision desc, a.created_at desc limit 1),
    (select d.actual_dispatched_at + make_interval(days => (private.olo_settings_for(p_company)).delivery_confirmation_days) from public.dispatches d where d.id = p_dispatch))
$$;

create or replace function private.olo_evaluate_delivery(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare d record; t public.tasks%rowtype; v_n integer := 0; v_expected timestamptz;
begin
  for d in select x.id, x.dispatch_number, x.order_id, x.delivery_status, x.actual_dispatched_at, x.lr_number, x.transporter_name, o.order_number
      from public.dispatches x left join public.orders o on o.id = x.order_id
      where x.company_id = p_company and x.actual_dispatched_at is not null and x.actual_dispatched_at > now() - interval '60 days' loop
    if d.delivery_status in ('dispatched','in_transit','delayed') then
      v_expected := private.olo_expected_delivery(p_company, d.id);
      if v_expected < clock_timestamp() then
        select * into t from public.tasks x where x.company_id = p_company and x.workflow_kind = 'delivery_confirmation' and x.workflow_source_id = d.id order by x.workflow_cycle desc limit 1;
        if t.id is null then
          perform private.olo_event(p_company, 'delivery.overdue', d.order_id, null, 'dispatch', format('Delivery of %s not confirmed by %s', d.dispatch_number,
            to_char(v_expected at time zone 'Asia/Kolkata', 'DD Mon YYYY')), jsonb_build_object('dispatch_id', d.id), 'delivery_overdue:' || d.id);
          v_n := v_n + private.olo_create_task(p_company, 'delivery_confirmation', 'dispatch', 1, d.order_id, null, d.id,
            format('Delivery confirmation overdue: %s', d.dispatch_number),
            format('Dispatch %s for order %s left on %s with %s (LR %s). Delivery was expected by %s and is not confirmed. Contact the transporter and the customer, then record the delivery outcome and proof of delivery.',
              d.dispatch_number, coalesce(d.order_number, '-'), to_char(d.actual_dispatched_at at time zone 'Asia/Kolkata', 'DD Mon YYYY'), coalesce(d.transporter_name, 'the transporter'),
              coalesce(d.lr_number, 'not recorded'), to_char(v_expected at time zone 'Asia/Kolkata', 'DD Mon YYYY')),
            'high', '/dispatches/' || d.id, private.olo_roles(p_company, 'sales', 0));
        end if;
      end if;
    elsif d.delivery_status = 'delivered' and d.actual_dispatched_at > now() - interval '30 days' then
      select * into t from public.tasks x where x.company_id = p_company and x.workflow_kind = 'delivery_followup' and x.workflow_source_id = d.id order by x.workflow_cycle desc limit 1;
      continue when t.id is not null;
      continue when not exists (select 1 from public.packing_list_items p where p.dispatch_id = d.id and not exists (select 1 from public.delivery_dispositions x
        where x.packing_list_item_id = p.id and x.reversed_at is null));
      perform private.olo_event(p_company, 'delivery.confirmed', d.order_id, null, 'sales', format('Dispatch %s delivered; customer acceptance to be confirmed', d.dispatch_number),
        jsonb_build_object('dispatch_id', d.id), 'delivery_confirmed:' || d.id);
      v_n := v_n + private.olo_create_task(p_company, 'delivery_followup', 'sales', 1, d.order_id, null, d.id,
        format('Customer delivery follow-up: %s', d.dispatch_number),
        format('Dispatch %s for order %s is delivered. Confirm with the customer that the correct material and quantity arrived, and record acceptance, shortage, damage or rejection for each bundle. A transporter''s delivery report is not customer acceptance.',
          d.dispatch_number, coalesce(d.order_number, '-')), 'normal', '/dispatches/' || d.id, null);
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.olo_order_supply(uuid, uuid), private.olo_evaluate_reproduction(uuid), private.olo_expected_delivery(uuid, uuid),
  private.olo_evaluate_delivery(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Verification of the new task kinds (batch 1 kinds stay with the batch 1 verifier)
-- ---------------------------------------------------------------------------------------------------------------
alter function private.olo_verify_tasks(uuid) rename to olo_verify_tasks_b1;
create or replace function private.olo_verify_tasks(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare t public.tasks%rowtype; v_n integer := private.olo_verify_tasks_b1(p_company); k jsonb; v_status text; s public.olo_settings := private.olo_settings_for(p_company);
begin
  for t in select * from public.tasks x where x.company_id = p_company and x.workflow_key is not null and x.status in ('open','in_progress')
      and x.workflow_kind in ('reproduction','delivery_confirmation','delivery_followup','containment','remelt_approval','remelt_receipt','priority_approval')
      order by x.created_at for update skip locked loop
    if t.workflow_kind = 'reproduction' then
      k := private.olo_order_supply(p_company, t.workflow_source_id);
      if k is null or not (k ->> 'active')::boolean then
        perform private.olo_close_task(t, false, 'Withdrawn: the order is closed, delivered or cancelled', k); v_n := v_n + 1;
      elsif (k ->> 'short_closed')::boolean then
        perform private.olo_close_task(t, true, 'Verified: an approved short closure covers the balance', k); v_n := v_n + 1;
      elsif (k ->> 'shortfall')::numeric <= s.reproduction_tolerance_kg then
        perform private.olo_close_task(t, true, 'Verified: planned production and accepted or held material cover the order', k); v_n := v_n + 1;
      end if;
    elsif t.workflow_kind = 'delivery_confirmation' then
      select delivery_status into v_status from public.dispatches where id = t.workflow_source_id;
      if v_status in ('delivered','returned','damaged') then
        perform private.olo_close_task(t, true, 'Verified: delivery outcome recorded as ' || v_status, jsonb_build_object('delivery_status', v_status)); v_n := v_n + 1;
      end if;
    elsif t.workflow_kind = 'delivery_followup' then
      if not exists (select 1 from public.packing_list_items p where p.dispatch_id = t.workflow_source_id and not exists (select 1 from public.delivery_dispositions x
          where x.packing_list_item_id = p.id and x.reversed_at is null)) then
        perform private.olo_close_task(t, true, 'Verified: the customer disposition of every bundle is recorded',
          jsonb_build_object('dispositions', (select jsonb_object_agg(x.disposition, x.n) from (select dd.disposition, count(*) n from public.delivery_dispositions dd
            join public.packing_list_items p on p.id = dd.packing_list_item_id where p.dispatch_id = t.workflow_source_id and dd.reversed_at is null group by dd.disposition) x)));
        v_n := v_n + 1;
      end if;
    elsif t.workflow_kind = 'containment' then
      select status into v_status from public.quality_containments where id = t.workflow_source_id;
      if v_status = 'resolved' then perform private.olo_close_task(t, true, 'Verified: every kilogram of the contained lot is resolved', jsonb_build_object('status', v_status)); v_n := v_n + 1;
      elsif v_status = 'cancelled' then perform private.olo_close_task(t, false, 'Withdrawn: the containment was cancelled', jsonb_build_object('status', v_status)); v_n := v_n + 1;
      end if;
    elsif t.workflow_kind = 'remelt_approval' then
      select status into v_status from public.remelt_approvals where id = t.workflow_source_id;
      if v_status <> 'proposed' then perform private.olo_close_task(t, true, 'Verified: remelt request ' || replace(v_status, '_', ' '), jsonb_build_object('status', v_status)); v_n := v_n + 1; end if;
    elsif t.workflow_kind = 'remelt_receipt' then
      select status into v_status from public.remelt_approvals where id = t.workflow_source_id;
      if v_status = 'received' then perform private.olo_close_task(t, true, 'Verified: the foundry weighed in the material', jsonb_build_object('status', v_status)); v_n := v_n + 1; end if;
    elsif t.workflow_kind = 'priority_approval' then
      select status into v_status from public.priority_change_requests where id = t.workflow_source_id;
      if v_status <> 'pending' then perform private.olo_close_task(t, true, 'Verified: priority request ' || v_status, jsonb_build_object('status', v_status)); v_n := v_n + 1; end if;
    end if;
  end loop;
  return v_n;
end;
$$;

create or replace function private.olo_run_all(p_company uuid, p_source text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v jsonb;
begin
  v := private.olo_sync_queue(p_company, p_source);
  return v || jsonb_build_object('shortage_tasks', private.olo_evaluate_material_risk(p_company), 'reproduction_tasks', private.olo_evaluate_reproduction(p_company),
    'delivery_tasks', private.olo_evaluate_delivery(p_company), 'escalated', private.olo_escalate(p_company), 'verified_after_risk', private.olo_verify_tasks(p_company));
end;
$$;
revoke all on function private.olo_verify_tasks_b1(uuid), private.olo_verify_tasks(uuid), private.olo_run_all(uuid, text) from public, anon, authenticated;

-- Event-driven evaluation for QC, dispatch and order-change records (failures logged, never blocking).
create or replace function private.olo_after_quality_change() returns trigger language plpgsql security definer set search_path = public, private as $$
declare c record;
begin
  if coalesce(current_setting('olo.engine', true), '') = 'running' then return null; end if;
  perform set_config('olo.engine', 'running', true);
  for c in select id from public.companies order by created_at loop
    begin
      if tg_table_name in ('quality_inspections','quality_containments','production_jobs') then perform private.olo_evaluate_reproduction(c.id); end if;
      if tg_table_name in ('dispatches','delivery_dispositions') then perform private.olo_evaluate_delivery(c.id); end if;
      perform private.olo_verify_tasks(c.id);
    exception when others then
      insert into public.olo_engine_errors(company_id, source, message) values (c.id, left(tg_table_name || ':batch2', 80), left(sqlerrm, 500));
    end;
  end loop;
  perform set_config('olo.engine', '', true);
  return null;
end;
$$;
revoke all on function private.olo_after_quality_change() from public, anon, authenticated;
create trigger zzz_olo_quality_inspections after insert or update of status on public.quality_inspections for each statement execute function private.olo_after_quality_change();
create trigger zzz_olo_dispatch_delivery after update of delivery_status on public.dispatches for each statement execute function private.olo_after_quality_change();
create trigger zzz_olo_delivery_dispositions after insert or update on public.delivery_dispositions for each statement execute function private.olo_after_quality_change();
create trigger zzz_olo_short_closures after insert on public.order_delivery_short_closures for each statement execute function private.olo_after_quality_change();

-- Approved order change: withdraw stale preparation work for that order and re-evaluate.
create or replace function private.olo_after_order_change() returns trigger language plpgsql security definer set search_path = public, private as $$
declare t public.tasks%rowtype; v_order text; v_n integer := 0;
begin
  if new.status <> 'approved' or old.status = 'approved' then return null; end if;
  begin
    select order_number into v_order from public.orders where id = new.order_id;
    for t in select * from public.tasks x where x.company_id = new.company_id and x.workflow_order_id = new.order_id and x.status in ('open','in_progress')
        and x.workflow_kind in ('billet_allocation','die_preparation','billet_shortage','reproduction') loop
      perform private.olo_close_task(t, false, 'Withdrawn: an order change was approved; the work is re-evaluated against the revised order', jsonb_build_object('change_proposal_id', new.id));
      v_n := v_n + 1;
    end loop;
    perform private.olo_event(new.company_id, 'order.change_approved', new.order_id, null, 'production_planning',
      format('Order change approved for %s; %s open preparation task(s) re-evaluated', coalesce(v_order, '-'), v_n), jsonb_build_object('proposal_id', new.id, 'changes', new.changes), 'change:' || new.id);
    perform private.ap3_notify_roles(new.company_id, private.olo_uniq(private.olo_roles(new.company_id, 'production_planning', 0) || private.olo_roles(new.company_id, 'tool_room', 0)
        || private.olo_roles(new.company_id, 'billet_inventory', 0)), 'olo_order_change', 'warning', format('Order change approved: %s', coalesce(v_order, '-')),
      format('An approved change to order %s may affect billets, dies, drawings and the schedule. Open work for the order was withdrawn and re-evaluated; check the revised specification before preparing material.', coalesce(v_order, '-')),
      'order', new.order_id, '/orders/' || new.order_id || '/lifecycle', 'olo-change:' || new.id, null);
    perform set_config('olo.engine', 'running', true);
    perform private.olo_sync_queue(new.company_id, 'job_change');
    perform private.olo_evaluate_material_risk(new.company_id);
    perform private.olo_evaluate_reproduction(new.company_id);
    perform set_config('olo.engine', '', true);
  exception when others then
    insert into public.olo_engine_errors(company_id, source, message) values (new.company_id, 'order_change_proposals', left(sqlerrm, 500));
  end;
  return null;
end;
$$;
revoke all on function private.olo_after_order_change() from public, anon, authenticated;
create trigger zzz_olo_order_change after update of status on public.order_change_proposals for each row execute function private.olo_after_order_change();

-- ---------------------------------------------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_actor(p_roles text[]) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v_actor uuid := auth.uid(); v_company uuid := private.get_current_user_company_id(); v_role text := private.get_current_user_role(); v_name text;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users u where u.id = v_actor and u.company_id = v_company and u.is_active and u.role = v_role and u.dealer_id is null;
  if not found or not (v_role = any(p_roles)) then raise exception 'This action is not permitted for your role' using errcode = '42501'; end if;
  return jsonb_build_object('actor', v_actor, 'company', v_company, 'role', v_role, 'name', v_name);
end;
$$;
revoke all on function private.olo_actor(text[]) from public, anon, authenticated;

create or replace function public.quality_containment_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare a jsonb := private.olo_actor(private.olo_reader_roles()); v_actor uuid := (a ->> 'actor')::uuid; v_company uuid := (a ->> 'company')::uuid; v_role text := a ->> 'role';
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb); c public.quality_containments%rowtype; j public.production_jobs%rowtype; v_page integer := private.olo_page(coalesce(p_payload, '{}'::jsonb));
  v_rows jsonb; v_total bigint; v_number text; v_mode text; v_kg numeric; v_lot uuid; v_parent uuid; v_child uuid; v_acc numeric; v_rej numeric; v_insp uuid; v_plan boolean;
  v_ncr uuid; v_result text; v_count integer; v_note text; v_decision text; v_code text; v_seq integer; v_profile_code text; v_order_number text;
begin
  if p_command in ('open','cancel') and not (v_role in ('owner','admin','quality','factory_manager','production_manager')) then
    raise exception 'Only QA/QC and production management can place material under containment' using errcode = '42501';
  end if;
  if p_command in ('result','release','switch_mode') and not (v_role in ('owner','quality')) then
    raise exception 'Only QA/QC records containment results and releases material' using errcode = '42501';
  end if;

  if p_command = 'list' then
    perform private.olo_keys(v_payload, array['status','page']);
    select coalesce(jsonb_agg(x.r order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
      select jsonb_build_object('id', q.id, 'containment_number', q.containment_number, 'status', q.status, 'stage', q.stage, 'defect', q.defect, 'inspection_mode', q.inspection_mode,
        'scope_kg', q.scope_kg, 'released_accepted_kg', q.released_accepted_kg, 'released_rejected_kg', q.released_rejected_kg,
        'held_kg', q.scope_kg - q.released_accepted_kg - q.released_rejected_kg, 'job_id', q.production_job_id, 'job_number', pj.job_number, 'order_id', q.order_id,
        'order_number', o.order_number, 'opened_at', q.opened_at) r, count(*) over () total, row_number() over (order by case when q.status in ('open','partially_resolved') then 0 else 1 end, q.opened_at desc) ord
      from public.quality_containments q join public.production_jobs pj on pj.id = q.production_job_id left join public.orders o on o.id = q.order_id
      where q.company_id = v_company and case coalesce(nullif(v_payload ->> 'status', ''), 'active') when 'active' then q.status in ('open','partially_resolved') when 'all' then true else q.status = v_payload ->> 'status' end
      order by ord offset (v_page - 1) * 10 limit 10) x;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows,
      'can_open', v_role in ('owner','admin','quality','factory_manager','production_manager'));
  end if;

  if p_command = 'candidates' then
    perform private.olo_keys(v_payload, '{}');
    return jsonb_build_object('rows', (select coalesce(jsonb_agg(x order by x ->> 'completed_at' desc), '[]'::jsonb) from (
      select jsonb_build_object('job_id', pj.id, 'job_number', pj.job_number, 'order_number', o.order_number, 'completed_at', pj.completed_at, 'status', pj.status,
        'open_kg', pj.actual_quantity_kg - coalesce((select sum(qi.quantity_checked_kg) from public.quality_inspections qi where qi.production_job_id = pj.id and qi.finishing_job_id is null), 0)) x
      from public.production_jobs pj left join public.orders o on o.id = pj.order_id
      where pj.company_id = v_company and pj.status in ('completed','in_progress','on_hold') and coalesce(pj.actual_quantity_kg, 0) > 0
        and coalesce(pj.completed_at, pj.updated_at) > now() - interval '90 days'
        and not exists (select 1 from public.quality_containments c where c.production_job_id = pj.id and c.status in ('open','partially_resolved'))
      order by coalesce(pj.completed_at, pj.updated_at) desc limit 100) y where (x ->> 'open_kg')::numeric > 0));
  end if;

  if p_command = 'open' then
    perform private.olo_keys(v_payload, array['job_id','scope_kg','stage','defect','defect_kind','sampling_reference','required_samples']);
    select * into j from public.production_jobs where id = (v_payload ->> 'job_id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Production job is unavailable for this company' using errcode = '23514'; end if;
    if coalesce(j.actual_quantity_kg, 0) <= 0 then raise exception 'Record the production output before containing it' using errcode = '23514'; end if;
    v_kg := round((v_payload ->> 'scope_kg')::numeric, 3);
    -- The contained lot is output not yet dispositioned by QC; approvals already recorded stay suspended (see below).
    v_acc := j.actual_quantity_kg - coalesce((select sum(q.quantity_checked_kg) from public.quality_inspections q where q.production_job_id = j.id and q.finishing_job_id is null), 0);
    if v_kg is null or v_kg <= 0 or v_kg > v_acc + 0.001 then
      raise exception 'The contained quantity must be between 0 and the % kg of this job not yet dispositioned by QC', trim_scale(greatest(v_acc, 0)) using errcode = '23514';
    end if;
    if v_payload ->> 'defect_kind' not in ('non_destructive','destructive') or v_payload ->> 'stage' not in ('first_stage','final') then
      raise exception 'Choose the QC stage and whether the defect is checked non-destructively or by destructive test' using errcode = '23514';
    end if;
    v_mode := case when v_payload ->> 'defect_kind' = 'non_destructive' then 'full_inspection' else 'expanded_sampling' end;
    if v_mode = 'expanded_sampling' and (coalesce((v_payload ->> 'required_samples')::integer, 0) < 2 or length(btrim(coalesce(v_payload ->> 'sampling_reference', ''))) < 2) then
      raise exception 'A destructive-test defect needs the approved expanded sampling plan reference and its number of samples (at least 2)' using errcode = '23514';
    end if;
    if exists (select 1 from public.quality_containments x where x.production_job_id = j.id and x.status in ('open','partially_resolved')) then
      raise exception 'This job already has an active containment' using errcode = '23514';
    end if;
    v_number := private.olo_containment_number(v_company);
    select order_number into v_order_number from public.orders where id = j.order_id;
    select id into v_ncr from public.quality_ncrs where company_id = v_company and source_kind = 'job' and source_id = j.id;
    if v_ncr is null then
      insert into public.quality_ncrs(company_id, ncr_number, status, source_kind, source_id, production_job_id, die_id, profile_id, order_id, customer_id, title, checked_qty, unit, evidence, description, created_by)
      values (v_company, private.ap6_ncr_number(v_company), 'open', 'job', j.id, j.id, j.die_id, j.profile_id, j.order_id, (select customer_id from public.orders where id = j.order_id),
        left('QC containment ' || v_number || ' on job ' || coalesce(j.job_number, j.id::text) || ': ' || btrim(v_payload ->> 'defect'), 200), v_kg, 'kg',
        jsonb_build_object('containment', v_number, 'stage', v_payload ->> 'stage'), btrim(v_payload ->> 'defect'), v_actor)
      returning id into v_ncr;
    end if;
    insert into public.quality_containments(company_id, containment_number, production_job_id, order_id, profile_id, stage, defect, defect_kind, inspection_mode,
      sampling_reference, required_samples, scope_kg, suspended_approved_kg, ncr_id, opened_by)
    values (v_company, v_number, j.id, j.order_id, j.profile_id, v_payload ->> 'stage', btrim(v_payload ->> 'defect'), v_payload ->> 'defect_kind', v_mode,
      nullif(btrim(coalesce(v_payload ->> 'sampling_reference', '')), ''), case when v_mode = 'expanded_sampling' then (v_payload ->> 'required_samples')::smallint end, v_kg,
      coalesce((select sum(q.quantity_checked_kg) from public.quality_inspections q where q.production_job_id = j.id and q.status = 'approved' and q.finishing_job_id is null), 0), v_ncr, v_actor)
    returning * into c;
    select count(*) + 1 into v_seq from public.material_lots where company_id = v_company and production_job_id = j.id;
    insert into public.material_lots(company_id, lot_code, kind, production_job_id, order_id, containment_id, quantity_kg, status, created_by)
      values (v_company, format('LOT-%s-%s', coalesce(j.job_number, left(j.id::text, 8)), v_seq), 'production', j.id, j.order_id, c.id, v_kg, 'held', v_actor);
    perform private.olo_event(v_company, 'qc.lot_held', j.order_id, j.id, 'quality',
      format('Lot of job %s held under %s (%s): %s', coalesce(j.job_number, '-'), v_number, private.olo_fmt_kg(v_kg), btrim(v_payload ->> 'defect')),
      jsonb_build_object('containment_id', c.id, 'mode', v_mode, 'stage', c.stage), null);
    perform private.olo_create_task(v_company, 'containment', 'quality', 1, j.order_id, null, c.id,
      format('QC containment %s: job %s', v_number, coalesce(j.job_number, '-')),
      format('%s of job %s (order %s) is held: %s. %s No material of this lot may move to ageing, packaging or dispatch until it is resolved. NCR opened.',
        private.olo_fmt_kg(v_kg), coalesce(j.job_number, '-'), coalesce(v_order_number, '-'), btrim(v_payload ->> 'defect'),
        case when v_mode = 'full_inspection' then 'Inspect every piece or identifiable sublot and record each result.'
          else format('Run the expanded sampling plan %s (%s samples) and record an engineering disposition.', c.sampling_reference, c.required_samples) end),
      'urgent', '/quality/containment/' || c.id,
      private.olo_roles(v_company, 'production', 0) || case when c.stage = 'final' then private.olo_roles(v_company, 'factory_management', 0) || private.olo_roles(v_company, 'management', 0) else '{}'::text[] end);
    return jsonb_build_object('id', c.id, 'containment_number', v_number, 'inspection_mode', v_mode, 'ncr_id', v_ncr);
  end if;

  select * into c from public.quality_containments where id = (v_payload ->> 'id')::uuid and company_id = v_company for update;
  if not found then raise exception 'Containment not found' using errcode = '23514'; end if;
  select * into j from public.production_jobs where id = c.production_job_id;

  if p_command = 'get' then
    perform private.olo_keys(v_payload, array['id']);
    return to_jsonb(c) - 'company_id' || jsonb_build_object('job_number', j.job_number, 'job_status', j.status, 'actual_kg', j.actual_quantity_kg,
      'order_number', (select order_number from public.orders where id = c.order_id), 'profile_code', (select profile_code from public.aluminium_profiles where id = c.profile_id),
      'die_number', (select die_number from public.dies where id = j.die_id), 'ncr_number', (select ncr_number from public.quality_ncrs where id = c.ncr_id),
      'held_kg', c.scope_kg - c.released_accepted_kg - c.released_rejected_kg,
      'recorded', jsonb_build_object('accepted_kg', (select coalesce(sum(quantity_kg), 0) from public.containment_results r where r.containment_id = c.id and r.result = 'accepted'),
        'rejected_kg', (select coalesce(sum(quantity_kg), 0) from public.containment_results r where r.containment_id = c.id and r.result = 'rejected'),
        'unreleased_accepted_kg', (select coalesce(sum(quantity_kg), 0) from public.containment_results r where r.containment_id = c.id and r.result = 'accepted' and r.released_lot_id is null),
        'unreleased_rejected_kg', (select coalesce(sum(quantity_kg), 0) from public.containment_results r where r.containment_id = c.id and r.result = 'rejected' and r.released_lot_id is null),
        'passing_samples', (select count(*) from public.containment_results r where r.containment_id = c.id and r.result = 'accepted'),
        'failing_samples', (select count(*) from public.containment_results r where r.containment_id = c.id and r.result = 'rejected')),
      'results', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reference', r.reference, 'result', r.result, 'quantity_kg', r.quantity_kg, 'pieces', r.pieces, 'method', r.method,
          'measurements', r.measurements, 'note', r.note, 'released', r.released_lot_id is not null, 'recorded_at', r.recorded_at,
          'recorded_by_name', (select full_name from public.app_users u where u.id = r.recorded_by)) order by r.recorded_at), '[]'::jsonb) from public.containment_results r where r.containment_id = c.id),
      'lots', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'lot_code', l.lot_code, 'kind', l.kind, 'quantity_kg', l.quantity_kg, 'status', l.status,
          'parent_lot_id', l.parent_lot_id, 'inspection_id', l.quality_inspection_id, 'created_at', l.created_at) order by l.created_at), '[]'::jsonb) from public.material_lots l where l.containment_id = c.id),
      'trace', jsonb_build_object('die_id', j.die_id, 'machine_id', j.machine_id,
        'machine_name', (select machine_name from public.machines where id = j.machine_id),
        'billets', (select coalesce(jsonb_agg(jsonb_build_object('billet_code', b.billet_code, 'source', b.source_type, 'alloy', b.alloy, 'cast_batch', fb.batch_number, 'external_batch', ob.batch_number)
          order by b.billet_code), '[]'::jsonb) from public.foundry_billets b left join public.foundry_batches fb on fb.id = b.foundry_batch_id
          left join public.outsourced_billet_batches ob on ob.id = b.outsourced_batch_id where b.production_job_id = j.id)),
      'can_record', v_role in ('owner','quality') and c.status in ('open','partially_resolved'),
      'can_cancel', v_role in ('owner','admin','quality','factory_manager','production_manager') and c.status = 'open' and c.released_accepted_kg + c.released_rejected_kg = 0);
  end if;

  if c.status not in ('open','partially_resolved') then raise exception 'This containment is already closed' using errcode = '23514'; end if;

  if p_command = 'result' then
    perform private.olo_keys(v_payload, array['id','reference','result','quantity_kg','pieces','method','measurements','note']);
    v_result := v_payload ->> 'result';
    if v_result not in ('accepted','rejected') then raise exception 'Record the result as accepted or rejected' using errcode = '23514'; end if;
    v_kg := round((v_payload ->> 'quantity_kg')::numeric, 3);
    if c.inspection_mode = 'full_inspection' then
      if v_kg is null or v_kg <= 0 then raise exception 'Record the weight of the inspected piece or sublot' using errcode = '23514'; end if;
      if (select coalesce(sum(quantity_kg), 0) from public.containment_results where containment_id = c.id) + v_kg > c.scope_kg + 0.001 then
        raise exception 'Recorded results would exceed the contained % kg', trim_scale(c.scope_kg) using errcode = '23514';
      end if;
    end if;
    insert into public.containment_results(company_id, containment_id, reference, result, quantity_kg, pieces, method, measurements, note, recorded_by)
    values (v_company, c.id, btrim(v_payload ->> 'reference'), v_result, v_kg, nullif(v_payload ->> 'pieces', '')::integer, btrim(v_payload ->> 'method'),
      case when jsonb_typeof(v_payload -> 'measurements') = 'object' then v_payload -> 'measurements' end, nullif(btrim(coalesce(v_payload ->> 'note', '')), ''), v_actor);
    return jsonb_build_object('id', c.id, 'recorded', true);
  end if;

  if p_command = 'switch_mode' then
    perform private.olo_keys(v_payload, array['id','note']);
    if c.inspection_mode <> 'expanded_sampling' then raise exception 'Only an expanded-sampling containment can switch to full inspection' using errcode = '23514'; end if;
    if length(btrim(coalesce(v_payload ->> 'note', ''))) < 10 then raise exception 'Record why the lot moves to 100%% inspection' using errcode = '23514'; end if;
    update public.quality_containments set inspection_mode = 'full_inspection' where id = c.id;
    perform private.olo_event(v_company, 'qc.inspection_mode_changed', c.order_id, c.production_job_id, 'quality', format('%s moved to 100%% inspection: %s', c.containment_number, btrim(v_payload ->> 'note')), '{}'::jsonb, null);
    return jsonb_build_object('id', c.id, 'inspection_mode', 'full_inspection');
  end if;

  if p_command = 'release' then
    perform private.olo_keys(v_payload, array['id','decision','note','prior_approved_confirmed']);
    v_note := btrim(coalesce(v_payload ->> 'note', ''));
    if length(v_note) < 10 then raise exception 'Record the disposition basis (at least 10 characters)' using errcode = '23514'; end if;
    if c.inspection_mode = 'full_inspection' then
      select coalesce(sum(quantity_kg) filter (where result = 'accepted'), 0), coalesce(sum(quantity_kg) filter (where result = 'rejected'), 0)
        into v_acc, v_rej from public.containment_results where containment_id = c.id and released_lot_id is null;
      if v_acc + v_rej <= 0 then raise exception 'Record inspection results for pieces or sublots before releasing them' using errcode = '23514'; end if;
    else
      v_decision := v_payload ->> 'decision';
      if v_decision not in ('accept_lot','reject_lot') then raise exception 'Choose whether the lot is accepted or rejected on the expanded sampling results' using errcode = '23514'; end if;
      if v_decision = 'accept_lot' then
        select count(*) into v_count from public.containment_results where containment_id = c.id and result = 'accepted';
        if exists (select 1 from public.containment_results where containment_id = c.id and result = 'rejected') then
          raise exception 'A sample failed. Reject the lot or move it to 100%% inspection; failed samples cannot be offset by passing ones' using errcode = '23514';
        end if;
        if v_count < c.required_samples then
          raise exception 'The sampling plan % needs % passing samples; % recorded', c.sampling_reference, c.required_samples, v_count using errcode = '23514';
        end if;
        v_acc := c.scope_kg - c.released_accepted_kg - c.released_rejected_kg; v_rej := 0;
      else
        v_acc := 0; v_rej := c.scope_kg - c.released_accepted_kg - c.released_rejected_kg;
      end if;
    end if;
    if c.suspended_approved_kg > 0 and c.released_accepted_kg + c.released_rejected_kg + v_acc + v_rej >= c.scope_kg - 0.001
       and coalesce((v_payload ->> 'prior_approved_confirmed')::boolean, false) is not true then
      raise exception '% kg of this job was approved before the containment and is still suspended. Confirm it was re-checked and remains acceptable, or correct it through QC before resolving.',
        trim_scale(c.suspended_approved_kg) using errcode = '23514';
    end if;
    select id into v_parent from public.material_lots where containment_id = c.id and kind = 'production';
    v_plan := private.applicable_inspection_plan(v_company, c.profile_id) is not null;
    perform set_config('olo.containment_release', 'on', true);
    for v_result, v_kg in select x.k, x.kg from (values ('accepted', v_acc), ('rejected', v_rej)) x(k, kg) where x.kg > 0 loop
      select count(*) + 1 into v_seq from public.material_lots where company_id = v_company and production_job_id = j.id;
      v_code := format('LOT-%s-%s', coalesce(j.job_number, left(j.id::text, 8)), v_seq);
      insert into public.quality_inspections(company_id, production_job_id, profile_id, inspection_date, batch_number, quantity_checked_kg, status, inspector_name, notes)
      values (v_company, j.id, j.profile_id, now(), v_code, v_kg, case when v_result = 'rejected' then 'rejected' when v_plan then 'pending' else 'approved' end, a ->> 'name',
        left(format('%s under containment %s: %s', initcap(v_result), c.containment_number, v_note), 1000))
      returning id into v_insp;
      insert into public.material_lots(company_id, lot_code, parent_lot_id, kind, production_job_id, order_id, containment_id, quality_inspection_id, quantity_kg, status, created_by)
      values (v_company, v_code, v_parent, v_result, j.id, j.order_id, c.id, v_insp, v_kg,
        case when v_result = 'rejected' then 'rejected' when v_plan then 'awaiting_plan_results' else 'released' end, v_actor)
      returning id into v_child;
      if c.inspection_mode = 'full_inspection' then
        update public.containment_results set released_lot_id = v_child where containment_id = c.id and result = v_result and released_lot_id is null;
      end if;
    end loop;
    perform set_config('olo.containment_release', '', true);
    update public.quality_containments set released_accepted_kg = released_accepted_kg + v_acc, released_rejected_kg = released_rejected_kg + v_rej,
      status = case when released_accepted_kg + v_acc + released_rejected_kg + v_rej >= scope_kg - 0.001 then 'resolved' else 'partially_resolved' end,
      resolved_at = case when released_accepted_kg + v_acc + released_rejected_kg + v_rej >= scope_kg - 0.001 then clock_timestamp() end
    where id = c.id returning * into c;
    if c.status = 'resolved' then update public.material_lots set status = 'split' where id = v_parent; end if;
    perform private.olo_event(v_company, case when v_acc > 0 and v_rej > 0 then 'qc.lot_partially_accepted' when v_acc > 0 then 'qc.lot_accepted' else 'qc.lot_rejected' end,
      c.order_id, c.production_job_id, 'quality',
      format('%s: %s accepted, %s rejected, %s still held — %s', c.containment_number, private.olo_fmt_kg(v_acc), private.olo_fmt_kg(v_rej),
        private.olo_fmt_kg(c.scope_kg - c.released_accepted_kg - c.released_rejected_kg), v_note), jsonb_build_object('containment_id', c.id), null);
    perform private.olo_evaluate_reproduction(v_company);
    perform private.olo_verify_tasks(v_company);
    return jsonb_build_object('id', c.id, 'status', c.status, 'accepted_kg', v_acc, 'rejected_kg', v_rej, 'held_kg', c.scope_kg - c.released_accepted_kg - c.released_rejected_kg,
      'plan_results_required', v_plan and v_acc > 0);
  end if;

  if p_command = 'cancel' then
    perform private.olo_keys(v_payload, array['id','reason']);
    if c.status <> 'open' or c.released_accepted_kg + c.released_rejected_kg > 0 then raise exception 'Only a containment with nothing released can be cancelled' using errcode = '23514'; end if;
    if exists (select 1 from public.containment_results where containment_id = c.id) then raise exception 'Results are recorded; resolve the containment instead of cancelling it' using errcode = '23514'; end if;
    update public.quality_containments set status = 'cancelled', cancelled_by = v_actor, cancelled_at = clock_timestamp(), cancel_reason = btrim(v_payload ->> 'reason') where id = c.id;
    update public.material_lots set status = 'released' where containment_id = c.id and kind = 'production';
    perform private.olo_event(v_company, 'qc.containment_cancelled', c.order_id, c.production_job_id, 'quality', format('%s cancelled: %s', c.containment_number, btrim(v_payload ->> 'reason')), '{}'::jsonb, null);
    perform private.olo_verify_tasks(v_company);
    return jsonb_build_object('id', c.id, 'status', 'cancelled');
  end if;
  raise exception 'Unknown containment command' using errcode = '22023';
end;
$$;
revoke all on function public.quality_containment_command(text, jsonb) from public, anon;
grant execute on function public.quality_containment_command(text, jsonb) to authenticated;

create or replace function public.remelt_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare a jsonb := private.olo_actor(private.olo_reader_roles()); v_actor uuid := (a ->> 'actor')::uuid; v_company uuid := (a ->> 'company')::uuid; v_role text := a ->> 'role';
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb); r public.remelt_approvals%rowtype; v_src jsonb; v_kg numeric; v_rows jsonb; v_total bigint; v_page integer := private.olo_page(coalesce(p_payload, '{}'::jsonb));
  v_type text; v_source uuid; v_packing uuid; v_job public.production_jobs%rowtype; v_order text; v_disp uuid; v_variance numeric; v_scrap public.foundry_aluminium_scrap%rowtype;
begin
  if p_command = 'propose' and not (v_role in ('owner','admin','quality','factory_manager','production_manager','inventory_manager','dispatch_manager')) then
    raise exception 'Your role cannot propose a remelt disposition' using errcode = '42501';
  end if;
  if p_command = 'decide' and v_role not in ('owner','factory_manager') then
    raise exception 'Only the factory manager or owner may authorise remelting' using errcode = '42501';
  end if;
  if p_command = 'receive' and v_role not in ('owner','admin','factory_manager','production_manager','production','inventory_manager') then
    raise exception 'Only the foundry and stores record the remelt receipt' using errcode = '42501';
  end if;

  if p_command = 'list' then
    perform private.olo_keys(v_payload, array['status','page']);
    select coalesce(jsonb_agg(x.r order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
      select to_jsonb(ra) - 'company_id' || jsonb_build_object('order_number', o.order_number, 'job_number', pj.job_number,
          'proposed_by_name', (select full_name from public.app_users u where u.id = ra.proposed_by), 'decided_by_name', (select full_name from public.app_users u where u.id = ra.decided_by),
          'can_decide', ra.status = 'proposed' and v_role in ('owner','factory_manager') and (ra.proposed_by <> v_actor or v_role = 'owner'),
          'can_receive', ra.status = 'awaiting_receipt' and v_role in ('owner','admin','factory_manager','production_manager','production','inventory_manager')) r,
        count(*) over () total, row_number() over (order by case ra.status when 'proposed' then 0 when 'awaiting_receipt' then 1 else 2 end, ra.proposed_at desc) ord
      from public.remelt_approvals ra left join public.orders o on o.id = ra.order_id left join public.production_jobs pj on pj.id = ra.production_job_id
      where ra.company_id = v_company and case coalesce(nullif(v_payload ->> 'status', ''), 'active') when 'active' then ra.status in ('proposed','awaiting_receipt') when 'all' then true else ra.status = v_payload ->> 'status' end
      order by ord offset (v_page - 1) * 10 limit 10) x;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows, 'role', v_role);
  end if;

  if p_command = 'sources' then
    perform private.olo_keys(v_payload, '{}');
    return jsonb_build_object('rows', (select coalesce(jsonb_agg(x order by x ->> 'inspection_date' desc), '[]'::jsonb) from (
      select jsonb_build_object('source_type', 'qc_reject', 'source_id', q.id, 'label', coalesce(q.batch_number, 'QC rejection') || ' · job ' || coalesce(pj.job_number, '-'),
        'order_number', o.order_number, 'inspection_date', q.inspection_date, 'remaining_kg', (private.olo_remelt_source(v_company, 'qc_reject', q.id, null) ->> 'remaining')::numeric) x
      from public.quality_inspections q join public.production_jobs pj on pj.id = q.production_job_id left join public.orders o on o.id = pj.order_id
      where q.company_id = v_company and q.status = 'rejected' and q.inspection_date > now() - interval '180 days') y
      where (x ->> 'remaining_kg')::numeric > 0));
  end if;

  if p_command = 'propose' then
    perform private.olo_keys(v_payload, array['source_type','source_id','packing_list_item_id','quantity_kg','reason','evidence']);
    v_type := v_payload ->> 'source_type'; v_source := (v_payload ->> 'source_id')::uuid; v_packing := nullif(v_payload ->> 'packing_list_item_id', '')::uuid;
    v_src := private.olo_remelt_source(v_company, v_type, v_source, v_packing);
    if v_src is null then raise exception 'Choose a rejected QC lot, finishing rejection or returned bundle of this company' using errcode = '23514'; end if;
    v_kg := round((v_payload ->> 'quantity_kg')::numeric, 3);
    if v_kg is null or v_kg <= 0 or v_kg > (v_src ->> 'remaining')::numeric + 0.001 then
      raise exception 'Only % kg of this material is left to disposition', trim_scale((v_src ->> 'remaining')::numeric) using errcode = '23514';
    end if;
    if length(btrim(coalesce(v_payload ->> 'reason', ''))) < 5 then raise exception 'Record the failure reason' using errcode = '23514'; end if;
    select * into v_job from public.production_jobs where id = (v_src ->> 'job_id')::uuid;
    select order_number into v_order from public.orders where id = v_job.order_id;
    insert into public.remelt_approvals(company_id, approval_number, source_type, quality_inspection_id, finishing_job_id, dispatch_id, packing_list_item_id, production_job_id, order_id,
      alloy, quantity_kg, reason, evidence, proposed_by)
    values (v_company, private.olo_remelt_number(v_company), v_type, case when v_type = 'qc_reject' then v_source end, case when v_type = 'finishing_reject' then v_source end,
      case when v_type = 'dispatch_return' then v_source end, v_packing, v_job.id, v_job.order_id,
      case when v_job.id is not null then private.production_job_alloy(v_company, v_job.id) end, v_kg, btrim(v_payload ->> 'reason'), nullif(btrim(coalesce(v_payload ->> 'evidence', '')), ''), v_actor)
    returning * into r;
    perform private.olo_event(v_company, 'material.scrap_approval_required', r.order_id, r.production_job_id, 'factory_management',
      format('%s: remelt of %s requested (%s)', r.approval_number, private.olo_fmt_kg(v_kg), btrim(v_payload ->> 'reason')), jsonb_build_object('approval_id', r.id), null);
    perform private.olo_create_task(v_company, 'remelt_approval', 'factory_management', 1, r.order_id, null, r.id,
      format('Scrap / remelt approval required: %s', r.approval_number),
      format('Order %s, %s, alloy %s: %s rejected. Reason: %s.%s Proposed disposition: remelt in the foundry. Approve or reject; only the factory manager or owner may decide.',
        coalesce(v_order, '-'), v_src ->> 'label', coalesce(r.alloy, 'not recorded'), private.olo_fmt_kg(v_kg), btrim(v_payload ->> 'reason'),
        coalesce(' Evidence: ' || r.evidence || '.', '')),
      'high', '/foundry/remelt', private.olo_roles(v_company, 'management', 0));
    return jsonb_build_object('id', r.id, 'approval_number', r.approval_number, 'status', r.status);
  end if;

  select * into r from public.remelt_approvals where id = (v_payload ->> 'id')::uuid and company_id = v_company for update;
  if not found then raise exception 'Remelt request not found' using errcode = '23514'; end if;

  if p_command = 'get' then
    perform private.olo_keys(v_payload, array['id']);
    select * into v_scrap from public.foundry_aluminium_scrap where id = r.foundry_scrap_id;
    return to_jsonb(r) - 'company_id' || jsonb_build_object('reconciliation', jsonb_build_object('rejected_kg', (private.olo_remelt_source(v_company, r.source_type,
        coalesce(r.quality_inspection_id, r.finishing_job_id, r.dispatch_id), r.packing_list_item_id) ->> 'cap')::numeric,
      'approved_kg', r.quantity_kg, 'dispositioned_kg', (select weight_kg from public.material_dispositions where id = r.material_disposition_id),
      'received_kg', r.received_kg, 'variance_kg', r.variance_kg, 'scrap_lot', v_scrap.scrap_number, 'scrap_lot_status', v_scrap.status,
      'incorporated_into_melt_kg', case when v_scrap.id is null then null else greatest(v_scrap.weight_kg - v_scrap.available_weight_kg, 0) end));
  end if;

  if p_command = 'decide' then
    perform private.olo_keys(v_payload, array['id','decision','note']);
    if r.status <> 'proposed' then raise exception 'This request is already decided' using errcode = '23514'; end if;
    if r.proposed_by = v_actor and v_role <> 'owner' then raise exception 'The person who proposed the remelt cannot also approve it' using errcode = '42501'; end if;
    if length(btrim(coalesce(v_payload ->> 'note', ''))) < 5 then raise exception 'Record the reason for the decision' using errcode = '23514'; end if;
    if v_payload ->> 'decision' = 'reject' then
      update public.remelt_approvals set status = 'rejected', decided_by = v_actor, decided_by_role = v_role, decided_at = clock_timestamp(), decision_note = btrim(v_payload ->> 'note') where id = r.id;
      perform private.olo_event(v_company, 'material.remelt_rejected', r.order_id, r.production_job_id, 'factory_management', format('%s rejected: %s', r.approval_number, btrim(v_payload ->> 'note')), '{}'::jsonb, null);
      perform private.olo_verify_tasks(v_company);
      return jsonb_build_object('id', r.id, 'status', 'rejected');
    elsif v_payload ->> 'decision' <> 'approve' then raise exception 'Approve or reject the request' using errcode = '23514';
    end if;
    update public.remelt_approvals set decided_by = v_actor, decided_by_role = v_role, decided_at = clock_timestamp(), decision_note = btrim(v_payload ->> 'note') where id = r.id;
    perform set_config('olo.remelt_approval', r.id::text, true);
    v_disp := private.record_material_disposition(r.source_type, coalesce(r.quality_inspection_id, r.finishing_job_id, r.dispatch_id), r.packing_list_item_id, 'scrap', r.quantity_kg, null,
      format('Remelt approved under %s: %s', r.approval_number, r.reason));
    perform set_config('olo.remelt_approval', '', true);
    select * into r from public.remelt_approvals where id = r.id;
    perform private.olo_event(v_company, 'material.remelt_approved', r.order_id, r.production_job_id, 'foundry',
      format('%s approved by the %s: %s to the foundry for remelt', r.approval_number, replace(v_role, '_', ' '), private.olo_fmt_kg(r.quantity_kg)), jsonb_build_object('disposition_id', v_disp), null);
    perform private.olo_create_task(v_company, 'remelt_receipt', 'foundry', 1, r.order_id, null, r.id,
      format('Approved rejected material awaiting remelt receipt: %s', r.approval_number),
      format('%s of rejected material (alloy %s) is approved for remelt under %s. Receive and weigh it at the foundry and keep it segregated by alloy until melt chemistry is verified.',
        private.olo_fmt_kg(r.quantity_kg), coalesce(r.alloy, 'not recorded'), r.approval_number), 'high', '/foundry/remelt', null);
    perform private.olo_verify_tasks(v_company);
    return jsonb_build_object('id', r.id, 'status', r.status, 'disposition_id', v_disp);
  end if;

  if p_command = 'receive' then
    perform private.olo_keys(v_payload, array['id','received_kg','weighbridge_reference','variance_note']);
    if r.status <> 'awaiting_receipt' then raise exception 'This material is not awaiting foundry receipt' using errcode = '23514'; end if;
    v_kg := round((v_payload ->> 'received_kg')::numeric, 3);
    if v_kg is null or v_kg <= 0 then raise exception 'Record the weighed quantity' using errcode = '23514'; end if;
    v_variance := round(r.quantity_kg - v_kg, 3);
    if v_variance <> 0 and length(btrim(coalesce(v_payload ->> 'variance_note', ''))) < 10 then
      raise exception 'The weighed % kg differs from the approved % kg. Explain the difference (at least 10 characters).', trim_scale(v_kg), trim_scale(r.quantity_kg) using errcode = '23514';
    end if;
    update public.remelt_approvals set status = 'received', received_kg = v_kg, variance_kg = v_variance, variance_note = case when v_variance <> 0 then btrim(v_payload ->> 'variance_note') end,
      weighbridge_reference = nullif(btrim(coalesce(v_payload ->> 'weighbridge_reference', '')), ''), received_by = v_actor, received_at = clock_timestamp() where id = r.id;
    -- The lot status changes through the metal-source disposition record (EXOS-AUD2-004).
    if r.foundry_scrap_id is not null then
      insert into private.metal_source_disposition_authorizations(transaction_id, source_table, source_id, disposition, actor_id)
        values (txid_current(), 'foundry_aluminium_scrap', r.foundry_scrap_id, 'release', v_actor) on conflict do nothing;
      insert into public.metal_source_dispositions(company_id, source_table, source_id, source_number, disposition, from_status, to_status, reason, recorded_by, recorded_by_role)
        select v_company, 'foundry_aluminium_scrap', x.id, x.scrap_number, 'release', x.status, 'available', format('Weighed in at the foundry under remelt approval %s: %s kg', r.approval_number, trim_scale(v_kg)), v_actor, v_role
        from public.foundry_aluminium_scrap x where x.id = r.foundry_scrap_id and x.status = 'reserved';
      update public.foundry_aluminium_scrap set status = 'available', notes = left(coalesce(notes || ' ', '') || format('Weighed in under %s: %s kg.', r.approval_number, trim_scale(v_kg)), 1000)
        where id = r.foundry_scrap_id and status = 'reserved';
    end if;
    perform private.olo_event(v_company, 'material.remelt_received', r.order_id, r.production_job_id, 'foundry',
      format('%s weighed in at the foundry: %s%s', r.approval_number, private.olo_fmt_kg(v_kg), case when v_variance <> 0 then format(' (variance %s kg)', trim_scale(v_variance)) else '' end),
      jsonb_build_object('variance_kg', v_variance), null);
    if v_variance <> 0 then
      perform private.ap3_notify_roles(v_company, private.olo_roles(v_company, 'factory_management', 0), 'olo_remelt_variance', case when v_variance > 0 then 'critical' else 'warning' end,
        format('Remelt weight variance: %s', r.approval_number),
        format('Approved %s kg, weighed in %s kg (difference %s kg). Reason given: %s. Reconcile the scrap lot before it is melted.', trim_scale(r.quantity_kg), trim_scale(v_kg),
          trim_scale(v_variance), btrim(v_payload ->> 'variance_note')), 'remelt_approval', r.id, '/foundry/remelt', 'olo-remelt-variance:' || r.id, null);
    end if;
    perform private.olo_verify_tasks(v_company);
    return jsonb_build_object('id', r.id, 'status', 'received', 'variance_kg', v_variance);
  end if;
  raise exception 'Unknown remelt command' using errcode = '22023';
end;
$$;
revoke all on function public.remelt_command(text, jsonb) from public, anon;
grant execute on function public.remelt_command(text, jsonb) to authenticated;

create or replace function public.priority_request_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare a jsonb := private.olo_actor(private.olo_reader_roles()); v_actor uuid := (a ->> 'actor')::uuid; v_company uuid := (a ->> 'company')::uuid; v_role text := a ->> 'role';
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb); o public.orders%rowtype; r public.priority_change_requests%rowtype; v_rows jsonb; v_total bigint;
  v_page integer := private.olo_page(coalesce(p_payload, '{}'::jsonb)); v_impact jsonb;
begin
  if p_command = 'request' and v_role not in ('owner','admin','sales_manager','sales','accounts','production_manager','factory_manager') then
    raise exception 'Your role cannot request a priority change' using errcode = '42501';
  end if;
  if p_command = 'decide' and v_role not in ('owner','factory_manager','production_manager') then
    raise exception 'Only production planning authority (production manager, factory manager or owner) decides priority' using errcode = '42501';
  end if;

  if p_command = 'list' then
    perform private.olo_keys(v_payload, array['status','order_id','page']);
    select coalesce(jsonb_agg(x.r order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
      select to_jsonb(p) - 'company_id' || jsonb_build_object('order_number', od.order_number, 'requested_by_name', (select full_name from public.app_users u where u.id = p.requested_by),
          'decided_by_name', (select full_name from public.app_users u where u.id = p.decided_by),
          'can_decide', p.status = 'pending' and v_role in ('owner','factory_manager','production_manager') and (p.requested_by <> v_actor or v_role = 'owner')) r,
        count(*) over () total, row_number() over (order by case when p.status = 'pending' then 0 else 1 end, p.requested_at desc) ord
      from public.priority_change_requests p join public.orders od on od.id = p.order_id
      where p.company_id = v_company and (v_payload ->> 'order_id' is null or p.order_id = (v_payload ->> 'order_id')::uuid)
        and case coalesce(nullif(v_payload ->> 'status', ''), 'pending') when 'all' then true else p.status = coalesce(nullif(v_payload ->> 'status', ''), 'pending') end
      order by ord offset (v_page - 1) * 10 limit 10) x;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows,
      'can_request', v_role in ('owner','admin','sales_manager','sales','accounts','production_manager','factory_manager'));
  end if;

  if p_command = 'request' then
    perform private.olo_keys(v_payload, array['order_id','to_priority','reason']);
    select * into o from public.orders where id = (v_payload ->> 'order_id')::uuid and company_id = v_company and deleted_at is null for update;
    if not found or o.current_stage in ('closed','cancelled') then raise exception 'Order is unavailable or closed' using errcode = '23514'; end if;
    if v_payload ->> 'to_priority' not in ('low','normal','high','urgent') or v_payload ->> 'to_priority' = o.priority then raise exception 'Choose a different priority' using errcode = '23514'; end if;
    if length(btrim(coalesce(v_payload ->> 'reason', ''))) < 10 then raise exception 'Record why the priority should change (at least 10 characters)' using errcode = '23514'; end if;
    if exists (select 1 from public.priority_change_requests x where x.order_id = o.id and x.status = 'pending') then raise exception 'A priority request is already pending for this order' using errcode = '23514'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('job_number', j.job_number, 'machine', m.machine_name, 'queue_rank', q.queue_rank, 'status', j.status) order by m.machine_name, q.queue_rank), '[]'::jsonb)
      into v_impact from public.production_jobs j left join public.production_queue_positions q on q.production_job_id = j.id left join public.machines m on m.id = q.machine_id
      where j.order_id = o.id and j.status in ('planned','ready','on_hold');
    insert into public.priority_change_requests(company_id, order_id, from_priority, to_priority, reason, impact, requested_by, requested_by_role)
      values (v_company, o.id, o.priority, v_payload ->> 'to_priority', btrim(v_payload ->> 'reason'), v_impact, v_actor, v_role) returning * into r;
    perform private.olo_create_task(v_company, 'priority_approval', 'production_planning', 1, o.id, null, r.id,
      format('Priority change requested: %s %s → %s', o.order_number, o.priority, r.to_priority),
      format('%s (%s) asks to change order %s from %s to %s: %s. Jobs in the queue: %s. Decide the priority; the run order changes only when the press schedule is changed.',
        a ->> 'name', replace(v_role, '_', ' '), o.order_number, o.priority, r.to_priority, r.reason,
        coalesce((select string_agg(format('%s on %s at rank %s', x ->> 'job_number', coalesce(x ->> 'machine', 'no press'), coalesce(x ->> 'queue_rank', '-')), '; ') from jsonb_array_elements(v_impact) x), 'none')),
      'high', '/orders/priority-requests', private.olo_roles(v_company, 'factory_management', 0));
    return jsonb_build_object('id', r.id, 'status', r.status);
  end if;

  select * into r from public.priority_change_requests where id = (v_payload ->> 'id')::uuid and company_id = v_company for update;
  if not found then raise exception 'Priority request not found' using errcode = '23514'; end if;
  if r.status <> 'pending' then raise exception 'This request is already closed' using errcode = '23514'; end if;

  if p_command = 'withdraw' then
    perform private.olo_keys(v_payload, array['id','note']);
    if r.requested_by <> v_actor then raise exception 'Only the requester can withdraw this request' using errcode = '42501'; end if;
    update public.priority_change_requests set status = 'withdrawn', decided_by = v_actor, decided_by_role = v_role, decided_at = clock_timestamp(),
      decision_note = coalesce(nullif(btrim(coalesce(v_payload ->> 'note', '')), ''), 'Withdrawn by the requester') where id = r.id;
    perform private.olo_verify_tasks(v_company);
    return jsonb_build_object('id', r.id, 'status', 'withdrawn');
  end if;

  if p_command = 'decide' then
    perform private.olo_keys(v_payload, array['id','decision','note']);
    if r.requested_by = v_actor and v_role <> 'owner' then raise exception 'The requester cannot decide their own priority request' using errcode = '42501'; end if;
    if v_payload ->> 'decision' not in ('approve','reject') then raise exception 'Approve or reject the request' using errcode = '23514'; end if;
    if length(btrim(coalesce(v_payload ->> 'note', ''))) < 5 then raise exception 'Record the reason for the decision' using errcode = '23514'; end if;
    select * into o from public.orders where id = r.order_id for update;
    if v_payload ->> 'decision' = 'approve' then
      if o.priority is distinct from r.from_priority then raise exception 'The order priority changed since the request; ask for a new request' using errcode = '23514'; end if;
      update public.orders set priority = r.to_priority, updated_at = now() where id = o.id;
      insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
        values (v_company, v_actor, 'order.priority_changed', 'order', o.id, jsonb_build_object('from', r.from_priority, 'to', r.to_priority, 'request_id', r.id, 'requested_by', r.requested_by, 'reason', r.reason));
    end if;
    update public.priority_change_requests set status = case when v_payload ->> 'decision' = 'approve' then 'approved' else 'rejected' end, decided_by = v_actor, decided_by_role = v_role,
      decided_at = clock_timestamp(), decision_note = btrim(v_payload ->> 'note') where id = r.id returning * into r;
    perform private.olo_event(v_company, 'order.priority_changed', o.id, null, 'production_planning',
      format('Priority %s → %s %s by %s: %s', r.from_priority, r.to_priority, r.status, a ->> 'name', r.decision_note),
      jsonb_build_object('request_id', r.id, 'requested_by', r.requested_by, 'reason', r.reason, 'impact', r.impact), null);
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, action_link, created_by)
      values (v_company, r.requested_by, 'olo_priority_decision', case when r.status = 'approved' then 'success' else 'info' end,
        format('Priority request %s: %s', r.status, o.order_number), format('%s → %s: %s', r.from_priority, r.to_priority, r.decision_note), 'order', o.id, '/orders/' || o.id || '/lifecycle', v_actor);
    perform private.olo_verify_tasks(v_company);
    return jsonb_build_object('id', r.id, 'status', r.status);
  end if;
  raise exception 'Unknown priority command' using errcode = '22023';
end;
$$;
revoke all on function public.priority_request_command(text, jsonb) from public, anon;
grant execute on function public.priority_request_command(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Lifecycle: containment and remelt state on the order (wraps the batch 1 derivation)
-- ---------------------------------------------------------------------------------------------------------------
alter function private.olo_order_core(uuid, uuid, boolean, boolean) rename to olo_order_core_b1;
create or replace function private.olo_order_core(p_company uuid, p_order uuid, p_finance boolean, p_with_gates boolean) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v jsonb := private.olo_order_core_b1(p_company, p_order, p_finance, p_with_gates); v_held numeric; v_open integer; v_first record; v_remelt integer; v_receipt integer;
  v_supply jsonb; v_domains jsonb;
begin
  select coalesce(sum(c.scope_kg - c.released_accepted_kg - c.released_rejected_kg), 0), count(*) into v_held, v_open
    from public.quality_containments c where c.company_id = p_company and c.order_id = p_order and c.status in ('open','partially_resolved');
  select c.id, c.containment_number, c.defect into v_first from public.quality_containments c where c.company_id = p_company and c.order_id = p_order
    and c.status in ('open','partially_resolved') order by c.opened_at limit 1;
  select count(*) filter (where status = 'proposed'), count(*) filter (where status = 'awaiting_receipt') into v_remelt, v_receipt
    from public.remelt_approvals where company_id = p_company and order_id = p_order;
  v_supply := private.olo_order_supply(p_company, p_order);
  v := jsonb_set(v, '{quantities,qc_held_kg}', to_jsonb(v_held));
  v := jsonb_set(v, '{quantities,reproduction_shortfall_kg}', to_jsonb(coalesce((v_supply ->> 'shortfall')::numeric, 0)));
  v_domains := (select jsonb_agg(case when d ->> 'key' = 'quality' and v_open > 0 then d || jsonb_build_object('status', 'held',
      'detail', (d ->> 'detail') || format(' · %s in containment', private.olo_fmt_kg(v_held))) else d end) from jsonb_array_elements(v -> 'domains') d);
  v_domains := v_domains || jsonb_build_array(jsonb_build_object('key', 'nonconforming', 'label', 'Nonconforming material',
    'status', case when v_open > 0 then 'contained' when v_remelt > 0 then 'remelt_approval_pending' when v_receipt > 0 then 'awaiting_foundry_receipt' else 'none_open' end,
    'detail', format('%s containment(s), %s held; %s remelt request(s) awaiting decision; %s awaiting foundry receipt', v_open, private.olo_fmt_kg(v_held), v_remelt, v_receipt)));
  v := jsonb_set(v, '{domains}', v_domains);
  if v_open > 0 and coalesce(v -> 'next_action' ->> 'department', '') not in ('finance') then
    v := jsonb_set(v, '{next_action}', jsonb_build_object('label', format('Resolve QC containment %s: %s held (%s)', v_first.containment_number, private.olo_fmt_kg(v_held), v_first.defect),
      'department', 'quality', 'link', '/quality/containment/' || v_first.id));
    v := jsonb_set(v, '{blocker}', jsonb_build_object('label', format('Material held under %s', v_first.containment_number), 'department', 'quality'));
    if v ->> 'overall' not in ('cancelled','fully_closed') then v := jsonb_set(v, '{overall}', '"awaiting_quality"'); end if;
  elsif v_remelt > 0 and jsonb_typeof(v -> 'next_action') is distinct from 'object' then
    v := jsonb_set(v, '{next_action}', jsonb_build_object('label', 'Decide the pending remelt request', 'department', 'factory_management', 'link', '/foundry/remelt'));
  end if;
  return v;
end;
$$;
revoke all on function private.olo_order_core_b1(uuid, uuid, boolean, boolean), private.olo_order_core(uuid, uuid, boolean, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security (reads only)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.quality_containments enable row level security;
alter table public.material_lots enable row level security;
alter table public.containment_results enable row level security;
alter table public.remelt_approvals enable row level security;
alter table public.priority_change_requests enable row level security;
revoke all on public.quality_containments, public.material_lots, public.containment_results, public.remelt_approvals, public.priority_change_requests from public, anon, authenticated;
grant select on public.quality_containments, public.material_lots, public.containment_results, public.remelt_approvals, public.priority_change_requests to authenticated;
create policy quality_containments_read on public.quality_containments for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy material_lots_read on public.material_lots for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy containment_results_read on public.containment_results for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy remelt_approvals_read on public.remelt_approvals for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy priority_change_requests_read on public.priority_change_requests for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));

commit;
