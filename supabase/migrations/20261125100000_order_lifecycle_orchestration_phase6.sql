-- Order lifecycle orchestration, Phase 6 — packaging and shipment (directive sections 22-25; strategy phase 6:
-- packaging release, bundle QR traceability, finished-goods transfer, dispatch release, invoicing).
--
--   * Packaging release follows the route: material of a job that needs artificial ageing is released to packaging by
--     the final QC after ageing, not by its first-stage QC. The first-stage QC handoff to packaging is no longer raised
--     for such jobs; a final QC that accepts kilograms raises the packaging handoff instead, with the customer's packing
--     specification. Every other job is released by its first-stage QC approval, as before. A release queue shows per
--     job what is released, what is packed (bundles, packing lines, stock) and what is still to pack.
--   * Bundle traceability: one register of every prepared bundle with its physical state (packed, on a transfer to the
--     finished-goods area, in the finished-goods area, loaded, dispatched, delivered) and its invoice. Scanning or typing
--     a bundle tag opens the bundle trace: order and customer, profile, production job, press and die, billets and their
--     cast or supplier batch, QC decisions, ageing, final QC, holds, packaging, labels, custody, loading, dispatch and
--     invoice. A missing record is listed as missing, never guessed.
--   * Finished-goods transfer: packaging sends packed bundles to a holding location; the receiving person (not the
--     sender, owner excepted) scans each tag in. A transfer closed short records the missing bundles and alerts factory
--     management. A bundle on a transfer is not loaded until received. An optional control (default off) loads only
--     bundles received in the finished-goods area. Reminders start once the factory uses transfers.
--   * Invoicing link: a dispatch that left the gate without an issued tax invoice gives finance one task after a
--     configurable delay; it closes when the invoice for that dispatch is issued. The order lifecycle shows released,
--     to-pack, finished-goods, transfer and invoiced quantities and the dispatches still without an invoice.
-- Additive: new tables, a view, settings, task kinds, triggers and wrappers. Earlier functions are wrapped, not
-- rewritten; olo_settings_for and olo_guard_workflow_task are redefined with the Phase 6 additions marked.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ---------------------------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------------------------
alter table public.olo_settings
  add column if not exists fg_transfer_hours smallint not null default 8 check (fg_transfer_hours between 1 and 168),
  add column if not exists invoice_due_hours smallint not null default 4 check (invoice_due_hours between 0 and 168),
  add column if not exists enforce_fg_receipt boolean not null default false;

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
    -- Phase 6
    s.fg_transfer_hours := 8; s.invoice_due_hours := 4; s.enforce_fg_receipt := false;
  end if;
  return s;
end;
$$;

-- The Phase 5 command keeps every command; this wrapper saves the three Phase 6 settings.
alter function public.olo_command(text, jsonb) rename to olo_command_p5;
alter function public.olo_command_p5(text, jsonb) set schema private;
revoke all on function private.olo_command_p5(text, jsonb) from public, anon, authenticated;

create or replace function public.olo_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_payload jsonb := coalesce(p_payload, '{}'::jsonb); a jsonb; v_before public.olo_settings; v_enforce boolean; v_fg integer; v_inv integer; v_rest jsonb;
  v_keys text[] := array['fg_transfer_hours','invoice_due_hours','enforce_fg_receipt'];
begin
  if p_command <> 'settings.save' or jsonb_typeof(v_payload) is distinct from 'object' or not (v_payload ?| v_keys) then
    return private.olo_command_p5(p_command, v_payload);
  end if;
  a := private.olo_actor(private.olo_reader_roles());
  if (a ->> 'role') not in ('owner','admin','factory_manager') then
    raise exception 'Only the owner, admin or factory manager can change orchestration settings' using errcode = '42501';
  end if;
  if v_payload ? 'enforce_fg_receipt' and jsonb_typeof(v_payload -> 'enforce_fg_receipt') is distinct from 'boolean' then
    raise exception 'The finished-goods receipt control is on or off' using errcode = '22023';
  end if;
  v_enforce := (v_payload ->> 'enforce_fg_receipt')::boolean;
  begin
    v_fg := (v_payload ->> 'fg_transfer_hours')::integer;
    v_inv := (v_payload ->> 'invoice_due_hours')::integer;
  exception when others then
    raise exception 'Settings must be numbers' using errcode = '22023';
  end;
  if v_fg is not null and v_fg not between 1 and 168 then raise exception 'The finished-goods transfer reminder must be 1 to 168 hours' using errcode = '23514'; end if;
  if v_inv is not null and v_inv not between 0 and 168 then raise exception 'The invoice reminder must be 0 to 168 hours after the dispatch leaves' using errcode = '23514'; end if;
  v_before := private.olo_settings_for((a ->> 'company')::uuid);
  v_rest := v_payload - v_keys;
  if v_rest <> '{}'::jsonb then
    perform private.olo_command_p5('settings.save', v_rest);
  else
    insert into public.olo_settings(company_id, updated_by) values ((a ->> 'company')::uuid, (a ->> 'actor')::uuid) on conflict (company_id) do nothing;
  end if;
  update public.olo_settings set enforce_fg_receipt = coalesce(v_enforce, enforce_fg_receipt), fg_transfer_hours = coalesce(v_fg, fg_transfer_hours),
    invoice_due_hours = coalesce(v_inv, invoice_due_hours), updated_by = (a ->> 'actor')::uuid, updated_at = now()
    where company_id = (a ->> 'company')::uuid;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values ((a ->> 'company')::uuid, (a ->> 'actor')::uuid, 'olo_settings.updated', 'olo_settings', (a ->> 'company')::uuid,
      jsonb_build_object('before', jsonb_build_object('enforce_fg_receipt', v_before.enforce_fg_receipt, 'fg_transfer_hours', v_before.fg_transfer_hours,
          'invoice_due_hours', v_before.invoice_due_hours),
        'changes', jsonb_strip_nulls(jsonb_build_object('enforce_fg_receipt', v_enforce, 'fg_transfer_hours', v_fg, 'invoice_due_hours', v_inv))));
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
        'initial_qc','ageing_release','ageing_cycle','ageing_review','final_qc','fg_transfer','fg_receipt','dispatch_invoice')
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
      -- Phase 6
      when 'fg_transfer' then 'This task closes when the packed bundles are sent to the finished-goods area, loaded or dispatched.'
      when 'fg_receipt' then 'This task closes when every bundle of the transfer is scanned in at the finished-goods area, or the transfer is closed or cancelled.'
      else 'This task closes when a tax invoice is issued for the dispatch.' end
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
-- Finished-goods transfers (packaging -> holding area)
-- ---------------------------------------------------------------------------------------------------------------
create table public.fg_transfers (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  transfer_number text not null check (length(transfer_number) between 3 and 40),
  to_location_id uuid not null,
  status text not null default 'in_transit' check (status in ('in_transit','received','closed_short','cancelled')),
  bundle_count integer not null check (bundle_count between 1 and 60),
  net_kg numeric(15,3) not null check (net_kg > 0),
  note text check (note is null or length(note) <= 500),
  sent_by uuid not null references public.app_users(id),
  sent_at timestamptz not null default now(),
  closed_by uuid references public.app_users(id),
  closed_at timestamptz,
  close_note text check (close_note is null or length(btrim(close_note)) between 10 and 500),
  unique (company_id, transfer_number),
  unique (company_id, id),
  foreign key (company_id, to_location_id) references public.inventory_locations(company_id, id),
  check ((status = 'in_transit') = (closed_at is null)),
  check (status not in ('closed_short','cancelled') or close_note is not null)
);
create index fg_transfers_list_idx on public.fg_transfers(company_id, status, sent_at desc);
create index fg_transfers_location_idx on public.fg_transfers(to_location_id);
create index fg_transfers_sent_by_idx on public.fg_transfers(sent_by);
create index fg_transfers_closed_by_idx on public.fg_transfers(closed_by);

create table public.fg_transfer_bundles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  transfer_id uuid not null,
  bundle_id uuid not null,
  order_id uuid not null references public.orders(id),
  net_kg numeric(15,3) not null check (net_kg > 0),
  state text not null default 'sent' check (state in ('sent','received','missing','withdrawn')),
  received_by uuid references public.app_users(id),
  received_at timestamptz,
  scanned_tag text check (scanned_tag is null or length(scanned_tag) between 1 and 160),
  foreign key (company_id, transfer_id) references public.fg_transfers(company_id, id),
  foreign key (company_id, bundle_id) references public.prepared_physical_bundles(company_id, id),
  unique (transfer_id, bundle_id),
  check ((state = 'received') = (received_at is not null and received_by is not null))
);
-- A bundle is on at most one open transfer.
create unique index fg_transfer_bundles_open_idx on public.fg_transfer_bundles(company_id, bundle_id) where state = 'sent';
create index fg_transfer_bundles_bundle_idx on public.fg_transfer_bundles(company_id, bundle_id, received_at desc);
create index fg_transfer_bundles_transfer_idx on public.fg_transfer_bundles(transfer_id);
create index fg_transfer_bundles_order_idx on public.fg_transfer_bundles(order_id);
create index fg_transfer_bundles_receiver_idx on public.fg_transfer_bundles(received_by);

-- Rows change only through packaging_flow_command (authenticated users have no write grants either).
create or replace function private.olo_fg_guard() returns trigger language plpgsql set search_path = public, private as $$
begin
  if coalesce(current_setting('olo.fg', true), '') <> 'on' then
    raise exception 'Finished-goods transfers change only through the transfer screen' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger fg_transfers_guard before update or delete on public.fg_transfers for each row execute function private.olo_fg_guard();
create trigger fg_transfer_bundles_guard before update or delete on public.fg_transfer_bundles for each row execute function private.olo_fg_guard();

