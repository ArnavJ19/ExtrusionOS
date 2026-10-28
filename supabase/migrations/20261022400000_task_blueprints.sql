-- UPGRADE_EOS feature 61: a standard blueprint for every task kind.
--
-- Each task kind ('type:<task_type>' or 'handoff:<team>', as in features 67 and 77) may have one
-- blueprint with the same eight parts: purpose, trigger, inputs, responsible roles, prerequisites,
-- steps (the procedure version from feature 77), completion evidence (the criteria from feature 67)
-- and an exception route. Prerequisites are structured and enforced by the database when work
-- starts, whatever path starts it:
--   assignee_role  - always: the assignee holds one of the responsible roles,
--   linked_record  - the task is linked to an existing record of a given type,
--   record_state   - that linked record is in one of the listed states (a missing record or state is
--                    never treated as satisfied).
-- Blueprints are saved by managers with a retained revision history; the revision checked at start
-- is recorded on the task. An employee who cannot proceed routes an exception to the blueprint's
-- exception role, which resolves it with a recorded outcome. Without a blueprint nothing changes.
-- Depends on 20261022360000 (criteria) and 20261022390000 (procedure versions). Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.blueprint_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality']
$$;
revoke all on function private.blueprint_roles() from public, anon, authenticated;

create table public.task_blueprints (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  task_kind text not null check (task_kind ~ '^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$'),
  title text not null check (length(btrim(title)) between 3 and 120),
  purpose text not null check (length(btrim(purpose)) between 3 and 800),
  trigger_text text not null check (length(btrim(trigger_text)) between 3 and 300),
  inputs jsonb not null default '[]'::jsonb check (jsonb_typeof(inputs) = 'array' and jsonb_array_length(inputs) <= 10),
  responsible_roles text[] not null check (cardinality(responsible_roles) between 1 and 12 and responsible_roles <@ private.blueprint_roles()),
  prerequisites jsonb not null default '[]'::jsonb check (jsonb_typeof(prerequisites) = 'array' and jsonb_array_length(prerequisites) <= 6),
  exception_role text not null check (exception_role = any(private.blueprint_roles())),
  exception_instruction text not null check (length(btrim(exception_instruction)) between 3 and 300),
  is_active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  updated_by uuid not null references public.app_users(id),
  updated_by_name text not null,
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, task_kind)
);
create index task_blueprints_updated_by_idx on public.task_blueprints(updated_by);

create table public.task_blueprint_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  blueprint_id uuid not null references public.task_blueprints(id),
  revision integer not null,
  snapshot jsonb not null,
  note text not null check (length(btrim(note)) between 3 and 300),
  saved_by uuid not null references public.app_users(id),
  saved_by_name text not null,
  saved_at timestamptz not null default clock_timestamp(),
  unique (blueprint_id, revision)
);
create index task_blueprint_revisions_company_idx on public.task_blueprint_revisions(company_id, blueprint_id, revision desc);
create index task_blueprint_revisions_saved_by_idx on public.task_blueprint_revisions(saved_by);

create table public.task_blueprint_starts (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  blueprint_id uuid not null references public.task_blueprints(id),
  revision integer not null,
  evaluation jsonb not null,
  started_by uuid references public.app_users(id),
  started_at timestamptz not null default clock_timestamp()
);
create index task_blueprint_starts_company_idx on public.task_blueprint_starts(company_id, blueprint_id);
create index task_blueprint_starts_blueprint_idx on public.task_blueprint_starts(blueprint_id);
create index task_blueprint_starts_started_by_idx on public.task_blueprint_starts(started_by);

create table public.task_exceptions (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  task_id uuid not null references public.tasks(id) on delete cascade,
  blueprint_id uuid not null references public.task_blueprints(id),
  blueprint_revision integer not null,
  routed_role text not null,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  raised_by uuid not null references public.app_users(id),
  raised_by_name text not null,
  raised_at timestamptz not null default clock_timestamp(),
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text check (resolution is null or length(btrim(resolution)) between 3 and 500),
  resolved_by uuid references public.app_users(id),
  resolved_by_name text,
  resolved_at timestamptz,
  check ((status = 'resolved') = (resolved_at is not null and resolution is not null and resolved_by is not null))
);
create unique index task_exceptions_one_open on public.task_exceptions(task_id) where status = 'open';
create index task_exceptions_queue_idx on public.task_exceptions(company_id, status, routed_role, raised_at);
create index task_exceptions_blueprint_idx on public.task_exceptions(blueprint_id);
create index task_exceptions_raised_by_idx on public.task_exceptions(raised_by);
create index task_exceptions_resolved_by_idx on public.task_exceptions(resolved_by);

