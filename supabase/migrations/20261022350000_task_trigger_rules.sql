-- UPGRADE_EOS feature 64: tasks created and assigned from defined triggers.
--
-- A company defines rules. Each rule names a confirmed event, a threshold, who receives the work
-- and a due-date policy:
--   * order_dispatch_overdue  an open order is past its expected dispatch date by N days
--   * inspection_rejected     a quality inspection is rejected (raised in the same transaction)
--   * breakdown_open          a machine breakdown is still open after N hours
--   * quote_expiring          a sent quotation expires within N days
--   * invoice_overdue         an invoice with a balance is past its due date by N days
-- Assignee: a role (the least-loaded active employee of that role) or a named employee, with an
-- optional fallback role. Work that cannot be assigned is created unassigned, flagged, and listed
-- for recovery; it is never dropped. Every task carries a unique key per (rule, source record,
-- occurrence), so a retried, replayed or concurrent run creates at most one task. A run is
-- recorded by its request id, so retrying the same request after a connection failure returns the
-- original result without side effects. The source reference of a created task is immutable.
-- Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.task_trigger_rules (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  name text not null check (length(btrim(name)) between 3 and 120),
  event_type text not null check (event_type in ('order_dispatch_overdue','inspection_rejected','breakdown_open','quote_expiring','invoice_overdue')),
  threshold integer not null default 0,
  lookback_days integer not null default 7 check (lookback_days between 0 and 90),
  assignee_mode text not null check (assignee_mode in ('role','person')),
  assignee_role text,
  assignee_user_id uuid references public.app_users(id),
  due_days integer not null default 1 check (due_days between 0 and 30),
  due_calendar text not null default 'working_days' check (due_calendar in ('calendar','working_days')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  is_active boolean not null default true,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default now(),
  check (case event_type when 'breakdown_open' then threshold between 1 and 720 when 'inspection_rejected' then threshold = 0
         when 'quote_expiring' then threshold between 0 and 60 else threshold between 0 and 365 end),
  check ((assignee_mode = 'role' and assignee_role is not null and assignee_user_id is null) or (assignee_mode = 'person' and assignee_user_id is not null))
);
create index task_trigger_rules_company_idx on public.task_trigger_rules(company_id, event_type, is_active);
create index task_trigger_rules_assignee_idx on public.task_trigger_rules(assignee_user_id);
create index task_trigger_rules_created_by_idx on public.task_trigger_rules(created_by);
create index task_trigger_rules_updated_by_idx on public.task_trigger_rules(updated_by);

create table public.task_trigger_runs (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  started_by uuid references public.app_users(id),
  started_at timestamptz not null default now(),
  result jsonb not null
);
create index task_trigger_runs_company_idx on public.task_trigger_runs(company_id, started_at desc);
create index task_trigger_runs_started_by_idx on public.task_trigger_runs(started_by);

alter table public.tasks
  add column if not exists trigger_rule_id uuid references public.task_trigger_rules(id),
  add column if not exists trigger_key text,
  add column if not exists trigger_source_type text,
  add column if not exists trigger_source_id uuid,
  add column if not exists trigger_event_at timestamptz,
  add column if not exists trigger_assignment text,
  add column if not exists trigger_assignment_note text;
alter table public.tasks drop constraint if exists tasks_trigger_shape_check;
alter table public.tasks add constraint tasks_trigger_shape_check check (
  (trigger_key is null and trigger_rule_id is null and trigger_source_type is null and trigger_source_id is null and trigger_event_at is null and trigger_assignment is null)
  or (trigger_key is not null and trigger_rule_id is not null and trigger_source_id is not null and trigger_event_at is not null
      and trigger_source_type in ('order','quality_inspection','breakdown_log','quote','invoice') and trigger_assignment in ('assigned','unassigned')));
create unique index if not exists tasks_trigger_key_unique on public.tasks(company_id, trigger_key) where trigger_key is not null;
create index if not exists tasks_trigger_rule_idx on public.tasks(company_id, trigger_rule_id, status) where trigger_key is not null;
create index if not exists tasks_trigger_rule_fk_idx on public.tasks(trigger_rule_id);

alter table public.task_trigger_rules enable row level security;
alter table public.task_trigger_runs enable row level security;
revoke all on public.task_trigger_rules, public.task_trigger_runs from public, anon, authenticated;
grant select on public.task_trigger_rules, public.task_trigger_runs to authenticated;
create policy task_trigger_rules_read on public.task_trigger_rules for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','factory_manager','production_manager','dispatch_manager','sales_manager'));
create policy task_trigger_runs_read on public.task_trigger_runs for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','factory_manager'));

-- Roles that may receive each kind of work.
create or replace function private.task_trigger_event_roles(p_event text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_event
    when 'order_dispatch_overdue' then array['owner','admin','factory_manager','dispatch_manager','dispatch','production_manager','sales_manager','sales']
    when 'inspection_rejected' then array['owner','admin','factory_manager','quality','production_manager','production']
    when 'breakdown_open' then array['owner','admin','factory_manager','production_manager','production']
    when 'quote_expiring' then array['owner','admin','sales_manager','sales']
    when 'invoice_overdue' then array['owner','admin','accounts','sales_manager','sales']
    else array[]::text[] end
$$;
-- Who hears about work nobody could be assigned to.
create or replace function private.task_trigger_recovery_role(p_event text)
returns text language sql immutable set search_path = public, private as $$
  select case p_event when 'order_dispatch_overdue' then 'dispatch_manager' when 'breakdown_open' then 'production_manager'
    when 'quote_expiring' then 'sales_manager' when 'invoice_overdue' then 'owner' else 'factory_manager' end
$$;
create or replace function private.task_trigger_task_type(p_event text)
returns text language sql immutable set search_path = public, private as $$
  select case p_event when 'order_dispatch_overdue' then 'dispatch_follow_up' when 'inspection_rejected' then 'quality_follow_up'
    when 'breakdown_open' then 'breakdown_follow_up' when 'quote_expiring' then 'quote_follow_up' else 'collection_follow_up' end
$$;
-- Supervisors (not managers) see recovery work for events their teams can take.
create or replace function private.task_trigger_scope(p_role text)
returns text[] language sql immutable set search_path = public, private as $$
  select case when p_role in ('owner','admin','factory_manager') then array['order_dispatch_overdue','inspection_rejected','breakdown_open','quote_expiring','invoice_overdue']
    when p_role = 'production_manager' then array['inspection_rejected','breakdown_open','order_dispatch_overdue']
    when p_role = 'dispatch_manager' then array['order_dispatch_overdue']
    when p_role = 'sales_manager' then array['quote_expiring','invoice_overdue','order_dispatch_overdue']
    else array[]::text[] end
$$;
-- Due date: N calendar days, or N working days (Monday to Saturday) from today.
create or replace function private.task_trigger_due(p_from date, p_days integer, p_calendar text)
returns date language plpgsql immutable set search_path = public, private as $$
declare v date := p_from; v_left integer := greatest(p_days, 0);
begin
  if p_calendar = 'calendar' then return p_from + v_left; end if;
  while extract(isodow from v) = 7 loop v := v + 1; end loop;
  while v_left > 0 loop
    v := v + 1;
    if extract(isodow from v) <> 7 then v_left := v_left - 1; end if;
  end loop;
  return v;
end;
$$;
revoke all on function private.task_trigger_event_roles(text), private.task_trigger_recovery_role(text), private.task_trigger_task_type(text),
  private.task_trigger_scope(text), private.task_trigger_due(date, integer, text) from public, anon, authenticated;

-- The employee the rule assigns to now, or null with the reason.
create or replace function private.task_trigger_pick(p_rule public.task_trigger_rules, out o_user uuid, out o_note text)
language plpgsql stable security definer set search_path = public, private as $$
declare v_roles text[] := private.task_trigger_event_roles(p_rule.event_type); v_role text := p_rule.assignee_role;
begin
  if p_rule.assignee_mode = 'person' then
    select u.id into o_user from public.app_users u
    where u.id = p_rule.assignee_user_id and u.company_id = p_rule.company_id and u.is_active and u.dealer_id is null and u.role = any(v_roles);
    if o_user is not null then return; end if;
    if v_role is null then o_note := 'The named employee is inactive or can no longer take this work, and the rule has no fallback role'; return; end if;
  end if;
  if not (v_role = any(v_roles)) then o_note := format('The %s role can no longer take this work', replace(v_role, '_', ' ')); return; end if;
  select u.id into o_user from public.app_users u
  where u.company_id = p_rule.company_id and u.is_active and u.dealer_id is null and u.role = v_role
  order by (select count(*) from public.tasks t where t.company_id = p_rule.company_id and t.assigned_to = u.id and t.status in ('open','in_progress')), u.full_name nulls last, u.id
  limit 1;
  if o_user is null then o_note := format('No active %s employee is available', replace(v_role, '_', ' '));
  elsif p_rule.assignee_mode = 'person' then o_note := 'The named employee was unavailable, so the fallback role was used';
  end if;
end;
$$;
revoke all on function private.task_trigger_pick(public.task_trigger_rules) from public, anon, authenticated;

-- Creates the task once per (rule, source, occurrence). Returns 'created', 'unassigned' or 'existing'.
create or replace function private.task_trigger_raise(p_rule public.task_trigger_rules, p_source_type text, p_source_id uuid, p_occurrence text,
  p_event_at timestamptz, p_title text, p_description text)
returns text language plpgsql security definer set search_path = public, private as $$
declare
  v_key text := p_rule.id::text || ':' || p_source_type || ':' || p_source_id::text || coalesce(':' || p_occurrence, '');
  v_pick record; v_id uuid; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if exists (select 1 from public.tasks where company_id = p_rule.company_id and trigger_key = v_key) then return 'existing'; end if;
  select * into v_pick from private.task_trigger_pick(p_rule);
  insert into public.tasks(company_id, task_type, title, description, priority, status, assigned_to, due_date, related_entity_type, related_entity_id, created_by,
    trigger_rule_id, trigger_key, trigger_source_type, trigger_source_id, trigger_event_at, trigger_assignment, trigger_assignment_note)
  values (p_rule.company_id, private.task_trigger_task_type(p_rule.event_type), left(p_title, 200), left(p_description, 1000), p_rule.priority, 'open', v_pick.o_user,
    private.task_trigger_due(v_today, p_rule.due_days, p_rule.due_calendar), p_source_type, p_source_id, auth.uid(),
    p_rule.id, v_key, p_source_type, p_source_id, p_event_at, case when v_pick.o_user is null then 'unassigned' else 'assigned' end, v_pick.o_note)
  on conflict (company_id, trigger_key) where trigger_key is not null do nothing
  returning id into v_id;
  if v_id is null then return 'existing'; end if;
  if v_pick.o_user is null then
    insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
    values (p_rule.company_id, private.task_trigger_recovery_role(p_rule.event_type), 'task_trigger_unassigned', 'warning', left('Unassigned: ' || p_title, 200),
      concat(v_pick.o_note, '. Assign it from Task triggers > Unassigned work.'), 'task', v_id, auth.uid(), '/tasks/triggers?view=unassigned');
  else
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
    values (p_rule.company_id, v_pick.o_user, 'task_trigger_assigned', 'info', left(p_title, 200), concat('Created by the rule "', p_rule.name, '".'), 'task', v_id, auth.uid(), '/tasks/' || v_id);
  end if;
  return case when v_pick.o_user is null then 'unassigned' else 'created' end;
end;
$$;
revoke all on function private.task_trigger_raise(public.task_trigger_rules, text, uuid, text, timestamptz, text, text) from public, anon, authenticated;

-- Whether the condition that created the work still holds (shown beside each task).
create or replace function private.task_trigger_source_open(p_company uuid, p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path = public, private as $$
  select case p_type
    when 'order' then exists (select 1 from public.orders o where o.id = p_id and o.company_id = p_company and o.deleted_at is null
      and o.current_stage not in ('dispatched','delivered','payment_pending','closed','cancelled'))
    when 'quality_inspection' then exists (select 1 from public.quality_inspections q where q.id = p_id and q.company_id = p_company and q.status = 'rejected')
    when 'breakdown_log' then exists (select 1 from public.breakdown_logs b where b.id = p_id and b.company_id = p_company
      and b.status in ('open','in_progress','recurring') and b.end_time is null and b.resolved_at is null)
    when 'quote' then exists (select 1 from public.quotes q where q.id = p_id and q.company_id = p_company and q.deleted_at is null
      and q.status in ('sent','approved_for_sending') and q.valid_until >= (now() at time zone 'Asia/Kolkata')::date)
    when 'invoice' then exists (select 1 from public.invoices i where i.id = p_id and i.company_id = p_company and i.deleted_at is null
      and i.balance_due > 0 and i.status not in ('draft','paid','cancelled','credited'))
    else false end
$$;
revoke all on function private.task_trigger_source_open(uuid, text, uuid) from public, anon, authenticated;

-- Evaluates one rule against current records (at most 500 sources per run, oldest first).
create or replace function private.task_trigger_scan(p_rule public.task_trigger_rules)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date; v_src record; v_result text;
  v_created integer := 0; v_existing integer := 0; v_unassigned integer := 0; v_seen integer := 0; v_limit integer := 500;
begin
  if p_rule.event_type = 'order_dispatch_overdue' then
    for v_src in select o.id, o.order_number, o.expected_dispatch_date d from public.orders o
      where o.company_id = p_rule.company_id and o.deleted_at is null and o.expected_dispatch_date is not null
        and o.current_stage not in ('dispatched','delivered','payment_pending','closed','cancelled')
        and o.expected_dispatch_date + p_rule.threshold < v_today
      order by o.expected_dispatch_date, o.id limit v_limit + 1
    loop
      v_seen := v_seen + 1; exit when v_seen > v_limit;
      v_result := private.task_trigger_raise(p_rule, 'order', v_src.id, v_src.d::text, (v_src.d::timestamp at time zone 'Asia/Kolkata'),
        concat('Dispatch overdue: ', coalesce(v_src.order_number, 'order'), ' (due ', to_char(v_src.d, 'DD Mon YYYY'), ')'),
        concat('Order ', coalesce(v_src.order_number, ''), ' was due for dispatch on ', to_char(v_src.d, 'DD Mon YYYY'), ' and has not been dispatched. Update the customer and the dispatch plan.'));
      if v_result = 'created' then v_created := v_created + 1; elsif v_result = 'unassigned' then v_unassigned := v_unassigned + 1; else v_existing := v_existing + 1; end if;
    end loop;
  elsif p_rule.event_type = 'inspection_rejected' then
    for v_src in select q.id, q.batch_number, q.quantity_checked_kg, q.inspection_date from public.quality_inspections q
      where q.company_id = p_rule.company_id and q.status = 'rejected' and q.inspection_date >= p_rule.created_at - make_interval(days => p_rule.lookback_days)
      order by q.inspection_date, q.id limit v_limit + 1
    loop
      v_seen := v_seen + 1; exit when v_seen > v_limit;
      v_result := private.task_trigger_raise(p_rule, 'quality_inspection', v_src.id, null, v_src.inspection_date,
        concat('Rejected inspection', coalesce(': batch ' || v_src.batch_number, ''), coalesce(' · ' || to_char(v_src.quantity_checked_kg, 'FM999999990.000') || ' kg', '')),
        'A quality inspection was rejected. Record the disposition (rework, scrap or customer concession) and the cause.');
      if v_result = 'created' then v_created := v_created + 1; elsif v_result = 'unassigned' then v_unassigned := v_unassigned + 1; else v_existing := v_existing + 1; end if;
    end loop;
  elsif p_rule.event_type = 'breakdown_open' then
    for v_src in select b.id, b.machine_id, b.machine_type, coalesce(b.start_time, b.breakdown_date::timestamp at time zone 'Asia/Kolkata') started from public.breakdown_logs b
      where b.company_id = p_rule.company_id and b.status in ('open','in_progress','recurring') and b.end_time is null and b.resolved_at is null
        and coalesce(b.start_time, b.breakdown_date::timestamp at time zone 'Asia/Kolkata') + make_interval(hours => p_rule.threshold) < now()
      order by 4, b.id limit v_limit + 1
    loop
      v_seen := v_seen + 1; exit when v_seen > v_limit;
      v_result := private.task_trigger_raise(p_rule, 'breakdown_log', v_src.id, null, v_src.started,
        concat('Breakdown open over ', p_rule.threshold, ' h: ', v_src.machine_id, ' (', replace(v_src.machine_type, '_', ' '), ')'),
        concat('Machine ', v_src.machine_id, ' has been down since ', to_char(v_src.started at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), ' IST. Confirm the repair plan, spare parts and the jobs to re-plan.'));
      if v_result = 'created' then v_created := v_created + 1; elsif v_result = 'unassigned' then v_unassigned := v_unassigned + 1; else v_existing := v_existing + 1; end if;
    end loop;
  elsif p_rule.event_type = 'quote_expiring' then
    for v_src in select q.id, q.quote_number, q.valid_until d from public.quotes q
      where q.company_id = p_rule.company_id and q.deleted_at is null and q.status in ('sent','approved_for_sending')
        and q.valid_until between v_today and v_today + p_rule.threshold
      order by q.valid_until, q.id limit v_limit + 1
    loop
      v_seen := v_seen + 1; exit when v_seen > v_limit;
      v_result := private.task_trigger_raise(p_rule, 'quote', v_src.id, v_src.d::text, (v_src.d::timestamp at time zone 'Asia/Kolkata'),
        concat('Quotation expiring: ', coalesce(v_src.quote_number, 'quote'), ' (valid until ', to_char(v_src.d, 'DD Mon YYYY'), ')'),
        'Follow up with the customer before the quotation expires: confirm, revise or let it lapse.');
      if v_result = 'created' then v_created := v_created + 1; elsif v_result = 'unassigned' then v_unassigned := v_unassigned + 1; else v_existing := v_existing + 1; end if;
    end loop;
  elsif p_rule.event_type = 'invoice_overdue' then
    for v_src in select i.id, i.invoice_number, i.due_date d, i.balance_due from public.invoices i
      where i.company_id = p_rule.company_id and i.deleted_at is null and i.due_date is not null and i.balance_due > 0
        and i.status not in ('draft','paid','cancelled','credited') and i.due_date + p_rule.threshold < v_today
      order by i.due_date, i.id limit v_limit + 1
    loop
      v_seen := v_seen + 1; exit when v_seen > v_limit;
      v_result := private.task_trigger_raise(p_rule, 'invoice', v_src.id, v_src.d::text, (v_src.d::timestamp at time zone 'Asia/Kolkata'),
        concat('Payment overdue: ', coalesce(v_src.invoice_number, 'invoice'), ' (due ', to_char(v_src.d, 'DD Mon YYYY'), ')'),
        concat('Balance of INR ', to_char(v_src.balance_due, 'FM99999999990.00'), ' is overdue. Call the customer and record the promised payment date.'));
      if v_result = 'created' then v_created := v_created + 1; elsif v_result = 'unassigned' then v_unassigned := v_unassigned + 1; else v_existing := v_existing + 1; end if;
    end loop;
  end if;
  return jsonb_build_object('rule_id', p_rule.id, 'name', p_rule.name, 'created', v_created, 'existing', v_existing, 'unassigned', v_unassigned, 'more_pending', v_seen > v_limit);
end;
$$;
revoke all on function private.task_trigger_scan(public.task_trigger_rules) from public, anon, authenticated;

-- A rejected inspection raises its tasks in the same transaction as the rejection.
create or replace function private.task_trigger_on_inspection()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare r public.task_trigger_rules%rowtype;
begin
  if new.status = 'rejected' and (tg_op = 'INSERT' or old.status is distinct from 'rejected') then
    for r in select * from public.task_trigger_rules where company_id = new.company_id and event_type = 'inspection_rejected' and is_active order by created_at, id loop
      perform private.task_trigger_raise(r, 'quality_inspection', new.id, null, coalesce(new.inspection_date, now()),
        concat('Rejected inspection', coalesce(': batch ' || new.batch_number, ''), coalesce(' · ' || to_char(new.quantity_checked_kg, 'FM999999990.000') || ' kg', '')),
        'A quality inspection was rejected. Record the disposition (rework, scrap or customer concession) and the cause.');
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.task_trigger_on_inspection() from public, anon, authenticated;
drop trigger if exists zz_task_trigger_on_inspection on public.quality_inspections;
create trigger zz_task_trigger_on_inspection after insert or update of status on public.quality_inspections for each row execute function private.task_trigger_on_inspection();

-- The event reference of a triggered task never changes, and only a rule can create one.
create or replace function private.guard_task_trigger_reference()
returns trigger language plpgsql set search_path = public, private as $$
begin
  if (old.trigger_key, old.trigger_rule_id, old.trigger_source_type, old.trigger_source_id, old.trigger_event_at)
     is distinct from (new.trigger_key, new.trigger_rule_id, new.trigger_source_type, new.trigger_source_id, new.trigger_event_at) then
    raise exception 'The trigger reference of a task cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_task_trigger_reference() from public, anon, authenticated;
drop trigger if exists guard_task_trigger_reference on public.tasks;
create trigger guard_task_trigger_reference before update on public.tasks for each row execute function private.guard_task_trigger_reference();

create or replace function public.task_trigger_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_manager boolean; v_scope text[]; v_request uuid; v_run public.task_trigger_runs%rowtype;
  r public.task_trigger_rules%rowtype; v_old public.task_trigger_rules%rowtype; t public.tasks%rowtype; v_pick record;
  v_rules jsonb := '[]'::jsonb; v_one jsonb; v_page integer; v_total bigint; v_rows jsonb; v_assignee record; v_event text;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid task trigger request'; end if;
  v_manager := v_role in ('owner','admin','factory_manager');
  v_scope := private.task_trigger_scope(v_role);
  if not exists (select 1 from public.app_users where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null)
     or p_command not in ('rules.list','rules.save','triggers.run','tasks.list','recovery.list','recovery.assign','recovery.retry')
     or cardinality(v_scope) = 0
     or (p_command = 'rules.save' and not v_manager) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'rules.save' then
    begin
      r.id := (p_payload ->> 'id')::uuid;
      r.threshold := coalesce((p_payload ->> 'threshold')::integer, 0);
      r.lookback_days := coalesce((p_payload ->> 'lookback_days')::integer, 7);
      r.due_days := coalesce((p_payload ->> 'due_days')::integer, 1);
      r.assignee_user_id := nullif(p_payload ->> 'assignee_user_id', '')::uuid;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Enter whole numbers for the threshold, look-back and due days';
    end;
    if r.id is null then raise exception 'Invalid task trigger request'; end if;
    r.company_id := v_company; r.name := btrim(coalesce(p_payload ->> 'name', '')); r.event_type := p_payload ->> 'event_type';
    r.assignee_mode := p_payload ->> 'assignee_mode'; r.assignee_role := nullif(p_payload ->> 'assignee_role', '');
    r.due_calendar := coalesce(p_payload ->> 'due_calendar', 'working_days'); r.priority := coalesce(p_payload ->> 'priority', 'normal');
    r.is_active := coalesce((p_payload ->> 'is_active')::boolean, true);
    if length(r.name) not between 3 and 120 then raise exception 'Name the rule (3 to 120 characters)'; end if;
    if r.event_type is null or cardinality(private.task_trigger_event_roles(r.event_type)) = 0 then raise exception 'Choose a supported trigger event'; end if;
    if r.assignee_mode is null or r.assignee_mode not in ('role','person') or (r.assignee_mode = 'role' and (r.assignee_role is null or r.assignee_user_id is not null))
       or (r.assignee_mode = 'person' and r.assignee_user_id is null) then
      raise exception 'Choose who receives the work: a role, or a named employee with an optional fallback role';
    end if;
    if r.assignee_role is not null and not (r.assignee_role = any(private.task_trigger_event_roles(r.event_type))) then
      raise exception 'The % role cannot take this kind of work', replace(r.assignee_role, '_', ' ');
    end if;
    if r.assignee_user_id is not null and not exists (select 1 from public.app_users u where u.id = r.assignee_user_id and u.company_id = v_company and u.is_active
         and u.dealer_id is null and u.role = any(private.task_trigger_event_roles(r.event_type))) then
      raise exception 'The chosen employee is inactive or cannot take this kind of work';
    end if;
    select * into v_old from public.task_trigger_rules where id = r.id for update;
    if found then
      if v_old.company_id <> v_company then raise exception 'Trigger rule is unavailable'; end if;
      if v_old.event_type <> r.event_type then raise exception 'The event of an existing rule cannot be changed. Create a new rule instead'; end if;
      if nullif(p_payload ->> 'expected_updated_at', '') is null or v_old.updated_at <> (p_payload ->> 'expected_updated_at')::timestamptz then
        raise exception 'This rule was changed by someone else. Reload it before saving';
      end if;
    elsif (select count(*) from public.task_trigger_rules where company_id = v_company) >= 50 then
      raise exception 'A company can have at most 50 trigger rules';
    end if;
    begin
      insert into public.task_trigger_rules(id, company_id, name, event_type, threshold, lookback_days, assignee_mode, assignee_role, assignee_user_id,
        due_days, due_calendar, priority, is_active, created_by, updated_by)
      values (r.id, v_company, r.name, r.event_type, r.threshold, r.lookback_days, r.assignee_mode, r.assignee_role, r.assignee_user_id,
        r.due_days, r.due_calendar, r.priority, r.is_active, v_actor, v_actor)
      on conflict (id) do update set name = excluded.name, threshold = excluded.threshold, lookback_days = excluded.lookback_days,
        assignee_mode = excluded.assignee_mode, assignee_role = excluded.assignee_role, assignee_user_id = excluded.assignee_user_id,
        due_days = excluded.due_days, due_calendar = excluded.due_calendar, priority = excluded.priority, is_active = excluded.is_active,
        updated_by = v_actor, updated_at = clock_timestamp()
      returning * into r;
    exception when check_violation then
      raise exception 'Enter a threshold within the range for this event, a look-back of 0 to 90 days, a due policy of 0 to 30 days and a valid priority';
    end;
    return jsonb_build_object('id', r.id, 'updated_at', r.updated_at);

  elsif p_command = 'triggers.run' then
    begin v_request := (p_payload ->> 'request_id')::uuid; exception when invalid_text_representation then v_request := null; end;
    if v_request is null then raise exception 'Invalid task trigger request'; end if;
    select * into v_run from public.task_trigger_runs where id = v_request;
    if found then
      if v_run.company_id <> v_company then raise exception 'Invalid task trigger request'; end if;
      return v_run.result || jsonb_build_object('replayed', true);
    end if;
    -- One run at a time per company keeps the counts exact; the unique key prevents duplicates regardless.
    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':task-trigger-run', 0));
    for r in select * from public.task_trigger_rules where company_id = v_company and is_active and event_type = any(v_scope) order by created_at, id loop
      v_rules := v_rules || jsonb_build_array(private.task_trigger_scan(r));
    end loop;
    v_one := jsonb_build_object('request_id', v_request, 'replayed', false,
      'created', coalesce((select sum((x ->> 'created')::integer) from jsonb_array_elements(v_rules) x), 0),
      'existing', coalesce((select sum((x ->> 'existing')::integer) from jsonb_array_elements(v_rules) x), 0),
      'unassigned', coalesce((select sum((x ->> 'unassigned')::integer) from jsonb_array_elements(v_rules) x), 0),
      'more_pending', coalesce((select bool_or((x ->> 'more_pending')::boolean) from jsonb_array_elements(v_rules) x), false),
      'rules', v_rules);
    insert into public.task_trigger_runs(id, company_id, started_by, result) values (v_request, v_company, v_actor, v_one);
    return v_one;

  elsif p_command in ('recovery.assign','recovery.retry') then
    select t2.* into t from public.tasks t2 where t2.id = (p_payload ->> 'task_id')::uuid and t2.company_id = v_company and t2.trigger_key is not null for update;
    if not found then raise exception 'Triggered task is unavailable'; end if;
    select * into r from public.task_trigger_rules where id = t.trigger_rule_id;
    if not (r.event_type = any(v_scope)) then raise exception 'Triggered task is unavailable'; end if;
    if t.assigned_to is not null or t.status not in ('open','in_progress') then raise exception 'This task was already assigned or closed. Refresh the list'; end if;
    if p_command = 'recovery.retry' then
      select * into v_pick from private.task_trigger_pick(r);
      if v_pick.o_user is null then
        update public.tasks set trigger_assignment_note = v_pick.o_note, updated_at = now() where id = t.id;
        return jsonb_build_object('id', t.id, 'assigned_to', null, 'note', v_pick.o_note);
      end if;
      update public.tasks set assigned_to = v_pick.o_user, assigned_by_user_id = v_actor, trigger_assignment = 'assigned', trigger_assignment_note = coalesce(v_pick.o_note, 'Assigned on retry'), updated_at = now() where id = t.id;
      return jsonb_build_object('id', t.id, 'assigned_to', v_pick.o_user, 'note', coalesce(v_pick.o_note, 'Assigned on retry'));
    end if;
    select u.id, u.role, u.full_name into v_assignee from public.app_users u
    where u.id = (p_payload ->> 'assignee_id')::uuid and u.company_id = v_company and u.is_active and u.dealer_id is null;
    if v_assignee.id is null or not (v_assignee.role = any(private.task_trigger_event_roles(r.event_type)))
       or (not v_manager and not (v_assignee.role = any(private.bulk_supervised_roles(v_role)))) then
      raise exception 'The chosen employee cannot take this work';
    end if;
    update public.tasks set assigned_to = v_assignee.id, assigned_by_user_id = v_actor, trigger_assignment = 'assigned',
      trigger_assignment_note = concat('Assigned by ', coalesce((select full_name from public.app_users where id = v_actor), 'a supervisor'), ' from unassigned work'), updated_at = now()
    where id = t.id;
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
    values (v_company, v_assignee.id, 'task_trigger_assigned', 'info', left(t.title, 200), concat('Assigned to you from unassigned work (rule "', r.name, '").'), 'task', t.id, v_actor, '/tasks/' || t.id);
    return jsonb_build_object('id', t.id, 'assigned_to', v_assignee.id, 'note', null);

  elsif p_command = 'rules.list' then
    return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) - 'company_id' || jsonb_build_object(
        'assignee_name', (select full_name from public.app_users where id = x.assignee_user_id),
        'open_tasks', (select count(*) from public.tasks t2 where t2.company_id = v_company and t2.trigger_rule_id = x.id and t2.status in ('open','in_progress')),
        'unassigned_tasks', (select count(*) from public.tasks t2 where t2.company_id = v_company and t2.trigger_rule_id = x.id and t2.status in ('open','in_progress') and t2.assigned_to is null))
      order by x.is_active desc, x.event_type, x.name, x.id)
      from public.task_trigger_rules x where x.company_id = v_company and x.event_type = any(v_scope)), '[]'::jsonb),
      'last_run', (select jsonb_build_object('started_at', started_at, 'created', result -> 'created', 'unassigned', result -> 'unassigned')
        from public.task_trigger_runs where company_id = v_company order by started_at desc limit 1));
  end if;

  -- tasks.list / recovery.list: triggered work in the actor's scope, 10 per page.
  begin v_page := coalesce((p_payload ->> 'page')::integer, 1); exception when invalid_text_representation then v_page := 0; end;
  if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
  with visible as (
    select t2.*, x.name rule_name, x.event_type from public.tasks t2 join public.task_trigger_rules x on x.id = t2.trigger_rule_id
    where t2.company_id = v_company and t2.trigger_key is not null and x.event_type = any(v_scope)
      and (nullif(p_payload ->> 'rule_id', '') is null or t2.trigger_rule_id = (p_payload ->> 'rule_id')::uuid)
      and case when p_command = 'recovery.list' then t2.assigned_to is null and t2.status in ('open','in_progress') else true end
  )
  select (select count(*) from visible),
    coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'status', v.status, 'priority', v.priority, 'due_date', v.due_date,
        'assigned_to', v.assigned_to, 'assignee_name', (select full_name from public.app_users where id = v.assigned_to),
        'rule_id', v.trigger_rule_id, 'rule_name', v.rule_name, 'event_type', v.event_type, 'source_type', v.trigger_source_type, 'source_id', v.trigger_source_id,
        'event_at', v.trigger_event_at, 'created_at', v.created_at, 'assignment', v.trigger_assignment, 'assignment_note', v.trigger_assignment_note,
        'source_open', private.task_trigger_source_open(v_company, v.trigger_source_type, v.trigger_source_id),
        'eligible', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', coalesce(u.full_name, 'Employee'), 'role', u.role) order by u.full_name, u.id), '[]'::jsonb)
          from public.app_users u where p_command = 'recovery.list' and u.company_id = v_company and u.is_active and u.dealer_id is null
            and u.role = any(private.task_trigger_event_roles(v.event_type)) and (v_manager or u.role = any(private.bulk_supervised_roles(v_role)))))
      order by v.created_at desc, v.id)
      from (select * from visible order by created_at desc, id limit 10 offset (v_page - 1) * 10) v), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;