create or replace function private.olo_fg_transfer_number(p_company uuid) returns text
language plpgsql security definer set search_path = public, private as $$
declare v_prefix text := 'FGT-' || to_char(private.ist_today(), 'YYMM') || '-'; v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':fg_transfer_number', 0));
  select coalesce(max(substring(x.transfer_number from length(v_prefix) + 1)::integer), 0) + 1 into v_n
    from public.fg_transfers x where x.company_id = p_company and x.transfer_number like v_prefix || '%'
      and substring(x.transfer_number from length(v_prefix) + 1) ~ '^[0-9]{1,6}$';
  return v_prefix || lpad(v_n::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Bundle register: every prepared bundle with its source, physical state, custody, dispatch and invoice
-- ---------------------------------------------------------------------------------------------------------------
create view private.olo_bundle_register as
select b.id, b.company_id, b.bundle_number, b.order_id, o.order_number, o.customer_id, o.current_stage as order_stage, o.opening_cutover_id,
  b.source_kind, b.source_line_id, sb.id as stock_batch_id, sb.bundle_number as stock_bundle_number,
  pj.id as job_id, pj.job_number, b.profile_id, pr.profile_code, b.number_of_pieces, b.net_length_m, b.gross_weight_kg, b.tare_weight_kg,
  round(b.gross_weight_kg - b.tare_weight_kg, 3) as net_kg, b.recorded_at, b.recorded_by,
  b.dispatch_id, d.dispatch_number, d.delivery_status, d.actual_dispatched_at, d.delivered_at,
  fg.transfer_id, fg.transfer_number, fg.line_state, fg.location_id, fg.location_name, fg.sent_at, fg.received_at,
  ld.session_id as loaded_session_id, ld.vehicle_number as loaded_vehicle,
  inv.id as invoice_id, inv.invoice_number, inv.status as invoice_status,
  case when b.dispatch_id is not null then case when d.delivery_status = 'delivered' then 'delivered' else 'dispatched' end
    when ld.session_id is not null then 'loaded'
    when fg.line_state = 'sent' then 'in_transfer'
    when fg.line_state = 'received' then 'in_fg'
    else 'packed' end as state
from public.prepared_physical_bundles b
join public.orders o on o.id = b.order_id and o.company_id = b.company_id
left join public.profile_stock_reservations sr on b.source_kind = 'reservation' and sr.id = b.source_line_id and sr.company_id = b.company_id
left join public.order_dealer_stock_fulfillments df on b.source_kind = 'dealer_stock' and df.id = b.source_line_id and df.company_id = b.company_id
left join public.profile_stock_batches sb on sb.id = coalesce(sr.profile_stock_batch_id, df.profile_stock_batch_id) and sb.company_id = b.company_id
left join public.production_jobs pj on pj.company_id = b.company_id
  and pj.id = case when b.source_kind = 'production' then b.source_line_id else sb.production_job_id end
left join public.aluminium_profiles pr on pr.id = b.profile_id
left join public.dispatches d on d.id = b.dispatch_id and d.company_id = b.company_id
left join lateral (
  select l.transfer_id, x.transfer_number, l.state as line_state, x.to_location_id as location_id, il.location_name, x.sent_at, l.received_at
  from public.fg_transfer_bundles l
  join public.fg_transfers x on x.id = l.transfer_id and x.company_id = l.company_id
  join public.inventory_locations il on il.id = x.to_location_id and il.company_id = x.company_id
  where l.company_id = b.company_id and l.bundle_id = b.id and l.state in ('sent','received')
  order by (l.state = 'sent') desc, l.received_at desc nulls last limit 1) fg on true
left join lateral (
  select ls.id as session_id, ls.vehicle_number
  from public.loading_scans ys join public.loading_sessions ls on ls.id = ys.session_id and ls.company_id = ys.company_id
  where ys.company_id = b.company_id and ys.bundle_id = b.id and ys.outcome = 'loaded' and ys.removed_at is null and ls.status = 'open'
  limit 1) ld on b.dispatch_id is null
left join lateral (
  select i.id, i.invoice_number, i.status from public.invoices i
  where i.company_id = b.company_id and i.dispatch_id = b.dispatch_id and i.deleted_at is null and i.status not in ('draft','cancelled')
  order by i.created_at desc limit 1) inv on b.dispatch_id is not null;
revoke all on private.olo_bundle_register from public, anon, authenticated;

-- An issued (not draft, not cancelled) tax invoice for the dispatch.
create or replace function private.olo_dispatch_invoice(p_company uuid, p_dispatch uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', i.id, 'invoice_number', i.invoice_number, 'status', i.status, 'invoice_date', i.invoice_date)
  from public.invoices i where i.company_id = p_company and i.dispatch_id = p_dispatch and i.deleted_at is null and i.status not in ('draft','cancelled')
  order by i.created_at desc limit 1
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Packaging release (route-aware) and the packing specification
-- ---------------------------------------------------------------------------------------------------------------
-- What a job releases to packaging, from its Phase 5 quality flow: final-QC accepted kilograms for a route that needs
-- ageing, first-stage approved kilograms otherwise. Packed = packing lines, prepared bundles and stock made from the job
-- (or started packaging, whichever is larger). Held material stays released but is not packed while held.
create or replace function private.olo_packing_release(p_flow jsonb) returns jsonb
language sql immutable set search_path = public, private as $$
  select case when p_flow is null then null else jsonb_build_object(
    'basis', case when (p_flow ->> 'held_kg')::numeric > (p_flow ->> 'tolerance_kg')::numeric then 'held'
      when p_flow -> 'route' ->> 'state' = 'required' then 'final_qc'
      when p_flow -> 'route' ->> 'state' = 'undocumented' then 'first_qc_route_undocumented' else 'first_qc' end,
    'release_kg', x.release_kg, 'packed_kg', (p_flow ->> 'packed_kg')::numeric,
    'to_pack_kg', greatest(x.release_kg - (p_flow ->> 'packed_kg')::numeric, 0)) end
  from (select case when p_flow -> 'route' ->> 'state' = 'required' then (p_flow ->> 'final_accepted_kg')::numeric
    else (p_flow ->> 'approved_kg')::numeric end as release_kg) x
$$;

-- The customer's active packing specification, else the company default (customer not set).
create or replace function private.olo_packing_spec(p_company uuid, p_customer uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('source', case when s.customer_id is null then 'company' else 'customer' end, 'revision', s.revision, 'wrapping', s.wrapping,
    'max_bundle_kg', s.max_bundle_kg, 'max_pieces', s.max_pieces, 'interleaving_paper', s.interleaving_paper, 'battens_per_bundle', s.battens_per_bundle,
    'notes', s.notes)
  from public.customer_packing_specs s
  where s.company_id = p_company and s.status = 'active' and (s.customer_id = p_customer or s.customer_id is null)
  order by (s.customer_id is null), s.revision desc limit 1
$$;

create or replace function private.olo_packing_spec_text(p_spec jsonb) returns text
language sql immutable set search_path = public, private as $$
  select case when p_spec is null then 'No packing specification is recorded for this customer or the company; follow the order''s packing instructions.'
    else concat('Packing (', case when p_spec ->> 'source' = 'customer' then 'customer' else 'company default' end, ' specification rev ', p_spec ->> 'revision', '): ',
      replace(p_spec ->> 'wrapping', '_', ' '),
      '; ' || 'max ' || to_char((p_spec ->> 'max_bundle_kg')::numeric, 'FM99,990') || ' kg per bundle',
      '; ' || 'max ' || (p_spec ->> 'max_pieces') || ' pieces per bundle',
      case when (p_spec ->> 'interleaving_paper')::boolean then '; interleaving paper' else '' end,
      case when (p_spec ->> 'battens_per_bundle')::integer > 0 then '; ' || (p_spec ->> 'battens_per_bundle') || ' battens per bundle' else '' end,
      '. ' || nullif(btrim(p_spec ->> 'notes'), '')) end
$$;

-- First-stage QC of a job that needs artificial ageing releases the material to the ageing team, not to packaging; the
-- final QC after ageing releases it to packaging (below). Every other inspection keeps its packaging handoff.
alter function private.handoff_for_inspection(uuid, uuid) rename to handoff_for_inspection_p5;
create or replace function private.handoff_for_inspection(p_company uuid, p_inspection uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare v_job uuid; v_finishing uuid;
begin
  select qi.production_job_id, qi.finishing_job_id into v_job, v_finishing from public.quality_inspections qi where qi.id = p_inspection and qi.company_id = p_company;
  -- First-stage QC is the job's own stage: as extruded for mill finish, after finishing for coated or anodized output.
  if v_job is not null and (v_finishing is not null) = private.olo_job_qc_after_finishing(p_company, v_job)
     and private.olo_job_route(p_company, v_job) ->> 'state' = 'required' then
    return 'not_eligible';
  end if;
  return private.handoff_for_inspection_p5(p_company, p_inspection);
end;
$$;

-- The handoff's source is the job's current first-stage approval (handoff sources are QC inspections, finishing jobs
-- or packaging jobs), so the existing acceptance checks apply: the approval still stands, the job and order are live
-- and a packaging job is open. Its key names the final QC record, so each release is raised once. It runs at commit:
-- a final QC that also rejects kilograms reverses approvals (oldest first) in the same transaction, and the source must
-- be an approval that still stands afterwards.
create or replace function private.olo_after_final_qc_release() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_job record; v_spec jsonb; v_source uuid;
begin
  if coalesce(new.accepted_kg, 0) <= 0 then return null; end if;
  begin
    select pj.job_number, o.order_number, o.customer_id, pr.profile_code into v_job
      from public.production_jobs pj left join public.orders o on o.id = pj.order_id and o.company_id = pj.company_id
      left join public.aluminium_profiles pr on pr.id = pj.profile_id
      where pj.id = new.production_job_id and pj.company_id = new.company_id;
    select qi.id into v_source from public.quality_inspections qi
      where qi.company_id = new.company_id and qi.production_job_id = new.production_job_id and qi.status = 'approved'
        and (qi.finishing_job_id is not null) = private.olo_job_qc_after_finishing(new.company_id, new.production_job_id)
      order by qi.inspection_date desc, qi.created_at desc, qi.id limit 1;
    if v_source is null then return null; end if;
    v_spec := private.olo_packing_spec(new.company_id, v_job.customer_id);
    perform private.raise_department_handoff(new.company_id, 'final_qc_release:' || new.id, 'packaging', 'quality_inspection', v_source, new.accepted_kg, new.order_id,
      concat('Pack ', to_char(new.accepted_kg, 'FM999999990.000'), ' kg released by final QC', ' · ' || v_job.job_number, ' · ' || v_job.order_number),
      concat('Final QC ', new.record_number, ' released ', to_char(new.accepted_kg, 'FM999999990.000'), ' kg of job ', coalesce(v_job.job_number, '-'),
        ' (profile ', coalesce(v_job.profile_code, '-'), coalesce(', verified temper ' || new.temper_verified, ''), ') after ageing. ',
        private.olo_packing_spec_text(v_spec)));
  exception when others then
    insert into public.olo_engine_errors(company_id, source, message) values (new.company_id, 'final_qc_records:release_handoff', left(sqlerrm, 500));
  end;
  return null;
end;
$$;
create constraint trigger zzz_olo_p6_release after insert on public.final_qc_records deferrable initially deferred
  for each row execute function private.olo_after_final_qc_release();

-- ---------------------------------------------------------------------------------------------------------------
-- Bundle trace
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_bundle_trace(p_company uuid, p_bundle uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare reg record; v_gaps text[] := '{}'; v_job jsonb; v_billets jsonb; v_qc jsonb; v_route jsonb; v_ageing jsonb; v_final jsonb; v_pack jsonb; v_labels jsonb;
  v_custody jsonb; v_loading jsonb; v_disp jsonb; v_invoices jsonb; v_stock jsonb; v_hold text; v_issued jsonb; v_by text; v_profile jsonb;
begin
  select * into reg from private.olo_bundle_register x where x.company_id = p_company and x.id = p_bundle;
  if reg.id is null then return null; end if;
  select coalesce(nullif(u.full_name, ''), 'Employee') into v_by from public.app_users u where u.id = reg.recorded_by;
  select jsonb_build_object('id', pr.id, 'profile_code', pr.profile_code, 'profile_name', pr.profile_name, 'alloy', pr.alloy, 'temper', pr.temper)
    into v_profile from public.aluminium_profiles pr where pr.id = reg.profile_id;
  if reg.stock_batch_id is not null then
    select jsonb_build_object('id', sb.id, 'bundle_number', sb.bundle_number, 'origin_type', sb.origin_type, 'qc_status', sb.qc_status, 'location', sb.location,
      'total_weight_kg', sb.total_weight_kg, 'created_at', sb.created_at) into v_stock from public.profile_stock_batches sb where sb.id = reg.stock_batch_id;
  end if;
  if reg.job_id is not null then
    select jsonb_build_object('id', pj.id, 'job_number', pj.job_number, 'status', pj.status, 'planned_date', pj.planned_date, 'completed_at', pj.completed_at,
      'actual_quantity_kg', pj.actual_quantity_kg, 'machine_name', m.machine_name, 'die_id', pj.die_id, 'die_number', dd.die_number)
      into v_job from public.production_jobs pj left join public.machines m on m.id = pj.machine_id left join public.dies dd on dd.id = pj.die_id
      where pj.id = reg.job_id;
    select coalesce(jsonb_agg(jsonb_build_object('billet_code', fb.billet_code, 'alloy', fb.alloy, 'temper', fb.temper, 'weight_kg', coalesce(fb.measured_weight_kg, fb.weight_kg),
        'source_type', fb.source_type, 'batch_number', coalesce(fba.batch_number, ob.batch_number), 'heat_number', fba.heat_number, 'issued_at', bi.issued_at)
        order by bi.issued_at, fb.billet_code), '[]'::jsonb)
      into v_billets
      from (select * from public.production_billet_issues where company_id = p_company and production_job_id = reg.job_id order by issued_at limit 60) bi
      join public.foundry_billets fb on fb.id = bi.billet_id
      left join public.foundry_batches fba on fba.id = fb.foundry_batch_id
      left join public.outsourced_billet_batches ob on ob.id = fb.outsourced_batch_id;
    if jsonb_array_length(v_billets) = 0 then v_gaps := v_gaps || format('No billet issue is recorded for job %s; its metal source is not linked.', coalesce(v_job ->> 'job_number', '-')); end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', qi.id, 'batch_number', qi.batch_number, 'status', qi.status, 'quantity_kg', qi.quantity_checked_kg,
        'inspected_at', qi.inspection_date, 'inspector', qi.inspector_name, 'from_reversal', qi.reversal_id is not null) order by qi.inspection_date, qi.id), '[]'::jsonb)
      into v_qc from (select * from public.quality_inspections where company_id = p_company and production_job_id = reg.job_id
          and (finishing_job_id is not null) = private.olo_job_qc_after_finishing(p_company, reg.job_id)
        order by inspection_date limit 40) qi;
    if not exists (select 1 from jsonb_array_elements(v_qc) e where e ->> 'status' = 'approved') then
      v_gaps := v_gaps || 'No first-stage QC approval is recorded for the job of this bundle.'::text;
    end if;
    v_route := private.olo_job_route(p_company, reg.job_id);
    select coalesce(jsonb_agg(jsonb_build_object('batch_id', tb.id, 'batch_number', tb.batch_number, 'status', tb.status, 'recipe', tr.recipe_code || ' rev ' || tr.revision,
        'loaded_kg', ti.quantity_kg, 'accepted_kg', ti.accepted_kg, 'rejected_kg', ti.rejected_kg, 'started_at', tb.started_at, 'ended_at', tb.ended_at, 'reviewed_at', tb.reviewed_at)
        order by tb.created_at), '[]'::jsonb)
      into v_ageing from public.treatment_inputs ti join public.treatment_batches tb on tb.id = ti.batch_id and tb.company_id = ti.company_id
      join public.treatment_recipes tr on tr.id = tb.recipe_id and tr.company_id = tb.company_id
      where ti.company_id = p_company and ti.production_job_id = reg.job_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'record_number', f.record_number, 'accepted_kg', f.accepted_kg, 'rejected_kg', f.rejected_kg,
        'method', f.method, 'certificate_reference', f.certificate_reference, 'temper_verified', f.temper_verified, 'recorded_at', f.recorded_at) order by f.recorded_at), '[]'::jsonb)
      into v_final from public.final_qc_records f where f.company_id = p_company and f.production_job_id = reg.job_id;
    if v_route ->> 'state' = 'required' and jsonb_array_length(v_final) = 0 then
      v_gaps := v_gaps || 'The route of this job needs artificial ageing, and no final QC after ageing is recorded.'::text;
    elsif v_route ->> 'state' = 'undocumented' then
      v_gaps := v_gaps || 'The profile does not document whether the material is aged; confirm the route.'::text;
    end if;
    v_hold := private.olo_job_containment(p_company, reg.job_id);
    select coalesce(jsonb_agg(jsonb_build_object('id', pk.id, 'packaging_number', pk.packaging_number, 'status', pk.status, 'weight_kg', pk.profile_weight_kg, 'pieces', pk.pieces)
        order by pk.created_at), '[]'::jsonb)
      into v_pack from public.packaging_jobs pk where pk.company_id = p_company and pk.production_job_id = reg.job_id and pk.status <> 'cancelled';
  elsif reg.source_kind = 'production' then
    v_gaps := v_gaps || 'The production job of this bundle is not available.'::text;
  elsif reg.stock_batch_id is not null then
    v_gaps := v_gaps || format('Packed from stock bundle %s, which records no production job; its earlier history is not linked.', coalesce(reg.stock_bundle_number, '-'));
  end if;
  select jsonb_build_object('prints', count(*), 'last_printed_at', max(lp.printed_at), 'active', count(*) filter (where lp.status = 'active'))
    into v_labels from public.packing_label_prints lp where lp.company_id = p_company and lp.bundle_id = reg.id;
  select coalesce(jsonb_agg(jsonb_build_object('transfer_id', x.id, 'transfer_number', x.transfer_number, 'location', il.location_name, 'state', l.state,
      'sent_at', x.sent_at, 'received_at', l.received_at, 'received_by', ru.full_name, 'sent_by', su.full_name) order by x.sent_at), '[]'::jsonb)
    into v_custody from public.fg_transfer_bundles l join public.fg_transfers x on x.id = l.transfer_id and x.company_id = l.company_id
    join public.inventory_locations il on il.id = x.to_location_id and il.company_id = x.company_id
    left join public.app_users ru on ru.id = l.received_by left join public.app_users su on su.id = x.sent_by
    where l.company_id = p_company and l.bundle_id = reg.id;
  select coalesce(jsonb_agg(jsonb_build_object('vehicle_number', ls.vehicle_number, 'scanned_at', ys.scanned_at, 'session_status', ls.status, 'removed', ys.removed_at is not null)
      order by ys.scanned_at), '[]'::jsonb)
    into v_loading from public.loading_scans ys join public.loading_sessions ls on ls.id = ys.session_id and ls.company_id = ys.company_id
    where ys.company_id = p_company and ys.bundle_id = reg.id and ys.outcome = 'loaded';
  if reg.dispatch_id is not null then
    select jsonb_build_object('id', d.id, 'dispatch_number', d.dispatch_number, 'dispatch_date', d.dispatch_date, 'delivery_status', d.delivery_status,
      'vehicle_number', d.vehicle_number, 'transporter_name', d.transporter_name, 'lr_number', d.lr_number, 'eway_bill_number', d.eway_bill_number,
      'left_at', d.actual_dispatched_at, 'delivered_at', d.delivered_at)
      into v_disp from public.dispatches d where d.id = reg.dispatch_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'invoice_number', i.invoice_number, 'status', i.status, 'invoice_date', i.invoice_date, 'issued_at', i.issued_at)
        order by i.created_at), '[]'::jsonb)
      into v_invoices from public.invoices i where i.company_id = p_company and i.dispatch_id = reg.dispatch_id and i.deleted_at is null;
    v_issued := private.olo_dispatch_invoice(p_company, reg.dispatch_id);
    if v_issued is null and reg.actual_dispatched_at is not null then
      v_gaps := v_gaps || 'No tax invoice is issued yet for the dispatch of this bundle.'::text;
    end if;
  end if;
  return jsonb_build_object(
    'bundle', jsonb_build_object('id', reg.id, 'bundle_number', reg.bundle_number, 'state', reg.state, 'source_kind', reg.source_kind, 'pieces', reg.number_of_pieces,
      'net_length_m', reg.net_length_m, 'gross_kg', reg.gross_weight_kg, 'tare_kg', reg.tare_weight_kg, 'net_kg', reg.net_kg, 'recorded_at', reg.recorded_at, 'recorded_by', v_by,
      'location', reg.location_name, 'transfer_number', reg.transfer_number, 'loaded_vehicle', reg.loaded_vehicle),
    'order', jsonb_build_object('id', reg.order_id, 'order_number', reg.order_number, 'customer', private.ap3_customer_name(reg.customer_id), 'stage', reg.order_stage),
    'profile', v_profile, 'stock', v_stock, 'job', v_job, 'route', v_route, 'billets', coalesce(v_billets, '[]'::jsonb), 'qc', coalesce(v_qc, '[]'::jsonb),
    'ageing', coalesce(v_ageing, '[]'::jsonb), 'final_qc', coalesce(v_final, '[]'::jsonb), 'hold', v_hold, 'packaging', coalesce(v_pack, '[]'::jsonb), 'labels', v_labels,
    'custody', v_custody, 'loading', v_loading, 'dispatch', v_disp, 'invoices', coalesce(v_invoices, '[]'::jsonb), 'invoice', v_issued, 'gaps', to_jsonb(v_gaps));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Guards: a bundle on an open transfer, or (control on) not received in the finished-goods area, is not loaded
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_guard_fg_custody() returns trigger language plpgsql security definer set search_path = public, private as $$
declare reg record; v_prefix text := case when tg_table_name = 'loading_scans' then 'AP: ' else '' end;
begin
  if tg_table_name = 'loading_scans' then
    if new.outcome is distinct from 'loaded' or new.bundle_id is null then return new; end if;
    select * into reg from private.olo_bundle_register x where x.company_id = new.company_id and x.id = new.bundle_id;
  else
    -- Lock the bundle first (the loading scan already does), so a transfer sent at the same moment is serialised
    -- against this dispatch line and its custody is read after it commits.
    perform 1 from public.prepared_physical_bundles b where b.company_id = new.company_id and upper(b.bundle_number) = upper(btrim(new.bundle_number))
      and b.dispatch_id is null for update;
    select * into reg from private.olo_bundle_register x where x.company_id = new.company_id and upper(x.bundle_number) = upper(btrim(new.bundle_number)) and x.dispatch_id is null;
  end if;
  if reg.id is null or reg.source_kind = 'dealer_stock' then return new; end if;
  if reg.line_state = 'sent' then
    raise exception '%', format('%sBundle %s is on finished-goods transfer %s to %s. Scan it in there, or cancel the transfer, before loading it.',
      v_prefix, reg.bundle_number, reg.transfer_number, reg.location_name) using errcode = '23514';
  end if;
  if (private.olo_settings_for(new.company_id)).enforce_fg_receipt and reg.line_state is distinct from 'received' then
    raise exception '%', format('%sBundle %s has not been received in the finished-goods area. Send it there on a finished-goods transfer and scan it in before loading it.',
      v_prefix, reg.bundle_number) using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger zzz_olo_p6_guard_fg before insert on public.loading_scans for each row execute function private.olo_guard_fg_custody();
