-- Autopilot batch 3 (AUTOPILOT_UPGRADES.md, "Order-to-cash autopilot"): AP-045 draft production jobs on confirmation,
-- AP-046 draft invoices at gate-out, AP-032 credit holds at confirmation and dispatch, AP-058 oldest-first receipt
-- allocation with on-account balances, AP-024 bank statement import and matching, AP-084 payment reminder queue,
-- AP-031 quotation expiry and requote, AP-037 place of supply from GSTIN, AP-097 duplicate warnings, AP-098 alerts that
-- close themselves when their condition clears.
--
-- Additive only. Builds on batches 1 and 2 (proposals, scheduled jobs, factory calendar) and on the existing reviewed
-- invoice, financial receipt, production job and quote revision transactions, which it calls rather than repeats. Every
-- new table carries company_id with RLS and a company index; clients read and write only through security-definer
-- functions that take the company and the actor from the session. Nothing here posts money or sends a customer message
-- by itself: invoice drafts carry no number until accounts posts them through the reviewed invoice path, bank matches and
-- receipt allocations post only when a person accepts them, and reminders are prepared for a person to send.
-- Messages for people start 'AP: '.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ---------------------------------------------------------------------------------------------------------------
-- Extend earlier check lists (supersets only) and add nullable columns
-- ---------------------------------------------------------------------------------------------------------------
alter table public.proposals drop constraint if exists proposals_proposal_type_check;
alter table public.proposals add constraint proposals_proposal_type_check check (proposal_type in (
  'navigation.role_layout', 'period.close_month', 'series.adopt',
  'production.expected_output', 'die.service_due', 'maintenance.pm_due',
  'bank.receipt_match'));

-- AP-098: alerts and tasks remember the condition that raised them and how they were resolved.
alter table public.notifications add column if not exists condition_key text;
alter table public.notifications add column if not exists resolved_at timestamptz;
alter table public.notifications add column if not exists resolution text check (resolution is null or length(resolution) <= 300);
create index if not exists notifications_condition_open_idx on public.notifications(company_id, condition_key) where resolved_at is null and condition_key is not null;
alter table public.tasks add column if not exists resolved_by_system_at timestamptz;
alter table public.tasks add column if not exists system_resolution text check (system_resolution is null or length(system_resolution) <= 300);

-- ---------------------------------------------------------------------------------------------------------------
-- Order-to-cash settings (one row per company; defaults apply until accounts saves them)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.o2c_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  credit_approver_roles text[] not null default array['owner', 'accounts'],
  credit_approval_hours integer not null default 72 check (credit_approval_hours between 1 and 720),
  quote_extension_needs_approval boolean not null default true,
  quote_extension_roles text[] not null default array['owner', 'admin', 'sales_manager'],
  reminder_steps integer[] not null default array[-3, 0, 7, 15, 30],
  reminder_repeat_days integer not null default 7 check (reminder_repeat_days between 1 and 60),
  duplicate_window_days integer not null default 3 check (duplicate_window_days between 1 and 30),
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default now(),
  check (cardinality(credit_approver_roles) between 1 and 4 and credit_approver_roles <@ array['owner', 'admin', 'accounts', 'sales_manager']),
  check (cardinality(quote_extension_roles) between 1 and 4 and quote_extension_roles <@ array['owner', 'admin', 'sales_manager', 'accounts']),
  check (cardinality(reminder_steps) between 1 and 8 and -30 <= all(reminder_steps) and 180 >= all(reminder_steps))
);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-032: customer credit limits (versioned) and order credit holds
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.customer_credit_limits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  credit_limit numeric(14,2) not null check (credit_limit >= 0 and credit_limit <= 99999999999.99),
  credit_days integer check (credit_days is null or credit_days between 0 and 365),
  grace_days integer not null default 0 check (grace_days between 0 and 180),
  reason text not null check (length(btrim(reason)) between 5 and 300),
  status text not null default 'active' check (status in ('active', 'superseded')),
  set_by uuid not null references public.app_users(id),
  set_at timestamptz not null default now(),
  superseded_at timestamptz,
  check ((status = 'superseded') = (superseded_at is not null))
);
create unique index if not exists customer_credit_limits_one_active on public.customer_credit_limits(company_id, customer_id) where status = 'active';
create index if not exists customer_credit_limits_company_idx on public.customer_credit_limits(company_id, customer_id, set_at desc);

create table if not exists public.order_credit_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  stage text not null check (stage in ('confirmation', 'dispatch', 'recheck')),
  dispatch_id uuid references public.dispatches(id) on delete set null,
  outstanding numeric(14,2) not null,
  unbilled numeric(14,2) not null,
  this_value numeric(14,2) not null,
  on_account numeric(14,2) not null,
  exposure numeric(14,2) not null,
  credit_limit numeric(14,2),
  overdue_beyond_grace numeric(14,2) not null,
  result text not null check (result in ('within', 'over_limit', 'overdue', 'over_limit_and_overdue', 'no_limit')),
  outcome text not null check (outcome in ('passed', 'held', 'approved_cover', 'blocked', 'not_checked')),
  checked_by uuid references public.app_users(id),
  checked_at timestamptz not null default clock_timestamp()
);
create index if not exists order_credit_checks_company_idx on public.order_credit_checks(company_id, order_id, checked_at desc);

