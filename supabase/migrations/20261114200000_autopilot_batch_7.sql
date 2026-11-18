-- Autopilot batch 7: AP-086, 090, 099, 003, 025, 039, 040, 057, 064 and 079.
-- Additive. Depends on batches 1-6. AP-086 (date chips), AP-090 (recent values), AP-099 (paste attachments) and AP-025
-- (keyboard-wedge scanner) are screen changes and need no schema. Nothing here posts stock, money, quality approval or a
-- customer message by itself: delay notices and statements are prepared for a person to edit, send or skip.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------------------------
-- Date as people read it on a message: 05 Dec 2026.
create or replace function private.ap7_day(p_day date)
returns text language sql immutable set search_path = public, private as $$
  select case when p_day is null then null else to_char(p_day, 'DD Mon YYYY') end
$$;
revoke all on function private.ap7_day(date) from public, anon, authenticated;

create or replace function private.ap7_date(p_payload jsonb, p_key text, p_required boolean default true)
returns date language plpgsql immutable set search_path = public, private as $$
declare v text := nullif(btrim(coalesce(p_payload ->> p_key, '')), '');
begin
  if v is null then
    if p_required then raise exception 'AP: Choose a date for %.', replace(p_key, '_', ' '); end if;
    return null;
  end if;
  if v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'AP: Enter the % as a date.', replace(p_key, '_', ' '); end if;
  return v::date;
end;
$$;
revoke all on function private.ap7_date(jsonb, text, boolean) from public, anon, authenticated;

-- First working day of the month that contains p_day (AP-004 factory calendar).
create or replace function private.ap7_first_working_day(p_company uuid, p_day date)
returns date language plpgsql stable security definer set search_path = public, private as $$
declare v date := date_trunc('month', p_day)::date;
begin
  for n in 0..27 loop
    if private.factory_is_working_day(p_company, v + n) then return v + n; end if;
  end loop;
  return v;
end;
$$;
revoke all on function private.ap7_first_working_day(uuid, date) from public, anon, authenticated;

create or replace function private.ap7_customer_contact(p_customer uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'name', coalesce(nullif(btrim(c.contact_person), ''), nullif(btrim(c.company_name), ''), c.customer_name),
    'customer', coalesce(nullif(btrim(c.company_name), ''), c.customer_name),
    'phone', coalesce(nullif(btrim(c.whatsapp_number), ''), nullif(btrim(c.phone), '')),
    'email', nullif(btrim(c.email), ''))
  from public.customers c where c.id = p_customer
$$;
revoke all on function private.ap7_customer_contact(uuid) from public, anon, authenticated;

create or replace function private.ap7_company_name(p_company uuid)
returns text language sql stable security definer set search_path = public, private as $$
  select coalesce(nullif(btrim(c.legal_name), ''), c.name) from public.companies c where c.id = p_company
$$;
revoke all on function private.ap7_company_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-003: how often each proposal type is accepted, edited, rejected or ignored
-- ---------------------------------------------------------------------------------------------------------------
-- The role of the person who decided, recorded at the decision so the read model groups by role, not by person.
alter table public.proposals add column if not exists decided_role text;
create or replace function private.ap7_proposal_decided_role()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.decided_by is not null and new.decided_by is distinct from old.decided_by then
    new.decided_role := (select u.role from public.app_users u where u.id = new.decided_by);
  end if;
  return new;
end;
$$;
revoke all on function private.ap7_proposal_decided_role() from public, anon, authenticated;
drop trigger if exists zzz_ap7_decided_role on public.proposals;
create trigger zzz_ap7_decided_role before update of decided_by on public.proposals
  for each row execute function private.ap7_proposal_decided_role();
update public.proposals p set decided_role = u.role from public.app_users u where u.id = p.decided_by and p.decided_role is null;
create index if not exists proposals_company_type_created_idx on public.proposals(company_id, proposal_type, created_at desc);

-- A process owner records when a rule changed, so acceptance before and after can be compared.
create table if not exists public.automation_rule_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  proposal_type text not null check (length(proposal_type) between 3 and 60),
  changed_on date not null,
  description text not null check (length(btrim(description)) between 10 and 500),
  recorded_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists automation_rule_changes_company_idx on public.automation_rule_changes(company_id, changed_on desc, proposal_type);

-- Counts for proposals created in [from, to). Fields typed: accepted = 0, edited = number of fields changed.
create or replace function private.ap7_quality_stats(p_company uuid, p_type text, p_from timestamptz, p_to timestamptz, p_role text default null)
returns jsonb language sql stable security definer set search_path = public, private as $$
  with p as (
    select x.status, x.edited_fields, x.created_at, x.decided_at from public.proposals x
    where x.company_id = p_company and (p_type is null or x.proposal_type = p_type)
      and x.created_at >= p_from and x.created_at < p_to and (p_role is null or x.decided_role = p_role)),
  s as (
    select count(*) total,
      count(*) filter (where status = 'accepted') accepted, count(*) filter (where status = 'edited') edited,
      count(*) filter (where status = 'rejected') rejected, count(*) filter (where status = 'expired') ignored,
      count(*) filter (where status = 'stale') stale, count(*) filter (where status = 'open') open,
      avg(case status when 'accepted' then 0 when 'edited' then cardinality(edited_fields) end) fields_typed,
      percentile_cont(0.5) within group (order by extract(epoch from decided_at - created_at) / 60.0) filter (where decided_at is not null) median_minutes
    from p)
  select jsonb_build_object('total', total, 'accepted', accepted, 'edited', edited, 'rejected', rejected, 'ignored', ignored, 'stale', stale, 'open', open,
    'decided', accepted + edited + rejected,
    'acceptance_rate', case when accepted + edited + rejected > 0 then round(accepted * 100.0 / (accepted + edited + rejected), 1) end,
    'edit_rate', case when accepted + edited + rejected > 0 then round(edited * 100.0 / (accepted + edited + rejected), 1) end,
    'reject_rate', case when accepted + edited + rejected > 0 then round(rejected * 100.0 / (accepted + edited + rejected), 1) end,
    'ignored_rate', case when accepted + edited + rejected + ignored > 0 then round(ignored * 100.0 / (accepted + edited + rejected + ignored), 1) end,
    'fields_typed', round(fields_typed::numeric, 2), 'median_minutes', round(median_minutes::numeric, 1))
  from s
$$;
revoke all on function private.ap7_quality_stats(uuid, text, timestamptz, timestamptz, text) from public, anon, authenticated;

