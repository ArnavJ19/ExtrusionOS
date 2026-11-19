-- FABLE_SUGGESTIONS FS-79 (history tab), FS-07 (error monitoring and job health), FS-51 (security hardening, part).

-- =====================================================================================================================
-- FS-79: history on every record, read from the existing audit tables
-- =====================================================================================================================
-- Field-level before/after values were captured only for orders, quotes, invoices, payments, dispatches, shipments,
-- inventory items and dealer orders. The masters and jobs below recorded "who touched it" without values. They now
-- use the existing changed-fields audit trigger (private.audit_row_change), which stores only the fields that changed.
do $$
declare t text;
begin
  foreach t in array array['dies', 'customers', 'aluminium_profiles', 'production_jobs', 'vendors', 'machines']
  loop
    execute format('drop trigger if exists fs_history_audit on public.%I', t);
    execute format('create trigger fs_history_audit after insert or update or delete on public.%I for each row execute function private.audit_row_change(%L)', t, t);
  end loop;
end;
$$;
create index if not exists audit_logs_enterprise_entity_idx on public.audit_logs_enterprise(company_id, entity_id, created_at desc);

-- The record types with a history tab: the audit entity names they are logged under and the roles that may open them
-- (the same roles as their pages in lib/auth/route-permissions.ts).
create or replace function private.fs_history_entity(p_entity text)
returns table(table_name text, audit_types text[], roles text[])
language sql immutable set search_path = pg_catalog as $$
  select v.table_name, v.audit_types, v.roles from (values
    ('order', 'orders', array['order', 'orders'], array['owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer']),
    ('quote', 'quotes', array['quote', 'quotes'], array['owner','admin','sales_manager','sales','accounts','viewer']),
    ('invoice', 'invoices', array['invoice', 'invoices'], array['owner','admin','accounts','viewer']),
    ('payment', 'payments', array['payment', 'payments'], array['owner','admin','accounts','viewer']),
    ('dispatch', 'dispatches', array['dispatch', 'dispatches'], array['owner','admin','sales_manager','sales','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','viewer']),
    ('inventory_item', 'inventory_items', array['inventory_item', 'inventory_items'], array['owner','admin','production_manager','production','factory_manager','dispatch_manager','inventory_manager','viewer']),
    ('die', 'dies', array['dies'], array['owner','admin','sales_manager','sales','production_manager','production','quality','viewer']),
    ('customer', 'customers', array['customers'], array['owner','admin','sales_manager','sales','production_manager','factory_manager','dispatch_manager','accounts','viewer']),
    ('profile', 'aluminium_profiles', array['aluminium_profiles'], array['owner','admin','sales_manager','sales','production_manager','production','factory_manager','inventory_manager','quality','viewer']),
    ('production_job', 'production_jobs', array['production_jobs'], array['owner','admin','production_manager','production','factory_manager','viewer']),
    ('vendor', 'vendors', array['vendors'], array['owner','admin','sales_manager','production_manager','accounts','viewer']),
    ('machine', 'machines', array['machines'], array['owner','admin','production_manager','production','viewer'])
  ) v(entity, table_name, audit_types, roles) where v.entity = p_entity
$$;
revoke all on function private.fs_history_entity(text) from public, anon, authenticated;

-- Cost, margin, profit, supplier rates and internal notes: shown to owner, admin, accounts and sales manager only.
create or replace function private.fs_history_sensitive(p_field text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select p_field ~* '(cost|margin|profit|supplier_rate|internal_note|internal_cost|purchase_rate|rate_per_kg_purchase)'
$$;
revoke all on function private.fs_history_sensitive(text) from public, anon, authenticated;

create or replace function private.fs_history_changes(p_old jsonb, p_new jsonb, p_sees_cost boolean)
returns jsonb language sql immutable set search_path = pg_catalog, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('field', k,
      'old', case when private.fs_history_sensitive(k) and not p_sees_cost then null else coalesce(p_old, '{}') -> k end,
      'new', case when private.fs_history_sensitive(k) and not p_sees_cost then null else coalesce(p_new, '{}') -> k end,
      'hidden', private.fs_history_sensitive(k) and not p_sees_cost) order by k), '[]'::jsonb)
  from (select distinct k from (select jsonb_object_keys(coalesce(p_old, '{}')) k union select jsonb_object_keys(coalesce(p_new, '{}'))) x) keys
  where k not in ('updated_at', 'created_at', 'id', 'company_id', 'search_vector')
    and (coalesce(p_old, '{}') -> k) is distinct from (coalesce(p_new, '{}') -> k)
