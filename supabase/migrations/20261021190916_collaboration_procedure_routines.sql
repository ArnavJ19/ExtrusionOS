begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- The existing customer policy read quotes directly after direct quote SELECT was revoked.
-- Return only the dealer lineage predicate, retaining the current role/company boundary.
create function private.customer_has_current_dealer_record(p_customer uuid) returns boolean language sql stable security definer set search_path=public,private as $$
select coalesce(auth.uid() is not null and private.get_current_user_role() in ('dealer_admin','dealer_staff') and private.get_current_user_dealer_id() is not null and (
 exists(select 1 from public.quotes q where q.company_id=private.get_current_user_company_id() and q.customer_id=p_customer and q.dealer_id=private.get_current_user_dealer_id())
 or exists(select 1 from public.orders o where o.company_id=private.get_current_user_company_id() and o.customer_id=p_customer and o.dealer_id=private.get_current_user_dealer_id())
),false);
$$;
revoke all on function private.customer_has_current_dealer_record(uuid) from public,anon;
grant execute on function private.customer_has_current_dealer_record(uuid) to authenticated;
alter policy customers_access_read on public.customers using(
 (select auth.uid()) is not null and company_id=private.get_current_user_company_id() and (
  private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts','production_manager','factory_manager','dispatch_manager','dispatch','inventory_manager','quality','viewer')
  or private.customer_has_current_dealer_record(id)
 )
);
-- Status updates filter and return these safe fields. Pricing still requires quotes_authorized.
grant select(id,company_id,status) on public.quotes to authenticated;

create table public.record_discussions (
 id uuid primary key, company_id uuid not null references public.companies(id),
 entity_type text not null check(entity_type in ('order','production_job','dispatch','quality_inspection')), entity_id uuid not null,
 body text not null check(length(btrim(body)) between 1 and 2000), reference text not null check(length(reference)<=240),
 reply_to uuid references public.record_discussions(id), mentioned_ids uuid[] not null, mentioned_names text[] not null,
 recorded_by uuid not null references public.app_users(id), author_name text not null, recorded_at timestamptz not null default now(), request_payload jsonb not null
);
create index record_discussion_parent_idx on public.record_discussions(company_id,entity_type,entity_id,recorded_at desc,id);
create index record_discussion_reply_idx on public.record_discussions(company_id,reply_to);
create index record_discussion_actor_idx on public.record_discussions(company_id,recorded_by);

create table public.operating_procedures (
 id uuid primary key, company_id uuid not null references public.companies(id), title text not null check(length(btrim(title)) between 1 and 120),
 purpose text not null check(length(btrim(purpose)) between 1 and 800), scope_label text not null check(length(btrim(scope_label)) between 1 and 80),
 owner_id uuid not null references public.app_users(id), owner_name text not null, backup_id uuid references public.app_users(id), backup_name text,
 review_due date, reviewed_at timestamptz, routine_kind text not null check(routine_kind in ('none','opening','closing')),
 prompts jsonb not null check(jsonb_typeof(prompts)='array' and jsonb_array_length(prompts)<=6),
 revision integer not null default 1 check(revision>0), is_active boolean not null default true,
 created_by uuid not null references public.app_users(id), created_at timestamptz not null default now(), request_payload jsonb not null,
 check(backup_id is null or backup_id<>owner_id)
);
create unique index operating_procedure_name_idx on public.operating_procedures(company_id,lower(scope_label),lower(title));
create index operating_procedure_owner_idx on public.operating_procedures(company_id,owner_id);
create index operating_procedure_backup_idx on public.operating_procedures(company_id,backup_id);
create index operating_procedure_creator_idx on public.operating_procedures(company_id,created_by);
create index operating_procedure_queue_idx on public.operating_procedures(company_id,is_active,review_due,id);

create table public.operating_procedure_events (
 id uuid primary key, company_id uuid not null references public.companies(id), procedure_id uuid not null references public.operating_procedures(id),
 event_type text not null check(event_type in ('created','updated','reviewed')), previous_owner text, owner_name text not null, previous_backup text, backup_name text,
 note text not null, revision integer not null, recorded_by uuid not null references public.app_users(id), actor_name text not null,
 recorded_at timestamptz not null default now(), request_payload jsonb not null, metadata_snapshot jsonb not null
);
create index operating_procedure_event_parent_idx on public.operating_procedure_events(company_id,procedure_id,recorded_at desc,id);
create index operating_procedure_event_actor_idx on public.operating_procedure_events(company_id,recorded_by);

