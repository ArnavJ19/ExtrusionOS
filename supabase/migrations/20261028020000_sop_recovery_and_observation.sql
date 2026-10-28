-- Features 78 and 79: numbered continuity notes reconciled against real transactions;
-- observed employee trials tied to the exact SOP version and actual task execution.
begin;
create table public.sop_continuity_policies (
  company_id uuid not null references public.companies(id), task_kind text not null,
  permitted_work text not null check(length(btrim(permitted_work)) between 3 and 500),
  prohibited_work text not null check(length(btrim(prohibited_work)) between 3 and 500),
  reconcile_role text not null check(reconcile_role in ('factory_manager','production_manager','quality','dispatch_manager','inventory_manager','accounts')),
  revision integer not null default 1, updated_by uuid not null references public.app_users(id),
  primary key(company_id,task_kind), check(task_kind ~ '^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$')
);
create table public.sop_recovery_notes (
  id uuid primary key,company_id uuid not null references public.companies(id),reference text not null,
  task_id uuid not null references public.tasks(id),policy_snapshot jsonb not null,observation text not null check(length(btrim(observation)) between 3 and 1000),
  observed_at timestamptz not null,recorded_by uuid not null references public.app_users(id),recorded_by_name text not null,recorded_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check(status in ('pending','reconciled','rejected')),source_type text,source_id uuid,source_state text,
  decided_by uuid references public.app_users(id),decided_by_name text,decision_note text,decided_at timestamptz,request_payload jsonb not null,
  unique(company_id,reference),check(reference ~ '^[A-Z0-9][A-Z0-9/-]{2,39}$'),check(decided_by is null or decided_by<>recorded_by)
);
create index sop_recovery_company_idx on public.sop_recovery_notes(company_id,status,recorded_at desc);
create index sop_recovery_task_idx on public.sop_recovery_notes(task_id);
-- One authoritative transaction cannot be reconciled twice, even under two paper references.
create unique index sop_recovery_transaction_key on public.sop_recovery_notes(company_id,source_type,source_id) where status='reconciled';
create table public.sop_observed_trials (
  id uuid primary key,company_id uuid not null references public.companies(id),task_id uuid not null references public.tasks(id),
  version_id uuid not null references public.procedure_versions(id),run_id uuid not null references public.sop_runs(id),
  observer_id uuid not null references public.app_users(id),observer_name text not null,employee_id uuid not null references public.app_users(id),employee_name text not null,
  status text not null default 'observing' check(status in ('observing','submitted','reviewed')),
  findings jsonb,employee_feedback text,observed_at timestamptz not null default clock_timestamp(),submitted_at timestamptz,
  reviewer_id uuid references public.app_users(id),reviewer_name text,decision text check(decision in ('retain','revise','training')),
  decision_note text,reviewed_at timestamptz,revision integer not null default 1,
  improvement_id uuid references public.procedure_improvements(id),
  check(observer_id<>employee_id),check(reviewer_id is null or reviewer_id not in (observer_id,employee_id))
);
create index sop_trials_company_idx on public.sop_observed_trials(company_id,status,observed_at desc);
create index sop_trials_task_idx on public.sop_observed_trials(task_id);
create unique index sop_trials_active on public.sop_observed_trials(task_id,observer_id) where status<>'reviewed';

alter table public.sop_continuity_policies enable row level security;
alter table public.sop_recovery_notes enable row level security;
alter table public.sop_observed_trials enable row level security;
revoke all on public.sop_continuity_policies,public.sop_recovery_notes,public.sop_observed_trials from public,anon,authenticated;
create policy continuity_company on public.sop_continuity_policies for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy recovery_company on public.sop_recovery_notes for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy trials_company on public.sop_observed_trials for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create function private.guard_sop_recovery_history() returns trigger language plpgsql set search_path=public,private as $$
begin
  if tg_op='DELETE' then raise exception 'Recovery notes are kept as history'; end if;
  if old.status<>'pending' or (to_jsonb(new)-array['status','source_type','source_id','source_state','decided_by','decided_by_name','decision_note','decided_at']) is distinct from
    (to_jsonb(old)-array['status','source_type','source_id','source_state','decided_by','decided_by_name','decision_note','decided_at']) then raise exception 'Recorded recovery observations cannot be rewritten'; end if;
  return new;
