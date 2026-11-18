-- Autopilot batch 8: AP-091, 092, 096, 020, 043, 044, 050, 052, 065 and 069.
-- Additive. Depends on batches 1-7. AP-091 (print selected as one PDF), AP-096 (paper job card), AP-043 (one die module) and
-- AP-044 (one Insights module) are screen, PDF and library changes and need no schema. Nothing here posts stock, money,
-- quality approval or a customer message: certificate readings are drafts a person confirms, alarms and scores are advisory,
-- and capacity is indicative.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap8_round(p numeric, p_digits integer default 1)
returns numeric language sql immutable set search_path = public, private as $$
  select case when p is null then null else trim_scale(round(p, p_digits)) end
$$;
revoke all on function private.ap8_round(numeric, integer) from public, anon, authenticated;

-- Monday of the IST week that contains p_day.
create or replace function private.ap8_week(p_day date)
returns date language sql immutable set search_path = public, private as $$
  select (p_day - (extract(isodow from p_day)::integer - 1))
$$;
revoke all on function private.ap8_week(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-092: named list views per person and page, one of which can be that person's default
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.saved_list_views (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  page_key text not null check (page_key ~ '^[a-z][a-z0-9_]{1,59}$'),
  name text not null check (length(btrim(name)) between 1 and 60 and name !~ '[[:cntrl:]]'),
  query text not null default '' check (length(query) <= 1500 and query ~ '^[A-Za-z0-9_.~%&=+-]*$'),
  is_default boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index if not exists saved_list_views_name_key on public.saved_list_views(company_id, user_id, page_key, lower(btrim(name)));
create unique index if not exists saved_list_views_one_default on public.saved_list_views(company_id, user_id, page_key) where is_default;
create index if not exists saved_list_views_user_idx on public.saved_list_views(company_id, user_id, page_key, updated_at desc);

create or replace function public.ap_views(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page text; v_name text; v_query text; v public.saved_list_views%rowtype; v_rows jsonb;
begin
  select * into c from private.ap_ctx(null);
  if p_command in ('list', 'default', 'save', 'clear_default') then
    v_page := nullif(btrim(coalesce(p_payload ->> 'page_key', '')), '');
    if v_page is null or v_page !~ '^[a-z][a-z0-9_]{1,59}$' then raise exception 'AP: Unknown list page.'; end if;
  end if;
  if p_command = 'list' then
    perform private.ap_keys(p_payload, array['page_key']);
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'query', x.query, 'is_default', x.is_default, 'updated_at', x.updated_at)
      order by x.is_default desc, lower(x.name)), '[]') into v_rows
    from public.saved_list_views x where x.company_id = c.company_id and x.user_id = c.actor_id and x.page_key = v_page;
    return jsonb_build_object('page_key', v_page, 'views', v_rows);
  elsif p_command = 'default' then
    perform private.ap_keys(p_payload, array['page_key']);
    select * into v from public.saved_list_views x where x.company_id = c.company_id and x.user_id = c.actor_id and x.page_key = v_page and x.is_default;
    return case when v.id is null then jsonb_build_object('view', null) else jsonb_build_object('view', jsonb_build_object('id', v.id, 'name', v.name, 'query', v.query)) end;
  elsif p_command = 'save' then
    perform private.ap_keys(p_payload, array['page_key', 'name', 'query', 'make_default']);
    v_name := private.ap_text(p_payload ->> 'name', 'View name', 1, 60);
    v_query := coalesce(p_payload ->> 'query', '');
    if length(v_query) > 1500 or v_query !~ '^[A-Za-z0-9_.~%&=+-]*$' then raise exception 'AP: This view cannot be saved. Reload the page and try again.'; end if;
    select * into v from public.saved_list_views x where x.company_id = c.company_id and x.user_id = c.actor_id and x.page_key = v_page and lower(btrim(x.name)) = lower(v_name) for update;
    if v.id is null and (select count(*) from public.saved_list_views x where x.company_id = c.company_id and x.user_id = c.actor_id and x.page_key = v_page) >= 20 then
      raise exception 'AP: You have 20 saved views on this page. Remove one before saving another.';
    end if;
    if coalesce((p_payload ->> 'make_default')::boolean, false) then
      update public.saved_list_views set is_default = false, updated_at = clock_timestamp()
        where company_id = c.company_id and user_id = c.actor_id and page_key = v_page and is_default and id is distinct from v.id;
    end if;
    if v.id is null then
      insert into public.saved_list_views(company_id, user_id, page_key, name, query, is_default)
        values (c.company_id, c.actor_id, v_page, v_name, v_query, coalesce((p_payload ->> 'make_default')::boolean, false)) returning * into v;
    else
      update public.saved_list_views set query = v_query, name = v_name, updated_at = clock_timestamp(),
        is_default = case when coalesce((p_payload ->> 'make_default')::boolean, false) then true else is_default end
        where id = v.id returning * into v;
    end if;
    return jsonb_build_object('id', v.id, 'name', v.name, 'query', v.query, 'is_default', v.is_default);
  elsif p_command in ('set_default', 'delete') then
    perform private.ap_keys(p_payload, array['id']);
    select * into v from public.saved_list_views x where x.id = private.ap_uuid(p_payload, 'id') and x.company_id = c.company_id and x.user_id = c.actor_id for update;
    if v.id is null then raise exception 'AP: Saved view not found.'; end if;
    if p_command = 'delete' then
      delete from public.saved_list_views where id = v.id;
      return jsonb_build_object('id', v.id, 'deleted', true);
    end if;
    update public.saved_list_views set is_default = false, updated_at = clock_timestamp()
      where company_id = c.company_id and user_id = c.actor_id and page_key = v.page_key and is_default and id <> v.id;
    update public.saved_list_views set is_default = true, updated_at = clock_timestamp() where id = v.id;
    return jsonb_build_object('id', v.id, 'is_default', true);
  elsif p_command = 'clear_default' then
    perform private.ap_keys(p_payload, array['page_key']);
    update public.saved_list_views set is_default = false, updated_at = clock_timestamp()
      where company_id = c.company_id and user_id = c.actor_id and page_key = v_page and is_default;
    return jsonb_build_object('page_key', v_page, 'cleared', true);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_views(text, jsonb) from public, anon;
grant execute on function public.ap_views(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-065: when each die is unavailable, and which planned jobs depend on its return
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.die_availability_windows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  die_id uuid not null,
  reason text not null check (reason in ('nitriding', 'correction', 'maintenance', 'at_vendor', 'trial', 'other')),
  starts_on date not null,
  expected_return date,
  note text check (note is null or (length(btrim(note)) between 3 and 300 and note !~ '[[:cntrl:]]')),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  set_by uuid not null references public.app_users(id),
  set_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.app_users(id),
  updated_at timestamptz,
  closed_by uuid references public.app_users(id),
  closed_at timestamptz,
  close_note text check (close_note is null or length(btrim(close_note)) between 3 and 300),
  check (expected_return is null or expected_return >= starts_on),
  check ((status = 'open') = (closed_at is null)),
  foreign key (company_id, die_id) references public.dies(company_id, id)
);
create unique index if not exists die_availability_one_open on public.die_availability_windows(company_id, die_id) where status = 'open';
create index if not exists die_availability_company_idx on public.die_availability_windows(company_id, status, expected_return);
create index if not exists die_availability_die_idx on public.die_availability_windows(company_id, die_id, set_at desc);

-- Whether the die can run on p_on. An open window or an open returnable pass makes it unavailable until its expected
-- return; once that date has passed without a return, it stays unavailable (highlighted overdue, never assumed back).
create or replace function private.ap8_die_state(p_company uuid, p_die uuid, p_on date)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare d public.dies%rowtype; w public.die_availability_windows%rowtype; g public.returnable_gate_passes%rowtype; v_today date := private.ist_today();
  v_booking public.die_service_bookings%rowtype; v_until date; v_reason text; v_source text;
begin
  select * into d from public.dies where id = p_die and company_id = p_company;
  if d.id is null then return null; end if;
  select * into w from public.die_availability_windows where company_id = p_company and die_id = p_die and status = 'open';
  select * into g from public.returnable_gate_passes where company_id = p_company and die_id = p_die and status in ('approved', 'out') order by created_at desc limit 1;
  select * into v_booking from public.die_service_bookings where company_id = p_company and die_id = p_die and status = 'booked' order by scheduled_for limit 1;
  if d.die_status in ('retired', 'scrapped', 'dead') then
    return jsonb_build_object('state', 'retired', 'reason', d.die_status, 'until', null, 'overdue', false, 'source', 'die_status', 'die_status', d.die_status);
  end if;
  if w.id is not null and w.starts_on <= p_on then
    v_until := w.expected_return; v_reason := w.reason; v_source := 'window';
  elsif g.id is not null and (g.status = 'out' or p_on >= v_today) then
    v_until := g.due_date; v_reason := 'at_vendor'; v_source := 'gate_pass';
  elsif d.die_status in ('nitriding', 'correction', 'under_correction', 'under_maintenance', 'blocked') and p_on <= v_today + 365 then
    v_until := null; v_reason := d.die_status; v_source := 'die_status';
  end if;
  if v_source is not null and (v_until is null or v_until > p_on or v_until < v_today) then
    return jsonb_build_object('state', 'unavailable', 'reason', v_reason, 'until', v_until, 'overdue', v_until is not null and v_until < v_today,
      'source', v_source, 'window_id', w.id, 'pass_id', g.id, 'pass_number', g.pass_number, 'custodian', coalesce(g.custodian_name, null), 'die_status', d.die_status,
      'booking', case when v_booking.id is null then null else jsonb_build_object('service', v_booking.service_event, 'on', v_booking.scheduled_for) end);
  end if;
  return jsonb_build_object('state', 'available', 'reason', null, 'until', null, 'overdue', false, 'source', null, 'die_status', d.die_status,
    'leaves_on', case when w.id is not null and w.starts_on > p_on then w.starts_on end,
    'booking', case when v_booking.id is null then null else jsonb_build_object('service', v_booking.service_event, 'on', v_booking.scheduled_for) end);
end;
$$;
revoke all on function private.ap8_die_state(uuid, uuid, date) from public, anon, authenticated;

create or replace function private.ap8_reason_label(p text)
returns text language sql immutable set search_path = public, private as $$
  select case p when 'nitriding' then 'at nitriding' when 'correction' then 'in correction' when 'under_correction' then 'in correction'
    when 'maintenance' then 'in maintenance' when 'under_maintenance' then 'in maintenance' when 'at_vendor' then 'with a vendor' when 'trial' then 'on trial'
    when 'blocked' then 'blocked' else coalesce(replace(p, '_', ' '), 'unavailable') end
$$;
revoke all on function private.ap8_reason_label(text) from public, anon, authenticated;

