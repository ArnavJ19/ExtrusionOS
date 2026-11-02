-- November batch 3: responsibility and coordination over existing operational ledgers.
-- Promises never post money. Coverage never grants authority. Reviews never reserve stock.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

create unique index if not exists coordination_user_tenant_key on public.app_users(company_id,id);
create unique index if not exists coordination_order_tenant_key on public.orders(company_id,id);
create unique index if not exists coordination_invoice_tenant_key on public.invoices(company_id,id);
create unique index if not exists coordination_task_tenant_key on public.tasks(company_id,id);
create unique index if not exists coordination_action_request_tenant_key on public.action_requests(company_id,id);
create unique index if not exists coordination_profile_tenant_key on public.aluminium_profiles(company_id,id);
create unique index if not exists coordination_delegation_tenant_key on public.task_delegations(company_id,id);
create index if not exists coordination_payment_invoice_idx on public.payments(company_id,invoice_id,payment_status);

create table public.order_coordinators (
  company_id uuid not null references public.companies(id), order_id uuid not null,
  coordinator_id uuid, proposed_id uuid, proposed_by uuid, proposed_at timestamptz,
  accepted_at timestamptz, revision integer not null default 1 check(revision>0),
  primary key(company_id,order_id),
  foreign key(company_id,order_id) references public.orders(company_id,id),
  foreign key(company_id,coordinator_id) references public.app_users(company_id,id),
  foreign key(company_id,proposed_id) references public.app_users(company_id,id),
  foreign key(company_id,proposed_by) references public.app_users(company_id,id),
  check ((proposed_id is null)=(proposed_at is null)),
  check (proposed_id is null or proposed_id is distinct from coordinator_id)
);
create index order_coordinators_owner_idx on public.order_coordinators(company_id,coordinator_id);
create index order_coordinators_proposed_idx on public.order_coordinators(company_id,proposed_id);

create table public.collection_promises (
  id uuid primary key, company_id uuid not null references public.companies(id), invoice_id uuid not null,
  employee_id uuid not null, original_due_date date not null, due_date date not null,
  amount numeric(14,2) not null check(amount>0), baseline_paid numeric(14,2) not null, baseline_cash numeric(14,2) not null,
  baseline_credited numeric(14,2) not null, disputed_amount numeric(14,2) not null default 0 check(disputed_amount>=0),
  withdrawn_at timestamptz, revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(),
  foreign key(company_id,employee_id) references public.app_users(company_id,id),
  foreign key(company_id,invoice_id) references public.invoices(company_id,id)
);
create unique index collection_promises_one_open on public.collection_promises(company_id,invoice_id) where withdrawn_at is null;
create index collection_promises_tenant_idx on public.collection_promises(company_id,id);

create table public.handoff_service_contracts (
  id uuid primary key, company_id uuid not null references public.companies(id),
  team text not null check(team in ('packaging','quality','dispatch')), revision integer not null check(revision>0),
  response_hours integer not null check(response_hours between 1 and 720),
  requirements text not null check(length(btrim(requirements)) between 10 and 1200),
  evidence text not null check(length(btrim(evidence)) between 5 and 500),
  published_by uuid not null, published_at timestamptz not null default now(),
  unique(company_id,team,revision), unique(company_id,id),
  foreign key(company_id,published_by) references public.app_users(company_id,id)
);
create table public.handoff_service_snapshots (
  company_id uuid not null references public.companies(id), task_id uuid not null, contract_id uuid not null,
  response_due_at timestamptz not null, auto_accept boolean not null, quantity_tolerance_percent numeric(5,2) not null,
  primary key(company_id,task_id),
  foreign key(company_id,task_id) references public.tasks(company_id,id),
  foreign key(company_id,contract_id) references public.handoff_service_contracts(company_id,id)
);
create index handoff_service_due_idx on public.handoff_service_snapshots(company_id,response_due_at,task_id);

create table public.backup_coverages (
  id uuid primary key, company_id uuid not null references public.companies(id), primary_id uuid not null, backup_id uuid not null,
  responsibility text not null check(length(btrim(responsibility)) between 3 and 160),
  starts_at timestamptz not null, ends_at timestamptz not null, created_by uuid not null,
  acknowledged_at timestamptz, cancelled_at timestamptz, delegation_id uuid,
  revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(),
  unique(company_id,id), check(primary_id<>backup_id), check(ends_at>starts_at and ends_at-starts_at<=interval '90 days'),
  check((acknowledged_at is null)=(delegation_id is null)),
  foreign key(company_id,primary_id) references public.app_users(company_id,id),
  foreign key(company_id,backup_id) references public.app_users(company_id,id),
  foreign key(company_id,created_by) references public.app_users(company_id,id),
  foreign key(company_id,delegation_id) references public.task_delegations(company_id,id)
);
create index backup_coverages_window_idx on public.backup_coverages(company_id,primary_id,starts_at,ends_at) where cancelled_at is null;
create index backup_coverages_backup_idx on public.backup_coverages(company_id,backup_id,ends_at);

create table public.coordination_sessions (
  id uuid primary key, company_id uuid not null references public.companies(id),
  started_by uuid not null, started_at timestamptz not null default now(), snapshot jsonb not null,
  note text not null, unique(company_id,id),
  foreign key(company_id,started_by) references public.app_users(company_id,id)
);
create index coordination_sessions_time_idx on public.coordination_sessions(company_id,started_at desc,id);
create table public.coordination_decisions (
  id uuid primary key, company_id uuid not null references public.companies(id), session_id uuid not null,
  order_id uuid not null, task_id uuid not null, purpose_key text not null, created_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,task_id),
  foreign key(company_id,session_id) references public.coordination_sessions(company_id,id),
  foreign key(company_id,order_id) references public.orders(company_id,id),
  foreign key(company_id,task_id) references public.tasks(company_id,id)
);
create index coordination_decisions_purpose_idx on public.coordination_decisions(company_id,purpose_key);
create index coordination_decisions_session_idx on public.coordination_decisions(company_id,session_id);

create table public.action_request_details (
  id uuid primary key, company_id uuid not null references public.companies(id), due_date date not null,
  criteria text not null check(length(btrim(criteria)) between 5 and 500),
  stage text not null default 'requested' check(stage in ('requested','acknowledged','clarification')),
  last_note text not null, revision integer not null default 1 check(revision>0),
  foreign key(company_id,id) references public.action_requests(company_id,id)
);
create index action_request_details_due_idx on public.action_request_details(company_id,due_date,id);

create table public.master_stewardships (
  id uuid primary key, company_id uuid not null references public.companies(id),
  field_group text not null default 'profile_section_weight' check(field_group='profile_section_weight'),
  employee_id uuid not null, backup_id uuid not null, revision integer not null default 1 check(revision>0),
  assigned_at timestamptz not null default now(), unique(company_id,field_group), unique(company_id,id), check(employee_id<>backup_id),
  foreign key(company_id,employee_id) references public.app_users(company_id,id),
  foreign key(company_id,backup_id) references public.app_users(company_id,id)
);
create table public.profile_corrections (
  id uuid primary key, company_id uuid not null references public.companies(id), profile_id uuid not null,
  previous_weight numeric(12,3) not null, proposed_weight numeric(12,3) not null check(proposed_weight>0 and proposed_weight<=1000),
  source_fingerprint text not null, evidence text not null check(length(btrim(evidence)) between 5 and 500),
  state text not null default 'open' check(state in ('open','approved','rejected','superseded')),
  reported_by uuid not null, reported_at timestamptz not null default now(), reviewed_by uuid, reviewed_at timestamptz,
  unique(company_id,id), check((state='open')=(reviewed_at is null)), check(previous_weight<>proposed_weight),
  foreign key(company_id,profile_id) references public.aluminium_profiles(company_id,id),
  foreign key(company_id,reported_by) references public.app_users(company_id,id),
  foreign key(company_id,reviewed_by) references public.app_users(company_id,id)
);
create unique index profile_corrections_one_open on public.profile_corrections(company_id,profile_id) where state='open';
create index profile_corrections_state_idx on public.profile_corrections(company_id,state,reported_at,id);

create table public.coordination_requests (
  request_id uuid primary key, company_id uuid not null references public.companies(id), actor_id uuid not null,
  mutation jsonb not null, fingerprint text not null, review jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','confirmed','rejected','abandoned')),
  result jsonb, expires_at timestamptz not null default now()+interval '15 minutes', created_at timestamptz not null default now(),
  foreign key(company_id,actor_id) references public.app_users(company_id,id),
  check((state='prepared')=(result is null))
);
create index coordination_requests_actor_idx on public.coordination_requests(company_id,actor_id,created_at desc);
create table public.coordination_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  view_name text not null, entity_id uuid not null, action text not null, actor_id uuid not null, actor_name text not null,
  note text not null, facts jsonb not null, recorded_at timestamptz not null default now(),
  foreign key(company_id,actor_id) references public.app_users(company_id,id)
);
create index coordination_events_entity_idx on public.coordination_events(company_id,view_name,entity_id,recorded_at desc,id);

create function private.coordination_view(p_action text) returns text language sql immutable set search_path=public,private as $$
  select case split_part(p_action,'.',1) when 'coordinator' then 'orders' when 'priority' then 'orders' when 'collection' then 'collections'
    when 'contract' then 'handoffs' when 'coverage' then 'coverage' when 'session' then 'sessions' when 'decision' then 'decisions'
    when 'request' then 'requests' when 'steward' then 'stewards' when 'correction' then 'corrections' end
$$;
create function private.coordination_read_allowed(p_role text,p_view text) returns boolean language sql immutable set search_path=public,private as $$
  select coalesce(case
    when p_role not in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer') then false
    when p_view='collections' then p_role in ('owner','admin','accounts')
    when p_view='handoffs' then p_role in ('owner','admin','factory_manager','production_manager','production','dispatch_manager','dispatch','quality','viewer')
    when p_view in ('stewards','corrections') then p_role in ('owner','admin','factory_manager','production_manager','inventory_manager','sales_manager','sales','production','quality','viewer')
    else p_view in ('orders','coverage','sessions','decisions','requests') end,false)
$$;
create function private.coordination_action_allowed(p_role text,p_action text) returns boolean language sql immutable set search_path=public,private as $$
  select private.coordination_read_allowed(p_role,private.coordination_view(p_action)) and p_role<>'viewer' and coalesce(case
    when p_action like 'collection.%' then p_role in ('owner','admin','accounts')
    when p_action in ('coordinator.propose','priority.set') then p_role in ('owner','admin','factory_manager','sales_manager')
    when p_action='contract.publish' then p_role in ('owner','admin','factory_manager')
    when p_action in ('coverage.propose','session.start','decision.create') then p_role in ('owner','admin','factory_manager','production_manager','dispatch_manager','sales_manager')
    when p_action in ('steward.assign','correction.review') then p_role in ('owner','admin','production_manager')
    else p_action in ('coordinator.accept','coverage.acknowledge','coverage.cancel','coverage.reconcile','request.create','request.progress','correction.report') end,false)
