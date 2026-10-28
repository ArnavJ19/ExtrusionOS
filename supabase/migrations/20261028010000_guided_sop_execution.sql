-- Features 65, 66, 68 and 70: reviewed execution plans, ordered execution,
-- measured decision branches, transaction evidence and independent verification.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.sop_execution_plans (
  id uuid primary key, company_id uuid not null references public.companies(id),
  version_id uuid not null unique references public.procedure_versions(id),
  steps jsonb not null, normal_role text, elevated_role text not null,
  status text not null default 'draft' check(status in ('draft','released')),
  revision integer not null default 1, author_id uuid not null references public.app_users(id), author_name text not null,
  reviewer_id uuid references public.app_users(id), reviewer_name text, released_at timestamptz,
  check(status <> 'released' or (reviewer_id is not null and reviewer_id <> author_id and released_at is not null))
);
create index sop_execution_plans_company_idx on public.sop_execution_plans(company_id,version_id);
create table public.sop_runs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  task_id uuid not null references public.tasks(id), plan_id uuid not null references public.sop_execution_plans(id),
  attempt integer not null, performer_id uuid not null references public.app_users(id), performer_name text not null,
  status text not null default 'active' check(status in ('active','review','completed','superseded')),
  elevated boolean not null default false, required_role text, revision integer not null default 1,
  started_at timestamptz not null default clock_timestamp(), submitted_at timestamptz,
  verified_by uuid references public.app_users(id), verified_by_name text, verification_note text,
  verified_at timestamptz, completed_at timestamptz, unique(task_id,attempt),
  check(verified_by is null or verified_by <> performer_id)
);
create index sop_runs_company_idx on public.sop_runs(company_id,status,started_at desc);
create index sop_runs_task_idx on public.sop_runs(task_id,attempt desc);
create table public.sop_step_events (
  id uuid primary key, company_id uuid not null references public.companies(id), run_id uuid not null references public.sop_runs(id),
  step_no integer not null, event text not null check(event in ('check','measurement','transaction','retry')),
  value numeric, note text not null, outcome text not null check(outcome in ('done','review','retry')),
  source_type text, source_id uuid, source_state text, actor_id uuid not null references public.app_users(id), actor_name text not null,
  recorded_at timestamptz not null default clock_timestamp(), request_payload jsonb not null
);
create index sop_step_events_company_idx on public.sop_step_events(company_id,run_id,step_no,recorded_at desc);
create index sop_step_events_source_idx on public.sop_step_events(source_type,source_id);
create table public.sop_verification_events (
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),run_id uuid not null references public.sop_runs(id),
  decision text not null check(decision in ('verified','returned')),evidence_revision integer not null,required_role text,
  actor_id uuid not null references public.app_users(id),actor_name text not null,note text not null check(length(btrim(note)) between 3 and 500),
  recorded_at timestamptz not null default clock_timestamp()
);
create index sop_verification_events_company_idx on public.sop_verification_events(company_id,run_id,recorded_at desc);
alter table public.sop_execution_plans enable row level security;
alter table public.sop_runs enable row level security;
alter table public.sop_step_events enable row level security;
alter table public.sop_verification_events enable row level security;
revoke all on public.sop_execution_plans, public.sop_runs, public.sop_step_events,public.sop_verification_events from public,anon,authenticated;
create policy sop_plans_company on public.sop_execution_plans for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy sop_runs_company on public.sop_runs for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy sop_steps_company on public.sop_step_events for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy sop_verification_company on public.sop_verification_events for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);

create function private.guard_sop_plan() returns trigger language plpgsql set search_path=public,private as $$
begin
  if tg_op='DELETE' or old.status='released' then raise exception 'Released execution plans are kept unchanged'; end if;
  if (new.id,new.company_id,new.version_id) is distinct from (old.id,old.company_id,old.version_id) then raise exception 'Plan identity cannot change'; end if;
  return new;
