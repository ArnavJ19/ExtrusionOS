-- November batch 6: order closure, samples and first-piece approval, packing templates and labels,
-- delivery promises, material traceability, bundle split and combine, journey reviews, and personal
-- form defaults. Every consequential action uses the reviewed request protocol of batches 3 to 5;
-- existing domain guards still run on every write. Additive; depends on the batch 5 assurance tables.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create unique index if not exists control_job_tenant_key on public.production_jobs(company_id,id);
create unique index if not exists coordination_user_tenant_key on public.app_users(company_id,id);
create unique index if not exists assurance_order_tenant_key on public.orders(company_id,id);
create unique index if not exists assurance_order_item_tenant_key on public.order_items(company_id,id);
create unique index if not exists assurance_profile_tenant_key on public.aluminium_profiles(company_id,id);
create unique index if not exists assurance_stock_batch_tenant_key on public.profile_stock_batches(company_id,id);
create unique index if not exists assurance_dispatch_tenant_key on public.dispatches(company_id,id);
create unique index if not exists assurance_packing_tenant_key on public.packing_list_items(company_id,id);
create unique index if not exists lifecycle_customer_tenant_key on public.customers(company_id,id);
create unique index if not exists lifecycle_die_tenant_key on public.dies(company_id,id);
create unique index if not exists lifecycle_prepared_bundle_tenant_key on public.prepared_physical_bundles(company_id,id);
create unique index if not exists lifecycle_project_tenant_key on public.customer_projects(company_id,id);
create unique index if not exists lifecycle_machine_tenant_key on public.machines(company_id,id);
create index if not exists lifecycle_order_stage_idx on public.orders(company_id,current_stage) where deleted_at is null;
create index if not exists lifecycle_reservation_order_idx on public.profile_stock_reservations(company_id,order_id) where status='active';
create index if not exists lifecycle_finishing_order_idx on public.finishing_jobs(company_id,order_id);
create index if not exists lifecycle_dispatch_order_idx on public.dispatches(company_id,order_id);
create index if not exists lifecycle_invoice_order_idx on public.invoices(company_id,order_id) where deleted_at is null;
create index if not exists lifecycle_prepared_order_idx on public.prepared_physical_bundles(company_id,order_id) where dispatch_id is null;
create index if not exists lifecycle_stock_job_idx on public.profile_stock_batches(company_id,production_job_id) where production_job_id is not null;
create index if not exists lifecycle_billet_job_idx on public.foundry_billets(company_id,production_job_id) where production_job_id is not null;
create index if not exists lifecycle_packing_stock_idx on public.packing_list_items(company_id,profile_stock_batch_id) where profile_stock_batch_id is not null;
create index if not exists lifecycle_stock_bundle_idx on public.profile_stock_batches(company_id,upper(btrim(bundle_number))) where bundle_number is not null;

-- NOV-068: a stock row consumed by a split or combination keeps its history under a distinct status.
-- Widening only; every existing value stays valid.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid='public.profile_stock_batches'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%(status = ANY%' loop
    execute format('alter table public.profile_stock_batches drop constraint %I',c);
  end loop;
end $$;
alter table public.profile_stock_batches add constraint profile_stock_status_check
  check (status = any (array['available','reserved','dispatched','rejected','scrap','transformed']));

------------------------------------------------------------------------------------------------
-- NOV-058: reviewed order closure with carried items, snapshot and reasoned reopening.
------------------------------------------------------------------------------------------------
create table public.order_closures (
  id uuid primary key, company_id uuid not null references public.companies(id), order_id uuid not null,
  kind text not null check(kind in ('operational','final')), status text not null default 'closed' check(status in ('closed','reopened')),
  previous_stage text not null, readiness jsonb not null check(jsonb_typeof(readiness)='array'), carried jsonb not null check(jsonb_typeof(carried)='array'),
  closed_by uuid not null, closed_at timestamptz not null default clock_timestamp(), close_note text not null,
  reopened_by uuid, reopened_at timestamptz, reopen_note text, check((status='reopened')=(reopened_at is not null)), unique(company_id,id),
  foreign key(company_id,order_id) references public.orders(company_id,id),
  foreign key(company_id,closed_by) references public.app_users(company_id,id), foreign key(company_id,reopened_by) references public.app_users(company_id,id)
);
create unique index order_closures_one_active on public.order_closures(company_id,order_id) where status='closed';
create table public.order_closure_carries (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), order_id uuid not null,
  item_key text not null check(item_key ~ '^(return|exception|change):[0-9a-f-]{36}$'), reason text not null check(length(btrim(reason)) between 5 and 500),
  carried_by uuid not null, carried_at timestamptz not null default clock_timestamp(), withdrawn_at timestamptz,
  foreign key(company_id,order_id) references public.orders(company_id,id), foreign key(company_id,carried_by) references public.app_users(company_id,id)
);
create unique index order_closure_carries_one on public.order_closure_carries(company_id,order_id,item_key) where withdrawn_at is null;

------------------------------------------------------------------------------------------------
-- NOV-063: sample requirements bound to order, profile, die and drawing revision, with events.
------------------------------------------------------------------------------------------------
create table public.sample_requirements (
  id uuid primary key, company_id uuid not null references public.companies(id), order_id uuid not null, customer_id uuid not null, profile_id uuid not null,
  die_id uuid, drawing_revision_id uuid, reason text not null check(reason in ('new_die','new_profile','customer_request','process_change','requalification')),
  quantity_pieces integer not null check(quantity_pieces between 1 and 10000), authority text not null check(authority in ('customer','internal')),
  gates_production boolean not null, response_days smallint not null check(response_days between 1 and 90),
  requested_by uuid not null, requested_at timestamptz not null default clock_timestamp(), unique(company_id,id),
  foreign key(company_id,order_id) references public.orders(company_id,id), foreign key(company_id,customer_id) references public.customers(company_id,id),
  foreign key(company_id,profile_id) references public.aluminium_profiles(company_id,id), foreign key(company_id,die_id) references public.dies(company_id,id),
  foreign key(company_id,drawing_revision_id) references public.drawing_revisions(company_id,id), foreign key(company_id,requested_by) references public.app_users(company_id,id)
);
create index sample_requirements_order_idx on public.sample_requirements(company_id,order_id,profile_id);
create table public.sample_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), requirement_id uuid not null,
  event text not null check(event in ('produced','measured','sent','lost','approved','conditional','rejected','clarification','invalidated','withdrawn')),
  iteration integer not null check(iteration>=1), job_id uuid, sample_tag text check(sample_tag is null or length(btrim(sample_tag)) between 2 and 60),
  location text check(location is null or length(btrim(location)) between 2 and 120), recipient text check(recipient is null or length(btrim(recipient)) between 2 and 120),
  expected_response date, customer_contact text check(customer_contact is null or length(btrim(customer_contact)) between 2 and 120),
  limit_kg numeric(14,3) check(limit_kg is null or limit_kg>0), evidence text not null check(length(btrim(evidence)) between 5 and 500),
  die_id uuid, drawing_revision_id uuid, recorded_by uuid not null, recorded_role text not null, recorded_at timestamptz not null default clock_timestamp(),
  check((event='produced')=(job_id is not null and sample_tag is not null)), check((event='conditional')=(limit_kg is not null)),
  foreign key(company_id,requirement_id) references public.sample_requirements(company_id,id), foreign key(company_id,job_id) references public.production_jobs(company_id,id),
  foreign key(company_id,recorded_by) references public.app_users(company_id,id)
);
create index sample_events_requirement_idx on public.sample_events(company_id,requirement_id,recorded_at desc,id desc);

------------------------------------------------------------------------------------------------
-- NOV-079: versioned packing and label templates, and label prints bound to a template revision.
------------------------------------------------------------------------------------------------
create table public.packing_label_templates (
  id uuid primary key, company_id uuid not null references public.companies(id), scope text not null check(scope in ('company','customer','project','order')),
  customer_id uuid, project_id uuid, order_id uuid, revision integer not null check(revision>=1),
  status text not null default 'draft' check(status in ('draft','approved','superseded')),
  instructions text not null check(length(btrim(instructions)) between 5 and 1000), max_bundle_kg numeric(10,3) check(max_bundle_kg is null or max_bundle_kg>0),
  max_pieces integer check(max_pieces is null or max_pieces>0), spacer_required boolean not null, wrapping text check(wrapping is null or length(btrim(wrapping)) between 2 and 200),
  label_fields text[] not null check(cardinality(label_fields) between 1 and 12 and label_fields <@ array['bundle_number','order_number','customer','customer_profile_ref','profile_code','finish',
    'cut_length_mm','pieces','net_kg','gross_kg','drawing_revision','destination','project','packed_on']),
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(), approved_by uuid, approved_at timestamptz,
  check((scope='company')=(customer_id is null and project_id is null and order_id is null)), check(scope<>'customer' or (customer_id is not null and project_id is null and order_id is null)),
  check(scope<>'project' or (project_id is not null and order_id is null)), check(scope<>'order' or (order_id is not null)),
  check((status='draft')=(approved_at is null)), check(approved_by is null or approved_by<>created_by), unique(company_id,id),
  foreign key(company_id,customer_id) references public.customers(company_id,id), foreign key(company_id,project_id) references public.customer_projects(company_id,id),
  foreign key(company_id,order_id) references public.orders(company_id,id), foreign key(company_id,created_by) references public.app_users(company_id,id),
  foreign key(company_id,approved_by) references public.app_users(company_id,id)
);
create unique index packing_label_templates_one_approved on public.packing_label_templates(company_id,scope,coalesce(customer_id,project_id,order_id,company_id)) where status='approved';
create table public.packing_label_prints (
  id uuid primary key, company_id uuid not null references public.companies(id), bundle_id uuid not null, template_id uuid not null, template_revision integer not null,
  print_number integer not null check(print_number>=1), reason text not null check(reason in ('initial','reprint','damaged','relabel')),
  status text not null default 'active' check(status in ('active','superseded')), payload jsonb not null check(jsonb_typeof(payload)='object'),
  observations jsonb not null check(jsonb_typeof(observations)='object'), deviation text check(deviation is null or length(btrim(deviation)) between 5 and 500),
  printed_by uuid not null, printed_role text not null, printed_at timestamptz not null default clock_timestamp(),
  unique(company_id,bundle_id,print_number), unique(company_id,id),
  foreign key(company_id,bundle_id) references public.prepared_physical_bundles(company_id,id),
  foreign key(company_id,template_id) references public.packing_label_templates(company_id,id), foreign key(company_id,printed_by) references public.app_users(company_id,id)
);
create unique index packing_label_prints_one_active on public.packing_label_prints(company_id,bundle_id) where status='active';

------------------------------------------------------------------------------------------------
-- NOV-021: delivery promise proposals with their evaluated snapshot, expiry and acceptance.
------------------------------------------------------------------------------------------------
create table public.delivery_promises (
  id uuid primary key, company_id uuid not null references public.companies(id), order_id uuid not null,
  tranches jsonb not null check(jsonb_typeof(tranches)='array' and jsonb_array_length(tranches) between 1 and 4),
  verdict text not null check(verdict in ('feasible','at_risk','infeasible','incomplete')), evaluation jsonb not null check(jsonb_typeof(evaluation)='object'),
  status text not null default 'proposed' check(status in ('proposed','accepted','withdrawn','superseded')),
  expires_at timestamptz not null, proposed_by uuid not null, proposed_at timestamptz not null default clock_timestamp(),
  accepted_by uuid, accepted_at timestamptz, previous_expected_date date, closed_note text, closed_at timestamptz,
  check(status<>'accepted' or accepted_at is not null), unique(company_id,id),
  foreign key(company_id,order_id) references public.orders(company_id,id), foreign key(company_id,proposed_by) references public.app_users(company_id,id),
  foreign key(company_id,accepted_by) references public.app_users(company_id,id)
);
create unique index delivery_promises_one_accepted on public.delivery_promises(company_id,order_id) where status='accepted';
create index delivery_promises_order_idx on public.delivery_promises(company_id,order_id,proposed_at desc);

------------------------------------------------------------------------------------------------
-- NOV-027 and NOV-068: explicit lineage, investigations, and bundle transformations.
------------------------------------------------------------------------------------------------
create table public.material_lineage_links (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  from_type text not null check(from_type in ('billet_batch','foundry_billet','production_job','stock_batch','prepared_bundle')),
  from_id uuid not null, to_type text not null check(to_type in ('production_job','stock_batch','prepared_bundle')), to_id uuid not null,
  relation text not null check(relation in ('issued_to','packed_from','split_into','merged_into','reversed_into')),
  quantity_kg numeric(14,3) check(quantity_kg is null or quantity_kg>0), basis text not null check(basis in ('transformation','evidenced_mapping')),
  transformation_id uuid, evidence text not null check(length(btrim(evidence)) between 5 and 500), recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  check(from_id<>to_id), check((basis='transformation')=(transformation_id is not null)), unique(company_id,from_type,from_id,to_type,to_id,relation),
  foreign key(company_id,recorded_by) references public.app_users(company_id,id)
);
create index material_lineage_from_idx on public.material_lineage_links(company_id,from_type,from_id);
create index material_lineage_to_idx on public.material_lineage_links(company_id,to_type,to_id);
create table public.trace_investigations (
  id uuid primary key, company_id uuid not null references public.companies(id), start_type text not null, start_id uuid not null, start_label text not null,
  reason text not null, snapshot jsonb not null check(jsonb_typeof(snapshot)='object'), status text not null default 'open' check(status in ('open','closed')),
  opened_by uuid not null, opened_at timestamptz not null default clock_timestamp(), closed_by uuid, closed_at timestamptz, conclusion text,
  check((status='closed')=(closed_at is not null)), unique(company_id,id),
  foreign key(company_id,opened_by) references public.app_users(company_id,id), foreign key(company_id,closed_by) references public.app_users(company_id,id)
);
create table public.trace_holds (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), investigation_id uuid not null, stock_batch_id uuid not null,
  previous_qc_status text not null, held_by uuid not null, held_at timestamptz not null default clock_timestamp(), unique(company_id,investigation_id,stock_batch_id),
  foreign key(company_id,investigation_id) references public.trace_investigations(company_id,id),
  foreign key(company_id,stock_batch_id) references public.profile_stock_batches(company_id,id), foreign key(company_id,held_by) references public.app_users(company_id,id)
);
create table public.bundle_transformations (
  id uuid primary key, company_id uuid not null references public.companies(id), kind text not null check(kind in ('split','merge')),
  status text not null default 'completed' check(status in ('completed','reversed')), input_kg numeric(14,3) not null check(input_kg>0), output_kg numeric(14,3) not null check(output_kg>0),
  variance_kg numeric(14,3) not null, variance_reason text, check(output_kg<=input_kg), check(variance_kg=output_kg-input_kg), check(variance_kg=0 or variance_reason is not null),
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(), reversed_by uuid, reversed_at timestamptz, reverse_note text,
  check((status='reversed')=(reversed_at is not null)), unique(company_id,id),
  foreign key(company_id,recorded_by) references public.app_users(company_id,id), foreign key(company_id,reversed_by) references public.app_users(company_id,id)
);
create table public.bundle_transformation_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), transformation_id uuid not null,
  direction text not null check(direction in ('input','output')), stock_batch_id uuid not null, bundle_number text, pieces integer not null check(pieces>0),
  kg numeric(14,3) not null check(kg>0), unique(company_id,transformation_id,stock_batch_id),
  foreign key(company_id,transformation_id) references public.bundle_transformations(company_id,id),
  foreign key(company_id,stock_batch_id) references public.profile_stock_batches(company_id,id)
);
create index bundle_lines_batch_idx on public.bundle_transformation_lines(company_id,stock_batch_id);
alter table public.material_lineage_links add foreign key(company_id,transformation_id) references public.bundle_transformations(company_id,id);

------------------------------------------------------------------------------------------------
-- NOV-060: journey reviews with annotations, improvement actions and comparable measures.
------------------------------------------------------------------------------------------------
create table public.journey_reviews (
  id uuid primary key, company_id uuid not null references public.companies(id), order_id uuid not null, title text not null check(length(btrim(title)) between 5 and 120),
  participants text not null check(length(btrim(participants)) between 3 and 300), baseline_from date not null, baseline_to date not null, check(baseline_to>=baseline_from),
  status text not null default 'open' check(status in ('open','closed')), owner_id uuid not null, opened_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz, closed_note text, check((status='closed')=(closed_at is not null)), unique(company_id,id),
  foreign key(company_id,order_id) references public.orders(company_id,id), foreign key(company_id,owner_id) references public.app_users(company_id,id)
);
create table public.journey_annotations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), review_id uuid not null,
  kind text not null check(kind in ('active_work','waiting','rework','approval','information_search','missing_event')),
  minutes integer check(minutes is null or minutes between 1 and 100000), private boolean not null, observation text not null check(length(btrim(observation)) between 5 and 500),
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,review_id) references public.journey_reviews(company_id,id), foreign key(company_id,recorded_by) references public.app_users(company_id,id)
);
create index journey_annotations_review_idx on public.journey_annotations(company_id,review_id,recorded_at);
create table public.journey_actions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), review_id uuid not null,
  finding text not null check(length(btrim(finding)) between 5 and 300), owner_id uuid not null, due_date date not null,
  status text not null default 'open' check(status in ('open','trial','done','dropped')), updated_at timestamptz not null default clock_timestamp(), unique(company_id,id),
  foreign key(company_id,review_id) references public.journey_reviews(company_id,id), foreign key(company_id,owner_id) references public.app_users(company_id,id)
);
create table public.journey_measures (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), review_id uuid not null,
  phase text not null check(phase in ('baseline','trial')), metric text not null check(metric ~ '^[a-z][a-z0-9_]{2,40}$'), value numeric(14,3) not null check(value>=0),
  unit text not null check(unit in ('hours','days','count','percent','minutes')), sample_size integer not null check(sample_size between 1 and 100000),
  limitations text not null check(length(btrim(limitations)) between 5 and 500), recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  unique(company_id,review_id,phase,metric),
  foreign key(company_id,review_id) references public.journey_reviews(company_id,id), foreign key(company_id,recorded_by) references public.app_users(company_id,id)
);

------------------------------------------------------------------------------------------------
-- NOV-008: personal form defaults, scoped to the user and company.
------------------------------------------------------------------------------------------------
create table public.user_form_defaults (
  company_id uuid not null references public.companies(id), user_id uuid not null, form_key text not null check(form_key in ('production.machine_id','production.shift','dispatches.transporter_name')),
  value text not null check(length(btrim(value)) between 1 and 120), updated_at timestamptz not null default now(), primary key(company_id,user_id,form_key),
  foreign key(company_id,user_id) references public.app_users(company_id,id)
);
alter table public.user_form_defaults enable row level security;
revoke all on public.user_form_defaults from public,anon,authenticated;
grant select on public.user_form_defaults to authenticated;
create policy user_form_defaults_own on public.user_form_defaults for select to authenticated using (company_id=private.get_current_user_company_id() and user_id=auth.uid());

------------------------------------------------------------------------------------------------
-- Shared request identity, history and role matrix.
------------------------------------------------------------------------------------------------
create table public.lifecycle_requests (
  request_id uuid primary key, company_id uuid not null references public.companies(id), actor_id uuid not null,
  mutation jsonb not null, fingerprint text not null, review jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','confirmed','rejected','abandoned')),
  result jsonb, expires_at timestamptz not null default now()+interval '15 minutes', created_at timestamptz not null default now(),
  foreign key(company_id,actor_id) references public.app_users(company_id,id), check((state='prepared')=(result is null))
);
create index lifecycle_requests_actor_idx on public.lifecycle_requests(company_id,actor_id,created_at desc);
create table public.lifecycle_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  view_name text not null, entity_id uuid not null, action text not null, actor_id uuid, actor_name text not null,
  note text not null, facts jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create index lifecycle_events_entity_idx on public.lifecycle_events(company_id,view_name,entity_id,recorded_at desc,id);

create function private.lifecycle_view(p_action text) returns text language sql immutable set search_path=public,private as $$
  select case split_part(p_action,'.',1) when 'closure' then 'closure' when 'sample' then 'samples' when 'template' then 'templates' when 'label' then 'labels'
    when 'promise' then 'promises' when 'trace' then 'trace' when 'bundle' then 'bundles' when 'journey' then 'journeys' end
$$;
create function private.lifecycle_read_allowed(p_role text,p_view text) returns boolean language sql immutable set search_path=public,private as $$
  select coalesce(case
    when p_role not in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer') then false
    when p_view is null then true
    when p_view='closure' then p_role in ('owner','admin','sales_manager','sales','accounts','factory_manager','production_manager','dispatch_manager','inventory_manager','quality','viewer')
    when p_view='samples' then p_role in ('owner','admin','quality','factory_manager','production_manager','production','sales_manager','sales','dispatch_manager','viewer')
    when p_view in ('templates','labels') then p_role in ('owner','admin','quality','dispatch_manager','dispatch','inventory_manager','factory_manager','sales_manager','viewer')
    when p_view='promises' then p_role in ('owner','admin','sales_manager','sales','factory_manager','production_manager','viewer')
    when p_view='trace' then p_role in ('owner','admin','quality','factory_manager','production_manager','inventory_manager','dispatch_manager','viewer')
    when p_view='bundles' then p_role in ('owner','admin','inventory_manager','dispatch_manager','dispatch','factory_manager','quality','viewer')
    when p_view='journeys' then p_role in ('owner','admin','factory_manager','production_manager','sales_manager','quality','dispatch_manager','inventory_manager','accounts','viewer')
    else false end,false)
$$;
create function private.lifecycle_action_allowed(p_role text,p_action text) returns boolean language sql immutable set search_path=public,private as $$
  select private.lifecycle_view(p_action) is not null and private.lifecycle_read_allowed(p_role,private.lifecycle_view(p_action)) and p_role<>'viewer' and coalesce(case
    when p_action='closure.carry' then p_role in ('owner','admin','sales_manager','accounts')
    when p_action='closure.close' then p_role in ('owner','admin','sales_manager','factory_manager','accounts')
    when p_action='closure.reopen' then p_role in ('owner','admin')
    when p_action='sample.require' then p_role in ('owner','admin','quality','sales_manager','factory_manager')
    when p_action='sample.record' then p_role in ('owner','admin','quality','factory_manager','production_manager','dispatch_manager')
    when p_action='sample.decide' then p_role in ('owner','admin','quality','sales_manager','sales','factory_manager')
    when p_action='sample.invalidate' then p_role in ('owner','admin','quality','factory_manager')
    when p_action='sample.withdraw' then p_role in ('owner','admin','quality')
    when p_action in ('template.create','template.approve') then p_role in ('owner','admin','quality','dispatch_manager')
    when p_action='label.pack' then p_role in ('owner','admin','dispatch_manager','dispatch','inventory_manager')
    when p_action='label.reprint' then p_role in ('owner','admin','dispatch_manager','dispatch','inventory_manager','quality')
    when p_action='promise.propose' then p_role in ('owner','admin','sales_manager','sales','factory_manager','production_manager')
    when p_action='promise.accept' then p_role in ('owner','admin','sales_manager')
    when p_action='promise.withdraw' then p_role in ('owner','admin','sales_manager','sales')
    when p_action in ('trace.open','trace.close') then p_role in ('owner','admin','quality','factory_manager')
    when p_action='trace.link' then p_role in ('owner','admin','quality','inventory_manager','factory_manager')
    when p_action='trace.hold' then p_role in ('owner','admin','quality')
    when p_action in ('bundle.split','bundle.merge') then p_role in ('owner','admin','inventory_manager','dispatch_manager')
    when p_action='bundle.reverse' then p_role in ('owner','admin','inventory_manager')
    when p_action in ('journey.open','journey.action','journey.close') then p_role in ('owner','admin','factory_manager','production_manager','sales_manager','quality')
    when p_action='journey.annotate' then p_role in ('owner','admin','factory_manager','production_manager','sales_manager','quality','dispatch_manager','inventory_manager','accounts')
    when p_action='journey.progress' then p_role in ('owner','admin','factory_manager','production_manager','sales_manager','quality','dispatch_manager','inventory_manager','accounts')
    when p_action='journey.measure' then p_role in ('owner','admin','factory_manager','production_manager','quality')
    else false end,false)
$$;
revoke all on function private.lifecycle_view(text),private.lifecycle_read_allowed(text,text),private.lifecycle_action_allowed(text,text) from public,anon;
grant execute on function private.lifecycle_view(text),private.lifecycle_read_allowed(text,text),private.lifecycle_action_allowed(text,text) to authenticated;

do $$ declare t text; v text; begin
  for t,v in select * from (values ('order_closures','closure'),('order_closure_carries','closure'),('sample_requirements','samples'),('sample_events','samples'),
    ('packing_label_templates','templates'),('packing_label_prints','labels'),('delivery_promises','promises'),('material_lineage_links','trace'),('trace_investigations','trace'),
    ('trace_holds','trace'),('bundle_transformations','bundles'),('bundle_transformation_lines','bundles'),('journey_reviews','journeys'),('journey_actions','journeys'),
    ('journey_measures','journeys')) x(t,v) loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy lifecycle_tenant_read on public.%I for select to authenticated using (company_id=private.get_current_user_company_id() and private.get_current_user_dealer_id() is null and private.lifecycle_read_allowed(private.get_current_user_role(),%L))',t,v);
  end loop;
