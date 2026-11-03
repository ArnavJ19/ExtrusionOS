-- November batch 4: cross-module operational controls over existing source ledgers.
-- Read models aggregate each source independently. No action here posts stock, money or a purchase order.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

create unique index if not exists control_job_tenant_key on public.production_jobs(company_id,id);
create unique index if not exists control_finishing_tenant_key on public.finishing_jobs(company_id,id);
create unique index if not exists control_po_line_tenant_key on public.purchase_order_lines(company_id,id);
create unique index if not exists control_location_tenant_key on public.inventory_locations(company_id,id);
create unique index if not exists control_version_tenant_key on public.procedure_versions(company_id,id);
create unique index if not exists control_exception_tenant_key on public.exception_requests(company_id,id);
create unique index if not exists coordination_user_tenant_key on public.app_users(company_id,id);
create unique index if not exists coordination_task_tenant_key on public.tasks(company_id,id);
create index if not exists control_job_line_idx on public.production_jobs(company_id,source_line_id) where status<>'cancelled';
create index if not exists control_return_line_idx on public.connected_return_receipts(company_id,order_id,order_item_id);
create index if not exists control_hold_job_idx on public.production_job_holds(company_id,production_job_id) where status='active';
create index if not exists control_task_source_idx on public.tasks(company_id,handoff_source_type,handoff_source_id) where handoff_key is not null;

-- NOV-007: a deliberate, reviewed difference from the order line. It applies only while the line
-- still holds the value that was reviewed; a later line change surfaces again.
create table public.inherited_fact_overrides (
  company_id uuid not null references public.companies(id), production_job_id uuid not null, field text not null,
  line_value jsonb not null, reason text not null check(length(btrim(reason)) between 5 and 500),
  recorded_by uuid not null, recorded_at timestamptz not null default now(),
  primary key(company_id,production_job_id,field),
  foreign key(company_id,production_job_id) references public.production_jobs(company_id,id),
  foreign key(company_id,recorded_by) references public.app_users(company_id,id)
);

-- NOV-015: source changes behind a department handoff after it was raised.
create table public.handoff_source_reconciliations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), task_id uuid not null,
  kind text not null check(kind in ('withdrawn','quantity_changed','reinstated')),
  outcome text not null check(outcome in ('cancelled_unaccepted','quantity_updated','review_required','reopened')),
  previous_quantity_kg numeric(14,3), current_quantity_kg numeric(14,3), task_status text not null, acceptance_state text,
  issues jsonb not null default '[]'::jsonb, status text not null check(status in ('open','resolved')),
  resolved_by uuid, resolved_at timestamptz, resolution_note text, created_at timestamptz not null default clock_timestamp(),
  unique(company_id,id), check((status='open')=(resolved_at is null)),
  foreign key(company_id,task_id) references public.tasks(company_id,id),
  foreign key(company_id,resolved_by) references public.app_users(company_id,id)
);
create unique index handoff_reconciliation_one_open on public.handoff_source_reconciliations(company_id,task_id) where status='open';
create index handoff_reconciliation_task_idx on public.handoff_source_reconciliations(company_id,task_id,created_at desc);

-- NOV-022: billet purchasing policy, confirmed supply links and reviewable plan snapshots.
create table public.procurement_policies (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  alloy text not null check(length(btrim(alloy)) between 2 and 20), diameter_inch numeric(6,3) not null check(diameter_inch>0 and diameter_inch<=30),
  lead_days integer not null check(lead_days between 0 and 365), min_order_kg numeric(14,3) not null check(min_order_kg>=0),
  pack_kg numeric(14,3) check(pack_kg is null or pack_kg>0), safety_stock_kg numeric(14,3) not null check(safety_stock_kg>=0),
  revision integer not null default 1 check(revision>0), updated_by uuid not null, updated_at timestamptz not null default now(),
  unique(company_id,alloy,diameter_inch),
  foreign key(company_id,updated_by) references public.app_users(company_id,id)
);
create table public.procurement_supply_links (
  purchase_order_line_id uuid primary key, company_id uuid not null references public.companies(id),
  alloy text not null check(length(btrim(alloy)) between 2 and 20), diameter_inch numeric(6,3) not null check(diameter_inch>0 and diameter_inch<=30),
  linked_by uuid not null, linked_at timestamptz not null default now(),
  foreign key(company_id,purchase_order_line_id) references public.purchase_order_lines(company_id,id),
  foreign key(company_id,linked_by) references public.app_users(company_id,id)
);
create index procurement_supply_group_idx on public.procurement_supply_links(company_id,alloy,diameter_inch);
create table public.procurement_plan_runs (
  id uuid primary key, company_id uuid not null references public.companies(id), generated_by uuid not null,
  generated_at timestamptz not null default now(), basis jsonb not null, unique(company_id,id),
  foreign key(company_id,generated_by) references public.app_users(company_id,id)
);
create index procurement_runs_time_idx on public.procurement_plan_runs(company_id,generated_at desc,id);
create table public.procurement_plan_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), run_id uuid not null,
  alloy text not null, diameter_inch numeric(6,3) not null, demand_kg numeric(14,3) not null, free_stock_kg numeric(14,3) not null,
  open_supply_kg numeric(14,3) not null, tentative_supply_kg numeric(14,3) not null, safety_stock_kg numeric(14,3) not null,
  net_shortage_kg numeric(14,3) not null check(net_shortage_kg>0), proposed_kg numeric(14,3) not null check(proposed_kg>=net_shortage_kg),
  need_by date, order_by date, demand jsonb not null, supply jsonb not null, warnings jsonb not null, policy jsonb,
  state text not null default 'proposed' check(state in ('proposed','accepted','dismissed','obsolete')),
  reviewed_by uuid, reviewed_at timestamptz, review_note text, superseded_by_run uuid,
  unique(company_id,id), check((state in ('accepted','dismissed'))=(reviewed_at is not null)),
  foreign key(company_id,run_id) references public.procurement_plan_runs(company_id,id),
  foreign key(company_id,reviewed_by) references public.app_users(company_id,id)
);
create index procurement_lines_state_idx on public.procurement_plan_lines(company_id,state,order_by,id);

-- NOV-028: observed physical position of unfinished material. Observation never changes the
-- processing state; it records where material was seen.
create table public.wip_location_observations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), production_job_id uuid not null,
  location_id uuid not null, quantity_kg numeric(14,3) check(quantity_kg is null or quantity_kg>0), note text not null,
  observed_by uuid not null, observed_at timestamptz not null default now(),
  foreign key(company_id,production_job_id) references public.production_jobs(company_id,id),
  foreign key(company_id,location_id) references public.inventory_locations(company_id,id),
  foreign key(company_id,observed_by) references public.app_users(company_id,id)
);
create index wip_observations_job_idx on public.wip_location_observations(company_id,production_job_id,observed_at desc);

-- NOV-031: explained differences between material issued to a finishing vendor and material
-- received back. Entries are never edited; a mistaken entry is reversed with a reason.
create table public.finishing_custody_adjustments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), finishing_job_id uuid not null,
  category text not null check(category in ('returned_unprocessed','process_loss','lost_claimed')),
  quantity_kg numeric(14,3) not null check(quantity_kg>0), evidence text not null check(length(btrim(evidence)) between 5 and 500),
  recorded_by uuid not null, recorded_at timestamptz not null default now(),
  reversed_by uuid, reversed_at timestamptz, reverse_note text, unique(company_id,id),
  check((reversed_at is null)=(reversed_by is null)),
  foreign key(company_id,finishing_job_id) references public.finishing_jobs(company_id,id),
  foreign key(company_id,recorded_by) references public.app_users(company_id,id),
  foreign key(company_id,reversed_by) references public.app_users(company_id,id)
);
create index finishing_custody_job_idx on public.finishing_custody_adjustments(company_id,finishing_job_id) where reversed_at is null;

-- NOV-042: versioned approval ceilings by role, bound to each approved exception.
create table public.decision_authority_revisions (
  id uuid primary key, company_id uuid not null references public.companies(id),
  decision_type text not null check(decision_type in ('overdue_dispatch','low_margin_quote')),
  revision integer not null check(revision>0), limits jsonb not null check(jsonb_typeof(limits)='object' and not limits ? 'owner'),
  effective_from timestamptz not null, published_by uuid not null, published_at timestamptz not null default now(), note text not null,
  unique(company_id,decision_type,revision), unique(company_id,id),
  foreign key(company_id,published_by) references public.app_users(company_id,id)
);
create table public.decision_authority_bindings (
  request_id uuid primary key, company_id uuid not null references public.companies(id), revision_id uuid,
  decided_role text not null, exposure numeric(16,3), ceiling numeric(16,3), bound_at timestamptz not null default now(),
  foreign key(company_id,request_id) references public.exception_requests(company_id,id),
  foreign key(company_id,revision_id) references public.decision_authority_revisions(company_id,id)
);

-- NOV-051: published definition-of-done revisions and the revision each task was created under.
create table public.completion_contracts (
  id uuid primary key, company_id uuid not null references public.companies(id), task_kind text not null
    check(task_kind ~ '^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$'),
  revision integer not null check(revision>0), criteria jsonb not null check(jsonb_typeof(criteria)='array' and jsonb_array_length(criteria) between 1 and 10),
  exclusive_source boolean not null, published_by uuid not null, published_at timestamptz not null default now(), note text not null,
  unique(company_id,task_kind,revision), unique(company_id,id),
  foreign key(company_id,published_by) references public.app_users(company_id,id)
);
create table public.task_contract_bindings (
  task_id uuid primary key, company_id uuid not null references public.companies(id), contract_id uuid not null,
  task_kind text not null, bound_at timestamptz not null default now(),
  foreign key(company_id,task_id) references public.tasks(company_id,id),
  foreign key(company_id,contract_id) references public.completion_contracts(company_id,id)
);
create index task_contract_bindings_contract_idx on public.task_contract_bindings(company_id,contract_id);

-- NOV-057: how a released instruction change reaches the people doing bound work.
create table public.procedure_rollouts (
  version_id uuid primary key, company_id uuid not null references public.companies(id), procedure_id uuid not null,
  change_class text not null default 'informational' check(change_class in ('informational','acknowledgement_required')),
  classified_by uuid, classified_at timestamptz, created_at timestamptz not null default now(),
  check((change_class='informational') or (classified_by is not null and classified_at is not null)),
  foreign key(company_id,version_id) references public.procedure_versions(company_id,id),
  foreign key(company_id,classified_by) references public.app_users(company_id,id)
);
create table public.procedure_acknowledgements (
  company_id uuid not null references public.companies(id), version_id uuid not null, employee_id uuid not null,
  note text not null, acknowledged_at timestamptz not null default now(), primary key(company_id,version_id,employee_id),
  foreign key(company_id,version_id) references public.procedure_versions(company_id,id),
  foreign key(company_id,employee_id) references public.app_users(company_id,id)
);

-- Shared request identity and history for the actions in this batch.
create table public.control_requests (
  request_id uuid primary key, company_id uuid not null references public.companies(id), actor_id uuid not null,
  mutation jsonb not null, fingerprint text not null, review jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','confirmed','rejected','abandoned')),
  result jsonb, expires_at timestamptz not null default now()+interval '15 minutes', created_at timestamptz not null default now(),
  foreign key(company_id,actor_id) references public.app_users(company_id,id), check((state='prepared')=(result is null))
);
create index control_requests_actor_idx on public.control_requests(company_id,actor_id,created_at desc);
create table public.control_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  view_name text not null, entity_id uuid not null, action text not null, actor_id uuid, actor_name text not null,
  note text not null, facts jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create index control_events_entity_idx on public.control_events(company_id,view_name,entity_id,recorded_at desc,id);

create function private.control_view(p_action text) returns text language sql immutable set search_path=public,private as $$
  select case split_part(p_action,'.',1) when 'facts' then 'inheritance' when 'handoff' then 'handoffs' when 'policy' then 'procurement'
    when 'supply' then 'procurement' when 'plan' then 'procurement' when 'wip' then 'wip' when 'custody' then 'custody'
    when 'authority' then 'authority' when 'contract' then 'contracts' when 'rollout' then 'rollouts' end
$$;
create function private.control_read_allowed(p_role text,p_view text) returns boolean language sql immutable set search_path=public,private as $$
  select coalesce(case
    when p_role not in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer') then false
    when p_view='inheritance' then p_role in ('owner','admin','factory_manager','production_manager','production','sales_manager','quality','viewer')
    when p_view='handoffs' then p_role in ('owner','admin','factory_manager','production_manager','production','dispatch_manager','dispatch','quality','viewer')
    when p_view='procurement' then p_role in ('owner','admin','factory_manager','production_manager','inventory_manager','accounts','viewer')
    when p_view='custody' then p_role in ('owner','admin','factory_manager','production_manager','production','inventory_manager','accounts','quality','viewer')
    else p_view in ('ledger','wip','authority','contracts','rollouts') end,false)
$$;
create function private.control_action_allowed(p_role text,p_action text) returns boolean language sql immutable set search_path=public,private as $$
  select private.control_read_allowed(p_role,private.control_view(p_action)) and p_role<>'viewer' and coalesce(case
    when p_action in ('facts.refresh','facts.keep') then p_role in ('owner','admin','factory_manager','production_manager')
    when p_action='handoff.resolve' then p_role in ('owner','admin','factory_manager','production_manager','production','dispatch_manager','dispatch','quality')
    when p_action in ('policy.set','plan.review') then p_role in ('owner','admin','inventory_manager')
    when p_action in ('supply.link','plan.generate') then p_role in ('owner','admin','inventory_manager','factory_manager')
    when p_action='wip.observe' then p_role in ('owner','admin','factory_manager','production_manager','production','inventory_manager','dispatch_manager','dispatch','quality')
    when p_action in ('custody.explain','custody.reverse') then p_role in ('owner','admin','factory_manager','production_manager','inventory_manager')
    when p_action='authority.publish' then p_role in ('owner','admin')
    when p_action in ('contract.publish','rollout.classify') then p_role in ('owner','admin','factory_manager')
    else p_action='rollout.acknowledge' end,false)
$$;
revoke all on function private.control_view(text),private.control_read_allowed(text,text),private.control_action_allowed(text,text) from public,anon;
grant execute on function private.control_view(text),private.control_read_allowed(text,text),private.control_action_allowed(text,text) to authenticated;