create table if not exists public.order_credit_holds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  status text not null default 'held' check (status in ('held', 'approved', 'rejected', 'cleared')),
  reasons text[] not null,
  exposure numeric(14,2) not null,
  credit_limit numeric(14,2),
  overdue_beyond_grace numeric(14,2) not null,
  requested_by uuid references public.app_users(id),
  approved_exposure numeric(14,2),
  decided_by uuid references public.app_users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  expires_at timestamptz,
  cleared_at timestamptz,
  cleared_note text,
  created_at timestamptz not null default clock_timestamp(),
  check (status not in ('approved', 'rejected') or decided_by is not null),
  check (status <> 'held' or (decided_by is null and expires_at is null and approved_exposure is null)),
  check (status <> 'approved' or (expires_at is not null and approved_exposure is not null)),
  check ((status = 'cleared') = (cleared_at is not null))
);
create unique index if not exists order_credit_holds_one_live on public.order_credit_holds(company_id, order_id) where status in ('held', 'approved', 'rejected');
create index if not exists order_credit_holds_company_idx on public.order_credit_holds(company_id, status, created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-045: draft production jobs grouped by die, alloy and temper
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.production_job_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  group_key text not null check (length(group_key) between 3 and 200),
  die_id uuid references public.dies(id) on delete set null,
  profile_id uuid not null references public.aluminium_profiles(id) on delete cascade,
  alloy text,
  temper text,
  status text not null default 'open' check (status in ('open', 'released', 'cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  released_by uuid references public.app_users(id)
);
create unique index if not exists production_job_drafts_one_open on public.production_job_drafts(company_id, group_key) where status = 'open';
create index if not exists production_job_drafts_company_idx on public.production_job_drafts(company_id, status, created_at desc);

create table if not exists public.production_job_draft_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  draft_id uuid not null references public.production_job_drafts(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  profile_id uuid not null references public.aluminium_profiles(id) on delete cascade,
  required_kg numeric(14,3) not null check (required_kg > 0),
  pieces integer check (pieces is null or pieces > 0),
  length_m numeric(10,3) check (length_m is null or length_m > 0),
  kg_per_m numeric(10,4),
  due_date date,
  status text not null default 'open' check (status in ('open', 'released', 'covered', 'removed')),
  job_id uuid references public.production_jobs(id) on delete set null,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  closed_by uuid references public.app_users(id),
  check ((status = 'released') = (job_id is not null))
);
create unique index if not exists production_job_draft_lines_one_live on public.production_job_draft_lines(company_id, order_id, coalesce(order_item_id, order_id)) where status in ('open', 'released');
create index if not exists production_job_draft_lines_company_idx on public.production_job_draft_lines(company_id, draft_id, status);
create index if not exists production_job_draft_lines_order_idx on public.production_job_draft_lines(order_id);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-046: invoice drafts prepared at gate-out (no number until posted through the reviewed invoice path)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.invoice_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  gate_out_at timestamptz not null,
  invoice_date date not null,
  due_date date,
  place_of_supply_state_code text check (place_of_supply_state_code is null or place_of_supply_state_code ~ '^[0-9]{2}$'),
  supply_basis jsonb not null default '{}'::jsonb,
  source_fingerprint text check (source_fingerprint is null or source_fingerprint ~ '^[0-9a-f]{32}$'),
  goods_value numeric(14,2),
  tax_value numeric(14,2),
  charges_value numeric(14,2),
  total_value numeric(14,2),
  line_count integer,
  status text not null default 'open' check (status in ('open', 'blocked', 'posted', 'cancelled')),
  blocker text check (blocker is null or length(blocker) <= 500),
  invoice_id uuid references public.invoices(id) on delete set null,
  explanation text check (explanation is null or length(explanation) <= 300),
  explained_by uuid references public.app_users(id),
  explained_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  refreshed_at timestamptz not null default clock_timestamp(),
  posted_at timestamptz,
  check ((status = 'blocked') = (blocker is not null)),
  check ((status = 'posted') = (invoice_id is not null))
);
create unique index if not exists invoice_drafts_one_per_dispatch on public.invoice_drafts(company_id, dispatch_id);
create index if not exists invoice_drafts_company_idx on public.invoice_drafts(company_id, status, gate_out_at);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-037: place-of-supply rule (confirmed by accounts), one-time overrides with a reason, and the derivation snapshot
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.gst_supply_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version integer not null check (version >= 1),
  basis text not null default 'billing_gstin' check (basis in ('billing_gstin')),
  hsn_profile text check (hsn_profile is null or hsn_profile ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
  hsn_scrap text check (hsn_scrap is null or hsn_scrap ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
  note text check (note is null or length(note) <= 300),
  status text not null default 'confirmed' check (status in ('confirmed', 'superseded')),
  confirmed_by uuid not null references public.app_users(id),
  confirmed_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (company_id, version)
);
create unique index if not exists gst_supply_rules_one_confirmed on public.gst_supply_rules(company_id) where status = 'confirmed';

create table if not exists public.invoice_supply_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  derived_state text,
  chosen_state text not null check (chosen_state ~ '^[0-9]{2}$'),
  reason text not null check (length(btrim(reason)) between 10 and 300),
  requested_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_invoice_id uuid,
  consumed_at timestamptz
);
create index if not exists invoice_supply_overrides_company_idx on public.invoice_supply_overrides(company_id, dispatch_id, created_at desc);

create table if not exists public.invoice_supply_derivations (
  invoice_id uuid primary key references public.invoices(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  derived_state text,
  chosen_state text,
  basis text not null,
  source_gstin text,
  rule_id uuid references public.gst_supply_rules(id) on delete set null,
  rule_version integer,
  override_id uuid references public.invoice_supply_overrides(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists invoice_supply_derivations_company_idx on public.invoice_supply_derivations(company_id, created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-031: quotation validity history and extension requests
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.quote_validity_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  event text not null check (event in ('expired', 'extension_requested', 'extended', 'extension_rejected', 'requoted', 'conversion_refused')),
  old_valid_until date,
  new_valid_until date,
  revision_number integer,
  reason text check (reason is null or length(reason) <= 500),
  actor_id uuid references public.app_users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists quote_validity_events_company_idx on public.quote_validity_events(company_id, quote_id, created_at desc);

create table if not exists public.quote_validity_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  requested_valid_until date not null,
  reason text not null check (length(btrim(reason)) between 10 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by uuid not null references public.app_users(id),
  requested_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.app_users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 300),
  check ((status in ('approved', 'rejected')) = (decided_by is not null))
);
create unique index if not exists quote_validity_requests_one_pending on public.quote_validity_requests(company_id, quote_id) where status = 'pending';
create index if not exists quote_validity_requests_company_idx on public.quote_validity_requests(company_id, status, requested_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-097: duplicate warnings shown and what the person did
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.duplicate_warnings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('quote', 'order', 'receipt', 'dispatch')),
  matches jsonb not null,
  decision text not null check (decision in ('saved_anyway', 'opened_existing')),
  note text check (note is null or length(note) <= 300),
  actor_id uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists duplicate_warnings_company_idx on public.duplicate_warnings(company_id, kind, created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-098: what the system closed and why
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.alert_resolutions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_kind text not null check (source_kind in ('task', 'notification', 'credit_hold')),
  source_id uuid not null,
  condition_key text not null,
  outcome text not null check (outcome in ('closed', 'flagged')),
  note text not null check (length(note) <= 300),
  trigger_source text not null check (trigger_source in ('event', 'job')),
  resolved_at timestamptz not null default clock_timestamp()
);
create unique index if not exists alert_resolutions_once on public.alert_resolutions(company_id, source_kind, source_id);
create index if not exists alert_resolutions_company_idx on public.alert_resolutions(company_id, resolved_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-058 / AP-024: on-account money, learned remitters, bank statements and their lines
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.customer_on_account_credits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  source text not null check (source in ('bank_line', 'receipt')),
  bank_line_id uuid,
  payment_method text not null check (payment_method in ('bank_transfer', 'upi', 'cheque', 'cash', 'other')),
  reference text check (reference is null or length(reference) <= 120),
  received_on date not null,
  amount numeric(14,2) not null check (amount > 0),
  applied_amount numeric(14,2) not null default 0 check (applied_amount >= 0),
  status text not null default 'open' check (status in ('open', 'applied', 'reversed')),
  note text check (note is null or length(note) <= 300),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  reversed_at timestamptz,
  reversal_reason text,
  check (applied_amount <= amount),
  check ((status = 'applied') = (applied_amount = amount and reversed_at is null)),
  check ((status = 'reversed') = (reversed_at is not null))
);
create index if not exists customer_on_account_company_idx on public.customer_on_account_credits(company_id, customer_id, status);

create table if not exists public.customer_on_account_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  credit_id uuid not null references public.customer_on_account_credits(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  receipt_event_id uuid not null references public.financial_receipt_events(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  applied_by uuid not null references public.app_users(id),
  applied_at timestamptz not null default clock_timestamp()
);
create index if not exists customer_on_account_applications_idx on public.customer_on_account_applications(company_id, credit_id);

create table if not exists public.receipt_allocation_audits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  receipt_event_id uuid references public.financial_receipt_events(id) on delete set null,
  on_account_credit_id uuid references public.customer_on_account_credits(id) on delete set null,
  source text not null check (source in ('receipt_form', 'bank_line', 'on_account_apply')),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{32}$'),
  result jsonb not null,
  proposed jsonb not null,
  final jsonb not null,
  changed boolean not null,
  actor_id uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists receipt_allocation_audits_key on public.receipt_allocation_audits(company_id, idempotency_key);
create index if not exists receipt_allocation_audits_company_idx on public.receipt_allocation_audits(company_id, created_at desc);

create table if not exists public.customer_remitter_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  alias text not null check (length(alias) between 4 and 120),
  source text not null check (source in ('learned', 'manual')),
  active boolean not null default true,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists customer_remitter_aliases_unique on public.customer_remitter_aliases(company_id, alias) where active;
create index if not exists customer_remitter_aliases_customer_idx on public.customer_remitter_aliases(company_id, customer_id);

create table if not exists public.bank_format_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 3 and 80),
  header_signature text not null check (header_signature ~ '^[0-9a-f]{32}$'),
  mapping jsonb not null,
  date_format text not null check (date_format in ('DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY', 'DD/MM/YY')),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index if not exists bank_format_profiles_signature on public.bank_format_profiles(company_id, header_signature);

create table if not exists public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid references public.bank_format_profiles(id) on delete set null,
  source_name text not null check (length(source_name) between 1 and 200),
  file_fingerprint text not null check (file_fingerprint ~ '^[0-9a-f]{32,64}$'),
  account_label text check (account_label is null or length(account_label) <= 80),
  period_from date,
  period_to date,
  line_count integer not null default 0,
  new_lines integer not null default 0,
  duplicate_lines integer not null default 0,
  credit_lines integer not null default 0,
  imported_by uuid not null references public.app_users(id),
  imported_at timestamptz not null default clock_timestamp()
);
create unique index if not exists bank_statements_file on public.bank_statements(company_id, file_fingerprint);
create index if not exists bank_statements_company_idx on public.bank_statements(company_id, imported_at desc);

create table if not exists public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  statement_id uuid not null references public.bank_statements(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  txn_date date not null,
  narration text not null check (length(narration) <= 500),
  reference text check (reference is null or length(reference) <= 80),
  direction text not null check (direction in ('credit', 'debit')),
  amount numeric(14,2) not null check (amount > 0),
  dedupe_key text not null check (dedupe_key ~ '^[0-9a-f]{32}$'),
  remitter text check (remitter is null or length(remitter) <= 120),
  state text not null default 'unmatched' check (state in ('unmatched', 'proposed', 'receipted', 'ignored')),
  match_class text check (match_class is null or match_class in ('exact', 'likely', 'unknown')),
  match_evidence jsonb,
  customer_id uuid references public.customers(id) on delete set null,
  assigned_by uuid references public.app_users(id),
  receipt_event_id uuid references public.financial_receipt_events(id) on delete set null,
  on_account_credit_id uuid references public.customer_on_account_credits(id) on delete set null,
  accepted_unchanged boolean,
  ignored_reason text check (ignored_reason is null or length(ignored_reason) <= 300),
  reversal_count integer not null default 0,
  last_reversal_reason text,
  created_at timestamptz not null default clock_timestamp(),
  receipted_at timestamptz,
  check ((state = 'ignored') = (ignored_reason is not null))
);
create unique index if not exists bank_statement_lines_dedupe on public.bank_statement_lines(company_id, dedupe_key);
create unique index if not exists bank_statement_lines_one_receipt on public.bank_statement_lines(receipt_event_id) where receipt_event_id is not null;
create index if not exists bank_statement_lines_company_idx on public.bank_statement_lines(company_id, state, txn_date desc);
create index if not exists bank_statement_lines_statement_idx on public.bank_statement_lines(statement_id, line_no);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-084: payment reminder queue (prepared by the morning job, sent or skipped by a person)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  reminder_date date not null,
  invoices jsonb not null,
  total_due numeric(14,2) not null check (total_due > 0),
  worst_days integer not null,
  message text not null check (length(message) between 20 and 4000),
  phone text,
  status text not null default 'prepared' check (status in ('prepared', 'sent', 'skipped', 'superseded')),
  copied_at timestamptz,
  sent_via text check (sent_via is null or sent_via in ('whatsapp', 'email', 'phone_call', 'other')),
  sent_at timestamptz,
  sent_by uuid references public.app_users(id),
  skip_reason text check (skip_reason is null or length(btrim(skip_reason)) between 5 and 300),
  skipped_by uuid references public.app_users(id),
  job_run_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  check ((status = 'sent') = (sent_at is not null and sent_via is not null)),
  check ((status = 'skipped') = (skip_reason is not null))
);
create unique index if not exists payment_reminders_one_per_day on public.payment_reminders(company_id, customer_id, reminder_date);
create index if not exists payment_reminders_company_idx on public.payment_reminders(company_id, reminder_date desc, status);

-- ---------------------------------------------------------------------------------------------------------------
-- RLS: company-scoped reads, no client writes (every write goes through a definer function)
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare t text; r text;
begin
  foreach t in array array['o2c_settings', 'customer_credit_limits', 'order_credit_checks', 'order_credit_holds', 'production_job_drafts',
    'production_job_draft_lines', 'invoice_drafts', 'gst_supply_rules', 'invoice_supply_overrides', 'invoice_supply_derivations',
    'quote_validity_events', 'quote_validity_requests', 'duplicate_warnings', 'alert_resolutions', 'customer_on_account_credits',
    'customer_on_account_applications', 'receipt_allocation_audits', 'customer_remitter_aliases', 'bank_format_profiles', 'bank_statements',
    'bank_statement_lines', 'payment_reminders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'ap3 company read', t);
    r := case
      when t in ('customer_credit_limits', 'order_credit_checks', 'order_credit_holds')
        then 'array[''owner'',''admin'',''accounts'',''sales_manager'',''sales'']'
      when t in ('production_job_drafts', 'production_job_draft_lines')
        then 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''sales_manager'']'
      when t in ('quote_validity_events', 'quote_validity_requests')
        then 'array[''owner'',''admin'',''sales_manager'',''sales'']'
      when t in ('o2c_settings', 'duplicate_warnings', 'alert_resolutions')
        then 'array[''owner'',''admin'',''accounts'',''sales_manager'']'
      else 'array[''owner'',''admin'',''accounts'']' end;
    execute format('create policy %I on public.%I for select to authenticated using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) = any(%s))',
      'ap3 company read', t, r);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap3_accounts_roles() returns text[] language sql immutable set search_path = public, private as $$ select array['owner', 'admin', 'accounts'] $$;
create or replace function private.ap3_sales_roles() returns text[] language sql immutable set search_path = public, private as $$ select array['owner', 'admin', 'sales_manager', 'sales'] $$;
create or replace function private.ap3_planner_roles() returns text[] language sql immutable set search_path = public, private as $$ select array['owner', 'admin', 'production_manager', 'factory_manager'] $$;
revoke all on function private.ap3_accounts_roles() from public, anon, authenticated;
revoke all on function private.ap3_sales_roles() from public, anon, authenticated;
revoke all on function private.ap3_planner_roles() from public, anon, authenticated;

create or replace function private.ap3_settings(p_company uuid)
returns public.o2c_settings language plpgsql stable security definer set search_path = public, private as $$
declare s public.o2c_settings%rowtype;
begin
  select * into s from public.o2c_settings where company_id = p_company;
  if s.company_id is null then
    s.company_id := p_company; s.credit_approver_roles := array['owner', 'accounts']; s.credit_approval_hours := 72;
    s.quote_extension_needs_approval := true; s.quote_extension_roles := array['owner', 'admin', 'sales_manager'];
    s.reminder_steps := array[-3, 0, 7, 15, 30]; s.reminder_repeat_days := 7; s.duplicate_window_days := 3;
  end if;
  return s;
end;
$$;
revoke all on function private.ap3_settings(uuid) from public, anon, authenticated;

-- Indian digit grouping for amounts shown to people and customers (12,34,567.00).
create or replace function private.ap3_inr(p_value numeric)
returns text language plpgsql immutable set search_path = public, private as $$
declare v numeric := round(abs(coalesce(p_value, 0)), 2); i text; f text; head text; tail text;
begin
  i := trunc(v)::bigint::text; f := lpad(((v - trunc(v)) * 100)::integer::text, 2, '0');
  if length(i) > 3 then
    tail := right(i, 3); head := left(i, length(i) - 3);
    head := regexp_replace(reverse(regexp_replace(reverse(head), '([0-9]{2})(?=[0-9])', '\1,', 'g')), '^,', '');
    i := head || ',' || tail;
  end if;
  return case when coalesce(p_value, 0) < 0 then '-' else '' end || i || '.' || f;
end;
$$;
revoke all on function private.ap3_inr(numeric) from public, anon, authenticated;

create or replace function private.ap3_norm(p_text text)
returns text language sql immutable set search_path = public, private as $$
  select btrim(regexp_replace(regexp_replace(upper(coalesce(p_text, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;
revoke all on function private.ap3_norm(text) from public, anon, authenticated;

create or replace function private.ap3_compact(p_text text)
returns text language sql immutable set search_path = public, private as $$
  select regexp_replace(upper(coalesce(p_text, '')), '[^A-Z0-9]+', '', 'g')
$$;
revoke all on function private.ap3_compact(text) from public, anon, authenticated;

-- AP-037: state code from a state name or code (customer master free text). Unknown stays null, never guessed.
create or replace function private.ap3_state_code(p_text text)
returns text language sql immutable set search_path = public, private as $$
  with v(t) as (select btrim(regexp_replace(replace(lower(coalesce(p_text, '')), '&', ' and '), '[^a-z0-9]+', ' ', 'g')))
  select case
    when (select t from v) ~ '^[0-9]{2}$' and (select t from v) between '01' and '38' and (select t from v) not in ('25', '28') then (select t from v)
    else (select m.code from (values
      ('01', 'jammu and kashmir'), ('02', 'himachal pradesh'), ('03', 'punjab'), ('04', 'chandigarh'), ('05', 'uttarakhand'), ('05', 'uttaranchal'),
      ('06', 'haryana'), ('07', 'delhi'), ('07', 'new delhi'), ('07', 'nct of delhi'), ('08', 'rajasthan'), ('09', 'uttar pradesh'), ('10', 'bihar'),
      ('11', 'sikkim'), ('12', 'arunachal pradesh'), ('13', 'nagaland'), ('14', 'manipur'), ('15', 'mizoram'), ('16', 'tripura'), ('17', 'meghalaya'),
      ('18', 'assam'), ('19', 'west bengal'), ('20', 'jharkhand'), ('21', 'odisha'), ('21', 'orissa'), ('22', 'chhattisgarh'), ('22', 'chattisgarh'),
      ('23', 'madhya pradesh'), ('24', 'gujarat'), ('26', 'dadra and nagar haveli and daman and diu'), ('26', 'daman and diu'), ('26', 'dadra and nagar haveli'),
      ('27', 'maharashtra'), ('29', 'karnataka'), ('30', 'goa'), ('31', 'lakshadweep'), ('32', 'kerala'), ('33', 'tamil nadu'), ('34', 'puducherry'),
      ('34', 'pondicherry'), ('35', 'andaman and nicobar islands'), ('35', 'andaman and nicobar'), ('36', 'telangana'), ('37', 'andhra pradesh'), ('38', 'ladakh')
    ) m(code, name) where m.name = (select t from v) limit 1) end
$$;
revoke all on function private.ap3_state_code(text) from public, anon, authenticated;

create or replace function private.ap3_supplier_state(p_company uuid)
returns text language sql stable security definer set search_path = public, private as $$
  select case when x.s ~ '^(0[1-9]|[12][0-9]|3[0-8])$' and x.s not in ('25', '28') then x.s end
  from (select coalesce(nullif(c.gst_state_code, ''), substring(c.gst_number from '^([0-9]{2})')) s from public.companies c where c.id = p_company) x
$$;
revoke all on function private.ap3_supplier_state(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-037: place of supply from the customer's GSTIN (or its recorded state when unregistered)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap3_derive_supply(p_company uuid, p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare c record; v_rule public.gst_supply_rules%rowtype; v_gstin text; v_state text; v_basis text := 'unknown'; v_supplier text;
begin
  select x.gst_number, x.state, x.gst_registration, coalesce(nullif(btrim(x.company_name), ''), x.customer_name) nm into c
    from public.customers x where x.id = p_customer and x.company_id = p_company;
  select * into v_rule from public.gst_supply_rules r where r.company_id = p_company and r.status = 'confirmed';
  v_gstin := upper(nullif(btrim(c.gst_number), ''));
  if v_gstin is not null and private.ap_gstin_valid(v_gstin) then
    v_state := left(v_gstin, 2); v_basis := 'billing_gstin';
  elsif nullif(btrim(c.state), '') is not null then
    v_state := private.ap3_state_code(c.state); v_basis := case when v_state is null then 'unknown' else 'customer_state' end;
  end if;
  v_supplier := private.ap3_supplier_state(p_company);
  return jsonb_build_object('state', v_state, 'basis', v_basis, 'source_gstin', v_gstin, 'customer_state', c.state, 'customer', c.nm,
    'supplier_state', v_supplier,
    'tax_type', case when v_state is null or v_supplier is null then null when v_state = v_supplier then 'cgst_sgst' else 'igst' end,
    'rule_id', v_rule.id, 'rule_version', v_rule.version, 'confirmed', v_rule.id is not null,
    'state_label', (select coalesce(private.ap_gst_state(v_state), v_state)));
end;
$$;
revoke all on function private.ap3_derive_supply(uuid, uuid) from public, anon, authenticated;

-- Fills the place of supply when it is left blank, and refuses a different state (once accounts confirmed the rule)
-- unless an override with a reason was recorded for this dispatch. Runs before canonicalize_invoice_supply.
create or replace function private.ap3_invoice_supply()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare d jsonb; o public.invoice_supply_overrides%rowtype; v_derived text;
begin
  if new.opening_cutover_id is not null or new.customer_id is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.place_of_supply_state_code is not distinct from old.place_of_supply_state_code then return new; end if;
    if old.status not in ('draft', 'generated') then return new; end if;
  end if;
  d := private.ap3_derive_supply(new.company_id, new.customer_id);
  v_derived := d ->> 'state';
  if nullif(btrim(coalesce(new.place_of_supply_state_code, '')), '') is null then
    new.place_of_supply_state_code := v_derived;
  elsif v_derived is not null and new.place_of_supply_state_code <> v_derived and coalesce((d ->> 'confirmed')::boolean, false) then
    select * into o from public.invoice_supply_overrides x
      where x.company_id = new.company_id and x.dispatch_id is not distinct from new.dispatch_id and x.chosen_state = new.place_of_supply_state_code
        and x.consumed_at is null and x.expires_at > now()
      order by x.created_at desc limit 1 for update;
    if o.id is null then
      raise exception 'AP: Place of supply % differs from % (%) derived for this customer. Record an override with a reason before invoicing.',
        new.place_of_supply_state_code, v_derived, replace(d ->> 'basis', '_', ' ') using errcode = '23514';
    end if;
    update public.invoice_supply_overrides set consumed_invoice_id = new.id, consumed_at = clock_timestamp() where id = o.id;
  end if;
  return new;
end;
$$;
revoke all on function private.ap3_invoice_supply() from public, anon, authenticated;
drop trigger if exists zzy_ap3_invoice_supply on public.invoices;
create trigger zzy_ap3_invoice_supply before insert or update of place_of_supply_state_code on public.invoices
  for each row execute function private.ap3_invoice_supply();

create or replace function private.ap3_record_supply()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare d jsonb; v_override uuid;
begin
  if new.opening_cutover_id is not null or new.customer_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.place_of_supply_state_code is not distinct from old.place_of_supply_state_code then return new; end if;
  d := private.ap3_derive_supply(new.company_id, new.customer_id);
  select x.id into v_override from public.invoice_supply_overrides x where x.consumed_invoice_id = new.id order by x.consumed_at desc limit 1;
  insert into public.invoice_supply_derivations(invoice_id, company_id, derived_state, chosen_state, basis, source_gstin, rule_id, rule_version, override_id)
    values (new.id, new.company_id, d ->> 'state', new.place_of_supply_state_code, d ->> 'basis', d ->> 'source_gstin', (d ->> 'rule_id')::uuid,
      (d ->> 'rule_version')::integer, v_override)
    on conflict (invoice_id) do update set derived_state = excluded.derived_state, chosen_state = excluded.chosen_state, basis = excluded.basis,
      source_gstin = excluded.source_gstin, rule_id = excluded.rule_id, rule_version = excluded.rule_version, override_id = coalesce(excluded.override_id, invoice_supply_derivations.override_id),
      created_at = clock_timestamp();
  return new;
end;
$$;
revoke all on function private.ap3_record_supply() from public, anon, authenticated;
drop trigger if exists zz_ap3_record_supply on public.invoices;
create trigger zz_ap3_record_supply after insert or update of place_of_supply_state_code on public.invoices
  for each row execute function private.ap3_record_supply();

-- HSN defaults by item type: a new profile without an HSN code takes the confirmed default.
create or replace function private.ap3_profile_hsn_default()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if nullif(btrim(coalesce(new.hsn_code, '')), '') is null then
    select r.hsn_profile into new.hsn_code from public.gst_supply_rules r where r.company_id = new.company_id and r.status = 'confirmed' and r.hsn_profile is not null;
  end if;
  return new;
end;
$$;
revoke all on function private.ap3_profile_hsn_default() from public, anon, authenticated;
drop trigger if exists ap3_profile_hsn_default on public.aluminium_profiles;
create trigger ap3_profile_hsn_default before insert on public.aluminium_profiles for each row execute function private.ap3_profile_hsn_default();

-- ---------------------------------------------------------------------------------------------------------------
-- AP-032: exposure = open invoice balances + dispatched but unbilled goods + this order or dispatch - on-account money
-- ---------------------------------------------------------------------------------------------------------------
-- Value of a dispatch's packed goods at the order rates including GST (the invoice basis). Null when a line has no
-- weight or rate, so an unpriced dispatch is reported as such rather than counted as zero.
create or replace function private.ap3_dispatch_value(p_company uuid, p_dispatch uuid)
returns numeric language sql stable security definer set search_path = public, private as $$
  select case when count(*) = 0 or bool_or(x.w <= 0 or x.rate <= 0) then null
    else round(sum(round(round(x.w, 3) * round(x.rate, 2), 2) * (1 + x.gst / 100)), 2) end
  from (
    select coalesce(nullif(p.net_weight_kg, 0), nullif(p.gross_weight_kg, 0), 0) w, coalesce(nullif(p.net_rate, 0), 0) rate,
      coalesce(p.gst_percent, oi.gst_percent, qi.gst_percent, q.gst_percent, (select s.default_gst_percent from public.company_settings s where s.company_id = p_company), 18) gst
    from public.packing_list_items p
    left join public.order_items oi on oi.id = p.order_item_id and oi.company_id = p.company_id
    left join public.quote_items qi on qi.id = p.quote_item_id and qi.company_id = p.company_id
    left join public.quotes q on q.id = qi.quote_id and q.company_id = p.company_id
    where p.company_id = p_company and p.dispatch_id = p_dispatch) x
$$;
revoke all on function private.ap3_dispatch_value(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap3_open_invoice_statuses() returns text[] language sql immutable set search_path = public, private as $$
  select array['generated', 'sent', 'partially_paid', 'overdue'] $$;
revoke all on function private.ap3_open_invoice_statuses() from public, anon, authenticated;

create or replace function private.ap3_exposure(p_company uuid, p_customer uuid, p_this numeric, p_exclude_dispatch uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  l public.customer_credit_limits%rowtype; v_out numeric; v_unbilled numeric; v_unpriced integer; v_oa numeric; v_overdue numeric; v_exp numeric;
  v_over boolean; v_late boolean; v_today date := private.ist_today();
begin
  select * into l from public.customer_credit_limits x where x.company_id = p_company and x.customer_id = p_customer and x.status = 'active';
  select coalesce(sum(i.balance_due), 0), coalesce(sum(i.balance_due) filter (where i.due_date is not null and i.due_date + coalesce(l.grace_days, 0) < v_today), 0)
    into v_out, v_overdue
    from public.invoices i where i.company_id = p_company and i.customer_id = p_customer and i.deleted_at is null and i.balance_due > 0
      and i.status = any(private.ap3_open_invoice_statuses());
  select coalesce(sum(coalesce(v.val, 0)), 0), count(*) filter (where v.val is null) into v_unbilled, v_unpriced
    from (select private.ap3_dispatch_value(p_company, d.id) val from public.dispatches d join public.orders o on o.id = d.order_id and o.company_id = d.company_id
      where d.company_id = p_company and o.customer_id = p_customer and d.actual_dispatched_at is not null and d.delivery_status not in ('returned', 'damaged')
        and (p_exclude_dispatch is null or d.id <> p_exclude_dispatch)
        and not exists (select 1 from public.invoices i where i.company_id = p_company and i.dispatch_id = d.id and i.status <> 'cancelled' and i.deleted_at is null)) v;
  select coalesce(sum(c.amount - c.applied_amount), 0) into v_oa from public.customer_on_account_credits c
    where c.company_id = p_company and c.customer_id = p_customer and c.status = 'open';
  v_exp := round(v_out + v_unbilled + coalesce(p_this, 0) - v_oa, 2);
  v_over := l.id is not null and v_exp > l.credit_limit;
  v_late := l.id is not null and v_overdue > 0;
  return jsonb_build_object('outstanding', round(v_out, 2), 'unbilled', round(v_unbilled, 2), 'unpriced_dispatches', v_unpriced, 'this_value', round(coalesce(p_this, 0), 2),
    'on_account', round(v_oa, 2), 'exposure', v_exp, 'credit_limit', l.credit_limit, 'credit_days', l.credit_days, 'grace_days', l.grace_days, 'limit_id', l.id,
    'overdue_beyond_grace', round(v_overdue, 2), 'headroom', case when l.id is not null then round(l.credit_limit - v_exp, 2) end,
    'result', case when l.id is null then 'no_limit' when v_over and v_late then 'over_limit_and_overdue' when v_over then 'over_limit' when v_late then 'overdue' else 'within' end);
end;
$$;
revoke all on function private.ap3_exposure(uuid, uuid, numeric, uuid) from public, anon, authenticated;

create or replace function private.ap3_reasons(e jsonb)
returns text[] language sql immutable set search_path = public, private as $$
  select array_remove(array[
    case when e ->> 'result' in ('over_limit', 'over_limit_and_overdue') then format('Exposure INR %s is above the INR %s credit limit', private.ap3_inr((e ->> 'exposure')::numeric), private.ap3_inr((e ->> 'credit_limit')::numeric)) end,
    case when e ->> 'result' in ('overdue', 'over_limit_and_overdue') then format('INR %s is overdue beyond the %s-day grace', private.ap3_inr((e ->> 'overdue_beyond_grace')::numeric), coalesce(e ->> 'grace_days', '0')) end
  ], null)
$$;
revoke all on function private.ap3_reasons(jsonb) from public, anon, authenticated;

-- Value of an order not yet dispatched (what a confirmation or a recheck adds to exposure).
create or replace function private.ap3_order_remaining_value(p_company uuid, p_order uuid)
returns numeric language sql stable security definer set search_path = public, private as $$
  select greatest(coalesce(o.order_value, 0) - coalesce((select sum(coalesce(private.ap3_dispatch_value(p_company, d.id), 0)) from public.dispatches d
      where d.company_id = p_company and d.order_id = o.id and d.actual_dispatched_at is not null and d.delivery_status not in ('returned', 'damaged')), 0), 0)
  from public.orders o where o.id = p_order and o.company_id = p_company
$$;
revoke all on function private.ap3_order_remaining_value(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap3_notify_roles(p_company uuid, p_roles text[], p_type text, p_severity text, p_title text, p_body text, p_entity_type text,
  p_entity uuid, p_link text, p_condition text, p_actor uuid)
returns integer language plpgsql security definer set search_path = public, private as $$
declare v_n integer;
begin
  if p_condition is not null and exists (select 1 from public.notifications n where n.company_id = p_company and n.condition_key = p_condition and n.resolved_at is null) then
    return 0;
  end if;
  insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, related_entity_type, related_entity_id, action_link, condition_key, entity_reference, created_by)
    select p_company, rl, p_type, p_severity, left(p_title, 200), left(p_body, 1000), p_entity_type, p_entity, p_link, p_condition, p_condition, p_actor
    from unnest(p_roles) rl;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.ap3_notify_roles(uuid, text[], text, text, text, text, text, uuid, text, text, uuid) from public, anon, authenticated;

-- AP-098: a hold whose condition cleared closes with a note, and so do the alerts it raised.
create or replace function private.ap3_clear_hold(p_hold uuid, p_note text, p_source text)
returns void language plpgsql security definer set search_path = public, private as $$
declare h public.order_credit_holds%rowtype;
begin
  update public.order_credit_holds set status = 'cleared', cleared_at = clock_timestamp(), cleared_note = left(p_note, 300)
    where id = p_hold and status in ('held', 'rejected') returning * into h;
  if h.id is null then return; end if;
  insert into public.alert_resolutions(company_id, source_kind, source_id, condition_key, outcome, note, trigger_source)
    values (h.company_id, 'credit_hold', h.id, 'credit-hold:' || h.order_id, 'closed', 'Resolved by system: credit condition cleared', p_source) on conflict do nothing;
  update public.notifications set resolved_at = clock_timestamp(), resolution = 'Resolved by system: condition cleared', is_read = true, read_at = coalesce(read_at, now())
    where company_id = h.company_id and condition_key = 'credit-hold:' || h.order_id and resolved_at is null;
end;
$$;
revoke all on function private.ap3_clear_hold(uuid, text, text) from public, anon, authenticated;

-- Checks an order's credit and holds it when it is over the limit or overdue beyond grace. Clears a hold that no longer
-- applies (AP-098). Never refuses the order itself: the hold stops draft-job release and dispatch until approved.
create or replace function private.ap3_credit_check_order(p_company uuid, p_order uuid, p_stage text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare o public.orders%rowtype; e jsonb; h public.order_credit_holds%rowtype; v_outcome text; v_value numeric; s public.o2c_settings%rowtype;
begin
  select * into o from public.orders where id = p_order and company_id = p_company;
  if o.id is null or o.customer_id is null then return null; end if;
  v_value := case when p_stage = 'confirmation' then coalesce(o.order_value, 0) else private.ap3_order_remaining_value(p_company, o.id) end;
  e := private.ap3_exposure(p_company, o.customer_id, v_value, null);
  select * into h from public.order_credit_holds x where x.company_id = p_company and x.order_id = o.id and x.status in ('held', 'approved', 'rejected') for update;
  v_outcome := case e ->> 'result' when 'no_limit' then 'not_checked' when 'within' then 'passed'
    else case when h.status = 'approved' and h.expires_at > now() and h.approved_exposure >= (e ->> 'exposure')::numeric then 'approved_cover' else 'held' end end;
  insert into public.order_credit_checks(company_id, order_id, customer_id, stage, outstanding, unbilled, this_value, on_account, exposure, credit_limit, overdue_beyond_grace, result, outcome, checked_by)
    values (p_company, o.id, o.customer_id, p_stage, (e ->> 'outstanding')::numeric, (e ->> 'unbilled')::numeric, (e ->> 'this_value')::numeric, (e ->> 'on_account')::numeric,
      (e ->> 'exposure')::numeric, (e ->> 'credit_limit')::numeric, (e ->> 'overdue_beyond_grace')::numeric, e ->> 'result', v_outcome, (select u.id from public.app_users u where u.id = p_actor));
  if v_outcome = 'held' and h.status = 'approved' then
    -- An approval that expired or no longer covers the exposure is closed (its decision stays on record) and a new hold opens.
    update public.order_credit_holds set status = 'cleared', cleared_at = clock_timestamp(),
      cleared_note = format('Approval no longer covers exposure INR %s; a new approval is needed', private.ap3_inr((e ->> 'exposure')::numeric)) where id = h.id;
    h := null;
  end if;
  if v_outcome = 'held' then
    if h.id is null then
      insert into public.order_credit_holds(company_id, order_id, customer_id, reasons, exposure, credit_limit, overdue_beyond_grace, requested_by)
        values (p_company, o.id, o.customer_id, private.ap3_reasons(e), (e ->> 'exposure')::numeric, (e ->> 'credit_limit')::numeric, (e ->> 'overdue_beyond_grace')::numeric,
          coalesce(o.created_by, p_actor)) returning * into h;
      s := private.ap3_settings(p_company);
      perform private.ap3_notify_roles(p_company, s.credit_approver_roles, 'credit_hold', 'warning', 'Credit hold: order ' || coalesce(o.order_number, ''),
        array_to_string(private.ap3_reasons(e), '. ') || '. Approve credit or ask for payment before production and dispatch.', 'order', o.id, '/orders/' || o.id || '#credit',
        'credit-hold:' || o.id, p_actor);
    elsif h.status = 'held' then
      update public.order_credit_holds set reasons = private.ap3_reasons(e), exposure = (e ->> 'exposure')::numeric, credit_limit = (e ->> 'credit_limit')::numeric,
        overdue_beyond_grace = (e ->> 'overdue_beyond_grace')::numeric where id = h.id;
    end if;
  elsif v_outcome in ('passed', 'not_checked') and h.status in ('held', 'rejected') then
    perform private.ap3_clear_hold(h.id, case when v_outcome = 'passed' then 'Cleared by system: exposure is within the credit limit and nothing is overdue beyond grace'
      else 'Cleared by system: the customer has no credit limit now' end, case when p_actor is null then 'job' else 'event' end);
  end if;
  return e || jsonb_build_object('outcome', v_outcome, 'hold_id', coalesce(h.id, (select x.id from public.order_credit_holds x where x.company_id = p_company and x.order_id = o.id and x.status in ('held', 'approved', 'rejected'))));
end;
$$;
revoke all on function private.ap3_credit_check_order(uuid, uuid, text, uuid) from public, anon, authenticated;

-- At dispatch: recheck with this dispatch's value. Over the limit needs an approved, unexpired hold covering the exposure.
create or replace function private.ap3_guard_credit_dispatch()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare o public.orders%rowtype; e jsonb; h public.order_credit_holds%rowtype; v_value numeric;
begin
  if not (new.delivery_status = 'dispatched' and old.delivery_status = 'pending') then return new; end if;
  select * into o from public.orders where id = new.order_id and company_id = new.company_id;
  if o.customer_id is null or o.opening_cutover_id is not null then return new; end if;
  v_value := coalesce(private.ap3_dispatch_value(new.company_id, new.id), 0);
  e := private.ap3_exposure(new.company_id, o.customer_id, v_value, new.id);
  if e ->> 'result' = 'no_limit' then return new; end if;
  if e ->> 'result' = 'within' then
    insert into public.order_credit_checks(company_id, order_id, customer_id, stage, dispatch_id, outstanding, unbilled, this_value, on_account, exposure, credit_limit, overdue_beyond_grace, result, outcome, checked_by)
      values (new.company_id, o.id, o.customer_id, 'dispatch', new.id, (e ->> 'outstanding')::numeric, (e ->> 'unbilled')::numeric, v_value, (e ->> 'on_account')::numeric,
        (e ->> 'exposure')::numeric, (e ->> 'credit_limit')::numeric, (e ->> 'overdue_beyond_grace')::numeric, 'within', 'passed', (select u.id from public.app_users u where u.id = auth.uid()));
    perform private.ap3_clear_hold(x.id, 'Cleared by system at dispatch: exposure is within the credit limit', 'event')
      from public.order_credit_holds x where x.company_id = new.company_id and x.order_id = o.id and x.status in ('held', 'rejected');
    return new;
  end if;
  select * into h from public.order_credit_holds x where x.company_id = new.company_id and x.order_id = o.id and x.status = 'approved'
    and x.expires_at > now() and x.approved_exposure >= (e ->> 'exposure')::numeric;
  if h.id is not null then
    insert into public.order_credit_checks(company_id, order_id, customer_id, stage, dispatch_id, outstanding, unbilled, this_value, on_account, exposure, credit_limit, overdue_beyond_grace, result, outcome, checked_by)
      values (new.company_id, o.id, o.customer_id, 'dispatch', new.id, (e ->> 'outstanding')::numeric, (e ->> 'unbilled')::numeric, v_value, (e ->> 'on_account')::numeric,
        (e ->> 'exposure')::numeric, (e ->> 'credit_limit')::numeric, (e ->> 'overdue_beyond_grace')::numeric, e ->> 'result', 'approved_cover', (select u.id from public.app_users u where u.id = auth.uid()));
    return new;
  end if;
  raise exception 'AP: Credit hold on order %: %. An approver must approve credit for this order (Orders > credit) before it is dispatched.',
    coalesce(o.order_number, ''), array_to_string(private.ap3_reasons(e), '; ') using errcode = '23514';
end;
$$;
revoke all on function private.ap3_guard_credit_dispatch() from public, anon, authenticated;
drop trigger if exists b_ap3_guard_credit_dispatch on public.dispatches;
create trigger b_ap3_guard_credit_dispatch before update of delivery_status on public.dispatches for each row execute function private.ap3_guard_credit_dispatch();

-- ---------------------------------------------------------------------------------------------------------------
-- AP-045: draft production jobs from a confirmed order, grouped by die, alloy and temper
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap3_line_die(p_company uuid, p_profile uuid, p_die uuid)
returns uuid language sql stable security definer set search_path = public, private as $$
  select coalesce(p_die, (select case when count(*) = 1 then (array_agg(d.id))[1] end from public.dies d
    where d.company_id = p_company and d.profile_id = p_profile and d.deleted_at is null and d.die_status in ('active', 'approved')))
$$;
revoke all on function private.ap3_line_die(uuid, uuid, uuid) from public, anon, authenticated;

-- What an order line still needs from the press: demand less allocated stock and existing jobs.
create or replace function private.ap3_line_need_kg(p_company uuid, p_order uuid, p_item uuid)
returns numeric language plpgsql stable security definer set search_path = public, private as $$
declare q jsonb; o public.orders%rowtype;
begin
  if p_item is not null then
    q := private.stock_line_quantities(p_company, p_item);
    if q is null then return 0; end if;
    return greatest(coalesce((q ->> 'demand_kg')::numeric, 0) - coalesce((q ->> 'stock_covered_kg')::numeric, 0) - coalesce((q ->> 'production_committed_kg')::numeric, 0), 0);
  end if;
  select * into o from public.orders where id = p_order and company_id = p_company;
  return greatest(coalesce(o.production_quantity_kg, o.manufacturing_weight_kg, 0) - coalesce((select sum(case when j.status = 'completed' and j.actual_quantity_kg > 0 then j.actual_quantity_kg else j.planned_quantity_kg end)
    from public.production_jobs j where j.company_id = p_company and j.order_id = p_order and j.status <> 'cancelled'), 0), 0);
end;
$$;
revoke all on function private.ap3_line_need_kg(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.ap3_add_draft_line(p_company uuid, p_order public.orders, p_item uuid, p_profile uuid, p_die uuid, p_alloy text, p_temper text,
  p_kg numeric, p_pieces integer, p_length numeric, p_kgm numeric)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v_die uuid; v_key text; v_draft uuid; v_line uuid;
begin
  if p_profile is null or coalesce(p_kg, 0) <= 0.001 then return null; end if;
  v_die := private.ap3_line_die(p_company, p_profile, p_die);
  v_key := case when v_die is not null then 'die:' || v_die::text else 'profile:' || p_profile::text end
    || '|' || coalesce(lower(nullif(btrim(p_alloy), '')), '-') || '|' || coalesce(lower(nullif(btrim(p_temper), '')), '-');
  insert into public.production_job_drafts(company_id, group_key, die_id, profile_id, alloy, temper)
    values (p_company, v_key, v_die, p_profile, nullif(btrim(p_alloy), ''), nullif(btrim(p_temper), ''))
    on conflict (company_id, group_key) where status = 'open' do nothing returning id into v_draft;
  if v_draft is null then select d.id into v_draft from public.production_job_drafts d where d.company_id = p_company and d.group_key = v_key and d.status = 'open'; end if;
  insert into public.production_job_draft_lines(company_id, draft_id, order_id, order_item_id, profile_id, required_kg, pieces, length_m, kg_per_m, due_date)
    values (p_company, v_draft, p_order.id, p_item, p_profile, round(p_kg, 3), nullif(p_pieces, 0), nullif(p_length, 0), p_kgm, p_order.expected_dispatch_date)
    on conflict do nothing returning id into v_line;
  return v_line;
end;
$$;
revoke all on function private.ap3_add_draft_line(uuid, public.orders, uuid, uuid, uuid, text, text, numeric, integer, numeric, numeric) from public, anon, authenticated;

create or replace function private.ap3_draft_jobs_for_order(p_company uuid, p_order uuid)
returns integer language plpgsql security definer set search_path = public, private as $$
declare o public.orders%rowtype; it record; v_n integer := 0; v_id uuid; pr public.aluminium_profiles%rowtype;
begin
  select * into o from public.orders where id = p_order and company_id = p_company and deleted_at is null;
  if o.id is null or o.current_stage in ('cancelled', 'dispatched', 'delivered', 'closed') then return 0; end if;
  for it in select i.*, p.alloy p_alloy, p.temper p_temper, p.section_weight_kg_per_m p_kgm from public.order_items i
      join public.aluminium_profiles p on p.id = i.profile_id and p.company_id = i.company_id
      where i.company_id = p_company and i.order_id = o.id order by i.created_at, i.id loop
    v_id := private.ap3_add_draft_line(p_company, o, it.id, it.profile_id, it.die_id,
      coalesce(nullif(it.technical_spec_snapshot ->> 'alloy', ''), it.p_alloy), coalesce(nullif(it.technical_spec_snapshot ->> 'temper', ''), it.p_temper),
      private.ap3_line_need_kg(p_company, o.id, it.id), it.quantity_pieces, coalesce(it.length_per_piece_m, it.cut_length), coalesce(it.section_weight_kg_per_m, it.p_kgm));
    if v_id is not null then v_n := v_n + 1; end if;
  end loop;
  if not exists (select 1 from public.order_items i where i.company_id = p_company and i.order_id = o.id) and o.production_profile_id is not null then
    select * into pr from public.aluminium_profiles where id = o.production_profile_id and company_id = p_company;
    v_id := private.ap3_add_draft_line(p_company, o, null, o.production_profile_id, o.production_die_id, pr.alloy, pr.temper,
      private.ap3_line_need_kg(p_company, o.id, null), o.production_pieces, null, pr.section_weight_kg_per_m);
    if v_id is not null then v_n := v_n + 1; end if;
  end if;
  return v_n;
end;
$$;
revoke all on function private.ap3_draft_jobs_for_order(uuid, uuid) from public, anon, authenticated;

-- Runs once at commit of the transaction that confirms the order (after its lines are inserted). Failures never undo the
-- order: they are reported to the owner and the scheduled jobs retry.
create or replace function private.ap3_on_order_confirmed()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_actor uuid := auth.uid();
begin
  if new.opening_cutover_id is not null or new.customer_id is null or new.deleted_at is not null then return null; end if;
  begin
    perform private.ap3_credit_check_order(new.company_id, new.id, 'confirmation', v_actor);
  exception when others then
    perform private.ap3_notify_roles(new.company_id, array['owner', 'admin'], 'autopilot_error', 'warning', 'Credit check could not run for order ' || coalesce(new.order_number, ''),
      left(sqlerrm, 300), 'order', new.id, '/orders/' || new.id, null, v_actor);
  end;
  begin
    perform private.ap3_draft_jobs_for_order(new.company_id, new.id);
  exception when others then
    perform private.ap3_notify_roles(new.company_id, array['owner', 'admin'], 'autopilot_error', 'warning', 'Draft jobs could not be prepared for order ' || coalesce(new.order_number, ''),
      left(sqlerrm, 300), 'order', new.id, '/orders/' || new.id, null, v_actor);
  end;
  return null;
end;
$$;
revoke all on function private.ap3_on_order_confirmed() from public, anon, authenticated;
drop trigger if exists zz_ap3_order_confirmed on public.orders;
create constraint trigger zz_ap3_order_confirmed after insert on public.orders deferrable initially deferred
  for each row execute function private.ap3_on_order_confirmed();

-- Releases the open lines of a draft as planned jobs through the existing job save (with its own checks). Lines whose
-- order is on an undecided or rejected credit hold, or whose need is now covered by stock or other jobs, are skipped.
create or replace function private.ap3_release_draft(p_company uuid, p_actor uuid, p_role text, p_draft uuid, p_machine uuid, p_planned date, p_lines uuid[])
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  d public.production_job_drafts%rowtype; ln public.production_job_draft_lines%rowtype; o public.orders%rowtype; v_need numeric; v_kg numeric; v_job uuid;
  v_released jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb; v_hold text; v_pieces integer;
begin
  if not (p_role = any(private.ap3_planner_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
  select * into d from public.production_job_drafts where id = p_draft and company_id = p_company for update;
  if d.id is null or d.status <> 'open' then raise exception 'AP: This draft is no longer open.'; end if;
  if p_machine is not null and not exists (select 1 from public.machines m where m.id = p_machine and m.company_id = p_company) then raise exception 'AP: Choose a press of this factory.'; end if;
  if p_planned is not null and (p_planned < private.ist_today() - 1 or p_planned > private.ist_today() + 120) then raise exception 'AP: Plan the jobs within the next 120 days.'; end if;
  for ln in select * from public.production_job_draft_lines x where x.draft_id = d.id and x.status = 'open' and (p_lines is null or x.id = any(p_lines))
      order by x.due_date nulls last, x.created_at, x.id for update loop
    select * into o from public.orders where id = ln.order_id and company_id = p_company;
    if o.id is null or o.deleted_at is not null or o.current_stage in ('cancelled', 'dispatched', 'delivered', 'closed') then
      update public.production_job_draft_lines set status = 'removed', closed_at = clock_timestamp(), closed_by = p_actor, note = 'Order is no longer open' where id = ln.id;
      v_skipped := v_skipped || jsonb_build_object('line_id', ln.id, 'order', o.order_number, 'reason', 'Order is no longer open');
      continue;
    end if;
    v_hold := null;
    select h.status into v_hold from public.order_credit_holds h where h.company_id = p_company and h.order_id = o.id and h.status in ('held', 'rejected');
    if v_hold is not null then
      v_skipped := v_skipped || jsonb_build_object('line_id', ln.id, 'order', o.order_number, 'reason', case when v_hold = 'held' then 'Order is on credit hold until credit is approved' else 'Credit was refused for this order' end);
      continue;
    end if;
    v_need := private.ap3_line_need_kg(p_company, o.id, ln.order_item_id);
    if v_need <= 0.001 then
      update public.production_job_draft_lines set status = 'covered', closed_at = clock_timestamp(), closed_by = p_actor, note = 'Covered by stock or other jobs' where id = ln.id;
      v_skipped := v_skipped || jsonb_build_object('line_id', ln.id, 'order', o.order_number, 'reason', 'Already covered by allocated stock or other jobs');
      continue;
    end if;
    v_kg := round(least(ln.required_kg, v_need), 3);
    v_pieces := case when ln.pieces is null then null when v_kg >= ln.required_kg then ln.pieces else ceil(ln.pieces * v_kg / ln.required_kg)::integer end;
    begin
      v_job := private.save_production_job_atomic(null, jsonb_strip_nulls(jsonb_build_object('order_id', o.id, 'profile_id', ln.profile_id, 'die_id', d.die_id, 'machine_id', p_machine,
        'planned_quantity_kg', v_kg, 'pieces', v_pieces, 'length_per_piece_m', ln.length_m, 'section_weight_kg_per_m', ln.kg_per_m, 'planned_date', p_planned,
        'status', 'planned', 'source_line_id', ln.order_item_id, 'remarks', left('Released from the draft group for ' || coalesce(d.alloy, '') || ' ' || coalesce(d.temper, ''), 200))), null);
      update public.production_job_draft_lines set status = 'released', job_id = v_job, required_kg = v_kg, closed_at = clock_timestamp(), closed_by = p_actor where id = ln.id;
      v_released := v_released || jsonb_build_object('line_id', ln.id, 'order', o.order_number, 'job_id', v_job, 'kg', v_kg,
        'job_number', (select j.job_number from public.production_jobs j where j.id = v_job));
    exception when others then
      v_skipped := v_skipped || jsonb_build_object('line_id', ln.id, 'order', o.order_number, 'reason', left(regexp_replace(sqlerrm, '^AP: ', ''), 200));
    end;
  end loop;
  if not exists (select 1 from public.production_job_draft_lines x where x.draft_id = d.id and x.status = 'open') then
    update public.production_job_drafts set status = 'released', released_at = clock_timestamp(), released_by = p_actor where id = d.id;
  end if;
  return jsonb_build_object('draft_id', d.id, 'released', v_released, 'skipped', v_skipped);
end;
$$;
revoke all on function private.ap3_release_draft(uuid, uuid, text, uuid, uuid, date, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-046: invoice drafts at gate-out
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap3_active_invoice(p_company uuid, p_dispatch uuid)
returns uuid language sql stable security definer set search_path = public, private as $$
  select i.id from public.invoices i where i.company_id = p_company and i.dispatch_id = p_dispatch and i.status <> 'cancelled' and i.deleted_at is null
  order by i.created_at desc limit 1
$$;
revoke all on function private.ap3_active_invoice(uuid, uuid) from public, anon, authenticated;

-- Prepares (or refreshes) the draft for a dispatch that left the gate. The totals mirror the reviewed invoice basis: goods
-- lines from the packing list at the order rates with their GST, plus one-off die and freight charges billed separately.
-- Posting runs the reviewed invoice transaction, which recomputes everything and allocates the number.
create or replace function private.ap3_prepare_invoice_draft(p_company uuid, p_dispatch uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  d public.dispatches%rowtype; o public.orders%rowtype; v_inv uuid; v_supply jsonb; v_fp text; v_block text; v_goods numeric; v_tax numeric; v_charges numeric;
  v_charge_tax numeric; v_lines integer; v_date date; v_due date; v_days integer; v_id uuid; v_lock date; v_status text;
begin
  select * into d from public.dispatches where id = p_dispatch and company_id = p_company;
  if d.id is null or d.actual_dispatched_at is null then return null; end if;
  select * into o from public.orders where id = d.order_id and company_id = p_company;
  if o.id is null or o.customer_id is null or o.opening_cutover_id is not null then return null; end if;
  v_inv := private.ap3_active_invoice(p_company, d.id);
  if v_inv is not null then
    update public.invoice_drafts set status = 'posted', invoice_id = v_inv, blocker = null, posted_at = coalesce(posted_at, clock_timestamp())
      where company_id = p_company and dispatch_id = d.id and status in ('open', 'blocked');
    return jsonb_build_object('state', 'posted', 'invoice_id', v_inv);
  end if;
  if d.delivery_status in ('returned', 'damaged') then
    update public.invoice_drafts set status = 'cancelled', blocker = null where company_id = p_company and dispatch_id = d.id and status in ('open', 'blocked');
    return jsonb_build_object('state', 'cancelled');
  end if;
  v_supply := private.ap3_derive_supply(p_company, o.customer_id);
  begin
    v_fp := private.reviewed_invoice_source_fingerprint(p_company, d.id);
  exception when others then
    v_fp := null; v_block := left(sqlerrm, 300);
  end;
  if v_block is null and not private.invoice_dispatch_is_billable(p_company, o.id, d.id) then
    v_block := 'The packing list is not ready for invoicing: every bundle needs its weight, rate and operator verification.';
  end if;
  if v_block is null and v_supply ->> 'supplier_state' is null then v_block := 'Set the company GST state before invoicing.'; end if;
  if v_block is null and v_supply ->> 'state' is null then v_block := 'The place of supply cannot be derived: the customer has no valid GSTIN and no recognised state.'; end if;
  select count(*), round(coalesce(sum(round(round(x.w, 3) * round(x.rate, 2), 2)), 0), 2), coalesce(sum(round(round(round(x.w, 3) * round(x.rate, 2), 2) * x.gst / 100, 2)), 0)
    into v_lines, v_goods, v_tax
    from (select coalesce(nullif(p.net_weight_kg, 0), nullif(p.gross_weight_kg, 0), 0) w, coalesce(nullif(p.net_rate, 0), 0) rate,
        coalesce(p.gst_percent, oi.gst_percent, qi.gst_percent, q.gst_percent, (select s.default_gst_percent from public.company_settings s where s.company_id = p_company), 18) gst
      from public.packing_list_items p
      left join public.order_items oi on oi.id = p.order_item_id and oi.company_id = p.company_id
      left join public.quote_items qi on qi.id = p.quote_item_id and qi.company_id = p.company_id
      left join public.quotes q on q.id = qi.quote_id and q.company_id = p.company_id
      where p.company_id = p_company and p.dispatch_id = d.id) x;
  select coalesce(sum(c.amt), 0), coalesce(sum(round(c.amt * c.gst / 100, 2)), 0) into v_charges, v_charge_tax from (
    select ch.amt, coalesce(oi.gst_percent, (select s.default_gst_percent from public.company_settings s where s.company_id = p_company), 18) gst
    from public.order_items oi
    cross join lateral (values (oi.die_service_charge, 'die_charge'), (oi.freight_charge, 'freight_charge')) ch(amt, kind)
    where oi.company_id = p_company and oi.charges_billed_separately and coalesce(ch.amt, 0) > 0
      and oi.id in (select p.order_item_id from public.packing_list_items p where p.company_id = p_company and p.dispatch_id = d.id)
      and not exists (select 1 from public.invoice_items other join public.invoices i on i.id = other.invoice_id and i.company_id = other.company_id
        where other.company_id = p_company and other.order_item_id = oi.id and other.line_kind = ch.kind and i.status <> 'cancelled' and i.deleted_at is null)) c;
  v_date := (d.actual_dispatched_at at time zone 'Asia/Kolkata')::date;
  v_lock := private.books_locked_through(p_company);
  if v_lock is not null and v_date <= v_lock then v_date := private.ist_today(); end if;
  select l.credit_days into v_days from public.customer_credit_limits l where l.company_id = p_company and l.customer_id = o.customer_id and l.status = 'active';
  v_due := case when v_days is not null then v_date + v_days end;
  v_status := case when v_block is null then 'open' else 'blocked' end;
  insert into public.invoice_drafts(company_id, dispatch_id, order_id, customer_id, gate_out_at, invoice_date, due_date, place_of_supply_state_code, supply_basis, source_fingerprint,
      goods_value, tax_value, charges_value, total_value, line_count, status, blocker)
    values (p_company, d.id, o.id, o.customer_id, d.actual_dispatched_at, v_date, v_due, v_supply ->> 'state', v_supply, v_fp, v_goods, v_tax + v_charge_tax, v_charges,
      v_goods + v_tax + v_charges + v_charge_tax, v_lines, v_status, v_block)
    on conflict (company_id, dispatch_id) do update set invoice_date = excluded.invoice_date, due_date = excluded.due_date,
      place_of_supply_state_code = excluded.place_of_supply_state_code, supply_basis = excluded.supply_basis, source_fingerprint = excluded.source_fingerprint,
      goods_value = excluded.goods_value, tax_value = excluded.tax_value, charges_value = excluded.charges_value, total_value = excluded.total_value,
      line_count = excluded.line_count, status = excluded.status, blocker = excluded.blocker, invoice_id = null, posted_at = null, refreshed_at = clock_timestamp()
      where invoice_drafts.status in ('open', 'blocked', 'cancelled')
    returning id into v_id;
  return jsonb_build_object('state', v_status, 'draft_id', v_id, 'blocker', v_block);
end;
$$;
revoke all on function private.ap3_prepare_invoice_draft(uuid, uuid) from public, anon, authenticated;

-- Runs at commit of the transaction that moved the dispatch (after the stock posting), so the packing list is final.
create or replace function private.ap3_on_dispatch_billing()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.actual_dispatched_at is null then return null; end if;
  if tg_op = 'UPDATE' and old.actual_dispatched_at is not null and new.delivery_status is not distinct from old.delivery_status then return null; end if;
  begin
    perform private.ap3_prepare_invoice_draft(new.company_id, new.id);
  exception when others then
    perform private.ap3_notify_roles(new.company_id, array['owner', 'accounts'], 'autopilot_error', 'warning', 'Invoice draft could not be prepared for dispatch ' || coalesce(new.dispatch_number, ''),
      left(sqlerrm, 300), 'dispatch', new.id, '/dispatches/' || new.id, null, auth.uid());
  end;
  return null;
end;
$$;
revoke all on function private.ap3_on_dispatch_billing() from public, anon, authenticated;
drop trigger if exists zz_ap3_dispatch_billing on public.dispatches;
create constraint trigger zz_ap3_dispatch_billing after update of delivery_status on public.dispatches deferrable initially deferred
  for each row execute function private.ap3_on_dispatch_billing();

-- An invoice for the dispatch (whoever created it) closes the draft; cancelling that invoice reopens it.
create or replace function private.ap3_on_invoice_for_draft()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.dispatch_id is null then return null; end if;
  if new.status <> 'cancelled' and new.deleted_at is null then
    update public.invoice_drafts set status = 'posted', invoice_id = new.id, blocker = null, posted_at = coalesce(posted_at, clock_timestamp())
      where company_id = new.company_id and dispatch_id = new.dispatch_id and status in ('open', 'blocked');
  elsif tg_op = 'UPDATE' and (old.status <> 'cancelled' and old.deleted_at is null) then
    update public.invoice_drafts set status = 'open', invoice_id = null, posted_at = null, refreshed_at = clock_timestamp()
      where company_id = new.company_id and invoice_id = new.id and status = 'posted';
  end if;
  return null;
end;
$$;
revoke all on function private.ap3_on_invoice_for_draft() from public, anon, authenticated;
drop trigger if exists zz_ap3_invoice_for_draft on public.invoices;
create trigger zz_ap3_invoice_for_draft after insert or update of status, deleted_at on public.invoices for each row execute function private.ap3_on_invoice_for_draft();

create or replace function private.ap3_draft_row(x public.invoice_drafts)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', x.id, 'dispatch_id', x.dispatch_id, 'order_id', x.order_id, 'customer_id', x.customer_id, 'status', x.status, 'blocker', x.blocker,
    'dispatch_number', d.dispatch_number, 'order_number', o.order_number, 'customer', coalesce(nullif(btrim(c.company_name), ''), c.customer_name),
    'gate_out_at', x.gate_out_at, 'invoice_date', x.invoice_date, 'due_date', x.due_date, 'place_of_supply_state_code', x.place_of_supply_state_code,
    'supply_basis', x.supply_basis, 'goods_value', x.goods_value, 'tax_value', x.tax_value, 'charges_value', x.charges_value, 'total_value', x.total_value,
    'line_count', x.line_count, 'invoice_id', x.invoice_id, 'invoice_number', (select i.invoice_number from public.invoices i where i.id = x.invoice_id),
    'explanation', x.explanation, 'explained_at', x.explained_at, 'refreshed_at', x.refreshed_at,
    'working_days_since_gate_out', private.factory_working_days_between(x.company_id, (x.gate_out_at at time zone 'Asia/Kolkata')::date, private.ist_today()))
  from public.dispatches d join public.orders o on o.id = x.order_id left join public.customers c on c.id = x.customer_id
  where d.id = x.dispatch_id
$$;
revoke all on function private.ap3_draft_row(public.invoice_drafts) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-031: quotation expiry, validity extension (with approval when configured) and requote at today's rate
-- ---------------------------------------------------------------------------------------------------------------
-- Same transitions as before, plus: an expired quote may return to 'sent' only inside an approved validity extension.
create or replace function private.enforce_quote_status_transition()
returns trigger language plpgsql security definer set search_path = public, private as $$
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
      or (new.status = 'sent' and coalesce(current_setting('ap.quote_extension', true), '') = new.id::text)
    else false
  end;

  if not v_allowed then
    raise exception 'Quote cannot move from % to %', old.status, new.status;
  end if;

  if coalesce(new.low_margin_approval_required, false)
    and new.status in ('approved_for_sending', 'sent', 'customer_approved')
    and not (old.status = 'expired' and new.status = 'sent')
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
$$;

-- An order cannot be created from a quotation whose validity has ended (opening orders from the cut-over excepted).
create or replace function private.ap3_guard_expired_quote()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare q record;
begin
  if new.quote_id is null or new.opening_cutover_id is not null then return new; end if;
  if tg_op = 'UPDATE' and new.quote_id is not distinct from old.quote_id then return new; end if;
  select x.quote_number, x.valid_until into q from public.quotes x where x.id = new.quote_id and x.company_id = new.company_id;
  if q.valid_until is not null and q.valid_until < private.ist_today() then
    raise exception 'AP: Quotation % was valid until %. Requote it at today''s rate or extend its validity (with approval) before converting it to an order.',
      coalesce(q.quote_number, ''), to_char(q.valid_until, 'DD Mon YYYY') using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.ap3_guard_expired_quote() from public, anon, authenticated;
drop trigger if exists b_ap3_guard_expired_quote on public.orders;
create trigger b_ap3_guard_expired_quote before insert or update of quote_id on public.orders for each row execute function private.ap3_guard_expired_quote();

create or replace function private.ap3_apply_extension(p_company uuid, p_actor uuid, p_quote uuid, p_until date, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare q public.quotes%rowtype;
begin
  select * into q from public.quotes where id = p_quote and company_id = p_company and deleted_at is null for update;
  if q.id is null then raise exception 'AP: Quotation not found.'; end if;
  if q.status not in ('sent', 'expired', 'customer_approved', 'approved_for_sending') then raise exception 'AP: Only a sent, approved or expired quotation can be extended.'; end if;
  perform set_config('ap.quote_extension', q.id::text, true);
  update public.quotes set valid_until = p_until, status = case when status = 'expired' then 'sent' else status end, updated_at = now() where id = q.id;
  perform set_config('ap.quote_extension', '', true);
  insert into public.quote_validity_events(company_id, quote_id, event, old_valid_until, new_valid_until, revision_number, reason, actor_id)
    values (p_company, q.id, 'extended', q.valid_until, p_until, q.revision_number, p_reason, p_actor);
  return jsonb_build_object('quote_id', q.id, 'valid_until', p_until, 'status', case when q.status = 'expired' then 'sent' else q.status end);
end;
$$;
revoke all on function private.ap3_apply_extension(uuid, uuid, uuid, date, text) from public, anon, authenticated;

-- Requote: copies the lines into a new revision through the existing quote save (it snapshots the old revision and moves
-- the quotation to draft for approval and sending again). Billet and conversion rates are re-read for today where an
-- approved rate exists; every other line value is kept as quoted.
create or replace function private.ap3_requote(p_company uuid, p_actor uuid, p_role text, p_quote uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare q public.quotes%rowtype; v_items jsonb; v_days integer; v_billet public.costing_rates%rowtype; v_conv public.costing_rates%rowtype; v_today date := private.ist_today();
  v_alloy text; v_changed integer := 0;
begin
  if p_role not in ('owner', 'admin') then raise exception 'AP: Only an owner or admin can requote priced lines.'; end if;
  select * into q from public.quotes where id = p_quote and company_id = p_company and deleted_at is null for update;
  if q.id is null then raise exception 'AP: Quotation not found.'; end if;
  if q.status = 'converted_to_order' then raise exception 'AP: This quotation is already converted to an order.'; end if;
  if not (q.status = 'expired' or (q.status in ('sent', 'approved_for_sending', 'customer_approved') and q.valid_until < v_today)) then
    raise exception 'AP: Requote is for quotations whose validity has ended. Edit the quotation to revise it.';
  end if;
  if exists (select 1 from public.orders o where o.company_id = p_company and o.quote_id = q.id) then raise exception 'AP: An order already uses this quotation.'; end if;
  v_days := greatest(coalesce(q.valid_until - q.quote_date, (select s.default_quote_validity_days from public.company_settings s where s.company_id = p_company), 15), 7);
  v_billet := private.applicable_costing_rate(p_company, 'billet', 'per_kg', v_today, q.customer_id, null, null);
  v_conv := private.applicable_costing_rate(p_company, 'conversion', 'per_kg', v_today, q.customer_id, null, null);
  select coalesce(jsonb_agg((to_jsonb(i) - array['id', 'company_id', 'quote_id', 'created_at', 'updated_at', 'source_record_id', 'source_line_id'])
      || case when v_billet.id is not null then jsonb_build_object('billet_rate_per_kg', v_billet.rate) else '{}'::jsonb end
      || case when v_conv.id is not null then jsonb_build_object('conversion_charge_per_kg', v_conv.rate) else '{}'::jsonb end
      order by i.created_at, i.id), '[]'::jsonb),
    count(*) filter (where (v_billet.id is not null and i.billet_rate_per_kg is distinct from v_billet.rate) or (v_conv.id is not null and i.conversion_charge_per_kg is distinct from v_conv.rate))
    into v_items, v_changed
    from public.quote_items i where i.company_id = p_company and i.quote_id = q.id;
  if jsonb_array_length(v_items) = 0 then raise exception 'AP: The quotation has no lines to requote.'; end if;
  perform private.save_quote_atomic(q.id, jsonb_build_object('customer_id', q.customer_id, 'quote_date', v_today, 'valid_until', v_today + v_days,
      'terms_and_conditions', q.terms_and_conditions, 'delivery_timeline', q.delivery_timeline, 'payment_terms', q.payment_terms, 'notes', q.notes, 'gst_percent', q.gst_percent),
    v_items, q.revision_number, q.updated_at, left(coalesce(nullif(btrim(p_reason), ''), 'Requote at today''s rate after validity ended on ' || to_char(q.valid_until, 'DD Mon YYYY')), 300));
  insert into public.quote_validity_events(company_id, quote_id, event, old_valid_until, new_valid_until, revision_number, reason, actor_id)
    values (p_company, q.id, 'requoted', q.valid_until, v_today + v_days, q.revision_number + 1, p_reason, p_actor);
  return jsonb_build_object('quote_id', q.id, 'revision_number', q.revision_number + 1, 'valid_until', v_today + v_days, 'lines', jsonb_array_length(v_items),
    'lines_repriced', v_changed, 'billet_rate', v_billet.rate, 'conversion_rate', v_conv.rate, 'status', 'draft');
end;
$$;
revoke all on function private.ap3_requote(uuid, uuid, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-097: possible duplicates before saving (warnings; the person decides)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap3_duplicates(p_company uuid, p_kind text, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare s public.o2c_settings%rowtype := private.ap3_settings(p_company); v_since timestamptz; v_out jsonb := '[]'::jsonb; v_amount numeric; v_kg numeric; v_ref text;
  v_date date; v_customer uuid; v_exclude uuid; v_profiles uuid[];
begin
  v_since := now() - make_interval(days => s.duplicate_window_days);
  v_customer := private.ap_uuid(p, 'customer_id', false);
  v_exclude := private.ap_uuid(p, 'exclude_id', false);
  if p_kind = 'quote' then
    select coalesce(array_agg(distinct x::uuid), '{}') into v_profiles from jsonb_array_elements_text(coalesce(p -> 'profile_ids', '[]'::jsonb)) x where x ~* '^[0-9a-f-]{36}$';
    select coalesce(jsonb_agg(m order by m ->> 'created_at' desc), '[]'::jsonb) into v_out from (
      select jsonb_build_object('id', q.id, 'kind', 'quote', 'label', coalesce(q.quote_number, 'Quotation'), 'href', '/quotes/' || q.id, 'created_at', q.created_at,
        'why', format('Same customer and %s of the same profile(s), %s, %s', (select count(distinct i.profile_id) from public.quote_items i where i.quote_id = q.id and i.profile_id = any(v_profiles)),
          to_char(q.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), replace(q.status, '_', ' '))) m
      from public.quotes q where q.company_id = p_company and q.customer_id = v_customer and q.deleted_at is null and q.created_at >= v_since
        and (v_exclude is null or q.id <> v_exclude) and q.status <> 'converted_to_order'
        and exists (select 1 from public.quote_items i where i.quote_id = q.id and i.company_id = p_company and i.profile_id = any(v_profiles))
      order by q.created_at desc limit 5) z;
  elsif p_kind = 'order' then
    v_amount := nullif(p ->> 'order_value', '')::numeric; v_kg := nullif(p ->> 'production_quantity_kg', '')::numeric;
    select coalesce(jsonb_agg(m order by m ->> 'created_at' desc), '[]'::jsonb) into v_out from (
      select jsonb_build_object('id', o.id, 'kind', 'order', 'label', coalesce(o.order_number, 'Order'), 'href', '/orders/' || o.id, 'created_at', o.created_at,
        'why', case when o.quote_id is not null and o.quote_id = private.ap_uuid(p, 'quote_id', false) then 'Same quotation already has this order'
          when v_amount is not null and abs(coalesce(o.order_value, 0) - v_amount) <= greatest(1, v_amount * 0.005) then format('Same customer and value INR %s, %s', private.ap3_inr(o.order_value), to_char(o.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'))
          else format('Same customer, profile and quantity (%s kg), %s', trim_scale(o.production_quantity_kg), to_char(o.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')) end) m
      from public.orders o where o.company_id = p_company and o.customer_id = v_customer and o.deleted_at is null and o.current_stage <> 'cancelled' and o.created_at >= v_since
        and (v_exclude is null or o.id <> v_exclude)
        and ((o.quote_id is not null and o.quote_id = private.ap_uuid(p, 'quote_id', false))
          or (v_amount is not null and v_amount > 0 and abs(coalesce(o.order_value, 0) - v_amount) <= greatest(1, v_amount * 0.005))
          or (v_kg is not null and v_kg > 0 and o.production_profile_id = private.ap_uuid(p, 'production_profile_id', false) and abs(coalesce(o.production_quantity_kg, 0) - v_kg) <= v_kg * 0.005))
      order by o.created_at desc limit 5) z;
  elsif p_kind = 'receipt' then
    v_amount := nullif(p ->> 'amount', '')::numeric; v_ref := lower(nullif(btrim(coalesce(p ->> 'reference_number', '')), ''));
    v_date := nullif(p ->> 'payment_date', '')::date;
    select coalesce(jsonb_agg(m order by m ->> 'created_at' desc), '[]'::jsonb) into v_out from (
      select jsonb_build_object('id', e.id, 'kind', 'receipt', 'label', coalesce(e.reference_number, 'Receipt') || ' · INR ' || private.ap3_inr(e.received_amount), 'href', '/payments/receipts',
        'created_at', e.created_at,
        'why', case when v_ref is not null and lower(btrim(coalesce(e.reference_number, ''))) = v_ref then 'Same reference already recorded on ' || to_char(e.payment_date, 'DD Mon YYYY')
          else format('Same amount for the same customer within %s days (%s)', s.duplicate_window_days, to_char(e.payment_date, 'DD Mon YYYY')) end) m
      from public.financial_receipt_events e where e.company_id = p_company and e.status <> 'reversed'
        and ((v_ref is not null and lower(btrim(coalesce(e.reference_number, ''))) = v_ref)
          or (v_amount is not null and v_customer is not null and v_date is not null and e.received_amount = v_amount and abs(e.payment_date - v_date) <= s.duplicate_window_days
            and exists (select 1 from public.financial_receipt_allocations a join public.invoices i on i.id = a.invoice_id where a.receipt_event_id = e.id and i.customer_id = v_customer)))
      order by e.created_at desc limit 5) z;
    if v_ref is not null then
      v_out := v_out || coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', 'receipt', 'label', 'On-account ' || coalesce(c.reference, '') || ' · INR ' || private.ap3_inr(c.amount),
          'href', '/customers/' || c.customer_id, 'created_at', c.created_at, 'why', 'Same reference already recorded as on-account money on ' || to_char(c.received_on, 'DD Mon YYYY')))
        from public.customer_on_account_credits c where c.company_id = p_company and c.status <> 'reversed' and lower(btrim(coalesce(c.reference, ''))) = v_ref), '[]'::jsonb);
    end if;
  elsif p_kind = 'dispatch' then
    v_kg := nullif(p ->> 'total_weight_kg', '')::numeric;
    select coalesce(jsonb_agg(m order by m ->> 'created_at' desc), '[]'::jsonb) into v_out from (
      select jsonb_build_object('id', d.id, 'kind', 'dispatch', 'label', coalesce(d.dispatch_number, 'Dispatch'), 'href', '/dispatches/' || d.id, 'created_at', d.created_at,
        'why', format('Same order and weight (%s kg), %s, %s', trim_scale(d.total_weight_kg), to_char(d.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), replace(d.delivery_status, '_', ' '))) m
      from public.dispatches d where d.company_id = p_company and d.order_id = private.ap_uuid(p, 'order_id', false) and d.created_at >= v_since
        and d.delivery_status not in ('returned', 'damaged') and (v_exclude is null or d.id <> v_exclude)
        and v_kg is not null and v_kg > 0 and abs(coalesce(d.total_weight_kg, 0) - v_kg) <= greatest(0.5, v_kg * 0.005)
      order by d.created_at desc limit 5) z;
  else
    raise exception 'AP: Unknown record type.';
  end if;
  return v_out;
end;
$$;
revoke all on function private.ap3_duplicates(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-058: oldest-first allocation (invoices named in the narration first); the rest stays on account
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap3_allocate(p_company uuid, p_customer uuid, p_amount numeric, p_narration text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_left numeric := round(coalesce(p_amount, 0), 2); v_rows jsonb := '[]'::jsonb; inv record; a numeric; v_named integer := 0; v_open numeric := 0; v_text text := private.ap3_compact(p_narration);
begin
  for inv in select i.id, i.invoice_number, i.invoice_date, i.due_date, i.balance_due,
        (length(private.ap3_compact(i.invoice_number)) >= 6 and position(private.ap3_compact(i.invoice_number) in v_text) > 0) named
      from public.invoices i where i.company_id = p_company and i.customer_id = p_customer and i.deleted_at is null and i.balance_due > 0
        and i.status = any(private.ap3_open_invoice_statuses())
      order by 6 desc, coalesce(i.due_date, i.invoice_date), i.invoice_date, i.invoice_number, i.id loop
    v_open := v_open + inv.balance_due;
    if inv.named then v_named := v_named + 1; end if;
    continue when v_left <= 0;
    a := least(v_left, inv.balance_due);
    v_rows := v_rows || jsonb_build_object('invoice_id', inv.id, 'invoice_number', inv.invoice_number, 'invoice_date', inv.invoice_date, 'due_date', inv.due_date,
      'balance_due', inv.balance_due, 'amount', a, 'basis', case when inv.named then 'named' else 'oldest' end);
    v_left := round(v_left - a, 2);
  end loop;
  return jsonb_build_object('allocations', v_rows, 'on_account', greatest(v_left, 0), 'open_total', round(v_open, 2), 'named', v_named,
    'allocated', round(coalesce(p_amount, 0) - greatest(v_left, 0), 2));
end;
$$;
revoke all on function private.ap3_allocate(uuid, uuid, numeric, text) from public, anon, authenticated;

-- Posts a reviewed receipt for one customer: the allocated part through the canonical receipt transaction, the rest as
-- on-account money. Idempotent by key. The proposed and final allocations are kept for audit.
create or replace function private.ap3_post_receipt(p_company uuid, p_actor uuid, p_role text, p_customer uuid, p_receipt jsonb, p_allocations jsonb, p_on_account numeric,
  p_key uuid, p_source text, p_bank_line uuid, p_proposed jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_amount numeric; v_total numeric := 0; v_oa numeric := round(coalesce(p_on_account, 0), 2); v_fp text; prev public.receipt_allocation_audits%rowtype; v_result jsonb;
  v_receipt jsonb; v_credit uuid; v_method text; v_ref text; v_date date; v_final jsonb; it jsonb;
begin
  if not (p_role = any(private.ap3_accounts_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if p_key is null then raise exception 'AP: A receipt key is required.'; end if;
  if not exists (select 1 from public.customers c where c.id = p_customer and c.company_id = p_company) then raise exception 'AP: Choose a customer of this company.'; end if;
  v_amount := private.ap2_num(p_receipt, 'amount', 'Amount', 0.01, 999999999999.99);
  if v_amount <> round(v_amount, 2) then raise exception 'AP: Amount can have at most two decimals.'; end if;
  v_method := p_receipt ->> 'payment_method';
  if v_method is null or v_method not in ('bank_transfer', 'upi', 'cheque', 'cash', 'other') then raise exception 'AP: Choose how the money was received.'; end if;
  v_ref := nullif(btrim(coalesce(p_receipt ->> 'reference_number', '')), '');
  if v_method in ('bank_transfer', 'upi', 'cheque') and v_ref is null then raise exception 'AP: Enter the UTR or cheque reference.'; end if;
  if v_ref is not null and length(v_ref) > 80 then raise exception 'AP: Reference must be at most 80 characters.'; end if;
  begin v_date := (p_receipt ->> 'payment_date')::date; exception when others then v_date := null; end;
  if v_date is null or v_date > private.ist_today() then raise exception 'AP: Enter the date the money was received (not in the future).'; end if;
  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) > 100 then raise exception 'AP: Invalid allocations.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('invoice_id', (x ->> 'invoice_id')::uuid, 'amount', round((x ->> 'amount')::numeric, 2)) order by (x ->> 'invoice_id')), '[]'::jsonb)
    into v_final from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) x where coalesce((x ->> 'amount')::numeric, 0) > 0;
  for it in select value from jsonb_array_elements(v_final) loop
    if not exists (select 1 from public.invoices i where i.id = (it ->> 'invoice_id')::uuid and i.company_id = p_company and i.customer_id = p_customer) then
      raise exception 'AP: Every allocated invoice must belong to this customer.';
    end if;
    v_total := v_total + (it ->> 'amount')::numeric;
  end loop;
  if v_oa < 0 or round(v_total + v_oa, 2) <> v_amount then raise exception 'AP: Allocations (INR %) and on-account (INR %) must add up to the amount received (INR %).', private.ap3_inr(v_total), private.ap3_inr(v_oa), private.ap3_inr(v_amount); end if;
  v_fp := md5(jsonb_build_object('customer', p_customer, 'amount', v_amount, 'method', v_method, 'ref', v_ref, 'date', v_date, 'alloc', v_final, 'oa', v_oa, 'line', p_bank_line,
    'notes', nullif(btrim(coalesce(p_receipt ->> 'notes', '')), ''))::text);
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':ap3-receipt:' || p_key::text, 0));
  select * into prev from public.receipt_allocation_audits where company_id = p_company and idempotency_key = p_key;
  if prev.id is not null then
    if prev.request_fingerprint <> v_fp then raise exception 'AP: This receipt was already recorded with different details.'; end if;
    return prev.result || jsonb_build_object('replayed', true);
  end if;
  if v_oa > 0 and v_ref is not null and (exists (select 1 from public.customer_on_account_credits c where c.company_id = p_company and c.status <> 'reversed'
      and c.payment_method = v_method and c.received_on = v_date and lower(btrim(coalesce(c.reference, ''))) = lower(v_ref))
    or (v_total = 0 and exists (select 1 from public.financial_receipt_events e where e.company_id = p_company and e.payment_method = v_method and e.payment_date = v_date
      and lower(btrim(coalesce(e.reference_number, ''))) = lower(v_ref)))) then
    raise exception 'AP: This reference is already recorded for this date and method.';
  end if;
  if v_total > 0 then
    v_receipt := jsonb_build_object('amount', v_total, 'payment_date', v_date, 'payment_method', v_method, 'reference_number', v_ref,
      'notes', left(concat_ws(' · ', nullif(btrim(coalesce(p_receipt ->> 'notes', '')), ''), case when v_oa > 0 then 'INR ' || private.ap3_inr(v_oa) || ' of INR ' || private.ap3_inr(v_amount) || ' kept on account' end), 2000));
    v_result := private.post_financial_receipt_atomic(v_receipt, v_final, p_key);
  end if;
  if v_oa > 0 then
    insert into public.customer_on_account_credits(company_id, customer_id, source, bank_line_id, payment_method, reference, received_on, amount, note, created_by)
      values (p_company, p_customer, case when p_source = 'bank_line' then 'bank_line' else 'receipt' end, p_bank_line, v_method, v_ref, v_date, v_oa,
        left(nullif(btrim(coalesce(p_receipt ->> 'notes', '')), ''), 300), p_actor)
      returning id into v_credit;
  end if;
  v_result := jsonb_build_object('receipt_id', v_result ->> 'receipt_id', 'allocated', v_total, 'on_account', v_oa, 'on_account_credit_id', v_credit,
    'allocations', coalesce(v_result -> 'allocations', '[]'::jsonb));
  insert into public.receipt_allocation_audits(company_id, customer_id, receipt_event_id, on_account_credit_id, source, idempotency_key, request_fingerprint, result, proposed, final, changed, actor_id)
    values (p_company, p_customer, (v_result ->> 'receipt_id')::uuid, v_credit, p_source, p_key, v_fp, v_result, coalesce(p_proposed, '{}'::jsonb),
      jsonb_build_object('allocations', v_final, 'on_account', v_oa),
      coalesce((select jsonb_agg(jsonb_build_object('invoice_id', (x ->> 'invoice_id')::uuid, 'amount', round((x ->> 'amount')::numeric, 2)) order by (x ->> 'invoice_id'))
        from jsonb_array_elements(coalesce(p_proposed -> 'allocations', '[]'::jsonb)) x where coalesce((x ->> 'amount')::numeric, 0) > 0), '[]'::jsonb) <> v_final
        or round(coalesce((p_proposed ->> 'on_account')::numeric, 0), 2) <> v_oa, p_actor);
  return v_result || jsonb_build_object('replayed', false);
end;
$$;
revoke all on function private.ap3_post_receipt(uuid, uuid, text, uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb) from public, anon, authenticated;

-- Applies on-account money to invoices (oldest first unless the person chose). Posted as a receipt dated today with the
-- original reference and an /OA suffix, so the original bank reference stays unique.
create or replace function private.ap3_apply_on_account(p_company uuid, p_actor uuid, p_role text, p_credit uuid, p_allocations jsonb, p_key uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c public.customer_on_account_credits%rowtype; v_avail numeric; v_alloc jsonb; v_total numeric := 0; v_n integer; v_res jsonb; it jsonb; v_prop jsonb;
begin
  if not (p_role = any(private.ap3_accounts_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
  select * into c from public.customer_on_account_credits where id = p_credit and company_id = p_company for update;
  if c.id is null or c.status <> 'open' then raise exception 'AP: This on-account money is not available.'; end if;
  v_avail := c.amount - c.applied_amount;
  v_prop := private.ap3_allocate(p_company, c.customer_id, v_avail, c.reference);
  v_alloc := coalesce(p_allocations, (select coalesce(jsonb_agg(jsonb_build_object('invoice_id', x ->> 'invoice_id', 'amount', x ->> 'amount')), '[]'::jsonb) from jsonb_array_elements(v_prop -> 'allocations') x));
  if jsonb_typeof(v_alloc) <> 'array' or jsonb_array_length(v_alloc) > 100 then raise exception 'AP: Invalid allocations.'; end if;
  for it in select value from jsonb_array_elements(v_alloc) loop
    if not exists (select 1 from public.invoices i where i.id = (it ->> 'invoice_id')::uuid and i.company_id = p_company and i.customer_id = c.customer_id) then
      raise exception 'AP: Every allocated invoice must belong to this customer.';
    end if;
    v_total := v_total + round((it ->> 'amount')::numeric, 2);
  end loop;
  if v_total <= 0 then raise exception 'AP: The customer has no open invoice to apply this money to.'; end if;
  if v_total > v_avail then raise exception 'AP: Only INR % is available on account.', private.ap3_inr(v_avail); end if;
  select count(*) + 1 into v_n from public.customer_on_account_applications a where a.credit_id = c.id;
  v_res := private.post_financial_receipt_atomic(jsonb_build_object('amount', v_total, 'payment_date', private.ist_today(), 'payment_method', c.payment_method,
      'reference_number', left(coalesce(c.reference, 'OA-' || left(c.id::text, 8)), 70) || '/OA' || v_n,
      'notes', 'On-account money received ' || to_char(c.received_on, 'DD Mon YYYY') || ' applied'),
    (select jsonb_agg(jsonb_build_object('invoice_id', x ->> 'invoice_id', 'amount', round((x ->> 'amount')::numeric, 2))) from jsonb_array_elements(v_alloc) x where (x ->> 'amount')::numeric > 0),
    p_key);
  if not coalesce((v_res ->> 'idempotent_replay')::boolean, false) then
    insert into public.customer_on_account_applications(company_id, credit_id, invoice_id, receipt_event_id, amount, applied_by)
      select p_company, c.id, (x ->> 'invoice_id')::uuid, (v_res ->> 'receipt_id')::uuid, round((x ->> 'amount')::numeric, 2), p_actor
      from jsonb_array_elements(v_alloc) x where (x ->> 'amount')::numeric > 0;
    update public.customer_on_account_credits set applied_amount = applied_amount + v_total,
      status = case when applied_amount + v_total >= amount then 'applied' else 'open' end where id = c.id;
  end if;
  return jsonb_build_object('receipt_id', v_res ->> 'receipt_id', 'applied', v_total, 'remaining', v_avail - v_total);
end;
$$;
revoke all on function private.ap3_apply_on_account(uuid, uuid, text, uuid, jsonb, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-024: bank statement lines matched to customers and open invoices
-- ---------------------------------------------------------------------------------------------------------------
-- The remitter part of a narration: transfer words, references, IFSC codes and long numbers removed. Mirrored by
-- remitterFromNarration in lib/financials/bank-statement.ts (a test compares them).
create or replace function private.ap3_remitter(p_narration text)
returns text language sql immutable set search_path = public, private as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(private.ap3_norm(p_narration),
    '\m[A-Z]{4}0[A-Z0-9]{6}\M', ' ', 'g'),
    '\m[A-Z]*[0-9][A-Z0-9]*\M', ' ', 'g'),
    '\m(NEFT|RTGS|IMPS|UPI|INB|INF|NETBANKING|MOB|MB|BY|TRANSFER|TRF|FROM|TO|CR|DR|CREDIT|DEBIT|DEP|DEPOSIT|CLG|CHQ|CHEQUE|FT|BIL|ONL|IFT|ACH|NACH|P2A|P2M|PAYMENT|PMT|REF|UTR|NO|A|C|AC|OF|THE|IN|FOR|BANK|LTD|LIMITED|PVT|PRIVATE)\M', ' ', 'g'),
    '\s+', ' ', 'g')), 60), '')
$$;
revoke all on function private.ap3_remitter(text) from public, anon, authenticated;

create or replace function private.ap3_bank_line_reference(l public.bank_statement_lines)
returns text language sql immutable set search_path = public, private as $$
  select left(coalesce(nullif(btrim(l.reference), ''), substring(private.ap3_norm(l.narration) from '\m([A-Z0-9]*[0-9]{8,}[A-Z0-9]*)\M'), 'BANK-' || to_char(l.txn_date, 'YYYYMMDD') || '-' || l.line_no), 80)
$$;
revoke all on function private.ap3_bank_line_reference(public.bank_statement_lines) from public, anon, authenticated;

-- Classifies one credit line and prepares (or refreshes) its receipt proposal:
--   exact  - customer from a learned remitter, a named invoice or a person's assignment, and the amount fits the open invoices;
--   likely - customer from the name in the narration or from a unique matching balance;
--   unknown - no customer; a person assigns it once and the remitter is learned.
create or replace function private.ap3_bank_match_line(p_company uuid, p_line uuid, p_run uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare
  l public.bank_statement_lines%rowtype; v_norm text; v_compact text; v_rem text; v_customer uuid; v_signals text[] := '{}'; v_n integer; v_class text; v_alloc jsonb;
  v_name text; v_id uuid; v_reason text;
begin
  select * into l from public.bank_statement_lines where id = p_line and company_id = p_company for update;
  if l.id is null or l.direction <> 'credit' or l.state in ('receipted', 'ignored') then return null; end if;
  v_norm := private.ap3_norm(l.narration); v_compact := private.ap3_compact(l.narration); v_rem := coalesce(l.remitter, private.ap3_remitter(l.narration));
  if l.customer_id is not null and l.assigned_by is not null then
    v_customer := l.customer_id; v_signals := array['assigned'];
  end if;
  if v_customer is null then
    select count(distinct a.customer_id), min(a.customer_id::text)::uuid into v_n, v_customer from public.customer_remitter_aliases a
      where a.company_id = p_company and a.active and (position(' ' || a.alias || ' ' in ' ' || v_norm || ' ') > 0 or (v_rem is not null and a.alias = v_rem));
    if v_n = 1 then v_signals := array['learned_remitter']; else v_customer := null; end if;
  end if;
  if v_customer is null then
    select count(distinct i.customer_id), min(i.customer_id::text)::uuid into v_n, v_customer from public.invoices i
      where i.company_id = p_company and i.deleted_at is null and i.balance_due > 0 and i.status = any(private.ap3_open_invoice_statuses())
        and length(private.ap3_compact(i.invoice_number)) >= 6 and position(private.ap3_compact(i.invoice_number) in v_compact) > 0;
    if v_n = 1 then v_signals := array['invoice_named']; else v_customer := null; end if;
  end if;
  if v_customer is null then
    select count(*), min(c.id::text)::uuid into v_n, v_customer from public.customers c
      where c.company_id = p_company and coalesce(c.is_active, true) and c.deleted_at is null
        and length(private.ap3_norm(coalesce(nullif(btrim(c.company_name), ''), c.customer_name))) >= 5
        and position(' ' || private.ap3_norm(coalesce(nullif(btrim(c.company_name), ''), c.customer_name)) || ' ' in ' ' || v_norm || ' ') > 0;
    if v_n = 1 then v_signals := array['customer_name']; else v_customer := null; end if;
  end if;
  if v_customer is null then
    select count(distinct i.customer_id), min(i.customer_id::text)::uuid into v_n, v_customer from public.invoices i
      where i.company_id = p_company and i.deleted_at is null and i.status = any(private.ap3_open_invoice_statuses()) and i.balance_due = l.amount;
    if v_n = 1 then v_signals := array['amount_matches_balance']; else v_customer := null; end if;
  end if;
  if v_customer is null then
    update public.bank_statement_lines set state = 'unmatched', match_class = 'unknown', remitter = v_rem,
      match_evidence = jsonb_build_object('signals', '[]'::jsonb, 'remitter', v_rem) where id = l.id;
    update public.proposals set status = 'stale' where company_id = p_company and proposal_type = 'bank.receipt_match' and target_key = l.id::text and status = 'open';
    return 'unknown';
  end if;
  v_alloc := private.ap3_allocate(p_company, v_customer, l.amount, l.narration);
  v_class := case when v_signals[1] in ('assigned', 'learned_remitter', 'invoice_named') and (v_alloc ->> 'on_account')::numeric = 0 then 'exact' else 'likely' end;
  select coalesce(nullif(btrim(c.company_name), ''), c.customer_name) into v_name from public.customers c where c.id = v_customer;
  update public.bank_statement_lines set match_class = v_class, remitter = v_rem, state = 'proposed',
    match_evidence = jsonb_build_object('signals', to_jsonb(v_signals), 'remitter', v_rem, 'customer_id', v_customer, 'customer', v_name) where id = l.id;
  v_reason := case v_signals[1]
    when 'assigned' then 'Assigned to ' || v_name || ' by a person.'
    when 'learned_remitter' then 'The remitter "' || coalesce(v_rem, '') || '" was confirmed earlier as ' || v_name || '.'
    when 'invoice_named' then 'The narration names an open invoice of ' || v_name || '.'
    when 'customer_name' then 'The narration contains the customer name ' || v_name || '. Confirm before accepting.'
    else 'The amount equals one open invoice balance of ' || v_name || '. Confirm before accepting.' end
    || case when (v_alloc ->> 'on_account')::numeric > 0 then ' INR ' || private.ap3_inr((v_alloc ->> 'on_account')::numeric) || ' is more than the open invoices and stays on account.' else '' end;
  v_id := private.ap_proposal_create(p_company, 'bank.receipt_match', l.id::text, 'Receipt INR ' || private.ap3_inr(l.amount) || ' from ' || v_name,
    jsonb_build_object('line_id', l.id, 'customer_id', v_customer, 'customer', v_name, 'amount', l.amount, 'txn_date', l.txn_date, 'reference', private.ap3_bank_line_reference(l),
      'allocations', (select coalesce(jsonb_agg(jsonb_build_object('invoice_id', x ->> 'invoice_id', 'invoice_number', x ->> 'invoice_number', 'amount', (x ->> 'amount')::numeric, 'basis', x ->> 'basis')), '[]'::jsonb)
        from jsonb_array_elements(v_alloc -> 'allocations') x),
      'on_account', (v_alloc ->> 'on_account')::numeric),
    jsonb_build_object('class', v_class, 'signals', to_jsonb(v_signals), 'remitter', v_rem, 'narration', l.narration, 'open_total', v_alloc -> 'open_total', 'named', v_alloc -> 'named'),
    'bank.match_' || v_class, v_reason, case when v_class = 'exact' then 0.95 else 0.6 end, private.ap3_accounts_roles(), 24 * 21, p_run);
  return v_class;
end;
$$;
revoke all on function private.ap3_bank_match_line(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.ap3_learn_remitter(p_company uuid, p_actor uuid, p_customer uuid, p_alias text)
returns text language plpgsql security definer set search_path = public, private as $$
declare v_alias text := nullif(btrim(private.ap3_norm(p_alias)), ''); v_other uuid;
begin
  if v_alias is null or length(v_alias) < 4 then return null; end if;
  select a.customer_id into v_other from public.customer_remitter_aliases a where a.company_id = p_company and a.alias = v_alias and a.active;
  if v_other is not null and v_other <> p_customer then
    raise exception 'AP: The remitter "%" is already learned for another customer. Remove it there first.', v_alias;
  end if;
  if v_other is null then
    insert into public.customer_remitter_aliases(company_id, customer_id, alias, source, created_by) values (p_company, p_customer, v_alias, 'learned', p_actor);
  end if;
  return v_alias;
end;
$$;
revoke all on function private.ap3_learn_remitter(uuid, uuid, uuid, text) from public, anon, authenticated;

-- Accepting a bank match posts the receipt and on-account balance; the line can then never create a second live receipt.
create or replace function private.ap3_apply_bank_match(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare l public.bank_statement_lines%rowtype; v_res jsonb; v_key uuid;
begin
  if not (p_role = any(private.ap3_accounts_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
  select * into l from public.bank_statement_lines where id = p_proposal.target_key::uuid and company_id = p_company for update;
  if l.id is null or l.state <> 'proposed' or l.receipt_event_id is not null or l.on_account_credit_id is not null then
    raise exception 'AP: This bank line is already receipted or no longer waiting.';
  end if;
  v_key := (substr(md5('bank-line:' || l.id::text || ':' || l.reversal_count), 1, 8) || '-' || substr(md5('bank-line:' || l.id::text || ':' || l.reversal_count), 9, 4) || '-4'
    || substr(md5('bank-line:' || l.id::text || ':' || l.reversal_count), 14, 3) || '-8' || substr(md5('bank-line:' || l.id::text || ':' || l.reversal_count), 18, 3) || '-'
    || substr(md5('bank-line:' || l.id::text || ':' || l.reversal_count), 21, 12))::uuid;
  v_res := private.ap3_post_receipt(p_company, p_actor, p_role, (p_payload ->> 'customer_id')::uuid,
    jsonb_build_object('amount', l.amount, 'payment_date', l.txn_date, 'payment_method', 'bank_transfer', 'reference_number', p_payload ->> 'reference',
      'notes', left('Bank statement line ' || l.line_no || ': ' || l.narration, 300)),
    p_payload -> 'allocations', (p_payload ->> 'on_account')::numeric, v_key, 'bank_line', l.id, p_proposal.payload);
  update public.bank_statement_lines set state = 'receipted', customer_id = (p_payload ->> 'customer_id')::uuid, receipt_event_id = (v_res ->> 'receipt_id')::uuid,
    on_account_credit_id = (v_res ->> 'on_account_credit_id')::uuid, accepted_unchanged = (p_payload = p_proposal.payload), receipted_at = clock_timestamp() where id = l.id;
  if l.remitter is not null then
    begin perform private.ap3_learn_remitter(p_company, p_actor, (p_payload ->> 'customer_id')::uuid, l.remitter); exception when others then null; end;
  end if;
  return v_res;
end;
$$;
revoke all on function private.ap3_apply_bank_match(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

-- A rejected, stale or expired bank proposal sends its line back to the unmatched list.
create or replace function private.ap3_on_bank_proposal()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.proposal_type = 'bank.receipt_match' and new.status in ('rejected', 'stale', 'expired') and old.status = 'open' then
    update public.bank_statement_lines set state = 'unmatched' where id = new.target_key::uuid and company_id = new.company_id and state = 'proposed'
      and not exists (select 1 from public.proposals p where p.company_id = new.company_id and p.proposal_type = 'bank.receipt_match' and p.target_key = new.target_key and p.status = 'open' and p.id <> new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.ap3_on_bank_proposal() from public, anon, authenticated;
drop trigger if exists zz_ap3_bank_proposal on public.proposals;
create trigger zz_ap3_bank_proposal after update of status on public.proposals for each row execute function private.ap3_on_bank_proposal();

-- Reversal (with a reason) undoes the receipt's payments and its unused on-account balance, and frees the line.
create or replace function private.ap3_reverse_bank_line(p_company uuid, p_actor uuid, p_role text, p_line uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare l public.bank_statement_lines%rowtype; v_reason text; pay record; c public.customer_on_account_credits%rowtype; v_n integer := 0;
begin
  if not (p_role = any(private.ap3_accounts_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
  v_reason := private.ap_text(p_reason, 'Reason', 10, 300);
  select * into l from public.bank_statement_lines where id = p_line and company_id = p_company for update;
  if l.id is null or l.state <> 'receipted' then raise exception 'AP: Only a receipted line can be reversed.'; end if;
  if l.on_account_credit_id is not null then
    select * into c from public.customer_on_account_credits where id = l.on_account_credit_id for update;
    if c.applied_amount > 0 then raise exception 'AP: Part of this money was already applied from on-account. Reverse that receipt first.'; end if;
  end if;
  for pay in select a.payment_id from public.financial_receipt_allocations a join public.payments p on p.id = a.payment_id
      where a.receipt_event_id = l.receipt_event_id and a.company_id = p_company and p.reversed_at is null loop
    perform private.reverse_payment_atomic(pay.payment_id, v_reason,
      (substr(md5('rev:' || pay.payment_id::text), 1, 8) || '-' || substr(md5('rev:' || pay.payment_id::text), 9, 4) || '-4' || substr(md5('rev:' || pay.payment_id::text), 14, 3)
        || '-8' || substr(md5('rev:' || pay.payment_id::text), 18, 3) || '-' || substr(md5('rev:' || pay.payment_id::text), 21, 12))::uuid);
    v_n := v_n + 1;
  end loop;
  if c.id is not null then update public.customer_on_account_credits set status = 'reversed', reversed_at = clock_timestamp(), reversal_reason = v_reason where id = c.id; end if;
  update public.bank_statement_lines set state = 'unmatched', receipt_event_id = null, on_account_credit_id = null, accepted_unchanged = null, receipted_at = null,
    reversal_count = reversal_count + 1, last_reversal_reason = v_reason where id = l.id;
  return jsonb_build_object('line_id', l.id, 'payments_reversed', v_n, 'on_account_reversed', c.id is not null);
end;
$$;
revoke all on function private.ap3_reverse_bank_line(uuid, uuid, text, uuid, text) from public, anon, authenticated;

create or replace function private.ap3_bank_import(p_company uuid, p_actor uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_stmt uuid; v_fp text := p ->> 'file_fingerprint'; v_profile uuid; r jsonb; v_date date; v_credit numeric; v_debit numeric; v_dir text; v_amount numeric; v_line uuid;
  v_new integer := 0; v_dup integer := 0; v_credits integer := 0; v_errors jsonb := '[]'::jsonb; v_no integer; v_narr text; v_ref text; v_class text;
  v_exact integer := 0; v_likely integer := 0; v_unknown integer := 0; v_min date; v_max date; v_existing uuid;
begin
  if coalesce(v_fp, '') !~ '^[0-9a-f]{32,64}$' then raise exception 'AP: The file fingerprint is missing.'; end if;
  if jsonb_typeof(p -> 'rows') <> 'array' or jsonb_array_length(p -> 'rows') not between 1 and 3000 then raise exception 'AP: A statement must have 1 to 3,000 rows.'; end if;
  select id into v_existing from public.bank_statements where company_id = p_company and file_fingerprint = v_fp;
  if v_existing is not null then return jsonb_build_object('statement_id', v_existing, 'already_imported', true); end if;
  if p ? 'profile' and jsonb_typeof(p -> 'profile') = 'object' then
    insert into public.bank_format_profiles(company_id, name, header_signature, mapping, date_format, created_by)
      values (p_company, private.ap_text(p -> 'profile' ->> 'name', 'Format name', 3, 80), p -> 'profile' ->> 'header_signature', p -> 'profile' -> 'mapping',
        p -> 'profile' ->> 'date_format', p_actor)
      on conflict (company_id, header_signature) do update set name = excluded.name, mapping = excluded.mapping, date_format = excluded.date_format, updated_at = clock_timestamp()
      returning id into v_profile;
  end if;
  insert into public.bank_statements(company_id, profile_id, source_name, file_fingerprint, account_label, imported_by)
    values (p_company, v_profile, private.ap_text(p ->> 'source_name', 'File name', 1, 200), v_fp, nullif(left(btrim(coalesce(p ->> 'account_label', '')), 80), ''), p_actor)
    returning id into v_stmt;
  for r in select value from jsonb_array_elements(p -> 'rows') loop
    v_no := coalesce((r ->> 'line_no')::integer, 0);
    begin
      v_date := (r ->> 'txn_date')::date;
      v_credit := nullif(r ->> 'credit', '')::numeric; v_debit := nullif(r ->> 'debit', '')::numeric;
    exception when others then
      v_errors := v_errors || jsonb_build_object('line_no', v_no, 'error', 'Unreadable date or amount'); continue;
    end;
    v_narr := left(btrim(coalesce(r ->> 'narration', '')), 500); v_ref := nullif(left(btrim(coalesce(r ->> 'reference', '')), 80), '');
    if v_date is null or v_date < date '2000-01-01' or v_date > private.ist_today() + 1 then v_errors := v_errors || jsonb_build_object('line_no', v_no, 'error', 'Date is missing or out of range'); continue; end if;
    if (coalesce(v_credit, 0) > 0) = (coalesce(v_debit, 0) > 0) then v_errors := v_errors || jsonb_build_object('line_no', v_no, 'error', 'Needs exactly one of credit or debit'); continue; end if;
    if v_narr = '' then v_errors := v_errors || jsonb_build_object('line_no', v_no, 'error', 'Narration is empty'); continue; end if;
    v_dir := case when coalesce(v_credit, 0) > 0 then 'credit' else 'debit' end;
    v_amount := round(case when v_dir = 'credit' then v_credit else v_debit end, 2);
    if v_amount > 999999999999.99 then v_errors := v_errors || jsonb_build_object('line_no', v_no, 'error', 'Amount is too large'); continue; end if;
    v_line := null;
    insert into public.bank_statement_lines(company_id, statement_id, line_no, txn_date, narration, reference, direction, amount, dedupe_key, remitter, state, ignored_reason)
      values (p_company, v_stmt, greatest(v_no, 1), v_date, v_narr, v_ref, v_dir, v_amount,
        md5(v_date::text || '|' || v_dir || '|' || v_amount::text || '|' || lower(coalesce(v_ref, private.ap3_norm(v_narr)))), private.ap3_remitter(v_narr),
        case when v_dir = 'debit' then 'ignored' else 'unmatched' end, case when v_dir = 'debit' then 'Debit: money paid out, not a customer receipt' end)
      on conflict (company_id, dedupe_key) do nothing returning id into v_line;
    if v_line is null then v_dup := v_dup + 1; continue; end if;
    v_new := v_new + 1;
    v_min := least(coalesce(v_min, v_date), v_date); v_max := greatest(coalesce(v_max, v_date), v_date);
    if v_dir = 'credit' then
      v_credits := v_credits + 1;
      v_class := private.ap3_bank_match_line(p_company, v_line, null);
      if v_class = 'exact' then v_exact := v_exact + 1; elsif v_class = 'likely' then v_likely := v_likely + 1; else v_unknown := v_unknown + 1; end if;
    end if;
  end loop;
  update public.bank_statements set line_count = jsonb_array_length(p -> 'rows'), new_lines = v_new, duplicate_lines = v_dup, credit_lines = v_credits,
    period_from = v_min, period_to = v_max where id = v_stmt;
  return jsonb_build_object('statement_id', v_stmt, 'already_imported', false, 'rows', jsonb_array_length(p -> 'rows'), 'new_lines', v_new, 'duplicates', v_dup,
    'credits', v_credits, 'exact', v_exact, 'likely', v_likely, 'unknown', v_unknown, 'errors', v_errors);
end;
$$;
revoke all on function private.ap3_bank_import(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-084: the morning reminder queue (prepared; a person sends or skips)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap3_reminder_message(p_company uuid, p_customer uuid, p_invoices jsonb, p_total numeric)
returns text language plpgsql stable security definer set search_path = public, private as $$
declare v_co text; v_cust text; v_sig text; v_lines text := ''; it jsonb; v_days integer;
begin
  select coalesce(nullif(btrim(c.legal_name), ''), c.name) into v_co from public.companies c where c.id = p_company;
  select coalesce(nullif(btrim(x.contact_person), ''), nullif(btrim(x.company_name), ''), x.customer_name) into v_cust from public.customers x where x.id = p_customer;
  select nullif(btrim(s.default_whatsapp_signature), '') into v_sig from public.company_settings s where s.company_id = p_company;
  for it in select value from jsonb_array_elements(p_invoices) loop
    v_days := (it ->> 'days')::integer;
    v_lines := v_lines || E'\n• ' || coalesce(it ->> 'invoice_number', 'Invoice') || ' dated ' || to_char((it ->> 'invoice_date')::date, 'DD Mon YYYY')
      || ': Rs ' || private.ap3_inr((it ->> 'balance')::numeric) || ', ' || case when v_days > 0 then 'due ' || to_char((it ->> 'due_date')::date, 'DD Mon') || ' (' || v_days || ' days overdue)'
        when v_days = 0 then 'due today' else 'due on ' || to_char((it ->> 'due_date')::date, 'DD Mon YYYY') end;
  end loop;
  return 'Dear ' || coalesce(v_cust, 'Sir/Madam') || ',' || E'\n' || 'This is a gentle reminder from ' || coalesce(v_co, 'us') || ' about the following invoice(s):' || v_lines
    || E'\n' || 'Total: Rs ' || private.ap3_inr(p_total) || E'\n' || 'Please arrange the payment. If you have already paid, kindly share the UTR or cheque details so we can update our records.'
    || E'\n' || coalesce(v_sig, 'Thank you,' || E'\n' || coalesce(v_co, ''));
end;
$$;
revoke all on function private.ap3_reminder_message(uuid, uuid, jsonb, numeric) from public, anon, authenticated;

create or replace function private.ap3_prepare_reminders(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare s public.o2c_settings%rowtype := private.ap3_settings(p_company); v_today date := private.ist_today(); c record; v_inv jsonb; v_total numeric; v_worst integer;
  v_n integer := 0; v_seen integer := 0; v_skipped integer := 0; v_ahead integer;
begin
  select greatest(-min(x), 0) into v_ahead from unnest(s.reminder_steps) x;
  for c in select distinct i.customer_id from public.invoices i where i.company_id = p_company and i.deleted_at is null and i.balance_due > 0 and i.due_date is not null
      and i.status = any(private.ap3_open_invoice_statuses()) and i.opening_cutover_id is null and i.due_date - v_today <= v_ahead loop
    v_seen := v_seen + 1;
    continue when exists (select 1 from public.payment_reminders r where r.company_id = p_company and r.customer_id = c.customer_id and r.reminder_date = v_today);
    select coalesce(jsonb_agg(jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date, 'due_date', i.due_date,
        'balance', i.balance_due, 'days', v_today - i.due_date) order by i.due_date, i.invoice_number), '[]'::jsonb), coalesce(sum(i.balance_due), 0), coalesce(max(v_today - i.due_date), 0)
      into v_inv, v_total, v_worst
      from public.invoices i where i.company_id = p_company and i.customer_id = c.customer_id and i.deleted_at is null and i.balance_due > 0 and i.due_date is not null
        and i.status = any(private.ap3_open_invoice_statuses()) and i.opening_cutover_id is null
        and ((v_today - i.due_date) = any(s.reminder_steps)
          or ((v_today - i.due_date) > 0 and not exists (select 1 from public.payment_reminders r where r.company_id = p_company and r.customer_id = c.customer_id
            and r.status = 'sent' and r.sent_at >= now() - make_interval(days => s.reminder_repeat_days) and r.invoices @> jsonb_build_array(jsonb_build_object('invoice_id', i.id)))))
        and not exists (select 1 from public.collection_promises cp where cp.company_id = p_company and cp.invoice_id = i.id and cp.withdrawn_at is null and cp.due_date >= v_today);
    if jsonb_array_length(v_inv) = 0 then v_skipped := v_skipped + 1; continue; end if;
    update public.payment_reminders set status = 'superseded' where company_id = p_company and customer_id = c.customer_id and status = 'prepared' and reminder_date < v_today;
    insert into public.payment_reminders(company_id, customer_id, reminder_date, invoices, total_due, worst_days, message, phone, job_run_id)
      values (p_company, c.customer_id, v_today, v_inv, v_total, v_worst, private.ap3_reminder_message(p_company, c.customer_id, v_inv, v_total),
        (select coalesce(nullif(btrim(x.whatsapp_number), ''), nullif(btrim(x.phone), '')) from public.customers x where x.id = c.customer_id), p_run)
      on conflict (company_id, customer_id, reminder_date) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return jsonb_build_object('examined', v_seen, 'prepared', v_n, 'skipped_with_commitment', v_skipped);
end;
$$;
revoke all on function private.ap3_prepare_reminders(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-098: re-evaluate condition-based alerts and tasks; close those whose condition cleared
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap3_notification_open(n public.notifications)
returns boolean language plpgsql stable security definer set search_path = public, private as $$
declare k text := coalesce(n.condition_key, n.entity_reference, '');
begin
  if k like 'credit-hold:%' then
    return exists (select 1 from public.order_credit_holds h where h.company_id = n.company_id and h.order_id = substr(k, 13)::uuid and h.status = 'held');
  elsif k like 'quote-expired:%' then
    return exists (select 1 from public.quotes q where q.id = substr(k, 15)::uuid and q.company_id = n.company_id and q.status = 'expired' and q.deleted_at is null);
  elsif k like 'quote-extension:%' then
    return exists (select 1 from public.quote_validity_requests r where r.id = substr(k, 17)::uuid and r.status = 'pending');
  elsif k like 'calendar-check:%' then
    return not exists (select 1 from public.factory_calendar_exceptions e where e.company_id = n.company_id and e.removed_at is null and e.kind in ('holiday', 'shutdown')
      and e.date_to >= private.ist_today() and e.date_from <= private.ist_today() + 120);
  elsif k like 'idle-unexplained:%' then
    return exists (select 1 from public.press_idle_intervals i where i.company_id = n.company_id and i.reason is null and i.gap_start > now() - interval '50 hours');
  elsif k like 'job-failing:%' then
    return not exists (select 1 from public.system_job_runs s where s.company_id = n.company_id and s.job_key = substr(k, 13) and s.status = 'succeeded' and s.finished_at > n.created_at);
  elsif n.notification_type = 'task_trigger_unassigned' and n.related_entity_type = 'task' then
    return exists (select 1 from public.tasks t where t.id = n.related_entity_id and t.company_id = n.company_id and t.status in ('open', 'in_progress') and t.assigned_to is null);
  elsif n.notification_type = 'exception_request' and n.related_entity_id is not null then
    return exists (select 1 from public.exception_requests r where r.company_id = n.company_id and r.entity_id = n.related_entity_id and r.status = 'pending');
  end if;
  return null;
end;
$$;
revoke all on function private.ap3_notification_open(public.notifications) from public, anon, authenticated;

create or replace function private.ap3_reevaluate(p_company uuid, p_entity uuid, p_source text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare t record; n public.notifications%rowtype; h record; v_closed integer := 0; v_flagged integer := 0; v_notes integer := 0; v_holds integer := 0; e jsonb;
begin
  for t in select x.id, x.trigger_source_type, x.trigger_source_id, x.trigger_key from public.tasks x
      where x.company_id = p_company and x.trigger_key is not null and x.status in ('open', 'in_progress') and x.resolved_by_system_at is null
        and (p_entity is null or x.trigger_source_id = p_entity) loop
    continue when private.task_trigger_source_open(p_company, t.trigger_source_type, t.trigger_source_id);
    begin
      update public.tasks set status = 'completed', completed_at = coalesce(completed_at, now()), resolved_by_system_at = clock_timestamp(),
        system_resolution = 'Resolved by system: condition cleared' where id = t.id;
      insert into public.alert_resolutions(company_id, source_kind, source_id, condition_key, outcome, note, trigger_source)
        values (p_company, 'task', t.id, t.trigger_key, 'closed', 'Resolved by system: condition cleared', p_source) on conflict do nothing;
      v_closed := v_closed + 1;
    exception when others then
      update public.tasks set resolved_by_system_at = clock_timestamp(), system_resolution = 'Condition cleared: close this task once its checklist is complete' where id = t.id;
      insert into public.alert_resolutions(company_id, source_kind, source_id, condition_key, outcome, note, trigger_source)
        values (p_company, 'task', t.id, t.trigger_key, 'flagged', 'Condition cleared; task kept open for its completion checklist', p_source) on conflict do nothing;
      v_flagged := v_flagged + 1;
    end;
  end loop;
  for n in select * from public.notifications x where x.company_id = p_company and x.resolved_at is null
      and (p_entity is null or x.related_entity_id = p_entity or x.condition_key like '%' || p_entity::text) loop
    continue when coalesce(private.ap3_notification_open(n), true);
    update public.notifications set resolved_at = clock_timestamp(), resolution = 'Resolved by system: condition cleared', is_read = true, read_at = coalesce(read_at, now()) where id = n.id;
    insert into public.alert_resolutions(company_id, source_kind, source_id, condition_key, outcome, note, trigger_source)
      values (p_company, 'notification', n.id, coalesce(n.condition_key, n.entity_reference, n.notification_type), 'closed', 'Resolved by system: condition cleared', p_source) on conflict do nothing;
    v_notes := v_notes + 1;
  end loop;
  -- Undecided holds are rechecked (a payment may have brought the customer within limit); approvals are rechecked at dispatch.
  for h in select x.order_id from public.order_credit_holds x where x.company_id = p_company and x.status = 'held'
      and (p_entity is null or x.order_id = p_entity or x.customer_id = p_entity) loop
    e := private.ap3_credit_check_order(p_company, h.order_id, 'recheck', null);
    if e ->> 'outcome' in ('passed', 'not_checked') then v_holds := v_holds + 1; end if;
  end loop;
  return jsonb_build_object('tasks_closed', v_closed, 'tasks_flagged', v_flagged, 'notifications_resolved', v_notes, 'holds_cleared', v_holds);
end;
$$;
revoke all on function private.ap3_reevaluate(uuid, uuid, text) from public, anon, authenticated;

-- Event-driven re-evaluation. A failure here never blocks the business change; the hourly job retries.
create or replace function private.ap3_on_condition_event()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  begin
    perform private.ap3_reevaluate(new.company_id, new.id, 'event');
    if tg_table_name = 'invoices' and new.customer_id is not null then perform private.ap3_reevaluate(new.company_id, new.customer_id, 'event'); end if;
  exception when others then null;
  end;
  return null;
end;
$$;
revoke all on function private.ap3_on_condition_event() from public, anon, authenticated;
drop trigger if exists zz_ap3_condition_invoices on public.invoices;
create trigger zz_ap3_condition_invoices after update of status, balance_due, amount_paid on public.invoices for each row execute function private.ap3_on_condition_event();
drop trigger if exists zz_ap3_condition_orders on public.orders;
create trigger zz_ap3_condition_orders after update of current_stage on public.orders for each row execute function private.ap3_on_condition_event();
drop trigger if exists zz_ap3_condition_quotes on public.quotes;
create trigger zz_ap3_condition_quotes after update of status, valid_until on public.quotes for each row execute function private.ap3_on_condition_event();

-- ---------------------------------------------------------------------------------------------------------------
-- Batch 2 extension points kept verbatim under ap2_* names (the public names now dispatch batch 3 types first).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap2_proposal_apply(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_day date; v_start timestamptz; v_end timestamptz; v_block uuid; pl public.pm_plans%rowtype; v_id uuid; v_k jsonb;
begin
  if p_proposal.proposal_type = 'production.expected_output' then
    return private.ap2_apply_expected(p_company, p_actor, p_role, p_proposal, p_payload);
  elsif p_proposal.proposal_type = 'die.service_due' then
    if not (p_role = any(private.ap2_supervisor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    if coalesce(p_payload ->> 'scheduled_for', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'AP: Choose the service date.'; end if;
    v_day := (p_payload ->> 'scheduled_for')::date;
    if v_day < private.ist_today() or v_day > private.ist_today() + 60 then raise exception 'AP: Choose a service date within the next 60 days.'; end if;
    insert into public.die_service_bookings(company_id, die_id, service_event, scheduled_for, proposal_id, booked_by)
      values (p_company, split_part(p_proposal.target_key, ':', 1)::uuid, split_part(p_proposal.target_key, ':', 2), v_day, p_proposal.id, p_actor) returning id into v_id;
    return jsonb_build_object('booking_id', v_id, 'scheduled_for', v_day);
  elsif p_proposal.proposal_type = 'maintenance.pm_due' then
    if not (p_role = any(private.ap2_floor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    select * into pl from public.pm_plans where id = p_proposal.target_key::uuid and company_id = p_company and status = 'active' for update;
    if pl.id is null then raise exception 'AP: This maintenance plan is no longer active.'; end if;
    begin
      v_start := (p_payload ->> 'window_start')::timestamptz; v_end := (p_payload ->> 'window_end')::timestamptz;
    exception when others then raise exception 'AP: Enter the maintenance window.';
    end;
    if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > interval '72 hours' then raise exception 'AP: The window must end after it starts and last at most 72 hours.'; end if;
    if v_start < now() - interval '1 hour' or v_start > now() + interval '30 days' then raise exception 'AP: Start the window within the next 30 days.'; end if;
    if (p_payload -> 'window_start') = (p_proposal.payload -> 'window_start') and (p_payload -> 'window_end') = (p_proposal.payload -> 'window_end')
      and nullif(p_proposal.payload ->> 'block_id', '') is not null then
      select b.id into v_block from public.factory_maintenance_blocks b where b.id = (p_proposal.payload ->> 'block_id')::uuid and b.company_id = p_company and b.machine_id = pl.machine_id and b.status = 'planned';
    end if;
    if v_block is null then
      insert into public.factory_maintenance_blocks(company_id, machine_id, starts_at, ends_at, reason, status, created_by)
        values (p_company, pl.machine_id, v_start, v_end, left('Preventive maintenance: ' || pl.task, 240), 'planned', p_actor) returning id into v_block;
    end if;
    v_k := private.ap2_pm_counter(pl);
    insert into public.pm_work_orders(company_id, plan_id, proposal_id, maintenance_block_id, window_start, window_end, status, counter_at_schedule, created_by)
      values (p_company, pl.id, p_proposal.id, v_block, v_start, v_end, 'scheduled', (v_k ->> 'value')::numeric, p_actor) returning id into v_id;
    return jsonb_build_object('work_order_id', v_id, 'maintenance_block_id', v_block);
  end if;
  return private.ap1_proposal_apply(p_company, p_actor, p_role, p_proposal, p_payload);
end;
$$;
revoke all on function private.ap2_proposal_apply(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

create or replace function private.ap3_proposal_versions(p_company uuid, p_type text, p_target text)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select case when p_type = 'bank.receipt_match' then (
    select jsonb_build_object('state', l.state, 'receipt', l.receipt_event_id, 'customer', coalesce(l.customer_id::text, l.match_evidence ->> 'customer_id'),
      'open', (select jsonb_agg(jsonb_build_array(i.id, i.balance_due) order by i.id) from public.invoices i where i.company_id = p_company and i.deleted_at is null
        and i.customer_id = coalesce(l.customer_id, (l.match_evidence ->> 'customer_id')::uuid) and i.balance_due > 0 and i.status = any(private.ap3_open_invoice_statuses())))
    from public.bank_statement_lines l where l.id = p_target::uuid and l.company_id = p_company) end
$$;
revoke all on function private.ap3_proposal_versions(uuid, text, text) from public, anon, authenticated;

create or replace function private.ap_proposal_versions(p_company uuid, p_type text, p_target text)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select case when p_type = 'bank.receipt_match' then private.ap3_proposal_versions(p_company, p_type, p_target)
    when p_type in ('production.expected_output', 'die.service_due', 'maintenance.pm_due') then private.ap2_proposal_versions(p_company, p_type, p_target)
    else private.ap1_proposal_versions(p_company, p_type, p_target) end
$$;
revoke all on function private.ap_proposal_versions(uuid, text, text) from public, anon, authenticated;

create or replace function private.ap_proposal_editable(p_type text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_type
    when 'bank.receipt_match' then array[]::text[]
    when 'production.expected_output' then array['reject_pieces', 'reject_kg', 'reject_reason', 'good_pieces', 'good_kg']
    when 'die.service_due' then array['scheduled_for']
    when 'maintenance.pm_due' then array['window_start', 'window_end']
    else private.ap1_proposal_editable(p_type) end
$$;
revoke all on function private.ap_proposal_editable(text) from public, anon, authenticated;

create or replace function private.ap_proposal_apply(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  if p_proposal.proposal_type = 'bank.receipt_match' then
    return private.ap3_apply_bank_match(p_company, p_actor, p_role, p_proposal, p_payload);
  end if;
  return private.ap2_proposal_apply(p_company, p_actor, p_role, p_proposal, p_payload);
end;
$$;
revoke all on function private.ap_proposal_apply(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-001 jobs added by batch 3
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap_job_registry()
returns table(job_key text, schedule text, label text, description text)
language sql immutable set search_path = public, private as $$
  values
    ('proposals.refresh', 'hourly', 'Refresh open proposals', 'Marks proposals stale when their inputs changed and expired when their time passed.'),
    ('navigation.propose', 'nightly', 'Propose role navigation', 'After two weeks of visit counts, proposes the most used destinations for each role.'),
    ('series.propose', 'nightly', 'Propose financial-year numbering', 'Proposes a financial-year number series for each document type that has none.'),
    ('calendar.check', 'nightly', 'Check the factory calendar', 'Alerts the plant head when the coming months have no holidays or shutdowns entered.'),
    ('periods.propose_close', 'morning', 'Propose month close', 'Proposes closing the previous month once the close day is reached.'),
    ('press.idle_reconcile', 'nightly', 'Find unexplained press idle time', 'Records gaps between pushes that nobody explained, as unexplained (never with a guessed reason).'),
    ('dies.predict_service', 'hourly', 'Propose die service', 'Proposes nitriding or correction when a die reaches its approved interval.'),
    ('maintenance.propose_pm', 'hourly', 'Propose preventive maintenance', 'Proposes a maintenance window when a plan nears its running-hours or push interval.'),
    ('quality.sample_windows', 'hourly', 'Mark missed samples', 'Marks required quality samples as missed when their window has passed.'),
    ('quotes.expire', 'nightly', 'Expire stale quotations', 'Marks sent quotations expired when their validity ends, with history; sales can requote or extend.'),
    ('billing.prepare_drafts', 'hourly', 'Prepare invoice drafts', 'Prepares or refreshes an invoice draft for every dispatch that left the gate and is not invoiced.'),
    ('receivables.reminders', 'morning', 'Prepare payment reminders', 'Prepares the day''s reminder messages for invoices due soon or overdue; a person sends or skips each.'),
    ('alerts.reevaluate', 'hourly', 'Close cleared alerts', 'Re-checks condition-based alerts, tasks and credit holds and closes those whose condition cleared.'),
    ('bank.rematch', 'hourly', 'Rematch bank lines', 'Re-runs matching for unmatched bank credits after new invoices or learned remitters.')
$$;
revoke all on function private.ap_job_registry() from public, anon, authenticated;

create or replace function private.ap3_job_execute(p_company uuid, p_job text, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_examined integer := 0; v_proposals integer := 0; v_alerts integer := 0; v_n integer := 0; q record; d record; l record; v jsonb; v_class text;
begin
  if p_job = 'quotes.expire' then
    for q in select x.id, x.quote_number, x.valid_until, x.revision_number, x.created_by from public.quotes x
        where x.company_id = p_company and x.deleted_at is null and x.status = 'sent' and x.valid_until is not null and x.valid_until < private.ist_today() order by x.valid_until, x.id loop
      v_examined := v_examined + 1;
      begin
        update public.quotes set status = 'expired', updated_at = now() where id = q.id and status = 'sent';
        insert into public.quote_validity_events(company_id, quote_id, event, old_valid_until, revision_number, reason)
          values (p_company, q.id, 'expired', q.valid_until, q.revision_number, 'Validity ended; marked expired by the nightly job');
        if q.created_by is not null then
          insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, action_link, condition_key, entity_reference)
            values (p_company, q.created_by, 'quote_expired', 'info', left('Quotation expired: ' || coalesce(q.quote_number, ''), 200),
              'Its validity ended on ' || to_char(q.valid_until, 'DD Mon YYYY') || '. Requote at today''s rate or extend its validity with a reason.',
              'quote', q.id, '/quotes/' || q.id || '#validity', 'quote-expired:' || q.id, 'quote-expired:' || q.id);
          v_alerts := v_alerts + 1;
        end if;
        v_n := v_n + 1;
      exception when others then null;
      end;
    end loop;
    return jsonb_build_object('examined', v_examined, 'proposals', 0, 'alerts', v_alerts, 'details', jsonb_build_object('expired', v_n));
  elsif p_job = 'billing.prepare_drafts' then
    for d in select x.id from public.dispatches x where x.company_id = p_company and x.actual_dispatched_at is not null and x.actual_dispatched_at > now() - interval '120 days'
        and x.delivery_status not in ('returned', 'damaged')
        and (not exists (select 1 from public.invoice_drafts f where f.company_id = p_company and f.dispatch_id = x.id)
          or exists (select 1 from public.invoice_drafts f where f.company_id = p_company and f.dispatch_id = x.id and f.status in ('open', 'blocked'))) loop
      v_examined := v_examined + 1;
      begin
        v := private.ap3_prepare_invoice_draft(p_company, d.id);
        if v ->> 'state' in ('open', 'blocked') then v_n := v_n + 1; end if;
      exception when others then null;
      end;
    end loop;
    return jsonb_build_object('examined', v_examined, 'proposals', 0, 'alerts', 0, 'details', jsonb_build_object('drafts', v_n));
  elsif p_job = 'receivables.reminders' then
    v := private.ap3_prepare_reminders(p_company, p_run);
    return jsonb_build_object('examined', (v ->> 'examined')::integer, 'proposals', (v ->> 'prepared')::integer, 'alerts', 0, 'details', v);
  elsif p_job = 'alerts.reevaluate' then
    v := private.ap3_reevaluate(p_company, null, 'job');
    return jsonb_build_object('examined', 0, 'proposals', 0, 'alerts', 0, 'details', v);
  elsif p_job = 'bank.rematch' then
    for l in select x.id from public.bank_statement_lines x where x.company_id = p_company and x.direction = 'credit' and x.state = 'unmatched' and x.txn_date > private.ist_today() - 120
        order by x.txn_date, x.id limit 500 loop
      v_examined := v_examined + 1;
      v_class := private.ap3_bank_match_line(p_company, l.id, p_run);
      if v_class in ('exact', 'likely') then v_proposals := v_proposals + 1; end if;
    end loop;
    return jsonb_build_object('examined', v_examined, 'proposals', v_proposals, 'alerts', 0, 'details', '{}'::jsonb);
  end if;
  return null;
end;
$$;
revoke all on function private.ap3_job_execute(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.ap_job_execute(p_company uuid, p_job text, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  if p_job in ('quotes.expire', 'billing.prepare_drafts', 'receivables.reminders', 'alerts.reevaluate', 'bank.rematch') then
    return private.ap3_job_execute(p_company, p_job, p_run);
  end if;
  if p_job in ('press.idle_reconcile', 'dies.predict_service', 'maintenance.propose_pm', 'quality.sample_windows') then
    return private.ap2_job_execute(p_company, p_job, p_run);
  end if;
  return private.ap1_job_execute(p_company, p_job, p_run);
end;
$$;
revoke all on function private.ap_job_execute(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Client entry points. Company and actor come from the session (private.ap_ctx); dealers are refused.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap3_page(p jsonb)
returns integer language sql immutable set search_path = public, private as $$
  select greatest(1, least(100000, coalesce(nullif(p ->> 'page', '')::integer, 1)))
$$;
revoke all on function private.ap3_page(jsonb) from public, anon, authenticated;

create or replace function private.ap3_customer_name(p_customer uuid)
returns text language sql stable security definer set search_path = public, private as $$
  select coalesce(nullif(btrim(c.company_name), ''), c.customer_name) from public.customers c where c.id = p_customer
$$;
revoke all on function private.ap3_customer_name(uuid) from public, anon, authenticated;

create or replace function private.ap3_hold_row(h public.order_credit_holds, p_role text, p_actor uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', h.id, 'order_id', h.order_id, 'order_number', o.order_number, 'customer_id', h.customer_id, 'customer', private.ap3_customer_name(h.customer_id),
    'status', h.status, 'reasons', to_jsonb(h.reasons), 'exposure', h.exposure, 'credit_limit', h.credit_limit, 'overdue_beyond_grace', h.overdue_beyond_grace,
    'approved_exposure', h.approved_exposure, 'expires_at', h.expires_at, 'decided_by', (select u.full_name from public.app_users u where u.id = h.decided_by),
    'decided_at', h.decided_at, 'decision_note', h.decision_note, 'cleared_at', h.cleared_at, 'cleared_note', h.cleared_note, 'created_at', h.created_at,
    'requested_by', (select u.full_name from public.app_users u where u.id = h.requested_by), 'order_value', o.order_value,
    'can_decide', h.status = 'held' and p_role = any((private.ap3_settings(h.company_id)).credit_approver_roles) and h.requested_by is distinct from p_actor)
  from public.orders o where o.id = h.order_id
$$;
revoke all on function private.ap3_hold_row(public.order_credit_holds, text, uuid) from public, anon, authenticated;

create or replace function public.ap_credit(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; s public.o2c_settings%rowtype; v_customer uuid; v_order uuid; v_page integer; v_status text; v_total bigint; v_rows jsonb; h public.order_credit_holds%rowtype;
  v_limit numeric; v_days integer; v_grace integer; v_reason text; e jsonb; v_roles text[]; v_note text; o public.orders%rowtype;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'accounts', 'sales_manager', 'sales']);
  s := private.ap3_settings(c.company_id);
  if p_command = 'customer' then
    perform private.ap_keys(p_payload, array['customer_id']);
    v_customer := private.ap_uuid(p_payload, 'customer_id');
    if not exists (select 1 from public.customers x where x.id = v_customer and x.company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    return jsonb_build_object('customer_id', v_customer, 'customer', private.ap3_customer_name(v_customer),
      'exposure', private.ap3_exposure(c.company_id, v_customer, 0, null),
      'limit_history', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'credit_limit', l.credit_limit, 'credit_days', l.credit_days, 'grace_days', l.grace_days, 'reason', l.reason,
          'status', l.status, 'set_at', l.set_at, 'set_by', (select u.full_name from public.app_users u where u.id = l.set_by)) order by l.set_at desc)
        from (select * from public.customer_credit_limits x where x.company_id = c.company_id and x.customer_id = v_customer order by x.set_at desc limit 5) l), '[]'::jsonb),
      'holds', coalesce((select jsonb_agg(private.ap3_hold_row(x, c.role, c.actor_id) order by x.created_at desc) from (select * from public.order_credit_holds h2
        where h2.company_id = c.company_id and h2.customer_id = v_customer and h2.status in ('held', 'approved', 'rejected') order by h2.created_at desc limit 10) x), '[]'::jsonb),
      'on_account', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'applied', x.applied_amount, 'reference', x.reference, 'received_on', x.received_on) order by x.received_on)
        from public.customer_on_account_credits x where x.company_id = c.company_id and x.customer_id = v_customer and x.status = 'open'), '[]'::jsonb),
      'remitters', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'alias', a.alias, 'source', a.source, 'created_at', a.created_at) order by a.created_at desc)
        from public.customer_remitter_aliases a where a.company_id = c.company_id and a.customer_id = v_customer and a.active), '[]'::jsonb),
      'can_set_limit', c.role = any(private.ap3_accounts_roles()));
  elsif p_command in ('set_limit', 'remove_limit') then
    if not (c.role = any(private.ap3_accounts_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    perform private.ap_keys(p_payload, array['customer_id', 'credit_limit', 'credit_days', 'grace_days', 'reason']);
    v_customer := private.ap_uuid(p_payload, 'customer_id');
    if not exists (select 1 from public.customers x where x.id = v_customer and x.company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300);
    update public.customer_credit_limits set status = 'superseded', superseded_at = clock_timestamp() where company_id = c.company_id and customer_id = v_customer and status = 'active';
    if p_command = 'set_limit' then
      v_limit := private.ap2_num(p_payload, 'credit_limit', 'Credit limit', 0, 99999999999.99);
      v_days := private.ap2_num(p_payload, 'credit_days', 'Credit days', 0, 365, false)::integer;
      v_grace := coalesce(private.ap2_num(p_payload, 'grace_days', 'Grace days', 0, 180, false), 0)::integer;
      insert into public.customer_credit_limits(company_id, customer_id, credit_limit, credit_days, grace_days, reason, set_by)
        values (c.company_id, v_customer, round(v_limit, 2), v_days, v_grace, v_reason, c.actor_id);
    end if;
    perform private.ap3_reevaluate(c.company_id, v_customer, 'event');
    return jsonb_build_object('customer_id', v_customer, 'exposure', private.ap3_exposure(c.company_id, v_customer, 0, null));
  elsif p_command = 'order' then
    perform private.ap_keys(p_payload, array['order_id']);
    v_order := private.ap_uuid(p_payload, 'order_id');
    select * into o from public.orders where id = v_order and company_id = c.company_id;
    if o.id is null then raise exception 'AP: Order not found.'; end if;
    select * into h from public.order_credit_holds x where x.company_id = c.company_id and x.order_id = o.id order by (x.status in ('held', 'approved', 'rejected')) desc, x.created_at desc limit 1;
    return jsonb_build_object('order_id', o.id, 'customer_id', o.customer_id,
      'hold', case when h.id is not null then private.ap3_hold_row(h, c.role, c.actor_id) end,
      'exposure', case when o.customer_id is not null then private.ap3_exposure(c.company_id, o.customer_id, private.ap3_order_remaining_value(c.company_id, o.id), null) end,
      'checks', coalesce((select jsonb_agg(jsonb_build_object('stage', x.stage, 'exposure', x.exposure, 'credit_limit', x.credit_limit, 'overdue', x.overdue_beyond_grace, 'result', x.result,
          'outcome', x.outcome, 'checked_at', x.checked_at, 'dispatch_number', (select d.dispatch_number from public.dispatches d where d.id = x.dispatch_id)) order by x.checked_at desc)
        from (select * from public.order_credit_checks y where y.company_id = c.company_id and y.order_id = o.id order by y.checked_at desc limit 5) x), '[]'::jsonb),
      'can_request', c.role = any(private.ap3_sales_roles() || private.ap3_accounts_roles()));
  elsif p_command = 'request' then
    perform private.ap_keys(p_payload, array['order_id']);
    v_order := private.ap_uuid(p_payload, 'order_id');
    if not exists (select 1 from public.orders x where x.id = v_order and x.company_id = c.company_id and x.deleted_at is null) then raise exception 'AP: Order not found.'; end if;
    return private.ap3_credit_check_order(c.company_id, v_order, 'recheck', c.actor_id);
  elsif p_command = 'holds' then
    perform private.ap_keys(p_payload, array['status', 'page']);
    v_page := private.ap3_page(p_payload); v_status := coalesce(nullif(p_payload ->> 'status', ''), 'held');
    if v_status not in ('held', 'approved', 'rejected', 'cleared', 'all') then raise exception 'AP: Invalid filter.'; end if;
    select count(*) into v_total from public.order_credit_holds x where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status);
    select coalesce(jsonb_agg(private.ap3_hold_row(x, c.role, c.actor_id) order by x.created_at desc, x.id), '[]'::jsonb) into v_rows
      from (select * from public.order_credit_holds x where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status) order by x.created_at desc, x.id limit 10 offset (v_page - 1) * 10) x;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows);
  elsif p_command = 'decide' then
    perform private.ap_keys(p_payload, array['hold_id', 'decision', 'note']);
    if not (c.role = any(s.credit_approver_roles)) then raise exception 'AP: Your role does not approve credit. Approvers: %.', array_to_string(s.credit_approver_roles, ', '); end if;
    select * into h from public.order_credit_holds where id = private.ap_uuid(p_payload, 'hold_id') and company_id = c.company_id for update;
    if h.id is null or h.status <> 'held' then raise exception 'AP: This credit hold is not waiting for a decision.'; end if;
    if h.requested_by = c.actor_id then raise exception 'AP: Another person must decide credit for an order you created.'; end if;
    if coalesce(p_payload ->> 'decision', '') not in ('approve', 'reject') then raise exception 'AP: Choose approve or reject.'; end if;
    v_note := private.ap_text(p_payload ->> 'note', 'Note', 3, 500, p_payload ->> 'decision' = 'reject');
    if p_payload ->> 'decision' = 'approve' then
      e := private.ap3_exposure(c.company_id, h.customer_id, private.ap3_order_remaining_value(c.company_id, h.order_id), null);
      update public.order_credit_holds set status = 'approved', decided_by = c.actor_id, decided_at = clock_timestamp(), decision_note = v_note,
        approved_exposure = greatest((e ->> 'exposure')::numeric, h.exposure), expires_at = now() + make_interval(hours => s.credit_approval_hours) where id = h.id;
    else
      update public.order_credit_holds set status = 'rejected', decided_by = c.actor_id, decided_at = clock_timestamp(), decision_note = v_note where id = h.id;
    end if;
    update public.notifications set resolved_at = clock_timestamp(), resolution = 'Decided by ' || c.full_name, is_read = true, read_at = coalesce(read_at, now())
      where company_id = c.company_id and condition_key = 'credit-hold:' || h.order_id and resolved_at is null;
    if h.requested_by is not null then
      insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, action_link, created_by)
        values (c.company_id, h.requested_by, 'credit_decided', case when p_payload ->> 'decision' = 'approve' then 'success' else 'warning' end,
          left('Credit ' || case when p_payload ->> 'decision' = 'approve' then 'approved' else 'refused' end || ' for order ' || coalesce((select o2.order_number from public.orders o2 where o2.id = h.order_id), ''), 200),
          c.full_name || ': ' || coalesce(v_note, 'approved') || case when p_payload ->> 'decision' = 'approve' then format(' (valid %s hours).', s.credit_approval_hours) else '' end,
          'order', h.order_id, '/orders/' || h.order_id || '#credit', c.actor_id);
    end if;
    select * into h from public.order_credit_holds where id = h.id;
    return private.ap3_hold_row(h, c.role, c.actor_id);
  elsif p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('credit_approver_roles', to_jsonb(s.credit_approver_roles), 'credit_approval_hours', s.credit_approval_hours,
      'quote_extension_needs_approval', s.quote_extension_needs_approval, 'quote_extension_roles', to_jsonb(s.quote_extension_roles),
      'reminder_steps', to_jsonb(s.reminder_steps), 'reminder_repeat_days', s.reminder_repeat_days, 'duplicate_window_days', s.duplicate_window_days,
      'can_edit', c.role in ('owner', 'admin'));
  elsif p_command = 'save_settings' then
    if c.role not in ('owner', 'admin') then raise exception 'Not permitted' using errcode = '42501'; end if;
    perform private.ap_keys(p_payload, array['credit_approver_roles', 'credit_approval_hours', 'quote_extension_needs_approval', 'quote_extension_roles', 'reminder_steps', 'reminder_repeat_days', 'duplicate_window_days']);
    begin
      insert into public.o2c_settings(company_id, credit_approver_roles, credit_approval_hours, quote_extension_needs_approval, quote_extension_roles, reminder_steps, reminder_repeat_days, duplicate_window_days, updated_by, updated_at)
        values (c.company_id,
          coalesce((select array_agg(distinct x) from jsonb_array_elements_text(p_payload -> 'credit_approver_roles') x), s.credit_approver_roles),
          coalesce((p_payload ->> 'credit_approval_hours')::integer, s.credit_approval_hours),
          coalesce((p_payload ->> 'quote_extension_needs_approval')::boolean, s.quote_extension_needs_approval),
          coalesce((select array_agg(distinct x) from jsonb_array_elements_text(p_payload -> 'quote_extension_roles') x), s.quote_extension_roles),
          coalesce((select array_agg(distinct x::integer order by x::integer) from jsonb_array_elements_text(p_payload -> 'reminder_steps') x), s.reminder_steps),
          coalesce((p_payload ->> 'reminder_repeat_days')::integer, s.reminder_repeat_days), coalesce((p_payload ->> 'duplicate_window_days')::integer, s.duplicate_window_days),
          c.actor_id, now())
        on conflict (company_id) do update set credit_approver_roles = excluded.credit_approver_roles, credit_approval_hours = excluded.credit_approval_hours,
          quote_extension_needs_approval = excluded.quote_extension_needs_approval, quote_extension_roles = excluded.quote_extension_roles, reminder_steps = excluded.reminder_steps,
          reminder_repeat_days = excluded.reminder_repeat_days, duplicate_window_days = excluded.duplicate_window_days, updated_by = excluded.updated_by, updated_at = now();
    exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'AP: Choose 1 to 4 approver roles, approval validity of 1 to 720 hours, 1 to 8 reminder steps between -30 and 180 days, and windows within range.';
    end;
    return public.ap_credit('settings', '{}'::jsonb);
  elsif p_command = 'remove_remitter' then
    if not (c.role = any(private.ap3_accounts_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    perform private.ap_keys(p_payload, array['id']);
    update public.customer_remitter_aliases set active = false where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and active;
    return jsonb_build_object('removed', found);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_credit(text, jsonb) from public, anon;
grant execute on function public.ap_credit(text, jsonb) to authenticated;

create or replace function private.ap3_draft_summary(d public.production_job_drafts)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', d.id, 'status', d.status, 'group_key', d.group_key, 'die_id', d.die_id, 'die_number', (select x.die_number from public.dies x where x.id = d.die_id),
    'profile_id', d.profile_id, 'profile', (select coalesce(p.profile_code, '') || ' ' || coalesce(p.profile_name, '') from public.aluminium_profiles p where p.id = d.profile_id),
    'alloy', d.alloy, 'temper', d.temper, 'created_at', d.created_at, 'released_at', d.released_at,
    'open_lines', (select count(*) from public.production_job_draft_lines l where l.draft_id = d.id and l.status = 'open'),
    'open_kg', (select coalesce(sum(l.required_kg), 0) from public.production_job_draft_lines l where l.draft_id = d.id and l.status = 'open'),
    'earliest_due', (select min(l.due_date) from public.production_job_draft_lines l where l.draft_id = d.id and l.status = 'open'),
    'orders', (select coalesce(jsonb_agg(distinct o.order_number), '[]'::jsonb) from public.production_job_draft_lines l join public.orders o on o.id = l.order_id where l.draft_id = d.id and l.status = 'open'),
    'held_orders', (select count(distinct l.order_id) from public.production_job_draft_lines l join public.order_credit_holds h on h.order_id = l.order_id and h.status in ('held', 'rejected')
      where l.draft_id = d.id and l.status = 'open'))
$$;
revoke all on function private.ap3_draft_summary(public.production_job_drafts) from public, anon, authenticated;

create or replace function private.ap3_draft_line_row(l public.production_job_draft_lines)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', l.id, 'draft_id', l.draft_id, 'order_id', l.order_id, 'order_number', o.order_number, 'customer', private.ap3_customer_name(o.customer_id),
    'order_item_id', l.order_item_id, 'line', (select coalesce(i.item_description, i.section_code, 'Order line') from public.order_items i where i.id = l.order_item_id),
    'required_kg', l.required_kg, 'pieces', l.pieces, 'length_m', l.length_m, 'kg_per_m', l.kg_per_m, 'due_date', l.due_date, 'status', l.status, 'note', l.note,
    'job_id', l.job_id, 'job_number', (select j.job_number from public.production_jobs j where j.id = l.job_id),
    'credit_hold', (select h.status from public.order_credit_holds h where h.company_id = l.company_id and h.order_id = l.order_id and h.status in ('held', 'approved', 'rejected')),
    'current_need_kg', case when l.status = 'open' then private.ap3_line_need_kg(l.company_id, l.order_id, l.order_item_id) end)
  from public.orders o where o.id = l.order_id
$$;
revoke all on function private.ap3_draft_line_row(public.production_job_draft_lines) from public, anon, authenticated;

create or replace function public.ap_jobdrafts(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer; v_total bigint; v_rows jsonb; d public.production_job_drafts%rowtype; v_search text; v_ids uuid[]; v_planned date; ln public.production_job_draft_lines%rowtype;
begin
  select * into c from private.ap_ctx(private.ap3_planner_roles() || array['sales_manager']);
  if p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'search', 'status']);
    v_page := private.ap3_page(p_payload); v_search := nullif(btrim(coalesce(p_payload ->> 'search', '')), '');
    select count(*) into v_total from public.production_job_drafts x where x.company_id = c.company_id and x.status = coalesce(nullif(p_payload ->> 'status', ''), 'open')
      and (v_search is null or exists (select 1 from public.production_job_draft_lines l join public.orders o on o.id = l.order_id where l.draft_id = x.id and o.order_number ilike '%' || v_search || '%')
        or exists (select 1 from public.aluminium_profiles p where p.id = x.profile_id and (p.profile_code ilike '%' || v_search || '%' or p.profile_name ilike '%' || v_search || '%')));
    select coalesce(jsonb_agg(private.ap3_draft_summary(x) order by x.created_at, x.id), '[]'::jsonb) into v_rows from (
      select * from public.production_job_drafts x where x.company_id = c.company_id and x.status = coalesce(nullif(p_payload ->> 'status', ''), 'open')
        and (v_search is null or exists (select 1 from public.production_job_draft_lines l join public.orders o on o.id = l.order_id where l.draft_id = x.id and o.order_number ilike '%' || v_search || '%')
          or exists (select 1 from public.aluminium_profiles p where p.id = x.profile_id and (p.profile_code ilike '%' || v_search || '%' or p.profile_name ilike '%' || v_search || '%')))
        order by (select min(l.due_date) from public.production_job_draft_lines l where l.draft_id = x.id and l.status = 'open') nulls last, x.created_at, x.id
        limit 10 offset (v_page - 1) * 10) x;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows, 'can_release', c.role = any(private.ap3_planner_roles()));
  elsif p_command = 'draft' then
    perform private.ap_keys(p_payload, array['id']);
    select * into d from public.production_job_drafts where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if d.id is null then raise exception 'AP: Draft not found.'; end if;
    return private.ap3_draft_summary(d) || jsonb_build_object('lines', coalesce((select jsonb_agg(private.ap3_draft_line_row(l) order by l.due_date nulls last, l.created_at)
      from public.production_job_draft_lines l where l.draft_id = d.id), '[]'::jsonb), 'can_release', c.role = any(private.ap3_planner_roles()),
      'presses', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', private.ap2_machine_name(m.id)) order by m.machine_name)
        from public.machines m where m.company_id = c.company_id and coalesce(m.is_active, true) and m.machine_type = 'extrusion_press'), '[]'::jsonb));
  elsif p_command = 'order' then
    perform private.ap_keys(p_payload, array['order_id']);
    return jsonb_build_object('lines', coalesce((select jsonb_agg(private.ap3_draft_line_row(l) order by l.created_at)
      from public.production_job_draft_lines l where l.company_id = c.company_id and l.order_id = private.ap_uuid(p_payload, 'order_id')), '[]'::jsonb),
      'can_prepare', c.role = any(private.ap3_planner_roles()));
  elsif p_command = 'prepare' then
    if not (c.role = any(private.ap3_planner_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    perform private.ap_keys(p_payload, array['order_id']);
    if not exists (select 1 from public.orders o where o.id = private.ap_uuid(p_payload, 'order_id') and o.company_id = c.company_id) then raise exception 'AP: Order not found.'; end if;
    return jsonb_build_object('lines_added', private.ap3_draft_jobs_for_order(c.company_id, private.ap_uuid(p_payload, 'order_id')));
  elsif p_command = 'release' then
    perform private.ap_keys(p_payload, array['id', 'machine_id', 'planned_date', 'line_ids']);
    begin v_planned := nullif(p_payload ->> 'planned_date', '')::date; exception when others then raise exception 'AP: Choose a valid planned date.'; end;
    if jsonb_typeof(p_payload -> 'line_ids') = 'array' then
      select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(p_payload -> 'line_ids') x where x ~* '^[0-9a-f-]{36}$';
    end if;
    return private.ap3_release_draft(c.company_id, c.actor_id, c.role, private.ap_uuid(p_payload, 'id'), private.ap_uuid(p_payload, 'machine_id', false), v_planned, v_ids);
  elsif p_command = 'remove_line' then
    if not (c.role = any(private.ap3_planner_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    perform private.ap_keys(p_payload, array['line_id', 'reason']);
    select * into ln from public.production_job_draft_lines where id = private.ap_uuid(p_payload, 'line_id') and company_id = c.company_id for update;
    if ln.id is null or ln.status <> 'open' then raise exception 'AP: This draft line is not open.'; end if;
    update public.production_job_draft_lines set status = 'removed', note = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), closed_at = clock_timestamp(), closed_by = c.actor_id where id = ln.id;
    if not exists (select 1 from public.production_job_draft_lines l where l.draft_id = ln.draft_id and l.status = 'open') then
      update public.production_job_drafts set status = case when exists (select 1 from public.production_job_draft_lines l where l.draft_id = ln.draft_id and l.status = 'released') then 'released' else 'cancelled' end
        where id = ln.draft_id and status = 'open';
    end if;
    return jsonb_build_object('line_id', ln.id, 'status', 'removed');
  elsif p_command = 'stats' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('window_days', 30,
      'jobs_total', (select count(*) from public.production_jobs j where j.company_id = c.company_id and j.created_at > now() - interval '30 days'),
      'jobs_from_drafts', (select count(*) from public.production_jobs j where j.company_id = c.company_id and j.created_at > now() - interval '30 days'
        and exists (select 1 from public.production_job_draft_lines l where l.job_id = j.id)),
      'open_lines', (select count(*) from public.production_job_draft_lines l where l.company_id = c.company_id and l.status = 'open'));
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_jobdrafts(text, jsonb) from public, anon;
grant execute on function public.ap_jobdrafts(text, jsonb) to authenticated;

create or replace function public.ap_billing(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer; v_total bigint; v_rows jsonb; v_status text; f public.invoice_drafts%rowtype; v_fp text; v_out jsonb := '[]'::jsonb; v_id uuid; v_search text;
  v_rule public.gst_supply_rules%rowtype; v_n integer; v_state text; v_dispatch uuid; v_customer uuid; v_ver integer;
begin
  select * into c from private.ap_ctx(private.ap3_accounts_roles());
  if p_command = 'drafts' then
    perform private.ap_keys(p_payload, array['status', 'page', 'search']);
    v_page := private.ap3_page(p_payload); v_status := coalesce(nullif(p_payload ->> 'status', ''), 'open'); v_search := nullif(btrim(coalesce(p_payload ->> 'search', '')), '');
    if v_status not in ('open', 'blocked', 'posted', 'cancelled', 'all') then raise exception 'AP: Invalid filter.'; end if;
    select count(*) into v_total from public.invoice_drafts x join public.dispatches d on d.id = x.dispatch_id join public.orders o on o.id = x.order_id
      where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status)
        and (v_search is null or d.dispatch_number ilike '%' || v_search || '%' or o.order_number ilike '%' || v_search || '%' or private.ap3_customer_name(x.customer_id) ilike '%' || v_search || '%');
    select coalesce(jsonb_agg(private.ap3_draft_row(x) order by x.gate_out_at, x.id), '[]'::jsonb) into v_rows from (
      select x.* from public.invoice_drafts x join public.dispatches d on d.id = x.dispatch_id join public.orders o on o.id = x.order_id
        where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status)
          and (v_search is null or d.dispatch_number ilike '%' || v_search || '%' or o.order_number ilike '%' || v_search || '%' or private.ap3_customer_name(x.customer_id) ilike '%' || v_search || '%')
        order by x.gate_out_at, x.id limit 10 offset (v_page - 1) * 10) x;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows,
      'summary', (select jsonb_build_object('open', count(*) filter (where x.status = 'open'), 'blocked', count(*) filter (where x.status = 'blocked'),
        'open_total', coalesce(sum(x.total_value) filter (where x.status = 'open'), 0)) from public.invoice_drafts x where x.company_id = c.company_id));
  elsif p_command = 'draft' then
    perform private.ap_keys(p_payload, array['id']);
    select * into f from public.invoice_drafts where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if f.id is null then raise exception 'AP: Draft not found.'; end if;
    return private.ap3_draft_row(f);
  elsif p_command = 'refresh' then
    perform private.ap_keys(p_payload, array['id']);
    select * into f from public.invoice_drafts where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if f.id is null then raise exception 'AP: Draft not found.'; end if;
    perform private.ap3_prepare_invoice_draft(c.company_id, f.dispatch_id);
    select * into f from public.invoice_drafts where id = f.id;
    return private.ap3_draft_row(f);
  elsif p_command = 'post_data' then
    perform private.ap_keys(p_payload, array['ids']);
    if jsonb_typeof(p_payload -> 'ids') <> 'array' or jsonb_array_length(p_payload -> 'ids') not between 1 and 50 then raise exception 'AP: Choose 1 to 50 drafts.'; end if;
    for v_id in select distinct x::uuid from jsonb_array_elements_text(p_payload -> 'ids') x loop
      select * into f from public.invoice_drafts where id = v_id and company_id = c.company_id;
      if f.id is null then v_out := v_out || jsonb_build_object('id', v_id, 'state', 'failed', 'message', 'Draft not found.'); continue; end if;
      if f.status <> 'open' then v_out := v_out || jsonb_build_object('id', f.id, 'state', 'failed', 'message', coalesce(f.blocker, 'This draft is ' || f.status || '.')); continue; end if;
      begin v_fp := private.reviewed_invoice_source_fingerprint(c.company_id, f.dispatch_id); exception when others then v_fp := null; end;
      if v_fp is distinct from f.source_fingerprint then
        perform private.ap3_prepare_invoice_draft(c.company_id, f.dispatch_id);
        v_out := v_out || jsonb_build_object('id', f.id, 'state', 'changed', 'message', 'The packing list changed after the draft was prepared. Review the refreshed totals and post again.');
        continue;
      end if;
      v_out := v_out || jsonb_build_object('id', f.id, 'state', 'ready', 'order_id', f.order_id, 'dispatch_id', f.dispatch_id, 'place_of_supply_state_code', f.place_of_supply_state_code,
        'invoice_date', f.invoice_date, 'due_date', f.due_date, 'source_fingerprint', f.source_fingerprint, 'total_value', f.total_value);
    end loop;
    return jsonb_build_object('rows', v_out);
  elsif p_command = 'explain' then
    perform private.ap_keys(p_payload, array['dispatch_id', 'reason']);
    v_dispatch := private.ap_uuid(p_payload, 'dispatch_id');
    if not exists (select 1 from public.invoice_drafts x where x.company_id = c.company_id and x.dispatch_id = v_dispatch) then
      perform private.ap3_prepare_invoice_draft(c.company_id, v_dispatch);
    end if;
    update public.invoice_drafts set explanation = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), explained_by = c.actor_id, explained_at = clock_timestamp()
      where company_id = c.company_id and dispatch_id = v_dispatch and status in ('open', 'blocked');
    if not found then raise exception 'AP: Only an unbilled dispatch can be explained.'; end if;
    return jsonb_build_object('dispatch_id', v_dispatch, 'explained', true);
  elsif p_command = 'unbilled' then
    perform private.ap_keys(p_payload, array['page', 'only_late']);
    v_page := private.ap3_page(p_payload);
    with u as (
      select d.id, d.dispatch_number, d.actual_dispatched_at, o.order_number, o.id order_id, o.customer_id, dr.id draft_id, dr.status draft_status, dr.blocker, dr.explanation, dr.total_value,
        private.factory_working_days_between(c.company_id, (d.actual_dispatched_at at time zone 'Asia/Kolkata')::date, private.ist_today()) age
      from public.dispatches d join public.orders o on o.id = d.order_id and o.company_id = d.company_id
      left join public.invoice_drafts dr on dr.company_id = d.company_id and dr.dispatch_id = d.id
      where d.company_id = c.company_id and d.actual_dispatched_at is not null and d.delivery_status not in ('returned', 'damaged') and o.opening_cutover_id is null
        and private.ap3_active_invoice(c.company_id, d.id) is null)
    select (select count(*) from u where not coalesce((p_payload ->> 'only_late')::boolean, false) or u.age > 1),
      (select coalesce(jsonb_agg(jsonb_build_object('dispatch_id', x.id, 'dispatch_number', x.dispatch_number, 'gate_out_at', x.actual_dispatched_at, 'order_id', x.order_id,
          'order_number', x.order_number, 'customer', private.ap3_customer_name(x.customer_id), 'draft_id', x.draft_id, 'draft_status', x.draft_status, 'blocker', x.blocker,
          'explanation', x.explanation, 'total_value', x.total_value, 'working_days', x.age, 'late', x.age > 1) order by x.actual_dispatched_at), '[]'::jsonb)
        from (select * from u where not coalesce((p_payload ->> 'only_late')::boolean, false) or u.age > 1 order by u.actual_dispatched_at, u.id limit 10 offset (v_page - 1) * 10) x),
      (select jsonb_build_object('late_unexplained', count(*) filter (where u.age > 1 and u.explanation is null), 'late_explained', count(*) filter (where u.age > 1 and u.explanation is not null),
        'total', count(*)) from u)
      into v_total, v_rows, v_out;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows, 'summary', v_out);
  elsif p_command = 'gst_rule' then
    perform private.ap_keys(p_payload, array[]::text[]);
    select * into v_rule from public.gst_supply_rules where company_id = c.company_id and status = 'confirmed';
    return jsonb_build_object('rule', case when v_rule.id is not null then jsonb_build_object('id', v_rule.id, 'version', v_rule.version, 'basis', v_rule.basis, 'hsn_profile', v_rule.hsn_profile,
        'hsn_scrap', v_rule.hsn_scrap, 'note', v_rule.note, 'confirmed_at', v_rule.confirmed_at, 'confirmed_by', (select u.full_name from public.app_users u where u.id = v_rule.confirmed_by)) end,
      'supplier_state', private.ap3_supplier_state(c.company_id),
      'profiles_without_hsn', (select count(*) from public.aluminium_profiles p where p.company_id = c.company_id and nullif(btrim(coalesce(p.hsn_code, '')), '') is null),
      'customers_without_state', (select count(*) from public.customers x where x.company_id = c.company_id and x.deleted_at is null
        and not (coalesce(private.ap_gstin_valid(upper(nullif(btrim(x.gst_number), ''))), false) or private.ap3_state_code(x.state) is not null)));
  elsif p_command = 'gst_confirm' then
    perform private.ap_keys(p_payload, array['hsn_profile', 'hsn_scrap', 'note']);
    if nullif(p_payload ->> 'hsn_profile', '') is not null and (p_payload ->> 'hsn_profile') !~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' then raise exception 'AP: HSN codes have 4, 6 or 8 digits.'; end if;
    if nullif(p_payload ->> 'hsn_scrap', '') is not null and (p_payload ->> 'hsn_scrap') !~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' then raise exception 'AP: HSN codes have 4, 6 or 8 digits.'; end if;
    if private.ap3_supplier_state(c.company_id) is null then raise exception 'AP: Set the company GST number or state code first.'; end if;
    select coalesce(max(version), 0) + 1 into v_ver from public.gst_supply_rules where company_id = c.company_id;
    update public.gst_supply_rules set status = 'superseded', superseded_at = clock_timestamp() where company_id = c.company_id and status = 'confirmed';
    insert into public.gst_supply_rules(company_id, version, basis, hsn_profile, hsn_scrap, note, confirmed_by)
      values (c.company_id, v_ver, 'billing_gstin', nullif(p_payload ->> 'hsn_profile', ''), nullif(p_payload ->> 'hsn_scrap', ''), private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id);
    return public.ap_billing('gst_rule', '{}'::jsonb);
  elsif p_command = 'gst_derive' then
    perform private.ap_keys(p_payload, array['customer_id', 'order_id']);
    v_customer := coalesce(private.ap_uuid(p_payload, 'customer_id', false), (select o.customer_id from public.orders o where o.id = private.ap_uuid(p_payload, 'order_id', false) and o.company_id = c.company_id));
    if v_customer is null or not exists (select 1 from public.customers x where x.id = v_customer and x.company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    return private.ap3_derive_supply(c.company_id, v_customer);
  elsif p_command = 'gst_override' then
    perform private.ap_keys(p_payload, array['dispatch_id', 'state', 'reason']);
    v_dispatch := private.ap_uuid(p_payload, 'dispatch_id'); v_state := p_payload ->> 'state';
    if coalesce(v_state, '') !~ '^(0[1-9]|[12][0-9]|3[0-8])$' or v_state in ('25', '28') then raise exception 'AP: Choose a domestic state.'; end if;
    select o.customer_id into v_customer from public.dispatches d join public.orders o on o.id = d.order_id where d.id = v_dispatch and d.company_id = c.company_id;
    if v_customer is null then raise exception 'AP: Dispatch not found.'; end if;
    insert into public.invoice_supply_overrides(company_id, dispatch_id, derived_state, chosen_state, reason, requested_by, expires_at)
      values (c.company_id, v_dispatch, private.ap3_derive_supply(c.company_id, v_customer) ->> 'state', v_state, private.ap_text(p_payload ->> 'reason', 'Reason', 10, 300), c.actor_id, now() + interval '2 hours')
      returning id into v_id;
    return jsonb_build_object('override_id', v_id, 'expires_in_hours', 2);
  elsif p_command = 'gst_sample' then
    perform private.ap_keys(p_payload, array['page', 'only_mismatch']);
    v_page := private.ap3_page(p_payload);
    select count(*) into v_total from public.invoice_supply_derivations s where s.company_id = c.company_id
      and (not coalesce((p_payload ->> 'only_mismatch')::boolean, false) or s.derived_state is distinct from s.chosen_state);
    select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) into v_rows from (
      select s.created_at, jsonb_build_object('invoice_id', s.invoice_id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date, 'customer', private.ap3_customer_name(i.customer_id),
        'derived_state', s.derived_state, 'chosen_state', s.chosen_state, 'basis', s.basis, 'source_gstin', s.source_gstin, 'supplier_state', i.supplier_state_code,
        'tax_type', case when i.igst_amount > 0 then 'IGST' when i.cgst_amount > 0 then 'CGST + SGST/UTGST' else 'No tax' end,
        'expected_tax_type', case when s.derived_state is null then null when s.derived_state = i.supplier_state_code then 'CGST + SGST/UTGST' else 'IGST' end,
        'override_reason', (select o.reason from public.invoice_supply_overrides o where o.id = s.override_id), 'rule_version', s.rule_version) j
      from public.invoice_supply_derivations s join public.invoices i on i.id = s.invoice_id
      where s.company_id = c.company_id and (not coalesce((p_payload ->> 'only_mismatch')::boolean, false) or s.derived_state is distinct from s.chosen_state)
      order by s.created_at desc limit 10 offset (v_page - 1) * 10) x;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows);
  elsif p_command = 'hsn_apply' then
    perform private.ap_keys(p_payload, array[]::text[]);
    select * into v_rule from public.gst_supply_rules where company_id = c.company_id and status = 'confirmed';
    if v_rule.hsn_profile is null then raise exception 'AP: Confirm a default profile HSN code first.'; end if;
    update public.aluminium_profiles set hsn_code = v_rule.hsn_profile where company_id = c.company_id and nullif(btrim(coalesce(hsn_code, '')), '') is null;
    get diagnostics v_n = row_count;
    return jsonb_build_object('profiles_updated', v_n, 'hsn_code', v_rule.hsn_profile);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_billing(text, jsonb) from public, anon;
grant execute on function public.ap_billing(text, jsonb) to authenticated;

create or replace function private.ap3_line_row(l public.bank_statement_lines)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', l.id, 'statement_id', l.statement_id, 'line_no', l.line_no, 'txn_date', l.txn_date, 'narration', l.narration, 'reference', l.reference,
    'direction', l.direction, 'amount', l.amount, 'remitter', l.remitter, 'state', l.state, 'match_class', l.match_class, 'evidence', l.match_evidence,
    'customer_id', coalesce(l.customer_id, (l.match_evidence ->> 'customer_id')::uuid), 'customer', coalesce(private.ap3_customer_name(l.customer_id), l.match_evidence ->> 'customer'),
    'assigned', l.assigned_by is not null, 'receipt_event_id', l.receipt_event_id, 'on_account_credit_id', l.on_account_credit_id, 'ignored_reason', l.ignored_reason,
    'reversal_count', l.reversal_count, 'last_reversal_reason', l.last_reversal_reason, 'receipted_at', l.receipted_at,
    'proposal_id', (select p.id from public.proposals p where p.company_id = l.company_id and p.proposal_type = 'bank.receipt_match' and p.target_key = l.id::text and p.status = 'open'))
$$;
revoke all on function private.ap3_line_row(public.bank_statement_lines) from public, anon, authenticated;

create or replace function private.ap3_reminder_row(r public.payment_reminders)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', r.id, 'customer_id', r.customer_id, 'customer', private.ap3_customer_name(r.customer_id), 'reminder_date', r.reminder_date, 'invoices', r.invoices,
    'total_due', r.total_due, 'worst_days', r.worst_days, 'message', r.message, 'phone', r.phone, 'status', r.status, 'copied_at', r.copied_at, 'sent_via', r.sent_via, 'sent_at', r.sent_at,
    'sent_by', (select u.full_name from public.app_users u where u.id = r.sent_by), 'skip_reason', r.skip_reason)
$$;
revoke all on function private.ap3_reminder_row(public.payment_reminders) from public, anon, authenticated;

create or replace function public.ap_cash(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer; v_total bigint; v_rows jsonb; v_customer uuid; l public.bank_statement_lines%rowtype; rm public.payment_reminders%rowtype; v_state text; v_class text;
  v_search text; v_month date; v_alias text; v_x jsonb; v_key uuid;
begin
  select * into c from private.ap_ctx(private.ap3_accounts_roles());
  if p_command = 'propose' then
    perform private.ap_keys(p_payload, array['customer_id', 'amount', 'narration']);
    v_customer := private.ap_uuid(p_payload, 'customer_id');
    if not exists (select 1 from public.customers x where x.id = v_customer and x.company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    return private.ap3_allocate(c.company_id, v_customer, private.ap2_num(p_payload, 'amount', 'Amount', 0.01, 999999999999.99), p_payload ->> 'narration')
      || jsonb_build_object('customer', private.ap3_customer_name(v_customer), 'on_account_open', (select coalesce(sum(x.amount - x.applied_amount), 0) from public.customer_on_account_credits x
        where x.company_id = c.company_id and x.customer_id = v_customer and x.status = 'open'));
  elsif p_command = 'post' then
    perform private.ap_keys(p_payload, array['key', 'customer_id', 'amount', 'payment_date', 'payment_method', 'reference_number', 'notes', 'allocations', 'on_account', 'proposed']);
    return private.ap3_post_receipt(c.company_id, c.actor_id, c.role, private.ap_uuid(p_payload, 'customer_id'), p_payload - array['key', 'customer_id', 'allocations', 'on_account', 'proposed'],
      p_payload -> 'allocations', nullif(p_payload ->> 'on_account', '')::numeric, private.ap_uuid(p_payload, 'key'), 'receipt_form', null, p_payload -> 'proposed');
  elsif p_command = 'on_account' then
    perform private.ap_keys(p_payload, array['customer_id', 'page']);
    v_page := private.ap3_page(p_payload); v_customer := private.ap_uuid(p_payload, 'customer_id', false);
    select count(*) into v_total from public.customer_on_account_credits x where x.company_id = c.company_id and x.status = 'open' and (v_customer is null or x.customer_id = v_customer);
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'customer_id', x.customer_id, 'customer', private.ap3_customer_name(x.customer_id), 'amount', x.amount, 'applied', x.applied_amount,
        'available', x.amount - x.applied_amount, 'reference', x.reference, 'received_on', x.received_on, 'payment_method', x.payment_method, 'source', x.source,
        'open_invoices', (select count(*) from public.invoices i where i.company_id = c.company_id and i.customer_id = x.customer_id and i.balance_due > 0 and i.deleted_at is null
          and i.status = any(private.ap3_open_invoice_statuses()))) order by x.received_on, x.id), '[]'::jsonb) into v_rows
      from (select * from public.customer_on_account_credits x where x.company_id = c.company_id and x.status = 'open' and (v_customer is null or x.customer_id = v_customer)
        order by x.received_on, x.id limit 10 offset (v_page - 1) * 10) x;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows);
  elsif p_command = 'apply_on_account' then
    perform private.ap_keys(p_payload, array['credit_id', 'key', 'allocations']);
    return private.ap3_apply_on_account(c.company_id, c.actor_id, c.role, private.ap_uuid(p_payload, 'credit_id'), p_payload -> 'allocations', private.ap_uuid(p_payload, 'key'));
  elsif p_command = 'bank_profiles' then
    perform private.ap_keys(p_payload, array['header_signature']);
    return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'header_signature', x.header_signature, 'mapping', x.mapping, 'date_format', x.date_format) order by x.updated_at desc)
      from public.bank_format_profiles x where x.company_id = c.company_id and (p_payload ->> 'header_signature' is null or x.header_signature = p_payload ->> 'header_signature')), '[]'::jsonb);
  elsif p_command = 'bank_import' then
    perform private.ap_keys(p_payload, array['source_name', 'file_fingerprint', 'account_label', 'profile', 'rows']);
    return private.ap3_bank_import(c.company_id, c.actor_id, p_payload);
  elsif p_command = 'bank_statements' then
    perform private.ap_keys(p_payload, array['page']);
    v_page := private.ap3_page(p_payload);
    select count(*) into v_total from public.bank_statements x where x.company_id = c.company_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'source_name', x.source_name, 'account_label', x.account_label, 'period_from', x.period_from, 'period_to', x.period_to,
        'line_count', x.line_count, 'new_lines', x.new_lines, 'duplicate_lines', x.duplicate_lines, 'credit_lines', x.credit_lines, 'imported_at', x.imported_at,
        'imported_by', (select u.full_name from public.app_users u where u.id = x.imported_by),
        'receipted', (select count(*) from public.bank_statement_lines b where b.statement_id = x.id and b.state = 'receipted'),
        'waiting', (select count(*) from public.bank_statement_lines b where b.statement_id = x.id and b.state in ('unmatched', 'proposed'))) order by x.imported_at desc), '[]'::jsonb) into v_rows
      from (select * from public.bank_statements x where x.company_id = c.company_id order by x.imported_at desc limit 10 offset (v_page - 1) * 10) x;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows);
  elsif p_command = 'bank_lines' then
    perform private.ap_keys(p_payload, array['state', 'class', 'search', 'page', 'statement_id']);
    v_page := private.ap3_page(p_payload); v_state := coalesce(nullif(p_payload ->> 'state', ''), 'waiting'); v_class := nullif(p_payload ->> 'class', '');
    v_search := nullif(btrim(coalesce(p_payload ->> 'search', '')), '');
    if v_state not in ('waiting', 'unmatched', 'proposed', 'receipted', 'ignored', 'all') or (v_class is not null and v_class not in ('exact', 'likely', 'unknown')) then raise exception 'AP: Invalid filter.'; end if;
    select count(*) into v_total from public.bank_statement_lines x where x.company_id = c.company_id and x.direction = 'credit'
      and (v_state = 'all' or (v_state = 'waiting' and x.state in ('unmatched', 'proposed')) or x.state = v_state) and (v_class is null or x.match_class = v_class)
      and (p_payload ->> 'statement_id' is null or x.statement_id = private.ap_uuid(p_payload, 'statement_id'))
      and (v_search is null or x.narration ilike '%' || v_search || '%' or x.reference ilike '%' || v_search || '%' or x.amount::text = v_search);
    select coalesce(jsonb_agg(private.ap3_line_row(x) order by x.txn_date desc, x.line_no), '[]'::jsonb) into v_rows from (
      select * from public.bank_statement_lines x where x.company_id = c.company_id and x.direction = 'credit'
        and (v_state = 'all' or (v_state = 'waiting' and x.state in ('unmatched', 'proposed')) or x.state = v_state) and (v_class is null or x.match_class = v_class)
        and (p_payload ->> 'statement_id' is null or x.statement_id = private.ap_uuid(p_payload, 'statement_id'))
        and (v_search is null or x.narration ilike '%' || v_search || '%' or x.reference ilike '%' || v_search || '%' or x.amount::text = v_search)
        order by x.txn_date desc, x.line_no limit 10 offset (v_page - 1) * 10) x;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows);
  elsif p_command in ('bank_assign', 'bank_rematch', 'bank_ignore', 'bank_reverse') then
    perform private.ap_keys(p_payload, array['line_id', 'customer_id', 'reason']);
    select * into l from public.bank_statement_lines where id = private.ap_uuid(p_payload, 'line_id') and company_id = c.company_id for update;
    if l.id is null or l.direction <> 'credit' then raise exception 'AP: Bank line not found.'; end if;
    if p_command = 'bank_reverse' then return private.ap3_reverse_bank_line(c.company_id, c.actor_id, c.role, l.id, p_payload ->> 'reason'); end if;
    if l.state in ('receipted') then raise exception 'AP: This line is already receipted. Reverse it first.'; end if;
    if p_command = 'bank_ignore' then
      update public.bank_statement_lines set state = 'ignored', ignored_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300) where id = l.id;
      update public.proposals set status = 'stale' where company_id = c.company_id and proposal_type = 'bank.receipt_match' and target_key = l.id::text and status = 'open';
      select * into l from public.bank_statement_lines where id = l.id;
      return private.ap3_line_row(l);
    end if;
    if p_command = 'bank_assign' then
      v_customer := private.ap_uuid(p_payload, 'customer_id');
      if not exists (select 1 from public.customers x where x.id = v_customer and x.company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
      if l.remitter is not null then v_alias := private.ap3_learn_remitter(c.company_id, c.actor_id, v_customer, l.remitter); end if;
      update public.bank_statement_lines set customer_id = v_customer, assigned_by = c.actor_id, state = 'unmatched', ignored_reason = null where id = l.id;
    elsif l.state = 'ignored' then
      update public.bank_statement_lines set state = 'unmatched', ignored_reason = null where id = l.id;
    end if;
    update public.proposals set status = 'stale' where company_id = c.company_id and proposal_type = 'bank.receipt_match' and target_key = l.id::text and status = 'open';
    v_class := private.ap3_bank_match_line(c.company_id, l.id, null);
    select * into l from public.bank_statement_lines where id = l.id;
    return private.ap3_line_row(l) || jsonb_build_object('class', v_class, 'learned_remitter', v_alias);
  elsif p_command = 'bank_rate' then
    perform private.ap_keys(p_payload, array['month']);
    v_month := coalesce(to_date(nullif(p_payload ->> 'month', '') || '-01', 'YYYY-MM-DD'), date_trunc('month', private.ist_today())::date);
    select jsonb_build_object('month', to_char(v_month, 'YYYY-MM'), 'credits', count(*) filter (where x.state <> 'ignored'),
      'receipted', count(*) filter (where x.state = 'receipted'),
      'without_search', count(*) filter (where x.state = 'receipted' and x.assigned_by is null),
      'percent_without_search', case when count(*) filter (where x.state <> 'ignored') > 0
        then round(100.0 * count(*) filter (where x.state = 'receipted' and x.assigned_by is null) / count(*) filter (where x.state <> 'ignored'), 1) end,
      'target_percent', 80) into v_x
      from public.bank_statement_lines x where x.company_id = c.company_id and x.direction = 'credit' and x.txn_date >= v_month and x.txn_date < (v_month + interval '1 month')::date;
    return v_x;
  elsif p_command = 'reminders' then
    perform private.ap_keys(p_payload, array['date', 'status', 'page']);
    v_page := private.ap3_page(p_payload); v_state := coalesce(nullif(p_payload ->> 'status', ''), 'prepared');
    if v_state not in ('prepared', 'sent', 'skipped', 'superseded', 'all') then raise exception 'AP: Invalid filter.'; end if;
    select count(*) into v_total from public.payment_reminders x where x.company_id = c.company_id and (v_state = 'all' or x.status = v_state)
      and (p_payload ->> 'date' is null or x.reminder_date = (p_payload ->> 'date')::date);
    select coalesce(jsonb_agg(private.ap3_reminder_row(x) order by x.reminder_date desc, x.worst_days desc, x.id), '[]'::jsonb) into v_rows from (
      select * from public.payment_reminders x where x.company_id = c.company_id and (v_state = 'all' or x.status = v_state)
        and (p_payload ->> 'date' is null or x.reminder_date = (p_payload ->> 'date')::date)
        order by x.reminder_date desc, x.worst_days desc, x.id limit 10 offset (v_page - 1) * 10) x;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows, 'today', private.ist_today());
  elsif p_command in ('reminder_copied', 'reminder_sent', 'reminder_skip') then
    perform private.ap_keys(p_payload, array['id', 'channel', 'reason']);
    select * into rm from public.payment_reminders where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if rm.id is null then raise exception 'AP: Reminder not found.'; end if;
    if p_command = 'reminder_copied' then
      if rm.status = 'prepared' then update public.payment_reminders set copied_at = coalesce(copied_at, clock_timestamp()) where id = rm.id; end if;
    elsif rm.status <> 'prepared' then
      raise exception 'AP: This reminder is already %.', rm.status;
    elsif p_command = 'reminder_sent' then
      if coalesce(p_payload ->> 'channel', '') not in ('whatsapp', 'email', 'phone_call', 'other') then raise exception 'AP: Choose how the reminder was sent.'; end if;
      update public.payment_reminders set status = 'sent', sent_via = p_payload ->> 'channel', sent_at = clock_timestamp(), sent_by = c.actor_id where id = rm.id;
    else
      update public.payment_reminders set status = 'skipped', skip_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), skipped_by = c.actor_id where id = rm.id;
    end if;
    select * into rm from public.payment_reminders where id = rm.id;
    return private.ap3_reminder_row(rm);
  elsif p_command = 'reminder_coverage' then
    perform private.ap_keys(p_payload, array['page']);
    v_page := private.ap3_page(p_payload);
    with od as (
      select i.id, i.invoice_number, i.customer_id, i.due_date, i.balance_due, private.ist_today() - i.due_date days,
        (select max(r.sent_at) from public.payment_reminders r where r.company_id = c.company_id and r.customer_id = i.customer_id and r.status = 'sent'
          and r.invoices @> jsonb_build_array(jsonb_build_object('invoice_id', i.id))) last_sent,
        exists (select 1 from public.collection_promises cp where cp.company_id = c.company_id and cp.invoice_id = i.id and cp.withdrawn_at is null and cp.due_date >= private.ist_today()) committed
      from public.invoices i where i.company_id = c.company_id and i.deleted_at is null and i.balance_due > 0 and i.due_date < private.ist_today()
        and i.status = any(private.ap3_open_invoice_statuses()) and i.opening_cutover_id is null)
    select (select count(*) from od where not od.committed and (od.last_sent is null or od.last_sent < now() - make_interval(days => (private.ap3_settings(c.company_id)).reminder_repeat_days))),
      (select coalesce(jsonb_agg(jsonb_build_object('invoice_id', x.id, 'invoice_number', x.invoice_number, 'customer', private.ap3_customer_name(x.customer_id), 'due_date', x.due_date,
          'days_overdue', x.days, 'balance_due', x.balance_due, 'last_sent', x.last_sent) order by x.days desc), '[]'::jsonb)
        from (select * from od where not od.committed and (od.last_sent is null or od.last_sent < now() - make_interval(days => (private.ap3_settings(c.company_id)).reminder_repeat_days))
          order by od.days desc, od.id limit 10 offset (v_page - 1) * 10) x),
      (select jsonb_build_object('overdue', count(*), 'covered_by_reminder', count(*) filter (where not od.committed and od.last_sent >= now() - make_interval(days => (private.ap3_settings(c.company_id)).reminder_repeat_days)),
        'covered_by_commitment', count(*) filter (where od.committed)) from od)
      into v_total, v_rows, v_x;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows, 'summary', v_x);
  elsif p_command = 'prepare_reminders' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.ap3_prepare_reminders(c.company_id, null);
  elsif p_command = 'customers' then
    perform private.ap_keys(p_payload, array['search']);
    v_search := nullif(btrim(coalesce(p_payload ->> 'search', '')), '');
    return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', coalesce(nullif(btrim(x.company_name), ''), x.customer_name), 'city', x.city) order by coalesce(nullif(btrim(x.company_name), ''), x.customer_name))
      from (select * from public.customers x where x.company_id = c.company_id and x.deleted_at is null and coalesce(x.is_active, true)
        and (v_search is null or x.customer_name ilike '%' || v_search || '%' or x.company_name ilike '%' || v_search || '%' or x.gst_number ilike v_search || '%')
        order by coalesce(nullif(btrim(x.company_name), ''), x.customer_name) limit 20) x), '[]'::jsonb);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_cash(text, jsonb) from public, anon;
grant execute on function public.ap_cash(text, jsonb) to authenticated;

create or replace function public.ap_quotes(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; s public.o2c_settings%rowtype; q public.quotes%rowtype; v_until date; v_reason text; r public.quote_validity_requests%rowtype; v_page integer; v_total bigint; v_rows jsonb;
  v_id uuid; v_today date := private.ist_today();
begin
  select * into c from private.ap_ctx(private.ap3_sales_roles());
  s := private.ap3_settings(c.company_id);
  if p_command = 'validity' then
    perform private.ap_keys(p_payload, array['quote_id']);
    select * into q from public.quotes where id = private.ap_uuid(p_payload, 'quote_id') and company_id = c.company_id and deleted_at is null;
    if q.id is null then raise exception 'AP: Quotation not found.'; end if;
    select * into r from public.quote_validity_requests x where x.company_id = c.company_id and x.quote_id = q.id and x.status = 'pending';
    return jsonb_build_object('quote_id', q.id, 'status', q.status, 'valid_until', q.valid_until, 'quote_date', q.quote_date, 'revision_number', q.revision_number,
      'days_left', case when q.valid_until is not null then q.valid_until - v_today end,
      'lapsed', q.status = 'expired' or (q.valid_until is not null and q.valid_until < v_today and q.status in ('sent', 'approved_for_sending', 'customer_approved')),
      'pending_request', case when r.id is not null then jsonb_build_object('id', r.id, 'requested_valid_until', r.requested_valid_until, 'reason', r.reason,
        'requested_by', (select u.full_name from public.app_users u where u.id = r.requested_by), 'requested_at', r.requested_at,
        'can_decide', c.role = any(s.quote_extension_roles) and r.requested_by <> c.actor_id) end,
      'can_extend', q.status in ('sent', 'expired', 'customer_approved', 'approved_for_sending') and r.id is null,
      'extension_needs_approval', s.quote_extension_needs_approval and not (c.role = any(s.quote_extension_roles)),
      'can_requote', c.role in ('owner', 'admin') and q.status <> 'converted_to_order'
        and (q.status = 'expired' or (q.valid_until is not null and q.valid_until < v_today and q.status in ('sent', 'approved_for_sending', 'customer_approved'))),
      'events', coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'old_valid_until', e.old_valid_until, 'new_valid_until', e.new_valid_until, 'revision_number', e.revision_number,
          'reason', e.reason, 'actor', (select u.full_name from public.app_users u where u.id = e.actor_id), 'created_at', e.created_at) order by e.created_at desc)
        from (select * from public.quote_validity_events y where y.company_id = c.company_id and y.quote_id = q.id order by y.created_at desc limit 10) e), '[]'::jsonb));
  elsif p_command = 'extend' then
    perform private.ap_keys(p_payload, array['quote_id', 'valid_until', 'reason']);
    select * into q from public.quotes where id = private.ap_uuid(p_payload, 'quote_id') and company_id = c.company_id and deleted_at is null for update;
    if q.id is null then raise exception 'AP: Quotation not found.'; end if;
    begin v_until := (p_payload ->> 'valid_until')::date; exception when others then v_until := null; end;
    if v_until is null or v_until < v_today or v_until > v_today + 180 then raise exception 'AP: Choose a new validity date from today up to 180 days ahead.'; end if;
    if q.valid_until is not null and v_until <= q.valid_until then raise exception 'AP: The new date must be after the current validity (%).', to_char(q.valid_until, 'DD Mon YYYY'); end if;
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 10, 500);
    if q.status not in ('sent', 'expired', 'customer_approved', 'approved_for_sending') then raise exception 'AP: Only a sent, approved or expired quotation can be extended.'; end if;
    if s.quote_extension_needs_approval and not (c.role = any(s.quote_extension_roles)) then
      begin
        insert into public.quote_validity_requests(company_id, quote_id, requested_valid_until, reason, requested_by)
          values (c.company_id, q.id, v_until, v_reason, c.actor_id) returning id into v_id;
      exception when unique_violation then raise exception 'AP: An extension request for this quotation is already waiting.'; end;
      insert into public.quote_validity_events(company_id, quote_id, event, old_valid_until, new_valid_until, revision_number, reason, actor_id)
        values (c.company_id, q.id, 'extension_requested', q.valid_until, v_until, q.revision_number, v_reason, c.actor_id);
      perform private.ap3_notify_roles(c.company_id, s.quote_extension_roles, 'quote_validity_request', 'warning', 'Validity extension requested: ' || coalesce(q.quote_number, ''),
        c.full_name || ' asks to extend to ' || to_char(v_until, 'DD Mon YYYY') || ': ' || v_reason, 'quote', q.id, '/quotes/' || q.id || '#validity', 'quote-extension:' || v_id, c.actor_id);
      return jsonb_build_object('state', 'requested', 'request_id', v_id);
    end if;
    return private.ap3_apply_extension(c.company_id, c.actor_id, q.id, v_until, v_reason) || jsonb_build_object('state', 'extended');
  elsif p_command in ('decide_extension', 'withdraw_extension') then
    perform private.ap_keys(p_payload, array['request_id', 'decision', 'note']);
    select * into r from public.quote_validity_requests where id = private.ap_uuid(p_payload, 'request_id') and company_id = c.company_id for update;
    if r.id is null or r.status <> 'pending' then raise exception 'AP: This request is not waiting.'; end if;
    if p_command = 'withdraw_extension' then
      if r.requested_by <> c.actor_id then raise exception 'AP: Only the requester can withdraw it.'; end if;
      update public.quote_validity_requests set status = 'withdrawn' where id = r.id;
      return jsonb_build_object('state', 'withdrawn');
    end if;
    if not (c.role = any(s.quote_extension_roles)) then raise exception 'AP: Your role does not approve validity extensions.'; end if;
    if r.requested_by = c.actor_id then raise exception 'AP: Another person must approve an extension you requested.'; end if;
    if coalesce(p_payload ->> 'decision', '') not in ('approve', 'reject') then raise exception 'AP: Choose approve or reject.'; end if;
    v_reason := private.ap_text(p_payload ->> 'note', 'Note', 3, 300, p_payload ->> 'decision' = 'reject');
    update public.quote_validity_requests set status = case when p_payload ->> 'decision' = 'approve' then 'approved' else 'rejected' end, decided_by = c.actor_id,
      decided_at = clock_timestamp(), decision_note = v_reason where id = r.id;
    if p_payload ->> 'decision' = 'approve' then
      perform private.ap3_apply_extension(c.company_id, c.actor_id, r.quote_id, greatest(r.requested_valid_until, v_today), r.reason || coalesce(' (approved: ' || v_reason || ')', ' (approved)'));
    else
      insert into public.quote_validity_events(company_id, quote_id, event, reason, actor_id) values (c.company_id, r.quote_id, 'extension_rejected', v_reason, c.actor_id);
    end if;
    update public.notifications set resolved_at = clock_timestamp(), resolution = 'Decided by ' || c.full_name, is_read = true, read_at = coalesce(read_at, now())
      where company_id = c.company_id and condition_key = 'quote-extension:' || r.id and resolved_at is null;
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, action_link, created_by)
      values (c.company_id, r.requested_by, 'quote_validity_decided', case when p_payload ->> 'decision' = 'approve' then 'success' else 'warning' end,
        'Validity extension ' || case when p_payload ->> 'decision' = 'approve' then 'approved' else 'rejected' end, coalesce(v_reason, 'Approved by ' || c.full_name),
        'quote', r.quote_id, '/quotes/' || r.quote_id || '#validity', c.actor_id);
    return jsonb_build_object('state', case when p_payload ->> 'decision' = 'approve' then 'approved' else 'rejected' end);
  elsif p_command = 'requote' then
    perform private.ap_keys(p_payload, array['quote_id', 'reason']);
    return private.ap3_requote(c.company_id, c.actor_id, c.role, private.ap_uuid(p_payload, 'quote_id'), p_payload ->> 'reason');
  elsif p_command = 'requests' then
    perform private.ap_keys(p_payload, array['page']);
    v_page := private.ap3_page(p_payload);
    select count(*) into v_total from public.quote_validity_requests x where x.company_id = c.company_id and x.status = 'pending';
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'quote_id', x.quote_id, 'quote_number', q2.quote_number, 'customer', private.ap3_customer_name(q2.customer_id),
        'valid_until', q2.valid_until, 'requested_valid_until', x.requested_valid_until, 'reason', x.reason, 'requested_at', x.requested_at,
        'requested_by', (select u.full_name from public.app_users u where u.id = x.requested_by), 'can_decide', c.role = any(s.quote_extension_roles) and x.requested_by <> c.actor_id)
        order by x.requested_at), '[]'::jsonb) into v_rows
      from (select * from public.quote_validity_requests y where y.company_id = c.company_id and y.status = 'pending' order by y.requested_at limit 10 offset (v_page - 1) * 10) x
      join public.quotes q2 on q2.id = x.quote_id;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows);
  elsif p_command = 'lapsed' then
    perform private.ap_keys(p_payload, array['page']);
    v_page := private.ap3_page(p_payload);
    select count(*) into v_total from public.quotes x where x.company_id = c.company_id and x.deleted_at is null
      and (x.status = 'expired' or (x.status in ('sent', 'approved_for_sending', 'customer_approved') and x.valid_until < v_today));
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'quote_number', x.quote_number, 'customer', private.ap3_customer_name(x.customer_id), 'status', x.status, 'valid_until', x.valid_until,
        'grand_total', x.grand_total) order by x.valid_until desc), '[]'::jsonb) into v_rows
      from (select * from public.quotes x where x.company_id = c.company_id and x.deleted_at is null
        and (x.status = 'expired' or (x.status in ('sent', 'approved_for_sending', 'customer_approved') and x.valid_until < v_today))
        order by x.valid_until desc, x.id limit 10 offset (v_page - 1) * 10) x;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_quotes(text, jsonb) from public, anon;