-- Warnings for one open job: planned on a day its die is unavailable, a booked service with no return date, or a due
-- date that depends on the die coming back. Empty array when there is nothing to warn about.
create or replace function private.ap8_job_die_warnings(p_company uuid, p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare j public.production_jobs%rowtype; s jsonb; v_due date; v_w jsonb := '[]'; v_die text; v_now jsonb;
begin
  select * into j from public.production_jobs where id = p_job and company_id = p_company;
  if j.id is null or j.die_id is null or j.status not in ('planned', 'ready', 'on_hold') then return '[]'; end if;
  select die_number into v_die from public.dies where id = j.die_id;
  v_due := coalesce((select min(l.due_date) from public.production_job_draft_lines l where l.company_id = p_company and l.job_id = j.id),
    (select o.expected_dispatch_date from public.orders o where o.id = j.order_id and o.company_id = p_company));
  if j.planned_date is not null then
    s := private.ap8_die_state(p_company, j.die_id, j.planned_date);
    if s ->> 'state' in ('unavailable', 'retired') then
      v_w := v_w || jsonb_build_array(jsonb_build_object('code', case when (s ->> 'overdue')::boolean then 'return_overdue' else 'die_unavailable' end,
        'severity', 'warning', 'die_id', j.die_id, 'die_number', v_die, 'planned_date', j.planned_date, 'until', s -> 'until',
        'message', format('Die %s is %s on %s', v_die, private.ap8_reason_label(s ->> 'reason'), to_char(j.planned_date, 'DD Mon')) ||
          case when s ->> 'state' = 'retired' then ' (retired).'
            when (s ->> 'overdue')::boolean then format('; it was due back %s and has not returned.', to_char((s ->> 'until')::date, 'DD Mon'))
            when s ->> 'until' is null then '; no expected return date is recorded.'
            else format('; expected back %s.', to_char((s ->> 'until')::date, 'DD Mon')) end));
    elsif s -> 'booking' is not null and (s -> 'booking' ->> 'on')::date <= j.planned_date then
      v_w := v_w || jsonb_build_array(jsonb_build_object('code', 'service_booked', 'severity', 'info', 'die_id', j.die_id, 'die_number', v_die, 'planned_date', j.planned_date,
        'message', format('Die %s is booked for %s on %s, before this job; record its expected return so the plan can check it.', v_die, s -> 'booking' ->> 'service',
          to_char((s -> 'booking' ->> 'on')::date, 'DD Mon'))));
    end if;
  end if;
  v_now := private.ap8_die_state(p_company, j.die_id, private.ist_today());
  if v_due is not null and v_now ->> 'state' = 'unavailable' and (v_now ->> 'until' is null or (v_now ->> 'until')::date >= v_due or (v_now ->> 'overdue')::boolean) then
    v_w := v_w || jsonb_build_array(jsonb_build_object('code', 'due_depends_on_return', 'severity', 'warning', 'die_id', j.die_id, 'die_number', v_die, 'due_date', v_due,
      'message', format('Due %s depends on die %s coming back', to_char(v_due, 'DD Mon'), v_die) ||
        case when v_now ->> 'until' is null then ' (no expected return date).'
          when (v_now ->> 'overdue')::boolean then format(' (it was due back %s).', to_char((v_now ->> 'until')::date, 'DD Mon'))
          else format(' (expected back %s).', to_char((v_now ->> 'until')::date, 'DD Mon')) end));
  end if;
  return v_w;
end;
$$;
revoke all on function private.ap8_job_die_warnings(uuid, uuid) from public, anon, authenticated;

-- Planners are told once per job; the alert closes itself when the warning clears (AP-098).
create or replace function private.ap8_refresh_job_die_alert(p_company uuid, p_job uuid)
returns integer language plpgsql security definer set search_path = public, private as $$
declare v_w jsonb := private.ap8_job_die_warnings(p_company, p_job); v_key text := 'die-unavailable:' || p_job; v_number text; v_n integer := 0;
begin
  select job_number into v_number from public.production_jobs where id = p_job;
  if exists (select 1 from jsonb_array_elements(v_w) x where x ->> 'severity' = 'warning') then
    v_n := private.ap3_notify_roles(p_company, array['owner', 'admin', 'production_manager', 'factory_manager'], 'die_availability', 'warning',
      'Planned job needs a die that is away: ' || coalesce(v_number, 'job'), (select string_agg(x ->> 'message', ' ') from jsonb_array_elements(v_w) x),
      'production_job', p_job, '/production/' || p_job, v_key, null);
  else
    update public.notifications set resolved_at = clock_timestamp(), resolution = 'Resolved by system: the die is available for this job', is_read = true, read_at = coalesce(read_at, now())
      where company_id = p_company and condition_key = v_key and resolved_at is null;
  end if;
  return v_n;
end;
$$;
revoke all on function private.ap8_refresh_job_die_alert(uuid, uuid) from public, anon, authenticated;

-- Any path that plans a job (schedule, press plan, edit) gets the same check. The alert is advisory: a failure here must
-- never stop the planning change itself, so it is caught and the hourly job retries.
create or replace function private.ap8_job_die_trigger()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  begin
    if new.die_id is not null or (tg_op = 'UPDATE' and old.die_id is not null) then perform private.ap8_refresh_job_die_alert(new.company_id, new.id); end if;
  exception when others then null;
  end;
  return null;
end;
$$;
revoke all on function private.ap8_job_die_trigger() from public, anon, authenticated;
drop trigger if exists zzz_ap8_job_die on public.production_jobs;
create trigger zzz_ap8_job_die after insert or update of planned_date, die_id, status on public.production_jobs
  for each row execute function private.ap8_job_die_trigger();

create or replace function private.ap8_refresh_die_jobs(p_company uuid, p_die uuid)
returns integer language plpgsql security definer set search_path = public, private as $$
declare r record; v integer := 0;
begin
  for r in select id from public.production_jobs where company_id = p_company and die_id = p_die and status in ('planned', 'ready', 'on_hold') loop
    v := v + private.ap8_refresh_job_die_alert(p_company, r.id);
  end loop;
  return v;
end;
$$;
revoke all on function private.ap8_refresh_die_jobs(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap8_availability_job(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare r record; v_n integer := 0; v_a integer := 0;
begin
  for r in select id from public.production_jobs where company_id = p_company and die_id is not null and status in ('planned', 'ready', 'on_hold') loop
    v_n := v_n + 1; v_a := v_a + private.ap8_refresh_job_die_alert(p_company, r.id);
  end loop;
  -- Jobs that left the open states close their alerts too.
  update public.notifications n set resolved_at = clock_timestamp(), resolution = 'Resolved by system: the job is no longer waiting to run', is_read = true, read_at = coalesce(n.read_at, now())
    where n.company_id = p_company and n.condition_key like 'die-unavailable:%' and n.resolved_at is null
      and not exists (select 1 from public.production_jobs j where j.company_id = p_company and 'die-unavailable:' || j.id = n.condition_key and j.status in ('planned', 'ready', 'on_hold'));
  return jsonb_build_object('examined', v_n, 'proposals', 0, 'alerts', v_a);
end;
$$;
revoke all on function private.ap8_availability_job(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap8_window_json(w public.die_availability_windows)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', w.id, 'die_id', w.die_id, 'reason', w.reason, 'starts_on', w.starts_on, 'expected_return', w.expected_return, 'note', w.note,
    'status', w.status, 'set_at', w.set_at, 'set_by', (select full_name from public.app_users where id = w.set_by),
    'updated_at', w.updated_at, 'closed_at', w.closed_at, 'close_note', w.close_note,
    'overdue', w.status = 'open' and w.expected_return is not null and w.expected_return < private.ist_today())
$$;
revoke all on function private.ap8_window_json(public.die_availability_windows) from public, anon, authenticated;

create or replace function public.ap_die_window(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_die uuid; d public.dies%rowtype; w public.die_availability_windows%rowtype; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload);
  v_days integer; v_from date; v_return date; v_ids uuid[];
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager', 'production', 'quality', 'sales_manager', 'sales', 'viewer']);
  if p_command = 'die' then
    perform private.ap_keys(p_payload, array['die_id']);
    select * into d from public.dies where id = private.ap_uuid(p_payload, 'die_id') and company_id = c.company_id;
    if d.id is null then raise exception 'AP: Die not found.'; end if;
    select coalesce(jsonb_agg(private.ap8_window_json(x) order by x.set_at desc), '[]') into v_rows
      from (select * from public.die_availability_windows where company_id = c.company_id and die_id = d.id order by set_at desc limit 10) x;
    return jsonb_build_object('die_id', d.id, 'die_number', d.die_number, 'today', private.ap8_die_state(c.company_id, d.id, private.ist_today()),
      'open', (select private.ap8_window_json(x) from public.die_availability_windows x where x.company_id = c.company_id and x.die_id = d.id and x.status = 'open'),
      'history', v_rows,
      'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'job_number', j.job_number, 'planned_date', j.planned_date, 'status', j.status,
          'warnings', private.ap8_job_die_warnings(c.company_id, j.id)) order by j.planned_date nulls last, j.job_number), '[]')
        from (select * from public.production_jobs where company_id = c.company_id and die_id = d.id and status in ('planned', 'ready', 'on_hold') order by planned_date nulls last limit 20) j),
      'can_edit', c.role in ('owner', 'admin', 'factory_manager', 'production_manager', 'quality'));
  elsif p_command = 'set' then
    perform private.ap_keys(p_payload, array['die_id', 'reason', 'starts_on', 'expected_return', 'note']);
    perform private.ap4_need(c.role, array['owner', 'admin', 'factory_manager', 'production_manager', 'quality']);
    v_die := private.ap_uuid(p_payload, 'die_id');
    select * into d from public.dies where id = v_die and company_id = c.company_id for update;
    if d.id is null then raise exception 'AP: Die not found.'; end if;
    if coalesce(p_payload ->> 'reason', '') not in ('nitriding', 'correction', 'maintenance', 'at_vendor', 'trial', 'other') then raise exception 'AP: Choose why the die is away.'; end if;
    v_from := private.ap7_date(p_payload, 'starts_on');
    v_return := private.ap7_date(p_payload, 'expected_return', false);
    if v_from < private.ist_today() - 60 or v_from > private.ist_today() + 180 then raise exception 'AP: The away-from date must be within 60 days back and 180 days ahead.'; end if;
    if v_return is not null and v_return < v_from then raise exception 'AP: The expected return cannot be before the die leaves.'; end if;
    if v_return is not null and v_return > v_from + 365 then raise exception 'AP: The expected return must be within a year.'; end if;
    select * into w from public.die_availability_windows where company_id = c.company_id and die_id = d.id and status = 'open' for update;
    if w.id is null then
      insert into public.die_availability_windows(company_id, die_id, reason, starts_on, expected_return, note, set_by)
        values (c.company_id, d.id, p_payload ->> 'reason', v_from, v_return, private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id) returning * into w;
    else
      update public.die_availability_windows set reason = p_payload ->> 'reason', starts_on = v_from, expected_return = v_return,
        note = coalesce(private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), note), updated_by = c.actor_id, updated_at = clock_timestamp()
        where id = w.id returning * into w;
    end if;
    perform private.ap8_refresh_die_jobs(c.company_id, d.id);
    return private.ap8_window_json(w) || jsonb_build_object('today', private.ap8_die_state(c.company_id, d.id, private.ist_today()));
  elsif p_command = 'close' then
    perform private.ap_keys(p_payload, array['id', 'note', 'outcome']);
    perform private.ap4_need(c.role, array['owner', 'admin', 'factory_manager', 'production_manager', 'quality']);
    select * into w from public.die_availability_windows where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if w.id is null then raise exception 'AP: Availability record not found.'; end if;
    if w.status <> 'open' then raise exception 'AP: This die is already marked back.'; end if;
    update public.die_availability_windows set status = case when coalesce(p_payload ->> 'outcome', 'closed') = 'cancelled' then 'cancelled' else 'closed' end,
      closed_by = c.actor_id, closed_at = clock_timestamp(), close_note = private.ap_text(p_payload ->> 'note', 'Note', 3, 300)
      where id = w.id returning * into w;
    perform private.ap8_refresh_die_jobs(c.company_id, w.die_id);
    return private.ap8_window_json(w);
  elsif p_command = 'conflicts' then
    perform private.ap_keys(p_payload, array['page', 'days']);
    v_days := coalesce(nullif(p_payload ->> 'days', '')::integer, 14);
    if v_days not between 1 and 60 then raise exception 'AP: Look ahead 1 to 60 days.'; end if;
    with j as (
      select x.id, x.job_number, x.planned_date, x.status, x.die_id, private.ap8_job_die_warnings(c.company_id, x.id) w
      from public.production_jobs x where x.company_id = c.company_id and x.die_id is not null and x.status in ('planned', 'ready', 'on_hold')
        and (x.planned_date is null or x.planned_date <= private.ist_today() + v_days)),
      f as (select j.*, count(*) over () total from j where jsonb_array_length(j.w) > 0 order by j.planned_date nulls last, j.job_number limit 10 offset (v_page - 1) * 10)
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'job_number', f.job_number, 'planned_date', f.planned_date, 'status', f.status, 'die_id', f.die_id,
        'die_number', (select die_number from public.dies where id = f.die_id), 'warnings', f.w) order by f.planned_date nulls last, f.job_number), '[]'), max(f.total)
      into v_rows, v_total from f;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page, 'days', v_days,
      'away', (select count(*) from public.dies x where x.company_id = c.company_id and private.ap8_die_state(c.company_id, x.id, private.ist_today()) ->> 'state' = 'unavailable'),
      'overdue', (select count(*) from public.die_availability_windows x where x.company_id = c.company_id and x.status = 'open' and x.expected_return < private.ist_today())
        + (select count(*) from public.returnable_gate_passes g where g.company_id = c.company_id and g.die_id is not null and g.status = 'out' and g.due_date < private.ist_today()));
  elsif p_command = 'jobs' then
    perform private.ap_keys(p_payload, array['job_ids']);
    if jsonb_typeof(p_payload -> 'job_ids') <> 'array' or jsonb_array_length(p_payload -> 'job_ids') > 200 then raise exception 'AP: Invalid request.'; end if;
    select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(p_payload -> 'job_ids') x where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    select coalesce(jsonb_object_agg(j.id, private.ap8_job_die_warnings(c.company_id, j.id)), '{}') into v_rows
      from public.production_jobs j where j.company_id = c.company_id and j.id = any(coalesce(v_ids, '{}'));
    return jsonb_build_object('warnings', v_rows);
  elsif p_command = 'away' then
    perform private.ap_keys(p_payload, array['page']);
    with a as (select x.id, x.die_number, private.ap8_die_state(c.company_id, x.id, private.ist_today()) s from public.dies x where x.company_id = c.company_id and x.deleted_at is null),
      f as (select a.*, count(*) over () total from a where a.s ->> 'state' = 'unavailable'
        order by (a.s ->> 'overdue')::boolean desc, (a.s ->> 'until')::date nulls first, a.die_number limit 10 offset (v_page - 1) * 10)
    select coalesce(jsonb_agg(jsonb_build_object('die_id', f.id, 'die_number', f.die_number, 'state', f.s) order by (f.s ->> 'overdue')::boolean desc, (f.s ->> 'until')::date nulls first, f.die_number), '[]'), max(f.total)
      into v_rows, v_total from f;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_die_window(text, jsonb) from public, anon;
grant execute on function public.ap_die_window(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-069: booked against available press kg per week for the presses that can run a profile
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.quote_capacity_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid not null,
  profile_id uuid references public.aluminium_profiles(id),
  quantity_kg numeric(14, 3) not null check (quantity_kg > 0 and quantity_kg <= 10000000),
  press_group jsonb not null,
  earliest_week date,
  ready_by date,
  weeks jsonb not null,
  used boolean not null default false,
  checked_by uuid not null references public.app_users(id),
  checked_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, quote_id) references public.quotes(company_id, id)
);
create index if not exists quote_capacity_checks_company_idx on public.quote_capacity_checks(company_id, checked_at desc);
create index if not exists quote_capacity_checks_quote_idx on public.quote_capacity_checks(company_id, quote_id, checked_at desc);

