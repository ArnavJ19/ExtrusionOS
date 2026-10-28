-- UPGRADE_EOS feature 69: accepted department handovers (builds on feature 14).
--
-- A handoff now has an acceptance state: pending, accepted or returned. The receiving team's
-- prerequisites are evaluated on the server from current records (for packaging: the QC release
-- still stands, its production job and order are live, and a packaging job is open; for
-- quality: the finishing receipt still has accepted output; for dispatch: the packaging is still
-- complete and its order is live). A team may auto-accept when every prerequisite holds;
-- otherwise a team member accepts explicitly, confirming the received quantity within the team's
-- tolerance. A receiving employee can return a handoff with the missing prerequisite. Exactly one
-- open return task is created for the source team, assigned to the person whose action raised
-- the handoff when they are still eligible, so there is one accountable owner. Completing that
-- task re-evaluates the handoff. Work cannot start on a handoff that has not been accepted.
-- Additive; replaces private.raise_department_handoff to create the acceptance record.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The source team of a finishing receipt is production; teams gain 'production' for returns.
alter table public.tasks drop constraint if exists tasks_handoff_shape_check;
alter table public.tasks add constraint tasks_handoff_shape_check check (
  (handoff_key is null and handoff_team is null and handoff_quantity_kg is null and handoff_source_type is null and handoff_source_id is null)
  or (handoff_key is not null and handoff_team in ('packaging','dispatch','quality','production') and handoff_quantity_kg >= 0
      and handoff_source_type in ('quality_inspection','finishing_job','packaging_job') and handoff_source_id is not null));

create or replace function private.handoff_team_roles(p_team text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_team
    when 'packaging' then array['owner','admin','factory_manager','production_manager','production']
    when 'production' then array['owner','admin','factory_manager','production_manager','production']
    when 'dispatch' then array['owner','admin','factory_manager','dispatch_manager','dispatch']
    when 'quality' then array['owner','admin','factory_manager','quality_manager','quality']
    else array[]::text[] end
$$;
revoke all on function private.handoff_team_roles(text) from public, anon, authenticated;

create table public.handoff_team_policies (
  company_id uuid not null references public.companies(id),
  team text not null check (team in ('packaging','dispatch','quality')),
  auto_accept boolean not null default false,
  quantity_tolerance_percent numeric(5,2) not null default 0.5 check (quantity_tolerance_percent between 0 and 10),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default now(),
  primary key (company_id, team)
);
create index handoff_team_policies_updated_by_idx on public.handoff_team_policies(updated_by);

create table public.handoff_acceptances (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  state text not null default 'pending' check (state in ('pending','accepted','returned')),
  accepted_by uuid references public.app_users(id),
  accepted_by_name text,
  accepted_at timestamptz,
  auto_accepted boolean not null default false,
  received_quantity_kg numeric(14,3) check (received_quantity_kg is null or received_quantity_kg >= 0),
  acceptance_note text check (acceptance_note is null or length(acceptance_note) <= 500),
  return_count integer not null default 0 check (return_count >= 0),
  updated_at timestamptz not null default now(),
  check ((state = 'accepted') = (accepted_at is not null))
);
create index handoff_acceptances_company_idx on public.handoff_acceptances(company_id, state);
create index handoff_acceptances_accepted_by_idx on public.handoff_acceptances(accepted_by);

create table public.handoff_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  handoff_task_id uuid not null references public.tasks(id) on delete cascade,
  return_task_id uuid not null references public.tasks(id) on delete cascade,
  reason text not null check (reason in ('no_packaging_job','quantity_mismatch','material_not_found','source_reversed','order_not_live','documents_missing','other')),
  note text not null check (length(btrim(note)) between 5 and 500),
  returned_by uuid not null references public.app_users(id),
  returned_by_name text not null,
  returned_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text
);
create unique index handoff_returns_one_open on public.handoff_returns(handoff_task_id) where resolved_at is null;
create index handoff_returns_company_idx on public.handoff_returns(company_id, handoff_task_id, returned_at desc);
create index handoff_returns_return_task_idx on public.handoff_returns(return_task_id);
create index handoff_returns_returned_by_idx on public.handoff_returns(returned_by);

