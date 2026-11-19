-- FABLE_SUGGESTIONS FS-65 (one unit-of-measure and weight-basis policy) and FS-75 (delegation-of-authority matrix).

-- =====================================================================================================================
-- FS-65: weight basis
-- =====================================================================================================================
-- Stock is always held in actual weighed kg, with pieces and length as attributes (fixed, not a setting). Orders are
-- placed in pieces and length. Whether invoices bill actual weighed kg or theoretical kg (pieces x length x kg/m) is
-- Omalco's decision (FABLE input #4): it is recorded here by the owner, per company and optionally per customer, and
-- starts undecided. The allowed difference between theoretical and actual comes from the profile
-- (aluminium_profiles.weight_tolerance_percent) or, where the profile has none, the company default the owner sets.
-- Rounding: kg to 3 decimals, percentages to 2 decimals, half away from zero (PostgreSQL numeric round; the same rule
-- as lib/calculations/weight-basis.ts).

create table if not exists public.weight_basis_policy (
  company_id uuid primary key references public.companies(id) on delete cascade,
  stock_basis text not null default 'actual_kg' check (stock_basis = 'actual_kg'),
  invoice_basis text check (invoice_basis in ('actual_weighed', 'theoretical')),
  default_tolerance_percent numeric(6, 3) check (default_tolerance_percent is null or default_tolerance_percent between 0 and 25),
  decided_by uuid references auth.users(id),
  decided_by_name text,
  decided_at timestamptz,
  reason text
);
alter table public.weight_basis_policy enable row level security;
revoke all on public.weight_basis_policy from public, anon, authenticated;

create table if not exists public.customer_weight_basis (
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  invoice_basis text not null check (invoice_basis in ('actual_weighed', 'theoretical')),
  reason text not null check (length(reason) between 5 and 300),
  decided_by uuid references auth.users(id),
  decided_by_name text,
  decided_at timestamptz not null default now(),
  primary key (company_id, customer_id)
);
alter table public.customer_weight_basis enable row level security;
revoke all on public.customer_weight_basis from public, anon, authenticated;

create table if not exists public.weight_basis_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  reason text not null,
  actor_id uuid,
  actor_name text,
  recorded_at timestamptz not null default now()
);
create index if not exists weight_basis_events_idx on public.weight_basis_events(company_id, recorded_at desc);
alter table public.weight_basis_events enable row level security;
revoke all on public.weight_basis_events from public, anon, authenticated;
create or replace function private.fs_guard_append_only()
returns trigger language plpgsql set search_path = public, private as $$
begin raise exception 'AP: This history cannot be changed or deleted.' using errcode = '42501'; end;
$$;
revoke all on function private.fs_guard_append_only() from public, anon, authenticated;
drop trigger if exists weight_basis_events_immutable on public.weight_basis_events;
create trigger weight_basis_events_immutable before update or delete on public.weight_basis_events for each row execute function private.fs_guard_append_only();

-- The one conversion: theoretical kg, difference and whether it is inside the tolerance.
create or replace function private.weight_compare(p_pieces numeric, p_length_m numeric, p_kg_per_m numeric, p_actual_kg numeric, p_tolerance_percent numeric)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  with t as (select case when p_pieces > 0 and p_length_m > 0 and p_kg_per_m > 0 then round(p_pieces * p_length_m * p_kg_per_m, 3) end theoretical,
    case when p_actual_kg > 0 then round(p_actual_kg, 3) end actual)
  select jsonb_build_object('theoretical_kg', theoretical, 'actual_kg', actual,
    'difference_kg', case when theoretical is not null and actual is not null then actual - theoretical end,
    'difference_percent', case when theoretical > 0 and actual is not null then round((actual - theoretical) * 100 / theoretical, 2) end,
    'tolerance_percent', p_tolerance_percent,
    'state', case when theoretical is null then 'no_theoretical' when actual is null then 'not_weighed' when p_tolerance_percent is null then 'no_tolerance'
      when abs(round((actual - theoretical) * 100 / theoretical, 2)) <= p_tolerance_percent then 'within'
      when actual > theoretical then 'heavy' else 'light' end)
  from t
