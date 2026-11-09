-- Autopilot batch 1 (AUTOPILOT_UPGRADES.md): AP-001 scheduled jobs, AP-002 proposals, AP-004 factory calendar,
-- AP-005 financial-year numbering, AP-006 master import, AP-007 cut-over, AP-038 GSTIN, AP-041 home-record work,
-- AP-042 role navigation, AP-059 period close and back-dating.
--
-- Additive only. Every new table carries company_id with RLS; clients read and write through security-definer
-- functions that take the company and the actor from the session. Jobs and proposals never post stock, money,
-- quality approval or customer messages by themselves: a proposal is applied only when a person accepts it, and the
-- domain action is re-run with server checks at that moment. Messages meant for people start with 'AP: '.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap_ctx(p_roles text[] default null)
returns table(company_id uuid, actor_id uuid, role text, full_name text)
language plpgsql stable security definer set search_path = public, private as $$
begin
  return query select u.company_id, u.id, u.role, coalesce(nullif(btrim(u.full_name), ''), u.email, 'Employee')
    from public.app_users u
    where u.id = auth.uid() and u.is_active and u.dealer_id is null and u.company_id is not null and u.role not in ('dealer_admin', 'dealer_staff')
      and (p_roles is null or u.role = any(p_roles));
  if not found then raise exception 'Not permitted' using errcode = '42501'; end if;
end;
$$;
revoke all on function private.ap_ctx(text[]) from public, anon, authenticated;

create or replace function private.ap_text(p_value text, p_label text, p_min integer, p_max integer, p_required boolean default true)
returns text language plpgsql immutable set search_path = public, private as $$
declare v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v is null then
    if p_required then raise exception 'AP: % is required.', p_label; end if;
    return null;
  end if;
  if v ~ '[[:cntrl:]]' then raise exception 'AP: Remove control characters from %.', lower(p_label); end if;
  if length(v) < p_min or length(v) > p_max then raise exception 'AP: % must be % to % characters.', p_label, p_min, p_max; end if;
  return v;
end;
$$;
revoke all on function private.ap_text(text, text, integer, integer, boolean) from public, anon, authenticated;

create or replace function private.ap_uuid(p_payload jsonb, p_key text, p_required boolean default true)
returns uuid language plpgsql immutable set search_path = public, private as $$
declare v text := nullif(btrim(coalesce(p_payload ->> p_key, '')), '');
begin
  if v is null then
    if p_required then raise exception 'AP: Choose a record for %.', replace(p_key, '_', ' '); end if;
    return null;
  end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'AP: Invalid identifier for %.', replace(p_key, '_', ' '); end if;
  return v::uuid;
end;
$$;
revoke all on function private.ap_uuid(jsonb, text, boolean) from public, anon, authenticated;

create or replace function private.ap_keys(p_payload jsonb, p_allowed text[])
returns void language plpgsql immutable set search_path = public, private as $$
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'AP: Invalid request.'; end if;
  if exists (select 1 from jsonb_object_keys(p_payload) k where not (k = any(p_allowed))) then raise exception 'AP: Invalid request.'; end if;
end;
$$;
revoke all on function private.ap_keys(jsonb, text[]) from public, anon, authenticated;

-- Indian financial year label for a date: 9 Nov 2026 -> '26-27' (short) or '2026-27' (long).
create or replace function private.ap_fy_start_year(p_date date)
returns integer language sql immutable set search_path = public, private as $$
  select case when extract(month from p_date) >= 4 then extract(year from p_date)::integer else extract(year from p_date)::integer - 1 end
$$;
create or replace function private.ap_fy_label(p_date date, p_long boolean default false)
returns text language sql immutable set search_path = public, private as $$
  select case when p_long then y::text else lpad((y % 100)::text, 2, '0') end || '-' || lpad(((y + 1) % 100)::text, 2, '0')
  from (select private.ap_fy_start_year(p_date) y) s
$$;
revoke all on function private.ap_fy_start_year(date) from public, anon, authenticated;
revoke all on function private.ap_fy_label(date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-038: GSTIN format, state code and check digit
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap_gst_state(p_code text)
returns text language sql immutable set search_path = public, private as $$
  select case p_code
    when '01' then 'Jammu and Kashmir' when '02' then 'Himachal Pradesh' when '03' then 'Punjab' when '04' then 'Chandigarh'
    when '05' then 'Uttarakhand' when '06' then 'Haryana' when '07' then 'Delhi' when '08' then 'Rajasthan' when '09' then 'Uttar Pradesh'
    when '10' then 'Bihar' when '11' then 'Sikkim' when '12' then 'Arunachal Pradesh' when '13' then 'Nagaland' when '14' then 'Manipur'
    when '15' then 'Mizoram' when '16' then 'Tripura' when '17' then 'Meghalaya' when '18' then 'Assam' when '19' then 'West Bengal'
    when '20' then 'Jharkhand' when '21' then 'Odisha' when '22' then 'Chhattisgarh' when '23' then 'Madhya Pradesh' when '24' then 'Gujarat'
    when '25' then 'Daman and Diu' when '26' then 'Dadra and Nagar Haveli and Daman and Diu' when '27' then 'Maharashtra'
    when '28' then 'Andhra Pradesh (before reorganisation)' when '29' then 'Karnataka' when '30' then 'Goa' when '31' then 'Lakshadweep'
    when '32' then 'Kerala' when '33' then 'Tamil Nadu' when '34' then 'Puducherry' when '35' then 'Andaman and Nicobar Islands'
    when '36' then 'Telangana' when '37' then 'Andhra Pradesh' when '38' then 'Ladakh' when '97' then 'Other Territory' when '99' then 'Centre Jurisdiction'
  end
$$;
revoke all on function private.ap_gst_state(text) from public, anon, authenticated;

create or replace function private.ap_gstin_check_char(p_gstin text)
returns text language plpgsql immutable strict set search_path = public, private as $$
declare
  v_chars constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v_sum integer := 0; v_value integer; v_index integer;
begin
  for v_index in 1..14 loop
    v_value := (strpos(v_chars, substr(p_gstin, v_index, 1)) - 1) * (case when v_index % 2 = 0 then 2 else 1 end);
    v_sum := v_sum + (v_value / 36) + (v_value % 36);
  end loop;
  return substr(v_chars, ((36 - (v_sum % 36)) % 36) + 1, 1);
end;
$$;
create or replace function private.ap_gstin_valid(p_gstin text)
returns boolean language sql immutable set search_path = public, private as $$
  select coalesce(upper(p_gstin) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$'
    and private.ap_gst_state(substr(upper(p_gstin), 1, 2)) is not null
    and private.ap_gstin_check_char(upper(p_gstin)) = substr(upper(p_gstin), 15, 1), false)
$$;
revoke all on function private.ap_gstin_check_char(text) from public, anon, authenticated;
revoke all on function private.ap_gstin_valid(text) from public, anon, authenticated;

alter table public.customers add column if not exists gst_registration text;
alter table public.vendors add column if not exists gst_registration text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customers_gst_registration_check') then
    alter table public.customers add constraint customers_gst_registration_check check (gst_registration in ('registered', 'unregistered'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendors_gst_registration_check') then
    alter table public.vendors add constraint vendors_gst_registration_check check (gst_registration in ('registered', 'unregistered'));
  end if;
end $$;
comment on column public.customers.gst_registration is 'AP-038: registered (valid GSTIN required) or unregistered (explicit choice). Null means not yet reviewed (records before AP-038).';
comment on column public.vendors.gst_registration is 'AP-038: registered (valid GSTIN required) or unregistered (explicit choice). Null means not yet reviewed (records before AP-038).';

-- Only a changed GSTIN or registration choice is checked, so an unrelated edit to an older record is not blocked.
create or replace function private.ap_guard_gstin()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op = 'UPDATE' and new.gst_number is not distinct from old.gst_number and new.gst_registration is not distinct from old.gst_registration then
    return new;
  end if;
  new.gst_number := nullif(upper(btrim(coalesce(new.gst_number, ''))), '');
  if new.gst_number is not null then
    if not private.ap_gstin_valid(new.gst_number) then
      raise exception 'GSTIN % fails the format, state code or check-digit test', new.gst_number using errcode = '23514';
    end if;
    if new.gst_registration = 'unregistered' then
      raise exception 'A party marked unregistered cannot carry a GSTIN' using errcode = '23514';
    end if;
    new.gst_registration := 'registered';
    if nullif(btrim(coalesce(new.state, '')), '') is null then new.state := private.ap_gst_state(substr(new.gst_number, 1, 2)); end if;
  elsif new.gst_registration = 'registered' then
    raise exception 'Enter the GSTIN or mark the party unregistered' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.ap_guard_gstin() from public, anon, authenticated;
drop trigger if exists ap_guard_gstin on public.customers;
create trigger ap_guard_gstin before insert or update of gst_number, gst_registration on public.customers
  for each row execute function private.ap_guard_gstin();
drop trigger if exists ap_guard_gstin on public.vendors;
create trigger ap_guard_gstin before insert or update of gst_number, gst_registration on public.vendors
  for each row execute function private.ap_guard_gstin();

-- ---------------------------------------------------------------------------------------------------------------
-- AP-001: scheduled job ledger
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.system_job_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_key text not null check (job_key ~ '^[a-z_]+\.[a-z_]+$'),
  window_key text not null check (window_key ~ '^(hour|day|manual):[0-9T]{8,13}$'),
  trigger_source text not null check (trigger_source in ('cron', 'manual')),
  requested_by uuid references auth.users(id),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  examined integer not null default 0 check (examined >= 0),
  proposals_created integer not null default 0 check (proposals_created >= 0),
  alerts_created integer not null default 0 check (alerts_created >= 0),
  error_message text,
  details jsonb not null default '{}'::jsonb,
  unique (company_id, job_key, window_key),
  check ((trigger_source = 'manual') = (requested_by is not null))
);
create index if not exists system_job_runs_company_job_idx on public.system_job_runs(company_id, job_key, started_at desc);
alter table public.system_job_runs enable row level security;
drop policy if exists "job runs owner read" on public.system_job_runs;
create policy "job runs owner read" on public.system_job_runs for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) in ('owner', 'admin'));
revoke all on public.system_job_runs from public, anon, authenticated;
grant select on public.system_job_runs to authenticated;

-- The registry is mirrored by lib/jobs/registry.ts (a test compares them).
create or replace function private.ap_job_registry()
returns table(job_key text, schedule text, label text, description text)
language sql immutable set search_path = public, private as $$
  values
    ('proposals.refresh', 'hourly', 'Refresh open proposals', 'Marks proposals stale when their inputs changed and expired when their time passed.'),
    ('navigation.propose', 'nightly', 'Propose role navigation', 'After two weeks of visit counts, proposes the most used destinations for each role.'),
    ('series.propose', 'nightly', 'Propose financial-year numbering', 'Proposes a financial-year number series for each document type that has none.'),
    ('calendar.check', 'nightly', 'Check the factory calendar', 'Alerts the plant head when the coming months have no holidays or shutdowns entered.'),
    ('periods.propose_close', 'morning', 'Propose month close', 'Proposes closing the previous month once the close day is reached.')
$$;
revoke all on function private.ap_job_registry() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-002: proposals (Detect -> Propose -> Confirm -> Learn)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  proposal_type text not null check (proposal_type in ('navigation.role_layout', 'period.close_month', 'series.adopt')),
  target_key text not null check (length(target_key) between 1 and 80),
  title text not null check (length(title) between 3 and 160),
  payload jsonb not null,
  inputs jsonb not null,
  inputs_fingerprint text not null,
  rule_key text not null,
  reason text not null check (length(reason) between 3 and 600),
  confidence numeric(4, 3) check (confidence between 0 and 1),
  decide_roles text[] not null check (cardinality(decide_roles) > 0),
  status text not null default 'open' check (status in ('open', 'accepted', 'edited', 'rejected', 'stale', 'expired')),
  job_run_id uuid references public.system_job_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_payload jsonb,
  edited_fields text[] not null default '{}',
  decision_note text,
  outcome jsonb,
  check ((status in ('accepted', 'edited', 'rejected')) = (decided_by is not null and decided_at is not null))
);
create unique index if not exists proposals_one_open_per_target on public.proposals(company_id, proposal_type, target_key) where status = 'open';
create index if not exists proposals_company_status_idx on public.proposals(company_id, status, created_at desc);
create index if not exists proposals_job_run_idx on public.proposals(job_run_id);
alter table public.proposals enable row level security;
drop policy if exists "proposals decider read" on public.proposals;
create policy "proposals decider read" on public.proposals for select to authenticated
  using (company_id = (select public.get_current_user_company_id())
    and ((select public.get_current_user_role()) = any(decide_roles) or (select public.get_current_user_role()) in ('owner', 'admin')));
