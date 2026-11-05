-- November batch 8: delivery appointments and site readiness (NOV-075), returnable gate passes (NOV-077),
-- workflow progress (NOV-087), small queue updates (NOV-014), documents and messages beside the transaction
-- (NOV-019), multi-order vehicle load plans (NOV-036), a protected execution window (NOV-044), advisory
-- stage WIP limits (NOV-045), capacity-aware assignment (NOV-047) and approved workflow routes (NOV-052).
-- Consequential actions use the reviewed request protocol of batches 3 to 7. Additive; depends only on the
-- batch 5 helpers (private.assurance_text/number/date/instant) and the batch 4 WIP stage function
-- (private.control_wip_stage), all present on hosted.

------------------------------------------------------------------------------------------------
-- Tenant keys and lookup indexes.
------------------------------------------------------------------------------------------------
create unique index if not exists coordination_user_tenant_key on public.app_users(company_id,id);
create unique index if not exists lifecycle_die_tenant_key on public.dies(company_id,id);
create unique index if not exists execution_order_tenant_key on public.orders(company_id,id);
create unique index if not exists execution_dispatch_tenant_key on public.dispatches(company_id,id);
create unique index if not exists execution_task_tenant_key on public.tasks(company_id,id);
create unique index if not exists execution_job_tenant_key on public.production_jobs(company_id,id);
create unique index if not exists execution_load_tenant_key on public.factory_vehicle_loads(company_id,id);
create unique index if not exists execution_load_item_tenant_key on public.factory_vehicle_load_items(company_id,id);
create index if not exists execution_task_open_idx on public.tasks(company_id,assigned_to,status) where status in ('open','in_progress');
create index if not exists execution_job_window_idx on public.production_jobs(company_id,planned_date) where status in ('planned','ready','on_hold');
create index if not exists execution_history_order_idx on public.order_stage_history(company_id,order_id,changed_at);

------------------------------------------------------------------------------------------------
-- NOV-075: a requested slot, a customer-confirmed appointment and the actual arrival are different
-- facts. Every reviewed revision is retained; earlier commitments are never rewritten.
------------------------------------------------------------------------------------------------
create table public.delivery_appointments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  order_id uuid not null, dispatch_id uuid,
  status text not null default 'requested' check(status in ('requested','confirmed','cancelled','arrived','completed','unloading_failed','missed')),
  requested_start timestamptz not null, requested_end timestamptz not null, confirmed_start timestamptz, confirmed_end timestamptz, confirmed_by_name text,
  site_address text not null, site_revision integer not null default 1, contact_name text, contact_phone text, access_restrictions text, preparations text,
  follow_up_owner uuid not null, revision integer not null default 1, changed_after_confirmation boolean not null default false,
  arrived_at timestamptz, outcome_note text, created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check(requested_end>requested_start and requested_end<=requested_start+interval '48 hours'),
  check(confirmed_end is null or (confirmed_start is not null and confirmed_end>confirmed_start and confirmed_end<=confirmed_start+interval '48 hours')),
  check(status not in ('confirmed','arrived','completed','unloading_failed') or confirmed_start is not null),
  foreign key(company_id,order_id) references public.orders(company_id,id), foreign key(company_id,dispatch_id) references public.dispatches(company_id,id),
  foreign key(company_id,follow_up_owner) references public.app_users(company_id,id), foreign key(company_id,created_by) references public.app_users(company_id,id)
);
create index delivery_appointments_order_idx on public.delivery_appointments(company_id,order_id,status);
create index delivery_appointments_slot_idx on public.delivery_appointments(company_id,coalesce(confirmed_start,requested_start)) where status in ('requested','confirmed','arrived');
create unique index delivery_appointments_one_open on public.delivery_appointments(company_id,dispatch_id) where dispatch_id is not null and status in ('requested','confirmed','arrived');
create table public.delivery_appointment_revisions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), appointment_id uuid not null references public.delivery_appointments(id),
  revision integer not null, snapshot jsonb not null, reason text not null, recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  unique(appointment_id,revision)
);

------------------------------------------------------------------------------------------------
-- NOV-077: returnable custody. A die or serialised asset has exactly one open pass; quantity-based
-- returnables keep a balance (issued, returned, lost).
------------------------------------------------------------------------------------------------
create table public.returnable_gate_passes (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), pass_number text not null,
  item_kind text not null check(item_kind in ('die','gauge','rack','pallet','other')), die_id uuid, item_label text not null check(length(item_label) between 2 and 120),
  serial_ref text check(serial_ref is null or length(serial_ref) between 1 and 60),
  quantity integer not null check(quantity between 1 and 10000), returned_quantity integer not null default 0 check(returned_quantity>=0),
  damaged_quantity integer not null default 0 check(damaged_quantity>=0), lost_quantity integer not null default 0 check(lost_quantity>=0),
  custodian_name text not null check(length(custodian_name) between 2 and 120), custodian_kind text not null check(custodian_kind in ('vendor','customer','employee','other')),
  purpose text not null check(length(purpose) between 5 and 300), due_date date not null, original_due_date date not null, extension_count integer not null default 0 check(extension_count between 0 and 3),
  follow_up_owner uuid not null, status text not null default 'approved' check(status in ('approved','out','closed','cancelled')),
  departed_at timestamptz, acknowledged_by_name text, acknowledged_at timestamptz, closed_at timestamptz, close_note text,
  issued_by uuid not null, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check(returned_quantity+lost_quantity<=quantity and damaged_quantity<=returned_quantity),
  check((item_kind='die')=(die_id is not null)), check(item_kind<>'die' or quantity=1), check(serial_ref is null or quantity=1),
  unique(company_id,pass_number), foreign key(company_id,die_id) references public.dies(company_id,id),
  foreign key(company_id,follow_up_owner) references public.app_users(company_id,id), foreign key(company_id,issued_by) references public.app_users(company_id,id)
);
create unique index returnable_gate_passes_one_die on public.returnable_gate_passes(company_id,die_id) where die_id is not null and status in ('approved','out');
create unique index returnable_gate_passes_one_serial on public.returnable_gate_passes(company_id,item_kind,lower(serial_ref)) where serial_ref is not null and status in ('approved','out');
create index returnable_gate_passes_open_idx on public.returnable_gate_passes(company_id,status,due_date);
create table public.gate_pass_returns (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), pass_id uuid not null references public.returnable_gate_passes(id),
  quantity integer not null check(quantity>0), condition text not null check(condition in ('good','damaged')), note text, received_by uuid not null, recorded_at timestamptz not null default clock_timestamp()
);
create index gate_pass_returns_pass_idx on public.gate_pass_returns(company_id,pass_id,recorded_at);

------------------------------------------------------------------------------------------------
-- NOV-036: stop sequence and loading confirmation over the existing reviewed vehicle loads.
-- The existing unique active-bundle index already prevents one bundle sitting in two loads.
------------------------------------------------------------------------------------------------
create table public.load_plan_stops (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), load_id uuid not null, order_id uuid not null,
  stop_seq integer not null check(stop_seq between 1 and 20), unload_note text, set_by uuid not null, set_at timestamptz not null default clock_timestamp(),
  unique(load_id,order_id), foreign key(company_id,load_id) references public.factory_vehicle_loads(company_id,id), foreign key(company_id,order_id) references public.orders(company_id,id)
);
create table public.load_item_confirmations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), load_id uuid not null, item_id uuid not null,
  status text not null check(status in ('loaded','not_loaded','unloaded_exception')), method text not null check(method in ('scan','manual')), note text,
  confirmed_by uuid not null, confirmed_at timestamptz not null default clock_timestamp(), unique(item_id),
  foreign key(company_id,load_id) references public.factory_vehicle_loads(company_id,id), foreign key(company_id,item_id) references public.factory_vehicle_load_items(company_id,id)
);
create table public.load_plan_reviews (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), load_id uuid not null, outcome text not null check(outcome in ('ready','not_ready')),
  findings jsonb not null, loaded_kg numeric(14,3) not null, capacity_kg numeric(14,3) not null, reviewed_by uuid not null, reviewed_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,load_id) references public.factory_vehicle_loads(company_id,id)
);
create index load_plan_reviews_load_idx on public.load_plan_reviews(company_id,load_id,reviewed_at desc);

------------------------------------------------------------------------------------------------
-- NOV-044: the protected window is a reviewed policy; a change inside it is requested with a reason
-- and applied by a second person against the schedule version that was reviewed.
------------------------------------------------------------------------------------------------
create table public.execution_windows (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), machine_id uuid,
  horizon_hours integer not null check(horizon_hours between 12 and 168), enforce boolean not null default false, reason text not null,
  status text not null default 'active' check(status in ('active','retired')), created_by uuid not null, created_at timestamptz not null default clock_timestamp(), retired_at timestamptz, retired_by uuid
);
create unique index execution_windows_one_active on public.execution_windows(company_id,coalesce(machine_id,'00000000-0000-0000-0000-000000000000'::uuid)) where status='active';
create table public.execution_window_changes (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), job_id uuid not null, previous_date date not null, previous_shift text,
  new_date date not null, new_shift text, reason text not null, customer_effect text not null, job_version timestamptz not null, impact jsonb not null,
  status text not null default 'requested' check(status in ('requested','applied','rejected')), requested_by uuid not null, requested_at timestamptz not null default clock_timestamp(),
  decided_by uuid, decided_at timestamptz, decision_note text, foreign key(company_id,job_id) references public.production_jobs(company_id,id)
);
create unique index execution_window_changes_one_open on public.execution_window_changes(company_id,job_id) where status='requested';
create index execution_window_changes_idx on public.execution_window_changes(company_id,status,requested_at desc);

------------------------------------------------------------------------------------------------
-- NOV-045: advisory limits per stage in one stated unit. Counts of jobs and kg are never mixed.
------------------------------------------------------------------------------------------------
create table public.stage_wip_limits (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  stage text not null check(stage in ('at_press','at_vendor','awaiting_finishing','awaiting_qc','awaiting_packing','on_hold')),
  unit text not null check(unit in ('kg','jobs')), limit_value numeric(14,3) not null check(limit_value>0), basis text not null check(length(basis) between 5 and 300),
  status text not null default 'active' check(status in ('active','retired')), created_by uuid not null, created_at timestamptz not null default clock_timestamp(), retired_at timestamptz, retired_by uuid
);
create unique index stage_wip_limits_one_active on public.stage_wip_limits(company_id,stage) where status='active';
create table public.wip_release_decisions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), job_id uuid not null, stage text not null, unit text not null,
  wip_value numeric(14,3) not null, limit_value numeric(14,3) not null, reason text not null, decided_by uuid not null, decided_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,job_id) references public.production_jobs(company_id,id)
);
create index wip_release_decisions_idx on public.wip_release_decisions(company_id,stage,decided_at desc);

------------------------------------------------------------------------------------------------
-- NOV-047: hard eligibility (role, competency) is separate from soft signals (availability, load).
------------------------------------------------------------------------------------------------
create table public.assignment_rules (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), task_type text not null check(task_type ~ '^[a-z0-9_]{2,40}$'),
  allowed_roles text[] not null check(cardinality(allowed_roles) between 1 and 12), required_competency_id uuid, estimate_minutes integer check(estimate_minutes is null or estimate_minutes between 1 and 1440),
  status text not null default 'active' check(status in ('active','retired')), created_by uuid not null, created_at timestamptz not null default clock_timestamp(), retired_at timestamptz, retired_by uuid
);
create unique index assignment_rules_one_active on public.assignment_rules(company_id,task_type) where status='active';
create table public.employee_unavailability (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), employee_id uuid not null, starts_on date not null, ends_on date not null,
  kind text not null check(kind in ('leave','training','off_shift','other')), recorded_by uuid not null, created_at timestamptz not null default clock_timestamp(), cancelled_at timestamptz, cancelled_by uuid,
  check(ends_on>=starts_on and ends_on<=starts_on+90), foreign key(company_id,employee_id) references public.app_users(company_id,id)
);
create index employee_unavailability_idx on public.employee_unavailability(company_id,employee_id,starts_on) where cancelled_at is null;
create table public.task_assignment_decisions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), task_id uuid not null, assignee_id uuid not null, previous_assignee uuid,
  eligibility jsonb not null, override_reason text, source text not null check(source in ('assignment','queue')), decided_by uuid not null, decided_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,task_id) references public.tasks(company_id,id)
);
create index task_assignment_decisions_idx on public.task_assignment_decisions(company_id,task_id,decided_at desc);

------------------------------------------------------------------------------------------------
-- NOV-052: approved route families. An omitted stage has a recorded policy reason; core stages
-- (confirmation, packing, dispatch) are never omitted by a route or a deviation.
------------------------------------------------------------------------------------------------
create table public.route_families (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), code text not null check(code ~ '^[a-z0-9_]{3,30}$'), name text not null check(length(name) between 3 and 80),
  version integer not null check(version>0), applies_when text not null check(length(applies_when) between 5 and 300), required_stages text[] not null, optional_stages text[] not null default '{}',
  status text not null default 'draft' check(status in ('draft','approved','retired')), created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
  approved_by uuid, approved_at timestamptz, retired_at timestamptz, unique(company_id,code,version), check(approved_by is null or approved_by<>created_by)
);
create unique index route_families_one_approved on public.route_families(company_id,code) where status='approved';
create table public.order_route_bindings (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), order_id uuid not null, family_id uuid not null references public.route_families(id),
  family_code text not null, family_version integer not null, reason text, status text not null default 'active' check(status in ('active','superseded')), bound_by uuid not null,
  bound_at timestamptz not null default clock_timestamp(), superseded_at timestamptz, foreign key(company_id,order_id) references public.orders(company_id,id)
);
create unique index order_route_bindings_one_active on public.order_route_bindings(company_id,order_id) where status='active';
create table public.order_route_deviations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), binding_id uuid not null references public.order_route_bindings(id), order_id uuid not null,
  stage text not null, reason text not null, status text not null default 'requested' check(status in ('requested','approved','rejected')), requested_by uuid not null,
  created_at timestamptz not null default clock_timestamp(), decided_by uuid, decided_at timestamptz, decision_note text, unique(binding_id,stage),
  foreign key(company_id,order_id) references public.orders(company_id,id)
);

------------------------------------------------------------------------------------------------
-- NOV-019: a prepared message is not a sent message. The only states are the ones this system can
-- actually observe: prepared, copied, printed, downloaded.
------------------------------------------------------------------------------------------------
create table public.document_communications (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  template text not null check(template in ('order_confirmation','dispatch_notice','appointment_notice')), entity_type text not null check(entity_type in ('order','dispatch','appointment')), entity_id uuid not null,
  customer_id uuid, recipient_name text not null, recipient_phone text not null check(recipient_phone ~ '^\+91[6-9][0-9]{9}$'), recipient_source text not null check(recipient_source in ('customer_whatsapp','customer_phone','entered')),
  message_body text not null check(length(message_body) between 10 and 1500), document_label text, document_href text, source_fingerprint text not null check(source_fingerprint ~ '^[0-9a-f]{32}$'),
  state text not null default 'prepared' check(state in ('prepared','copied','printed','downloaded','cancelled','superseded')), state_changed_at timestamptz not null default clock_timestamp(), state_changed_by uuid,
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(), foreign key(company_id,created_by) references public.app_users(company_id,id)
);
create index document_communications_entity_idx on public.document_communications(company_id,entity_type,entity_id,created_at desc);
create unique index document_communications_one_prepared on public.document_communications(company_id,template,entity_id) where state='prepared';

------------------------------------------------------------------------------------------------
-- Shared request identity, history and role matrix.
------------------------------------------------------------------------------------------------
create table public.execution_requests (
  request_id uuid primary key, company_id uuid not null references public.companies(id), actor_id uuid not null,
  mutation jsonb not null, fingerprint text not null, review jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','confirmed','rejected','abandoned')),
  result jsonb, expires_at timestamptz not null default now()+interval '15 minutes', created_at timestamptz not null default now(),
  foreign key(company_id,actor_id) references public.app_users(company_id,id), check((state='prepared')=(result is null))
);
create index execution_requests_actor_idx on public.execution_requests(company_id,actor_id,created_at desc);
create table public.execution_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  view_name text not null, entity_id uuid not null, action text not null, actor_id uuid, actor_name text not null,
  note text not null, facts jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create index execution_events_entity_idx on public.execution_events(company_id,view_name,entity_id,recorded_at desc,id);

create function private.execution_view(p_action text) returns text language sql immutable set search_path=public,private as $$
  select case split_part(p_action,'.',1) when 'appointment' then 'appointments' when 'gatepass' then 'gate_passes' when 'loadplan' then 'loads' when 'window' then 'windows' when 'wip' then 'wip'
    when 'rule' then 'rules' when 'availability' then 'rules' when 'assignment' then 'assignments' when 'route' then 'routes' when 'message' then 'messages' when 'queue' then 'queue' end
$$;
create function private.execution_read_allowed(p_role text,p_view text) returns boolean language sql immutable set search_path=public,private as $$
  select coalesce(case
    when p_role not in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer') then false
    when p_view is null or p_view in ('progress','routes') then true
    when p_view='appointments' then p_role in ('owner','admin','factory_manager','dispatch_manager','dispatch','sales_manager','sales','inventory_manager','production_manager','viewer')
    when p_view='gate_passes' then p_role in ('owner','admin','factory_manager','production_manager','production','quality','inventory_manager','dispatch_manager','dispatch','viewer')
    when p_view='loads' then p_role in ('owner','admin','factory_manager','dispatch_manager','dispatch','inventory_manager','production_manager','viewer')
    when p_view in ('windows','wip') then p_role in ('owner','admin','factory_manager','production_manager','production','quality','dispatch_manager','inventory_manager','viewer')
    when p_view in ('assignments','rules','queue') then p_role in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager','inventory_manager','sales_manager')
    when p_view='messages' then p_role in ('owner','admin','factory_manager','sales_manager','sales','accounts','dispatch_manager','dispatch')
    else false end,false)
$$;
create function private.execution_action_allowed(p_role text,p_action text) returns boolean language sql immutable set search_path=public,private as $$
  select private.execution_view(p_action) is not null and private.execution_read_allowed(p_role,private.execution_view(p_action)) and p_role<>'viewer' and coalesce(case
    when p_action like 'appointment.%' then p_role in ('owner','admin','factory_manager','dispatch_manager','dispatch','sales_manager','sales')
    when p_action='gatepass.return' then p_role in ('owner','admin','factory_manager','production_manager','inventory_manager','dispatch_manager','quality')
    when p_action like 'gatepass.%' then p_role in ('owner','admin','factory_manager','production_manager','inventory_manager','dispatch_manager')
    when p_action like 'loadplan.%' then p_role in ('owner','admin','factory_manager','dispatch_manager','dispatch','inventory_manager')
    when p_action like 'window.%' then p_role in ('owner','admin','factory_manager','production_manager')
    when p_action in ('wip.set_limit','wip.retire_limit') then p_role in ('owner','admin','factory_manager','production_manager')
    when p_action='wip.release' then p_role in ('owner','admin','factory_manager','production_manager','quality')
    when p_action in ('rule.set','rule.retire') then p_role in ('owner','admin','factory_manager','production_manager')
    when p_action in ('availability.record','availability.cancel','assignment.assign','queue.update') then p_role in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager','inventory_manager','sales_manager')
    when p_action in ('route.define','route.bind','route.deviate') then p_role in ('owner','admin','factory_manager','production_manager','sales_manager')
    when p_action in ('route.approve','route.retire','route.decide') then p_role in ('owner','admin','factory_manager','production_manager')
    when p_action like 'message.%' then p_role in ('owner','admin','factory_manager','sales_manager','sales','accounts','dispatch_manager','dispatch')
    else false end,false)
$$;
revoke all on function private.execution_view(text),private.execution_read_allowed(text,text),private.execution_action_allowed(text,text) from public,anon;
grant execute on function private.execution_view(text),private.execution_read_allowed(text,text),private.execution_action_allowed(text,text) to authenticated;