$$;
revoke all on function private.fs_history_changes(jsonb, jsonb, boolean) from public, anon, authenticated;

-- record: {entity_type, entity_id, page}. Ten entries a page, newest first: field changes, order stage moves and
-- approval decisions, each with who and when.
create or replace function public.fs_history(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  c record; e record; v_id uuid; v_exists boolean; v_page integer; v_sees_cost boolean; v_rows jsonb; v_total bigint;
begin
  select * into c from private.ap_ctx(null);
  if p_command <> 'record' then raise exception 'AP: Unknown history request.'; end if;
  select * into e from private.fs_history_entity(p_payload ->> 'entity_type');
  if e.table_name is null then raise exception 'AP: History is not available for this record type.'; end if;
  if not (c.role = any(e.roles)) then raise exception 'Not permitted' using errcode = '42501'; end if;
  v_id := private.ap_uuid(p_payload, 'entity_id');
  v_page := greatest(1, least(coalesce(nullif(p_payload ->> 'page', '')::int, 1), 1000));
  execute format('select exists (select 1 from public.%I where id = $1 and company_id = $2)', e.table_name) into v_exists using v_id, c.company_id;
  if not v_exists then raise exception 'Not permitted' using errcode = '42501'; end if;
  v_sees_cost := c.role in ('owner', 'admin', 'accounts', 'sales_manager');

  with entries as (
    select a.created_at at_time, coalesce(a.actor_name, 'System') actor, a.actor_role role,
      case when a.action_type ~* '(^insert|_created$)' then 'created' when a.action_type ~* '(^delete|_deleted$)' then 'deleted' else 'changed' end kind,
      private.fs_history_changes(a.previous_value, a.new_value, v_sees_cost) changes, null::text note, 'audit:' || a.id::text ref
    from public.audit_logs_enterprise a
    where a.company_id = c.company_id and a.entity_id = v_id and a.entity_type = any(e.audit_types)
    union all
    select h.changed_at, coalesce(u.full_name, 'System'), u.role, 'stage', jsonb_build_array(jsonb_build_object('field', 'current_stage', 'old', null, 'new', to_jsonb(h.stage), 'hidden', false)),
      h.remarks, 'stage:' || h.id::text
    from public.order_stage_history h left join public.app_users u on u.id = h.changed_by
    where e.table_name = 'orders' and h.company_id = c.company_id and h.order_id = v_id
    union all
    select d.decided_at, d.actor_name, d.actor_role, 'approval', jsonb_build_array(jsonb_build_object('field', 'decision', 'old', null, 'new', to_jsonb(d.decision), 'hidden', false)),
      d.note, 'approval:' || d.id::text
    from public.approval_decisions d where d.company_id = c.company_id and d.source_id = v_id
  ), visible as (select * from entries where kind <> 'changed' or jsonb_array_length(changes) > 0)
  select (select count(*) from visible),
    coalesce((select jsonb_agg(jsonb_build_object('at', at_time, 'actor', actor, 'role', role, 'kind', kind, 'changes', changes, 'note', note, 'ref', ref) order by at_time desc, ref desc)
      from (select * from visible order by at_time desc, ref desc limit 10 offset (v_page - 1) * 10) p), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', 10, 'sees_cost', v_sees_cost);
end;
$$;
revoke all on function public.fs_history(text, jsonb) from public, anon;
grant execute on function public.fs_history(text, jsonb) to authenticated;

-- =====================================================================================================================
-- FS-07: error events and job health
-- =====================================================================================================================
create table if not exists public.app_error_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  source text not null check (source in ('browser', 'server')),
  route text not null check (length(route) between 1 and 300),
  role text,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16,64}$'),
  error_name text check (error_name is null or length(error_name) <= 80),
  message text not null check (length(message) between 1 and 300),
  digest text check (digest is null or length(digest) <= 80),
  release text check (release is null or length(release) <= 80)
);
create index if not exists app_error_events_company_idx on public.app_error_events(company_id, occurred_at desc);
create index if not exists app_error_events_fingerprint_idx on public.app_error_events(company_id, fingerprint, occurred_at desc);
alter table public.app_error_events enable row level security;
revoke all on public.app_error_events from public, anon, authenticated;