revoke all on public.proposals from public, anon, authenticated;
grant select on public.proposals to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-004: one factory calendar
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.factory_calendar_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  weekly_off smallint[] not null default '{0}' check (weekly_off <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] and cardinality(weekly_off) <= 3),
  shifts jsonb not null default '[{"code":"A","start":"06:00","end":"14:00"},{"code":"B","start":"14:00","end":"22:00"},{"code":"C","start":"22:00","end":"06:00"}]'::jsonb
    check (jsonb_typeof(shifts) = 'array' and jsonb_array_length(shifts) between 1 and 4),
  promise_basis text not null default 'calendar' check (promise_basis in ('calendar', 'working')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.factory_calendar_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  date_from date not null,
  date_to date not null,
  kind text not null check (kind in ('holiday', 'shutdown', 'maintenance', 'working_day')),
  label text not null check (length(btrim(label)) between 3 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  removed_by uuid references auth.users(id),
  removed_at timestamptz,
  check (date_to >= date_from and date_to - date_from <= 62)
);
create index if not exists factory_calendar_exceptions_range_idx on public.factory_calendar_exceptions(company_id, date_from, date_to) where removed_at is null;
alter table public.factory_calendar_settings enable row level security;
alter table public.factory_calendar_exceptions enable row level security;
drop policy if exists "calendar settings read" on public.factory_calendar_settings;
create policy "calendar settings read" on public.factory_calendar_settings for select to authenticated using (company_id = (select public.get_current_user_company_id()));
drop policy if exists "calendar exceptions read" on public.factory_calendar_exceptions;
create policy "calendar exceptions read" on public.factory_calendar_exceptions for select to authenticated using (company_id = (select public.get_current_user_company_id()));
revoke all on public.factory_calendar_settings, public.factory_calendar_exceptions from public, anon, authenticated;
grant select on public.factory_calendar_settings, public.factory_calendar_exceptions to authenticated;

-- A day is working unless it is a weekly off (and not overridden by a working-day entry) or falls in a holiday,
-- shutdown or maintenance entry. Mirrors lib/calendar/working-time.ts.
create or replace function private.factory_is_working_day(p_company uuid, p_day date)
returns boolean language sql stable security definer set search_path = public, private as $$
  select case
    when exists (select 1 from public.factory_calendar_exceptions e where e.company_id = p_company and e.removed_at is null
      and e.kind <> 'working_day' and p_day between e.date_from and e.date_to) then false
    when extract(dow from p_day)::smallint = any(coalesce((select s.weekly_off from public.factory_calendar_settings s where s.company_id = p_company), '{0}'::smallint[]))
      then exists (select 1 from public.factory_calendar_exceptions e where e.company_id = p_company and e.removed_at is null
        and e.kind = 'working_day' and p_day between e.date_from and e.date_to)
    else true end
$$;
create or replace function private.factory_add_working_days(p_company uuid, p_start date, p_days integer)
returns date language plpgsql stable security definer set search_path = public, private as $$
declare v_day date := p_start; v_left integer := p_days; v_guard integer := 0;
begin
  if p_start is null or p_days is null then return null; end if;
  if p_days < 0 or p_days > 730 then raise exception 'AP: Working days must be between 0 and 730.'; end if;
  while v_left > 0 loop
    v_day := v_day + 1; v_guard := v_guard + 1;
    if v_guard > 3000 then raise exception 'AP: The factory calendar has no working days in range.'; end if;
    if private.factory_is_working_day(p_company, v_day) then v_left := v_left - 1; end if;
  end loop;
  return v_day;
end;
$$;
create or replace function private.factory_working_days_between(p_company uuid, p_from date, p_to date)
returns integer language sql stable security definer set search_path = public, private as $$
  select case when p_from is null or p_to is null then null
    when p_to <= p_from then 0
    else (select count(*)::integer from generate_series(p_from + 1, p_to, interval '1 day') g(d) where private.factory_is_working_day(p_company, g.d::date)) end
$$;
revoke all on function private.factory_is_working_day(uuid, date) from public, anon, authenticated;
revoke all on function private.factory_add_working_days(uuid, date, integer) from public, anon, authenticated;
revoke all on function private.factory_working_days_between(uuid, date, date) from public, anon, authenticated;

create or replace function public.ap_calendar(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  c record; v_from date; v_to date; v_kind text; v_label text; v_id uuid; v_off smallint[]; v_shifts jsonb; v_basis text; v_days integer; v_start date;
  v_writers constant text[] := array['owner', 'admin', 'factory_manager', 'production_manager'];
begin
  select * into c from private.ap_ctx(null);
  if p_command = 'read' then
    perform private.ap_keys(p_payload, array['from', 'to']);
    v_from := coalesce((p_payload ->> 'from')::date, date_trunc('month', private.ist_today())::date);
    v_to := coalesce((p_payload ->> 'to')::date, (v_from + interval '1 year')::date);
    if v_to < v_from or v_to - v_from > 800 then raise exception 'AP: Choose a range of up to two years.'; end if;
    return jsonb_build_object(
      'settings', coalesce((select jsonb_build_object('weekly_off', to_jsonb(s.weekly_off), 'shifts', s.shifts, 'promise_basis', s.promise_basis, 'updated_at', s.updated_at)
        from public.factory_calendar_settings s where s.company_id = c.company_id),
        jsonb_build_object('weekly_off', '[0]'::jsonb, 'shifts', '[{"code":"A","start":"06:00","end":"14:00"},{"code":"B","start":"14:00","end":"22:00"},{"code":"C","start":"22:00","end":"06:00"}]'::jsonb, 'promise_basis', 'calendar', 'updated_at', null)),
      'exceptions', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'date_from', e.date_from, 'date_to', e.date_to, 'kind', e.kind, 'label', e.label,
          'days', e.date_to - e.date_from + 1) order by e.date_from, e.id)
        from public.factory_calendar_exceptions e where e.company_id = c.company_id and e.removed_at is null and e.date_to >= v_from and e.date_from <= v_to), '[]'::jsonb),
      'can_edit', c.role = any(v_writers), 'from', v_from, 'to', v_to);
  elsif p_command = 'add_working_days' then
    perform private.ap_keys(p_payload, array['start', 'days']);
    v_start := (p_payload ->> 'start')::date; v_days := (p_payload ->> 'days')::integer;
    if v_start is null or v_days is null then raise exception 'AP: Enter a start date and a number of days.'; end if;
    return jsonb_build_object('date', private.factory_add_working_days(c.company_id, v_start, v_days), 'calendar_date', v_start + v_days);
  end if;
  if not (c.role = any(v_writers)) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if p_command = 'save_settings' then
    perform private.ap_keys(p_payload, array['weekly_off', 'shifts', 'promise_basis']);
    if jsonb_typeof(coalesce(p_payload -> 'weekly_off', '[]'::jsonb)) <> 'array'
      or exists (select 1 from jsonb_array_elements_text(coalesce(p_payload -> 'weekly_off', '[]'::jsonb)) x where x !~ '^[0-6]$') then
      raise exception 'AP: Weekly off days must be 0 (Sunday) to 6 (Saturday).';
    end if;
    select coalesce(array_agg(distinct x::smallint order by x::smallint), '{}'::smallint[]) into v_off from jsonb_array_elements_text(coalesce(p_payload -> 'weekly_off', '[]'::jsonb)) x;
    if cardinality(v_off) > 3 then raise exception 'AP: Choose at most three weekly off days.'; end if;
    v_shifts := p_payload -> 'shifts';
    v_basis := coalesce(p_payload ->> 'promise_basis', 'calendar');
    if v_basis not in ('calendar', 'working') then raise exception 'AP: Choose calendar days or working days for promises.'; end if;
    if v_shifts is null or jsonb_typeof(v_shifts) <> 'array' or jsonb_array_length(v_shifts) not between 1 and 4
      or exists (select 1 from jsonb_array_elements(v_shifts) s where jsonb_typeof(s) <> 'object' or coalesce(s ->> 'code', '') !~ '^[A-Z0-9]{1,3}$'
        or coalesce(s ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(s ->> 'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or (s ->> 'start') = (s ->> 'end')) then
      raise exception 'AP: Enter one to four shifts with a code and HH:MM start and end times.';
    end if;
    if (select count(distinct s ->> 'code') from jsonb_array_elements(v_shifts) s) <> jsonb_array_length(v_shifts) then raise exception 'AP: Shift codes must be different.'; end if;
    insert into public.factory_calendar_settings(company_id, weekly_off, shifts, promise_basis, updated_by, updated_at)
      values (c.company_id, v_off, v_shifts, v_basis, c.actor_id, now())
      on conflict (company_id) do update set weekly_off = excluded.weekly_off, shifts = excluded.shifts, promise_basis = excluded.promise_basis,
        updated_by = excluded.updated_by, updated_at = now();
    return jsonb_build_object('saved', true);
  elsif p_command = 'add_exception' then
    perform private.ap_keys(p_payload, array['date_from', 'date_to', 'kind', 'label']);
    v_from := (p_payload ->> 'date_from')::date; v_to := coalesce((p_payload ->> 'date_to')::date, v_from);
    v_kind := p_payload ->> 'kind'; v_label := private.ap_text(p_payload ->> 'label', 'Label', 3, 80);
    if v_from is null or coalesce(v_kind, '') not in ('holiday', 'shutdown', 'maintenance', 'working_day') then raise exception 'AP: Choose the dates and the kind of day.'; end if;
    if v_to < v_from or v_to - v_from > 62 then raise exception 'AP: An entry may cover up to 63 days.'; end if;
    perform 1 from public.companies where id = c.company_id for update;
    if exists (select 1 from public.factory_calendar_exceptions e where e.company_id = c.company_id and e.removed_at is null
      and e.date_from <= v_to and e.date_to >= v_from and ((v_kind = 'working_day') <> (e.kind = 'working_day'))) then
      raise exception 'AP: A working-day entry cannot overlap a holiday, shutdown or maintenance entry.';
    end if;
    if exists (select 1 from public.factory_calendar_exceptions e where e.company_id = c.company_id and e.removed_at is null
      and e.date_from = v_from and e.date_to = v_to and e.kind = v_kind) then
      raise exception 'AP: The same entry already exists.';
    end if;
    insert into public.factory_calendar_exceptions(company_id, date_from, date_to, kind, label, created_by)
      values (c.company_id, v_from, v_to, v_kind, v_label, c.actor_id) returning id into v_id;
    return jsonb_build_object('id', v_id);
  elsif p_command = 'remove_exception' then
    perform private.ap_keys(p_payload, array['id']);
    update public.factory_calendar_exceptions set removed_by = c.actor_id, removed_at = now()
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and removed_at is null returning id into v_id;
    if v_id is null then raise exception 'AP: This entry is no longer on the calendar.'; end if;
    return jsonb_build_object('id', v_id);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_calendar(text, jsonb) from public, anon;
grant execute on function public.ap_calendar(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-005: document numbers by Indian financial year
-- ---------------------------------------------------------------------------------------------------------------
-- A series is active only after accounts confirms it (normally by accepting a proposal). Until then the existing
-- calendar-year numbering continues unchanged, and existing numbers are never rewritten.
create table if not exists public.document_series (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  doc_key text not null check (doc_key in ('invoices', 'credit_notes', 'quotes', 'orders', 'dispatches')),
  prefix_template text not null check (prefix_template ~ '^[A-Z0-9/-]{0,10}\{FY4?\}[A-Z0-9/-]{0,6}$'),
  pad_width smallint not null default 4 check (pad_width between 3 and 6),
  gap_free boolean not null,
  status text not null default 'active' check (status in ('active', 'retired')),
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  proposal_id uuid references public.proposals(id) on delete set null,
  retired_by uuid references auth.users(id),
  retired_at timestamptz,
  check ((status = 'retired') = (retired_at is not null))
);
create unique index if not exists document_series_one_active on public.document_series(company_id, doc_key) where status = 'active';
create table if not exists public.document_series_counters (
  series_id uuid not null references public.document_series(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  fy_label text not null check (fy_label ~ '^[0-9]{2}-[0-9]{2}$'),
  last_value bigint not null check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (series_id, fy_label)
);
create index if not exists document_series_counters_company_idx on public.document_series_counters(company_id);
alter table public.document_series enable row level security;
alter table public.document_series_counters enable row level security;
drop policy if exists "document series read" on public.document_series;
create policy "document series read" on public.document_series for select to authenticated using (company_id = (select public.get_current_user_company_id()));
drop policy if exists "document series counters read" on public.document_series_counters;
create policy "document series counters read" on public.document_series_counters for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) in ('owner', 'admin', 'accounts'));
revoke all on public.document_series, public.document_series_counters from public, anon, authenticated;
grant select on public.document_series, public.document_series_counters to authenticated;

create or replace function private.ap_series_doc(p_table regclass, p_column text)
returns text language sql immutable set search_path = public, private as $$
  select case
    when p_table = 'public.invoices'::regclass and p_column = 'invoice_number' then 'invoices'
    when p_table = 'public.credit_notes'::regclass and p_column = 'credit_note_number' then 'credit_notes'
    when p_table = 'public.quotes'::regclass and p_column = 'quote_number' then 'quotes'
    when p_table = 'public.orders'::regclass and p_column = 'order_number' then 'orders'
    when p_table = 'public.dispatches'::regclass and p_column = 'dispatch_number' then 'dispatches'
  end
$$;
create or replace function private.ap_series_stem(p_template text, p_date date)
returns text language sql immutable set search_path = public, private as $$
  select replace(replace(p_template, '{FY4}', private.ap_fy_label(p_date, true)), '{FY}', private.ap_fy_label(p_date, false))
$$;
revoke all on function private.ap_series_doc(regclass, text) from public, anon, authenticated;
revoke all on function private.ap_series_stem(text, date) from public, anon, authenticated;

-- The pre-AP-005 allocator, kept as the fallback when no series is active (calendar-year stem PREFIX-YYYY-NNNN).
create or replace function private.ap_legacy_business_number(p_table regclass, p_number_column text, p_company_id uuid, p_prefix text, p_business_date date)
returns text language plpgsql security definer set search_path = public, private as $$
declare
  v_stem text := p_prefix || '-' || extract(year from coalesce(p_business_date, (now() at time zone 'Asia/Kolkata')::date))::text || '-';
  v_sequence bigint;
begin
  if nullif(p_prefix, '') is null or p_company_id is null then raise exception 'Number prefix and company are required'; end if;
  if not exists (select 1 from pg_attribute where attrelid = p_table and attname = p_number_column and attnum > 0 and not attisdropped) then
    raise exception 'Invalid business number column';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || p_table::text || ':' || v_stem, 0));
  execute format('select coalesce(max(substring(%1$I from length($2) + 1)::bigint), 0) + 1 from %2$s where company_id = $1 and left(%1$I, length($2)) = $2 and substring(%1$I from length($2) + 1) ~ ''^[0-9]+$''', p_number_column, p_table)
    using p_company_id, v_stem into v_sequence;
  return v_stem || lpad(v_sequence::text, greatest(4, length(v_sequence::text)), '0');
end;
$$;
revoke all on function private.ap_legacy_business_number(regclass, text, uuid, text, date) from public, anon, authenticated;

-- Same signature as before so every existing caller (triggers and posting functions) now honours an active series.
-- The counter row is created and incremented inside the caller's transaction; a rolled-back posting gives its
-- number back, and concurrent postings queue on the counter row, so numbers stay unique and gap-free.
create or replace function private.next_business_number_locked(p_table regclass, p_number_column text, p_company_id uuid, p_prefix text, p_business_date date)
returns text language plpgsql security definer set search_path = public, private as $$
declare
  v_doc text := private.ap_series_doc(p_table, p_number_column);
  v_series public.document_series%rowtype;
  v_date date := coalesce(p_business_date, (now() at time zone 'Asia/Kolkata')::date);
  v_fy text; v_stem text; v_seed bigint; v_value bigint;
begin
  if v_doc is not null and p_company_id is not null then
    select * into v_series from public.document_series where company_id = p_company_id and doc_key = v_doc and status = 'active';
    if found then
      v_fy := private.ap_fy_label(v_date, false);
      v_stem := private.ap_series_stem(v_series.prefix_template, v_date);
      if not exists (select 1 from public.document_series_counters where series_id = v_series.id and fy_label = v_fy) then
        -- Seed from numbers already issued with the same stem (a series retired and re-adopted mid-year never repeats a number).
        execute format('select coalesce(max(substring(%1$I from length($2) + 1)::bigint), 0) from %2$s where company_id = $1 and left(%1$I, length($2)) = $2 and substring(%1$I from length($2) + 1) ~ ''^[0-9]+$''', p_number_column, p_table)
          using p_company_id, v_stem into v_seed;
        insert into public.document_series_counters(series_id, company_id, fy_label, last_value) values (v_series.id, p_company_id, v_fy, v_seed)
          on conflict (series_id, fy_label) do nothing;
      end if;
      update public.document_series_counters set last_value = last_value + 1, updated_at = now()
        where series_id = v_series.id and fy_label = v_fy returning last_value into v_value;
      return v_stem || lpad(v_value::text, greatest(v_series.pad_width::integer, length(v_value::text)), '0');
    end if;
  end if;
  return private.ap_legacy_business_number(p_table, p_number_column, p_company_id, p_prefix, p_business_date);
end;
$$;
revoke all on function private.next_business_number_locked(regclass, text, uuid, text, date) from public, anon, authenticated;

-- Activation is the domain action behind the series.adopt proposal (and the direct confirm on the settings page).
create or replace function private.ap_series_activate(p_company uuid, p_actor uuid, p_role text, p_doc text, p_payload jsonb, p_proposal uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_template text := upper(btrim(coalesce(p_payload ->> 'prefix_template', '')));
  v_pad integer := coalesce((p_payload ->> 'pad_width')::integer, 4);
  v_gap boolean := p_doc in ('invoices', 'credit_notes');
  v_sample text; v_id uuid;
begin
  if p_role not in ('owner', 'admin', 'accounts') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if p_doc not in ('invoices', 'credit_notes', 'quotes', 'orders', 'dispatches') then raise exception 'AP: Unknown document type.'; end if;
  if v_template !~ '^[A-Z0-9/-]{0,10}\{FY4?\}[A-Z0-9/-]{0,6}$' then
    raise exception 'AP: The format must contain {FY} or {FY4} and only capital letters, digits, / and -.';
  end if;
  if v_pad not between 3 and 6 then raise exception 'AP: The running number must have 3 to 6 digits.'; end if;
  v_sample := private.ap_series_stem(v_template, private.ist_today()) || repeat('9', v_pad);
  -- CGST Rule 46(b): a tax invoice serial number may not exceed sixteen characters.
  if v_gap and length(v_sample) > 16 then raise exception 'AP: % numbers would be % characters; GST allows at most 16.', replace(p_doc, '_', ' '), length(v_sample); end if;
  perform 1 from public.companies where id = p_company for update;
  update public.document_series set status = 'retired', retired_by = p_actor, retired_at = now() where company_id = p_company and doc_key = p_doc and status = 'active';
  insert into public.document_series(company_id, doc_key, prefix_template, pad_width, gap_free, confirmed_by, proposal_id)
    values (p_company, p_doc, v_template, v_pad, v_gap, p_actor, p_proposal) returning id into v_id;
  return jsonb_build_object('series_id', v_id, 'doc_key', p_doc, 'next_example', private.ap_series_stem(v_template, private.ist_today()) || lpad('1', v_pad, '0'));
end;
$$;
revoke all on function private.ap_series_activate(uuid, uuid, text, text, jsonb, uuid) from public, anon, authenticated;

-- A number issued from a series is a tax record: the document can be cancelled but never deleted.
create or replace function private.ap_guard_series_number_delete()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_number text := to_jsonb(old) ->> tg_argv[0];
begin
  if v_number is not null and exists (
    select 1 from public.document_series s where s.company_id = old.company_id and s.doc_key = tg_table_name
      -- Templates hold only A-Z, 0-9, / and -, which are literal in a regular expression.
      and v_number ~ ('^' || replace(replace(s.prefix_template, '{FY4}', '[0-9]{4}-[0-9]{2}'), '{FY}', '[0-9]{2}-[0-9]{2}') || '[0-9]{' || s.pad_width || ',}$')
  ) then
    raise exception 'AP: % keeps its number for the tax record; cancel it instead of deleting it.', v_number using errcode = '23514';
  end if;
  return old;
end;
$$;
revoke all on function private.ap_guard_series_number_delete() from public, anon, authenticated;
drop trigger if exists ap_guard_series_number_delete on public.invoices;
create trigger ap_guard_series_number_delete before delete on public.invoices for each row execute function private.ap_guard_series_number_delete('invoice_number');
drop trigger if exists ap_guard_series_number_delete on public.credit_notes;
create trigger ap_guard_series_number_delete before delete on public.credit_notes for each row execute function private.ap_guard_series_number_delete('credit_note_number');

create or replace function public.ap_series(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record;
begin
  select * into c from private.ap_ctx(null);
  if p_command = 'list' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('fy', private.ap_fy_label(private.ist_today(), true), 'can_confirm', c.role in ('owner', 'admin', 'accounts'),
      'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'doc_key', s.doc_key, 'prefix_template', s.prefix_template, 'pad_width', s.pad_width,
        'gap_free', s.gap_free, 'status', s.status, 'confirmed_at', s.confirmed_at, 'confirmed_by', u.full_name,
        'next_example', private.ap_series_stem(s.prefix_template, private.ist_today()) || lpad(((coalesce(k.last_value, 0)) + 1)::text, s.pad_width, '0'),
        'issued_this_year', coalesce(k.last_value, 0)) order by s.doc_key, s.confirmed_at desc)
        from public.document_series s left join public.app_users u on u.id = s.confirmed_by
        left join public.document_series_counters k on k.series_id = s.id and k.fy_label = private.ap_fy_label(private.ist_today(), false)
        where s.company_id = c.company_id and (s.status = 'active' or s.retired_at > now() - interval '400 days')), '[]'::jsonb));
  elsif p_command = 'confirm' then
    perform private.ap_keys(p_payload, array['doc_key', 'prefix_template', 'pad_width']);
    return private.ap_series_activate(c.company_id, c.actor_id, c.role, p_payload ->> 'doc_key', p_payload, null);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_series(text, jsonb) from public, anon;
grant execute on function public.ap_series(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-059: month close, approved reopen windows and back-dating flags (extends EXOS-AUD-023's books lock)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.period_policies (
  company_id uuid primary key references public.companies(id) on delete cascade,
  backdate_flag_days integer not null default 3 check (backdate_flag_days between 1 and 60),
  close_proposal_day integer not null default 5 check (close_proposal_day between 1 and 28),
  reopen_window_hours integer not null default 24 check (reopen_window_hours between 1 and 168),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.period_reopen_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_month date not null check (extract(day from period_month) = 1),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'closed', 'withdrawn')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  window_ends_at timestamptz,
  closed_at timestamptz,
  check ((status = 'approved') <= (window_ends_at is not null)),
  check (decided_by is null or decided_by <> requested_by)
);
create unique index if not exists period_reopen_one_pending on public.period_reopen_requests(company_id, period_month) where status in ('requested', 'approved');
create index if not exists period_reopen_company_idx on public.period_reopen_requests(company_id, requested_at desc);
create table if not exists public.period_exception_postings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reopen_id uuid not null references public.period_reopen_requests(id) on delete cascade,
  table_name text not null,
  record_id uuid,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  entry_date date not null,
  actor_id uuid references auth.users(id),
  recorded_at timestamptz not null default now()
);
create index if not exists period_exception_postings_reopen_idx on public.period_exception_postings(reopen_id);
create index if not exists period_exception_postings_company_idx on public.period_exception_postings(company_id, recorded_at desc);
create table if not exists public.backdated_entry_flags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  entry_date date not null,
  recorded_on date not null,
  days_back integer not null check (days_back > 0),
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  unique (table_name, record_id)
);
create index if not exists backdated_entry_flags_open_idx on public.backdated_entry_flags(company_id, created_at desc) where reviewed_at is null;
alter table public.period_policies enable row level security;
alter table public.period_reopen_requests enable row level security;
alter table public.period_exception_postings enable row level security;
alter table public.backdated_entry_flags enable row level security;
drop policy if exists "period policies read" on public.period_policies;
create policy "period policies read" on public.period_policies for select to authenticated using (company_id = (select public.get_current_user_company_id()));
drop policy if exists "period reopen read" on public.period_reopen_requests;
create policy "period reopen read" on public.period_reopen_requests for select to authenticated using (company_id = (select public.get_current_user_company_id()));
drop policy if exists "period exceptions finance read" on public.period_exception_postings;
create policy "period exceptions finance read" on public.period_exception_postings for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) in ('owner', 'admin', 'accounts'));
drop policy if exists "backdated flags finance read" on public.backdated_entry_flags;
create policy "backdated flags finance read" on public.backdated_entry_flags for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) in ('owner', 'admin', 'accounts'));
revoke all on public.period_policies, public.period_reopen_requests, public.period_exception_postings, public.backdated_entry_flags from public, anon, authenticated;
grant select on public.period_policies, public.period_reopen_requests, public.period_exception_postings, public.backdated_entry_flags to authenticated;

create or replace function private.ap_open_reopen(p_company uuid, p_day date)
returns uuid language sql stable security definer set search_path = public, private as $$
  select r.id from public.period_reopen_requests r
  where r.company_id = p_company and r.status = 'approved' and r.period_month = date_trunc('month', p_day)::date and r.window_ends_at > now()
  order by r.decided_at desc limit 1
$$;
revoke all on function private.ap_open_reopen(uuid, date) from public, anon, authenticated;

-- Replaces the EXOS-AUD-023 trigger body. Behaviour is unchanged except that a posting dated in a closed month is
-- allowed while an approved reopen window for that month is open, and every such posting is recorded.
create or replace function private.enforce_accounting_period_lock()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_company uuid := (v_row ->> 'company_id')::uuid;
  v_lock date := private.books_locked_through(v_company);
  v_new date; v_old date; v_reopen uuid; v_hit date;
  v_label text := case tg_table_name when 'invoices' then 'invoice' when 'payments' then 'payment receipt' when 'credit_notes' then 'credit note'
    when 'expense_ledger' then 'expense' when 'expense_payments' then 'expense payment' when 'expense_supplier_credits' then 'supplier credit'
    when 'supplier_purchase_bills' then 'supplier bill' when 'purchase_receipts' then 'purchase receipt' else replace(tg_table_name, '_', ' ') end;
