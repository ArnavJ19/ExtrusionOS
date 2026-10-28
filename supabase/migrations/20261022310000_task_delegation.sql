-- UPGRADE_EOS feature 35: temporary task delegation.
--
-- A supervisor delegates an absent employee's pending tasks (all of them, or a selection) to an
-- eligible colleague for a defined period. Only task assignment moves: roles and permissions are
-- never changed, and a delegate must be eligible for each task (a handoff only to its team).
-- While a delegation is active, work newly assigned to the absent employee is redirected to the
-- delegate. When it ends (expiry or cancellation), each unfinished task still held under the
-- delegation returns to the original owner if that person is active; otherwise it stays with the
-- delegate, so no unfinished task is left without a responsible owner. Tasks completed or
-- reassigned meanwhile are recorded as such and left alone. Every step is recorded and both
-- employees are notified. Time-based activation and expiry run through delegation.sync, which is
-- idempotent (call it from a scheduler; the delegation page also calls it). Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.task_delegations (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  delegator_id uuid not null references public.app_users(id),
  delegate_id uuid not null references public.app_users(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  scope text not null check (scope in ('all_open','selected')),
  reason text not null check (length(btrim(reason)) between 3 and 300),
  created_by uuid not null references public.app_users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  closed_at timestamptz,
  close_reason text check (close_reason is null or close_reason in ('expired','cancelled')),
  close_note text check (close_note is null or length(close_note) <= 300),
  check (delegate_id <> delegator_id),
  check (ends_at > starts_at and ends_at - starts_at <= interval '90 days'),
  check ((closed_at is null) = (close_reason is null))
);
create index task_delegations_company_idx on public.task_delegations(company_id, closed_at, starts_at desc);
create index task_delegations_delegator_idx on public.task_delegations(delegator_id, starts_at, ends_at);
create index task_delegations_delegate_idx on public.task_delegations(delegate_id);
create index task_delegations_created_by_idx on public.task_delegations(created_by);

create table public.task_delegation_items (
  delegation_id uuid not null references public.task_delegations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  original_assignee uuid not null references public.app_users(id),
  delegated_at timestamptz not null default now(),
  how text not null check (how in ('selected','all_open','redirected')),
  outcome text check (outcome is null or outcome in ('returned','kept_by_delegate','completed','reassigned','cancelled_task')),
  closed_at timestamptz,
  primary key (delegation_id, task_id)
);
create index task_delegation_items_task_idx on public.task_delegation_items(task_id);
create index task_delegation_items_company_idx on public.task_delegation_items(company_id);
create index task_delegation_items_original_idx on public.task_delegation_items(original_assignee);
-- A task is held under at most one open delegation at a time.
create unique index task_delegation_items_one_open on public.task_delegation_items(task_id) where closed_at is null;

alter table public.task_delegations enable row level security;
alter table public.task_delegation_items enable row level security;
revoke all on public.task_delegations, public.task_delegation_items from public, anon, authenticated;
grant select on public.task_delegations, public.task_delegation_items to authenticated;
create policy task_delegations_read on public.task_delegations for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and ((select auth.uid()) in (delegator_id, delegate_id, created_by) or private.get_current_user_role() in ('owner','admin','factory_manager','production_manager','dispatch_manager','sales_manager')));
create policy task_delegation_items_read on public.task_delegation_items for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);

-- Whether an employee may hold a task: handoffs only within their team; ordinary tasks only
-- within the same team family as the original assignee, so delegation never widens access.
create or replace function private.delegate_eligible(p_task public.tasks, p_delegate_role text, p_original_role text)
returns boolean language sql stable set search_path = public, private as $$
  select case
    when p_task.handoff_team is not null then p_delegate_role = any(private.handoff_team_roles(p_task.handoff_team))
    else p_delegate_role = p_original_role
      or (p_delegate_role = any(private.bulk_supervised_roles(p_original_role)))
      or (p_original_role = any(private.bulk_supervised_roles(p_delegate_role)))
  end
$$;
revoke all on function private.delegate_eligible(public.tasks, text, text) from public, anon, authenticated;

