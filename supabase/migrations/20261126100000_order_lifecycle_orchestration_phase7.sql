-- Order lifecycle orchestration, Phase 7 — customer delivery and order closure (directive sections 26-30; strategy
-- phase 7: shipment tracking, delivery confirmation, POD, customer acceptance, complaint handling, payment follow-up,
-- operational and financial closure).
--
--   * Shipment tracking: transporter, driver or customer updates (in transit, delayed, delivery attempted, revised
--     ETA, reported delivered) are recorded per dispatch; in-transit and delayed updates move the dispatch status
--     through the existing transition, a revised ETA becomes the expected delivery. Every dispatch that left has one
--     shipment state: dispatched, in transit, delivery delayed, delivery attempted, delivered — confirmation pending,
--     proof of delivery received, delivery disputed, returned or partially returned.
--   * Delivery verification: after the dispatch is marked delivered with its proof of delivery, the delivery receipt
--     records the actual delivery time, receiving company and person, bundles and kilograms received, shortage and
--     damage, and how the customer acknowledged it. A receipt is immutable; a correction supersedes it with a reason.
--     A shortage, damage or missing bundle opens a delivery discrepancy for sales that closes only when the affected
--     bundles carry a resolved customer disposition. A clean receipt may record acceptance of every bundle at once.
--     A transporter's "delivered" is never customer acceptance.
--   * Customer acceptance: each delivered dispatch has one acceptance outcome (accepted in full, accepted partially,
--     acceptance pending, customer quality complaint, quantity shortage, transit damage, material return requested,
--     commercial dispute), derived from the bundle dispositions, return authorisations and open complaints.
--   * Complaints: customer complaints become a formal workflow (number, category, severity, affected bundles and
--     kilograms, evidence, containment, root cause, corrective and preventive action, resolution, customer
--     communication, replacement and credit note, closure by a second person). Sales, QA, the production manager and
--     the factory manager are told at once; high and critical complaints also reach management. Replacement material
--     is linked to the complaint on a dispatch of the same order and is not counted again as order fulfilment; a free
--     replacement is never invoiced, a chargeable one needs a credit note against the rejected material first.
--   * Payment follow-up: an issued invoice that is due (under the agreed terms) and not settled gives finance one task;
--     amounts appear only on the finance screen and in a finance-only alert. Disputes and write-offs are recorded per
--     invoice; a write-off needs authority (the delegation matrix when configured, else the owner or an admin, never
--     the proposer). A shipment marked delivered never closes a receivable.
--   * Closure: an order is operationally fulfilled, delivered but acceptance pending, operationally closed,
--     financially open or settled, fully closed, partially closed by authorisation or cancelled. The closure review
--     now also checks customer acceptance, open complaints, QC holds, delivery receipts, NCRs, receivable disputes and
--     write-offs, QC records and replacement quantities; final closure refuses carried items. An operationally closed
--     order can be finally closed without reopening it. A database guard refuses any closure with open obligations.
--     Closure review and final closure tasks are raised when an order becomes ready; management is told when an order
--     is fully closed.
-- Additive: new tables, columns, settings, task kinds, triggers and wrappers. Earlier functions are wrapped, not
-- rewritten; olo_settings_for, olo_guard_workflow_task, olo_expected_delivery and olo_evaluate_shipment are redefined
-- with the Phase 7 additions marked.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ---------------------------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------------------------
alter table public.olo_settings
  add column if not exists payment_followup_lead_days smallint not null default 0 check (payment_followup_lead_days between 0 and 30);

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
    s.fg_transfer_hours := 8; s.invoice_due_hours := 4; s.enforce_fg_receipt := false;
    -- Phase 7
    s.payment_followup_lead_days := 0;
  end if;
  return s;
end;
$$;

-- The Phase 6 command keeps every command; this wrapper saves the Phase 7 setting.
alter function public.olo_command(text, jsonb) rename to olo_command_p6;
alter function public.olo_command_p6(text, jsonb) set schema private;
revoke all on function private.olo_command_p6(text, jsonb) from public, anon, authenticated;

create or replace function public.olo_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_payload jsonb := coalesce(p_payload, '{}'::jsonb); a jsonb; v_before public.olo_settings; v_lead integer; v_rest jsonb;
  v_keys text[] := array['payment_followup_lead_days'];
begin
  if p_command <> 'settings.save' or jsonb_typeof(v_payload) is distinct from 'object' or not (v_payload ?| v_keys) then
    return private.olo_command_p6(p_command, v_payload);
  end if;
  a := private.olo_actor(private.olo_reader_roles());
  if (a ->> 'role') not in ('owner','admin','factory_manager') then
    raise exception 'Only the owner, admin or factory manager can change orchestration settings' using errcode = '42501';
  end if;
  begin
    v_lead := (v_payload ->> 'payment_followup_lead_days')::integer;
  exception when others then
    raise exception 'Settings must be numbers' using errcode = '22023';
  end;
  if v_lead is null or v_lead not between 0 and 30 then raise exception 'The payment follow-up lead must be 0 to 30 days before the due date' using errcode = '23514'; end if;
  v_before := private.olo_settings_for((a ->> 'company')::uuid);
  v_rest := v_payload - v_keys;
  if v_rest <> '{}'::jsonb then
    perform private.olo_command_p6('settings.save', v_rest);
  else
    insert into public.olo_settings(company_id, updated_by) values ((a ->> 'company')::uuid, (a ->> 'actor')::uuid) on conflict (company_id) do nothing;
  end if;
  update public.olo_settings set payment_followup_lead_days = v_lead, updated_by = (a ->> 'actor')::uuid, updated_at = now()
    where company_id = (a ->> 'company')::uuid;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values ((a ->> 'company')::uuid, (a ->> 'actor')::uuid, 'olo_settings.updated', 'olo_settings', (a ->> 'company')::uuid,
      jsonb_build_object('before', jsonb_build_object('payment_followup_lead_days', v_before.payment_followup_lead_days),
        'changes', jsonb_build_object('payment_followup_lead_days', v_lead)));
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
        'initial_qc','ageing_release','ageing_cycle','ageing_review','final_qc','fg_transfer','fg_receipt','dispatch_invoice',
        'delivery_discrepancy','complaint_investigation','complaint_resolution','complaint_replacement','complaint_credit_note','complaint_closure',
        'payment_followup','closure_review','final_closure')
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
      when 'final_qc' then 'This task closes when QA records the final QC of the material that came out of ageing.'
      when 'fg_transfer' then 'This task closes when the packed bundles are sent to the finished-goods area, loaded or dispatched.'
      when 'fg_receipt' then 'This task closes when every bundle of the transfer is scanned in at the finished-goods area, or the transfer is closed or cancelled.'
      when 'dispatch_invoice' then 'This task closes when a tax invoice is issued for the dispatch.'
      -- Phase 7
      when 'delivery_discrepancy' then 'This task closes when the short, damaged or refused bundles carry a resolved customer disposition, or a corrected delivery receipt shows no discrepancy.'
      when 'complaint_investigation' then 'This task closes when the root cause and corrective action of the complaint are recorded, or the complaint is rejected or withdrawn.'
      when 'complaint_resolution' then 'This task closes when the resolution of the complaint and the customer communication are recorded.'
      when 'complaint_replacement' then 'This task closes when replacement material for the complaint has left the factory on a linked dispatch.'
      when 'complaint_credit_note' then 'This task closes when an issued credit note is linked to the complaint.'
      when 'complaint_closure' then 'This task closes when a second person verifies and closes the complaint.'
      when 'payment_followup' then 'This task closes when the invoice is settled: paid, credited or written off under authority.'
      when 'closure_review' then 'This task closes when the operational closure of the order is recorded.'
      else 'This task closes when the final closure of the order is recorded.' end
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
-- Small request helpers (payload validation inside the Phase 7 commands)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_p7_text(p jsonb, k text, lo integer, hi integer, label text, required boolean default true) returns text
language plpgsql immutable set search_path = public, private as $$
declare v text := nullif(btrim(coalesce(p ->> k, '')), '');
begin
  if v is null then
    if required then raise exception '% is required', label using errcode = '22023'; end if;
    return null;
  end if;
  if v ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception '% contains control characters', label using errcode = '22023'; end if;
  if length(v) < lo or length(v) > hi then raise exception '% must be % to % characters', label, lo, hi using errcode = '22023'; end if;
  return v;
end;
$$;
create or replace function private.olo_p7_uuid(p jsonb, k text, label text, required boolean default true) returns uuid
language plpgsql immutable set search_path = public, private as $$
begin
  if nullif(btrim(coalesce(p ->> k, '')), '') is null then
    if required then raise exception 'Choose %', label using errcode = '22023'; end if;
    return null;
  end if;
  return (p ->> k)::uuid;
exception when invalid_text_representation then
  raise exception 'Invalid %', label using errcode = '22023';
end;
$$;
create or replace function private.olo_p7_num(p jsonb, k text, lo numeric, hi numeric, label text, required boolean default true) returns numeric
language plpgsql immutable set search_path = public, private as $$
declare v numeric;
begin
  if p ->> k is null or btrim(p ->> k) = '' then
    if required then raise exception '% is required', label using errcode = '22023'; end if;
    return null;
  end if;
  begin
    v := (p ->> k)::numeric;
  exception when others then raise exception '% must be a number', label using errcode = '22023';
  end;
  if v::text in ('NaN','Infinity','-Infinity') or v < lo or v > hi then raise exception '% must be between % and %', label, lo, hi using errcode = '22023'; end if;
  return v;
end;
$$;
create or replace function private.olo_p7_page(p jsonb) returns integer language plpgsql immutable set search_path = public, private as $$
declare v integer;
begin
  begin v := coalesce((p ->> 'page')::integer, 1); exception when others then raise exception 'Invalid page' using errcode = '22023'; end;
  if v < 1 or v > 100000 then raise exception 'Invalid page' using errcode = '22023'; end if;
  return v;
end;
$$;
create or replace function private.olo_p7_search(p jsonb) returns text language plpgsql immutable set search_path = public, private as $$
declare v text := lower(btrim(coalesce(p ->> 'search', '')));
begin
  if length(v) > 80 then raise exception 'The search is too long' using errcode = '22023'; end if;
  if v ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception 'The search contains control characters' using errcode = '22023'; end if;
  return v;
end;
$$;
create or replace function private.olo_p7_dir(p jsonb) returns text language plpgsql immutable set search_path = public, private as $$
declare v text := coalesce(p ->> 'direction', 'desc');
begin
  if v not in ('asc','desc') then raise exception 'Invalid sort direction' using errcode = '22023'; end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Shipment tracking updates and delivery receipts
-- ---------------------------------------------------------------------------------------------------------------
create table public.dispatch_tracking_updates (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  dispatch_id uuid not null,
  order_id uuid not null,
  kind text not null check (kind in ('in_transit','delayed','delivery_attempted','eta_revised','delivered_reported')),
  source text not null check (source in ('transporter','driver','customer','staff')),
  location text check (location is null or length(btrim(location)) between 2 and 120),
  revised_eta timestamptz,
  note text not null check (length(btrim(note)) between 5 and 500),
  status_changed_to text,
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (kind <> 'eta_revised' or revised_eta is not null),
  check (revised_eta is null or kind in ('eta_revised','delayed')),
  unique (company_id, id),
  foreign key (company_id, dispatch_id) references public.dispatches(company_id, id),
  foreign key (company_id, order_id) references public.orders(company_id, id),
  foreign key (company_id, recorded_by) references public.app_users(company_id, id)
);
create index dispatch_tracking_updates_dispatch_idx on public.dispatch_tracking_updates(company_id, dispatch_id, recorded_at desc);
create index dispatch_tracking_updates_order_idx on public.dispatch_tracking_updates(company_id, order_id);
create index dispatch_tracking_updates_actor_idx on public.dispatch_tracking_updates(recorded_by);

create table public.delivery_receipts (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  dispatch_id uuid not null,
  order_id uuid not null,
  delivered_at timestamptz not null,
  receiving_company text not null check (length(btrim(receiving_company)) between 2 and 160),
  receiver_name text not null check (length(btrim(receiver_name)) between 2 and 120),
  receiver_phone text check (receiver_phone is null or receiver_phone ~ '^[0-9+ -]{8,20}$'),
  dispatched_bundles integer not null check (dispatched_bundles >= 0),
  dispatched_kg numeric(14,3) not null check (dispatched_kg >= 0),
  received_bundles integer not null check (received_bundles >= 0),
  received_kg numeric(14,3) not null check (received_kg >= 0),
  shortage_kg numeric(14,3) not null default 0 check (shortage_kg >= 0),
  damaged_kg numeric(14,3) not null default 0 check (damaged_kg >= 0),
  acknowledgement text not null check (acknowledgement in ('signed_challan','stamped_lr','signed_invoice','email','whatsapp','photo','phone_call')),
  pod_path text,
  note text check (note is null or length(btrim(note)) between 2 and 1000),
  accepted_all boolean not null default false,
  status text not null default 'current' check (status in ('current','superseded')),
  supersedes_id uuid references public.delivery_receipts(id),
  correction_reason text check (correction_reason is null or length(btrim(correction_reason)) between 10 and 500),
  superseded_at timestamptz,
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check ((supersedes_id is null) = (correction_reason is null)),
  check ((status = 'superseded') = (superseded_at is not null)),
  check (received_bundles <= dispatched_bundles),
  unique (company_id, id),
  foreign key (company_id, dispatch_id) references public.dispatches(company_id, id),
  foreign key (company_id, order_id) references public.orders(company_id, id),
  foreign key (company_id, recorded_by) references public.app_users(company_id, id)
);
create unique index delivery_receipts_one_current on public.delivery_receipts(company_id, dispatch_id) where status = 'current';
create index delivery_receipts_order_idx on public.delivery_receipts(company_id, order_id);
create index delivery_receipts_actor_idx on public.delivery_receipts(recorded_by);
create index delivery_receipts_supersedes_idx on public.delivery_receipts(supersedes_id) where supersedes_id is not null;

-- ---------------------------------------------------------------------------------------------------------------
-- Customer complaints: the AP-053 log becomes a formal workflow (additive columns; the AP-053 logging path keeps working)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.customer_complaints
  add column if not exists complaint_number text,
  add column if not exists category text not null default 'quality'
    check (category in ('quality','dimensional','surface_finish','wrong_material','quantity_shortage','transit_damage','documentation','delivery_delay','commercial')),
  add column if not exists severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  add column if not exists status text not null default 'open' check (status in ('open','investigating','action','resolved','closed','rejected','withdrawn')),
  add column if not exists reported_on date,
  add column if not exists customer_reference text check (customer_reference is null or length(btrim(customer_reference)) between 2 and 120),
  add column if not exists suspected_kg numeric(14,3) check (suspected_kg is null or suspected_kg > 0),
  add column if not exists evidence text check (evidence is null or length(btrim(evidence)) between 5 and 1000),
  add column if not exists due_at timestamptz,
  add column if not exists containment_action text check (containment_action is null or containment_action in ('not_required','stock_held','qc_containment','customer_stock_held','recall')),
  add column if not exists containment_note text check (containment_note is null or length(btrim(containment_note)) between 5 and 1000),
  add column if not exists containment_id uuid references public.quality_containments(id),
  add column if not exists investigated_by uuid references public.app_users(id),
  add column if not exists investigated_at timestamptz,
  add column if not exists root_cause text check (root_cause is null or length(btrim(root_cause)) between 10 and 1000),
  add column if not exists corrective_action text check (corrective_action is null or length(btrim(corrective_action)) between 10 and 1000),
  add column if not exists preventive_action text check (preventive_action is null or length(btrim(preventive_action)) between 10 and 1000),
  add column if not exists responsible_department text,
  add column if not exists cause_recorded_by uuid references public.app_users(id),
  add column if not exists cause_recorded_at timestamptz,
  add column if not exists resolution text check (resolution is null or resolution in
    ('replacement','credit_note','rework_at_site','return_for_rework','commercial_settlement','no_fault_found','legacy_ncr')),
  add column if not exists resolution_note text check (resolution_note is null or length(btrim(resolution_note)) between 10 and 1000),
  add column if not exists replacement_kg numeric(14,3) check (replacement_kg is null or replacement_kg > 0),
  add column if not exists replacement_billing text check (replacement_billing is null or replacement_billing in ('free_of_charge','chargeable')),
  add column if not exists credit_note_id uuid references public.credit_notes(id),
  add column if not exists resolved_by uuid references public.app_users(id),
  add column if not exists resolved_at timestamptz,
  add column if not exists closed_by uuid references public.app_users(id),
  add column if not exists closed_at timestamptz,
  add column if not exists closure_note text check (closure_note is null or length(btrim(closure_note)) between 10 and 1000),
  add column if not exists updated_at timestamptz;

create or replace function private.olo_complaint_due(p_logged timestamptz, p_severity text) returns timestamptz
language sql immutable set search_path = public, private as $$
  select p_logged + case p_severity when 'critical' then interval '1 day' when 'high' then interval '3 days' when 'low' then interval '14 days' else interval '7 days' end
$$;
create or replace function private.olo_complaint_number(p_company uuid, p_at timestamptz) returns text
language plpgsql security definer set search_path = public, private as $$
declare v_prefix text := 'CC-' || to_char(p_at at time zone 'Asia/Kolkata', 'YYMM') || '-'; v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':complaint_number', 0));
  select coalesce(max(substring(complaint_number from length(v_prefix) + 1)::integer), 0) + 1 into v_n
    from public.customer_complaints where company_id = p_company and complaint_number like v_prefix || '%' and substring(complaint_number from length(v_prefix) + 1) ~ '^[0-9]+$';
  return v_prefix || lpad(v_n::text, 4, '0');
end;
$$;

-- Earlier complaints: numbered in logging order; one whose NCR was closed or dismissed before this phase is recorded
-- as closed or rejected through that NCR (never as a resolution it did not have).
do $$
declare r record;
begin
  for r in select c.id, c.company_id, c.logged_at, c.logged_by, n.status ncr_status, n.closed_by, n.closed_at, n.dismissed_by, n.dismissed_at, n.dismiss_reason, n.ncr_number
      from public.customer_complaints c left join public.quality_ncrs n on n.id = c.ncr_id
      where c.complaint_number is null order by c.logged_at, c.id loop
    update public.customer_complaints set complaint_number = private.olo_complaint_number(r.company_id, r.logged_at),
      reported_on = (r.logged_at at time zone 'Asia/Kolkata')::date, due_at = private.olo_complaint_due(greatest(r.logged_at, now()), 'medium'), updated_at = now(),
      status = case when r.ncr_status = 'closed' then 'closed' when r.ncr_status = 'dismissed' then 'rejected' else 'open' end,
      resolution = case when r.ncr_status = 'closed' then 'legacy_ncr' end,
      resolved_by = case when r.ncr_status = 'closed' then coalesce(r.closed_by, r.logged_by) end,
      resolved_at = case when r.ncr_status = 'closed' then coalesce(r.closed_at, now()) end,
      closed_by = case when r.ncr_status = 'closed' then coalesce(r.closed_by, r.logged_by) when r.ncr_status = 'dismissed' then coalesce(r.dismissed_by, r.logged_by) end,
      closed_at = case when r.ncr_status = 'closed' then coalesce(r.closed_at, now()) when r.ncr_status = 'dismissed' then coalesce(r.dismissed_at, now()) end,
      closure_note = case when r.ncr_status = 'closed' then 'Closed through NCR ' || r.ncr_number || ' before the complaint workflow existed.'
        when r.ncr_status = 'dismissed' then left('NCR ' || r.ncr_number || ' dismissed before the complaint workflow existed: ' || coalesce(r.dismiss_reason, 'no reason recorded'), 1000) end
      where id = r.id;
  end loop;
end;
$$;
alter table public.customer_complaints alter column complaint_number set not null;
create unique index customer_complaints_number_idx on public.customer_complaints(company_id, complaint_number);
alter table public.customer_complaints
  add constraint customer_complaints_closed_shape check (status not in ('closed','rejected','withdrawn') or (closed_at is not null and closed_by is not null and closure_note is not null)),
  add constraint customer_complaints_resolved_shape check (status not in ('resolved','closed') or (resolution is not null and resolved_at is not null and resolved_by is not null)),
  add constraint customer_complaints_replacement_shape check ((replacement_kg is null) = (replacement_billing is null)),
  add constraint customer_complaints_cause_shape check (status not in ('action','resolved') or resolution = 'legacy_ncr' or root_cause is not null);
create index customer_complaints_status_idx on public.customer_complaints(company_id, status, due_at);
create index customer_complaints_order_idx on public.customer_complaints(company_id, order_id) where order_id is not null;
create index customer_complaints_dispatch_idx on public.customer_complaints(company_id, dispatch_id) where dispatch_id is not null;
create index customer_complaints_customer_idx on public.customer_complaints(customer_id);
create index customer_complaints_credit_note_idx on public.customer_complaints(credit_note_id) where credit_note_id is not null;
create index customer_complaints_containment_idx on public.customer_complaints(containment_id) where containment_id is not null;

-- Every new complaint (also one logged through AP-053) gets its number, report date and due time from its severity.
create or replace function private.olo_complaint_defaults() returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  new.complaint_number := coalesce(new.complaint_number, private.olo_complaint_number(new.company_id, coalesce(new.logged_at, clock_timestamp())));
  new.reported_on := coalesce(new.reported_on, (coalesce(new.logged_at, clock_timestamp()) at time zone 'Asia/Kolkata')::date);
  new.due_at := coalesce(new.due_at, private.olo_complaint_due(coalesce(new.logged_at, clock_timestamp()), new.severity));
  new.updated_at := coalesce(new.updated_at, clock_timestamp());
  return new;
end;
$$;
create trigger a_olo_complaint_defaults before insert on public.customer_complaints for each row execute function private.olo_complaint_defaults();

-- A complaint logged outside the complaint command (the AP-053 form) starts its history too; the command records its
-- own 'logged' event with the affected bundles.
create or replace function private.olo_complaint_logged() returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if coalesce(current_setting('olo.complaint_log', true), '') <> 'on' then
    insert into public.customer_complaint_events(company_id, complaint_id, action, from_status, to_status, note, facts, actor_id)
      values (new.company_id, new.id, 'logged', null, new.status, left(new.description, 1000), jsonb_build_object('category', new.category, 'severity', new.severity, 'source', 'ap053'), new.logged_by);
  end if;
  return null;
end;
$$;

-- A complaint changes only through the complaint command; AP-053 may still attach the NCR it drafts at logging.
create or replace function private.olo_complaint_guard() returns trigger language plpgsql set search_path = public, private as $$
begin
  if tg_op = 'DELETE' then raise exception 'Customer complaints are kept; withdraw or reject one instead of deleting it' using errcode = '42501'; end if;
  if coalesce(current_setting('olo.complaint', true), '') = 'on' then return new; end if;
  if old.ncr_id is null and new.ncr_id is not null and (to_jsonb(new) - 'ncr_id') = (to_jsonb(old) - 'ncr_id') then return new; end if;
  raise exception 'Customer complaints change only through the complaint screen' using errcode = '42501';
end;
$$;
create trigger b_olo_complaint_guard before update or delete on public.customer_complaints for each row execute function private.olo_complaint_guard();

create table public.customer_complaint_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  complaint_id uuid not null references public.customer_complaints(id),
  dispatch_id uuid not null,
  packing_list_item_id uuid not null,
  bundle_number text not null,
  affected_kg numeric(14,3) not null check (affected_kg > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (complaint_id, packing_list_item_id),
  foreign key (company_id, dispatch_id) references public.dispatches(company_id, id),
  foreign key (company_id, packing_list_item_id) references public.packing_list_items(company_id, id)
);
create index customer_complaint_items_line_idx on public.customer_complaint_items(company_id, packing_list_item_id);
create index customer_complaint_items_dispatch_idx on public.customer_complaint_items(company_id, dispatch_id);

create table public.customer_complaint_replacements (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  complaint_id uuid not null references public.customer_complaints(id),
  dispatch_id uuid not null,
  kg numeric(14,3) not null check (kg > 0),
  linked_by uuid not null,
  linked_at timestamptz not null default clock_timestamp(),
  withdrawn_by uuid,
  withdrawn_at timestamptz,
  withdraw_note text check (withdraw_note is null or length(btrim(withdraw_note)) between 10 and 500),
  check ((withdrawn_at is null) = (withdrawn_by is null) and (withdrawn_at is null) = (withdraw_note is null)),
  foreign key (company_id, dispatch_id) references public.dispatches(company_id, id),
  foreign key (company_id, linked_by) references public.app_users(company_id, id),
  foreign key (company_id, withdrawn_by) references public.app_users(company_id, id)
);
create unique index customer_complaint_replacements_one on public.customer_complaint_replacements(complaint_id, dispatch_id) where withdrawn_at is null;
create index customer_complaint_replacements_dispatch_idx on public.customer_complaint_replacements(company_id, dispatch_id) where withdrawn_at is null;
create index customer_complaint_replacements_linked_idx on public.customer_complaint_replacements(linked_by);
create index customer_complaint_replacements_withdrawn_idx on public.customer_complaint_replacements(withdrawn_by) where withdrawn_by is not null;

create table public.customer_complaint_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  complaint_id uuid not null references public.customer_complaints(id),
  action text not null check (action in ('logged','investigated','cause_recorded','resolved','replacement_linked','replacement_withdrawn','credit_note_linked',
    'communicated','closed','rejected','withdrawn')),
  from_status text,
  to_status text,
  note text,
  facts jsonb not null default '{}'::jsonb,
  actor_id uuid references public.app_users(id),
  occurred_at timestamptz not null default clock_timestamp()
);
create index customer_complaint_events_complaint_idx on public.customer_complaint_events(complaint_id, occurred_at);
create index customer_complaint_events_company_idx on public.customer_complaint_events(company_id);
create index customer_complaint_events_actor_idx on public.customer_complaint_events(actor_id);
create trigger z_olo_complaint_logged after insert on public.customer_complaints for each row execute function private.olo_complaint_logged();

