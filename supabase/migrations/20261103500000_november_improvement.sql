-- November batch 7: die operating history and service thresholds (NOV-025), recurring problems with
-- an accountable improvement owner (NOV-053), team outcome measures with context (NOV-054), the
-- employee improvement channel (NOV-059), and lineage for repeated records (NOV-009). Consequential
-- actions use the reviewed request protocol of batches 3 to 6. Additive; depends only on the batch 5
-- helper functions (private.assurance_text/number/date), which are present on hosted.

------------------------------------------------------------------------------------------------
-- Tenant keys and lookup indexes.
------------------------------------------------------------------------------------------------
create unique index if not exists coordination_user_tenant_key on public.app_users(company_id,id);
create unique index if not exists lifecycle_die_tenant_key on public.dies(company_id,id);
create unique index if not exists improvement_procedure_improvement_tenant_key on public.procedure_improvements(company_id,id);
create index if not exists improvement_job_die_idx on public.production_jobs(company_id,die_id,status) where die_id is not null;
create index if not exists improvement_inspection_job_idx on public.quality_inspections(company_id,production_job_id);
create index if not exists improvement_die_corrections_idx on public.die_corrections(company_id,die_id,correction_date);
create index if not exists improvement_die_nitriding_idx on public.die_nitriding_history(company_id,die_id,nitriding_date);
create index if not exists improvement_die_trials_idx on public.die_trials(company_id,die_id,trial_date);
create index if not exists improvement_location_history_idx on public.operator_location_history(company_id,entity_type,entity_id,recorded_at desc);
create index if not exists improvement_task_completed_idx on public.tasks(company_id,completed_at) where status='completed';

------------------------------------------------------------------------------------------------
-- NOV-025: die status decisions are retained from now on; moves are already recorded in
-- operator_location_history. Service thresholds are reviewed by a second person and only warn.
------------------------------------------------------------------------------------------------
create table public.die_status_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  die_id uuid not null, previous_status text, new_status text, changed_by uuid, changed_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,die_id) references public.dies(company_id,id)
);
create index die_status_events_die_idx on public.die_status_events(company_id,die_id,changed_at desc);

create function private.record_die_status_event() returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if new.die_status is distinct from old.die_status then
    insert into public.die_status_events(company_id,die_id,previous_status,new_status,changed_by) values(new.company_id,new.id,old.die_status,new.die_status,auth.uid());
  end if;
  return null;
end $$;
revoke all on function private.record_die_status_event() from public,anon,authenticated;
create trigger zz_record_die_status_event after update of die_status on public.dies for each row execute function private.record_die_status_event();

create table public.die_service_thresholds (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  die_type text check(die_type is null or die_type in ('solid','hollow','semi_hollow','porthole','bridge','feeder','multi_cavity','flat','special')),
  basis text not null check(basis in ('kg_since_service','runs_since_service','days_since_service')),
  service_event text not null check(service_event in ('nitriding','correction','any')),
  warn_at numeric not null check(warn_at>0 and warn_at<=100000000),
  rationale text not null check(length(btrim(rationale)) between 5 and 500),
  status text not null default 'proposed' check(status in ('proposed','approved','retired')),
  proposed_by uuid not null, proposed_at timestamptz not null default clock_timestamp(), approved_by uuid, approved_at timestamptz, retired_by uuid, retired_at timestamptz,
  unique(company_id,id), foreign key(company_id,proposed_by) references public.app_users(company_id,id), foreign key(company_id,approved_by) references public.app_users(company_id,id),
  check(status<>'approved' or approved_at is not null), check(status<>'proposed' or approved_at is null), check(approved_by is null or approved_by<>proposed_by), check((status='retired')=(retired_at is not null))
);
create unique index die_service_thresholds_one_approved on public.die_service_thresholds(company_id,coalesce(die_type,'*'),basis,service_event) where status='approved';

------------------------------------------------------------------------------------------------
-- NOV-053: a recurring problem keeps its individual occurrences as links to the source records.
------------------------------------------------------------------------------------------------
create table public.improvement_problems (
  id uuid primary key, company_id uuid not null references public.companies(id),
  title text not null check(length(btrim(title)) between 5 and 120),
  category text not null check(category in ('packing','dimensional','surface','dispatch','documentation','process','equipment','material','other')),
  description text not null check(length(btrim(description)) between 5 and 1000),
  containment text check(containment is null or length(btrim(containment)) between 5 and 500),
  owner_id uuid not null, status text not null default 'open' check(status in ('open','investigating','planned','trial','closed')),
  cause text check(cause is null or length(btrim(cause)) between 5 and 800), cause_basis text check(cause_basis in ('observation','established')),
  cause_evidence text check(cause_evidence is null or length(btrim(cause_evidence)) between 5 and 500),
  proposed_action text check(proposed_action is null or length(btrim(proposed_action)) between 5 and 800),
  trial_scope text check(trial_scope is null or length(btrim(trial_scope)) between 5 and 300), review_date date,
  denominator text check(denominator in ('dispatches','production_jobs','inspections','tasks')), procedure_improvement_id uuid,
  trial_started_at timestamptz, outcome jsonb, closed_at timestamptz, closed_by uuid, reopened_count integer not null default 0,
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(company_id,id), foreign key(company_id,owner_id) references public.app_users(company_id,id), foreign key(company_id,created_by) references public.app_users(company_id,id),
  foreign key(company_id,procedure_improvement_id) references public.procedure_improvements(company_id,id),
  check((cause is null)=(cause_basis is null)), check((status='closed')=(closed_at is not null)), check(status not in ('trial','closed') or trial_started_at is not null),
  check(status not in ('planned','trial','closed') or (proposed_action is not null and trial_scope is not null and review_date is not null and denominator is not null))
);
create index improvement_problems_status_idx on public.improvement_problems(company_id,status,review_date);
create table public.improvement_problem_links (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), problem_id uuid not null,
  source_type text not null check(source_type in ('quality_inspection','production_exception','task_exception','delivery_disposition','return_authorization','support_ticket','procedure_step_flag')),
  source_id uuid not null, occurred_at timestamptz not null, label text not null, linked_by uuid not null, linked_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz, removed_by uuid, removed_reason text,
  foreign key(company_id,problem_id) references public.improvement_problems(company_id,id), check((removed_at is null)=(removed_reason is null))
);
-- One occurrence belongs to one problem at a time; a wrongly linked occurrence is removed with a reason.
create unique index improvement_problem_links_one on public.improvement_problem_links(company_id,source_type,source_id) where removed_at is null;
create index improvement_problem_links_problem_idx on public.improvement_problem_links(company_id,problem_id,occurred_at);

------------------------------------------------------------------------------------------------
-- NOV-059: suggestions from the screen where the friction happened, routed to a process owner.
------------------------------------------------------------------------------------------------
create table public.improvement_suggestion_routes (
  company_id uuid not null references public.companies(id),
  category text not null check(category in ('unnecessary_entry','confusing_instruction','repeated_lookup','avoidable_waiting','other')),
  owner_id uuid not null, updated_by uuid not null, updated_at timestamptz not null default clock_timestamp(), primary key(company_id,category),
  foreign key(company_id,owner_id) references public.app_users(company_id,id)
);
create table public.improvement_suggestions (
  id uuid primary key, company_id uuid not null references public.companies(id), reference text not null,
  category text not null check(category in ('unnecessary_entry','confusing_instruction','repeated_lookup','avoidable_waiting','other')),
  source_path text not null check(source_path ~ '^/[A-Za-z0-9/_.-]{0,200}$' and source_path !~ '(//|\.\.)'),
  description text not null check(length(btrim(description)) between 10 and 1000),
  evidence text check(evidence is null or length(btrim(evidence)) between 5 and 500),
  contributor_id uuid not null, owner_id uuid not null,
  status text not null default 'submitted' check(status in ('submitted','acknowledged','clarification','trial','adopted','declined','resolved','merged')),
  response text check(response is null or length(btrim(response)) between 5 and 800), decline_reason text check(decline_reason is null or length(btrim(decline_reason)) between 5 and 500),
  clarification text check(clarification is null or length(btrim(clarification)) between 5 and 800), internal_note text check(internal_note is null or length(btrim(internal_note)) between 5 and 800),
  merged_into_id uuid, problem_id uuid, procedure_improvement_id uuid,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), responded_at timestamptz,
  unique(company_id,id), unique(company_id,reference),
  foreign key(company_id,contributor_id) references public.app_users(company_id,id), foreign key(company_id,owner_id) references public.app_users(company_id,id),
  foreign key(company_id,merged_into_id) references public.improvement_suggestions(company_id,id), foreign key(company_id,problem_id) references public.improvement_problems(company_id,id),
  foreign key(company_id,procedure_improvement_id) references public.procedure_improvements(company_id,id),
  check((status='declined')=(decline_reason is not null)), check((status='merged')=(merged_into_id is not null)), check(merged_into_id is null or merged_into_id<>id)
);
create index improvement_suggestions_owner_idx on public.improvement_suggestions(company_id,owner_id,status);
create index improvement_suggestions_contributor_idx on public.improvement_suggestions(company_id,contributor_id,created_at desc);

------------------------------------------------------------------------------------------------
-- NOV-054: versioned metric definitions (shared reference, no tenant data).
------------------------------------------------------------------------------------------------
create table public.outcome_metric_versions (
  metric_key text not null, version integer not null check(version>0), definition jsonb not null, effective_from date not null,
  primary key(metric_key,version)
);
insert into public.outcome_metric_versions(metric_key,version,effective_from,definition) values
('quality_first_time_acceptance',1,date '2026-11-05',jsonb_build_object('team','quality','title','First-time quality acceptance','unit','percent','direction','higher',
  'numerator','Production jobs whose first inspection was approved','denominator','Production jobs whose first inspection was recorded in the period',
  'time_basis','Date of the first inspection (IST)','exclusions','Pending inspections; inspections of finishing receipts','owner','Quality','source','Quality inspections')),
('quality_rework_share',1,date '2026-11-05',jsonb_build_object('team','quality','title','Inspections needing rework or rejection','unit','percent','direction','lower',
  'numerator','Inspections recorded as rework or rejected','denominator','Inspections with a decision in the period',
  'time_basis','Inspection date (IST)','exclusions','Pending inspections','owner','Quality','source','Quality inspections')),
('production_missing_evidence',1,date '2026-11-05',jsonb_build_object('team','production','title','Completed jobs without output or inspection evidence','unit','percent','direction','lower',
  'numerator','Completed jobs with no recorded output kg or no quality inspection','denominator','Jobs completed in the period',
  'time_basis','Job completion time (IST)','exclusions','Cancelled jobs','owner','Production','source','Production jobs and quality inspections')),
('dispatch_on_time',1,date '2026-11-05',jsonb_build_object('team','dispatch','title','Dispatches leaving by the expected date','unit','percent','direction','higher',
  'numerator','Departed dispatches that left on or before the order expected dispatch date','denominator','Departed dispatches whose order has an expected date',
  'time_basis','Actual departure (IST); dispatch date when departure time is not recorded','exclusions','Dispatches whose order has no expected date are counted as missing evidence','owner','Dispatch','source','Dispatches and orders')),
('task_within_target',1,date '2026-11-05',jsonb_build_object('team','tasks','title','Tasks completed within their turnaround target','unit','percent','direction','higher',
  'numerator','Completed tasks finished within the active completion target for their kind','denominator','Completed tasks with an active target',
  'time_basis','Task completion time (IST)','exclusions','Tasks without a target are counted as missing evidence','owner','Department heads','source','Tasks and turnaround targets')),
('task_unrecorded_time',1,date '2026-11-05',jsonb_build_object('team','tasks','title','Task time with no recorded activity or waiting','unit','percent','direction','lower',
  'numerator','Elapsed hours not covered by recorded active work or recorded waiting','denominator','Elapsed hours from creation to completion',
  'time_basis','Task completion time (IST)','exclusions','Open tasks','owner','Department heads','source','Tasks, start marks and recorded waits')),
('tasks_overdue_now',1,date '2026-11-05',jsonb_build_object('team','tasks','title','Open tasks past their due date (as of now)','unit','percent','direction','lower',
  'numerator','Open or in-progress tasks due before today','denominator','Open or in-progress tasks with a due date',
  'time_basis','Current position, not a period','exclusions','Tasks without a due date are counted as missing evidence','owner','Department heads','source','Tasks'));
alter table public.outcome_metric_versions enable row level security;
revoke all on public.outcome_metric_versions from public,anon,authenticated;
grant select on public.outcome_metric_versions to authenticated;
create policy outcome_metric_versions_read on public.outcome_metric_versions for select to authenticated using (private.get_current_user_dealer_id() is null);

------------------------------------------------------------------------------------------------
-- NOV-009: a repeated record keeps a lineage link to the record it was started from.
------------------------------------------------------------------------------------------------
create table public.record_repeat_links (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  resource text not null check(resource in ('production_jobs','dispatches','packaging_material_purchases')),
  source_id uuid not null, target_id uuid not null, copied_fields text[] not null, created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
  unique(company_id,resource,target_id), check(source_id<>target_id), foreign key(company_id,created_by) references public.app_users(company_id,id)
);
create index record_repeat_links_source_idx on public.record_repeat_links(company_id,resource,source_id);

------------------------------------------------------------------------------------------------
-- Shared request identity, history and role matrix.
------------------------------------------------------------------------------------------------
create table public.improvement_requests (
  request_id uuid primary key, company_id uuid not null references public.companies(id), actor_id uuid not null,
  mutation jsonb not null, fingerprint text not null, review jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','confirmed','rejected','abandoned')),
  result jsonb, expires_at timestamptz not null default now()+interval '15 minutes', created_at timestamptz not null default now(),
  foreign key(company_id,actor_id) references public.app_users(company_id,id), check((state='prepared')=(result is null))
);
create index improvement_requests_actor_idx on public.improvement_requests(company_id,actor_id,created_at desc);
create table public.improvement_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  view_name text not null, entity_id uuid not null, action text not null, actor_id uuid, actor_name text not null,
  note text not null, facts jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create index improvement_events_entity_idx on public.improvement_events(company_id,view_name,entity_id,recorded_at desc,id);

create function private.improvement_view(p_action text) returns text language sql immutable set search_path=public,private as $$
  select case split_part(p_action,'.',1) when 'problem' then 'problems' when 'suggestion' then 'suggestions' when 'route' then 'suggestions' when 'threshold' then 'thresholds' end