-- Review flags: overridden more than accepted (the principle's review rule), or a 100% rate worth sampling.
create or replace function private.ap7_quality_flags(p_stats jsonb)
returns text[] language sql immutable set search_path = public, private as $$
  select array_remove(array[
    case when (p_stats ->> 'decided')::integer >= 5 and (p_stats ->> 'edited')::integer + (p_stats ->> 'rejected')::integer > (p_stats ->> 'accepted')::integer then 'review' end,
    case when (p_stats ->> 'decided')::integer >= 20 and (p_stats ->> 'accepted')::integer = (p_stats ->> 'decided')::integer then 'sample' end,
    case when (p_stats ->> 'total')::integer >= 5 and coalesce((p_stats ->> 'ignored_rate')::numeric, 0) > 50 then 'ignored' end
  ], null)
$$;
revoke all on function private.ap7_quality_flags(jsonb) from public, anon, authenticated;

create or replace function private.ap7_quality_compare(p_company uuid, p_change public.automation_rule_changes)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_days integer := least(28, greatest(0, private.ist_today() - p_change.changed_on)); v_at timestamptz := (p_change.changed_on::timestamp at time zone 'Asia/Kolkata');
  v_before jsonb; v_after jsonb;
begin
  v_before := private.ap7_quality_stats(p_company, p_change.proposal_type, v_at - make_interval(days => greatest(v_days, 1)), v_at);
  v_after := case when v_days = 0 then null else private.ap7_quality_stats(p_company, p_change.proposal_type, v_at, v_at + make_interval(days => v_days)) end;
  return jsonb_build_object('window_days', v_days, 'before', v_before, 'after', v_after,
    'rules_before', (select coalesce(jsonb_agg(distinct x.rule_key), '[]') from public.proposals x where x.company_id = p_company and x.proposal_type = p_change.proposal_type
      and x.created_at >= v_at - make_interval(days => greatest(v_days, 1)) and x.created_at < v_at),
    'rules_after', (select coalesce(jsonb_agg(distinct x.rule_key), '[]') from public.proposals x where x.company_id = p_company and x.proposal_type = p_change.proposal_type
      and x.created_at >= v_at and x.created_at < v_at + make_interval(days => v_days)),
    'acceptance_change', case when v_after is not null and v_before ->> 'acceptance_rate' is not null and v_after ->> 'acceptance_rate' is not null
      then round((v_after ->> 'acceptance_rate')::numeric - (v_before ->> 'acceptance_rate')::numeric, 1) end,
    'fields_typed_change', case when v_after is not null and v_before ->> 'fields_typed' is not null and v_after ->> 'fields_typed' is not null
      then round((v_after ->> 'fields_typed')::numeric - (v_before ->> 'fields_typed')::numeric, 2) end,
    'state', case when v_days = 0 then 'too_early' when (v_after ->> 'decided')::integer < 5 or (v_before ->> 'decided')::integer < 5 then 'few_decisions' else 'comparable' end);
end;
$$;
revoke all on function private.ap7_quality_compare(uuid, public.automation_rule_changes) from public, anon, authenticated;

create or replace function public.ap_quality(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_weeks integer; v_from timestamptz; v_type text; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload);
  v_week date; v_change public.automation_rule_changes%rowtype; v_day date;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager']);
  v_weeks := case when coalesce(p_payload ->> 'weeks', '4') in ('4', '12') then coalesce(p_payload ->> 'weeks', '4')::integer else null end;
  if v_weeks is null then raise exception 'AP: Choose 4 or 12 weeks.'; end if;
  v_from := clock_timestamp() - make_interval(days => v_weeks * 7);
  if p_command = 'overview' then
    perform private.ap_keys(p_payload, array['weeks']);
    select coalesce(jsonb_agg(z.r order by (z.r -> 'stats' ->> 'total')::integer desc, z.r ->> 'proposal_type'), '[]') into v_rows from (
      select jsonb_build_object('proposal_type', t.proposal_type, 'stats', s, 'flags', to_jsonb(private.ap7_quality_flags(s))) r
      from (select distinct x.proposal_type from public.proposals x where x.company_id = c.company_id and x.created_at >= v_from) t,
        lateral private.ap7_quality_stats(c.company_id, t.proposal_type, v_from, clock_timestamp() + interval '1 second') s) z;
    return jsonb_build_object('weeks', v_weeks, 'as_of', clock_timestamp(), 'types', v_rows,
      'all', private.ap7_quality_stats(c.company_id, null, v_from, clock_timestamp() + interval '1 second'),
      'note', 'Counts by proposal type and by the role that decided. Individual people are not ranked.');
  elsif p_command in ('weekly', 'roles', 'corrections') then
    perform private.ap_keys(p_payload, array['weeks', 'proposal_type']);
    v_type := private.ap_text(p_payload ->> 'proposal_type', 'Proposal type', 3, 60);
    if p_command = 'weekly' then
      v_week := date_trunc('week', (clock_timestamp() at time zone 'Asia/Kolkata'))::date;
      select coalesce(jsonb_agg(jsonb_build_object('week_start', w, 'stats',
        private.ap7_quality_stats(c.company_id, v_type, (w::timestamp at time zone 'Asia/Kolkata'), ((w + 7)::timestamp at time zone 'Asia/Kolkata'))) order by w), '[]') into v_rows
      from generate_series((v_week - 77)::timestamp, v_week::timestamp, interval '7 days') g(ws), lateral (select g.ws::date w) d;
      return jsonb_build_object('proposal_type', v_type, 'weeks', v_rows);
    elsif p_command = 'roles' then
      select coalesce(jsonb_agg(jsonb_build_object('role', r.decided_role, 'stats', private.ap7_quality_stats(c.company_id, v_type, v_from, clock_timestamp() + interval '1 second', r.decided_role))
        order by r.decided_role), '[]') into v_rows
      from (select distinct x.decided_role from public.proposals x where x.company_id = c.company_id and x.proposal_type = v_type and x.created_at >= v_from and x.decided_role is not null) r;
      return jsonb_build_object('proposal_type', v_type, 'weeks', v_weeks, 'roles', v_rows);
    end if;
    -- The field people change most often, with the value they most often type instead of the proposed one.
    with e as (select f, left(coalesce(x.decision_payload ->> f, '(blank)'), 80) corrected, left(coalesce(x.payload ->> f, '(blank)'), 80) proposed
        from public.proposals x, unnest(x.edited_fields) f
        where x.company_id = c.company_id and x.proposal_type = v_type and x.status = 'edited' and x.created_at >= v_from
          -- Proposed and corrected values are shown only to roles that may decide that proposal (counts are shown to all readers).
          and (c.role in ('owner', 'admin') or c.role = any(x.decide_roles))),
      v as (select f, corrected, count(*) n, mode() within group (order by proposed) proposed from e group by f, corrected),
      r as (select v.*, row_number() over (partition by f order by n desc, corrected) rk, sum(n) over (partition by f) edits from v)
    select coalesce(jsonb_agg(jsonb_build_object('field', f, 'edits', edits, 'most_common_value', corrected, 'times', n, 'usually_proposed', proposed) order by edits desc, f), '[]')
      into v_rows from r where rk = 1;
    return jsonb_build_object('proposal_type', v_type, 'weeks', v_weeks, 'fields', v_rows);
  elsif p_command = 'changes' then
    perform private.ap_keys(p_payload, array['weeks', 'page', 'proposal_type']);
    v_type := nullif(btrim(coalesce(p_payload ->> 'proposal_type', '')), '');
    select coalesce(jsonb_agg(z.r order by z.k), '[]'), max(z.total) into v_rows, v_total from (
      select (to_jsonb(rc) - 'recorded_by') || jsonb_build_object('recorded_by_role', (select u.role from public.app_users u where u.id = rc.recorded_by), 'comparison', private.ap7_quality_compare(c.company_id, rc)) r,
        row_number() over (order by rc.changed_on desc, rc.created_at desc) k, count(*) over () total
      from public.automation_rule_changes rc where rc.company_id = c.company_id and (v_type is null or rc.proposal_type = v_type)
      order by rc.changed_on desc, rc.created_at desc limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page);
  elsif p_command = 'record_change' then
    perform private.ap_keys(p_payload, array['weeks', 'proposal_type', 'changed_on', 'description']);
    perform private.ap4_need(c.role, array['owner', 'admin']);
    v_type := private.ap_text(p_payload ->> 'proposal_type', 'Proposal type', 3, 60);
    if not exists (select 1 from public.proposals x where x.company_id = c.company_id and x.proposal_type = v_type) then
      raise exception 'AP: No proposals of this type have been prepared yet, so there is nothing to compare.';
    end if;
    v_day := private.ap7_date(p_payload, 'changed_on');
    if v_day > private.ist_today() or v_day < private.ist_today() - 365 then raise exception 'AP: The change date must be within the last year and not in the future.'; end if;
    insert into public.automation_rule_changes(company_id, proposal_type, changed_on, description, recorded_by)
      values (c.company_id, v_type, v_day, private.ap_text(p_payload ->> 'description', 'What changed', 10, 500), c.actor_id) returning * into v_change;
    return jsonb_build_object('id', v_change.id, 'comparison', private.ap7_quality_compare(c.company_id, v_change));
  elsif p_command = 'compare' then
    perform private.ap_keys(p_payload, array['weeks', 'id']);
    select * into v_change from public.automation_rule_changes where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if v_change.id is null then raise exception 'AP: Rule change not found.'; end if;
    return to_jsonb(v_change) - 'recorded_by' || jsonb_build_object('comparison', private.ap7_quality_compare(c.company_id, v_change));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_quality(text, jsonb) from public, anon;
grant execute on function public.ap_quality(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-039: PIN code on vendors, and one spelling for each state on customer, vendor and site addresses
-- ---------------------------------------------------------------------------------------------------------------
alter table public.vendors add column if not exists pincode text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vendors_pincode_format') then
    alter table public.vendors add constraint vendors_pincode_format check (pincode is null or pincode ~ '^[1-9][0-9]{5}$') not valid;
  end if;
end $$;

-- A state written as a known name or alias ("maharashtra", "Orissa", "NCT of Delhi") is stored as its GST name.
-- Unknown text and two-digit codes are kept exactly as entered; nothing is guessed.
create or replace function private.ap7_canonical_state(p_text text)
returns text language sql immutable set search_path = public, private as $$
  select case when p_text is null or btrim(p_text) = '' or btrim(p_text) ~ '^[0-9]+$' then p_text
    else coalesce(private.ap_gst_state(private.ap3_state_code(p_text)), p_text) end
$$;
revoke all on function private.ap7_canonical_state(text) from public, anon, authenticated;

create or replace function private.ap7_state_trigger()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  new.state := private.ap7_canonical_state(new.state);
  return new;
end;
$$;
revoke all on function private.ap7_state_trigger() from public, anon, authenticated;
drop trigger if exists zzz_ap7_state_canonical on public.customers;
create trigger zzz_ap7_state_canonical before insert or update of state on public.customers for each row execute function private.ap7_state_trigger();
drop trigger if exists zzz_ap7_state_canonical on public.vendors;
create trigger zzz_ap7_state_canonical before insert or update of state on public.vendors for each row execute function private.ap7_state_trigger();
drop trigger if exists zzz_ap7_state_canonical on public.customer_projects;
create trigger zzz_ap7_state_canonical before insert or update of state on public.customer_projects for each row execute function private.ap7_state_trigger();

-- ---------------------------------------------------------------------------------------------------------------
-- AP-040: the length as the customer said it, kept on the quotation line beside the stored metres
-- ---------------------------------------------------------------------------------------------------------------
alter table public.quote_items add column if not exists length_input_text text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quote_items_length_input_text_check') then
    alter table public.quote_items add constraint quote_items_length_input_text_check
      check (length_input_text is null or (length(length_input_text) between 1 and 40 and length_input_text !~ '[[:cntrl:]]'));
  end if;
end $$;
-- The authorised projection gains the column at the end; every other column and rule is unchanged.
do $$
declare d text := pg_get_viewdef('public.quote_items_authorized'::regclass, false);
begin
  if position('length_input_text' in d) = 0 then
    d := regexp_replace(d, '(i\.configuration_cut_snapshot)(\s+FROM\s)', '\1, i.length_input_text\2');
    if position('length_input_text' in d) = 0 then raise exception 'quote_items_authorized could not be extended'; end if;
    execute 'create or replace view public.quote_items_authorized with (security_barrier = true) as ' || d;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-057: last prices and variance on purchase order lines
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.purchase_price_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  variance_percent numeric(6,2) not null default 5 check (variance_percent between 0.1 and 100),
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.purchase_line_price_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  purchase_order_line_id uuid not null unique references public.purchase_order_lines(id) on delete cascade,
  line_number integer not null,
  item_key text not null,
  unit_rate numeric(14,2) not null,
  history jsonb not null,
  reference_rate numeric(14,2),
  variance_percent numeric(10,2),
  threshold_percent numeric(6,2) not null,
  flagged boolean not null,
  reason text check (reason is null or length(btrim(reason)) between 10 and 300),
  reason_by uuid references public.app_users(id),
  reason_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check ((reason is null) = (reason_by is null))
);
create index if not exists purchase_line_price_checks_company_idx on public.purchase_line_price_checks(company_id, purchase_order_id, line_number);
create index if not exists purchase_line_price_checks_flagged_idx on public.purchase_line_price_checks(company_id, flagged, created_at desc);

-- Lines match on the normalised description and unit (purchase lines carry no item master link).
create or replace function private.ap7_item_key(p_description text, p_unit text)
returns text language sql immutable set search_path = public, private as $$
  select private.ap3_norm(p_description) || '|' || coalesce(p_unit, '')
$$;
revoke all on function private.ap7_item_key(text, text) from public, anon, authenticated;
create index if not exists purchase_order_lines_item_key_idx on public.purchase_order_lines(company_id, private.ap7_item_key(description, unit));

-- The last three prices on issued purchase orders (any supplier) and this supplier's last price, newest first.
create or replace function private.ap7_price_history(p_company uuid, p_key text, p_vendor uuid, p_exclude_po uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  with h as (
    select l.unit_rate rate, l.unit, p.vendor_id, p.vendor_name_snapshot vendor, p.po_number, p.order_date, p.created_at, l.line_number
    from public.purchase_order_lines l join public.purchase_orders p on p.id = l.purchase_order_id and p.company_id = l.company_id
    where l.company_id = p_company and private.ap7_item_key(l.description, l.unit) = p_key and p.status = 'open'
      and p.id is distinct from p_exclude_po)
  select jsonb_build_object(
    'last', (select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'unit', unit, 'vendor', vendor, 'po_number', po_number, 'order_date', order_date,
        'same_supplier', vendor_id = p_vendor) order by order_date desc, created_at desc, line_number), '[]')
      from (select * from h order by order_date desc, created_at desc, line_number limit 3) t),
    'same_supplier', (select jsonb_build_object('rate', rate, 'vendor', vendor, 'po_number', po_number, 'order_date', order_date)
      from h where vendor_id = p_vendor order by order_date desc, created_at desc, line_number limit 1),
    'reference_rate', (select rate from h order by order_date desc, created_at desc, line_number limit 1))