-- ---------------------------------------------------------------------------------------------------------------
-- Receivable exceptions: disputed amounts and write-offs under authority, per invoice (finance only)
-- ---------------------------------------------------------------------------------------------------------------
create table public.receivable_exceptions (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  invoice_id uuid not null,
  customer_id uuid not null references public.customers(id),
  order_id uuid,
  kind text not null check (kind in ('dispute','write_off')),
  amount numeric(14,2) not null check (amount > 0),
  reason_category text not null check (reason_category in ('rate_difference','quantity_shortage','quality_claim','transit_damage','late_delivery_penalty',
    'tds_mismatch','settlement_discount','bad_debt','rounding','other')),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  customer_reference text check (customer_reference is null or length(btrim(customer_reference)) between 2 and 120),
  complaint_id uuid references public.customer_complaints(id),
  status text not null,
  balance_at_raise numeric(14,2) not null,
  raised_by uuid not null,
  raised_at timestamptz not null default clock_timestamp(),
  first_approved_by uuid,
  first_approved_at timestamptz,
  outcome text check (outcome is null or outcome in ('customer_to_pay','credit_note','written_off')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 10 and 500),
  check ((kind = 'dispute' and status in ('open','resolved','withdrawn')) or (kind = 'write_off' and status in ('proposed','approved','rejected','withdrawn'))),
  check ((status in ('open','proposed')) = (decided_at is null)),
  check ((decided_at is null) = (decided_by is null) and (decided_at is null) = (decision_note is null)),
  check ((outcome is not null) = (kind = 'dispute' and status = 'resolved')),
  foreign key (company_id, invoice_id) references public.invoices(company_id, id),
  foreign key (company_id, order_id) references public.orders(company_id, id),
  foreign key (company_id, raised_by) references public.app_users(company_id, id),
  foreign key (company_id, first_approved_by) references public.app_users(company_id, id),
  foreign key (company_id, decided_by) references public.app_users(company_id, id)
);
create index receivable_exceptions_invoice_idx on public.receivable_exceptions(company_id, invoice_id, status);
create index receivable_exceptions_order_idx on public.receivable_exceptions(company_id, order_id) where order_id is not null;
create index receivable_exceptions_customer_idx on public.receivable_exceptions(customer_id);
create index receivable_exceptions_complaint_idx on public.receivable_exceptions(complaint_id) where complaint_id is not null;
create index receivable_exceptions_raised_idx on public.receivable_exceptions(raised_by);
create index receivable_exceptions_first_idx on public.receivable_exceptions(first_approved_by) where first_approved_by is not null;
create index receivable_exceptions_decided_idx on public.receivable_exceptions(decided_by) where decided_by is not null;

-- Delivery records, complaint children and receivable exceptions change only through the Phase 7 commands.
create or replace function private.olo_p7_guard() returns trigger language plpgsql set search_path = public, private as $$
begin
  if coalesce(current_setting('olo.p7', true), '') = 'on' and tg_op = 'UPDATE' then return new; end if;
  raise exception 'These records change only through the delivery, complaint and receivable screens' using errcode = '42501';
end;
$$;
create trigger olo_p7_guard before update or delete on public.dispatch_tracking_updates for each row execute function private.olo_p7_guard();
create trigger olo_p7_guard before update or delete on public.delivery_receipts for each row execute function private.olo_p7_guard();
create trigger olo_p7_guard before update or delete on public.customer_complaint_items for each row execute function private.olo_p7_guard();
create trigger olo_p7_guard before update or delete on public.customer_complaint_replacements for each row execute function private.olo_p7_guard();
create trigger olo_p7_guard before update or delete on public.customer_complaint_events for each row execute function private.olo_p7_guard();
create trigger olo_p7_guard before update or delete on public.receivable_exceptions for each row execute function private.olo_p7_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- Order closures: an operational closure can be superseded by the final closure; complaints may be carried past
-- operational closure (never past final closure)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.order_closures add column if not exists superseded_at timestamptz;
alter table public.order_closures drop constraint if exists order_closures_status_check;
alter table public.order_closures add constraint order_closures_status_check check (status in ('closed','reopened','superseded'));
alter table public.order_closures add constraint order_closures_superseded_shape check ((status = 'superseded') = (superseded_at is not null));
alter table public.order_closure_carries drop constraint if exists order_closure_carries_item_key_check;
alter table public.order_closure_carries add constraint order_closure_carries_item_key_check check (item_key ~ '^(return|exception|change|complaint):[0-9a-f-]{36}$');

-- ---------------------------------------------------------------------------------------------------------------
-- Derived states
-- ---------------------------------------------------------------------------------------------------------------
-- Expected delivery: Phase 7 puts the latest revised ETA from a tracking update first; then the confirmed (or
-- requested) end of the delivery appointment; else dispatch time plus the company's confirmation interval.
create or replace function private.olo_expected_delivery(p_company uuid, p_dispatch uuid) returns timestamptz
language sql stable security definer set search_path = public, private as $$
  select coalesce(
    -- Phase 7: a revised ETA recorded on the shipment
    (select u.revised_eta from public.dispatch_tracking_updates u where u.company_id = p_company and u.dispatch_id = p_dispatch and u.revised_eta is not null
       order by u.recorded_at desc limit 1),
    (select coalesce(a.confirmed_end, a.requested_end) from public.delivery_appointments a where a.company_id = p_company and a.dispatch_id = p_dispatch
       and a.status not in ('cancelled') order by a.revision desc, a.created_at desc limit 1),
    (select d.actual_dispatched_at + make_interval(days => (private.olo_settings_for(p_company)).delivery_confirmation_days) from public.dispatches d where d.id = p_dispatch))
$$;

create or replace function private.olo_open_complaint_statuses() returns text[] language sql immutable set search_path = public, private as $$
  select array['open','investigating','action','resolved']
$$;

