-- UPGRADE_EOS feature 48: controlled subscriptions and grouped notifications.
--
-- Employees follow records they are permitted to open (orders, production jobs, dispatches,
-- inspections, quotations, invoices) and choose categories (status, production, quality, dispatch,
-- payment). Changes to a followed record are recorded as events by triggers on the source tables.
-- Delivery groups each employee's pending events into one digest, with one line per record ("SO-0042 ·
-- 3 updates · latest: ..."), never one message per change. Each employee picks immediate, hourly or
-- daily digests, quiet hours and muted categories. An event is delivered to a person at most once
-- (unique delivery), their own changes are never sent back to them, and access is rechecked at
-- delivery. Requests for action are separate from information: an action request names a recipient,
-- a record and a request type whose resolution is checked against current records (feature 15's
-- principle). Reminders follow the recipient's quiet hours and stop as soon as the condition is
-- resolved or the request is closed. Additive only. Depends on private.task_source_state
-- (20261022360000).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.record_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid not null references public.app_users(id),
  entity_type text not null check (entity_type in ('order','production_job','dispatch','quality_inspection','quote','invoice')),
  entity_id uuid not null,
  categories text[] not null check (cardinality(categories) between 1 and 5 and categories <@ array['status','production','quality','dispatch','payment']),
  created_at timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);
create index record_subscriptions_entity_idx on public.record_subscriptions(company_id, entity_type, entity_id);
create index record_subscriptions_company_idx on public.record_subscriptions(company_id, user_id);

create table public.notification_preferences (
  user_id uuid primary key references public.app_users(id),
  company_id uuid not null references public.companies(id),
  digest_mode text not null default 'immediate' check (digest_mode in ('immediate','hourly','daily')),
  daily_hour smallint not null default 18 check (daily_hour between 0 and 23),
  quiet_start smallint check (quiet_start between 0 and 23),
  quiet_end smallint check (quiet_end between 0 and 23),
  muted_categories text[] not null default '{}' check (muted_categories <@ array['status','production','quality','dispatch','payment']),
  last_digest_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((quiet_start is null) = (quiet_end is null) and (quiet_start is null or quiet_start <> quiet_end))
);
create index notification_preferences_company_idx on public.notification_preferences(company_id);

create table public.record_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entity_type text not null,
  entity_id uuid not null,
  label text not null,
  category text not null check (category in ('status','production','quality','dispatch','payment')),
  summary text not null,
  actor_id uuid,
  occurred_at timestamptz not null default clock_timestamp()
);
create index record_events_entity_idx on public.record_events(company_id, entity_type, entity_id, occurred_at);

create table public.notification_digests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid not null references public.app_users(id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  record_count integer not null,
  event_count integer not null,
  items jsonb not null,
  notification_id uuid,
  created_at timestamptz not null default now()
);
create index notification_digests_user_idx on public.notification_digests(company_id, user_id, created_at desc);
create index notification_digests_user_fk_idx on public.notification_digests(user_id);

create table public.record_event_deliveries (
  event_id uuid not null references public.record_events(id) on delete cascade,
  user_id uuid not null references public.app_users(id),
  digest_id uuid not null references public.notification_digests(id) on delete cascade,
  primary key (event_id, user_id)
);
create index record_event_deliveries_digest_idx on public.record_event_deliveries(digest_id);
create index record_event_deliveries_user_idx on public.record_event_deliveries(user_id);

create table public.action_requests (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  requester_id uuid not null references public.app_users(id),
  recipient_id uuid not null references public.app_users(id),
  request_type text not null check (request_type in ('approve_quote','record_payment','release_qc','confirm_dispatch','general')),
  entity_type text not null check (entity_type in ('order','production_job','dispatch','quality_inspection','quote','invoice')),
  entity_id uuid not null,
  label text not null,
  message text not null check (length(btrim(message)) between 3 and 300),
  reminder_hours integer not null default 4 check (reminder_hours between 1 and 72),
  reminder_count integer not null default 0 check (reminder_count between 0 and 10),
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution in ('condition_met','done','cancelled','source_missing','recipient_unavailable')),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 300),
  check ((resolved_at is null) = (resolution is null)),
  check (requester_id <> recipient_id)
);
create index action_requests_recipient_idx on public.action_requests(company_id, recipient_id, resolved_at);
create index action_requests_requester_idx on public.action_requests(company_id, requester_id, resolved_at);
create index action_requests_open_idx on public.action_requests(company_id) where resolved_at is null;
create index action_requests_requester_fk_idx on public.action_requests(requester_id);
create index action_requests_recipient_fk_idx on public.action_requests(recipient_id);
create unique index action_requests_one_open on public.action_requests(requester_id, recipient_id, request_type, entity_type, entity_id) where resolved_at is null;