do $$ declare t text; v text; begin
  for t,v in select * from (values ('inherited_fact_overrides','inheritance'),('handoff_source_reconciliations','handoffs'),
    ('procurement_policies','procurement'),('procurement_supply_links','procurement'),('procurement_plan_runs','procurement'),('procurement_plan_lines','procurement'),
    ('wip_location_observations','wip'),('finishing_custody_adjustments','custody'),('decision_authority_revisions','authority'),
    ('decision_authority_bindings','authority'),('completion_contracts','contracts'),('task_contract_bindings','contracts'),
    ('procedure_rollouts','rollouts'),('procedure_acknowledgements','rollouts')) x(t,v) loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy control_tenant_read on public.%I for select to authenticated using (company_id=private.get_current_user_company_id() and private.get_current_user_dealer_id() is null and private.control_read_allowed(private.get_current_user_role(),%L))',t,v);
  end loop;
end $$;
alter table public.control_requests enable row level security;
alter table public.control_events enable row level security;
revoke all on public.control_requests,public.control_events from public,anon,authenticated;
grant select on public.control_requests to authenticated;
create policy control_request_owner on public.control_requests for select to authenticated using (
  company_id=private.get_current_user_company_id() and actor_id=auth.uid() and private.get_current_user_dealer_id() is null
  and private.control_read_allowed(private.get_current_user_role(),private.control_view(mutation->>'action'))
);
-- History is projected through the authorized detail RPC; direct event access is denied.
create policy control_events_no_direct_read on public.control_events for select to authenticated using(false);

create function private.control_record(p_company uuid,p_view text,p_entity uuid,p_action text,p_actor uuid,p_note text,p_facts jsonb) returns void
language sql security definer set search_path=public,private as $$
  insert into public.control_events(company_id,view_name,entity_id,action,actor_id,actor_name,note,facts)
  values(p_company,p_view,p_entity,p_action,p_actor,coalesce((select nullif(full_name,'') from public.app_users where id=p_actor and company_id=p_company),'System'),p_note,coalesce(p_facts,'{}'::jsonb))
$$;
revoke all on function private.control_record(uuid,text,uuid,text,uuid,text,jsonb) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-005: connected order fulfilment ledger. Each source is aggregated on its own and reported
-- unavailable rather than as zero; historical rows without line identity stay unlinked.
------------------------------------------------------------------------------------------------
create function private.control_order_ledger(p_company uuid,p_order uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_req jsonb; v_holds jsonb; v_qc jsonb; v_delivered jsonb; v_returns jsonb; v_sources jsonb:='{}'::jsonb;
  v_lines jsonb:='[]'::jsonb; v_line record; v_total integer; v_unlinked jsonb; v_status text; v_line_json jsonb;
  v_ordered numeric:=0; v_departed numeric:=0; v_delivered_sum numeric:=0; v_packed numeric:=0; v_progress numeric:=0;
  v_unknown boolean:=false; v_held boolean:=false; v_unavailable boolean:=false; v_remaining numeric; v_r jsonb; v_x numeric;
begin
  begin
    select coalesce(jsonb_object_agg(order_item_id::text,jsonb_build_object('ordered_kg',ordered_kg,'from_stock_kg',from_stock_kg,'produced_kg',produced_kg,
      'planned_open_kg',planned_open_kg,'packed_kg',packed_kg,'departed_kg',dispatched_kg)),'{}'::jsonb)
    into v_req from private.order_line_requirements(p_company,p_order);
    v_sources:=v_sources||'{"production":"available","packing":"available"}';
  exception when others then v_req:=null; v_sources:=v_sources||'{"production":"unavailable","packing":"unavailable"}'; end;
  begin
    select coalesce(jsonb_object_agg(coalesce(line::text,'unlinked'),x),'{}'::jsonb) into v_holds from (
      select j.source_line_id line,jsonb_build_object('held_jobs',count(*),'held_output_kg',coalesce(sum(h.recorded_output_kg),0)) x
      from public.production_job_holds h join public.production_jobs j on j.id=h.production_job_id and j.company_id=h.company_id
      where h.company_id=p_company and j.order_id=p_order and h.status='active' group by j.source_line_id) s;
    select coalesce(jsonb_object_agg(coalesce(line::text,'unlinked'),kg),'{}'::jsonb) into v_qc from (
      select j.source_line_id line,sum(b.total_weight_kg) kg from public.profile_stock_batches b
      join public.production_jobs j on j.id=b.production_job_id and j.company_id=b.company_id
      where b.company_id=p_company and j.order_id=p_order and b.qc_status='on_hold' and b.status not in ('dispatched','scrap','rejected') group by j.source_line_id) s;
    v_sources:=v_sources||'{"holds":"available"}';
  exception when others then v_holds:=null; v_qc:=null; v_sources:=v_sources||'{"holds":"unavailable"}'; end;
  begin
    select coalesce(jsonb_object_agg(coalesce(line::text,'unlinked'),kg),'{}'::jsonb) into v_delivered from (
      select pl.order_item_id line,sum(pl.net_weight_kg) kg from public.packing_list_items pl join public.dispatches d on d.id=pl.dispatch_id and d.company_id=pl.company_id
      where pl.company_id=p_company and d.order_id=p_order and d.delivery_status='delivered' group by pl.order_item_id) s;
    v_sources:=v_sources||'{"delivery":"available"}';
  exception when others then v_delivered:=null; v_sources:=v_sources||'{"delivery":"unavailable"}'; end;
  begin
    select coalesce(jsonb_object_agg(coalesce(line::text,'unlinked'),jsonb_build_object('kg',kg,'open',open_count)),'{}'::jsonb) into v_returns from (
      select order_item_id line,sum(received_kg) kg,count(*) filter(where status<>'disposed') open_count from public.connected_return_receipts
      where company_id=p_company and order_id=p_order group by order_item_id) s;
    v_sources:=v_sources||'{"returns":"available"}';
  exception when others then v_returns:=null; v_sources:=v_sources||'{"returns":"unavailable"}'; end;
  v_unavailable:=exists(select 1 from jsonb_each_text(v_sources) s where s.value='unavailable');

  select count(*) into v_total from public.order_items where company_id=p_company and order_id=p_order;
  for v_line in select i.id,coalesce(nullif(i.item_description,''),nullif(i.section_name,''),p.profile_code,'Order line') label
    from public.order_items i left join public.aluminium_profiles p on p.id=i.profile_id and p.company_id=i.company_id
    where i.company_id=p_company and i.order_id=p_order order by i.created_at,i.id limit 50 loop
    v_r:=v_req->(v_line.id::text);
    v_remaining:=case when v_r is null or v_r->>'ordered_kg' is null then null else round((v_r->>'ordered_kg')::numeric-coalesce((v_r->>'departed_kg')::numeric,0),3) end;
    v_line_json:=jsonb_build_object('id',v_line.id,'label',v_line.label,
      'ordered_kg',v_r->'ordered_kg','from_stock_kg',v_r->'from_stock_kg','produced_kg',v_r->'produced_kg','planned_open_kg',v_r->'planned_open_kg',
      'packed_kg',v_r->'packed_kg','departed_kg',v_r->'departed_kg',
      'held_jobs',case when v_holds is null then null else coalesce((v_holds->(v_line.id::text)->>'held_jobs')::integer,0) end,
      'held_output_kg',case when v_holds is null then null else coalesce((v_holds->(v_line.id::text)->>'held_output_kg')::numeric,0) end,
      'qc_hold_kg',case when v_qc is null then null else coalesce((v_qc->>(v_line.id::text))::numeric,0) end,
      'delivered_kg',case when v_delivered is null then null else coalesce((v_delivered->>(v_line.id::text))::numeric,0) end,
      'returned_kg',case when v_returns is null then null else coalesce((v_returns->(v_line.id::text)->>'kg')::numeric,0) end,
      'open_returns',case when v_returns is null then null else coalesce((v_returns->(v_line.id::text)->>'open')::integer,0) end,
      'remaining_to_depart_kg',case when v_remaining is null then null else greatest(v_remaining,0) end,
      'over_departed',coalesce(v_remaining< -0.001,false));
    v_lines:=v_lines||jsonb_build_array(v_line_json);
    if v_r is null or v_r->>'ordered_kg' is null then v_unknown:=true; else v_ordered:=v_ordered+(v_r->>'ordered_kg')::numeric; end if;
    v_departed:=v_departed+coalesce((v_r->>'departed_kg')::numeric,0); v_packed:=v_packed+coalesce((v_r->>'packed_kg')::numeric,0);
    v_progress:=v_progress+coalesce((v_r->>'produced_kg')::numeric,0)+coalesce((v_r->>'from_stock_kg')::numeric,0)+coalesce((v_r->>'planned_open_kg')::numeric,0);
    v_delivered_sum:=v_delivered_sum+coalesce((v_line_json->>'delivered_kg')::numeric,0);
    if coalesce((v_line_json->>'held_jobs')::integer,0)>0 or coalesce((v_line_json->>'qc_hold_kg')::numeric,0)>0 then v_held:=true; end if;
  end loop;
  v_unlinked:=jsonb_build_object(
    'packing_rows',(select count(*) from public.packing_list_items pl join public.dispatches d on d.id=pl.dispatch_id and d.company_id=pl.company_id where pl.company_id=p_company and d.order_id=p_order and pl.order_item_id is null),
    'packing_kg',(select coalesce(sum(pl.net_weight_kg),0) from public.packing_list_items pl join public.dispatches d on d.id=pl.dispatch_id and d.company_id=pl.company_id where pl.company_id=p_company and d.order_id=p_order and pl.order_item_id is null),
    'returns',coalesce((v_returns->'unlinked'->>'open')::integer,0)+0,'returned_kg',coalesce((v_returns->'unlinked'->>'kg')::numeric,0),
    'jobs',(select count(*) from public.production_jobs where company_id=p_company and order_id=p_order and status<>'cancelled' and source_line_id is null),
    'held_jobs',coalesce((v_holds->'unlinked'->>'held_jobs')::integer,0));
  if coalesce((v_unlinked->>'held_jobs')::integer,0)>0 then v_held:=true; end if;
  v_status:=case when v_unavailable then 'source_unavailable' when v_total=0 or v_unknown then 'quantity_unknown' when v_held then 'on_hold'
    when v_departed>0 and v_departed>=v_ordered-0.001 then case when v_delivered_sum>=v_departed-0.001 then 'delivered' else 'departed' end
    when v_departed>0 then 'part_departed' when v_packed>0 then 'packed' when v_progress>0 then 'in_production' else 'awaiting_production' end;
  return jsonb_build_object('status',v_status,'line_count',v_total,'lines',v_lines,'sources',v_sources,'unlinked',v_unlinked,
    'ordered_kg',case when v_unknown then null else round(v_ordered,3) end,'departed_kg',round(v_departed,3),'packed_kg',round(v_packed,3),'delivered_kg',round(v_delivered_sum,3),
    'basis','Ordered kg uses the accepted order basis. Production, packing, departure, delivery and returns are aggregated separately from their own records. Returns do not reduce the departed quantity or create new entitlement. Rows without a recorded order line remain unlinked.');
end $$;
revoke all on function private.control_order_ledger(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-007: technical and packing facts a production job inherits from its order line.
------------------------------------------------------------------------------------------------
create function private.control_fact_fields() returns text[] language sql immutable set search_path=public,private as $$
  select array['drawing_revision','drawing_document_id','alloy_id','temper_id','cut_length','standard_length','pieces_per_bundle',
    'packing_instruction','customer_packing_requirement','finishing_type','customer_component_code','section_weight_kg_per_m']
$$;
create function private.control_fact_drift(p_company uuid,p_job uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare j jsonb; l jsonb; f text; v_items jsonb:='[]'::jsonb; v_job public.production_jobs%rowtype; o public.inherited_fact_overrides%rowtype; v_line_exists boolean;
begin
  select * into v_job from public.production_jobs where id=p_job and company_id=p_company;
  if not found then return null; end if;
  if v_job.source_line_id is null then return jsonb_build_object('state','unlinked','fields','[]'::jsonb); end if;
  select to_jsonb(i) into l from public.order_items i where i.id=v_job.source_line_id and i.company_id=p_company and i.order_id=v_job.order_id;
  if l is null then return jsonb_build_object('state','source_unavailable','fields','[]'::jsonb); end if;
  j:=to_jsonb(v_job);
  foreach f in array private.control_fact_fields() loop
    if (j->f) is distinct from (l->f) and not (jsonb_typeof(j->f) is not distinct from 'number' and jsonb_typeof(l->f) is not distinct from 'number' and (j->>f)::numeric=(l->>f)::numeric) then
      select * into o from public.inherited_fact_overrides where company_id=p_company and production_job_id=p_job and field=f;
      v_items:=v_items||jsonb_build_array(jsonb_build_object('field',f,'job_value',j->f,'line_value',l->f,
        'overridden',o.field is not null and o.line_value is not distinct from coalesce(l->f,'null'::jsonb),'override_reason',o.reason));
    end if;
  end loop;
  return jsonb_build_object('state',case
      when exists(select 1 from jsonb_array_elements(v_items) x where not (x->>'overridden')::boolean) then
        case when v_job.status in ('planned','ready') then 'drifted' else 'drift_locked' end
      when jsonb_array_length(v_items)>0 then 'overridden' else 'matches' end,
    'fields',v_items,'job_updated_at',v_job.updated_at,'line_updated_at',l->'updated_at','job_status',v_job.status);
end $$;
revoke all on function private.control_fact_fields(),private.control_fact_drift(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-015: source changes behind an open handoff. An unaccepted handoff whose source no longer
-- stands is cancelled with its reason retained; accepted work keeps its owner and needs review.
------------------------------------------------------------------------------------------------
create function private.handoff_source_quantity(t public.tasks) returns numeric language sql stable security definer set search_path=public,private as $$
  select case t.handoff_source_type
    when 'finishing_job' then (select output_weight_kg from public.finishing_jobs where id=t.handoff_source_id and company_id=t.company_id)
    when 'quality_inspection' then (select quantity_checked_kg from public.quality_inspections where id=t.handoff_source_id and company_id=t.company_id)
    when 'packaging_job' then (select profile_weight_kg from public.packaging_jobs where id=t.handoff_source_id and company_id=t.company_id) end
$$;
create function private.reconcile_handoff_task(p_task uuid) returns text
language plpgsql security definer set search_path=public,private as $$
declare t public.tasks%rowtype; v_issues jsonb; v_blocking jsonb; v_state text; v_qty numeric; v_last public.handoff_source_reconciliations%rowtype; v_open boolean;
begin
  select * into t from public.tasks where id=p_task and handoff_key is not null for update;
  if not found then return 'missing'; end if;
  v_issues:=private.handoff_acceptance_issues(t.id);
  select coalesce(jsonb_agg(x),'[]'::jsonb) into v_blocking from jsonb_array_elements(v_issues) x where x->>'code' in ('source_reversed','order_not_live');
  select state into v_state from public.handoff_acceptances where task_id=t.id;
  v_qty:=round(coalesce(private.handoff_source_quantity(t),0),3);
  v_open:=exists(select 1 from public.handoff_source_reconciliations where company_id=t.company_id and task_id=t.id and status='open');
  if jsonb_array_length(v_blocking)>0 then
    if t.status not in ('open','in_progress') then return 'closed'; end if;
    if t.status='open' and coalesce(v_state,'pending')<>'accepted' then
      update public.tasks set status='cancelled',updated_at=now() where id=t.id;
      insert into public.handoff_source_reconciliations(company_id,task_id,kind,outcome,previous_quantity_kg,current_quantity_kg,task_status,acceptance_state,issues,status,resolved_at,resolution_note)
      values(t.company_id,t.id,'withdrawn','cancelled_unaccepted',t.handoff_quantity_kg,v_qty,t.status,v_state,v_blocking,'resolved',now(),'Unaccepted handoff cancelled automatically because its source no longer stands.');
      return 'cancelled';
    end if;
    if v_open then return 'review_open'; end if;
    insert into public.handoff_source_reconciliations(company_id,task_id,kind,outcome,previous_quantity_kg,current_quantity_kg,task_status,acceptance_state,issues,status)
    values(t.company_id,t.id,'withdrawn','review_required',t.handoff_quantity_kg,v_qty,t.status,v_state,v_blocking,'open');
    return 'review_required';
  end if;
  -- The source stands again: reopen work this reconciliation cancelled, never work someone else closed.
  if t.status='cancelled' then
    select * into v_last from public.handoff_source_reconciliations where company_id=t.company_id and task_id=t.id order by created_at desc,id desc limit 1;
    if v_last.outcome='cancelled_unaccepted' and v_qty>0 then
      update public.tasks set status='open',assigned_to=null,handoff_quantity_kg=v_qty,updated_at=now() where id=t.id;
      update public.handoff_acceptances set state='pending',auto_accepted=false,accepted_by=null,accepted_by_name=null,accepted_at=null,received_quantity_kg=null,updated_at=now() where task_id=t.id;
      perform private.evaluate_handoff_acceptance(t.id);
      insert into public.handoff_source_reconciliations(company_id,task_id,kind,outcome,previous_quantity_kg,current_quantity_kg,task_status,acceptance_state,issues,status,resolved_at,resolution_note)
      values(t.company_id,t.id,'reinstated','reopened',t.handoff_quantity_kg,v_qty,'cancelled',v_state,v_issues,'resolved',now(),'The source stands again; the handoff was reopened for acceptance.');
      return 'reopened';
    end if;
    return 'closed';
  end if;
  if t.status in ('open','in_progress') and v_qty>0 and abs(v_qty-t.handoff_quantity_kg)>0.0005 then
    if t.status='open' and coalesce(v_state,'pending')<>'accepted' then
      update public.tasks set handoff_quantity_kg=v_qty,updated_at=now() where id=t.id;
      insert into public.handoff_source_reconciliations(company_id,task_id,kind,outcome,previous_quantity_kg,current_quantity_kg,task_status,acceptance_state,issues,status,resolved_at,resolution_note)
      values(t.company_id,t.id,'quantity_changed','quantity_updated',t.handoff_quantity_kg,v_qty,t.status,v_state,v_issues,'resolved',now(),'Unaccepted handoff quantity follows the corrected source quantity.');
      return 'quantity_updated';
    end if;
    if v_open then return 'review_open'; end if;
    insert into public.handoff_source_reconciliations(company_id,task_id,kind,outcome,previous_quantity_kg,current_quantity_kg,task_status,acceptance_state,issues,status)
    values(t.company_id,t.id,'quantity_changed','review_required',t.handoff_quantity_kg,v_qty,t.status,v_state,v_issues,'open');
    return 'review_required';
  end if;
  return 'unchanged';
end $$;
create function private.trigger_handoff_reconciliation() returns trigger
language plpgsql security definer set search_path=public,private as $$
declare v_task uuid;
begin
  if tg_table_name='finishing_jobs' then
    if old.status is not distinct from new.status and old.output_weight_kg is not distinct from new.output_weight_kg then return new; end if;
    for v_task in select id from public.tasks where company_id=new.company_id and handoff_source_type='finishing_job' and handoff_source_id=new.id and handoff_key is not null loop
      perform private.reconcile_handoff_task(v_task);
    end loop;
  elsif tg_table_name='production_jobs' then
    if old.status is not distinct from new.status or 'cancelled' not in (old.status,new.status) then return new; end if;
    for v_task in select t.id from public.tasks t join public.quality_inspections q on q.id=t.handoff_source_id and q.company_id=t.company_id
      where t.company_id=new.company_id and t.handoff_source_type='quality_inspection' and q.production_job_id=new.id loop
      perform private.reconcile_handoff_task(v_task);
    end loop;
  else
    if old.current_stage is not distinct from new.current_stage or not (old.current_stage in ('cancelled','closed') or new.current_stage in ('cancelled','closed')) then return new; end if;
    for v_task in select t.id from public.tasks t where t.company_id=new.company_id and t.handoff_key is not null and t.status in ('open','in_progress','cancelled') and (
        (t.handoff_source_type='finishing_job' and exists(select 1 from public.finishing_jobs f where f.id=t.handoff_source_id and f.company_id=t.company_id and f.order_id=new.id))
        or (t.handoff_source_type='packaging_job' and exists(select 1 from public.packaging_jobs p where p.id=t.handoff_source_id and p.company_id=t.company_id and p.order_id=new.id))
        or (t.handoff_source_type='quality_inspection' and exists(select 1 from public.quality_inspections q join public.production_jobs j on j.id=q.production_job_id and j.company_id=q.company_id
          where q.id=t.handoff_source_id and q.company_id=t.company_id and j.order_id=new.id))) loop
      perform private.reconcile_handoff_task(v_task);
    end loop;
  end if;
  return new;
end $$;
revoke all on function private.handoff_source_quantity(public.tasks),private.reconcile_handoff_task(uuid),private.trigger_handoff_reconciliation() from public,anon,authenticated;
create trigger zzz_reconcile_handoff_source after update on public.finishing_jobs for each row execute function private.trigger_handoff_reconciliation();
create trigger zzz_reconcile_handoff_source after update on public.production_jobs for each row execute function private.trigger_handoff_reconciliation();
create trigger zzz_reconcile_handoff_source after update on public.orders for each row execute function private.trigger_handoff_reconciliation();

------------------------------------------------------------------------------------------------
-- NOV-042: approval ceilings. Existing exception policy decides who may approve at all; the
-- revision in force at decision time limits how much each role may approve.
------------------------------------------------------------------------------------------------
create function private.exception_exposure(p_type text,p_detail jsonb) returns numeric language sql immutable set search_path=public,private as $$
  select case p_type
    when 'overdue_dispatch' then nullif(p_detail->>'overdue_amount','')::numeric
    when 'low_margin_quote' then coalesce(nullif(p_detail->>'shortfall_points','')::numeric,
      nullif(p_detail->>'required_percent','')::numeric-nullif(p_detail->>'margin_percent','')::numeric) end
$$;
create function private.current_authority(p_company uuid,p_type text,p_at timestamptz default now()) returns public.decision_authority_revisions
language sql stable security definer set search_path=public,private as $$
  select * from public.decision_authority_revisions where company_id=p_company and decision_type=p_type and effective_from<=p_at order by effective_from desc,revision desc limit 1
$$;
create function private.guard_decision_authority() returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_role text; a public.decision_authority_revisions%rowtype; v_exposure numeric; v_ceiling numeric;
begin
  if new.status<>'approved' or old.status='approved' then return new; end if;
  select role into v_role from public.app_users where id=new.decided_by and company_id=new.company_id;
  a:=private.current_authority(new.company_id,new.exception_type);
  v_exposure:=private.exception_exposure(new.exception_type,new.detail);
  if a.id is not null and a.limits ? v_role then
    v_ceiling:=(a.limits->>v_role)::numeric;
    if v_exposure is null then
      raise exception 'Your approval limit cannot be checked because this request has no recorded exposure. Ask an approver without a limit to decide it.' using errcode='23514';
    end if;
    if v_exposure>v_ceiling then
      raise exception 'This exception is above your approval limit (% against your limit of % under authority revision %). An approver with a higher limit must decide it.',
        trim_scale(round(v_exposure,2)),trim_scale(v_ceiling),a.revision using errcode='23514';
    end if;
  end if;
  insert into public.decision_authority_bindings(request_id,company_id,revision_id,decided_role,exposure,ceiling)
  values(new.id,new.company_id,a.id,v_role,v_exposure,v_ceiling) on conflict(request_id) do nothing;
  return new;
end $$;
revoke all on function private.exception_exposure(text,jsonb),private.current_authority(uuid,text,timestamptz),private.guard_decision_authority() from public,anon,authenticated;
create trigger zzz_guard_decision_authority before update on public.exception_requests for each row execute function private.guard_decision_authority();

------------------------------------------------------------------------------------------------
-- NOV-051 and NOV-057: task bindings and progress guards.
------------------------------------------------------------------------------------------------
create function private.bind_completion_contract() returns trigger language plpgsql security definer set search_path=public,private as $$
declare c public.completion_contracts%rowtype;
begin
  if new.dealership_id is not null then return null; end if;
  select * into c from public.completion_contracts where company_id=new.company_id and task_kind=any(private.task_kinds_of(new.task_type,new.handoff_team))
    order by (task_kind like 'handoff:%') desc,revision desc limit 1;
  if c.id is null then return null; end if;
  insert into public.task_contract_bindings(task_id,company_id,contract_id,task_kind) values(new.id,new.company_id,c.id,c.task_kind) on conflict do nothing;
  -- A task created already complete is held to the same one-source rule as a later completion.
  if new.status='completed' and c.exclusive_source and new.related_entity_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||':done:'||c.task_kind||':'||new.related_entity_id::text,0));
    if exists(select 1 from public.tasks t join public.task_contract_bindings ob on ob.task_id=t.id where t.company_id=new.company_id and t.id<>new.id and t.status='completed'
      and ob.task_kind=c.task_kind and t.related_entity_type is not distinct from new.related_entity_type and t.related_entity_id=new.related_entity_id) then
      raise exception 'This evidence already completed another task of the same kind. Link this task to its own source record.' using errcode='23514';
    end if;
  end if;
  return null;
end $$;
create trigger zzz_bind_completion_contract after insert on public.tasks for each row execute function private.bind_completion_contract();

create function private.guard_control_task_progress() returns trigger language plpgsql security definer set search_path=public,private as $$
declare b public.task_contract_bindings%rowtype; c public.completion_contracts%rowtype; v_other public.tasks%rowtype; v_version uuid; v_actor uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status='completed' then
    if exists(select 1 from public.handoff_source_reconciliations where company_id=new.company_id and task_id=new.id and status='open') then
      raise exception 'The source of this handoff changed after acceptance. Resolve the source review before completing it.' using errcode='23514';
    end if;
    select * into b from public.task_contract_bindings where task_id=new.id;
    if found then
      select * into c from public.completion_contracts where id=b.contract_id;
      if c.exclusive_source and new.related_entity_id is not null then
        perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||':done:'||b.task_kind||':'||new.related_entity_id::text,0));
        select t.* into v_other from public.tasks t join public.task_contract_bindings ob on ob.task_id=t.id
          where t.company_id=new.company_id and t.id<>new.id and t.status='completed' and ob.task_kind=b.task_kind
            and t.related_entity_type is not distinct from new.related_entity_type and t.related_entity_id=new.related_entity_id limit 1;
        if found then
          raise exception 'This evidence already completed another task of the same kind ("%"). Link this task to its own source record.',left(v_other.title,80) using errcode='23514';
        end if;
      end if;
    end if;
  end if;
  if new.status in ('in_progress','completed') then
    v_actor:=coalesce(new.assigned_to,auth.uid());
    select tb.version_id into v_version from public.task_procedure_bindings tb join public.procedure_rollouts r on r.version_id=tb.version_id and r.company_id=tb.company_id
      where tb.task_id=new.id and r.change_class='acknowledgement_required';
    if v_version is not null and v_actor is not null and not exists(select 1 from public.procedure_acknowledgements a where a.company_id=new.company_id and a.version_id=v_version and a.employee_id=v_actor) then
      raise exception 'The instructions for this task changed. The assigned employee must acknowledge the released version before starting or completing it.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.bind_completion_contract(),private.guard_control_task_progress() from public,anon,authenticated;
