-- Foundry scrap receiving (Omalco): scrap requests, a guided three-step receipt and the accounts completion.
--
-- * Scrap types are a company list (wire, extrusion, local extrusion and sheet with or without attachments,
--   imported ...). Receivers add a type from the receipt or request screen; owner, admin and the factory manager
--   can switch one off.
-- * The foundry manager requests scrap (type, alloy, kg) and receives it in three steps: presence at the site (or a
--   named person receiving on their behalf), visual verification with weighbridge weight and photos, then the
--   material details. Nothing is recorded if the receiver leaves at step 1. After step 1 the receipt cannot be
--   abandoned: every exit attempt is counted, the fifth asks for a reason and alerts the factory manager, and only
--   the factory manager can let the receiver leave, with their own reason.
-- * A completed receipt creates the accepted scrap lot (and a rejected lot when part or all of it failed the
--   inspection) without any money, then alerts accounts. Accounts enter the vendor, bill, rate, tax, freight and
--   discount and upload the bill; the existing source-expense trigger posts the expense from those values.
-- * Purchase rate, bill and vendor columns on scrap lots and external aluminium sources are now written only by
--   owner, admin and accounts. New external sources are queued for accounts in the same way.
--
-- Additive: new tables carry company_id with RLS and are read and written only through public.ap_scrap_receipt,
-- which takes the company and the actor from the session. The incoming-scrap vendor rule is relaxed only for lots
-- that come from a receipt (accounts add the vendor later). Messages meant for people start with 'AP: '.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.foundry_scrap_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]{2,48}$'),
  name text not null check (length(btrim(name)) between 2 and 80),
  is_active boolean not null default true,
  sort_order integer not null default 100 check (sort_order between 0 and 10000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint foundry_scrap_types_company_code_unique unique (company_id, code)
);
create unique index if not exists foundry_scrap_types_company_name_unique on public.foundry_scrap_types(company_id, lower(btrim(name)));

create table if not exists public.foundry_scrap_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_number text not null,
  scrap_type_id uuid not null references public.foundry_scrap_types(id),
  alloy text not null check (length(btrim(alloy)) between 2 and 20),
  quantity_kg numeric(14,3) not null check (quantity_kg > 0 and quantity_kg <= 1000000),
  required_by date,
  purpose text check (purpose is null or length(purpose) <= 300),
  status text not null default 'open' check (status in ('open', 'fulfilled', 'cancelled')),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  close_reason text check (close_reason is null or length(close_reason) <= 300),
  updated_at timestamptz not null default now(),
  constraint foundry_scrap_requests_company_number_unique unique (company_id, request_number)
);
create index if not exists foundry_scrap_requests_company_status_idx on public.foundry_scrap_requests(company_id, status, requested_at desc);
create index if not exists foundry_scrap_requests_type_idx on public.foundry_scrap_requests(scrap_type_id);

create table if not exists public.foundry_scrap_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  receipt_number text not null,
  request_id uuid references public.foundry_scrap_requests(id),
  status text not null default 'inspection' check (status in ('inspection', 'details', 'completed', 'exited')),
  started_by uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  -- Step 1: presence at the receiving site.
  receiver_present boolean not null,
  proxy_name text check (proxy_name is null or length(proxy_name) between 2 and 80),
  proxy_phone text check (proxy_phone is null or proxy_phone ~ '^\+91[6-9][0-9]{9}$'),
  proxy_reason text check (proxy_reason is null or length(proxy_reason) between 10 and 300),
  -- Step 2: visual verification and weighbridge weight.
  vehicle_number text check (vehicle_number is null or length(vehicle_number) between 4 and 20),
  challan_number text check (challan_number is null or length(challan_number) <= 40),
  weighbridge_reference text check (weighbridge_reference is null or length(weighbridge_reference) between 1 and 60),
  gross_kg numeric(14,3) check (gross_kg is null or gross_kg > 0),
  tare_kg numeric(14,3) check (tare_kg is null or tare_kg >= 0),
  net_kg numeric(14,3) check (net_kg is null or net_kg > 0),
  quality_ok boolean,
  checklist jsonb not null default '{}'::jsonb,
  issues text[] not null default '{}',
  rejection_scope text check (rejection_scope is null or rejection_scope in ('all', 'partial')),
  rejected_kg numeric(14,3) check (rejected_kg is null or rejected_kg >= 0),
  rejection_reason text check (rejection_reason is null or length(rejection_reason) between 15 and 600),
  inspection_notes text check (inspection_notes is null or length(inspection_notes) <= 600),
  inspected_at timestamptz,
  -- Step 3: material details (no money).
  scrap_type_id uuid references public.foundry_scrap_types(id),
  alloy text check (alloy is null or length(alloy) between 2 and 20),
  readiness text check (readiness is null or readiness in ('ready_to_use', 'needs_processing')),
  processing_steps text[] not null default '{}',
  scrap_quality text check (scrap_quality is null or scrap_quality in ('clean', 'painted', 'mixed', 'contaminated', 'segregation_required')),
  detail_notes text check (detail_notes is null or length(detail_notes) <= 600),
  accepted_kg numeric(14,3) check (accepted_kg is null or accepted_kg >= 0),
  accepted_scrap_id uuid references public.foundry_aluminium_scrap(id),
  rejected_scrap_id uuid references public.foundry_aluminium_scrap(id),
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  -- Exit attempts after step 1 and the factory manager's decision.
  abort_attempts integer not null default 0 check (abort_attempts >= 0),
  escalated_at timestamptz,
  exit_requested_at timestamptz,
  exit_request_reason text check (exit_request_reason is null or length(exit_request_reason) between 10 and 300),
  exit_decision text check (exit_decision is null or exit_decision in ('approved', 'declined')),
  exit_decided_by uuid references auth.users(id),
  exit_decided_at timestamptz,
  exit_decision_reason text check (exit_decision_reason is null or length(exit_decision_reason) between 10 and 300),
  -- Accounts completion.
  finance_status text not null default 'not_ready' check (finance_status in ('not_ready', 'pending', 'completed')),
  vendor_id uuid references public.vendors(id),
  invoice_number text check (invoice_number is null or length(invoice_number) between 1 and 40),
  invoice_date date,
  due_date date,
  rate_per_kg numeric(14,2) check (rate_per_kg is null or rate_per_kg >= 0),
  tax_amount numeric(14,2) check (tax_amount is null or tax_amount >= 0),
  freight_amount numeric(14,2) check (freight_amount is null or freight_amount >= 0),
  discount_amount numeric(14,2) check (discount_amount is null or discount_amount >= 0),
  payment_method text check (payment_method is null or length(payment_method) <= 40),
  finance_notes text check (finance_notes is null or length(finance_notes) <= 600),
  finance_completed_by uuid references auth.users(id),
  finance_completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint foundry_scrap_receipts_company_number_unique unique (company_id, receipt_number),
  constraint foundry_scrap_receipts_proxy_complete check (receiver_present or (proxy_name is not null and proxy_phone is not null and proxy_reason is not null)),
  constraint foundry_scrap_receipts_net_weight check (net_kg is null or (gross_kg is not null and tare_kg is not null and net_kg = gross_kg - tare_kg)),
  constraint foundry_scrap_receipts_rejected_within_net check (rejected_kg is null or net_kg is null or rejected_kg <= net_kg),
  constraint foundry_scrap_receipts_completed_details check (status <> 'completed' or (scrap_type_id is not null and alloy is not null and readiness is not null and accepted_kg is not null)),
  constraint foundry_scrap_receipts_exit_reasons check (status <> 'exited' or (exit_request_reason is not null and exit_decision = 'approved' and exit_decision_reason is not null))
);
-- One receipt in progress per person, so an unfinished receipt cannot be dropped by starting another one.
create unique index if not exists foundry_scrap_receipts_one_open_per_user on public.foundry_scrap_receipts(company_id, started_by) where status in ('inspection', 'details');
create index if not exists foundry_scrap_receipts_company_status_idx on public.foundry_scrap_receipts(company_id, status, started_at desc);
create index if not exists foundry_scrap_receipts_finance_idx on public.foundry_scrap_receipts(company_id, finance_status, completed_at desc);
create index if not exists foundry_scrap_receipts_request_idx on public.foundry_scrap_receipts(request_id);
create index if not exists foundry_scrap_receipts_type_idx on public.foundry_scrap_receipts(scrap_type_id);
create index if not exists foundry_scrap_receipts_vendor_idx on public.foundry_scrap_receipts(vendor_id);
create index if not exists foundry_scrap_receipts_accepted_idx on public.foundry_scrap_receipts(accepted_scrap_id);
create index if not exists foundry_scrap_receipts_rejected_idx on public.foundry_scrap_receipts(rejected_scrap_id);

