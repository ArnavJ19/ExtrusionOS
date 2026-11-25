-- Order lifecycle orchestration, batch 3 / Phase 3 (directive sections 19, 24, 26, 31-34; batch 1 section G open items).
--
--   * Dispatch finance clearance by payment terms: each order follows its own terms, else its customer's, else the
--     company default, else credit terms. Credit terms keep the existing credit-limit and overdue checks only. "Advance
--     part" needs the given percentage of the order value received before a dispatch leaves; "payment before dispatch"
--     needs everything dispatched so far plus this dispatch covered. Receipts are the order's invoice payments plus the
--     customer's unapplied advances left after the customer's other open invoices and dispatched-unbilled goods. When the money is not yet visible, accounts release one dispatch on a confirmed
--     payment reference, or the owner releases it as an exception; a release lasts 48 hours, covers the dispatch value
--     at the time and is used once. The database refuses the gate-out otherwise. Non-finance staff never see amounts.
--   * Customer dispatch communication: once material leaves, dispatch gets one task to send the customer the dispatch
--     details (vehicle, driver, LR, e-way bill, bundles, weight, expected delivery; never prices). Sending is recorded
--     with its channel, recipient and exact text; delivered, read and failed are recorded as they are confirmed. A
--     failed message re-opens the task.
--   * Earlier QC approvals under a containment: every approval recorded before the containment is reviewed one by one.
--     QC records stay immutable. Reconfirming records the re-check; revoking keeps that quantity suspended, so the
--     job's material stays blocked and the lot cannot resolve until the factory manager or owner (not the person who
--     revoked) closes the revocation with re-verification evidence. Material already moved on is flagged for recall.
--     The blanket "earlier material re-checked" confirmation of batch 2 is replaced by these per-approval records.
--   * Live screens: workflow events, task events, containments, die preparation events and customer communications are
--     published for Realtime; the screens re-read through their usual server path.
-- Additive only: new tables, functions, guards and wrappers; earlier functions are wrapped, not rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ---------------------------------------------------------------------------------------------------------------
-- Task vocabulary
-- ---------------------------------------------------------------------------------------------------------------
alter table public.tasks drop constraint if exists tasks_workflow_shape_check;
alter table public.tasks add constraint tasks_workflow_shape_check check (
  (workflow_key is null and workflow_kind is null and workflow_department is null and workflow_cycle is null and workflow_due_at is null)
  or (workflow_key is not null and workflow_kind in ('billet_allocation','die_preparation','billet_shortage','reproduction','delivery_confirmation',
        'delivery_followup','containment','remelt_approval','remelt_receipt','priority_approval','dispatch_clearance','dispatch_intimation')
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
      else 'This task closes when the dispatch update is recorded as sent to the customer.' end
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
-- Dispatch finance terms and releases
-- ---------------------------------------------------------------------------------------------------------------
create table public.dispatch_finance_terms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  scope text not null check (scope in ('company','customer','order')),
  customer_id uuid references public.customers(id),
  order_id uuid references public.orders(id),
  terms text not null check (terms in ('credit','advance_part','payment_before_dispatch')),
  advance_percent numeric(5,2) check (advance_percent is null or (advance_percent > 0 and advance_percent <= 100)),
  reason text not null check (length(btrim(reason)) between 5 and 300),
  status text not null default 'active' check (status in ('active','superseded')),
  set_by uuid not null references public.app_users(id),
  set_by_role text not null,
  set_at timestamptz not null default clock_timestamp(),
  superseded_by uuid references public.app_users(id),
  superseded_at timestamptz,
  superseded_note text check (superseded_note is null or length(btrim(superseded_note)) between 5 and 300),
  check ((scope = 'company') = (customer_id is null and order_id is null)),
  check (scope <> 'customer' or (customer_id is not null and order_id is null)),
  check (scope <> 'order' or order_id is not null),
  check ((terms = 'advance_part') = (advance_percent is not null)),
  check ((status = 'superseded') = (superseded_at is not null and superseded_by is not null))
);
create unique index dispatch_finance_terms_company_key on public.dispatch_finance_terms(company_id) where status = 'active' and scope = 'company';
create unique index dispatch_finance_terms_customer_key on public.dispatch_finance_terms(company_id, customer_id) where status = 'active' and scope = 'customer';
create unique index dispatch_finance_terms_order_key on public.dispatch_finance_terms(company_id, order_id) where status = 'active' and scope = 'order';
create index dispatch_finance_terms_list_idx on public.dispatch_finance_terms(company_id, status, set_at desc);
create index dispatch_finance_terms_customer_idx on public.dispatch_finance_terms(customer_id);
create index dispatch_finance_terms_order_idx on public.dispatch_finance_terms(order_id);
create index dispatch_finance_terms_people_idx on public.dispatch_finance_terms(set_by, superseded_by);

create table public.dispatch_finance_releases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  dispatch_id uuid not null references public.dispatches(id),
  order_id uuid not null references public.orders(id),
  basis text not null check (basis in ('payment_confirmed','approved_exception')),
  reference text check (reference is null or length(btrim(reference)) between 4 and 80),
  note text not null check (length(btrim(note)) between 10 and 500),
  terms text not null check (terms in ('advance_part','payment_before_dispatch')),
  released_value numeric(14,2),
  required_amount numeric(14,2),
  received_amount numeric(14,2) not null,
  released_by uuid not null references public.app_users(id),
  released_by_role text not null,
  released_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_by uuid references public.app_users(id),
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or length(btrim(revoke_reason)) between 5 and 300),
  check (basis <> 'payment_confirmed' or reference is not null),
  check (basis <> 'approved_exception' or released_by_role = 'owner'),
  check ((revoked_at is null) = (revoked_by is null and revoke_reason is null)),
  check (consumed_at is null or revoked_at is null),
  check (expires_at > released_at)
);
create unique index dispatch_finance_releases_live_key on public.dispatch_finance_releases(dispatch_id) where revoked_at is null and consumed_at is null;
create index dispatch_finance_releases_company_idx on public.dispatch_finance_releases(company_id, released_at desc);
create index dispatch_finance_releases_dispatch_idx on public.dispatch_finance_releases(dispatch_id, released_at desc);
create index dispatch_finance_releases_order_idx on public.dispatch_finance_releases(order_id);
create index dispatch_finance_releases_people_idx on public.dispatch_finance_releases(released_by, revoked_by);

create or replace function private.olo_terms_label(p_terms text, p_percent numeric) returns text language sql immutable set search_path = public, private as $$
  select case p_terms when 'payment_before_dispatch' then 'payment before dispatch'
    when 'advance_part' then 'advance of ' || trim_scale(p_percent) || '% before dispatch' else 'credit terms' end
$$;

