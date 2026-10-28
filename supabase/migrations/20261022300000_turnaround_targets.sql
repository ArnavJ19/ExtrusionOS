-- UPGRADE_EOS feature 71: turnaround targets and escalation rules.
--
-- A company sets, per task kind (department handoffs by team, handoff returns, or an ordinary
-- task type), a response target (created -> first started) and a completion target, the
-- working calendar the targets run on ('24x7', or 'day_shift' = Monday-Saturday 08:00-20:00
-- IST) and the role escalations go to. Employees record waiting periods with a reason (customer,
-- material, approval, other). Waiting pauses the target clock only: total elapsed time is always
-- reported separately and never reduced. An escalation run raises each level once per task
-- (1 = response breached, 2 = completion breached), notifies the escalation role, and resolves
-- escalations whose task finished or is no longer in breach (for example after a recorded wait).
-- Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.turnaround_targets (
  company_id uuid not null references public.companies(id),
  task_kind text not null check (task_kind ~ '^(handoff:(packaging|quality|dispatch|production)|handoff_return|type:[a-z0-9_]{1,40})$'),
  response_minutes integer check (response_minutes is null or response_minutes between 1 and 43200),
  completion_minutes integer not null check (completion_minutes between 1 and 129600),
  calendar text not null default 'day_shift' check (calendar in ('24x7','day_shift')),
  escalation_role text not null check (escalation_role in ('owner','admin','factory_manager','production_manager','dispatch_manager','quality_manager','sales_manager')),
  is_active boolean not null default true,
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default now(),
  primary key (company_id, task_kind),
  check (response_minutes is null or response_minutes <= completion_minutes)
);
create index turnaround_targets_updated_by_idx on public.turnaround_targets(updated_by);

-- First start and completion instants, kept by trigger so response time is measurable.
create table public.task_turnaround_marks (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  first_started_at timestamptz,
  finished_at timestamptz
);
create index task_turnaround_marks_company_idx on public.task_turnaround_marks(company_id);

create table public.task_waits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  task_id uuid not null references public.tasks(id) on delete cascade,
  reason text not null check (reason in ('waiting_customer','waiting_material','waiting_approval','other')),
  note text not null check (length(btrim(note)) between 3 and 300),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  started_by uuid not null references public.app_users(id),
  ended_by uuid references public.app_users(id),
  check (ended_at is null or ended_at >= started_at)
);
create unique index task_waits_one_open on public.task_waits(task_id) where ended_at is null;
create index task_waits_task_idx on public.task_waits(company_id, task_id, started_at);
create index task_waits_started_by_idx on public.task_waits(started_by);
create index task_waits_ended_by_idx on public.task_waits(ended_by);

create table public.task_escalations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  task_id uuid not null references public.tasks(id) on delete cascade,
  level smallint not null check (level in (1, 2)),
  escalation_role text not null,
  escalated_at timestamptz not null default now(),
  notification_id uuid,
  resolved_at timestamptz,
  resolution text check (resolution is null or resolution in ('task_finished','responded','back_within_target','target_removed'))
);
create unique index task_escalations_once on public.task_escalations(task_id, level) where resolved_at is null;
create index task_escalations_open_idx on public.task_escalations(company_id, resolved_at, escalated_at desc);

alter table public.turnaround_targets enable row level security;
alter table public.task_turnaround_marks enable row level security;
alter table public.task_waits enable row level security;
alter table public.task_escalations enable row level security;
revoke all on public.turnaround_targets, public.task_turnaround_marks, public.task_waits, public.task_escalations from public, anon, authenticated;
grant select on public.turnaround_targets, public.task_turnaround_marks, public.task_waits, public.task_escalations to authenticated;
create policy turnaround_targets_read on public.turnaround_targets for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy task_turnaround_marks_read on public.task_turnaround_marks for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy task_waits_read on public.task_waits for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy task_escalations_read on public.task_escalations for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);

create or replace function private.mark_task_turnaround()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.status = 'in_progress' then
    insert into public.task_turnaround_marks(task_id, company_id, first_started_at) values (new.id, new.company_id, now())
    on conflict (task_id) do update set first_started_at = coalesce(task_turnaround_marks.first_started_at, excluded.first_started_at);
  elsif new.status in ('completed','cancelled') then
    insert into public.task_turnaround_marks(task_id, company_id, finished_at) values (new.id, new.company_id, now())
    on conflict (task_id) do update set finished_at = excluded.finished_at;
    update public.task_waits set ended_at = now() where task_id = new.id and ended_at is null;
  elsif new.status = 'open' and tg_op = 'UPDATE' then
    update public.task_turnaround_marks set finished_at = null where task_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.mark_task_turnaround() from public, anon, authenticated;