-- The presses that can run a profile: the ones named on the profile, else the ones that ran it in the last year,
-- else every active extrusion press.
create or replace function private.ap8_press_group(p_company uuid, p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_names text[]; v_ids uuid[]; v_basis text;
begin
  if p_profile is not null then
    select array(select lower(btrim(x)) from unnest(coalesce(p.compatible_presses, '{}')) x where btrim(x) <> '') into v_names
      from public.aluminium_profiles p where p.id = p_profile and p.company_id = p_company;
    if cardinality(coalesce(v_names, '{}')) > 0 then
      select array_agg(m.id order by m.machine_name) into v_ids from public.machines m
        where m.company_id = p_company and m.machine_type = 'extrusion_press' and coalesce(m.is_active, true)
          and (lower(m.machine_name) = any(v_names) or lower(coalesce(m.machine_code, '')) = any(v_names));
      if cardinality(coalesce(v_ids, '{}')) > 0 then v_basis := 'profile'; end if;
    end if;
    if v_basis is null then
      select array_agg(distinct j.machine_id) into v_ids from public.production_jobs j join public.machines m on m.id = j.machine_id and coalesce(m.is_active, true)
        where j.company_id = p_company and j.profile_id = p_profile and j.machine_id is not null and j.created_at > clock_timestamp() - interval '365 days';
      if cardinality(coalesce(v_ids, '{}')) > 0 then v_basis := 'history'; end if;
    end if;
  end if;
  if v_basis is null then
    select array_agg(m.id order by m.machine_name) into v_ids from public.machines m
      where m.company_id = p_company and m.machine_type = 'extrusion_press' and coalesce(m.is_active, true);
    v_basis := 'all';
  end if;
  return jsonb_build_object('basis', v_basis, 'machines', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.machine_name) order by m.machine_name)
    from public.machines m where m.id = any(coalesce(v_ids, '{}'))), '[]'));
end;
$$;
revoke all on function private.ap8_press_group(uuid, uuid) from public, anon, authenticated;

-- Shift capacity of the given presses on working days from today, less planned maintenance, by week; booked kg is the
-- remaining planned kg of open jobs on those presses (late jobs count in the current week).
create or replace function private.ap8_capacity_weeks(p_company uuid, p_machines uuid[], p_all boolean, p_weeks integer)
returns jsonb language sql stable security definer set search_path = public, private as $$
  with params as (select private.ist_today() today, private.ap8_week(private.ist_today()) w0),
    days as (select (g)::date d from params, generate_series(params.today, params.w0 + p_weeks * 7 - 1, interval '1 day') g),
    shifts as (
      select dd.d, s.machine_id, s.capacity_kg,
        tstzrange((dd.d + s.starts_local) at time zone 'Asia/Kolkata', ((dd.d + case when s.ends_local <= s.starts_local then 1 else 0 end) + s.ends_local) at time zone 'Asia/Kolkata') r
      from days dd join public.factory_shift_capacities s on s.company_id = p_company and s.machine_id = any(p_machines) and s.weekday = extract(isodow from dd.d)
      where private.factory_is_working_day(p_company, dd.d)),
    avail as (
      select private.ap8_week(sh.d) w, sum(sh.capacity_kg * greatest(0, 1 - coalesce((
        select sum(extract(epoch from upper(sh.r * tstzrange(b.starts_at, b.ends_at))) - extract(epoch from lower(sh.r * tstzrange(b.starts_at, b.ends_at))))
        from public.factory_maintenance_blocks b where b.company_id = p_company and b.machine_id = sh.machine_id and b.status = 'planned' and tstzrange(b.starts_at, b.ends_at) && sh.r), 0)
        / nullif(extract(epoch from upper(sh.r)) - extract(epoch from lower(sh.r)), 0))) kg, count(distinct sh.d) days
      from shifts sh group by 1),
    booked as (
      select greatest(private.ap8_week(j.planned_date), (select w0 from params)) w, sum(greatest(coalesce(j.planned_quantity_kg, 0) - coalesce(j.actual_quantity_kg, 0), 0)) kg
      from public.production_jobs j where j.company_id = p_company and j.status in ('planned', 'ready', 'in_progress', 'on_hold') and j.planned_date is not null
        and (j.machine_id = any(p_machines) or (p_all and j.machine_id is null)) group by 1),
    weeks as (select (params.w0 + n * 7) w from params, generate_series(0, p_weeks - 1) n)
  select coalesce(jsonb_agg(jsonb_build_object('week_start', wk.w, 'available_kg', private.ap8_round(coalesce(a.kg, 0), 0), 'booked_kg', private.ap8_round(coalesce(b.kg, 0), 0),
      'free_kg', private.ap8_round(greatest(coalesce(a.kg, 0) - coalesce(b.kg, 0), 0), 0), 'working_days', coalesce(a.days, 0),
      'load_percent', case when coalesce(a.kg, 0) > 0 then private.ap8_round(coalesce(b.kg, 0) * 100 / a.kg, 0) end) order by wk.w), '[]')
  from weeks wk left join avail a on a.w = wk.w left join booked b on b.w = wk.w
$$;
revoke all on function private.ap8_capacity_weeks(uuid, uuid[], boolean, integer) from public, anon, authenticated;

-- Indicative earliest week: unscheduled work already promised on these presses claims free capacity first, then this quantity.
create or replace function private.ap8_capacity_for(p_company uuid, p_profile uuid, p_kg numeric, p_weeks integer, p_finishing text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare g jsonb := private.ap8_press_group(p_company, p_profile); v_ids uuid[]; v_weeks jsonb; v_backlog numeric; v_left numeric; v_need numeric; w jsonb;
  v_earliest date; v_configured boolean; v_lead integer; v_ready date;
begin
  select array_agg((x ->> 'id')::uuid) into v_ids from jsonb_array_elements(g -> 'machines') x;
  v_ids := coalesce(v_ids, '{}');
  v_configured := exists (select 1 from public.factory_shift_capacities s where s.company_id = p_company and s.machine_id = any(v_ids));
  v_weeks := private.ap8_capacity_weeks(p_company, v_ids, g ->> 'basis' = 'all', p_weeks);
  v_backlog := coalesce((select sum(greatest(coalesce(j.planned_quantity_kg, 0) - coalesce(j.actual_quantity_kg, 0), 0)) from public.production_jobs j
      where j.company_id = p_company and j.status in ('planned', 'ready', 'on_hold') and j.planned_date is null
        and (j.machine_id = any(v_ids) or (j.machine_id is null and (g ->> 'basis' = 'all' or j.profile_id = p_profile)))), 0)
    + coalesce((select sum(l.required_kg) from public.production_job_draft_lines l where l.company_id = p_company and l.status = 'open' and l.job_id is null
        and (g ->> 'basis' = 'all' or l.profile_id = p_profile)), 0);
  v_left := v_backlog; v_need := coalesce(p_kg, 0);
  if v_configured and v_need > 0 then
    for w in select value from jsonb_array_elements(v_weeks) loop
      declare v_free numeric := (w ->> 'free_kg')::numeric; v_use numeric;
      begin
        v_use := least(v_free, v_left); v_left := v_left - v_use; v_free := v_free - v_use;
        if v_left <= 0 then
          v_need := v_need - v_free;
          if v_need <= 0 then v_earliest := (w ->> 'week_start')::date; exit; end if;
        end if;
      end;
    end loop;
  end if;
  select lead_days into v_lead from public.factory_finishing_lead_times where company_id = p_company and finishing_type = coalesce(nullif(p_finishing, ''), 'mill_finish');
  if v_earliest is not null then
    v_ready := case when v_lead is null then null else private.factory_add_working_days(p_company, v_earliest + 6, v_lead) end;
  end if;
  return jsonb_build_object('press_group', g, 'configured', v_configured, 'weeks', v_weeks, 'unscheduled_kg', private.ap8_round(v_backlog, 0),
    'quantity_kg', p_kg, 'earliest_week', v_earliest, 'finishing', coalesce(nullif(p_finishing, ''), 'mill_finish'), 'finishing_lead_days', v_lead, 'ready_by', v_ready,
    'beyond_horizon', v_configured and v_need > 0 and v_earliest is null,
    'note', 'Indicative. The delivery promise still goes through the feasibility check on the order.');
end;
$$;
revoke all on function private.ap8_capacity_for(uuid, uuid, numeric, integer, text) from public, anon, authenticated;


create or replace function public.ap_capacity(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_weeks integer; q public.quotes%rowtype; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); v jsonb; v_profile uuid; v_kg numeric;
  v_id uuid;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'production_manager', 'factory_manager']);
  v_weeks := coalesce(nullif(p_payload ->> 'weeks', '')::integer, 8);
  if v_weeks not between 2 and 16 then raise exception 'AP: Show 2 to 16 weeks.'; end if;
  if p_command = 'profile' then
    perform private.ap_keys(p_payload, array['profile_id', 'quantity_kg', 'finishing_type', 'weeks']);
    v_profile := private.ap_uuid(p_payload, 'profile_id', false);
    if v_profile is not null and not exists (select 1 from public.aluminium_profiles where id = v_profile and company_id = c.company_id) then raise exception 'AP: Profile not found.'; end if;
    return private.ap8_capacity_for(c.company_id, v_profile, private.ap4_num(p_payload, 'quantity_kg', 'Quantity (kg)', 0, 10000000, false), v_weeks,
      private.ap_text(p_payload ->> 'finishing_type', 'Finish', 2, 40, false));
  elsif p_command = 'quote' then
    perform private.ap_keys(p_payload, array['quote_id', 'weeks']);
    select * into q from public.quotes where id = private.ap_uuid(p_payload, 'quote_id') and company_id = c.company_id and deleted_at is null;
    if q.id is null then raise exception 'AP: Quotation not found.'; end if;
    select coalesce(jsonb_agg(private.ap8_capacity_for(c.company_id, l.profile_id, l.kg, v_weeks, l.finishing_type) || jsonb_build_object('profile_id', l.profile_id,
        'profile_code', (select profile_code from public.aluminium_profiles where id = l.profile_id)) order by l.kg desc), '[]') into v_rows
    from (select i.profile_id, max(i.finishing_type) finishing_type, sum(coalesce(i.billing_weight_kg, i.total_weight_kg, i.quantity_kg, 0)) kg
      from public.quote_items i where i.company_id = c.company_id and i.quote_id = q.id group by i.profile_id having sum(coalesce(i.billing_weight_kg, i.total_weight_kg, i.quantity_kg, 0)) > 0) l;
    return jsonb_build_object('quote_id', q.id, 'quote_number', q.quote_number, 'lines', v_rows,
      'last_check', (select jsonb_build_object('earliest_week', x.earliest_week, 'checked_at', x.checked_at, 'used', x.used) from public.quote_capacity_checks x
        where x.company_id = c.company_id and x.quote_id = q.id order by x.checked_at desc limit 1));
  elsif p_command = 'record' then
    perform private.ap_keys(p_payload, array['quote_id', 'profile_id', 'used', 'weeks']);
    select * into q from public.quotes where id = private.ap_uuid(p_payload, 'quote_id') and company_id = c.company_id and deleted_at is null;
    if q.id is null then raise exception 'AP: Quotation not found.'; end if;
    v_profile := private.ap_uuid(p_payload, 'profile_id', false);
    select sum(coalesce(i.billing_weight_kg, i.total_weight_kg, i.quantity_kg, 0)) into v_kg
      from public.quote_items i where i.company_id = c.company_id and i.quote_id = q.id and i.profile_id is not distinct from v_profile;
    if coalesce(v_kg, 0) <= 0 then raise exception 'AP: This quotation has no quantity for that profile.'; end if;
    v := private.ap8_capacity_for(c.company_id, v_profile, v_kg, v_weeks, (select max(i.finishing_type) from public.quote_items i where i.company_id = c.company_id and i.quote_id = q.id and i.profile_id is not distinct from v_profile));
    insert into public.quote_capacity_checks(company_id, quote_id, profile_id, quantity_kg, press_group, earliest_week, ready_by, weeks, used, checked_by)
      values (c.company_id, q.id, v_profile, v_kg, v -> 'press_group', (v ->> 'earliest_week')::date, (v ->> 'ready_by')::date, v -> 'weeks', coalesce((p_payload ->> 'used')::boolean, false), c.actor_id)
      returning id into v_id;
    return v || jsonb_build_object('check_id', v_id);
  elsif p_command = 'accuracy' then
    perform private.ap_keys(p_payload, array['page', 'weeks']);
    -- For quotations that became orders: the week the check indicated against the week the order's last job finished.
    with k as (
      select distinct on (x.quote_id) x.quote_id, x.earliest_week, x.checked_at, x.used from public.quote_capacity_checks x
      where x.company_id = c.company_id order by x.quote_id, x.used desc, x.checked_at desc),
      r as (
        select k.*, qq.quote_number, o.order_number, o.id order_id,
          (select private.ap8_week(max((j.completed_at at time zone 'Asia/Kolkata')::date)) from public.production_jobs j where j.company_id = c.company_id and j.order_id = o.id and j.status = 'completed'
            and not exists (select 1 from public.production_jobs j2 where j2.company_id = c.company_id and j2.order_id = o.id and j2.status in ('planned', 'ready', 'in_progress', 'on_hold'))) done_week
        from k join public.quotes qq on qq.id = k.quote_id join public.orders o on o.quote_id = k.quote_id and o.company_id = c.company_id and o.deleted_at is null),
      f as (select r.*, count(*) over () total from r order by r.checked_at desc limit 10 offset (v_page - 1) * 10)
    select coalesce(jsonb_agg(jsonb_build_object('quote_number', f.quote_number, 'order_number', f.order_number, 'order_id', f.order_id, 'indicated_week', f.earliest_week,
        'completed_week', f.done_week, 'weeks_late', case when f.done_week is not null and f.earliest_week is not null then (f.done_week - f.earliest_week) / 7 end, 'used', f.used) order by f.checked_at desc), '[]'),
      max(f.total) into v_rows, v_total from f;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page,
      'summary', (select jsonb_build_object('compared', count(*), 'on_time', count(*) filter (where d <= 0), 'late', count(*) filter (where d > 0),
        'median_weeks_late', percentile_cont(0.5) within group (order by d)) from (
          select (private.ap8_week(max((j.completed_at at time zone 'Asia/Kolkata')::date)) - k.earliest_week) / 7 d
          from (select distinct on (x.quote_id) x.quote_id, x.earliest_week from public.quote_capacity_checks x where x.company_id = c.company_id and x.earliest_week is not null order by x.quote_id, x.used desc, x.checked_at desc) k
          join public.orders o on o.quote_id = k.quote_id and o.company_id = c.company_id
          join public.production_jobs j on j.order_id = o.id and j.company_id = c.company_id and j.status = 'completed'
          group by k.quote_id, k.earliest_week) z));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_capacity(text, jsonb) from public, anon;