end $$;
-- Annotations may hold personal assessments; they are projected only through the authorized detail command.
alter table public.journey_annotations enable row level security;
revoke all on public.journey_annotations from public,anon,authenticated;
alter table public.lifecycle_requests enable row level security;
alter table public.lifecycle_events enable row level security;
revoke all on public.lifecycle_requests,public.lifecycle_events from public,anon,authenticated;
grant select on public.lifecycle_requests to authenticated;
create policy lifecycle_request_owner on public.lifecycle_requests for select to authenticated using (
  company_id=private.get_current_user_company_id() and actor_id=auth.uid() and private.get_current_user_dealer_id() is null
  and private.lifecycle_read_allowed(private.get_current_user_role(),private.lifecycle_view(mutation->>'action'))
);
create policy lifecycle_events_no_direct_read on public.lifecycle_events for select to authenticated using(false);

create function private.lifecycle_record(p_company uuid,p_view text,p_entity uuid,p_action text,p_actor uuid,p_note text,p_facts jsonb) returns void
language sql security definer set search_path=public,private as $$
  insert into public.lifecycle_events(company_id,view_name,entity_id,action,actor_id,actor_name,note,facts)
  values(p_company,p_view,p_entity,p_action,p_actor,coalesce((select nullif(full_name,'') from public.app_users where id=p_actor and company_id=p_company),'System'),p_note,coalesce(p_facts,'{}'::jsonb))
$$;
revoke all on function private.lifecycle_record(uuid,text,uuid,text,uuid,text,jsonb) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-058: closure readiness. Each unresolved item names its owner and source; a carried item is
-- documented, never hidden. Operational closure keeps receivables open in accounts.
------------------------------------------------------------------------------------------------
create function private.closure_readiness(p_company uuid,p_order uuid,p_kind text) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_items jsonb:='[]'::jsonb; v_ordered numeric; v_lines integer; v_unknown integer; v_dispatched numeric; v_short public.order_delivery_short_closures; v_outstanding numeric:=0; v_order public.orders;
begin
  select * into v_order from public.orders where id=p_order and company_id=p_company;
  if v_order.id is null then return null; end if;
  select count(*),count(*) filter(where coalesce(quantity_kg,0)<=0),coalesce(sum(quantity_kg),0) into v_lines,v_unknown,v_ordered from public.order_items where company_id=p_company and order_id=p_order;
  select coalesce(sum(round(coalesce(p.net_weight_kg,p.gross_weight_kg-p.tare_weight_kg),3)),0) into v_dispatched from public.packing_list_items p
    join public.dispatches d on d.id=p.dispatch_id and d.company_id=p.company_id
    where p.company_id=p_company and d.order_id=p_order and d.actual_dispatched_at is not null and d.delivery_status<>'returned';
  select * into v_short from public.order_delivery_short_closures where company_id=p_company and order_id=p_order order by closed_at desc limit 1;
  if v_lines=0 or v_unknown>0 then
    v_items:=v_items||jsonb_build_array(jsonb_build_object('key','quantity:'||p_order,'domain','sales','label','Ordered quantity is not recorded in kg','owner','sales_manager',
      'href','/orders/'||p_order,'detail','Every order line needs a kg quantity before fulfilment can be reconciled.','blocking',true,'carriable',false));
  elsif v_ordered-v_dispatched>0.0005 then
    v_items:=v_items||jsonb_build_array(jsonb_build_object('key','quantity:'||p_order,'domain','dispatch','label',
      case when v_short.id is null then 'Ordered quantity not yet dispatched' else 'Remaining quantity short-closed' end,'owner','dispatch_manager','href','/orders/'||p_order,
      'detail',case when v_short.id is null then concat(trim_scale(round(v_ordered-v_dispatched,3)),' kg of ',trim_scale(v_ordered),' kg has not left the factory. Dispatch it or short-close the delivery with a reason.')
        else concat(trim_scale(round(v_ordered-v_dispatched,3)),' kg remains short-closed: ',v_short.reason) end,
      'quantity_kg',round(v_ordered-v_dispatched,3),'blocking',v_short.id is null,'carriable',false,'resolved',v_short.id is not null));
  end if;
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','job:'||j.id,'domain','production','label','Production job '||coalesce(j.job_number,'')||' is '||replace(j.status,'_',' '),
      'owner','production_manager','href','/production/'||j.id,'detail',concat(trim_scale(greatest(j.planned_quantity_kg-j.actual_quantity_kg,0)),' kg planned output not yet produced. Complete or cancel the job.'),
      'blocking',true,'carriable',false) order by j.job_number,j.id)
    from public.production_jobs j where j.company_id=p_company and j.order_id=p_order and j.status in ('planned','ready','in_progress','on_hold')),'[]'::jsonb);
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','finishing:'||f.id,'domain','finishing','label',
      case when f.status='planned' then 'Finishing planned but not sent' else 'Material at finishing vendor' end,'owner','factory_manager','href','/production/finishing/'||f.id,
      'detail',concat(replace(f.finishing_type,'_',' '),' · ',trim_scale(f.input_weight_kg),' kg sent, ',trim_scale(f.output_weight_kg),' kg received. Receive, reject or cancel it.'),
      'blocking',true,'carriable',false) order by f.id)
    from public.finishing_jobs f where f.company_id=p_company and f.order_id=p_order and f.status in ('planned','sent_to_vendor','in_process')),'[]'::jsonb);
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','reservation:'||r.id,'domain','inventory','label','Stock still reserved for this order','owner','inventory_manager',
      'href','/inventory','detail',concat(trim_scale(r.reserved_weight_kg),' kg reserved and not shipped. Release the unused reservation.'),'blocking',true,'carriable',false) order by r.id)
    from public.profile_stock_reservations r where r.company_id=p_company and r.order_id=p_order and r.status='active'),'[]'::jsonb);
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','bundle:'||b.id,'domain','dispatch','label','Packed bundle '||b.bundle_number||' not dispatched','owner','dispatch_manager',
      'href','/dispatches','detail',concat(trim_scale(b.gross_weight_kg-b.tare_weight_kg),' kg net is packed for this order. Dispatch it or return it to stock.'),'blocking',true,'carriable',false) order by b.bundle_number)
    from public.prepared_physical_bundles b where b.company_id=p_company and b.order_id=p_order and b.dispatch_id is null),'[]'::jsonb);
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','dispatch:'||d.id,'domain','dispatch','label','Dispatch '||coalesce(d.dispatch_number,'')||
        case when d.actual_dispatched_at is null then ' has not departed' else ' is not confirmed delivered' end,'owner','dispatch_manager','href','/dispatches/'||d.id,
      'detail','Delivery status: '||replace(d.delivery_status,'_',' ')||'. Record departure and delivery evidence.','blocking',true,'carriable',false) order by d.dispatch_date,d.id)
    from public.dispatches d where d.company_id=p_company and d.order_id=p_order and (d.actual_dispatched_at is null or d.delivery_status in ('pending','dispatched','in_transit','delayed'))),'[]'::jsonb);
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','unbilled:'||d.id,'domain','billing','label','Dispatch '||coalesce(d.dispatch_number,'')||' is not invoiced','owner','accounts',
      'href','/financials','detail','A departed dispatch has no issued invoice. Invoice it before closing.','blocking',true,'carriable',false) order by d.dispatch_date,d.id)
    from public.dispatches d where d.company_id=p_company and d.order_id=p_order and d.actual_dispatched_at is not null and d.delivery_status<>'returned'
      and not exists(select 1 from public.invoices i where i.company_id=p_company and i.dispatch_id=d.id and i.deleted_at is null and i.status not in ('cancelled','draft'))),'[]'::jsonb);
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','invoice:'||i.id,'domain','billing','label','Invoice '||coalesce(i.invoice_number,'draft')||' is still a draft','owner','accounts',
      'href','/financials','detail','Issue or cancel the draft invoice.','blocking',true,'carriable',false) order by i.id)
    from public.invoices i where i.company_id=p_company and i.order_id=p_order and i.deleted_at is null and i.status='draft'),'[]'::jsonb);
  select coalesce(sum(greatest(coalesce(i.balance_due,i.grand_total-i.amount_paid-i.credited_amount),0)),0) into v_outstanding from public.invoices i
    where i.company_id=p_company and i.order_id=p_order and i.deleted_at is null and i.status not in ('cancelled','draft');
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','receivable:'||i.id,'domain','billing','label','Invoice '||coalesce(i.invoice_number,'')||' has an outstanding balance','owner','accounts',
      'href','/financials','detail',concat('INR ',trim_scale(round(greatest(coalesce(i.balance_due,i.grand_total-i.amount_paid-i.credited_amount),0),2)),
        case when p_kind='final' then ' must be settled or credited before final closure.' else ' stays open in accounts after operational closure.' end),
      'blocking',p_kind='final','carriable',false) order by i.invoice_date,i.id)
    from public.invoices i where i.company_id=p_company and i.order_id=p_order and i.deleted_at is null and i.status not in ('cancelled','draft')
      and greatest(coalesce(i.balance_due,i.grand_total-i.amount_paid-i.credited_amount),0)>0.005),'[]'::jsonb);
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','exception:'||x.id,'domain','dispatch','label','Unresolved delivery exception ('||replace(x.disposition,'_',' ')||')',
      'owner','dispatch_manager','href','/tasks/assurance/deliveries/'||x.dispatch_id,'detail',concat(trim_scale(x.quantity_kg),' kg reported by ',x.receiver_name,'.'),'blocking',true,'carriable',true) order by x.recorded_at)
    from public.delivery_dispositions x join public.dispatches d on d.id=x.dispatch_id and d.company_id=x.company_id
    where x.company_id=p_company and d.order_id=p_order and x.disposition<>'accepted' and x.reversed_at is null and x.resolution is null),'[]'::jsonb);
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','return:'||a.id,'domain','sales','label','Customer return still authorized','owner','sales_manager',
      'href','/tasks/assurance/returns/'||a.id,'detail',concat(trim_scale(a.expected_kg),' kg authorized for ',replace(a.response,'_',' '),'.'),'blocking',true,'carriable',true) order by a.authorized_at)
    from public.return_authorizations a where a.company_id=p_company and a.order_id=p_order and a.status='authorized'),'[]'::jsonb);
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','receipt:'||c.id,'domain','quality','label','Returned material awaiting inspection','owner','quality',
      'href','/dispatches/'||c.dispatch_id,'detail',concat(trim_scale(c.received_kg),' kg received back. Inspect and dispose it.'),'blocking',true,'carriable',false) order by c.received_at)
    from public.connected_return_receipts c where c.company_id=p_company and c.order_id=p_order and c.status='received'),'[]'::jsonb);
  v_items:=v_items||coalesce((select jsonb_agg(jsonb_build_object('key','change:'||cp.id,'domain','sales','label','Order change proposal still open','owner','sales_manager',
      'href','/tasks/assurance/revisions/'||cp.id,'detail','Status: '||cp.status||'. Complete or abandon it.','blocking',true,'carriable',true) order by cp.proposed_at)
    from public.order_change_proposals cp where cp.company_id=p_company and cp.order_id=p_order and cp.status in ('assessed','approved')),'[]'::jsonb);
  select coalesce(jsonb_agg(case when c.id is not null then i.item||jsonb_build_object('blocking',false,'carried',true,'carry_reason',c.reason) else i.item||jsonb_build_object('carried',false) end order by i.n),'[]'::jsonb)
    into v_items from jsonb_array_elements(v_items) with ordinality i(item,n)
    left join public.order_closure_carries c on c.company_id=p_company and c.order_id=p_order and c.item_key=i.item->>'key' and c.withdrawn_at is null and coalesce((i.item->>'carriable')::boolean,false);
  return jsonb_build_object('items',v_items,'blocking',(select count(*) from jsonb_array_elements(v_items) x where (x->>'blocking')::boolean),
    'ordered_kg',v_ordered,'dispatched_kg',v_dispatched,'outstanding_inr',round(v_outstanding,2),'stage',v_order.current_stage);
end $$;
revoke all on function private.closure_readiness(uuid,uuid,text) from public,anon,authenticated;

-- An order closed through the review accepts no new work until an authorized reopening.
create function private.guard_closed_order_activity() returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  -- Only reservations carry a status here; other tables are guarded on every insert.
  if tg_table_name='profile_stock_reservations' then
    if new.status<>'active' then return new; end if;
  end if;
  if exists(select 1 from public.order_closures c where c.company_id=new.company_id and c.order_id=new.order_id and c.status='closed') then
    raise exception 'This order was closed through the closure review. An owner or admin must reopen it before new work is recorded.' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_closed_order_activity() from public,anon,authenticated;
create trigger zzz_guard_closed_order before insert on public.production_jobs for each row execute function private.guard_closed_order_activity();
create trigger zzz_guard_closed_order before insert on public.dispatches for each row execute function private.guard_closed_order_activity();
create trigger zzz_guard_closed_order before insert on public.finishing_jobs for each row execute function private.guard_closed_order_activity();
create trigger zzz_guard_closed_order before insert on public.prepared_physical_bundles for each row execute function private.guard_closed_order_activity();
create trigger zzz_guard_closed_order before insert or update of status on public.profile_stock_reservations for each row execute function private.guard_closed_order_activity();