-- One reminder per (request, number): a retried or concurrent delivery run never sends it twice.
create table public.action_request_reminders (
  request_id uuid not null references public.action_requests(id) on delete cascade,
  reminder_number integer not null,
  notification_id uuid,
  sent_at timestamptz not null default now(),
  primary key (request_id, reminder_number)
);

alter table public.record_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.record_events enable row level security;
alter table public.notification_digests enable row level security;
alter table public.record_event_deliveries enable row level security;
alter table public.action_requests enable row level security;
alter table public.action_request_reminders enable row level security;
revoke all on public.record_subscriptions, public.notification_preferences, public.record_events, public.notification_digests,
  public.record_event_deliveries, public.action_requests, public.action_request_reminders from public, anon, authenticated;
grant select on public.record_subscriptions, public.notification_preferences, public.notification_digests, public.action_requests to authenticated;
create policy record_subscriptions_own on public.record_subscriptions for select to authenticated
  using (user_id = auth.uid() and company_id = private.get_current_user_company_id());
create policy notification_preferences_own on public.notification_preferences for select to authenticated
  using (user_id = auth.uid() and company_id = private.get_current_user_company_id());
create policy notification_digests_own on public.notification_digests for select to authenticated
  using (user_id = auth.uid() and company_id = private.get_current_user_company_id());
create policy action_requests_party on public.action_requests for select to authenticated
  using (company_id = private.get_current_user_company_id() and auth.uid() in (requester_id, recipient_id));