grant execute on function public.ap_capacity(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-050: customer health from order rhythm, volume, payment, complaints and quotation wins
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.customer_health_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null,
  scored_on date not null,
  score integer not null check (score between 0 and 100),
  band text not null check (band in ('healthy', 'watch', 'at_risk')),
  components jsonb not null,
  reasons text[] not null default '{}',
  job_run_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, customer_id, scored_on),
  foreign key (company_id, customer_id) references public.customers(company_id, id)
);
create index if not exists customer_health_latest_idx on public.customer_health_scores(company_id, scored_on desc, score);
create index if not exists customer_health_customer_idx on public.customer_health_scores(company_id, customer_id, scored_on desc);

create table if not exists public.customer_health_followups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null,
  score_id uuid references public.customer_health_scores(id) on delete set null,
  outcome text not null check (outcome in ('called', 'visited', 'messaged', 'not_reachable', 'no_action_needed')),
  note text not null check (length(btrim(note)) between 5 and 300 and note !~ '[[:cntrl:]]'),
  followed_by uuid not null references public.app_users(id),
  followed_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, customer_id) references public.customers(company_id, id)
);
create index if not exists customer_health_followups_idx on public.customer_health_followups(company_id, customer_id, followed_at desc);

-- One customer's score as of p_day. Each component explains itself; too little history costs no points.
create or replace function private.ap8_customer_health(p_company uuid, p_customer uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_dates date[]; v_gap numeric; v_since integer; v_last date; v_recent numeric; v_prior numeric; v_change numeric; v_late_recent numeric; v_late_prior numeric;
  v_overdue integer; v_complaints integer; v_won integer; v_lost integer; f jsonb; vo jsonb; pa jsonb; co jsonb; qu jsonb; v_points integer; v_score integer; v_reasons text[] := '{}';
  v_pen integer;
begin
  -- Order rhythm: the typical gap between order days over the last year, against days since the last order.
  select array_agg(distinct o.order_date order by o.order_date) into v_dates from public.orders o
    where o.company_id = p_company and o.customer_id = p_customer and o.deleted_at is null and o.current_stage <> 'cancelled' and o.order_date between p_day - 365 and p_day;
  v_last := (select max(o.order_date) from public.orders o where o.company_id = p_company and o.customer_id = p_customer and o.deleted_at is null and o.current_stage <> 'cancelled' and o.order_date <= p_day);
  v_since := case when v_last is null then null else p_day - v_last end;
  if cardinality(coalesce(v_dates, '{}')) >= 3 then
    select percentile_cont(0.5) within group (order by g) into v_gap from (select v_dates[i + 1] - v_dates[i] g from generate_subscripts(v_dates, 1) i where i < cardinality(v_dates)) z;
    v_pen := case when v_since <= greatest(v_gap, 1) * 1.25 then 0 when v_since <= greatest(v_gap, 1) * 2 then 15 else 30 end;
    f := jsonb_build_object('points', v_pen, 'max', 30, 'typical_gap_days', private.ap8_round(v_gap, 0), 'days_since', v_since,
      'explain', format('Usually orders every %s days; last order %s days ago.', private.ap8_round(v_gap, 0), v_since));
    if v_pen > 0 then v_reasons := v_reasons || format('No order for %s days; usually orders every %s days', v_since, private.ap8_round(v_gap, 0)); end if;
  else
    f := jsonb_build_object('points', 0, 'max', 30, 'days_since', v_since, 'explain', 'Not enough orders in the last year to know a usual rhythm.');
  end if;
  -- Volume: kg ordered in the last 90 days against the average 90 days of the 270 days before.
  select coalesce(sum(i.quantity_kg) filter (where o.order_date > p_day - 90), 0), coalesce(sum(i.quantity_kg) filter (where o.order_date <= p_day - 90 and o.order_date > p_day - 360), 0) / 3.0
    into v_recent, v_prior from public.orders o join public.order_items i on i.order_id = o.id and i.company_id = o.company_id
    where o.company_id = p_company and o.customer_id = p_customer and o.deleted_at is null and o.current_stage <> 'cancelled' and o.order_date between p_day - 360 and p_day;
  if v_prior > 0 then
    v_change := (v_recent - v_prior) * 100 / v_prior;
    v_pen := case when v_change >= -15 then 0 when v_change >= -40 then 12 else 25 end;
    vo := jsonb_build_object('points', v_pen, 'max', 25, 'recent_kg', private.ap8_round(v_recent, 0), 'usual_kg', private.ap8_round(v_prior, 0), 'change_percent', private.ap8_round(v_change, 0),
      'explain', format('%s kg in the last 90 days against a usual %s kg (%s%%).', private.ap8_round(v_recent, 0), private.ap8_round(v_prior, 0), private.ap8_round(v_change, 0)));
    if v_pen > 0 then v_reasons := v_reasons || format('Volume down %s%% (%s kg in 90 days against a usual %s kg)', private.ap8_round(-v_change, 0), private.ap8_round(v_recent, 0), private.ap8_round(v_prior, 0)); end if;
  else
    vo := jsonb_build_object('points', 0, 'max', 25, 'recent_kg', private.ap8_round(v_recent, 0), 'explain', 'No earlier volume to compare with.');
  end if;
  -- Payment: days late on invoices paid in the last 90 days against the year before, and the oldest open overdue invoice.
  select avg(greatest(i.paid_date - i.due_date, 0)) filter (where i.paid_date > p_day - 90), avg(greatest(i.paid_date - i.due_date, 0)) filter (where i.paid_date <= p_day - 90 and i.paid_date > p_day - 365)
    into v_late_recent, v_late_prior from public.invoices i
    where i.company_id = p_company and i.customer_id = p_customer and i.deleted_at is null and i.paid_date is not null and i.due_date is not null and i.paid_date between p_day - 365 and p_day;
  select max(p_day - i.due_date) into v_overdue from public.invoices i
    where i.company_id = p_company and i.customer_id = p_customer and i.deleted_at is null and coalesce(i.balance_due, 0) > 0.5 and i.due_date < p_day and i.status not in ('cancelled', 'void', 'draft');
  v_pen := case when coalesce(v_overdue, 0) > 60 then 25 when coalesce(v_overdue, 0) > 30 then 15 else 0 end
    + case when v_late_recent is not null and v_late_prior is not null and v_late_recent - v_late_prior > 15 then 10 else 0 end;
  v_pen := least(v_pen, 25);
  pa := jsonb_build_object('points', v_pen, 'max', 25, 'oldest_overdue_days', v_overdue, 'avg_days_late_recent', private.ap8_round(v_late_recent, 0), 'avg_days_late_before', private.ap8_round(v_late_prior, 0),
    'explain', concat_ws(' ', case when v_overdue is not null and v_overdue > 0 then format('Oldest unpaid invoice is %s days overdue.', v_overdue) else 'Nothing overdue.' end,
      case when v_late_recent is not null then format('Paid %s days late on average recently', private.ap8_round(v_late_recent, 0)) ||
        case when v_late_prior is not null then format(' (%s before).', private.ap8_round(v_late_prior, 0)) else '.' end end));
  if coalesce(v_overdue, 0) > 30 then v_reasons := v_reasons || format('Invoice overdue by %s days', v_overdue); end if;
  if v_late_recent is not null and v_late_prior is not null and v_late_recent - v_late_prior > 15 then
    v_reasons := v_reasons || format('Paying slower: %s days late against %s before', private.ap8_round(v_late_recent, 0), private.ap8_round(v_late_prior, 0));
  end if;
  -- Complaints in the last 90 days.
  select count(*) into v_complaints from public.customer_complaints x where x.company_id = p_company and x.customer_id = p_customer and x.logged_at > (p_day - 90)::timestamp at time zone 'Asia/Kolkata';
  v_pen := case when v_complaints >= 2 then 10 when v_complaints = 1 then 5 else 0 end;
  co := jsonb_build_object('points', v_pen, 'max', 10, 'complaints_90_days', v_complaints, 'explain', format('%s complaint(s) in the last 90 days.', v_complaints));
  if v_complaints > 0 then v_reasons := v_reasons || format('%s complaint(s) in 90 days', v_complaints); end if;
  -- Quotation wins over the last 180 days (decided quotations only).
  select count(*) filter (where q.status in ('converted_to_order', 'customer_approved')), count(*) filter (where q.status in ('customer_rejected', 'expired'))
    into v_won, v_lost from public.quotes q where q.company_id = p_company and q.customer_id = p_customer and q.deleted_at is null and q.quote_date between p_day - 180 and p_day;
  if v_won + v_lost >= 3 then
    v_pen := case when v_won * 100 < 30 * (v_won + v_lost) then 10 when v_won * 100 < 50 * (v_won + v_lost) then 5 else 0 end;
    qu := jsonb_build_object('points', v_pen, 'max', 10, 'won', v_won, 'lost', v_lost, 'explain', format('Won %s of %s decided quotations in 180 days.', v_won, v_won + v_lost));
    if v_pen > 0 then v_reasons := v_reasons || format('Won only %s of %s quotations', v_won, v_won + v_lost); end if;
  else
    qu := jsonb_build_object('points', 0, 'max', 10, 'won', v_won, 'lost', v_lost, 'explain', 'Fewer than three decided quotations in 180 days.');
  end if;
  v_points := (f ->> 'points')::integer + (vo ->> 'points')::integer + (pa ->> 'points')::integer + (co ->> 'points')::integer + (qu ->> 'points')::integer;
  v_score := greatest(0, 100 - v_points);
  return jsonb_build_object('score', v_score, 'band', case when v_score >= 80 then 'healthy' when v_score >= 60 then 'watch' else 'at_risk' end, 'reasons', to_jsonb(v_reasons),
    'components', jsonb_build_object('frequency', f, 'volume', vo, 'payment', pa, 'complaints', co, 'quotes', qu));
end;
$$;
revoke all on function private.ap8_customer_health(uuid, uuid, date) from public, anon, authenticated;

-- Scores as of p_day (the job passes today; tests pass a chosen day).
create or replace function private.ap8_health_run(p_company uuid, p_run uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare r record; v jsonb; v_today date := p_day; v_n integer := 0; v_risk integer; v_alerts integer := 0;
begin
  for r in select cu.id from public.customers cu where cu.company_id = p_company and cu.deleted_at is null and coalesce(cu.is_active, true)
      and exists (select 1 from public.orders o where o.company_id = p_company and o.customer_id = cu.id and o.deleted_at is null and o.order_date > v_today - 365) loop
    v := private.ap8_customer_health(p_company, r.id, v_today);
    insert into public.customer_health_scores(company_id, customer_id, scored_on, score, band, components, reasons, job_run_id)
      values (p_company, r.id, v_today, (v ->> 'score')::integer, v ->> 'band', v -> 'components', array(select jsonb_array_elements_text(v -> 'reasons')), p_run)
      on conflict (company_id, customer_id, scored_on) do update set score = excluded.score, band = excluded.band, components = excluded.components, reasons = excluded.reasons,
        job_run_id = excluded.job_run_id, created_at = clock_timestamp();
    v_n := v_n + 1;
  end loop;
  -- Monday: sales is told how many customers are at risk this week (once per week).
  if extract(isodow from v_today) = 1 then
    select count(*) into v_risk from public.customer_health_scores s where s.company_id = p_company and s.scored_on = v_today and s.band = 'at_risk';
    if v_risk > 0 then
      v_alerts := private.ap3_notify_roles(p_company, array['owner', 'sales_manager', 'sales'], 'customer_health', 'warning',
        format('%s customer(s) at risk this week', v_risk), 'Open CRM to see the ten customers most at risk and why. Record each follow-up.', 'customer', null, '/crm#at-risk',
        'customer-health:' || to_char(v_today, 'IYYY-IW'), null);
    end if;
  end if;
  return jsonb_build_object('examined', v_n, 'proposals', 0, 'alerts', v_alerts);
end;
$$;
revoke all on function private.ap8_health_run(uuid, uuid, date) from public, anon, authenticated;

create or replace function private.ap8_health_job(p_company uuid, p_run uuid)
returns jsonb language sql security definer set search_path = public, private as $$
  select private.ap8_health_run(p_company, p_run, private.ist_today())
$$;
revoke all on function private.ap8_health_job(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_customer_health(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); v_customer uuid; v_band text; v_search text; s public.customer_health_scores%rowtype;
  v_id uuid; v_as_of date;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales']);
  v_as_of := (select max(x.scored_on) from public.customer_health_scores x where x.company_id = c.company_id);
  if p_command = 'at_risk' then
    perform private.ap_keys(p_payload, array['page', 'band', 'search']);
    v_band := coalesce(nullif(p_payload ->> 'band', ''), 'at_risk');
    if v_band not in ('at_risk', 'watch', 'healthy', 'all') then raise exception 'AP: Choose a band.'; end if;
    v_search := nullif(btrim(coalesce(p_payload ->> 'search', '')), '');
    if v_search is not null then v_search := '%' || replace(replace(replace(left(v_search, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
    with l as (
      select distinct on (x.customer_id) x.* from public.customer_health_scores x where x.company_id = c.company_id and x.scored_on > coalesce(v_as_of, private.ist_today()) - 8
      order by x.customer_id, x.scored_on desc),
      f as (select l.*, cu.customer_name, cu.company_name, count(*) over () total from l join public.customers cu on cu.id = l.customer_id
        where (v_band = 'all' or l.band = v_band) and (v_search is null or cu.customer_name ilike v_search or coalesce(cu.company_name, '') ilike v_search)
        order by l.score, cu.customer_name limit 10 offset (v_page - 1) * 10)
    select coalesce(jsonb_agg(jsonb_build_object('customer_id', f.customer_id, 'customer', coalesce(nullif(btrim(f.company_name), ''), f.customer_name), 'score', f.score, 'band', f.band,
        'reasons', to_jsonb(f.reasons), 'scored_on', f.scored_on,
        'previous_score', (select p.score from public.customer_health_scores p where p.company_id = c.company_id and p.customer_id = f.customer_id and p.scored_on <= f.scored_on - 28 order by p.scored_on desc limit 1),
        'last_follow_up', (select jsonb_build_object('outcome', u.outcome, 'note', u.note, 'at', u.followed_at, 'by', (select full_name from public.app_users where id = u.followed_by))
          from public.customer_health_followups u where u.company_id = c.company_id and u.customer_id = f.customer_id order by u.followed_at desc limit 1)) order by f.score, f.customer_name), '[]'),
      max(f.total) into v_rows, v_total from f;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page, 'as_of', v_as_of, 'can_score', c.role in ('owner', 'admin', 'sales_manager'),
      'counts', (select jsonb_build_object('at_risk', count(*) filter (where band = 'at_risk'), 'watch', count(*) filter (where band = 'watch'), 'healthy', count(*) filter (where band = 'healthy'))
        from (select distinct on (x.customer_id) x.band from public.customer_health_scores x where x.company_id = c.company_id and x.scored_on > coalesce(v_as_of, private.ist_today()) - 8 order by x.customer_id, x.scored_on desc) z));
  elsif p_command = 'customer' then
    perform private.ap_keys(p_payload, array['customer_id']);
    v_customer := private.ap_uuid(p_payload, 'customer_id');
    if not exists (select 1 from public.customers where id = v_customer and company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    select * into s from public.customer_health_scores where company_id = c.company_id and customer_id = v_customer order by scored_on desc limit 1;
    return jsonb_build_object('customer_id', v_customer, 'latest', case when s.id is null then null else jsonb_build_object('id', s.id, 'score', s.score, 'band', s.band, 'scored_on', s.scored_on,
        'components', s.components, 'reasons', to_jsonb(s.reasons)) end,
      'months', (select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'score', m.score, 'band', m.band) order by m.month), '[]') from (
        select distinct on (date_trunc('month', x.scored_on)) date_trunc('month', x.scored_on)::date as month, x.score, x.band from public.customer_health_scores x
        where x.company_id = c.company_id and x.customer_id = v_customer and x.scored_on > private.ist_today() - 190 order by date_trunc('month', x.scored_on), x.scored_on desc) m),
      'follow_ups', (select coalesce(jsonb_agg(jsonb_build_object('outcome', u.outcome, 'note', u.note, 'at', u.followed_at, 'by', (select full_name from public.app_users where id = u.followed_by)) order by u.followed_at desc), '[]')
        from (select * from public.customer_health_followups where company_id = c.company_id and customer_id = v_customer order by followed_at desc limit 5) u));
  elsif p_command = 'follow_up' then
    perform private.ap_keys(p_payload, array['customer_id', 'outcome', 'note']);
    v_customer := private.ap_uuid(p_payload, 'customer_id');
    if not exists (select 1 from public.customers where id = v_customer and company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    if coalesce(p_payload ->> 'outcome', '') not in ('called', 'visited', 'messaged', 'not_reachable', 'no_action_needed') then raise exception 'AP: Choose what was done.'; end if;
    insert into public.customer_health_followups(company_id, customer_id, score_id, outcome, note, followed_by)
      values (c.company_id, v_customer, (select id from public.customer_health_scores where company_id = c.company_id and customer_id = v_customer order by scored_on desc limit 1),
        p_payload ->> 'outcome', private.ap_text(p_payload ->> 'note', 'Note', 5, 300), c.actor_id) returning id into v_id;
    return jsonb_build_object('id', v_id);
  elsif p_command = 'score_now' then
    perform private.ap_keys(p_payload, array[]::text[]);
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager']);
    return private.ap8_health_job(c.company_id, null);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_customer_health(text, jsonb) from public, anon;
grant execute on function public.ap_customer_health(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-052: control charts per characteristic and die (or finish), with limits from the approved plan
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.spc_alarms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.inspection_plan_items(id),
  chart_key text not null check (length(chart_key) between 3 and 200),
  subgroup text not null check (length(subgroup) between 3 and 80),
  characteristic text not null,
  rule text not null check (rule in ('outside_limits', 'run_of_seven')),
  reading_at timestamptz not null,
  reading_value numeric(14, 4) not null,
  limits jsonb not null,
  status text not null default 'open' check (status in ('open', 'reviewed')),
  review_outcome text check (review_outcome in ('process_adjusted', 'die_sent_for_correction', 'measurement_error', 'no_action_needed')),
  review_note text check (review_note is null or (length(btrim(review_note)) between 5 and 300 and review_note !~ '[[:cntrl:]]')),
  reviewed_by uuid references public.app_users(id),
  reviewed_at timestamptz,
  raised_at timestamptz not null default clock_timestamp(),
  check ((status = 'reviewed') = (reviewed_at is not null))
);
create unique index if not exists spc_alarms_one_open on public.spc_alarms(company_id, chart_key, subgroup, rule) where status = 'open';
create index if not exists spc_alarms_company_idx on public.spc_alarms(company_id, status, raised_at desc);

-- Active characteristics: numeric items on approved plans. The lineage key joins readings recorded against earlier versions
-- of the same plan (same profile, characteristic and unit); limits always come from the current approved item.
create or replace function private.ap8_spc_items(p_company uuid)
returns table(item_id uuid, chart_key text, profile_id uuid, characteristic text, unit text, nominal numeric, lower_limit numeric, upper_limit numeric, plan_version integer)
language sql stable security definer set search_path = public, private as $$
  select i.id, coalesce(p.profile_id::text, 'default') || '|' || lower(btrim(i.characteristic)) || '|' || i.unit, p.profile_id, i.characteristic, i.unit, i.nominal, i.lower_limit, i.upper_limit, p.version
  from public.inspection_plans p join public.inspection_plan_items i on i.plan_id = p.id
  where p.company_id = p_company and p.status = 'approved' and i.unit <> 'visual'
$$;
revoke all on function private.ap8_spc_items(uuid) from public, anon, authenticated;

-- Readings of one chart key: inspection results and triggered samples, from any version of the plan lineage.
create or replace function private.ap8_spc_readings(p_company uuid, p_chart_key text)
returns table(value numeric, read_at timestamptz, die_id uuid, finishing_type text, source text, job_id uuid)
language sql stable security definer set search_path = public, private as $$
  select r.observed, coalesce(q.inspection_date, r.recorded_at), j.die_id, coalesce(j.finishing_type, 'mill_finish'), 'inspection', j.id
  from public.inspection_results r join public.inspection_plan_items i on i.id = r.item_id join public.inspection_plans p on p.id = i.plan_id
    join public.quality_inspections q on q.id = r.inspection_id left join public.production_jobs j on j.id = q.production_job_id
  where r.company_id = p_company and p.company_id = p_company and r.observed is not null
    and coalesce(p.profile_id::text, 'default') || '|' || lower(btrim(i.characteristic)) || '|' || i.unit = p_chart_key
  union all
  select s.observed, s.recorded_at, j.die_id, coalesce(j.finishing_type, 'mill_finish'), 'sample', j.id
  from public.qc_sample_results s join public.qc_sample_requirements rq on rq.id = s.requirement_id join public.inspection_plan_items i on i.id = s.item_id
    join public.inspection_plans p on p.id = i.plan_id left join public.production_jobs j on j.id = rq.production_job_id
  where s.company_id = p_company and p.company_id = p_company and s.observed is not null
    and coalesce(p.profile_id::text, 'default') || '|' || lower(btrim(i.characteristic)) || '|' || i.unit = p_chart_key
$$;
revoke all on function private.ap8_spc_readings(uuid, text) from public, anon, authenticated;

-- Coating thickness (micron) is charted per finish line; every other characteristic per die.
create or replace function private.ap8_spc_subgroup(p_unit text, p_die uuid, p_finish text)
returns text language sql immutable set search_path = public, private as $$
  select case when p_unit = 'micron' then 'finish:' || coalesce(p_finish, 'mill_finish') when p_die is null then 'die:none' else 'die:' || p_die end
$$;
revoke all on function private.ap8_spc_subgroup(text, uuid, text) from public, anon, authenticated;

-- One chart: the last 50 readings in time order with limits, centre, mean, sigma, Cpk and the two rules.
create or replace function private.ap8_spc_chart(p_company uuid, p_item uuid, p_subgroup text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare it record; v_points jsonb; v_center numeric; v_mean numeric; v_sd numeric; v_n integer; v_last jsonb; v_run integer := 0; v_side integer; v_rules jsonb := '[]';
  v_cpk numeric; v_label text;
begin
  select * into it from private.ap8_spc_items(p_company) x where x.item_id = p_item;
  if it.item_id is null then return null; end if;
  v_center := coalesce(it.nominal, (it.lower_limit + it.upper_limit) / 2, it.lower_limit, it.upper_limit);
  select coalesce(jsonb_agg(jsonb_build_object('value', z.value, 'at', z.read_at, 'source', z.source, 'job_id', z.job_id,
      'outside', (it.lower_limit is not null and z.value < it.lower_limit) or (it.upper_limit is not null and z.value > it.upper_limit)) order by z.read_at), '[]'),
    count(*), avg(z.value), stddev_samp(z.value)
    into v_points, v_n, v_mean, v_sd
  from (select r.* from private.ap8_spc_readings(p_company, it.chart_key) r where private.ap8_spc_subgroup(it.unit, r.die_id, r.finishing_type) = p_subgroup order by r.read_at desc limit 50) z;
  if v_n > 0 then
    v_last := v_points -> (v_n - 1);
    if (v_last ->> 'outside')::boolean then
      v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'outside_limits', 'at', v_last -> 'at', 'value', v_last -> 'value',
        'message', format('Latest reading %s %s is outside the plan limits.', trim_scale((v_last ->> 'value')::numeric), it.unit)));
    end if;
    -- Run of seven: the last seven readings all on one side of the centre line.
    if v_n >= 7 then
      select count(*) filter (where (x ->> 'value')::numeric > v_center), count(*) filter (where (x ->> 'value')::numeric < v_center) into v_run, v_side
        from (select v_points -> i x from generate_series(v_n - 7, v_n - 1) i) s;
      if v_run = 7 or v_side = 7 then
        v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'run_of_seven', 'at', v_last -> 'at', 'value', v_last -> 'value',
          'message', format('Seven readings in a row are %s the centre line (%s %s): the process has shifted.', case when v_run = 7 then 'above' else 'below' end, trim_scale(v_center), it.unit)));
      end if;
    end if;
  end if;
  if v_n >= 2 and coalesce(v_sd, 0) > 0 and it.lower_limit is not null and it.upper_limit is not null then
    v_cpk := least(it.upper_limit - v_mean, v_mean - it.lower_limit) / (3 * v_sd);
  end if;
  if p_subgroup like 'die:%' and p_subgroup <> 'die:none' then
    select 'Die ' || die_number into v_label from public.dies where id = substr(p_subgroup, 5)::uuid and company_id = p_company;
  elsif p_subgroup = 'die:none' then v_label := 'No die recorded';
  else v_label := initcap(replace(substr(p_subgroup, 8), '_', ' '));
  end if;
  return jsonb_build_object('item_id', it.item_id, 'chart_key', it.chart_key, 'subgroup', p_subgroup, 'subgroup_label', coalesce(v_label, p_subgroup),
    'characteristic', it.characteristic, 'unit', it.unit, 'profile_id', it.profile_id, 'profile_code', (select profile_code from public.aluminium_profiles where id = it.profile_id),
    'plan_version', it.plan_version, 'nominal', it.nominal, 'lower_limit', it.lower_limit, 'upper_limit', it.upper_limit, 'center', v_center,
    'points', v_points, 'count', v_n, 'mean', private.ap8_round(v_mean, 4), 'sigma', private.ap8_round(v_sd, 4), 'cpk', private.ap8_round(v_cpk, 2), 'rules', v_rules,
    'open_alarms', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'rule', a.rule, 'raised_at', a.raised_at) order by a.raised_at desc), '[]') from public.spc_alarms a
      where a.company_id = p_company and a.chart_key = it.chart_key and a.subgroup = p_subgroup and a.status = 'open'));
