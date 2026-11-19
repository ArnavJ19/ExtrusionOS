-- FABLE_SUGGESTIONS FS-82: one business-date service.
--
-- The factory works on India time. Between 00:00 and 05:30 IST the database server's UTC date is the previous day,
-- which is exactly when the night shift is working. This migration:
--   1. makes private.business_today() the one SQL definition of "today in India" (private.ist_today() stays as an
--      alias so the 350+ existing callers keep working and agree with it);
--   2. adds the business date of an instant, the current shift with its shift day (a shift belongs to the date it
--      started on, so the 22:00-06:00 shift that starts on the 18th is the 18th's C shift all night) and the Indian
--      financial year (1 April to 31 March);
--   3. rewrites every live function body that still reads current_date to use private.business_today();
--   4. changes the date-only column defaults that used the server date.
-- tests/fs-batch4-sql.test.mjs fails if a raw current_date returns in a function body or a column default.

create or replace function private.business_timezone()
returns text language sql immutable set search_path = pg_catalog as $$ select 'Asia/Kolkata'::text $$;

create or replace function private.business_today()
returns date language sql stable set search_path = pg_catalog
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function private.ist_today()
returns date language sql stable set search_path = pg_catalog
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function private.business_date_of(p_at timestamptz)
returns date language sql stable set search_path = pg_catalog
as $$ select case when p_at is null then null else (p_at at time zone 'Asia/Kolkata')::date end $$;

-- Financial year start year: April 2026 to March 2027 is 2026. Label "2026-27".
create or replace function private.business_financial_year(p_date date default null)
returns jsonb language sql stable set search_path = pg_catalog, private as $$
  with d as (select coalesce(p_date, private.business_today()) as day),
  y as (select day, case when extract(month from day) >= 4 then extract(year from day)::int else extract(year from day)::int - 1 end as start_year from d)
  select jsonb_build_object(
    'start_year', start_year,
    'label', start_year::text || '-' || lpad(((start_year + 1) % 100)::text, 2, '0'),
    'starts_on', make_date(start_year, 4, 1),
    'ends_on', make_date(start_year + 1, 3, 31))
  from y
$$;

-- The shift running at an instant, from the factory calendar (the same configuration and default as AP-005/AP-010).
-- shift_date is the IST date the shift started on.
create or replace function private.business_shift(p_company uuid, p_at timestamptz default now())
returns table(code text, shift_date date, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
declare r record;
begin
  select * into r from private.ap2_shift_window(p_company, coalesce(p_at, now())) limit 1;
  if r.code is null then return; end if;
  return query select r.code, (r.starts_at at time zone 'Asia/Kolkata')::date, r.starts_at, r.ends_at;
end;
$$;

revoke all on function private.business_timezone() from public;
revoke all on function private.business_today() from public;
revoke all on function private.ist_today() from public;
revoke all on function private.business_date_of(timestamptz) from public;
revoke all on function private.business_financial_year(date) from public;
revoke all on function private.business_shift(uuid, timestamptz) from public, anon, authenticated;
-- Invoker functions and column defaults evaluate these as the calling role, so every role that writes gets execute.
grant usage on schema private to service_role;
grant execute on function private.business_timezone(), private.business_today(), private.ist_today(),
  private.business_date_of(timestamptz), private.business_financial_year(date) to anon, authenticated, service_role;

-- What the application shows as "today", "this shift" and "this financial year". Company from the session.
create or replace function public.business_calendar()
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_company uuid; s record;
begin
  select u.company_id into v_company from public.app_users u where u.id = auth.uid() and u.is_active and u.company_id is not null;
  if v_company is null then raise exception 'Not permitted' using errcode = '42501'; end if;
  select * into s from private.business_shift(v_company, now());
  return jsonb_build_object(
    'time_zone', private.business_timezone(),
    'today', private.business_today(),
    'shift', case when s.code is null then null else jsonb_build_object('code', s.code, 'shift_date', s.shift_date, 'starts_at', s.starts_at, 'ends_at', s.ends_at) end,
    'financial_year', private.business_financial_year(private.business_today()));
end;
$$;
revoke all on function public.business_calendar() from public, anon;
grant execute on function public.business_calendar() to authenticated;

-- Rewrite every function body that reads current_date. pg_get_functiondef keeps the signature, security, search
-- path and volatility; create or replace keeps grants and ownership.
do $$
declare f record; v_def text; v_new text; v_count integer := 0;
begin
  for f in
    select p.oid, n.nspname, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
      and p.prosrc ~* '\mcurrent_date\M'
      and p.proname not in ('business_today', 'ist_today', 'business_date_of', 'business_financial_year')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    v_def := pg_get_functiondef(f.oid);
    v_new := regexp_replace(v_def, '\mcurrent_date\M', 'private.business_today()', 'gi');
    if v_new <> v_def then execute v_new; v_count := v_count + 1; end if;
  end loop;
  raise notice 'FS-82: % function bodies now use private.business_today()', v_count;
end;
$$;

-- Date-only defaults that used the server date.
do $$
declare c record;
begin
  for c in
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and data_type = 'date'
      and (column_default ~* '\mcurrent_date\M' or column_default ~* 'now\(\)\s*::\s*date')
  loop
    execute format('alter table public.%I alter column %I set default private.business_today()', c.table_name, c.column_name);
  end loop;
end;
$$;