$$;
revoke all on function private.coordination_view(text),private.coordination_read_allowed(text,text),private.coordination_action_allowed(text,text) from public,anon;
grant execute on function private.coordination_view(text),private.coordination_read_allowed(text,text),private.coordination_action_allowed(text,text) to authenticated;

do $$ declare t text; v text; begin
  for t,v in select * from (values ('order_coordinators','orders'),('collection_promises','collections'),('handoff_service_contracts','handoffs'),
    ('handoff_service_snapshots','handoffs'),('backup_coverages','coverage'),('coordination_sessions','sessions'),('coordination_decisions','decisions'),
    ('action_request_details','requests'),('master_stewardships','stewards'),('profile_corrections','corrections')) x(t,v) loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy coordination_tenant_read on public.%I for select to authenticated using (company_id=private.get_current_user_company_id() and private.get_current_user_dealer_id() is null and private.coordination_read_allowed(private.get_current_user_role(),%L))',t,v);
  end loop;
end $$;
-- The party restrictions apply in addition to the common tenant/domain policy.
create policy coordination_request_party on public.action_request_details as restrictive for select to authenticated using (
  exists(select 1 from public.action_requests r where r.id=action_request_details.id and r.company_id=action_request_details.company_id and auth.uid() in (r.requester_id,r.recipient_id))
);
create policy coordination_coverage_party on public.backup_coverages as restrictive for select to authenticated using (
  auth.uid() in (primary_id,backup_id,created_by) or private.get_current_user_role() in ('owner','admin','factory_manager','production_manager','dispatch_manager','sales_manager')
);
alter table public.coordination_requests enable row level security;
alter table public.coordination_events enable row level security;
revoke all on public.coordination_requests,public.coordination_events from public,anon,authenticated;
grant select on public.coordination_requests to authenticated;
create policy coordination_request_owner on public.coordination_requests for select to authenticated using (
  company_id=private.get_current_user_company_id() and actor_id=auth.uid() and private.get_current_user_dealer_id() is null
  and private.coordination_read_allowed(private.get_current_user_role(),private.coordination_view(mutation->>'action'))
);
-- History is projected through the authorized detail RPC; direct event access is denied.
create policy coordination_events_no_direct_read on public.coordination_events for select to authenticated using(false);

create function private.coordination_priority_rank(p_priority text) returns integer language sql immutable set search_path=public,private as $$
  select case p_priority when 'urgent' then 0 when 'high' then 1 when 'low' then 3 else 2 end
$$;
revoke all on function private.coordination_priority_rank(text) from public,anon,authenticated;

create function private.capture_handoff_service_contract() returns trigger language plpgsql security definer set search_path=public,private as $$
declare c public.handoff_service_contracts%rowtype; p public.handoff_team_policies%rowtype;
begin
  if new.handoff_key is null then return new; end if;
  select * into c from public.handoff_service_contracts where company_id=new.company_id and team=new.handoff_team order by revision desc limit 1;
  if found then
    select * into p from public.handoff_team_policies where company_id=new.company_id and team=new.handoff_team;
    insert into public.handoff_service_snapshots(company_id,task_id,contract_id,response_due_at,auto_accept,quantity_tolerance_percent)
    values(new.company_id,new.id,c.id,new.created_at+make_interval(hours=>c.response_hours),coalesce(p.auto_accept,false),coalesce(p.quantity_tolerance_percent,0.5))
    on conflict(company_id,task_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.capture_handoff_service_contract() from public,anon,authenticated;
create trigger zz_capture_handoff_service_contract after insert on public.tasks for each row execute function private.capture_handoff_service_contract();

create function private.coordination_snapshot(p_company uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_orders jsonb; v_decisions jsonb; v_order_state text:='available'; v_decision_state text:='available';
begin
  begin
    select coalesce(jsonb_agg(to_jsonb(x) order by rank,due_date nulls last,id),'[]'::jsonb) into v_orders from (
      select o.id,o.order_number as label,o.current_stage as status,o.priority,o.expected_dispatch_date as due_date,
        private.coordination_priority_rank(o.priority) as rank,u.full_name as coordinator,
        u.is_active as coordinator_active,c.proposed_id is not null as transfer_pending
      from public.orders o left join public.order_coordinators c on c.company_id=o.company_id and c.order_id=o.id
      left join public.app_users u on u.company_id=c.company_id and u.id=c.coordinator_id
      where o.company_id=p_company and o.deleted_at is null and o.current_stage not in ('closed','cancelled')
      order by private.coordination_priority_rank(o.priority),o.expected_dispatch_date nulls last,o.id limit 10
    ) x;
  exception when undefined_table or undefined_column or insufficient_privilege then v_orders:='[]'::jsonb;v_order_state:='unavailable'; end;
  begin
    select coalesce(jsonb_agg(to_jsonb(x) order by due_date nulls last,id),'[]'::jsonb) into v_decisions from (
      select d.id,t.title,t.status,t.due_date,u.full_name as owner,t.id as task_id,d.order_id
      from public.coordination_decisions d join public.tasks t on t.company_id=d.company_id and t.id=d.task_id
      left join public.app_users u on u.company_id=t.company_id and u.id=t.assigned_to
      where d.company_id=p_company and t.status in ('open','in_progress') order by t.due_date nulls last,d.id limit 10
    ) x;
  exception when undefined_table or undefined_column or insufficient_privilege then v_decisions:='[]'::jsonb;v_decision_state:='unavailable'; end;
  return jsonb_build_object('as_of',now(),'policy','existing-priority-due-v1','orders',jsonb_build_object('state',v_order_state,'rows',v_orders),
    'decisions',jsonb_build_object('state',v_decision_state,'rows',v_decisions),'scope','Up to ten live orders and ten unresolved decisions. Financial data is excluded.');
end $$;
revoke all on function private.coordination_snapshot(uuid) from public,anon,authenticated;

create function private.coordination_assert_shape(p_mutation jsonb) returns void language plpgsql set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_keys text[]; n text:=btrim(coalesce(p_mutation->>'note',''));
begin
  v_keys:=case a
    when 'coordinator.propose' then array['order_id','employee_id'] when 'coordinator.accept' then array['order_id']
    when 'priority.set' then array['order_id','priority'] when 'collection.create' then array['invoice_id','employee_id','amount','due_date','disputed_amount']
    when 'collection.update' then array['id','employee_id','due_date','disputed_amount'] when 'collection.withdraw' then array['id']
    when 'contract.publish' then array['team','response_hours','requirements','evidence']
    when 'coverage.propose' then array['primary_id','backup_id','starts_at','ends_at','responsibility']
    when 'coverage.acknowledge' then array['id'] when 'coverage.cancel' then array['id'] when 'coverage.reconcile' then array[]::text[]
    when 'session.start' then array[]::text[] when 'decision.create' then array['session_id','order_id','employee_id','due_date','title']
    when 'request.create' then array['order_id','employee_id','due_date','message','criteria'] when 'request.progress' then array['id','stage']
    when 'steward.assign' then array['employee_id','backup_id'] when 'correction.report' then array['profile_id','proposed_weight','evidence']
    when 'correction.review' then array['id','decision'] end;
  if jsonb_typeof(p_mutation) is distinct from 'object' or v_keys is null or not(p_mutation ?& (v_keys||array['action','note']))
    or exists(select 1 from jsonb_object_keys(p_mutation) k where not(k=any(v_keys||array['action','note'])))
    or length(n) not between 5 and 500 or n ~ '[[:cntrl:]]'
    or exists(select 1 from jsonb_each(p_mutation) x where jsonb_typeof(x.value)='null') then raise exception 'NOV: Review the required action details.'; end if;
end $$;
revoke all on function private.coordination_assert_shape(jsonb) from public,anon,authenticated;

create function private.coordination_invoice_cash(p_company uuid,p_invoice uuid) returns numeric language sql stable security definer set search_path=public,private as $$
  select coalesce(sum(case when payment_type='REFUND' then -amount else amount end),0) from public.payments
    where company_id=p_company and invoice_id=p_invoice and payment_status='PAID'
      and payment_method is distinct from 'credit_note' and payment_type is distinct from 'ADJUSTMENT'
$$;
revoke all on function private.coordination_invoice_cash(uuid,uuid) from public,anon,authenticated;

-- Minimal, authorized current sources are shared by preview and commitment. Row locks at
-- commitment also serialize with the existing invoice/order/profile transaction boundaries.
create function private.coordination_context(p_company uuid,p_actor uuid,p_mutation jsonb,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_role text; v_source jsonb:='{}'::jsonb; v_id uuid; v_order uuid; v_invoice uuid; v_profile uuid;
  v_row jsonb; v_related jsonb; v_employees jsonb; v_users uuid[];
begin
  perform private.coordination_assert_shape(p_mutation);
  select role into v_role from public.app_users where id=p_actor and company_id=p_company and is_active and dealer_id is null;
  if not private.coordination_action_allowed(v_role,a) then raise exception 'Not permitted' using errcode='42501'; end if;
  v_id:=nullif(p_mutation->>'id','')::uuid; v_order:=nullif(p_mutation->>'order_id','')::uuid;
  v_invoice:=nullif(p_mutation->>'invoice_id','')::uuid; v_profile:=nullif(p_mutation->>'profile_id','')::uuid;
  v_users:=array_remove(array[nullif(p_mutation->>'employee_id','')::uuid,nullif(p_mutation->>'primary_id','')::uuid,nullif(p_mutation->>'backup_id','')::uuid],null);
  if a like 'coordinator.%' or a='priority.set' or a='decision.create' or a='request.create' then
    if p_lock then perform 1 from public.orders where id=v_order and company_id=p_company for update; end if;
    select jsonb_build_object('id',o.id,'label',o.order_number,'status',o.current_stage,'priority',o.priority,'due_date',o.expected_dispatch_date,'updated_at',o.updated_at),to_jsonb(c)
    into v_row,v_related from public.orders o left join public.order_coordinators c on c.company_id=o.company_id and c.order_id=o.id
    where o.company_id=p_company and o.id=v_order and o.deleted_at is null;
    if v_row is null then raise exception 'NOV: The order is unavailable.'; end if;
    v_source:=jsonb_build_object('order',v_row,'coordination',v_related);
    if a='coordinator.accept' then v_users:=v_users||p_actor; end if;
    if a='decision.create' then
      select jsonb_build_object('id',id,'started_at',started_at) into v_row from public.coordination_sessions where company_id=p_company and id=(p_mutation->>'session_id')::uuid;
      if v_row is null then raise exception 'NOV: The coordination session is unavailable.'; end if;
      v_source:=v_source||jsonb_build_object('session',v_row);
    end if;
  elsif a like 'collection.%' then
    if a<>'collection.create' then
      if p_lock then perform 1 from public.collection_promises where company_id=p_company and id=v_id for update; end if;
      select to_jsonb(p),p.invoice_id into v_row,v_invoice from public.collection_promises p where p.company_id=p_company and p.id=v_id;
      if v_row is null then raise exception 'NOV: The collection promise is unavailable.'; end if;
      v_users:=v_users||((v_row->>'employee_id')::uuid);
      v_source:=jsonb_build_object('promise',v_row);
    end if;
    if p_lock then perform 1 from public.invoices where company_id=p_company and id=v_invoice for update; end if;
    select jsonb_build_object('id',id,'label',invoice_number,'customer_id',customer_id,'status',status,'balance_due',balance_due,'amount_paid',amount_paid,'cash_received',private.coordination_invoice_cash(p_company,id),'credited_amount',credited_amount,'updated_at',updated_at)
    into v_row from public.invoices where company_id=p_company and id=v_invoice and deleted_at is null;
    if v_row is null then raise exception 'NOV: The invoice is unavailable.'; end if;
    v_source:=v_source||jsonb_build_object('invoice',v_row);
  elsif a='contract.publish' then
    select to_jsonb(c) into v_row from public.handoff_service_contracts c where company_id=p_company and team=p_mutation->>'team' order by revision desc limit 1;
    if p_lock then perform 1 from public.handoff_team_policies where company_id=p_company and team=p_mutation->>'team' for update; end if;
    select to_jsonb(p) into v_related from public.handoff_team_policies p where company_id=p_company and team=p_mutation->>'team';
    v_source:=jsonb_build_object('contract',v_row,'acceptance_policy',v_related);
  elsif a like 'coverage.%' then
    if a in ('coverage.acknowledge','coverage.cancel') then
      if p_lock then perform 1 from public.backup_coverages where company_id=p_company and id=v_id for update; end if;
      select to_jsonb(c) into v_row from public.backup_coverages c where company_id=p_company and id=v_id;
      if v_row is null or not(p_actor in ((v_row->>'primary_id')::uuid,(v_row->>'backup_id')::uuid,(v_row->>'created_by')::uuid) or v_role in ('owner','admin','factory_manager','production_manager','dispatch_manager','sales_manager')) then
        raise exception 'NOV: The backup coverage is unavailable.'; end if;
      v_users:=array[(v_row->>'primary_id')::uuid,(v_row->>'backup_id')::uuid,(v_row->>'created_by')::uuid];
      v_source:=jsonb_build_object('coverage',v_row);
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'starts_at',starts_at,'ends_at',ends_at,'closed_at',closed_at,'activated_at',activated_at) order by id),'[]'::jsonb)
    into v_related from public.task_delegations where company_id=p_company and closed_at is null and (delegator_id=any(v_users) or delegate_id=any(v_users));
    v_source:=v_source||jsonb_build_object('delegations',v_related);
    select jsonb_build_object('count',count(*),'fingerprint',md5(coalesce(string_agg(concat_ws(':',id,status,assigned_to,updated_at),',' order by id),'')))
    into v_related from public.tasks where company_id=p_company and assigned_to=any(v_users) and status in ('open','in_progress') and dealership_id is null;
    v_source:=v_source||jsonb_build_object('open_work',v_related);
  elsif a='session.start' then
    v_source:=jsonb_build_object('snapshot',private.coordination_snapshot(p_company)-'as_of');
  elsif a='request.progress' then
    if p_lock then perform 1 from public.action_requests where id=v_id and company_id=p_company for update; end if;
    select jsonb_build_object('request',to_jsonb(r),'details',to_jsonb(d)) into v_source from public.action_requests r
      join public.action_request_details d on d.id=r.id and d.company_id=r.company_id
      where r.company_id=p_company and r.id=v_id and p_actor in (r.requester_id,r.recipient_id) and r.entity_type='order' and r.request_type='general';
    if v_source is null then raise exception 'NOV: The team request is unavailable.'; end if;
    if not (v_role=any(private.follow_roles('order'))) then raise exception 'Not permitted' using errcode='42501'; end if;
    v_users:=array[(v_source->'request'->>'requester_id')::uuid,(v_source->'request'->>'recipient_id')::uuid];
    v_order:=(v_source->'request'->>'entity_id')::uuid;
    if p_lock then perform 1 from public.orders where company_id=p_company and id=v_order for update; end if;
    select jsonb_build_object('id',id,'status',current_stage,'updated_at',updated_at) into v_related from public.orders where company_id=p_company and id=v_order and deleted_at is null;
    v_source:=v_source||jsonb_build_object('order',v_related);
  elsif a='steward.assign' or a like 'correction.%' then
    select to_jsonb(s) into v_related from public.master_stewardships s where company_id=p_company and field_group='profile_section_weight';
    v_source:=jsonb_build_object('stewardship',v_related);
    if v_related is not null then v_users:=v_users||array[(v_related->>'employee_id')::uuid,(v_related->>'backup_id')::uuid]; end if;
    if a='correction.review' then
      if p_lock then perform 1 from public.profile_corrections where company_id=p_company and id=v_id for update; end if;
      select to_jsonb(c),c.profile_id into v_row,v_profile from public.profile_corrections c where company_id=p_company and id=v_id;
      if v_row is null then raise exception 'NOV: The correction request is unavailable.'; end if;
      v_source:=v_source||jsonb_build_object('correction',v_row);
    end if;
    if a<>'steward.assign' then
      if p_lock then perform 1 from public.aluminium_profiles where company_id=p_company and id=v_profile for update; end if;
      select jsonb_build_object('id',id,'label',profile_code,'weight',section_weight_kg_per_m,'updated_at',updated_at,'is_active',is_active,'drawing_revision',drawing_revision,'drawing_approval_status',drawing_approval_status)
        into v_row from public.aluminium_profiles where company_id=p_company and id=v_profile;
      if v_row is null then raise exception 'NOV: The profile is unavailable.'; end if;
      v_source:=v_source||jsonb_build_object('profile',v_row,'open_work',private.profile_open_work(p_company,v_profile));
    end if;
  end if;
  if p_lock then perform 1 from public.app_users where company_id=p_company and id=any(v_users) order by id for share; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'role',role,'active',is_active,'internal',dealer_id is null) order by id),'[]'::jsonb)
    into v_employees from public.app_users where company_id=p_company and id=any(v_users);
  return v_source||jsonb_build_object('employees',v_employees,'actor_role',v_role);