alter table public.handoff_team_policies enable row level security;
alter table public.handoff_acceptances enable row level security;
alter table public.handoff_returns enable row level security;
revoke all on public.handoff_team_policies, public.handoff_acceptances, public.handoff_returns from public, anon, authenticated;
grant select on public.handoff_team_policies, public.handoff_acceptances, public.handoff_returns to authenticated;
create policy handoff_team_policies_read on public.handoff_team_policies for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy handoff_acceptances_read on public.handoff_acceptances for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy handoff_returns_read on public.handoff_returns for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);

-- Unmet receiving prerequisites for one handoff, evaluated from current records.
create or replace function private.handoff_acceptance_issues(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  t public.tasks%rowtype;
  v_issues jsonb := '[]'::jsonb;
  v_q record; v_job record; v_order record; v_f record; v_p record;
begin
  select * into t from public.tasks where id = p_task;
  if not found or t.handoff_key is null then return '[]'::jsonb; end if;
  if t.handoff_source_type = 'quality_inspection' then
    select status, production_job_id, finishing_job_id into v_q from public.quality_inspections where id = t.handoff_source_id and company_id = t.company_id;
    if not found or v_q.status <> 'approved' then
      v_issues := v_issues || jsonb_build_object('code', 'source_reversed', 'message', 'The QC release behind this handoff no longer stands');
    end if;
    select id, job_number, status, order_id into v_job from public.production_jobs where id = v_q.production_job_id and company_id = t.company_id;
    if v_job.id is null or v_job.status = 'cancelled' then
      v_issues := v_issues || jsonb_build_object('code', 'source_reversed', 'message', 'The production job for this material is missing or cancelled');
    elsif not exists (select 1 from public.packaging_jobs pk where pk.company_id = t.company_id and pk.production_job_id = v_job.id and pk.status in ('scheduled','in_progress')) then
      v_issues := v_issues || jsonb_build_object('code', 'no_packaging_job', 'message', concat('No packaging job is open for ', coalesce(v_job.job_number, 'this production job')));
    end if;
    select current_stage into v_order from public.orders where id = v_job.order_id and company_id = t.company_id;
  elsif t.handoff_source_type = 'finishing_job' then
    select status, output_weight_kg, order_id into v_f from public.finishing_jobs where id = t.handoff_source_id and company_id = t.company_id;
    if not found or v_f.status not in ('received','completed') or coalesce(v_f.output_weight_kg, 0) <= 0 then
      v_issues := v_issues || jsonb_build_object('code', 'source_reversed', 'message', 'The finishing receipt behind this handoff no longer has accepted output');
    end if;
    select current_stage into v_order from public.orders where id = v_f.order_id and company_id = t.company_id;
  else
    select status, order_id into v_p from public.packaging_jobs where id = t.handoff_source_id and company_id = t.company_id;
    if not found or v_p.status <> 'completed' then
      v_issues := v_issues || jsonb_build_object('code', 'source_reversed', 'message', 'The packaging behind this handoff is no longer complete');
    end if;
    select current_stage into v_order from public.orders where id = v_p.order_id and company_id = t.company_id;
  end if;
  if v_order.current_stage in ('cancelled','closed') then
    v_issues := v_issues || jsonb_build_object('code', 'order_not_live', 'message', concat('The order is ', v_order.current_stage));
  end if;
  return v_issues;
end;
$$;
revoke all on function private.handoff_acceptance_issues(uuid) from public, anon, authenticated;

-- Sets a handoff to accepted automatically when its team allows it and nothing is missing.
create or replace function private.evaluate_handoff_acceptance(p_task uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare t public.tasks%rowtype; v_auto boolean;
begin
  select * into t from public.tasks where id = p_task;
  select auto_accept into v_auto from public.handoff_team_policies where company_id = t.company_id and team = t.handoff_team;
  insert into public.handoff_acceptances(task_id, company_id) values (t.id, t.company_id) on conflict (task_id) do nothing;
  if coalesce(v_auto, false) and jsonb_array_length(private.handoff_acceptance_issues(t.id)) = 0 then
    update public.handoff_acceptances set state = 'accepted', auto_accepted = true, accepted_at = now(), accepted_by = null, accepted_by_name = 'Automatic (prerequisites met)',
      received_quantity_kg = t.handoff_quantity_kg, updated_at = now()
    where task_id = t.id and state <> 'accepted';
    return 'accepted';
  end if;
  update public.handoff_acceptances set state = 'pending', updated_at = now() where task_id = t.id and state = 'returned';
  return (select state from public.handoff_acceptances where task_id = t.id);
end;
$$;
revoke all on function private.evaluate_handoff_acceptance(uuid) from public, anon, authenticated;

create or replace function private.raise_department_handoff(
  p_company uuid, p_key text, p_team text, p_source_type text, p_source_id uuid, p_quantity numeric,
  p_order uuid, p_title text, p_description text
) returns text language plpgsql security definer set search_path = public, private as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_order record;
  v_id uuid;
begin
  select o.id, o.priority, o.expected_dispatch_date into v_order from public.orders o where o.id = p_order and o.company_id = p_company;
  insert into public.tasks(company_id, task_type, title, description, priority, status, due_date, related_entity_type, related_entity_id, created_by,
    handoff_key, handoff_team, handoff_quantity_kg, handoff_source_type, handoff_source_id)
  values (p_company, 'department_handoff', left(p_title, 200), p_description, coalesce(v_order.priority, 'normal'), 'open',
    greatest(v_today, coalesce(v_order.expected_dispatch_date, v_today + 1)), p_source_type, p_source_id, auth.uid(),
    p_key, p_team, round(greatest(coalesce(p_quantity, 0), 0), 3), p_source_type, p_source_id)
  on conflict (company_id, handoff_key) where handoff_key is not null do nothing
  returning id into v_id;
  if v_id is null then return 'existing'; end if;
  perform private.evaluate_handoff_acceptance(v_id);
  return 'created';
end;
$$;
revoke all on function private.raise_department_handoff(uuid, text, text, text, uuid, numeric, uuid, text, text) from public, anon, authenticated;

-- Guards on tasks: an unaccepted handoff cannot start or complete; completing a return task
-- resolves the return and re-evaluates the handoff.
create or replace function private.guard_handoff_task_progress()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_state text; v_return public.handoff_returns%rowtype;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.handoff_key is not null and new.task_type = 'department_handoff' and new.status in ('in_progress','completed') then
    select state into v_state from public.handoff_acceptances where task_id = new.id;
    -- Handoffs created before acceptance existed have no record and keep their old behaviour.
    if v_state is not null and v_state <> 'accepted' then
      raise exception 'Accept this handoff before starting or completing it' using errcode = '23514';
    end if;
  end if;
  if new.task_type = 'handoff_return' and new.status = 'completed' then
    select * into v_return from public.handoff_returns where return_task_id = new.id and resolved_at is null;
    if found then
      update public.handoff_returns set resolved_at = now(), resolution_note = left(coalesce(new.description, ''), 500) where id = v_return.id;
      perform private.evaluate_handoff_acceptance(v_return.handoff_task_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_handoff_task_progress() from public, anon, authenticated;
drop trigger if exists zz_guard_handoff_task_progress on public.tasks;
create trigger zz_guard_handoff_task_progress before update on public.tasks for each row execute function private.guard_handoff_task_progress();

create or replace function public.handoff_acceptance_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  t public.tasks%rowtype;
  v_acc public.handoff_acceptances%rowtype;
  v_policy record;
  v_issues jsonb; v_received numeric; v_tolerance numeric; v_reason text; v_note text;
  v_source_team text; v_owner uuid; v_return_id uuid; v_ids uuid[];
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid handoff request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found or p_command not in ('acceptance.status','acceptance.accept','acceptance.return','policy.list','policy.set')
     or v_role not in ('owner','admin','factory_manager','production_manager','production','dispatch_manager','dispatch','quality_manager','quality','viewer')
     or (p_command = 'policy.set' and v_role not in ('owner','admin','factory_manager'))
     or (p_command in ('acceptance.accept','acceptance.return') and v_role = 'viewer') then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'policy.list' then
    return coalesce((select jsonb_agg(jsonb_build_object('team', x.team_name, 'auto_accept', coalesce(p.auto_accept, false), 'quantity_tolerance_percent', coalesce(p.quantity_tolerance_percent, 0.5)) order by x.team_name)
      from unnest(array['packaging','dispatch','quality']) as x(team_name) left join public.handoff_team_policies p on p.company_id = v_company and p.team = x.team_name), '[]'::jsonb);
  elsif p_command = 'policy.set' then
    if p_payload ->> 'team' not in ('packaging','dispatch','quality') then raise exception 'Choose a team'; end if;
    v_tolerance := (p_payload ->> 'quantity_tolerance_percent')::numeric;
    if v_tolerance is null or v_tolerance < 0 or v_tolerance > 10 then raise exception 'Set a quantity tolerance between 0 and 10 percent'; end if;
    insert into public.handoff_team_policies(company_id, team, auto_accept, quantity_tolerance_percent, updated_by)
    values (v_company, p_payload ->> 'team', coalesce((p_payload ->> 'auto_accept')::boolean, false), v_tolerance, v_actor)
    on conflict (company_id, team) do update set auto_accept = excluded.auto_accept, quantity_tolerance_percent = excluded.quantity_tolerance_percent, updated_by = v_actor, updated_at = now();
    return jsonb_build_object('team', p_payload ->> 'team');
  elsif p_command = 'acceptance.status' then
    -- Up to 10 handoffs at a time, for the queue page.
    begin
      select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(p_payload -> 'task_ids');
    exception when others then raise exception 'Invalid handoff references'; end;
    if v_ids is null or cardinality(v_ids) > 10 then raise exception 'Invalid handoff references'; end if;
    return coalesce((select jsonb_agg(jsonb_build_object(
        'task_id', x.id, 'state', coalesce(a.state, 'accepted'), 'legacy', a.task_id is null, 'auto_accepted', coalesce(a.auto_accepted, false),
        'accepted_by_name', a.accepted_by_name, 'accepted_at', a.accepted_at, 'received_quantity_kg', a.received_quantity_kg, 'return_count', coalesce(a.return_count, 0),
        'issues', private.handoff_acceptance_issues(x.id),
        'open_return', (select jsonb_build_object('reason', r.reason, 'note', r.note, 'returned_by_name', r.returned_by_name, 'returned_at', r.returned_at,
            'return_task_id', r.return_task_id, 'owner_name', (select full_name from public.app_users u join public.tasks rt on rt.assigned_to = u.id where rt.id = r.return_task_id))
          from public.handoff_returns r where r.handoff_task_id = x.id and r.resolved_at is null)))
      from public.tasks x left join public.handoff_acceptances a on a.task_id = x.id
      where x.id = any(v_ids) and x.company_id = v_company and x.handoff_key is not null and x.task_type = 'department_handoff'
        and (v_role in ('owner','admin','factory_manager','viewer') or v_role = any(private.handoff_team_roles(x.handoff_team)))), '[]'::jsonb);
  end if;

  -- accept / return
  select * into t from public.tasks where id = (p_payload ->> 'task_id')::uuid and company_id = v_company and handoff_key is not null and task_type = 'department_handoff' for update;
  if not found then raise exception 'Handoff is unavailable'; end if;
  if not (v_role = any(private.handoff_team_roles(t.handoff_team))) then raise exception 'This handoff belongs to another team' using errcode = '42501'; end if;
  insert into public.handoff_acceptances(task_id, company_id, state, accepted_at, accepted_by_name, auto_accepted)
  values (t.id, v_company, 'pending', null, null, false) on conflict (task_id) do nothing;
  select * into v_acc from public.handoff_acceptances where task_id = t.id for update;

  if p_command = 'acceptance.accept' then
    v_received := (p_payload ->> 'received_quantity_kg')::numeric;
    v_note := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
    if v_acc.state = 'accepted' then
      if v_acc.accepted_by = v_actor and v_acc.received_quantity_kg is not distinct from round(v_received, 3) then return jsonb_build_object('task_id', t.id, 'state', 'accepted', 'replayed', true); end if;
      raise exception 'This handoff was already accepted';
    end if;
    if v_acc.state = 'returned' then raise exception 'This handoff is waiting for its return to be resolved'; end if;
    if t.status not in ('open') then raise exception 'This handoff is already closed'; end if;
    v_issues := private.handoff_acceptance_issues(t.id);
    if jsonb_array_length(v_issues) > 0 then
      raise exception 'Cannot accept yet: %', (select string_agg(i ->> 'message', '; ') from jsonb_array_elements(v_issues) i) using errcode = '23514';
    end if;
    select coalesce(quantity_tolerance_percent, 0.5) as tol into v_policy from public.handoff_team_policies where company_id = v_company and team = t.handoff_team;
    v_tolerance := coalesce(v_policy.tol, 0.5);
    if v_received is null or v_received < 0 then raise exception 'Enter the quantity received'; end if;
    if abs(v_received - t.handoff_quantity_kg) > greatest(t.handoff_quantity_kg * v_tolerance / 100, 0.001) then
      raise exception 'Received % kg differs from the handed-over % kg by more than % percent. Return it as a quantity mismatch', trim_scale(round(v_received, 3)), trim_scale(t.handoff_quantity_kg), trim_scale(v_tolerance) using errcode = '23514';
    end if;
    if v_note is not null and length(v_note) > 500 then raise exception 'Keep the note under 500 characters'; end if;
    update public.handoff_acceptances set state = 'accepted', accepted_by = v_actor, accepted_by_name = v_name, accepted_at = now(), auto_accepted = false,
      received_quantity_kg = round(v_received, 3), acceptance_note = v_note, updated_at = now()
    where task_id = t.id;
    return jsonb_build_object('task_id', t.id, 'state', 'accepted', 'replayed', false);
  end if;

  -- acceptance.return
  v_reason := p_payload ->> 'reason';
  v_note := btrim(coalesce(p_payload ->> 'note', ''));
  if v_reason not in ('no_packaging_job','quantity_mismatch','material_not_found','source_reversed','order_not_live','documents_missing','other') then raise exception 'Choose what is missing'; end if;
  if length(v_note) not between 5 and 500 or v_note ~ '[[:cntrl:]]' then raise exception 'Describe what the source team must resolve (5 to 500 characters)'; end if;
  if v_acc.state = 'returned' then raise exception 'This handoff already has an open return'; end if;
  if t.status <> 'open' or t.assigned_to is not null then raise exception 'Only a handoff that has not been started can be returned'; end if;
  v_source_team := case t.handoff_source_type when 'quality_inspection' then 'quality' when 'finishing_job' then 'production' else 'packaging' end;
  -- The person whose action raised the handoff owns the resolution, if still eligible.
  select u.id into v_owner from public.app_users u
  where u.id = t.created_by and u.company_id = v_company and u.is_active and u.dealer_id is null and u.role = any(private.handoff_team_roles(v_source_team));
  insert into public.tasks(company_id, task_type, title, description, priority, status, assigned_to, due_date, related_entity_type, related_entity_id, created_by, assigned_by_user_id,
    handoff_key, handoff_team, handoff_quantity_kg, handoff_source_type, handoff_source_id)
  values (v_company, 'handoff_return', left(concat('Resolve returned handoff: ', replace(v_reason, '_', ' '), ' · ', t.title), 200),
    concat(v_name, ' (', t.handoff_team, ') returned this handoff: ', v_note), t.priority, 'open', v_owner, (now() at time zone 'Asia/Kolkata')::date + 1,
    'task', t.id, v_actor, case when v_owner is not null then v_actor end,
    concat('handoff_return:', t.id, ':', v_acc.return_count + 1), v_source_team, t.handoff_quantity_kg, t.handoff_source_type, t.handoff_source_id)
  returning id into v_return_id;
  insert into public.handoff_returns(company_id, handoff_task_id, return_task_id, reason, note, returned_by, returned_by_name)
  values (v_company, t.id, v_return_id, v_reason, v_note, v_actor, v_name);
  update public.handoff_acceptances set state = 'returned', return_count = return_count + 1, accepted_at = null, accepted_by = null, accepted_by_name = null, updated_at = now() where task_id = t.id;
  return jsonb_build_object('task_id', t.id, 'state', 'returned', 'return_task_id', v_return_id, 'owner_assigned', v_owner is not null);
end;
$$;
revoke all on function public.handoff_acceptance_command(text, jsonb) from public, anon;
grant execute on function public.handoff_acceptance_command(text, jsonb) to authenticated;

commit;