-- Messages are stored without personal data or amounts: e-mail addresses, phone-like and other long numbers, GSTINs
-- and identifiers are replaced before storage.
create or replace function private.fs_scrub_error_text(p_text text)
returns text language sql immutable set search_path = pg_catalog as $$
  select left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p_text, ''),
    '[[:cntrl:]]+', ' ', 'g'),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
    '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '[id]', 'g'),
    '[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]', '[gstin]', 'g'),
    '[0-9][0-9,.]{2,}', '#', 'g')), 300)
$$;
revoke all on function private.fs_scrub_error_text(text) from public, anon, authenticated;

create or replace function private.fs_record_error(p_company uuid, p_source text, p_route text, p_role text, p_name text, p_message text, p_digest text, p_release text)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v_route text; v_message text; v_name text; v_fp text; v_id uuid; v_day date := private.business_today();
begin
  -- Paths only: query strings can carry identifiers and search text.
  v_route := left(coalesce(nullif(split_part(split_part(btrim(coalesce(p_route, '')), '?', 1), '#', 1), ''), '/unknown'), 300);
  v_route := regexp_replace(v_route, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '[id]', 'g');
  v_message := coalesce(nullif(private.fs_scrub_error_text(p_message), ''), 'Unknown error');
  v_name := nullif(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9_]', '', 'g'), 80), '');
  v_fp := encode(sha256(convert_to(p_source || '|' || coalesce(v_name, '') || '|' || v_message || '|' || v_route, 'UTF8')), 'hex');
  insert into public.app_error_events(company_id, source, route, role, fingerprint, error_name, message, digest, release)
  values (p_company, p_source, v_route, left(p_role, 40), v_fp, v_name, v_message, nullif(left(regexp_replace(coalesce(p_digest, ''), '[^A-Za-z0-9_-]', '', 'g'), 80), ''),
    nullif(left(regexp_replace(coalesce(p_release, ''), '[^A-Za-z0-9._-]', '', 'g'), 80), ''))
  returning id into v_id;
  -- First occurrence of an error on a business day alerts the owner and admin once (condition key per day).
  if p_company is not null and not exists (select 1 from public.notifications n where n.company_id = p_company and n.condition_key = 'fs07:error:' || v_fp || ':' || v_day) then
    insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, condition_key)
    select p_company, r, 'system', 'warning', 'Application error: ' || left(v_message, 80),
      'Seen on ' || v_route || ' (' || p_source || '). Open System health for the count and the latest occurrence.', '/settings/system-health',
      'fs07:error:' || v_fp || ':' || v_day
    from unnest(array['owner', 'admin']) r;
  end if;
  return v_id;
end;
$$;
revoke all on function private.fs_record_error(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;

-- A failed system job raises one open alert per job; the next successful run of that job resolves it.
create or replace function private.fs_job_run_alert()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_key text := 'fs07:job:' || new.job_key;
begin
  if new.company_id is null then return null; end if;
  if new.status = 'failed' and not exists (select 1 from public.notifications n where n.company_id = new.company_id and n.condition_key = v_key and n.resolved_at is null) then
    insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, condition_key)
    select new.company_id, r, 'system', 'critical', 'Scheduled job failed: ' || new.job_key,
      left(coalesce(private.fs_scrub_error_text(new.error_message), 'No error message recorded.'), 300), '/settings/system-health', v_key
    from unnest(array['owner', 'admin']) r;
  elsif new.status in ('completed', 'succeeded', 'success') then
    update public.notifications set resolved_at = now(), resolution = 'A later run succeeded'
    where company_id = new.company_id and condition_key = v_key and resolved_at is null;
  end if;
  return null;
end;
$$;
revoke all on function private.fs_job_run_alert() from public, anon, authenticated;
drop trigger if exists fs_job_run_alert on public.system_job_runs;
create trigger fs_job_run_alert after insert or update of status on public.system_job_runs for each row execute function private.fs_job_run_alert();