create table if not exists public.foundry_metal_receipt_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  receipt_id uuid references public.foundry_scrap_receipts(id),
  external_source_id uuid references public.foundry_external_aluminium_sources(id),
  kind text not null check (kind in ('inspection_photo', 'rejection_photo', 'weighbridge_slip', 'bill', 'eway_bill', 'supporting')),
  storage_path text not null check (length(storage_path) between 10 and 400),
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes bigint check (size_bytes is null or (size_bytes > 0 and size_bytes <= 10485760)),
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now(),
  constraint foundry_metal_receipt_files_one_parent check ((receipt_id is null) <> (external_source_id is null)),
  constraint foundry_metal_receipt_files_path_unique unique (company_id, storage_path)
);
create index if not exists foundry_metal_receipt_files_receipt_idx on public.foundry_metal_receipt_files(receipt_id);
create index if not exists foundry_metal_receipt_files_source_idx on public.foundry_metal_receipt_files(external_source_id);
create index if not exists foundry_metal_receipt_files_company_idx on public.foundry_metal_receipt_files(company_id, uploaded_at desc);

alter table public.foundry_aluminium_scrap add column if not exists scrap_receipt_id uuid references public.foundry_scrap_receipts(id);
alter table public.foundry_aluminium_scrap add column if not exists scrap_type_id uuid references public.foundry_scrap_types(id);
create index if not exists foundry_aluminium_scrap_receipt_idx on public.foundry_aluminium_scrap(scrap_receipt_id);
create index if not exists foundry_aluminium_scrap_type_idx on public.foundry_aluminium_scrap(scrap_type_id);
alter table public.foundry_external_aluminium_sources add column if not exists finance_status text
  check (finance_status is null or finance_status in ('pending', 'completed'));
create index if not exists foundry_external_sources_finance_idx on public.foundry_external_aluminium_sources(company_id, finance_status) where finance_status = 'pending';

-- Incoming scrap from a receipt gets its vendor from accounts after the receipt.
alter table public.foundry_aluminium_scrap drop constraint if exists foundry_scrap_incoming_vendor_required;
alter table public.foundry_aluminium_scrap add constraint foundry_scrap_incoming_vendor_required
  check (scrap_source <> 'incoming' or vendor_id is not null or scrap_receipt_id is not null);

do $$
declare t text;
begin
  foreach t in array array['foundry_scrap_types', 'foundry_scrap_requests', 'foundry_scrap_receipts', 'foundry_metal_receipt_files'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Purchase money on metal sources belongs to accounts
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.guard_metal_source_finance()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_role text;
begin
  -- Nested writers (expense/inventory sync, production and casting scrap) and service jobs carry no client values.
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return new;
  end if;
  select u.role::text into v_role from public.app_users u where u.id = auth.uid() and u.is_active;
  if tg_op = 'INSERT' then
    if tg_table_name = 'foundry_external_aluminium_sources' then
      -- A source recorded without a bill value is queued for accounts.
      new.finance_status := case when coalesce(new.rate, 0) > 0 or coalesce(new.base_amount, 0) > 0 then 'completed' else 'pending' end;
    end if;
    if v_role in ('owner', 'admin', 'accounts') then
      return new;
    end if;
    if coalesce(new.rate, 0) <> 0 or coalesce(new.base_amount, 0) <> 0 or coalesce(new.tax_amount, 0) <> 0
      or coalesce(new.freight_amount, 0) <> 0 or coalesce(new.discount_amount, 0) <> 0
      or nullif(btrim(coalesce(new.invoice_number, '')), '') is not null or new.invoice_date is not null or new.due_date is not null
      or nullif(btrim(coalesce(new.payment_method, '')), '') is not null then
      raise exception 'AP: Purchase rate, bill and tax details are entered by accounts.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if v_role in ('owner', 'admin', 'accounts') then
    return new;
  end if;
  if (new.rate, new.base_amount, new.tax_amount, new.freight_amount, new.discount_amount, new.invoice_number, new.invoice_date, new.due_date, new.payment_method, new.vendor_id)
    is distinct from (old.rate, old.base_amount, old.tax_amount, old.freight_amount, old.discount_amount, old.invoice_number, old.invoice_date, old.due_date, old.payment_method, old.vendor_id) then
    raise exception 'AP: Vendor, purchase rate, bill and tax details are changed by accounts.' using errcode = 'P0001';
  end if;
  if tg_table_name = 'foundry_external_aluminium_sources' then
    if new.finance_status is distinct from old.finance_status then
      raise exception 'AP: The accounts status of a source is set by accounts.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_metal_source_finance() from public, anon, authenticated;

drop trigger if exists a_guard_metal_source_finance on public.foundry_aluminium_scrap;
create trigger a_guard_metal_source_finance before insert or update on public.foundry_aluminium_scrap
  for each row execute function private.guard_metal_source_finance();
drop trigger if exists a_guard_metal_source_finance on public.foundry_external_aluminium_sources;
create trigger a_guard_metal_source_finance before insert or update on public.foundry_external_aluminium_sources
  for each row execute function private.guard_metal_source_finance();

-- A new external source recorded on the floor is queued for accounts.
create or replace function private.notify_external_source_finance()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.finance_status = 'pending' then
    insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, related_entity_type, related_entity_id, condition_key, created_by)
    values (new.company_id, 'accounts', 'metal_receipt_finance', 'info', 'External aluminium received: add the bill',
      concat(new.source_number, ': ', to_char(new.weight_kg, 'FM999G999G990D000'), ' kg ', replace(new.item_type, '_', ' '),
        coalesce(' alloy ' || new.alloy, ''), '. Enter the vendor, bill, rate and tax and upload the bill.'),
      '/foundry/metal-finance', 'foundry_external_aluminium_sources', new.id, 'fsr:source:' || new.id, auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function private.notify_external_source_finance() from public, anon, authenticated;
drop trigger if exists z_notify_external_source_finance on public.foundry_external_aluminium_sources;
create trigger z_notify_external_source_finance after insert on public.foundry_external_aluminium_sources
  for each row execute function private.notify_external_source_finance();

-- ---------------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.fsr_default_types()
returns table(code text, name text, sort_order integer)
language sql immutable set search_path = public, private as $$
  values ('wire', 'Wire scrap', 10), ('extrusion', 'Extrusion scrap', 20),
    ('local_extrusion_with_attachments', 'Local extrusion scrap (with attachments)', 30),
    ('local_extrusion_without_attachments', 'Local extrusion scrap (without attachments)', 40),
    ('local_sheet_with_attachments', 'Local sheet scrap (with attachments)', 50),
    ('local_sheet_without_attachments', 'Local sheet scrap (without attachments)', 60),
    ('imported', 'Imported scrap', 70)
$$;
revoke all on function private.fsr_default_types() from public, anon, authenticated;

create or replace function private.fsr_seed_types(p_company uuid)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from public.foundry_scrap_types t where t.company_id = p_company) then
    insert into public.foundry_scrap_types(company_id, code, name, sort_order)
    select p_company, d.code, d.name, d.sort_order from private.fsr_default_types() d
    on conflict do nothing;
  end if;
end;
$$;
revoke all on function private.fsr_seed_types(uuid) from public, anon, authenticated;

select private.fsr_seed_types(c.id) from public.companies c;