end;
$$;
revoke all on function private.ap8_spc_chart(uuid, uuid, text) from public, anon, authenticated;

-- Every chart of the company: active items, with the subgroups that have readings (or one empty chart).
create or replace function private.ap8_spc_keys(p_company uuid)
returns table(item_id uuid, chart_key text, subgroup text, characteristic text, profile_id uuid, last_at timestamptz, readings bigint)
language sql stable security definer set search_path = public, private as $$
  with it as (select * from private.ap8_spc_items(p_company)),
    g as (select it.item_id, it.chart_key, private.ap8_spc_subgroup(it.unit, r.die_id, r.finishing_type) subgroup, max(r.read_at) last_at, count(*) n
      from it cross join lateral private.ap8_spc_readings(p_company, it.chart_key) r group by 1, 2, 3)
  select it.item_id, it.chart_key, coalesce(g.subgroup, case when it.unit = 'micron' then 'finish:mill_finish' else 'die:none' end), it.characteristic, it.profile_id, g.last_at, coalesce(g.n, 0)
  from it left join g on g.item_id = it.item_id
$$;
revoke all on function private.ap8_spc_keys(uuid) from public, anon, authenticated;

create or replace function private.ap8_spc_job(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare k record; ch jsonb; r jsonb; v_n integer := 0; v_a integer := 0; v_id uuid;
begin
  for k in select * from private.ap8_spc_keys(p_company) where readings > 0 and last_at > clock_timestamp() - interval '30 days' loop
    v_n := v_n + 1;
    ch := private.ap8_spc_chart(p_company, k.item_id, k.subgroup);
    for r in select value from jsonb_array_elements(ch -> 'rules') loop
      if exists (select 1 from public.spc_alarms a where a.company_id = p_company and a.chart_key = k.chart_key and a.subgroup = k.subgroup and a.rule = r ->> 'rule' and a.status = 'open') then continue; end if;
      -- A reviewed alarm on the same reading is not raised again.
      if exists (select 1 from public.spc_alarms a where a.company_id = p_company and a.chart_key = k.chart_key and a.subgroup = k.subgroup and a.rule = r ->> 'rule'
        and a.reading_at >= (r ->> 'at')::timestamptz) then continue; end if;
      insert into public.spc_alarms(company_id, item_id, chart_key, subgroup, characteristic, rule, reading_at, reading_value, limits)
        values (p_company, k.item_id, k.chart_key, k.subgroup, ch ->> 'characteristic', r ->> 'rule', (r ->> 'at')::timestamptz, (r ->> 'value')::numeric,
          jsonb_build_object('lower', ch -> 'lower_limit', 'upper', ch -> 'upper_limit', 'center', ch -> 'center', 'unit', ch -> 'unit'))
        returning id into v_id;
      v_a := v_a + private.ap3_notify_roles(p_company, array['owner', 'quality', 'production_manager'], 'spc_alarm', 'warning',
        format('%s drifting: %s', ch ->> 'characteristic', ch ->> 'subgroup_label'), r ->> 'message', 'spc_alarm', v_id, '/quality#spc-alarms', 'spc:' || v_id, null);
    end loop;
  end loop;
  return jsonb_build_object('examined', v_n, 'proposals', 0, 'alerts', v_a);
end;
$$;
revoke all on function private.ap8_spc_job(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_spc(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); v_search text; v_state text; v_die uuid; a public.spc_alarms%rowtype;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'quality', 'production_manager', 'factory_manager']);
  if p_command = 'charts' then
    perform private.ap_keys(p_payload, array['page', 'search', 'state', 'die_id']);
    v_state := coalesce(nullif(p_payload ->> 'state', ''), 'all');
    if v_state not in ('all', 'alarm') then raise exception 'AP: Choose all charts or charts with alarms.'; end if;
    v_die := private.ap_uuid(p_payload, 'die_id', false);
    v_search := nullif(btrim(coalesce(p_payload ->> 'search', '')), '');
    with k as (select x.*, exists (select 1 from public.spc_alarms al where al.company_id = c.company_id and al.chart_key = x.chart_key and al.subgroup = x.subgroup and al.status = 'open') alarm
        from private.ap8_spc_keys(c.company_id) x
        where (v_die is null or x.subgroup = 'die:' || v_die)
          and (v_search is null or x.characteristic ilike '%' || replace(replace(left(v_search, 80), '%', ''), '_', '') || '%'
            or exists (select 1 from public.aluminium_profiles p where p.id = x.profile_id and p.profile_code ilike '%' || replace(replace(left(v_search, 80), '%', ''), '_', '') || '%'))),
      f as (select k.*, count(*) over () total from k where v_state = 'all' or k.alarm order by k.alarm desc, k.last_at desc nulls last, k.characteristic limit 10 offset (v_page - 1) * 10)
    select coalesce(jsonb_agg(private.ap8_spc_chart(c.company_id, f.item_id, f.subgroup) order by f.alarm desc, f.last_at desc nulls last, f.characteristic), '[]'), max(f.total)
      into v_rows, v_total from f;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page,
      'active_characteristics', (select count(*) from private.ap8_spc_items(c.company_id)),
      'open_alarms', (select count(*) from public.spc_alarms where company_id = c.company_id and status = 'open'));
  elsif p_command = 'chart' then
    perform private.ap_keys(p_payload, array['item_id', 'subgroup']);
    if coalesce(p_payload ->> 'subgroup', '') !~ '^(die:([0-9a-f-]{36}|none)|finish:[a-z_]{2,40})$' then raise exception 'AP: Unknown chart.'; end if;
    v_rows := private.ap8_spc_chart(c.company_id, private.ap_uuid(p_payload, 'item_id'), p_payload ->> 'subgroup');
    if v_rows is null then raise exception 'AP: Chart not found.'; end if;
    return v_rows;
  elsif p_command = 'alarms' then
    perform private.ap_keys(p_payload, array['page', 'status']);
    if coalesce(p_payload ->> 'status', 'open') not in ('open', 'reviewed') then raise exception 'AP: Choose open or reviewed alarms.'; end if;
    with f as (select al.*, count(*) over () total from public.spc_alarms al where al.company_id = c.company_id and al.status = coalesce(p_payload ->> 'status', 'open')
      order by al.raised_at desc limit 10 offset (v_page - 1) * 10)
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'item_id', f.item_id, 'subgroup', f.subgroup, 'characteristic', f.characteristic, 'rule', f.rule, 'reading_at', f.reading_at,
        'reading_value', f.reading_value, 'limits', f.limits, 'status', f.status, 'raised_at', f.raised_at, 'review_outcome', f.review_outcome, 'review_note', f.review_note, 'reviewed_at', f.reviewed_at,
        'reviewed_by', (select full_name from public.app_users where id = f.reviewed_by),
        'subgroup_label', case when f.subgroup like 'die:%' and f.subgroup <> 'die:none' then (select 'Die ' || die_number from public.dies where id = substr(f.subgroup, 5)::uuid)
          when f.subgroup = 'die:none' then 'No die recorded' else initcap(replace(substr(f.subgroup, 8), '_', ' ')) end) order by f.raised_at desc), '[]'),
      max(f.total) into v_rows, v_total from f;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page, 'can_review', c.role in ('owner', 'admin', 'quality'));
  elsif p_command = 'review' then
    perform private.ap_keys(p_payload, array['id', 'outcome', 'note']);
    perform private.ap4_need(c.role, array['owner', 'admin', 'quality']);
    select * into a from public.spc_alarms where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if a.id is null then raise exception 'AP: Alarm not found.'; end if;
    if a.status <> 'open' then raise exception 'AP: This alarm was already reviewed.'; end if;
    if coalesce(p_payload ->> 'outcome', '') not in ('process_adjusted', 'die_sent_for_correction', 'measurement_error', 'no_action_needed') then raise exception 'AP: Choose what the review found.'; end if;
    update public.spc_alarms set status = 'reviewed', review_outcome = p_payload ->> 'outcome', review_note = private.ap_text(p_payload ->> 'note', 'Review note', 5, 300),
      reviewed_by = c.actor_id, reviewed_at = clock_timestamp() where id = a.id;
    update public.notifications set resolved_at = clock_timestamp(), resolution = 'Reviewed by quality', is_read = true, read_at = coalesce(read_at, now())
      where company_id = c.company_id and condition_key = 'spc:' || a.id and resolved_at is null;
    return jsonb_build_object('id', a.id, 'status', 'reviewed');
  elsif p_command = 'check' then
    perform private.ap_keys(p_payload, array[]::text[]);
    perform private.ap4_need(c.role, array['owner', 'admin', 'quality']);
    return private.ap8_spc_job(c.company_id, null);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_spc(text, jsonb) from public, anon;