do $$ declare t text; begin
  foreach t in array array['delivery_appointments','delivery_appointment_revisions','returnable_gate_passes','gate_pass_returns','load_plan_stops','load_item_confirmations','load_plan_reviews','execution_windows',
    'execution_window_changes','stage_wip_limits','wip_release_decisions','assignment_rules','employee_unavailability','task_assignment_decisions','route_families','order_route_bindings','order_route_deviations',
    'document_communications','execution_requests','execution_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
  end loop;
end $$;
-- Every read goes through public.execution_command, which applies the role matrix, row scoping and
-- field masking. The only direct read is a person's own prepared request.
grant select on public.execution_requests to authenticated;
create policy execution_request_owner on public.execution_requests for select to authenticated using (
  company_id=private.get_current_user_company_id() and actor_id=auth.uid() and private.get_current_user_dealer_id() is null
  and private.execution_read_allowed(private.get_current_user_role(),private.execution_view(mutation->>'action'))
);

create function private.execution_record(p_company uuid,p_view text,p_entity uuid,p_action text,p_actor uuid,p_note text,p_facts jsonb) returns void
language sql security definer set search_path=public,private as $$
  insert into public.execution_events(company_id,view_name,entity_id,action,actor_id,actor_name,note,facts)
  values(p_company,p_view,p_entity,p_action,p_actor,coalesce((select nullif(full_name,'') from public.app_users where id=p_actor and company_id=p_company),'System'),p_note,coalesce(p_facts,'{}'::jsonb))
$$;
create function private.execution_uuid(p_mutation jsonb,p_key text) returns uuid language plpgsql immutable set search_path=public,private as $$
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'string' or (p_mutation->>p_key) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'NOV: Choose a valid record for %.',replace(p_key,'_',' '); end if;
  return (p_mutation->>p_key)::uuid;
end $$;
create function private.execution_member(p_company uuid,p_user uuid,p_supervisor boolean) returns public.app_users language plpgsql stable security definer set search_path=public,private as $$
declare u public.app_users;
begin
  select * into u from public.app_users where id=p_user and company_id=p_company and is_active and dealer_id is null and role not in ('viewer','dealer_admin','dealer_staff')
    and (not p_supervisor or role in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager','inventory_manager','sales_manager'));
  if u.id is null then raise exception 'NOV: Choose an active employee of this company%.',case when p_supervisor then ' who supervises a department' else '' end; end if;
  return u;
end $$;
create function private.execution_notify(p_company uuid,p_actor uuid,p_recipient uuid,p_title text,p_body text,p_entity uuid,p_link text) returns void language sql security definer set search_path=public,private as $$
  insert into public.notifications(company_id,recipient_user_id,notification_type,severity,title,body,related_entity_type,related_entity_id,action_link,created_by)
  select p_company,p_recipient,'execution_update','info',left(p_title,200),left(p_body,800),'execution',p_entity,p_link,p_actor where p_recipient is not null and p_recipient is distinct from p_actor
$$;
create function private.execution_phone(p_value text) returns text language plpgsql immutable set search_path=public,private as $$
declare v text:=regexp_replace(coalesce(p_value,''),'[\s-]','','g');
begin
  v:=regexp_replace(v,'^(\+91|91|0)(?=[6-9][0-9]{9}$)','');
  if v !~ '^[6-9][0-9]{9}$' then raise exception 'NOV: Enter a valid 10-digit Indian mobile number.'; end if;
  return '+91'||v;
end $$;
create function private.execution_stage_index(p_stage text) returns integer language sql immutable set search_path=public,private as $$
  select array_position(array['order_confirmed','die_ready','billet_ready','billet_heating','extrusion_planned','extruded','stretching','cutting','aging','surface_treatment','finishing','packing','dispatched','delivered','payment_pending','closed'],p_stage)
$$;
create function private.execution_outcome(r public.execution_requests) returns jsonb language sql immutable set search_path=public,private as $$
  select jsonb_build_object('request_id',r.request_id,'state',r.state,'fingerprint',r.fingerprint,'expires_at',r.expires_at,'action',r.mutation->>'action','review',r.review,'result',r.result)
$$;
create function private.execution_review(p_title text,p_effect text,p_warnings jsonb,p_facts jsonb,p_records jsonb default null) returns jsonb language sql immutable set search_path=public,private as $$
  select jsonb_build_object('title',p_title,'effect',p_effect,'warnings',coalesce(p_warnings,'[]'::jsonb),'facts',coalesce(p_facts,'{}'::jsonb))||case when p_records is null then '{}'::jsonb else jsonb_build_object('records',p_records) end
$$;
revoke all on function private.execution_record(uuid,text,uuid,text,uuid,text,jsonb),private.execution_uuid(jsonb,text),private.execution_member(uuid,uuid,boolean),
  private.execution_notify(uuid,uuid,uuid,text,text,uuid,text),private.execution_phone(text),private.execution_stage_index(text),private.execution_outcome(public.execution_requests),
  private.execution_review(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Shared evaluation helpers.
------------------------------------------------------------------------------------------------
create function private.execution_version(p_at timestamptz) returns text language sql immutable set search_path=public,private as $$
  select to_char(p_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
revoke all on function private.execution_version(timestamptz) from public,anon,authenticated;

-- NOV-047: hard eligibility (role, required current competency, active employee) is separate from the
-- soft signals (availability, committed work). Delegation grants no authority here.
create function private.assignment_check(p_company uuid,p_task public.tasks,p_user uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare u public.app_users; r public.assignment_rules; v_hard text[]:='{}'; v_soft text[]:='{}'; v_away text; v_open integer; v_min integer; v_unest integer; v_over integer;
begin
  select * into u from public.app_users where id=p_user and company_id=p_company;
  if u.id is null or not u.is_active or u.dealer_id is not null or u.role in ('viewer','dealer_admin','dealer_staff') then v_hard:=array_append(v_hard,'Not an active employee who can take tasks'); end if;
  select * into r from public.assignment_rules where company_id=p_company and task_type=p_task.task_type and status='active';
  if r.id is not null then
    if not (coalesce(u.role,'') = any(r.allowed_roles)) then v_hard:=v_hard||format('Role %s is not eligible for %s tasks',replace(coalesce(u.role,'unknown'),'_',' '),replace(p_task.task_type,'_',' ')); end if;
    if r.required_competency_id is not null and not exists(select 1 from public.employee_competencies ec where ec.company_id=p_company and ec.employee_id=p_user and ec.competency_id=r.required_competency_id
      and ec.revoked_at is null and (ec.expires_at is null or ec.expires_at>now())) then v_hard:=array_append(v_hard,'Required competency is missing or expired'); end if;
  end if;
  select x.kind into v_away from public.employee_unavailability x where x.company_id=p_company and x.employee_id=p_user and x.cancelled_at is null and private.ist_today() between x.starts_on and x.ends_on order by x.starts_on limit 1;
  if v_away is not null then v_soft:=v_soft||format('Unavailable today (%s)',replace(v_away,'_',' ')); end if;
  select count(*),coalesce(sum(ar.estimate_minutes),0),count(*) filter (where ar.estimate_minutes is null),count(*) filter (where t.due_date<private.ist_today())
    into v_open,v_min,v_unest,v_over from public.tasks t left join public.assignment_rules ar on ar.company_id=t.company_id and ar.task_type=t.task_type and ar.status='active'
    where t.company_id=p_company and t.assigned_to=p_user and t.status in ('open','in_progress') and t.id<>p_task.id;
  if v_over>0 then v_soft:=v_soft||format('%s overdue task(s) already assigned',v_over); end if;
  if v_open>=10 then v_soft:=v_soft||format('%s open tasks already assigned',v_open); end if;
  return jsonb_build_object('user_id',p_user,'name',coalesce(u.full_name,u.email),'role',u.role,'hard_ok',cardinality(v_hard)=0,'hard_reasons',to_jsonb(v_hard),'soft',to_jsonb(v_soft),
    'open_tasks',v_open,'estimated_minutes',v_min,'unestimated_tasks',v_unest,'overdue_tasks',v_over,'away',v_away is not null,'has_rule',r.id is not null);
end $$;
revoke all on function private.assignment_check(uuid,public.tasks,uuid) from public,anon,authenticated;

create function private.assignment_candidates(p_company uuid,p_task public.tasks) returns jsonb language sql stable security definer set search_path=public,private as $$
  with c as (select private.assignment_check(p_company,p_task,u.id) x,u.full_name from public.app_users u where u.company_id=p_company and u.is_active and u.dealer_id is null
      and u.role not in ('viewer','dealer_admin','dealer_staff') order by u.full_name,u.id limit 40),
    m as (select min((x->>'open_tasks')::integer) mn from c where (x->>'hard_ok')::boolean and not (x->>'away')::boolean)
  select coalesce(jsonb_agg(c.x||jsonb_build_object('recommended',(c.x->>'hard_ok')::boolean and not (c.x->>'away')::boolean and (c.x->>'open_tasks')::integer=m.mn) order by c.full_name,c.x->>'user_id'),'[]'::jsonb) from c cross join m
$$;
revoke all on function private.assignment_candidates(uuid,public.tasks) from public,anon,authenticated;

-- NOV-044: the protected window is counted in calendar days of the planned date (IST). A job planned
-- today or on any day the horizon reaches is inside; overnight work belongs to its planned date.
create function private.execution_window_for(p_company uuid,p_machine uuid) returns public.execution_windows language sql stable security definer set search_path=public,private as $$
  select w.* from public.execution_windows w where w.company_id=p_company and w.status='active' and (w.machine_id is null or w.machine_id=p_machine)
  order by (w.machine_id is null),w.horizon_hours desc limit 1
$$;
create function private.execution_in_window(p_window public.execution_windows,p_date date) returns boolean language sql stable set search_path=public,private as $$
  select p_window.id is not null and p_date is not null and p_date>=private.ist_today() and p_date<=((now() at time zone 'Asia/Kolkata')+make_interval(hours=>p_window.horizon_hours))::date
$$;
revoke all on function private.execution_window_for(uuid,uuid),private.execution_in_window(public.execution_windows,date) from public,anon,authenticated;

-- NOV-019: the message and its recipient are built from authoritative records only. No cost, margin,
-- internal note or other customer's data is ever read here.
create function private.message_build(p_company uuid,p_template text,p_entity uuid,p_override_phone text default null) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare o public.orders; d public.dispatches; a public.delivery_appointments; c public.customers; co public.companies; v_phone text; v_source text; v_body text; v_label text; v_href text; v_warn jsonb:='[]'::jsonb;
  v_stamp timestamptz; v_shipped numeric; v_name text;
begin
  select * into co from public.companies where id=p_company;
  if p_template='order_confirmation' then
    select * into o from public.orders where id=p_entity and company_id=p_company and deleted_at is null;
    if o.id is null then raise exception 'NOV: The order is unavailable.'; end if;
    if o.current_stage in ('cancelled') then raise exception 'NOV: A cancelled order has no confirmation to prepare.'; end if;
    v_stamp:=o.updated_at;
  elsif p_template='dispatch_notice' then
    select * into d from public.dispatches where id=p_entity and company_id=p_company;
    if d.id is null then raise exception 'NOV: The dispatch is unavailable.'; end if;
    if d.delivery_status in ('pending','returned') then raise exception 'NOV: This dispatch is % and has not left; prepare the notice once it is dispatched.',d.delivery_status; end if;
    select * into o from public.orders where id=d.order_id and company_id=p_company; v_stamp:=greatest(d.updated_at,o.updated_at);
  else
    select * into a from public.delivery_appointments where id=p_entity and company_id=p_company;
    if a.id is null then raise exception 'NOV: The appointment is unavailable.'; end if;
    if a.status in ('cancelled','completed','unloading_failed','missed') then raise exception 'NOV: A % appointment needs no notice.',replace(a.status,'_',' '); end if;
    select * into o from public.orders where id=a.order_id and company_id=p_company; v_stamp:=greatest(a.updated_at,o.updated_at);
  end if;
  select * into c from public.customers where id=o.customer_id and company_id=p_company;
  v_name:=coalesce(nullif(btrim(c.customer_name),''),'Customer');
  if p_override_phone is not null then v_phone:=private.execution_phone(p_override_phone); v_source:='entered';
  else
    begin
      if nullif(btrim(coalesce(c.whatsapp_number,'')),'') is not null then v_phone:=private.execution_phone(c.whatsapp_number); v_source:='customer_whatsapp';
      else v_phone:=private.execution_phone(c.phone); v_source:='customer_phone'; end if;
    exception when others then
      if sqlerrm like 'NOV: %' then v_phone:=null; else raise; end if;
    end;
  end if;
  if v_phone is null then raise exception 'NOV: No valid mobile number is recorded for the customer. Enter the recipient number.'; end if;
  if p_template='order_confirmation' then
    v_body:=format('Dear %s, we confirm your order %s dated %s for %s kg of aluminium profiles. Expected dispatch: %s. Please tell us at once if anything needs to change. - %s',
      v_name,o.order_number,to_char(o.order_date,'DD Mon YYYY'),trim_scale(o.requested_weight_kg),coalesce(to_char(o.expected_dispatch_date,'DD Mon YYYY'),'to be confirmed'),co.name);
  elsif p_template='dispatch_notice' then
    select coalesce(sum(x.total_weight_kg),0) into v_shipped from public.dispatches x where x.company_id=p_company and x.order_id=o.id and x.delivery_status not in ('pending','returned');
    v_body:=format('Dear %s, dispatch %s for order %s has left: %s bundle(s), %s kg. Vehicle %s, transporter %s, LR %s.',v_name,coalesce(d.dispatch_number,'-'),o.order_number,d.number_of_bundles,trim_scale(d.total_weight_kg),
      coalesce(nullif(d.vehicle_number,''),'to be advised'),coalesce(nullif(d.transporter_name,''),'to be advised'),coalesce(nullif(d.lr_number,''),'to follow'));
    if v_shipped+0.001<o.requested_weight_kg then v_body:=v_body||format(' This is a part dispatch: %s of %s kg ordered has left; the balance will follow.',trim_scale(v_shipped),trim_scale(o.requested_weight_kg)); v_warn:=v_warn||jsonb_build_array('Part dispatch: the message states the balance will follow.'); end if;
    v_body:=v_body||' - '||co.name;
    v_label:='Dispatch '||coalesce(d.dispatch_number,'record'); v_href:='/dispatches/'||d.id;
  else
    v_body:=format('Dear %s, %s for order %s: %s IST at %s.%s%s Please keep unloading arrangements ready.',v_name,
      case when a.status='requested' then 'we request delivery to be received' else 'delivery is scheduled' end,o.order_number,
      case when a.status='requested' then to_char(a.requested_start at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI')||' to '||to_char(a.requested_end at time zone 'Asia/Kolkata','DD Mon HH24:MI')||' (please confirm)'
        else to_char(a.confirmed_start at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI')||' to '||to_char(a.confirmed_end at time zone 'Asia/Kolkata','DD Mon HH24:MI') end,a.site_address,
      case when a.access_restrictions is not null then ' Access: '||a.access_restrictions||'.' else '' end,case when a.preparations is not null then ' Needed: '||a.preparations||'.' else '' end);
    v_body:=v_body||' - '||co.name;
  end if;
  return jsonb_build_object('customer_id',c.id,'recipient_name',v_name,'recipient_phone',v_phone,'recipient_source',v_source,'body',left(v_body,1500),'document_label',v_label,'document_href',v_href,
    'order_number',o.order_number,'warnings',v_warn,'fingerprint',md5(v_body||'|'||v_phone||'|'||p_template||'|'||p_entity::text||'|'||v_stamp::text));
end $$;
revoke all on function private.message_build(uuid,text,uuid,text) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-087: progress is derived from recorded stage evidence and the route bound to the order.
-- A stage that was passed without evidence is shown as unavailable, never as complete, and no
-- percentage is computed from labels. Reading a stage link performs no transition.
------------------------------------------------------------------------------------------------
create function private.order_progress(p_company uuid,p_role text,p_order uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare o public.orders; b public.order_route_bindings; f public.route_families; v_all text[]:=array['order_confirmed','die_ready','billet_ready','billet_heating','extrusion_planned','extruded','stretching','cutting','aging','surface_treatment','finishing','packing','dispatched','delivered','payment_pending','closed'];
  v_labels text[]:=array['Order confirmed','Die ready','Billet ready','Billet heating','Extrusion planned','Extruded','Stretching','Cutting','Ageing','Surface treatment','Finishing','Packing','Dispatched','Delivered','Payment pending','Closed'];
  v_req text[]:='{}'; v_opt text[]:='{}'; v_dev jsonb:='{}'::jsonb; v_cur integer; v_stages jsonb:='[]'::jsonb; v_blockers jsonb:='[]'::jsonb; v_prod jsonb; v_disp jsonb; v_err jsonb:='{}'::jsonb; v_reopened text[]:='{}';
  i integer; s text; v_state text; v_reason text; v_ev jsonb; v_hist jsonb:='[]'::jsonb; v_prev integer; v_x record; v_job uuid; v_dispatch uuid; v_href text; v_qty jsonb; v_planned date; v_skipped boolean; v_applies boolean;
  v_prod_role boolean:=p_role in ('owner','admin','factory_manager','production_manager','production','quality','inventory_manager'); v_disp_role boolean:=p_role in ('owner','admin','factory_manager','dispatch_manager','dispatch','sales_manager','sales','inventory_manager');
begin
  select * into o from public.orders where id=p_order and company_id=p_company and deleted_at is null;
  if o.id is null then raise exception 'NOV: This order is unavailable.'; end if;
  select * into b from public.order_route_bindings where company_id=p_company and order_id=p_order and status='active';
  if b.id is not null then
    select * into f from public.route_families where id=b.family_id and company_id=p_company; v_req:=f.required_stages; v_opt:=f.optional_stages;
    select coalesce(jsonb_object_agg(stage,reason),'{}'::jsonb) into v_dev from public.order_route_deviations where company_id=p_company and binding_id=b.id and status='approved';
  end if;
  v_cur:=private.execution_stage_index(o.current_stage);
  begin
    select jsonb_build_object('jobs',count(*) filter (where status<>'cancelled'),'completed',count(*) filter (where status='completed'),'on_hold',count(*) filter (where status='on_hold'),
      'planned_kg',coalesce(sum(planned_quantity_kg) filter (where status<>'cancelled'),0),'produced_kg',coalesce(sum(actual_quantity_kg) filter (where status<>'cancelled'),0),
      'first_planned',min(planned_date) filter (where status<>'cancelled'),'last_planned',max(planned_date) filter (where status<>'cancelled'),'first_job',(array_agg(id order by planned_date nulls last,created_at) filter (where status<>'cancelled'))[1])
      into v_prod from public.production_jobs where company_id=p_company and order_id=p_order;
    v_job:=nullif(v_prod->>'first_job','')::uuid;
    for v_x in select j.job_number,h.reason from public.production_jobs j join public.production_job_holds h on h.production_job_id=j.id and h.company_id=j.company_id and h.status='active' where j.company_id=p_company and j.order_id=p_order and j.status='on_hold' limit 5 loop
      v_blockers:=v_blockers||jsonb_build_array(format('Production job %s is on hold: %s',coalesce(v_x.job_number,'record'),replace(v_x.reason,'_',' ')));
    end loop;
    if exists(select 1 from public.production_jobs j where j.company_id=p_company and j.order_id=p_order and j.status='on_hold') and jsonb_array_length(v_blockers)=0 then v_blockers:=v_blockers||jsonb_build_array('A production job is on hold'); end if;
  exception when others then v_prod:=null; v_err:=v_err||jsonb_build_object('production',true); end;
  begin
    select jsonb_build_object('count',count(*) filter (where delivery_status not in ('pending','returned')),'dispatched_kg',coalesce(sum(total_weight_kg) filter (where delivery_status not in ('pending','returned')),0),
      'delivered_kg',coalesce(sum(total_weight_kg) filter (where delivery_status='delivered'),0),'damaged',count(*) filter (where delivery_status='damaged'),'latest',(array_agg(id order by dispatch_date desc,created_at desc))[1])
      into v_disp from public.dispatches where company_id=p_company and order_id=p_order;
    v_dispatch:=nullif(v_disp->>'latest','')::uuid;
    if (v_disp->>'damaged')::integer>0 then v_blockers:=v_blockers||jsonb_build_array('A dispatch is recorded as damaged'); end if;
  exception when others then v_disp:=null; v_err:=v_err||jsonb_build_object('dispatch',true); end;
  begin
    if o.billets_short>0 and (v_cur is null or v_cur<=private.execution_stage_index('extruded')) then v_blockers:=v_blockers||jsonb_build_array(format('%s billet(s) short for this order',o.billets_short)); end if;
    if o.production_die_id is not null and exists(select 1 from public.dies d where d.id=o.production_die_id and d.company_id=p_company and d.die_status in ('blocked','retired','scrapped','damaged')) and (v_cur is null or v_cur<=private.execution_stage_index('extruded')) then
      v_blockers:=v_blockers||jsonb_build_array('The die for this order is not usable'); end if;
    if exists(select 1 from public.quality_inspections q join public.production_jobs j on j.id=q.production_job_id and j.company_id=q.company_id where q.company_id=p_company and j.order_id=p_order and q.status in ('rejected','rework')
      and not exists(select 1 from public.quality_inspections q2 where q2.company_id=p_company and q2.production_job_id=q.production_job_id and q2.status='approved' and q2.inspection_date>q.inspection_date))
      and (v_cur is null or v_cur between private.execution_stage_index('extruded') and private.execution_stage_index('dispatched')) then v_blockers:=v_blockers||jsonb_build_array('An inspection was rejected or sent for rework and has not been approved since'); end if;
  exception when others then v_err:=v_err||jsonb_build_object('checks',true); end;
  -- Stage evidence: every change is kept; going back to an earlier stage is shown as reopened work.
  begin
    select coalesce(jsonb_agg(jsonb_build_object('stage',h.stage,'changed_at',h.changed_at,'by',u.full_name) order by h.changed_at,h.id),'[]'::jsonb) into v_hist
      from public.order_stage_history h left join public.app_users u on u.id=h.changed_by and u.company_id=h.company_id where h.company_id=p_company and h.order_id=p_order;
    for v_x in select (e->>'stage') stage from jsonb_array_elements(v_hist) e loop
      if v_prev is not null and private.execution_stage_index(v_x.stage)<v_prev then v_reopened:=v_reopened||v_x.stage; end if;
      v_prev:=private.execution_stage_index(v_x.stage);
    end loop;
  exception when others then v_err:=v_err||jsonb_build_object('history',true); v_hist:='[]'::jsonb; end;
  for i in 1..array_length(v_all,1) loop
    s:=v_all[i]; v_reason:=null; v_href:=null; v_qty:=null; v_planned:=null;
    select e into v_ev from jsonb_array_elements(v_hist) e where e->>'stage'=s order by (e->>'changed_at')::timestamptz desc limit 1;
    v_applies:=b.id is null or s=any(v_req) or s=any(v_opt);
    v_skipped:=(b.id is not null and not v_applies) or (v_dev ? s);
    if v_skipped then v_state:='skipped_by_policy'; v_reason:=case when v_dev ? s then 'Skipped by an approved deviation: '||(v_dev->>s) else 'Not part of the approved route '||f.name||' (v'||f.version||')' end;
    elsif o.current_stage='cancelled' then v_state:=case when v_ev is not null then 'complete' else 'upcoming' end;
    elsif (v_err ? 'history') then v_state:='unavailable'; v_reason:='Stage history could not be read';
    elsif i<v_cur then v_state:=case when v_ev is not null then 'complete' else 'unavailable' end; if v_ev is null then v_reason:='Passed without a recorded stage change'; end if;
    elsif i=v_cur then v_state:=case when jsonb_array_length(v_blockers)>0 then 'blocked' else 'current' end;
    else v_state:='upcoming'; end if;
    if s in ('extrusion_planned','extruded') then
      if v_prod is null then v_state:=case when v_state in ('skipped_by_policy') then v_state else 'unavailable' end; v_reason:=coalesce(v_reason,'Production records could not be read');
      else v_qty:=jsonb_build_object('produced_kg',v_prod->'produced_kg','planned_kg',v_prod->'planned_kg','jobs',v_prod->'jobs','jobs_completed',v_prod->'completed','basis','production job output');
        v_planned:=nullif(v_prod->>'last_planned','')::date; if v_job is not null and v_prod_role then v_href:='/production/'||v_job; end if; end if;
    elsif s in ('dispatched','delivered') then
      v_planned:=case when s='dispatched' then o.expected_dispatch_date end;
      if v_disp is null then v_state:=case when v_state='skipped_by_policy' then v_state else 'unavailable' end; v_reason:=coalesce(v_reason,'Dispatch records could not be read');
      else v_qty:=jsonb_build_object('dispatched_kg',v_disp->'dispatched_kg','delivered_kg',v_disp->'delivered_kg','ordered_kg',o.requested_weight_kg,'basis','dispatch records');
        if v_dispatch is not null and v_disp_role then v_href:='/dispatches/'||v_dispatch; end if; end if;
    end if;
    v_stages:=v_stages||jsonb_build_array(jsonb_build_object('stage',s,'label',v_labels[i],'state',v_state,'reason',v_reason,'applicable',v_applies and not v_skipped,'optional',b.id is not null and s=any(v_opt),
      'evidence',case when v_ev is null then null else jsonb_build_object('changed_at',v_ev->'changed_at','by',v_ev->'by') end,'reopened',s=any(v_reopened),'planned_date',v_planned,'quantity',v_qty,'href',v_href));
  end loop;
  return jsonb_build_object('order_id',o.id,'order_number',o.order_number,'current_stage',o.current_stage,'cancelled',o.current_stage='cancelled','route',case when b.id is null then null else jsonb_build_object('code',f.code,'name',f.name,'version',f.version) end,
    'stages',v_stages,'blockers',v_blockers,'reopened',cardinality(v_reopened)>0,'errors',v_err,'as_of',now());
end $$;
revoke all on function private.order_progress(uuid,text,uuid) from public,anon,authenticated;

create function public.order_progress(p_order uuid) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid(); v_company uuid:=private.get_current_user_company_id(); v_role text:=private.get_current_user_role();
begin
  if v_actor is null or v_company is null or not exists(select 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null) or not private.execution_read_allowed(v_role,'progress') then
    raise exception 'Not permitted' using errcode='42501'; end if;
  return private.order_progress(v_company,v_role,p_order);
end $$;
revoke all on function public.order_progress(uuid) from public,anon;
grant execute on function public.order_progress(uuid) to authenticated;

------------------------------------------------------------------------------------------------
-- Read models. Each row is {id,label,status,owner,due_date,summary,source_href,details}.
------------------------------------------------------------------------------------------------
create function private.execution_rows(p_company uuid,p_actor uuid,p_role text,p_view text,p_state text,p_id uuid default null,p_items_page integer default 1)
returns table(row_data jsonb,sort_rank integer,sort_due date,sort_new timestamptz) language plpgsql stable security definer set search_path=public,private as $$
declare v_today date:=private.ist_today(); v_contact boolean:=p_role in ('owner','admin','factory_manager','dispatch_manager','dispatch','sales_manager','sales');
begin
  if p_view='appointments' then
    return query select jsonb_build_object('id',a.id,'label',concat(o.order_number,' · ',case when d.id is null then 'whole order' else 'dispatch '||coalesce(d.dispatch_number,'record') end),'status',st.s,'owner',fu.full_name,
        'due_date',(coalesce(a.confirmed_start,a.requested_start) at time zone 'Asia/Kolkata')::date,
        'summary',concat(case st.s when 'changed' then 'Changed after confirmation; the site must reconfirm' when 'requested' then 'Requested slot; not yet confirmed by the site'
          when 'confirmed' then 'Confirmed by '||coalesce(a.confirmed_by_name,'the site') when 'outcome_due' then 'Confirmed slot has passed; record the outcome' else replace(a.status,'_',' ') end,
          ' · ',to_char(coalesce(a.confirmed_start,a.requested_start) at time zone 'Asia/Kolkata','DD Mon HH24:MI'),' IST'),
        'source_href','/orders/'||o.id,
        'details',jsonb_build_object('appointment_id',a.id,'order_id',o.id,'order_number',o.order_number,'dispatch_id',d.id,'dispatch_number',d.dispatch_number,'dispatch_status',d.delivery_status,'customer',cu.customer_name,
          'raw_status',a.status,'requested_start',a.requested_start,'requested_end',a.requested_end,'confirmed_start',a.confirmed_start,'confirmed_end',a.confirmed_end,'confirmed_by_name',a.confirmed_by_name,
          'site_address',a.site_address,'site_revision',a.site_revision,'customer_default_address',coalesce(nullif(btrim(cu.shipping_address),''),nullif(btrim(cu.billing_address),'')),
          'differs_from_customer',coalesce(lower(regexp_replace(a.site_address,'\s+',' ','g'))<>lower(regexp_replace(coalesce(nullif(btrim(cu.shipping_address),''),nullif(btrim(cu.billing_address),''),a.site_address),'\s+',' ','g')),false),
          'contact_name',a.contact_name,'contact_phone',case when v_contact then a.contact_phone when a.contact_phone is not null then 'XXXXXX'||right(a.contact_phone,4) end,'contact_masked',not v_contact,
          'access_restrictions',a.access_restrictions,'preparations',a.preparations,'follow_up_owner',fu.full_name,'follow_up_owner_id',a.follow_up_owner,'revision',a.revision,'changed_after_confirmation',a.changed_after_confirmation,
          'arrived_at',a.arrived_at,'outcome_note',a.outcome_note,'created_at',a.created_at,
          'revisions',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('revision',r.revision,'reason',r.reason,'recorded_at',r.recorded_at,'status',r.snapshot->>'status',
              'slot_start',coalesce(r.snapshot->>'confirmed_start',r.snapshot->>'requested_start'),'site_address',r.snapshot->>'site_address') order by r.revision desc),'[]'::jsonb)
            from (select * from public.delivery_appointment_revisions x where x.company_id=p_company and x.appointment_id=a.id order by x.revision desc limit 10) r) end)),
      case st.s when 'changed' then 0 when 'outcome_due' then 1 when 'requested' then 2 when 'arrived' then 3 when 'confirmed' then 4 else 9 end,(coalesce(a.confirmed_start,a.requested_start) at time zone 'Asia/Kolkata')::date,a.updated_at
    from public.delivery_appointments a join public.orders o on o.id=a.order_id and o.company_id=a.company_id left join public.dispatches d on d.id=a.dispatch_id and d.company_id=a.company_id
    left join public.customers cu on cu.id=o.customer_id and cu.company_id=o.company_id left join public.app_users fu on fu.id=a.follow_up_owner and fu.company_id=a.company_id
    cross join lateral (select case when a.status='requested' and a.changed_after_confirmation then 'changed' when a.status='confirmed' and a.confirmed_end<now() then 'outcome_due' else a.status end s) st
    where a.company_id=p_company and (p_id is null or a.id=p_id) and (p_id is not null or p_state='all' or a.status in ('requested','confirmed','arrived'));

  elsif p_view='gate_passes' then
    return query select jsonb_build_object('id',g.id,'label',concat(g.pass_number,' · ',g.item_label,case when g.serial_ref is not null then ' ('||g.serial_ref||')' else '' end),'status',st.s,'owner',fu.full_name,'due_date',g.due_date,
        'summary',concat(case st.s when 'approved' then 'Approved; has not left yet' when 'out' then 'With '||g.custodian_name when 'overdue' then 'Overdue with '||g.custodian_name when 'partially_returned' then 'Partly returned; with '||g.custodian_name
          when 'partially_returned_overdue' then 'Partly returned and overdue; with '||g.custodian_name else replace(g.status,'_',' ') end,' · balance ',g.quantity-g.returned_quantity-g.lost_quantity,' of ',g.quantity,' · due ',to_char(g.due_date,'DD Mon YYYY')),
        'source_href',case when g.die_id is not null then '/dies/'||g.die_id end,
        'details',jsonb_build_object('pass_id',g.id,'pass_number',g.pass_number,'item_kind',g.item_kind,'die_id',g.die_id,'die_number',dn.die_number,'item_label',g.item_label,'serial_ref',g.serial_ref,'quantity',g.quantity,
          'returned_quantity',g.returned_quantity,'damaged_quantity',g.damaged_quantity,'lost_quantity',g.lost_quantity,'balance',g.quantity-g.returned_quantity-g.lost_quantity,'custodian_name',g.custodian_name,'custodian_kind',g.custodian_kind,
          'purpose',g.purpose,'due_date',g.due_date,'original_due_date',g.original_due_date,'extension_count',g.extension_count,'follow_up_owner',fu.full_name,'follow_up_owner_id',g.follow_up_owner,'issued_by',iu.full_name,
          'pass_status',g.status,'departed_at',g.departed_at,'acknowledged_by_name',g.acknowledged_by_name,'acknowledged_at',g.acknowledged_at,'closed_at',g.closed_at,'close_note',g.close_note,'overdue',st.s like '%overdue' or st.s='overdue',
          'returns',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('quantity',r.quantity,'condition',r.condition,'note',r.note,'recorded_at',r.recorded_at) order by r.recorded_at desc),'[]'::jsonb)
            from (select * from public.gate_pass_returns x where x.company_id=p_company and x.pass_id=g.id order by x.recorded_at desc limit 20) r) end)),
      case st.s when 'overdue' then 0 when 'partially_returned_overdue' then 0 when 'approved' then 2 when 'partially_returned' then 3 when 'out' then 3 else 9 end,g.due_date,g.updated_at
    from public.returnable_gate_passes g left join public.dies dn on dn.id=g.die_id and dn.company_id=g.company_id left join public.app_users fu on fu.id=g.follow_up_owner and fu.company_id=g.company_id
    left join public.app_users iu on iu.id=g.issued_by and iu.company_id=g.company_id
    cross join lateral (select case when g.status in ('closed','cancelled') then g.status when g.status='out' and g.due_date<v_today and g.returned_quantity>0 then 'partially_returned_overdue' when g.status='out' and g.due_date<v_today then 'overdue'
      when g.status='out' and g.returned_quantity>0 then 'partially_returned' else g.status end s) st
    where g.company_id=p_company and (p_id is null or g.id=p_id) and (p_id is not null or p_state='all' or g.status in ('approved','out'));

  elsif p_view='loads' then
    return query select jsonb_build_object('id',l.id,'label',concat(v.vehicle_label,' · ',v.registration_number),'status',st.s,'owner',null,'due_date',l.load_date,
        'summary',concat(it.n,' bundle(s), ',trim_scale(it.kg),' of ',trim_scale(l.capacity_kg),' kg capacity · ',oc.n,' order(s) · ',cf.n,' of ',it.n,' confirmed loaded',case when sm.n>0 then ' · '||sm.n||' order(s) without a stop' else '' end),
        'source_href','/dispatches/loads',
        'details',jsonb_build_object('load_id',l.id,'vehicle',v.vehicle_label,'registration',v.registration_number,'capacity_kg',l.capacity_kg,'planned_kg',it.kg,'loaded_kg',cf.kg,'items_total',it.n,'items_confirmed',cf.n,'order_count',oc.n,
          'load_status',l.status,'orders_without_stop',sm.n,'over_capacity',it.kg>l.capacity_kg,'review',lr.r,'items_page',greatest(p_items_page,1),'items_page_size',25,
          'orders',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('order_id',o.id,'order_number',o.order_number,'customer',cu.customer_name,'stop_seq',s.stop_seq,'unload_note',s.unload_note,'bundles',x.n,'kg',x.kg,
              'site',coalesce(nullif(cu.city,''),nullif(left(cu.shipping_address,60),'')),'appointment',ap.status,'held',h.n>0,'stage',o.current_stage) order by s.stop_seq nulls last,o.order_number),'[]'::jsonb)
            from (select i.order_id,count(*) n,sum(i.net_weight_kg) kg from public.factory_vehicle_load_items i where i.company_id=p_company and i.load_id=l.id and i.status='active' group by 1) x
            join public.orders o on o.id=x.order_id and o.company_id=p_company left join public.customers cu on cu.id=o.customer_id and cu.company_id=o.company_id
            left join public.load_plan_stops s on s.company_id=p_company and s.load_id=l.id and s.order_id=o.id
            left join lateral (select a.status from public.delivery_appointments a where a.company_id=p_company and a.order_id=o.id and a.status in ('requested','confirmed') order by a.created_at desc limit 1) ap on true
            cross join lateral (select count(*) n from public.production_jobs j where j.company_id=p_company and j.order_id=o.id and j.status='on_hold') h) end,
          'items',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(q.item order by q.ord),'[]'::jsonb) from (select jsonb_build_object('item_id',i.id,'bundle',pb.bundle_number,'order_number',o.order_number,'kg',i.net_weight_kg,'pieces',i.number_of_pieces,'stop_seq',s.stop_seq,
              'confirmation',c.status,'method',c.method,'note',c.note) item,row_number() over(order by s.stop_seq desc nulls last,pb.bundle_number,i.id) ord
            from public.factory_vehicle_load_items i
            join public.orders o on o.id=i.order_id and o.company_id=p_company left join public.prepared_physical_bundles pb on pb.id=i.bundle_id and pb.company_id=p_company
            left join public.load_plan_stops s on s.company_id=p_company and s.load_id=l.id and s.order_id=i.order_id left join public.load_item_confirmations c on c.item_id=i.id and c.company_id=p_company
            where i.company_id=p_company and i.load_id=l.id and i.status='active' order by ord limit 25 offset (greatest(p_items_page,1)-1)*25) q) end)),
      case st.s when 'not_ready' then 0 when 'loading' then 1 when 'planning' then 2 when 'ready' then 3 else 9 end,l.load_date,l.updated_at
    from public.factory_vehicle_loads l join public.factory_vehicles v on v.id=l.vehicle_id and v.company_id=l.company_id
    cross join lateral (select count(*) n,coalesce(sum(i.net_weight_kg),0) kg from public.factory_vehicle_load_items i where i.company_id=p_company and i.load_id=l.id and i.status='active') it
    cross join lateral (select count(distinct i.order_id) n from public.factory_vehicle_load_items i where i.company_id=p_company and i.load_id=l.id and i.status='active') oc
    cross join lateral (select count(*) n,coalesce(sum(i.net_weight_kg),0) kg from public.load_item_confirmations c join public.factory_vehicle_load_items i on i.id=c.item_id and i.company_id=c.company_id
      where c.company_id=p_company and c.load_id=l.id and c.status='loaded' and i.status='active') cf
    cross join lateral (select count(distinct i.order_id) n from public.factory_vehicle_load_items i where i.company_id=p_company and i.load_id=l.id and i.status='active'
      and not exists(select 1 from public.load_plan_stops s where s.company_id=p_company and s.load_id=l.id and s.order_id=i.order_id)) sm
    cross join lateral (select greatest((select max(c.confirmed_at) from public.load_item_confirmations c where c.company_id=p_company and c.load_id=l.id),(select max(s.set_at) from public.load_plan_stops s where s.company_id=p_company and s.load_id=l.id)) at) ch
    cross join lateral (select private.load_findings(p_company,l.id) f) fr
    left join lateral (select jsonb_build_object('outcome',r.outcome,'findings',r.findings,'reviewed_at',r.reviewed_at,'loaded_kg',r.loaded_kg,
        'current',(ch.at is null or r.reviewed_at>=ch.at) and r.findings->'blockers' is not distinct from fr.f->'blockers' and r.findings->'warnings' is not distinct from fr.f->'warnings'
          and (r.findings->>'planned_kg')::numeric is not distinct from (fr.f->>'planned_kg')::numeric and (r.findings->>'loaded_kg')::numeric is not distinct from (fr.f->>'loaded_kg')::numeric) r
      from public.load_plan_reviews r where r.company_id=p_company and r.load_id=l.id order by r.reviewed_at desc limit 1) lr on true
    cross join lateral (select case when l.status<>'reviewed' then l.status when lr.r is not null and (lr.r->>'current')::boolean then lr.r->>'outcome' when ch.at is not null then 'loading' else 'planning' end s) st
    where l.company_id=p_company and (p_id is null or l.id=p_id) and (p_id is not null or p_state='all' or l.status='reviewed');

  elsif p_view='windows' then
    return query select jsonb_build_object('id',w.id,'label',concat('Protected window · ',coalesce(m.machine_name,'all presses'),' · ',w.horizon_hours,' h'),'status',w.status,'owner',cu.full_name,'due_date',null,
        'summary',concat(case when w.enforce then 'Enforced by the server' else 'Advisory; changes are recorded' end,' · ',w.reason),'source_href','/production/schedule',
        'details',jsonb_build_object('kind','policy','window_id',w.id,'machine_id',w.machine_id,'machine_name',m.machine_name,'horizon_hours',w.horizon_hours,'enforce',w.enforce,'reason',w.reason,'policy_status',w.status,
          'window_end_date',((now() at time zone 'Asia/Kolkata')+make_interval(hours=>w.horizon_hours))::date,'jobs_in_window',(select count(*) from public.production_jobs j where j.company_id=p_company and j.status in ('planned','ready','on_hold')
            and (w.machine_id is null or j.machine_id=w.machine_id) and private.execution_in_window(w,j.planned_date)),'created_by',cu.full_name,'created_at',w.created_at)),
      case when w.status='active' then 3 else 9 end,null::date,w.created_at
    from public.execution_windows w left join public.machines m on m.id=w.machine_id and m.company_id=w.company_id left join public.app_users cu on cu.id=w.created_by and cu.company_id=w.company_id
    where w.company_id=p_company and (p_id is null or w.id=p_id) and (p_id is not null or p_state='all' or w.status='active');
    return query select jsonb_build_object('id',x.id,'label',concat('Change ',coalesce(j.job_number,'job'),' · ',to_char(x.previous_date,'DD Mon'),' to ',to_char(x.new_date,'DD Mon')),'status',case when x.status='requested' and j.updated_at<>x.job_version then 'stale' else x.status end,
        'owner',ru.full_name,'due_date',x.new_date,'summary',concat(left(x.reason,100),' · ',case x.status when 'requested' then 'awaiting a second approver' else x.status end),'source_href','/production/'||j.id,
        'details',jsonb_build_object('kind','change','change_id',x.id,'job_id',j.id,'job_number',j.job_number,'job_status',j.status,'order_number',o.order_number,'previous_date',x.previous_date,'previous_shift',x.previous_shift,'new_date',x.new_date,'new_shift',x.new_shift,
          'reason',x.reason,'customer_effect',x.customer_effect,'impact',x.impact,'change_status',x.status,'requested_by',ru.full_name,'requested_by_id',x.requested_by,'requested_at',x.requested_at,'decided_by',du.full_name,'decided_at',x.decided_at,
          'decision_note',x.decision_note,'job_changed_since_request',x.status='requested' and j.updated_at<>x.job_version)),
      case when x.status='requested' then 0 else 9 end,x.new_date,x.requested_at
    from public.execution_window_changes x join public.production_jobs j on j.id=x.job_id and j.company_id=x.company_id join public.orders o on o.id=j.order_id and o.company_id=j.company_id
    left join public.app_users ru on ru.id=x.requested_by and ru.company_id=x.company_id left join public.app_users du on du.id=x.decided_by and du.company_id=x.company_id
    where x.company_id=p_company and (p_id is null or x.id=p_id) and (p_id is not null or p_state='all' or x.status='requested');

  elsif p_view='wip' then
    return query with st(stage,label,ord) as (values ('at_press','At the press',1),('at_vendor','At a finishing vendor',2),('awaiting_finishing','Awaiting finishing',3),('awaiting_qc','Awaiting quality check',4),('awaiting_packing','Awaiting packing',5),('on_hold','On hold',6)),
      w as (select private.control_wip_stage(p_company,j) x from public.production_jobs j where j.company_id=p_company and (j.status in ('in_progress','on_hold') or (j.status='completed' and j.completed_at>now()-interval '90 days'))),
      ag as (select x->>'stage' stage,count(*) jobs,sum((x->>'quantity_kg')::numeric) kg,count(*) filter (where x->>'quantity_kg' is null) unmeasured,min((x->>'entered_at')::timestamptz) oldest from w where x is not null group by 1),
      up as (select count(*) filter (where j.status in ('planned','ready')) ready_jobs,count(*) filter (where j.status='in_progress') running_jobs from public.production_jobs j where j.company_id=p_company)
    select jsonb_build_object('id',coalesce(l.id,md5(p_company::text||':wip:'||st.stage)::uuid),'label',st.label,'status',cs.s,'owner',null,'due_date',null,
        'summary',concat(coalesce(ag.jobs,0),' job(s), ',coalesce(trim_scale(ag.kg),'0'),' kg',case when coalesce(ag.unmeasured,0)>0 then ' ('||ag.unmeasured||' without a recorded quantity)' else '' end,
          case when l.id is not null then ' · limit '||trim_scale(l.limit_value)||' '||l.unit else ' · no limit set' end),'source_href','/production',
        'details',jsonb_build_object('stage',st.stage,'limit_id',l.id,'unit',l.unit,'limit_value',l.limit_value,'basis',l.basis,'jobs',coalesce(ag.jobs,0),'kg',coalesce(ag.kg,0),'unmeasured_jobs',coalesce(ag.unmeasured,0),
          'oldest_entered_at',ag.oldest,'current_value',cv.v,'upstream_jobs',case when st.stage='at_press' then up.ready_jobs else up.running_jobs end,
          'upstream_basis',case when st.stage='at_press' then 'planned or ready jobs waiting to start' else 'jobs running at the press' end,
          'decisions',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('job',coalesce(j.job_number,'job'),'reason',d.reason,'wip',d.wip_value,'limit',d.limit_value,'unit',d.unit,'decided_at',d.decided_at) order by d.decided_at desc),'[]'::jsonb)
            from (select * from public.wip_release_decisions x where x.company_id=p_company and x.stage=st.stage order by x.decided_at desc limit 10) d left join public.production_jobs j on j.id=d.job_id and j.company_id=d.company_id) end)),
      case cs.s when 'over' then 0 when 'unmeasured_incomplete' then 1 when 'near' then 2 when 'within' then 4 else 6 end,null::date,ag.oldest
    from st left join public.stage_wip_limits l on l.company_id=p_company and l.stage=st.stage and l.status='active' left join ag on ag.stage=st.stage cross join up
    cross join lateral (select case when l.unit='kg' then coalesce(ag.kg,0) when l.unit='jobs' then coalesce(ag.jobs,0) end v) cv
    cross join lateral (select case when l.id is null then 'no_limit' when l.unit='kg' and coalesce(ag.unmeasured,0)>0 and cv.v<l.limit_value then 'unmeasured_incomplete' when cv.v>=l.limit_value then 'over' when cv.v>=0.8*l.limit_value then 'near' else 'within' end s) cs
    where (p_id is null or coalesce(l.id,md5(p_company::text||':wip:'||st.stage)::uuid)=p_id) and (p_id is not null or p_state='all' or cs.s<>'no_limit') order by st.ord;

  elsif p_view='assignments' then
    return query select jsonb_build_object('id',t.id,'label',t.title,'status',st.s,'owner',au.full_name,'due_date',t.due_date,
        'summary',concat(replace(t.task_type,'_',' '),' · ',t.priority,' · ',case st.s when 'unassigned' then 'nobody assigned' when 'assignee_away' then au.full_name||' is unavailable today' else au.full_name||' is no longer eligible' end),
        'source_href','/tasks/'||t.id,
        'details',jsonb_build_object('task_id',t.id,'task_type',t.task_type,'task_status',t.status,'priority',t.priority,'assigned_to',t.assigned_to,'assignee_check',ck.c,
          'version',private.execution_version(t.updated_at),'rule',case when ar.id is null then null else jsonb_build_object('allowed_roles',ar.allowed_roles,'estimate_minutes',ar.estimate_minutes,'competency',cp.name) end,
          'candidates',case when p_id is null then '[]'::jsonb else private.assignment_candidates(p_company,t) end,'running_task_note',case when t.status='in_progress' then 'This task is running and is not moved by a recommendation.' end)),
      case st.s when 'assignee_ineligible' then 0 when 'assignee_away' then 1 else 2 end,t.due_date,t.updated_at
    from public.tasks t left join public.app_users au on au.id=t.assigned_to and au.company_id=t.company_id left join public.assignment_rules ar on ar.company_id=t.company_id and ar.task_type=t.task_type and ar.status='active'
    left join public.competencies cp on cp.id=ar.required_competency_id and cp.company_id=t.company_id
    cross join lateral (select case when t.assigned_to is null then null else private.assignment_check(p_company,t,t.assigned_to) end c) ck
    cross join lateral (select case when t.assigned_to is null then 'unassigned' when not (ck.c->>'hard_ok')::boolean then 'assignee_ineligible' when (ck.c->>'away')::boolean then 'assignee_away' else 'assigned' end s) st
    where t.company_id=p_company and t.dealership_id is null and (p_id is null or t.id=p_id) and (p_id is not null or (t.status in ('open','in_progress') and (p_state='all' or st.s<>'assigned')));

  elsif p_view='rules' then
    return query select jsonb_build_object('id',r.id,'label',concat('Assignment rule · ',replace(r.task_type,'_',' ')),'status',r.status,'owner',cu.full_name,'due_date',null,
        'summary',concat('Roles: ',array_to_string(r.allowed_roles,', '),case when r.required_competency_id is not null then ' · requires '||coalesce(cp.name,'a competency') else '' end,
          case when r.estimate_minutes is null then ' · no duration estimate' else ' · about '||r.estimate_minutes||' min' end),'source_href',null,
        'details',jsonb_build_object('kind','rule','rule_id',r.id,'task_type',r.task_type,'allowed_roles',r.allowed_roles,'competency_id',r.required_competency_id,'competency',cp.name,'estimate_minutes',r.estimate_minutes,'rule_status',r.status,'created_by',cu.full_name)),
      case when r.status='active' then 3 else 9 end,null::date,r.created_at
    from public.assignment_rules r left join public.competencies cp on cp.id=r.required_competency_id and cp.company_id=r.company_id left join public.app_users cu on cu.id=r.created_by and cu.company_id=r.company_id
    where r.company_id=p_company and (p_id is null or r.id=p_id) and (p_id is not null or p_state='all' or r.status='active');
    return query select jsonb_build_object('id',x.id,'label',concat('Unavailable · ',e.full_name),'status',case when x.cancelled_at is not null then 'cancelled' when x.ends_on<v_today then 'past' when x.starts_on>v_today then 'upcoming' else 'current' end,
        'owner',e.full_name,'due_date',x.ends_on,'summary',concat(replace(x.kind,'_',' '),' · ',to_char(x.starts_on,'DD Mon'),' to ',to_char(x.ends_on,'DD Mon YYYY')),'source_href',null,
        'details',jsonb_build_object('kind','unavailability','employee_id',x.employee_id,'employee',e.full_name,'starts_on',x.starts_on,'ends_on',x.ends_on,'availability_kind',x.kind,'cancelled_at',x.cancelled_at,'recorded_by',ru.full_name)),
      case when x.cancelled_at is null and x.starts_on<=v_today and x.ends_on>=v_today then 1 else 8 end,x.ends_on,x.created_at
    from public.employee_unavailability x join public.app_users e on e.id=x.employee_id and e.company_id=x.company_id left join public.app_users ru on ru.id=x.recorded_by and ru.company_id=x.company_id
    where x.company_id=p_company and (p_id is null or x.id=p_id) and (p_id is not null or p_state='all' or (x.cancelled_at is null and x.ends_on>=v_today));

  elsif p_view='routes' then
    return query select jsonb_build_object('id',f.id,'label',concat(f.name,' · v',f.version),'status',f.status,'owner',cu.full_name,'due_date',null,
        'summary',concat(f.applies_when,' · ',cardinality(f.required_stages),' required stage(s)',case when cardinality(f.optional_stages)>0 then ', '||cardinality(f.optional_stages)||' optional' else '' end),'source_href',null,
        'details',jsonb_build_object('kind','family','family_id',f.id,'code',f.code,'name',f.name,'version',f.version,'applies_when',f.applies_when,'required_stages',f.required_stages,'optional_stages',f.optional_stages,'family_status',f.status,
          'created_by',cu.full_name,'created_by_id',f.created_by,'approved_by',au.full_name,'approved_at',f.approved_at,'orders_bound',(select count(*) from public.order_route_bindings b where b.company_id=p_company and b.family_id=f.id and b.status='active'))),
      case f.status when 'draft' then 1 when 'approved' then 3 else 9 end,null::date,f.created_at
    from public.route_families f left join public.app_users cu on cu.id=f.created_by and cu.company_id=f.company_id left join public.app_users au on au.id=f.approved_by and au.company_id=f.company_id
    where f.company_id=p_company and (p_id is null or f.id=p_id) and (p_id is not null or p_state='all' or f.status in ('draft','approved'));
    return query select jsonb_build_object('id',v.id,'label',concat('Deviation · ',o.order_number,' · ',replace(v.stage,'_',' ')),'status',v.status,'owner',ru.full_name,'due_date',null,'summary',left(v.reason,140),'source_href','/orders/'||o.id,
        'details',jsonb_build_object('kind','deviation','deviation_id',v.id,'order_id',o.id,'order_number',o.order_number,'stage',v.stage,'reason',v.reason,'deviation_status',v.status,'requested_by',ru.full_name,'requested_by_id',v.requested_by,
          'decided_by',du.full_name,'decision_note',v.decision_note,'route',b.family_code||' v'||b.family_version)),
      case when v.status='requested' then 0 else 9 end,null::date,v.created_at
    from public.order_route_deviations v join public.orders o on o.id=v.order_id and o.company_id=v.company_id join public.order_route_bindings b on b.id=v.binding_id
    left join public.app_users ru on ru.id=v.requested_by and ru.company_id=v.company_id left join public.app_users du on du.id=v.decided_by and du.company_id=v.company_id
    where v.company_id=p_company and (p_id is null or v.id=p_id) and (p_id is not null or p_state='all' or v.status='requested');

  elsif p_view='messages' then
    return query select jsonb_build_object('id',m.id,'label',concat(replace(m.template,'_',' '),' · ',coalesce(o.order_number,'record')),'status',m.state,'owner',cu.full_name,'due_date',(m.created_at at time zone 'Asia/Kolkata')::date,
        'summary',concat(case m.state when 'prepared' then 'Prepared, not sent' when 'copied' then 'Copied for sending by hand' when 'printed' then 'Printed' when 'downloaded' then 'Downloaded' else replace(m.state,'_',' ') end,' · to ',m.recipient_name),
        'source_href',case m.entity_type when 'order' then '/orders/'||m.entity_id when 'dispatch' then '/dispatches/'||m.entity_id else '/tasks/execution/appointments/'||m.entity_id end,
        'details',jsonb_build_object('communication_id',m.id,'template',m.template,'entity_type',m.entity_type,'entity_id',m.entity_id,'recipient_name',m.recipient_name,'recipient_phone',m.recipient_phone,'recipient_source',m.recipient_source,
          'message_body',m.message_body,'document_label',m.document_label,'document_href',m.document_href,'message_state',m.state,'state_changed_at',m.state_changed_at,'prepared_by',cu.full_name,'created_at',m.created_at,
          'stale',case when p_id is not null and m.state='prepared' then coalesce((select (private.message_build(p_company,m.template,m.entity_id,case when m.recipient_source='entered' then m.recipient_phone end)->>'fingerprint')<>m.source_fingerprint),true) end,
          'delivery_note','This system records preparation only. Sending, delivery and reading are not tracked.')),
      case m.state when 'prepared' then 1 else 8 end,(m.created_at at time zone 'Asia/Kolkata')::date,m.created_at
    from public.document_communications m left join public.app_users cu on cu.id=m.created_by and cu.company_id=m.company_id
    left join public.orders o on o.company_id=m.company_id and o.id=case m.entity_type when 'order' then m.entity_id when 'dispatch' then (select d.order_id from public.dispatches d where d.id=m.entity_id and d.company_id=m.company_id)
      else (select a.order_id from public.delivery_appointments a where a.id=m.entity_id and a.company_id=m.company_id) end
    where m.company_id=p_company and (p_id is null or m.id=p_id) and (p_id is not null or p_state='all' or m.state='prepared');

  elsif p_view='queue' then
    return query select jsonb_build_object('id',t.id,'label',t.title,'status',t.status,'owner',au.full_name,'due_date',t.due_date,
        'summary',concat(replace(t.task_type,'_',' '),' · ',t.priority,' priority · ',case when au.full_name is null then 'unassigned' else 'assigned to '||au.full_name end),'source_href','/tasks/'||t.id,
        'details',jsonb_build_object('task_id',t.id,'task_type',t.task_type,'task_status',t.status,'priority',t.priority,'assigned_to',t.assigned_to,'due_date',t.due_date,'version',private.execution_version(t.updated_at),
          'locked_by_handoff',t.handoff_key is not null)),
      case when t.due_date<v_today then 0 when t.priority='urgent' then 1 else 5 end,t.due_date,t.updated_at
    from public.tasks t left join public.app_users au on au.id=t.assigned_to and au.company_id=t.company_id
    where t.company_id=p_company and t.dealership_id is null and (p_id is null or t.id=p_id) and (p_id is not null or t.status in ('open','in_progress'));
  end if;