$$;
revoke all on function private.ap7_price_history(uuid, text, uuid, uuid) from public, anon, authenticated;

create or replace function private.ap7_price_variance(p_company uuid, p_description text, p_unit text, p_vendor uuid, p_rate numeric, p_exclude_po uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_key text := private.ap7_item_key(p_description, p_unit); v_hist jsonb; v_ref numeric; v_var numeric;
  v_threshold numeric := coalesce((select s.variance_percent from public.purchase_price_settings s where s.company_id = p_company), 5);
begin
  v_hist := private.ap7_price_history(p_company, v_key, p_vendor, p_exclude_po);
  v_ref := nullif(v_hist ->> 'reference_rate', '')::numeric;
  v_var := case when v_ref > 0 and p_rate is not null then round((p_rate - v_ref) * 100 / v_ref, 2) end;
  return v_hist || jsonb_build_object('item_key', v_key, 'rate', p_rate, 'variance_percent', v_var, 'threshold_percent', v_threshold,
    'flagged', coalesce(v_var > v_threshold, false),
    'basis', case when v_ref is null then 'No earlier issued purchase order has this description and unit.'
      else 'Compared with the most recent issued purchase order price for the same description and unit.' end);
end;
$$;
revoke all on function private.ap7_price_variance(uuid, text, text, uuid, numeric, uuid) from public, anon, authenticated;

-- Every purchase order line gets its price check when it is written, whichever screen wrote it.
create or replace function private.ap7_price_check_trigger()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_po public.purchase_orders%rowtype; v jsonb;
begin
  select * into v_po from public.purchase_orders where id = new.purchase_order_id and company_id = new.company_id;
  v := private.ap7_price_variance(new.company_id, new.description, new.unit, v_po.vendor_id, new.unit_rate, new.purchase_order_id);
  insert into public.purchase_line_price_checks(company_id, purchase_order_id, purchase_order_line_id, line_number, item_key, unit_rate, history, reference_rate,
      variance_percent, threshold_percent, flagged)
    values (new.company_id, new.purchase_order_id, new.id, new.line_number, v ->> 'item_key', new.unit_rate, v - array['item_key', 'rate', 'variance_percent', 'threshold_percent', 'flagged'],
      nullif(v ->> 'reference_rate', '')::numeric, nullif(v ->> 'variance_percent', '')::numeric, (v ->> 'threshold_percent')::numeric, (v ->> 'flagged')::boolean)
    on conflict (purchase_order_line_id) do nothing;
  return new;
end;
$$;
revoke all on function private.ap7_price_check_trigger() from public, anon, authenticated;
drop trigger if exists zzz_ap7_price_check on public.purchase_order_lines;
create trigger zzz_ap7_price_check after insert on public.purchase_order_lines for each row execute function private.ap7_price_check_trigger();

-- The purchase command keeps its checks; this wrapper accepts reasons at creation and refuses to issue a purchase order
-- while a line priced above the threshold has no reason.
alter function public.purchase_lifecycle_command(text, jsonb) set schema private;
alter function private.purchase_lifecycle_command(text, jsonb) rename to ap7_purchase_lifecycle_v1;
revoke all on function private.ap7_purchase_lifecycle_v1(text, jsonb) from public, anon, authenticated;

create function public.purchase_lifecycle_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_reasons jsonb; v_result jsonb; v_company uuid; v_open text; r jsonb; v_seen integer[] := '{}'; v_n integer;
begin
  if p_command = 'order.create' and p_payload is not null and jsonb_typeof(p_payload) = 'object' and p_payload ? 'price_reasons' then
    v_reasons := p_payload -> 'price_reasons';
    p_payload := p_payload - 'price_reasons';
    if jsonb_typeof(v_reasons) <> 'array' or jsonb_array_length(v_reasons) > 100 then raise exception 'AP: Invalid price reasons.'; end if;
    for r in select value from jsonb_array_elements(v_reasons) loop
      if jsonb_typeof(r) <> 'object' or r - array['line_number', 'reason'] <> '{}' or (r ->> 'line_number') !~ '^[0-9]{1,3}$' then raise exception 'AP: Invalid price reasons.'; end if;
      v_n := (r ->> 'line_number')::integer;
      if v_n = any(v_seen) then raise exception 'AP: Give one price reason per line.'; end if;
      v_seen := v_seen || v_n;
      perform private.ap_text(r ->> 'reason', 'Price reason', 10, 300);
    end loop;
  elsif p_command = 'order.issue' and p_payload is not null and jsonb_typeof(p_payload) = 'object' and (p_payload ->> 'purchase_order_id') ~* '^[0-9a-f-]{36}$' then
    v_company := private.commercial_actor(array['owner', 'admin', 'accounts']);
    select string_agg(k.line_number::text || ' (' || k.variance_percent::text || '% above ' || k.reference_rate::text || ')', ', ' order by k.line_number) into v_open
      from public.purchase_line_price_checks k join public.purchase_orders p on p.id = k.purchase_order_id and p.company_id = k.company_id
      where k.company_id = v_company and k.purchase_order_id = (p_payload ->> 'purchase_order_id')::uuid and p.status = 'draft' and k.flagged and k.reason is null;
    if v_open is not null then
      raise exception 'AP: Record a reason for the price on line %. Purchase orders priced above the last purchase price are issued only with a reason.', v_open using errcode = '23514';
    end if;
  end if;
  v_result := private.ap7_purchase_lifecycle_v1(p_command, p_payload);
  if v_reasons is not null and jsonb_array_length(v_reasons) > 0 and not coalesce((v_result ->> 'idempotent_replay')::boolean, false) then
    for r in select value from jsonb_array_elements(v_reasons) loop
      update public.purchase_line_price_checks set reason = btrim(r ->> 'reason'), reason_by = auth.uid(), reason_at = clock_timestamp()
        where purchase_order_id = (v_result ->> 'id')::uuid and line_number = (r ->> 'line_number')::integer and flagged and reason is null;
    end loop;
  end if;
  return v_result;
end;
$$;
revoke all on function public.purchase_lifecycle_command(text, jsonb) from public, anon;
grant execute on function public.purchase_lifecycle_command(text, jsonb) to authenticated;

create or replace function public.ap_price(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); v_rate numeric; k public.purchase_line_price_checks%rowtype;
  v_status text; v_pct numeric;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'accounts', 'inventory_manager', 'factory_manager']);
  if p_command = 'history' then
    perform private.ap_keys(p_payload, array['description', 'unit', 'vendor_id', 'rate']);
    if nullif(btrim(coalesce(p_payload ->> 'description', '')), '') is null or length(btrim(p_payload ->> 'description')) < 3 then
      return jsonb_build_object('last', '[]'::jsonb, 'flagged', false, 'basis', 'Enter the description to see earlier prices.');
    end if;
    if coalesce(p_payload ->> 'unit', '') not in ('kg', 'm', 'piece', 'set', 'box', 'lot') then raise exception 'AP: Choose the unit.'; end if;
    v_rate := case when nullif(p_payload ->> 'rate', '') is null then null when (p_payload ->> 'rate') ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then (p_payload ->> 'rate')::numeric
      else null end;
    return private.ap7_price_variance(c.company_id, private.ap_text(p_payload ->> 'description', 'Description', 3, 240), p_payload ->> 'unit',
      private.ap_uuid(p_payload, 'vendor_id', false), v_rate, null);
  elsif p_command = 'order_checks' then
    perform private.ap_keys(p_payload, array['purchase_order_id']);
    select coalesce(jsonb_agg(to_jsonb(k2) - array['company_id', 'reason_by'] || jsonb_build_object('reason_by_name', (select u.full_name from public.app_users u where u.id = k2.reason_by))
      order by k2.line_number), '[]') into v_rows
      from public.purchase_line_price_checks k2 where k2.company_id = c.company_id and k2.purchase_order_id = private.ap_uuid(p_payload, 'purchase_order_id');
    return jsonb_build_object('lines', v_rows,
      'status', (select p.status from public.purchase_orders p where p.id = private.ap_uuid(p_payload, 'purchase_order_id') and p.company_id = c.company_id));
  elsif p_command = 'justify' then
    perform private.ap_keys(p_payload, array['line_id', 'reason']);
    perform private.ap4_need(c.role, array['owner', 'admin', 'accounts']);
    select * into k from public.purchase_line_price_checks where purchase_order_line_id = private.ap_uuid(p_payload, 'line_id') and company_id = c.company_id for update;
    if k.id is null then raise exception 'AP: Purchase order line not found.'; end if;
    select p.status into v_status from public.purchase_orders p where p.id = k.purchase_order_id and p.company_id = c.company_id;
    if v_status <> 'draft' then raise exception 'AP: This purchase order is already issued; its price reason cannot change.'; end if;
    if not k.flagged then raise exception 'AP: This line is within the price threshold and needs no reason.'; end if;
    update public.purchase_line_price_checks set reason = private.ap_text(p_payload ->> 'reason', 'Price reason', 10, 300), reason_by = c.actor_id, reason_at = clock_timestamp()
      where id = k.id;
    return jsonb_build_object('line_id', k.purchase_order_line_id, 'state', 'justified');
  elsif p_command = 'flagged' then
    perform private.ap_keys(p_payload, array['page', 'show']);
    select coalesce(jsonb_agg(z.r order by z.k), '[]'), max(z.total) into v_rows, v_total from (
      select jsonb_build_object('line_id', k2.purchase_order_line_id, 'purchase_order_id', p.id, 'po_number', p.po_number, 'vendor', p.vendor_name_snapshot, 'status', p.status,
          'order_date', p.order_date, 'line_number', k2.line_number, 'description', l.description, 'unit', l.unit, 'unit_rate', k2.unit_rate, 'reference_rate', k2.reference_rate,
          'variance_percent', k2.variance_percent, 'threshold_percent', k2.threshold_percent, 'reason', k2.reason, 'reason_at', k2.reason_at) r,
        row_number() over (order by (k2.reason is null) desc, p.order_date desc, p.po_number, k2.line_number) k, count(*) over () total
      from public.purchase_line_price_checks k2 join public.purchase_orders p on p.id = k2.purchase_order_id and p.company_id = k2.company_id
      join public.purchase_order_lines l on l.id = k2.purchase_order_line_id
      where k2.company_id = c.company_id and k2.flagged and (coalesce(p_payload ->> 'show', 'all') = 'all' or k2.reason is null)
      order by k limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page,
      'issued_without_reason', (select count(*) from public.purchase_line_price_checks k3 join public.purchase_orders p3 on p3.id = k3.purchase_order_id
        where k3.company_id = c.company_id and k3.flagged and k3.reason is null and p3.status = 'open'));
  elsif p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('variance_percent', coalesce((select s.variance_percent from public.purchase_price_settings s where s.company_id = c.company_id), 5),
      'saved', exists (select 1 from public.purchase_price_settings s where s.company_id = c.company_id));
  elsif p_command = 'save_settings' then
    perform private.ap_keys(p_payload, array['variance_percent']);
    perform private.ap4_need(c.role, array['owner', 'admin']);
    v_pct := case when (p_payload ->> 'variance_percent') ~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' then (p_payload ->> 'variance_percent')::numeric end;
    if v_pct is null or v_pct < 0.1 or v_pct > 100 then raise exception 'AP: The variance threshold must be between 0.1%% and 100%%.'; end if;
    insert into public.purchase_price_settings(company_id, variance_percent, updated_by, updated_at) values (c.company_id, v_pct, c.actor_id, now())
      on conflict (company_id) do update set variance_percent = excluded.variance_percent, updated_by = excluded.updated_by, updated_at = now();
    return jsonb_build_object('variance_percent', v_pct, 'note', 'Applies to purchase order lines written from now on. Existing checks keep the threshold they were made with.');
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_price(text, jsonb) from public, anon;
grant execute on function public.ap_price(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-064: customer delay notices drafted when a line turns red (AP-063); sales edits and sends
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.order_delay_notices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  prepared_on date not null,
  lines jsonb not null,
  fingerprint text not null,
  new_date date,
  message text not null check (length(message) between 20 and 4000),
  phone text,
  email text,
  status text not null default 'prepared' check (status in ('prepared', 'sent', 'skipped', 'superseded')),
  edited_by uuid references public.app_users(id),
  edited_at timestamptz,
  copied_at timestamptz,
  sent_via text check (sent_via is null or sent_via in ('whatsapp', 'email', 'phone_call', 'other')),
  sent_at timestamptz,
  sent_by uuid references public.app_users(id),
  skip_reason text check (skip_reason is null or length(btrim(skip_reason)) between 5 and 300),
  skipped_by uuid references public.app_users(id),
  closed_note text,
  job_run_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  check ((status = 'sent') = (sent_at is not null and sent_via is not null)),
  check ((status = 'skipped') = (skip_reason is not null))
);
create unique index if not exists order_delay_notices_one_prepared on public.order_delay_notices(company_id, order_id) where status = 'prepared';
create index if not exists order_delay_notices_company_idx on public.order_delay_notices(company_id, status, prepared_on desc);
create index if not exists order_delay_notices_order_idx on public.order_delay_notices(company_id, order_id, created_at desc);