$$;
create function private.improvement_read_allowed(p_role text,p_view text) returns boolean language sql immutable set search_path=public,private as $$
  select coalesce(case
    when p_role not in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer') then false
    when p_view is null or p_view='suggestions' then true
    when p_view in ('problems','outcomes') then p_role in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager','inventory_manager','sales_manager','accounts','viewer')
    when p_view in ('dies','thresholds') then p_role in ('owner','admin','factory_manager','production_manager','production','quality','viewer')
    else false end,false)
$$;
create function private.improvement_action_allowed(p_role text,p_action text) returns boolean language sql immutable set search_path=public,private as $$
  select private.improvement_view(p_action) is not null and private.improvement_read_allowed(p_role,private.improvement_view(p_action)) and p_role<>'viewer' and coalesce(case
    when p_action in ('problem.open','problem.link','problem.unlink','problem.investigate','problem.plan','problem.trial','problem.cancel_trial','problem.review')
      then p_role in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager','inventory_manager','sales_manager')
    when p_action in ('problem.reopen','problem.reassign') then p_role in ('owner','admin','factory_manager','quality')
    when p_action in ('suggestion.submit','suggestion.clarify') then true
    when p_action in ('suggestion.respond','suggestion.merge','suggestion.link','suggestion.reassign')
      then p_role in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager','inventory_manager','sales_manager','accounts')
    when p_action='route.set' then p_role in ('owner','admin')
    when p_action in ('threshold.propose','threshold.approve') then p_role in ('owner','admin','factory_manager','production_manager','quality')
    when p_action='threshold.retire' then p_role in ('owner','admin','factory_manager','quality')
    else false end,false)
$$;
revoke all on function private.improvement_view(text),private.improvement_read_allowed(text,text),private.improvement_action_allowed(text,text) from public,anon;
grant execute on function private.improvement_view(text),private.improvement_read_allowed(text,text),private.improvement_action_allowed(text,text) to authenticated;

do $$ declare t text; v text; begin
  for t,v in select * from (values ('die_status_events','dies'),('die_service_thresholds','thresholds'),('improvement_problems','problems'),('improvement_problem_links','problems'),
    ('improvement_suggestion_routes','suggestions')) x(t,v) loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy improvement_tenant_read on public.%I for select to authenticated using (company_id=private.get_current_user_company_id() and private.get_current_user_dealer_id() is null and private.improvement_read_allowed(private.get_current_user_role(),%L))',t,v);
  end loop;