$$;
revoke all on function private.weight_compare(numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function private.weight_compare(numeric, numeric, numeric, numeric, numeric) to authenticated, service_role;

-- The invoice basis that applies to a customer and where it comes from.
create or replace function private.weight_invoice_basis(p_company uuid, p_customer uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce(
    (select jsonb_build_object('basis', c.invoice_basis, 'source', 'customer', 'reason', c.reason) from public.customer_weight_basis c where c.company_id = p_company and c.customer_id = p_customer),
    (select jsonb_build_object('basis', p.invoice_basis, 'source', 'company', 'reason', p.reason) from public.weight_basis_policy p where p.company_id = p_company and p.invoice_basis is not null),
    jsonb_build_object('basis', null, 'source', 'undecided', 'reason', 'Omalco has not yet decided whether invoices bill actual weighed kg or theoretical kg.'))
$$;
revoke all on function private.weight_invoice_basis(uuid, uuid) from public, anon, authenticated;

create or replace function public.fs_weight_basis(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; p public.weight_basis_policy%rowtype; v_reason text; v_basis text; v_tol numeric; v_customer uuid; v_old text; v_dispatch uuid; v_default numeric;
begin
  if p_command = 'policy' then
    select * into c from private.ap_ctx(array['owner', 'admin', 'accounts', 'sales_manager', 'dispatch_manager', 'factory_manager']);
    select * into p from public.weight_basis_policy where company_id = c.company_id;
    return jsonb_build_object('stock_basis', 'actual_kg', 'invoice_basis', p.invoice_basis, 'default_tolerance_percent', p.default_tolerance_percent,
      'decided_by', p.decided_by_name, 'decided_at', p.decided_at, 'reason', p.reason, 'can_decide', c.role = 'owner',
      'customers', coalesce((select jsonb_agg(jsonb_build_object('customer_id', x.customer_id, 'customer', coalesce(nullif(cu.company_name, ''), cu.customer_name),
          'invoice_basis', x.invoice_basis, 'reason', x.reason, 'decided_by', x.decided_by_name, 'decided_at', x.decided_at) order by coalesce(nullif(cu.company_name, ''), cu.customer_name))
        from public.customer_weight_basis x join public.customers cu on cu.id = x.customer_id where x.company_id = c.company_id), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(to_jsonb(e) - 'company_id' order by e.recorded_at desc) from (select * from public.weight_basis_events where company_id = c.company_id order by recorded_at desc limit 10) e), '[]'::jsonb));

  elsif p_command = 'save_policy' then
    select * into c from private.ap_ctx(array['owner']);
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300);
    v_basis := nullif(p_payload ->> 'invoice_basis', '');
    if v_basis is not null and v_basis not in ('actual_weighed', 'theoretical') then raise exception 'AP: Choose actual weighed kg or theoretical kg.'; end if;
    begin v_tol := nullif(p_payload ->> 'default_tolerance_percent', '')::numeric; exception when others then raise exception 'AP: Enter the tolerance as a percentage.'; end;
    if v_tol is not null and (v_tol < 0 or v_tol > 25) then raise exception 'AP: The tolerance must be between 0 and 25 percent.'; end if;
    select * into p from public.weight_basis_policy where company_id = c.company_id;
    if p.invoice_basis is distinct from v_basis then
      insert into public.weight_basis_events(company_id, field, old_value, new_value, reason, actor_id, actor_name) values (c.company_id, 'invoice_basis', p.invoice_basis, v_basis, v_reason, c.actor_id, c.full_name);
    end if;
    if p.default_tolerance_percent is distinct from v_tol then
      insert into public.weight_basis_events(company_id, field, old_value, new_value, reason, actor_id, actor_name) values (c.company_id, 'default_tolerance_percent', p.default_tolerance_percent::text, v_tol::text, v_reason, c.actor_id, c.full_name);
    end if;
    insert into public.weight_basis_policy(company_id, invoice_basis, default_tolerance_percent, decided_by, decided_by_name, decided_at, reason)
    values (c.company_id, v_basis, v_tol, c.actor_id, c.full_name, now(), v_reason)
    on conflict (company_id) do update set invoice_basis = excluded.invoice_basis, default_tolerance_percent = excluded.default_tolerance_percent,
      decided_by = excluded.decided_by, decided_by_name = excluded.decided_by_name, decided_at = now(), reason = excluded.reason;
    return jsonb_build_object('saved', true);

  elsif p_command = 'save_customer' then
    select * into c from private.ap_ctx(array['owner']);
    v_customer := private.ap_uuid(p_payload, 'customer_id');
    if not exists (select 1 from public.customers where id = v_customer and company_id = c.company_id) then raise exception 'Not permitted' using errcode = '42501'; end if;
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300);
    v_basis := nullif(p_payload ->> 'invoice_basis', '');
    if v_basis is not null and v_basis not in ('actual_weighed', 'theoretical') then raise exception 'AP: Choose actual weighed kg or theoretical kg.'; end if;
    select invoice_basis into v_old from public.customer_weight_basis where company_id = c.company_id and customer_id = v_customer;
    if v_old is not distinct from v_basis then return jsonb_build_object('saved', false, 'unchanged', true); end if;
    insert into public.weight_basis_events(company_id, customer_id, field, old_value, new_value, reason, actor_id, actor_name)
    values (c.company_id, v_customer, 'customer_invoice_basis', v_old, coalesce(v_basis, 'company default'), v_reason, c.actor_id, c.full_name);
    if v_basis is null then
      delete from public.customer_weight_basis where company_id = c.company_id and customer_id = v_customer;
    else
      insert into public.customer_weight_basis(company_id, customer_id, invoice_basis, reason, decided_by, decided_by_name)
      values (c.company_id, v_customer, v_basis, v_reason, c.actor_id, c.full_name)
      on conflict (company_id, customer_id) do update set invoice_basis = excluded.invoice_basis, reason = excluded.reason,
        decided_by = excluded.decided_by, decided_by_name = excluded.decided_by_name, decided_at = now();
    end if;
    return jsonb_build_object('saved', true);

  elsif p_command = 'dispatch_weights' then
    select * into c from private.ap_ctx(array['owner', 'admin', 'accounts', 'sales_manager', 'sales', 'dispatch_manager', 'dispatch', 'factory_manager', 'inventory_manager', 'viewer']);
    v_dispatch := private.ap_uuid(p_payload, 'dispatch_id');
    if not exists (select 1 from public.dispatches where id = v_dispatch and company_id = c.company_id) then raise exception 'Not permitted' using errcode = '42501'; end if;
    select default_tolerance_percent into v_default from public.weight_basis_policy where company_id = c.company_id;
    return (
      with lines as (
        select pl.id, pl.bundle_number, pr.profile_code, pl.number_of_pieces pieces,
          coalesce(nullif(pl.cut_length, 0), nullif(pl.net_length_m / nullif(pl.number_of_pieces, 0), 0)) length_m,
          coalesce(nullif(pr.section_weight_kg_per_m, 0), nullif(pl.section_weight_kg_per_m, 0)) kg_per_m,
          coalesce(pl.net_weight_kg, pl.gross_weight_kg - coalesce(pl.tare_weight_kg, 0)) actual_kg,
          coalesce(pr.weight_tolerance_percent, v_default) tol,
          case when pr.weight_tolerance_percent is not null then 'profile' when v_default is not null then 'company' end tol_source
        from public.packing_list_items pl left join public.aluminium_profiles pr on pr.id = pl.profile_id and pr.company_id = c.company_id
        where pl.company_id = c.company_id and pl.dispatch_id = v_dispatch
      ), compared as (select l.*, private.weight_compare(l.pieces, l.length_m, l.kg_per_m, l.actual_kg, l.tol) w from lines l)
      select jsonb_build_object(
        'basis', private.weight_invoice_basis(c.company_id, (select o.customer_id from public.dispatches d join public.orders o on o.id = d.order_id where d.id = v_dispatch)),
        'lines', coalesce(jsonb_agg(jsonb_build_object('id', id, 'bundle', bundle_number, 'profile', profile_code, 'pieces', pieces, 'length_m', length_m, 'kg_per_m', kg_per_m,
          'tolerance_source', tol_source) || w order by bundle_number, id), '[]'::jsonb),
        'theoretical_kg', sum((w ->> 'theoretical_kg')::numeric), 'actual_kg', sum((w ->> 'actual_kg')::numeric),
        'outside_tolerance', count(*) filter (where w ->> 'state' in ('heavy', 'light')),
        'unknown', count(*) filter (where w ->> 'state' in ('no_theoretical', 'not_weighed', 'no_tolerance')))
      from compared);
  end if;
  raise exception 'AP: Unknown weight-basis request.';