-- report (any signed-in staff member; at most 30 a minute each): a browser error.
-- health (owner/admin): last run of each job, failures in 24 hours, the week's five most frequent errors, recent errors.
create or replace function public.fs_monitoring(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer; v_week timestamptz := now() - interval '7 days';
begin
  if p_command = 'report' then
    select * into c from private.ap_ctx(null);
    if (select count(*) from public.app_error_events where company_id = c.company_id and role = c.role and occurred_at > now() - interval '1 minute') >= 30 then
      return jsonb_build_object('recorded', false, 'reason', 'rate_limited');
    end if;
    perform private.fs_record_error(c.company_id, 'browser', p_payload ->> 'route', c.role, p_payload ->> 'name', p_payload ->> 'message', p_payload ->> 'digest', p_payload ->> 'release');
    return jsonb_build_object('recorded', true);
  elsif p_command = 'health' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
    v_page := greatest(1, least(coalesce(nullif(p_payload ->> 'page', '')::int, 1), 1000));
    return jsonb_build_object(
      'jobs', coalesce((select jsonb_agg(x order by x ->> 'job_key') from (
        select distinct on (r.job_key) jsonb_build_object('job_key', r.job_key, 'status', r.status, 'started_at', r.started_at, 'finished_at', r.finished_at,
          'error', private.fs_scrub_error_text(r.error_message),
          'failures_24h', (select count(*) from public.system_job_runs f where f.company_id = c.company_id and f.job_key = r.job_key and f.status = 'failed' and f.started_at > now() - interval '24 hours'),
          'last_success', (select max(s.finished_at) from public.system_job_runs s where s.company_id = c.company_id and s.job_key = r.job_key and s.status in ('completed', 'succeeded', 'success'))) x
        from public.system_job_runs r where r.company_id = c.company_id order by r.job_key, r.started_at desc) j), '[]'::jsonb),
      'top_errors', coalesce((select jsonb_agg(jsonb_build_object('fingerprint', fingerprint, 'message', message, 'route', route, 'source', source, 'count', n, 'last_seen', last_seen) order by n desc, last_seen desc)
        from (select fingerprint, max(message) message, max(route) route, max(source) source, count(*) n, max(occurred_at) last_seen
          from public.app_error_events where company_id = c.company_id and occurred_at > v_week group by fingerprint order by count(*) desc, max(occurred_at) desc limit 5) t), '[]'::jsonb),
      'errors_7d', (select count(*) from public.app_error_events where company_id = c.company_id and occurred_at > v_week),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('occurred_at', occurred_at, 'source', source, 'route', route, 'role', role, 'name', error_name, 'message', message, 'digest', digest) order by occurred_at desc)
        from (select * from public.app_error_events where company_id = c.company_id order by occurred_at desc limit 10 offset (v_page - 1) * 10) r), '[]'::jsonb),
      'recent_total', (select count(*) from public.app_error_events where company_id = c.company_id),
      'page', v_page);
  end if;
  raise exception 'AP: Unknown monitoring request.';
end;
$$;
revoke all on function public.fs_monitoring(text, jsonb) from public, anon;
grant execute on function public.fs_monitoring(text, jsonb) to authenticated;