begin
  if v_lock is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op <> 'DELETE' then
    v_new := coalesce(nullif(to_jsonb(new) ->> tg_argv[0], '')::date,
      case when tg_nargs > 1 then nullif(to_jsonb(new) ->> tg_argv[1], '')::timestamptz::date end, current_date);
  end if;
  if tg_op <> 'INSERT' then
    v_old := coalesce(nullif(to_jsonb(old) ->> tg_argv[0], '')::date,
      case when tg_nargs > 1 then nullif(to_jsonb(old) ->> tg_argv[1], '')::timestamptz::date end, current_date);
  end if;
  -- The closed date this operation touches, if any.
  v_hit := case
    when tg_op = 'INSERT' and v_new <= v_lock then v_new
    when tg_op = 'DELETE' and v_old <= v_lock then v_old
    when tg_op = 'UPDATE' and v_new is distinct from v_old and v_new <= v_lock then v_new
    when tg_op = 'UPDATE' and v_new is distinct from v_old and v_old <= v_lock then v_old
    when tg_op = 'UPDATE' and v_old <= v_lock and (to_jsonb(new) ? 'deleted_at') and (to_jsonb(old) ->> 'deleted_at') is null and (to_jsonb(new) ->> 'deleted_at') is not null then v_old
  end;
  if v_hit is null then return case when tg_op = 'DELETE' then old else new end; end if;
  -- A re-dating across two closed months needs both months reopened.
  v_reopen := private.ap_open_reopen(v_company, v_hit);
  if v_reopen is not null and tg_op = 'UPDATE' and v_new is distinct from v_old and v_new <= v_lock and v_old <= v_lock
    and private.ap_open_reopen(v_company, case when v_hit = v_new then v_old else v_new end) is null then
    v_reopen := null;
  end if;
  if v_reopen is not null then
    insert into public.period_exception_postings(company_id, reopen_id, table_name, record_id, operation, entry_date, actor_id)
      values (v_company, v_reopen, tg_table_name, nullif(v_row ->> 'id', '')::uuid, tg_op, v_hit, auth.uid());
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Books are closed through %; % dated % cannot be recorded without an approved reopen', v_lock, v_label, v_new using errcode = '23514';
  elsif tg_op = 'DELETE' or v_new is not distinct from v_old then
    raise exception 'Books are closed through %; % dated % cannot be deleted without an approved reopen', v_lock, v_label, v_old using errcode = '23514';
  end if;
  raise exception 'Books are closed through %; % cannot be re-dated from % to % without an approved reopen', v_lock, v_label, v_old, v_new using errcode = '23514';
end;
$$;
revoke all on function private.enforce_accounting_period_lock() from public, anon, authenticated;
drop trigger if exists a_enforce_period_lock on public.supplier_purchase_bills;
create trigger a_enforce_period_lock before insert or update or delete on public.supplier_purchase_bills
  for each row execute function private.enforce_accounting_period_lock('invoice_date', 'created_at');
drop trigger if exists a_enforce_period_lock on public.purchase_receipts;
create trigger a_enforce_period_lock before insert or update or delete on public.purchase_receipts
  for each row execute function private.enforce_accounting_period_lock('receipt_date', 'created_at');

create or replace function private.ap_flag_backdated()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  v_date date := nullif(to_jsonb(new) ->> tg_argv[0], '')::date;
  v_today date := private.ist_today();
  v_days integer;
begin
  if v_date is null or nullif(to_jsonb(new) ->> 'opening_cutover_id', '') is not null then return null; end if;
  select coalesce((select p.backdate_flag_days from public.period_policies p where p.company_id = new.company_id), 3) into v_days;
  if v_date < v_today - v_days then
    insert into public.backdated_entry_flags(company_id, table_name, record_id, entry_date, recorded_on, days_back, actor_id)
      values (new.company_id, tg_table_name, new.id, v_date, v_today, v_today - v_date, auth.uid())
      on conflict (table_name, record_id) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.ap_flag_backdated() from public, anon, authenticated;
do $$
declare r record;
begin
  for r in select * from (values ('invoices', 'invoice_date'), ('payments', 'payment_date'), ('credit_notes', 'credit_date'), ('expense_ledger', 'invoice_date'),
    ('expense_payments', 'payment_date'), ('expense_supplier_credits', 'credit_date'), ('supplier_purchase_bills', 'invoice_date'), ('purchase_receipts', 'receipt_date')) t(tab, col) loop
    execute format('drop trigger if exists zz_ap_flag_backdated on public.%I', r.tab);
    execute format('create trigger zz_ap_flag_backdated after insert on public.%I for each row execute function private.ap_flag_backdated(%L)', r.tab, r.col);
  end loop;
end $$;