-- Bundles and net kilograms on a dispatch's packing list.
create or replace function private.olo_dispatch_manifest(p_company uuid, p_dispatch uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('bundles', count(*), 'kg', coalesce(sum(coalesce(p.net_weight_kg, p.gross_weight_kg - p.tare_weight_kg)), 0))
  from public.packing_list_items p where p.company_id = p_company and p.dispatch_id = p_dispatch
$$;

-- The current delivery receipt's discrepancy: what was reported short, damaged or missing, and whether the bundle
-- dispositions now account for it. Weighbridge variance up to 0.5 % (or the reproduction tolerance) is not a shortage;
-- an explicitly reported shortage or damage, or a missing bundle, always is.
create or replace function private.olo_receipt_discrepancy(p_company uuid, p_dispatch uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r public.delivery_receipts; v_tol numeric := (private.olo_settings_for(p_company)).reproduction_tolerance_kg; v_kg numeric; v_open boolean;
  v_covered numeric; v_unresolved integer;
begin
  select * into r from public.delivery_receipts where company_id = p_company and dispatch_id = p_dispatch and status = 'current';
  if r.id is null then return null; end if;
  v_kg := greatest(r.shortage_kg + r.damaged_kg, r.dispatched_kg - r.received_kg, 0);
  v_open := r.shortage_kg + r.damaged_kg > v_tol or r.dispatched_kg - r.received_kg > greatest(v_tol, round(r.dispatched_kg * 0.005, 3))
    or r.received_bundles < r.dispatched_bundles;
  select coalesce(sum(x.quantity_kg) filter (where x.disposition <> 'accepted'), 0), count(*) filter (where x.disposition <> 'accepted' and x.resolution is null)
    into v_covered, v_unresolved from public.delivery_dispositions x where x.company_id = p_company and x.dispatch_id = p_dispatch and x.reversed_at is null;
  return jsonb_build_object('receipt_id', r.id, 'open', v_open, 'discrepancy_kg', round(v_kg, 3), 'missing_bundles', r.dispatched_bundles - r.received_bundles,
    'shortage_kg', r.shortage_kg, 'damaged_kg', r.damaged_kg, 'covered_kg', v_covered, 'unresolved', v_unresolved,
    'resolved', v_open and v_covered + v_tol >= v_kg and v_unresolved = 0 and v_covered > 0);
end;
$$;

-- Customer acceptance of one dispatch, from its bundle dispositions, return authorisations and open complaints.
create or replace function private.olo_dispatch_acceptance(p_company uuid, p_dispatch uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare d record; v_lines integer; v_pending integer; v_acc numeric; v_ref numeric; v_dam numeric; v_short numeric; v_unres integer; v_unres_ref integer;
  v_unres_dam integer; v_unres_short integer; v_cats text[]; v_return boolean; v_outcome text;
begin
  select x.id, x.delivery_status into d from public.dispatches x where x.id = p_dispatch and x.company_id = p_company;
  if d.id is null then return null; end if;
  select count(*), count(*) filter (where not exists (select 1 from public.delivery_dispositions x where x.company_id = p_company and x.packing_list_item_id = p.id and x.reversed_at is null))
    into v_lines, v_pending from public.packing_list_items p where p.company_id = p_company and p.dispatch_id = p_dispatch;
  select coalesce(sum(x.quantity_kg) filter (where x.disposition = 'accepted'), 0), coalesce(sum(x.quantity_kg) filter (where x.disposition = 'refused'), 0),
    coalesce(sum(x.quantity_kg) filter (where x.disposition = 'damaged'), 0), coalesce(sum(x.quantity_kg) filter (where x.disposition = 'short_claimed'), 0),
    count(*) filter (where x.disposition <> 'accepted' and x.resolution is null), count(*) filter (where x.disposition = 'refused' and x.resolution is null),
    count(*) filter (where x.disposition = 'damaged' and x.resolution is null), count(*) filter (where x.disposition = 'short_claimed' and x.resolution is null)
    into v_acc, v_ref, v_dam, v_short, v_unres, v_unres_ref, v_unres_dam, v_unres_short
    from public.delivery_dispositions x where x.company_id = p_company and x.dispatch_id = p_dispatch and x.reversed_at is null;
  -- A complaint on the dispatch, or on its order without naming a dispatch.
  select coalesce(array_agg(distinct c.category), '{}') into v_cats from public.customer_complaints c
    where c.company_id = p_company and c.status = any(private.olo_open_complaint_statuses())
      and (c.dispatch_id = p_dispatch or (c.dispatch_id is null and c.order_id = (select x.order_id from public.dispatches x where x.id = p_dispatch)));
  v_return := exists (select 1 from public.return_authorizations a where a.company_id = p_company and a.dispatch_id = p_dispatch and a.status = 'authorized');
  v_outcome := case
    when d.delivery_status not in ('delivered','damaged','returned') and v_acc + v_ref + v_dam + v_short = 0 then 'not_delivered'
    when v_cats && array['quality','dimensional','surface_finish','wrong_material'] then 'customer_quality_complaint'
    when v_cats && array['commercial','documentation','delivery_delay'] then 'commercial_dispute'
    when v_return or v_unres_ref > 0 then 'material_return_requested'
    when v_unres_dam > 0 or 'transit_damage' = any(v_cats) then 'transit_damage'
    when v_unres_short > 0 or 'quantity_shortage' = any(v_cats) then 'quantity_shortage'
    when v_pending > 0 then 'acceptance_pending'
    when v_ref + v_dam + v_short > 0 then 'accepted_partially'
    else 'accepted_in_full' end;
  return jsonb_build_object('outcome', v_outcome, 'lines', v_lines, 'pending_lines', v_pending, 'accepted_kg', v_acc, 'refused_kg', v_ref, 'damaged_kg', v_dam,
    'short_kg', v_short, 'unresolved', v_unres, 'open_complaint_categories', to_jsonb(v_cats), 'return_requested', v_return);
end;
$$;

-- One shipment state per dispatch (directive section 27).
create or replace function private.olo_shipment_state(p_company uuid, p_dispatch uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare d public.dispatches; u public.dispatch_tracking_updates; v_exp timestamptz; v_disc jsonb; v_acc jsonb; v_state text; v_returned boolean; v_receipt public.delivery_receipts;
begin
  select * into d from public.dispatches where id = p_dispatch and company_id = p_company;
  if d.id is null then return null; end if;
  select * into u from public.dispatch_tracking_updates where company_id = p_company and dispatch_id = p_dispatch order by recorded_at desc, id desc limit 1;
  select * into v_receipt from public.delivery_receipts where company_id = p_company and dispatch_id = p_dispatch and status = 'current';
  v_exp := case when d.actual_dispatched_at is not null then private.olo_expected_delivery(p_company, p_dispatch) end;
  v_disc := private.olo_receipt_discrepancy(p_company, p_dispatch);
  v_acc := private.olo_dispatch_acceptance(p_company, p_dispatch);
  v_returned := exists (select 1 from public.connected_return_receipts c where c.company_id = p_company and c.dispatch_id = p_dispatch)
    or exists (select 1 from public.return_authorizations a where a.company_id = p_company and a.dispatch_id = p_dispatch and a.status = 'closed' and coalesce(a.received_kg_at_close, 0) > 0);
  v_state := case
    when d.actual_dispatched_at is null or d.delivery_status = 'pending' then 'pending'
    when d.delivery_status = 'returned' then 'returned'
    when d.delivery_status = 'damaged' then 'delivery_disputed'
    when d.delivery_status = 'delivered' then case
      when v_returned then 'partially_returned'
      when (v_disc is not null and (v_disc ->> 'open')::boolean and not (v_disc ->> 'resolved')::boolean) or (v_acc ->> 'unresolved')::integer > 0
        or jsonb_array_length(v_acc -> 'open_complaint_categories') > 0 then 'delivery_disputed'
      when v_receipt.id is null then 'delivered_confirmation_pending'
      else 'pod_received' end
    when u.kind = 'delivered_reported' then 'delivered_confirmation_pending'
    when u.kind = 'delivery_attempted' then 'delivery_attempted'
    when d.delivery_status = 'delayed' or v_exp < clock_timestamp() then 'delivery_delayed'
    when d.delivery_status = 'in_transit' or u.kind = 'in_transit' then 'in_transit'
    else 'dispatched' end;
  return jsonb_build_object('state', v_state, 'delivery_status', d.delivery_status, 'dispatched_at', d.actual_dispatched_at, 'delivered_at', d.delivered_at,
    'expected_at', v_exp, 'overdue', d.delivery_status in ('dispatched','in_transit','delayed') and v_exp < clock_timestamp(),
    'pod_on_file', nullif(btrim(coalesce(d.proof_of_delivery_url, '')), '') is not null,
    'last_update', case when u.id is not null then jsonb_build_object('kind', u.kind, 'at', u.recorded_at, 'location', u.location, 'note', u.note, 'source', u.source) end,
    'receipt_id', v_receipt.id, 'discrepancy', v_disc, 'acceptance', v_acc);
end;
$$;

-- A dispatch linked in full as a free-of-charge replacement for a complaint: no tax invoice is expected for it.
create or replace function private.olo_free_replacement(p_company uuid, p_dispatch uuid) returns text
language sql stable security definer set search_path = public, private as $$
  select c.complaint_number from public.customer_complaint_replacements x join public.customer_complaints c on c.id = x.complaint_id
  where x.company_id = p_company and x.dispatch_id = p_dispatch and x.withdrawn_at is null and c.replacement_billing = 'free_of_charge'
    and c.status not in ('rejected','withdrawn')
  order by x.linked_at limit 1
$$;

-- Replacement kilograms that left on a dispatch (not returned) for a complaint.
create or replace function private.olo_complaint_replaced_kg(p_company uuid, p_complaint uuid) returns numeric
language sql stable security definer set search_path = public, private as $$
  select coalesce(sum(x.kg), 0) from public.customer_complaint_replacements x join public.dispatches d on d.id = x.dispatch_id and d.company_id = x.company_id
  where x.company_id = p_company and x.complaint_id = p_complaint and x.withdrawn_at is null and d.actual_dispatched_at is not null and d.delivery_status <> 'returned'
$$;

-- What is still collectible on an invoice: its balance less write-offs approved under authority. Disputes do not
-- reduce it; they are financial exceptions that keep the order financially open.
create or replace function private.olo_invoice_collectible(p_company uuid, p_invoice uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('balance', coalesce(i.balance_due, 0), 'written_off', coalesce(w.approved, 0), 'pending_write_off', coalesce(w.pending, 0),
    'disputed', coalesce(w.disputed, 0), 'open_exceptions', coalesce(w.open_n, 0),
    'collectible', greatest(coalesce(i.balance_due, 0) - coalesce(w.approved, 0), 0))
  from public.invoices i
  left join lateral (select sum(e.amount) filter (where e.kind = 'write_off' and e.status = 'approved') approved,
      sum(e.amount) filter (where e.kind = 'write_off' and e.status = 'proposed') pending, sum(e.amount) filter (where e.kind = 'dispute' and e.status = 'open') disputed,
      count(*) filter (where e.status in ('open','proposed')) open_n
    from public.receivable_exceptions e where e.company_id = p_company and e.invoice_id = i.id) w on true
  where i.id = p_invoice and i.company_id = p_company
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Closure review: the NOV-058 readiness plus the Phase 7 obligations
-- ---------------------------------------------------------------------------------------------------------------
alter function private.closure_readiness(uuid, uuid, text) rename to closure_readiness_nov;
create or replace function private.closure_readiness(p_company uuid, p_order uuid, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v jsonb := private.closure_readiness_nov(p_company, p_order, p_kind); v_final boolean := p_kind = 'final'; v_items jsonb; v_add jsonb := '[]'::jsonb;
  v_repl numeric; v_ordered numeric; v_dispatched numeric; v_short public.order_delivery_short_closures; v_tol numeric;
begin
  if v is null then return v; end if;
  v_tol := (private.olo_settings_for(p_company)).reproduction_tolerance_kg;
  v_items := coalesce(v -> 'items', '[]'::jsonb);

  -- Replacement material for a complaint is not order fulfilment: the quantity check counts it out.
  select coalesce(sum(x.kg), 0) into v_repl from public.customer_complaint_replacements x
    join public.dispatches d on d.id = x.dispatch_id and d.company_id = x.company_id
    where x.company_id = p_company and x.withdrawn_at is null and d.order_id = p_order and d.actual_dispatched_at is not null and d.delivery_status <> 'returned';
  if v_repl > 0 then
    v_ordered := (v ->> 'ordered_kg')::numeric;
    v_dispatched := greatest((v ->> 'dispatched_kg')::numeric - v_repl, 0);
    select * into v_short from public.order_delivery_short_closures where company_id = p_company and order_id = p_order order by closed_at desc limit 1;
    if not exists (select 1 from jsonb_array_elements(v_items) e where e ->> 'key' = 'quantity:' || p_order and e ->> 'domain' = 'sales') then
      v_items := coalesce((select jsonb_agg(e order by n) from jsonb_array_elements(v_items) with ordinality t(e, n) where e ->> 'key' <> 'quantity:' || p_order), '[]'::jsonb);
      if v_ordered - v_dispatched > 0.0005 then
        v_items := jsonb_build_array(jsonb_build_object('key', 'quantity:' || p_order, 'domain', 'dispatch',
          'label', case when v_short.id is null then 'Ordered quantity not yet dispatched' else 'Remaining quantity short-closed' end, 'owner', 'dispatch_manager',
          'href', '/orders/' || p_order,
          'detail', case when v_short.id is null then concat(trim_scale(round(v_ordered - v_dispatched, 3)), ' kg of ', trim_scale(v_ordered),
              ' kg has not left the factory (', trim_scale(v_repl), ' kg of replacement material for complaints is not counted). Dispatch it or short-close the delivery with a reason.')
            else concat(trim_scale(round(v_ordered - v_dispatched, 3)), ' kg remains short-closed: ', v_short.reason) end,
          'quantity_kg', round(v_ordered - v_dispatched, 3), 'blocking', v_short.id is null, 'carriable', false, 'resolved', v_short.id is not null, 'carried', false)) || v_items;
      end if;
    end if;
    v := v || jsonb_build_object('dispatched_kg', v_dispatched, 'replacement_kg', v_repl);
  end if;

  -- A free-of-charge replacement dispatch needs no invoice; a receivable written off under authority is settled;
  -- final closure does not accept items carried past operational closure.
  v_items := coalesce((select jsonb_agg(case
      when e ->> 'key' like 'receivable:%' and (private.olo_invoice_collectible(p_company, substring(e ->> 'key' from 12)::uuid) ->> 'collectible')::numeric <= 0.005
        then e || jsonb_build_object('blocking', false, 'resolved', true, 'detail', 'The remaining balance is written off under authority; post the write-off in the books of account.')
      when v_final and coalesce((e ->> 'carried')::boolean, false)
        then e || jsonb_build_object('blocking', true, 'detail', coalesce(e ->> 'detail', '') || ' Carried past operational closure; resolve it before final closure.')
      else e end order by n)
    from jsonb_array_elements(v_items) with ordinality t(e, n)
    where not (e ->> 'key' like 'unbilled:%' and private.olo_free_replacement(p_company, substring(e ->> 'key' from 10)::uuid) is not null)), '[]'::jsonb);

  -- Customer acceptance of every delivered dispatch.
  v_add := v_add || coalesce((select jsonb_agg(jsonb_build_object('key', 'acceptance:' || d.id, 'domain', 'acceptance', 'owner', 'sales_manager', 'href', '/dispatches/deliveries/' || d.id,
      'label', 'Customer acceptance not recorded for dispatch ' || coalesce(d.dispatch_number, ''),
      'detail', concat((a ->> 'pending_lines'), ' of ', (a ->> 'lines'), ' bundle(s) have no customer disposition. A delivery report is not customer acceptance.'),
      'blocking', true, 'carriable', false, 'carried', false) order by d.dispatch_date, d.id)
    from public.dispatches d cross join lateral private.olo_dispatch_acceptance(p_company, d.id) a
    where d.company_id = p_company and d.order_id = p_order and d.delivery_status = 'delivered' and (a ->> 'pending_lines')::integer > 0), '[]'::jsonb);
  -- Open customer complaints (may be carried past operational closure with a reason, never past final closure).
  v_add := v_add || coalesce((select jsonb_agg(jsonb_build_object('key', 'complaint:' || c.id, 'domain', 'quality', 'owner', case when c.status in ('open','investigating') then 'quality' else 'sales_manager' end,
      'href', '/quality/complaints/' || c.id, 'label', 'Customer complaint ' || c.complaint_number || ' is ' || replace(c.status, '_', ' '),
      'detail', concat(initcap(replace(c.category, '_', ' ')), ' · ', c.severity, ' severity · ', left(c.description, 160)),
      'blocking', true, 'carriable', true, 'carried', false) order by c.logged_at)
    from public.customer_complaints c where c.company_id = p_company and c.order_id = p_order and c.status = any(private.olo_open_complaint_statuses())), '[]'::jsonb);
  -- QC holds on the order's jobs.
  v_add := v_add || coalesce((select jsonb_agg(jsonb_build_object('key', 'containment:' || q.id, 'domain', 'quality', 'owner', 'quality', 'href', '/quality/containment/' || q.id,
      'label', 'QC containment ' || q.containment_number || ' is ' || replace(q.status, '_', ' '), 'detail', left(q.defect, 200),
      'blocking', true, 'carriable', false, 'carried', false) order by q.opened_at)
    from public.quality_containments q join public.production_jobs j on j.id = q.production_job_id and j.company_id = q.company_id
    where q.company_id = p_company and j.order_id = p_order and q.status in ('open','partially_resolved')), '[]'::jsonb);
  -- Administrative and financial closure (final closure only): delivery evidence, quality records, traceability gaps and
  -- financial exceptions. Operational closure does not list them.
  if v_final then
  -- Delivery evidence: a verified delivery receipt for every delivered dispatch.
  v_add := v_add || coalesce((select jsonb_agg(jsonb_build_object('key', 'receipt:' || d.id, 'domain', 'records', 'owner', 'dispatch_manager', 'href', '/dispatches/deliveries/' || d.id,
      'label', 'Delivery receipt not verified for dispatch ' || coalesce(d.dispatch_number, ''),
      'detail', 'Record who received the material, the bundles and kilograms received and any shortage or damage from the proof of delivery.',
      'blocking', v_final, 'carriable', false, 'carried', false) order by d.dispatch_date, d.id)
    from public.dispatches d where d.company_id = p_company and d.order_id = p_order and d.delivery_status = 'delivered'
      and not exists (select 1 from public.delivery_receipts r where r.company_id = p_company and r.dispatch_id = d.id and r.status = 'current')), '[]'::jsonb);
  -- Quality records: NCRs still open, and completed jobs without any QC record.
  v_add := v_add || coalesce((select jsonb_agg(jsonb_build_object('key', 'ncr:' || n.id, 'domain', 'records', 'owner', 'quality', 'href', '/quality/ncrs',
      'label', 'NCR ' || n.ncr_number || ' is ' || n.status, 'detail', left(n.title, 160), 'blocking', v_final, 'carriable', false, 'carried', false) order by n.created_at)
    from public.quality_ncrs n where n.company_id = p_company and n.order_id = p_order and n.status in ('draft','open')), '[]'::jsonb);
  v_add := v_add || coalesce((select jsonb_agg(jsonb_build_object('key', 'qc:' || j.id, 'domain', 'records', 'owner', 'quality', 'href', '/production/' || j.id,
      'label', 'Production job ' || coalesce(j.job_number, '') || ' has no QC record', 'detail', 'Every produced lot needs its QC decision on record before final closure.',
      'blocking', v_final, 'carriable', false, 'carried', false) order by j.job_number, j.id)
    from public.production_jobs j where j.company_id = p_company and j.order_id = p_order and j.status = 'completed' and coalesce(j.actual_quantity_kg, 0) > 0
      and not exists (select 1 from public.quality_inspections qi where qi.company_id = p_company and qi.production_job_id = j.id)), '[]'::jsonb);
  -- Billet traceability gaps are shown, never invented, and do not block (they cannot be recorded after the fact).
  v_add := v_add || coalesce((select jsonb_agg(jsonb_build_object('key', 'trace:' || j.id, 'domain', 'records', 'owner', 'production_manager', 'href', '/production/' || j.id,
      'label', 'No billet issue recorded for job ' || coalesce(j.job_number, ''), 'detail', 'The billet and cast lineage of this job is not on record; the gap stays visible in the closure snapshot.',
      'blocking', false, 'carriable', false, 'carried', false) order by j.job_number, j.id)
    from public.production_jobs j where j.company_id = p_company and j.order_id = p_order and j.status = 'completed' and coalesce(j.actual_quantity_kg, 0) > 0
      and not exists (select 1 from public.production_billet_issues b where b.company_id = p_company and b.production_job_id = j.id)), '[]'::jsonb);
  -- Financial exceptions (amounts are on the finance screen only).
  v_add := v_add || coalesce((select jsonb_agg(jsonb_build_object('key', e.kind || ':' || e.id, 'domain', 'billing', 'owner', 'accounts', 'href', '/payments/follow-up/' || e.invoice_id,
      'label', case e.kind when 'dispute' then 'Disputed amount on invoice ' else 'Write-off awaiting decision on invoice ' end || coalesce(i.invoice_number, ''),
      'detail', case e.kind when 'dispute' then 'The customer disputes part of the invoice. Resolve the dispute (customer pays, credit note or write-off).'
        else 'A proposed write-off is waiting for an authorised decision.' end,
      'blocking', v_final, 'carriable', false, 'carried', false) order by e.raised_at)
    from public.receivable_exceptions e join public.invoices i on i.id = e.invoice_id
    where e.company_id = p_company and e.order_id = p_order and e.status in ('open','proposed')), '[]'::jsonb);
  end if;
  -- A free replacement that was invoiced anyway would bill the customer twice.
  v_add := v_add || coalesce((select jsonb_agg(jsonb_build_object('key', 'double_bill:' || d.id, 'domain', 'billing', 'owner', 'accounts', 'href', '/invoices',
      'label', 'Free replacement dispatch ' || coalesce(d.dispatch_number, '') || ' has an issued invoice',
      'detail', 'The dispatch is the free-of-charge replacement for complaint ' || private.olo_free_replacement(p_company, d.id) || '. Cancel the invoice or change the complaint''s billing.',
      'blocking', true, 'carriable', false, 'carried', false) order by d.dispatch_date)
    from public.dispatches d where d.company_id = p_company and d.order_id = p_order and private.olo_free_replacement(p_company, d.id) is not null
      and exists (select 1 from public.invoices i where i.company_id = p_company and i.dispatch_id = d.id and i.deleted_at is null and i.status not in ('draft','cancelled'))), '[]'::jsonb);

  -- A complaint carried with a reason no longer blocks operational closure.
  select coalesce(jsonb_agg(case when cc.id is not null then e || jsonb_build_object('blocking', v_final, 'carried', true, 'carry_reason', cc.reason,
      'detail', coalesce(e ->> 'detail', '') || case when v_final then ' Carried past operational closure; resolve it before final closure.' else '' end) else e end order by n), '[]'::jsonb)
    into v_add from jsonb_array_elements(v_add) with ordinality t(e, n)
    left join public.order_closure_carries cc on cc.company_id = p_company and cc.order_id = p_order and cc.item_key = e ->> 'key' and cc.withdrawn_at is null
      and coalesce((e ->> 'carriable')::boolean, false);
  v_items := v_items || v_add;
  return v || jsonb_build_object('items', v_items, 'blocking', (select count(*) from jsonb_array_elements(v_items) x where (x ->> 'blocking')::boolean));
end;
$$;

-- The closure state of an order (directive section 30): operational, financial and administrative closure apart.
create or replace function private.olo_closure_state(p_company uuid, p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare o public.orders; v_cl public.order_closures; v_r jsonb; v_n integer := 0; v_collectible numeric := 0; v_exc integer := 0; v_fin text; v_auth boolean;
  v_left boolean; v_op text; v_overall text; v_first jsonb; v_records integer; v_acc integer; v_other integer;
begin
  select * into o from public.orders where id = p_order and company_id = p_company and deleted_at is null;
  if o.id is null then return null; end if;
  select * into v_cl from public.order_closures where company_id = p_company and order_id = p_order and status = 'closed';
  select count(*), coalesce(sum((c ->> 'collectible')::numeric), 0), coalesce(sum((c ->> 'open_exceptions')::integer), 0)
    into v_n, v_collectible, v_exc
    from public.invoices i cross join lateral private.olo_invoice_collectible(p_company, i.id) c
    where i.company_id = p_company and i.order_id = p_order and i.deleted_at is null and i.status not in ('draft','cancelled');
  v_fin := case when v_n = 0 then 'not_invoiced' when v_collectible <= 0.005 and v_exc = 0 then 'settled' else 'open' end;
  v_auth := exists (select 1 from public.order_delivery_short_closures s where s.company_id = p_company and s.order_id = p_order)
    or exists (select 1 from public.order_closure_carries c where c.company_id = p_company and c.order_id = p_order and c.withdrawn_at is null);
  v_left := exists (select 1 from public.dispatches d where d.company_id = p_company and d.order_id = p_order and d.actual_dispatched_at is not null);
  if o.current_stage = 'cancelled' then
    v_op := 'cancelled'; v_overall := 'cancelled';
  elsif v_cl.id is not null then
    v_op := 'closed';
    if v_cl.kind = 'operational' then v_r := private.closure_readiness(p_company, p_order, 'final'); end if;
    v_overall := case when v_auth then 'partially_closed_by_authorization' when v_cl.kind = 'final' then 'fully_closed'
      when v_fin = 'settled' then 'operationally_closed_financially_settled' when v_fin = 'open' then 'operationally_closed_financially_open' else 'operationally_closed' end;
  elsif not v_left then
    v_op := 'open';
  else
    v_r := private.closure_readiness(p_company, p_order, 'operational');
    select count(*) filter (where x ->> 'domain' = 'acceptance'), count(*) filter (where x ->> 'domain' <> 'acceptance') into v_acc, v_other
      from jsonb_array_elements(v_r -> 'items') x where (x ->> 'blocking')::boolean;
    v_op := case when v_acc + v_other = 0 then 'fulfilled' when v_other = 0 then 'acceptance_pending' else 'open' end;
    v_overall := case v_op when 'fulfilled' then 'operationally_fulfilled' when 'acceptance_pending' then 'delivered_acceptance_pending' end;
  end if;
  if v_r is not null then
    select x into v_first from jsonb_array_elements(v_r -> 'items') x where (x ->> 'blocking')::boolean limit 1;
    select count(*) into v_records from jsonb_array_elements(v_r -> 'items') x where (x ->> 'blocking')::boolean and x ->> 'domain' = 'records';
  end if;
  return jsonb_build_object('operational', v_op, 'financial', v_fin, 'closure_kind', v_cl.kind, 'closed_at', v_cl.closed_at, 'authorization', v_auth,
    'overall', v_overall, 'readiness_kind', case when v_cl.id is null and v_left then 'operational' when v_cl.kind = 'operational' then 'final' end,
    'blocking', coalesce((v_r ->> 'blocking')::integer, 0),
    'first_blocker', case when v_first is not null then jsonb_build_object('label', v_first ->> 'label', 'owner', v_first ->> 'owner', 'href', v_first ->> 'href', 'domain', v_first ->> 'domain') end,
    'administrative', case when v_cl.kind = 'final' then 'complete' when v_cl.kind = 'operational' then case when v_records = 0 then 'complete' else 'incomplete' end end,
    'invoices', v_n, 'open_financial_exceptions', v_exc);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Evaluation
-- ---------------------------------------------------------------------------------------------------------------
-- Latest workflow task of a kind for a source.
create or replace function private.olo_p7_last_task(p_company uuid, p_kind text, p_source uuid) returns public.tasks
language sql stable security definer set search_path = public, private as $$
  select * from public.tasks x where x.company_id = p_company and x.workflow_kind = p_kind and x.workflow_source_id = p_source order by x.workflow_cycle desc limit 1
$$;

-- A delivery receipt with a shortage, damage or missing bundle that the bundle dispositions do not yet account for.
create or replace function private.olo_evaluate_delivery_p7(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare r record; v_task public.tasks; v_disc jsonb; v_n integer := 0;
begin
  for r in select x.id, x.dispatch_id, x.order_id, x.received_bundles, x.dispatched_bundles, x.receiver_name, x.receiving_company, d.dispatch_number, o.order_number
      from public.delivery_receipts x join public.dispatches d on d.id = x.dispatch_id join public.orders o on o.id = x.order_id
      where x.company_id = p_company and x.status = 'current' and x.recorded_at > now() - interval '90 days' and d.delivery_status = 'delivered' loop
    v_disc := private.olo_receipt_discrepancy(p_company, r.dispatch_id);
    continue when not (v_disc ->> 'open')::boolean or (v_disc ->> 'resolved')::boolean;
    v_task := private.olo_p7_last_task(p_company, 'delivery_discrepancy', r.dispatch_id);
    continue when v_task.id is not null and (v_task.status in ('open','in_progress') or v_task.completion_evidence ->> 'receipt_id' = r.id::text);
    perform private.olo_event(p_company, 'delivery.discrepancy', r.order_id, null, 'sales', format('Delivery discrepancy on %s: %s short or damaged, %s bundle(s) missing',
      coalesce(r.dispatch_number, '-'), private.olo_fmt_kg((v_disc ->> 'discrepancy_kg')::numeric), v_disc ->> 'missing_bundles'), v_disc, 'delivery-discrepancy:' || r.id);
    v_n := v_n + private.olo_create_task(p_company, 'delivery_discrepancy', 'sales', coalesce(v_task.workflow_cycle, 0) + 1, r.order_id, null, r.dispatch_id,
      format('Delivery discrepancy: %s (%s)', coalesce(r.dispatch_number, '-'), coalesce(r.order_number, '-')),
      format('The delivery receipt of dispatch %s (order %s) records %s received of %s bundle(s): %s short, %s damaged, %s in total not received in good condition (received by %s, %s). Agree each affected bundle with the customer and record its disposition (short, damaged or refused) with the resolution: redelivery, credit claim, return or verified shortage. If the receipt was wrong, record a corrected receipt.',
        coalesce(r.dispatch_number, '-'), coalesce(r.order_number, '-'), r.received_bundles, r.dispatched_bundles, private.olo_fmt_kg((v_disc ->> 'shortage_kg')::numeric),
        private.olo_fmt_kg((v_disc ->> 'damaged_kg')::numeric), private.olo_fmt_kg((v_disc ->> 'discrepancy_kg')::numeric), r.receiver_name, r.receiving_company),
      'high', '/dispatches/deliveries/' || r.dispatch_id, private.olo_roles(p_company, 'dispatch', 0));
  end loop;
  return v_n;
end;
$$;

-- Complaint work: investigation, resolution, replacement, credit note and closure, each with its department.
create or replace function private.olo_complaint_department(p_category text) returns text language sql immutable set search_path = public, private as $$
  select case when p_category in ('quality','dimensional','surface_finish','wrong_material') then 'quality'
    when p_category in ('quantity_shortage','transit_damage','delivery_delay','documentation') then 'dispatch' else 'sales' end
$$;

create or replace function private.olo_complaint_ready_to_close(p_company uuid, p_complaint uuid) returns text
language plpgsql stable security definer set search_path = public, private as $$
declare c public.customer_complaints; v_tol numeric := (private.olo_settings_for(p_company)).reproduction_tolerance_kg; v_kg numeric; v_ncr record;
begin
  select * into c from public.customer_complaints where id = p_complaint and company_id = p_company;
  if c.id is null or c.status <> 'resolved' then return 'The complaint is not resolved'; end if;
  if c.replacement_kg is not null then
    v_kg := private.olo_complaint_replaced_kg(p_company, c.id);
    if v_kg + v_tol < c.replacement_kg then
      return format('Replacement material has not left the factory: %s of %s dispatched', private.olo_fmt_kg(v_kg), private.olo_fmt_kg(c.replacement_kg));
    end if;
  end if;
  if (c.resolution = 'credit_note' or c.replacement_billing = 'chargeable')
     and not exists (select 1 from public.credit_notes n where n.id = c.credit_note_id and n.status = 'issued') then
    return case when c.resolution = 'credit_note' then 'The credit note for the complaint is not issued and linked'
      else 'A chargeable replacement needs an issued credit note for the rejected material, so the customer is not billed twice' end;
  end if;
  if c.replacement_billing = 'free_of_charge' and exists (select 1 from public.customer_complaint_replacements x join public.invoices i on i.dispatch_id = x.dispatch_id
      where x.complaint_id = c.id and x.withdrawn_at is null and i.company_id = p_company and i.deleted_at is null and i.status not in ('draft','cancelled')) then
    return 'A free-of-charge replacement dispatch has an issued invoice; cancel it or change the billing';
  end if;
  select n.ncr_number, n.status into v_ncr from public.quality_ncrs n where n.id = c.ncr_id;
  if v_ncr.status in ('draft','open') then return format('NCR %s is still %s; close or dismiss it first', v_ncr.ncr_number, v_ncr.status); end if;
  return null;
end;
$$;

create or replace function private.olo_evaluate_complaints(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare c record; v_task public.tasks; v_n integer := 0; v_tol numeric := (private.olo_settings_for(p_company)).reproduction_tolerance_kg; v_extra text[]; v_kg numeric;
  v_hi boolean; v_desc text;
begin
  for c in select x.*, o.order_number, d.dispatch_number, private.ap3_customer_name(x.customer_id) customer
      from public.customer_complaints x left join public.orders o on o.id = x.order_id left join public.dispatches d on d.id = x.dispatch_id
      where x.company_id = p_company and x.status = any(private.olo_open_complaint_statuses()) loop
    v_hi := c.severity in ('high','critical');
    v_desc := format('Complaint %s from %s (order %s%s), %s, %s severity: %s', c.complaint_number, coalesce(c.customer, 'customer'), coalesce(c.order_number, '-'),
      coalesce(', dispatch ' || c.dispatch_number, ''), replace(c.category, '_', ' '), c.severity, left(c.description, 400));
    if c.status in ('open','investigating') then
      if private.olo_p7_last_task(p_company, 'complaint_investigation', c.id) is null then
        -- Directive section 28: sales, QA, production manager and factory manager at once; management too for high or critical.
        v_extra := private.olo_roles(p_company, 'sales', 0) || private.olo_roles(p_company, 'quality', 0) || array['production_manager']
          || private.olo_roles(p_company, 'factory_management', 0) || case when v_hi then private.olo_roles(p_company, 'management', 0) else '{}'::text[] end;
        v_n := v_n + private.olo_create_task(p_company, 'complaint_investigation', private.olo_complaint_department(c.category), 1, c.order_id, null, c.id,
          format('Investigate customer complaint %s (%s)', c.complaint_number, coalesce(c.customer, 'customer')),
          v_desc || '. Decide the containment (hold stock, QC containment, customer stock or recall), then record the root cause and the corrective action.',
          case when v_hi then 'urgent' else 'high' end, '/quality/complaints/' || c.id, v_extra);
      end if;
    elsif c.status = 'action' then
      if private.olo_p7_last_task(p_company, 'complaint_resolution', c.id) is null then
        v_n := v_n + private.olo_create_task(p_company, 'complaint_resolution', 'sales', 1, c.order_id, null, c.id,
          format('Agree the resolution of complaint %s with %s', c.complaint_number, coalesce(c.customer, 'the customer')),
          v_desc || format('. Root cause: %s. Corrective action: %s. Agree the resolution with the customer (replacement, credit note, rework, return or commercial settlement) and record what was communicated.',
            left(coalesce(c.root_cause, '-'), 300), left(coalesce(c.corrective_action, '-'), 300)),
          case when v_hi then 'urgent' else 'high' end, '/quality/complaints/' || c.id, private.olo_roles(p_company, 'quality', 0));
      end if;
    elsif c.status = 'resolved' then
      if c.replacement_kg is not null then
        v_kg := private.olo_complaint_replaced_kg(p_company, c.id);
        v_task := private.olo_p7_last_task(p_company, 'complaint_replacement', c.id);
        if v_kg + v_tol < c.replacement_kg and v_task.id is null then
          v_n := v_n + private.olo_create_task(p_company, 'complaint_replacement', 'production_planning', 1, c.order_id, null, c.id,
            format('Plan replacement material for complaint %s: %s', c.complaint_number, private.olo_fmt_kg(c.replacement_kg)),
            format('Complaint %s (order %s) is resolved with %s of replacement material, %s. Plan it on the same order (it is not new order quantity and is %s), then dispatch it and link the dispatch to the complaint.',
              c.complaint_number, coalesce(c.order_number, '-'), private.olo_fmt_kg(c.replacement_kg), replace(c.replacement_billing, '_', ' '),
              case when c.replacement_billing = 'free_of_charge' then 'never invoiced' else 'invoiced only after a credit note for the rejected material' end),
            'high', '/quality/complaints/' || c.id, private.olo_roles(p_company, 'dispatch', 0));
        end if;
      end if;
      if (c.resolution = 'credit_note' or c.replacement_billing = 'chargeable')
         and not exists (select 1 from public.credit_notes n where n.id = c.credit_note_id and n.status = 'issued')
         and private.olo_p7_last_task(p_company, 'complaint_credit_note', c.id) is null then
        v_n := v_n + private.olo_create_task(p_company, 'complaint_credit_note', 'finance', 1, c.order_id, null, c.id,
          format('Issue the credit note for complaint %s', c.complaint_number),
          format('Complaint %s (order %s, %s) is resolved with %s. Issue the credit note for the affected material and link it to the complaint.',
            c.complaint_number, coalesce(c.order_number, '-'), coalesce(c.customer, 'customer'),
            case when c.resolution = 'credit_note' then 'a credit note' else 'a chargeable replacement, which is billed only after the rejected material is credited' end),
          'high', '/quality/complaints/' || c.id, null);
      end if;
      if private.olo_complaint_ready_to_close(p_company, c.id) is null and private.olo_p7_last_task(p_company, 'complaint_closure', c.id) is null then
        v_n := v_n + private.olo_create_task(p_company, 'complaint_closure', 'factory_management', 1, c.order_id, null, c.id,
          format('Verify and close complaint %s', c.complaint_number),
          v_desc || format('. Resolution: %s. Verify that the corrective action is in place and the customer accepted the resolution, then close the complaint (not by the person who resolved it).',
            replace(coalesce(c.resolution, '-'), '_', ' ')),
          'normal', '/quality/complaints/' || c.id, private.olo_roles(p_company, 'quality', 0));
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Payment follow-up (directive section 29): an issued invoice due under the agreed terms (within the lead days) and
-- not settled. The task names the invoice, customer, due date and delivery, never amounts; finance roles get the
-- amount in a separate alert.
create or replace function private.olo_evaluate_payments(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare s public.olo_settings := private.olo_settings_for(p_company); r record; v_task public.tasks; v_n integer := 0; v_c jsonb; v_due date; v_days integer;
  v_today date := private.ist_today(); v_delivery text; v_key text;
begin
  for r in select i.id, i.invoice_number, i.invoice_date, i.due_date, i.order_id, i.dispatch_id, i.customer_id, o.order_number, d.dispatch_number, d.delivery_status, d.delivered_at
      from public.invoices i left join public.orders o on o.id = i.order_id left join public.dispatches d on d.id = i.dispatch_id
      where i.company_id = p_company and i.deleted_at is null and i.status not in ('draft','cancelled') and i.opening_cutover_id is null
        and coalesce(i.balance_due, 0) > 1 and i.invoice_date > v_today - 365 and coalesce(i.due_date, i.invoice_date) <= v_today + s.payment_followup_lead_days loop
    v_c := private.olo_invoice_collectible(p_company, r.id);
    continue when (v_c ->> 'collectible')::numeric <= 1;
    v_task := private.olo_p7_last_task(p_company, 'payment_followup', r.id);
    continue when v_task.id is not null and v_task.status in ('open','in_progress');
    v_due := coalesce(r.due_date, r.invoice_date);
    v_days := v_today - v_due;
    v_delivery := case when r.dispatch_id is null then 'The invoice is not linked to a dispatch.'
      when r.delivery_status = 'delivered' then 'The material was delivered on ' || to_char(r.delivered_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.'
      when r.delivery_status in ('dispatched','in_transit','delayed') then 'The material is dispatched; delivery is not yet confirmed.'
      else 'Dispatch ' || coalesce(r.dispatch_number, '-') || ' is ' || replace(r.delivery_status, '_', ' ') || '.' end;
    v_n := v_n + private.olo_create_task(p_company, 'payment_followup', 'finance', coalesce(v_task.workflow_cycle, 0) + 1, r.order_id, null, r.id,
      format('Collect payment: invoice %s (%s)', coalesce(r.invoice_number, '-'), coalesce(private.ap3_customer_name(r.customer_id), 'customer')),
      format('Invoice %s of order %s for %s %s%s %s Follow up with the customer under the agreed payment terms and record the payment, a payment promise, a dispute or a write-off proposal. The balance is on the payment follow-up screen (finance only).',
        coalesce(r.invoice_number, '-'), coalesce(r.order_number, '-'), coalesce(private.ap3_customer_name(r.customer_id), 'customer'),
        case when v_days > 0 then format('was due on %s (%s day(s) overdue).', to_char(v_due, 'DD Mon YYYY'), v_days) when v_days = 0 then format('is due today (%s).', to_char(v_due, 'DD Mon YYYY'))
          else format('falls due on %s.', to_char(v_due, 'DD Mon YYYY')) end,
        case when r.due_date is null then ' No due date is recorded on the invoice; it is followed up from the invoice date.' else '' end, v_delivery),
      case when v_days > 30 then 'urgent' when v_days > 0 then 'high' else 'normal' end, '/payments/follow-up/' || r.id, null);
    v_task := private.olo_p7_last_task(p_company, 'payment_followup', r.id);
    v_key := 'olo-pay-amount:' || v_task.workflow_key;
    perform private.ap3_notify_roles(p_company, private.olo_finance_roles(), 'olo_payment_due', case when v_days > 30 then 'critical' else 'warning' end,
      format('Customer payment follow-up due: %s', coalesce(r.invoice_number, '-')),
      format('Order %s: invoice %s has an outstanding balance of ₹%s, %s under the agreed payment terms.%s', coalesce(r.order_number, '-'), coalesce(r.invoice_number, '-'),
        to_char((v_c ->> 'collectible')::numeric, 'FM99,99,99,99,990.00'), case when v_days > 0 then format('%s day(s) overdue', v_days) else 'due ' || to_char(v_due, 'DD Mon YYYY') end,
        case when (v_c ->> 'disputed')::numeric > 0 then format(' ₹%s of it is disputed.', to_char((v_c ->> 'disputed')::numeric, 'FM99,99,99,99,990.00')) else '' end),
      'invoice', r.id, '/payments/follow-up/' || r.id, v_key, null);
  end loop;
  return v_n;
end;
$$;

-- Closure work: an order that meets every operational obligation gets a closure review for sales management; an
-- operationally closed order that meets every final obligation gets the final closure task for finance.
create or replace function private.olo_evaluate_closure(p_company uuid, p_order uuid default null) returns integer
language plpgsql security definer set search_path = public, private as $$
declare r record; st jsonb; v_task public.tasks; v_n integer := 0;
begin
  for r in select o.id, o.order_number, o.customer_id, cl.kind from public.orders o
      left join public.order_closures cl on cl.company_id = o.company_id and cl.order_id = o.id and cl.status = 'closed'
      where o.company_id = p_company and o.deleted_at is null and o.current_stage <> 'cancelled' and o.opening_cutover_id is null
        and (p_order is null or o.id = p_order) and coalesce(cl.kind, '') <> 'final'
        and (cl.id is not null or exists (select 1 from public.dispatches d where d.company_id = p_company and d.order_id = o.id and d.actual_dispatched_at > now() - interval '365 days')) loop
    st := private.olo_closure_state(p_company, r.id);
    if r.kind is null and st ->> 'operational' = 'fulfilled' then
      v_task := private.olo_p7_last_task(p_company, 'closure_review', r.id);
      continue when v_task.id is not null and v_task.status in ('open','in_progress');
      v_n := v_n + private.olo_create_task(p_company, 'closure_review', 'sales', coalesce(v_task.workflow_cycle, 0) + 1, r.id, null, r.id,
        format('Close order %s operationally', r.order_number),
        format('Order %s (%s) meets every obligation for operational closure: the ordered quantity is dispatched or short-closed, every dispatch is delivered, customer acceptance is recorded, no complaint, QC hold or delivery exception is open and nothing is left unbilled. Review the order and record its operational closure; finance stays open until it is settled.',
          r.order_number, coalesce(private.ap3_customer_name(r.customer_id), 'customer')),
        'normal', '/orders/closure/' || r.id, null);
    elsif r.kind = 'operational' and (st ->> 'blocking')::integer = 0 then
      v_task := private.olo_p7_last_task(p_company, 'final_closure', r.id);
      continue when v_task.id is not null and v_task.status in ('open','in_progress');
      v_n := v_n + private.olo_create_task(p_company, 'final_closure', 'finance', coalesce(v_task.workflow_cycle, 0) + 1, r.id, null, r.id,
        format('Record the final closure of order %s', r.order_number),
        format('Order %s (%s) is operationally closed and every invoice is settled or written off under authority, with no dispute, open complaint, NCR or missing delivery receipt left. Review the closure record and record the final closure.',
          r.order_number, coalesce(private.ap3_customer_name(r.customer_id), 'customer')),
        'normal', '/orders/closure/' || r.id, null);
    end if;
  end loop;
  return v_n;
end;
$$;

-- Phase 6 evaluation redefined with one added condition: a free-of-charge replacement dispatch needs no invoice.
create or replace function private.olo_evaluate_shipment(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare s public.olo_settings := private.olo_settings_for(p_company); rec record; v_task public.tasks%rowtype; v_n integer := 0; v_uses boolean; v_u jsonb;
  v_draft record; v_kg numeric; v_bundles integer; v_note text;
begin
  -- Transfer reminders start once the factory uses the finished-goods transfer (or turns the receipt control on).
  v_uses := exists (select 1 from public.inventory_locations il where il.company_id = p_company and il.is_active and il.dealer_id is null and il.location_type in ('factory','warehouse'))
    and (s.enforce_fg_receipt or exists (select 1 from public.fg_transfers x where x.company_id = p_company and x.sent_at > now() - interval '90 days'));
  if v_uses then
    for rec in select r.order_id, r.order_number from private.olo_bundle_register r
        join public.orders o on o.id = r.order_id and o.company_id = r.company_id
        where r.company_id = p_company and r.state = 'packed' and r.source_kind <> 'dealer_stock'
          and r.recorded_at < clock_timestamp() - make_interval(hours => s.fg_transfer_hours) and r.recorded_at > now() - interval '60 days'
          and o.deleted_at is null and o.current_stage not in ('closed','cancelled') and o.opening_cutover_id is null
        group by r.order_id, r.order_number
    loop
      select * into v_task from public.tasks x where x.company_id = p_company and x.workflow_kind = 'fg_transfer' and x.workflow_source_id = rec.order_id
        order by x.workflow_cycle desc limit 1;
      if v_task.id is null or v_task.status not in ('open','in_progress') then
        v_u := private.olo_order_untransferred(p_company, rec.order_id, s.fg_transfer_hours);
        v_n := v_n + private.olo_create_task(p_company, 'fg_transfer', 'packaging', coalesce(v_task.workflow_cycle, 0) + 1, rec.order_id, null, rec.order_id,
          format('Move %s packed bundle(s) of %s to finished goods', v_u ->> 'bundles', rec.order_number),
          format('Order %s has %s packed bundle(s), %s net, recorded more than %s hour(s) ago and not yet sent to the finished-goods area: %s. Send them on a finished-goods transfer so dispatch can receive and load them.',
            rec.order_number, v_u ->> 'bundles', private.olo_fmt_kg((v_u ->> 'kg')::numeric), s.fg_transfer_hours, v_u ->> 'tags'),
          'normal', '/packaging/fg-transfers/new?order_id=' || rec.order_id, null);
      end if;
    end loop;
  end if;
  -- Every open transfer has its receipt task (created when sent; this covers a transfer whose task failed).
  for rec in select x.id from public.fg_transfers x where x.company_id = p_company and x.status = 'in_transit'
      and not exists (select 1 from public.tasks t2 where t2.company_id = p_company and t2.workflow_kind = 'fg_receipt' and t2.workflow_source_id = x.id) loop
    v_n := v_n + private.olo_fg_receipt_task(p_company, rec.id);
  end loop;
  -- A dispatch that left the gate without an issued tax invoice: finance.
  for rec in select d.id, d.dispatch_number, d.order_id, o.order_number, o.customer_id, d.actual_dispatched_at, d.vehicle_number
      from public.dispatches d join public.orders o on o.id = d.order_id and o.company_id = d.company_id
      where d.company_id = p_company and d.actual_dispatched_at is not null and d.actual_dispatched_at > now() - interval '60 days'
        and d.actual_dispatched_at < clock_timestamp() - make_interval(hours => s.invoice_due_hours)
        and d.delivery_status not in ('returned','damaged') and o.deleted_at is null and o.current_stage <> 'cancelled' and o.opening_cutover_id is null
        and private.olo_dispatch_invoice(p_company, d.id) is null
        -- Phase 7: a free-of-charge replacement for a complaint is never invoiced.
        and private.olo_free_replacement(p_company, d.id) is null
  loop
    select * into v_task from public.tasks x where x.company_id = p_company and x.workflow_kind = 'dispatch_invoice' and x.workflow_source_id = rec.id
      order by x.workflow_cycle desc limit 1;
    continue when v_task.id is not null and v_task.status in ('open','in_progress');
    select count(*), coalesce(sum(coalesce(p.net_weight_kg, p.gross_weight_kg - p.tare_weight_kg)), 0) into v_bundles, v_kg
      from public.packing_list_items p where p.company_id = p_company and p.dispatch_id = rec.id;
    select dr.status, dr.blocker into v_draft from public.invoice_drafts dr where dr.company_id = p_company and dr.dispatch_id = rec.id;
    v_note := case when v_draft.status = 'open' then 'A draft is ready on Invoices → Drafts to post: review it and post it.'
      when v_draft.status = 'blocked' then 'The prepared draft is blocked: ' || coalesce(v_draft.blocker, 'see Invoices → Drafts') || ' Clear the cause and post it.'
      when v_task.id is not null then 'The earlier invoice of this dispatch was cancelled; issue the replacement.'
      else 'No draft is prepared for this dispatch yet (drafts are prepared at gate-out); create the invoice from the dispatch if none appears.' end;
    v_n := v_n + private.olo_create_task(p_company, 'dispatch_invoice', 'finance', coalesce(v_task.workflow_cycle, 0) + 1, rec.order_id, null, rec.id,
      format('Issue the tax invoice for dispatch %s (%s)', coalesce(rec.dispatch_number, '-'), coalesce(rec.order_number, '-')),
      format('Dispatch %s of order %s (%s) left the gate at %s%s with %s bundle(s), %s net, and no tax invoice is issued for it. %s',
        coalesce(rec.dispatch_number, '-'), coalesce(rec.order_number, '-'), coalesce(private.ap3_customer_name(rec.customer_id), 'customer'),
        to_char(rec.actual_dispatched_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), coalesce(' on vehicle ' || rec.vehicle_number, ''), v_bundles, private.olo_fmt_kg(v_kg), v_note),
      'high', '/invoices/drafts', null);
  end loop;
  return v_n;
end;
$$;

-- Verification of the Phase 7 task kinds (earlier kinds stay with their verifiers).
alter function private.olo_verify_tasks(uuid) rename to olo_verify_tasks_p6;
create or replace function private.olo_verify_tasks(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare v_task public.tasks%rowtype; v_n integer := private.olo_verify_tasks_p6(p_company); v_disc jsonb; v_status text; c public.customer_complaints; v_kg numeric;
  v_tol numeric := (private.olo_settings_for(p_company)).reproduction_tolerance_kg; v_c jsonb; v_inv record; st jsonb; v_cl public.order_closures; v_stage text;
begin
  -- A free replacement needs no invoice: its earlier invoice task is withdrawn.
  for v_task in select * from public.tasks x where x.company_id = p_company and x.workflow_kind = 'dispatch_invoice' and x.status in ('open','in_progress')
      and private.olo_free_replacement(p_company, x.workflow_source_id) is not null for update skip locked loop
    perform private.olo_close_task(v_task, false, 'Withdrawn: the dispatch is the free-of-charge replacement for complaint ' || private.olo_free_replacement(p_company, v_task.workflow_source_id),
      jsonb_build_object('complaint', private.olo_free_replacement(p_company, v_task.workflow_source_id))); v_n := v_n + 1;
  end loop;
  for v_task in select * from public.tasks x where x.company_id = p_company and x.workflow_key is not null and x.status in ('open','in_progress')
      and x.workflow_kind in ('delivery_discrepancy','complaint_investigation','complaint_resolution','complaint_replacement','complaint_credit_note','complaint_closure',
        'payment_followup','closure_review','final_closure') order by x.created_at for update skip locked loop
    if v_task.workflow_kind = 'delivery_discrepancy' then
      select delivery_status into v_status from public.dispatches where id = v_task.workflow_source_id;
      v_disc := private.olo_receipt_discrepancy(p_company, v_task.workflow_source_id);
      if v_status is distinct from 'delivered' then
        perform private.olo_close_task(v_task, false, 'Withdrawn: the dispatch is ' || coalesce(v_status, 'unavailable'), jsonb_build_object('delivery_status', v_status)); v_n := v_n + 1;
      elsif v_disc is null or not (v_disc ->> 'open')::boolean then
        perform private.olo_close_task(v_task, true, 'Verified: the current delivery receipt shows no discrepancy', coalesce(v_disc, '{}'::jsonb)); v_n := v_n + 1;
      elsif (v_disc ->> 'resolved')::boolean then
        perform private.olo_close_task(v_task, true, format('Verified: %s recorded on the affected bundles with a resolution', private.olo_fmt_kg((v_disc ->> 'covered_kg')::numeric)), v_disc); v_n := v_n + 1;
      end if;
    elsif v_task.workflow_kind like 'complaint_%' then
      select * into c from public.customer_complaints where id = v_task.workflow_source_id;
      if c.id is null or c.status in ('rejected','withdrawn') then
        perform private.olo_close_task(v_task, false, 'Withdrawn: the complaint was ' || coalesce(c.status, 'removed'), jsonb_build_object('status', c.status)); v_n := v_n + 1;
      elsif v_task.workflow_kind = 'complaint_investigation' and c.status not in ('open','investigating') then
        perform private.olo_close_task(v_task, true, 'Verified: root cause and corrective action recorded', jsonb_build_object('status', c.status, 'root_cause', left(c.root_cause, 200))); v_n := v_n + 1;
      elsif v_task.workflow_kind = 'complaint_resolution' and c.status in ('resolved','closed') then
        perform private.olo_close_task(v_task, true, 'Verified: resolution recorded as ' || replace(coalesce(c.resolution, '-'), '_', ' '), jsonb_build_object('status', c.status, 'resolution', c.resolution)); v_n := v_n + 1;
      elsif v_task.workflow_kind = 'complaint_replacement' then
        v_kg := private.olo_complaint_replaced_kg(p_company, c.id);
        if c.replacement_kg is null then
          perform private.olo_close_task(v_task, false, 'Withdrawn: the complaint no longer needs replacement material', jsonb_build_object('resolution', c.resolution)); v_n := v_n + 1;
        elsif v_kg + v_tol >= c.replacement_kg then
          perform private.olo_close_task(v_task, true, format('Verified: %s of replacement material left on linked dispatches', private.olo_fmt_kg(v_kg)), jsonb_build_object('replaced_kg', v_kg)); v_n := v_n + 1;
        end if;
      elsif v_task.workflow_kind = 'complaint_credit_note' then
        if exists (select 1 from public.credit_notes n where n.id = c.credit_note_id and n.status = 'issued') then
          perform private.olo_close_task(v_task, true, 'Verified: credit note ' || (select credit_note_number from public.credit_notes where id = c.credit_note_id) || ' linked',
            jsonb_build_object('credit_note_id', c.credit_note_id)); v_n := v_n + 1;
        elsif c.resolution is distinct from 'credit_note' and c.replacement_billing is distinct from 'chargeable' then
          perform private.olo_close_task(v_task, false, 'Withdrawn: the resolution no longer needs a credit note', jsonb_build_object('resolution', c.resolution)); v_n := v_n + 1;
        end if;
      elsif v_task.workflow_kind = 'complaint_closure' and c.status = 'closed' then
        perform private.olo_close_task(v_task, true, 'Verified: complaint closed', jsonb_build_object('closed_at', c.closed_at)); v_n := v_n + 1;
      end if;
    elsif v_task.workflow_kind = 'payment_followup' then
      select i.status, i.deleted_at into v_inv from public.invoices i where i.id = v_task.workflow_source_id;
      v_c := private.olo_invoice_collectible(p_company, v_task.workflow_source_id);
      if v_inv.status is null or v_inv.status = 'cancelled' or v_inv.deleted_at is not null then
        perform private.olo_close_task(v_task, false, 'Withdrawn: the invoice is cancelled', jsonb_build_object('status', v_inv.status)); v_n := v_n + 1;
      elsif (v_c ->> 'collectible')::numeric <= 1 then
        perform private.olo_close_task(v_task, true, case when (v_c ->> 'written_off')::numeric > 0 then 'Verified: settled (part written off under authority)' else 'Verified: the invoice is settled' end,
          jsonb_build_object('settled', true, 'written_off', (v_c ->> 'written_off')::numeric > 0)); v_n := v_n + 1;
      end if;
      if v_task.id is not null and (select status from public.tasks where id = v_task.id) in ('completed','cancelled') then
        update public.notifications set resolved_at = clock_timestamp(), resolution = 'Payment follow-up closed', is_read = true, read_at = coalesce(read_at, now())
          where company_id = p_company and condition_key = 'olo-pay-amount:' || v_task.workflow_key and resolved_at is null;
      end if;
    elsif v_task.workflow_kind in ('closure_review','final_closure') then
      select current_stage into v_stage from public.orders where id = v_task.workflow_source_id;
      select * into v_cl from public.order_closures where company_id = p_company and order_id = v_task.workflow_source_id and status = 'closed';
      if v_stage is null or v_stage = 'cancelled' then
        perform private.olo_close_task(v_task, false, 'Withdrawn: the order is ' || coalesce(v_stage, 'unavailable'), jsonb_build_object('order_stage', v_stage)); v_n := v_n + 1;
      elsif v_task.workflow_kind = 'closure_review' and v_cl.id is not null then
        perform private.olo_close_task(v_task, true, initcap(v_cl.kind) || ' closure recorded', jsonb_build_object('closure_id', v_cl.id, 'kind', v_cl.kind)); v_n := v_n + 1;
      elsif v_task.workflow_kind = 'final_closure' and v_cl.kind = 'final' then
        perform private.olo_close_task(v_task, true, 'Final closure recorded', jsonb_build_object('closure_id', v_cl.id)); v_n := v_n + 1;
      elsif v_task.workflow_kind = 'final_closure' and v_cl.id is null then
        perform private.olo_close_task(v_task, false, 'Withdrawn: the order was reopened', '{}'::jsonb); v_n := v_n + 1;
      else
        st := private.olo_closure_state(p_company, v_task.workflow_source_id);
        if (st ->> 'blocking')::integer > 0 then
          perform private.olo_close_task(v_task, false, 'Withdrawn: ' || coalesce(st -> 'first_blocker' ->> 'label', 'an obligation is open again'),
            jsonb_build_object('blocking', st -> 'blocking', 'first_blocker', st -> 'first_blocker')); v_n := v_n + 1;
        end if;
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

alter function private.olo_run_all(uuid, text) rename to olo_run_all_p6;
create or replace function private.olo_run_all(p_company uuid, p_source text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v jsonb := private.olo_run_all_p6(p_company, p_source);
begin
  return v || jsonb_build_object('delivery_closure_tasks', private.olo_evaluate_delivery_p7(p_company) + private.olo_evaluate_complaints(p_company)
    + private.olo_evaluate_payments(p_company) + private.olo_evaluate_closure(p_company, null), 'verified_after_closure', private.olo_verify_tasks(p_company));
end;
$$;

-- Event-driven evaluation (failures logged, never blocking). Delivery, complaint and closure changes evaluate the
-- receipts of the last 90 days and the open complaints, and re-verify; payment follow-up and closure-readiness tasks
-- are raised by the hourly run (and at once by the Phase 7 commands for the order concerned).
create or replace function private.olo_after_closure_change() returns trigger language plpgsql security definer set search_path = public, private as $$
declare c record;
begin
  if coalesce(current_setting('olo.engine', true), '') = 'running' then return null; end if;
  perform set_config('olo.engine', 'running', true);
  for c in select id from public.companies order by created_at loop
    begin
      if tg_table_name not in ('payments','credit_notes','invoices') then
        perform private.olo_evaluate_delivery_p7(c.id);
        perform private.olo_evaluate_complaints(c.id);
      end if;
      perform private.olo_verify_tasks(c.id);
    exception when others then
      insert into public.olo_engine_errors(company_id, source, message) values (c.id, left(tg_table_name || ':phase7', 80), left(sqlerrm, 500));
    end;
  end loop;
  perform set_config('olo.engine', '', true);
  return null;
end;
$$;
create trigger zzz_olo_p7_dispositions after insert or update on public.delivery_dispositions for each statement execute function private.olo_after_closure_change();
create trigger zzz_olo_p7_receipts after insert or update on public.delivery_receipts for each statement execute function private.olo_after_closure_change();
create trigger zzz_olo_p7_complaints after insert or update on public.customer_complaints for each statement execute function private.olo_after_closure_change();
create trigger zzz_olo_p7_replacements after insert or update on public.customer_complaint_replacements for each statement execute function private.olo_after_closure_change();
create trigger zzz_olo_p7_closures after insert or update on public.order_closures for each statement execute function private.olo_after_closure_change();
create trigger zzz_olo_p7_dispatches after update of delivery_status on public.dispatches for each statement execute function private.olo_after_closure_change();
create trigger zzz_olo_p7_payments after insert or update on public.payments for each statement execute function private.olo_after_closure_change();
create trigger zzz_olo_p7_credit_notes after insert or update on public.credit_notes for each statement execute function private.olo_after_closure_change();
create trigger zzz_olo_p7_invoices after update of status, amount_paid, credited_amount, deleted_at on public.invoices for each statement execute function private.olo_after_closure_change();

-- ---------------------------------------------------------------------------------------------------------------
-- Closure guard and completion notice
-- ---------------------------------------------------------------------------------------------------------------
-- No order is closed (operationally or finally) while the closure review still has a blocking obligation, whichever
-- path records it (directive test 50: an order cannot reach Fully Closed with unresolved mandatory obligations).
create or replace function private.olo_guard_order_closure() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v jsonb;
begin
  if new.status <> 'closed' or (tg_op = 'UPDATE' and old.status = 'closed') then return new; end if;
  v := private.closure_readiness(new.company_id, new.order_id, new.kind);
  if coalesce((v ->> 'blocking')::integer, 0) > 0 then
    raise exception 'This order still has % open obligation(s) for % closure, starting with: %', v ->> 'blocking', new.kind,
      (select x ->> 'label' from jsonb_array_elements(v -> 'items') x where (x ->> 'blocking')::boolean limit 1) using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger b_olo_guard_order_closure before insert or update of status on public.order_closures for each row execute function private.olo_guard_order_closure();

-- Directive alert matrix: "Order fully closed → relevant management: review completion".
create or replace function private.olo_after_order_closure() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_number text;
begin
  if new.status <> 'closed' or (tg_op = 'UPDATE' and old.status = 'closed') then return null; end if;
  select order_number into v_number from public.orders where id = new.order_id;
  begin
    perform private.olo_event(new.company_id, 'closure.' || new.kind, new.order_id, null, case when new.kind = 'final' then 'finance' else 'sales' end,
      format('%s closure recorded for order %s: %s', initcap(new.kind), v_number, left(new.close_note, 200)), jsonb_build_object('closure_id', new.id), 'closure:' || new.id);
    if new.kind = 'final' then
      perform private.ap3_notify_roles(new.company_id, private.olo_uniq(private.olo_roles(new.company_id, 'management', 0) || private.olo_roles(new.company_id, 'factory_management', 0)
          || private.olo_roles(new.company_id, 'sales', 1)), 'olo_order_fully_closed', 'info', format('Order %s fully closed', v_number),
        format('Order %s is fully closed: operationally fulfilled, financially settled and its records complete. Review the completion on the closure record. Note: %s', v_number, left(new.close_note, 300)),
        'order', new.order_id, '/orders/closure/' || new.order_id, 'olo-closed:' || new.id, new.closed_by);
    end if;
  exception when others then
    insert into public.olo_engine_errors(company_id, source, message) values (new.company_id, 'order_closures:phase7', left(sqlerrm, 500));
  end;
  return null;
end;
$$;
create trigger zz_olo_after_order_closure after insert or update of status on public.order_closures for each row execute function private.olo_after_order_closure();

-- ---------------------------------------------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------------------------------------------
-- Keeps the engine from re-running inside a Phase 7 command, evaluates the order concerned and records failures
-- without blocking the command.
create or replace function private.olo_p7_refresh(p_company uuid, p_order uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare v_was text := coalesce(current_setting('olo.engine', true), '');
begin
  perform set_config('olo.engine', 'running', true);
  begin
    perform private.olo_evaluate_delivery_p7(p_company);
    perform private.olo_evaluate_complaints(p_company);
    if p_order is not null then perform private.olo_evaluate_closure(p_company, p_order); end if;
    perform private.olo_verify_tasks(p_company);
  exception when others then
    insert into public.olo_engine_errors(company_id, source, message) values (p_company, 'phase7_command', left(sqlerrm, 500));
  end;
  perform set_config('olo.engine', v_was, true);
end;
$$;

create or replace function private.olo_delivery_json(p_company uuid, p_dispatch uuid, p_role text) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'dispatch', jsonb_build_object('id', d.id, 'dispatch_number', d.dispatch_number, 'dispatch_date', d.dispatch_date, 'delivery_status', d.delivery_status,
      'dispatched_at', d.actual_dispatched_at, 'delivered_at', d.delivered_at, 'vehicle_number', d.vehicle_number, 'transporter_name', d.transporter_name,
      'driver_name', d.driver_name, 'driver_phone', d.driver_phone, 'lr_number', d.lr_number, 'eway_bill_number', d.eway_bill_number,
      'pod_on_file', nullif(btrim(coalesce(d.proof_of_delivery_url, '')), '') is not null),
    'order', jsonb_build_object('id', o.id, 'order_number', o.order_number, 'customer_id', o.customer_id, 'customer', private.ap3_customer_name(o.customer_id), 'stage', o.current_stage),
    'manifest', private.olo_dispatch_manifest(p_company, d.id),
    'shipment', private.olo_shipment_state(p_company, d.id),
    'tracking', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'source', u.source, 'location', u.location, 'revised_eta', u.revised_eta, 'note', u.note,
        'status_changed_to', u.status_changed_to, 'recorded_by_name', au.full_name, 'recorded_at', u.recorded_at) order by u.recorded_at desc), '[]'::jsonb)
      from public.dispatch_tracking_updates u left join public.app_users au on au.id = u.recorded_by where u.company_id = p_company and u.dispatch_id = d.id),
    'receipts', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'delivered_at', r.delivered_at, 'receiving_company', r.receiving_company,
        'receiver_name', r.receiver_name, 'receiver_phone', r.receiver_phone, 'dispatched_bundles', r.dispatched_bundles, 'dispatched_kg', r.dispatched_kg,
        'received_bundles', r.received_bundles, 'received_kg', r.received_kg, 'shortage_kg', r.shortage_kg, 'damaged_kg', r.damaged_kg, 'acknowledgement', r.acknowledgement,
        'note', r.note, 'accepted_all', r.accepted_all, 'correction_reason', r.correction_reason, 'recorded_by_name', au.full_name, 'recorded_at', r.recorded_at)
        order by r.recorded_at desc), '[]'::jsonb)
      from public.delivery_receipts r left join public.app_users au on au.id = r.recorded_by where r.company_id = p_company and r.dispatch_id = d.id),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'bundle_number', p.bundle_number, 'pieces', p.number_of_pieces,
        'net_kg', coalesce(p.net_weight_kg, p.gross_weight_kg - p.tare_weight_kg),
        'dispositions', (select coalesce(jsonb_agg(jsonb_build_object('disposition', x.disposition, 'quantity_kg', x.quantity_kg, 'resolution', x.resolution,
            'receiver_name', x.receiver_name, 'recorded_at', x.recorded_at) order by x.recorded_at), '[]'::jsonb)
          from public.delivery_dispositions x where x.company_id = p_company and x.packing_list_item_id = p.id and x.reversed_at is null)) order by p.bundle_number), '[]'::jsonb)
      from public.packing_list_items p where p.company_id = p_company and p.dispatch_id = d.id),
    'complaints', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'complaint_number', c.complaint_number, 'status', c.status, 'category', c.category, 'severity', c.severity)
        order by c.logged_at desc), '[]'::jsonb) from public.customer_complaints c where c.company_id = p_company and c.dispatch_id = d.id),
    'replacement_for', private.olo_free_replacement(p_company, d.id),
    'can_track', p_role in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch','sales_manager','sales'),
    'can_change_status', p_role in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch'),
    'can_record_receipt', p_role in ('owner','admin','factory_manager','dispatch_manager','dispatch','sales_manager','sales'))
  from public.dispatches d join public.orders o on o.id = d.order_id and o.company_id = d.company_id
  where d.id = p_dispatch and d.company_id = p_company
