begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.customer_profile_aliases (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  customer_id uuid not null references public.customers(id),
  profile_id uuid not null references public.aluminium_profiles(id),
  alias text not null check (length(btrim(alias)) between 1 and 80),
  is_active boolean not null default true,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  deactivated_by uuid references public.app_users(id),
  deactivated_at timestamptz
);
create unique index customer_profile_alias_active_key on public.customer_profile_aliases(company_id,customer_id,lower(alias),profile_id) where is_active;
create index customer_profile_alias_customer_idx on public.customer_profile_aliases(company_id,customer_id,created_at,id);

create table public.operator_location_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entity_type text not null check (entity_type in ('die','inventory_item')),
  entity_id uuid not null,
  previous_location text,
  location text check (location is null or length(btrim(location)) > 0),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  recorded_by uuid references public.app_users(id),
  recorded_at timestamptz not null default now()
);
create index operator_location_entity_idx on public.operator_location_history(company_id,entity_type,entity_id,recorded_at desc,id);

create table public.production_exceptions (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  production_job_id uuid not null references public.production_jobs(id),
  order_id uuid,
  machine_id uuid,
  reason text not null check (reason in ('material_shortage','die_damage','surface_defect','machine_breakdown','other')),
  note text not null check (length(note) <= 1000 and (reason <> 'other' or length(btrim(note)) > 0)),
  recorded_by uuid not null references public.app_users(id),
  reporter_name text not null,
  operator_name text,
  recorded_at timestamptz not null default now()
);
create index production_exception_job_idx on public.production_exceptions(company_id,production_job_id,recorded_at desc,id);

create table public.customer_commitments (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  customer_id uuid not null references public.customers(id),
  title text not null check (length(btrim(title)) between 1 and 160),
  responsible_user_id uuid not null references public.app_users(id),
  responsible_name text not null,
  original_due_date date not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  outcome text,
  check ((status = 'open' and closed_at is null and outcome is null) or (status <> 'open' and closed_at is not null and length(btrim(outcome)) between 1 and 1000))
);
create index customer_commitment_queue_idx on public.customer_commitments(company_id,customer_id,status,due_date,id);
create index customer_commitment_assignee_idx on public.customer_commitments(company_id,responsible_user_id,status,due_date,id);

create table public.customer_commitment_events (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  commitment_id uuid not null references public.customer_commitments(id),
  event_type text not null check (event_type in ('rescheduled','completed','cancelled')),
  previous_due_date date not null,
  due_date date not null,
  note text not null check (length(btrim(note)) between 1 and 1000),
  recorded_by uuid not null references public.app_users(id),
  reporter_name text not null,
  recorded_at timestamptz not null default now()
);
create index customer_commitment_event_idx on public.customer_commitment_events(company_id,commitment_id,recorded_at desc,id);

create function private.operator_workflow_allowed(p_role text,p_command text,p_entity_type text default null)
returns boolean language sql immutable set search_path = public,private as $$
select coalesce(case
  when p_command in ('aliases.list','aliases.search','commitments.list','commitments.history','commitments.queue') then p_role in ('owner','admin','sales_manager','sales','production_manager','factory_manager','accounts','viewer')
  when p_command in ('aliases.create','aliases.deactivate','commitments.create','commitments.reschedule','commitments.close') then p_role in ('owner','admin','sales_manager','sales')
  when p_command = 'exceptions.list' then p_role in ('owner','admin','factory_manager','production_manager','production','quality','viewer')
  when p_command = 'exceptions.report' then p_role in ('owner','admin','factory_manager','production_manager','production','quality')
  when p_command = 'locations.load' and p_entity_type = 'die' then p_role in ('owner','admin','sales_manager','sales','production_manager','production','accounts','viewer')
  when p_command = 'locations.move' and p_entity_type = 'die' then p_role in ('owner','admin','sales_manager','production_manager')
  when p_command = 'locations.load' and p_entity_type = 'inventory_item' then p_role in ('owner','admin','sales_manager','sales','factory_manager','production_manager','production','inventory_manager','dispatch_manager','dispatch','quality','viewer')
  when p_command = 'locations.move' and p_entity_type = 'inventory_item' then p_role in ('owner','admin','factory_manager','production_manager','inventory_manager')
  else false end,false);
$$;
revoke all on function private.operator_workflow_allowed(text,text,text) from public,anon,authenticated;
grant execute on function private.operator_workflow_allowed(text,text,text) to authenticated;