-- The terms that apply to an order: its own, else its customer's, else the company default, else credit terms.
create or replace function private.olo_dispatch_terms(p_company uuid, p_order uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(
    (select jsonb_build_object('id', t.id, 'terms', t.terms, 'advance_percent', t.advance_percent, 'scope', t.scope, 'reason', t.reason,
         'label', private.olo_terms_label(t.terms, t.advance_percent))
       from public.dispatch_finance_terms t join public.orders o on o.id = p_order and o.company_id = p_company
       where t.company_id = p_company and t.status = 'active'
         and ((t.scope = 'order' and t.order_id = o.id) or (t.scope = 'customer' and t.customer_id = o.customer_id) or t.scope = 'company')
       order by case t.scope when 'order' then 0 when 'customer' then 1 else 2 end limit 1),
    jsonb_build_object('id', null, 'terms', 'credit', 'advance_percent', null, 'scope', 'default', 'reason', null, 'label', 'credit terms'))
$$;

-- Clearance of one dispatch. States: not_required (credit terms, opening balances, no customer), covered (receipts meet
-- the requirement), released (a live release covers it), blocked, dispatched (already left). Amounts sit under
-- "amounts" so callers can drop them for non-finance staff.
-- Volatile on purpose: after the gate guard waits for the customer lock, each read must see dispatches committed meanwhile.
create or replace function private.olo_dispatch_clearance(p_company uuid, p_dispatch uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, private as $$
declare d public.dispatches%rowtype; o public.orders%rowtype; k jsonb; v_terms text; v_value numeric; v_prior numeric := 0; v_required numeric;
  v_paid numeric := 0; v_advance numeric := 0; v_other numeric := 0; v_free numeric := 0; v_received numeric; r public.dispatch_finance_releases%rowtype; v_state text; v_release jsonb;
begin
  select * into d from public.dispatches where id = p_dispatch and company_id = p_company;
  if not found then return null; end if;
  select * into o from public.orders where id = d.order_id and company_id = p_company;
  k := private.olo_dispatch_terms(p_company, d.order_id);
  v_terms := k ->> 'terms';
  if v_terms = 'credit' or o.id is null or o.opening_cutover_id is not null or o.customer_id is null then
    return jsonb_build_object('dispatch_id', d.id, 'state', case when d.actual_dispatched_at is not null then 'dispatched' else 'not_required' end,
      'terms', k, 'requires_clearance', false, 'priced', true, 'release', null, 'amounts', null);
  end if;
  v_value := private.ap3_dispatch_value(p_company, d.id);
  select coalesce(sum(i.amount_paid), 0) into v_paid from public.invoices i
    where i.company_id = p_company and i.order_id = o.id and i.deleted_at is null and i.status not in ('draft','cancelled');
  select coalesce(sum(c.amount - c.applied_amount), 0) into v_advance from public.customer_on_account_credits c
    where c.company_id = p_company and c.customer_id = o.customer_id and c.status = 'open';
  -- Unapplied advances first cover what the customer already owes on other orders (open invoices and goods dispatched
  -- but not yet invoiced), so one advance never clears two orders.
  select coalesce(sum(i.balance_due), 0) into v_other from public.invoices i
    where i.company_id = p_company and i.customer_id = o.customer_id and i.order_id is distinct from o.id and i.deleted_at is null and i.balance_due > 0
      and i.status = any(private.ap3_open_invoice_statuses());
  select v_other + coalesce(sum(coalesce(private.ap3_dispatch_value(p_company, x.id), 0)), 0) into v_other from public.dispatches x
    join public.orders xo on xo.id = x.order_id and xo.company_id = x.company_id
    where x.company_id = p_company and xo.customer_id = o.customer_id and xo.id <> o.id and x.actual_dispatched_at is not null and x.delivery_status not in ('returned','damaged')
      and not exists (select 1 from public.invoices i where i.company_id = p_company and i.dispatch_id = x.id and i.status <> 'cancelled' and i.deleted_at is null);
  v_free := greatest(v_advance - v_other, 0);
  v_received := round(v_paid + v_free, 2);
  if v_terms = 'advance_part' then
    v_required := round(coalesce(o.order_value, 0) * (k ->> 'advance_percent')::numeric / 100, 2);
  else
    select coalesce(sum(coalesce(private.ap3_dispatch_value(p_company, x.id), 0)), 0) into v_prior from public.dispatches x
      where x.company_id = p_company and x.order_id = o.id and x.id <> d.id and x.actual_dispatched_at is not null and x.delivery_status not in ('returned','damaged');
    v_required := case when v_value is null then null else round(v_prior + v_value, 2) end;
  end if;
  select * into r from public.dispatch_finance_releases x where x.company_id = p_company and x.dispatch_id = d.id and x.revoked_at is null
    order by x.released_at desc limit 1;
  v_state := case
    when d.actual_dispatched_at is not null then 'dispatched'
    when v_required is not null and v_received + 1 >= v_required then 'covered'
    when r.id is not null and r.consumed_at is null and r.expires_at > clock_timestamp()
      and (r.released_value is null or coalesce(v_value, 0) <= r.released_value + 1) then 'released'
    else 'blocked' end;
  if r.id is not null then
    v_release := jsonb_build_object('id', r.id, 'basis', r.basis, 'reference', r.reference, 'note', r.note, 'released_at', r.released_at, 'expires_at', r.expires_at,
      'consumed_at', r.consumed_at, 'expired', r.consumed_at is null and r.expires_at <= clock_timestamp(),
      'value_grown', r.released_value is not null and coalesce(v_value, 0) > r.released_value + 1,
      'released_by_name', (select full_name from public.app_users u where u.id = r.released_by));
  end if;
  return jsonb_build_object('dispatch_id', d.id, 'state', v_state, 'terms', k, 'requires_clearance', true, 'priced', v_value is not null, 'release', v_release,
    'amounts', jsonb_build_object('dispatch_value', v_value, 'earlier_dispatched_value', v_prior, 'order_value', o.order_value, 'required', v_required,
      'paid_on_order', round(v_paid, 2), 'customer_advance', round(v_advance, 2), 'other_obligations', round(v_other, 2), 'advance_available', round(v_free, 2), 'received', v_received,
      'shortfall', case when v_required is null then null else greatest(v_required - v_received, 0) end, 'released_value', r.released_value));
end;
$$;

create or replace function private.olo_guard_dispatch_finance() returns trigger language plpgsql security definer set search_path = public, private as $$
declare k jsonb; v_customer uuid;
begin
  if not (old.delivery_status = 'pending' and new.delivery_status = 'dispatched') then return new; end if;
  -- Gate-outs of one customer are checked one at a time, so two dispatches cannot both use the same advance.
  select customer_id into v_customer from public.orders where id = new.order_id and company_id = new.company_id;
  if v_customer is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.company_id::text || ':olo-dispatch-clearance:' || v_customer::text, 0));
  end if;
  k := private.olo_dispatch_clearance(new.company_id, new.id);
  if k is null or k ->> 'state' in ('not_required','covered') then return new; end if;
  if k ->> 'state' = 'released' then
    update public.dispatch_finance_releases set consumed_at = clock_timestamp()
      where id = (k -> 'release' ->> 'id')::uuid and consumed_at is null and revoked_at is null;
    return new;
  end if;
  raise exception 'Finance clearance is needed before dispatch % leaves: the order is on %, and the payment is not yet confirmed. Accounts confirm the payment or record a release under Dispatches, Finance clearance.',
    coalesce(new.dispatch_number, ''), k -> 'terms' ->> 'label' using errcode = '23514';
end;
$$;
revoke all on function private.olo_terms_label(text, numeric), private.olo_dispatch_terms(uuid, uuid), private.olo_dispatch_clearance(uuid, uuid),
  private.olo_guard_dispatch_finance() from public, anon, authenticated;
create trigger b_olo_guard_dispatch_finance before update of delivery_status on public.dispatches for each row execute function private.olo_guard_dispatch_finance();

-- ---------------------------------------------------------------------------------------------------------------
-- Customer dispatch communication
-- ---------------------------------------------------------------------------------------------------------------
create table public.dispatch_communications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  dispatch_id uuid not null references public.dispatches(id),
  order_id uuid references public.orders(id),
  customer_id uuid references public.customers(id),
  kind text not null default 'dispatch_intimation' check (kind in ('dispatch_intimation')),
  channel text not null check (channel in ('whatsapp','sms','email','phone_call')),
  recipient text not null check (length(btrim(recipient)) between 5 and 120),
  language text not null default 'en' check (language in ('en','hi')),
  message_body text not null check (length(btrim(message_body)) between 20 and 2000),
  status text not null default 'sent' check (status in ('sent','delivered','read','failed')),
  outbound_message_id uuid references public.outbound_messages(id),
  sent_by uuid not null references public.app_users(id),
  sent_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  failed_reason text check (failed_reason is null or length(btrim(failed_reason)) between 5 and 300),
  last_marked_by uuid references public.app_users(id),
  note text check (note is null or length(note) <= 300),
  check ((status = 'failed') = (failed_at is not null and failed_reason is not null)),
  check (status not in ('delivered','read') or delivered_at is not null),
  check (status <> 'read' or read_at is not null)
);
create index dispatch_communications_dispatch_idx on public.dispatch_communications(company_id, dispatch_id, sent_at desc);
create index dispatch_communications_company_idx on public.dispatch_communications(company_id, sent_at desc);
create index dispatch_communications_order_idx on public.dispatch_communications(order_id);
create index dispatch_communications_customer_idx on public.dispatch_communications(customer_id);
create index dispatch_communications_outbound_idx on public.dispatch_communications(outbound_message_id);
create index dispatch_communications_people_idx on public.dispatch_communications(sent_by, last_marked_by);

-- Only the status trail may change after a message is recorded: body, recipient and channel are evidence.
create or replace function private.olo_guard_dispatch_communication() returns trigger language plpgsql set search_path = public, private as $$
begin
  if tg_op = 'DELETE' then raise exception 'Recorded customer communications cannot be deleted' using errcode = '42501'; end if;
  if (new.company_id, new.dispatch_id, new.channel, new.recipient, new.language, new.message_body, new.sent_by, new.sent_at)
     is distinct from (old.company_id, old.dispatch_id, old.channel, old.recipient, old.language, old.message_body, old.sent_by, old.sent_at) then
    raise exception 'A recorded customer message cannot be changed; record a new message instead' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.olo_guard_dispatch_communication() from public, anon, authenticated;
create trigger dispatch_communications_evidence before update or delete on public.dispatch_communications for each row execute function private.olo_guard_dispatch_communication();