-- Internal blockers become customer wording; missing-data blockers are never shown to the customer.
create or replace function private.ap7_customer_status(p_blocker text)
returns text language sql immutable set search_path = public, private as $$
  select case
    when p_blocker = 'production not planned' then 'awaiting production'
    when p_blocker in ('planned production', 'production partially planned') then 'in production'
    when p_blocker in ('finishing at vendor', 'finishing') then 'at finishing'
    when p_blocker = 'packing' then 'being packed'
    when p_blocker = 'ready to dispatch' then 'ready, awaiting dispatch'
    else 'being scheduled' end
$$;
revoke all on function private.ap7_customer_status(text) from public, anon, authenticated;

create or replace function private.ap7_delay_message(p_company uuid, p_order uuid, p_lines jsonb)
returns text language sql stable security definer set search_path = public, private as $$
  select 'Dear ' || coalesce(private.ap7_customer_contact(o.customer_id) ->> 'name', 'Sir/Madam') || ',' || E'\n'
    || 'An update on your order ' || o.order_number || ':' || E'\n'
    || (select string_agg('- ' || coalesce(l ->> 'profile', 'Profile') || coalesce(' (' || trim_scale((l ->> 'ordered_kg')::numeric)::text || ' kg)', '') || ': due '
          || coalesce(private.ap7_day((l ->> 'due_date')::date), 'as agreed') || ', now expected '
          || coalesce(private.ap7_day((l ->> 'estimated_date')::date), 'on a date we will confirm shortly') || ' (' || (l ->> 'customer_status') || ').',
          E'\n' order by l ->> 'profile', l ->> 'order_item_id') from jsonb_array_elements(p_lines) l) || E'\n'
    || 'We regret the delay and will keep you informed.' || E'\n' || coalesce(private.ap7_company_name(p_company), '')
  from public.orders o where o.id = p_order and o.company_id = p_company