drop trigger if exists zz_mark_task_turnaround on public.tasks;
create trigger zz_mark_task_turnaround after insert or update on public.tasks for each row execute function private.mark_task_turnaround();

-- Minutes of [p_from, p_to) that fall inside the calendar's working time.
create or replace function private.calendar_minutes(p_from timestamptz, p_to timestamptz, p_calendar text)
returns numeric language plpgsql immutable set search_path = public, private as $$
declare
  v_total numeric := 0;
  v_day date;
  v_last date;
  v_open timestamptz; v_close timestamptz;
begin
  if p_from is null or p_to is null or p_to <= p_from then return 0; end if;
  if p_calendar = '24x7' then return round(extract(epoch from (p_to - p_from)) / 60, 1); end if;
  v_day := (p_from at time zone 'Asia/Kolkata')::date;
  v_last := least((p_to at time zone 'Asia/Kolkata')::date, v_day + 400);
  while v_day <= v_last loop
    if extract(isodow from v_day) <> 7 then
      v_open := (v_day + time '08:00') at time zone 'Asia/Kolkata';
      v_close := (v_day + time '20:00') at time zone 'Asia/Kolkata';
      v_total := v_total + greatest(extract(epoch from (least(p_to, v_close) - greatest(p_from, v_open))), 0) / 60;
    end if;
    v_day := v_day + 1;
  end loop;
  return round(v_total, 1);
end;
$$;
revoke all on function private.calendar_minutes(timestamptz, timestamptz, text) from public, anon, authenticated;

create or replace function private.task_kind(t public.tasks)
returns text language sql immutable set search_path = public, private as $$
  select case
    when t.task_type = 'department_handoff' and t.handoff_team is not null then 'handoff:' || t.handoff_team
    when t.task_type = 'handoff_return' then 'handoff_return'
    else 'type:' || lower(regexp_replace(coalesce(t.task_type, 'general'), '[^a-zA-Z0-9_]', '_', 'g')) end
$$;
revoke all on function private.task_kind(public.tasks) from public, anon, authenticated;