-- What the customer may be told about a dispatch: logistics facts only, never prices, costs or internal notes.
create or replace function private.olo_dispatch_facts(p_company uuid, p_dispatch uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('dispatch_id', d.id, 'dispatch_number', d.dispatch_number, 'dispatched_at', d.actual_dispatched_at, 'delivery_status', d.delivery_status,
    'order_id', o.id, 'order_number', o.order_number, 'customer_id', o.customer_id,
    'customer_name', coalesce(nullif(c.company_name, ''), c.customer_name), 'contact_person', c.contact_person,
    'customer_po', (select pi.customer_po_ref from public.po_intakes pi where pi.company_id = p_company and pi.order_id = o.id and pi.status = 'linked' order by pi.created_at desc limit 1),
    'company_name', (select coalesce(nullif(co.legal_name, ''), co.name) from public.companies co where co.id = p_company),
    'vehicle_number', d.vehicle_number, 'driver_name', d.driver_name, 'driver_phone', d.driver_phone, 'transporter_name', d.transporter_name,
    'lr_number', d.lr_number, 'eway_bill_number', d.eway_bill_number,
    'invoice_numbers', (select coalesce(jsonb_agg(i.invoice_number order by i.invoice_number), '[]'::jsonb) from public.invoices i
      where i.company_id = p_company and i.dispatch_id = d.id and i.deleted_at is null and i.status not in ('draft','cancelled') and i.invoice_number is not null),
    'bundles', (select count(*) from public.packing_list_items p where p.dispatch_id = d.id),
    'pieces', (select coalesce(sum(p.number_of_pieces), 0) from public.packing_list_items p where p.dispatch_id = d.id),
    'net_weight_kg', (select coalesce(sum(p.net_weight_kg), 0) from public.packing_list_items p where p.dispatch_id = d.id),
    'items', (select coalesce(jsonb_agg(x order by x ->> 'profile_code'), '[]'::jsonb) from (
        select jsonb_build_object('profile_code', coalesce(pr.profile_code, max(p.section_code)), 'component_code', max(p.customer_component_code),
          'pieces', sum(p.number_of_pieces), 'net_weight_kg', sum(p.net_weight_kg), 'bundles', count(*)) x
        from public.packing_list_items p left join public.aluminium_profiles pr on pr.id = p.profile_id
        where p.dispatch_id = d.id group by pr.profile_code, p.profile_id) y),
    'expected_delivery', case when d.actual_dispatched_at is null then null else private.olo_expected_delivery(p_company, d.id) end,
    'recipients', (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
        select jsonb_build_object('channel', 'whatsapp', 'value', c.whatsapp_number, 'label', 'WhatsApp ' || c.whatsapp_number) r where nullif(btrim(c.whatsapp_number), '') is not null
        union all select jsonb_build_object('channel', 'sms', 'value', c.phone, 'label', 'Phone ' || c.phone) where nullif(btrim(c.phone), '') is not null
        union all select jsonb_build_object('channel', 'email', 'value', c.email, 'label', 'Email ' || c.email) where nullif(btrim(c.email), '') is not null) z))
  from public.dispatches d left join public.orders o on o.id = d.order_id left join public.customers c on c.id = o.customer_id
  where d.id = p_dispatch and d.company_id = p_company
$$;
revoke all on function private.olo_dispatch_facts(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Reviews of QC approvals recorded before a containment
-- ---------------------------------------------------------------------------------------------------------------
-- QC dispositions are immutable (guard_terminal_quality_inspection), so an earlier approval is never edited. QA
-- reconfirms it with the re-check evidence, or revokes it: a revoked approval stays suspended, which keeps the job's
-- material blocked and stops the containment from resolving, until the factory manager or owner closes the
-- revocation with QA's re-verification evidence (rework done and re-inspected). Correcting the QC ledger itself
-- (scrapping material already counted as approved) needs a QC reversal record and is not part of this batch.
create table public.containment_prior_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  containment_id uuid not null references public.quality_containments(id),
  quality_inspection_id uuid not null references public.quality_inspections(id),
  outcome text not null check (outcome in ('reconfirmed','revoked')),
  quantity_kg numeric(14,3) not null check (quantity_kg > 0),
  method text not null check (length(btrim(method)) between 2 and 120),
  note text not null check (length(btrim(note)) between 10 and 500),
  reviewed_by uuid not null references public.app_users(id),
  reviewed_at timestamptz not null default clock_timestamp(),
  closed_by uuid references public.app_users(id),
  closed_by_role text,
  closed_at timestamptz,
  close_method text check (close_method is null or length(btrim(close_method)) between 2 and 120),
  close_note text check (close_note is null or length(btrim(close_note)) between 10 and 500),
  unique (containment_id, quality_inspection_id),
  check ((closed_at is null) = (closed_by is null and close_method is null and close_note is null and closed_by_role is null)),
  check (closed_at is null or outcome = 'revoked')
);
create index containment_prior_reviews_inspection_idx on public.containment_prior_reviews(quality_inspection_id);
create index containment_prior_reviews_company_idx on public.containment_prior_reviews(company_id, reviewed_at desc);
create index containment_prior_reviews_people_idx on public.containment_prior_reviews(reviewed_by, closed_by);

-- A review is evidence: only the closure of a revocation may be added, once.
create or replace function private.olo_guard_prior_review() returns trigger language plpgsql set search_path = public, private as $$
begin
  if tg_op = 'DELETE' or old.closed_at is not null
     or (to_jsonb(new) - array['closed_by','closed_by_role','closed_at','close_method','close_note']) is distinct from (to_jsonb(old) - array['closed_by','closed_by_role','closed_at','close_method','close_note']) then
    raise exception 'Recorded approval reviews cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.olo_guard_prior_review() from public, anon, authenticated;
create trigger containment_prior_reviews_evidence before update or delete on public.containment_prior_reviews for each row execute function private.olo_guard_prior_review();

-- Approvals of the containment's job recorded before it opened (not its own releases), and any already reviewed.
create or replace function private.olo_prior_approvals(p_containment uuid) returns setof public.quality_inspections
language sql stable security definer set search_path = public, private as $$
  select q.* from public.quality_containments c join public.quality_inspections q on q.company_id = c.company_id and q.production_job_id = c.production_job_id
  where c.id = p_containment and q.finishing_job_id is null
    and (exists (select 1 from public.containment_prior_reviews pr where pr.containment_id = c.id and pr.quality_inspection_id = q.id)
      or (q.status = 'approved' and q.created_at <= c.opened_at
        and not exists (select 1 from public.material_lots l where l.quality_inspection_id = q.id and l.containment_id = c.id)))
  order by q.created_at, q.id
$$;

-- Job material already moved past QC (ageing, packaging, prepared or packed bundles), as the largest of those stages.
create or replace function private.olo_job_consumed_kg(p_company uuid, p_job uuid) returns numeric
language sql stable security definer set search_path = public, private as $$
  select greatest(
    coalesce((select sum(x.profile_weight_kg) from public.packaging_jobs x where x.company_id = p_company and x.production_job_id = p_job and x.status <> 'cancelled'), 0),
    coalesce((select sum(x.net_weight_kg) from public.packing_list_items x where x.company_id = p_company and x.source_kind = 'production' and x.source_line_id = p_job), 0)
      + coalesce((select sum(x.gross_weight_kg - x.tare_weight_kg) from public.prepared_physical_bundles x where x.company_id = p_company and x.source_kind = 'production'
          and x.source_line_id = p_job and x.dispatch_id is null), 0),
    coalesce((select sum(x.quantity_kg) from public.treatment_inputs x where x.company_id = p_company and x.production_job_id = p_job), 0))
$$;
revoke all on function private.olo_prior_approvals(uuid), private.olo_job_consumed_kg(uuid, uuid) from public, anon, authenticated;

-- Containment commands: the batch 2 command moves behind a wrapper that adds the per-approval review.
alter function public.quality_containment_command(text, jsonb) rename to olo_containment_command_b2;
alter function public.olo_containment_command_b2(text, jsonb) set schema private;
revoke all on function private.olo_containment_command_b2(text, jsonb) from public, anon, authenticated;

create or replace function public.quality_containment_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_payload jsonb := coalesce(p_payload, '{}'::jsonb); a jsonb; v_actor uuid; v_company uuid; v_role text; c public.quality_containments%rowtype;
  q public.quality_inspections%rowtype; v jsonb; v_outcome text; v_approved numeric; v_consumed numeric; v_resolves boolean; v_pending numeric; v_order text;
  pr public.containment_prior_reviews%rowtype; v_open_revocations integer;
