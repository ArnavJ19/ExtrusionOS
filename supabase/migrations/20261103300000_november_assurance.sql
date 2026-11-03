-- November batch 5: assurance over drawings, incoming material, deliveries, order changes, people,
-- instruments, capacity, counts, quality packs and returns. Every action is reviewed, idempotent and
-- recorded; existing domain guards still run on every write. Independent of earlier November batches.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create unique index if not exists control_job_tenant_key on public.production_jobs(company_id,id);
create unique index if not exists coordination_user_tenant_key on public.app_users(company_id,id);
create unique index if not exists assurance_drawing_tenant_key on public.technical_drawings(company_id,id);
create unique index if not exists assurance_profile_tenant_key on public.aluminium_profiles(company_id,id);
create unique index if not exists assurance_receipt_line_tenant_key on public.purchase_receipt_lines(company_id,id);
create unique index if not exists assurance_billet_tenant_key on public.billet_batches(company_id,id);
create unique index if not exists assurance_dispatch_tenant_key on public.dispatches(company_id,id);
create unique index if not exists assurance_packing_tenant_key on public.packing_list_items(company_id,id);
create unique index if not exists assurance_order_tenant_key on public.orders(company_id,id);
create unique index if not exists assurance_order_item_tenant_key on public.order_items(company_id,id);
create unique index if not exists assurance_competency_tenant_key on public.competencies(company_id,id);
create unique index if not exists assurance_result_tenant_key on public.inspection_results(company_id,id);
create unique index if not exists assurance_slot_tenant_key on public.production_plan_slots(company_id,id);
create unique index if not exists assurance_machine_tenant_key on public.machines(company_id,id);
create unique index if not exists assurance_stock_batch_tenant_key on public.profile_stock_batches(company_id,id);
create unique index if not exists assurance_requirement_tenant_key on public.customer_compliance_requirements(company_id,id);
create unique index if not exists assurance_document_tenant_key on public.technical_documents(company_id,id);
create index if not exists assurance_job_profile_idx on public.production_jobs(company_id,profile_id) where status in ('planned','ready','on_hold','in_progress');
create index if not exists assurance_packing_dispatch_idx on public.packing_list_items(company_id,dispatch_id);
create index if not exists assurance_return_packing_idx on public.connected_return_receipts(company_id,packing_list_item_id);
create index if not exists assurance_slot_machine_idx on public.production_plan_slots(company_id,machine_id,planned_start_at) where status in ('scheduled','released');
create index if not exists assurance_stock_location_idx on public.profile_stock_batches(company_id,lower(btrim(location))) where status in ('available','reserved');

------------------------------------------------------------------------------------------------
-- NOV-062: immutable drawing revisions and their customer and release events.
------------------------------------------------------------------------------------------------
create table public.drawing_revisions (
  id uuid primary key, company_id uuid not null references public.companies(id), drawing_id uuid not null, profile_id uuid,
  revision_label text not null check(revision_label ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$'),
  file_sha256 text not null check(file_sha256 ~ '^[0-9a-f]{64}$'), file_name text check(file_name is null or length(file_name) between 1 and 180),
  technical_note text check(technical_note is null or length(technical_note)<=300), customer_approval_required boolean not null,
  supersedes_id uuid, registered_by uuid not null, registered_at timestamptz not null default clock_timestamp(),
  unique(company_id,drawing_id,revision_label), unique(company_id,drawing_id,file_sha256), unique(company_id,id),
  foreign key(company_id,drawing_id) references public.technical_drawings(company_id,id),
  foreign key(company_id,profile_id) references public.aluminium_profiles(company_id,id),
  foreign key(company_id,supersedes_id) references public.drawing_revisions(company_id,id),
  foreign key(company_id,registered_by) references public.app_users(company_id,id)
);
create index drawing_revisions_profile_idx on public.drawing_revisions(company_id,profile_id);
create table public.drawing_revision_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), revision_id uuid not null,
  event text not null check(event in ('submitted','customer_query','customer_approved','customer_rejected','deviation_permitted','released','superseded','withdrawn')),
  evidence text not null check(length(btrim(evidence)) between 5 and 500), customer_contact text check(customer_contact is null or length(btrim(customer_contact)) between 2 and 120),
  deviation_job_id uuid, valid_until date, recorded_by uuid, recorded_at timestamptz not null default clock_timestamp(),
  check((event='deviation_permitted')=(deviation_job_id is not null and valid_until is not null)),
  check(event not in ('customer_approved','customer_rejected') or customer_contact is not null),
  foreign key(company_id,revision_id) references public.drawing_revisions(company_id,id),
  foreign key(company_id,deviation_job_id) references public.production_jobs(company_id,id),
  foreign key(company_id,recorded_by) references public.app_users(company_id,id)
);
create index drawing_events_revision_idx on public.drawing_revision_events(company_id,revision_id,recorded_at desc,id desc);

------------------------------------------------------------------------------------------------
-- NOV-069: quality decisions on received purchase lines and releases into billet stock.
------------------------------------------------------------------------------------------------
create table public.incoming_dispositions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), receipt_line_id uuid not null,
  disposition text not null check(disposition in ('accept','concession','reject','returned')),
  quantity numeric(14,3) not null check(quantity>0 and quantity<=100000000), certificate_ref text check(certificate_ref is null or length(btrim(certificate_ref)) between 2 and 80),
  evidence text not null check(length(btrim(evidence)) between 5 and 500), decided_by uuid not null, decided_role text not null,
  decided_at timestamptz not null default clock_timestamp(), reversed_by uuid, reversed_at timestamptz, reverse_note text,
  check((reversed_at is null)=(reversed_by is null)), check(disposition not in ('accept') or certificate_ref is not null), unique(company_id,id),
  foreign key(company_id,receipt_line_id) references public.purchase_receipt_lines(company_id,id),
  foreign key(company_id,decided_by) references public.app_users(company_id,id), foreign key(company_id,reversed_by) references public.app_users(company_id,id)
);
create index incoming_dispositions_line_idx on public.incoming_dispositions(company_id,receipt_line_id) where reversed_at is null;
create table public.incoming_stock_releases (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), receipt_line_id uuid not null,
  billet_batch_id uuid not null unique, quantity_kg numeric(14,3) not null check(quantity_kg>0), released_by uuid not null, released_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,receipt_line_id) references public.purchase_receipt_lines(company_id,id),
  foreign key(company_id,billet_batch_id) references public.billet_batches(company_id,id),
  foreign key(company_id,released_by) references public.app_users(company_id,id)
);
create index incoming_releases_line_idx on public.incoming_stock_releases(company_id,receipt_line_id);

------------------------------------------------------------------------------------------------
-- NOV-076: what the customer accepted, refused, found damaged or reported short, per bundle.
------------------------------------------------------------------------------------------------
create table public.delivery_dispositions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), dispatch_id uuid not null, packing_list_item_id uuid not null,
  disposition text not null check(disposition in ('accepted','refused','damaged','short_claimed')),
  quantity_kg numeric(14,3) not null check(quantity_kg>0), receiver_name text not null check(length(btrim(receiver_name)) between 2 and 120),
  evidence text not null check(length(btrim(evidence)) between 5 and 500), owner_id uuid not null, recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  resolution text check(resolution in ('redelivery','credit_claim','return_expected','verified_shortage','claim_rejected')), resolution_note text, resolved_by uuid, resolved_at timestamptz,
  return_authorization_id uuid, reversed_by uuid, reversed_at timestamptz, reverse_note text,
  check((resolved_at is null)=(resolution is null)), check(disposition<>'accepted' or resolution is null), check((reversed_at is null)=(reversed_by is null)),
  unique(company_id,id),
  foreign key(company_id,dispatch_id) references public.dispatches(company_id,id), foreign key(company_id,packing_list_item_id) references public.packing_list_items(company_id,id),
  foreign key(company_id,owner_id) references public.app_users(company_id,id), foreign key(company_id,recorded_by) references public.app_users(company_id,id),
  foreign key(company_id,resolved_by) references public.app_users(company_id,id), foreign key(company_id,reversed_by) references public.app_users(company_id,id)
);
create index delivery_dispositions_dispatch_idx on public.delivery_dispositions(company_id,dispatch_id) where reversed_at is null;
create index delivery_dispositions_item_idx on public.delivery_dispositions(company_id,packing_list_item_id) where reversed_at is null;

------------------------------------------------------------------------------------------------
-- NOV-038: return authorizations and the replacement or credit that resolves them.
------------------------------------------------------------------------------------------------
create table public.return_authorizations (
  id uuid primary key, company_id uuid not null references public.companies(id), dispatch_id uuid not null, packing_list_item_id uuid not null, order_id uuid not null,
  expected_kg numeric(14,3) not null check(expected_kg>0), response text not null check(response in ('credit','replacement','rework_return','claim_review')),
  reason text not null check(length(btrim(reason)) between 5 and 500), status text not null default 'authorized' check(status in ('authorized','closed','rejected')),
  source_disposition_id uuid, received_kg_at_close numeric(14,3), authorized_by uuid not null, authorized_at timestamptz not null default clock_timestamp(),
  closed_by uuid, closed_at timestamptz, closure_note text, check((status='authorized')=(closed_at is null)), unique(company_id,id),
  foreign key(company_id,dispatch_id) references public.dispatches(company_id,id), foreign key(company_id,packing_list_item_id) references public.packing_list_items(company_id,id),
  foreign key(company_id,order_id) references public.orders(company_id,id), foreign key(company_id,authorized_by) references public.app_users(company_id,id),
  foreign key(company_id,closed_by) references public.app_users(company_id,id)
);
create unique index return_authorizations_one_open on public.return_authorizations(company_id,packing_list_item_id) where status='authorized';
alter table public.delivery_dispositions add foreign key(company_id,return_authorization_id) references public.return_authorizations(company_id,id);
create table public.return_resolution_links (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), authorization_id uuid not null,
  link_type text not null check(link_type in ('replacement_dispatch','replacement_job','credit_note')), target_id uuid not null,
  quantity_kg numeric(14,3) check(quantity_kg is null or quantity_kg>0), linked_by uuid not null, linked_at timestamptz not null default clock_timestamp(),
  unique(company_id,link_type,target_id),
  foreign key(company_id,authorization_id) references public.return_authorizations(company_id,id), foreign key(company_id,linked_by) references public.app_users(company_id,id)
);

------------------------------------------------------------------------------------------------
-- NOV-034: advisory change proposals for an accepted order line and the impact actions they need.
------------------------------------------------------------------------------------------------
create table public.order_change_proposals (
  id uuid primary key, company_id uuid not null references public.companies(id), order_id uuid not null, order_item_id uuid not null,
  changes jsonb not null check(jsonb_typeof(changes)='object'), reason text not null, line_fingerprint text not null,
  status text not null default 'assessed' check(status in ('assessed','approved','abandoned','completed')),
  proposed_by uuid not null, proposed_at timestamptz not null default clock_timestamp(), decided_by uuid, decided_at timestamptz, decision_note text,
  check((status='assessed')=(decided_at is null)), check(decided_by is null or decided_by<>proposed_by), unique(company_id,id),
  foreign key(company_id,order_id) references public.orders(company_id,id), foreign key(company_id,order_item_id) references public.order_items(company_id,id),
  foreign key(company_id,proposed_by) references public.app_users(company_id,id), foreign key(company_id,decided_by) references public.app_users(company_id,id)
);
create unique index order_change_one_open on public.order_change_proposals(company_id,order_item_id) where status in ('assessed','approved');
create table public.order_change_impacts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), proposal_id uuid not null,
  domain text not null check(domain in ('production','finishing','quality','packing','dispatch','billing','inventory','customer')),
  record_type text not null, record_id uuid, label text not null,
  classification text not null check(classification in ('refresh','re_review','posted_correction','customer')),
  owner_role text not null, required_action text not null, status text not null default 'open' check(status in ('open','done','not_required')),
  resolved_by uuid, resolved_at timestamptz, resolution_note text, check((status='open')=(resolved_at is null)), unique(company_id,id),
  foreign key(company_id,proposal_id) references public.order_change_proposals(company_id,id), foreign key(company_id,resolved_by) references public.app_users(company_id,id)
);
create index order_change_impacts_proposal_idx on public.order_change_impacts(company_id,proposal_id,status);

------------------------------------------------------------------------------------------------
-- NOV-055: evidence criteria for independent qualification and the assessments made against them.
------------------------------------------------------------------------------------------------
create table public.qualification_criteria (
  company_id uuid not null references public.companies(id), competency_id uuid not null, supervised_required integer not null check(supervised_required between 0 and 50),
  observed_trial_required boolean not null, revision integer not null default 1 check(revision>0), set_by uuid not null, set_at timestamptz not null default now(),
  primary key(company_id,competency_id),
  foreign key(company_id,competency_id) references public.competencies(company_id,id), foreign key(company_id,set_by) references public.app_users(company_id,id)
);
create table public.qualification_assessments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), employee_id uuid not null, competency_id uuid not null,
  assessor_id uuid not null, outcome text not null check(outcome in ('independent','more_practice')), evidence jsonb not null, note text not null,
  criteria_revision integer, assessed_at timestamptz not null default clock_timestamp(), check(assessor_id<>employee_id),
  foreign key(company_id,employee_id) references public.app_users(company_id,id), foreign key(company_id,assessor_id) references public.app_users(company_id,id),
  foreign key(company_id,competency_id) references public.competencies(company_id,id)
);
create index qualification_assessments_idx on public.qualification_assessments(company_id,competency_id,assessed_at desc);

------------------------------------------------------------------------------------------------
-- NOV-070: measuring instruments, their check evidence and the evidence each result relied on.
------------------------------------------------------------------------------------------------
create table public.measuring_instruments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  code text not null check(code ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$'), name text not null check(length(btrim(name)) between 3 and 120),
  unit text not null check(unit in ('mm','kg/m','HW','micron','percent')), range_min numeric(14,4) not null, range_max numeric(14,4) not null,
  location text check(location is null or length(btrim(location)) between 2 and 120), status text not null default 'active' check(status in ('active','withdrawn')),
  withdrawn_at timestamptz, withdrawn_reason text, registered_by uuid not null, registered_at timestamptz not null default now(),
  check(range_max>range_min), check((status='withdrawn')=(withdrawn_at is not null)), unique(company_id,code), unique(company_id,id),
  foreign key(company_id,registered_by) references public.app_users(company_id,id)
);
create table public.instrument_checks (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), instrument_id uuid not null,
  checked_on date not null, valid_until date not null, result text not null check(result in ('pass','fail')),
  certificate_ref text not null check(length(btrim(certificate_ref)) between 2 and 80), note text not null, recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  check(valid_until>=checked_on), unique(company_id,id),
  foreign key(company_id,instrument_id) references public.measuring_instruments(company_id,id), foreign key(company_id,recorded_by) references public.app_users(company_id,id)
);
create index instrument_checks_idx on public.instrument_checks(company_id,instrument_id,checked_on desc,recorded_at desc);
create table public.instrument_result_bindings (
  inspection_result_id uuid primary key, company_id uuid not null references public.companies(id), instrument_id uuid not null, check_id uuid,
  evidence_state text not null check(evidence_state in ('valid','expired','missing','failed','withdrawn')), measured_at timestamptz not null,
  bound_by uuid not null, bound_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,inspection_result_id) references public.inspection_results(company_id,id),
  foreign key(company_id,instrument_id) references public.measuring_instruments(company_id,id),
  foreign key(company_id,check_id) references public.instrument_checks(company_id,id), foreign key(company_id,bound_by) references public.app_users(company_id,id)
);
create index instrument_bindings_idx on public.instrument_result_bindings(company_id,instrument_id,measured_at);
create table public.instrument_policies (
  company_id uuid primary key references public.companies(id), mode text not null check(mode in ('warn','block')), set_by uuid not null, set_at timestamptz not null default now(),
  foreign key(company_id,set_by) references public.app_users(company_id,id)
);
create table public.instrument_impact_reviews (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), instrument_id uuid not null,
  trigger text not null check(trigger in ('check_failed','withdrawn')), window_from timestamptz, window_to timestamptz not null, affected jsonb not null,
  status text not null default 'open' check(status in ('open','reviewed')), created_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid, reviewed_at timestamptz, review_note text, check((status='open')=(reviewed_at is null)), unique(company_id,id),
  foreign key(company_id,instrument_id) references public.measuring_instruments(company_id,id), foreign key(company_id,reviewed_by) references public.app_users(company_id,id)
);

------------------------------------------------------------------------------------------------
-- NOV-026: schedule changes made because capacity became unavailable, and commitment reviews.
------------------------------------------------------------------------------------------------
create table public.capacity_reschedules (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), slot_id uuid not null,
  unavailability_id uuid not null, action text not null check(action in ('move','unplan')), previous jsonb not null, next jsonb not null,
  reason text not null, applied_by uuid not null, applied_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,slot_id) references public.production_plan_slots(company_id,id), foreign key(company_id,applied_by) references public.app_users(company_id,id)
);
create index capacity_reschedules_idx on public.capacity_reschedules(company_id,unavailability_id,applied_at desc);
create table public.capacity_commitment_reviews (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), order_id uuid not null, unavailability_id uuid not null,
  decision text not null check(decision in ('promise_holds','customer_informed','date_review_needed')), note text not null,
  reviewed_by uuid not null, reviewed_at timestamptz not null default clock_timestamp(), unique(company_id,order_id,unavailability_id),
  foreign key(company_id,order_id) references public.orders(company_id,id), foreign key(company_id,reviewed_by) references public.app_users(company_id,id)
);

------------------------------------------------------------------------------------------------
-- NOV-030: cycle counts with a movement cutoff, observations, reviews and approved adjustments.
------------------------------------------------------------------------------------------------
create table public.cycle_counts (
  id uuid primary key, company_id uuid not null references public.companies(id), location text not null check(length(btrim(location)) between 1 and 120),
  blind boolean not null, cutoff_at timestamptz not null default clock_timestamp(), status text not null default 'open' check(status in ('open','closed')),
  opened_by uuid not null, closed_by uuid, closed_at timestamptz, closure_note text, check((status='closed')=(closed_at is not null)), unique(company_id,id),
  foreign key(company_id,opened_by) references public.app_users(company_id,id), foreign key(company_id,closed_by) references public.app_users(company_id,id)
);
create table public.cycle_count_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), count_id uuid not null,
  profile_stock_batch_id uuid, unlisted_label text check(unlisted_label is null or length(btrim(unlisted_label)) between 2 and 80),
  expected_pieces integer, expected_kg numeric(14,3), batch_snapshot jsonb,
  status text not null default 'pending' check(status in ('pending','matched','difference','moved','unlisted','recount','adjusted','accepted','no_change','not_counted')),
  review_note text, reviewed_by uuid, reviewed_at timestamptz,
  check((profile_stock_batch_id is null)<>(unlisted_label is null)), unique(company_id,id), unique(count_id,profile_stock_batch_id),
  foreign key(company_id,count_id) references public.cycle_counts(company_id,id),
  foreign key(company_id,profile_stock_batch_id) references public.profile_stock_batches(company_id,id),
  foreign key(company_id,reviewed_by) references public.app_users(company_id,id)
);
create index cycle_count_lines_count_idx on public.cycle_count_lines(company_id,count_id,status);
create table public.cycle_count_observations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), line_id uuid not null, round integer not null check(round between 1 and 5),
  counted_pieces integer not null check(counted_pieces between 0 and 1000000), counted_kg numeric(14,3) check(counted_kg is null or counted_kg>=0),
  counted_by uuid not null, counted_at timestamptz not null default clock_timestamp(), note text not null, unique(line_id,round),
  foreign key(company_id,line_id) references public.cycle_count_lines(company_id,id), foreign key(company_id,counted_by) references public.app_users(company_id,id)
);
create table public.cycle_count_adjustments (
  line_id uuid primary key, company_id uuid not null references public.companies(id), profile_stock_batch_id uuid not null,
  before_state jsonb not null, after_state jsonb not null, approved_by uuid not null, approved_at timestamptz not null default clock_timestamp(), note text not null,
  foreign key(company_id,line_id) references public.cycle_count_lines(company_id,id),
  foreign key(company_id,profile_stock_batch_id) references public.profile_stock_batches(company_id,id), foreign key(company_id,approved_by) references public.app_users(company_id,id)
);

------------------------------------------------------------------------------------------------
-- NOV-033: evidence linked to a dispatch's quality requirements, authorized deviations, issued packs.
------------------------------------------------------------------------------------------------
create table public.pack_evidence_links (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), dispatch_id uuid not null,
  requirement_id uuid not null, document_id uuid not null, linked_by uuid not null, linked_at timestamptz not null default clock_timestamp(),
  unique(company_id,dispatch_id,requirement_id,document_id),
  foreign key(company_id,dispatch_id) references public.dispatches(company_id,id), foreign key(company_id,requirement_id) references public.customer_compliance_requirements(company_id,id),
  foreign key(company_id,document_id) references public.technical_documents(company_id,id), foreign key(company_id,linked_by) references public.app_users(company_id,id)
);
create table public.pack_waivers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), dispatch_id uuid not null,
  requirement_key text not null check(requirement_key ~ '^(cert|inspection|drawing|source):[0-9a-f-]{36}$'), reason text not null,
  waived_by uuid not null, waived_at timestamptz not null default clock_timestamp(), unique(company_id,dispatch_id,requirement_key),
  foreign key(company_id,dispatch_id) references public.dispatches(company_id,id), foreign key(company_id,waived_by) references public.app_users(company_id,id)
);
create table public.quality_pack_issues (
  id uuid primary key, company_id uuid not null references public.companies(id), dispatch_id uuid not null, version integer not null check(version>0),
  manifest jsonb not null, status text not null default 'issued' check(status in ('issued','replaced','withdrawn')),
  issued_by uuid not null, issued_at timestamptz not null default clock_timestamp(), withdrawn_by uuid, withdrawn_at timestamptz, withdraw_note text,
  unique(company_id,dispatch_id,version), unique(company_id,id),
  foreign key(company_id,dispatch_id) references public.dispatches(company_id,id), foreign key(company_id,issued_by) references public.app_users(company_id,id),
  foreign key(company_id,withdrawn_by) references public.app_users(company_id,id)
);
create unique index quality_pack_one_issued on public.quality_pack_issues(company_id,dispatch_id) where status='issued';

------------------------------------------------------------------------------------------------
-- Shared request identity and history.
------------------------------------------------------------------------------------------------
create table public.assurance_requests (
  request_id uuid primary key, company_id uuid not null references public.companies(id), actor_id uuid not null,
  mutation jsonb not null, fingerprint text not null, review jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','confirmed','rejected','abandoned')),
  result jsonb, expires_at timestamptz not null default now()+interval '15 minutes', created_at timestamptz not null default now(),
  foreign key(company_id,actor_id) references public.app_users(company_id,id), check((state='prepared')=(result is null))
);
create index assurance_requests_actor_idx on public.assurance_requests(company_id,actor_id,created_at desc);
create table public.assurance_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  view_name text not null, entity_id uuid not null, action text not null, actor_id uuid, actor_name text not null,
  note text not null, facts jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create index assurance_events_entity_idx on public.assurance_events(company_id,view_name,entity_id,recorded_at desc,id);

create function private.assurance_view(p_action text) returns text language sql immutable set search_path=public,private as $$
  select case split_part(p_action,'.',1) when 'drawing' then 'drawings' when 'incoming' then 'incoming' when 'delivery' then 'deliveries'
    when 'change' then 'revisions' when 'capability' then 'capability' when 'instrument' then 'instruments' when 'capacity' then 'capacity'
    when 'count' then 'counts' when 'pack' then 'packs' when 'return' then 'returns' end
$$;
create function private.assurance_read_allowed(p_role text,p_view text) returns boolean language sql immutable set search_path=public,private as $$
  select coalesce(case
    when p_role not in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer') then false
    when p_view='drawings' then p_role in ('owner','admin','factory_manager','production_manager','production','quality','sales_manager','sales','viewer')
    when p_view='incoming' then p_role in ('owner','admin','factory_manager','production_manager','inventory_manager','quality','accounts','viewer')
    when p_view='deliveries' then p_role in ('owner','admin','dispatch_manager','dispatch','sales_manager','sales','accounts','inventory_manager','viewer')
    when p_view='capability' then p_role in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager','inventory_manager','viewer')
    when p_view='instruments' then p_role in ('owner','admin','factory_manager','production_manager','production','quality','viewer')
    when p_view='capacity' then p_role in ('owner','admin','factory_manager','production_manager','production','sales_manager','sales','viewer')
    when p_view='counts' then p_role in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch','accounts','viewer')
    when p_view='packs' then p_role in ('owner','admin','quality','dispatch_manager','dispatch','sales_manager','factory_manager','viewer')
    when p_view='returns' then p_role in ('owner','admin','sales_manager','sales','quality','inventory_manager','dispatch_manager','accounts','factory_manager','viewer')
    when p_view='revisions' then true
    else false end,false)
$$;
create function private.assurance_action_allowed(p_role text,p_action text) returns boolean language sql immutable set search_path=public,private as $$
  select private.assurance_read_allowed(p_role,private.assurance_view(p_action)) and p_role<>'viewer' and coalesce(case
    when p_action='drawing.register' then p_role in ('owner','admin','factory_manager','production_manager','quality')
    when p_action='drawing.customer' then p_role in ('owner','admin','sales_manager','sales','factory_manager','quality')
    when p_action in ('drawing.release','drawing.deviation','drawing.withdraw') then p_role in ('owner','admin','factory_manager','quality')
    when p_action in ('incoming.dispose','incoming.reverse') then p_role in ('owner','admin','factory_manager','quality')
    when p_action='incoming.return' then p_role in ('owner','admin','factory_manager','inventory_manager')
    when p_action='incoming.release' then p_role in ('owner','admin','inventory_manager')
    when p_action in ('delivery.record','delivery.reverse') then p_role in ('owner','admin','dispatch_manager','dispatch','sales_manager')
    when p_action='delivery.resolve' then p_role in ('owner','admin','dispatch_manager','sales_manager','inventory_manager','accounts')
    when p_action='change.propose' then p_role in ('owner','admin','sales_manager','sales','factory_manager')
    when p_action='change.decide' then p_role in ('owner','admin','factory_manager','sales_manager')
    when p_action='change.resolve' then true
    when p_action='capability.criteria' then p_role in ('owner','admin','factory_manager','quality')
    when p_action='capability.assess' then p_role in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager','inventory_manager')
    when p_action in ('instrument.register','instrument.check','instrument.withdraw','instrument.review') then p_role in ('owner','admin','factory_manager','quality')
    when p_action='instrument.policy' then p_role in ('owner','admin','quality')
    when p_action='instrument.bind' then p_role in ('owner','admin','factory_manager','production_manager','production','quality')
    when p_action in ('capacity.move','capacity.unplan') then p_role in ('owner','admin','factory_manager','production_manager')
    when p_action='capacity.review' then p_role in ('owner','admin','factory_manager','sales_manager','sales')
    when p_action in ('count.open','count.close') then p_role in ('owner','admin','factory_manager','inventory_manager')
    when p_action='count.record' then p_role in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch')
    when p_action='count.review' then p_role in ('owner','admin','factory_manager','accounts')
    when p_action in ('pack.link','pack.withdraw') then p_role in ('owner','admin','quality')
    when p_action='pack.waive' then p_role in ('owner','admin','quality','factory_manager')
    when p_action='pack.issue' then p_role in ('owner','admin','quality','dispatch_manager')
    when p_action='return.authorize' then p_role in ('owner','admin','sales_manager','quality')
    when p_action='return.link' then p_role in ('owner','admin','sales_manager','accounts','dispatch_manager')
    when p_action in ('return.close','return.reject') then p_role in ('owner','admin','sales_manager')
    else false end,false)
