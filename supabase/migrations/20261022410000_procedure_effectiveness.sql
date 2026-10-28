-- UPGRADE_EOS feature 80: review SOP effectiveness using outcomes.
--
-- Outcomes are measured per procedure version (feature 77) from the tasks that followed it:
--   completion and duration (recorded start to completion; tasks without a recorded start are
--   counted as a data-quality gap, never as zero), rework (completed tasks reopened), returned and
--   first-time-accepted handovers (feature 69) and routed exceptions (feature 61). Every rate keeps
--   its numerator and denominator, and samples under five are marked as not comparable.
-- Employees flag an unclear, unnecessary or missing step from the task itself. The process owner,
-- backup or an owner/admin turns flags into an improvement and takes it through
--   proposed -> trial -> awaiting_release -> released -> measured   (or rejected)
-- where "released" links the reviewed procedure version that carries the change and "measured"
-- stores the before/after outcomes. The full trace is kept. Additive only; depends on 20261022290000
-- (handoff acceptance), 20261022390000 (procedure versions) and 20261022400000 (task exceptions).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.procedure_improvements (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  procedure_id uuid not null references public.operating_procedures(id),
  title text not null check (length(btrim(title)) between 3 and 120),
  problem_summary text not null check (length(btrim(problem_summary)) between 3 and 800),
  status text not null default 'proposed' check (status in ('proposed','trial','awaiting_release','released','measured','rejected')),
  baseline_version_id uuid not null references public.procedure_versions(id),
  proposed_by uuid not null references public.app_users(id),
  proposed_by_name text not null,
  proposed_at timestamptz not null default clock_timestamp(),
  trial_plan text check (trial_plan is null or length(btrim(trial_plan)) between 3 and 800),
  trial_started_at timestamptz,
  trial_findings text check (trial_findings is null or length(btrim(trial_findings)) between 3 and 800),
  trial_decided_by_name text,
  trial_decided_at timestamptz,
  resolution_version_id uuid references public.procedure_versions(id),
  released_linked_at timestamptz,
  outcome jsonb,
  measured_by_name text,
  measured_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (status not in ('released','measured') or resolution_version_id is not null),
  check (status <> 'measured' or outcome is not null)
);
create index procedure_improvements_company_idx on public.procedure_improvements(company_id, procedure_id, proposed_at desc);
create index procedure_improvements_baseline_idx on public.procedure_improvements(baseline_version_id);
create index procedure_improvements_resolution_idx on public.procedure_improvements(resolution_version_id);
create index procedure_improvements_proposed_by_idx on public.procedure_improvements(proposed_by);

create table public.procedure_step_flags (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  procedure_id uuid not null references public.operating_procedures(id),
  version_id uuid not null references public.procedure_versions(id),
  step_no integer not null check (step_no between 1 and 30),
  task_id uuid not null references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('unclear','unnecessary','missing_step','workaround')),
  note text not null check (length(btrim(note)) between 3 and 500),
  flagged_by uuid not null references public.app_users(id),
  flagged_by_name text not null,
  flagged_at timestamptz not null default clock_timestamp(),
  status text not null default 'open' check (status in ('open','linked','dismissed')),
  improvement_id uuid references public.procedure_improvements(id),
  dismissed_reason text check (dismissed_reason is null or length(btrim(dismissed_reason)) between 3 and 300),
  check ((status = 'linked') = (improvement_id is not null)),
  check ((status = 'dismissed') = (dismissed_reason is not null))
);
create unique index procedure_step_flags_one_open on public.procedure_step_flags(task_id, step_no, flagged_by) where status = 'open';
create index procedure_step_flags_company_idx on public.procedure_step_flags(company_id, procedure_id, status, flagged_at desc);
create index procedure_step_flags_version_idx on public.procedure_step_flags(version_id, step_no);
create index procedure_step_flags_improvement_idx on public.procedure_step_flags(improvement_id);
create index procedure_step_flags_flagged_by_idx on public.procedure_step_flags(flagged_by);
create index procedure_step_flags_task_idx on public.procedure_step_flags(task_id);