begin
  if p_command = 'get' then
    v := private.olo_containment_command_b2('get', v_payload);
    a := private.olo_actor(private.olo_reader_roles());
    return v || jsonb_build_object('prior_approvals', (select coalesce(jsonb_agg(jsonb_build_object('inspection_id', x.id, 'batch_number', x.batch_number,
        'quantity_kg', x.quantity_checked_kg, 'inspection_date', x.inspection_date, 'inspector_name', x.inspector_name,
        'review', (select jsonb_build_object('id', r.id, 'outcome', r.outcome, 'method', r.method, 'note', r.note, 'reviewed_at', r.reviewed_at,
            'reviewed_by_name', (select full_name from public.app_users u where u.id = r.reviewed_by), 'closed_at', r.closed_at, 'close_method', r.close_method,
            'close_note', r.close_note, 'closed_by_name', (select full_name from public.app_users u where u.id = r.closed_by),
            'can_close', r.outcome = 'revoked' and r.closed_at is null and (a ->> 'role') in ('owner','factory_manager') and (r.reviewed_by <> (a ->> 'actor')::uuid or (a ->> 'role') = 'owner'))
          from public.containment_prior_reviews r where r.containment_id = (v ->> 'id')::uuid and r.quality_inspection_id = x.id)) order by x.created_at, x.id), '[]'::jsonb)
        from private.olo_prior_approvals((v ->> 'id')::uuid) x),
      'can_review', (a ->> 'role') in ('owner','quality') and v ->> 'status' in ('open','partially_resolved'));
  end if;

  if p_command = 'release' then
    a := private.olo_actor(private.olo_reader_roles());
    select * into c from public.quality_containments where id = (v_payload ->> 'id')::uuid and company_id = (a ->> 'company')::uuid for update;
    if found and c.status in ('open','partially_resolved') and c.suspended_approved_kg > 0.0005 then
      if c.inspection_mode = 'full_inspection' then
        select coalesce(sum(quantity_kg), 0) into v_pending from public.containment_results where containment_id = c.id and released_lot_id is null;
        v_resolves := c.released_accepted_kg + c.released_rejected_kg + v_pending >= c.scope_kg - 0.001;
      else
        v_resolves := true;
      end if;
      if v_resolves then
        select count(*) into v_open_revocations from public.containment_prior_reviews r where r.containment_id = c.id and r.outcome = 'revoked' and r.closed_at is null;
        raise exception '%', case when v_open_revocations > 0
          then format('%s revoked earlier approval(s) are still open. The factory manager or owner closes each with the re-verification evidence before the lot is fully resolved.', v_open_revocations)
          else format('%s kg of this job was approved before the containment and is not yet reviewed. Reconfirm or revoke each earlier approval before the lot is fully resolved.', trim_scale(c.suspended_approved_kg)) end
          using errcode = '23514';
      end if;
    end if;
    return private.olo_containment_command_b2('release', v_payload - 'prior_approved_confirmed');
  end if;

  if p_command not in ('prior_review','prior_close') then return private.olo_containment_command_b2(p_command, v_payload); end if;

  a := private.olo_actor(private.olo_reader_roles());
  v_actor := (a ->> 'actor')::uuid; v_company := (a ->> 'company')::uuid; v_role := a ->> 'role';

  if p_command = 'prior_close' then
    if v_role not in ('owner','factory_manager') then raise exception 'Only the factory manager or owner closes a revoked approval' using errcode = '42501'; end if;
    perform private.olo_keys(v_payload, array['id','review_id','method','note']);
    select * into c from public.quality_containments where id = (v_payload ->> 'id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Containment not found' using errcode = '23514'; end if;
    if c.status not in ('open','partially_resolved') then raise exception 'This containment is already closed' using errcode = '23514'; end if;
    select * into pr from public.containment_prior_reviews where id = (v_payload ->> 'review_id')::uuid and containment_id = c.id for update;
    if not found or pr.outcome <> 'revoked' then raise exception 'Choose a revoked approval of this containment' using errcode = '23514'; end if;
    if pr.closed_at is not null then raise exception 'This revocation is already closed' using errcode = '23514'; end if;
    if pr.reviewed_by = v_actor and v_role <> 'owner' then raise exception 'The person who revoked the approval cannot also close it' using errcode = '42501'; end if;
    if length(btrim(coalesce(v_payload ->> 'method', ''))) < 2 then raise exception 'Record how the material was re-verified' using errcode = '23514'; end if;
    if length(btrim(coalesce(v_payload ->> 'note', ''))) < 10 then raise exception 'Record the re-verification evidence (at least 10 characters)' using errcode = '23514'; end if;
    update public.containment_prior_reviews set closed_by = v_actor, closed_by_role = v_role, closed_at = clock_timestamp(),
      close_method = btrim(v_payload ->> 'method'), close_note = btrim(v_payload ->> 'note') where id = pr.id;
    update public.quality_containments set suspended_approved_kg = greatest(suspended_approved_kg - pr.quantity_kg, 0) where id = c.id returning * into c;
    perform private.olo_event(v_company, 'qc.prior_revocation_closed', c.order_id, c.production_job_id, 'factory_management',
      format('%s: revoked approval of %s closed by %s after re-verification — %s', c.containment_number, private.olo_fmt_kg(pr.quantity_kg), a ->> 'name', btrim(v_payload ->> 'note')),
      jsonb_build_object('containment_id', c.id, 'review_id', pr.id, 'method', btrim(v_payload ->> 'method')), null);
    update public.notifications set resolved_at = clock_timestamp(), resolution = 'Resolved: revocation closed after re-verification', is_read = true, read_at = coalesce(read_at, now())
      where company_id = v_company and condition_key = 'olo-prior-revoked:' || pr.quality_inspection_id and resolved_at is null;
    return jsonb_build_object('id', c.id, 'review_id', pr.id, 'closed', true, 'suspended_approved_kg', c.suspended_approved_kg);
  end if;

  if v_role not in ('owner','quality') then raise exception 'Only QA/QC reviews earlier approvals under a containment' using errcode = '42501'; end if;
  perform private.olo_keys(v_payload, array['id','inspection_id','outcome','method','note']);
  select * into c from public.quality_containments where id = (v_payload ->> 'id')::uuid and company_id = v_company for update;
  if not found then raise exception 'Containment not found' using errcode = '23514'; end if;
  if c.status not in ('open','partially_resolved') then raise exception 'This containment is already closed' using errcode = '23514'; end if;
  select * into q from public.quality_inspections x where x.id = (v_payload ->> 'inspection_id')::uuid and x.company_id = v_company
    and x.id in (select p.id from private.olo_prior_approvals(c.id) p);
  if not found then raise exception 'Choose an approval of this job recorded before the containment opened' using errcode = '23514'; end if;
  if exists (select 1 from public.containment_prior_reviews r where r.containment_id = c.id and r.quality_inspection_id = q.id) then
    raise exception 'This approval is already reviewed under this containment' using errcode = '23514';
  end if;
  v_outcome := v_payload ->> 'outcome';
  if v_outcome not in ('reconfirmed','revoked') then raise exception 'Reconfirm or revoke the approval' using errcode = '23514'; end if;
  if length(btrim(coalesce(v_payload ->> 'method', ''))) < 2 then raise exception 'Record how the material was re-checked' using errcode = '23514'; end if;
  if length(btrim(coalesce(v_payload ->> 'note', ''))) < 10 then raise exception 'Record the review finding (at least 10 characters)' using errcode = '23514'; end if;
  insert into public.containment_prior_reviews(company_id, containment_id, quality_inspection_id, outcome, quantity_kg, method, note, reviewed_by)
    values (v_company, c.id, q.id, v_outcome, q.quantity_checked_kg, btrim(v_payload ->> 'method'), btrim(v_payload ->> 'note'), v_actor);
  if v_outcome = 'reconfirmed' then
    update public.quality_containments set suspended_approved_kg = greatest(suspended_approved_kg - q.quantity_checked_kg, 0) where id = c.id returning * into c;
  end if;
  perform private.olo_event(v_company, 'qc.prior_approval_' || v_outcome, c.order_id, c.production_job_id, 'quality',
    format('%s: earlier approval %s (%s) %s — %s', c.containment_number, coalesce(q.batch_number, 'inspection'), private.olo_fmt_kg(q.quantity_checked_kg),
      case when v_outcome = 'revoked' then 'revoked; the job''s material stays blocked' else 'reconfirmed' end, btrim(v_payload ->> 'note')),
    jsonb_build_object('containment_id', c.id, 'inspection_id', q.id, 'method', btrim(v_payload ->> 'method')), null);
  if v_outcome = 'revoked' then
    select order_number into v_order from public.orders where id = c.order_id;
    select coalesce(sum(x.quantity_checked_kg), 0) into v_approved from public.quality_inspections x
      where x.company_id = v_company and x.production_job_id = c.production_job_id and x.finishing_job_id is null and x.status = 'approved';
    v_consumed := private.olo_job_consumed_kg(v_company, c.production_job_id);
    perform private.ap3_notify_roles(v_company, private.olo_uniq(private.olo_roles(v_company, 'factory_management', 0) || private.olo_roles(v_company, 'quality', 0)
        || private.olo_roles(v_company, 'production_planning', 0) || case when v_consumed > 0.001 then private.olo_roles(v_company, 'dispatch', 0) else '{}'::text[] end),
      'olo_prior_approval_revoked', case when v_consumed > 0.001 then 'critical' else 'warning' end, format('QC approval revoked under %s', c.containment_number),
      format('QA revoked an earlier approval of %s for order %s: %s. The job''s material stays blocked until the factory manager or owner closes the revocation with re-verification evidence.%s',
        private.olo_fmt_kg(q.quantity_checked_kg), coalesce(v_order, '-'), btrim(v_payload ->> 'note'),
        case when v_consumed > 0.001 then format(' %s of this job has already moved to ageing, packaging or dispatch: trace those bundles and hold or recall them.', private.olo_fmt_kg(v_consumed)) else '' end),
      'quality_containment', c.id, '/quality/containment/' || c.id, 'olo-prior-revoked:' || q.id, v_actor);
  end if;
  perform private.olo_verify_tasks(v_company);
  return jsonb_build_object('id', c.id, 'inspection_id', q.id, 'outcome', v_outcome, 'suspended_approved_kg', c.suspended_approved_kg,
    'moved_on_kg', case when v_outcome = 'revoked' then v_consumed end);
end;
$$;
revoke all on function public.quality_containment_command(text, jsonb) from public, anon;
grant execute on function public.quality_containment_command(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Evaluations
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_evaluate_dispatch_clearance(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare d record; t public.tasks%rowtype; k jsonb; v_n integer := 0; v_cycle integer;
begin
  for d in select x.id, x.dispatch_number, x.order_id, o.order_number from public.dispatches x join public.orders o on o.id = x.order_id and o.company_id = x.company_id
      where x.company_id = p_company and x.delivery_status = 'pending' and x.created_at > now() - interval '60 days'
        and exists (select 1 from public.packing_list_items p where p.dispatch_id = x.id) loop
    select * into t from public.tasks x where x.company_id = p_company and x.workflow_kind = 'dispatch_clearance' and x.workflow_source_id = d.id order by x.workflow_cycle desc limit 1;
    continue when t.id is not null and t.status in ('open','in_progress');
    k := private.olo_dispatch_clearance(p_company, d.id);
    continue when k ->> 'state' <> 'blocked';
    v_cycle := coalesce(t.workflow_cycle, 0) + 1;
    perform private.olo_event(p_company, 'finance.dispatch_clearance_required', d.order_id, null, 'finance',
      format('Dispatch %s waits for finance clearance (%s)', d.dispatch_number, k -> 'terms' ->> 'label'), jsonb_build_object('dispatch_id', d.id, 'terms', k -> 'terms'),
      'dispatch_clearance:' || d.id || ':' || v_cycle);
    v_n := v_n + private.olo_create_task(p_company, 'dispatch_clearance', 'finance', v_cycle, d.order_id, null, d.id,
      format('Finance clearance for dispatch %s', d.dispatch_number),
      format('Dispatch %s for order %s is packed and waiting. The order is on %s (%s). Confirm the customer''s payment against the order, or record a release; the dispatch cannot leave the gate until then.%s',
        d.dispatch_number, d.order_number, k -> 'terms' ->> 'label', case k -> 'terms' ->> 'scope' when 'order' then 'set for this order' when 'customer' then 'set for this customer' else 'company default' end,
        case when not (k ->> 'priced')::boolean then ' Some bundles have no rate, so the dispatch value cannot be checked automatically.' else '' end),
      'high', '/dispatches/clearance/' || d.id, private.olo_roles(p_company, 'dispatch', 0) || private.olo_roles(p_company, 'sales', 1));
  end loop;
  return v_n;
end;
$$;

create or replace function private.olo_evaluate_intimation(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare d record; t public.tasks%rowtype; v_n integer := 0; v_cycle integer;
begin
  for d in select x.id, x.dispatch_number, x.order_id, o.order_number, x.lr_number, x.vehicle_number from public.dispatches x
      join public.orders o on o.id = x.order_id and o.company_id = x.company_id
      where x.company_id = p_company and x.actual_dispatched_at is not null and x.actual_dispatched_at > now() - interval '7 days' and o.customer_id is not null
        and o.opening_cutover_id is null loop
    continue when exists (select 1 from public.dispatch_communications m where m.dispatch_id = d.id and m.status in ('sent','delivered','read'));
    select * into t from public.tasks x where x.company_id = p_company and x.workflow_kind = 'dispatch_intimation' and x.workflow_source_id = d.id order by x.workflow_cycle desc limit 1;
    continue when t.id is not null and t.status in ('open','in_progress');
    v_cycle := coalesce(t.workflow_cycle, 0) + 1;
    v_n := v_n + private.olo_create_task(p_company, 'dispatch_intimation', 'dispatch', v_cycle, d.order_id, null, d.id,
      format('Send the dispatch update to the customer: %s', d.dispatch_number),
      format('Dispatch %s for order %s has left (vehicle %s, LR %s). Send the customer the dispatch details and record the message as sent.%s',
        d.dispatch_number, d.order_number, coalesce(d.vehicle_number, 'not recorded'), coalesce(d.lr_number, 'not recorded'),
        case when v_cycle > 1 then ' The earlier message was recorded as failed.' else '' end),
      'normal', '/dispatches/communications/' || d.id, private.olo_roles(p_company, 'sales', 0));
  end loop;
  return v_n;
end;
$$;

alter function private.olo_verify_tasks(uuid) rename to olo_verify_tasks_b2;
create or replace function private.olo_verify_tasks(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare t public.tasks%rowtype; v_n integer := private.olo_verify_tasks_b2(p_company); k jsonb; v_status text;
begin
  for t in select * from public.tasks x where x.company_id = p_company and x.workflow_key is not null and x.status in ('open','in_progress')
      and x.workflow_kind in ('dispatch_clearance','dispatch_intimation') order by x.created_at for update skip locked loop
    if t.workflow_kind = 'dispatch_clearance' then
      k := private.olo_dispatch_clearance(p_company, t.workflow_source_id);
      if k is null then
        perform private.olo_close_task(t, false, 'Withdrawn: the dispatch no longer exists', null); v_n := v_n + 1;
      elsif k ->> 'state' in ('covered','released','not_required','dispatched') then
        perform private.olo_close_task(t, true, case k ->> 'state' when 'covered' then 'Verified: receipts cover the dispatch under the customer''s terms'
            when 'released' then 'Verified: accounts recorded a release for this dispatch' when 'dispatched' then 'Verified: the dispatch left under finance clearance'
            else 'Verified: the order is now on credit terms' end,
          jsonb_build_object('state', k ->> 'state', 'terms', k -> 'terms' ->> 'terms', 'release_id', k -> 'release' ->> 'id')); v_n := v_n + 1;
      end if;
    else
      select delivery_status into v_status from public.dispatches where id = t.workflow_source_id;
      if v_status is null then
        perform private.olo_close_task(t, false, 'Withdrawn: the dispatch no longer exists', null); v_n := v_n + 1;
      elsif exists (select 1 from public.dispatch_communications m where m.dispatch_id = t.workflow_source_id and m.status in ('sent','delivered','read')) then
        perform private.olo_close_task(t, true, 'Verified: the dispatch update was recorded as sent to the customer',
          (select jsonb_build_object('communication_id', m.id, 'channel', m.channel, 'status', m.status, 'sent_at', m.sent_at) from public.dispatch_communications m
            where m.dispatch_id = t.workflow_source_id and m.status in ('sent','delivered','read') order by m.sent_at desc limit 1)); v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

alter function private.olo_run_all(uuid, text) rename to olo_run_all_b2;
create or replace function private.olo_run_all(p_company uuid, p_source text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v jsonb := private.olo_run_all_b2(p_company, p_source);
begin
  return v || jsonb_build_object('clearance_tasks', private.olo_evaluate_dispatch_clearance(p_company), 'intimation_tasks', private.olo_evaluate_intimation(p_company),
    'verified_after_dispatch', private.olo_verify_tasks(p_company));
end;
$$;
revoke all on function private.olo_evaluate_dispatch_clearance(uuid), private.olo_evaluate_intimation(uuid), private.olo_verify_tasks_b2(uuid), private.olo_verify_tasks(uuid),
  private.olo_run_all_b2(uuid, text), private.olo_run_all(uuid, text) from public, anon, authenticated;

create or replace function private.olo_after_dispatch_finance_change() returns trigger language plpgsql security definer set search_path = public, private as $$
declare c record;
begin
  if coalesce(current_setting('olo.engine', true), '') = 'running' then return null; end if;
  perform set_config('olo.engine', 'running', true);
  for c in select id from public.companies order by created_at loop
    begin
      perform private.olo_evaluate_dispatch_clearance(c.id);
      if tg_table_name = 'dispatches' then perform private.olo_evaluate_intimation(c.id); end if;
      perform private.olo_verify_tasks(c.id);
    exception when others then
      insert into public.olo_engine_errors(company_id, source, message) values (c.id, left(tg_table_name || ':batch3', 80), left(sqlerrm, 500));
    end;
  end loop;
  perform set_config('olo.engine', '', true);
  return null;
end;
$$;
revoke all on function private.olo_after_dispatch_finance_change() from public, anon, authenticated;
create trigger zzz_olo_b3_dispatches after insert or update of delivery_status on public.dispatches for each statement execute function private.olo_after_dispatch_finance_change();
create trigger zzz_olo_b3_packing after insert or delete on public.packing_list_items for each statement execute function private.olo_after_dispatch_finance_change();
create trigger zzz_olo_b3_payments after insert or update on public.payments for each statement execute function private.olo_after_dispatch_finance_change();
create trigger zzz_olo_b3_on_account after insert or update on public.customer_on_account_credits for each statement execute function private.olo_after_dispatch_finance_change();

-- ---------------------------------------------------------------------------------------------------------------
-- Lifecycle: finance clearance of pending dispatches and customer communication (wraps the batch 2 derivation)
-- ---------------------------------------------------------------------------------------------------------------
alter function private.olo_order_core(uuid, uuid, boolean, boolean) rename to olo_order_core_b2;
create or replace function private.olo_order_core(p_company uuid, p_order uuid, p_finance boolean, p_with_gates boolean) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v jsonb := private.olo_order_core_b2(p_company, p_order, p_finance, p_with_gates); v_terms jsonb := private.olo_dispatch_terms(p_company, p_order);
  v_blocked record; v_uninformed record; v_dept text;
begin
  select x.id, x.dispatch_number into v_blocked from public.dispatches x where x.company_id = p_company and x.order_id = p_order and x.delivery_status = 'pending'
    and exists (select 1 from public.packing_list_items p where p.dispatch_id = x.id)
    and private.olo_dispatch_clearance(p_company, x.id) ->> 'state' = 'blocked' order by x.created_at limit 1;
  select x.id, x.dispatch_number into v_uninformed from public.dispatches x where x.company_id = p_company and x.order_id = p_order and x.actual_dispatched_at is not null
    and x.actual_dispatched_at > now() - interval '30 days'
    and not exists (select 1 from public.dispatch_communications m where m.dispatch_id = x.id and m.status in ('sent','delivered','read')) order by x.actual_dispatched_at limit 1;
  v := jsonb_set(v, '{domains}', (select jsonb_agg(case
      when d ->> 'key' = 'finance_clearance' and v_blocked.id is not null and d ->> 'status' <> 'blocked'
        then d || jsonb_build_object('status', 'dispatch_blocked', 'detail', format('Dispatch %s waits for finance clearance · terms: %s', v_blocked.dispatch_number, v_terms ->> 'label'))
      when d ->> 'key' = 'finance_clearance' then d || jsonb_build_object('detail', (d ->> 'detail') || ' · terms: ' || (v_terms ->> 'label'))
      when d ->> 'key' = 'dispatch' and v_uninformed.id is not null
        then d || jsonb_build_object('detail', (d ->> 'detail') || format(' · customer not yet informed of %s', v_uninformed.dispatch_number))
      else d end) from jsonb_array_elements(v -> 'domains') d));
  v := v || jsonb_build_object('dispatch_terms', v_terms);
  v_dept := v -> 'next_action' ->> 'department';
  if v_blocked.id is not null and v_dept = 'dispatch' then
    v := jsonb_set(v, '{next_action}', jsonb_build_object('label', format('Clear dispatch %s under the order''s %s', v_blocked.dispatch_number, v_terms ->> 'label'),
      'department', 'finance', 'link', '/dispatches/clearance/' || v_blocked.id));
    if jsonb_typeof(v -> 'blocker') is distinct from 'object' then
      v := jsonb_set(v, '{blocker}', jsonb_build_object('label', format('Dispatch %s awaits finance clearance', v_blocked.dispatch_number), 'department', 'finance'));
    end if;
  elsif v_uninformed.id is not null and (v_dept is null or v_dept = 'dispatch') and v ->> 'overall' not in ('cancelled','fully_closed') then
    v := jsonb_set(v, '{next_action}', jsonb_build_object('label', format('Send the dispatch update for %s to the customer', v_uninformed.dispatch_number),
      'department', 'dispatch', 'link', '/dispatches/communications/' || v_uninformed.id));
  end if;
  return v;
end;
$$;
revoke all on function private.olo_order_core_b2(uuid, uuid, boolean, boolean), private.olo_order_core(uuid, uuid, boolean, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_clearance_view(p_company uuid, p_dispatch uuid, p_finance boolean) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when k is null then null else
    (case when p_finance then k else k - 'amounts' end) || jsonb_build_object('dispatch_number', d.dispatch_number, 'order_id', d.order_id, 'order_number', o.order_number,
      'customer_name', (select coalesce(nullif(c.company_name, ''), c.customer_name) from public.customers c where c.id = o.customer_id),
      'created_at', d.created_at, 'delivery_status', d.delivery_status, 'bundles', (select count(*) from public.packing_list_items p where p.dispatch_id = d.id),
      'net_weight_kg', (select coalesce(sum(p.net_weight_kg), 0) from public.packing_list_items p where p.dispatch_id = d.id)) end
  from (select private.olo_dispatch_clearance(p_company, p_dispatch) k) kk
  left join public.dispatches d on d.id = p_dispatch left join public.orders o on o.id = d.order_id
$$;
revoke all on function private.olo_clearance_view(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.dispatch_finance_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare a jsonb := private.olo_actor(private.olo_reader_roles()); v_actor uuid := (a ->> 'actor')::uuid; v_company uuid := (a ->> 'company')::uuid; v_role text := a ->> 'role';
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb); v_finance boolean := (a ->> 'role') = any(private.olo_finance_roles()); v_page integer := private.olo_page(coalesce(p_payload, '{}'::jsonb));
  v_rows jsonb; v_total bigint; d public.dispatches%rowtype; o public.orders%rowtype; k jsonb; r public.dispatch_finance_releases%rowtype; t public.dispatch_finance_terms%rowtype;
  v_scope text; v_customer uuid; v_order uuid; v_terms text; v_pct numeric; v_basis text; v_view text;
begin
  if p_command in ('terms.set','terms.clear','release','revoke') and not v_finance then
    raise exception 'Only accounts, the admin or the owner record payment terms and finance clearance' using errcode = '42501';
  end if;

  if p_command = 'queue' then
    perform private.olo_keys(v_payload, array['view','page']);
    v_view := coalesce(nullif(v_payload ->> 'view', ''), 'attention');
    if v_view not in ('attention','pending') then raise exception 'Unknown view' using errcode = '22023'; end if;
    select coalesce(jsonb_agg(x.r order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
      select private.olo_clearance_view(v_company, y.id, v_finance) r, count(*) over () total, row_number() over (order by y.created_at, y.id) ord
      from (select d2.id, d2.created_at, private.olo_dispatch_clearance(v_company, d2.id) ->> 'state' st from public.dispatches d2
            where d2.company_id = v_company and d2.delivery_status = 'pending' and d2.created_at > now() - interval '60 days'
              and exists (select 1 from public.packing_list_items p where p.dispatch_id = d2.id)) y
      where v_view = 'pending' or y.st in ('blocked','released')
      order by y.created_at, y.id offset (v_page - 1) * 10 limit 10) x;
    return jsonb_build_object('view', v_view, 'page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows, 'finance_visible', v_finance,
      'can_release', v_finance, 'can_set_terms', v_finance,
      'company_terms', (select jsonb_build_object('id', x.id, 'terms', x.terms, 'advance_percent', x.advance_percent, 'label', private.olo_terms_label(x.terms, x.advance_percent), 'reason', x.reason)
        from public.dispatch_finance_terms x where x.company_id = v_company and x.status = 'active' and x.scope = 'company'));
  end if;

  if p_command = 'terms.list' then
    perform private.olo_keys(v_payload, array['page']);
    select coalesce(jsonb_agg(x.r order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
      select jsonb_build_object('id', t2.id, 'scope', t2.scope, 'terms', t2.terms, 'advance_percent', t2.advance_percent, 'label', private.olo_terms_label(t2.terms, t2.advance_percent),
          'reason', t2.reason, 'set_at', t2.set_at, 'set_by_name', (select full_name from public.app_users u where u.id = t2.set_by),
          'customer_id', t2.customer_id, 'customer_name', (select coalesce(nullif(c.company_name, ''), c.customer_name) from public.customers c where c.id = t2.customer_id),
          'order_id', t2.order_id, 'order_number', (select order_number from public.orders od where od.id = t2.order_id)) r,
        count(*) over () total, row_number() over (order by case t2.scope when 'company' then 0 when 'customer' then 1 else 2 end, t2.set_at desc) ord
      from public.dispatch_finance_terms t2 where t2.company_id = v_company and t2.status = 'active'
      order by ord offset (v_page - 1) * 10 limit 10) x;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows, 'can_set_terms', v_finance,
      'customers', case when v_finance then (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(nullif(c.company_name, ''), c.customer_name)) order by coalesce(nullif(c.company_name, ''), c.customer_name)), '[]'::jsonb)
        from (select * from public.customers c where c.company_id = v_company and c.deleted_at is null and coalesce(c.is_active, true) order by coalesce(nullif(c.company_name, ''), c.customer_name) limit 500) c) else '[]'::jsonb end);
  end if;

  if p_command = 'terms.set' then
    perform private.olo_keys(v_payload, array['scope','customer_id','order_id','terms','advance_percent','reason']);
    v_scope := v_payload ->> 'scope'; v_terms := v_payload ->> 'terms'; v_pct := nullif(v_payload ->> 'advance_percent', '')::numeric;
    if v_scope not in ('company','customer','order') then raise exception 'Choose who the terms apply to' using errcode = '23514'; end if;
    if v_terms not in ('credit','advance_part','payment_before_dispatch') then raise exception 'Choose the payment terms' using errcode = '23514'; end if;
    if v_terms = 'advance_part' and (v_pct is null or v_pct <= 0 or v_pct > 100) then raise exception 'Record the advance percentage (above 0, at most 100)' using errcode = '23514'; end if;
    if v_terms <> 'advance_part' then v_pct := null; end if;
    if length(btrim(coalesce(v_payload ->> 'reason', ''))) < 5 then raise exception 'Record why these terms apply' using errcode = '23514'; end if;
    if v_scope = 'customer' then
      select id into v_customer from public.customers where id = (v_payload ->> 'customer_id')::uuid and company_id = v_company and deleted_at is null;
      if v_customer is null then raise exception 'Choose a customer of this company' using errcode = '23514'; end if;
    elsif v_scope = 'order' then
      select * into o from public.orders where id = (v_payload ->> 'order_id')::uuid and company_id = v_company and deleted_at is null;
      if o.id is null or o.current_stage in ('closed','cancelled') then raise exception 'Choose an open order of this company' using errcode = '23514'; end if;
      v_order := o.id; v_customer := o.customer_id;
    end if;
    update public.dispatch_finance_terms set status = 'superseded', superseded_by = v_actor, superseded_at = clock_timestamp(), superseded_note = 'Replaced by new terms'
      where company_id = v_company and status = 'active' and scope = v_scope
        and (v_scope = 'company' or (v_scope = 'customer' and customer_id = v_customer) or (v_scope = 'order' and order_id = v_order));
    insert into public.dispatch_finance_terms(company_id, scope, customer_id, order_id, terms, advance_percent, reason, set_by, set_by_role)
      values (v_company, v_scope, case when v_scope = 'customer' then v_customer end, v_order, v_terms, v_pct, btrim(v_payload ->> 'reason'), v_actor, v_role) returning * into t;
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
      values (v_company, v_actor, 'dispatch_terms.set', 'dispatch_finance_terms', t.id, jsonb_build_object('scope', v_scope, 'customer_id', t.customer_id, 'order_id', v_order, 'terms', v_terms, 'advance_percent', v_pct, 'reason', t.reason));
    if v_order is not null then
      perform private.olo_event(v_company, 'finance.dispatch_terms_set', v_order, null, 'finance', format('Dispatch terms for the order set to %s: %s', private.olo_terms_label(v_terms, v_pct), t.reason), '{}'::jsonb, null);
    end if;
    perform private.olo_evaluate_dispatch_clearance(v_company);
    perform private.olo_verify_tasks(v_company);
    return jsonb_build_object('id', t.id, 'label', private.olo_terms_label(v_terms, v_pct));
  end if;

  if p_command = 'terms.clear' then
    perform private.olo_keys(v_payload, array['id','reason']);
    if length(btrim(coalesce(v_payload ->> 'reason', ''))) < 5 then raise exception 'Record why the terms are removed' using errcode = '23514'; end if;
    update public.dispatch_finance_terms set status = 'superseded', superseded_by = v_actor, superseded_at = clock_timestamp(), superseded_note = btrim(v_payload ->> 'reason')
      where id = (v_payload ->> 'id')::uuid and company_id = v_company and status = 'active' returning * into t;
    if t.id is null then raise exception 'These terms are not active' using errcode = '23514'; end if;
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
      values (v_company, v_actor, 'dispatch_terms.cleared', 'dispatch_finance_terms', t.id, jsonb_build_object('reason', btrim(v_payload ->> 'reason')));
    perform private.olo_evaluate_dispatch_clearance(v_company);
    perform private.olo_verify_tasks(v_company);
    return jsonb_build_object('id', t.id, 'status', 'superseded');
  end if;

  if p_command = 'revoke' then
    perform private.olo_keys(v_payload, array['release_id','reason']);
    if length(btrim(coalesce(v_payload ->> 'reason', ''))) < 5 then raise exception 'Record why the release is withdrawn' using errcode = '23514'; end if;
    update public.dispatch_finance_releases set revoked_by = v_actor, revoked_at = clock_timestamp(), revoke_reason = btrim(v_payload ->> 'reason')
      where id = (v_payload ->> 'release_id')::uuid and company_id = v_company and revoked_at is null and consumed_at is null returning * into r;
    if r.id is null then raise exception 'This release is already used or withdrawn' using errcode = '23514'; end if;
    perform private.olo_event(v_company, 'finance.dispatch_release_revoked', r.order_id, null, 'finance', format('Finance release withdrawn: %s', btrim(v_payload ->> 'reason')), jsonb_build_object('dispatch_id', r.dispatch_id), null);
    perform private.olo_evaluate_dispatch_clearance(v_company);
    return jsonb_build_object('id', r.id, 'revoked', true);
  end if;

  select * into d from public.dispatches where id = (v_payload ->> 'dispatch_id')::uuid and company_id = v_company;
  if not found then raise exception 'Dispatch not found' using errcode = '23514'; end if;

  if p_command = 'status' then
    perform private.olo_keys(v_payload, array['dispatch_id']);
    return private.olo_clearance_view(v_company, d.id, v_finance) || jsonb_build_object('finance_visible', v_finance, 'can_release', v_finance and d.delivery_status = 'pending',
      'can_exception', v_role = 'owner' and d.delivery_status = 'pending',
      'releases', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'basis', x.basis, 'reference', x.reference, 'note', x.note, 'released_at', x.released_at,
          'expires_at', x.expires_at, 'consumed_at', x.consumed_at, 'revoked_at', x.revoked_at, 'revoke_reason', x.revoke_reason,
          'released_value', case when v_finance then x.released_value end, 'released_by_name', (select full_name from public.app_users u where u.id = x.released_by),
          'can_revoke', v_finance and x.revoked_at is null and x.consumed_at is null) order by x.released_at desc), '[]'::jsonb)
        from public.dispatch_finance_releases x where x.dispatch_id = d.id));
  end if;

  if p_command = 'release' then
    perform private.olo_keys(v_payload, array['dispatch_id','basis','reference','note']);
    if d.delivery_status <> 'pending' then raise exception 'This dispatch has already left' using errcode = '23514'; end if;
    k := private.olo_dispatch_clearance(v_company, d.id);
    if k ->> 'state' in ('not_required','covered') then
      raise exception 'No release is needed: %', case when k ->> 'state' = 'covered' then 'the receipts already cover this dispatch' else 'the order is on credit terms' end using errcode = '23514';
    end if;
    v_basis := v_payload ->> 'basis';
    if v_basis not in ('payment_confirmed','approved_exception') then raise exception 'Choose the basis of the release' using errcode = '23514'; end if;
    if v_basis = 'approved_exception' and v_role <> 'owner' then raise exception 'Only the owner releases a dispatch as an exception to its payment terms' using errcode = '42501'; end if;
    if v_basis = 'payment_confirmed' and length(btrim(coalesce(v_payload ->> 'reference', ''))) < 4 then
      raise exception 'Record the payment reference (UTR, cheque or receipt number)' using errcode = '23514';
    end if;
    if length(btrim(coalesce(v_payload ->> 'note', ''))) < 10 then raise exception 'Record the basis of the release (at least 10 characters)' using errcode = '23514'; end if;
    update public.dispatch_finance_releases set revoked_by = v_actor, revoked_at = clock_timestamp(), revoke_reason = 'Superseded by a new release'
      where dispatch_id = d.id and revoked_at is null and consumed_at is null;
    insert into public.dispatch_finance_releases(company_id, dispatch_id, order_id, basis, reference, note, terms, released_value, required_amount, received_amount,
      released_by, released_by_role, expires_at)
    values (v_company, d.id, d.order_id, v_basis, nullif(btrim(coalesce(v_payload ->> 'reference', '')), ''), btrim(v_payload ->> 'note'), k -> 'terms' ->> 'terms',
      (k -> 'amounts' ->> 'dispatch_value')::numeric, (k -> 'amounts' ->> 'required')::numeric, coalesce((k -> 'amounts' ->> 'received')::numeric, 0), v_actor, v_role,
      clock_timestamp() + interval '48 hours') returning * into r;
    perform private.olo_event(v_company, 'finance.dispatch_released', d.order_id, null, 'finance',
      format('Dispatch %s released by %s (%s)%s', d.dispatch_number, a ->> 'name', case v_basis when 'payment_confirmed' then 'payment confirmed' else 'owner exception' end,
        coalesce(', ref ' || r.reference, '')), jsonb_build_object('dispatch_id', d.id, 'release_id', r.id), null);
    perform private.olo_verify_tasks(v_company);
    return jsonb_build_object('id', r.id, 'expires_at', r.expires_at, 'state', private.olo_dispatch_clearance(v_company, d.id) ->> 'state');
  end if;
  raise exception 'Unknown finance clearance command' using errcode = '22023';
end;
$$;
revoke all on function public.dispatch_finance_command(text, jsonb) from public, anon;
grant execute on function public.dispatch_finance_command(text, jsonb) to authenticated;

create or replace function public.dispatch_comm_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare a jsonb := private.olo_actor(private.olo_reader_roles()); v_actor uuid := (a ->> 'actor')::uuid; v_company uuid := (a ->> 'company')::uuid; v_role text := a ->> 'role';
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb); v_page integer := private.olo_page(coalesce(p_payload, '{}'::jsonb)); v_rows jsonb; v_total bigint;
  v_senders text[] := array['owner','admin','dispatch_manager','dispatch','sales_manager','sales','factory_manager']; d public.dispatches%rowtype; o public.orders%rowtype;
  m public.dispatch_communications%rowtype; v_channel text; v_recipient text; v_digits text; v_body text; v_outbound uuid; v_status text; v_view text;