end $$;
revoke all on function private.coordination_context(uuid,uuid,jsonb,boolean) from public,anon,authenticated;

create function private.coordination_review(p_mutation jsonb,p_context jsonb) returns jsonb language plpgsql immutable set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_warnings jsonb:='[]'::jsonb; v_names text;
begin
  select string_agg(coalesce(x->>'name','Employee'),' / ' order by x->>'id') into v_names from jsonb_array_elements(p_context->'employees') x;
  v_facts:=jsonb_build_object('Employees',v_names,'Reason',p_mutation->>'note');
  if a like 'coordinator.%' then
    v_title:='Order coordinator';v_effect:=case when a='coordinator.propose' then 'Propose the selected coordinator. The current coordinator remains accountable until the replacement accepts.' else 'Accept responsibility for coordinating this order. Department assignments and action permissions remain separate.' end;
    v_facts:=v_facts||jsonb_build_object('Order',p_context->'order'->>'label','Current stage',p_context->'order'->>'status');
  elsif a='priority.set' then
    v_title:='Operational priority';v_effect:='Set the order priority to '||(p_mutation->>'priority')||' under existing-priority-due-v1: urgent, high, normal, low; then dispatch due date; then stable record identity. Scheduling and readiness remain independently guarded.';
    v_facts:=v_facts||jsonb_build_object('Order',p_context->'order'->>'label','Current priority',p_context->'order'->>'priority','Due date',p_context->'order'->>'due_date');
    v_warnings:=jsonb_build_array('Review competing commitments in the priority queue. This action does not move a production schedule or release a blocker.');
  elsif a like 'collection.%' then
    v_title:='Collection follow-up';v_effect:=case a when 'collection.create' then 'Record a customer payment promise and its owner. No payment, credit, invoice or dispatch hold is posted.' when 'collection.update' then 'Record the revised follow-up, dispute and owner. Preserve the original promise and change history.' else 'Withdraw this promise with its reason. The invoice balance is unchanged.' end;
    v_facts:=v_facts||jsonb_build_object('Invoice',p_context->'invoice'->>'label','Current balance (INR)',p_context->'invoice'->'balance_due','Promised amount (INR)',coalesce(p_mutation->'amount',p_context->'promise'->'amount'),'Follow-up date',coalesce(p_mutation->>'due_date',p_context->'promise'->>'due_date'),'Disputed amount (INR)',coalesce(p_mutation->'disputed_amount',p_context->'promise'->'disputed_amount'));
    v_warnings:=jsonb_build_array('Promise progress uses the posted cash-receipt change since the promise, excluding non-cash adjustments. Credits can settle the invoice without fulfilling a cash promise. This is not attribution to a specific receipt. Reversals can reopen the follow-up.');
  elsif a='contract.publish' then
    v_title:='Handoff service contract';v_effect:='Publish the next contract revision for '||(p_mutation->>'team')||'. Future handoffs retain this revision, quantity basis and elapsed-hour response target. Existing handoffs keep their recorded contract.';
    v_facts:=v_facts||jsonb_build_object('Response target (elapsed hours)',p_mutation->'response_hours','Prerequisites',p_mutation->>'requirements','Required evidence',p_mutation->>'evidence');
    v_warnings:=jsonb_build_array('The existing authoritative acceptance prerequisites and quantity tolerance still apply. Elapsed hours include nights and holidays.');
  elsif a like 'coverage.%' then
    v_title:='Backup responsibility';v_effect:=case a when 'coverage.propose' then 'Request acknowledged, time-bounded backup coverage. No task moves before the backup accepts.' when 'coverage.acknowledge' then 'Accept coverage and create the existing all-open task delegation for the approved window. Only eligible task assignments move; qualifications and action permissions remain enforced.' when 'coverage.cancel' then 'End coverage. Reconcile unfinished tasks through the existing delegation mechanism, preserving completed and independently reassigned work.' else 'Activate due acknowledged delegations and reconcile expired coverage using the existing delegation mechanism.' end;
    v_facts:=v_facts||jsonb_build_object('Open tasks in reviewed scope',p_context->'open_work'->'count','Starts',coalesce(p_mutation->>'starts_at',p_context->'coverage'->>'starts_at'),'Ends',coalesce(p_mutation->>'ends_at',p_context->'coverage'->>'ends_at'));
    v_warnings:=jsonb_build_array('Task families and current eligibility can exclude work. A scheduled delegation needs the existing synchronization job or Reconcile coverage after its start time.');
  elsif a='session.start' then
    v_title:='Daily coordination snapshot';v_effect:='Retain up to ten priority orders and ten unresolved decisions with source availability and an as-of time. Starting a session does not create tasks or duplicate unresolved decisions.';
    v_facts:=v_facts||jsonb_build_object('Orders source',p_context->'snapshot'->'orders'->>'state','Decisions source',p_context->'snapshot'->'decisions'->>'state');
  elsif a='decision.create' then
    v_title:='Coordination decision';v_effect:='Create one assigned task linked to the selected session and order. Open decisions carry forward through their original task until it is completed or cancelled.';
    v_facts:=v_facts||jsonb_build_object('Order',p_context->'order'->>'label','Agreed action',p_mutation->>'title','Due date',p_mutation->>'due_date');
  elsif a='request.create' then
    v_title:='Team request';v_effect:='Create one general request on this order with a recipient, needed-by date and completion criteria. Existing grouped notifications and reminder preferences apply. This does not grant an approval or complete a handoff.';
    v_facts:=v_facts||jsonb_build_object('Order',p_context->'order'->>'label','Request',p_mutation->>'message','Completion criteria',p_mutation->>'criteria','Needed by',p_mutation->>'due_date');
  elsif a='request.progress' then
    v_title:='Team request response';v_effect:='Record the request as '||(p_mutation->>'stage')||' and retain the response. Only the recipient can resolve it; only the requester can withdraw it.';
    v_facts:=v_facts||jsonb_build_object('Request',p_context->'request'->>'message','Completion criteria',p_context->'details'->>'criteria');
  elsif a='steward.assign' then
    v_title:='Profile section-weight stewardship';v_effect:='Assign the primary and backup steward for profile section weight. Stewardship does not grant profile-edit permission or change any master data.';
  elsif a='correction.report' then
    v_title:='Profile weight correction request';v_effect:='Request a reviewed correction to the current profile section weight. The master remains unchanged pending an independent steward review.';
    v_facts:=v_facts||jsonb_build_object('Profile',p_context->'profile'->>'label','Current section weight (kg/m)',p_context->'profile'->'weight','Proposed section weight (kg/m)',p_mutation->'proposed_weight','Evidence',p_mutation->>'evidence');
  elsif a='correction.review' then
    v_title:='Profile correction review';v_effect:=case when p_mutation->>'decision'='approved' then 'Approve and update the current profile section weight only if the reviewed master revision still matches. Issued documents and existing order-line technical snapshots are preserved.' else 'Record the correction as '||(p_mutation->>'decision')||' without changing the profile.' end;
    v_facts:=v_facts||jsonb_build_object('Profile',p_context->'profile'->>'label','Current section weight (kg/m)',p_context->'profile'->'weight','Proposed section weight (kg/m)',p_context->'correction'->'proposed_weight','Reported evidence',p_context->'correction'->>'evidence');
    v_facts:=v_facts||jsonb_build_object('Open production jobs',p_context->'open_work'->'production_jobs','Open billet requirements',p_context->'open_work'->'billet_requirements','Active stock reservations',p_context->'open_work'->'stock_reservations','Open order lines',p_context->'open_work'->'open_order_lines');
    v_warnings:=jsonb_build_array('A profile with open work requires an owner/admin steward and a reason of at least ten characters through the existing specification-change approval. Review unfinished drafts; existing technical snapshots are not rewritten. A reporter cannot approve their own correction.');
  end if;
  return jsonb_build_object('title',v_title,'effect',v_effect,'facts',v_facts,'warnings',v_warnings);