alter table public.task_blueprints enable row level security;
alter table public.task_blueprint_revisions enable row level security;
alter table public.task_blueprint_starts enable row level security;
alter table public.task_exceptions enable row level security;
revoke all on public.task_blueprints, public.task_blueprint_revisions, public.task_blueprint_starts, public.task_exceptions from public, anon, authenticated;
create policy task_blueprints_read on public.task_blueprints for select to authenticated
  using (company_id = (select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy task_blueprint_revisions_read on public.task_blueprint_revisions for select to authenticated
  using (company_id = (select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy task_blueprint_starts_read on public.task_blueprint_starts for select to authenticated
  using (company_id = (select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy task_exceptions_read on public.task_exceptions for select to authenticated
  using (company_id = (select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);

-- Null when the blueprint content is valid; otherwise the reason.
create or replace function private.blueprint_problem(p_inputs jsonb, p_roles text[], p_prereqs jsonb) returns text language plpgsql immutable set search_path = public, private as $$
declare x jsonb; v_types text[] := array['order','quality_inspection','production_job','dispatch','quote','invoice','breakdown_log']; v_state text; v_linked text;
begin
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'array' or jsonb_array_length(p_inputs) > 10 then return 'List up to 10 inputs'; end if;
  for x in select value from jsonb_array_elements(p_inputs) loop
    if jsonb_typeof(x) <> 'string' or length(btrim(x #>> '{}')) not between 2 and 120 then return 'Each input needs 2 to 120 characters'; end if;
  end loop;
  if p_roles is null or cardinality(p_roles) = 0 or not (p_roles <@ private.blueprint_roles()) then return 'Choose at least one responsible employee role'; end if;
  if p_prereqs is null or jsonb_typeof(p_prereqs) <> 'array' or jsonb_array_length(p_prereqs) > 6 then return 'List up to 6 prerequisites'; end if;
  for x in select value from jsonb_array_elements(p_prereqs) loop
    if jsonb_typeof(x) <> 'object' or coalesce(x ->> 'kind', '') not in ('linked_record','record_state') or not coalesce((x ->> 'entity_type') = any(v_types),false) then
      return 'Each prerequisite needs a kind and a record type';
    end if;
    if x ->> 'kind' = 'linked_record' and exists (select 1 from jsonb_object_keys(x) k where k not in ('kind','entity_type')) then return 'Each prerequisite needs a kind and a record type'; end if;
    if x ->> 'kind' = 'record_state' then
      if exists (select 1 from jsonb_object_keys(x) k where k not in ('kind','entity_type','states')) or jsonb_typeof(x -> 'states') is distinct from 'array'
         or jsonb_array_length(x -> 'states') = 0 then
        return 'A record-state prerequisite needs at least one state';
      end if;
      for v_state in select jsonb_array_elements_text(x -> 'states') loop
        if v_state is null or not (v_state = any(private.task_source_states(x ->> 'entity_type'))) then return 'A required state is not valid for that record type'; end if;
      end loop;
    end if;
    v_linked := coalesce(v_linked, x ->> 'entity_type');
    if v_linked <> x ->> 'entity_type' then return 'All prerequisites must refer to the same linked record type'; end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.blueprint_problem(jsonb, text[], jsonb) from public, anon, authenticated;

create or replace function private.task_blueprint_for(t public.tasks) returns public.task_blueprints language sql stable security definer set search_path = public, private as $$
  select b.* from public.task_blueprints b
  where b.company_id = t.company_id and b.is_active and b.task_kind = any(private.task_kinds_of(t.task_type, t.handoff_team))
  order by (b.task_kind like 'handoff:%') desc limit 1
$$;
revoke all on function private.task_blueprint_for(public.tasks) from public, anon, authenticated;

-- Each prerequisite with whether it holds now and why not.
create or replace function private.task_blueprint_evaluate(t public.tasks, b public.task_blueprints) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare x jsonb; v_items jsonb := '[]'::jsonb; v_unmet integer := 0; v_role text; v_name text; v_state text; v_met boolean; v_reason text; v_states text[];
begin
  select role, full_name into v_role, v_name from public.app_users where id = t.assigned_to and company_id = t.company_id and is_active and dealer_id is null;
  v_met := v_role is not null and v_role = any(b.responsible_roles);
  v_reason := case when t.assigned_to is null then 'nobody is assigned' when v_role is null then 'the assignee is not an active employee'
                   when not v_met then format('the assignee is %s, not a responsible role', replace(v_role, '_', ' ')) end;
  v_items := v_items || jsonb_build_object('kind', 'assignee_role', 'label', 'Assigned to a responsible role', 'met', v_met, 'reason', v_reason, 'current', v_role);
  v_unmet := v_unmet + case when v_met then 0 else 1 end;
  for x in select value from jsonb_array_elements(b.prerequisites) loop
    v_state := case when t.related_entity_type = x ->> 'entity_type' and t.related_entity_id is not null
                    then private.task_source_state(t.company_id, x ->> 'entity_type', t.related_entity_id) end;
    if x ->> 'kind' = 'linked_record' then
      v_met := v_state is not null;
      v_reason := case when v_met then null when t.related_entity_type is distinct from x ->> 'entity_type' or t.related_entity_id is null
                       then format('the task is not linked to a %s', replace(x ->> 'entity_type', '_', ' ')) else format('the linked %s is unavailable', replace(x ->> 'entity_type', '_', ' ')) end;
      v_items := v_items || jsonb_build_object('kind', 'linked_record', 'label', format('Linked to a %s', replace(x ->> 'entity_type', '_', ' ')), 'met', v_met, 'reason', v_reason, 'current', v_state);
    else
      v_states := array(select jsonb_array_elements_text(x -> 'states'));
      v_met := v_state is not null and v_state = any(v_states);
      v_reason := case when v_met then null when v_state is null then format('the linked %s state is not captured', replace(x ->> 'entity_type', '_', ' '))
                       else format('the linked %s is %s, not %s', replace(x ->> 'entity_type', '_', ' '), replace(v_state, '_', ' '), replace(array_to_string(v_states, ' or '), '_', ' ')) end;
      v_items := v_items || jsonb_build_object('kind', 'record_state', 'label', format('Linked %s is %s', replace(x ->> 'entity_type', '_', ' '), replace(array_to_string(v_states, ' or '), '_', ' ')),
        'met', v_met, 'reason', v_reason, 'current', v_state);
    end if;
    v_unmet := v_unmet + case when v_met then 0 else 1 end;
  end loop;
  return jsonb_build_object('blueprint_id', b.id, 'revision', b.revision, 'unmet', v_unmet, 'checks', v_items);
end;
$$;
revoke all on function private.task_blueprint_evaluate(public.tasks, public.task_blueprints) from public, anon, authenticated;

-- Short refusal (the tasks API shows up to 240 characters): the first two reasons and a count.
create or replace function private.task_blueprint_refusal(p_eval jsonb) returns text language sql immutable set search_path = public, private as $$
  select left('This task cannot start yet: ' || string_agg(r, '; ') filter (where n <= 2)
    || case when count(*) > 2 then format(' (+%s more)', count(*) - 2) else '' end, 240)
  from (select x ->> 'reason' r, row_number() over () n from jsonb_array_elements(p_eval -> 'checks') x where not (x ->> 'met')::boolean) unmet
$$;
revoke all on function private.task_blueprint_refusal(jsonb) from public, anon, authenticated;

-- Refuses to start work whose blueprint prerequisites are not met, by any path, and records the check.
create or replace function private.guard_task_blueprint_start() returns trigger language plpgsql security definer set search_path = public, private as $$
declare b public.task_blueprints; v_eval jsonb;
begin
  if new.dealership_id is not null or new.status <> 'in_progress' or (tg_op = 'UPDATE' and old.status = 'in_progress') then return new; end if;
  b := private.task_blueprint_for(new);
  if b.id is null then return new; end if;
  v_eval := private.task_blueprint_evaluate(new, b);
  if (v_eval ->> 'unmet')::integer > 0 then raise exception '%', private.task_blueprint_refusal(v_eval) using errcode = '23514'; end if;
  if tg_op = 'UPDATE' then
    insert into public.task_blueprint_starts(task_id, company_id, blueprint_id, revision, evaluation, started_by)
    values (new.id, new.company_id, b.id, b.revision, v_eval, auth.uid())
    on conflict (task_id) do update set blueprint_id = excluded.blueprint_id, revision = excluded.revision, evaluation = excluded.evaluation, started_by = excluded.started_by, started_at = clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function private.guard_task_blueprint_start() from public, anon, authenticated;
drop trigger if exists d_guard_task_blueprint_start on public.tasks;
create trigger d_guard_task_blueprint_start before insert or update of status on public.tasks for each row execute function private.guard_task_blueprint_start();

-- A task inserted as already in progress is recorded once it exists.
create or replace function private.record_task_blueprint_insert_start() returns trigger language plpgsql security definer set search_path = public, private as $$
declare b public.task_blueprints;
begin
  if new.dealership_id is not null or new.status <> 'in_progress' then return new; end if;
  b := private.task_blueprint_for(new);
  if b.id is null then return new; end if;
  insert into public.task_blueprint_starts(task_id, company_id, blueprint_id, revision, evaluation, started_by)
  values (new.id, new.company_id, b.id, b.revision, private.task_blueprint_evaluate(new, b), auth.uid()) on conflict (task_id) do nothing;
  return new;
end;
$$;
revoke all on function private.record_task_blueprint_insert_start() from public, anon, authenticated;
drop trigger if exists d_record_task_blueprint_insert_start on public.tasks;
create trigger d_record_task_blueprint_insert_start after insert on public.tasks for each row execute function private.record_task_blueprint_insert_start();

create or replace function private.blueprint_json(b public.task_blueprints) returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', b.id, 'task_kind', b.task_kind, 'title', b.title, 'purpose', b.purpose, 'trigger_text', b.trigger_text, 'inputs', b.inputs,
    'responsible_roles', to_jsonb(b.responsible_roles), 'prerequisites', b.prerequisites, 'exception_role', b.exception_role, 'exception_instruction', b.exception_instruction,
    'is_active', b.is_active, 'revision', b.revision, 'updated_by_name', b.updated_by_name, 'updated_at', b.updated_at,
    'procedure', (select jsonb_build_object('id', p.id, 'title', p.title, 'version_no', (private.procedure_applicable_version(p.id, private.ist_today())).version_no)
                  from public.procedure_task_kinds k join public.operating_procedures p on p.id = k.procedure_id where k.company_id = b.company_id and k.task_kind = b.task_kind),
    'criteria_templates', (select count(*) from public.completion_criteria_templates c where c.company_id = b.company_id and c.task_kind = b.task_kind and c.is_active))
$$;
revoke all on function private.blueprint_json(public.task_blueprints) from public, anon, authenticated;

create or replace function public.task_blueprint_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text; v_manager boolean := v_role in ('owner','admin','factory_manager');
  b public.task_blueprints; t public.tasks; e public.task_exceptions; v_problem text; v_text text; v_roles text[]; v_page integer; v_total bigint; v_rows jsonb; v_id uuid; v_status text; v_search text; v_sort text;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid blueprint request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if v_name is null or v_role in ('dealer_admin','dealer_staff') or p_command is null or p_command not in ('blueprints.list','blueprint.load','blueprint.save','task.blueprint','exception.raise','exception.resolve','exceptions.list')
     or (p_command = 'blueprint.save' and not v_manager)
     or (p_command in ('exception.raise','exception.resolve') and v_role = 'viewer') then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'blueprints.list' then
    begin v_page:=coalesce((p_payload->>'page')::integer,1);exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid page';end;
    if v_page not between 1 and 100000 then raise exception 'Invalid page';end if;
    v_search:=lower(btrim(coalesce(p_payload->>'search','')));v_status:=coalesce(p_payload->>'status','all');v_sort:=coalesce(p_payload->>'sort','kind');
    if length(v_search)>80 or v_status not in ('all','active','inactive') or v_sort not in ('kind','title','updated') then raise exception 'Invalid blueprint request';end if;
    with eligible as (
      select bp.* from public.task_blueprints bp where bp.company_id=v_company and (v_search='' or position(v_search in lower(bp.title||' '||bp.task_kind||' '||bp.purpose))>0)
        and (v_status='all' or bp.is_active=(v_status='active'))
    ), paged as (
      select * from eligible order by case when v_sort='title' then lower(title) end,case when v_sort='updated' then updated_at end desc,task_kind,id limit 10 offset (v_page-1)*10
    )
    select jsonb_build_object('total_count',(select count(*) from eligible),'rows',coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'task_kind', x.task_kind, 'title', x.title, 'is_active', x.is_active, 'revision', x.revision,
        'responsible_roles', to_jsonb(x.responsible_roles), 'prerequisite_count', jsonb_array_length(x.prerequisites), 'exception_role', x.exception_role,
        'open_exceptions', (select count(*) from public.task_exceptions te where te.blueprint_id = x.id and te.status = 'open')) order by case when v_sort='title' then lower(x.title) end,case when v_sort='updated' then x.updated_at end desc,x.task_kind,x.id)
      from paged x), '[]'::jsonb)) into v_rows;
    return v_rows;

  elsif p_command = 'blueprint.load' then
    begin
      select * into b from public.task_blueprints where id = (p_payload ->> 'blueprint_id')::uuid and company_id = v_company;
      v_page := coalesce((p_payload ->> 'page')::integer, 1);
    exception when invalid_text_representation then raise exception 'Blueprint is unavailable'; end;
    if b.id is null then raise exception 'Blueprint is unavailable'; end if;
    if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
    select count(*) into v_total from public.task_blueprint_revisions where blueprint_id = b.id;
    select coalesce(jsonb_agg(jsonb_build_object('revision', r.revision, 'note', r.note, 'saved_by_name', r.saved_by_name, 'saved_at', r.saved_at, 'snapshot', r.snapshot) order by r.revision desc), '[]'::jsonb)
    into v_rows from (select * from public.task_blueprint_revisions where blueprint_id = b.id order by revision desc limit 10 offset (v_page - 1) * 10) r;
    return jsonb_build_object('blueprint', private.blueprint_json(b), 'revisions', v_rows, 'total_count', v_total);

  elsif p_command = 'blueprint.save' then
    v_text := btrim(coalesce(p_payload ->> 'note', ''));
    if length(v_text) not between 3 and 300 then raise exception 'Record why the blueprint is saved (3 to 300 characters)'; end if;
    begin
      v_id := (p_payload ->> 'id')::uuid;
      v_roles := array(select jsonb_array_elements_text(p_payload -> 'responsible_roles'));
    exception when invalid_text_representation or invalid_parameter_value then raise exception 'Invalid blueprint request'; end;
    if v_id is null or coalesce(p_payload ->> 'task_kind', '') !~ '^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$' then
      raise exception 'Choose the kind of task the blueprint applies to';
    end if;
    v_problem := private.blueprint_problem(coalesce(p_payload -> 'inputs', '[]'::jsonb), v_roles, coalesce(p_payload -> 'prerequisites', '[]'::jsonb));
    if v_problem is not null then raise exception '%', v_problem; end if;
    if coalesce(p_payload ->> 'exception_role', '') <> all(private.blueprint_roles()) then raise exception 'Choose the role that resolves exceptions'; end if;
    if length(btrim(coalesce(p_payload ->> 'title', ''))) not between 3 and 120 or length(btrim(coalesce(p_payload ->> 'purpose', ''))) not between 3 and 800
       or length(btrim(coalesce(p_payload ->> 'trigger_text', ''))) not between 3 and 300 or length(btrim(coalesce(p_payload ->> 'exception_instruction', ''))) not between 3 and 300 then
      raise exception 'Fill in the title, purpose, trigger and exception instruction';
    end if;
    select * into b from public.task_blueprints where id = v_id for update;
    if b.id is not null then
      if b.company_id <> v_company then raise exception 'Blueprint is unavailable'; end if;
      if (p_payload ->> 'expected_revision') is null or b.revision <> (p_payload ->> 'expected_revision')::integer then
        raise exception 'This blueprint was changed by someone else. Reload it before saving';
      end if;
      begin
      update public.task_blueprints set task_kind = p_payload ->> 'task_kind', title = btrim(p_payload ->> 'title'), purpose = btrim(p_payload ->> 'purpose'),
        trigger_text = btrim(p_payload ->> 'trigger_text'), inputs = coalesce(p_payload -> 'inputs', '[]'::jsonb), responsible_roles = v_roles,
        prerequisites = coalesce(p_payload -> 'prerequisites', '[]'::jsonb), exception_role = p_payload ->> 'exception_role',
        exception_instruction = btrim(p_payload ->> 'exception_instruction'), is_active = coalesce((p_payload ->> 'is_active')::boolean, true),
        revision = revision + 1, updated_by = v_actor, updated_by_name = v_name, updated_at = clock_timestamp()
      where id = v_id returning * into b;
      exception when unique_violation then raise exception 'That task kind already has a blueprint. Edit it instead';
      end;
    else
      begin
        insert into public.task_blueprints(id, company_id, task_kind, title, purpose, trigger_text, inputs, responsible_roles, prerequisites, exception_role, exception_instruction, is_active, updated_by, updated_by_name)
        values (v_id, v_company, p_payload ->> 'task_kind', btrim(p_payload ->> 'title'), btrim(p_payload ->> 'purpose'), btrim(p_payload ->> 'trigger_text'),
          coalesce(p_payload -> 'inputs', '[]'::jsonb), v_roles, coalesce(p_payload -> 'prerequisites', '[]'::jsonb), p_payload ->> 'exception_role',
          btrim(p_payload ->> 'exception_instruction'), coalesce((p_payload ->> 'is_active')::boolean, true), v_actor, v_name)
        returning * into b;
      exception when unique_violation then raise exception 'That task kind already has a blueprint. Edit it instead';
      end;
    end if;
    insert into public.task_blueprint_revisions(company_id, blueprint_id, revision, snapshot, note, saved_by, saved_by_name)
    values (v_company, b.id, b.revision, private.blueprint_json(b) - 'procedure' - 'criteria_templates', v_text, v_actor, v_name);
    return jsonb_build_object('id', b.id, 'revision', b.revision);

  elsif p_command = 'exceptions.list' then
    v_status := coalesce(p_payload ->> 'status', 'open');
    if v_status not in ('open','resolved') then raise exception 'Invalid blueprint request'; end if;
    begin v_page := coalesce((p_payload ->> 'page')::integer, 1); exception when invalid_text_representation then v_page := 0; end;
    if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
    -- Managers see every exception; others see those routed to their role or raised by them.
    select count(*) into v_total from public.task_exceptions x
    where x.company_id = v_company and x.status = v_status and (v_manager or x.routed_role = v_role or x.raised_by = v_actor);
    select coalesce(jsonb_agg(to_jsonb(r) order by r.raised_at, r.id), '[]'::jsonb) into v_rows from (
      select x.id, x.task_id, tk.title as task_title, x.routed_role, x.reason, x.raised_by_name, x.raised_at, x.status, x.resolution, x.resolved_by_name, x.resolved_at,
        (x.raised_by <> v_actor or v_role = 'owner') and (v_role in ('owner','admin') or x.routed_role = v_role) as can_resolve
      from public.task_exceptions x join public.tasks tk on tk.id = x.task_id
      where x.company_id = v_company and x.status = v_status and (v_manager or x.routed_role = v_role or x.raised_by = v_actor)
      order by x.raised_at, x.id limit 10 offset (v_page - 1) * 10) r;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total);

  elsif p_command = 'exception.resolve' then
    begin
      select * into e from public.task_exceptions where id = (p_payload ->> 'exception_id')::uuid and company_id = v_company for update;
    exception when invalid_text_representation then raise exception 'Exception is unavailable'; end;
    if e.id is null then raise exception 'Exception is unavailable'; end if;
    if e.status <> 'open' then raise exception 'This exception is already resolved'; end if;
    if not (v_role in ('owner','admin') or e.routed_role = v_role) then raise exception 'Only the role this exception is routed to can resolve it' using errcode = '42501'; end if;
    if e.raised_by = v_actor and v_role <> 'owner' then raise exception 'Someone other than the employee who raised it must resolve it' using errcode = '42501'; end if;
    v_text := btrim(coalesce(p_payload ->> 'resolution', ''));
    if length(v_text) not between 3 and 500 then raise exception 'Record the outcome (3 to 500 characters)'; end if;
    update public.task_exceptions set status = 'resolved', resolution = v_text, resolved_by = v_actor, resolved_by_name = v_name, resolved_at = clock_timestamp() where id = e.id;
    select * into t from public.tasks where id = e.task_id;
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
    select v_company, x, 'task_exception', 'success', left('Exception resolved: ' || t.title, 200), left(v_name || ': ' || v_text, 500), 'task', t.id, v_actor, '/tasks/' || t.id
    from unnest(array[e.raised_by, t.assigned_to]) x where x is not null and x <> v_actor group by x;
    return jsonb_build_object('id', e.id, 'status', 'resolved');
  end if;

  -- Task-scoped commands.
  begin
    select * into t from public.tasks where id = (p_payload ->> 'task_id')::uuid and company_id = v_company and dealership_id is null;
  exception when invalid_text_representation then raise exception 'Task is unavailable'; end;
  if t.id is null then raise exception 'Task is unavailable'; end if;
  b := private.task_blueprint_for(t);

  if p_command = 'task.blueprint' then
    if b.id is null then return jsonb_build_object('has_blueprint', false); end if;
    return jsonb_build_object('has_blueprint', true, 'blueprint', private.blueprint_json(b), 'evaluation', private.task_blueprint_evaluate(t, b),
      'started_check', (select jsonb_build_object('revision', s.revision, 'started_at', s.started_at, 'evaluation', s.evaluation) from public.task_blueprint_starts s where s.task_id = t.id),
      'open_exception', (select jsonb_build_object('id', x.id, 'reason', x.reason, 'routed_role', x.routed_role, 'raised_by_name', x.raised_by_name, 'raised_at', x.raised_at)
                         from public.task_exceptions x where x.task_id = t.id and x.status = 'open'),
      'can_raise', coalesce(t.status in ('open','in_progress') and v_role <> 'viewer' and (t.assigned_to = v_actor or v_manager or v_role like '%\_manager' escape '\'), false));
  end if;

  -- exception.raise: idempotent by id.
  begin v_id := (p_payload ->> 'id')::uuid; exception when invalid_text_representation then raise exception 'Invalid blueprint request'; end;
  select * into e from public.task_exceptions where id = v_id;
  if e.id is not null then
    if e.task_id <> t.id or e.raised_by <> v_actor then raise exception 'Invalid blueprint request'; end if;
    return jsonb_build_object('id', e.id, 'status', e.status, 'routed_role', e.routed_role);
  end if;
  if b.id is null then raise exception 'This task has no blueprint, so it has no exception route'; end if;
  if t.status not in ('open','in_progress') then raise exception 'Exceptions can be raised only while the task is open'; end if;
  if not coalesce(t.assigned_to = v_actor or v_manager or v_role like '%\_manager' escape '\', false) then raise exception 'Only the assignee or a supervisor can raise an exception' using errcode = '42501'; end if;
  v_text := btrim(coalesce(p_payload ->> 'reason', ''));
  if length(v_text) not between 3 and 500 then raise exception 'Describe why the task cannot proceed (3 to 500 characters)'; end if;
  begin
    insert into public.task_exceptions(id, company_id, task_id, blueprint_id, blueprint_revision, routed_role, reason, raised_by, raised_by_name)
    values (v_id, v_company, t.id, b.id, b.revision, b.exception_role, v_text, v_actor, v_name) returning * into e;
  exception when unique_violation then raise exception 'An exception is already open for this task';
  end;
  insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
  values (v_company, b.exception_role, 'task_exception', 'warning', left('Task exception: ' || t.title, 200), left(v_name || ': ' || v_text || ' · ' || b.exception_instruction, 500), 'task', t.id, v_actor, '/tasks/' || t.id);
  return jsonb_build_object('id', e.id, 'status', e.status, 'routed_role', e.routed_role);
end;
$$;
revoke all on function public.task_blueprint_command(text, jsonb) from public, anon;
grant execute on function public.task_blueprint_command(text, jsonb) to authenticated;

commit;