$$;
revoke all on function private.ap7_delay_message(uuid, uuid, jsonb) from public, anon, authenticated;

-- Drafts one notice per order whose open lines are red today. A notice already prepared, sent or skipped for the same
-- lines and dates is not repeated; a changed estimate supersedes the unsent draft. A draft whose lines are no longer red
-- is withdrawn.
create or replace function private.ap7_delay_draft(p_company uuid, p_run uuid default null)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare o record; v_lines jsonb; v_fp text; v_new uuid; v_prepared integer := 0; v_examined integer := 0; v_withdrawn integer := 0; v_contact jsonb; v_date date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':ap7-delay', 0));
  for o in
    select pr.order_id, ord.customer_id,
      jsonb_agg(jsonb_build_object('order_item_id', pr.order_item_id, 'profile', l.profile_code, 'ordered_kg', round(l.ordered_kg, 1), 'due_date', pr.due_date,
        'estimated_date', pr.estimated_date, 'blocker', pr.blocker, 'customer_status', private.ap7_customer_status(pr.blocker)) order by pr.order_item_id) lines,
      md5(string_agg(pr.order_item_id::text || ':' || coalesce(pr.estimated_date::text, '?'), ',' order by pr.order_item_id)) fp,
      bool_and(pr.estimated_date is not null) all_dated, max(pr.estimated_date) latest
    from public.order_line_predictions pr
    join public.orders ord on ord.id = pr.order_id and ord.company_id = p_company
    join lateral private.order_line_requirements(p_company, pr.order_id) l on l.order_item_id = pr.order_item_id
    where pr.company_id = p_company and pr.predicted_on = private.ist_today() and pr.is_red and not l.order_closed
      and (l.ordered_kg is null or l.dispatched_kg < l.ordered_kg - 0.001)
    group by pr.order_id, ord.customer_id
  loop
    v_examined := v_examined + 1;
    if exists (select 1 from public.order_delay_notices n where n.company_id = p_company and n.order_id = o.order_id and n.fingerprint = o.fp and n.status in ('prepared', 'sent', 'skipped')) then
      continue;
    end if;
    v_contact := private.ap7_customer_contact(o.customer_id);
    v_date := case when o.all_dated then o.latest end;
    v_new := gen_random_uuid();
    update public.order_delay_notices set status = 'superseded', closed_note = 'A newer estimate replaced this draft.'
      where company_id = p_company and order_id = o.order_id and status = 'prepared';
    insert into public.order_delay_notices(id, company_id, order_id, customer_id, prepared_on, lines, fingerprint, new_date, message, phone, email, job_run_id)
      values (v_new, p_company, o.order_id, o.customer_id, private.ist_today(), o.lines, o.fp, v_date, private.ap7_delay_message(p_company, o.order_id, o.lines),
        v_contact ->> 'phone', v_contact ->> 'email', p_run);
    v_prepared := v_prepared + 1;
  end loop;
  -- Drafts for orders with no red line today are withdrawn (nothing is sent).
  with w as (
    update public.order_delay_notices n set status = 'superseded', closed_note = 'The line is no longer predicted late.'
    where n.company_id = p_company and n.status = 'prepared' and not exists (
      select 1 from public.order_line_predictions pr where pr.company_id = p_company and pr.order_id = n.order_id and pr.predicted_on = private.ist_today() and pr.is_red)
      and exists (select 1 from public.order_line_predictions pr where pr.company_id = p_company and pr.predicted_on = private.ist_today())
    returning 1)
  select count(*) into v_withdrawn from w;
  return jsonb_build_object('examined', v_examined, 'prepared', v_prepared, 'withdrawn', v_withdrawn);
end;
$$;
revoke all on function private.ap7_delay_draft(uuid, uuid) from public, anon, authenticated;

