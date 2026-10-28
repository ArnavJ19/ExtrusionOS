-- UPGRADE_EOS feature 85: approved dated costing rates.
--
-- Billet, conversion and finishing rates are kept as dated, approved records instead of
-- free-typed numbers. A rate has a type, a basis (per kg / per sqft / per metre), an optional
-- customer (a customer agreement) and an optional scope (alloy for billet, finishing type for
-- finishing), and applies from effective_from to effective_to. Precedence when a quotation needs
-- a rate on its quote date: an approved customer-specific rate, else the approved general rate.
-- A draft is approved by someone other than its author (owners may approve their own); approving
-- a new rate ends the predecessor's period the day before. A rate that has ended with no
-- successor is "expired" and appears for review. When a quotation is approved for sending, the
-- rates applicable on its quote date are bound to that revision and never change afterwards, so
-- an accepted quotation retains the rate version originally agreed. A check compares each line's
-- entered rates with the applicable approved rate (bound or current). Rates are commercial data:
-- only owner, admin, sales and accounts roles can read them. Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.costing_rates (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  rate_type text not null check (rate_type in ('billet','conversion','finishing')),
  basis text not null check (basis in ('per_kg','per_sqft','per_meter')),
  customer_id uuid references public.customers(id),
  alloy text check (alloy is null or alloy ~ '^[0-9A-Z]{3,8}$'),
  finishing_type text check (finishing_type is null or finishing_type ~ '^[a-z_]{3,40}$'),
  rate numeric(14,4) not null check (rate > 0),
  effective_from date not null,
  effective_to date,
  status text not null default 'draft' check (status in ('draft','approved','withdrawn')),
  note text check (note is null or length(note) <= 300),
  created_by uuid not null references public.app_users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  approved_by uuid references public.app_users(id),
  approved_by_name text,
  approved_at timestamptz,
  withdrawn_at timestamptz,
  withdraw_reason text,
  check (effective_to is null or effective_to >= effective_from),
  check ((rate_type = 'billet') or alloy is null),
  check ((rate_type = 'finishing') = (finishing_type is not null)),
  check (rate_type = 'finishing' or basis = 'per_kg')
);
create index costing_rates_lookup_idx on public.costing_rates(company_id, rate_type, status, effective_from desc);
create index costing_rates_customer_idx on public.costing_rates(customer_id);
create index costing_rates_created_by_idx on public.costing_rates(created_by);
create index costing_rates_approved_by_idx on public.costing_rates(approved_by);

create table public.quote_rate_bindings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_number integer not null,
  rate_type text not null,
  basis text not null,
  finishing_type text,
  rate_id uuid not null references public.costing_rates(id),
  rate numeric(14,4) not null,
  customer_specific boolean not null,
  effective_from date not null,
  bound_at timestamptz not null default now()
);
create unique index quote_rate_bindings_key on public.quote_rate_bindings(quote_id, revision_number, rate_type, basis, coalesce(finishing_type, ''));
create index quote_rate_bindings_company_idx on public.quote_rate_bindings(company_id, quote_id);
create index quote_rate_bindings_rate_idx on public.quote_rate_bindings(rate_id);

alter table public.costing_rates enable row level security;
alter table public.quote_rate_bindings enable row level security;
revoke all on public.costing_rates, public.quote_rate_bindings from public, anon, authenticated;
grant select on public.costing_rates, public.quote_rate_bindings to authenticated;
create policy costing_rates_read on public.costing_rates for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts'));
create policy quote_rate_bindings_read on public.quote_rate_bindings for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts'));

-- The approved rate applicable on a date: customer-specific first, then general; scope must match.
create or replace function private.applicable_costing_rate(p_company uuid, p_type text, p_basis text, p_date date, p_customer uuid, p_alloy text, p_finishing text)
returns public.costing_rates language sql stable security definer set search_path = public, private as $$
  select r.* from public.costing_rates r
  where r.company_id = p_company and r.rate_type = p_type and r.basis = p_basis and r.status = 'approved'
    and r.effective_from <= p_date and (r.effective_to is null or r.effective_to >= p_date)
    and (r.customer_id is null or r.customer_id = p_customer)
    and (r.alloy is null or r.alloy = p_alloy)
    and r.finishing_type is not distinct from p_finishing
  order by (r.customer_id is not null) desc, (r.alloy is not null) desc, r.effective_from desc
  limit 1