-- Moves one task under a delegation. Returns false when the task is not eligible or already held.
create or replace function private.delegate_task(p_delegation public.task_delegations, p_task uuid, p_how text)
returns boolean language plpgsql security definer set search_path = public, private as $$
declare t public.tasks%rowtype; v_delegate_role text; v_original_role text;
begin
  select * into t from public.tasks where id = p_task and company_id = p_delegation.company_id for update;
  if not found or t.status not in ('open','in_progress') or t.assigned_to is distinct from p_delegation.delegator_id or t.dealership_id is not null then return false; end if;
  if exists (select 1 from public.task_delegation_items where task_id = t.id and closed_at is null) then return false; end if;
  select role into v_delegate_role from public.app_users where id = p_delegation.delegate_id and company_id = p_delegation.company_id and is_active and dealer_id is null;
  select role into v_original_role from public.app_users where id = p_delegation.delegator_id and company_id = p_delegation.company_id;
  if v_delegate_role is null or not private.delegate_eligible(t, v_delegate_role, v_original_role) then return false; end if;
  perform set_config('extrusionos.delegation_move', 'on', true);
  update public.tasks set assigned_to = p_delegation.delegate_id, updated_at = now() where id = t.id;
  perform set_config('extrusionos.delegation_move', '', true);
  insert into public.task_delegation_items(delegation_id, task_id, company_id, original_assignee, how) values (p_delegation.id, t.id, t.company_id, p_delegation.delegator_id, p_how);
  return true;
end;
$$;
revoke all on function private.delegate_task(public.task_delegations, uuid, text) from public, anon, authenticated;

-- Closes a delegation: unfinished work goes back to its owner when possible, else stays covered.
create or replace function private.close_delegation(p_id uuid, p_reason text, p_note text)
returns integer language plpgsql security definer set search_path = public, private as $$
declare
  d public.task_delegations%rowtype; v_item record; v_owner_active boolean; v_returned integer := 0;
begin
  select * into d from public.task_delegations where id = p_id for update;
  if not found or d.closed_at is not null then return 0; end if;
  select exists (select 1 from public.app_users where id = d.delegator_id and company_id = d.company_id and is_active and dealer_id is null) into v_owner_active;
  for v_item in select i.task_id, i.original_assignee, x.status, x.assigned_to from public.task_delegation_items i join public.tasks x on x.id = i.task_id
                where i.delegation_id = d.id and i.closed_at is null for update of i loop
    if v_item.status = 'completed' then
      update public.task_delegation_items set outcome = 'completed', closed_at = now() where delegation_id = d.id and task_id = v_item.task_id;
    elsif v_item.status = 'cancelled' then
      update public.task_delegation_items set outcome = 'cancelled_task', closed_at = now() where delegation_id = d.id and task_id = v_item.task_id;
    elsif v_item.assigned_to is distinct from d.delegate_id then
      update public.task_delegation_items set outcome = 'reassigned', closed_at = now() where delegation_id = d.id and task_id = v_item.task_id;
    elsif v_owner_active then
      perform set_config('extrusionos.delegation_move', 'on', true);
      update public.tasks set assigned_to = v_item.original_assignee, updated_at = now() where id = v_item.task_id;
      perform set_config('extrusionos.delegation_move', '', true);
      update public.task_delegation_items set outcome = 'returned', closed_at = now() where delegation_id = d.id and task_id = v_item.task_id;
      v_returned := v_returned + 1;
    else
      update public.task_delegation_items set outcome = 'kept_by_delegate', closed_at = now() where delegation_id = d.id and task_id = v_item.task_id;
    end if;
  end loop;
  update public.task_delegations set closed_at = now(), close_reason = p_reason, close_note = p_note where id = d.id;
  insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, is_read, created_by, action_link)
  select d.company_id, u, 'task_delegation', 'info',
    case when u = d.delegator_id then 'Your delegated tasks have returned to you' else 'Your temporary task cover has ended' end,
    concat(v_returned, ' unfinished task(s) returned to the original owner', case when not v_owner_active then '; the owner is inactive, so tasks stay with the delegate' else '' end, '.'),
    'task_delegation', d.id, false, auth.uid(), '/tasks/delegations'
  from unnest(array[d.delegator_id, d.delegate_id]) u
  where exists (select 1 from public.app_users where id = u and is_active);
  return v_returned;