-- The nightly prediction (AP-063) drafts the notices in the same run.
alter function private.ap5_predict_lines(uuid) rename to ap7_predict_lines_v1;
create function private.ap5_predict_lines(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v jsonb; d jsonb;
begin
  v := private.ap7_predict_lines_v1(p_company);
  d := private.ap7_delay_draft(p_company, null);
  return v || jsonb_build_object('details', coalesce(v -> 'details', '{}'::jsonb) || jsonb_build_object('delay_notices', d -> 'prepared'));
end;
$$;
revoke all on function private.ap5_predict_lines(uuid) from public, anon, authenticated;
revoke all on function private.ap7_predict_lines_v1(uuid) from public, anon, authenticated;

create or replace function private.ap7_delay_row(n public.order_delay_notices)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(n) - array['company_id', 'sent_by', 'skipped_by', 'edited_by', 'job_run_id'] || jsonb_build_object(
    'order_number', (select o.order_number from public.orders o where o.id = n.order_id),
    'customer', private.ap3_customer_name(n.customer_id),
    'sent_by_name', (select u.full_name from public.app_users u where u.id = n.sent_by),
    'skipped_by_name', (select u.full_name from public.app_users u where u.id = n.skipped_by),
    'edited_by_name', (select u.full_name from public.app_users u where u.id = n.edited_by),
    'needs_date', n.new_date is null)
$$;
revoke all on function private.ap7_delay_row(public.order_delay_notices) from public, anon, authenticated;

create or replace function public.ap_delay(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; n public.order_delay_notices%rowtype; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); v_search text := coalesce(p_payload ->> 'search', '');
  v_status text; v_date date; v_msg text; v_actors text[] := array['owner', 'admin', 'sales_manager', 'sales'];
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'factory_manager', 'dispatch_manager']);
  if p_command in ('get', 'edit', 'copy', 'send', 'skip') then
    select * into n from public.order_delay_notices x where x.id = private.ap_uuid(p_payload, 'id') and x.company_id = c.company_id
      for update;
    if n.id is null then raise exception 'AP: Delay notice not found.'; end if;
  end if;
  if p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'search', 'status', 'sort']);
    v_status := coalesce(p_payload ->> 'status', 'prepared');
    if v_status not in ('prepared', 'sent', 'skipped', 'superseded', 'all') then raise exception 'AP: Invalid request.'; end if;
    select coalesce(jsonb_agg(z.r order by z.k), '[]'), max(z.total) into v_rows, v_total from (
      select private.ap7_delay_row(x) r,
        row_number() over (order by case when p_payload ->> 'sort' = 'name' then private.ap3_customer_name(x.customer_id) end, x.prepared_on desc, x.created_at desc) k,
        count(*) over () total
      from public.order_delay_notices x join public.orders o on o.id = x.order_id
      where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status)
        and (o.order_number || ' ' || coalesce(private.ap3_customer_name(x.customer_id), '')) ilike '%' || v_search || '%'
      order by k limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page, 'status', v_status);
  elsif p_command = 'order' then
    perform private.ap_keys(p_payload, array['order_id']);
    if not exists (select 1 from public.orders o where o.id = private.ap_uuid(p_payload, 'order_id') and o.company_id = c.company_id) then raise exception 'AP: Order not found.'; end if;
    select coalesce(jsonb_agg(private.ap7_delay_row(x) order by x.created_at desc), '[]') into v_rows
      from (select * from public.order_delay_notices x where x.company_id = c.company_id and x.order_id = private.ap_uuid(p_payload, 'order_id') order by x.created_at desc limit 10) x;
    return jsonb_build_object('notices', v_rows,
      'red_lines', (select count(*) from public.order_line_predictions pr where pr.company_id = c.company_id and pr.order_id = private.ap_uuid(p_payload, 'order_id')
        and pr.predicted_on = private.ist_today() and pr.is_red),
      'can_send', c.role = any(v_actors));
  elsif p_command = 'get' then
    perform private.ap_keys(p_payload, array['id']);
    return private.ap7_delay_row(n);
  elsif p_command = 'edit' then
    perform private.ap_keys(p_payload, array['id', 'message', 'new_date']);
    perform private.ap4_need(c.role, v_actors);
    if n.status <> 'prepared' then raise exception 'AP: Only a prepared notice can be edited.'; end if;
    v_date := private.ap7_date(p_payload, 'new_date', false);
    if v_date is not null and v_date < private.ist_today() then raise exception 'AP: The new expected date cannot be in the past.'; end if;
    -- Line breaks are allowed in the message; other control characters are refused (checked with line breaks set aside).
    v_msg := btrim(replace(coalesce(p_payload ->> 'message', ''), E'\r', ''));
    perform private.ap_text(replace(v_msg, E'\n', ' '), 'Message', 20, 4000);
    update public.order_delay_notices set message = v_msg, new_date = coalesce(v_date, new_date), edited_by = c.actor_id, edited_at = clock_timestamp()
      where id = n.id returning * into n;
    return private.ap7_delay_row(n);
  elsif p_command = 'copy' then
    perform private.ap_keys(p_payload, array['id']);
    perform private.ap4_need(c.role, v_actors);
    if n.status <> 'prepared' then raise exception 'AP: Only a prepared notice can be copied.'; end if;
    update public.order_delay_notices set copied_at = clock_timestamp() where id = n.id returning * into n;
    return private.ap7_delay_row(n) || jsonb_build_object('note', 'Copied. The notice is recorded as sent only when you mark it sent.');
  elsif p_command = 'send' then
    perform private.ap_keys(p_payload, array['id', 'via']);
    perform private.ap4_need(c.role, v_actors);
    if n.status = 'sent' then return private.ap7_delay_row(n) || jsonb_build_object('repeated', true); end if;
    if n.status <> 'prepared' then raise exception 'AP: This notice is % and cannot be marked sent.', n.status; end if;
    if coalesce(p_payload ->> 'via', '') not in ('whatsapp', 'email', 'phone_call', 'other') then raise exception 'AP: Choose how the notice was sent.'; end if;
    if n.new_date is null then raise exception 'AP: Enter the new expected date in the notice before recording it as sent.'; end if;
    update public.order_delay_notices set status = 'sent', sent_via = p_payload ->> 'via', sent_at = clock_timestamp(), sent_by = c.actor_id where id = n.id returning * into n;
    return private.ap7_delay_row(n);
  elsif p_command = 'skip' then
    perform private.ap_keys(p_payload, array['id', 'reason']);
    perform private.ap4_need(c.role, v_actors);
    if n.status <> 'prepared' then raise exception 'AP: Only a prepared notice can be skipped.'; end if;
    update public.order_delay_notices set status = 'skipped', skip_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), skipped_by = c.actor_id
      where id = n.id returning * into n;
    return private.ap7_delay_row(n);
  elsif p_command = 'prepare' then
    perform private.ap_keys(p_payload, array[]::text[]);
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager']);
    return private.ap7_delay_draft(c.company_id, null);
  elsif p_command = 'coverage' then
    perform private.ap_keys(p_payload, array[]::text[]);
    -- Every red line today, and whether a notice covering it was sent (or deliberately skipped) in the last 30 days.
    return (with red as (
        select pr.order_item_id, pr.order_id from public.order_line_predictions pr
        where pr.company_id = c.company_id and pr.predicted_on = private.ist_today() and pr.is_red),
      covered as (
        select r.order_item_id,
          bool_or(n2.status = 'sent') sent, bool_or(n2.status = 'skipped') skipped, bool_or(n2.status = 'prepared') prepared
        from red r left join public.order_delay_notices n2 on n2.company_id = c.company_id and n2.order_id = r.order_id
          and n2.created_at > clock_timestamp() - interval '30 days' and n2.lines @> jsonb_build_array(jsonb_build_object('order_item_id', r.order_item_id))
        group by r.order_item_id)
      select jsonb_build_object('red_lines', count(*), 'sent', count(*) filter (where sent), 'skipped', count(*) filter (where skipped and not coalesce(sent, false)),
        'waiting', count(*) filter (where prepared and not coalesce(sent, false) and not coalesce(skipped, false)),
        'without_communication', count(*) filter (where not coalesce(sent, false) and not coalesce(skipped, false)),
        'today', private.ist_today()) from covered);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_delay(text, jsonb) from public, anon;
grant execute on function public.ap_delay(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-079: monthly customer statements prepared on the first working day and queued for review and sending
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.customer_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  period_start date not null,
  period_end date not null,
  opening_balance numeric(14,2) not null,
  invoiced numeric(14,2) not null,
  received numeric(14,2) not null,
  credited numeric(14,2) not null,
  closing_balance numeric(14,2) not null,
  on_account numeric(14,2) not null default 0,
  lines jsonb not null,
  open_invoices jsonb not null,
  message text not null check (length(message) between 20 and 4000),
  phone text,
  email text,
  status text not null default 'prepared' check (status in ('prepared', 'sent', 'skipped', 'superseded')),
  copied_at timestamptz,
  sent_via text check (sent_via is null or sent_via in ('whatsapp', 'email', 'email_provider', 'phone_call', 'post', 'other')),
  provider_ref text check (provider_ref is null or length(provider_ref) <= 200),
  sent_at timestamptz,
  sent_by uuid references public.app_users(id),
  skip_reason text check (skip_reason is null or length(btrim(skip_reason)) between 5 and 300),
  skipped_by uuid references public.app_users(id),
  prepared_by uuid references public.app_users(id),
  job_run_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  check (period_end >= period_start),
  check ((status = 'sent') = (sent_at is not null and sent_via is not null)),
  check ((status = 'skipped') = (skip_reason is not null))
);
create unique index if not exists customer_statements_one_per_month on public.customer_statements(company_id, customer_id, period_start) where status <> 'superseded';
create index if not exists customer_statements_company_idx on public.customer_statements(company_id, period_start desc, status);