grant execute on function public.ap_spc(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-020: billet mill test certificates read into a draft, checked against the alloy specification
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.mtc_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  heat_labels text[] not null default '{}' check (cardinality(heat_labels) <= 10),
  alloy_labels text[] not null default '{}' check (cardinality(alloy_labels) <= 10),
  element_order text[] not null default '{}' check (element_order <@ array['Si', 'Fe', 'Cu', 'Mn', 'Mg', 'Zn', 'Ti', 'Cr', 'Al', 'Others']),
  decimal_comma boolean not null default false,
  note text check (note is null or length(btrim(note)) between 3 and 300),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, vendor_id)
);

create table if not exists public.billet_certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  receipt_line_id uuid,
  billet_batch_id uuid,
  vendor_id uuid references public.vendors(id),
  file_name text not null check (length(btrim(file_name)) between 1 and 200 and file_name !~ '[[:cntrl:]]'),
  storage_path text not null check (length(storage_path) between 10 and 400 and storage_path !~ '(\.\.|[[:cntrl:]])'),
  mime_type text check (mime_type is null or mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
  source_kind text not null check (source_kind in ('pdf_text', 'pdf_no_text', 'photo', 'pasted_text')),
  extracted jsonb not null default '{}' check (jsonb_typeof(extracted) = 'object'),
  heat_number text check (heat_number is null or (length(btrim(heat_number)) between 2 and 40 and heat_number !~ '[[:cntrl:]]')),
  alloy text check (alloy is null or alloy ~ '^[0-9]{4}[A-Z]?$'),
  si numeric(8, 4) check (si between 0 and 100), fe numeric(8, 4) check (fe between 0 and 100), cu numeric(8, 4) check (cu between 0 and 100),
  mn numeric(8, 4) check (mn between 0 and 100), mg numeric(8, 4) check (mg between 0 and 100), zn numeric(8, 4) check (zn between 0 and 100),
  ti numeric(8, 4) check (ti between 0 and 100),
  spec_result text check (spec_result in ('in_spec', 'out_of_spec', 'incomplete', 'unknown_alloy')),
  spec_check jsonb,
  edited_fields text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'superseded', 'discarded')),
  uploaded_by uuid not null references public.app_users(id),
  uploaded_at timestamptz not null default clock_timestamp(),
  confirmed_by uuid references public.app_users(id),
  confirmed_at timestamptz,
  confirm_note text check (confirm_note is null or length(btrim(confirm_note)) between 3 and 300),
  discarded_reason text check (discarded_reason is null or length(btrim(discarded_reason)) between 5 and 300),
  superseded_at timestamptz,
  check (receipt_line_id is not null or billet_batch_id is not null),
  check ((status in ('confirmed', 'superseded')) = (confirmed_at is not null)),
  foreign key (company_id, receipt_line_id) references public.purchase_receipt_lines(company_id, id),
  foreign key (company_id, billet_batch_id) references public.billet_batches(company_id, id)
);
create unique index if not exists billet_certificates_one_line on public.billet_certificates(company_id, receipt_line_id) where status = 'confirmed' and receipt_line_id is not null;
create unique index if not exists billet_certificates_one_batch on public.billet_certificates(company_id, billet_batch_id) where status = 'confirmed' and billet_batch_id is not null and receipt_line_id is null;
create unique index if not exists billet_certificates_same_file on public.billet_certificates(company_id, file_sha256, coalesce(receipt_line_id, billet_batch_id)) where status in ('draft', 'confirmed');
create index if not exists billet_certificates_company_idx on public.billet_certificates(company_id, status, uploaded_at desc);
create index if not exists billet_certificates_heat_idx on public.billet_certificates(company_id, lower(heat_number)) where heat_number is not null;

-- Alloy chemistry limits (% by weight) for the elements a mill certificate reports. Mirrors standardAlloyCompositions in
-- lib/calculations/alloy-composition.ts; a test compares the two.
create or replace function private.ap8_alloy_spec(p_alloy text)
returns jsonb language sql immutable set search_path = public, private as $$
  select case substring(upper(coalesce(p_alloy, '')) from '([0-9]{4})')
    when '6063' then '{"Si":[0.2,0.6],"Fe":[0,0.35],"Cu":[0,0.1],"Mn":[0,0.1],"Mg":[0.45,0.9],"Zn":[0,0.1],"Ti":[0,0.1]}'::jsonb
    when '6061' then '{"Si":[0.4,0.8],"Fe":[0,0.7],"Cu":[0.15,0.4],"Mn":[0,0.15],"Mg":[0.8,1.2],"Zn":[0,0.25],"Ti":[0,0.15]}'::jsonb
    when '6082' then '{"Si":[0.7,1.3],"Fe":[0,0.5],"Cu":[0,0.1],"Mn":[0.4,1.0],"Mg":[0.6,1.2],"Zn":[0,0.2],"Ti":[0,0.1]}'::jsonb
    when '6005' then '{"Si":[0.6,0.9],"Fe":[0,0.35],"Cu":[0,0.1],"Mn":[0,0.1],"Mg":[0.4,0.6],"Zn":[0,0.1],"Ti":[0,0.1]}'::jsonb
    when '1050' then '{"Si":[0,0.25],"Fe":[0,0.4],"Cu":[0,0.05],"Mn":[0,0.05],"Mg":[0,0.05],"Zn":[0,0.05],"Ti":[0,0.03]}'::jsonb
    when '1060' then '{"Si":[0,0.25],"Fe":[0,0.35],"Cu":[0,0.05],"Mn":[0,0.03],"Mg":[0,0.03],"Zn":[0,0.05],"Ti":[0,0.03]}'::jsonb
  end
$$;
revoke all on function private.ap8_alloy_spec(text) from public, anon, authenticated;

create or replace function private.ap8_chem_check(p_alloy text, p_values jsonb)
returns jsonb language plpgsql immutable set search_path = public, private as $$
declare v_spec jsonb := private.ap8_alloy_spec(p_alloy); e text; v numeric; v_out jsonb := '[]'; v_missing text[] := '{}';
begin
  if v_spec is null then return jsonb_build_object('result', 'unknown_alloy', 'out', '[]'::jsonb, 'missing', '[]'::jsonb, 'spec', null); end if;
  foreach e in array array['Si', 'Fe', 'Cu', 'Mn', 'Mg', 'Zn', 'Ti'] loop
    v := nullif(p_values ->> lower(e), '')::numeric;
    if v is null then v_missing := v_missing || e;
    elsif v < (v_spec -> e ->> 0)::numeric or v > (v_spec -> e ->> 1)::numeric then
      v_out := v_out || jsonb_build_array(jsonb_build_object('element', e, 'value', v, 'min', (v_spec -> e ->> 0)::numeric, 'max', (v_spec -> e ->> 1)::numeric));
    end if;
  end loop;
  return jsonb_build_object('result', case when jsonb_array_length(v_out) > 0 then 'out_of_spec' when cardinality(v_missing) > 0 then 'incomplete' else 'in_spec' end,
    'out', v_out, 'missing', to_jsonb(v_missing), 'spec', v_spec, 'alloy', substring(upper(p_alloy) from '([0-9]{4})'));