create table public.daily_routine_runs (
 id uuid primary key, company_id uuid not null references public.companies(id), procedure_id uuid not null references public.operating_procedures(id),
 title text not null, scope_label text not null, routine_kind text not null check(routine_kind in ('opening','closing')), business_date date not null,
 procedure_revision integer not null, prompts jsonb not null, started_by uuid not null references public.app_users(id), starter_name text not null,
 status text not null default 'open' check(status in ('open','completed')), created_at timestamptz not null default now(),
 unique(company_id,procedure_id,business_date)
);
create index daily_routine_queue_idx on public.daily_routine_runs(company_id,status,business_date desc,id);
create index daily_routine_actor_idx on public.daily_routine_runs(company_id,started_by);

create table public.daily_routine_completions (
 id uuid primary key, company_id uuid not null references public.companies(id), run_id uuid not null unique references public.daily_routine_runs(id),
 answers jsonb not null, outcome text not null check(length(btrim(outcome)) between 1 and 800), recorded_by uuid not null references public.app_users(id),
 actor_name text not null, recorded_at timestamptz not null default now(), source_snapshot jsonb not null, request_payload jsonb not null
);
create index daily_routine_completion_company_idx on public.daily_routine_completions(company_id,run_id);
create index daily_routine_completion_actor_idx on public.daily_routine_completions(company_id,recorded_by);

alter table public.record_discussions enable row level security;
alter table public.operating_procedures enable row level security;
alter table public.operating_procedure_events enable row level security;
alter table public.daily_routine_runs enable row level security;
alter table public.daily_routine_completions enable row level security;
revoke all on public.record_discussions,public.operating_procedures,public.operating_procedure_events,public.daily_routine_runs,public.daily_routine_completions from public,anon,authenticated;
-- Reads use the projection RPC as well: routine source snapshots and mentions must not become a second Data API surface.
create policy discussion_company_boundary on public.record_discussions for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy procedure_company_boundary on public.operating_procedures for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy procedure_event_company_boundary on public.operating_procedure_events for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy routine_company_boundary on public.daily_routine_runs for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);
create policy routine_completion_company_boundary on public.daily_routine_completions for select to authenticated using(company_id=(select private.get_current_user_company_id()) and (select private.get_current_user_dealer_id()) is null);

create function private.collaboration_can_read(p_role text,p_entity text) returns boolean language sql immutable set search_path=public,private as $$
select coalesce(case p_entity
 when 'order' then p_role in ('owner','admin','sales','sales_manager','factory_manager','production_manager','production','inventory_manager','dispatch_manager','dispatch','accounts','quality','viewer')
 when 'production_job' then p_role in ('owner','admin','factory_manager','production_manager','production','quality','viewer')
 when 'dispatch' then p_role in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch','accounts','viewer')
 when 'quality_inspection' then p_role in ('owner','admin','production_manager','quality','viewer')
 else false end,false);
$$;
revoke all on function private.collaboration_can_read(text,text) from public,anon,authenticated;

create function private.collaboration_record_visible(p_entity text,p_id uuid) returns boolean language plpgsql stable security definer set search_path=public,private as $$
declare v_company uuid:=private.get_current_user_company_id();v_role text:=private.get_current_user_role();
begin
 if auth.uid() is null or v_company is null or private.get_current_user_dealer_id() is not null or not private.collaboration_can_read(v_role,p_entity) then return false;end if;
 if p_entity='order' then return exists(select 1 from public.orders where id=p_id and company_id=v_company and deleted_at is null);
 elsif p_entity='production_job' then return exists(select 1 from public.production_jobs where id=p_id and company_id=v_company);
 elsif p_entity='dispatch' then return exists(select 1 from public.dispatches where id=p_id and company_id=v_company);
 elsif p_entity='quality_inspection' then return exists(select 1 from public.quality_inspections where id=p_id and company_id=v_company);end if;
 return false;
end;$$;
revoke all on function private.collaboration_record_visible(text,uuid) from public,anon,authenticated;

create function private.operating_procedure_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public,private as $$
select jsonb_build_object('id',p.id,'title',p.title,'purpose',p.purpose,'scope_label',p.scope_label,'owner_id',p.owner_id,'owner_name',coalesce(nullif(o.full_name,''),p.owner_name),
 'owner_available',coalesce(o.is_active and o.dealer_id is null and o.role not in ('viewer','dealer_admin','dealer_staff'),false),'backup_id',p.backup_id,'backup_name',coalesce(nullif(b.full_name,''),p.backup_name),
 'backup_available',coalesce(b.is_active and b.dealer_id is null and b.role not in ('viewer','dealer_admin','dealer_staff'),false),'review_due',p.review_due::text,'reviewed_at',p.reviewed_at::text,
 'routine_kind',p.routine_kind,'prompts',p.prompts,'revision',p.revision,'is_active',p.is_active)
from public.operating_procedures p join public.app_users o on o.id=p.owner_id and o.company_id=p.company_id left join public.app_users b on b.id=p.backup_id and b.company_id=p.company_id
where p.id=p_id and p.company_id=private.get_current_user_company_id();
$$;
revoke all on function private.operating_procedure_projection(uuid) from public,anon,authenticated;