alter table public.customer_profile_aliases enable row level security;
alter table public.operator_location_history enable row level security;
alter table public.production_exceptions enable row level security;
alter table public.customer_commitments enable row level security;
alter table public.customer_commitment_events enable row level security;
revoke all on public.customer_profile_aliases,public.operator_location_history,public.production_exceptions,public.customer_commitments,public.customer_commitment_events from public,anon,authenticated;
grant select on public.customer_profile_aliases,public.operator_location_history,public.production_exceptions,public.customer_commitments,public.customer_commitment_events to authenticated;
create policy operator_alias_read on public.customer_profile_aliases for select to authenticated using (company_id=private.get_current_user_company_id() and private.get_current_user_dealer_id() is null and private.operator_workflow_allowed(private.get_current_user_role(),'aliases.list'));
create policy operator_location_read on public.operator_location_history for select to authenticated using (company_id=private.get_current_user_company_id() and private.get_current_user_dealer_id() is null and private.operator_workflow_allowed(private.get_current_user_role(),'locations.load',entity_type));
create policy operator_exception_read on public.production_exceptions for select to authenticated using (company_id=private.get_current_user_company_id() and private.get_current_user_dealer_id() is null and private.operator_workflow_allowed(private.get_current_user_role(),'exceptions.list'));
create policy operator_commitment_read on public.customer_commitments for select to authenticated using (company_id=private.get_current_user_company_id() and private.get_current_user_dealer_id() is null and private.operator_workflow_allowed(private.get_current_user_role(),'commitments.list'));
create policy operator_commitment_event_read on public.customer_commitment_events for select to authenticated using (company_id=private.get_current_user_company_id() and private.get_current_user_dealer_id() is null and private.operator_workflow_allowed(private.get_current_user_role(),'commitments.history'));

create function private.capture_operator_location_change() returns trigger language plpgsql security definer set search_path = public,private as $$
declare v_before text; v_after text; v_request text; v_reason text;
begin
  if new.company_id is distinct from old.company_id then raise exception 'Location changes cannot move a record between companies'; end if;
  if tg_table_name='dies' then v_before:=old.rack_location;v_after:=new.rack_location; else v_before:=old.location;v_after:=new.location; end if;
  if v_before is not distinct from v_after then return new; end if;
  v_request:=nullif(current_setting('operator_workflow.request_id',true),'');
  v_reason:=coalesce(nullif(current_setting('operator_workflow.reason',true),''),'Location updated through record editing');
  insert into public.operator_location_history(id,company_id,entity_type,entity_id,previous_location,location,reason,recorded_by)
  values(coalesce(v_request::uuid,gen_random_uuid()),new.company_id,case when tg_table_name='dies' then 'die' else 'inventory_item' end,new.id,v_before,nullif(btrim(v_after),''),v_reason,auth.uid());
  return new;
end;
$$;
revoke all on function private.capture_operator_location_change() from public,anon,authenticated;
create trigger operator_die_location_history after update of rack_location on public.dies for each row execute function private.capture_operator_location_change();
create trigger operator_inventory_location_history after update of location on public.inventory_items for each row execute function private.capture_operator_location_change();