-- Turnaround figures for one task at p_at (now for open work, the finish time for closed work).
create or replace function private.task_turnaround(p_task uuid, p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  t public.tasks%rowtype;
  v_target public.turnaround_targets%rowtype;
  v_mark public.task_turnaround_marks%rowtype;
  v_end timestamptz; v_start_end timestamptz;
  v_elapsed numeric; v_working numeric; v_waiting numeric; v_active numeric;
  v_response_active numeric; v_response_state text; v_completion_state text; v_open_wait record;
begin
  select * into t from public.tasks where id = p_task;
  if not found then return null; end if;
  select * into v_target from public.turnaround_targets where company_id = t.company_id and task_kind = private.task_kind(t) and is_active;
  select * into v_mark from public.task_turnaround_marks where task_id = t.id;
  v_end := case when t.status in ('completed','cancelled') then coalesce(v_mark.finished_at, t.completed_at, t.updated_at) else p_at end;
  v_elapsed := round(extract(epoch from (v_end - t.created_at)) / 60, 1);
  select reason, started_at, note into v_open_wait from public.task_waits where task_id = t.id and ended_at is null;
  if v_target.task_kind is null then
    return jsonb_build_object('task_id', t.id, 'task_kind', private.task_kind(t), 'has_target', false, 'elapsed_minutes', v_elapsed,
      'open_wait', case when v_open_wait.started_at is not null then jsonb_build_object('reason', v_open_wait.reason, 'since', v_open_wait.started_at, 'note', v_open_wait.note) end);
  end if;
  v_working := private.calendar_minutes(t.created_at, v_end, v_target.calendar);
  select coalesce(sum(private.calendar_minutes(greatest(w.started_at, t.created_at), least(coalesce(w.ended_at, v_end), v_end), v_target.calendar)), 0)
    into v_waiting from public.task_waits w where w.task_id = t.id;
  v_active := greatest(v_working - v_waiting, 0);

  -- Response: until the first start, waiting excluded.
  v_start_end := coalesce(v_mark.first_started_at, case when t.status in ('completed','cancelled') then v_end end, v_end);
  v_response_active := greatest(private.calendar_minutes(t.created_at, v_start_end, v_target.calendar) - coalesce((select sum(private.calendar_minutes(greatest(w.started_at, t.created_at), least(coalesce(w.ended_at, v_start_end), v_start_end), v_target.calendar)) from public.task_waits w where w.task_id = t.id), 0), 0);
  v_response_state := case
    when v_target.response_minutes is null then 'none'
    when v_mark.first_started_at is not null or t.status in ('completed','cancelled') then case when v_response_active <= v_target.response_minutes then 'met' else 'missed' end
    when v_response_active > v_target.response_minutes then 'breached'
    when v_response_active >= v_target.response_minutes * 0.8 then 'due_soon'
    else 'on_track' end;
  v_completion_state := case
    when t.status in ('completed','cancelled') then case when v_active <= v_target.completion_minutes then 'met' else 'missed' end
    when v_active > v_target.completion_minutes then 'breached'
    when v_active >= v_target.completion_minutes * 0.8 then 'due_soon'
    else 'on_track' end;
  return jsonb_build_object('task_id', t.id, 'task_kind', v_target.task_kind, 'has_target', true, 'calendar', v_target.calendar,
    'elapsed_minutes', v_elapsed, 'working_minutes', v_working, 'waiting_minutes', v_waiting, 'active_minutes', v_active,
    'response_minutes_target', v_target.response_minutes, 'response_active_minutes', v_response_active, 'response_state', v_response_state,
    'completion_minutes_target', v_target.completion_minutes, 'completion_state', v_completion_state, 'escalation_role', v_target.escalation_role,
    'open_wait', case when v_open_wait.started_at is not null then jsonb_build_object('reason', v_open_wait.reason, 'since', v_open_wait.started_at, 'note', v_open_wait.note) end);
end;
$$;
revoke all on function private.task_turnaround(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.turnaround_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  t public.tasks%rowtype;
  v_ids uuid[]; v_kind text; v_reason text; v_note text; v_wait public.task_waits%rowtype;
  v_raised integer := 0; v_resolved integer := 0; v_row record; v_status jsonb; v_level smallint; v_notification uuid; v_page integer; v_total bigint; v_rows jsonb;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid turnaround request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found or p_command not in ('targets.list','targets.set','task.status','wait.start','wait.end','escalations.run','escalations.list')
     or (p_command in ('targets.set','escalations.run') and v_role not in ('owner','admin','factory_manager')) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'targets.list' then
    return coalesce((select jsonb_agg(to_jsonb(x) - 'company_id' - 'updated_by' order by x.task_kind) from public.turnaround_targets x where x.company_id = v_company), '[]'::jsonb);

  elsif p_command = 'targets.set' then
    v_kind := p_payload ->> 'task_kind';
    if v_kind is null or v_kind !~ '^(handoff:(packaging|quality|dispatch|production)|handoff_return|type:[a-z0-9_]{1,40})$' then raise exception 'Choose a valid task kind'; end if;
    begin
      insert into public.turnaround_targets(company_id, task_kind, response_minutes, completion_minutes, calendar, escalation_role, is_active, updated_by)
      values (v_company, v_kind, nullif(p_payload ->> 'response_minutes', '')::integer, (p_payload ->> 'completion_minutes')::integer,
        coalesce(p_payload ->> 'calendar', 'day_shift'), p_payload ->> 'escalation_role', coalesce((p_payload ->> 'is_active')::boolean, true), v_actor)
      on conflict (company_id, task_kind) do update set response_minutes = excluded.response_minutes, completion_minutes = excluded.completion_minutes,
        calendar = excluded.calendar, escalation_role = excluded.escalation_role, is_active = excluded.is_active, updated_by = v_actor, updated_at = now();
    exception when check_violation or not_null_violation or invalid_text_representation then
      raise exception 'Set a completion target, an optional shorter response target, a calendar and an escalation role';
    end;
    return jsonb_build_object('task_kind', v_kind);

  elsif p_command = 'task.status' then
    begin select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(p_payload -> 'task_ids');
    exception when others then raise exception 'Invalid task references'; end;
    if v_ids is null or cardinality(v_ids) > 25 then raise exception 'Invalid task references'; end if;
    return coalesce((select jsonb_agg(private.task_turnaround(x.id)) from public.tasks x
      where x.id = any(v_ids) and x.company_id = v_company and x.dealership_id is null), '[]'::jsonb);

  elsif p_command in ('wait.start','wait.end') then
    select * into t from public.tasks where id = (p_payload ->> 'task_id')::uuid and company_id = v_company and dealership_id is null for update;
    if not found then raise exception 'Task is unavailable'; end if;
    -- The assignee, or a supervisor of the work, records waiting time.
    if not (coalesce(t.assigned_to = v_actor, false) or v_role in ('owner','admin','factory_manager','production_manager','dispatch_manager','quality_manager','sales_manager')) then
      raise exception 'Only the assignee or a supervisor can record waiting time' using errcode = '42501';
    end if;
    if p_command = 'wait.start' then
      if t.status not in ('open','in_progress') then raise exception 'Only open work can wait'; end if;
      v_reason := p_payload ->> 'reason';
      v_note := btrim(coalesce(p_payload ->> 'note', ''));
      if v_reason not in ('waiting_customer','waiting_material','waiting_approval','other') then raise exception 'Choose what the work is waiting for'; end if;
      if length(v_note) not between 3 and 300 or v_note ~ '[[:cntrl:]]' then raise exception 'Say what the work is waiting for (3 to 300 characters)'; end if;
      if exists (select 1 from public.task_waits where task_id = t.id and ended_at is null) then raise exception 'This task is already recorded as waiting'; end if;
      insert into public.task_waits(company_id, task_id, reason, note, started_by) values (v_company, t.id, v_reason, v_note, v_actor) returning * into v_wait;
    else
      update public.task_waits set ended_at = now(), ended_by = v_actor where task_id = t.id and ended_at is null returning * into v_wait;
      if not found then raise exception 'This task is not waiting'; end if;
    end if;
    return private.task_turnaround(t.id);

  elsif p_command = 'escalations.run' then
    -- Resolve escalations first, then raise new ones; each (task, level) is raised at most once while open.
    for v_row in select e.id, e.task_id, e.level, x.status from public.task_escalations e join public.tasks x on x.id = e.task_id
                 where e.company_id = v_company and e.resolved_at is null loop
      v_status := private.task_turnaround(v_row.task_id);
      if v_row.status in ('completed','cancelled') then
        update public.task_escalations set resolved_at = now(), resolution = 'task_finished' where id = v_row.id; v_resolved := v_resolved + 1;
      elsif not coalesce((v_status ->> 'has_target')::boolean, false) then
        update public.task_escalations set resolved_at = now(), resolution = 'target_removed' where id = v_row.id; v_resolved := v_resolved + 1;
      elsif v_row.level = 1 and v_status ->> 'response_state' in ('met','missed') then
        update public.task_escalations set resolved_at = now(), resolution = 'responded' where id = v_row.id; v_resolved := v_resolved + 1;
      elsif (v_row.level = 1 and v_status ->> 'response_state' <> 'breached') or (v_row.level = 2 and v_status ->> 'completion_state' <> 'breached') then
        update public.task_escalations set resolved_at = now(), resolution = 'back_within_target' where id = v_row.id; v_resolved := v_resolved + 1;
      end if;
    end loop;
    for v_row in select x.id, x.title from public.tasks x
                 where x.company_id = v_company and x.dealership_id is null and x.status in ('open','in_progress')
                   and exists (select 1 from public.turnaround_targets g where g.company_id = v_company and g.task_kind = private.task_kind(x) and g.is_active)
                 order by x.created_at limit 500 loop
      v_status := private.task_turnaround(v_row.id);
      foreach v_level in array array[1, 2]::smallint[] loop
        if (v_level = 1 and v_status ->> 'response_state' = 'breached') or (v_level = 2 and v_status ->> 'completion_state' = 'breached') then
          if not exists (select 1 from public.task_escalations where task_id = v_row.id and level = v_level and resolved_at is null) then
            insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, related_entity_type, related_entity_id, is_read, created_by, action_link)
            values (v_company, v_status ->> 'escalation_role', 'turnaround_escalation', case when v_level = 2 then 'critical' else 'warning' end,
              concat(case when v_level = 1 then 'Not started within target: ' else 'Not completed within target: ' end, left(v_row.title, 150)),
              concat('Active ', v_status ->> 'active_minutes', ' working minutes against a target of ',
                case when v_level = 1 then v_status ->> 'response_minutes_target' else v_status ->> 'completion_minutes_target' end,
                '; total elapsed ', v_status ->> 'elapsed_minutes', ' minutes.'),
              'task', v_row.id, false, v_actor, '/tasks/' || v_row.id)
            returning id into v_notification;
            insert into public.task_escalations(company_id, task_id, level, escalation_role, notification_id)
            values (v_company, v_row.id, v_level, v_status ->> 'escalation_role', v_notification);
            v_raised := v_raised + 1;
          end if;
        end if;
      end loop;
    end loop;
    return jsonb_build_object('raised', v_raised, 'resolved', v_resolved);
  end if;

  -- escalations.list: open escalations, newest first, 10 per page.
  v_page := coalesce((p_payload ->> 'page')::integer, 1);
  if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
  select count(*) into v_total from public.task_escalations where company_id = v_company and resolved_at is null;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from (
    select e.id, e.task_id, e.level, e.escalation_role, e.escalated_at, x.title, x.status, x.due_date, u.full_name as assigned_to_name
    from public.task_escalations e join public.tasks x on x.id = e.task_id left join public.app_users u on u.id = x.assigned_to
    where e.company_id = v_company and e.resolved_at is null order by e.escalated_at desc, e.id limit 10 offset (v_page - 1) * 10) r;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;
revoke all on function public.turnaround_command(text, jsonb) from public, anon;
grant execute on function public.turnaround_command(text, jsonb) to authenticated;

commit;
