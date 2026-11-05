-- November batch 10 (delivery ranks 91 to 100): customer purchase-order intake drafts (NOV-061), a controlled
-- automation workbench (NOV-080), external laboratory testing (NOV-071), finish and shade references (NOV-073),
-- blanket agreements with releases (NOV-037), die and tooling commercial accounts (NOV-065), warehouse transfers
-- (NOV-067), ageing and heat-treatment batches (NOV-072), customer-owned metal and job-work settlement (NOV-032)
-- and weighbridge transactions (NOV-074).
-- Consequential actions use the reviewed request protocol of batches 3 to 9 with separate request and event
-- tables. Additive. Depends only on the batch 5 helpers (private.assurance_text/number/date) and
-- private.ist_today. The one change to an existing object adds the value 'in_transit' to the profile stock
-- status check so material on a warehouse transfer is never free stock at either end.

------------------------------------------------------------------------------------------------
-- Tenant keys: a (company_id,id) unique index on every referenced table that does not already have one.
------------------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['customers','quotes','vendors','invoices','aluminium_profiles','order_items','machines','orders','production_jobs','dies','payments','credit_notes',
    'profile_stock_batches','inventory_locations','factory_vehicles','dispatches','purchase_receipts','finishing_jobs','billet_batches','app_users'] loop
    if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=t and i.indisunique and i.indpred is null and i.indnkeyatts=2
          and (select array_agg(a.attname::text order by k.ord) from unnest(i.indkey::int2[]) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum)=array['company_id','id']) then
      execute format('create unique index %I on public.%I(company_id,id)','specialist_'||t||'_tenant_key',t);
    end if;
  end loop;
end $$;
create index if not exists specialist_profile_alias_idx on public.customer_profile_aliases(company_id,customer_id) where is_active;
create index if not exists specialist_invoice_due_idx on public.invoices(company_id,due_date) where deleted_at is null;
create index if not exists specialist_packing_dispatch_idx on public.packing_list_items(company_id,dispatch_id);

-- NOV-067: material issued on a transfer is in transit, not available at the source or the destination.
alter table public.profile_stock_batches drop constraint profile_stock_status_check;
alter table public.profile_stock_batches add constraint profile_stock_status_check
  check (status in ('available','reserved','dispatched','rejected','scrap','transformed','in_transit'));

------------------------------------------------------------------------------------------------
-- NOV-061: the pasted purchase order is retained with a checksum; extracted lines keep their source line.
------------------------------------------------------------------------------------------------
create table public.po_intakes (
  id uuid primary key, company_id uuid not null references public.companies(id), intake_number text not null, customer_id uuid not null,
  customer_po_ref text not null check(length(customer_po_ref) between 1 and 60), po_date date, quote_id uuid,
  source_text text not null check(length(source_text) between 10 and 20000), source_checksum text not null check(source_checksum ~ '^[0-9a-f]{64}$'),
  status text not null default 'review' check(status in ('review','ready','linked','superseded','discarded')), amends_intake_id uuid, order_id uuid,
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  closed_by uuid, closed_at timestamptz, close_note text,
  unique(company_id,intake_number), unique(company_id,id),
  foreign key(company_id,customer_id) references public.customers(company_id,id), foreign key(company_id,quote_id) references public.quotes(company_id,id),
  foreign key(company_id,order_id) references public.orders(company_id,id), foreign key(company_id,created_by) references public.app_users(company_id,id),
  check((status='linked')=(order_id is not null))
);
create unique index po_intakes_checksum_once on public.po_intakes(company_id,source_checksum) where status in ('review','ready','linked');
create unique index po_intakes_order_once on public.po_intakes(company_id,order_id) where status='linked';
create index po_intakes_idx on public.po_intakes(company_id,status,created_at desc);
create index po_intakes_ref_idx on public.po_intakes(company_id,customer_id,lower(customer_po_ref));
create table public.po_intake_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), intake_id uuid not null, seq integer not null check(seq between 1 and 300),
  source_line integer not null, raw_text text not null, code_text text, quantity numeric(14,3), quantity_unit text check(quantity_unit is null or quantity_unit in ('kg','piece','metre')),
  length_mm integer, finish text, due_date date, rate_per_kg numeric(14,2), profile_id uuid,
  match_basis text check(match_basis is null or match_basis in ('profile_code','customer_alias','person')),
  state text not null check(state in ('unresolved','matched','resolved','not_a_line')), issues jsonb not null default '[]'::jsonb, extracted jsonb not null,
  resolved_by uuid, resolved_at timestamptz,
  unique(intake_id,seq), unique(company_id,id), foreign key(company_id,intake_id) references public.po_intakes(company_id,id),
  foreign key(company_id,profile_id) references public.aluminium_profiles(company_id,id),
  check(state not in ('matched','resolved') or (profile_id is not null and quantity>0 and quantity_unit is not null))
);
create index po_intake_lines_idx on public.po_intake_lines(company_id,intake_id,seq);

------------------------------------------------------------------------------------------------
-- NOV-080: typed, versioned rules; every run is recorded with per-record outcomes; one effect per event key.
------------------------------------------------------------------------------------------------
create table public.automation_rule_versions (
  id uuid primary key, company_id uuid not null references public.companies(id), rule_code text not null check(rule_code ~ '^[a-z0-9_]{3,30}$'), version integer not null check(version>0),
  name text not null check(length(name) between 3 and 80), trigger_kind text not null check(trigger_kind in ('invoice_overdue','dispatch_overdue','quote_expiring')),
  min_days integer not null check(min_days between 0 and 365), min_amount numeric(14,2) check(min_amount is null or min_amount>=0),
  task_priority text not null check(task_priority in ('low','normal','high','urgent')), assign_to uuid, due_in_days integer not null check(due_in_days between 0 and 30),
  status text not null default 'draft' check(status in ('draft','approved','paused','retired')), created_by uuid not null, approved_by uuid, approved_at timestamptz,
  state_changed_by uuid, state_changed_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  unique(company_id,rule_code,version), unique(company_id,id), check(status not in ('approved','paused') or (approved_by is not null and approved_by<>created_by)),
  check(trigger_kind='invoice_overdue' or min_amount is null),
  foreign key(company_id,created_by) references public.app_users(company_id,id), foreign key(company_id,assign_to) references public.app_users(company_id,id)
);
create unique index automation_rule_one_draft on public.automation_rule_versions(company_id,rule_code) where status='draft';
create unique index automation_rule_one_live on public.automation_rule_versions(company_id,rule_code) where status in ('approved','paused');
create table public.automation_executions (
  id uuid primary key, company_id uuid not null references public.companies(id), rule_id uuid not null, rule_code text not null, rule_version integer not null,
  mode text not null check(mode in ('simulation','execution')), status text not null check(status in ('simulated','succeeded','partial','failed','nothing_due')),
  candidates integer not null, succeeded integer not null default 0, skipped integer not null default 0, failed integer not null default 0, simulated integer not null default 0, unprocessed integer not null default 0,
  started_by uuid not null, started_at timestamptz not null default clock_timestamp(), finished_at timestamptz not null default clock_timestamp(),
  unique(company_id,id), foreign key(company_id,rule_id) references public.automation_rule_versions(company_id,id)
);
create index automation_executions_idx on public.automation_executions(company_id,rule_code,started_at desc);
create table public.automation_effects (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), execution_id uuid not null, rule_code text not null,
  source_type text not null check(source_type in ('invoice','dispatch','quote')), source_id uuid not null, source_label text not null, effect_key text not null,
  outcome text not null check(outcome in ('simulated','succeeded','skipped','failed')), task_id uuid, reason text, recorded_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,execution_id) references public.automation_executions(company_id,id), check((outcome='succeeded')=(task_id is not null))
);
create unique index automation_effects_once on public.automation_effects(company_id,effect_key) where outcome='succeeded';
create index automation_effects_execution_idx on public.automation_effects(company_id,execution_id);

------------------------------------------------------------------------------------------------
-- NOV-071: the laboratory's statement and the internal quality decision are separate records.
------------------------------------------------------------------------------------------------
create table public.lab_requests (
  id uuid primary key, company_id uuid not null references public.companies(id), request_number text not null, sample_ref text not null check(length(sample_ref) between 2 and 60),
  material_kind text not null check(material_kind in ('production_job','billet_batch','other')), production_job_id uuid, billet_batch_id uuid, material_note text,
  lab_vendor_id uuid not null, tests jsonb not null, promised_date date not null, revised_date date, estimated_charge numeric(14,2) check(estimated_charge is null or estimated_charge>=0),
  status text not null default 'requested' check(status in ('requested','dispatched','at_lab','partial','reported','reviewed','lost','cancelled')),
  dispatch_ref text, dispatched_at timestamptz, lab_received_at timestamptz, lab_sample_ref text,
  decision text check(decision is null or decision in ('release','nonconformance','retest')), decision_note text, decided_by uuid, decided_at timestamptz, decision_history jsonb not null default '[]'::jsonb,
  retest_of uuid, created_by uuid not null, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(company_id,request_number), unique(company_id,id),
  foreign key(company_id,production_job_id) references public.production_jobs(company_id,id), foreign key(company_id,billet_batch_id) references public.billet_batches(company_id,id),
  foreign key(company_id,lab_vendor_id) references public.vendors(company_id,id), foreign key(company_id,created_by) references public.app_users(company_id,id),
  check((material_kind='production_job')=(production_job_id is not null)), check((material_kind='billet_batch')=(billet_batch_id is not null)),
  check((status='reviewed')=(decision is not null))
);
create unique index lab_requests_open_sample on public.lab_requests(company_id,lower(sample_ref)) where status not in ('reviewed','lost','cancelled');
create index lab_requests_idx on public.lab_requests(company_id,status,promised_date);
create table public.lab_results (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), request_id uuid not null, test_code text not null, revision integer not null check(revision>0),
  statement text not null check(length(statement) between 1 and 200), lab_outcome text not null check(lab_outcome in ('pass','fail','no_conclusion')), report_ref text not null check(length(report_ref) between 1 and 60),
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  unique(request_id,test_code,revision), foreign key(company_id,request_id) references public.lab_requests(company_id,id)
);

------------------------------------------------------------------------------------------------
-- NOV-073: revisions of a reference never rewrite earlier bindings or match decisions.
------------------------------------------------------------------------------------------------
create table public.shade_references (
  id uuid primary key, company_id uuid not null references public.companies(id), ref_code text not null check(ref_code ~ '^[A-Z0-9][A-Z0-9._-]{1,29}$'), revision integer not null check(revision>0),
  shade_name text not null check(length(shade_name) between 2 and 60),
  finish_type text not null check(finish_type in ('mill_finish','powder_coating','anodizing','anodized_silver','anodized_bronze','anodized_black','wood_finish','wood_grain','pvdf','other')),
  specification text not null check(length(specification) between 5 and 300), customer_id uuid, project_ref text check(project_ref is null or length(project_ref) between 2 and 80),
  sample_location text not null check(length(sample_location) between 2 and 80), assessment_conditions text not null check(length(assessment_conditions) between 5 and 200),
  status text not null default 'draft' check(status in ('draft','approved','superseded','withdrawn')), created_by uuid not null, approved_by uuid, approved_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  unique(company_id,ref_code,revision), unique(company_id,id), check(status not in ('approved','superseded') or (approved_by is not null and approved_by<>created_by)),
  foreign key(company_id,customer_id) references public.customers(company_id,id), foreign key(company_id,created_by) references public.app_users(company_id,id)
);
create unique index shade_references_one_draft on public.shade_references(company_id,ref_code) where status='draft';
create unique index shade_references_one_approved on public.shade_references(company_id,ref_code) where status='approved';
create table public.shade_bindings (
  id uuid primary key, company_id uuid not null references public.companies(id), reference_id uuid not null, order_item_id uuid not null, status text not null default 'active' check(status in ('active','replaced')),
  bound_by uuid not null, bound_at timestamptz not null default clock_timestamp(), replaced_at timestamptz,
  unique(company_id,id), foreign key(company_id,reference_id) references public.shade_references(company_id,id), foreign key(company_id,order_item_id) references public.order_items(company_id,id)
);
create unique index shade_bindings_one_active on public.shade_bindings(company_id,order_item_id) where status='active';
create table public.shade_decisions (
  id uuid primary key, company_id uuid not null references public.companies(id), binding_id uuid not null, batch_label text not null check(length(batch_label) between 1 and 60), finishing_job_id uuid,
  decision text not null check(decision in ('match','deviation_accepted','reject')), assessed_under text not null check(length(assessed_under) between 5 and 200),
  status text not null default 'active' check(status in ('active','superseded')), decided_by uuid not null, decided_at timestamptz not null default clock_timestamp(), note text not null,
  foreign key(company_id,binding_id) references public.shade_bindings(company_id,id), foreign key(company_id,finishing_job_id) references public.finishing_jobs(company_id,id)
);
create unique index shade_decisions_one_active on public.shade_decisions(company_id,binding_id,lower(batch_label)) where status='active';

------------------------------------------------------------------------------------------------
-- NOV-037: agreement balance is its own ledger; it is never physical stock or demand.
------------------------------------------------------------------------------------------------
create table public.blanket_agreements (
  id uuid primary key, company_id uuid not null references public.companies(id), agreement_number text not null, customer_id uuid not null, customer_ref text not null check(length(customer_ref) between 1 and 60),
  valid_from date not null, valid_to date not null, overrun_percent numeric(5,2) not null default 0 check(overrun_percent between 0 and 20),
  status text not null default 'draft' check(status in ('draft','active','closed','cancelled')), created_by uuid not null, approved_by uuid, approved_at timestamptz,
  closed_by uuid, closed_at timestamptz, close_note text, carried_from uuid, carried_to uuid, created_at timestamptz not null default clock_timestamp(),
  unique(company_id,agreement_number), unique(company_id,id), check(valid_to>=valid_from), check(status not in ('active','closed') or (approved_by is not null and approved_by<>created_by)),
  foreign key(company_id,customer_id) references public.customers(company_id,id), foreign key(company_id,created_by) references public.app_users(company_id,id)
);
create table public.blanket_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), agreement_id uuid not null, seq integer not null check(seq between 1 and 20),
  profile_id uuid not null, finish text not null check(length(finish) between 2 and 40), agreed_kg numeric(14,3) not null check(agreed_kg>0), history jsonb not null default '[]'::jsonb,
  unique(agreement_id,seq), unique(company_id,id), foreign key(company_id,agreement_id) references public.blanket_agreements(company_id,id),
  foreign key(company_id,profile_id) references public.aluminium_profiles(company_id,id)
);
create table public.blanket_rates (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), line_id uuid not null, rate_per_kg numeric(14,2) not null check(rate_per_kg>0),
  effective_from date not null, recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(), note text,
  unique(line_id,effective_from), foreign key(company_id,line_id) references public.blanket_lines(company_id,id)
);
create table public.blanket_releases (
  id uuid primary key, company_id uuid not null references public.companies(id), release_number text not null, agreement_id uuid not null, line_id uuid not null,
  quantity_kg numeric(14,3) not null check(quantity_kg>0), site text not null check(length(site) between 2 and 120), requested_date date not null,
  status text not null default 'scheduled' check(status in ('scheduled','firm','fulfilled','cancelled')), rate_per_kg numeric(14,2), rate_effective_from date,
  order_id uuid, returned_kg numeric(14,3) not null default 0 check(returned_kg>=0), cancelled_kg numeric(14,3) not null default 0 check(cancelled_kg>=0), history jsonb not null default '[]'::jsonb,
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(), firmed_by uuid, firmed_at timestamptz,
  unique(company_id,release_number), unique(company_id,id), check(returned_kg<=quantity_kg), check(status not in ('firm','fulfilled') or rate_per_kg is not null), check(status<>'scheduled' or rate_per_kg is null),
  check((status='fulfilled')=(order_id is not null)),
  foreign key(company_id,agreement_id) references public.blanket_agreements(company_id,id), foreign key(company_id,line_id) references public.blanket_lines(company_id,id),
  foreign key(company_id,order_id) references public.orders(company_id,id)
);
create unique index blanket_releases_order_once on public.blanket_releases(company_id,order_id) where order_id is not null;
create index blanket_releases_idx on public.blanket_releases(company_id,agreement_id,status);

------------------------------------------------------------------------------------------------
-- NOV-065: the commercial position of a die comes from linked finance records, never a typed balance.
------------------------------------------------------------------------------------------------
create table public.tooling_agreements (
  id uuid primary key, company_id uuid not null references public.companies(id), agreement_number text not null, family_id uuid not null, version integer not null check(version>0),
  die_id uuid not null, customer_id uuid not null, owner_party text not null check(owner_party in ('company','customer')),
  die_charge numeric(14,2) not null check(die_charge>=0), customer_contribution numeric(14,2) not null check(customer_contribution>=0), waiver_amount numeric(14,2) not null default 0 check(waiver_amount>=0),
  recovery_basis text not null check(recovery_basis in ('none','per_kg')), recovery_rate_per_kg numeric(14,4), recovery_cap numeric(14,2),
  tax_reference text not null check(length(tax_reference) between 2 and 120), terms text not null check(length(terms) between 5 and 500),
  status text not null default 'draft' check(status in ('draft','active','superseded','closed')), disputed boolean not null default false, dispute_note text,
  created_by uuid not null, approved_by uuid, approved_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  unique(company_id,agreement_number,version), unique(company_id,id), check(customer_contribution<=die_charge), check(waiver_amount<=customer_contribution),
  check((recovery_basis='per_kg')=(recovery_rate_per_kg is not null and recovery_cap is not null)), check(recovery_rate_per_kg is null or recovery_rate_per_kg>0),
  check(recovery_cap is null or (recovery_cap>0 and recovery_cap<=customer_contribution-waiver_amount)),
  check(status not in ('active','superseded','closed') or (approved_by is not null and approved_by<>created_by)),
  foreign key(company_id,die_id) references public.dies(company_id,id), foreign key(company_id,customer_id) references public.customers(company_id,id),
  foreign key(company_id,created_by) references public.app_users(company_id,id)
);
create unique index tooling_agreements_one_active on public.tooling_agreements(company_id,family_id) where status='active';
create unique index tooling_agreements_one_draft on public.tooling_agreements(company_id,family_id) where status='draft';
create unique index tooling_agreements_die_active on public.tooling_agreements(company_id,die_id) where status='active';
create table public.tooling_allocations (
  id uuid primary key, company_id uuid not null references public.companies(id), family_id uuid not null, agreement_id uuid not null,
  kind text not null check(kind in ('charge_invoice','payment','credit_note','recovery')), invoice_id uuid, payment_id uuid, credit_note_id uuid,
  amount numeric(14,2) not null check(amount>0), calc jsonb, recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  reversed_at timestamptz, reversed_by uuid, reverse_note text,
  foreign key(company_id,agreement_id) references public.tooling_agreements(company_id,id), foreign key(company_id,invoice_id) references public.invoices(company_id,id),
  foreign key(company_id,payment_id) references public.payments(company_id,id), foreign key(company_id,credit_note_id) references public.credit_notes(company_id,id),
  check((kind in ('charge_invoice','recovery'))=(invoice_id is not null)), check((kind='payment')=(payment_id is not null)), check((kind='credit_note')=(credit_note_id is not null))
);
create unique index tooling_allocations_recovery_once on public.tooling_allocations(company_id,invoice_id) where kind='recovery' and reversed_at is null;
create index tooling_allocations_idx on public.tooling_allocations(company_id,family_id,recorded_at desc);

------------------------------------------------------------------------------------------------
-- NOV-067: whole physical bundles move through an explicit in-transit position.
------------------------------------------------------------------------------------------------
create table public.stock_transfers (
  id uuid primary key, company_id uuid not null references public.companies(id), transfer_number text not null, to_location_id uuid not null, destination text not null,
  planned_date date not null, status text not null default 'requested' check(status in ('requested','in_transit','partially_received','received','closed','cancelled')),
  requested_by uuid not null, requested_at timestamptz not null default clock_timestamp(), issued_by uuid, issued_at timestamptz, gate_ref text, transport_ref text,
  closed_by uuid, closed_at timestamptz, close_note text,
  unique(company_id,transfer_number), unique(company_id,id), foreign key(company_id,to_location_id) references public.inventory_locations(company_id,id)
);
create table public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), transfer_id uuid not null, batch_id uuid not null, bundle_label text not null,
  profile_id uuid not null, pieces integer not null, weight_kg numeric(14,3) not null, source_location text, qc_status_at_issue text,
  state text not null default 'requested' check(state in ('requested','in_transit','received','damaged','returned_to_source','lost','cancelled')),
  resolved_by uuid, resolved_at timestamptz, resolution_note text,
  unique(company_id,id), foreign key(company_id,transfer_id) references public.stock_transfers(company_id,id), foreign key(company_id,batch_id) references public.profile_stock_batches(company_id,id)
);
create unique index stock_transfer_lines_open_batch on public.stock_transfer_lines(company_id,batch_id) where state in ('requested','in_transit');
create index stock_transfer_lines_idx on public.stock_transfer_lines(company_id,transfer_id);

------------------------------------------------------------------------------------------------
-- NOV-072: recipe revisions, exact inputs, actual readings and a separate quality review.
------------------------------------------------------------------------------------------------
create table public.treatment_recipes (
  id uuid primary key, company_id uuid not null references public.companies(id), recipe_code text not null check(recipe_code ~ '^[a-z0-9_]{3,30}$'), revision integer not null check(revision>0),
  name text not null check(length(name) between 3 and 80), process text not null check(process in ('artificial_ageing','solution_treatment','homogenising')),
  alloys text[] not null check(cardinality(alloys) between 1 and 10), target_temper text not null check(length(target_temper) between 1 and 10),
  temp_min_c numeric(6,1) not null check(temp_min_c between 20 and 700), temp_max_c numeric(6,1) not null check(temp_max_c between 20 and 700),
  soak_min_minutes integer not null check(soak_min_minutes between 1 and 2880), soak_max_minutes integer not null check(soak_max_minutes between 1 and 2880),
  min_readings integer not null check(min_readings between 1 and 100), status text not null default 'draft' check(status in ('draft','approved','superseded')),
  created_by uuid not null, approved_by uuid, approved_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  unique(company_id,recipe_code,revision), unique(company_id,id), check(temp_max_c>temp_min_c), check(soak_max_minutes>=soak_min_minutes),
  check(status='draft' or (approved_by is not null and approved_by<>created_by)), foreign key(company_id,created_by) references public.app_users(company_id,id)
);
create unique index treatment_recipes_one_draft on public.treatment_recipes(company_id,recipe_code) where status='draft';
create unique index treatment_recipes_one_approved on public.treatment_recipes(company_id,recipe_code) where status='approved';
create table public.treatment_batches (
  id uuid primary key, company_id uuid not null references public.companies(id), batch_number text not null, recipe_id uuid not null, machine_id uuid not null,
  status text not null default 'loaded' check(status in ('loaded','running','ended','interrupted','released','partially_released','rejected','retreatment')),
  load_note text not null check(length(load_note) between 5 and 300), loaded_by uuid not null, created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz, started_by uuid, ended_at timestamptz, ended_by uuid, review jsonb, reviewed_by uuid, reviewed_at timestamptz, retreatment_of uuid,
  unique(company_id,batch_number), unique(company_id,id), foreign key(company_id,recipe_id) references public.treatment_recipes(company_id,id),
  foreign key(company_id,machine_id) references public.machines(company_id,id)
);
create index treatment_batches_idx on public.treatment_batches(company_id,status,created_at desc);
create table public.treatment_inputs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), batch_id uuid not null, production_job_id uuid not null,
  profile_id uuid not null, alloy text, temper text, quantity_kg numeric(14,3) not null check(quantity_kg>0),
  accepted_kg numeric(14,3), rejected_kg numeric(14,3), retreat_kg numeric(14,3),
  unique(company_id,id), foreign key(company_id,batch_id) references public.treatment_batches(company_id,id), foreign key(company_id,production_job_id) references public.production_jobs(company_id,id),
  check(accepted_kg is null or (accepted_kg>=0 and rejected_kg>=0 and retreat_kg>=0 and accepted_kg+rejected_kg+retreat_kg=quantity_kg))
);
create index treatment_inputs_job_idx on public.treatment_inputs(company_id,production_job_id);
create table public.treatment_observations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), batch_id uuid not null, observed_at timestamptz not null default clock_timestamp(),
  temperature_c numeric(6,1) not null check(temperature_c between 0 and 800), instrument_ref text not null check(length(instrument_ref) between 2 and 60), note text,
  recorded_by uuid not null, foreign key(company_id,batch_id) references public.treatment_batches(company_id,id)
);
create index treatment_observations_idx on public.treatment_observations(company_id,batch_id,observed_at);

------------------------------------------------------------------------------------------------
-- NOV-032: customer-owned metal is a separate custody ledger and never company stock.
------------------------------------------------------------------------------------------------
create table public.toll_agreements (
  id uuid primary key, company_id uuid not null references public.companies(id), customer_id uuid not null, revision integer not null check(revision>0),
  material_spec text not null check(length(material_spec) between 3 and 120), alloy text not null check(length(alloy) between 1 and 40), permitted_mixing boolean not null default false,
  allowed_loss_percent numeric(5,2) check(allowed_loss_percent is null or allowed_loss_percent between 0 and 10), conversion_rate_per_kg numeric(14,2) not null check(conversion_rate_per_kg>0),
  billing_basis text not null check(billing_basis in ('output_kg','input_kg')), status text not null default 'draft' check(status in ('draft','approved','superseded')),
  created_by uuid not null, approved_by uuid, approved_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  unique(company_id,customer_id,revision), unique(company_id,id), check(status='draft' or (approved_by is not null and approved_by<>created_by)),
  foreign key(company_id,customer_id) references public.customers(company_id,id), foreign key(company_id,created_by) references public.app_users(company_id,id)
);
create unique index toll_agreements_one_draft on public.toll_agreements(company_id,customer_id) where status='draft';
create unique index toll_agreements_one_approved on public.toll_agreements(company_id,customer_id) where status='approved';
create table public.toll_receipts (
  id uuid primary key, company_id uuid not null references public.companies(id), receipt_number text not null, customer_id uuid not null, received_kg numeric(14,3) not null check(received_kg>0),
  challan_ref text not null check(length(challan_ref) between 1 and 60), heat_ref text, alloy text not null, location text not null check(length(location) between 2 and 60),
  quality_status text not null default 'pending' check(quality_status in ('pending','accepted','rejected')), inspected_by uuid, inspected_at timestamptz,
  received_by uuid not null, received_at timestamptz not null default clock_timestamp(),
  unique(company_id,receipt_number), unique(company_id,id), foreign key(company_id,customer_id) references public.customers(company_id,id)
);
create unique index toll_receipts_challan_once on public.toll_receipts(company_id,customer_id,lower(challan_ref));
create table public.toll_movements (
  id uuid primary key, company_id uuid not null references public.companies(id), customer_id uuid not null,
  kind text not null check(kind in ('issue','output','scrap','explained_loss','return_metal','return_scrap')), receipt_id uuid, production_job_id uuid,
  quantity_kg numeric(14,3) not null check(quantity_kg>0), reference text, note text not null, status text not null default 'active' check(status in ('active','reversed')),
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(), reversed_by uuid, reversed_at timestamptz, reverse_note text,
  foreign key(company_id,receipt_id) references public.toll_receipts(company_id,id), foreign key(company_id,production_job_id) references public.production_jobs(company_id,id),
  check((kind in ('issue','return_metal'))=(receipt_id is not null)), check((kind in ('issue','output','scrap','explained_loss'))=(production_job_id is not null))
);
create index toll_movements_idx on public.toll_movements(company_id,customer_id,status,recorded_at);
create table public.toll_statements (
  id uuid primary key, company_id uuid not null references public.companies(id), statement_number text not null, customer_id uuid not null, agreement_id uuid not null,
  as_of timestamptz not null default clock_timestamp(), model jsonb not null, status text not null default 'draft' check(status in ('draft','disputed','agreed','replaced')),
  created_by uuid not null, settled_by uuid, settled_at timestamptz, settle_note text,
  unique(company_id,statement_number), unique(company_id,id), foreign key(company_id,agreement_id) references public.toll_agreements(company_id,id)
);
create index toll_statements_idx on public.toll_statements(company_id,customer_id,as_of desc);

------------------------------------------------------------------------------------------------
-- NOV-074: immutable readings, explicit pairing and a finalisation that never rewrites measured weights.
------------------------------------------------------------------------------------------------
create table public.weighing_sessions (
  id uuid primary key, company_id uuid not null references public.companies(id), session_number text not null, vehicle_registration text not null check(vehicle_registration ~ '^[A-Z0-9]{4,15}$'),
  vehicle_id uuid, movement_kind text not null check(movement_kind in ('dispatch','purchase_receipt')), dispatch_id uuid, purchase_receipt_id uuid,
  instrument_ref text not null check(length(instrument_ref) between 2 and 60), calibration_valid_until date not null, tolerance_kg numeric(10,3) not null check(tolerance_kg between 0 and 1000),
  status text not null default 'open' check(status in ('open','paired','finalized','cancelled','superseded')), gross_reading_id uuid, tare_reading_id uuid,
  net_kg numeric(12,3), expected_kg numeric(12,3), difference_kg numeric(12,3), pairing jsonb, accepted_difference boolean not null default false,
  opened_by uuid not null, opened_at timestamptz not null default clock_timestamp(), finalized_by uuid, finalized_at timestamptz, closed_note text, supersedes_id uuid, superseded_by_id uuid,
  unique(company_id,session_number), unique(company_id,id), check((movement_kind='dispatch')=(dispatch_id is not null)), check((movement_kind='purchase_receipt')=(purchase_receipt_id is not null)),
  foreign key(company_id,dispatch_id) references public.dispatches(company_id,id), foreign key(company_id,purchase_receipt_id) references public.purchase_receipts(company_id,id),
  foreign key(company_id,vehicle_id) references public.factory_vehicles(company_id,id), check(status not in ('paired','finalized') or net_kg>0)
);
create unique index weighing_sessions_one_live_dispatch on public.weighing_sessions(company_id,dispatch_id) where status in ('open','paired','finalized');
create unique index weighing_sessions_one_live_receipt on public.weighing_sessions(company_id,purchase_receipt_id) where status in ('open','paired','finalized');
create table public.weighing_readings (
  id uuid primary key, company_id uuid not null references public.companies(id), session_id uuid not null, kind text not null check(kind in ('gross','tare')),
  weight_value numeric(12,3) not null check(weight_value>0), unit text not null check(unit in ('kg','t')), weight_kg numeric(12,3) not null check(weight_kg between 1 and 100000),
  read_at timestamptz not null, source text not null check(source in ('manual','device')), provider_ref text check(provider_ref is null or length(provider_ref) between 1 and 80),
  slip_ref text, stable boolean not null, vehicle_registration_read text not null, recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  unique(company_id,id), foreign key(company_id,session_id) references public.weighing_sessions(company_id,id)
);
create unique index weighing_readings_packet_once on public.weighing_readings(company_id,session_id,provider_ref) where provider_ref is not null;

------------------------------------------------------------------------------------------------
-- Shared request identity and history for the specialist hub.
------------------------------------------------------------------------------------------------
create table public.specialist_requests (
  request_id uuid primary key, company_id uuid not null references public.companies(id), actor_id uuid not null,
  mutation jsonb not null, fingerprint text not null, review jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','confirmed','rejected','abandoned')),
  result jsonb, expires_at timestamptz not null default now()+interval '15 minutes', created_at timestamptz not null default now(),
  foreign key(company_id,actor_id) references public.app_users(company_id,id), check((state='prepared')=(result is null))
);
create index specialist_requests_actor_idx on public.specialist_requests(company_id,actor_id,created_at desc);
create table public.specialist_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  view_name text not null, entity_id uuid not null, action text not null, actor_id uuid, actor_name text not null,
  note text not null, facts jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create index specialist_events_entity_idx on public.specialist_events(company_id,view_name,entity_id,recorded_at desc,id);

do $$ declare t text; begin
  foreach t in array array['po_intakes','po_intake_lines','automation_rule_versions','automation_executions','automation_effects','lab_requests','lab_results','shade_references','shade_bindings','shade_decisions',
    'blanket_agreements','blanket_lines','blanket_rates','blanket_releases','tooling_agreements','tooling_allocations','stock_transfers','stock_transfer_lines','treatment_recipes','treatment_batches',
    'treatment_inputs','treatment_observations','toll_agreements','toll_receipts','toll_movements','toll_statements','weighing_sessions','weighing_readings','specialist_requests','specialist_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
  end loop;
end $$;

create function private.specialist_view(p_action text) returns text language sql immutable set search_path=public,private as $$
  select case split_part(p_action,'.',1) when 'intake' then 'intake' when 'automation' then 'automation' when 'lab' then 'lab' when 'shade' then 'shades'
    when 'agreement' then 'agreements' when 'release' then 'agreements' when 'tooling' then 'tooling' when 'transfer' then 'transfers'
    when 'recipe' then 'treatment' when 'treat' then 'treatment' when 'toll' then 'tolling' when 'weigh' then 'weighing' end
$$;
create function private.specialist_read_allowed(p_role text,p_view text) returns boolean language sql immutable set search_path=public,private as $$
  select coalesce(case
    when p_role not in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer') then false
    when p_view is null then true
    when p_view='intake' then p_role in ('owner','admin','sales_manager','sales')
    when p_view='automation' then p_role in ('owner','admin','factory_manager','accounts')
    when p_view='lab' then p_role in ('owner','admin','quality','factory_manager','production_manager','inventory_manager')
    when p_view='shades' then p_role in ('owner','admin','quality','sales_manager','sales','factory_manager','production_manager','dispatch_manager','dispatch','viewer')
    when p_view='agreements' then p_role in ('owner','admin','sales_manager','sales','accounts')
    when p_view='tooling' then p_role in ('owner','admin','sales_manager','accounts')
    when p_view='transfers' then p_role in ('owner','admin','inventory_manager','factory_manager','dispatch_manager','dispatch','quality','viewer')
    when p_view='treatment' then p_role in ('owner','admin','production_manager','production','quality','factory_manager','viewer')
    when p_view='tolling' then p_role in ('owner','admin','inventory_manager','factory_manager','production_manager','accounts','quality')
    when p_view='weighing' then p_role in ('owner','admin','dispatch_manager','dispatch','inventory_manager','factory_manager','viewer')
    else false end,false)
$$;
create function private.specialist_action_allowed(p_role text,p_action text) returns boolean language sql immutable set search_path=public,private as $$
  select private.specialist_view(p_action) is not null and private.specialist_read_allowed(p_role,private.specialist_view(p_action)) and p_role<>'viewer' and coalesce(case
    when p_action like 'intake.%' then p_role in ('owner','admin','sales_manager','sales')
    when p_action='automation.simulate' then p_role in ('owner','admin','factory_manager','accounts')
    when p_action like 'automation.%' then p_role in ('owner','admin','factory_manager')
    when p_action='lab.review' then p_role in ('owner','admin','quality')
    when p_action like 'lab.%' then p_role in ('owner','admin','quality','factory_manager')
    when p_action in ('shade.define') then p_role in ('owner','admin','quality','sales_manager')
    when p_action in ('shade.approve','shade.withdraw','shade.decide') then p_role in ('owner','admin','quality')
    when p_action='shade.bind' then p_role in ('owner','admin','sales_manager','sales','quality','factory_manager')
    when p_action='agreement.approve' then p_role in ('owner','admin','sales_manager','accounts')
    when p_action like 'agreement.%' then p_role in ('owner','admin','sales_manager')
    when p_action like 'release.%' then p_role in ('owner','admin','sales_manager','sales')
    when p_action like 'tooling.%' then p_role in ('owner','admin','sales_manager','accounts')
    when p_action like 'transfer.%' then p_role in ('owner','admin','inventory_manager','factory_manager')
    when p_action in ('recipe.define') then p_role in ('owner','admin','quality','production_manager')
    when p_action in ('recipe.approve','treat.review') then p_role in ('owner','admin','quality')
    when p_action like 'treat.%' then p_role in ('owner','admin','production_manager','production','factory_manager')
    when p_action in ('toll.define','toll.approve','toll.statement','toll.settle') then p_role in ('owner','admin','accounts')
    when p_action='toll.inspect' then p_role in ('owner','admin','quality')
    when p_action like 'toll.%' then p_role in ('owner','admin','inventory_manager','factory_manager','production_manager')
    when p_action in ('weigh.finalize','weigh.supersede') then p_role in ('owner','admin','dispatch_manager','inventory_manager')
    when p_action like 'weigh.%' then p_role in ('owner','admin','dispatch_manager','dispatch','inventory_manager')
    else false end,false)
$$;
revoke all on function private.specialist_view(text),private.specialist_read_allowed(text,text),private.specialist_action_allowed(text,text) from public,anon;
grant execute on function private.specialist_view(text),private.specialist_read_allowed(text,text),private.specialist_action_allowed(text,text) to authenticated;
-- Every read goes through public.specialist_command. The only direct read is a person's own prepared request.
grant select on public.specialist_requests to authenticated;
create policy specialist_request_owner on public.specialist_requests for select to authenticated using (
  company_id=private.get_current_user_company_id() and actor_id=auth.uid() and private.get_current_user_dealer_id() is null
  and private.specialist_read_allowed(private.get_current_user_role(),private.specialist_view(mutation->>'action'))
);

create function private.specialist_record(p_company uuid,p_view text,p_entity uuid,p_action text,p_actor uuid,p_note text,p_facts jsonb) returns void
language sql security definer set search_path=public,private as $$
  insert into public.specialist_events(company_id,view_name,entity_id,action,actor_id,actor_name,note,facts)
  values(p_company,p_view,p_entity,p_action,p_actor,coalesce((select nullif(full_name,'') from public.app_users where id=p_actor and company_id=p_company),'System'),p_note,coalesce(p_facts,'{}'::jsonb))
$$;
create function private.specialist_uuid(p_mutation jsonb,p_key text) returns uuid language plpgsql immutable set search_path=public,private as $$
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'string' or (p_mutation->>p_key) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'NOV: Choose a valid record for %.',replace(p_key,'_',' '); end if;
  return (p_mutation->>p_key)::uuid;
end $$;
create function private.specialist_bool(p_mutation jsonb,p_key text) returns boolean language plpgsql immutable set search_path=public,private as $$
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'boolean' then raise exception 'NOV: Choose yes or no for %.',replace(p_key,'_',' '); end if;
  return (p_mutation->>p_key)::boolean;
end $$;
create function private.specialist_choice(p_mutation jsonb,p_key text,p_allowed text[]) returns text language plpgsql immutable set search_path=public,private as $$
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'string' or not ((p_mutation->>p_key)=any(p_allowed)) then raise exception 'NOV: Choose a valid %.',replace(p_key,'_',' '); end if;
  return p_mutation->>p_key;
end $$;
create function private.specialist_member(p_company uuid,p_user uuid) returns public.app_users language plpgsql stable security definer set search_path=public,private as $$
declare v_user public.app_users;
begin
  select * into v_user from public.app_users where id=p_user and company_id=p_company and is_active and dealer_id is null and role not in ('viewer','dealer_admin','dealer_staff');
  if v_user.id is null then raise exception 'NOV: Choose an active employee of this company.'; end if;
  return v_user;
end $$;
create function private.specialist_outcome(p_request public.specialist_requests) returns jsonb language sql immutable set search_path=public,private as $$
  select jsonb_build_object('request_id',p_request.request_id,'state',p_request.state,'fingerprint',p_request.fingerprint,'expires_at',p_request.expires_at,'action',p_request.mutation->>'action','review',p_request.review,'result',p_request.result)
$$;
create function private.specialist_review(p_title text,p_effect text,p_warnings jsonb,p_facts jsonb) returns jsonb language sql immutable set search_path=public,private as $$
  select jsonb_build_object('title',p_title,'effect',p_effect,'warnings',coalesce(p_warnings,'[]'::jsonb),'facts',coalesce(p_facts,'{}'::jsonb))
$$;
create function private.specialist_money(p_value numeric) returns text language sql immutable set search_path=public,private as $$
  select case when p_value is null then null else 'INR '||to_char(round(p_value,2),'FM9,99,99,99,990.00') end
$$;
create function private.specialist_kg(p_value numeric) returns text language sql immutable set search_path=public,private as $$
  select case when p_value is null then null else trim_scale(round(p_value,3))::text||' kg' end
$$;
create function private.specialist_number(p_prefix text,p_count bigint) returns text language sql stable set search_path=public,private as $$
  select p_prefix||'-'||to_char(now() at time zone 'Asia/Kolkata','YYMM')||'-'||lpad((p_count+1)::text,4,'0')
$$;
create function private.specialist_re(p_text text) returns text language sql immutable set search_path=public,private as $$
  select regexp_replace(p_text,'([.^$*+?()\[\]{}|\\-])','\\\1','g')
$$;
revoke all on function private.specialist_record(uuid,text,uuid,text,uuid,text,jsonb),private.specialist_uuid(jsonb,text),private.specialist_bool(jsonb,text),private.specialist_choice(jsonb,text,text[]),
  private.specialist_member(uuid,uuid),private.specialist_outcome(public.specialist_requests),private.specialist_review(text,text,jsonb,jsonb),private.specialist_money(numeric),
  private.specialist_kg(numeric),private.specialist_number(text,bigint),private.specialist_re(text) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-061: deterministic extraction. The text is data: nothing in it is executed or changes permissions.
-- A value is proposed only when the line states it plainly; anything unclear stays unresolved.
------------------------------------------------------------------------------------------------
create function private.intake_extract(p_company uuid,p_customer uuid,p_text text) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_lines text[]; v_line text; v_low text; v_i integer; v_out jsonb:='[]'::jsonb; v_seq integer:=0; v_m text[]; v_num text; v_q numeric; v_unit text; v_issues jsonb; v_len integer;
  v_fin text; v_due date; v_rate numeric; v_cands jsonb; v_np integer; v_profile uuid; v_basis text; v_code text; v_state text; v_units integer; v_found boolean; v_candidates integer:=0;
  v_qty_re constant text:='(\d[\d,]*(?:\.\d+)?)\s*(kgs|kg|nos|no\.|pcs|pieces|piece|pc|mtrs|mtr|metres|meters|rmt|m)(?![a-z])';
begin
  v_lines:=regexp_split_to_array(replace(p_text,E'\r',''),E'\n');
  if coalesce(array_length(v_lines,1),0)>300 then raise exception 'NOV: Paste at most 300 lines.'; end if;
  for v_i in 1..coalesce(array_length(v_lines,1),0) loop
    v_line:=btrim(regexp_replace(v_lines[v_i],'[[:cntrl:]]+',' ','g'));
    continue when v_line='';
    v_low:=lower(v_line); v_issues:='[]'::jsonb; v_q:=null; v_unit:=null; v_len:=null; v_fin:=null; v_due:=null; v_rate:=null; v_profile:=null; v_basis:=null; v_code:=null; v_found:=false;
    select coalesce(jsonb_agg(jsonb_build_object('profile_id',x.profile_id,'code',x.code,'basis',x.basis) order by x.basis,x.code),'[]'::jsonb) into v_cands from (
      select pf.id profile_id,pf.profile_code code,'profile_code'::text basis from public.aluminium_profiles pf
        where pf.company_id=p_company and pf.deleted_at is null and pf.is_active and length(pf.profile_code)>=2
          and v_low ~ ('(^|[^a-z0-9])'||private.specialist_re(lower(pf.profile_code))||'($|[^a-z0-9])')
      union
      select al.profile_id,btrim(al.alias),'customer_alias'::text from public.customer_profile_aliases al
        join public.aluminium_profiles pf on pf.id=al.profile_id and pf.company_id=al.company_id and pf.deleted_at is null and pf.is_active
        where al.company_id=p_company and al.customer_id=p_customer and al.is_active and length(btrim(al.alias))>=2
          and v_low ~ ('(^|[^a-z0-9])'||private.specialist_re(lower(btrim(al.alias)))||'($|[^a-z0-9])')) x;
    select count(distinct value->>'profile_id') into v_np from jsonb_array_elements(v_cands);
    if v_np=1 then
      v_profile:=(v_cands->0->>'profile_id')::uuid; v_basis:=v_cands->0->>'basis'; v_code:=v_cands->0->>'code';
    elsif v_np>1 then
      v_issues:=v_issues||jsonb_build_array('The line matches more than one profile ('||(select string_agg(distinct value->>'code',', ') from jsonb_array_elements(v_cands))||'). Choose the correct one.');
    end if;
    select count(*) into v_units from regexp_matches(v_low,v_qty_re,'g');
    v_m:=regexp_match(v_low,v_qty_re);
    if v_m is not null then
      v_found:=true; v_num:=v_m[1];
      if v_num ~ '^\d+(\.\d+)?$' then v_q:=v_num::numeric;
      elsif v_num ~ '^\d{1,3}(,\d{3})+(\.\d+)?$' or v_num ~ '^\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$' then v_q:=replace(v_num,',','')::numeric;
      else v_issues:=v_issues||jsonb_build_array(format('The quantity "%s" is unclear: the comma could be a decimal point or a thousands separator. Enter the quantity.',v_num)); end if;
      v_unit:=case when v_m[2] in ('kgs','kg') then 'kg' when v_m[2] in ('nos','no.','pcs','pieces','piece','pc') then 'piece' else 'metre' end;
      if v_q is not null and (v_q<=0 or v_q>100000000 or v_q<>round(v_q,3)) then v_issues:=v_issues||jsonb_build_array('The quantity is outside the accepted range or has more than three decimals.'); v_q:=null; end if;
      if v_units>1 then v_issues:=v_issues||jsonb_build_array('The line states more than one quantity. The first is proposed; confirm which one governs.'); end if;
    end if;
    v_m:=regexp_match(v_low,'(\d{3,5})\s*mm(?![a-z])');
    if v_m is not null then
      v_len:=v_m[1]::integer;
      if v_len not between 100 and 12000 then v_issues:=v_issues||jsonb_build_array(format('The length %s mm is outside 100 to 12,000 mm.',v_len)); v_len:=null; end if;
    end if;
    v_fin:=case when v_low ~ 'anodi[sz]' then 'anodizing' when v_low ~ 'powder' then 'powder_coating' when v_low ~ '(^|[^a-z])mill' then 'mill_finish' end;
    v_m:=regexp_match(v_low,'(?:^|[^0-9.,])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?![0-9])');
    if v_m is not null then
      begin v_due:=make_date(case when length(v_m[3])=2 then 2000+v_m[3]::integer else v_m[3]::integer end,v_m[2]::integer,v_m[1]::integer);
      exception when others then v_issues:=v_issues||jsonb_build_array(format('The date "%s-%s-%s" could not be read as day-month-year. Enter it.',v_m[1],v_m[2],v_m[3])); end;
    end if;
    v_m:=regexp_match(v_low,'(?:@|rate|rs\.?|inr|₹)\s*:?\s*(\d+(?:\.\d{1,2})?)\s*(?:/|per)\s*(?:kgs|kg)(?![a-z])');
    if v_m is not null then v_rate:=v_m[1]::numeric; end if;
    if v_np=0 and not v_found then v_state:='not_a_line';
    elsif v_np=1 and v_q is not null and jsonb_array_length(v_issues)=0 then v_state:='matched';
    else
      v_state:='unresolved';
      if v_np=0 then v_issues:=v_issues||jsonb_build_array('No profile code or customer alias of this company was found. Choose the profile.'); end if;
      if not v_found then v_issues:=v_issues||jsonb_build_array('No quantity with a unit was found. Enter the quantity.'); end if;
    end if;
    v_seq:=v_seq+1;
    if v_state<>'not_a_line' then v_candidates:=v_candidates+1; end if;
    v_out:=v_out||jsonb_build_array(jsonb_build_object('seq',v_seq,'source_line',v_i,'raw_text',left(v_line,500),'code_text',v_code,'quantity',v_q,'quantity_unit',v_unit,'length_mm',v_len,
      'finish',v_fin,'due_date',v_due,'rate_per_kg',v_rate,'profile_id',v_profile,'match_basis',v_basis,'state',v_state,'issues',v_issues,'candidates',v_cands));
  end loop;
  if v_candidates>100 then raise exception 'NOV: The document has more than 100 order lines. Split it into smaller intakes.'; end if;
  return v_out;
end $$;

-- Differences between the reviewed lines and the quotation the customer accepted (or was sent).
create function private.intake_compare(p_company uuid,p_intake uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_in public.po_intakes; v_rows jsonb:='[]'::jsonb; v_line record; v_q record; v_diff jsonb; v_missing text;
begin
  select * into v_in from public.po_intakes where id=p_intake and company_id=p_company;
  if v_in.quote_id is null then return jsonb_build_object('quote',null,'lines','[]'::jsonb,'quoted_not_ordered',null); end if;
  for v_line in select l.*,pf.profile_code from public.po_intake_lines l join public.aluminium_profiles pf on pf.id=l.profile_id and pf.company_id=l.company_id
      where l.company_id=p_company and l.intake_id=p_intake and l.state in ('matched','resolved') order by l.seq loop
    select count(*) n,sum(qi.total_weight_kg) kg,string_agg(distinct qi.finishing_type,', ') fin,max(qi.price_per_kg) rate,sum(qi.quantity_pieces) pcs into v_q
      from public.quote_items qi where qi.company_id=p_company and qi.quote_id=v_in.quote_id and qi.profile_id=v_line.profile_id;
    v_diff:='[]'::jsonb;
    if v_q.n=0 then v_diff:=v_diff||jsonb_build_array('Not on the quotation');
    else
      if v_line.finish is not null and position(v_line.finish in coalesce(v_q.fin,''))=0 then v_diff:=v_diff||jsonb_build_array(format('Finish differs: purchase order %s, quotation %s',replace(v_line.finish,'_',' '),replace(coalesce(v_q.fin,'not set'),'_',' '))); end if;
      if v_line.rate_per_kg is not null and coalesce(v_q.rate,0)>0 and abs(v_line.rate_per_kg-v_q.rate)>=0.01 then v_diff:=v_diff||jsonb_build_array(format('Rate differs: purchase order INR %s/kg, quotation INR %s/kg',trim_scale(v_line.rate_per_kg),trim_scale(round(v_q.rate,2)))); end if;
      if v_line.quantity_unit='kg' and coalesce(v_q.kg,0)>0 and abs(v_line.quantity-v_q.kg)>v_q.kg*0.005 then v_diff:=v_diff||jsonb_build_array(format('Quantity %s kg against %s kg quoted',trim_scale(v_line.quantity),trim_scale(round(v_q.kg,3)))); end if;
      if v_line.quantity_unit='piece' and coalesce(v_q.pcs,0)>0 and v_line.quantity<>v_q.pcs then v_diff:=v_diff||jsonb_build_array(format('Quantity %s pieces against %s pieces quoted',trim_scale(v_line.quantity),v_q.pcs)); end if;
      if v_line.quantity_unit='metre' then v_diff:=v_diff||jsonb_build_array('Quantity is in metres; the quotation is in kilograms and pieces. Compare it in order entry.'); end if;
    end if;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('seq',v_line.seq,'profile_code',v_line.profile_code,'differences',v_diff,'quoted_kg',v_q.kg,'quoted_rate',v_q.rate,'quoted_finish',v_q.fin));
  end loop;
  select string_agg(distinct pf.profile_code,', ') into v_missing from public.quote_items qi join public.aluminium_profiles pf on pf.id=qi.profile_id and pf.company_id=qi.company_id
    where qi.company_id=p_company and qi.quote_id=v_in.quote_id and not exists(select 1 from public.po_intake_lines l where l.company_id=p_company and l.intake_id=p_intake and l.state in ('matched','resolved') and l.profile_id=qi.profile_id);
  return jsonb_build_object('quote',(select quote_number from public.quotes where id=v_in.quote_id and company_id=p_company),'lines',v_rows,'quoted_not_ordered',v_missing);
end $$;

-- Differences between the reviewed draft and the order that was actually entered.
create function private.intake_order_diff(p_company uuid,p_intake uuid,p_order uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_out jsonb:='[]'::jsonb; v_line record; v_kg numeric; v_pcs numeric; v_n integer; v_extra text;
begin
  for v_line in select l.*,pf.profile_code from public.po_intake_lines l join public.aluminium_profiles pf on pf.id=l.profile_id and pf.company_id=l.company_id
      where l.company_id=p_company and l.intake_id=p_intake and l.state in ('matched','resolved') order by l.seq loop
    select count(*),sum(oi.quantity_kg),sum(oi.quantity_pieces) into v_n,v_kg,v_pcs from public.order_items oi where oi.company_id=p_company and oi.order_id=p_order and oi.profile_id=v_line.profile_id;
    if v_n=0 then v_out:=v_out||jsonb_build_array(format('Line %s (%s) is not on the order.',v_line.seq,v_line.profile_code));
    elsif v_line.quantity_unit='kg' and v_kg is not null and abs(v_kg-v_line.quantity)>v_line.quantity*0.005 then v_out:=v_out||jsonb_build_array(format('Line %s (%s): purchase order %s kg, order %s kg.',v_line.seq,v_line.profile_code,trim_scale(v_line.quantity),trim_scale(v_kg)));
    elsif v_line.quantity_unit='piece' and v_pcs is not null and v_pcs<>v_line.quantity then v_out:=v_out||jsonb_build_array(format('Line %s (%s): purchase order %s pieces, order %s pieces.',v_line.seq,v_line.profile_code,trim_scale(v_line.quantity),v_pcs));
    end if;
  end loop;
  select string_agg(distinct pf.profile_code,', ') into v_extra from public.order_items oi join public.aluminium_profiles pf on pf.id=oi.profile_id and pf.company_id=oi.company_id
    where oi.company_id=p_company and oi.order_id=p_order and not exists(select 1 from public.po_intake_lines l where l.company_id=p_company and l.intake_id=p_intake and l.state in ('matched','resolved') and l.profile_id=oi.profile_id);
  if v_extra is not null then v_out:=v_out||jsonb_build_array('The order also has '||v_extra||', which the purchase order does not state.'); end if;
  return v_out;
end $$;
revoke all on function private.intake_extract(uuid,uuid,text),private.intake_compare(uuid,uuid),private.intake_order_diff(uuid,uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-080: the records a rule would act on, oldest first, each with a stable event key.
------------------------------------------------------------------------------------------------
create function private.automation_candidates(p_company uuid,p_rule public.automation_rule_versions) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_today date:=private.ist_today(); v_list jsonb;
begin
  if p_rule.trigger_kind='invoice_overdue' then
    select coalesce(jsonb_agg(x.c order by x.d,x.k),'[]'::jsonb) into v_list from (
      select jsonb_build_object('source_type','invoice','source_id',iv.id,'label',concat(coalesce(iv.invoice_number,'Invoice'),' · ',cu.customer_name,' · ',v_today-iv.due_date,' day(s) overdue · balance ',private.specialist_money(bl.bal)),
          'key',concat(p_rule.rule_code,':invoice:',iv.id,':',iv.due_date),'title',left(concat('Follow up overdue invoice ',coalesce(iv.invoice_number,'')),120),
          'detail',concat(cu.customer_name,': ',private.specialist_money(bl.bal),' was due on ',to_char(iv.due_date,'DD Mon YYYY'),'.')) c,iv.due_date d,iv.id k
        from public.invoices iv join public.customers cu on cu.id=iv.customer_id and cu.company_id=iv.company_id
          cross join lateral (select greatest(coalesce(iv.balance_due,iv.grand_total-iv.amount_paid-iv.credited_amount),0) bal) bl
        where iv.company_id=p_company and iv.deleted_at is null and iv.status in ('generated','sent','partially_paid','overdue') and iv.due_date is not null
          and iv.due_date<=v_today-p_rule.min_days and bl.bal>=greatest(coalesce(p_rule.min_amount,0),0.01)
        order by iv.due_date,iv.id limit 200) x;
  elsif p_rule.trigger_kind='dispatch_overdue' then
    select coalesce(jsonb_agg(x.c order by x.d,x.k),'[]'::jsonb) into v_list from (
      select jsonb_build_object('source_type','dispatch','source_id',dp.id,'label',concat(coalesce(dp.dispatch_number,'Dispatch'),' · ',od.order_number,' · ',cu.customer_name,' · ',v_today-dp.dispatch_date,' day(s) past the dispatch date'),
          'key',concat(p_rule.rule_code,':dispatch:',dp.id,':',dp.dispatch_date),'title',left(concat('Dispatch still pending: ',coalesce(dp.dispatch_number,''),' for ',od.order_number),120),
          'detail',concat('Planned for ',to_char(dp.dispatch_date,'DD Mon YYYY'),' and still pending.')) c,dp.dispatch_date d,dp.id k
        from public.dispatches dp join public.orders od on od.id=dp.order_id and od.company_id=dp.company_id join public.customers cu on cu.id=od.customer_id and cu.company_id=od.company_id
        where dp.company_id=p_company and dp.delivery_status='pending' and dp.dispatch_date is not null and dp.dispatch_date<=v_today-p_rule.min_days and od.deleted_at is null
        order by dp.dispatch_date,dp.id limit 200) x;
  else
    select coalesce(jsonb_agg(x.c order by x.d,x.k),'[]'::jsonb) into v_list from (
      select jsonb_build_object('source_type','quote','source_id',qt.id,'label',concat(qt.quote_number,' · ',cu.customer_name,' · valid until ',to_char(qt.valid_until,'DD Mon YYYY')),
          'key',concat(p_rule.rule_code,':quote:',qt.id,':',qt.valid_until),'title',left(concat('Quotation expiring: ',qt.quote_number),120),
          'detail',concat(cu.customer_name,' has not decided; the quotation is valid until ',to_char(qt.valid_until,'DD Mon YYYY'),'.')) c,qt.valid_until d,qt.id k
        from public.quotes qt join public.customers cu on cu.id=qt.customer_id and cu.company_id=qt.company_id
        where qt.company_id=p_company and qt.deleted_at is null and qt.dealer_id is null and qt.status='sent' and qt.valid_until between v_today and v_today+p_rule.min_days
        order by qt.valid_until,qt.id limit 200) x;
  end if;
  return v_list;
end $$;
revoke all on function private.automation_candidates(uuid,public.automation_rule_versions) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-073: what needs attention on a bound order line.
------------------------------------------------------------------------------------------------
create function private.shade_line_state(p_company uuid,p_binding uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_b public.shade_bindings; v_ref public.shade_references; v_item public.order_items; v_mixed text; v_n integer; v_rej integer; v_undecided integer; v_newer integer; v_status text; v_flags jsonb:='[]'::jsonb;
begin
  select * into v_b from public.shade_bindings where id=p_binding and company_id=p_company;
  select * into v_ref from public.shade_references where id=v_b.reference_id and company_id=p_company;
  select * into v_item from public.order_items where id=v_b.order_item_id and company_id=p_company;
  select string_agg(distinct r2.ref_code,', ') into v_mixed from public.shade_bindings b2 join public.shade_references r2 on r2.id=b2.reference_id and r2.company_id=b2.company_id
    join public.order_items i2 on i2.id=b2.order_item_id and i2.company_id=b2.company_id
    where b2.company_id=p_company and b2.status='active' and b2.id<>v_b.id and i2.order_id=v_item.order_id and i2.profile_id is not distinct from v_item.profile_id and r2.ref_code<>v_ref.ref_code;
  select count(*),count(*) filter (where decision='reject') into v_n,v_rej from public.shade_decisions where company_id=p_company and binding_id=v_b.id and status='active';
  select count(*) into v_undecided from public.finishing_jobs fj where fj.company_id=p_company and fj.order_id=v_item.order_id
    and not exists(select 1 from public.shade_decisions d where d.company_id=p_company and d.binding_id=v_b.id and d.status='active' and d.finishing_job_id=fj.id);
  select max(revision) into v_newer from public.shade_references where company_id=p_company and ref_code=v_ref.ref_code and status='approved' and revision>v_ref.revision;
  if v_mixed is not null then v_flags:=v_flags||jsonb_build_array('Another line of this order with the same profile is bound to '||v_mixed||'. Mixed references need a reviewed decision before packing.'); end if;
  if v_rej>0 then v_flags:=v_flags||jsonb_build_array(v_rej||' batch(es) were rejected against the reference.'); end if;
  if v_ref.status='withdrawn' then v_flags:=v_flags||jsonb_build_array('The reference was withdrawn. Bind an approved reference.'); end if;
  if v_newer is not null then v_flags:=v_flags||jsonb_build_array(format('Revision %s of %s is now approved. The earlier approval stands for this line unless it is rebound.',v_newer,v_ref.ref_code)); end if;
  if v_n>0 and v_undecided>0 then v_flags:=v_flags||jsonb_build_array(v_undecided||' finishing job(s) of this order have no match decision. Batches are not reviewed together until each has one.'); end if;
  v_status:=case when v_b.status<>'active' then 'replaced' when v_mixed is not null then 'mixed_reference' when v_rej>0 then 'rejected_batch' when v_ref.status='withdrawn' then 'withdrawn_reference'
    when v_newer is not null then 'superseded_reference' when v_n=0 then 'awaiting_decision' when v_undecided>0 then 'unreviewed_batches' else 'matched' end;
  return jsonb_build_object('status',v_status,'flags',v_flags,'decisions',v_n,'rejected',v_rej,'undecided_jobs',v_undecided);
end $$;
revoke all on function private.shade_line_state(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-037: agreement line balance from releases (overrun included only where agreed).
------------------------------------------------------------------------------------------------
create function private.blanket_position(p_company uuid,p_line uuid) returns jsonb language sql stable security definer set search_path=public,private as $$
  select jsonb_build_object('agreed_kg',z.agreed_kg,'allowed_kg',z.allowed,'consumed_kg',z.consumed,'available_kg',greatest(z.allowed-z.consumed,0),'scheduled_kg',z.scheduled,'firm_kg',z.firm,
    'fulfilled_kg',z.fulfilled,'returned_kg',z.returned,'cancelled_kg',z.cancelled,'in_overrun',z.consumed>z.agreed_kg)
  from (select bl.agreed_kg,round(bl.agreed_kg*(1+ba.overrun_percent/100),3) allowed,
      coalesce(sum(br.quantity_kg-br.returned_kg) filter (where br.status in ('scheduled','firm','fulfilled')),0) consumed,
      coalesce(sum(br.quantity_kg) filter (where br.status='scheduled'),0) scheduled,coalesce(sum(br.quantity_kg) filter (where br.status='firm'),0) firm,
      coalesce(sum(br.quantity_kg) filter (where br.status='fulfilled'),0) fulfilled,coalesce(sum(br.returned_kg),0) returned,
      coalesce(sum(br.cancelled_kg),0)+coalesce(sum(br.quantity_kg) filter (where br.status='cancelled'),0) cancelled
    from public.blanket_lines bl join public.blanket_agreements ba on ba.id=bl.agreement_id and ba.company_id=bl.company_id
      left join public.blanket_releases br on br.line_id=bl.id and br.company_id=bl.company_id
    where bl.id=p_line and bl.company_id=p_company group by bl.agreed_kg,ba.overrun_percent) z
$$;
create function private.blanket_rate_on(p_company uuid,p_line uuid,p_date date) returns public.blanket_rates language sql stable security definer set search_path=public,private as $$
  select * from public.blanket_rates where company_id=p_company and line_id=p_line and effective_from<=p_date order by effective_from desc limit 1
$$;
revoke all on function private.blanket_position(uuid,uuid),private.blanket_rate_on(uuid,uuid,date) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-065: the commercial position of a die from linked finance records that still count.
------------------------------------------------------------------------------------------------
create function private.tooling_counts(p_company uuid,p_alloc public.tooling_allocations) returns boolean language sql stable security definer set search_path=public,private as $$
  select p_alloc.reversed_at is null and case p_alloc.kind
    when 'charge_invoice' then exists(select 1 from public.invoices iv where iv.id=p_alloc.invoice_id and iv.company_id=p_company and iv.deleted_at is null and iv.status not in ('draft','cancelled'))
    when 'recovery' then exists(select 1 from public.invoices iv left join public.orders od on od.id=iv.order_id and od.company_id=iv.company_id
      where iv.id=p_alloc.invoice_id and iv.company_id=p_company and iv.deleted_at is null and iv.status not in ('draft','cancelled') and coalesce(od.current_stage,'')<>'cancelled')
    when 'payment' then exists(select 1 from public.payments pm where pm.id=p_alloc.payment_id and pm.company_id=p_company and pm.reversed_at is null)
    else exists(select 1 from public.credit_notes cn where cn.id=p_alloc.credit_note_id and cn.company_id=p_company and cn.status='issued') end
$$;
create function private.tooling_position(p_company uuid,p_family uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_ag public.tooling_agreements; v_charged numeric; v_credited numeric; v_received numeric; v_recovered numeric; v_not integer; v_due numeric;
begin
  select * into v_ag from public.tooling_agreements where company_id=p_company and family_id=p_family order by (status='active') desc,version desc limit 1;
  select coalesce(sum(al.amount) filter (where al.kind='charge_invoice' and c.ok),0),coalesce(sum(al.amount) filter (where al.kind='credit_note' and c.ok),0),
      coalesce(sum(al.amount) filter (where al.kind='payment' and c.ok),0),coalesce(sum(al.amount) filter (where al.kind='recovery' and c.ok),0),
      count(*) filter (where al.reversed_at is null and not c.ok)
    into v_charged,v_credited,v_received,v_recovered,v_not
    from public.tooling_allocations al cross join lateral (select private.tooling_counts(p_company,al) ok) c where al.company_id=p_company and al.family_id=p_family;
  v_due:=v_ag.customer_contribution-v_ag.waiver_amount;
  return jsonb_build_object('contribution_due',v_due,'charged',v_charged,'credited',v_credited,'received',v_received,'recovered',v_recovered,'outstanding',v_due-v_received-v_recovered,
    'uninvoiced',greatest(v_due-(v_charged-v_credited)-v_recovered,0),'cap_remaining',case when v_ag.recovery_basis='per_kg' then greatest(v_ag.recovery_cap-v_recovered,0) end,
    'not_counted',v_not,'over_recovered',v_received+v_recovered>v_due);
end $$;
revoke all on function private.tooling_counts(uuid,public.tooling_allocations),private.tooling_position(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-032: the customer metal account from receipts and movements; differences are kept, not hidden.
------------------------------------------------------------------------------------------------
create function private.toll_position(p_company uuid,p_customer uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_ag public.toll_agreements; v_receipts jsonb; v_jobs jsonb; v_tot jsonb;
begin
  select * into v_ag from public.toll_agreements where company_id=p_company and customer_id=p_customer and status='approved';
  select coalesce(jsonb_agg(jsonb_build_object('receipt_id',tr.id,'receipt_number',tr.receipt_number,'challan_ref',tr.challan_ref,'heat_ref',tr.heat_ref,'alloy',tr.alloy,'location',tr.location,'received_kg',tr.received_kg,
      'quality_status',tr.quality_status,'issued_kg',mv.issued,'returned_kg',mv.returned,'usable_kg',case when tr.quality_status='accepted' then tr.received_kg-mv.issued-mv.returned else 0 end,
      'returnable_kg',tr.received_kg-mv.issued-mv.returned,'received_at',tr.received_at) order by tr.received_at,tr.id),'[]'::jsonb) into v_receipts
    from public.toll_receipts tr cross join lateral (select coalesce(sum(m.quantity_kg) filter (where m.kind='issue'),0) issued,coalesce(sum(m.quantity_kg) filter (where m.kind='return_metal'),0) returned
      from public.toll_movements m where m.company_id=tr.company_id and m.receipt_id=tr.id and m.status='active') mv
    where tr.company_id=p_company and tr.customer_id=p_customer;
  select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'job_number',j.job_number,'job_status',j.status,'order_number',od.order_number,'issued_kg',mv.issued,'output_kg',mv.output,'scrap_kg',mv.scrap,'explained_loss_kg',mv.loss,
      'in_process_kg',mv.issued-mv.output-mv.scrap-mv.loss,'allowed_loss_kg',case when v_ag.allowed_loss_percent is not null then round(mv.issued*v_ag.allowed_loss_percent/100,3) end,
      'unexplained_kg',case when j.status='completed' then mv.issued-mv.output-mv.scrap-mv.loss else 0 end) order by od.order_number,j.job_number),'[]'::jsonb) into v_jobs
    from public.production_jobs j join public.orders od on od.id=j.order_id and od.company_id=j.company_id
      cross join lateral (select coalesce(sum(m.quantity_kg) filter (where m.kind='issue'),0) issued,coalesce(sum(m.quantity_kg) filter (where m.kind='output'),0) output,
        coalesce(sum(m.quantity_kg) filter (where m.kind='scrap'),0) scrap,coalesce(sum(m.quantity_kg) filter (where m.kind='explained_loss'),0) loss
        from public.toll_movements m where m.company_id=j.company_id and m.production_job_id=j.id and m.status='active' and m.customer_id=p_customer) mv
    where j.company_id=p_company and od.customer_id=p_customer and mv.issued>0;
  select jsonb_build_object('received_accepted_kg',coalesce(sum(tr.received_kg) filter (where tr.quality_status='accepted'),0),'received_pending_kg',coalesce(sum(tr.received_kg) filter (where tr.quality_status='pending'),0),
      'received_rejected_kg',coalesce(sum(tr.received_kg) filter (where tr.quality_status='rejected'),0)) into v_tot from public.toll_receipts tr where tr.company_id=p_company and tr.customer_id=p_customer;
  select v_tot||jsonb_build_object('issued_kg',coalesce(sum(m.quantity_kg) filter (where m.kind='issue'),0),'output_kg',coalesce(sum(m.quantity_kg) filter (where m.kind='output'),0),
      'scrap_kg',coalesce(sum(m.quantity_kg) filter (where m.kind='scrap'),0),'explained_loss_kg',coalesce(sum(m.quantity_kg) filter (where m.kind='explained_loss'),0),
      'returned_metal_kg',coalesce(sum(m.quantity_kg) filter (where m.kind='return_metal'),0),'returned_scrap_kg',coalesce(sum(m.quantity_kg) filter (where m.kind='return_scrap'),0)) into v_tot
    from public.toll_movements m where m.company_id=p_company and m.customer_id=p_customer and m.status='active';
  v_tot:=v_tot||jsonb_build_object('usable_kg',(select coalesce(sum((x->>'usable_kg')::numeric),0) from jsonb_array_elements(v_receipts) x),
    'in_process_kg',(select coalesce(sum((x->>'in_process_kg')::numeric),0) from jsonb_array_elements(v_jobs) x),
    'unexplained_kg',(select coalesce(sum((x->>'unexplained_kg')::numeric),0) from jsonb_array_elements(v_jobs) x),
    'scrap_on_hand_kg',(v_tot->>'scrap_kg')::numeric-(v_tot->>'returned_scrap_kg')::numeric);
  return jsonb_build_object('agreement',case when v_ag.id is null then null else jsonb_build_object('id',v_ag.id,'revision',v_ag.revision,'material_spec',v_ag.material_spec,'alloy',v_ag.alloy,'permitted_mixing',v_ag.permitted_mixing,
      'allowed_loss_percent',v_ag.allowed_loss_percent,'conversion_rate_per_kg',v_ag.conversion_rate_per_kg,'billing_basis',v_ag.billing_basis) end,'totals',v_tot,'receipts',v_receipts,'jobs',v_jobs);
end $$;
revoke all on function private.toll_position(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-072: what the readings show. A finished timer is not evidence of conformance.
------------------------------------------------------------------------------------------------
create function private.treatment_assess(p_company uuid,p_batch uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_b public.treatment_batches; v_r public.treatment_recipes; v_m public.machines; v_n integer; v_out integer; v_lo numeric; v_hi numeric; v_soak numeric; v_dev jsonb:='[]'::jsonb; v_service boolean;
begin
  select * into v_b from public.treatment_batches where id=p_batch and company_id=p_company;
  select * into v_r from public.treatment_recipes where id=v_b.recipe_id and company_id=p_company;
  select * into v_m from public.machines where id=v_b.machine_id and company_id=p_company;
  select count(*),count(*) filter (where temperature_c not between v_r.temp_min_c and v_r.temp_max_c),min(temperature_c),max(temperature_c) into v_n,v_out,v_lo,v_hi
    from public.treatment_observations where company_id=p_company and batch_id=p_batch;
  v_soak:=case when v_b.started_at is not null and v_b.ended_at is not null then round(extract(epoch from (v_b.ended_at-v_b.started_at))/60.0,1) end;
  v_service:=v_m.is_active and v_m.status in ('active','operational','idle');
  if v_n<v_r.min_readings then v_dev:=v_dev||jsonb_build_array(format('%s of the %s required temperature readings are recorded.',v_n,v_r.min_readings)); end if;
  if v_out>0 then v_dev:=v_dev||jsonb_build_array(format('%s reading(s) are outside %s to %s °C.',v_out,trim_scale(v_r.temp_min_c),trim_scale(v_r.temp_max_c))); end if;
  if v_soak is not null and v_soak not between v_r.soak_min_minutes and v_r.soak_max_minutes then v_dev:=v_dev||jsonb_build_array(format('The cycle lasted %s minutes; the recipe allows %s to %s.',trim_scale(v_soak),v_r.soak_min_minutes,v_r.soak_max_minutes)); end if;
  if v_b.status='interrupted' then v_dev:=v_dev||jsonb_build_array('The cycle was recorded as interrupted.'); end if;
  if not v_service then v_dev:=v_dev||jsonb_build_array('The oven is not in service ('||v_m.status||'). Check the equipment before relying on this cycle.'); end if;
  return jsonb_build_object('readings',v_n,'required_readings',v_r.min_readings,'out_of_range',v_out,'min_c',v_lo,'max_c',v_hi,'soak_minutes',v_soak,'readings_ok',v_n>=v_r.min_readings,
    'deviations',v_dev,'equipment_in_service',v_service,'machine_status',v_m.status);
end $$;
revoke all on function private.treatment_assess(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-074: the quantity a weighing should reconcile with. Unknown stays unknown.
------------------------------------------------------------------------------------------------
create function private.weighing_expected(p_company uuid,p_kind text,p_dispatch uuid,p_receipt uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_n integer; v_gross numeric; v_metal numeric; v_other integer;
begin
  if p_kind='dispatch' then
    select count(*),sum(pl.gross_weight_kg),sum(coalesce(pl.net_weight_kg,pl.gross_weight_kg-pl.tare_weight_kg)) into v_n,v_gross,v_metal from public.packing_list_items pl where pl.company_id=p_company and pl.dispatch_id=p_dispatch;
    return jsonb_build_object('basis','packed bundles (gross, including packaging)','bundles',v_n,'expected_kg',case when v_n>0 then v_gross end,'metal_kg',case when v_n>0 then v_metal end,
      'packaging_kg',case when v_n>0 then v_gross-v_metal end);
  end if;
  select count(*) filter (where lower(pl.unit) in ('kg','kgs')),sum(rl.received_quantity) filter (where lower(pl.unit) in ('kg','kgs')),count(*) filter (where lower(pl.unit) not in ('kg','kgs'))
    into v_n,v_gross,v_other from public.purchase_receipt_lines rl join public.purchase_order_lines pl on pl.id=rl.purchase_order_line_id and pl.company_id=rl.company_id
    where rl.company_id=p_company and rl.receipt_id=p_receipt;
  return jsonb_build_object('basis','received quantity on kilogram lines','bundles',null,'expected_kg',case when v_n>0 then v_gross end,'metal_kg',case when v_n>0 then v_gross end,'packaging_kg',null,'other_unit_lines',v_other);
end $$;
revoke all on function private.weighing_expected(uuid,text,uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Read models. Each row is {id,label,status,owner,due_date,summary,source_href,details}.
------------------------------------------------------------------------------------------------
create function private.specialist_rows(p_company uuid,p_actor uuid,p_role text,p_view text,p_state text,p_id uuid default null)
returns table(row_data jsonb,sort_rank integer,sort_due date,sort_new timestamptz) language plpgsql stable security definer set search_path=public,private as $$
declare v_today date:=private.ist_today();
begin
  if p_view='intake' then
    return query select jsonb_build_object('id',ik.id,'label',concat(ik.intake_number,' · ',cu.customer_name,' · PO ',ik.customer_po_ref),'status',st.s,'owner',u.full_name,'due_date',ik.po_date,
        'summary',concat(ln.cand,' order line(s): ',ln.ok,' reviewed, ',ln.unres,' to resolve · ',ln.notes,' other line(s) kept as evidence',
          case when ik.quote_id is not null then ' · compared with '||qt.quote_number else ' · no quotation chosen' end,case when ik.order_id is not null then ' · order '||od.order_number else '' end),
        'source_href',case when ik.order_id is not null then '/orders/'||ik.order_id end,
        'details',jsonb_build_object('intake_id',ik.id,'intake_number',ik.intake_number,'customer',cu.customer_name,'customer_id',ik.customer_id,'customer_po_ref',ik.customer_po_ref,'po_date',ik.po_date,
          'quote_id',ik.quote_id,'quote_number',qt.quote_number,'intake_status',ik.status,'order_id',ik.order_id,'order_number',od.order_number,'checksum',ik.source_checksum,'created_by',u.full_name,
          'created_at',ik.created_at,'close_note',ik.close_note,'amends',am.intake_number,'counts',jsonb_build_object('candidates',ln.cand,'reviewed',ln.ok,'unresolved',ln.unres,'other',ln.notes),
          'lines',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'seq',l.seq,'source_line',l.source_line,'raw_text',l.raw_text,'code_text',l.code_text,
              'profile_id',l.profile_id,'profile_code',pf.profile_code,'quantity',l.quantity,'quantity_unit',l.quantity_unit,'length_mm',l.length_mm,'finish',l.finish,'due_date',l.due_date,'rate_per_kg',l.rate_per_kg,
              'match_basis',l.match_basis,'state',l.state,'issues',l.issues) order by l.seq),'[]'::jsonb)
            from public.po_intake_lines l left join public.aluminium_profiles pf on pf.id=l.profile_id and pf.company_id=l.company_id where l.company_id=p_company and l.intake_id=ik.id) end,
          'comparison',case when p_id is null then null else private.intake_compare(p_company,ik.id) end,'source_text',case when p_id is null then null else ik.source_text end)),
      case st.s when 'needs_resolution' then 0 when 'review' then 1 when 'ready' then 2 else 9 end,ik.po_date,ik.created_at
    from public.po_intakes ik join public.customers cu on cu.id=ik.customer_id and cu.company_id=ik.company_id left join public.quotes qt on qt.id=ik.quote_id and qt.company_id=ik.company_id
      left join public.orders od on od.id=ik.order_id and od.company_id=ik.company_id left join public.app_users u on u.id=ik.created_by and u.company_id=ik.company_id
      left join public.po_intakes am on am.id=ik.amends_intake_id and am.company_id=ik.company_id
      cross join lateral (select count(*) filter (where l.state<>'not_a_line') cand,count(*) filter (where l.state in ('matched','resolved')) ok,count(*) filter (where l.state='unresolved') unres,
        count(*) filter (where l.state='not_a_line') notes from public.po_intake_lines l where l.company_id=ik.company_id and l.intake_id=ik.id) ln
      cross join lateral (select case when ik.status='review' and ln.unres>0 then 'needs_resolution' else ik.status end s) st
    where ik.company_id=p_company and (p_id is null or ik.id=p_id) and (p_id is not null or p_state='all' or ik.status in ('review','ready'));

  elsif p_view='automation' then
    return query
    select jsonb_build_object('id',rv.id,'label',concat(rv.rule_code,' v',rv.version,' · ',rv.name),'status',rv.status,'owner',cu.full_name,'due_date',null,
        'summary',concat(case rv.trigger_kind when 'invoice_overdue' then 'Invoices overdue by '||rv.min_days||' or more day(s)'||coalesce(' with at least '||private.specialist_money(rv.min_amount)||' due','')
            when 'dispatch_overdue' then 'Dispatches still pending '||rv.min_days||' or more day(s) after the dispatch date' else 'Sent quotations expiring within '||rv.min_days||' day(s)' end,
          ' · creates a ',rv.task_priority,' task ',coalesce('for '||au.full_name,'(unassigned)'),' due in ',rv.due_in_days,' day(s)',
          coalesce(' · last run '||to_char(le.started_at at time zone 'Asia/Kolkata','DD Mon HH24:MI')||' ('||le.mode||')','')),
        'source_href','/automation',
        'details',jsonb_build_object('kind','rule','rule_id',rv.id,'rule_code',rv.rule_code,'version',rv.version,'name',rv.name,'trigger_kind',rv.trigger_kind,'min_days',rv.min_days,'min_amount',rv.min_amount,
          'task_priority',rv.task_priority,'assign_to',au.full_name,'assign_active',au.is_active,'due_in_days',rv.due_in_days,'rule_status',rv.status,'created_by',cu.full_name,'created_by_id',rv.created_by,
          'approved_by',ap.full_name,'approved_at',rv.approved_at,
          'candidates',case when p_id is null then null else (select jsonb_build_object('count',jsonb_array_length(cv.v),'sample',(select coalesce(jsonb_agg(t.e->'label'),'[]'::jsonb) from (select e from jsonb_array_elements(cv.v) t(e) limit 10) t))
            from (select private.automation_candidates(p_company,rv) v) cv) end,
          'executions',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',ex.id,'mode',ex.mode,'status',ex.status,'version',ex.rule_version,'started_at',ex.started_at,'candidates',ex.candidates,
              'succeeded',ex.succeeded,'skipped',ex.skipped,'failed',ex.failed,'simulated',ex.simulated,'unprocessed',ex.unprocessed) order by ex.started_at desc),'[]'::jsonb)
            from (select * from public.automation_executions e2 where e2.company_id=p_company and e2.rule_code=rv.rule_code order by e2.started_at desc limit 10) ex) end)),
      case rv.status when 'draft' then 1 when 'paused' then 2 when 'approved' then 4 else 9 end,null::date,rv.created_at
    from public.automation_rule_versions rv left join public.app_users cu on cu.id=rv.created_by and cu.company_id=rv.company_id
      left join public.app_users au on au.id=rv.assign_to and au.company_id=rv.company_id left join public.app_users ap on ap.id=rv.approved_by and ap.company_id=rv.company_id
      left join lateral (select e.started_at,e.mode from public.automation_executions e where e.company_id=rv.company_id and e.rule_id=rv.id order by e.started_at desc limit 1) le on true
    where rv.company_id=p_company and (p_id is null or rv.id=p_id) and (p_id is not null or p_state='all' or rv.status in ('draft','approved','paused'))
    union all
    select jsonb_build_object('id',ex.id,'label',concat(case ex.mode when 'simulation' then 'Simulation' else 'Execution' end,' · ',ex.rule_code,' v',ex.rule_version,' · ',to_char(ex.started_at at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI')),
        'status',ex.status,'owner',u.full_name,'due_date',null,
        'summary',case when ex.mode='simulation' then concat('Simulated only: ',ex.simulated,' task(s) would be created, ',ex.skipped,' skipped as already actioned, ',ex.unprocessed,' beyond this run. Nothing was executed.')
          else concat(ex.candidates,' record(s) due: ',ex.succeeded,' task(s) created, ',ex.skipped,' skipped, ',ex.failed,' failed, ',ex.unprocessed,' left for the next run') end,
        'source_href',null,
        'details',jsonb_build_object('kind','execution','execution_id',ex.id,'mode',ex.mode,'rule_code',ex.rule_code,'rule_version',ex.rule_version,'rule_id',ex.rule_id,'started_at',ex.started_at,'started_by',u.full_name,
          'candidates',ex.candidates,'succeeded',ex.succeeded,'skipped',ex.skipped,'failed',ex.failed,'simulated',ex.simulated,'unprocessed',ex.unprocessed,
          'effects',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('source_type',ef.source_type,'source_label',ef.source_label,'outcome',ef.outcome,'task_id',ef.task_id,'reason',ef.reason) order by ef.recorded_at,ef.id),'[]'::jsonb)
            from public.automation_effects ef where ef.company_id=p_company and ef.execution_id=ex.id) end)),
      case ex.status when 'failed' then 0 when 'partial' then 0 else 9 end,null::date,ex.started_at
    from public.automation_executions ex left join public.app_users u on u.id=ex.started_by and u.company_id=ex.company_id
    where ex.company_id=p_company and (p_id is null or ex.id=p_id) and (p_id is not null or p_state='all' or ex.started_at>=now()-interval '7 days');

  elsif p_view='lab' then
    return query select jsonb_build_object('id',lr.id,'label',concat(lr.request_number,' · sample ',lr.sample_ref,' · ',vd.vendor_name),'status',st.s,'owner',u.full_name,'due_date',coalesce(lr.revised_date,lr.promised_date),
        'summary',concat(jsonb_array_length(lr.tests),' test(s) · ',rs.done,' with a laboratory result · ',
          case lr.material_kind when 'production_job' then 'job '||coalesce(pj.job_number,'') when 'billet_batch' then 'billet batch '||bb.batch_number else coalesce(lr.material_note,'other material') end,
          case when od.id is not null and od.current_stage not in ('cancelled','closed','delivered') then ' · order '||od.order_number||' waits for it' else '' end,
          case when lr.decision is not null then ' · quality decision: '||replace(lr.decision,'_',' ') else '' end),
        'source_href',case when od.id is not null then '/orders/'||od.id end,
        'details',jsonb_build_object('request_id',lr.id,'request_number',lr.request_number,'sample_ref',lr.sample_ref,'material_kind',lr.material_kind,'job_number',pj.job_number,'billet_batch',bb.batch_number,
          'material_note',lr.material_note,'lab',vd.vendor_name,'lab_vendor_id',lr.lab_vendor_id,'tests',lr.tests,'promised_date',lr.promised_date,'revised_date',lr.revised_date,'estimated_charge',lr.estimated_charge,
          'request_status',lr.status,'dispatch_ref',lr.dispatch_ref,'dispatched_at',lr.dispatched_at,'lab_received_at',lr.lab_received_at,'lab_sample_ref',lr.lab_sample_ref,'decision',lr.decision,
          'decision_note',lr.decision_note,'decided_at',lr.decided_at,'decision_history',lr.decision_history,'retest_of',rt.request_number,'created_by',u.full_name,
          'affected_order',case when od.id is null then null else jsonb_build_object('order_number',od.order_number,'stage',od.current_stage,'expected_dispatch_date',od.expected_dispatch_date) end,
          'results',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('test_code',r.test_code,'revision',r.revision,'statement',r.statement,'lab_outcome',r.lab_outcome,'report_ref',r.report_ref,
              'recorded_at',r.recorded_at,'current',r.revision=(select max(r2.revision) from public.lab_results r2 where r2.request_id=r.request_id and r2.test_code=r.test_code)) order by r.test_code,r.revision desc),'[]'::jsonb)
            from public.lab_results r where r.company_id=p_company and r.request_id=lr.id) end)),
      case st.s when 'overdue' then 0 when 'reported' then 1 when 'partial' then 2 when 'requested' then 3 when 'dispatched' then 3 when 'at_lab' then 3 else 9 end,coalesce(lr.revised_date,lr.promised_date),lr.created_at
    from public.lab_requests lr join public.vendors vd on vd.id=lr.lab_vendor_id and vd.company_id=lr.company_id left join public.production_jobs pj on pj.id=lr.production_job_id and pj.company_id=lr.company_id
      left join public.orders od on od.id=pj.order_id and od.company_id=pj.company_id left join public.billet_batches bb on bb.id=lr.billet_batch_id and bb.company_id=lr.company_id
      left join public.app_users u on u.id=lr.created_by and u.company_id=lr.company_id left join public.lab_requests rt on rt.id=lr.retest_of and rt.company_id=lr.company_id
      cross join lateral (select count(distinct r.test_code) done from public.lab_results r where r.company_id=lr.company_id and r.request_id=lr.id) rs
      cross join lateral (select case when lr.status in ('requested','dispatched','at_lab','partial') and coalesce(lr.revised_date,lr.promised_date)<v_today then 'overdue' else lr.status end s) st
    where lr.company_id=p_company and (p_id is null or lr.id=p_id) and (p_id is not null or p_state='all' or lr.status in ('requested','dispatched','at_lab','partial','reported'));

  elsif p_view='shades' then
    return query
    select jsonb_build_object('id',sr.id,'label',concat(sr.ref_code,' rev ',sr.revision,' · ',sr.shade_name),'status',sr.status,'owner',cu.full_name,'due_date',null,
        'summary',concat(replace(sr.finish_type,'_',' '),' · ',coalesce(c.customer_name,'any customer'),coalesce(' · project '||sr.project_ref,''),' · sample at ',sr.sample_location,' · ',bn.n,' active order line(s)'),
        'source_href',null,
        'details',jsonb_build_object('kind','reference','reference_id',sr.id,'ref_code',sr.ref_code,'revision',sr.revision,'shade_name',sr.shade_name,'finish_type',sr.finish_type,'specification',sr.specification,
          'customer',c.customer_name,'customer_id',sr.customer_id,'project_ref',sr.project_ref,'sample_location',sr.sample_location,'assessment_conditions',sr.assessment_conditions,'reference_status',sr.status,
          'created_by',cu.full_name,'created_by_id',sr.created_by,'approved_by',ap.full_name,'approved_at',sr.approved_at,
          'bindings',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('binding_id',b.id,'order_number',od.order_number,'line',oi.item_description,'status',private.shade_line_state(p_company,b.id)->>'status') order by od.order_number),'[]'::jsonb)
            from public.shade_bindings b join public.order_items oi on oi.id=b.order_item_id and oi.company_id=b.company_id join public.orders od on od.id=oi.order_id and od.company_id=oi.company_id
            where b.company_id=p_company and b.reference_id=sr.id and b.status='active') end)),
      case sr.status when 'draft' then 1 when 'approved' then 6 else 9 end,null::date,sr.created_at
    from public.shade_references sr left join public.customers c on c.id=sr.customer_id and c.company_id=sr.company_id left join public.app_users cu on cu.id=sr.created_by and cu.company_id=sr.company_id
      left join public.app_users ap on ap.id=sr.approved_by and ap.company_id=sr.company_id
      cross join lateral (select count(*) n from public.shade_bindings b where b.company_id=sr.company_id and b.reference_id=sr.id and b.status='active') bn
    where sr.company_id=p_company and (p_id is null or sr.id=p_id) and (p_id is not null or p_state='all' or sr.status in ('draft','approved'))
    union all
    select jsonb_build_object('id',b.id,'label',concat(od.order_number,' · ',coalesce(oi.item_description,'order line'),' · ',sr.ref_code,' rev ',sr.revision),'status',ls.v->>'status','owner',null,'due_date',od.expected_dispatch_date,
        'summary',concat(sr.shade_name,' · ',(ls.v->>'decisions'),' batch decision(s)',case when jsonb_array_length(ls.v->'flags')>0 then ' · '||(ls.v->'flags'->>0) else '' end),
        'source_href','/orders/'||od.id,
        'details',jsonb_build_object('kind','line','binding_id',b.id,'binding_status',b.status,'reference_id',sr.id,'ref_code',sr.ref_code,'revision',sr.revision,'shade_name',sr.shade_name,'finish_type',sr.finish_type,
          'reference_status',sr.status,'specification',sr.specification,'assessment_conditions',sr.assessment_conditions,'sample_location',sr.sample_location,'order_id',od.id,'order_number',od.order_number,
          'customer',c.customer_name,'line',oi.item_description,'order_item_id',oi.id,'line_finish',oi.finishing_type,'flags',ls.v->'flags','line_status',ls.v->>'status',
          'decisions',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'batch_label',d.batch_label,'finishing_job_id',d.finishing_job_id,'decision',d.decision,'assessed_under',d.assessed_under,
              'status',d.status,'decided_at',d.decided_at,'note',d.note) order by d.decided_at desc),'[]'::jsonb) from public.shade_decisions d where d.company_id=p_company and d.binding_id=b.id) end,
          'finishing_jobs',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',fj.id,'status',fj.status,'shade_name',fj.shade_name,'color_code',fj.color_code,'sent_date',fj.sent_date,'received_date',fj.received_date) order by fj.sent_date nulls last,fj.id),'[]'::jsonb)
            from public.finishing_jobs fj where fj.company_id=p_company and fj.order_id=od.id) end)),
      case ls.v->>'status' when 'mixed_reference' then 0 when 'rejected_batch' then 0 when 'withdrawn_reference' then 1 when 'superseded_reference' then 2 when 'unreviewed_batches' then 2 when 'awaiting_decision' then 3 else 8 end,
      od.expected_dispatch_date,b.bound_at
    from public.shade_bindings b join public.shade_references sr on sr.id=b.reference_id and sr.company_id=b.company_id join public.order_items oi on oi.id=b.order_item_id and oi.company_id=b.company_id
      join public.orders od on od.id=oi.order_id and od.company_id=oi.company_id join public.customers c on c.id=od.customer_id and c.company_id=od.company_id
      cross join lateral (select private.shade_line_state(p_company,b.id) v) ls
    where b.company_id=p_company and (p_id is null or b.id=p_id) and (p_id is not null or (b.status='active' and (p_state='all' or (ls.v->>'status'<>'matched' and od.current_stage not in ('closed','cancelled','delivered')))));

  elsif p_view='agreements' then
    return query select jsonb_build_object('id',ba.id,'label',concat(ba.agreement_number,' · ',cu.customer_name,' · ',ba.customer_ref),'status',st.s,'owner',u.full_name,'due_date',ba.valid_to,
        'summary',concat(to_char(ba.valid_from,'DD Mon YYYY'),' to ',to_char(ba.valid_to,'DD Mon YYYY'),' · ',ps.lines,' line(s) · ',private.specialist_kg(ps.agreed),' agreed, ',private.specialist_kg(ps.consumed),' released, ',
          private.specialist_kg(ps.available),' available',case when ba.overrun_percent>0 then ' (with '||trim_scale(ba.overrun_percent)||'% agreed overrun)' else '' end,' · ',rl.open_n,' open release(s)'),
        'source_href',null,
        'details',jsonb_build_object('agreement_id',ba.id,'agreement_number',ba.agreement_number,'customer',cu.customer_name,'customer_id',ba.customer_id,'customer_ref',ba.customer_ref,'valid_from',ba.valid_from,'valid_to',ba.valid_to,
          'overrun_percent',ba.overrun_percent,'agreement_status',ba.status,'created_by',u.full_name,'created_by_id',ba.created_by,'approved_at',ba.approved_at,'close_note',ba.close_note,
          'carried_from',(select agreement_number from public.blanket_agreements where id=ba.carried_from and company_id=ba.company_id),'carried_to',(select agreement_number from public.blanket_agreements where id=ba.carried_to and company_id=ba.company_id),
          'lines',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('line_id',bl.id,'seq',bl.seq,'profile_code',pf.profile_code,'finish',bl.finish,'position',private.blanket_position(p_company,bl.id),
              'rate',(select rate_per_kg from public.blanket_rates br where br.line_id=bl.id and br.effective_from<=v_today order by br.effective_from desc limit 1),'history',bl.history,
              'rates',(select coalesce(jsonb_agg(jsonb_build_object('rate',br.rate_per_kg,'effective_from',br.effective_from,'note',br.note) order by br.effective_from),'[]'::jsonb) from public.blanket_rates br where br.line_id=bl.id)) order by bl.seq),'[]'::jsonb)
            from public.blanket_lines bl join public.aluminium_profiles pf on pf.id=bl.profile_id and pf.company_id=bl.company_id where bl.company_id=p_company and bl.agreement_id=ba.id) end,
          'releases',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'release_number',r.release_number,'line_seq',bl.seq,'profile_code',pf.profile_code,'quantity_kg',r.quantity_kg,'site',r.site,
              'requested_date',r.requested_date,'status',r.status,'rate_per_kg',r.rate_per_kg,'rate_effective_from',r.rate_effective_from,'order_number',od.order_number,'returned_kg',r.returned_kg,'cancelled_kg',r.cancelled_kg,'history',r.history) order by r.requested_date,r.release_number),'[]'::jsonb)
            from public.blanket_releases r join public.blanket_lines bl on bl.id=r.line_id and bl.company_id=r.company_id join public.aluminium_profiles pf on pf.id=bl.profile_id and pf.company_id=bl.company_id
              left join public.orders od on od.id=r.order_id and od.company_id=r.company_id where r.company_id=p_company and r.agreement_id=ba.id) end)),
      case st.s when 'draft' then 1 when 'expired' then 2 when 'active' then case when ba.valid_to<=v_today+15 then 2 else 4 end else 9 end,ba.valid_to,ba.created_at
    from public.blanket_agreements ba join public.customers cu on cu.id=ba.customer_id and cu.company_id=ba.company_id left join public.app_users u on u.id=ba.created_by and u.company_id=ba.company_id
      cross join lateral (select count(*) lines,coalesce(sum(bl.agreed_kg),0) agreed,coalesce(sum((p.v->>'consumed_kg')::numeric),0) consumed,coalesce(sum((p.v->>'available_kg')::numeric),0) available
        from public.blanket_lines bl cross join lateral (select private.blanket_position(p_company,bl.id) v) p where bl.company_id=ba.company_id and bl.agreement_id=ba.id) ps
      cross join lateral (select count(*) open_n from public.blanket_releases r where r.company_id=ba.company_id and r.agreement_id=ba.id and r.status in ('scheduled','firm')) rl
      cross join lateral (select case when ba.status='active' and ba.valid_to<v_today then 'expired' else ba.status end s) st
    where ba.company_id=p_company and (p_id is null or ba.id=p_id) and (p_id is not null or p_state='all' or ba.status in ('draft','active'));

  elsif p_view='tooling' then
    return query select jsonb_build_object('id',ta.id,'label',concat(ta.agreement_number,' v',ta.version,' · die ',dd.die_number,' · ',cu.customer_name),'status',st.s,'owner',u.full_name,'due_date',null,
        'summary',concat('Owner: ',ta.owner_party,' · contribution ',private.specialist_money(ta.customer_contribution),case when ta.waiver_amount>0 then ', waived '||private.specialist_money(ta.waiver_amount) else '' end,
          ' · received ',private.specialist_money((tp.v->>'received')::numeric),' · recovered ',private.specialist_money((tp.v->>'recovered')::numeric),' · outstanding ',private.specialist_money((tp.v->>'outstanding')::numeric)),
        'source_href','/dies/'||ta.die_id,
        'details',jsonb_build_object('agreement_id',ta.id,'family_id',ta.family_id,'agreement_number',ta.agreement_number,'version',ta.version,'die_number',dd.die_number,'die_id',ta.die_id,'die_master_ownership',dd.ownership_type,
          'customer',cu.customer_name,'customer_id',ta.customer_id,'owner_party',ta.owner_party,'die_charge',ta.die_charge,'customer_contribution',ta.customer_contribution,'waiver_amount',ta.waiver_amount,
          'recovery_basis',ta.recovery_basis,'recovery_rate_per_kg',ta.recovery_rate_per_kg,'recovery_cap',ta.recovery_cap,'tax_reference',ta.tax_reference,'terms',ta.terms,'agreement_status',ta.status,
          'disputed',ta.disputed,'dispute_note',ta.dispute_note,'created_by',u.full_name,'created_by_id',ta.created_by,'approved_at',ta.approved_at,'position',tp.v,
          'allocations',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',al.id,'kind',al.kind,'amount',al.amount,'reference',coalesce(iv.invoice_number,pm.reference_number,cn.credit_note_number),
              'counted',private.tooling_counts(p_company,al),'reversed',al.reversed_at is not null,'reverse_note',al.reverse_note,'calc',al.calc,'recorded_at',al.recorded_at) order by al.recorded_at desc),'[]'::jsonb)
            from public.tooling_allocations al left join public.invoices iv on iv.id=al.invoice_id and iv.company_id=al.company_id left join public.payments pm on pm.id=al.payment_id and pm.company_id=al.company_id
              left join public.credit_notes cn on cn.id=al.credit_note_id and cn.company_id=al.company_id where al.company_id=p_company and al.family_id=ta.family_id) end)),
      case st.s when 'disputed' then 0 when 'draft' then 1 when 'active' then case when (tp.v->>'outstanding')::numeric>0 then 3 else 5 end else 9 end,null::date,ta.created_at
    from public.tooling_agreements ta join public.dies dd on dd.id=ta.die_id and dd.company_id=ta.company_id join public.customers cu on cu.id=ta.customer_id and cu.company_id=ta.company_id
      left join public.app_users u on u.id=ta.created_by and u.company_id=ta.company_id cross join lateral (select private.tooling_position(p_company,ta.family_id) v) tp
      cross join lateral (select case when ta.status='active' and ta.disputed then 'disputed' else ta.status end s) st
    where ta.company_id=p_company and (p_id is null or ta.id=p_id) and (p_id is not null or p_state='all' or ta.status in ('draft','active'));

  elsif p_view='transfers' then
    return query select jsonb_build_object('id',tf.id,'label',concat(tf.transfer_number,' · to ',tf.destination),'status',tf.status,'owner',u.full_name,'due_date',tf.planned_date,
        'summary',concat(ln.n,' bundle(s) · ',private.specialist_kg(ln.kg),' · ',ln.transit,' in transit, ',ln.received,' received, ',ln.other,' resolved otherwise',
          case when tf.status in ('in_transit','partially_received') and tf.issued_at<now()-interval '3 days' then ' · in transit for '||extract(day from now()-tf.issued_at)::integer||' day(s)' else '' end),
        'source_href',null,
        'details',jsonb_build_object('transfer_id',tf.id,'transfer_number',tf.transfer_number,'destination',tf.destination,'to_location_id',tf.to_location_id,'planned_date',tf.planned_date,'transfer_status',tf.status,
          'requested_by',u.full_name,'issued_by',iu.full_name,'issued_by_id',tf.issued_by,'issued_at',tf.issued_at,'gate_ref',tf.gate_ref,'transport_ref',tf.transport_ref,'close_note',tf.close_note,
          'counts',jsonb_build_object('bundles',ln.n,'kg',ln.kg,'in_transit',ln.transit,'received',ln.received,'other',ln.other),
          'lines',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'bundle_label',l.bundle_label,'profile_code',pf.profile_code,'pieces',l.pieces,'weight_kg',l.weight_kg,
              'source_location',l.source_location,'state',l.state,'qc_status_at_issue',l.qc_status_at_issue,'batch_status',sb.status,'batch_location',sb.location,'qc_status',sb.qc_status,'resolution_note',l.resolution_note,'resolved_at',l.resolved_at) order by l.bundle_label,l.id),'[]'::jsonb)
            from public.stock_transfer_lines l join public.profile_stock_batches sb on sb.id=l.batch_id and sb.company_id=l.company_id join public.aluminium_profiles pf on pf.id=l.profile_id and pf.company_id=l.company_id
            where l.company_id=p_company and l.transfer_id=tf.id) end)),
      case tf.status when 'in_transit' then 0 when 'partially_received' then 0 when 'requested' then 2 when 'received' then 3 else 9 end,tf.planned_date,tf.requested_at
    from public.stock_transfers tf left join public.app_users u on u.id=tf.requested_by and u.company_id=tf.company_id left join public.app_users iu on iu.id=tf.issued_by and iu.company_id=tf.company_id
      cross join lateral (select count(*) n,coalesce(sum(l.weight_kg),0) kg,count(*) filter (where l.state='in_transit') transit,count(*) filter (where l.state='received') received,
        count(*) filter (where l.state in ('damaged','returned_to_source','lost')) other from public.stock_transfer_lines l where l.company_id=tf.company_id and l.transfer_id=tf.id and l.state<>'cancelled') ln
    where tf.company_id=p_company and (p_id is null or tf.id=p_id) and (p_id is not null or p_state='all' or tf.status in ('requested','in_transit','partially_received','received'));

  elsif p_view='treatment' then
    return query
    select jsonb_build_object('id',tr.id,'label',concat(tr.recipe_code,' rev ',tr.revision,' · ',tr.name),'status',tr.status,'owner',cu.full_name,'due_date',null,
        'summary',concat(replace(tr.process,'_',' '),' · alloys ',array_to_string(tr.alloys,', '),' to ',tr.target_temper,' · ',trim_scale(tr.temp_min_c),' to ',trim_scale(tr.temp_max_c),' °C for ',tr.soak_min_minutes,' to ',tr.soak_max_minutes,' min · at least ',tr.min_readings,' reading(s)'),
        'source_href',null,
        'details',jsonb_build_object('kind','recipe','recipe_id',tr.id,'recipe_code',tr.recipe_code,'revision',tr.revision,'name',tr.name,'process',tr.process,'alloys',to_jsonb(tr.alloys),'target_temper',tr.target_temper,
          'temp_min_c',tr.temp_min_c,'temp_max_c',tr.temp_max_c,'soak_min_minutes',tr.soak_min_minutes,'soak_max_minutes',tr.soak_max_minutes,'min_readings',tr.min_readings,'recipe_status',tr.status,
          'created_by',cu.full_name,'created_by_id',tr.created_by,'approved_by',ap.full_name,'approved_at',tr.approved_at)),
      case tr.status when 'draft' then 1 when 'approved' then 6 else 9 end,null::date,tr.created_at
    from public.treatment_recipes tr left join public.app_users cu on cu.id=tr.created_by and cu.company_id=tr.company_id left join public.app_users ap on ap.id=tr.approved_by and ap.company_id=tr.company_id
    where tr.company_id=p_company and (p_id is null or tr.id=p_id) and (p_id is not null or p_state='all' or tr.status in ('draft','approved'))
    union all
    select jsonb_build_object('id',tb.id,'label',concat(tb.batch_number,' · ',tr.recipe_code,' rev ',tr.revision,' · ',mc.machine_name),'status',tb.status,'owner',u.full_name,'due_date',null,
        'summary',concat(ip.n,' input(s), ',private.specialist_kg(ip.kg),' · ',(ax.v->>'readings'),' of ',(ax.v->>'required_readings'),' reading(s)',
          case when jsonb_array_length(ax.v->'deviations')>0 then ' · '||jsonb_array_length(ax.v->'deviations')||' deviation(s) to review' else '' end,case when tb.retreatment_of is not null then ' · retreatment' else '' end),
        'source_href',null,
        'details',jsonb_build_object('kind','batch','batch_id',tb.id,'batch_number',tb.batch_number,'batch_status',tb.status,'recipe_code',tr.recipe_code,'revision',tr.revision,'recipe_id',tr.id,'recipe_status',tr.status,
          'temp_min_c',tr.temp_min_c,'temp_max_c',tr.temp_max_c,'soak_min_minutes',tr.soak_min_minutes,'soak_max_minutes',tr.soak_max_minutes,'machine',mc.machine_name,'load_note',tb.load_note,
          'loaded_by',u.full_name,'started_at',tb.started_at,'ended_at',tb.ended_at,'review',tb.review,'reviewed_at',tb.reviewed_at,'assessment',ax.v,
          'retreatment_of',(select batch_number from public.treatment_batches where id=tb.retreatment_of and company_id=tb.company_id),
          'inputs',(select coalesce(jsonb_agg(jsonb_build_object('id',ti.id,'job_number',pj.job_number,'order_number',od.order_number,'profile_code',pf.profile_code,'alloy',ti.alloy,'temper',ti.temper,'quantity_kg',ti.quantity_kg,
              'accepted_kg',ti.accepted_kg,'rejected_kg',ti.rejected_kg,'retreat_kg',ti.retreat_kg) order by pj.job_number,ti.id),'[]'::jsonb)
            from public.treatment_inputs ti join public.production_jobs pj on pj.id=ti.production_job_id and pj.company_id=ti.company_id join public.orders od on od.id=pj.order_id and od.company_id=pj.company_id
              join public.aluminium_profiles pf on pf.id=ti.profile_id and pf.company_id=ti.company_id where ti.company_id=p_company and ti.batch_id=tb.id),
          'observations',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('observed_at',o2.observed_at,'temperature_c',o2.temperature_c,'instrument_ref',o2.instrument_ref,'note',o2.note,
              'in_range',o2.temperature_c between tr.temp_min_c and tr.temp_max_c) order by o2.observed_at,o2.id),'[]'::jsonb) from public.treatment_observations o2 where o2.company_id=p_company and o2.batch_id=tb.id) end)),
      case tb.status when 'ended' then 0 when 'interrupted' then 0 when 'running' then 2 when 'loaded' then 3 else 9 end,null::date,tb.created_at
    from public.treatment_batches tb join public.treatment_recipes tr on tr.id=tb.recipe_id and tr.company_id=tb.company_id join public.machines mc on mc.id=tb.machine_id and mc.company_id=tb.company_id
      left join public.app_users u on u.id=tb.loaded_by and u.company_id=tb.company_id
      cross join lateral (select count(*) n,coalesce(sum(ti.quantity_kg),0) kg from public.treatment_inputs ti where ti.company_id=tb.company_id and ti.batch_id=tb.id) ip
      cross join lateral (select private.treatment_assess(p_company,tb.id) v) ax
    where tb.company_id=p_company and (p_id is null or tb.id=p_id) and (p_id is not null or p_state='all' or tb.status in ('loaded','running','ended','interrupted'));

  elsif p_view='tolling' then
    return query
    select jsonb_build_object('id',cu.id,'label',concat('Customer metal · ',cu.customer_name),'status',st.s,'owner',null,'due_date',null,
        'summary',concat('Usable ',private.specialist_kg((tp.v->'totals'->>'usable_kg')::numeric),' · in process ',private.specialist_kg((tp.v->'totals'->>'in_process_kg')::numeric),
          ' · scrap held ',private.specialist_kg((tp.v->'totals'->>'scrap_on_hand_kg')::numeric),' · unexplained ',private.specialist_kg((tp.v->'totals'->>'unexplained_kg')::numeric),
          case when (tp.v->'agreement') is null or jsonb_typeof(tp.v->'agreement')='null' then ' · no approved agreement' else ' · agreement rev '||(tp.v->'agreement'->>'revision') end),
        'source_href','/customers/'||cu.id,
        'details',jsonb_build_object('kind','account','customer_id',cu.id,'customer',cu.customer_name,'position',case when p_id is null then null else tp.v end,'totals',tp.v->'totals',
          'statements',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',ts.id,'statement_number',ts.statement_number,'status',ts.status,'as_of',ts.as_of,'model',ts.model,'settle_note',ts.settle_note) order by ts.as_of desc),'[]'::jsonb)
            from (select * from public.toll_statements s2 where s2.company_id=p_company and s2.customer_id=cu.id order by s2.as_of desc limit 10) ts) end,
          'movements',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'quantity_kg',m.quantity_kg,'receipt_number',tr.receipt_number,'job_number',pj.job_number,
              'reference',m.reference,'note',m.note,'status',m.status,'recorded_at',m.recorded_at,'reverse_note',m.reverse_note) order by m.recorded_at desc),'[]'::jsonb)
            from (select * from public.toll_movements m2 where m2.company_id=p_company and m2.customer_id=cu.id order by m2.recorded_at desc limit 20) m
              left join public.toll_receipts tr on tr.id=m.receipt_id and tr.company_id=m.company_id left join public.production_jobs pj on pj.id=m.production_job_id and pj.company_id=m.company_id) end)),
      case st.s when 'disputed' then 0 when 'unexplained_difference' then 0 when 'pending_inspection' then 1 else 5 end,null::date,coalesce((select max(received_at) from public.toll_receipts tr where tr.company_id=cu.company_id and tr.customer_id=cu.id),now())
    from public.customers cu cross join lateral (select private.toll_position(p_company,cu.id) v) tp
      cross join lateral (select case when exists(select 1 from public.toll_statements ts where ts.company_id=cu.company_id and ts.customer_id=cu.id and ts.status='disputed') then 'disputed'
        when (tp.v->'totals'->>'unexplained_kg')::numeric>0 then 'unexplained_difference' when (tp.v->'totals'->>'received_pending_kg')::numeric>0 then 'pending_inspection' else 'open' end s) st
    where cu.company_id=p_company and (p_id is null or cu.id=p_id)
      and (exists(select 1 from public.toll_agreements ta where ta.company_id=cu.company_id and ta.customer_id=cu.id) or exists(select 1 from public.toll_receipts tr where tr.company_id=cu.company_id and tr.customer_id=cu.id))
      and (p_id is not null or p_state='all' or st.s<>'open' or (tp.v->'totals'->>'usable_kg')::numeric>0 or (tp.v->'totals'->>'in_process_kg')::numeric>0)
    union all
    select jsonb_build_object('id',ta.id,'label',concat('Job-work agreement rev ',ta.revision,' · ',cu.customer_name),'status',ta.status,'owner',u.full_name,'due_date',null,
        'summary',concat(ta.material_spec,' · ',ta.alloy,' · conversion ',private.specialist_money(ta.conversion_rate_per_kg),' per kg of ',replace(ta.billing_basis,'_',' '),
          ' · loss allowance ',coalesce(trim_scale(ta.allowed_loss_percent)||'%','none agreed'),case when ta.permitted_mixing then ' · mixing authorised' else ' · no mixing' end),
        'source_href','/customers/'||ta.customer_id,
        'details',jsonb_build_object('kind','agreement','agreement_id',ta.id,'customer',cu.customer_name,'customer_id',ta.customer_id,'revision',ta.revision,'material_spec',ta.material_spec,'alloy',ta.alloy,
          'permitted_mixing',ta.permitted_mixing,'allowed_loss_percent',ta.allowed_loss_percent,'conversion_rate_per_kg',ta.conversion_rate_per_kg,'billing_basis',ta.billing_basis,'agreement_status',ta.status,
          'created_by',u.full_name,'created_by_id',ta.created_by,'approved_at',ta.approved_at)),
      case ta.status when 'draft' then 1 when 'approved' then 7 else 9 end,null::date,ta.created_at
    from public.toll_agreements ta join public.customers cu on cu.id=ta.customer_id and cu.company_id=ta.company_id left join public.app_users u on u.id=ta.created_by and u.company_id=ta.company_id
    where ta.company_id=p_company and (p_id is null or ta.id=p_id) and (p_id is not null or p_state='all' or ta.status='draft');

  elsif p_view='weighing' then
    return query select jsonb_build_object('id',ws.id,'label',concat(ws.session_number,' · ',ws.vehicle_registration,' · ',case ws.movement_kind when 'dispatch' then 'dispatch '||coalesce(dp.dispatch_number,'') else 'receipt '||coalesce(pr.reference,to_char(pr.receipt_date,'DD Mon')) end),
        'status',st.s,'owner',u.full_name,'due_date',ws.calibration_valid_until,
        'summary',concat(rd.n,' reading(s)',case when ws.net_kg is not null then ' · net '||private.specialist_kg(ws.net_kg) else '' end,
          case when ws.expected_kg is not null then ' · expected '||private.specialist_kg(ws.expected_kg)||' · difference '||private.specialist_kg(ws.difference_kg) when ws.net_kg is not null then ' · nothing to reconcile with' else '' end,
          case when ws.calibration_valid_until<v_today then ' · calibration evidence expired' else '' end),
        'source_href',case when ws.movement_kind='dispatch' then '/dispatches/'||ws.dispatch_id end,
        'details',jsonb_build_object('session_id',ws.id,'session_number',ws.session_number,'vehicle_registration',ws.vehicle_registration,'movement_kind',ws.movement_kind,'dispatch_number',dp.dispatch_number,
          'receipt_reference',pr.reference,'instrument_ref',ws.instrument_ref,'calibration_valid_until',ws.calibration_valid_until,'calibration_valid',ws.calibration_valid_until>=v_today,'tolerance_kg',ws.tolerance_kg,
          'session_status',ws.status,'net_kg',ws.net_kg,'expected_kg',ws.expected_kg,'difference_kg',ws.difference_kg,'pairing',ws.pairing,'accepted_difference',ws.accepted_difference,'closed_note',ws.closed_note,
          'opened_by',u.full_name,'opened_at',ws.opened_at,'finalized_at',ws.finalized_at,'supersedes',(select session_number from public.weighing_sessions where id=ws.supersedes_id and company_id=ws.company_id),
          'superseded_by',(select session_number from public.weighing_sessions where id=ws.superseded_by_id and company_id=ws.company_id),
          'expected',case when p_id is null then null else private.weighing_expected(p_company,ws.movement_kind,ws.dispatch_id,ws.purchase_receipt_id) end,
          'readings',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'weight_value',r.weight_value,'unit',r.unit,'weight_kg',r.weight_kg,'read_at',r.read_at,'source',r.source,
              'provider_ref',r.provider_ref,'slip_ref',r.slip_ref,'stable',r.stable,'paired',r.id in (ws.gross_reading_id,ws.tare_reading_id)) order by r.read_at,r.id),'[]'::jsonb) from public.weighing_readings r where r.company_id=p_company and r.session_id=ws.id) end)),
      case st.s when 'interrupted' then 0 when 'paired' then 1 when 'open' then 2 else 9 end,ws.calibration_valid_until,ws.opened_at
    from public.weighing_sessions ws left join public.dispatches dp on dp.id=ws.dispatch_id and dp.company_id=ws.company_id left join public.purchase_receipts pr on pr.id=ws.purchase_receipt_id and pr.company_id=ws.company_id
      left join public.app_users u on u.id=ws.opened_by and u.company_id=ws.company_id
      cross join lateral (select count(*) n from public.weighing_readings r where r.company_id=ws.company_id and r.session_id=ws.id) rd
      cross join lateral (select case when ws.status='open' and ws.opened_at<now()-interval '24 hours' then 'interrupted' else ws.status end s) st
    where ws.company_id=p_company and (p_id is null or ws.id=p_id) and (p_id is not null or p_state='all' or ws.status in ('open','paired'));
  end if;
end $$;
revoke all on function private.specialist_rows(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Shape checks and lookups.
------------------------------------------------------------------------------------------------
create function private.specialist_spec() returns jsonb language sql immutable set search_path=public,private as $$
  select '{
    "intake.submit":[["customer_id","customer_po_ref","source_text"],["po_date","quote_id"],true],
    "intake.resolve":[["line_id","decision"],["profile_id","quantity","quantity_unit","length_mm","finish","due_date"],false],
    "intake.ready":[["id"],[],false],"intake.link":[["id","order_id"],[],false],"intake.discard":[["id"],[],false],
    "automation.define":[["rule_code","name","trigger_kind","min_days","task_priority","due_in_days"],["min_amount","assign_to"],false],
    "automation.approve":[["id"],[],false],"automation.state":[["id","state"],[],false],"automation.simulate":[["id"],[],true],"automation.execute":[["id"],[],false],
    "lab.request":[["sample_ref","material_kind","lab_vendor_id","tests","promised_date"],["production_job_id","billet_batch_id","material_note","estimated_charge"],false],
    "lab.custody":[["id","stage","reference"],[],false],"lab.revise":[["id","revised_date"],[],false],
    "lab.result":[["id","test_code","statement","lab_outcome","report_ref"],[],true],"lab.review":[["id","decision"],["retest_promised_date"],false],"lab.stop":[["id","outcome"],[],false],
    "shade.define":[["ref_code","shade_name","finish_type","specification","sample_location","assessment_conditions"],["customer_id","project_ref"],false],
    "shade.approve":[["id"],[],false],"shade.withdraw":[["id"],[],false],"shade.bind":[["order_item_id","reference_id"],[],false],
    "shade.decide":[["id","batch_label","decision","assessed_under"],["finishing_job_id"],false],
    "agreement.define":[["customer_id","customer_ref","valid_from","valid_to","overrun_percent","lines"],[],false],"agreement.approve":[["id"],[],false],
    "agreement.rate":[["line_id","rate_per_kg","effective_from"],[],false],"agreement.amend":[["line_id","agreed_kg"],[],false],"agreement.close":[["id","carry_forward"],["new_valid_to"],false],
    "release.create":[["line_id","quantity_kg","site","requested_date"],[],false],"release.firm":[["id"],[],false],"release.cancel":[["id","quantity_kg"],[],false],
    "release.fulfil":[["id","order_id"],[],false],"release.return":[["id","quantity_kg"],[],false],
    "tooling.define":[["die_id","customer_id","owner_party","die_charge","customer_contribution","waiver_amount","recovery_basis","tax_reference","terms"],["recovery_rate_per_kg","recovery_cap"],false],
    "tooling.approve":[["id"],[],false],"tooling.allocate":[["id","kind"],["invoice_id","payment_id","credit_note_id","amount"],false],"tooling.reverse":[["id","allocation_id"],[],false],
    "tooling.dispute":[["id","state"],[],false],
    "transfer.request":[["to_location_id","batch_ids","planned_date"],[],false],"transfer.issue":[["id","transport_ref"],["gate_ref"],false],
    "transfer.receive":[["id","bundle_label"],["condition_note"],true],"transfer.dispose":[["line_id","disposition"],[],false],"transfer.cancel":[["id"],[],false],"transfer.close":[["id"],[],false],
    "recipe.define":[["recipe_code","name","process","alloys","target_temper","temp_min_c","temp_max_c","soak_min_minutes","soak_max_minutes","min_readings"],[],false],
    "recipe.approve":[["id"],[],false],"treat.create":[["recipe_id","machine_id","inputs","load_note"],[],true],"treat.start":[["id"],[],true],
    "treat.observe":[["id","temperature_c","instrument_ref"],["reading_note"],true],"treat.end":[["id","interrupted"],[],false],"treat.review":[["id","outcomes","accept_deviation"],[],false],
    "toll.define":[["customer_id","material_spec","alloy","permitted_mixing","conversion_rate_per_kg","billing_basis"],["allowed_loss_percent"],false],"toll.approve":[["id"],[],false],
    "toll.receive":[["customer_id","received_kg","challan_ref","location"],["heat_ref","alloy"],false],"toll.inspect":[["receipt_id","decision"],[],false],
    "toll.move":[["customer_id","kind","quantity_kg"],["receipt_id","production_job_id","reference"],false],"toll.reverse":[["movement_id"],[],false],
    "toll.statement":[["customer_id"],[],false],"toll.settle":[["statement_id","decision"],[],false],
    "weigh.open":[["movement_kind","vehicle_registration","instrument_ref","calibration_valid_until","tolerance_kg"],["dispatch_id","purchase_receipt_id","vehicle_id"],false],
    "weigh.read":[["id","kind","weight_value","unit","read_at","source","stable","vehicle_registration_read"],["provider_ref","slip_ref"],true],
    "weigh.pair":[["id","gross_reading_id","tare_reading_id"],[],false],"weigh.finalize":[["id","accept_difference"],[],false],"weigh.supersede":[["id"],[],false],"weigh.cancel":[["id"],[],false]
  }'::jsonb
$$;
create function private.specialist_assert_shape(p_mutation jsonb) returns void language plpgsql set search_path=public,private as $$
declare v_a text:=p_mutation->>'action'; v_spec jsonb; v_req text[]; v_opt text[]; v_noteless boolean; v_note text:=btrim(coalesce(p_mutation->>'note',''));
begin
  v_spec:=private.specialist_spec()->v_a;
  if jsonb_typeof(p_mutation) is distinct from 'object' or v_spec is null then raise exception 'NOV: Review the required action details.'; end if;
  select array_agg(value) into v_req from jsonb_array_elements_text(v_spec->0); select coalesce(array_agg(value),'{}') into v_opt from jsonb_array_elements_text(v_spec->1);
  v_noteless:=(v_spec->>2)::boolean;
  if not(p_mutation ?& (v_req||array['action']||case when v_noteless then '{}'::text[] else array['note'] end))
    or exists(select 1 from jsonb_object_keys(p_mutation) k where not(k=any(v_req||v_opt||array['action']||case when v_noteless then '{}'::text[] else array['note'] end)))
    or (not v_noteless and (length(v_note) not between 5 and 500 or v_note ~ '[[:cntrl:]]'))
    or exists(select 1 from jsonb_each(p_mutation) x where jsonb_typeof(x.value)='null') then raise exception 'NOV: Review the required action details.'; end if;
end $$;
revoke all on function private.specialist_spec(),private.specialist_assert_shape(jsonb) from public,anon,authenticated;

create function private.specialist_lookup(p_company uuid,p_actor uuid,p_role text,p_payload jsonb) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare k text:=p_payload->>'kind'; s text:=lower(btrim(coalesce(p_payload->>'search',''))); v_sel uuid; v_par uuid; v_res jsonb; v_ok boolean;
begin
  if p_payload ? 'selected_id' then v_sel:=private.specialist_uuid(p_payload,'selected_id'); end if;
  if p_payload ? 'parent_id' then v_par:=private.specialist_uuid(p_payload,'parent_id'); end if;
  v_ok:=case k
    when 'employees' then true
    when 'customers' then private.specialist_read_allowed(p_role,'intake') or private.specialist_read_allowed(p_role,'agreements') or private.specialist_read_allowed(p_role,'tooling') or private.specialist_read_allowed(p_role,'tolling') or private.specialist_read_allowed(p_role,'shades')
    when 'quotes' then private.specialist_read_allowed(p_role,'intake')
    when 'orders' then private.specialist_read_allowed(p_role,'intake') or private.specialist_read_allowed(p_role,'agreements')
    when 'profiles' then private.specialist_read_allowed(p_role,'intake') or private.specialist_read_allowed(p_role,'agreements')
    when 'vendors' then private.specialist_read_allowed(p_role,'lab')
    when 'jobs' then private.specialist_read_allowed(p_role,'lab') or private.specialist_read_allowed(p_role,'treatment') or private.specialist_read_allowed(p_role,'tolling')
    when 'billets' then private.specialist_read_allowed(p_role,'lab')
    when 'order_items' then private.specialist_read_allowed(p_role,'shades')
    when 'shade_refs' then private.specialist_read_allowed(p_role,'shades')
    when 'finishing_jobs' then private.specialist_read_allowed(p_role,'shades')
    when 'dies' then private.specialist_read_allowed(p_role,'tooling')
    when 'invoices' then private.specialist_read_allowed(p_role,'tooling')
    when 'payments' then private.specialist_read_allowed(p_role,'tooling')
    when 'credit_notes' then private.specialist_read_allowed(p_role,'tooling')
    when 'stock_batches' then private.specialist_read_allowed(p_role,'transfers')
    when 'locations' then private.specialist_read_allowed(p_role,'transfers')
    when 'ovens' then private.specialist_read_allowed(p_role,'treatment')
    when 'recipes' then private.specialist_read_allowed(p_role,'treatment')
    when 'toll_receipts' then private.specialist_read_allowed(p_role,'tolling')
    when 'dispatches' then private.specialist_read_allowed(p_role,'weighing')
    when 'receipts' then private.specialist_read_allowed(p_role,'weighing')
    when 'vehicles' then private.specialist_read_allowed(p_role,'weighing')
    else false end;
  if k is null or not coalesce(v_ok,false) then raise exception 'Not permitted' using errcode='42501'; end if;
  if k='employees' then
    select coalesce(jsonb_agg(jsonb_build_object('value',u.id,'label',coalesce(nullif(u.full_name,''),u.email),'context',replace(u.role,'_',' ')) order by u.full_name,u.id),'[]'::jsonb) into v_res from (
      select * from public.app_users u where u.company_id=p_company and u.is_active and u.dealer_id is null and u.role not in ('viewer','dealer_admin','dealer_staff')
        and (v_sel is null or u.id=v_sel) and (s='' or position(s in lower(coalesce(u.full_name,'')||' '||coalesce(u.email,'')||' '||u.role))>0) order by u.full_name,u.id limit 20) u;
  elsif k='customers' then
    select coalesce(jsonb_agg(jsonb_build_object('value',c.id,'label',c.customer_name,'context',coalesce(nullif(c.city,''),c.customer_type)) order by c.customer_name,c.id),'[]'::jsonb) into v_res from (
      select * from public.customers c where c.company_id=p_company and c.deleted_at is null and c.is_active and (v_sel is null or c.id=v_sel) and (s='' or position(s in lower(c.customer_name))>0) order by c.customer_name,c.id limit 20) c;
  elsif k='quotes' then
    select coalesce(jsonb_agg(jsonb_build_object('value',q.id,'label',q.quote_number,'context',concat(replace(q.status,'_',' '),' · revision ',q.revision_number)) order by q.quote_date desc,q.id),'[]'::jsonb) into v_res from (
      select * from public.quotes q where q.company_id=p_company and q.deleted_at is null and q.dealer_id is null and q.status in ('sent','customer_approved','converted_to_order')
        and (v_sel is null or q.id=v_sel) and (v_par is null or q.customer_id=v_par) and (s='' or position(s in lower(q.quote_number))>0) order by q.quote_date desc,q.id limit 20) q;
  elsif k='orders' then
    select coalesce(jsonb_agg(jsonb_build_object('value',o.id,'label',o.order_number,'context',concat(replace(o.current_stage,'_',' '),' · ',to_char(o.order_date,'DD Mon YYYY'))) order by o.created_at desc,o.id),'[]'::jsonb) into v_res from (
      select * from public.orders o where o.company_id=p_company and o.deleted_at is null and o.current_stage<>'cancelled' and (v_sel is null or o.id=v_sel)
        and (v_par is null or o.customer_id=v_par or o.customer_id=(select customer_id from public.blanket_releases r join public.blanket_agreements a on a.id=r.agreement_id where r.id=v_par and r.company_id=p_company)
          or o.customer_id=(select customer_id from public.po_intakes where id=v_par and company_id=p_company))
        and (s='' or position(s in lower(o.order_number))>0) order by o.created_at desc,o.id limit 20) o;
  elsif k='profiles' then
    select coalesce(jsonb_agg(jsonb_build_object('value',f.id,'label',f.profile_code,'context',concat(f.profile_name,' · ',coalesce(f.alloy,'alloy not set'),' ',coalesce(f.temper,''))) order by f.profile_code,f.id),'[]'::jsonb) into v_res from (
      select * from public.aluminium_profiles f where f.company_id=p_company and f.deleted_at is null and f.is_active and (v_sel is null or f.id=v_sel) and (s='' or position(s in lower(f.profile_code||' '||f.profile_name))>0) order by f.profile_code,f.id limit 20) f;
  elsif k='vendors' then
    select coalesce(jsonb_agg(jsonb_build_object('value',v.id,'label',v.vendor_name,'context',replace(v.vendor_type,'_',' ')) order by v.vendor_name,v.id),'[]'::jsonb) into v_res from (
      select * from public.vendors v where v.company_id=p_company and (v_sel is null or v.id=v_sel) and (s='' or position(s in lower(v.vendor_name))>0) order by v.vendor_name,v.id limit 20) v;
  elsif k='jobs' then
    select coalesce(jsonb_agg(jsonb_build_object('value',j.id,'label',coalesce(j.job_number,'Production job'),'context',concat(j.order_number,' · ',replace(j.status,'_',' '),' · ',trim_scale(j.actual_quantity_kg),' kg recorded')) order by j.planned_date nulls last,j.id),'[]'::jsonb) into v_res from (
      select j.*,o.order_number from public.production_jobs j join public.orders o on o.id=j.order_id and o.company_id=j.company_id where j.company_id=p_company and (v_sel is null or j.id=v_sel)
        and (v_sel is not null or j.status in ('in_progress','completed')) and (v_par is null or o.customer_id=v_par) and (s='' or position(s in lower(coalesce(j.job_number,'')||' '||o.order_number))>0)
        order by j.planned_date nulls last,j.id limit 20) j;
  elsif k='billets' then
    select coalesce(jsonb_agg(jsonb_build_object('value',b.id,'label',b.batch_number,'context',concat(b.alloy,' ',b.temper,coalesce(' · heat '||b.heat_number,''))) order by b.received_date desc,b.id),'[]'::jsonb) into v_res from (
      select * from public.billet_batches b where b.company_id=p_company and (v_sel is null or b.id=v_sel) and (s='' or position(s in lower(b.batch_number||' '||coalesce(b.heat_number,'')))>0) order by b.received_date desc,b.id limit 20) b;
  elsif k='order_items' then
    select coalesce(jsonb_agg(jsonb_build_object('value',x.id,'label',concat(x.order_number,' · ',coalesce(x.item_description,'line')),'context',concat(coalesce(replace(x.finishing_type,'_',' '),'finish not set'),' · ',x.customer_name)) order by x.order_number,x.id),'[]'::jsonb) into v_res from (
      select oi.id,o.order_number,oi.item_description,oi.finishing_type,c.customer_name from public.order_items oi join public.orders o on o.id=oi.order_id and o.company_id=oi.company_id join public.customers c on c.id=o.customer_id and c.company_id=o.company_id
      where oi.company_id=p_company and o.deleted_at is null and o.current_stage not in ('cancelled','closed','delivered') and (v_sel is null or oi.id=v_sel) and (s='' or position(s in lower(o.order_number||' '||coalesce(oi.item_description,'')))>0)
      order by o.order_number,oi.id limit 20) x;
  elsif k='shade_refs' then
    select coalesce(jsonb_agg(jsonb_build_object('value',r.id,'label',concat(r.ref_code,' rev ',r.revision,' · ',r.shade_name),'context',concat(replace(r.finish_type,'_',' '),' · ',coalesce(r.customer_name,'any customer'))) order by r.ref_code,r.id),'[]'::jsonb) into v_res from (
      select sr.*,c.customer_name from public.shade_references sr left join public.customers c on c.id=sr.customer_id and c.company_id=sr.company_id where sr.company_id=p_company and sr.status='approved' and (v_sel is null or sr.id=v_sel)
        and (v_par is null or sr.customer_id is null or sr.customer_id=(select o.customer_id from public.order_items oi join public.orders o on o.id=oi.order_id and o.company_id=oi.company_id where oi.id=v_par and oi.company_id=p_company))
        and (s='' or position(s in lower(sr.ref_code||' '||sr.shade_name))>0) order by sr.ref_code,sr.id limit 20) r;
  elsif k='finishing_jobs' then
    select coalesce(jsonb_agg(jsonb_build_object('value',f.id,'label',concat('Finishing ',replace(f.finishing_type,'_',' '),coalesce(' · '||f.shade_name,'')),'context',concat(replace(f.status,'_',' '),coalesce(' · sent '||to_char(f.sent_date,'DD Mon'),''))) order by f.sent_date nulls last,f.id),'[]'::jsonb) into v_res from (
      select * from public.finishing_jobs f where f.company_id=p_company and (v_sel is null or f.id=v_sel)
        and (v_par is null or f.order_id=(select oi.order_id from public.shade_bindings b join public.order_items oi on oi.id=b.order_item_id and oi.company_id=b.company_id where b.id=v_par and b.company_id=p_company))
      order by f.sent_date nulls last,f.id limit 20) f;
  elsif k='dies' then
    select coalesce(jsonb_agg(jsonb_build_object('value',d.id,'label',d.die_number,'context',concat(replace(d.ownership_type,'_',' '),' · ',replace(d.die_status,'_',' '),case when ta.n>0 then ' · tooling agreement active' else '' end)) order by d.die_number,d.id),'[]'::jsonb) into v_res from (
      select * from public.dies d where d.company_id=p_company and d.deleted_at is null and (v_sel is null or d.id=v_sel) and (s='' or position(s in lower(d.die_number))>0) order by d.die_number,d.id limit 20) d
      cross join lateral (select count(*) n from public.tooling_agreements t where t.company_id=d.company_id and t.die_id=d.id and t.status='active') ta;
  elsif k='invoices' then
    select coalesce(jsonb_agg(jsonb_build_object('value',i.id,'label',coalesce(i.invoice_number,'Invoice'),'context',concat(to_char(i.invoice_date,'DD Mon YYYY'),' · ',replace(i.status,'_',' '),' · taxable ',private.specialist_money(i.subtotal))) order by i.invoice_date desc,i.id),'[]'::jsonb) into v_res from (
      select * from public.invoices i where i.company_id=p_company and i.deleted_at is null and i.status not in ('draft','cancelled') and (v_sel is null or i.id=v_sel)
        and (v_par is null or i.customer_id=(select customer_id from public.tooling_agreements where id=v_par and company_id=p_company)) and (s='' or position(s in lower(coalesce(i.invoice_number,'')))>0)
      order by i.invoice_date desc,i.id limit 20) i;
  elsif k='payments' then
    select coalesce(jsonb_agg(jsonb_build_object('value',p.id,'label',concat(private.specialist_money(p.amount),' · ',coalesce(p.reference_number,'no reference')),'context',concat(to_char(p.payment_date,'DD Mon YYYY'),' · invoice ',p.invoice_number)) order by p.payment_date desc,p.id),'[]'::jsonb) into v_res from (
      select pm.*,iv.invoice_number from public.payments pm join public.invoices iv on iv.id=pm.invoice_id and iv.company_id=pm.company_id where pm.company_id=p_company and pm.reversed_at is null and (v_sel is null or pm.id=v_sel)
        and (v_par is null or pm.invoice_id in (select al.invoice_id from public.tooling_allocations al join public.tooling_agreements ta on ta.family_id=al.family_id and ta.company_id=al.company_id
          where ta.id=v_par and al.company_id=p_company and al.kind='charge_invoice' and al.reversed_at is null)) order by pm.payment_date desc,pm.id limit 20) p;
  elsif k='credit_notes' then
    select coalesce(jsonb_agg(jsonb_build_object('value',c.id,'label',c.credit_note_number,'context',concat(to_char(c.credit_date,'DD Mon YYYY'),' · taxable ',private.specialist_money(c.subtotal))) order by c.credit_date desc,c.id),'[]'::jsonb) into v_res from (
      select * from public.credit_notes cn where cn.company_id=p_company and cn.status='issued' and (v_sel is null or cn.id=v_sel)
        and (v_par is null or cn.invoice_id in (select al.invoice_id from public.tooling_allocations al join public.tooling_agreements ta on ta.family_id=al.family_id and ta.company_id=al.company_id
          where ta.id=v_par and al.company_id=p_company and al.kind='charge_invoice' and al.reversed_at is null)) order by cn.credit_date desc,cn.id limit 20) c;
  elsif k='stock_batches' then
    select coalesce(jsonb_agg(jsonb_build_object('value',b.id,'label',concat(coalesce(b.bundle_number,'Bundle'),' · ',b.profile_code),'context',concat(b.quantity_pieces,' pcs · ',trim_scale(b.total_weight_kg),' kg · ',coalesce(b.location,'no location'),' · QC ',replace(b.qc_status,'_',' '))) order by b.bundle_number,b.id),'[]'::jsonb) into v_res from (
      select sb.*,pf.profile_code from public.profile_stock_batches sb join public.aluminium_profiles pf on pf.id=sb.profile_id and pf.company_id=sb.company_id
      where sb.company_id=p_company and sb.dealer_id is null and (v_sel is not null or sb.status='available') and (v_sel is null or sb.id=v_sel)
        and (s='' or position(s in lower(coalesce(sb.bundle_number,'')||' '||pf.profile_code||' '||coalesce(sb.location,'')))>0) order by sb.bundle_number,sb.id limit 20) b;
  elsif k='locations' then
    select coalesce(jsonb_agg(jsonb_build_object('value',l.id,'label',l.location_name,'context',concat(l.location_code,' · ',replace(l.location_type,'_',' '))) order by l.location_name,l.id),'[]'::jsonb) into v_res from (
      select * from public.inventory_locations l where l.company_id=p_company and l.dealer_id is null and l.is_active and l.location_type in ('factory','warehouse','branch') and (v_sel is null or l.id=v_sel)
        and (s='' or position(s in lower(l.location_name||' '||l.location_code))>0) order by l.location_name,l.id limit 20) l;
  elsif k='ovens' then
    select coalesce(jsonb_agg(jsonb_build_object('value',m.id,'label',m.machine_name,'context',concat(coalesce(m.machine_code,'oven'),' · ',m.status)) order by m.machine_name,m.id),'[]'::jsonb) into v_res from (
      select * from public.machines m where m.company_id=p_company and m.machine_type='aging_oven' and m.is_active and (v_sel is null or m.id=v_sel) and (s='' or position(s in lower(m.machine_name))>0) order by m.machine_name,m.id limit 20) m;
  elsif k='recipes' then
    select coalesce(jsonb_agg(jsonb_build_object('value',r.id,'label',concat(r.recipe_code,' rev ',r.revision),'context',concat(r.name,' · ',array_to_string(r.alloys,', '))) order by r.recipe_code,r.id),'[]'::jsonb) into v_res from (
      select * from public.treatment_recipes r where r.company_id=p_company and r.status='approved' and (v_sel is null or r.id=v_sel) and (s='' or position(s in lower(r.recipe_code||' '||r.name))>0) order by r.recipe_code,r.id limit 20) r;
  elsif k='toll_receipts' then
    select coalesce(jsonb_agg(jsonb_build_object('value',t.id,'label',concat(t.receipt_number,' · challan ',t.challan_ref),'context',concat(trim_scale(t.received_kg),' kg · ',t.quality_status)) order by t.received_at,t.id),'[]'::jsonb) into v_res from (
      select * from public.toll_receipts t where t.company_id=p_company and (v_sel is null or t.id=v_sel) and (v_par is null or t.customer_id=v_par) and (s='' or position(s in lower(t.receipt_number||' '||t.challan_ref))>0) order by t.received_at,t.id limit 20) t;
  elsif k='dispatches' then
    select coalesce(jsonb_agg(jsonb_build_object('value',d.id,'label',coalesce(d.dispatch_number,'Dispatch'),'context',concat(d.order_number,' · ',replace(d.delivery_status,'_',' '),coalesce(' · '||d.vehicle_number,''))) order by d.dispatch_date desc nulls last,d.id),'[]'::jsonb) into v_res from (
      select dp.*,o.order_number from public.dispatches dp join public.orders o on o.id=dp.order_id and o.company_id=dp.company_id where dp.company_id=p_company and (v_sel is null or dp.id=v_sel)
        and (s='' or position(s in lower(coalesce(dp.dispatch_number,'')||' '||o.order_number||' '||coalesce(dp.vehicle_number,'')))>0) order by dp.dispatch_date desc nulls last,dp.id limit 20) d;
  elsif k='receipts' then
    select coalesce(jsonb_agg(jsonb_build_object('value',r.id,'label',concat('Receipt ',to_char(r.receipt_date,'DD Mon YYYY'),coalesce(' · '||r.reference,'')),'context',r.po_number) order by r.receipt_date desc,r.id),'[]'::jsonb) into v_res from (
      select pr.*,po.po_number from public.purchase_receipts pr join public.purchase_orders po on po.id=pr.purchase_order_id and po.company_id=pr.company_id where pr.company_id=p_company and (v_sel is null or pr.id=v_sel)
        and (s='' or position(s in lower(coalesce(pr.reference,'')||' '||po.po_number))>0) order by pr.receipt_date desc,pr.id limit 20) r;
  else
    select coalesce(jsonb_agg(jsonb_build_object('value',v.id,'label',v.registration_number,'context',concat(v.vehicle_label,' · ',trim_scale(v.capacity_kg),' kg')) order by v.registration_number,v.id),'[]'::jsonb) into v_res from (
      select * from public.factory_vehicles v where v.company_id=p_company and v.is_active and (v_sel is null or v.id=v_sel) and (s='' or position(s in lower(v.registration_number||' '||v.vehicle_label))>0) order by v.registration_number,v.id limit 20) v;
  end if;
  return v_res;
end $$;
revoke all on function private.specialist_lookup(uuid,uuid,text,jsonb) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Context: validates an action against current sources and produces the server-generated review.
-- {source} feeds the fingerprint; {data} is passed to apply after the same checks under row locks.
------------------------------------------------------------------------------------------------
create function private.specialist_ctx_intake(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_a text:=p_m->>'action'; v_in public.po_intakes; v_line public.po_intake_lines; v_cust public.customers; v_q public.quotes; v_od public.orders; v_pf public.aluminium_profiles;
  v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb; v_title text; v_effect text; v_src jsonb:='{}'::jsonb; v_data jsonb:='{}'::jsonb; v_text text; v_sum text; v_lines jsonb; v_dup text;
  v_prior_id uuid; v_prior_no text; v_prior_status text; v_prior_order text; v_n integer; v_ok integer; v_unres integer; v_diff jsonb; v_qty numeric; v_unit text; v_len integer; v_due date; v_fin text; v_cmp jsonb;
begin
  if v_a='intake.submit' then
    select * into v_cust from public.customers where id=private.specialist_uuid(p_m,'customer_id') and company_id=p_company and deleted_at is null and is_active;
    if v_cust.id is null then raise exception 'NOV: Choose an active customer of this company.'; end if;
    perform private.assurance_text(p_m,'customer_po_ref',1,60);
    if jsonb_typeof(p_m->'source_text') is distinct from 'string' then raise exception 'NOV: Paste the purchase order text.'; end if;
    v_text:=replace(p_m->>'source_text',E'\r\n',E'\n');
    if length(btrim(v_text)) not between 10 and 20000 then raise exception 'NOV: Paste the purchase order text (10 to 20,000 characters).'; end if;
    if v_text ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception 'NOV: Remove control characters from the pasted text.'; end if;
    v_sum:=encode(sha256(convert_to(v_text,'UTF8')),'hex');
    select intake_number into v_dup from public.po_intakes where company_id=p_company and source_checksum=v_sum and status in ('review','ready','linked');
    if v_dup is not null then raise exception 'NOV: This exact document was already submitted as %. Open that intake instead of submitting it again.',v_dup; end if;
    if p_m ? 'po_date' then perform private.assurance_date(p_m,'po_date'); end if;
    if p_m ? 'quote_id' then
      select * into v_q from public.quotes where id=private.specialist_uuid(p_m,'quote_id') and company_id=p_company and deleted_at is null and dealer_id is null;
      if v_q.id is null or v_q.customer_id<>v_cust.id then raise exception 'NOV: Choose a quotation of this customer.'; end if;
      if v_q.status not in ('sent','customer_approved','converted_to_order') then raise exception 'NOV: Compare only with a quotation that was sent or accepted; this one is %.',replace(v_q.status,'_',' '); end if;
    end if;
    v_lines:=private.intake_extract(p_company,v_cust.id,v_text);
    select count(*) filter (where e->>'state'<>'not_a_line'),count(*) filter (where e->>'state'='matched'),count(*) filter (where e->>'state'='unresolved') into v_n,v_ok,v_unres from jsonb_array_elements(v_lines) t(e);
    if v_n=0 then raise exception 'NOV: No order line with a quantity or a known profile was found. Check that the pasted text is the purchase order.'; end if;
    select id,intake_number,status,(select order_number from public.orders where id=pk.order_id and company_id=p_company) into v_prior_id,v_prior_no,v_prior_status,v_prior_order from public.po_intakes pk
      where pk.company_id=p_company and pk.customer_id=v_cust.id and lower(pk.customer_po_ref)=lower(btrim(p_m->>'customer_po_ref')) and pk.status in ('review','ready','linked') order by pk.created_at desc limit 1;
    if v_prior_status='linked' then v_warn:=v_warn||jsonb_build_array(format('This amends purchase order %s, already entered as order %s through %s. The order is not changed: revise it through the order workflow.',btrim(p_m->>'customer_po_ref'),v_prior_order,v_prior_no));
    elsif v_prior_id is not null then v_warn:=v_warn||jsonb_build_array(format('This replaces %s for the same purchase order. That intake will be marked superseded and kept.',v_prior_no)); end if;
    if v_unres>0 then v_warn:=v_warn||jsonb_build_array(format('%s line(s) need a person to resolve before the draft is ready.',v_unres)); end if;
    v_warn:=v_warn||jsonb_build_array('Values are proposed from the text only where it states them plainly. Nothing is ordered or confirmed to the customer.');
    v_title:='Submit the purchase order for review'; v_effect:='Keeps the pasted document with its checksum and proposes order lines with the source line for each value.';
    v_facts:=jsonb_build_object('Customer',v_cust.customer_name,'Customer purchase order',btrim(p_m->>'customer_po_ref'),'Order lines found',v_n,'Proposed from the text',v_ok,'To resolve',v_unres,
      'Other lines kept as evidence',jsonb_array_length(v_lines)-v_n,'Compared with',coalesce(v_q.quote_number,'No quotation'),'Checksum',left(v_sum,16));
    v_src:=jsonb_build_object('lines',md5(v_lines::text),'prior',v_prior_id,'prior_status',v_prior_status,'quote',v_q.status);
    v_data:=jsonb_build_object('lines',v_lines,'checksum',v_sum,'text',v_text,'prior_id',v_prior_id,'prior_status',v_prior_status);
  elsif v_a='intake.resolve' then
    if p_lock then perform 1 from public.po_intake_lines where id=private.specialist_uuid(p_m,'line_id') and company_id=p_company for update; end if;
    select * into v_line from public.po_intake_lines where id=private.specialist_uuid(p_m,'line_id') and company_id=p_company;
    if v_line.id is null then raise exception 'NOV: The line is unavailable.'; end if;
    select * into v_in from public.po_intakes where id=v_line.intake_id and company_id=p_company;
    if v_in.status<>'review' then raise exception 'NOV: Only an intake in review can be changed; this one is %.',v_in.status; end if;
    v_facts:=jsonb_build_object('Source line',v_line.source_line,'Text',v_line.raw_text);
    if private.specialist_choice(p_m,'decision',array['line','not_a_line'])='not_a_line' then
      if p_m ?| array['profile_id','quantity','quantity_unit','length_mm','finish','due_date'] then raise exception 'NOV: A line that is not an order line has no values.'; end if;
      v_title:='Mark the line as not an order line'; v_effect:='Keeps the text as evidence and leaves it out of the draft.'; v_data:=jsonb_build_object('state','not_a_line');
    else
      select * into v_pf from public.aluminium_profiles where id=coalesce(case when p_m ? 'profile_id' then private.specialist_uuid(p_m,'profile_id') end,v_line.profile_id) and company_id=p_company and deleted_at is null and is_active;
      if v_pf.id is null then raise exception 'NOV: Choose the profile for this line.'; end if;
      v_qty:=case when p_m ? 'quantity' then private.assurance_number(p_m,'quantity',0.001,100000000,3) else v_line.quantity end;
      v_unit:=case when p_m ? 'quantity_unit' then private.specialist_choice(p_m,'quantity_unit',array['kg','piece','metre']) else v_line.quantity_unit end;
      if v_qty is null or v_unit is null then raise exception 'NOV: Enter the quantity and its unit; the source line does not state them clearly.'; end if;
      v_len:=case when p_m ? 'length_mm' then private.assurance_number(p_m,'length_mm',100,12000,0)::integer else v_line.length_mm end;
      v_fin:=case when p_m ? 'finish' then private.assurance_text(p_m,'finish',2,40) else v_line.finish end;
      v_due:=case when p_m ? 'due_date' then private.assurance_date(p_m,'due_date') else v_line.due_date end;
      if v_line.quantity is not null and v_line.quantity<>v_qty then v_warn:=v_warn||jsonb_build_array(format('You changed the quantity from %s to %s. The source line is kept as written.',trim_scale(v_line.quantity),trim_scale(v_qty))); end if;
      if v_line.profile_id is not null and v_line.profile_id<>v_pf.id then v_warn:=v_warn||jsonb_build_array('You chose a different profile from the one the text matched.'); end if;
      v_title:='Resolve the order line'; v_effect:='Records the values a person confirmed for this line. The extraction and the source text are kept.';
      v_facts:=v_facts||jsonb_build_object('Profile',v_pf.profile_code,'Quantity',trim_scale(v_qty)||' '||v_unit,'Length',coalesce(v_len||' mm','not stated'),'Finish',coalesce(v_fin,'not stated'),'Date',coalesce(to_char(v_due,'DD Mon YYYY'),'not stated'));
      v_data:=jsonb_build_object('state','resolved','profile_id',v_pf.id,'qty',v_qty,'unit',v_unit,'len',v_len,'finish',v_fin,'due',v_due);
    end if;
    v_src:=jsonb_build_object('state',v_line.state,'intake',v_in.status,'qty',v_line.quantity,'profile',v_line.profile_id);
  else
    if p_lock then perform 1 from public.po_intakes where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_in from public.po_intakes where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_in.id is null then raise exception 'NOV: The intake is unavailable.'; end if;
    select count(*) filter (where state in ('matched','resolved')),count(*) filter (where state='unresolved') into v_ok,v_unres from public.po_intake_lines where company_id=p_company and intake_id=v_in.id;
    v_facts:=jsonb_build_object('Intake',v_in.intake_number,'Customer purchase order',v_in.customer_po_ref,'Reviewed lines',v_ok,'Lines to resolve',v_unres);
    v_src:=jsonb_build_object('status',v_in.status,'ok',v_ok,'unres',v_unres);
    if v_a='intake.ready' then
      if v_in.status<>'review' then raise exception 'NOV: Only an intake in review can be marked ready.'; end if;
      if v_unres>0 then raise exception 'NOV: % line(s) still need to be resolved or marked as not an order line.',v_unres; end if;
      if v_ok=0 then raise exception 'NOV: The draft has no order line.'; end if;
      v_cmp:=private.intake_compare(p_company,v_in.id);
      select coalesce(jsonb_agg(format('Line %s (%s): %s',e->>'seq',e->>'profile_code',d)),'[]'::jsonb) into v_diff from jsonb_array_elements(v_cmp->'lines') t(e),jsonb_array_elements_text(e->'differences') u(d);
      v_warn:=v_warn||v_diff;
      if v_cmp->>'quoted_not_ordered' is not null then v_warn:=v_warn||jsonb_build_array('Quoted but not in the purchase order: '||(v_cmp->>'quoted_not_ordered')); end if;
      v_warn:=v_warn||jsonb_build_array('Ready means reviewed for order entry. It is not an order and makes no commitment to the customer.');
      v_title:='Mark the draft ready for order entry'; v_effect:='Freezes the reviewed lines so the order can be entered through the normal order form.';
      v_src:=v_src||jsonb_build_object('cmp',md5(v_cmp::text));
    elsif v_a='intake.link' then
      if v_in.status<>'ready' then raise exception 'NOV: Link an order only to a draft marked ready.'; end if;
      select * into v_od from public.orders where id=private.specialist_uuid(p_m,'order_id') and company_id=p_company and deleted_at is null;
      if v_od.id is null or v_od.customer_id<>v_in.customer_id then raise exception 'NOV: Choose an order of the same customer.'; end if;
      if v_od.current_stage='cancelled' then raise exception 'NOV: The order is cancelled.'; end if;
      select intake_number into v_dup from public.po_intakes where company_id=p_company and order_id=v_od.id and status='linked';
      if v_dup is not null then raise exception 'NOV: Order % is already linked to %.',v_od.order_number,v_dup; end if;
      v_diff:=private.intake_order_diff(p_company,v_in.id,v_od.id);
      v_warn:=v_warn||v_diff;
      if jsonb_array_length(v_diff)=0 then v_warn:=v_warn||jsonb_build_array('The order lines agree with the reviewed draft.'); end if;
      v_title:='Link the order entered from this draft'; v_effect:='Records which order this purchase order became. Differences are kept with the intake.';
      v_facts:=v_facts||jsonb_build_object('Order',v_od.order_number,'Order stage',replace(v_od.current_stage,'_',' '),'Differences',jsonb_array_length(v_diff));
      v_src:=v_src||jsonb_build_object('order',v_od.id,'diff',md5(v_diff::text)); v_data:=jsonb_build_object('order_id',v_od.id,'diff',v_diff);
    else
      if v_in.status not in ('review','ready') then raise exception 'NOV: A % intake cannot be discarded.',v_in.status; end if;
      v_title:='Discard the intake'; v_effect:='Closes the intake without an order. The document and its lines are kept.';
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.specialist_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.specialist_ctx_automation(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_a text:=p_m->>'action'; v_rule public.automation_rule_versions; v_user public.app_users; v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb; v_title text; v_effect text; v_src jsonb:='{}'::jsonb;
  v_data jsonb:='{}'::jsonb; v_cands jsonb; v_new integer; v_done integer; v_state text; v_assignee_active boolean;
begin
  if v_a='automation.define' then
    if (p_m->>'rule_code') !~ '^[a-z0-9_]{3,30}$' then raise exception 'NOV: Use 3 to 30 lowercase letters, digits or underscores for the rule code.'; end if;
    if exists(select 1 from public.automation_rule_versions where company_id=p_company and rule_code=p_m->>'rule_code' and status='draft') then raise exception 'NOV: A draft of this rule is already waiting for approval.'; end if;
    v_rule.company_id:=p_company; v_rule.rule_code:=p_m->>'rule_code'; v_rule.name:=private.assurance_text(p_m,'name',3,80);
    v_rule.trigger_kind:=private.specialist_choice(p_m,'trigger_kind',array['invoice_overdue','dispatch_overdue','quote_expiring']);
    v_rule.min_days:=private.assurance_number(p_m,'min_days',0,365,0)::integer;
    if p_m ? 'min_amount' then
      if v_rule.trigger_kind<>'invoice_overdue' then raise exception 'NOV: Only the overdue invoice trigger has a minimum amount.'; end if;
      v_rule.min_amount:=private.assurance_number(p_m,'min_amount',0,1000000000,2);
    end if;
    v_rule.task_priority:=private.specialist_choice(p_m,'task_priority',array['low','normal','high','urgent']); v_rule.due_in_days:=private.assurance_number(p_m,'due_in_days',0,30,0)::integer;
    if p_m ? 'assign_to' then v_user:=private.specialist_member(p_company,private.specialist_uuid(p_m,'assign_to')); v_rule.assign_to:=v_user.id; end if;
    v_cands:=private.automation_candidates(p_company,v_rule);
    v_title:='Define an automation rule'; v_effect:='Creates a draft rule version. It cannot run until a second person approves it.';
    v_warn:=v_warn||jsonb_build_array('The only action available is creating an internal task. Nothing is sent to customers or suppliers.',
      format('If it were approved today, %s record(s) would qualify. Tasks are created only when someone runs the approved rule.',jsonb_array_length(v_cands)));
    v_facts:=jsonb_build_object('Rule',v_rule.rule_code,'Name',v_rule.name,'Trigger',replace(v_rule.trigger_kind,'_',' '),'Days',v_rule.min_days,'Minimum amount',coalesce(private.specialist_money(v_rule.min_amount),'none'),
      'Task priority',v_rule.task_priority,'Assigned to',coalesce(v_user.full_name,'Unassigned'),'Due in days',v_rule.due_in_days);
    v_data:=jsonb_build_object('assign_to',v_rule.assign_to,'min_amount',v_rule.min_amount);
    v_src:=jsonb_build_object('n',jsonb_array_length(v_cands));
  else
    if p_lock then perform 1 from public.automation_rule_versions where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_rule from public.automation_rule_versions where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_rule.id is null then raise exception 'NOV: The rule is unavailable.'; end if;
    select coalesce(bool_and(is_active),true) into v_assignee_active from public.app_users where id=v_rule.assign_to and company_id=p_company;
    v_src:=jsonb_build_object('status',v_rule.status,'version',v_rule.version,'assignee',v_assignee_active);
    v_facts:=jsonb_build_object('Rule',v_rule.rule_code||' v'||v_rule.version,'Status',v_rule.status);
    if v_a='automation.approve' then
      if v_rule.status<>'draft' then raise exception 'NOV: Only a draft rule is approved.'; end if;
      if v_rule.created_by=p_actor then raise exception 'NOV: The person who defined the rule cannot approve it.'; end if;
      if exists(select 1 from public.automation_rule_versions where company_id=p_company and rule_code=v_rule.rule_code and status in ('approved','paused')) then
        v_warn:=v_warn||jsonb_build_array('The current version of this rule is retired on approval. Records it already actioned are not actioned again.'); end if;
      v_title:='Approve the rule'; v_effect:='Makes this version the one that runs. Running it is still a separate reviewed action.';
    elsif v_a='automation.state' then
      v_state:=private.specialist_choice(p_m,'state',array['paused','approved','retired']);
      if not ((v_rule.status='approved' and v_state in ('paused','retired')) or (v_rule.status='paused' and v_state in ('approved','retired')) or (v_rule.status='draft' and v_state='retired')) then
        raise exception 'NOV: A % rule cannot become %.',v_rule.status,v_state; end if;
      v_title:=case v_state when 'paused' then 'Pause the rule' when 'approved' then 'Resume the rule' else 'Retire the rule' end;
      v_effect:=case v_state when 'paused' then 'Stops the rule from running until it is resumed.' when 'approved' then 'Allows the approved version to run again.' else 'Ends this rule version. Its history is kept.' end;
    else
      if v_a='automation.execute' and v_rule.status<>'approved' then
        raise exception 'NOV: %',case v_rule.status when 'paused' then 'The rule is paused. Resume it before running it.' when 'draft' then 'A second person must approve the rule before it runs.' else 'A retired rule does not run.' end; end if;
      if v_a='automation.simulate' and v_rule.status='retired' then raise exception 'NOV: A retired rule is not simulated.'; end if;
      v_cands:=private.automation_candidates(p_company,v_rule);
      select count(*) filter (where not exists(select 1 from public.automation_effects ef where ef.company_id=p_company and ef.effect_key=e->>'key' and ef.outcome='succeeded')) into v_new from jsonb_array_elements(v_cands) t(e);
      v_done:=jsonb_array_length(v_cands)-v_new;
      if v_a='automation.simulate' then
        v_title:='Simulate the rule'; v_effect:='Shows what the rule would do now and records it as a simulation. Nothing is executed and no task is created.';
      else
        v_title:='Run the rule'; v_effect:='Creates one internal task for each qualifying record not already actioned by this rule, up to 25 in this run.';
        if v_new>25 then v_warn:=v_warn||jsonb_build_array(format('%s record(s) qualify; 25 are actioned now and the rest wait for the next run.',v_new)); end if;
        if not v_assignee_active then v_warn:=v_warn||jsonb_build_array('The assigned employee is no longer active. Each record is skipped and reported until the rule is revised.'); end if;
        v_warn:=v_warn||jsonb_build_array('Each record gets at most one task from this rule, however often it runs. Tasks never trigger rules, so a run cannot repeat itself.');
      end if;
      v_facts:=v_facts||jsonb_build_object('Qualifying now',jsonb_array_length(v_cands),'Not yet actioned',v_new,'Already actioned',v_done,
        'First records',(select string_agg(e->>'label','; ') from (select e from jsonb_array_elements(v_cands) t(e) limit 3) x));
      v_src:=v_src||jsonb_build_object('cands',md5(v_cands::text),'new',v_new); v_data:=jsonb_build_object('candidates',v_cands);
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.specialist_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.specialist_ctx_lab(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_a text:=p_m->>'action'; v_req public.lab_requests; v_job public.production_jobs; v_bb public.billet_batches; v_vd public.vendors; v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb; v_title text; v_effect text;
  v_src jsonb:='{}'::jsonb; v_data jsonb:='{}'::jsonb; v_kind text; v_open text; v_test jsonb; v_codes text[]:='{}'; v_stage text; v_ref text; v_rev integer; v_done integer; v_total integer; v_bad text; v_dec text; v_today date:=private.ist_today();
begin
  if v_a='lab.request' then
    perform private.assurance_text(p_m,'sample_ref',2,60);
    select request_number into v_open from public.lab_requests where company_id=p_company and lower(sample_ref)=lower(btrim(p_m->>'sample_ref')) and status not in ('reviewed','lost','cancelled');
    if v_open is not null then raise exception 'NOV: Sample % already has an open request (%). Use it, or stop it first.',btrim(p_m->>'sample_ref'),v_open; end if;
    v_kind:=private.specialist_choice(p_m,'material_kind',array['production_job','billet_batch','other']);
    if (v_kind='production_job')<>(p_m ? 'production_job_id') or (v_kind='billet_batch')<>(p_m ? 'billet_batch_id') then raise exception 'NOV: Identify the material: a production job, a billet batch, or a description for other material.'; end if;
    if v_kind='production_job' then
      select * into v_job from public.production_jobs where id=private.specialist_uuid(p_m,'production_job_id') and company_id=p_company;
      if v_job.id is null then raise exception 'NOV: Choose a production job of this company.'; end if;
    elsif v_kind='billet_batch' then
      select * into v_bb from public.billet_batches where id=private.specialist_uuid(p_m,'billet_batch_id') and company_id=p_company;
      if v_bb.id is null then raise exception 'NOV: Choose a billet batch of this company.'; end if;
    elsif not (p_m ? 'material_note') then raise exception 'NOV: Describe the material being tested.'; end if;
    if p_m ? 'material_note' then perform private.assurance_text(p_m,'material_note',5,200); end if;
    select * into v_vd from public.vendors where id=private.specialist_uuid(p_m,'lab_vendor_id') and company_id=p_company;
    if v_vd.id is null then raise exception 'NOV: Choose the laboratory from this company''s suppliers.'; end if;
    if jsonb_typeof(p_m->'tests') is distinct from 'array' or jsonb_array_length(p_m->'tests') not between 1 and 10 then raise exception 'NOV: Add 1 to 10 tests.'; end if;
    for v_test in select e from jsonb_array_elements(p_m->'tests') t(e) loop
      if jsonb_typeof(v_test) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_test) k where k not in ('code','method')) or (v_test->>'code') !~ '^[a-z0-9_]{2,30}$'
        or length(btrim(coalesce(v_test->>'method',''))) not between 2 and 60 then raise exception 'NOV: Each test needs a code (lowercase letters, digits or underscores) and the method revision.'; end if;
      if (v_test->>'code')=any(v_codes) then raise exception 'NOV: Test % is listed twice.',v_test->>'code'; end if;
      v_codes:=v_codes||(v_test->>'code');
    end loop;
    if private.assurance_date(p_m,'promised_date')<v_today then raise exception 'NOV: The promised date cannot be in the past.'; end if;
    if p_m ? 'estimated_charge' then perform private.assurance_number(p_m,'estimated_charge',0,100000000,2); end if;
    v_warn:=v_warn||jsonb_build_array('A laboratory report is evidence for quality review. It never releases material by itself.');
    v_title:='Request external laboratory testing'; v_effect:='Records the sample identity, the tests and method revisions, the laboratory and its promised date.';
    v_facts:=jsonb_build_object('Sample',btrim(p_m->>'sample_ref'),'Material',case v_kind when 'production_job' then 'Job '||coalesce(v_job.job_number,'') when 'billet_batch' then 'Billet batch '||v_bb.batch_number else p_m->>'material_note' end,
      'Laboratory',v_vd.vendor_name,'Tests',array_to_string(v_codes,', '),'Promised',to_char((p_m->>'promised_date')::date,'DD Mon YYYY'),'Estimated charge',coalesce(private.specialist_money((p_m->>'estimated_charge')::numeric),'not stated'));
    v_src:=jsonb_build_object('open',v_open);
  else
    if p_lock then perform 1 from public.lab_requests where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_req from public.lab_requests where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_req.id is null then raise exception 'NOV: The request is unavailable.'; end if;
    select count(distinct test_code) into v_done from public.lab_results where company_id=p_company and request_id=v_req.id;
    v_total:=jsonb_array_length(v_req.tests);
    v_src:=jsonb_build_object('status',v_req.status,'done',v_done,'results',(select count(*) from public.lab_results where company_id=p_company and request_id=v_req.id),'decision',v_req.decision);
    v_facts:=jsonb_build_object('Request',v_req.request_number,'Sample',v_req.sample_ref,'Status',v_req.status,'Tests with a result',v_done||' of '||v_total);
    if v_a='lab.custody' then
      v_stage:=private.specialist_choice(p_m,'stage',array['dispatched','received']); v_ref:=private.assurance_text(p_m,'reference',1,60);
      if v_stage='dispatched' then
        if v_req.status<>'requested' then raise exception 'NOV: Only a requested sample is dispatched; this one is %.',v_req.status; end if;
        v_title:='Record the sample dispatch'; v_effect:='Records the sample leaving for the laboratory with its consignment reference.';
        v_facts:=v_facts||jsonb_build_object('Consignment',v_ref);
      else
        if v_req.status<>'dispatched' then raise exception 'NOV: The laboratory acknowledges a sample that was dispatched; this one is %.',v_req.status; end if;
        if lower(v_ref)<>lower(v_req.sample_ref) then raise exception 'NOV: The laboratory acknowledged sample % but this sample is %. Treat it as mislabelled: stop this request and send a correctly labelled sample. No result is accepted against a mismatched identity.',v_ref,v_req.sample_ref; end if;
        v_title:='Record the laboratory''s acknowledgement'; v_effect:='Records chain of custody: the laboratory confirmed it holds this sample.';
        v_facts:=v_facts||jsonb_build_object('Laboratory sample reference',v_ref);
      end if;
      v_data:=jsonb_build_object('stage',v_stage,'ref',v_ref);
    elsif v_a='lab.revise' then
      if v_req.status not in ('requested','dispatched','at_lab','partial') then raise exception 'NOV: A % request has no promised date to revise.',v_req.status; end if;
      if private.assurance_date(p_m,'revised_date')<v_today then raise exception 'NOV: The revised date cannot be in the past.'; end if;
      v_warn:=v_warn||jsonb_build_array('The original promised date stays on record. Lateness is measured against it.');
      v_title:='Record the laboratory''s revised date'; v_effect:='Records the new date the laboratory gave.';
      v_facts:=v_facts||jsonb_build_object('Original promise',to_char(v_req.promised_date,'DD Mon YYYY'),'Revised to',to_char((p_m->>'revised_date')::date,'DD Mon YYYY'));
    elsif v_a='lab.result' then
      if v_req.status not in ('at_lab','partial','reported','reviewed') then raise exception 'NOV: Results are recorded only after the laboratory acknowledged the sample.'; end if;
      if not exists(select 1 from jsonb_array_elements(v_req.tests) t(e) where e->>'code'=p_m->>'test_code') then raise exception 'NOV: % was not requested on this sample.',p_m->>'test_code'; end if;
      perform private.assurance_text(p_m,'statement',1,200); perform private.assurance_text(p_m,'report_ref',1,60);
      perform private.specialist_choice(p_m,'lab_outcome',array['pass','fail','no_conclusion']);
      select coalesce(max(revision),0)+1 into v_rev from public.lab_results where company_id=p_company and request_id=v_req.id and test_code=p_m->>'test_code';
      if v_rev>1 then v_warn:=v_warn||jsonb_build_array(format('This amends result revision %s for %s. The earlier result is kept.',v_rev-1,p_m->>'test_code')); end if;
      if v_req.status='reviewed' then v_warn:=v_warn||jsonb_build_array(format('The request was already reviewed (%s). The amended result reopens it for a new quality review; the earlier decision is kept in history.',v_req.decision)); end if;
      v_done:=v_done+case when v_rev=1 then 1 else 0 end;
      v_warn:=v_warn||jsonb_build_array('This records the laboratory''s statement. Quality review is a separate decision.');
      v_title:='Record a laboratory result'; v_effect:='Adds the laboratory''s stated result as an immutable revision.';
      v_facts:=v_facts||jsonb_build_object('Test',p_m->>'test_code','Revision',v_rev,'Laboratory statement',btrim(p_m->>'statement'),'Laboratory outcome',replace(p_m->>'lab_outcome','_',' '),'Report',btrim(p_m->>'report_ref'));
      v_data:=jsonb_build_object('revision',v_rev,'status',case when v_done>=v_total then 'reported' else 'partial' end);
    elsif v_a='lab.review' then
      if v_req.status<>'reported' then raise exception 'NOV: Review needs a result for every requested test; % of % are recorded.',v_done,v_total; end if;
      v_dec:=private.specialist_choice(p_m,'decision',array['release','nonconformance','retest']);
      select string_agg(r.test_code||' '||replace(r.lab_outcome,'_',' '),', ') into v_bad from public.lab_results r where r.company_id=p_company and r.request_id=v_req.id and r.lab_outcome<>'pass'
        and r.revision=(select max(r2.revision) from public.lab_results r2 where r2.request_id=r.request_id and r2.test_code=r.test_code);
      if v_dec='release' and v_bad is not null then raise exception 'NOV: Release needs every current result to pass. Not passing: %.',v_bad; end if;
      if (v_dec='retest')<>(p_m ? 'retest_promised_date') then raise exception 'NOV: A retest needs the new promised date, and only a retest has one.'; end if;
      if v_dec='retest' and private.assurance_date(p_m,'retest_promised_date')<v_today then raise exception 'NOV: The retest date cannot be in the past.'; end if;
      if v_dec='nonconformance' then v_warn:=v_warn||jsonb_build_array('Record the nonconformance in the quality workflow. This decision does not create a nonconformance report.'); end if;
      if v_dec='retest' then v_warn:=v_warn||jsonb_build_array('A new request is created for the same sample identity. This request and its results are kept.'); end if;
      if v_bad is not null then v_warn:=v_warn||jsonb_build_array('Current results not passing: '||v_bad); end if;
      v_title:='Record the quality decision'; v_effect:='Records the internal decision on the laboratory evidence, separate from the laboratory''s statement.';
      v_facts:=v_facts||jsonb_build_object('Decision',v_dec);
    else
      if v_req.status not in ('requested','dispatched','at_lab','partial') then raise exception 'NOV: A % request cannot be stopped.',v_req.status; end if;
      perform private.specialist_choice(p_m,'outcome',array['lost','cancelled']);
      v_warn:=v_warn||jsonb_build_array('Evidence recorded so far is kept. A new request can then be made for the same sample.');
      v_title:=case p_m->>'outcome' when 'lost' then 'Record the sample as lost' else 'Cancel the request' end; v_effect:='Ends this request.';
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.specialist_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.specialist_finish_fits(p_line text,p_ref text) returns boolean language sql immutable set search_path=public,private as $$
  select case when p_line is null then null else lower(replace(btrim(p_line),' ','_'))=p_ref or (lower(replace(btrim(p_line),' ','_')) in ('anodizing','anodised','anodized') and p_ref like 'anodized_%')
    or (lower(replace(btrim(p_line),' ','_')) in ('powder_coated','powder_coat') and p_ref='powder_coating') or (lower(replace(btrim(p_line),' ','_'))='mill' and p_ref='mill_finish') end
$$;
create function private.specialist_ctx_shade(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_a text:=p_m->>'action'; v_ref public.shade_references; v_b public.shade_bindings; v_item public.order_items; v_od public.orders; v_fj public.finishing_jobs; v_cust public.customers;
  v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb; v_title text; v_effect text; v_src jsonb:='{}'::jsonb; v_data jsonb:='{}'::jsonb; v_code text; v_rev integer; v_similar text; v_n integer; v_existing public.shade_bindings; v_mixed text; v_fits boolean;
begin
  if v_a='shade.define' then
    v_code:=upper(btrim(coalesce(p_m->>'ref_code','')));
    if v_code !~ '^[A-Z0-9][A-Z0-9._-]{1,29}$' then raise exception 'NOV: Use 2 to 30 letters, digits, dots, hyphens or underscores for the reference code.'; end if;
    if exists(select 1 from public.shade_references where company_id=p_company and ref_code=v_code and status='draft') then raise exception 'NOV: A draft revision of % is already waiting for approval.',v_code; end if;
    perform private.assurance_text(p_m,'shade_name',2,60); perform private.assurance_text(p_m,'specification',5,300); perform private.assurance_text(p_m,'sample_location',2,80); perform private.assurance_text(p_m,'assessment_conditions',5,200);
    perform private.specialist_choice(p_m,'finish_type',array['mill_finish','powder_coating','anodizing','anodized_silver','anodized_bronze','anodized_black','wood_finish','wood_grain','pvdf','other']);
    if p_m ? 'customer_id' then
      select * into v_cust from public.customers where id=private.specialist_uuid(p_m,'customer_id') and company_id=p_company and deleted_at is null;
      if v_cust.id is null then raise exception 'NOV: Choose a customer of this company.'; end if;
    end if;
    if p_m ? 'project_ref' then perform private.assurance_text(p_m,'project_ref',2,80); end if;
    select coalesce(max(revision),0)+1 into v_rev from public.shade_references where company_id=p_company and ref_code=v_code;
    if v_rev>1 then v_warn:=v_warn||jsonb_build_array(format('Approving revision %s supersedes the current revision. Lines already bound keep their earlier approval.',v_rev)); end if;
    select string_agg(ref_code,', ') into v_similar from public.shade_references where company_id=p_company and status='approved' and ref_code<>v_code and lower(btrim(shade_name))=lower(btrim(p_m->>'shade_name'));
    if v_similar is not null then v_warn:=v_warn||jsonb_build_array(format('Reference %s has the same shade name. Confirm that this is a different shade, not a duplicate.',v_similar)); end if;
    v_warn:=v_warn||jsonb_build_array('A photograph can support identification but is not a calibrated colour measurement.');
    v_title:='Define a finish and shade reference'; v_effect:='Creates a draft revision. A second person approves it before order lines can be bound to it.';
    v_facts:=jsonb_build_object('Reference',v_code||' rev '||v_rev,'Shade',btrim(p_m->>'shade_name'),'Finish',replace(p_m->>'finish_type','_',' '),'Customer',coalesce(v_cust.customer_name,'Any customer'),
      'Project',coalesce(btrim(p_m->>'project_ref'),'not stated'),'Physical sample',btrim(p_m->>'sample_location'),'Assessed under',btrim(p_m->>'assessment_conditions'));
    v_data:=jsonb_build_object('code',v_code,'revision',v_rev);
  elsif v_a in ('shade.approve','shade.withdraw') then
    if p_lock then perform 1 from public.shade_references where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_ref from public.shade_references where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_ref.id is null then raise exception 'NOV: The reference is unavailable.'; end if;
    select count(*) into v_n from public.shade_bindings where company_id=p_company and reference_id=v_ref.id and status='active';
    v_facts:=jsonb_build_object('Reference',v_ref.ref_code||' rev '||v_ref.revision,'Shade',v_ref.shade_name,'Active order lines',v_n);
    if v_a='shade.approve' then
      if v_ref.status<>'draft' then raise exception 'NOV: Only a draft reference is approved.'; end if;
      if v_ref.created_by=p_actor then raise exception 'NOV: The person who defined the reference cannot approve it.'; end if;
      v_title:='Approve the reference'; v_effect:='Makes this revision the one new order lines are bound to.';
    else
      if v_ref.status<>'approved' then raise exception 'NOV: Only an approved reference is withdrawn.'; end if;
      if v_n>0 then v_warn:=v_warn||jsonb_build_array(format('%s active order line(s) are flagged until they are bound to an approved reference.',v_n)); end if;
      v_title:='Withdraw the reference'; v_effect:='Stops new bindings. Earlier approvals and decisions are kept.';
    end if;
    v_src:=jsonb_build_object('status',v_ref.status,'n',v_n);
  elsif v_a='shade.bind' then
    if p_lock then perform 1 from public.order_items where id=private.specialist_uuid(p_m,'order_item_id') and company_id=p_company for update; end if;
    select * into v_item from public.order_items where id=private.specialist_uuid(p_m,'order_item_id') and company_id=p_company;
    if v_item.id is null then raise exception 'NOV: Choose an order line of this company.'; end if;
    select * into v_od from public.orders where id=v_item.order_id and company_id=p_company and deleted_at is null;
    if v_od.id is null or v_od.current_stage in ('cancelled','closed','delivered') then raise exception 'NOV: The order is no longer open.'; end if;
    select * into v_ref from public.shade_references where id=private.specialist_uuid(p_m,'reference_id') and company_id=p_company;
    if v_ref.id is null or v_ref.status<>'approved' then raise exception 'NOV: Bind only an approved reference revision.'; end if;
    if v_ref.customer_id is not null and v_ref.customer_id<>v_od.customer_id then raise exception 'NOV: This reference belongs to another customer.'; end if;
    v_fits:=private.specialist_finish_fits(v_item.finishing_type,v_ref.finish_type);
    if v_fits is false then raise exception 'NOV: The order line finish (%) differs from the reference finish (%).',v_item.finishing_type,replace(v_ref.finish_type,'_',' '); end if;
    if v_fits is null then v_warn:=v_warn||jsonb_build_array('The order line has no finish recorded. Confirm the finish with the order.'); end if;
    select * into v_existing from public.shade_bindings where company_id=p_company and order_item_id=v_item.id and status='active';
    if v_existing.reference_id=v_ref.id then raise exception 'NOV: The line is already bound to this reference.'; end if;
    if v_existing.id is not null then v_warn:=v_warn||jsonb_build_array('This replaces the line''s current binding. Its batch decisions stay with it.'); end if;
    select string_agg(distinct r2.ref_code,', ') into v_mixed from public.shade_bindings b2 join public.shade_references r2 on r2.id=b2.reference_id and r2.company_id=b2.company_id
      join public.order_items i2 on i2.id=b2.order_item_id and i2.company_id=b2.company_id where b2.company_id=p_company and b2.status='active' and i2.order_id=v_od.id and i2.id<>v_item.id
        and i2.profile_id is not distinct from v_item.profile_id and r2.ref_code<>v_ref.ref_code;
    if v_mixed is not null then v_warn:=v_warn||jsonb_build_array(format('Another line of this order with the same profile is bound to %s. Mixed references are flagged for packing until reviewed.',v_mixed)); end if;
    select string_agg(ref_code,', ') into v_similar from public.shade_references where company_id=p_company and status='approved' and ref_code<>v_ref.ref_code and lower(btrim(shade_name))=lower(btrim(v_ref.shade_name));
    if v_similar is not null then v_warn:=v_warn||jsonb_build_array(format('%s has the same shade name. Check the code on the vendor instruction.',v_similar)); end if;
    v_title:='Bind the reference to the order line'; v_effect:='Records which approved reference revision the line and its finishing instruction must match.';
    v_facts:=jsonb_build_object('Order',v_od.order_number,'Line',coalesce(v_item.item_description,'order line'),'Reference',v_ref.ref_code||' rev '||v_ref.revision,'Shade',v_ref.shade_name,
      'Specification',v_ref.specification,'Physical sample',v_ref.sample_location);
    v_src:=jsonb_build_object('existing',v_existing.id,'ref',v_ref.status,'mixed',v_mixed); v_data:=jsonb_build_object('replace_id',v_existing.id);
  else
    if p_lock then perform 1 from public.shade_bindings where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_b from public.shade_bindings where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_b.id is null or v_b.status<>'active' then raise exception 'NOV: Choose a line that is currently bound.'; end if;
    select * into v_ref from public.shade_references where id=v_b.reference_id and company_id=p_company;
    if v_ref.status='withdrawn' then raise exception 'NOV: The reference was withdrawn. Bind an approved reference before deciding batches.'; end if;
    select * into v_item from public.order_items where id=v_b.order_item_id and company_id=p_company;
    perform private.assurance_text(p_m,'batch_label',1,60); perform private.assurance_text(p_m,'assessed_under',5,200);
    perform private.specialist_choice(p_m,'decision',array['match','deviation_accepted','reject']);
    if p_m ? 'finishing_job_id' then
      select * into v_fj from public.finishing_jobs where id=private.specialist_uuid(p_m,'finishing_job_id') and company_id=p_company;
      if v_fj.id is null or v_fj.order_id<>v_item.order_id then raise exception 'NOV: Choose a finishing job of the same order.'; end if;
    end if;
    if exists(select 1 from public.shade_decisions where company_id=p_company and binding_id=v_b.id and status='active' and lower(batch_label)=lower(btrim(p_m->>'batch_label'))) then
      v_warn:=v_warn||jsonb_build_array('This replaces the earlier decision for this batch. The earlier decision is kept.'); end if;
    if p_m->>'decision'='deviation_accepted' then v_warn:=v_warn||jsonb_build_array('An authorised deviation is recorded against the reference. It does not change the reference or the customer requirement.'); end if;
    if v_ref.status='superseded' then v_warn:=v_warn||jsonb_build_array('The line is bound to a superseded revision. The decision is recorded against that revision.'); end if;
    v_title:='Record the batch match decision'; v_effect:='Records the reviewed assessment of a returned finishing batch against the bound reference.';
    v_facts:=jsonb_build_object('Reference',v_ref.ref_code||' rev '||v_ref.revision,'Shade',v_ref.shade_name,'Batch',btrim(p_m->>'batch_label'),'Decision',replace(p_m->>'decision','_',' '),
      'Assessed under',btrim(p_m->>'assessed_under'),'Agreed conditions',v_ref.assessment_conditions);
    v_src:=jsonb_build_object('binding',v_b.status,'ref',v_ref.status);
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.specialist_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.specialist_ctx_agreement(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_a text:=p_m->>'action'; v_ag public.blanket_agreements; v_line public.blanket_lines; v_rel public.blanket_releases; v_cust public.customers; v_od public.orders; v_rate public.blanket_rates;
  v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb; v_title text; v_effect text; v_src jsonb:='{}'::jsonb; v_data jsonb:='{}'::jsonb; v_today date:=private.ist_today();
  v_from date; v_to date; v_ln jsonb; v_keys text[]:='{}'; v_key text; v_pos jsonb; v_qty numeric; v_open integer; v_overlap text; v_pf public.aluminium_profiles; v_carry jsonb:='[]'::jsonb; v_used text;
begin
  if v_a='agreement.define' then
    select * into v_cust from public.customers where id=private.specialist_uuid(p_m,'customer_id') and company_id=p_company and deleted_at is null and is_active;
    if v_cust.id is null then raise exception 'NOV: Choose an active customer of this company.'; end if;
    perform private.assurance_text(p_m,'customer_ref',1,60);
    v_from:=private.assurance_date(p_m,'valid_from'); v_to:=private.assurance_date(p_m,'valid_to');
    if v_to<v_from then raise exception 'NOV: The agreement cannot end before it starts.'; end if;
    if v_to<v_today then raise exception 'NOV: The agreement period has already ended.'; end if;
    perform private.assurance_number(p_m,'overrun_percent',0,20,2);
    if jsonb_typeof(p_m->'lines') is distinct from 'array' or jsonb_array_length(p_m->'lines') not between 1 and 20 then raise exception 'NOV: Add 1 to 20 agreement lines.'; end if;
    for v_ln in select e from jsonb_array_elements(p_m->'lines') t(e) loop
      if jsonb_typeof(v_ln) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_ln) k where k not in ('profile_id','finish','agreed_kg','rate_per_kg')) then raise exception 'NOV: Each line needs a profile, finish, agreed kilograms and rate.'; end if;
      select * into v_pf from public.aluminium_profiles where id=private.specialist_uuid(v_ln,'profile_id') and company_id=p_company and deleted_at is null and is_active;
      if v_pf.id is null then raise exception 'NOV: Choose active profiles of this company.'; end if;
      perform private.assurance_text(v_ln,'finish',2,40); perform private.assurance_number(v_ln,'agreed_kg',0.001,100000000,3); perform private.assurance_number(v_ln,'rate_per_kg',0.01,10000000,2);
      v_key:=v_pf.id||':'||lower(btrim(v_ln->>'finish'));
      if v_key=any(v_keys) then raise exception 'NOV: % with finish % is listed twice.',v_pf.profile_code,btrim(v_ln->>'finish'); end if;
      v_keys:=v_keys||v_key;
      select string_agg(distinct ba.agreement_number,', ') into v_overlap from public.blanket_agreements ba join public.blanket_lines bl on bl.agreement_id=ba.id and bl.company_id=ba.company_id
        where ba.company_id=p_company and ba.customer_id=v_cust.id and ba.status='active' and bl.profile_id=v_pf.id and lower(bl.finish)=lower(btrim(v_ln->>'finish')) and ba.valid_from<=v_to and ba.valid_to>=v_from;
      if v_overlap is not null then v_warn:=v_warn||jsonb_build_array(format('Agreement %s already covers %s for this customer in an overlapping period. Each release names its agreement line.',v_overlap,v_pf.profile_code)); end if;
    end loop;
    v_warn:=v_warn||jsonb_build_array('The agreed quantity is a commercial ceiling. It is not stock and not production demand.');
    v_title:='Define a blanket agreement'; v_effect:='Creates a draft agreement. A second person approves it before releases can be called off.';
    v_facts:=jsonb_build_object('Customer',v_cust.customer_name,'Customer reference',btrim(p_m->>'customer_ref'),'Valid',to_char(v_from,'DD Mon YYYY')||' to '||to_char(v_to,'DD Mon YYYY'),
      'Lines',jsonb_array_length(p_m->'lines'),'Agreed total',private.specialist_kg((select sum((e->>'agreed_kg')::numeric) from jsonb_array_elements(p_m->'lines') t(e))),'Agreed overrun',trim_scale((p_m->>'overrun_percent')::numeric)||'%');
  elsif v_a in ('agreement.approve','agreement.close') then
    if p_lock then perform 1 from public.blanket_agreements where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_ag from public.blanket_agreements where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_ag.id is null then raise exception 'NOV: The agreement is unavailable.'; end if;
    v_facts:=jsonb_build_object('Agreement',v_ag.agreement_number,'Customer reference',v_ag.customer_ref,'Valid',to_char(v_ag.valid_from,'DD Mon YYYY')||' to '||to_char(v_ag.valid_to,'DD Mon YYYY'));
    v_src:=jsonb_build_object('status',v_ag.status);
    if v_a='agreement.approve' then
      if v_ag.status<>'draft' then raise exception 'NOV: Only a draft agreement is approved.'; end if;
      if v_ag.created_by=p_actor then raise exception 'NOV: The person who defined the agreement cannot approve it.'; end if;
      if v_ag.valid_to<v_today then raise exception 'NOV: The agreement period has already ended.'; end if;
      v_title:='Approve the agreement'; v_effect:='Makes the agreement active so releases can be called off against its balance.';
    else
      if v_ag.status<>'active' then raise exception 'NOV: Only an active agreement is closed.'; end if;
      select count(*) into v_open from public.blanket_releases where company_id=p_company and agreement_id=v_ag.id and status in ('scheduled','firm');
      if v_open>0 then raise exception 'NOV: % release(s) are still scheduled or firm. Fulfil or cancel them first.',v_open; end if;
      select coalesce(jsonb_agg(jsonb_build_object('line_id',bl.id,'seq',bl.seq,'profile_id',bl.profile_id,'finish',bl.finish,'remaining',bl.agreed_kg-(p.v->>'consumed_kg')::numeric,
          'rate',(select rate_per_kg from public.blanket_rates br where br.line_id=bl.id order by br.effective_from desc limit 1)) order by bl.seq) filter (where bl.agreed_kg-(p.v->>'consumed_kg')::numeric>0),'[]'::jsonb),
        string_agg(pf.profile_code||' '||trim_scale(greatest(bl.agreed_kg-(p.v->>'consumed_kg')::numeric,0))||' kg',', ' order by bl.seq) into v_carry,v_used
        from public.blanket_lines bl join public.aluminium_profiles pf on pf.id=bl.profile_id and pf.company_id=bl.company_id cross join lateral (select private.blanket_position(p_company,bl.id) v) p
        where bl.company_id=p_company and bl.agreement_id=v_ag.id;
      if private.specialist_bool(p_m,'carry_forward') then
        if not (p_m ? 'new_valid_to') or private.assurance_date(p_m,'new_valid_to')<=v_today then raise exception 'NOV: A carry-forward needs a new end date after today.'; end if;
        if jsonb_array_length(v_carry)=0 then raise exception 'NOV: Nothing remains to carry forward.'; end if;
        v_warn:=v_warn||jsonb_build_array('The remaining quantity moves to a new draft agreement, which a second person approves. The latest agreed rates are carried with it.');
        v_title:='Close and carry forward'; v_effect:='Closes this agreement and creates a draft for the remaining agreed quantity.';
      else
        if p_m ? 'new_valid_to' then raise exception 'NOV: Only a carry-forward has a new end date.'; end if;
        v_title:='Close the agreement'; v_effect:='Closes the agreement. Releases and their snapshots are kept.';
      end if;
      v_warn:=v_warn||jsonb_build_array('Unused quantity is not production demand and not stock.');
      v_facts:=v_facts||jsonb_build_object('Unused by line',coalesce(v_used,'none'));
      v_data:=jsonb_build_object('carry',v_carry); v_src:=v_src||jsonb_build_object('carry',md5(v_carry::text));
    end if;
  elsif v_a in ('agreement.rate','agreement.amend','release.create') then
    if p_lock then perform 1 from public.blanket_lines where id=private.specialist_uuid(p_m,'line_id') and company_id=p_company for update; end if;
    select * into v_line from public.blanket_lines where id=private.specialist_uuid(p_m,'line_id') and company_id=p_company;
    if v_line.id is null then raise exception 'NOV: The agreement line is unavailable.'; end if;
    select * into v_ag from public.blanket_agreements where id=v_line.agreement_id and company_id=p_company;
    select * into v_pf from public.aluminium_profiles where id=v_line.profile_id and company_id=p_company;
    v_pos:=private.blanket_position(p_company,v_line.id);
    v_facts:=jsonb_build_object('Agreement',v_ag.agreement_number,'Line',v_line.seq||' · '||v_pf.profile_code||' · '||v_line.finish,'Agreed',private.specialist_kg(v_line.agreed_kg),
      'Released so far',private.specialist_kg((v_pos->>'consumed_kg')::numeric),'Available',private.specialist_kg((v_pos->>'available_kg')::numeric));
    v_src:=jsonb_build_object('status',v_ag.status,'pos',v_pos,'agreed',v_line.agreed_kg);
    if v_a='agreement.rate' then
      if v_ag.status not in ('draft','active') then raise exception 'NOV: Rates are revised only on a draft or active agreement.'; end if;
      perform private.assurance_number(p_m,'rate_per_kg',0.01,10000000,2); v_from:=private.assurance_date(p_m,'effective_from');
      if v_from not between v_ag.valid_from and v_ag.valid_to then raise exception 'NOV: The rate must start within the agreement period.'; end if;
      if exists(select 1 from public.blanket_rates where line_id=v_line.id and effective_from=v_from) then raise exception 'NOV: A rate already starts on that date. Choose another date.'; end if;
      select count(*) into v_open from public.blanket_releases where company_id=p_company and line_id=v_line.id and status in ('firm','fulfilled') and requested_date>=v_from;
      if v_open>0 then v_warn:=v_warn||jsonb_build_array(format('%s release(s) already firmed keep the rate they were firmed at.',v_open)); end if;
      v_title:='Record a rate revision'; v_effect:='Adds a dated rate. Releases firmed from now on use the rate in force on their delivery date.';
      v_rate:=private.blanket_rate_on(p_company,v_line.id,v_from);
      v_facts:=v_facts||jsonb_build_object('Current rate on that date',private.specialist_money(v_rate.rate_per_kg),'New rate',private.specialist_money((p_m->>'rate_per_kg')::numeric),'From',to_char(v_from,'DD Mon YYYY'));
    elsif v_a='agreement.amend' then
      if v_ag.status<>'active' then raise exception 'NOV: Only an active agreement is amended.'; end if;
      v_qty:=private.assurance_number(p_m,'agreed_kg',0.001,100000000,3);
      if v_qty=v_line.agreed_kg then raise exception 'NOV: The agreed quantity is unchanged.'; end if;
      if round(v_qty*(1+v_ag.overrun_percent/100),3)<(v_pos->>'consumed_kg')::numeric then raise exception 'NOV: % is already released; the line cannot be reduced below that.',private.specialist_kg((v_pos->>'consumed_kg')::numeric); end if;
      v_title:='Amend the agreed quantity'; v_effect:='Changes the line ceiling. The earlier quantity is kept in the line history.';
      v_facts:=v_facts||jsonb_build_object('New agreed quantity',private.specialist_kg(v_qty));
    else
      if v_ag.status<>'active' then raise exception 'NOV: Releases are called off only against an active agreement.'; end if;
      if v_today not between v_ag.valid_from and v_ag.valid_to then raise exception 'NOV: The agreement is not in force today (valid % to %).',to_char(v_ag.valid_from,'DD Mon YYYY'),to_char(v_ag.valid_to,'DD Mon YYYY'); end if;
      v_qty:=private.assurance_number(p_m,'quantity_kg',0.001,100000000,3); perform private.assurance_text(p_m,'site',2,120); v_from:=private.assurance_date(p_m,'requested_date');
      if v_from<v_today or v_from>v_ag.valid_to then raise exception 'NOV: The delivery date must be between today and the end of the agreement.'; end if;
      if v_qty>(v_pos->>'available_kg')::numeric then raise exception 'NOV: Only % remain on this line, including any agreed overrun.',private.specialist_kg((v_pos->>'available_kg')::numeric); end if;
      if (v_pos->>'consumed_kg')::numeric+v_qty>v_line.agreed_kg then v_warn:=v_warn||jsonb_build_array('This release uses the agreed overrun allowance.'); end if;
      v_warn:=v_warn||jsonb_build_array('A scheduled release reserves agreement balance only. It is not an order and not a stock reservation.');
      v_title:='Call off a release'; v_effect:='Reserves the quantity from the agreement balance for this delivery site and date.';
      v_facts:=v_facts||jsonb_build_object('Release quantity',private.specialist_kg(v_qty),'Site',btrim(p_m->>'site'),'Delivery date',to_char(v_from,'DD Mon YYYY'));
    end if;
  else
    if p_lock then perform 1 from public.blanket_releases where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_rel from public.blanket_releases where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_rel.id is null then raise exception 'NOV: The release is unavailable.'; end if;
    select * into v_ag from public.blanket_agreements where id=v_rel.agreement_id and company_id=p_company;
    v_facts:=jsonb_build_object('Release',v_rel.release_number,'Agreement',v_ag.agreement_number,'Quantity',private.specialist_kg(v_rel.quantity_kg),'Delivery date',to_char(v_rel.requested_date,'DD Mon YYYY'),'Status',v_rel.status);
    v_src:=jsonb_build_object('status',v_rel.status,'qty',v_rel.quantity_kg,'returned',v_rel.returned_kg,'agreement',v_ag.status);
    if v_a='release.firm' then
      if v_rel.status<>'scheduled' then raise exception 'NOV: Only a scheduled release is firmed.'; end if;
      if v_ag.status<>'active' then raise exception 'NOV: The agreement is no longer active.'; end if;
      v_rate:=private.blanket_rate_on(p_company,v_rel.line_id,v_rel.requested_date);
      if v_rate.id is null then raise exception 'NOV: No agreed rate covers the delivery date.'; end if;
      v_title:='Firm the release'; v_effect:='Fixes the release and its rate snapshot. Later rate revisions do not change it.';
      v_facts:=v_facts||jsonb_build_object('Rate applied',private.specialist_money(v_rate.rate_per_kg)||' per kg','Rate in force from',to_char(v_rate.effective_from,'DD Mon YYYY'));
      v_data:=jsonb_build_object('rate',v_rate.rate_per_kg,'from',v_rate.effective_from); v_src:=v_src||jsonb_build_object('rate',v_rate.id);
    elsif v_a='release.cancel' then
      if v_rel.status not in ('scheduled','firm') then raise exception 'NOV: Only a scheduled or firm release is cancelled.'; end if;
      v_qty:=private.assurance_number(p_m,'quantity_kg',0.001,100000000,3);
      if v_qty>v_rel.quantity_kg then raise exception 'NOV: The release holds only %.',private.specialist_kg(v_rel.quantity_kg); end if;
      v_title:=case when v_qty=v_rel.quantity_kg then 'Cancel the release' else 'Reduce the release' end; v_effect:='Returns the cancelled quantity to the agreement balance. The release history is kept.';
      v_facts:=v_facts||jsonb_build_object('Cancelled quantity',private.specialist_kg(v_qty),'Remaining on the release',private.specialist_kg(v_rel.quantity_kg-v_qty));
      v_data:=jsonb_build_object('full',v_qty=v_rel.quantity_kg,'qty',v_qty);
    elsif v_a='release.fulfil' then
      if v_rel.status<>'firm' then raise exception 'NOV: Only a firm release is fulfilled.'; end if;
      select * into v_od from public.orders where id=private.specialist_uuid(p_m,'order_id') and company_id=p_company and deleted_at is null;
      if v_od.id is null or v_od.customer_id<>v_ag.customer_id then raise exception 'NOV: Choose an order of the agreement''s customer.'; end if;
      if v_od.current_stage='cancelled' then raise exception 'NOV: The order is cancelled.'; end if;
      select release_number into v_used from public.blanket_releases where company_id=p_company and order_id=v_od.id;
      if v_used is not null then raise exception 'NOV: Order % already fulfils release %.',v_od.order_number,v_used; end if;
      if coalesce(v_od.requested_weight_kg,0)>0 and abs(v_od.requested_weight_kg-v_rel.quantity_kg)>v_rel.quantity_kg*0.005 then
        v_warn:=v_warn||jsonb_build_array(format('The order requests %s; the release is %s. The release keeps its own quantity.',private.specialist_kg(v_od.requested_weight_kg),private.specialist_kg(v_rel.quantity_kg))); end if;
      v_title:='Record the order that fulfils the release'; v_effect:='Links the released order. The release keeps its own rate and quantity snapshot.';
      v_facts:=v_facts||jsonb_build_object('Order',v_od.order_number,'Order stage',replace(v_od.current_stage,'_',' '));
    else
      if v_rel.status<>'fulfilled' then raise exception 'NOV: Returns are recorded against a fulfilled release.'; end if;
      v_qty:=private.assurance_number(p_m,'quantity_kg',0.001,100000000,3);
      if v_qty>v_rel.quantity_kg-v_rel.returned_kg then raise exception 'NOV: At most % can be returned on this release.',private.specialist_kg(v_rel.quantity_kg-v_rel.returned_kg); end if;
      v_warn:=v_warn||jsonb_build_array('The returned quantity restores the agreement balance. The physical return is handled in the returns workflow.');
      v_title:='Record a return against the release'; v_effect:='Restores the returned quantity to the agreement balance.';
      v_facts:=v_facts||jsonb_build_object('Returned quantity',private.specialist_kg(v_qty));
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.specialist_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.specialist_ctx_tooling(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_a text:=p_m->>'action'; v_ta public.tooling_agreements; v_cur public.tooling_agreements; v_die public.dies; v_cust public.customers; v_iv public.invoices; v_pm public.payments; v_cn public.credit_notes; v_al public.tooling_allocations;
  v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb; v_title text; v_effect text; v_src jsonb:='{}'::jsonb; v_data jsonb:='{}'::jsonb; v_kind text; v_amt numeric; v_avail numeric; v_pos jsonb;
  v_charge numeric; v_contrib numeric; v_waiver numeric; v_basis text; v_kg numeric; v_calc jsonb; v_family uuid; v_number text; v_version integer;
begin
  if v_a='tooling.define' then
    select * into v_die from public.dies where id=private.specialist_uuid(p_m,'die_id') and company_id=p_company and deleted_at is null;
    if v_die.id is null then raise exception 'NOV: Choose a die of this company.'; end if;
    select * into v_cust from public.customers where id=private.specialist_uuid(p_m,'customer_id') and company_id=p_company and deleted_at is null;
    if v_cust.id is null then raise exception 'NOV: Choose a customer of this company.'; end if;
    perform private.specialist_choice(p_m,'owner_party',array['company','customer']);
    v_charge:=private.assurance_number(p_m,'die_charge',0,1000000000,2); v_contrib:=private.assurance_number(p_m,'customer_contribution',0,1000000000,2); v_waiver:=private.assurance_number(p_m,'waiver_amount',0,1000000000,2);
    if v_contrib>v_charge then raise exception 'NOV: The customer contribution cannot exceed the die charge.'; end if;
    if v_waiver>v_contrib then raise exception 'NOV: The waiver cannot exceed the customer contribution.'; end if;
    v_basis:=private.specialist_choice(p_m,'recovery_basis',array['none','per_kg']);
    if (v_basis='per_kg')<>(p_m ? 'recovery_rate_per_kg' and p_m ? 'recovery_cap') or (v_basis='none' and (p_m ? 'recovery_rate_per_kg' or p_m ? 'recovery_cap')) then
      raise exception 'NOV: Recovery through later orders needs a rate per kg and a cap; no recovery has neither.'; end if;
    if v_basis='per_kg' then
      perform private.assurance_number(p_m,'recovery_rate_per_kg',0.0001,1000000,4);
      if private.assurance_number(p_m,'recovery_cap',0.01,1000000000,2)>v_contrib-v_waiver then raise exception 'NOV: The recovery cap cannot exceed the contribution after the waiver.'; end if;
    end if;
    perform private.assurance_text(p_m,'tax_reference',2,120); perform private.assurance_text(p_m,'terms',5,500);
    select * into v_cur from public.tooling_agreements where company_id=p_company and die_id=v_die.id and status='active';
    if v_cur.id is not null then
      if v_cur.customer_id<>v_cust.id then raise exception 'NOV: Die % has an active agreement with another customer. A different customer is not an amendment.',v_die.die_number; end if;
      if exists(select 1 from public.tooling_agreements where company_id=p_company and family_id=v_cur.family_id and status='draft') then raise exception 'NOV: An amendment of this agreement is already waiting for approval.'; end if;
      v_family:=v_cur.family_id; v_number:=v_cur.agreement_number; select max(version)+1 into v_version from public.tooling_agreements where company_id=p_company and family_id=v_family;
      v_pos:=private.tooling_position(p_company,v_family);
      v_warn:=v_warn||jsonb_build_array(format('This amends %s v%s. Approval supersedes it; allocations stay with the agreement.',v_cur.agreement_number,v_cur.version));
      if v_contrib-v_waiver<(v_pos->>'received')::numeric+(v_pos->>'recovered')::numeric then v_warn:=v_warn||jsonb_build_array('More has already been received or recovered than the amended contribution. Resolve the difference through finance.'); end if;
      if v_cur.owner_party<>(p_m->>'owner_party') then v_warn:=v_warn||jsonb_build_array(format('Ownership changes from %s to %s as agreed.',v_cur.owner_party,p_m->>'owner_party')); end if;
    else
      if exists(select 1 from public.tooling_agreements where company_id=p_company and die_id=v_die.id and status='draft') then raise exception 'NOV: A draft agreement for this die is already waiting for approval.'; end if;
      v_version:=1;
    end if;
    if (v_die.ownership_type='customer_owned')<>(p_m->>'owner_party'='customer') then
      v_warn:=v_warn||jsonb_build_array(format('The die master records the die as %s. Update it through the die workflow if the agreement changes ownership.',replace(v_die.ownership_type,'_',' '))); end if;
    v_warn:=v_warn||jsonb_build_array('Ownership is recorded as agreed. It is never inferred from who paid an invoice.','The tax and accounting treatment reference needs authorised review.');
    v_title:='Define a tooling commercial agreement'; v_effect:='Creates a draft agreement version. A second person approves it, including any waiver.';
    v_facts:=jsonb_build_object('Die',v_die.die_number,'Customer',v_cust.customer_name,'Owner',p_m->>'owner_party','Die charge',private.specialist_money(v_charge),'Customer contribution',private.specialist_money(v_contrib),
      'Waiver',private.specialist_money(v_waiver),'Recovery',case when v_basis='per_kg' then private.specialist_money((p_m->>'recovery_rate_per_kg')::numeric)||' per kg up to '||private.specialist_money((p_m->>'recovery_cap')::numeric) else 'None' end,'Version',v_version);
    v_data:=jsonb_build_object('family',v_family,'number',v_number,'version',v_version); v_src:=jsonb_build_object('current',v_cur.id);
  else
    if p_lock then perform 1 from public.tooling_agreements where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_ta from public.tooling_agreements where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_ta.id is null then raise exception 'NOV: The agreement is unavailable.'; end if;
    select * into v_die from public.dies where id=v_ta.die_id and company_id=p_company;
    v_pos:=private.tooling_position(p_company,v_ta.family_id);
    v_facts:=jsonb_build_object('Agreement',v_ta.agreement_number||' v'||v_ta.version,'Die',v_die.die_number,'Contribution due',private.specialist_money((v_pos->>'contribution_due')::numeric),
      'Received',private.specialist_money((v_pos->>'received')::numeric),'Recovered',private.specialist_money((v_pos->>'recovered')::numeric),'Outstanding',private.specialist_money((v_pos->>'outstanding')::numeric));
    v_src:=jsonb_build_object('status',v_ta.status,'disputed',v_ta.disputed,'pos',v_pos);
    if v_a='tooling.approve' then
      if v_ta.status<>'draft' then raise exception 'NOV: Only a draft agreement is approved.'; end if;
      if v_ta.created_by=p_actor then raise exception 'NOV: The person who defined the agreement cannot approve it.'; end if;
      v_title:='Approve the tooling agreement'; v_effect:='Makes this version the active commercial agreement for the die.';
      if v_ta.version>1 then v_warn:=v_warn||jsonb_build_array('The earlier version is superseded and kept.'); end if;
      if v_ta.waiver_amount>0 then v_warn:=v_warn||jsonb_build_array(format('You approve a waiver of %s.',private.specialist_money(v_ta.waiver_amount))); end if;
    elsif v_a='tooling.dispute' then
      if v_ta.status<>'active' then raise exception 'NOV: Only an active agreement can be disputed.'; end if;
      if private.specialist_choice(p_m,'state',array['open','resolved'])='open' then
        if v_ta.disputed then raise exception 'NOV: A dispute is already open.'; end if;
        v_title:='Open a dispute'; v_effect:='Flags the agreement as disputed. Allocations stay as recorded.';
      else
        if not v_ta.disputed then raise exception 'NOV: There is no open dispute.'; end if;
        v_title:='Resolve the dispute'; v_effect:='Clears the dispute flag. Record any correction as an allocation or a reversal.';
      end if;
    else
      if v_ta.status<>'active' then raise exception 'NOV: Allocations are linked to the active agreement version.'; end if;
      if v_a='tooling.reverse' then
        select * into v_al from public.tooling_allocations where id=private.specialist_uuid(p_m,'allocation_id') and company_id=p_company and family_id=v_ta.family_id;
        if v_al.id is null or v_al.reversed_at is not null then raise exception 'NOV: Choose an allocation of this agreement that is still counted.'; end if;
        v_title:='Reverse the allocation'; v_effect:='Stops counting this linked record. The allocation and the reason are kept.';
        v_facts:=v_facts||jsonb_build_object('Allocation',replace(v_al.kind,'_',' ')||' '||private.specialist_money(v_al.amount));
        v_src:=v_src||jsonb_build_object('alloc',v_al.reversed_at);
      else
        v_kind:=private.specialist_choice(p_m,'kind',array['charge_invoice','payment','credit_note','recovery']);
        if (v_kind in ('charge_invoice','recovery'))<>(p_m ? 'invoice_id') or (v_kind='payment')<>(p_m ? 'payment_id') or (v_kind='credit_note')<>(p_m ? 'credit_note_id') then
          raise exception 'NOV: Link one record of the chosen kind.'; end if;
        if (v_kind='recovery')=(p_m ? 'amount') then raise exception 'NOV: %',case when v_kind='recovery' then 'A recovery amount is calculated from the dispatched kilograms; do not enter it.' else 'Enter the amount allocated.' end; end if;
        if v_kind<>'recovery' then v_amt:=private.assurance_number(p_m,'amount',0.01,1000000000,2); end if;
        if v_kind in ('charge_invoice','recovery') then
          select * into v_iv from public.invoices where id=private.specialist_uuid(p_m,'invoice_id') and company_id=p_company and deleted_at is null;
          if v_iv.id is null or v_iv.customer_id<>v_ta.customer_id then raise exception 'NOV: Choose an invoice of the agreement''s customer.'; end if;
          if v_iv.status in ('draft','cancelled') then raise exception 'NOV: Only an issued invoice is linked; this one is %.',v_iv.status; end if;
        end if;
        if v_kind='charge_invoice' then
          select v_iv.subtotal-coalesce(sum(amount),0) into v_avail from public.tooling_allocations where company_id=p_company and invoice_id=v_iv.id and reversed_at is null;
          if v_amt>v_avail then raise exception 'NOV: Only % of this invoice is not yet allocated.',private.specialist_money(v_avail); end if;
          if (v_pos->>'charged')::numeric-(v_pos->>'credited')::numeric+v_amt>(v_pos->>'contribution_due')::numeric then v_warn:=v_warn||jsonb_build_array('Charges linked would exceed the contribution after the waiver.'); end if;
          v_facts:=v_facts||jsonb_build_object('Invoice',v_iv.invoice_number,'Amount linked',private.specialist_money(v_amt));
        elsif v_kind='payment' then
          select * into v_pm from public.payments where id=private.specialist_uuid(p_m,'payment_id') and company_id=p_company;
          if v_pm.id is null or v_pm.reversed_at is not null then raise exception 'NOV: Choose a payment that is not reversed.'; end if;
          if not exists(select 1 from public.tooling_allocations where company_id=p_company and family_id=v_ta.family_id and kind='charge_invoice' and invoice_id=v_pm.invoice_id and reversed_at is null) then
            raise exception 'NOV: Link the payment of an invoice already linked to this agreement.'; end if;
          select v_pm.amount-coalesce(sum(amount),0) into v_avail from public.tooling_allocations where company_id=p_company and payment_id=v_pm.id and reversed_at is null;
          if v_amt>v_avail then raise exception 'NOV: Only % of this payment is not yet allocated.',private.specialist_money(v_avail); end if;
          v_facts:=v_facts||jsonb_build_object('Payment',coalesce(v_pm.reference_number,'no reference')||' · '||private.specialist_money(v_pm.amount),'Amount linked',private.specialist_money(v_amt));
        elsif v_kind='credit_note' then
          select * into v_cn from public.credit_notes where id=private.specialist_uuid(p_m,'credit_note_id') and company_id=p_company;
          if v_cn.id is null or v_cn.status<>'issued' then raise exception 'NOV: Choose an issued credit note.'; end if;
          if not exists(select 1 from public.tooling_allocations where company_id=p_company and family_id=v_ta.family_id and kind='charge_invoice' and invoice_id=v_cn.invoice_id and reversed_at is null) then
            raise exception 'NOV: Link a credit note of an invoice already linked to this agreement.'; end if;
          select v_cn.subtotal-coalesce(sum(amount),0) into v_avail from public.tooling_allocations where company_id=p_company and credit_note_id=v_cn.id and reversed_at is null;
          if v_amt>v_avail then raise exception 'NOV: Only % of this credit note is not yet allocated.',private.specialist_money(v_avail); end if;
          v_facts:=v_facts||jsonb_build_object('Credit note',v_cn.credit_note_number,'Amount linked',private.specialist_money(v_amt));
        else
          if v_ta.recovery_basis<>'per_kg' then raise exception 'NOV: This agreement has no recovery through later orders.'; end if;
          if exists(select 1 from public.tooling_allocations where company_id=p_company and invoice_id=v_iv.id and kind='recovery' and reversed_at is null) then raise exception 'NOV: Recovery is already counted on this invoice.'; end if;
          if v_iv.order_id is null or exists(select 1 from public.orders where id=v_iv.order_id and company_id=p_company and current_stage='cancelled') then raise exception 'NOV: Recovery needs an invoice for an order that is not cancelled.'; end if;
          if v_iv.dispatch_id is null then raise exception 'NOV: Recovery is measured from dispatched bundles; this invoice has no dispatch.'; end if;
          select coalesce(sum(coalesce(pl.net_weight_kg,pl.gross_weight_kg-pl.tare_weight_kg)),0) into v_kg from public.packing_list_items pl where pl.company_id=p_company and pl.dispatch_id=v_iv.dispatch_id and pl.profile_id=v_die.profile_id;
          if v_kg<=0 then raise exception 'NOV: The dispatch has no bundles of the die''s profile.'; end if;
          if (v_pos->>'cap_remaining')::numeric<=0 then raise exception 'NOV: The recovery cap is already reached.'; end if;
          v_amt:=least(round(v_kg*v_ta.recovery_rate_per_kg,2),(v_pos->>'cap_remaining')::numeric);
          v_calc:=jsonb_build_object('kg',v_kg,'rate',v_ta.recovery_rate_per_kg,'uncapped',round(v_kg*v_ta.recovery_rate_per_kg,2),'cap_remaining',(v_pos->>'cap_remaining')::numeric,'amount',v_amt,'invoice',v_iv.invoice_number,'agreement_version',v_ta.version);
          if v_amt<round(v_kg*v_ta.recovery_rate_per_kg,2) then v_warn:=v_warn||jsonb_build_array('The cap limits this recovery.'); end if;
          v_facts:=v_facts||jsonb_build_object('Invoice',v_iv.invoice_number,'Dispatched of this profile',private.specialist_kg(v_kg),'Rate',private.specialist_money(v_ta.recovery_rate_per_kg)||' per kg','Recovery counted',private.specialist_money(v_amt));
        end if;
        v_warn:=v_warn||jsonb_build_array('This links an existing finance record. It does not create or change an invoice, payment or credit note.');
        v_title:='Link a finance record to the agreement'; v_effect:='Counts the linked amount in the die''s commercial position.';
        v_data:=jsonb_build_object('amount',v_amt,'calc',v_calc); v_src:=v_src||jsonb_build_object('avail',v_avail,'amt',v_amt);
      end if;
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.specialist_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.specialist_ctx_transfer(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_a text:=p_m->>'action'; v_tf public.stock_transfers; v_loc public.inventory_locations; v_sb public.profile_stock_batches; v_line public.stock_transfer_lines; v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb;
  v_title text; v_effect text; v_src jsonb:='{}'::jsonb; v_data jsonb:='{}'::jsonb; v_id text; v_ids text[]:='{}'; v_lines jsonb:='[]'::jsonb; v_kg numeric:=0; v_label text; v_state text; v_open integer; v_disp text; v_code text;
begin
  if v_a='transfer.request' then
    select * into v_loc from public.inventory_locations where id=private.specialist_uuid(p_m,'to_location_id') and company_id=p_company and dealer_id is null and is_active and location_type in ('factory','warehouse','branch');
    if v_loc.id is null then raise exception 'NOV: Choose an active factory, warehouse or branch location of this company.'; end if;
    if private.assurance_date(p_m,'planned_date')<private.ist_today() then raise exception 'NOV: The planned date cannot be in the past.'; end if;
    if jsonb_typeof(p_m->'batch_ids') is distinct from 'array' or jsonb_array_length(p_m->'batch_ids') not between 1 and 25 then raise exception 'NOV: Choose 1 to 25 bundles.'; end if;
    for v_id in select e from jsonb_array_elements_text(p_m->'batch_ids') t(e) loop
      if v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'NOV: Choose bundles from the search results.'; end if;
      if v_id=any(v_ids) then raise exception 'NOV: A bundle is listed twice.'; end if;
      v_ids:=v_ids||v_id;
      if p_lock then perform 1 from public.profile_stock_batches where id=v_id::uuid and company_id=p_company for update; end if;
      select * into v_sb from public.profile_stock_batches where id=v_id::uuid and company_id=p_company and dealer_id is null;
      if v_sb.id is null then raise exception 'NOV: A bundle is not stock of this company.'; end if;
      v_label:=coalesce(v_sb.bundle_number,left(v_sb.id::text,8));
      if v_sb.reserved_for_order_id is not null then raise exception 'NOV: Bundle % is reserved for an order. Release it before transferring.',v_label; end if;
      if v_sb.status<>'available' then raise exception 'NOV: Bundle % is % and cannot be transferred.',v_label,replace(v_sb.status,'_',' '); end if;
      if exists(select 1 from public.profile_stock_reservations r where r.company_id=p_company and r.profile_stock_batch_id=v_sb.id and r.status='active') then raise exception 'NOV: Bundle % is reserved for an order. Release the reservation first.',v_label; end if;
      if exists(select 1 from public.stock_transfer_lines l where l.company_id=p_company and l.batch_id=v_sb.id and l.state in ('requested','in_transit')) then raise exception 'NOV: Bundle % is already on another open transfer.',v_label; end if;
      if lower(btrim(coalesce(v_sb.location,'')))=lower(v_loc.location_name) then raise exception 'NOV: Bundle % is already at %.',v_label,v_loc.location_name; end if;
      if v_sb.qc_status not in ('released','not_required') then v_warn:=v_warn||jsonb_build_array(format('Bundle %s is on QC %s. It moves with that status; receipt does not clear it.',v_label,replace(v_sb.qc_status,'_',' '))); end if;
      v_kg:=v_kg+v_sb.total_weight_kg;
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object('batch_id',v_sb.id,'label',v_label,'profile_id',v_sb.profile_id,'pieces',v_sb.quantity_pieces,'kg',v_sb.total_weight_kg,'location',v_sb.location,'updated',v_sb.updated_at));
    end loop;
    v_warn:=v_warn||jsonb_build_array('Requesting holds the bundles for this transfer only. Stock moves when it is issued and arrives only when it is received.');
    v_title:='Request a warehouse transfer'; v_effect:='Records the exact bundles, the destination and the planned date.';
    v_facts:=jsonb_build_object('Destination',v_loc.location_name,'Bundles',jsonb_array_length(v_lines),'Total',private.specialist_kg(v_kg),'Planned',to_char((p_m->>'planned_date')::date,'DD Mon YYYY'));
    v_src:=jsonb_build_object('lines',md5(v_lines::text)); v_data:=jsonb_build_object('lines',v_lines,'destination',v_loc.location_name);
  elsif v_a='transfer.dispose' then
    if p_lock then perform 1 from public.stock_transfer_lines where id=private.specialist_uuid(p_m,'line_id') and company_id=p_company for update; end if;
    select * into v_line from public.stock_transfer_lines where id=private.specialist_uuid(p_m,'line_id') and company_id=p_company;
    if v_line.id is null then raise exception 'NOV: The transfer line is unavailable.'; end if;
    select * into v_tf from public.stock_transfers where id=v_line.transfer_id and company_id=p_company;
    if v_line.state<>'in_transit' then raise exception 'NOV: Only a bundle still in transit is dispositioned; this one is %.',replace(v_line.state,'_',' '); end if;
    if v_tf.issued_by=p_actor then raise exception 'NOV: The person who issued the transfer cannot also approve the disposition of its material.'; end if;
    v_disp:=private.specialist_choice(p_m,'disposition',array['damaged','returned_to_source','lost']);
    v_title:=case v_disp when 'damaged' then 'Record the bundle as received damaged' when 'returned_to_source' then 'Record the bundle as returned to source' else 'Record the bundle as lost in transit' end;
    v_effect:=case v_disp when 'damaged' then 'Places the bundle at the destination as rejected stock.' when 'returned_to_source' then 'Puts the bundle back at its source location as available stock.' else 'Writes the bundle off as lost. It never becomes free stock.' end;
    v_facts:=jsonb_build_object('Transfer',v_tf.transfer_number,'Bundle',v_line.bundle_label,'Weight',private.specialist_kg(v_line.weight_kg),'Source',coalesce(v_line.source_location,'not recorded'),'Destination',v_tf.destination);
    v_src:=jsonb_build_object('state',v_line.state);
  else
    if p_lock then perform 1 from public.stock_transfers where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_tf from public.stock_transfers where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_tf.id is null then raise exception 'NOV: The transfer is unavailable.'; end if;
    select count(*) filter (where state in ('requested','in_transit')) into v_open from public.stock_transfer_lines where company_id=p_company and transfer_id=v_tf.id;
    v_facts:=jsonb_build_object('Transfer',v_tf.transfer_number,'Destination',v_tf.destination,'Status',replace(v_tf.status,'_',' '),'Bundles still open',v_open);
    v_src:=jsonb_build_object('status',v_tf.status,'open',v_open);
    if v_a='transfer.issue' then
      if v_tf.status<>'requested' then raise exception 'NOV: Only a requested transfer is issued; this one is %.',replace(v_tf.status,'_',' '); end if;
      perform private.assurance_text(p_m,'transport_ref',1,60); if p_m ? 'gate_ref' then perform private.assurance_text(p_m,'gate_ref',1,60); end if;
      for v_line in select * from public.stock_transfer_lines where company_id=p_company and transfer_id=v_tf.id and state='requested' loop
        if p_lock then perform 1 from public.profile_stock_batches where id=v_line.batch_id and company_id=p_company for update; end if;
        select * into v_sb from public.profile_stock_batches where id=v_line.batch_id and company_id=p_company;
        if v_sb.status<>'available' or v_sb.reserved_for_order_id is not null or exists(select 1 from public.profile_stock_reservations r where r.company_id=p_company and r.profile_stock_batch_id=v_sb.id and r.status='active') then
          raise exception 'NOV: Bundle % is no longer available (%). Cancel the transfer and request it again.',v_line.bundle_label,replace(v_sb.status,'_',' '); end if;
      end loop;
      v_warn:=v_warn||jsonb_build_array('Issued bundles are in transit: not available at the source and not at the destination until received.');
      v_title:='Issue the transfer'; v_effect:='Moves every bundle on the transfer into the in-transit position.';
      v_facts:=v_facts||jsonb_build_object('Transport',btrim(p_m->>'transport_ref'),'Gate pass',coalesce(btrim(p_m->>'gate_ref'),'not recorded'));
    elsif v_a='transfer.receive' then
      if v_tf.status not in ('in_transit','partially_received') then raise exception 'NOV: Only an issued transfer is received.'; end if;
      v_code:=private.assurance_text(p_m,'bundle_label',1,60);
      if p_m ? 'condition_note' then perform private.assurance_text(p_m,'condition_note',2,200); end if;
      select * into v_line from public.stock_transfer_lines where company_id=p_company and transfer_id=v_tf.id and lower(bundle_label)=lower(v_code) and state='in_transit' limit 1;
      if v_line.id is null then
        select state into v_state from public.stock_transfer_lines where company_id=p_company and transfer_id=v_tf.id and lower(bundle_label)=lower(v_code) limit 1;
        if v_state is not null then raise exception 'NOV: Bundle % was already resolved on this transfer (%).',v_code,replace(v_state,'_',' '); end if;
        raise exception 'NOV: Bundle % is not on this transfer. Do not receive it here; check which transfer it belongs to.',v_code;
      end if;
      select * into v_sb from public.profile_stock_batches where id=v_line.batch_id and company_id=p_company;
      if v_sb.qc_status not in ('released','not_required') then v_warn:=v_warn||jsonb_build_array(format('Bundle %s stays on QC %s at the destination.',v_line.bundle_label,replace(v_sb.qc_status,'_',' '))); end if;
      v_title:='Receive a bundle at the destination'; v_effect:='Makes the bundle available at the destination. Its QC status is unchanged.';
      v_facts:=v_facts||jsonb_build_object('Bundle',v_line.bundle_label,'Weight',private.specialist_kg(v_line.weight_kg),'Condition note',coalesce(btrim(p_m->>'condition_note'),'none'));
      v_data:=jsonb_build_object('line_id',v_line.id); v_src:=v_src||jsonb_build_object('line',v_line.id);
    elsif v_a='transfer.cancel' then
      if v_tf.status in ('in_transit','partially_received','received') then raise exception 'NOV: Material has left the source. Receive each bundle or record it as returned to source.'; end if;
      if v_tf.status<>'requested' then raise exception 'NOV: A % transfer cannot be cancelled.',v_tf.status; end if;
      v_title:='Cancel the transfer'; v_effect:='Releases the bundles from this transfer. Nothing has moved.';
    else
      if v_tf.status<>'received' then raise exception 'NOV: Close a transfer once every bundle is received or dispositioned.'; end if;
      v_title:='Close the transfer'; v_effect:='Closes the transfer with the issued, received and dispositioned bundles reconciled.';
      v_facts:=v_facts||(select jsonb_build_object('Issued',count(*),'Received',count(*) filter (where state='received'),'Damaged',count(*) filter (where state='damaged'),
        'Returned to source',count(*) filter (where state='returned_to_source'),'Lost',count(*) filter (where state='lost')) from public.stock_transfer_lines where company_id=p_company and transfer_id=v_tf.id and state<>'cancelled');
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.specialist_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.specialist_ctx_treatment(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_a text:=p_m->>'action'; v_rec public.treatment_recipes; v_tb public.treatment_batches; v_mc public.machines; v_job public.production_jobs; v_pf public.aluminium_profiles; v_in public.treatment_inputs;
  v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb; v_title text; v_effect text; v_src jsonb:='{}'::jsonb; v_data jsonb:='{}'::jsonb; v_el jsonb; v_alloys text[]:='{}'; v_jobs uuid[]:='{}'; v_inputs jsonb:='[]'::jsonb;
  v_kg numeric; v_avail numeric; v_total numeric:=0; v_ax jsonb; v_acc numeric:=0; v_ret numeric:=0; v_rej numeric:=0; v_seen uuid[]:='{}'; v_n integer; v_temp numeric; v_status text; v_next public.treatment_recipes; v_dev integer;
begin
  if v_a='recipe.define' then
    if (p_m->>'recipe_code') !~ '^[a-z0-9_]{3,30}$' then raise exception 'NOV: Use 3 to 30 lowercase letters, digits or underscores for the recipe code.'; end if;
    if exists(select 1 from public.treatment_recipes where company_id=p_company and recipe_code=p_m->>'recipe_code' and status='draft') then raise exception 'NOV: A draft revision of this recipe is already waiting for approval.'; end if;
    perform private.assurance_text(p_m,'name',3,80); perform private.specialist_choice(p_m,'process',array['artificial_ageing','solution_treatment','homogenising']); perform private.assurance_text(p_m,'target_temper',1,10);
    if jsonb_typeof(p_m->'alloys') is distinct from 'array' or jsonb_array_length(p_m->'alloys') not between 1 and 10 then raise exception 'NOV: List 1 to 10 compatible alloys.'; end if;
    for v_el in select e from jsonb_array_elements(p_m->'alloys') t(e) loop
      if jsonb_typeof(v_el) is distinct from 'string' or length(btrim(v_el#>>'{}')) not between 1 and 20 then raise exception 'NOV: Each alloy is 1 to 20 characters.'; end if;
      if upper(btrim(v_el#>>'{}'))=any(v_alloys) then raise exception 'NOV: Alloy % is listed twice.',upper(btrim(v_el#>>'{}')); end if;
      v_alloys:=v_alloys||upper(btrim(v_el#>>'{}'));
    end loop;
    if private.assurance_number(p_m,'temp_max_c',20,700,1)<=private.assurance_number(p_m,'temp_min_c',20,700,1) then raise exception 'NOV: The maximum temperature must be above the minimum.'; end if;
    if private.assurance_number(p_m,'soak_max_minutes',1,2880,0)<private.assurance_number(p_m,'soak_min_minutes',1,2880,0) then raise exception 'NOV: The maximum cycle time cannot be below the minimum.'; end if;
    perform private.assurance_number(p_m,'min_readings',1,100,0);
    v_warn:=v_warn||jsonb_build_array('Recipe values are targets set by the technical owner. They never become recorded readings.');
    v_title:='Define a treatment recipe revision'; v_effect:='Creates a draft revision. A second person from quality approves it before batches can use it.';
    v_facts:=jsonb_build_object('Recipe',p_m->>'recipe_code','Process',replace(p_m->>'process','_',' '),'Alloys',array_to_string(v_alloys,', '),'Temperature',(p_m->>'temp_min_c')||' to '||(p_m->>'temp_max_c')||' °C',
      'Cycle',(p_m->>'soak_min_minutes')||' to '||(p_m->>'soak_max_minutes')||' min','Readings required',p_m->>'min_readings','Target temper',btrim(p_m->>'target_temper'));
    v_data:=jsonb_build_object('alloys',to_jsonb(v_alloys));
  elsif v_a='recipe.approve' then
    if p_lock then perform 1 from public.treatment_recipes where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_rec from public.treatment_recipes where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_rec.id is null or v_rec.status<>'draft' then raise exception 'NOV: Only a draft recipe revision is approved.'; end if;
    if v_rec.created_by=p_actor then raise exception 'NOV: The person who defined the recipe cannot approve it.'; end if;
    v_warn:=v_warn||jsonb_build_array('Batches already loaded keep the revision they were loaded with.');
    v_title:='Approve the recipe revision'; v_effect:='Makes this revision the one new batches use; the earlier revision is superseded and kept.';
    v_facts:=jsonb_build_object('Recipe',v_rec.recipe_code||' rev '||v_rec.revision,'Alloys',array_to_string(v_rec.alloys,', ')); v_src:=jsonb_build_object('status',v_rec.status);
  elsif v_a='treat.create' then
    select * into v_rec from public.treatment_recipes where id=private.specialist_uuid(p_m,'recipe_id') and company_id=p_company;
    if v_rec.id is null or v_rec.status<>'approved' then raise exception 'NOV: Choose an approved recipe revision.'; end if;
    select * into v_mc from public.machines where id=private.specialist_uuid(p_m,'machine_id') and company_id=p_company;
    if v_mc.id is null or v_mc.machine_type<>'aging_oven' then raise exception 'NOV: Choose an ageing oven of this company.'; end if;
    if not v_mc.is_active or v_mc.status not in ('active','operational','idle') then raise exception 'NOV: The oven is not available (%).',v_mc.status; end if;
    perform private.assurance_text(p_m,'load_note',5,300);
    if jsonb_typeof(p_m->'inputs') is distinct from 'array' or jsonb_array_length(p_m->'inputs') not between 1 and 20 then raise exception 'NOV: Add 1 to 20 input jobs.'; end if;
    for v_el in select e from jsonb_array_elements(p_m->'inputs') t(e) loop
      if jsonb_typeof(v_el) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_el) k where k not in ('job_id','kg')) then raise exception 'NOV: Each input needs a production job and kilograms.'; end if;
      if p_lock then perform 1 from public.production_jobs where id=private.specialist_uuid(v_el,'job_id') and company_id=p_company for update; end if;
      select * into v_job from public.production_jobs where id=private.specialist_uuid(v_el,'job_id') and company_id=p_company;
      if v_job.id is null then raise exception 'NOV: Choose production jobs of this company.'; end if;
      if v_job.id=any(v_jobs) then raise exception 'NOV: Job % is listed twice.',v_job.job_number; end if;
      v_jobs:=v_jobs||v_job.id;
      if v_job.status not in ('in_progress','completed') then raise exception 'NOV: Job % is % and has no extruded output to treat.',v_job.job_number,v_job.status; end if;
      select * into v_pf from public.aluminium_profiles where id=v_job.profile_id and company_id=p_company;
      if v_pf.alloy is null then raise exception 'NOV: Profile % has no alloy recorded, so compatibility cannot be checked.',v_pf.profile_code; end if;
      if not (upper(btrim(v_pf.alloy))=any(v_rec.alloys)) then raise exception 'NOV: Job % is alloy %; recipe % allows %. Incompatible material cannot share the batch.',v_job.job_number,v_pf.alloy,v_rec.recipe_code,array_to_string(v_rec.alloys,', '); end if;
      v_kg:=private.assurance_number(v_el,'kg',0.001,1000000,3);
      if v_job.actual_quantity_kg<=0 then raise exception 'NOV: Job % has no recorded output.',v_job.job_number; end if;
      select v_job.actual_quantity_kg-coalesce(sum(ti.quantity_kg),0) into v_avail from public.treatment_inputs ti join public.treatment_batches b on b.id=ti.batch_id and b.company_id=ti.company_id
        where ti.company_id=p_company and ti.production_job_id=v_job.id and b.retreatment_of is null;
      if v_kg>v_avail then raise exception 'NOV: Only % of job % is not already in a treatment batch.',private.specialist_kg(greatest(v_avail,0)),v_job.job_number; end if;
      v_total:=v_total+v_kg;
      v_inputs:=v_inputs||jsonb_build_array(jsonb_build_object('job_id',v_job.id,'kg',v_kg,'profile_id',v_pf.id,'alloy',v_pf.alloy,'temper',v_pf.temper,'job_number',v_job.job_number,'actual',v_job.actual_quantity_kg));
    end loop;
    v_warn:=v_warn||jsonb_build_array('Loading records exact inputs only. Readings are entered as they are taken; the recipe never fills them in.');
    v_title:='Load a treatment batch'; v_effect:='Records the batch with its recipe revision, oven, inputs and loading arrangement.';
    v_facts:=jsonb_build_object('Recipe',v_rec.recipe_code||' rev '||v_rec.revision,'Oven',v_mc.machine_name,'Inputs',jsonb_array_length(v_inputs),'Total',private.specialist_kg(v_total),'Loading',btrim(p_m->>'load_note'));
    v_src:=jsonb_build_object('inputs',md5(v_inputs::text),'recipe',v_rec.status,'oven',v_mc.status); v_data:=jsonb_build_object('inputs',v_inputs);
  else
    if p_lock then perform 1 from public.treatment_batches where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_tb from public.treatment_batches where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_tb.id is null then raise exception 'NOV: The batch is unavailable.'; end if;
    select * into v_rec from public.treatment_recipes where id=v_tb.recipe_id and company_id=p_company;
    select * into v_mc from public.machines where id=v_tb.machine_id and company_id=p_company;
    v_ax:=private.treatment_assess(p_company,v_tb.id);
    v_facts:=jsonb_build_object('Batch',v_tb.batch_number,'Recipe',v_rec.recipe_code||' rev '||v_rec.revision,'Oven',v_mc.machine_name,'Readings',(v_ax->>'readings')||' of '||(v_ax->>'required_readings'));
    v_src:=jsonb_build_object('status',v_tb.status,'ax',v_ax);
    if v_a='treat.start' then
      if v_tb.status<>'loaded' then raise exception 'NOV: Only a loaded batch is started.'; end if;
      if not (v_ax->>'equipment_in_service')::boolean then raise exception 'NOV: The oven was withdrawn from service (%). Unload or move the batch.',v_mc.status; end if;
      v_title:='Start the cycle'; v_effect:='Records the actual start time.';
    elsif v_a='treat.observe' then
      if v_tb.status<>'running' then raise exception 'NOV: Readings are recorded while the cycle is running.'; end if;
      v_temp:=private.assurance_number(p_m,'temperature_c',0,800,1); perform private.assurance_text(p_m,'instrument_ref',2,60);
      if p_m ? 'reading_note' then perform private.assurance_text(p_m,'reading_note',1,200); end if;
      if v_temp not between v_rec.temp_min_c and v_rec.temp_max_c then v_warn:=v_warn||jsonb_build_array(format('%s °C is outside the recipe range %s to %s °C. It is recorded as read.',trim_scale(v_temp),trim_scale(v_rec.temp_min_c),trim_scale(v_rec.temp_max_c))); end if;
      if not (v_ax->>'equipment_in_service')::boolean then v_warn:=v_warn||jsonb_build_array('The oven is recorded as out of service.'); end if;
      v_title:='Record a temperature reading'; v_effect:='Adds an actual reading with the instrument used. Readings cannot be edited.';
      v_facts:=v_facts||jsonb_build_object('Temperature',trim_scale(v_temp)||' °C','Instrument',btrim(p_m->>'instrument_ref'));
    elsif v_a='treat.end' then
      if v_tb.status<>'running' then raise exception 'NOV: Only a running cycle is ended.'; end if;
      if private.specialist_bool(p_m,'interrupted') then v_warn:=v_warn||jsonb_build_array('An interrupted cycle needs an explicit deviation decision before any material is accepted.'); end if;
      if not (v_ax->>'readings_ok')::boolean then v_warn:=v_warn||jsonb_build_array(format('Only %s of %s required readings are recorded. Material cannot be accepted without them.',v_ax->>'readings',v_ax->>'required_readings')); end if;
      v_title:=case when (p_m->>'interrupted')::boolean then 'Record the cycle as interrupted' else 'End the cycle' end; v_effect:='Records the actual end time and unloading. Review decides acceptance.';
    else
      if v_tb.status not in ('ended','interrupted') then raise exception 'NOV: Review a batch after its cycle has ended.'; end if;
      if jsonb_typeof(p_m->'outcomes') is distinct from 'array' then raise exception 'NOV: Enter the outcome for every input.'; end if;
      select count(*) into v_n from public.treatment_inputs where company_id=p_company and batch_id=v_tb.id;
      if jsonb_array_length(p_m->'outcomes')<>v_n then raise exception 'NOV: Enter one outcome for each of the % input(s).',v_n; end if;
      for v_el in select e from jsonb_array_elements(p_m->'outcomes') t(e) loop
        if jsonb_typeof(v_el) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_el) k where k not in ('input_id','accepted_kg','rejected_kg','retreat_kg')) then raise exception 'NOV: Each outcome has accepted, rejected and retreatment kilograms.'; end if;
        select * into v_in from public.treatment_inputs where id=private.specialist_uuid(v_el,'input_id') and company_id=p_company and batch_id=v_tb.id;
        if v_in.id is null or v_in.id=any(v_seen) then raise exception 'NOV: Each outcome must name a different input of this batch.'; end if;
        v_seen:=v_seen||v_in.id;
        if private.assurance_number(v_el,'accepted_kg',0,1000000,3)+private.assurance_number(v_el,'rejected_kg',0,1000000,3)+private.assurance_number(v_el,'retreat_kg',0,1000000,3)<>v_in.quantity_kg then
          raise exception 'NOV: Accepted, rejected and retreatment kilograms must add up to the % loaded for each input.',private.specialist_kg(v_in.quantity_kg); end if;
        v_acc:=v_acc+(v_el->>'accepted_kg')::numeric; v_rej:=v_rej+(v_el->>'rejected_kg')::numeric; v_ret:=v_ret+(v_el->>'retreat_kg')::numeric;
      end loop;
      v_dev:=jsonb_array_length(v_ax->'deviations')-case when (v_ax->>'readings_ok')::boolean then 0 else 1 end;
      if v_acc>0 and not (v_ax->>'readings_ok')::boolean then raise exception 'NOV: % of % required readings are recorded. No material can be accepted; reject it or send it for retreatment.',v_ax->>'readings',v_ax->>'required_readings'; end if;
      if private.specialist_bool(p_m,'accept_deviation') then
        if v_dev=0 then raise exception 'NOV: There is no deviation to accept.'; end if;
        if v_acc=0 then raise exception 'NOV: A deviation is accepted only when material is accepted.'; end if;
        v_warn:=v_warn||jsonb_build_array('You accept the recorded deviations for the accepted material. The decision and its reason are kept with the batch.');
      elsif v_acc>0 and v_dev>0 then raise exception 'NOV: Deviations are recorded (%). Accepting material needs an explicit deviation acceptance.',(select string_agg(e#>>'{}',' ') from jsonb_array_elements(v_ax->'deviations') t(e)); end if;
      if v_ret>0 then
        select * into v_next from public.treatment_recipes where company_id=p_company and recipe_code=v_rec.recipe_code and status='approved';
        if v_next.id is null then raise exception 'NOV: No approved revision of % exists for the retreatment batch.',v_rec.recipe_code; end if;
        v_warn:=v_warn||jsonb_build_array(format('A retreatment batch of %s is loaded with %s rev %s. This batch and its readings are kept.',private.specialist_kg(v_ret),v_next.recipe_code,v_next.revision));
      end if;
      v_warn:=v_warn||(v_ax->'deviations')||jsonb_build_array('This is the treatment review. Mechanical or hardness tests still follow the quality plan.');
      v_status:=case when v_acc>0 and v_rej=0 and v_ret=0 then 'released' when v_acc>0 then 'partially_released' when v_ret>0 then 'retreatment' else 'rejected' end;
      v_title:='Review the treatment batch'; v_effect:='Records the technical decision for each input and carries it to the jobs it came from.';
      v_facts:=v_facts||jsonb_build_object('Accepted',private.specialist_kg(v_acc),'Rejected',private.specialist_kg(v_rej),'For retreatment',private.specialist_kg(v_ret),'Result',replace(v_status,'_',' '));
      v_data:=jsonb_build_object('status',v_status,'next_recipe',v_next.id,'assessment',v_ax);
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.specialist_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.specialist_ctx_toll(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_a text:=p_m->>'action'; v_ag public.toll_agreements; v_cust public.customers; v_tr public.toll_receipts; v_mv public.toll_movements; v_job public.production_jobs; v_od public.orders; v_st public.toll_statements;
  v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb; v_title text; v_effect text; v_src jsonb:='{}'::jsonb; v_data jsonb:='{}'::jsonb; v_pos jsonb; v_kind text; v_qty numeric; v_avail numeric; v_job_row jsonb;
  v_since timestamptz; v_basis_kg numeric; v_model jsonb; v_rev integer; v_cust_id uuid;
begin
  if v_a in ('toll.define','toll.receive','toll.move','toll.statement') then
    if p_lock then perform 1 from public.customers where id=private.specialist_uuid(p_m,'customer_id') and company_id=p_company for update; end if;
    select * into v_cust from public.customers where id=private.specialist_uuid(p_m,'customer_id') and company_id=p_company and deleted_at is null;
    if v_cust.id is null then raise exception 'NOV: Choose a customer of this company.'; end if;
    select * into v_ag from public.toll_agreements where company_id=p_company and customer_id=v_cust.id and status='approved';
    if v_a<>'toll.define' and v_ag.id is null then raise exception 'NOV: % has no approved job-work agreement.',v_cust.customer_name; end if;
    v_pos:=private.toll_position(p_company,v_cust.id);
    v_src:=jsonb_build_object('pos',md5(v_pos::text),'agreement',v_ag.id);
  end if;
  if v_a='toll.define' then
    if exists(select 1 from public.toll_agreements where company_id=p_company and customer_id=v_cust.id and status='draft') then raise exception 'NOV: A draft agreement for this customer is already waiting for approval.'; end if;
    perform private.assurance_text(p_m,'material_spec',3,120); perform private.assurance_text(p_m,'alloy',1,40); perform private.specialist_bool(p_m,'permitted_mixing');
    perform private.assurance_number(p_m,'conversion_rate_per_kg',0.01,1000000,2); perform private.specialist_choice(p_m,'billing_basis',array['output_kg','input_kg']);
    if p_m ? 'allowed_loss_percent' then perform private.assurance_number(p_m,'allowed_loss_percent',0,10,2);
    else v_warn:=v_warn||jsonb_build_array('No loss allowance is agreed: every difference stays open until it is settled.'); end if;
    select coalesce(max(revision),0)+1 into v_rev from public.toll_agreements where company_id=p_company and customer_id=v_cust.id;
    if v_ag.id is not null then v_warn:=v_warn||jsonb_build_array(format('Approval supersedes revision %s. Statements keep the revision they applied.',v_ag.revision)); end if;
    v_warn:=v_warn||jsonb_build_array('Agreement interpretation, tax and accounting treatment need authorised review. Loss percentages are never assumed.');
    v_title:='Define a job-work agreement'; v_effect:='Creates a draft agreement revision. A second person approves it before customer metal is received.';
    v_facts:=jsonb_build_object('Customer',v_cust.customer_name,'Revision',v_rev,'Material',btrim(p_m->>'material_spec'),'Alloy',btrim(p_m->>'alloy'),'Mixing with company metal',case when (p_m->>'permitted_mixing')::boolean then 'Authorised' else 'Not authorised' end,
      'Loss allowance',coalesce((p_m->>'allowed_loss_percent')||'%','None agreed'),'Conversion',private.specialist_money((p_m->>'conversion_rate_per_kg')::numeric)||' per kg of '||replace(p_m->>'billing_basis','_',' '));
    v_data:=jsonb_build_object('revision',v_rev);
  elsif v_a='toll.receive' then
    v_qty:=private.assurance_number(p_m,'received_kg',0.001,10000000,3); perform private.assurance_text(p_m,'challan_ref',1,60); perform private.assurance_text(p_m,'location',2,60);
    if p_m ? 'heat_ref' then perform private.assurance_text(p_m,'heat_ref',1,60); end if;
    if p_m ? 'alloy' then perform private.assurance_text(p_m,'alloy',1,40);
      if upper(btrim(p_m->>'alloy'))<>upper(v_ag.alloy) then v_warn:=v_warn||jsonb_build_array(format('The agreement is for alloy %s; this receipt is %s. Quality decides whether it is accepted.',v_ag.alloy,btrim(p_m->>'alloy'))); end if; end if;
    if exists(select 1 from public.toll_receipts where company_id=p_company and customer_id=v_cust.id and lower(challan_ref)=lower(btrim(p_m->>'challan_ref'))) then raise exception 'NOV: Challan % is already received for this customer.',btrim(p_m->>'challan_ref'); end if;
    v_warn:=v_warn||jsonb_build_array('Recorded as customer-owned material in its own account. It is never added to company billet stock.','It cannot be issued until quality accepts it.');
    v_title:='Receive customer-owned metal'; v_effect:='Records the receipt in the customer''s metal account, pending inspection.';
    v_facts:=jsonb_build_object('Customer',v_cust.customer_name,'Received',private.specialist_kg(v_qty),'Challan',btrim(p_m->>'challan_ref'),'Heat',coalesce(btrim(p_m->>'heat_ref'),'not stated'),'Location',btrim(p_m->>'location'));
  elsif v_a='toll.move' then
    v_kind:=private.specialist_choice(p_m,'kind',array['issue','output','scrap','explained_loss','return_metal','return_scrap']); v_qty:=private.assurance_number(p_m,'quantity_kg',0.001,10000000,3);
    if p_m ? 'reference' then perform private.assurance_text(p_m,'reference',1,60); end if;
    if (v_kind in ('issue','return_metal'))<>(p_m ? 'receipt_id') or (v_kind in ('issue','output','scrap','explained_loss'))<>(p_m ? 'production_job_id') then
      raise exception 'NOV: %',case v_kind when 'issue' then 'An issue names the receipt and the production job.' when 'return_metal' then 'A metal return names the receipt only.' when 'return_scrap' then 'A scrap return names neither a receipt nor a job.' else 'Output, scrap and explained loss name the production job only.' end; end if;
    if p_m ? 'receipt_id' then
      if p_lock then perform 1 from public.toll_receipts where id=private.specialist_uuid(p_m,'receipt_id') and company_id=p_company for update; end if;
      select * into v_tr from public.toll_receipts where id=private.specialist_uuid(p_m,'receipt_id') and company_id=p_company and customer_id=v_cust.id;
      if v_tr.id is null then raise exception 'NOV: Choose a receipt of this customer''s metal.'; end if;
    end if;
    if p_m ? 'production_job_id' then
      select * into v_job from public.production_jobs where id=private.specialist_uuid(p_m,'production_job_id') and company_id=p_company;
      if v_job.id is null then raise exception 'NOV: Choose a production job of this company.'; end if;
      select * into v_od from public.orders where id=v_job.order_id and company_id=p_company;
      if v_od.customer_id<>v_cust.id then raise exception 'NOV: Job % is for another customer''s order. Never use one customer''s material for another''s job, even when the alloy matches.',v_job.job_number; end if;
      select e into v_job_row from jsonb_array_elements(v_pos->'jobs') t(e) where e->>'job_id'=v_job.id::text;
    end if;
    if v_kind='issue' then
      if v_tr.quality_status='pending' then raise exception 'NOV: Quality has not inspected receipt % yet.',v_tr.receipt_number; end if;
      if v_tr.quality_status='rejected' then raise exception 'NOV: Receipt % was rejected. Rejected material can only be returned.',v_tr.receipt_number; end if;
      select (e->>'usable_kg')::numeric into v_avail from jsonb_array_elements(v_pos->'receipts') t(e) where e->>'receipt_id'=v_tr.id::text;
      if v_qty>v_avail then raise exception 'NOV: Only % of receipt % is usable.',private.specialist_kg(v_avail),v_tr.receipt_number; end if;
      if v_job.status not in ('planned','ready','in_progress') then raise exception 'NOV: Job % is % and cannot take more material.',v_job.job_number,v_job.status; end if;
      if v_od.billets_allocated>0 then
        if not v_ag.permitted_mixing then raise exception 'NOV: Order % already has company billets allocated. This agreement does not authorise mixing customer metal with company metal.',v_od.order_number; end if;
        v_warn:=v_warn||jsonb_build_array('The order also uses company billets. The agreement authorises mixing; quantities stay in separate accounts.');
      end if;
      v_title:='Issue customer metal to a job'; v_effect:='Moves the quantity from the customer''s usable balance into the job.';
    elsif v_kind in ('output','scrap','explained_loss') then
      if v_job_row is null then raise exception 'NOV: No metal of this customer was issued to job %.',v_job.job_number; end if;
      if v_qty>(v_job_row->>'in_process_kg')::numeric then raise exception 'NOV: Only % issued to job % is not yet accounted for.',private.specialist_kg((v_job_row->>'in_process_kg')::numeric),v_job.job_number; end if;
      if v_kind='explained_loss' then
        if v_ag.allowed_loss_percent is null then raise exception 'NOV: No loss allowance is agreed. Leave the difference open for the statement.'; end if;
        if (v_job_row->>'explained_loss_kg')::numeric+v_qty>(v_job_row->>'allowed_loss_kg')::numeric then
          raise exception 'NOV: The agreed allowance for job % is %; % is already explained. The rest stays an unexplained difference.',v_job.job_number,private.specialist_kg((v_job_row->>'allowed_loss_kg')::numeric),private.specialist_kg((v_job_row->>'explained_loss_kg')::numeric); end if;
      end if;
      v_title:=case v_kind when 'output' then 'Record good output from customer metal' when 'scrap' then 'Record process scrap from customer metal' else 'Record a loss within the agreed allowance' end;
      v_effect:='Accounts for part of the metal issued to the job. Ownership stays with the customer.';
    elsif v_kind='return_metal' then
      select (e->>'returnable_kg')::numeric into v_avail from jsonb_array_elements(v_pos->'receipts') t(e) where e->>'receipt_id'=v_tr.id::text;
      if v_qty>v_avail then raise exception 'NOV: Only % of receipt % can be returned.',private.specialist_kg(v_avail),v_tr.receipt_number; end if;
      v_title:='Return metal to the customer'; v_effect:='Reduces the receipt by the returned quantity.';
    else
      if v_qty>(v_pos->'totals'->>'scrap_on_hand_kg')::numeric then raise exception 'NOV: Only % of this customer''s scrap is held.',private.specialist_kg((v_pos->'totals'->>'scrap_on_hand_kg')::numeric); end if;
      v_title:='Return scrap to the customer'; v_effect:='Reduces the customer''s scrap held.';
    end if;
    v_facts:=jsonb_build_object('Customer',v_cust.customer_name,'Movement',replace(v_kind,'_',' '),'Quantity',private.specialist_kg(v_qty),'Receipt',v_tr.receipt_number,'Job',v_job.job_number,'Order',v_od.order_number);
    v_src:=v_src||jsonb_build_object('receipt',v_tr.quality_status,'job',v_job.status);
  elsif v_a='toll.statement' then
    select max(as_of) into v_since from public.toll_statements where company_id=p_company and customer_id=v_cust.id and status='agreed';
    select coalesce(sum(quantity_kg),0) into v_basis_kg from public.toll_movements where company_id=p_company and customer_id=v_cust.id and status='active'
      and kind=case v_ag.billing_basis when 'output_kg' then 'output' else 'issue' end and (v_since is null or recorded_at>v_since);
    v_model:=jsonb_build_object('agreement',v_pos->'agreement','totals',v_pos->'totals','receipts',v_pos->'receipts','jobs',v_pos->'jobs','since',v_since,'charge_basis',v_ag.billing_basis,
      'charge_basis_kg',v_basis_kg,'conversion_rate_per_kg',v_ag.conversion_rate_per_kg,'conversion_charge_draft',round(v_basis_kg*v_ag.conversion_rate_per_kg,2));
    if (v_pos->'totals'->>'unexplained_kg')::numeric>0 then v_warn:=v_warn||jsonb_build_array(format('%s of completed jobs is unexplained. It stays a difference for review; it is not absorbed.',private.specialist_kg((v_pos->'totals'->>'unexplained_kg')::numeric))); end if;
    if (v_pos->'totals'->>'received_pending_kg')::numeric>0 then v_warn:=v_warn||jsonb_build_array('Some receipts are still pending inspection.'); end if;
    v_warn:=v_warn||jsonb_build_array('The statement and conversion charge are drafts for review with the customer. No invoice is created.');
    v_title:='Prepare a material statement'; v_effect:='Records the account as of now with the agreement revision applied and a conversion-charge draft.';
    v_facts:=jsonb_build_object('Customer',v_cust.customer_name,'Agreement revision',v_ag.revision,'Usable',private.specialist_kg((v_pos->'totals'->>'usable_kg')::numeric),
      'Issued',private.specialist_kg((v_pos->'totals'->>'issued_kg')::numeric),'Output',private.specialist_kg((v_pos->'totals'->>'output_kg')::numeric),'Unexplained',private.specialist_kg((v_pos->'totals'->>'unexplained_kg')::numeric),
      'Charge basis',private.specialist_kg(v_basis_kg)||' of '||replace(v_ag.billing_basis,'_',' ')||coalesce(' since '||to_char(v_since at time zone 'Asia/Kolkata','DD Mon YYYY'),''),'Conversion charge draft',private.specialist_money(round(v_basis_kg*v_ag.conversion_rate_per_kg,2)));
    v_data:=jsonb_build_object('model',v_model);
  elsif v_a in ('toll.approve') then
    if p_lock then perform 1 from public.toll_agreements where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_ag from public.toll_agreements where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_ag.id is null or v_ag.status<>'draft' then raise exception 'NOV: Only a draft agreement is approved.'; end if;
    if v_ag.created_by=p_actor then raise exception 'NOV: The person who defined the agreement cannot approve it.'; end if;
    v_title:='Approve the job-work agreement'; v_effect:='Makes this revision the one receipts, statements and charges use.';
    v_facts:=jsonb_build_object('Revision',v_ag.revision,'Loss allowance',coalesce(trim_scale(v_ag.allowed_loss_percent)||'%','None agreed'),'Mixing',case when v_ag.permitted_mixing then 'Authorised' else 'Not authorised' end);
    v_src:=jsonb_build_object('status',v_ag.status); v_cust_id:=v_ag.customer_id;
  elsif v_a='toll.inspect' then
    if p_lock then perform 1 from public.toll_receipts where id=private.specialist_uuid(p_m,'receipt_id') and company_id=p_company for update; end if;
    select * into v_tr from public.toll_receipts where id=private.specialist_uuid(p_m,'receipt_id') and company_id=p_company;
    if v_tr.id is null then raise exception 'NOV: The receipt is unavailable.'; end if;
    if v_tr.quality_status<>'pending' then raise exception 'NOV: Receipt % was already inspected (%).',v_tr.receipt_number,v_tr.quality_status; end if;
    perform private.specialist_choice(p_m,'decision',array['accepted','rejected']);
    v_title:=case p_m->>'decision' when 'accepted' then 'Accept the customer metal' else 'Reject the customer metal' end;
    v_effect:=case p_m->>'decision' when 'accepted' then 'Makes the receipt usable for this customer''s jobs only.' else 'Keeps the receipt in the account for return only.' end;
    v_facts:=jsonb_build_object('Receipt',v_tr.receipt_number,'Challan',v_tr.challan_ref,'Received',private.specialist_kg(v_tr.received_kg),'Alloy',v_tr.alloy);
    v_src:=jsonb_build_object('status',v_tr.quality_status);
  elsif v_a='toll.reverse' then
    if p_lock then perform 1 from public.toll_movements where id=private.specialist_uuid(p_m,'movement_id') and company_id=p_company for update; end if;
    select * into v_mv from public.toll_movements where id=private.specialist_uuid(p_m,'movement_id') and company_id=p_company;
    if v_mv.id is null or v_mv.status<>'active' then raise exception 'NOV: Choose a movement that is still counted.'; end if;
    if v_mv.kind='issue' then
      v_pos:=private.toll_position(p_company,v_mv.customer_id);
      select e into v_job_row from jsonb_array_elements(v_pos->'jobs') t(e) where e->>'job_id'=v_mv.production_job_id::text;
      if (v_job_row->>'in_process_kg')::numeric<v_mv.quantity_kg then raise exception 'NOV: Output, scrap or loss already recorded for the job depends on this issue. Reverse those first.'; end if;
    elsif v_mv.kind='return_scrap' or v_mv.kind='return_metal' then null;
    end if;
    v_title:='Reverse the movement'; v_effect:='Stops counting the movement. It stays in the account history with the reason.';
    v_facts:=jsonb_build_object('Movement',replace(v_mv.kind,'_',' '),'Quantity',private.specialist_kg(v_mv.quantity_kg),'Recorded',to_char(v_mv.recorded_at at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI'));
    v_src:=jsonb_build_object('status',v_mv.status);
  else
    if p_lock then perform 1 from public.toll_statements where id=private.specialist_uuid(p_m,'statement_id') and company_id=p_company for update; end if;
    select * into v_st from public.toll_statements where id=private.specialist_uuid(p_m,'statement_id') and company_id=p_company;
    if v_st.id is null or v_st.status not in ('draft','disputed') then raise exception 'NOV: Only a draft or disputed statement is settled.'; end if;
    if exists(select 1 from public.toll_statements where company_id=p_company and customer_id=v_st.customer_id and as_of>v_st.as_of and status<>'replaced') then raise exception 'NOV: A newer statement exists. Settle the latest one.'; end if;
    perform private.specialist_choice(p_m,'decision',array['agree','dispute']);
    if p_m->>'decision'='agree' and (v_st.model->'totals'->>'unexplained_kg')::numeric>0 then
      v_warn:=v_warn||jsonb_build_array(format('You agree an unexplained difference of %s as stated.',private.specialist_kg((v_st.model->'totals'->>'unexplained_kg')::numeric))); end if;
    v_title:=case p_m->>'decision' when 'agree' then 'Agree the statement' else 'Record a dispute' end;
    v_effect:=case p_m->>'decision' when 'agree' then 'Records the statement as agreed with the customer. The next charge basis starts after it.' else 'Keeps the statement open as disputed. Corrections are made through reversals and new movements.' end;
    v_facts:=jsonb_build_object('Statement',v_st.statement_number,'Conversion charge draft',private.specialist_money((v_st.model->>'conversion_charge_draft')::numeric),'Unexplained',private.specialist_kg((v_st.model->'totals'->>'unexplained_kg')::numeric));
    v_src:=jsonb_build_object('status',v_st.status);
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.specialist_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.specialist_reg(p_text text) returns text language sql immutable set search_path=public,private as $$
  select upper(regexp_replace(coalesce(p_text,''),'[^A-Za-z0-9]','','g'))
$$;
create function private.specialist_ctx_weigh(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_a text:=p_m->>'action'; v_ws public.weighing_sessions; v_dp public.dispatches; v_pr public.purchase_receipts; v_vh public.factory_vehicles; v_gr public.weighing_readings; v_tr public.weighing_readings;
  v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb; v_title text; v_effect text; v_src jsonb:='{}'::jsonb; v_data jsonb:='{}'::jsonb; v_kind text; v_reg text; v_val numeric; v_kg numeric; v_at timestamptz;
  v_live text; v_exp jsonb; v_net numeric; v_diff numeric; v_reversed boolean; v_today date:=private.ist_today();
begin
  if v_a='weigh.open' then
    v_kind:=private.specialist_choice(p_m,'movement_kind',array['dispatch','purchase_receipt']);
    if (v_kind='dispatch')<>(p_m ? 'dispatch_id') or (v_kind='purchase_receipt')<>(p_m ? 'purchase_receipt_id') then raise exception 'NOV: Choose the dispatch or the purchase receipt being weighed.'; end if;
    if v_kind='dispatch' then
      select * into v_dp from public.dispatches where id=private.specialist_uuid(p_m,'dispatch_id') and company_id=p_company;
      if v_dp.id is null then raise exception 'NOV: Choose a dispatch of this company.'; end if;
      select session_number into v_live from public.weighing_sessions where company_id=p_company and dispatch_id=v_dp.id and status in ('open','paired','finalized');
    else
      select * into v_pr from public.purchase_receipts where id=private.specialist_uuid(p_m,'purchase_receipt_id') and company_id=p_company;
      if v_pr.id is null then raise exception 'NOV: Choose a purchase receipt of this company.'; end if;
      select session_number into v_live from public.weighing_sessions where company_id=p_company and purchase_receipt_id=v_pr.id and status in ('open','paired','finalized');
    end if;
    if v_live is not null then raise exception 'NOV: Weighing % already covers this movement. Supersede it to correct it.',v_live; end if;
    v_reg:=private.specialist_reg(p_m->>'vehicle_registration');
    if v_reg !~ '^[A-Z0-9]{4,15}$' then raise exception 'NOV: Enter the vehicle registration (4 to 15 letters and digits).'; end if;
    if p_m ? 'vehicle_id' then
      select * into v_vh from public.factory_vehicles where id=private.specialist_uuid(p_m,'vehicle_id') and company_id=p_company and is_active;
      if v_vh.id is null then raise exception 'NOV: Choose an active vehicle of this company.'; end if;
      if private.specialist_reg(v_vh.registration_number)<>v_reg then raise exception 'NOV: The chosen vehicle is %, not %.',v_vh.registration_number,v_reg; end if;
    end if;
    if v_dp.vehicle_number is not null and private.specialist_reg(v_dp.vehicle_number)<>v_reg then v_warn:=v_warn||jsonb_build_array(format('The dispatch records vehicle %s.',v_dp.vehicle_number)); end if;
    perform private.assurance_text(p_m,'instrument_ref',2,60); perform private.assurance_number(p_m,'tolerance_kg',0,1000,3);
    if private.assurance_date(p_m,'calibration_valid_until')<v_today then v_warn:=v_warn||jsonb_build_array('The calibration evidence has expired. Readings can be recorded, but the weighing cannot be finalised.'); end if;
    v_exp:=private.weighing_expected(p_company,v_kind,v_dp.id,v_pr.id);
    v_title:='Open a weighing session'; v_effect:='Starts a weighbridge transaction for this vehicle and movement.';
    v_facts:=jsonb_build_object('Movement',case when v_kind='dispatch' then 'Dispatch '||coalesce(v_dp.dispatch_number,'') else 'Receipt '||coalesce(v_pr.reference,to_char(v_pr.receipt_date,'DD Mon YYYY')) end,'Vehicle',v_reg,
      'Weighbridge',btrim(p_m->>'instrument_ref'),'Calibration valid until',to_char((p_m->>'calibration_valid_until')::date,'DD Mon YYYY'),'Tolerance',private.specialist_kg((p_m->>'tolerance_kg')::numeric),
      'Expected',coalesce(private.specialist_kg((v_exp->>'expected_kg')::numeric),'nothing recorded to compare'));
    v_data:=jsonb_build_object('reg',v_reg); v_src:=jsonb_build_object('live',v_live);
  else
    if p_lock then perform 1 from public.weighing_sessions where id=private.specialist_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into v_ws from public.weighing_sessions where id=private.specialist_uuid(p_m,'id') and company_id=p_company;
    if v_ws.id is null then raise exception 'NOV: The weighing session is unavailable.'; end if;
    v_facts:=jsonb_build_object('Session',v_ws.session_number,'Vehicle',v_ws.vehicle_registration,'Status',v_ws.status);
    v_src:=jsonb_build_object('status',v_ws.status,'readings',(select count(*) from public.weighing_readings where company_id=p_company and session_id=v_ws.id));
    if v_a='weigh.read' then
      if v_ws.status<>'open' then raise exception 'NOV: Readings are recorded on an open session; this one is %.',v_ws.status; end if;
      v_kind:=private.specialist_choice(p_m,'kind',array['gross','tare']);
      v_val:=private.assurance_number(p_m,'weight_value',0.001,100000,3);
      if jsonb_typeof(p_m->'unit') is distinct from 'string' or p_m->>'unit' not in ('kg','t') then raise exception 'NOV: Use kg or t as the unit.'; end if;
      v_kg:=case when p_m->>'unit'='t' then v_val*1000 else v_val end;
      if v_kg<1 or v_kg>100000 then raise exception 'NOV: % kg is not a plausible vehicle weight.',trim_scale(v_kg); end if;
      begin v_at:=(p_m->>'read_at')::timestamptz; exception when others then raise exception 'NOV: Enter when the reading was taken.'; end;
      if jsonb_typeof(p_m->'read_at') is distinct from 'string' or v_at is null then raise exception 'NOV: Enter when the reading was taken.'; end if;
      if v_at>now()+interval '5 minutes' then raise exception 'NOV: The reading time is in the future.'; end if;
      if v_at<now()-interval '48 hours' then raise exception 'NOV: The reading is more than 48 hours old. Reweigh the vehicle.'; end if;
      perform private.specialist_choice(p_m,'source',array['manual','device']);
      if p_m->>'source'='device' and not (p_m ? 'provider_ref') then raise exception 'NOV: A device reading needs the packet reference.'; end if;
      if p_m ? 'provider_ref' then
        perform private.assurance_text(p_m,'provider_ref',1,80);
        if exists(select 1 from public.weighing_readings where company_id=p_company and session_id=v_ws.id and provider_ref=btrim(p_m->>'provider_ref')) then raise exception 'NOV: This packet (%) is already recorded. A repeated packet is not a new reading.',btrim(p_m->>'provider_ref'); end if;
      end if;
      if p_m ? 'slip_ref' then perform private.assurance_text(p_m,'slip_ref',1,60); end if;
      if private.specialist_reg(p_m->>'vehicle_registration_read')<>v_ws.vehicle_registration then
        raise exception 'NOV: The reading is for vehicle %, not %. Record it on that vehicle''s session.',private.specialist_reg(p_m->>'vehicle_registration_read'),v_ws.vehicle_registration; end if;
      if not private.specialist_bool(p_m,'stable') then v_warn:=v_warn||jsonb_build_array('An unstable reading is kept as evidence but cannot be paired.'); end if;
      if v_at<now()-interval '24 hours' then v_warn:=v_warn||jsonb_build_array('The reading is more than 24 hours old; it cannot pair with a reading taken now.'); end if;
      v_title:='Record a weighbridge reading'; v_effect:='Adds an immutable reading with its unit, time and source.';
      v_facts:=v_facts||jsonb_build_object('Reading',v_kind,'Weight',trim_scale(v_val)||' '||(p_m->>'unit')||case when p_m->>'unit'='t' then ' ('||trim_scale(v_kg)||' kg)' else '' end,'Taken',to_char(v_at at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI'),
        'Source',p_m->>'source','Stable',case when (p_m->>'stable')::boolean then 'yes' else 'no' end);
      v_data:=jsonb_build_object('kg',v_kg,'at',v_at);
    elsif v_a='weigh.pair' then
      if v_ws.status<>'open' then raise exception 'NOV: Pair readings on an open session.'; end if;
      select * into v_gr from public.weighing_readings where id=private.specialist_uuid(p_m,'gross_reading_id') and company_id=p_company and session_id=v_ws.id;
      select * into v_tr from public.weighing_readings where id=private.specialist_uuid(p_m,'tare_reading_id') and company_id=p_company and session_id=v_ws.id;
      if v_gr.id is null or v_gr.kind<>'gross' or v_tr.id is null or v_tr.kind<>'tare' then raise exception 'NOV: Choose one gross and one tare reading of this session.'; end if;
      if not v_gr.stable or not v_tr.stable then raise exception 'NOV: Only stable readings are paired.'; end if;
      if abs(extract(epoch from (v_gr.read_at-v_tr.read_at)))>86400 then raise exception 'NOV: The readings are more than 24 hours apart. A tare is reused only within 24 hours; reweigh it.'; end if;
      v_net:=v_gr.weight_kg-v_tr.weight_kg;
      if v_net<=0 then raise exception 'NOV: The net weight would be % kg. Gross must exceed tare; check the readings.',trim_scale(v_net); end if;
      v_reversed:=case v_ws.movement_kind when 'dispatch' then v_gr.read_at<v_tr.read_at else v_tr.read_at<v_gr.read_at end;
      if v_reversed then v_warn:=v_warn||jsonb_build_array(case v_ws.movement_kind when 'dispatch' then 'The gross reading came before the tare. An outgoing load is normally weighed empty first; confirm the sequence.'
        else 'The tare reading came before the gross. An incoming load is normally weighed loaded first; confirm the sequence.' end); end if;
      v_exp:=private.weighing_expected(p_company,v_ws.movement_kind,v_ws.dispatch_id,v_ws.purchase_receipt_id);
      v_diff:=case when v_exp->>'expected_kg' is not null then v_net-(v_exp->>'expected_kg')::numeric end;
      if v_diff is null then v_warn:=v_warn||jsonb_build_array('There is no recorded kilogram quantity to reconcile with.');
      elsif abs(v_diff)>v_ws.tolerance_kg then v_warn:=v_warn||jsonb_build_array(format('The difference of %s exceeds the tolerance of %s. Finalising will need an explicit acceptance.',private.specialist_kg(v_diff),private.specialist_kg(v_ws.tolerance_kg))); end if;
      v_title:='Pair gross and tare'; v_effect:='Derives the net weight and compares it with the recorded bundles or receipt.';
      v_facts:=v_facts||jsonb_build_object('Gross',private.specialist_kg(v_gr.weight_kg),'Tare',private.specialist_kg(v_tr.weight_kg),'Net',private.specialist_kg(v_net),'Expected',coalesce(private.specialist_kg((v_exp->>'expected_kg')::numeric),'nothing to compare'),
        'Basis',v_exp->>'basis','Difference',coalesce(private.specialist_kg(v_diff),'not available'),'Metal by bundle records',coalesce(private.specialist_kg((v_exp->>'metal_kg')::numeric),'not recorded'),'Packaging by bundle records',coalesce(private.specialist_kg((v_exp->>'packaging_kg')::numeric),'not recorded'));
      v_data:=jsonb_build_object('net',v_net,'expected',v_exp->'expected_kg','diff',v_diff,'pairing',jsonb_build_object('gross_kg',v_gr.weight_kg,'tare_kg',v_tr.weight_kg,'gross_at',v_gr.read_at,'tare_at',v_tr.read_at,'reversed_order',v_reversed,'expected',v_exp));
      v_src:=v_src||jsonb_build_object('exp',md5(v_exp::text));
    elsif v_a='weigh.finalize' then
      if v_ws.status<>'paired' then raise exception 'NOV: Only a paired session is finalised.'; end if;
      if v_ws.calibration_valid_until<v_today then raise exception 'NOV: The weighbridge calibration evidence expired on %. Record valid evidence in a new session.',to_char(v_ws.calibration_valid_until,'DD Mon YYYY'); end if;
      v_exp:=private.weighing_expected(p_company,v_ws.movement_kind,v_ws.dispatch_id,v_ws.purchase_receipt_id);
      if (v_exp->>'expected_kg')::numeric is distinct from v_ws.expected_kg then raise exception 'NOV: The bundles or receipt changed after pairing. Supersede the session and weigh again.'; end if;
      if private.specialist_bool(p_m,'accept_difference') then
        if v_ws.expected_kg is not null and abs(v_ws.difference_kg)<=v_ws.tolerance_kg then raise exception 'NOV: The difference is within tolerance; there is nothing to accept.'; end if;
        v_warn:=v_warn||jsonb_build_array('You accept the difference with the reason given. Recorded bundle and receipt weights are not changed.');
      else
        if v_ws.expected_kg is null then raise exception 'NOV: There is nothing to reconcile with. Finalising needs an explicit acceptance with the reason.'; end if;
        if abs(v_ws.difference_kg)>v_ws.tolerance_kg then raise exception 'NOV: The difference of % exceeds the tolerance of %. Investigate, or accept it explicitly with the reason.',private.specialist_kg(v_ws.difference_kg),private.specialist_kg(v_ws.tolerance_kg); end if;
      end if;
      v_warn:=v_warn||jsonb_build_array('Finalising records the weighbridge result for this movement. It never overwrites measured bundle or receipt weights.');
      v_title:='Finalise the weighing'; v_effect:='Closes the transaction with its readings, pairing and reconciliation.';
      v_facts:=v_facts||jsonb_build_object('Net',private.specialist_kg(v_ws.net_kg),'Expected',coalesce(private.specialist_kg(v_ws.expected_kg),'nothing to compare'),'Difference',coalesce(private.specialist_kg(v_ws.difference_kg),'not available'));
      v_src:=v_src||jsonb_build_object('exp',md5(v_exp::text));
    elsif v_a='weigh.supersede' then
      if v_ws.status not in ('open','paired','finalized') then raise exception 'NOV: A % session cannot be superseded.',v_ws.status; end if;
      v_warn:=v_warn||jsonb_build_array('A new open session is created for the same vehicle and movement. New readings are needed; this session and its readings are kept.');
      v_title:='Supersede the weighing'; v_effect:='Replaces this session with a new one for a reviewed correction.';
    else
      if v_ws.status not in ('open','paired') then raise exception 'NOV: Only an open or paired session is cancelled.'; end if;
      v_title:='Cancel the weighing'; v_effect:='Ends the session without a result. Its readings are kept.';
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.specialist_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.specialist_context(p_company uuid,p_actor uuid,p_mutation jsonb,p_lock boolean default false) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_a text:=p_mutation->>'action'; v_role text;
begin
  perform private.specialist_assert_shape(p_mutation);
  select role into v_role from public.app_users where id=p_actor and company_id=p_company and is_active and dealer_id is null;
  if not private.specialist_action_allowed(v_role,v_a) then raise exception 'Not permitted' using errcode='42501'; end if;
  return case split_part(v_a,'.',1)
    when 'intake' then private.specialist_ctx_intake(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'automation' then private.specialist_ctx_automation(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'lab' then private.specialist_ctx_lab(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'shade' then private.specialist_ctx_shade(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'agreement' then private.specialist_ctx_agreement(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'release' then private.specialist_ctx_agreement(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'tooling' then private.specialist_ctx_tooling(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'transfer' then private.specialist_ctx_transfer(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'recipe' then private.specialist_ctx_treatment(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'treat' then private.specialist_ctx_treatment(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'toll' then private.specialist_ctx_toll(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'weigh' then private.specialist_ctx_weigh(p_company,p_actor,v_role,p_mutation,p_lock)
  end;
end $$;
revoke all on function private.specialist_ctx_intake(uuid,uuid,text,jsonb,boolean),private.specialist_ctx_automation(uuid,uuid,text,jsonb,boolean),private.specialist_ctx_lab(uuid,uuid,text,jsonb,boolean),
  private.specialist_finish_fits(text,text),private.specialist_ctx_shade(uuid,uuid,text,jsonb,boolean),private.specialist_ctx_agreement(uuid,uuid,text,jsonb,boolean),private.specialist_ctx_tooling(uuid,uuid,text,jsonb,boolean),
  private.specialist_ctx_transfer(uuid,uuid,text,jsonb,boolean),private.specialist_ctx_treatment(uuid,uuid,text,jsonb,boolean),private.specialist_ctx_toll(uuid,uuid,text,jsonb,boolean),
  private.specialist_reg(text),private.specialist_ctx_weigh(uuid,uuid,text,jsonb,boolean),private.specialist_context(uuid,uuid,jsonb,boolean) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- Apply: runs inside the confirmed request, after the context was checked again under row locks.
------------------------------------------------------------------------------------------------
create function private.automation_run(p_company uuid,p_actor uuid,p_request uuid,p_rule public.automation_rule_versions,p_mode text,p_candidates jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_el jsonb; v_n integer:=jsonb_array_length(p_candidates); v_i integer:=0; v_ok integer:=0; v_skip integer:=0; v_fail integer:=0; v_sim integer:=0; v_task uuid; v_active boolean; v_status text; v_err text;
begin
  insert into public.automation_executions(id,company_id,rule_id,rule_code,rule_version,mode,status,candidates,started_by)
    values(p_request,p_company,p_rule.id,p_rule.rule_code,p_rule.version,p_mode,case when p_mode='simulation' then 'simulated' else 'succeeded' end,v_n,p_actor);
  select coalesce(bool_and(is_active),true) into v_active from public.app_users where id=p_rule.assign_to and company_id=p_company;
  for v_el in select e from jsonb_array_elements(p_candidates) t(e) loop
    v_i:=v_i+1; exit when v_i>25;
    if exists(select 1 from public.automation_effects where company_id=p_company and effect_key=v_el->>'key' and outcome='succeeded') then
      insert into public.automation_effects(company_id,execution_id,rule_code,source_type,source_id,source_label,effect_key,outcome,reason)
        values(p_company,p_request,p_rule.rule_code,v_el->>'source_type',(v_el->>'source_id')::uuid,v_el->>'label',v_el->>'key','skipped','Already actioned by an earlier run of this rule.');
      v_skip:=v_skip+1;
    elsif p_mode='simulation' then
      insert into public.automation_effects(company_id,execution_id,rule_code,source_type,source_id,source_label,effect_key,outcome,reason)
        values(p_company,p_request,p_rule.rule_code,v_el->>'source_type',(v_el->>'source_id')::uuid,v_el->>'label',v_el->>'key','simulated','Would create the task "'||(v_el->>'title')||'". Nothing was executed.');
      v_sim:=v_sim+1;
    elsif not v_active then
      insert into public.automation_effects(company_id,execution_id,rule_code,source_type,source_id,source_label,effect_key,outcome,reason)
        values(p_company,p_request,p_rule.rule_code,v_el->>'source_type',(v_el->>'source_id')::uuid,v_el->>'label',v_el->>'key','skipped','The assigned employee is no longer active.');
      v_skip:=v_skip+1;
    else
      begin
        insert into public.tasks(company_id,task_type,title,description,priority,status,assigned_to,due_date,related_entity_type,related_entity_id,created_by)
          values(p_company,'general',v_el->>'title',(v_el->>'detail')||' Created by automation rule '||p_rule.rule_code||' v'||p_rule.version||'.',p_rule.task_priority,'open',p_rule.assign_to,
            private.ist_today()+p_rule.due_in_days,v_el->>'source_type',(v_el->>'source_id')::uuid,p_actor) returning id into v_task;
        insert into public.automation_effects(company_id,execution_id,rule_code,source_type,source_id,source_label,effect_key,outcome,task_id)
          values(p_company,p_request,p_rule.rule_code,v_el->>'source_type',(v_el->>'source_id')::uuid,v_el->>'label',v_el->>'key','succeeded',v_task);
        v_ok:=v_ok+1;
      exception when others then
        v_err:=left(case when sqlstate='P0001' then sqlerrm else 'The task workflow refused this task.' end,200);
        insert into public.automation_effects(company_id,execution_id,rule_code,source_type,source_id,source_label,effect_key,outcome,reason)
          values(p_company,p_request,p_rule.rule_code,v_el->>'source_type',(v_el->>'source_id')::uuid,v_el->>'label',v_el->>'key','failed',v_err);
        v_fail:=v_fail+1;
      end;
    end if;
  end loop;
  v_status:=case when v_n=0 then 'nothing_due' when p_mode='simulation' then 'simulated' when v_fail>0 and v_ok=0 then 'failed' when v_fail>0 then 'partial' else 'succeeded' end;
  update public.automation_executions set status=v_status,succeeded=v_ok,skipped=v_skip,failed=v_fail,simulated=v_sim,unprocessed=greatest(v_n-25,0),finished_at=clock_timestamp() where id=p_request;
  return jsonb_build_object('succeeded',v_ok,'skipped',v_skip,'failed',v_fail,'simulated',v_sim,'unprocessed',greatest(v_n-25,0),'status',v_status);
end $$;
revoke all on function private.automation_run(uuid,uuid,uuid,public.automation_rule_versions,text,jsonb) from public,anon,authenticated;

create function private.transfer_settle(p_company uuid,p_transfer uuid) returns void language sql security definer set search_path=public,private as $$
  update public.stock_transfers set status=case when (select count(*) from public.stock_transfer_lines where company_id=p_company and transfer_id=p_transfer and state='in_transit')=0 then 'received' else 'partially_received' end
  where id=p_transfer and company_id=p_company and status in ('in_transit','partially_received')
$$;
revoke all on function private.transfer_settle(uuid,uuid) from public,anon,authenticated;

create function private.specialist_apply(p_company uuid,p_actor uuid,p_request uuid,p_mutation jsonb,p_context jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; n text:=btrim(coalesce(p_mutation->>'note','')); v_id uuid:=case when p_mutation ? 'id' then (p_mutation->>'id')::uuid end; v_view text:=private.specialist_view(p_mutation->>'action');
  v_facts jsonb:=p_context->'review'->'facts'; v_data jsonb:=coalesce(p_context->'data','{}'::jsonb); v_entity uuid; v_num text; v_count bigint; v_ver integer; v_line public.po_intake_lines; v_rule public.automation_rule_versions;
  v_run jsonb; v_req public.lab_requests; v_ref public.shade_references; v_ag public.blanket_agreements; v_rel public.blanket_releases; v_ta public.tooling_agreements; v_tl public.stock_transfer_lines; v_tf public.stock_transfers;
  v_rec public.treatment_recipes; v_tb public.treatment_batches; v_ws public.weighing_sessions; v_new uuid; v_el jsonb; v_cust uuid; v_label text; v_msg text:='Recorded.';
begin
  v_entity:=coalesce(v_id,p_request);
  -- NOV-061 -----------------------------------------------------------------------------------
  if a='intake.submit' then
    select count(*) into v_count from public.po_intakes where company_id=p_company; v_num:=private.specialist_number('INT',v_count);
    insert into public.po_intakes(id,company_id,intake_number,customer_id,customer_po_ref,po_date,quote_id,source_text,source_checksum,amends_intake_id,created_by)
    values(p_request,p_company,v_num,(p_mutation->>'customer_id')::uuid,btrim(p_mutation->>'customer_po_ref'),nullif(p_mutation->>'po_date','')::date,nullif(p_mutation->>'quote_id','')::uuid,
      v_data->>'text',v_data->>'checksum',nullif(v_data->>'prior_id','')::uuid,p_actor);
    if v_data->>'prior_status' in ('review','ready') then
      update public.po_intakes set status='superseded',closed_by=p_actor,closed_at=clock_timestamp(),close_note='Replaced by '||v_num,updated_at=clock_timestamp() where id=(v_data->>'prior_id')::uuid and company_id=p_company;
    end if;
    insert into public.po_intake_lines(company_id,intake_id,seq,source_line,raw_text,code_text,quantity,quantity_unit,length_mm,finish,due_date,rate_per_kg,profile_id,match_basis,state,issues,extracted)
    select p_company,p_request,(e->>'seq')::integer,(e->>'source_line')::integer,e->>'raw_text',e->>'code_text',nullif(e->>'quantity','')::numeric,e->>'quantity_unit',nullif(e->>'length_mm','')::integer,e->>'finish',
      nullif(e->>'due_date','')::date,nullif(e->>'rate_per_kg','')::numeric,nullif(e->>'profile_id','')::uuid,e->>'match_basis',e->>'state',e->'issues',e from jsonb_array_elements(v_data->'lines') t(e);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,'Purchase order submitted for review',v_facts);
    return jsonb_build_object('label','Intake '||v_num||' recorded','href','/tasks/specialist/intake/'||p_request,'message','Resolve the highlighted lines, then mark the draft ready for order entry.');
  elsif a='intake.resolve' then
    select * into v_line from public.po_intake_lines where id=(p_mutation->>'line_id')::uuid and company_id=p_company; v_entity:=v_line.intake_id;
    if v_data->>'state'='not_a_line' then
      update public.po_intake_lines set state='not_a_line',resolved_by=p_actor,resolved_at=clock_timestamp() where id=v_line.id;
    else
      update public.po_intake_lines set state='resolved',profile_id=(v_data->>'profile_id')::uuid,quantity=(v_data->>'qty')::numeric,quantity_unit=v_data->>'unit',length_mm=nullif(v_data->>'len','')::integer,
        finish=nullif(v_data->>'finish',''),due_date=nullif(v_data->>'due','')::date,match_basis='person',resolved_by=p_actor,resolved_at=clock_timestamp() where id=v_line.id;
    end if;
    update public.po_intakes set updated_at=clock_timestamp() where id=v_entity;
  elsif a='intake.ready' then update public.po_intakes set status='ready',updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='intake.link' then update public.po_intakes set status='linked',order_id=(v_data->>'order_id')::uuid,closed_by=p_actor,closed_at=clock_timestamp(),close_note=n,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='intake.discard' then update public.po_intakes set status='discarded',closed_by=p_actor,closed_at=clock_timestamp(),close_note=n,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  -- NOV-080 -----------------------------------------------------------------------------------
  elsif a='automation.define' then
    select coalesce(max(version),0)+1 into v_ver from public.automation_rule_versions where company_id=p_company and rule_code=p_mutation->>'rule_code';
    insert into public.automation_rule_versions(id,company_id,rule_code,version,name,trigger_kind,min_days,min_amount,task_priority,assign_to,due_in_days,created_by)
    values(p_request,p_company,p_mutation->>'rule_code',v_ver,btrim(p_mutation->>'name'),p_mutation->>'trigger_kind',(p_mutation->>'min_days')::integer,nullif(v_data->>'min_amount','')::numeric,
      p_mutation->>'task_priority',nullif(v_data->>'assign_to','')::uuid,(p_mutation->>'due_in_days')::integer,p_actor);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Rule drafted','href','/tasks/specialist/automation/'||p_request,'message','A second person approves it before it can run.');
  elsif a='automation.approve' then
    select * into v_rule from public.automation_rule_versions where id=v_id and company_id=p_company;
    update public.automation_rule_versions set status='retired',state_changed_by=p_actor,state_changed_at=clock_timestamp() where company_id=p_company and rule_code=v_rule.rule_code and status in ('approved','paused');
    update public.automation_rule_versions set status='approved',approved_by=p_actor,approved_at=clock_timestamp() where id=v_id;
  elsif a='automation.state' then
    update public.automation_rule_versions set status=p_mutation->>'state',state_changed_by=p_actor,state_changed_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a in ('automation.simulate','automation.execute') then
    select * into v_rule from public.automation_rule_versions where id=v_id and company_id=p_company;
    v_run:=private.automation_run(p_company,p_actor,p_request,v_rule,case when a='automation.simulate' then 'simulation' else 'execution' end,v_data->'candidates');
    perform private.specialist_record(p_company,v_view,v_id,a,p_actor,coalesce(nullif(n,''),'Simulation'),v_facts||v_run);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,coalesce(nullif(n,''),'Simulation'),v_run);
    return jsonb_build_object('label',case when a='automation.simulate' then 'Simulation recorded' else 'Rule run recorded' end,'href','/tasks/specialist/automation/'||p_request,
      'message',case when a='automation.simulate' then format('%s task(s) would be created. Nothing was executed.',v_run->>'simulated')
        else format('%s task(s) created, %s skipped, %s failed, %s left for the next run.',v_run->>'succeeded',v_run->>'skipped',v_run->>'failed',v_run->>'unprocessed') end);
  -- NOV-071 -----------------------------------------------------------------------------------
  elsif a='lab.request' then
    select count(*) into v_count from public.lab_requests where company_id=p_company; v_num:=private.specialist_number('LAB',v_count);
    insert into public.lab_requests(id,company_id,request_number,sample_ref,material_kind,production_job_id,billet_batch_id,material_note,lab_vendor_id,tests,promised_date,estimated_charge,created_by)
    values(p_request,p_company,v_num,btrim(p_mutation->>'sample_ref'),p_mutation->>'material_kind',nullif(p_mutation->>'production_job_id','')::uuid,nullif(p_mutation->>'billet_batch_id','')::uuid,
      nullif(btrim(coalesce(p_mutation->>'material_note','')),''),(p_mutation->>'lab_vendor_id')::uuid,
      (select jsonb_agg(jsonb_build_object('code',e->>'code','method',btrim(e->>'method'))) from jsonb_array_elements(p_mutation->'tests') t(e)),(p_mutation->>'promised_date')::date,nullif(p_mutation->>'estimated_charge','')::numeric,p_actor);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Request '||v_num||' recorded','href','/tasks/specialist/lab/'||p_request,'message','Record the dispatch and the laboratory''s acknowledgement as the sample moves.');
  elsif a='lab.custody' then
    if v_data->>'stage'='dispatched' then update public.lab_requests set status='dispatched',dispatch_ref=v_data->>'ref',dispatched_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    else update public.lab_requests set status='at_lab',lab_sample_ref=v_data->>'ref',lab_received_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_id and company_id=p_company; end if;
  elsif a='lab.revise' then update public.lab_requests set revised_date=(p_mutation->>'revised_date')::date,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='lab.result' then
    insert into public.lab_results(company_id,request_id,test_code,revision,statement,lab_outcome,report_ref,recorded_by)
    values(p_company,v_id,p_mutation->>'test_code',(v_data->>'revision')::integer,btrim(p_mutation->>'statement'),p_mutation->>'lab_outcome',btrim(p_mutation->>'report_ref'),p_actor);
    update public.lab_requests set status=v_data->>'status',
      decision_history=case when decision is not null then decision_history||jsonb_build_array(jsonb_build_object('decision',decision,'note',decision_note,'by',decided_by,'at',decided_at,'reopened_at',clock_timestamp())) else decision_history end,
      decision=null,decision_note=null,decided_by=null,decided_at=null,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    n:='Laboratory result recorded';
  elsif a='lab.review' then
    select * into v_req from public.lab_requests where id=v_id and company_id=p_company;
    update public.lab_requests set status='reviewed',decision=p_mutation->>'decision',decision_note=n,decided_by=p_actor,decided_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_id;
    if p_mutation->>'decision'='retest' then
      select count(*) into v_count from public.lab_requests where company_id=p_company; v_num:=private.specialist_number('LAB',v_count);
      insert into public.lab_requests(id,company_id,request_number,sample_ref,material_kind,production_job_id,billet_batch_id,material_note,lab_vendor_id,tests,promised_date,estimated_charge,retest_of,created_by)
      values(p_request,p_company,v_num,v_req.sample_ref,v_req.material_kind,v_req.production_job_id,v_req.billet_batch_id,v_req.material_note,v_req.lab_vendor_id,v_req.tests,(p_mutation->>'retest_promised_date')::date,v_req.estimated_charge,v_req.id,p_actor);
      perform private.specialist_record(p_company,v_view,p_request,'lab.request',p_actor,'Retest of '||v_req.request_number||': '||n,v_facts);
      v_msg:='Retest request '||v_num||' was created for the same sample.';
    end if;
  elsif a='lab.stop' then update public.lab_requests set status=p_mutation->>'outcome',updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  -- NOV-073 -----------------------------------------------------------------------------------
  elsif a='shade.define' then
    insert into public.shade_references(id,company_id,ref_code,revision,shade_name,finish_type,specification,customer_id,project_ref,sample_location,assessment_conditions,created_by)
    values(p_request,p_company,v_data->>'code',(v_data->>'revision')::integer,btrim(p_mutation->>'shade_name'),p_mutation->>'finish_type',btrim(p_mutation->>'specification'),nullif(p_mutation->>'customer_id','')::uuid,
      nullif(btrim(coalesce(p_mutation->>'project_ref','')),''),btrim(p_mutation->>'sample_location'),btrim(p_mutation->>'assessment_conditions'),p_actor);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Reference drafted','href','/tasks/specialist/shades/'||p_request,'message','A second person approves it before order lines are bound to it.');
  elsif a='shade.approve' then
    select * into v_ref from public.shade_references where id=v_id and company_id=p_company;
    update public.shade_references set status='superseded' where company_id=p_company and ref_code=v_ref.ref_code and status='approved';
    update public.shade_references set status='approved',approved_by=p_actor,approved_at=clock_timestamp() where id=v_id;
  elsif a='shade.withdraw' then update public.shade_references set status='withdrawn' where id=v_id and company_id=p_company;
  elsif a='shade.bind' then
    if nullif(v_data->>'replace_id','') is not null then update public.shade_bindings set status='replaced',replaced_at=clock_timestamp() where id=(v_data->>'replace_id')::uuid and company_id=p_company; end if;
    insert into public.shade_bindings(id,company_id,reference_id,order_item_id,bound_by) values(p_request,p_company,(p_mutation->>'reference_id')::uuid,(p_mutation->>'order_item_id')::uuid,p_actor);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    perform private.specialist_record(p_company,v_view,(p_mutation->>'reference_id')::uuid,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Reference bound','href','/tasks/specialist/shades/'||p_request,'message','Returned finishing batches are assessed against this reference.');
  elsif a='shade.decide' then
    update public.shade_decisions set status='superseded' where company_id=p_company and binding_id=v_id and status='active' and lower(batch_label)=lower(btrim(p_mutation->>'batch_label'));
    insert into public.shade_decisions(id,company_id,binding_id,batch_label,finishing_job_id,decision,assessed_under,decided_by,note)
    values(p_request,p_company,v_id,btrim(p_mutation->>'batch_label'),nullif(p_mutation->>'finishing_job_id','')::uuid,p_mutation->>'decision',btrim(p_mutation->>'assessed_under'),p_actor,n);
  -- NOV-037 -----------------------------------------------------------------------------------
  elsif a='agreement.define' then
    select count(*) into v_count from public.blanket_agreements where company_id=p_company; v_num:=private.specialist_number('BA',v_count);
    insert into public.blanket_agreements(id,company_id,agreement_number,customer_id,customer_ref,valid_from,valid_to,overrun_percent,created_by)
    values(p_request,p_company,v_num,(p_mutation->>'customer_id')::uuid,btrim(p_mutation->>'customer_ref'),(p_mutation->>'valid_from')::date,(p_mutation->>'valid_to')::date,(p_mutation->>'overrun_percent')::numeric,p_actor);
    for v_el in select e||jsonb_build_object('seq',ord) from jsonb_array_elements(p_mutation->'lines') with ordinality t(e,ord) loop
      insert into public.blanket_lines(company_id,agreement_id,seq,profile_id,finish,agreed_kg) values(p_company,p_request,(v_el->>'seq')::integer,(v_el->>'profile_id')::uuid,btrim(v_el->>'finish'),(v_el->>'agreed_kg')::numeric) returning id into v_new;
      insert into public.blanket_rates(company_id,line_id,rate_per_kg,effective_from,recorded_by,note) values(p_company,v_new,(v_el->>'rate_per_kg')::numeric,(p_mutation->>'valid_from')::date,p_actor,'Agreed rate');
    end loop;
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Agreement '||v_num||' drafted','href','/tasks/specialist/agreements/'||p_request,'message','A second person approves it before releases are called off.');
  elsif a='agreement.approve' then update public.blanket_agreements set status='active',approved_by=p_actor,approved_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a in ('agreement.rate','agreement.amend','release.create') then
    select agreement_id into v_entity from public.blanket_lines where id=(p_mutation->>'line_id')::uuid and company_id=p_company;
    if a='agreement.rate' then
      insert into public.blanket_rates(company_id,line_id,rate_per_kg,effective_from,recorded_by,note) values(p_company,(p_mutation->>'line_id')::uuid,(p_mutation->>'rate_per_kg')::numeric,(p_mutation->>'effective_from')::date,p_actor,n);
    elsif a='agreement.amend' then
      update public.blanket_lines set history=history||jsonb_build_array(jsonb_build_object('from_kg',agreed_kg,'to_kg',(p_mutation->>'agreed_kg')::numeric,'at',clock_timestamp(),'by',p_actor,'reason',n)),
        agreed_kg=(p_mutation->>'agreed_kg')::numeric where id=(p_mutation->>'line_id')::uuid and company_id=p_company;
    else
      select count(*) into v_count from public.blanket_releases where company_id=p_company; v_num:=private.specialist_number('REL',v_count);
      insert into public.blanket_releases(id,company_id,release_number,agreement_id,line_id,quantity_kg,site,requested_date,created_by)
      values(p_request,p_company,v_num,v_entity,(p_mutation->>'line_id')::uuid,(p_mutation->>'quantity_kg')::numeric,btrim(p_mutation->>'site'),(p_mutation->>'requested_date')::date,p_actor);
      v_msg:='Release '||v_num||' reserves the quantity from the agreement balance.';
    end if;
  elsif a='agreement.close' then
    select * into v_ag from public.blanket_agreements where id=v_id and company_id=p_company;
    update public.blanket_agreements set status='closed',closed_by=p_actor,closed_at=clock_timestamp(),close_note=n where id=v_id;
    if (p_mutation->>'carry_forward')::boolean then
      select count(*) into v_count from public.blanket_agreements where company_id=p_company; v_num:=private.specialist_number('BA',v_count);
      insert into public.blanket_agreements(id,company_id,agreement_number,customer_id,customer_ref,valid_from,valid_to,overrun_percent,created_by,carried_from)
      values(p_request,p_company,v_num,v_ag.customer_id,v_ag.customer_ref,private.ist_today(),(p_mutation->>'new_valid_to')::date,v_ag.overrun_percent,p_actor,v_ag.id);
      for v_el in select e||jsonb_build_object('pos',ord) from jsonb_array_elements(v_data->'carry') with ordinality t(e,ord) loop
        insert into public.blanket_lines(company_id,agreement_id,seq,profile_id,finish,agreed_kg) values(p_company,p_request,(v_el->>'pos')::integer,(v_el->>'profile_id')::uuid,v_el->>'finish',(v_el->>'remaining')::numeric) returning id into v_new;
        insert into public.blanket_rates(company_id,line_id,rate_per_kg,effective_from,recorded_by,note) values(p_company,v_new,(v_el->>'rate')::numeric,private.ist_today(),p_actor,'Carried forward from '||v_ag.agreement_number);
      end loop;
      update public.blanket_agreements set carried_to=p_request where id=v_id;
      perform private.specialist_record(p_company,v_view,p_request,'agreement.define',p_actor,'Carried forward from '||v_ag.agreement_number||': '||n,v_facts);
      perform private.specialist_record(p_company,v_view,v_id,a,p_actor,n,v_facts);
      return jsonb_build_object('label','Agreement closed and carried forward','href','/tasks/specialist/agreements/'||p_request,'message','Draft agreement '||v_num||' holds the remaining quantity for approval.');
    end if;
  elsif a like 'release.%' then
    select * into v_rel from public.blanket_releases where id=v_id and company_id=p_company; v_entity:=v_rel.agreement_id;
    if a='release.firm' then update public.blanket_releases set status='firm',rate_per_kg=(v_data->>'rate')::numeric,rate_effective_from=(v_data->>'from')::date,firmed_by=p_actor,firmed_at=clock_timestamp() where id=v_id;
    elsif a='release.cancel' then
      if (v_data->>'full')::boolean then update public.blanket_releases set status='cancelled',history=history||jsonb_build_array(jsonb_build_object('cancelled_kg',quantity_kg,'at',clock_timestamp(),'by',p_actor,'reason',n)) where id=v_id;
      else update public.blanket_releases set quantity_kg=quantity_kg-(v_data->>'qty')::numeric,cancelled_kg=cancelled_kg+(v_data->>'qty')::numeric,
        history=history||jsonb_build_array(jsonb_build_object('reduced_kg',(v_data->>'qty')::numeric,'at',clock_timestamp(),'by',p_actor,'reason',n)) where id=v_id; end if;
    elsif a='release.fulfil' then update public.blanket_releases set status='fulfilled',order_id=(p_mutation->>'order_id')::uuid where id=v_id;
    else update public.blanket_releases set returned_kg=returned_kg+(p_mutation->>'quantity_kg')::numeric,history=history||jsonb_build_array(jsonb_build_object('returned_kg',(p_mutation->>'quantity_kg')::numeric,'at',clock_timestamp(),'by',p_actor,'reason',n)) where id=v_id;
    end if;
  -- NOV-065 -----------------------------------------------------------------------------------
  elsif a='tooling.define' then
    select count(distinct family_id) into v_count from public.tooling_agreements where company_id=p_company;
    v_num:=coalesce(v_data->>'number',private.specialist_number('TA',v_count));
    insert into public.tooling_agreements(id,company_id,agreement_number,family_id,version,die_id,customer_id,owner_party,die_charge,customer_contribution,waiver_amount,recovery_basis,recovery_rate_per_kg,recovery_cap,tax_reference,terms,created_by)
    values(p_request,p_company,v_num,coalesce(nullif(v_data->>'family','')::uuid,p_request),(v_data->>'version')::integer,(p_mutation->>'die_id')::uuid,(p_mutation->>'customer_id')::uuid,p_mutation->>'owner_party',
      (p_mutation->>'die_charge')::numeric,(p_mutation->>'customer_contribution')::numeric,(p_mutation->>'waiver_amount')::numeric,p_mutation->>'recovery_basis',nullif(p_mutation->>'recovery_rate_per_kg','')::numeric,
      nullif(p_mutation->>'recovery_cap','')::numeric,btrim(p_mutation->>'tax_reference'),btrim(p_mutation->>'terms'),p_actor);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Agreement '||v_num||' drafted','href','/tasks/specialist/tooling/'||p_request,'message','A second person approves it, including any waiver.');
  elsif a='tooling.approve' then
    select * into v_ta from public.tooling_agreements where id=v_id and company_id=p_company;
    update public.tooling_agreements set status='superseded' where company_id=p_company and family_id=v_ta.family_id and status='active';
    update public.tooling_agreements set status='active',approved_by=p_actor,approved_at=clock_timestamp() where id=v_id;
  elsif a='tooling.allocate' then
    select * into v_ta from public.tooling_agreements where id=v_id and company_id=p_company;
    insert into public.tooling_allocations(id,company_id,family_id,agreement_id,kind,invoice_id,payment_id,credit_note_id,amount,calc,recorded_by)
    values(p_request,p_company,v_ta.family_id,v_id,p_mutation->>'kind',nullif(p_mutation->>'invoice_id','')::uuid,nullif(p_mutation->>'payment_id','')::uuid,nullif(p_mutation->>'credit_note_id','')::uuid,
      (v_data->>'amount')::numeric,case when jsonb_typeof(v_data->'calc')='object' then v_data->'calc' end,p_actor);
  elsif a='tooling.reverse' then update public.tooling_allocations set reversed_at=clock_timestamp(),reversed_by=p_actor,reverse_note=n where id=(p_mutation->>'allocation_id')::uuid and company_id=p_company and reversed_at is null;
  elsif a='tooling.dispute' then
    update public.tooling_agreements set disputed=(p_mutation->>'state'='open'),dispute_note=case when p_mutation->>'state'='open' then n else concat(dispute_note,' · Resolved: ',n) end where id=v_id and company_id=p_company;
  -- NOV-067 -----------------------------------------------------------------------------------
  elsif a='transfer.request' then
    select count(*) into v_count from public.stock_transfers where company_id=p_company; v_num:=private.specialist_number('TRF',v_count);
    insert into public.stock_transfers(id,company_id,transfer_number,to_location_id,destination,planned_date,requested_by)
    values(p_request,p_company,v_num,(p_mutation->>'to_location_id')::uuid,v_data->>'destination',(p_mutation->>'planned_date')::date,p_actor);
    insert into public.stock_transfer_lines(company_id,transfer_id,batch_id,bundle_label,profile_id,pieces,weight_kg,source_location)
    select p_company,p_request,(e->>'batch_id')::uuid,e->>'label',(e->>'profile_id')::uuid,(e->>'pieces')::integer,(e->>'kg')::numeric,e->>'location' from jsonb_array_elements(v_data->'lines') t(e);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Transfer '||v_num||' requested','href','/tasks/specialist/transfers/'||p_request,'message','Issue it when the bundles leave; receive each bundle at the destination.');
  elsif a='transfer.issue' then
    select * into v_tf from public.stock_transfers where id=v_id and company_id=p_company;
    update public.stock_transfer_lines l set state='in_transit',qc_status_at_issue=sb.qc_status from public.profile_stock_batches sb where sb.id=l.batch_id and sb.company_id=l.company_id and l.company_id=p_company and l.transfer_id=v_id and l.state='requested';
    update public.profile_stock_batches sb set status='in_transit',location=left('In transit · '||v_tf.transfer_number,120),updated_at=now() from public.stock_transfer_lines l
      where l.company_id=p_company and l.transfer_id=v_id and l.state='in_transit' and sb.id=l.batch_id and sb.company_id=p_company;
    update public.stock_transfers set status='in_transit',issued_by=p_actor,issued_at=clock_timestamp(),transport_ref=btrim(p_mutation->>'transport_ref'),gate_ref=nullif(btrim(coalesce(p_mutation->>'gate_ref','')),'') where id=v_id;
  elsif a='transfer.receive' then
    select * into v_tf from public.stock_transfers where id=v_id and company_id=p_company;
    select * into v_tl from public.stock_transfer_lines where id=(v_data->>'line_id')::uuid and company_id=p_company;
    update public.stock_transfer_lines set state='received',resolved_by=p_actor,resolved_at=clock_timestamp(),resolution_note=nullif(btrim(coalesce(p_mutation->>'condition_note','')),'') where id=v_tl.id;
    update public.profile_stock_batches set status='available',location=v_tf.destination,updated_at=now() where id=v_tl.batch_id and company_id=p_company;
    perform private.transfer_settle(p_company,v_id);
    n:='Bundle '||v_tl.bundle_label||' received'||coalesce(': '||nullif(btrim(coalesce(p_mutation->>'condition_note','')),''),'');
  elsif a='transfer.dispose' then
    select * into v_tl from public.stock_transfer_lines where id=(p_mutation->>'line_id')::uuid and company_id=p_company; v_entity:=v_tl.transfer_id;
    select * into v_tf from public.stock_transfers where id=v_tl.transfer_id and company_id=p_company;
    update public.stock_transfer_lines set state=p_mutation->>'disposition',resolved_by=p_actor,resolved_at=clock_timestamp(),resolution_note=n where id=v_tl.id;
    update public.profile_stock_batches set status=case p_mutation->>'disposition' when 'damaged' then 'rejected' when 'returned_to_source' then 'available' else 'scrap' end,
      location=case p_mutation->>'disposition' when 'damaged' then v_tf.destination when 'returned_to_source' then v_tl.source_location else location end,
      notes=left(concat_ws(' · ',notes,'Transfer '||v_tf.transfer_number||': '||replace(p_mutation->>'disposition','_',' ')||' - '||n),2000),updated_at=now() where id=v_tl.batch_id and company_id=p_company;
    perform private.transfer_settle(p_company,v_tl.transfer_id);
  elsif a='transfer.cancel' then
    update public.stock_transfer_lines set state='cancelled',resolved_by=p_actor,resolved_at=clock_timestamp(),resolution_note=n where company_id=p_company and transfer_id=v_id and state='requested';
    update public.stock_transfers set status='cancelled',closed_by=p_actor,closed_at=clock_timestamp(),close_note=n where id=v_id and company_id=p_company;
  elsif a='transfer.close' then update public.stock_transfers set status='closed',closed_by=p_actor,closed_at=clock_timestamp(),close_note=n where id=v_id and company_id=p_company;
  -- NOV-072 -----------------------------------------------------------------------------------
  elsif a='recipe.define' then
    select coalesce(max(revision),0)+1 into v_ver from public.treatment_recipes where company_id=p_company and recipe_code=p_mutation->>'recipe_code';
    insert into public.treatment_recipes(id,company_id,recipe_code,revision,name,process,alloys,target_temper,temp_min_c,temp_max_c,soak_min_minutes,soak_max_minutes,min_readings,created_by)
    values(p_request,p_company,p_mutation->>'recipe_code',v_ver,btrim(p_mutation->>'name'),p_mutation->>'process',(select array_agg(x) from jsonb_array_elements_text(v_data->'alloys') t(x)),btrim(p_mutation->>'target_temper'),
      (p_mutation->>'temp_min_c')::numeric,(p_mutation->>'temp_max_c')::numeric,(p_mutation->>'soak_min_minutes')::integer,(p_mutation->>'soak_max_minutes')::integer,(p_mutation->>'min_readings')::integer,p_actor);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Recipe revision drafted','href','/tasks/specialist/treatment/'||p_request,'message','Quality approves it before batches can use it.');
  elsif a='recipe.approve' then
    select * into v_rec from public.treatment_recipes where id=v_id and company_id=p_company;
    update public.treatment_recipes set status='superseded' where company_id=p_company and recipe_code=v_rec.recipe_code and status='approved';
    update public.treatment_recipes set status='approved',approved_by=p_actor,approved_at=clock_timestamp() where id=v_id;
  elsif a='treat.create' then
    select count(*) into v_count from public.treatment_batches where company_id=p_company; v_num:=private.specialist_number('HT',v_count);
    insert into public.treatment_batches(id,company_id,batch_number,recipe_id,machine_id,load_note,loaded_by) values(p_request,p_company,v_num,(p_mutation->>'recipe_id')::uuid,(p_mutation->>'machine_id')::uuid,btrim(p_mutation->>'load_note'),p_actor);
    insert into public.treatment_inputs(company_id,batch_id,production_job_id,profile_id,alloy,temper,quantity_kg)
    select p_company,p_request,(e->>'job_id')::uuid,(e->>'profile_id')::uuid,e->>'alloy',e->>'temper',(e->>'kg')::numeric from jsonb_array_elements(v_data->'inputs') t(e);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,btrim(p_mutation->>'load_note'),v_facts);
    return jsonb_build_object('label','Batch '||v_num||' loaded','href','/tasks/specialist/treatment/'||p_request,'message','Start the cycle and record readings as they are taken.');
  elsif a='treat.start' then update public.treatment_batches set status='running',started_at=clock_timestamp(),started_by=p_actor where id=v_id and company_id=p_company; n:='Cycle started';
  elsif a='treat.observe' then
    insert into public.treatment_observations(company_id,batch_id,temperature_c,instrument_ref,note,recorded_by) values(p_company,v_id,(p_mutation->>'temperature_c')::numeric,btrim(p_mutation->>'instrument_ref'),nullif(btrim(coalesce(p_mutation->>'reading_note','')),''),p_actor);
    n:='Reading '||(p_mutation->>'temperature_c')||' °C';
  elsif a='treat.end' then
    update public.treatment_batches set status=case when (p_mutation->>'interrupted')::boolean then 'interrupted' else 'ended' end,ended_at=clock_timestamp(),ended_by=p_actor where id=v_id and company_id=p_company;
  elsif a='treat.review' then
    select * into v_tb from public.treatment_batches where id=v_id and company_id=p_company;
    update public.treatment_inputs ti set accepted_kg=(e->>'accepted_kg')::numeric,rejected_kg=(e->>'rejected_kg')::numeric,retreat_kg=(e->>'retreat_kg')::numeric
      from jsonb_array_elements(p_mutation->'outcomes') t(e) where ti.id=(e->>'input_id')::uuid and ti.company_id=p_company and ti.batch_id=v_id;
    update public.treatment_batches set status=v_data->>'status',review=jsonb_build_object('outcomes',p_mutation->'outcomes','accept_deviation',(p_mutation->>'accept_deviation')::boolean,'assessment',v_data->'assessment','note',n),
      reviewed_by=p_actor,reviewed_at=clock_timestamp() where id=v_id;
    if exists(select 1 from public.treatment_inputs where company_id=p_company and batch_id=v_id and retreat_kg>0) then
      select count(*) into v_count from public.treatment_batches where company_id=p_company; v_num:=private.specialist_number('HT',v_count);
      insert into public.treatment_batches(id,company_id,batch_number,recipe_id,machine_id,load_note,loaded_by,retreatment_of)
      values(p_request,p_company,v_num,(v_data->>'next_recipe')::uuid,v_tb.machine_id,left('Retreatment of '||v_tb.batch_number||': '||n,300),p_actor,v_id);
      insert into public.treatment_inputs(company_id,batch_id,production_job_id,profile_id,alloy,temper,quantity_kg)
      select p_company,p_request,production_job_id,profile_id,alloy,temper,retreat_kg from public.treatment_inputs where company_id=p_company and batch_id=v_id and retreat_kg>0;
      perform private.specialist_record(p_company,v_view,p_request,'treat.create',p_actor,'Retreatment of '||v_tb.batch_number,v_facts);
      v_msg:='Retreatment batch '||v_num||' is loaded.';
    end if;
  -- NOV-032 -----------------------------------------------------------------------------------
  elsif a='toll.define' then
    insert into public.toll_agreements(id,company_id,customer_id,revision,material_spec,alloy,permitted_mixing,allowed_loss_percent,conversion_rate_per_kg,billing_basis,created_by)
    values(p_request,p_company,(p_mutation->>'customer_id')::uuid,(v_data->>'revision')::integer,btrim(p_mutation->>'material_spec'),upper(btrim(p_mutation->>'alloy')),(p_mutation->>'permitted_mixing')::boolean,
      nullif(p_mutation->>'allowed_loss_percent','')::numeric,(p_mutation->>'conversion_rate_per_kg')::numeric,p_mutation->>'billing_basis',p_actor);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Agreement drafted','href','/tasks/specialist/tolling/'||p_request,'message','A second person approves it before customer metal is received.');
  elsif a='toll.approve' then
    select customer_id into v_cust from public.toll_agreements where id=v_id and company_id=p_company;
    update public.toll_agreements set status='superseded' where company_id=p_company and customer_id=v_cust and status='approved';
    update public.toll_agreements set status='approved',approved_by=p_actor,approved_at=clock_timestamp() where id=v_id;
  elsif a='toll.receive' then
    v_entity:=(p_mutation->>'customer_id')::uuid;
    select count(*) into v_count from public.toll_receipts where company_id=p_company; v_num:=private.specialist_number('TR',v_count);
    insert into public.toll_receipts(id,company_id,receipt_number,customer_id,received_kg,challan_ref,heat_ref,alloy,location,received_by)
    values(p_request,p_company,v_num,v_entity,(p_mutation->>'received_kg')::numeric,btrim(p_mutation->>'challan_ref'),nullif(btrim(coalesce(p_mutation->>'heat_ref','')),''),
      coalesce(upper(nullif(btrim(coalesce(p_mutation->>'alloy','')),'')),(select alloy from public.toll_agreements where company_id=p_company and customer_id=v_entity and status='approved')),btrim(p_mutation->>'location'),p_actor);
    v_msg:='Receipt '||v_num||' is pending inspection.';
  elsif a='toll.inspect' then
    select customer_id into v_entity from public.toll_receipts where id=(p_mutation->>'receipt_id')::uuid and company_id=p_company;
    update public.toll_receipts set quality_status=p_mutation->>'decision',inspected_by=p_actor,inspected_at=clock_timestamp() where id=(p_mutation->>'receipt_id')::uuid and company_id=p_company;
  elsif a='toll.move' then
    v_entity:=(p_mutation->>'customer_id')::uuid;
    insert into public.toll_movements(id,company_id,customer_id,kind,receipt_id,production_job_id,quantity_kg,reference,note,recorded_by)
    values(p_request,p_company,v_entity,p_mutation->>'kind',nullif(p_mutation->>'receipt_id','')::uuid,nullif(p_mutation->>'production_job_id','')::uuid,(p_mutation->>'quantity_kg')::numeric,
      nullif(btrim(coalesce(p_mutation->>'reference','')),''),n,p_actor);
  elsif a='toll.reverse' then
    select customer_id into v_entity from public.toll_movements where id=(p_mutation->>'movement_id')::uuid and company_id=p_company;
    update public.toll_movements set status='reversed',reversed_by=p_actor,reversed_at=clock_timestamp(),reverse_note=n where id=(p_mutation->>'movement_id')::uuid and company_id=p_company and status='active';
  elsif a='toll.statement' then
    v_entity:=(p_mutation->>'customer_id')::uuid;
    update public.toll_statements set status='replaced' where company_id=p_company and customer_id=v_entity and status in ('draft','disputed');
    select count(*) into v_count from public.toll_statements where company_id=p_company; v_num:=private.specialist_number('TST',v_count);
    insert into public.toll_statements(id,company_id,statement_number,customer_id,agreement_id,model,created_by)
    values(p_request,p_company,v_num,v_entity,(select id from public.toll_agreements where company_id=p_company and customer_id=v_entity and status='approved'),v_data->'model',p_actor);
    v_msg:='Statement '||v_num||' is a draft for review with the customer.';
  elsif a='toll.settle' then
    select customer_id into v_entity from public.toll_statements where id=(p_mutation->>'statement_id')::uuid and company_id=p_company;
    update public.toll_statements set status=case when p_mutation->>'decision'='agree' then 'agreed' else 'disputed' end,settled_by=p_actor,settled_at=clock_timestamp(),settle_note=n
      where id=(p_mutation->>'statement_id')::uuid and company_id=p_company;
  -- NOV-074 -----------------------------------------------------------------------------------
  elsif a='weigh.open' then
    select count(*) into v_count from public.weighing_sessions where company_id=p_company; v_num:=private.specialist_number('WB',v_count);
    insert into public.weighing_sessions(id,company_id,session_number,vehicle_registration,vehicle_id,movement_kind,dispatch_id,purchase_receipt_id,instrument_ref,calibration_valid_until,tolerance_kg,opened_by)
    values(p_request,p_company,v_num,v_data->>'reg',nullif(p_mutation->>'vehicle_id','')::uuid,p_mutation->>'movement_kind',nullif(p_mutation->>'dispatch_id','')::uuid,nullif(p_mutation->>'purchase_receipt_id','')::uuid,
      btrim(p_mutation->>'instrument_ref'),(p_mutation->>'calibration_valid_until')::date,(p_mutation->>'tolerance_kg')::numeric,p_actor);
    perform private.specialist_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Weighing '||v_num||' opened','href','/tasks/specialist/weighing/'||p_request,'message','Record the gross and tare readings, then pair them.');
  elsif a='weigh.read' then
    insert into public.weighing_readings(id,company_id,session_id,kind,weight_value,unit,weight_kg,read_at,source,provider_ref,slip_ref,stable,vehicle_registration_read,recorded_by)
    values(p_request,p_company,v_id,p_mutation->>'kind',(p_mutation->>'weight_value')::numeric,p_mutation->>'unit',(v_data->>'kg')::numeric,(v_data->>'at')::timestamptz,p_mutation->>'source',
      nullif(btrim(coalesce(p_mutation->>'provider_ref','')),''),nullif(btrim(coalesce(p_mutation->>'slip_ref','')),''),(p_mutation->>'stable')::boolean,private.specialist_reg(p_mutation->>'vehicle_registration_read'),p_actor);
    n:=initcap(p_mutation->>'kind')||' reading '||(v_data->>'kg')||' kg';
  elsif a='weigh.pair' then
    update public.weighing_sessions set status='paired',gross_reading_id=(p_mutation->>'gross_reading_id')::uuid,tare_reading_id=(p_mutation->>'tare_reading_id')::uuid,net_kg=(v_data->>'net')::numeric,
      expected_kg=nullif(v_data->>'expected','')::numeric,difference_kg=nullif(v_data->>'diff','')::numeric,pairing=v_data->'pairing' where id=v_id and company_id=p_company;
  elsif a='weigh.finalize' then
    update public.weighing_sessions set status='finalized',finalized_by=p_actor,finalized_at=clock_timestamp(),accepted_difference=(p_mutation->>'accept_difference')::boolean,closed_note=n where id=v_id and company_id=p_company;
  elsif a='weigh.supersede' then
    select * into v_ws from public.weighing_sessions where id=v_id and company_id=p_company;
    update public.weighing_sessions set status='superseded',superseded_by_id=p_request,closed_note=n where id=v_id;
    select count(*) into v_count from public.weighing_sessions where company_id=p_company; v_num:=private.specialist_number('WB',v_count);
    insert into public.weighing_sessions(id,company_id,session_number,vehicle_registration,vehicle_id,movement_kind,dispatch_id,purchase_receipt_id,instrument_ref,calibration_valid_until,tolerance_kg,opened_by,supersedes_id)
    values(p_request,p_company,v_num,v_ws.vehicle_registration,v_ws.vehicle_id,v_ws.movement_kind,v_ws.dispatch_id,v_ws.purchase_receipt_id,v_ws.instrument_ref,v_ws.calibration_valid_until,v_ws.tolerance_kg,p_actor,v_ws.id);
    perform private.specialist_record(p_company,v_view,v_id,a,p_actor,n,v_facts);
    perform private.specialist_record(p_company,v_view,p_request,'weigh.open',p_actor,'Supersedes '||v_ws.session_number||': '||n,v_facts);
    return jsonb_build_object('label','Weighing '||v_num||' opened','href','/tasks/specialist/weighing/'||p_request,'message','Record new readings. '||v_ws.session_number||' is kept as superseded.');
  elsif a='weigh.cancel' then update public.weighing_sessions set status='cancelled',closed_note=n where id=v_id and company_id=p_company;
  else raise exception 'NOV: Unknown action.';
  end if;
  if a in ('toll.approve') then v_entity:=v_id; end if;
  perform private.specialist_record(p_company,v_view,v_entity,a,p_actor,coalesce(nullif(n,''),p_context->'review'->>'title'),v_facts);
  return jsonb_build_object('label',p_context->'review'->>'title','href','/tasks/specialist/'||v_view||'/'||v_entity,'message',v_msg);
end $$;
revoke all on function private.specialist_apply(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

create function public.specialist_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid();v_company uuid:=private.get_current_user_company_id();v_role text:=private.get_current_user_role();
  v_view text;v_page integer;v_search text;v_state text;v_sort text;v_status text;v_id uuid;v_total bigint;v_rows jsonb;v_row jsonb;v_events jsonb;
  r public.specialist_requests%rowtype;v_context jsonb;v_fingerprint text;v_result jsonb;v_message text;v_keys text[];
begin
  if v_actor is null or v_company is null or not exists(select 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null)
    or not private.specialist_read_allowed(v_role,null) then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.app_users where id=v_actor and company_id=v_company for share;
  v_keys:=case p_command when 'list' then array['view','page','search','state','sort','status'] when 'detail' then array['view','id','page']
    when 'lookup' then array['kind','search','selected_id','parent_id'] when 'preview' then array['request_id','mutation'] when 'commit' then array['request_id','fingerprint']
    when 'outcome' then array['request_id'] when 'abandon' then array['request_id'] end;
  if jsonb_typeof(p_payload) is distinct from 'object' or v_keys is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(v_keys))) then raise exception 'NOV: Invalid specialist request.'; end if;
  if p_command in ('list','detail') then
    v_view:=p_payload->>'view';v_page:=coalesce((p_payload->>'page')::integer,1);v_search:=btrim(coalesce(p_payload->>'search',''));
    v_state:=coalesce(p_payload->>'state','active');v_sort:=coalesce(p_payload->>'sort','priority');v_status:=nullif(btrim(coalesce(p_payload->>'status','')),'');
    if v_view is null or v_view not in ('intake','automation','lab','shades','agreements','tooling','transfers','treatment','tolling','weighing') or not private.specialist_read_allowed(v_role,v_view) then raise exception 'Not permitted' using errcode='42501'; end if;
    if v_page not between 1 and 100000 or length(v_search)>80 or v_state not in ('active','all') or v_sort not in ('priority','newest','due') or coalesce(v_status,'x') !~ '^[a-z_]{1,40}$' then raise exception 'NOV: Invalid specialist filters.'; end if;
    if p_command='detail' then
      v_id:=private.specialist_uuid(p_payload,'id');
      select row_data into v_row from private.specialist_rows(v_company,v_actor,v_role,v_view,'all',v_id) limit 1;
      if v_row is null then raise exception 'NOV: This record is unavailable.'; end if;
      select count(*) into v_total from public.specialist_events where company_id=v_company and view_name=v_view and entity_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(x) order by recorded_at desc,id),'[]'::jsonb) into v_events from (
        select id,action,actor_name as actor,note,recorded_at from public.specialist_events where company_id=v_company and view_name=v_view and entity_id=v_id order by recorded_at desc,id limit 10 offset (v_page-1)*10
      ) x;
      return jsonb_build_object('row',v_row,'events',v_events,'event_count',v_total,'as_of',now());
    end if;
    with visible as (select * from private.specialist_rows(v_company,v_actor,v_role,v_view,v_state,null) where (v_status is null or row_data->>'status'=v_status)
      and (v_search='' or position(lower(v_search) in lower(coalesce(row_data->>'label','')||' '||coalesce(row_data->>'status','')||' '||coalesce(row_data->>'owner','')||' '||coalesce(row_data->>'summary','')))>0))
    select (select count(*) from visible),coalesce((select jsonb_agg(x.row_data order by x.position) from (
      select row_data,row_number() over(order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id')) as position
      from visible order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id') limit 10 offset (v_page-1)*10
    ) x),'[]'::jsonb) into v_total,v_rows;
    return jsonb_build_object('rows',v_rows,'total_count',v_total,'as_of',now());
  elsif p_command='lookup' then
    if length(coalesce(p_payload->>'search',''))>80 then raise exception 'NOV: Keep search within 80 characters.'; end if;
    return private.specialist_lookup(v_company,v_actor,v_role,p_payload);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':specialist',0));
  v_id:=private.specialist_uuid(p_payload,'request_id');
  select * into r from public.specialist_requests where request_id=v_id for update;
  if found and (r.company_id<>v_company or r.actor_id<>v_actor) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_command='preview' then
    if r.request_id is not null then
      if r.mutation is distinct from p_payload->'mutation' then raise exception 'NOV: This request identity belongs to different details.'; end if;
      if not private.specialist_action_allowed(v_role,r.mutation->>'action') then raise exception 'Not permitted' using errcode='42501'; end if;
      return private.specialist_outcome(r);
    end if;
    v_context:=private.specialist_context(v_company,v_actor,p_payload->'mutation',false);
    v_fingerprint:=md5((v_context->'source')::text||(p_payload->'mutation')::text);
    insert into public.specialist_requests(request_id,company_id,actor_id,mutation,fingerprint,review)
      values(v_id,v_company,v_actor,p_payload->'mutation',v_fingerprint,v_context->'review') returning * into r;
  else
    if r.request_id is null then
      if p_command in ('outcome','abandon') then return jsonb_build_object('request_id',v_id,'state','not_recorded','fingerprint',repeat('0',32),'expires_at',now(),'action','',
        'review',jsonb_build_object('title','Original request check','effect','No prepared or committed action exists for this original request.','warnings','[]'::jsonb,'facts','{}'::jsonb),
        'result',jsonb_build_object('label','Not recorded','href',null,'message','No change was committed with this original request identity. It is safe to start a reviewed action.')); end if;
      raise exception 'NOV: The original request was not found. No action was committed with that request identity.';
    end if;
    if (p_command='commit' and not private.specialist_action_allowed(v_role,r.mutation->>'action'))
      or (p_command in ('outcome','abandon') and not private.specialist_read_allowed(v_role,private.specialist_view(r.mutation->>'action'))) then raise exception 'Not permitted' using errcode='42501'; end if;
    if p_command='commit' and r.state='prepared' then
      if r.fingerprint is distinct from p_payload->>'fingerprint' then raise exception 'NOV: Confirmation does not match the reviewed request.'; end if;
      begin
        if r.expires_at<=now() then raise exception 'NOV: This review expired. Review the current source again.'; end if;
        v_context:=private.specialist_context(v_company,v_actor,r.mutation,true);
        if r.fingerprint<>md5((v_context->'source')::text||r.mutation::text) then raise exception 'NOV: A relevant source changed. Review the current details again.'; end if;
        v_result:=private.specialist_apply(v_company,v_actor,v_id,r.mutation,v_context);
        update public.specialist_requests set state='confirmed',result=v_result where request_id=v_id returning * into r;
      exception when others then
        v_message:=case when sqlstate='P0001' and sqlerrm like 'NOV: %' then substring(sqlerrm from 6)
          when sqlstate in ('23514','23P01','55P03') and sqlerrm not like '%violates%' and sqlerrm not like '%constraint%' then sqlerrm
          else 'The existing workflow rejected this action. No change from this request was committed. Refresh the source and review its current requirements.' end;
        update public.specialist_requests set state='rejected',result=jsonb_build_object('label',r.review->>'title','href',null,'message',v_message) where request_id=v_id returning * into r;
      end;
    elsif p_command='abandon' and r.state='prepared' then
      update public.specialist_requests set state='abandoned',result=jsonb_build_object('label',r.review->>'title','href',null,'message','Review cancelled. This request made no change.') where request_id=v_id returning * into r;
    elsif p_command not in ('commit','outcome','abandon') then raise exception 'NOV: Invalid specialist request.';
    end if;
  end if;
  return private.specialist_outcome(r);
end $$;
revoke all on function public.specialist_command(text,jsonb) from public,anon;
grant execute on function public.specialist_command(text,jsonb) to authenticated;