$$;

create or replace function public.delivery_tracking_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_p jsonb := coalesce(p_payload, '{}'::jsonb); a jsonb; v_company uuid; v_actor uuid; v_role text; v_page integer; v_search text; v_dir text; v_view text; v_sort text;
  v_total integer; v_rows jsonb; v_counts jsonb; v_id uuid; v_dispatch public.dispatches; v_kind text; v_source text; v_note text; v_location text; v_eta timestamptz;
  v_to text; v_up public.dispatch_tracking_updates; v_r public.delivery_receipts; v_prev public.delivery_receipts; v_m jsonb; v_at timestamptz; v_bundles integer;
  v_kg numeric; v_short numeric; v_dam numeric; v_ack text; v_accept boolean; v_tol numeric; v_reason text; v_company_name text; v_receiver text; v_phone text; v_n integer;
  c_status constant text[] := array['owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch'];
  c_track constant text[] := array['owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch','sales_manager','sales'];
  c_receipt constant text[] := array['owner','admin','factory_manager','dispatch_manager','dispatch','sales_manager','sales'];
begin
  if p_command is null or jsonb_typeof(v_p) is distinct from 'object' then raise exception 'Invalid delivery request' using errcode = '22023'; end if;
  a := private.olo_actor(private.olo_reader_roles());
  v_company := (a ->> 'company')::uuid; v_actor := (a ->> 'actor')::uuid; v_role := a ->> 'role';
  v_tol := (private.olo_settings_for(v_company)).reproduction_tolerance_kg;

  if p_command = 'board' then
    if v_p - array['view','page','search','sort','direction'] <> '{}'::jsonb then raise exception 'Invalid delivery request' using errcode = '22023'; end if;
    v_page := private.olo_p7_page(v_p); v_search := private.olo_p7_search(v_p); v_dir := private.olo_p7_dir(v_p);
    v_view := coalesce(v_p ->> 'view', 'open'); v_sort := coalesce(v_p ->> 'sort', 'dispatched_at');
    if v_view not in ('open','all','dispatched','in_transit','delivery_delayed','delivery_attempted','delivered_confirmation_pending','pod_received','delivery_disputed',
        'returned','partially_returned') or v_sort not in ('dispatched_at','expected_at','dispatch_number') then
      raise exception 'Invalid delivery view' using errcode = '22023';
    end if;
    -- Dispatches that left in the last 120 days, plus any still moving.
    -- Materialized: each row's derived state is computed once, not once per reference.
    with base as materialized (
      select d.id, d.dispatch_number, d.order_id, o.order_number, o.customer_id, d.actual_dispatched_at, d.vehicle_number, d.lr_number, d.transporter_name,
        private.olo_shipment_state(v_company, d.id) st
      from public.dispatches d join public.orders o on o.id = d.order_id and o.company_id = d.company_id
      where d.company_id = v_company and d.actual_dispatched_at is not null and o.opening_cutover_id is null
        and (d.actual_dispatched_at > now() - interval '120 days' or d.delivery_status in ('dispatched','in_transit','delayed'))
        and (v_search = '' or position(v_search in lower(concat_ws(' ', d.dispatch_number, o.order_number, private.ap3_customer_name(o.customer_id), d.vehicle_number, d.lr_number))) > 0)
    ), counted as (
      select jsonb_object_agg(s, n) c from (select b.st ->> 'state' s, count(*) n from base b group by 1) x
    ), filtered as (
      select b.*, count(*) over () total_rows,
        case v_sort when 'dispatched_at' then extract(epoch from b.actual_dispatched_at) when 'expected_at' then extract(epoch from (b.st ->> 'expected_at')::timestamptz) end sort_num,
        case when v_sort = 'dispatch_number' then b.dispatch_number end sort_text
      from base b
      where case v_view when 'all' then true
        when 'open' then b.st ->> 'state' in ('dispatched','in_transit','delivery_delayed','delivery_attempted','delivered_confirmation_pending','delivery_disputed')
        else b.st ->> 'state' = v_view end
    ), s2 as (
      select f.*, row_number() over (order by case when v_dir = 'asc' then f.sort_num end asc nulls last, case when v_dir = 'desc' then f.sort_num end desc nulls last,
        case when v_dir = 'asc' then f.sort_text end asc, case when v_dir = 'desc' then f.sort_text end desc, f.id) rn from filtered f
    )
    select coalesce(max(s2.total_rows), 0)::integer, coalesce(jsonb_agg(jsonb_build_object('dispatch_id', s2.id, 'dispatch_number', s2.dispatch_number, 'order_id', s2.order_id,
        'order_number', s2.order_number, 'customer', private.ap3_customer_name(s2.customer_id), 'dispatched_at', s2.actual_dispatched_at, 'vehicle_number', s2.vehicle_number,
        'lr_number', s2.lr_number, 'transporter_name', s2.transporter_name, 'state', s2.st ->> 'state', 'expected_at', s2.st ->> 'expected_at',
        'overdue', (s2.st ->> 'overdue')::boolean, 'acceptance', s2.st -> 'acceptance' ->> 'outcome', 'last_update', s2.st -> 'last_update') order by s2.rn) filter (where s2.rn is not null), '[]'::jsonb),
      (select c from counted)
      into v_total, v_rows, v_counts
      from s2 where s2.rn > (v_page - 1) * 10 and s2.rn <= v_page * 10;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows, 'view', v_view, 'counts', coalesce(v_counts, '{}'::jsonb));
  end if;

  if p_command = 'get' then
    if v_p - array['dispatch_id'] <> '{}'::jsonb then raise exception 'Invalid delivery request' using errcode = '22023'; end if;
    v_id := private.olo_p7_uuid(v_p, 'dispatch_id', 'a dispatch');
    v_rows := private.olo_delivery_json(v_company, v_id, v_role);
    if v_rows is null then raise exception 'The dispatch is not available' using errcode = 'P0001'; end if;
    return v_rows;
  end if;

  if p_command = 'tracking.record' then
    if v_p - array['id','dispatch_id','kind','source','note','location','revised_eta'] <> '{}'::jsonb then raise exception 'Invalid tracking request' using errcode = '22023'; end if;
    if not (v_role = any(c_track)) then raise exception 'Your role cannot record shipment updates' using errcode = '42501'; end if;
    v_id := private.olo_p7_uuid(v_p, 'id', 'the update identity');
    v_kind := v_p ->> 'kind'; v_source := v_p ->> 'source';
    if v_kind is null or v_kind not in ('in_transit','delayed','delivery_attempted','eta_revised','delivered_reported') then raise exception 'Choose what the update reports' using errcode = '22023'; end if;
    if v_source is null or v_source not in ('transporter','driver','customer','staff') then raise exception 'Choose who reported the update' using errcode = '22023'; end if;
    v_note := private.olo_p7_text(v_p, 'note', 5, 500, 'The note');
    v_location := private.olo_p7_text(v_p, 'location', 2, 120, 'The location', false);
    if v_p ? 'revised_eta' and nullif(v_p ->> 'revised_eta', '') is not null then
      begin v_eta := (v_p ->> 'revised_eta')::timestamptz; exception when others then raise exception 'Enter a valid revised delivery time' using errcode = '22023'; end;
    end if;
    if v_kind = 'eta_revised' and v_eta is null then raise exception 'Enter the revised delivery time' using errcode = '22023'; end if;
    if v_eta is not null and v_kind not in ('eta_revised','delayed') then raise exception 'A revised delivery time is recorded with a delay or an ETA revision' using errcode = '22023'; end if;
    select * into v_up from public.dispatch_tracking_updates where id = v_id;
    if v_up.id is not null then
      if v_up.company_id <> v_company or v_up.dispatch_id::text <> coalesce(v_p ->> 'dispatch_id', '') or v_up.kind <> v_kind then
        raise exception 'This update identity was already used for a different update' using errcode = 'P0001';
      end if;
      return jsonb_build_object('replayed', true) || private.olo_delivery_json(v_company, v_up.dispatch_id, v_role);
    end if;
    select * into v_dispatch from public.dispatches where id = private.olo_p7_uuid(v_p, 'dispatch_id', 'a dispatch') and company_id = v_company for update;
    if v_dispatch.id is null then raise exception 'The dispatch is not available' using errcode = 'P0001'; end if;
    if v_dispatch.actual_dispatched_at is null or v_dispatch.delivery_status not in ('dispatched','in_transit','delayed') then
      raise exception 'Dispatch % is %; shipment updates are recorded while it is on the road', v_dispatch.dispatch_number, replace(v_dispatch.delivery_status, '_', ' ') using errcode = 'P0001';
    end if;
    if v_eta is not null and (v_eta < v_dispatch.actual_dispatched_at or v_eta > now() + interval '60 days') then
      raise exception 'The revised delivery time must be after the dispatch left and within 60 days' using errcode = '22023';
    end if;
    v_to := case when v_kind = 'in_transit' and v_dispatch.delivery_status in ('dispatched','delayed') then 'in_transit'
      when v_kind = 'delayed' and v_dispatch.delivery_status in ('dispatched','in_transit') then 'delayed' end;
    if v_to is not null and not (v_role = any(c_status)) then
      raise exception 'Sales records customer reports; dispatch records in-transit and delay updates that change the shipment status' using errcode = '42501';
    end if;
    if v_to is not null then
      -- No remarks are passed: the transition would replace the dispatch's own remarks; the update keeps the note.
      perform private.transition_dispatch_delivery_atomic(v_dispatch.id, v_to, null, null);
    end if;
    insert into public.dispatch_tracking_updates(id, company_id, dispatch_id, order_id, kind, source, location, revised_eta, note, status_changed_to, recorded_by)
      values (v_id, v_company, v_dispatch.id, v_dispatch.order_id, v_kind, v_source, v_location, v_eta, v_note, v_to, v_actor);
    perform private.olo_event(v_company, 'delivery.tracking', v_dispatch.order_id, null, 'dispatch',
      format('Dispatch %s: %s%s%s', v_dispatch.dispatch_number, replace(v_kind, '_', ' '), coalesce(' at ' || v_location, ''),
        coalesce(', expected ' || to_char(v_eta at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), '')),
      jsonb_build_object('dispatch_id', v_dispatch.id, 'update_id', v_id, 'source', v_source), 'tracking:' || v_id);
    if v_kind in ('delivery_attempted','delayed') then
      perform private.ap3_notify_roles(v_company, private.olo_uniq(private.olo_roles(v_company, 'dispatch', 0) || private.olo_roles(v_company, 'sales', 0)),
        'olo_delivery_' || v_kind, 'warning', format('%s: dispatch %s', case v_kind when 'delayed' then 'Delivery delayed' else 'Delivery attempted' end, v_dispatch.dispatch_number),
        format('Dispatch %s (%s): %s reported by the %s%s. %s', v_dispatch.dispatch_number, coalesce(v_dispatch.transporter_name, 'transporter'),
          case v_kind when 'delayed' then 'a delay' else 'a delivery attempt without delivery' end, v_source, coalesce(' at ' || v_location, ''), v_note),
        'dispatch', v_dispatch.id, '/dispatches/deliveries/' || v_dispatch.id, 'olo-track:' || v_id, v_actor);
    end if;
    perform private.olo_p7_refresh(v_company, v_dispatch.order_id);
    return jsonb_build_object('replayed', false) || private.olo_delivery_json(v_company, v_dispatch.id, v_role);
  end if;

  if p_command = 'receipt.record' then
    if v_p - array['id','dispatch_id','delivered_at','receiving_company','receiver_name','receiver_phone','received_bundles','received_kg','shortage_kg','damaged_kg',
        'acknowledgement','note','accept_all','correction_reason'] <> '{}'::jsonb then raise exception 'Invalid delivery receipt' using errcode = '22023'; end if;
    if not (v_role = any(c_receipt)) then raise exception 'Your role cannot record delivery receipts' using errcode = '42501'; end if;
    v_id := private.olo_p7_uuid(v_p, 'id', 'the receipt identity');
    select * into v_r from public.delivery_receipts where id = v_id;
    if v_r.id is not null then
      if v_r.company_id <> v_company or v_r.dispatch_id::text <> coalesce(v_p ->> 'dispatch_id', '') then
        raise exception 'This receipt identity was already used for another dispatch' using errcode = 'P0001';
      end if;
      return jsonb_build_object('replayed', true) || private.olo_delivery_json(v_company, v_r.dispatch_id, v_role);
    end if;
    select * into v_dispatch from public.dispatches where id = private.olo_p7_uuid(v_p, 'dispatch_id', 'a dispatch') and company_id = v_company for update;
    if v_dispatch.id is null then raise exception 'The dispatch is not available' using errcode = 'P0001'; end if;
    if v_dispatch.delivery_status <> 'delivered' then
      raise exception 'Dispatch % is %. Mark it delivered with its proof of delivery on the dispatch first; a delivery receipt confirms what the customer received.',
        v_dispatch.dispatch_number, replace(v_dispatch.delivery_status, '_', ' ') using errcode = 'P0001';
    end if;
    if nullif(btrim(coalesce(v_dispatch.proof_of_delivery_url, '')), '') is null then
      raise exception 'Upload the proof of delivery on dispatch % first', v_dispatch.dispatch_number using errcode = 'P0001';
    end if;
    begin v_at := (v_p ->> 'delivered_at')::timestamptz; exception when others then raise exception 'Enter when the material was delivered' using errcode = '22023'; end;
    if v_at is null or v_at < v_dispatch.actual_dispatched_at or v_at > clock_timestamp() + interval '10 minutes' then
      raise exception 'The delivery time must be after the dispatch left and not in the future' using errcode = '22023';
    end if;
    v_company_name := private.olo_p7_text(v_p, 'receiving_company', 2, 160, 'The receiving company');
    v_receiver := private.olo_p7_text(v_p, 'receiver_name', 2, 120, 'The receiver''s name');
    v_phone := private.olo_p7_text(v_p, 'receiver_phone', 8, 20, 'The receiver''s phone', false);
    if v_phone is not null and v_phone !~ '^[0-9+ -]{8,20}$' then raise exception 'Enter the receiver''s phone as digits' using errcode = '22023'; end if;
    v_m := private.olo_dispatch_manifest(v_company, v_dispatch.id);
    v_bundles := private.olo_p7_num(v_p, 'received_bundles', 0, (v_m ->> 'bundles')::numeric, 'Bundles received')::integer;
    if (v_p ->> 'received_bundles')::numeric <> v_bundles then raise exception 'Bundles received is a whole number' using errcode = '22023'; end if;
    v_kg := private.olo_p7_num(v_p, 'received_kg', 0, round((v_m ->> 'kg')::numeric * 1.02 + v_tol, 3), 'Kilograms received');
    v_short := coalesce(private.olo_p7_num(v_p, 'shortage_kg', 0, (v_m ->> 'kg')::numeric, 'Shortage', false), 0);
    v_dam := coalesce(private.olo_p7_num(v_p, 'damaged_kg', 0, (v_m ->> 'kg')::numeric, 'Damaged', false), 0);
    v_ack := v_p ->> 'acknowledgement';
    if v_ack is null or v_ack not in ('signed_challan','stamped_lr','signed_invoice','email','whatsapp','photo','phone_call') then
      raise exception 'Choose how the customer acknowledged the delivery' using errcode = '22023';
    end if;
    v_note := private.olo_p7_text(v_p, 'note', 2, 1000, 'The note', false);
    if v_p ? 'accept_all' and jsonb_typeof(v_p -> 'accept_all') is distinct from 'boolean' then raise exception 'Accept all is yes or no' using errcode = '22023'; end if;
    v_accept := coalesce((v_p ->> 'accept_all')::boolean, false);
    select * into v_prev from public.delivery_receipts where company_id = v_company and dispatch_id = v_dispatch.id and status = 'current' for update;
    v_reason := private.olo_p7_text(v_p, 'correction_reason', 10, 500, 'The correction reason', false);
    if v_prev.id is not null and v_reason is null then
      raise exception 'A delivery receipt is already recorded for %; write why it is corrected (at least 10 characters)', v_dispatch.dispatch_number using errcode = '22023';
    end if;
    if v_prev.id is null and v_reason is not null then raise exception 'There is no earlier receipt to correct' using errcode = '22023'; end if;
    if v_accept and (v_short + v_dam > v_tol or v_bundles < (v_m ->> 'bundles')::integer
        or (v_m ->> 'kg')::numeric - v_kg > greatest(v_tol, round((v_m ->> 'kg')::numeric * 0.005, 3))) then
      raise exception 'The receipt shows a shortage, damage or missing bundle; record each affected bundle instead of accepting all' using errcode = 'P0001';
    end if;
    if v_accept and exists (select 1 from public.delivery_dispositions x where x.company_id = v_company and x.dispatch_id = v_dispatch.id and x.reversed_at is null and x.disposition <> 'accepted') then
      raise exception 'Bundles of this dispatch already carry a shortage, damage or refusal; record the remaining bundles one by one' using errcode = 'P0001';
    end if;
    -- The engine evaluates once the new receipt (and any acceptance) is written, not between the two statements.
    perform set_config('olo.engine', 'running', true);
    perform set_config('olo.p7', 'on', true);
    if v_prev.id is not null then
      update public.delivery_receipts set status = 'superseded', superseded_at = clock_timestamp() where id = v_prev.id;
    end if;
    perform set_config('olo.p7', '', true);
    insert into public.delivery_receipts(id, company_id, dispatch_id, order_id, delivered_at, receiving_company, receiver_name, receiver_phone, dispatched_bundles, dispatched_kg,
        received_bundles, received_kg, shortage_kg, damaged_kg, acknowledgement, pod_path, note, accepted_all, supersedes_id, correction_reason, recorded_by)
      values (v_id, v_company, v_dispatch.id, v_dispatch.order_id, v_at, v_company_name, v_receiver, v_phone, (v_m ->> 'bundles')::integer, (v_m ->> 'kg')::numeric,
        v_bundles, v_kg, v_short, v_dam, v_ack, v_dispatch.proof_of_delivery_url, v_note, v_accept, v_prev.id, v_reason, v_actor)
      returning * into v_r;
    v_n := 0;
    if v_accept then
      -- Every bundle without a disposition is accepted by the named receiver, with the receipt as evidence.
      insert into public.delivery_dispositions(company_id, dispatch_id, packing_list_item_id, disposition, quantity_kg, receiver_name, evidence, owner_id, recorded_by)
        select v_company, v_dispatch.id, p.id, 'accepted', coalesce(p.net_weight_kg, p.gross_weight_kg - p.tare_weight_kg), v_receiver,
          left(format('Delivery receipt %s: accepted in full by %s (%s), acknowledged by %s', to_char(v_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'), v_receiver, v_company_name,
            replace(v_ack, '_', ' ')), 500), v_actor, v_actor
        from public.packing_list_items p where p.company_id = v_company and p.dispatch_id = v_dispatch.id and coalesce(p.net_weight_kg, p.gross_weight_kg - p.tare_weight_kg) > 0
          and not exists (select 1 from public.delivery_dispositions x where x.company_id = v_company and x.packing_list_item_id = p.id and x.reversed_at is null);
      get diagnostics v_n = row_count;
    end if;
    perform private.olo_event(v_company, 'delivery.receipt', v_dispatch.order_id, null, 'dispatch',
      format('Delivery receipt for %s: %s of %s bundle(s), %s received by %s (%s)%s%s', v_dispatch.dispatch_number, v_bundles, v_m ->> 'bundles', private.olo_fmt_kg(v_kg), v_receiver,
        v_company_name, case when v_short + v_dam > 0 then format('; %s short, %s damaged', private.olo_fmt_kg(v_short), private.olo_fmt_kg(v_dam)) else '' end,
        case when v_accept then '; accepted in full' when v_prev.id is not null then '; corrects the earlier receipt' else '' end),
      jsonb_build_object('dispatch_id', v_dispatch.id, 'receipt_id', v_id, 'accepted_bundles', v_n), 'receipt:' || v_id);
    perform set_config('olo.engine', '', true);
    perform private.olo_p7_refresh(v_company, v_dispatch.order_id);
    return jsonb_build_object('replayed', false, 'accepted_bundles', v_n) || private.olo_delivery_json(v_company, v_dispatch.id, v_role);
  end if;

  raise exception 'Unknown delivery command' using errcode = '22023';
end;
$$;

-- Customer complaints (directive section 28): formal workflow with affected bundles, containment, root cause, corrective
-- action, resolution, replacement and credit note, customer communication and closure by a second person.
create or replace function private.olo_complaint_event(p_complaint public.customer_complaints, p_action text, p_from text, p_note text, p_facts jsonb, p_actor uuid)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  insert into public.customer_complaint_events(company_id, complaint_id, action, from_status, to_status, note, facts, actor_id)
    values (p_complaint.company_id, p_complaint.id, p_action, p_from, p_complaint.status, left(p_note, 1000), coalesce(p_facts, '{}'::jsonb), p_actor);
  perform private.olo_event(p_complaint.company_id, 'complaint.' || p_action, p_complaint.order_id, null, private.olo_complaint_department(p_complaint.category),
    format('Complaint %s %s%s', p_complaint.complaint_number, replace(p_action, '_', ' '), coalesce(': ' || left(nullif(p_note, ''), 160), '')),
    jsonb_build_object('complaint_id', p_complaint.id, 'status', p_complaint.status), 'complaint:' || p_complaint.id || ':' || p_action || ':' || extract(epoch from clock_timestamp())::text);
end;
$$;

create or replace function private.olo_complaint_json(p_company uuid, p_complaint uuid, p_actor uuid, p_role text) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'complaint', jsonb_build_object('id', c.id, 'complaint_number', c.complaint_number, 'status', c.status, 'category', c.category, 'severity', c.severity,
      'description', c.description, 'customer_reference', c.customer_reference, 'reported_on', c.reported_on, 'suspected_kg', c.suspected_kg, 'evidence', c.evidence,
      'logged_by_name', lu.full_name, 'logged_at', c.logged_at, 'due_at', c.due_at, 'overdue', c.status in ('open','investigating','action') and c.due_at < clock_timestamp(),
      'containment_action', c.containment_action, 'containment_note', c.containment_note, 'containment_number', qc.containment_number, 'containment_id', c.containment_id,
      'investigated_by_name', iu.full_name, 'investigated_at', c.investigated_at, 'root_cause', c.root_cause, 'corrective_action', c.corrective_action,
      'preventive_action', c.preventive_action, 'responsible_department', c.responsible_department, 'cause_recorded_by_name', cu.full_name, 'cause_recorded_at', c.cause_recorded_at,
      'resolution', c.resolution, 'resolution_note', c.resolution_note, 'replacement_kg', c.replacement_kg, 'replacement_billing', c.replacement_billing,
      'replaced_kg', private.olo_complaint_replaced_kg(p_company, c.id), 'credit_note_number', cn.credit_note_number, 'credit_note_status', cn.status,
      'resolved_by_name', ru.full_name, 'resolved_at', c.resolved_at, 'closed_by_name', xu.full_name, 'closed_at', c.closed_at, 'closure_note', c.closure_note,
      'ncr_id', c.ncr_id, 'ncr_number', n.ncr_number, 'ncr_status', n.status),
    'customer', jsonb_build_object('id', c.customer_id, 'name', private.ap3_customer_name(c.customer_id)),
    'order', case when o.id is not null then jsonb_build_object('id', o.id, 'order_number', o.order_number, 'stage', o.current_stage) end,
    'dispatch', case when d.id is not null then jsonb_build_object('id', d.id, 'dispatch_number', d.dispatch_number, 'delivery_status', d.delivery_status, 'dispatched_at', d.actual_dispatched_at) end,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('packing_list_item_id', x.packing_list_item_id, 'bundle_number', x.bundle_number, 'dispatch_id', x.dispatch_id,
        'affected_kg', x.affected_kg) order by x.bundle_number), '[]'::jsonb) from public.customer_complaint_items x where x.complaint_id = c.id),
    'replacements', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'dispatch_id', r.dispatch_id, 'dispatch_number', rd.dispatch_number, 'delivery_status', rd.delivery_status,
        'dispatched_at', rd.actual_dispatched_at, 'kg', r.kg, 'linked_by_name', lb.full_name, 'linked_at', r.linked_at, 'withdrawn_at', r.withdrawn_at, 'withdraw_note', r.withdraw_note)
        order by r.linked_at), '[]'::jsonb)
      from public.customer_complaint_replacements r join public.dispatches rd on rd.id = r.dispatch_id left join public.app_users lb on lb.id = r.linked_by where r.complaint_id = c.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'from_status', e.from_status, 'to_status', e.to_status, 'note', e.note, 'facts', e.facts,
        'actor_name', eu.full_name, 'occurred_at', e.occurred_at) order by e.occurred_at desc), '[]'::jsonb)
      from public.customer_complaint_events e left join public.app_users eu on eu.id = e.actor_id where e.complaint_id = c.id),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.workflow_kind, 'status', t.status, 'title', t.title, 'department', t.workflow_department,
        'resolution', t.system_resolution) order by t.created_at), '[]'::jsonb)
      from public.tasks t where t.company_id = p_company and t.workflow_source_id = c.id and t.workflow_kind like 'complaint_%'),
    'close_blocker', case when c.status = 'resolved' then private.olo_complaint_ready_to_close(p_company, c.id) end,
    -- What the linking steps may choose from (no amounts: the complaint is read by every department).
    'replacement_candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', rd.id, 'dispatch_number', rd.dispatch_number, 'delivery_status', rd.delivery_status,
        'kg', (private.olo_dispatch_manifest(p_company, rd.id) ->> 'kg')::numeric,
        'invoiced', exists (select 1 from public.invoices ri where ri.company_id = p_company and ri.dispatch_id = rd.id and ri.deleted_at is null and ri.status not in ('draft','cancelled')))
        order by rd.created_at desc), '[]'::jsonb)
      from public.dispatches rd where rd.company_id = p_company and rd.order_id = c.order_id and rd.id is distinct from c.dispatch_id and rd.delivery_status <> 'returned'
        and not exists (select 1 from public.customer_complaint_replacements x where x.complaint_id = c.id and x.dispatch_id = rd.id and x.withdrawn_at is null)),
    'credit_note_candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', n2.id, 'credit_note_number', n2.credit_note_number, 'credit_date', n2.credit_date, 'invoice_number', i2.invoice_number)
        order by n2.credit_date desc), '[]'::jsonb)
      from public.credit_notes n2 join public.invoices i2 on i2.id = n2.invoice_id
      where n2.company_id = p_company and n2.status = 'issued' and i2.customer_id = c.customer_id and (c.order_id is null or i2.order_id = c.order_id)
        and not exists (select 1 from public.customer_complaints x where x.credit_note_id = n2.id and x.id <> c.id)),
    'containment_candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', q2.id, 'containment_number', q2.containment_number, 'defect', left(q2.defect, 120), 'status', q2.status)
        order by q2.opened_at desc), '[]'::jsonb)
      from public.quality_containments q2 where q2.company_id = p_company and q2.order_id = c.order_id and q2.status in ('open','partially_resolved','resolved')),
    'can', jsonb_build_object(
      'investigate', c.status in ('open','investigating') and p_role in ('owner','admin','quality','factory_manager','production_manager','dispatch_manager','sales_manager'),
      'root_cause', c.status in ('open','investigating') and p_role in ('owner','admin','quality','factory_manager','production_manager','dispatch_manager','sales_manager'),
      'resolve', c.status = 'action' and p_role in ('owner','admin','sales_manager','factory_manager','quality'),
      'link_replacement', c.status in ('action','resolved') and c.replacement_kg is not null
        and p_role in ('owner','admin','factory_manager','sales_manager','dispatch_manager','dispatch'),
      'link_credit_note', c.status in ('action','resolved') and p_role in ('owner','admin','accounts'),
      'communicate', c.status in ('open','investigating','action','resolved') and p_role in ('owner','admin','sales_manager','sales','quality','factory_manager','dispatch_manager'),
      'close', c.status = 'resolved' and p_role in ('owner','admin','factory_manager','quality') and (c.resolved_by is distinct from p_actor or p_role = 'owner'),
      'reject', c.status in ('open','investigating','action') and p_role in ('owner','admin','factory_manager') and (c.logged_by is distinct from p_actor or p_role = 'owner'),
      'withdraw', c.status in ('open','investigating','action','resolved') and p_role in ('owner','admin','sales_manager')))
  from public.customer_complaints c
  left join public.orders o on o.id = c.order_id left join public.dispatches d on d.id = c.dispatch_id
  left join public.quality_containments qc on qc.id = c.containment_id left join public.credit_notes cn on cn.id = c.credit_note_id
  left join public.quality_ncrs n on n.id = c.ncr_id
  left join public.app_users lu on lu.id = c.logged_by left join public.app_users iu on iu.id = c.investigated_by left join public.app_users cu on cu.id = c.cause_recorded_by
  left join public.app_users ru on ru.id = c.resolved_by left join public.app_users xu on xu.id = c.closed_by
  where c.id = p_complaint and c.company_id = p_company