$$;
revoke all on function private.applicable_costing_rate(uuid, text, text, date, uuid, text, text) from public, anon, authenticated;

-- Basis of a quote line's finishing charge, as a costing-rate basis (null when not comparable).
create or replace function private.finishing_basis(p_charge_type text)
returns text language sql immutable set search_path = public, private as $$
  select case p_charge_type when 'per_kg' then 'per_kg' when 'per_sqft' then 'per_sqft' when 'per_meter' then 'per_meter' when 'per_m' then 'per_meter' end
$$;
revoke all on function private.finishing_basis(text) from public, anon, authenticated;

-- Binds the applicable rates to a quote revision once (on approval for sending).
create or replace function private.bind_quote_rates(p_quote uuid)
returns integer language plpgsql security definer set search_path = public, private as $$
declare q public.quotes%rowtype; v_need record; v_rate public.costing_rates%rowtype; v_bound integer := 0;
begin
  select * into q from public.quotes where id = p_quote;
  if not found then return 0; end if;
  for v_need in
    select 'billet'::text as rate_type, 'per_kg'::text as basis, null::text as finishing_type
    union select 'conversion', 'per_kg', null
    union select distinct 'finishing', private.finishing_basis(i.finishing_charge_type), i.finishing_type
      from public.quote_items i where i.company_id = q.company_id and i.quote_id = q.id
        and i.finishing_type is not null and i.finishing_type <> 'mill_finish' and private.finishing_basis(i.finishing_charge_type) is not null
  loop
    v_rate := private.applicable_costing_rate(q.company_id, v_need.rate_type, v_need.basis, q.quote_date, q.customer_id, null, v_need.finishing_type);
    if v_rate.id is not null then
      insert into public.quote_rate_bindings(company_id, quote_id, revision_number, rate_type, basis, finishing_type, rate_id, rate, customer_specific, effective_from)
      values (q.company_id, q.id, q.revision_number, v_need.rate_type, v_need.basis, v_need.finishing_type, v_rate.id, v_rate.rate, v_rate.customer_id is not null, v_rate.effective_from)
      on conflict do nothing;
      if found then v_bound := v_bound + 1; end if;
    end if;
  end loop;
  return v_bound;
end;
$$;
revoke all on function private.bind_quote_rates(uuid) from public, anon, authenticated;