end $$;
create trigger a_guard_sop_plan before update or delete on public.sop_execution_plans for each row execute function private.guard_sop_plan();
create function private.keep_sop_event() returns trigger language plpgsql set search_path=public,private as $$
begin raise exception 'Execution evidence is retained as history'; end $$;
create trigger a_keep_sop_event before update or delete on public.sop_step_events for each row execute function private.keep_sop_event();
create trigger a_keep_sop_verification before update or delete on public.sop_verification_events for each row execute function private.keep_sop_event();

create function private.sop_evidence_state(t public.tasks,p_type text,p_id uuid,p_role text) returns text
language plpgsql stable security definer set search_path=public,private as $$
begin
  if p_type in ('quote','invoice') and p_role not in ('owner','admin','accounts','sales_manager','sales') then return null; end if;
  if t.related_entity_type=p_type and t.related_entity_id=p_id then return private.task_source_state(t.company_id,p_type,p_id); end if;
  if p_type='quality_inspection' and t.related_entity_type='production_job' then
    return (select status from public.quality_inspections where id=p_id and company_id=t.company_id and production_job_id=t.related_entity_id);
  elsif p_type='dispatch' and t.related_entity_type='order' then
    return (select delivery_status from public.dispatches where id=p_id and company_id=t.company_id and order_id=t.related_entity_id);
  end if;
  return null;
end $$;

create function private.sop_source_choices(t public.tasks,p_type text,p_states text[]) returns jsonb language sql stable security definer set search_path=public,private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'label',replace(p_type,'_',' ') || ' / ' || x.state || ' / ' || right(x.id::text,6)) order by x.id),'[]'::jsonb) from (
    select candidate.id,private.sop_evidence_state(t,p_type,candidate.id,private.get_current_user_role()) as state from (
      select t.related_entity_id as id where t.related_entity_type=p_type
      union select qi.id from public.quality_inspections qi where p_type='quality_inspection' and t.related_entity_type='production_job' and qi.company_id=t.company_id and qi.production_job_id=t.related_entity_id
      union select d.id from public.dispatches d where p_type='dispatch' and t.related_entity_type='order' and d.company_id=t.company_id and d.order_id=t.related_entity_id
    ) candidate where candidate.id is not null and private.sop_evidence_state(t,p_type,candidate.id,private.get_current_user_role())=any(p_states) order by candidate.id limit 10
  )x where x.state is not null
$$;
create function private.sop_run_view(t public.tasks) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare r public.sop_runs; p public.sop_execution_plans; v_step jsonb; e public.sop_step_events; rows jsonb:='[]'; next_step integer:=null; v_state text; valid boolean; effective_role text;
begin
  select * into r from public.sop_runs where task_id=t.id order by attempt desc limit 1;
  if r.id is null then return jsonb_build_object('task_id',t.id,'task_status',t.status,'can_start',coalesce(t.assigned_to=auth.uid(),false),'run',null,'steps','[]'::jsonb,'next_step',null,'verification_history','[]'::jsonb); end if;
  select * into p from public.sop_execution_plans where id=r.plan_id;
  for v_step in select value from jsonb_array_elements(p.steps) order by (value->>'step_no')::int loop
    select * into e from public.sop_step_events where run_id=r.id and step_no=(v_step->>'step_no')::int order by recorded_at desc,id desc limit 1;
    valid:=e.outcome='done'; v_state:=null;
    if e.event='transaction' then
      v_state:=private.sop_evidence_state(t,e.source_type,e.source_id,private.get_current_user_role());
      valid:=coalesce(valid and v_state in (select jsonb_array_elements_text(v_step->'states')),false);
    end if;
    if not coalesce(valid,false) and next_step is null then next_step:=(v_step->>'step_no')::int; end if;
    rows:=rows || jsonb_build_array(v_step || jsonb_build_object('evidence',case when e.id is not null then to_jsonb(e)-'company_id'-'request_payload' end,'valid',coalesce(valid,false),'current_source_state',v_state,
      'options',case when v_step->>'kind'='transaction' then private.sop_source_choices(t,v_step->>'source_type',array(select jsonb_array_elements_text(v_step->'states'))) else '[]'::jsonb end));
  end loop;
  effective_role:=case when r.elevated or t.priority in ('high','urgent') then p.elevated_role else p.normal_role end;
  return jsonb_build_object('task_id',t.id,'task_status',t.status,'can_start',coalesce(t.assigned_to=auth.uid(),false),'run',(to_jsonb(r)-'company_id') || jsonb_build_object('required_role',effective_role,'elevated',r.elevated or t.priority in ('high','urgent'),
    'verification_current',r.verified_by is not null and r.required_role is not distinct from effective_role and next_step is null),'steps',rows,'next_step',next_step,
    'verification_history',coalesce((select jsonb_agg(to_jsonb(x)) from (select decision,actor_name,note,evidence_revision,recorded_at from public.sop_verification_events where run_id=r.id order by recorded_at desc,id desc limit 10)x),'[]'::jsonb));