-- Closing a month moves the existing books lock forward (one row of history per close).
create or replace function private.ap_close_month(p_company uuid, p_actor uuid, p_role text, p_month date, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_lock date; v_id uuid; v_reason text;
begin
  if p_role not in ('owner', 'admin', 'accounts') then raise exception 'Not permitted' using errcode = '42501'; end if;
  v_reason := private.ap_text(p_reason, 'Reason', 10, 300);
  if v_end >= private.ist_today() then raise exception 'AP: A month can be closed only after it ends.'; end if;
  perform 1 from public.companies where id = p_company for update;
  v_lock := private.books_locked_through(p_company);
  if v_lock is not null and v_end <= v_lock then raise exception 'AP: % is already closed.', to_char(v_month, 'Mon YYYY'); end if;
  if v_lock is not null and v_month > (v_lock + 1) then
    raise exception 'AP: Close % first; months are closed in order.', to_char(date_trunc('month', v_lock + 1), 'Mon YYYY');
  end if;
  insert into public.accounting_period_locks(company_id, locked_through, previous_locked_through, reason, set_by, set_by_role)
    values (p_company, v_end, v_lock, v_reason, p_actor, p_role) returning id into v_id;
  update public.period_reopen_requests set status = 'closed', closed_at = now()
    where company_id = p_company and status = 'approved' and period_month <= v_month;
  return jsonb_build_object('lock_id', v_id, 'locked_through', v_end);
end;
$$;
revoke all on function private.ap_close_month(uuid, uuid, text, date, text) from public, anon, authenticated;

create or replace function public.ap_period(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  c record; v_lock date; v_month date; v_id uuid; r public.period_reopen_requests%rowtype; v_hours integer; v_page integer; v_total bigint;
  v_finance constant text[] := array['owner', 'admin', 'accounts'];
begin
  select * into c from private.ap_ctx(null);
  v_lock := private.books_locked_through(c.company_id);
  if p_command = 'overview' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('locked_through', v_lock, 'today', private.ist_today(), 'can_close', c.role = any(v_finance),
      'policy', coalesce((select jsonb_build_object('backdate_flag_days', p.backdate_flag_days, 'close_proposal_day', p.close_proposal_day, 'reopen_window_hours', p.reopen_window_hours)
        from public.period_policies p where p.company_id = c.company_id), '{"backdate_flag_days":3,"close_proposal_day":5,"reopen_window_hours":24}'::jsonb),
      'months', (select jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'label', to_char(m, 'Mon YYYY'),
          'state', case when v_lock is not null and (m + interval '1 month - 1 day')::date <= v_lock then
              case when private.ap_open_reopen(c.company_id, m::date) is not null then 'reopened' else 'closed' end
            when (m + interval '1 month - 1 day')::date < private.ist_today() then 'open_ended' else 'current' end,
          'reopen', (select jsonb_build_object('id', q.id, 'status', q.status, 'reason', q.reason, 'requested_by', ru.full_name, 'requested_by_id', q.requested_by,
              'requested_at', q.requested_at, 'decided_by', du.full_name, 'window_ends_at', q.window_ends_at,
              'postings', (select count(*) from public.period_exception_postings x where x.reopen_id = q.id))
            from public.period_reopen_requests q left join public.app_users ru on ru.id = q.requested_by left join public.app_users du on du.id = q.decided_by
            where q.company_id = c.company_id and q.period_month = m::date order by q.requested_at desc limit 1)) order by m desc)
        from generate_series(date_trunc('month', private.ist_today()) - interval '11 months', date_trunc('month', private.ist_today()), interval '1 month') g(m)),
      'open_flags', case when c.role = any(v_finance) then (select count(*) from public.backdated_entry_flags f where f.company_id = c.company_id and f.reviewed_at is null) end);
  elsif p_command = 'flags' then
    perform private.ap_keys(p_payload, array['page', 'state']);
    if not (c.role = any(v_finance)) then raise exception 'Not permitted' using errcode = '42501'; end if;
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    select count(*) into v_total from public.backdated_entry_flags f where f.company_id = c.company_id and (coalesce(p_payload ->> 'state', 'open') = 'all' or f.reviewed_at is null);
    return jsonb_build_object('total_count', v_total, 'rows', coalesce((select jsonb_agg(x order by x.created_at desc, x.id) from (
      select f.id, f.table_name, f.record_id, f.entry_date, f.recorded_on, f.days_back, u.full_name actor, f.created_at, f.reviewed_at, ru.full_name reviewed_by, f.review_note
      from public.backdated_entry_flags f left join public.app_users u on u.id = f.actor_id left join public.app_users ru on ru.id = f.reviewed_by
      where f.company_id = c.company_id and (coalesce(p_payload ->> 'state', 'open') = 'all' or f.reviewed_at is null)
      order by f.created_at desc, f.id limit 10 offset (v_page - 1) * 10) x), '[]'::jsonb));
  elsif p_command = 'close_month' then
    perform private.ap_keys(p_payload, array['month', 'reason']);
    if coalesce(p_payload ->> 'month', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'AP: Choose a month.'; end if;
    return private.ap_close_month(c.company_id, c.actor_id, c.role, ((p_payload ->> 'month') || '-01')::date, p_payload ->> 'reason');
  elsif p_command = 'request_reopen' then
    perform private.ap_keys(p_payload, array['month', 'reason']);
    if coalesce(p_payload ->> 'month', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'AP: Choose a month.'; end if;
    v_month := ((p_payload ->> 'month') || '-01')::date;
    if v_lock is null or v_month > v_lock then raise exception 'AP: % is not closed, so no reopen is needed.', to_char(v_month, 'Mon YYYY'); end if;
    if exists (select 1 from public.period_reopen_requests q where q.company_id = c.company_id and q.period_month = v_month and q.status in ('requested', 'approved')) then
      raise exception 'AP: A reopen for % is already requested or open.', to_char(v_month, 'Mon YYYY');
    end if;
    insert into public.period_reopen_requests(company_id, period_month, reason, requested_by)
      values (c.company_id, v_month, private.ap_text(p_payload ->> 'reason', 'Reason', 10, 500), c.actor_id) returning id into v_id;
    return jsonb_build_object('id', v_id);
  elsif p_command in ('approve_reopen', 'reject_reopen') then
    perform private.ap_keys(p_payload, array['id', 'note']);
    if not (c.role = any(v_finance)) then raise exception 'Not permitted' using errcode = '42501'; end if;
    select * into r from public.period_reopen_requests where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if r.id is null or r.status <> 'requested' then raise exception 'AP: This reopen request is no longer waiting for a decision.'; end if;
    if r.requested_by = c.actor_id then raise exception 'AP: Another person must decide your own reopen request.'; end if;
    select coalesce((select p.reopen_window_hours from public.period_policies p where p.company_id = c.company_id), 24) into v_hours;
    update public.period_reopen_requests set status = case when p_command = 'approve_reopen' then 'approved' else 'rejected' end,
      decided_by = c.actor_id, decided_at = now(), decision_note = private.ap_text(p_payload ->> 'note', 'Decision note', 5, 300),
      window_ends_at = case when p_command = 'approve_reopen' then now() + make_interval(hours => v_hours) end
      where id = r.id;
    return jsonb_build_object('id', r.id, 'status', case when p_command = 'approve_reopen' then 'approved' else 'rejected' end);
  elsif p_command = 'reclose' then
    perform private.ap_keys(p_payload, array['id']);
    if not (c.role = any(v_finance)) then raise exception 'Not permitted' using errcode = '42501'; end if;
    update public.period_reopen_requests set status = 'closed', closed_at = now()
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'approved' returning id into v_id;
    if v_id is null then raise exception 'AP: This month is not open for exceptions.'; end if;
    return jsonb_build_object('id', v_id);
  elsif p_command = 'withdraw_reopen' then
    perform private.ap_keys(p_payload, array['id']);
    update public.period_reopen_requests set status = 'withdrawn'
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'requested' and requested_by = c.actor_id returning id into v_id;
    if v_id is null then raise exception 'AP: Only your own pending request can be withdrawn.'; end if;
    return jsonb_build_object('id', v_id);
  elsif p_command = 'review_flag' then
    perform private.ap_keys(p_payload, array['id', 'note']);
    if not (c.role = any(v_finance)) then raise exception 'Not permitted' using errcode = '42501'; end if;
    update public.backdated_entry_flags set reviewed_by = c.actor_id, reviewed_at = now(), review_note = private.ap_text(p_payload ->> 'note', 'Review note', 5, 300)
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and reviewed_at is null and actor_id is distinct from c.actor_id returning id into v_id;
    if v_id is null then raise exception 'AP: This flag is already reviewed, or it is your own entry (another person reviews it).'; end if;
    return jsonb_build_object('id', v_id);
  elsif p_command = 'save_policy' then
    perform private.ap_keys(p_payload, array['backdate_flag_days', 'close_proposal_day', 'reopen_window_hours']);
    if c.role not in ('owner', 'admin') then raise exception 'Not permitted' using errcode = '42501'; end if;
    insert into public.period_policies(company_id, backdate_flag_days, close_proposal_day, reopen_window_hours, updated_by)
      values (c.company_id, (p_payload ->> 'backdate_flag_days')::integer, (p_payload ->> 'close_proposal_day')::integer, (p_payload ->> 'reopen_window_hours')::integer, c.actor_id)
      on conflict (company_id) do update set backdate_flag_days = excluded.backdate_flag_days, close_proposal_day = excluded.close_proposal_day,
        reopen_window_hours = excluded.reopen_window_hours, updated_by = excluded.updated_by, updated_at = now();
    return jsonb_build_object('saved', true);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_period(text, jsonb) from public, anon;
grant execute on function public.ap_period(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-042: route visit counts per role and approved role navigation
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.navigation_visit_counts (
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null check (role ~ '^[a-z_]{3,30}$'),
  route text not null check (route ~ '^/[a-z0-9-]+(/[a-z0-9-]+){0,2}$' and length(route) <= 80),
  visit_date date not null,
  visits integer not null default 0 check (visits between 0 and 100000),
  primary key (company_id, role, route, visit_date)
);
create index if not exists navigation_visit_counts_recent_idx on public.navigation_visit_counts(company_id, role, visit_date desc);
create table if not exists public.role_navigation (
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null check (role ~ '^[a-z_]{3,30}$'),
  items text[] not null check (cardinality(items) between 1 and 9),
  version integer not null default 1,
  source text not null check (source in ('proposal', 'manual')),
  proposal_id uuid references public.proposals(id) on delete set null,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  primary key (company_id, role)
);
alter table public.navigation_visit_counts enable row level security;
alter table public.role_navigation enable row level security;
drop policy if exists "navigation visits admin read" on public.navigation_visit_counts;
create policy "navigation visits admin read" on public.navigation_visit_counts for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) in ('owner', 'admin'));
drop policy if exists "role navigation read" on public.role_navigation;
create policy "role navigation read" on public.role_navigation for select to authenticated using (company_id = (select public.get_current_user_company_id()));
revoke all on public.navigation_visit_counts, public.role_navigation from public, anon, authenticated;
grant select on public.navigation_visit_counts, public.role_navigation to authenticated;

create or replace function private.ap_nav_roles()
returns text[] language sql immutable set search_path = public, private as $$
  select array['owner', 'admin', 'sales_manager', 'sales', 'production_manager', 'production', 'factory_manager', 'dispatch_manager', 'dispatch',
    'inventory_manager', 'accounts', 'quality', 'viewer']
$$;
revoke all on function private.ap_nav_roles() from public, anon, authenticated;

create or replace function private.ap_nav_items(p_items jsonb)
returns text[] language plpgsql immutable set search_path = public, private as $$
declare v text[];
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 9 then raise exception 'AP: Choose one to nine destinations.'; end if;
  select array_agg(x order by o) into v from jsonb_array_elements_text(p_items) with ordinality t(x, o);
  if exists (select 1 from unnest(v) x where x !~ '^/[a-z0-9-]+(/[a-z0-9-]+){0,2}$' or length(x) > 80) then raise exception 'AP: Unknown destination.'; end if;
  if (select count(distinct x) from unnest(v) x) <> cardinality(v) then raise exception 'AP: Each destination may appear once.'; end if;
  return v;
end;
$$;
revoke all on function private.ap_nav_items(jsonb) from public, anon, authenticated;

create or replace function private.ap_nav_apply(p_company uuid, p_actor uuid, p_role_target text, p_items text[], p_source text, p_proposal uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_version integer;
begin
  if not (p_role_target = any(private.ap_nav_roles())) then raise exception 'AP: Unknown role.'; end if;
  insert into public.role_navigation(company_id, role, items, version, source, proposal_id, approved_by)
    values (p_company, p_role_target, p_items, 1, p_source, p_proposal, p_actor)
    on conflict (company_id, role) do update set items = excluded.items, version = public.role_navigation.version + 1, source = excluded.source,
      proposal_id = excluded.proposal_id, approved_by = excluded.approved_by, approved_at = now()
    returning version into v_version;
  return jsonb_build_object('role', p_role_target, 'items', to_jsonb(p_items), 'version', v_version);
end;
$$;
revoke all on function private.ap_nav_apply(uuid, uuid, text, text[], text, uuid) from public, anon, authenticated;

create or replace function public.ap_navigation(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_route text; v_role text;
begin
  select * into c from private.ap_ctx(null);
  if p_command = 'visit' then
    -- Counts only: no user, no record identity, no query string.
    perform private.ap_keys(p_payload, array['route']);
    v_route := lower(coalesce(p_payload ->> 'route', ''));
    if v_route !~ '^/[a-z0-9-]+(/[a-z0-9-]+){0,2}$' or length(v_route) > 80 then return jsonb_build_object('counted', false); end if;
    insert into public.navigation_visit_counts(company_id, role, route, visit_date, visits) values (c.company_id, c.role, v_route, private.ist_today(), 1)
      on conflict (company_id, role, route, visit_date) do update set visits = least(100000, public.navigation_visit_counts.visits + 1);
    return jsonb_build_object('counted', true);
  elsif p_command = 'layout' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return coalesce((select jsonb_build_object('items', to_jsonb(n.items), 'version', n.version, 'approved_at', n.approved_at)
      from public.role_navigation n where n.company_id = c.company_id and n.role = c.role), jsonb_build_object('items', null));
  end if;
  if c.role not in ('owner', 'admin') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if p_command = 'usage' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('roles', (select jsonb_agg(jsonb_build_object('role', rr.r,
        'days_observed', (select count(distinct v.visit_date) from public.navigation_visit_counts v where v.company_id = c.company_id and v.role = rr.r and v.visit_date > private.ist_today() - 28),
        'top', coalesce((select jsonb_agg(jsonb_build_object('route', t.route, 'visits', t.visits) order by t.visits desc, t.route) from (
            select v.route, sum(v.visits)::integer visits from public.navigation_visit_counts v where v.company_id = c.company_id and v.role = rr.r and v.visit_date > private.ist_today() - 28
            group by v.route order by sum(v.visits) desc, v.route limit 15) t), '[]'::jsonb),
        'layout', (select jsonb_build_object('items', to_jsonb(n.items), 'version', n.version, 'source', n.source, 'approved_at', n.approved_at) from public.role_navigation n where n.company_id = c.company_id and n.role = rr.r))
      order by rr.o) from unnest(private.ap_nav_roles()) with ordinality rr(r, o)));
  elsif p_command = 'save' then
    perform private.ap_keys(p_payload, array['role', 'items']);
    return private.ap_nav_apply(c.company_id, c.actor_id, p_payload ->> 'role', private.ap_nav_items(p_payload -> 'items'), 'manual', null);
  elsif p_command = 'reset' then
    perform private.ap_keys(p_payload, array['role']);
    v_role := p_payload ->> 'role';
    delete from public.role_navigation where company_id = c.company_id and role = v_role;
    return jsonb_build_object('role', v_role, 'items', null);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_navigation(text, jsonb) from public, anon;
grant execute on function public.ap_navigation(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-002: proposal lifecycle shared by every proposal type
-- ---------------------------------------------------------------------------------------------------------------
-- The versions of the facts a proposal depends on. If they differ at decision time the proposal is stale.
create or replace function private.ap_proposal_versions(p_company uuid, p_type text, p_target text)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select case p_type
    when 'navigation.role_layout' then jsonb_build_object('layout_version',
      (select n.version from public.role_navigation n where n.company_id = p_company and n.role = p_target))
    when 'period.close_month' then jsonb_build_object('locked_through', private.books_locked_through(p_company))
    when 'series.adopt' then jsonb_build_object('active_series',
      (select s.id from public.document_series s where s.company_id = p_company and s.doc_key = p_target and s.status = 'active'))
  end
$$;
revoke all on function private.ap_proposal_versions(uuid, text, text) from public, anon, authenticated;

create or replace function private.ap_proposal_editable(p_type text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_type when 'navigation.role_layout' then array['items'] when 'series.adopt' then array['prefix_template', 'pad_width'] else array[]::text[] end
$$;
revoke all on function private.ap_proposal_editable(text) from public, anon, authenticated;

-- Creates an open proposal unless the same one is already open or the same advice was rejected in the last 30 days.
create or replace function private.ap_proposal_create(p_company uuid, p_type text, p_target text, p_title text, p_payload jsonb, p_evidence jsonb,
  p_rule text, p_reason text, p_confidence numeric, p_roles text[], p_hours integer, p_run uuid)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare
  v_versions jsonb := private.ap_proposal_versions(p_company, p_type, p_target);
  v_fp text := md5(coalesce(v_versions, 'null'::jsonb)::text);
  v_open public.proposals%rowtype; v_id uuid;
begin
  select * into v_open from public.proposals where company_id = p_company and proposal_type = p_type and target_key = p_target and status = 'open' for update;
  if v_open.id is not null then
    if v_open.inputs_fingerprint = v_fp and v_open.payload = p_payload and v_open.expires_at > now() then return null; end if;
    update public.proposals set status = case when v_open.expires_at <= now() then 'expired' else 'stale' end where id = v_open.id;
  end if;
  if exists (select 1 from public.proposals where company_id = p_company and proposal_type = p_type and target_key = p_target and status = 'rejected'
    and payload = p_payload and inputs_fingerprint = v_fp and decided_at > now() - interval '30 days') then
    return null;
  end if;
  insert into public.proposals(company_id, proposal_type, target_key, title, payload, inputs, inputs_fingerprint, rule_key, reason, confidence, decide_roles, expires_at, job_run_id)
    values (p_company, p_type, p_target, p_title, p_payload, jsonb_build_object('versions', v_versions, 'evidence', coalesce(p_evidence, '{}'::jsonb)), v_fp,
      p_rule, p_reason, p_confidence, p_roles, now() + make_interval(hours => p_hours), p_run)
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.ap_proposal_create(uuid, text, text, text, jsonb, jsonb, text, text, numeric, text[], integer, uuid) from public, anon, authenticated;

-- Re-runs the domain action with its own server checks. Raises if the action is refused; nothing is then recorded.
create or replace function private.ap_proposal_apply(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  if p_proposal.proposal_type = 'navigation.role_layout' then
    if p_role not in ('owner', 'admin') then raise exception 'Not permitted' using errcode = '42501'; end if;
    return private.ap_nav_apply(p_company, p_actor, p_proposal.target_key, private.ap_nav_items(p_payload -> 'items'), 'proposal', p_proposal.id);
  elsif p_proposal.proposal_type = 'period.close_month' then
    if (p_payload ->> 'month') is distinct from p_proposal.target_key then raise exception 'AP: The month of a close proposal cannot be changed.'; end if;
    return private.ap_close_month(p_company, p_actor, p_role, (p_proposal.target_key || '-01')::date, 'Month close accepted from the system proposal ' || p_proposal.id::text);
  elsif p_proposal.proposal_type = 'series.adopt' then
    return private.ap_series_activate(p_company, p_actor, p_role, p_proposal.target_key, p_payload, p_proposal.id);
  end if;
  raise exception 'AP: Unknown proposal type.';
end;
$$;
revoke all on function private.ap_proposal_apply(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

create or replace function private.ap_proposal_decide(p_company uuid, p_actor uuid, p_role text, p_id uuid, p_decision text, p_payload jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  p public.proposals%rowtype; v_final jsonb; v_edited text[] := '{}'; v_key text; v_outcome jsonb; v_state text; v_note text;
begin
  if p_decision not in ('accept', 'edit', 'reject') then raise exception 'AP: Choose accept, edit or reject.'; end if;
  v_note := private.ap_text(p_note, 'Note', 3, 300, p_decision = 'reject');
  select * into p from public.proposals where id = p_id and company_id = p_company for update;
  if p.id is null or not (p_role = any(p.decide_roles)) then raise exception 'AP: This proposal is not available to you.'; end if;
  if p.status <> 'open' then
    if p.decided_by = p_actor and ((p_decision = 'reject') = (p.status = 'rejected')) then
      return jsonb_build_object('id', p.id, 'state', p.status, 'outcome', p.outcome, 'repeated', true);
    end if;
    raise exception 'AP: This proposal is already %.', p.status;
  end if;
  if p.expires_at <= now() then
    update public.proposals set status = 'expired' where id = p.id;
    return jsonb_build_object('id', p.id, 'state', 'expired', 'message', 'This proposal expired. The next scheduled run prepares a current one.');
  end if;
  if md5(coalesce(private.ap_proposal_versions(p_company, p.proposal_type, p.target_key), 'null'::jsonb)::text) <> p.inputs_fingerprint then
    update public.proposals set status = 'stale' where id = p.id;
    return jsonb_build_object('id', p.id, 'state', 'stale', 'message', 'The facts behind this proposal changed after it was prepared. It cannot be accepted; the next run prepares a current one.');
  end if;
  if p_decision = 'reject' then
    update public.proposals set status = 'rejected', decided_by = p_actor, decided_at = now(), decision_note = v_note where id = p.id;
    return jsonb_build_object('id', p.id, 'state', 'rejected');
  end if;
  v_final := p.payload;
  if p_decision = 'edit' then
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' or exists (select 1 from jsonb_object_keys(p_payload) k where not (k = any(private.ap_proposal_editable(p.proposal_type)))) then
      raise exception 'AP: Only % can be changed on this proposal.', coalesce(nullif(array_to_string(private.ap_proposal_editable(p.proposal_type), ', '), ''), 'nothing');
    end if;
    for v_key in select jsonb_object_keys(p_payload) loop
      if (p_payload -> v_key) is distinct from (p.payload -> v_key) then v_edited := v_edited || v_key; v_final := v_final || jsonb_build_object(v_key, p_payload -> v_key); end if;
    end loop;
  end if;
  v_outcome := private.ap_proposal_apply(p_company, p_actor, p_role, p, v_final);
  v_state := case when cardinality(v_edited) > 0 then 'edited' else 'accepted' end;
  update public.proposals set status = v_state, decided_by = p_actor, decided_at = now(), decision_payload = v_final, edited_fields = v_edited,
    decision_note = v_note, outcome = v_outcome where id = p.id;
  return jsonb_build_object('id', p.id, 'state', v_state, 'edited_fields', to_jsonb(v_edited), 'outcome', v_outcome);
end;
$$;
revoke all on function private.ap_proposal_decide(uuid, uuid, text, uuid, text, jsonb, text) from public, anon, authenticated;

create or replace function private.ap_proposal_row(p public.proposals, p_role text)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', p.id, 'proposal_type', p.proposal_type, 'target_key', p.target_key, 'title', p.title, 'payload', p.payload,
    'evidence', p.inputs -> 'evidence', 'versions', p.inputs -> 'versions', 'rule_key', p.rule_key, 'reason', p.reason, 'confidence', p.confidence,
    'status', p.status, 'created_at', p.created_at, 'expires_at', p.expires_at, 'decided_at', p.decided_at,
    'decided_by', (select u.full_name from public.app_users u where u.id = p.decided_by), 'edited_fields', to_jsonb(p.edited_fields),
    'decision_note', p.decision_note, 'outcome', p.outcome, 'editable', to_jsonb(private.ap_proposal_editable(p.proposal_type)),
    'can_decide', p.status = 'open' and p_role = any(p.decide_roles),
    'stale_now', p.status = 'open' and md5(coalesce(private.ap_proposal_versions(p.company_id, p.proposal_type, p.target_key), 'null'::jsonb)::text) <> p.inputs_fingerprint,
    'job_run_id', p.job_run_id)
$$;
revoke all on function private.ap_proposal_row(public.proposals, text) from public, anon, authenticated;

create or replace function public.ap_proposals(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer; v_status text; v_type text; v_total bigint; v_results jsonb := '[]'::jsonb; v_id uuid; v_result jsonb; v_message text;
begin
  select * into c from private.ap_ctx(null);
  if p_command = 'list' then
    perform private.ap_keys(p_payload, array['status', 'type', 'page']);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    v_status := coalesce(p_payload ->> 'status', 'open'); v_type := nullif(p_payload ->> 'type', '');
    if v_status not in ('open', 'decided', 'all') then raise exception 'AP: Invalid filter.'; end if;
    select count(*) into v_total from public.proposals p where p.company_id = c.company_id and (c.role = any(p.decide_roles) or c.role in ('owner', 'admin'))
      and (v_type is null or p.proposal_type = v_type) and (v_status = 'all' or (v_status = 'open') = (p.status = 'open'));
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', coalesce((select jsonb_agg(private.ap_proposal_row(x, c.role) order by x.created_at desc, x.id) from (
      select * from public.proposals p where p.company_id = c.company_id and (c.role = any(p.decide_roles) or c.role in ('owner', 'admin'))
        and (v_type is null or p.proposal_type = v_type) and (v_status = 'all' or (v_status = 'open') = (p.status = 'open'))
      order by p.created_at desc, p.id limit 10 offset (v_page - 1) * 10) x), '[]'::jsonb));
  elsif p_command = 'decide' then
    perform private.ap_keys(p_payload, array['id', 'decision', 'payload', 'note']);
    return private.ap_proposal_decide(c.company_id, c.actor_id, c.role, private.ap_uuid(p_payload, 'id'), p_payload ->> 'decision', p_payload -> 'payload', p_payload ->> 'note');
  elsif p_command = 'decide_batch' then
    perform private.ap_keys(p_payload, array['ids', 'decision', 'note']);
    if jsonb_typeof(p_payload -> 'ids') <> 'array' or jsonb_array_length(p_payload -> 'ids') not between 1 and 50 then raise exception 'AP: Choose 1 to 50 proposals.'; end if;
    if (p_payload ->> 'decision') not in ('accept', 'reject') then raise exception 'AP: A batch can only be accepted or rejected.'; end if;
    for v_id in select distinct (x)::uuid from jsonb_array_elements_text(p_payload -> 'ids') x loop
      begin
        v_result := private.ap_proposal_decide(c.company_id, c.actor_id, c.role, v_id, p_payload ->> 'decision', null, p_payload ->> 'note');
      exception when others then
        v_message := case when sqlerrm like 'AP: %' then substring(sqlerrm from 5) when sqlstate = '42501' then 'Not permitted.' else 'This proposal could not be applied; open it to review.' end;
        v_result := jsonb_build_object('id', v_id, 'state', 'failed', 'message', v_message);
      end;
      v_results := v_results || jsonb_build_array(v_result);
    end loop;
    return jsonb_build_object('results', v_results);
  elsif p_command = 'pending_count' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('count', (select count(*) from public.proposals p where p.company_id = c.company_id and p.status = 'open' and c.role = any(p.decide_roles) and p.expires_at > now()));
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_proposals(text, jsonb) from public, anon;
grant execute on function public.ap_proposals(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-001: job bodies, the idempotent runner, cron entry point and manual "Run now"
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap_job_execute(p_company uuid, p_job text, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_examined integer := 0; v_proposals integer := 0; v_alerts integer := 0; v_n integer; v_id uuid; r record;
  v_today date := private.ist_today(); v_lock date; v_month date; v_items jsonb; v_days integer; v_total bigint; v_covered bigint; v_close_day integer;
begin
  if p_job = 'proposals.refresh' then
    select count(*) into v_examined from public.proposals where company_id = p_company and status = 'open';
    update public.proposals set status = 'expired' where company_id = p_company and status = 'open' and expires_at <= now();
    get diagnostics v_n = row_count;
    update public.proposals p set status = 'stale' where p.company_id = p_company and p.status = 'open'
      and md5(coalesce(private.ap_proposal_versions(p.company_id, p.proposal_type, p.target_key), 'null'::jsonb)::text) <> p.inputs_fingerprint;
    get diagnostics v_alerts = row_count;
    return jsonb_build_object('examined', v_examined, 'proposals', 0, 'alerts', 0, 'details', jsonb_build_object('expired', v_n, 'stale', v_alerts));
  elsif p_job = 'navigation.propose' then
    for r in select x.role_name from unnest(private.ap_nav_roles()) x(role_name) loop
      v_examined := v_examined + 1;
      select count(distinct v.visit_date) into v_days from public.navigation_visit_counts v where v.company_id = p_company and v.role = r.role_name and v.visit_date > v_today - 28;
      continue when v_days < 14;
      select coalesce(sum(v.visits), 0) into v_total from public.navigation_visit_counts v where v.company_id = p_company and v.role = r.role_name and v.visit_date > v_today - 28;
      select jsonb_agg(t.route order by t.visits desc, t.route), sum(t.visits) into v_items, v_covered from (
        select v.route, sum(v.visits) visits from public.navigation_visit_counts v where v.company_id = p_company and v.role = r.role_name and v.visit_date > v_today - 28
        group by v.route order by sum(v.visits) desc, v.route limit 9) t;
      continue when v_items is null or jsonb_array_length(v_items) < 3;
      continue when exists (select 1 from public.role_navigation n where n.company_id = p_company and n.role = r.role_name and to_jsonb(n.items) = v_items);
      v_id := private.ap_proposal_create(p_company, 'navigation.role_layout', r.role_name, 'Main navigation for ' || replace(r.role_name, '_', ' '),
        jsonb_build_object('items', v_items),
        jsonb_build_object('window_days', 28, 'days_observed', v_days, 'total_visits', v_total,
          'visits', (select jsonb_agg(jsonb_build_object('route', t.route, 'visits', t.visits) order by t.visits desc, t.route) from (
            select v.route, sum(v.visits)::integer visits from public.navigation_visit_counts v where v.company_id = p_company and v.role = r.role_name and v.visit_date > v_today - 28
            group by v.route order by sum(v.visits) desc, v.route limit 15) t)),
        'navigation.top_visited_28d', 'These are the destinations people in this role opened most over the last 28 days (' || v_days || ' days with visits). Other pages stay under More and in search.',
        case when v_total > 0 then round(v_covered::numeric / v_total, 3) end, array['owner', 'admin'], 24 * 14, p_run);
      if v_id is not null then v_proposals := v_proposals + 1; end if;
    end loop;
  elsif p_job = 'series.propose' then
    for r in select * from (values
      ('invoices', 'OMX/{FY}/', 'Tax invoice numbers that restart on 1 April (for example OMX/26-27/0001)'),
      ('credit_notes', 'CN/{FY}/', 'Credit note numbers that restart on 1 April (for example CN/26-27/0001)'),
      ('quotes', 'Q/{FY}/', 'Quotation numbers by financial year (for example Q/26-27/0001)'),
      ('orders', 'SO/{FY}/', 'Sales order numbers by financial year (for example SO/26-27/0001)'),
      ('dispatches', 'DC/{FY}/', 'Delivery challan numbers by financial year (for example DC/26-27/0001)')) d(doc_key, template, title) loop
      v_examined := v_examined + 1;
      continue when exists (select 1 from public.document_series s where s.company_id = p_company and s.doc_key = r.doc_key and s.status = 'active');
      v_id := private.ap_proposal_create(p_company, 'series.adopt', r.doc_key, r.title, jsonb_build_object('prefix_template', r.template, 'pad_width', 4),
        jsonb_build_object('fy', private.ap_fy_label(v_today, true), 'example', private.ap_series_stem(r.template, v_today) || '0001',
          'gst_limit', case when r.doc_key in ('invoices', 'credit_notes') then 16 end),
        'series.fy_default', 'Accounts and GST returns expect numbering that restarts every financial year. Existing numbers stay as they are; new documents use this series once you confirm it.',
        null, array['owner', 'admin', 'accounts'], 24 * 30, p_run);
      if v_id is not null then v_proposals := v_proposals + 1; end if;
    end loop;
  elsif p_job = 'calendar.check' then
    v_examined := 1;
    if not exists (select 1 from public.factory_calendar_exceptions e where e.company_id = p_company and e.removed_at is null and e.kind in ('holiday', 'shutdown')
        and e.date_to >= v_today and e.date_from <= v_today + 120)
      and not exists (select 1 from public.notifications n where n.company_id = p_company and n.entity_reference = 'calendar-check:' || to_char(v_today, 'YYYY-MM')) then
      insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, entity_reference)
      select p_company, rl, 'calendar_check', 'warning', 'Enter the factory holidays',
        'No holiday or shutdown is entered for the next four months. Delivery promises and capacity count every non-weekly-off day as working until they are entered.',
        '/production/calendar', 'calendar-check:' || to_char(v_today, 'YYYY-MM')
      from unnest(array['owner', 'factory_manager', 'production_manager']) rl;
      get diagnostics v_alerts = row_count;
    end if;
  elsif p_job = 'periods.propose_close' then
    v_examined := 1;
    select coalesce((select p.close_proposal_day from public.period_policies p where p.company_id = p_company), 5) into v_close_day;
    v_lock := private.books_locked_through(p_company);
    v_month := case when v_lock is null then (date_trunc('month', v_today) - interval '1 month')::date else date_trunc('month', v_lock + 1)::date end;
    if (v_month + interval '1 month - 1 day')::date < v_today
      and (v_month < (date_trunc('month', v_today) - interval '1 month')::date or extract(day from v_today) >= v_close_day)
      and (v_lock is not null or exists (select 1 from public.invoices i where i.company_id = p_company and i.invoice_date between v_month and (v_month + interval '1 month - 1 day')::date)
        or exists (select 1 from public.payments i where i.company_id = p_company and i.payment_date between v_month and (v_month + interval '1 month - 1 day')::date)) then
      v_id := private.ap_proposal_create(p_company, 'period.close_month', to_char(v_month, 'YYYY-MM'), 'Close ' || to_char(v_month, 'FMMonth YYYY'),
        jsonb_build_object('month', to_char(v_month, 'YYYY-MM')),
        jsonb_build_object('locked_through', v_lock, 'month_end', (v_month + interval '1 month - 1 day')::date,
          'invoices', (select count(*) from public.invoices i where i.company_id = p_company and i.invoice_date between v_month and (v_month + interval '1 month - 1 day')::date),
          'payments', (select count(*) from public.payments i where i.company_id = p_company and i.payment_date between v_month and (v_month + interval '1 month - 1 day')::date),
          'open_backdate_flags', (select count(*) from public.backdated_entry_flags f where f.company_id = p_company and f.reviewed_at is null)),
        'periods.close_after_day', 'The month has ended and the close day (' || v_close_day || ') has passed. Closing stops new entries dated in it; corrections then need an approved reopen.',
        null, array['owner', 'admin', 'accounts'], 24 * 10, p_run);
      if v_id is not null then v_proposals := 1; end if;
    end if;
  else
    raise exception 'Unknown job %', p_job;
  end if;
  return jsonb_build_object('examined', v_examined, 'proposals', v_proposals, 'alerts', v_alerts, 'details', '{}'::jsonb);
end;
$$;
revoke all on function private.ap_job_execute(uuid, text, uuid) from public, anon, authenticated;

-- One run of one job for one company and window. A repeated or overlapping call for the same window finds the
-- existing ledger row and does nothing (the unique key makes the second insert wait for the first and then skip).
create or replace function private.ap_job_once(p_company uuid, p_job text, p_window text, p_source text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_run uuid; v_result jsonb; v_existing public.system_job_runs%rowtype; v_alerts integer := 0; v_label text;
begin
  if not exists (select 1 from private.ap_job_registry() j where j.job_key = p_job) then raise exception 'AP: Unknown job.'; end if;
  insert into public.system_job_runs(company_id, job_key, window_key, trigger_source, requested_by, started_at)
    values (p_company, p_job, p_window, p_source, p_actor, clock_timestamp())
    on conflict (company_id, job_key, window_key) do nothing returning id into v_run;
  if v_run is null then
    select * into v_existing from public.system_job_runs where company_id = p_company and job_key = p_job and window_key = p_window;
    return jsonb_build_object('job_key', p_job, 'window_key', p_window, 'state', 'already_ran', 'run_id', v_existing.id, 'status', v_existing.status);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ap-job:' || p_company::text || ':' || p_job, 0));
  begin
    v_result := private.ap_job_execute(p_company, p_job, v_run);
    update public.system_job_runs set status = 'succeeded', finished_at = clock_timestamp(), examined = (v_result ->> 'examined')::integer,
      proposals_created = (v_result ->> 'proposals')::integer, alerts_created = (v_result ->> 'alerts')::integer, details = coalesce(v_result -> 'details', '{}'::jsonb)
      where id = v_run;
    return jsonb_build_object('job_key', p_job, 'window_key', p_window, 'state', 'succeeded', 'run_id', v_run, 'result', v_result);
  exception when others then
    update public.system_job_runs set status = 'failed', finished_at = clock_timestamp(), error_message = left(sqlerrm, 500) where id = v_run;
    -- Three failed windows in a row raise one owner alert per streak.
    if (select count(*) = 3 and bool_and(x.status = 'failed') from (select s.status from public.system_job_runs s where s.company_id = p_company and s.job_key = p_job
        order by s.started_at desc, s.id desc limit 3) x)
      -- One alert per failing streak: none since the job last succeeded.
      and not exists (select 1 from public.notifications n where n.company_id = p_company and n.entity_reference = 'job-failing:' || p_job
        and n.created_at >= coalesce((select max(s.finished_at) from public.system_job_runs s where s.company_id = p_company and s.job_key = p_job and s.status = 'succeeded'), '-infinity'::timestamptz)) then
      select j.label into v_label from private.ap_job_registry() j where j.job_key = p_job;
      insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, entity_reference, created_at)
        values (p_company, 'owner', 'system_job_failing', 'critical', 'Scheduled job failing: ' || v_label,
          'The last three runs failed. Latest error: ' || left(sqlerrm, 300), '/automation', 'job-failing:' || p_job, clock_timestamp());
      v_alerts := 1;
      update public.system_job_runs set alerts_created = v_alerts where id = v_run;
    end if;
    return jsonb_build_object('job_key', p_job, 'window_key', p_window, 'state', 'failed', 'run_id', v_run, 'error', left(sqlerrm, 500));
  end;
end;
$$;
revoke all on function private.ap_job_once(uuid, text, text, text, uuid) from public, anon, authenticated;

create or replace function private.ap_job_window(p_schedule text, p_at timestamptz)
returns text language sql immutable set search_path = public, private as $$
  select case p_schedule when 'hourly' then 'hour:' || to_char(p_at at time zone 'Asia/Kolkata', 'YYYYMMDD"T"HH24')
    when 'manual' then 'manual:' || to_char(p_at at time zone 'Asia/Kolkata', 'YYYYMMDD"T"HH24MI')
    else 'day:' || to_char(p_at at time zone 'Asia/Kolkata', 'YYYYMMDD') end
$$;
revoke all on function private.ap_job_window(text, timestamptz) from public, anon, authenticated;

-- Cron entry point. Executable only by the server-side service role (the Vercel cron route); never by browsers.
create or replace function public.ap_jobs_cron(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_schedule text := p_payload ->> 'schedule'; v_results jsonb := '[]'::jsonb; v_company uuid; j record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not permitted' using errcode = '42501'; end if;
  perform private.ap_keys(p_payload, array['schedule']);
  if v_schedule not in ('hourly', 'nightly', 'morning') then raise exception 'AP: Unknown schedule.'; end if;
  for v_company in select id from public.companies order by created_at loop
    for j in select * from private.ap_job_registry() r where r.schedule = v_schedule order by r.job_key loop
      v_results := v_results || jsonb_build_array(private.ap_job_once(v_company, j.job_key, private.ap_job_window(v_schedule, now()), 'cron', null));
    end loop;
  end loop;
  return jsonb_build_object('schedule', v_schedule, 'runs', v_results);
end;
$$;
revoke all on function public.ap_jobs_cron(jsonb) from public, anon, authenticated;
grant execute on function public.ap_jobs_cron(jsonb) to service_role;

create or replace function public.ap_jobs(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer; v_total bigint; v_job text;
begin
  select * into c from private.ap_ctx(array['owner', 'admin']);
  if p_command = 'overview' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('jobs', (select jsonb_agg(jsonb_build_object('job_key', j.job_key, 'schedule', j.schedule, 'label', j.label, 'description', j.description,
        'last', (select jsonb_build_object('id', s.id, 'status', s.status, 'window_key', s.window_key, 'trigger_source', s.trigger_source, 'started_at', s.started_at,
            'finished_at', s.finished_at, 'examined', s.examined, 'proposals_created', s.proposals_created, 'alerts_created', s.alerts_created, 'error_message', s.error_message)
          from public.system_job_runs s where s.company_id = c.company_id and s.job_key = j.job_key order by s.started_at desc, s.id desc limit 1),
        'last_success_at', (select max(s.finished_at) from public.system_job_runs s where s.company_id = c.company_id and s.job_key = j.job_key and s.status = 'succeeded'),
        'failed_streak', (select count(*) from (select s.status, sum(case when s.status <> 'failed' then 1 else 0 end) over (order by s.started_at desc, s.id desc) ok
            from public.system_job_runs s where s.company_id = c.company_id and s.job_key = j.job_key) x where x.ok = 0 and x.status = 'failed'))
      order by j.schedule, j.job_key) from private.ap_job_registry() j));
  elsif p_command = 'runs' then
    perform private.ap_keys(p_payload, array['page', 'job_key', 'status']);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    v_job := nullif(p_payload ->> 'job_key', '');
    select count(*) into v_total from public.system_job_runs s where s.company_id = c.company_id and (v_job is null or s.job_key = v_job)
      and (coalesce(p_payload ->> 'status', '') = '' or s.status = p_payload ->> 'status');
    return jsonb_build_object('total_count', v_total, 'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc, x.id) from (
      select s.id, s.job_key, s.window_key, s.trigger_source, u.full_name requested_by, s.status, s.started_at, s.finished_at, s.examined, s.proposals_created, s.alerts_created, s.error_message
      from public.system_job_runs s left join public.app_users u on u.id = s.requested_by
      where s.company_id = c.company_id and (v_job is null or s.job_key = v_job) and (coalesce(p_payload ->> 'status', '') = '' or s.status = p_payload ->> 'status')
      order by s.started_at desc, s.id desc limit 10 offset (v_page - 1) * 10) x), '[]'::jsonb));
  elsif p_command = 'run_now' then
    perform private.ap_keys(p_payload, array['job_key']);
    return private.ap_job_once(c.company_id, p_payload ->> 'job_key', private.ap_job_window('manual', now()), 'manual', c.actor_id);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_jobs(text, jsonb) from public, anon;
grant execute on function public.ap_jobs(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-006: go-live import of masters from Excel
-- ---------------------------------------------------------------------------------------------------------------
-- The server action parses and validates the sheet (lib/master-data/import); the database re-checks duplicates
-- against existing records, stores the reviewed batch, and imports every valid row in one transaction.
create table if not exists public.master_import_mappings (
  company_id uuid not null references public.companies(id) on delete cascade,
  master text not null check (master in ('customers', 'vendors', 'transporters', 'profiles', 'dies', 'machines')),
  header_signature text not null check (header_signature ~ '^[0-9a-f]{32}$'),
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (company_id, master, header_signature)
);
create table if not exists public.master_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  master text not null check (master in ('customers', 'vendors', 'transporters', 'profiles', 'dies', 'machines')),
  file_name text not null check (length(file_name) between 1 and 200),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  header_signature text not null,
  mapping jsonb not null,
  status text not null default 'previewed' check (status in ('previewed', 'imported', 'reversed', 'discarded')),
  total_rows integer not null check (total_rows between 0 and 5000),
  valid_rows integer not null default 0,
  rejected_rows integer not null default 0,
  staged jsonb not null default '[]'::jsonb,
  rejected jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  imported_at timestamptz,
  imported_rows integer,
  reversed_by uuid references auth.users(id),
  reversed_at timestamptz,
  reversal_reason text
);
create index if not exists master_import_batches_company_idx on public.master_import_batches(company_id, created_at desc);
create table if not exists public.master_import_rows (
  batch_id uuid not null references public.master_import_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  row_number integer not null,
  record_table text not null,
  record_id uuid not null,
  primary key (batch_id, row_number)
);
create index if not exists master_import_rows_record_idx on public.master_import_rows(company_id, record_table, record_id);
alter table public.master_import_mappings enable row level security;
alter table public.master_import_batches enable row level security;
alter table public.master_import_rows enable row level security;
drop policy if exists "import mappings admin read" on public.master_import_mappings;
create policy "import mappings admin read" on public.master_import_mappings for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) in ('owner', 'admin'));
drop policy if exists "import batches admin read" on public.master_import_batches;
create policy "import batches admin read" on public.master_import_batches for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) in ('owner', 'admin'));
drop policy if exists "import rows admin read" on public.master_import_rows;
create policy "import rows admin read" on public.master_import_rows for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) in ('owner', 'admin'));
revoke all on public.master_import_mappings, public.master_import_batches, public.master_import_rows from public, anon, authenticated;
grant select on public.master_import_mappings, public.master_import_batches, public.master_import_rows to authenticated;