create trigger zzz_olo_p6_guard_fg before insert on public.packing_list_items for each row execute function private.olo_guard_fg_custody();

-- ---------------------------------------------------------------------------------------------------------------
-- Evaluation: finished-goods transfer and receipt work, and the invoice of a dispatch that left
-- ---------------------------------------------------------------------------------------------------------------
-- Packed bundles of an order not yet sent to the finished-goods area, older than the reminder period.
create or replace function private.olo_order_untransferred(p_company uuid, p_order uuid, p_hours integer) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('bundles', count(*), 'kg', coalesce(sum(x.net_kg), 0), 'oldest', min(x.recorded_at),
    'tags', coalesce(string_agg(x.bundle_number, ', ' order by x.recorded_at) filter (where x.rn <= 12), ''))
  from (select r.*, row_number() over (order by r.recorded_at, r.id) rn from private.olo_bundle_register r
    where r.company_id = p_company and r.order_id = p_order and r.state = 'packed' and r.source_kind <> 'dealer_stock'
      and r.recorded_at < clock_timestamp() - make_interval(hours => p_hours)) x
$$;

create or replace function private.olo_fg_receipt_task(p_company uuid, p_transfer uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare v_tr record; v_lines record;
begin
  select x.*, il.location_name, coalesce(nullif(su.full_name, ''), 'Employee') sender into v_tr from public.fg_transfers x
    join public.inventory_locations il on il.id = x.to_location_id and il.company_id = x.company_id left join public.app_users su on su.id = x.sent_by
    where x.id = p_transfer and x.company_id = p_company;
  if v_tr.id is null or v_tr.status <> 'in_transit' then return 0; end if;
  select (array_agg(l.order_id order by o.order_number))[1] first_order, string_agg(distinct o.order_number, ', ') orders,
    string_agg(b.bundle_number, ', ' order by b.bundle_number) filter (where l.state = 'sent') tags
    into v_lines from public.fg_transfer_bundles l join public.orders o on o.id = l.order_id join public.prepared_physical_bundles b on b.id = l.bundle_id
    where l.transfer_id = p_transfer;
  return private.olo_create_task(p_company, 'fg_receipt', 'dispatch', 1, v_lines.first_order, null, p_transfer,
    format('Receive %s bundle(s) in %s: %s', v_tr.bundle_count, v_tr.location_name, v_tr.transfer_number),
    format('Transfer %s from packaging: %s bundle(s), %s net (order %s), sent by %s at %s to %s. Scan each bundle tag on the transfer screen as it arrives; any bundle that does not arrive is recorded as missing when the transfer is closed. Tags: %s.',
      v_tr.transfer_number, v_tr.bundle_count, private.olo_fmt_kg(v_tr.net_kg), coalesce(v_lines.orders, '-'), v_tr.sender,
      to_char(v_tr.sent_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), v_tr.location_name, left(coalesce(v_lines.tags, '-'), 600)),
    'high', '/packaging/fg-transfers/' || p_transfer, null);
end;
$$;

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

-- Verification of the Phase 6 task kinds (earlier kinds stay with their verifiers).
alter function private.olo_verify_tasks(uuid) rename to olo_verify_tasks_p5;
create or replace function private.olo_verify_tasks(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare v_task public.tasks%rowtype; v_n integer := private.olo_verify_tasks_p5(p_company); v_stage text; v_u jsonb; v_status text; v_missing integer; v_inv jsonb;
  v_disp record; v_hours integer := (private.olo_settings_for(p_company)).fg_transfer_hours;
begin
  for v_task in select * from public.tasks x where x.company_id = p_company and x.workflow_key is not null and x.status in ('open','in_progress')
      and x.workflow_kind in ('fg_transfer','fg_receipt','dispatch_invoice') order by x.created_at for update skip locked loop
    if v_task.workflow_kind = 'fg_transfer' then
      select current_stage into v_stage from public.orders where id = v_task.workflow_source_id;
      if v_stage is null or v_stage in ('closed','cancelled') then
        perform private.olo_close_task(v_task, false, 'Withdrawn: the order is ' || coalesce(v_stage, 'unavailable'), jsonb_build_object('order_stage', v_stage)); v_n := v_n + 1;
        continue;
      end if;
      v_u := private.olo_order_untransferred(p_company, v_task.workflow_source_id, v_hours);
      if (v_u ->> 'bundles')::integer = 0 then
        perform private.olo_close_task(v_task, true, 'Verified: no packed bundle of the order is waiting outside the finished-goods area', v_u); v_n := v_n + 1;
      end if;
    elsif v_task.workflow_kind = 'fg_receipt' then
      select status into v_status from public.fg_transfers where id = v_task.workflow_source_id;
      if v_status is null or v_status = 'cancelled' then
        perform private.olo_close_task(v_task, false, 'Withdrawn: the transfer was cancelled', jsonb_build_object('status', v_status)); v_n := v_n + 1;
      elsif v_status = 'received' then
        perform private.olo_close_task(v_task, true, 'Verified: every bundle of the transfer was scanned in', jsonb_build_object('status', v_status)); v_n := v_n + 1;
      elsif v_status = 'closed_short' then
        select count(*) into v_missing from public.fg_transfer_bundles where transfer_id = v_task.workflow_source_id and state = 'missing';
        perform private.olo_close_task(v_task, true, format('Verified: transfer closed with %s bundle(s) missing (factory management alerted)', v_missing),
          jsonb_build_object('status', v_status, 'missing', v_missing)); v_n := v_n + 1;
      end if;
    else
      select d.delivery_status, o.current_stage into v_disp from public.dispatches d join public.orders o on o.id = d.order_id where d.id = v_task.workflow_source_id;
      v_inv := private.olo_dispatch_invoice(p_company, v_task.workflow_source_id);
      if v_inv is not null then
        perform private.olo_close_task(v_task, true, format('Verified: invoice %s issued for the dispatch', coalesce(v_inv ->> 'invoice_number', '-')), v_inv); v_n := v_n + 1;
      elsif v_disp.delivery_status is null or v_disp.delivery_status in ('returned','damaged') or v_disp.current_stage = 'cancelled' then
        perform private.olo_close_task(v_task, false, 'Withdrawn: the dispatch is ' || coalesce(v_disp.delivery_status, 'unavailable') || ' or the order was cancelled',
          jsonb_build_object('delivery_status', v_disp.delivery_status, 'order_stage', v_disp.current_stage)); v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

alter function private.olo_run_all(uuid, text) rename to olo_run_all_p5;
create or replace function private.olo_run_all(p_company uuid, p_source text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v jsonb := private.olo_run_all_p5(p_company, p_source);
begin
  return v || jsonb_build_object('shipment_tasks', private.olo_evaluate_shipment(p_company), 'verified_after_shipment', private.olo_verify_tasks(p_company));
end;
$$;

-- Event-driven evaluation for bundles, dispatches and invoices (a loading scan changes nothing a task checks until the
-- dispatch consumes the bundle) (failures logged, never blocking).
create or replace function private.olo_after_shipment_change() returns trigger language plpgsql security definer set search_path = public, private as $$
declare c record;
begin
  if coalesce(current_setting('olo.engine', true), '') = 'running' then return null; end if;
  perform set_config('olo.engine', 'running', true);
  for c in select id from public.companies order by created_at loop
    begin
      perform private.olo_evaluate_shipment(c.id);
      perform private.olo_verify_tasks(c.id);
    exception when others then
      insert into public.olo_engine_errors(company_id, source, message) values (c.id, left(tg_table_name || ':phase6', 80), left(sqlerrm, 500));
    end;
  end loop;
  perform set_config('olo.engine', '', true);
  return null;
end;
$$;
create trigger zzz_olo_p6_bundles after insert or update of dispatch_id on public.prepared_physical_bundles for each statement execute function private.olo_after_shipment_change();
create trigger zzz_olo_p6_dispatches after update of delivery_status, actual_dispatched_at on public.dispatches for each statement execute function private.olo_after_shipment_change();
create trigger zzz_olo_p6_invoices after insert or update of status, dispatch_id, deleted_at on public.invoices for each statement execute function private.olo_after_shipment_change();

-- ---------------------------------------------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_fg_transfer_json(p_company uuid, p_transfer uuid, p_actor uuid, p_role text) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', x.id, 'transfer_number', x.transfer_number, 'status', x.status, 'location_id', x.to_location_id, 'location', il.location_name,
    'location_code', il.location_code, 'bundle_count', x.bundle_count, 'net_kg', x.net_kg, 'note', x.note, 'sent_by', x.sent_by, 'sent_by_name', su.full_name, 'sent_at', x.sent_at,
    'closed_by_name', cu.full_name, 'closed_at', x.closed_at, 'close_note', x.close_note,
    'received', (select count(*) from public.fg_transfer_bundles l where l.transfer_id = x.id and l.state = 'received'),
    'remaining', (select count(*) from public.fg_transfer_bundles l where l.transfer_id = x.id and l.state = 'sent'),
    'missing', (select count(*) from public.fg_transfer_bundles l where l.transfer_id = x.id and l.state = 'missing'),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('bundle_id', l.bundle_id, 'bundle_number', b.bundle_number, 'order_id', l.order_id, 'order_number', o.order_number,
        'job_number', reg.job_number, 'profile_code', reg.profile_code, 'pieces', b.number_of_pieces, 'net_kg', l.net_kg, 'state', l.state,
        'received_by_name', ru.full_name, 'received_at', l.received_at) order by l.state = 'sent' desc, b.bundle_number), '[]'::jsonb)
      from public.fg_transfer_bundles l join public.prepared_physical_bundles b on b.id = l.bundle_id join public.orders o on o.id = l.order_id
      left join private.olo_bundle_register reg on reg.id = l.bundle_id left join public.app_users ru on ru.id = l.received_by where l.transfer_id = x.id),
    'can_receive', x.status = 'in_transit' and p_role in ('owner','admin','factory_manager','dispatch_manager','dispatch','inventory_manager') and (x.sent_by <> p_actor or p_role = 'owner'),
    'can_cancel', x.status = 'in_transit' and (x.sent_by = p_actor or p_role in ('owner','admin','factory_manager','dispatch_manager'))
      and not exists (select 1 from public.fg_transfer_bundles l where l.transfer_id = x.id and l.state = 'received'))
  from public.fg_transfers x join public.inventory_locations il on il.id = x.to_location_id and il.company_id = x.company_id
  left join public.app_users su on su.id = x.sent_by left join public.app_users cu on cu.id = x.closed_by
  where x.id = p_transfer and x.company_id = p_company