create or replace function private.bind_rates_on_quote_approval()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.status = 'approved_for_sending' and old.status is distinct from 'approved_for_sending' then
    perform private.bind_quote_rates(new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.bind_rates_on_quote_approval() from public, anon, authenticated;
drop trigger if exists zz_bind_rates_on_quote_approval on public.quotes;
create trigger zz_bind_rates_on_quote_approval after update on public.quotes for each row execute function private.bind_rates_on_quote_approval();

create or replace function public.costing_rate_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  r public.costing_rates%rowtype; v_prev public.costing_rates%rowtype; v_rate public.costing_rates%rowtype;
  q public.quotes%rowtype; v_today date := (now() at time zone 'Asia/Kolkata')::date; v_date date; v_customer uuid;
  v_page integer; v_total bigint; v_rows jsonb; v_lines jsonb; v_bindings jsonb; v_text text;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid costing rate request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found or p_command not in ('rates.list','rates.save_draft','rates.approve','rates.withdraw','rates.lookup','rates.review','quote.check')
     or v_role not in ('owner','admin','sales_manager','sales','accounts')
     or (p_command in ('rates.save_draft','rates.withdraw') and v_role not in ('owner','admin','sales_manager','accounts'))
     or (p_command = 'rates.approve' and v_role not in ('owner','admin','sales_manager')) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'rates.save_draft' then
    v_customer := nullif(p_payload ->> 'customer_id', '')::uuid;
    if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and company_id = v_company) then raise exception 'Customer is unavailable'; end if;
    select * into r from public.costing_rates where id = (p_payload ->> 'id')::uuid;
    if found and (r.company_id <> v_company or r.status <> 'draft') then raise exception 'Only a draft rate can be edited'; end if;
    v_text := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
    begin
      insert into public.costing_rates(id, company_id, rate_type, basis, customer_id, alloy, finishing_type, rate, effective_from, effective_to, note, created_by, created_by_name)
      values ((p_payload ->> 'id')::uuid, v_company, p_payload ->> 'rate_type', coalesce(p_payload ->> 'basis', 'per_kg'), v_customer,
        nullif(upper(btrim(coalesce(p_payload ->> 'alloy', ''))), ''), nullif(lower(btrim(coalesce(p_payload ->> 'finishing_type', ''))), ''),
        (p_payload ->> 'rate')::numeric, (p_payload ->> 'effective_from')::date, nullif(p_payload ->> 'effective_to', '')::date, v_text, v_actor, v_name)
      -- Whoever last edits a draft becomes its author, so an editor cannot approve their own figures.
      on conflict (id) do update set rate_type = excluded.rate_type, basis = excluded.basis, customer_id = excluded.customer_id, alloy = excluded.alloy,
        finishing_type = excluded.finishing_type, rate = excluded.rate, effective_from = excluded.effective_from, effective_to = excluded.effective_to, note = excluded.note,
        created_by = excluded.created_by, created_by_name = excluded.created_by_name
      returning * into r;
    exception when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'Enter a positive rate, a valid start (and optional end) date, and a scope that matches the rate type';
    end;
    return jsonb_build_object('id', r.id);

  elsif p_command = 'rates.approve' then
    select * into r from public.costing_rates where id = (p_payload ->> 'id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Rate is unavailable'; end if;
    if r.status <> 'draft' then raise exception 'Only a draft rate can be approved'; end if;
    if r.created_by = v_actor and v_role <> 'owner' then raise exception 'Another person must approve a rate you entered' using errcode = '42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':rate:' || r.rate_type || r.basis || coalesce(r.customer_id::text, '') || coalesce(r.alloy, '') || coalesce(r.finishing_type, ''), 0));
    if exists (select 1 from public.costing_rates x where x.company_id = v_company and x.status = 'approved' and x.rate_type = r.rate_type and x.basis = r.basis
               and x.customer_id is not distinct from r.customer_id and x.alloy is not distinct from r.alloy and x.finishing_type is not distinct from r.finishing_type
               and x.effective_from >= r.effective_from) then
      raise exception 'A rate for the same scope already starts on or after %. Withdraw it or choose a later start', r.effective_from;
    end if;
    -- The predecessor ends the day before the new rate starts.
    update public.costing_rates x set effective_to = r.effective_from - 1
    where x.company_id = v_company and x.status = 'approved' and x.rate_type = r.rate_type and x.basis = r.basis
      and x.customer_id is not distinct from r.customer_id and x.alloy is not distinct from r.alloy and x.finishing_type is not distinct from r.finishing_type
      and (x.effective_to is null or x.effective_to >= r.effective_from);
    update public.costing_rates set status = 'approved', approved_by = v_actor, approved_by_name = v_name, approved_at = now() where id = r.id;
    return jsonb_build_object('id', r.id);

  elsif p_command = 'rates.withdraw' then
    select * into r from public.costing_rates where id = (p_payload ->> 'id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Rate is unavailable'; end if;
    v_text := btrim(coalesce(p_payload ->> 'reason', ''));
    if length(v_text) not between 3 and 300 then raise exception 'Record why the rate is withdrawn (3 to 300 characters)'; end if;
    if r.status = 'withdrawn' then raise exception 'This rate is already withdrawn'; end if;
    if r.status = 'approved' and exists (select 1 from public.quote_rate_bindings where rate_id = r.id) then
      raise exception 'This rate is bound to issued quotations. End it with a newer approved rate instead of withdrawing it';
    end if;
    update public.costing_rates set status = 'withdrawn', withdrawn_at = now(), withdraw_reason = v_text where id = r.id;
    return jsonb_build_object('id', r.id);

  elsif p_command = 'rates.lookup' then
    -- Approved rates applicable on a date for a customer, to fill a new quotation line.
    v_date := coalesce(nullif(p_payload ->> 'date', '')::date, v_today);
    v_customer := nullif(p_payload ->> 'customer_id', '')::uuid;
    return jsonb_build_object('date', v_date,
      'billet', (select to_jsonb(x) - 'company_id' from private.applicable_costing_rate(v_company, 'billet', 'per_kg', v_date, v_customer, nullif(upper(p_payload ->> 'alloy'), ''), null) x where x.id is not null),
      'conversion', (select to_jsonb(x) - 'company_id' from private.applicable_costing_rate(v_company, 'conversion', 'per_kg', v_date, v_customer, null, null) x where x.id is not null),
      'finishing', case when nullif(p_payload ->> 'finishing_type', '') is null then null else
        (select to_jsonb(x) - 'company_id' from private.applicable_costing_rate(v_company, 'finishing', coalesce(p_payload ->> 'finishing_basis', 'per_kg'), v_date, v_customer, null, lower(p_payload ->> 'finishing_type')) x where x.id is not null) end);

  elsif p_command = 'rates.review' then
    -- Approved rates that have ended or end within 14 days without a successor.
    return coalesce((select jsonb_agg(to_jsonb(x) - 'company_id' || jsonb_build_object('expired', x.effective_to < v_today,
        'customer_name', (select coalesce(company_name, customer_name) from public.customers where id = x.customer_id)) order by x.effective_to, x.rate_type)
      from public.costing_rates x
      where x.company_id = v_company and x.status = 'approved' and x.effective_to is not null and x.effective_to < v_today + 14
        and not exists (select 1 from public.costing_rates s where s.company_id = v_company and s.status = 'approved' and s.rate_type = x.rate_type and s.basis = x.basis
                        and s.customer_id is not distinct from x.customer_id and s.alloy is not distinct from x.alloy and s.finishing_type is not distinct from x.finishing_type
                        and s.effective_from > x.effective_to)), '[]'::jsonb);

  elsif p_command = 'quote.check' then
    select * into q from public.quotes where id = (p_payload ->> 'quote_id')::uuid and company_id = v_company and deleted_at is null;
    if not found then raise exception 'Quotation is unavailable'; end if;
    select coalesce(jsonb_agg(to_jsonb(b) - 'company_id' order by b.rate_type, b.finishing_type), '[]'::jsonb) into v_bindings
    from public.quote_rate_bindings b where b.quote_id = q.id and b.revision_number = q.revision_number;
    select coalesce(jsonb_agg(line order by seq), '[]'::jsonb) into v_lines from (
      select row_number() over (order by i.created_at, i.id) as seq, jsonb_build_object(
        'item_id', i.id, 'description', coalesce(i.section_name, i.item_description, i.component_description, 'Line'),
        'checks', (select coalesce(jsonb_agg(c order by n), '[]'::jsonb) from (values
          (1, private.rate_check('billet', i.billet_rate_per_kg, q, 'per_kg', null)),
          (2, private.rate_check('conversion', i.conversion_charge_per_kg, q, 'per_kg', null)),
          (3, case when i.finishing_type is not null and i.finishing_type <> 'mill_finish' and private.finishing_basis(i.finishing_charge_type) is not null
            then private.rate_check('finishing', i.finishing_charge, q, private.finishing_basis(i.finishing_charge_type), i.finishing_type) end)
        ) as checks(n, c) where c is not null)
      ) as line
      from public.quote_items i where i.company_id = v_company and i.quote_id = q.id) lines;
    return jsonb_build_object('quote_id', q.id, 'quote_date', q.quote_date, 'revision_number', q.revision_number, 'bound', jsonb_array_length(v_bindings) > 0, 'bindings', v_bindings, 'lines', v_lines);
  end if;

  -- rates.list
  v_page := coalesce((p_payload ->> 'page')::integer, 1);
  if v_page < 1 or v_page > 100000 or coalesce(p_payload ->> 'status', 'current') not in ('current','draft','history') then raise exception 'Invalid rate list request'; end if;
  with visible as (
    select x.* from public.costing_rates x
    where x.company_id = v_company and (nullif(p_payload ->> 'rate_type', '') is null or x.rate_type = p_payload ->> 'rate_type')
      and case coalesce(p_payload ->> 'status', 'current')
        when 'current' then x.status = 'approved' and (x.effective_to is null or x.effective_to >= v_today)
        when 'draft' then x.status = 'draft'
        else x.status = 'withdrawn' or (x.status = 'approved' and x.effective_to < v_today) end
  )
  select (select count(*) from visible),
    coalesce((select jsonb_agg(to_jsonb(v) - 'company_id' || jsonb_build_object('customer_name', (select coalesce(company_name, customer_name) from public.customers where id = v.customer_id),
        'in_effect', v.status = 'approved' and v.effective_from <= v_today and (v.effective_to is null or v.effective_to >= v_today)))
      from (select * from visible order by rate_type, customer_id nulls first, finishing_type nulls first, effective_from desc, id limit 10 offset (v_page - 1) * 10) v), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;

-- One rate comparison for a quote line: bound rate for the revision if bound, else the rate
-- applicable on the quote date; "expired" when the latest rate for the scope ended before it.
create or replace function private.rate_check(p_type text, p_entered numeric, q public.quotes, p_basis text, p_finishing text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare b public.quote_rate_bindings%rowtype; v_rate public.costing_rates%rowtype; v_expected numeric; v_source text; v_rate_id uuid; v_last date;
begin
  select * into b from public.quote_rate_bindings where quote_id = q.id and revision_number = q.revision_number and rate_type = p_type and basis = p_basis and finishing_type is not distinct from p_finishing;
  if found then v_expected := b.rate; v_source := 'bound'; v_rate_id := b.rate_id;
  else
    v_rate := private.applicable_costing_rate(q.company_id, p_type, p_basis, q.quote_date, q.customer_id, null, p_finishing);
    if v_rate.id is not null then v_expected := v_rate.rate; v_source := case when v_rate.customer_id is null then 'general' else 'customer' end; v_rate_id := v_rate.id; end if;
  end if;
  if v_expected is null then
    select max(effective_to) into v_last from public.costing_rates x where x.company_id = q.company_id and x.status = 'approved' and x.rate_type = p_type and x.basis = p_basis
      and x.finishing_type is not distinct from p_finishing and (x.customer_id is null or x.customer_id = q.customer_id) and x.effective_to < q.quote_date;
    return jsonb_build_object('rate_type', p_type, 'basis', p_basis, 'finishing_type', p_finishing, 'entered', p_entered, 'approved', null,
      'status', case when v_last is not null then 'expired_rate' else 'no_rate' end, 'expired_on', v_last);
  end if;
  return jsonb_build_object('rate_type', p_type, 'basis', p_basis, 'finishing_type', p_finishing, 'entered', p_entered, 'approved', v_expected, 'source', v_source, 'rate_id', v_rate_id,
    'status', case when coalesce(p_entered, 0) = v_expected then 'matches' when coalesce(p_entered, 0) < v_expected then 'below_approved' else 'above_approved' end,
    'difference', round(coalesce(p_entered, 0) - v_expected, 4));
end;
$$;
revoke all on function private.rate_check(text, numeric, public.quotes, text, text) from public, anon, authenticated;
revoke all on function public.costing_rate_command(text, jsonb) from public, anon;
grant execute on function public.costing_rate_command(text, jsonb) to authenticated;

commit;
