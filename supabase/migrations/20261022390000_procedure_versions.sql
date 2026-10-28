-- UPGRADE_EOS feature 77: controlled SOP versions and effective dates.
--
-- An operating procedure (feature 62 ownership record) gains numbered instruction versions:
--   draft -> in_review -> released (with an effective date), or draft -> withdrawn (discarded).
-- A released version is reviewed by someone other than its author (the procedure owner, its
-- backup, or an owner/admin), cannot be edited or deleted, and can be withdrawn only before its
-- effective date. The applicable version on a date is the newest released one already effective.
--
-- Tasks follow a procedure through a task-kind mapping (same kind keys as feature 67 templates:
-- 'type:<task_type>' or 'handoff:<team>'). A task is bound to the applicable version when it is
-- created; the release of a newer version says what happens to work already underway:
--   keep_current   - existing tasks keep the version they were given,
--   move_unstarted - tasks not yet started (and never completed) move to the new version; started work keeps its own.
-- A completed task's binding is frozen, so a later release never changes the instructions recorded
-- for it. Without a mapping or a released version, nothing changes. Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.procedure_versions (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  procedure_id uuid not null references public.operating_procedures(id),
  version_no integer not null check (version_no between 1 and 9999),
  status text not null default 'draft' check (status in ('draft','in_review','released','withdrawn')),
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 30),
  change_summary text not null check (length(btrim(change_summary)) between 3 and 500),
  content_hash text not null,
  author_id uuid not null references public.app_users(id),
  author_name text not null,
  updated_at timestamptz not null default clock_timestamp(),
  submitted_at timestamptz,
  reviewer_id uuid references public.app_users(id),
  reviewer_name text,
  review_note text check (review_note is null or length(review_note) <= 500),
  released_at timestamptz,
  effective_from date,
  in_flight_policy text check (in_flight_policy in ('keep_current','move_unstarted')),
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.app_users(id),
  withdraw_reason text check (withdraw_reason is null or length(withdraw_reason) <= 300),
  created_at timestamptz not null default now(),
  unique (procedure_id, version_no),
  check (status <> 'released' or (released_at is not null and effective_from is not null and reviewer_id is not null and in_flight_policy is not null)),
  check (status <> 'withdrawn' or withdrawn_at is not null),
  check (reviewer_id is null or reviewer_id <> author_id)
);
create unique index procedure_versions_open_key on public.procedure_versions(procedure_id) where status in ('draft','in_review');
create index procedure_versions_applicable_idx on public.procedure_versions(company_id, procedure_id, status, effective_from desc, version_no desc);
create index procedure_versions_author_idx on public.procedure_versions(author_id);
create index procedure_versions_reviewer_idx on public.procedure_versions(reviewer_id);
create index procedure_versions_withdrawn_by_idx on public.procedure_versions(withdrawn_by);

create table public.procedure_task_kinds (
  company_id uuid not null references public.companies(id),
  task_kind text not null check (task_kind ~ '^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$'),
  procedure_id uuid not null references public.operating_procedures(id),
  set_by uuid not null references public.app_users(id),
  set_at timestamptz not null default now(),
  primary key (company_id, task_kind)
);
create index procedure_task_kinds_procedure_idx on public.procedure_task_kinds(procedure_id);
create index procedure_task_kinds_set_by_idx on public.procedure_task_kinds(set_by);

create table public.task_procedure_bindings (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  procedure_id uuid not null references public.operating_procedures(id),
  version_id uuid not null references public.procedure_versions(id),
  bound_at timestamptz not null default clock_timestamp(),
  bound_reason text not null check (bound_reason in ('task_created','kind_mapped','release_moved_unstarted')),
  started_at timestamptz,
  frozen_at timestamptz
);
create index task_procedure_bindings_company_idx on public.task_procedure_bindings(company_id, procedure_id, version_id);
create index task_procedure_bindings_version_idx on public.task_procedure_bindings(version_id);

create table public.task_procedure_binding_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  task_id uuid not null references public.tasks(id) on delete cascade,
  event text not null check (event in ('bound','moved','started','completed','reopened')),
  from_version_id uuid references public.procedure_versions(id),
  version_id uuid not null references public.procedure_versions(id),
  actor_id uuid references public.app_users(id),
  recorded_at timestamptz not null default clock_timestamp()
);
create index task_procedure_binding_events_task_idx on public.task_procedure_binding_events(task_id, recorded_at);
create index task_procedure_binding_events_company_idx on public.task_procedure_binding_events(company_id, recorded_at desc);
create index task_procedure_binding_events_from_idx on public.task_procedure_binding_events(from_version_id);
create index task_procedure_binding_events_version_idx on public.task_procedure_binding_events(version_id);
create index task_procedure_binding_events_actor_idx on public.task_procedure_binding_events(actor_id);