alter table public.procedure_improvements enable row level security;
alter table public.procedure_step_flags enable row level security;
revoke all on public.procedure_improvements, public.procedure_step_flags from public, anon, authenticated;
create policy procedure_improvements_read on public.procedure_improvements for select to authenticated
  using (company_id = (select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy procedure_step_flags_read on public.procedure_step_flags for select to authenticated
  using (company_id = (select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);

-- An improvement moves only forward along its path, and its trace fields never change once set.
create or replace function private.guard_procedure_improvement() returns trigger language plpgsql set search_path = public, private as $$
begin
  if tg_op = 'DELETE' then raise exception 'Procedure improvements are kept as history'; end if;
  if old.status <> new.status and (old.status, new.status) not in (('proposed','trial'),('proposed','rejected'),('trial','awaiting_release'),('trial','rejected'),
       ('awaiting_release','released'),('released','measured')) then
    raise exception 'That improvement change is not allowed';
  end if;
  if new.baseline_version_id is distinct from old.baseline_version_id or new.procedure_id is distinct from old.procedure_id or new.company_id is distinct from old.company_id
     or new.proposed_by is distinct from old.proposed_by or (old.resolution_version_id is not null and new.resolution_version_id is distinct from old.resolution_version_id)
     or (old.trial_findings is not null and new.trial_findings is distinct from old.trial_findings) or (old.outcome is not null and new.outcome is distinct from old.outcome) then
    raise exception 'The trace of an improvement cannot be rewritten';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_procedure_improvement() from public, anon, authenticated;
create trigger a_guard_procedure_improvement before update or delete on public.procedure_improvements for each row execute function private.guard_procedure_improvement();

-- Outcomes of the tasks that followed one procedure version.
create or replace function private.procedure_version_outcomes(p_version uuid) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  v public.procedure_versions; r record; v_limits text[] := array[]::text[];
begin
  select * into v from public.procedure_versions where id = p_version;
  if v.id is null then return null; end if;
  with bound as (
    select b.task_id, b.started_at, t.status, t.completed_at from public.task_procedure_bindings b join public.tasks t on t.id = b.task_id where b.version_id = p_version
  ), durations as (
    select extract(epoch from (completed_at - started_at)) / 3600.0 as hours from bound where status = 'completed' and started_at is not null and completed_at is not null and completed_at >= started_at
  )
  select
    (select count(*) from bound) as tasks,
    (select count(*) from bound where status = 'completed') as completed,
    (select count(*) from bound where status = 'completed' and (started_at is null or completed_at is null or completed_at < started_at)) as missing_duration,
    (select round(avg(hours)::numeric, 1) from durations) as avg_hours,
    (select round((percentile_cont(0.5) within group (order by hours))::numeric, 1) from durations) as median_hours,
    (select count(distinct e.task_id) from public.task_procedure_binding_events e join bound on bound.task_id = e.task_id where e.event = 'reopened' and e.version_id = p_version) as reopened,
    (select count(*) from public.handoff_acceptances a join bound on bound.task_id = a.task_id where a.state = 'accepted') as handoffs_accepted,
    (select count(*) from public.handoff_acceptances a join bound on bound.task_id = a.task_id where a.state = 'accepted' and a.return_count = 0) as first_time_accepted,
    (select count(*) from public.handoff_returns h join bound on bound.task_id = h.handoff_task_id) as handoff_returns,
    (select count(*) from public.task_exceptions x join bound on bound.task_id = x.task_id) as exceptions,
    (select count(distinct x.task_id) from public.task_exceptions x join bound on bound.task_id = x.task_id) as tasks_with_exceptions,
    (select count(*) from public.procedure_step_flags s where s.version_id = p_version and s.status <> 'dismissed') as step_flags
  into r;
  if r.completed < 5 then v_limits := array_append(v_limits, format('Only %s completed task%s: too few to compare', r.completed, case when r.completed = 1 then '' else 's' end)); end if;
  if r.missing_duration > 0 then v_limits := array_append(v_limits, format('%s completed task%s had no recorded start, so duration excludes them', r.missing_duration, case when r.missing_duration = 1 then '' else 's' end)); end if;
  if r.handoffs_accepted = 0 then v_limits := array_append(v_limits, 'No accepted handovers: first-time acceptance is not captured'); end if;
  return jsonb_build_object('version_id', v.id, 'version_no', v.version_no, 'effective_from', v.effective_from, 'tasks', r.tasks, 'completed', r.completed,
    'avg_hours', r.avg_hours, 'median_hours', r.median_hours, 'duration_sample', r.completed - r.missing_duration, 'missing_duration', r.missing_duration,
    'reopened', r.reopened, 'handoffs_accepted', r.handoffs_accepted, 'first_time_accepted', r.first_time_accepted, 'handoff_returns', r.handoff_returns,
    'exceptions', r.exceptions, 'tasks_with_exceptions', r.tasks_with_exceptions, 'step_flags', r.step_flags,
    'comparable', r.completed >= 5 and r.completed-r.missing_duration >= 5, 'limits', to_jsonb(v_limits));
end;
$$;
revoke all on function private.procedure_version_outcomes(uuid) from public, anon, authenticated;

create or replace function private.improvement_json(i public.procedure_improvements, p_full boolean) returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', i.id, 'procedure_id', i.procedure_id, 'title', i.title, 'problem_summary', i.problem_summary, 'status', i.status,
    'baseline_version_no', (select version_no from public.procedure_versions where id = i.baseline_version_id),
    'resolution_version_no', (select version_no from public.procedure_versions where id = i.resolution_version_id),
    'proposed_by_name', i.proposed_by_name, 'proposed_at', i.proposed_at, 'trial_plan', i.trial_plan, 'trial_started_at', i.trial_started_at,
    'trial_findings', i.trial_findings, 'trial_decided_by_name', i.trial_decided_by_name, 'trial_decided_at', i.trial_decided_at,
    'released_linked_at', i.released_linked_at, 'measured_by_name', i.measured_by_name, 'measured_at', i.measured_at, 'updated_at', i.updated_at,
    'flag_count', (select count(*) from public.procedure_step_flags f where f.improvement_id = i.id))
  || case when p_full then jsonb_build_object('outcome', i.outcome,
       'flags', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'step_no', f.step_no, 'kind', f.kind, 'note', f.note, 'flagged_by_name', f.flagged_by_name, 'flagged_at', f.flagged_at,
          'version_no', pv.version_no, 'task_id', f.task_id) order by f.flagged_at, f.id)
        from public.procedure_step_flags f join public.procedure_versions pv on pv.id = f.version_id where f.improvement_id = i.id), '[]'::jsonb)) else '{}'::jsonb end