end;
$$;
revoke all on function private.ap8_chem_check(text, jsonb) from public, anon, authenticated;

create or replace function private.ap8_cert_json(x public.billet_certificates)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select (to_jsonb(x) - 'uploaded_by' - 'confirmed_by') || jsonb_build_object(
    'uploaded_by_name', (select full_name from public.app_users where id = x.uploaded_by), 'confirmed_by_name', (select full_name from public.app_users where id = x.confirmed_by),
    'vendor', (select vendor_name from public.vendors where id = x.vendor_id),
    'line', (select jsonb_build_object('id', rl.id, 'po_number', po.po_number, 'line_number', pol.line_number, 'description', pol.description, 'received_quantity', rl.received_quantity,
        'unit', pol.unit, 'receipt_date', pr.receipt_date, 'receipt_reference', pr.reference)
      from public.purchase_receipt_lines rl join public.purchase_receipts pr on pr.id = rl.receipt_id join public.purchase_order_lines pol on pol.id = rl.purchase_order_line_id
        join public.purchase_orders po on po.id = rl.purchase_order_id where rl.id = x.receipt_line_id),
    'batches', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'batch_number', b.batch_number, 'heat_number', b.heat_number, 'alloy', b.alloy) order by b.batch_number), '[]')
      from public.billet_batches b where b.company_id = x.company_id and (b.id = x.billet_batch_id
        or b.id in (select r.billet_batch_id from public.incoming_stock_releases r where r.company_id = x.company_id and r.receipt_line_id = x.receipt_line_id))),
    'duplicate_heat', (select jsonb_agg(jsonb_build_object('id', o.id, 'file_name', o.file_name)) from public.billet_certificates o
      where o.company_id = x.company_id and o.id <> x.id and o.status = 'confirmed' and x.heat_number is not null and lower(o.heat_number) = lower(x.heat_number)
        and o.receipt_line_id is distinct from x.receipt_line_id),
    'live_check', private.ap8_chem_check(x.alloy, jsonb_build_object('si', x.si, 'fe', x.fe, 'cu', x.cu, 'mn', x.mn, 'mg', x.mg, 'zn', x.zn, 'ti', x.ti)))
$$;
revoke all on function private.ap8_cert_json(public.billet_certificates) from public, anon, authenticated;

-- Field values from a payload: blank stays blank (never zero).
create or replace function private.ap8_chem_value(p jsonb, p_key text)
returns numeric language plpgsql immutable set search_path = public, private as $$
declare t text := nullif(btrim(coalesce(p ->> p_key, '')), ''); v numeric;
begin
  if t is null then return null; end if;
  begin v := t::numeric; exception when others then raise exception 'AP: % must be a number.', initcap(p_key); end;
  if v < 0 or v > 100 then raise exception 'AP: % must be a percentage between 0 and 100.', initcap(p_key); end if;
  return round(v, 4);
end;
$$;
revoke all on function private.ap8_chem_value(jsonb, text) from public, anon, authenticated;

create or replace function public.ap_mtc(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; x public.billet_certificates%rowtype; v_line public.purchase_receipt_lines%rowtype; v_batch public.billet_batches%rowtype; v_vendor uuid; v_rows jsonb; v_total bigint;
  v_page integer := private.ap3_page(p_payload); v_ex jsonb; v_check jsonb; v_edited text[] := '{}'; k text; v_new jsonb; v_heat text; v_alloy text; v_search text; v_status text;
  t public.mtc_templates%rowtype;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'quality', 'factory_manager', 'production_manager', 'inventory_manager', 'accounts']);
  if p_command = 'draft' then
    perform private.ap_keys(p_payload, array['receipt_line_id', 'billet_batch_id', 'file_name', 'storage_path', 'mime_type', 'file_sha256', 'source_kind', 'extracted']);
    perform private.ap4_need(c.role, array['owner', 'admin', 'quality', 'factory_manager', 'inventory_manager']);
    if private.ap_uuid(p_payload, 'receipt_line_id', false) is not null then
      select * into v_line from public.purchase_receipt_lines where id = (p_payload ->> 'receipt_line_id')::uuid and company_id = c.company_id;
      if v_line.id is null then raise exception 'AP: The received purchase line is unavailable.'; end if;
      select po.vendor_id into v_vendor from public.purchase_orders po where po.id = v_line.purchase_order_id;
    elsif private.ap_uuid(p_payload, 'billet_batch_id', false) is not null then
      select * into v_batch from public.billet_batches where id = (p_payload ->> 'billet_batch_id')::uuid and company_id = c.company_id;
      if v_batch.id is null then raise exception 'AP: Billet batch not found.'; end if;
      v_vendor := v_batch.supplier_id;
    else raise exception 'AP: Choose the received line or billet batch this certificate belongs to.';
    end if;
    if coalesce(p_payload ->> 'storage_path', '') not like c.company_id::text || '/%' then raise exception 'AP: Upload the certificate again.'; end if;
    if coalesce(p_payload ->> 'source_kind', '') not in ('pdf_text', 'pdf_no_text', 'photo', 'pasted_text') then raise exception 'AP: Unknown certificate source.'; end if;
    v_ex := coalesce(p_payload -> 'extracted', '{}');
    if jsonb_typeof(v_ex) <> 'object' or octet_length(v_ex::text) > 8000
      or exists (select 1 from jsonb_object_keys(v_ex) q where q not in ('heat_number', 'alloy', 'si', 'fe', 'cu', 'mn', 'mg', 'zn', 'ti')) then
      raise exception 'AP: The extracted values are not readable.'; end if;
    v_heat := nullif(btrim(coalesce(v_ex -> 'heat_number' ->> 'value', '')), '');
    if v_heat is not null and (length(v_heat) not between 2 and 40 or v_heat ~ '[[:cntrl:]]') then v_heat := null; end if;
    v_alloy := substring(upper(coalesce(v_ex -> 'alloy' ->> 'value', '')) from '^([0-9]{4}[A-Z]?)$');
    begin
      insert into public.billet_certificates(company_id, receipt_line_id, billet_batch_id, vendor_id, file_name, storage_path, mime_type, file_sha256, source_kind, extracted,
          heat_number, alloy, si, fe, cu, mn, mg, zn, ti, uploaded_by)
        values (c.company_id, v_line.id, case when v_line.id is null then v_batch.id end, v_vendor, private.ap_text(p_payload ->> 'file_name', 'File name', 1, 200),
          p_payload ->> 'storage_path', nullif(p_payload ->> 'mime_type', ''), lower(p_payload ->> 'file_sha256'), p_payload ->> 'source_kind', v_ex, v_heat, v_alloy,
          private.ap8_chem_value(jsonb_build_object('si', v_ex -> 'si' ->> 'value'), 'si'), private.ap8_chem_value(jsonb_build_object('fe', v_ex -> 'fe' ->> 'value'), 'fe'),
          private.ap8_chem_value(jsonb_build_object('cu', v_ex -> 'cu' ->> 'value'), 'cu'), private.ap8_chem_value(jsonb_build_object('mn', v_ex -> 'mn' ->> 'value'), 'mn'),
          private.ap8_chem_value(jsonb_build_object('mg', v_ex -> 'mg' ->> 'value'), 'mg'), private.ap8_chem_value(jsonb_build_object('zn', v_ex -> 'zn' ->> 'value'), 'zn'),
          private.ap8_chem_value(jsonb_build_object('ti', v_ex -> 'ti' ->> 'value'), 'ti'), c.actor_id)
        returning * into x;
    exception when unique_violation then
      raise exception 'AP: This certificate file is already attached here. Open the existing draft instead.';
    end;
    return private.ap8_cert_json(x);
  elsif p_command = 'get' then
    perform private.ap_keys(p_payload, array['id']);
    select * into x from public.billet_certificates where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if x.id is null then raise exception 'AP: Certificate not found.'; end if;
    return private.ap8_cert_json(x) || jsonb_build_object('can_confirm', c.role in ('owner', 'admin', 'quality'),
      'template', (select to_jsonb(t2) - 'updated_by' from public.mtc_templates t2 where t2.company_id = c.company_id and t2.vendor_id = x.vendor_id));
  elsif p_command = 'confirm' then
    perform private.ap_keys(p_payload, array['id', 'heat_number', 'alloy', 'si', 'fe', 'cu', 'mn', 'mg', 'zn', 'ti', 'note']);
    perform private.ap4_need(c.role, array['owner', 'admin', 'quality']);
    select * into x from public.billet_certificates where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if x.id is null then raise exception 'AP: Certificate not found.'; end if;
    if x.status <> 'draft' then raise exception 'AP: Only a draft certificate can be confirmed.'; end if;
    v_heat := private.ap_text(p_payload ->> 'heat_number', 'Heat number', 2, 40);
    v_alloy := upper(private.ap_text(p_payload ->> 'alloy', 'Alloy', 4, 5));
    if v_alloy !~ '^[0-9]{4}[A-Z]?$' then raise exception 'AP: Enter the alloy as four digits, such as 6063.'; end if;
    v_new := jsonb_build_object('heat_number', v_heat, 'alloy', v_alloy, 'si', private.ap8_chem_value(p_payload, 'si'), 'fe', private.ap8_chem_value(p_payload, 'fe'),
      'cu', private.ap8_chem_value(p_payload, 'cu'), 'mn', private.ap8_chem_value(p_payload, 'mn'), 'mg', private.ap8_chem_value(p_payload, 'mg'),
      'zn', private.ap8_chem_value(p_payload, 'zn'), 'ti', private.ap8_chem_value(p_payload, 'ti'));
    -- Learn: which fields the person had to type or correct against what was read from the certificate.
    foreach k in array array['heat_number', 'alloy', 'si', 'fe', 'cu', 'mn', 'mg', 'zn', 'ti'] loop
      if (case when k in ('heat_number', 'alloy') then upper(coalesce(v_new ->> k, '')) is distinct from upper(coalesce(x.extracted -> k ->> 'value', ''))
        else (v_new ->> k)::numeric is distinct from nullif(x.extracted -> k ->> 'value', '')::numeric end) then v_edited := v_edited || k; end if;
    end loop;
    v_check := private.ap8_chem_check(v_alloy, v_new);
    update public.billet_certificates set status = 'superseded', superseded_at = clock_timestamp()
      where company_id = c.company_id and status = 'confirmed' and id <> x.id
        and ((x.receipt_line_id is not null and receipt_line_id = x.receipt_line_id) or (x.receipt_line_id is null and billet_batch_id = x.billet_batch_id and receipt_line_id is null));
    update public.billet_certificates set status = 'confirmed', heat_number = v_heat, alloy = v_alloy, si = (v_new ->> 'si')::numeric, fe = (v_new ->> 'fe')::numeric,
      cu = (v_new ->> 'cu')::numeric, mn = (v_new ->> 'mn')::numeric, mg = (v_new ->> 'mg')::numeric, zn = (v_new ->> 'zn')::numeric, ti = (v_new ->> 'ti')::numeric,
      spec_result = v_check ->> 'result', spec_check = v_check, edited_fields = v_edited, confirmed_by = c.actor_id, confirmed_at = clock_timestamp(),
      confirm_note = private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false)
      where id = x.id returning * into x;
    -- A heat number on the certificate fills a released batch that has none; a different one is left for quality to see.
    update public.billet_batches b set heat_number = v_heat, updated_at = now()
      where b.company_id = c.company_id and b.heat_number is null
        and (b.id = x.billet_batch_id or b.id in (select r.billet_batch_id from public.incoming_stock_releases r where r.company_id = c.company_id and r.receipt_line_id = x.receipt_line_id));
    if v_check ->> 'result' = 'out_of_spec' then
      perform private.ap3_notify_roles(c.company_id, array['owner', 'quality', 'factory_manager'], 'mtc_out_of_spec', 'warning',
        'Billet certificate out of specification: heat ' || v_heat,
        (select string_agg(format('%s %s%% (limit %s-%s)', o ->> 'element', trim_scale((o ->> 'value')::numeric), trim_scale((o ->> 'min')::numeric), trim_scale((o ->> 'max')::numeric)), ', ')
          from jsonb_array_elements(v_check -> 'out') o) || '. Decide the material on the incoming line: concession or reject.',
        'billet_certificate', x.id, '/quality/certificates/' || x.id, 'mtc-out-of-spec:' || x.id, c.actor_id);
    end if;
    return private.ap8_cert_json(x);
  elsif p_command = 'discard' then
    perform private.ap_keys(p_payload, array['id', 'reason']);
    perform private.ap4_need(c.role, array['owner', 'admin', 'quality', 'factory_manager', 'inventory_manager']);
    select * into x from public.billet_certificates where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if x.id is null then raise exception 'AP: Certificate not found.'; end if;
    if x.status <> 'draft' then raise exception 'AP: Only a draft can be discarded. A confirmed certificate is replaced by confirming a new one.'; end if;
    update public.billet_certificates set status = 'discarded', discarded_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300) where id = x.id returning * into x;
    return private.ap8_cert_json(x);
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'search', 'status', 'spec']);
    v_status := coalesce(nullif(p_payload ->> 'status', ''), 'all');
    if v_status not in ('all', 'draft', 'confirmed', 'superseded', 'discarded') then raise exception 'AP: Choose a status.'; end if;
    if coalesce(p_payload ->> 'spec', '') not in ('', 'in_spec', 'out_of_spec', 'incomplete', 'unknown_alloy') then raise exception 'AP: Choose a specification result.'; end if;
    v_search := nullif(btrim(coalesce(p_payload ->> 'search', '')), '');
    if v_search is not null then v_search := '%' || replace(replace(replace(left(v_search, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
    with f as (select b.*, count(*) over () total from public.billet_certificates b
      where b.company_id = c.company_id and (v_status = 'all' or b.status = v_status) and (coalesce(p_payload ->> 'spec', '') = '' or b.spec_result = p_payload ->> 'spec')
        and (v_search is null or b.heat_number ilike v_search or b.file_name ilike v_search or exists (select 1 from public.vendors v where v.id = b.vendor_id and v.vendor_name ilike v_search))
      order by b.uploaded_at desc limit 10 offset (v_page - 1) * 10)
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'status', f.status, 'heat_number', f.heat_number, 'alloy', f.alloy, 'spec_result', f.spec_result,
        'vendor', (select vendor_name from public.vendors where id = f.vendor_id), 'uploaded_at', f.uploaded_at, 'source_kind', f.source_kind, 'edited_fields', to_jsonb(f.edited_fields),
        'po_number', (select po.po_number from public.purchase_orders po where po.id = (select rl.purchase_order_id from public.purchase_receipt_lines rl where rl.id = f.receipt_line_id)))
      order by f.uploaded_at desc), '[]'), max(f.total) into v_rows, v_total from f;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page,
      'reading', (select jsonb_build_object('confirmed', count(*), 'read_without_edits', count(*) filter (where cardinality(edited_fields) = 0),
          'fields_typed', private.ap8_round(avg(cardinality(edited_fields)), 2))
        from public.billet_certificates where company_id = c.company_id and status in ('confirmed', 'superseded') and confirmed_at > clock_timestamp() - interval '90 days'));
  elsif p_command = 'line' then
    perform private.ap_keys(p_payload, array['receipt_line_id']);
    select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'file_name', b.file_name, 'status', b.status, 'heat_number', b.heat_number, 'alloy', b.alloy, 'spec_result', b.spec_result,
        'uploaded_at', b.uploaded_at) order by b.uploaded_at desc), '[]') into v_rows
      from public.billet_certificates b where b.company_id = c.company_id and b.receipt_line_id = private.ap_uuid(p_payload, 'receipt_line_id') and b.status <> 'discarded';
    return jsonb_build_object('rows', v_rows);
  elsif p_command = 'coverage' then
    perform private.ap_keys(p_payload, array['page']);
    -- Every billet batch should trace its chemistry to a confirmed certificate: its own, or its receipt line's.
    with b as (select bb.id, bb.batch_number, bb.heat_number, bb.alloy, bb.received_date, bb.available_weight_kg,
        (select x2.id from public.billet_certificates x2 where x2.company_id = c.company_id and x2.status = 'confirmed' and (x2.billet_batch_id = bb.id
          or x2.receipt_line_id in (select r.receipt_line_id from public.incoming_stock_releases r where r.company_id = c.company_id and r.billet_batch_id = bb.id)) limit 1) cert,
        (select r.receipt_line_id from public.incoming_stock_releases r where r.company_id = c.company_id and r.billet_batch_id = bb.id limit 1) line
      from public.billet_batches bb where bb.company_id = c.company_id),
      f as (select b.*, count(*) over () total from b where b.cert is null order by b.received_date desc, b.batch_number limit 10 offset (v_page - 1) * 10)
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'batch_number', f.batch_number, 'heat_number', f.heat_number, 'alloy', f.alloy, 'received_date', f.received_date,
        'available_weight_kg', f.available_weight_kg, 'receipt_line_id', f.line) order by f.received_date desc, f.batch_number), '[]'), max(f.total) into v_rows, v_total from f;
    return jsonb_build_object('rows', v_rows, 'total_count', coalesce(v_total, 0), 'page', v_page,
      'batches', (select count(*) from public.billet_batches where company_id = c.company_id),
      'traced', (select count(*) from public.billet_batches bb where bb.company_id = c.company_id and exists (select 1 from public.billet_certificates x2 where x2.company_id = c.company_id
        and x2.status = 'confirmed' and (x2.billet_batch_id = bb.id or x2.receipt_line_id in (select r.receipt_line_id from public.incoming_stock_releases r where r.company_id = c.company_id and r.billet_batch_id = bb.id)))));
  elsif p_command = 'target' then
    -- What a new certificate attaches to: the received line (and its supplier) or a billet batch, with that supplier's template.
    perform private.ap_keys(p_payload, array['receipt_line_id', 'billet_batch_id']);
    if private.ap_uuid(p_payload, 'receipt_line_id', false) is not null then
      select * into v_line from public.purchase_receipt_lines where id = (p_payload ->> 'receipt_line_id')::uuid and company_id = c.company_id;
      if v_line.id is null then raise exception 'AP: The received purchase line is unavailable.'; end if;
      select po.vendor_id into v_vendor from public.purchase_orders po where po.id = v_line.purchase_order_id;
      v_rows := (select jsonb_build_object('label', po.po_number || ' line ' || pol.line_number || ' · ' || pol.description, 'received', rl.received_quantity, 'unit', pol.unit)
        from public.purchase_receipt_lines rl join public.purchase_order_lines pol on pol.id = rl.purchase_order_line_id join public.purchase_orders po on po.id = rl.purchase_order_id where rl.id = v_line.id);
    elsif private.ap_uuid(p_payload, 'billet_batch_id', false) is not null then
      select * into v_batch from public.billet_batches where id = (p_payload ->> 'billet_batch_id')::uuid and company_id = c.company_id;
      if v_batch.id is null then raise exception 'AP: Billet batch not found.'; end if;
      v_vendor := v_batch.supplier_id;
      v_rows := jsonb_build_object('label', 'Billet batch ' || v_batch.batch_number || coalesce(' · heat ' || v_batch.heat_number, ''), 'received', v_batch.total_weight_kg, 'unit', 'kg');
    else raise exception 'AP: Choose the received line or billet batch this certificate belongs to.';
    end if;
    select * into t from public.mtc_templates where company_id = c.company_id and vendor_id = v_vendor;
    return jsonb_build_object('vendor_id', v_vendor, 'vendor', (select vendor_name from public.vendors where id = v_vendor), 'target', v_rows,
      'template', case when t.id is null then null else to_jsonb(t) - 'updated_by' end,
      'existing', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'status', b.status, 'heat_number', b.heat_number, 'spec_result', b.spec_result, 'file_name', b.file_name) order by b.uploaded_at desc), '[]')
        from public.billet_certificates b where b.company_id = c.company_id and b.status in ('draft', 'confirmed')
          and ((v_line.id is not null and b.receipt_line_id = v_line.id) or (v_line.id is null and b.billet_batch_id = v_batch.id))));
  elsif p_command = 'template' then
    perform private.ap_keys(p_payload, array['vendor_id']);
    select * into t from public.mtc_templates where company_id = c.company_id and vendor_id = private.ap_uuid(p_payload, 'vendor_id');
    return jsonb_build_object('template', case when t.id is null then null else to_jsonb(t) - 'updated_by' end);
  elsif p_command = 'save_template' then
    perform private.ap_keys(p_payload, array['vendor_id', 'heat_labels', 'alloy_labels', 'element_order', 'decimal_comma', 'note']);
    perform private.ap4_need(c.role, array['owner', 'admin', 'quality']);
    v_vendor := private.ap_uuid(p_payload, 'vendor_id');
    if not exists (select 1 from public.vendors where id = v_vendor and company_id = c.company_id) then raise exception 'AP: Supplier not found.'; end if;
    if jsonb_typeof(coalesce(p_payload -> 'heat_labels', '[]')) <> 'array' or jsonb_typeof(coalesce(p_payload -> 'alloy_labels', '[]')) <> 'array'
      or jsonb_typeof(coalesce(p_payload -> 'element_order', '[]')) <> 'array' then raise exception 'AP: Invalid request.'; end if;
    if exists (select 1 from jsonb_array_elements_text(coalesce(p_payload -> 'heat_labels', '[]') || coalesce(p_payload -> 'alloy_labels', '[]')) l
      where length(btrim(l)) not between 2 and 40 or l ~ '[[:cntrl:]]') then raise exception 'AP: Labels must be 2 to 40 characters.'; end if;
    insert into public.mtc_templates(company_id, vendor_id, heat_labels, alloy_labels, element_order, decimal_comma, note, updated_by)
      values (c.company_id, v_vendor, array(select btrim(l) from jsonb_array_elements_text(coalesce(p_payload -> 'heat_labels', '[]')) l),
        array(select btrim(l) from jsonb_array_elements_text(coalesce(p_payload -> 'alloy_labels', '[]')) l),
        array(select l from jsonb_array_elements_text(coalesce(p_payload -> 'element_order', '[]')) l), coalesce((p_payload ->> 'decimal_comma')::boolean, false),
        private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id)
      on conflict (company_id, vendor_id) do update set heat_labels = excluded.heat_labels, alloy_labels = excluded.alloy_labels, element_order = excluded.element_order,
        decimal_comma = excluded.decimal_comma, note = excluded.note, updated_by = excluded.updated_by, updated_at = clock_timestamp()
      returning * into t;
    return to_jsonb(t) - 'updated_by';
  end if;
  raise exception 'AP: Unknown request.';
