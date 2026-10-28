-- UPGRADE_EOS feature 13: quick queue updates and safe bulk actions.
--
-- Supervisors select up to 50 records in a queue, preview the outcome for every one, then apply.
-- Supported: tasks (assign, due date, priority) and planned production jobs (planned date, shift).
-- Every selected record gets an explicit outcome (changed, unchanged, rejected with a reason,
-- unavailable, or duplicate selection), so no selected work is silently dropped. On apply each
-- record is locked and rechecked against a fingerprint of the fields the preview showed, so a
-- record changed by someone else in between is rejected rather than overwritten. A request id
-- makes the apply idempotent: a retry returns the recorded outcome without writing again.
-- Additive: one operation log table.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.bulk_queue_operations (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  target text not null check (target in ('tasks','production_jobs')),
  action text not null check (action in ('assign','due_date','priority','planned_date','shift')),
  value jsonb not null,
  record_ids uuid[] not null check (cardinality(record_ids) between 1 and 50),
  results jsonb not null,
  changed_count integer not null check (changed_count >= 0),
  actor_id uuid not null references public.app_users(id),
  actor_name text not null,
  created_at timestamptz not null default now()
);
create index bulk_queue_operations_company_idx on public.bulk_queue_operations(company_id, created_at desc);
create index bulk_queue_operations_actor_idx on public.bulk_queue_operations(actor_id);
alter table public.bulk_queue_operations enable row level security;
revoke all on public.bulk_queue_operations from public, anon, authenticated;
grant select on public.bulk_queue_operations to authenticated;
create policy bulk_queue_operations_read on public.bulk_queue_operations for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and (actor_id = (select auth.uid()) or private.get_current_user_role() in ('owner','admin')));