create trigger zzz_guard_control_task_progress before update on public.tasks for each row execute function private.guard_control_task_progress();

create function private.create_procedure_rollout() returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if new.status='released' and old.status is distinct from 'released' then
    insert into public.procedure_rollouts(version_id,company_id,procedure_id) values(new.id,new.company_id,new.procedure_id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function private.create_procedure_rollout() from public,anon,authenticated;
create trigger zzz_create_procedure_rollout after update on public.procedure_versions for each row execute function private.create_procedure_rollout();
-- Already released versions are recorded as informational; no acknowledgement is required retrospectively.
insert into public.procedure_rollouts(version_id,company_id,procedure_id,created_at)
select id,company_id,procedure_id,coalesce(released_at,now()) from public.procedure_versions where status='released' on conflict do nothing;

------------------------------------------------------------------------------------------------
-- NOV-022: billet purchasing plan. Demand is the existing billet shortage of live orders; free
-- stock and confirmed open supply are netted once per alloy and diameter group.
------------------------------------------------------------------------------------------------
create function private.control_billet_plan(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_groups jsonb:='[]'::jsonb; g record; v_free numeric; v_free_rows jsonb; v_open numeric; v_tentative numeric; v_supply jsonb; p public.procurement_policies%rowtype;
  v_net numeric; v_proposed numeric; v_warnings jsonb; v_unclassified integer; v_covered integer:=0;
begin
  for g in select upper(btrim(r.alloy)) alloy,r.billet_diameter_inch diameter,round(sum(r.billets_short*r.billet_weight_kg),3) demand_kg,min(o.expected_dispatch_date) need_by,
      count(*) filter(where o.expected_dispatch_date is null) undated,
      jsonb_agg(jsonb_build_object('order_id',o.id,'order_number',o.order_number,'kg',round(r.billets_short*r.billet_weight_kg,3),'billets_short',r.billets_short,'need_by',o.expected_dispatch_date) order by o.expected_dispatch_date nulls last,o.order_number) orders
    from public.order_billet_requirements r join public.orders o on o.id=r.order_id and o.company_id=r.company_id
    where r.company_id=p_company and o.deleted_at is null and o.current_stage not in ('closed','cancelled','dispatched','delivered','payment_pending') and r.billets_short>0 and r.billet_weight_kg>0
    group by upper(btrim(r.alloy)),r.billet_diameter_inch order by 1,2 loop
    select coalesce(sum(available_weight_kg),0),coalesce(jsonb_agg(jsonb_build_object('batch',batch_number,'kg',available_weight_kg) order by received_date,batch_number) filter(where available_weight_kg>0),'[]'::jsonb)
      into v_free,v_free_rows from public.billet_batches
      where company_id=p_company and status='available' and available_weight_kg>0 and upper(btrim(alloy))=g.alloy and diameter_mm is not null and abs(diameter_mm-g.diameter*25.4)<=1.0;
    select count(*) into v_unclassified from public.billet_batches where company_id=p_company and status='available' and available_weight_kg>0 and upper(btrim(alloy))=g.alloy and diameter_mm is null;
    select coalesce(sum(remaining) filter(where po_status='open'),0),coalesce(sum(remaining) filter(where po_status='draft'),0),
      coalesce(jsonb_agg(jsonb_build_object('po_number',po_number,'status',po_status,'remaining_kg',remaining) order by po_number) filter(where remaining>0),'[]'::jsonb)
      into v_open,v_tentative,v_supply from (
        select po.po_number,po.status po_status,greatest(l.ordered_quantity-coalesce((select sum(rl.received_quantity) from public.purchase_receipt_lines rl where rl.company_id=l.company_id and rl.purchase_order_line_id=l.id),0),0) remaining
        from public.procurement_supply_links s join public.purchase_order_lines l on l.id=s.purchase_order_line_id and l.company_id=s.company_id
        join public.purchase_orders po on po.id=l.purchase_order_id and po.company_id=l.company_id
        where s.company_id=p_company and upper(s.alloy)=g.alloy and s.diameter_inch=g.diameter and lower(btrim(l.unit))='kg') x;
    select * into p from public.procurement_policies where company_id=p_company and upper(alloy)=g.alloy and diameter_inch=g.diameter;
    v_warnings:='[]'::jsonb;
    if p.id is null then v_warnings:=v_warnings||jsonb_build_array('No approved purchasing policy: lead time, minimum order and pack size are not applied.'); end if;
    if g.undated>0 then v_warnings:=v_warnings||jsonb_build_array(format('%s order(s) have no dispatch date; their need-by date is unknown.',g.undated)); end if;
    if v_unclassified>0 then v_warnings:=v_warnings||jsonb_build_array(format('%s available %s batch(es) have no recorded diameter and are not counted.',v_unclassified,g.alloy)); end if;
    if v_tentative>0 then v_warnings:=v_warnings||jsonb_build_array('Draft purchase orders are tentative and are not netted as confirmed supply.'); end if;
    v_net:=round(g.demand_kg+coalesce(p.safety_stock_kg,0)-v_free-v_open,3);
    if v_net<=0 then v_covered:=v_covered+1; continue; end if;
    v_proposed:=greatest(v_net,coalesce(p.min_order_kg,0));
    if p.pack_kg is not null then v_proposed:=ceil(v_proposed/p.pack_kg)*p.pack_kg; end if;
    v_groups:=v_groups||jsonb_build_array(jsonb_build_object('alloy',g.alloy,'diameter_inch',g.diameter,'demand_kg',g.demand_kg,'free_stock_kg',v_free,
      'open_supply_kg',v_open,'tentative_supply_kg',v_tentative,'safety_stock_kg',coalesce(p.safety_stock_kg,0),'net_shortage_kg',v_net,'proposed_kg',round(v_proposed,3),
      'need_by',g.need_by,'order_by',g.need_by-coalesce(p.lead_days,0),'demand',g.orders,'supply',jsonb_build_object('free_batches',v_free_rows,'purchase_orders',v_supply),
      'warnings',v_warnings,'policy',case when p.id is null then null else jsonb_build_object('lead_days',p.lead_days,'min_order_kg',p.min_order_kg,'pack_kg',p.pack_kg,'safety_stock_kg',p.safety_stock_kg,'revision',p.revision) end));
  end loop;
  return jsonb_build_object('shortages',v_groups,'covered_groups',v_covered);
end $$;
revoke all on function private.control_billet_plan(uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Read models for every view in this batch.
------------------------------------------------------------------------------------------------
create function private.control_custody(p_company uuid,p_job uuid) returns jsonb
language sql stable security definer set search_path=public,private as $$
  select jsonb_build_object('issued_kg',f.input_weight_kg,
    'accepted_kg',case when f.status in ('received','completed','rejected') then f.output_weight_kg else 0 end,
    'rejected_kg',case when f.status in ('received','completed','rejected') then f.rejection_weight_kg else 0 end,
    'explained_kg',coalesce(a.kg,0),'explanations',coalesce(a.items,'[]'::jsonb),
    'unaccounted_kg',round(f.input_weight_kg-case when f.status in ('received','completed','rejected') then f.output_weight_kg+f.rejection_weight_kg else 0 end-coalesce(a.kg,0),3))
  from public.finishing_jobs f left join lateral(select sum(quantity_kg) kg,jsonb_agg(jsonb_build_object('id',id,'category',category,'kg',quantity_kg,'evidence',evidence,'recorded_at',recorded_at) order by recorded_at,id) items
    from public.finishing_custody_adjustments where company_id=f.company_id and finishing_job_id=f.id and reversed_at is null) a on true
  where f.id=p_job and f.company_id=p_company
$$;
revoke all on function private.control_custody(uuid,uuid) from public,anon,authenticated;

create function private.control_wip_stage(p_company uuid,j public.production_jobs) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare h public.production_job_holds%rowtype; f record; v_approved numeric; v_packed numeric; v_entered timestamptz; v_qc_at timestamptz;
begin
  if j.status in ('planned','ready','cancelled') then return null; end if;
  if j.status='in_progress' then
    select max(created_at) into v_entered from public.production_job_status_history where company_id=p_company and production_job_id=j.id and new_status='in_progress';
    return jsonb_build_object('stage','at_press','entered_at',coalesce(v_entered,j.updated_at),'quantity_kg',j.planned_quantity_kg,'quantity_basis','planned kg in process');
  end if;
  if j.status='on_hold' then
    select * into h from public.production_job_holds where company_id=p_company and production_job_id=j.id and status='active' order by held_at desc limit 1;
    return jsonb_build_object('stage','on_hold','entered_at',coalesce(h.held_at,j.updated_at),'quantity_kg',h.recorded_output_kg,'quantity_basis',case when h.recorded_output_kg is null then 'output not recorded' else 'recorded output kg' end,
      'hold',case when h.id is null then null else jsonb_build_object('reason',h.reason,'responsible',h.responsible_name,'resume_condition',h.resume_condition) end);
  end if;
  select fj.id,fj.status,fj.input_weight_kg,coalesce(fj.sent_date::timestamptz,fj.updated_at) sent_at,v.vendor_name into f from public.finishing_jobs fj left join public.vendors v on v.id=fj.vendor_id and v.company_id=fj.company_id
    where fj.company_id=p_company and fj.production_job_id=j.id and fj.status in ('sent_to_vendor','in_process') order by fj.created_at desc limit 1;
  if f.id is not null then
    return jsonb_build_object('stage','at_vendor','entered_at',f.sent_at,'quantity_kg',f.input_weight_kg,'quantity_basis','kg issued to vendor','vendor',f.vendor_name,'finishing_job_id',f.id);
  end if;
  select coalesce(sum(q.quantity_checked_kg),0),max(q.updated_at) into v_approved,v_qc_at from public.quality_inspections q
    where q.company_id=p_company and q.status='approved' and (q.production_job_id=j.id or q.finishing_job_id in (select id from public.finishing_jobs where company_id=p_company and production_job_id=j.id));
  if v_approved<=0 then
    if exists(select 1 from public.finishing_jobs where company_id=p_company and production_job_id=j.id and status='planned') then
      return jsonb_build_object('stage','awaiting_finishing','entered_at',coalesce(j.completed_at,j.updated_at),'quantity_kg',j.actual_quantity_kg,'quantity_basis','actual output kg');
    end if;
    return jsonb_build_object('stage','awaiting_qc','entered_at',coalesce(j.completed_at,j.updated_at),'quantity_kg',j.actual_quantity_kg,'quantity_basis','actual output kg');
  end if;
  select coalesce(sum(profile_weight_kg),0) into v_packed from public.packaging_jobs where company_id=p_company and production_job_id=j.id and status='completed';
  if v_packed<v_approved-0.001 then
    return jsonb_build_object('stage','awaiting_packing','entered_at',v_qc_at,'quantity_kg',round(v_approved-v_packed,3),'quantity_basis','QC-released kg not yet packed');
  end if;
  return null;
end $$;
revoke all on function private.control_wip_stage(uuid,public.production_jobs) from public,anon,authenticated;

create function private.control_rows(p_company uuid,p_actor uuid,p_role text,p_view text,p_state text,p_id uuid default null)
returns table(row_data jsonb,sort_rank integer,sort_due date,sort_new timestamptz) language plpgsql stable security definer set search_path=public,private as $$
declare v_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  if p_view='ledger' then
    return query select jsonb_build_object('id',o.id,'label',o.order_number,'status',l->>'status','owner',u.full_name,'due_date',o.expected_dispatch_date,
        'summary',concat(l->>'line_count',' line(s); ',coalesce(l->>'departed_kg','0'),' of ',coalesce(l->>'ordered_kg','unknown'),' kg departed; ',l->>'delivered_kg',' kg delivered'),
        'source_href','/orders/'||o.id,'details',l||jsonb_build_object('customer',c.customer_name,'stage',o.current_stage)),
      case l->>'status' when 'source_unavailable' then 0 when 'on_hold' then 1 when 'quantity_unknown' then 2 else 3 end,o.expected_dispatch_date,o.created_at
    from public.orders o cross join lateral private.control_order_ledger(p_company,o.id) l
    left join public.customers c on c.id=o.customer_id and c.company_id=o.company_id
    left join public.order_coordinators oc on oc.company_id=o.company_id and oc.order_id=o.id left join public.app_users u on u.id=oc.coordinator_id
    where o.company_id=p_company and o.deleted_at is null and (p_id is null or o.id=p_id)
      and (p_state='all' or p_id is not null or o.current_stage not in ('closed','cancelled','delivered','payment_pending'));
  elsif p_view='inheritance' then
    return query select jsonb_build_object('id',j.id,'label',concat(coalesce(j.job_number,'Production job'),' · ',o.order_number),'status',d->>'state','owner',null,
        'due_date',j.planned_date,'summary',case d->>'state' when 'matches' then 'Inherited facts match the order line'
          when 'unlinked' then 'Job has no order line identity; nothing is inferred'
          when 'source_unavailable' then 'Order line is unavailable; the job keeps its recorded facts'
          when 'overridden' then 'Differences are recorded as deliberate'
          else concat(jsonb_array_length(d->'fields'),' fact(s) differ from the current order line') end,
        'source_href','/production/'||j.id,'details',d||jsonb_build_object('order_number',o.order_number,'job_number',j.job_number)),
      case d->>'state' when 'drifted' then 0 when 'drift_locked' then 1 when 'source_unavailable' then 2 else 3 end,j.planned_date,j.updated_at
    from public.production_jobs j join public.orders o on o.id=j.order_id and o.company_id=j.company_id
    cross join lateral private.control_fact_drift(p_company,j.id) d
    where j.company_id=p_company and j.status<>'cancelled' and o.deleted_at is null and (p_id is null or j.id=p_id)
      and (p_id is not null or (o.current_stage not in ('closed','cancelled') and (p_state='all' or d->>'state' in ('drifted','drift_locked','source_unavailable'))));
  elsif p_view='handoffs' then
    return query select jsonb_build_object('id',r.id,'label',t.title,'status',r.status,'owner',u.full_name,'due_date',t.due_date,
        'summary',case r.outcome when 'cancelled_unaccepted' then 'Source withdrawn; unaccepted handoff cancelled'
          when 'quantity_updated' then concat('Quantity corrected from ',trim_scale(r.previous_quantity_kg),' to ',trim_scale(r.current_quantity_kg),' kg before acceptance')
          when 'reopened' then 'Source stands again; handoff reopened for acceptance'
          else case r.kind when 'withdrawn' then 'Accepted work lost its source; review the physical position'
            else concat('Accepted quantity ',trim_scale(r.previous_quantity_kg),' kg; source now ',trim_scale(r.current_quantity_kg),' kg') end end,
        'source_href','/tasks/'||t.id,'details',jsonb_build_object('kind',r.kind,'outcome',r.outcome,'team',t.handoff_team,'task_status',t.status,
          'acceptance_state',r.acceptance_state,'previous_quantity_kg',r.previous_quantity_kg,'current_quantity_kg',r.current_quantity_kg,'issues',r.issues,
          'resolution_note',r.resolution_note,'resolved_at',r.resolved_at,'task_id',t.id)),
      case r.status when 'open' then 0 else 1 end,t.due_date,r.created_at
    from public.handoff_source_reconciliations r join public.tasks t on t.id=r.task_id and t.company_id=r.company_id
    left join public.app_users u on u.id=t.assigned_to and u.company_id=t.company_id
    where r.company_id=p_company and (p_id is null or r.id=p_id) and (p_id is not null or p_state='all' or r.status='open')
      and (p_role in ('owner','admin','factory_manager','viewer') or p_role=any(private.handoff_team_roles(t.handoff_team)));
  elsif p_view='procurement' then
    return query select jsonb_build_object('id',l.id,'label',concat(l.alloy,' billet · ',trim_scale(l.diameter_inch),' in'),'status',l.state,'owner',u.full_name,'due_date',l.order_by,
        'summary',concat('Net shortage ',trim_scale(l.net_shortage_kg),' kg; proposed purchase ',trim_scale(l.proposed_kg),' kg'),
        'source_href','/vendors/purchasing','details',jsonb_build_object('demand_kg',l.demand_kg,'free_stock_kg',l.free_stock_kg,'open_supply_kg',l.open_supply_kg,
          'tentative_supply_kg',l.tentative_supply_kg,'safety_stock_kg',l.safety_stock_kg,'net_shortage_kg',l.net_shortage_kg,'proposed_kg',l.proposed_kg,
          'need_by',l.need_by,'order_by',l.order_by,'demand',l.demand,'supply',l.supply,'warnings',l.warnings,'policy',l.policy,'review_note',l.review_note,
          'generated_at',pr.generated_at,'overdue_to_order',l.state='proposed' and l.order_by<v_today)),
      case l.state when 'proposed' then 0 when 'accepted' then 1 else 2 end,l.order_by,pr.generated_at
    from public.procurement_plan_lines l join public.procurement_plan_runs pr on pr.id=l.run_id and pr.company_id=l.company_id
    left join public.app_users u on u.id=l.reviewed_by and u.company_id=l.company_id
    where l.company_id=p_company and (p_id is null or l.id=p_id) and (p_id is not null or p_state='all' or l.state in ('proposed','accepted'));
  elsif p_view='wip' then
    return query select jsonb_build_object('id',j.id,'label',concat(coalesce(j.job_number,'Production job'),' · ',o.order_number),'status',s->>'stage','owner',null,
        'due_date',o.expected_dispatch_date,'summary',concat(coalesce(trim_scale(round((s->>'quantity_kg')::numeric,3))||' kg ','quantity unknown '),'(',s->>'quantity_basis','); ',
          round(extract(epoch from now()-(s->>'entered_at')::timestamptz)/3600),' h in stage; location ',coalesce(lo.location_name,'not recorded')),
        'source_href','/production/'||j.id,'details',s||jsonb_build_object('order_number',o.order_number,'age_hours',round(extract(epoch from now()-(s->>'entered_at')::timestamptz)/3600,1),
          'location',lo.location_name,'location_observed_at',lo.observed_at,'location_quantity_kg',lo.quantity_kg,'observed_by',lo.observer)),
      case s->>'stage' when 'on_hold' then 0 when 'awaiting_qc' then 1 when 'awaiting_packing' then 2 when 'at_vendor' then 3 when 'awaiting_finishing' then 4 else 5 end,
      ((s->>'entered_at')::timestamptz at time zone 'Asia/Kolkata')::date,(s->>'entered_at')::timestamptz
    from public.production_jobs j join public.orders o on o.id=j.order_id and o.company_id=j.company_id
    cross join lateral private.control_wip_stage(p_company,j) s
    left join lateral(select loc.location_name,w.observed_at,w.quantity_kg,ou.full_name observer from public.wip_location_observations w
      join public.inventory_locations loc on loc.id=w.location_id and loc.company_id=w.company_id left join public.app_users ou on ou.id=w.observed_by
      where w.company_id=j.company_id and w.production_job_id=j.id order by w.observed_at desc,w.id desc limit 1) lo on true
    where j.company_id=p_company and o.deleted_at is null and s is not null and (p_id is null or j.id=p_id) and (p_state='all' or p_id is not null or o.current_stage not in ('closed','cancelled'));
  elsif p_view='custody' then
    return query select jsonb_build_object('id',f.id,'label',concat(coalesce(v.vendor_name,'Vendor'),' · ',coalesce(j.job_number,'finishing'),' · ',o.order_number),
        'status',case when f.status in ('sent_to_vendor','in_process') then 'at_vendor' when (k->>'unaccounted_kg')::numeric< -0.001 then 'over_received'
          when (k->>'unaccounted_kg')::numeric>0.001 then 'unaccounted' else 'reconciled' end,
        'owner',v.vendor_name,'due_date',f.sent_date+lt.lead_days,
        'summary',concat(trim_scale(f.input_weight_kg),' kg issued; ',trim_scale((k->>'accepted_kg')::numeric),' kg accepted; ',trim_scale((k->>'rejected_kg')::numeric),' kg rejected; ',
          trim_scale((k->>'unaccounted_kg')::numeric),' kg not yet accounted'),
        'source_href','/production/finishing/'||f.id,'details',k||jsonb_build_object('vendor',v.vendor_name,'finishing_type',f.finishing_type,'status',f.status,'sent_date',f.sent_date,
          'received_date',f.received_date,'expected_return',f.sent_date+lt.lead_days,'lead_time_known',lt.lead_days is not null,'order_number',o.order_number,
          'order_due',o.expected_dispatch_date,'retry_of',f.retry_of_finishing_job_id,'age_days',case when f.sent_date is null then null else v_today-f.sent_date end)),
      case when f.status in ('sent_to_vendor','in_process') and f.sent_date+lt.lead_days<v_today then 0 when (k->>'unaccounted_kg')::numeric>0.001 then 1 else 2 end,
      f.sent_date,f.updated_at
    from public.finishing_jobs f join public.orders o on o.id=f.order_id and o.company_id=f.company_id
    left join public.vendors v on v.id=f.vendor_id and v.company_id=f.company_id left join public.production_jobs j on j.id=f.production_job_id and j.company_id=f.company_id
    left join public.factory_finishing_lead_times lt on lt.company_id=f.company_id and lt.finishing_type=f.finishing_type
    cross join lateral private.control_custody(p_company,f.id) k
    where f.company_id=p_company and f.vendor_id is not null and f.status in ('sent_to_vendor','in_process','received','completed','rejected') and (p_id is null or f.id=p_id)
      and (p_id is not null or p_state='all' or f.status in ('sent_to_vendor','in_process') or abs((k->>'unaccounted_kg')::numeric)>0.001);
  elsif p_view='authority' then
    return query select jsonb_build_object('id',md5(p_company::text||':authority:'||x.t)::uuid,'label',x.label,
        'status',case when a.id is null then 'no_limits' else 'limits_active' end,'owner',null,'due_date',null,
        'summary',case when a.id is null then 'Existing exception policy applies without role ceilings' else concat('Revision ',a.revision,' in force since ',to_char(a.effective_from at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI')) end,
        'source_href','/tasks/approvals','details',jsonb_build_object('decision_type',x.t,'unit',x.unit,'policy_active',coalesce(ep.is_active,false),'approver_roles',coalesce(to_jsonb(ep.approver_roles),'[]'::jsonb),
          'requester_roles',to_jsonb(private.exception_requester_roles(x.t)),'revision',a.revision,'effective_from',a.effective_from,'limits',coalesce(a.limits,'{}'::jsonb),
          'scheduled',(select jsonb_build_object('revision',n.revision,'effective_from',n.effective_from,'limits',n.limits) from public.decision_authority_revisions n where n.company_id=p_company and n.decision_type=x.t and n.effective_from>now() order by n.effective_from,n.revision limit 1),
          'your_role',p_role,'you_can_request',p_role=any(private.exception_requester_roles(x.t)),'you_can_approve',coalesce(ep.is_active,false) and p_role=any(coalesce(ep.approver_roles,'{}')),
          'your_ceiling',a.limits->p_role,'owner_unlimited',true)),x.n,null::date,a.published_at
    from (values ('overdue_dispatch','Dispatch to a customer with overdue payments','INR overdue',1),('low_margin_quote','Low-margin quotation release','margin points short',2)) x(t,label,unit,n)
    left join public.exception_policies ep on ep.company_id=p_company and ep.exception_type=x.t
    left join lateral private.current_authority(p_company,x.t) a on a.id is not null
    where p_id is null or md5(p_company::text||':authority:'||x.t)::uuid=p_id;
  elsif p_view='contracts' then
    return query with kinds as (
      select distinct task_kind from public.completion_criteria_templates where company_id=p_company and is_active
      union select distinct task_kind from public.completion_contracts where company_id=p_company
    ), live as (
      select task_kind,coalesce(jsonb_agg(jsonb_build_object('kind',kind,'label',label,'config',config) order by seq,id),'[]'::jsonb) criteria
      from public.completion_criteria_templates where company_id=p_company and is_active group by task_kind
    )
    select jsonb_build_object('id',md5(p_company::text||':contract:'||k.task_kind)::uuid,'label',k.task_kind,
        'status',case when c.id is null then 'unpublished' when coalesce(lv.criteria,'[]'::jsonb) is distinct from (select jsonb_agg(x-'seq' order by n) from jsonb_array_elements(c.criteria) with ordinality e(x,n)) then 'templates_changed' else 'published' end,
        'owner',u.full_name,'due_date',null,'summary',case when c.id is null then 'Active criteria have no published definition of done' else concat('Revision ',c.revision,'; ',jsonb_array_length(c.criteria),' criteria',case when c.exclusive_source then '; each source completes one task' else '' end) end,
        'source_href','/tasks/criteria','details',jsonb_build_object('task_kind',k.task_kind,'revision',c.revision,'criteria',coalesce(c.criteria,'[]'::jsonb),'exclusive_source',c.exclusive_source,
          'published_at',c.published_at,'live_criteria',coalesce(lv.criteria,'[]'::jsonb),
          'bound_open',(select count(*) from public.task_contract_bindings b join public.tasks t on t.id=b.task_id where b.company_id=p_company and b.contract_id=c.id and t.status in ('open','in_progress')),
          'open_on_older',(select count(*) from public.task_contract_bindings b join public.completion_contracts oc on oc.id=b.contract_id join public.tasks t on t.id=b.task_id
            where b.company_id=p_company and b.task_kind=k.task_kind and oc.revision<c.revision and t.status in ('open','in_progress')))),
      case when c.id is null then 0 else 1 end,null::date,c.published_at
    from kinds k left join live lv on lv.task_kind=k.task_kind
    left join lateral(select * from public.completion_contracts cc where cc.company_id=p_company and cc.task_kind=k.task_kind order by revision desc limit 1) c on true
    left join public.app_users u on u.id=c.published_by
    where p_id is null or md5(p_company::text||':contract:'||k.task_kind)::uuid=p_id;
  elsif p_view='rollouts' then
    return query with affected as (
      select tb.version_id,t.id task_id,t.assigned_to,t.status from public.task_procedure_bindings tb join public.tasks t on t.id=tb.task_id and t.company_id=tb.company_id
      where tb.company_id=p_company and t.status in ('open','in_progress')
    )
    select jsonb_build_object('id',v.id,'label',concat(op.title,' · version ',v.version_no),
        'status',case when v.status='withdrawn' then 'withdrawn' when r.change_class='informational' then 'informational'
          when exists(select 1 from affected a where a.version_id=v.id and a.assigned_to is not null and not exists(select 1 from public.procedure_acknowledgements k where k.company_id=p_company and k.version_id=v.id and k.employee_id=a.assigned_to)) then 'awaiting_acknowledgement'
          else 'acknowledged' end,
        'owner',op.owner_name,'due_date',v.effective_from,'summary',left(v.change_summary,160),'source_href','/tasks/procedures',
        'details',jsonb_build_object('procedure_id',op.id,'version_no',v.version_no,'change_class',r.change_class,'change_summary',v.change_summary,'effective_from',v.effective_from,
          'in_flight_policy',v.in_flight_policy,'released_at',v.released_at,
          'affected_tasks',(select count(*) from affected a where a.version_id=v.id),
          'unassigned_tasks',(select count(*) from affected a where a.version_id=v.id and a.assigned_to is null),
          'employees',(select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(eu.full_name,'Employee'),'acknowledged',k.employee_id is not null,'active',eu.is_active) order by k.employee_id is not null,eu.full_name),'[]'::jsonb)
            from (select distinct assigned_to from affected a where a.version_id=v.id and a.assigned_to is not null) e join public.app_users eu on eu.id=e.assigned_to
            left join public.procedure_acknowledgements k on k.company_id=p_company and k.version_id=v.id and k.employee_id=e.assigned_to),
          'acknowledged_count',(select count(*) from public.procedure_acknowledgements k where k.company_id=p_company and k.version_id=v.id),
          'you_acknowledged',exists(select 1 from public.procedure_acknowledgements k where k.company_id=p_company and k.version_id=v.id and k.employee_id=p_actor),
          'older_version_work',(select count(*) from public.task_procedure_bindings tb join public.procedure_versions ov on ov.id=tb.version_id join public.tasks t on t.id=tb.task_id
            where tb.company_id=p_company and ov.procedure_id=v.procedure_id and ov.version_no<v.version_no and t.status in ('open','in_progress')),
          'is_latest',not exists(select 1 from public.procedure_versions nv where nv.company_id=p_company and nv.procedure_id=v.procedure_id and nv.status='released' and nv.version_no>v.version_no))),
      case when r.change_class='acknowledgement_required' then 0 else 1 end,v.effective_from,v.released_at
    from public.procedure_rollouts r join public.procedure_versions v on v.id=r.version_id and v.company_id=r.company_id
    join public.operating_procedures op on op.id=v.procedure_id and op.company_id=v.company_id
    where r.company_id=p_company and (p_id is null or v.id=p_id)
      and (p_id is not null or p_state='all' or (v.status='released' and not exists(select 1 from public.procedure_versions nv where nv.company_id=p_company and nv.procedure_id=v.procedure_id and nv.status='released' and nv.version_no>v.version_no)));
  end if;
end $$;
revoke all on function private.control_rows(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Reviewed actions: one shape check, one authorized context shared by preview and commitment.
------------------------------------------------------------------------------------------------
create function private.control_assert_shape(p_mutation jsonb) returns void language plpgsql set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_keys text[]; v_optional text[]:='{}'; n text:=btrim(coalesce(p_mutation->>'note',''));
begin
  v_keys:=case a when 'facts.refresh' then array['job_id'] when 'facts.keep' then array['job_id'] when 'handoff.resolve' then array['id']
    when 'policy.set' then array['alloy','diameter_inch','lead_days','min_order_kg','safety_stock_kg'] when 'supply.link' then array['po_line_id','alloy','diameter_inch']
    when 'plan.generate' then array[]::text[] when 'plan.review' then array['id','decision'] when 'wip.observe' then array['job_id','location_id']
    when 'custody.explain' then array['job_id','category','quantity_kg','evidence'] when 'custody.reverse' then array['id']
    when 'authority.publish' then array['decision_type','limits','effective_from'] when 'contract.publish' then array['task_kind','exclusive_source']
    when 'rollout.classify' then array['version_id','change_class'] when 'rollout.acknowledge' then array['version_id'] end;
  if a='policy.set' then v_optional:=array['pack_kg']; elsif a='wip.observe' then v_optional:=array['quantity_kg']; end if;
  if jsonb_typeof(p_mutation) is distinct from 'object' or v_keys is null or not(p_mutation ?& (v_keys||array['action','note']))
    or exists(select 1 from jsonb_object_keys(p_mutation) k where not(k=any(v_keys||v_optional||array['action','note'])))
    or length(n) not between 5 and 500 or n ~ '[[:cntrl:]]'
    or exists(select 1 from jsonb_each(p_mutation) x where jsonb_typeof(x.value)='null') then raise exception 'NOV: Review the required action details.'; end if;
end $$;
revoke all on function private.control_assert_shape(jsonb) from public,anon,authenticated;

create function private.control_number(p_mutation jsonb,p_key text,p_min numeric,p_max numeric,p_scale integer) returns numeric language plpgsql immutable set search_path=public,private as $$
declare v numeric;
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'number' then raise exception 'NOV: Enter a number for %.',replace(p_key,'_',' '); end if;
  v:=(p_mutation->>p_key)::numeric;
  if v<p_min or v>p_max or v<>round(v,p_scale) then raise exception 'NOV: % must be between % and % with at most % decimals.',initcap(replace(p_key,'_',' ')),p_min,p_max,p_scale; end if;
  return v;
end $$;
revoke all on function private.control_number(jsonb,text,numeric,numeric,integer) from public,anon,authenticated;

create function private.control_context(p_company uuid,p_actor uuid,p_mutation jsonb,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_role text; v_row jsonb; v_drift jsonb; v_id uuid; v_num numeric; v_text text; v_warn jsonb:='[]'::jsonb;
  v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_source jsonb:='{}'::jsonb; t public.tasks%rowtype; r public.handoff_source_reconciliations%rowtype;
  f public.finishing_jobs%rowtype; v_custody jsonb; v_key text; v_val jsonb; v_allowed text[]; v_eff timestamptz; v_count integer;
begin
  perform private.control_assert_shape(p_mutation);
  select role into v_role from public.app_users where id=p_actor and company_id=p_company and is_active and dealer_id is null;
  if not private.control_action_allowed(v_role,a) then raise exception 'Not permitted' using errcode='42501'; end if;
  if a in ('facts.refresh','facts.keep','wip.observe') then
    v_id:=(p_mutation->>'job_id')::uuid;
    if p_lock then perform 1 from public.production_jobs where id=v_id and company_id=p_company for update; end if;
    select jsonb_build_object('id',j.id,'job_number',j.job_number,'status',j.status,'updated_at',j.updated_at,'order_number',o.order_number,'order_stage',o.current_stage)
      into v_row from public.production_jobs j join public.orders o on o.id=j.order_id and o.company_id=j.company_id where j.id=v_id and j.company_id=p_company and o.deleted_at is null;
    if v_row is null then raise exception 'NOV: The production job is unavailable.'; end if;
    v_source:=jsonb_build_object('job',v_row);
    if a like 'facts.%' then
      v_drift:=private.control_fact_drift(p_company,v_id);
      if v_drift->>'state' in ('unlinked','source_unavailable') then raise exception 'NOV: This job has no available order line to compare.'; end if;
      select coalesce(jsonb_agg(x),'[]'::jsonb) into v_val from jsonb_array_elements(v_drift->'fields') x where not (x->>'overridden')::boolean;
      if jsonb_array_length(v_val)=0 then raise exception 'NOV: The job already matches its order line or its differences are recorded.'; end if;
      if a='facts.refresh' and v_row->>'status' not in ('planned','ready') then raise exception 'NOV: Started or finished jobs keep the facts they were made with. Record the difference instead.'; end if;
      v_source:=v_source||jsonb_build_object('drift',v_val,'line_updated_at',v_drift->'line_updated_at');
      v_title:=case a when 'facts.refresh' then 'Refresh inherited job facts' else 'Record deliberate job differences' end;
      v_effect:=case a when 'facts.refresh' then 'Copies the current order-line values for the listed facts onto the unstarted job and keeps the previous values in history. Quantities, prices and status do not change.'
        else 'Keeps the job values and records why they differ from the current order line. A later line change shows again.' end;
      v_facts:=jsonb_build_object('Job',v_row->>'job_number','Order',v_row->>'order_number','Facts',(select string_agg(replace(x->>'field','_',' '),', ') from jsonb_array_elements(v_val) x));
    else
      if v_row->>'status' in ('planned','ready','cancelled') then raise exception 'NOV: Only started or unfinished material can be located.'; end if;
      select jsonb_build_object('id',id,'name',location_name,'type',location_type) into v_val from public.inventory_locations where id=(p_mutation->>'location_id')::uuid and company_id=p_company and is_active and dealer_id is null;
      if v_val is null then raise exception 'NOV: Choose an active factory location.'; end if;
      if p_mutation ? 'quantity_kg' then v_num:=private.control_number(p_mutation,'quantity_kg',0.001,1000000,3); end if;
      v_source:=v_source||jsonb_build_object('location',v_val);
      v_title:='Record observed WIP location'; v_effect:='Records where the material was seen. Processing status, stock and task ownership do not change.';
      v_facts:=jsonb_build_object('Job',v_row->>'job_number','Location',v_val->>'name','Quantity',coalesce(trim_scale(v_num)||' kg','not measured'));
    end if;
  elsif a='handoff.resolve' then
    if p_lock then perform 1 from public.handoff_source_reconciliations where id=(p_mutation->>'id')::uuid and company_id=p_company for update; end if;
    select * into r from public.handoff_source_reconciliations where id=(p_mutation->>'id')::uuid and company_id=p_company;
    if r.id is null then raise exception 'NOV: The source review is unavailable.'; end if;
    if r.status<>'open' then raise exception 'NOV: This source review is already resolved.'; end if;
    select * into t from public.tasks where id=r.task_id and company_id=p_company;
    if not (v_role in ('owner','admin','factory_manager') or v_role=any(private.handoff_team_roles(t.handoff_team))) then raise exception 'Not permitted' using errcode='42501'; end if;
    v_source:=jsonb_build_object('review',to_jsonb(r),'task_status',t.status,'task_quantity',t.handoff_quantity_kg,'source_quantity',private.handoff_source_quantity(t),'issues',private.handoff_acceptance_issues(t.id));
    v_title:='Resolve handoff source review'; v_effect:='Records the receiving team''s confirmation of the physical position. The task can then be completed or returned through its existing workflow.';
    v_facts:=jsonb_build_object('Handoff',t.title,'Previous kg',r.previous_quantity_kg,'Source kg',r.current_quantity_kg);
  elsif a='policy.set' then
    v_text:=upper(btrim(p_mutation->>'alloy'));
    if v_text !~ '^[A-Z0-9-]{2,20}$' then raise exception 'NOV: Enter the alloy as recorded on billets, such as 6063.'; end if;
    v_num:=private.control_number(p_mutation,'diameter_inch',0.5,30,3);
    perform private.control_number(p_mutation,'lead_days',0,365,0); perform private.control_number(p_mutation,'min_order_kg',0,10000000,3);
    perform private.control_number(p_mutation,'safety_stock_kg',0,10000000,3);
    if p_mutation ? 'pack_kg' then perform private.control_number(p_mutation,'pack_kg',0.001,10000000,3); end if;
    select coalesce(jsonb_build_object('revision',revision,'updated_at',updated_at),'{}'::jsonb) into v_val from public.procurement_policies where company_id=p_company and alloy=v_text and diameter_inch=v_num;
    v_source:=jsonb_build_object('policy',coalesce(v_val,'{}'::jsonb));
    v_title:='Set billet purchasing policy'; v_effect:='Applies to the next purchasing plan. Existing proposals keep the policy they were generated with.';
    v_facts:=jsonb_build_object('Material',v_text||' billet '||trim_scale(v_num)||' in','Lead days',p_mutation->'lead_days','Minimum kg',p_mutation->'min_order_kg','Safety stock kg',p_mutation->'safety_stock_kg','Pack kg',coalesce(p_mutation->'pack_kg','"none"'::jsonb));
  elsif a='supply.link' then
    v_text:=upper(btrim(p_mutation->>'alloy'));
    if v_text !~ '^[A-Z0-9-]{2,20}$' then raise exception 'NOV: Enter the alloy as recorded on billets, such as 6063.'; end if;
    v_num:=private.control_number(p_mutation,'diameter_inch',0.5,30,3);
    if p_lock then perform 1 from public.purchase_order_lines where id=(p_mutation->>'po_line_id')::uuid and company_id=p_company for update; end if;
    select jsonb_build_object('id',l.id,'po_number',po.po_number,'status',po.status,'unit',l.unit,'ordered',l.ordered_quantity,'description',l.description)
      into v_row from public.purchase_order_lines l join public.purchase_orders po on po.id=l.purchase_order_id and po.company_id=l.company_id where l.id=(p_mutation->>'po_line_id')::uuid and l.company_id=p_company;
    if v_row is null then raise exception 'NOV: The purchase order line is unavailable.'; end if;
    if lower(btrim(v_row->>'unit'))<>'kg' then raise exception 'NOV: Only purchase lines measured in kg can be netted against billet demand.'; end if;
    if exists(select 1 from public.procurement_supply_links where purchase_order_line_id=(v_row->>'id')::uuid) then raise exception 'NOV: This purchase line is already linked to a billet group.'; end if;
    v_source:=jsonb_build_object('line',v_row);
    v_title:='Link purchase line as billet supply'; v_effect:='Counts the unreceived kg of this purchase line as expected supply for the billet group. Draft orders remain tentative.';
    v_facts:=jsonb_build_object('Purchase order',v_row->>'po_number','Line',v_row->>'description','Group',v_text||' billet '||trim_scale(v_num)||' in');
  elsif a='plan.generate' then
    v_val:=private.control_billet_plan(p_company);
    select count(*) into v_count from public.procurement_plan_lines where company_id=p_company and state='proposed';
    v_source:=jsonb_build_object('plan',v_val,'open_proposals',v_count);
    v_title:='Generate billet purchasing plan';
    v_effect:='Creates a reviewable plan from current shortages, free stock and confirmed open supply. Open proposals from earlier plans become obsolete. No purchase order is created.';
    v_facts:=jsonb_build_object('Shortage groups',jsonb_array_length(v_val->'shortages'),'Covered groups',v_val->'covered_groups','Earlier proposals made obsolete',v_count);
    if jsonb_array_length(v_val->'shortages')=0 then v_warn:=v_warn||jsonb_build_array('No billet shortage needs purchasing now.'); end if;
  elsif a='plan.review' then
    if p_lock then perform 1 from public.procurement_plan_lines where id=(p_mutation->>'id')::uuid and company_id=p_company for update; end if;
    select jsonb_build_object('id',id,'state',state,'proposed_kg',proposed_kg,'alloy',alloy,'diameter',diameter_inch) into v_row from public.procurement_plan_lines where id=(p_mutation->>'id')::uuid and company_id=p_company;
    if v_row is null then raise exception 'NOV: The plan line is unavailable.'; end if;
    if v_row->>'state'<>'proposed' then raise exception 'NOV: Only a current proposal can be reviewed. Generate the plan again for current figures.'; end if;
    if p_mutation->>'decision' not in ('accepted','dismissed') then raise exception 'NOV: Choose accept or dismiss.'; end if;
    v_source:=jsonb_build_object('line',v_row);
    v_title:='Review purchasing proposal'; v_effect:=case p_mutation->>'decision' when 'accepted' then 'Marks the proposal as reviewed for purchasing. Raise the purchase order through the purchasing workflow.' else 'Dismisses the proposal with your reason.' end;
    v_facts:=jsonb_build_object('Group',(v_row->>'alloy')||' billet '||(v_row->>'diameter')||' in','Proposed kg',v_row->'proposed_kg','Decision',p_mutation->>'decision');
  elsif a in ('custody.explain','custody.reverse') then
    if a='custody.reverse' then
      select jsonb_build_object('id',id,'job',finishing_job_id,'reversed',reversed_at is not null,'kg',quantity_kg,'category',category,'recorded_by',recorded_by) into v_row from public.finishing_custody_adjustments where id=(p_mutation->>'id')::uuid and company_id=p_company;
      if v_row is null then raise exception 'NOV: The custody entry is unavailable.'; end if;
      if (v_row->>'reversed')::boolean then raise exception 'NOV: This custody entry is already reversed.'; end if;
      v_id:=(v_row->>'job')::uuid;
    else v_id:=(p_mutation->>'job_id')::uuid; end if;
    if p_lock then perform 1 from public.finishing_jobs where id=v_id and company_id=p_company for update; end if;
    select * into f from public.finishing_jobs where id=v_id and company_id=p_company;
    if f.id is null or f.vendor_id is null then raise exception 'NOV: The finishing vendor issue is unavailable.'; end if;
    v_custody:=private.control_custody(p_company,f.id);
    v_source:=jsonb_build_object('job',jsonb_build_object('id',f.id,'status',f.status,'issued',f.input_weight_kg,'output',f.output_weight_kg,'rejected',f.rejection_weight_kg,'updated_at',f.updated_at),'custody',v_custody,'entry',v_row);
    if a='custody.explain' then
      if f.status not in ('sent_to_vendor','in_process','received','completed','rejected') then raise exception 'NOV: Material has not been issued to the vendor.'; end if;
      if p_mutation->>'category' not in ('returned_unprocessed','process_loss','lost_claimed') then raise exception 'NOV: Choose how the difference is explained.'; end if;
      if p_mutation->>'category'<>'returned_unprocessed' and f.status in ('sent_to_vendor','in_process') then raise exception 'NOV: Loss can be explained only after the vendor receipt is recorded.'; end if;
      v_text:=btrim(p_mutation->>'evidence'); if length(v_text) not between 5 and 500 or v_text ~ '[[:cntrl:]]' then raise exception 'NOV: Describe the evidence in 5 to 500 characters.'; end if;
      v_num:=private.control_number(p_mutation,'quantity_kg',0.001,1000000,3);
      if v_num>(v_custody->>'unaccounted_kg')::numeric+0.0005 then raise exception 'NOV: Only % kg is not yet accounted for at this vendor.',trim_scale((v_custody->>'unaccounted_kg')::numeric); end if;
      v_title:='Explain vendor custody difference'; v_effect:='Records an explained movement against this vendor issue. It does not create stock, a charge or a supplier claim.';
      v_facts:=jsonb_build_object('Category',replace(p_mutation->>'category','_',' '),'Quantity',trim_scale(v_num)||' kg','Unaccounted before',trim_scale((v_custody->>'unaccounted_kg')::numeric)||' kg');
    else
      v_title:='Reverse custody explanation'; v_effect:='Keeps the original entry, marks it reversed and returns its quantity to the unaccounted balance.';
      v_facts:=jsonb_build_object('Category',replace(v_row->>'category','_',' '),'Quantity',(v_row->>'kg')||' kg');
    end if;
  elsif a='authority.publish' then
    if p_mutation->>'decision_type' not in ('overdue_dispatch','low_margin_quote') then raise exception 'NOV: Choose a supported decision.'; end if;
    if jsonb_typeof(p_mutation->'limits') is distinct from 'object' then raise exception 'NOV: Enter limits by role.'; end if;
    v_allowed:=case p_mutation->>'decision_type' when 'overdue_dispatch' then array['admin','accounts','sales_manager'] else array['admin','sales_manager'] end;
    for v_key,v_val in select * from jsonb_each(p_mutation->'limits') loop
      if not v_key=any(v_allowed) then raise exception 'NOV: % cannot carry an approval limit for this decision. Owners are never limited.',replace(v_key,'_',' '); end if;
      if jsonb_typeof(v_val) is distinct from 'number' or (v_val::text)::numeric<0 or (v_val::text)::numeric>1000000000000 or (v_val::text)::numeric<>round((v_val::text)::numeric,2) then
        raise exception 'NOV: Enter a non-negative limit with at most two decimals for %.',replace(v_key,'_',' '); end if;
    end loop;
    begin v_eff:=(p_mutation->>'effective_from')::timestamptz; exception when others then raise exception 'NOV: Choose a valid effective time.'; end;
    if p_mutation->>'effective_from' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'NOV: Choose a valid effective time.'; end if;
    if v_eff<now()-interval '5 minutes' or v_eff>now()+interval '90 days' then raise exception 'NOV: Limits take effect from now up to 90 days ahead; earlier decisions are not changed.'; end if;
    select coalesce(max(revision),0) into v_count from public.decision_authority_revisions where company_id=p_company and decision_type=p_mutation->>'decision_type';
    v_source:=jsonb_build_object('latest_revision',v_count,'policy',(select to_jsonb(ep)-'updated_at' from public.exception_policies ep where ep.company_id=p_company and ep.exception_type=p_mutation->>'decision_type'));
    v_title:='Publish decision authority'; v_effect:='Creates a new authority revision. Approvals after its effective time are checked against these limits; earlier decisions keep the revision they were made under.';
    v_facts:=jsonb_build_object('Decision',replace(p_mutation->>'decision_type','_',' '),'Revision',v_count+1,'Effective',to_char(v_eff at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI'),
      'Limits',coalesce((select string_agg(replace(k,'_',' ')||' '||v,'; ' order by k) from jsonb_each_text(p_mutation->'limits') x(k,v)),'none: existing policy only'));
    if v_source->'policy' is null or not coalesce((v_source->'policy'->>'is_active')::boolean,false) then v_warn:=v_warn||jsonb_build_array('The exception policy for this decision is not active, so nobody can approve it until it is enabled.'); end if;
  elsif a='contract.publish' then
    v_text:=p_mutation->>'task_kind';
    if v_text !~ '^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$' then raise exception 'NOV: Choose the kind of task.'; end if;
    if jsonb_typeof(p_mutation->'exclusive_source') is distinct from 'boolean' then raise exception 'NOV: Choose whether one source may complete only one task.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('seq',seq,'kind',kind,'label',label,'config',config) order by seq,id),'[]'::jsonb) into v_val
      from public.completion_criteria_templates where company_id=p_company and task_kind=v_text and is_active;
    if jsonb_array_length(v_val)=0 then raise exception 'NOV: Add at least one active completion criterion for this task kind first.'; end if;
    select coalesce(max(revision),0) into v_count from public.completion_contracts where company_id=p_company and task_kind=v_text;
    v_source:=jsonb_build_object('criteria',v_val,'latest_revision',v_count);
    v_title:='Publish definition of done'; v_effect:='Publishes the current active criteria as a numbered revision. New tasks of this kind are bound to it; existing tasks keep their own criteria and revision.';
    v_facts:=jsonb_build_object('Task kind',v_text,'Revision',v_count+1,'Criteria',jsonb_array_length(v_val),'One source per task',p_mutation->'exclusive_source');
  elsif a in ('rollout.classify','rollout.acknowledge') then
    if p_lock then perform 1 from public.procedure_rollouts where version_id=(p_mutation->>'version_id')::uuid and company_id=p_company for update; end if;
    select jsonb_build_object('version_id',v.id,'version_no',v.version_no,'status',v.status,'title',op.title,'change_class',ro.change_class,'summary',v.change_summary,
        'latest',not exists(select 1 from public.procedure_versions nv where nv.company_id=p_company and nv.procedure_id=v.procedure_id and nv.status='released' and nv.version_no>v.version_no))
      into v_row from public.procedure_rollouts ro join public.procedure_versions v on v.id=ro.version_id and v.company_id=ro.company_id
      join public.operating_procedures op on op.id=v.procedure_id and op.company_id=v.company_id where ro.version_id=(p_mutation->>'version_id')::uuid and ro.company_id=p_company;
    if v_row is null then raise exception 'NOV: The released instruction is unavailable.'; end if;
    if v_row->>'status'<>'released' then raise exception 'NOV: This instruction version is no longer released.'; end if;
    v_source:=jsonb_build_object('rollout',v_row);
    if a='rollout.classify' then
      if p_mutation->>'change_class' not in ('informational','acknowledgement_required') then raise exception 'NOV: Choose how this change is rolled out.'; end if;
      if not (v_row->>'latest')::boolean then raise exception 'NOV: A newer version has been released; classify that version instead.'; end if;
      if v_row->>'change_class'=p_mutation->>'change_class' then raise exception 'NOV: The rollout already uses this classification.'; end if;
      select count(distinct tk.assigned_to) into v_count from public.task_procedure_bindings tb join public.tasks tk on tk.id=tb.task_id
        where tb.company_id=p_company and tb.version_id=(v_row->>'version_id')::uuid and tk.status in ('open','in_progress') and tk.assigned_to is not null;
      v_title:='Classify instruction rollout';
      v_effect:=case p_mutation->>'change_class' when 'acknowledgement_required' then 'Employees must acknowledge this version before starting or completing tasks bound to it. Work bound to earlier versions is unaffected.'
        else 'Removes the acknowledgement requirement. Recorded acknowledgements are kept.' end;
      v_facts:=jsonb_build_object('Instruction',(v_row->>'title')||' v'||(v_row->>'version_no'),'Rollout',replace(p_mutation->>'change_class','_',' '),'Assigned employees affected',v_count);
    else
      if exists(select 1 from public.procedure_acknowledgements where company_id=p_company and version_id=(v_row->>'version_id')::uuid and employee_id=p_actor) then
        raise exception 'NOV: You have already acknowledged this version.'; end if;
      v_title:='Acknowledge instruction change'; v_effect:='Records that you have read the change summary for this released version.';
      v_facts:=jsonb_build_object('Instruction',(v_row->>'title')||' v'||(v_row->>'version_no'),'Change',left(v_row->>'summary',200));
    end if;
  else raise exception 'NOV: Choose a supported action.';
  end if;
  return jsonb_build_object('source',v_source,'review',jsonb_build_object('title',v_title,'effect',v_effect,'warnings',v_warn,'facts',v_facts));
end $$;
revoke all on function private.control_context(uuid,uuid,jsonb,boolean) from public,anon,authenticated;

create function private.control_apply(p_company uuid,p_actor uuid,p_request uuid,p_mutation jsonb,p_context jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; n text:=btrim(p_mutation->>'note'); v_id uuid; v_fields text[]; v_x jsonb; v_run uuid;
begin
  if a='facts.refresh' then
    v_id:=(p_mutation->>'job_id')::uuid;
    select array_agg(x->>'field') into v_fields from jsonb_array_elements(p_context->'source'->'drift') x;
    update public.production_jobs j set
      drawing_revision=case when 'drawing_revision'=any(v_fields) then i.drawing_revision else j.drawing_revision end,
      drawing_document_id=case when 'drawing_document_id'=any(v_fields) then i.drawing_document_id else j.drawing_document_id end,
      alloy_id=case when 'alloy_id'=any(v_fields) then i.alloy_id else j.alloy_id end,
      temper_id=case when 'temper_id'=any(v_fields) then i.temper_id else j.temper_id end,
      cut_length=case when 'cut_length'=any(v_fields) then i.cut_length else j.cut_length end,
      standard_length=case when 'standard_length'=any(v_fields) then i.standard_length else j.standard_length end,
      pieces_per_bundle=case when 'pieces_per_bundle'=any(v_fields) then i.pieces_per_bundle else j.pieces_per_bundle end,
      packing_instruction=case when 'packing_instruction'=any(v_fields) then i.packing_instruction else j.packing_instruction end,
      customer_packing_requirement=case when 'customer_packing_requirement'=any(v_fields) then i.customer_packing_requirement else j.customer_packing_requirement end,
      finishing_type=case when 'finishing_type'=any(v_fields) then i.finishing_type else j.finishing_type end,
      customer_component_code=case when 'customer_component_code'=any(v_fields) then i.customer_component_code else j.customer_component_code end,
      section_weight_kg_per_m=case when 'section_weight_kg_per_m'=any(v_fields) then i.section_weight_kg_per_m else j.section_weight_kg_per_m end
    from public.order_items i where j.id=v_id and j.company_id=p_company and i.id=j.source_line_id and i.company_id=j.company_id;
    perform private.control_record(p_company,'inheritance',v_id,a,p_actor,n,jsonb_build_object('fields',p_context->'source'->'drift'));
    return jsonb_build_object('label',p_context->'source'->'job'->>'job_number','href','/production/'||v_id,'message','Job facts now follow the current order line. Previous values are kept in history.');
  elsif a='facts.keep' then
    v_id:=(p_mutation->>'job_id')::uuid;
    for v_x in select * from jsonb_array_elements(p_context->'source'->'drift') loop
      insert into public.inherited_fact_overrides(company_id,production_job_id,field,line_value,reason,recorded_by)
      values(p_company,v_id,v_x->>'field',coalesce(v_x->'line_value','null'::jsonb),n,p_actor)
      on conflict(company_id,production_job_id,field) do update set line_value=excluded.line_value,reason=excluded.reason,recorded_by=excluded.recorded_by,recorded_at=now();
    end loop;
    perform private.control_record(p_company,'inheritance',v_id,a,p_actor,n,jsonb_build_object('fields',p_context->'source'->'drift'));
    return jsonb_build_object('label',p_context->'source'->'job'->>'job_number','href','/production/'||v_id,'message','Differences recorded as deliberate for the current order-line values.');
  elsif a='handoff.resolve' then
    v_id:=(p_mutation->>'id')::uuid;
    update public.handoff_source_reconciliations set status='resolved',resolved_by=p_actor,resolved_at=now(),resolution_note=n where id=v_id and status='open';
    if not found then raise exception 'NOV: This source review is already resolved.'; end if;
    perform private.control_record(p_company,'handoffs',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Source review resolved','href','/tasks/'||(p_context->'source'->'review'->>'task_id'),'message','The receiving team''s confirmation is recorded on the handoff.');
  elsif a='policy.set' then
    insert into public.procurement_policies(company_id,alloy,diameter_inch,lead_days,min_order_kg,pack_kg,safety_stock_kg,updated_by)
    values(p_company,upper(btrim(p_mutation->>'alloy')),(p_mutation->>'diameter_inch')::numeric,(p_mutation->>'lead_days')::integer,(p_mutation->>'min_order_kg')::numeric,
      nullif(p_mutation->>'pack_kg','')::numeric,(p_mutation->>'safety_stock_kg')::numeric,p_actor)
    on conflict(company_id,alloy,diameter_inch) do update set lead_days=excluded.lead_days,min_order_kg=excluded.min_order_kg,pack_kg=excluded.pack_kg,
      safety_stock_kg=excluded.safety_stock_kg,revision=procurement_policies.revision+1,updated_by=p_actor,updated_at=now() returning id into v_id;
    perform private.control_record(p_company,'procurement',v_id,a,p_actor,n,p_mutation-'action'-'note');
    return jsonb_build_object('label','Purchasing policy saved','href','/tasks/control/database?view=procurement','message','The next plan uses this policy.');
  elsif a='supply.link' then
    insert into public.procurement_supply_links(purchase_order_line_id,company_id,alloy,diameter_inch,linked_by)
    values((p_mutation->>'po_line_id')::uuid,p_company,upper(btrim(p_mutation->>'alloy')),(p_mutation->>'diameter_inch')::numeric,p_actor);
    perform private.control_record(p_company,'procurement',(p_mutation->>'po_line_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label',p_context->'source'->'line'->>'po_number','href','/vendors/purchasing','message','The purchase line now counts as billet supply in the next plan.');
  elsif a='plan.generate' then
    v_run:=p_request;
    insert into public.procurement_plan_runs(id,company_id,generated_by,basis) values(v_run,p_company,p_actor,jsonb_build_object('covered_groups',p_context->'source'->'plan'->'covered_groups','note',n));
    update public.procurement_plan_lines set state='obsolete',superseded_by_run=v_run where company_id=p_company and state='proposed';
    for v_x in select * from jsonb_array_elements(p_context->'source'->'plan'->'shortages') loop
      insert into public.procurement_plan_lines(company_id,run_id,alloy,diameter_inch,demand_kg,free_stock_kg,open_supply_kg,tentative_supply_kg,safety_stock_kg,net_shortage_kg,proposed_kg,need_by,order_by,demand,supply,warnings,policy)
      values(p_company,v_run,v_x->>'alloy',(v_x->>'diameter_inch')::numeric,(v_x->>'demand_kg')::numeric,(v_x->>'free_stock_kg')::numeric,(v_x->>'open_supply_kg')::numeric,
        (v_x->>'tentative_supply_kg')::numeric,(v_x->>'safety_stock_kg')::numeric,(v_x->>'net_shortage_kg')::numeric,(v_x->>'proposed_kg')::numeric,
        nullif(v_x->>'need_by','')::date,nullif(v_x->>'order_by','')::date,v_x->'demand',v_x->'supply',v_x->'warnings',nullif(v_x->'policy','null'::jsonb));
    end loop;
    perform private.control_record(p_company,'procurement',v_run,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Purchasing plan generated','href','/tasks/control/database?view=procurement','message',format('%s shortage proposal(s) ready for review.',jsonb_array_length(p_context->'source'->'plan'->'shortages')));
  elsif a='plan.review' then
    v_id:=(p_mutation->>'id')::uuid;
    update public.procurement_plan_lines set state=p_mutation->>'decision',reviewed_by=p_actor,reviewed_at=now(),review_note=n where id=v_id and state='proposed';
    if not found then raise exception 'NOV: Only a current proposal can be reviewed.'; end if;
    perform private.control_record(p_company,'procurement',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Proposal '||(p_mutation->>'decision'),'href','/tasks/control/procurement/'||v_id,'message',case p_mutation->>'decision' when 'accepted' then 'Raise the purchase order in purchasing.' else 'Proposal dismissed.' end);
  elsif a='wip.observe' then
    v_id:=(p_mutation->>'job_id')::uuid;
    insert into public.wip_location_observations(company_id,production_job_id,location_id,quantity_kg,note,observed_by)
    values(p_company,v_id,(p_mutation->>'location_id')::uuid,nullif(p_mutation->>'quantity_kg','')::numeric,n,p_actor);
    perform private.control_record(p_company,'wip',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label',p_context->'source'->'job'->>'job_number','href','/tasks/control/wip/'||v_id,'message','Observed location recorded.');
  elsif a='custody.explain' then
    insert into public.finishing_custody_adjustments(company_id,finishing_job_id,category,quantity_kg,evidence,recorded_by)
    values(p_company,(p_mutation->>'job_id')::uuid,p_mutation->>'category',(p_mutation->>'quantity_kg')::numeric,btrim(p_mutation->>'evidence'),p_actor) returning id into v_id;
    perform private.control_record(p_company,'custody',(p_mutation->>'job_id')::uuid,a,p_actor,n,p_context->'review'->'facts'||jsonb_build_object('entry_id',v_id));
    return jsonb_build_object('label','Custody explained','href','/tasks/control/custody/'||(p_mutation->>'job_id'),'message','The vendor balance now includes this explanation.');
  elsif a='custody.reverse' then
    update public.finishing_custody_adjustments set reversed_at=now(),reversed_by=p_actor,reverse_note=n where id=(p_mutation->>'id')::uuid and reversed_at is null;
    if not found then raise exception 'NOV: This custody entry is already reversed.'; end if;
    perform private.control_record(p_company,'custody',(p_context->'source'->'job'->>'id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Custody entry reversed','href','/tasks/control/custody/'||(p_context->'source'->'job'->>'id'),'message','The quantity is unaccounted again.');
  elsif a='authority.publish' then
    v_id:=p_request;
    insert into public.decision_authority_revisions(id,company_id,decision_type,revision,limits,effective_from,published_by,note)
    values(v_id,p_company,p_mutation->>'decision_type',(p_context->'source'->>'latest_revision')::integer+1,p_mutation->'limits',(p_mutation->>'effective_from')::timestamptz,p_actor,n);
    perform private.control_record(p_company,'authority',md5(p_company::text||':authority:'||(p_mutation->>'decision_type'))::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Authority revision published','href','/tasks/control/database?view=authority','message','Approvals after the effective time are checked against these limits.');
  elsif a='contract.publish' then
    insert into public.completion_contracts(id,company_id,task_kind,revision,criteria,exclusive_source,published_by,note)
    values(p_request,p_company,p_mutation->>'task_kind',(p_context->'source'->>'latest_revision')::integer+1,p_context->'source'->'criteria',(p_mutation->>'exclusive_source')::boolean,p_actor,n);
    perform private.control_record(p_company,'contracts',md5(p_company::text||':contract:'||(p_mutation->>'task_kind'))::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Definition of done published','href','/tasks/control/database?view=contracts','message','New tasks of this kind are bound to the published revision.');
  elsif a='rollout.classify' then
    update public.procedure_rollouts set change_class=p_mutation->>'change_class',classified_by=p_actor,classified_at=now() where version_id=(p_mutation->>'version_id')::uuid and company_id=p_company;
    perform private.control_record(p_company,'rollouts',(p_mutation->>'version_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Rollout classified','href','/tasks/control/rollouts/'||(p_mutation->>'version_id'),'message','Rollout requirement recorded.');
  elsif a='rollout.acknowledge' then
    insert into public.procedure_acknowledgements(company_id,version_id,employee_id,note) values(p_company,(p_mutation->>'version_id')::uuid,p_actor,n);
    perform private.control_record(p_company,'rollouts',(p_mutation->>'version_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Instruction acknowledged','href','/tasks/control/rollouts/'||(p_mutation->>'version_id'),'message','Your acknowledgement is recorded.');
  end if;
  raise exception 'NOV: Choose a supported action.';
end $$;
revoke all on function private.control_apply(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

create function private.control_outcome(r public.control_requests) returns jsonb language sql immutable set search_path=public,private as $$
  select jsonb_build_object('request_id',r.request_id,'state',r.state,'fingerprint',r.fingerprint,'expires_at',r.expires_at,'action',r.mutation->>'action','review',r.review,'result',r.result)
$$;
revoke all on function private.control_outcome(public.control_requests) from public,anon,authenticated;

create function public.control_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid();v_company uuid:=private.get_current_user_company_id();v_role text:=private.get_current_user_role();
  v_view text;v_page integer;v_search text;v_state text;v_sort text;v_status text;v_id uuid;v_total bigint;v_rows jsonb;v_row jsonb;v_events jsonb;
  r public.control_requests%rowtype;v_context jsonb;v_fingerprint text;v_result jsonb;v_message text;v_keys text[];
begin
  if v_actor is null or v_company is null or not exists(select 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null)
    or not private.control_read_allowed(v_role,'ledger') then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.app_users where id=v_actor and company_id=v_company for share;
  v_keys:=case p_command when 'list' then array['view','page','search','state','sort','status'] when 'detail' then array['view','id','page']
    when 'lookup' then array['kind','search','selected_id'] when 'preview' then array['request_id','mutation'] when 'commit' then array['request_id','fingerprint']
    when 'outcome' then array['request_id'] when 'abandon' then array['request_id'] end;
  if jsonb_typeof(p_payload) is distinct from 'object' or v_keys is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(v_keys))) then raise exception 'NOV: Invalid control request.'; end if;
  if p_command in ('list','detail') then
    v_view:=p_payload->>'view';v_page:=coalesce((p_payload->>'page')::integer,1);v_search:=btrim(coalesce(p_payload->>'search',''));
    v_state:=coalesce(p_payload->>'state','active');v_sort:=coalesce(p_payload->>'sort','priority');v_status:=nullif(btrim(coalesce(p_payload->>'status','')),'');
    if not private.control_read_allowed(v_role,v_view) then raise exception 'Not permitted' using errcode='42501'; end if;
    if v_page not between 1 and 100000 or length(v_search)>80 or v_state not in ('active','all') or v_sort not in ('priority','newest','due') or coalesce(v_status,'x') !~ '^[a-z_]{1,40}$' then raise exception 'NOV: Invalid control filters.'; end if;
    if p_command='detail' then
      v_id:=(p_payload->>'id')::uuid;
      if v_id is null then raise exception 'NOV: Choose a record.'; end if;
      select row_data into v_row from private.control_rows(v_company,v_actor,v_role,v_view,'all',v_id) limit 1;
      if v_row is null then raise exception 'NOV: This record is unavailable.'; end if;
      select count(*) into v_total from public.control_events where company_id=v_company and view_name=v_view and entity_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(x) order by recorded_at desc,id),'[]'::jsonb) into v_events from (
        select id,action,actor_name as actor,note,recorded_at from public.control_events where company_id=v_company and view_name=v_view and entity_id=v_id order by recorded_at desc,id limit 10 offset (v_page-1)*10
      ) x;
      return jsonb_build_object('row',v_row,'events',v_events,'event_count',v_total,'as_of',now());
    end if;
    with visible as (select * from private.control_rows(v_company,v_actor,v_role,v_view,v_state,null) where (v_status is null or row_data->>'status'=v_status)
      and (v_search='' or position(lower(v_search) in lower(coalesce(row_data->>'label','')||' '||coalesce(row_data->>'status','')||' '||coalesce(row_data->>'owner','')||' '||coalesce(row_data->>'summary','')))>0))
    select (select count(*) from visible),coalesce((select jsonb_agg(x.row_data order by x.position) from (
      select row_data,row_number() over(order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id')) as position
      from visible order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id') limit 10 offset (v_page-1)*10
    ) x),'[]'::jsonb) into v_total,v_rows;
    return jsonb_build_object('rows',v_rows,'total_count',v_total,'as_of',now());
  elsif p_command='lookup' then
    v_search:=btrim(coalesce(p_payload->>'search',''));v_id:=nullif(p_payload->>'selected_id','')::uuid;
    if length(v_search)>80 then raise exception 'NOV: Keep search within 80 characters.'; end if;
    if p_payload->>'kind'='locations' then
      select coalesce(jsonb_agg(to_jsonb(x) order by label,value),'[]'::jsonb) into v_rows from (
        select id as value,location_name as label,concat(location_code,' · ',replace(location_type,'_',' ')) as context from public.inventory_locations where company_id=v_company and is_active and dealer_id is null
        and ((v_id is not null and id=v_id) or (v_id is null and position(lower(v_search) in lower(location_name||' '||location_code))>0)) order by location_name,id limit 20) x;
    elsif p_payload->>'kind'='po_lines' then
      if not private.control_read_allowed(v_role,'procurement') then raise exception 'Not permitted' using errcode='42501'; end if;
      select coalesce(jsonb_agg(to_jsonb(x) order by label,value),'[]'::jsonb) into v_rows from (
        select l.id as value,concat(po.po_number,' · line ',l.line_number) as label,concat(left(l.description,60),' · ',trim_scale(l.ordered_quantity),' ',l.unit,' · ',po.status) as context
        from public.purchase_order_lines l join public.purchase_orders po on po.id=l.purchase_order_id and po.company_id=l.company_id
        where l.company_id=v_company and not exists(select 1 from public.procurement_supply_links s where s.purchase_order_line_id=l.id)
        and ((v_id is not null and l.id=v_id) or (v_id is null and position(lower(v_search) in lower(po.po_number||' '||l.description))>0)) order by po.po_number,l.line_number limit 20) x;
    elsif p_payload->>'kind'='task_kinds' then
      select coalesce(jsonb_agg(to_jsonb(x) order by label),'[]'::jsonb) into v_rows from (
        select md5(task_kind)::uuid as value,task_kind as label,concat(count(*),' active criteria') as context from public.completion_criteria_templates
        where company_id=v_company and is_active and position(lower(v_search) in lower(task_kind))>0 group by task_kind order by task_kind limit 20) x;
    else raise exception 'NOV: Choose a supported lookup.'; end if;
    return v_rows;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':control',0));
  v_id:=(p_payload->>'request_id')::uuid;
  if v_id is null then raise exception 'NOV: An original request identity is required.'; end if;
  select * into r from public.control_requests where request_id=v_id for update;
  if found and (r.company_id<>v_company or r.actor_id<>v_actor) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_command='preview' then
    if r.request_id is not null then
      if r.mutation is distinct from p_payload->'mutation' then raise exception 'NOV: This request identity belongs to different details.'; end if;
      if not private.control_action_allowed(v_role,r.mutation->>'action') then raise exception 'Not permitted' using errcode='42501'; end if;
      return private.control_outcome(r);
    end if;
    v_context:=private.control_context(v_company,v_actor,p_payload->'mutation',false);
    v_fingerprint:=md5((v_context->'source')::text||(p_payload->'mutation')::text);
    insert into public.control_requests(request_id,company_id,actor_id,mutation,fingerprint,review)
      values(v_id,v_company,v_actor,p_payload->'mutation',v_fingerprint,v_context->'review') returning * into r;
  else
    if r.request_id is null then
      if p_command in ('outcome','abandon') then return jsonb_build_object('request_id',v_id,'state','not_recorded','fingerprint',repeat('0',32),'expires_at',now(),'action','',
        'review',jsonb_build_object('title','Original request check','effect','No prepared or committed action exists for this original request.','warnings','[]'::jsonb,'facts','{}'::jsonb),
        'result',jsonb_build_object('label','Not recorded','href',null,'message','No operational change was committed with this original request identity. It is safe to start a reviewed action.')); end if;
      raise exception 'NOV: The original request was not found. No action was committed with that request identity.';
    end if;
    if (p_command='commit' and not private.control_action_allowed(v_role,r.mutation->>'action'))
      or (p_command in ('outcome','abandon') and not private.control_read_allowed(v_role,private.control_view(r.mutation->>'action'))) then raise exception 'Not permitted' using errcode='42501'; end if;
    if p_command='commit' and r.state='prepared' then
      if r.fingerprint is distinct from p_payload->>'fingerprint' then raise exception 'NOV: Confirmation does not match the reviewed request.'; end if;
      begin
        if r.expires_at<=now() then raise exception 'NOV: This review expired. Review the current source again.'; end if;
        v_context:=private.control_context(v_company,v_actor,r.mutation,true);
        if r.fingerprint<>md5((v_context->'source')::text||r.mutation::text) then raise exception 'NOV: A relevant source changed. Review the current details again.'; end if;
        v_result:=private.control_apply(v_company,v_actor,v_id,r.mutation,v_context);
        update public.control_requests set state='confirmed',result=v_result where request_id=v_id returning * into r;
      exception when others then
        v_message:=case when sqlstate='P0001' and sqlerrm like 'NOV: %' then substring(sqlerrm from 6)
          when sqlstate='23514' and sqlerrm not like '%violates%' then sqlerrm
          else 'The existing workflow rejected this action. No change from this request was committed. Refresh the source and review its current requirements.' end;
        update public.control_requests set state='rejected',result=jsonb_build_object('label',r.review->>'title','href',null,'message',v_message) where request_id=v_id returning * into r;
      end;
    elsif p_command='abandon' and r.state='prepared' then
      update public.control_requests set state='abandoned',result=jsonb_build_object('label',r.review->>'title','href',null,'message','Review cancelled. This request made no operational change.') where request_id=v_id returning * into r;
    elsif p_command not in ('commit','outcome','abandon') then raise exception 'NOV: Invalid control request.';
    end if;
  end if;
  return private.control_outcome(r);
end $$;
revoke all on function public.control_command(text,jsonb) from public,anon;
grant execute on function public.control_command(text,jsonb) to authenticated;

-- NOV-005: the order page reads the same ledger through a narrow, read-only entry point.
create function public.order_fulfilment_ledger(p_order_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare c uuid;
begin
  c:=private.commercial_actor(array['owner','admin','sales','sales_manager','production_manager','production','factory_manager','inventory_manager','dispatch_manager','dispatch','quality','accounts','viewer']);
  perform 1 from public.orders where id=p_order_id and company_id=c and deleted_at is null;
  if not found then raise exception 'Order is unavailable'; end if;
  return private.control_order_ledger(c,p_order_id)||jsonb_build_object('as_of',now(),'order_id',p_order_id);
end $$;
revoke all on function public.order_fulfilment_ledger(uuid) from public,anon;
grant execute on function public.order_fulfilment_ledger(uuid) to authenticated;

commit;