-- True when any other row in the database refers to one of the given records (used before undoing an import).
create or replace function private.ap_records_referenced(p_table regclass, p_ids uuid[], p_ignore regclass[] default array[]::regclass[])
returns text language plpgsql stable security definer set search_path = public, private as $$
declare r record; v_found boolean;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return null; end if;
  for r in select c.conrelid::regclass ref_table, a.attname ref_column
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[array_position(c.confkey, (select attnum from pg_attribute where attrelid = p_table and attname = 'id'))]
    where c.contype = 'f' and c.confrelid = p_table
      and (select attnum from pg_attribute where attrelid = p_table and attname = 'id') = any(c.confkey)
      and c.conrelid not in ('public.master_import_rows'::regclass, 'public.cutover_opening_lines'::regclass)
      and not (c.conrelid = any(p_ignore))
  loop
    execute format('select exists(select 1 from %s where %I = any($1))', r.ref_table, r.ref_column) into v_found using p_ids;
    if v_found then return r.ref_table::text; end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.ap_records_referenced(regclass, uuid[], regclass[]) from public, anon, authenticated;

create or replace function private.ap_import_duplicate(p_company uuid, p_master text, v jsonb)
returns text language sql stable security definer set search_path = public, private as $$
  select case p_master
    when 'customers' then case
      when nullif(v ->> 'gst_number', '') is not null and exists (select 1 from public.customers x where x.company_id = p_company and x.deleted_at is null and upper(x.gst_number) = upper(v ->> 'gst_number'))
        then 'A customer with this GSTIN already exists'
      when exists (select 1 from public.customers x where x.company_id = p_company and x.deleted_at is null and lower(btrim(x.customer_name)) = lower(btrim(v ->> 'customer_name'))
        and coalesce(lower(btrim(x.city)), '') = coalesce(lower(btrim(v ->> 'city')), '')) then 'A customer with this name and city already exists' end
    when 'vendors' then case
      when nullif(v ->> 'gst_number', '') is not null and exists (select 1 from public.vendors x where x.company_id = p_company and upper(x.gst_number) = upper(v ->> 'gst_number'))
        then 'A vendor with this GSTIN already exists'
      when exists (select 1 from public.vendors x where x.company_id = p_company and lower(btrim(x.vendor_name)) = lower(btrim(v ->> 'vendor_name'))) then 'A vendor with this name already exists' end
    when 'transporters' then case
      when nullif(v ->> 'gst_number', '') is not null and exists (select 1 from public.vendors x where x.company_id = p_company and upper(x.gst_number) = upper(v ->> 'gst_number'))
        then 'A vendor or transporter with this GSTIN already exists'
      when exists (select 1 from public.vendors x where x.company_id = p_company and lower(btrim(x.vendor_name)) = lower(btrim(v ->> 'vendor_name'))) then 'A vendor or transporter with this name already exists' end
    when 'profiles' then case when exists (select 1 from public.aluminium_profiles x where x.company_id = p_company and upper(x.profile_code) = upper(v ->> 'profile_code'))
      then 'Profile code already exists' end
    when 'dies' then case when exists (select 1 from public.dies x where x.company_id = p_company and upper(x.die_number) = upper(v ->> 'die_number')) then 'Die number already exists'
      when not exists (select 1 from public.aluminium_profiles x where x.company_id = p_company and x.deleted_at is null and upper(x.profile_code) = upper(v ->> 'profile_code'))
        then 'Profile code ' || coalesce(v ->> 'profile_code', '') || ' is not in the profile master (import profiles first)'
      when nullif(v ->> 'customer_name', '') is not null and (select count(*) from public.customers x where x.company_id = p_company and x.deleted_at is null
        and lower(btrim(x.customer_name)) = lower(btrim(v ->> 'customer_name'))) <> 1 then 'Customer ' || (v ->> 'customer_name') || ' is not found exactly once in the customer master' end
    when 'machines' then case when exists (select 1 from public.machines x where x.company_id = p_company and lower(btrim(x.machine_name)) = lower(btrim(v ->> 'machine_name')))
      then 'A machine with this name already exists' end
  end