end $$;

create function private.lock_sop_source(p_company uuid,p_type text,p_id uuid) returns void language plpgsql security definer set search_path=public,private as $$
declare table_name text;
begin
  table_name:=case p_type when 'order' then 'orders' when 'production_job' then 'production_jobs' when 'quality_inspection' then 'quality_inspections'
    when 'dispatch' then 'dispatches' when 'quote' then 'quotes' when 'invoice' then 'invoices' when 'breakdown_log' then 'breakdown_logs' end;
  if table_name is not null then execute format('select 1 from public.%I where company_id=$1 and id=$2 for share',table_name) using p_company,p_id;end if;
end $$;

-- This guard also covers ordinary task edits, so the guided path cannot be bypassed.
create function private.guard_sop_completion() returns trigger language plpgsql security definer set search_path=public,private as $$
declare r public.sop_runs; v jsonb; p public.sop_execution_plans;
begin
  if new.dealership_id is not null then return new; end if;
  if new.status='completed' and (tg_op='INSERT' or old.status is distinct from new.status) then
    select ep.* into p from public.sop_execution_plans ep join public.task_procedure_bindings b on b.version_id=ep.version_id where b.task_id=new.id and ep.status='released';
    if p.id is null and tg_op='INSERT' then
      select ep.* into p from public.sop_execution_plans ep where ep.version_id=(private.procedure_applicable_version(private.task_procedure_id(new.company_id,new.task_type,new.handoff_team),private.ist_today())).id and ep.status='released';
    end if;
    if p.id is not null then
      select * into r from public.sop_runs where task_id=new.id order by attempt desc limit 1;
      if r.id is null or r.status<>'completed' or r.plan_id<>p.id then raise exception 'Complete the guided procedure and required verification first' using errcode='23514'; end if;
      v:=private.sop_run_view(new);
      if (v->>'next_step') is not null then raise exception 'Required transaction evidence changed. Review the guided procedure' using errcode='23514'; end if;
    end if;
  elsif tg_op='UPDATE' and old.status='completed' and new.status in ('open','in_progress') then
    -- The old attempt remains complete. A new attempt is required before completing again.
    if exists(select 1 from public.sop_runs where task_id=new.id) then
      insert into public.sop_runs(company_id,task_id,plan_id,attempt,performer_id,performer_name,elevated,required_role)
      select company_id,task_id,plan_id,attempt+1,performer_id,performer_name,elevated,required_role from public.sop_runs where task_id=new.id order by attempt desc limit 1;
    end if;
  end if;
  return new;
end $$;
create trigger zy_guard_sop_completion before insert or update of status on public.tasks for each row execute function private.guard_sop_completion();