create function private.daily_routine_projection(p_id uuid) returns jsonb language sql stable security definer set search_path=public,private as $$
select jsonb_build_object('id',r.id,'procedure_id',r.procedure_id,'title',r.title,'scope_label',r.scope_label,'routine_kind',r.routine_kind,'business_date',r.business_date::text,
 'procedure_revision',r.procedure_revision,'prompts',r.prompts,'started_by',r.started_by,'starter_name',r.starter_name,'status',r.status,
 'completed_at',c.recorded_at::text,'completed_by_name',c.actor_name,'answers',c.answers,'outcome',c.outcome)
from public.daily_routine_runs r left join public.daily_routine_completions c on c.run_id=r.id and c.company_id=r.company_id
where r.id=p_id and r.company_id=private.get_current_user_company_id();
$$;
revoke all on function private.daily_routine_projection(uuid) from public,anon,authenticated;

create function private.daily_routine_sources() returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_company uuid:=private.get_current_user_company_id();v_actor uuid:=auth.uid();v_role text:=private.get_current_user_role();v_today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_tasks jsonb;v_jobs jsonb;v_holds jsonb;v_exceptions jsonb;v_count bigint;v_carried bigint;v_changed timestamptz;v_rows jsonb;
begin
 select count(*),count(*) filter(where due_date<v_today),max(updated_at) into v_count,v_carried,v_changed from public.tasks where company_id=v_company and assigned_to=v_actor and dealership_id is null and status in ('open','in_progress');
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_rows from(select id,title as label,status from public.tasks where company_id=v_company and assigned_to=v_actor and dealership_id is null and status in ('open','in_progress') order by due_date nulls last,id limit 5)t;
 v_tasks:=jsonb_build_object('count',v_count,'carried',v_carried,'changed_at',v_changed::text,'rows',v_rows);
 if private.collaboration_can_read(v_role,'production_job') then
  select count(*),count(*) filter(where (created_at at time zone 'Asia/Kolkata')::date<v_today),max(updated_at) into v_count,v_carried,v_changed from public.production_jobs where company_id=v_company and status not in ('completed','cancelled');
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_rows from(select id,job_number as label,status from public.production_jobs where company_id=v_company and status not in ('completed','cancelled') order by created_at,id limit 5)t;
  v_jobs:=jsonb_build_object('count',v_count,'carried',v_carried,'changed_at',v_changed::text,'rows',v_rows);
  select count(*),count(*) filter(where (created_at at time zone 'Asia/Kolkata')::date<v_today),max(updated_at) into v_count,v_carried,v_changed from public.production_jobs where company_id=v_company and status='on_hold';
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_rows from(select id,job_number as label,status from public.production_jobs where company_id=v_company and status='on_hold' order by created_at,id limit 5)t;
  v_holds:=jsonb_build_object('count',v_count,'carried',v_carried,'changed_at',v_changed::text,'rows',v_rows);
  select count(*),count(*) filter(where (e.recorded_at at time zone 'Asia/Kolkata')::date<v_today),max(e.recorded_at) into v_count,v_carried,v_changed
   from public.production_exceptions e join public.production_jobs j on j.id=e.production_job_id and j.company_id=e.company_id where e.company_id=v_company and j.status not in ('completed','cancelled');
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_rows from(select e.id,j.job_number||' / '||replace(e.reason,'_',' ') as label,'Recorded observation; review required'::text as status
   from public.production_exceptions e join public.production_jobs j on j.id=e.production_job_id and j.company_id=e.company_id where e.company_id=v_company and j.status not in ('completed','cancelled') order by e.recorded_at desc,e.id limit 5)t;
  v_exceptions:=jsonb_build_object('count',v_count,'carried',v_carried,'changed_at',v_changed::text,'rows',v_rows);
 end if;
 return jsonb_build_object('tasks',v_tasks,'jobs',v_jobs,'holds',v_holds,'exceptions',v_exceptions);
end;$$;
revoke all on function private.daily_routine_sources() from public,anon,authenticated;

create function public.collaboration_workflow_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare
 v_actor uuid:=auth.uid();v_company uuid:=private.get_current_user_company_id();v_role text:=private.get_current_user_role();v_name text;
 v_today date:=(now() at time zone 'Asia/Kolkata')::date;v_page integer;v_offset integer;v_count bigint;v_rows jsonb;v_id uuid;v_request uuid;
 v_entity text:=p_payload->>'entity_type';v_parent uuid:=(p_payload->>'entity_id')::uuid;v_search text:=btrim(coalesce(p_payload->>'search',''));v_status text:=coalesce(p_payload->>'status','active');
 v_person uuid;v_people uuid[];v_names text[];v_person_name text;v_owner uuid;v_backup uuid;v_owner_name text;v_backup_name text;v_title text;v_scope text;v_purpose text;v_kind text;v_prompts jsonb;v_due date;
 v_reply uuid;v_body text;v_reference text;v_note text;v_event text;v_sources jsonb;v_expected integer;v_previous_owner text;v_previous_backup text;v_keys text[];
 v_discussion public.record_discussions%rowtype;v_procedure public.operating_procedures%rowtype;v_history public.operating_procedure_events%rowtype;v_run public.daily_routine_runs%rowtype;v_completion public.daily_routine_completions%rowtype;