$$;
revoke all on function private.ap_import_duplicate(uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.ap_import_insert(p_company uuid, p_actor uuid, p_master text, v jsonb)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v_id uuid; v_profile uuid; v_customer uuid;
begin
  if p_master = 'customers' then
    insert into public.customers(company_id, customer_name, company_name, customer_type, phone, whatsapp_number, email, gst_number, gst_registration, billing_address,
      shipping_address, city, state, pincode, contact_person, payment_terms, credit_terms, notes, created_by)
    values (p_company, v ->> 'customer_name', v ->> 'company_name', coalesce(v ->> 'customer_type', 'other'), v ->> 'phone', v ->> 'whatsapp_number', v ->> 'email',
      v ->> 'gst_number', v ->> 'gst_registration', v ->> 'billing_address', v ->> 'shipping_address', v ->> 'city', v ->> 'state', v ->> 'pincode', v ->> 'contact_person',
      v ->> 'payment_terms', v ->> 'credit_terms', v ->> 'notes', p_actor) returning id into v_id;
  elsif p_master in ('vendors', 'transporters') then
    insert into public.vendors(company_id, vendor_name, vendor_type, contact_person, phone, email, gst_number, gst_registration, address, city, state, payment_terms, notes, created_by)
    values (p_company, v ->> 'vendor_name', case when p_master = 'transporters' then 'transporter' else coalesce(v ->> 'vendor_type', 'other') end, v ->> 'contact_person',
      v ->> 'phone', v ->> 'email', v ->> 'gst_number', v ->> 'gst_registration', v ->> 'address', v ->> 'city', v ->> 'state', v ->> 'payment_terms', v ->> 'notes', p_actor)
    returning id into v_id;
  elsif p_master = 'profiles' then
    insert into public.aluminium_profiles(company_id, profile_code, profile_name, section_weight_kg_per_m, application_category, alloy, temper, standard_length_m,
      section_perimeter_mm, pieces_per_bundle, hsn_code, notes, created_by)
    values (p_company, upper(v ->> 'profile_code'), v ->> 'profile_name', (v ->> 'section_weight_kg_per_m')::numeric, coalesce(v ->> 'application_category', 'other'),
      v ->> 'alloy', v ->> 'temper', nullif(v ->> 'standard_length_m', '')::numeric, nullif(v ->> 'section_perimeter_mm', '')::numeric,
      nullif(v ->> 'pieces_per_bundle', '')::integer, v ->> 'hsn_code', v ->> 'notes', p_actor) returning id into v_id;
  elsif p_master = 'dies' then
    select x.id into v_profile from public.aluminium_profiles x where x.company_id = p_company and x.deleted_at is null and upper(x.profile_code) = upper(v ->> 'profile_code');
    if nullif(v ->> 'customer_name', '') is not null then
      select x.id into v_customer from public.customers x where x.company_id = p_company and x.deleted_at is null and lower(btrim(x.customer_name)) = lower(btrim(v ->> 'customer_name'));
    end if;
    insert into public.dies(company_id, die_number, profile_id, customer_id, ownership_type, die_status, die_type, number_of_cavities, rack_location, die_manufacturer,
      purchase_date, opening_production_kg, opening_runs, notes, created_by)
    values (p_company, upper(v ->> 'die_number'), v_profile, v_customer, coalesce(v ->> 'ownership_type', 'company_owned'), coalesce(v ->> 'die_status', 'active'),
      v ->> 'die_type', nullif(v ->> 'number_of_cavities', '')::integer, v ->> 'rack_location', v ->> 'die_manufacturer', nullif(v ->> 'purchase_date', '')::date,
      coalesce(nullif(v ->> 'opening_production_kg', '')::numeric, 0), coalesce(nullif(v ->> 'opening_runs', '')::integer, 0), v ->> 'notes', p_actor) returning id into v_id;
  elsif p_master = 'machines' then
    -- machine_code is allocated by the existing numbering trigger; the factory's own code is kept in notes.
    insert into public.machines(company_id, machine_name, machine_type, press_capacity_ton, status, location, manufacturer, purchase_date, notes, created_by)
    values (p_company, v ->> 'machine_name', v ->> 'machine_type', nullif(v ->> 'press_capacity_ton', '')::numeric, coalesce(v ->> 'status', 'active'), v ->> 'location',
      v ->> 'manufacturer', nullif(v ->> 'purchase_date', '')::date,
      nullif(concat_ws(' · ', case when nullif(v ->> 'factory_code', '') is not null then 'Factory code ' || (v ->> 'factory_code') end, v ->> 'notes'), ''), p_actor)
    returning id into v_id;
  else
    raise exception 'AP: Unknown master.';
  end if;
  return v_id;
end;
$$;
revoke all on function private.ap_import_insert(uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.ap_import_table(p_master text)
returns regclass language sql immutable set search_path = public, private as $$
  select case p_master when 'customers' then 'public.customers'::regclass when 'vendors' then 'public.vendors'::regclass when 'transporters' then 'public.vendors'::regclass
    when 'profiles' then 'public.aluminium_profiles'::regclass when 'dies' then 'public.dies'::regclass when 'machines' then 'public.machines'::regclass end
$$;
revoke all on function private.ap_import_table(text) from public, anon, authenticated;

create or replace function public.ap_import(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  c record; b public.master_import_batches%rowtype; v_master text; v_row jsonb; v_dup text; v_staged jsonb := '[]'::jsonb; v_rejected jsonb;
  v_seen text[] := '{}'; v_keys text[]; v_id uuid; v_n integer := 0; v_ids uuid[]; v_ref text; v_page integer; v_total bigint;
begin
  select * into c from private.ap_ctx(array['owner', 'admin']);
  if p_command = 'mapping' then
    perform private.ap_keys(p_payload, array['master', 'header_signature']);
    return jsonb_build_object('mapping', (select m.mapping from public.master_import_mappings m where m.company_id = c.company_id and m.master = p_payload ->> 'master'
      and m.header_signature = p_payload ->> 'header_signature'));
  elsif p_command = 'stage' then
    perform private.ap_keys(p_payload, array['master', 'file_name', 'file_sha256', 'header_signature', 'mapping', 'rows', 'rejected']);
    v_master := p_payload ->> 'master';
    if private.ap_import_table(v_master) is null then raise exception 'AP: Choose what to import.'; end if;
    if jsonb_typeof(p_payload -> 'rows') <> 'array' or jsonb_typeof(p_payload -> 'rejected') <> 'array'
      or jsonb_array_length(p_payload -> 'rows') + jsonb_array_length(p_payload -> 'rejected') > 5000 then raise exception 'AP: A sheet may hold up to 5,000 rows.'; end if;
    v_rejected := p_payload -> 'rejected';
    for v_row in select x from jsonb_array_elements(p_payload -> 'rows') x loop
      if jsonb_typeof(v_row -> 'values') <> 'object' or (v_row ->> 'row') !~ '^[0-9]{1,5}$' then raise exception 'AP: Invalid staged row.'; end if;
      v_dup := private.ap_import_duplicate(c.company_id, v_master, v_row -> 'values');
      -- In-sheet repeats: the code for coded masters; for parties both the GSTIN and the name with city.
      v_keys := array_remove(array[
        lower(coalesce(v_row -> 'values' ->> 'profile_code', v_row -> 'values' ->> 'die_number', v_row -> 'values' ->> 'machine_name',
          btrim(coalesce(v_row -> 'values' ->> 'customer_name', v_row -> 'values' ->> 'vendor_name')) || '|' || btrim(coalesce(v_row -> 'values' ->> 'city', '')))),
        'gstin:' || upper(nullif(v_row -> 'values' ->> 'gst_number', ''))], null);
      if v_dup is null and v_keys && v_seen then v_dup := 'Repeats an earlier row in this sheet'; end if;
      v_seen := v_seen || v_keys;
      if v_dup is not null then
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('row', (v_row ->> 'row')::integer, 'errors', jsonb_build_array(v_dup), 'values', v_row -> 'source'));
      else
        v_staged := v_staged || jsonb_build_array(v_row);
      end if;
    end loop;
    insert into public.master_import_batches(company_id, master, file_name, file_sha256, header_signature, mapping, total_rows, valid_rows, rejected_rows, staged, rejected, created_by)
      values (c.company_id, v_master, private.ap_text(p_payload ->> 'file_name', 'File name', 1, 200), p_payload ->> 'file_sha256', p_payload ->> 'header_signature',
        p_payload -> 'mapping', jsonb_array_length(v_staged) + jsonb_array_length(v_rejected), jsonb_array_length(v_staged), jsonb_array_length(v_rejected), v_staged,
        (select coalesce(jsonb_agg(x order by (x ->> 'row')::integer), '[]'::jsonb) from jsonb_array_elements(v_rejected) x), c.actor_id)
      returning * into b;
    if (p_payload ->> 'header_signature') ~ '^[0-9a-f]{32}$' and jsonb_typeof(p_payload -> 'mapping') = 'object' then
      insert into public.master_import_mappings(company_id, master, header_signature, mapping, updated_by) values (c.company_id, v_master, p_payload ->> 'header_signature', p_payload -> 'mapping', c.actor_id)
        on conflict (company_id, master, header_signature) do update set mapping = excluded.mapping, updated_by = excluded.updated_by, updated_at = now();
    end if;
    return jsonb_build_object('batch_id', b.id, 'valid_rows', b.valid_rows, 'rejected_rows', b.rejected_rows, 'rejected', b.rejected,
      'sample', (select coalesce(jsonb_agg(x -> 'values'), '[]'::jsonb) from (select x from jsonb_array_elements(b.staged) x limit 10) s(x)));
  elsif p_command = 'commit' then
    perform private.ap_keys(p_payload, array['batch_id']);
    select * into b from public.master_import_batches where id = private.ap_uuid(p_payload, 'batch_id') and company_id = c.company_id for update;
    if b.id is null then raise exception 'AP: This import is not available.'; end if;
    if b.status = 'imported' then return jsonb_build_object('batch_id', b.id, 'state', 'imported', 'imported_rows', b.imported_rows, 'repeated', true); end if;
    if b.status <> 'previewed' then raise exception 'AP: This import was %.', b.status; end if;
    if b.created_at < now() - interval '24 hours' then raise exception 'AP: This preview is older than a day. Upload the sheet again.'; end if;
    if b.valid_rows = 0 then raise exception 'AP: No valid rows to import.'; end if;
    perform pg_advisory_xact_lock(hashtextextended('ap-import:' || c.company_id::text || ':' || b.master, 0));
    for v_row in select x from jsonb_array_elements(b.staged) x order by (x ->> 'row')::integer loop
      v_dup := private.ap_import_duplicate(c.company_id, b.master, v_row -> 'values');
      if v_dup is not null then raise exception 'AP: Row %: % (changed since the preview). Nothing was imported.', v_row ->> 'row', v_dup; end if;
      begin
        v_id := private.ap_import_insert(c.company_id, c.actor_id, b.master, v_row -> 'values');
      exception when others then
        raise exception 'AP: Row %: %. Nothing was imported.', v_row ->> 'row', case when sqlstate in ('23514', '23505', '23502', '22P02', '22003', '23503') then sqlerrm else 'the database refused this row' end;
      end;
      insert into public.master_import_rows(batch_id, company_id, row_number, record_table, record_id) values (b.id, c.company_id, (v_row ->> 'row')::integer, private.ap_import_table(b.master)::text, v_id);
      v_n := v_n + 1;
    end loop;
    update public.master_import_batches set status = 'imported', imported_at = now(), imported_rows = v_n where id = b.id;
    return jsonb_build_object('batch_id', b.id, 'state', 'imported', 'imported_rows', v_n);
  elsif p_command = 'discard' then
    perform private.ap_keys(p_payload, array['batch_id']);
    update public.master_import_batches set status = 'discarded', staged = '[]'::jsonb where id = private.ap_uuid(p_payload, 'batch_id') and company_id = c.company_id and status = 'previewed' returning id into v_id;
    if v_id is null then raise exception 'AP: Only a preview can be discarded.'; end if;
    return jsonb_build_object('batch_id', v_id, 'state', 'discarded');
  elsif p_command = 'reverse' then
    perform private.ap_keys(p_payload, array['batch_id', 'reason']);
    select * into b from public.master_import_batches where id = private.ap_uuid(p_payload, 'batch_id') and company_id = c.company_id for update;
    if b.id is null or b.status <> 'imported' then raise exception 'AP: Only an imported batch can be reversed.'; end if;
    select array_agg(r.record_id) into v_ids from public.master_import_rows r where r.batch_id = b.id;
    v_ref := private.ap_records_referenced(private.ap_import_table(b.master), v_ids);
    if v_ref is not null then raise exception 'AP: These records are already used in %; deactivate them instead of reversing the import.', replace(replace(v_ref, 'public.', ''), '_', ' '); end if;
    execute format('delete from %s where company_id = $1 and id = any($2)', private.ap_import_table(b.master)) using c.company_id, v_ids;
    update public.master_import_batches set status = 'reversed', reversed_by = c.actor_id, reversed_at = now(),
      reversal_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 10, 300) where id = b.id;
    return jsonb_build_object('batch_id', b.id, 'state', 'reversed', 'removed', cardinality(coalesce(v_ids, '{}')));
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'master']);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    select count(*) into v_total from public.master_import_batches x where x.company_id = c.company_id and (coalesce(p_payload ->> 'master', '') = '' or x.master = p_payload ->> 'master');
    return jsonb_build_object('total_count', v_total, 'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id) from (
      select b2.id, b2.master, b2.file_name, b2.status, b2.total_rows, b2.valid_rows, b2.rejected_rows, b2.imported_rows, b2.created_at, b2.imported_at, b2.reversed_at,
        b2.reversal_reason, u.full_name created_by
      from public.master_import_batches b2 left join public.app_users u on u.id = b2.created_by
      where b2.company_id = c.company_id and (coalesce(p_payload ->> 'master', '') = '' or b2.master = p_payload ->> 'master')
      order by b2.created_at desc, b2.id limit 10 offset (v_page - 1) * 10) x), '[]'::jsonb));
  elsif p_command = 'get' then
    perform private.ap_keys(p_payload, array['batch_id']);
    select * into b from public.master_import_batches where id = private.ap_uuid(p_payload, 'batch_id') and company_id = c.company_id;
    if b.id is null then raise exception 'AP: This import is not available.'; end if;
    return jsonb_build_object('id', b.id, 'master', b.master, 'file_name', b.file_name, 'status', b.status, 'total_rows', b.total_rows, 'valid_rows', b.valid_rows,
      'rejected_rows', b.rejected_rows, 'imported_rows', b.imported_rows, 'rejected', b.rejected, 'mapping', b.mapping, 'created_at', b.created_at,
      'sample', (select coalesce(jsonb_agg(x -> 'values'), '[]'::jsonb) from (select x from jsonb_array_elements(b.staged) x limit 10) s(x)));
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_import(text, jsonb) from public, anon;
grant execute on function public.ap_import(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-007: opening balances and the cut-over lock
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.cutover_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  cutover_date date not null,
  status text not null default 'draft' check (status in ('draft', 'signed_off')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  signed_off_by uuid references auth.users(id),
  signed_off_at timestamptz,
  lock_id uuid references public.accounting_period_locks(id),
  check ((status = 'signed_off') = (signed_off_at is not null))
);
create table if not exists public.cutover_sections (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.cutover_plans(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  section text not null check (section in ('profile_stock', 'billet_stock', 'consumable_stock', 'receivables', 'payables', 'open_orders', 'die_custody')),
  status text not null default 'open' check (status in ('open', 'loaded', 'signed_off')),
  control_count integer check (control_count >= 0),
  control_quantity numeric(16, 3) check (control_quantity >= 0),
  control_amount numeric(16, 2) check (control_amount >= 0),
  source_file_name text,
  source_sha256 text,
  loaded_by uuid references auth.users(id),
  loaded_at timestamptz,
  signed_off_by uuid references auth.users(id),
  signed_off_at timestamptz,
  ledger_totals jsonb,
  reversal_reason text,
  reversed_by uuid references auth.users(id),
  reversed_at timestamptz,
  unique (plan_id, section)
);
create index if not exists cutover_sections_company_idx on public.cutover_sections(company_id);
create table if not exists public.cutover_opening_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  section_id uuid not null references public.cutover_sections(id) on delete cascade,
  row_number integer not null,
  payload jsonb not null,
  posted_table text,
  posted_id uuid,
  unique (section_id, row_number)
);
create index if not exists cutover_opening_lines_posted_idx on public.cutover_opening_lines(company_id, posted_table, posted_id);
alter table public.cutover_plans enable row level security;
alter table public.cutover_sections enable row level security;
alter table public.cutover_opening_lines enable row level security;
drop policy if exists "cutover plans read" on public.cutover_plans;
create policy "cutover plans read" on public.cutover_plans for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) in ('owner', 'admin', 'accounts', 'inventory_manager', 'factory_manager', 'production_manager', 'sales_manager'));
drop policy if exists "cutover sections read" on public.cutover_sections;
create policy "cutover sections read" on public.cutover_sections for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) in ('owner', 'admin', 'accounts', 'inventory_manager', 'factory_manager', 'production_manager', 'sales_manager'));
drop policy if exists "cutover lines read" on public.cutover_opening_lines;
create policy "cutover lines read" on public.cutover_opening_lines for select to authenticated
  using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) in ('owner', 'admin', 'accounts', 'inventory_manager'));
revoke all on public.cutover_plans, public.cutover_sections, public.cutover_opening_lines from public, anon, authenticated;
grant select on public.cutover_plans, public.cutover_sections, public.cutover_opening_lines to authenticated;

-- Opening records are typed in the ledgers they post to.
alter table public.invoices add column if not exists opening_cutover_id uuid references public.cutover_plans(id);
alter table public.invoices add column if not exists opening_reference text;
alter table public.orders add column if not exists opening_cutover_id uuid references public.cutover_plans(id);
create index if not exists invoices_opening_cutover_idx on public.invoices(opening_cutover_id) where opening_cutover_id is not null;
create index if not exists orders_opening_cutover_idx on public.orders(opening_cutover_id) where opening_cutover_id is not null;
comment on column public.invoices.opening_cutover_id is 'AP-007: set on an opening receivable brought in at cut-over. It is not a tax invoice issued by ExtrusionOS and is excluded from GST output.';
comment on column public.orders.opening_cutover_id is 'AP-007: set on an order brought in at cut-over with its balance quantity.';

-- An opening receivable is numbered OB-YYYY-NNNN outside every tax series so it never consumes a GST invoice number.
create or replace function private.assign_business_number()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  v_prefix text := tg_argv[1];
  v_number text;
  v_date date := coalesce(nullif(to_jsonb(new) ->> tg_argv[2], '')::date, (now() at time zone 'Asia/Kolkata')::date);
begin
  if tg_op = 'UPDATE' then
    if to_jsonb(new) ->> tg_argv[0] is distinct from to_jsonb(old) ->> tg_argv[0] then
      raise exception 'Business numbers are immutable after allocation';
    end if;
    return new;
  end if;
  if tg_table_name = 'invoices' and nullif(to_jsonb(new) ->> 'opening_cutover_id', '') is not null then
    v_number := private.ap_legacy_business_number(tg_relid::regclass, tg_argv[0], new.company_id, 'OB', v_date);
    new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], v_number));
    return new;
  end if;
  if tg_table_name in ('quotes', 'orders', 'dispatches', 'invoices') then
    select coalesce(nullif(to_jsonb(s) ->> case tg_table_name when 'quotes' then 'quote_prefix' when 'orders' then 'order_prefix' when 'dispatches' then 'dispatch_prefix' else 'invoice_prefix' end, ''), tg_argv[1])
    into v_prefix from public.company_settings s where company_id = new.company_id;
    v_prefix := coalesce(v_prefix, tg_argv[1]);
  end if;
  v_number := private.next_business_number_locked(tg_relid::regclass, tg_argv[0], new.company_id, v_prefix, v_date);
  new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], v_number));
  return new;
end;
$$;

-- Lines are validated here (the server action has already checked types); every reference must resolve exactly.
create or replace function private.ap_cutover_check_line(p_company uuid, p_section text, v jsonb)
returns text language plpgsql stable security definer set search_path = public, private as $$
declare n numeric;
begin
  if p_section = 'profile_stock' then
    if not exists (select 1 from public.aluminium_profiles x where x.company_id = p_company and x.deleted_at is null and upper(x.profile_code) = upper(v ->> 'profile_code')) then
      return 'Profile code ' || coalesce(v ->> 'profile_code', '') || ' is not in the profile master'; end if;
    if coalesce((v ->> 'weight_kg')::numeric, 0) <= 0 or coalesce((v ->> 'pieces')::integer, 0) <= 0 or coalesce((v ->> 'piece_length_m')::numeric, 0) <= 0 then
      return 'Pieces, piece length and weight must be above zero'; end if;
    if nullif(v ->> 'bundle_number', '') is not null and exists (select 1 from public.profile_stock_batches x where x.company_id = p_company and x.bundle_number = v ->> 'bundle_number') then
      return 'Bundle number already exists in stock'; end if;
  elsif p_section = 'billet_stock' then
    if coalesce((v ->> 'weight_kg')::numeric, 0) <= 0 then return 'Weight must be above zero'; end if;
    if exists (select 1 from public.billet_batches x where x.company_id = p_company and upper(x.batch_number) = upper(v ->> 'batch_number')) then return 'Billet batch number already exists'; end if;
  elsif p_section = 'consumable_stock' then
    if coalesce((v ->> 'quantity')::numeric, 0) <= 0 then return 'Quantity must be above zero'; end if;
    if exists (select 1 from public.inventory_items x where x.company_id = p_company and upper(x.item_code) = upper(v ->> 'item_code')) then return 'Item code already exists; adjust its stock through a movement instead'; end if;
  elsif p_section = 'receivables' then
    select count(*) into n from public.customers x where x.company_id = p_company and x.deleted_at is null
      and (lower(btrim(x.customer_name)) = lower(btrim(v ->> 'customer')) or (nullif(v ->> 'customer', '') is not null and upper(x.gst_number) = upper(v ->> 'customer')));
    if n <> 1 then return 'Customer ' || coalesce(v ->> 'customer', '') || ' must match exactly one customer by name or GSTIN'; end if;
    if coalesce((v ->> 'outstanding_amount')::numeric, 0) <= 0 then return 'Outstanding amount must be above zero'; end if;
  elsif p_section = 'payables' then
    select count(*) into n from public.vendors x where x.company_id = p_company
      and (lower(btrim(x.vendor_name)) = lower(btrim(v ->> 'vendor')) or (nullif(v ->> 'vendor', '') is not null and upper(x.gst_number) = upper(v ->> 'vendor')));
    if n <> 1 then return 'Vendor ' || coalesce(v ->> 'vendor', '') || ' must match exactly one vendor by name or GSTIN'; end if;
    if coalesce((v ->> 'outstanding_amount')::numeric, 0) <= 0 then return 'Outstanding amount must be above zero'; end if;
  elsif p_section = 'open_orders' then
    select count(*) into n from public.customers x where x.company_id = p_company and x.deleted_at is null
      and (lower(btrim(x.customer_name)) = lower(btrim(v ->> 'customer')) or (nullif(v ->> 'customer', '') is not null and upper(x.gst_number) = upper(v ->> 'customer')));
    if n <> 1 then return 'Customer ' || coalesce(v ->> 'customer', '') || ' must match exactly one customer by name or GSTIN'; end if;
    if not exists (select 1 from public.aluminium_profiles x where x.company_id = p_company and x.deleted_at is null and upper(x.profile_code) = upper(v ->> 'profile_code')) then
      return 'Profile code ' || coalesce(v ->> 'profile_code', '') || ' is not in the profile master'; end if;
    if coalesce((v ->> 'balance_kg')::numeric, 0) <= 0 then return 'Balance kg must be above zero'; end if;
  elsif p_section = 'die_custody' then
    if not exists (select 1 from public.dies x where x.company_id = p_company and x.deleted_at is null and upper(x.die_number) = upper(v ->> 'die_number')) then
      return 'Die ' || coalesce(v ->> 'die_number', '') || ' is not in the die master'; end if;
    select count(*) into n from public.vendors x where x.company_id = p_company and lower(btrim(x.vendor_name)) = lower(btrim(v ->> 'custodian'));
    if n <> 1 then return 'Custodian ' || coalesce(v ->> 'custodian', '') || ' must match exactly one vendor'; end if;
    if coalesce(v ->> 'custody_status', '') not in ('nitriding', 'under_correction', 'under_maintenance') then return 'Custody status must be nitriding, under_correction or under_maintenance'; end if;
  else
    return 'Unknown section';
  end if;
  return null;