begin
  if p_command in ('record_sent','mark') and not (v_role = any(v_senders)) then
    raise exception 'Only dispatch, sales and management record customer messages' using errcode = '42501';
  end if;

  if p_command = 'queue' then
    perform private.olo_keys(v_payload, array['view','page']);
    v_view := coalesce(nullif(v_payload ->> 'view', ''), 'pending');
    if v_view = 'pending' then
      select coalesce(jsonb_agg(x.r order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
        select jsonb_build_object('dispatch_id', x2.id, 'dispatch_number', x2.dispatch_number, 'dispatched_at', x2.actual_dispatched_at, 'order_id', od.id, 'order_number', od.order_number,
            'customer_name', (select coalesce(nullif(c.company_name, ''), c.customer_name) from public.customers c where c.id = od.customer_id), 'vehicle_number', x2.vehicle_number,
            'lr_number', x2.lr_number, 'failed_attempts', (select count(*) from public.dispatch_communications m2 where m2.dispatch_id = x2.id and m2.status = 'failed')) r,
          count(*) over () total, row_number() over (order by x2.actual_dispatched_at, x2.id) ord
        from public.dispatches x2 join public.orders od on od.id = x2.order_id
        where x2.company_id = v_company and x2.actual_dispatched_at is not null and x2.actual_dispatched_at > now() - interval '14 days' and od.customer_id is not null
          and not exists (select 1 from public.dispatch_communications m2 where m2.dispatch_id = x2.id and m2.status in ('sent','delivered','read'))
        order by ord offset (v_page - 1) * 10 limit 10) x;
    elsif v_view = 'sent' then
      select coalesce(jsonb_agg(x.r order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
        select jsonb_build_object('id', m2.id, 'dispatch_id', m2.dispatch_id, 'dispatch_number', x2.dispatch_number, 'order_number', od.order_number, 'channel', m2.channel,
            'recipient', m2.recipient, 'status', m2.status, 'sent_at', m2.sent_at, 'sent_by_name', (select full_name from public.app_users u where u.id = m2.sent_by)) r,
          count(*) over () total, row_number() over (order by m2.sent_at desc, m2.id) ord
        from public.dispatch_communications m2 join public.dispatches x2 on x2.id = m2.dispatch_id left join public.orders od on od.id = m2.order_id
        where m2.company_id = v_company order by ord offset (v_page - 1) * 10 limit 10) x;
    else raise exception 'Unknown view' using errcode = '22023';
    end if;
    return jsonb_build_object('view', v_view, 'page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows, 'can_send', v_role = any(v_senders));
  end if;

  if p_command = 'mark' then
    perform private.olo_keys(v_payload, array['id','status','note']);
    select * into m from public.dispatch_communications where id = (v_payload ->> 'id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Message not found' using errcode = '23514'; end if;
    v_status := v_payload ->> 'status';
    if not ((m.status = 'sent' and v_status in ('delivered','read','failed')) or (m.status = 'delivered' and v_status in ('read','failed'))) then
      raise exception 'A message recorded as % cannot be marked %', m.status, coalesce(v_status, '-') using errcode = '23514';
    end if;
    if m.channel = 'phone_call' then raise exception 'A phone call is recorded as delivered when it is logged' using errcode = '23514'; end if;
    if v_status = 'failed' and length(btrim(coalesce(v_payload ->> 'note', ''))) < 5 then raise exception 'Record why the message failed' using errcode = '23514'; end if;
    update public.dispatch_communications set status = v_status, last_marked_by = v_actor,
      delivered_at = case when v_status in ('delivered','read') then coalesce(delivered_at, clock_timestamp()) else delivered_at end,
      read_at = case when v_status = 'read' then clock_timestamp() else read_at end,
      failed_at = case when v_status = 'failed' then clock_timestamp() end, failed_reason = case when v_status = 'failed' then btrim(v_payload ->> 'note') end,
      note = coalesce(nullif(left(btrim(coalesce(v_payload ->> 'note', '')), 300), ''), note)
      where id = m.id returning * into m;
    if m.outbound_message_id is not null then
      update public.outbound_messages set status = v_status, delivered_at = m.delivered_at, read_at = m.read_at, failed_reason = m.failed_reason where id = m.outbound_message_id;
    end if;
    perform private.olo_event(v_company, 'dispatch.customer_message_' || v_status, m.order_id, null, 'dispatch',
      format('Customer dispatch update %s (%s to %s)', v_status, replace(m.channel, '_', ' '), m.recipient), jsonb_build_object('communication_id', m.id), null);
    perform set_config('olo.engine', 'running', true);
    perform private.olo_evaluate_intimation(v_company);
    perform set_config('olo.engine', '', true);
    return jsonb_build_object('id', m.id, 'status', m.status);
  end if;

  select * into d from public.dispatches where id = (v_payload ->> 'dispatch_id')::uuid and company_id = v_company;
  if not found then raise exception 'Dispatch not found' using errcode = '23514'; end if;

  if p_command = 'facts' then
    perform private.olo_keys(v_payload, array['dispatch_id']);
    return private.olo_dispatch_facts(v_company, d.id) || jsonb_build_object('can_send', v_role = any(v_senders) and d.actual_dispatched_at is not null,
      'history', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'channel', x.channel, 'recipient', x.recipient, 'language', x.language, 'message_body', x.message_body,
          'status', x.status, 'sent_at', x.sent_at, 'delivered_at', x.delivered_at, 'read_at', x.read_at, 'failed_at', x.failed_at, 'failed_reason', x.failed_reason, 'note', x.note,
          'sent_by_name', (select full_name from public.app_users u where u.id = x.sent_by),
          'can_mark', v_role = any(v_senders) and x.channel <> 'phone_call' and x.status in ('sent','delivered')) order by x.sent_at desc), '[]'::jsonb)
        from public.dispatch_communications x where x.dispatch_id = d.id));
  end if;

  if p_command = 'record_sent' then
    perform private.olo_keys(v_payload, array['dispatch_id','channel','recipient','body','language']);
    if d.actual_dispatched_at is null then raise exception 'Record the dispatch update after the material leaves the gate' using errcode = '23514'; end if;
    select * into o from public.orders where id = d.order_id;
    v_channel := v_payload ->> 'channel';
    if v_channel not in ('whatsapp','sms','email','phone_call') then raise exception 'Choose how the customer was informed' using errcode = '23514'; end if;
    v_recipient := btrim(coalesce(v_payload ->> 'recipient', ''));
    if v_channel = 'email' then
      if v_recipient !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_recipient) > 120 then raise exception 'Record a valid email address' using errcode = '23514'; end if;
    else
      v_digits := regexp_replace(v_recipient, '[^0-9]', '', 'g');
      if length(v_digits) not between 10 and 15 or v_recipient !~ '^[+0-9 ()-]+$' then raise exception 'Record the phone number with 10 to 15 digits' using errcode = '23514'; end if;
      v_recipient := v_digits;
    end if;
    v_body := btrim(coalesce(v_payload ->> 'body', ''));
    if length(v_body) < 20 or length(v_body) > 2000 then raise exception 'The message must be 20 to 2000 characters' using errcode = '23514'; end if;
    if v_body ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception 'Remove control characters from the message' using errcode = '23514'; end if;
    if coalesce(v_payload ->> 'language', 'en') not in ('en','hi') then raise exception 'Unknown message language' using errcode = '22023'; end if;
    if v_channel in ('whatsapp','sms') then
      insert into public.outbound_messages(company_id, customer_id, related_entity_type, related_entity_id, channel, message_body, recipient_phone, status, sent_at, created_by)
        values (v_company, o.customer_id, 'dispatch', d.id, v_channel, v_body, v_recipient, 'manually_logged', clock_timestamp(), v_actor) returning id into v_outbound;
    end if;
    insert into public.dispatch_communications(company_id, dispatch_id, order_id, customer_id, channel, recipient, language, message_body, status, outbound_message_id, sent_by, delivered_at)
      values (v_company, d.id, d.order_id, o.customer_id, v_channel, v_recipient, coalesce(v_payload ->> 'language', 'en'), v_body,
        case when v_channel = 'phone_call' then 'delivered' else 'sent' end, v_outbound, v_actor, case when v_channel = 'phone_call' then clock_timestamp() end)
      returning * into m;
    perform private.olo_event(v_company, 'dispatch.customer_informed', d.order_id, null, 'dispatch',
      format('Customer informed of dispatch %s by %s (%s)', d.dispatch_number, replace(v_channel, '_', ' '), v_recipient), jsonb_build_object('communication_id', m.id), null);
    perform private.olo_verify_tasks(v_company);
    return jsonb_build_object('id', m.id, 'status', m.status);
  end if;
  raise exception 'Unknown dispatch communication command' using errcode = '22023';