end $$;
create trigger a_guard_sop_recovery before update or delete on public.sop_recovery_notes for each row execute function private.guard_sop_recovery_history();
create function private.guard_observed_trial() returns trigger language plpgsql set search_path=public,private as $$
begin
  if tg_op='DELETE' then raise exception 'Observed trials are kept as history'; end if;
  if old.status='reviewed' or (new.task_id,new.version_id,new.run_id,new.company_id,new.observer_id,new.employee_id) is distinct from (old.task_id,old.version_id,old.run_id,old.company_id,old.observer_id,old.employee_id)
    or (old.status='submitted' and (new.findings,new.employee_feedback) is distinct from (old.findings,old.employee_feedback)) then raise exception 'Observed work and findings cannot be rewritten'; end if;
  return new;
end $$;
create trigger a_guard_observed_trial before update or delete on public.sop_observed_trials for each row execute function private.guard_observed_trial();

create function public.sop_assurance_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare actor uuid:=auth.uid();company uuid:=private.get_current_user_company_id();role_name text:=private.get_current_user_role();actor_name text;manager boolean;
  t public.tasks;p public.sop_continuity_policies;n public.sop_recovery_notes;o public.sop_observed_trials;r public.sop_runs;v public.procedure_versions;op public.operating_procedures;
  v_id uuid;v_ref text;v_note text;v_state text;v_step jsonb;v_count integer;v_page int;v_rows jsonb;v_total int;