end $$;
-- Suggestions can hold confidential notes; contributors read their own, owners their assigned ones,
-- and managers all of them. Internal notes are projected only through the authorized detail command.
alter table public.improvement_suggestions enable row level security;
revoke all on public.improvement_suggestions from public,anon,authenticated;
alter table public.record_repeat_links enable row level security;
revoke all on public.record_repeat_links from public,anon,authenticated;
grant select on public.record_repeat_links to authenticated;
create policy record_repeat_links_tenant_read on public.record_repeat_links for select to authenticated using (company_id=private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
alter table public.improvement_requests enable row level security;
alter table public.improvement_events enable row level security;
revoke all on public.improvement_requests,public.improvement_events from public,anon,authenticated;
grant select on public.improvement_requests to authenticated;
create policy improvement_request_owner on public.improvement_requests for select to authenticated using (
  company_id=private.get_current_user_company_id() and actor_id=auth.uid() and private.get_current_user_dealer_id() is null
  and private.improvement_read_allowed(private.get_current_user_role(),private.improvement_view(mutation->>'action'))
);
create policy improvement_events_no_direct_read on public.improvement_events for select to authenticated using(false);

create function private.improvement_record(p_company uuid,p_view text,p_entity uuid,p_action text,p_actor uuid,p_note text,p_facts jsonb) returns void
language sql security definer set search_path=public,private as $$
  insert into public.improvement_events(company_id,view_name,entity_id,action,actor_id,actor_name,note,facts)
  values(p_company,p_view,p_entity,p_action,p_actor,coalesce((select nullif(full_name,'') from public.app_users where id=p_actor and company_id=p_company),'System'),p_note,coalesce(p_facts,'{}'::jsonb))
$$;
revoke all on function private.improvement_record(uuid,text,uuid,text,uuid,text,jsonb) from public,anon,authenticated;

create function private.improvement_uuid(p_mutation jsonb,p_key text) returns uuid language plpgsql immutable set search_path=public,private as $$
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'string' or (p_mutation->>p_key) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'NOV: Choose a valid record for %.',replace(p_key,'_',' '); end if;
  return (p_mutation->>p_key)::uuid;
end $$;
revoke all on function private.improvement_uuid(jsonb,text) from public,anon,authenticated;

create function private.improvement_user_name(p_company uuid,p_user uuid) returns text language sql stable security definer set search_path=public,private as $$
  select coalesce((select nullif(full_name,'') from public.app_users where id=p_user and company_id=p_company),'Not assigned')
$$;
revoke all on function private.improvement_user_name(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-053: an occurrence is an existing source record. Only adverse records can be linked:
-- rejected or rework inspections, refused or damaged deliveries, and reported exceptions.
------------------------------------------------------------------------------------------------
create function private.improvement_incident(p_company uuid,p_type text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v jsonb;
begin
  if p_type='quality_inspection' then
    select jsonb_build_object('label',concat('Inspection ',coalesce(nullif(q.batch_number,''),left(q.id::text,8)),' · ',q.status,coalesce(' · '||j.job_number,'')),'occurred_at',coalesce(q.inspection_date,q.created_at),
      'href','/quality/'||q.id,'eligible',q.status in ('rejected','rework')) into v
    from public.quality_inspections q left join public.production_jobs j on j.id=q.production_job_id and j.company_id=q.company_id where q.id=p_id and q.company_id=p_company;
  elsif p_type='production_exception' then
    select jsonb_build_object('label',concat('Production exception · ',e.reason,coalesce(' · '||j.job_number,'')),'occurred_at',e.recorded_at,'href','/production/'||e.production_job_id,'eligible',true) into v
    from public.production_exceptions e left join public.production_jobs j on j.id=e.production_job_id and j.company_id=e.company_id where e.id=p_id and e.company_id=p_company;
  elsif p_type='task_exception' then
    select jsonb_build_object('label',concat('Task exception · ',left(e.reason,80)),'occurred_at',e.raised_at,'href','/tasks/'||e.task_id,'eligible',true) into v
    from public.task_exceptions e where e.id=p_id and e.company_id=p_company;
  elsif p_type='delivery_disposition' then
    select jsonb_build_object('label',concat('Delivery ',replace(x.disposition,'_',' '),' · ',d.dispatch_number,' · ',trim_scale(x.quantity_kg),' kg'),'occurred_at',x.recorded_at,'href','/dispatches/'||x.dispatch_id,
      'eligible',x.disposition<>'accepted' and x.reversed_at is null) into v
    from public.delivery_dispositions x join public.dispatches d on d.id=x.dispatch_id and d.company_id=x.company_id where x.id=p_id and x.company_id=p_company;
  elsif p_type='return_authorization' then
    select jsonb_build_object('label',concat('Return authorized · ',trim_scale(r.expected_kg),' kg · ',left(r.reason,60)),'occurred_at',r.authorized_at,'href','/orders/'||r.order_id,'eligible',true) into v
    from public.return_authorizations r where r.id=p_id and r.company_id=p_company;
  elsif p_type='support_ticket' then
    -- Customer complaint text stays in the portal ticket; only its reference and type are linked here.
    select jsonb_build_object('label',concat('Customer ticket ',t.ticket_number,' · ',replace(t.issue_type,'_',' ')),'occurred_at',t.created_at,'href',null,'eligible',true) into v
    from public.support_tickets t where t.id=p_id and t.company_id=p_company;
  elsif p_type='procedure_step_flag' then
    select jsonb_build_object('label',concat('Procedure step ',f.step_no,' flagged ',replace(f.kind,'_',' ')),'occurred_at',f.flagged_at,'href','/tasks/'||f.task_id,'eligible',f.status<>'dismissed') into v
    from public.procedure_step_flags f where f.id=p_id and f.company_id=p_company;
  end if;
  return v;
end $$;
revoke all on function private.improvement_incident(uuid,text,uuid) from public,anon,authenticated;

-- Activity in a window, used as the denominator of the recurrence rate.
create function private.improvement_activity(p_company uuid,p_kind text,p_from timestamptz,p_to timestamptz) returns bigint language sql stable security definer set search_path=public,private as $$
  select case p_kind
    when 'dispatches' then (select count(*) from public.dispatches d where d.company_id=p_company and d.delivery_status<>'pending'
      and coalesce(d.actual_dispatched_at,d.dispatch_date::timestamp at time zone 'Asia/Kolkata')>=p_from and coalesce(d.actual_dispatched_at,d.dispatch_date::timestamp at time zone 'Asia/Kolkata')<p_to)
    when 'production_jobs' then (select count(*) from public.production_jobs j where j.company_id=p_company and j.status='completed' and j.completed_at>=p_from and j.completed_at<p_to)
    when 'inspections' then (select count(*) from public.quality_inspections q where q.company_id=p_company and q.status<>'pending' and q.inspection_date>=p_from and q.inspection_date<p_to)
    when 'tasks' then (select count(*) from public.tasks t where t.company_id=p_company and t.status='completed' and t.completed_at>=p_from and t.completed_at<p_to)
  end
$$;
revoke all on function private.improvement_activity(uuid,text,timestamptz,timestamptz) from public,anon,authenticated;

-- Recurrence before and during the trial over equal windows (at most 90 days each). Rates use the
-- agreed denominator; a window without activity is incomplete, never a zero rate.
create function private.problem_recurrence(p_company uuid,p_problem uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare p public.improvement_problems; v_days integer; v_from timestamptz; v_to timestamptz := now(); v_before bigint; v_after bigint; d_before bigint; d_after bigint;
begin
  select * into p from public.improvement_problems where id=p_problem and company_id=p_company;
  if p.id is null then return null; end if;
  if p.trial_started_at is null then
    return jsonb_build_object('state','not_started','linked',(select count(*) from public.improvement_problem_links l where l.company_id=p_company and l.problem_id=p.id and l.removed_at is null),
      'denominator',p.denominator,'note','Recurrence is compared once a trial starts.');
  end if;
  if p.status='closed' and p.closed_at is not null then v_to:=p.closed_at; end if;
  v_days:=greatest(1,least(90,ceil(extract(epoch from (v_to-p.trial_started_at))/86400.0)::integer));
  v_from:=p.trial_started_at-make_interval(days=>v_days);
  select count(*) filter (where l.occurred_at>=v_from and l.occurred_at<p.trial_started_at), count(*) filter (where l.occurred_at>=p.trial_started_at and l.occurred_at<v_to)
    into v_before,v_after from public.improvement_problem_links l where l.company_id=p_company and l.problem_id=p.id and l.removed_at is null;
  d_before:=private.improvement_activity(p_company,p.denominator,v_from,p.trial_started_at);
  d_after:=private.improvement_activity(p_company,p.denominator,p.trial_started_at,v_to);
  return jsonb_build_object('state',case when d_before>0 and d_after>0 then 'complete' else 'incomplete' end,'window_days',v_days,'denominator',p.denominator,
    'baseline',jsonb_build_object('from',v_from,'to',p.trial_started_at,'occurrences',v_before,'activity',d_before,'rate_per_100',case when d_before>0 then round(v_before*100.0/d_before,2) end),
    'trial',jsonb_build_object('from',p.trial_started_at,'to',v_to,'occurrences',v_after,'activity',d_after,'rate_per_100',case when d_after>0 then round(v_after*100.0/d_after,2) end),
    'note',case when d_before>0 and d_after>0 then 'Counts only occurrences linked to this problem. Other changes in the same period can also affect the result.'
      else 'One window has no recorded activity for the chosen denominator, so the comparison is incomplete.' end);
end $$;
revoke all on function private.problem_recurrence(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-025: exposure from completed runs only; corrections already adjust a job's output. An
-- opening balance recorded before system use is shown separately and is never run evidence.
------------------------------------------------------------------------------------------------
create function private.die_run_date(j public.production_jobs) returns date language sql stable set search_path=public,private as $$
  select (coalesce(j.completed_at,j.updated_at,j.created_at) at time zone 'Asia/Kolkata')::date
$$;
revoke all on function private.die_run_date(public.production_jobs) from public,anon,authenticated;

create function private.die_history(p_company uuid,p_die uuid,p_timeline boolean) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare d public.dies; v_today date:=private.ist_today(); v_nitr date; v_corr date; v_any date; v_since date; v_kg numeric; v_runs integer; v_good numeric; v_count integer;
  v_incomplete integer; v_cancelled integer; v_running integer; v_rejects integer; v_service jsonb:='{}'::jsonb; v_checks jsonb:='[]'::jsonb; v_warn jsonb:='[]'::jsonb; v_missing jsonb:='[]'::jsonb;
  v_timeline jsonb:='[]'::jsonb; v_value numeric; v_state text; v_event text; t public.die_service_thresholds; v_label text; v_unit text; v_profile text;
begin
  select * into d from public.dies where id=p_die and company_id=p_company and deleted_at is null;
  if d.id is null then return null; end if;
  select profile_code into v_profile from public.aluminium_profiles where id=d.profile_id and company_id=p_company;
  select max(nitriding_date) into v_nitr from public.die_nitriding_history where company_id=p_company and die_id=d.id and nitriding_date<=v_today;
  select max(correction_date) into v_corr from public.die_corrections where company_id=p_company and die_id=d.id and correction_date<=v_today;
  v_any:=greatest(v_nitr,v_corr);
  select coalesce(sum(coalesce(j.actual_quantity_kg,0)) filter (where j.status='completed'),0), count(*) filter (where j.status='completed'),
      count(*) filter (where j.status='completed' and coalesce(j.actual_quantity_kg,0)<=0), count(*) filter (where j.status='cancelled'), count(*) filter (where j.status in ('ready','in_progress'))
    into v_good,v_count,v_incomplete,v_cancelled,v_running from public.production_jobs j where j.company_id=p_company and j.die_id=d.id;
  select count(*) into v_rejects from public.quality_inspections q join public.production_jobs j on j.id=q.production_job_id and j.company_id=q.company_id
    where q.company_id=p_company and j.die_id=d.id and q.status in ('rejected','rework') and q.inspection_date>=now()-interval '30 days';

  foreach v_event in array array['nitriding','correction','any'] loop
    v_since:=case v_event when 'nitriding' then v_nitr when 'correction' then v_corr else v_any end;
    select coalesce(sum(coalesce(j.actual_quantity_kg,0)),0), count(*) into v_kg,v_runs from public.production_jobs j
      where j.company_id=p_company and j.die_id=d.id and j.status='completed' and (v_since is null or private.die_run_date(j)>v_since);
    if v_since is null then v_kg:=v_kg+coalesce(d.opening_production_kg,0); v_runs:=v_runs+coalesce(d.opening_runs,0); end if;
    v_service:=v_service||jsonb_build_object(v_event,jsonb_build_object('date',v_since,'kg',v_kg,'runs',v_runs,'days',case when v_since is not null then v_today-v_since end,'includes_opening',v_since is null and coalesce(d.opening_production_kg,0)>0));
  end loop;

  for t in select * from public.die_service_thresholds x where x.company_id=p_company and x.status='approved' and (x.die_type is null or x.die_type=d.die_type) order by x.basis,x.service_event loop
    v_value:=case t.basis when 'kg_since_service' then (v_service->t.service_event->>'kg')::numeric when 'runs_since_service' then (v_service->t.service_event->>'runs')::numeric
      else (v_service->t.service_event->>'days')::numeric end;
    v_unit:=case t.basis when 'kg_since_service' then 'kg' when 'runs_since_service' then 'runs' else 'days' end;
    v_label:=case t.service_event when 'nitriding' then 'nitriding' when 'correction' then 'correction' else 'nitriding or correction' end;
    v_state:=case when v_value is null then 'unknown' when v_value>=t.warn_at then 'due' when v_value>=t.warn_at*0.9 then 'approaching' else 'ok' end;
    v_checks:=v_checks||jsonb_build_object('threshold_id',t.id,'basis',t.basis,'service_event',t.service_event,'warn_at',t.warn_at,'value',v_value,'state',v_state,'die_type',t.die_type);
    if v_state='due' then v_warn:=v_warn||to_jsonb(format('Service check due: %s %s since the last %s (reviewed threshold %s %s).',trim_scale(v_value),v_unit,v_label,trim_scale(t.warn_at),v_unit));
    elsif v_state='approaching' then v_warn:=v_warn||to_jsonb(format('Approaching service check: %s of %s %s since the last %s.',trim_scale(v_value),trim_scale(t.warn_at),v_unit,v_label));
    elsif v_state='unknown' then v_missing:=v_missing||to_jsonb(format('No %s is recorded, so days since service cannot be checked.',v_label)); end if;
  end loop;
  if d.die_status not in ('active','approved') then v_warn:=v_warn||to_jsonb(format('Die is %s; production planning accepts only active or approved dies.',replace(d.die_status,'_',' '))); end if;
  if v_rejects>0 then v_warn:=v_warn||to_jsonb(format('%s rejected or rework inspection(s) on runs of this die in the last 30 days.',v_rejects)); end if;
  if v_incomplete>0 then v_missing:=v_missing||to_jsonb(format('%s completed run(s) have no recorded output kg; exposure is incomplete.',v_incomplete)); end if;
  if coalesce(d.opening_production_kg,0)>0 or coalesce(d.opening_runs,0)>0 then
    v_missing:=v_missing||to_jsonb(format('Totals include an opening balance of %s kg and %s run(s) recorded before system use; it is not run evidence.',trim_scale(coalesce(d.opening_production_kg,0)),coalesce(d.opening_runs,0))); end if;
  if abs(coalesce(d.total_production_kg,0)-(v_good+coalesce(d.opening_production_kg,0)))>0.5 then
    v_missing:=v_missing||to_jsonb(format('The die master shows %s kg; recorded runs and the opening balance give %s kg. The master value is not used.',trim_scale(coalesce(d.total_production_kg,0)),trim_scale(v_good+coalesce(d.opening_production_kg,0)))); end if;

  if p_timeline then
    select coalesce(jsonb_agg(e order by (e->>'at') desc),'[]'::jsonb) into v_timeline from (
      select * from (
        select jsonb_build_object('at',coalesce(j.completed_at,j.updated_at,j.created_at),'kind','run','label',concat('Run ',coalesce(j.job_number,left(j.id::text,8)),' ',
          case j.status when 'completed' then concat('completed: ',trim_scale(coalesce(j.actual_quantity_kg,0)),' kg',case when coalesce(j.actual_quantity_kg,0)<=0 then ' (output not recorded)' else '' end)
            when 'cancelled' then 'cancelled (not counted)' else replace(j.status,'_',' ')||' (not yet counted)' end),'href','/production/'||j.id) e
        from public.production_jobs j where j.company_id=p_company and j.die_id=d.id and j.status<>'planned'
        union all select jsonb_build_object('at',c.created_at,'kind','output_correction','label',concat('Output of ',coalesce(j.job_number,'a run'),' corrected from ',trim_scale(c.prior_weight_kg),' to ',trim_scale(c.corrected_weight_kg),' kg: ',left(c.reason,80)),'href','/production/'||j.id)
        from public.production_output_corrections c join public.production_jobs j on j.id=c.production_job_id and j.company_id=c.company_id where c.company_id=p_company and j.die_id=d.id
        union all select jsonb_build_object('at',coalesce(q.inspection_date,q.created_at),'kind','inspection','label',concat('Inspection ',q.status,' on ',coalesce(j.job_number,'a run')),'href','/quality/'||q.id)
        from public.quality_inspections q join public.production_jobs j on j.id=q.production_job_id and j.company_id=q.company_id where q.company_id=p_company and j.die_id=d.id
        union all select jsonb_build_object('at',coalesce(c.correction_date::timestamp at time zone 'Asia/Kolkata',c.created_at),'kind','correction','label',concat('Die correction',coalesce(' ('||replace(c.correction_type,'_',' ')||')',''),': ',replace(c.correction_reason,'_',' '),coalesce(' · '||c.result_status,'')),'href','/dies/'||d.id)
        from public.die_corrections c where c.company_id=p_company and c.die_id=d.id
        union all select jsonb_build_object('at',coalesce(x.trial_date::timestamp at time zone 'Asia/Kolkata',x.created_at),'kind','trial','label',concat('Die trial',coalesce(': '||x.trial_result,'')),'href','/dies/'||d.id)
        from public.die_trials x where x.company_id=p_company and x.die_id=d.id
        union all select jsonb_build_object('at',coalesce(n.nitriding_date::timestamp at time zone 'Asia/Kolkata',n.created_at),'kind','nitriding','label',concat('Nitriding',coalesce(' cycle '||n.nitriding_cycle_number,''),coalesce(' · '||n.status,'')),'href','/dies/'||d.id)
        from public.die_nitriding_history n where n.company_id=p_company and n.die_id=d.id
        union all select jsonb_build_object('at',h.recorded_at,'kind','move','label',concat('Moved from ',coalesce(h.previous_location,'no location'),' to ',coalesce(h.location,'no location')),'href',null)
        from public.operator_location_history h where h.company_id=p_company and h.entity_type='die' and h.entity_id=d.id
        union all select jsonb_build_object('at',s.changed_at,'kind','status','label',concat('Status changed from ',coalesce(replace(s.previous_status,'_',' '),'not set'),' to ',coalesce(replace(s.new_status,'_',' '),'not set')),'href',null)
        from public.die_status_events s where s.company_id=p_company and s.die_id=d.id
      ) all_events order by (e->>'at') desc limit 60
    ) x;
  end if;

  return jsonb_build_object('die_id',d.id,'die_number',d.die_number,'profile_code',v_profile,'die_type',d.die_type,'die_status',d.die_status,'rack_location',d.rack_location,
    'run_kg',v_good,'runs',v_count,'opening_kg',coalesce(d.opening_production_kg,0),'opening_runs',coalesce(d.opening_runs,0),'master_total_kg',d.total_production_kg,
    'incomplete_runs',v_incomplete,'cancelled_runs',v_cancelled,'running_jobs',v_running,'recent_rejections',v_rejects,'last_nitriding',v_nitr,'last_correction',v_corr,
    'service',v_service,'checks',v_checks,'warnings',v_warn,'missing',v_missing,'timeline',v_timeline,
    'status_history_note','Status changes are recorded from 5 November 2026; earlier decisions remain in the die record notes.');
end $$;
revoke all on function private.die_history(uuid,uuid,boolean) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-054: one metric for one IST date window. Missing evidence is counted separately and an empty
-- denominator gives no value, never zero.
------------------------------------------------------------------------------------------------
create function private.outcome_metric(p_company uuid,p_key text,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_num numeric; v_den numeric; v_missing bigint:=0; v_sample bigint; v_extra jsonb:='{}'::jsonb; v_today date:=private.ist_today();
  v_elapsed numeric; v_active numeric; v_wait numeric; v_unrec numeric;
begin
  if p_key='quality_first_time_acceptance' then
    with firsts as (select distinct on (q.production_job_id) q.production_job_id,q.status,q.inspection_date from public.quality_inspections q
      where q.company_id=p_company and q.production_job_id is not null and q.finishing_job_id is null and q.status<>'pending' order by q.production_job_id,q.inspection_date,q.created_at,q.id)
    select count(*) filter (where status='approved'),count(*) into v_num,v_den from firsts where (inspection_date at time zone 'Asia/Kolkata')::date between p_from and p_to;
    select count(*) into v_missing from public.quality_inspections q where q.company_id=p_company and q.status='pending' and (q.inspection_date at time zone 'Asia/Kolkata')::date between p_from and p_to;
    v_sample:=v_den;
  elsif p_key='quality_rework_share' then
    select count(*) filter (where q.status in ('rework','rejected')),count(*) filter (where q.status<>'pending'),count(*) filter (where q.status='pending') into v_num,v_den,v_missing
    from public.quality_inspections q where q.company_id=p_company and (q.inspection_date at time zone 'Asia/Kolkata')::date between p_from and p_to;
    v_sample:=v_den;
  elsif p_key='production_missing_evidence' then
    select count(*) filter (where coalesce(j.actual_quantity_kg,0)<=0 or not exists(select 1 from public.quality_inspections q where q.company_id=p_company and q.production_job_id=j.id)),count(*) into v_num,v_den
    from public.production_jobs j where j.company_id=p_company and j.status='completed' and j.completed_at is not null and (j.completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
    select count(*) into v_missing from public.production_jobs j where j.company_id=p_company and j.status='completed' and j.completed_at is null and (j.updated_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
    v_sample:=v_den;
  elsif p_key='dispatch_on_time' then
    select count(*) filter (where o.expected_dispatch_date is not null and x.left_on<=o.expected_dispatch_date),count(*) filter (where o.expected_dispatch_date is not null),count(*) filter (where o.expected_dispatch_date is null)
      into v_num,v_den,v_missing
    from public.dispatches d join public.orders o on o.id=d.order_id and o.company_id=d.company_id
    cross join lateral (select coalesce((d.actual_dispatched_at at time zone 'Asia/Kolkata')::date,d.dispatch_date) left_on) x
    where d.company_id=p_company and d.delivery_status<>'pending' and x.left_on between p_from and p_to;
    v_sample:=v_den;
  elsif p_key='task_within_target' then
    select count(*) filter (where tt->>'completion_state'='met'),count(*) filter (where (tt->>'has_target')::boolean),count(*) filter (where not (tt->>'has_target')::boolean) into v_num,v_den,v_missing
    from public.tasks t cross join lateral (select private.task_turnaround(t.id) tt) z
    where t.company_id=p_company and t.status='completed' and t.completed_at is not null and (t.completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
    v_sample:=v_den;
  elsif p_key='task_unrecorded_time' then
    with done as (select t.id,t.created_at,t.completed_at,m.first_started_at from public.tasks t left join public.task_turnaround_marks m on m.task_id=t.id
        where t.company_id=p_company and t.status='completed' and t.completed_at is not null and t.completed_at>t.created_at and (t.completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
      figures as (select d.id,extract(epoch from (d.completed_at-d.created_at))/3600.0 elapsed,
        coalesce((select sum(extract(epoch from (least(coalesce(w.ended_at,d.completed_at),d.completed_at)-greatest(w.started_at,d.created_at)))/3600.0) from public.task_waits w
          where w.task_id=d.id and w.started_at<d.completed_at and coalesce(w.ended_at,d.completed_at)>d.created_at),0) waiting,
        case when d.first_started_at is null or d.first_started_at>=d.completed_at then 0 else greatest(0,extract(epoch from (d.completed_at-greatest(d.first_started_at,d.created_at)))/3600.0
          -coalesce((select sum(extract(epoch from (least(coalesce(w.ended_at,d.completed_at),d.completed_at)-greatest(w.started_at,d.first_started_at)))/3600.0) from public.task_waits w
            where w.task_id=d.id and w.started_at<d.completed_at and coalesce(w.ended_at,d.completed_at)>d.first_started_at),0)) end active
        from done d)
    select coalesce(sum(elapsed),0),coalesce(sum(active),0),coalesce(sum(waiting),0),coalesce(sum(greatest(0,elapsed-active-waiting)),0),count(*) into v_elapsed,v_active,v_wait,v_unrec,v_sample from figures;
    v_num:=round(v_unrec,2); v_den:=round(v_elapsed,2);
    v_extra:=jsonb_build_object('elapsed_hours',round(v_elapsed,2),'active_hours',round(v_active,2),'waiting_hours',round(v_wait,2),'unrecorded_hours',round(v_unrec,2));
    select count(*) into v_missing from public.tasks t left join public.task_turnaround_marks m on m.task_id=t.id where t.company_id=p_company and t.status='completed' and t.completed_at is not null
      and m.first_started_at is null and (t.completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
  elsif p_key='tasks_overdue_now' then
    if p_to<v_today then return jsonb_build_object('numerator',null,'denominator',null,'value',null,'sample',0,'missing',0,'not_applicable',true); end if;
    select count(*) filter (where t.due_date is not null and t.due_date<v_today),count(*) filter (where t.due_date is not null),count(*) filter (where t.due_date is null) into v_num,v_den,v_missing
    from public.tasks t where t.company_id=p_company and t.status in ('open','in_progress');
    v_sample:=v_den;
  else return null; end if;
  return jsonb_build_object('numerator',v_num,'denominator',v_den,'value',case when coalesce(v_den,0)>0 then round(v_num*100.0/v_den,1) end,'sample',coalesce(v_sample,0),'missing',v_missing)||v_extra;
end $$;
revoke all on function private.outcome_metric(uuid,text,date,date) from public,anon,authenticated;

create function private.outcome_metrics(p_company uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_today date:=private.ist_today(); r record; v_cur jsonb; v_prev jsonb; v_status text; v_diff numeric; v_out jsonb:='[]'::jsonb;
begin
  for r in select distinct on (m.metric_key) m.metric_key,m.version,m.definition,m.effective_from from public.outcome_metric_versions m where m.effective_from<=v_today order by m.metric_key,m.version desc loop
    v_cur:=private.outcome_metric(p_company,r.metric_key,v_today-29,v_today);
    v_prev:=private.outcome_metric(p_company,r.metric_key,v_today-59,v_today-30);
    v_status:=case when coalesce((v_cur->>'sample')::bigint,0)=0 then 'no_data' when (v_cur->>'sample')::bigint<10 then 'small_sample'
      when coalesce((v_prev->>'not_applicable')::boolean,false) then 'current_only' when v_prev->>'value' is null or (v_prev->>'sample')::bigint<10 then 'no_comparison' else null end;
    if v_status is null then
      v_diff:=(v_cur->>'value')::numeric-(v_prev->>'value')::numeric;
      v_status:=case when abs(v_diff)<2 then 'steady' when (r.definition->>'direction'='higher')=(v_diff>0) then 'improved' else 'worsened' end;
    end if;
    v_out:=v_out||jsonb_build_object('id',md5(p_company::text||':outcome:'||r.metric_key)::uuid,'key',r.metric_key,'version',r.version,'effective_from',r.effective_from,
      'definition',r.definition,'current',v_cur||jsonb_build_object('from',v_today-29,'to',v_today),'previous',v_prev||jsonb_build_object('from',v_today-59,'to',v_today-30),'status',v_status);
  end loop;
  return v_out;
end $$;
revoke all on function private.outcome_metrics(uuid) from public,anon,authenticated;

-- Source records behind a metric for the current window, for drill-down by authorized leads.
create function private.outcome_drill(p_company uuid,p_key text) returns jsonb language sql stable security definer set search_path=public,private as $$
  with w as (select private.ist_today()-29 f,private.ist_today() t)
  select coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('label',concat(coalesce(j.job_number,'Job'),' · first inspection ',f.status),'detail',to_char(f.inspection_date at time zone 'Asia/Kolkata','DD Mon YYYY'),'href','/quality/'||f.id) x
    from (select distinct on (q.production_job_id) q.* from public.quality_inspections q where q.company_id=p_company and q.production_job_id is not null and q.finishing_job_id is null and q.status<>'pending'
      order by q.production_job_id,q.inspection_date,q.created_at,q.id) f join public.production_jobs j on j.id=f.production_job_id cross join w
    where p_key='quality_first_time_acceptance' and f.status<>'approved' and (f.inspection_date at time zone 'Asia/Kolkata')::date between w.f and w.t
    union all select jsonb_build_object('label',concat('Inspection ',coalesce(nullif(q.batch_number,''),left(q.id::text,8)),' · ',q.status),'detail',to_char(q.inspection_date at time zone 'Asia/Kolkata','DD Mon YYYY'),'href','/quality/'||q.id)
    from public.quality_inspections q cross join w where p_key='quality_rework_share' and q.company_id=p_company and q.status in ('rework','rejected') and (q.inspection_date at time zone 'Asia/Kolkata')::date between w.f and w.t
    union all select jsonb_build_object('label',coalesce(j.job_number,'Job'),'detail',case when coalesce(j.actual_quantity_kg,0)<=0 then 'Output kg not recorded' else 'No quality inspection recorded' end,'href','/production/'||j.id)
    from public.production_jobs j cross join w where p_key='production_missing_evidence' and j.company_id=p_company and j.status='completed' and j.completed_at is not null
      and (j.completed_at at time zone 'Asia/Kolkata')::date between w.f and w.t and (coalesce(j.actual_quantity_kg,0)<=0 or not exists(select 1 from public.quality_inspections q where q.company_id=p_company and q.production_job_id=j.id))
    union all select jsonb_build_object('label',coalesce(d.dispatch_number,'Dispatch'),'detail',concat('Left ',to_char(coalesce((d.actual_dispatched_at at time zone 'Asia/Kolkata')::date,d.dispatch_date),'DD Mon'),', expected ',to_char(o.expected_dispatch_date,'DD Mon')),'href','/dispatches/'||d.id)
    from public.dispatches d join public.orders o on o.id=d.order_id and o.company_id=d.company_id cross join w where p_key='dispatch_on_time' and d.company_id=p_company and d.delivery_status<>'pending'
      and o.expected_dispatch_date is not null and coalesce((d.actual_dispatched_at at time zone 'Asia/Kolkata')::date,d.dispatch_date) between w.f and w.t and coalesce((d.actual_dispatched_at at time zone 'Asia/Kolkata')::date,d.dispatch_date)>o.expected_dispatch_date
    union all select jsonb_build_object('label',t.title,'detail',concat('Active ',round((private.task_turnaround(t.id)->>'active_minutes')::numeric/60,1),' h against ',round((private.task_turnaround(t.id)->>'completion_minutes_target')::numeric/60,1),' h'),'href','/tasks/'||t.id)
    from public.tasks t cross join w where p_key='task_within_target' and t.company_id=p_company and t.status='completed' and t.completed_at is not null
      and (t.completed_at at time zone 'Asia/Kolkata')::date between w.f and w.t and private.task_turnaround(t.id)->>'completion_state'='missed'
    union all select jsonb_build_object('label',t.title,'detail','Completed with no recorded start','href','/tasks/'||t.id)
    from public.tasks t left join public.task_turnaround_marks m on m.task_id=t.id cross join w where p_key='task_unrecorded_time' and t.company_id=p_company and t.status='completed' and t.completed_at is not null
      and m.first_started_at is null and (t.completed_at at time zone 'Asia/Kolkata')::date between w.f and w.t
    union all select jsonb_build_object('label',t.title,'detail',concat('Due ',to_char(t.due_date,'DD Mon YYYY')),'href','/tasks/'||t.id)
    from public.tasks t cross join w where p_key='tasks_overdue_now' and t.company_id=p_company and t.status in ('open','in_progress') and t.due_date<w.t
    limit 10) y),'[]'::jsonb)
$$;
revoke all on function private.outcome_drill(uuid,text) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Read models for every view in this batch (same row contract as batches 3 to 6).
------------------------------------------------------------------------------------------------
create function private.improvement_rows(p_company uuid,p_actor uuid,p_role text,p_view text,p_state text,p_id uuid default null)
returns table(row_data jsonb,sort_rank integer,sort_due date,sort_new timestamptz) language plpgsql stable security definer set search_path=public,private as $$
declare v_today date:=private.ist_today(); v_all boolean:=p_role in ('owner','admin','factory_manager','quality');
  v_drill boolean; m jsonb;
begin
  if p_view='problems' then
    return query select jsonb_build_object('id',p.id,'label',p.title,'status',st.status,'owner',ou.full_name,'due_date',p.review_date,
        'summary',concat(lk.n,' linked occurrence(s) · ',replace(p.category,'_',' '),case when p.cause_basis='established' then ' · cause established' when p.cause_basis='observation' then ' · cause observed, not established' else '' end,
          case when st.status='review_due' then ' · effectiveness review due' else '' end),
        'source_href',null,'details',jsonb_build_object('problem_id',p.id,'title',p.title,'category',p.category,'description',p.description,'containment',p.containment,
          'owner_id',p.owner_id,'owner_name',ou.full_name,'problem_status',p.status,'cause',p.cause,'cause_basis',p.cause_basis,'cause_evidence',p.cause_evidence,
          'proposed_action',p.proposed_action,'trial_scope',p.trial_scope,'review_date',p.review_date,'denominator',p.denominator,'trial_started_at',p.trial_started_at,
          'procedure_improvement',pi.title,'procedure_improvement_status',pi.status,'outcome',p.outcome,'closed_at',p.closed_at,'reopened_count',p.reopened_count,
          'linked_count',lk.n,'created_by',cu.full_name,'created_at',p.created_at,
          'links',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'source_type',l.source_type,'source_id',l.source_id,'label',l.label,'occurred_at',l.occurred_at,
              'href',(private.improvement_incident(p_company,l.source_type,l.source_id))->>'href','removed',l.removed_at is not null,'removed_reason',l.removed_reason) order by l.removed_at nulls first,l.occurred_at desc),'[]'::jsonb)
            from (select * from public.improvement_problem_links y where y.company_id=p_company and y.problem_id=p.id order by y.occurred_at desc limit 50) l) end,
          'recurrence',case when p_id is null then null else private.problem_recurrence(p_company,p.id) end,
          'suggestions',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('reference',s.reference,'id',s.id,'status',s.status)),'[]'::jsonb)
            from public.improvement_suggestions s where s.company_id=p_company and s.problem_id=p.id and (v_all or s.owner_id=p_actor or s.contributor_id=p_actor)) end)),
      case st.status when 'review_due' then 0 when 'open' then 1 when 'investigating' then 2 when 'planned' then 3 when 'trial' then 4 else 9 end,p.review_date,p.updated_at
    from public.improvement_problems p join public.app_users ou on ou.id=p.owner_id left join public.app_users cu on cu.id=p.created_by
    left join public.procedure_improvements pi on pi.id=p.procedure_improvement_id and pi.company_id=p.company_id
    cross join lateral (select count(*) n from public.improvement_problem_links l where l.company_id=p_company and l.problem_id=p.id and l.removed_at is null) lk
    cross join lateral (select case when p.status='trial' and p.review_date<=v_today then 'review_due' else p.status end status) st
    where p.company_id=p_company and (p_id is null or p.id=p_id) and (p_id is not null or p_state='all' or p.status<>'closed');

  elsif p_view='suggestions' then
    return query select jsonb_build_object('id',s.id,'label',concat(s.reference,' · ',replace(s.category,'_',' ')),'status',s.status,'owner',ou.full_name,'due_date',(s.created_at at time zone 'Asia/Kolkata')::date,
        'summary',left(s.description,140),'source_href',null,
        'details',jsonb_build_object('suggestion_id',s.id,'reference',s.reference,'category',s.category,'source_path',s.source_path,'description',s.description,'evidence',s.evidence,
          'contributor',cu.full_name,'contributor_id',s.contributor_id,'owner_id',s.owner_id,'owner_name',ou.full_name,'mine',s.contributor_id=p_actor,'assigned_to_me',s.owner_id=p_actor,
          'response',s.response,'decline_reason',s.decline_reason,'clarification',s.clarification,
          'internal_note',case when s.owner_id=p_actor or p_role in ('owner','admin') then s.internal_note end,
          'merged_into',mi.reference,'merged_into_id',s.merged_into_id,'merged_into_status',mi.status,'problem_title',pr.title,'problem_id',s.problem_id,'procedure_improvement',pi.title,
          'created_at',s.created_at,'responded_at',s.responded_at,
          'merged_from',(select coalesce(jsonb_agg(jsonb_build_object('reference',x.reference,'id',x.id)),'[]'::jsonb) from public.improvement_suggestions x where x.company_id=p_company and x.merged_into_id=s.id))),
      case s.status when 'submitted' then 0 when 'clarification' then 1 when 'acknowledged' then 2 when 'trial' then 3 when 'adopted' then 4 else 9 end,(s.created_at at time zone 'Asia/Kolkata')::date,s.updated_at
    from public.improvement_suggestions s join public.app_users ou on ou.id=s.owner_id join public.app_users cu on cu.id=s.contributor_id
    left join public.improvement_suggestions mi on mi.id=s.merged_into_id and mi.company_id=s.company_id
    left join public.improvement_problems pr on pr.id=s.problem_id and pr.company_id=s.company_id
    left join public.procedure_improvements pi on pi.id=s.procedure_improvement_id and pi.company_id=s.company_id
    where s.company_id=p_company and (v_all or s.contributor_id=p_actor or s.owner_id=p_actor) and (p_id is null or s.id=p_id)
      and (p_id is not null or p_state='all' or s.status not in ('declined','resolved','merged'));

  elsif p_view='outcomes' then
    for m in select value from jsonb_array_elements(private.outcome_metrics(p_company)) loop
      if p_id is not null and (m->>'id')::uuid<>p_id then continue; end if;
      if p_id is null and p_state<>'all' and m->>'status' not in ('worsened','small_sample','no_data') then continue; end if;
      v_drill:=p_role in ('owner','admin','factory_manager') or (m->'definition'->>'team'='quality' and p_role='quality') or (m->'definition'->>'team'='production' and p_role='production_manager')
        or (m->'definition'->>'team'='dispatch' and p_role='dispatch_manager') or (m->'definition'->>'team'='tasks' and p_role in ('production_manager','quality','dispatch_manager','inventory_manager','sales_manager'));
      row_data:=jsonb_build_object('id',m->>'id','label',m->'definition'->>'title','status',m->>'status','owner',m->'definition'->>'owner','due_date',null,
        'summary',concat(coalesce((m->'current'->>'value')||'%','No value'),' in the last 30 days',case when m->'previous'->>'value' is not null then concat(' (previous 30 days ',m->'previous'->>'value','%)') else '' end,
          ' · n=',m->'current'->>'sample',case when (m->'current'->>'missing')::bigint>0 then concat(' · ',m->'current'->>'missing',' record(s) missing evidence') else '' end),
        'source_href',null,'details',jsonb_build_object('metric_key',m->>'key','team',m->'definition'->>'team','version',m->'version','effective_from',m->'effective_from','definition',m->'definition',
          'current',m->'current','previous',m->'previous','drill',case when p_id is not null and v_drill then private.outcome_drill(p_company,m->>'key') end,'drill_permitted',v_drill,
          'note','Team-level figures only. Individual performance is not shown without an approved organizational policy.'));
      sort_rank:=case m->>'status' when 'worsened' then 0 when 'no_data' then 1 when 'small_sample' then 2 else 5 end; sort_due:=null; sort_new:=now();
      return next;
    end loop;
    return;

  elsif p_view='dies' then
    return query select jsonb_build_object('id',d.id,'label',concat(d.die_number,coalesce(' · '||ap.profile_code,'')),'status',st.status,'owner',null,'due_date',null,
        'summary',concat(trim_scale((h->>'run_kg')::numeric),' kg over ',h->>'runs',' recorded run(s)',case when jsonb_array_length(h->'warnings')>0 then ' · '||(h->'warnings'->>0) else '' end),
        'source_href','/dies/'||d.id,'details',h),
      case st.status when 'service_due' then 0 when 'history_incomplete' then 1 when 'unavailable' then 2 else 5 end,null::date,d.updated_at
    from public.dies d left join public.aluminium_profiles ap on ap.id=d.profile_id and ap.company_id=d.company_id
    cross join lateral (select private.die_history(p_company,d.id,p_id is not null) h) x
    cross join lateral (select case when exists(select 1 from jsonb_array_elements(x.h->'checks') c where c->>'state'='due') then 'service_due'
      when d.die_status not in ('active','approved') then 'unavailable' when (x.h->>'incomplete_runs')::integer>0 then 'history_incomplete' else 'in_service' end status) st
    where d.company_id=p_company and d.deleted_at is null and (p_id is null or d.id=p_id) and (p_id is not null or p_state='all' or st.status in ('service_due','history_incomplete'));

  elsif p_view='thresholds' then
    return query select jsonb_build_object('id',t.id,'label',concat(case t.basis when 'kg_since_service' then 'Kg' when 'runs_since_service' then 'Runs' else 'Days' end,' since ',
          case t.service_event when 'any' then 'nitriding or correction' else t.service_event end,' · ',coalesce(replace(t.die_type,'_',' ')||' dies','all dies')),'status',t.status,'owner',pu.full_name,'due_date',null,
        'summary',concat('Warn at ',trim_scale(t.warn_at),' ',case t.basis when 'kg_since_service' then 'kg' when 'runs_since_service' then 'runs' else 'days' end,' · ',left(t.rationale,100)),'source_href',null,
        'details',jsonb_build_object('threshold_id',t.id,'die_type',t.die_type,'basis',t.basis,'service_event',t.service_event,'warn_at',t.warn_at,'rationale',t.rationale,'proposed_by',pu.full_name,
          'proposed_by_id',t.proposed_by,'proposed_at',t.proposed_at,'approved_by',au.full_name,'approved_at',t.approved_at,'retired_at',t.retired_at,
          'dies_due',case when p_id is null then null else (select count(*) from public.dies d where d.company_id=p_company and d.deleted_at is null and t.status='approved' and (t.die_type is null or d.die_type=t.die_type)
            and exists(select 1 from jsonb_array_elements(private.die_history(p_company,d.id,false)->'checks') c where (c->>'threshold_id')::uuid=t.id and c->>'state'='due')) end)),
      case t.status when 'proposed' then 0 when 'approved' then 3 else 9 end,null::date,coalesce(t.approved_at,t.proposed_at)
    from public.die_service_thresholds t join public.app_users pu on pu.id=t.proposed_by left join public.app_users au on au.id=t.approved_by
    where t.company_id=p_company and (p_id is null or t.id=p_id) and (p_id is not null or p_state='all' or t.status<>'retired');
  end if;
end $$;
revoke all on function private.improvement_rows(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Lookups for the action forms. Each returns at most 20 company-scoped choices.
------------------------------------------------------------------------------------------------
create function private.improvement_lookup(p_company uuid,p_actor uuid,p_role text,p_payload jsonb) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare k text:=p_payload->>'kind'; s text:=lower(btrim(coalesce(p_payload->>'search',''))); v_sel uuid; v_filter text:=p_payload->>'filter'; v jsonb; v_view text;
begin
  if p_payload ? 'selected_id' then v_sel:=private.improvement_uuid(p_payload,'selected_id'); end if;
  v_view:=case k when 'employees' then null when 'managers' then 'suggestions' when 'incidents' then 'problems' when 'problems' then 'suggestions' when 'suggestions' then 'suggestions'
    when 'procedure_improvements' then 'problems' when 'dies' then 'dies' end;
  if k not in ('employees','managers','incidents','problems','suggestions','procedure_improvements','dies') or not private.improvement_read_allowed(p_role,v_view) then raise exception 'Not permitted' using errcode='42501'; end if;
  if k in ('employees','managers') then
    select coalesce(jsonb_agg(jsonb_build_object('value',u.id,'label',coalesce(nullif(u.full_name,''),u.email),'context',replace(u.role,'_',' ')) order by u.full_name),'[]'::jsonb) into v from (
      select * from public.app_users u where u.company_id=p_company and u.is_active and u.dealer_id is null and u.role not in ('viewer','dealer_admin','dealer_staff')
        and (k='employees' or u.role in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager','inventory_manager','sales_manager','accounts'))
        and (v_sel is null or u.id=v_sel) and (s='' or position(s in lower(coalesce(u.full_name,'')||' '||coalesce(u.email,'')||' '||u.role))>0) order by u.full_name limit 20) u;
  elsif k='incidents' then
    if v_filter is null or v_filter not in ('quality_inspection','production_exception','task_exception','delivery_disposition','return_authorization','support_ticket','procedure_step_flag') then raise exception 'NOV: Choose the kind of occurrence first.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('value',x.id,'label',x.inc->>'label','context',concat(to_char((x.inc->>'occurred_at')::timestamptz at time zone 'Asia/Kolkata','DD Mon YYYY'),
        case when x.linked is not null then ' · already linked to '||x.linked else '' end)) order by (x.inc->>'occurred_at') desc),'[]'::jsonb) into v from (
      select c.id,private.improvement_incident(p_company,v_filter,c.id) inc,(select p.title from public.improvement_problem_links l join public.improvement_problems p on p.id=l.problem_id
          where l.company_id=p_company and l.source_type=v_filter and l.source_id=c.id and l.removed_at is null) linked
      from (select q.id,q.created_at from public.quality_inspections q where v_filter='quality_inspection' and q.company_id=p_company and q.status in ('rejected','rework')
        union all select e.id,e.recorded_at from public.production_exceptions e where v_filter='production_exception' and e.company_id=p_company
        union all select e.id,e.raised_at from public.task_exceptions e where v_filter='task_exception' and e.company_id=p_company
        union all select x.id,x.recorded_at from public.delivery_dispositions x where v_filter='delivery_disposition' and x.company_id=p_company and x.disposition<>'accepted' and x.reversed_at is null
        union all select r.id,r.authorized_at from public.return_authorizations r where v_filter='return_authorization' and r.company_id=p_company
        union all select t.id,t.created_at from public.support_tickets t where v_filter='support_ticket' and t.company_id=p_company
        union all select f.id,f.flagged_at from public.procedure_step_flags f where v_filter='procedure_step_flag' and f.company_id=p_company and f.status<>'dismissed') c
      where (v_sel is null or c.id=v_sel) order by c.created_at desc limit 200) x
    where x.inc is not null and (s='' or position(s in lower(x.inc->>'label'))>0) limit 20;
  elsif k='problems' then
    select coalesce(jsonb_agg(jsonb_build_object('value',p.id,'label',p.title,'context',replace(p.status,'_',' ')||' · '||replace(p.category,'_',' ')) order by p.updated_at desc),'[]'::jsonb) into v from (
      select * from public.improvement_problems p where p.company_id=p_company and (v_sel is not null and p.id=v_sel or v_sel is null and p.status<>'closed')
        and (s='' or position(s in lower(p.title))>0) order by p.updated_at desc limit 20) p;
  elsif k='suggestions' then
    select coalesce(jsonb_agg(jsonb_build_object('value',x.id,'label',x.reference,'context',left(x.description,80)) order by x.created_at desc),'[]'::jsonb) into v from (
      select * from public.improvement_suggestions x where x.company_id=p_company and x.status not in ('merged','declined')
        and (p_role in ('owner','admin','factory_manager','quality') or x.owner_id=p_actor or x.contributor_id=p_actor)
        and (v_sel is null or x.id=v_sel) and (s='' or position(s in lower(x.reference||' '||x.description))>0) order by x.created_at desc limit 20) x;
  elsif k='procedure_improvements' then
    select coalesce(jsonb_agg(jsonb_build_object('value',x.id,'label',x.title,'context',replace(x.status,'_',' ')) order by x.proposed_at desc),'[]'::jsonb) into v from (
      select * from public.procedure_improvements x where x.company_id=p_company and x.status<>'rejected' and (v_sel is null or x.id=v_sel)
        and (s='' or position(s in lower(x.title))>0) order by x.proposed_at desc limit 20) x;
  elsif k='dies' then
    -- Advisory warnings for planners; the production compatibility guard stays authoritative.
    select coalesce(jsonb_agg(jsonb_build_object('value',d.id,'label',d.die_number,'context',coalesce(nullif(concat_ws(' ',(select string_agg(w,' ') from jsonb_array_elements_text(h->'warnings') w)),''),'No service warning'))
        order by d.die_number),'[]'::jsonb) into v from (
      select x.*,private.die_history(p_company,x.id,false) h from public.dies x where x.company_id=p_company and x.deleted_at is null and (v_sel is null or x.id=v_sel)
        and (s='' or position(s in lower(x.die_number||' '||coalesce(x.rack_location,'')))>0) order by x.die_number limit 20) d;
  end if;
  return coalesce(v,'[]'::jsonb);
end $$;
revoke all on function private.improvement_lookup(uuid,uuid,text,jsonb) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Reviewed actions: one shape check, one authorized context shared by preview and commitment.
------------------------------------------------------------------------------------------------
create function private.improvement_assert_shape(p_mutation jsonb) returns void language plpgsql set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_keys text[]; v_optional text[]:='{}'; v_noteless boolean; n text:=btrim(coalesce(p_mutation->>'note',''));
begin
  v_keys:=case a when 'problem.open' then array['title','category','description','owner_id'] when 'problem.link' then array['id','source_type','source_id']
    when 'problem.unlink' then array['id','link_id'] when 'problem.investigate' then array['id','cause','cause_basis']
    when 'problem.plan' then array['id','proposed_action','trial_scope','review_date','denominator'] when 'problem.trial' then array['id'] when 'problem.cancel_trial' then array['id']
    when 'problem.review' then array['id','decision','evidence'] when 'problem.reopen' then array['id'] when 'problem.reassign' then array['id','owner_id']
    when 'suggestion.submit' then array['category','source_path','description'] when 'suggestion.respond' then array['id','status','response']
    when 'suggestion.clarify' then array['id','clarification'] when 'suggestion.merge' then array['id','into_id'] when 'suggestion.link' then array['id']
    when 'suggestion.reassign' then array['id','owner_id'] when 'route.set' then array['category','owner_id']
    when 'threshold.propose' then array['basis','service_event','warn_at','rationale'] when 'threshold.approve' then array['id'] when 'threshold.retire' then array['id'] end;
  v_optional:=case a when 'problem.open' then array['containment'] when 'problem.investigate' then array['cause_evidence'] when 'problem.plan' then array['procedure_improvement_id']
    when 'suggestion.submit' then array['evidence'] when 'suggestion.respond' then array['decline_reason','internal_note']
    when 'suggestion.link' then array['problem_id','procedure_improvement_id'] when 'threshold.propose' then array['die_type'] else '{}'::text[] end;
  -- The employee's own words carry these actions; a second explanation would only add typing.
  v_noteless:=a in ('suggestion.submit','suggestion.respond','suggestion.clarify');
  if jsonb_typeof(p_mutation) is distinct from 'object' or v_keys is null or not(p_mutation ?& (v_keys||array['action']||case when v_noteless then '{}'::text[] else array['note'] end))
    or exists(select 1 from jsonb_object_keys(p_mutation) k where not(k=any(v_keys||v_optional||array['action']||case when v_noteless then '{}'::text[] else array['note'] end)))
    or (not v_noteless and (length(n) not between 5 and 500 or n ~ '[[:cntrl:]]'))
    or exists(select 1 from jsonb_each(p_mutation) x where jsonb_typeof(x.value)='null') then raise exception 'NOV: Review the required action details.'; end if;
end $$;
revoke all on function private.improvement_assert_shape(jsonb) from public,anon,authenticated;

create function private.improvement_member(p_company uuid,p_user uuid,p_managers_only boolean) returns public.app_users language plpgsql stable security definer set search_path=public,private as $$
declare u public.app_users;
begin
  select * into u from public.app_users where id=p_user and company_id=p_company and is_active and dealer_id is null and role not in ('viewer','dealer_admin','dealer_staff')
    and (not p_managers_only or role in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager','inventory_manager','sales_manager','accounts'));
  if u.id is null then raise exception 'NOV: Choose an active employee of this company%.',case when p_managers_only then ' who leads a department' else '' end; end if;
  return u;
end $$;
revoke all on function private.improvement_member(uuid,uuid,boolean) from public,anon,authenticated;

create function private.improvement_context(p_company uuid,p_actor uuid,p_mutation jsonb,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_role text; v_id uuid; v_id2 uuid; v_text text; v_date date; v_num numeric; v_lead boolean; v_x jsonb; v_y jsonb;
  v_warn jsonb:='[]'::jsonb; v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_source jsonb:='{}'::jsonb; v_today date:=private.ist_today();
  p public.improvement_problems; s public.improvement_suggestions; s2 public.improvement_suggestions; t public.die_service_thresholds; u public.app_users; l public.improvement_problem_links;
begin
  perform private.improvement_assert_shape(p_mutation);
  select role into v_role from public.app_users where id=p_actor and company_id=p_company and is_active and dealer_id is null;
  if not private.improvement_action_allowed(v_role,a) then raise exception 'Not permitted' using errcode='42501'; end if;

  -- NOV-053 ------------------------------------------------------------------------------------
  if a='problem.open' then
    v_text:=private.assurance_text(p_mutation,'title',5,120); perform private.assurance_text(p_mutation,'description',5,1000);
    if p_mutation->>'category' not in ('packing','dimensional','surface','dispatch','documentation','process','equipment','material','other') then raise exception 'NOV: Choose a problem category.'; end if;
    if p_mutation ? 'containment' then perform private.assurance_text(p_mutation,'containment',5,500); end if;
    u:=private.improvement_member(p_company,private.improvement_uuid(p_mutation,'owner_id'),false);
    if exists(select 1 from public.improvement_problems x where x.company_id=p_company and x.status<>'closed' and lower(x.title)=lower(v_text)) then
      v_warn:=v_warn||jsonb_build_array('An open problem with the same title exists. Link occurrences to it instead if it is the same issue.'); end if;
    v_title:='Open a recurring problem'; v_effect:='Records the problem with its improvement owner. Immediate containment, cause and verified improvement are kept as separate outcomes.';
    v_facts:=jsonb_build_object('Problem',v_text,'Category',replace(p_mutation->>'category','_',' '),'Improvement owner',coalesce(u.full_name,u.email));
  elsif a like 'problem.%' then
    v_id:=private.improvement_uuid(p_mutation,'id');
    if p_lock then perform 1 from public.improvement_problems where id=v_id and company_id=p_company for update; end if;
    select * into p from public.improvement_problems where id=v_id and company_id=p_company;
    if p.id is null then raise exception 'NOV: The problem is unavailable.'; end if;
    v_lead:=p.owner_id=p_actor or v_role in ('owner','admin','factory_manager','quality');
    v_source:=jsonb_build_object('status',p.status,'updated_at',p.updated_at,'owner',p.owner_id);
    v_facts:=jsonb_build_object('Problem',p.title,'Status',replace(p.status,'_',' '));
    if a='problem.link' then
      v_text:=p_mutation->>'source_type';
      if v_text not in ('quality_inspection','production_exception','task_exception','delivery_disposition','return_authorization','support_ticket','procedure_step_flag') then raise exception 'NOV: Choose the kind of occurrence.'; end if;
      v_id2:=private.improvement_uuid(p_mutation,'source_id');
      v_x:=private.improvement_incident(p_company,v_text,v_id2);
      if v_x is null then raise exception 'NOV: That occurrence is unavailable.'; end if;
      if not (v_x->>'eligible')::boolean then raise exception 'NOV: Only adverse occurrences can be linked: rejected or rework inspections, refused, damaged or short deliveries, and reported exceptions.'; end if;
      select * into l from public.improvement_problem_links where company_id=p_company and source_type=v_text and source_id=v_id2 and removed_at is null;
      if l.id is not null and l.problem_id=p.id then raise exception 'NOV: This occurrence is already linked to this problem.'; end if;
      if l.id is not null then raise exception 'NOV: This occurrence is already linked to "%". Remove it there first if it was linked by mistake.',(select title from public.improvement_problems where id=l.problem_id); end if;
      if p.status='closed' then v_warn:=v_warn||jsonb_build_array('This problem is closed. A new occurrence suggests the improvement did not hold; consider reopening it.'); end if;
      v_source:=v_source||jsonb_build_object('occurrence',v_x);
      v_title:='Link an occurrence'; v_effect:='Adds the occurrence to this problem. The source record is not changed.';
      v_facts:=v_facts||jsonb_build_object('Occurrence',v_x->>'label','Occurred',to_char((v_x->>'occurred_at')::timestamptz at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI'));
    elsif a='problem.unlink' then
      v_id2:=private.improvement_uuid(p_mutation,'link_id');
      select * into l from public.improvement_problem_links where id=v_id2 and company_id=p_company and problem_id=p.id and removed_at is null;
      if l.id is null then raise exception 'NOV: This occurrence is not linked to the problem.'; end if;
      if not v_lead and l.linked_by<>p_actor then raise exception 'NOV: The improvement owner, quality or the person who linked it removes an occurrence.'; end if;
      v_title:='Remove a wrongly linked occurrence'; v_effect:='Keeps the link in history with your reason; the occurrence can then be linked to the right problem.';
      v_facts:=v_facts||jsonb_build_object('Occurrence',l.label);
    elsif not v_lead and a not in ('problem.reopen','problem.reassign') then raise exception 'NOV: The improvement owner, quality or the factory manager updates this problem.';
    elsif a='problem.investigate' then
      if p.status not in ('open','investigating','planned') then raise exception 'NOV: The cause cannot change while the problem is %.',replace(p.status,'_',' '); end if;
      v_text:=private.assurance_text(p_mutation,'cause',5,800);
      if p_mutation->>'cause_basis' not in ('observation','established') then raise exception 'NOV: State whether the cause is an observation or established.'; end if;
      if p_mutation->>'cause_basis'='established' and not p_mutation ? 'cause_evidence' then raise exception 'NOV: An established cause needs its investigation evidence.'; end if;
      if p_mutation ? 'cause_evidence' then perform private.assurance_text(p_mutation,'cause_evidence',5,500); end if;
      v_title:='Record the cause'; v_effect:=case when p_mutation->>'cause_basis'='established' then 'Records an established cause with its evidence.' else 'Records an observation. It is shown as not yet established.' end;
      v_facts:=v_facts||jsonb_build_object('Cause',v_text,'Basis',p_mutation->>'cause_basis');
    elsif a='problem.plan' then
      if p.status not in ('investigating','planned') or p.cause is null then raise exception 'NOV: Record the cause before planning the improvement.'; end if;
      perform private.assurance_text(p_mutation,'proposed_action',5,800); perform private.assurance_text(p_mutation,'trial_scope',5,300);
      v_date:=private.assurance_date(p_mutation,'review_date');
      if v_date<=v_today or v_date>v_today+365 then raise exception 'NOV: Choose a review date after today and within a year.'; end if;
      if p_mutation->>'denominator' not in ('dispatches','production_jobs','inspections','tasks') then raise exception 'NOV: Choose what recurrence is measured against.'; end if;
      if p_mutation ? 'procedure_improvement_id' then
        v_id2:=private.improvement_uuid(p_mutation,'procedure_improvement_id');
        select title into v_text from public.procedure_improvements where id=v_id2 and company_id=p_company and status<>'rejected';
        if v_text is null then raise exception 'NOV: Choose a current procedure change.'; end if;
        v_facts:=v_facts||jsonb_build_object('Procedure change',v_text);
      end if;
      if p.cause_basis='observation' then v_warn:=v_warn||jsonb_build_array('The cause is an observation, not established. The trial tests the observation.'); end if;
      v_title:='Plan the improvement and its trial'; v_effect:='Records the proposed change, trial scope, review date and what recurrence is measured against.';
      v_facts:=v_facts||jsonb_build_object('Review date',to_char(v_date,'DD Mon YYYY'),'Measured per',replace(p_mutation->>'denominator','_',' '));
    elsif a='problem.trial' then
      if p.status<>'planned' then raise exception 'NOV: Plan the improvement before starting its trial.'; end if;
      v_title:='Start the trial'; v_effect:='Starts the trial now. Recurrence is compared with an equal window before this moment.';
      if p.procedure_improvement_id is null then v_warn:=v_warn||jsonb_build_array('No procedure change is linked. Link one if the trial changes an instruction.'); end if;
    elsif a='problem.cancel_trial' then
      if p.status<>'trial' then raise exception 'NOV: No trial is running.'; end if;
      v_title:='Cancel the trial'; v_effect:='Returns the problem to planned. The cancelled trial stays in history.';
    elsif a='problem.review' then
      if p.status<>'trial' then raise exception 'NOV: An effectiveness review needs a running trial.'; end if;
      if v_today<p.review_date then raise exception 'NOV: The agreed review date is %.',to_char(p.review_date,'DD Mon YYYY'); end if;
      if p_mutation->>'decision' not in ('effective','not_effective') then raise exception 'NOV: Choose effective or not effective.'; end if;
      perform private.assurance_text(p_mutation,'evidence',5,500);
      v_x:=private.problem_recurrence(p_company,p.id);
      if p_mutation->>'decision'='effective' and v_x->>'state'<>'complete' then raise exception 'NOV: The recurrence comparison is incomplete, so the improvement cannot be confirmed effective. Record not effective or wait for activity in both windows.'; end if;
      if p_mutation->>'decision'='effective' and (v_x->'trial'->>'rate_per_100')::numeric>=(v_x->'baseline'->>'rate_per_100')::numeric then
        v_warn:=v_warn||jsonb_build_array('The trial rate is not lower than the baseline rate. Explain the evidence for effectiveness.'); end if;
      v_source:=v_source||jsonb_build_object('recurrence',v_x);
      v_title:=case when p_mutation->>'decision'='effective' then 'Close after the effectiveness review' else 'Record the trial as not effective' end;
      v_effect:=case when p_mutation->>'decision'='effective' then 'Closes the problem with the recurrence comparison retained. It can be reopened if it recurs.' else 'Returns the problem to investigation with this review retained.' end;
      v_facts:=v_facts||jsonb_build_object('Baseline per 100',v_x->'baseline'->'rate_per_100','Trial per 100',v_x->'trial'->'rate_per_100','Window (days)',v_x->'window_days','Comparison',v_x->>'state');
    elsif a='problem.reopen' then
      if p.status<>'closed' then raise exception 'NOV: Only a closed problem can be reopened.'; end if;
      v_title:='Reopen the problem'; v_effect:='Returns the problem to investigation. The previous review stays in history.';
    elsif a='problem.reassign' then
      u:=private.improvement_member(p_company,private.improvement_uuid(p_mutation,'owner_id'),false);
      if u.id=p.owner_id then raise exception 'NOV: This person already owns the problem.'; end if;
      if p.status='closed' then raise exception 'NOV: Reopen the problem before changing its owner.'; end if;
      v_title:='Change the improvement owner'; v_effect:='Moves accountability for the problem to the chosen person.';
      v_facts:=v_facts||jsonb_build_object('New owner',coalesce(u.full_name,u.email));
    else raise exception 'NOV: Choose a supported action.';
    end if;

  -- NOV-059 ------------------------------------------------------------------------------------
  elsif a='suggestion.submit' then
    if p_mutation->>'category' not in ('unnecessary_entry','confusing_instruction','repeated_lookup','avoidable_waiting','other') then raise exception 'NOV: Choose what kind of friction this is.'; end if;
    v_text:=private.assurance_text(p_mutation,'source_path',1,200);
    if v_text !~ '^/[A-Za-z0-9/_.-]{0,200}$' or v_text ~ '(//|\.\.)' then raise exception 'NOV: The screen reference is not a page of this application.'; end if;
    perform private.assurance_text(p_mutation,'description',10,1000);
    if p_mutation ? 'evidence' then perform private.assurance_text(p_mutation,'evidence',5,500); end if;
    select r.owner_id into v_id from public.improvement_suggestion_routes r join public.app_users x on x.id=r.owner_id and x.company_id=r.company_id and x.is_active and x.dealer_id is null
      where r.company_id=p_company and r.category=p_mutation->>'category';
    if v_id is null then select x.id into v_id from public.app_users x where x.company_id=p_company and x.is_active and x.dealer_id is null and x.role in ('owner','admin')
      order by (x.role='owner') desc,x.created_at,x.id limit 1; end if;
    if v_id is null then raise exception 'NOV: No process owner is available to receive suggestions. Ask an administrator to set up routing.'; end if;
    v_source:=jsonb_build_object('owner',v_id);
    v_title:='Send an improvement suggestion'; v_effect:='Routes your suggestion to the process owner. You can follow its progress under My suggestions.';
    v_facts:=jsonb_build_object('Kind',replace(p_mutation->>'category','_',' '),'Screen',v_text,'Routed to',private.improvement_user_name(p_company,v_id));
  elsif a like 'suggestion.%' then
    v_id:=private.improvement_uuid(p_mutation,'id');
    if p_lock then perform 1 from public.improvement_suggestions where id=v_id and company_id=p_company for update; end if;
    select * into s from public.improvement_suggestions where id=v_id and company_id=p_company;
    if s.id is null or not (v_role in ('owner','admin','factory_manager','quality') or s.owner_id=p_actor or s.contributor_id=p_actor) then raise exception 'NOV: The suggestion is unavailable.'; end if;
    v_lead:=s.owner_id=p_actor or v_role in ('owner','admin');
    v_source:=jsonb_build_object('status',s.status,'updated_at',s.updated_at,'owner',s.owner_id);
    v_facts:=jsonb_build_object('Suggestion',s.reference,'Status',replace(s.status,'_',' '));
    if a='suggestion.clarify' then
      if s.contributor_id<>p_actor then raise exception 'NOV: Only the person who made the suggestion adds the clarification.'; end if;
      if s.status<>'clarification' then raise exception 'NOV: No clarification was requested.'; end if;
      perform private.assurance_text(p_mutation,'clarification',5,800);
      v_title:='Add the requested clarification'; v_effect:='Returns the suggestion to the process owner.';
    elsif not v_lead then raise exception 'NOV: The assigned process owner handles this suggestion.';
    elsif a='suggestion.respond' then
      v_text:=p_mutation->>'status';
      if not ((s.status='submitted' and v_text in ('acknowledged','clarification','trial','adopted','declined')) or (s.status='acknowledged' and v_text in ('clarification','trial','adopted','declined'))
        or (s.status='clarification' and v_text in ('acknowledged','trial','declined')) or (s.status='trial' and v_text in ('adopted','declined')) or (s.status='adopted' and v_text='resolved')) then
        raise exception 'NOV: A suggestion cannot move from % to %.',replace(s.status,'_',' '),replace(coalesce(v_text,'?'),'_',' '); end if;
      perform private.assurance_text(p_mutation,'response',5,800);
      if (v_text='declined')<>(p_mutation ? 'decline_reason') then raise exception 'NOV: A declined suggestion states the reason, and only a declined one has a decline reason.'; end if;
      if p_mutation ? 'decline_reason' then perform private.assurance_text(p_mutation,'decline_reason',5,500); end if;
      if p_mutation ? 'internal_note' then perform private.assurance_text(p_mutation,'internal_note',5,800); end if;
      if v_text='resolved' and s.problem_id is null and s.procedure_improvement_id is null then v_warn:=v_warn||jsonb_build_array('No problem or procedure change is linked. State in the response what changed.'); end if;
      v_title:='Respond to the suggestion'; v_effect:='Moves the suggestion to '||replace(v_text,'_',' ')||' and tells the contributor. The internal note stays with process owners.';
      v_facts:=v_facts||jsonb_build_object('Move to',replace(v_text,'_',' '));
    elsif a='suggestion.merge' then
      if s.status in ('declined','resolved','merged') then raise exception 'NOV: A % suggestion cannot be merged.',s.status; end if;
      v_id2:=private.improvement_uuid(p_mutation,'into_id');
      if v_id2=s.id then raise exception 'NOV: Choose another suggestion to merge into.'; end if;
      if p_lock then perform 1 from public.improvement_suggestions where id=v_id2 and company_id=p_company for update; end if;
      select * into s2 from public.improvement_suggestions where id=v_id2 and company_id=p_company;
      if s2.id is null or s2.status in ('merged','declined') then raise exception 'NOV: The suggestion to merge into must be current and not itself merged.'; end if;
      v_source:=v_source||jsonb_build_object('target_status',s2.status);
      v_title:='Merge a duplicate suggestion'; v_effect:='Marks this suggestion as a duplicate of '||s2.reference||'. Both stay in history and the contributor is told.';
      v_facts:=v_facts||jsonb_build_object('Merge into',s2.reference);
    elsif a='suggestion.link' then
      if s.status in ('declined','merged') then raise exception 'NOV: A % suggestion is not linked to further work.',s.status; end if;
      if not (p_mutation ? 'problem_id' or p_mutation ? 'procedure_improvement_id') then raise exception 'NOV: Choose a problem or a procedure change to link.'; end if;
      if p_mutation ? 'problem_id' then
        select title into v_text from public.improvement_problems where id=private.improvement_uuid(p_mutation,'problem_id') and company_id=p_company;
        if v_text is null then raise exception 'NOV: The problem is unavailable.'; end if;
        v_facts:=v_facts||jsonb_build_object('Problem',v_text);
      end if;
      if p_mutation ? 'procedure_improvement_id' then
        select title into v_text from public.procedure_improvements where id=private.improvement_uuid(p_mutation,'procedure_improvement_id') and company_id=p_company and status<>'rejected';
        if v_text is null then raise exception 'NOV: Choose a current procedure change.'; end if;
        v_facts:=v_facts||jsonb_build_object('Procedure change',v_text);
      end if;
      v_title:='Link the suggestion to improvement work'; v_effect:='Connects the suggestion to the problem or trial it led to, so the contributor can see what became of it.';
    elsif a='suggestion.reassign' then
      if s.status in ('declined','resolved','merged') then raise exception 'NOV: A % suggestion is closed.',s.status; end if;
      u:=private.improvement_member(p_company,private.improvement_uuid(p_mutation,'owner_id'),true);
      if u.id=s.owner_id then raise exception 'NOV: This person already owns the suggestion.'; end if;
      v_title:='Route to another process owner'; v_effect:='Moves the suggestion to the chosen process owner.';
      v_facts:=v_facts||jsonb_build_object('New owner',coalesce(u.full_name,u.email));
    else raise exception 'NOV: Choose a supported action.';
    end if;
  elsif a='route.set' then
    if p_mutation->>'category' not in ('unnecessary_entry','confusing_instruction','repeated_lookup','avoidable_waiting','other') then raise exception 'NOV: Choose a suggestion kind.'; end if;
    u:=private.improvement_member(p_company,private.improvement_uuid(p_mutation,'owner_id'),true);
    v_source:=coalesce((select jsonb_build_object('owner',owner_id) from public.improvement_suggestion_routes where company_id=p_company and category=p_mutation->>'category'),'{}'::jsonb);
    v_title:='Route a kind of suggestion'; v_effect:='New suggestions of this kind go to the chosen process owner. Existing suggestions keep their owner.';
    v_facts:=jsonb_build_object('Kind',replace(p_mutation->>'category','_',' '),'Process owner',coalesce(u.full_name,u.email));

  -- NOV-025 ------------------------------------------------------------------------------------
  elsif a='threshold.propose' then
    if p_mutation ? 'die_type' and p_mutation->>'die_type' not in ('solid','hollow','semi_hollow','porthole','bridge','feeder','multi_cavity','flat','special') then raise exception 'NOV: Choose a die type.'; end if;
    if p_mutation->>'basis' not in ('kg_since_service','runs_since_service','days_since_service') then raise exception 'NOV: Choose what the threshold counts.'; end if;
    if p_mutation->>'service_event' not in ('nitriding','correction','any') then raise exception 'NOV: Choose the service the count restarts after.'; end if;
    v_num:=case when p_mutation->>'basis'='kg_since_service' then private.assurance_number(p_mutation,'warn_at',1,100000000,3) else private.assurance_number(p_mutation,'warn_at',1,100000,0) end;
    perform private.assurance_text(p_mutation,'rationale',5,500);
    if exists(select 1 from public.die_service_thresholds x where x.company_id=p_company and x.status='approved' and coalesce(x.die_type,'*')=coalesce(p_mutation->>'die_type','*')
      and x.basis=p_mutation->>'basis' and x.service_event=p_mutation->>'service_event') then v_warn:=v_warn||jsonb_build_array('An approved threshold exists for this scope. Approval of this proposal replaces it.'); end if;
    v_title:='Propose a die service threshold'; v_effect:='Records a proposal. It warns planners only after a second person approves it, and never blocks production.';
    v_facts:=jsonb_build_object('Dies',coalesce(replace(p_mutation->>'die_type','_',' '),'all'),'Counts',replace(p_mutation->>'basis','_',' '),'Restarts after',p_mutation->>'service_event','Warn at',v_num);
  elsif a like 'threshold.%' then
    v_id:=private.improvement_uuid(p_mutation,'id');
    if p_lock then perform 1 from public.die_service_thresholds where id=v_id and company_id=p_company for update; end if;
    select * into t from public.die_service_thresholds where id=v_id and company_id=p_company;
    if t.id is null then raise exception 'NOV: The threshold is unavailable.'; end if;
    v_source:=jsonb_build_object('status',t.status);
    v_facts:=jsonb_build_object('Counts',replace(t.basis,'_',' '),'Warn at',t.warn_at,'Dies',coalesce(replace(t.die_type,'_',' '),'all'));
    if a='threshold.approve' then
      if t.status<>'proposed' then raise exception 'NOV: Only a proposed threshold can be approved.'; end if;
      if t.proposed_by=p_actor then raise exception 'NOV: A second person approves a threshold proposal.'; end if;
      v_y:=(select jsonb_build_object('id',x.id,'warn_at',x.warn_at) from public.die_service_thresholds x where x.company_id=p_company and x.status='approved' and coalesce(x.die_type,'*')=coalesce(t.die_type,'*')
        and x.basis=t.basis and x.service_event=t.service_event);
      if v_y is not null then v_warn:=v_warn||jsonb_build_array(format('Replaces the approved threshold at %s.',trim_scale((v_y->>'warn_at')::numeric))); v_source:=v_source||jsonb_build_object('replaces',v_y->>'id'); end if;
      v_title:='Approve the threshold'; v_effect:='Planners see a warning on dies that reach this count. Production is not blocked.';
    elsif a='threshold.retire' then
      if t.status='retired' then raise exception 'NOV: This threshold is already retired.'; end if;
      v_title:='Retire the threshold'; v_effect:='Stops warnings from this threshold. It stays in history.';
    else raise exception 'NOV: Choose a supported action.';
    end if;
  else raise exception 'NOV: Choose a supported action.';
  end if;
  return jsonb_build_object('source',v_source,'review',jsonb_build_object('title',v_title,'effect',v_effect,'warnings',v_warn,'facts',v_facts));
end $$;
revoke all on function private.improvement_context(uuid,uuid,jsonb,boolean) from public,anon,authenticated;

create function private.improvement_notify(p_company uuid,p_actor uuid,p_recipient uuid,p_title text,p_body text,p_entity uuid,p_link text) returns void language sql security definer set search_path=public,private as $$
  insert into public.notifications(company_id,recipient_user_id,notification_type,severity,title,body,related_entity_type,related_entity_id,action_link,created_by)
  select p_company,p_recipient,'improvement_suggestion','info',left(p_title,200),left(p_body,800),'improvement_suggestion',p_entity,p_link,p_actor where p_recipient is distinct from p_actor
$$;
revoke all on function private.improvement_notify(uuid,uuid,uuid,text,text,uuid,text) from public,anon,authenticated;

create function private.improvement_apply(p_company uuid,p_actor uuid,p_request uuid,p_mutation jsonb,p_context jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; n text:=btrim(coalesce(p_mutation->>'note','')); v_id uuid:=(p_mutation->>'id')::uuid; v_x jsonb; v_ref text; v_owner uuid;
  s public.improvement_suggestions; v_status text; v_link text;
begin
  if a='problem.open' then
    insert into public.improvement_problems(id,company_id,title,category,description,containment,owner_id,created_by)
    values(p_request,p_company,btrim(p_mutation->>'title'),p_mutation->>'category',btrim(p_mutation->>'description'),nullif(btrim(coalesce(p_mutation->>'containment','')),''),(p_mutation->>'owner_id')::uuid,p_actor);
    perform private.improvement_record(p_company,'problems',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Problem opened','href','/tasks/improvement/problems/'||p_request,'message','Link its occurrences, then record the cause.');
  elsif a='problem.link' then
    v_x:=p_context->'source'->'occurrence';
    insert into public.improvement_problem_links(company_id,problem_id,source_type,source_id,occurred_at,label,linked_by)
    values(p_company,v_id,p_mutation->>'source_type',(p_mutation->>'source_id')::uuid,(v_x->>'occurred_at')::timestamptz,v_x->>'label',p_actor);
    update public.improvement_problems set updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='problem.unlink' then
    update public.improvement_problem_links set removed_at=clock_timestamp(),removed_by=p_actor,removed_reason=n where id=(p_mutation->>'link_id')::uuid and company_id=p_company and removed_at is null;
    update public.improvement_problems set updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='problem.investigate' then
    update public.improvement_problems set cause=btrim(p_mutation->>'cause'),cause_basis=p_mutation->>'cause_basis',cause_evidence=nullif(btrim(coalesce(p_mutation->>'cause_evidence','')),''),
      status=case when status='open' then 'investigating' else status end,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='problem.plan' then
    update public.improvement_problems set proposed_action=btrim(p_mutation->>'proposed_action'),trial_scope=btrim(p_mutation->>'trial_scope'),review_date=(p_mutation->>'review_date')::date,
      denominator=p_mutation->>'denominator',procedure_improvement_id=coalesce((p_mutation->>'procedure_improvement_id')::uuid,procedure_improvement_id),status='planned',updated_at=clock_timestamp()
    where id=v_id and company_id=p_company;
  elsif a='problem.trial' then
    update public.improvement_problems set status='trial',trial_started_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_id and company_id=p_company and status='planned';
  elsif a='problem.cancel_trial' then
    update public.improvement_problems set status='planned',trial_started_at=null,updated_at=clock_timestamp() where id=v_id and company_id=p_company and status='trial';
  elsif a='problem.review' then
    v_x:=jsonb_build_object('decision',p_mutation->>'decision','evidence',btrim(p_mutation->>'evidence'),'recurrence',p_context->'source'->'recurrence','reviewed_by',p_actor,'reviewed_at',clock_timestamp());
    if p_mutation->>'decision'='effective' then
      update public.improvement_problems set status='closed',outcome=v_x,closed_at=clock_timestamp(),closed_by=p_actor,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    else
      update public.improvement_problems set status='investigating',outcome=v_x,trial_started_at=null,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    end if;
  elsif a='problem.reopen' then
    update public.improvement_problems set status='investigating',closed_at=null,closed_by=null,trial_started_at=null,reopened_count=reopened_count+1,updated_at=clock_timestamp() where id=v_id and company_id=p_company and status='closed';
  elsif a='problem.reassign' then
    update public.improvement_problems set owner_id=(p_mutation->>'owner_id')::uuid,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  end if;
  if a like 'problem.%' then
    perform private.improvement_record(p_company,'problems',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label',p_context->'review'->>'title','href','/tasks/improvement/problems/'||v_id,'message','The problem record shows the change.');
  end if;

  if a='suggestion.submit' then
    v_owner:=(p_context->'source'->>'owner')::uuid;
    v_ref:='SUG-'||lpad(((select count(*) from public.improvement_suggestions x where x.company_id=p_company)+1)::text,4,'0');
    insert into public.improvement_suggestions(id,company_id,reference,category,source_path,description,evidence,contributor_id,owner_id)
    values(p_request,p_company,v_ref,p_mutation->>'category',btrim(p_mutation->>'source_path'),btrim(p_mutation->>'description'),nullif(btrim(coalesce(p_mutation->>'evidence','')),''),p_actor,v_owner);
    perform private.improvement_record(p_company,'suggestions',p_request,a,p_actor,left(btrim(p_mutation->>'description'),500),p_context->'review'->'facts');
    perform private.improvement_notify(p_company,p_actor,v_owner,'New improvement suggestion '||v_ref,left(btrim(p_mutation->>'description'),300),p_request,'/tasks/improvement/suggestions/'||p_request);
    return jsonb_build_object('label','Suggestion '||v_ref||' sent','href','/tasks/improvement/suggestions/'||p_request,'message','The process owner is notified. You will see their response here.');
  end if;
  v_link:='/tasks/improvement/suggestions/'||v_id;
  select * into s from public.improvement_suggestions where id=v_id and company_id=p_company;
  if a='suggestion.respond' then
    v_status:=p_mutation->>'status';
    update public.improvement_suggestions set status=v_status,response=btrim(p_mutation->>'response'),decline_reason=case when v_status='declined' then btrim(p_mutation->>'decline_reason') end,
      internal_note=coalesce(nullif(btrim(coalesce(p_mutation->>'internal_note','')),''),internal_note),responded_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    perform private.improvement_record(p_company,'suggestions',v_id,a,p_actor,btrim(p_mutation->>'response'),p_context->'review'->'facts');
    perform private.improvement_notify(p_company,p_actor,s.contributor_id,'Your suggestion '||s.reference||' is now '||replace(v_status,'_',' '),btrim(p_mutation->>'response'),v_id,v_link);
  elsif a='suggestion.clarify' then
    update public.improvement_suggestions set status='acknowledged',clarification=btrim(p_mutation->>'clarification'),updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    perform private.improvement_record(p_company,'suggestions',v_id,a,p_actor,btrim(p_mutation->>'clarification'),p_context->'review'->'facts');
    perform private.improvement_notify(p_company,p_actor,s.owner_id,'Clarification added to '||s.reference,btrim(p_mutation->>'clarification'),v_id,v_link);
  elsif a='suggestion.merge' then
    update public.improvement_suggestions set status='merged',merged_into_id=(p_mutation->>'into_id')::uuid,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    perform private.improvement_record(p_company,'suggestions',v_id,a,p_actor,n,p_context->'review'->'facts');
    perform private.improvement_notify(p_company,p_actor,s.contributor_id,'Your suggestion '||s.reference||' was merged with a similar one','It is followed under '||(p_context->'review'->'facts'->>'Merge into')||'. '||n,v_id,v_link);
  elsif a='suggestion.link' then
    update public.improvement_suggestions set problem_id=coalesce((p_mutation->>'problem_id')::uuid,problem_id),procedure_improvement_id=coalesce((p_mutation->>'procedure_improvement_id')::uuid,procedure_improvement_id),
      updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    perform private.improvement_record(p_company,'suggestions',v_id,a,p_actor,n,p_context->'review'->'facts');
    perform private.improvement_notify(p_company,p_actor,s.contributor_id,'Your suggestion '||s.reference||' is linked to improvement work',n,v_id,v_link);
  elsif a='suggestion.reassign' then
    update public.improvement_suggestions set owner_id=(p_mutation->>'owner_id')::uuid,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    perform private.improvement_record(p_company,'suggestions',v_id,a,p_actor,n,p_context->'review'->'facts');
    perform private.improvement_notify(p_company,p_actor,(p_mutation->>'owner_id')::uuid,'Suggestion '||s.reference||' routed to you',n,v_id,v_link);
  elsif a='route.set' then
    insert into public.improvement_suggestion_routes(company_id,category,owner_id,updated_by) values(p_company,p_mutation->>'category',(p_mutation->>'owner_id')::uuid,p_actor)
      on conflict(company_id,category) do update set owner_id=excluded.owner_id,updated_by=excluded.updated_by,updated_at=clock_timestamp();
    perform private.improvement_record(p_company,'suggestions',md5(p_company::text||':route:'||(p_mutation->>'category'))::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Routing saved','href','/tasks/improvement/database?view=suggestions','message','New suggestions of this kind go to the chosen process owner.');
  end if;
  if a like 'suggestion.%' then return jsonb_build_object('label',p_context->'review'->>'title','href',v_link,'message','The suggestion shows the change and the contributor is notified.'); end if;

  if a='threshold.propose' then
    insert into public.die_service_thresholds(id,company_id,die_type,basis,service_event,warn_at,rationale,proposed_by)
    values(p_request,p_company,p_mutation->>'die_type',p_mutation->>'basis',p_mutation->>'service_event',(p_mutation->>'warn_at')::numeric,btrim(p_mutation->>'rationale'),p_actor);
    perform private.improvement_record(p_company,'thresholds',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Threshold proposed','href','/tasks/improvement/thresholds/'||p_request,'message','A second person approves it before planners see warnings.');
  elsif a='threshold.approve' then
    if p_context->'source' ? 'replaces' then
      update public.die_service_thresholds set status='retired',retired_by=p_actor,retired_at=clock_timestamp() where id=(p_context->'source'->>'replaces')::uuid and company_id=p_company and status='approved';
      perform private.improvement_record(p_company,'thresholds',(p_context->'source'->>'replaces')::uuid,'threshold.retire',p_actor,'Replaced by a newly approved threshold: '||n,'{}'::jsonb);
    end if;
    update public.die_service_thresholds set status='approved',approved_by=p_actor,approved_at=clock_timestamp() where id=v_id and company_id=p_company and status='proposed';
  elsif a='threshold.retire' then
    update public.die_service_thresholds set status='retired',retired_by=p_actor,retired_at=clock_timestamp() where id=v_id and company_id=p_company and status<>'retired';
  end if;
  if a like 'threshold.%' then
    perform private.improvement_record(p_company,'thresholds',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label',p_context->'review'->>'title','href','/tasks/improvement/thresholds/'||v_id,'message','Die warnings reflect the change immediately.');
  end if;
  raise exception 'NOV: Choose a supported action.';
end $$;
revoke all on function private.improvement_apply(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

create function private.improvement_outcome(r public.improvement_requests) returns jsonb language sql immutable set search_path=public,private as $$
  select jsonb_build_object('request_id',r.request_id,'state',r.state,'fingerprint',r.fingerprint,'expires_at',r.expires_at,'action',r.mutation->>'action','review',r.review,'result',r.result)
$$;
revoke all on function private.improvement_outcome(public.improvement_requests) from public,anon,authenticated;

create function public.improvement_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid();v_company uuid:=private.get_current_user_company_id();v_role text:=private.get_current_user_role();
  v_view text;v_page integer;v_search text;v_state text;v_sort text;v_status text;v_id uuid;v_total bigint;v_rows jsonb;v_row jsonb;v_events jsonb;v_private boolean;
  r public.improvement_requests%rowtype;v_context jsonb;v_fingerprint text;v_result jsonb;v_message text;v_keys text[];
begin
  if v_actor is null or v_company is null or not exists(select 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null)
    or not private.improvement_read_allowed(v_role,null) then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.app_users where id=v_actor and company_id=v_company for share;
  v_keys:=case p_command when 'list' then array['view','page','search','state','sort','status'] when 'detail' then array['view','id','page']
    when 'lookup' then array['kind','search','selected_id','filter'] when 'preview' then array['request_id','mutation'] when 'commit' then array['request_id','fingerprint']
    when 'outcome' then array['request_id'] when 'abandon' then array['request_id'] end;
  if jsonb_typeof(p_payload) is distinct from 'object' or v_keys is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(v_keys))) then raise exception 'NOV: Invalid improvement request.'; end if;
  if p_command in ('list','detail') then
    v_view:=p_payload->>'view';v_page:=coalesce((p_payload->>'page')::integer,1);v_search:=btrim(coalesce(p_payload->>'search',''));
    v_state:=coalesce(p_payload->>'state','active');v_sort:=coalesce(p_payload->>'sort','priority');v_status:=nullif(btrim(coalesce(p_payload->>'status','')),'');
    if v_view is null or v_view not in ('problems','suggestions','outcomes','dies','thresholds') or not private.improvement_read_allowed(v_role,v_view) then raise exception 'Not permitted' using errcode='42501'; end if;
    if v_page not between 1 and 100000 or length(v_search)>80 or v_state not in ('active','all') or v_sort not in ('priority','newest','due') or coalesce(v_status,'x') !~ '^[a-z_]{1,40}$' then raise exception 'NOV: Invalid improvement filters.'; end if;
    if p_command='detail' then
      v_id:=private.improvement_uuid(p_payload,'id');
      select row_data into v_row from private.improvement_rows(v_company,v_actor,v_role,v_view,'all',v_id) limit 1;
      if v_row is null then raise exception 'NOV: This record is unavailable.'; end if;
      select count(*) into v_total from public.improvement_events where company_id=v_company and view_name=v_view and entity_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(x) order by recorded_at desc,id),'[]'::jsonb) into v_events from (
        select id,action,actor_name as actor,note,recorded_at from public.improvement_events where company_id=v_company and view_name=v_view and entity_id=v_id order by recorded_at desc,id limit 10 offset (v_page-1)*10
      ) x;
      return jsonb_build_object('row',v_row,'events',v_events,'event_count',v_total,'as_of',now());
    end if;
    with visible as (select * from private.improvement_rows(v_company,v_actor,v_role,v_view,v_state,null) where (v_status is null or row_data->>'status'=v_status)
      and (v_search='' or position(lower(v_search) in lower(coalesce(row_data->>'label','')||' '||coalesce(row_data->>'status','')||' '||coalesce(row_data->>'owner','')||' '||coalesce(row_data->>'summary','')))>0))
    select (select count(*) from visible),coalesce((select jsonb_agg(x.row_data order by x.position) from (
      select row_data,row_number() over(order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id')) as position
      from visible order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id') limit 10 offset (v_page-1)*10
    ) x),'[]'::jsonb) into v_total,v_rows;
    return jsonb_build_object('rows',v_rows,'total_count',v_total,'as_of',now());
  elsif p_command='lookup' then
    if length(coalesce(p_payload->>'search',''))>80 or coalesce(p_payload->>'filter','x') !~ '^[a-z_]{1,40}$' then raise exception 'NOV: Keep search within 80 characters.'; end if;
    return private.improvement_lookup(v_company,v_actor,v_role,p_payload);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':improvement',0));
  v_id:=private.improvement_uuid(p_payload,'request_id');
  select * into r from public.improvement_requests where request_id=v_id for update;
  if found and (r.company_id<>v_company or r.actor_id<>v_actor) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_command='preview' then
    if r.request_id is not null then
      if r.mutation is distinct from p_payload->'mutation' then raise exception 'NOV: This request identity belongs to different details.'; end if;
      if not private.improvement_action_allowed(v_role,r.mutation->>'action') then raise exception 'Not permitted' using errcode='42501'; end if;
      return private.improvement_outcome(r);
    end if;
    v_context:=private.improvement_context(v_company,v_actor,p_payload->'mutation',false);
    v_fingerprint:=md5((v_context->'source')::text||(p_payload->'mutation')::text);
    insert into public.improvement_requests(request_id,company_id,actor_id,mutation,fingerprint,review)
      values(v_id,v_company,v_actor,p_payload->'mutation',v_fingerprint,v_context->'review') returning * into r;
  else
    if r.request_id is null then
      if p_command in ('outcome','abandon') then return jsonb_build_object('request_id',v_id,'state','not_recorded','fingerprint',repeat('0',32),'expires_at',now(),'action','',
        'review',jsonb_build_object('title','Original request check','effect','No prepared or committed action exists for this original request.','warnings','[]'::jsonb,'facts','{}'::jsonb),
        'result',jsonb_build_object('label','Not recorded','href',null,'message','No change was committed with this original request identity. It is safe to start a reviewed action.')); end if;
      raise exception 'NOV: The original request was not found. No action was committed with that request identity.';
    end if;
    if (p_command='commit' and not private.improvement_action_allowed(v_role,r.mutation->>'action'))
      or (p_command in ('outcome','abandon') and not private.improvement_read_allowed(v_role,private.improvement_view(r.mutation->>'action'))) then raise exception 'Not permitted' using errcode='42501'; end if;
    if p_command='commit' and r.state='prepared' then
      if r.fingerprint is distinct from p_payload->>'fingerprint' then raise exception 'NOV: Confirmation does not match the reviewed request.'; end if;
      begin
        if r.expires_at<=now() then raise exception 'NOV: This review expired. Review the current source again.'; end if;
        v_context:=private.improvement_context(v_company,v_actor,r.mutation,true);
        if r.fingerprint<>md5((v_context->'source')::text||r.mutation::text) then raise exception 'NOV: A relevant source changed. Review the current details again.'; end if;
        v_result:=private.improvement_apply(v_company,v_actor,v_id,r.mutation,v_context);
        update public.improvement_requests set state='confirmed',result=v_result where request_id=v_id returning * into r;
      exception when others then
        v_message:=case when sqlstate='P0001' and sqlerrm like 'NOV: %' then substring(sqlerrm from 6)
          when sqlstate in ('23514','23P01','55P03') and sqlerrm not like '%violates%' and sqlerrm not like '%constraint%' then sqlerrm
          else 'The existing workflow rejected this action. No change from this request was committed. Refresh the source and review its current requirements.' end;
        update public.improvement_requests set state='rejected',result=jsonb_build_object('label',r.review->>'title','href',null,'message',v_message) where request_id=v_id returning * into r;
      end;
    elsif p_command='abandon' and r.state='prepared' then
      update public.improvement_requests set state='abandoned',result=jsonb_build_object('label',r.review->>'title','href',null,'message','Review cancelled. This request made no change.') where request_id=v_id returning * into r;
    elsif p_command not in ('commit','outcome','abandon') then raise exception 'NOV: Invalid improvement request.';
    end if;
  end if;
  return private.improvement_outcome(r);
end $$;
revoke all on function public.improvement_command(text,jsonb) from public,anon;
grant execute on function public.improvement_command(text,jsonb) to authenticated;

------------------------------------------------------------------------------------------------
-- NOV-009: lineage for a record started from a previous one. Only the person who just created the
-- new record can link it, only to a source in the same company, and only the reviewed copy fields.
------------------------------------------------------------------------------------------------
create function public.record_repeat_link(p_resource text,p_source uuid,p_target uuid,p_fields text[]) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid(); v_company uuid:=private.get_current_user_company_id(); v_allowed text[]; v_source jsonb; v_target jsonb; v_id uuid;
begin
  if v_actor is null or v_company is null or not exists(select 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null and role not in ('viewer','dealer_admin','dealer_staff')) then
    raise exception 'Not permitted' using errcode='42501'; end if;
  v_allowed:=case p_resource when 'production_jobs' then array['machine_id','shift','extrusion_efficiency_percent']
    when 'dispatches' then array['order_id','transporter_name','vehicle_number','driver_name','driver_phone']
    when 'packaging_material_purchases' then array['material_id','vendor_id','unit','rate','payment_method'] end;
  if v_allowed is null or p_source is null or p_target is null or p_source=p_target or coalesce(cardinality(p_fields),0) not between 1 and 10 or not (p_fields <@ v_allowed) then
    raise exception 'NOV: Invalid repeat lineage.'; end if;
  execute format('select to_jsonb(x) from (select id,created_by,created_at from public.%I where company_id=$1 and id=$2) x',p_resource) into v_source using v_company,p_source;
  execute format('select to_jsonb(x) from (select id,created_by,created_at from public.%I where company_id=$1 and id=$2) x',p_resource) into v_target using v_company,p_target;
  if v_source is null or v_target is null then raise exception 'NOV: The source or the new record is unavailable.'; end if;
  if (v_target->>'created_at')::timestamptz<now()-interval '2 hours' or (v_target->>'created_by' is not null and (v_target->>'created_by')::uuid<>v_actor) then
    raise exception 'NOV: Only the person who just created the record can record where it was repeated from.'; end if;
  if (v_source->>'created_at')::timestamptz>(v_target->>'created_at')::timestamptz then raise exception 'NOV: A record can only repeat an earlier record.'; end if;
  insert into public.record_repeat_links(company_id,resource,source_id,target_id,copied_fields,created_by) values(v_company,p_resource,p_source,p_target,p_fields,v_actor)
    on conflict(company_id,resource,target_id) do nothing returning id into v_id;
  if v_id is null then raise exception 'NOV: This record already has a repeat source.'; end if;
  return jsonb_build_object('id',v_id,'resource',p_resource,'source_id',p_source,'target_id',p_target);
end $$;
revoke all on function public.record_repeat_link(text,uuid,uuid,text[]) from public,anon;
grant execute on function public.record_repeat_link(text,uuid,uuid,text[]) to authenticated;