end $$;
revoke all on function private.coordination_review(jsonb,jsonb) from public,anon,authenticated;

create function private.coordination_employee(p_company uuid,p_id uuid) returns public.app_users language plpgsql stable security definer set search_path=public,private as $$
declare u public.app_users%rowtype;
begin
  select * into u from public.app_users where company_id=p_company and id=p_id and is_active and dealer_id is null and role<>'viewer';
  if not found then raise exception 'NOV: Choose an active, eligible employee of this company.'; end if;
  return u;
end $$;
revoke all on function private.coordination_employee(uuid,uuid) from public,anon,authenticated;

create function private.coordination_apply(p_company uuid,p_actor uuid,p_request uuid,p_mutation jsonb,p_context jsonb)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; n text:=btrim(p_mutation->>'note'); v_role text:=p_context->>'actor_role';
  v_id uuid:=p_request; v_entity uuid; v_label text; v_href text; v_message text;
  u public.app_users%rowtype; b public.app_users%rowtype; m public.app_users%rowtype;
  c public.order_coordinators%rowtype; cp public.collection_promises%rowtype; cov public.backup_coverages%rowtype;
  cr public.profile_corrections%rowtype; st public.master_stewardships%rowtype; r public.action_requests%rowtype;
  v_due date; v_amount numeric; v_dispute numeric; v_weight numeric; v_start timestamptz; v_end timestamptz;
  v_revision integer; v_moved integer; v_result jsonb; v_name text; v_purpose text; v_lock uuid;