end;
$$;
revoke all on function private.ap_cutover_check_line(uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.ap_cutover_section_roles(p_section text)
returns text[] language sql immutable set search_path = public, private as $$
  select case
    when p_section in ('profile_stock', 'billet_stock', 'consumable_stock') then array['owner', 'admin', 'inventory_manager']
    when p_section in ('receivables', 'payables') then array['owner', 'admin', 'accounts']
    when p_section = 'open_orders' then array['owner', 'admin']
    when p_section = 'die_custody' then array['owner', 'admin', 'factory_manager', 'production_manager'] end
$$;
revoke all on function private.ap_cutover_section_roles(text) from public, anon, authenticated;

-- Totals from the lines as loaded, and from the ledger rows actually posted (the sign-off compares both with the
-- totals signed on the Excel sheet).
create or replace function private.ap_cutover_totals(p_section_id uuid, p_section text, p_ledger boolean)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v jsonb;
begin
  if not p_ledger then
    select jsonb_build_object('count', count(*),
      'quantity', round(coalesce(sum(case p_section when 'profile_stock' then (l.payload ->> 'weight_kg')::numeric when 'billet_stock' then (l.payload ->> 'weight_kg')::numeric
        when 'consumable_stock' then (l.payload ->> 'quantity')::numeric when 'open_orders' then (l.payload ->> 'balance_kg')::numeric end), 0), 3),
      'amount', round(coalesce(sum(case p_section when 'receivables' then (l.payload ->> 'outstanding_amount')::numeric when 'payables' then (l.payload ->> 'outstanding_amount')::numeric
        when 'consumable_stock' then (l.payload ->> 'quantity')::numeric * coalesce((l.payload ->> 'rate')::numeric, 0) end), 0), 2))
    into v from public.cutover_opening_lines l where l.section_id = p_section_id;
    return v;
  end if;
  select jsonb_build_object('count', count(*),
    'quantity', round(coalesce(sum(case p_section when 'profile_stock' then ps.total_weight_kg when 'billet_stock' then bb.total_weight_kg
      when 'consumable_stock' then ii.current_stock when 'open_orders' then oi.quantity_kg end), 0), 3),
    'amount', round(coalesce(sum(case p_section when 'receivables' then iv.grand_total when 'payables' then el.total_amount
      when 'consumable_stock' then ii.current_stock * ii.average_rate end), 0), 2))
  into v from public.cutover_opening_lines l
    left join public.profile_stock_batches ps on l.posted_table = 'profile_stock_batches' and ps.id = l.posted_id
    left join public.billet_batches bb on l.posted_table = 'billet_batches' and bb.id = l.posted_id
    left join public.inventory_items ii on l.posted_table = 'inventory_items' and ii.id = l.posted_id
    left join public.invoices iv on l.posted_table = 'invoices' and iv.id = l.posted_id
    left join public.expense_ledger el on l.posted_table = 'expense_ledger' and el.id = l.posted_id
    left join public.order_items oi on l.posted_table = 'order_items' and oi.id = l.posted_id
  where l.section_id = p_section_id and l.posted_id is not null;
  return v;
end;
$$;
revoke all on function private.ap_cutover_totals(uuid, text, boolean) from public, anon, authenticated;

create or replace function private.ap_cutover_post(p_company uuid, p_actor uuid, p_plan public.cutover_plans, p_section public.cutover_sections)
returns void language plpgsql security definer set search_path = public, private as $$
declare l public.cutover_opening_lines%rowtype; v jsonb; v_id uuid; v_customer uuid; v_vendor uuid; v_profile record; v_order uuid; v_ref text; v_die record;
begin
  for l in select * from public.cutover_opening_lines where section_id = p_section.id order by row_number loop
    v := l.payload; v_id := null;
    if p_section.section = 'profile_stock' then
      select x.id, x.alloy, x.temper into v_profile from public.aluminium_profiles x where x.company_id = p_company and x.deleted_at is null and upper(x.profile_code) = upper(v ->> 'profile_code');
      insert into public.profile_stock_batches(company_id, profile_id, finish, length_m, quantity_pieces, total_weight_kg, bundle_number, location, status, origin_type,
        qc_status, origin_reference, piece_length_m, alloy, temper, notes)
      values (p_company, v_profile.id, coalesce(nullif(v ->> 'finish', ''), 'mill_finish'), (v ->> 'piece_length_m')::numeric * (v ->> 'pieces')::integer, (v ->> 'pieces')::integer,
        (v ->> 'weight_kg')::numeric, nullif(v ->> 'bundle_number', ''), nullif(v ->> 'location', ''), 'available', 'opening_balance', 'released',
        'Opening balance ' || to_char(p_plan.cutover_date, 'DD Mon YYYY'), (v ->> 'piece_length_m')::numeric, coalesce(nullif(v ->> 'alloy', ''), v_profile.alloy),
        coalesce(nullif(v ->> 'temper', ''), v_profile.temper), 'Opening balance at cut-over') returning id into v_id;
      update public.cutover_opening_lines set posted_table = 'profile_stock_batches', posted_id = v_id where id = l.id;
    elsif p_section.section = 'billet_stock' then
      insert into public.billet_batches(company_id, batch_number, alloy, temper, diameter_mm, length_mm, total_weight_kg, available_weight_kg, heat_number, received_date, status, notes)
      values (p_company, upper(v ->> 'batch_number'), coalesce(nullif(v ->> 'alloy', ''), '6063'), coalesce(nullif(v ->> 'temper', ''), 'F'), nullif(v ->> 'diameter_mm', '')::numeric,
        nullif(v ->> 'length_mm', '')::numeric, (v ->> 'weight_kg')::numeric, (v ->> 'weight_kg')::numeric, nullif(v ->> 'heat_number', ''), p_plan.cutover_date, 'available',
        'Opening balance at cut-over') returning id into v_id;
      update public.cutover_opening_lines set posted_table = 'billet_batches', posted_id = v_id where id = l.id;
    elsif p_section.section = 'consumable_stock' then
      insert into public.inventory_items(company_id, item_code, item_name, item_category, unit, current_stock, reorder_level, average_rate, location)
      values (p_company, upper(v ->> 'item_code'), v ->> 'item_name', coalesce(nullif(v ->> 'category', ''), 'packing_material'), coalesce(nullif(v ->> 'unit', ''), 'kg'),
        (v ->> 'quantity')::numeric, coalesce(nullif(v ->> 'reorder_level', '')::numeric, 0), coalesce(nullif(v ->> 'rate', '')::numeric, 0), nullif(v ->> 'location', ''))
      returning id into v_id;
      update public.cutover_opening_lines set posted_table = 'inventory_items', posted_id = v_id where id = l.id;
    elsif p_section.section = 'receivables' then
      select x.id into v_customer from public.customers x where x.company_id = p_company and x.deleted_at is null
        and (lower(btrim(x.customer_name)) = lower(btrim(v ->> 'customer')) or upper(x.gst_number) = upper(v ->> 'customer'));
      insert into public.invoices(company_id, customer_id, invoice_date, due_date, subtotal, tax_total, grand_total, amount_paid, status, notes, opening_cutover_id, opening_reference,
        supplier_state_code, place_of_supply_state_code)
      values (p_company, v_customer, (v ->> 'invoice_date')::date, nullif(v ->> 'due_date', '')::date, (v ->> 'outstanding_amount')::numeric, 0, (v ->> 'outstanding_amount')::numeric, 0,
        'generated', 'Opening receivable at cut-over; original invoice ' || (v ->> 'invoice_ref'), p_plan.id, v ->> 'invoice_ref',
        (select co.gst_state_code from public.companies co where co.id = p_company),
        coalesce((select substr(x.gst_number, 1, 2) from public.customers x where x.id = v_customer and x.gst_number is not null),
          (select co.gst_state_code from public.companies co where co.id = p_company)))
      returning id into v_id;
      update public.cutover_opening_lines set posted_table = 'invoices', posted_id = v_id where id = l.id;
    elsif p_section.section = 'payables' then
      select x.id, x.vendor_name into v_vendor, v_ref from public.vendors x where x.company_id = p_company
        and (lower(btrim(x.vendor_name)) = lower(btrim(v ->> 'vendor')) or upper(x.gst_number) = upper(v ->> 'vendor'));
      insert into public.expense_ledger(company_id, expense_number, source_module, source_label, expense_category, vendor_id, vendor_name_snapshot, description, quantity, rate,
        base_amount, total_amount, balance_amount, payment_status, invoice_number, invoice_date, due_date, approval_status, approved_by, approved_at, notes, created_by, updated_by)
      values (p_company, 'OB-PAY-' || to_char(p_plan.cutover_date, 'YYMMDD') || '-' || lpad(l.row_number::text, 4, '0'), 'opening_balance', 'Opening payable at cut-over',
        'opening_payable', v_vendor, v_ref, 'Opening payable; supplier bill ' || (v ->> 'bill_ref'), 1, (v ->> 'outstanding_amount')::numeric,
        (v ->> 'outstanding_amount')::numeric, (v ->> 'outstanding_amount')::numeric, (v ->> 'outstanding_amount')::numeric, 'unpaid', v ->> 'bill_ref', (v ->> 'bill_date')::date,
        nullif(v ->> 'due_date', '')::date, 'approved', p_actor, now(), 'Opening balance at cut-over', p_actor, p_actor) returning id into v_id;
      update public.cutover_opening_lines set posted_table = 'expense_ledger', posted_id = v_id where id = l.id;
    elsif p_section.section = 'open_orders' then
      select x.id into v_customer from public.customers x where x.company_id = p_company and x.deleted_at is null
        and (lower(btrim(x.customer_name)) = lower(btrim(v ->> 'customer')) or upper(x.gst_number) = upper(v ->> 'customer'));
      select x.id, x.section_weight_kg_per_m into v_profile from public.aluminium_profiles x where x.company_id = p_company and x.deleted_at is null and upper(x.profile_code) = upper(v ->> 'profile_code');
      -- One order per customer order reference; its lines carry the balance still to make.
      select o.id into v_order from public.orders o where o.company_id = p_company and o.opening_cutover_id = p_plan.id and o.customer_id = v_customer
        and o.notes = 'Opening order at cut-over; customer order ' || (v ->> 'order_ref');
      if v_order is null then
        insert into public.orders(company_id, customer_id, order_date, expected_dispatch_date, priority, current_stage, requested_weight_kg, manufacturing_weight_kg, notes, opening_cutover_id)
        values (p_company, v_customer, coalesce(nullif(v ->> 'order_date', '')::date, p_plan.cutover_date), nullif(v ->> 'due_date', '')::date, 'normal', 'order_confirmed', 0, 0,
          'Opening order at cut-over; customer order ' || (v ->> 'order_ref'), p_plan.id) returning id into v_order;
      end if;
      insert into public.order_items(company_id, order_id, profile_id, item_description, quantity_pieces, quantity_kg, manufacturing_weight_kg, section_weight_kg_per_m, finishing_type, net_rate)
      values (p_company, v_order, v_profile.id, 'Opening balance: ' || (v ->> 'profile_code'), nullif(v ->> 'balance_pieces', '')::integer, (v ->> 'balance_kg')::numeric,
        (v ->> 'balance_kg')::numeric, v_profile.section_weight_kg_per_m, nullif(v ->> 'finish', ''), nullif(v ->> 'rate_per_kg', '')::numeric) returning id into v_id;
      update public.orders set requested_weight_kg = requested_weight_kg + (v ->> 'balance_kg')::numeric, manufacturing_weight_kg = manufacturing_weight_kg + (v ->> 'balance_kg')::numeric
        where id = v_order;
      update public.cutover_opening_lines set posted_table = 'order_items', posted_id = v_id where id = l.id;
    elsif p_section.section = 'die_custody' then
      select x.id, x.die_number into v_die from public.dies x where x.company_id = p_company and x.deleted_at is null and upper(x.die_number) = upper(v ->> 'die_number');
      update public.dies set die_status = v ->> 'custody_status', rack_location = left('With ' || (v ->> 'custodian') || coalesce(' since ' || to_char(nullif(v ->> 'since_date', '')::date, 'DD Mon YYYY'), ''), 120)
        where id = v_die.id;
      update public.cutover_opening_lines set posted_table = 'dies', posted_id = v_die.id where id = l.id;
    end if;
  end loop;
end;
$$;
revoke all on function private.ap_cutover_post(uuid, uuid, public.cutover_plans, public.cutover_sections) from public, anon, authenticated;

create or replace function private.ap_cutover_view(p_plan public.cutover_plans, p_role text)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', p_plan.id, 'cutover_date', p_plan.cutover_date, 'status', p_plan.status, 'signed_off_at', p_plan.signed_off_at,
    'signed_off_by', (select u.full_name from public.app_users u where u.id = p_plan.signed_off_by),
    'locked_through', private.books_locked_through(p_plan.company_id),
    'sections', (select jsonb_agg(jsonb_build_object('id', s.id, 'section', s.section, 'status', s.status, 'control_count', s.control_count, 'control_quantity', s.control_quantity,
        'control_amount', s.control_amount, 'source_file_name', s.source_file_name, 'loaded_at', s.loaded_at, 'loaded_by', lu.full_name, 'signed_off_at', s.signed_off_at,
        'signed_off_by', su.full_name, 'loaded_totals', private.ap_cutover_totals(s.id, s.section, false), 'ledger_totals', s.ledger_totals,
        'reversal_reason', s.reversal_reason, 'can_act', p_role = any(private.ap_cutover_section_roles(s.section)) and p_plan.status = 'draft',
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('row', l.row_number, 'payload', l.payload, 'posted_table', l.posted_table, 'posted_id', l.posted_id) order by l.row_number), '[]'::jsonb)
          from (select * from public.cutover_opening_lines l2 where l2.section_id = s.id order by l2.row_number limit 10) l))
      order by array_position(array['profile_stock', 'billet_stock', 'consumable_stock', 'receivables', 'payables', 'open_orders', 'die_custody'], s.section))
      from public.cutover_sections s left join public.app_users lu on lu.id = s.loaded_by left join public.app_users su on su.id = s.signed_off_by
      where s.plan_id = p_plan.id))
$$;
revoke all on function private.ap_cutover_view(public.cutover_plans, text) from public, anon, authenticated;