$$;
revoke all on function private.assurance_view(text),private.assurance_read_allowed(text,text),private.assurance_action_allowed(text,text) from public,anon;
grant execute on function private.assurance_view(text),private.assurance_read_allowed(text,text),private.assurance_action_allowed(text,text) to authenticated;

do $$ declare t text; v text; begin
  for t,v in select * from (values ('drawing_revisions','drawings'),('drawing_revision_events','drawings'),('incoming_dispositions','incoming'),('incoming_stock_releases','incoming'),
    ('delivery_dispositions','deliveries'),('return_authorizations','returns'),('return_resolution_links','returns'),('order_change_proposals','revisions'),('order_change_impacts','revisions'),
    ('qualification_criteria','capability'),('qualification_assessments','capability'),('measuring_instruments','instruments'),('instrument_checks','instruments'),
    ('instrument_result_bindings','instruments'),('instrument_policies','instruments'),('instrument_impact_reviews','instruments'),('capacity_reschedules','capacity'),
    ('capacity_commitment_reviews','capacity'),('cycle_counts','counts'),('cycle_count_lines','counts'),('cycle_count_observations','counts'),('cycle_count_adjustments','counts'),
    ('pack_evidence_links','packs'),('pack_waivers','packs'),('quality_pack_issues','packs')) x(t,v) loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy assurance_tenant_read on public.%I for select to authenticated using (company_id=private.get_current_user_company_id() and private.get_current_user_dealer_id() is null and private.assurance_read_allowed(private.get_current_user_role(),%L))',t,v);
  end loop;
end $$;
alter table public.assurance_requests enable row level security;
alter table public.assurance_events enable row level security;
revoke all on public.assurance_requests,public.assurance_events from public,anon,authenticated;
grant select on public.assurance_requests to authenticated;
create policy assurance_request_owner on public.assurance_requests for select to authenticated using (
  company_id=private.get_current_user_company_id() and actor_id=auth.uid() and private.get_current_user_dealer_id() is null
  and private.assurance_read_allowed(private.get_current_user_role(),private.assurance_view(mutation->>'action'))
);
-- History is projected through the authorized detail command; direct event access is denied.
create policy assurance_events_no_direct_read on public.assurance_events for select to authenticated using(false);

create function private.assurance_record(p_company uuid,p_view text,p_entity uuid,p_action text,p_actor uuid,p_note text,p_facts jsonb) returns void
language sql security definer set search_path=public,private as $$
  insert into public.assurance_events(company_id,view_name,entity_id,action,actor_id,actor_name,note,facts)
  values(p_company,p_view,p_entity,p_action,p_actor,coalesce((select nullif(full_name,'') from public.app_users where id=p_actor and company_id=p_company),'System'),p_note,coalesce(p_facts,'{}'::jsonb))
$$;
revoke all on function private.assurance_record(uuid,text,uuid,text,uuid,text,jsonb) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-062: revision state is the latest lifecycle event; one released revision per profile.
------------------------------------------------------------------------------------------------
create function private.drawing_state(p_company uuid,p_revision uuid) returns text language sql stable security definer set search_path=public,private as $$
  select coalesce((select e.event from public.drawing_revision_events e where e.company_id=p_company and e.revision_id=p_revision and e.event<>'deviation_permitted'
    order by e.recorded_at desc,e.id desc limit 1),'registered')
$$;
create function private.drawing_released(p_company uuid,p_profile uuid) returns public.drawing_revisions language sql stable security definer set search_path=public,private as $$
  select r.* from public.drawing_revisions r where r.company_id=p_company and r.profile_id=p_profile and private.drawing_state(p_company,r.id)='released'
  order by r.registered_at desc,r.id limit 1
$$;
revoke all on function private.drawing_state(uuid,uuid),private.drawing_released(uuid,uuid) from public,anon,authenticated;

-- Production may first start only on the released revision of a controlled profile, or under a
-- permitted deviation for that job. Profiles without a released revision are not controlled.
create function private.guard_released_drawing() returns trigger language plpgsql security definer set search_path=public,private as $$
declare r public.drawing_revisions;
begin
  if new.status<>'in_progress' or new.profile_id is null then return new; end if;
  if tg_op='UPDATE' then if old.status not in ('planned','ready') then return new; end if; end if;
  r:=private.drawing_released(new.company_id,new.profile_id);
  if r.id is null or new.drawing_revision is not distinct from r.revision_label then return new; end if;
  if exists(select 1 from public.drawing_revision_events e join public.drawing_revisions dr on dr.id=e.revision_id and dr.company_id=e.company_id
      where e.company_id=new.company_id and e.event='deviation_permitted' and e.deviation_job_id=new.id and e.valid_until>=private.ist_today()
        and dr.profile_id=new.profile_id and dr.revision_label=new.drawing_revision) then return new; end if;
  raise exception 'Drawing revision % on this job is not the released revision % for this profile. Refresh the job from its order line or record a permitted deviation.',
    coalesce(new.drawing_revision,'(none)'),r.revision_label using errcode='23514';
end $$;
revoke all on function private.guard_released_drawing() from public,anon,authenticated;
create trigger zzz_guard_released_drawing before insert or update on public.production_jobs for each row execute function private.guard_released_drawing();

------------------------------------------------------------------------------------------------
-- NOV-069: receipt line balances. Everything not refused at the gate awaits a quality decision.
------------------------------------------------------------------------------------------------
create function private.incoming_balance(p_company uuid,p_line uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare l public.purchase_receipt_lines; v_acc numeric; v_con numeric; v_rej numeric; v_ret numeric; v_rel numeric; v_unit text;
begin
  select * into l from public.purchase_receipt_lines where id=p_line and company_id=p_company;
  if l.id is null then return null; end if;
  select coalesce(sum(quantity) filter(where disposition='accept'),0),coalesce(sum(quantity) filter(where disposition='concession'),0),
    coalesce(sum(quantity) filter(where disposition='reject'),0),coalesce(sum(quantity) filter(where disposition='returned'),0)
    into v_acc,v_con,v_rej,v_ret from public.incoming_dispositions where company_id=p_company and receipt_line_id=p_line and reversed_at is null;
  select coalesce(sum(quantity_kg),0) into v_rel from public.incoming_stock_releases where company_id=p_company and receipt_line_id=p_line;
  select lower(btrim(unit)) into v_unit from public.purchase_order_lines where id=l.purchase_order_line_id and company_id=p_company;
  return jsonb_build_object('unit',v_unit,'received',l.received_quantity,'gate_rejected',l.rejected_quantity,'accepted',v_acc,'concession',v_con,'rejected',v_rej,
    'returned',v_ret,'released',v_rel,'pending_qc',round(l.received_quantity-l.rejected_quantity-v_acc-v_con-v_rej,3),
    'awaiting_return',round(l.rejected_quantity+v_rej-v_ret,3),'releasable',case when v_unit='kg' then round(v_acc+v_con-v_rel,3) else 0 end);
end $$;
revoke all on function private.incoming_balance(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-076: shipped quantity per bundle against recorded customer dispositions.
------------------------------------------------------------------------------------------------
create function private.packing_net_kg(pl public.packing_list_items) returns numeric language sql immutable set search_path=public,private as $$
  select round(coalesce(pl.net_weight_kg,pl.gross_weight_kg-pl.tare_weight_kg),3)
$$;
create function private.delivery_balance(p_company uuid,p_dispatch uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_bundles jsonb; v_exceptions jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'bundle_number',x.bundle_number,'net_kg',x.net_kg,'accepted_kg',x.acc,'refused_kg',x.ref,'damaged_kg',x.dmg,'short_kg',x.sht,
      'undisposed_kg',round(x.net_kg-x.acc-x.ref-x.dmg-x.sht,3)) order by x.bundle_number,x.id),'[]'::jsonb) into v_bundles from (
    select pl.id,pl.bundle_number,private.packing_net_kg(pl) net_kg,
      coalesce(sum(d.quantity_kg) filter(where d.disposition='accepted'),0) acc,coalesce(sum(d.quantity_kg) filter(where d.disposition='refused'),0) ref,
      coalesce(sum(d.quantity_kg) filter(where d.disposition='damaged'),0) dmg,coalesce(sum(d.quantity_kg) filter(where d.disposition='short_claimed'),0) sht
    from public.packing_list_items pl left join public.delivery_dispositions d on d.packing_list_item_id=pl.id and d.company_id=pl.company_id and d.reversed_at is null
    where pl.company_id=p_company and pl.dispatch_id=p_dispatch group by pl.id) x;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'packing_item_id',d.packing_list_item_id,'bundle_number',pl.bundle_number,'disposition',d.disposition,'kg',d.quantity_kg,
      'receiver',d.receiver_name,'evidence',d.evidence,'owner',ou.full_name,'recorded_at',d.recorded_at,'resolution',d.resolution,'resolution_note',d.resolution_note,
      'resolved_at',d.resolved_at,'return_authorization_id',d.return_authorization_id) order by d.recorded_at,d.id),'[]'::jsonb) into v_exceptions
    from public.delivery_dispositions d join public.packing_list_items pl on pl.id=d.packing_list_item_id and pl.company_id=d.company_id
    left join public.app_users ou on ou.id=d.owner_id and ou.company_id=d.company_id
    where d.company_id=p_company and d.dispatch_id=p_dispatch and d.reversed_at is null;
  return jsonb_build_object('bundles',v_bundles,'dispositions',v_exceptions,
    'shipped_kg',(select coalesce(sum((b->>'net_kg')::numeric),0) from jsonb_array_elements(v_bundles) b),
    'accepted_kg',(select coalesce(sum((b->>'accepted_kg')::numeric),0) from jsonb_array_elements(v_bundles) b),
    'refused_kg',(select coalesce(sum((b->>'refused_kg')::numeric),0) from jsonb_array_elements(v_bundles) b),
    'damaged_kg',(select coalesce(sum((b->>'damaged_kg')::numeric),0) from jsonb_array_elements(v_bundles) b),
    'short_kg',(select coalesce(sum((b->>'short_kg')::numeric),0) from jsonb_array_elements(v_bundles) b),
    'undisposed_kg',(select coalesce(sum((b->>'undisposed_kg')::numeric),0) from jsonb_array_elements(v_bundles) b),
    'open_exceptions',(select count(*) from jsonb_array_elements(v_exceptions) e where e->>'disposition'<>'accepted' and e->>'resolution' is null));