-- One customer's account for the period, from issued invoices, posted receipts (refunds count back) and issued credit
-- notes, following the invoice balance rule in private.recalculate_invoice_collection_state. Only this customer's
-- invoices are read; receipts and credit notes are reached through them.
create or replace function private.ap7_statement(p_company uuid, p_customer uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_opening numeric; v_lines jsonb; v_inv numeric; v_rec numeric; v_cred numeric; v_open jsonb; v_onacc numeric;
begin
  with inv as (
    select i.id, i.invoice_number, i.invoice_date, i.due_date, i.grand_total from public.invoices i
    where i.company_id = p_company and i.customer_id = p_customer and i.status not in ('draft', 'cancelled') and i.invoice_date <= p_end),
  ev as (
    select i.invoice_date d, 1 o, 'invoice' kind, i.invoice_number ref, i.grand_total debit, 0::numeric credit, i.id src from inv i
    union all
    select p.payment_date, 2, case when p.payment_type = 'REFUND' then 'refund' else 'receipt' end,
      coalesce(nullif(btrim(p.reference_number), ''), case when p.payment_type = 'REFUND' then 'Refund' else 'Receipt' end) || ' against ' || i.invoice_number,
      case when p.payment_type = 'REFUND' then p.amount else 0 end, case when p.payment_type = 'REFUND' then 0 else p.amount end, p.id
    from public.payments p join inv i on i.id = p.invoice_id
    where p.company_id = p_company and p.payment_status = 'PAID' and p.payment_date <= p_end
    union all
    select n.credit_date, 3, 'credit_note', n.credit_note_number || ' against ' || i.invoice_number, 0, n.grand_total, n.id
    from public.credit_notes n join inv i on i.id = n.invoice_id
    where n.company_id = p_company and n.status = 'issued' and n.credit_date <= p_end),
  totals as (
    select coalesce(sum(debit - credit) filter (where d < p_start), 0) opening,
      coalesce(sum(debit) filter (where d >= p_start and kind = 'invoice'), 0) invoiced,
      coalesce(sum(credit - debit) filter (where d >= p_start and kind in ('receipt', 'refund')), 0) received,
      coalesce(sum(credit) filter (where d >= p_start and kind = 'credit_note'), 0) credited
    from ev),
  period as (
    select ev.*, (select opening from totals) + sum(debit - credit) over (order by d, o, ref, src rows between unbounded preceding and current row) balance
    from ev where d >= p_start)
  select t.opening, t.invoiced, t.received, t.credited,
    (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'kind', kind, 'reference', ref, 'debit', round(debit, 2), 'credit', round(credit, 2), 'balance', round(balance, 2))
      order by d, o, ref, src), '[]') from period)
  into v_opening, v_inv, v_rec, v_cred, v_lines from totals t;
  -- Invoices still open at the period end, oldest first.
  select coalesce(jsonb_agg(jsonb_build_object('invoice_number', x.invoice_number, 'invoice_date', x.invoice_date, 'due_date', x.due_date, 'total', x.grand_total,
      'balance', x.balance, 'days_overdue', case when x.due_date < p_end then p_end - x.due_date else 0 end) order by x.invoice_date, x.invoice_number), '[]')
    into v_open
  from (select i.invoice_number, i.invoice_date, i.due_date, i.grand_total,
      round(i.grand_total
        - coalesce((select sum(case when p.payment_type = 'REFUND' then -p.amount else p.amount end) from public.payments p
            where p.invoice_id = i.id and p.company_id = p_company and p.payment_status = 'PAID' and p.payment_date <= p_end), 0)
        - coalesce((select sum(n.grand_total) from public.credit_notes n where n.invoice_id = i.id and n.company_id = p_company and n.status = 'issued' and n.credit_date <= p_end), 0), 2) balance
    from public.invoices i where i.company_id = p_company and i.customer_id = p_customer and i.status not in ('draft', 'cancelled') and i.invoice_date <= p_end) x
  where x.balance > 0.005;
  -- Money received but not yet allocated to an invoice is shown separately (its allocations appear as receipts).
  select coalesce(sum(a.amount - a.applied_amount), 0) into v_onacc from public.customer_on_account_credits a
    where a.company_id = p_company and a.customer_id = p_customer and a.status = 'open' and a.received_on <= p_end;
  return jsonb_build_object('opening_balance', round(v_opening, 2), 'invoiced', round(v_inv, 2), 'received', round(v_rec, 2), 'credited', round(v_cred, 2),
    'closing_balance', round(v_opening + v_inv - v_rec - v_cred, 2), 'on_account', round(v_onacc, 2), 'lines', v_lines, 'open_invoices', v_open);
end;
$$;
revoke all on function private.ap7_statement(uuid, uuid, date, date) from public, anon, authenticated;

create or replace function private.ap7_statement_message(p_company uuid, p_customer uuid, p_start date, p_end date, s jsonb)
returns text language sql stable security definer set search_path = public, private as $$
  select 'Dear ' || coalesce(private.ap7_customer_contact(p_customer) ->> 'name', 'Sir/Madam') || ',' || E'\n'
    || 'Your account statement for ' || to_char(p_start, 'FMMonth YYYY') || ' (' || private.ap7_day(p_start) || ' to ' || private.ap7_day(p_end) || '):' || E'\n'
    || 'Opening balance: Rs ' || private.ap3_inr((s ->> 'opening_balance')::numeric) || E'\n'
    || 'Invoiced: Rs ' || private.ap3_inr((s ->> 'invoiced')::numeric) || E'\n'
    || 'Received: Rs ' || private.ap3_inr((s ->> 'received')::numeric) || E'\n'
    || case when (s ->> 'credited')::numeric <> 0 then 'Credit notes: Rs ' || private.ap3_inr((s ->> 'credited')::numeric) || E'\n' else '' end
    || 'Closing balance: Rs ' || private.ap3_inr((s ->> 'closing_balance')::numeric) || E'\n'
    || case when (s ->> 'on_account')::numeric > 0 then 'Received on account, not yet allocated: Rs ' || private.ap3_inr((s ->> 'on_account')::numeric) || E'\n' else '' end
    || coalesce((select 'Open invoices:' || E'\n' || string_agg('- ' || (e ->> 'invoice_number') || ' dated ' || private.ap7_day((e ->> 'invoice_date')::date) || ': Rs '
        || private.ap3_inr((e ->> 'balance')::numeric), E'\n' order by e ->> 'invoice_date', e ->> 'invoice_number') || E'\n'
      from jsonb_array_elements(s -> 'open_invoices') e having count(*) > 0), '')
    || 'Please check the statement and let us know of any difference.' || E'\n' || coalesce(private.ap7_company_name(p_company), '')
$$;
revoke all on function private.ap7_statement_message(uuid, uuid, date, date, jsonb) from public, anon, authenticated;

-- Prepares statements for one month for every customer whose closing balance at the month end is not zero.
create or replace function private.ap7_prepare_statements(p_company uuid, p_start date, p_run uuid, p_actor uuid, p_customer uuid default null)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_end date := (date_trunc('month', p_start) + interval '1 month - 1 day')::date; cu record; s jsonb; v_contact jsonb; v_n integer := 0; v_examined integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':ap7-statements:' || p_start::text, 0));
  for cu in select distinct i.customer_id from public.invoices i
      where i.company_id = p_company and i.customer_id is not null and i.status not in ('draft', 'cancelled') and i.invoice_date <= v_end
        and (p_customer is null or i.customer_id = p_customer) order by 1 loop
    v_examined := v_examined + 1;
    if exists (select 1 from public.customer_statements x where x.company_id = p_company and x.customer_id = cu.customer_id and x.period_start = p_start and x.status <> 'superseded') then
      continue;
    end if;
    s := private.ap7_statement(p_company, cu.customer_id, p_start, v_end);
    if abs((s ->> 'closing_balance')::numeric) < 0.01 then continue; end if;
    v_contact := private.ap7_customer_contact(cu.customer_id);
    insert into public.customer_statements(company_id, customer_id, period_start, period_end, opening_balance, invoiced, received, credited, closing_balance, on_account,
        lines, open_invoices, message, phone, email, job_run_id, prepared_by)
      values (p_company, cu.customer_id, p_start, v_end, (s ->> 'opening_balance')::numeric, (s ->> 'invoiced')::numeric, (s ->> 'received')::numeric,
        (s ->> 'credited')::numeric, (s ->> 'closing_balance')::numeric, (s ->> 'on_account')::numeric, s -> 'lines', s -> 'open_invoices',
        private.ap7_statement_message(p_company, cu.customer_id, p_start, v_end, s), v_contact ->> 'phone', v_contact ->> 'email', p_run, p_actor);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('examined', v_examined, 'prepared', v_n, 'period_start', p_start, 'period_end', v_end);
end;
$$;
revoke all on function private.ap7_prepare_statements(uuid, date, uuid, uuid, uuid) from public, anon, authenticated;