create function public.operator_workflow_command(p_command text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public,private as $$
declare
  v_actor uuid:=auth.uid(); v_company uuid:=private.get_current_user_company_id(); v_role text:=private.get_current_user_role();
  v_name text; v_customer uuid; v_id uuid; v_request uuid; v_page integer; v_offset integer; v_rows jsonb; v_total bigint;
  v_entity text:=p_payload->>'entity_type'; v_location text; v_target text; v_reason text; v_note text; v_alias text;
  v_code text; v_profile uuid; v_count integer; v_due date; v_expected date; v_status text; v_scope text; v_search text; v_sort text;
  v_existing record; v_job record; v_commitment public.customer_commitments%rowtype; v_event public.customer_commitment_events%rowtype;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select coalesce(nullif(full_name,''),'Employee') into v_name from public.app_users where id=v_actor and company_id=v_company and role=v_role and is_active and dealer_id is null;
  if not found or not private.operator_workflow_allowed(v_role,p_command,v_entity) then raise exception 'This action is not permitted for your role' using errcode='42501'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid workflow request'; end if;
  if p_command not in ('aliases.list','aliases.search','locations.load','exceptions.list','commitments.list','commitments.history','commitments.queue') then
    perform 1 from public.app_users where id=v_actor and company_id=v_company and role=v_role and is_active and dealer_id is null for share;
    if not found then raise exception 'This action is not permitted for your role' using errcode='42501'; end if;
  end if;
  v_page:=coalesce((p_payload->>'page')::integer,1);
  if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
  v_offset:=(v_page-1)*10;
  v_customer:=(p_payload->>'customer_id')::uuid;
  v_request:=(p_payload->>'request_id')::uuid;
  if p_command in ('aliases.create','locations.move','exceptions.report','commitments.create','commitments.reschedule','commitments.close') and v_request is null then raise exception 'A request identity is required'; end if;
  if v_request is not null then perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||v_actor::text||':'||v_request::text,0)); end if;
  if p_command like 'aliases.%' or (p_command like 'commitments.%' and p_command<>'commitments.queue') then
    if not exists(select 1 from public.customers where id=v_customer and company_id=v_company) then raise exception 'Customer is unavailable for this company'; end if;
  end if;

  if p_command in ('aliases.list','aliases.search') then
    if p_command='aliases.search' then
      v_alias:=btrim(coalesce(p_payload->>'search',''));
      if length(v_alias) not between 1 and 80 then raise exception 'Enter an alias of up to 80 characters'; end if;
      if not exists(select 1 from public.customers where id=v_customer and company_id=v_company and is_active and deleted_at is null) then raise exception 'Customer is inactive'; end if;
      select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows from (
        select p.id profile_id,p.profile_code,p.profile_name,a.alias from public.customer_profile_aliases a
        join public.aluminium_profiles p on p.id=a.profile_id and p.company_id=a.company_id and p.is_active
        where a.company_id=v_company and a.customer_id=v_customer and a.is_active and lower(a.alias)=lower(v_alias)
        order by p.profile_code,p.id limit 10
      ) r;
      return jsonb_build_object('profiles',v_rows);
    end if;
    select count(*) into v_total from public.customer_profile_aliases where company_id=v_company and customer_id=v_customer;
    select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows from (
      select a.id,a.alias,a.profile_id,p.profile_code,p.profile_name,a.is_active,a.created_at::text,a.deactivated_at::text
      from public.customer_profile_aliases a join public.aluminium_profiles p on p.id=a.profile_id and p.company_id=a.company_id
      where a.company_id=v_company and a.customer_id=v_customer order by a.created_at desc,a.id limit 10 offset v_offset
    ) r;
    return jsonb_build_object('rows',v_rows,'total_count',v_total);
  elsif p_command='aliases.create' then
    v_alias:=btrim(coalesce(p_payload->>'alias',''));v_code:=btrim(coalesce(p_payload->>'profile_code',''));
    if length(v_alias) not between 1 and 80 or length(v_code) not between 1 and 80 or v_alias ~ '[[:cntrl:]]' or v_code ~ '[[:cntrl:]]' then raise exception 'Enter a valid alias and canonical profile code'; end if;
    select * into v_existing from public.customer_profile_aliases where id=v_request;
    if found then
      if v_existing.company_id<>v_company or v_existing.created_by<>v_actor or v_existing.customer_id<>v_customer or v_existing.alias<>v_alias or not exists(select 1 from public.aluminium_profiles p where p.id=v_existing.profile_id and p.company_id=v_company and lower(p.profile_code)=lower(v_code)) then raise exception 'The request identity was already used for different details'; end if;
      return jsonb_build_object('id',v_existing.id);
    end if;
    if not exists(select 1 from public.customers where id=v_customer and company_id=v_company and is_active and deleted_at is null) then raise exception 'Customer is inactive'; end if;
    select count(*),(array_agg(id))[1] into v_count,v_profile from public.aluminium_profiles where company_id=v_company and is_active and lower(profile_code)=lower(v_code);
    if v_count<>1 then raise exception 'Choose one exact active canonical profile code'; end if;
    insert into public.customer_profile_aliases(id,company_id,customer_id,profile_id,alias,created_by)
    values(v_request,v_company,v_customer,v_profile,v_alias,v_actor) on conflict do nothing;
    select * into v_existing from public.customer_profile_aliases where id=v_request;
    if not found or v_existing.company_id<>v_company or v_existing.created_by<>v_actor or v_existing.customer_id<>v_customer or v_existing.alias<>v_alias or v_existing.profile_id<>v_profile then raise exception 'This alias mapping already exists or the request identity was reused'; end if;
    return jsonb_build_object('id',v_request);
  elsif p_command='aliases.deactivate' then
    update public.customer_profile_aliases set is_active=false,deactivated_by=coalesce(deactivated_by,v_actor),deactivated_at=coalesce(deactivated_at,now())
    where id=(p_payload->>'alias_id')::uuid and company_id=v_company and customer_id=v_customer returning id into v_id;
    if not found then raise exception 'Alias is unavailable'; end if;
    return jsonb_build_object('id',v_id);
  elsif p_command in ('locations.load','locations.move') then
    v_id:=(p_payload->>'entity_id')::uuid;
    if p_command='locations.move' then
      v_target:=btrim(coalesce(p_payload->>'location',''));v_reason:=btrim(coalesce(p_payload->>'reason',''));
      if length(v_target) not between 1 and 160 or length(v_reason) not between 1 and 500 or v_target ~ '[[:cntrl:]]' then raise exception 'Enter a valid physical location and move reason'; end if;
      select * into v_existing from public.operator_location_history where id=v_request;
      if found then
        if v_existing.company_id<>v_company or v_existing.recorded_by is distinct from v_actor or v_existing.entity_type<>v_entity or v_existing.entity_id<>v_id or v_existing.location<>v_target or v_existing.reason<>v_reason or coalesce(btrim(v_existing.previous_location),'')<>coalesce(btrim(p_payload->>'expected_location'),'') then raise exception 'The request identity was already used for different details'; end if;
        return jsonb_build_object('id',v_request);
      end if;
    end if;
    if v_entity='die' then
      if p_command='locations.move' then select rack_location into v_location from public.dies where id=v_id and company_id=v_company for update;
      else select rack_location into v_location from public.dies where id=v_id and company_id=v_company; end if;
    else
      if p_command='locations.move' then select location into v_location from public.inventory_items where id=v_id and company_id=v_company for update;
      else select location into v_location from public.inventory_items where id=v_id and company_id=v_company; end if;
    end if;
    if not found then raise exception 'Record is unavailable for this company'; end if;
    if p_command='locations.load' then
      select count(*) into v_total from public.operator_location_history where company_id=v_company and entity_type=v_entity and entity_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows from (
        select id,previous_location,location,reason,recorded_at::text from public.operator_location_history where company_id=v_company and entity_type=v_entity and entity_id=v_id order by recorded_at desc,id limit 10 offset v_offset
      ) r;
      return jsonb_build_object('rows',v_rows,'total_count',v_total,'current_location',v_location);
    end if;
    if coalesce(btrim(v_location),'')<>coalesce(btrim(p_payload->>'expected_location'),'') then raise exception 'The location changed. Refresh and review the current location before moving it'; end if;
    if coalesce(btrim(v_location),'')=v_target then raise exception 'Choose a different physical location'; end if;
    perform set_config('operator_workflow.request_id',v_request::text,true);perform set_config('operator_workflow.reason',v_reason,true);
    if v_entity='die' then update public.dies set rack_location=v_target where id=v_id and company_id=v_company;
    else update public.inventory_items set location=v_target where id=v_id and company_id=v_company; end if;
    perform set_config('operator_workflow.request_id','',true);perform set_config('operator_workflow.reason','',true);
    return jsonb_build_object('id',v_request);
  elsif p_command in ('exceptions.list','exceptions.report') then
    v_id:=(p_payload->>'job_id')::uuid;
    if p_command='exceptions.report' then
      v_reason:=p_payload->>'reason';v_note:=btrim(coalesce(p_payload->>'note',''));
      if v_reason not in ('material_shortage','die_damage','surface_defect','machine_breakdown','other') or v_reason is null or length(v_note)>1000 or (v_reason='other' and v_note='') then raise exception 'Choose an exception reason and explain other exceptions'; end if;
      select * into v_existing from public.production_exceptions where id=v_request;
      if found then
        if v_existing.company_id<>v_company or v_existing.recorded_by<>v_actor or v_existing.production_job_id<>v_id or v_existing.reason<>v_reason or v_existing.note<>v_note then raise exception 'The request identity was already used for different details'; end if;
        return jsonb_build_object('id',v_request);
      end if;
    end if;
    if p_command='exceptions.report' then select id,order_id,machine_id,operator_name into v_job from public.production_jobs where id=v_id and company_id=v_company for share;
    else select id,order_id,machine_id,operator_name into v_job from public.production_jobs where id=v_id and company_id=v_company; end if;
    if not found then raise exception 'Production job is unavailable for this company'; end if;
    if p_command='exceptions.list' then
      select count(*) into v_total from public.production_exceptions where company_id=v_company and production_job_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows from (
        select id,reason,note,reporter_name,operator_name,recorded_at::text from public.production_exceptions where company_id=v_company and production_job_id=v_id order by recorded_at desc,id limit 10 offset v_offset
      ) r;
      return jsonb_build_object('rows',v_rows,'total_count',v_total);
    end if;
    insert into public.production_exceptions(id,company_id,production_job_id,order_id,machine_id,reason,note,recorded_by,reporter_name,operator_name)
    values(v_request,v_company,v_id,v_job.order_id,v_job.machine_id,v_reason,v_note,v_actor,v_name,v_job.operator_name) on conflict(id) do nothing;
    select * into v_existing from public.production_exceptions where id=v_request;
    if v_existing.company_id<>v_company or v_existing.recorded_by<>v_actor or v_existing.production_job_id<>v_id or v_existing.reason<>v_reason or v_existing.note<>v_note then raise exception 'The request identity was already used for different details'; end if;
    return jsonb_build_object('id',v_request);
  elsif p_command='commitments.queue' then
    v_status:=coalesce(p_payload->>'status','open');v_scope:=coalesce(p_payload->>'scope','mine');v_search:=btrim(coalesce(p_payload->>'search',''));v_sort:=coalesce(p_payload->>'sort','due');
    if v_status not in ('open','completed','cancelled','all') or v_scope not in ('mine','all') or v_sort not in ('due','newest') or length(v_search)>80 then raise exception 'Invalid commitment queue filters'; end if;
    select count(*) into v_total from public.customer_commitments m join public.customers c on c.id=m.customer_id and c.company_id=m.company_id
      where m.company_id=v_company and (v_scope='all' or m.responsible_user_id=v_actor) and (v_status='all' or m.status=v_status) and (v_search='' or position(lower(v_search) in lower(m.title||' '||c.customer_name))>0);
    select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows from (
      select m.id,m.title,m.customer_id,c.customer_name,(c.is_active and c.deleted_at is null) as customer_available,m.responsible_name,m.original_due_date::text,m.due_date::text,m.status,m.outcome,m.created_at::text,m.closed_at::text
      from public.customer_commitments m join public.customers c on c.id=m.customer_id and c.company_id=m.company_id
      where m.company_id=v_company and (v_scope='all' or m.responsible_user_id=v_actor) and (v_status='all' or m.status=v_status) and (v_search='' or position(lower(v_search) in lower(m.title||' '||c.customer_name))>0)
      order by case when v_sort='due' then m.due_date end,case when v_sort='newest' then m.created_at end desc,m.id limit 10 offset v_offset
    ) r;
    return jsonb_build_object('rows',v_rows,'total_count',v_total);
  elsif p_command in ('commitments.list','commitments.history') then
    if p_command='commitments.history' then
      v_id:=(p_payload->>'commitment_id')::uuid;
      if not exists(select 1 from public.customer_commitments where id=v_id and company_id=v_company and customer_id=v_customer) then raise exception 'Commitment is unavailable'; end if;
      select count(*) into v_total from public.customer_commitment_events where company_id=v_company and commitment_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows from (
        select id,event_type,previous_due_date::text,due_date::text,note,reporter_name,recorded_at::text from public.customer_commitment_events where company_id=v_company and commitment_id=v_id order by recorded_at desc,id limit 10 offset v_offset
      ) r;
    else
      v_status:=coalesce(p_payload->>'status','open');
      if v_status not in ('open','completed','cancelled','all') then raise exception 'Invalid commitment status'; end if;
      select count(*) into v_total from public.customer_commitments where company_id=v_company and customer_id=v_customer and (v_status='all' or status=v_status) and ((p_payload->>'commitment_id') is null or id=(p_payload->>'commitment_id')::uuid);
      select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows from (
        select id,title,responsible_name,original_due_date::text,due_date::text,status,outcome,created_at::text,closed_at::text from public.customer_commitments where company_id=v_company and customer_id=v_customer and (v_status='all' or status=v_status) and ((p_payload->>'commitment_id') is null or id=(p_payload->>'commitment_id')::uuid) order by due_date,id limit 10 offset v_offset
      ) r;
    end if;
    return jsonb_build_object('rows',v_rows,'total_count',v_total);
  elsif p_command='commitments.create' then
    v_note:=btrim(coalesce(p_payload->>'title',''));
    if length(v_note) not between 1 and 160 or coalesce(p_payload->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Enter a commitment and a valid due date'; end if;
    v_due:=(p_payload->>'due_date')::date;
    if extract(year from v_due) not between 1900 and 9999 then raise exception 'Invalid due date'; end if;
    select * into v_commitment from public.customer_commitments where id=v_request;
    if found then
      if v_commitment.company_id<>v_company or v_commitment.responsible_user_id<>v_actor or v_commitment.customer_id<>v_customer or v_commitment.title<>v_note or v_commitment.original_due_date<>v_due then raise exception 'The request identity was already used for different details'; end if;
      return jsonb_build_object('id',v_request);
    end if;
    if not exists(select 1 from public.customers where id=v_customer and company_id=v_company and is_active and deleted_at is null) then raise exception 'Customer is inactive'; end if;
    insert into public.customer_commitments(id,company_id,customer_id,title,responsible_user_id,responsible_name,original_due_date,due_date)
    values(v_request,v_company,v_customer,v_note,v_actor,v_name,v_due,v_due) on conflict(id) do nothing;
    select * into v_commitment from public.customer_commitments where id=v_request;
    if v_commitment.company_id<>v_company or v_commitment.responsible_user_id<>v_actor or v_commitment.customer_id<>v_customer or v_commitment.title<>v_note or v_commitment.original_due_date<>v_due then raise exception 'The request identity was already used for different details'; end if;
    return jsonb_build_object('id',v_request);
  elsif p_command in ('commitments.reschedule','commitments.close') then
    v_id:=(p_payload->>'commitment_id')::uuid;
    v_note:=btrim(coalesce(p_payload->>case when p_command='commitments.reschedule' then 'reason' else 'outcome' end,''));
    if length(v_note) not between 1 and 1000 then raise exception 'Record the reason or outcome'; end if;
    v_status:=case when p_command='commitments.reschedule' then 'rescheduled' else p_payload->>'status' end;
    if v_status is null or v_status not in ('rescheduled','completed','cancelled') then raise exception 'Invalid commitment outcome'; end if;
    if p_command='commitments.reschedule' then
      if coalesce(p_payload->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(p_payload->>'expected_due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Use valid calendar dates'; end if;
      v_due:=(p_payload->>'due_date')::date;v_expected:=(p_payload->>'expected_due_date')::date;
      if extract(year from v_due) not between 1900 and 9999 or v_due=v_expected then raise exception 'Choose a different valid due date'; end if;
    end if;
    select * into v_event from public.customer_commitment_events where id=v_request;
    if found then
      if v_event.company_id<>v_company or v_event.recorded_by<>v_actor or v_event.commitment_id<>v_id or v_event.event_type<>v_status or v_event.note<>v_note or (v_status='rescheduled' and (v_event.due_date<>v_due or v_event.previous_due_date<>v_expected)) or not exists(select 1 from public.customer_commitments where id=v_id and company_id=v_company and customer_id=v_customer) then raise exception 'The request identity was already used for different details'; end if;
      return jsonb_build_object('id',v_request);
    end if;
    select * into v_commitment from public.customer_commitments where id=v_id and company_id=v_company and customer_id=v_customer for update;
    if not found then raise exception 'Commitment is unavailable'; end if;
    if v_commitment.status<>'open' then raise exception 'This commitment is already closed'; end if;
    if v_status='rescheduled' and v_commitment.due_date<>v_expected then raise exception 'The due date changed. Refresh before rescheduling'; end if;
    if v_status='rescheduled' then update public.customer_commitments set due_date=v_due where id=v_id;
    else update public.customer_commitments set status=v_status,outcome=v_note,closed_at=now() where id=v_id; end if;
    insert into public.customer_commitment_events(id,company_id,commitment_id,event_type,previous_due_date,due_date,note,recorded_by,reporter_name)
    values(v_request,v_company,v_id,v_status,v_commitment.due_date,case when v_status='rescheduled' then v_due else v_commitment.due_date end,v_note,v_actor,v_name);
    return jsonb_build_object('id',v_request);
  end if;
  raise exception 'Unknown workflow command';
end;
$$;
revoke all on function public.operator_workflow_command(text,jsonb) from public,anon;
grant execute on function public.operator_workflow_command(text,jsonb) to authenticated;

commit;