end $$;
revoke all on function private.packing_net_kg(public.packing_list_items),private.delivery_balance(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-038: what each return authorization has received and what still resolves it.
------------------------------------------------------------------------------------------------
create function private.return_balance(p_company uuid,p_auth uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare a public.return_authorizations; v_total numeric; v_prior numeric; v_received numeric; v_disposed numeric; v_undisposed integer; v_credit numeric; v_replaced numeric; v_job numeric; v_resolved numeric;
begin
  select * into a from public.return_authorizations where id=p_auth and company_id=p_company;
  if a.id is null then return null; end if;
  select coalesce(sum(received_kg),0),coalesce(sum(received_kg) filter(where status='disposed'),0),count(*) filter(where status<>'disposed')
    into v_total,v_disposed,v_undisposed from public.connected_return_receipts where company_id=p_company and packing_list_item_id=a.packing_list_item_id;
  select coalesce(sum(received_kg_at_close),0) into v_prior from public.return_authorizations
    where company_id=p_company and packing_list_item_id=a.packing_list_item_id and id<>a.id and status<>'authorized' and closed_at<coalesce(a.closed_at,'infinity'::timestamptz);
  v_received:=case when a.status='authorized' then greatest(round(v_total-v_prior,3),0) else coalesce(a.received_kg_at_close,0) end;
  select coalesce(sum(quantity_kg) filter(where link_type='credit_note'),0),coalesce(sum(quantity_kg) filter(where link_type='replacement_dispatch'),0),
    coalesce(sum(quantity_kg) filter(where link_type='replacement_job'),0) into v_credit,v_replaced,v_job
    from public.return_resolution_links where company_id=p_company and authorization_id=a.id;
  v_resolved:=case a.response when 'credit' then v_credit when 'claim_review' then 0 else v_replaced end;
  return jsonb_build_object('expected_kg',a.expected_kg,'received_kg',v_received,'disposed_kg',least(v_disposed,v_received),'undisposed_receipts',v_undisposed,
    'credited_kg',v_credit,'replacement_dispatched_kg',v_replaced,'replacement_in_production_kg',v_job,'resolved_kg',v_resolved,
    'owed_kg',case when a.status='authorized' then greatest(round(a.expected_kg-v_resolved,3),0) else 0 end);
end $$;
revoke all on function private.return_balance(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-070: the evidence an instrument had at a measurement time. Unknown evidence is not valid.
------------------------------------------------------------------------------------------------
create function private.instrument_evidence(p_company uuid,p_instrument uuid,p_at timestamptz) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare i public.measuring_instruments; c public.instrument_checks; v_day date:=(p_at at time zone 'Asia/Kolkata')::date;
begin
  select * into i from public.measuring_instruments where id=p_instrument and company_id=p_company;
  if i.id is null then return null; end if;
  select * into c from public.instrument_checks where company_id=p_company and instrument_id=p_instrument and checked_on<=v_day order by checked_on desc,recorded_at desc,id desc limit 1;
  return jsonb_build_object('check_id',c.id,'checked_on',c.checked_on,'valid_until',c.valid_until,'certificate_ref',c.certificate_ref,'state',case
    when i.status='withdrawn' and i.withdrawn_at<=p_at then 'withdrawn' when c.id is null then 'missing' when c.result='fail' then 'failed'
    when c.valid_until<v_day then 'expired' else 'valid' end);
end $$;
revoke all on function private.instrument_evidence(uuid,uuid,timestamptz) from public,anon,authenticated;

create function private.guard_instrument_evidence() returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if new.status<>'approved' then return new; end if;
  if tg_op='UPDATE' then if old.status='approved' then return new; end if; end if;
  if coalesce((select mode from public.instrument_policies where company_id=new.company_id),'warn')<>'block' then return new; end if;
  if exists(select 1 from public.inspection_results r where r.company_id=new.company_id and r.inspection_id=new.id and r.observed is not null
      and not exists(select 1 from public.instrument_result_bindings b where b.company_id=r.company_id and b.inspection_result_id=r.id and b.evidence_state='valid')) then
    raise exception 'Each measured result needs an instrument with valid check evidence before approval. Bind the instruments under Assurance, Instruments.' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_instrument_evidence() from public,anon,authenticated;
create trigger zzz_guard_instrument_evidence before insert or update on public.quality_inspections for each row execute function private.guard_instrument_evidence();

------------------------------------------------------------------------------------------------
-- NOV-026: unavailable capacity. An open breakdown, or one whose machine is not yet signed back
-- into service, has an unknown end and affects every later active slot on that machine.
------------------------------------------------------------------------------------------------
create function private.capacity_windows(p_company uuid) returns table(id uuid,kind text,machine_id uuid,starts_at timestamptz,ends_at timestamptz,end_known boolean,reason text,source_status text)
language sql stable security definer set search_path=public,private as $$
  select b.id,'maintenance',b.machine_id,b.starts_at,b.ends_at,true,b.reason,b.status from public.factory_maintenance_blocks b
  where b.company_id=p_company and b.status='planned' and b.ends_at>now()-interval '1 day'
  union all
  select l.id,'breakdown',l.machine_ref_id,coalesce(l.start_time,l.created_at),l.end_time,false,l.issue_description,l.status
  from public.breakdown_logs l join public.machines m on m.id=l.machine_ref_id and m.company_id=l.company_id
  where l.company_id=p_company and l.machine_ref_id is not null and (l.status in ('open','in_progress','recurring') or (m.status in ('breakdown','maintenance') and l.status='resolved'
    and l.id=(select x.id from public.breakdown_logs x where x.company_id=p_company and x.machine_ref_id=l.machine_ref_id order by coalesce(x.start_time,x.created_at) desc,x.id desc limit 1)))
$$;
create function private.capacity_affected(p_company uuid,p_window uuid) returns jsonb language sql stable security definer set search_path=public,private as $$
  select coalesce(jsonb_agg(jsonb_build_object('slot_id',s.id,'job_id',j.id,'job_number',j.job_number,'job_status',j.status,'running',j.status='in_progress','order_id',o.id,
      'order_number',o.order_number,'expected_dispatch_date',o.expected_dispatch_date,'starts_at',s.planned_start_at,'ends_at',s.planned_end_at,'shift',s.shift,'slot_status',s.status,'kg',s.capacity_kg)
      order by s.planned_start_at,s.id),'[]'::jsonb)
  from private.capacity_windows(p_company) w join public.production_plan_slots s on s.company_id=p_company and s.machine_id=w.machine_id and s.status in ('scheduled','released')
    and s.planned_end_at>w.starts_at and (not w.end_known or s.planned_start_at<w.ends_at)
  join public.production_jobs j on j.id=s.production_job_id and j.company_id=s.company_id join public.orders o on o.id=j.order_id and o.company_id=j.company_id
  where w.id=p_window
$$;
revoke all on function private.capacity_windows(uuid),private.capacity_affected(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-033: readiness of a dispatch's quality evidence. A linked file satisfies a requirement only
-- when the document itself is approved; an authorized deviation is shown as such, never as met.
------------------------------------------------------------------------------------------------
create function private.pack_readiness(p_company uuid,p_dispatch uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare d public.dispatches; o public.orders; v_items jsonb:='[]'::jsonb; rec record; v_doc record; v_state text; v_key text; v_waiver text; r public.drawing_revisions; v_ev jsonb;
begin
  select * into d from public.dispatches where id=p_dispatch and company_id=p_company;
  if d.id is null then return null; end if;
  select * into o from public.orders where id=d.order_id and company_id=p_company;
  for rec in select q.id,q.certificate_type,q.description,q.is_mandatory from public.customer_compliance_requirements q
      where q.company_id=p_company and q.customer_id=o.customer_id and q.is_active and q.work_stages && array['quality','dispatch'] order by q.certificate_type,q.id loop
    v_key:='cert:'||rec.id;
    select doc.id,doc.file_name,doc.document_type,doc.version_number,doc.approval_status into v_doc from public.pack_evidence_links l
      join public.technical_documents doc on doc.id=l.document_id and doc.company_id=l.company_id
      where l.company_id=p_company and l.dispatch_id=p_dispatch and l.requirement_id=rec.id
      order by case doc.approval_status when 'approved' then 1 when 'pending' then 2 when 'rejected' then 3 else 4 end,doc.updated_at desc,doc.id limit 1;
    v_state:=case when v_doc.id is null then 'missing' when v_doc.approval_status='approved' then 'satisfied' when v_doc.approval_status='pending' then 'pending'
      when v_doc.approval_status='rejected' then 'rejected' else 'superseded' end;
    v_ev:=case when v_doc.id is null then null else jsonb_build_object('document_id',v_doc.id,'file_name',v_doc.file_name,'document_type',v_doc.document_type,'version',v_doc.version_number,'approval_status',v_doc.approval_status) end;
    select reason into v_waiver from public.pack_waivers where company_id=p_company and dispatch_id=p_dispatch and requirement_key=v_key;
    if v_waiver is not null and v_state<>'satisfied' then v_state:='deviation_authorized'; end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('key',v_key,'kind','certificate','requirement_id',rec.id,'label',rec.certificate_type,'mandatory',rec.is_mandatory,'state',v_state,'evidence',v_ev,'waiver',v_waiver));
    v_waiver:=null;
  end loop;
  for rec in select distinct j.id,j.job_number from public.packing_list_items pl
      left join public.profile_stock_batches b on b.id=pl.profile_stock_batch_id and b.company_id=pl.company_id
      join public.production_jobs j on j.company_id=pl.company_id and j.status<>'cancelled'
        and (j.id=b.production_job_id or (b.production_job_id is null and pl.order_item_id is not null and j.source_line_id=pl.order_item_id))
      where pl.company_id=p_company and pl.dispatch_id=p_dispatch order by j.job_number,j.id loop
    v_key:='inspection:'||rec.id;
    select qi.id,qi.batch_number,qi.quantity_checked_kg,qi.status,qi.inspection_date into v_doc from public.quality_inspections qi where qi.company_id=p_company and qi.production_job_id=rec.id
      order by case qi.status when 'approved' then 1 when 'pending' then 2 else 3 end,qi.inspection_date desc,qi.id limit 1;
    v_state:=case when v_doc.id is null then 'missing' when v_doc.status='approved' then 'satisfied' when v_doc.status='pending' then 'pending' else 'rejected' end;
    select reason into v_waiver from public.pack_waivers where company_id=p_company and dispatch_id=p_dispatch and requirement_key=v_key;
    if v_waiver is not null and v_state<>'satisfied' then v_state:='deviation_authorized'; end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('key',v_key,'kind','inspection','label','Inspection for '||coalesce(rec.job_number,'production job'),'mandatory',true,'state',v_state,
      'evidence',case when v_doc.id is null then null else jsonb_build_object('inspection_id',v_doc.id,'batch_number',v_doc.batch_number,'quantity_checked_kg',v_doc.quantity_checked_kg,'status',v_doc.status) end,'waiver',v_waiver));
    v_waiver:=null;
  end loop;
  for rec in select pl.id,pl.bundle_number from public.packing_list_items pl left join public.profile_stock_batches b on b.id=pl.profile_stock_batch_id and b.company_id=pl.company_id
      where pl.company_id=p_company and pl.dispatch_id=p_dispatch and not exists(select 1 from public.production_jobs j where j.company_id=pl.company_id and j.status<>'cancelled'
        and (j.id=b.production_job_id or (b.production_job_id is null and pl.order_item_id is not null and j.source_line_id=pl.order_item_id))) order by pl.bundle_number,pl.id loop
    v_key:='source:'||rec.id;
    select reason into v_waiver from public.pack_waivers where company_id=p_company and dispatch_id=p_dispatch and requirement_key=v_key;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('key',v_key,'kind','source','label','Source batch for bundle '||rec.bundle_number,'mandatory',true,
      'state',case when v_waiver is null then 'unresolved' else 'deviation_authorized' end,'evidence',null,'waiver',v_waiver));
    v_waiver:=null;
  end loop;
  for rec in select distinct pl.profile_id,p.profile_code from public.packing_list_items pl join public.aluminium_profiles p on p.id=pl.profile_id and p.company_id=pl.company_id
      where pl.company_id=p_company and pl.dispatch_id=p_dispatch order by p.profile_code loop
    r:=private.drawing_released(p_company,rec.profile_id);
    if r.id is null then continue; end if;
    v_key:='drawing:'||rec.profile_id;
    v_state:=case when exists(select 1 from public.packing_list_items pl where pl.company_id=p_company and pl.dispatch_id=p_dispatch and pl.profile_id=rec.profile_id
      and pl.drawing_revision is distinct from r.revision_label) then 'superseded' else 'satisfied' end;
    select reason into v_waiver from public.pack_waivers where company_id=p_company and dispatch_id=p_dispatch and requirement_key=v_key;
    if v_waiver is not null and v_state<>'satisfied' then v_state:='deviation_authorized'; end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('key',v_key,'kind','drawing','label','Drawing revision for '||rec.profile_code,'mandatory',true,'state',v_state,
      'evidence',jsonb_build_object('released_revision',r.revision_label,'file_sha256',r.file_sha256),'waiver',v_waiver));
    v_waiver:=null;
  end loop;
  return jsonb_build_object('items',v_items,'ready',not exists(select 1 from jsonb_array_elements(v_items) x where (x->>'mandatory')::boolean and x->>'state' not in ('satisfied','deviation_authorized')),
    'missing',(select count(*) from jsonb_array_elements(v_items) x where (x->>'mandatory')::boolean and x->>'state' not in ('satisfied','deviation_authorized')),
    'dispatch_number',d.dispatch_number,'order_number',o.order_number,'dispatch_status',d.delivery_status);
end $$;
revoke all on function private.pack_readiness(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-034: the order-line facts a change proposal tracks, and the downstream work they touch.
------------------------------------------------------------------------------------------------
create function private.change_fields() returns text[] language sql immutable set search_path=public,private as $$
  select array['quantity_kg','cut_length','drawing_revision','finishing_type','packing_instruction','pieces_per_bundle']
$$;
create function private.change_line_state(p_company uuid,p_line uuid) returns jsonb language sql stable security definer set search_path=public,private as $$
  select jsonb_build_object('quantity_kg',i.quantity_kg,'cut_length',i.cut_length,'drawing_revision',i.drawing_revision,'finishing_type',i.finishing_type,
    'packing_instruction',i.packing_instruction,'pieces_per_bundle',i.pieces_per_bundle) from public.order_items i where i.id=p_line and i.company_id=p_company
$$;
create function private.change_impacts(p_company uuid,p_line uuid,p_fields text[]) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare i public.order_items; o public.orders; v jsonb:='[]'::jsonb; rec record; v_spec boolean:=p_fields && array['cut_length','drawing_revision','finishing_type','packing_instruction','pieces_per_bundle'];
begin
  select * into i from public.order_items where id=p_line and company_id=p_company;
  select * into o from public.orders where id=i.order_id and company_id=p_company;
  for rec in select j.id,j.job_number,j.status from public.production_jobs j where j.company_id=p_company and j.source_line_id=p_line and j.status<>'cancelled' order by j.created_at,j.id loop
    if rec.status in ('planned','ready') then
      v:=v||jsonb_build_array(jsonb_build_object('domain','production','record_type','production_job','record_id',rec.id,'label',coalesce(rec.job_number,'Production job'),'classification','refresh','owner_role','production_manager',
        'required_action','Unstarted job: refresh it from the revised line after approval (Inherited job facts).'));
    elsif rec.status in ('in_progress','on_hold') then
      v:=v||jsonb_build_array(jsonb_build_object('domain','production','record_type','production_job','record_id',rec.id,'label',coalesce(rec.job_number,'Production job'),'classification','re_review','owner_role','production_manager',
        'required_action','Job already started: decide whether to hold, continue under a deviation or stop.'));
    elsif v_spec then
      v:=v||jsonb_build_array(jsonb_build_object('domain','production','record_type','production_job','record_id',rec.id,'label',coalesce(rec.job_number,'Production job'),'classification','posted_correction','owner_role','production_manager',
        'required_action','Made to the previous specification: rework, re-cut or obtain a customer deviation. The completed job is not rewritten.'));
    end if;
  end loop;
  if v_spec then
    for rec in select f.id,f.status,coalesce(j.job_number,'job') job_number from public.finishing_jobs f join public.production_jobs j on j.id=f.production_job_id and j.company_id=f.company_id
        where f.company_id=p_company and j.source_line_id=p_line and f.status not in ('completed','rejected','not_required') order by f.created_at,f.id loop
      v:=v||jsonb_build_array(jsonb_build_object('domain','finishing','record_type','finishing_job','record_id',rec.id,'label','Finishing for '||rec.job_number,'classification','re_review','owner_role','production_manager',
        'required_action','Finishing in progress: confirm the vendor instruction still applies.'));
    end loop;
    for rec in select qi.id,coalesce(j.job_number,'job') job_number from public.quality_inspections qi join public.production_jobs j on j.id=qi.production_job_id and j.company_id=qi.company_id
        where qi.company_id=p_company and j.source_line_id=p_line and qi.status='approved' order by qi.inspection_date,qi.id loop
      v:=v||jsonb_build_array(jsonb_build_object('domain','quality','record_type','quality_inspection','record_id',rec.id,'label','Approved inspection for '||rec.job_number,'classification','re_review','owner_role','quality',
        'required_action','Inspected against the previous specification: confirm the result still applies or re-inspect. The approved record is not changed.'));
    end loop;
  end if;
  for rec in select pl.id,pl.bundle_number,d.dispatch_number,d.actual_dispatched_at is not null departed from public.packing_list_items pl join public.dispatches d on d.id=pl.dispatch_id and d.company_id=pl.company_id
      where pl.company_id=p_company and pl.order_item_id=p_line order by pl.created_at,pl.id loop
    v:=v||jsonb_build_array(case when rec.departed then jsonb_build_object('domain','dispatch','record_type','packing_list_item','record_id',rec.id,'label','Bundle '||rec.bundle_number||' on '||coalesce(rec.dispatch_number,'dispatch'),
        'classification','posted_correction','owner_role','sales_manager','required_action','Shipped under the previous revision: agree acceptance, return or replacement with the customer. The dispatch is not rewritten.')
      else jsonb_build_object('domain','packing','record_type','packing_list_item','record_id',rec.id,'label','Bundle '||rec.bundle_number||' on '||coalesce(rec.dispatch_number,'dispatch'),
        'classification','re_review','owner_role','dispatch_manager','required_action','Packed, not departed: check whether the bundle must be repacked or replaced.') end);
  end loop;
  for rec in select distinct inv.id,inv.invoice_number from public.invoice_items ii join public.invoices inv on inv.id=ii.invoice_id and inv.company_id=ii.company_id
      where ii.company_id=p_company and ii.order_item_id=p_line and inv.deleted_at is null and inv.status<>'cancelled' order by inv.invoice_number loop
    v:=v||jsonb_build_array(jsonb_build_object('domain','billing','record_type','invoice','record_id',rec.id,'label','Invoice '||coalesce(rec.invoice_number,'issued'),'classification','posted_correction','owner_role','accounts',
      'required_action','Issued invoice is not changed: decide whether a credit or debit note is needed.'));
  end loop;
  if exists(select 1 from public.profile_stock_reservations r where r.company_id=p_company and r.order_id=i.order_id and r.profile_id=i.profile_id and r.status='active') then
    v:=v||jsonb_build_array(jsonb_build_object('domain','inventory','record_type','order','record_id',i.order_id,'label','Stock reserved for this order','classification','refresh','owner_role','inventory_manager',
      'required_action','Check that reserved bundles still match the revised line.'));
  end if;
  if 'quantity_kg'=any(p_fields) then
    v:=v||jsonb_build_array(jsonb_build_object('domain','inventory','record_type','order','record_id',i.order_id,'label','Billet requirement','classification','refresh','owner_role','inventory_manager',
      'required_action','Recheck billet allocation for the revised quantity.'));
  end if;
  v:=v||jsonb_build_array(jsonb_build_object('domain','customer','record_type','order','record_id',i.order_id,'label','Customer commitment for '||o.order_number,'classification','customer','owner_role','sales_manager',
    'required_action','Confirm the revised specification, quantity and delivery promise with the customer. No date is changed automatically.'));
  return v;
end $$;
revoke all on function private.change_fields(),private.change_line_state(uuid,uuid),private.change_impacts(uuid,uuid,text[]) from public,anon,authenticated;

create function private.change_owner_roles(p_owner text) returns text[] language sql immutable set search_path=public,private as $$
  select array['owner','admin','factory_manager']||case p_owner when 'production_manager' then array['production_manager'] when 'quality' then array['quality']
    when 'dispatch_manager' then array['dispatch_manager','dispatch'] when 'accounts' then array['accounts'] when 'inventory_manager' then array['inventory_manager']
    when 'sales_manager' then array['sales_manager','sales'] else array[]::text[] end
$$;
revoke all on function private.change_owner_roles(text) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Read models for every view in this batch.
------------------------------------------------------------------------------------------------
create function private.assurance_rows(p_company uuid,p_actor uuid,p_role text,p_view text,p_state text,p_id uuid default null)
returns table(row_data jsonb,sort_rank integer,sort_due date,sort_new timestamptz) language plpgsql stable security definer set search_path=public,private as $$
declare v_today date:=private.ist_today();
begin
  if p_view='drawings' then
    return query select jsonb_build_object('id',r.id,'label',concat(td.drawing_number,' rev ',r.revision_label,' · ',td.title),'status',st.state,'owner',ru.full_name,'due_date',null,
        'summary',concat(case st.state when 'registered' then 'Registered; not yet sent to the customer' when 'submitted' then 'Sent to the customer; awaiting response'
          when 'customer_query' then 'Customer raised a technical query' when 'customer_approved' then 'Customer approved; awaiting release for manufacture'
          when 'customer_rejected' then 'Customer rejected; a new revision is needed' when 'released' then 'Released for manufacture' when 'superseded' then 'Superseded by a later release'
          else 'Withdrawn' end,case when aff.n>0 then concat('; ',aff.n,' unfinished job(s) carry another revision') else '' end),
        'source_href','/documents/intelligence','details',jsonb_build_object('drawing_id',td.id,'drawing_number',td.drawing_number,'title',td.title,'revision_label',r.revision_label,
          'file_sha256',r.file_sha256,'file_name',r.file_name,'technical_note',r.technical_note,'profile_id',r.profile_id,'profile_code',p.profile_code,
          'customer_approval_required',r.customer_approval_required,'registered_at',r.registered_at,'released_revision',rel.revision_label,'affected_count',aff.n,
          'events',(select coalesce(jsonb_agg(jsonb_build_object('event',e.event,'evidence',e.evidence,'customer_contact',e.customer_contact,'valid_until',e.valid_until,
              'job_number',dj.job_number,'by',coalesce(eu.full_name,'System'),'at',e.recorded_at) order by e.recorded_at desc,e.id desc),'[]'::jsonb)
            from (select * from public.drawing_revision_events x where x.company_id=p_company and x.revision_id=r.id order by x.recorded_at desc,x.id desc limit 20) e
            left join public.app_users eu on eu.id=e.recorded_by left join public.production_jobs dj on dj.id=e.deviation_job_id),
          'previous',(select jsonb_build_object('revision_label',pr.revision_label,'file_sha256',pr.file_sha256,'file_name',pr.file_name,'technical_note',pr.technical_note)
            from public.drawing_revisions pr where pr.id=r.supersedes_id and pr.company_id=p_company),
          'affected_jobs',(select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'job_number',j.job_number,'status',j.status,'revision',j.drawing_revision) order by j.planned_date nulls last,j.id),'[]'::jsonb)
            from (select * from public.production_jobs x where st.state='released' and x.company_id=p_company and x.profile_id=r.profile_id and x.status in ('planned','ready','on_hold','in_progress')
              and x.drawing_revision is distinct from r.revision_label order by x.planned_date nulls last,x.id limit 25) j),
          'affected_lines',(select count(*) from public.order_items i join public.orders o on o.id=i.order_id and o.company_id=i.company_id where st.state='released' and i.company_id=p_company
            and i.profile_id=r.profile_id and o.deleted_at is null and o.current_stage not in ('closed','cancelled','delivered') and i.drawing_revision is distinct from r.revision_label))),
      case st.state when 'customer_query' then 0 when 'submitted' then 1 when 'customer_approved' then 1 when 'registered' then 2 when 'released' then case when aff.n>0 then 0 else 4 end else 5 end,
      null::date,r.registered_at
    from public.drawing_revisions r join public.technical_drawings td on td.id=r.drawing_id and td.company_id=r.company_id
    cross join lateral (select private.drawing_state(p_company,r.id) state) st
    left join public.aluminium_profiles p on p.id=r.profile_id and p.company_id=r.company_id left join public.app_users ru on ru.id=r.registered_by
    left join lateral (select x.revision_label from private.drawing_released(p_company,r.profile_id) x where r.profile_id is not null) rel on true
    left join lateral (select count(*)::integer n from public.production_jobs j where st.state='released' and j.company_id=p_company and j.profile_id=r.profile_id
      and j.status in ('planned','ready','on_hold','in_progress') and j.drawing_revision is distinct from r.revision_label) aff on true
    where r.company_id=p_company and (p_id is null or r.id=p_id) and (p_id is not null or p_state='all' or st.state not in ('superseded','withdrawn','customer_rejected'));
  elsif p_view='incoming' then
    return query select jsonb_build_object('id',l.id,'label',concat(po.po_number,' line ',pol.line_number,' · ',left(pol.description,60)),'status',s.st,'owner',po.vendor_name_snapshot,
        'due_date',pr.receipt_date,'summary',concat(trim_scale(l.received_quantity),' ',pol.unit,' received; ',trim_scale((b->>'pending_qc')::numeric),' awaiting quality decision; ',
          trim_scale((b->>'releasable')::numeric),' accepted and not yet released; ',trim_scale((b->>'awaiting_return')::numeric),' rejected awaiting return'),
        'source_href','/vendors/purchasing','details',b||jsonb_build_object('po_number',po.po_number,'line_number',pol.line_number,'description',pol.description,'specification',pol.specification,
          'vendor',po.vendor_name_snapshot,'receipt_date',pr.receipt_date,'receipt_reference',pr.reference,'age_days',v_today-pr.receipt_date,
          'dispositions',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'disposition',d.disposition,'quantity',d.quantity,'certificate_ref',d.certificate_ref,'evidence',d.evidence,
              'by',du.full_name,'role',d.decided_role,'at',d.decided_at,'reversed',d.reversed_at is not null,'reverse_note',d.reverse_note) order by d.decided_at,d.id),'[]'::jsonb)
            from public.incoming_dispositions d left join public.app_users du on du.id=d.decided_by where d.company_id=p_company and d.receipt_line_id=l.id),
          'releases',(select coalesce(jsonb_agg(jsonb_build_object('batch_number',bb.batch_number,'kg',sr.quantity_kg,'at',sr.released_at) order by sr.released_at,sr.id),'[]'::jsonb)
            from public.incoming_stock_releases sr join public.billet_batches bb on bb.id=sr.billet_batch_id where sr.company_id=p_company and sr.receipt_line_id=l.id))),
      case s.st when 'awaiting_decision' then 0 when 'awaiting_release' then 1 when 'awaiting_return' then 2 else 3 end,pr.receipt_date,l.created_at
    from public.purchase_receipt_lines l join public.purchase_receipts pr on pr.id=l.receipt_id and pr.company_id=l.company_id
    join public.purchase_order_lines pol on pol.id=l.purchase_order_line_id and pol.company_id=l.company_id join public.purchase_orders po on po.id=l.purchase_order_id and po.company_id=l.company_id
    cross join lateral private.incoming_balance(p_company,l.id) b
    cross join lateral (select case when (b->>'pending_qc')::numeric>0.0005 then 'awaiting_decision' when (b->>'releasable')::numeric>0.0005 then 'awaiting_release'
      when (b->>'awaiting_return')::numeric>0.0005 then 'awaiting_return' else 'complete' end st) s
    where l.company_id=p_company and (p_id is null or l.id=p_id) and (p_id is not null or p_state='all' or s.st<>'complete');
  elsif p_view='deliveries' then
    return query select jsonb_build_object('id',d.id,'label',concat(coalesce(d.dispatch_number,'Dispatch'),' · ',o.order_number),'status',s.st,'owner',c.customer_name,'due_date',d.dispatch_date,
        'summary',concat(trim_scale((b->>'shipped_kg')::numeric),' kg shipped; ',trim_scale((b->>'accepted_kg')::numeric),' kg accepted; ',
          trim_scale((b->>'refused_kg')::numeric+(b->>'damaged_kg')::numeric+(b->>'short_kg')::numeric),' kg refused, damaged or reported short; ',
          trim_scale((b->>'undisposed_kg')::numeric),' kg not yet confirmed'),
        'source_href','/dispatches/'||d.id,'details',b||jsonb_build_object('dispatch_number',d.dispatch_number,'order_number',o.order_number,'customer',c.customer_name,
          'delivery_status',d.delivery_status,'departed_at',d.actual_dispatched_at,'delivered_at',d.delivered_at,'proof_of_delivery_recorded',d.proof_of_delivery_url is not null)),
      case s.st when 'open_exceptions' then 0 when 'partly_confirmed' then 1 when 'awaiting_confirmation' then 2 else 3 end,d.dispatch_date,d.actual_dispatched_at
    from public.dispatches d join public.orders o on o.id=d.order_id and o.company_id=d.company_id left join public.customers c on c.id=o.customer_id and c.company_id=o.company_id
    cross join lateral private.delivery_balance(p_company,d.id) b
    cross join lateral (select case when (b->>'open_exceptions')::integer>0 then 'open_exceptions' when (b->>'undisposed_kg')::numeric>0.0005 then
      case when (b->>'shipped_kg')::numeric-(b->>'undisposed_kg')::numeric>0.0005 then 'partly_confirmed' else 'awaiting_confirmation' end else 'confirmed' end st) s
    where d.company_id=p_company and d.actual_dispatched_at is not null and o.deleted_at is null and (p_id is not null or p_state='all' or d.dispatch_date>=v_today-120) and jsonb_array_length(b->'bundles')>0
      and (p_id is null or d.id=p_id) and (p_id is not null or p_state='all' or s.st<>'confirmed');
  elsif p_view='revisions' then
    return query select jsonb_build_object('id',cp.id,'label',concat(o.order_number,' · ',coalesce(nullif(i.item_description,''),nullif(i.section_name,''),'Order line')),'status',cp.status,
        'owner',pu.full_name,'due_date',o.expected_dispatch_date,
        'summary',concat((select count(*) from jsonb_object_keys(cp.changes)),' change(s) proposed; ',x.open_count,' open impact action(s)',
          case when cp.status in ('assessed','approved') and x.stale then '; the line changed after assessment' else '' end,case when x.applied then '; line now carries the proposed values' else '' end),
        'source_href','/orders/'||o.id,'details',jsonb_build_object('order_id',o.id,'order_number',o.order_number,'order_item_id',i.id,'changes',cp.changes,'reason',cp.reason,
          'proposed_by',pu.full_name,'proposed_at',cp.proposed_at,'decided_by',du.full_name,'decided_at',cp.decided_at,'decision_note',cp.decision_note,'stale',x.stale,'line_updated',x.applied,
          'open_impacts',x.open_count,'you_proposed',cp.proposed_by=p_actor,
          'impacts',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'domain',m.domain,'label',m.label,'classification',m.classification,'owner_role',m.owner_role,
              'required_action',m.required_action,'status',m.status,'resolution_note',m.resolution_note,'resolved_by',mu.full_name,'resolved_at',m.resolved_at,
              'you_can_resolve',p_role=any(private.change_owner_roles(m.owner_role))) order by case m.status when 'open' then 0 else 1 end,m.domain,m.label,m.id),'[]'::jsonb)
            from public.order_change_impacts m left join public.app_users mu on mu.id=m.resolved_by where m.company_id=p_company and m.proposal_id=cp.id))),
      case cp.status when 'assessed' then 0 when 'approved' then 1 else 2 end,o.expected_dispatch_date,cp.proposed_at
    from public.order_change_proposals cp join public.orders o on o.id=cp.order_id and o.company_id=cp.company_id
    join public.order_items i on i.id=cp.order_item_id and i.company_id=cp.company_id
    left join public.app_users pu on pu.id=cp.proposed_by left join public.app_users du on du.id=cp.decided_by
    cross join lateral (select cp.line_fingerprint<>md5(private.change_line_state(p_company,cp.order_item_id)::text) stale,
      coalesce((select bool_and((private.change_line_state(p_company,cp.order_item_id)->k) is not distinct from (cp.changes->k->'to')) from jsonb_object_keys(cp.changes) k),false) applied,
      (select count(*)::integer from public.order_change_impacts m where m.company_id=p_company and m.proposal_id=cp.id and m.status='open') open_count) x
    where cp.company_id=p_company and (p_id is null or cp.id=p_id) and (p_id is not null or p_state='all' or cp.status in ('assessed','approved'));
  elsif p_view='capability' then
    return query select jsonb_build_object('id',c.id,'label',concat(c.code,' · ',c.name),'status',s.st,'owner',null,'due_date',h.next_expiry,
        'summary',concat(h.independent,' independent, ',h.supervised,' supervised, ',h.trained,' trained',case when h.requal>0 then concat('; ',h.requal,' need requalification') else '' end,
          case when h.expiring>0 then concat('; ',h.expiring,' expire within 30 days') else '' end),
        'source_href','/tasks/competencies','details',jsonb_build_object('code',c.code,'name',c.name,'procedure_title',op.title,'validity_months',c.validity_months,
          'independent_count',h.independent,'supervised_count',h.supervised,'trained_count',h.trained,'requalification_count',h.requal,'expiring_count',h.expiring,
          'required_for',(select coalesce(jsonb_agg(q.action order by q.action),'[]'::jsonb) from public.competency_requirements q where q.company_id=p_company and q.competency_id=c.id),
          'criteria',(select jsonb_build_object('supervised_required',qc.supervised_required,'observed_trial_required',qc.observed_trial_required,'revision',qc.revision)
            from public.qualification_criteria qc where qc.company_id=p_company and qc.competency_id=c.id),
          'holders',h.holders,
          'assessments',(select coalesce(jsonb_agg(jsonb_build_object('employee',eu.full_name,'assessor',au.full_name,'outcome',qa.outcome,'evidence',qa.evidence,'at',qa.assessed_at) order by qa.assessed_at desc),'[]'::jsonb)
            from (select * from public.qualification_assessments z where z.company_id=p_company and z.competency_id=c.id order by z.assessed_at desc limit 10) qa
            left join public.app_users eu on eu.id=qa.employee_id left join public.app_users au on au.id=qa.assessor_id))),
      case s.st when 'no_cover' then 0 when 'single_cover' then 1 when 'requalification_due' then 2 else 3 end,h.next_expiry,c.created_at
    from public.competencies c left join public.operating_procedures op on op.id=c.procedure_id and op.company_id=c.company_id
    cross join lateral (select count(*) filter(where g.effective='independent')::integer independent,count(*) filter(where g.effective='supervised')::integer supervised,
        count(*) filter(where g.effective='trained')::integer trained,count(*) filter(where g.reason='procedure_revised')::integer requal,
        count(*) filter(where g.expires_at is not null and g.expires_at<=now()+interval '30 days' and g.expires_at>now())::integer expiring,
        min((g.expires_at at time zone 'Asia/Kolkata')::date) filter(where g.expires_at>now()) next_expiry,
        coalesce(jsonb_agg(jsonb_build_object('employee_id',g.employee_id,'name',g.full_name,'level',g.level,'effective',g.effective,'reason',g.reason,'expires_at',g.expires_at)
          order by g.full_name,g.employee_id) filter(where g.employee_id is not null),'[]'::jsonb) holders
      from (select e.employee_id,u.full_name,e.level,e.expires_at,st->>'effective' effective,st->>'reason' reason from public.employee_competencies e
        join public.app_users u on u.id=e.employee_id and u.company_id=e.company_id and u.is_active
        cross join lateral private.competency_standing(e.employee_id,e.competency_id) st
        where e.company_id=p_company and e.competency_id=c.id and e.revoked_at is null) g) h
    cross join lateral (select case when h.independent=0 then 'no_cover' when h.independent=1 then 'single_cover' when h.requal>0 or h.expiring>0 then 'requalification_due' else 'covered' end st) s
    where c.company_id=p_company and (p_id is null or c.id=p_id) and (p_id is not null or (c.is_active and (p_state='all' or s.st<>'covered')));
  elsif p_view='instruments' then
    return query select jsonb_build_object('id',mi.id,'label',concat(mi.code,' · ',mi.name),'status',s.st,'owner',mi.location,'due_date',(ev->>'valid_until')::date,
        'summary',concat(trim_scale(mi.range_min),' to ',trim_scale(mi.range_max),' ',mi.unit,'; evidence ',replace(ev->>'state','_',' '),
          case when ev->>'valid_until' is not null then concat(' until ',to_char((ev->>'valid_until')::date,'DD Mon YYYY')) else '' end,
          case when x.open_reviews>0 then concat('; ',x.open_reviews,' impact review(s) open') else '' end),
        'source_href',null,'details',jsonb_build_object('code',mi.code,'name',mi.name,'unit',mi.unit,'range_min',mi.range_min,'range_max',mi.range_max,'location',mi.location,
          'instrument_status',mi.status,'withdrawn_reason',mi.withdrawn_reason,'evidence_state',ev->>'state','valid_until',ev->'valid_until','certificate_ref',ev->'certificate_ref',
          'bound_results',x.bound,'open_reviews',x.open_reviews,'policy_mode',coalesce((select mode from public.instrument_policies where company_id=p_company),'warn'),
          'checks',(select coalesce(jsonb_agg(jsonb_build_object('checked_on',k.checked_on,'valid_until',k.valid_until,'result',k.result,'certificate_ref',k.certificate_ref,'note',k.note) order by k.checked_on desc,k.recorded_at desc),'[]'::jsonb)
            from (select * from public.instrument_checks z where z.company_id=p_company and z.instrument_id=mi.id order by z.checked_on desc,z.recorded_at desc limit 10) k),
          'reviews',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'trigger',v.trigger,'window_from',v.window_from,'window_to',v.window_to,'affected',v.affected,'status',v.status,
              'review_note',v.review_note,'reviewed_at',v.reviewed_at) order by v.created_at desc),'[]'::jsonb)
            from (select * from public.instrument_impact_reviews z where z.company_id=p_company and z.instrument_id=mi.id order by z.created_at desc limit 5) v))),
      case s.st when 'impact_review' then 0 when 'failed' then 1 when 'expired' then 1 when 'no_evidence' then 2 when 'due_soon' then 3 else 4 end,(ev->>'valid_until')::date,mi.registered_at
    from public.measuring_instruments mi cross join lateral private.instrument_evidence(p_company,mi.id,now()) ev
    cross join lateral (select (select count(*)::integer from public.instrument_result_bindings b where b.company_id=p_company and b.instrument_id=mi.id) bound,
      (select count(*)::integer from public.instrument_impact_reviews v where v.company_id=p_company and v.instrument_id=mi.id and v.status='open') open_reviews) x
    cross join lateral (select case when x.open_reviews>0 then 'impact_review' when mi.status='withdrawn' then 'withdrawn' when ev->>'state'='failed' then 'failed'
      when ev->>'state'='expired' then 'expired' when ev->>'state'='missing' then 'no_evidence' when (ev->>'valid_until')::date<=v_today+14 then 'due_soon' else 'valid' end st) s
    where mi.company_id=p_company and (p_id is null or mi.id=p_id) and (p_id is not null or p_state='all' or s.st not in ('valid','withdrawn'));
  elsif p_view='capacity' then
    return query select jsonb_build_object('id',w.id,'label',concat(m.machine_name,' · ',case w.kind when 'maintenance' then 'planned maintenance' else 'breakdown' end),'status',s.st,'owner',null,
        'due_date',(w.starts_at at time zone 'Asia/Kolkata')::date,
        'summary',concat('From ',to_char(w.starts_at at time zone 'Asia/Kolkata','DD Mon HH24:MI'),case when w.end_known then concat(' to ',to_char(w.ends_at at time zone 'Asia/Kolkata','DD Mon HH24:MI'))
          else ', end not confirmed' end,'; ',x.movable,' slot(s) to replan; ',x.running,' running; ',x.unreviewed,' order promise(s) to review'),
        'source_href','/production/capacity','details',jsonb_build_object('kind',w.kind,'machine_id',w.machine_id,'machine',m.machine_name,'machine_status',m.status,'starts_at',w.starts_at,
          'ends_at',w.ends_at,'end_known',w.end_known,'estimated_end',case when w.end_known then null else w.ends_at end,'reason',w.reason,'source_status',w.source_status,'affected',a.aff,'orders',x.orders,
          'reschedules',(select coalesce(jsonb_agg(jsonb_build_object('action',cr.action,'previous',cr.previous,'next',cr.next,'reason',cr.reason,'by',ru.full_name,'at',cr.applied_at) order by cr.applied_at desc),'[]'::jsonb)
            from (select * from public.capacity_reschedules z where z.company_id=p_company and z.unavailability_id=w.id order by z.applied_at desc limit 10) cr left join public.app_users ru on ru.id=cr.applied_by))),
      case s.st when 'replan_needed' then 0 when 'running_affected' then 1 when 'promises_to_review' then 2 else 3 end,(w.starts_at at time zone 'Asia/Kolkata')::date,w.starts_at
    from private.capacity_windows(p_company) w join public.machines m on m.id=w.machine_id and m.company_id=p_company
    cross join lateral (select private.capacity_affected(p_company,w.id) aff) a
    cross join lateral (select (select count(*)::integer from jsonb_array_elements(a.aff) e where not (e->>'running')::boolean) movable,
        (select count(*)::integer from jsonb_array_elements(a.aff) e where (e->>'running')::boolean) running,
        (select count(*)::integer from (select distinct ord from (select (e->>'order_id')::uuid ord from jsonb_array_elements(a.aff) e
          union select j.order_id from public.capacity_reschedules cr join public.production_plan_slots ps on ps.id=cr.slot_id join public.production_jobs j on j.id=ps.production_job_id
          where cr.company_id=p_company and cr.unavailability_id=w.id) u where not exists(select 1 from public.capacity_commitment_reviews rv where rv.company_id=p_company and rv.order_id=u.ord and rv.unavailability_id=w.id)) z) unreviewed,
        (select coalesce(jsonb_agg(jsonb_build_object('order_id',oo.id,'order_number',oo.order_number,'expected_dispatch_date',oo.expected_dispatch_date,'decision',rv.decision,'note',rv.note) order by oo.expected_dispatch_date nulls last,oo.id),'[]'::jsonb)
          from public.orders oo left join public.capacity_commitment_reviews rv on rv.company_id=p_company and rv.order_id=oo.id and rv.unavailability_id=w.id
          where oo.company_id=p_company and oo.id in (select (e->>'order_id')::uuid from jsonb_array_elements(a.aff) e union select j.order_id from public.capacity_reschedules cr
            join public.production_plan_slots ps on ps.id=cr.slot_id join public.production_jobs j on j.id=ps.production_job_id where cr.company_id=p_company and cr.unavailability_id=w.id)) orders) x
    cross join lateral (select case when x.movable>0 then 'replan_needed' when x.running>0 then 'running_affected' when x.unreviewed>0 then 'promises_to_review' else 'clear' end st) s
    where (p_id is null or w.id=p_id) and (p_id is not null or p_state='all' or s.st<>'clear');
  elsif p_view='counts' then
    return query select jsonb_build_object('id',cc.id,'label',concat('Cycle count · ',cc.location),'status',s.st,'owner',ou.full_name,'due_date',(cc.cutoff_at at time zone 'Asia/Kolkata')::date,
        'summary',concat(x.total,' line(s): ',x.pending,' to count, ',x.review,' to review, ',x.recount,' to recount, ',x.done,' resolved'),
        'source_href','/inventory','details',jsonb_build_object('location',cc.location,'blind',cc.blind,'cutoff_at',cc.cutoff_at,'count_status',cc.status,'closure_note',cc.closure_note,
          'expected_hidden',x.hide,'total',x.total,'pending',x.pending,'review',x.review,'recount',x.recount,'resolved',x.done,
          'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',cl.id,'label',coalesce(cl.unlisted_label,concat(coalesce(cl.batch_snapshot->>'bundle_number','Bundle'),' · ',cl.batch_snapshot->>'profile_code')),
              'unlisted',cl.unlisted_label is not null,'status',cl.status,'expected_pieces',case when x.hide then null else cl.expected_pieces end,'expected_kg',case when x.hide then null else cl.expected_kg end,
              'review_note',cl.review_note,
              'observations',(select coalesce(jsonb_agg(jsonb_build_object('round',ob.round,'pieces',ob.counted_pieces,'kg',ob.counted_kg,'by',bu.full_name,'at',ob.counted_at) order by ob.round),'[]'::jsonb)
                from public.cycle_count_observations ob left join public.app_users bu on bu.id=ob.counted_by where ob.company_id=p_company and ob.line_id=cl.id),
              'adjustment',(select jsonb_build_object('before',ad.before_state,'after',ad.after_state) from public.cycle_count_adjustments ad where ad.line_id=cl.id))
              order by case cl.status when 'pending' then 0 when 'recount' then 1 when 'difference' then 2 when 'moved' then 3 when 'unlisted' then 4 else 5 end,cl.batch_snapshot->>'bundle_number',cl.id),'[]'::jsonb)
            from public.cycle_count_lines cl where cl.company_id=p_company and cl.count_id=cc.id))),
      case s.st when 'review' then 0 when 'recount' then 1 when 'counting' then 2 when 'ready_to_close' then 3 else 4 end,(cc.cutoff_at at time zone 'Asia/Kolkata')::date,cc.cutoff_at
    from public.cycle_counts cc left join public.app_users ou on ou.id=cc.opened_by
    cross join lateral (select count(*)::integer total,count(*) filter(where l.status='pending')::integer pending,
        count(*) filter(where l.status in ('difference','moved','unlisted'))::integer review,count(*) filter(where l.status='recount')::integer recount,
        count(*) filter(where l.status in ('matched','adjusted','accepted','no_change','not_counted'))::integer done,
        cc.blind and cc.status='open' and p_role not in ('owner','admin','factory_manager','accounts') hide
      from public.cycle_count_lines l where l.company_id=p_company and l.count_id=cc.id) x
    cross join lateral (select case when cc.status='closed' then 'closed' when x.review>0 then 'review' when x.recount>0 then 'recount' when x.pending>0 then 'counting' else 'ready_to_close' end st) s
    where cc.company_id=p_company and (p_id is null or cc.id=p_id) and (p_id is not null or p_state='all' or cc.status='open');
  elsif p_view='packs' then
    return query select jsonb_build_object('id',d.id,'label',concat(coalesce(d.dispatch_number,'Dispatch'),' · ',o.order_number),'status',s.st,'owner',c.customer_name,'due_date',d.dispatch_date,
        'summary',concat((rd->>'missing'),' mandatory requirement(s) outstanding',case when qp.version is not null then concat('; pack version ',qp.version,' issued') else '' end),
        'source_href','/dispatches/'||d.id,'details',rd||jsonb_build_object('customer',c.customer_name,'current_version',qp.version,'issued_at',qp.issued_at,
          'issues',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'version',q.version,'status',q.status,'issued_at',q.issued_at,'withdraw_note',q.withdraw_note,'manifest',q.manifest) order by q.version desc),'[]'::jsonb)
            from (select * from public.quality_pack_issues z where z.company_id=p_company and z.dispatch_id=d.id order by z.version desc limit 10) q))),
      case s.st when 'issued_out_of_date' then 0 when 'not_ready' then 1 when 'ready' then 2 else 3 end,d.dispatch_date,d.created_at
    from public.dispatches d join public.orders o on o.id=d.order_id and o.company_id=d.company_id left join public.customers c on c.id=o.customer_id and c.company_id=o.company_id
    cross join lateral private.pack_readiness(p_company,d.id) rd
    left join public.quality_pack_issues qp on qp.company_id=p_company and qp.dispatch_id=d.id and qp.status='issued'
    cross join lateral (select case when qp.id is not null and not (rd->>'ready')::boolean then 'issued_out_of_date' when qp.id is not null then 'issued'
      when (rd->>'ready')::boolean then 'ready' else 'not_ready' end st) s
    where d.company_id=p_company and o.deleted_at is null and (p_id is not null or p_state='all' or d.dispatch_date>=v_today-120) and exists(select 1 from public.packing_list_items pl where pl.company_id=p_company and pl.dispatch_id=d.id)
      and (p_id is null or d.id=p_id) and (p_id is not null or p_state='all' or s.st<>'issued');
  elsif p_view='returns' then
    return query select jsonb_build_object('id',a.id,'label',concat(coalesce(d.dispatch_number,'Dispatch'),' · bundle ',pl.bundle_number,' · ',o.order_number),'status',s.st,'owner',au.full_name,
        'due_date',(a.authorized_at at time zone 'Asia/Kolkata')::date,
        'summary',concat(trim_scale(a.expected_kg),' kg authorized for ',replace(a.response,'_',' '),'; ',trim_scale((b->>'received_kg')::numeric),' kg received; ',
          trim_scale((b->>'resolved_kg')::numeric),' kg resolved; ',trim_scale((b->>'owed_kg')::numeric),' kg still owed'),
        'source_href','/dispatches/'||d.id,'details',b||jsonb_build_object('response',a.response,'reason',a.reason,'dispatch_id',d.id,'dispatch_number',d.dispatch_number,
          'bundle_number',pl.bundle_number,'shipped_kg',private.packing_net_kg(pl),'order_number',o.order_number,'customer',c.customer_name,'closure_note',a.closure_note,'closed_at',a.closed_at,
          'from_delivery_exception',a.source_disposition_id is not null,
          'links',(select coalesce(jsonb_agg(jsonb_build_object('link_type',k.link_type,'target_id',k.target_id,'kg',k.quantity_kg,'at',k.linked_at) order by k.linked_at),'[]'::jsonb)
            from public.return_resolution_links k where k.company_id=p_company and k.authorization_id=a.id),
          'receipts',(select coalesce(jsonb_agg(jsonb_build_object('kg',rr.received_kg,'status',rr.status,'disposition',rr.disposition,'received_at',rr.received_at) order by rr.received_at),'[]'::jsonb)
            from public.connected_return_receipts rr where rr.company_id=p_company and rr.packing_list_item_id=a.packing_list_item_id))),
      case s.st when 'awaiting_inspection' then 0 when 'awaiting_resolution' then 1 when 'awaiting_decision' then 1 when 'awaiting_receipt' then 2 when 'ready_to_close' then 2 else 3 end,
      (a.authorized_at at time zone 'Asia/Kolkata')::date,a.authorized_at
    from public.return_authorizations a join public.dispatches d on d.id=a.dispatch_id and d.company_id=a.company_id
    join public.packing_list_items pl on pl.id=a.packing_list_item_id and pl.company_id=a.company_id join public.orders o on o.id=a.order_id and o.company_id=a.company_id
    left join public.customers c on c.id=o.customer_id and c.company_id=o.company_id left join public.app_users au on au.id=a.authorized_by
    cross join lateral private.return_balance(p_company,a.id) b
    cross join lateral (select case when a.status='rejected' then 'rejected' when a.status='closed' then 'closed' when (b->>'undisposed_receipts')::integer>0 then 'awaiting_inspection'
      when a.response='claim_review' then 'awaiting_decision'
      when a.response in ('credit','rework_return') and (b->>'received_kg')::numeric<a.expected_kg-0.0005 then 'awaiting_receipt'
      when (b->>'owed_kg')::numeric>0.0005 then 'awaiting_resolution' else 'ready_to_close' end st) s
    where a.company_id=p_company and (p_id is null or a.id=p_id) and (p_id is not null or p_state='all' or a.status='authorized');
  end if;