end;
$$;
revoke all on function public.fs_weight_basis(text, jsonb) from public, anon;
grant execute on function public.fs_weight_basis(text, jsonb) to authenticated;

-- =====================================================================================================================
-- FS-75: delegation-of-authority matrix
-- =====================================================================================================================
-- transaction type x amount band x approving roles, with an optional second approver from an amount, temporary
-- delegation during leave, and the rule that nobody approves their own entry. Rules are never edited in place: a
-- change retires the rule and adds a new one. When a type has no active rule, the existing built-in rule for that
-- workflow still applies (so nothing changes until the owner configures the matrix).

create table if not exists public.authority_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('quote', 'low_margin_quote', 'expense', 'discount', 'credit_limit_override', 'stock_adjustment',
    'write_off', 'purchase_order', 'payment', 'concession', 'price_override')),
  min_amount numeric(16, 2) not null default 0 check (min_amount >= 0),
  max_amount numeric(16, 2) check (max_amount is null or max_amount > min_amount),
  approver_roles text[] not null check (cardinality(approver_roles) between 1 and 6),
  second_approver_from numeric(16, 2) check (second_approver_from is null or second_approver_from >= 0),
  second_approver_roles text[] check (second_approver_roles is null or cardinality(second_approver_roles) between 1 and 6),
  reason text not null check (length(reason) between 5 and 300),
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references auth.users(id),
  retired_reason text
);
create index if not exists authority_rules_active_idx on public.authority_rules(company_id, transaction_type, min_amount) where retired_at is null;
alter table public.authority_rules enable row level security;
revoke all on public.authority_rules from public, anon, authenticated;