create or replace function public.ap_cutover(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  c record; p public.cutover_plans%rowtype; s public.cutover_sections%rowtype; v_section text; v_row jsonb; v_err text; v_errors jsonb := '[]'::jsonb;
  v_loaded jsonb; v_ledger jsonb; v_date date; v_lock date; v_lock_id uuid; v_ids uuid[]; v_ref text; v_table text;
  v_readers constant text[] := array['owner', 'admin', 'accounts', 'inventory_manager', 'factory_manager', 'production_manager', 'sales_manager'];
begin
  select * into c from private.ap_ctx(v_readers);
  select * into p from public.cutover_plans where company_id = c.company_id;
  if p_command = 'get' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('plan', case when p.id is null then null else private.ap_cutover_view(p, c.role) end, 'can_start', c.role in ('owner', 'admin', 'accounts'), 'today', private.ist_today());
  elsif p_command = 'start' then
    perform private.ap_keys(p_payload, array['cutover_date']);
    if c.role not in ('owner', 'admin', 'accounts') then raise exception 'Not permitted' using errcode = '42501'; end if;
    if p.id is not null then raise exception 'AP: A cut-over plan already exists.'; end if;
    v_date := (p_payload ->> 'cutover_date')::date;
    if v_date is null or v_date > private.ist_today() + 60 or v_date < private.ist_today() - 60 then raise exception 'AP: Choose a cut-over date within 60 days of today.'; end if;
    v_lock := private.books_locked_through(c.company_id);
    if v_lock is not null and v_date <= v_lock then raise exception 'AP: The books are already closed through %.', v_lock; end if;
    insert into public.cutover_plans(company_id, cutover_date, created_by) values (c.company_id, v_date, c.actor_id) returning * into p;
    insert into public.cutover_sections(plan_id, company_id, section)
      select p.id, c.company_id, x from unnest(array['profile_stock', 'billet_stock', 'consumable_stock', 'receivables', 'payables', 'open_orders', 'die_custody']) x;
    return private.ap_cutover_view(p, c.role);
  end if;
  if p.id is null then raise exception 'AP: Start the cut-over plan first.'; end if;
  if p_command in ('load', 'sign_off_section', 'reverse_section') then
    v_section := p_payload ->> 'section';
    select * into s from public.cutover_sections where plan_id = p.id and section = v_section for update;
    if s.id is null then raise exception 'AP: Unknown section.'; end if;
    if not (c.role = any(private.ap_cutover_section_roles(v_section))) then raise exception 'Not permitted' using errcode = '42501'; end if;
    if p.status <> 'draft' then raise exception 'AP: The cut-over is signed off; opening entries can no longer change. Correct them with normal documents.'; end if;
  end if;
  if p_command = 'load' then
    perform private.ap_keys(p_payload, array['section', 'file_name', 'file_sha256', 'rows', 'control']);
    if s.status = 'signed_off' then raise exception 'AP: This section is signed off. Reverse it with a reason before loading again.'; end if;
    if jsonb_typeof(p_payload -> 'rows') <> 'array' or jsonb_array_length(p_payload -> 'rows') > 5000 then raise exception 'AP: A section may hold up to 5,000 lines.'; end if;
    if jsonb_typeof(p_payload -> 'control') <> 'object' or (p_payload -> 'control' ->> 'count') !~ '^[0-9]{1,6}$' then raise exception 'AP: Enter the signed control totals from the sheet.'; end if;
    for v_row in select x from jsonb_array_elements(p_payload -> 'rows') x loop
      v_err := private.ap_cutover_check_line(c.company_id, v_section, v_row -> 'values');
      if v_err is not null then v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', (v_row ->> 'row')::integer, 'errors', jsonb_build_array(v_err))); end if;
    end loop;
    if jsonb_array_length(v_errors) > 0 then return jsonb_build_object('state', 'rejected', 'errors', v_errors); end if;
    delete from public.cutover_opening_lines where section_id = s.id;
    insert into public.cutover_opening_lines(company_id, section_id, row_number, payload)
      select c.company_id, s.id, (x ->> 'row')::integer, x -> 'values' from jsonb_array_elements(p_payload -> 'rows') x;
    update public.cutover_sections set status = 'loaded', source_file_name = private.ap_text(p_payload ->> 'file_name', 'File name', 1, 200), source_sha256 = p_payload ->> 'file_sha256',
      control_count = (p_payload -> 'control' ->> 'count')::integer, control_quantity = nullif(p_payload -> 'control' ->> 'quantity', '')::numeric,
      control_amount = nullif(p_payload -> 'control' ->> 'amount', '')::numeric, loaded_by = c.actor_id, loaded_at = now(), reversal_reason = null
      where id = s.id;
    return jsonb_build_object('state', 'loaded', 'totals', private.ap_cutover_totals(s.id, v_section, false));
  elsif p_command = 'sign_off_section' then
    perform private.ap_keys(p_payload, array['section']);
    if s.status <> 'loaded' then raise exception 'AP: Load the section before signing it off.'; end if;
    if s.loaded_by = c.actor_id and c.role not in ('owner') then raise exception 'AP: Another person signs off what you loaded.'; end if;
    v_loaded := private.ap_cutover_totals(s.id, v_section, false);
    if (v_loaded ->> 'count')::integer <> s.control_count
      or (s.control_quantity is not null and (v_loaded ->> 'quantity')::numeric <> s.control_quantity)
      or (s.control_amount is not null and (v_loaded ->> 'amount')::numeric <> s.control_amount) then
      raise exception 'AP: Loaded totals (% lines, % qty, % amount) do not match the signed sheet (% lines, % qty, % amount).',
        v_loaded ->> 'count', v_loaded ->> 'quantity', v_loaded ->> 'amount', s.control_count, coalesce(s.control_quantity::text, '-'), coalesce(s.control_amount::text, '-');
    end if;
    perform private.ap_cutover_post(c.company_id, c.actor_id, p, s);
    if v_section <> 'die_custody' then
      v_ledger := private.ap_cutover_totals(s.id, v_section, true);
      if v_ledger is distinct from v_loaded then raise exception 'AP: The ledgers did not record the loaded totals exactly; nothing was posted.'; end if;
    else
      v_ledger := jsonb_build_object('count', (select count(*) from public.cutover_opening_lines l where l.section_id = s.id and l.posted_id is not null));
    end if;
    update public.cutover_sections set status = 'signed_off', signed_off_by = c.actor_id, signed_off_at = now(), ledger_totals = v_ledger where id = s.id;
    return jsonb_build_object('state', 'signed_off', 'ledger_totals', v_ledger);
  elsif p_command = 'reverse_section' then
    perform private.ap_keys(p_payload, array['section', 'reason']);
    if s.status = 'open' then raise exception 'AP: Nothing is loaded in this section.'; end if;
    if s.status = 'signed_off' then
      if v_section = 'die_custody' then raise exception 'AP: Die custody is corrected on the die itself.'; end if;
      select array_agg(l.posted_id), min(l.posted_table) into v_ids, v_table from public.cutover_opening_lines l where l.section_id = s.id and l.posted_id is not null;
      -- Only entries nothing has used yet can be reversed.
      if v_section = 'profile_stock' and exists (select 1 from public.profile_stock_batches x where x.id = any(v_ids) and (x.status <> 'available' or x.reserved_for_order_id is not null)) then
        raise exception 'AP: Some opening bundles are already reserved or moved.'; end if;
      if v_section = 'billet_stock' and exists (select 1 from public.billet_batches x where x.id = any(v_ids) and x.available_weight_kg <> x.total_weight_kg) then
        raise exception 'AP: Some opening billets are already issued.'; end if;
      if v_section = 'receivables' and exists (select 1 from public.invoices x where x.id = any(v_ids) and (x.amount_paid <> 0 or x.credited_amount <> 0)) then
        raise exception 'AP: Some opening receivables already have receipts or credits.'; end if;
      if v_section = 'payables' and exists (select 1 from public.expense_ledger x where x.id = any(v_ids) and x.amount_paid <> 0) then
        raise exception 'AP: Some opening payables already have payments.'; end if;
      v_ref := private.ap_records_referenced(('public.' || v_table)::regclass, v_ids);
      if v_ref is not null then raise exception 'AP: Opening entries are already used in %.', replace(replace(v_ref, 'public.', ''), '_', ' '); end if;
      if v_section = 'open_orders' then
        select array_agg(distinct oi.order_id) into v_ids from public.order_items oi where oi.id = any(v_ids);
        -- The opening lines themselves are removed with their orders; any other use of the order blocks the reversal.
        v_ref := private.ap_records_referenced('public.orders'::regclass, v_ids, array['public.order_items'::regclass]);
        if v_ref is not null then raise exception 'AP: Opening orders are already used in %.', replace(replace(v_ref, 'public.', ''), '_', ' '); end if;
        delete from public.order_items where order_id = any(v_ids);
        delete from public.orders where id = any(v_ids) and opening_cutover_id = p.id;
      else
        execute format('delete from public.%I where company_id = $1 and id = any($2)', v_table) using c.company_id, v_ids;
      end if;
    end if;
    delete from public.cutover_opening_lines where section_id = s.id;
    update public.cutover_sections set status = 'open', reversal_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 10, 300), reversed_by = c.actor_id, reversed_at = now(),
      signed_off_by = null, signed_off_at = null, ledger_totals = null, loaded_by = null, loaded_at = null, control_count = null, control_quantity = null, control_amount = null,
      source_file_name = null, source_sha256 = null where id = s.id;
    return jsonb_build_object('state', 'open');
  elsif p_command = 'sign_off_plan' then
    perform private.ap_keys(p_payload, array['empty_sections_confirmed']);
    if c.role not in ('owner', 'admin') then raise exception 'Not permitted' using errcode = '42501'; end if;
    if p.status <> 'draft' then raise exception 'AP: The cut-over is already signed off.'; end if;
    if exists (select 1 from public.cutover_sections x where x.plan_id = p.id and x.status = 'loaded') then raise exception 'AP: Sign off or reverse every loaded section first.'; end if;
    if exists (select 1 from public.cutover_sections x where x.plan_id = p.id and x.status = 'open') and coalesce((p_payload ->> 'empty_sections_confirmed')::boolean, false) is not true then
      raise exception 'AP: Some sections have no opening entries. Confirm that they are empty at cut-over.';
    end if;
    if p.cutover_date > private.ist_today() then raise exception 'AP: The cut-over can be signed off on or after %.', p.cutover_date; end if;
    v_lock := private.books_locked_through(c.company_id);
    if v_lock is null or v_lock < p.cutover_date - 1 then
      insert into public.accounting_period_locks(company_id, locked_through, previous_locked_through, reason, set_by, set_by_role)
        values (c.company_id, p.cutover_date - 1, v_lock, 'Cut-over to ExtrusionOS on ' || to_char(p.cutover_date, 'DD Mon YYYY') || '; earlier entries are locked', c.actor_id, c.role)
        returning id into v_lock_id;
    end if;
    update public.cutover_plans set status = 'signed_off', signed_off_by = c.actor_id, signed_off_at = now(), lock_id = v_lock_id where id = p.id returning * into p;
    return private.ap_cutover_view(p, c.role);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_cutover(text, jsonb) from public, anon;
grant execute on function public.ap_cutover(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-041: pilot work shown on the record it belongs to (no hub tables move; reads reuse each hub's read model)
-- ---------------------------------------------------------------------------------------------------------------
-- Mirrored by lib/navigation/home-work.ts (a test compares them). A row says: records of hub view V live in table T
-- and point at a home record of kind K through column C ('id' when the hub view lists the home records themselves).
create or replace function private.ap_home_sources()
returns table(home_kind text, hub text, view_name text, table_name text, link_column text)
language sql immutable set search_path = public, private as $$
  values
    ('order', 'coordination', 'orders', 'orders', 'id'), ('order', 'lifecycle', 'closure', 'orders', 'id'), ('order', 'commercial', 'profitability', 'orders', 'id'),
    ('order', 'control', 'ledger', 'orders', 'id'), ('order', 'coordination', 'decisions', 'coordination_decisions', 'order_id'),
    ('order', 'assurance', 'deliveries', 'dispatches', 'order_id'), ('order', 'assurance', 'packs', 'dispatches', 'order_id'),
    ('order', 'assurance', 'revisions', 'order_change_proposals', 'order_id'), ('order', 'assurance', 'returns', 'return_authorizations', 'order_id'),
    ('order', 'lifecycle', 'samples', 'sample_requirements', 'order_id'), ('order', 'lifecycle', 'templates', 'packing_label_templates', 'order_id'),
    ('order', 'lifecycle', 'labels', 'prepared_physical_bundles', 'order_id'), ('order', 'lifecycle', 'promises', 'delivery_promises', 'order_id'),
    ('order', 'lifecycle', 'journeys', 'journey_reviews', 'order_id'), ('order', 'execution', 'appointments', 'delivery_appointments', 'order_id'),
    ('order', 'specialist', 'intake', 'po_intakes', 'order_id'), ('order', 'control', 'inheritance', 'production_jobs', 'order_id'),
    ('order', 'control', 'wip', 'production_jobs', 'order_id'), ('order', 'control', 'custody', 'finishing_jobs', 'order_id'),
    ('job', 'control', 'inheritance', 'production_jobs', 'id'), ('job', 'control', 'wip', 'production_jobs', 'id'),
    ('job', 'specialist', 'lab', 'lab_requests', 'production_job_id'), ('job', 'control', 'custody', 'finishing_jobs', 'production_job_id'),
    ('die', 'improvement', 'dies', 'dies', 'id'), ('die', 'lifecycle', 'samples', 'sample_requirements', 'die_id'),
    ('die', 'execution', 'gate_passes', 'returnable_gate_passes', 'die_id'), ('die', 'specialist', 'tooling', 'tooling_agreements', 'die_id'),
    ('dispatch', 'assurance', 'deliveries', 'dispatches', 'id'), ('dispatch', 'assurance', 'packs', 'dispatches', 'id'),
    ('dispatch', 'assurance', 'returns', 'return_authorizations', 'dispatch_id'), ('dispatch', 'lifecycle', 'labels', 'prepared_physical_bundles', 'dispatch_id'),
    ('dispatch', 'execution', 'appointments', 'delivery_appointments', 'dispatch_id'), ('dispatch', 'specialist', 'weighing', 'weighing_sessions', 'dispatch_id'),
    ('invoice', 'coordination', 'collections', 'collection_promises', 'invoice_id'),
    ('vendor', 'commercial', 'reliability', 'vendors', 'id'), ('vendor', 'commercial', 'claims', 'supplier_claims', 'vendor_id'),
    ('vendor', 'specialist', 'lab', 'lab_requests', 'lab_vendor_id'), ('vendor', 'control', 'custody', 'finishing_jobs', 'vendor_id'),
    ('customer', 'specialist', 'tolling', 'customers', 'id'), ('customer', 'lifecycle', 'samples', 'sample_requirements', 'customer_id'),
    ('customer', 'lifecycle', 'templates', 'packing_label_templates', 'customer_id'), ('customer', 'commercial', 'pricing', 'pricing_rules', 'customer_id'),
    ('customer', 'specialist', 'intake', 'po_intakes', 'customer_id'), ('customer', 'specialist', 'shades', 'shade_references', 'customer_id'),
    ('customer', 'specialist', 'agreements', 'blanket_agreements', 'customer_id'), ('customer', 'specialist', 'tooling', 'tooling_agreements', 'customer_id'),
    ('quote', 'commercial', 'outcomes', 'quotes', 'id'), ('quote', 'specialist', 'intake', 'po_intakes', 'quote_id')
$$;
revoke all on function private.ap_home_sources() from public, anon, authenticated;

create or replace function private.ap_home_table(p_kind text)
returns text language sql immutable set search_path = public, private as $$
  select case p_kind when 'order' then 'orders' when 'job' then 'production_jobs' when 'die' then 'dies' when 'dispatch' then 'dispatches'
    when 'invoice' then 'invoices' when 'vendor' then 'vendors' when 'customer' then 'customers' when 'quote' then 'quotes'
    when 'machine' then 'machines' when 'profile' then 'aluminium_profiles' end
$$;
revoke all on function private.ap_home_table(text) from public, anon, authenticated;

create or replace function private.ap_hub_read_allowed(p_hub text, p_role text, p_view text)
returns boolean language plpgsql stable security definer set search_path = public, private as $$
begin
  return coalesce(case p_hub
    when 'assurance' then private.assurance_read_allowed(p_role, p_view) when 'coordination' then private.coordination_read_allowed(p_role, p_view)
    when 'lifecycle' then private.lifecycle_read_allowed(p_role, p_view) when 'improvement' then private.improvement_read_allowed(p_role, p_view)
    when 'execution' then private.execution_read_allowed(p_role, p_view) when 'commercial' then private.commercial_read_allowed(p_role, p_view)
    when 'specialist' then private.specialist_read_allowed(p_role, p_view) when 'control' then private.control_read_allowed(p_role, p_view) end, false);
end;
$$;
revoke all on function private.ap_hub_read_allowed(text, text, text) from public, anon, authenticated;

create or replace function private.ap_hub_rows(p_hub text, p_company uuid, p_actor uuid, p_role text, p_view text, p_state text, p_id uuid)
returns table(row_data jsonb, sort_rank integer, sort_due date)
language plpgsql stable security definer set search_path = public, private as $$
begin
  if p_hub = 'assurance' then return query select r.row_data, r.sort_rank, r.sort_due from private.assurance_rows(p_company, p_actor, p_role, p_view, p_state, p_id) r;
  elsif p_hub = 'coordination' then return query select r.row_data, r.sort_rank, r.sort_due from private.coordination_rows(p_company, p_actor, p_view, p_state, p_id) r;
  elsif p_hub = 'lifecycle' then return query select r.row_data, r.sort_rank, r.sort_due from private.lifecycle_rows(p_company, p_actor, p_role, p_view, p_state, p_id) r;
  elsif p_hub = 'improvement' then return query select r.row_data, r.sort_rank, r.sort_due from private.improvement_rows(p_company, p_actor, p_role, p_view, p_state, p_id) r;
  elsif p_hub = 'execution' then return query select r.row_data, r.sort_rank, r.sort_due from private.execution_rows(p_company, p_actor, p_role, p_view, p_state, p_id) r;
  elsif p_hub = 'commercial' then return query select r.row_data, r.sort_rank, r.sort_due from private.commercial_rows(p_company, p_actor, p_role, p_view, p_state, p_id) r;
  elsif p_hub = 'specialist' then return query select r.row_data, r.sort_rank, r.sort_due from private.specialist_rows(p_company, p_actor, p_role, p_view, p_state, p_id) r;
  elsif p_hub = 'control' then return query select r.row_data, r.sort_rank, r.sort_due from private.control_rows(p_company, p_actor, p_role, p_view, p_state, p_id) r;
  end if;
end;
$$;
revoke all on function private.ap_hub_rows(text, uuid, uuid, text, text, text, uuid) from public, anon, authenticated;

create or replace function public.ap_home_work(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  c record; v_kind text; v_id uuid; v_exists boolean; src record; v_ids uuid[]; v_total bigint; v_item uuid; v_row jsonb; v_items jsonb := '[]'::jsonb; v_groups jsonb := '[]'::jsonb;
begin
  select * into c from private.ap_ctx(null);
  if p_command = 'record' then
    perform private.ap_keys(p_payload, array['kind', 'id']);
    v_kind := p_payload ->> 'kind'; v_id := private.ap_uuid(p_payload, 'id');
    if private.ap_home_table(v_kind) is null then raise exception 'AP: Unknown record kind.'; end if;
    execute format('select exists(select 1 from public.%I where id = $1 and company_id = $2)', private.ap_home_table(v_kind)) into v_exists using v_id, c.company_id;
    if not v_exists then raise exception 'AP: This record is not available.'; end if;
    for src in select * from private.ap_home_sources() s where s.home_kind = v_kind loop
      continue when not private.ap_hub_read_allowed(src.hub, c.role, src.view_name);
      execute format('select count(*), (array_agg(id order by id))[1:5] from public.%I where company_id = $1 and %I = $2', src.table_name, src.link_column)
        into v_total, v_ids using c.company_id, v_id;
      continue when v_total = 0;
      v_groups := v_groups || jsonb_build_array(jsonb_build_object('hub', src.hub, 'view', src.view_name, 'total', v_total));
      foreach v_item in array coalesce(v_ids, '{}') loop
        select r.row_data into v_row from private.ap_hub_rows(src.hub, c.company_id, c.actor_id, c.role, src.view_name, 'all', v_item) r limit 1;
        continue when v_row is null;
        v_items := v_items || jsonb_build_array(jsonb_build_object('hub', src.hub, 'view', src.view_name, 'id', v_row ->> 'id', 'label', v_row ->> 'label',
          'status', v_row ->> 'status', 'summary', v_row ->> 'summary', 'due_date', v_row ->> 'due_date',
          'href', '/tasks/' || src.hub || '/' || src.view_name || '/' || (v_row ->> 'id')));
      end loop;
    end loop;
    return jsonb_build_object('kind', v_kind, 'id', v_id, 'groups', v_groups, 'items', v_items);
  elsif p_command = 'attention' then
    perform private.ap_keys(p_payload, array['limit']);
    with views as (select distinct s.hub, s.view_name, s.home_kind from private.ap_home_sources() s where private.ap_hub_read_allowed(s.hub, c.role, s.view_name)),
      picked as (select distinct on (v.hub, v.view_name, r.row_data ->> 'id') v.hub, v.view_name, r.row_data, r.sort_rank, r.sort_due
        from views v cross join lateral private.ap_hub_rows(v.hub, c.company_id, c.actor_id, c.role, v.view_name, 'active', null) r)
    select count(*), coalesce((select jsonb_agg(jsonb_build_object('hub', x.hub, 'view', x.view_name, 'id', x.row_data ->> 'id', 'label', x.row_data ->> 'label',
        'status', x.row_data ->> 'status', 'summary', x.row_data ->> 'summary', 'due_date', x.row_data ->> 'due_date',
        'source_href', x.row_data ->> 'source_href', 'href', '/tasks/' || x.hub || '/' || x.view_name || '/' || (x.row_data ->> 'id')) order by x.sort_rank, x.sort_due nulls last, x.row_data ->> 'id')
      from (select * from picked order by sort_rank, sort_due nulls last, row_data ->> 'id' limit greatest(1, least(20, coalesce((p_payload ->> 'limit')::integer, 10))) + 1) x), '[]'::jsonb)
    into v_total, v_items from picked;
    return jsonb_build_object('total_count', v_total, 'items', v_items);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_home_work(text, jsonb) from public, anon;
grant execute on function public.ap_home_work(text, jsonb) to authenticated;

commit;