begin
  if not private.coordination_action_allowed(v_role,a) then raise exception 'Not permitted' using errcode='42501'; end if;
  select coalesce(nullif(full_name,''),'Employee') into v_name from public.app_users where id=p_actor and company_id=p_company and is_active and dealer_id is null;
  if v_name is null then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_mutation ? 'due_date' then
    if p_mutation->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'NOV: Choose a real calendar date.'; end if;
    v_due:=(p_mutation->>'due_date')::date;
  end if;
  if p_mutation ? 'employee_id' then u:=private.coordination_employee(p_company,(p_mutation->>'employee_id')::uuid); end if;
  if p_mutation ? 'backup_id' then b:=private.coordination_employee(p_company,(p_mutation->>'backup_id')::uuid); end if;

  if a in ('coordinator.propose','coordinator.accept','priority.set') then
    v_entity:=(p_mutation->>'order_id')::uuid;v_label:=p_context->'order'->>'label';
    if p_context->'order'->>'status' in ('closed','cancelled') then raise exception 'NOV: This order is closed or cancelled.'; end if;
    select * into c from public.order_coordinators where company_id=p_company and order_id=v_entity;
    if a='coordinator.propose' then
      if u.role not in ('owner','admin','sales_manager','sales','factory_manager','production_manager','dispatch_manager') then raise exception 'NOV: Choose an eligible order coordinator.'; end if;
      if c.coordinator_id=u.id or c.proposed_id=u.id then raise exception 'NOV: This employee already owns or is awaiting this responsibility.'; end if;
      insert into public.order_coordinators(company_id,order_id,proposed_id,proposed_by,proposed_at)
        values(p_company,v_entity,u.id,p_actor,now()) on conflict(company_id,order_id) do update
        set proposed_id=excluded.proposed_id,proposed_by=p_actor,proposed_at=now(),revision=order_coordinators.revision+1;
      v_message:='Coordinator transfer proposed. The current coordinator remains responsible until the selected employee accepts.';
    elsif a='coordinator.accept' then
      u:=private.coordination_employee(p_company,p_actor);
      if c.proposed_id is distinct from p_actor or u.role not in ('owner','admin','sales_manager','sales','factory_manager','production_manager','dispatch_manager') then raise exception 'NOV: Only the proposed eligible coordinator can accept this transfer.'; end if;
      update public.order_coordinators set coordinator_id=p_actor,proposed_id=null,proposed_by=null,proposed_at=null,accepted_at=now(),revision=revision+1 where company_id=p_company and order_id=v_entity;
      v_message:='Coordinator responsibility accepted. Department ownership and permissions are unchanged.';
    else
      if coalesce(p_mutation->>'priority','') not in ('urgent','high','normal','low') then raise exception 'NOV: Choose a valid operational priority.'; end if;
      update public.orders set priority=p_mutation->>'priority',updated_at=now() where company_id=p_company and id=v_entity;
      v_message:='Priority recorded with its reason under existing-priority-due-v1. Review competing orders; schedules and readiness checks remain authoritative.';
    end if;
    v_href:='/tasks/coordination/orders/'||v_entity;

  elsif a like 'collection.%' then
    if a='collection.create' then
      if u.role not in ('owner','admin','accounts') then raise exception 'NOV: Collections must be assigned to an active finance employee.'; end if;
      v_amount:=(p_mutation->>'amount')::numeric;v_dispute:=(p_mutation->>'disputed_amount')::numeric;
      if v_amount is null or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount<=0 or v_amount<>round(v_amount,2)
        or v_amount>(p_context->'invoice'->>'balance_due')::numeric then raise exception 'NOV: The promised amount must be positive and no greater than the current balance.'; end if;
      if p_context->'invoice'->>'status' in ('cancelled','draft') or (p_context->'invoice'->>'balance_due')::numeric<=0 then raise exception 'NOV: This invoice has no collectible issued balance.'; end if;
      if v_dispute is null or v_dispute::text in ('NaN','Infinity','-Infinity') or v_dispute<0 or v_dispute<>round(v_dispute,2) or v_dispute>(p_context->'invoice'->>'balance_due')::numeric then raise exception 'NOV: Enter a valid disputed amount within the invoice balance.'; end if;
      if exists(select 1 from public.collection_promises where company_id=p_company and invoice_id=(p_mutation->>'invoice_id')::uuid and withdrawn_at is null) then raise exception 'NOV: This invoice already has an active collection promise. Update or withdraw that promise.'; end if;
      insert into public.collection_promises(id,company_id,invoice_id,employee_id,original_due_date,due_date,amount,baseline_paid,baseline_cash,baseline_credited,disputed_amount)
        values(v_id,p_company,(p_mutation->>'invoice_id')::uuid,u.id,v_due,v_due,v_amount,(p_context->'invoice'->>'amount_paid')::numeric,(p_context->'invoice'->>'cash_received')::numeric,(p_context->'invoice'->>'credited_amount')::numeric,v_dispute);
      v_message:='Payment promise recorded. No money or credit was posted.';
    else
      v_id:=(p_mutation->>'id')::uuid;
      select * into cp from public.collection_promises where id=v_id and company_id=p_company for update;
      if cp.withdrawn_at is not null then raise exception 'NOV: This promise has already been withdrawn.'; end if;
      if a='collection.withdraw' then
        update public.collection_promises set withdrawn_at=now(),revision=revision+1 where id=v_id and company_id=p_company;
        v_message:='Promise withdrawn with its reason. The invoice balance is unchanged.';
      else
        if u.role not in ('owner','admin','accounts') then raise exception 'NOV: Collections must be assigned to an active finance employee.'; end if;
        if p_context->'invoice'->>'status' in ('cancelled','draft') or (p_context->'invoice'->>'balance_due')::numeric<=0 then raise exception 'NOV: This invoice has no collectible issued balance.'; end if;
        v_dispute:=(p_mutation->>'disputed_amount')::numeric;
        if v_dispute is null or v_dispute::text in ('NaN','Infinity','-Infinity') or v_dispute<0 or v_dispute<>round(v_dispute,2) or v_dispute>(p_context->'invoice'->>'balance_due')::numeric then raise exception 'NOV: Enter a valid disputed amount within the invoice balance.'; end if;
        update public.collection_promises set employee_id=u.id,due_date=v_due,disputed_amount=v_dispute,revision=revision+1 where id=v_id and company_id=p_company;
        v_message:='Follow-up updated. Original promise date and all contact/change reasons are retained.';
      end if;
    end if;
    v_entity:=v_id;v_label:=p_context->'invoice'->>'label';v_href:='/tasks/coordination/collections/'||v_id;

  elsif a='contract.publish' then
    if coalesce(p_mutation->>'team','') not in ('packaging','quality','dispatch') or coalesce((p_mutation->>'response_hours')::integer,0) not between 1 and 720
      or length(btrim(coalesce(p_mutation->>'requirements',''))) not between 10 and 1200 or length(btrim(coalesce(p_mutation->>'evidence',''))) not between 5 and 500 then raise exception 'NOV: Define the receiving team, elapsed-hour target, prerequisites and evidence.'; end if;
    select coalesce(max(revision),0)+1 into v_revision from public.handoff_service_contracts where company_id=p_company and team=p_mutation->>'team';
    insert into public.handoff_service_contracts(id,company_id,team,revision,response_hours,requirements,evidence,published_by)
      values(v_id,p_company,p_mutation->>'team',v_revision,(p_mutation->>'response_hours')::integer,btrim(p_mutation->>'requirements'),btrim(p_mutation->>'evidence'),p_actor);
    v_entity:=v_id;v_label:=initcap(p_mutation->>'team')||' contract revision '||v_revision;v_href:='/tasks/coordination/handoffs/'||v_id;
    v_message:='Contract published for future handoffs. Existing acceptance guards and historical contracts are preserved.';

  elsif a like 'coverage.%' then
    if a='coverage.reconcile' then
      v_result:=public.task_delegation_command('delegation.sync','{}'::jsonb);
      v_entity:=v_id;v_label:='Coverage reconciliation';v_href:='/tasks/coordination/database?view=coverage';
      v_message:=concat(v_result->>'activated',' delegation(s) activated; ',v_result->>'expired',' expired delegation(s) reconciled.');
    else
      if a='coverage.propose' then
        u:=private.coordination_employee(p_company,(p_mutation->>'primary_id')::uuid);
        v_start:=(p_mutation->>'starts_at')::timestamptz;v_end:=(p_mutation->>'ends_at')::timestamptz;
      else
        v_id:=(p_mutation->>'id')::uuid;
        select * into cov from public.backup_coverages where company_id=p_company and id=v_id for update;
        if cov.cancelled_at is not null then raise exception 'NOV: This coverage has already ended.'; end if;
        if a='coverage.cancel' then
          if p_actor<>cov.created_by and v_role not in ('owner','admin') then raise exception 'NOV: Only the proposing supervisor or an administrator can cancel coverage.'; end if;
          if cov.delegation_id is not null then perform private.close_delegation(cov.delegation_id,'cancelled',n); end if;
          update public.backup_coverages set cancelled_at=now(),revision=revision+1 where company_id=p_company and id=v_id;
        else
          if p_actor<>cov.backup_id or cov.acknowledged_at is not null then raise exception 'NOV: Only the selected backup can acknowledge unaccepted coverage.'; end if;
          u:=private.coordination_employee(p_company,cov.primary_id);b:=private.coordination_employee(p_company,cov.backup_id);
          m:=private.coordination_employee(p_company,cov.created_by);v_start:=greatest(cov.starts_at,now());v_end:=cov.ends_at;
          if not private.coordination_action_allowed(m.role,'coverage.propose') then raise exception 'NOV: The proposing supervisor is no longer eligible. Request new coverage.'; end if;
        end if;
      end if;
      if a<>'coverage.cancel' then
        if u.id=b.id or not private.delegate_eligible(null::public.tasks,b.role,u.role) then raise exception 'NOV: The backup must be a different employee in an eligible team family.'; end if;
        if (case when a='coverage.propose' then v_role else m.role end) not in ('owner','admin')
          and not(u.role=any(private.bulk_supervised_roles(case when a='coverage.propose' then v_role else m.role end)) and b.role=any(private.bulk_supervised_roles(case when a='coverage.propose' then v_role else m.role end))) then raise exception 'NOV: The supervisor must have authority over both employees.'; end if;
        if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_end<=v_start or v_end<=now() or v_end-v_start>interval '90 days' or (a='coverage.propose' and v_start<now()-interval '5 minutes') then raise exception 'NOV: Choose a current or future coverage window of at most 90 days.'; end if;
        for v_lock in select x from unnest(array[u.id,b.id]) x order by x loop perform pg_advisory_xact_lock(hashtextextended(p_company::text||':delegation:'||v_lock::text,0)); end loop;
        if exists(select 1 from public.backup_coverages where company_id=p_company and cancelled_at is null and id<>v_id and starts_at<v_end and ends_at>v_start
          and (primary_id=u.id or primary_id=b.id or backup_id=u.id))
          or exists(select 1 from public.task_delegations where company_id=p_company and closed_at is null and starts_at<v_end and ends_at>v_start and delegator_id in (u.id,b.id)) then raise exception 'NOV: This coverage overlaps another absence, delegation or coverage chain.'; end if;
        if a='coverage.propose' then
          if length(btrim(coalesce(p_mutation->>'responsibility',''))) not between 3 and 160 then raise exception 'NOV: Describe the responsibility being covered.'; end if;
          insert into public.backup_coverages(id,company_id,primary_id,backup_id,responsibility,starts_at,ends_at,created_by)
            values(v_id,p_company,u.id,b.id,btrim(p_mutation->>'responsibility'),v_start,v_end,p_actor);
        else
          insert into public.task_delegations(id,company_id,delegator_id,delegate_id,starts_at,ends_at,scope,reason,created_by,created_by_name)
            values(p_request,p_company,u.id,b.id,v_start,v_end,'all_open',left(cov.responsibility||': '||n,300),m.id,coalesce(m.full_name,'Supervisor'));
          v_moved:=private.activate_delegation(p_request,null);
          update public.backup_coverages set acknowledged_at=now(),delegation_id=p_request,revision=revision+1 where company_id=p_company and id=v_id;
        end if;
      end if;
      v_entity:=v_id;v_label:='Backup coverage';v_href:='/tasks/coordination/coverage/'||v_id;
      v_message:=case a when 'coverage.propose' then 'Coverage proposed. No task moves until the backup acknowledges.' when 'coverage.cancel' then 'Coverage ended; the existing delegation reconciled unfinished, completed and reassigned tasks.' else concat('Coverage acknowledged; ',coalesce(v_moved,0),' eligible open task(s) moved now. Scheduled work activates through delegation synchronization.') end;
    end if;

  elsif a='session.start' then
    insert into public.coordination_sessions(id,company_id,started_by,snapshot,note) values(v_id,p_company,p_actor,private.coordination_snapshot(p_company),n);
    v_entity:=v_id;v_label:='Coordination session';v_href:='/tasks/coordination/sessions/'||v_id;v_message:='Live agenda snapshot retained. Unresolved decisions keep their original task identities.';

  elsif a='decision.create' then
    if v_role not in ('owner','admin') and not(u.role=any(private.bulk_supervised_roles(v_role))) then raise exception 'NOV: Choose an employee in a team you supervise.'; end if;
    if p_context->'order'->>'status' in ('closed','cancelled') or length(btrim(coalesce(p_mutation->>'title',''))) not between 5 and 160 then raise exception 'NOV: Choose a live order and a specific agreed action.'; end if;
    v_purpose:=md5((p_mutation->>'order_id')||':'||lower(btrim(p_mutation->>'title')));
    if exists(select 1 from public.coordination_decisions d join public.tasks t on t.id=d.task_id and t.company_id=d.company_id where d.company_id=p_company and d.purpose_key=v_purpose and t.status in ('open','in_progress')) then raise exception 'NOV: This unresolved decision already has a task. Carry it forward instead of duplicating it.'; end if;
    insert into public.tasks(id,company_id,task_type,title,description,status,priority,assigned_to,due_date,related_entity_type,related_entity_id,created_by)
      values(v_id,p_company,'general',btrim(p_mutation->>'title'),n,'open',p_context->'order'->>'priority',u.id,v_due,'order',(p_mutation->>'order_id')::uuid,p_actor);
    insert into public.coordination_decisions(id,company_id,session_id,order_id,task_id,purpose_key)
      values(v_id,p_company,(p_mutation->>'session_id')::uuid,(p_mutation->>'order_id')::uuid,v_id,v_purpose);
    v_entity:=v_id;v_label:=p_mutation->>'title';v_href:='/tasks/coordination/decisions/'||v_id;v_message:='Decision recorded as one assigned task. Complete or reassign it through its task workflow.';

  elsif a='request.create' then
    if length(btrim(coalesce(p_mutation->>'message',''))) not between 5 and 300 or length(btrim(coalesce(p_mutation->>'criteria',''))) not between 5 and 500 then raise exception 'NOV: Describe the request and its completion criteria.'; end if;
    if p_context->'order'->>'status' in ('closed','cancelled') then raise exception 'NOV: Choose a live order for this request.'; end if;
    if exists(select 1 from public.action_requests where company_id=p_company and requester_id=p_actor and recipient_id=u.id
      and entity_type='order' and entity_id=(p_mutation->>'order_id')::uuid and request_type='general' and resolved_at is null) then
      raise exception 'NOV: There is already an open request to this recipient for this order. Continue or close that request before creating another.';
    end if;
    perform public.subscription_command('request.create',jsonb_build_object('id',v_id,'entity_type','order','entity_id',p_mutation->>'order_id','request_type','general','recipient_id',u.id,'message',btrim(p_mutation->>'message'),'reminder_hours',4));
    insert into public.action_request_details(id,company_id,due_date,criteria,last_note) values(v_id,p_company,v_due,btrim(p_mutation->>'criteria'),n);
    v_entity:=v_id;v_label:='Order team request';v_href:='/tasks/coordination/requests/'||v_id;v_message:='Request recorded with a recipient, deadline and completion criteria. Existing notification preferences apply.';

  elsif a='request.progress' then
    v_id:=(p_mutation->>'id')::uuid;select * into r from public.action_requests where company_id=p_company and id=v_id for update;
    if r.resolved_at is not null then raise exception 'NOV: This request is already closed.'; end if;
    if p_mutation->>'stage'='withdrawn' then
      if p_actor<>r.requester_id then raise exception 'NOV: Only the requester can withdraw this request.'; end if;
      perform public.subscription_command('request.close',jsonb_build_object('id',v_id,'note',left(n,300)));
    else
      if p_actor<>r.recipient_id then raise exception 'NOV: Only the recipient can acknowledge, clarify or resolve this request.'; end if;
      if p_context->'order'='null'::jsonb or p_context->'order'->>'status' in ('closed','cancelled') then raise exception 'NOV: The source order is unavailable or no longer live. Ask the requester to withdraw the request.'; end if;
      perform private.coordination_employee(p_company,r.recipient_id);
      if p_mutation->>'stage'='resolved' then perform public.subscription_command('request.close',jsonb_build_object('id',v_id,'note',left(n,300)));
      elsif p_mutation->>'stage' in ('acknowledged','clarification') then
        update public.action_request_details set stage=p_mutation->>'stage',last_note=n,revision=revision+1 where company_id=p_company and id=v_id;
      else raise exception 'NOV: Choose a valid request response.'; end if;
    end if;
    if p_mutation->>'stage' in ('resolved','withdrawn') then
      update public.action_request_details set last_note=n,revision=revision+1 where company_id=p_company and id=v_id;
    end if;
    v_entity:=v_id;v_label:=r.label;v_href:='/tasks/coordination/requests/'||v_id;v_message:='Request response retained. Closure stops reminders through the existing request lifecycle.';

  elsif a='steward.assign' then
    if u.id=b.id or u.role not in ('owner','admin','production_manager') or b.role not in ('owner','admin','production_manager') then raise exception 'NOV: Choose different, eligible primary and backup technical stewards who already have profile-edit authority.'; end if;
    insert into public.master_stewardships(id,company_id,employee_id,backup_id) values(v_id,p_company,u.id,b.id)
      on conflict(company_id,field_group) do update set employee_id=u.id,backup_id=b.id,revision=master_stewardships.revision+1,assigned_at=now() returning id into v_id;
    v_entity:=v_id;v_label:='Profile section-weight stewards';v_href:='/tasks/coordination/stewards/'||v_id;v_message:='Stewardship and its backup recorded. Action permissions are unchanged.';

  elsif a='correction.report' then
    v_weight:=(p_mutation->>'proposed_weight')::numeric;
    if v_weight is null or v_weight::text in ('NaN','Infinity','-Infinity') or v_weight<=0 or v_weight>1000 or v_weight<>round(v_weight,3)
      or v_weight=(p_context->'profile'->>'weight')::numeric or length(btrim(coalesce(p_mutation->>'evidence',''))) not between 5 and 500 then raise exception 'NOV: Enter a different positive section weight up to 1000 kg/m and supporting evidence.'; end if;
    if not coalesce((p_context->'profile'->>'is_active')::boolean,false) then raise exception 'NOV: The profile is inactive. Review its master record first.'; end if;
    if exists(select 1 from public.profile_corrections where company_id=p_company and profile_id=(p_mutation->>'profile_id')::uuid and state='open') then raise exception 'NOV: This profile already has an open correction. Review that request first.'; end if;
    insert into public.profile_corrections(id,company_id,profile_id,previous_weight,proposed_weight,source_fingerprint,evidence,reported_by)
      values(v_id,p_company,(p_mutation->>'profile_id')::uuid,(p_context->'profile'->>'weight')::numeric,v_weight,md5((p_context->'profile')::text),btrim(p_mutation->>'evidence'),p_actor);
    v_entity:=v_id;v_label:=p_context->'profile'->>'label';v_href:='/tasks/coordination/corrections/'||v_id;v_message:='Correction requested. Current master data and issued technical snapshots are unchanged.';

  elsif a='correction.review' then
    v_id:=(p_mutation->>'id')::uuid;select * into cr from public.profile_corrections where company_id=p_company and id=v_id for update;
    select * into st from public.master_stewardships where company_id=p_company and field_group='profile_section_weight';
    if cr.state<>'open' then raise exception 'NOV: This correction was already reviewed.'; end if;
    if p_actor not in (coalesce(st.employee_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(st.backup_id,'00000000-0000-0000-0000-000000000000'::uuid)) then raise exception 'NOV: Only the currently assigned primary or backup steward can review this correction.'; end if;
    if coalesce(p_mutation->>'decision','') not in ('approved','rejected','superseded') then raise exception 'NOV: Choose an explicit correction outcome.'; end if;
    if p_mutation->>'decision'='approved' then
      if cr.reported_by=p_actor then raise exception 'NOV: A reporter cannot approve their own correction. Ask the other steward to review it.'; end if;
      if cr.source_fingerprint<>md5((p_context->'profile')::text) then raise exception 'NOV: The profile changed after this correction was proposed. Supersede it and review the current source.'; end if;
      if not coalesce((p_context->'profile'->>'is_active')::boolean,false) then raise exception 'NOV: The profile is inactive. Review its master record first.'; end if;
      if (select coalesce(sum(value::integer),0) from jsonb_each_text(p_context->'open_work'))>0 then
        if v_role not in ('owner','admin') then raise exception 'NOV: This profile has open work. An owner/admin who is a named steward must approve its specification change.'; end if;
        if length(n)<10 then raise exception 'NOV: Explain the specification change in at least ten characters.'; end if;
        perform public.approve_profile_spec_change(cr.profile_id,jsonb_build_object('section_weight_kg_per_m',cr.proposed_weight),n);
      else
        update public.aluminium_profiles set section_weight_kg_per_m=cr.proposed_weight,updated_at=now() where company_id=p_company and id=cr.profile_id;
      end if;
    end if;
    update public.profile_corrections set state=p_mutation->>'decision',reviewed_by=p_actor,reviewed_at=now() where company_id=p_company and id=v_id;
    v_entity:=v_id;v_label:=p_context->'profile'->>'label';v_href:='/tasks/coordination/corrections/'||v_id;
    v_message:=case when p_mutation->>'decision'='approved' then 'Current profile section weight corrected. Existing order-line snapshots and issued documents were preserved; review unfinished drafts.' else 'Review outcome retained. Profile master unchanged.' end;
  else raise exception 'NOV: Unknown coordination action.';
  end if;
  insert into public.coordination_events(company_id,view_name,entity_id,action,actor_id,actor_name,note,facts)
    values(p_company,private.coordination_view(a),v_entity,a,p_actor,v_name,n,jsonb_build_object('before',p_context,'mutation',p_mutation,'request_id',p_request));
  return jsonb_build_object('label',v_label,'href',v_href,'message',v_message);
end $$;
revoke all on function private.coordination_apply(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

create function private.coordination_request_resolution(r public.action_requests) returns text language sql stable security definer set search_path=public,private as $$
  select coalesce(r.resolution,private.action_request_resolution(r),case when not exists(select 1 from public.app_users u
    where u.company_id=r.company_id and u.id=r.recipient_id and u.is_active and u.dealer_id is null and u.role=any(private.follow_roles(r.entity_type))) then 'recipient_unavailable' end)
$$;
revoke all on function private.coordination_request_resolution(public.action_requests) from public,anon,authenticated;

create function private.coordination_rows(p_company uuid,p_actor uuid,p_view text,p_state text,p_id uuid default null)
returns table(row_data jsonb,sort_rank integer,sort_due date,sort_new timestamptz) language plpgsql stable security definer set search_path=public,private as $$
declare v_role text:=private.get_current_user_role(); v_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  if not private.coordination_read_allowed(v_role,p_view) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_view='orders' then return query
    select jsonb_build_object('id',o.id,'label',o.order_number,'status',o.current_stage,'owner',u.full_name,'due_date',o.expected_dispatch_date,
      'summary',concat(initcap(o.priority),' priority; ',case when c.coordinator_id is null then 'coordinator unassigned' when not coalesce(u.is_active,false) then 'coordinator unavailable - transfer required' else 'coordinator assigned' end,case when c.proposed_id is not null then '; transfer awaiting acceptance' else '' end),
      'source_href','/orders/'||o.id,'details',jsonb_build_object('priority',o.priority,'policy','existing-priority-due-v1','coordinator_id',c.coordinator_id,'coordinator_active',u.is_active,
        'proposed_id',c.proposed_id,'proposed_name',pr.full_name,'proposed_active',pr.is_active,'revision',coalesce(c.revision,0),
        'resource_conflicts',(select count(distinct j2.order_id) from public.production_jobs j join public.production_jobs j2 on j2.company_id=j.company_id and j2.machine_id=j.machine_id and j2.planned_date=j.planned_date and j2.order_id<>j.order_id
          where j.company_id=o.company_id and j.order_id=o.id and j.status not in ('completed','cancelled') and j2.status not in ('completed','cancelled')))),
      private.coordination_priority_rank(o.priority),o.expected_dispatch_date,o.created_at
    from public.orders o left join public.order_coordinators c on c.company_id=o.company_id and c.order_id=o.id
      left join public.app_users u on u.company_id=c.company_id and u.id=c.coordinator_id left join public.app_users pr on pr.company_id=c.company_id and pr.id=c.proposed_id
    where o.company_id=p_company and o.deleted_at is null and (p_id is null or o.id=p_id) and (p_state='all' or o.current_stage not in ('closed','cancelled'));
  elsif p_view='collections' then return query
    select jsonb_build_object('id',p.id,'label',i.invoice_number,'status',case when p.withdrawn_at is not null then 'withdrawn' when i.deleted_at is not null or i.status='cancelled' then 'source_unavailable'
      when i.balance_due<=0 then 'settled' when not coalesce(u.is_active,false) then 'owner_unavailable' when p.disputed_amount>0 then 'disputed'
      when greatest(cash.received-p.baseline_cash,0)>=p.amount then 'promise_met' when p.due_date<v_today then 'missed_promise'
      when greatest(cash.received-p.baseline_cash,0)>0 then 'partially_fulfilled' when p.due_date=v_today then 'follow_up_due' else 'promised' end,
      'owner',u.full_name,'due_date',p.due_date,'summary',concat(c.customer_name,'; promise INR ',p.amount,'; invoice balance INR ',i.balance_due),
      'source_href','/invoices/'||i.id,'details',jsonb_build_object('invoice_id',i.id,'employee_id',p.employee_id,'amount',p.amount,'balance_due',i.balance_due,'original_due_date',p.original_due_date,
        'net_receipts_since_promise',cash.received-p.baseline_cash,'non_cash_adjustment_change',i.amount_paid-p.baseline_paid-(cash.received-p.baseline_cash),'credit_change_since_promise',i.credited_amount-p.baseline_credited,
        'remaining_promise',greatest(p.amount-greatest(cash.received-p.baseline_cash,0),0),'disputed_amount',p.disputed_amount,'revision',p.revision)),
      case when p.due_date<v_today then 0 else 2 end,p.due_date,p.created_at
    from public.collection_promises p join public.invoices i on i.company_id=p.company_id and i.id=p.invoice_id
      join public.customers c on c.company_id=i.company_id and c.id=i.customer_id left join public.app_users u on u.company_id=p.company_id and u.id=p.employee_id
      cross join lateral(select private.coordination_invoice_cash(p.company_id,p.invoice_id) as received) cash
    where p.company_id=p_company and (p_id is null or p.id=p_id) and (p_state='all' or (p.withdrawn_at is null and i.balance_due>0));
  elsif p_view='handoffs' then return query
    select jsonb_build_object('id',c.id,'label',initcap(c.team)||' contract revision '||c.revision,'status',case when exists(select 1 from public.handoff_service_contracts c2 where c2.company_id=c.company_id and c2.team=c.team and c2.revision>c.revision) then 'superseded' else 'published' end,
      'owner',u.full_name,'due_date',null,'summary',concat(c.response_hours,' elapsed hours; ',c.requirements),'source_href','/tasks/handoffs',
      'details',jsonb_build_object('team',c.team,'revision',c.revision,'response_hours',c.response_hours,'requirements',c.requirements,'evidence',c.evidence,'clock_basis','Elapsed hours, including nights and holidays',
        'handoffs',coalesce((select jsonb_agg(to_jsonb(x)) from (select t.id,t.title,t.status,a.state as acceptance_state,t.handoff_quantity_kg as expected_kg,a.received_quantity_kg as accepted_kg,
          s.response_due_at,s.auto_accept,s.quantity_tolerance_percent,(select count(*) from public.handoff_returns r where r.company_id=s.company_id and r.handoff_task_id=s.task_id and r.resolved_at is null) as open_returns
          from public.handoff_service_snapshots s join public.tasks t on t.company_id=s.company_id and t.id=s.task_id left join public.handoff_acceptances a on a.company_id=s.company_id and a.task_id=s.task_id
          where s.company_id=c.company_id and s.contract_id=c.id order by s.response_due_at,t.id limit 10) x),'[]'::jsonb))),
      2,null::date,c.published_at
    from public.handoff_service_contracts c left join public.app_users u on u.company_id=c.company_id and u.id=c.published_by
    where c.company_id=p_company and (p_id is null or c.id=p_id) and (p_state='all' or not exists(select 1 from public.handoff_service_contracts c2 where c2.company_id=c.company_id and c2.team=c.team and c2.revision>c.revision));
  elsif p_view='coverage' then return query
    select jsonb_build_object('id',c.id,'label',c.responsibility,'status',case when c.cancelled_at is not null then 'cancelled' when d.closed_at is not null then 'ended'
      when c.ends_at<=now() then case when d.closed_at is null and c.delegation_id is not null then 'expiry_needs_reconciliation' else 'expired' end
      when not coalesce(a.is_active,false) or not coalesce(b.is_active,false) then 'employee_unavailable' when c.acknowledged_at is null then 'awaiting_acknowledgement'
      when d.activated_at is null then 'scheduled' else 'active' end,'owner',b.full_name,'due_date',(c.ends_at at time zone 'Asia/Kolkata')::date,
      'summary',concat(a.full_name,' covered by ',b.full_name,'; ',to_char(c.starts_at at time zone 'Asia/Kolkata','DD Mon HH24:MI'),' to ',to_char(c.ends_at at time zone 'Asia/Kolkata','DD Mon HH24:MI'),' IST'),
      'source_href',case when c.delegation_id is not null then '/tasks/delegations/'||c.delegation_id else null end,
      'details',jsonb_build_object('primary_id',c.primary_id,'backup_id',c.backup_id,'created_by',c.created_by,'starts_at',c.starts_at,'ends_at',c.ends_at,'revision',c.revision,
        'acknowledged_at',c.acknowledged_at,'cancelled_at',c.cancelled_at,'delegation_id',c.delegation_id,
        'open_primary_tasks',(select count(*) from public.tasks t where t.company_id=c.company_id and t.assigned_to=c.primary_id and t.status in ('open','in_progress') and t.dealership_id is null),
        'moved_tasks',(select count(*) from public.task_delegation_items i where i.company_id=c.company_id and i.delegation_id=c.delegation_id),
        'excluded_primary_tasks',(select count(*) from public.tasks t where t.company_id=c.company_id and t.assigned_to=c.primary_id and t.status in ('open','in_progress') and t.dealership_id is null and not private.delegate_eligible(t,b.role,a.role)))),
      2,(c.ends_at at time zone 'Asia/Kolkata')::date,c.created_at
    from public.backup_coverages c left join public.app_users a on a.company_id=c.company_id and a.id=c.primary_id
      left join public.app_users b on b.company_id=c.company_id and b.id=c.backup_id left join public.task_delegations d on d.company_id=c.company_id and d.id=c.delegation_id
    where c.company_id=p_company and (p_id is null or c.id=p_id) and (p_actor in (c.primary_id,c.backup_id,c.created_by) or v_role in ('owner','admin','factory_manager','production_manager','dispatch_manager','sales_manager'))
      and (p_state='all' or (c.cancelled_at is null and (c.ends_at>now() or (c.delegation_id is not null and d.closed_at is null))));
  elsif p_view='sessions' then return query
    select jsonb_build_object('id',s.id,'label','Daily coordination '||to_char(s.started_at at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI')||' IST','status','recorded',
      'owner',u.full_name,'due_date',(s.started_at at time zone 'Asia/Kolkata')::date,'summary',s.note,'source_href',null,'details',jsonb_build_object('snapshot',s.snapshot,'started_at',s.started_at)),
      2,(s.started_at at time zone 'Asia/Kolkata')::date,s.started_at
    from public.coordination_sessions s left join public.app_users u on u.company_id=s.company_id and u.id=s.started_by where s.company_id=p_company and (p_id is null or s.id=p_id);
  elsif p_view='decisions' then return query
    select jsonb_build_object('id',d.id,'label',t.title,'status',t.status,'owner',u.full_name,'due_date',t.due_date,'summary',concat(o.order_number,'; ',t.description),
      'source_href','/tasks/'||t.id,'details',jsonb_build_object('order_id',d.order_id,'order_number',o.order_number,'task_id',t.id,'session_id',d.session_id,'employee_id',t.assigned_to,'owner_active',u.is_active)),
      private.coordination_priority_rank(t.priority),t.due_date,d.created_at
    from public.coordination_decisions d join public.tasks t on t.company_id=d.company_id and t.id=d.task_id
      join public.orders o on o.company_id=d.company_id and o.id=d.order_id left join public.app_users u on u.company_id=t.company_id and u.id=t.assigned_to
    where d.company_id=p_company and (p_id is null or d.id=p_id) and (p_state='all' or t.status in ('open','in_progress'));
  elsif p_view='requests' then return query
    select jsonb_build_object('id',r.id,'label',r.label,'status',coalesce(private.coordination_request_resolution(r),d.stage),'owner',u.full_name,'due_date',d.due_date,'summary',r.message,
      'source_href','/orders/'||r.entity_id,'details',jsonb_build_object('requester_id',r.requester_id,'recipient_id',r.recipient_id,'criteria',d.criteria,'last_note',d.last_note,'resolved_at',r.resolved_at,
        'resolution',private.coordination_request_resolution(r),'resolution_note',r.resolution_note,'revision',d.revision,'reminder_count',r.reminder_count,'reminder_hours',r.reminder_hours)),
      case when d.due_date<v_today then 0 else 2 end,d.due_date,r.created_at
    from public.action_requests r join public.action_request_details d on d.company_id=r.company_id and d.id=r.id left join public.app_users u on u.company_id=r.company_id and u.id=r.recipient_id
    where r.company_id=p_company and p_actor in (r.requester_id,r.recipient_id) and (p_id is null or r.id=p_id)
      and (p_state='all' or (r.resolved_at is null and private.coordination_request_resolution(r) is null));
  elsif p_view='stewards' then return query
    select jsonb_build_object('id',s.id,'label','Profile section weight (kg/m)','status',case when coalesce(u.is_active,false) and coalesce(b.is_active,false) then 'assigned' else 'steward_unavailable' end,
      'owner',u.full_name,'due_date',null,'summary',concat('Primary: ',u.full_name,'; backup: ',b.full_name,'; revision ',s.revision),
      'source_href','/profiles/database','details',jsonb_build_object('employee_id',s.employee_id,'backup_id',s.backup_id,'backup_name',b.full_name,'revision',s.revision)),2,null::date,s.assigned_at
    from public.master_stewardships s left join public.app_users u on u.company_id=s.company_id and u.id=s.employee_id left join public.app_users b on b.company_id=s.company_id and b.id=s.backup_id
    where s.company_id=p_company and (p_id is null or s.id=p_id);
  elsif p_view='corrections' then return query
    select jsonb_build_object('id',c.id,'label',p.profile_code,'status',case when c.state='open' and c.source_fingerprint<>md5(jsonb_build_object('id',p.id,'label',p.profile_code,'weight',p.section_weight_kg_per_m,'updated_at',p.updated_at,'is_active',p.is_active,'drawing_revision',p.drawing_revision,'drawing_approval_status',p.drawing_approval_status)::text) then 'stale_proposal' else c.state end,
      'owner',u.full_name,'due_date',null,'summary',concat('Section weight ',c.previous_weight,' -> ',c.proposed_weight,' kg/m; ',c.evidence),
      'source_href','/profiles/'||p.id,'details',jsonb_build_object('profile_id',p.id,'previous_weight',c.previous_weight,'proposed_weight',c.proposed_weight,'current_weight',p.section_weight_kg_per_m,
        'evidence',c.evidence,'reported_by',c.reported_by,'reviewed_by',c.reviewed_by,'reviewed_at',c.reviewed_at,'state',c.state,'steward_id',s.employee_id,'backup_id',s.backup_id)),2,null::date,c.reported_at
    from public.profile_corrections c join public.aluminium_profiles p on p.company_id=c.company_id and p.id=c.profile_id
      left join public.master_stewardships s on s.company_id=c.company_id and s.field_group='profile_section_weight' left join public.app_users u on u.company_id=s.company_id and u.id=s.employee_id
    where c.company_id=p_company and (p_id is null or c.id=p_id) and (p_state='all' or c.state='open');
  end if;
end $$;
revoke all on function private.coordination_rows(uuid,uuid,text,text,uuid) from public,anon,authenticated;

create function private.coordination_outcome(r public.coordination_requests) returns jsonb language sql immutable set search_path=public,private as $$
  select jsonb_build_object('request_id',r.request_id,'state',r.state,'fingerprint',r.fingerprint,'expires_at',r.expires_at,'action',r.mutation->>'action','review',r.review,'result',r.result)
$$;
revoke all on function private.coordination_outcome(public.coordination_requests) from public,anon,authenticated;

create function public.coordination_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid();v_company uuid:=private.get_current_user_company_id();v_role text:=private.get_current_user_role();
  v_view text;v_page integer;v_search text;v_state text;v_sort text;v_bucket text;v_id uuid;v_total bigint;v_rows jsonb;v_row jsonb;v_events jsonb;
  r public.coordination_requests%rowtype;v_context jsonb;v_fingerprint text;v_result jsonb;v_message text;v_keys text[];
begin
  if v_actor is null or v_company is null or not exists(select 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null)
    or not private.coordination_read_allowed(v_role,'orders') then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.app_users where id=v_actor and company_id=v_company for share;
  v_keys:=case p_command when 'list' then array['view','page','search','state','sort','bucket'] when 'detail' then array['view','id','page']
    when 'lookup' then array['kind','search','selected_id'] when 'preview' then array['request_id','mutation'] when 'commit' then array['request_id','fingerprint']
    when 'outcome' then array['request_id'] when 'abandon' then array['request_id'] end;
  if jsonb_typeof(p_payload) is distinct from 'object' or v_keys is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(v_keys))) then raise exception 'NOV: Invalid coordination request.'; end if;
  if p_command in ('list','detail') then
    v_view:=p_payload->>'view';v_page:=coalesce((p_payload->>'page')::integer,1);v_search:=btrim(coalesce(p_payload->>'search',''));
    v_state:=coalesce(p_payload->>'state','active');v_sort:=coalesce(p_payload->>'sort','priority');
    v_bucket:=coalesce(p_payload->>'bucket','all');
    if not private.coordination_read_allowed(v_role,v_view) then raise exception 'Not permitted' using errcode='42501'; end if;
    if v_page not between 1 and 100000 or length(v_search)>80 or v_state not in ('active','all') or v_sort not in ('priority','newest','due') then raise exception 'NOV: Invalid coordination filters.'; end if;
    if v_bucket not in ('all','follow_up_due','missed_promise','disputed','owner_unavailable','partially_fulfilled','promise_met') or (v_view<>'collections' and v_bucket<>'all') then raise exception 'NOV: Invalid collection queue filter.'; end if;
    if p_command='detail' then
      v_id:=(p_payload->>'id')::uuid;
      if v_id is null then raise exception 'NOV: Choose a record.'; end if;
      select row_data into v_row from private.coordination_rows(v_company,v_actor,v_view,'all',v_id);
      if v_row is null then raise exception 'NOV: This coordination record is unavailable.'; end if;
      select count(*) into v_total from public.coordination_events where company_id=v_company and view_name=v_view and entity_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(x) order by recorded_at desc,id),'[]'::jsonb) into v_events from (
        select id,action,actor_name as actor,note,recorded_at from public.coordination_events where company_id=v_company and view_name=v_view and entity_id=v_id order by recorded_at desc,id limit 10 offset (v_page-1)*10
      ) x;
      return jsonb_build_object('row',v_row,'events',v_events,'event_count',v_total,'as_of',now());
    end if;
    with visible as (select * from private.coordination_rows(v_company,v_actor,v_view,v_state,null) where (v_bucket='all' or row_data->>'status'=v_bucket)
      and (v_search='' or position(lower(v_search) in lower(coalesce(row_data->>'label','')||' '||coalesce(row_data->>'status','')||' '||coalesce(row_data->>'owner','')||' '||coalesce(row_data->>'summary','')))>0))
    select (select count(*) from visible),coalesce((select jsonb_agg(x.row_data order by x.position) from (
      select row_data,row_number() over(order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc,(row_data->>'id')) as position
      from visible order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc,(row_data->>'id') limit 10 offset (v_page-1)*10
    ) x),'[]'::jsonb) into v_total,v_rows;
    return jsonb_build_object('rows',v_rows,'total_count',v_total,'as_of',now());
  elsif p_command='lookup' then
    v_search:=btrim(coalesce(p_payload->>'search',''));v_id:=nullif(p_payload->>'selected_id','')::uuid;
    if length(v_search)>80 then raise exception 'NOV: Keep search within 80 characters.'; end if;
    if p_payload->>'kind'='employees' then
      select coalesce(jsonb_agg(to_jsonb(x) order by label,value),'[]'::jsonb) into v_rows from (
        select id as value,coalesce(nullif(full_name,''),'Employee') as label,replace(role,'_',' ') as context from public.app_users where company_id=v_company and is_active and dealer_id is null and role<>'viewer'
        and ((v_id is not null and id=v_id) or (v_id is null and position(lower(v_search) in lower(coalesce(full_name,'')||' '||role))>0)) order by full_name nulls last,id limit 20
      ) x;
    elsif p_payload->>'kind'='orders' then
      select coalesce(jsonb_agg(to_jsonb(x) order by label,value),'[]'::jsonb) into v_rows from (
        select id as value,order_number as label,replace(current_stage,'_',' ') as context from public.orders where company_id=v_company and deleted_at is null and current_stage not in ('closed','cancelled')
        and ((v_id is not null and id=v_id) or (v_id is null and position(lower(v_search) in lower(order_number))>0)) order by order_number,id limit 20
      ) x;
    elsif p_payload->>'kind'='invoices' then
      if not private.coordination_read_allowed(v_role,'collections') then raise exception 'Not permitted' using errcode='42501'; end if;
      select coalesce(jsonb_agg(to_jsonb(x) order by label,value),'[]'::jsonb) into v_rows from (
        select id as value,invoice_number as label,concat('Balance INR ',balance_due) as context from public.invoices where company_id=v_company and deleted_at is null and status not in ('draft','cancelled') and balance_due>0
        and ((v_id is not null and id=v_id) or (v_id is null and position(lower(v_search) in lower(invoice_number))>0)) order by invoice_number,id limit 20
      ) x;
    elsif p_payload->>'kind'='profiles' then
      if not private.coordination_read_allowed(v_role,'corrections') then raise exception 'Not permitted' using errcode='42501'; end if;
      select coalesce(jsonb_agg(to_jsonb(x) order by label,value),'[]'::jsonb) into v_rows from (
        select id as value,profile_code||' - '||profile_name as label,concat(section_weight_kg_per_m,' kg/m; ',coalesce(alloy,'alloy unknown')) as context from public.aluminium_profiles where company_id=v_company and is_active
        and ((v_id is not null and id=v_id) or (v_id is null and position(lower(v_search) in lower(profile_code||' '||profile_name))>0)) order by profile_code,id limit 20
      ) x;
    else raise exception 'NOV: Choose a supported lookup.'; end if;
    return v_rows;
  end if;

  -- Outcome reads wait for the same lock as commitment: prepared means no confirmed write
  -- exists for this request, rather than a competing commit still being invisible.
  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':coordination',0));
  v_id:=(p_payload->>'request_id')::uuid;
  if v_id is null then raise exception 'NOV: An original request identity is required.'; end if;
  select * into r from public.coordination_requests where request_id=v_id for update;
  if found and (r.company_id<>v_company or r.actor_id<>v_actor) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_command='preview' then
    if r.request_id is not null then
      if r.mutation is distinct from p_payload->'mutation' then raise exception 'NOV: This request identity belongs to different details.'; end if;
      if not private.coordination_action_allowed(v_role,r.mutation->>'action') then raise exception 'Not permitted' using errcode='42501'; end if;
      return private.coordination_outcome(r);
    end if;
    v_context:=private.coordination_context(v_company,v_actor,p_payload->'mutation',false);
    v_fingerprint:=md5(v_context::text||(p_payload->'mutation')::text);
    insert into public.coordination_requests(request_id,company_id,actor_id,mutation,fingerprint,review)
      values(v_id,v_company,v_actor,p_payload->'mutation',v_fingerprint,private.coordination_review(p_payload->'mutation',v_context)) returning * into r;
  else
    if r.request_id is null then
      if p_command in ('outcome','abandon') then return jsonb_build_object('request_id',v_id,'state','not_recorded','fingerprint',repeat('0',32),'expires_at',now(),'action','',
        'review',jsonb_build_object('title','Original request check','effect','No prepared or committed action exists for this original request.','warnings','[]'::jsonb,'facts','{}'::jsonb),
        'result',jsonb_build_object('label','Not recorded','href',null,'message','No operational change was committed with this original request identity. It is safe to start a reviewed action.')); end if;
      raise exception 'NOV: The original request was not found. No action was committed with that request identity.';
    end if;
    if (p_command='commit' and not private.coordination_action_allowed(v_role,r.mutation->>'action'))
      or (p_command in ('outcome','abandon') and not private.coordination_read_allowed(v_role,private.coordination_view(r.mutation->>'action'))) then raise exception 'Not permitted' using errcode='42501'; end if;
    if p_command='commit' and r.state='prepared' then
      if r.fingerprint is distinct from p_payload->>'fingerprint' then raise exception 'NOV: Confirmation does not match the reviewed request.'; end if;
      begin
        if r.expires_at<=now() then raise exception 'NOV: This review expired. Review the current source again.'; end if;
        v_context:=private.coordination_context(v_company,v_actor,r.mutation,true);
        if r.fingerprint<>md5(v_context::text||r.mutation::text) then raise exception 'NOV: A relevant source or employee changed. Review the current details again.'; end if;
        v_result:=private.coordination_apply(v_company,v_actor,v_id,r.mutation,v_context);
        update public.coordination_requests set state='confirmed',result=v_result where request_id=v_id returning * into r;
      exception when others then
        v_message:=case when sqlstate='P0001' and sqlerrm like 'NOV: %' then substring(sqlerrm from 6) else 'The existing workflow rejected this action. No change from this request was committed. Refresh the source and review its current requirements.' end;
        update public.coordination_requests set state='rejected',result=jsonb_build_object('label',r.review->>'title','href',null,'message',v_message) where request_id=v_id returning * into r;
      end;
    elsif p_command='abandon' and r.state='prepared' then
      update public.coordination_requests set state='abandoned',result=jsonb_build_object('label',r.review->>'title','href',null,'message','Review cancelled. This request made no operational change.') where request_id=v_id returning * into r;
    elsif p_command not in ('commit','outcome','abandon') then raise exception 'NOV: Invalid coordination request.';
    end if;
  end if;
  return private.coordination_outcome(r);
end $$;
revoke all on function public.coordination_command(text,jsonb) from public,anon;
grant execute on function public.coordination_command(text,jsonb) to authenticated;

commit;