$$;

create or replace function public.customer_complaint_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_p jsonb := coalesce(p_payload, '{}'::jsonb); a jsonb; v_company uuid; v_actor uuid; v_role text; v_page integer; v_search text; v_dir text; v_view text; v_sort text;
  v_total integer; v_rows jsonb; v_id uuid; c public.customer_complaints; v_from text; v_order public.orders; v_dispatch public.dispatches; v_customer uuid; v_item jsonb;
  v_line record; v_kg numeric; v_note text; v_text text; v_ncr uuid; v_cat text; v_sev text; v_date date; v_containment public.quality_containments; v_billing text;
  v_res text; v_cn public.credit_notes; v_m jsonb; v_tol numeric; v_cnt integer; v_category text; v_severity text; v_open_only boolean;
  c_log constant text[] := array['owner','admin','quality','factory_manager','production_manager','sales_manager','sales','dispatch_manager','dispatch'];
  c_investigate constant text[] := array['owner','admin','quality','factory_manager','production_manager','dispatch_manager','sales_manager'];
  c_resolve constant text[] := array['owner','admin','sales_manager','factory_manager','quality'];
  c_close constant text[] := array['owner','admin','factory_manager','quality'];
  c_comm constant text[] := array['owner','admin','sales_manager','sales','quality','factory_manager','dispatch_manager'];
  c_repl constant text[] := array['owner','admin','factory_manager','sales_manager','dispatch_manager','dispatch'];
  c_quality_cats constant text[] := array['quality','dimensional','surface_finish','wrong_material'];