create table if not exists public.authority_delegations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  from_user uuid not null references auth.users(id),
  to_user uuid not null references auth.users(id),
  transaction_types text[],
  starts_on date not null,
  ends_on date not null,
  reason text not null check (length(reason) between 5 and 300),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  check (from_user <> to_user),
  check (ends_on >= starts_on and ends_on - starts_on <= 90)
);
create index if not exists authority_delegations_idx on public.authority_delegations(company_id, to_user, starts_on, ends_on) where revoked_at is null;
alter table public.authority_delegations enable row level security;
revoke all on public.authority_delegations from public, anon, authenticated;

create table if not exists public.authority_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transaction_type text not null,
  source_type text not null,
  source_id uuid not null,
  source_version text,
  amount numeric(16, 2),
  rule_id uuid references public.authority_rules(id),
  step integer not null check (step in (1, 2)),
  completes boolean not null,
  approver_id uuid not null,
  approver_name text,
  approver_role text,
  via_delegation uuid references public.authority_delegations(id),
  requester_id uuid,
  approved_at timestamptz not null default now()
);
create index if not exists authority_approvals_idx on public.authority_approvals(company_id, approved_at desc);
create index if not exists authority_approvals_source_idx on public.authority_approvals(company_id, source_type, source_id, source_version);
alter table public.authority_approvals enable row level security;
revoke all on public.authority_approvals from public, anon, authenticated;
drop trigger if exists authority_approvals_immutable on public.authority_approvals;
create trigger authority_approvals_immutable before update or delete on public.authority_approvals for each row execute function private.fs_guard_append_only();