end;
$$;
revoke all on function private.close_delegation(uuid, text, text) from public, anon, authenticated;

create or replace function private.activate_delegation(p_id uuid, p_task_ids uuid[])
returns integer language plpgsql security definer set search_path = public, private as $$
declare d public.task_delegations%rowtype; v_task uuid; v_moved integer := 0;
begin
  select * into d from public.task_delegations where id = p_id for update;
  if not found or d.activated_at is not null or d.closed_at is not null or d.starts_at > now() then return 0; end if;
  for v_task in select id from public.tasks
                where company_id = d.company_id and assigned_to = d.delegator_id and status in ('open','in_progress') and dealership_id is null
                  and (d.scope = 'all_open' or id = any(coalesce(p_task_ids, '{}'::uuid[]))) order by created_at loop
    if private.delegate_task(d, v_task, d.scope) then v_moved := v_moved + 1; end if;
  end loop;
  update public.task_delegations set activated_at = now() where id = d.id;
  insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, is_read, created_by, action_link)
  values (d.company_id, d.delegate_id, 'task_delegation', 'info', 'You are covering tasks temporarily',
    concat(v_moved, ' task(s) delegated to you until ', to_char(d.ends_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'), ' IST. Reason: ', d.reason),
    'task_delegation', d.id, false, auth.uid(), '/tasks/delegations');
  return v_moved;
end;
$$;
revoke all on function private.activate_delegation(uuid, uuid[]) from public, anon, authenticated;

-- Redirect: a task assigned to someone on active (all-open) delegation goes to the delegate.
create or replace function private.redirect_delegated_assignment()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare d public.task_delegations%rowtype;
begin
  if coalesce(current_setting('extrusionos.delegation_move', true), '') = 'on' then return null; end if;
  if new.assigned_to is null or new.status not in ('open','in_progress') or new.dealership_id is not null then return null; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return null; end if;
  select * into d from public.task_delegations
  where company_id = new.company_id and delegator_id = new.assigned_to and scope = 'all_open'
    and activated_at is not null and closed_at is null and starts_at <= now() and ends_at > now()
  order by starts_at limit 1;
  if found then perform private.delegate_task(d, new.id, 'redirected'); end if;
  return null;
end;
$$;
revoke all on function private.redirect_delegated_assignment() from public, anon, authenticated;
drop trigger if exists zz_redirect_delegated_assignment on public.tasks;
create trigger zz_redirect_delegated_assignment after insert or update on public.tasks for each row execute function private.redirect_delegated_assignment();

create or replace function public.task_delegation_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  v_delegator record; v_delegate record; d public.task_delegations%rowtype;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_scope text; v_reason text; v_ids uuid[];
  v_moved integer; v_activated integer := 0; v_closed integer := 0; v_page integer; v_total bigint; v_rows jsonb; v_row record;
  v_supervisor boolean := v_role in ('owner','admin','factory_manager','production_manager','dispatch_manager','sales_manager');
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid delegation request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found or p_command not in ('delegation.create','delegation.cancel','delegation.sync','delegation.list','delegation.load','delegation.candidates')
     or (p_command in ('delegation.create','delegation.cancel','delegation.candidates') and not v_supervisor) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'delegation.sync' then
    for v_row in select id from public.task_delegations where company_id = v_company and closed_at is null and ends_at <= now() loop
      perform private.close_delegation(v_row.id, 'expired', null); v_closed := v_closed + 1;
    end loop;
    for v_row in select id from public.task_delegations where company_id = v_company and closed_at is null and activated_at is null and starts_at <= now() and scope = 'all_open' loop
      perform private.activate_delegation(v_row.id, null); v_activated := v_activated + 1;
    end loop;
    return jsonb_build_object('activated', v_activated, 'expired', v_closed);

  elsif p_command = 'delegation.create' then
    v_id := (p_payload ->> 'request_id')::uuid;
    if v_id is null then raise exception 'A request identity is required'; end if;
    select * into d from public.task_delegations where id = v_id;
    if found then
      if d.company_id <> v_company or d.created_by <> v_actor or d.delegator_id <> (p_payload ->> 'delegator_id')::uuid or d.delegate_id <> (p_payload ->> 'delegate_id')::uuid then
        raise exception 'The request identity was already used for different details';
      end if;
      return jsonb_build_object('id', d.id, 'moved', (select count(*) from public.task_delegation_items where delegation_id = d.id), 'replayed', true);
    end if;
    select id, role, coalesce(nullif(full_name, ''), 'Employee') as full_name into v_delegator from public.app_users
    where id = (p_payload ->> 'delegator_id')::uuid and company_id = v_company and dealer_id is null;
    select id, role, coalesce(nullif(full_name, ''), 'Employee') as full_name into v_delegate from public.app_users
    where id = (p_payload ->> 'delegate_id')::uuid and company_id = v_company and is_active and dealer_id is null;
    if v_delegator.id is null or v_delegate.id is null then raise exception 'Choose two employees of this company; the replacement must be active'; end if;
    if v_delegator.id = v_delegate.id then raise exception 'Choose a different employee as the replacement'; end if;
    if v_role not in ('owner','admin') and not (v_delegator.role = any(private.bulk_supervised_roles(v_role)) and v_delegate.role = any(private.bulk_supervised_roles(v_role))) then
      raise exception 'You can delegate only between employees in teams you supervise' using errcode = '42501';
    end if;
    begin
      v_start := coalesce((p_payload ->> 'starts_at')::timestamptz, now());
      v_end := (p_payload ->> 'ends_at')::timestamptz;
    exception when others then raise exception 'Choose a valid start and end'; end;
    if v_end is null or v_end <= v_start or v_end - v_start > interval '90 days' or v_start < now() - interval '5 minutes' or v_end <= now() then
      raise exception 'Choose a period that starts now or later, ends after it starts, and lasts at most 90 days';
    end if;
    v_scope := coalesce(p_payload ->> 'scope', 'all_open');
    v_reason := btrim(coalesce(p_payload ->> 'reason', ''));
    if v_scope not in ('all_open','selected') then raise exception 'Choose all open tasks or a selection'; end if;
    if length(v_reason) not between 3 and 300 or v_reason ~ '[[:cntrl:]]' then raise exception 'Record why the work is delegated (3 to 300 characters)'; end if;
    if v_scope = 'selected' then
      begin select array_agg(distinct value::uuid) into v_ids from jsonb_array_elements_text(p_payload -> 'task_ids');
      exception when others then raise exception 'Choose the tasks to delegate'; end;
      if v_ids is null or cardinality(v_ids) not between 1 and 100 then raise exception 'Choose between 1 and 100 tasks to delegate'; end if;
      if v_start > now() + interval '5 minutes' then raise exception 'A selection of tasks is delegated from now; schedule only all-open delegations'; end if;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':delegation:' || v_delegator.id::text, 0));
    if exists (select 1 from public.task_delegations where company_id = v_company and delegator_id = v_delegator.id and closed_at is null and starts_at < v_end and ends_at > v_start) then
      raise exception 'This employee already has a delegation in that period';
    end if;
    if exists (select 1 from public.task_delegations where company_id = v_company and delegator_id = v_delegate.id and closed_at is null and starts_at < v_end and ends_at > v_start) then
      raise exception 'The replacement is away in that period';
    end if;
    insert into public.task_delegations(id, company_id, delegator_id, delegate_id, starts_at, ends_at, scope, reason, created_by, created_by_name)
    values (v_id, v_company, v_delegator.id, v_delegate.id, greatest(v_start, now() - interval '5 minutes'), v_end, v_scope, v_reason, v_actor, v_name)
    returning * into d;
    v_moved := private.activate_delegation(d.id, v_ids);
    return jsonb_build_object('id', d.id, 'moved', v_moved, 'scheduled', d.starts_at > now(), 'replayed', false);

  elsif p_command = 'delegation.cancel' then
    select * into d from public.task_delegations where id = (p_payload ->> 'id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Delegation is unavailable'; end if;
    if d.closed_at is not null then raise exception 'This delegation has already ended'; end if;
    v_reason := btrim(coalesce(p_payload ->> 'note', ''));
    if length(v_reason) not between 3 and 300 then raise exception 'Record why the delegation ends early (3 to 300 characters)'; end if;
    return jsonb_build_object('id', d.id, 'returned', private.close_delegation(d.id, 'cancelled', v_reason));

  elsif p_command = 'delegation.candidates' then
    select id, role into v_delegator from public.app_users where id = (p_payload ->> 'delegator_id')::uuid and company_id = v_company and dealer_id is null;
    if v_delegator.id is null then raise exception 'Employee is unavailable'; end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status, 'due_date', x.due_date, 'handoff_team', x.handoff_team,
        'held', exists (select 1 from public.task_delegation_items i where i.task_id = x.id and i.closed_at is null)) order by x.due_date nulls last, x.created_at)
      from (select * from public.tasks where company_id = v_company and assigned_to = v_delegator.id and status in ('open','in_progress') and dealership_id is null
            order by due_date nulls last, created_at limit 100) x), '[]'::jsonb);

  elsif p_command = 'delegation.load' then
    select * into d from public.task_delegations where id = (p_payload ->> 'id')::uuid and company_id = v_company;
    if not found or not (v_supervisor or v_actor in (d.delegator_id, d.delegate_id, d.created_by)) then raise exception 'Delegation is unavailable'; end if;
    return to_jsonb(d) - 'company_id' || jsonb_build_object(
      'delegator_name', (select full_name from public.app_users where id = d.delegator_id),
      'delegate_name', (select full_name from public.app_users where id = d.delegate_id),
      'items', coalesce((select jsonb_agg(jsonb_build_object('task_id', i.task_id, 'title', x.title, 'status', x.status, 'how', i.how, 'outcome', i.outcome, 'delegated_at', i.delegated_at, 'closed_at', i.closed_at) order by i.delegated_at)
        from public.task_delegation_items i join public.tasks x on x.id = i.task_id where i.delegation_id = d.id), '[]'::jsonb));
  end if;

  -- delegation.list: supervisors see the company's; others see only delegations they are part of.
  v_page := coalesce((p_payload ->> 'page')::integer, 1);
  if v_page < 1 or v_page > 100000 or coalesce(p_payload ->> 'status', 'current') not in ('current','closed') then raise exception 'Invalid delegation list request'; end if;
  with visible as (
    select dl.* from public.task_delegations dl
    where dl.company_id = v_company and (v_supervisor or v_actor in (dl.delegator_id, dl.delegate_id, dl.created_by))
      and case when coalesce(p_payload ->> 'status', 'current') = 'current' then dl.closed_at is null else dl.closed_at is not null end
  )
  select (select count(*) from visible),
    coalesce((select jsonb_agg(to_jsonb(r)) from (
      select v.id, v.starts_at, v.ends_at, v.scope, v.reason, v.activated_at, v.closed_at, v.close_reason, v.created_by_name,
        a.full_name as delegator_name, b.full_name as delegate_name,
        (select count(*) from public.task_delegation_items i where i.delegation_id = v.id) as task_count,
        (select count(*) from public.task_delegation_items i where i.delegation_id = v.id and i.closed_at is null) as open_count
      from visible v left join public.app_users a on a.id = v.delegator_id left join public.app_users b on b.id = v.delegate_id
      order by v.starts_at desc, v.id limit 10 offset (v_page - 1) * 10) r), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;
revoke all on function public.task_delegation_command(text, jsonb) from public, anon;
grant execute on function public.task_delegation_command(text, jsonb) to authenticated;

commit;