grant execute on function public.ap_quotes(text, jsonb) to authenticated;

create or replace function public.ap_dupes(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer; v_total bigint; v_rows jsonb; v_kind text; s public.o2c_settings%rowtype; v_out jsonb := '[]'::jsonb;
begin
  select * into c from private.ap_ctx(null);
  if p_command = 'check' then
    v_kind := p_payload ->> 'kind';
    if v_kind not in ('quote', 'order', 'receipt', 'dispatch') then raise exception 'AP: Unknown record type.'; end if;
    return jsonb_build_object('matches', private.ap3_duplicates(c.company_id, v_kind, p_payload - 'kind'));
  elsif p_command = 'acknowledge' then
    perform private.ap_keys(p_payload, array['kind', 'matches', 'decision', 'note']);
    if (p_payload ->> 'kind') not in ('quote', 'order', 'receipt', 'dispatch') or (p_payload ->> 'decision') not in ('saved_anyway', 'opened_existing')
      or jsonb_typeof(p_payload -> 'matches') <> 'array' or jsonb_array_length(p_payload -> 'matches') not between 1 and 10 then raise exception 'AP: Invalid request.'; end if;
    insert into public.duplicate_warnings(company_id, kind, matches, decision, note, actor_id)
      values (c.company_id, p_payload ->> 'kind', p_payload -> 'matches', p_payload ->> 'decision', private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id);
    return jsonb_build_object('logged', true);
  end if;
  if c.role not in ('owner', 'admin', 'accounts', 'sales_manager', 'factory_manager', 'production_manager', 'sales') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if p_command = 'attention' then
    perform private.ap_keys(p_payload, array[]::text[]);
    s := private.ap3_settings(c.company_id);
    if c.role = any(s.credit_approver_roles) then
      v_out := v_out || jsonb_build_object('key', 'credit_holds', 'label', 'Orders on credit hold to decide', 'href', '/orders/credit',
        'count', (select count(*) from public.order_credit_holds h where h.company_id = c.company_id and h.status = 'held' and h.requested_by is distinct from c.actor_id));
    end if;
    if c.role = any(private.ap3_accounts_roles()) then
      v_out := v_out || jsonb_build_object('key', 'invoice_drafts', 'label', 'Invoice drafts to post', 'href', '/invoices/drafts',
          'count', (select count(*) from public.invoice_drafts f where f.company_id = c.company_id and f.status in ('open', 'blocked')))
        || jsonb_build_object('key', 'bank_lines', 'label', 'Bank credits to confirm', 'href', '/payments/bank',
          'count', (select count(*) from public.bank_statement_lines l where l.company_id = c.company_id and l.direction = 'credit' and l.state in ('unmatched', 'proposed')))
        || jsonb_build_object('key', 'reminders', 'label', 'Payment reminders to send', 'href', '/payments/reminders',
          'count', (select count(*) from public.payment_reminders r where r.company_id = c.company_id and r.status = 'prepared' and r.reminder_date = private.ist_today()));
    end if;
    if c.role = any(private.ap3_planner_roles()) then
      v_out := v_out || jsonb_build_object('key', 'draft_jobs', 'label', 'Draft jobs to release', 'href', '/production/drafts',
        'count', (select count(*) from public.production_job_draft_lines l where l.company_id = c.company_id and l.status = 'open'));
    end if;
    if c.role = any(s.quote_extension_roles) then
      v_out := v_out || jsonb_build_object('key', 'quote_extensions', 'label', 'Quotation validity extensions to decide', 'href', '/quotes',
        'count', (select count(*) from public.quote_validity_requests r where r.company_id = c.company_id and r.status = 'pending' and r.requested_by <> c.actor_id));
    end if;
    if c.role = any(private.ap3_sales_roles()) then
      v_out := v_out || jsonb_build_object('key', 'quotes_lapsed', 'label', 'Lapsed quotations to requote or extend', 'href', '/quotes',
        'count', (select count(*) from public.quotes q where q.company_id = c.company_id and q.deleted_at is null and q.created_by = c.actor_id and q.status = 'expired'));
    end if;
    return jsonb_build_object('items', v_out);
  elsif p_command = 'log' then
    perform private.ap_keys(p_payload, array['page', 'kind']);
    v_page := private.ap3_page(p_payload);
    select count(*) into v_total from public.duplicate_warnings w where w.company_id = c.company_id and (p_payload ->> 'kind' is null or w.kind = p_payload ->> 'kind');
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'kind', w.kind, 'matches', w.matches, 'decision', w.decision, 'note', w.note, 'created_at', w.created_at,
        'actor', (select u.full_name from public.app_users u where u.id = w.actor_id)) order by w.created_at desc), '[]'::jsonb) into v_rows
      from (select * from public.duplicate_warnings w where w.company_id = c.company_id and (p_payload ->> 'kind' is null or w.kind = p_payload ->> 'kind')
        order by w.created_at desc limit 10 offset (v_page - 1) * 10) w;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows);
  elsif p_command = 'scan' then
    perform private.ap_keys(p_payload, array['page', 'kind']);
    v_page := private.ap3_page(p_payload); v_kind := coalesce(p_payload ->> 'kind', 'order');
    if v_kind = 'order' then
      with pairs as (
        select a.id a_id, a.order_number a_no, b.id b_id, b.order_number b_no, a.customer_id, a.order_value, b.created_at
        from public.orders a join public.orders b on b.company_id = a.company_id and b.customer_id = a.customer_id and b.id <> a.id and b.created_at > a.created_at
          and b.created_at - a.created_at <= interval '3 days' and abs(coalesce(a.order_value, 0) - coalesce(b.order_value, 0)) <= greatest(1, coalesce(a.order_value, 0) * 0.005)
        where a.company_id = c.company_id and a.deleted_at is null and b.deleted_at is null and a.current_stage <> 'cancelled' and b.current_stage <> 'cancelled'
          and a.created_at > now() - interval '90 days' and a.opening_cutover_id is null and b.opening_cutover_id is null)
      select (select count(*) from pairs), (select coalesce(jsonb_agg(jsonb_build_object('first_id', p.a_id, 'first', p.a_no, 'second_id', p.b_id, 'second', p.b_no,
          'customer', private.ap3_customer_name(p.customer_id), 'value', p.order_value, 'second_created_at', p.created_at) order by p.created_at desc), '[]'::jsonb)
        from (select * from pairs order by created_at desc limit 10 offset (v_page - 1) * 10) p) into v_total, v_rows;
    elsif v_kind = 'receipt' then
      with pairs as (
        select a.id a_id, a.reference_number a_ref, b.id b_id, b.reference_number b_ref, a.received_amount, b.created_at, b.payment_date
        from public.financial_receipt_events a join public.financial_receipt_events b on b.company_id = a.company_id and b.id <> a.id and b.created_at > a.created_at
          and a.received_amount = b.received_amount and abs(a.payment_date - b.payment_date) <= 3
          and exists (select 1 from public.financial_receipt_allocations x join public.invoices i on i.id = x.invoice_id
            join public.financial_receipt_allocations y on y.receipt_event_id = b.id join public.invoices j on j.id = y.invoice_id
            where x.receipt_event_id = a.id and i.customer_id = j.customer_id)
        where a.company_id = c.company_id and a.status <> 'reversed' and b.status <> 'reversed' and a.created_at > now() - interval '90 days')
      select (select count(*) from pairs), (select coalesce(jsonb_agg(jsonb_build_object('first_id', p.a_id, 'first', p.a_ref, 'second_id', p.b_id, 'second', p.b_ref,
          'amount', p.received_amount, 'payment_date', p.payment_date, 'second_created_at', p.created_at) order by p.created_at desc), '[]'::jsonb)
        from (select * from pairs order by created_at desc limit 10 offset (v_page - 1) * 10) p) into v_total, v_rows;
    else
      raise exception 'AP: Invalid filter.';
    end if;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows, 'kind', v_kind);
  elsif p_command = 'alerts' then
    perform private.ap_keys(p_payload, array['page']);
    v_page := private.ap3_page(p_payload);
    select count(*) into v_total from public.alert_resolutions a where a.company_id = c.company_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'source_kind', a.source_kind, 'source_id', a.source_id, 'condition_key', a.condition_key, 'outcome', a.outcome, 'note', a.note,
        'trigger_source', a.trigger_source, 'resolved_at', a.resolved_at,
        'title', case a.source_kind when 'task' then (select t.title from public.tasks t where t.id = a.source_id) when 'notification' then (select n.title from public.notifications n where n.id = a.source_id)
          else (select 'Credit hold on ' || o.order_number from public.order_credit_holds h join public.orders o on o.id = h.order_id where h.id = a.source_id) end) order by a.resolved_at desc), '[]'::jsonb) into v_rows
      from (select * from public.alert_resolutions a where a.company_id = c.company_id order by a.resolved_at desc limit 10 offset (v_page - 1) * 10) a;
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', v_rows,
      'open_alerts', (select count(*) from public.notifications n where n.company_id = c.company_id and n.resolved_at is null and not n.is_read));
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_dupes(text, jsonb) from public, anon;
grant execute on function public.ap_dupes(text, jsonb) to authenticated;

commit;