------------------------------------------------------------------------------------------------
-- NOV-063: sample state is the latest lifecycle event. An approval stops counting when the bound
-- drawing revision is superseded or withdrawn, or after an explicit invalidation.
------------------------------------------------------------------------------------------------
create function private.sample_state(p_company uuid,p_requirement uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare r public.sample_requirements; e public.sample_events; v_iteration integer; v_state text; v_drawing text; v_decision public.sample_events;
begin
  select * into r from public.sample_requirements where id=p_requirement and company_id=p_company;
  if r.id is null then return null; end if;
  select coalesce(max(iteration),0) into v_iteration from public.sample_events where company_id=p_company and requirement_id=r.id and event='produced';
  select * into e from public.sample_events where company_id=p_company and requirement_id=r.id order by recorded_at desc,id desc limit 1;
  v_state:=coalesce(e.event,'required');
  if v_state in ('approved','conditional') then
    v_decision:=e;
    if r.drawing_revision_id is not null then
      v_drawing:=private.drawing_state(p_company,r.drawing_revision_id);
      if v_drawing in ('superseded','withdrawn') then v_state:='renewal_needed'; end if;
    end if;
  elsif v_state='invalidated' then v_state:='renewal_needed';
  end if;
  return jsonb_build_object('state',v_state,'iteration',v_iteration,'last_event',e.event,'last_at',e.recorded_at,'expected_response',
      (select x.expected_response from public.sample_events x where x.company_id=p_company and x.requirement_id=r.id and x.event='sent' order by x.recorded_at desc,x.id desc limit 1),
    'limit_kg',case when v_state='conditional' then v_decision.limit_kg end,'drawing_state',v_drawing,
    'sample_jobs',(select coalesce(jsonb_agg(distinct x.job_id),'[]'::jsonb) from public.sample_events x where x.company_id=p_company and x.requirement_id=r.id and x.event='produced'),
    'measured',exists(select 1 from public.sample_events x where x.company_id=p_company and x.requirement_id=r.id and x.event='measured' and x.iteration=greatest(v_iteration,1)));
end $$;
revoke all on function private.sample_state(uuid,uuid) from public,anon,authenticated;

-- A gated order line first starts only after its sample is approved (or within a conditional limit),
-- and only on the sampled die. The job that produces the sample itself may run.
create function private.guard_sample_approval() returns trigger language plpgsql security definer set search_path=public,private as $$
declare r public.sample_requirements; v_state jsonb; v_started numeric;
begin
  if new.status<>'in_progress' or new.profile_id is null then return new; end if;
  if tg_op='UPDATE' then if old.status not in ('planned','ready') then return new; end if; end if;
  for r in select * from public.sample_requirements s where s.company_id=new.company_id and s.order_id=new.order_id and s.profile_id=new.profile_id and s.gates_production loop
    v_state:=private.sample_state(new.company_id,r.id);
    continue when v_state->>'state'='withdrawn';
    if v_state->'sample_jobs' @> to_jsonb(new.id) then continue; end if;
    if v_state->>'state' not in ('approved','conditional') then
      raise exception 'Sample approval for this order line is %. Production can start after approval; only the sample job may run now.',replace(v_state->>'state','_',' ') using errcode='23514';
    end if;
    if r.die_id is not null and new.die_id is distinct from r.die_id then
      raise exception 'This job uses a different die from the approved sample. Record a new sample on this die before production.' using errcode='23514';
    end if;
    if v_state->>'state'='conditional' then
      select coalesce(sum(j.planned_quantity_kg),0) into v_started from public.production_jobs j where j.company_id=new.company_id and j.order_id=new.order_id and j.profile_id=new.profile_id
        and j.id<>new.id and j.status in ('in_progress','completed') and not (v_state->'sample_jobs' @> to_jsonb(j.id));
      if v_started+new.planned_quantity_kg>(v_state->>'limit_kg')::numeric+0.0005 then
        raise exception 'The conditional sample approval covers % kg; % kg is already in production.',trim_scale((v_state->>'limit_kg')::numeric),trim_scale(v_started) using errcode='23514';
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.guard_sample_approval() from public,anon,authenticated;
create trigger zzz_guard_sample_approval before insert or update on public.production_jobs for each row execute function private.guard_sample_approval();

------------------------------------------------------------------------------------------------
-- NOV-079: template precedence is order, then project, then customer, then company. Labels are
-- built from an allow-list of business-safe facts; prices and costs are never read.
------------------------------------------------------------------------------------------------
create function private.label_template_for(p_company uuid,p_order uuid) returns public.packing_label_templates language sql stable security definer set search_path=public,private as $$
  select t.* from public.packing_label_templates t join public.orders o on o.id=p_order and o.company_id=p_company
  where t.company_id=p_company and t.status='approved' and (
    (t.scope='order' and t.order_id=o.id)
    or (t.scope='project' and exists(select 1 from public.customer_project_links l join public.customer_projects cp on cp.id=l.project_id and cp.company_id=l.company_id
        where l.company_id=p_company and l.entity_type='order' and l.entity_id=o.id and l.project_id=t.project_id and cp.customer_id=o.customer_id))
    or (t.scope='customer' and t.customer_id=o.customer_id) or t.scope='company')
  order by case t.scope when 'order' then 1 when 'project' then 2 when 'customer' then 3 else 4 end limit 1
$$;
create function private.label_payload(p_company uuid,p_bundle uuid,p_template public.packing_label_templates) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare b public.prepared_physical_bundles; o public.orders; c public.customers; p public.aluminium_profiles; j public.production_jobs; oi public.order_items; v_project text; v_site text;
  v_facts jsonb; v_fields jsonb:='{}'::jsonb; v_missing text[]:='{}'; v_overflow text[]:='{}'; f text; v text;
begin
  -- The planner may evaluate this for bundles without an applicable template.
  if p_template.id is null then return null; end if;
  select * into b from public.prepared_physical_bundles where id=p_bundle and company_id=p_company;
  if b.id is null then return null; end if;
  select * into o from public.orders where id=b.order_id and company_id=p_company;
  select * into c from public.customers where id=o.customer_id and company_id=p_company;
  select * into p from public.aluminium_profiles where id=b.profile_id and company_id=p_company;
  if b.source_kind='production' then select * into j from public.production_jobs where id=b.source_line_id and company_id=p_company; end if;
  if j.source_line_id is not null then select * into oi from public.order_items where id=j.source_line_id and company_id=p_company; end if;
  select cp.name,cp.site_name into v_project,v_site from public.customer_project_links l join public.customer_projects cp on cp.id=l.project_id and cp.company_id=l.company_id
    where l.company_id=p_company and l.entity_type='order' and l.entity_id=o.id order by l.linked_at desc limit 1;
  v_facts:=jsonb_build_object('bundle_number',b.bundle_number,'order_number',o.order_number,'customer',coalesce(nullif(c.company_name,''),c.customer_name),
    'customer_profile_ref',coalesce(nullif(oi.customer_component_code,''),nullif(p.customer_profile_reference,'')),'profile_code',p.profile_code,
    'finish',replace(coalesce(oi.finishing_type,j.finishing_type),'_',' '),'cut_length_mm',trim_scale(coalesce(oi.cut_length,j.cut_length))::text,'pieces',b.number_of_pieces::text,
    'net_kg',trim_scale(round(b.gross_weight_kg-b.tare_weight_kg,3))::text,'gross_kg',trim_scale(b.gross_weight_kg)::text,'drawing_revision',coalesce(oi.drawing_revision,j.drawing_revision),
    'destination',coalesce(nullif(v_site,''),nullif(c.city,'')),'project',v_project,'packed_on',to_char(b.recorded_at at time zone 'Asia/Kolkata','DD Mon YYYY'));
  foreach f in array p_template.label_fields loop
    v:=nullif(btrim(coalesce(v_facts->>f,'')),'');
    if v is null then v_missing:=v_missing||f; else v_fields:=v_fields||jsonb_build_object(f,v); if length(v)>40 then v_overflow:=v_overflow||f; end if; end if;
  end loop;
  return jsonb_build_object('fields',v_fields,'missing',to_jsonb(v_missing),'overflow',to_jsonb(v_overflow),'net_kg',round(b.gross_weight_kg-b.tare_weight_kg,3),'pieces',b.number_of_pieces);
end $$;
revoke all on function private.label_template_for(uuid,uuid),private.label_payload(uuid,uuid,public.packing_label_templates) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-021: deterministic forward check of proposed delivery tranches. Free press capacity is shift
-- capacity after existing slots and unavailability; accepted promises of other orders claim their
-- unscheduled need first. Unknown lead time or quantity gives an incomplete proposal.
------------------------------------------------------------------------------------------------
create function private.promise_order_need(p_company uuid,p_order uuid) returns jsonb language sql stable security definer set search_path=public,private as $$
  with q as (
    select (select count(*) from public.order_items i where i.company_id=p_company and i.order_id=p_order) lines,
      (select count(*) from public.order_items i where i.company_id=p_company and i.order_id=p_order and coalesce(i.quantity_kg,0)<=0) unknown,
      (select coalesce(sum(i.quantity_kg),0) from public.order_items i where i.company_id=p_company and i.order_id=p_order) ordered,
      (select coalesce(sum(round(coalesce(p.net_weight_kg,p.gross_weight_kg-p.tare_weight_kg),3)),0) from public.packing_list_items p join public.dispatches d on d.id=p.dispatch_id and d.company_id=p.company_id
        where p.company_id=p_company and d.order_id=p_order and d.actual_dispatched_at is not null and d.delivery_status<>'returned') dispatched,
      (select coalesce(sum(b.gross_weight_kg-b.tare_weight_kg),0) from public.prepared_physical_bundles b where b.company_id=p_company and b.order_id=p_order and b.dispatch_id is null) packed,
      (select coalesce(sum(r.reserved_weight_kg),0) from public.profile_stock_reservations r where r.company_id=p_company and r.order_id=p_order and r.status='active') reserved,
      (select coalesce(sum(s.capacity_kg),0) from public.production_plan_slots s join public.production_jobs j on j.id=s.production_job_id and j.company_id=s.company_id
        where s.company_id=p_company and j.order_id=p_order and s.status in ('scheduled','released') and j.status in ('planned','ready','in_progress','on_hold')) scheduled,
      (select coalesce(sum(greatest(j.planned_quantity_kg-j.actual_quantity_kg,0)),0) from public.production_jobs j where j.company_id=p_company and j.order_id=p_order and j.status in ('planned','ready','in_progress','on_hold')) open_jobs
  ) select jsonb_build_object('lines',lines,'unknown',unknown,'ordered_kg',ordered,'dispatched_kg',dispatched,'remaining_kg',greatest(round(ordered-dispatched,3),0),
      'ready_kg',round(packed+reserved,3),'scheduled_kg',round(scheduled,3),'open_job_kg',round(open_jobs,3),
      'unscheduled_kg',greatest(round(ordered-dispatched-packed-reserved-scheduled,3),0)) from q
$$;
create function private.promise_evaluate(p_company uuid,p_order uuid,p_tranches jsonb,p_exclude uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare o public.orders; v_need jsonb; v_today date:=private.ist_today(); v_lead integer:=0; v_missing_lead text[]; v_reasons text[]:='{}'; v_assume text[]:='{}';
  v_checks jsonb:='[]'::jsonb; v_cum numeric:=0; v_total numeric:=0; t jsonb; v_date date; v_kg numeric; v_deadline date; v_free numeric; v_slots numeric; v_claims numeric; v_needed numeric;
  v_verdict text:='feasible'; v_presses integer; v_prev date; v_material boolean; v_suggest date; v_running numeric:=0; v_free_day record; v_claim_count integer;
  v_days date[]; v_kgs numeric[]; v_claim_dates date[]; v_claim_kgs numeric[];
begin
  select * into o from public.orders where id=p_order and company_id=p_company;
  v_need:=private.promise_order_need(p_company,p_order);
  if (v_need->>'lines')::integer=0 or (v_need->>'unknown')::integer>0 then
    return jsonb_build_object('verdict','incomplete','reasons',jsonb_build_array('Every order line needs a kg quantity before a delivery date can be checked.'),'assumptions','[]'::jsonb,'need',v_need,'checks','[]'::jsonb);
  end if;
  select coalesce(max(l.lead_days),0),array_agg(distinct i.finishing_type) filter(where l.id is null) into v_lead,v_missing_lead
    from public.order_items i left join public.factory_finishing_lead_times l on l.company_id=i.company_id and lower(l.finishing_type)=lower(i.finishing_type)
    where i.company_id=p_company and i.order_id=p_order and coalesce(i.finishing_type,'mill_finish') not in ('mill_finish','none','not_required','');
  if coalesce(cardinality(v_missing_lead),0)>0 then
    v_reasons:=v_reasons||('No finishing lead time is configured for '||array_to_string(v_missing_lead,', ')||'. Configure it in production capacity.'); v_verdict:='incomplete';
  end if;
  v_material:=o.billets_short>0 or o.billet_allocation_status in ('pending','partial','shortage');
  if v_material then v_assume:=v_assume||concat('Billet allocation is ',o.billet_allocation_status,' (',o.billets_short,' short). Open purchase supply is tentative until received and accepted.'); end if;
  select count(*) into v_presses from public.machines m where m.company_id=p_company and m.machine_type='extrusion_press' and m.is_active and m.status in ('active','operational','idle')
    and not exists(select 1 from public.order_items i join public.aluminium_profiles pr on pr.id=i.profile_id and pr.company_id=i.company_id where i.company_id=p_company and i.order_id=p_order
      and coalesce(cardinality(pr.compatible_presses),0)>0 and not (coalesce(m.machine_code,'')=any(pr.compatible_presses) or m.machine_name=any(pr.compatible_presses) or m.id::text=any(pr.compatible_presses)))
    and exists(select 1 from public.factory_shift_capacities c where c.company_id=p_company and c.machine_id=m.id);
  -- Daily free capacity on compatible presses for the next 120 days (IST).
  with days as (select (v_today+g)::date as on_day from generate_series(0,120) g),
  presses as (select m.id from public.machines m where m.company_id=p_company and m.machine_type='extrusion_press' and m.is_active and m.status in ('active','operational','idle')
    and not exists(select 1 from public.order_items i join public.aluminium_profiles pr on pr.id=i.profile_id and pr.company_id=i.company_id where i.company_id=p_company and i.order_id=p_order
      and coalesce(cardinality(pr.compatible_presses),0)>0 and not (coalesce(m.machine_code,'')=any(pr.compatible_presses) or m.machine_name=any(pr.compatible_presses) or m.id::text=any(pr.compatible_presses)))),
  windows as (select d.on_day,c.machine_id,c.capacity_kg,(d.on_day+c.starts_local) at time zone 'Asia/Kolkata' ws,
      ((case when c.ends_local<=c.starts_local then d.on_day+1 else d.on_day end)+c.ends_local) at time zone 'Asia/Kolkata' we
    from days d join public.factory_shift_capacities c on c.company_id=p_company and c.weekday=extract(isodow from d.on_day) join presses p on p.id=c.machine_id)
  , free as (select w.on_day,sum(greatest(w.capacity_kg-coalesce((select sum(coalesce(s.capacity_kg,0)) from public.production_plan_slots s where s.company_id=p_company and s.machine_id=w.machine_id
      and s.status in ('scheduled','released') and s.planned_start_at>=w.ws and s.planned_start_at<w.we),0),0)) kg
    from windows w where w.we>now() and not exists(select 1 from private.capacity_windows(p_company) u where u.machine_id=w.machine_id and u.starts_at<w.we and (not u.end_known or u.ends_at>w.ws))
    group by w.on_day)
  select coalesce(array_agg(on_day order by on_day),'{}'),coalesce(array_agg(kg order by on_day),'{}') into v_days,v_kgs from free;
  -- Claims of other accepted promises on unscheduled capacity, by their first promised date.
  select coalesce(array_agg((dp.tranches->0->>'date')::date),'{}'),coalesce(array_agg((private.promise_order_need(p_company,dp.order_id)->>'unscheduled_kg')::numeric),'{}') into v_claim_dates,v_claim_kgs
    from public.delivery_promises dp join public.orders x on x.id=dp.order_id and x.company_id=dp.company_id
    where dp.company_id=p_company and dp.status='accepted' and dp.order_id<>p_order and dp.id is distinct from p_exclude and x.deleted_at is null and x.current_stage not in ('closed','cancelled','delivered','dispatched');
  select count(*) filter(where k>0.0005) into v_claim_count from unnest(v_claim_kgs) k;
  if v_claim_count>0 then v_assume:=v_assume||concat(v_claim_count,' accepted promise(s) of other orders claim unscheduled press capacity first.'); end if;
  if (v_need->>'unscheduled_kg')::numeric>0.0005 and (v_need->>'open_job_kg')::numeric+(v_need->>'scheduled_kg')::numeric<(v_need->>'remaining_kg')::numeric-(v_need->>'ready_kg')::numeric-0.0005 then
    v_assume:=v_assume||'Part of the remaining quantity has no production job yet; it is checked against free press capacity only.'::text; end if;
  v_assume:=v_assume||concat(trim_scale((v_need->>'ready_kg')::numeric),' kg is packed or reserved for this order and counted as ready.');
  v_assume:=v_assume||'Capacity is configured machine-shift kg after existing slots, planned maintenance and open breakdowns. A proposal reserves nothing.'::text;
  for t in select value from jsonb_array_elements(p_tranches) loop
    v_date:=(t->>'date')::date; v_kg:=(t->>'kg')::numeric;
    if v_prev is not null and v_date<=v_prev then raise exception 'NOV: Delivery dates must increase from one part to the next.'; end if;
    if v_date<v_today then raise exception 'NOV: A promised date cannot be in the past.'; end if;
    if v_date>v_today+120 then raise exception 'NOV: Delivery promises are checked up to 120 days ahead.'; end if;
    v_prev:=v_date; v_cum:=v_cum+v_kg;
    v_needed:=greatest(v_cum-(v_need->>'ready_kg')::numeric,0);
    v_deadline:=v_date-v_lead;
    select coalesce(sum(s.capacity_kg),0) into v_slots from public.production_plan_slots s join public.production_jobs j on j.id=s.production_job_id and j.company_id=s.company_id
      where s.company_id=p_company and j.order_id=p_order and s.status in ('scheduled','released') and j.status in ('planned','ready','in_progress','on_hold')
        and coalesce(s.planned_end_at,s.planned_start_at)<((v_deadline+1)::timestamp at time zone 'Asia/Kolkata');
    select coalesce(sum(u.k),0) into v_free from unnest(v_days,v_kgs) u(d,k) where u.d<=v_deadline;
    select coalesce(sum(u.k),0) into v_claims from unnest(v_claim_dates,v_claim_kgs) u(d,k) where u.d<=v_date;
    v_free:=greatest(v_free-v_claims,0);
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('date',v_date,'kg',v_kg,'cumulative_kg',v_cum,'production_needed_kg',v_needed,'production_by',v_deadline,
      'own_slots_kg',v_slots,'free_capacity_kg',round(v_free,3),'claimed_by_others_kg',round(v_claims,3),'ok',v_needed<=v_slots+v_free+0.0005 and v_deadline>=v_today-0));
    if v_needed>0.0005 and v_deadline<v_today then
      v_reasons:=v_reasons||concat('The part due ',to_char(v_date,'DD Mon'),' needs ',trim_scale(v_needed),' kg produced, but finishing lead time (',v_lead,' days) leaves no production time.');
      if v_verdict<>'incomplete' then v_verdict:='infeasible'; end if;
    elsif v_needed>v_slots+v_free+0.0005 then
      v_reasons:=v_reasons||concat('By ',to_char(v_date,'DD Mon'),' ',trim_scale(v_needed),' kg must be produced; scheduled slots and free compatible press capacity cover ',trim_scale(round(v_slots+v_free,3)),' kg.');
      if v_verdict<>'incomplete' then v_verdict:='infeasible'; end if;
    end if;
  end loop;
  v_total:=v_cum;
  if v_total>(v_need->>'remaining_kg')::numeric+0.0005 then raise exception 'NOV: Only % kg remains to deliver on this order.',trim_scale((v_need->>'remaining_kg')::numeric); end if;
  if v_presses=0 and greatest((v_need->>'remaining_kg')::numeric-(v_need->>'ready_kg')::numeric,0)>0.0005 then
    v_reasons:=v_reasons||'No compatible extrusion press has configured shift capacity.'::text; v_verdict:='incomplete'; end if;
  if v_verdict='feasible' and v_material then v_verdict:='at_risk'; v_reasons:=v_reasons||'Material is not confirmed for the full order.'::text; end if;
  -- Earliest date at which free capacity covers the whole remaining production need (explanatory only).
  v_needed:=greatest((v_need->>'remaining_kg')::numeric-(v_need->>'ready_kg')::numeric-(v_need->>'scheduled_kg')::numeric,0);
  select coalesce(sum(k),0) into v_claims from unnest(v_claim_kgs) k;
  v_needed:=v_needed+v_claims;
  if v_needed<=0.0005 then v_suggest:=v_today+v_lead;
  else
    for v_free_day in select u.d as on_day,u.k as kg from unnest(v_days,v_kgs) u(d,k) order by u.d loop
      v_running:=v_running+v_free_day.kg;
      if v_running+0.0005>=v_needed then v_suggest:=v_free_day.on_day+v_lead; exit; end if;
    end loop;
  end if;
  return jsonb_build_object('verdict',v_verdict,'reasons',to_jsonb(v_reasons),'assumptions',to_jsonb(v_assume),'need',v_need,'checks',v_checks,'lead_days',v_lead,
    'material_confirmed',not v_material,'unpromised_kg',round((v_need->>'remaining_kg')::numeric-v_total,3),'earliest_full_date',case when v_verdict='incomplete' then null else v_suggest end);
end $$;
revoke all on function private.promise_order_need(uuid,uuid),private.promise_evaluate(uuid,uuid,jsonb,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-027: one step of traceability from recorded identities only. Edges come from existing
-- source keys and explicit lineage records; nothing is inferred from similar dates or codes.
------------------------------------------------------------------------------------------------
create function private.trace_label(p_company uuid,p_type text,p_id uuid) returns text language sql stable security definer set search_path=public,private as $$
  select coalesce(case p_type
    when 'foundry_batch' then (select 'Cast batch '||batch_number from public.foundry_batches where id=p_id and company_id=p_company)
    when 'outsourced_batch' then (select 'Purchased billet batch '||batch_number from public.outsourced_billet_batches where id=p_id and company_id=p_company)
    when 'receipt_line' then (select 'Receipt line '||l.id::text from public.purchase_receipt_lines l where l.id=p_id and l.company_id=p_company)
    when 'billet_batch' then (select 'Billet batch '||batch_number||' · '||alloy from public.billet_batches where id=p_id and company_id=p_company)
    when 'foundry_billet' then (select 'Billet '||billet_code||' · '||alloy from public.foundry_billets where id=p_id and company_id=p_company)
    when 'production_job' then (select 'Job '||coalesce(job_number,'')||' · '||replace(status,'_',' ') from public.production_jobs where id=p_id and company_id=p_company)
    when 'stock_batch' then (select 'Stock bundle '||coalesce(s.bundle_number,'untagged')||' · '||p.profile_code||' · '||replace(s.status,'_',' ') from public.profile_stock_batches s join public.aluminium_profiles p on p.id=s.profile_id and p.company_id=s.company_id where s.id=p_id and s.company_id=p_company)
    when 'finishing_job' then (select 'Finishing '||replace(finishing_type,'_',' ')||' · '||replace(status,'_',' ') from public.finishing_jobs where id=p_id and company_id=p_company)
    when 'inspection' then (select 'Inspection '||coalesce(batch_number,'')||' · '||replace(status,'_',' ') from public.quality_inspections where id=p_id and company_id=p_company)
    when 'prepared_bundle' then (select 'Packed bundle '||bundle_number from public.prepared_physical_bundles where id=p_id and company_id=p_company)
    when 'packing_item' then (select 'Dispatch bundle '||bundle_number from public.packing_list_items where id=p_id and company_id=p_company)
    when 'dispatch' then (select 'Dispatch '||coalesce(dispatch_number,'')||' · '||replace(delivery_status,'_',' ') from public.dispatches where id=p_id and company_id=p_company)
    when 'return_receipt' then (select 'Return receipt · '||trim_scale(received_kg)||' kg · '||status from public.connected_return_receipts where id=p_id and company_id=p_company)
    when 'customer' then (select 'Customer '||coalesce(nullif(company_name,''),customer_name) from public.customers where id=p_id and company_id=p_company)
  end,'Unavailable record')
$$;
create function private.trace_step(p_company uuid,p_type text,p_id uuid,p_forward boolean) returns table(node_type text,node_id uuid,relation text,kg numeric)
language plpgsql stable security definer set search_path=public,private as $$
begin
  return query select case when p_forward then l.to_type else l.from_type end,case when p_forward then l.to_id else l.from_id end,l.relation,l.quantity_kg
    from public.material_lineage_links l where l.company_id=p_company and ((p_forward and l.from_type=p_type and l.from_id=p_id) or (not p_forward and l.to_type=p_type and l.to_id=p_id));
  if p_forward then
    if p_type='foundry_batch' then return query select 'foundry_billet',b.id,'cast_as',b.weight_kg from public.foundry_billets b where b.company_id=p_company and b.foundry_batch_id=p_id limit 100;
    elsif p_type='outsourced_batch' then return query select 'foundry_billet',b.id,'received_as',b.weight_kg from public.foundry_billets b where b.company_id=p_company and b.outsourced_batch_id=p_id limit 100;
    elsif p_type='receipt_line' then return query select 'billet_batch',r.billet_batch_id,'released_as',r.quantity_kg from public.incoming_stock_releases r where r.company_id=p_company and r.receipt_line_id=p_id;
    elsif p_type='foundry_billet' then return query select 'production_job',x.job,'issued_to',null::numeric from (select b.production_job_id job from public.foundry_billets b where b.id=p_id and b.company_id=p_company and b.production_job_id is not null
        union select i.production_job_id from public.production_billet_issues i where i.company_id=p_company and i.billet_id=p_id) x;
    elsif p_type='production_job' then
      return query select 'stock_batch',s.id,'produced',s.total_weight_kg from public.profile_stock_batches s where s.company_id=p_company and s.production_job_id=p_id;
      return query select 'finishing_job',f.id,'finished',f.input_weight_kg from public.finishing_jobs f where f.company_id=p_company and f.production_job_id=p_id;
      return query select 'inspection',q.id,'inspected',q.quantity_checked_kg from public.quality_inspections q where q.company_id=p_company and q.production_job_id=p_id;
      return query select 'prepared_bundle',b.id,'packed',b.gross_weight_kg-b.tare_weight_kg from public.prepared_physical_bundles b where b.company_id=p_company and b.source_kind='production' and b.source_line_id=p_id;
    elsif p_type='stock_batch' then
      return query select 'prepared_bundle',b.id,'packed',b.gross_weight_kg-b.tare_weight_kg from public.prepared_physical_bundles b join public.profile_stock_reservations r on r.id=b.source_line_id and r.company_id=b.company_id
        where b.company_id=p_company and b.source_kind='reservation' and r.profile_stock_batch_id=p_id;
      return query select 'packing_item',p.id,'shipped',round(coalesce(p.net_weight_kg,p.gross_weight_kg-p.tare_weight_kg),3) from public.packing_list_items p where p.company_id=p_company and p.profile_stock_batch_id=p_id;
    elsif p_type='prepared_bundle' then
      return query select 'packing_item',p.id,'loaded_as',round(coalesce(p.net_weight_kg,p.gross_weight_kg-p.tare_weight_kg),3) from public.prepared_physical_bundles b
        join public.packing_list_items p on p.company_id=b.company_id and p.dispatch_id=b.dispatch_id and upper(btrim(p.bundle_number))=upper(btrim(b.bundle_number))
        where b.id=p_id and b.company_id=p_company and b.dispatch_id is not null;
    elsif p_type='packing_item' then
      return query select 'dispatch',p.dispatch_id,'dispatched_in',null::numeric from public.packing_list_items p where p.id=p_id and p.company_id=p_company;
      return query select 'return_receipt',c.id,'returned',c.received_kg from public.connected_return_receipts c where c.company_id=p_company and c.packing_list_item_id=p_id;
    elsif p_type='dispatch' then
      return query select 'customer',o.customer_id,'delivered_to',null::numeric from public.dispatches d join public.orders o on o.id=d.order_id and o.company_id=d.company_id where d.id=p_id and d.company_id=p_company;
      return query select 'stock_batch',s.id,'returned_to_stock',s.total_weight_kg from public.profile_stock_batches s where s.company_id=p_company and s.source_dispatch_id=p_id;
    end if;
  else
    if p_type='foundry_billet' then
      return query select 'foundry_batch',b.foundry_batch_id,'cast_as',b.weight_kg from public.foundry_billets b where b.id=p_id and b.company_id=p_company and b.foundry_batch_id is not null;
      return query select 'outsourced_batch',b.outsourced_batch_id,'received_as',b.weight_kg from public.foundry_billets b where b.id=p_id and b.company_id=p_company and b.outsourced_batch_id is not null;
    elsif p_type='billet_batch' then return query select 'receipt_line',r.receipt_line_id,'released_as',r.quantity_kg from public.incoming_stock_releases r where r.company_id=p_company and r.billet_batch_id=p_id;
    elsif p_type='production_job' then return query select 'foundry_billet',x.billet,'issued_to',null::numeric from (select b.id billet from public.foundry_billets b where b.company_id=p_company and b.production_job_id=p_id
        union select i.billet_id from public.production_billet_issues i where i.company_id=p_company and i.production_job_id=p_id) x;
    elsif p_type='stock_batch' then
      return query select 'production_job',s.production_job_id,'produced',s.total_weight_kg from public.profile_stock_batches s where s.id=p_id and s.company_id=p_company and s.production_job_id is not null;
      return query select 'dispatch',s.source_dispatch_id,'returned_to_stock',s.total_weight_kg from public.profile_stock_batches s where s.id=p_id and s.company_id=p_company and s.source_dispatch_id is not null;
    elsif p_type in ('finishing_job','inspection') then
      return query select 'production_job',x.job,case when p_type='finishing_job' then 'finished' else 'inspected' end,null::numeric from (
        select f.production_job_id job from public.finishing_jobs f where p_type='finishing_job' and f.id=p_id and f.company_id=p_company
        union all select q.production_job_id from public.quality_inspections q where p_type='inspection' and q.id=p_id and q.company_id=p_company) x where x.job is not null;
    elsif p_type='prepared_bundle' then
      return query select 'production_job',b.source_line_id,'packed',b.gross_weight_kg-b.tare_weight_kg from public.prepared_physical_bundles b where b.id=p_id and b.company_id=p_company and b.source_kind='production';
      return query select 'stock_batch',r.profile_stock_batch_id,'packed',b.gross_weight_kg-b.tare_weight_kg from public.prepared_physical_bundles b join public.profile_stock_reservations r on r.id=b.source_line_id and r.company_id=b.company_id
        where b.id=p_id and b.company_id=p_company and b.source_kind='reservation';
    elsif p_type='packing_item' then
      return query select 'prepared_bundle',b.id,'loaded_as',b.gross_weight_kg-b.tare_weight_kg from public.packing_list_items p
        join public.prepared_physical_bundles b on b.company_id=p.company_id and b.dispatch_id=p.dispatch_id and upper(btrim(b.bundle_number))=upper(btrim(p.bundle_number))
        where p.id=p_id and p.company_id=p_company;
      return query select 'stock_batch',p.profile_stock_batch_id,'shipped',round(coalesce(p.net_weight_kg,p.gross_weight_kg-p.tare_weight_kg),3) from public.packing_list_items p where p.id=p_id and p.company_id=p_company and p.profile_stock_batch_id is not null;
    elsif p_type='dispatch' then return query select 'packing_item',p.id,'dispatched_in',round(coalesce(p.net_weight_kg,p.gross_weight_kg-p.tare_weight_kg),3) from public.packing_list_items p where p.company_id=p_company and p.dispatch_id=p_id limit 100;
    elsif p_type='return_receipt' then return query select 'packing_item',c.packing_list_item_id,'returned',c.received_kg from public.connected_return_receipts c where c.id=p_id and c.company_id=p_company;
    end if;
  end if;
end $$;
-- Bounded breadth-first traversal in both directions with visited-node protection.
create function private.trace_graph(p_company uuid,p_type text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_nodes jsonb:='[]'::jsonb; v_edges jsonb:='[]'::jsonb; v_unknown jsonb:='[]'::jsonb; v_seen text[]; v_frontier jsonb; v_next jsonb; n jsonb; s record; v_key text;
  v_dir boolean; v_depth integer; v_truncated boolean:=false; v_count integer:=1; v_found boolean;
begin
  v_seen:=array[p_type||':'||p_id];
  v_nodes:=jsonb_build_array(jsonb_build_object('key',p_type||':'||p_id,'type',p_type,'id',p_id,'label',private.trace_label(p_company,p_type,p_id),'depth',0,'direction','start'));
  foreach v_dir in array array[false,true] loop
    v_frontier:=jsonb_build_array(jsonb_build_object('type',p_type,'id',p_id)); v_depth:=0;
    while jsonb_array_length(v_frontier)>0 and v_depth<8 loop
      v_depth:=v_depth+1; v_next:='[]'::jsonb;
      for n in select value from jsonb_array_elements(v_frontier) loop
        v_found:=false;
        for s in select * from private.trace_step(p_company,n->>'type',(n->>'id')::uuid,v_dir) where node_id is not null loop
          v_found:=true; v_key:=s.node_type||':'||s.node_id;
          v_edges:=v_edges||jsonb_build_array(jsonb_build_object('from',case when v_dir then n->>'type'||':'||(n->>'id') else v_key end,'to',case when v_dir then v_key else n->>'type'||':'||(n->>'id') end,
            'relation',s.relation,'kg',s.kg));
          if v_key=any(v_seen) then continue; end if;
          if v_count>=200 then v_truncated:=true; continue; end if;
          v_seen:=v_seen||v_key; v_count:=v_count+1;
          v_nodes:=v_nodes||jsonb_build_array(jsonb_build_object('key',v_key,'type',s.node_type,'id',s.node_id,'label',private.trace_label(p_company,s.node_type,s.node_id),'depth',v_depth,'direction',case when v_dir then 'forward' else 'backward' end));
          if s.node_type<>'customer' then v_next:=v_next||jsonb_build_array(jsonb_build_object('type',s.node_type,'id',s.node_id)); end if;
        end loop;
        if not v_dir and not v_found and n->>'type' in ('production_job','packing_item','stock_batch','prepared_bundle','billet_batch') then
          v_unknown:=v_unknown||jsonb_build_array(jsonb_build_object('key',n->>'type'||':'||(n->>'id'),'label',private.trace_label(p_company,n->>'type',(n->>'id')::uuid),
            'note',case n->>'type' when 'production_job' then 'No billet issue is recorded for this job. Its metal source is an unlinked historical source.'
              when 'packing_item' then 'No packed bundle or stock source is recorded for this dispatch bundle.'
              when 'stock_batch' then 'No production job or return is recorded as the source of this stock.'
              when 'billet_batch' then 'No receipt release is recorded for this billet batch.' else 'No source is recorded.' end));
        end if;
      end loop;
      v_frontier:=v_next;
    end loop;
  end loop;
  return jsonb_build_object('nodes',v_nodes,'edges',(select coalesce(jsonb_agg(distinct e),'[]'::jsonb) from jsonb_array_elements(v_edges) e),'unknown',v_unknown,'truncated',v_truncated,'node_count',v_count);
end $$;
revoke all on function private.trace_label(uuid,text,uuid),private.trace_step(uuid,text,uuid,boolean),private.trace_graph(uuid,text,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-060: the recorded journey of an order. Gaps are shown as missing observations; no timestamp
-- is invented.
------------------------------------------------------------------------------------------------
create function private.journey_timeline(p_company uuid,p_order uuid) returns jsonb language sql stable security definer set search_path=public,private as $$
  with ev as (
    select 'quote' kind,'Quotation '||q.quote_number||' recorded' label,q.created_at at_ from public.orders o join public.quotes q on q.id=o.quote_id and q.company_id=o.company_id where o.id=p_order and o.company_id=p_company
    union all select 'order','Order '||o.order_number||' created',o.created_at from public.orders o where o.id=p_order and o.company_id=p_company
    union all select 'stage','Stage changed to '||replace(h.stage,'_',' '),h.changed_at from public.order_stage_history h where h.company_id=p_company and h.order_id=p_order
    union all select 'production','Job '||coalesce(j.job_number,'')||': '||replace(h.previous_status,'_',' ')||' to '||replace(h.new_status,'_',' '),h.created_at
      from public.production_job_status_history h join public.production_jobs j on j.id=h.production_job_id and j.company_id=h.company_id where h.company_id=p_company and j.order_id=p_order
    union all select 'dispatch','Dispatch '||coalesce(d.dispatch_number,'')||' departed',d.actual_dispatched_at from public.dispatches d where d.company_id=p_company and d.order_id=p_order and d.actual_dispatched_at is not null
    union all select 'dispatch','Dispatch '||coalesce(d.dispatch_number,'')||' delivered',d.delivered_at from public.dispatches d where d.company_id=p_company and d.order_id=p_order and d.delivered_at is not null
    union all select 'billing','Invoice '||coalesce(i.invoice_number,'')||' issued',coalesce(i.issued_at,i.created_at) from public.invoices i where i.company_id=p_company and i.order_id=p_order and i.deleted_at is null and i.status<>'draft'
    union all select 'payment','Payment received',p.created_at from public.payments p join public.invoices i on i.id=p.invoice_id and i.company_id=p.company_id
      where p.company_id=p_company and i.order_id=p_order and p.reversed_at is null
  ), ordered as (select kind,label,at_,lag(at_) over(order by at_,label) prev from (select * from ev order by at_ limit 60) x)
  select jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'label',label,'at',at_,'hours_since_previous',case when prev is null then null else round(extract(epoch from at_-prev)/3600.0,1) end) order by at_,label) from ordered),'[]'::jsonb),
    'missing',to_jsonb(array_remove(array[
      case when not exists(select 1 from ev where kind='quote') then 'No quotation is linked; the enquiry stage is not recorded.' end,
      case when not exists(select 1 from ev where kind='production') then 'No production job status change is recorded.' end,
      case when not exists(select 1 from ev where kind='dispatch') then 'No dispatch departure is recorded.' end,
      case when not exists(select 1 from ev where kind='billing') then 'No issued invoice is recorded.' end,
      case when not exists(select 1 from ev where kind='payment') then 'No payment receipt is recorded.' end],null)))