begin
  if actor is null or company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select coalesce(nullif(full_name,''),'Employee') into actor_name from public.app_users where id=actor and company_id=company and role=role_name and is_active and dealer_id is null;
  manager:=role_name in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager','inventory_manager');
  if actor_name is null or role_name in ('dealer_admin','dealer_staff') or jsonb_typeof(p_payload) is distinct from 'object' or p_command is null or p_command not in ('policy.load','policy.save','recovery.record','recovery.decide','recovery.list','trial.start','trial.submit','trial.review','trial.list')
    or (role_name='viewer' and p_command not in ('policy.load','recovery.list','trial.list')) then raise exception 'Action not permitted' using errcode='42501'; end if;
  if p_command in ('recovery.list','trial.list') then
    v_page:=coalesce((p_payload->>'page')::int,1);if v_page not between 1 and 100000 then raise exception 'Invalid page';end if;
    if p_command='recovery.list' then
      select count(*) into v_total from public.sop_recovery_notes x where x.company_id=company and (x.recorded_by=actor or manager or role_name=(x.policy_snapshot->>'reconcile_role')) and (nullif(p_payload->>'task_id','') is null or x.task_id=(p_payload->>'task_id')::uuid);
      select coalesce(jsonb_agg(to_jsonb(x)-'company_id'-'request_payload'),'[]'::jsonb) into v_rows from (select * from public.sop_recovery_notes x where x.company_id=company and (x.recorded_by=actor or manager or role_name=(x.policy_snapshot->>'reconcile_role')) and (nullif(p_payload->>'task_id','') is null or x.task_id=(p_payload->>'task_id')::uuid) order by recorded_at desc,id limit 10 offset (v_page-1)*10)x;
    else
      select count(*) into v_total from public.sop_observed_trials x join public.procedure_versions pv on pv.id=x.version_id join public.operating_procedures pr on pr.id=pv.procedure_id
        where x.company_id=company and (manager or x.employee_id=actor or x.observer_id=actor or actor in (pr.owner_id,pr.backup_id)) and (nullif(p_payload->>'task_id','') is null or x.task_id=(p_payload->>'task_id')::uuid);
      select coalesce(jsonb_agg(to_jsonb(x)-'company_id'),'[]'::jsonb) into v_rows from (select x.*,pv.procedure_id,coalesce(role_name in ('owner','admin') or actor in (pr.owner_id,pr.backup_id),false) as can_review
        from public.sop_observed_trials x join public.procedure_versions pv on pv.id=x.version_id join public.operating_procedures pr on pr.id=pv.procedure_id
        where x.company_id=company and (manager or x.employee_id=actor or x.observer_id=actor or actor in (pr.owner_id,pr.backup_id)) and (nullif(p_payload->>'task_id','') is null or x.task_id=(p_payload->>'task_id')::uuid) order by x.observed_at desc,x.id limit 10 offset (v_page-1)*10)x;
    end if;
    return jsonb_build_object('rows',v_rows,'total_count',v_total);
  end if;
  if p_command='policy.save' then
    if role_name not in ('owner','admin','factory_manager') then raise exception 'Only administrators can set continuity rules' using errcode='42501';end if;
    select * into p from public.sop_continuity_policies where company_id=company and task_kind=p_payload->>'task_kind' for update;
    if p.company_id is not null and p.revision is distinct from (p_payload->>'expected_revision')::int then raise exception 'The continuity policy changed. Reload it';end if;
    insert into public.sop_continuity_policies(company_id,task_kind,permitted_work,prohibited_work,reconcile_role,updated_by)
      values(company,p_payload->>'task_kind',btrim(p_payload->>'permitted_work'),btrim(p_payload->>'prohibited_work'),p_payload->>'reconcile_role',actor)
      on conflict(company_id,task_kind) do update set permitted_work=excluded.permitted_work,prohibited_work=excluded.prohibited_work,reconcile_role=excluded.reconcile_role,updated_by=actor,revision=sop_continuity_policies.revision+1 returning * into p;
    return to_jsonb(p)-'company_id';
  end if;
  if p_command='recovery.decide' then
    select * into n from public.sop_recovery_notes where id=(p_payload->>'id')::uuid and company_id=company for update;
    if n.id is null then raise exception 'Recovery note is unavailable';end if;
    if actor=n.recorded_by or not (role_name=n.policy_snapshot->>'reconcile_role' or role_name in ('owner','admin')) then raise exception 'An independent reconciler with the designated role must decide' using errcode='42501';end if;
    if n.status<>'pending' then raise exception 'This recovery note already has a decision';end if;
    v_note:=btrim(coalesce(p_payload->>'note',''));if length(v_note) not between 3 and 500 then raise exception 'Explain the recovery decision';end if;
    select * into t from public.tasks where id=n.task_id and company_id=company for update;
    if p_payload->>'decision'='reconcile' then
      perform private.lock_sop_source(company,p_payload->>'source_type',(p_payload->>'source_id')::uuid);
      v_state:=private.sop_evidence_state(t,p_payload->>'source_type',(p_payload->>'source_id')::uuid,role_name);
      if v_state is null or v_state not in ('completed','approved','delivered','paid','closed','resolved') then raise exception 'Link the related confirmed transaction before reconciliation';end if;
      begin
        update public.sop_recovery_notes set status='reconciled',source_type=p_payload->>'source_type',source_id=(p_payload->>'source_id')::uuid,source_state=v_state,
          decided_by=actor,decided_by_name=actor_name,decision_note=v_note,decided_at=clock_timestamp() where id=n.id;
      exception when unique_violation then raise exception 'That confirmed transaction has already reconciled another temporary reference';end;
    elsif p_payload->>'decision'='reject' then
      update public.sop_recovery_notes set status='rejected',decided_by=actor,decided_by_name=actor_name,decision_note=v_note,decided_at=clock_timestamp() where id=n.id;
    else raise exception 'Choose reconcile or reject';end if;
    return jsonb_build_object('id',n.id,'status',case when p_payload->>'decision'='reconcile' then 'reconciled' else 'rejected' end);
  end if;
  if p_command in ('trial.submit','trial.review') then
    select * into o from public.sop_observed_trials where id=(p_payload->>'id')::uuid and company_id=company for update;
    if o.id is null then raise exception 'Observed trial is unavailable';end if;
    if o.revision is distinct from (p_payload->>'expected_revision')::int then raise exception 'This observed trial changed. Reload it';end if;
    select * into v from public.procedure_versions where id=o.version_id;
    if p_command='trial.submit' then
      if o.observer_id<>actor or o.status<>'observing' then raise exception 'Only the observer can submit an open trial' using errcode='42501';end if;
      if jsonb_typeof(p_payload->'findings') is distinct from 'array' then raise exception 'Record findings for every observed step';end if;
      if jsonb_array_length(p_payload->'findings')<>jsonb_array_length(v.steps) or (select count(distinct (x->>'step_no')::int) from jsonb_array_elements(p_payload->'findings') x)<>jsonb_array_length(v.steps) then raise exception 'Record each step exactly once';end if;
      for v_step in select value from jsonb_array_elements(p_payload->'findings') loop
        if not coalesce((v_step->>'step_no')::int between 1 and jsonb_array_length(v.steps),false) or coalesce(v_step->>'result','') not in ('followed','unclear','workaround','blocked') or length(btrim(coalesce(v_step->>'note',''))) not between 3 and 500 then raise exception 'Each step needs a result and observed evidence';end if;
      end loop;
      if length(btrim(coalesce(p_payload->>'employee_feedback',''))) not between 3 and 1000 then raise exception 'Record the employee feedback';end if;
      update public.sop_observed_trials set status='submitted',findings=p_payload->'findings',employee_feedback=btrim(p_payload->>'employee_feedback'),submitted_at=clock_timestamp(),revision=revision+1 where id=o.id returning * into o;
    else
      select * into op from public.operating_procedures where id=v.procedure_id;
      if actor in (o.observer_id,o.employee_id) or not coalesce(role_name in ('owner','admin') or actor in (op.owner_id,op.backup_id),false) then raise exception 'An independent process owner or administrator must review the trial' using errcode='42501';end if;
      if o.status<>'submitted' then raise exception 'Submit the trial findings before review';end if;
      if coalesce(p_payload->>'decision','') not in ('retain','revise','training') or length(btrim(coalesce(p_payload->>'note',''))) not between 3 and 500 then raise exception 'Record a review decision and reason';end if;
      if p_payload->>'decision'='revise' then
        v_id:=gen_random_uuid();
        insert into public.procedure_improvements(id,company_id,procedure_id,title,problem_summary,baseline_version_id,proposed_by,proposed_by_name)
          values(v_id,company,v.procedure_id,left('Observed work: '||op.title,120),left(o.employee_feedback||E'\nReview: '||btrim(p_payload->>'note'),800),v.id,actor,actor_name);
      end if;
      update public.sop_observed_trials set status='reviewed',reviewer_id=actor,reviewer_name=actor_name,decision=p_payload->>'decision',decision_note=btrim(p_payload->>'note'),reviewed_at=clock_timestamp(),revision=revision+1,improvement_id=v_id where id=o.id returning * into o;
    end if;
    return to_jsonb(o)-'company_id';
  end if;
  select * into t from public.tasks where id=(p_payload->>'task_id')::uuid and company_id=company and dealership_id is null for update;
  if t.id is null then raise exception 'Task is unavailable';end if;
  if p_command='trial.start' then
    if not manager then raise exception 'A supervisor must observe the trial' using errcode='42501';end if;
    select * into r from public.sop_runs where task_id=t.id order by attempt desc limit 1;
    if r.id is null or r.status='completed' or t.status<>'in_progress' then raise exception 'Observe an active guided execution';end if;
    if actor=r.performer_id then raise exception 'Observe another employee';end if;
    select * into o from public.sop_observed_trials where id=(p_payload->>'id')::uuid;
    if o.id is not null then
      if o.task_id=t.id and o.observer_id=actor then return to_jsonb(o)-'company_id';end if;
      raise exception 'This observation reference is already used';
    end if;
    insert into public.sop_observed_trials(id,company_id,task_id,version_id,run_id,observer_id,observer_name,employee_id,employee_name)
      select (p_payload->>'id')::uuid,company,t.id,ep.version_id,r.id,actor,actor_name,r.performer_id,r.performer_name from public.sop_execution_plans ep where ep.id=r.plan_id returning * into o;
    return to_jsonb(o)-'company_id';
  end if;
  select * into p from public.sop_continuity_policies where company_id=company and task_kind=any(private.task_kinds_of(t.task_type,t.handoff_team)) order by task_kind limit 1;
  if p_command='policy.load' then return jsonb_build_object('policy',case when p.company_id is not null then to_jsonb(p)-'company_id' end);end if;
  if p.company_id is null then raise exception 'No approved continuity procedure exists for this task kind';end if;
  if not coalesce(t.assigned_to=actor or manager,false) then raise exception 'Record recovery observations for your own work' using errcode='42501';end if;
  v_id:=(p_payload->>'id')::uuid;v_ref:=upper(btrim(p_payload->>'reference'));
  select * into n from public.sop_recovery_notes where company_id=company and (id=v_id or reference=v_ref);
  if n.id is not null then
    if n.recorded_by=actor and n.request_payload=p_payload then return jsonb_build_object('id',n.id,'status',n.status);end if;
    raise exception 'This temporary reference already exists. Review it before recording again';
  end if;
  if (p_payload->>'observed_at')::timestamptz > now()+interval '5 minutes' or (p_payload->>'observed_at')::timestamptz < t.created_at-interval '1 day' then raise exception 'Use the actual observation time within this task history';end if;
  insert into public.sop_recovery_notes(id,company_id,reference,task_id,policy_snapshot,observation,observed_at,recorded_by,recorded_by_name,request_payload)
    values(v_id,company,v_ref,t.id,to_jsonb(p)-'company_id',btrim(p_payload->>'observation'),(p_payload->>'observed_at')::timestamptz,actor,actor_name,p_payload);
  return jsonb_build_object('id',v_id,'status','pending');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or not_null_violation then raise exception 'Invalid assurance request';
end $$;
revoke all on function private.guard_sop_recovery_history(),private.guard_observed_trial() from public,anon,authenticated;
revoke all on function public.sop_assurance_command(text,jsonb) from public,anon;
grant execute on function public.sop_assurance_command(text,jsonb) to authenticated;
commit;