$$;

-- Resolves a scanned or typed bundle tag (or an EO2 label) to a prepared bundle of the company.
create or replace function private.olo_bundle_by_tag(p_company uuid, p_tag text) returns uuid
language plpgsql stable security definer set search_path = public, private as $$
declare v_tag text := btrim(coalesce(p_tag, '')); v_id uuid;
begin
  if v_tag ~* '^EO2:(dispatch_package|bundle):[0-9a-f-]{36}:' then
    select b.id into v_id from public.prepared_physical_bundles b where b.company_id = p_company and b.id = split_part(v_tag, ':', 3)::uuid;
    return v_id;
  end if;
  select b.id into v_id from public.prepared_physical_bundles b where b.company_id = p_company and upper(b.bundle_number) = upper(v_tag);
  return v_id;
end;
$$;

-- Keeps the engine from re-running inside its own command and records failures without blocking the command.
create or replace function private.olo_shipment_refresh(p_company uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare v_was text := coalesce(current_setting('olo.engine', true), '');
begin
  perform set_config('olo.engine', 'running', true);
  begin
    perform private.olo_evaluate_shipment(p_company);
    perform private.olo_verify_tasks(p_company);
  exception when others then
    insert into public.olo_engine_errors(company_id, source, message) values (p_company, 'packaging_flow_command', left(sqlerrm, 500));
  end;
  perform set_config('olo.engine', v_was, true);
end;
$$;

create or replace function public.packaging_flow_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_p jsonb := coalesce(p_payload, '{}'::jsonb); a jsonb; v_company uuid; v_actor uuid; v_role text; v_page integer; v_search text; v_sort text; v_dir text; v_view text;
  v_total integer; v_rows jsonb; v_tol numeric; v_id uuid; v_job public.production_jobs%rowtype; v_flow jsonb; v_rel jsonb; v_tr public.fg_transfers%rowtype; v_loc record;
  v_ids uuid[]; v_bad text; v_kg numeric; v_n integer; v_number text; v_bundle uuid; v_line record; v_reg record; v_tag text; v_note text; v_orders uuid[]; v_order uuid;
  v_missing text; v_not_invoiced boolean;
  c_send constant text[] := array['owner','admin','factory_manager','production_manager','production','dispatch_manager','dispatch'];
  c_receive constant text[] := array['owner','admin','factory_manager','dispatch_manager','dispatch','inventory_manager'];
begin
  if p_command is null or jsonb_typeof(v_p) is distinct from 'object' then raise exception 'Invalid packaging request' using errcode = '22023'; end if;
  a := private.olo_actor(private.olo_reader_roles());
  v_company := (a ->> 'company')::uuid; v_actor := (a ->> 'actor')::uuid; v_role := a ->> 'role';
  v_tol := (private.olo_settings_for(v_company)).reproduction_tolerance_kg;
  begin
    v_page := coalesce((v_p ->> 'page')::integer, 1);
  exception when others then raise exception 'Invalid page' using errcode = '22023';
  end;
  if v_page < 1 or v_page > 100000 then raise exception 'Invalid page' using errcode = '22023'; end if;
  v_search := lower(btrim(coalesce(v_p ->> 'search', '')));
  if length(v_search) > 80 then raise exception 'The search is too long' using errcode = '22023'; end if;
  v_dir := coalesce(v_p ->> 'direction', 'desc');
  if v_dir not in ('asc','desc') then raise exception 'Invalid sort direction' using errcode = '22023'; end if;

  -- ---------------------------------------------------------------- packaging release
  if p_command = 'release.queue' then
    if v_p - array['view','page','search','sort','direction'] <> '{}'::jsonb then raise exception 'Invalid release request' using errcode = '22023'; end if;
    v_view := coalesce(v_p ->> 'view', 'to_pack'); v_sort := coalesce(v_p ->> 'sort', 'completed_at');
    if v_view not in ('to_pack','held','all') or v_sort not in ('completed_at','job_number','to_pack_kg','release_kg') then raise exception 'Invalid release view' using errcode = '22023'; end if;
    with jobs as (
      select pj.id, pj.job_number, pj.order_id, o.order_number, o.customer_id, pr.profile_code, pj.status, coalesce(pj.completed_at, pj.updated_at) done_at,
        private.olo_job_quality_flow(v_company, pj.id) k
      from public.production_jobs pj join public.orders o on o.id = pj.order_id and o.company_id = pj.company_id
      left join public.aluminium_profiles pr on pr.id = pj.profile_id
      where pj.company_id = v_company and pj.status in ('in_progress','completed','on_hold') and coalesce(pj.actual_quantity_kg, 0) > 0
        and coalesce(pj.completed_at, pj.updated_at, pj.created_at) > now() - interval '120 days'
        and o.deleted_at is null and o.current_stage not in ('closed','cancelled') and o.opening_cutover_id is null
        and (v_search = '' or position(v_search in lower(concat_ws(' ', pj.job_number, o.order_number, pr.profile_code))) > 0)
    ), rel as (
      select j.*, private.olo_packing_release(j.k) rl from jobs j
    ), filtered as (
      select rel.*, (rl ->> 'release_kg')::numeric release_kg, (rl ->> 'to_pack_kg')::numeric to_pack_kg from rel
      where case v_view when 'to_pack' then rl ->> 'basis' <> 'held' and (rl ->> 'to_pack_kg')::numeric > v_tol
        when 'held' then rl ->> 'basis' = 'held' else true end
    ), sorted as (
      select f.*, case v_sort when 'to_pack_kg' then f.to_pack_kg when 'release_kg' then f.release_kg when 'completed_at' then extract(epoch from f.done_at) end sort_num,
        case when v_sort = 'job_number' then f.job_number end sort_text, count(*) over () total_rows from filtered f
    )
    select coalesce(max(s2.total_rows), 0)::integer, coalesce(jsonb_agg(jsonb_build_object('job_id', s2.id, 'job_number', s2.job_number, 'order_id', s2.order_id,
        'order_number', s2.order_number, 'customer', private.ap3_customer_name(s2.customer_id), 'profile_code', s2.profile_code, 'job_status', s2.status, 'completed_at', s2.done_at,
        'route', s2.k -> 'route' ->> 'state', 'stage', s2.k ->> 'stage', 'basis', s2.rl ->> 'basis', 'release_kg', s2.release_kg, 'packed_kg', s2.rl -> 'packed_kg',
        'to_pack_kg', s2.to_pack_kg, 'held_kg', s2.k -> 'held_kg', 'containment', private.olo_job_containment(v_company, s2.id))
        order by s2.rn), '[]'::jsonb)
      into v_total, v_rows
      from (select sorted.*, row_number() over (order by
          case when v_dir = 'asc' then sorted.sort_num end asc nulls last, case when v_dir = 'desc' then sorted.sort_num end desc nulls last,
          case when v_dir = 'asc' then sorted.sort_text end asc, case when v_dir = 'desc' then sorted.sort_text end desc, sorted.id) rn from sorted) s2
      where s2.rn > (v_page - 1) * 10 and s2.rn <= v_page * 10;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', v_total, 'rows', v_rows, 'view', v_view);
  end if;

  if p_command = 'release.get' then
    if v_p - array['job_id'] <> '{}'::jsonb then raise exception 'Invalid release request' using errcode = '22023'; end if;
    begin v_id := (v_p ->> 'job_id')::uuid; exception when others then raise exception 'Choose a production job' using errcode = '22023'; end;
    select * into v_job from public.production_jobs where id = v_id and company_id = v_company;
    if v_job.id is null then raise exception 'The production job is not available' using errcode = 'P0001'; end if;
    v_flow := private.olo_job_quality_flow(v_company, v_job.id);
    v_rel := private.olo_packing_release(v_flow);
    return jsonb_build_object('job', (select jsonb_build_object('id', v_job.id, 'job_number', v_job.job_number, 'status', v_job.status, 'completed_at', v_job.completed_at,
        'order_id', o.id, 'order_number', o.order_number, 'customer', private.ap3_customer_name(o.customer_id), 'expected_dispatch_date', o.expected_dispatch_date,
        'profile_code', pr.profile_code, 'profile_name', pr.profile_name, 'alloy', pr.alloy, 'temper', pr.temper, 'machine_name', m.machine_name)
        from public.orders o left join public.aluminium_profiles pr on pr.id = v_job.profile_id left join public.machines m on m.id = v_job.machine_id where o.id = v_job.order_id),
      'flow', v_flow, 'release', v_rel, 'containment', private.olo_job_containment(v_company, v_job.id),
      'spec', private.olo_packing_spec(v_company, (select customer_id from public.orders where id = v_job.order_id)),
      'spec_text', private.olo_packing_spec_text(private.olo_packing_spec(v_company, (select customer_id from public.orders where id = v_job.order_id))),
      'bundles', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'bundle_number', r.bundle_number, 'state', r.state, 'pieces', r.number_of_pieces, 'net_kg', r.net_kg,
          'location', r.location_name, 'dispatch_number', r.dispatch_number, 'invoice_number', r.invoice_number, 'recorded_at', r.recorded_at) order by r.recorded_at), '[]'::jsonb)
        from (select * from private.olo_bundle_register x where x.company_id = v_company and x.job_id = v_job.id order by x.recorded_at limit 100) r),
      'packaging_jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', pk.id, 'packaging_number', pk.packaging_number, 'status', pk.status, 'weight_kg', pk.profile_weight_kg,
          'pieces', pk.pieces, 'scheduled_date', pk.scheduled_date) order by pk.created_at), '[]'::jsonb)
        from public.packaging_jobs pk where pk.company_id = v_company and pk.production_job_id = v_job.id),
      'handoffs', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'quantity_kg', t.handoff_quantity_kg, 'source_type', t.handoff_source_type,
          'acceptance', ha.state, 'accepted_at', ha.accepted_at) order by t.created_at), '[]'::jsonb)
        from public.tasks t left join public.handoff_acceptances ha on ha.task_id = t.id
        where t.company_id = v_company and t.handoff_team = 'packaging' and t.handoff_source_type = 'quality_inspection'
          and t.handoff_source_id in (select qi.id from public.quality_inspections qi where qi.company_id = v_company and qi.production_job_id = v_job.id)),
      'can_record_bundles', v_role in ('owner','admin','factory_manager','dispatch_manager','dispatch','inventory_manager'));
  end if;

  -- ---------------------------------------------------------------- bundles
  if p_command = 'bundles.list' then
    if v_p - array['state','not_invoiced','page','search','sort','direction'] <> '{}'::jsonb then raise exception 'Invalid bundle request' using errcode = '22023'; end if;
    v_view := coalesce(v_p ->> 'state', 'all'); v_sort := coalesce(v_p ->> 'sort', 'recorded_at');
    v_not_invoiced := coalesce((v_p ->> 'not_invoiced')::boolean, false);
    if v_view not in ('all','packed','in_transfer','in_fg','loaded','dispatched','delivered') or v_sort not in ('recorded_at','bundle_number','net_kg') then
      raise exception 'Invalid bundle view' using errcode = '22023';
    end if;
    with f as (
      select r.*, count(*) over () total_rows,
        case v_sort when 'net_kg' then r.net_kg when 'recorded_at' then extract(epoch from r.recorded_at) end sort_num,
        case when v_sort = 'bundle_number' then r.bundle_number end sort_text
      from private.olo_bundle_register r
      where r.company_id = v_company and (v_view = 'all' or r.state = v_view)
        and (not v_not_invoiced or (r.dispatch_id is not null and r.invoice_id is null and r.actual_dispatched_at is not null))
        and (v_search = '' or position(v_search in lower(concat_ws(' ', r.bundle_number, r.order_number, r.job_number, r.profile_code, r.dispatch_number, r.invoice_number,
          r.transfer_number, r.stock_bundle_number))) > 0)
    ), s2 as (
      select f.*, row_number() over (order by case when v_dir = 'asc' then f.sort_num end asc nulls last, case when v_dir = 'desc' then f.sort_num end desc nulls last,
        case when v_dir = 'asc' then f.sort_text end asc, case when v_dir = 'desc' then f.sort_text end desc, f.id) rn from f
    )
    select coalesce(max(s2.total_rows), 0)::integer, coalesce(jsonb_agg(jsonb_build_object('id', s2.id, 'bundle_number', s2.bundle_number, 'state', s2.state,
        'order_id', s2.order_id, 'order_number', s2.order_number, 'job_id', s2.job_id, 'job_number', s2.job_number, 'profile_code', s2.profile_code, 'source_kind', s2.source_kind,
        'pieces', s2.number_of_pieces, 'net_kg', s2.net_kg, 'recorded_at', s2.recorded_at, 'location', s2.location_name, 'transfer_number', s2.transfer_number,
        'dispatch_id', s2.dispatch_id, 'dispatch_number', s2.dispatch_number, 'invoice_number', s2.invoice_number,
        'held', s2.job_id is not null and s2.dispatch_id is null and private.olo_job_containment(v_company, s2.job_id) is not null) order by s2.rn), '[]'::jsonb)
      into v_total, v_rows from s2 where s2.rn > (v_page - 1) * 10 and s2.rn <= v_page * 10;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', v_total, 'rows', v_rows, 'enforce_fg_receipt', (private.olo_settings_for(v_company)).enforce_fg_receipt);
  end if;

  if p_command in ('bundle.trace','bundle.resolve') then
    if v_p - array['bundle_id','tag'] <> '{}'::jsonb or not (v_p ?| array['bundle_id','tag']) then raise exception 'Scan or type a bundle tag' using errcode = '22023'; end if;
    if v_p ? 'bundle_id' then
      begin v_bundle := (v_p ->> 'bundle_id')::uuid; exception when others then raise exception 'Invalid bundle' using errcode = '22023'; end;
      perform 1 from public.prepared_physical_bundles where id = v_bundle and company_id = v_company;
      if not found then v_bundle := null; end if;
    else
      v_tag := btrim(v_p ->> 'tag');
      if length(v_tag) = 0 or length(v_tag) > 160 then raise exception 'Scan or type a bundle tag' using errcode = '22023'; end if;
      v_bundle := private.olo_bundle_by_tag(v_company, v_tag);
    end if;
    if v_bundle is null then
      -- A tag that only appears on a dispatch packing list (dispatched before bundles were recorded) is reported, not traced.
      select d.id, d.dispatch_number into v_line from public.packing_list_items p join public.dispatches d on d.id = p.dispatch_id and d.company_id = p.company_id
        where p.company_id = v_company and v_tag is not null and upper(p.bundle_number) = upper(v_tag) order by p.created_at desc limit 1;
      return jsonb_build_object('found', false, 'tag', v_tag, 'dispatch_id', v_line.id, 'dispatch_number', v_line.dispatch_number);
    end if;
    if p_command = 'bundle.trace' then
      return jsonb_build_object('found', true) || private.olo_bundle_trace(v_company, v_bundle);
    end if;
    select * into v_reg from private.olo_bundle_register x where x.id = v_bundle;
    return jsonb_build_object('found', true, 'id', v_reg.id, 'bundle_number', v_reg.bundle_number, 'state', v_reg.state, 'order_number', v_reg.order_number,
      'job_number', v_reg.job_number, 'profile_code', v_reg.profile_code, 'pieces', v_reg.number_of_pieces, 'net_kg', v_reg.net_kg, 'location', v_reg.location_name,
      'transfer_id', case when v_reg.line_state = 'sent' then v_reg.transfer_id end, 'transfer_number', v_reg.transfer_number, 'dispatch_number', v_reg.dispatch_number,
      'invoice_number', v_reg.invoice_number,
      'hold', case when v_reg.job_id is not null and v_reg.dispatch_id is null then private.olo_job_containment(v_company, v_reg.job_id) end);
  end if;

  -- ---------------------------------------------------------------- finished-goods transfers
  if p_command = 'fg.locations' then
    return jsonb_build_object('rows', (select coalesce(jsonb_agg(jsonb_build_object('id', il.id, 'location_code', il.location_code, 'location_name', il.location_name,
      'location_type', il.location_type) order by il.location_name), '[]'::jsonb) from public.inventory_locations il
      where il.company_id = v_company and il.is_active and il.dealer_id is null and il.location_type in ('factory','warehouse')),
      'can_send', v_role = any(c_send));
  end if;

  if p_command = 'fg.candidates' then
    if v_p - array['page','search','order_id'] <> '{}'::jsonb then raise exception 'Invalid transfer request' using errcode = '22023'; end if;
    begin v_order := nullif(v_p ->> 'order_id', '')::uuid; exception when others then raise exception 'Invalid order' using errcode = '22023'; end;
    with f as (
      select r.*, count(*) over () total_rows, row_number() over (order by r.recorded_at, r.id) rn from private.olo_bundle_register r
      where r.company_id = v_company and r.state = 'packed' and r.source_kind <> 'dealer_stock' and r.opening_cutover_id is null
        and r.order_stage not in ('closed','cancelled') and (v_order is null or r.order_id = v_order)
        and (v_search = '' or position(v_search in lower(concat_ws(' ', r.bundle_number, r.order_number, r.job_number, r.profile_code))) > 0)
    )
    select coalesce(max(f.total_rows), 0)::integer, coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'bundle_number', f.bundle_number, 'order_id', f.order_id,
        'order_number', f.order_number, 'job_number', f.job_number, 'profile_code', f.profile_code, 'pieces', f.number_of_pieces, 'net_kg', f.net_kg, 'recorded_at', f.recorded_at,
        'hold', case when f.job_id is not null then private.olo_job_containment(v_company, f.job_id) end) order by f.rn), '[]'::jsonb)
      into v_total, v_rows from f where f.rn > (v_page - 1) * 20 and f.rn <= v_page * 20;
    return jsonb_build_object('page', v_page, 'page_size', 20, 'total', v_total, 'rows', v_rows);
  end if;

  if p_command = 'fg.list' then
    if v_p - array['view','page','search','sort','direction'] <> '{}'::jsonb then raise exception 'Invalid transfer request' using errcode = '22023'; end if;
    v_view := coalesce(v_p ->> 'view', 'open'); v_sort := coalesce(v_p ->> 'sort', 'sent_at');
    if v_view not in ('open','done') or v_sort not in ('sent_at','transfer_number','bundle_count') then raise exception 'Invalid transfer view' using errcode = '22023'; end if;
    with f as (
      select x.*, il.location_name, su.full_name sender, count(*) over () total_rows,
        case v_sort when 'bundle_count' then x.bundle_count::numeric when 'sent_at' then extract(epoch from x.sent_at) end sort_num,
        case when v_sort = 'transfer_number' then x.transfer_number end sort_text
      from public.fg_transfers x join public.inventory_locations il on il.id = x.to_location_id and il.company_id = x.company_id
      left join public.app_users su on su.id = x.sent_by
      where x.company_id = v_company and ((v_view = 'open') = (x.status = 'in_transit'))
        and (v_search = '' or position(v_search in lower(concat_ws(' ', x.transfer_number, il.location_name, su.full_name))) > 0
          or exists (select 1 from public.fg_transfer_bundles l join public.prepared_physical_bundles b on b.id = l.bundle_id join public.orders o on o.id = l.order_id
            where l.transfer_id = x.id and position(v_search in lower(concat_ws(' ', b.bundle_number, o.order_number))) > 0))
    ), s2 as (
      select f.*, row_number() over (order by case when v_dir = 'asc' then f.sort_num end asc nulls last, case when v_dir = 'desc' then f.sort_num end desc nulls last,
        case when v_dir = 'asc' then f.sort_text end asc, case when v_dir = 'desc' then f.sort_text end desc, f.id) rn from f
    )
    select coalesce(max(s2.total_rows), 0)::integer, coalesce(jsonb_agg(jsonb_build_object('id', s2.id, 'transfer_number', s2.transfer_number, 'status', s2.status,
        'location', s2.location_name, 'bundle_count', s2.bundle_count, 'net_kg', s2.net_kg, 'sent_by_name', s2.sender, 'sent_at', s2.sent_at, 'closed_at', s2.closed_at,
        'received', (select count(*) from public.fg_transfer_bundles l where l.transfer_id = s2.id and l.state = 'received'),
        'missing', (select count(*) from public.fg_transfer_bundles l where l.transfer_id = s2.id and l.state = 'missing')) order by s2.rn), '[]'::jsonb)
      into v_total, v_rows from s2 where s2.rn > (v_page - 1) * 10 and s2.rn <= v_page * 10;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', v_total, 'rows', v_rows, 'can_send', v_role = any(c_send));
  end if;

  if p_command = 'fg.get' then
    if v_p - array['transfer_id'] <> '{}'::jsonb then raise exception 'Invalid transfer request' using errcode = '22023'; end if;
    begin v_id := (v_p ->> 'transfer_id')::uuid; exception when others then raise exception 'Invalid transfer' using errcode = '22023'; end;
    v_rows := private.olo_fg_transfer_json(v_company, v_id, v_actor, v_role);
    if v_rows is null then raise exception 'The transfer is not available' using errcode = 'P0001'; end if;
    return v_rows;
  end if;

  if p_command = 'fg.send' then
    if v_p - array['id','location_id','bundle_ids','note'] <> '{}'::jsonb then raise exception 'Invalid transfer request' using errcode = '22023'; end if;
    if not (v_role = any(c_send)) then raise exception 'Your role cannot send bundles to the finished-goods area' using errcode = '42501'; end if;
    begin
      v_id := (v_p ->> 'id')::uuid;
      select array_agg(distinct x::uuid order by x::uuid) into v_ids from jsonb_array_elements_text(v_p -> 'bundle_ids') x;
      select * into v_loc from public.inventory_locations il where il.id = (v_p ->> 'location_id')::uuid and il.company_id = v_company;
    exception when others then raise exception 'Choose the location and the bundles' using errcode = '22023';
    end;
    if v_id is null then raise exception 'Invalid transfer identity' using errcode = '22023'; end if;
    if v_ids is null or cardinality(v_ids) = 0 then raise exception 'Choose at least one bundle' using errcode = '22023'; end if;
    if cardinality(v_ids) > 60 then raise exception 'Send at most 60 bundles on one transfer' using errcode = '22023'; end if;
    if jsonb_array_length(v_p -> 'bundle_ids') <> cardinality(v_ids) then raise exception 'A bundle appears twice on the transfer' using errcode = '22023'; end if;
    v_note := nullif(btrim(coalesce(v_p ->> 'note', '')), '');
    if length(v_note) > 500 then raise exception 'The note is too long' using errcode = '22023'; end if;
    -- Replay of the same request returns the transfer already recorded.
    select * into v_tr from public.fg_transfers where id = v_id;
    if v_tr.id is not null then
      if v_tr.company_id <> v_company or v_tr.to_location_id is distinct from v_loc.id
         or (select array_agg(l.bundle_id order by l.bundle_id) from public.fg_transfer_bundles l where l.transfer_id = v_tr.id) is distinct from v_ids then
        raise exception 'This transfer identity was already used for different bundles. Start a new transfer.' using errcode = 'P0001';
      end if;
      return jsonb_build_object('replayed', true) || private.olo_fg_transfer_json(v_company, v_tr.id, v_actor, v_role);
    end if;
    if v_loc.id is null or not v_loc.is_active or v_loc.dealer_id is not null or v_loc.location_type not in ('factory','warehouse') then
      raise exception 'Choose an active factory or warehouse location' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':fg_transfer', 0));
    perform 1 from public.prepared_physical_bundles b where b.company_id = v_company and b.id = any(v_ids) order by b.id for update;
    select string_agg(coalesce(reg.bundle_number, u::text) || ': ' || case
        when reg.id is null then 'not a packed bundle of this company'
        when reg.dispatch_id is not null then 'already dispatched on ' || coalesce(reg.dispatch_number, 'a dispatch')
        when reg.source_kind = 'dealer_stock' then 'dealer stock does not pass through the finished-goods area'
        when reg.line_state = 'sent' then 'already on transfer ' || reg.transfer_number
        when reg.line_state = 'received' then 'already in ' || reg.location_name
        when reg.loaded_session_id is not null then 'already loaded on vehicle ' || coalesce(reg.loaded_vehicle, '-')
        when reg.order_stage in ('closed','cancelled') then 'its order is ' || reg.order_stage
        when reg.job_id is not null and private.olo_job_containment(v_company, reg.job_id) is not null then 'held in QC containment ' || private.olo_job_containment(v_company, reg.job_id)
        end, '; ')
      into v_bad
      from unnest(v_ids) u left join private.olo_bundle_register reg on reg.id = u and reg.company_id = v_company
      where reg.id is null or reg.state <> 'packed' or reg.source_kind = 'dealer_stock' or reg.order_stage in ('closed','cancelled')
        or (reg.job_id is not null and private.olo_job_containment(v_company, reg.job_id) is not null);
    if v_bad is not null then raise exception '%', 'These bundles cannot be sent: ' || left(v_bad, 900) using errcode = 'P0001'; end if;
    select sum(reg.net_kg), array_agg(distinct reg.order_id) into v_kg, v_orders from private.olo_bundle_register reg where reg.id = any(v_ids);
    v_number := private.olo_fg_transfer_number(v_company);
    insert into public.fg_transfers(id, company_id, transfer_number, to_location_id, bundle_count, net_kg, note, sent_by)
      values (v_id, v_company, v_number, v_loc.id, cardinality(v_ids), v_kg, v_note, v_actor);
    insert into public.fg_transfer_bundles(company_id, transfer_id, bundle_id, order_id, net_kg)
      select v_company, v_id, reg.id, reg.order_id, reg.net_kg from private.olo_bundle_register reg where reg.id = any(v_ids);
    foreach v_order in array v_orders loop
      perform private.olo_event(v_company, 'packaging.fg_transfer_sent', v_order, null, 'packaging',
        format('%s bundle(s) sent to %s on %s', (select count(*) from public.fg_transfer_bundles l where l.transfer_id = v_id and l.order_id = v_order), v_loc.location_name, v_number),
        jsonb_build_object('transfer_id', v_id, 'location', v_loc.location_name), 'fg-sent:' || v_id || ':' || v_order);
    end loop;
    perform private.olo_fg_receipt_task(v_company, v_id);
    perform private.olo_shipment_refresh(v_company);
    return jsonb_build_object('replayed', false) || private.olo_fg_transfer_json(v_company, v_id, v_actor, v_role);
  end if;

  if p_command in ('fg.receive','fg.close','fg.cancel') then
    if (p_command = 'fg.receive' and v_p - array['transfer_id','tag'] <> '{}'::jsonb) or (p_command <> 'fg.receive' and v_p - array['transfer_id','note'] <> '{}'::jsonb) then
      raise exception 'Invalid transfer request' using errcode = '22023';
    end if;
    begin v_id := (v_p ->> 'transfer_id')::uuid; exception when others then raise exception 'Invalid transfer' using errcode = '22023'; end;
    select * into v_tr from public.fg_transfers where id = v_id and company_id = v_company for update;
    if v_tr.id is null then raise exception 'The transfer is not available' using errcode = 'P0001'; end if;
    if v_tr.status <> 'in_transit' then raise exception 'Transfer % is already %', v_tr.transfer_number, replace(v_tr.status, '_', ' ') using errcode = 'P0001'; end if;
    select location_name into v_loc from public.inventory_locations where id = v_tr.to_location_id;
    if p_command = 'fg.cancel' then
      if not (v_tr.sent_by = v_actor or v_role in ('owner','admin','factory_manager','dispatch_manager')) then
        raise exception 'Only the sender or a dispatch manager, factory manager, admin or owner can cancel a transfer' using errcode = '42501';
      end if;
      v_note := btrim(coalesce(v_p ->> 'note', ''));
      if length(v_note) < 10 or length(v_note) > 500 then raise exception 'Write why the transfer is cancelled (at least 10 characters)' using errcode = '22023'; end if;
      if exists (select 1 from public.fg_transfer_bundles l where l.transfer_id = v_id and l.state = 'received') then
        raise exception 'Bundles of this transfer were already received; close it instead of cancelling it' using errcode = 'P0001';
      end if;
      perform set_config('olo.fg', 'on', true);
      update public.fg_transfer_bundles set state = 'withdrawn' where transfer_id = v_id and state = 'sent';
      update public.fg_transfers set status = 'cancelled', closed_by = v_actor, closed_at = clock_timestamp(), close_note = v_note where id = v_id;
      perform set_config('olo.fg', '', true);
      perform private.olo_shipment_refresh(v_company);
      return private.olo_fg_transfer_json(v_company, v_id, v_actor, v_role);
    end if;
    -- Receiving and closing: the receiving team, never the person who sent the bundles (owner excepted).
    if not (v_role = any(c_receive)) then raise exception 'Your role cannot receive bundles in the finished-goods area' using errcode = '42501'; end if;
    if v_tr.sent_by = v_actor and v_role <> 'owner' then
      raise exception 'You sent this transfer; another person must receive the bundles' using errcode = '42501';
    end if;
    if p_command = 'fg.receive' then
      v_tag := btrim(coalesce(v_p ->> 'tag', ''));
      if length(v_tag) = 0 or length(v_tag) > 160 then raise exception 'Scan or type a bundle tag' using errcode = '22023'; end if;
      v_bundle := private.olo_bundle_by_tag(v_company, v_tag);
      if v_bundle is null then
        raise exception 'Unknown bundle tag %: it is not recorded as a packed bundle. Keep it aside and tell packaging.', v_tag using errcode = 'P0001';
      end if;
      select l.*, b.bundle_number into v_line from public.fg_transfer_bundles l join public.prepared_physical_bundles b on b.id = l.bundle_id
        where l.transfer_id = v_id and l.bundle_id = v_bundle for update of l;
      if v_line.id is null then
        select x.transfer_number into v_number from public.fg_transfer_bundles l join public.fg_transfers x on x.id = l.transfer_id where l.bundle_id = v_bundle and l.state = 'sent';
        raise exception '%', format('Bundle %s is not on transfer %s%s. Do not take it in on this transfer.',
          (select bundle_number from public.prepared_physical_bundles where id = v_bundle), v_tr.transfer_number, coalesce(' (it is on transfer ' || v_number || ')', '')) using errcode = 'P0001';
      end if;
      if v_line.state = 'received' then
        return jsonb_build_object('state', 'already_received', 'bundle_number', v_line.bundle_number) || jsonb_build_object('transfer', private.olo_fg_transfer_json(v_company, v_id, v_actor, v_role));
      end if;
      if v_line.state <> 'sent' then raise exception 'Bundle % is recorded as % on this transfer', v_line.bundle_number, v_line.state using errcode = 'P0001'; end if;
      perform set_config('olo.fg', 'on', true);
      update public.fg_transfer_bundles set state = 'received', received_by = v_actor, received_at = clock_timestamp(), scanned_tag = left(v_tag, 160) where id = v_line.id;
      select count(*) into v_n from public.fg_transfer_bundles where transfer_id = v_id and state = 'sent';
      if v_n = 0 then
        update public.fg_transfers set status = 'received', closed_by = v_actor, closed_at = clock_timestamp() where id = v_id;
      end if;
      perform set_config('olo.fg', '', true);
      if v_n = 0 then
        for v_order in select distinct l.order_id from public.fg_transfer_bundles l where l.transfer_id = v_id loop
          perform private.olo_event(v_company, 'packaging.fg_received', v_order, null, 'dispatch',
            format('Transfer %s received in %s', v_tr.transfer_number, v_loc.location_name), jsonb_build_object('transfer_id', v_id), 'fg-received:' || v_id || ':' || v_order);
        end loop;
        perform private.olo_shipment_refresh(v_company);
      end if;
      return jsonb_build_object('state', 'received', 'bundle_number', v_line.bundle_number, 'remaining', v_n, 'transfer', private.olo_fg_transfer_json(v_company, v_id, v_actor, v_role));
    end if;
    -- fg.close: what has not arrived is recorded as missing.
    v_note := btrim(coalesce(v_p ->> 'note', ''));
    if length(v_note) < 10 or length(v_note) > 500 then raise exception 'Write what happened to the bundles that did not arrive (at least 10 characters)' using errcode = '22023'; end if;
    if not exists (select 1 from public.fg_transfer_bundles l where l.transfer_id = v_id and l.state = 'received') then
      raise exception 'No bundle of this transfer was received; the sender can cancel it instead' using errcode = 'P0001';
    end if;
    select string_agg(b.bundle_number, ', ' order by b.bundle_number), count(*) into v_missing, v_n from public.fg_transfer_bundles l join public.prepared_physical_bundles b on b.id = l.bundle_id
      where l.transfer_id = v_id and l.state = 'sent';
    perform set_config('olo.fg', 'on', true);
    update public.fg_transfer_bundles set state = 'missing' where transfer_id = v_id and state = 'sent';
    update public.fg_transfers set status = case when v_n > 0 then 'closed_short' else 'received' end, closed_by = v_actor, closed_at = clock_timestamp(),
      close_note = v_note where id = v_id;
    perform set_config('olo.fg', '', true);
    if v_n > 0 then
      perform private.ap3_notify_roles(v_company, private.olo_uniq(private.olo_roles(v_company, 'factory_management', 0) || private.olo_roles(v_company, 'packaging', 1)
          || private.olo_roles(v_company, 'dispatch', 1)), 'olo_fg_missing', 'critical', format('Bundles missing on finished-goods transfer %s', v_tr.transfer_number),
        format('%s bundle(s) sent to %s on %s did not arrive and were recorded missing by %s: %s. Note: %s', v_n, v_loc.location_name, v_tr.transfer_number, a ->> 'name',
          left(v_missing, 600), v_note), 'fg_transfer', v_id, '/packaging/fg-transfers/' || v_id, 'olo-fg-missing:' || v_id, v_actor);
      for v_order in select distinct l.order_id from public.fg_transfer_bundles l where l.transfer_id = v_id and l.state = 'missing' loop
        perform private.olo_event(v_company, 'packaging.fg_missing', v_order, null, 'dispatch',
          format('Transfer %s closed with bundle(s) missing: %s', v_tr.transfer_number, left(v_missing, 300)), jsonb_build_object('transfer_id', v_id), 'fg-missing:' || v_id || ':' || v_order);
      end loop;
    end if;
    perform private.olo_shipment_refresh(v_company);
    return private.olo_fg_transfer_json(v_company, v_id, v_actor, v_role);
  end if;

  raise exception 'Unknown packaging command' using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Order lifecycle: packaging release, finished goods, transfer and invoicing