exception when check_violation then
  raise exception 'AP: The certificate values are outside what can be stored. Review them.';
end;
$$;
revoke all on function public.ap_mtc(text, jsonb) from public, anon;
grant execute on function public.ap_mtc(text, jsonb) to authenticated;

-- Extraction never accepts material. A line whose confirmed certificate is out of specification can only be accepted as an
-- authorised concession (or rejected), through the existing incoming quality decision.
create or replace function private.ap8_incoming_accept_guard()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare x public.billet_certificates%rowtype;
begin
  if new.disposition = 'accept' then
    select * into x from public.billet_certificates where company_id = new.company_id and receipt_line_id = new.receipt_line_id and status = 'confirmed';
    if x.id is not null and x.spec_result = 'out_of_spec' then
      raise exception 'NOV: The mill certificate for heat % is out of specification. Accept this material only as an authorised concession, or reject it.', x.heat_number;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.ap8_incoming_accept_guard() from public, anon, authenticated;
drop trigger if exists zzz_ap8_incoming_accept on public.incoming_dispositions;
create trigger zzz_ap8_incoming_accept before insert on public.incoming_dispositions for each row execute function private.ap8_incoming_accept_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- AP-001 jobs
-- ---------------------------------------------------------------------------------------------------------------
alter function private.ap_job_registry() rename to ap8_previous_job_registry;
create function private.ap_job_registry() returns table(job_key text, schedule text, label text, description text)
language sql immutable set search_path = public, private as $$
  select * from private.ap8_previous_job_registry() union all values
    ('crm.customer_health', 'nightly', 'Score customer health', 'Scores each active customer from order rhythm, volume, payment, complaints and quotation wins. On Monday, sales is told how many are at risk.'),
    ('quality.spc_check', 'hourly', 'Check quality control charts', 'Raises an alarm for QC when a reading is outside the plan limits or seven readings in a row sit on one side of the centre line.'),
    ('dies.availability', 'hourly', 'Check die availability for planned jobs', 'Warns planners when a planned job needs a die that is away, overdue back, or whose return decides the due date.')
$$;
revoke all on function private.ap_job_registry() from public, anon, authenticated;

alter function private.ap_job_execute(uuid, text, uuid) rename to ap8_previous_job_execute;
create function private.ap_job_execute(p_company uuid, p_job text, p_run uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_job = 'crm.customer_health' then return private.ap8_health_job(p_company, p_run); end if;
  if p_job = 'quality.spc_check' then return private.ap8_spc_job(p_company, p_run); end if;
  if p_job = 'dies.availability' then return private.ap8_availability_job(p_company, p_run); end if;
  return private.ap8_previous_job_execute(p_company, p_job, p_run);
end;
$$;
revoke all on function private.ap_job_execute(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Row security: every new table is company-scoped and readable by its working roles; writes go through the gateways.
-- Saved views are readable only by the person who saved them.
-- ---------------------------------------------------------------------------------------------------------------
do $$ declare t text; roles text; begin
  foreach t in array array['die_availability_windows', 'quote_capacity_checks', 'customer_health_scores', 'customer_health_followups', 'spc_alarms', 'mtc_templates', 'billet_certificates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    roles := case
      when t = 'die_availability_windows' then 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''production'',''quality'',''sales_manager'',''sales'',''viewer'']'
      when t = 'quote_capacity_checks' then 'array[''owner'',''admin'',''sales_manager'',''sales'',''production_manager'',''factory_manager'']'
      when t in ('customer_health_scores', 'customer_health_followups') then 'array[''owner'',''admin'',''sales_manager'',''sales'']'
      when t = 'spc_alarms' then 'array[''owner'',''admin'',''quality'',''production_manager'',''factory_manager'']'
      else 'array[''owner'',''admin'',''quality'',''factory_manager'',''production_manager'',''inventory_manager'',''accounts'']' end;
    execute format('drop policy if exists ap8_read on public.%I', t);
    execute format('create policy ap8_read on public.%I for select to authenticated using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) = any(%s))', t, roles);
  end loop;
end $$;
alter table public.saved_list_views enable row level security;
revoke all on public.saved_list_views from public, anon, authenticated;
drop policy if exists ap8_own_views on public.saved_list_views;
create policy ap8_own_views on public.saved_list_views for select to authenticated using (company_id = (select public.get_current_user_company_id()) and user_id = (select auth.uid()));

commit;