-- Scheduler entry point (pg_cron runs without a signed-in user): evaluates every active rule of
-- every company once and records one run per company. Not callable by API roles. Example:
--   select cron.schedule('task-triggers', '*/15 * * * *', 'select private.run_task_triggers_for_all()');
create or replace function private.run_task_triggers_for_all()
returns integer language plpgsql security definer set search_path = public, private as $$
declare v_company uuid; r public.task_trigger_rules%rowtype; v_rules jsonb; v_runs integer := 0;
begin
  for v_company in select distinct company_id from public.task_trigger_rules where is_active order by company_id loop
    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':task-trigger-run', 0));
    v_rules := '[]'::jsonb;
    for r in select * from public.task_trigger_rules where company_id = v_company and is_active order by created_at, id loop
      v_rules := v_rules || jsonb_build_array(private.task_trigger_scan(r));
    end loop;
    insert into public.task_trigger_runs(id, company_id, started_by, result)
    values (gen_random_uuid(), v_company, null, jsonb_build_object('replayed', false, 'scheduled', true,
      'created', coalesce((select sum((x ->> 'created')::integer) from jsonb_array_elements(v_rules) x), 0),
      'existing', coalesce((select sum((x ->> 'existing')::integer) from jsonb_array_elements(v_rules) x), 0),
      'unassigned', coalesce((select sum((x ->> 'unassigned')::integer) from jsonb_array_elements(v_rules) x), 0),
      'more_pending', coalesce((select bool_or((x ->> 'more_pending')::boolean) from jsonb_array_elements(v_rules) x), false),
      'rules', v_rules));
    v_runs := v_runs + 1;
  end loop;
  return v_runs;
end;
$$;
revoke all on function private.run_task_triggers_for_all() from public, anon, authenticated;
revoke all on function public.task_trigger_command(text, jsonb) from public, anon;
grant execute on function public.task_trigger_command(text, jsonb) to authenticated;

commit;