-- ---------------------------------------------------------------------------------------------------------------
alter function private.olo_order_core(uuid, uuid, boolean, boolean) rename to olo_order_core_p5;
create or replace function private.olo_order_core(p_company uuid, p_order uuid, p_finance boolean, p_with_gates boolean) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v jsonb := private.olo_order_core_p5(p_company, p_order, p_finance, p_with_gates); v_tol numeric := (private.olo_settings_for(p_company)).reproduction_tolerance_kg;
  v_release numeric := 0; v_to_pack numeric := 0; v_first jsonb; v_fg numeric := 0; v_transfer numeric := 0; v_invoiced numeric := 0; v_uninv integer := 0;
  v_first_uninv text; v_status text; v_dept text;
begin
  if v is null then return v; end if;
  select coalesce(sum((x.rl ->> 'release_kg')::numeric), 0), coalesce(sum((x.rl ->> 'to_pack_kg')::numeric) filter (where x.rl ->> 'basis' <> 'held'), 0)
    into v_release, v_to_pack
    from (select private.olo_packing_release(e -> 'quality_flow') rl from jsonb_array_elements(coalesce(v -> 'jobs', '[]'::jsonb)) e where e ? 'quality_flow') x;
  select jsonb_build_object('job_id', e -> 'quality_flow' ->> 'job_id', 'job_number', e -> 'quality_flow' ->> 'job_number', 'release', private.olo_packing_release(e -> 'quality_flow'))
    into v_first from jsonb_array_elements(coalesce(v -> 'jobs', '[]'::jsonb)) e
    where e ? 'quality_flow' and private.olo_packing_release(e -> 'quality_flow') ->> 'basis' <> 'held'
      and (private.olo_packing_release(e -> 'quality_flow') ->> 'to_pack_kg')::numeric > v_tol
    order by e -> 'quality_flow' ->> 'job_number' limit 1;
  select coalesce(sum(r.net_kg) filter (where r.state = 'in_fg'), 0), coalesce(sum(r.net_kg) filter (where r.state = 'in_transfer'), 0) into v_fg, v_transfer
    from private.olo_bundle_register r where r.company_id = p_company and r.order_id = p_order;
  select coalesce(sum(coalesce(p.net_weight_kg, p.gross_weight_kg - p.tare_weight_kg)), 0) into v_invoiced
    from public.packing_list_items p join public.dispatches d on d.id = p.dispatch_id and d.company_id = p.company_id
    where d.company_id = p_company and d.order_id = p_order and private.olo_dispatch_invoice(p_company, d.id) is not null;
  select count(*), (array_agg(d.dispatch_number order by d.actual_dispatched_at))[1] into v_uninv, v_first_uninv
    from public.dispatches d where d.company_id = p_company and d.order_id = p_order and d.actual_dispatched_at is not null
      and d.delivery_status not in ('returned','damaged') and private.olo_dispatch_invoice(p_company, d.id) is null;
  v := jsonb_set(v, '{quantities}', coalesce(v -> 'quantities', '{}'::jsonb) || jsonb_build_object('released_for_packing_kg', v_release, 'to_pack_kg', v_to_pack,
    'in_fg_kg', v_fg, 'in_fg_transfer_kg', v_transfer, 'invoiced_kg', v_invoiced, 'dispatches_not_invoiced', v_uninv));
  v_status := case when v_uninv > 0 then 'awaiting_invoice' when v_to_pack > v_tol then 'to_pack' when v_transfer > 0 then 'in_transfer'
    when v_fg > 0 then 'in_fg' when v_invoiced > 0 then 'invoiced' else 'not_started' end;
  v := jsonb_set(v, '{domains}', coalesce(v -> 'domains', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('key', 'shipment', 'label', 'Packing release, finished goods and invoicing',
    'status', v_status, 'detail', format('Released for packing %s · still to pack %s · in finished goods %s · on transfer %s · invoiced %s · %s dispatch(es) without a tax invoice',
      private.olo_fmt_kg(v_release), private.olo_fmt_kg(v_to_pack), private.olo_fmt_kg(v_fg), private.olo_fmt_kg(v_transfer), private.olo_fmt_kg(v_invoiced), v_uninv))));
  v_dept := v -> 'next_action' ->> 'department';
  if coalesce(v ->> 'overall', '') not in ('cancelled','fully_closed') then
    if (v_dept is null or v_dept = 'packaging') and v_first is not null then
      v := jsonb_set(v, '{next_action}', jsonb_build_object('label', format('Pack %s of job %s released by %s', private.olo_fmt_kg((v_first -> 'release' ->> 'to_pack_kg')::numeric),
        v_first ->> 'job_number', case when v_first -> 'release' ->> 'basis' = 'final_qc' then 'final QC after ageing' else 'QC' end),
        'department', 'packaging', 'link', '/packaging/release/' || (v_first ->> 'job_id')));
    elsif v_dept is null and v_uninv > 0 then
      v := jsonb_set(v, '{next_action}', jsonb_build_object('label', format('Issue the tax invoice for dispatch %s', coalesce(v_first_uninv, '-')),
        'department', 'finance', 'link', '/invoices/drafts'));
    end if;
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants, row level security, live screens
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function private.olo_fg_guard(), private.olo_fg_transfer_number(uuid), private.olo_dispatch_invoice(uuid, uuid), private.olo_packing_release(jsonb),
  private.olo_packing_spec(uuid, uuid), private.olo_packing_spec_text(jsonb), private.handoff_for_inspection_p5(uuid, uuid), private.handoff_for_inspection(uuid, uuid),
  private.olo_after_final_qc_release(), private.olo_bundle_trace(uuid, uuid), private.olo_guard_fg_custody(), private.olo_order_untransferred(uuid, uuid, integer),
  private.olo_fg_receipt_task(uuid, uuid), private.olo_evaluate_shipment(uuid), private.olo_verify_tasks_p5(uuid), private.olo_verify_tasks(uuid),
  private.olo_run_all_p5(uuid, text), private.olo_run_all(uuid, text), private.olo_after_shipment_change(), private.olo_fg_transfer_json(uuid, uuid, uuid, text),
  private.olo_bundle_by_tag(uuid, text), private.olo_shipment_refresh(uuid), private.olo_order_core_p5(uuid, uuid, boolean, boolean),
  private.olo_order_core(uuid, uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.packaging_flow_command(text, jsonb) from public, anon;
grant execute on function public.packaging_flow_command(text, jsonb) to authenticated;

alter table public.fg_transfers enable row level security;
alter table public.fg_transfer_bundles enable row level security;
revoke all on public.fg_transfers, public.fg_transfer_bundles from public, anon, authenticated;
grant select on public.fg_transfers, public.fg_transfer_bundles to authenticated;
create policy fg_transfers_read on public.fg_transfers for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy fg_transfer_bundles_read on public.fg_transfer_bundles for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));

do $$
declare v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['fg_transfers','fg_transfer_bundles'] loop
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
      perform private.olo_evaluate_shipment(c.id);
      perform private.olo_verify_tasks(c.id);
    exception when others then
      insert into public.olo_engine_errors(company_id, source, message) values (c.id, 'phase6:first_run', left(sqlerrm, 500));
    end;
  end loop;
  perform set_config('olo.engine', '', true);
end;
$$;

commit;