-- Roles that may open (and so follow) each record type; mirrors the app's route permissions.
create or replace function private.follow_roles(p_type text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_type
    when 'order' then array['owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer']
    when 'production_job' then array['owner','admin','production_manager','production','factory_manager','viewer']
    when 'dispatch' then array['owner','admin','sales_manager','sales','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','viewer']
    when 'quality_inspection' then array['owner','admin','production_manager','quality','viewer']
    when 'quote' then array['owner','admin','sales_manager','sales','accounts','viewer']
    when 'invoice' then array['owner','admin','accounts','viewer']
    else array[]::text[] end
$$;
create or replace function private.follow_categories(p_type text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_type
    when 'order' then array['status','production','quality','dispatch','payment']
    when 'production_job' then array['status','quality']
    when 'dispatch' then array['dispatch']
    when 'quality_inspection' then array['quality']
    when 'quote' then array['status']
    when 'invoice' then array['payment']
    else array[]::text[] end
$$;
-- Who may be asked for each kind of action.
create or replace function private.action_request_roles(p_request text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_request
    when 'approve_quote' then array['owner','admin','sales_manager']
    when 'record_payment' then array['owner','admin','accounts']
    when 'release_qc' then array['owner','admin','factory_manager','production_manager','quality']
    when 'confirm_dispatch' then array['owner','admin','factory_manager','dispatch_manager','dispatch']
    else null end
$$;
create or replace function private.action_request_entities(p_request text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_request
    when 'approve_quote' then array['quote'] when 'record_payment' then array['invoice'] when 'release_qc' then array['quality_inspection']
    when 'confirm_dispatch' then array['dispatch','order']
    when 'general' then array['order','production_job','dispatch','quality_inspection','quote','invoice']
    else array[]::text[] end
$$;
revoke all on function private.follow_roles(text), private.follow_categories(text), private.action_request_roles(text), private.action_request_entities(text) from public, anon, authenticated;

create or replace function private.record_label(p_company uuid, p_type text, p_id uuid)
returns text language sql stable security definer set search_path = public, private as $$
  select coalesce(case p_type
    when 'order' then (select 'Order ' || order_number from public.orders where id = p_id and company_id = p_company)
    when 'production_job' then (select 'Job ' || job_number from public.production_jobs where id = p_id and company_id = p_company)
    when 'dispatch' then (select 'Dispatch ' || dispatch_number from public.dispatches where id = p_id and company_id = p_company)
    when 'quality_inspection' then (select 'Inspection' || coalesce(' batch ' || batch_number, '') from public.quality_inspections where id = p_id and company_id = p_company)
    when 'quote' then (select 'Quotation ' || quote_number from public.quotes where id = p_id and company_id = p_company)
    when 'invoice' then (select 'Invoice ' || invoice_number from public.invoices where id = p_id and company_id = p_company)
  end, replace(p_type, '_', ' '))
$$;
revoke all on function private.record_label(uuid, text, uuid) from public, anon, authenticated;

-- Quiet hours are whole IST hours and may wrap midnight (22 to 7).
create or replace function private.in_quiet_hours(p_start smallint, p_end smallint, p_at timestamptz)
returns boolean language sql immutable set search_path = public, private as $$
  select case when p_start is null then false
    when p_start < p_end then extract(hour from p_at at time zone 'Asia/Kolkata') >= p_start and extract(hour from p_at at time zone 'Asia/Kolkata') < p_end
    else extract(hour from p_at at time zone 'Asia/Kolkata') >= p_start or extract(hour from p_at at time zone 'Asia/Kolkata') < p_end end
$$;
revoke all on function private.in_quiet_hours(smallint, smallint, timestamptz) from public, anon, authenticated;

-- Records an event only when someone follows the record.
create or replace function private.emit_record_event(p_company uuid, p_type text, p_id uuid, p_category text, p_summary text)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if p_id is null or not exists (select 1 from public.record_subscriptions where company_id = p_company and entity_type = p_type and entity_id = p_id) then return; end if;
  insert into public.record_events(company_id, entity_type, entity_id, label, category, summary, actor_id)
  values (p_company, p_type, p_id, private.record_label(p_company, p_type, p_id), p_category, left(p_summary, 200), auth.uid());
end;
$$;
revoke all on function private.emit_record_event(uuid, text, uuid, text, text) from public, anon, authenticated;

create or replace function private.record_event_from_source()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_order uuid; v_job uuid;
begin
  if tg_table_name = 'orders' then
    if new.current_stage is distinct from old.current_stage then
      perform private.emit_record_event(new.company_id, 'order', new.id, 'status', format('Stage %s → %s', replace(old.current_stage, '_', ' '), replace(new.current_stage, '_', ' ')));
    end if;
  elsif tg_table_name = 'production_jobs' then
    if new.status is distinct from old.status then
      perform private.emit_record_event(new.company_id, 'production_job', new.id, 'status', format('Status %s → %s', replace(old.status, '_', ' '), replace(new.status, '_', ' ')));
      perform private.emit_record_event(new.company_id, 'order', new.order_id, 'production', format('Job %s %s', new.job_number, replace(new.status, '_', ' ')));
    end if;
  elsif tg_table_name = 'dispatches' then
    if tg_op = 'INSERT' or new.delivery_status is distinct from old.delivery_status then
      perform private.emit_record_event(new.company_id, 'dispatch', new.id, 'dispatch', format('Delivery %s', replace(new.delivery_status, '_', ' ')));
      perform private.emit_record_event(new.company_id, 'order', new.order_id, 'dispatch', format('Dispatch %s %s', new.dispatch_number, replace(new.delivery_status, '_', ' ')));
    end if;
  elsif tg_table_name = 'quality_inspections' then
    if new.status is distinct from old.status then
      select j.id, j.order_id into v_job, v_order from public.production_jobs j where j.id = new.production_job_id and j.company_id = new.company_id;
      perform private.emit_record_event(new.company_id, 'quality_inspection', new.id, 'quality', format('Inspection %s', new.status));
      perform private.emit_record_event(new.company_id, 'production_job', v_job, 'quality', format('Inspection%s %s', coalesce(' of batch ' || new.batch_number, ''), new.status));
      perform private.emit_record_event(new.company_id, 'order', v_order, 'quality', format('Inspection%s %s', coalesce(' of batch ' || new.batch_number, ''), new.status));
    end if;
  elsif tg_table_name = 'quotes' then
    if new.status is distinct from old.status then
      perform private.emit_record_event(new.company_id, 'quote', new.id, 'status', format('Status %s → %s', replace(old.status, '_', ' '), replace(new.status, '_', ' ')));
    end if;
  elsif tg_table_name = 'invoices' then
    if new.status is distinct from old.status or new.amount_paid is distinct from old.amount_paid then
      perform private.emit_record_event(new.company_id, 'invoice', new.id, 'payment',
        case when new.amount_paid is distinct from old.amount_paid then format('Paid INR %s, balance INR %s', to_char(new.amount_paid, 'FM99999999990.00'), to_char(new.balance_due, 'FM99999999990.00'))
          else format('Status %s → %s', replace(old.status, '_', ' '), replace(new.status, '_', ' ')) end);
      perform private.emit_record_event(new.company_id, 'order', new.order_id, 'payment', format('Invoice %s %s', new.invoice_number, replace(new.status, '_', ' ')));
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.record_event_from_source() from public, anon, authenticated;
drop trigger if exists zz_record_event_orders on public.orders;
create trigger zz_record_event_orders after update of current_stage on public.orders for each row execute function private.record_event_from_source();
drop trigger if exists zz_record_event_production_jobs on public.production_jobs;
create trigger zz_record_event_production_jobs after update of status on public.production_jobs for each row execute function private.record_event_from_source();
drop trigger if exists zz_record_event_dispatches on public.dispatches;
create trigger zz_record_event_dispatches after insert or update of delivery_status on public.dispatches for each row execute function private.record_event_from_source();
drop trigger if exists zz_record_event_quality_inspections on public.quality_inspections;
create trigger zz_record_event_quality_inspections after update of status on public.quality_inspections for each row execute function private.record_event_from_source();
drop trigger if exists zz_record_event_quotes on public.quotes;
create trigger zz_record_event_quotes after update of status on public.quotes for each row execute function private.record_event_from_source();
drop trigger if exists zz_record_event_invoices on public.invoices;
create trigger zz_record_event_invoices after update of status, amount_paid on public.invoices for each row execute function private.record_event_from_source();

-- Delivers one employee's pending events as a single digest. Returns the number of records in it.
create or replace function private.deliver_user_digest(p_company uuid, p_user uuid, p_force boolean)
returns integer language plpgsql security definer set search_path = public, private as $$
declare
  u record; p public.notification_preferences%rowtype; v_now timestamptz := clock_timestamp(); v_items jsonb; v_records integer; v_events integer;
  v_digest uuid; v_notification uuid; v_start timestamptz; v_ids uuid[];
begin
  select id, role into u from public.app_users where id = p_user and company_id = p_company and is_active and dealer_id is null;
  if u.id is null then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':record-digest', 0));
  select * into p from public.notification_preferences where user_id = p_user;
  if not p_force then
    if private.in_quiet_hours(p.quiet_start, p.quiet_end, v_now) then return 0; end if;
    if coalesce(p.digest_mode, 'immediate') = 'hourly' and p.last_digest_at > v_now - interval '1 hour' then return 0; end if;
    if p.digest_mode = 'daily' and (extract(hour from v_now at time zone 'Asia/Kolkata') < p.daily_hour
        or (p.last_digest_at at time zone 'Asia/Kolkata')::date = (v_now at time zone 'Asia/Kolkata')::date) then return 0; end if;
  end if;
  select coalesce(array_agg(e.id), '{}') into v_ids
  from public.record_events e
  join public.record_subscriptions s on s.company_id = e.company_id and s.user_id = p_user and s.entity_type = e.entity_type and s.entity_id = e.entity_id
  where e.company_id = p_company and e.category = any(s.categories) and not (e.category = any(coalesce(p.muted_categories, '{}')))
    and e.occurred_at >= s.created_at and e.actor_id is distinct from p_user and u.role = any(private.follow_roles(e.entity_type))
    and not exists (select 1 from public.record_event_deliveries d where d.event_id = e.id and d.user_id = p_user);
  if cardinality(v_ids) = 0 then return 0; end if;
  select count(distinct (entity_type, entity_id)), count(*), min(occurred_at) into v_records, v_events, v_start from public.record_events where id = any(v_ids);
  select jsonb_agg(item order by last_at desc) into v_items from (
    select jsonb_build_object('entity_type', entity_type, 'entity_id', entity_id, 'label', (array_agg(label order by occurred_at desc))[1], 'updates', count(*),
      'latest', (array_agg(summary order by occurred_at desc))[1], 'earlier', to_jsonb((array_agg(summary order by occurred_at desc))[2:3]), 'last_at', max(occurred_at)) item, max(occurred_at) last_at
    from public.record_events where id = any(v_ids) group by entity_type, entity_id order by max(occurred_at) desc limit 50) grouped;
  v_digest := gen_random_uuid();
  insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, created_by, action_link)
  values (p_company, p_user, 'record_digest', 'info', format('%s update%s on %s followed record%s', v_events, case when v_events = 1 then '' else 's' end, v_records, case when v_records = 1 then '' else 's' end),
    left((select string_agg(format('%s · %s update%s · latest: %s', i ->> 'label', i ->> 'updates', case when (i ->> 'updates')::integer = 1 then '' else 's' end, i ->> 'latest'), E'\n')
      from (select i from jsonb_array_elements(v_items) i limit 5) top) || case when v_records > 5 then format(E'\nand %s more record%s', v_records - 5, case when v_records - 5 = 1 then '' else 's' end) else '' end, 1000),
    'notification_digest', null, '/notifications/following')
  returning id into v_notification;
  insert into public.notification_digests(id, company_id, user_id, period_start, period_end, record_count, event_count, items, notification_id)
  values (v_digest, p_company, p_user, v_start, v_now, v_records, v_events, v_items, v_notification);
  insert into public.record_event_deliveries(event_id, user_id, digest_id) select unnest(v_ids), p_user, v_digest on conflict do nothing;
  insert into public.notification_preferences(user_id, company_id, last_digest_at) values (p_user, p_company, v_now)
  on conflict (user_id) do update set last_digest_at = v_now;
  return v_records;
end;
$$;
revoke all on function private.deliver_user_digest(uuid, uuid, boolean) from public, anon, authenticated;

-- Whether the condition an action request waits for now holds; null while it does not.
create or replace function private.action_request_resolution(r public.action_requests)
returns text language plpgsql stable security definer set search_path = public, private as $$
declare v_state text := private.task_source_state(r.company_id, r.entity_type, r.entity_id);
begin
  if v_state is null then return 'source_missing'; end if;
  return case
    when r.request_type = 'approve_quote' and v_state not in ('draft','internal_review') then 'condition_met'
    when r.request_type = 'record_payment' and v_state in ('paid','cancelled','credited') then 'condition_met'
    when r.request_type = 'release_qc' and v_state <> 'pending' then 'condition_met'
    when r.request_type = 'confirm_dispatch' and r.entity_type = 'dispatch' and v_state in ('delivered','returned') then 'condition_met'
    when r.request_type = 'confirm_dispatch' and r.entity_type = 'order' and v_state in ('dispatched','delivered','payment_pending','closed','cancelled') then 'condition_met'
  end;
end;
$$;
revoke all on function private.action_request_resolution(public.action_requests) from public, anon, authenticated;

-- Resolves satisfied requests and sends due reminders for the rest. Returns counts.
create or replace function private.process_action_requests(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare r public.action_requests%rowtype; v_resolution text; v_resolved integer := 0; v_reminded integer := 0; p record; v_recipient record; v_notification uuid;
begin
  for r in select * from public.action_requests where company_id = p_company and resolved_at is null order by created_at, id for update skip locked loop
    v_resolution := private.action_request_resolution(r);
    select id, role into v_recipient from public.app_users where id = r.recipient_id and company_id = p_company and is_active and dealer_id is null;
    if v_resolution is null and (v_recipient.id is null or not (v_recipient.role = any(coalesce(private.action_request_roles(r.request_type), private.follow_roles(r.entity_type))))) then
      v_resolution := 'recipient_unavailable';
    end if;
    if v_resolution is not null then
      update public.action_requests set resolved_at = now(), resolution = v_resolution where id = r.id;
      insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
      values (p_company, r.requester_id, 'action_request_closed', case when v_resolution = 'condition_met' then 'success' else 'warning' end,
        left(case v_resolution when 'condition_met' then 'Done: ' when 'source_missing' then 'Record no longer available: ' else 'Ask someone else: ' end || r.label, 200),
        case v_resolution when 'condition_met' then concat('Your request "', r.message, '" is resolved.') when 'source_missing' then 'The record was removed, so reminders stopped.'
          else 'The person you asked can no longer act on this. Send the request to someone else.' end,
        r.entity_type, r.entity_id, null, '/notifications/requests?box=sent&state=resolved');
      v_resolved := v_resolved + 1;
      continue;
    end if;
    select quiet_start, quiet_end into p from public.notification_preferences where user_id = r.recipient_id;
    if r.reminder_count < 10 and coalesce(r.last_reminded_at, r.created_at) <= now() - make_interval(hours => r.reminder_hours)
       and not private.in_quiet_hours(p.quiet_start, p.quiet_end, now()) then
      insert into public.action_request_reminders(request_id, reminder_number) values (r.id, r.reminder_count + 1) on conflict do nothing;
      if found then
        insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
        values (p_company, r.recipient_id, 'action_request_reminder', 'warning', left(format('Reminder %s: %s', r.reminder_count + 1, r.label), 200),
          concat((select coalesce(full_name, 'A colleague') from public.app_users where id = r.requester_id), ' is waiting: ', r.message), r.entity_type, r.entity_id, null, '/notifications/requests')
        returning id into v_notification;
        update public.action_request_reminders set notification_id = v_notification where request_id = r.id and reminder_number = r.reminder_count + 1;
        update public.action_requests set reminder_count = reminder_count + 1, last_reminded_at = now() where id = r.id;
        v_reminded := v_reminded + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('resolved', v_resolved, 'reminded', v_reminded);
end;
$$;
revoke all on function private.process_action_requests(uuid) from public, anon, authenticated;

create or replace function private.deliver_company_notifications(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_user uuid; v_digests integer := 0; v_requests jsonb;
begin
  for v_user in select distinct user_id from public.record_subscriptions where company_id = p_company order by user_id loop
    if private.deliver_user_digest(p_company, v_user, false) > 0 then v_digests := v_digests + 1; end if;
  end loop;
  v_requests := private.process_action_requests(p_company);
  return jsonb_build_object('digests', v_digests) || v_requests;
end;
$$;
revoke all on function private.deliver_company_notifications(uuid) from public, anon, authenticated;

-- Scheduler entry point (pg_cron, no signed-in user). Example:
--   select cron.schedule('record-notifications', '*/15 * * * *', 'select private.run_notification_delivery_for_all()');
create or replace function private.run_notification_delivery_for_all()
returns integer language plpgsql security definer set search_path = public, private as $$
declare v_company uuid; v_count integer := 0;
begin
  for v_company in select company_id from public.record_subscriptions union select company_id from public.action_requests where resolved_at is null loop
    perform private.deliver_company_notifications(v_company);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.run_notification_delivery_for_all() from public, anon, authenticated;

create or replace function public.subscription_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text; v_type text; v_id uuid; v_categories text[]; v_page integer; v_total bigint; v_rows jsonb; r public.action_requests%rowtype;
  v_recipient record; v_text text; v_hours integer; v_roles text[];
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid notification request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if v_name is null or p_command not in ('follow.status','follow.set','follow.remove','follow.list','prefs.get','prefs.set','digest.list','digest.now',
       'request.recipients','request.create','request.list','request.close','delivery.run')
     or (p_command = 'delivery.run' and v_role not in ('owner','admin','factory_manager')) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;
  begin
    v_page := coalesce((p_payload ->> 'page')::integer, 1);
    v_id := nullif(p_payload ->> 'entity_id', '')::uuid;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid notification request'; end;
  if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
  v_type := p_payload ->> 'entity_type';

  -- Record-scoped commands check the record exists here and the employee may open it.
  if p_command in ('follow.status','follow.set','follow.remove','request.recipients','request.create') then
    if v_type is null or cardinality(private.follow_roles(v_type)) = 0 or v_id is null then raise exception 'Invalid notification request'; end if;
    if not (v_role = any(private.follow_roles(v_type))) then raise exception 'You cannot open this kind of record' using errcode = '42501'; end if;
    if private.task_source_state(v_company, v_type, v_id) is null then raise exception 'Record is unavailable'; end if;
  end if;

  if p_command = 'follow.status' then
    return jsonb_build_object('following', exists (select 1 from public.record_subscriptions where user_id = v_actor and entity_type = v_type and entity_id = v_id),
      'categories', coalesce((select to_jsonb(categories) from public.record_subscriptions where user_id = v_actor and entity_type = v_type and entity_id = v_id), '[]'::jsonb),
      'available', to_jsonb(private.follow_categories(v_type)));

  elsif p_command = 'follow.set' then
    if jsonb_typeof(p_payload -> 'categories') is distinct from 'array' then raise exception 'Choose at least one kind of update to follow'; end if;
    select coalesce(array_agg(distinct value), '{}') into v_categories from jsonb_array_elements_text(p_payload -> 'categories');
    if cardinality(v_categories) = 0 then raise exception 'Choose at least one kind of update to follow'; end if;
    if not (v_categories <@ private.follow_categories(v_type)) then raise exception 'A chosen kind of update does not apply to this record'; end if;
    if not exists (select 1 from public.record_subscriptions where user_id = v_actor and entity_type = v_type and entity_id = v_id)
       and (select count(*) from public.record_subscriptions where user_id = v_actor) >= 200 then
      raise exception 'You can follow at most 200 records. Unfollow some first';
    end if;
    insert into public.record_subscriptions(company_id, user_id, entity_type, entity_id, categories) values (v_company, v_actor, v_type, v_id, v_categories)
    on conflict (user_id, entity_type, entity_id) do update set categories = excluded.categories;
    return jsonb_build_object('following', true, 'categories', to_jsonb(v_categories));

  elsif p_command = 'follow.remove' then
    delete from public.record_subscriptions where user_id = v_actor and entity_type = v_type and entity_id = v_id;
    return jsonb_build_object('following', false);

  elsif p_command = 'follow.list' then
    select count(*), coalesce((select jsonb_agg(jsonb_build_object('entity_type', s.entity_type, 'entity_id', s.entity_id, 'categories', to_jsonb(s.categories), 'created_at', s.created_at,
        'label', private.record_label(v_company, s.entity_type, s.entity_id), 'state', private.task_source_state(v_company, s.entity_type, s.entity_id),
        'can_open', v_role = any(private.follow_roles(s.entity_type))) order by s.created_at desc, s.id)
      from (select * from public.record_subscriptions where user_id = v_actor and company_id = v_company order by created_at desc, id limit 10 offset (v_page - 1) * 10) s), '[]'::jsonb)
    into v_total, v_rows from public.record_subscriptions where user_id = v_actor and company_id = v_company;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total);

  elsif p_command = 'prefs.get' then
    return coalesce((select to_jsonb(x) - 'company_id' - 'user_id' from public.notification_preferences x where x.user_id = v_actor),
      jsonb_build_object('digest_mode', 'immediate', 'daily_hour', 18, 'quiet_start', null, 'quiet_end', null, 'muted_categories', '[]'::jsonb, 'last_digest_at', null, 'updated_at', null));

  elsif p_command = 'prefs.set' then
    begin
      insert into public.notification_preferences(user_id, company_id, digest_mode, daily_hour, quiet_start, quiet_end, muted_categories, updated_at)
      values (v_actor, v_company, coalesce(p_payload ->> 'digest_mode', 'immediate'), coalesce((p_payload ->> 'daily_hour')::smallint, 18),
        nullif(p_payload ->> 'quiet_start', '')::smallint, nullif(p_payload ->> 'quiet_end', '')::smallint,
        coalesce((select array_agg(distinct value) from jsonb_array_elements_text(coalesce(p_payload -> 'muted_categories', '[]'::jsonb))), '{}'), now())
      on conflict (user_id) do update set digest_mode = excluded.digest_mode, daily_hour = excluded.daily_hour, quiet_start = excluded.quiet_start,
        quiet_end = excluded.quiet_end, muted_categories = excluded.muted_categories, updated_at = now();
    exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Choose immediate, hourly or daily digests, hours from 0 to 23, and quiet hours with a different start and end';
    end;
    return (select to_jsonb(x) - 'company_id' - 'user_id' from public.notification_preferences x where x.user_id = v_actor);

  elsif p_command = 'digest.now' then
    return jsonb_build_object('records', private.deliver_user_digest(v_company, v_actor, true));

  elsif p_command = 'digest.list' then
    select count(*), coalesce((select jsonb_agg(to_jsonb(d) - 'company_id' - 'user_id' order by d.created_at desc, d.id)
      from (select * from public.notification_digests where user_id = v_actor and company_id = v_company order by created_at desc, id limit 10 offset (v_page - 1) * 10) d), '[]'::jsonb)
    into v_total, v_rows from public.notification_digests where user_id = v_actor and company_id = v_company;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total);

  elsif p_command = 'delivery.run' then
    return private.deliver_company_notifications(v_company);

  elsif p_command = 'request.recipients' then
    if cardinality(private.action_request_entities(p_payload ->> 'request_type')) = 0 or not (v_type = any(private.action_request_entities(p_payload ->> 'request_type'))) then
      raise exception 'This kind of request does not apply to this record';
    end if;
    v_roles := coalesce(private.action_request_roles(p_payload ->> 'request_type'), private.follow_roles(v_type));
    return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', coalesce(u.full_name, 'Employee'), 'role', u.role) order by u.full_name, u.id)
      from public.app_users u where u.company_id = v_company and u.is_active and u.dealer_id is null and u.id <> v_actor
        and u.role = any(v_roles) and u.role = any(private.follow_roles(v_type))), '[]'::jsonb);

  elsif p_command = 'request.create' then
    begin r.id := (p_payload ->> 'id')::uuid; v_hours := coalesce((p_payload ->> 'reminder_hours')::integer, 4);
    exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid notification request'; end;
    if r.id is null then raise exception 'Invalid notification request'; end if;
    select * into r from public.action_requests where id = r.id;
    if found then
      if r.requester_id = v_actor then return jsonb_build_object('id', r.id, 'replayed', true); end if;
      raise exception 'Invalid notification request';
    end if;
    r.id := (p_payload ->> 'id')::uuid; r.request_type := p_payload ->> 'request_type';
    if cardinality(private.action_request_entities(r.request_type)) = 0 or not (v_type = any(private.action_request_entities(r.request_type))) then
      raise exception 'This kind of request does not apply to this record';
    end if;
    v_text := btrim(coalesce(p_payload ->> 'message', ''));
    if length(v_text) not between 3 and 300 then raise exception 'Say what you need (3 to 300 characters)'; end if;
    if v_hours not between 1 and 72 then raise exception 'Remind every 1 to 72 hours'; end if;
    select id, role, full_name into v_recipient from public.app_users
    where id = nullif(p_payload ->> 'recipient_id', '')::uuid and company_id = v_company and is_active and dealer_id is null and id <> v_actor;
    if v_recipient.id is null or not (v_recipient.role = any(coalesce(private.action_request_roles(r.request_type), private.follow_roles(v_type))))
       or not (v_recipient.role = any(private.follow_roles(v_type))) then
      raise exception 'The chosen person cannot act on this request';
    end if;
    r.label := private.record_label(v_company, v_type, v_id);
    r.company_id := v_company; r.requester_id := v_actor; r.recipient_id := v_recipient.id; r.entity_type := v_type; r.entity_id := v_id;
    if private.action_request_resolution(r) is not null then raise exception 'This is already done: nothing to request'; end if;
    begin
      insert into public.action_requests(id, company_id, requester_id, recipient_id, request_type, entity_type, entity_id, label, message, reminder_hours)
      values (r.id, v_company, v_actor, v_recipient.id, r.request_type, v_type, v_id, r.label, v_text, v_hours);
    exception when unique_violation then raise exception 'You already have an open request to this person for this record'; end;
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
    values (v_company, v_recipient.id, 'action_request', 'warning', left(format('Action needed: %s', r.label), 200), concat(v_name, ': ', v_text), v_type, v_id, v_actor, '/notifications/requests');
    return jsonb_build_object('id', r.id, 'replayed', false);

  elsif p_command = 'request.close' then
    select * into r from public.action_requests where id = nullif(p_payload ->> 'id', '')::uuid and company_id = v_company for update;
    if not found or v_actor not in (r.requester_id, r.recipient_id) then raise exception 'Request is unavailable'; end if;
    if r.resolved_at is not null then raise exception 'This request is already closed'; end if;
    v_text := nullif(left(btrim(coalesce(p_payload ->> 'note', '')), 300), '');
    update public.action_requests set resolved_at = now(), resolution = case when v_actor = r.recipient_id then 'done' else 'cancelled' end, resolution_note = v_text where id = r.id;
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
    values (v_company, case when v_actor = r.recipient_id then r.requester_id else r.recipient_id end, 'action_request_closed', 'info',
      left(case when v_actor = r.recipient_id then 'Done: ' else 'No longer needed: ' end || r.label, 200), concat(v_name, coalesce(': ' || v_text, ' closed the request.')),
      r.entity_type, r.entity_id, v_actor, '/notifications/requests');
    return jsonb_build_object('id', r.id, 'resolution', case when v_actor = r.recipient_id then 'done' else 'cancelled' end);
  end if;

  -- request.list: inbox (asked of me) or sent, open or resolved, 10 per page. Open requests are
  -- rechecked, so a satisfied request shows as resolved even before the next delivery run.
  if coalesce(p_payload ->> 'box', 'inbox') not in ('inbox','sent') or coalesce(p_payload ->> 'state', 'open') not in ('open','resolved') then raise exception 'Invalid notification request'; end if;
  with visible as (
    select a.*, case when a.resolved_at is null then private.action_request_resolution(a) end live_resolution from public.action_requests a
    where a.company_id = v_company and (case when coalesce(p_payload ->> 'box', 'inbox') = 'inbox' then a.recipient_id else a.requester_id end) = v_actor
  ), filtered as (
    select * from visible where case when coalesce(p_payload ->> 'state', 'open') = 'open' then resolved_at is null and live_resolution is null else resolved_at is not null or live_resolution is not null end
  )
  select (select count(*) from filtered),
    coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'request_type', x.request_type, 'entity_type', x.entity_type, 'entity_id', x.entity_id, 'label', x.label, 'message', x.message,
        'requester_name', (select full_name from public.app_users where id = x.requester_id), 'recipient_name', (select full_name from public.app_users where id = x.recipient_id),
        'created_at', x.created_at, 'reminder_count', x.reminder_count, 'reminder_hours', x.reminder_hours, 'resolved_at', x.resolved_at,
        'resolution', coalesce(x.resolution, x.live_resolution), 'resolution_note', x.resolution_note, 'can_close', x.resolved_at is null and x.live_resolution is null) order by x.created_at desc, x.id)
      from (select * from filtered order by created_at desc, id limit 10 offset (v_page - 1) * 10) x), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;
revoke all on function public.subscription_command(text, jsonb) from public, anon;
grant execute on function public.subscription_command(text, jsonb) to authenticated;

commit;