create function public.guided_sop_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare
  actor uuid:=auth.uid(); company uuid:=private.get_current_user_company_id(); role_name text:=private.get_current_user_role(); actor_name text;
  manager boolean; reviewer boolean; t public.tasks; b public.task_procedure_bindings; pv public.procedure_versions; op public.operating_procedures;
  p public.sop_execution_plans; r public.sop_runs; e public.sop_step_events; v_step jsonb; v_id uuid; v_no integer; v_value numeric; v_text text; v_state text;
  v_view jsonb; v_steps jsonb; v_expected int; v_required text; v_elevated boolean; v_search text;v_filter text;v_sort text;v_allowed text[]:=array['owner','admin','factory_manager','production_manager','dispatch_manager','inventory_manager','quality','accounts','sales_manager'];
begin
  if actor is null or company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select coalesce(nullif(full_name,''),'Employee') into actor_name from public.app_users where id=actor and company_id=company and role=role_name and is_active and dealer_id is null;
  if actor_name is null or role_name in ('dealer_admin','dealer_staff') or jsonb_typeof(p_payload) is distinct from 'object' or p_command is null or p_command not in ('plan.load','plan.save','plan.release','run.load','run.start','step.record','step.retry','run.submit','run.verify','run.return','run.complete','review.queue') then raise exception 'Action not permitted' using errcode='42501'; end if;
  manager:=role_name in ('owner','admin','factory_manager','production_manager');
  if role_name='viewer' and p_command not in ('plan.load','run.load') then raise exception 'Action not permitted' using errcode='42501'; end if;

  if p_command like 'plan.%' then
    select * into pv from public.procedure_versions where id=(p_payload->>'version_id')::uuid and company_id=company for update;
    if pv.id is null then raise exception 'Procedure version is unavailable'; end if;
    select * into op from public.operating_procedures where id=pv.procedure_id;
    reviewer:=coalesce(role_name in ('owner','admin') or actor in (op.owner_id,op.backup_id),false);
    select * into p from public.sop_execution_plans where version_id=pv.id for update;
    if p_command='plan.load' then return jsonb_build_object('plan',case when p.id is not null then to_jsonb(p)-'company_id' end,'can_manage',reviewer,'instructions',pv.steps); end if;
    if not reviewer then raise exception 'Only the process owner, backup or administrator can configure execution' using errcode='42501'; end if;
    if pv.status<>'released' then raise exception 'Release the instructions before configuring execution'; end if;
    if p_command='plan.release' then
      if p.id is null or p.status<>'draft' then raise exception 'Choose a draft execution plan'; end if;
      if p.author_id=actor then raise exception 'A different reviewer must release the execution plan' using errcode='42501'; end if;
      if p.revision is distinct from (p_payload->>'expected_revision')::int then raise exception 'The plan changed. Reload before reviewing'; end if;
      update public.sop_execution_plans set status='released',reviewer_id=actor,reviewer_name=actor_name,released_at=clock_timestamp() where id=p.id returning * into p;
      return to_jsonb(p)-'company_id';
    end if;
    if p.status='released' then raise exception 'Released execution plans are kept unchanged'; end if;
    if p.id is not null and p.revision is distinct from (p_payload->>'expected_revision')::int then raise exception 'The plan changed. Reload before saving'; end if;
    v_steps:=p_payload->'steps';
    if jsonb_typeof(v_steps) is distinct from 'array' then raise exception 'Configure every instruction step'; end if;
    if jsonb_array_length(v_steps)<>jsonb_array_length(pv.steps) or jsonb_array_length(v_steps) not between 1 and 30
       or (select count(distinct (x->>'step_no')::int) from jsonb_array_elements(v_steps) x)<>jsonb_array_length(v_steps) then raise exception 'Configure every instruction step exactly once'; end if;
    for v_step in select value from jsonb_array_elements(v_steps) loop
      if jsonb_typeof(v_step) is distinct from 'object' or jsonb_typeof(v_step->'step_no') is distinct from 'number' then raise exception 'Choose a valid step and evidence kind';end if;
      v_no:=(v_step->>'step_no')::int;
      if v_no is null or v_no not between 1 and jsonb_array_length(pv.steps) or coalesce(v_step->>'kind','') not in ('check','measurement','transaction') then raise exception 'Choose a valid step and evidence kind'; end if;
      if exists(select 1 from jsonb_object_keys(v_step) key where not key=any(case v_step->>'kind'
        when 'measurement' then array['step_no','kind','min','max','unit'] when 'transaction' then array['step_no','kind','source_type','states'] else array['step_no','kind'] end)) then raise exception 'Choose a valid step and evidence kind';end if;
      if v_step->>'kind'='measurement' then
        if jsonb_typeof(v_step->'min') is distinct from 'number' or jsonb_typeof(v_step->'max') is distinct from 'number' or jsonb_typeof(v_step->'unit') is distinct from 'string' then raise exception 'Measurements need valid limits and a unit';end if;
        if (v_step->>'min') is null or (v_step->>'max') is null or (v_step->>'min')::numeric > (v_step->>'max')::numeric or
          abs((v_step->>'min')::numeric)>1e9 or abs((v_step->>'max')::numeric)>1e9 or length(btrim(coalesce(v_step->>'unit',''))) not between 1 and 20 then raise exception 'Measurements need valid limits and a unit'; end if;
      elsif v_step->>'kind'='transaction' then
        if coalesce(v_step->>'source_type','') not in ('order','production_job','quality_inspection','dispatch','quote','invoice','breakdown_log') or jsonb_typeof(v_step->'states') is distinct from 'array' then raise exception 'Choose a supported transaction and accepted states'; end if;
        if jsonb_array_length(v_step->'states')=0 or exists(select 1 from jsonb_array_elements_text(v_step->'states') s where s is null or not s=any(private.task_source_states(v_step->>'source_type'))) then raise exception 'Choose valid accepted transaction states'; end if;
      end if;
    end loop;
    if not coalesce((p_payload->>'elevated_role')=any(v_allowed),false) or ((p_payload->>'normal_role') is not null and not (p_payload->>'normal_role')=any(v_allowed)) then raise exception 'Choose a verification role'; end if;
    if p.id is null then
      insert into public.sop_execution_plans(id,company_id,version_id,steps,normal_role,elevated_role,author_id,author_name)
      values((p_payload->>'id')::uuid,company,pv.id,v_steps,p_payload->>'normal_role',p_payload->>'elevated_role',actor,actor_name) returning * into p;
    else
      update public.sop_execution_plans set steps=v_steps,normal_role=p_payload->>'normal_role',elevated_role=p_payload->>'elevated_role',author_id=actor,author_name=actor_name,revision=revision+1 where id=p.id returning * into p;
    end if;
    return to_jsonb(p)-'company_id';
  end if;

  if p_command='review.queue' then
    v_no:=coalesce((p_payload->>'page')::int,1); if v_no not between 1 and 100000 then raise exception 'Invalid page'; end if;
    v_search:=lower(btrim(coalesce(p_payload->>'search','')));v_filter:=coalesce(p_payload->>'risk','all');v_sort:=coalesce(p_payload->>'sort','oldest');
    if length(v_search)>80 or v_filter not in ('all','normal','elevated') or v_sort not in ('oldest','newest','title') then raise exception 'Invalid guided procedure request';end if;
    with pending as (
      select sr.id,sr.task_id,tt.title,sr.performer_name,sr.submitted_at,sr.elevated or tt.priority in ('high','urgent') as elevated,
        case when sr.elevated or tt.priority in ('high','urgent') then ep.elevated_role else ep.normal_role end as required_role
      from public.sop_runs sr join public.tasks tt on tt.id=sr.task_id join public.sop_execution_plans ep on ep.id=sr.plan_id
      where sr.company_id=company and sr.status='review' and sr.performer_id<>actor and tt.status in ('open','in_progress')
    ), eligible as (select * from pending where (role_name=required_role or role_name in ('owner','admin')) and (v_filter='all' or elevated=(v_filter='elevated'))
      and (v_search='' or position(v_search in lower(title||' '||performer_name))>0))
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from eligible order by case when v_sort='title' then lower(title) end,case when v_sort='newest' then submitted_at end desc,submitted_at,id limit 10 offset (v_no-1)*10)x),'[]'::jsonb),
      'total_count',(select count(*) from eligible)) into v_view;
    return v_view;
  end if;
  select * into t from public.tasks where id=(p_payload->>'task_id')::uuid and company_id=company and dealership_id is null for update;
  if t.id is null then raise exception 'Task is unavailable'; end if;
  select * into r from public.sop_runs where task_id=t.id order by attempt desc limit 1 for update;
  if p_command='run.load' then return private.sop_run_view(t); end if;
  if p_command='run.start' then
    if not coalesce(t.assigned_to=actor,false) then raise exception 'Only the assigned employee can start guided work' using errcode='42501'; end if;
    if t.status not in ('open','in_progress') then raise exception 'This task is closed'; end if;
    -- The status trigger applies releases effective at start before choosing execution rules.
    if t.status='open' then
      update public.tasks set status='in_progress',updated_at=clock_timestamp() where id=t.id returning * into t;
    end if;
    if r.id is not null and r.performer_id=actor then return private.sop_run_view(t); end if;
    if r.id is not null then
      -- Reassignment starts a new attempt; the earlier employee's evidence and decisions stay intact.
      update public.sop_runs set status='superseded' where id=r.id;
    end if;
    select * into b from public.task_procedure_bindings where task_id=t.id;
    select * into p from public.sop_execution_plans where version_id=b.version_id and status='released';
    if p.id is null then raise exception 'This task has no reviewed execution plan'; end if;
    v_elevated:=coalesce(r.elevated,false) or t.priority in ('high','urgent');
    insert into public.sop_runs(company_id,task_id,plan_id,attempt,performer_id,performer_name,elevated,required_role)
    values(company,t.id,p.id,coalesce(r.attempt,0)+1,actor,actor_name,v_elevated,case when v_elevated then p.elevated_role else p.normal_role end) returning * into r;
    return private.sop_run_view(t);
  end if;
  if r.id is null then raise exception 'Start guided work first'; end if;
  if p_command in ('step.record','step.retry') then
    select * into e from public.sop_step_events where id=(p_payload->>'id')::uuid;
    if e.id is not null then
      if e.run_id=r.id and e.actor_id=actor and e.request_payload=p_payload then return private.sop_run_view(t); end if;
      raise exception 'This request reference was already used with different details';
    end if;
  end if;
  if r.revision is distinct from (p_payload->>'expected_revision')::int then raise exception 'The execution changed. Reload before continuing'; end if;
  if r.status='completed' then raise exception 'This execution is complete'; end if;
  select * into p from public.sop_execution_plans where id=r.plan_id;
  if p_command not in ('step.retry','run.verify','run.return') and (r.performer_id<>actor or t.assigned_to is distinct from actor) then raise exception 'Only the assigned performer can record this work' using errcode='42501'; end if;
  if t.status not in ('open','in_progress') then raise exception 'This task is closed'; end if;
  if t.status='open' then raise exception 'Start or resume guided work before recording evidence'; end if;
  if p_command in ('run.submit','run.verify','run.complete') then
    for e in select distinct on (source_type,source_id) * from public.sop_step_events where run_id=r.id and event='transaction' order by source_type,source_id,recorded_at desc loop
      perform private.lock_sop_source(company,e.source_type,e.source_id);
    end loop;
  end if;
  v_view:=private.sop_run_view(t);
  if p_command='run.return' then
    if r.status<>'review' then raise exception 'Only submitted work can be returned for correction'; end if;
    v_required:=case when r.elevated or t.priority in ('high','urgent') then p.elevated_role else p.normal_role end;
    if not coalesce((actor=r.performer_id and actor=t.assigned_to) or role_name=v_required or role_name in ('owner','admin'),false) then
      raise exception 'Only the performer or designated reviewer can return this work' using errcode='42501';
    end if;
    v_text:=btrim(coalesce(p_payload->>'note','')); if length(v_text) not between 3 and 500 then raise exception 'Explain the correction required'; end if;
    v_no:=coalesce((p_payload->>'step_no')::int,(v_view->>'next_step')::int,1);
    if v_no not between 1 and jsonb_array_length(p.steps) then raise exception 'Choose the first step to redo'; end if;
    -- A return invalidates the chosen step and its downstream steps without editing prior facts.
    for v_step in select value from jsonb_array_elements(p.steps) where (value->>'step_no')::int>=v_no loop
      insert into public.sop_step_events(id,company_id,run_id,step_no,event,note,outcome,actor_id,actor_name,request_payload)
        values(gen_random_uuid(),company,r.id,(v_step->>'step_no')::int,'retry',v_text,'retry',actor,actor_name,p_payload);
    end loop;
    insert into public.sop_verification_events(company_id,run_id,decision,evidence_revision,required_role,actor_id,actor_name,note)
      values(company,r.id,'returned',r.revision,v_required,actor,actor_name,v_text);
    update public.sop_runs set status='active',verified_by=null,verified_by_name=null,verification_note=null,verified_at=null,revision=revision+1 where id=r.id;
    return private.sop_run_view(t);
  end if;
  if p_command in ('step.record','step.retry') then
    v_id:=(p_payload->>'id')::uuid;
    select * into e from public.sop_step_events where id=v_id;
    if e.id is not null then
      if e.run_id=r.id and e.actor_id=actor and e.request_payload=p_payload then return private.sop_run_view(t); end if;
      raise exception 'This request reference was already used with different details';
    end if;
    if r.status<>'active' then raise exception 'Execution is waiting for verification'; end if;
    v_no:=(p_payload->>'step_no')::int;
    if v_no is distinct from (v_view->>'next_step')::int then raise exception 'Complete the current step before continuing'; end if;
    select value into v_step from jsonb_array_elements(p.steps) where (value->>'step_no')::int=v_no;
    select * into e from public.sop_step_events where run_id=r.id and step_no=v_no order by recorded_at desc,id desc limit 1;
    v_text:=btrim(coalesce(p_payload->>'note',''));
    if length(v_text) not between 3 and 500 then raise exception 'Record an observation of 3 to 500 characters'; end if;
    if p_command='step.retry' then
      if not coalesce(role_name=p.elevated_role or role_name in ('owner','admin'),false) or r.performer_id=actor then raise exception 'An independent authorized reviewer must route the retry' using errcode='42501'; end if;
      if e.outcome is distinct from 'review' then raise exception 'Only an out-of-range step can be routed for retry'; end if;
      insert into public.sop_step_events(id,company_id,run_id,step_no,event,note,outcome,actor_id,actor_name,request_payload) values(v_id,company,r.id,v_no,'retry',v_text,'retry',actor,actor_name,p_payload);
    else
      if e.outcome='review' then raise exception 'The measurement is outside the approved range. Obtain a rework decision'; end if;
      v_state:=null; v_value:=null;
      if v_step->>'kind'='measurement' then
        v_value:=(p_payload->>'value')::numeric;
        if v_value is null or abs(v_value)>1e9 or v_value::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter a finite measurement'; end if;
      elsif v_step->>'kind'='transaction' then
        v_state:=private.sop_evidence_state(t,v_step->>'source_type',(p_payload->>'source_id')::uuid,role_name);
        if v_state is null or not v_state in (select jsonb_array_elements_text(v_step->'states')) then raise exception 'The transaction is unavailable, unrelated or not in an accepted state'; end if;
      end if;
      insert into public.sop_step_events(id,company_id,run_id,step_no,event,value,note,outcome,source_type,source_id,source_state,actor_id,actor_name,request_payload)
      values(v_id,company,r.id,v_no,v_step->>'kind',v_value,v_text,case when v_value is not null and (v_value<(v_step->>'min')::numeric or v_value>(v_step->>'max')::numeric) then 'review' else 'done' end,
        case when v_step->>'kind'='transaction' then v_step->>'source_type' end,case when v_step->>'kind'='transaction' then (p_payload->>'source_id')::uuid end,v_state,actor,actor_name,p_payload);
      if v_value is not null and (v_value<(v_step->>'min')::numeric or v_value>(v_step->>'max')::numeric) then r.elevated:=true; end if;
    end if;
    update public.sop_runs set revision=revision+1,elevated=r.elevated,required_role=case when r.elevated or t.priority in ('high','urgent') then p.elevated_role else required_role end,
      verified_by=null,verified_by_name=null,verification_note=null,verified_at=null where id=r.id;
    return private.sop_run_view(t);
  end if;
  if (v_view->>'next_step') is not null then raise exception 'Complete every step with current evidence first'; end if;
  -- Risk is rechecked against the task at both submission and completion.
  v_elevated:=r.elevated or t.priority in ('high','urgent');
  v_required:=case when v_elevated then p.elevated_role else p.normal_role end;
  if p_command='run.submit' then
    if r.status<>'active' then raise exception 'Execution is already submitted'; end if;
    update public.sop_runs set status=case when v_required is null then 'active' else 'review' end,elevated=v_elevated,required_role=v_required,submitted_at=clock_timestamp(),revision=revision+1 where id=r.id;
  elsif p_command='run.verify' then
    if r.status<>'review' or v_required is null then raise exception 'This execution does not await verification'; end if;
    if r.performer_id=actor or not coalesce(role_name=v_required or role_name in ('owner','admin'),false) then raise exception 'Verification needs a different employee with the required role' using errcode='42501'; end if;
    v_text:=btrim(coalesce(p_payload->>'note','')); if length(v_text) not between 3 and 500 then raise exception 'Record the verification finding'; end if;
    insert into public.sop_verification_events(company_id,run_id,decision,evidence_revision,required_role,actor_id,actor_name,note)
      values(company,r.id,'verified',r.revision,v_required,actor,actor_name,v_text);
    update public.sop_runs set status='active',verified_by=actor,verified_by_name=actor_name,verification_note=v_text,verified_at=clock_timestamp(),elevated=v_elevated,required_role=v_required,revision=revision+1 where id=r.id;
  elsif p_command='run.complete' then
    if v_required is not null and (r.verified_by is null or r.required_role is distinct from v_required) then raise exception 'Independent verification is required for this risk level'; end if;
    if r.status<>'active' then raise exception 'Execution is waiting for verification'; end if;
    update public.sop_runs set status='completed',completed_at=clock_timestamp(),revision=revision+1 where id=r.id;
    update public.tasks set status='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=t.id;
  end if;
  return private.sop_run_view(t);
exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation then raise exception 'Invalid guided procedure request';
end $$;

revoke all on function private.guard_sop_plan(),private.keep_sop_event(),private.sop_evidence_state(public.tasks,text,uuid,text),private.sop_run_view(public.tasks),private.guard_sop_completion() from public,anon,authenticated;
revoke all on function private.lock_sop_source(uuid,text,uuid) from public,anon,authenticated;
revoke all on function private.sop_source_choices(public.tasks,text,text[]) from public,anon,authenticated;
revoke all on function public.guided_sop_command(text,jsonb) from public,anon;
grant execute on function public.guided_sop_command(text,jsonb) to authenticated;
commit;