alter table public.procedure_versions enable row level security;
alter table public.procedure_task_kinds enable row level security;
alter table public.task_procedure_bindings enable row level security;
alter table public.task_procedure_binding_events enable row level security;
revoke all on public.procedure_versions, public.procedure_task_kinds, public.task_procedure_bindings, public.task_procedure_binding_events from public, anon, authenticated;
-- Reads and writes go through procedure_version_command; these policies only keep a future grant company-bound.
create policy procedure_versions_read on public.procedure_versions for select to authenticated
  using (company_id = (select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy procedure_task_kinds_read on public.procedure_task_kinds for select to authenticated
  using (company_id = (select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy task_procedure_bindings_read on public.task_procedure_bindings for select to authenticated
  using (company_id = (select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy task_procedure_binding_events_read on public.task_procedure_binding_events for select to authenticated
  using (company_id = (select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);

create or replace function private.ist_today() returns date language sql stable set search_path = public, private as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;
revoke all on function private.ist_today() from public, anon, authenticated;

-- Null when the steps are valid; otherwise the reason. Each step: {"text": 3-300 chars, "check": optional, up to 200}.
create or replace function private.procedure_steps_problem(p_steps jsonb) returns text language plpgsql immutable set search_path = public, private as $$
declare s jsonb;
begin
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) not between 1 and 30 then return 'Write between 1 and 30 steps'; end if;
  for s in select value from jsonb_array_elements(p_steps) loop
    if jsonb_typeof(s) <> 'object' or exists (select 1 from jsonb_object_keys(s) k where k not in ('text','check'))
       or jsonb_typeof(s -> 'text') is distinct from 'string' or length(btrim(s ->> 'text')) not between 3 and 300 then
      return 'Each step needs an instruction of 3 to 300 characters';
    end if;
    if s ? 'check' and (jsonb_typeof(s -> 'check') <> 'string' or length(s ->> 'check') > 200) then return 'Keep each key check under 200 characters'; end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.procedure_steps_problem(jsonb) from public, anon, authenticated;

create or replace function private.procedure_content_hash(p_steps jsonb, p_summary text) returns text language sql immutable set search_path = public, private as $$
  select md5(p_steps::text || '|' || btrim(p_summary))
$$;
revoke all on function private.procedure_content_hash(jsonb, text) from public, anon, authenticated;

-- Released versions are permanent records; only the allowed transitions may change a row.
create or replace function private.guard_procedure_version() returns trigger language plpgsql set search_path = public, private as $$
begin
  if tg_op = 'DELETE' then raise exception 'Procedure versions are kept as history and cannot be deleted'; end if;
  if old.status = 'withdrawn' then raise exception 'A withdrawn procedure version is final'; end if;
  if old.status <> 'draft' and (new.steps is distinct from old.steps or new.change_summary is distinct from old.change_summary or new.content_hash is distinct from old.content_hash) then
    raise exception 'A submitted or released procedure version cannot be edited. Start a new draft';
  end if;
  if new.version_no is distinct from old.version_no or new.procedure_id is distinct from old.procedure_id or new.company_id is distinct from old.company_id
     or (old.status <> 'draft' and new.author_id is distinct from old.author_id) then
    raise exception 'A procedure version cannot be moved or renumbered';
  end if;
  if old.status = 'released' and (new.status <> 'withdrawn' or new.released_at is distinct from old.released_at or new.effective_from is distinct from old.effective_from
       or new.reviewer_id is distinct from old.reviewer_id or new.in_flight_policy is distinct from old.in_flight_policy) then
    raise exception 'A released procedure version cannot be changed';
  end if;
  if old.status = 'released' and new.status = 'withdrawn' and old.effective_from <= private.ist_today() then
    raise exception 'This version is already in effect. Release a newer version instead of withdrawing it';
  end if;
  if (old.status, new.status) not in (('draft','draft'),('draft','in_review'),('draft','withdrawn'),('in_review','draft'),('in_review','in_review'),('in_review','released'),('released','withdrawn')) then
    raise exception 'That procedure version change is not allowed';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_procedure_version() from public, anon, authenticated;
create trigger a_guard_procedure_version before update or delete on public.procedure_versions for each row execute function private.guard_procedure_version();

-- A completed task keeps the version it was completed under.
create or replace function private.guard_task_procedure_binding() returns trigger language plpgsql set search_path = public, private as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.tasks where id = old.task_id) then raise exception 'Task procedure bindings are kept as history'; end if;
    return old;
  end if;
  if old.frozen_at is not null and (new.version_id is distinct from old.version_id or new.procedure_id is distinct from old.procedure_id) then
    raise exception 'The instructions recorded for a completed task cannot change';
  end if;
  if new.task_id is distinct from old.task_id or new.company_id is distinct from old.company_id then raise exception 'A binding cannot be moved to another task'; end if;
  return new;
end;
$$;
revoke all on function private.guard_task_procedure_binding() from public, anon, authenticated;
create trigger a_guard_task_procedure_binding before update or delete on public.task_procedure_bindings for each row execute function private.guard_task_procedure_binding();

create function private.guard_procedure_task_scope() returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if (new.company_id,new.dealership_id) is distinct from (old.company_id,old.dealership_id)
     and exists(select 1 from public.task_procedure_bindings where task_id=old.id) then
    raise exception 'A task with recorded procedure instructions cannot move to another company or dealership' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_procedure_task_scope() from public,anon,authenticated;
create trigger a_guard_procedure_task_scope before update of company_id,dealership_id on public.tasks for each row execute function private.guard_procedure_task_scope();

create or replace function private.task_kinds_of(p_task_type text, p_handoff_team text) returns text[] language sql immutable set search_path = public, private as $$
  select array_remove(array['type:' || p_task_type, case when p_handoff_team is not null then 'handoff:' || p_handoff_team end], null)
$$;
revoke all on function private.task_kinds_of(text, text) from public, anon, authenticated;

-- The procedure that governs a task (handoff mapping wins over the generic task type).
create or replace function private.task_procedure_id(p_company uuid, p_task_type text, p_handoff_team text) returns uuid language sql stable security definer set search_path = public, private as $$
  select m.procedure_id from public.procedure_task_kinds m join public.operating_procedures p on p.id = m.procedure_id and p.is_active
  where m.company_id = p_company and m.task_kind = any(private.task_kinds_of(p_task_type, p_handoff_team))
  order by (m.task_kind like 'handoff:%') desc limit 1
$$;
revoke all on function private.task_procedure_id(uuid, text, text) from public, anon, authenticated;

create or replace function private.procedure_applicable_version(p_procedure uuid, p_on date) returns public.procedure_versions language sql stable security definer set search_path = public, private as $$
  select v.* from public.procedure_versions v where v.procedure_id = p_procedure and v.status = 'released' and v.effective_from <= p_on
  order by v.effective_from desc, v.version_no desc limit 1
$$;
revoke all on function private.procedure_applicable_version(uuid, date) from public, anon, authenticated;

-- Applies effective releases to one company: binds open, unbound tasks of mapped kinds and, where
-- the applicable version says so, moves unstarted tasks to it. Returns how many tasks changed.
create or replace function private.procedure_sync_company(p_company uuid, p_procedure uuid default null) returns integer language plpgsql security definer set search_path = public, private as $$
declare m record; v public.procedure_versions; v_count integer := 0; v_n integer; v_today date := private.ist_today();
begin
  for m in select distinct k.procedure_id from public.procedure_task_kinds k join public.operating_procedures p on p.id = k.procedure_id and p.is_active
           where k.company_id = p_company and (p_procedure is null or k.procedure_id = p_procedure) loop
    v := private.procedure_applicable_version(m.procedure_id, v_today);
    continue when v.id is null;
    with candidates as (
      select b.task_id, b.version_id as old_version from public.task_procedure_bindings b
      join public.tasks t on t.id = b.task_id join public.procedure_versions ov on ov.id = b.version_id
      where v.in_flight_policy = 'move_unstarted' and b.company_id = p_company and b.procedure_id = m.procedure_id and b.version_id <> v.id
        and b.started_at is null and b.frozen_at is null and t.status = 'open' and ov.version_no < v.version_no
        and not exists (select 1 from public.task_procedure_binding_events e where e.task_id = b.task_id and e.event = 'completed')
      for update of b
    ), moved as (
      update public.task_procedure_bindings b set version_id = v.id, bound_at = clock_timestamp(), bound_reason = 'release_moved_unstarted'
      from candidates c where b.task_id = c.task_id
      returning b.task_id, c.old_version
    )
    insert into public.task_procedure_binding_events(company_id, task_id, event, from_version_id, version_id, actor_id)
    select p_company, task_id, 'moved', old_version, v.id, auth.uid() from moved;
    get diagnostics v_n = row_count; v_count := v_count + v_n;
    with bound as (
      insert into public.task_procedure_bindings(task_id, company_id, procedure_id, version_id, bound_reason)
      select t.id, p_company, m.procedure_id, v.id, 'kind_mapped' from public.tasks t
      where t.company_id = p_company and t.dealership_id is null and t.status = 'open'
        and private.task_procedure_id(p_company, t.task_type, t.handoff_team) = m.procedure_id
        and not exists (select 1 from public.task_procedure_bindings b where b.task_id = t.id)
      on conflict (task_id) do nothing
      returning task_id
    )
    insert into public.task_procedure_binding_events(company_id, task_id, event, version_id, actor_id) select p_company, task_id, 'bound', v.id, auth.uid() from bound;
    get diagnostics v_n = row_count; v_count := v_count + v_n;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.procedure_sync_company(uuid, uuid) from public, anon, authenticated;

-- Scheduler entry point (pg_cron has no auth.uid()): applies scheduled releases for every company.
create or replace function private.run_procedure_releases_for_all() returns integer language plpgsql security definer set search_path = public, private as $$
declare c record; v_total integer := 0;
begin
  for c in select distinct company_id from public.procedure_task_kinds loop
    v_total := v_total + private.procedure_sync_company(c.company_id);
  end loop;
  return v_total;
end;
$$;
revoke all on function private.run_procedure_releases_for_all() from public, anon, authenticated;

-- Binds new tasks, records starts, freezes completions and unfreezes reopened tasks.
create or replace function private.track_task_procedure() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_procedure uuid; v public.procedure_versions; b public.task_procedure_bindings;
begin
  if new.dealership_id is not null then return new; end if;
  select * into b from public.task_procedure_bindings where task_id = new.id for update;
  if tg_op = 'INSERT' or (b.task_id is null and old.status = 'open' and new.status = 'in_progress') then
    v_procedure := private.task_procedure_id(new.company_id, new.task_type, new.handoff_team);
    if v_procedure is null then return new; end if;
    v := private.procedure_applicable_version(v_procedure, private.ist_today());
    if v.id is null then return new; end if;
    insert into public.task_procedure_bindings(task_id, company_id, procedure_id, version_id, bound_reason, started_at, frozen_at)
    values (new.id, new.company_id, v_procedure, v.id, 'task_created', case when new.status = 'in_progress' then clock_timestamp() end,
      case when new.status = 'completed' then clock_timestamp() end);
    insert into public.task_procedure_binding_events(company_id, task_id, event, version_id, actor_id) values (new.company_id, new.id, 'bound', v.id, auth.uid());
    if tg_op='UPDATE' then
      insert into public.task_procedure_binding_events(company_id,task_id,event,version_id,actor_id) values(new.company_id,new.id,'started',v.id,auth.uid());
    end if;
    return new;
  end if;
  if b.task_id is null or new.status is not distinct from old.status then return new; end if;
  if new.status = 'in_progress' and b.started_at is null then
    -- A scheduled release that became effective before the start applies to this unstarted task.
    v := private.procedure_applicable_version(b.procedure_id, private.ist_today());
    if v.id is not null and v.id <> b.version_id and v.in_flight_policy = 'move_unstarted' and b.frozen_at is null
       and v.version_no > (select version_no from public.procedure_versions where id = b.version_id)
       and not exists (select 1 from public.task_procedure_binding_events e where e.task_id = new.id and e.event = 'completed') then
      insert into public.task_procedure_binding_events(company_id, task_id, event, from_version_id, version_id, actor_id) values (new.company_id, new.id, 'moved', b.version_id, v.id, auth.uid());
      update public.task_procedure_bindings set version_id = v.id, bound_at = clock_timestamp(), bound_reason = 'release_moved_unstarted' where task_id = new.id;
      b.version_id := v.id;
    end if;
    update public.task_procedure_bindings set started_at = clock_timestamp() where task_id = new.id;
    insert into public.task_procedure_binding_events(company_id, task_id, event, version_id, actor_id) values (new.company_id, new.id, 'started', b.version_id, auth.uid());
  elsif new.status = 'completed' then
    -- A task completed without a recorded start keeps started_at null, so durations never invent a zero.
    update public.task_procedure_bindings set frozen_at = clock_timestamp() where task_id = new.id;
    insert into public.task_procedure_binding_events(company_id, task_id, event, version_id, actor_id) values (new.company_id, new.id, 'completed', b.version_id, auth.uid());
  elsif old.status = 'completed' then
    update public.task_procedure_bindings set frozen_at = null where task_id = new.id;
    insert into public.task_procedure_binding_events(company_id, task_id, event, version_id, actor_id) values (new.company_id, new.id, 'reopened', b.version_id, auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function private.track_task_procedure() from public, anon, authenticated;
drop trigger if exists z_track_task_procedure on public.tasks;
create trigger z_track_task_procedure after insert or update of status on public.tasks for each row execute function private.track_task_procedure();

create or replace function private.procedure_version_json(v public.procedure_versions, p_with_steps boolean) returns jsonb language sql stable set search_path = public, private as $$
  select jsonb_build_object('id', v.id, 'procedure_id', v.procedure_id, 'version_no', v.version_no, 'status', v.status, 'change_summary', v.change_summary,
    'content_hash', v.content_hash, 'author_id', v.author_id, 'author_name', v.author_name, 'updated_at', v.updated_at, 'submitted_at', v.submitted_at,
    'reviewer_name', v.reviewer_name, 'review_note', v.review_note, 'released_at', v.released_at, 'effective_from', v.effective_from,
    'in_flight_policy', v.in_flight_policy, 'withdrawn_at', v.withdrawn_at, 'withdraw_reason', v.withdraw_reason, 'step_count', jsonb_array_length(v.steps))
    || case when p_with_steps then jsonb_build_object('steps', v.steps) else '{}'::jsonb end
$$;
revoke all on function private.procedure_version_json(public.procedure_versions, boolean) from public, anon, authenticated;

create or replace function public.procedure_version_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text; v_admin boolean := v_role in ('owner','admin');
  p public.operating_procedures; v public.procedure_versions; cur public.procedure_versions; t public.tasks; b public.task_procedure_bindings;
  v_steps jsonb; v_summary text; v_text text; v_problem text; v_hash text; v_date date; v_page integer; v_total bigint; v_rows jsonb; v_id uuid; v_count integer; v_recipient uuid;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid procedure version request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if v_name is null or v_role in ('dealer_admin','dealer_staff') or p_command is null or p_command not in ('versions.list','version.load','draft.save','draft.submit','draft.discard','review.return','review.release','release.withdraw','kinds.list','kinds.set','task.instructions','sync')
     or (p_command in ('draft.save','draft.submit','draft.discard','review.return','review.release','release.withdraw') and v_role = 'viewer')
     or (p_command in ('kinds.set','sync') and v_role not in ('owner','admin','factory_manager')) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'kinds.list' then
    return coalesce((select jsonb_agg(jsonb_build_object('task_kind', k.task_kind, 'procedure_id', k.procedure_id, 'procedure_title', p2.title,
        'current_version', (private.procedure_applicable_version(k.procedure_id, private.ist_today())).version_no) order by k.task_kind)
      from public.procedure_task_kinds k join public.operating_procedures p2 on p2.id = k.procedure_id where k.company_id = v_company), '[]'::jsonb);

  elsif p_command = 'kinds.set' then
    v_text := p_payload ->> 'task_kind';
    if v_text is null or v_text !~ '^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$' then raise exception 'Choose the kind of task the procedure applies to'; end if;
    if nullif(p_payload ->> 'procedure_id', '') is null then
      delete from public.procedure_task_kinds where company_id = v_company and task_kind = v_text;
      return jsonb_build_object('task_kind', v_text, 'procedure_id', null);
    end if;
    begin v_id := (p_payload ->> 'procedure_id')::uuid; exception when invalid_text_representation then raise exception 'Procedure is unavailable'; end;
    if not exists (select 1 from public.operating_procedures where id = v_id and company_id = v_company and is_active) then raise exception 'Procedure is unavailable'; end if;
    insert into public.procedure_task_kinds(company_id, task_kind, procedure_id, set_by) values (v_company, v_text, v_id, v_actor)
    on conflict (company_id, task_kind) do update set procedure_id = excluded.procedure_id, set_by = v_actor, set_at = now();
    v_count := private.procedure_sync_company(v_company, v_id);
    return jsonb_build_object('task_kind', v_text, 'procedure_id', v_id, 'tasks_bound', v_count);

  elsif p_command = 'sync' then
    return jsonb_build_object('tasks_changed', private.procedure_sync_company(v_company));

  elsif p_command = 'task.instructions' then
    begin
      select * into t from public.tasks where id = (p_payload ->> 'task_id')::uuid and company_id = v_company and dealership_id is null;
    exception when invalid_text_representation then raise exception 'Task is unavailable'; end;
    if t.id is null then raise exception 'Task is unavailable'; end if;
    select * into b from public.task_procedure_bindings where task_id = t.id;
    if b.task_id is null then
      v_id := private.task_procedure_id(v_company, t.task_type, t.handoff_team);
      return jsonb_build_object('bound', false, 'procedure_id', v_id,
        'reason', case when v_id is null then 'not_mapped' when t.status <> 'open' then 'started_before_procedure'
                       when (private.procedure_applicable_version(v_id, private.ist_today())).id is null then 'no_released_version' else 'not_synchronised' end);
    end if;
    select * into v from public.procedure_versions where id = b.version_id;
    select * into p from public.operating_procedures where id = b.procedure_id;
    cur := private.procedure_applicable_version(b.procedure_id, private.ist_today());
    return jsonb_build_object('bound', true, 'procedure_id', p.id, 'procedure_title', p.title, 'owner_name', p.owner_name, 'backup_name', p.backup_name,
      'version', private.procedure_version_json(v, true), 'bound_reason', b.bound_reason, 'started_at', b.started_at, 'frozen_at', b.frozen_at,
      'newer_version_no', case when cur.id is not null and cur.version_no > v.version_no then cur.version_no end,
      'history', coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'version_no', ev.version_no, 'from_version_no', fv.version_no, 'recorded_at', e.recorded_at) order by e.recorded_at, e.id)
        from public.task_procedure_binding_events e join public.procedure_versions ev on ev.id = e.version_id left join public.procedure_versions fv on fv.id = e.from_version_id
        where e.task_id = t.id), '[]'::jsonb));

  elsif p_command = 'versions.list' then
    begin
      select * into p from public.operating_procedures where id = (p_payload ->> 'procedure_id')::uuid and company_id = v_company;
      v_page := coalesce((p_payload ->> 'page')::integer, 1);
    exception when invalid_text_representation then raise exception 'Procedure is unavailable'; end;
    if p.id is null then raise exception 'Procedure is unavailable'; end if;
    if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
    cur := private.procedure_applicable_version(p.id, private.ist_today());
    select count(*) into v_total from public.procedure_versions where procedure_id = p.id;
    select coalesce(jsonb_agg(private.procedure_version_json(x, false) order by x.version_no desc), '[]'::jsonb) into v_rows
    from (select * from public.procedure_versions where procedure_id = p.id order by version_no desc limit 10 offset (v_page - 1) * 10) x;
    return jsonb_build_object('procedure', jsonb_build_object('id', p.id, 'title', p.title, 'owner_id', p.owner_id, 'owner_name', p.owner_name, 'backup_id', p.backup_id, 'backup_name', p.backup_name, 'is_active', p.is_active),
      'current', case when cur.id is null then null else private.procedure_version_json(cur, true) end,
      'scheduled', coalesce((select jsonb_agg(private.procedure_version_json(s, false) order by s.effective_from, s.version_no) from public.procedure_versions s
        where s.procedure_id = p.id and s.status = 'released' and s.effective_from > private.ist_today()), '[]'::jsonb),
      'open', (select private.procedure_version_json(o, true) from public.procedure_versions o where o.procedure_id = p.id and o.status in ('draft','in_review')),
      'task_kinds', coalesce((select jsonb_agg(k.task_kind order by k.task_kind) from public.procedure_task_kinds k where k.company_id = v_company and k.procedure_id = p.id), '[]'::jsonb),
      'can_author', coalesce(v_admin or v_actor in (p.owner_id, p.backup_id), false), 'can_review', coalesce(v_admin or v_actor in (p.owner_id, p.backup_id), false),
      'rows', v_rows, 'total_count', v_total);
  end if;

  -- Version-scoped commands.
  if p_command = 'draft.save' then
    begin
      select * into p from public.operating_procedures where id = (p_payload ->> 'procedure_id')::uuid and company_id = v_company for update;
      v_id := (p_payload ->> 'version_id')::uuid;
    exception when invalid_text_representation then raise exception 'Procedure is unavailable'; end;
    if p.id is null or v_id is null then raise exception 'Procedure is unavailable'; end if;
    if not p.is_active then raise exception 'This procedure is inactive'; end if;
  else
    begin
      select * into v from public.procedure_versions where id = (p_payload ->> 'version_id')::uuid and company_id = v_company;
    exception when invalid_text_representation then raise exception 'Procedure version is unavailable'; end;
    if v.id is null then raise exception 'Procedure version is unavailable'; end if;
    if p_command = 'version.load' then return private.procedure_version_json(v, true); end if;
    select * into p from public.operating_procedures where id = v.procedure_id for update;
    -- Match draft.save's procedure-then-version lock order and read fresh state after waiting.
    select * into v from public.procedure_versions where id = v.id and company_id=v_company for update;
  end if;
  if p_command in ('draft.save','draft.submit','draft.discard') and not coalesce(v_admin or v_actor in (p.owner_id, p.backup_id), false) then
    raise exception 'Only the procedure owner, its backup or an owner/admin can write procedure versions' using errcode = '42501';
  end if;
  if p_command in ('review.return','review.release','release.withdraw') and not coalesce(v_admin or v_actor in (p.owner_id, p.backup_id), false) then
    raise exception 'Only the procedure owner, its backup or an owner/admin can review procedure versions' using errcode = '42501';
  end if;

  if p_command not in ('draft.save','release.withdraw') and v.content_hash is distinct from (p_payload ->> 'expected_hash') then
    raise exception 'This version was changed by someone else. Reload it before continuing';
  end if;

  if p_command = 'draft.save' then
    v_steps := p_payload -> 'steps';
    v_summary := btrim(coalesce(p_payload ->> 'change_summary', ''));
    v_problem := private.procedure_steps_problem(v_steps);
    if v_problem is not null then raise exception '%', v_problem; end if;
    if length(v_summary) not between 3 and 500 then raise exception 'Summarise what this version changes (3 to 500 characters)'; end if;
    -- Store trimmed text so the hash and the instructions agree.
    select jsonb_agg(case when s ? 'check' and length(btrim(s ->> 'check')) > 0 then jsonb_build_object('text', btrim(s ->> 'text'), 'check', btrim(s ->> 'check'))
                          else jsonb_build_object('text', btrim(s ->> 'text')) end order by n)
    into v_steps from jsonb_array_elements(v_steps) with ordinality as e(s, n);
    v_hash := private.procedure_content_hash(v_steps, v_summary);
    select * into v from public.procedure_versions where id = v_id for update;
    if v.id is null then
      if exists (select 1 from public.procedure_versions where procedure_id = p.id and status in ('draft','in_review')) then
        raise exception 'This procedure already has a draft or a version in review. Continue that one';
      end if;
      insert into public.procedure_versions(id, company_id, procedure_id, version_no, steps, change_summary, content_hash, author_id, author_name)
      values (v_id, v_company, p.id, coalesce((select max(version_no) from public.procedure_versions where procedure_id = p.id), 0) + 1, v_steps, v_summary, v_hash, v_actor, v_name)
      returning * into v;
      return private.procedure_version_json(v, true);
    end if;
    if v.company_id <> v_company or v.procedure_id <> p.id then raise exception 'Procedure version is unavailable'; end if;
    if v.status <> 'draft' then
      if v.content_hash = v_hash and v.author_id = v_actor then return private.procedure_version_json(v, true); end if;  -- a retried save
      raise exception 'Only a draft can be edited. Start a new draft';
    end if;
    if v.content_hash is distinct from (p_payload ->> 'expected_hash') then
      if v.content_hash = v_hash then return private.procedure_version_json(v, true); end if;
      raise exception 'This version was changed by someone else. Reload it before continuing';
    end if;
    -- Whoever last wrote the draft is its author, so they cannot also review it.
    update public.procedure_versions set steps = v_steps, change_summary = v_summary, content_hash = v_hash, author_id = v_actor, author_name = v_name, updated_at = clock_timestamp()
    where id = v.id returning * into v;
    return private.procedure_version_json(v, true);

  elsif p_command = 'draft.submit' then
    if v.status <> 'draft' then raise exception 'Only a draft can be sent for review'; end if;
    update public.procedure_versions set status = 'in_review', submitted_at = clock_timestamp(), updated_at = clock_timestamp(), review_note = null where id = v.id returning * into v;
    for v_recipient in select distinct x from unnest(array[p.owner_id, p.backup_id]) x where x is not null and x <> v.author_id loop
      insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
      values (v_company, v_recipient, 'procedure_review', 'info', left('Review procedure: ' || p.title || ' v' || v.version_no, 200), left(v.change_summary, 500), 'operating_procedure', p.id, v_actor, '/tasks/procedures/' || p.id || '/versions');
    end loop;
    return private.procedure_version_json(v, false);

  elsif p_command = 'draft.discard' then
    if v.status <> 'draft' then raise exception 'Only a draft can be discarded'; end if;
    update public.procedure_versions set status = 'withdrawn', withdrawn_at = clock_timestamp(), withdrawn_by = v_actor, withdraw_reason = 'Draft discarded', updated_at = clock_timestamp()
    where id = v.id returning * into v;
    return private.procedure_version_json(v, false);

  elsif p_command = 'review.return' then
    if v.status <> 'in_review' then raise exception 'Only a version in review can be returned'; end if;
    if v.author_id = v_actor then raise exception 'You wrote this version, so someone else must review it' using errcode = '42501'; end if;
    v_text := btrim(coalesce(p_payload ->> 'note', ''));
    if length(v_text) not between 3 and 500 then raise exception 'Explain what must change (3 to 500 characters)'; end if;
    update public.procedure_versions set status = 'draft', review_note = v_text, reviewer_name = v_name, submitted_at = null, updated_at = clock_timestamp() where id = v.id returning * into v;
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
    values (v_company, v.author_id, 'procedure_review', 'warning', left('Returned: ' || p.title || ' v' || v.version_no, 200), left(v_name || ': ' || v_text, 500), 'operating_procedure', p.id, v_actor, '/tasks/procedures/' || p.id || '/versions');
    return private.procedure_version_json(v, false);

  elsif p_command = 'review.release' then
    if v.status <> 'in_review' then raise exception 'Only a version in review can be released'; end if;
    if v.author_id = v_actor then raise exception 'You wrote this version, so someone else must review it' using errcode = '42501'; end if;
    begin v_date := (p_payload ->> 'effective_from')::date; exception when others then v_date := null; end;
    if v_date is null or v_date < private.ist_today() or v_date > private.ist_today() + 366 then raise exception 'Choose an effective date from today up to a year ahead'; end if;
    if coalesce(p_payload ->> 'in_flight_policy', '') not in ('keep_current','move_unstarted') then raise exception 'Choose what happens to tasks already given an earlier version'; end if;
    if exists (select 1 from public.procedure_versions where procedure_id = p.id and status = 'released' and effective_from > v_date) then
      raise exception 'A later release is already scheduled. Choose a date on or after it, or withdraw it first';
    end if;
    v_text := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
    if v_text is not null and length(v_text) > 500 then raise exception 'Keep the review note under 500 characters'; end if;
    update public.procedure_versions set status = 'released', reviewer_id = v_actor, reviewer_name = v_name, review_note = v_text, released_at = clock_timestamp(),
      effective_from = v_date, in_flight_policy = p_payload ->> 'in_flight_policy', updated_at = clock_timestamp()
    where id = v.id returning * into v;
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
    values (v_company, v.author_id, 'procedure_review', 'success', left('Released: ' || p.title || ' v' || v.version_no, 200), 'Effective from ' || to_char(v_date, 'DD Mon YYYY'), 'operating_procedure', p.id, v_actor, '/tasks/procedures/' || p.id || '/versions');
    v_count := case when v_date <= private.ist_today() then private.procedure_sync_company(v_company, p.id) else 0 end;
    return private.procedure_version_json(v, false) || jsonb_build_object('tasks_changed', v_count);
  end if;

  -- release.withdraw: a scheduled release is cancelled before it takes effect.
  if v.status <> 'released' then raise exception 'Only a scheduled release can be withdrawn'; end if;
  if v.effective_from <= private.ist_today() then raise exception 'This version is already in effect. Release a newer version instead of withdrawing it'; end if;
  v_text := btrim(coalesce(p_payload ->> 'reason', ''));
  if length(v_text) not between 3 and 300 then raise exception 'Record why the release is withdrawn (3 to 300 characters)'; end if;
  update public.procedure_versions set status = 'withdrawn', withdrawn_at = clock_timestamp(), withdrawn_by = v_actor, withdraw_reason = v_text, updated_at = clock_timestamp()
  where id = v.id returning * into v;
  return private.procedure_version_json(v, false);
end;
$$;
revoke all on function public.procedure_version_command(text, jsonb) from public, anon;
grant execute on function public.procedure_version_command(text, jsonb) to authenticated;

commit;