-- Roles a supervisor may assign work to and take work from. Owners and admins are unrestricted.
create or replace function private.bulk_supervised_roles(p_role text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_role
    when 'factory_manager' then array['factory_manager','production_manager','production','dispatch_manager','dispatch','inventory_manager','quality_manager','quality']
    when 'production_manager' then array['production_manager','production']
    when 'dispatch_manager' then array['dispatch_manager','dispatch']
    when 'sales_manager' then array['sales_manager','sales']
    else array[]::text[] end
$$;
revoke all on function private.bulk_supervised_roles(text) from public, anon, authenticated;

create or replace function private.bulk_task_fingerprint(t public.tasks)
returns text language sql immutable set search_path = public, private as $$
  select md5(concat_ws('|', t.status, t.assigned_to::text, t.due_date::text, t.priority, t.dealership_id::text))
$$;
create or replace function private.bulk_job_fingerprint(j public.production_jobs)
returns text language sql immutable set search_path = public, private as $$
  select md5(concat_ws('|', j.status, j.planned_date::text, j.shift, j.machine_id::text))
$$;
revoke all on function private.bulk_task_fingerprint(public.tasks) from public, anon, authenticated;
revoke all on function private.bulk_job_fingerprint(public.production_jobs) from public, anon, authenticated;

create or replace function public.bulk_queue_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  v_apply boolean := p_command = 'bulk.apply';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_target text := p_payload ->> 'target';
  v_action text := p_payload ->> 'action';
  v_value jsonb := coalesce(p_payload -> 'value', 'null'::jsonb);
  v_request uuid; v_op public.bulk_queue_operations%rowtype;
  v_ids uuid[]; v_raw jsonb; v_id uuid; v_seen uuid[] := '{}';
  v_results jsonb := '[]'::jsonb; v_changed integer := 0;
  v_task public.tasks%rowtype; v_job public.production_jobs%rowtype;
  v_assignee record; v_current_role text; v_scope text[];
  v_date date; v_text text; v_reason text; v_fp text; v_expected text; v_label text;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid bulk request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found or p_command not in ('bulk.preview','bulk.apply')
     or (v_target = 'tasks' and v_role not in ('owner','admin','factory_manager','production_manager','dispatch_manager','sales_manager'))
     or (v_target = 'production_jobs' and v_role not in ('owner','admin','factory_manager','production_manager')) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;
  if not ((v_target = 'tasks' and v_action in ('assign','due_date','priority')) or (v_target = 'production_jobs' and v_action in ('planned_date','shift'))) then
    raise exception 'Choose a supported bulk change';
  end if;
  v_scope := private.bulk_supervised_roles(v_role);
  -- Initialised so expressions that mention the assignee are valid for every action.
  select null::uuid as id, null::text as role, null::text as full_name into v_assignee;

  -- Validate the new value once, before looking at any record.
  if v_action = 'assign' then
    select u.id, u.role, coalesce(nullif(u.full_name, ''), 'Employee') as full_name into v_assignee from public.app_users u
    where u.id = (v_value #>> '{}')::uuid and u.company_id = v_company and u.is_active and u.dealer_id is null;
    if not found then raise exception 'Choose an active employee of this company'; end if;
    if v_role not in ('owner','admin') and not (v_assignee.role = any(v_scope)) then raise exception 'You can assign work only to employees in teams you supervise'; end if;
    v_label := v_assignee.full_name;
  elsif v_action in ('due_date','planned_date') then
    begin v_date := (v_value #>> '{}')::date; exception when others then raise exception 'Choose a valid date'; end;
    if v_date is null or v_date < v_today or v_date > v_today + 365 then raise exception 'Choose a date from today up to one year ahead'; end if;
    v_label := v_date::text;
  elsif v_action = 'priority' then
    v_text := v_value #>> '{}';
    if v_text is null or v_text not in ('low','normal','high','urgent') then raise exception 'Choose a valid priority'; end if;
    v_label := v_text;
  else -- shift
    v_text := btrim(coalesce(v_value #>> '{}', ''));
    if length(v_text) not between 1 and 20 or v_text ~ '[[:cntrl:]]' then raise exception 'Enter a shift name of up to 20 characters'; end if;
    v_label := v_text;
  end if;

  if jsonb_typeof(p_payload -> 'ids') is distinct from 'array' or jsonb_array_length(p_payload -> 'ids') not between 1 and 50 then
    raise exception 'Select between 1 and 50 records';
  end if;
  begin
    select array_agg(value::uuid order by ordinality) into v_ids from jsonb_array_elements_text(p_payload -> 'ids') with ordinality;
  exception when others then raise exception 'The selection contains an invalid record reference';
  end;

  if v_apply then
    v_request := (p_payload ->> 'request_id')::uuid;
    if v_request is null then raise exception 'A request identity is required'; end if;
    if jsonb_typeof(p_payload -> 'expected') is distinct from 'object' then raise exception 'Preview the change before applying it'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':bulk:' || v_request::text, 0));
    select * into v_op from public.bulk_queue_operations where id = v_request;
    if found then
      if v_op.company_id <> v_company or v_op.actor_id <> v_actor or v_op.target <> v_target or v_op.action <> v_action or v_op.value <> v_value or v_op.record_ids <> v_ids then
        raise exception 'The request identity was already used for different details';
      end if;
      return jsonb_build_object('results', v_op.results, 'changed_count', v_op.changed_count, 'replayed', true);
    end if;
  end if;

  foreach v_id in array v_ids loop
    v_reason := null;
    if v_id = any(v_seen) then
      v_results := v_results || jsonb_build_object('id', v_id, 'outcome', 'duplicate_selection', 'message', 'Selected more than once; handled once');
      continue;
    end if;
    v_seen := v_seen || v_id;

    if v_target = 'tasks' then
      if v_apply then select * into v_task from public.tasks where id = v_id and company_id = v_company for update;
      else select * into v_task from public.tasks where id = v_id and company_id = v_company; end if;
      if not found then
        v_results := v_results || jsonb_build_object('id', v_id, 'outcome', 'unavailable', 'message', 'Not found in this company');
        continue;
      end if;
      v_fp := private.bulk_task_fingerprint(v_task);
      select role into v_current_role from public.app_users where id = v_task.assigned_to and company_id = v_company;
      v_reason := case
        when v_task.dealership_id is not null then 'Dealer tasks are managed by the dealership'
        when v_task.status not in ('open','in_progress') then 'Task is ' || replace(v_task.status, '_', ' ')
        when v_role not in ('owner','admin') and v_task.assigned_to is not null and not (coalesce(v_current_role, '') = any(v_scope)) then 'Assigned to someone outside the teams you supervise'
        when v_action = 'assign' and v_task.handoff_team is not null and not (v_assignee.role = any(private.handoff_team_roles(v_task.handoff_team))) then 'This handoff belongs to the ' || v_task.handoff_team || ' team'
      end;
      if v_reason is null and v_apply then
        v_expected := p_payload -> 'expected' ->> v_id::text;
        if v_expected is null or v_expected <> v_fp then v_reason := 'Changed since the preview. Preview again'; end if;
      end if;
      if v_reason is not null then
        v_results := v_results || jsonb_build_object('id', v_id, 'label', v_task.title, 'outcome', 'rejected', 'message', v_reason, 'fingerprint', v_fp);
        continue;
      end if;
      if (v_action = 'assign' and v_task.assigned_to is not distinct from v_assignee.id) or (v_action = 'due_date' and v_task.due_date is not distinct from v_date)
         or (v_action = 'priority' and v_task.priority = v_text) then
        v_results := v_results || jsonb_build_object('id', v_id, 'label', v_task.title, 'outcome', 'unchanged', 'message', 'Already ' || v_label, 'fingerprint', v_fp);
        continue;
      end if;
      if v_apply then
        update public.tasks set
          assigned_to = case when v_action = 'assign' then v_assignee.id else assigned_to end,
          assigned_by_user_id = case when v_action = 'assign' then v_actor else assigned_by_user_id end,
          due_date = case when v_action = 'due_date' then v_date else due_date end,
          priority = case when v_action = 'priority' then v_text else priority end,
          updated_at = now()
        where id = v_id;
        v_changed := v_changed + 1;
      end if;
      v_results := v_results || jsonb_build_object('id', v_id, 'label', v_task.title, 'outcome', case when v_apply then 'changed' else 'will_change' end,
        'message', case v_action when 'assign' then concat('Assign to ', v_label) when 'due_date' then concat('Due ', coalesce(v_task.due_date::text, 'not set'), ' → ', v_label) else concat('Priority ', v_task.priority, ' → ', v_label) end,
        'fingerprint', v_fp);

    else -- production_jobs
      if v_apply then select * into v_job from public.production_jobs where id = v_id and company_id = v_company for update;
      else select * into v_job from public.production_jobs where id = v_id and company_id = v_company; end if;
      if not found then
        v_results := v_results || jsonb_build_object('id', v_id, 'outcome', 'unavailable', 'message', 'Not found in this company');
        continue;
      end if;
      v_fp := private.bulk_job_fingerprint(v_job);
      v_reason := case
        when v_job.status <> 'planned' then 'Only planned jobs can be rescheduled here; this job is ' || replace(v_job.status, '_', ' ')
        when exists (select 1 from public.production_plan_slots s where s.company_id = v_company and s.production_job_id = v_id and s.status <> 'cancelled')
          then 'On the press schedule; move it there so the slot stays consistent'
      end;
      if v_reason is null and v_apply then
        v_expected := p_payload -> 'expected' ->> v_id::text;
        if v_expected is null or v_expected <> v_fp then v_reason := 'Changed since the preview. Preview again'; end if;
      end if;
      if v_reason is not null then
        v_results := v_results || jsonb_build_object('id', v_id, 'label', coalesce(v_job.job_number, 'Production job'), 'outcome', 'rejected', 'message', v_reason, 'fingerprint', v_fp);
        continue;
      end if;
      if (v_action = 'planned_date' and v_job.planned_date is not distinct from v_date) or (v_action = 'shift' and v_job.shift is not distinct from v_text) then
        v_results := v_results || jsonb_build_object('id', v_id, 'label', coalesce(v_job.job_number, 'Production job'), 'outcome', 'unchanged', 'message', 'Already ' || v_label, 'fingerprint', v_fp);
        continue;
      end if;
      if v_apply then
        update public.production_jobs set
          planned_date = case when v_action = 'planned_date' then v_date else planned_date end,
          shift = case when v_action = 'shift' then v_text else shift end,
          updated_at = now()
        where id = v_id;
        v_changed := v_changed + 1;
      end if;
      v_results := v_results || jsonb_build_object('id', v_id, 'label', coalesce(v_job.job_number, 'Production job'), 'outcome', case when v_apply then 'changed' else 'will_change' end,
        'message', case v_action when 'planned_date' then concat('Planned ', coalesce(v_job.planned_date::text, 'not set'), ' → ', v_label) else concat('Shift ', coalesce(v_job.shift, 'not set'), ' → ', v_label) end,
        'fingerprint', v_fp);
    end if;
  end loop;

  if v_apply then
    insert into public.bulk_queue_operations(id, company_id, target, action, value, record_ids, results, changed_count, actor_id, actor_name)
    values (v_request, v_company, v_target, v_action, v_value, v_ids, v_results, v_changed, v_actor, v_name);
  end if;
  return jsonb_build_object('results', v_results, 'changed_count', v_changed, 'replayed', false);
end;
$$;
revoke all on function public.bulk_queue_command(text, jsonb) from public, anon;
grant execute on function public.bulk_queue_command(text, jsonb) to authenticated;

commit;