begin
 if v_actor is null or v_company is null or v_role not in ('owner','admin','sales','sales_manager','factory_manager','production_manager','production','inventory_manager','dispatch_manager','dispatch','accounts','quality','viewer') then raise exception 'Not permitted' using errcode='42501';end if;
 select coalesce(nullif(full_name,''),'Employee') into v_name from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null and role=v_role;
 if not found then raise exception 'Not permitted' using errcode='42501';end if;
 if coalesce(jsonb_typeof(p_payload),'null')<>'object' then raise exception 'WORKFLOW: Invalid request.';end if;
 v_keys:=case p_command
 when 'discussions.list' then array['entity_type','entity_id','comment_id','page'] when 'discussions.people' then array['entity_type','entity_id','search','page']
 when 'discussions.post' then array['entity_type','entity_id','body','reference','mentions','reply_to','request_id']
 when 'procedures.list' then array['search','status','sort','page'] when 'procedures.people' then array['search','page'] when 'procedures.load' then array['procedure_id','page']
 when 'procedures.create' then array['title','purpose','scope_label','owner_id','backup_id','review_due','routine_kind','prompts','request_id']
 when 'procedures.update' then array['title','purpose','scope_label','owner_id','backup_id','review_due','routine_kind','prompts','procedure_id','expected_revision','is_active','reason','request_id']
 when 'procedures.review' then array['procedure_id','expected_revision','next_review_due','note','request_id']
 when 'routines.list' then array['status','search','sort','page'] when 'routines.start' then array['procedure_id','request_id'] when 'routines.load' then array['run_id']
 when 'routines.finish' then array['run_id','source_fingerprint','answers','note','reviewed','request_id'] else null end;
 if v_keys is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(v_keys))) then raise exception 'WORKFLOW: Invalid request.';end if;
 if exists(select 1 from jsonb_each(p_payload) e where
  (e.key in ('entity_type','entity_id','comment_id','search','status','sort','body','reference','procedure_id','title','purpose','scope_label','owner_id','routine_kind','reason','next_review_due','note','run_id','source_fingerprint','request_id') and jsonb_typeof(e.value)<>'string')
  or (e.key in ('backup_id','reply_to','review_due') and jsonb_typeof(e.value) not in ('string','null'))
  or (e.key in ('is_active','reviewed') and jsonb_typeof(e.value)<>'boolean')
  or (e.key in ('page','expected_revision') and (jsonb_typeof(e.value)<>'number' or e.value::text !~ '^[0-9]{1,9}$'))
  or (e.key in ('prompts','mentions','answers') and jsonb_typeof(e.value)<>'array')) then raise exception 'WORKFLOW: Invalid request.';end if;
 if exists(select 1 from jsonb_each_text(p_payload) e where e.key in ('review_due','next_review_due') and e.value is not null and (e.value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or e.value<'1900-01-01' or e.value>'9999-12-31')) then raise exception 'WORKFLOW: Invalid request.';end if;
 v_page:=coalesce((p_payload->>'page')::integer,1);if v_page not between 1 and 100000 or length(v_search)>80 then raise exception 'WORKFLOW: Invalid page or search.';end if;v_offset:=(v_page-1)*10;
 if p_command not in ('discussions.list','discussions.people','procedures.list','procedures.people','procedures.load','routines.list','routines.load') then
  if v_role='viewer' or (p_command in ('procedures.create','procedures.update') and v_role not in ('owner','admin')) then raise exception 'Not permitted' using errcode='42501';end if;
  perform 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null and role=v_role for share;if not found then raise exception 'Not permitted' using errcode='42501';end if;
  v_request:=(p_payload->>'request_id')::uuid;if v_request is null then raise exception 'WORKFLOW: A request identity is required.';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||v_actor::text||':'||v_request::text,0));
 end if;
 if p_command like 'discussions.%' then
  if not private.collaboration_record_visible(v_entity,v_parent) then raise exception 'WORKFLOW: The record is unavailable for your current company and role.';end if;
  if p_command='discussions.people' then
   select count(*) into v_count from public.app_users where company_id=v_company and is_active and dealer_id is null and id<>v_actor and private.collaboration_can_read(role,v_entity) and (v_search='' or position(lower(v_search) in lower(coalesce(full_name,'')))>0);
   select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_rows from(select id,coalesce(nullif(full_name,''),'Employee') as name,role from public.app_users where company_id=v_company and is_active and dealer_id is null and id<>v_actor and private.collaboration_can_read(role,v_entity) and (v_search='' or position(lower(v_search) in lower(coalesce(full_name,'')))>0) order by full_name,id limit 10 offset v_offset)t;
   return jsonb_build_object('rows',v_rows,'total_count',v_count);
  elsif p_command='discussions.list' then
   v_id:=(p_payload->>'comment_id')::uuid;
   select count(*) into v_count from public.record_discussions where company_id=v_company and entity_type=v_entity and entity_id=v_parent and (v_id is null or id=v_id);
   select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_rows from(select id,body,reference,author_name,recorded_at::text,array_to_string(mentioned_names,', ') as mentions,reply_to from public.record_discussions where company_id=v_company and entity_type=v_entity and entity_id=v_parent and (v_id is null or id=v_id) order by recorded_at desc,id limit 10 offset v_offset)t;
   return jsonb_build_object('rows',v_rows,'total_count',v_count);
  end if;
  select * into v_discussion from public.record_discussions where id=v_request;
  if found then
   if v_discussion.company_id<>v_company or v_discussion.recorded_by<>v_actor or v_discussion.request_payload<>p_payload then raise exception 'WORKFLOW: This request identity was already used for different details.';end if;
   return jsonb_build_object('id',v_request);
  end if;
  v_body:=btrim(coalesce(p_payload->>'body',''));v_reference:=btrim(coalesce(p_payload->>'reference',''));v_reply:=(p_payload->>'reply_to')::uuid;
  if length(v_body) not between 1 and 2000 or length(v_reference)>240 or jsonb_typeof(p_payload->'mentions') is distinct from 'array' or jsonb_array_length(p_payload->'mentions')>3 then raise exception 'WORKFLOW: Enter a discussion and at most three permitted mentions.';end if;
  if v_reply is not null and not exists(select 1 from public.record_discussions where id=v_reply and company_id=v_company and entity_type=v_entity and entity_id=v_parent) then raise exception 'WORKFLOW: The reply belongs to a different record.';end if;
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_people from jsonb_array_elements_text(p_payload->'mentions');v_names:='{}'::text[];
  if cardinality(v_people)<>(select count(distinct x) from unnest(v_people)x) then raise exception 'WORKFLOW: Choose each mentioned colleague once.';end if;
  foreach v_person in array v_people loop
   select coalesce(nullif(full_name,''),'Employee') into v_person_name from public.app_users where id=v_person and id<>v_actor and company_id=v_company and is_active and dealer_id is null and private.collaboration_can_read(role,v_entity) for share;
   if not found then raise exception 'WORKFLOW: A mentioned colleague cannot access this record.';end if;v_names:=array_append(v_names,v_person_name);
  end loop;
  insert into public.record_discussions(id,company_id,entity_type,entity_id,body,reference,reply_to,mentioned_ids,mentioned_names,recorded_by,author_name,request_payload)
   values(v_request,v_company,v_entity,v_parent,v_body,v_reference,v_reply,v_people,v_names,v_actor,v_name,p_payload);
  foreach v_person in array v_people loop
   insert into public.notifications(company_id,recipient_user_id,notification_type,severity,title,body,related_entity_type,related_entity_id,created_by,action_link,entity_reference)
   values(v_company,v_person,'record_mention','info','Mentioned in an internal discussion','A colleague mentioned you in an internal record discussion.',v_entity,v_parent,v_actor,
    case v_entity when 'order' then '/orders/' when 'production_job' then '/production/' when 'dispatch' then '/dispatches/' else '/quality/' end||v_parent::text||'?discussion='||v_request::text||'#record-discussion',v_request::text);
  end loop;
  return jsonb_build_object('id',v_request);
 elsif p_command='procedures.people' then
  select count(*) into v_count from public.app_users where company_id=v_company and is_active and dealer_id is null and role not in ('viewer','dealer_admin','dealer_staff') and (v_search='' or position(lower(v_search) in lower(coalesce(full_name,'')))>0);
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_rows from(select id,coalesce(nullif(full_name,''),'Employee') as name,role from public.app_users where company_id=v_company and is_active and dealer_id is null and role not in ('viewer','dealer_admin','dealer_staff') and (v_search='' or position(lower(v_search) in lower(coalesce(full_name,'')))>0) order by full_name,id limit 10 offset v_offset)t;
  return jsonb_build_object('rows',v_rows,'total_count',v_count);
 elsif p_command='procedures.list' then
  if v_status not in ('active','archived','all') or coalesce(p_payload->>'sort','review') not in ('review','title') then raise exception 'WORKFLOW: Invalid procedure filter.';end if;
  select count(*) into v_count from public.operating_procedures where company_id=v_company and (v_status='all' or is_active=(v_status='active')) and (v_search='' or position(lower(v_search) in lower(title||' '||scope_label))>0);
  select coalesce(jsonb_agg(t.data),'[]'::jsonb) into v_rows from(select private.operating_procedure_projection(id) as data from public.operating_procedures where company_id=v_company and (v_status='all' or is_active=(v_status='active')) and (v_search='' or position(lower(v_search) in lower(title||' '||scope_label))>0) order by case when coalesce(p_payload->>'sort','review')='review' then review_due end nulls last,title,id limit 10 offset v_offset)t;
  return jsonb_build_object('rows',v_rows,'total_count',v_count);
 elsif p_command in ('procedures.load','procedures.create','procedures.update','procedures.review','routines.start') then
  if p_command='procedures.create' then
   select * into v_procedure from public.operating_procedures where id=v_request;
   if found then
    if v_procedure.company_id<>v_company or v_procedure.created_by<>v_actor or v_procedure.request_payload<>p_payload then raise exception 'WORKFLOW: This request identity was already used for different details.';end if;return jsonb_build_object('id',v_request);
   end if;
  else
   v_id:=(p_payload->>'procedure_id')::uuid;
   if p_command in ('procedures.update','procedures.review') then
    select * into v_history from public.operating_procedure_events where id=v_request;
    if found then
     if v_history.company_id<>v_company or v_history.recorded_by<>v_actor or v_history.request_payload<>p_payload then raise exception 'WORKFLOW: This request identity was already used for different details.';end if;return jsonb_build_object('id',v_history.procedure_id);
    end if;
   end if;
   if p_command='procedures.load' then select * into v_procedure from public.operating_procedures where id=v_id and company_id=v_company;
   else select * into v_procedure from public.operating_procedures where id=v_id and company_id=v_company for update;end if;
   if not found then raise exception 'WORKFLOW: This procedure is unavailable for your company.';end if;
  end if;
  if p_command='procedures.load' then
   select count(*) into v_count from public.operating_procedure_events where company_id=v_company and procedure_id=v_id;
   select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_rows from(select id,event_type,previous_owner,owner_name,previous_backup,backup_name,note,actor_name,recorded_at::text,revision from public.operating_procedure_events where company_id=v_company and procedure_id=v_id order by recorded_at desc,id limit 10 offset v_offset)t;
   return jsonb_build_object('record',private.operating_procedure_projection(v_id),'rows',v_rows,'total_count',v_count);
  elsif p_command='routines.start' then
   select * into v_run from public.daily_routine_runs where id=v_request;
   if found then
    if v_run.company_id<>v_company or v_run.procedure_id<>v_id or v_run.started_by<>v_actor then raise exception 'WORKFLOW: This request identity was already used for different details.';end if;
    return jsonb_build_object('id',v_run.id);
   end if;
   if not v_procedure.is_active or v_procedure.routine_kind='none' then raise exception 'WORKFLOW: Choose an active opening or closing routine.';end if;
   if not exists(select 1 from public.app_users where company_id=v_company and id in (v_procedure.owner_id,v_procedure.backup_id) and is_active and dealer_id is null and role not in ('viewer','dealer_admin','dealer_staff')) then raise exception 'WORKFLOW: The process owner and backup are unavailable. Reassign ownership first.';end if;
   insert into public.daily_routine_runs(id,company_id,procedure_id,title,scope_label,routine_kind,business_date,procedure_revision,prompts,started_by,starter_name)
    values(v_request,v_company,v_id,v_procedure.title,v_procedure.scope_label,v_procedure.routine_kind,v_today,v_procedure.revision,v_procedure.prompts,v_actor,v_name) on conflict(company_id,procedure_id,business_date) do nothing;
   select id into v_id from public.daily_routine_runs where company_id=v_company and procedure_id=v_procedure.id and business_date=v_today;
   return jsonb_build_object('id',v_id);
  end if;
  if p_command='procedures.review' then
   if v_role not in ('owner','admin') and v_actor not in (v_procedure.owner_id,coalesce(v_procedure.backup_id,v_procedure.owner_id)) then raise exception 'Not permitted' using errcode='42501';end if;
   if not v_procedure.is_active then raise exception 'WORKFLOW: Archived procedures cannot be reviewed.';end if;
   v_due:=(p_payload->>'next_review_due')::date;v_note:=btrim(coalesce(p_payload->>'note',''));v_event:='reviewed';
   if v_due is null or v_due<=v_today or length(v_note) not between 1 and 800 then raise exception 'WORKFLOW: Record the review and choose a future review date.';end if;
  else
   v_title:=btrim(coalesce(p_payload->>'title',''));v_scope:=btrim(coalesce(p_payload->>'scope_label',''));v_purpose:=btrim(coalesce(p_payload->>'purpose',''));v_owner:=(p_payload->>'owner_id')::uuid;v_backup:=(p_payload->>'backup_id')::uuid;v_kind:=p_payload->>'routine_kind';v_prompts:=p_payload->'prompts';v_due:=(p_payload->>'review_due')::date;
   if length(v_title) not between 1 and 120 or length(v_scope) not between 1 and 80 or length(v_purpose) not between 1 and 800 or v_owner is null or v_owner=v_backup or v_kind is null or v_kind not in ('none','opening','closing') or jsonb_typeof(v_prompts) is distinct from 'array' or jsonb_array_length(v_prompts)>6 then raise exception 'WORKFLOW: Enter a procedure, distinct owner and backup, and up to six observation prompts.';end if;
   if exists(select 1 from jsonb_array_elements(v_prompts) p where jsonb_typeof(p)<>'string' or length(btrim(p#>>'{}')) not between 1 and 160) then raise exception 'WORKFLOW: Observation prompts must be short nonempty text.';end if;
   select coalesce(nullif(full_name,''),'Employee') into v_owner_name from public.app_users where id=v_owner and company_id=v_company and is_active and dealer_id is null and role not in ('viewer','dealer_admin','dealer_staff') for share;
   if not found then raise exception 'WORKFLOW: Choose an active authorised process owner.';end if;
   if v_backup is not null then
    select coalesce(nullif(full_name,''),'Employee') into v_backup_name from public.app_users where id=v_backup and company_id=v_company and is_active and dealer_id is null and role not in ('viewer','dealer_admin','dealer_staff') for share;
    if not found then raise exception 'WORKFLOW: Choose an active authorised backup.';end if;
   end if;
   v_note:=case when p_command='procedures.create' then 'Procedure ownership recorded' else btrim(coalesce(p_payload->>'reason','')) end;v_event:=case when p_command='procedures.create' then 'created' else 'updated' end;
   if length(v_note) not between 1 and 800 then raise exception 'WORKFLOW: Record a reason for the change.';end if;
  end if;
  if p_command='procedures.create' then
   v_id:=v_request;
   insert into public.operating_procedures(id,company_id,title,purpose,scope_label,owner_id,owner_name,backup_id,backup_name,review_due,routine_kind,prompts,created_by,request_payload)
    values(v_id,v_company,v_title,v_purpose,v_scope,v_owner,v_owner_name,v_backup,v_backup_name,v_due,v_kind,v_prompts,v_actor,p_payload);
  else
   v_expected:=(p_payload->>'expected_revision')::integer;
   if v_expected is null or v_expected<>v_procedure.revision then raise exception 'WORKFLOW: This procedure changed. Refresh before continuing.';end if;
   v_previous_owner:=v_procedure.owner_name;v_previous_backup:=v_procedure.backup_name;
   if p_command='procedures.review' then update public.operating_procedures set reviewed_at=now(),review_due=v_due,revision=revision+1 where id=v_id and company_id=v_company;
   else update public.operating_procedures set title=v_title,purpose=v_purpose,scope_label=v_scope,owner_id=v_owner,owner_name=v_owner_name,backup_id=v_backup,backup_name=v_backup_name,review_due=v_due,routine_kind=v_kind,prompts=v_prompts,is_active=(p_payload->>'is_active')::boolean,revision=revision+1 where id=v_id and company_id=v_company;end if;
  end if;
  select * into v_procedure from public.operating_procedures where id=v_id and company_id=v_company;
  insert into public.operating_procedure_events(id,company_id,procedure_id,event_type,previous_owner,owner_name,previous_backup,backup_name,note,revision,recorded_by,actor_name,request_payload,metadata_snapshot)
   values(v_request,v_company,v_id,v_event,v_previous_owner,v_procedure.owner_name,v_previous_backup,v_procedure.backup_name,v_note,v_procedure.revision,v_actor,v_name,p_payload,to_jsonb(v_procedure)-'request_payload');
  return jsonb_build_object('id',v_id);
 elsif p_command='routines.list' then
  v_status:=coalesce(p_payload->>'status','open');if v_status not in ('open','completed','all') or coalesce(p_payload->>'sort','newest') not in ('newest','oldest') then raise exception 'WORKFLOW: Invalid routine filter.';end if;
  select count(*) into v_count from public.daily_routine_runs where company_id=v_company and (v_status='all' or status=v_status) and (v_search='' or position(lower(v_search) in lower(title||' '||scope_label))>0);
  select coalesce(jsonb_agg(t.data),'[]'::jsonb) into v_rows from(select private.daily_routine_projection(id) as data from public.daily_routine_runs where company_id=v_company and (v_status='all' or status=v_status) and (v_search='' or position(lower(v_search) in lower(title||' '||scope_label))>0) order by case when coalesce(p_payload->>'sort','newest')='newest' then business_date end desc,case when p_payload->>'sort'='oldest' then business_date end,created_at desc,id limit 10 offset v_offset)t;
  return jsonb_build_object('rows',v_rows,'total_count',v_count);
 elsif p_command in ('routines.load','routines.finish') then
  v_id:=(p_payload->>'run_id')::uuid;
  if p_command='routines.load' then select * into v_run from public.daily_routine_runs where id=v_id and company_id=v_company;
  else select * into v_run from public.daily_routine_runs where id=v_id and company_id=v_company for update;end if;
  if not found then raise exception 'WORKFLOW: This routine is unavailable for your company.';end if;
  if p_command='routines.load' then v_sources:=private.daily_routine_sources();return jsonb_build_object('record',private.daily_routine_projection(v_id),'sources',v_sources,'source_fingerprint',md5(v_sources::text));end if;
  if v_run.started_by<>v_actor and v_role not in ('owner','admin') then raise exception 'Not permitted' using errcode='42501';end if;
  select * into v_completion from public.daily_routine_completions where id=v_request;
  if found then
   if v_completion.company_id<>v_company or v_completion.recorded_by<>v_actor or v_completion.request_payload<>p_payload then raise exception 'WORKFLOW: This request identity was already used for different details.';end if;return jsonb_build_object('id',v_id);
  end if;
  if v_run.status<>'open' then raise exception 'WORKFLOW: This routine is already completed.';end if;
  v_note:=btrim(coalesce(p_payload->>'note',''));
  if p_payload->>'reviewed' is distinct from 'true' or length(v_note) not between 1 and 800 or jsonb_typeof(p_payload->'answers') is distinct from 'array' or jsonb_array_length(p_payload->'answers')<>jsonb_array_length(v_run.prompts) then raise exception 'WORKFLOW: Review the work context, answer every observation, and record the handover outcome.';end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'answers') a where jsonb_typeof(a)<>'object') then raise exception 'WORKFLOW: Answer each approved observation once and explain any follow-up.';end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'answers') a where jsonb_typeof(a->'index') is distinct from 'number' or coalesce(a->>'index','') !~ '^[0-5]$' or jsonb_typeof(a->'answer') is distinct from 'string' or jsonb_typeof(a->'note') is distinct from 'string' or exists(select 1 from jsonb_object_keys(a) k where k not in ('index','answer','note'))) then raise exception 'WORKFLOW: Answer each approved observation once and explain any follow-up.';end if;
  if (select count(distinct (a->>'index')::integer) from jsonb_array_elements(p_payload->'answers') a)<>jsonb_array_length(v_run.prompts) or exists(select 1 from jsonb_array_elements(p_payload->'answers') a where (a->>'index') is null or (a->>'index')::integer<0 or (a->>'index')::integer>=jsonb_array_length(v_run.prompts) or (a->>'answer') is null or a->>'answer' not in ('confirmed','follow_up') or length(coalesce(a->>'note',''))>500 or (a->>'answer'='follow_up' and length(btrim(coalesce(a->>'note','')))=0)) then raise exception 'WORKFLOW: Answer each approved observation once and explain any follow-up.';end if;
  v_sources:=private.daily_routine_sources();if p_payload->>'source_fingerprint' is distinct from md5(v_sources::text) then raise exception 'WORKFLOW: Work context changed. Refresh and review it before completing the routine.';end if;
  insert into public.daily_routine_completions(id,company_id,run_id,answers,outcome,recorded_by,actor_name,source_snapshot,request_payload) values(v_request,v_company,v_id,p_payload->'answers',v_note,v_actor,v_name,v_sources,p_payload);
  update public.daily_routine_runs set status='completed' where id=v_id and company_id=v_company;
  return jsonb_build_object('id',v_id);
 end if;
 raise exception 'WORKFLOW: Invalid request.';
end;$$;
revoke all on function public.collaboration_workflow_command(text,jsonb) from public,anon;
grant execute on function public.collaboration_workflow_command(text,jsonb) to authenticated;

create function private.guard_quote_preparation_stage() returns trigger language plpgsql security definer set search_path=public,private as $$
begin
 if (tg_op='INSERT' or new.status is distinct from old.status) and new.status in ('approved_for_sending','sent','customer_approved') then
  if not exists(select 1 from public.quote_items where quote_id=new.id and company_id=new.company_id) or exists(select 1 from public.quote_items where quote_id=new.id and company_id=new.company_id and costing_complete is distinct from true) then
   raise exception 'Complete quotation item costing before confirmation. Incomplete drafts may still be saved.';
  end if;
 end if;return new;
end;$$;
revoke all on function private.guard_quote_preparation_stage() from public,anon,authenticated;
create trigger quote_preparation_stage_guard before insert or update of status on public.quotes for each row execute function private.guard_quote_preparation_stage();
commit;