$$;
revoke all on function private.improvement_json(public.procedure_improvements, boolean) from public, anon, authenticated;

create or replace function public.procedure_effectiveness_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text; v_admin boolean := v_role in ('owner','admin');
  p public.operating_procedures; t public.tasks; b public.task_procedure_bindings; v public.procedure_versions; cur public.procedure_versions;
  i public.procedure_improvements; fl public.procedure_step_flags; v_text text; v_id uuid; v_step integer; v_page integer; v_total bigint; v_rows jsonb; v_ids uuid[]; v_n integer;
  v_before jsonb; v_after jsonb;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid effectiveness request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if v_name is null or v_role in ('dealer_admin','dealer_staff') or p_command is null or p_command not in ('outcomes','flag.raise','flag.dismiss','flags.list','improvement.propose','improvement.trial','improvement.decide','improvement.link_release','improvement.measure','improvements.list','improvement.load')
     or (v_role = 'viewer' and p_command not in ('outcomes','flags.list','improvements.list','improvement.load')) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'flag.raise' then
    -- From the task: the step must exist in the version this task follows.
    begin
      select * into t from public.tasks where id = (p_payload ->> 'task_id')::uuid and company_id = v_company and dealership_id is null for update;
      v_id := (p_payload ->> 'id')::uuid; v_step := (p_payload ->> 'step_no')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid effectiveness request'; end;
    if t.id is null then raise exception 'Task is unavailable'; end if;
    select * into fl from public.procedure_step_flags where id = v_id;
    if fl.id is not null then
      if fl.task_id <> t.id or fl.flagged_by <> v_actor or fl.step_no is distinct from v_step or fl.kind is distinct from (p_payload->>'kind') or fl.note is distinct from btrim(p_payload->>'note') then raise exception 'Invalid effectiveness request'; end if;
      return jsonb_build_object('id', fl.id, 'status', fl.status);
    end if;
    select * into b from public.task_procedure_bindings where task_id = t.id;
    if b.task_id is null then raise exception 'This task follows no procedure version, so there is no step to flag'; end if;
    if not coalesce(t.assigned_to = v_actor or v_role in ('owner','admin','factory_manager') or v_role like '%\_manager' escape '\'
            or exists (select 1 from public.task_procedure_binding_events e where e.task_id = t.id and e.actor_id = v_actor), false) then
      raise exception 'Only someone who worked on this task can flag its steps' using errcode = '42501';
    end if;
    select * into v from public.procedure_versions where id = b.version_id;
    if v_step is null or v_step < 1 or v_step > jsonb_array_length(v.steps) then raise exception 'Choose a step of the version this task follows'; end if;
    if coalesce(p_payload ->> 'kind', '') not in ('unclear','unnecessary','missing_step','workaround') then raise exception 'Choose what is wrong with the step'; end if;
    v_text := btrim(coalesce(p_payload ->> 'note', ''));
    if length(v_text) not between 3 and 500 then raise exception 'Describe the problem (3 to 500 characters)'; end if;
    begin
      insert into public.procedure_step_flags(id, company_id, procedure_id, version_id, step_no, task_id, kind, note, flagged_by, flagged_by_name)
      values (v_id, v_company, b.procedure_id, b.version_id, v_step, t.id, p_payload ->> 'kind', v_text, v_actor, v_name);
    exception when unique_violation then raise exception 'You already flagged this step on this task';
    end;
    return jsonb_build_object('id', v_id, 'status', 'open');
  end if;

  -- Procedure- and improvement-scoped commands.
  begin
    if p_command in ('flag.dismiss') then
      select * into fl from public.procedure_step_flags where id = (p_payload ->> 'flag_id')::uuid and company_id = v_company for update;
      if fl.id is null then raise exception 'Flag is unavailable'; end if;
      select * into p from public.operating_procedures where id = fl.procedure_id;
    elsif p_command in ('improvement.trial','improvement.decide','improvement.link_release','improvement.measure','improvement.load') then
      select * into i from public.procedure_improvements where id = (p_payload ->> 'improvement_id')::uuid and company_id = v_company for update;
      if i.id is null then raise exception 'Improvement is unavailable'; end if;
      select * into p from public.operating_procedures where id = i.procedure_id;
    else
      select * into p from public.operating_procedures where id = (p_payload ->> 'procedure_id')::uuid and company_id = v_company;
      if p.id is null then raise exception 'Procedure is unavailable'; end if;
    end if;
  exception when invalid_text_representation then raise exception 'Invalid effectiveness request'; end;

  if p_command in ('flag.dismiss','improvement.trial','improvement.decide','improvement.link_release','improvement.measure') and not coalesce(v_admin or v_actor in (p.owner_id, p.backup_id), false) then
    raise exception 'Only the procedure owner, its backup or an owner/admin can review effectiveness' using errcode = '42501';
  end if;

  if p_command = 'outcomes' then
    cur := private.procedure_applicable_version(p.id, private.ist_today());
    return jsonb_build_object('procedure', jsonb_build_object('id', p.id, 'title', p.title, 'owner_name', p.owner_name),
      'current_version_no', cur.version_no,
      'versions', coalesce((select jsonb_agg(private.procedure_version_outcomes(x.id) order by x.version_no desc)
        from (select id, version_no from public.procedure_versions where procedure_id = p.id and status in ('released') order by version_no desc limit 5) x), '[]'::jsonb),
      'step_flags', coalesce((select jsonb_agg(jsonb_build_object('step_no', s.step_no, 'open', s.open, 'kinds', s.kinds) order by s.open desc, s.step_no)
        from (select step_no, count(*) as open, jsonb_agg(distinct kind) as kinds from public.procedure_step_flags
              where procedure_id = p.id and status = 'open' and version_id = cur.id group by step_no) s), '[]'::jsonb),
      'can_review', coalesce(v_admin or v_actor in (p.owner_id, p.backup_id), false));

  elsif p_command = 'flags.list' then
    v_text := coalesce(p_payload ->> 'status', 'open');
    if v_text not in ('open','linked','dismissed') then raise exception 'Invalid effectiveness request'; end if;
    begin v_page := coalesce((p_payload ->> 'page')::integer, 1); exception when invalid_text_representation then v_page := 0; end;
    if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
    select count(*) into v_total from public.procedure_step_flags where procedure_id = p.id and status = v_text;
    select coalesce(jsonb_agg(to_jsonb(r) order by r.flagged_at desc, r.id), '[]'::jsonb) into v_rows from (
      select f.id, f.step_no, f.kind, f.note, f.flagged_by_name, f.flagged_at, f.status, f.task_id, pv.version_no, f.improvement_id, f.dismissed_reason,
        pv.steps -> (f.step_no - 1) ->> 'text' as step_text
      from public.procedure_step_flags f join public.procedure_versions pv on pv.id = f.version_id
      where f.procedure_id = p.id and f.status = v_text order by f.flagged_at desc, f.id limit 10 offset (v_page - 1) * 10) r;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total);

  elsif p_command = 'flag.dismiss' then
    if fl.status <> 'open' then raise exception 'Only an open flag can be dismissed'; end if;
    v_text := btrim(coalesce(p_payload ->> 'reason', ''));
    if length(v_text) not between 3 and 300 then raise exception 'Record why the flag is dismissed (3 to 300 characters)'; end if;
    update public.procedure_step_flags set status = 'dismissed', dismissed_reason = v_text where id = fl.id;
    return jsonb_build_object('id', fl.id, 'status', 'dismissed');

  elsif p_command = 'improvements.list' then
    begin v_page := coalesce((p_payload ->> 'page')::integer, 1); exception when invalid_text_representation then v_page := 0; end;
    if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
    select count(*) into v_total from public.procedure_improvements where procedure_id = p.id;
    select coalesce(jsonb_agg(private.improvement_json(x, false) order by x.proposed_at desc, x.id), '[]'::jsonb) into v_rows
    from (select * from public.procedure_improvements where procedure_id = p.id order by proposed_at desc, id limit 10 offset (v_page - 1) * 10) x;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total);

  elsif p_command = 'improvement.load' then
    return private.improvement_json(i, true);

  elsif p_command = 'improvement.propose' then
    begin
      v_id := (p_payload ->> 'id')::uuid;
      v_ids := array(select jsonb_array_elements_text(coalesce(p_payload -> 'flag_ids', '[]'::jsonb))::uuid);
    exception when invalid_text_representation then raise exception 'Invalid effectiveness request'; end;
    select * into i from public.procedure_improvements where id = v_id;
    if i.id is not null then
      if i.procedure_id <> p.id or i.proposed_by <> v_actor or i.title is distinct from btrim(p_payload->>'title') or i.problem_summary is distinct from btrim(p_payload->>'problem_summary') then raise exception 'Invalid effectiveness request'; end if;
      return private.improvement_json(i, false);
    end if;
    cur := private.procedure_applicable_version(p.id, private.ist_today());
    if cur.id is null then raise exception 'This procedure has no version in effect to improve'; end if;
    if length(btrim(coalesce(p_payload ->> 'title', ''))) not between 3 and 120 or length(btrim(coalesce(p_payload ->> 'problem_summary', ''))) not between 3 and 800 then
      raise exception 'Give the improvement a title and describe the recurring problem';
    end if;
    if cardinality(v_ids) > 50 then raise exception 'Link up to 50 flags'; end if;
    perform 1 from public.procedure_step_flags where id = any(v_ids) for update;
    select count(*) into v_n from public.procedure_step_flags where id = any(v_ids) and procedure_id = p.id and status = 'open';
    if v_n <> cardinality(v_ids) then raise exception 'Some flags are no longer open. Refresh and choose again'; end if;
    insert into public.procedure_improvements(id, company_id, procedure_id, title, problem_summary, baseline_version_id, proposed_by, proposed_by_name)
    values (v_id, v_company, p.id, btrim(p_payload ->> 'title'), btrim(p_payload ->> 'problem_summary'), cur.id, v_actor, v_name) returning * into i;
    update public.procedure_step_flags set status = 'linked', improvement_id = i.id where id = any(v_ids);
    if p.owner_id <> v_actor then
      insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
      values (v_company, p.owner_id, 'procedure_improvement', 'info', left('Improvement proposed: ' || p.title, 200), left(i.title || ' · ' || i.problem_summary, 500), 'operating_procedure', p.id, v_actor, '/tasks/procedures/' || p.id || '/effectiveness');
    end if;
    return private.improvement_json(i, false);

  elsif p_command = 'improvement.trial' then
    if i.status <> 'proposed' then raise exception 'Only a proposed improvement can start a trial'; end if;
    v_text := btrim(coalesce(p_payload ->> 'trial_plan', ''));
    if length(v_text) not between 3 and 800 then raise exception 'Describe the trial: who tries the changed method, where and for how long (3 to 800 characters)'; end if;
    update public.procedure_improvements set status = 'trial', trial_plan = v_text, trial_started_at = clock_timestamp(), updated_at = clock_timestamp() where id = i.id returning * into i;
    return private.improvement_json(i, false);

  elsif p_command = 'improvement.decide' then
    if i.status = 'proposed' and p_payload ->> 'decision' = 'reject' then
      null;  -- a proposal may be rejected before any trial
    elsif i.status <> 'trial' then raise exception 'Record trial findings only while the improvement is in trial';
    end if;
    if coalesce(p_payload ->> 'decision', '') not in ('adopt','reject') then raise exception 'Choose to adopt or reject the change'; end if;
    v_text := btrim(coalesce(p_payload ->> 'findings', ''));
    if length(v_text) not between 3 and 800 then raise exception 'Record what the trial found (3 to 800 characters)'; end if;
    update public.procedure_improvements set status = case when p_payload ->> 'decision' = 'adopt' then 'awaiting_release' else 'rejected' end,
      trial_findings = v_text, trial_decided_by_name = v_name, trial_decided_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = i.id returning * into i;
    if i.status = 'rejected' then
      -- The flags return to the open queue, unless the same person has since flagged that step again.
      update public.procedure_step_flags f set status = 'dismissed', improvement_id = null, dismissed_reason = 'Flagged again on the same task'
      where f.improvement_id = i.id and exists (select 1 from public.procedure_step_flags o where o.task_id = f.task_id and o.step_no = f.step_no and o.flagged_by = f.flagged_by and o.status = 'open');
      update public.procedure_step_flags set status = 'open', improvement_id = null where improvement_id = i.id;
    end if;
    return private.improvement_json(i, false);

  elsif p_command = 'improvement.link_release' then
    if i.status <> 'awaiting_release' then raise exception 'Only an adopted improvement can be linked to a release'; end if;
    begin select * into v from public.procedure_versions where id = (p_payload ->> 'version_id')::uuid and company_id = v_company;
    exception when invalid_text_representation then raise exception 'Invalid effectiveness request'; end;
    if v.id is null or v.procedure_id <> p.id then raise exception 'Choose a version of this procedure'; end if;
    if v.status <> 'released' then raise exception 'Choose a reviewed, released version'; end if;
    if v.version_no <= (select version_no from public.procedure_versions where id = i.baseline_version_id) or v.released_at < i.proposed_at then
      raise exception 'Choose a version released after the improvement was proposed';
    end if;
    update public.procedure_improvements set status = 'released', resolution_version_id = v.id, released_linked_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = i.id returning * into i;
    return private.improvement_json(i, false);
  end if;

  -- improvement.measure: before/after outcomes, frozen once recorded.
  if i.status <> 'released' then raise exception 'Only a released improvement can be measured'; end if;
  select * into v from public.procedure_versions where id = i.resolution_version_id;
  if v.effective_from > private.ist_today() then raise exception 'The improved version is not in effect yet'; end if;
  v_before := private.procedure_version_outcomes(i.baseline_version_id);
  v_after := private.procedure_version_outcomes(i.resolution_version_id);
  if (v_after ->> 'completed')::integer = 0 then raise exception 'No task has completed under the improved version yet'; end if;
  update public.procedure_improvements set status = 'measured', outcome = jsonb_build_object('before', v_before, 'after', v_after,
      'comparable', (v_before ->> 'comparable')::boolean and (v_after ->> 'comparable')::boolean,
      'note', nullif(btrim(coalesce(p_payload ->> 'note', '')), '')),
    measured_by_name = v_name, measured_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = i.id returning * into i;
  return private.improvement_json(i, true);
end;
$$;
revoke all on function public.procedure_effectiveness_command(text, jsonb) from public, anon;
grant execute on function public.procedure_effectiveness_command(text, jsonb) to authenticated;

commit;