$$;
revoke all on function private.journey_timeline(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Read models for every view in this batch.
------------------------------------------------------------------------------------------------
create function private.lifecycle_rows(p_company uuid,p_actor uuid,p_role text,p_view text,p_state text,p_id uuid default null)
returns table(row_data jsonb,sort_rank integer,sort_due date,sort_new timestamptz) language plpgsql stable security definer set search_path=public,private as $$
declare v_today date:=private.ist_today(); v_private boolean:=p_role in ('owner','admin','factory_manager');
begin
  if p_view='closure' then
    return query select jsonb_build_object('id',o.id,'label',o.order_number||' · '||coalesce(nullif(c.company_name,''),c.customer_name),'status',st.status,'owner',null,
        'due_date',o.expected_dispatch_date,'summary',case st.status when 'blocked' then concat((rd->>'blocking'),' open item(s) before closure')
          when 'ready' then case when (rd->>'outstanding_inr')::numeric>0 then concat('Ready for operational closure; INR ',rd->>'outstanding_inr',' stays open in accounts') else 'Ready to close' end
          when 'closed_operational' then 'Closed operationally; receivables continue in accounts' else 'Closed after final commercial review' end,
        'source_href','/orders/'||o.id,'details',jsonb_build_object('order_id',o.id,'order_number',o.order_number,'customer',coalesce(nullif(c.company_name,''),c.customer_name),
          'current_stage',o.current_stage,'ordered_kg',rd->'ordered_kg','dispatched_kg',rd->'dispatched_kg','outstanding_inr',rd->'outstanding_inr','blocking_count',rd->'blocking',
          'items',rd->'items','closure_kind',cl.kind,'closed_at',cl.closed_at,'closed_by',cu.full_name,'close_note',cl.close_note,'previous_stage',cl.previous_stage,
          'history',(select coalesce(jsonb_agg(jsonb_build_object('kind',h.kind,'status',h.status,'closed_at',h.closed_at,'reopened_at',h.reopened_at,'reopen_note',h.reopen_note) order by h.closed_at desc),'[]'::jsonb)
            from (select * from public.order_closures x where x.company_id=p_company and x.order_id=o.id order by x.closed_at desc limit 10) h))),
      case st.status when 'ready' then 0 when 'blocked' then 1 else 5 end,o.expected_dispatch_date,o.updated_at
    from public.orders o join public.customers c on c.id=o.customer_id and c.company_id=o.company_id
    left join public.order_closures cl on cl.company_id=o.company_id and cl.order_id=o.id and cl.status='closed' left join public.app_users cu on cu.id=cl.closed_by
    cross join lateral (select case when cl.id is not null then jsonb_build_object('items',cl.readiness,'blocking',0,'ordered_kg',null,'dispatched_kg',null,'outstanding_inr',null)
      else private.closure_readiness(p_company,o.id,'operational') end rd) r(rd)
    cross join lateral (select case when cl.id is not null then 'closed_'||cl.kind when (r.rd->>'blocking')::integer=0 then 'ready' else 'blocked' end status) st
    where o.company_id=p_company and o.deleted_at is null and (p_id is null or o.id=p_id)
      and (p_id is not null or (cl.id is null and o.current_stage in ('dispatched','delivered','payment_pending'))
        or (p_state='all' and (cl.id is not null or exists(select 1 from public.order_closures z where z.company_id=p_company and z.order_id=o.id))));

  elsif p_view='samples' then
    return query select jsonb_build_object('id',r.id,'label',concat(o.order_number,' · ',p.profile_code,' · sample ',greatest((ss->>'iteration')::integer,1)),'status',x.status,
        'owner',ru.full_name,'due_date',(ss->>'expected_response')::date,
        'summary',concat(case x.status when 'required' then 'Sample not yet produced' when 'produced' then 'Produced; measurements pending' when 'measured' then 'Measured; not yet sent'
          when 'sent' then 'With the '||r.authority||' for decision' when 'response_overdue' then 'Response overdue from the '||r.authority when 'approved' then 'Approved'
          when 'conditional' then 'Conditionally approved up to '||trim_scale((ss->>'limit_kg')::numeric)||' kg' when 'rejected' then 'Rejected; a new sample is needed'
          when 'clarification' then 'Clarification requested' when 'lost' then 'Sample lost; produce or send again' when 'renewal_needed' then 'Approval no longer valid; renew the sample'
          else 'Withdrawn' end,case when r.gates_production and blk.n>0 and x.status not in ('approved','withdrawn') then concat('; ',blk.n,' job(s) waiting') else '' end),
        'source_href','/orders/'||o.id,'details',jsonb_build_object('order_id',o.id,'order_number',o.order_number,'customer',coalesce(nullif(c.company_name,''),c.customer_name),
          'profile_code',p.profile_code,'die_number',d.die_number,'drawing_revision',dr.revision_label,'drawing_state',ss->>'drawing_state','reason',r.reason,'quantity_pieces',r.quantity_pieces,
          'authority',r.authority,'gates_production',r.gates_production,'response_days',r.response_days,'iteration',(ss->>'iteration')::integer,'measured',(ss->>'measured')::boolean,
          'limit_kg',ss->'limit_kg','waiting_jobs',blk.n,'requested_at',r.requested_at,
          'events',(select coalesce(jsonb_agg(jsonb_build_object('event',e.event,'iteration',e.iteration,'job_number',j.job_number,'sample_tag',e.sample_tag,'location',e.location,
              'recipient',e.recipient,'expected_response',e.expected_response,'customer_contact',e.customer_contact,'limit_kg',e.limit_kg,'evidence',e.evidence,'by',coalesce(eu.full_name,'System'),
              'role',e.recorded_role,'at',e.recorded_at) order by e.recorded_at desc,e.id desc),'[]'::jsonb)
            from (select * from public.sample_events y where y.company_id=p_company and y.requirement_id=r.id order by y.recorded_at desc,y.id desc limit 20) e
            left join public.production_jobs j on j.id=e.job_id left join public.app_users eu on eu.id=e.recorded_by))),
      case x.status when 'response_overdue' then 0 when 'renewal_needed' then 0 when 'rejected' then 1 when 'lost' then 1 when 'clarification' then 1 when 'required' then 2 when 'sent' then 3 when 'approved' then 6 when 'withdrawn' then 7 else 2 end,
      (ss->>'expected_response')::date,r.requested_at
    from public.sample_requirements r join public.orders o on o.id=r.order_id and o.company_id=r.company_id join public.customers c on c.id=r.customer_id and c.company_id=r.company_id
    join public.aluminium_profiles p on p.id=r.profile_id and p.company_id=r.company_id left join public.dies d on d.id=r.die_id and d.company_id=r.company_id
    left join public.drawing_revisions dr on dr.id=r.drawing_revision_id and dr.company_id=r.company_id left join public.app_users ru on ru.id=r.requested_by
    cross join lateral (select private.sample_state(p_company,r.id) ss) s(ss)
    cross join lateral (select case when s.ss->>'state'='sent' and (s.ss->>'expected_response')::date<v_today then 'response_overdue' else s.ss->>'state' end status) x
    cross join lateral (select count(*) n from public.production_jobs j where j.company_id=p_company and j.order_id=r.order_id and j.profile_id=r.profile_id and j.status in ('planned','ready')
      and not ((s.ss->'sample_jobs') @> to_jsonb(j.id))) blk
    where r.company_id=p_company and (p_id is null or r.id=p_id) and (p_state='all' or p_id is not null or x.status not in ('approved','withdrawn'));

  elsif p_view='templates' then
    return query select jsonb_build_object('id',t.id,'label',concat(initcap(t.scope),' template',case t.scope when 'company' then '' else ' · '||coalesce(o.order_number,cp.name,coalesce(nullif(c.company_name,''),c.customer_name)) end,' · rev ',t.revision),
        'status',t.status,'owner',au.full_name,'due_date',null,'summary',case t.status when 'draft' then 'Awaiting approval by a second person' when 'approved' then 'Approved; applies to new labels' else 'Superseded by a later revision' end,
        'source_href',null,'details',jsonb_build_object('scope',t.scope,'target',coalesce(o.order_number,cp.name,coalesce(nullif(c.company_name,''),c.customer_name),'All customers'),'revision',t.revision,
          'instructions',t.instructions,'max_bundle_kg',t.max_bundle_kg,'max_pieces',t.max_pieces,'spacer_required',t.spacer_required,'wrapping',t.wrapping,'label_fields',to_jsonb(t.label_fields),
          'created_by',au.full_name,'created_at',t.created_at,'approved_by',ap.full_name,'approved_at',t.approved_at,'created_by_id',t.created_by)),
      case t.status when 'draft' then 0 when 'approved' then 3 else 6 end,null::date,t.created_at
    from public.packing_label_templates t left join public.customers c on c.id=t.customer_id and c.company_id=t.company_id left join public.customer_projects cp on cp.id=t.project_id and cp.company_id=t.company_id
    left join public.orders o on o.id=t.order_id and o.company_id=t.company_id left join public.app_users au on au.id=t.created_by left join public.app_users ap on ap.id=t.approved_by
    where t.company_id=p_company and (p_id is null or t.id=p_id) and (p_state='all' or p_id is not null or t.status<>'superseded');

  elsif p_view='labels' then
    return query select jsonb_build_object('id',b.id,'label',concat('Bundle ',b.bundle_number,' · ',o.order_number,' · ',pr.profile_code),'status',x.status,'owner',null,'due_date',null,
        'summary',case x.status when 'no_template' then 'No approved packing template applies to this order' when 'fields_missing' then 'The template needs facts not recorded: '||(select string_agg(replace(m,'_',' '),', ') from jsonb_array_elements_text(pay->'missing') m)
          when 'label_overflow' then 'A label value is too long to print' when 'to_label' then 'Packing check and label pending' when 'relabel_needed' then 'Label printed on an older template revision; reprint it'
          else concat('Labelled (print ',lp.print_number,')') end,
        'source_href','/dispatches','details',jsonb_build_object('bundle_number',b.bundle_number,'order_number',o.order_number,'profile_code',pr.profile_code,'pieces',b.number_of_pieces,
          'net_kg',round(b.gross_weight_kg-b.tare_weight_kg,3),'gross_kg',b.gross_weight_kg,'dispatched',b.dispatch_id is not null,'packed_at',b.recorded_at,
          'template_id',tp.id,'template_scope',tp.scope,'template_revision',tp.revision,'instructions',tp.instructions,'max_bundle_kg',tp.max_bundle_kg,'max_pieces',tp.max_pieces,
          'spacer_required',tp.spacer_required,'wrapping',tp.wrapping,'preview',pay->'fields','missing',pay->'missing','overflow',pay->'overflow',
          'active_print',case when lp.id is null then null else jsonb_build_object('id',lp.id,'print_number',lp.print_number,'reason',lp.reason,'template_revision',lp.template_revision,'payload',lp.payload,
            'observations',lp.observations,'deviation',lp.deviation,'printed_at',lp.printed_at) end,
          'prints',(select coalesce(jsonb_agg(jsonb_build_object('print_number',z.print_number,'reason',z.reason,'status',z.status,'template_revision',z.template_revision,'by',coalesce(zu.full_name,'System'),'at',z.printed_at) order by z.print_number desc),'[]'::jsonb)
            from (select * from public.packing_label_prints y where y.company_id=p_company and y.bundle_id=b.id order by y.print_number desc limit 20) z left join public.app_users zu on zu.id=z.printed_by))),
      case x.status when 'relabel_needed' then 0 when 'to_label' then 1 when 'fields_missing' then 1 when 'label_overflow' then 1 when 'no_template' then 2 else 6 end,null::date,b.recorded_at
    from public.prepared_physical_bundles b join public.orders o on o.id=b.order_id and o.company_id=b.company_id join public.aluminium_profiles pr on pr.id=b.profile_id and pr.company_id=b.company_id
    left join lateral private.label_template_for(p_company,b.order_id) tp on true
    left join lateral (select private.label_payload(p_company,b.id,tp) pay where tp.id is not null) pl on true
    left join public.packing_label_prints lp on lp.company_id=b.company_id and lp.bundle_id=b.id and lp.status='active'
    cross join lateral (select case when lp.id is not null and (tp.id is null or lp.template_id<>tp.id) then 'relabel_needed' when lp.id is not null then 'labelled' when tp.id is null then 'no_template'
      when jsonb_array_length(pl.pay->'missing')>0 then 'fields_missing' when jsonb_array_length(pl.pay->'overflow')>0 then 'label_overflow' else 'to_label' end status) x
    where b.company_id=p_company and (p_id is null or b.id=p_id)
      and (p_id is not null or (p_state='all' and b.recorded_at>now()-interval '120 days') or (b.dispatch_id is null and x.status<>'labelled'));

  elsif p_view='promises' then
    return query select jsonb_build_object('id',dp.id,'label',concat(o.order_number,' · ',jsonb_array_length(dp.tranches),' delivery part(s) · last ',to_char((dp.tranches->-1->>'date')::date,'DD Mon YYYY')),
        'status',x.status,'owner',pu.full_name,'due_date',(dp.tranches->0->>'date')::date,
        'summary',case x.status when 'proposed' then concat('Proposed: ',replace(dp.verdict,'_',' '),'; expires ',to_char(dp.expires_at at time zone 'Asia/Kolkata','DD Mon HH24:MI'))
          when 'expired' then 'Proposal expired before acceptance' when 'accepted' then 'Accepted customer promise; current check '||replace(coalesce(ev->>'verdict',dp.verdict),'_',' ')
          when 'promise_at_risk' then 'Accepted promise is no longer feasible on current capacity' when 'withdrawn' then 'Withdrawn' else 'Superseded by a later accepted promise' end,
        'source_href','/orders/'||o.id,'details',jsonb_build_object('order_id',o.id,'order_number',o.order_number,'customer',coalesce(nullif(c.company_name,''),c.customer_name),'tranches',dp.tranches,
          'verdict',dp.verdict,'evaluation',dp.evaluation,'current',ev,'expires_at',dp.expires_at,'proposed_by',pu.full_name,'proposed_at',dp.proposed_at,'accepted_by',au.full_name,'accepted_at',dp.accepted_at,
          'previous_expected_date',dp.previous_expected_date,'order_expected_date',o.expected_dispatch_date,'closed_note',dp.closed_note)),
      case x.status when 'promise_at_risk' then 0 when 'proposed' then 1 when 'accepted' then 3 else 6 end,(dp.tranches->0->>'date')::date,dp.proposed_at
    from public.delivery_promises dp join public.orders o on o.id=dp.order_id and o.company_id=dp.company_id join public.customers c on c.id=o.customer_id and c.company_id=o.company_id
    left join public.app_users pu on pu.id=dp.proposed_by left join public.app_users au on au.id=dp.accepted_by
    cross join lateral (select case when dp.status='accepted' and o.current_stage not in ('closed','cancelled','delivered','dispatched') and (p_id is not null or p_state='active')
      then private.promise_evaluate(p_company,dp.order_id,(select coalesce(jsonb_agg(t) filter(where (t->>'date')::date>=v_today),'[]'::jsonb) from jsonb_array_elements(dp.tranches) t),dp.id) end ev) e
    cross join lateral (select case when dp.status='proposed' and dp.expires_at<=now() then 'expired' when dp.status='accepted' and e.ev->>'verdict'='infeasible' then 'promise_at_risk' else dp.status end status) x
    where dp.company_id=p_company and (p_id is null or dp.id=p_id)
      and (p_state='all' or p_id is not null or x.status in ('proposed','promise_at_risk') or (x.status='accepted' and o.current_stage not in ('closed','cancelled','delivered','dispatched')));

  elsif p_view='trace' then
    return query select jsonb_build_object('id',ti.id,'label','Investigation from '||ti.start_label,'status',ti.status,'owner',ou.full_name,'due_date',null,
        'summary',concat(jsonb_array_length(ti.snapshot->'nodes'),' linked record(s); ',jsonb_array_length(ti.snapshot->'unknown'),' unlinked source(s); ',
          (select count(*) from public.trace_holds h where h.company_id=p_company and h.investigation_id=ti.id),' stock bundle(s) on hold'),
        'source_href',null,'details',jsonb_build_object('start_type',ti.start_type,'start_id',ti.start_id,'reason',ti.reason,'opened_by',ou.full_name,'opened_at',ti.opened_at,'conclusion',ti.conclusion,'closed_at',ti.closed_at,
          'snapshot',ti.snapshot,'current',case when p_id is not null then private.trace_graph(p_company,ti.start_type,ti.start_id) end,
          'holds',(select coalesce(jsonb_agg(jsonb_build_object('stock_batch_id',h.stock_batch_id,'label',private.trace_label(p_company,'stock_batch',h.stock_batch_id),'previous_qc_status',h.previous_qc_status,
              'current_qc_status',s.qc_status,'held_at',h.held_at) order by h.held_at),'[]'::jsonb) from public.trace_holds h join public.profile_stock_batches s on s.id=h.stock_batch_id
            where h.company_id=p_company and h.investigation_id=ti.id))),
      case ti.status when 'open' then 0 else 6 end,null::date,ti.opened_at
    from public.trace_investigations ti left join public.app_users ou on ou.id=ti.opened_by
    where ti.company_id=p_company and (p_id is null or ti.id=p_id) and (p_state='all' or p_id is not null or ti.status='open');

  elsif p_view='bundles' then
    return query select jsonb_build_object('id',bt.id,'label',concat(case bt.kind when 'split' then 'Split of ' else 'Combination into ' end,
          (select string_agg(coalesce(l.bundle_number,'untagged'),', ' order by l.bundle_number) from public.bundle_transformation_lines l where l.company_id=p_company and l.transformation_id=bt.id
            and l.direction=case bt.kind when 'split' then 'input' else 'output' end)),
        'status',bt.status,'owner',ru.full_name,'due_date',null,'summary',concat(trim_scale(bt.input_kg),' kg in, ',trim_scale(bt.output_kg),' kg out',
          case when bt.variance_kg<>0 then concat(' (variance ',trim_scale(bt.variance_kg),' kg: ',bt.variance_reason,')') else '' end),
        'source_href','/inventory','details',jsonb_build_object('kind',bt.kind,'input_kg',bt.input_kg,'output_kg',bt.output_kg,'variance_kg',bt.variance_kg,'variance_reason',bt.variance_reason,
          'recorded_by',ru.full_name,'recorded_at',bt.recorded_at,'reversed_at',bt.reversed_at,'reverse_note',bt.reverse_note,
          'lines',(select coalesce(jsonb_agg(jsonb_build_object('direction',l.direction,'stock_batch_id',l.stock_batch_id,'bundle_number',l.bundle_number,'pieces',l.pieces,'kg',l.kg,
              'current_status',s.status,'current_pieces',s.quantity_pieces,'current_kg',s.total_weight_kg,'qc_status',s.qc_status) order by l.direction,l.bundle_number),'[]'::jsonb)
            from public.bundle_transformation_lines l join public.profile_stock_batches s on s.id=l.stock_batch_id and s.company_id=l.company_id where l.company_id=p_company and l.transformation_id=bt.id))),
      case bt.status when 'completed' then 3 else 6 end,null::date,bt.recorded_at
    from public.bundle_transformations bt left join public.app_users ru on ru.id=bt.recorded_by
    where bt.company_id=p_company and (p_id is null or bt.id=p_id) and (p_state='all' or p_id is not null or (bt.status='completed' and bt.recorded_at>now()-interval '30 days'));

  elsif p_view='journeys' then
    return query select jsonb_build_object('id',jr.id,'label',jr.title||' · '||o.order_number,'status',x.status,'owner',ou.full_name,'due_date',jr.baseline_to,
        'summary',case x.status when 'scoping' then 'No observations recorded yet' when 'actions_open' then concat(act.open_n,' improvement action(s) open or in trial')
          when 'awaiting_trial_measure' then 'Actions done; record a trial measure to compare with the baseline' when 'reviewing' then concat(ann.n,' observation(s) recorded') else 'Closed' end,
        'source_href','/orders/'||o.id,'details',jsonb_build_object('order_id',o.id,'order_number',o.order_number,'participants',jr.participants,'baseline_from',jr.baseline_from,'baseline_to',jr.baseline_to,
          'owner_id',jr.owner_id,'closed_note',jr.closed_note,'timeline',case when p_id is not null then private.journey_timeline(p_company,o.id) end,
          'annotations',(select coalesce(jsonb_agg(jsonb_build_object('kind',a.kind,'minutes',a.minutes,'private',a.private,'observation',a.observation,'by',coalesce(au.full_name,'Employee'),'at',a.recorded_at) order by a.recorded_at),'[]'::jsonb)
            from public.journey_annotations a left join public.app_users au on au.id=a.recorded_by where a.company_id=p_company and a.review_id=jr.id and p_id is not null
              and (not a.private or v_private or jr.owner_id=p_actor or a.recorded_by=p_actor)),
          'time_by_kind',(select coalesce(jsonb_object_agg(k.kind,k.minutes),'{}'::jsonb) from (select a.kind,sum(a.minutes) minutes from public.journey_annotations a where a.company_id=p_company and a.review_id=jr.id and a.minutes is not null group by a.kind) k),
          'actions',(select coalesce(jsonb_agg(jsonb_build_object('id',ja.id,'finding',ja.finding,'owner',jo.full_name,'owner_id',ja.owner_id,'due_date',ja.due_date,'status',ja.status) order by ja.due_date,ja.id),'[]'::jsonb)
            from public.journey_actions ja left join public.app_users jo on jo.id=ja.owner_id where ja.company_id=p_company and ja.review_id=jr.id),
          'measures',(select coalesce(jsonb_agg(jsonb_build_object('phase',m.phase,'metric',m.metric,'value',m.value,'unit',m.unit,'sample_size',m.sample_size,'limitations',m.limitations,'at',m.recorded_at) order by m.metric,m.phase),'[]'::jsonb)
            from public.journey_measures m where m.company_id=p_company and m.review_id=jr.id))),
      case x.status when 'actions_open' then 1 when 'awaiting_trial_measure' then 0 when 'scoping' then 2 when 'reviewing' then 2 else 6 end,jr.baseline_to,jr.opened_at
    from public.journey_reviews jr join public.orders o on o.id=jr.order_id and o.company_id=jr.company_id left join public.app_users ou on ou.id=jr.owner_id
    cross join lateral (select count(*) n from public.journey_annotations a where a.company_id=p_company and a.review_id=jr.id) ann
    cross join lateral (select count(*) filter(where ja.status in ('open','trial')) open_n,count(*) filter(where ja.status='done') done_n from public.journey_actions ja where ja.company_id=p_company and ja.review_id=jr.id) act
    cross join lateral (select case when jr.status='closed' then 'closed' when ann.n=0 then 'scoping' when act.open_n>0 then 'actions_open'
      when act.done_n>0 and not exists(select 1 from public.journey_measures m where m.company_id=p_company and m.review_id=jr.id and m.phase='trial') then 'awaiting_trial_measure' else 'reviewing' end status) x
    where jr.company_id=p_company and (p_id is null or jr.id=p_id) and (p_state='all' or p_id is not null or jr.status='open');
  end if;
end $$;
revoke all on function private.lifecycle_rows(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Reviewed actions: one shape check, one authorized context shared by preview and commitment.
------------------------------------------------------------------------------------------------
create function private.lifecycle_assert_shape(p_mutation jsonb) returns void language plpgsql set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_keys text[]; v_optional text[]:='{}'; n text:=btrim(coalesce(p_mutation->>'note',''));
begin
  v_keys:=case a when 'closure.carry' then array['order_id','item_key'] when 'closure.close' then array['order_id','kind'] when 'closure.reopen' then array['order_id']
    when 'sample.require' then array['order_id','profile_id','reason','quantity_pieces','authority','gates_production','response_days']
    when 'sample.record' then array['id','event','evidence'] when 'sample.decide' then array['id','decision','evidence'] when 'sample.invalidate' then array['id'] when 'sample.withdraw' then array['id']
    when 'template.create' then array['scope','instructions','spacer_required','label_fields'] when 'template.approve' then array['id']
    when 'label.pack' then array['bundle_id','spacers_used','wrapping_done'] when 'label.reprint' then array['bundle_id','reason']
    when 'promise.propose' then array['order_id','tranches'] when 'promise.accept' then array['id'] when 'promise.withdraw' then array['id']
    when 'trace.open' then array['node_type','node_id'] when 'trace.link' then array['from_type','from_id','to_type','to_id','evidence'] when 'trace.hold' then array['id','stock_batch_id'] when 'trace.close' then array['id']
    when 'bundle.split' then array['stock_batch_id','outputs'] when 'bundle.merge' then array['stock_batch_ids','bundle_number','output_kg'] when 'bundle.reverse' then array['id']
    when 'journey.open' then array['order_id','title','participants','baseline_from','baseline_to'] when 'journey.annotate' then array['id','kind','private']
    when 'journey.action' then array['id','finding','owner_id','due_date'] when 'journey.progress' then array['action_id','status']
    when 'journey.measure' then array['id','phase','metric','value','unit','sample_size','limitations'] when 'journey.close' then array['id'] end;
  v_optional:=case a when 'sample.require' then array['die_id','drawing_revision_id'] when 'sample.record' then array['job_id','sample_tag','location','recipient','expected_response']
    when 'sample.decide' then array['customer_contact','limit_kg'] when 'template.create' then array['customer_id','project_id','order_id','max_bundle_kg','max_pieces','wrapping']
    when 'label.pack' then array['deviation'] when 'trace.link' then array['quantity_kg'] when 'bundle.split' then array['variance_reason'] when 'bundle.merge' then array['variance_reason']
    when 'journey.annotate' then array['minutes'] else '{}'::text[] end;
  if jsonb_typeof(p_mutation) is distinct from 'object' or v_keys is null or not(p_mutation ?& (v_keys||array['action','note']))
    or exists(select 1 from jsonb_object_keys(p_mutation) k where not(k=any(v_keys||v_optional||array['action','note'])))
    or length(n) not between 5 and 500 or n ~ '[[:cntrl:]]'
    or exists(select 1 from jsonb_each(p_mutation) x where jsonb_typeof(x.value)='null') then raise exception 'NOV: Review the required action details.'; end if;
end $$;
revoke all on function private.lifecycle_assert_shape(jsonb) from public,anon,authenticated;

create function private.lifecycle_uuid(p_mutation jsonb,p_key text) returns uuid language plpgsql immutable set search_path=public,private as $$
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'string' or (p_mutation->>p_key) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'NOV: Choose a valid record for %.',replace(p_key,'_',' '); end if;
  return (p_mutation->>p_key)::uuid;
end $$;
create function private.lifecycle_bool(p_mutation jsonb,p_key text) returns boolean language plpgsql immutable set search_path=public,private as $$
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'boolean' then raise exception 'NOV: Choose yes or no for %.',replace(p_key,'_',' '); end if;
  return (p_mutation->>p_key)::boolean;
end $$;
revoke all on function private.lifecycle_uuid(jsonb,text),private.lifecycle_bool(jsonb,text) from public,anon,authenticated;

create function private.lifecycle_context(p_company uuid,p_actor uuid,p_mutation jsonb,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_role text; v_id uuid; v_id2 uuid; v_num numeric; v_num2 numeric; v_int integer; v_text text; v_text2 text; v_date date; v_date2 date; v_bool boolean;
  v_warn jsonb:='[]'::jsonb; v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_source jsonb:='{}'::jsonb; v_x jsonb; v_y jsonb; v_state jsonb; v_count integer; e jsonb;
  o public.orders; sr public.sample_requirements; pj public.production_jobs; tp public.packing_label_templates; b public.prepared_physical_bundles; lp public.packing_label_prints;
  dp public.delivery_promises; ti public.trace_investigations; sb public.profile_stock_batches; bt public.bundle_transformations; jr public.journey_reviews; ja public.journey_actions;
  v_fields text[]; v_ids uuid[]; v_viol text[]:='{}';
begin
  perform private.lifecycle_assert_shape(p_mutation);
  select role into v_role from public.app_users where id=p_actor and company_id=p_company and is_active and dealer_id is null;
  if not private.lifecycle_action_allowed(v_role,a) then raise exception 'Not permitted' using errcode='42501'; end if;

  -- NOV-058 ------------------------------------------------------------------------------------
  if a like 'closure.%' then
    v_id:=private.lifecycle_uuid(p_mutation,'order_id');
    if p_lock then perform 1 from public.orders where id=v_id and company_id=p_company for update; end if;
    select * into o from public.orders where id=v_id and company_id=p_company and deleted_at is null;
    if o.id is null then raise exception 'NOV: The order is unavailable.'; end if;
    v_facts:=jsonb_build_object('Order',o.order_number,'Current stage',replace(o.current_stage,'_',' '));
    if a='closure.reopen' then
      if not exists(select 1 from public.order_closures where company_id=p_company and order_id=o.id and status='closed') then raise exception 'NOV: This order was not closed through the closure review.'; end if;
      v_text:=(select previous_stage from public.order_closures where company_id=p_company and order_id=o.id and status='closed');
      v_title:='Reopen a closed order'; v_effect:='Returns the order to '||replace(v_text,'_',' ')||' so new work can be recorded. The closure snapshot and this reason stay in history.';
      v_facts:=v_facts||jsonb_build_object('Returns to stage',replace(v_text,'_',' '));
      v_warn:=v_warn||jsonb_build_array('Carried items are withdrawn; the next closure reviews them again.');
    else
      if o.current_stage in ('closed','cancelled') then raise exception 'NOV: This order is already %.',o.current_stage; end if;
      if a='closure.carry' then
        v_text:=private.assurance_text(p_mutation,'item_key',10,60);
        v_x:=private.closure_readiness(p_company,o.id,'final');
        select value into v_y from jsonb_array_elements(v_x->'items') where value->>'key'=v_text;
        if v_y is null then raise exception 'NOV: This item is no longer open on the order. Refresh the closure review.'; end if;
        if not coalesce((v_y->>'carriable')::boolean,false) then raise exception 'NOV: % cannot be carried past closure. Resolve it in its workflow.',v_y->>'label'; end if;
        if coalesce((v_y->>'carried')::boolean,false) then raise exception 'NOV: This item is already carried with a reason.'; end if;
        v_source:=jsonb_build_object('item',v_y);
        v_title:='Carry an item past closure'; v_effect:='Documents that this item stays open after closure, with its owner. Carrying does not resolve it.';
        v_facts:=v_facts||jsonb_build_object('Item',v_y->>'label','Owner',replace(v_y->>'owner','_',' '),'Detail',v_y->>'detail');
      else
        v_text:=p_mutation->>'kind';
        if v_text not in ('operational','final') then raise exception 'NOV: Choose operational or final closure.'; end if;
        if v_text='final' and v_role not in ('owner','admin','accounts') then raise exception 'NOV: Final commercial closure is recorded by accounts, an admin or the owner.'; end if;
        if v_text='operational' and v_role not in ('owner','admin','sales_manager','factory_manager') then raise exception 'NOV: Operational closure is recorded by sales or factory management.'; end if;
        v_x:=private.closure_readiness(p_company,o.id,v_text);
        if (v_x->>'blocking')::integer>0 then
          raise exception 'NOV: % item(s) are still open, starting with: %.',v_x->>'blocking',(select value->>'label' from jsonb_array_elements(v_x->'items') where (value->>'blocking')::boolean limit 1);
        end if;
        v_source:=jsonb_build_object('readiness',v_x);
        v_title:=case v_text when 'final' then 'Close the order after final commercial review' else 'Close the order operationally' end;
        v_effect:='Moves the order to closed and keeps the reviewed readiness snapshot. New jobs, dispatches, reservations, finishing and packed bundles are refused until an authorized reopening.';
        v_facts:=v_facts||jsonb_build_object('Ordered (kg)',trim_scale((v_x->>'ordered_kg')::numeric),'Dispatched (kg)',trim_scale((v_x->>'dispatched_kg')::numeric),
          'Outstanding receivable (INR)',trim_scale((v_x->>'outstanding_inr')::numeric),'Carried items',(select count(*) from jsonb_array_elements(v_x->'items') where coalesce((value->>'carried')::boolean,false)));
        if (v_x->>'outstanding_inr')::numeric>0 then v_warn:=v_warn||jsonb_build_array(concat('INR ',trim_scale((v_x->>'outstanding_inr')::numeric),' stays receivable in accounts; finance evidence is not changed.')); end if;
        if abs((v_x->>'ordered_kg')::numeric-(v_x->>'dispatched_kg')::numeric)>0.0005 then
          v_warn:=v_warn||jsonb_build_array(concat('Dispatched quantity differs from ordered by ',trim_scale(round((v_x->>'dispatched_kg')::numeric-(v_x->>'ordered_kg')::numeric,3)),' kg. The difference stays visible.')); end if;
      end if;
    end if;

  -- NOV-063 ------------------------------------------------------------------------------------
  elsif a='sample.require' then
    v_id:=private.lifecycle_uuid(p_mutation,'order_id'); v_id2:=private.lifecycle_uuid(p_mutation,'profile_id');
    select * into o from public.orders where id=v_id and company_id=p_company and deleted_at is null;
    if o.id is null or o.current_stage in ('closed','cancelled') then raise exception 'NOV: Choose an open order of this company.'; end if;
    if not exists(select 1 from public.order_items where company_id=p_company and order_id=o.id and profile_id=v_id2) then raise exception 'NOV: The profile is not on this order.'; end if;
    if p_mutation->>'reason' not in ('new_die','new_profile','customer_request','process_change','requalification') then raise exception 'NOV: Choose a sample reason.'; end if;
    if p_mutation->>'authority' not in ('customer','internal') then raise exception 'NOV: Choose who approves the sample.'; end if;
    v_int:=private.assurance_number(p_mutation,'quantity_pieces',1,10000,0); v_num:=private.assurance_number(p_mutation,'response_days',1,90,0);
    v_bool:=private.lifecycle_bool(p_mutation,'gates_production');
    if p_mutation ? 'die_id' and not exists(select 1 from public.dies where id=private.lifecycle_uuid(p_mutation,'die_id') and company_id=p_company and profile_id=v_id2 and deleted_at is null) then
      raise exception 'NOV: Choose a die for this profile.'; end if;
    if p_mutation ? 'drawing_revision_id' then
      if not exists(select 1 from public.drawing_revisions where id=private.lifecycle_uuid(p_mutation,'drawing_revision_id') and company_id=p_company and profile_id=v_id2) then raise exception 'NOV: Choose a drawing revision of this profile.'; end if;
      if private.drawing_state(p_company,(p_mutation->>'drawing_revision_id')::uuid) in ('superseded','withdrawn') then raise exception 'NOV: This drawing revision is no longer current.'; end if;
    end if;
    if exists(select 1 from public.sample_requirements s where s.company_id=p_company and s.order_id=o.id and s.profile_id=v_id2
        and private.sample_state(p_company,s.id)->>'state' not in ('withdrawn')) then raise exception 'NOV: An open sample requirement already exists for this order line. Withdraw it before starting another.'; end if;
    select count(*) into v_count from public.production_jobs where company_id=p_company and order_id=o.id and profile_id=v_id2 and status in ('in_progress','completed');
    v_source:=jsonb_build_object('order',o.id,'started',v_count);
    v_title:='Require a sample'; v_effect:=case when v_bool then 'Production on this order line waits for sample approval; only the sample job may start.' else 'Tracks the sample without gating production.' end;
    v_facts:=jsonb_build_object('Order',o.order_number,'Profile',(select profile_code from public.aluminium_profiles where id=v_id2),'Approval by',p_mutation->>'authority','Pieces',v_int,
      'Die',coalesce((select die_number from public.dies where id=(p_mutation->>'die_id')::uuid),'not bound'),'Gates production',v_bool);
    if v_count>0 then v_warn:=v_warn||jsonb_build_array(concat(v_count,' job(s) already started are not stopped by this requirement.')); end if;
    if p_mutation->>'authority'='customer' then v_warn:=v_warn||jsonb_build_array('Only a decision named to a customer person counts; an internal first-piece check does not substitute.'); end if;
  elsif a like 'sample.%' then
    v_id:=private.lifecycle_uuid(p_mutation,'id');
    if p_lock then perform 1 from public.sample_requirements where id=v_id and company_id=p_company for update; end if;
    select * into sr from public.sample_requirements where id=v_id and company_id=p_company;
    if sr.id is null then raise exception 'NOV: The sample requirement is unavailable.'; end if;
    v_state:=private.sample_state(p_company,sr.id); v_text:=v_state->>'state';
    v_source:=jsonb_build_object('state',v_state);
    v_facts:=jsonb_build_object('Order',(select order_number from public.orders where id=sr.order_id),'Profile',(select profile_code from public.aluminium_profiles where id=sr.profile_id),
      'Current state',replace(v_text,'_',' '),'Sample',greatest((v_state->>'iteration')::integer,1));
    if v_text='withdrawn' then raise exception 'NOV: This sample requirement is withdrawn.'; end if;
    if a='sample.record' then
      v_text2:=p_mutation->>'event'; perform private.assurance_text(p_mutation,'evidence',5,500);
      if v_text2='produced' then
        if v_text not in ('required','rejected','lost','renewal_needed','clarification') then raise exception 'NOV: A sample is already in progress (%). Record what happened to it first.',replace(v_text,'_',' '); end if;
        select * into pj from public.production_jobs where id=private.lifecycle_uuid(p_mutation,'job_id') and company_id=p_company and order_id=sr.order_id and profile_id=sr.profile_id and status<>'cancelled';
        if pj.id is null then raise exception 'NOV: Choose a production job of this order line.'; end if;
        if sr.die_id is not null and pj.die_id is distinct from sr.die_id then raise exception 'NOV: The sample job uses a different die from the one this sample must prove.'; end if;
        perform private.assurance_text(p_mutation,'sample_tag',2,60); perform private.assurance_text(p_mutation,'location',2,120);
        v_title:='Record a produced sample'; v_effect:='Records sample '||((v_state->>'iteration')::integer+1)||' with its source job, tag and physical location. It is not stock.';
        v_facts:=v_facts||jsonb_build_object('Source job',pj.job_number,'Sample tag',btrim(p_mutation->>'sample_tag'),'Location',btrim(p_mutation->>'location'));
      elsif v_text2='measured' then
        if v_text not in ('produced','measured') then raise exception 'NOV: Record the produced sample before its measurements.'; end if;
        v_title:='Record sample measurements'; v_effect:='Records the first-piece measurements of the current sample.';
      elsif v_text2='sent' then
        if v_text not in ('measured','clarification') or not coalesce((v_state->>'measured')::boolean,false) then raise exception 'NOV: Measure the current sample before sending it for decision.'; end if;
        perform private.assurance_text(p_mutation,'recipient',2,120); v_date:=private.assurance_date(p_mutation,'expected_response');
        if v_date<private.ist_today() or v_date>private.ist_today()+90 then raise exception 'NOV: The expected response date must be within the next 90 days.'; end if;
        v_title:='Send the sample for decision'; v_effect:='Records who received the sample and when a decision is expected. Sent is not accepted.';
        v_facts:=v_facts||jsonb_build_object('Recipient',btrim(p_mutation->>'recipient'),'Response expected',v_date);
      elsif v_text2='lost' then
        if v_text not in ('produced','measured','sent') then raise exception 'NOV: Only a produced or sent sample can be recorded as lost.'; end if;
        v_title:='Record a lost sample'; v_effect:='Marks the current sample lost. A new sample must be produced or sent.';
      else raise exception 'NOV: Choose produced, measured, sent or lost.';
      end if;
      if v_text2<>'produced' and (p_mutation ? 'job_id' or p_mutation ? 'sample_tag' or p_mutation ? 'location') then raise exception 'NOV: Job, tag and location are recorded only with a produced sample.'; end if;
      if v_text2<>'sent' and (p_mutation ? 'recipient' or p_mutation ? 'expected_response') then raise exception 'NOV: Recipient and response date are recorded only when sending.'; end if;
    elsif a='sample.decide' then
      v_text2:=p_mutation->>'decision'; perform private.assurance_text(p_mutation,'evidence',5,500);
      if v_text2 not in ('approved','conditional','rejected','clarification') then raise exception 'NOV: Choose a decision.'; end if;
      if v_text<>'sent' then raise exception 'NOV: Only a sample sent for decision can be decided (current state: %).',replace(v_text,'_',' '); end if;
      if sr.authority='customer' then
        if v_text2<>'clarification' and not p_mutation ? 'customer_contact' then raise exception 'NOV: Record the customer person who gave this decision.'; end if;
        if p_mutation ? 'customer_contact' then perform private.assurance_text(p_mutation,'customer_contact',2,120); end if;
      else
        if v_role not in ('owner','admin','quality','factory_manager') then raise exception 'NOV: Internal first-piece decisions are recorded by quality or the factory manager.'; end if;
        if p_mutation ? 'customer_contact' then raise exception 'NOV: This sample is approved internally; no customer contact applies.'; end if;
      end if;
      if (v_text2='conditional')<>(p_mutation ? 'limit_kg') then raise exception 'NOV: A conditional approval states the kg it covers, and only a conditional approval has a limit.'; end if;
      if v_text2='conditional' then v_num:=private.assurance_number(p_mutation,'limit_kg',0.001,1000000,3); v_facts:=v_facts||jsonb_build_object('Covers up to (kg)',trim_scale(v_num)); end if;
      v_title:='Record the sample decision'; v_effect:=case v_text2 when 'approved' then 'Approval lets gated production start on the sampled die. It does not prove the rest of the batch conforms.'
        when 'conditional' then 'Limited approval lets production start up to the stated kg only.' when 'rejected' then 'Production stays blocked until a new sample is approved.' else 'Records the open question; the sample stays undecided.' end;
      v_facts:=v_facts||jsonb_build_object('Decision',v_text2,'Decided by',coalesce(btrim(p_mutation->>'customer_contact'),'Internal quality'));
    elsif a='sample.invalidate' then
      if v_text not in ('approved','conditional') then raise exception 'NOV: Only a current approval can be invalidated.'; end if;
      v_title:='Require renewed sample approval'; v_effect:='The approval stops counting. Unstarted gated jobs wait for a new sample decision.';
    else
      v_title:='Withdraw the sample requirement'; v_effect:='Removes the production gate. History is kept.';
      if sr.gates_production then v_warn:=v_warn||jsonb_build_array('Gated jobs may start without sample approval after withdrawal.'); end if;
    end if;

  -- NOV-079 ------------------------------------------------------------------------------------
  elsif a='template.create' then
    v_text:=p_mutation->>'scope';
    if v_text not in ('company','customer','project','order') then raise exception 'NOV: Choose where the template applies.'; end if;
    if (v_text='customer')<>(p_mutation ? 'customer_id') or (v_text='project')<>(p_mutation ? 'project_id') or (v_text='order')<>(p_mutation ? 'order_id') then
      raise exception 'NOV: Choose only the record for the selected scope.'; end if;
    if v_text='customer' and not exists(select 1 from public.customers where id=private.lifecycle_uuid(p_mutation,'customer_id') and company_id=p_company and deleted_at is null) then raise exception 'NOV: Choose a customer of this company.'; end if;
    if v_text='project' and not exists(select 1 from public.customer_projects where id=private.lifecycle_uuid(p_mutation,'project_id') and company_id=p_company) then raise exception 'NOV: Choose a project of this company.'; end if;
    if v_text='order' and not exists(select 1 from public.orders where id=private.lifecycle_uuid(p_mutation,'order_id') and company_id=p_company and deleted_at is null) then raise exception 'NOV: Choose an order of this company.'; end if;
    perform private.assurance_text(p_mutation,'instructions',5,1000); perform private.lifecycle_bool(p_mutation,'spacer_required');
    if p_mutation ? 'max_bundle_kg' then perform private.assurance_number(p_mutation,'max_bundle_kg',0.001,100000,3); end if;
    if p_mutation ? 'max_pieces' then perform private.assurance_number(p_mutation,'max_pieces',1,100000,0); end if;
    if p_mutation ? 'wrapping' then perform private.assurance_text(p_mutation,'wrapping',2,200); end if;
    if jsonb_typeof(p_mutation->'label_fields')<>'array' or jsonb_array_length(p_mutation->'label_fields') not between 1 and 12
      or exists(select 1 from jsonb_array_elements(p_mutation->'label_fields') f where jsonb_typeof(f)<>'string' or f#>>'{}' not in ('bundle_number','order_number','customer','customer_profile_ref','profile_code','finish',
        'cut_length_mm','pieces','net_kg','gross_kg','drawing_revision','destination','project','packed_on'))
      or (select count(distinct f) from jsonb_array_elements_text(p_mutation->'label_fields') f)<>jsonb_array_length(p_mutation->'label_fields') then
      raise exception 'NOV: Choose label fields from the business-safe list, each once.'; end if;
    select coalesce(max(revision),0)+1 into v_int from public.packing_label_templates where company_id=p_company and scope=v_text
      and coalesce(customer_id,project_id,order_id,company_id)=coalesce((p_mutation->>'customer_id')::uuid,(p_mutation->>'project_id')::uuid,(p_mutation->>'order_id')::uuid,p_company);
    v_source:=jsonb_build_object('revision',v_int);
    v_title:='Create a packing and label template'; v_effect:='Creates draft revision '||v_int||'. It applies only after a second person approves it.';
    v_facts:=jsonb_build_object('Applies to',v_text,'Revision',v_int,'Label fields',(select string_agg(replace(f,'_',' '),', ') from jsonb_array_elements_text(p_mutation->'label_fields') f),
      'Spacers required',(p_mutation->>'spacer_required')::boolean,'Bundle limit (kg)',coalesce(p_mutation->>'max_bundle_kg','none'),'Pieces limit',coalesce(p_mutation->>'max_pieces','none'));
  elsif a='template.approve' then
    v_id:=private.lifecycle_uuid(p_mutation,'id');
    if p_lock then perform 1 from public.packing_label_templates where id=v_id and company_id=p_company for update; end if;
    select * into tp from public.packing_label_templates where id=v_id and company_id=p_company;
    if tp.id is null then raise exception 'NOV: The template is unavailable.'; end if;
    if tp.status<>'draft' then raise exception 'NOV: Only a draft template can be approved.'; end if;
    if tp.created_by=p_actor then raise exception 'NOV: A second person must approve a template they did not write.'; end if;
    select count(*) into v_count from public.packing_label_templates where company_id=p_company and status='approved' and scope=tp.scope
      and coalesce(customer_id,project_id,order_id,company_id)=coalesce(tp.customer_id,tp.project_id,tp.order_id,p_company);
    v_source:=jsonb_build_object('template',tp.id,'current',v_count);
    v_title:='Approve packing template revision '||tp.revision; v_effect:='New labels use this revision. Labels already printed on an earlier revision are listed for reprinting.';
    v_facts:=jsonb_build_object('Applies to',tp.scope,'Revision',tp.revision,'Replaces an approved revision',v_count>0);
  elsif a in ('label.pack','label.reprint') then
    v_id:=private.lifecycle_uuid(p_mutation,'bundle_id');
    if p_lock then perform 1 from public.prepared_physical_bundles where id=v_id and company_id=p_company for update; end if;
    select * into b from public.prepared_physical_bundles where id=v_id and company_id=p_company;
    if b.id is null then raise exception 'NOV: The packed bundle is unavailable.'; end if;
    tp:=private.label_template_for(p_company,b.order_id);
    if tp.id is null then raise exception 'NOV: No approved packing template applies to this order. Approve a template first.'; end if;
    v_x:=private.label_payload(p_company,b.id,tp);
    if jsonb_array_length(v_x->'missing')>0 then raise exception 'NOV: The template needs facts that are not recorded: %.',(select string_agg(replace(m,'_',' '),', ') from jsonb_array_elements_text(v_x->'missing') m); end if;
    if jsonb_array_length(v_x->'overflow')>0 then raise exception 'NOV: These values are longer than a label line (40 characters): %. Shorten the source record or change the template.',(select string_agg(replace(m,'_',' '),', ') from jsonb_array_elements_text(v_x->'overflow') m); end if;
    select * into lp from public.packing_label_prints where company_id=p_company and bundle_id=b.id and status='active';
    v_source:=jsonb_build_object('template',tp.id,'payload',v_x->'fields','print',lp.id);
    v_facts:=jsonb_build_object('Bundle',b.bundle_number,'Template',tp.scope||' revision '||tp.revision,'Pieces',b.number_of_pieces,'Net (kg)',trim_scale((v_x->>'net_kg')::numeric));
    if a='label.pack' then
      if lp.id is not null then raise exception 'NOV: This bundle is already labelled. Reprint the label instead.'; end if;
      if b.dispatch_id is not null then raise exception 'NOV: This bundle has already been loaded for dispatch.'; end if;
      if tp.max_pieces is not null and b.number_of_pieces>tp.max_pieces then v_viol:=v_viol||concat(b.number_of_pieces,' pieces exceed the limit of ',tp.max_pieces); end if;
      if tp.max_bundle_kg is not null and (v_x->>'net_kg')::numeric>tp.max_bundle_kg then v_viol:=v_viol||concat(trim_scale((v_x->>'net_kg')::numeric),' kg exceeds the limit of ',trim_scale(tp.max_bundle_kg),' kg'); end if;
      if tp.spacer_required and not private.lifecycle_bool(p_mutation,'spacers_used') then v_viol:=v_viol||'spacers are required'::text; end if;
      if tp.wrapping is not null and not private.lifecycle_bool(p_mutation,'wrapping_done') then v_viol:=v_viol||('wrapping is required: '||tp.wrapping); end if;
      perform private.lifecycle_bool(p_mutation,'spacers_used'); perform private.lifecycle_bool(p_mutation,'wrapping_done');
      if cardinality(v_viol)>0 and not p_mutation ? 'deviation' then raise exception 'NOV: The packing does not meet the template (%). Repack it or record a reviewed deviation.',array_to_string(v_viol,'; '); end if;
      if p_mutation ? 'deviation' then
        if cardinality(v_viol)=0 then raise exception 'NOV: The packing meets the template; no deviation is needed.'; end if;
        if v_role not in ('owner','admin','dispatch_manager') then raise exception 'NOV: A packing deviation is reviewed by the dispatch manager.'; end if;
        perform private.assurance_text(p_mutation,'deviation',5,500);
        v_warn:=v_warn||jsonb_build_array('Deviation recorded: '||array_to_string(v_viol,'; '));
      end if;
      v_title:='Confirm packing and print the label'; v_effect:='Binds the packing check and label to template revision '||tp.revision||'. The bundle identity is unchanged.';
    else
      if lp.id is null then raise exception 'NOV: This bundle has no label yet. Confirm packing first.'; end if;
      if p_mutation->>'reason' not in ('reprint','damaged') then raise exception 'NOV: Choose why the label is reprinted.'; end if;
      v_title:='Reprint the bundle label'; v_effect:=case when lp.template_id<>tp.id then 'Prints the label on the current template revision and supersedes the older label.'
        else 'Prints the same label again and supersedes the previous print. No new bundle identity is created.' end;
      v_facts:=v_facts||jsonb_build_object('Previous print',lp.print_number,'Reason',case when lp.template_id<>tp.id then 'relabel to current template' else p_mutation->>'reason' end);
    end if;

  -- NOV-021 ------------------------------------------------------------------------------------
  elsif a='promise.propose' then
    v_id:=private.lifecycle_uuid(p_mutation,'order_id');
    select * into o from public.orders where id=v_id and company_id=p_company and deleted_at is null;
    if o.id is null then raise exception 'NOV: The order is unavailable.'; end if;
    if o.current_stage in ('closed','cancelled','delivered','dispatched') then raise exception 'NOV: Delivery promises are made for orders still to be fulfilled.'; end if;
    if jsonb_typeof(p_mutation->'tranches')<>'array' or jsonb_array_length(p_mutation->'tranches') not between 1 and 4 then raise exception 'NOV: Propose one to four delivery parts.'; end if;
    for e in select value from jsonb_array_elements(p_mutation->'tranches') loop
      if jsonb_typeof(e)<>'object' or exists(select 1 from jsonb_object_keys(e) k where k not in ('date','kg')) or not e ?& array['date','kg'] then raise exception 'NOV: Each delivery part needs a date and kg.'; end if;
      perform private.assurance_date(e,'date'); perform private.assurance_number(e,'kg',0.001,1000000,3);
    end loop;
    v_x:=private.promise_evaluate(p_company,o.id,p_mutation->'tranches',null);
    v_source:=jsonb_build_object('verdict',v_x->'verdict','need',v_x->'need','checks',(select jsonb_agg(c->'ok') from jsonb_array_elements(v_x->'checks') c));
    v_title:='Check a delivery promise'; v_effect:='Records an explainable proposal valid for 72 hours. It reserves nothing and is not a customer promise until accepted.';
    v_facts:=jsonb_build_object('Order',o.order_number,'Result',replace(v_x->>'verdict','_',' '),'Remaining to deliver (kg)',trim_scale((v_x->'need'->>'remaining_kg')::numeric),
      'Not covered by this proposal (kg)',trim_scale(coalesce((v_x->>'unpromised_kg')::numeric,0)),'Earliest full delivery on current capacity',coalesce(v_x->>'earliest_full_date','unknown'));
    v_warn:=v_warn||coalesce(v_x->'reasons','[]'::jsonb);
  elsif a in ('promise.accept','promise.withdraw') then
    v_id:=private.lifecycle_uuid(p_mutation,'id');
    if p_lock then perform 1 from public.delivery_promises where id=v_id and company_id=p_company for update; end if;
    select * into dp from public.delivery_promises where id=v_id and company_id=p_company;
    if dp.id is null then raise exception 'NOV: The delivery promise is unavailable.'; end if;
    select * into o from public.orders where id=dp.order_id and company_id=p_company;
    if p_lock then perform 1 from public.orders where id=o.id and company_id=p_company for update; end if;
    v_facts:=jsonb_build_object('Order',o.order_number,'Parts',jsonb_array_length(dp.tranches),'Last part',dp.tranches->-1->>'date');
    if a='promise.accept' then
      if dp.status<>'proposed' then raise exception 'NOV: Only a proposed promise can be accepted.'; end if;
      if dp.expires_at<=now() then raise exception 'NOV: This proposal expired. Check the promise again on current capacity.'; end if;
      if o.current_stage in ('closed','cancelled','delivered','dispatched') then raise exception 'NOV: The order is no longer open for a delivery promise.'; end if;
      v_x:=private.promise_evaluate(p_company,o.id,dp.tranches,dp.id);
      if v_x->>'verdict' not in ('feasible','at_risk') then raise exception 'NOV: The promise is no longer feasible: %',coalesce(v_x->'reasons'->>0,'inputs changed'); end if;
      v_source:=jsonb_build_object('verdict',v_x->'verdict','need',v_x->'need','checks',(select jsonb_agg(c->'ok') from jsonb_array_elements(v_x->'checks') c));
      v_title:='Accept the delivery promise'; v_effect:='Records the customer commitment after a fresh capacity check and sets the order expected dispatch date to the last part. Material is not reserved and slots are not created.';
      v_facts:=v_facts||jsonb_build_object('Current check',replace(v_x->>'verdict','_',' '),'Expected dispatch date now',coalesce(o.expected_dispatch_date::text,'not set'),'Expected dispatch date after',dp.tranches->-1->>'date');
      v_warn:=v_warn||coalesce(v_x->'reasons','[]'::jsonb);
      if exists(select 1 from public.delivery_promises where company_id=p_company and order_id=o.id and status='accepted') then v_warn:=v_warn||jsonb_build_array('The earlier accepted promise for this order is superseded.'); end if;
    else
      if dp.status not in ('proposed','accepted') then raise exception 'NOV: This promise is already closed.'; end if;
      v_source:=jsonb_build_object('status',dp.status);
      v_title:='Withdraw the delivery promise'; v_effect:='Closes the promise. The order expected dispatch date is not changed; update it through the order workflow if needed.';
    end if;

  -- NOV-027 ------------------------------------------------------------------------------------
  elsif a='trace.open' then
    v_text:=p_mutation->>'node_type'; v_id:=private.lifecycle_uuid(p_mutation,'node_id');
    if v_text not in ('billet_batch','foundry_billet','production_job','stock_batch','prepared_bundle','packing_item','dispatch') then raise exception 'NOV: Choose what to trace from.'; end if;
    if private.trace_label(p_company,v_text,v_id)='Unavailable record' then raise exception 'NOV: The starting record is unavailable.'; end if;
    v_x:=private.trace_graph(p_company,v_text,v_id);
    v_source:=jsonb_build_object('nodes',v_x->'node_count');
    v_title:='Open a traceability investigation'; v_effect:='Saves the records linked backward and forward from this point as the investigation snapshot. Nothing is held until you decide.';
    v_facts:=jsonb_build_object('Start',private.trace_label(p_company,v_text,v_id),'Linked records',v_x->'node_count','Unlinked sources',jsonb_array_length(v_x->'unknown'));
    if (v_x->>'truncated')::boolean then v_warn:=v_warn||jsonb_build_array('The graph reached the 200-record limit; start from a narrower record for the rest.'); end if;
    if jsonb_array_length(v_x->'unknown')>0 then v_warn:=v_warn||jsonb_build_array('Some sources are not recorded and are shown as unlinked, not guessed.'); end if;
  elsif a='trace.link' then
    v_text:=p_mutation->>'from_type'; v_text2:=p_mutation->>'to_type'; v_id:=private.lifecycle_uuid(p_mutation,'from_id'); v_id2:=private.lifecycle_uuid(p_mutation,'to_id');
    perform private.assurance_text(p_mutation,'evidence',5,500);
    if (v_text,v_text2) not in (('billet_batch','production_job'),('foundry_billet','production_job'),('production_job','stock_batch')) then raise exception 'NOV: Only billet-to-job and job-to-stock sources can be mapped with evidence.'; end if;
    if private.trace_label(p_company,v_text,v_id)='Unavailable record' or private.trace_label(p_company,v_text2,v_id2)='Unavailable record' then raise exception 'NOV: Both records must belong to this company.'; end if;
    if v_text2='stock_batch' then
      select * into sb from public.profile_stock_batches where id=v_id2 and company_id=p_company;
      select * into pj from public.production_jobs where id=v_id and company_id=p_company;
      if sb.production_job_id is not null then raise exception 'NOV: This stock already records its production job.'; end if;
      if sb.profile_id<>pj.profile_id then raise exception 'NOV: The stock profile differs from the job profile; this mapping cannot be evidenced.'; end if;
    end if;
    if exists(select 1 from public.material_lineage_links where company_id=p_company and from_type=v_text and from_id=v_id and to_type=v_text2 and to_id=v_id2) then raise exception 'NOV: This link is already recorded.'; end if;
    if p_mutation ? 'quantity_kg' then v_num:=private.assurance_number(p_mutation,'quantity_kg',0.001,1000000,3); end if;
    v_title:='Record an evidenced source link'; v_effect:='Adds an explicit relationship backed by the stated evidence. It does not change stock or production records.';
    v_facts:=jsonb_build_object('From',private.trace_label(p_company,v_text,v_id),'To',private.trace_label(p_company,v_text2,v_id2),'Quantity (kg)',coalesce(trim_scale(v_num)::text,'not stated'));
  elsif a in ('trace.hold','trace.close') then
    v_id:=private.lifecycle_uuid(p_mutation,'id');
    if p_lock then perform 1 from public.trace_investigations where id=v_id and company_id=p_company for update; end if;
    select * into ti from public.trace_investigations where id=v_id and company_id=p_company;
    if ti.id is null then raise exception 'NOV: The investigation is unavailable.'; end if;
    if ti.status<>'open' then raise exception 'NOV: This investigation is closed.'; end if;
    v_facts:=jsonb_build_object('Investigation',ti.start_label);
    if a='trace.hold' then
      v_id2:=private.lifecycle_uuid(p_mutation,'stock_batch_id');
      if not exists(select 1 from jsonb_array_elements(ti.snapshot->'nodes') x where x->>'key'='stock_batch:'||v_id2) then raise exception 'NOV: Only stock found by this investigation can be held from it.'; end if;
      if p_lock then perform 1 from public.profile_stock_batches where id=v_id2 and company_id=p_company for update; end if;
      select * into sb from public.profile_stock_batches where id=v_id2 and company_id=p_company;
      if sb.status<>'available' then raise exception 'NOV: Only available stock can be held here; % material needs its own disposition.',sb.status; end if;
      if sb.qc_status not in ('released','not_required') then raise exception 'NOV: This stock is already on QC %.',replace(sb.qc_status,'_',' '); end if;
      v_source:=jsonb_build_object('stock',sb.id,'qc',sb.qc_status,'status',sb.status);
      v_title:='Put affected stock on QC hold'; v_effect:='Prevents reservation and shipment of this bundle until quality releases it through the stock workflow.';
      v_facts:=v_facts||jsonb_build_object('Stock',private.trace_label(p_company,'stock_batch',sb.id),'Weight (kg)',trim_scale(sb.total_weight_kg));
    else
      v_title:='Close the investigation'; v_effect:='Records the conclusion. Holds stay in place until quality releases or disposes the stock.';
      select count(*) into v_count from public.trace_holds where company_id=p_company and investigation_id=ti.id;
      v_facts:=v_facts||jsonb_build_object('Bundles on hold',v_count);
    end if;

  -- NOV-068 ------------------------------------------------------------------------------------
  elsif a in ('bundle.split','bundle.merge') then
    if a='bundle.split' then v_ids:=array[private.lifecycle_uuid(p_mutation,'stock_batch_id')];
    else
      if jsonb_typeof(p_mutation->'stock_batch_ids')<>'array' or jsonb_array_length(p_mutation->'stock_batch_ids') not between 2 and 6 then raise exception 'NOV: Combine two to six bundles.'; end if;
      select array_agg(private.lifecycle_uuid(jsonb_build_object('id',x),'id') order by x#>>'{}') into v_ids from jsonb_array_elements(p_mutation->'stock_batch_ids') x;
      if (select count(distinct u) from unnest(v_ids) u)<>cardinality(v_ids) then raise exception 'NOV: A bundle was scanned twice.'; end if;
    end if;
    if p_lock then perform 1 from public.profile_stock_batches where company_id=p_company and id=any(v_ids) order by id for update; end if;
    if (select count(*) from public.profile_stock_batches where company_id=p_company and id=any(v_ids))<>cardinality(v_ids) then raise exception 'NOV: A selected bundle is unavailable.'; end if;
    for sb in select * from public.profile_stock_batches where company_id=p_company and id=any(v_ids) order by id loop
      if sb.status<>'available' then raise exception 'NOV: Bundle % is %; only available stock can be split or combined.',coalesce(sb.bundle_number,'untagged'),sb.status; end if;
      if sb.qc_status not in ('released','not_required') then raise exception 'NOV: Bundle % is on QC %; held material is not repacked.',coalesce(sb.bundle_number,'untagged'),replace(sb.qc_status,'_',' '); end if;
      if exists(select 1 from public.profile_stock_reservations r where r.company_id=p_company and r.profile_stock_batch_id=sb.id and r.status='active') then raise exception 'NOV: Bundle % is reserved for an order. Release the reservation first.',coalesce(sb.bundle_number,'untagged'); end if;
      if exists(select 1 from public.prepared_physical_bundles pb join public.profile_stock_reservations r on r.id=pb.source_line_id and r.company_id=pb.company_id
          where pb.company_id=p_company and pb.source_kind='reservation' and r.profile_stock_batch_id=sb.id and pb.dispatch_id is null) then raise exception 'NOV: Bundle % is packed for dispatch.',coalesce(sb.bundle_number,'untagged'); end if;
    end loop;
    select coalesce(sum(total_weight_kg),0),coalesce(sum(quantity_pieces),0) into v_num,v_int from public.profile_stock_batches where company_id=p_company and id=any(v_ids);
    if a='bundle.merge' then
      if (select count(distinct (profile_id,finish,coalesce(alloy,''),coalesce(temper,''),coalesce(piece_length_m,-1),coalesce(dealer_id::text,''),origin_type,coalesce(lower(btrim(location)),''))) from public.profile_stock_batches where company_id=p_company and id=any(v_ids))>1 then
        raise exception 'NOV: Only bundles of the same profile, finish, alloy, temper, piece length, owner, origin and location can be combined.'; end if;
      if (select count(distinct production_job_id) from public.profile_stock_batches where company_id=p_company and id=any(v_ids))>1
        and exists(select 1 from public.profile_stock_batches where company_id=p_company and id=any(v_ids) and origin_type='production_surplus') then raise exception 'NOV: Production stock from different jobs cannot share one bundle identity.'; end if;
      v_text:=upper(private.assurance_text(p_mutation,'bundle_number',1,40));
      if v_text !~ '^[A-Z0-9][A-Z0-9/_-]{0,39}$' then raise exception 'NOV: Use letters, digits, slash, dash or underscore for the bundle tag.'; end if;
      v_y:=jsonb_build_array(jsonb_build_object('bundle_number',v_text,'pieces',v_int,'kg',private.assurance_number(p_mutation,'output_kg',0.001,1000000,3)));
    else
      if jsonb_typeof(p_mutation->'outputs')<>'array' or jsonb_array_length(p_mutation->'outputs') not between 2 and 6 then raise exception 'NOV: Split into two to six bundles.'; end if;
      v_y:='[]'::jsonb;
      for e in select value from jsonb_array_elements(p_mutation->'outputs') loop
        if jsonb_typeof(e)<>'object' or exists(select 1 from jsonb_object_keys(e) k where k not in ('bundle_number','pieces','kg')) or not e ?& array['bundle_number','pieces','kg'] then raise exception 'NOV: Each new bundle needs a tag, pieces and kg.'; end if;
        v_text:=upper(private.assurance_text(e,'bundle_number',1,40));
        if v_text !~ '^[A-Z0-9][A-Z0-9/_-]{0,39}$' then raise exception 'NOV: Use letters, digits, slash, dash or underscore for bundle tags.'; end if;
        v_y:=v_y||jsonb_build_array(jsonb_build_object('bundle_number',v_text,'pieces',private.assurance_number(e,'pieces',1,1000000,0),'kg',private.assurance_number(e,'kg',0.001,1000000,3)));
      end loop;
    end if;
    if (select count(distinct x->>'bundle_number') from jsonb_array_elements(v_y) x)<>jsonb_array_length(v_y) then raise exception 'NOV: Each new bundle needs its own tag.'; end if;
    select string_agg(x->>'bundle_number',', ') into v_text2 from jsonb_array_elements(v_y) x where exists(select 1 from public.profile_stock_batches s where s.company_id=p_company and s.status<>'transformed'
      and upper(btrim(s.bundle_number))=x->>'bundle_number')
      or exists(select 1 from public.profile_stock_batches s where s.company_id=p_company and s.id=any(v_ids) and upper(btrim(s.bundle_number))=x->>'bundle_number')
      or exists(select 1 from public.packing_list_items p where p.company_id=p_company and upper(btrim(p.bundle_number))=x->>'bundle_number');
    if v_text2 is not null then raise exception 'NOV: Tag % is already in use. New bundles need new tags.',v_text2; end if;
    if (select sum((x->>'pieces')::integer) from jsonb_array_elements(v_y) x)<>v_int then raise exception 'NOV: New bundles must hold exactly the % pieces counted in.',v_int; end if;
    v_num2:=(select sum((x->>'kg')::numeric) from jsonb_array_elements(v_y) x);
    if v_num2>v_num+0.0005 then raise exception 'NOV: New bundles weigh % kg, more than the % kg going in. Material cannot be created by repacking.',trim_scale(v_num2),trim_scale(v_num); end if;
    if v_num-v_num2>0.0005 and not p_mutation ? 'variance_reason' then raise exception 'NOV: New bundles weigh % kg less than the input. Record the reason for the difference.',trim_scale(round(v_num-v_num2,3)); end if;
    if p_mutation ? 'variance_reason' then
      if v_num-v_num2<=0.0005 then raise exception 'NOV: Weights reconcile; no variance reason is needed.'; end if;
      perform private.assurance_text(p_mutation,'variance_reason',5,300);
    end if;
    v_source:=jsonb_build_object('inputs',(select jsonb_agg(jsonb_build_object('id',s.id,'pieces',s.quantity_pieces,'kg',s.total_weight_kg,'status',s.status,'qc',s.qc_status) order by s.id) from public.profile_stock_batches s where s.company_id=p_company and s.id=any(v_ids)),'outputs',v_y);
    v_title:=case a when 'bundle.split' then 'Split a bundle' else 'Combine bundles' end;
    v_effect:='Consumes the input bundle(s) and creates the new tagged bundle(s) atomically. Old tags resolve to this transformation, not to free stock.';
    v_facts:=jsonb_build_object('Inputs',(select string_agg(coalesce(bundle_number,'untagged'),', ' order by bundle_number) from public.profile_stock_batches where company_id=p_company and id=any(v_ids)),
      'Outputs',(select string_agg(x->>'bundle_number'||' ('||(x->>'pieces')||' pcs, '||(x->>'kg')||' kg)',', ') from jsonb_array_elements(v_y) x),'Pieces',v_int,'Input (kg)',trim_scale(v_num),'Output (kg)',trim_scale(v_num2));
    if v_num-v_num2>0.0005 then v_warn:=v_warn||jsonb_build_array(concat(trim_scale(round(v_num-v_num2,3)),' kg variance is recorded with its reason.')); end if;
  elsif a='bundle.reverse' then
    v_id:=private.lifecycle_uuid(p_mutation,'id');
    if p_lock then perform 1 from public.bundle_transformations where id=v_id and company_id=p_company for update; end if;
    select * into bt from public.bundle_transformations where id=v_id and company_id=p_company;
    if bt.id is null then raise exception 'NOV: The transformation is unavailable.'; end if;
    if bt.status<>'completed' then raise exception 'NOV: This transformation is already reversed.'; end if;
    select array_agg(stock_batch_id order by stock_batch_id) into v_ids from public.bundle_transformation_lines where company_id=p_company and transformation_id=bt.id;
    if p_lock then perform 1 from public.profile_stock_batches where company_id=p_company and id=any(v_ids) order by id for update; end if;
    if exists(select 1 from public.bundle_transformation_lines l join public.profile_stock_batches s on s.id=l.stock_batch_id and s.company_id=l.company_id
        where l.company_id=p_company and l.transformation_id=bt.id and l.direction='output' and (s.status<>'available' or s.quantity_pieces<>l.pieces or s.total_weight_kg<>l.kg
          or exists(select 1 from public.profile_stock_reservations r where r.company_id=p_company and r.profile_stock_batch_id=s.id and r.status in ('active','consumed'))
          or exists(select 1 from public.packing_list_items p where p.company_id=p_company and p.profile_stock_batch_id=s.id))) then
      raise exception 'NOV: An output bundle has been used, changed or reserved since. Record a new transformation instead of reversing this one.'; end if;
    if exists(select 1 from public.bundle_transformation_lines l join public.profile_stock_batches s on s.id=l.stock_batch_id and s.company_id=l.company_id
        where l.company_id=p_company and l.transformation_id=bt.id and l.direction='input' and s.status<>'transformed') then raise exception 'NOV: An input bundle changed since; it cannot be restored.'; end if;
    v_source:=jsonb_build_object('lines',(select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'pieces',s.quantity_pieces,'kg',s.total_weight_kg) order by s.id) from public.profile_stock_batches s where s.company_id=p_company and s.id=any(v_ids)));
    v_title:='Reverse a recording mistake'; v_effect:='Restores the input bundle(s) and consumes the unused output bundle(s). Both records and this correction stay in history.';
    v_facts:=jsonb_build_object('Transformation',bt.kind,'Input (kg)',trim_scale(bt.input_kg),'Output (kg)',trim_scale(bt.output_kg));

  -- NOV-060 ------------------------------------------------------------------------------------
  elsif a='journey.open' then
    v_id:=private.lifecycle_uuid(p_mutation,'order_id');
    select * into o from public.orders where id=v_id and company_id=p_company and deleted_at is null;
    if o.id is null then raise exception 'NOV: Choose an order of this company.'; end if;
    perform private.assurance_text(p_mutation,'title',5,120); perform private.assurance_text(p_mutation,'participants',3,300);
    v_date:=private.assurance_date(p_mutation,'baseline_from'); v_date2:=private.assurance_date(p_mutation,'baseline_to');
    if v_date2<v_date then raise exception 'NOV: The baseline period must end after it starts.'; end if;
    if v_date2>private.ist_today() then raise exception 'NOV: A baseline period describes past work; it cannot end in the future.'; end if;
    v_x:=private.journey_timeline(p_company,o.id);
    v_title:='Start a journey review'; v_effect:='Reconstructs the recorded journey of this order for review. Missing steps are shown as missing, not estimated.';
    v_facts:=jsonb_build_object('Order',o.order_number,'Recorded events',jsonb_array_length(v_x->'events'),'Missing observations',jsonb_array_length(v_x->'missing'),'Baseline',v_date||' to '||v_date2);
  elsif a in ('journey.annotate','journey.action','journey.measure','journey.close') then
    v_id:=private.lifecycle_uuid(p_mutation,'id');
    if p_lock then perform 1 from public.journey_reviews where id=v_id and company_id=p_company for update; end if;
    select * into jr from public.journey_reviews where id=v_id and company_id=p_company;
    if jr.id is null then raise exception 'NOV: The journey review is unavailable.'; end if;
    if jr.status<>'open' then raise exception 'NOV: This review is closed.'; end if;
    v_facts:=jsonb_build_object('Review',jr.title);
    if a='journey.annotate' then
      if p_mutation->>'kind' not in ('active_work','waiting','rework','approval','information_search','missing_event') then raise exception 'NOV: Choose what kind of time this was.'; end if;
      v_bool:=private.lifecycle_bool(p_mutation,'private');
      if p_mutation ? 'minutes' then v_int:=private.assurance_number(p_mutation,'minutes',1,100000,0); end if;
      v_title:='Add a journey observation'; v_effect:=case when v_bool then 'Visible only to the review owner, the factory manager, admins and you.' else 'Visible to everyone who can read this review.' end;
      v_facts:=v_facts||jsonb_build_object('Kind',replace(p_mutation->>'kind','_',' '),'Minutes',coalesce(v_int::text,'not measured'));
    elsif a='journey.action' then
      perform private.assurance_text(p_mutation,'finding',5,300); v_date:=private.assurance_date(p_mutation,'due_date');
      if v_date<private.ist_today() then raise exception 'NOV: The action due date cannot be in the past.'; end if;
      if not exists(select 1 from public.app_users where id=private.lifecycle_uuid(p_mutation,'owner_id') and company_id=p_company and is_active and dealer_id is null) then raise exception 'NOV: Choose an active employee as the action owner.'; end if;
      v_title:='Assign an improvement action'; v_effect:='Creates an owned action traced to this review.';
      v_facts:=v_facts||jsonb_build_object('Owner',(select full_name from public.app_users where id=(p_mutation->>'owner_id')::uuid),'Due',v_date);
    elsif a='journey.measure' then
      if p_mutation->>'phase' not in ('baseline','trial') then raise exception 'NOV: Choose baseline or trial.'; end if;
      if jsonb_typeof(p_mutation->'metric')<>'string' or p_mutation->>'metric' !~ '^[a-z][a-z0-9_]{2,40}$' then raise exception 'NOV: Name the metric in lower case, such as quote_to_order_days.'; end if;
      if p_mutation->>'unit' not in ('hours','days','count','percent','minutes') then raise exception 'NOV: Choose a unit.'; end if;
      v_num:=private.assurance_number(p_mutation,'value',0,100000000,3); v_int:=private.assurance_number(p_mutation,'sample_size',1,100000,0);
      perform private.assurance_text(p_mutation,'limitations',5,500);
      if exists(select 1 from public.journey_measures where company_id=p_company and review_id=jr.id and phase=p_mutation->>'phase' and metric=p_mutation->>'metric') then
        raise exception 'NOV: This % measure is already recorded; measures are not overwritten.',p_mutation->>'phase'; end if;
      if p_mutation->>'phase'='trial' and not exists(select 1 from public.journey_measures where company_id=p_company and review_id=jr.id and phase='baseline' and metric=p_mutation->>'metric' and unit=p_mutation->>'unit') then
        raise exception 'NOV: Record the baseline for this metric in the same unit first, so the comparison uses one definition.'; end if;
      v_title:='Record a '||(p_mutation->>'phase')||' measure'; v_effect:='Stores the value with its sample size and limitations for comparison.';
      v_facts:=v_facts||jsonb_build_object('Metric',p_mutation->>'metric','Value',trim_scale(v_num)||' '||(p_mutation->>'unit'),'Sample size',v_int);
    else
      if not exists(select 1 from public.journey_annotations where company_id=p_company and review_id=jr.id) then raise exception 'NOV: Record at least one observation before closing the review.'; end if;
      if exists(select 1 from public.journey_actions where company_id=p_company and review_id=jr.id and status in ('open','trial')) then raise exception 'NOV: Finish or drop every improvement action first.'; end if;
      if exists(select 1 from public.journey_actions where company_id=p_company and review_id=jr.id and status='done') and not exists(select 1 from public.journey_measures t join public.journey_measures bm
          on bm.company_id=t.company_id and bm.review_id=t.review_id and bm.metric=t.metric and bm.phase='baseline' where t.company_id=p_company and t.review_id=jr.id and t.phase='trial') then
        raise exception 'NOV: Compare a trial measure with its baseline before closing a review with completed actions.'; end if;
      v_title:='Close the journey review'; v_effect:='Records the review outcome. Observations, actions and measures stay readable.';
    end if;
    v_source:=jsonb_build_object('review',jr.id,'status',jr.status);
  elsif a='journey.progress' then
    v_id:=private.lifecycle_uuid(p_mutation,'action_id');
    if p_lock then perform 1 from public.journey_actions where id=v_id and company_id=p_company for update; end if;
    select * into ja from public.journey_actions where id=v_id and company_id=p_company;
    if ja.id is null then raise exception 'NOV: The action is unavailable.'; end if;
    select * into jr from public.journey_reviews where id=ja.review_id and company_id=p_company;
    if jr.status<>'open' then raise exception 'NOV: This review is closed.'; end if;
    if p_mutation->>'status' not in ('trial','done','dropped') or ja.status in ('done','dropped') or (ja.status='trial' and p_mutation->>'status'='trial') then
      raise exception 'NOV: This action cannot move from % to %.',ja.status,coalesce(p_mutation->>'status','?'); end if;
    if ja.owner_id<>p_actor and jr.owner_id<>p_actor and v_role not in ('owner','admin','factory_manager') then raise exception 'NOV: The action owner or the review owner updates this action.'; end if;
    v_source:=jsonb_build_object('status',ja.status);
    v_title:='Update an improvement action'; v_effect:='Moves the action to '||(p_mutation->>'status')||'.';
    v_facts:=jsonb_build_object('Action',ja.finding,'From',ja.status,'To',p_mutation->>'status');
  else raise exception 'NOV: Choose a supported action.';
  end if;
  return jsonb_build_object('source',v_source,'review',jsonb_build_object('title',v_title,'effect',v_effect,'warnings',v_warn,'facts',v_facts));
end $$;
revoke all on function private.lifecycle_context(uuid,uuid,jsonb,boolean) from public,anon,authenticated;

create function private.lifecycle_apply(p_company uuid,p_actor uuid,p_request uuid,p_mutation jsonb,p_context jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; n text:=btrim(p_mutation->>'note'); v_id uuid; v_role text; v_x jsonb; v_state jsonb; v_iter integer; v_num integer; e jsonb;
  o public.orders; sr public.sample_requirements; tp public.packing_label_templates; b public.prepared_physical_bundles; lp public.packing_label_prints; dp public.delivery_promises;
  sb public.profile_stock_batches; v_out uuid; v_ids uuid[]; v_in public.profile_stock_batches; v_reason text; v_cl public.order_closures;
begin
  select role into v_role from public.app_users where id=p_actor and company_id=p_company;
  if a='closure.carry' then
    v_id:=(p_mutation->>'order_id')::uuid;
    insert into public.order_closure_carries(company_id,order_id,item_key,reason,carried_by) values(p_company,v_id,p_mutation->>'item_key',n,p_actor);
    perform private.lifecycle_record(p_company,'closure',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Item carried past closure','href','/tasks/lifecycle/closure/'||v_id,'message','The item stays open with its owner and reason.');
  elsif a='closure.close' then
    v_id:=(p_mutation->>'order_id')::uuid;
    select * into o from public.orders where id=v_id and company_id=p_company for update;
    insert into public.order_closures(id,company_id,order_id,kind,previous_stage,readiness,carried,closed_by,close_note)
    values(p_request,p_company,v_id,p_mutation->>'kind',o.current_stage,p_context->'source'->'readiness'->'items',
      (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(p_context->'source'->'readiness'->'items') x where coalesce((x->>'carried')::boolean,false)),p_actor,n);
    update public.orders set current_stage='closed',updated_at=now() where id=v_id and company_id=p_company;
    insert into public.order_stage_history(company_id,order_id,stage,changed_by,remarks) values(p_company,v_id,'closed',p_actor,'Closed after '||(p_mutation->>'kind')||' closure review: '||n);
    perform private.lifecycle_record(p_company,'closure',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Order closed','href','/tasks/lifecycle/closure/'||v_id,'message','The reviewed snapshot is retained. Reopening needs an owner or admin with a reason.');
  elsif a='closure.reopen' then
    v_id:=(p_mutation->>'order_id')::uuid;
    update public.order_closures set status='reopened',reopened_by=p_actor,reopened_at=clock_timestamp(),reopen_note=n where company_id=p_company and order_id=v_id and status='closed' returning * into v_cl;
    if v_cl.id is null then raise exception 'NOV: This order is not closed.'; end if;
    update public.order_closure_carries set withdrawn_at=clock_timestamp() where company_id=p_company and order_id=v_id and withdrawn_at is null;
    update public.orders set current_stage=v_cl.previous_stage,updated_at=now() where id=v_id and company_id=p_company;
    insert into public.order_stage_history(company_id,order_id,stage,changed_by,remarks) values(p_company,v_id,v_cl.previous_stage,p_actor,'Reopened after closure: '||n);
    perform private.lifecycle_record(p_company,'closure',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Order reopened','href','/tasks/lifecycle/closure/'||v_id,'message','New work can be recorded. Close it again through the review.');

  elsif a='sample.require' then
    select * into o from public.orders where id=(p_mutation->>'order_id')::uuid and company_id=p_company;
    insert into public.sample_requirements(id,company_id,order_id,customer_id,profile_id,die_id,drawing_revision_id,reason,quantity_pieces,authority,gates_production,response_days,requested_by)
    values(p_request,p_company,o.id,o.customer_id,(p_mutation->>'profile_id')::uuid,nullif(p_mutation->>'die_id','')::uuid,nullif(p_mutation->>'drawing_revision_id','')::uuid,p_mutation->>'reason',
      (p_mutation->>'quantity_pieces')::integer,p_mutation->>'authority',(p_mutation->>'gates_production')::boolean,(p_mutation->>'response_days')::smallint,p_actor);
    perform private.lifecycle_record(p_company,'samples',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Sample required','href','/tasks/lifecycle/samples/'||p_request,'message','Record the sample run, measurements and dispatch next.');
  elsif a like 'sample.%' then
    v_id:=(p_mutation->>'id')::uuid;
    select * into sr from public.sample_requirements where id=v_id and company_id=p_company;
    v_state:=p_context->'source'->'state'; v_iter:=greatest((v_state->>'iteration')::integer,1);
    if a='sample.record' and p_mutation->>'event'='produced' then v_iter:=(v_state->>'iteration')::integer+1; end if;
    insert into public.sample_events(company_id,requirement_id,event,iteration,job_id,sample_tag,location,recipient,expected_response,customer_contact,limit_kg,evidence,die_id,drawing_revision_id,recorded_by,recorded_role)
    values(p_company,v_id,case a when 'sample.record' then p_mutation->>'event' when 'sample.decide' then p_mutation->>'decision' when 'sample.invalidate' then 'invalidated' else 'withdrawn' end,
      v_iter,nullif(p_mutation->>'job_id','')::uuid,nullif(btrim(coalesce(p_mutation->>'sample_tag','')),''),nullif(btrim(coalesce(p_mutation->>'location','')),''),
      nullif(btrim(coalesce(p_mutation->>'recipient','')),''),nullif(p_mutation->>'expected_response','')::date,nullif(btrim(coalesce(p_mutation->>'customer_contact','')),''),
      nullif(p_mutation->>'limit_kg','')::numeric,coalesce(btrim(p_mutation->>'evidence'),n),sr.die_id,sr.drawing_revision_id,p_actor,v_role);
    perform private.lifecycle_record(p_company,'samples',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Sample updated','href','/tasks/lifecycle/samples/'||v_id,'message','The sample history now shows this step.');

  elsif a='template.create' then
    insert into public.packing_label_templates(id,company_id,scope,customer_id,project_id,order_id,revision,instructions,max_bundle_kg,max_pieces,spacer_required,wrapping,label_fields,created_by)
    values(p_request,p_company,p_mutation->>'scope',nullif(p_mutation->>'customer_id','')::uuid,nullif(p_mutation->>'project_id','')::uuid,nullif(p_mutation->>'order_id','')::uuid,
      (p_context->'source'->>'revision')::integer,btrim(p_mutation->>'instructions'),nullif(p_mutation->>'max_bundle_kg','')::numeric,nullif(p_mutation->>'max_pieces','')::integer,
      (p_mutation->>'spacer_required')::boolean,nullif(btrim(coalesce(p_mutation->>'wrapping','')),''),array(select jsonb_array_elements_text(p_mutation->'label_fields')),p_actor);
    perform private.lifecycle_record(p_company,'templates',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Template draft created','href','/tasks/lifecycle/templates/'||p_request,'message','A second person approves it before labels use it.');
  elsif a='template.approve' then
    select * into tp from public.packing_label_templates where id=(p_mutation->>'id')::uuid and company_id=p_company;
    update public.packing_label_templates set status='superseded' where company_id=p_company and status='approved' and scope=tp.scope
      and coalesce(customer_id,project_id,order_id,company_id)=coalesce(tp.customer_id,tp.project_id,tp.order_id,p_company);
    update public.packing_label_templates set status='approved',approved_by=p_actor,approved_at=clock_timestamp() where id=tp.id and company_id=p_company and status='draft';
    if not found then raise exception 'NOV: This template is no longer a draft.'; end if;
    perform private.lifecycle_record(p_company,'templates',tp.id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Template approved','href','/tasks/lifecycle/templates/'||tp.id,'message','New labels use this revision.');
  elsif a in ('label.pack','label.reprint') then
    v_id:=(p_mutation->>'bundle_id')::uuid;
    select * into b from public.prepared_physical_bundles where id=v_id and company_id=p_company;
    tp:=private.label_template_for(p_company,b.order_id);
    v_x:=private.label_payload(p_company,b.id,tp);
    select * into lp from public.packing_label_prints where company_id=p_company and bundle_id=b.id and status='active' for update;
    if a='label.reprint' then update public.packing_label_prints set status='superseded' where id=lp.id and company_id=p_company; end if;
    select coalesce(max(print_number),0)+1 into v_num from public.packing_label_prints where company_id=p_company and bundle_id=b.id;
    insert into public.packing_label_prints(id,company_id,bundle_id,template_id,template_revision,print_number,reason,payload,observations,deviation,printed_by,printed_role)
    values(p_request,p_company,b.id,tp.id,tp.revision,v_num,case when a='label.pack' then 'initial' when lp.template_id<>tp.id then 'relabel' else p_mutation->>'reason' end,v_x->'fields',
      case when a='label.pack' then jsonb_build_object('spacers_used',(p_mutation->>'spacers_used')::boolean,'wrapping_done',(p_mutation->>'wrapping_done')::boolean,'pieces',b.number_of_pieces,'net_kg',v_x->'net_kg')
        else coalesce(lp.observations,'{}'::jsonb) end,nullif(btrim(coalesce(p_mutation->>'deviation','')),''),p_actor,v_role);
    perform private.lifecycle_record(p_company,'labels',b.id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label',case a when 'label.pack' then 'Packing confirmed and label ready' else 'Label reprinted' end,'href','/tasks/lifecycle/labels/'||b.id,'message','Label print '||v_num||' is ready. Print it from the bundle record.');

  elsif a='promise.propose' then
    v_x:=private.promise_evaluate(p_company,(p_mutation->>'order_id')::uuid,p_mutation->'tranches',null);
    insert into public.delivery_promises(id,company_id,order_id,tranches,verdict,evaluation,expires_at,proposed_by)
    values(p_request,p_company,(p_mutation->>'order_id')::uuid,(select jsonb_agg(jsonb_build_object('date',t->>'date','kg',(t->>'kg')::numeric) order by t->>'date') from jsonb_array_elements(p_mutation->'tranches') t),
      v_x->>'verdict',v_x,now()+interval '72 hours',p_actor);
    perform private.lifecycle_record(p_company,'promises',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Delivery promise checked','href','/tasks/lifecycle/promises/'||p_request,'message','Result: '||replace(v_x->>'verdict','_',' ')||'. A sales manager accepts it within 72 hours.');
  elsif a='promise.accept' then
    select * into dp from public.delivery_promises where id=(p_mutation->>'id')::uuid and company_id=p_company;
    select * into o from public.orders where id=dp.order_id and company_id=p_company;
    update public.delivery_promises set status='superseded',closed_at=clock_timestamp(),closed_note='Superseded by a later accepted promise' where company_id=p_company and order_id=dp.order_id and status='accepted';
    update public.delivery_promises set status='accepted',accepted_by=p_actor,accepted_at=clock_timestamp(),previous_expected_date=o.expected_dispatch_date where id=dp.id and company_id=p_company and status='proposed';
    if not found then raise exception 'NOV: This promise is no longer proposed.'; end if;
    update public.orders set expected_dispatch_date=(dp.tranches->-1->>'date')::date,updated_at=now() where id=o.id and company_id=p_company;
    perform private.lifecycle_record(p_company,'promises',dp.id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Delivery promise accepted','href','/tasks/lifecycle/promises/'||dp.id,'message','The order expected dispatch date now matches the last promised part.');
  elsif a='promise.withdraw' then
    update public.delivery_promises set status='withdrawn',closed_at=clock_timestamp(),closed_note=n where id=(p_mutation->>'id')::uuid and company_id=p_company and status in ('proposed','accepted');
    if not found then raise exception 'NOV: This promise is already closed.'; end if;
    perform private.lifecycle_record(p_company,'promises',(p_mutation->>'id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Delivery promise withdrawn','href','/tasks/lifecycle/promises/'||(p_mutation->>'id'),'message','Check a new promise when the plan changes.');

  elsif a='trace.open' then
    v_x:=private.trace_graph(p_company,p_mutation->>'node_type',(p_mutation->>'node_id')::uuid);
    insert into public.trace_investigations(id,company_id,start_type,start_id,start_label,reason,snapshot,opened_by)
    values(p_request,p_company,p_mutation->>'node_type',(p_mutation->>'node_id')::uuid,private.trace_label(p_company,p_mutation->>'node_type',(p_mutation->>'node_id')::uuid),n,v_x,p_actor);
    perform private.lifecycle_record(p_company,'trace',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Investigation opened','href','/tasks/lifecycle/trace/'||p_request,'message','Review the linked records and hold affected stock where needed.');
  elsif a='trace.link' then
    insert into public.material_lineage_links(company_id,from_type,from_id,to_type,to_id,relation,quantity_kg,basis,evidence,recorded_by)
    values(p_company,p_mutation->>'from_type',(p_mutation->>'from_id')::uuid,p_mutation->>'to_type',(p_mutation->>'to_id')::uuid,
      case when p_mutation->>'to_type'='production_job' then 'issued_to' else 'packed_from' end,nullif(p_mutation->>'quantity_kg','')::numeric,'evidenced_mapping',btrim(p_mutation->>'evidence'),p_actor)
    returning id into v_id;
    perform private.lifecycle_record(p_company,'trace',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Source link recorded','href',null,'message','Traceability now follows this evidenced link.');
  elsif a='trace.hold' then
    select * into sb from public.profile_stock_batches where id=(p_mutation->>'stock_batch_id')::uuid and company_id=p_company for update;
    insert into public.trace_holds(company_id,investigation_id,stock_batch_id,previous_qc_status,held_by) values(p_company,(p_mutation->>'id')::uuid,sb.id,sb.qc_status,p_actor);
    update public.profile_stock_batches set qc_status='on_hold',notes=concat_ws(E'\n',nullif(notes,''),'QC hold from traceability investigation: '||n),updated_at=now() where id=sb.id and company_id=p_company;
    perform private.lifecycle_record(p_company,'trace',(p_mutation->>'id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Stock put on QC hold','href','/tasks/lifecycle/trace/'||(p_mutation->>'id'),'message','Quality releases or disposes it through the stock workflow.');
  elsif a='trace.close' then
    update public.trace_investigations set status='closed',closed_by=p_actor,closed_at=clock_timestamp(),conclusion=n where id=(p_mutation->>'id')::uuid and company_id=p_company and status='open';
    if not found then raise exception 'NOV: This investigation is already closed.'; end if;
    perform private.lifecycle_record(p_company,'trace',(p_mutation->>'id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Investigation closed','href','/tasks/lifecycle/trace/'||(p_mutation->>'id'),'message','The conclusion is recorded.');

  elsif a in ('bundle.split','bundle.merge') then
    select array_agg((x->>'id')::uuid order by x->>'id') into v_ids from jsonb_array_elements(p_context->'source'->'inputs') x;
    insert into public.bundle_transformations(id,company_id,kind,input_kg,output_kg,variance_kg,variance_reason,recorded_by)
    values(p_request,p_company,split_part(a,'.',2),(select sum((x->>'kg')::numeric) from jsonb_array_elements(p_context->'source'->'inputs') x),
      (select sum((x->>'kg')::numeric) from jsonb_array_elements(p_context->'source'->'outputs') x),
      (select sum((x->>'kg')::numeric) from jsonb_array_elements(p_context->'source'->'outputs') x)-(select sum((x->>'kg')::numeric) from jsonb_array_elements(p_context->'source'->'inputs') x),
      nullif(btrim(coalesce(p_mutation->>'variance_reason','')),''),p_actor);
    select * into v_in from public.profile_stock_batches where company_id=p_company and id=v_ids[1];
    for sb in select * from public.profile_stock_batches where company_id=p_company and id=any(v_ids) order by id loop
      insert into public.bundle_transformation_lines(company_id,transformation_id,direction,stock_batch_id,bundle_number,pieces,kg) values(p_company,p_request,'input',sb.id,sb.bundle_number,sb.quantity_pieces,sb.total_weight_kg);
      update public.profile_stock_batches set status='transformed',notes=concat_ws(E'\n',nullif(notes,''),case a when 'bundle.split' then 'Split' else 'Combined' end||' by transformation '||p_request),updated_at=now()
        where id=sb.id and company_id=p_company and status='available';
      if not found then raise exception 'NOV: An input bundle changed during confirmation.'; end if;
    end loop;
    for e in select value from jsonb_array_elements(p_context->'source'->'outputs') loop
      v_out:=gen_random_uuid();
      insert into public.profile_stock_batches(id,company_id,profile_id,finish,length_m,quantity_pieces,total_weight_kg,bundle_number,location,status,branch_id,warehouse_id,dealer_id,origin_type,
        production_job_id,packaging_job_id,source_dispatch_id,alloy,temper,qc_status,qc_released_by,qc_released_at,origin_reference,piece_length_m,notes)
      values(v_out,p_company,v_in.profile_id,v_in.finish,
        case when v_in.piece_length_m is not null then round(v_in.piece_length_m*(e->>'pieces')::integer,3) else round(v_in.length_m*(e->>'pieces')::numeric/greatest(v_in.quantity_pieces,1),3) end,
        (e->>'pieces')::integer,(e->>'kg')::numeric,e->>'bundle_number',v_in.location,'available',v_in.branch_id,v_in.warehouse_id,v_in.dealer_id,v_in.origin_type,
        case when (select count(distinct production_job_id) from public.profile_stock_batches where company_id=p_company and id=any(v_ids))=1 then v_in.production_job_id end,
        case when cardinality(v_ids)=1 then v_in.packaging_job_id end,case when cardinality(v_ids)=1 then v_in.source_dispatch_id end,v_in.alloy,v_in.temper,
        case when exists(select 1 from public.profile_stock_batches where company_id=p_company and id=any(v_ids) and qc_status='released') then 'released' else 'not_required' end,
        v_in.qc_released_by,v_in.qc_released_at,coalesce(v_in.origin_reference,'')||case when coalesce(v_in.origin_reference,'')='' then '' else ' · ' end||'Repacked '||left(p_request::text,8),
        v_in.piece_length_m,(case a when 'bundle.split' then 'Split from ' else 'Combined from ' end)||(select string_agg(coalesce(bundle_number,'untagged'),', ' order by bundle_number) from public.profile_stock_batches where company_id=p_company and id=any(v_ids)));
      insert into public.bundle_transformation_lines(company_id,transformation_id,direction,stock_batch_id,bundle_number,pieces,kg) values(p_company,p_request,'output',v_out,e->>'bundle_number',(e->>'pieces')::integer,(e->>'kg')::numeric);
      insert into public.material_lineage_links(company_id,from_type,from_id,to_type,to_id,relation,quantity_kg,basis,transformation_id,evidence,recorded_by)
        select p_company,'stock_batch',i,'stock_batch',v_out,case a when 'bundle.split' then 'split_into' else 'merged_into' end,case when a='bundle.split' then (e->>'kg')::numeric end,'transformation',p_request,n,p_actor from unnest(v_ids) i;
    end loop;
    perform private.lifecycle_record(p_company,'bundles',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label',case a when 'bundle.split' then 'Bundle split' else 'Bundles combined' end,'href','/tasks/lifecycle/bundles/'||p_request,'message','Print labels for the new tags; the old tags now show this transformation.');
  elsif a='bundle.reverse' then
    v_id:=(p_mutation->>'id')::uuid;
    update public.profile_stock_batches s set status='transformed',notes=concat_ws(E'\n',nullif(s.notes,''),'Reversed by correction '||p_request),updated_at=now()
      from public.bundle_transformation_lines l where l.company_id=p_company and l.transformation_id=v_id and l.direction='output' and s.id=l.stock_batch_id and s.company_id=p_company and s.status='available';
    update public.profile_stock_batches s set status='available',notes=concat_ws(E'\n',nullif(s.notes,''),'Restored by correction '||p_request),updated_at=now()
      from public.bundle_transformation_lines l where l.company_id=p_company and l.transformation_id=v_id and l.direction='input' and s.id=l.stock_batch_id and s.company_id=p_company and s.status='transformed';
    insert into public.material_lineage_links(company_id,from_type,from_id,to_type,to_id,relation,basis,transformation_id,evidence,recorded_by)
      select p_company,'stock_batch',ol.stock_batch_id,'stock_batch',il.stock_batch_id,'reversed_into','transformation',v_id,n,p_actor
      from public.bundle_transformation_lines ol join public.bundle_transformation_lines il on il.company_id=ol.company_id and il.transformation_id=ol.transformation_id and il.direction='input'
      where ol.company_id=p_company and ol.transformation_id=v_id and ol.direction='output';
    update public.bundle_transformations set status='reversed',reversed_by=p_actor,reversed_at=clock_timestamp(),reverse_note=n where id=v_id and company_id=p_company and status='completed';
    if not found then raise exception 'NOV: This transformation is already reversed.'; end if;
    perform private.lifecycle_record(p_company,'bundles',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Transformation reversed','href','/tasks/lifecycle/bundles/'||v_id,'message','The original bundles are available again.');

  elsif a='journey.open' then
    insert into public.journey_reviews(id,company_id,order_id,title,participants,baseline_from,baseline_to,owner_id)
    values(p_request,p_company,(p_mutation->>'order_id')::uuid,btrim(p_mutation->>'title'),btrim(p_mutation->>'participants'),(p_mutation->>'baseline_from')::date,(p_mutation->>'baseline_to')::date,p_actor);
    perform private.lifecycle_record(p_company,'journeys',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Journey review started','href','/tasks/lifecycle/journeys/'||p_request,'message','Walk the journey with the people involved and record what the records miss.');
  elsif a='journey.annotate' then
    insert into public.journey_annotations(company_id,review_id,kind,minutes,private,observation,recorded_by)
    values(p_company,(p_mutation->>'id')::uuid,p_mutation->>'kind',nullif(p_mutation->>'minutes','')::integer,(p_mutation->>'private')::boolean,n,p_actor);
    perform private.lifecycle_record(p_company,'journeys',(p_mutation->>'id')::uuid,a,p_actor,case when (p_mutation->>'private')::boolean then 'Private observation recorded' else n end,'{}'::jsonb);
    return jsonb_build_object('label','Observation recorded','href','/tasks/lifecycle/journeys/'||(p_mutation->>'id'),'message','It is part of the review record.');
  elsif a='journey.action' then
    insert into public.journey_actions(company_id,review_id,finding,owner_id,due_date) values(p_company,(p_mutation->>'id')::uuid,btrim(p_mutation->>'finding'),(p_mutation->>'owner_id')::uuid,(p_mutation->>'due_date')::date);
    perform private.lifecycle_record(p_company,'journeys',(p_mutation->>'id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Improvement action assigned','href','/tasks/lifecycle/journeys/'||(p_mutation->>'id'),'message','The owner moves it to trial and done.');
  elsif a='journey.progress' then
    update public.journey_actions set status=p_mutation->>'status',updated_at=clock_timestamp() where id=(p_mutation->>'action_id')::uuid and company_id=p_company returning review_id into v_id;
    perform private.lifecycle_record(p_company,'journeys',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Action updated','href','/tasks/lifecycle/journeys/'||v_id,'message','The review shows the new status.');
  elsif a='journey.measure' then
    insert into public.journey_measures(company_id,review_id,phase,metric,value,unit,sample_size,limitations,recorded_by)
    values(p_company,(p_mutation->>'id')::uuid,p_mutation->>'phase',p_mutation->>'metric',(p_mutation->>'value')::numeric,p_mutation->>'unit',(p_mutation->>'sample_size')::integer,btrim(p_mutation->>'limitations'),p_actor);
    perform private.lifecycle_record(p_company,'journeys',(p_mutation->>'id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Measure recorded','href','/tasks/lifecycle/journeys/'||(p_mutation->>'id'),'message','Compare baseline and trial with their stated limitations.');
  elsif a='journey.close' then
    update public.journey_reviews set status='closed',closed_at=clock_timestamp(),closed_note=n where id=(p_mutation->>'id')::uuid and company_id=p_company and status='open';
    if not found then raise exception 'NOV: This review is already closed.'; end if;
    perform private.lifecycle_record(p_company,'journeys',(p_mutation->>'id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Journey review closed','href','/tasks/lifecycle/journeys/'||(p_mutation->>'id'),'message','The outcome and its limitations are recorded.');
  end if;
  raise exception 'NOV: Choose a supported action.';
end $$;
revoke all on function private.lifecycle_apply(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

create function private.lifecycle_outcome(r public.lifecycle_requests) returns jsonb language sql immutable set search_path=public,private as $$
  select jsonb_build_object('request_id',r.request_id,'state',r.state,'fingerprint',r.fingerprint,'expires_at',r.expires_at,'action',r.mutation->>'action','review',r.review,'result',r.result)
$$;
revoke all on function private.lifecycle_outcome(public.lifecycle_requests) from public,anon,authenticated;

create function private.lifecycle_lookup(p_company uuid,p_role text,p_payload jsonb) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare k text:=p_payload->>'kind'; s text:=lower(btrim(coalesce(p_payload->>'search',''))); v_sel uuid:=nullif(p_payload->>'selected_id','')::uuid;
  v_ctx uuid:=nullif(p_payload->>'context_id','')::uuid; v_filter text:=p_payload->>'filter'; v jsonb; v_view text;
begin
  v_view:=case k when 'orders' then coalesce(case v_filter when 'closure' then 'closure' when 'samples' then 'samples' when 'promises' then 'promises' when 'journeys' then 'journeys' when 'templates' then 'templates' end,'closure')
    when 'profiles' then 'samples' when 'dies' then 'samples' when 'drawing_revisions' then 'samples' when 'jobs' then 'samples' when 'customers' then 'templates' when 'projects' then 'templates'
    when 'stock' then 'bundles' when 'trace_nodes' then 'trace' when 'employees' then 'journeys' end;
  if v_view is null or not private.lifecycle_read_allowed(p_role,v_view) then raise exception 'Not permitted' using errcode='42501'; end if;
  if k='orders' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select o.id value,o.order_number label,coalesce(nullif(c.company_name,''),c.customer_name)||' · '||replace(o.current_stage,'_',' ') context
      from public.orders o join public.customers c on c.id=o.customer_id and c.company_id=o.company_id where o.company_id=p_company and o.deleted_at is null
        and (v_filter not in ('samples','promises') or o.current_stage not in ('closed','cancelled','delivered','dispatched'))
        and ((v_sel is not null and o.id=v_sel) or (v_sel is null and position(s in lower(o.order_number||' '||coalesce(c.company_name,'')||' '||c.customer_name))>0)) order by o.order_date desc,o.id limit 20) x;
  elsif k='profiles' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select distinct p.id value,p.profile_code label,p.profile_name context
      from public.aluminium_profiles p join public.order_items i on i.profile_id=p.id and i.company_id=p.company_id where p.company_id=p_company and i.order_id=v_ctx
        and ((v_sel is not null and p.id=v_sel) or (v_sel is null and position(s in lower(p.profile_code||' '||p.profile_name))>0)) limit 20) x;
  elsif k='dies' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select d.id value,d.die_number label,replace(d.die_status,'_',' ') context
      from public.dies d where d.company_id=p_company and d.profile_id=v_ctx and d.deleted_at is null and ((v_sel is not null and d.id=v_sel) or (v_sel is null and position(s in lower(d.die_number))>0)) order by d.die_number limit 20) x;
  elsif k='drawing_revisions' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select r.id value,td.drawing_number||' rev '||r.revision_label label,replace(private.drawing_state(p_company,r.id),'_',' ') context
      from public.drawing_revisions r join public.technical_drawings td on td.id=r.drawing_id and td.company_id=r.company_id where r.company_id=p_company and r.profile_id=v_ctx
        and private.drawing_state(p_company,r.id) not in ('superseded','withdrawn') and ((v_sel is not null and r.id=v_sel) or (v_sel is null and position(s in lower(td.drawing_number||' '||r.revision_label))>0)) limit 20) x;
  elsif k='jobs' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select j.id value,coalesce(j.job_number,'Production job') label,replace(j.status,'_',' ')||' · '||coalesce(d.die_number,'no die') context
      from public.production_jobs j join public.sample_requirements r on r.id=v_ctx and r.company_id=j.company_id and r.order_id=j.order_id and r.profile_id=j.profile_id
      left join public.dies d on d.id=j.die_id where j.company_id=p_company and j.status<>'cancelled' and ((v_sel is not null and j.id=v_sel) or (v_sel is null and position(s in lower(coalesce(j.job_number,'')))>0)) order by j.job_number limit 20) x;
  elsif k='customers' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select c.id value,coalesce(nullif(c.company_name,''),c.customer_name) label,coalesce(c.city,'') context
      from public.customers c where c.company_id=p_company and c.deleted_at is null and ((v_sel is not null and c.id=v_sel) or (v_sel is null and position(s in lower(coalesce(c.company_name,'')||' '||c.customer_name))>0)) order by 2 limit 20) x;
  elsif k='projects' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select p.id value,p.project_code||' · '||p.name label,coalesce(p.site_name,'') context
      from public.customer_projects p where p.company_id=p_company and ((v_sel is not null and p.id=v_sel) or (v_sel is null and position(s in lower(p.project_code||' '||p.name))>0)) order by p.project_code limit 20) x;
  elsif k='stock' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select b.id value,coalesce(b.bundle_number,'untagged')||' · '||p.profile_code label,
        b.quantity_pieces||' pcs · '||trim_scale(b.total_weight_kg)||' kg · '||coalesce(b.location,'no location')||' · '||b.status context
      from public.profile_stock_batches b join public.aluminium_profiles p on p.id=b.profile_id and p.company_id=b.company_id where b.company_id=p_company and b.dealer_id is null
        and ((v_sel is not null and b.id=v_sel) or (v_sel is null and b.status='available' and position(s in lower(coalesce(b.bundle_number,'')||' '||p.profile_code||' '||coalesce(b.location,'')))>0)) order by b.bundle_number limit 20) x;
  elsif k='trace_nodes' then
    if v_filter='production_job' then select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select j.id value,'Job '||coalesce(j.job_number,'') label,replace(j.status,'_',' ') context from public.production_jobs j
      where j.company_id=p_company and ((v_sel is not null and j.id=v_sel) or (v_sel is null and position(s in lower(coalesce(j.job_number,'')))>0)) order by j.created_at desc limit 20) x;
    elsif v_filter='stock_batch' then select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select b.id value,'Stock '||coalesce(b.bundle_number,'untagged') label,b.status context from public.profile_stock_batches b
      where b.company_id=p_company and ((v_sel is not null and b.id=v_sel) or (v_sel is null and position(s in lower(coalesce(b.bundle_number,'')))>0)) order by b.created_at desc limit 20) x;
    elsif v_filter='dispatch' then select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select d.id value,'Dispatch '||coalesce(d.dispatch_number,'') label,d.delivery_status context from public.dispatches d
      where d.company_id=p_company and ((v_sel is not null and d.id=v_sel) or (v_sel is null and position(s in lower(coalesce(d.dispatch_number,'')))>0)) order by d.dispatch_date desc limit 20) x;
    elsif v_filter='packing_item' then select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select p.id value,'Dispatch bundle '||p.bundle_number label,coalesce(d.dispatch_number,'') context
      from public.packing_list_items p join public.dispatches d on d.id=p.dispatch_id and d.company_id=p.company_id
      where p.company_id=p_company and ((v_sel is not null and p.id=v_sel) or (v_sel is null and position(s in lower(p.bundle_number))>0)) order by p.created_at desc limit 20) x;
    elsif v_filter='prepared_bundle' then select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select b.id value,'Packed bundle '||b.bundle_number label,b.source_kind context from public.prepared_physical_bundles b
      where b.company_id=p_company and ((v_sel is not null and b.id=v_sel) or (v_sel is null and position(s in lower(b.bundle_number))>0)) order by b.recorded_at desc limit 20) x;
    elsif v_filter='billet_batch' then select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select b.id value,'Billet batch '||b.batch_number label,b.alloy||' · '||trim_scale(b.total_weight_kg)||' kg' context from public.billet_batches b
      where b.company_id=p_company and ((v_sel is not null and b.id=v_sel) or (v_sel is null and position(s in lower(b.batch_number))>0)) order by b.received_date desc limit 20) x;
    elsif v_filter='foundry_billet' then select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select b.id value,'Billet '||b.billet_code label,b.alloy||' · '||b.status context from public.foundry_billets b
      where b.company_id=p_company and ((v_sel is not null and b.id=v_sel) or (v_sel is null and position(s in lower(b.billet_code))>0)) order by b.created_at desc limit 20) x;
    else v:='[]'::jsonb; end if;
  elsif k='employees' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select u.id value,coalesce(nullif(u.full_name,''),'Employee') label,replace(u.role,'_',' ') context
      from public.app_users u where u.company_id=p_company and u.is_active and u.dealer_id is null and ((v_sel is not null and u.id=v_sel) or (v_sel is null and position(s in lower(coalesce(u.full_name,'')))>0)) order by u.full_name limit 20) x;
  else v:='[]'::jsonb;
  end if;
  return v;
end $$;
revoke all on function private.lifecycle_lookup(uuid,text,jsonb) from public,anon,authenticated;

create function public.lifecycle_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid();v_company uuid:=private.get_current_user_company_id();v_role text:=private.get_current_user_role();
  v_view text;v_page integer;v_search text;v_state text;v_sort text;v_status text;v_id uuid;v_total bigint;v_rows jsonb;v_row jsonb;v_events jsonb;
  r public.lifecycle_requests%rowtype;v_context jsonb;v_fingerprint text;v_result jsonb;v_message text;v_keys text[];
begin
  if v_actor is null or v_company is null or not exists(select 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null)
    or not private.lifecycle_read_allowed(v_role,null) then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.app_users where id=v_actor and company_id=v_company for share;
  v_keys:=case p_command when 'list' then array['view','page','search','state','sort','status'] when 'detail' then array['view','id','page']
    when 'lookup' then array['kind','search','selected_id','context_id','filter'] when 'preview' then array['request_id','mutation'] when 'commit' then array['request_id','fingerprint']
    when 'outcome' then array['request_id'] when 'abandon' then array['request_id'] end;
  if jsonb_typeof(p_payload) is distinct from 'object' or v_keys is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(v_keys))) then raise exception 'NOV: Invalid lifecycle request.'; end if;
  if p_command in ('list','detail') then
    v_view:=p_payload->>'view';v_page:=coalesce((p_payload->>'page')::integer,1);v_search:=btrim(coalesce(p_payload->>'search',''));
    v_state:=coalesce(p_payload->>'state','active');v_sort:=coalesce(p_payload->>'sort','priority');v_status:=nullif(btrim(coalesce(p_payload->>'status','')),'');
    if not private.lifecycle_read_allowed(v_role,v_view) or v_view is null then raise exception 'Not permitted' using errcode='42501'; end if;
    if v_page not between 1 and 100000 or length(v_search)>80 or v_state not in ('active','all') or v_sort not in ('priority','newest','due') or coalesce(v_status,'x') !~ '^[a-z_]{1,40}$' then raise exception 'NOV: Invalid lifecycle filters.'; end if;
    if p_command='detail' then
      v_id:=(p_payload->>'id')::uuid;
      if v_id is null then raise exception 'NOV: Choose a record.'; end if;
      select row_data into v_row from private.lifecycle_rows(v_company,v_actor,v_role,v_view,'all',v_id) limit 1;
      if v_row is null then raise exception 'NOV: This record is unavailable.'; end if;
      select count(*) into v_total from public.lifecycle_events where company_id=v_company and view_name=v_view and entity_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(x) order by recorded_at desc,id),'[]'::jsonb) into v_events from (
        select id,action,actor_name as actor,note,recorded_at from public.lifecycle_events where company_id=v_company and view_name=v_view and entity_id=v_id order by recorded_at desc,id limit 10 offset (v_page-1)*10
      ) x;
      return jsonb_build_object('row',v_row,'events',v_events,'event_count',v_total,'as_of',now());
    end if;
    with visible as (select * from private.lifecycle_rows(v_company,v_actor,v_role,v_view,v_state,null) where (v_status is null or row_data->>'status'=v_status)
      and (v_search='' or position(lower(v_search) in lower(coalesce(row_data->>'label','')||' '||coalesce(row_data->>'status','')||' '||coalesce(row_data->>'owner','')||' '||coalesce(row_data->>'summary','')))>0))
    select (select count(*) from visible),coalesce((select jsonb_agg(x.row_data order by x.position) from (
      select row_data,row_number() over(order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id')) as position
      from visible order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id') limit 10 offset (v_page-1)*10
    ) x),'[]'::jsonb) into v_total,v_rows;
    return jsonb_build_object('rows',v_rows,'total_count',v_total,'as_of',now());
  elsif p_command='lookup' then
    if length(coalesce(p_payload->>'search',''))>80 or coalesce(p_payload->>'filter','x') !~ '^[a-z_]{1,40}$' then raise exception 'NOV: Keep search within 80 characters.'; end if;
    return private.lifecycle_lookup(v_company,v_role,p_payload);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':lifecycle',0));
  v_id:=(p_payload->>'request_id')::uuid;
  if v_id is null then raise exception 'NOV: An original request identity is required.'; end if;
  select * into r from public.lifecycle_requests where request_id=v_id for update;
  if found and (r.company_id<>v_company or r.actor_id<>v_actor) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_command='preview' then
    if r.request_id is not null then
      if r.mutation is distinct from p_payload->'mutation' then raise exception 'NOV: This request identity belongs to different details.'; end if;
      if not private.lifecycle_action_allowed(v_role,r.mutation->>'action') then raise exception 'Not permitted' using errcode='42501'; end if;
      return private.lifecycle_outcome(r);
    end if;
    v_context:=private.lifecycle_context(v_company,v_actor,p_payload->'mutation',false);
    v_fingerprint:=md5((v_context->'source')::text||(p_payload->'mutation')::text);
    insert into public.lifecycle_requests(request_id,company_id,actor_id,mutation,fingerprint,review)
      values(v_id,v_company,v_actor,p_payload->'mutation',v_fingerprint,v_context->'review') returning * into r;
  else
    if r.request_id is null then
      if p_command in ('outcome','abandon') then return jsonb_build_object('request_id',v_id,'state','not_recorded','fingerprint',repeat('0',32),'expires_at',now(),'action','',
        'review',jsonb_build_object('title','Original request check','effect','No prepared or committed action exists for this original request.','warnings','[]'::jsonb,'facts','{}'::jsonb),
        'result',jsonb_build_object('label','Not recorded','href',null,'message','No change was committed with this original request identity. It is safe to start a reviewed action.')); end if;
      raise exception 'NOV: The original request was not found. No action was committed with that request identity.';
    end if;
    if (p_command='commit' and not private.lifecycle_action_allowed(v_role,r.mutation->>'action'))
      or (p_command in ('outcome','abandon') and not private.lifecycle_read_allowed(v_role,private.lifecycle_view(r.mutation->>'action'))) then raise exception 'Not permitted' using errcode='42501'; end if;
    if p_command='commit' and r.state='prepared' then
      if r.fingerprint is distinct from p_payload->>'fingerprint' then raise exception 'NOV: Confirmation does not match the reviewed request.'; end if;
      begin
        if r.expires_at<=now() then raise exception 'NOV: This review expired. Review the current source again.'; end if;
        v_context:=private.lifecycle_context(v_company,v_actor,r.mutation,true);
        if r.fingerprint<>md5((v_context->'source')::text||r.mutation::text) then raise exception 'NOV: A relevant source changed. Review the current details again.'; end if;
        v_result:=private.lifecycle_apply(v_company,v_actor,v_id,r.mutation,v_context);
        update public.lifecycle_requests set state='confirmed',result=v_result where request_id=v_id returning * into r;
      exception when others then
        -- Guard messages raised by existing workflows are curated text; constraint and system messages are not shown.
        v_message:=case when sqlstate='P0001' and sqlerrm like 'NOV: %' then substring(sqlerrm from 6)
          when sqlstate in ('23514','23P01','55P03') and sqlerrm not like '%violates%' and sqlerrm not like '%constraint%' then sqlerrm
          else 'The existing workflow rejected this action. No change from this request was committed. Refresh the source and review its current requirements.' end;
        update public.lifecycle_requests set state='rejected',result=jsonb_build_object('label',r.review->>'title','href',null,'message',v_message) where request_id=v_id returning * into r;
      end;
    elsif p_command='abandon' and r.state='prepared' then
      update public.lifecycle_requests set state='abandoned',result=jsonb_build_object('label',r.review->>'title','href',null,'message','Review cancelled. This request made no change.') where request_id=v_id returning * into r;
    elsif p_command not in ('commit','outcome','abandon') then raise exception 'NOV: Invalid lifecycle request.';
    end if;
  end if;
  return private.lifecycle_outcome(r);
end $$;
revoke all on function public.lifecycle_command(text,jsonb) from public,anon;
grant execute on function public.lifecycle_command(text,jsonb) to authenticated;

------------------------------------------------------------------------------------------------
-- NOV-008: personal defaults are routine, reversible preferences, so they are saved directly.
-- A remembered press must still be an active extrusion press of the user's company.
------------------------------------------------------------------------------------------------
create function public.form_defaults_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid(); v_company uuid:=private.get_current_user_company_id(); v_key text:=p_payload->>'form_key'; v_value text:=btrim(coalesce(p_payload->>'value',''));
begin
  if v_actor is null or v_company is null or not exists(select 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null)
    or not private.lifecycle_read_allowed(private.get_current_user_role(),null) then
    raise exception 'Not permitted' using errcode='42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'NOV: Invalid defaults request.'; end if;
  if p_command='load' then
    if p_payload-'form_keys'<>'{}'::jsonb or jsonb_typeof(p_payload->'form_keys') is distinct from 'array' then raise exception 'NOV: Invalid defaults request.'; end if;
    return coalesce((select jsonb_object_agg(d.form_key,d.value) from public.user_form_defaults d
      where d.company_id=v_company and d.user_id=v_actor and d.form_key in (select jsonb_array_elements_text(p_payload->'form_keys'))
        and (d.form_key<>'production.machine_id' or exists(select 1 from public.machines m where m.company_id=v_company and m.id::text=d.value and m.is_active
          and m.machine_type='extrusion_press' and m.status in ('active','operational','idle')))),'{}'::jsonb);
  end if;
  if p_payload-array['form_key','value']<>'{}'::jsonb or v_key not in ('production.machine_id','production.shift','dispatches.transporter_name') then raise exception 'NOV: Invalid defaults request.'; end if;
  if p_command='clear' then delete from public.user_form_defaults where company_id=v_company and user_id=v_actor and form_key=v_key; return jsonb_build_object('form_key',v_key,'value',null); end if;
  if p_command<>'set' or length(v_value) not between 1 and 120 or v_value ~ '[[:cntrl:]]' then raise exception 'NOV: Enter a default of 1 to 120 characters.'; end if;
  if v_key='production.machine_id' and not exists(select 1 from public.machines m where m.company_id=v_company and m.id::text=v_value and m.is_active
      and m.machine_type='extrusion_press' and m.status in ('active','operational','idle')) then raise exception 'NOV: Only an active extrusion press of this company can be remembered.'; end if;
  insert into public.user_form_defaults(company_id,user_id,form_key,value) values(v_company,v_actor,v_key,v_value)
    on conflict(company_id,user_id,form_key) do update set value=excluded.value,updated_at=now();
  return jsonb_build_object('form_key',v_key,'value',v_value);
end $$;
revoke all on function public.form_defaults_command(text,jsonb) from public,anon;
grant execute on function public.form_defaults_command(text,jsonb) to authenticated;


------------------------------------------------------------------------------------------------
-- NOV-068: production stock-in reconciliation ignores repacked outputs so a split is not counted twice.
-- Same definition as 20261021230000 apart from the stocked-weight query.
------------------------------------------------------------------------------------------------
create or replace function private.create_stock_from_production_surplus(
  p_production_job_id uuid, p_weight_kg numeric, p_pieces integer, p_piece_length_m numeric,
  p_bundle_number text, p_location text, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_job public.production_jobs%rowtype;
  v_released numeric;
  v_shipped numeric;
  v_stocked numeric;
  v_finish text;
  v_id uuid;
  v_alloy text;
  v_temper text;
  v_packaging uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager','inventory_manager') then
    raise exception 'Permission denied to move production surplus to stock' using errcode = '42501';
  end if;
  if coalesce(p_weight_kg, 0) <= 0 or coalesce(p_pieces, 0) <= 0 then raise exception 'Give the surplus weight and pieces' using errcode = '23514'; end if;
  select * into v_job from public.production_jobs where id = p_production_job_id and company_id = v_company_id for update;
  if not found then raise exception 'Production job not found for this company' using errcode = '23514'; end if;
  if v_job.status <> 'completed' then raise exception 'Only completed production can be moved to stock' using errcode = '23514'; end if;
  if coalesce(v_job.finishing_type, 'mill_finish') = 'mill_finish' then
    select coalesce(sum(quantity_checked_kg), 0) into v_released from public.quality_inspections
    where company_id = v_company_id and production_job_id = v_job.id and status = 'approved' and finishing_job_id is null;
    v_finish := 'mill_finish';
  else
    select coalesce(sum(quantity_checked_kg), 0) into v_released from public.quality_inspections
    where company_id = v_company_id and production_job_id = v_job.id and status = 'approved' and finishing_job_id is not null;
    v_finish := v_job.finishing_type;
  end if;
  select coalesce(sum(net_weight_kg), 0) into v_shipped from public.packing_list_items where company_id = v_company_id and source_line_id = v_job.id;
  -- NOV-068: bundles created by a split or combination repack stock already counted; only original stock-in counts.
  select coalesce(sum(b.total_weight_kg), 0) into v_stocked from public.profile_stock_batches b
  where b.company_id = v_company_id and b.production_job_id = v_job.id and b.origin_type = 'production_surplus'
    and not exists (select 1 from public.bundle_transformation_lines l where l.company_id = b.company_id and l.stock_batch_id = b.id and l.direction = 'output');
  if p_weight_kg > v_released - v_shipped - v_stocked + 0.01 then
    raise exception 'Only % kg of QC-released output of this job is unshipped and not yet in stock', greatest(v_released - v_shipped - v_stocked, 0)
      using errcode = '23514';
  end if;
  v_alloy := private.production_job_alloy(v_company_id, v_job.id);
  select temper into v_temper from public.aluminium_profiles where id = v_job.profile_id;
  select id into v_packaging from public.packaging_jobs where company_id = v_company_id and production_job_id = v_job.id and status = 'completed' order by updated_at desc limit 1;

  insert into public.profile_stock_batches(company_id, profile_id, finish, length_m, piece_length_m, quantity_pieces, total_weight_kg, bundle_number, location,
    status, origin_type, production_job_id, packaging_job_id, alloy, temper, qc_status, qc_released_by, qc_released_at, origin_reference, notes)
  values (v_company_id, v_job.profile_id, v_finish, round(coalesce(p_piece_length_m, 0) * p_pieces, 3), p_piece_length_m, p_pieces, p_weight_kg,
    nullif(btrim(coalesce(p_bundle_number, '')), ''), nullif(btrim(coalesce(p_location, '')), ''), 'available', 'production_surplus', v_job.id, v_packaging,
    v_alloy, v_temper, 'released', auth.uid(), now(), concat('Surplus from job ', coalesce(v_job.job_number, v_job.id::text)), nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.create_stock_from_production_surplus(uuid, numeric, integer, numeric, text, text, text) from public, anon, authenticated;

commit;