end $$;
revoke all on function private.assurance_rows(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Reviewed actions: one shape check, one authorized context shared by preview and commitment.
------------------------------------------------------------------------------------------------
create function private.assurance_assert_shape(p_mutation jsonb) returns void language plpgsql set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_keys text[]; v_optional text[]:='{}'; n text:=btrim(coalesce(p_mutation->>'note',''));
begin
  v_keys:=case a when 'drawing.register' then array['drawing_id','revision_label','file_sha256','customer_approval_required'] when 'drawing.customer' then array['revision_id','event','evidence']
    when 'drawing.release' then array['revision_id'] when 'drawing.deviation' then array['revision_id','job_id','valid_until','evidence'] when 'drawing.withdraw' then array['revision_id']
    when 'incoming.dispose' then array['receipt_line_id','disposition','quantity','evidence'] when 'incoming.return' then array['receipt_line_id','quantity','evidence']
    when 'incoming.release' then array['receipt_line_id','quantity_kg','batch_number','alloy','temper'] when 'incoming.reverse' then array['id']
    when 'delivery.record' then array['packing_item_id','disposition','quantity_kg','receiver_name','evidence'] when 'delivery.resolve' then array['id','resolution'] when 'delivery.reverse' then array['id']
    when 'change.propose' then array['order_item_id','changes'] when 'change.decide' then array['id','decision'] when 'change.resolve' then array['id','outcome']
    when 'capability.criteria' then array['competency_id','supervised_required','observed_trial_required'] when 'capability.assess' then array['employee_id','competency_id','outcome']
    when 'instrument.register' then array['code','name','unit','range_min','range_max'] when 'instrument.check' then array['instrument_id','checked_on','valid_until','result','certificate_ref']
    when 'instrument.withdraw' then array['instrument_id'] when 'instrument.bind' then array['result_id','instrument_id'] when 'instrument.policy' then array['mode'] when 'instrument.review' then array['id']
    when 'capacity.move' then array['slot_id','unavailability_id','machine_id','start_at','end_at','shift'] when 'capacity.unplan' then array['slot_id','unavailability_id']
    when 'capacity.review' then array['order_id','unavailability_id','decision']
    when 'count.open' then array['location','blind'] when 'count.record' then array['count_id','counted_pieces'] when 'count.review' then array['line_id','decision'] when 'count.close' then array['count_id']
    when 'pack.link' then array['dispatch_id','requirement_id','document_id'] when 'pack.waive' then array['dispatch_id','requirement_key'] when 'pack.issue' then array['dispatch_id'] when 'pack.withdraw' then array['id']
    when 'return.authorize' then array['packing_item_id','expected_kg','response'] when 'return.link' then array['id','link_type','target_id'] when 'return.close' then array['id'] when 'return.reject' then array['id'] end;
  v_optional:=case a when 'drawing.register' then array['profile_id','file_name','technical_note'] when 'drawing.customer' then array['customer_contact']
    when 'incoming.dispose' then array['certificate_ref'] when 'incoming.release' then array['diameter_mm','heat_number'] when 'delivery.resolve' then array['response']
    when 'instrument.register' then array['location'] when 'count.record' then array['line_id','unlisted_label','counted_kg'] when 'return.link' then array['quantity_kg'] else '{}'::text[] end;
  if jsonb_typeof(p_mutation) is distinct from 'object' or v_keys is null or not(p_mutation ?& (v_keys||array['action','note']))
    or exists(select 1 from jsonb_object_keys(p_mutation) k where not(k=any(v_keys||v_optional||array['action','note'])))
    or length(n) not between 5 and 500 or n ~ '[[:cntrl:]]'
    or exists(select 1 from jsonb_each(p_mutation) x where jsonb_typeof(x.value)='null') then raise exception 'NOV: Review the required action details.'; end if;
end $$;
revoke all on function private.assurance_assert_shape(jsonb) from public,anon,authenticated;

create function private.assurance_number(p_mutation jsonb,p_key text,p_min numeric,p_max numeric,p_scale integer) returns numeric language plpgsql immutable set search_path=public,private as $$
declare v numeric;
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'number' then raise exception 'NOV: Enter a number for %.',replace(p_key,'_',' '); end if;
  v:=(p_mutation->>p_key)::numeric;
  if v<p_min or v>p_max or v<>round(v,p_scale) then raise exception 'NOV: % must be between % and % with at most % decimals.',initcap(replace(p_key,'_',' ')),trim_scale(p_min),trim_scale(p_max),p_scale; end if;
  return v;
end $$;
create function private.assurance_text(p_mutation jsonb,p_key text,p_min integer,p_max integer) returns text language plpgsql immutable set search_path=public,private as $$
declare v text;
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'string' then raise exception 'NOV: Enter the %.',replace(p_key,'_',' '); end if;
  v:=btrim(p_mutation->>p_key);
  if length(v) not between p_min and p_max or v ~ '[[:cntrl:]]' then raise exception 'NOV: % must be % to % characters.',initcap(replace(p_key,'_',' ')),p_min,p_max; end if;
  return v;
end $$;
create function private.assurance_date(p_mutation jsonb,p_key text) returns date language plpgsql immutable set search_path=public,private as $$
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'string' or (p_mutation->>p_key) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'NOV: Choose a valid % date.',replace(p_key,'_',' '); end if;
  return (p_mutation->>p_key)::date;
exception when datetime_field_overflow or invalid_datetime_format then raise exception 'NOV: Choose a valid % date.',replace(p_key,'_',' ');
end $$;
create function private.assurance_instant(p_mutation jsonb,p_key text) returns timestamptz language plpgsql stable set search_path=public,private as $$
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'string' or (p_mutation->>p_key) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'NOV: Choose a valid % time.',replace(p_key,'_',' '); end if;
  return (p_mutation->>p_key)::timestamptz;
exception when datetime_field_overflow or invalid_datetime_format then raise exception 'NOV: Choose a valid % time.',replace(p_key,'_',' ');
end $$;
revoke all on function private.assurance_number(jsonb,text,numeric,numeric,integer),private.assurance_text(jsonb,text,integer,integer),private.assurance_date(jsonb,text),
  private.assurance_instant(jsonb,text) from public,anon,authenticated;

create function private.assurance_context(p_company uuid,p_actor uuid,p_mutation jsonb,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_role text; v_name text; v_id uuid; v_num numeric; v_num2 numeric; v_text text; v_text2 text; v_date date; v_date2 date; v_at timestamptz; v_at2 timestamptz;
  v_warn jsonb:='[]'::jsonb; v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_source jsonb:='{}'::jsonb; v_val jsonb; v_bal jsonb; v_count integer; v_state text; v_key text;
  td public.technical_drawings; dr public.drawing_revisions; rl public.purchase_receipt_lines; pl public.packing_list_items; ds public.dispatches; dd public.delivery_dispositions;
  oi public.order_items; od public.orders; cp public.order_change_proposals; ci public.order_change_impacts; cm public.competencies; mi public.measuring_instruments;
  ir public.inspection_results; sl public.production_plan_slots; pj public.production_jobs; mc public.machines; cc public.cycle_counts; cl public.cycle_count_lines;
  sb public.profile_stock_batches; ra public.return_authorizations; idp public.incoming_dispositions; w record; v_fields text[]; v_changes jsonb:='{}'::jsonb;
begin
  perform private.assurance_assert_shape(p_mutation);
  select role,full_name into v_role,v_name from public.app_users where id=p_actor and company_id=p_company and is_active and dealer_id is null;
  if not private.assurance_action_allowed(v_role,a) then raise exception 'Not permitted' using errcode='42501'; end if;

  -- NOV-062 ------------------------------------------------------------------------------------
  if a='drawing.register' then
    if p_lock then perform 1 from public.technical_drawings where id=(p_mutation->>'drawing_id')::uuid and company_id=p_company for update; end if;
    select * into td from public.technical_drawings where id=(p_mutation->>'drawing_id')::uuid and company_id=p_company;
    if td.id is null then raise exception 'NOV: The drawing record is unavailable.'; end if;
    v_text:=private.assurance_text(p_mutation,'revision_label',1,20);
    if v_text !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$' then raise exception 'NOV: Use letters, digits, dot, dash or underscore for the revision label, such as R2.'; end if;
    v_text2:=lower(private.assurance_text(p_mutation,'file_sha256',64,64));
    if v_text2 !~ '^[0-9a-f]{64}$' then raise exception 'NOV: The file checksum is not a SHA-256 value. Choose the drawing file again.'; end if;
    if jsonb_typeof(p_mutation->'customer_approval_required') is distinct from 'boolean' then raise exception 'NOV: Choose whether customer approval is required.'; end if;
    if td.related_entity_type in ('order','customer','quote','system_configuration') and not (p_mutation->>'customer_approval_required')::boolean then
      raise exception 'NOV: Customer drawings always need customer approval before release. Internal approval is not customer approval.'; end if;
    if p_mutation ? 'profile_id' and not exists(select 1 from public.aluminium_profiles where id=(p_mutation->>'profile_id')::uuid and company_id=p_company) then raise exception 'NOV: Choose a profile of this company.'; end if;
    if p_mutation ? 'file_name' then perform private.assurance_text(p_mutation,'file_name',1,180); end if;
    if p_mutation ? 'technical_note' then perform private.assurance_text(p_mutation,'technical_note',3,300); end if;
    select * into dr from public.drawing_revisions where company_id=p_company and drawing_id=td.id and revision_label=v_text;
    if dr.id is not null then raise exception 'NOV: Revision % is already registered for this drawing. A changed file needs a new revision label.',v_text; end if;
    select * into dr from public.drawing_revisions where company_id=p_company and drawing_id=td.id and file_sha256=v_text2;
    if dr.id is not null then raise exception 'NOV: This exact file is already registered as revision %.',dr.revision_label; end if;
    select * into dr from public.drawing_revisions where company_id=p_company and drawing_id=td.id order by registered_at desc,id desc limit 1;
    v_source:=jsonb_build_object('drawing',td.id,'latest',dr.id);
    v_title:='Register drawing revision'; v_effect:='Records an immutable revision with its file checksum. It is not approved or released by registering it.';
    v_facts:=jsonb_build_object('Drawing',td.drawing_number||' · '||td.title,'Revision',v_text,'Previous revision',coalesce(dr.revision_label,'none'),
      'Customer approval required',(p_mutation->>'customer_approval_required')::boolean,'Checksum',left(v_text2,12)||'…',
      'Profile',coalesce((select profile_code from public.aluminium_profiles where id=(p_mutation->>'profile_id')::uuid),'not linked'));
    if not p_mutation ? 'profile_id' then v_warn:=v_warn||jsonb_build_array('Without a profile this revision cannot be released for manufacture.'); end if;
  elsif a in ('drawing.customer','drawing.release','drawing.deviation','drawing.withdraw') then
    if p_lock then perform 1 from public.drawing_revisions where id=(p_mutation->>'revision_id')::uuid and company_id=p_company for update; end if;
    select * into dr from public.drawing_revisions where id=(p_mutation->>'revision_id')::uuid and company_id=p_company;
    if dr.id is null then raise exception 'NOV: The drawing revision is unavailable.'; end if;
    v_state:=private.drawing_state(p_company,dr.id);
    select * into td from public.technical_drawings where id=dr.drawing_id and company_id=p_company;
    v_source:=jsonb_build_object('revision',dr.id,'state',v_state,'last_event',(select max(recorded_at) from public.drawing_revision_events where company_id=p_company and revision_id=dr.id));
    v_facts:=jsonb_build_object('Drawing',td.drawing_number,'Revision',dr.revision_label,'Current state',replace(v_state,'_',' '));
    if a='drawing.customer' then
      v_text:=p_mutation->>'event';
      if v_text not in ('submitted','customer_query','customer_approved','customer_rejected') then raise exception 'NOV: Choose the customer event.'; end if;
      if (v_text='submitted' and v_state not in ('registered','customer_query')) or (v_text='customer_query' and v_state<>'submitted')
        or (v_text in ('customer_approved','customer_rejected') and v_state not in ('submitted','customer_query')) then
        raise exception 'NOV: A revision that is % cannot record %. Send it to the customer first or register a new revision.',replace(v_state,'_',' '),replace(v_text,'_',' '); end if;
      perform private.assurance_text(p_mutation,'evidence',5,500);
      if v_text in ('customer_approved','customer_rejected') and not p_mutation ? 'customer_contact' then raise exception 'NOV: Record who at the customer gave this decision.'; end if;
      if p_mutation ? 'customer_contact' then perform private.assurance_text(p_mutation,'customer_contact',2,120); end if;
      v_title:='Record customer drawing event'; v_effect:='Adds the customer event to the revision history. Customer approval does not release the revision for manufacture.';
      v_facts:=v_facts||jsonb_build_object('Event',replace(v_text,'_',' '),'Customer contact',coalesce(p_mutation->>'customer_contact','not recorded'));
    elsif a='drawing.release' then
      if dr.profile_id is null then raise exception 'NOV: Link the revision to a profile before releasing it for manufacture.'; end if;
      if not (v_state='customer_approved' or (v_state='registered' and not dr.customer_approval_required)) then
        raise exception 'NOV: Only a customer-approved revision can be released%.',case when dr.customer_approval_required then '' else ' (or a registered internal revision)' end; end if;
      select x.revision_label into v_text from private.drawing_released(p_company,dr.profile_id) x;
      select count(*) into v_count from public.production_jobs where company_id=p_company and profile_id=dr.profile_id and status in ('planned','ready','on_hold','in_progress') and drawing_revision is distinct from dr.revision_label;
      v_source:=v_source||jsonb_build_object('released',v_text,'affected',v_count);
      v_title:='Release revision for manufacture'; v_effect:='Makes this the only released revision for the profile. A previously released revision is superseded; production may first start only on the released revision.';
      v_facts:=v_facts||jsonb_build_object('Supersedes',coalesce(v_text,'none'),'Unfinished jobs on another revision',v_count);
      if v_count>0 then v_warn:=v_warn||jsonb_build_array(format('%s unfinished job(s) carry another revision. Unstarted jobs cannot start until refreshed or given a permitted deviation; running work continues and needs review.',v_count)); end if;
    elsif a='drawing.deviation' then
      if p_lock then perform 1 from public.production_jobs where id=(p_mutation->>'job_id')::uuid and company_id=p_company for update; end if;
      select * into pj from public.production_jobs where id=(p_mutation->>'job_id')::uuid and company_id=p_company;
      if pj.id is null or pj.profile_id is distinct from dr.profile_id then raise exception 'NOV: Choose an unstarted job for this revision''s profile.'; end if;
      if pj.status not in ('planned','ready') then raise exception 'NOV: Deviations are recorded before a job starts.'; end if;
      if pj.drawing_revision is distinct from dr.revision_label then raise exception 'NOV: The job carries revision %, not %.',coalesce(pj.drawing_revision,'(none)'),dr.revision_label; end if;
      select x.revision_label into v_text from private.drawing_released(p_company,dr.profile_id) x;
      if v_text is null or v_text=dr.revision_label then raise exception 'NOV: No deviation is needed; this revision is not superseded by a release.'; end if;
      v_date:=private.assurance_date(p_mutation,'valid_until');
      if v_date<private.ist_today() or v_date>private.ist_today()+90 then raise exception 'NOV: A deviation is valid from today for up to 90 days.'; end if;
      perform private.assurance_text(p_mutation,'evidence',5,500);
      v_source:=v_source||jsonb_build_object('job',pj.id,'job_status',pj.status,'job_revision',pj.drawing_revision,'released',v_text);
      v_title:='Permit a drawing deviation'; v_effect:='Allows this one job to start on the older revision until the date shown. Other jobs remain controlled.';
      v_facts:=v_facts||jsonb_build_object('Job',pj.job_number,'Released revision',v_text,'Valid until',to_char(v_date,'DD Mon YYYY'));
    else
      if v_state in ('superseded','withdrawn') then raise exception 'NOV: This revision is already %.',v_state; end if;
      v_title:='Withdraw drawing revision'; v_effect:='Marks the revision withdrawn. History, approvals and jobs made to it are kept.';
      if v_state='released' then v_warn:=v_warn||jsonb_build_array('This is the released revision. Until another revision is released the profile is no longer drawing-controlled.'); end if;
    end if;

  -- NOV-069 ------------------------------------------------------------------------------------
  elsif a in ('incoming.dispose','incoming.return','incoming.release','incoming.reverse') then
    if a='incoming.reverse' then
      select * into idp from public.incoming_dispositions where id=(p_mutation->>'id')::uuid and company_id=p_company;
      if idp.id is null then raise exception 'NOV: The quality decision is unavailable.'; end if;
      if idp.reversed_at is not null then raise exception 'NOV: This decision is already reversed.'; end if;
      v_id:=idp.receipt_line_id;
    else v_id:=(p_mutation->>'receipt_line_id')::uuid; end if;
    if p_lock then perform 1 from public.purchase_receipt_lines where id=v_id and company_id=p_company for update; end if;
    select * into rl from public.purchase_receipt_lines where id=v_id and company_id=p_company;
    if rl.id is null then raise exception 'NOV: The received purchase line is unavailable.'; end if;
    v_bal:=private.incoming_balance(p_company,rl.id);
    v_source:=jsonb_build_object('line',rl.id,'balance',v_bal);
    v_facts:=jsonb_build_object('Purchase line',(select po.po_number||' line '||pol.line_number from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id where pol.id=rl.purchase_order_line_id),
      'Awaiting quality decision',trim_scale((v_bal->>'pending_qc')::numeric)||' '||(v_bal->>'unit'));
    if a='incoming.dispose' then
      v_text:=p_mutation->>'disposition';
      if v_text not in ('accept','concession','reject') then raise exception 'NOV: Choose accept, concession or reject.'; end if;
      v_num:=private.assurance_number(p_mutation,'quantity',0.001,100000000,3);
      if v_num>(v_bal->>'pending_qc')::numeric+0.0005 then raise exception 'NOV: Only % % awaits a quality decision on this line.',trim_scale((v_bal->>'pending_qc')::numeric),v_bal->>'unit'; end if;
      if v_text='accept' and not p_mutation ? 'certificate_ref' then raise exception 'NOV: Record the mill test certificate reference before accepting. Without it, only an authorized concession can accept material.'; end if;
      if p_mutation ? 'certificate_ref' then perform private.assurance_text(p_mutation,'certificate_ref',2,80); end if;
      if v_text='concession' and v_role not in ('owner','admin','factory_manager') then raise exception 'NOV: A concession needs factory manager, admin or owner authority.'; end if;
      perform private.assurance_text(p_mutation,'evidence',5,500);
      v_title:='Record incoming quality decision';
      v_effect:=case v_text when 'reject' then 'Rejects this quantity. It is not usable and awaits return to the supplier.' else 'Accepts this quantity for release into stock. Nothing is released until stores release it.' end;
      v_facts:=v_facts||jsonb_build_object('Decision',v_text,'Quantity',trim_scale(v_num)||' '||(v_bal->>'unit'),'Certificate',coalesce(p_mutation->>'certificate_ref','not recorded'));
    elsif a='incoming.return' then
      v_num:=private.assurance_number(p_mutation,'quantity',0.001,100000000,3);
      if v_num>(v_bal->>'awaiting_return')::numeric+0.0005 then raise exception 'NOV: Only % % is rejected and awaiting return.',trim_scale((v_bal->>'awaiting_return')::numeric),v_bal->>'unit'; end if;
      perform private.assurance_text(p_mutation,'evidence',5,500);
      v_title:='Record return to supplier'; v_effect:='Records that rejected material physically left for the supplier. Supplier credit stays in purchasing.';
      v_facts:=v_facts||jsonb_build_object('Returned',trim_scale(v_num)||' '||(v_bal->>'unit'));
    elsif a='incoming.release' then
      if v_bal->>'unit' is distinct from 'kg' then raise exception 'NOV: Only purchase lines measured in kg can be released as billet stock.'; end if;
      v_num:=private.assurance_number(p_mutation,'quantity_kg',0.001,100000000,3);
      if v_num>(v_bal->>'releasable')::numeric+0.0005 then raise exception 'NOV: Only % kg is accepted and not yet released.',trim_scale((v_bal->>'releasable')::numeric); end if;
      v_text:=upper(private.assurance_text(p_mutation,'batch_number',2,40));
      if v_text !~ '^[A-Z0-9][A-Z0-9/_-]{1,39}$' then raise exception 'NOV: Use letters, digits, slash, dash or underscore for the batch number.'; end if;
      if exists(select 1 from public.billet_batches where company_id=p_company and upper(batch_number)=v_text) then raise exception 'NOV: Billet batch % already exists.',v_text; end if;
      if upper(private.assurance_text(p_mutation,'alloy',2,20)) !~ '^[A-Z0-9-]{2,20}$' then raise exception 'NOV: Enter the alloy as recorded on billets, such as 6063.'; end if;
      if upper(private.assurance_text(p_mutation,'temper',1,10)) !~ '^[A-Z0-9]{1,10}$' then raise exception 'NOV: Enter the billet temper, such as F or O.'; end if;
      if p_mutation ? 'diameter_mm' then perform private.assurance_number(p_mutation,'diameter_mm',20,800,1); end if;
      if p_mutation ? 'heat_number' then perform private.assurance_text(p_mutation,'heat_number',2,40); end if;
      v_title:='Release accepted material to billet stock'; v_effect:='Creates an available billet batch for this accepted quantity, linked to the receipt line.';
      v_facts:=v_facts||jsonb_build_object('Batch',v_text,'Quantity',trim_scale(v_num)||' kg','Alloy and temper',upper(p_mutation->>'alloy')||' '||upper(p_mutation->>'temper'),
        'Heat number',coalesce(p_mutation->>'heat_number','not recorded'));
      if not p_mutation ? 'heat_number' then v_warn:=v_warn||jsonb_build_array('No heat number is recorded; material traceability to the cast will be incomplete.'); end if;
    else
      if idp.disposition in ('accept','concession') and (v_bal->>'accepted')::numeric+(v_bal->>'concession')::numeric-idp.quantity<(v_bal->>'released')::numeric-0.0005 then
        raise exception 'NOV: Released billet stock depends on this acceptance. Correct the stock first.'; end if;
      if idp.disposition='reject' and (v_bal->>'gate_rejected')::numeric+(v_bal->>'rejected')::numeric-idp.quantity<(v_bal->>'returned')::numeric-0.0005 then
        raise exception 'NOV: Material from this rejection was already returned to the supplier.'; end if;
      v_source:=v_source||jsonb_build_object('decision',idp.id);
      v_title:='Reverse quality decision'; v_effect:='Keeps the original decision, marks it reversed and returns its quantity for a new decision, such as a retest.';
      v_facts:=v_facts||jsonb_build_object('Decision',idp.disposition,'Quantity',trim_scale(idp.quantity));
    end if;

  -- NOV-076 ------------------------------------------------------------------------------------
  elsif a='delivery.record' then
    if p_lock then perform 1 from public.packing_list_items where id=(p_mutation->>'packing_item_id')::uuid and company_id=p_company for update; end if;
    select * into pl from public.packing_list_items where id=(p_mutation->>'packing_item_id')::uuid and company_id=p_company;
    if pl.id is null then raise exception 'NOV: The bundle is unavailable.'; end if;
    select * into ds from public.dispatches where id=pl.dispatch_id and company_id=p_company;
    if ds.actual_dispatched_at is null or ds.delivery_status not in ('dispatched','in_transit','delivered','delayed','damaged') then
      raise exception 'NOV: Record customer dispositions only after the load has departed.'; end if;
    v_text:=p_mutation->>'disposition';
    if v_text not in ('accepted','refused','damaged','short_claimed') then raise exception 'NOV: Choose accepted, refused, damaged or reported short.'; end if;
    v_num:=private.assurance_number(p_mutation,'quantity_kg',0.001,1000000,3);
    select x into v_val from jsonb_array_elements(private.delivery_balance(p_company,ds.id)->'bundles') x where x->>'id'=pl.id::text;
    if v_num>(v_val->>'undisposed_kg')::numeric+0.0005 then raise exception 'NOV: Only % kg of this bundle has no recorded customer disposition.',trim_scale((v_val->>'undisposed_kg')::numeric); end if;
    perform private.assurance_text(p_mutation,'receiver_name',2,120); perform private.assurance_text(p_mutation,'evidence',5,500);
    v_source:=jsonb_build_object('bundle',v_val,'dispatch_status',ds.delivery_status);
    v_title:='Record customer delivery disposition';
    v_effect:=case v_text when 'accepted' then 'Records the quantity the customer accepted.' else 'Opens a delivery exception owned by you until it is resolved. Stock, credit and returns are not changed here.' end;
    v_facts:=jsonb_build_object('Dispatch',ds.dispatch_number,'Bundle',pl.bundle_number,'Disposition',replace(v_text,'_',' '),'Quantity',trim_scale(v_num)||' kg','Received by',btrim(p_mutation->>'receiver_name'));
    if v_text='short_claimed' then v_warn:=v_warn||jsonb_build_array('A customer-reported shortage is not a verified stock discrepancy until stores verify it.'); end if;
  elsif a in ('delivery.resolve','delivery.reverse') then
    if p_lock then perform 1 from public.delivery_dispositions where id=(p_mutation->>'id')::uuid and company_id=p_company for update; end if;
    select * into dd from public.delivery_dispositions where id=(p_mutation->>'id')::uuid and company_id=p_company;
    if dd.id is null then raise exception 'NOV: The delivery disposition is unavailable.'; end if;
    if dd.reversed_at is not null then raise exception 'NOV: This disposition is reversed.'; end if;
    if dd.resolution is not null then raise exception 'NOV: This exception is already resolved; its history is kept.'; end if;
    select * into pl from public.packing_list_items where id=dd.packing_list_item_id and company_id=p_company;
    v_source:=jsonb_build_object('disposition',dd.id,'kg',dd.quantity_kg);
    v_facts:=jsonb_build_object('Bundle',pl.bundle_number,'Disposition',replace(dd.disposition,'_',' '),'Quantity',trim_scale(dd.quantity_kg)||' kg');
    if a='delivery.resolve' then
      if dd.disposition='accepted' then raise exception 'NOV: Accepted quantities need no resolution.'; end if;
      v_text:=p_mutation->>'resolution';
      if v_text not in ('redelivery','credit_claim','return_expected','verified_shortage','claim_rejected') then raise exception 'NOV: Choose how the exception is resolved.'; end if;
      if v_text='verified_shortage' and (dd.disposition<>'short_claimed' or v_role not in ('owner','admin','inventory_manager')) then
        raise exception 'NOV: Only stores can verify a reported shortage as a stock discrepancy.'; end if;
      if v_text='claim_rejected' and v_role not in ('owner','admin','sales_manager') then raise exception 'NOV: Only sales management can reject a customer claim.'; end if;
      if v_text='return_expected' then
        if dd.disposition not in ('refused','damaged') then raise exception 'NOV: Only refused or damaged material is returned.'; end if;
        if not private.assurance_action_allowed(v_role,'return.authorize') then raise exception 'NOV: Only sales management or quality can authorize a return.'; end if;
        if p_mutation->>'response' is null or p_mutation->>'response' not in ('credit','replacement','rework_return') then raise exception 'NOV: Choose the response for the expected return.'; end if;
        if exists(select 1 from public.return_authorizations where company_id=p_company and packing_list_item_id=dd.packing_list_item_id and status='authorized') then
          raise exception 'NOV: A return is already authorized for this bundle.'; end if;
        if (select coalesce(sum(expected_kg),0) from public.return_authorizations where company_id=p_company and packing_list_item_id=dd.packing_list_item_id and status<>'rejected')+dd.quantity_kg>private.packing_net_kg(pl)+0.0005 then
          raise exception 'NOV: Returns already authorized for this bundle leave no quantity for another return.'; end if;
      elsif p_mutation ? 'response' then raise exception 'NOV: A response applies only to an expected return.'; end if;
      v_title:='Resolve delivery exception';
      v_effect:=case v_text when 'return_expected' then 'Authorizes the return of this quantity; receipt, inspection and credit follow the return workflow.'
        when 'redelivery' then 'Records that the quantity will be redelivered. Stock is not issued again here.' when 'credit_claim' then 'Routes the claim to accounts. No credit is posted here.'
        when 'verified_shortage' then 'Records a verified shortage for stores and accounts to correct through their own workflows.' else 'Records that the customer claim was rejected.' end;
      v_facts:=v_facts||jsonb_build_object('Resolution',replace(v_text,'_',' '));
    else
      v_title:='Reverse delivery disposition'; v_effect:='Keeps the original entry, marks it reversed and returns its quantity to unconfirmed.';
    end if;

  -- NOV-034 ------------------------------------------------------------------------------------
  elsif a='change.propose' then
    if p_lock then perform 1 from public.order_items where id=(p_mutation->>'order_item_id')::uuid and company_id=p_company for update; end if;
    select * into oi from public.order_items where id=(p_mutation->>'order_item_id')::uuid and company_id=p_company;
    if oi.id is null then raise exception 'NOV: The order line is unavailable.'; end if;
    select * into od from public.orders where id=oi.order_id and company_id=p_company;
    if od.deleted_at is not null or od.current_stage in ('closed','cancelled') then raise exception 'NOV: Closed or cancelled orders are not revised.'; end if;
    if exists(select 1 from public.order_change_proposals where company_id=p_company and order_item_id=oi.id and status in ('assessed','approved')) then
      raise exception 'NOV: This line already has an open change proposal. Decide or complete it first.'; end if;
    if jsonb_typeof(p_mutation->'changes') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_mutation->'changes')) not between 1 and 6 then raise exception 'NOV: Propose at least one change.'; end if;
    v_val:=private.change_line_state(p_company,oi.id);
    for v_key in select k from jsonb_object_keys(p_mutation->'changes') k order by k loop
      if not v_key=any(private.change_fields()) then raise exception 'NOV: % cannot be changed through a proposal.',replace(v_key,'_',' '); end if;
      if v_key='quantity_kg' then perform private.assurance_number(p_mutation->'changes','quantity_kg',0.001,10000000,3);
      elsif v_key='cut_length' then perform private.assurance_number(p_mutation->'changes','cut_length',1,100000,3);
      elsif v_key='pieces_per_bundle' then perform private.assurance_number(p_mutation->'changes','pieces_per_bundle',1,100000,0);
      elsif v_key='drawing_revision' then
        if private.assurance_text(p_mutation->'changes','drawing_revision',1,20) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$' then raise exception 'NOV: Use a revision label such as R2.'; end if;
      elsif v_key='finishing_type' then
        if private.assurance_text(p_mutation->'changes','finishing_type',2,40) !~ '^[a-z][a-z_]{1,39}$' then raise exception 'NOV: Choose a finishing type such as anodizing or powder_coating.'; end if;
      else perform private.assurance_text(p_mutation->'changes','packing_instruction',3,500); end if;
      if (v_val->v_key) is not distinct from (p_mutation->'changes'->v_key) or (jsonb_typeof(p_mutation->'changes'->v_key)='string' and v_val->>v_key is not distinct from btrim(p_mutation->'changes'->>v_key)) then
        raise exception 'NOV: % already has this value.',initcap(replace(v_key,'_',' ')); end if;
      v_changes:=v_changes||jsonb_build_object(v_key,jsonb_build_object('from',v_val->v_key,'to',case when jsonb_typeof(p_mutation->'changes'->v_key)='string' then to_jsonb(btrim(p_mutation->'changes'->>v_key)) else p_mutation->'changes'->v_key end));
      v_fields:=coalesce(v_fields,'{}')||v_key;
    end loop;
    v_bal:=private.change_impacts(p_company,oi.id,v_fields);
    v_source:=jsonb_build_object('line',v_val,'changes',v_changes,'impacts',v_bal);
    v_title:='Assess an order line change'; v_effect:='Records the proposal and the downstream work it affects. Nothing is changed in the order, production, dispatch or billing until each owner acts.';
    v_facts:=jsonb_build_object('Order',od.order_number,'Line',coalesce(nullif(oi.item_description,''),nullif(oi.section_name,''),'Order line'),
      'Changes',(select string_agg(replace(k,'_',' ')||': '||coalesce(v_changes->k->>'from','blank')||' → '||(v_changes->k->>'to'),'; ' order by k) from jsonb_object_keys(v_changes) k),
      'Impact actions',jsonb_array_length(v_bal),'Already posted work',(select count(*) from jsonb_array_elements(v_bal) x where x->>'classification'='posted_correction'));
    if 'quantity_kg'=any(v_fields) and (p_mutation->'changes'->>'quantity_kg')::numeric<(select coalesce(sum(private.packing_net_kg(x)),0) from public.packing_list_items x
        join public.dispatches y on y.id=x.dispatch_id and y.company_id=x.company_id where x.company_id=p_company and x.order_item_id=oi.id and y.actual_dispatched_at is not null) then
      v_warn:=v_warn||jsonb_build_array('The revised quantity is below what has already departed. Shipped material is not reduced by this proposal.'); end if;
  elsif a='change.decide' then
    if p_lock then perform 1 from public.order_change_proposals where id=(p_mutation->>'id')::uuid and company_id=p_company for update; end if;
    select * into cp from public.order_change_proposals where id=(p_mutation->>'id')::uuid and company_id=p_company;
    if cp.id is null then raise exception 'NOV: The change proposal is unavailable.'; end if;
    if cp.status<>'assessed' then raise exception 'NOV: This proposal has already been decided.'; end if;
    if cp.proposed_by=p_actor then raise exception 'NOV: Another authorized person must decide on your proposal.'; end if;
    if p_mutation->>'decision' not in ('approved','abandoned') then raise exception 'NOV: Choose approve or abandon.'; end if;
    if p_mutation->>'decision'='approved' and cp.line_fingerprint<>md5(private.change_line_state(p_company,cp.order_item_id)::text) then
      raise exception 'NOV: The order line changed after this assessment. Abandon the proposal and assess the change again.'; end if;
    v_source:=jsonb_build_object('proposal',cp.id,'status',cp.status,'line',private.change_line_state(p_company,cp.order_item_id));
    v_title:='Decide on order change'; v_effect:=case p_mutation->>'decision' when 'approved' then 'Approves the change. Each impact owner then resolves their action; the order line itself is updated through the order workflow.'
      else 'Abandons the proposal and closes its impact actions as not required.' end;
    v_facts:=jsonb_build_object('Decision',p_mutation->>'decision','Open impact actions',(select count(*) from public.order_change_impacts where company_id=p_company and proposal_id=cp.id and status='open'));
  elsif a='change.resolve' then
    if p_lock then perform 1 from public.order_change_impacts where id=(p_mutation->>'id')::uuid and company_id=p_company for update; end if;
    select * into ci from public.order_change_impacts where id=(p_mutation->>'id')::uuid and company_id=p_company;
    if ci.id is null then raise exception 'NOV: The impact action is unavailable.'; end if;
    select * into cp from public.order_change_proposals where id=ci.proposal_id and company_id=p_company;
    if ci.status<>'open' then raise exception 'NOV: This impact action is already resolved.'; end if;
    if cp.status<>'approved' then raise exception 'NOV: Impact actions are resolved after the proposal is approved.'; end if;
    if not v_role=any(private.change_owner_roles(ci.owner_role)) then raise exception 'Not permitted' using errcode='42501'; end if;
    if p_mutation->>'outcome' not in ('done','not_required') then raise exception 'NOV: Choose done or not required.'; end if;
    v_source:=jsonb_build_object('impact',ci.id,'status',ci.status);
    v_title:='Resolve change impact'; v_effect:='Records how your team handled this consequence. The proposal completes when every action is resolved.';
    v_facts:=jsonb_build_object('Impact',ci.label,'Required action',ci.required_action,'Outcome',replace(p_mutation->>'outcome','_',' '));

  -- NOV-055 ------------------------------------------------------------------------------------
  elsif a='capability.criteria' then
    select * into cm from public.competencies where id=(p_mutation->>'competency_id')::uuid and company_id=p_company and is_active;
    if cm.id is null then raise exception 'NOV: Choose an active competency.'; end if;
    v_num:=private.assurance_number(p_mutation,'supervised_required',0,50,0);
    if jsonb_typeof(p_mutation->'observed_trial_required') is distinct from 'boolean' then raise exception 'NOV: Choose whether an observed trial is required.'; end if;
    if (p_mutation->>'observed_trial_required')::boolean and cm.procedure_id is null then raise exception 'NOV: Link the competency to a procedure before requiring an observed trial.'; end if;
    v_source:=jsonb_build_object('criteria',(select to_jsonb(q) from public.qualification_criteria q where q.company_id=p_company and q.competency_id=cm.id));
    v_title:='Set qualification evidence'; v_effect:='Future independent qualifications for this competency must show this evidence. Existing grants are not changed.';
    v_facts:=jsonb_build_object('Competency',cm.code||' · '||cm.name,'Supervised confirmations required',v_num,'Observed trial required',(p_mutation->>'observed_trial_required')::boolean);
  elsif a='capability.assess' then
    select * into cm from public.competencies where id=(p_mutation->>'competency_id')::uuid and company_id=p_company and is_active;
    if cm.id is null then raise exception 'NOV: Choose an active competency.'; end if;
    v_id:=(p_mutation->>'employee_id')::uuid;
    if not exists(select 1 from public.app_users where id=v_id and company_id=p_company and is_active and dealer_id is null) then raise exception 'NOV: Choose an active employee.'; end if;
    if v_id=p_actor then raise exception 'NOV: You cannot assess yourself.'; end if;
    if v_role not in ('owner','admin','factory_manager') and private.competency_standing(p_actor,cm.id)->>'effective' is distinct from 'independent' then
      raise exception 'NOV: Only an independent holder of this competency or a factory manager may assess it.'; end if;
    if p_mutation->>'outcome' not in ('independent','more_practice') then raise exception 'NOV: Choose the assessment outcome.'; end if;
    select count(*) into v_count from public.supervision_confirmations s where s.company_id=p_company and s.performer_id=v_id and s.used_at is not null
      and s.action in (select q.action from public.competency_requirements q where q.company_id=p_company and q.competency_id=cm.id);
    v_val:=jsonb_build_object('supervised_confirmations',v_count,
      'observed_trials',(select count(*) from public.sop_observed_trials t join public.procedure_versions pv on pv.id=t.version_id and pv.company_id=t.company_id
        where t.company_id=p_company and t.employee_id=v_id and t.status='reviewed' and t.decision='retain' and pv.procedure_id=cm.procedure_id),
      'standing',private.competency_standing(v_id,cm.id));
    select jsonb_build_object('supervised_required',supervised_required,'observed_trial_required',observed_trial_required,'revision',revision) into v_bal
      from public.qualification_criteria where company_id=p_company and competency_id=cm.id;
    if p_mutation->>'outcome'='independent' then
      if v_bal is null then raise exception 'NOV: Set the qualification evidence for this competency first.'; end if;
      if v_val->'standing'->>'effective'='independent' then raise exception 'NOV: This employee is already independently qualified.'; end if;
      if (v_val->>'supervised_confirmations')::integer<(v_bal->>'supervised_required')::integer or ((v_bal->>'observed_trial_required')::boolean and (v_val->>'observed_trials')::integer<1) then
        raise exception 'NOV: Evidence is not yet sufficient: % of % supervised confirmations; observed trial %.',v_val->>'supervised_confirmations',v_bal->>'supervised_required',
          case when not (v_bal->>'observed_trial_required')::boolean then 'not required' when (v_val->>'observed_trials')::integer>0 then 'recorded' else 'missing' end; end if;
    end if;
    v_source:=jsonb_build_object('evidence',v_val,'criteria',v_bal);
    v_title:='Record qualification assessment'; v_effect:=case p_mutation->>'outcome' when 'independent' then 'Grants independent level from this assessment and keeps the evidence counted. The previous grant is retained in history.'
      else 'Records that more supervised practice is needed. No grant changes.' end;
    v_facts:=jsonb_build_object('Employee',(select full_name from public.app_users where id=v_id),'Competency',cm.code,'Supervised confirmations',v_val->'supervised_confirmations',
      'Observed trials',v_val->'observed_trials','Outcome',replace(p_mutation->>'outcome','_',' '));

  -- NOV-070 ------------------------------------------------------------------------------------
  elsif a='instrument.register' then
    v_text:=upper(private.assurance_text(p_mutation,'code',2,30));
    if v_text !~ '^[A-Z0-9][A-Z0-9_-]{1,29}$' then raise exception 'NOV: Use capitals, digits, dash or underscore for the instrument code.'; end if;
    if exists(select 1 from public.measuring_instruments where company_id=p_company and code=v_text) then raise exception 'NOV: Instrument % is already registered.',v_text; end if;
    perform private.assurance_text(p_mutation,'name',3,120);
    if p_mutation->>'unit' not in ('mm','kg/m','HW','micron','percent') then raise exception 'NOV: Choose the unit the instrument measures.'; end if;
    v_num:=private.assurance_number(p_mutation,'range_min',-1000000,1000000,4); v_num2:=private.assurance_number(p_mutation,'range_max',-1000000,1000000,4);
    if v_num2<=v_num then raise exception 'NOV: The upper range must be above the lower range.'; end if;
    if p_mutation ? 'location' then perform private.assurance_text(p_mutation,'location',2,120); end if;
    v_title:='Register measuring instrument'; v_effect:='Adds the instrument. Results can use it only with check evidence valid on the measurement date.';
    v_facts:=jsonb_build_object('Code',v_text,'Range',trim_scale(v_num)||' to '||trim_scale(v_num2)||' '||(p_mutation->>'unit'));
  elsif a in ('instrument.check','instrument.withdraw') then
    if p_lock then perform 1 from public.measuring_instruments where id=(p_mutation->>'instrument_id')::uuid and company_id=p_company for update; end if;
    select * into mi from public.measuring_instruments where id=(p_mutation->>'instrument_id')::uuid and company_id=p_company;
    if mi.id is null then raise exception 'NOV: The instrument is unavailable.'; end if;
    if mi.status<>'active' then raise exception 'NOV: This instrument is withdrawn.'; end if;
    v_source:=jsonb_build_object('instrument',mi.id,'status',mi.status,'last_check',(select max(recorded_at) from public.instrument_checks where company_id=p_company and instrument_id=mi.id),
      'bindings',(select count(*) from public.instrument_result_bindings where company_id=p_company and instrument_id=mi.id));
    if a='instrument.check' then
      v_date:=private.assurance_date(p_mutation,'checked_on'); v_date2:=private.assurance_date(p_mutation,'valid_until');
      if v_date>private.ist_today() or v_date<private.ist_today()-400 then raise exception 'NOV: The check date must be within the last 400 days and not in the future.'; end if;
      if v_date2<v_date or v_date2>v_date+800 then raise exception 'NOV: Evidence must be valid from the check date for up to 800 days.'; end if;
      if p_mutation->>'result' not in ('pass','fail') then raise exception 'NOV: Choose pass or fail.'; end if;
      perform private.assurance_text(p_mutation,'certificate_ref',2,80);
      v_title:='Record instrument check evidence'; v_effect:=case p_mutation->>'result' when 'pass' then 'Adds check evidence. It applies to measurements from the check date until the validity date.'
        else 'Records a failed check and opens a review of results measured since the last passing check.' end;
      v_facts:=jsonb_build_object('Instrument',mi.code,'Result',p_mutation->>'result','Checked',to_char(v_date,'DD Mon YYYY'),'Valid until',to_char(v_date2,'DD Mon YYYY'));
    else
      v_title:='Withdraw instrument'; v_effect:='Stops further use and opens a review of results measured since its last passing check.';
      v_facts:=jsonb_build_object('Instrument',mi.code,'Results measured with it',v_source->'bindings');
    end if;
  elsif a='instrument.bind' then
    if p_lock then perform 1 from public.inspection_results where id=(p_mutation->>'result_id')::uuid and company_id=p_company for update; end if;
    select * into ir from public.inspection_results where id=(p_mutation->>'result_id')::uuid and company_id=p_company;
    if ir.id is null then raise exception 'NOV: The inspection result is unavailable.'; end if;
    if ir.observed is null then raise exception 'NOV: Only measured results use an instrument.'; end if;
    if exists(select 1 from public.instrument_result_bindings where inspection_result_id=ir.id) then raise exception 'NOV: This result already records its instrument.'; end if;
    select * into mi from public.measuring_instruments where id=(p_mutation->>'instrument_id')::uuid and company_id=p_company;
    if mi.id is null then raise exception 'NOV: The instrument is unavailable.'; end if;
    select unit into v_text from public.inspection_plan_items where id=ir.item_id and company_id=p_company;
    if v_text is distinct from mi.unit then raise exception 'NOV: This instrument measures % but the characteristic is in %.',mi.unit,coalesce(v_text,'an unknown unit'); end if;
    if ir.observed<mi.range_min or ir.observed>mi.range_max then raise exception 'NOV: Reading % is outside the instrument range % to %.',trim_scale(ir.observed),trim_scale(mi.range_min),trim_scale(mi.range_max); end if;
    v_val:=private.instrument_evidence(p_company,mi.id,ir.recorded_at);
    if v_val->>'state'<>'valid' and coalesce((select mode from public.instrument_policies where company_id=p_company),'warn')='block' then
      raise exception 'NOV: Instrument evidence is % for this measurement; the quality policy blocks its use.',v_val->>'state'; end if;
    if v_val->>'state'<>'valid' then v_warn:=v_warn||jsonb_build_array(format('Instrument evidence is %s on the measurement date. The binding is recorded as such and will not count as valid evidence.',v_val->>'state')); end if;
    v_source:=jsonb_build_object('result',ir.id,'evidence',v_val,'instrument_status',mi.status);
    v_title:='Record the instrument used'; v_effect:='Binds the measurement to the instrument and the check evidence in force when it was measured. The reading is not changed.';
    v_facts:=jsonb_build_object('Instrument',mi.code,'Reading',trim_scale(ir.observed)||' '||mi.unit,'Evidence',v_val->>'state','Certificate',coalesce(v_val->>'certificate_ref','none'));
  elsif a='instrument.policy' then
    if p_mutation->>'mode' not in ('warn','block') then raise exception 'NOV: Choose warn or block.'; end if;
    if coalesce((select mode from public.instrument_policies where company_id=p_company),'warn')=p_mutation->>'mode' then raise exception 'NOV: The policy already uses this mode.'; end if;
    v_title:='Set instrument evidence policy'; v_effect:=case p_mutation->>'mode' when 'block' then 'Inspections with measured results cannot be approved unless every result has an instrument with valid evidence.'
      else 'Missing or invalid evidence is shown as a warning; approvals are not blocked.' end;
    v_facts:=jsonb_build_object('Mode',p_mutation->>'mode');
    if p_mutation->>'mode'='block' then v_warn:=v_warn||jsonb_build_array(format('%s pending inspection(s) currently have measured results without valid evidence.',
      (select count(distinct qi.id) from public.quality_inspections qi join public.inspection_results r on r.inspection_id=qi.id and r.company_id=qi.company_id
        where qi.company_id=p_company and qi.status='pending' and r.observed is not null and not exists(select 1 from public.instrument_result_bindings b where b.inspection_result_id=r.id and b.evidence_state='valid')))); end if;
  elsif a='instrument.review' then
    select to_jsonb(v) into v_val from public.instrument_impact_reviews v where v.id=(p_mutation->>'id')::uuid and v.company_id=p_company;
    if v_val is null then raise exception 'NOV: The impact review is unavailable.'; end if;
    if v_val->>'status'<>'open' then raise exception 'NOV: This impact review is already closed.'; end if;
    v_source:=jsonb_build_object('review',v_val->'id','status',v_val->'status');
    v_title:='Close instrument impact review'; v_effect:='Records quality''s conclusion on the affected results. Original measurements are not changed.';
    v_facts:=jsonb_build_object('Affected results',jsonb_array_length(v_val->'affected'),'Trigger',replace(v_val->>'trigger','_',' '));

  -- NOV-026 ------------------------------------------------------------------------------------
  elsif a in ('capacity.move','capacity.unplan','capacity.review') then
    select * into w from private.capacity_windows(p_company) x where x.id=(p_mutation->>'unavailability_id')::uuid;
    if w.id is null then raise exception 'NOV: The capacity unavailability is no longer current.'; end if;
    v_val:=private.capacity_affected(p_company,w.id);
    if a='capacity.review' then
      select * into od from public.orders where id=(p_mutation->>'order_id')::uuid and company_id=p_company;
      if od.id is null or not (exists(select 1 from jsonb_array_elements(v_val) e where (e->>'order_id')::uuid=od.id) or exists(select 1 from public.capacity_reschedules cr
          join public.production_plan_slots ps on ps.id=cr.slot_id join public.production_jobs j on j.id=ps.production_job_id where cr.company_id=p_company and cr.unavailability_id=w.id and j.order_id=od.id)) then
        raise exception 'NOV: This order is not affected by the selected unavailability.'; end if;
      if exists(select 1 from public.capacity_commitment_reviews where company_id=p_company and order_id=od.id and unavailability_id=w.id) then raise exception 'NOV: This order promise is already reviewed for this unavailability.'; end if;
      if p_mutation->>'decision' not in ('promise_holds','customer_informed','date_review_needed') then raise exception 'NOV: Choose the review outcome.'; end if;
      v_source:=jsonb_build_object('window',w.id,'order',od.id,'expected',od.expected_dispatch_date);
      v_title:='Review order promise'; v_effect:='Records the commercial review of this order''s promise. The expected dispatch date is not changed.';
      v_facts:=jsonb_build_object('Order',od.order_number,'Promised dispatch',coalesce(to_char(od.expected_dispatch_date,'DD Mon YYYY'),'not set'),'Outcome',replace(p_mutation->>'decision','_',' '));
    else
      if p_lock then perform 1 from public.production_plan_slots where id=(p_mutation->>'slot_id')::uuid and company_id=p_company for update; end if;
      select * into sl from public.production_plan_slots where id=(p_mutation->>'slot_id')::uuid and company_id=p_company;
      if sl.id is null or not exists(select 1 from jsonb_array_elements(v_val) e where (e->>'slot_id')::uuid=sl.id) then raise exception 'NOV: This slot is not affected by the selected unavailability.'; end if;
      select * into pj from public.production_jobs where id=sl.production_job_id and company_id=p_company;
      if pj.status='in_progress' then raise exception 'NOV: The job is already running on this press. Record the interruption on the job instead of moving it.'; end if;
      v_source:=jsonb_build_object('window',jsonb_build_object('id',w.id,'starts',w.starts_at,'ends',w.ends_at,'known',w.end_known),
        'slot',jsonb_build_object('id',sl.id,'machine',sl.machine_id,'start',sl.planned_start_at,'end',sl.planned_end_at,'shift',sl.shift,'status',sl.status,'updated',sl.updated_at));
      v_facts:=jsonb_build_object('Job',pj.job_number,'Current press',(select machine_name from public.machines where id=sl.machine_id),
        'Current slot',to_char(sl.planned_start_at at time zone 'Asia/Kolkata','DD Mon HH24:MI')||' to '||to_char(sl.planned_end_at at time zone 'Asia/Kolkata','DD Mon HH24:MI'));
      if a='capacity.move' then
        select * into mc from public.machines where id=(p_mutation->>'machine_id')::uuid and company_id=p_company;
        if mc.id is null or mc.machine_type<>'extrusion_press' or not mc.is_active or mc.status not in ('active','operational','idle') then raise exception 'NOV: Choose an available extrusion press.'; end if;
        v_at:=private.assurance_instant(p_mutation,'start_at'); v_at2:=private.assurance_instant(p_mutation,'end_at');
        if v_at2<=v_at or v_at2-v_at>interval '7 days' then raise exception 'NOV: The new slot must end after it starts and last at most 7 days.'; end if;
        if v_at<now()-interval '5 minutes' then raise exception 'NOV: A replanned slot cannot start in the past.'; end if;
        if exists(select 1 from private.capacity_windows(p_company) x where x.machine_id=mc.id and v_at2>x.starts_at and (not x.end_known or v_at<x.ends_at)) then
          raise exception 'NOV: The chosen press and time overlap planned maintenance or a breakdown whose end is not confirmed.'; end if;
        v_text:=private.assurance_text(p_mutation,'shift',1,40);
        if exists(select 1 from public.aluminium_profiles p where p.id=pj.profile_id and p.company_id=p_company and coalesce(cardinality(p.compatible_presses),0)>0
            and not (coalesce(mc.machine_code,'')=any(p.compatible_presses) or mc.machine_name=any(p.compatible_presses) or mc.id::text=any(p.compatible_presses))) then
          raise exception 'NOV: This profile is not listed as compatible with press %.',mc.machine_name; end if;
        v_title:='Replan an affected slot'; v_effect:='Moves the slot to the chosen press and time. Shift capacity, overlap and die checks run again; the original plan is kept in history.';
        v_facts:=v_facts||jsonb_build_object('New press',mc.machine_name,'New slot',to_char(v_at at time zone 'Asia/Kolkata','DD Mon HH24:MI')||' to '||to_char(v_at2 at time zone 'Asia/Kolkata','DD Mon HH24:MI'),'Shift',v_text);
      else
        v_title:='Return slot to planning'; v_effect:='Takes the slot off the press as a draft so a planner can schedule it later. The original plan is kept in history.';
      end if;
      if pj.order_id is not null then v_warn:=v_warn||jsonb_build_array('Review the affected order promise separately; no delivery date changes automatically.'); end if;
    end if;

  -- NOV-030 ------------------------------------------------------------------------------------
  elsif a='count.open' then
    v_text:=private.assurance_text(p_mutation,'location',1,120);
    if jsonb_typeof(p_mutation->'blind') is distinct from 'boolean' then raise exception 'NOV: Choose whether counters see expected quantities.'; end if;
    if exists(select 1 from public.cycle_counts where company_id=p_company and status='open' and lower(location)=lower(v_text)) then raise exception 'NOV: A count is already open for this location.'; end if;
    select count(*),coalesce(jsonb_agg(jsonb_build_object('id',id,'updated',updated_at) order by id),'[]'::jsonb) into v_count,v_val from public.profile_stock_batches
      where company_id=p_company and dealer_id is null and status in ('available','reserved') and lower(btrim(location))=lower(v_text);
    if v_count=0 then raise exception 'NOV: No stock bundles are recorded at this location.'; end if;
    if v_count>200 then raise exception 'NOV: Narrow the count: at most 200 bundles per count (% found).',v_count; end if;
    v_source:=jsonb_build_object('batches',v_val);
    v_title:='Open a cycle count'; v_effect:='Snapshots the recorded bundles at this location now. Movements after the cutoff are reconciled, not treated as differences. Stock is not frozen.';
    v_facts:=jsonb_build_object('Location',v_text,'Bundles in scope',v_count,'Blind count',(p_mutation->>'blind')::boolean);
  elsif a in ('count.record','count.close') then
    if p_lock then perform 1 from public.cycle_counts where id=(p_mutation->>'count_id')::uuid and company_id=p_company for update; end if;
    select * into cc from public.cycle_counts where id=(p_mutation->>'count_id')::uuid and company_id=p_company;
    if cc.id is null then raise exception 'NOV: The count is unavailable.'; end if;
    if cc.status<>'open' then raise exception 'NOV: This count is closed.'; end if;
    if a='count.close' then
      select count(*) into v_count from public.cycle_count_lines where company_id=p_company and count_id=cc.id and status in ('pending','difference','moved','unlisted','recount');
      if v_count>0 then raise exception 'NOV: % line(s) still need counting or review before the count can close.',v_count; end if;
      v_source:=jsonb_build_object('count',cc.id);
      v_title:='Close cycle count'; v_effect:='Closes the count with its observations, reviews and adjustments kept.';
      v_facts:=jsonb_build_object('Location',cc.location,'Adjusted lines',(select count(*) from public.cycle_count_lines where count_id=cc.id and status='adjusted'));
    else
      if (p_mutation ? 'line_id')=(p_mutation ? 'unlisted_label') then raise exception 'NOV: Count either a listed bundle or record one unlisted bundle.'; end if;
      v_num:=private.assurance_number(p_mutation,'counted_pieces',0,1000000,0);
      if p_mutation ? 'counted_kg' then perform private.assurance_number(p_mutation,'counted_kg',0,10000000,3); end if;
      if p_mutation ? 'line_id' then
        if p_lock then perform 1 from public.cycle_count_lines where id=(p_mutation->>'line_id')::uuid and company_id=p_company for update; end if;
        select * into cl from public.cycle_count_lines where id=(p_mutation->>'line_id')::uuid and company_id=p_company and count_id=cc.id;
        if cl.id is null then raise exception 'NOV: Choose a line of this count.'; end if;
        if cl.status not in ('pending','recount') then raise exception 'NOV: This bundle is already counted. A reviewer can request a recount.'; end if;
        if cl.status='recount' and exists(select 1 from public.cycle_count_observations where line_id=cl.id and counted_by=p_actor) then raise exception 'NOV: A recount must be made by a different person.'; end if;
        v_source:=jsonb_build_object('line',cl.id,'status',cl.status,'rounds',(select count(*) from public.cycle_count_observations where line_id=cl.id));
        v_facts:=jsonb_build_object('Bundle',coalesce(cl.batch_snapshot->>'bundle_number','bundle'),'Counted pieces',v_num,'Counted kg',coalesce(trim_scale((p_mutation->>'counted_kg')::numeric)||' kg','not weighed'));
      else
        v_text:=private.assurance_text(p_mutation,'unlisted_label',2,80);
        if exists(select 1 from public.cycle_count_lines where count_id=cc.id and lower(unlisted_label)=lower(v_text)) then raise exception 'NOV: This unlisted bundle is already recorded in the count.'; end if;
        v_source:=jsonb_build_object('count',cc.id,'unlisted',lower(v_text));
        v_facts:=jsonb_build_object('Unlisted bundle',v_text,'Counted pieces',v_num);
        v_warn:=v_warn||jsonb_build_array('Unlisted stock is recorded for review. It is not added to stock here.');
      end if;
      v_title:='Record count observation'; v_effect:='Records what was physically counted. Stock balances are not changed by counting.';
    end if;
  elsif a='count.review' then
    if p_lock then perform 1 from public.cycle_count_lines where id=(p_mutation->>'line_id')::uuid and company_id=p_company for update; end if;
    select * into cl from public.cycle_count_lines where id=(p_mutation->>'line_id')::uuid and company_id=p_company;
    if cl.id is null then raise exception 'NOV: The count line is unavailable.'; end if;
    select * into cc from public.cycle_counts where id=cl.count_id and company_id=p_company;
    if cc.status<>'open' then raise exception 'NOV: This count is closed.'; end if;
    if exists(select 1 from public.cycle_count_observations where line_id=cl.id and counted_by=p_actor) then raise exception 'NOV: The reviewer must be independent of the people who counted.'; end if;
    v_text:=p_mutation->>'decision';
    if not ((cl.status='difference' and v_text in ('adjust','recount','no_change')) or (cl.status='moved' and v_text in ('accept_movement','recount'))
      or (cl.status='unlisted' and v_text='no_change') or (cl.status='pending' and v_text='not_counted')) then
      raise exception 'NOV: A line that is % cannot be reviewed as %.',replace(cl.status,'_',' '),replace(coalesce(v_text,''),'_',' '); end if;
    select jsonb_agg(jsonb_build_object('round',round,'pieces',counted_pieces,'kg',counted_kg) order by round desc) into v_val from public.cycle_count_observations where line_id=cl.id;
    v_source:=jsonb_build_object('line',cl.id,'status',cl.status,'observations',v_val);
    v_facts:=jsonb_build_object('Bundle',coalesce(cl.unlisted_label,cl.batch_snapshot->>'bundle_number'),'Expected',coalesce(cl.expected_pieces::text,'not listed')||' pcs','Decision',replace(v_text,'_',' '));
    if v_text='adjust' then
      if jsonb_array_length(v_val)<2 or (v_val->0->>'pieces')<>(v_val->1->>'pieces') then raise exception 'NOV: Confirm the difference with an independent recount before adjusting.'; end if;
      if (v_val->0->>'pieces')::integer=0 then raise exception 'NOV: A bundle counted as missing is written off through the stock workflow, not adjusted here.'; end if;
      if p_lock then perform 1 from public.profile_stock_batches where id=cl.profile_stock_batch_id and company_id=p_company for update; end if;
      select * into sb from public.profile_stock_batches where id=cl.profile_stock_batch_id and company_id=p_company;
      if sb.updated_at>cc.cutoff_at or sb.status not in ('available','reserved') then raise exception 'NOV: The bundle changed after the count cutoff. Review it as a movement instead.'; end if;
      v_num:=coalesce((v_val->0->>'kg')::numeric,case when cl.expected_pieces>0 then round(cl.expected_kg*(v_val->0->>'pieces')::numeric/cl.expected_pieces,3) end);
      if v_num is null or v_num<=0 then raise exception 'NOV: Weigh the bundle; its weight cannot be derived from the count.'; end if;
      v_source:=v_source||jsonb_build_object('batch',jsonb_build_object('id',sb.id,'pieces',sb.quantity_pieces,'kg',sb.total_weight_kg,'updated',sb.updated_at),'new_kg',v_num);
      v_title:='Approve stock adjustment'; v_effect:='Corrects the bundle to the confirmed count. The before and after quantities, counts and your approval are kept.';
      v_facts:=v_facts||jsonb_build_object('Before',sb.quantity_pieces||' pcs / '||trim_scale(sb.total_weight_kg)||' kg','After',(v_val->0->>'pieces')||' pcs / '||trim_scale(v_num)||' kg',
        'Weight basis',case when v_val->0->>'kg' is null then 'pro rata from the counted pieces' else 'weighed at recount' end);
    else
      v_title:='Review count line'; v_effect:=case v_text when 'recount' then 'Requests an independent recount of this bundle.' when 'accept_movement' then 'Accepts that the bundle moved during the count; no adjustment.'
        when 'not_counted' then 'Records that this bundle was not counted in this count.' else 'Closes the line without changing stock, with your reason.' end;
    end if;

  -- NOV-033 ------------------------------------------------------------------------------------
  elsif a in ('pack.link','pack.waive','pack.issue') then
    if p_lock then perform 1 from public.dispatches where id=(p_mutation->>'dispatch_id')::uuid and company_id=p_company for update; end if;
    select * into ds from public.dispatches where id=(p_mutation->>'dispatch_id')::uuid and company_id=p_company;
    if ds.id is null then raise exception 'NOV: The dispatch is unavailable.'; end if;
    v_bal:=private.pack_readiness(p_company,ds.id);
    v_source:=jsonb_build_object('dispatch',ds.id,'readiness',v_bal);
    v_facts:=jsonb_build_object('Dispatch',ds.dispatch_number,'Outstanding mandatory requirements',v_bal->'missing');
    if a='pack.link' then
      if not exists(select 1 from jsonb_array_elements(v_bal->'items') x where x->>'requirement_id'=p_mutation->>'requirement_id') then raise exception 'NOV: Choose a requirement that applies to this dispatch.'; end if;
      select to_jsonb(doc) into v_val from public.technical_documents doc where doc.id=(p_mutation->>'document_id')::uuid and doc.company_id=p_company;
      if v_val is null or (v_role not in ('owner','admin') and v_val->>'document_type' not in ('die_drawing','profile_drawing','material_test_certificate','quality_inspection_report','customer_approval_document','technical_data_sheet','compliance_certificate')) then raise exception 'NOV: The document is unavailable.'; end if;
      if exists(select 1 from public.pack_evidence_links where company_id=p_company and dispatch_id=ds.id and requirement_id=(p_mutation->>'requirement_id')::uuid and document_id=(p_mutation->>'document_id')::uuid) then
        raise exception 'NOV: This document is already linked to the requirement.'; end if;
      v_title:='Link evidence to a requirement'; v_effect:='Links the document as evidence. It satisfies the requirement only while the document itself is approved.';
      v_facts:=v_facts||jsonb_build_object('Document',v_val->>'file_name','Document status',v_val->>'approval_status');
      if v_val->>'approval_status'<>'approved' then v_warn:=v_warn||jsonb_build_array(format('This document is %s and will not satisfy the requirement until approved.',v_val->>'approval_status')); end if;
      select o.id into v_id from public.orders o where o.id=ds.order_id;
      if not ((v_val->>'linked_entity_type' in ('dispatch') and (v_val->>'linked_entity_id')::uuid=ds.id) or (v_val->>'linked_entity_type'='order' and (v_val->>'linked_entity_id')::uuid=v_id)) then
        v_warn:=v_warn||jsonb_build_array('The document is not filed against this dispatch or its order. Check it covers this shipment.'); end if;
    elsif a='pack.waive' then
      v_text:=p_mutation->>'requirement_key';
      select x into v_val from jsonb_array_elements(v_bal->'items') x where x->>'key'=v_text;
      if v_val is null then raise exception 'NOV: Choose a requirement of this dispatch.'; end if;
      if v_val->>'state' in ('satisfied','deviation_authorized') then raise exception 'NOV: This requirement needs no deviation.'; end if;
      v_title:='Authorize a requirement deviation'; v_effect:='Records an authorized deviation. The pack will show it as a deviation, not as met.';
      v_facts:=v_facts||jsonb_build_object('Requirement',v_val->>'label','Current state',v_val->>'state');
    else
      if not (v_bal->>'ready')::boolean then raise exception 'NOV: % mandatory requirement(s) are outstanding; the pack cannot be issued.',v_bal->>'missing'; end if;
      select coalesce(max(version),0) into v_count from public.quality_pack_issues where company_id=p_company and dispatch_id=ds.id;
      v_source:=v_source||jsonb_build_object('latest_version',v_count);
      v_title:='Issue quality document pack'; v_effect:='Issues a versioned manifest of the approved evidence for this dispatch. A previously issued version is marked replaced.';
      v_facts:=v_facts||jsonb_build_object('Version',v_count+1,'Items',jsonb_array_length(v_bal->'items'),
        'Deviations',(select count(*) from jsonb_array_elements(v_bal->'items') x where x->>'state'='deviation_authorized'));
    end if;
  elsif a='pack.withdraw' then
    select to_jsonb(q) into v_val from public.quality_pack_issues q where q.id=(p_mutation->>'id')::uuid and q.company_id=p_company;
    if v_val is null then raise exception 'NOV: The pack is unavailable.'; end if;
    if v_val->>'status'<>'issued' then raise exception 'NOV: Only the current issued pack can be withdrawn.'; end if;
    v_source:=jsonb_build_object('pack',v_val->'id','status',v_val->'status');
    v_title:='Withdraw quality pack'; v_effect:='Marks the issued pack withdrawn. Its manifest is kept.';
    v_facts:=jsonb_build_object('Version',v_val->'version');

  -- NOV-038 ------------------------------------------------------------------------------------
  elsif a='return.authorize' then
    if p_lock then perform 1 from public.packing_list_items where id=(p_mutation->>'packing_item_id')::uuid and company_id=p_company for update; end if;
    select * into pl from public.packing_list_items where id=(p_mutation->>'packing_item_id')::uuid and company_id=p_company;
    if pl.id is null then raise exception 'NOV: The bundle is unavailable.'; end if;
    select * into ds from public.dispatches where id=pl.dispatch_id and company_id=p_company;
    if ds.actual_dispatched_at is null then raise exception 'NOV: Only shipped bundles can be returned.'; end if;
    if p_mutation->>'response' not in ('credit','replacement','rework_return','claim_review') then raise exception 'NOV: Choose the approved response.'; end if;
    v_num:=private.assurance_number(p_mutation,'expected_kg',0.001,1000000,3);
    if exists(select 1 from public.return_authorizations where company_id=p_company and packing_list_item_id=pl.id and status='authorized') then raise exception 'NOV: A return is already authorized for this bundle.'; end if;
    v_num2:=private.packing_net_kg(pl)-(select coalesce(sum(expected_kg),0) from public.return_authorizations where company_id=p_company and packing_list_item_id=pl.id and status<>'rejected');
    if v_num>v_num2+0.0005 then raise exception 'NOV: Only % kg of this bundle remains available for a return authorization.',trim_scale(greatest(v_num2,0)); end if;
    v_source:=jsonb_build_object('bundle',pl.id,'available',v_num2);
    v_title:='Authorize a customer return'; v_effect:='Authorizes the return. Receipt and inspection use the connected return workflow; returned material is not usable until QC releases it.';
    v_facts:=jsonb_build_object('Dispatch',ds.dispatch_number,'Bundle',pl.bundle_number,'Expected',trim_scale(v_num)||' kg','Response',replace(p_mutation->>'response','_',' '));
  elsif a in ('return.link','return.close','return.reject') then
    if p_lock then perform 1 from public.return_authorizations where id=(p_mutation->>'id')::uuid and company_id=p_company for update; end if;
    select * into ra from public.return_authorizations where id=(p_mutation->>'id')::uuid and company_id=p_company;
    if ra.id is null then raise exception 'NOV: The return authorization is unavailable.'; end if;
    if ra.status<>'authorized' then raise exception 'NOV: This return is already %.',ra.status; end if;
    v_bal:=private.return_balance(p_company,ra.id);
    v_source:=jsonb_build_object('authorization',ra.id,'balance',v_bal);
    v_facts:=jsonb_build_object('Expected',trim_scale(ra.expected_kg)||' kg','Received',trim_scale((v_bal->>'received_kg')::numeric)||' kg','Still owed',trim_scale((v_bal->>'owed_kg')::numeric)||' kg');
    if a='return.link' then
      v_text:=p_mutation->>'link_type';
      if v_text not in ('replacement_dispatch','replacement_job','credit_note') then raise exception 'NOV: Choose what resolves the return.'; end if;
      if exists(select 1 from public.return_resolution_links where company_id=p_company and link_type=v_text and target_id=(p_mutation->>'target_id')::uuid) then raise exception 'NOV: This record already resolves a return.'; end if;
      if v_text='credit_note' then
        if ra.response<>'credit' then raise exception 'NOV: This return was authorized for %, not credit.',replace(ra.response,'_',' '); end if;
        if not exists(select 1 from public.credit_notes where id=(p_mutation->>'target_id')::uuid and company_id=p_company and dispatch_id=ra.dispatch_id and status='issued') then
          raise exception 'NOV: Choose an issued credit note for this dispatch.'; end if;
        select coalesce(sum(quantity_kg),0) into v_num from public.credit_note_packing_lines where company_id=p_company and credit_note_id=(p_mutation->>'target_id')::uuid and packing_list_item_id=ra.packing_list_item_id;
        if v_num<=0 then raise exception 'NOV: This credit note does not credit the returned bundle.'; end if;
        if p_mutation ? 'quantity_kg' then raise exception 'NOV: The credited quantity is taken from the credit note.'; end if;
      else
        if ra.response not in ('replacement','rework_return') then raise exception 'NOV: This return was authorized for %, not replacement.',replace(ra.response,'_',' '); end if;
        v_num:=private.assurance_number(p_mutation,'quantity_kg',0.001,1000000,3);
        if v_text='replacement_dispatch' then
          select * into ds from public.dispatches where id=(p_mutation->>'target_id')::uuid and company_id=p_company;
          if ds.id is null or ds.order_id<>ra.order_id or ds.id=ra.dispatch_id or ds.actual_dispatched_at is null then raise exception 'NOV: Choose a later departed dispatch of the same order.'; end if;
          select * into pl from public.packing_list_items where id=ra.packing_list_item_id;
          if v_num>(select coalesce(sum(private.packing_net_kg(x)),0) from public.packing_list_items x where x.company_id=p_company and x.dispatch_id=ds.id
              and (x.order_item_id is not distinct from pl.order_item_id) and x.profile_id=pl.profile_id)+0.0005 then raise exception 'NOV: The replacement dispatch carries less of this item than the quantity entered.'; end if;
        else
          if not exists(select 1 from public.production_jobs where id=(p_mutation->>'target_id')::uuid and company_id=p_company and order_id=ra.order_id and status<>'cancelled') then
            raise exception 'NOV: Choose a live production job of the same order.'; end if;
        end if;
      end if;
      if v_text<>'replacement_job' and v_num>(v_bal->>'owed_kg')::numeric+0.0005 then raise exception 'NOV: Only % kg is still owed on this return.',trim_scale((v_bal->>'owed_kg')::numeric); end if;
      v_source:=v_source||jsonb_build_object('target',p_mutation->>'target_id','kg',v_num);
      v_title:='Link return resolution'; v_effect:=case v_text when 'replacement_job' then 'Records the replacement in production. It resolves the return only when a replacement dispatch is linked.'
        else 'Counts this record towards what the company owes the customer for the return.' end;
      v_facts:=v_facts||jsonb_build_object('Resolution',replace(v_text,'_',' '),'Quantity',trim_scale(v_num)||' kg');
    elsif a='return.close' then
      if (v_bal->>'undisposed_receipts')::integer>0 then raise exception 'NOV: Inspect and dispose all received material before closing the return.'; end if;
      if ra.response='claim_review' then raise exception 'NOV: Reject the claim or authorize a new return with an approved response.'; end if;
      if (v_bal->>'owed_kg')::numeric>0.0005 then raise exception 'NOV: % kg is still owed to the customer.',trim_scale((v_bal->>'owed_kg')::numeric); end if;
      v_title:='Close return'; v_effect:='Closes the return with quantities, resolution and financial treatment reconciled.';
    else
      if (v_bal->>'undisposed_receipts')::integer>0 then raise exception 'NOV: Inspect and dispose all received material before rejecting the claim.'; end if;
      if (v_bal->>'resolved_kg')::numeric>0 or (v_bal->>'credited_kg')::numeric>0 or (v_bal->>'replacement_dispatched_kg')::numeric>0 then raise exception 'NOV: A resolution is already linked; close the return instead.'; end if;
      v_title:='Reject return claim'; v_effect:='Closes the authorization as rejected. Any received material keeps its inspected disposition.';
    end if;
  else raise exception 'NOV: Choose a supported action.';
  end if;
  return jsonb_build_object('source',v_source,'review',jsonb_build_object('title',v_title,'effect',v_effect,'warnings',v_warn,'facts',v_facts));