begin
  if p_command is null or jsonb_typeof(v_p) is distinct from 'object' then raise exception 'Invalid complaint request' using errcode = '22023'; end if;
  a := private.olo_actor(private.olo_reader_roles());
  v_company := (a ->> 'company')::uuid; v_actor := (a ->> 'actor')::uuid; v_role := a ->> 'role';
  v_tol := (private.olo_settings_for(v_company)).reproduction_tolerance_kg;

  if p_command in ('list','board') then
    if v_p - array['view','category','severity','page','search','sort','direction'] <> '{}'::jsonb then raise exception 'Invalid complaint request' using errcode = '22023'; end if;
    v_page := private.olo_p7_page(v_p); v_search := private.olo_p7_search(v_p); v_dir := private.olo_p7_dir(v_p);
    v_view := coalesce(v_p ->> 'view', case when p_command = 'board' then 'open' else 'all' end); v_sort := coalesce(v_p ->> 'sort', 'logged_at');
    v_category := nullif(v_p ->> 'category', ''); v_severity := nullif(v_p ->> 'severity', '');
    if v_view not in ('all','open','overdue','open_complaints','investigating','action','resolved','closed','rejected','withdrawn')
       or v_sort not in ('logged_at','due_at','severity','complaint_number')
       or (v_category is not null and v_category not in ('quality','dimensional','surface_finish','wrong_material','quantity_shortage','transit_damage','documentation','delivery_delay','commercial'))
       or (v_severity is not null and v_severity not in ('low','medium','high','critical')) then
      raise exception 'Invalid complaint view' using errcode = '22023';
    end if;
    if p_command = 'board' then
      -- Overview: up to 10 complaints in each open status, most urgent first, with the counts.
      return jsonb_build_object('counts', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (select status, count(*) n from public.customer_complaints
          where company_id = v_company group by status) x),
        'overdue', (select count(*) from public.customer_complaints where company_id = v_company and status in ('open','investigating','action') and due_at < clock_timestamp()),
        'groups', (select coalesce(jsonb_object_agg(g.status, g.rows), '{}'::jsonb) from (
          select s.status, (select coalesce(jsonb_agg(jsonb_build_object('id', c2.id, 'complaint_number', c2.complaint_number, 'category', c2.category, 'severity', c2.severity,
              'customer', private.ap3_customer_name(c2.customer_id), 'order_number', o2.order_number, 'description', left(c2.description, 160), 'logged_at', c2.logged_at,
              'due_at', c2.due_at, 'overdue', c2.due_at < clock_timestamp() and c2.status <> 'resolved') order by c2.rk), '[]'::jsonb)
            from (select x.*, row_number() over (order by case x.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, x.due_at, x.id) rk
              from public.customer_complaints x where x.company_id = v_company and x.status = s.status) c2
            left join public.orders o2 on o2.id = c2.order_id where c2.rk <= 10) rows
          from unnest(array['open','investigating','action','resolved']) s(status)) g));
    end if;
    with f as (
      select x.*, o.order_number, d.dispatch_number, private.ap3_customer_name(x.customer_id) customer, count(*) over () total_rows,
        case v_sort when 'logged_at' then extract(epoch from x.logged_at) when 'due_at' then extract(epoch from x.due_at)
          when 'severity' then case x.severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end end sort_num,
        case when v_sort = 'complaint_number' then x.complaint_number end sort_text
      from public.customer_complaints x left join public.orders o on o.id = x.order_id left join public.dispatches d on d.id = x.dispatch_id
      where x.company_id = v_company
        and case v_view when 'all' then true when 'open' then x.status = any(private.olo_open_complaint_statuses())
          when 'overdue' then x.status in ('open','investigating','action') and x.due_at < clock_timestamp()
          when 'open_complaints' then x.status = 'open' else x.status = v_view end
        and (v_category is null or x.category = v_category) and (v_severity is null or x.severity = v_severity)
        and (v_search = '' or position(v_search in lower(concat_ws(' ', x.complaint_number, x.description, x.customer_reference, o.order_number, d.dispatch_number,
          private.ap3_customer_name(x.customer_id)))) > 0)
    ), s2 as (
      select f.*, row_number() over (order by case when v_dir = 'asc' then f.sort_num end asc nulls last, case when v_dir = 'desc' then f.sort_num end desc nulls last,
        case when v_dir = 'asc' then f.sort_text end asc, case when v_dir = 'desc' then f.sort_text end desc, f.id) rn from f
    )
    select coalesce(max(s2.total_rows), 0)::integer, coalesce(jsonb_agg(jsonb_build_object('id', s2.id, 'complaint_number', s2.complaint_number, 'status', s2.status,
        'category', s2.category, 'severity', s2.severity, 'customer', s2.customer, 'order_id', s2.order_id, 'order_number', s2.order_number, 'dispatch_number', s2.dispatch_number,
        'description', left(s2.description, 160), 'logged_at', s2.logged_at, 'due_at', s2.due_at,
        'overdue', s2.status in ('open','investigating','action') and s2.due_at < clock_timestamp()) order by s2.rn), '[]'::jsonb)
      into v_total, v_rows from s2 where s2.rn > (v_page - 1) * 10 and s2.rn <= v_page * 10;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', v_total, 'rows', v_rows, 'view', v_view,
      'can_log', v_role = any(c_log));
  end if;

  if p_command = 'get' then
    if v_p - array['complaint_id'] <> '{}'::jsonb then raise exception 'Invalid complaint request' using errcode = '22023'; end if;
    v_rows := private.olo_complaint_json(v_company, private.olo_p7_uuid(v_p, 'complaint_id', 'a complaint'), v_actor, v_role);
    if v_rows is null then raise exception 'The complaint is not available' using errcode = 'P0001'; end if;
    return v_rows;
  end if;

  -- Orders (search) and, for one order, its dispatches and bundles to pick from.
  if p_command = 'candidates' then
    if v_p - array['search','order_id'] <> '{}'::jsonb then raise exception 'Invalid complaint request' using errcode = '22023'; end if;
    v_search := private.olo_p7_search(v_p);
    v_id := private.olo_p7_uuid(v_p, 'order_id', 'an order', false);
    if v_id is null then
      return jsonb_build_object('orders', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'order_number', x.order_number, 'customer', x.customer, 'stage', x.current_stage)
          order by x.last_at desc nulls last), '[]'::jsonb)
        from (select o.id, o.order_number, o.current_stage, private.ap3_customer_name(o.customer_id) customer,
            (select max(d.actual_dispatched_at) from public.dispatches d where d.company_id = v_company and d.order_id = o.id) last_at
          from public.orders o where o.company_id = v_company and o.deleted_at is null and o.current_stage <> 'cancelled'
            and exists (select 1 from public.dispatches d where d.company_id = v_company and d.order_id = o.id and d.actual_dispatched_at is not null)
            and (v_search = '' or position(v_search in lower(concat_ws(' ', o.order_number, private.ap3_customer_name(o.customer_id)))) > 0)
          order by last_at desc nulls last limit 15) x));
    end if;
    select * into v_order from public.orders where id = v_id and company_id = v_company and deleted_at is null;
    if v_order.id is null then raise exception 'The order is not available' using errcode = 'P0001'; end if;
    return jsonb_build_object('order', jsonb_build_object('id', v_order.id, 'order_number', v_order.order_number, 'customer_id', v_order.customer_id,
        'customer', private.ap3_customer_name(v_order.customer_id)),
      'dispatches', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'dispatch_number', d.dispatch_number, 'delivery_status', d.delivery_status,
          'dispatched_at', d.actual_dispatched_at,
          'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'bundle_number', p.bundle_number, 'pieces', p.number_of_pieces,
              'net_kg', coalesce(p.net_weight_kg, p.gross_weight_kg - p.tare_weight_kg)) order by p.bundle_number), '[]'::jsonb)
            from public.packing_list_items p where p.company_id = v_company and p.dispatch_id = d.id)) order by d.actual_dispatched_at desc), '[]'::jsonb)
        from public.dispatches d where d.company_id = v_company and d.order_id = v_order.id and d.actual_dispatched_at is not null));
  end if;

  if p_command = 'log' then
    if v_p - array['id','order_id','dispatch_id','category','severity','description','customer_reference','reported_on','suspected_kg','evidence','items'] <> '{}'::jsonb then
      raise exception 'Invalid complaint' using errcode = '22023';
    end if;
    if not (v_role = any(c_log)) then raise exception 'Your role cannot log customer complaints' using errcode = '42501'; end if;
    v_id := private.olo_p7_uuid(v_p, 'id', 'the complaint identity');
    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':complaint:' || v_id::text, 0));
    select * into c from public.customer_complaints where id = v_id;
    if c.id is not null then
      if c.company_id <> v_company or c.logged_by <> v_actor or c.fingerprint <> md5((v_p - 'id')::text) then
        raise exception 'This complaint identity was already used with different details' using errcode = 'P0001';
      end if;
      return jsonb_build_object('replayed', true) || private.olo_complaint_json(v_company, c.id, v_actor, v_role);
    end if;
    select * into v_order from public.orders where id = private.olo_p7_uuid(v_p, 'order_id', 'the order') and company_id = v_company and deleted_at is null;
    if v_order.id is null then raise exception 'The order is not available' using errcode = 'P0001'; end if;
    if v_p ? 'dispatch_id' and nullif(v_p ->> 'dispatch_id', '') is not null then
      select * into v_dispatch from public.dispatches where id = private.olo_p7_uuid(v_p, 'dispatch_id', 'the dispatch') and company_id = v_company;
      if v_dispatch.id is null or v_dispatch.order_id <> v_order.id then raise exception 'That dispatch is not part of order %', v_order.order_number using errcode = 'P0001'; end if;
      if v_dispatch.actual_dispatched_at is null then raise exception 'Dispatch % has not left the factory', v_dispatch.dispatch_number using errcode = 'P0001'; end if;
    end if;
    v_cat := v_p ->> 'category'; v_sev := v_p ->> 'severity';
    if v_cat is null or v_cat not in ('quality','dimensional','surface_finish','wrong_material','quantity_shortage','transit_damage','documentation','delivery_delay','commercial') then
      raise exception 'Choose the complaint category' using errcode = '22023';
    end if;
    if v_sev is null or v_sev not in ('low','medium','high','critical') then raise exception 'Choose the severity' using errcode = '22023'; end if;
    v_text := private.olo_p7_text(v_p, 'description', 10, 1000, 'The reported defect');
    if v_p ? 'reported_on' and nullif(v_p ->> 'reported_on', '') is not null then
      begin v_date := (v_p ->> 'reported_on')::date; exception when others then raise exception 'Enter the date the customer reported it' using errcode = '22023'; end;
      if v_date > private.ist_today() or v_date < v_order.order_date then raise exception 'The report date must be between the order date and today' using errcode = '22023'; end if;
    end if;
    v_kg := private.olo_p7_num(v_p, 'suspected_kg', 0.001, 10000000, 'The suspected quantity', false);
    if v_p ? 'items' and jsonb_typeof(v_p -> 'items') is distinct from 'array' then raise exception 'Invalid affected bundles' using errcode = '22023'; end if;
    if jsonb_array_length(coalesce(v_p -> 'items', '[]'::jsonb)) > 60 then raise exception 'Name at most 60 affected bundles' using errcode = '22023'; end if;
    perform set_config('olo.complaint_log', 'on', true);
    insert into public.customer_complaints(id, company_id, customer_id, order_id, dispatch_id, description, logged_by, fingerprint, category, severity, reported_on,
        customer_reference, suspected_kg, evidence, due_at)
      values (v_id, v_company, v_order.customer_id, v_order.id, v_dispatch.id, v_text, v_actor, md5((v_p - 'id')::text), v_cat, v_sev,
        coalesce(v_date, private.ist_today()), private.olo_p7_text(v_p, 'customer_reference', 2, 120, 'The customer reference', false), v_kg,
        private.olo_p7_text(v_p, 'evidence', 5, 1000, 'The evidence', false), private.olo_complaint_due(clock_timestamp(), v_sev))
      returning * into c;
    perform set_config('olo.complaint_log', '', true);
    for v_item in select * from jsonb_array_elements(coalesce(v_p -> 'items', '[]'::jsonb)) loop
      if jsonb_typeof(v_item) <> 'object' or v_item - array['packing_list_item_id','affected_kg'] <> '{}'::jsonb then raise exception 'Invalid affected bundle' using errcode = '22023'; end if;
      select p.id, p.dispatch_id, p.bundle_number, coalesce(p.net_weight_kg, p.gross_weight_kg - p.tare_weight_kg) net, d.order_id, d.actual_dispatched_at into v_line
        from public.packing_list_items p join public.dispatches d on d.id = p.dispatch_id and d.company_id = p.company_id
        where p.id = private.olo_p7_uuid(v_item, 'packing_list_item_id', 'an affected bundle') and p.company_id = v_company;
      if v_line.id is null or v_line.order_id <> v_order.id or v_line.actual_dispatched_at is null then
        raise exception 'An affected bundle is not a dispatched bundle of order %', v_order.order_number using errcode = 'P0001';
      end if;
      if v_dispatch.id is not null and v_line.dispatch_id <> v_dispatch.id then raise exception 'Bundle % is not on dispatch %', v_line.bundle_number, v_dispatch.dispatch_number using errcode = 'P0001'; end if;
      v_kg := coalesce(private.olo_p7_num(v_item, 'affected_kg', 0.001, v_line.net + v_tol, 'The affected kilograms of bundle ' || v_line.bundle_number, false), v_line.net);
      begin
        insert into public.customer_complaint_items(company_id, complaint_id, dispatch_id, packing_list_item_id, bundle_number, affected_kg)
          values (v_company, c.id, v_line.dispatch_id, v_line.id, v_line.bundle_number, v_kg);
      exception when unique_violation then raise exception 'Bundle % appears twice', v_line.bundle_number using errcode = '22023';
      end;
    end loop;
    -- Quality complaints draft an NCR for QA, as AP-053 does.
    if v_cat = any(c_quality_cats) then
      insert into public.quality_ncrs(company_id, ncr_number, source_kind, source_id, complaint_id, customer_id, order_id, title, description, evidence, created_by)
        values (v_company, private.ap6_ncr_number(v_company), 'complaint', c.id, c.id, c.customer_id, c.order_id, 'Customer complaint ' || c.complaint_number,
          c.description, jsonb_build_object('dispatch_id', c.dispatch_id, 'complaint_number', c.complaint_number,
            'bundles', (select coalesce(jsonb_agg(x.bundle_number order by x.bundle_number), '[]'::jsonb) from public.customer_complaint_items x where x.complaint_id = c.id),
            'jobs', coalesce((select jsonb_agg(jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'die_id', j.die_id)) from public.production_jobs j
              where j.company_id = v_company and j.order_id = c.order_id), '[]'::jsonb)), v_actor)
        returning id into v_ncr;
      perform set_config('olo.complaint', 'on', true);
      update public.customer_complaints set ncr_id = v_ncr where id = c.id returning * into c;
      perform set_config('olo.complaint', '', true);
    end if;
    perform private.olo_complaint_event(c, 'logged', null, c.description, jsonb_build_object('category', v_cat, 'severity', v_sev,
      'bundles', (select count(*) from public.customer_complaint_items x where x.complaint_id = c.id)), v_actor);
    perform private.olo_p7_refresh(v_company, c.order_id);
    return jsonb_build_object('replayed', false) || private.olo_complaint_json(v_company, c.id, v_actor, v_role);
  end if;

  -- Every later step locks the complaint first.
  if p_command not in ('investigate','root_cause','resolve','link_replacement','unlink_replacement','link_credit_note','communicate','close','reject','withdraw') then
    raise exception 'Unknown complaint command' using errcode = '22023';
  end if;
  v_id := private.olo_p7_uuid(v_p, 'complaint_id', 'a complaint');
  select * into c from public.customer_complaints where id = v_id and company_id = v_company for update;
  if c.id is null then raise exception 'The complaint is not available' using errcode = 'P0001'; end if;
  v_from := c.status;

  if p_command = 'investigate' then
    if v_p - array['complaint_id','containment_action','containment_note','containment_id'] <> '{}'::jsonb then raise exception 'Invalid complaint request' using errcode = '22023'; end if;
    if not (v_role = any(c_investigate)) then raise exception 'Your role cannot investigate complaints' using errcode = '42501'; end if;
    if c.status not in ('open','investigating') then raise exception 'Complaint % is %', c.complaint_number, c.status using errcode = 'P0001'; end if;
    v_text := v_p ->> 'containment_action';
    if v_text is null or v_text not in ('not_required','stock_held','qc_containment','customer_stock_held','recall') then raise exception 'Choose the containment decision' using errcode = '22023'; end if;
    v_note := private.olo_p7_text(v_p, 'containment_note', 5, 1000, 'The containment note');
    if v_text = 'qc_containment' then
      select * into v_containment from public.quality_containments where id = private.olo_p7_uuid(v_p, 'containment_id', 'the QC containment') and company_id = v_company;
      if v_containment.id is null or v_containment.order_id is distinct from c.order_id then
        raise exception 'Choose a QC containment opened for order of this complaint (open it on the containment screen first)' using errcode = 'P0001';
      end if;
    elsif v_p ? 'containment_id' and nullif(v_p ->> 'containment_id', '') is not null then
      raise exception 'A QC containment is linked only with the QC containment decision' using errcode = '22023';
    end if;
    perform set_config('olo.complaint', 'on', true);
    update public.customer_complaints set status = 'investigating', containment_action = v_text, containment_note = v_note, containment_id = v_containment.id,
      investigated_by = v_actor, investigated_at = clock_timestamp(), updated_at = clock_timestamp() where id = c.id returning * into c;
    perform set_config('olo.complaint', '', true);
    perform private.olo_complaint_event(c, 'investigated', v_from, v_note, jsonb_build_object('containment_action', v_text, 'containment', v_containment.containment_number), v_actor);

  elsif p_command = 'root_cause' then
    if v_p - array['complaint_id','root_cause','corrective_action','preventive_action','responsible_department'] <> '{}'::jsonb then raise exception 'Invalid complaint request' using errcode = '22023'; end if;
    if not (v_role = any(c_investigate)) then raise exception 'Your role cannot record the root cause' using errcode = '42501'; end if;
    if c.status <> 'investigating' then
      raise exception '%', case when c.status = 'open' then 'Record the containment decision first' else format('Complaint %s is %s', c.complaint_number, c.status) end using errcode = 'P0001';
    end if;
    v_text := v_p ->> 'responsible_department';
    if v_text is null or not (v_text = any(private.olo_departments())) then raise exception 'Choose the responsible department' using errcode = '22023'; end if;
    perform set_config('olo.complaint', 'on', true);
    update public.customer_complaints set status = 'action', root_cause = private.olo_p7_text(v_p, 'root_cause', 10, 1000, 'The root cause'),
      corrective_action = private.olo_p7_text(v_p, 'corrective_action', 10, 1000, 'The corrective action'),
      preventive_action = private.olo_p7_text(v_p, 'preventive_action', 10, 1000, 'The preventive action', false), responsible_department = v_text,
      cause_recorded_by = v_actor, cause_recorded_at = clock_timestamp(), updated_at = clock_timestamp() where id = c.id returning * into c;
    perform set_config('olo.complaint', '', true);
    perform private.olo_complaint_event(c, 'cause_recorded', v_from, c.root_cause, jsonb_build_object('corrective_action', left(c.corrective_action, 300), 'department', v_text), v_actor);

  elsif p_command = 'resolve' then
    if v_p - array['complaint_id','resolution','resolution_note','replacement_kg','replacement_billing'] <> '{}'::jsonb then raise exception 'Invalid complaint request' using errcode = '22023'; end if;
    if not (v_role = any(c_resolve)) then raise exception 'Your role cannot resolve complaints' using errcode = '42501'; end if;
    if c.status <> 'action' then raise exception 'Record the root cause and corrective action of complaint % first', c.complaint_number using errcode = 'P0001'; end if;
    v_res := v_p ->> 'resolution';
    if v_res is null or v_res not in ('replacement','credit_note','rework_at_site','return_for_rework','commercial_settlement','no_fault_found') then
      raise exception 'Choose the resolution' using errcode = '22023';
    end if;
    v_note := private.olo_p7_text(v_p, 'resolution_note', 10, 1000, 'What was agreed and communicated to the customer');
    if v_res = 'replacement' then
      v_kg := private.olo_p7_num(v_p, 'replacement_kg', 0.001, 10000000, 'The replacement quantity');
      v_billing := v_p ->> 'replacement_billing';
      if v_billing is null or v_billing not in ('free_of_charge','chargeable') then raise exception 'Choose whether the replacement is free of charge or chargeable' using errcode = '22023'; end if;
    elsif v_p ? 'replacement_kg' or v_p ? 'replacement_billing' then
      raise exception 'Replacement quantity and billing go with a replacement resolution' using errcode = '22023';
    end if;
    perform set_config('olo.complaint', 'on', true);
    update public.customer_complaints set status = 'resolved', resolution = v_res, resolution_note = v_note, replacement_kg = v_kg, replacement_billing = v_billing,
      resolved_by = v_actor, resolved_at = clock_timestamp(), updated_at = clock_timestamp() where id = c.id returning * into c;
    perform set_config('olo.complaint', '', true);
    perform private.olo_complaint_event(c, 'resolved', v_from, v_note, jsonb_build_object('resolution', v_res, 'replacement_kg', v_kg, 'billing', v_billing), v_actor);

  elsif p_command in ('link_replacement','unlink_replacement') then
    if v_p - array['complaint_id','id','dispatch_id','kg','note'] <> '{}'::jsonb then raise exception 'Invalid replacement request' using errcode = '22023'; end if;
    if not (v_role = any(c_repl)) then raise exception 'Your role cannot link replacement dispatches' using errcode = '42501'; end if;
    if c.status not in ('action','resolved') or c.replacement_kg is null then raise exception 'Complaint % has no agreed replacement', c.complaint_number using errcode = 'P0001'; end if;
    if p_command = 'unlink_replacement' then
      v_note := private.olo_p7_text(v_p, 'note', 10, 500, 'Why the replacement link is withdrawn');
      perform set_config('olo.p7', 'on', true);
      update public.customer_complaint_replacements set withdrawn_by = v_actor, withdrawn_at = clock_timestamp(), withdraw_note = v_note
        where id = private.olo_p7_uuid(v_p, 'id', 'the replacement link') and complaint_id = c.id and withdrawn_at is null;
      get diagnostics v_cnt = row_count;
      perform set_config('olo.p7', '', true);
      if v_cnt = 0 then raise exception 'That replacement link is not active' using errcode = 'P0001'; end if;
      perform private.olo_complaint_event(c, 'replacement_withdrawn', v_from, v_note, '{}'::jsonb, v_actor);
    else
      select * into v_dispatch from public.dispatches where id = private.olo_p7_uuid(v_p, 'dispatch_id', 'the replacement dispatch') and company_id = v_company for update;
      if v_dispatch.id is null or v_dispatch.order_id is distinct from c.order_id then
        raise exception 'The replacement must go on a dispatch of the complaint''s order, so it is linked to the original order and claim' using errcode = 'P0001';
      end if;
      if v_dispatch.id = c.dispatch_id then raise exception 'The complained dispatch cannot be its own replacement' using errcode = 'P0001'; end if;
      if v_dispatch.delivery_status = 'returned' then raise exception 'Dispatch % was returned', v_dispatch.dispatch_number using errcode = 'P0001'; end if;
      v_m := private.olo_dispatch_manifest(v_company, v_dispatch.id);
      if (v_m ->> 'kg')::numeric <= 0 then raise exception 'Dispatch % has no packed bundles yet', v_dispatch.dispatch_number using errcode = 'P0001'; end if;
      v_kg := coalesce(private.olo_p7_num(v_p, 'kg', 0.001, (v_m ->> 'kg')::numeric, 'The replacement kilograms on the dispatch', false), (v_m ->> 'kg')::numeric);
      if v_kg > (v_m ->> 'kg')::numeric - coalesce((select sum(x.kg) from public.customer_complaint_replacements x where x.dispatch_id = v_dispatch.id and x.withdrawn_at is null), 0) + v_tol then
        raise exception 'Dispatch % does not have that much material left that is not already a replacement', v_dispatch.dispatch_number using errcode = 'P0001';
      end if;
      if c.replacement_billing = 'free_of_charge' then
        -- A free replacement travels on its own dispatch, so the dispatch needs no invoice at all.
        if abs(v_kg - (v_m ->> 'kg')::numeric) > v_tol then
          raise exception 'A free-of-charge replacement goes on its own dispatch: link the whole dispatch (%)', private.olo_fmt_kg((v_m ->> 'kg')::numeric) using errcode = 'P0001';
        end if;
        if exists (select 1 from public.invoices i where i.company_id = v_company and i.dispatch_id = v_dispatch.id and i.deleted_at is null and i.status not in ('draft','cancelled')) then
          raise exception 'Dispatch % is already invoiced; a free replacement must not be billed', v_dispatch.dispatch_number using errcode = 'P0001';
        end if;
      end if;
      begin
        insert into public.customer_complaint_replacements(id, company_id, complaint_id, dispatch_id, kg, linked_by)
          values (private.olo_p7_uuid(v_p, 'id', 'the link identity'), v_company, c.id, v_dispatch.id, v_kg, v_actor);
      exception when unique_violation then raise exception 'Dispatch % is already linked to this complaint', v_dispatch.dispatch_number using errcode = 'P0001';
      end;
      perform private.olo_complaint_event(c, 'replacement_linked', v_from, null, jsonb_build_object('dispatch', v_dispatch.dispatch_number, 'kg', v_kg), v_actor);
    end if;

  elsif p_command = 'link_credit_note' then
    if v_p - array['complaint_id','credit_note_id'] <> '{}'::jsonb then raise exception 'Invalid complaint request' using errcode = '22023'; end if;
    if v_role not in ('owner','admin','accounts') then raise exception 'Accounts link credit notes' using errcode = '42501'; end if;
    if c.status not in ('action','resolved') then raise exception 'Complaint % is %', c.complaint_number, c.status using errcode = 'P0001'; end if;
    select n.* into v_cn from public.credit_notes n join public.invoices i on i.id = n.invoice_id
      where n.id = private.olo_p7_uuid(v_p, 'credit_note_id', 'the credit note') and n.company_id = v_company and i.customer_id = c.customer_id
        and (c.order_id is null or i.order_id = c.order_id);
    if v_cn.id is null then raise exception 'Choose an issued credit note of this customer''s order' using errcode = 'P0001'; end if;
    if v_cn.status <> 'issued' then raise exception 'Credit note % is %', v_cn.credit_note_number, v_cn.status using errcode = 'P0001'; end if;
    if exists (select 1 from public.customer_complaints x where x.credit_note_id = v_cn.id and x.id <> c.id) then
      raise exception 'Credit note % is already linked to another complaint', v_cn.credit_note_number using errcode = 'P0001';
    end if;
    perform set_config('olo.complaint', 'on', true);
    update public.customer_complaints set credit_note_id = v_cn.id, updated_at = clock_timestamp() where id = c.id returning * into c;
    perform set_config('olo.complaint', '', true);
    perform private.olo_complaint_event(c, 'credit_note_linked', v_from, null, jsonb_build_object('credit_note', v_cn.credit_note_number), v_actor);

  elsif p_command = 'communicate' then
    if v_p - array['complaint_id','channel','summary'] <> '{}'::jsonb then raise exception 'Invalid complaint request' using errcode = '22023'; end if;
    if not (v_role = any(c_comm)) then raise exception 'Your role cannot record customer communication' using errcode = '42501'; end if;
    if c.status not in ('open','investigating','action','resolved') then raise exception 'Complaint % is %', c.complaint_number, c.status using errcode = 'P0001'; end if;
    v_text := v_p ->> 'channel';
    if v_text is null or v_text not in ('phone','whatsapp','email','visit','letter') then raise exception 'Choose how the customer was contacted' using errcode = '22023'; end if;
    v_note := private.olo_p7_text(v_p, 'summary', 10, 1000, 'What was communicated');
    perform private.olo_complaint_event(c, 'communicated', v_from, v_note, jsonb_build_object('channel', v_text), v_actor);

  elsif p_command = 'close' then
    if v_p - array['complaint_id','note'] <> '{}'::jsonb then raise exception 'Invalid complaint request' using errcode = '22023'; end if;
    if not (v_role = any(c_close)) then raise exception 'The factory manager, QA, an admin or the owner closes complaints' using errcode = '42501'; end if;
    if c.status <> 'resolved' then raise exception 'Complaint % is %; resolve it first', c.complaint_number, c.status using errcode = 'P0001'; end if;
    if c.resolved_by = v_actor and v_role <> 'owner' then raise exception 'You recorded the resolution; another person verifies and closes the complaint' using errcode = '42501'; end if;
    v_text := private.olo_complaint_ready_to_close(v_company, c.id);
    if v_text is not null then raise exception '%', v_text using errcode = 'P0001'; end if;
    v_note := private.olo_p7_text(v_p, 'note', 10, 1000, 'The verification of the corrective action and customer acceptance');
    perform set_config('olo.complaint', 'on', true);
    update public.customer_complaints set status = 'closed', closed_by = v_actor, closed_at = clock_timestamp(), closure_note = v_note, updated_at = clock_timestamp()
      where id = c.id returning * into c;
    perform set_config('olo.complaint', '', true);
    perform private.olo_complaint_event(c, 'closed', v_from, v_note, '{}'::jsonb, v_actor);

  else
    -- reject (not valid, factory management) or withdraw (customer withdrew, sales management).
    if v_p - array['complaint_id','note'] <> '{}'::jsonb then raise exception 'Invalid complaint request' using errcode = '22023'; end if;
    if p_command = 'reject' then
      if v_role not in ('owner','admin','factory_manager') then raise exception 'The factory manager, an admin or the owner rejects a complaint' using errcode = '42501'; end if;
      if c.status not in ('open','investigating','action') then raise exception 'Complaint % is %', c.complaint_number, c.status using errcode = 'P0001'; end if;
      if c.logged_by = v_actor and v_role <> 'owner' then raise exception 'You logged this complaint; another person decides that it is not valid' using errcode = '42501'; end if;
    else
      if v_role not in ('owner','admin','sales_manager') then raise exception 'The sales manager, an admin or the owner records a withdrawn complaint' using errcode = '42501'; end if;
      if c.status not in ('open','investigating','action','resolved') then raise exception 'Complaint % is %', c.complaint_number, c.status using errcode = 'P0001'; end if;
    end if;
    v_note := private.olo_p7_text(v_p, 'note', 10, 1000, case when p_command = 'reject' then 'Why the complaint is not valid, and what the customer was told' else 'How the customer withdrew the complaint' end);
    perform set_config('olo.complaint', 'on', true);
    update public.customer_complaints set status = case when p_command = 'reject' then 'rejected' else 'withdrawn' end, closed_by = v_actor, closed_at = clock_timestamp(),
      closure_note = v_note, updated_at = clock_timestamp() where id = c.id returning * into c;
    perform set_config('olo.complaint', '', true);
    perform private.olo_complaint_event(c, case when p_command = 'reject' then 'rejected' else 'withdrawn' end, v_from, v_note, '{}'::jsonb, v_actor);
  end if;
  perform private.olo_p7_refresh(v_company, c.order_id);
  return private.olo_complaint_json(v_company, c.id, v_actor, v_role);