create or replace function private.fsr_num(p_payload jsonb, p_key text, p_label text, p_min numeric, p_max numeric, p_required boolean default true)
returns numeric language plpgsql immutable set search_path = public, private as $$
declare v jsonb := p_payload -> p_key; n numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_required then raise exception 'AP: % is required.', p_label; end if;
    return null;
  end if;
  if jsonb_typeof(v) <> 'number' then raise exception 'AP: % must be a number.', p_label; end if;
  n := (v #>> '{}')::numeric;
  if n < p_min or n > p_max then raise exception 'AP: % must be between % and %.', p_label, p_min, p_max; end if;
  return n;
end;
$$;
revoke all on function private.fsr_num(jsonb, text, text, numeric, numeric, boolean) from public, anon, authenticated;

create or replace function private.fsr_day(p_payload jsonb, p_key text, p_label text, p_required boolean default false)
returns date language plpgsql immutable set search_path = public, private as $$
declare v text := nullif(btrim(coalesce(p_payload ->> p_key, '')), '');
begin
  if v is null then
    if p_required then raise exception 'AP: % is required.', p_label; end if;
    return null;
  end if;
  if v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'AP: % must be a date.', p_label; end if;
  return v::date;
end;
$$;
revoke all on function private.fsr_day(jsonb, text, text, boolean) from public, anon, authenticated;

create or replace function private.fsr_text_array(p_payload jsonb, p_key text, p_allowed text[], p_label text)
returns text[] language plpgsql immutable set search_path = public, private as $$
declare v jsonb := coalesce(p_payload -> p_key, '[]'::jsonb); out text[];
begin
  if jsonb_typeof(v) <> 'array' then raise exception 'AP: Invalid %.', p_label; end if;
  select coalesce(array_agg(distinct x), '{}') into out from jsonb_array_elements_text(v) x;
  if exists (select 1 from unnest(out) x where not (x = any(p_allowed))) then raise exception 'AP: Invalid %.', p_label; end if;
  return out;
end;
$$;
revoke all on function private.fsr_text_array(jsonb, text, text[], text) from public, anon, authenticated;

create or replace function private.fsr_name(p_user uuid)
returns text language sql stable security definer set search_path = public, private as $$
  select coalesce(nullif(btrim(u.full_name), ''), u.email, 'Employee') from public.app_users u where u.id = p_user
$$;
revoke all on function private.fsr_name(uuid) from public, anon, authenticated;

create or replace function private.fsr_files(p_company uuid, p_receipt uuid, p_source uuid, p_finance boolean)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'storage_path', f.storage_path, 'file_name', f.file_name,
    'mime_type', f.mime_type, 'uploaded_by', private.fsr_name(f.uploaded_by), 'uploaded_at', f.uploaded_at) order by f.uploaded_at), '[]'::jsonb)
  from public.foundry_metal_receipt_files f
  where f.company_id = p_company
    and ((p_receipt is not null and f.receipt_id = p_receipt) or (p_source is not null and f.external_source_id = p_source))
    and (p_finance or f.kind in ('inspection_photo', 'rejection_photo', 'weighbridge_slip'))