end $$;
revoke all on function private.assurance_context(uuid,uuid,jsonb,boolean) from public,anon,authenticated;

create function private.assurance_impact_review(p_company uuid,p_instrument uuid,p_trigger text,p_exclude uuid) returns uuid
language plpgsql security definer set search_path=public,private as $$
declare v_from timestamptz; v_id uuid;
begin
  select (k.checked_on::timestamp at time zone 'Asia/Kolkata') into v_from from public.instrument_checks k
    where k.company_id=p_company and k.instrument_id=p_instrument and k.result='pass' and k.id is distinct from p_exclude order by k.checked_on desc,k.recorded_at desc limit 1;
  insert into public.instrument_impact_reviews(company_id,instrument_id,trigger,window_from,window_to,affected)
  values(p_company,p_instrument,p_trigger,v_from,now(),(select coalesce(jsonb_agg(jsonb_build_object('result_id',b.inspection_result_id,'inspection_id',r.inspection_id,'measured_at',b.measured_at,
      'evidence_state',b.evidence_state) order by b.measured_at),'[]'::jsonb) from (select * from public.instrument_result_bindings z where z.company_id=p_company and z.instrument_id=p_instrument
      and (v_from is null or z.measured_at>=v_from) order by z.measured_at limit 200) b join public.inspection_results r on r.id=b.inspection_result_id)) returning id into v_id;
  return v_id;