end;
$$;

-- Payment follow-up (directive section 29), finance only: invoices due and unsettled, their payments, credit notes,
-- payment promise, disputes and write-offs.
create or replace function private.olo_receivable_json(p_company uuid, p_invoice uuid, p_actor uuid, p_role text) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'invoice', jsonb_build_object('id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date, 'due_date', i.due_date, 'status', i.status,
      'grand_total', i.grand_total, 'amount_paid', i.amount_paid, 'credited_amount', i.credited_amount, 'balance_due', i.balance_due,
      'days_overdue', greatest(private.ist_today() - coalesce(i.due_date, i.invoice_date), 0)),
    'collectible', private.olo_invoice_collectible(p_company, i.id),
    'customer', jsonb_build_object('id', i.customer_id, 'name', private.ap3_customer_name(i.customer_id)),
    'order', case when o.id is not null then jsonb_build_object('id', o.id, 'order_number', o.order_number, 'stage', o.current_stage) end,
    'dispatch', case when d.id is not null then jsonb_build_object('id', d.id, 'dispatch_number', d.dispatch_number, 'delivery_status', d.delivery_status,
      'delivered_at', d.delivered_at, 'shipment_state', private.olo_shipment_state(p_company, d.id) ->> 'state') end,
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'payment_date', p.payment_date, 'amount', p.amount, 'method', p.payment_method,
        'reference', p.reference_number, 'reversed', p.reversed_at is not null) order by p.payment_date, p.created_at), '[]'::jsonb)
      from public.payments p where p.company_id = p_company and p.invoice_id = i.id),
    'credit_notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'credit_note_number', n.credit_note_number, 'credit_date', n.credit_date, 'grand_total', n.grand_total,
        'status', n.status, 'reason', n.reason) order by n.credit_date), '[]'::jsonb) from public.credit_notes n where n.company_id = p_company and n.invoice_id = i.id),
    'promise', (select jsonb_build_object('due_date', cp.due_date, 'amount', cp.amount, 'disputed_amount', cp.disputed_amount, 'employee', pu.full_name)
      from public.collection_promises cp left join public.app_users pu on pu.id = cp.employee_id
      where cp.company_id = p_company and cp.invoice_id = i.id and cp.withdrawn_at is null limit 1),
    'exceptions', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'status', e.status, 'amount', e.amount, 'reason_category', e.reason_category,
        'reason', e.reason, 'customer_reference', e.customer_reference, 'complaint_number', cc.complaint_number, 'raised_by_name', ru.full_name, 'raised_at', e.raised_at,
        'first_approved_by_name', fu.full_name, 'outcome', e.outcome, 'decided_by_name', du.full_name, 'decided_at', e.decided_at, 'decision_note', e.decision_note,
        'can_decide', e.kind = 'write_off' and e.status = 'proposed' and p_role in ('owner','admin','accounts') and (e.raised_by <> p_actor or p_role = 'owner')
          and e.first_approved_by is distinct from p_actor,
        'can_resolve', e.kind = 'dispute' and e.status = 'open',
        'can_withdraw', e.status in ('open','proposed') and (e.raised_by = p_actor or p_role in ('owner','admin'))) order by e.raised_at desc), '[]'::jsonb)
      from public.receivable_exceptions e left join public.customer_complaints cc on cc.id = e.complaint_id left join public.app_users ru on ru.id = e.raised_by
      left join public.app_users fu on fu.id = e.first_approved_by left join public.app_users du on du.id = e.decided_by
      where e.company_id = p_company and e.invoice_id = i.id),
    'complaints', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'complaint_number', c.complaint_number, 'status', c.status, 'category', c.category) order by c.logged_at desc), '[]'::jsonb)
      from public.customer_complaints c where c.company_id = p_company and c.customer_id = i.customer_id and (c.order_id = i.order_id or i.order_id is null)
        and c.status not in ('rejected','withdrawn')),
    'task', (select jsonb_build_object('id', t.id, 'status', t.status, 'cycle', t.workflow_cycle, 'escalation_level', t.workflow_escalation_level) from public.tasks t
      where t.company_id = p_company and t.workflow_kind = 'payment_followup' and t.workflow_source_id = i.id order by t.workflow_cycle desc limit 1))
  from public.invoices i left join public.orders o on o.id = i.order_id left join public.dispatches d on d.id = i.dispatch_id
  where i.id = p_invoice and i.company_id = p_company and i.deleted_at is null
$$;

create or replace function public.receivable_followup_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_p jsonb := coalesce(p_payload, '{}'::jsonb); a jsonb; v_company uuid; v_actor uuid; v_role text; v_page integer; v_search text; v_dir text; v_view text; v_sort text;
  v_total integer; v_rows jsonb; v_id uuid; v_inv public.invoices; e public.receivable_exceptions; v_amount numeric; v_c jsonb; v_cat text; v_note text; v_complaint uuid;
  v_auth jsonb; v_done boolean; v_outcome text; v_today date := private.ist_today(); v_lead integer;
begin
  if p_command is null or jsonb_typeof(v_p) is distinct from 'object' then raise exception 'Invalid receivable request' using errcode = '22023'; end if;
  -- Amounts and balances are for finance only.
  a := private.olo_actor(private.olo_finance_roles());
  v_company := (a ->> 'company')::uuid; v_actor := (a ->> 'actor')::uuid; v_role := a ->> 'role';
  v_lead := (private.olo_settings_for(v_company)).payment_followup_lead_days;

  if p_command = 'list' then
    if v_p - array['view','page','search','sort','direction'] <> '{}'::jsonb then raise exception 'Invalid receivable request' using errcode = '22023'; end if;
    v_page := private.olo_p7_page(v_p); v_search := private.olo_p7_search(v_p); v_dir := private.olo_p7_dir(v_p);
    v_view := coalesce(v_p ->> 'view', 'due'); v_sort := coalesce(v_p ->> 'sort', 'due_date');
    if v_view not in ('due','overdue','disputed','write_off_pending','all_open') or v_sort not in ('due_date','collectible','invoice_number','days_overdue') then
      raise exception 'Invalid receivable view' using errcode = '22023';
    end if;
    -- Materialized: each row's derived state is computed once, not once per reference.
    with base as materialized (
      select i.id, i.invoice_number, i.invoice_date, i.due_date, i.order_id, i.customer_id, i.dispatch_id, o.order_number, d.dispatch_number, d.delivery_status,
        private.olo_invoice_collectible(v_company, i.id) c, v_today - coalesce(i.due_date, i.invoice_date) overdue_days
      from public.invoices i left join public.orders o on o.id = i.order_id left join public.dispatches d on d.id = i.dispatch_id
      where i.company_id = v_company and i.deleted_at is null and i.status not in ('draft','cancelled') and coalesce(i.balance_due, 0) > 0
        and (v_search = '' or position(v_search in lower(concat_ws(' ', i.invoice_number, o.order_number, d.dispatch_number, private.ap3_customer_name(i.customer_id)))) > 0)
    ), f as (
      select b.*, count(*) over () total_rows,
        case v_sort when 'due_date' then extract(epoch from coalesce(b.due_date, b.invoice_date)::timestamp) when 'collectible' then (b.c ->> 'collectible')::numeric
          when 'days_overdue' then b.overdue_days end sort_num,
        case when v_sort = 'invoice_number' then b.invoice_number end sort_text
      from base b
      where case v_view
        when 'due' then (b.c ->> 'collectible')::numeric > 1 and coalesce(b.due_date, b.invoice_date) <= v_today + v_lead
        when 'overdue' then (b.c ->> 'collectible')::numeric > 1 and b.overdue_days > 0
        when 'disputed' then (b.c ->> 'disputed')::numeric > 0
        when 'write_off_pending' then (b.c ->> 'pending_write_off')::numeric > 0
        else (b.c ->> 'collectible')::numeric > 1 or (b.c ->> 'open_exceptions')::integer > 0 end
    ), s2 as (
      select f.*, row_number() over (order by case when v_dir = 'asc' then f.sort_num end asc nulls last, case when v_dir = 'desc' then f.sort_num end desc nulls last,
        case when v_dir = 'asc' then f.sort_text end asc, case when v_dir = 'desc' then f.sort_text end desc, f.id) rn from f
    )
    select coalesce(max(s2.total_rows), 0)::integer, coalesce(jsonb_agg(jsonb_build_object('invoice_id', s2.id, 'invoice_number', s2.invoice_number, 'invoice_date', s2.invoice_date,
        'due_date', s2.due_date, 'days_overdue', greatest(s2.overdue_days, 0), 'customer', private.ap3_customer_name(s2.customer_id), 'order_id', s2.order_id,
        'order_number', s2.order_number, 'dispatch_number', s2.dispatch_number, 'delivery_status', s2.delivery_status,
        'balance', (s2.c ->> 'balance')::numeric, 'collectible', (s2.c ->> 'collectible')::numeric, 'disputed', (s2.c ->> 'disputed')::numeric,
        'written_off', (s2.c ->> 'written_off')::numeric, 'pending_write_off', (s2.c ->> 'pending_write_off')::numeric) order by s2.rn), '[]'::jsonb)
      into v_total, v_rows from s2 where s2.rn > (v_page - 1) * 10 and s2.rn <= v_page * 10;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', v_total, 'rows', v_rows, 'view', v_view, 'lead_days', v_lead);
  end if;

  if p_command = 'get' then
    if v_p - array['invoice_id'] <> '{}'::jsonb then raise exception 'Invalid receivable request' using errcode = '22023'; end if;
    v_rows := private.olo_receivable_json(v_company, private.olo_p7_uuid(v_p, 'invoice_id', 'an invoice'), v_actor, v_role);
    if v_rows is null then raise exception 'The invoice is not available' using errcode = 'P0001'; end if;
    return v_rows;
  end if;

  if p_command in ('dispute.open','write_off.propose') then
    if v_p - array['id','invoice_id','amount','reason_category','reason','customer_reference','complaint_id'] <> '{}'::jsonb then raise exception 'Invalid receivable request' using errcode = '22023'; end if;
    v_id := private.olo_p7_uuid(v_p, 'id', 'the request identity');
    select * into e from public.receivable_exceptions where id = v_id;
    if e.id is not null then
      if e.company_id <> v_company or e.invoice_id::text <> coalesce(v_p ->> 'invoice_id', '') or e.kind <> (case when p_command = 'dispute.open' then 'dispute' else 'write_off' end) then
        raise exception 'This request identity was already used for another record' using errcode = 'P0001';
      end if;
      return jsonb_build_object('replayed', true) || private.olo_receivable_json(v_company, e.invoice_id, v_actor, v_role);
    end if;
    select * into v_inv from public.invoices where id = private.olo_p7_uuid(v_p, 'invoice_id', 'an invoice') and company_id = v_company and deleted_at is null for update;
    if v_inv.id is null or v_inv.status in ('draft','cancelled') then raise exception 'Choose an issued invoice' using errcode = 'P0001'; end if;
    v_c := private.olo_invoice_collectible(v_company, v_inv.id);
    v_amount := private.olo_p7_num(v_p, 'amount', 0.01, 100000000, 'The amount');
    if v_amount <> round(v_amount, 2) then raise exception 'Enter the amount in rupees and paise' using errcode = '22023'; end if;
    v_cat := v_p ->> 'reason_category';
    if v_cat is null or v_cat not in ('rate_difference','quantity_shortage','quality_claim','transit_damage','late_delivery_penalty','tds_mismatch','settlement_discount','bad_debt','rounding','other') then
      raise exception 'Choose the reason' using errcode = '22023';
    end if;
    v_note := private.olo_p7_text(v_p, 'reason', 10, 500, 'The explanation');
    v_complaint := private.olo_p7_uuid(v_p, 'complaint_id', 'the complaint', false);
    if v_complaint is not null and not exists (select 1 from public.customer_complaints c where c.id = v_complaint and c.company_id = v_company and c.customer_id = v_inv.customer_id) then
      raise exception 'Choose a complaint of this customer' using errcode = 'P0001';
    end if;
    if p_command = 'dispute.open' then
      if v_amount > (v_c ->> 'collectible')::numeric - (v_c ->> 'disputed')::numeric + 0.005 then
        raise exception 'The disputed amount cannot exceed the collectible balance not already disputed (₹%)',
          to_char((v_c ->> 'collectible')::numeric - (v_c ->> 'disputed')::numeric, 'FM99,99,99,99,990.00') using errcode = 'P0001';
      end if;
    elsif v_amount > (v_c ->> 'collectible')::numeric - (v_c ->> 'pending_write_off')::numeric + 0.005 then
      raise exception 'The write-off cannot exceed the collectible balance not already proposed for write-off (₹%)',
        to_char((v_c ->> 'collectible')::numeric - (v_c ->> 'pending_write_off')::numeric, 'FM99,99,99,99,990.00') using errcode = 'P0001';
    end if;
    insert into public.receivable_exceptions(id, company_id, invoice_id, customer_id, order_id, kind, amount, reason_category, reason, customer_reference, complaint_id, status,
        balance_at_raise, raised_by)
      values (v_id, v_company, v_inv.id, v_inv.customer_id, v_inv.order_id, case when p_command = 'dispute.open' then 'dispute' else 'write_off' end, v_amount, v_cat, v_note,
        private.olo_p7_text(v_p, 'customer_reference', 2, 120, 'The customer reference', false), v_complaint,
        case when p_command = 'dispute.open' then 'open' else 'proposed' end, coalesce(v_inv.balance_due, 0), v_actor);
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
      values (v_company, v_actor, 'receivable_exception.' || p_command, 'invoice', v_inv.id, jsonb_build_object('exception_id', v_id, 'amount', v_amount, 'reason_category', v_cat));
    if p_command = 'write_off.propose' then
      perform private.ap3_notify_roles(v_company, array['owner','admin'], 'olo_write_off_proposed', 'warning', format('Write-off proposed on invoice %s', v_inv.invoice_number),
        format('%s proposes writing off ₹%s of invoice %s (%s): %s', a ->> 'name', to_char(v_amount, 'FM99,99,99,99,990.00'), v_inv.invoice_number,
          private.ap3_customer_name(v_inv.customer_id), v_note), 'invoice', v_inv.id, '/payments/follow-up/' || v_inv.id, 'olo-writeoff:' || v_id, v_actor);
    end if;
    perform private.olo_p7_refresh(v_company, v_inv.order_id);
    return jsonb_build_object('replayed', false) || private.olo_receivable_json(v_company, v_inv.id, v_actor, v_role);
  end if;

  if p_command in ('write_off.decide','dispute.resolve','exception.withdraw') then
    if (p_command = 'write_off.decide' and v_p - array['id','decision','note'] <> '{}'::jsonb)
       or (p_command = 'dispute.resolve' and v_p - array['id','outcome','note'] <> '{}'::jsonb)
       or (p_command = 'exception.withdraw' and v_p - array['id','note'] <> '{}'::jsonb) then
      raise exception 'Invalid receivable request' using errcode = '22023';
    end if;
    select * into e from public.receivable_exceptions where id = private.olo_p7_uuid(v_p, 'id', 'the record') and company_id = v_company for update;
    if e.id is null then raise exception 'The record is not available' using errcode = 'P0001'; end if;
    select * into v_inv from public.invoices where id = e.invoice_id for update;
    v_note := private.olo_p7_text(v_p, 'note', 10, 500, 'The note');
    perform set_config('olo.p7', 'on', true);
    if p_command = 'exception.withdraw' then
      if e.status not in ('open','proposed') then raise exception 'This record is already %', e.status using errcode = 'P0001'; end if;
      if e.raised_by <> v_actor and v_role not in ('owner','admin') then raise exception 'The person who raised it, an admin or the owner withdraws it' using errcode = '42501'; end if;
      update public.receivable_exceptions set status = 'withdrawn', decided_by = v_actor, decided_at = clock_timestamp(), decision_note = v_note where id = e.id;
    elsif p_command = 'dispute.resolve' then
      if e.kind <> 'dispute' or e.status <> 'open' then raise exception 'This dispute is not open' using errcode = 'P0001'; end if;
      v_outcome := v_p ->> 'outcome';
      if v_outcome is null or v_outcome not in ('customer_to_pay','credit_note','written_off') then raise exception 'Choose how the dispute ended' using errcode = '22023'; end if;
      if v_outcome = 'credit_note' and not exists (select 1 from public.credit_notes n where n.invoice_id = e.invoice_id and n.status = 'issued' and n.created_at >= e.raised_at) then
        raise exception 'Issue the credit note for the conceded amount first; it is not on this invoice yet' using errcode = 'P0001';
      end if;
      if v_outcome = 'written_off' and not exists (select 1 from public.receivable_exceptions w where w.invoice_id = e.invoice_id and w.kind = 'write_off' and w.status = 'approved'
          and w.raised_at >= e.raised_at) then
        raise exception 'Propose the write-off and have it approved first' using errcode = 'P0001';
      end if;
      update public.receivable_exceptions set status = 'resolved', outcome = v_outcome, decided_by = v_actor, decided_at = clock_timestamp(), decision_note = v_note where id = e.id;
    else
      if e.kind <> 'write_off' or e.status <> 'proposed' then raise exception 'This write-off is not waiting for a decision' using errcode = 'P0001'; end if;
      if v_p ->> 'decision' is null or v_p ->> 'decision' not in ('approve','reject') then raise exception 'Approve or reject the write-off' using errcode = '22023'; end if;
      if e.raised_by = v_actor and v_role <> 'owner' then raise exception 'You proposed this write-off; another authorised person decides it' using errcode = '42501'; end if;
      if v_p ->> 'decision' = 'reject' then
        update public.receivable_exceptions set status = 'rejected', decided_by = v_actor, decided_at = clock_timestamp(), decision_note = v_note where id = e.id;
      else
        v_c := private.olo_invoice_collectible(v_company, e.invoice_id);
        if e.amount > (v_c ->> 'collectible')::numeric + 0.005 then
          raise exception 'The invoice balance is now lower than the write-off (₹% collectible); reject it and propose the right amount',
            to_char((v_c ->> 'collectible')::numeric, 'FM99,99,99,99,990.00') using errcode = 'P0001';
        end if;
        v_auth := private.authority_check(v_company, 'write_off', e.amount, v_actor, e.raised_by);
        if coalesce((v_auth ->> 'configured')::boolean, false) then
          -- The delegation-of-authority matrix decides (bands, second approver, delegation, never one's own entry).
          v_done := private.authority_enforce(v_company, 'write_off', 'receivable_exception', e.id, 'v1', 'v1', e.amount, e.raised_by);
        else
          if v_role not in ('owner','admin') then raise exception 'A write-off is approved by the owner or an admin (no authority rule is configured for write-offs)' using errcode = '42501'; end if;
          v_done := true;
        end if;
        if v_done then
          update public.receivable_exceptions set status = 'approved', decided_by = v_actor, decided_at = clock_timestamp(), decision_note = v_note where id = e.id;
        else
          if e.first_approved_by = v_actor then raise exception 'A second, different person must approve this amount' using errcode = '42501'; end if;
          update public.receivable_exceptions set first_approved_by = v_actor, first_approved_at = clock_timestamp() where id = e.id;
        end if;
      end if;
    end if;
    perform set_config('olo.p7', '', true);
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
      values (v_company, v_actor, 'receivable_exception.' || p_command, 'invoice', e.invoice_id,
        jsonb_build_object('exception_id', e.id, 'kind', e.kind, 'amount', e.amount, 'decision', v_p ->> 'decision', 'outcome', v_outcome, 'note', v_note));
    update public.notifications set resolved_at = clock_timestamp(), resolution = 'Write-off decided', is_read = true, read_at = coalesce(read_at, now())
      where company_id = v_company and condition_key = 'olo-writeoff:' || e.id and resolved_at is null
        and (select status from public.receivable_exceptions where id = e.id) <> 'proposed';
    perform private.olo_p7_refresh(v_company, e.order_id);
    return private.olo_receivable_json(v_company, e.invoice_id, v_actor, v_role);
  end if;

  raise exception 'Unknown receivable command' using errcode = '22023';
end;
$$;

-- Order closure board, closure record and final closure of an operationally closed order (directive section 30).
create or replace function private.olo_closure_json(p_company uuid, p_order uuid, p_role text, p_finance boolean) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare o public.orders; st jsonb; v_cl public.order_closures; v_op jsonb; v_fin jsonb;
begin
  select * into o from public.orders where id = p_order and company_id = p_company and deleted_at is null;
  if o.id is null then return null; end if;
  st := private.olo_closure_state(p_company, p_order);
  select * into v_cl from public.order_closures where company_id = p_company and order_id = p_order and status = 'closed';
  if v_cl.id is null then v_op := private.closure_readiness(p_company, p_order, 'operational'); end if;
  if coalesce(v_cl.kind, '') <> 'final' then v_fin := private.closure_readiness(p_company, p_order, 'final'); end if;
  -- Receivable amounts in the readiness detail are for finance only.
  if not p_finance then
    v_op := case when v_op is not null then v_op - 'outstanding_inr' || jsonb_build_object('items', (select coalesce(jsonb_agg(case when x ->> 'domain' = 'billing'
      then x || jsonb_build_object('detail', 'Details are visible to finance.') else x end), '[]'::jsonb) from jsonb_array_elements(v_op -> 'items') x)) end;
    v_fin := case when v_fin is not null then v_fin - 'outstanding_inr' || jsonb_build_object('items', (select coalesce(jsonb_agg(case when x ->> 'domain' = 'billing'
      then x || jsonb_build_object('detail', 'Details are visible to finance.') else x end), '[]'::jsonb) from jsonb_array_elements(v_fin -> 'items') x)) end;
  end if;
  return jsonb_build_object('order', jsonb_build_object('id', o.id, 'order_number', o.order_number, 'customer', private.ap3_customer_name(o.customer_id), 'stage', o.current_stage,
      'order_date', o.order_date),
    'state', st, 'closure', case when v_cl.id is not null then jsonb_build_object('id', v_cl.id, 'kind', v_cl.kind, 'closed_at', v_cl.closed_at, 'close_note', v_cl.close_note,
      'closed_by_name', (select full_name from public.app_users where id = v_cl.closed_by), 'carried', v_cl.carried) end,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('kind', h.kind, 'status', h.status, 'closed_at', h.closed_at, 'close_note', h.close_note,
        'closed_by_name', u.full_name, 'reopened_at', h.reopened_at, 'reopen_note', h.reopen_note, 'superseded_at', h.superseded_at) order by h.closed_at desc), '[]'::jsonb)
      from public.order_closures h left join public.app_users u on u.id = h.closed_by where h.company_id = p_company and h.order_id = p_order),
    'operational', v_op, 'final', v_fin,
    'can_close_operational', v_cl.id is null and o.current_stage not in ('closed','cancelled') and p_role in ('owner','admin','sales_manager','factory_manager'),
    'can_finalize', v_cl.kind = 'operational' and p_role in ('owner','admin','accounts'),
    'can_close_final_directly', v_cl.id is null and o.current_stage not in ('closed','cancelled') and p_role in ('owner','admin','accounts'));