end $$;
revoke all on function private.execution_rows(uuid,uuid,text,text,text,uuid,integer) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Lookups, shape checks and the load review.
------------------------------------------------------------------------------------------------
create function private.execution_fmt(p_at timestamptz) returns text language sql immutable set search_path=public,private as $$
  select to_char(p_at at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI')
$$;
create function private.execution_slot(p_start timestamptz,p_end timestamptz,p_future boolean) returns void language plpgsql immutable set search_path=public,private as $$
begin
  if p_end<=p_start or p_end>p_start+interval '48 hours' then raise exception 'NOV: The end must be after the start and within 48 hours (an overnight slot is allowed).'; end if;
  if p_future and p_start<now()-interval '1 hour' then raise exception 'NOV: The requested time has already passed.'; end if;
end $$;
revoke all on function private.execution_fmt(timestamptz),private.execution_slot(timestamptz,timestamptz,boolean) from public,anon,authenticated;

create function private.execution_assert_shape(p_mutation jsonb) returns void language plpgsql set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_keys text[]; v_optional text[]:='{}'; v_noteless boolean; n text:=btrim(coalesce(p_mutation->>'note',''));
begin
  v_keys:=case a
    when 'appointment.request' then array['order_id','requested_start','requested_end','owner_id'] when 'appointment.confirm' then array['id','confirmed_start','confirmed_end','confirmed_by_name']
    when 'appointment.reschedule' then array['id','requested_start','requested_end'] when 'appointment.cancel' then array['id'] when 'appointment.arrive' then array['id'] when 'appointment.outcome' then array['id','result']
    when 'gatepass.issue' then array['item_kind','item_label','quantity','custodian_name','custodian_kind','purpose','due_date','owner_id'] when 'gatepass.depart' then array['id']
    when 'gatepass.acknowledge' then array['id','acknowledged_by_name'] when 'gatepass.return' then array['id','quantity','condition'] when 'gatepass.lose' then array['id','quantity']
    when 'gatepass.extend' then array['id','due_date'] when 'gatepass.cancel' then array['id']
    when 'loadplan.stop' then array['load_id','order_id','stop_seq'] when 'loadplan.confirm' then array['item_id','status','method'] when 'loadplan.review' then array['load_id']
    when 'window.set' then array['horizon_hours','enforce'] when 'window.retire' then array['id'] when 'window.request' then array['job_id','new_date','customer_effect']
    when 'window.approve' then array['id'] when 'window.reject' then array['id']
    when 'wip.set_limit' then array['stage','unit','limit_value','basis'] when 'wip.retire_limit' then array['id'] when 'wip.release' then array['job_id','stage']
    when 'rule.set' then array['task_type','allowed_roles'] when 'rule.retire' then array['id'] when 'availability.record' then array['employee_id','starts_on','ends_on','kind']
    when 'availability.cancel' then array['id'] when 'assignment.assign' then array['id','assignee_id']
    when 'route.define' then array['code','name','applies_when','required_stages'] when 'route.approve' then array['id'] when 'route.retire' then array['id'] when 'route.bind' then array['order_id','family_id']
    when 'route.deviate' then array['order_id','stage'] when 'route.decide' then array['id','decision']
    when 'message.prepare' then array['template','entity_id'] when 'message.mark' then array['id','state'] when 'message.cancel' then array['id']
    when 'queue.update' then array['selection','field','value','records'] end;
  v_optional:=case a
    when 'appointment.request' then array['dispatch_id','site_address','contact_name','contact_phone','access_restrictions','preparations']
    when 'appointment.reschedule' then array['site_address','contact_name','contact_phone','access_restrictions','preparations'] when 'gatepass.issue' then array['die_id','serial_ref']
    when 'loadplan.stop' then array['unload_note'] when 'window.set' then array['machine_id'] when 'window.request' then array['new_shift'] when 'rule.set' then array['competency_id','estimate_minutes']
    when 'assignment.assign' then array['override_reason'] when 'route.define' then array['optional_stages'] when 'message.prepare' then array['recipient_phone'] else '{}'::text[] end;
  -- Messages and inline queue updates carry their own meaning; a second explanation would only add typing.
  v_noteless:=a like 'message.%' or a='queue.update';
  if jsonb_typeof(p_mutation) is distinct from 'object' or v_keys is null or not(p_mutation ?& (v_keys||array['action']||case when v_noteless then '{}'::text[] else array['note'] end))
    or exists(select 1 from jsonb_object_keys(p_mutation) k where not(k=any(v_keys||v_optional||array['action']||case when v_noteless then '{}'::text[] else array['note'] end)))
    or (not v_noteless and (length(n) not between 5 and 500 or n ~ '[[:cntrl:]]'))
    or exists(select 1 from jsonb_each(p_mutation) x where jsonb_typeof(x.value)='null') then raise exception 'NOV: Review the required action details.'; end if;
end $$;
revoke all on function private.execution_assert_shape(jsonb) from public,anon,authenticated;

create function private.execution_lookup(p_company uuid,p_actor uuid,p_role text,p_payload jsonb) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare k text:=p_payload->>'kind'; s text:=lower(btrim(coalesce(p_payload->>'search',''))); v_sel uuid; v_parent uuid; v jsonb; v_view text;
begin
  if p_payload ? 'selected_id' then v_sel:=private.execution_uuid(p_payload,'selected_id'); end if;
  if p_payload ? 'parent_id' then v_parent:=private.execution_uuid(p_payload,'parent_id'); end if;
  v_view:=case k when 'employees' then null when 'orders' then null when 'dispatches' then 'appointments' when 'dies' then 'gate_passes' when 'jobs' then 'windows' when 'machines' then 'windows'
    when 'competencies' then 'rules' when 'families' then 'routes' end;
  if k is null or k not in ('employees','orders','dispatches','dies','jobs','machines','competencies','families') or not private.execution_read_allowed(p_role,v_view) then raise exception 'Not permitted' using errcode='42501'; end if;
  if k='employees' then
    select coalesce(jsonb_agg(jsonb_build_object('value',u.id,'label',coalesce(nullif(u.full_name,''),u.email),'context',replace(u.role,'_',' ')) order by u.full_name,u.id),'[]'::jsonb) into v from (
      select * from public.app_users u where u.company_id=p_company and u.is_active and u.dealer_id is null and u.role not in ('viewer','dealer_admin','dealer_staff')
        and (v_sel is null or u.id=v_sel) and (s='' or position(s in lower(coalesce(u.full_name,'')||' '||coalesce(u.email,'')||' '||u.role))>0) order by u.full_name,u.id limit 20) u;
  elsif k='orders' then
    select coalesce(jsonb_agg(jsonb_build_object('value',o.id,'label',o.order_number,'context',concat(coalesce(c.customer_name,'Customer'),' · ',replace(o.current_stage,'_',' '))) order by o.created_at desc,o.id),'[]'::jsonb) into v from (
      select * from public.orders o where o.company_id=p_company and o.deleted_at is null and (v_sel is null or o.id=v_sel) and (v_sel is not null or o.current_stage not in ('cancelled','closed'))
        and (s='' or position(s in lower(o.order_number))>0) order by o.created_at desc,o.id limit 20) o left join public.customers c on c.id=o.customer_id and c.company_id=o.company_id;
  elsif k='dispatches' then
    select coalesce(jsonb_agg(jsonb_build_object('value',d.id,'label',coalesce(d.dispatch_number,'Dispatch'),'context',concat(d.delivery_status,' · ',d.number_of_bundles,' bundle(s), ',trim_scale(d.total_weight_kg),' kg')) order by d.dispatch_date desc,d.id),'[]'::jsonb) into v from (
      select * from public.dispatches d where d.company_id=p_company and (v_sel is null or d.id=v_sel) and (v_parent is null or d.order_id=v_parent) and (s='' or position(s in lower(coalesce(d.dispatch_number,'')))>0)
        order by d.dispatch_date desc,d.id limit 20) d;
  elsif k='dies' then
    select coalesce(jsonb_agg(jsonb_build_object('value',d.id,'label',d.die_number,'context',concat(d.die_status,case when g.pass_number is not null then ' · on pass '||g.pass_number else '' end)) order by d.die_number,d.id),'[]'::jsonb) into v from (
      select * from public.dies d where d.company_id=p_company and d.deleted_at is null and (v_sel is null or d.id=v_sel) and (s='' or position(s in lower(d.die_number))>0) order by d.die_number,d.id limit 20) d
      left join public.returnable_gate_passes g on g.company_id=d.company_id and g.die_id=d.id and g.status in ('approved','out');
  elsif k='jobs' then
    select coalesce(jsonb_agg(jsonb_build_object('value',j.id,'label',coalesce(j.job_number,'Production job'),'context',concat(j.status,' · planned ',coalesce(to_char(j.planned_date,'DD Mon'),'no date'),case when j.shift is not null then ' · '||j.shift else '' end)) order by j.planned_date nulls last,j.id),'[]'::jsonb) into v from (
      select * from public.production_jobs j where j.company_id=p_company and (v_sel is null or j.id=v_sel) and (v_sel is not null or j.status in ('planned','ready','on_hold','in_progress'))
        and (s='' or position(s in lower(coalesce(j.job_number,'')))>0) order by j.planned_date nulls last,j.id limit 20) j;
  elsif k='machines' then
    select coalesce(jsonb_agg(jsonb_build_object('value',m.id,'label',m.machine_name,'context',coalesce(m.machine_code,m.machine_type)) order by m.machine_name,m.id),'[]'::jsonb) into v from (
      select * from public.machines m where m.company_id=p_company and m.is_active and (v_sel is null or m.id=v_sel) and (s='' or position(s in lower(m.machine_name))>0) order by m.machine_name,m.id limit 20) m;
  elsif k='competencies' then
    select coalesce(jsonb_agg(jsonb_build_object('value',c.id,'label',c.name,'context',c.code) order by c.name,c.id),'[]'::jsonb) into v from (
      select * from public.competencies c where c.company_id=p_company and c.is_active and (v_sel is null or c.id=v_sel) and (s='' or position(s in lower(c.name||' '||c.code))>0) order by c.name,c.id limit 20) c;
  else
    select coalesce(jsonb_agg(jsonb_build_object('value',f.id,'label',concat(f.name,' · v',f.version),'context',f.applies_when) order by f.name,f.id),'[]'::jsonb) into v from (
      select * from public.route_families f where f.company_id=p_company and f.status='approved' and (v_sel is null or f.id=v_sel) and (s='' or position(s in lower(f.name||' '||f.code))>0) order by f.name,f.id limit 20) f;
  end if;
  return v;
end $$;
revoke all on function private.execution_lookup(uuid,uuid,text,jsonb) from public,anon,authenticated;

-- NOV-036: what stands between this load and departure. Weight is checked against the vehicle capacity
-- recorded on the load; no statutory limit is encoded here.
create function private.load_findings(p_company uuid,p_load uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare l public.factory_vehicle_loads; v_block jsonb:='[]'::jsonb; v_warn jsonb:='[]'::jsonb; v_loaded numeric; v_planned numeric; v_n integer; v_x record;
begin
  select * into l from public.factory_vehicle_loads where id=p_load and company_id=p_company;
  if l.id is null then raise exception 'NOV: The vehicle load is unavailable.'; end if;
  select coalesce(sum(i.net_weight_kg),0) into v_planned from public.factory_vehicle_load_items i where i.company_id=p_company and i.load_id=l.id and i.status='active';
  select coalesce(sum(i.net_weight_kg),0) into v_loaded from public.load_item_confirmations c join public.factory_vehicle_load_items i on i.id=c.item_id and i.company_id=c.company_id
    where c.company_id=p_company and c.load_id=l.id and c.status='loaded' and i.status='active';
  if v_planned=0 then v_block:=v_block||jsonb_build_array('The load has no active bundles'); end if;
  if v_loaded>l.capacity_kg then v_block:=v_block||jsonb_build_array(format('Confirmed weight %s kg exceeds the vehicle capacity of %s kg',trim_scale(v_loaded),trim_scale(l.capacity_kg))); end if;
  if v_planned>l.capacity_kg then v_warn:=v_warn||jsonb_build_array(format('Planned weight %s kg is above the vehicle capacity of %s kg; remove material before loading',trim_scale(v_planned),trim_scale(l.capacity_kg))); end if;
  for v_x in select o.order_number,o.current_stage from public.orders o where o.company_id=p_company and o.id in (select i.order_id from public.factory_vehicle_load_items i where i.company_id=p_company and i.load_id=l.id and i.status='active' and not exists(select 1 from public.load_item_confirmations c where c.item_id=i.id and c.company_id=p_company and c.status='not_loaded'))
    and not exists(select 1 from public.load_plan_stops s where s.company_id=p_company and s.load_id=l.id and s.order_id=o.id) loop
    v_block:=v_block||jsonb_build_array(format('Order %s has no unloading stop',v_x.order_number)); end loop;
  select count(*) into v_n from public.factory_vehicle_load_items i where i.company_id=p_company and i.load_id=l.id and i.status='active' and not exists(select 1 from public.load_item_confirmations c where c.item_id=i.id and c.company_id=p_company);
  if v_n>0 then v_block:=v_block||jsonb_build_array(format('%s bundle(s) are not yet confirmed as loaded or removed',v_n)); end if;
  for v_x in select o.order_number from public.orders o where o.company_id=p_company and o.current_stage='cancelled' and o.id in (select i.order_id from public.factory_vehicle_load_items i where i.company_id=p_company and i.load_id=l.id and i.status='active' and not exists(select 1 from public.load_item_confirmations c where c.item_id=i.id and c.company_id=p_company and c.status='not_loaded')) loop
    v_block:=v_block||jsonb_build_array(format('Order %s is cancelled',v_x.order_number)); end loop;
  for v_x in select distinct o.order_number from public.factory_vehicle_load_items i join public.orders o on o.id=i.order_id and o.company_id=i.company_id join public.production_jobs j on j.company_id=i.company_id and j.order_id=i.order_id and j.source_line_id=i.source_line_id and j.status='on_hold'
    where i.company_id=p_company and i.load_id=l.id and i.status='active' and not exists(select 1 from public.load_item_confirmations c where c.item_id=i.id and c.company_id=p_company and c.status='not_loaded') loop
    v_block:=v_block||jsonb_build_array(format('A production job for order %s is on hold',v_x.order_number)); end loop;
  select count(*) into v_n from public.load_item_confirmations c where c.company_id=p_company and c.load_id=l.id and c.status='not_loaded';
  if v_n>0 then v_warn:=v_warn||jsonb_build_array(format('%s bundle(s) were removed from this load; they remain available for another plan',v_n)); end if;
  select count(*) into v_n from public.load_item_confirmations c where c.company_id=p_company and c.load_id=l.id and c.status='unloaded_exception';
  if v_n>0 then v_warn:=v_warn||jsonb_build_array(format('%s bundle(s) have an unloading exception to follow up',v_n)); end if;
  for v_x in select distinct o.order_number,a.status from public.delivery_appointments a join public.orders o on o.id=a.order_id and o.company_id=a.company_id
    where a.company_id=p_company and a.status='requested' and a.order_id in (select i.order_id from public.factory_vehicle_load_items i where i.company_id=p_company and i.load_id=l.id and i.status='active' and not exists(select 1 from public.load_item_confirmations c where c.item_id=i.id and c.company_id=p_company and c.status='not_loaded')) loop
    v_warn:=v_warn||jsonb_build_array(format('Order %s has a delivery appointment the site has not confirmed',v_x.order_number)); end loop;
  select count(distinct lower(coalesce(nullif(btrim(c.shipping_address),''),c.id::text))) into v_n from public.orders o join public.customers c on c.id=o.customer_id and c.company_id=o.company_id
    where o.company_id=p_company and o.id in (select i.order_id from public.factory_vehicle_load_items i where i.company_id=p_company and i.load_id=l.id and i.status='active' and not exists(select 1 from public.load_item_confirmations c where c.item_id=i.id and c.company_id=p_company and c.status='not_loaded'));
  if v_n>1 then v_warn:=v_warn||jsonb_build_array(format('The load serves %s different delivery sites',v_n)); end if;
  return jsonb_build_object('blockers',v_block,'warnings',v_warn,'loaded_kg',v_loaded,'planned_kg',v_planned,'capacity_kg',l.capacity_kg,'ready',jsonb_array_length(v_block)=0);
end $$;
revoke all on function private.load_findings(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Context: validate the action against current records and describe its consequence. Each function
-- returns {source, review}; the source is fingerprinted so a changed record invalidates the review.
------------------------------------------------------------------------------------------------
create function private.execution_ctx_appointment(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; o public.orders; d public.dispatches; c public.customers; ap public.delivery_appointments; v_s timestamptz; v_e timestamptz; v_addr text; v_def text; v_warn jsonb:='[]'::jsonb;
  v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_src jsonb:='{}'::jsonb; u public.app_users; v_res text; v_site_changed boolean:=false;
begin
  if a='appointment.request' then
    select * into o from public.orders where id=private.execution_uuid(p_m,'order_id') and company_id=p_company and deleted_at is null;
    if o.id is null then raise exception 'NOV: The order is unavailable.'; end if;
    if o.current_stage in ('cancelled','closed','delivered','payment_pending') then raise exception 'NOV: A delivery appointment cannot be requested for an order that is %.',replace(o.current_stage,'_',' '); end if;
    if p_m ? 'dispatch_id' then
      select * into d from public.dispatches where id=private.execution_uuid(p_m,'dispatch_id') and company_id=p_company and order_id=o.id;
      if d.id is null then raise exception 'NOV: The dispatch does not belong to this order.'; end if;
      if d.delivery_status in ('delivered','returned') then raise exception 'NOV: This dispatch is already %.',d.delivery_status; end if;
      if exists(select 1 from public.delivery_appointments x where x.company_id=p_company and x.dispatch_id=d.id and x.status in ('requested','confirmed','arrived')) then
        raise exception 'NOV: This dispatch already has an open appointment. Reschedule or cancel it instead.'; end if;
    end if;
    v_s:=private.assurance_instant(p_m,'requested_start'); v_e:=private.assurance_instant(p_m,'requested_end'); perform private.execution_slot(v_s,v_e,true);
    select * into c from public.customers where id=o.customer_id and company_id=p_company;
    v_def:=coalesce(nullif(btrim(c.shipping_address),''),nullif(btrim(c.billing_address),''));
    v_addr:=case when p_m ? 'site_address' then private.assurance_text(p_m,'site_address',5,400) else v_def end;
    if v_addr is null then raise exception 'NOV: Enter the delivery site address; the customer has no address recorded.'; end if;
    if v_def is not null and lower(regexp_replace(v_addr,'\s+',' ','g'))<>lower(regexp_replace(v_def,'\s+',' ','g')) then
      v_warn:=v_warn||jsonb_build_array('The site address differs from the customer''s default. The delivery-specific address is kept with this appointment only.'); end if;
    if p_m ? 'contact_name' then perform private.assurance_text(p_m,'contact_name',2,80); end if;
    if p_m ? 'contact_phone' then perform private.execution_phone(p_m->>'contact_phone'); end if;
    if p_m ? 'access_restrictions' then perform private.assurance_text(p_m,'access_restrictions',5,300); end if;
    if p_m ? 'preparations' then perform private.assurance_text(p_m,'preparations',5,300); end if;
    u:=private.execution_member(p_company,private.execution_uuid(p_m,'owner_id'),false);
    if exists(select 1 from public.delivery_appointments x join public.orders xo on xo.id=x.order_id and xo.company_id=x.company_id where x.company_id=p_company and xo.customer_id=o.customer_id and x.status in ('requested','confirmed')
      and tstzrange(coalesce(x.confirmed_start,x.requested_start),coalesce(x.confirmed_end,x.requested_end))&&tstzrange(v_s,v_e)) then v_warn:=v_warn||jsonb_build_array('Another open delivery to this customer overlaps this slot.'); end if;
    if d.id is not null and d.delivery_status='pending' then v_warn:=v_warn||jsonb_build_array('The dispatch is still pending. Stock, quality, credit and vehicle checks are separate from this appointment.'); end if;
    v_title:='Request a delivery appointment';
    v_effect:='Records the slot as requested only. It becomes an appointment when the site confirms it. Stock, quality, credit and vehicle checks are unchanged.';
    v_facts:=jsonb_build_object('Order',o.order_number,'Dispatch',coalesce(d.dispatch_number,'Whole order'),'Requested slot',private.execution_fmt(v_s)||' to '||private.execution_fmt(v_e)||' IST','Site',left(v_addr,160),'Follow-up owner',u.full_name);
    v_src:=jsonb_build_object('stage',o.current_stage,'order_updated',o.updated_at,'dispatch_updated',d.updated_at,'default_address',v_def);
  else
    if p_lock then perform 1 from public.delivery_appointments where id=private.execution_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into ap from public.delivery_appointments where id=private.execution_uuid(p_m,'id') and company_id=p_company;
    if ap.id is null then raise exception 'NOV: The appointment is unavailable.'; end if;
    select * into o from public.orders where id=ap.order_id and company_id=p_company;
    v_src:=jsonb_build_object('status',ap.status,'revision',ap.revision,'updated_at',ap.updated_at);
    v_facts:=jsonb_build_object('Order',o.order_number,'Current status',replace(ap.status,'_',' '),'Revision',ap.revision);
    if a='appointment.confirm' then
      if ap.status<>'requested' then raise exception 'NOV: Only a requested appointment can be confirmed; this one is %.',replace(ap.status,'_',' '); end if;
      v_s:=private.assurance_instant(p_m,'confirmed_start'); v_e:=private.assurance_instant(p_m,'confirmed_end'); perform private.execution_slot(v_s,v_e,false);
      if v_s<now()-interval '1 day' then raise exception 'NOV: The confirmed slot starts more than a day ago.'; end if;
      perform private.assurance_text(p_m,'confirmed_by_name',3,80);
      if v_s<ap.requested_start-interval '12 hours' or v_s>ap.requested_end+interval '12 hours' then v_warn:=v_warn||jsonb_build_array('The confirmed slot is more than 12 hours away from the requested slot.'); end if;
      v_title:='Record the site''s confirmation'; v_effect:='Keeps the requested slot and records what the site agreed. The dispatch itself is not released or approved by this confirmation.';
      v_facts:=v_facts||jsonb_build_object('Confirmed slot',private.execution_fmt(v_s)||' to '||private.execution_fmt(v_e)||' IST','Confirmed by',btrim(p_m->>'confirmed_by_name'),'Originally requested',private.execution_fmt(ap.requested_start)||' to '||private.execution_fmt(ap.requested_end));
    elsif a='appointment.reschedule' then
      if ap.status not in ('requested','confirmed') then raise exception 'NOV: A % appointment cannot be rescheduled.',replace(ap.status,'_',' '); end if;
      v_s:=private.assurance_instant(p_m,'requested_start'); v_e:=private.assurance_instant(p_m,'requested_end'); perform private.execution_slot(v_s,v_e,true);
      if p_m ? 'site_address' then v_addr:=private.assurance_text(p_m,'site_address',5,400); v_site_changed:=lower(regexp_replace(v_addr,'\s+',' ','g'))<>lower(regexp_replace(ap.site_address,'\s+',' ','g')); end if;
      if p_m ? 'contact_name' then perform private.assurance_text(p_m,'contact_name',2,80); end if;
      if p_m ? 'contact_phone' then perform private.execution_phone(p_m->>'contact_phone'); end if;
      if p_m ? 'access_restrictions' then perform private.assurance_text(p_m,'access_restrictions',5,300); end if;
      if p_m ? 'preparations' then perform private.assurance_text(p_m,'preparations',5,300); end if;
      if ap.status='confirmed' then v_warn:=v_warn||jsonb_build_array('The site''s earlier confirmation is kept in history and the appointment needs reconfirmation.'); end if;
      if v_site_changed then v_warn:=v_warn||jsonb_build_array('The site address changes; dispatch must reconfirm access and the receiving contact.'); end if;
      v_title:='Reschedule or change the arrangements'; v_effect:='Retains the earlier revision and asks the site to confirm the new arrangement. Nothing is rewritten.';
      v_facts:=v_facts||jsonb_build_object('New requested slot',private.execution_fmt(v_s)||' to '||private.execution_fmt(v_e)||' IST','Site changed',case when v_site_changed then 'Yes' else 'No' end);
    elsif a='appointment.cancel' then
      if ap.status not in ('requested','confirmed') then raise exception 'NOV: A % appointment cannot be cancelled.',replace(ap.status,'_',' '); end if;
      v_title:='Cancel the appointment'; v_effect:='Closes the appointment with your reason. The dispatch and order are unchanged.';
    elsif a='appointment.arrive' then
      if ap.status<>'confirmed' then raise exception 'NOV: Only a confirmed appointment can be marked arrived; this one is %.',replace(ap.status,'_',' '); end if;
      if now()<ap.confirmed_start-interval '2 hours' then v_warn:=v_warn||jsonb_build_array('The vehicle is arriving more than 2 hours before the confirmed slot.'); end if;
      if now()>ap.confirmed_end then v_warn:=v_warn||jsonb_build_array('The vehicle is arriving after the confirmed slot ended.'); end if;
      v_title:='Record arrival at the site'; v_effect:='Records the actual arrival time as a separate fact from the confirmed slot.';
    elsif a='appointment.outcome' then
      v_res:=p_m->>'result';
      if v_res not in ('completed','unloading_failed','missed') then raise exception 'NOV: Choose the outcome: completed, unloading failed or missed.'; end if;
      if v_res in ('completed','unloading_failed') and ap.status<>'arrived' then raise exception 'NOV: Record the arrival before the unloading outcome.'; end if;
      if v_res='missed' and not (ap.status='confirmed' and ap.confirmed_end<now()) then raise exception 'NOV: Only a confirmed appointment whose slot has passed can be recorded as missed.'; end if;
      v_title:='Record the delivery outcome'; v_effect:='Closes the appointment with the outcome and your note. Dispositions, returns and invoicing continue in their own workflows.';
      v_facts:=v_facts||jsonb_build_object('Outcome',replace(v_res,'_',' '));
    end if;
  end if;
  return jsonb_build_object('source',v_src,'review',private.execution_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.execution_ctx_gatepass(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; g public.returnable_gate_passes; dn public.dies; v_kind text; v_qty numeric; v_date date; v_warn jsonb:='[]'::jsonb; v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_src jsonb:='{}'::jsonb;
  u public.app_users; v_n integer; v_bal integer;
begin
  if a='gatepass.issue' then
    v_kind:=p_m->>'item_kind';
    if v_kind not in ('die','gauge','rack','pallet','other') then raise exception 'NOV: Choose what is leaving.'; end if;
    perform private.assurance_text(p_m,'item_label',2,120); perform private.assurance_text(p_m,'custodian_name',2,120); perform private.assurance_text(p_m,'purpose',5,300);
    if p_m->>'custodian_kind' not in ('vendor','customer','employee','other') then raise exception 'NOV: Choose who will hold the item.'; end if;
    v_qty:=private.assurance_number(p_m,'quantity',1,10000,0); v_date:=private.assurance_date(p_m,'due_date');
    if v_date<private.ist_today() then raise exception 'NOV: The expected return date cannot be in the past.'; end if;
    if v_date>private.ist_today()+365 then raise exception 'NOV: The expected return date must be within a year.'; end if;
    u:=private.execution_member(p_company,private.execution_uuid(p_m,'owner_id'),false);
    if v_kind='die' then
      if not (p_m ? 'die_id') then raise exception 'NOV: Choose the die that is leaving.'; end if;
      if v_qty<>1 then raise exception 'NOV: A die leaves as one serialised item.'; end if;
      select * into dn from public.dies where id=private.execution_uuid(p_m,'die_id') and company_id=p_company and deleted_at is null;
      if dn.id is null then raise exception 'NOV: The die is unavailable.'; end if;
      select count(*) into v_n from public.returnable_gate_passes x where x.company_id=p_company and x.die_id=dn.id and x.status in ('approved','out');
      if v_n>0 then raise exception 'NOV: Die % already has an open gate pass. Close it before issuing another.',dn.die_number; end if;
      if dn.die_status not in ('active','available','ready') then v_warn:=v_warn||jsonb_build_array(format('The die is currently %s.',replace(dn.die_status,'_',' '))); end if;
      select count(*) into v_n from public.production_jobs j where j.company_id=p_company and j.die_id=dn.id and j.status in ('planned','ready','in_progress') and (j.planned_date is null or j.planned_date<=v_date);
      if v_n>0 then v_warn:=v_warn||jsonb_build_array(format('%s planned or running job(s) use this die before its expected return. Planning will treat the die as with the custodian.',v_n)); end if;
    else
      if p_m ? 'die_id' then raise exception 'NOV: Only a die pass names a die.'; end if;
      if p_m ? 'serial_ref' then
        perform private.assurance_text(p_m,'serial_ref',1,60);
        if v_qty<>1 then raise exception 'NOV: A serialised item leaves as quantity 1.'; end if;
        if exists(select 1 from public.returnable_gate_passes x where x.company_id=p_company and x.item_kind=v_kind and lower(x.serial_ref)=lower(btrim(p_m->>'serial_ref')) and x.status in ('approved','out')) then
          raise exception 'NOV: % % already has an open gate pass.',v_kind,btrim(p_m->>'serial_ref'); end if;
      end if;
    end if;
    v_title:='Issue a returnable gate pass'; v_effect:='Approves the item to leave and starts custody tracking. It is not a sale or a permanent stock transfer.';
    v_facts:=jsonb_build_object('Item',btrim(p_m->>'item_label'),'Kind',v_kind,'Quantity',v_qty,'Held by',btrim(p_m->>'custodian_name'),'Expected back',to_char(v_date,'DD Mon YYYY'),'Return follow-up',u.full_name);
    v_src:=jsonb_build_object('die',dn.id,'die_status',dn.die_status);
  else
    if p_lock then perform 1 from public.returnable_gate_passes where id=private.execution_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into g from public.returnable_gate_passes where id=private.execution_uuid(p_m,'id') and company_id=p_company;
    if g.id is null then raise exception 'NOV: The gate pass is unavailable.'; end if;
    v_bal:=g.quantity-g.returned_quantity-g.lost_quantity;
    v_src:=jsonb_build_object('status',g.status,'returned',g.returned_quantity,'lost',g.lost_quantity,'due',g.due_date,'updated_at',g.updated_at);
    v_facts:=jsonb_build_object('Pass',g.pass_number,'Item',g.item_label,'Status',replace(g.status,'_',' '),'Balance',v_bal||' of '||g.quantity);
    if a='gatepass.depart' then
      if g.status<>'approved' then raise exception 'NOV: Only an approved pass that has not left can be marked departed; this one is %.',g.status; end if;
      if g.die_id is not null then select count(*) into v_n from public.production_jobs j where j.company_id=p_company and j.die_id=g.die_id and j.status in ('planned','ready','in_progress') and j.planned_date<=g.due_date;
        if v_n>0 then v_warn:=v_warn||jsonb_build_array(format('%s planned or running job(s) use this die before its expected return.',v_n)); end if; end if;
      v_title:='Record departure'; v_effect:='Marks the item as out with the custodian from now on.';
    elsif a='gatepass.acknowledge' then
      if g.status<>'out' then raise exception 'NOV: Receipt can only be acknowledged for an item that is out.'; end if;
      if g.acknowledged_at is not null then raise exception 'NOV: Receipt was already acknowledged by %.',g.acknowledged_by_name; end if;
      perform private.assurance_text(p_m,'acknowledged_by_name',2,80);
      v_title:='Record the custodian''s acknowledgement'; v_effect:='Records who confirmed receiving the item.';
      v_facts:=v_facts||jsonb_build_object('Acknowledged by',btrim(p_m->>'acknowledged_by_name'));
    elsif a='gatepass.return' then
      if g.status<>'out' then raise exception 'NOV: Only an item that is out can be returned; this pass is %.',g.status; end if;
      v_qty:=private.assurance_number(p_m,'quantity',1,10000,0);
      if v_qty>v_bal then raise exception 'NOV: Only % item(s) are outstanding on this pass.',v_bal; end if;
      if p_m->>'condition' not in ('good','damaged') then raise exception 'NOV: State the condition on return.'; end if;
      if p_m->>'condition'='damaged' then v_warn:=v_warn||jsonb_build_array('Damaged items stay on record. Inspect and repair them in the die, quality or maintenance workflow before reuse.'); end if;
      if v_qty=v_bal then v_effect:='Returns the last outstanding item and closes the pass.'; else v_effect:='Records a partial return; the balance stays with the custodian.'; end if;
      v_title:='Record a return'; v_facts:=v_facts||jsonb_build_object('Returning',v_qty,'Condition',p_m->>'condition');
    elsif a='gatepass.lose' then
      if g.status<>'out' then raise exception 'NOV: Only an item that is out can be recorded as lost.'; end if;
      v_qty:=private.assurance_number(p_m,'quantity',1,10000,0);
      if v_qty>v_bal then raise exception 'NOV: Only % item(s) are outstanding on this pass.',v_bal; end if;
      v_warn:=v_warn||jsonb_build_array('A loss is permanent in the record. Investigate and arrange a replacement through the relevant workflow.');
      v_title:='Record a loss'; v_effect:='Removes the lost quantity from the balance with your explanation.'; v_facts:=v_facts||jsonb_build_object('Lost',v_qty);
    elsif a='gatepass.extend' then
      if g.status<>'out' then raise exception 'NOV: Only an item that is out can have its return date extended.'; end if;
      v_date:=private.assurance_date(p_m,'due_date');
      if v_date<=g.due_date then raise exception 'NOV: The new date must be after the current expected return of %.',to_char(g.due_date,'DD Mon YYYY'); end if;
      if v_date>g.due_date+90 or v_date>private.ist_today()+365 then raise exception 'NOV: An extension can add at most 90 days.'; end if;
      if g.extension_count>=3 then raise exception 'NOV: This pass has already been extended three times. Close it or escalate to the factory manager.'; end if;
      if g.due_date<private.ist_today() then v_warn:=v_warn||jsonb_build_array('This pass is overdue; the extension is recorded after the expected date passed.'); end if;
      v_title:='Extend the expected return'; v_effect:='Keeps the original date and records the authorised extension.'; v_facts:=v_facts||jsonb_build_object('New date',to_char(v_date,'DD Mon YYYY'),'Extensions so far',g.extension_count);
    elsif a='gatepass.cancel' then
      if g.status<>'approved' then raise exception 'NOV: Only a pass that has not left can be cancelled.'; end if;
      v_title:='Cancel the gate pass'; v_effect:='Releases the item for another pass. Nothing has left.';
    end if;
  end if;
  return jsonb_build_object('source',v_src,'review',private.execution_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.execution_ctx_loadplan(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; l public.factory_vehicle_loads; i public.factory_vehicle_load_items; o public.orders; cf public.load_item_confirmations; v_w numeric; v_n integer; v_warn jsonb:='[]'::jsonb; v_title text; v_effect text;
  v_facts jsonb:='{}'::jsonb; v_src jsonb:='{}'::jsonb; v_find jsonb; v_seq numeric; v_status text; v_bundle text;
begin
  if a='loadplan.confirm' then
    if p_lock then perform 1 from public.factory_vehicle_load_items where id=private.execution_uuid(p_m,'item_id') and company_id=p_company for update; end if;
    select * into i from public.factory_vehicle_load_items where id=private.execution_uuid(p_m,'item_id') and company_id=p_company;
    if i.id is null then raise exception 'NOV: The bundle is not on a load in this company.'; end if;
    select * into l from public.factory_vehicle_loads where id=i.load_id and company_id=p_company;
  else
    select * into l from public.factory_vehicle_loads where id=private.execution_uuid(p_m,'load_id') and company_id=p_company;
  end if;
  if l.id is null then raise exception 'NOV: The vehicle load is unavailable.'; end if;
  if l.status<>'reviewed' then raise exception 'NOV: This load is %. Only a reviewed load can be planned.',l.status; end if;
  v_src:=jsonb_build_object('load_version',l.version,'load_status',l.status);
  select o2.* into o from public.orders o2 where o2.id=coalesce(i.order_id,case when a='loadplan.stop' then private.execution_uuid(p_m,'order_id') end) and o2.company_id=p_company;
  if a='loadplan.stop' then
    if o.id is null then raise exception 'NOV: The order is unavailable.'; end if;
    if not exists(select 1 from public.factory_vehicle_load_items x where x.company_id=p_company and x.load_id=l.id and x.order_id=o.id and x.status='active') then raise exception 'NOV: Order % has no bundle on this load.',o.order_number; end if;
    v_seq:=private.assurance_number(p_m,'stop_seq',1,20,0);
    if p_m ? 'unload_note' then perform private.assurance_text(p_m,'unload_note',5,200); end if;
    select count(*) into v_n from public.load_plan_stops s join public.orders so on so.id=s.order_id and so.company_id=s.company_id where s.company_id=p_company and s.load_id=l.id and s.stop_seq=v_seq and s.order_id<>o.id and so.customer_id<>o.customer_id;
    if v_n>0 then v_warn:=v_warn||jsonb_build_array('Another customer''s order shares this stop. Keep their documents separate when unloading.'); end if;
    v_title:='Set the unloading stop'; v_effect:='Records the stop order for this order on the load. Loading order is the reverse: the last stop is loaded first.';
    v_facts:=jsonb_build_object('Vehicle load',l.id,'Order',o.order_number,'Stop',v_seq);
    v_src:=v_src||jsonb_build_object('order',o.id,'order_stage',o.current_stage);
  elsif a='loadplan.confirm' then
    select * into cf from public.load_item_confirmations where item_id=i.id and company_id=p_company;
    v_status:=p_m->>'status';
    if v_status not in ('loaded','not_loaded','unloaded_exception') then raise exception 'NOV: Choose loaded, not loaded or unloading exception.'; end if;
    if p_m->>'method' not in ('scan','manual') then raise exception 'NOV: State whether the bundle was scanned or confirmed by hand.'; end if;
    if i.status<>'active' then raise exception 'NOV: This bundle was already removed from the load plan.'; end if;
    select pb.bundle_number into v_bundle from public.prepared_physical_bundles pb where pb.id=i.bundle_id and pb.company_id=p_company;
    if cf.id is not null and cf.status=v_status then raise exception 'NOV: Bundle % is already recorded as %.',coalesce(v_bundle,'record'),replace(v_status,'_',' '); end if;
    if v_status='unloaded_exception' and cf.status is distinct from 'loaded' then raise exception 'NOV: Only a loaded bundle can have an unloading exception.'; end if;
    if v_status='loaded' then
      if o.current_stage='cancelled' then raise exception 'NOV: Order % is cancelled; its bundle cannot be loaded.',o.order_number; end if;
      if exists(select 1 from public.production_jobs j where j.company_id=p_company and j.order_id=i.order_id and j.source_line_id=i.source_line_id and j.status='on_hold') then raise exception 'NOV: A production job for this bundle''s order line is on hold; it cannot be loaded.'; end if;
      select coalesce(sum(x.net_weight_kg),0) into v_w from public.load_item_confirmations c join public.factory_vehicle_load_items x on x.id=c.item_id and x.company_id=c.company_id where c.company_id=p_company and c.load_id=l.id and c.status='loaded' and x.status='active' and x.id<>i.id;
      if v_w+i.net_weight_kg>l.capacity_kg then raise exception 'NOV: Loading this bundle would bring the confirmed weight to % kg, above the vehicle capacity of % kg.',trim_scale(v_w+i.net_weight_kg),trim_scale(l.capacity_kg); end if;
      if not exists(select 1 from public.load_plan_stops s where s.company_id=p_company and s.load_id=l.id and s.order_id=i.order_id) then v_warn:=v_warn||jsonb_build_array('This order has no unloading stop yet.'); end if;
      if (p_m->>'method')='manual' then v_warn:=v_warn||jsonb_build_array('Confirmed by hand: the bundle label was not scanned.'); end if;
    end if;
    v_title:=case v_status when 'loaded' then 'Confirm a bundle as loaded' when 'not_loaded' then 'Remove a bundle from this load' else 'Record an unloading exception' end;
    v_effect:='Records what physically happened. Stock consumption and dispatch documents stay in the dispatch release workflow.';
    v_facts:=jsonb_build_object('Bundle',coalesce(v_bundle,'record'),'Order',o.order_number,'Weight',trim_scale(i.net_weight_kg)||' kg','Recorded as',replace(v_status,'_',' '),'Method',p_m->>'method');
    v_src:=v_src||jsonb_build_object('item',i.id,'confirmation',cf.status,'order_stage',o.current_stage);
  else
    v_find:=private.load_findings(p_company,l.id);
    v_title:='Review this load for departure';
    v_effect:=case when (v_find->>'ready')::boolean then 'Every check passes. The review is recorded as ready; releasing the bundles stays in the dispatch workflow.' else 'The load is not ready. The review is recorded with the open findings.' end;
    v_warn:=v_find->'warnings';
    v_facts:=jsonb_build_object('Result',case when (v_find->>'ready')::boolean then 'Ready' else 'Not ready' end,'Confirmed loaded',trim_scale((v_find->>'loaded_kg')::numeric)||' kg','Capacity',trim_scale((v_find->>'capacity_kg')::numeric)||' kg',
      'Open findings',jsonb_array_length(v_find->'blockers'));
    if jsonb_array_length(v_find->'blockers')>0 then v_warn:=(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select 'Blocker: '||b x from jsonb_array_elements_text(v_find->'blockers') b union all select jsonb_array_elements_text(v_find->'warnings')) y); end if;
    v_src:=v_src||jsonb_build_object('findings',v_find-'warnings');
  end if;
  return jsonb_build_object('source',v_src,'review',private.execution_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.execution_ctx_window(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; w public.execution_windows; x public.execution_window_changes; j public.production_jobs; o public.orders; v_win public.execution_windows; v_hours numeric; v_date date; v_impact jsonb; v_n integer;
  v_warn jsonb:='[]'::jsonb; v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_src jsonb:='{}'::jsonb; v_shift text; v_machine uuid; v_unavail boolean:=false;
begin
  if a='window.set' then
    v_hours:=private.assurance_number(p_m,'horizon_hours',12,168,0);
    if jsonb_typeof(p_m->'enforce') is distinct from 'boolean' then raise exception 'NOV: State whether the window is enforced or advisory.'; end if;
    if p_m ? 'machine_id' then v_machine:=private.execution_uuid(p_m,'machine_id'); if not exists(select 1 from public.machines m where m.id=v_machine and m.company_id=p_company and m.is_active) then raise exception 'NOV: The press is unavailable.'; end if; end if;
    select * into w from public.execution_windows where company_id=p_company and status='active' and machine_id is not distinct from v_machine;
    if w.id is not null then v_warn:=v_warn||jsonb_build_array(format('This replaces the active %s-hour window for the same scope.',w.horizon_hours)); end if;
    if (p_m->>'enforce')::boolean then v_warn:=v_warn||jsonb_build_array('Enforcement makes the server refuse direct date or shift changes inside the window; changes then go through a reviewed request.'); end if;
    v_title:='Set the protected execution window'; v_effect:='Work planned inside the window changes only through a reviewed request with a reason and a second approver. Running work is never moved by this feature.';
    v_facts:=jsonb_build_object('Scope',coalesce((select machine_name from public.machines where id=v_machine),'All presses'),'Window',v_hours||' hours','Mode',case when (p_m->>'enforce')::boolean then 'Enforced by the server' else 'Advisory' end);
    v_src:=jsonb_build_object('active',w.id,'horizon',w.horizon_hours,'enforce',w.enforce);
  elsif a in ('window.retire') then
    select * into w from public.execution_windows where id=private.execution_uuid(p_m,'id') and company_id=p_company;
    if w.id is null or w.status<>'active' then raise exception 'NOV: Only an active window can be retired.'; end if;
    v_title:='Retire the window'; v_effect:='Stops protecting this scope. Recorded changes stay in history.'; v_src:=jsonb_build_object('status',w.status);
  elsif a='window.request' then
    if p_lock then perform 1 from public.production_jobs where id=private.execution_uuid(p_m,'job_id') and company_id=p_company for update; end if;
    select * into j from public.production_jobs where id=private.execution_uuid(p_m,'job_id') and company_id=p_company;
    if j.id is null then raise exception 'NOV: The production job is unavailable.'; end if;
    if j.status not in ('planned','ready','on_hold') then raise exception 'NOV: A % job is not rescheduled through the window; running and finished work is never moved this way.',replace(j.status,'_',' '); end if;
    v_win:=private.execution_window_for(p_company,j.machine_id);
    if v_win.id is null or not private.execution_in_window(v_win,j.planned_date) then raise exception 'NOV: This job is outside the protected window. Change its date in production planning.'; end if;
    v_date:=private.assurance_date(p_m,'new_date');
    if v_date<private.ist_today() then raise exception 'NOV: The new date cannot be in the past.'; end if;
    if p_m ? 'new_shift' then v_shift:=private.assurance_text(p_m,'new_shift',1,20); end if;
    if v_date=j.planned_date and v_shift is not distinct from j.shift then raise exception 'NOV: The new date and shift match the current plan.'; end if;
    perform private.assurance_text(p_m,'customer_effect',5,300);
    if exists(select 1 from public.execution_window_changes c where c.company_id=p_company and c.job_id=j.id and c.status='requested') then raise exception 'NOV: A change for this job is already awaiting approval.'; end if;
    select * into o from public.orders where id=j.order_id and company_id=p_company;
    select count(*) into v_n from public.production_jobs k where k.company_id=p_company and k.id<>j.id and k.machine_id is not distinct from j.machine_id and k.planned_date=v_date and k.shift is not distinct from coalesce(v_shift,j.shift) and k.status in ('planned','ready','in_progress','on_hold');
    v_impact:=jsonb_build_object('displaced_or_shared_slot_jobs',v_n,'order_expected_dispatch',o.expected_dispatch_date,'moves_after_expected_dispatch',o.expected_dispatch_date is not null and v_date>o.expected_dispatch_date,
      'billets_short',o.billets_short,'not_modelled','Material reservations, crew and vendor work are not modelled here; confirm them with the shift supervisor before approving.');
    if v_n>0 then v_warn:=v_warn||jsonb_build_array(format('%s other job(s) already hold that machine, date and shift.',v_n)); end if;
    if o.expected_dispatch_date is not null and v_date>o.expected_dispatch_date then v_warn:=v_warn||jsonb_build_array('The new date is after the order''s expected dispatch date.'); end if;
    v_warn:=v_warn||jsonb_build_array(v_impact->>'not_modelled');
    v_title:='Request a change inside the protected window'; v_effect:='Records the request with the displaced work and customer consequence. A second person approves it; the job is changed only if it is unchanged since this review.';
    v_facts:=jsonb_build_object('Job',coalesce(j.job_number,'record'),'Order',o.order_number,'From',to_char(j.planned_date,'DD Mon YYYY')||coalesce(' · '||j.shift,''),'To',to_char(v_date,'DD Mon YYYY')||coalesce(' · '||coalesce(v_shift,j.shift),''),'Customer effect',btrim(p_m->>'customer_effect'));
    v_src:=jsonb_build_object('job_version',j.updated_at,'planned',j.planned_date,'shift',j.shift,'status',j.status);
  else
    if p_lock then perform 1 from public.execution_window_changes where id=private.execution_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into x from public.execution_window_changes where id=private.execution_uuid(p_m,'id') and company_id=p_company;
    if x.id is null then raise exception 'NOV: The change request is unavailable.'; end if;
    if x.status<>'requested' then raise exception 'NOV: This request is already %.',x.status; end if;
    select * into j from public.production_jobs where id=x.job_id and company_id=p_company;
    v_src:=jsonb_build_object('request',x.status,'job_version',j.updated_at,'job_status',j.status);
    v_facts:=jsonb_build_object('Job',coalesce(j.job_number,'record'),'From',to_char(x.previous_date,'DD Mon YYYY'),'To',to_char(x.new_date,'DD Mon YYYY'),'Reason',left(x.reason,160),'Customer effect',left(x.customer_effect,160));
    if a='window.approve' then
      if x.requested_by=p_actor then raise exception 'NOV: A second person approves a change in the protected window; the requester cannot.'; end if;
      if j.updated_at<>x.job_version then raise exception 'NOV: The job changed after this request was made. Reject it and request again against the current plan.'; end if;
      if j.status not in ('planned','ready','on_hold') then raise exception 'NOV: The job is now %; it can no longer be moved.',replace(j.status,'_',' '); end if;
      if x.new_date<private.ist_today() then raise exception 'NOV: The requested date has passed.'; end if;
      v_title:='Approve and apply the change'; v_effect:='Moves the job and records the before and after plan. Owners of the job and order are told once.';
    else
      v_title:='Reject the change'; v_effect:='Leaves the job as planned and records the decision.';
    end if;
  end if;
  return jsonb_build_object('source',v_src,'review',private.execution_review(v_title,v_effect,v_warn,v_facts),'extra',jsonb_build_object('impact',v_impact,'shift',v_shift));
end $$;

create function private.execution_ctx_wip(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; l public.stage_wip_limits; j public.production_jobs; v_unit text; v_val numeric; v_stage text; v_row jsonb; v_cur numeric; v_after numeric; v_warn jsonb:='[]'::jsonb; v_title text; v_effect text;
  v_facts jsonb:='{}'::jsonb; v_src jsonb:='{}'::jsonb;
begin
  if a='wip.set_limit' then
    v_stage:=p_m->>'stage'; v_unit:=p_m->>'unit';
    if v_stage not in ('at_press','at_vendor','awaiting_finishing','awaiting_qc','awaiting_packing','on_hold') then raise exception 'NOV: Choose the stage.'; end if;
    if v_unit not in ('kg','jobs') then raise exception 'NOV: Choose kg or jobs; the two are never mixed.'; end if;
    v_val:=private.assurance_number(p_m,'limit_value',case when v_unit='kg' then 0.001 else 1 end,100000000,case when v_unit='kg' then 3 else 0 end);
    perform private.assurance_text(p_m,'basis',5,300);
    select * into l from public.stage_wip_limits where company_id=p_company and stage=v_stage and status='active';
    if l.id is not null then v_warn:=v_warn||jsonb_build_array(format('This replaces the active limit of %s %s.',trim_scale(l.limit_value),l.unit)); end if;
    v_warn:=v_warn||jsonb_build_array('The limit is advisory: it informs the release decision and never blocks the stage.');
    v_title:='Set an advisory stage limit'; v_effect:='Shows queued, active and held work against this limit and asks for a recorded reason when a release would pass it.';
    v_facts:=jsonb_build_object('Stage',replace(v_stage,'_',' '),'Limit',trim_scale(v_val)||' '||v_unit,'Basis',btrim(p_m->>'basis'));
    v_src:=jsonb_build_object('active',l.id,'limit',l.limit_value,'unit',l.unit);
  elsif a='wip.retire_limit' then
    select * into l from public.stage_wip_limits where id=private.execution_uuid(p_m,'id') and company_id=p_company;
    if l.id is null or l.status<>'active' then raise exception 'NOV: Only an active limit can be retired.'; end if;
    v_title:='Retire the limit'; v_effect:='Stops comparing this stage against the limit. Earlier release decisions stay in history.'; v_src:=jsonb_build_object('status',l.status);
    v_facts:=jsonb_build_object('Stage',replace(l.stage,'_',' '),'Limit',trim_scale(l.limit_value)||' '||l.unit);
  else
    select * into j from public.production_jobs where id=private.execution_uuid(p_m,'job_id') and company_id=p_company;
    if j.id is null then raise exception 'NOV: The production job is unavailable.'; end if;
    if j.status='cancelled' then raise exception 'NOV: A cancelled job is not released.'; end if;
    v_stage:=p_m->>'stage';
    select * into l from public.stage_wip_limits where company_id=p_company and stage=v_stage and status='active';
    if l.id is null then raise exception 'NOV: This stage has no active limit, so no release decision is needed.'; end if;
    select r.row_data into v_row from private.execution_rows(p_company,p_actor,p_role,'wip','all',l.id) r limit 1;
    if v_row is null then raise exception 'NOV: The stage position is unavailable.'; end if;
    v_cur:=(v_row->'details'->>'current_value')::numeric;
    v_after:=v_cur+case when l.unit='kg' then coalesce(j.planned_quantity_kg,0) else 1 end;
    if v_after<=l.limit_value then raise exception 'NOV: Releasing this job keeps the stage at % of % %; no override is needed.',trim_scale(v_after),trim_scale(l.limit_value),l.unit; end if;
    if l.unit='kg' and coalesce((v_row->'details'->>'unmeasured_jobs')::integer,0)>0 then v_warn:=v_warn||jsonb_build_array('Some jobs at this stage have no recorded quantity, so the true position may be higher.'); end if;
    v_warn:=v_warn||jsonb_build_array(format('After this release the stage holds %s %s against a limit of %s.',trim_scale(v_after),l.unit,trim_scale(l.limit_value)));
    v_title:='Record a release past the advisory limit'; v_effect:='Records why more work enters a stage that is at or over its limit. The release itself happens in the production workflow.';
    v_facts:=jsonb_build_object('Job',coalesce(j.job_number,'record'),'Stage',replace(v_stage,'_',' '),'Now',trim_scale(v_cur)||' '||l.unit,'Limit',trim_scale(l.limit_value)||' '||l.unit);
    v_src:=jsonb_build_object('limit',l.id,'now',v_cur,'job_updated',j.updated_at);
  end if;
  return jsonb_build_object('source',v_src,'review',private.execution_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.execution_ctx_assignment(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; r public.assignment_rules; t public.tasks; x public.employee_unavailability; u public.app_users; v_ck jsonb; v_roles text[]; v_role text; v_d1 date; v_d2 date; v_n integer; v_num numeric;
  v_warn jsonb:='[]'::jsonb; v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_src jsonb:='{}'::jsonb; v_rec text; v_reason text;
begin
  if a='rule.set' then
    if p_m->>'task_type' !~ '^[a-z0-9_]{2,40}$' then raise exception 'NOV: Use 2 to 40 lowercase letters, digits or underscores for the task type.'; end if;
    if jsonb_typeof(p_m->'allowed_roles') is distinct from 'array' or jsonb_array_length(p_m->'allowed_roles') not between 1 and 12 then raise exception 'NOV: Choose at least one role.'; end if;
    select array_agg(distinct e) into v_roles from jsonb_array_elements_text(p_m->'allowed_roles') e;
    if exists(select 1 from unnest(v_roles) q where q not in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality')) then
      raise exception 'NOV: Choose employee roles only; viewers and dealers cannot take tasks.'; end if;
    if p_m ? 'competency_id' and not exists(select 1 from public.competencies c where c.id=private.execution_uuid(p_m,'competency_id') and c.company_id=p_company and c.is_active) then raise exception 'NOV: The competency is unavailable.'; end if;
    if p_m ? 'estimate_minutes' then v_num:=private.assurance_number(p_m,'estimate_minutes',1,1440,0); end if;
    select * into r from public.assignment_rules where company_id=p_company and task_type=p_m->>'task_type' and status='active';
    if r.id is not null then v_warn:=v_warn||jsonb_build_array('This replaces the active rule for the task type.'); end if;
    if not p_m ? 'estimate_minutes' then v_warn:=v_warn||jsonb_build_array('Without a duration estimate this task type is counted as unestimated, never as zero.'); end if;
    v_title:='Set the assignment rule'; v_effect:='Roles and any required competency become hard eligibility for this task type. Availability and workload remain advisory.';
    v_facts:=jsonb_build_object('Task type',p_m->>'task_type','Roles',array_to_string(v_roles,', '),'Estimate',coalesce(v_num::text||' min','Not estimated'));
    v_src:=jsonb_build_object('active',r.id,'updated',r.created_at);
  elsif a='rule.retire' then
    select * into r from public.assignment_rules where id=private.execution_uuid(p_m,'id') and company_id=p_company;
    if r.id is null or r.status<>'active' then raise exception 'NOV: Only an active rule can be retired.'; end if;
    v_title:='Retire the rule'; v_effect:='Tasks of this type are then limited only by being an active employee. Existing assignments are not moved.'; v_facts:=jsonb_build_object('Task type',r.task_type); v_src:=jsonb_build_object('status',r.status);
  elsif a='availability.record' then
    u:=private.execution_member(p_company,private.execution_uuid(p_m,'employee_id'),false);
    v_d1:=private.assurance_date(p_m,'starts_on'); v_d2:=private.assurance_date(p_m,'ends_on');
    if v_d2<v_d1 then raise exception 'NOV: The end date cannot be before the start date.'; end if;
    if v_d2>v_d1+90 then raise exception 'NOV: Record at most 90 days at a time.'; end if;
    if v_d2<private.ist_today()-7 then raise exception 'NOV: Past absences older than a week are not recorded.'; end if;
    if p_m->>'kind' not in ('leave','training','off_shift','other') then raise exception 'NOV: Choose the kind of unavailability.'; end if;
    if exists(select 1 from public.employee_unavailability y where y.company_id=p_company and y.employee_id=u.id and y.cancelled_at is null and daterange(y.starts_on,y.ends_on,'[]')&&daterange(v_d1,v_d2,'[]')) then raise exception 'NOV: An overlapping unavailability is already recorded for this employee.'; end if;
    select count(*) into v_n from public.tasks k where k.company_id=p_company and k.assigned_to=u.id and k.status='open' and k.due_date between v_d1 and v_d2;
    if v_n>0 then v_warn:=v_warn||jsonb_build_array(format('%s open task(s) assigned to %s fall due in this period. They stay assigned and appear for re-evaluation; running tasks are never moved.',v_n,u.full_name)); end if;
    v_title:='Record unavailability'; v_effect:='Shows the person as unavailable in assignment recommendations. Visible to supervisors only.';
    v_facts:=jsonb_build_object('Employee',u.full_name,'From',to_char(v_d1,'DD Mon YYYY'),'To',to_char(v_d2,'DD Mon YYYY'),'Kind',replace(p_m->>'kind','_',' '));
  elsif a='availability.cancel' then
    select * into x from public.employee_unavailability where id=private.execution_uuid(p_m,'id') and company_id=p_company;
    if x.id is null or x.cancelled_at is not null then raise exception 'NOV: Only a recorded unavailability that is still standing can be cancelled.'; end if;
    v_title:='Cancel the unavailability'; v_effect:='Removes the period from assignment recommendations; the record stays in history.'; v_src:=jsonb_build_object('cancelled',x.cancelled_at);
  else
    if p_lock then perform 1 from public.tasks where id=private.execution_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into t from public.tasks where id=private.execution_uuid(p_m,'id') and company_id=p_company and dealership_id is null;
    if t.id is null then raise exception 'NOV: The task is unavailable.'; end if;
    if t.status<>'open' then raise exception 'NOV: A % task is not reassigned from here. Running tasks are changed from the task itself.',replace(t.status,'_',' '); end if;
    u:=private.execution_member(p_company,private.execution_uuid(p_m,'assignee_id'),false);
    if t.assigned_to=u.id then raise exception 'NOV: % is already assigned to this task.',u.full_name; end if;
    v_ck:=private.assignment_check(p_company,t,u.id);
    if not (v_ck->>'hard_ok')::boolean then raise exception 'NOV: % cannot take this task: %.',u.full_name,(select string_agg(e,'; ') from jsonb_array_elements_text(v_ck->'hard_reasons') e); end if;
    if jsonb_array_length(v_ck->'soft')>0 then
      if not p_m ? 'override_reason' then raise exception 'NOV: % has conflicts (%). Give the reason for assigning anyway.',u.full_name,(select string_agg(e,'; ') from jsonb_array_elements_text(v_ck->'soft') e); end if;
      v_reason:=private.assurance_text(p_m,'override_reason',5,300);
    elsif p_m ? 'override_reason' then raise exception 'NOV: There is nothing to override for this assignment.'; end if;
    select string_agg(e->>'name',', ') into v_rec from jsonb_array_elements(private.assignment_candidates(p_company,t)) e where (e->>'recommended')::boolean;
    v_warn:=(select coalesce(jsonb_agg(e),'[]'::jsonb) from jsonb_array_elements_text(v_ck->'soft') e);
    if (v_ck->>'unestimated_tasks')::integer>0 then v_warn:=v_warn||jsonb_build_array(format('%s of the person''s open tasks have no duration estimate; the workload shown is a lower bound.',v_ck->>'unestimated_tasks')); end if;
    v_title:='Assign the task'; v_effect:='Sets the assignee on this open task and keeps the eligibility evidence and any override reason. Counts show commitment, not performance.';
    v_facts:=jsonb_build_object('Task',t.title,'Assign to',u.full_name,'Open tasks already assigned',v_ck->>'open_tasks','Estimated minutes',(v_ck->>'estimated_minutes')||case when (v_ck->>'unestimated_tasks')::integer>0 then ' (+ '||(v_ck->>'unestimated_tasks')||' unestimated)' else '' end,
      'Overdue tasks',v_ck->>'overdue_tasks','Eligibility',case when (v_ck->>'has_rule')::boolean then 'Checked against the task-type rule' else 'No rule for this task type; role and status only' end,'Override reason',coalesce(v_reason,'None needed'),'Eligible and available now',coalesce(v_rec,'Nobody'));
    v_src:=jsonb_build_object('task_updated',t.updated_at,'assignee_check',v_ck);
  end if;
  return jsonb_build_object('source',v_src,'review',private.execution_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.execution_ctx_route(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; f public.route_families; f2 public.route_families; b public.order_route_bindings; v public.order_route_deviations; o public.orders; v_req text[]; v_opt text[]; v_all text[];
  v_cur integer; v_n integer; v_warn jsonb:='[]'::jsonb; v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_src jsonb:='{}'::jsonb; v_stage text; v_done text[]; v_version integer; v_idx integer;
begin
  v_all:=array['order_confirmed','die_ready','billet_ready','billet_heating','extrusion_planned','extruded','stretching','cutting','aging','surface_treatment','finishing','packing','dispatched','delivered','payment_pending','closed'];
  if a='route.define' then
    if p_m->>'code' !~ '^[a-z0-9_]{3,30}$' then raise exception 'NOV: Use 3 to 30 lowercase letters, digits or underscores for the route code.'; end if;
    perform private.assurance_text(p_m,'name',3,80); perform private.assurance_text(p_m,'applies_when',5,300);
    if jsonb_typeof(p_m->'required_stages') is distinct from 'array' then raise exception 'NOV: Choose the required stages.'; end if;
    select coalesce(array_agg(e order by array_position(v_all,e)),'{}') into v_req from (select distinct e from jsonb_array_elements_text(p_m->'required_stages') e) q;
    select coalesce(array_agg(e order by array_position(v_all,e)),'{}') into v_opt from (select distinct e from jsonb_array_elements_text(coalesce(p_m->'optional_stages','[]'::jsonb)) e) q;
    if cardinality(v_req)<>jsonb_array_length(p_m->'required_stages') or exists(select 1 from unnest(v_req||v_opt) q where q<>all(v_all)) then raise exception 'NOV: Use each known stage once.'; end if;
    if exists(select 1 from unnest(v_opt) q where q=any(v_req)) then raise exception 'NOV: A stage cannot be both required and optional.'; end if;
    if not (v_req @> array['order_confirmed','packing','dispatched']) then raise exception 'NOV: Every route keeps order confirmation, packing and dispatch. A route never bypasses those controls.'; end if;
    if exists(select 1 from public.route_families x where x.company_id=p_company and x.code=p_m->>'code' and x.status='draft') then raise exception 'NOV: A draft of this route already exists. Approve or retire it first.'; end if;
    select coalesce(max(version),0)+1 into v_version from public.route_families where company_id=p_company and code=p_m->>'code';
    v_title:='Define a workflow route'; v_effect:='Creates a draft. A second person approves it before any order can use it.';
    v_facts:=jsonb_build_object('Route',btrim(p_m->>'name'),'Code and version',(p_m->>'code')||' v'||v_version,'Required stages',array_to_string(v_req,', '),'Optional stages',coalesce(nullif(array_to_string(v_opt,', '),''),'None'));
    v_src:=jsonb_build_object('version',v_version);
  elsif a in ('route.approve','route.retire') then
    select * into f from public.route_families where id=private.execution_uuid(p_m,'id') and company_id=p_company;
    if f.id is null then raise exception 'NOV: The route is unavailable.'; end if;
    select count(*) into v_n from public.order_route_bindings where company_id=p_company and family_id=f.id and status='active';
    v_src:=jsonb_build_object('status',f.status,'created_by',f.created_by); v_facts:=jsonb_build_object('Route',f.name,'Code and version',f.code||' v'||f.version,'Orders bound',v_n);
    if a='route.approve' then
      if f.status<>'draft' then raise exception 'NOV: Only a draft route can be approved; this one is %.',f.status; end if;
      if f.created_by=p_actor then raise exception 'NOV: A second person approves a route; the person who defined it cannot.'; end if;
      select * into f2 from public.route_families where company_id=p_company and code=f.code and status='approved';
      if f2.id is not null then v_warn:=v_warn||jsonb_build_array(format('Version %s is retired by this approval. Orders already bound to it keep it.',f2.version)); end if;
      v_title:='Approve the route'; v_effect:='Makes this version available for binding to orders.';
    else
      if f.status='retired' then raise exception 'NOV: This route is already retired.'; end if;
      if v_n>0 then v_warn:=v_warn||jsonb_build_array(format('%s order(s) stay bound to this route until they are rebound.',v_n)); end if;
      v_title:='Retire the route'; v_effect:='Stops new orders from using this version. Bound orders keep it.';
    end if;
  elsif a='route.bind' then
    select * into o from public.orders where id=private.execution_uuid(p_m,'order_id') and company_id=p_company and deleted_at is null;
    if o.id is null then raise exception 'NOV: The order is unavailable.'; end if;
    if o.current_stage in ('cancelled','closed','delivered','payment_pending') then raise exception 'NOV: An order that is % is not bound to a route.',replace(o.current_stage,'_',' '); end if;
    select * into f from public.route_families where id=private.execution_uuid(p_m,'family_id') and company_id=p_company and status='approved';
    if f.id is null then raise exception 'NOV: Choose an approved route.'; end if;
    select * into b from public.order_route_bindings where company_id=p_company and order_id=o.id and status='active';
    if b.family_id=f.id then raise exception 'NOV: This order already follows %.',f.name; end if;
    v_cur:=private.execution_stage_index(o.current_stage);
    if v_cur is not null and not (o.current_stage=any(f.required_stages) or o.current_stage=any(f.optional_stages)) then v_warn:=v_warn||jsonb_build_array(format('The order''s current stage (%s) is not part of this route.',replace(o.current_stage,'_',' '))); end if;
    select array_agg(distinct h.stage) into v_done from public.order_stage_history h where h.company_id=p_company and h.order_id=o.id and not (h.stage=any(f.required_stages) or h.stage=any(f.optional_stages));
    if v_done is not null then v_warn:=v_warn||jsonb_build_array('Stages already recorded that this route does not include: '||array_to_string(v_done,', ')||'. They stay in the order history.'); end if;
    select count(*) into v_n from unnest(f.required_stages) s where private.execution_stage_index(s)>coalesce(v_cur,0);
    if b.id is not null then v_warn:=v_warn||jsonb_build_array('The earlier route is kept in history and its approved deviations no longer apply.'); end if;
    v_title:=case when b.id is null then 'Bind the order to a route' else 'Change the order''s route' end; v_effect:='Progress for this order is read against the route''s stages. Stock, quality, finance and tenant controls are not changed by a route.';
    v_facts:=jsonb_build_object('Order',o.order_number,'Route',f.name||' v'||f.version,'Stages still ahead',v_n,'Previous route',coalesce(b.family_code||' v'||b.family_version,'None'));
    v_src:=jsonb_build_object('stage',o.current_stage,'binding',b.id,'family_status',f.status);
  elsif a='route.deviate' then
    select * into o from public.orders where id=private.execution_uuid(p_m,'order_id') and company_id=p_company and deleted_at is null;
    if o.id is null then raise exception 'NOV: The order is unavailable.'; end if;
    select * into b from public.order_route_bindings where company_id=p_company and order_id=o.id and status='active';
    if b.id is null then raise exception 'NOV: Bind the order to a route before requesting a deviation.'; end if;
    select * into f from public.route_families where id=b.family_id and company_id=p_company;
    v_stage:=p_m->>'stage';
    if not (v_stage=any(f.required_stages)) then raise exception 'NOV: Only a required stage of the route needs a deviation.'; end if;
    if v_stage in ('order_confirmed','packing','dispatched','closed') then raise exception 'NOV: % is a core control and is never skipped.',initcap(replace(v_stage,'_',' ')); end if;
    v_cur:=private.execution_stage_index(o.current_stage); v_idx:=private.execution_stage_index(v_stage);
    if v_cur is null or v_idx<=v_cur then raise exception 'NOV: Only a stage ahead of the order''s current stage can be skipped.'; end if;
    select * into v from public.order_route_deviations where binding_id=b.id and stage=v_stage;
    if v.id is not null and v.status<>'rejected' then raise exception 'NOV: A deviation for this stage is already %.',v.status; end if;
    v_title:='Request a deviation from the route'; v_effect:='Asks a second person to approve skipping this stage with your reason. The original route stays recorded.';
    v_facts:=jsonb_build_object('Order',o.order_number,'Route',f.name||' v'||f.version,'Stage to skip',replace(v_stage,'_',' '));
    v_src:=jsonb_build_object('binding',b.id,'stage',o.current_stage,'existing',v.status);
  else
    if p_lock then perform 1 from public.order_route_deviations where id=private.execution_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v from public.order_route_deviations where id=private.execution_uuid(p_m,'id') and company_id=p_company;
    if v.id is null then raise exception 'NOV: The deviation is unavailable.'; end if;
    if v.status<>'requested' then raise exception 'NOV: This deviation is already %.',v.status; end if;
    if v.requested_by=p_actor then raise exception 'NOV: A second person decides a deviation; the requester cannot.'; end if;
    if p_m->>'decision' not in ('approve','reject') then raise exception 'NOV: Choose approve or reject.'; end if;
    select * into o from public.orders where id=v.order_id and company_id=p_company;
    if p_m->>'decision'='approve' and (private.execution_stage_index(o.current_stage) is null or private.execution_stage_index(v.stage)<=private.execution_stage_index(o.current_stage)) then raise exception 'NOV: The order has reached this stage; it can no longer be skipped.'; end if;
    if not exists(select 1 from public.order_route_bindings x where x.id=v.binding_id and x.status='active') then raise exception 'NOV: The order has been rebound; this deviation no longer applies.'; end if;
    v_title:=case when p_m->>'decision'='approve' then 'Approve the deviation' else 'Reject the deviation' end; v_effect:=case when p_m->>'decision'='approve' then 'The stage shows as skipped by policy with this reason.' else 'The route stands unchanged.' end;
    v_facts:=jsonb_build_object('Order',o.order_number,'Stage',replace(v.stage,'_',' '),'Reason',left(v.reason,200)); v_src:=jsonb_build_object('status',v.status,'stage',o.current_stage);
  end if;
  return jsonb_build_object('source',v_src,'review',private.execution_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.execution_ctx_message(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; m public.document_communications; v_b jsonb; v_warn jsonb:='[]'::jsonb; v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_src jsonb:='{}'::jsonb;
begin
  if a='message.prepare' then
    if p_m->>'template' not in ('order_confirmation','dispatch_notice','appointment_notice') then raise exception 'NOV: Choose a message type.'; end if;
    v_b:=private.message_build(p_company,p_m->>'template',private.execution_uuid(p_m,'entity_id'),p_m->>'recipient_phone');
    if exists(select 1 from public.document_communications x where x.company_id=p_company and x.template=p_m->>'template' and x.entity_id=(p_m->>'entity_id')::uuid and x.state='prepared') then
      v_warn:=v_warn||jsonb_build_array('An earlier prepared message for this record is replaced by this one.'); end if;
    v_warn:=v_warn||(v_b->'warnings');
    v_title:='Prepare a customer message'; v_effect:='Prepares the text, recipient and document link for you to copy or print. Nothing is sent by this system, and delivery is not tracked.';
    v_facts:=jsonb_build_object('Recipient',v_b->>'recipient_name','Number',v_b->>'recipient_phone','Number from',replace(v_b->>'recipient_source','_',' '),'Message',v_b->>'body','Document',coalesce(v_b->>'document_label','None attached'),'Delivery','Prepared only');
    v_src:=jsonb_build_object('fingerprint',v_b->>'fingerprint');
  else
    if p_lock then perform 1 from public.document_communications where id=private.execution_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into m from public.document_communications where id=private.execution_uuid(p_m,'id') and company_id=p_company;
    if m.id is null then raise exception 'NOV: The prepared message is unavailable.'; end if;
    if m.state<>'prepared' then raise exception 'NOV: This message is already %.',m.state; end if;
    v_src:=jsonb_build_object('state',m.state,'fingerprint',m.source_fingerprint);
    v_facts:=jsonb_build_object('Message',replace(m.template,'_',' '),'Recipient',m.recipient_name);
    if a='message.mark' then
      if p_m->>'state' not in ('copied','printed','downloaded') then raise exception 'NOV: Choose copied, printed or downloaded.'; end if;
      v_b:=private.message_build(p_company,m.template,m.entity_id,case when m.recipient_source='entered' then m.recipient_phone end);
      if v_b->>'fingerprint'<>m.source_fingerprint then raise exception 'NOV: The recipient or the record changed since this message was prepared. Prepare it again.'; end if;
      v_title:='Record how the message was used'; v_effect:='Records that you '||(p_m->>'state')||' it. This is not a record that the customer received it.';
      v_facts:=v_facts||jsonb_build_object('Outcome',p_m->>'state');
    else
      v_title:='Cancel the prepared message'; v_effect:='Withdraws the prepared message. The record is unchanged.';
    end if;
  end if;
  return jsonb_build_object('source',v_src,'review',private.execution_review(v_title,v_effect,v_warn,v_facts));
end $$;

-- NOV-014: small updates from the work queue. The source covers the request only; each task is judged
-- again when the change is applied, so a partial outcome lists every selected identity.
create function private.queue_classify(p_company uuid,p_field text,p_value text,p_id uuid,p_version text) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare t public.tasks; v_ck jsonb; v_same boolean;
begin
  select * into t from public.tasks where id=p_id and company_id=p_company and dealership_id is null;
  if t.id is null then return jsonb_build_object('id',p_id,'label','Unavailable record','outcome','rejected','reason','The task is unavailable.'); end if;
  if t.status not in ('open','in_progress') then return jsonb_build_object('id',p_id,'label',t.title,'outcome','rejected','reason','The task is '||t.status||'.'); end if;
  if private.execution_version(t.updated_at)<>p_version then return jsonb_build_object('id',p_id,'label',t.title,'outcome','rejected','reason','Changed since the list was loaded. Reload and select again.'); end if;
  v_same:=case p_field when 'assigned_to' then t.assigned_to::text=p_value when 'priority' then t.priority=p_value else t.due_date::text=p_value end;
  if v_same then return jsonb_build_object('id',p_id,'label',t.title,'outcome','no_change','reason','Already has this value.'); end if;
  if p_field='assigned_to' then
    if t.status<>'open' then return jsonb_build_object('id',p_id,'label',t.title,'outcome','rejected','reason','Running tasks are reassigned from the task itself.'); end if;
    v_ck:=private.assignment_check(p_company,t,p_value::uuid);
    if not (v_ck->>'hard_ok')::boolean then return jsonb_build_object('id',p_id,'label',t.title,'outcome','rejected','reason',(select string_agg(e,'; ') from jsonb_array_elements_text(v_ck->'hard_reasons') e)); end if;
    if jsonb_array_length(v_ck->'soft')>0 then return jsonb_build_object('id',p_id,'label',t.title,'outcome','rejected','reason','Conflicts need a reason: use the assignment screen ('||(select string_agg(e,'; ') from jsonb_array_elements_text(v_ck->'soft') e)||').'); end if;
  end if;
  return jsonb_build_object('id',p_id,'label',t.title,'outcome','will_change','reason',null);
end $$;
revoke all on function private.queue_classify(uuid,text,text,uuid,text) from public,anon,authenticated;

create function private.execution_ctx_queue(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_field text:=p_m->>'field'; v_value text; v_sel text:=p_m->>'selection'; v_recs jsonb; e jsonb; v_out jsonb:='[]'::jsonb; v_c jsonb; v_ids uuid[]:='{}'; v_n integer; v_ok integer:=0; v_same integer:=0; v_bad integer:=0; v_warn jsonb:='[]'::jsonb; u public.app_users;
begin
  if v_sel not in ('page','filtered') then raise exception 'NOV: State whether you selected the page or everything matching the filter.'; end if;
  if v_field not in ('assigned_to','priority','due_date') then raise exception 'NOV: Choose assignee, priority or planned date. Other changes stay in their own workflows.'; end if;
  if jsonb_typeof(p_m->'value') is distinct from 'string' then raise exception 'NOV: Choose the new value.'; end if;
  v_value:=btrim(p_m->>'value');
  if v_field='assigned_to' then u:=private.execution_member(p_company,private.execution_uuid(p_m,'value'),false); v_value:=u.id::text;
  elsif v_field='priority' then if v_value not in ('low','normal','high','urgent') then raise exception 'NOV: Choose a priority.'; end if;
  else perform private.assurance_date(p_m,'value'); if v_value::date<private.ist_today() then raise exception 'NOV: The planned date cannot be in the past.'; end if; end if;
  v_recs:=p_m->'records';
  if jsonb_typeof(v_recs) is distinct from 'array' or jsonb_array_length(v_recs)<1 then raise exception 'NOV: Select at least one task.'; end if;
  if jsonb_array_length(v_recs)>(case when v_sel='page' then 10 else 50 end) then raise exception 'NOV: Select at most % task(s) at a time.',case when v_sel='page' then 10 else 50 end; end if;
  for e in select value from jsonb_array_elements(v_recs) loop
    if jsonb_typeof(e) is distinct from 'object' or not (e ?& array['id','version']) or exists(select 1 from jsonb_object_keys(e) k where k not in ('id','version'))
      or jsonb_typeof(e->'id') is distinct from 'string' or (e->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(e->'version') is distinct from 'string' or length(e->>'version') not between 10 and 40 then
      raise exception 'NOV: Each selected task needs its identity and the version you saw.'; end if;
    if (e->>'id')::uuid=any(v_ids) then raise exception 'NOV: A task is selected twice.'; end if;
    v_ids:=v_ids||(e->>'id')::uuid;
    v_c:=private.queue_classify(p_company,v_field,v_value,(e->>'id')::uuid,e->>'version'); v_out:=v_out||jsonb_build_array(v_c);
    if v_c->>'outcome'='will_change' then v_ok:=v_ok+1; elsif v_c->>'outcome'='no_change' then v_same:=v_same+1; else v_bad:=v_bad+1; end if;
  end loop;
  if v_ok=0 then raise exception 'NOV: None of the selected tasks can be changed: %.',rtrim(coalesce((select string_agg(distinct x->>'reason',' ') from jsonb_array_elements(v_out) x),'nothing to change'),'.'); end if;
  if v_bad>0 then v_warn:=v_warn||jsonb_build_array(format('%s selected task(s) will not change; each reason is listed.',v_bad)); end if;
  v_warn:=v_warn||jsonb_build_array('Each task is judged again when you confirm. Tasks are processed one by one, so a partial result is possible and every selected task is reported.');
  return jsonb_build_object('source',jsonb_build_object('field',v_field,'value',v_value,'selection',v_sel,'ids',(select jsonb_agg(i order by i) from unnest(v_ids) i)),
    'review',private.execution_review('Update '||jsonb_array_length(v_recs)||' task(s)','Changes one small field on the tasks that are still current. Stock, money and status changes stay in their own workflows.',v_warn,
      jsonb_build_object('Selection',case when v_sel='page' then 'Tasks on this page' else 'All tasks matching the filter' end,'Field',case v_field when 'assigned_to' then 'Assignee' when 'priority' then 'Priority' else 'Planned date' end,
        'New value',case v_field when 'assigned_to' then u.full_name else v_value end,'Will change',v_ok,'No change needed',v_same,'Will not change',v_bad),v_out));
end $$;

create function private.execution_context(p_company uuid,p_actor uuid,p_mutation jsonb,p_lock boolean default false) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_role text;
begin
  perform private.execution_assert_shape(p_mutation);
  select role into v_role from public.app_users where id=p_actor and company_id=p_company and is_active and dealer_id is null;
  if not private.execution_action_allowed(v_role,a) then raise exception 'Not permitted' using errcode='42501'; end if;
  return case split_part(a,'.',1)
    when 'appointment' then private.execution_ctx_appointment(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'gatepass' then private.execution_ctx_gatepass(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'loadplan' then private.execution_ctx_loadplan(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'window' then private.execution_ctx_window(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'wip' then private.execution_ctx_wip(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'rule' then private.execution_ctx_assignment(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'availability' then private.execution_ctx_assignment(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'assignment' then private.execution_ctx_assignment(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'route' then private.execution_ctx_route(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'message' then private.execution_ctx_message(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'queue' then private.execution_ctx_queue(p_company,p_actor,v_role,p_mutation,p_lock)
  end;
end $$;
revoke all on function private.execution_ctx_appointment(uuid,uuid,text,jsonb,boolean),private.execution_ctx_gatepass(uuid,uuid,text,jsonb,boolean),private.execution_ctx_loadplan(uuid,uuid,text,jsonb,boolean),
  private.execution_ctx_window(uuid,uuid,text,jsonb,boolean),private.execution_ctx_wip(uuid,uuid,text,jsonb,boolean),private.execution_ctx_assignment(uuid,uuid,text,jsonb,boolean),
  private.execution_ctx_route(uuid,uuid,text,jsonb,boolean),private.execution_ctx_message(uuid,uuid,text,jsonb,boolean),private.execution_ctx_queue(uuid,uuid,text,jsonb,boolean),
  private.execution_context(uuid,uuid,jsonb,boolean) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Apply: runs inside the confirmed request, after the context was checked again under row locks.
------------------------------------------------------------------------------------------------
create function private.appointment_revision(p_company uuid,p_id uuid,p_reason text,p_actor uuid) returns void language sql security definer set search_path=public,private as $$
  insert into public.delivery_appointment_revisions(company_id,appointment_id,revision,snapshot,reason,recorded_by)
  select a.company_id,a.id,a.revision,to_jsonb(a)-'contact_phone',left(p_reason,500),p_actor from public.delivery_appointments a where a.id=p_id and a.company_id=p_company
$$;
revoke all on function private.appointment_revision(uuid,uuid,text,uuid) from public,anon,authenticated;

create function private.execution_apply(p_company uuid,p_actor uuid,p_request uuid,p_mutation jsonb,p_context jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; n text:=btrim(coalesce(p_mutation->>'note','')); v_id uuid:=nullif(p_mutation->>'id','')::uuid; v_view text:=private.execution_view(p_mutation->>'action'); v_facts jsonb:=p_context->'review'->'facts';
  ap public.delivery_appointments; o public.orders; c public.customers; g public.returnable_gate_passes; x public.execution_window_changes; j public.production_jobs; t public.tasks; f public.route_families; b public.order_route_bindings;
  m public.document_communications; v_b jsonb; v_num integer; v_s text; v_def text; v_addr text; v_out jsonb:='[]'::jsonb; v_c jsonb; v_e jsonb; v_changed integer:=0; v_same integer:=0; v_bad integer:=0; v_find jsonb;
  v_req text[]; v_opt text[]; v_all text[]:=array['order_confirmed','die_ready','billet_ready','billet_heating','extrusion_planned','extruded','stretching','cutting','aging','surface_treatment','finishing','packing','dispatched','delivered','payment_pending','closed'];
  v_state text; v_entity uuid; v_ck jsonb; v_version integer;
begin
  v_entity:=coalesce(v_id,p_request);
  -- NOV-075 -----------------------------------------------------------------------------------
  if a='appointment.request' then
    select * into o from public.orders where id=(p_mutation->>'order_id')::uuid and company_id=p_company; select * into c from public.customers where id=o.customer_id and company_id=p_company;
    v_def:=coalesce(nullif(btrim(c.shipping_address),''),nullif(btrim(c.billing_address),''));
    insert into public.delivery_appointments(id,company_id,order_id,dispatch_id,requested_start,requested_end,site_address,contact_name,contact_phone,access_restrictions,preparations,follow_up_owner,created_by)
    values(p_request,p_company,o.id,nullif(p_mutation->>'dispatch_id','')::uuid,(p_mutation->>'requested_start')::timestamptz,(p_mutation->>'requested_end')::timestamptz,coalesce(btrim(p_mutation->>'site_address'),v_def),
      nullif(btrim(coalesce(p_mutation->>'contact_name','')),''),case when p_mutation ? 'contact_phone' then private.execution_phone(p_mutation->>'contact_phone') end,nullif(btrim(coalesce(p_mutation->>'access_restrictions','')),''),
      nullif(btrim(coalesce(p_mutation->>'preparations','')),''),(p_mutation->>'owner_id')::uuid,p_actor);
    perform private.appointment_revision(p_company,p_request,n,p_actor);
    perform private.execution_notify(p_company,p_actor,(p_mutation->>'owner_id')::uuid,'Delivery appointment to secure','Order '||o.order_number||': secure the site''s confirmation.',p_request,'/tasks/execution/appointments/'||p_request);
    perform private.execution_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Appointment requested','href','/tasks/execution/appointments/'||p_request,'message','Record the site''s confirmation when it is given.');
  elsif a='appointment.confirm' then
    update public.delivery_appointments set status='confirmed',confirmed_start=(p_mutation->>'confirmed_start')::timestamptz,confirmed_end=(p_mutation->>'confirmed_end')::timestamptz,confirmed_by_name=btrim(p_mutation->>'confirmed_by_name'),
      changed_after_confirmation=false,revision=revision+1,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    perform private.appointment_revision(p_company,v_id,n,p_actor);
  elsif a='appointment.reschedule' then
    select * into ap from public.delivery_appointments where id=v_id and company_id=p_company;
    update public.delivery_appointments set requested_start=(p_mutation->>'requested_start')::timestamptz,requested_end=(p_mutation->>'requested_end')::timestamptz,confirmed_start=null,confirmed_end=null,confirmed_by_name=null,status='requested',
      changed_after_confirmation=(ap.status='confirmed' or ap.changed_after_confirmation),
      site_revision=site_revision+case when p_mutation ? 'site_address' and lower(regexp_replace(btrim(p_mutation->>'site_address'),'\s+',' ','g'))<>lower(regexp_replace(site_address,'\s+',' ','g')) then 1 else 0 end,
      site_address=coalesce(btrim(p_mutation->>'site_address'),site_address),contact_name=coalesce(nullif(btrim(coalesce(p_mutation->>'contact_name','')),''),contact_name),
      contact_phone=case when p_mutation ? 'contact_phone' then private.execution_phone(p_mutation->>'contact_phone') else contact_phone end,
      access_restrictions=coalesce(nullif(btrim(coalesce(p_mutation->>'access_restrictions','')),''),access_restrictions),preparations=coalesce(nullif(btrim(coalesce(p_mutation->>'preparations','')),''),preparations),
      revision=revision+1,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    perform private.appointment_revision(p_company,v_id,n,p_actor);
    perform private.execution_notify(p_company,p_actor,ap.follow_up_owner,'Delivery appointment changed','The arrangement changed and needs reconfirmation.',v_id,'/tasks/execution/appointments/'||v_id);
  elsif a='appointment.cancel' then
    update public.delivery_appointments set status='cancelled',revision=revision+1,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    perform private.appointment_revision(p_company,v_id,n,p_actor);
  elsif a='appointment.arrive' then
    update public.delivery_appointments set status='arrived',arrived_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    perform private.appointment_revision(p_company,v_id,n,p_actor);
  elsif a='appointment.outcome' then
    update public.delivery_appointments set status=p_mutation->>'result',outcome_note=n,revision=revision+1,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    perform private.appointment_revision(p_company,v_id,n,p_actor);
  -- NOV-077 -----------------------------------------------------------------------------------
  elsif a='gatepass.issue' then
    select count(*)+1 into v_num from public.returnable_gate_passes where company_id=p_company;
    insert into public.returnable_gate_passes(id,company_id,pass_number,item_kind,die_id,item_label,serial_ref,quantity,custodian_name,custodian_kind,purpose,due_date,original_due_date,follow_up_owner,issued_by)
    values(p_request,p_company,'RGP-'||lpad(v_num::text,4,'0'),p_mutation->>'item_kind',nullif(p_mutation->>'die_id','')::uuid,btrim(p_mutation->>'item_label'),nullif(btrim(coalesce(p_mutation->>'serial_ref','')),''),(p_mutation->>'quantity')::integer,
      btrim(p_mutation->>'custodian_name'),p_mutation->>'custodian_kind',btrim(p_mutation->>'purpose'),(p_mutation->>'due_date')::date,(p_mutation->>'due_date')::date,(p_mutation->>'owner_id')::uuid,p_actor);
    perform private.execution_notify(p_company,p_actor,(p_mutation->>'owner_id')::uuid,'Returnable item to follow up','A gate pass names you for the return follow-up.',p_request,'/tasks/execution/gate_passes/'||p_request);
    perform private.execution_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Gate pass issued','href','/tasks/execution/gate_passes/'||p_request,'message','Record the departure when the item leaves.');
  elsif a='gatepass.depart' then update public.returnable_gate_passes set status='out',departed_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='gatepass.acknowledge' then update public.returnable_gate_passes set acknowledged_by_name=btrim(p_mutation->>'acknowledged_by_name'),acknowledged_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='gatepass.return' then
    v_num:=(p_mutation->>'quantity')::integer;
    insert into public.gate_pass_returns(company_id,pass_id,quantity,condition,note,received_by) values(p_company,v_id,v_num,p_mutation->>'condition',n,p_actor);
    update public.returnable_gate_passes set returned_quantity=returned_quantity+v_num,damaged_quantity=damaged_quantity+case when p_mutation->>'condition'='damaged' then v_num else 0 end,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    update public.returnable_gate_passes set status='closed',closed_at=clock_timestamp(),close_note=n where id=v_id and company_id=p_company and returned_quantity+lost_quantity=quantity;
  elsif a='gatepass.lose' then
    update public.returnable_gate_passes set lost_quantity=lost_quantity+(p_mutation->>'quantity')::integer,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    update public.returnable_gate_passes set status='closed',closed_at=clock_timestamp(),close_note=n where id=v_id and company_id=p_company and returned_quantity+lost_quantity=quantity;
  elsif a='gatepass.extend' then update public.returnable_gate_passes set due_date=(p_mutation->>'due_date')::date,extension_count=extension_count+1,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='gatepass.cancel' then update public.returnable_gate_passes set status='cancelled',closed_at=clock_timestamp(),close_note=n,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  -- NOV-036 -----------------------------------------------------------------------------------
  elsif a='loadplan.stop' then
    v_entity:=(p_mutation->>'load_id')::uuid;
    insert into public.load_plan_stops(company_id,load_id,order_id,stop_seq,unload_note,set_by) values(p_company,v_entity,(p_mutation->>'order_id')::uuid,(p_mutation->>'stop_seq')::integer,nullif(btrim(coalesce(p_mutation->>'unload_note','')),''),p_actor)
    on conflict(load_id,order_id) do update set stop_seq=excluded.stop_seq,unload_note=excluded.unload_note,set_by=excluded.set_by,set_at=clock_timestamp();
  elsif a='loadplan.confirm' then
    select load_id into v_entity from public.factory_vehicle_load_items where id=(p_mutation->>'item_id')::uuid and company_id=p_company;
    insert into public.load_item_confirmations(company_id,load_id,item_id,status,method,note,confirmed_by) values(p_company,v_entity,(p_mutation->>'item_id')::uuid,p_mutation->>'status',p_mutation->>'method',n,p_actor)
    on conflict(item_id) do update set status=excluded.status,method=excluded.method,note=excluded.note,confirmed_by=excluded.confirmed_by,confirmed_at=clock_timestamp();
  elsif a='loadplan.review' then
    v_entity:=(p_mutation->>'load_id')::uuid; v_find:=private.load_findings(p_company,v_entity);
    insert into public.load_plan_reviews(company_id,load_id,outcome,findings,loaded_kg,capacity_kg,reviewed_by)
    values(p_company,v_entity,case when (v_find->>'ready')::boolean then 'ready' else 'not_ready' end,v_find,(v_find->>'loaded_kg')::numeric,(v_find->>'capacity_kg')::numeric,p_actor);
    perform private.execution_record(p_company,v_view,v_entity,a,p_actor,n,v_facts);
    return jsonb_build_object('label',case when (v_find->>'ready')::boolean then 'Load ready' else 'Load not ready' end,'href','/tasks/execution/loads/'||v_entity,
      'message',case when (v_find->>'ready')::boolean then 'Every check passed. Release the bundles in the dispatch workflow.' else jsonb_array_length(v_find->'blockers')||' finding(s) remain open.' end);
  -- NOV-044 -----------------------------------------------------------------------------------
  elsif a='window.set' then
    update public.execution_windows set status='retired',retired_at=clock_timestamp(),retired_by=p_actor where company_id=p_company and status='active' and machine_id is not distinct from nullif(p_mutation->>'machine_id','')::uuid;
    insert into public.execution_windows(id,company_id,machine_id,horizon_hours,enforce,reason,created_by) values(p_request,p_company,nullif(p_mutation->>'machine_id','')::uuid,(p_mutation->>'horizon_hours')::integer,(p_mutation->>'enforce')::boolean,n,p_actor);
    perform private.execution_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Window set','href','/tasks/execution/windows/'||p_request,'message','Work inside the window now changes only through a reviewed request.');
  elsif a='window.retire' then update public.execution_windows set status='retired',retired_at=clock_timestamp(),retired_by=p_actor where id=v_id and company_id=p_company;
  elsif a='window.request' then
    select * into j from public.production_jobs where id=(p_mutation->>'job_id')::uuid and company_id=p_company;
    insert into public.execution_window_changes(id,company_id,job_id,previous_date,previous_shift,new_date,new_shift,reason,customer_effect,job_version,impact,requested_by)
    values(p_request,p_company,j.id,j.planned_date,j.shift,(p_mutation->>'new_date')::date,p_context->'extra'->>'shift',n,btrim(p_mutation->>'customer_effect'),j.updated_at,coalesce(p_context->'extra'->'impact','{}'::jsonb),p_actor);
    perform private.execution_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Change requested','href','/tasks/execution/windows/'||p_request,'message','A second person approves or rejects it against the current plan.');
  elsif a='window.approve' then
    select * into x from public.execution_window_changes where id=v_id and company_id=p_company; select * into j from public.production_jobs where id=x.job_id and company_id=p_company; select * into o from public.orders where id=j.order_id and company_id=p_company;
    perform set_config('app.execution_window_apply',j.id::text,true);
    update public.production_jobs set planned_date=x.new_date,shift=coalesce(x.new_shift,shift) where id=j.id and company_id=p_company;
    perform set_config('app.execution_window_apply','',true);
    update public.execution_window_changes set status='applied',decided_by=p_actor,decided_at=clock_timestamp(),decision_note=n where id=v_id;
    perform private.execution_notify(p_company,p_actor,j.created_by,'Planned date changed','Job '||coalesce(j.job_number,'record')||' moved from '||to_char(x.previous_date,'DD Mon')||' to '||to_char(x.new_date,'DD Mon')||'.',j.id,'/production/'||j.id);
    if o.created_by is distinct from j.created_by then perform private.execution_notify(p_company,p_actor,o.created_by,'Planned date changed','Job '||coalesce(j.job_number,'record')||' for order '||o.order_number||' moved to '||to_char(x.new_date,'DD Mon')||'.',j.id,'/production/'||j.id); end if;
    perform private.execution_notify(p_company,p_actor,x.requested_by,'Window change approved','Your change for job '||coalesce(j.job_number,'record')||' was applied.',j.id,'/production/'||j.id);
  elsif a='window.reject' then update public.execution_window_changes set status='rejected',decided_by=p_actor,decided_at=clock_timestamp(),decision_note=n where id=v_id and company_id=p_company;
  -- NOV-045 -----------------------------------------------------------------------------------
  elsif a='wip.set_limit' then
    update public.stage_wip_limits set status='retired',retired_at=clock_timestamp(),retired_by=p_actor where company_id=p_company and stage=p_mutation->>'stage' and status='active';
    insert into public.stage_wip_limits(id,company_id,stage,unit,limit_value,basis,created_by) values(p_request,p_company,p_mutation->>'stage',p_mutation->>'unit',(p_mutation->>'limit_value')::numeric,btrim(p_mutation->>'basis'),p_actor);
    perform private.execution_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Limit set','href','/tasks/execution/wip/'||p_request,'message','The stage now shows its position against this advisory limit.');
  elsif a='wip.retire_limit' then update public.stage_wip_limits set status='retired',retired_at=clock_timestamp(),retired_by=p_actor where id=v_id and company_id=p_company;
  elsif a='wip.release' then
    insert into public.wip_release_decisions(company_id,job_id,stage,unit,wip_value,limit_value,reason,decided_by)
    select p_company,(p_mutation->>'job_id')::uuid,l.stage,l.unit,(p_context->'source'->>'now')::numeric+case when l.unit='kg' then coalesce((select planned_quantity_kg from public.production_jobs where id=(p_mutation->>'job_id')::uuid),0) else 1 end,l.limit_value,n,p_actor
    from public.stage_wip_limits l where l.id=(p_context->'source'->>'limit')::uuid and l.company_id=p_company;
    v_entity:=(p_context->'source'->>'limit')::uuid;
  -- NOV-047 -----------------------------------------------------------------------------------
  elsif a='rule.set' then
    update public.assignment_rules set status='retired',retired_at=clock_timestamp(),retired_by=p_actor where company_id=p_company and task_type=p_mutation->>'task_type' and status='active';
    insert into public.assignment_rules(id,company_id,task_type,allowed_roles,required_competency_id,estimate_minutes,created_by)
    values(p_request,p_company,p_mutation->>'task_type',(select array_agg(distinct e) from jsonb_array_elements_text(p_mutation->'allowed_roles') e),nullif(p_mutation->>'competency_id','')::uuid,nullif(p_mutation->>'estimate_minutes','')::integer,p_actor);
    perform private.execution_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Rule set','href','/tasks/execution/rules/'||p_request,'message','Eligibility for this task type now follows the rule.');
  elsif a='rule.retire' then update public.assignment_rules set status='retired',retired_at=clock_timestamp(),retired_by=p_actor where id=v_id and company_id=p_company;
  elsif a='availability.record' then
    insert into public.employee_unavailability(id,company_id,employee_id,starts_on,ends_on,kind,recorded_by) values(p_request,p_company,(p_mutation->>'employee_id')::uuid,(p_mutation->>'starts_on')::date,(p_mutation->>'ends_on')::date,p_mutation->>'kind',p_actor);
    perform private.execution_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Unavailability recorded','href','/tasks/execution/rules/'||p_request,'message','Recommendations now show the person as unavailable for the period.');
  elsif a='availability.cancel' then update public.employee_unavailability set cancelled_at=clock_timestamp(),cancelled_by=p_actor where id=v_id and company_id=p_company;
  elsif a='assignment.assign' then
    select * into t from public.tasks where id=v_id and company_id=p_company;
    insert into public.task_assignment_decisions(company_id,task_id,assignee_id,previous_assignee,eligibility,override_reason,source,decided_by)
    values(p_company,t.id,(p_mutation->>'assignee_id')::uuid,t.assigned_to,p_context->'source'->'assignee_check',nullif(btrim(coalesce(p_mutation->>'override_reason','')),''),'assignment',p_actor);
    update public.tasks set assigned_to=(p_mutation->>'assignee_id')::uuid,assigned_by_user_id=p_actor,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    perform private.execution_notify(p_company,p_actor,(p_mutation->>'assignee_id')::uuid,'Task assigned to you',t.title,t.id,'/tasks/'||t.id);
  -- NOV-052 -----------------------------------------------------------------------------------
  elsif a='route.define' then
    select coalesce(max(version),0)+1 into v_version from public.route_families where company_id=p_company and code=p_mutation->>'code';
    select coalesce(array_agg(e order by array_position(v_all,e)),'{}') into v_req from (select distinct e from jsonb_array_elements_text(p_mutation->'required_stages') e) q;
    select coalesce(array_agg(e order by array_position(v_all,e)),'{}') into v_opt from (select distinct e from jsonb_array_elements_text(coalesce(p_mutation->'optional_stages','[]'::jsonb)) e) q;
    insert into public.route_families(id,company_id,code,name,version,applies_when,required_stages,optional_stages,created_by) values(p_request,p_company,p_mutation->>'code',btrim(p_mutation->>'name'),v_version,btrim(p_mutation->>'applies_when'),v_req,v_opt,p_actor);
    perform private.execution_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Route drafted','href','/tasks/execution/routes/'||p_request,'message','A second person approves it before orders can use it.');
  elsif a='route.approve' then
    select * into f from public.route_families where id=v_id and company_id=p_company;
    update public.route_families set status='retired',retired_at=clock_timestamp() where company_id=p_company and code=f.code and status='approved';
    update public.route_families set status='approved',approved_by=p_actor,approved_at=clock_timestamp() where id=v_id;
  elsif a='route.retire' then update public.route_families set status='retired',retired_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='route.bind' then
    select * into f from public.route_families where id=(p_mutation->>'family_id')::uuid and company_id=p_company;
    update public.order_route_bindings set status='superseded',superseded_at=clock_timestamp() where company_id=p_company and order_id=(p_mutation->>'order_id')::uuid and status='active';
    insert into public.order_route_bindings(id,company_id,order_id,family_id,family_code,family_version,reason,bound_by) values(p_request,p_company,(p_mutation->>'order_id')::uuid,f.id,f.code,f.version,n,p_actor);
    v_entity:=(p_mutation->>'order_id')::uuid; perform private.execution_record(p_company,'routes',v_entity,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Route bound','href','/orders/'||v_entity,'message','Order progress now reads against '||f.name||' v'||f.version||'.');
  elsif a='route.deviate' then
    select * into b from public.order_route_bindings where company_id=p_company and order_id=(p_mutation->>'order_id')::uuid and status='active';
    insert into public.order_route_deviations(id,company_id,binding_id,order_id,stage,reason,requested_by) values(p_request,p_company,b.id,b.order_id,p_mutation->>'stage',n,p_actor)
    on conflict(binding_id,stage) do update set status='requested',reason=excluded.reason,requested_by=excluded.requested_by,decided_by=null,decided_at=null,decision_note=null,created_at=clock_timestamp()
      returning id into v_entity;
    perform private.execution_record(p_company,v_view,v_entity,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Deviation requested','href','/tasks/execution/routes/'||v_entity,'message','A second person decides it.');
  elsif a='route.decide' then
    update public.order_route_deviations set status=case when p_mutation->>'decision'='approve' then 'approved' else 'rejected' end,decided_by=p_actor,decided_at=clock_timestamp(),decision_note=n where id=v_id and company_id=p_company;
  -- NOV-019 -----------------------------------------------------------------------------------
  elsif a='message.prepare' then
    v_b:=private.message_build(p_company,p_mutation->>'template',(p_mutation->>'entity_id')::uuid,p_mutation->>'recipient_phone');
    update public.document_communications set state='superseded',state_changed_at=clock_timestamp(),state_changed_by=p_actor where company_id=p_company and template=p_mutation->>'template' and entity_id=(p_mutation->>'entity_id')::uuid and state='prepared';
    insert into public.document_communications(id,company_id,template,entity_type,entity_id,customer_id,recipient_name,recipient_phone,recipient_source,message_body,document_label,document_href,source_fingerprint,created_by)
    values(p_request,p_company,p_mutation->>'template',case p_mutation->>'template' when 'order_confirmation' then 'order' when 'dispatch_notice' then 'dispatch' else 'appointment' end,(p_mutation->>'entity_id')::uuid,
      nullif(v_b->>'customer_id','')::uuid,v_b->>'recipient_name',v_b->>'recipient_phone',v_b->>'recipient_source',v_b->>'body',v_b->>'document_label',v_b->>'document_href',v_b->>'fingerprint',p_actor);
    perform private.execution_record(p_company,v_view,p_request,a,p_actor,'Prepared for the customer; nothing sent',v_facts);
    return jsonb_build_object('label','Message prepared','href','/tasks/execution/messages/'||p_request,'message','Copy or print it from the message. Nothing has been sent.');
  elsif a='message.mark' then
    update public.document_communications set state=p_mutation->>'state',state_changed_at=clock_timestamp(),state_changed_by=p_actor where id=v_id and company_id=p_company and state='prepared';
    n:='Marked '||(p_mutation->>'state');
  elsif a='message.cancel' then
    update public.document_communications set state='cancelled',state_changed_at=clock_timestamp(),state_changed_by=p_actor where id=v_id and company_id=p_company and state='prepared';
    n:='Prepared message cancelled';
  -- NOV-014 -----------------------------------------------------------------------------------
  elsif a='queue.update' then
    for v_e in select value from jsonb_array_elements(p_mutation->'records') loop
      select * into t from public.tasks where id=(v_e->>'id')::uuid and company_id=p_company for update;
      v_c:=private.queue_classify(p_company,p_mutation->>'field',p_mutation->>'value',(v_e->>'id')::uuid,v_e->>'version');
      if v_c->>'outcome'='will_change' then
        if p_mutation->>'field'='assigned_to' then
          update public.tasks set assigned_to=(p_mutation->>'value')::uuid,assigned_by_user_id=p_actor,updated_at=clock_timestamp() where id=t.id and company_id=p_company;
          insert into public.task_assignment_decisions(company_id,task_id,assignee_id,previous_assignee,eligibility,source,decided_by)
          values(p_company,t.id,(p_mutation->>'value')::uuid,t.assigned_to,private.assignment_check(p_company,t,(p_mutation->>'value')::uuid),'queue',p_actor);
        elsif p_mutation->>'field'='priority' then update public.tasks set priority=p_mutation->>'value',updated_at=clock_timestamp() where id=t.id and company_id=p_company;
        else update public.tasks set due_date=(p_mutation->>'value')::date,updated_at=clock_timestamp() where id=t.id and company_id=p_company; end if;
        v_changed:=v_changed+1; v_c:=v_c||jsonb_build_object('outcome','changed');
      elsif v_c->>'outcome'='no_change' then v_same:=v_same+1; else v_bad:=v_bad+1; end if;
      v_out:=v_out||jsonb_build_array(v_c);
    end loop;
    perform private.execution_record(p_company,v_view,p_request,a,p_actor,format('%s changed, %s unchanged, %s not changed',v_changed,v_same,v_bad),jsonb_build_object('field',p_mutation->>'field','records',v_out));
    return jsonb_build_object('label',v_changed||' task(s) updated','href','/tasks/execution/database?view=queue','message',format('%s changed, %s already had the value, %s were not changed. Every selected task is listed below.',v_changed,v_same,v_bad),'records',v_out);
  else raise exception 'NOV: Unknown action.';
  end if;
  perform private.execution_record(p_company,v_view,v_entity,a,p_actor,n,v_facts);
  return jsonb_build_object('label',p_context->'review'->>'title','href',case v_view when 'queue' then null else '/tasks/execution/'||v_view||'/'||v_entity end,'message','Recorded.');
end $$;
revoke all on function private.execution_apply(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

create function public.execution_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid();v_company uuid:=private.get_current_user_company_id();v_role text:=private.get_current_user_role();
  v_view text;v_page integer;v_search text;v_state text;v_sort text;v_status text;v_items_page integer;v_id uuid;v_total bigint;v_rows jsonb;v_row jsonb;v_events jsonb;
  r public.execution_requests%rowtype;v_context jsonb;v_fingerprint text;v_result jsonb;v_message text;v_keys text[];
begin
  if v_actor is null or v_company is null or not exists(select 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null)
    or not private.execution_read_allowed(v_role,null) then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.app_users where id=v_actor and company_id=v_company for share;
  v_keys:=case p_command when 'list' then array['view','page','search','state','sort','status'] when 'detail' then array['view','id','page','items_page']
    when 'lookup' then array['kind','search','selected_id','parent_id'] when 'preview' then array['request_id','mutation'] when 'commit' then array['request_id','fingerprint']
    when 'outcome' then array['request_id'] when 'abandon' then array['request_id'] end;
  if jsonb_typeof(p_payload) is distinct from 'object' or v_keys is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(v_keys))) then raise exception 'NOV: Invalid execution request.'; end if;
  if p_command in ('list','detail') then
    v_view:=p_payload->>'view';v_page:=coalesce((p_payload->>'page')::integer,1);v_search:=btrim(coalesce(p_payload->>'search',''));
    v_state:=coalesce(p_payload->>'state','active');v_sort:=coalesce(p_payload->>'sort','priority');v_status:=nullif(btrim(coalesce(p_payload->>'status','')),'');
    if v_view is null or v_view not in ('appointments','gate_passes','loads','windows','wip','assignments','rules','routes','messages','queue') or not private.execution_read_allowed(v_role,v_view) then raise exception 'Not permitted' using errcode='42501'; end if;
    if v_page not between 1 and 100000 or length(v_search)>80 or v_state not in ('active','all') or v_sort not in ('priority','newest','due') or coalesce(v_status,'x') !~ '^[a-z_]{1,40}$' then raise exception 'NOV: Invalid execution filters.'; end if;
    if p_command='detail' then
      v_id:=private.execution_uuid(p_payload,'id'); v_items_page:=coalesce((p_payload->>'items_page')::integer,1);
      if v_items_page not between 1 and 100000 then raise exception 'NOV: Invalid execution filters.'; end if;
      select row_data into v_row from private.execution_rows(v_company,v_actor,v_role,v_view,'all',v_id,v_items_page) limit 1;
      if v_row is null then raise exception 'NOV: This record is unavailable.'; end if;
      select count(*) into v_total from public.execution_events where company_id=v_company and view_name=v_view and entity_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(x) order by recorded_at desc,id),'[]'::jsonb) into v_events from (
        select id,action,actor_name as actor,note,recorded_at from public.execution_events where company_id=v_company and view_name=v_view and entity_id=v_id order by recorded_at desc,id limit 10 offset (v_page-1)*10
      ) x;
      return jsonb_build_object('row',v_row,'events',v_events,'event_count',v_total,'as_of',now());
    end if;
    with visible as (select * from private.execution_rows(v_company,v_actor,v_role,v_view,v_state,null) where (v_status is null or row_data->>'status'=v_status)
      and (v_search='' or position(lower(v_search) in lower(coalesce(row_data->>'label','')||' '||coalesce(row_data->>'status','')||' '||coalesce(row_data->>'owner','')||' '||coalesce(row_data->>'summary','')))>0))
    select (select count(*) from visible),coalesce((select jsonb_agg(x.row_data order by x.position) from (
      select row_data,row_number() over(order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id')) as position
      from visible order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id') limit 10 offset (v_page-1)*10
    ) x),'[]'::jsonb) into v_total,v_rows;
    return jsonb_build_object('rows',v_rows,'total_count',v_total,'as_of',now());
  elsif p_command='lookup' then
    if length(coalesce(p_payload->>'search',''))>80 then raise exception 'NOV: Keep search within 80 characters.'; end if;
    return private.execution_lookup(v_company,v_actor,v_role,p_payload);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':execution',0));
  v_id:=private.execution_uuid(p_payload,'request_id');
  select * into r from public.execution_requests where request_id=v_id for update;
  if found and (r.company_id<>v_company or r.actor_id<>v_actor) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_command='preview' then
    if r.request_id is not null then
      if r.mutation is distinct from p_payload->'mutation' then raise exception 'NOV: This request identity belongs to different details.'; end if;
      if not private.execution_action_allowed(v_role,r.mutation->>'action') then raise exception 'Not permitted' using errcode='42501'; end if;
      return private.execution_outcome(r);
    end if;
    v_context:=private.execution_context(v_company,v_actor,p_payload->'mutation',false);
    v_fingerprint:=md5((v_context->'source')::text||(p_payload->'mutation')::text);
    insert into public.execution_requests(request_id,company_id,actor_id,mutation,fingerprint,review)
      values(v_id,v_company,v_actor,p_payload->'mutation',v_fingerprint,v_context->'review') returning * into r;
  else
    if r.request_id is null then
      if p_command in ('outcome','abandon') then return jsonb_build_object('request_id',v_id,'state','not_recorded','fingerprint',repeat('0',32),'expires_at',now(),'action','',
        'review',jsonb_build_object('title','Original request check','effect','No prepared or committed action exists for this original request.','warnings','[]'::jsonb,'facts','{}'::jsonb),
        'result',jsonb_build_object('label','Not recorded','href',null,'message','No change was committed with this original request identity. It is safe to start a reviewed action.')); end if;
      raise exception 'NOV: The original request was not found. No action was committed with that request identity.';
    end if;
    if (p_command='commit' and not private.execution_action_allowed(v_role,r.mutation->>'action'))
      or (p_command in ('outcome','abandon') and not private.execution_read_allowed(v_role,private.execution_view(r.mutation->>'action'))) then raise exception 'Not permitted' using errcode='42501'; end if;
    if p_command='commit' and r.state='prepared' then
      if r.fingerprint is distinct from p_payload->>'fingerprint' then raise exception 'NOV: Confirmation does not match the reviewed request.'; end if;
      begin
        if r.expires_at<=now() then raise exception 'NOV: This review expired. Review the current source again.'; end if;
        v_context:=private.execution_context(v_company,v_actor,r.mutation,true);
        if r.fingerprint<>md5((v_context->'source')::text||r.mutation::text) then raise exception 'NOV: A relevant source changed. Review the current details again.'; end if;
        v_result:=private.execution_apply(v_company,v_actor,v_id,r.mutation,v_context);
        update public.execution_requests set state='confirmed',result=v_result where request_id=v_id returning * into r;
      exception when others then
        v_message:=case when sqlstate='P0001' and sqlerrm like 'NOV: %' then substring(sqlerrm from 6)
          when sqlstate in ('23514','23P01','55P03') and sqlerrm not like '%violates%' and sqlerrm not like '%constraint%' then sqlerrm
          else 'The existing workflow rejected this action. No change from this request was committed. Refresh the source and review its current requirements.' end;
        update public.execution_requests set state='rejected',result=jsonb_build_object('label',r.review->>'title','href',null,'message',v_message) where request_id=v_id returning * into r;
      end;
    elsif p_command='abandon' and r.state='prepared' then
      update public.execution_requests set state='abandoned',result=jsonb_build_object('label',r.review->>'title','href',null,'message','Review cancelled. This request made no change.') where request_id=v_id returning * into r;
    elsif p_command not in ('commit','outcome','abandon') then raise exception 'NOV: Invalid execution request.';
    end if;
  end if;
  return private.execution_outcome(r);
end $$;
revoke all on function public.execution_command(text,jsonb) from public,anon;
grant execute on function public.execution_command(text,jsonb) to authenticated;

------------------------------------------------------------------------------------------------
-- NOV-044 enforcement. Off by default: a window only blocks direct date or shift changes when an
-- active window is explicitly set to enforce. The reviewed approval path sets a transaction-local
-- marker for the one job it moves.
------------------------------------------------------------------------------------------------
create function private.enforce_execution_window() returns trigger language plpgsql security definer set search_path=public,private as $$
declare w public.execution_windows;
begin
  if new.planned_date is not distinct from old.planned_date and new.shift is not distinct from old.shift then return new; end if;
  if old.status not in ('planned','ready','on_hold') then return new; end if;
  if current_setting('app.execution_window_apply',true)=old.id::text then return new; end if;
  select * into w from public.execution_windows ew where ew.company_id=old.company_id and ew.status='active' and ew.enforce and (ew.machine_id is null or ew.machine_id=old.machine_id)
    order by (ew.machine_id is null),ew.horizon_hours desc limit 1;
  if w.id is not null and private.execution_in_window(w,old.planned_date) then
    raise exception 'NOV: This job is planned inside the protected execution window. Request the change from Execution planning so a second person can review it.' using errcode='P0001';
  end if;
  return new;
end $$;
revoke all on function private.enforce_execution_window() from public,anon,authenticated;
create trigger zz_enforce_execution_window before update of planned_date,shift on public.production_jobs for each row execute function private.enforce_execution_window();