end;
$$;
revoke all on function public.dispatch_comm_command(text, jsonb) from public, anon;
grant execute on function public.dispatch_comm_command(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security (reads only; writes go through the commands)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.dispatch_finance_terms enable row level security;
alter table public.dispatch_finance_releases enable row level security;
alter table public.dispatch_communications enable row level security;
alter table public.containment_prior_reviews enable row level security;
revoke all on public.dispatch_finance_terms, public.dispatch_finance_releases, public.dispatch_communications, public.containment_prior_reviews from public, anon, authenticated;
grant select on public.dispatch_finance_terms, public.dispatch_finance_releases, public.dispatch_communications, public.containment_prior_reviews to authenticated;
grant execute on function private.olo_finance_roles() to authenticated;
create policy dispatch_finance_terms_read on public.dispatch_finance_terms for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy dispatch_finance_releases_read on public.dispatch_finance_releases for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_finance_roles()));
create policy dispatch_communications_read on public.dispatch_communications for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy containment_prior_reviews_read on public.containment_prior_reviews for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));

-- ---------------------------------------------------------------------------------------------------------------
-- Live screens (Realtime delivers a row only to sessions whose read policy admits it)
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['olo_events', 'olo_task_events', 'quality_containments', 'die_preparation_events', 'dispatch_communications'] loop
      if not exists (select 1 from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid
          where p.pubname = 'supabase_realtime' and pr.prrelid = ('public.' || quote_ident(t))::regclass) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- First evaluation (dispatches of the last 60 / 7 days only; failures logged, not fatal).
do $$
declare c record;
begin
  for c in select id from public.companies loop
    begin
      perform set_config('olo.engine', 'running', true);
      perform private.olo_evaluate_dispatch_clearance(c.id);
      perform private.olo_evaluate_intimation(c.id);
      perform set_config('olo.engine', '', true);
    exception when others then
      insert into public.olo_engine_errors(company_id, source, message) values (c.id, 'batch3:first_run', left(sqlerrm, 500));
    end;
  end loop;
end;
$$;

commit;