-- Whether p_actor may approve a p_type transaction of p_amount raised by p_requester, today.
create or replace function private.authority_check(p_company uuid, p_type text, p_amount numeric, p_actor uuid, p_requester uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare r public.authority_rules%rowtype; v_role text; v_delegation uuid; v_today date := private.business_today();
begin
  if not exists (select 1 from public.authority_rules where company_id = p_company and transaction_type = p_type and retired_at is null) then
    return jsonb_build_object('configured', false);
  end if;
  select * into r from public.authority_rules
  where company_id = p_company and transaction_type = p_type and retired_at is null
    and coalesce(p_amount, 0) >= min_amount and (max_amount is null or coalesce(p_amount, 0) < max_amount)
  order by min_amount desc limit 1;
  if r.id is null then
    return jsonb_build_object('configured', true, 'allowed', false, 'reason', 'No approval band covers INR ' || to_char(coalesce(p_amount, 0), 'FM999999999990.00') || ' for this transaction type.');
  end if;
  if p_requester is not null and p_requester = p_actor then
    return jsonb_build_object('configured', true, 'allowed', false, 'rule_id', r.id, 'reason', 'Nobody approves their own entry.');
  end if;
  select role into v_role from public.app_users where id = p_actor and company_id = p_company and is_active;
  if v_role = any(r.approver_roles) then
    return jsonb_build_object('configured', true, 'allowed', true, 'rule_id', r.id, 'role', v_role,
      'requires_second', r.second_approver_from is not null and coalesce(p_amount, 0) >= r.second_approver_from,
      'second_roles', to_jsonb(coalesce(r.second_approver_roles, r.approver_roles)));
  end if;
  -- Standing in for someone on leave: the delegator's role counts, for the dates and types delegated.
  select d.id, u.role into v_delegation, v_role from public.authority_delegations d join public.app_users u on u.id = d.from_user and u.company_id = p_company and u.is_active
  where d.company_id = p_company and d.to_user = p_actor and d.revoked_at is null and v_today between d.starts_on and d.ends_on
    and (d.transaction_types is null or p_type = any(d.transaction_types)) and u.role = any(r.approver_roles) and d.from_user is distinct from p_requester
  order by d.created_at limit 1;
  if v_delegation is not null then
    return jsonb_build_object('configured', true, 'allowed', true, 'rule_id', r.id, 'role', v_role, 'via_delegation', v_delegation,
      'requires_second', r.second_approver_from is not null and coalesce(p_amount, 0) >= r.second_approver_from,
      'second_roles', to_jsonb(coalesce(r.second_approver_roles, r.approver_roles)));
  end if;
  return jsonb_build_object('configured', true, 'allowed', false, 'rule_id', r.id, 'reason', 'Your role does not approve this amount: ' || array_to_string(r.approver_roles, ', ') || ' do.');
end;
$$;
revoke all on function private.authority_check(uuid, text, numeric, uuid, uuid) from public, anon, authenticated;

-- The approval inbox asks this function who may decide a quote or an expense; the matrix now answers when configured.
create or replace function private.approval_role_allowed(p_role text, p_type text, p_low_margin boolean, p_amount numeric)
returns boolean language plpgsql stable security definer set search_path = public, private as $$
declare v jsonb;
begin
  v := private.authority_check(private.get_current_user_company_id(), case when p_type = 'quote' and coalesce(p_low_margin, false) then 'low_margin_quote' else p_type end,
    p_amount, auth.uid(), null);
  if coalesce((v ->> 'configured')::boolean, false) then return coalesce((v ->> 'allowed')::boolean, false); end if;
  return case p_type
    when 'quote' then p_role in ('owner','admin') or (p_role = 'sales_manager' and not coalesce(p_low_margin, false))
    when 'expense' then p_role in ('owner','admin') or (p_role = 'accounts' and coalesce(p_amount, 0) <= private.expense_approval_threshold())
    else false end;
end;
$$;
revoke all on function private.approval_role_allowed(text, text, boolean, numeric) from public, anon, authenticated;

-- Enforcement at the record: approving a quote (internal_review -> approved_for_sending) or an expense
-- (pending_approval -> approved) under a configured rule records the approval; when a second approver is required
-- the first approval leaves the record as it was except for updated_at (its version moves on, so the inbox's
-- one-decision-per-version rule still holds) until a different permitted person approves that held version.
create or replace function private.authority_enforce(p_company uuid, p_type text, p_source_type text, p_source uuid, p_version text, p_hold_version text, p_amount numeric, p_requester uuid)
returns boolean language plpgsql security definer set search_path = public, private as $$
declare v jsonb; v_actor uuid := auth.uid(); v_first public.authority_approvals%rowtype; v_name text; v_role text;
begin
  if v_actor is null then return true; end if;
  v := private.authority_check(p_company, p_type, p_amount, v_actor, p_requester);
  if not coalesce((v ->> 'configured')::boolean, false) then return true; end if;
  if not (v ->> 'allowed')::boolean then raise exception 'AP: %', v ->> 'reason' using errcode = '42501'; end if;
  select coalesce(nullif(btrim(full_name), ''), email), role into v_name, v_role from public.app_users where id = v_actor;
  select * into v_first from public.authority_approvals where company_id = p_company and source_type = p_source_type and source_id = p_source
    and source_version = p_version and step = 1 and not completes order by approved_at desc limit 1;
  if not coalesce((v ->> 'requires_second')::boolean, false) then
    insert into public.authority_approvals(company_id, transaction_type, source_type, source_id, source_version, amount, rule_id, step, completes, approver_id, approver_name, approver_role, via_delegation, requester_id)
    values (p_company, p_type, p_source_type, p_source, p_version, p_amount, (v ->> 'rule_id')::uuid, 1, true, v_actor, v_name, v_role, (v ->> 'via_delegation')::uuid, p_requester);
    return true;
  end if;
  if v_first.id is null then
    insert into public.authority_approvals(company_id, transaction_type, source_type, source_id, source_version, amount, rule_id, step, completes, approver_id, approver_name, approver_role, via_delegation, requester_id)
    values (p_company, p_type, p_source_type, p_source, p_hold_version, p_amount, (v ->> 'rule_id')::uuid, 1, false, v_actor, v_name, v_role, (v ->> 'via_delegation')::uuid, p_requester);
    return false;
  end if;
  if v_first.approver_id = v_actor then raise exception 'AP: A second, different person must approve this amount.' using errcode = '42501'; end if;
  if not (coalesce(v_role, '') = any(array(select jsonb_array_elements_text(v -> 'second_roles'))) or (v ->> 'via_delegation') is not null) then
    raise exception 'AP: The second approval must come from: %.', (select string_agg(x, ', ') from jsonb_array_elements_text(v -> 'second_roles') x) using errcode = '42501';
  end if;
  insert into public.authority_approvals(company_id, transaction_type, source_type, source_id, source_version, amount, rule_id, step, completes, approver_id, approver_name, approver_role, via_delegation, requester_id)
  values (p_company, p_type, p_source_type, p_source, p_version, p_amount, (v ->> 'rule_id')::uuid, 2, true, v_actor, v_name, v_role, (v ->> 'via_delegation')::uuid, p_requester);
  return true;
end;
$$;
revoke all on function private.authority_enforce(uuid, text, text, uuid, text, text, numeric, uuid) from public, anon, authenticated;

create or replace function private.authority_quote_guard()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_hold public.quotes%rowtype;
begin
  if old.status = 'internal_review' and new.status = 'approved_for_sending' then
    v_hold := old; v_hold.updated_at := clock_timestamp();
    if not private.authority_enforce(new.company_id, case when old.low_margin_approval_required then 'low_margin_quote' else 'quote' end, 'quote', old.id,
        private.approval_quote_version(old), private.approval_quote_version(v_hold), old.grand_total, old.created_by) then
      return v_hold; -- first of two approvals: the quotation stays in review, otherwise unchanged
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.authority_quote_guard() from public, anon, authenticated;
-- Named to run after the other before-update triggers, so "unchanged" includes updated_at.
drop trigger if exists zz_fs_authority_quote on public.quotes;
create trigger zz_fs_authority_quote before update of status on public.quotes for each row execute function private.authority_quote_guard();

create or replace function private.authority_expense_guard()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_hold public.expense_ledger%rowtype;
begin
  if old.approval_status = 'pending_approval' and new.approval_status = 'approved' then
    v_hold := old; v_hold.updated_at := clock_timestamp();
    if not private.authority_enforce(new.company_id, 'expense', 'expense', old.id, private.approval_expense_version(old), private.approval_expense_version(v_hold), old.total_amount, old.created_by) then
      return v_hold;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.authority_expense_guard() from public, anon, authenticated;
drop trigger if exists zz_fs_authority_expense on public.expense_ledger;
create trigger zz_fs_authority_expense before update of approval_status on public.expense_ledger for each row execute function private.authority_expense_guard();

-- overview / save_rule / retire_rule / delegate / revoke_delegation (owner; admin may manage delegations), report
-- (owner/admin, a month), awaiting (who may see what is waiting for a second approval).
create or replace function public.fs_authority(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  c record; v_type text; v_min numeric; v_max numeric; v_roles text[]; v_second numeric; v_second_roles text[]; v_reason text; v_id uuid;
  v_from uuid; v_to uuid; v_start date; v_end date; v_types text[]; v_month date; v_allowed constant text[] := array['owner','admin','sales_manager','accounts','factory_manager','production_manager','inventory_manager','dispatch_manager','quality'];
begin
  if p_command = 'overview' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
    return jsonb_build_object(
      'rules', coalesce((select jsonb_agg(to_jsonb(r) - 'company_id' order by r.transaction_type, r.min_amount) from public.authority_rules r where r.company_id = c.company_id and r.retired_at is null), '[]'::jsonb),
      'retired', coalesce((select jsonb_agg(to_jsonb(r) - 'company_id' order by r.retired_at desc) from (select * from public.authority_rules where company_id = c.company_id and retired_at is not null order by retired_at desc limit 10) r), '[]'::jsonb),
      'delegations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'from', fu.full_name, 'to', tu.full_name, 'types', d.transaction_types, 'starts_on', d.starts_on,
          'ends_on', d.ends_on, 'reason', d.reason, 'revoked_at', d.revoked_at, 'active', d.revoked_at is null and private.business_today() between d.starts_on and d.ends_on) order by d.starts_on desc)
        from public.authority_delegations d left join public.app_users fu on fu.id = d.from_user left join public.app_users tu on tu.id = d.to_user
        where d.company_id = c.company_id and (d.revoked_at is null and d.ends_on >= private.business_today() - 30)), '[]'::jsonb),
      'people', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', coalesce(u.full_name, u.email), 'role', u.role) order by u.full_name)
        from public.app_users u where u.company_id = c.company_id and u.is_active and u.dealer_id is null and u.role = any(v_allowed)), '[]'::jsonb),
      'can_edit_rules', c.role = 'owner',
      'enforced_types', jsonb_build_array('quote', 'low_margin_quote', 'expense'));

  elsif p_command = 'save_rule' then
    select * into c from private.ap_ctx(array['owner']);
    v_type := p_payload ->> 'transaction_type';
    if v_type not in ('quote', 'low_margin_quote', 'expense', 'discount', 'credit_limit_override', 'stock_adjustment', 'write_off', 'purchase_order', 'payment', 'concession', 'price_override') then
      raise exception 'AP: Choose a transaction type.';
    end if;
    begin
      v_min := coalesce(nullif(p_payload ->> 'min_amount', '')::numeric, 0);
      v_max := nullif(p_payload ->> 'max_amount', '')::numeric;
      v_second := nullif(p_payload ->> 'second_approver_from', '')::numeric;
    exception when others then raise exception 'AP: Enter amounts as numbers.';
    end;
    if v_min < 0 or (v_max is not null and v_max <= v_min) then raise exception 'AP: The band must start at 0 or more and end above where it starts.'; end if;
    if v_second is not null and (v_second < v_min or (v_max is not null and v_second >= v_max)) then raise exception 'AP: The second-approver amount must fall inside the band.'; end if;
    select array_agg(distinct x) into v_roles from jsonb_array_elements_text(coalesce(p_payload -> 'approver_roles', '[]')) x;
    select array_agg(distinct x) into v_second_roles from jsonb_array_elements_text(coalesce(p_payload -> 'second_approver_roles', '[]')) x;
    if v_roles is null or not (v_roles <@ v_allowed) then raise exception 'AP: Choose at least one approving role.'; end if;
    if v_second_roles is not null and not (v_second_roles <@ v_allowed) then raise exception 'AP: Choose valid second-approver roles.'; end if;
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300);
    v_id := private.ap_uuid(p_payload, 'replaces', false);
    if v_id is not null then
      update public.authority_rules set retired_at = now(), retired_by = c.actor_id, retired_reason = 'Replaced: ' || v_reason
      where id = v_id and company_id = c.company_id and retired_at is null;
      if not found then raise exception 'AP: The rule being replaced was already changed. Reload.'; end if;
    end if;
    if exists (select 1 from public.authority_rules where company_id = c.company_id and transaction_type = v_type and retired_at is null
      and numrange(min_amount, max_amount, '[)') && numrange(v_min, v_max, '[)')) then
      raise exception 'AP: This band overlaps an active band for the same transaction type. Replace or retire that rule first.';
    end if;
    insert into public.authority_rules(company_id, transaction_type, min_amount, max_amount, approver_roles, second_approver_from, second_approver_roles, reason, created_by, created_by_name)
    values (c.company_id, v_type, v_min, v_max, v_roles, v_second, v_second_roles, v_reason, c.actor_id, c.full_name) returning id into v_id;
    return jsonb_build_object('id', v_id);

  elsif p_command = 'retire_rule' then
    select * into c from private.ap_ctx(array['owner']);
    v_id := private.ap_uuid(p_payload, 'id');
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300);
    update public.authority_rules set retired_at = now(), retired_by = c.actor_id, retired_reason = v_reason where id = v_id and company_id = c.company_id and retired_at is null;
    if not found then raise exception 'AP: This rule was already retired. Reload.'; end if;
    return jsonb_build_object('retired', true);

  elsif p_command = 'delegate' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
    v_from := private.ap_uuid(p_payload, 'from_user'); v_to := private.ap_uuid(p_payload, 'to_user');
    if v_from = v_to then raise exception 'AP: Choose two different people.'; end if;
    if (select count(*) from public.app_users where id in (v_from, v_to) and company_id = c.company_id and is_active and dealer_id is null) <> 2 then raise exception 'Not permitted' using errcode = '42501'; end if;
    if c.role = 'admin' and exists (select 1 from public.app_users where id = v_from and role = 'owner') then raise exception 'AP: Only the owner can delegate the owner''s authority.' using errcode = '42501'; end if;
    begin v_start := (p_payload ->> 'starts_on')::date; v_end := (p_payload ->> 'ends_on')::date; exception when others then raise exception 'AP: Use dates as YYYY-MM-DD.'; end;
    if v_start is null or v_end is null or v_end < v_start or v_end - v_start > 90 or v_end < private.business_today() then raise exception 'AP: Choose a leave period of up to 90 days that has not ended.'; end if;
    select array_agg(distinct x) into v_types from jsonb_array_elements_text(coalesce(p_payload -> 'transaction_types', '[]')) x;
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300);
    insert into public.authority_delegations(company_id, from_user, to_user, transaction_types, starts_on, ends_on, reason, created_by)
    values (c.company_id, v_from, v_to, v_types, v_start, v_end, v_reason, c.actor_id) returning id into v_id;
    return jsonb_build_object('id', v_id);

  elsif p_command = 'revoke_delegation' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
    v_id := private.ap_uuid(p_payload, 'id');
    update public.authority_delegations set revoked_at = now(), revoked_by = c.actor_id where id = v_id and company_id = c.company_id and revoked_at is null;
    if not found then raise exception 'AP: This delegation was already ended. Reload.'; end if;
    return jsonb_build_object('revoked', true);

  elsif p_command = 'report' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
    begin v_month := date_trunc('month', coalesce(nullif(p_payload ->> 'month', '')::date, private.business_today()))::date; exception when others then raise exception 'AP: Use a month as YYYY-MM-01.'; end;
    return jsonb_build_object('month', v_month,
      'approvals', coalesce((select jsonb_agg(jsonb_build_object('at', a.approved_at, 'type', a.transaction_type, 'source_type', a.source_type, 'source_id', a.source_id,
          'reference', coalesce(q.quote_number, e.expense_number), 'amount', a.amount, 'step', a.step, 'completes', a.completes, 'approver', a.approver_name, 'role', a.approver_role,
          'delegated', a.via_delegation is not null, 'requester', ru.full_name) order by a.approved_at desc)
        from public.authority_approvals a
        left join public.quotes q on a.source_type = 'quote' and q.id = a.source_id
        left join public.expense_ledger e on a.source_type = 'expense' and e.id = a.source_id
        left join public.app_users ru on ru.id = a.requester_id
        where a.company_id = c.company_id and (a.approved_at at time zone 'Asia/Kolkata')::date >= v_month and (a.approved_at at time zone 'Asia/Kolkata')::date < (v_month + interval '1 month')::date), '[]'::jsonb),
      'delegated_count', (select count(*) from public.authority_approvals a where a.company_id = c.company_id and a.via_delegation is not null
        and (a.approved_at at time zone 'Asia/Kolkata')::date >= v_month and (a.approved_at at time zone 'Asia/Kolkata')::date < (v_month + interval '1 month')::date));

  elsif p_command = 'awaiting' then
    select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'accounts']);
    return coalesce((select jsonb_agg(jsonb_build_object('source_type', a.source_type, 'source_id', a.source_id, 'first_approver', a.approver_name, 'at', a.approved_at))
      from public.authority_approvals a
      where a.company_id = c.company_id and a.step = 1 and not a.completes
        and not exists (select 1 from public.authority_approvals b where b.company_id = a.company_id and b.source_id = a.source_id and b.source_version = a.source_version and b.step = 2)
        and ((a.source_type = 'quote' and exists (select 1 from public.quotes q where q.id = a.source_id and q.status = 'internal_review' and private.approval_quote_version(q) = a.source_version))
          or (a.source_type = 'expense' and exists (select 1 from public.expense_ledger e where e.id = a.source_id and e.approval_status = 'pending_approval' and private.approval_expense_version(e) = a.source_version)))), '[]'::jsonb);
  end if;
  raise exception 'AP: Unknown authority request.';
end;
$$;
revoke all on function public.fs_authority(text, jsonb) from public, anon;
grant execute on function public.fs_authority(text, jsonb) to authenticated;