-- Server-side errors (instrumentation onRequestError) and the health endpoint use the service role only.
create or replace function public.fs_monitoring_service(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_company uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select id into v_company from public.companies order by created_at limit 1; -- single-company deployment (Omalco)
  if p_command = 'server_error' then
    perform private.fs_record_error(v_company, 'server', p_payload ->> 'route', nullif(p_payload ->> 'role', ''), p_payload ->> 'name', p_payload ->> 'message', p_payload ->> 'digest', p_payload ->> 'release');
    return jsonb_build_object('recorded', true);
  elsif p_command = 'health' then
    return jsonb_build_object('database', 'ok', 'checked_at', now(),
      'failed_jobs_24h', (select count(*) from public.system_job_runs where status = 'failed' and started_at > now() - interval '24 hours'),
      'stale_running_jobs', (select count(*) from public.system_job_runs where status = 'running' and started_at < now() - interval '2 hours'),
      'last_job_run', (select max(started_at) from public.system_job_runs));
  end if;
  raise exception 'Unknown monitoring request';
end;
$$;
revoke all on function public.fs_monitoring_service(text, jsonb) from public, anon, authenticated;
grant execute on function public.fs_monitoring_service(text, jsonb) to service_role;

-- =====================================================================================================================
-- FS-51 (part): login history written by the server, failed-attempt lockout, storage limits
-- =====================================================================================================================
create index if not exists login_events_user_type_idx on public.login_events(user_id, event_type, created_at desc);

-- login_success / logout for the signed-in user (company and user from the session). IP and browser come from the
-- server's request headers, never the browser.
create or replace function public.fs_security(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_user uuid := auth.uid(); v_company uuid; v_page integer;
begin
  if v_user is null then raise exception 'Not permitted' using errcode = '42501'; end if;
  select company_id into v_company from public.app_users where id = v_user and is_active and company_id is not null;
  if p_command in ('login_success', 'logout') then
    if v_company is null then return jsonb_build_object('recorded', false); end if;
    insert into public.login_events(company_id, user_id, event_type, ip_address, user_agent)
    values (v_company, v_user, p_command, left(nullif(p_payload ->> 'ip', ''), 64), left(nullif(p_payload ->> 'user_agent', ''), 300));
    return jsonb_build_object('recorded', true);
  elsif p_command = 'login_history' then
    perform private.ap_ctx(array['owner', 'admin']);
    v_page := greatest(1, least(coalesce(nullif(p_payload ->> 'page', '')::int, 1), 1000));
    return jsonb_build_object(
      'rows', coalesce((select jsonb_agg(jsonb_build_object('at', l.created_at, 'event', l.event_type, 'user', coalesce(u.full_name, u.email, 'Unknown user'), 'role', u.role,
          'ip', l.ip_address, 'user_agent', l.user_agent) order by l.created_at desc)
        from (select * from public.login_events where company_id = v_company order by created_at desc limit 10 offset (v_page - 1) * 10) l
        left join public.app_users u on u.id = l.user_id), '[]'::jsonb),
      'total', (select count(*) from public.login_events where company_id = v_company),
      'failed_24h', (select count(*) from public.login_events where company_id = v_company and event_type = 'login_failed' and created_at > now() - interval '24 hours'),
      'page', v_page);
  end if;
  raise exception 'AP: Unknown security request.';
end;
$$;
revoke all on function public.fs_security(text, jsonb) from public, anon;
grant execute on function public.fs_security(text, jsonb) to authenticated;

-- Failed sign-ins are recorded by the server (service role) against the staff account the e-mail belongs to, and
-- attempts are refused for 15 minutes after 5 failures in 15 minutes. Unknown e-mails are counted by the request
-- rate limit instead, so the response never reveals whether an account exists.
create or replace function public.fs_security_service(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_user uuid; v_company uuid; v_failures integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select u.id, u.company_id into v_user, v_company from public.app_users u where lower(u.email) = lower(btrim(coalesce(p_payload ->> 'email', ''))) and u.company_id is not null limit 1;
  if v_user is not null then
    select count(*) into v_failures from public.login_events where user_id = v_user and event_type = 'login_failed' and created_at > now() - interval '15 minutes';
  end if;
  if p_command = 'check' then
    return jsonb_build_object('locked', coalesce(v_failures, 0) >= 5);
  elsif p_command = 'failed' then
    if v_user is not null then
      insert into public.login_events(company_id, user_id, event_type, ip_address, user_agent)
      values (v_company, v_user, 'login_failed', left(nullif(p_payload ->> 'ip', ''), 64), left(nullif(p_payload ->> 'user_agent', ''), 300));
    end if;
    return jsonb_build_object('locked', coalesce(v_failures, 0) + case when v_user is not null then 1 else 0 end >= 5);
  end if;
  raise exception 'Unknown security request';
end;
$$;
revoke all on function public.fs_security_service(text, jsonb) from public, anon, authenticated;
grant execute on function public.fs_security_service(text, jsonb) to service_role;

-- Browser-written login rows are no longer accepted; the server functions above are the only writers.
drop policy if exists "login_events_admin_insert" on public.login_events;
revoke insert, update, delete on public.login_events from anon, authenticated;

-- Bucket limits mirror the upload rule in lib/utils/files.ts (10 MB; PDF, images, CSV and Excel). Generated reports
-- are written by the server and keep their types, with a size cap.
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
where id in ('documents', 'technical-drawings', 'maintenance-bills');
update storage.buckets set file_size_limit = 26214400 where id = 'reports';