$$;
revoke all on function private.fsr_files(uuid, uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Gateway
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.ap_scrap_receipt(p_command text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  c record;
  v_receivers constant text[] := array['owner', 'admin', 'production_manager', 'production', 'factory_manager'];
  v_finance constant text[] := array['owner', 'admin', 'accounts'];
  v_readers constant text[] := array['owner', 'admin', 'production_manager', 'production', 'factory_manager', 'accounts'];
  v_issue_keys constant text[] := array['moisture_oil', 'paint_coating', 'iron_steel', 'plastic_rubber_wood', 'mixed_alloy', 'dirt_sand', 'oxidation', 'sealed_containers', 'wrong_type', 'other'];
  v_check_keys constant text[] := array['matches_type', 'dry', 'no_iron_steel', 'no_plastic_rubber_wood', 'no_sealed_containers', 'single_alloy', 'clean_surface'];
  v_steps constant text[] := array['sorting', 'removing_attachments', 'cleaning', 'de_coating', 'cutting', 'baling', 'drying'];
  v_kinds_floor constant text[] := array['inspection_photo', 'rejection_photo', 'weighbridge_slip'];
  v_kinds_finance constant text[] := array['bill', 'eway_bill', 'supporting'];
  p jsonb := coalesce(p_payload, '{}'::jsonb);
  r public.foundry_scrap_receipts%rowtype;
  q public.foundry_scrap_requests%rowtype;
  v_id uuid; v_type uuid; v_text text; v_name text; v_code text; v_phone text; v_number text;
  v_page integer; v_total integer; v_rows jsonb; v_status text; v_search text;
  v_gross numeric; v_tare numeric; v_net numeric; v_rejected numeric; v_accepted numeric; v_max numeric; v_threshold numeric;
  v_ok boolean; v_scope text; v_checklist jsonb := '{}'::jsonb; v_key text; v_issues text[]; v_kind text; v_path text;
  v_lot uuid; v_rej_lot uuid; v_quality text; v_readiness text; v_alloy text; v_vendor uuid; v_rate numeric;
  v_tax numeric; v_freight numeric; v_discount numeric; v_invoice text; v_inv_date date; v_due date; v_method text; v_note text;
  v_today date := private.business_today();
  v_is_finance boolean;
begin
  if p_command in ('types', 'requests', 'receipts', 'get', 'current') then
    select * into c from private.ap_ctx(v_readers);
  elsif p_command in ('finance_save', 'finance_queue', 'source_finance_save', 'source_get') then
    select * into c from private.ap_ctx(v_finance);
  elsif p_command = 'add_file' then
    select * into c from private.ap_ctx(v_readers);
  elsif p_command = 'decide_exit' then
    select * into c from private.ap_ctx(array['factory_manager']);
  elsif p_command = 'set_type_active' then
    select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager']);
  else
    select * into c from private.ap_ctx(v_receivers);
  end if;
  v_is_finance := c.role = any(v_finance);

  -- ------------------------------------------------------------------ scrap types
  if p_command = 'types' then
    perform private.ap_keys(p, array['include_inactive']);
    perform private.fsr_seed_types(c.company_id);
    return jsonb_build_object('types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'is_active', t.is_active) order by t.sort_order, t.name)
      from public.foundry_scrap_types t where t.company_id = c.company_id and (t.is_active or coalesce((p ->> 'include_inactive')::boolean, false))), '[]'::jsonb));

  elsif p_command = 'add_type' then
    perform private.ap_keys(p, array['name']);
    v_name := private.ap_text(p ->> 'name', 'Scrap type name', 3, 80);
    v_code := left(trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), 48);
    if length(v_code) < 2 then raise exception 'AP: Use letters or digits in the scrap type name.'; end if;
    select t.id into v_id from public.foundry_scrap_types t where t.company_id = c.company_id and (t.code = v_code or lower(btrim(t.name)) = lower(v_name));
    if v_id is not null then
      update public.foundry_scrap_types set is_active = true, updated_at = now() where id = v_id and not is_active;
    else
      insert into public.foundry_scrap_types(company_id, code, name, sort_order, created_by)
      values (c.company_id, v_code, v_name, 500, c.actor_id) returning id into v_id;
      insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
      values (c.company_id, c.actor_id, 'foundry_scrap_type_added', 'foundry_scrap_types', v_id, jsonb_build_object('name', v_name));
    end if;
    return (select jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'is_active', t.is_active) from public.foundry_scrap_types t where t.id = v_id);

  elsif p_command = 'set_type_active' then
    perform private.ap_keys(p, array['id', 'is_active']);
    v_id := private.ap_uuid(p, 'id');
    if coalesce(jsonb_typeof(p -> 'is_active'), '') <> 'boolean' then raise exception 'AP: Choose active or inactive.'; end if;
    update public.foundry_scrap_types set is_active = (p ->> 'is_active')::boolean, updated_at = now()
      where id = v_id and company_id = c.company_id returning id into v_id;
    if v_id is null then raise exception 'AP: This scrap type was not found.'; end if;
    return jsonb_build_object('id', v_id, 'is_active', (p ->> 'is_active')::boolean);

  -- ------------------------------------------------------------------ scrap requests
  elsif p_command = 'request' then
    perform private.ap_keys(p, array['scrap_type_id', 'alloy', 'quantity_kg', 'required_by', 'purpose']);
    v_type := private.ap_uuid(p, 'scrap_type_id');
    if not exists (select 1 from public.foundry_scrap_types t where t.id = v_type and t.company_id = c.company_id and t.is_active) then
      raise exception 'AP: Choose an active scrap type.';
    end if;
    v_alloy := private.ap_text(p ->> 'alloy', 'Alloy', 2, 20);
    v_net := private.fsr_num(p, 'quantity_kg', 'Quantity (kg)', 1, 1000000);
    v_inv_date := private.fsr_day(p, 'required_by', 'Required by');
    if v_inv_date is not null and v_inv_date < v_today then raise exception 'AP: Required-by date cannot be in the past.'; end if;
    v_note := private.ap_text(p ->> 'purpose', 'Purpose', 3, 300, false);
    v_number := private.next_business_number_locked('public.foundry_scrap_requests'::regclass, 'request_number', c.company_id, 'SRQ', v_today);
    insert into public.foundry_scrap_requests(company_id, request_number, scrap_type_id, alloy, quantity_kg, required_by, purpose, requested_by)
    values (c.company_id, v_number, v_type, v_alloy, v_net, v_inv_date, v_note, c.actor_id) returning id into v_id;
    insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, related_entity_type, related_entity_id, condition_key, created_by)
    select c.company_id, x.role, 'scrap_request', 'info', 'Scrap requested by the foundry',
      concat(v_number, ': ', to_char(v_net, 'FM999G999G990D000'), ' kg ', (select t.name from public.foundry_scrap_types t where t.id = v_type), ', alloy ', v_alloy,
        coalesce(', needed by ' || to_char(v_inv_date, 'DD Mon YYYY'), ''), '. Requested by ', c.full_name, '.'),
      '/foundry/scrap/requests', 'foundry_scrap_requests', v_id, 'fsr:request:' || v_id || ':' || x.role, c.actor_id
    from unnest(array['accounts', 'factory_manager']) x(role);
    return jsonb_build_object('id', v_id, 'request_number', v_number);

  elsif p_command = 'cancel_request' then
    perform private.ap_keys(p, array['id', 'reason']);
    v_id := private.ap_uuid(p, 'id');
    v_note := private.ap_text(p ->> 'reason', 'Reason', 10, 300);
    select * into q from public.foundry_scrap_requests where id = v_id and company_id = c.company_id for update;
    if not found then raise exception 'AP: This request was not found.'; end if;
    if q.status <> 'open' then raise exception 'AP: Only an open request can be closed.'; end if;
    if q.requested_by <> c.actor_id and c.role not in ('owner', 'admin', 'factory_manager') then
      raise exception 'AP: Only the person who requested it or the factory manager can close this request.';
    end if;
    update public.foundry_scrap_requests set status = 'cancelled', closed_by = c.actor_id, closed_at = now(), close_reason = v_note, updated_at = now() where id = v_id;
    return jsonb_build_object('id', v_id, 'status', 'cancelled');

  elsif p_command = 'requests' then
    perform private.ap_keys(p, array['page', 'status']);
    v_page := greatest(coalesce((p ->> 'page')::integer, 1), 1);
    v_status := coalesce(nullif(p ->> 'status', ''), 'open');
    if v_status not in ('open', 'fulfilled', 'cancelled', 'all') then raise exception 'AP: Invalid status.'; end if;
    select count(*) into v_total from public.foundry_scrap_requests x where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status);
    select coalesce(jsonb_agg(row_data order by requested_at desc), '[]'::jsonb) into v_rows from (
      select x.requested_at, jsonb_build_object('id', x.id, 'request_number', x.request_number, 'scrap_type', t.name, 'scrap_type_id', x.scrap_type_id,
        'alloy', x.alloy, 'quantity_kg', x.quantity_kg, 'required_by', x.required_by, 'purpose', x.purpose, 'status', x.status,
        'requested_by', private.fsr_name(x.requested_by), 'requested_at', x.requested_at, 'close_reason', x.close_reason,
        'received_kg', coalesce((select sum(rc.accepted_kg) from public.foundry_scrap_receipts rc where rc.request_id = x.id and rc.status = 'completed'), 0),
        'can_close', x.status = 'open' and (x.requested_by = c.actor_id or c.role in ('owner', 'admin', 'factory_manager'))) row_data
      from public.foundry_scrap_requests x join public.foundry_scrap_types t on t.id = x.scrap_type_id
      where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status)
      order by x.requested_at desc limit 10 offset (v_page - 1) * 10) s;
    return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page);

  -- ------------------------------------------------------------------ receiving: step 1
  elsif p_command = 'current' then
    perform private.ap_keys(p, array[]::text[]);
    select x.id into v_id from public.foundry_scrap_receipts x where x.company_id = c.company_id and x.started_by = c.actor_id and x.status in ('inspection', 'details');
    return jsonb_build_object('id', v_id);

  elsif p_command = 'start' then
    perform private.ap_keys(p, array['request_id', 'present', 'proxy_name', 'proxy_phone', 'proxy_reason']);
    select x.receipt_number into v_number from public.foundry_scrap_receipts x where x.company_id = c.company_id and x.started_by = c.actor_id and x.status in ('inspection', 'details');
    if v_number is not null then raise exception 'AP: Receipt % is still in progress. Finish it before starting another one.', v_number; end if;
    if coalesce(jsonb_typeof(p -> 'present'), '') <> 'boolean' then raise exception 'AP: Say whether you are at the receiving site.'; end if;
    v_id := private.ap_uuid(p, 'request_id', false);
    if v_id is not null and not exists (select 1 from public.foundry_scrap_requests x where x.id = v_id and x.company_id = c.company_id and x.status = 'open') then
      raise exception 'AP: The scrap request is not open.';
    end if;
    if (p ->> 'present')::boolean then
      if coalesce(p ->> 'proxy_name', p ->> 'proxy_phone', p ->> 'proxy_reason') is not null then raise exception 'AP: Invalid request.'; end if;
    else
      v_name := private.ap_text(p ->> 'proxy_name', 'Name of the person receiving', 2, 80);
      v_phone := regexp_replace(coalesce(p ->> 'proxy_phone', ''), '[\s-]', '', 'g');
      if v_phone ~ '^(0|91)?[6-9][0-9]{9}$' then v_phone := '+91' || right(v_phone, 10); end if;
      if v_phone !~ '^\+91[6-9][0-9]{9}$' then raise exception 'AP: Enter a 10-digit Indian mobile number for the person receiving.'; end if;
      v_note := private.ap_text(p ->> 'proxy_reason', 'Reason you are not at the site', 10, 300);
    end if;
    v_number := private.next_business_number_locked('public.foundry_scrap_receipts'::regclass, 'receipt_number', c.company_id, 'SRC', v_today);
    insert into public.foundry_scrap_receipts(company_id, receipt_number, request_id, status, started_by, receiver_present, proxy_name, proxy_phone, proxy_reason)
    values (c.company_id, v_number, v_id, 'inspection', c.actor_id, (p ->> 'present')::boolean, v_name, case when v_name is not null then v_phone end, v_note)
    returning id into v_id;
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (c.company_id, c.actor_id, 'scrap_receipt_started', 'foundry_scrap_receipts', v_id,
      jsonb_build_object('receipt_number', v_number, 'present', (p ->> 'present')::boolean, 'proxy_name', v_name));
    return jsonb_build_object('id', v_id, 'receipt_number', v_number);

  -- ------------------------------------------------------------------ files (photos, weighbridge slip, bill)
  elsif p_command = 'add_file' then
    perform private.ap_keys(p, array['receipt_id', 'external_source_id', 'kind', 'storage_path', 'file_name', 'mime_type', 'size_bytes']);
    v_kind := p ->> 'kind';
    if v_kind is null or not (v_kind = any(v_kinds_floor || v_kinds_finance)) then raise exception 'AP: Invalid file kind.'; end if;
    v_id := private.ap_uuid(p, 'receipt_id', false);
    v_lot := private.ap_uuid(p, 'external_source_id', false);
    if (v_id is null) = (v_lot is null) then raise exception 'AP: Invalid request.'; end if;
    if v_kind = any(v_kinds_finance) and not v_is_finance then raise exception 'AP: Bills are uploaded by accounts.'; end if;
    if v_kind = any(v_kinds_floor) and v_lot is not null then raise exception 'AP: Invalid file kind.'; end if;
    if v_id is not null then
      select * into r from public.foundry_scrap_receipts where id = v_id and company_id = c.company_id for update;
      if not found then raise exception 'AP: This receipt was not found.'; end if;
      if v_kind = any(v_kinds_floor) then
        if r.status not in ('inspection', 'details') then raise exception 'AP: Photos are added while the scrap is being received.'; end if;
        if r.started_by <> c.actor_id then raise exception 'AP: Only the person receiving this scrap can add photos.'; end if;
      elsif r.status <> 'completed' then raise exception 'AP: The bill is added after the receipt is completed.';
      end if;
    elsif not exists (select 1 from public.foundry_external_aluminium_sources s where s.id = v_lot and s.company_id = c.company_id) then
      raise exception 'AP: This source was not found.';
    end if;
    v_path := p ->> 'storage_path';
    if v_path is null or v_path like '%..%' or v_path !~ '^[0-9a-f-]{36}/scrap-receipt(s|-bills)/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
      or split_part(v_path, '/', 1) <> c.company_id::text
      or split_part(v_path, '/', 2) <> (case when v_kind = any(v_kinds_finance) then 'scrap-receipt-bills' else 'scrap-receipts' end)
      or split_part(v_path, '/', 3) <> coalesce(v_id, v_lot)::text then
      raise exception 'AP: Upload the file again.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = v_path) then
      raise exception 'AP: The uploaded file was not found. Upload it again.';
    end if;
    if coalesce(p ->> 'mime_type', '') not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then raise exception 'AP: Upload a JPG, PNG, WEBP or PDF file.'; end if;
    if v_kind in ('inspection_photo', 'rejection_photo') and p ->> 'mime_type' = 'application/pdf' then raise exception 'AP: Inspection photos must be images.'; end if;
    insert into public.foundry_metal_receipt_files(company_id, receipt_id, external_source_id, kind, storage_path, file_name, mime_type, size_bytes, uploaded_by)
    values (c.company_id, v_id, v_lot, v_kind, v_path, private.ap_text(p ->> 'file_name', 'File name', 1, 200), p ->> 'mime_type',
      private.fsr_num(p, 'size_bytes', 'File size', 1, 10485760, false)::bigint, c.actor_id)
    on conflict (company_id, storage_path) do nothing
    returning id into v_type;
    return jsonb_build_object('id', v_type);

  -- ------------------------------------------------------------------ receiving: step 2
  elsif p_command = 'inspect' then
    perform private.ap_keys(p, array['receipt_id', 'vehicle_number', 'challan_number', 'weighbridge_reference', 'gross_kg', 'tare_kg', 'quality_ok',
      'checklist', 'issues', 'rejection_scope', 'rejected_kg', 'rejection_reason', 'notes']);
    v_id := private.ap_uuid(p, 'receipt_id');
    select * into r from public.foundry_scrap_receipts where id = v_id and company_id = c.company_id for update;
    if not found then raise exception 'AP: This receipt was not found.'; end if;
    if r.started_by <> c.actor_id then raise exception 'AP: Only the person receiving this scrap can record the inspection.'; end if;
    if r.status not in ('inspection', 'details') then raise exception 'AP: This receipt is already closed.'; end if;
    v_gross := private.fsr_num(p, 'gross_kg', 'Gross weight (kg)', 1, 200000);
    v_tare := private.fsr_num(p, 'tare_kg', 'Tare weight (kg)', 0, 200000);
    if v_gross <= v_tare then raise exception 'AP: Gross weight must be more than the tare weight.'; end if;
    v_net := v_gross - v_tare;
    select coalesce(s.metal_receipt_max_kg, 60000), coalesce(s.metal_receipt_weighbridge_threshold_kg, 10000) into v_max, v_threshold
      from public.company_settings s where s.company_id = c.company_id;
    if v_net > coalesce(v_max, 60000) then
      raise exception 'AP: Net weight % kg is more than the % kg allowed per receipt. Weigh and receive it as separate loads.', v_net, coalesce(v_max, 60000);
    end if;
    if coalesce(jsonb_typeof(p -> 'quality_ok'), '') <> 'boolean' then raise exception 'AP: Say whether the scrap is of the expected quality.'; end if;
    v_ok := (p ->> 'quality_ok')::boolean;
    if jsonb_typeof(coalesce(p -> 'checklist', '{}'::jsonb)) <> 'object' then raise exception 'AP: Invalid checklist.'; end if;
    foreach v_key in array v_check_keys loop
      if coalesce(jsonb_typeof(p -> 'checklist' -> v_key), '') <> 'boolean' then raise exception 'AP: Answer every visual check.'; end if;
      v_checklist := v_checklist || jsonb_build_object(v_key, (p -> 'checklist' ->> v_key)::boolean);
    end loop;
    if exists (select 1 from jsonb_object_keys(p -> 'checklist') k where not (k = any(v_check_keys))) then raise exception 'AP: Invalid checklist.'; end if;
    v_issues := private.fsr_text_array(p, 'issues', v_issue_keys, 'quality issue');
    if not exists (select 1 from public.foundry_metal_receipt_files f where f.receipt_id = v_id and f.kind = 'inspection_photo') then
      raise exception 'AP: Take and upload at least one photo of the scrap received.';
    end if;
    if v_ok then
      if p ? 'rejection_scope' or p ? 'rejected_kg' or p ? 'rejection_reason' then raise exception 'AP: Invalid request.'; end if;
      if (select bool_or(not (value::boolean)) from jsonb_each_text(v_checklist)) then
        raise exception 'AP: A visual check failed. Mark the scrap as not of quality and describe the problem.';
      end if;
      v_scope := null; v_rejected := 0; v_text := null; v_issues := '{}';
    else
      v_scope := p ->> 'rejection_scope';
      if v_scope is null or v_scope not in ('all', 'partial') then raise exception 'AP: Say whether all of the scrap or only a portion is not of quality.'; end if;
      if cardinality(v_issues) = 0 then raise exception 'AP: Choose at least one quality problem.'; end if;
      v_text := private.ap_text(p ->> 'rejection_reason', 'Reason the scrap is not of quality', 15, 600);
      if not exists (select 1 from public.foundry_metal_receipt_files f where f.receipt_id = v_id and f.kind = 'rejection_photo') then
        raise exception 'AP: Upload at least one photo showing the quality problem.';
      end if;
      if v_scope = 'all' then
        if p ? 'rejected_kg' and private.fsr_num(p, 'rejected_kg', 'Rejected weight (kg)', 0, 200000) <> v_net then raise exception 'AP: When all of the scrap is not of quality the rejected weight is the full net weight.'; end if;
        v_rejected := v_net;
      else
        v_rejected := private.fsr_num(p, 'rejected_kg', 'Weight of the portion not of quality (kg)', 0.001, 200000);
        if v_rejected >= v_net then raise exception 'AP: The portion not of quality must be less than the net weight %. Choose "all of it" otherwise.', v_net; end if;
      end if;
    end if;
    v_name := private.ap_text(p ->> 'weighbridge_reference', 'Weighbridge slip number', 1, 60);
    update public.foundry_scrap_receipts set
      vehicle_number = upper(regexp_replace(private.ap_text(p ->> 'vehicle_number', 'Vehicle number', 4, 20), '\s+', '', 'g')),
      challan_number = private.ap_text(p ->> 'challan_number', 'Challan number', 1, 40, false),
      weighbridge_reference = v_name, gross_kg = v_gross, tare_kg = v_tare, net_kg = v_net,
      quality_ok = v_ok, checklist = v_checklist, issues = v_issues, rejection_scope = v_scope, rejected_kg = v_rejected, rejection_reason = v_text,
      inspection_notes = private.ap_text(p ->> 'notes', 'Inspection notes', 3, 600, false), inspected_at = now(),
      status = 'details', updated_at = now()
    where id = v_id;
    return jsonb_build_object('id', v_id, 'status', 'details', 'net_kg', v_net, 'rejected_kg', v_rejected, 'accepted_kg', v_net - v_rejected);

  -- ------------------------------------------------------------------ receiving: step 3
  elsif p_command = 'complete' then
    perform private.ap_keys(p, array['receipt_id', 'scrap_type_id', 'alloy', 'readiness', 'processing_steps', 'scrap_quality', 'notes']);
    v_id := private.ap_uuid(p, 'receipt_id');
    select * into r from public.foundry_scrap_receipts where id = v_id and company_id = c.company_id for update;
    if not found then raise exception 'AP: This receipt was not found.'; end if;
    if r.started_by <> c.actor_id then raise exception 'AP: Only the person receiving this scrap can complete it.'; end if;
    if r.status = 'inspection' then raise exception 'AP: Finish the visual verification first.'; end if;
    if r.status <> 'details' then raise exception 'AP: This receipt is already closed.'; end if;
    v_type := private.ap_uuid(p, 'scrap_type_id');
    if not exists (select 1 from public.foundry_scrap_types t where t.id = v_type and t.company_id = c.company_id and t.is_active) then
      raise exception 'AP: Choose an active scrap type.';
    end if;
    v_alloy := private.ap_text(p ->> 'alloy', 'Alloy', 2, 20);
    v_readiness := p ->> 'readiness';
    if v_readiness is null or v_readiness not in ('ready_to_use', 'needs_processing') then raise exception 'AP: Say whether the scrap is ready to use or needs processing.'; end if;
    v_issues := private.fsr_text_array(p, 'processing_steps', v_steps, 'processing step');
    if v_readiness = 'needs_processing' and cardinality(v_issues) = 0 then raise exception 'AP: Choose the processing the scrap needs.'; end if;
    if v_readiness = 'ready_to_use' then v_issues := '{}'; end if;
    v_quality := coalesce(nullif(p ->> 'scrap_quality', ''), case when v_readiness = 'ready_to_use' then 'clean' else 'segregation_required' end);
    if v_quality not in ('clean', 'painted', 'mixed', 'contaminated', 'segregation_required') then raise exception 'AP: Invalid scrap quality.'; end if;
    if v_readiness = 'ready_to_use' and v_quality in ('contaminated', 'segregation_required') then
      raise exception 'AP: Contaminated or unsegregated scrap needs processing before use.';
    end if;
    v_accepted := r.net_kg - coalesce(r.rejected_kg, 0);
    if v_accepted > 0 then
      insert into public.foundry_aluminium_scrap(company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, unit, scrap_quality, status,
        received_date, origin_reference, weighbridge_reference, alloy, scrap_receipt_id, scrap_type_id, notes, created_by)
      values (c.company_id, private.next_business_number_locked('public.foundry_aluminium_scrap'::regclass, 'scrap_number', c.company_id, 'SCR', v_today),
        'incoming', v_accepted, v_accepted, 'kg', v_quality, 'available', v_today, concat('Scrap receipt ', r.receipt_number), r.weighbridge_reference, v_alloy, v_id, v_type,
        case when v_readiness = 'needs_processing' then 'Needs processing: ' || array_to_string(v_issues, ', ') end, c.actor_id)
      returning id into v_lot;
    end if;
    if coalesce(r.rejected_kg, 0) > 0 then
      insert into public.foundry_aluminium_scrap(company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, unit, scrap_quality, status,
        received_date, origin_reference, weighbridge_reference, alloy, scrap_receipt_id, scrap_type_id, notes, created_by)
      values (c.company_id, private.next_business_number_locked('public.foundry_aluminium_scrap'::regclass, 'scrap_number', c.company_id, 'SCR', v_today),
        'incoming', r.rejected_kg, r.rejected_kg, 'kg', 'rejected', 'rejected', v_today, concat('Rejected at scrap receipt ', r.receipt_number), r.weighbridge_reference, v_alloy, v_id, v_type,
        left('Not of quality: ' || r.rejection_reason, 600), c.actor_id)
      returning id into v_rej_lot;
    end if;
    update public.foundry_scrap_receipts set scrap_type_id = v_type, alloy = v_alloy, readiness = v_readiness, processing_steps = v_issues, scrap_quality = v_quality,
      detail_notes = private.ap_text(p ->> 'notes', 'Notes', 3, 600, false), accepted_kg = v_accepted, accepted_scrap_id = v_lot, rejected_scrap_id = v_rej_lot,
      status = 'completed', completed_by = c.actor_id, completed_at = now(), finance_status = 'pending',
      exit_requested_at = null, updated_at = now()
    where id = v_id;
    if r.request_id is not null then
      update public.foundry_scrap_requests x set status = 'fulfilled', closed_at = now(), updated_at = now()
      where x.id = r.request_id and x.status = 'open'
        and (select coalesce(sum(rc.accepted_kg), 0) from public.foundry_scrap_receipts rc where rc.request_id = x.id and rc.status = 'completed') >= x.quantity_kg;
    end if;
    insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, related_entity_type, related_entity_id, condition_key, created_by)
    values (c.company_id, 'accounts', 'metal_receipt_finance', 'info', 'New scrap batch received: add the bill',
      concat(r.receipt_number, ': ', to_char(v_accepted, 'FM999G999G990D000'), ' kg accepted',
        case when coalesce(r.rejected_kg, 0) > 0 then concat(', ', to_char(r.rejected_kg, 'FM999G999G990D000'), ' kg not of quality') else '' end,
        ' (', (select t.name from public.foundry_scrap_types t where t.id = v_type), ', alloy ', v_alloy, '). Enter the vendor, bill, rate and tax and upload the bill.'),
      '/foundry/scrap/receipts/' || v_id, 'foundry_scrap_receipts', v_id, 'fsr:receipt:' || v_id, c.actor_id);
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (c.company_id, c.actor_id, 'scrap_receipt_completed', 'foundry_scrap_receipts', v_id,
      jsonb_build_object('receipt_number', r.receipt_number, 'net_kg', r.net_kg, 'accepted_kg', v_accepted, 'rejected_kg', coalesce(r.rejected_kg, 0), 'accepted_lot', v_lot, 'rejected_lot', v_rej_lot));
    return jsonb_build_object('id', v_id, 'status', 'completed', 'accepted_kg', v_accepted, 'accepted_scrap_id', v_lot, 'rejected_scrap_id', v_rej_lot,
      'accepted_scrap_number', (select s.scrap_number from public.foundry_aluminium_scrap s where s.id = v_lot),
      'rejected_scrap_number', (select s.scrap_number from public.foundry_aluminium_scrap s where s.id = v_rej_lot));

  -- ------------------------------------------------------------------ exit attempts after step 1
  elsif p_command = 'abort' then
    perform private.ap_keys(p, array['receipt_id', 'reason']);
    v_id := private.ap_uuid(p, 'receipt_id');
    select * into r from public.foundry_scrap_receipts where id = v_id and company_id = c.company_id for update;
    if not found then raise exception 'AP: This receipt was not found.'; end if;
    if r.started_by <> c.actor_id then raise exception 'AP: Only the person receiving this scrap can ask to leave it.'; end if;
    if r.status not in ('inspection', 'details') then raise exception 'AP: This receipt is already closed.'; end if;
    if r.exit_requested_at is not null then
      return jsonb_build_object('allowed', false, 'attempts', r.abort_attempts, 'pending', true);
    end if;
    if r.abort_attempts + 1 >= 5 then
      v_note := private.ap_text(p ->> 'reason', 'Reason you need to leave the receipt', 10, 300, false);
      if v_note is null then
        return jsonb_build_object('allowed', false, 'attempts', r.abort_attempts, 'needs_reason', true);
      end if;
      update public.foundry_scrap_receipts set abort_attempts = abort_attempts + 1, escalated_at = coalesce(escalated_at, now()),
        exit_requested_at = now(), exit_request_reason = v_note, exit_decision = null, exit_decided_by = null, exit_decided_at = null, exit_decision_reason = null, updated_at = now()
      where id = v_id;
      insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, related_entity_type, related_entity_id, created_by)
      values (c.company_id, 'factory_manager', 'scrap_receipt_exit', 'critical', 'Foundry manager is trying to leave a scrap receipt',
        concat(c.full_name, ' tried to leave receipt ', r.receipt_number, ' ', r.abort_attempts + 1, ' times. Reason: ', v_note, ' Only you can let them leave.'),
        '/foundry/scrap/receipts/' || v_id, 'foundry_scrap_receipts', v_id, c.actor_id);
      insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
      values (c.company_id, c.actor_id, 'scrap_receipt_exit_requested', 'foundry_scrap_receipts', v_id, jsonb_build_object('attempts', r.abort_attempts + 1, 'reason', v_note));
      return jsonb_build_object('allowed', false, 'attempts', r.abort_attempts + 1, 'escalated', true, 'pending', true);
    end if;
    update public.foundry_scrap_receipts set abort_attempts = abort_attempts + 1, updated_at = now() where id = v_id;
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (c.company_id, c.actor_id, 'scrap_receipt_exit_attempt', 'foundry_scrap_receipts', v_id, jsonb_build_object('attempts', r.abort_attempts + 1));
    return jsonb_build_object('allowed', false, 'attempts', r.abort_attempts + 1, 'remaining', 5 - (r.abort_attempts + 1));

  elsif p_command = 'decide_exit' then
    perform private.ap_keys(p, array['receipt_id', 'decision', 'reason']);
    v_id := private.ap_uuid(p, 'receipt_id');
    select * into r from public.foundry_scrap_receipts where id = v_id and company_id = c.company_id for update;
    if not found then raise exception 'AP: This receipt was not found.'; end if;
    if r.status not in ('inspection', 'details') or r.exit_requested_at is null then raise exception 'AP: There is no pending request to leave this receipt.'; end if;
    if r.started_by = c.actor_id then raise exception 'AP: You cannot decide your own request to leave a receipt.'; end if;
    v_text := p ->> 'decision';
    if v_text is null or v_text not in ('approved', 'declined') then raise exception 'AP: Choose to allow or refuse the exit.'; end if;
    v_note := private.ap_text(p ->> 'reason', case when v_text = 'approved' then 'Reason you are allowing the exit' else 'Reason you are refusing the exit' end, 10, 300);
    update public.foundry_scrap_receipts set exit_decision = v_text, exit_decided_by = c.actor_id, exit_decided_at = now(), exit_decision_reason = v_note,
      status = case when v_text = 'approved' then 'exited' else status end,
      exit_requested_at = case when v_text = 'approved' then exit_requested_at end,
      exit_request_reason = case when v_text = 'approved' then exit_request_reason end,
      updated_at = now()
    where id = v_id;
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, action_link, related_entity_type, related_entity_id, created_by)
    values (c.company_id, r.started_by, 'scrap_receipt_exit', case when v_text = 'approved' then 'info' else 'warning' end,
      case when v_text = 'approved' then 'You may leave the scrap receipt' else 'Continue the scrap receipt' end,
      concat(r.receipt_number, ': ', c.full_name, case when v_text = 'approved' then ' allowed you to leave. ' else ' asked you to finish receiving. ' end, v_note),
      '/foundry/scrap/receipts/' || v_id, 'foundry_scrap_receipts', v_id, c.actor_id);
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (c.company_id, c.actor_id, 'scrap_receipt_exit_' || v_text, 'foundry_scrap_receipts', v_id,
      jsonb_build_object('receiver_reason', r.exit_request_reason, 'factory_manager_reason', v_note, 'attempts', r.abort_attempts));
    return jsonb_build_object('id', v_id, 'decision', v_text);

  -- ------------------------------------------------------------------ lists and detail
  elsif p_command = 'receipts' then
    perform private.ap_keys(p, array['page', 'status', 'search']);
    v_page := greatest(coalesce((p ->> 'page')::integer, 1), 1);
    v_status := coalesce(nullif(p ->> 'status', ''), 'all');
    if v_status not in ('all', 'in_progress', 'exit_requested', 'completed', 'exited', 'finance_pending', 'finance_completed') then raise exception 'AP: Invalid status.'; end if;
    v_search := nullif(btrim(coalesce(p ->> 'search', '')), '');
    if v_search is not null and length(v_search) > 60 then raise exception 'AP: Search is too long.'; end if;
    with base as (
      select x.* from public.foundry_scrap_receipts x
      where x.company_id = c.company_id
        and case v_status when 'all' then true when 'in_progress' then x.status in ('inspection', 'details') when 'exit_requested' then x.status in ('inspection', 'details') and x.exit_requested_at is not null
          when 'completed' then x.status = 'completed' when 'exited' then x.status = 'exited' when 'finance_pending' then x.finance_status = 'pending' else x.finance_status = 'completed' end
        and (v_search is null or x.receipt_number ilike '%' || v_search || '%' or x.vehicle_number ilike '%' || v_search || '%' or x.weighbridge_reference ilike '%' || v_search || '%')
    )
    select (select count(*) from base), coalesce((select jsonb_agg(row_data order by started_at desc) from (
      select b.started_at, jsonb_build_object('id', b.id, 'receipt_number', b.receipt_number, 'status', b.status, 'started_at', b.started_at, 'completed_at', b.completed_at,
        'started_by', private.fsr_name(b.started_by), 'vehicle_number', b.vehicle_number, 'net_kg', b.net_kg, 'accepted_kg', b.accepted_kg, 'rejected_kg', b.rejected_kg,
        'quality_ok', b.quality_ok, 'scrap_type', (select t.name from public.foundry_scrap_types t where t.id = b.scrap_type_id), 'alloy', b.alloy,
        'finance_status', b.finance_status, 'abort_attempts', b.abort_attempts, 'exit_requested', b.exit_requested_at is not null,
        'request_number', (select x.request_number from public.foundry_scrap_requests x where x.id = b.request_id)) row_data
      from base b order by b.started_at desc limit 10 offset (v_page - 1) * 10) s), '[]'::jsonb)
    into v_total, v_rows;
    return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page);

  elsif p_command = 'get' then
    perform private.ap_keys(p, array['id']);
    v_id := private.ap_uuid(p, 'id');
    select * into r from public.foundry_scrap_receipts where id = v_id and company_id = c.company_id;
    if not found then raise exception 'AP: This receipt was not found.'; end if;
    return jsonb_build_object(
      'id', r.id, 'receipt_number', r.receipt_number, 'status', r.status, 'started_at', r.started_at, 'started_by', private.fsr_name(r.started_by),
      'is_receiver', r.started_by = c.actor_id, 'can_decide_exit', c.role = 'factory_manager' and r.started_by <> c.actor_id,
      'can_finance', v_is_finance and r.status = 'completed',
      'request', (select jsonb_build_object('id', x.id, 'request_number', x.request_number, 'quantity_kg', x.quantity_kg, 'alloy', x.alloy,
        'scrap_type', (select t.name from public.foundry_scrap_types t where t.id = x.scrap_type_id)) from public.foundry_scrap_requests x where x.id = r.request_id),
      'receiver_present', r.receiver_present, 'proxy_name', r.proxy_name, 'proxy_phone', r.proxy_phone, 'proxy_reason', r.proxy_reason,
      'vehicle_number', r.vehicle_number, 'challan_number', r.challan_number, 'weighbridge_reference', r.weighbridge_reference,
      'gross_kg', r.gross_kg, 'tare_kg', r.tare_kg, 'net_kg', r.net_kg, 'quality_ok', r.quality_ok, 'checklist', r.checklist, 'issues', to_jsonb(r.issues),
      'rejection_scope', r.rejection_scope, 'rejected_kg', r.rejected_kg, 'rejection_reason', r.rejection_reason, 'inspection_notes', r.inspection_notes, 'inspected_at', r.inspected_at,
      'scrap_type_id', r.scrap_type_id, 'scrap_type', (select t.name from public.foundry_scrap_types t where t.id = r.scrap_type_id), 'alloy', r.alloy,
      'readiness', r.readiness, 'processing_steps', to_jsonb(r.processing_steps), 'scrap_quality', r.scrap_quality, 'detail_notes', r.detail_notes,
      'accepted_kg', r.accepted_kg, 'completed_at', r.completed_at, 'completed_by', private.fsr_name(r.completed_by),
      'accepted_lot', (select jsonb_build_object('id', s.id, 'scrap_number', s.scrap_number, 'status', s.status, 'available_weight_kg', s.available_weight_kg) from public.foundry_aluminium_scrap s where s.id = r.accepted_scrap_id),
      'rejected_lot', (select jsonb_build_object('id', s.id, 'scrap_number', s.scrap_number, 'status', s.status) from public.foundry_aluminium_scrap s where s.id = r.rejected_scrap_id),
      'abort_attempts', r.abort_attempts, 'escalated_at', r.escalated_at, 'exit_requested_at', r.exit_requested_at, 'exit_request_reason', r.exit_request_reason,
      'exit_decision', r.exit_decision, 'exit_decided_by', private.fsr_name(r.exit_decided_by), 'exit_decided_at', r.exit_decided_at, 'exit_decision_reason', r.exit_decision_reason,
      'finance_status', r.finance_status,
      'finance', case when v_is_finance then jsonb_build_object('vendor_id', r.vendor_id, 'vendor_name', (select v.vendor_name from public.vendors v where v.id = r.vendor_id),
        'invoice_number', r.invoice_number, 'invoice_date', r.invoice_date, 'due_date', r.due_date, 'rate_per_kg', r.rate_per_kg, 'tax_amount', r.tax_amount,
        'freight_amount', r.freight_amount, 'discount_amount', r.discount_amount, 'payment_method', r.payment_method, 'notes', r.finance_notes,
        'completed_by', private.fsr_name(r.finance_completed_by), 'completed_at', r.finance_completed_at,
        'expense', (select jsonb_build_object('id', e.id, 'expense_number', e.expense_number, 'total_amount', e.total_amount, 'approval_status', e.approval_status, 'payment_status', e.payment_status)
          from public.foundry_aluminium_scrap s join public.expense_ledger e on e.id = s.expense_ledger_id where s.id = r.accepted_scrap_id)) end,
      'files', private.fsr_files(c.company_id, r.id, null, v_is_finance));

  -- ------------------------------------------------------------------ accounts completion
  elsif p_command in ('finance_save', 'source_finance_save') then
    perform private.ap_keys(p, array['receipt_id', 'source_id', 'vendor_id', 'invoice_number', 'invoice_date', 'due_date', 'rate_per_kg', 'tax_amount', 'freight_amount', 'discount_amount', 'payment_method', 'notes']);
    v_vendor := private.ap_uuid(p, 'vendor_id');
    if not exists (select 1 from public.vendors v where v.id = v_vendor and v.company_id = c.company_id) then raise exception 'AP: Choose the vendor.'; end if;
    v_invoice := private.ap_text(p ->> 'invoice_number', 'Bill number', 1, 40);
    v_inv_date := private.fsr_day(p, 'invoice_date', 'Bill date', true);
    if v_inv_date > v_today then raise exception 'AP: Bill date cannot be in the future.'; end if;
    v_due := private.fsr_day(p, 'due_date', 'Due date');
    if v_due is not null and v_due < v_inv_date then raise exception 'AP: Due date cannot be before the bill date.'; end if;
    v_rate := private.fsr_num(p, 'rate_per_kg', 'Rate per kg', 0.01, 100000);
    v_tax := coalesce(private.fsr_num(p, 'tax_amount', 'GST amount', 0, 1000000000, false), 0);
    v_freight := coalesce(private.fsr_num(p, 'freight_amount', 'Freight', 0, 1000000000, false), 0);
    v_discount := coalesce(private.fsr_num(p, 'discount_amount', 'Discount', 0, 1000000000, false), 0);
    v_method := private.ap_text(p ->> 'payment_method', 'Payment method', 2, 40, false);
    v_note := private.ap_text(p ->> 'notes', 'Notes', 3, 600, false);
    if p_command = 'finance_save' then
      if p ? 'source_id' then raise exception 'AP: Invalid request.'; end if;
      v_id := private.ap_uuid(p, 'receipt_id');
      select * into r from public.foundry_scrap_receipts where id = v_id and company_id = c.company_id for update;
      if not found then raise exception 'AP: This receipt was not found.'; end if;
      if r.status <> 'completed' then raise exception 'AP: The receipt is not completed yet.'; end if;
      if not exists (select 1 from public.foundry_metal_receipt_files f where f.receipt_id = v_id and f.kind = 'bill') then raise exception 'AP: Upload the bill first.'; end if;
      if r.accepted_scrap_id is not null and round(r.accepted_kg * v_rate, 2) + v_tax + v_freight - v_discount < 0 then raise exception 'AP: Discount is more than the bill value.'; end if;
      update public.foundry_scrap_receipts set vendor_id = v_vendor, invoice_number = v_invoice, invoice_date = v_inv_date, due_date = v_due, rate_per_kg = v_rate,
        tax_amount = v_tax, freight_amount = v_freight, discount_amount = v_discount, payment_method = v_method, finance_notes = v_note,
        finance_status = 'completed', finance_completed_by = c.actor_id, finance_completed_at = now(), updated_at = now()
      where id = v_id;
      -- Money is charged on the accepted kilograms only; the rejected lot keeps the vendor for the return or debit note.
      if r.accepted_scrap_id is not null then
        update public.foundry_aluminium_scrap set vendor_id = v_vendor, rate = v_rate, base_amount = round(weight_kg * v_rate, 2), tax_amount = v_tax, freight_amount = v_freight,
          discount_amount = v_discount, invoice_number = v_invoice, invoice_date = v_inv_date, due_date = v_due, payment_method = v_method, updated_at = now()
        where id = r.accepted_scrap_id and company_id = c.company_id;
      end if;
      if r.rejected_scrap_id is not null then
        update public.foundry_aluminium_scrap set vendor_id = v_vendor, updated_at = now() where id = r.rejected_scrap_id and company_id = c.company_id and vendor_id is distinct from v_vendor;
      end if;
      update public.notifications set resolved_at = now(), resolution = 'Bill recorded by accounts' where company_id = c.company_id and condition_key = 'fsr:receipt:' || v_id and resolved_at is null;
      insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
      values (c.company_id, c.actor_id, 'scrap_receipt_finance_saved', 'foundry_scrap_receipts', v_id,
        jsonb_build_object('vendor_id', v_vendor, 'invoice_number', v_invoice, 'rate_per_kg', v_rate, 'tax_amount', v_tax, 'freight_amount', v_freight, 'discount_amount', v_discount));
      return jsonb_build_object('id', v_id, 'finance_status', 'completed',
        'expense_number', (select e.expense_number from public.foundry_aluminium_scrap s join public.expense_ledger e on e.id = s.expense_ledger_id where s.id = r.accepted_scrap_id));
    else
      if p ? 'receipt_id' then raise exception 'AP: Invalid request.'; end if;
      v_id := private.ap_uuid(p, 'source_id');
      if not exists (select 1 from public.foundry_external_aluminium_sources s where s.id = v_id and s.company_id = c.company_id) then raise exception 'AP: This source was not found.'; end if;
      if not exists (select 1 from public.foundry_metal_receipt_files f where f.external_source_id = v_id and f.kind = 'bill') then raise exception 'AP: Upload the bill first.'; end if;
      update public.foundry_external_aluminium_sources set vendor_id = v_vendor, rate = v_rate, base_amount = round(weight_kg * v_rate, 2), tax_amount = v_tax, freight_amount = v_freight,
        discount_amount = v_discount, invoice_number = v_invoice, invoice_date = v_inv_date, due_date = v_due, payment_method = v_method,
        notes = coalesce(v_note, notes), finance_status = 'completed', updated_at = now()
      where id = v_id and company_id = c.company_id;
      update public.notifications set resolved_at = now(), resolution = 'Bill recorded by accounts' where company_id = c.company_id and condition_key = 'fsr:source:' || v_id and resolved_at is null;
      insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
      values (c.company_id, c.actor_id, 'external_source_finance_saved', 'foundry_external_aluminium_sources', v_id,
        jsonb_build_object('vendor_id', v_vendor, 'invoice_number', v_invoice, 'rate_per_kg', v_rate, 'tax_amount', v_tax, 'freight_amount', v_freight, 'discount_amount', v_discount));
      return jsonb_build_object('id', v_id, 'finance_status', 'completed',
        'expense_number', (select e.expense_number from public.foundry_external_aluminium_sources s join public.expense_ledger e on e.id = s.expense_ledger_id where s.id = v_id));
    end if;

  elsif p_command = 'finance_queue' then
    perform private.ap_keys(p, array['page', 'status']);
    v_page := greatest(coalesce((p ->> 'page')::integer, 1), 1);
    v_status := coalesce(nullif(p ->> 'status', ''), 'pending');
    if v_status not in ('pending', 'completed') then raise exception 'AP: Invalid status.'; end if;
    with items as (
      select 'scrap_receipt' kind, x.id, x.receipt_number number, x.completed_at at_time, coalesce(x.accepted_kg, 0) kg, x.rejected_kg,
        (select t.name from public.foundry_scrap_types t where t.id = x.scrap_type_id) material, x.alloy, x.finance_status status,
        (select v.vendor_name from public.vendors v where v.id = x.vendor_id) vendor, x.invoice_number
      from public.foundry_scrap_receipts x where x.company_id = c.company_id and x.finance_status = v_status
      union all
      select 'external_source', s.id, s.source_number, s.created_at, s.weight_kg, null, replace(s.item_type, '_', ' '), s.alloy, s.finance_status,
        (select v.vendor_name from public.vendors v where v.id = s.vendor_id), s.invoice_number
      from public.foundry_external_aluminium_sources s where s.company_id = c.company_id and s.finance_status = v_status
    )
    select (select count(*) from items), coalesce((select jsonb_agg(to_jsonb(i) order by i.at_time desc) from (select * from items order by at_time desc limit 10 offset (v_page - 1) * 10) i), '[]'::jsonb)
    into v_total, v_rows;
    return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page);

  elsif p_command = 'source_get' then
    perform private.ap_keys(p, array['id']);
    v_id := private.ap_uuid(p, 'id');
    return (select jsonb_build_object('id', s.id, 'source_number', s.source_number, 'item_type', s.item_type, 'alloy', s.alloy, 'weight_kg', s.weight_kg, 'quantity', s.quantity,
      'source_origin', s.source_origin, 'received_date', s.received_date, 'weighbridge_reference', s.weighbridge_reference, 'finance_status', s.finance_status,
      'vendor_id', s.vendor_id, 'vendor_name', (select v.vendor_name from public.vendors v where v.id = s.vendor_id), 'invoice_number', s.invoice_number,
      'invoice_date', s.invoice_date, 'due_date', s.due_date, 'rate_per_kg', s.rate, 'tax_amount', s.tax_amount, 'freight_amount', s.freight_amount,
      'discount_amount', s.discount_amount, 'payment_method', s.payment_method, 'files', private.fsr_files(c.company_id, null, s.id, true))
      from public.foundry_external_aluminium_sources s where s.id = v_id and s.company_id = c.company_id);
  end if;

  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_scrap_receipt(text, jsonb) from public, anon;
grant execute on function public.ap_scrap_receipt(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Storage: receipt photos for receivers and accounts, bills for accounts only (company folder first)
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists "scrap receipt photos read" on storage.objects;
create policy "scrap receipt photos read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
    and (storage.foldername(name))[2] = 'scrap-receipts'
    and public.get_current_user_role() in ('owner', 'admin', 'production_manager', 'production', 'factory_manager', 'accounts')
  );
drop policy if exists "scrap receipt photos insert" on storage.objects;
create policy "scrap receipt photos insert" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
    and (storage.foldername(name))[2] = 'scrap-receipts'
    and public.get_current_user_role() in ('owner', 'admin', 'production_manager', 'production', 'factory_manager')
  );
drop policy if exists "scrap receipt bills read" on storage.objects;
create policy "scrap receipt bills read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
    and (storage.foldername(name))[2] = 'scrap-receipt-bills'
    and public.get_current_user_role() in ('owner', 'admin', 'accounts')
  );
drop policy if exists "scrap receipt bills insert" on storage.objects;
create policy "scrap receipt bills insert" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
    and (storage.foldername(name))[2] = 'scrap-receipt-bills'
    and public.get_current_user_role() in ('owner', 'admin', 'accounts')
  );

commit;