end;
$$;

create or replace function public.order_closure_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_p jsonb := coalesce(p_payload, '{}'::jsonb); a jsonb; v_company uuid; v_actor uuid; v_role text; v_page integer; v_search text; v_view text;
  v_total integer; v_rows jsonb; v_counts jsonb; v_id uuid; o public.orders; v_cl public.order_closures; v_r jsonb; v_note text; v_new uuid; v_finance boolean;
  v_sort text; v_dir text;
begin
  if p_command is null or jsonb_typeof(v_p) is distinct from 'object' then raise exception 'Invalid closure request' using errcode = '22023'; end if;
  a := private.olo_actor(private.olo_reader_roles());
  v_company := (a ->> 'company')::uuid; v_actor := (a ->> 'actor')::uuid; v_role := a ->> 'role';
  v_finance := v_role = any(private.olo_finance_roles());

  if p_command = 'board' then
    if v_p - array['view','page','search','sort','direction'] <> '{}'::jsonb then raise exception 'Invalid closure request' using errcode = '22023'; end if;
    v_page := private.olo_p7_page(v_p); v_search := private.olo_p7_search(v_p); v_dir := private.olo_p7_dir(v_p);
    v_view := coalesce(v_p ->> 'view', 'ready'); v_sort := coalesce(v_p ->> 'sort', 'last_at');
    if v_sort not in ('last_at','order_number','blocking') then raise exception 'Invalid closure sort' using errcode = '22023'; end if;
    if v_view not in ('ready','acceptance_pending','in_progress','financially_open','financially_settled','fully_closed','partially_closed','all') then
      raise exception 'Invalid closure view' using errcode = '22023';
    end if;
    -- Orders that have shipped in the last 365 days or are closed, newest activity first.
    -- Materialized: each row's derived state is computed once, not once per reference.
    with base as materialized (
      select ob.id, ob.order_number, ob.customer_id, ob.current_stage, private.olo_closure_state(v_company, ob.id) st,
        greatest((select max(d.actual_dispatched_at) from public.dispatches d where d.company_id = v_company and d.order_id = ob.id),
          (select max(c.closed_at) from public.order_closures c where c.company_id = v_company and c.order_id = ob.id)) last_at
      from public.orders ob
      where ob.company_id = v_company and ob.deleted_at is null and ob.current_stage <> 'cancelled' and ob.opening_cutover_id is null
        and (exists (select 1 from public.dispatches d where d.company_id = v_company and d.order_id = ob.id and d.actual_dispatched_at > now() - interval '365 days')
          or exists (select 1 from public.order_closures c where c.company_id = v_company and c.order_id = ob.id and c.status = 'closed'))
        and (v_search = '' or position(v_search in lower(concat_ws(' ', ob.order_number, private.ap3_customer_name(ob.customer_id)))) > 0)
    ), tagged as (
      select b.*, case
          when b.st ->> 'overall' = 'fully_closed' then 'fully_closed'
          when b.st ->> 'overall' = 'partially_closed_by_authorization' then 'partially_closed'
          when b.st ->> 'operational' = 'closed' and b.st ->> 'financial' <> 'settled' then 'financially_open'
          when b.st ->> 'operational' = 'closed' then 'financially_settled'
          when b.st ->> 'operational' = 'fulfilled' then 'ready'
          when b.st ->> 'operational' = 'acceptance_pending' then 'acceptance_pending'
          else 'in_progress' end grp
      from base b
    ), counted as (select jsonb_object_agg(grp, n) c from (select grp, count(*) n from tagged group by grp) x),
    f as (select t.*, count(*) over () total_rows, row_number() over (order by
        case when v_dir = 'asc' then case v_sort when 'last_at' then extract(epoch from t.last_at) when 'blocking' then (t.st ->> 'blocking')::numeric end end asc nulls last,
        case when v_dir = 'desc' then case v_sort when 'last_at' then extract(epoch from t.last_at) when 'blocking' then (t.st ->> 'blocking')::numeric end end desc nulls last,
        case when v_dir = 'asc' and v_sort = 'order_number' then t.order_number end asc, case when v_dir = 'desc' and v_sort = 'order_number' then t.order_number end desc, t.id) rn
      from tagged t where v_view = 'all' or t.grp = v_view)
    select coalesce(max(f.total_rows), 0)::integer, coalesce(jsonb_agg(jsonb_build_object('order_id', f.id, 'order_number', f.order_number,
        'customer', private.ap3_customer_name(f.customer_id), 'stage', f.current_stage, 'group', f.grp, 'overall', f.st ->> 'overall', 'operational', f.st ->> 'operational',
        'financial', f.st ->> 'financial', 'administrative', f.st ->> 'administrative', 'blocking', (f.st ->> 'blocking')::integer, 'first_blocker', f.st -> 'first_blocker',
        'authorization', (f.st ->> 'authorization')::boolean, 'last_at', f.last_at) order by f.rn) filter (where f.rn > (v_page - 1) * 10 and f.rn <= v_page * 10), '[]'::jsonb),
      (select c from counted)
      into v_total, v_rows, v_counts from f;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows, 'view', v_view, 'counts', coalesce(v_counts, '{}'::jsonb),
      'sort', v_sort, 'direction', v_dir);
  end if;

  if p_command = 'get' then
    if v_p - array['order_id'] <> '{}'::jsonb then raise exception 'Invalid closure request' using errcode = '22023'; end if;
    v_rows := private.olo_closure_json(v_company, private.olo_p7_uuid(v_p, 'order_id', 'an order'), v_role, v_finance);
    if v_rows is null then raise exception 'The order is not available' using errcode = 'P0001'; end if;
    return v_rows;
  end if;

  if p_command = 'finalize' then
    if v_p - array['order_id','note'] <> '{}'::jsonb then raise exception 'Invalid closure request' using errcode = '22023'; end if;
    if not v_finance then raise exception 'Final commercial closure is recorded by accounts, an admin or the owner' using errcode = '42501'; end if;
    v_id := private.olo_p7_uuid(v_p, 'order_id', 'an order');
    v_note := private.olo_p7_text(v_p, 'note', 10, 500, 'The final closure note');
    select * into o from public.orders where id = v_id and company_id = v_company and deleted_at is null for update;
    if o.id is null then raise exception 'The order is not available' using errcode = 'P0001'; end if;
    select * into v_cl from public.order_closures where company_id = v_company and order_id = o.id and status = 'closed' for update;
    if v_cl.id is null or v_cl.kind <> 'operational' then
      raise exception '%', case when v_cl.kind = 'final' then 'This order is already fully closed' else 'Close the order operationally first (closure review), or record a final closure there' end
        using errcode = 'P0001';
    end if;
    v_r := private.closure_readiness(v_company, o.id, 'final');
    if (v_r ->> 'blocking')::integer > 0 then
      raise exception 'Final closure needs every obligation met: % item(s) open, starting with: %', v_r ->> 'blocking',
        (select x ->> 'label' from jsonb_array_elements(v_r -> 'items') x where (x ->> 'blocking')::boolean limit 1) using errcode = 'P0001';
    end if;
    v_new := gen_random_uuid();
    -- The engine evaluates once the final closure is written, not while the operational one is superseded.
    perform set_config('olo.engine', 'running', true);
    update public.order_closures set status = 'superseded', superseded_at = clock_timestamp() where id = v_cl.id;
    insert into public.order_closures(id, company_id, order_id, kind, previous_stage, readiness, carried, closed_by, close_note)
      values (v_new, v_company, o.id, 'final', v_cl.previous_stage, v_r -> 'items', '[]'::jsonb, v_actor, v_note);
    insert into public.order_stage_history(company_id, order_id, stage, changed_by, remarks) values (v_company, o.id, 'closed', v_actor, 'Final closure after operational closure: ' || v_note);
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
      values (v_company, v_actor, 'order.final_closure', 'order', o.id, jsonb_build_object('closure_id', v_new, 'supersedes', v_cl.id));
    perform set_config('olo.engine', '', true);
    perform private.olo_p7_refresh(v_company, o.id);
    return private.olo_closure_json(v_company, o.id, v_role, v_finance);
  end if;

  raise exception 'Unknown closure command' using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Order lifecycle: shipment, acceptance, complaints and the closure states
-- ---------------------------------------------------------------------------------------------------------------
alter function private.olo_order_core(uuid, uuid, boolean, boolean) rename to olo_order_core_p6;
create or replace function private.olo_order_core(p_company uuid, p_order uuid, p_finance boolean, p_with_gates boolean) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v jsonb := private.olo_order_core_p6(p_company, p_order, p_finance, p_with_gates); st jsonb; v_repl numeric := 0; v_comp record; v_acc record; v_inv record;
  v_dept text; v_label text; v_link text; v_next jsonb; v_q jsonb; v_closure_status text;
begin
  if v is null then return v; end if;
  st := private.olo_closure_state(p_company, p_order);
  select coalesce(sum(x.kg), 0) into v_repl from public.customer_complaint_replacements x join public.dispatches d on d.id = x.dispatch_id and d.company_id = x.company_id
    where x.company_id = p_company and x.withdrawn_at is null and d.order_id = p_order and d.actual_dispatched_at is not null and d.delivery_status <> 'returned';
  v_q := coalesce(v -> 'quantities', '{}'::jsonb);
  v := jsonb_set(v, '{quantities}', v_q || jsonb_build_object('replacement_dispatched_kg', v_repl,
    'outstanding_kg', greatest(coalesce((v_q ->> 'ordered_kg')::numeric, 0) - (coalesce((v_q ->> 'dispatched_kg')::numeric, 0) - v_repl), 0)));
  select count(*) filter (where c.status = any(private.olo_open_complaint_statuses())) open_n, count(*) n,
      (array_agg(c.id order by c.logged_at) filter (where c.status = any(private.olo_open_complaint_statuses())))[1] first_id,
      (array_agg(c.complaint_number order by c.logged_at) filter (where c.status = any(private.olo_open_complaint_statuses())))[1] first_number,
      (array_agg(c.status order by c.logged_at) filter (where c.status = any(private.olo_open_complaint_statuses())))[1] first_status,
      (array_agg(c.category order by c.logged_at) filter (where c.status = any(private.olo_open_complaint_statuses())))[1] first_category
    into v_comp from public.customer_complaints c where c.company_id = p_company and c.order_id = p_order;
  select count(*) filter (where (a ->> 'pending_lines')::integer > 0) pending, count(*) filter (where a ->> 'outcome' = 'accepted_in_full') full_n,
      count(*) filter (where a ->> 'outcome' not in ('accepted_in_full','acceptance_pending','not_delivered')) issues, count(*) delivered,
      (array_agg(d.id order by d.delivered_at) filter (where (a ->> 'pending_lines')::integer > 0))[1] first_pending,
      (array_agg(d.dispatch_number order by d.delivered_at) filter (where (a ->> 'pending_lines')::integer > 0))[1] first_pending_number
    into v_acc from public.dispatches d cross join lateral private.olo_dispatch_acceptance(p_company, d.id) a
    where d.company_id = p_company and d.order_id = p_order and d.delivery_status = 'delivered';
  v_closure_status := coalesce(st ->> 'overall', case when st ->> 'operational' = 'open' then 'open' else st ->> 'operational' end);
  v := jsonb_set(v, '{domains}', coalesce((select jsonb_agg(case when e ->> 'key' = 'closure' then e || jsonb_build_object('status', v_closure_status,
        'detail', format('Operational: %s · financial: %s · records: %s%s', replace(st ->> 'operational', '_', ' '), replace(st ->> 'financial', '_', ' '),
          replace(coalesce(st ->> 'administrative', 'reviewed at final closure'), '_', ' '), case when (st ->> 'authorization')::boolean then ' · closed by authorisation' else '' end))
      else e end order by n) from jsonb_array_elements(coalesce(v -> 'domains', '[]'::jsonb)) with ordinality t(e, n)), '[]'::jsonb)
    || jsonb_build_array(
      jsonb_build_object('key', 'acceptance', 'label', 'Customer acceptance', 'status', case when v_acc.delivered = 0 then 'not_delivered' when v_acc.pending > 0 then 'acceptance_pending'
        when v_acc.issues > 0 then 'exceptions' when v_acc.full_n = v_acc.delivered then 'accepted_in_full' else 'accepted_partially' end,
        'detail', format('%s delivered dispatch(es): %s accepted in full, %s awaiting acceptance, %s with a shortage, damage, return or dispute', v_acc.delivered, v_acc.full_n, v_acc.pending, v_acc.issues)),
      jsonb_build_object('key', 'complaints', 'label', 'Customer complaints', 'status', case when v_comp.open_n > 0 then 'open' when v_comp.n > 0 then 'resolved' else 'none' end,
        'detail', format('%s open of %s logged%s', v_comp.open_n, v_comp.n, coalesce(' · ' || v_comp.first_number || ' ' || v_comp.first_status, '')))));
  if st ->> 'overall' is not null then v := jsonb_set(v, '{overall}', to_jsonb(st ->> 'overall')); end if;

  -- Next action at the end of the flow: complaints, acceptance, closure and collection.
  v_dept := v -> 'next_action' ->> 'department'; v_link := v -> 'next_action' ->> 'link';
  if coalesce(v ->> 'overall', '') not in ('cancelled','fully_closed') and (v_dept is null or v_dept = 'management' or v_link = '/payments'
      or v -> 'next_action' ->> 'label' in ('Resolve the customer delivery discrepancy','Upload the proof of delivery')) then
    if v_comp.open_n > 0 then
      v_next := jsonb_build_object('label', format('Customer complaint %s is %s: take the next step', v_comp.first_number, replace(v_comp.first_status, '_', ' ')),
        'department', case when v_comp.first_status in ('open','investigating') then private.olo_complaint_department(v_comp.first_category) when v_comp.first_status = 'action' then 'sales'
          else 'factory_management' end, 'link', '/quality/complaints/' || v_comp.first_id);
    elsif v_acc.pending > 0 then
      v_next := jsonb_build_object('label', format('Record customer acceptance for dispatch %s', coalesce(v_acc.first_pending_number, '-')), 'department', 'sales',
        'link', '/dispatches/deliveries/' || v_acc.first_pending);
    elsif st ->> 'operational' = 'fulfilled' then
      v_next := jsonb_build_object('label', 'Close the order operationally: every operational obligation is met', 'department', 'sales', 'link', '/orders/closure/' || p_order);
    elsif st ->> 'operational' = 'closed' and st ->> 'closure_kind' = 'operational' then
      if (st ->> 'blocking')::integer = 0 then
        v_next := jsonb_build_object('label', 'Record the final closure', 'department', 'finance', 'link', '/orders/closure/' || p_order);
      elsif st ->> 'financial' = 'open' then
        select i.id, i.invoice_number into v_inv from public.invoices i where i.company_id = p_company and i.order_id = p_order and i.deleted_at is null and i.status not in ('draft','cancelled')
          and (private.olo_invoice_collectible(p_company, i.id) ->> 'collectible')::numeric > 1 order by coalesce(i.due_date, i.invoice_date) limit 1;
        v_next := jsonb_build_object('label', case when v_inv.id is not null then format('Collect payment of invoice %s', v_inv.invoice_number) else 'Resolve the open financial exception' end,
          'department', 'finance', 'link', case when v_inv.id is not null then '/payments/follow-up/' || v_inv.id else '/payments/follow-up' end);
      else
        v_next := jsonb_build_object('label', coalesce(st -> 'first_blocker' ->> 'label', 'Resolve the open closure item'), 'department', 'management',
          'link', coalesce(st -> 'first_blocker' ->> 'href', '/orders/closure/' || p_order));
      end if;
    end if;
    if v_next is not null then v := jsonb_set(v, '{next_action}', v_next); end if;
  end if;
  return v || jsonb_build_object('closure', st);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants, row level security, live screens
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function private.olo_p7_text(jsonb, text, integer, integer, text, boolean), private.olo_p7_uuid(jsonb, text, text, boolean),
  private.olo_p7_num(jsonb, text, numeric, numeric, text, boolean), private.olo_p7_page(jsonb), private.olo_p7_search(jsonb), private.olo_p7_dir(jsonb),
  private.olo_complaint_due(timestamptz, text), private.olo_complaint_number(uuid, timestamptz), private.olo_complaint_defaults(), private.olo_complaint_logged(), private.olo_complaint_guard(),
  private.olo_p7_guard(), private.olo_open_complaint_statuses(), private.olo_dispatch_manifest(uuid, uuid), private.olo_receipt_discrepancy(uuid, uuid),
  private.olo_dispatch_acceptance(uuid, uuid), private.olo_shipment_state(uuid, uuid), private.olo_free_replacement(uuid, uuid), private.olo_complaint_replaced_kg(uuid, uuid),
  private.olo_invoice_collectible(uuid, uuid), private.closure_readiness_nov(uuid, uuid, text), private.closure_readiness(uuid, uuid, text), private.olo_closure_state(uuid, uuid),
  private.olo_p7_last_task(uuid, text, uuid), private.olo_evaluate_delivery_p7(uuid), private.olo_complaint_department(text), private.olo_complaint_ready_to_close(uuid, uuid),
  private.olo_evaluate_complaints(uuid), private.olo_evaluate_payments(uuid), private.olo_evaluate_closure(uuid, uuid), private.olo_evaluate_shipment(uuid),
  private.olo_verify_tasks_p6(uuid), private.olo_verify_tasks(uuid), private.olo_run_all_p6(uuid, text), private.olo_run_all(uuid, text), private.olo_after_closure_change(),
  private.olo_guard_order_closure(), private.olo_after_order_closure(), private.olo_p7_refresh(uuid, uuid), private.olo_delivery_json(uuid, uuid, text),
  private.olo_complaint_event(public.customer_complaints, text, text, text, jsonb, uuid), private.olo_complaint_json(uuid, uuid, uuid, text),
  private.olo_receivable_json(uuid, uuid, uuid, text), private.olo_closure_json(uuid, uuid, text, boolean), private.olo_order_core_p6(uuid, uuid, boolean, boolean),
  private.olo_order_core(uuid, uuid, boolean, boolean), private.olo_expected_delivery(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delivery_tracking_command(text, jsonb), public.customer_complaint_command(text, jsonb), public.receivable_followup_command(text, jsonb),
  public.order_closure_command(text, jsonb) from public, anon;
grant execute on function public.delivery_tracking_command(text, jsonb), public.customer_complaint_command(text, jsonb), public.receivable_followup_command(text, jsonb),
  public.order_closure_command(text, jsonb) to authenticated;

alter table public.dispatch_tracking_updates enable row level security;
alter table public.delivery_receipts enable row level security;
alter table public.customer_complaint_items enable row level security;
alter table public.customer_complaint_replacements enable row level security;
alter table public.customer_complaint_events enable row level security;
alter table public.receivable_exceptions enable row level security;
revoke all on public.dispatch_tracking_updates, public.delivery_receipts, public.customer_complaint_items, public.customer_complaint_replacements,
  public.customer_complaint_events, public.receivable_exceptions from public, anon, authenticated;
grant select on public.dispatch_tracking_updates, public.delivery_receipts, public.customer_complaint_items, public.customer_complaint_replacements,
  public.customer_complaint_events, public.receivable_exceptions to authenticated;
create policy dispatch_tracking_updates_read on public.dispatch_tracking_updates for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy delivery_receipts_read on public.delivery_receipts for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy customer_complaint_items_read on public.customer_complaint_items for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy customer_complaint_replacements_read on public.customer_complaint_replacements for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy customer_complaint_events_read on public.customer_complaint_events for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
-- Disputed and written-off amounts: finance only.
create policy receivable_exceptions_read on public.receivable_exceptions for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() in ('owner','admin','accounts'));

do $$
declare v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['dispatch_tracking_updates','delivery_receipts','customer_complaint_events'] loop
      if not exists (select 1 from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid
          where p.pubname = 'supabase_realtime' and pr.prrelid = ('public.' || v_table)::regclass) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
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
      perform private.olo_evaluate_delivery_p7(c.id);
      perform private.olo_evaluate_complaints(c.id);
      perform private.olo_evaluate_payments(c.id);
      perform private.olo_evaluate_closure(c.id, null);
      perform private.olo_verify_tasks(c.id);
    exception when others then
      insert into public.olo_engine_errors(company_id, source, message) values (c.id, 'phase7:first_run', left(sqlerrm, 500));
    end;
  end loop;
  perform set_config('olo.engine', '', true);
end;
$$;

commit;