-- Morning job: from the first working day of a month, prepares last month's statements (once; a missed day catches up).
create or replace function private.ap7_statement_job(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_today date := private.ist_today(); v jsonb;
begin
  if v_today < private.ap7_first_working_day(p_company, v_today) then
    return jsonb_build_object('examined', 0, 'proposals', 0, 'alerts', 0, 'details', jsonb_build_object('waiting_for', private.ap7_first_working_day(p_company, v_today)));
  end if;
  v := private.ap7_prepare_statements(p_company, (date_trunc('month', v_today) - interval '1 month')::date, p_run, null);
  return jsonb_build_object('examined', (v ->> 'examined')::integer, 'proposals', (v ->> 'prepared')::integer, 'alerts', 0, 'details', v);
end;
$$;
revoke all on function private.ap7_statement_job(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap7_statement_row(s public.customer_statements, p_full boolean)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select (to_jsonb(s) - array['company_id', 'sent_by', 'skipped_by', 'prepared_by', 'job_run_id'] - case when p_full then array[]::text[] else array['lines', 'open_invoices'] end)
    || jsonb_build_object('customer', private.ap3_customer_name(s.customer_id),
      'sent_by_name', (select u.full_name from public.app_users u where u.id = s.sent_by),
      'skipped_by_name', (select u.full_name from public.app_users u where u.id = s.skipped_by),
      'prepared_by_name', coalesce((select u.full_name from public.app_users u where u.id = s.prepared_by), 'Scheduled job'))
$$;
revoke all on function private.ap7_statement_row(public.customer_statements, boolean) from public, anon, authenticated;

create or replace function public.ap_statement(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; s public.customer_statements%rowtype; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); v_search text := coalesce(p_payload ->> 'search', '');
  v_status text; v_start date; v_end date; v_new jsonb; v_via text;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'accounts']);
  if p_command in ('get', 'copy', 'send', 'send_provider', 'skip', 'rebuild') then
    select * into s from public.customer_statements x where x.id = private.ap_uuid(p_payload, 'id') and x.company_id = c.company_id for update;
    if s.id is null then raise exception 'AP: Statement not found.'; end if;
  end if;
  if p_payload ? 'period' then
    if coalesce(p_payload ->> 'period', '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'AP: Choose the month as YYYY-MM.'; end if;
    v_start := ((p_payload ->> 'period') || '-01')::date;
  end if;
  if p_command = 'queue' then
    perform private.ap_keys(p_payload, array['page', 'search', 'status', 'period', 'sort']);
    v_status := coalesce(p_payload ->> 'status', 'prepared');
    if v_status not in ('prepared', 'sent', 'skipped', 'superseded', 'all') then raise exception 'AP: Invalid request.'; end if;
    select coalesce(jsonb_agg(z.r order by z.k), '[]'), max(z.total) into v_rows, v_total from (
      select private.ap7_statement_row(x, false) r,
        row_number() over (order by case when p_payload ->> 'sort' = 'amount' then -x.closing_balance end, x.period_start desc, private.ap3_customer_name(x.customer_id), x.id) k,
        count(*) over () total
      from public.customer_statements x
      where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status) and (v_start is null or x.period_start = v_start)
        and coalesce(private.ap3_customer_name(x.customer_id), '') ilike '%' || v_search || '%'
      order by k limit 10 offset (v_page - 1) * 10) z;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page, 'status', v_status,
      'last_period', (select max(x.period_start) from public.customer_statements x where x.company_id = c.company_id));
  elsif p_command = 'get' then
    perform private.ap_keys(p_payload, array['id']);
    return private.ap7_statement_row(s, true) || jsonb_build_object('company', (select jsonb_build_object('name', co.name, 'legal_name', co.legal_name, 'gst_number', co.gst_number,
        'address', concat_ws(', ', nullif(co.billing_address, ''), nullif(co.city, ''), nullif(co.state, ''), nullif(co.pincode, ''))) from public.companies co where co.id = c.company_id),
      'customer_details', (select jsonb_build_object('name', coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name), 'gst_number', cu.gst_number,
        'address', concat_ws(', ', nullif(cu.billing_address, ''), nullif(cu.city, ''), nullif(cu.state, ''), nullif(cu.pincode, ''))) from public.customers cu where cu.id = s.customer_id));
  elsif p_command = 'prepare' then
    perform private.ap_keys(p_payload, array['period']);
    if v_start is null then v_start := (date_trunc('month', private.ist_today()) - interval '1 month')::date; end if;
    if v_start >= date_trunc('month', private.ist_today())::date then raise exception 'AP: Statements are prepared only for a month that has ended.'; end if;
    return private.ap7_prepare_statements(c.company_id, v_start, null, c.actor_id);
  elsif p_command = 'copy' then
    perform private.ap_keys(p_payload, array['id']);
    if s.status <> 'prepared' then raise exception 'AP: Only a prepared statement can be copied.'; end if;
    update public.customer_statements set copied_at = clock_timestamp() where id = s.id returning * into s;
    return private.ap7_statement_row(s, false) || jsonb_build_object('note', 'Copied. The statement is recorded as sent only when you mark it sent.');
  elsif p_command in ('send', 'send_provider') then
    -- 'send' records a person's own sending; 'send_provider' is called by the server action after the email provider
    -- accepted the message, with the provider's reference.
    perform private.ap_keys(p_payload, case when p_command = 'send' then array['id', 'via'] else array['id', 'provider_ref'] end);
    if s.status = 'sent' then return private.ap7_statement_row(s, false) || jsonb_build_object('repeated', true); end if;
    if s.status <> 'prepared' then raise exception 'AP: This statement is % and cannot be marked sent.', s.status; end if;
    v_via := case when p_command = 'send_provider' then 'email_provider' else coalesce(p_payload ->> 'via', '') end;
    if (p_command = 'send' and v_via not in ('whatsapp', 'email', 'phone_call', 'post', 'other')) then raise exception 'AP: Choose how the statement was sent.'; end if;
    update public.customer_statements set status = 'sent', sent_via = v_via, sent_at = clock_timestamp(), sent_by = c.actor_id,
        provider_ref = case when p_command = 'send_provider' then private.ap_text(p_payload ->> 'provider_ref', 'Provider reference', 1, 200) end
      where id = s.id returning * into s;
    return private.ap7_statement_row(s, false);
  elsif p_command = 'skip' then
    perform private.ap_keys(p_payload, array['id', 'reason']);
    if s.status <> 'prepared' then raise exception 'AP: Only a prepared statement can be skipped.'; end if;
    update public.customer_statements set status = 'skipped', skip_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), skipped_by = c.actor_id
      where id = s.id returning * into s;
    return private.ap7_statement_row(s, false);
  elsif p_command = 'rebuild' then
    -- After a correction in the month, an unsent statement is rebuilt from the records as they are now.
    perform private.ap_keys(p_payload, array['id']);
    if s.status <> 'prepared' then raise exception 'AP: Only an unsent statement can be rebuilt.'; end if;
    update public.customer_statements set status = 'superseded' where id = s.id;
    v_new := private.ap7_prepare_statements(c.company_id, s.period_start, null, c.actor_id, s.customer_id);
    return v_new || jsonb_build_object('id', (select x.id from public.customer_statements x where x.company_id = c.company_id and x.customer_id = s.customer_id
      and x.period_start = s.period_start and x.status <> 'superseded'));
  elsif p_command = 'coverage' then
    perform private.ap_keys(p_payload, array['period']);
    if v_start is null then v_start := (date_trunc('month', private.ist_today()) - interval '1 month')::date; end if;
    v_end := (v_start + interval '1 month - 1 day')::date;
    return (with cust as (select distinct i.customer_id from public.invoices i where i.company_id = c.company_id and i.customer_id is not null
          and i.status not in ('draft', 'cancelled') and i.invoice_date <= v_end),
        bal as (select cu.customer_id, (private.ap7_statement(c.company_id, cu.customer_id, v_start, v_end) ->> 'closing_balance')::numeric closing from cust cu),
        st as (select b.customer_id, b.closing, x.status from bal b left join public.customer_statements x on x.company_id = c.company_id and x.customer_id = b.customer_id
          and x.period_start = v_start and x.status <> 'superseded' where abs(b.closing) >= 0.01)
      select jsonb_build_object('period_start', v_start, 'period_end', v_end, 'with_balance', count(*), 'sent', count(*) filter (where status = 'sent'),
        'prepared', count(*) filter (where status = 'prepared'), 'skipped', count(*) filter (where status = 'skipped'),
        'missing', count(*) filter (where status is null)) from st);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_statement(text, jsonb) from public, anon;
grant execute on function public.ap_statement(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-001 job
-- ---------------------------------------------------------------------------------------------------------------
alter function private.ap_job_registry() rename to ap7_previous_job_registry;
create function private.ap_job_registry() returns table(job_key text, schedule text, label text, description text)
language sql immutable set search_path = public, private as $$
  select * from private.ap7_previous_job_registry() union all values
    ('receivables.statements', 'morning', 'Prepare monthly customer statements', 'From the first working day of each month, prepares last month''s statement for every customer with a balance. A person reviews and sends each.')
$$;
revoke all on function private.ap_job_registry() from public, anon, authenticated;

alter function private.ap_job_execute(uuid, text, uuid) rename to ap7_previous_job_execute;
create function private.ap_job_execute(p_company uuid, p_job text, p_run uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_job = 'receivables.statements' then return private.ap7_statement_job(p_company, p_run); end if;
  return private.ap7_previous_job_execute(p_company, p_job, p_run);
end;
$$;
revoke all on function private.ap_job_execute(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Row security: every new table is company-scoped, readable by its working roles, and written only through the gateways.
-- ---------------------------------------------------------------------------------------------------------------
do $$ declare t text; roles text; begin
  foreach t in array array['automation_rule_changes', 'purchase_price_settings', 'purchase_line_price_checks', 'order_delay_notices', 'customer_statements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    roles := case
      when t = 'automation_rule_changes' then 'array[''owner'',''admin'',''factory_manager'']'
      when t in ('purchase_price_settings', 'purchase_line_price_checks') then 'array[''owner'',''admin'',''accounts'',''inventory_manager'',''factory_manager'']'
      when t = 'order_delay_notices' then 'array[''owner'',''admin'',''sales_manager'',''sales'',''factory_manager'',''dispatch_manager'']'
      else 'array[''owner'',''admin'',''accounts'']' end;
    execute format('drop policy if exists ap7_read on public.%I', t);
    execute format('create policy ap7_read on public.%I for select to authenticated using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) = any(%s))', t, roles);
  end loop;
end $$;

commit;