end $$;
revoke all on function private.assurance_impact_review(uuid,uuid,text,uuid) from public,anon,authenticated;

create function private.assurance_apply(p_company uuid,p_actor uuid,p_request uuid,p_mutation jsonb,p_context jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; n text:=btrim(p_mutation->>'note'); v_id uuid; v_id2 uuid; v_x jsonb; v_role text; v_name text; v_num numeric; v_count integer;
  dr public.drawing_revisions; dd public.delivery_dispositions; pl public.packing_list_items; cm public.competencies; cl public.cycle_count_lines; cc public.cycle_counts; sb public.profile_stock_batches;
  v_line public.purchase_receipt_lines; v_po public.purchase_orders;
begin
  select role,coalesce(nullif(full_name,''),'Employee') into v_role,v_name from public.app_users where id=p_actor and company_id=p_company;
  if a='drawing.register' then
    insert into public.drawing_revisions(id,company_id,drawing_id,profile_id,revision_label,file_sha256,file_name,technical_note,customer_approval_required,supersedes_id,registered_by)
    values(p_request,p_company,(p_mutation->>'drawing_id')::uuid,nullif(p_mutation->>'profile_id','')::uuid,btrim(p_mutation->>'revision_label'),lower(btrim(p_mutation->>'file_sha256')),
      nullif(btrim(coalesce(p_mutation->>'file_name','')),''),nullif(btrim(coalesce(p_mutation->>'technical_note','')),''),(p_mutation->>'customer_approval_required')::boolean,
      nullif(p_context->'source'->>'latest','')::uuid,p_actor);
    perform private.assurance_record(p_company,'drawings',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Revision '||btrim(p_mutation->>'revision_label')||' registered','href','/tasks/assurance/drawings/'||p_request,'message','Send it to the customer or release it once approved.');
  elsif a in ('drawing.customer','drawing.deviation','drawing.withdraw') then
    v_id:=(p_mutation->>'revision_id')::uuid;
    insert into public.drawing_revision_events(company_id,revision_id,event,evidence,customer_contact,deviation_job_id,valid_until,recorded_by)
    values(p_company,v_id,case a when 'drawing.customer' then p_mutation->>'event' when 'drawing.deviation' then 'deviation_permitted' else 'withdrawn' end,
      case when p_mutation ? 'evidence' then btrim(p_mutation->>'evidence') else n end,nullif(btrim(coalesce(p_mutation->>'customer_contact','')),''),
      nullif(p_mutation->>'job_id','')::uuid,nullif(p_mutation->>'valid_until','')::date,p_actor);
    if a='drawing.customer' then
      update public.technical_drawings set approval_status=case p_mutation->>'event' when 'submitted' then 'sent_to_customer' when 'customer_query' then 'under_review'
        when 'customer_approved' then 'customer_approved' else 'rejected' end,updated_at=now()
      where id=(select drawing_id from public.drawing_revisions where id=v_id) and company_id=p_company;
    end if;
    perform private.assurance_record(p_company,'drawings',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label',case a when 'drawing.customer' then 'Customer event recorded' when 'drawing.deviation' then 'Deviation permitted' else 'Revision withdrawn' end,
      'href','/tasks/assurance/drawings/'||v_id,'message','The revision history now shows this event.');
  elsif a='drawing.release' then
    select * into dr from public.drawing_revisions where id=(p_mutation->>'revision_id')::uuid and company_id=p_company;
    for v_id in select r.id from public.drawing_revisions r where r.company_id=p_company and r.profile_id=dr.profile_id and r.id<>dr.id and private.drawing_state(p_company,r.id)='released' loop
      insert into public.drawing_revision_events(company_id,revision_id,event,evidence,recorded_by) values(p_company,v_id,'superseded','Superseded by the release of revision '||dr.revision_label,p_actor);
      perform private.assurance_record(p_company,'drawings',v_id,'drawing.superseded',p_actor,n,jsonb_build_object('Superseded by',dr.revision_label));
    end loop;
    insert into public.drawing_revision_events(company_id,revision_id,event,evidence,recorded_by) values(p_company,dr.id,'released',n,p_actor);
    update public.technical_drawings set approval_status=case when dr.customer_approval_required then 'customer_approved' else 'approved_internal' end,approved_by=p_actor,approved_at=now(),updated_at=now()
      where id=dr.drawing_id and company_id=p_company;
    perform private.assurance_record(p_company,'drawings',dr.id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Revision '||dr.revision_label||' released','href','/tasks/assurance/drawings/'||dr.id,'message','Production may first start only on this revision for the profile.');
  elsif a in ('incoming.dispose','incoming.return') then
    insert into public.incoming_dispositions(company_id,receipt_line_id,disposition,quantity,certificate_ref,evidence,decided_by,decided_role)
    values(p_company,(p_mutation->>'receipt_line_id')::uuid,case a when 'incoming.return' then 'returned' else p_mutation->>'disposition' end,(p_mutation->>'quantity')::numeric,
      nullif(btrim(coalesce(p_mutation->>'certificate_ref','')),''),btrim(p_mutation->>'evidence'),p_actor,v_role);
    perform private.assurance_record(p_company,'incoming',(p_mutation->>'receipt_line_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Quality decision recorded','href','/tasks/assurance/incoming/'||(p_mutation->>'receipt_line_id'),'message','The receipt line balance now includes this decision.');
  elsif a='incoming.release' then
    select * into v_line from public.purchase_receipt_lines where id=(p_mutation->>'receipt_line_id')::uuid and company_id=p_company;
    select * into v_po from public.purchase_orders where id=v_line.purchase_order_id and company_id=p_company;
    insert into public.billet_batches(company_id,batch_number,supplier_id,alloy,temper,diameter_mm,total_weight_kg,available_weight_kg,heat_number,received_date,status,notes)
    values(p_company,upper(btrim(p_mutation->>'batch_number')),v_po.vendor_id,upper(btrim(p_mutation->>'alloy')),upper(btrim(p_mutation->>'temper')),nullif(p_mutation->>'diameter_mm','')::numeric,
      (p_mutation->>'quantity_kg')::numeric,(p_mutation->>'quantity_kg')::numeric,nullif(btrim(coalesce(p_mutation->>'heat_number','')),''),
      (select receipt_date from public.purchase_receipts where id=v_line.receipt_id),'available','Released from incoming acceptance of '||v_po.po_number) returning id into v_id;
    insert into public.incoming_stock_releases(company_id,receipt_line_id,billet_batch_id,quantity_kg,released_by) values(p_company,v_line.id,v_id,(p_mutation->>'quantity_kg')::numeric,p_actor);
    perform private.assurance_record(p_company,'incoming',v_line.id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Billet batch '||upper(btrim(p_mutation->>'batch_number'))||' released','href','/tasks/assurance/incoming/'||v_line.id,'message','The accepted material is now available billet stock.');
  elsif a='incoming.reverse' then
    update public.incoming_dispositions set reversed_by=p_actor,reversed_at=now(),reverse_note=n where id=(p_mutation->>'id')::uuid and company_id=p_company and reversed_at is null returning receipt_line_id into v_id;
    if v_id is null then raise exception 'NOV: This decision is already reversed.'; end if;
    perform private.assurance_record(p_company,'incoming',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Quality decision reversed','href','/tasks/assurance/incoming/'||v_id,'message','The quantity awaits a new decision.');
  elsif a='delivery.record' then
    select * into pl from public.packing_list_items where id=(p_mutation->>'packing_item_id')::uuid and company_id=p_company;
    insert into public.delivery_dispositions(company_id,dispatch_id,packing_list_item_id,disposition,quantity_kg,receiver_name,evidence,owner_id,recorded_by)
    values(p_company,pl.dispatch_id,pl.id,p_mutation->>'disposition',(p_mutation->>'quantity_kg')::numeric,btrim(p_mutation->>'receiver_name'),btrim(p_mutation->>'evidence'),p_actor,p_actor);
    perform private.assurance_record(p_company,'deliveries',pl.dispatch_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Delivery disposition recorded','href','/tasks/assurance/deliveries/'||pl.dispatch_id,'message',case p_mutation->>'disposition' when 'accepted' then 'Accepted quantity recorded.' else 'The exception is open and owned by you.' end);
  elsif a='delivery.resolve' then
    select * into dd from public.delivery_dispositions where id=(p_mutation->>'id')::uuid and company_id=p_company;
    if p_mutation->>'resolution'='return_expected' then
      insert into public.return_authorizations(id,company_id,dispatch_id,packing_list_item_id,order_id,expected_kg,response,reason,source_disposition_id,authorized_by)
      values(p_request,p_company,dd.dispatch_id,dd.packing_list_item_id,(select order_id from public.dispatches where id=dd.dispatch_id),dd.quantity_kg,p_mutation->>'response',n,dd.id,p_actor);
      perform private.assurance_record(p_company,'returns',p_request,'return.authorize',p_actor,n,p_context->'review'->'facts');
    end if;
    update public.delivery_dispositions set resolution=p_mutation->>'resolution',resolution_note=n,resolved_by=p_actor,resolved_at=now(),
      return_authorization_id=case when p_mutation->>'resolution'='return_expected' then p_request end where id=dd.id and resolution is null and reversed_at is null;
    if not found then raise exception 'NOV: This exception is already resolved.'; end if;
    perform private.assurance_record(p_company,'deliveries',dd.dispatch_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Delivery exception resolved','href',case when p_mutation->>'resolution'='return_expected' then '/tasks/assurance/returns/'||p_request else '/tasks/assurance/deliveries/'||dd.dispatch_id end,
      'message',case when p_mutation->>'resolution'='return_expected' then 'A return is authorized for this quantity.' else 'The resolution is recorded with its owner.' end);
  elsif a='delivery.reverse' then
    update public.delivery_dispositions set reversed_by=p_actor,reversed_at=now(),reverse_note=n where id=(p_mutation->>'id')::uuid and company_id=p_company and reversed_at is null and resolution is null
      returning dispatch_id into v_id;
    if v_id is null then raise exception 'NOV: This disposition can no longer be reversed.'; end if;
    perform private.assurance_record(p_company,'deliveries',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Delivery disposition reversed','href','/tasks/assurance/deliveries/'||v_id,'message','The quantity is unconfirmed again.');
  elsif a='change.propose' then
    insert into public.order_change_proposals(id,company_id,order_id,order_item_id,changes,reason,line_fingerprint,proposed_by)
    values(p_request,p_company,(select order_id from public.order_items where id=(p_mutation->>'order_item_id')::uuid),(p_mutation->>'order_item_id')::uuid,
      p_context->'source'->'changes',n,md5((p_context->'source'->'line')::text),p_actor);
    for v_x in select * from jsonb_array_elements(p_context->'source'->'impacts') loop
      insert into public.order_change_impacts(company_id,proposal_id,domain,record_type,record_id,label,classification,owner_role,required_action)
      values(p_company,p_request,v_x->>'domain',v_x->>'record_type',nullif(v_x->>'record_id','')::uuid,v_x->>'label',v_x->>'classification',v_x->>'owner_role',v_x->>'required_action');
    end loop;
    perform private.assurance_record(p_company,'revisions',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Change assessed','href','/tasks/assurance/revisions/'||p_request,'message','Another authorized person decides on the proposal.');
  elsif a='change.decide' then
    update public.order_change_proposals set status=p_mutation->>'decision',decided_by=p_actor,decided_at=now(),decision_note=n where id=(p_mutation->>'id')::uuid and company_id=p_company and status='assessed';
    if not found then raise exception 'NOV: This proposal has already been decided.'; end if;
    if p_mutation->>'decision'='abandoned' then
      update public.order_change_impacts set status='not_required',resolved_by=p_actor,resolved_at=now(),resolution_note='Proposal abandoned: '||n where company_id=p_company and proposal_id=(p_mutation->>'id')::uuid and status='open';
    elsif not exists(select 1 from public.order_change_impacts where company_id=p_company and proposal_id=(p_mutation->>'id')::uuid and status='open') then
      update public.order_change_proposals set status='completed' where id=(p_mutation->>'id')::uuid;
    end if;
    perform private.assurance_record(p_company,'revisions',(p_mutation->>'id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Proposal '||(p_mutation->>'decision'),'href','/tasks/assurance/revisions/'||(p_mutation->>'id'),'message',case p_mutation->>'decision' when 'approved'
      then 'Impact owners can now resolve their actions. Update the order line through the order workflow.' else 'The proposal and its impact actions are closed.' end);
  elsif a='change.resolve' then
    update public.order_change_impacts set status=p_mutation->>'outcome',resolved_by=p_actor,resolved_at=now(),resolution_note=n where id=(p_mutation->>'id')::uuid and company_id=p_company and status='open'
      returning proposal_id into v_id;
    if v_id is null then raise exception 'NOV: This impact action is already resolved.'; end if;
    if not exists(select 1 from public.order_change_impacts where company_id=p_company and proposal_id=v_id and status='open') then
      update public.order_change_proposals set status='completed' where id=v_id and status='approved';
    end if;
    perform private.assurance_record(p_company,'revisions',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Impact action resolved','href','/tasks/assurance/revisions/'||v_id,'message','Your team''s handling is recorded.');
  elsif a='capability.criteria' then
    insert into public.qualification_criteria(company_id,competency_id,supervised_required,observed_trial_required,set_by)
    values(p_company,(p_mutation->>'competency_id')::uuid,(p_mutation->>'supervised_required')::integer,(p_mutation->>'observed_trial_required')::boolean,p_actor)
    on conflict(company_id,competency_id) do update set supervised_required=excluded.supervised_required,observed_trial_required=excluded.observed_trial_required,
      revision=qualification_criteria.revision+1,set_by=p_actor,set_at=now();
    perform private.assurance_record(p_company,'capability',(p_mutation->>'competency_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Qualification evidence set','href','/tasks/assurance/capability/'||(p_mutation->>'competency_id'),'message','Future independent qualifications must show this evidence.');
  elsif a='capability.assess' then
    select * into cm from public.competencies where id=(p_mutation->>'competency_id')::uuid and company_id=p_company;
    v_id:=(p_mutation->>'employee_id')::uuid;
    if p_mutation->>'outcome'='independent' then
      perform pg_advisory_xact_lock(hashtextextended(v_id::text||':'||cm.id::text,0));
      update public.employee_competencies set revoked_at=now(),revoked_by=p_actor,revoke_reason='Replaced by an assessed independent grant'
        where company_id=p_company and employee_id=v_id and competency_id=cm.id and revoked_at is null;
      insert into public.employee_competencies(company_id,employee_id,competency_id,level,procedure_revision,granted_by,granted_by_name,expires_at,note)
      values(p_company,v_id,cm.id,'independent',(select revision from public.operating_procedures where id=cm.procedure_id),p_actor,v_name,
        case when cm.validity_months is null then null else now()+make_interval(months=>cm.validity_months) end,left('Assessed: '||n,300)) returning id into v_id2;
    end if;
    insert into public.qualification_assessments(company_id,employee_id,competency_id,assessor_id,outcome,evidence,note,criteria_revision)
    values(p_company,v_id,cm.id,p_actor,p_mutation->>'outcome',p_context->'source'->'evidence'||jsonb_build_object('grant_id',v_id2),n,(p_context->'source'->'criteria'->>'revision')::integer);
    perform private.assurance_record(p_company,'capability',cm.id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Assessment recorded','href','/tasks/assurance/capability/'||cm.id,'message',case p_mutation->>'outcome' when 'independent' then 'Independent qualification granted from demonstrated work.' else 'More supervised practice is recorded.' end);
  elsif a='instrument.register' then
    insert into public.measuring_instruments(company_id,code,name,unit,range_min,range_max,location,registered_by)
    values(p_company,upper(btrim(p_mutation->>'code')),btrim(p_mutation->>'name'),p_mutation->>'unit',(p_mutation->>'range_min')::numeric,(p_mutation->>'range_max')::numeric,
      nullif(btrim(coalesce(p_mutation->>'location','')),''),p_actor) returning id into v_id;
    perform private.assurance_record(p_company,'instruments',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Instrument registered','href','/tasks/assurance/instruments/'||v_id,'message','Record its check evidence before use.');
  elsif a='instrument.check' then
    insert into public.instrument_checks(company_id,instrument_id,checked_on,valid_until,result,certificate_ref,note,recorded_by)
    values(p_company,(p_mutation->>'instrument_id')::uuid,(p_mutation->>'checked_on')::date,(p_mutation->>'valid_until')::date,p_mutation->>'result',btrim(p_mutation->>'certificate_ref'),n,p_actor) returning id into v_id;
    if p_mutation->>'result'='fail' then perform private.assurance_impact_review(p_company,(p_mutation->>'instrument_id')::uuid,'check_failed',v_id); end if;
    perform private.assurance_record(p_company,'instruments',(p_mutation->>'instrument_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Check evidence recorded','href','/tasks/assurance/instruments/'||(p_mutation->>'instrument_id'),'message',case p_mutation->>'result' when 'fail' then 'An impact review of earlier results is open.' else 'Measurements in the validity period can rely on this evidence.' end);
  elsif a='instrument.withdraw' then
    update public.measuring_instruments set status='withdrawn',withdrawn_at=now(),withdrawn_reason=n where id=(p_mutation->>'instrument_id')::uuid and company_id=p_company and status='active';
    if not found then raise exception 'NOV: This instrument is withdrawn.'; end if;
    perform private.assurance_impact_review(p_company,(p_mutation->>'instrument_id')::uuid,'withdrawn',null);
    perform private.assurance_record(p_company,'instruments',(p_mutation->>'instrument_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Instrument withdrawn','href','/tasks/assurance/instruments/'||(p_mutation->>'instrument_id'),'message','An impact review of results since its last passing check is open.');
  elsif a='instrument.bind' then
    insert into public.instrument_result_bindings(inspection_result_id,company_id,instrument_id,check_id,evidence_state,measured_at,bound_by)
    values((p_mutation->>'result_id')::uuid,p_company,(p_mutation->>'instrument_id')::uuid,nullif(p_context->'source'->'evidence'->>'check_id','')::uuid,p_context->'source'->'evidence'->>'state',
      (select recorded_at from public.inspection_results where id=(p_mutation->>'result_id')::uuid),p_actor);
    perform private.assurance_record(p_company,'instruments',(p_mutation->>'instrument_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Instrument recorded on result','href','/tasks/assurance/instruments/'||(p_mutation->>'instrument_id'),'message','The measurement now carries its instrument and evidence.');
  elsif a='instrument.policy' then
    insert into public.instrument_policies(company_id,mode,set_by) values(p_company,p_mutation->>'mode',p_actor)
    on conflict(company_id) do update set mode=excluded.mode,set_by=p_actor,set_at=now();
    perform private.assurance_record(p_company,'instruments',md5(p_company::text||':instrument-policy')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Instrument policy set','href','/tasks/assurance/database?view=instruments','message','Inspection approvals follow the new policy.');
  elsif a='instrument.review' then
    update public.instrument_impact_reviews set status='reviewed',reviewed_by=p_actor,reviewed_at=now(),review_note=n where id=(p_mutation->>'id')::uuid and company_id=p_company and status='open'
      returning instrument_id into v_id;
    if v_id is null then raise exception 'NOV: This impact review is already closed.'; end if;
    perform private.assurance_record(p_company,'instruments',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Impact review closed','href','/tasks/assurance/instruments/'||v_id,'message','Quality''s conclusion is recorded.');
  elsif a in ('capacity.move','capacity.unplan') then
    v_id:=(p_mutation->>'slot_id')::uuid;
    if a='capacity.move' then
      update public.production_plan_slots set machine_id=(p_mutation->>'machine_id')::uuid,planned_start_at=(p_mutation->>'start_at')::timestamptz,planned_end_at=(p_mutation->>'end_at')::timestamptz,
        shift=btrim(p_mutation->>'shift'),updated_at=now() where id=v_id and company_id=p_company;
    else
      update public.production_plan_slots set status='draft',updated_at=now() where id=v_id and company_id=p_company;
    end if;
    insert into public.capacity_reschedules(company_id,slot_id,unavailability_id,action,previous,next,reason,applied_by)
    values(p_company,v_id,(p_mutation->>'unavailability_id')::uuid,split_part(a,'.',2),p_context->'source'->'slot',
      (select jsonb_build_object('id',s.id,'machine',s.machine_id,'start',s.planned_start_at,'end',s.planned_end_at,'shift',s.shift,'status',s.status) from public.production_plan_slots s where s.id=v_id),n,p_actor);
    perform private.assurance_record(p_company,'capacity',(p_mutation->>'unavailability_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label',case a when 'capacity.move' then 'Slot replanned' else 'Slot returned to planning' end,'href','/tasks/assurance/capacity/'||(p_mutation->>'unavailability_id'),
      'message','The original plan and your reason are kept. Review the order promise separately.');
  elsif a='capacity.review' then
    insert into public.capacity_commitment_reviews(company_id,order_id,unavailability_id,decision,note,reviewed_by)
    values(p_company,(p_mutation->>'order_id')::uuid,(p_mutation->>'unavailability_id')::uuid,p_mutation->>'decision',n,p_actor);
    perform private.assurance_record(p_company,'capacity',(p_mutation->>'unavailability_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Order promise reviewed','href','/tasks/assurance/capacity/'||(p_mutation->>'unavailability_id'),'message','The review is recorded; the dispatch date is unchanged.');
  elsif a='count.open' then
    insert into public.cycle_counts(id,company_id,location,blind,opened_by) values(p_request,p_company,btrim(p_mutation->>'location'),(p_mutation->>'blind')::boolean,p_actor);
    insert into public.cycle_count_lines(company_id,count_id,profile_stock_batch_id,expected_pieces,expected_kg,batch_snapshot)
    select p_company,p_request,b.id,b.quantity_pieces,b.total_weight_kg,jsonb_build_object('bundle_number',b.bundle_number,'profile_code',p.profile_code,'status',b.status,'qc_status',b.qc_status,
      'length_m',b.length_m,'updated_at',b.updated_at,'reserved_for_order_id',b.reserved_for_order_id)
    from public.profile_stock_batches b left join public.aluminium_profiles p on p.id=b.profile_id and p.company_id=b.company_id
    where b.company_id=p_company and b.dealer_id is null and b.status in ('available','reserved') and lower(btrim(b.location))=lower(btrim(p_mutation->>'location'));
    perform private.assurance_record(p_company,'counts',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Cycle count opened','href','/tasks/assurance/counts/'||p_request,'message','Count each bundle; differences are reviewed independently.');
  elsif a='count.record' then
    select * into cc from public.cycle_counts where id=(p_mutation->>'count_id')::uuid and company_id=p_company;
    if p_mutation ? 'unlisted_label' then
      insert into public.cycle_count_lines(company_id,count_id,unlisted_label,status) values(p_company,cc.id,btrim(p_mutation->>'unlisted_label'),'unlisted') returning id into v_id;
      insert into public.cycle_count_observations(company_id,line_id,round,counted_pieces,counted_kg,counted_by,note)
      values(p_company,v_id,1,(p_mutation->>'counted_pieces')::integer,nullif(p_mutation->>'counted_kg','')::numeric,p_actor,n);
    else
      select * into cl from public.cycle_count_lines where id=(p_mutation->>'line_id')::uuid and company_id=p_company;
      select coalesce(max(round),0)+1 into v_count from public.cycle_count_observations where line_id=cl.id;
      insert into public.cycle_count_observations(company_id,line_id,round,counted_pieces,counted_kg,counted_by,note)
      values(p_company,cl.id,v_count,(p_mutation->>'counted_pieces')::integer,nullif(p_mutation->>'counted_kg','')::numeric,p_actor,n);
      select * into sb from public.profile_stock_batches where id=cl.profile_stock_batch_id and company_id=p_company;
      v_num:=nullif(p_mutation->>'counted_kg','')::numeric;
      update public.cycle_count_lines set status=case
          when sb.id is null or sb.updated_at>cc.cutoff_at or sb.status not in ('available','reserved') then 'moved'
          when (p_mutation->>'counted_pieces')::integer=cl.expected_pieces and (v_num is null or abs(v_num-cl.expected_kg)<=greatest(cl.expected_kg*0.005,0.5)) then 'matched'
          else 'difference' end where id=cl.id;
    end if;
    perform private.assurance_record(p_company,'counts',cc.id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Count recorded','href','/tasks/assurance/counts/'||cc.id,'message','The observation is recorded; stock is unchanged.');
  elsif a='count.review' then
    select * into cl from public.cycle_count_lines where id=(p_mutation->>'line_id')::uuid and company_id=p_company;
    if p_mutation->>'decision'='adjust' then
      select * into sb from public.profile_stock_batches where id=cl.profile_stock_batch_id and company_id=p_company;
      v_count:=(p_context->'source'->'observations'->0->>'pieces')::integer; v_num:=(p_context->'source'->>'new_kg')::numeric;
      update public.profile_stock_batches set quantity_pieces=v_count,total_weight_kg=v_num,
        length_m=case when piece_length_m is not null then round(piece_length_m*v_count,3) when quantity_pieces>0 then round(length_m*v_count/quantity_pieces,3) else length_m end
      where id=sb.id and company_id=p_company;
      insert into public.cycle_count_adjustments(line_id,company_id,profile_stock_batch_id,before_state,after_state,approved_by,note)
      values(cl.id,p_company,sb.id,jsonb_build_object('pieces',sb.quantity_pieces,'kg',sb.total_weight_kg,'length_m',sb.length_m),
        (select jsonb_build_object('pieces',quantity_pieces,'kg',total_weight_kg,'length_m',length_m) from public.profile_stock_batches where id=sb.id),p_actor,n);
    end if;
    update public.cycle_count_lines set status=case p_mutation->>'decision' when 'adjust' then 'adjusted' when 'recount' then 'recount' when 'accept_movement' then 'accepted'
      when 'not_counted' then 'not_counted' else 'no_change' end,review_note=n,reviewed_by=p_actor,reviewed_at=now() where id=cl.id;
    perform private.assurance_record(p_company,'counts',cl.count_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Count line reviewed','href','/tasks/assurance/counts/'||cl.count_id,'message',case p_mutation->>'decision' when 'adjust' then 'The bundle now carries the confirmed count.'
      when 'recount' then 'An independent recount is requested.' else 'The review is recorded.' end);
  elsif a='count.close' then
    update public.cycle_counts set status='closed',closed_by=p_actor,closed_at=now(),closure_note=n where id=(p_mutation->>'count_id')::uuid and company_id=p_company and status='open';
    perform private.assurance_record(p_company,'counts',(p_mutation->>'count_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Cycle count closed','href','/tasks/assurance/counts/'||(p_mutation->>'count_id'),'message','The count is closed with its evidence kept.');
  elsif a='pack.link' then
    insert into public.pack_evidence_links(company_id,dispatch_id,requirement_id,document_id,linked_by)
    values(p_company,(p_mutation->>'dispatch_id')::uuid,(p_mutation->>'requirement_id')::uuid,(p_mutation->>'document_id')::uuid,p_actor);
    perform private.assurance_record(p_company,'packs',(p_mutation->>'dispatch_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Evidence linked','href','/tasks/assurance/packs/'||(p_mutation->>'dispatch_id'),'message','The readiness checklist now uses this document.');
  elsif a='pack.waive' then
    insert into public.pack_waivers(company_id,dispatch_id,requirement_key,reason,waived_by) values(p_company,(p_mutation->>'dispatch_id')::uuid,p_mutation->>'requirement_key',n,p_actor);
    perform private.assurance_record(p_company,'packs',(p_mutation->>'dispatch_id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Deviation authorized','href','/tasks/assurance/packs/'||(p_mutation->>'dispatch_id'),'message','The pack shows this requirement as an authorized deviation.');
  elsif a='pack.issue' then
    v_id:=(p_mutation->>'dispatch_id')::uuid;
    update public.quality_pack_issues set status='replaced' where company_id=p_company and dispatch_id=v_id and status='issued';
    insert into public.quality_pack_issues(id,company_id,dispatch_id,version,manifest,issued_by)
    values(p_request,p_company,v_id,(p_context->'source'->>'latest_version')::integer+1,jsonb_build_object('dispatch_number',p_context->'source'->'readiness'->'dispatch_number',
      'order_number',p_context->'source'->'readiness'->'order_number','customer',(select c.customer_name from public.dispatches d join public.orders o on o.id=d.order_id join public.customers c on c.id=o.customer_id where d.id=v_id),
      'version',(p_context->'source'->>'latest_version')::integer+1,'issued_at',now(),
      'items',(select coalesce(jsonb_agg(jsonb_build_object('label',x->>'label','kind',x->>'kind','state',x->>'state','evidence',x->'evidence','deviation',x->'waiver')),'[]'::jsonb) from jsonb_array_elements(p_context->'source'->'readiness'->'items') x)),p_actor);
    perform private.assurance_record(p_company,'packs',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Quality pack issued','href','/tasks/assurance/packs/'||v_id,'message','The versioned manifest is issued from approved evidence.');
  elsif a='pack.withdraw' then
    update public.quality_pack_issues set status='withdrawn',withdrawn_by=p_actor,withdrawn_at=now(),withdraw_note=n where id=(p_mutation->>'id')::uuid and company_id=p_company and status='issued' returning dispatch_id into v_id;
    if v_id is null then raise exception 'NOV: Only the current issued pack can be withdrawn.'; end if;
    perform private.assurance_record(p_company,'packs',v_id,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Quality pack withdrawn','href','/tasks/assurance/packs/'||v_id,'message','The manifest is kept as withdrawn.');
  elsif a='return.authorize' then
    select * into pl from public.packing_list_items where id=(p_mutation->>'packing_item_id')::uuid and company_id=p_company;
    insert into public.return_authorizations(id,company_id,dispatch_id,packing_list_item_id,order_id,expected_kg,response,reason,authorized_by)
    values(p_request,p_company,pl.dispatch_id,pl.id,(select order_id from public.dispatches where id=pl.dispatch_id),(p_mutation->>'expected_kg')::numeric,p_mutation->>'response',n,p_actor);
    perform private.assurance_record(p_company,'returns',p_request,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Return authorized','href','/tasks/assurance/returns/'||p_request,'message','Receive and inspect the material through connected returns.');
  elsif a='return.link' then
    insert into public.return_resolution_links(company_id,authorization_id,link_type,target_id,quantity_kg,linked_by)
    values(p_company,(p_mutation->>'id')::uuid,p_mutation->>'link_type',(p_mutation->>'target_id')::uuid,(p_context->'source'->>'kg')::numeric,p_actor);
    perform private.assurance_record(p_company,'returns',(p_mutation->>'id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label','Resolution linked','href','/tasks/assurance/returns/'||(p_mutation->>'id'),'message','The return balance now includes this resolution.');
  elsif a in ('return.close','return.reject') then
    update public.return_authorizations set status=case a when 'return.close' then 'closed' else 'rejected' end,received_kg_at_close=(p_context->'source'->'balance'->>'received_kg')::numeric,
      closed_by=p_actor,closed_at=clock_timestamp(),closure_note=n where id=(p_mutation->>'id')::uuid and company_id=p_company and status='authorized';
    if not found then raise exception 'NOV: This return is already closed.'; end if;
    perform private.assurance_record(p_company,'returns',(p_mutation->>'id')::uuid,a,p_actor,n,p_context->'review'->'facts');
    return jsonb_build_object('label',case a when 'return.close' then 'Return closed' else 'Claim rejected' end,'href','/tasks/assurance/returns/'||(p_mutation->>'id'),'message','The final resolution is recorded.');
  end if;
  raise exception 'NOV: Choose a supported action.';
end $$;
revoke all on function private.assurance_apply(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

create function private.assurance_outcome(r public.assurance_requests) returns jsonb language sql immutable set search_path=public,private as $$
  select jsonb_build_object('request_id',r.request_id,'state',r.state,'fingerprint',r.fingerprint,'expires_at',r.expires_at,'action',r.mutation->>'action','review',r.review,'result',r.result)
$$;
revoke all on function private.assurance_outcome(public.assurance_requests) from public,anon,authenticated;

create function private.assurance_lookup(p_company uuid,p_role text,p_payload jsonb) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare k text:=p_payload->>'kind'; s text:=lower(btrim(coalesce(p_payload->>'search',''))); v_sel uuid:=nullif(p_payload->>'selected_id','')::uuid;
  v_ctx uuid:=nullif(p_payload->>'context_id','')::uuid; v_filter text:=p_payload->>'filter'; v jsonb; v_view text;
begin
  v_view:=case k when 'drawings' then 'drawings' when 'profiles' then 'drawings' when 'jobs' then 'drawings' when 'order_items' then 'revisions' when 'competencies' then 'capability'
    when 'employees' then 'capability' when 'instruments' then 'instruments' when 'results' then 'instruments' when 'presses' then 'capacity' when 'packing_items' then 'returns'
    when 'documents' then 'packs' when 'return_targets' then 'returns' end;
  if v_view is null then raise exception 'NOV: Choose a supported lookup.'; end if;
  if not private.assurance_read_allowed(p_role,v_view) then raise exception 'Not permitted' using errcode='42501'; end if;
  if k='drawings' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select id value,drawing_number||' · '||title label,replace(related_entity_type,'_',' ')||' · '||replace(approval_status,'_',' ') context
      from public.technical_drawings where company_id=p_company and ((v_sel is not null and id=v_sel) or (v_sel is null and position(s in lower(drawing_number||' '||title))>0)) order by drawing_number,id limit 20) x;
  elsif k='profiles' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select id value,profile_code||' · '||profile_name label,'Current drawing revision '||coalesce(drawing_revision,'not recorded') context
      from public.aluminium_profiles where company_id=p_company and is_active and deleted_at is null and ((v_sel is not null and id=v_sel) or (v_sel is null and position(s in lower(profile_code||' '||profile_name))>0)) order by profile_code,id limit 20) x;
  elsif k='jobs' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select j.id value,coalesce(j.job_number,'Production job')||' · '||o.order_number label,
        replace(j.status,'_',' ')||' · revision '||coalesce(j.drawing_revision,'none') context
      from public.production_jobs j join public.orders o on o.id=j.order_id and o.company_id=j.company_id join public.drawing_revisions r on r.id=v_ctx and r.company_id=j.company_id and r.profile_id=j.profile_id
      where j.company_id=p_company and j.status in ('planned','ready') and ((v_sel is not null and j.id=v_sel) or (v_sel is null and position(s in lower(coalesce(j.job_number,'')||' '||o.order_number))>0)) order by j.job_number,j.id limit 20) x;
  elsif k='order_items' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select i.id value,o.order_number||' · '||coalesce(nullif(i.item_description,''),nullif(i.section_name,''),'Order line') label,
        coalesce(trim_scale(i.quantity_kg)||' kg','quantity not recorded')||' · revision '||coalesce(i.drawing_revision,'none') context
      from public.order_items i join public.orders o on o.id=i.order_id and o.company_id=i.company_id
      where i.company_id=p_company and o.deleted_at is null and o.current_stage not in ('closed','cancelled') and ((v_sel is not null and i.id=v_sel) or (v_sel is null and position(s in lower(o.order_number||' '||coalesce(i.item_description,'')))>0))
      order by o.order_number,i.created_at,i.id limit 20) x;
  elsif k='competencies' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select id value,code||' · '||name label,coalesce(validity_months||' month validity','no expiry') context
      from public.competencies where company_id=p_company and is_active and ((v_sel is not null and id=v_sel) or (v_sel is null and position(s in lower(code||' '||name))>0)) order by code,id limit 20) x;
  elsif k='employees' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select id value,coalesce(nullif(full_name,''),'Employee') label,replace(role,'_',' ') context
      from public.app_users where company_id=p_company and is_active and dealer_id is null and ((v_sel is not null and id=v_sel) or (v_sel is null and position(s in lower(coalesce(full_name,'')))>0)) order by full_name,id limit 20) x;
  elsif k='instruments' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select mi.id value,mi.code||' · '||mi.name label,trim_scale(mi.range_min)||' to '||trim_scale(mi.range_max)||' '||mi.unit||' · evidence '||(private.instrument_evidence(p_company,mi.id,now())->>'state') context
      from public.measuring_instruments mi where mi.company_id=p_company and mi.status='active' and ((v_sel is not null and mi.id=v_sel) or (v_sel is null and position(s in lower(mi.code||' '||mi.name))>0)) order by mi.code,mi.id limit 20) x;
  elsif k='results' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select r.id value,coalesce(qi.batch_number,'Inspection')||' · '||pi.characteristic label,
        trim_scale(r.observed)||' '||pi.unit||' · '||to_char(r.recorded_at at time zone 'Asia/Kolkata','DD Mon HH24:MI') context
      from public.inspection_results r join public.inspection_plan_items pi on pi.id=r.item_id and pi.company_id=r.company_id join public.quality_inspections qi on qi.id=r.inspection_id and qi.company_id=r.company_id
      where r.company_id=p_company and r.observed is not null and not exists(select 1 from public.instrument_result_bindings b where b.inspection_result_id=r.id)
        and ((v_sel is not null and r.id=v_sel) or (v_sel is null and position(s in lower(coalesce(qi.batch_number,'')||' '||pi.characteristic))>0)) order by r.recorded_at desc,r.id limit 20) x;
  elsif k='presses' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select m.id value,m.machine_name label,coalesce(m.machine_code,'press')||' · '||m.status||
        case when exists(select 1 from private.capacity_windows(p_company) w where w.machine_id=m.id) then ' · has unavailability' else '' end context
      from public.machines m where m.company_id=p_company and m.machine_type='extrusion_press' and m.is_active and m.status in ('active','operational','idle')
        and ((v_sel is not null and m.id=v_sel) or (v_sel is null and position(s in lower(m.machine_name||' '||coalesce(m.machine_code,'')))>0)) order by m.machine_name,m.id limit 20) x;
  elsif k='packing_items' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select pl.id value,coalesce(d.dispatch_number,'Dispatch')||' · bundle '||pl.bundle_number label,
        o.order_number||' · '||trim_scale(private.packing_net_kg(pl))||' kg' context
      from public.packing_list_items pl join public.dispatches d on d.id=pl.dispatch_id and d.company_id=pl.company_id join public.orders o on o.id=d.order_id and o.company_id=d.company_id
      where pl.company_id=p_company and d.actual_dispatched_at is not null and (v_ctx is null or d.id=v_ctx)
        and ((v_sel is not null and pl.id=v_sel) or (v_sel is null and position(s in lower(coalesce(d.dispatch_number,'')||' '||pl.bundle_number||' '||o.order_number))>0)) order by d.dispatch_number,pl.bundle_number,pl.id limit 20) x;
  elsif k='documents' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select doc.id value,doc.file_name label,replace(doc.document_type,'_',' ')||' · version '||coalesce(doc.version_number,1)||' · '||coalesce(doc.approval_status,'pending') context
      from public.technical_documents doc where doc.company_id=p_company and (p_role in ('owner','admin') or doc.document_type in ('die_drawing','profile_drawing','material_test_certificate','quality_inspection_report','customer_approval_document','technical_data_sheet','compliance_certificate')) and (v_ctx is null or (doc.linked_entity_type='dispatch' and doc.linked_entity_id=v_ctx)
        or (doc.linked_entity_type='order' and doc.linked_entity_id=(select order_id from public.dispatches where id=v_ctx and company_id=p_company)))
        and ((v_sel is not null and doc.id=v_sel) or (v_sel is null and position(s in lower(doc.file_name||' '||doc.document_type))>0)) order by doc.file_name,doc.id limit 20) x;
  elsif k='return_targets' then
    if v_filter='credit_note' then
      select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select n.id value,n.credit_note_number label,to_char(n.credit_date,'DD Mon YYYY')||' · '||n.status context
        from public.credit_notes n join public.return_authorizations a on a.id=v_ctx and a.company_id=n.company_id and a.dispatch_id=n.dispatch_id
        where n.company_id=p_company and n.status='issued' and ((v_sel is not null and n.id=v_sel) or (v_sel is null and position(s in lower(n.credit_note_number))>0)) order by n.credit_note_number,n.id limit 20) x;
    elsif v_filter='replacement_dispatch' then
      select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select d.id value,coalesce(d.dispatch_number,'Dispatch') label,to_char(d.dispatch_date,'DD Mon YYYY')||' · '||d.delivery_status context
        from public.dispatches d join public.return_authorizations a on a.id=v_ctx and a.company_id=d.company_id and a.order_id=d.order_id and a.dispatch_id<>d.id
        where d.company_id=p_company and d.actual_dispatched_at is not null and ((v_sel is not null and d.id=v_sel) or (v_sel is null and position(s in lower(coalesce(d.dispatch_number,'')))>0)) order by d.dispatch_number,d.id limit 20) x;
    elsif v_filter='replacement_job' then
      select coalesce(jsonb_agg(to_jsonb(x) order by x.label,x.value),'[]'::jsonb) into v from (select j.id value,coalesce(j.job_number,'Production job') label,replace(j.status,'_',' ')||' · '||trim_scale(j.planned_quantity_kg)||' kg planned' context
        from public.production_jobs j join public.return_authorizations a on a.id=v_ctx and a.company_id=j.company_id and a.order_id=j.order_id
        where j.company_id=p_company and j.status<>'cancelled' and ((v_sel is not null and j.id=v_sel) or (v_sel is null and position(s in lower(coalesce(j.job_number,'')))>0)) order by j.job_number,j.id limit 20) x;
    else v:='[]'::jsonb; end if;
  end if;
  return v;
end $$;
revoke all on function private.assurance_lookup(uuid,text,jsonb) from public,anon,authenticated;

create function public.assurance_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid();v_company uuid:=private.get_current_user_company_id();v_role text:=private.get_current_user_role();
  v_view text;v_page integer;v_search text;v_state text;v_sort text;v_status text;v_id uuid;v_total bigint;v_rows jsonb;v_row jsonb;v_events jsonb;
  r public.assurance_requests%rowtype;v_context jsonb;v_fingerprint text;v_result jsonb;v_message text;v_keys text[];
begin
  if v_actor is null or v_company is null or not exists(select 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null)
    or not private.assurance_read_allowed(v_role,'revisions') then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.app_users where id=v_actor and company_id=v_company for share;
  v_keys:=case p_command when 'list' then array['view','page','search','state','sort','status'] when 'detail' then array['view','id','page']
    when 'lookup' then array['kind','search','selected_id','context_id','filter'] when 'preview' then array['request_id','mutation'] when 'commit' then array['request_id','fingerprint']
    when 'outcome' then array['request_id'] when 'abandon' then array['request_id'] end;
  if jsonb_typeof(p_payload) is distinct from 'object' or v_keys is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(v_keys))) then raise exception 'NOV: Invalid assurance request.'; end if;
  if p_command in ('list','detail') then
    v_view:=p_payload->>'view';v_page:=coalesce((p_payload->>'page')::integer,1);v_search:=btrim(coalesce(p_payload->>'search',''));
    v_state:=coalesce(p_payload->>'state','active');v_sort:=coalesce(p_payload->>'sort','priority');v_status:=nullif(btrim(coalesce(p_payload->>'status','')),'');
    if not private.assurance_read_allowed(v_role,v_view) then raise exception 'Not permitted' using errcode='42501'; end if;
    if v_page not between 1 and 100000 or length(v_search)>80 or v_state not in ('active','all') or v_sort not in ('priority','newest','due') or coalesce(v_status,'x') !~ '^[a-z_]{1,40}$' then raise exception 'NOV: Invalid assurance filters.'; end if;
    if p_command='detail' then
      v_id:=(p_payload->>'id')::uuid;
      if v_id is null then raise exception 'NOV: Choose a record.'; end if;
      select row_data into v_row from private.assurance_rows(v_company,v_actor,v_role,v_view,'all',v_id) limit 1;
      if v_row is null then raise exception 'NOV: This record is unavailable.'; end if;
      select count(*) into v_total from public.assurance_events where company_id=v_company and view_name=v_view and entity_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(x) order by recorded_at desc,id),'[]'::jsonb) into v_events from (
        select id,action,actor_name as actor,note,recorded_at from public.assurance_events where company_id=v_company and view_name=v_view and entity_id=v_id order by recorded_at desc,id limit 10 offset (v_page-1)*10
      ) x;
      return jsonb_build_object('row',v_row,'events',v_events,'event_count',v_total,'as_of',now());
    end if;
    with visible as (select * from private.assurance_rows(v_company,v_actor,v_role,v_view,v_state,null) where (v_status is null or row_data->>'status'=v_status)
      and (v_search='' or position(lower(v_search) in lower(coalesce(row_data->>'label','')||' '||coalesce(row_data->>'status','')||' '||coalesce(row_data->>'owner','')||' '||coalesce(row_data->>'summary','')))>0))
    select (select count(*) from visible),coalesce((select jsonb_agg(x.row_data order by x.position) from (
      select row_data,row_number() over(order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id')) as position
      from visible order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id') limit 10 offset (v_page-1)*10
    ) x),'[]'::jsonb) into v_total,v_rows;
    return jsonb_build_object('rows',v_rows,'total_count',v_total,'as_of',now());
  elsif p_command='lookup' then
    if length(coalesce(p_payload->>'search',''))>80 or coalesce(p_payload->>'filter','x') !~ '^[a-z_]{1,40}$' then raise exception 'NOV: Keep search within 80 characters.'; end if;
    return private.assurance_lookup(v_company,v_role,p_payload);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':assurance',0));
  v_id:=(p_payload->>'request_id')::uuid;
  if v_id is null then raise exception 'NOV: An original request identity is required.'; end if;
  select * into r from public.assurance_requests where request_id=v_id for update;
  if found and (r.company_id<>v_company or r.actor_id<>v_actor) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_command='preview' then
    if r.request_id is not null then
      if r.mutation is distinct from p_payload->'mutation' then raise exception 'NOV: This request identity belongs to different details.'; end if;
      if not private.assurance_action_allowed(v_role,r.mutation->>'action') then raise exception 'Not permitted' using errcode='42501'; end if;
      return private.assurance_outcome(r);
    end if;
    v_context:=private.assurance_context(v_company,v_actor,p_payload->'mutation',false);
    v_fingerprint:=md5((v_context->'source')::text||(p_payload->'mutation')::text);
    insert into public.assurance_requests(request_id,company_id,actor_id,mutation,fingerprint,review)
      values(v_id,v_company,v_actor,p_payload->'mutation',v_fingerprint,v_context->'review') returning * into r;
  else
    if r.request_id is null then
      if p_command in ('outcome','abandon') then return jsonb_build_object('request_id',v_id,'state','not_recorded','fingerprint',repeat('0',32),'expires_at',now(),'action','',
        'review',jsonb_build_object('title','Original request check','effect','No prepared or committed action exists for this original request.','warnings','[]'::jsonb,'facts','{}'::jsonb),
        'result',jsonb_build_object('label','Not recorded','href',null,'message','No change was committed with this original request identity. It is safe to start a reviewed action.')); end if;
      raise exception 'NOV: The original request was not found. No action was committed with that request identity.';
    end if;
    if (p_command='commit' and not private.assurance_action_allowed(v_role,r.mutation->>'action'))
      or (p_command in ('outcome','abandon') and not private.assurance_read_allowed(v_role,private.assurance_view(r.mutation->>'action'))) then raise exception 'Not permitted' using errcode='42501'; end if;
    if p_command='commit' and r.state='prepared' then
      if r.fingerprint is distinct from p_payload->>'fingerprint' then raise exception 'NOV: Confirmation does not match the reviewed request.'; end if;
      begin
        if r.expires_at<=now() then raise exception 'NOV: This review expired. Review the current source again.'; end if;
        v_context:=private.assurance_context(v_company,v_actor,r.mutation,true);
        if r.fingerprint<>md5((v_context->'source')::text||r.mutation::text) then raise exception 'NOV: A relevant source changed. Review the current details again.'; end if;
        v_result:=private.assurance_apply(v_company,v_actor,v_id,r.mutation,v_context);
        update public.assurance_requests set state='confirmed',result=v_result where request_id=v_id returning * into r;
      exception when others then
        -- Guard messages raised by existing workflows are curated text; constraint and system messages are not shown.
        v_message:=case when sqlstate='P0001' and sqlerrm like 'NOV: %' then substring(sqlerrm from 6)
          when sqlstate in ('23514','23P01','55P03') and sqlerrm not like '%violates%' and sqlerrm not like '%constraint%' then sqlerrm
          else 'The existing workflow rejected this action. No change from this request was committed. Refresh the source and review its current requirements.' end;
        update public.assurance_requests set state='rejected',result=jsonb_build_object('label',r.review->>'title','href',null,'message',v_message) where request_id=v_id returning * into r;
      end;
    elsif p_command='abandon' and r.state='prepared' then
      update public.assurance_requests set state='abandoned',result=jsonb_build_object('label',r.review->>'title','href',null,'message','Review cancelled. This request made no change.') where request_id=v_id returning * into r;
    elsif p_command not in ('commit','outcome','abandon') then raise exception 'NOV: Invalid assurance request.';
    end if;
  end if;
  return private.assurance_outcome(r);
end $$;
revoke all on function public.assurance_command(text,jsonb) from public,anon;
grant execute on function public.assurance_command(text,jsonb) to authenticated;

commit;
