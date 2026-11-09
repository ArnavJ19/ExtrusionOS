-- November batch 9: quantity-based pricing rules (NOV-064), supplier claims through recovery (NOV-078),
-- estimated versus recorded job profitability (NOV-035), supplier and finishing-vendor reliability
-- (NOV-039), quotation outcomes (NOV-066), reusable remnants (NOV-029), accounting export transfers
-- (NOV-020), compatible production run proposals (NOV-023) and what-if planning scenarios (NOV-024).
-- NOV-082 (display density) is a device preference and needs no schema.
-- Consequential actions use the reviewed request protocol of batches 3 to 8. Additive; depends only on the
-- batch 5 helpers (private.assurance_text/number/date) and private.ist_today, all present on hosted.

------------------------------------------------------------------------------------------------
-- Tenant keys and lookup indexes.
------------------------------------------------------------------------------------------------
create unique index if not exists commercial_customer_tenant_key on public.customers(company_id,id);
create unique index if not exists commercial_quote_tenant_key on public.quotes(company_id,id);
create unique index if not exists commercial_vendor_tenant_key on public.vendors(company_id,id);
create unique index if not exists commercial_po_tenant_key on public.purchase_orders(company_id,id);
create unique index if not exists commercial_po_line_tenant_key on public.purchase_order_lines(company_id,id);
create unique index if not exists commercial_receipt_line_tenant_key on public.purchase_receipt_lines(company_id,id);
create unique index if not exists commercial_invoice_tenant_key on public.invoices(company_id,id);
create unique index if not exists commercial_profile_tenant_key on public.aluminium_profiles(company_id,id);
create unique index if not exists commercial_order_item_tenant_key on public.order_items(company_id,id);
create unique index if not exists commercial_machine_tenant_key on public.machines(company_id,id);
create index if not exists commercial_quote_status_idx on public.quotes(company_id,quote_date desc) where deleted_at is null;
create index if not exists commercial_order_quote_idx on public.orders(company_id,quote_id) where quote_id is not null;
create index if not exists commercial_po_vendor_idx on public.purchase_orders(company_id,vendor_id,order_date desc);
create index if not exists commercial_receipt_line_po_idx on public.purchase_receipt_lines(company_id,purchase_order_line_id);

------------------------------------------------------------------------------------------------
-- NOV-064: versioned, approved charge rules. A calculation records which rule versions priced it.
------------------------------------------------------------------------------------------------
create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  code text not null check(code ~ '^[a-z0-9_]{3,30}$'), version integer not null check(version>0), name text not null check(length(name) between 3 and 80),
  charge_type text not null check(charge_type in ('bracket_rate','minimum_charge','processing_charge')),
  unit_basis text not null check(unit_basis in ('kg','metre','piece')),
  customer_id uuid, finishing_type text check(finishing_type is null or length(finishing_type) between 2 and 40),
  processing_code text check(processing_code is null or processing_code ~ '^[a-z0-9_]{2,30}$'),
  amount numeric(14,2) check(amount is null or amount>0), precedence integer not null default 0 check(precedence between 0 and 100),
  effective_from date not null, effective_to date, status text not null default 'draft' check(status in ('draft','approved','retired')),
  created_by uuid not null, approved_by uuid, approved_at timestamptz, retired_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  unique(company_id,code,version), unique(company_id,id), check(effective_to is null or effective_to>=effective_from),
  check((charge_type='bracket_rate' and amount is null and processing_code is null) or (charge_type='minimum_charge' and amount is not null and processing_code is null)
    or (charge_type='processing_charge' and amount is not null and processing_code is not null)),
  check(status<>'approved' or (approved_by is not null and approved_by<>created_by)),
  foreign key(company_id,customer_id) references public.customers(company_id,id), foreign key(company_id,created_by) references public.app_users(company_id,id)
);
create index pricing_rules_lookup_idx on public.pricing_rules(company_id,status,charge_type,unit_basis);
create unique index pricing_rules_one_draft on public.pricing_rules(company_id,code) where status='draft';
create unique index pricing_rules_one_approved on public.pricing_rules(company_id,code) where status='approved';
create table public.pricing_rule_brackets (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), rule_id uuid not null, seq integer not null check(seq between 1 and 12),
  from_qty numeric(14,3) not null check(from_qty>=0), to_qty numeric(14,3), rate numeric(14,4) not null check(rate>0), unique(rule_id,seq), check(to_qty is null or to_qty>from_qty),
  foreign key(company_id,rule_id) references public.pricing_rules(company_id,id)
);
create table public.pricing_calculations (
  id uuid primary key, company_id uuid not null references public.companies(id), customer_id uuid not null, quote_id uuid, unit_basis text not null check(unit_basis in ('kg','metre','piece')),
  quantity numeric(14,3) not null check(quantity>0), finishing_type text, calc_date date not null, rule_total numeric(14,2) not null, final_total numeric(14,2) not null,
  override_rate numeric(14,4), override_reason text, authority_revision uuid, snapshot jsonb not null, status text not null default 'recorded' check(status in ('recorded','superseded','voided')),
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,customer_id) references public.customers(company_id,id), foreign key(company_id,quote_id) references public.quotes(company_id,id),
  foreign key(company_id,created_by) references public.app_users(company_id,id)
);
create index pricing_calculations_idx on public.pricing_calculations(company_id,status,created_at desc);
create index pricing_calculations_quote_idx on public.pricing_calculations(company_id,quote_id) where quote_id is not null and status='recorded';

------------------------------------------------------------------------------------------------
-- NOV-078: a claim stays open until the agreed replacement, credit or refund is actually linked.
-- Linking never creates a financial credit; it points at one that the finance workflow recorded.
------------------------------------------------------------------------------------------------
create table public.supplier_claims (
  id uuid primary key, company_id uuid not null references public.companies(id), claim_number text not null, vendor_id uuid not null, purchase_order_id uuid not null, purchase_order_line_id uuid not null,
  claim_type text not null check(claim_type in ('shortage','rejected_receipt','wrong_specification','damage')), claimed_quantity numeric(14,3) not null check(claimed_quantity>0),
  claimed_amount numeric(14,2) not null check(claimed_amount>0), requested_remedy text not null check(requested_remedy in ('replacement','credit','refund')),
  status text not null default 'submitted' check(status in ('submitted','disputed','agreed','partially_recovered','rejected','closed')),
  agreed_quantity numeric(14,3) check(agreed_quantity is null or agreed_quantity>=0), agreed_amount numeric(14,2) check(agreed_amount is null or agreed_amount>=0),
  response_due date not null, last_response_at timestamptz, follow_up_owner uuid not null, closed_at timestamptz, close_note text, unresolved_quantity numeric(14,3), unresolved_amount numeric(14,2),
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(company_id,claim_number), unique(company_id,id),
  foreign key(company_id,vendor_id) references public.vendors(company_id,id), foreign key(company_id,purchase_order_id) references public.purchase_orders(company_id,id),
  foreign key(company_id,purchase_order_line_id) references public.purchase_order_lines(company_id,id), foreign key(company_id,follow_up_owner) references public.app_users(company_id,id)
);
create index supplier_claims_open_idx on public.supplier_claims(company_id,status,response_due);
create index supplier_claims_line_idx on public.supplier_claims(company_id,purchase_order_line_id);
create table public.supplier_claim_recoveries (
  id uuid primary key, company_id uuid not null references public.companies(id), claim_id uuid not null, kind text not null check(kind in ('replacement','credit','refund')),
  receipt_line_id uuid, credit_id uuid, quantity numeric(14,3) not null default 0 check(quantity>=0), amount numeric(14,2) not null default 0 check(amount>=0),
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(), reversed_at timestamptz, reversed_by uuid, reverse_note text,
  foreign key(company_id,claim_id) references public.supplier_claims(company_id,id),
  check((kind='replacement' and receipt_line_id is not null and credit_id is null and quantity>0 and amount=0) or (kind<>'replacement' and credit_id is not null and receipt_line_id is null and amount>0 and quantity=0))
);
create unique index supplier_claim_recovery_credit_once on public.supplier_claim_recoveries(company_id,credit_id) where credit_id is not null and reversed_at is null;
create unique index supplier_claim_recovery_receipt_once on public.supplier_claim_recoveries(company_id,receipt_line_id) where receipt_line_id is not null and reversed_at is null;
create index supplier_claim_recoveries_idx on public.supplier_claim_recoveries(company_id,claim_id,recorded_at);

------------------------------------------------------------------------------------------------
-- NOV-035: as-of snapshots. Provisional until finalised; later adjustments are new snapshots.
------------------------------------------------------------------------------------------------
create table public.job_profit_snapshots (
  id uuid primary key, company_id uuid not null references public.companies(id), order_id uuid not null, finalized boolean not null default false, model jsonb not null,
  recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,recorded_by) references public.app_users(company_id,id)
);
create index job_profit_snapshots_order_idx on public.job_profit_snapshots(company_id,order_id,recorded_at desc);

------------------------------------------------------------------------------------------------
-- NOV-039: the original supplier commitment is kept; revisions never erase lateness.
------------------------------------------------------------------------------------------------
create table public.supplier_commitments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), purchase_order_id uuid not null, original_date date not null, current_date_promised date not null,
  revision_count integer not null default 0, history jsonb not null default '[]'::jsonb, recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(company_id,purchase_order_id), foreign key(company_id,purchase_order_id) references public.purchase_orders(company_id,id)
);

------------------------------------------------------------------------------------------------
-- NOV-066: outcomes are recorded only where orders do not already prove a win; reopening is retained.
------------------------------------------------------------------------------------------------
create table public.quote_outcomes (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), quote_id uuid not null, outcome text not null check(outcome in ('lost','withdrawn','no_decision')),
  reason_code text not null check(reason_code in ('price','lead_time','availability','specification','competitor','project_cancelled','no_response','other')),
  evidence text not null check(evidence in ('customer_stated','sales_observed')), product_family text check(product_family is null or length(product_family) between 2 and 60),
  quote_revision integer not null, status text not null default 'active' check(status in ('active','reopened')), recorded_by uuid not null, recorded_at timestamptz not null default clock_timestamp(),
  reopened_by uuid, reopened_at timestamptz,
  foreign key(company_id,quote_id) references public.quotes(company_id,id), foreign key(company_id,recorded_by) references public.app_users(company_id,id)
);
create unique index quote_outcomes_one_active on public.quote_outcomes(company_id,quote_id) where status='active';

------------------------------------------------------------------------------------------------
-- NOV-029: remnants are physical lots with a discrete length, never a free-text note or a kg total.
------------------------------------------------------------------------------------------------
create table public.remnant_lots (
  id uuid primary key, company_id uuid not null references public.companies(id), lot_number text not null, profile_id uuid not null, alloy text, temper text, finish text not null check(length(finish) between 2 and 40),
  length_mm integer not null check(length_mm between 100 and 12000), pieces integer not null check(pieces between 0 and 10000), original_pieces integer not null check(original_pieces between 1 and 10000),
  weight_per_piece_kg numeric(12,4) not null check(weight_per_piece_kg>0), origin_type text not null check(origin_type in ('cutting_remnant','approved_excess')), source_job_id uuid,
  location text not null check(length(location) between 2 and 60), condition text not null default 'good' check(condition in ('good','damaged')),
  status text not null default 'available' check(status in ('available','held','scrapped','exhausted')), ownership text not null default 'company' check(ownership in ('company')),
  measured_by uuid not null, correction_count integer not null default 0, history jsonb not null default '[]'::jsonb, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(company_id,lot_number), unique(company_id,id), check(pieces<=original_pieces or correction_count>0),
  foreign key(company_id,profile_id) references public.aluminium_profiles(company_id,id), foreign key(company_id,measured_by) references public.app_users(company_id,id)
);
create index remnant_lots_search_idx on public.remnant_lots(company_id,profile_id,status,length_mm);
create table public.remnant_allocations (
  id uuid primary key, company_id uuid not null references public.companies(id), lot_id uuid not null, order_item_id uuid not null, pieces integer not null check(pieces>0), cut_length_mm integer not null check(cut_length_mm>0),
  waste_mm_per_piece integer not null check(waste_mm_per_piece>=0), status text not null default 'reserved' check(status in ('reserved','consumed','released')),
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(), resolved_by uuid, resolved_at timestamptz,
  foreign key(company_id,lot_id) references public.remnant_lots(company_id,id), foreign key(company_id,order_item_id) references public.order_items(company_id,id)
);
create index remnant_allocations_idx on public.remnant_allocations(company_id,lot_id,status);
create index remnant_allocations_item_idx on public.remnant_allocations(company_id,order_item_id,status);

------------------------------------------------------------------------------------------------
-- NOV-020: one transaction family (issued invoices to an accounting package) with versioned mappings,
-- stable external identities, duplicate detection and recorded results. No connector is assumed.
------------------------------------------------------------------------------------------------
create table public.transfer_mappings (
  id uuid primary key, company_id uuid not null references public.companies(id), family text not null default 'invoice_export' check(family='invoice_export'), version integer not null check(version>0),
  sales_ledger text not null check(length(sales_ledger) between 2 and 80), tax_ledger text not null check(length(tax_ledger) between 2 and 80), party_key text not null check(party_key in ('gst_number','customer_name')),
  status text not null default 'draft' check(status in ('draft','approved','retired')), created_by uuid not null, approved_by uuid, approved_at timestamptz, retired_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  unique(company_id,family,version), unique(company_id,id), check(status<>'approved' or (approved_by is not null and approved_by<>created_by))
);
create unique index transfer_mappings_one_approved on public.transfer_mappings(company_id,family) where status='approved';
create unique index transfer_mappings_one_draft on public.transfer_mappings(company_id,family) where status='draft';
create table public.transfer_batches (
  id uuid primary key, company_id uuid not null references public.companies(id), batch_number text not null, mapping_id uuid not null, mapping_version integer not null,
  status text not null default 'prepared' check(status in ('prepared','exported','closed','cancelled')), item_count integer not null check(item_count between 1 and 25), total_amount numeric(16,2) not null,
  checksum text not null, prepared_by uuid not null, prepared_at timestamptz not null default clock_timestamp(), exported_at timestamptz, exported_by uuid, closed_at timestamptz,
  unique(company_id,batch_number), unique(company_id,id), foreign key(company_id,mapping_id) references public.transfer_mappings(company_id,id)
);
create table public.transfer_items (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), batch_id uuid not null, invoice_id uuid not null, external_ref text not null,
  amount numeric(14,2) not null, tax_amount numeric(14,2) not null, invoice_fingerprint text not null, state text not null default 'pending' check(state in ('pending','accepted','rejected','cancelled')),
  external_reference text check(external_reference is null or length(external_reference) between 1 and 60), reason text, recorded_by uuid, recorded_at timestamptz,
  foreign key(company_id,batch_id) references public.transfer_batches(company_id,id), foreign key(company_id,invoice_id) references public.invoices(company_id,id)
);
create unique index transfer_items_open_invoice on public.transfer_items(company_id,invoice_id) where state in ('pending','accepted');
create unique index transfer_items_external_ref on public.transfer_items(company_id,external_ref) where state in ('pending','accepted');

------------------------------------------------------------------------------------------------
-- NOV-023 and NOV-024: advisory proposals and isolated scenarios. Neither changes a live schedule.
------------------------------------------------------------------------------------------------
create table public.run_proposals (
  id uuid primary key, company_id uuid not null references public.companies(id), group_key text not null, label text not null, members jsonb not null, saving_changeovers integer not null,
  status text not null default 'proposed' check(status in ('proposed','accepted','dismissed')), created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
  decided_by uuid, decided_at timestamptz, decision_note text
);
create unique index run_proposals_one_open on public.run_proposals(company_id,group_key) where status='proposed';
create table public.planning_scenarios (
  id uuid primary key, company_id uuid not null references public.companies(id), name text not null check(length(name) between 3 and 80), horizon_start date not null,
  horizon_days integer not null check(horizon_days between 3 and 14), source_fingerprint text not null, baseline jsonb not null, changes jsonb not null, result jsonb not null,
  status text not null default 'draft' check(status in ('draft','shared','discarded','accepted')), created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
  decided_by uuid, decided_at timestamptz, decision_note text,
  foreign key(company_id,created_by) references public.app_users(company_id,id)
);
create index planning_scenarios_idx on public.planning_scenarios(company_id,status,created_at desc);

------------------------------------------------------------------------------------------------
-- Shared request identity and history for the commercial hub.
------------------------------------------------------------------------------------------------
create table public.commercial_requests (
  request_id uuid primary key, company_id uuid not null references public.companies(id), actor_id uuid not null,
  mutation jsonb not null, fingerprint text not null, review jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','confirmed','rejected','abandoned')),
  result jsonb, expires_at timestamptz not null default now()+interval '15 minutes', created_at timestamptz not null default now(),
  foreign key(company_id,actor_id) references public.app_users(company_id,id), check((state='prepared')=(result is null))
);
create index commercial_requests_actor_idx on public.commercial_requests(company_id,actor_id,created_at desc);
create table public.commercial_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  view_name text not null, entity_id uuid not null, action text not null, actor_id uuid, actor_name text not null,
  note text not null, facts jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create index commercial_events_entity_idx on public.commercial_events(company_id,view_name,entity_id,recorded_at desc,id);

create function private.commercial_view(p_action text) returns text language sql immutable set search_path=public,private as $$
  select case split_part(p_action,'.',1) when 'pricing' then 'pricing' when 'claim' then 'claims' when 'profit' then 'profitability' when 'commitment' then 'reliability'
    when 'outcome' then 'outcomes' when 'remnant' then 'remnants' when 'mapping' then 'transfers' when 'transfer' then 'transfers' when 'run' then 'runs' when 'scenario' then 'scenarios' end
$$;
create function private.commercial_read_allowed(p_role text,p_view text) returns boolean language sql immutable set search_path=public,private as $$
  select coalesce(case
    when p_role not in ('owner','admin','sales_manager','sales','production_manager','production','factory_manager','dispatch_manager','dispatch','inventory_manager','accounts','quality','viewer') then false
    when p_view is null then true
    when p_view='pricing' then p_role in ('owner','admin','sales_manager','sales','accounts','factory_manager')
    when p_view='claims' then p_role in ('owner','admin','factory_manager','inventory_manager','accounts','quality')
    when p_view='profitability' then p_role in ('owner','admin','accounts','factory_manager')
    when p_view='reliability' then p_role in ('owner','admin','factory_manager','inventory_manager','accounts','quality','production_manager')
    when p_view='outcomes' then p_role in ('owner','admin','sales_manager','sales')
    when p_view='cohorts' then p_role in ('owner','admin','sales_manager')
    when p_view='remnants' then p_role in ('owner','admin','factory_manager','production_manager','production','quality','inventory_manager','dispatch_manager','viewer')
    when p_view='transfers' then p_role in ('owner','admin','accounts')
    when p_view in ('runs','scenarios') then p_role in ('owner','admin','factory_manager','production_manager','production','viewer')
    else false end,false)
$$;
create function private.commercial_action_allowed(p_role text,p_action text) returns boolean language sql immutable set search_path=public,private as $$
  select private.commercial_view(p_action) is not null and private.commercial_read_allowed(p_role,private.commercial_view(p_action)) and p_role<>'viewer' and coalesce(case
    when p_action in ('pricing.define','pricing.approve','pricing.retire') then p_role in ('owner','admin','sales_manager','accounts')
    when p_action in ('pricing.price') then p_role in ('owner','admin','sales_manager','sales')
    when p_action='pricing.void' then p_role in ('owner','admin','sales_manager')
    when p_action like 'claim.%' then p_role in ('owner','admin','factory_manager','inventory_manager','accounts')
    when p_action like 'profit.%' then p_role in ('owner','admin','accounts')
    when p_action like 'commitment.%' then p_role in ('owner','admin','factory_manager','inventory_manager')
    when p_action like 'outcome.%' then p_role in ('owner','admin','sales_manager','sales')
    when p_action in ('remnant.record','remnant.correct') then p_role in ('owner','admin','factory_manager','production_manager','production','inventory_manager')
    when p_action='remnant.review' then p_role in ('owner','admin','factory_manager','production_manager','quality','inventory_manager')
    when p_action like 'remnant.%' then p_role in ('owner','admin','factory_manager','production_manager','inventory_manager')
    when p_action like 'mapping.%' or p_action like 'transfer.%' then p_role in ('owner','admin','accounts')
    when p_action like 'run.%' or p_action like 'scenario.%' then p_role in ('owner','admin','factory_manager','production_manager')
    else false end,false)
$$;
revoke all on function private.commercial_view(text),private.commercial_read_allowed(text,text),private.commercial_action_allowed(text,text) from public,anon;
grant execute on function private.commercial_view(text),private.commercial_read_allowed(text,text),private.commercial_action_allowed(text,text) to authenticated;

do $$ declare t text; begin
  foreach t in array array['pricing_rules','pricing_rule_brackets','pricing_calculations','supplier_claims','supplier_claim_recoveries','job_profit_snapshots','supplier_commitments','quote_outcomes',
    'remnant_lots','remnant_allocations','transfer_mappings','transfer_batches','transfer_items','run_proposals','planning_scenarios','commercial_requests','commercial_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
  end loop;
end $$;
-- Every read goes through public.commercial_command, which applies the role matrix, row scoping and
-- field masking. The only direct read is a person's own prepared request.
grant select on public.commercial_requests to authenticated;
create policy commercial_request_owner on public.commercial_requests for select to authenticated using (
  company_id=private.get_current_user_company_id() and actor_id=auth.uid() and private.get_current_user_dealer_id() is null
  and private.commercial_read_allowed(private.get_current_user_role(),private.commercial_view(mutation->>'action'))
);

create function private.commercial_record(p_company uuid,p_view text,p_entity uuid,p_action text,p_actor uuid,p_note text,p_facts jsonb) returns void
language sql security definer set search_path=public,private as $$
  insert into public.commercial_events(company_id,view_name,entity_id,action,actor_id,actor_name,note,facts)
  values(p_company,p_view,p_entity,p_action,p_actor,coalesce((select nullif(full_name,'') from public.app_users where id=p_actor and company_id=p_company),'System'),p_note,coalesce(p_facts,'{}'::jsonb))
$$;
create function private.commercial_uuid(p_mutation jsonb,p_key text) returns uuid language plpgsql immutable set search_path=public,private as $$
begin
  if jsonb_typeof(p_mutation->p_key) is distinct from 'string' or (p_mutation->>p_key) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'NOV: Choose a valid record for %.',replace(p_key,'_',' '); end if;
  return (p_mutation->>p_key)::uuid;
end $$;
create function private.commercial_member(p_company uuid,p_user uuid) returns public.app_users language plpgsql stable security definer set search_path=public,private as $$
declare u public.app_users;
begin
  select * into u from public.app_users where id=p_user and company_id=p_company and is_active and dealer_id is null and role not in ('viewer','dealer_admin','dealer_staff');
  if u.id is null then raise exception 'NOV: Choose an active employee of this company.'; end if;
  return u;
end $$;
create function private.commercial_outcome(r public.commercial_requests) returns jsonb language sql immutable set search_path=public,private as $$
  select jsonb_build_object('request_id',r.request_id,'state',r.state,'fingerprint',r.fingerprint,'expires_at',r.expires_at,'action',r.mutation->>'action','review',r.review,'result',r.result)
$$;
create function private.commercial_review(p_title text,p_effect text,p_warnings jsonb,p_facts jsonb) returns jsonb language sql immutable set search_path=public,private as $$
  select jsonb_build_object('title',p_title,'effect',p_effect,'warnings',coalesce(p_warnings,'[]'::jsonb),'facts',coalesce(p_facts,'{}'::jsonb))
$$;
create function private.commercial_money(p_value numeric) returns text language sql immutable set search_path=public,private as $$
  select 'INR '||to_char(round(p_value,2),'FM9,99,99,99,990.00')
$$;
revoke all on function private.commercial_record(uuid,text,uuid,text,uuid,text,jsonb),private.commercial_uuid(jsonb,text),private.commercial_member(uuid,uuid),
  private.commercial_outcome(public.commercial_requests),private.commercial_review(text,text,jsonb,jsonb),private.commercial_money(numeric) from public,anon,authenticated;


------------------------------------------------------------------------------------------------
-- NOV-064: bracket and charge evaluation. The whole quantity is priced at the bracket it reaches
-- (a bracket starts at its lower bound and ends before its upper bound). Amounts round to paise per line.
------------------------------------------------------------------------------------------------
create function private.pricing_validate_brackets(p_brackets jsonb) returns void language plpgsql immutable set search_path=public,private as $$
declare v_n integer; v_prev_to numeric; v_from numeric; v_to numeric; v_rate numeric; i integer;
begin
  if jsonb_typeof(p_brackets) is distinct from 'array' then raise exception 'NOV: Enter the quantity brackets.'; end if;
  v_n:=jsonb_array_length(p_brackets);
  if v_n not between 1 and 12 then raise exception 'NOV: A rate rule has 1 to 12 brackets.'; end if;
  for i in 0..v_n-1 loop
    if jsonb_typeof(p_brackets->i->'from') is distinct from 'number' or jsonb_typeof(p_brackets->i->'rate') is distinct from 'number'
      or (p_brackets->i ? 'to' and jsonb_typeof(p_brackets->i->'to') not in ('number','null')) then raise exception 'NOV: Bracket % needs a start quantity and a rate.',i+1; end if;
    if exists(select 1 from jsonb_object_keys(p_brackets->i) k where k not in ('from','to','rate')) then raise exception 'NOV: Bracket % has unknown details.',i+1; end if;
    v_from:=(p_brackets->i->>'from')::numeric; v_to:=nullif(p_brackets->i->>'to','')::numeric; v_rate:=(p_brackets->i->>'rate')::numeric;
    if v_from<0 or v_from<>round(v_from,3) or (v_to is not null and (v_to<>round(v_to,3) or v_to<=v_from)) then raise exception 'NOV: Bracket % needs a start of 0 or more and an end after its start, with at most three decimals.',i+1; end if;
    if v_rate<=0 or v_rate<>round(v_rate,4) or v_rate>10000000 then raise exception 'NOV: Bracket % needs a positive rate with at most four decimals.',i+1; end if;
    if i=0 and v_from<>0 then raise exception 'NOV: The first bracket starts at 0 so every quantity is priced.'; end if;
    if i>0 and v_from<>v_prev_to then raise exception 'NOV: Bracket % must start exactly where bracket % ends (no gap, no overlap).',i+1,i; end if;
    if i>0 and v_prev_to is null then raise exception 'NOV: Only the last bracket may have no upper end.'; end if;
    v_prev_to:=v_to;
  end loop;
end $$;

create function private.pricing_calc(p_company uuid,p_customer uuid,p_finishing text,p_basis text,p_qty numeric,p_date date,p_codes text[]) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare br public.pricing_rules; mn public.pricing_rules; v_b public.pricing_rule_brackets; v_next public.pricing_rule_brackets; v_base numeric(14,2); v_proc jsonb:='[]'::jsonb; v_proc_amt numeric(14,2):=0;
  v_sub numeric(14,2); v_total numeric(14,2); pr record; v_applied boolean:=false; v_next_json jsonb; v_proc_next numeric(14,2); v_next_total numeric(14,2); v_code text; v_found text[]:='{}';
begin
  select * into br from public.pricing_rules r where r.company_id=p_company and r.status='approved' and r.charge_type='bracket_rate' and r.unit_basis=p_basis
    and r.effective_from<=p_date and (r.effective_to is null or r.effective_to>=p_date) and (r.customer_id is null or r.customer_id=p_customer)
    and (r.finishing_type is null or lower(r.finishing_type)=lower(coalesce(p_finishing,'')))
    order by ((r.customer_id is not null)::int*2+(r.finishing_type is not null)::int) desc,r.precedence desc,r.effective_from desc,r.version desc,r.id limit 1;
  if br.id is null then return jsonb_build_object('priced',false,'reason','No approved volume rate applies to this customer, finish, unit and date.'); end if;
  select * into v_b from public.pricing_rule_brackets b where b.rule_id=br.id and b.from_qty<=p_qty and (b.to_qty is null or p_qty<b.to_qty) order by b.seq limit 1;
  if v_b.id is null then return jsonb_build_object('priced',false,'reason',format('The quantity is above the last bracket of %s v%s, which has an upper end.',br.code,br.version)); end if;
  v_base:=round(p_qty*v_b.rate,2);
  for pr in select distinct on (r.processing_code) r.* from public.pricing_rules r where r.company_id=p_company and r.status='approved' and r.charge_type='processing_charge' and r.unit_basis=p_basis
      and r.processing_code=any(coalesce(p_codes,'{}')) and r.effective_from<=p_date and (r.effective_to is null or r.effective_to>=p_date) and (r.customer_id is null or r.customer_id=p_customer)
      and (r.finishing_type is null or lower(r.finishing_type)=lower(coalesce(p_finishing,'')))
      order by r.processing_code,((r.customer_id is not null)::int*2+(r.finishing_type is not null)::int) desc,r.precedence desc,r.effective_from desc,r.version desc,r.id loop
    v_proc:=v_proc||jsonb_build_array(jsonb_build_object('rule_id',pr.id,'code',pr.code,'version',pr.version,'processing_code',pr.processing_code,'rate',pr.amount,'amount',round(p_qty*pr.amount,2)));
    v_proc_amt:=v_proc_amt+round(p_qty*pr.amount,2); v_found:=array_append(v_found,pr.processing_code);
  end loop;
  foreach v_code in array coalesce(p_codes,'{}') loop
    if not (v_code=any(v_found)) then return jsonb_build_object('priced',false,'reason',format('No approved processing charge "%s" applies to this unit and date.',v_code)); end if;
  end loop;
  v_sub:=v_base+v_proc_amt;
  select * into mn from public.pricing_rules r where r.company_id=p_company and r.status='approved' and r.charge_type='minimum_charge' and r.unit_basis=p_basis
    and r.effective_from<=p_date and (r.effective_to is null or r.effective_to>=p_date) and (r.customer_id is null or r.customer_id=p_customer)
    and (r.finishing_type is null or lower(r.finishing_type)=lower(coalesce(p_finishing,'')))
    order by ((r.customer_id is not null)::int*2+(r.finishing_type is not null)::int) desc,r.precedence desc,r.effective_from desc,r.version desc,r.id limit 1;
  v_total:=v_sub;
  if mn.id is not null and v_sub<mn.amount then v_total:=mn.amount; v_applied:=true; end if;
  select * into v_next from public.pricing_rule_brackets b where b.rule_id=br.id and b.from_qty>p_qty order by b.from_qty limit 1;
  if v_next.id is not null then
    select coalesce(sum(round(v_next.from_qty*(x->>'rate')::numeric,2)),0) into v_proc_next from jsonb_array_elements(v_proc) x;
    v_next_total:=greatest(round(v_next.from_qty*v_next.rate,2)+v_proc_next,coalesce(mn.amount,0));
    v_next_json:=jsonb_build_object('from_qty',v_next.from_qty,'rate',v_next.rate,'additional_qty',v_next.from_qty-p_qty,'total_at_start',v_next_total,'difference',v_next_total-v_total);
  end if;
  return jsonb_build_object('priced',true,'basis',p_basis,'quantity',p_qty,'date',p_date,
    'bracket',jsonb_build_object('rule_id',br.id,'code',br.code,'version',br.version,'name',br.name,'seq',v_b.seq,'from_qty',v_b.from_qty,'to_qty',v_b.to_qty,'rate',v_b.rate,
      'customer_specific',br.customer_id is not null,'finish_specific',br.finishing_type is not null),
    'base_amount',v_base,'processing',v_proc,'processing_amount',v_proc_amt,'subtotal',v_sub,
    'minimum',case when mn.id is null then null else jsonb_build_object('rule_id',mn.id,'code',mn.code,'version',mn.version,'amount',mn.amount,'applied',v_applied) end,
    'minimum_uplift',case when v_applied then v_total-v_sub else 0 end,'total',v_total,'effective_rate',round(v_total/p_qty,4),'next_bracket',v_next_json);
end $$;
revoke all on function private.pricing_validate_brackets(jsonb),private.pricing_calc(uuid,uuid,text,text,numeric,date,text[]) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-078: the quantity still open to claim against one purchase line. Shortage is ordered minus
-- received; rejected, wrong-specification and damage claims share the rejected and held quantity so
-- the same pieces are never claimed twice. A rejected claim releases its quantity.
------------------------------------------------------------------------------------------------
create function private.claim_pool(p_company uuid,p_line uuid,p_type text,p_exclude uuid default null) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare l public.purchase_order_lines; v_rec numeric:=0; v_rej numeric:=0; v_held numeric:=0; v_claimed numeric:=0; v_cap numeric;
begin
  select * into l from public.purchase_order_lines where id=p_line and company_id=p_company;
  if l.id is null then return null; end if;
  select coalesce(sum(received_quantity),0),coalesce(sum(rejected_quantity),0),coalesce(sum(held_quantity),0) into v_rec,v_rej,v_held from public.purchase_receipt_lines where company_id=p_company and purchase_order_line_id=p_line;
  v_cap:=case when p_type='shortage' then greatest(l.ordered_quantity-v_rec,0) else v_rej+v_held end;
  select coalesce(sum(claimed_quantity),0) into v_claimed from public.supplier_claims c where c.company_id=p_company and c.purchase_order_line_id=p_line and c.status<>'rejected'
    and (c.id is distinct from p_exclude) and ((p_type='shortage')=(c.claim_type='shortage'));
  return jsonb_build_object('unit',l.unit,'ordered',l.ordered_quantity,'received',v_rec,'rejected',v_rej,'held',v_held,'capacity',v_cap,'claimed',v_claimed,'available',greatest(v_cap-v_claimed,0),'unit_rate',l.unit_rate);
end $$;
create function private.claim_recovery(p_company uuid,p_claim uuid) returns jsonb language sql stable security definer set search_path=public,private as $$
  select jsonb_build_object('quantity',coalesce(sum(quantity),0),'amount',coalesce(sum(amount),0),'count',count(*)) from public.supplier_claim_recoveries where company_id=p_company and claim_id=p_claim and reversed_at is null
$$;
revoke all on function private.claim_pool(uuid,uuid,text,uuid),private.claim_recovery(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-035: a transparent estimate-versus-recorded comparison for one order. Only costs that were
-- linked to the order, its jobs, finishing jobs or dispatches in the expense ledger are counted;
-- everything else is stated as not recorded, never as zero.
------------------------------------------------------------------------------------------------
create function private.profit_model(p_company uuid,p_order uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare o public.orders; s public.order_quote_snapshots; v_est jsonb; v_est_cost numeric; v_est_rev numeric; v_est_kg numeric; v_rev numeric; v_inv integer; v_credit numeric; v_costs jsonb; v_cost_total numeric; v_cost_lines integer;
  v_ids uuid[]; v_billet numeric; v_prod numeric; v_scrap numeric; v_disp numeric; v_missing jsonb:='[]'::jsonb; v_latest public.job_profit_snapshots; v_net numeric; v_final boolean;
begin
  select * into o from public.orders where id=p_order and company_id=p_company and deleted_at is null;
  if o.id is null then return null; end if;
  select * into s from public.order_quote_snapshots where order_id=p_order and company_id=p_company;
  if s.order_id is not null then
    select jsonb_build_object('material',coalesce(sum((l->>'raw_material_cost')::numeric),0),'conversion',coalesce(sum((l->>'conversion_cost')::numeric),0),'finishing',coalesce(sum((l->>'finishing_cost')::numeric),0),
        'die',coalesce(sum((l->>'die_amortization_amount')::numeric),0),'packing',coalesce(sum((l->>'packing_charge')::numeric),0),'transport',coalesce(sum((l->>'transport_charge')::numeric),0),
        'other',coalesce(sum((l->>'other_charges')::numeric),0)),coalesce(sum((l->>'line_total_before_gst')::numeric),0),coalesce(sum((l->>'total_weight_kg')::numeric),0)
      into v_est,v_est_rev,v_est_kg from jsonb_array_elements(s.line_snapshots) l;
    v_est_cost:=(select sum(value::numeric) from jsonb_each_text(v_est));
  else v_missing:=v_missing||jsonb_build_array('No accepted quotation snapshot is linked to this order, so there is no estimate to compare.'); end if;
  select coalesce(sum(i.subtotal),0),count(*) into v_rev,v_inv from public.invoices i where i.company_id=p_company and i.order_id=p_order and i.deleted_at is null and i.status not in ('draft','cancelled');
  select coalesce(sum(c.subtotal),0) into v_credit from public.credit_notes c join public.invoices i on i.id=c.invoice_id and i.company_id=c.company_id where c.company_id=p_company and i.order_id=p_order and c.status='issued';
  if v_inv=0 then v_missing:=v_missing||jsonb_build_array('No issued invoice yet, so revenue is not recorded.'); end if;
  v_net:=v_rev-v_credit;
  select array_agg(x) into v_ids from (select p_order x union select id from public.production_jobs where company_id=p_company and order_id=p_order union select id from public.finishing_jobs where company_id=p_company and order_id=p_order
    union select id from public.dispatches where company_id=p_company and order_id=p_order) q;
  select coalesce(jsonb_agg(jsonb_build_object('category',category,'amount',amt,'lines',n) order by category),'[]'::jsonb),coalesce(sum(amt),0),coalesce(sum(n),0)::integer into v_costs,v_cost_total,v_cost_lines from (
    select e.expense_category category,sum(e.total_amount) amt,count(*) n from public.expense_ledger e where e.company_id=p_company and e.deleted_at is null and e.source_record_id=any(v_ids) group by 1) q;
  if v_cost_lines=0 then v_missing:=v_missing||jsonb_build_array('No expense is linked to this order, its jobs, finishing jobs or dispatches, so recorded cost is not available.'); end if;
  select coalesce(sum(fb.weight_kg),0) into v_billet from public.production_billet_issues pbi join public.foundry_billets fb on fb.id=pbi.billet_id and fb.company_id=pbi.company_id
    join public.production_jobs j on j.id=pbi.production_job_id and j.company_id=pbi.company_id where pbi.company_id=p_company and j.order_id=p_order;
  select coalesce(sum(actual_quantity_kg),0) into v_prod from public.production_jobs where company_id=p_company and order_id=p_order and status<>'cancelled';
  select coalesce(sum(weight_kg),0) into v_scrap from public.scrap_records where company_id=p_company and order_id=p_order;
  select coalesce(sum(total_weight_kg),0) into v_disp from public.dispatches where company_id=p_company and order_id=p_order and delivery_status<>'cancelled';
  select * into v_latest from public.job_profit_snapshots where company_id=p_company and order_id=p_order order by recorded_at desc,id limit 1;
  v_final:=exists(select 1 from public.job_profit_snapshots where company_id=p_company and order_id=p_order and finalized);
  return jsonb_build_object('order_id',o.id,'order_number',o.order_number,'has_estimate',s.order_id is not null,'estimate',v_est,'estimated_cost',v_est_cost,'estimated_revenue',v_est_rev,'estimated_kg',v_est_kg,
    'estimated_margin',case when s.order_id is not null then v_est_rev-v_est_cost end,'invoiced_revenue',case when v_inv>0 then v_rev end,'credited',v_credit,'net_revenue',case when v_inv>0 then v_net end,'invoice_count',v_inv,
    'recorded_costs',v_costs,'recorded_cost_total',case when v_cost_lines>0 then v_cost_total end,'recorded_cost_lines',v_cost_lines,
    'revenue_variance',case when s.order_id is not null and v_inv>0 then v_net-v_est_rev end,'cost_variance',case when s.order_id is not null and v_cost_lines>0 then v_cost_total-v_est_cost end,
    'recorded_margin',case when v_inv>0 and v_cost_lines>0 then v_net-v_cost_total end,
    'billet_kg_issued',v_billet,'produced_kg',v_prod,'scrap_kg',v_scrap,'dispatched_kg',v_disp,
    'missing',v_missing,'finalized',v_final,'adjusted_after_final',v_final and not coalesce(v_latest.finalized,false),'latest_snapshot',case when v_latest.id is null then null else jsonb_build_object('id',v_latest.id,'recorded_at',v_latest.recorded_at,'finalized',v_latest.finalized) end,
    'status',case when v_final then 'finalized' else 'provisional' end);
end $$;
revoke all on function private.profit_model(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-039: reliability evidence for one vendor. Quantities stay in their own units; a small sample is
-- stated, never ranked.
------------------------------------------------------------------------------------------------
create function private.vendor_reliability(p_company uuid,p_vendor uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_pos integer; v_cancel integer:=0; v_commit integer; v_ontime integer; v_late integer; v_open_due integer; v_units jsonb; v_claims jsonb; v_fin jsonb; v_today date:=private.ist_today();
begin
  select count(*) into v_pos from public.purchase_orders where company_id=p_company and vendor_id=p_vendor;
  with po as (select p.id,c.original_date,c.current_date_promised,(select min(r.receipt_date) from public.purchase_receipts r where r.company_id=p.company_id and r.purchase_order_id=p.id) first_receipt
      from public.purchase_orders p join public.supplier_commitments c on c.company_id=p.company_id and c.purchase_order_id=p.id where p.company_id=p_company and p.vendor_id=p_vendor)
  select count(*),count(*) filter (where first_receipt is not null and first_receipt<=original_date),count(*) filter (where first_receipt is not null and first_receipt>original_date),
      count(*) filter (where first_receipt is null and original_date<v_today)
    into v_commit,v_ontime,v_late,v_open_due from po;
  select coalesce(jsonb_agg(jsonb_build_object('unit',unit,'ordered',ord,'received',rec,'accepted',acc,'rejected',rej,'held',held) order by unit),'[]'::jsonb) into v_units from (
    select l.unit,sum(l.ordered_quantity) ord,coalesce(sum(r.rec),0) rec,coalesce(sum(r.acc),0) acc,coalesce(sum(r.rej),0) rej,coalesce(sum(r.held),0) held
    from public.purchase_order_lines l join public.purchase_orders p on p.id=l.purchase_order_id and p.company_id=l.company_id
    left join lateral (select sum(received_quantity) rec,sum(accepted_quantity) acc,sum(rejected_quantity) rej,sum(held_quantity) held from public.purchase_receipt_lines x where x.company_id=l.company_id and x.purchase_order_line_id=l.id) r on true
    where l.company_id=p_company and p.vendor_id=p_vendor group by l.unit) q;
  select jsonb_build_object('total',count(*),'open',count(*) filter (where status not in ('closed','rejected')),'closed',count(*) filter (where status='closed'),'rejected',count(*) filter (where status='rejected')) into v_claims
    from public.supplier_claims where company_id=p_company and vendor_id=p_vendor;
  select jsonb_build_object('jobs',count(*),'measured',count(*) filter (where sent_date is not null and received_date is not null and received_date>=sent_date),
      'avg_turnaround_days',round(avg((received_date-sent_date)::numeric) filter (where sent_date is not null and received_date is not null and received_date>=sent_date),1),
      'input_kg',coalesce(sum(input_weight_kg),0),'rejected_kg',coalesce(sum(rejection_weight_kg),0)) into v_fin from public.finishing_jobs where company_id=p_company and vendor_id=p_vendor;
  return jsonb_build_object('purchase_orders',v_pos,'with_commitment',coalesce(v_commit,0),'on_time',coalesce(v_ontime,0),'late',coalesce(v_late,0),'open_past_date',coalesce(v_open_due,0),'units',v_units,'claims',v_claims,'finishing',v_fin,
    'sample_ok',coalesce(v_commit,0)>=5,'finishing_sample_ok',coalesce((v_fin->>'measured')::integer,0)>=5);
end $$;
revoke all on function private.vendor_reliability(uuid,uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-066: where the orders already prove a win, no outcome is entered. Share of the quotation that
-- was ordered is measured in kilograms.
------------------------------------------------------------------------------------------------
create function private.quote_order_share(p_company uuid,p_quote uuid) returns jsonb language sql stable security definer set search_path=public,private as $$
  select jsonb_build_object('orders',count(*),'ordered_kg',coalesce(sum(o.requested_weight_kg),0),'quoted_kg',(select coalesce(sum(total_weight_kg),0) from public.quote_items where company_id=p_company and quote_id=p_quote),
    'order_value',coalesce(sum(o.order_value),0)) from public.orders o where o.company_id=p_company and o.quote_id=p_quote and o.deleted_at is null and o.current_stage<>'cancelled'
$$;
create function private.quote_class(p_status text,p_valid_until date,p_orders integer,p_ordered_kg numeric,p_quoted_kg numeric,p_outcome text) returns text language sql immutable set search_path=public,private as $$
  select case
    when p_status in ('draft','internal_review','approved_for_sending') then 'not_issued'
    when p_orders>0 and p_quoted_kg>0 and p_ordered_kg>=p_quoted_kg*0.98 then 'won'
    when p_orders>0 and p_quoted_kg>0 then 'partially_won'
    when p_orders>0 then 'won'
    when p_outcome is not null then p_outcome
    when p_status in ('customer_rejected','expired') or (p_valid_until is not null and p_valid_until<private.ist_today()) then 'needs_reason'
    else 'open' end
$$;
revoke all on function private.quote_order_share(uuid,uuid),private.quote_class(text,date,integer,numeric,numeric,text) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-029: compatible requirements for one remnant lot. A requirement matches only when the profile,
-- alloy, temper and finish agree and one cut fits in the discrete length; expected waste is the
-- leftover per piece. Kilograms alone never prove a length exists.
------------------------------------------------------------------------------------------------
create function private.remnant_matches(p_company uuid,p_lot uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare l public.remnant_lots; v jsonb;
begin
  select * into l from public.remnant_lots where id=p_lot and company_id=p_company;
  if l.id is null or l.status<>'available' or l.condition<>'good' or l.pieces-coalesce((select sum(pieces) from public.remnant_allocations where company_id=p_company and lot_id=l.id and status='reserved'),0)<=0 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('order_item_id',x.id,'order_number',x.order_number,'cut_length_mm',x.cut_mm,'pieces_needed',x.need,'pieces_open',x.open,'waste_mm_per_piece',l.length_mm-x.cut_mm,
      'customer',x.customer_name,'due',x.expected_dispatch_date) order by x.expected_dispatch_date nulls last,x.order_number),'[]'::jsonb) into v from (
    select * from (
      select oi.id,o.order_number,o.expected_dispatch_date,c.customer_name,round(coalesce(oi.cut_length,oi.length_per_piece_m*1000)::numeric)::integer cut_mm,
        coalesce(oi.quantity_pieces,oi.order_quantity::integer,0) need,
        greatest(coalesce(oi.quantity_pieces,oi.order_quantity::integer,0)-coalesce((select sum(a.pieces) from public.remnant_allocations a where a.company_id=oi.company_id and a.order_item_id=oi.id and a.status in ('reserved','consumed')),0),0) open
      from public.order_items oi join public.orders o on o.id=oi.order_id and o.company_id=oi.company_id left join public.customers c on c.id=o.customer_id and c.company_id=o.company_id
      left join public.aluminium_profiles pf on pf.id=oi.profile_id and pf.company_id=oi.company_id
      where oi.company_id=p_company and oi.profile_id=l.profile_id and o.deleted_at is null and o.current_stage not in ('cancelled','closed','delivered','payment_pending','dispatched')
        and (l.alloy is null or coalesce(pf.alloy,l.alloy)=l.alloy) and (l.temper is null or coalesce(pf.temper,l.temper)=l.temper)
        and (oi.finishing_type is null or lower(oi.finishing_type)=lower(l.finish) or lower(l.finish) in ('mill finish','mill')) ) q
    where q.cut_mm is not null and q.cut_mm>0 and q.cut_mm<=l.length_mm and q.open>0 limit 10) x;
  return v;
end $$;
revoke all on function private.remnant_matches(uuid,uuid) from public,anon,authenticated;


------------------------------------------------------------------------------------------------
-- NOV-023: compatible run proposals. Hard rules: the same profile, die, alloy, temper, finish and
-- drawing revision, and (for a customer-owned die) the same customer. Different values are never
-- merged because a profile code matches. Duration and yield are not estimated: no source exists here.
------------------------------------------------------------------------------------------------
create function private.run_groups(p_company uuid) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v jsonb;
begin
  with cand as (
    select j.id,coalesce(j.job_number,'Job') job_number,o.id order_id,o.order_number,o.expected_dispatch_date due,c.customer_name,o.customer_id,j.profile_id,j.die_id,greatest(j.planned_quantity_kg-j.actual_quantity_kg,0) kg,j.planned_date,
      coalesce(j.alloy_id::text,'') alloy,coalesce(j.temper_id::text,'') temper,coalesce(lower(j.finishing_type),'') finish,coalesce(j.drawing_revision,'') rev,d.die_number,pf.profile_code,d.die_status,
      case when d.customer_id is not null and d.ownership_type not in ('company','own','in_house','internal') then d.customer_id end owner_customer,
      exists(select 1 from public.returnable_gate_passes g where g.company_id=j.company_id and g.die_id=j.die_id and g.status in ('approved','out')) die_out
    from public.production_jobs j join public.orders o on o.id=j.order_id and o.company_id=j.company_id join public.dies d on d.id=j.die_id and d.company_id=j.company_id
      join public.aluminium_profiles pf on pf.id=j.profile_id and pf.company_id=j.company_id left join public.customers c on c.id=o.customer_id and c.company_id=o.company_id
    where j.company_id=p_company and j.status in ('planned','ready') and j.die_id is not null and o.deleted_at is null and o.current_stage not in ('cancelled','closed','delivered','payment_pending')
      and (j.planned_date is null or j.planned_date<=private.ist_today()+14))
  select coalesce(jsonb_agg(g.obj order by g.min_due nulls last,g.kg desc,g.key),'[]'::jsonb) into v from (
    select md5(concat_ws('|',profile_id,die_id,alloy,temper,finish,rev,coalesce(owner_customer::text,''),string_agg(id::text,',' order by id))) key,min(due) min_due,sum(kg) kg,
      jsonb_build_object('key',md5(concat_ws('|',profile_id,die_id,alloy,temper,finish,rev,coalesce(owner_customer::text,''),string_agg(id::text,',' order by id))),
        'die_id',die_id,'die_number',min(die_number),'profile_code',min(profile_code),'die_status',min(die_status),'die_out',bool_or(die_out),'member_count',count(*),'orders',count(distinct order_id),
        'customers',count(distinct customer_id),'total_kg',sum(kg),'earliest_due',min(due),'changeovers_saved',count(*)-1,
        'finish',nullif(min(finish),''),'drawing_revision',nullif(min(rev),''),
        'not_merged',(select count(*) from cand c2 where c2.profile_id=cand.profile_id and c2.die_id=cand.die_id)-count(*),
        'members',jsonb_agg(jsonb_build_object('job_id',id,'job_number',job_number,'order_id',order_id,'order_number',order_number,'customer',customer_name,'kg',kg,'due',due,'planned_date',planned_date) order by due nulls last,job_number,id)) obj
    from cand group by profile_id,die_id,alloy,temper,finish,rev,owner_customer having count(*)>=2) g;
  return v;
end $$;
revoke all on function private.run_groups(uuid) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-024: scenario snapshot and isolated simulation. Capacity comes only from recorded shift
-- capacity and planned maintenance blocks; a press with none is stated as not simulated, never as
-- unlimited or zero. Jobs fill each press in priority order, never before their planned date.
------------------------------------------------------------------------------------------------
create function private.scenario_snapshot(p_company uuid,p_start date,p_days integer) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_machines jsonb; v_jobs jsonb; v_excl jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.machine_name,'measured',cap.n>0,'caps',cap.arr) order by m.machine_name,m.id),'[]'::jsonb) into v_machines
  from public.machines m cross join lateral (
    select (select count(*) from public.factory_shift_capacities c where c.company_id=m.company_id and c.machine_id=m.id) n,
      (select coalesce(jsonb_agg(greatest(
        coalesce((select sum(c.capacity_kg) from public.factory_shift_capacities c where c.company_id=m.company_id and c.machine_id=m.id and c.weekday=extract(isodow from p_start+g)::integer),0)
        *(1-least(1,coalesce((select sum(extract(epoch from least(b.ends_at,((p_start+g+1)::timestamp at time zone 'Asia/Kolkata'))-greatest(b.starts_at,((p_start+g)::timestamp at time zone 'Asia/Kolkata')))/86400)
          from public.factory_maintenance_blocks b where b.company_id=m.company_id and b.machine_id=m.id and b.status='planned'
            and b.starts_at<((p_start+g+1)::timestamp at time zone 'Asia/Kolkata') and b.ends_at>((p_start+g)::timestamp at time zone 'Asia/Kolkata')),0))),0) order by g),'[]'::jsonb)
       from generate_series(0,p_days-1) g) arr) cap
  where m.company_id=p_company and m.is_active;
  select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'number',coalesce(j.job_number,'Job'),'order_number',o.order_number,'machine_id',j.machine_id,'planned_idx',greatest(0,coalesce(j.planned_date,p_start)-p_start),
      'planned_date',j.planned_date,'kg',greatest(j.planned_quantity_kg-j.actual_quantity_kg,0),'due',o.expected_dispatch_date,'status',j.status) order by j.machine_id,j.planned_date nulls first,j.job_number,j.id),'[]'::jsonb) into v_jobs
  from public.production_jobs j join public.orders o on o.id=j.order_id and o.company_id=j.company_id
  where j.company_id=p_company and j.status in ('planned','ready','in_progress') and j.machine_id is not null and o.deleted_at is null and o.current_stage not in ('cancelled','closed')
    and (j.planned_date is null or j.planned_date<=p_start+p_days-1) and j.planned_quantity_kg-j.actual_quantity_kg>0;
  select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'number',coalesce(j.job_number,'Job'),'reason',case when j.machine_id is null then 'No press assigned' else 'On hold' end) order by j.job_number,j.id),'[]'::jsonb) into v_excl
  from public.production_jobs j join public.orders o on o.id=j.order_id and o.company_id=j.company_id
  where j.company_id=p_company and ((j.status in ('planned','ready','in_progress') and j.machine_id is null) or j.status='on_hold') and o.deleted_at is null and o.current_stage not in ('cancelled','closed')
    and (j.planned_date is null or j.planned_date<=p_start+p_days-1);
  return jsonb_build_object('start',p_start,'days',p_days,'machines',v_machines,'jobs',v_jobs,'excluded',v_excl);
end $$;

create function private.scenario_simulate(p_snap jsonb,p_changes jsonb) returns jsonb language plpgsql immutable set search_path=public,private as $$
declare v_start date:=(p_snap->>'start')::date; v_days integer:=(p_snap->>'days')::integer; v_caps jsonb:='{}'::jsonb; v_jobs jsonb:=p_snap->'jobs'; ch jsonb; m jsonb; rec record; d integer; v_rem numeric; v_take numeric; v_fin integer;
  v_cap numeric; v_out jsonb:='[]'::jsonb; v_measured boolean; v_machine text; v_n integer; v_due date;
begin
  for m in select value from jsonb_array_elements(p_snap->'machines') loop
    v_caps:=v_caps||jsonb_build_object(m->>'id',jsonb_build_object('measured',(m->>'measured')::boolean,'caps',m->'caps'));
  end loop;
  for ch in select value from jsonb_array_elements(coalesce(p_changes,'[]'::jsonb)) loop
    if ch->>'type'='machine_down' then
      for d in 0..v_days-1 loop
        if v_start+d>=(ch->>'from_date')::date and v_start+d<(ch->>'from_date')::date+(ch->>'days')::integer then
          v_caps:=jsonb_set(v_caps,array[ch->>'machine_id','caps',d::text],'0'::jsonb);
        end if;
      end loop;
    elsif ch->>'type'='extra_shift' then
      d:=(ch->>'date')::date-v_start;
      v_caps:=jsonb_set(v_caps,array[ch->>'machine_id','caps',d::text],to_jsonb((v_caps->(ch->>'machine_id')->'caps'->>d)::numeric+(ch->>'kg')::numeric));
    elsif ch->>'type'='delayed_receipt' then
      select coalesce(jsonb_agg(case when x->>'id'=ch->>'job_id' then jsonb_set(x,'{planned_idx}',to_jsonb((x->>'planned_idx')::integer+(ch->>'days')::integer)) else x end),'[]'::jsonb) into v_jobs from jsonb_array_elements(v_jobs) x;
    elsif ch->>'type'='urgent_order' then
      v_jobs:=v_jobs||jsonb_build_array(jsonb_build_object('id',null,'number','HYPOTHETICAL URGENT ORDER','order_number','Hypothetical','machine_id',ch->>'machine_id','planned_idx',0,'planned_date',v_start,
        'kg',(ch->>'kg')::numeric,'due',ch->>'due_date','status','hypothetical','hypothetical',true));
    end if;
  end loop;
  for rec in select x.value job from jsonb_array_elements(v_jobs) x
      order by x.value->>'machine_id',case when x.value->>'status'='in_progress' or coalesce((x.value->>'hypothetical')::boolean,false) then 0 else 1 end,(x.value->>'planned_idx')::integer,x.value->>'number',x.value->>'id' loop
    v_machine:=rec.job->>'machine_id'; v_measured:=coalesce((v_caps->v_machine->>'measured')::boolean,false); v_due:=nullif(rec.job->>'due','')::date;
    if not v_measured then
      v_out:=v_out||jsonb_build_array(rec.job||jsonb_build_object('simulated',false,'finish_date',null,'unscheduled_kg',null,'late',null));
      continue;
    end if;
    v_rem:=(rec.job->>'kg')::numeric; v_fin:=null;
    for d in least((rec.job->>'planned_idx')::integer,v_days)..v_days-1 loop
      v_cap:=(v_caps->v_machine->'caps'->>d)::numeric; v_take:=least(v_rem,v_cap);
      v_caps:=jsonb_set(v_caps,array[v_machine,'caps',d::text],to_jsonb(v_cap-v_take)); v_rem:=v_rem-v_take;
      if v_rem<=0 then v_fin:=d; exit; end if;
    end loop;
    v_out:=v_out||jsonb_build_array(rec.job||jsonb_build_object('simulated',true,'finish_date',case when v_fin is null then null else v_start+v_fin end,'unscheduled_kg',case when v_fin is null then v_rem else 0 end,
      'late',case when v_fin is null then null when v_due is null then null else (v_start+v_fin)>v_due end));
  end loop;
  return v_out;
end $$;

create function private.scenario_evaluate(p_snap jsonb,p_changes jsonb) returns jsonb language plpgsql immutable set search_path=public,private as $$
declare b jsonb:=private.scenario_simulate(p_snap,'[]'::jsonb); s jsonb:=private.scenario_simulate(p_snap,p_changes); v_delayed integer; v_new_late integer; v_new_unsched integer; v_unmeasured integer; v_urgent jsonb;
  v_kg_b numeric; v_kg_s numeric;
begin
  select count(*) filter (where sj->>'finish_date' is not null and bj->>'finish_date' is not null and (sj->>'finish_date')::date>(bj->>'finish_date')::date),
      count(*) filter (where coalesce((sj->>'late')::boolean,false) and not coalesce((bj->>'late')::boolean,false)),
      count(*) filter (where (sj->>'simulated')::boolean and sj->>'finish_date' is null and bj->>'finish_date' is not null)
    into v_delayed,v_new_late,v_new_unsched from (select x.value sj,(select y.value from jsonb_array_elements(b) y where y.value->>'id'=x.value->>'id') bj from jsonb_array_elements(s) x where x.value->>'id' is not null) q;
  select count(*) filter (where not (x.value->>'simulated')::boolean) into v_unmeasured from jsonb_array_elements(s) x;
  select coalesce(sum((x.value->>'unscheduled_kg')::numeric) filter (where (x.value->>'simulated')::boolean),0) into v_kg_b from jsonb_array_elements(b) x;
  select coalesce(sum((x.value->>'unscheduled_kg')::numeric) filter (where (x.value->>'simulated')::boolean),0) into v_kg_s from jsonb_array_elements(s) x;
  select x.value into v_urgent from jsonb_array_elements(s) x where coalesce((x.value->>'hypothetical')::boolean,false) limit 1;
  return jsonb_build_object('baseline',b,'scenario',s,'summary',jsonb_build_object('jobs_delayed',v_delayed,'newly_late',v_new_late,'newly_unscheduled',v_new_unsched,'not_simulated',v_unmeasured,
    'unscheduled_kg_baseline',v_kg_b,'unscheduled_kg_scenario',v_kg_s,'urgent',v_urgent));
end $$;
revoke all on function private.scenario_snapshot(uuid,date,integer),private.scenario_simulate(jsonb,jsonb),private.scenario_evaluate(jsonb,jsonb) from public,anon,authenticated;

create function private.scenario_validate_changes(p_snap jsonb,p_changes jsonb) returns void language plpgsql immutable set search_path=public,private as $$
declare v_start date:=(p_snap->>'start')::date; v_days integer:=(p_snap->>'days')::integer; ch jsonb; v_n integer; i integer; v_date date;
begin
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'NOV: Enter the hypothetical changes.'; end if;
  v_n:=jsonb_array_length(p_changes);
  if v_n not between 1 and 6 then raise exception 'NOV: A scenario holds 1 to 6 hypothetical changes.'; end if;
  for i in 0..v_n-1 loop
    ch:=p_changes->i;
    if jsonb_typeof(ch) is distinct from 'object' or ch->>'type' not in ('machine_down','extra_shift','urgent_order','delayed_receipt') then raise exception 'NOV: Change % is not a supported kind.',i+1; end if;
    if ch->>'type' in ('machine_down','extra_shift','urgent_order') and not exists(select 1 from jsonb_array_elements(p_snap->'machines') m where m.value->>'id'=ch->>'machine_id') then
      raise exception 'NOV: Change % names a press that is not in the snapshot.',i+1; end if;
    if ch->>'type' in ('extra_shift','urgent_order','machine_down') and (select not (m.value->>'measured')::boolean from jsonb_array_elements(p_snap->'machines') m where m.value->>'id'=ch->>'machine_id') then
      raise exception 'NOV: Change % names a press with no recorded shift capacity, so it cannot be simulated.',i+1; end if;
    if ch->>'type'='machine_down' then
      if exists(select 1 from jsonb_object_keys(ch) k where k not in ('type','machine_id','from_date','days')) or ch->>'from_date' !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(ch->'days') is distinct from 'number' then raise exception 'NOV: Change % needs a press, a first day and a number of days.',i+1; end if;
      v_date:=(ch->>'from_date')::date;
      if v_date<v_start or v_date>v_start+v_days-1 or (ch->>'days')::numeric<>round((ch->>'days')::numeric) or (ch->>'days')::integer not between 1 and v_days then raise exception 'NOV: Change % must start inside the horizon and last 1 to % whole days.',i+1,v_days; end if;
    elsif ch->>'type'='extra_shift' then
      if exists(select 1 from jsonb_object_keys(ch) k where k not in ('type','machine_id','date','kg')) or ch->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(ch->'kg') is distinct from 'number' then raise exception 'NOV: Change % needs a press, a day and the extra kilograms.',i+1; end if;
      v_date:=(ch->>'date')::date;
      if v_date<v_start or v_date>v_start+v_days-1 or (ch->>'kg')::numeric<=0 or (ch->>'kg')::numeric>1000000 or (ch->>'kg')::numeric<>round((ch->>'kg')::numeric,3) then raise exception 'NOV: Change % must fall inside the horizon with 0.001 to 1,000,000 kg.',i+1; end if;
    elsif ch->>'type'='urgent_order' then
      if exists(select 1 from jsonb_object_keys(ch) k where k not in ('type','machine_id','kg','due_date')) or ch->>'due_date' !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(ch->'kg') is distinct from 'number' then raise exception 'NOV: Change % needs a press, a quantity and a due date.',i+1; end if;
      if (ch->>'kg')::numeric<=0 or (ch->>'kg')::numeric>1000000 or (ch->>'kg')::numeric<>round((ch->>'kg')::numeric,3) then raise exception 'NOV: Change % needs 0.001 to 1,000,000 kg.',i+1; end if;
      perform (ch->>'due_date')::date;
    else
      if exists(select 1 from jsonb_object_keys(ch) k where k not in ('type','job_id','days')) or jsonb_typeof(ch->'days') is distinct from 'number' or jsonb_typeof(ch->'job_id') is distinct from 'string' then raise exception 'NOV: Change % needs a job and a delay in days.',i+1; end if;
      if (ch->>'days')::numeric<>round((ch->>'days')::numeric) or (ch->>'days')::integer not between 1 and 14 then raise exception 'NOV: Change % delays by 1 to 14 whole days.',i+1; end if;
      if not exists(select 1 from jsonb_array_elements(p_snap->'jobs') j where j.value->>'id'=ch->>'job_id') then raise exception 'NOV: Change % names a job that is not in the snapshot.',i+1; end if;
    end if;
  end loop;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'NOV: A scenario change has an invalid date.';
end $$;
revoke all on function private.scenario_validate_changes(jsonb,jsonb) from public,anon,authenticated;

------------------------------------------------------------------------------------------------
-- NOV-020: invoice export. A fingerprint of the amounts is kept with each item so a later credit
-- note or amendment is visible against what was exported.
------------------------------------------------------------------------------------------------
create function private.transfer_fp(i public.invoices) returns text language sql immutable set search_path=public,private as $$
  select md5(concat_ws('|',i.invoice_number,i.invoice_date,i.subtotal,i.tax_total,i.grand_total,i.status,i.customer_id))
$$;
create function private.transfer_ref(p_invoice uuid) returns text language sql immutable set search_path=public,private as $$
  select 'EOS-INV-'||upper(replace(p_invoice::text,'-',''))
$$;
create function private.transfer_eligible(p_company uuid) returns setof public.invoices language sql stable security definer set search_path=public,private as $$
  select i.* from public.invoices i where i.company_id=p_company and i.deleted_at is null and i.status not in ('draft','cancelled') and i.invoice_number is not null
    and not exists(select 1 from public.transfer_items t where t.company_id=i.company_id and t.invoice_id=i.id and t.state in ('pending','accepted')) order by i.invoice_date,i.invoice_number,i.id
$$;
revoke all on function private.transfer_fp(public.invoices),private.transfer_ref(uuid),private.transfer_eligible(uuid) from public,anon,authenticated;


------------------------------------------------------------------------------------------------
-- Read models. Each row is {id,label,status,owner,due_date,summary,source_href,details}.
------------------------------------------------------------------------------------------------
create function private.commercial_rows(p_company uuid,p_actor uuid,p_role text,p_view text,p_state text,p_id uuid default null)
returns table(row_data jsonb,sort_rank integer,sort_due date,sort_new timestamptz) language plpgsql stable security definer set search_path=public,private as $$
declare v_today date:=private.ist_today();
begin
  if p_view='pricing' then
    return query
    select jsonb_build_object('id',r.id,'label',concat(r.code,' v',r.version,' · ',r.name),'status',st.s,'owner',cu.full_name,'due_date',r.effective_to,
        'summary',concat(case r.charge_type when 'bracket_rate' then 'Volume rate' when 'minimum_charge' then 'Minimum charge' else 'Processing charge '||r.processing_code end,' per ',r.unit_basis,' · ',
          coalesce(c.customer_name,'all customers'),' · ',coalesce(r.finishing_type,'any finish'),' · from ',to_char(r.effective_from,'DD Mon YYYY'),
          case when r.charge_type<>'bracket_rate' then ' · '||private.commercial_money(r.amount) else ' · '||bc.n||' bracket(s)' end),
        'source_href',null,
        'details',jsonb_build_object('kind','rule','rule_id',r.id,'code',r.code,'version',r.version,'name',r.name,'charge_type',r.charge_type,'unit_basis',r.unit_basis,'customer',c.customer_name,'customer_id',r.customer_id,
          'finishing_type',r.finishing_type,'processing_code',r.processing_code,'amount',r.amount,'precedence',r.precedence,'effective_from',r.effective_from,'effective_to',r.effective_to,'rule_status',r.status,
          'created_by',cu.full_name,'created_by_id',r.created_by,'approved_by',au.full_name,'approved_at',r.approved_at,
          'brackets',(select coalesce(jsonb_agg(jsonb_build_object('seq',b.seq,'from_qty',b.from_qty,'to_qty',b.to_qty,'rate',b.rate) order by b.seq),'[]'::jsonb) from public.pricing_rule_brackets b where b.rule_id=r.id))),
      case st.s when 'draft' then 0 when 'approved' then 3 when 'scheduled' then 3 else 9 end,r.effective_from,r.created_at
    from public.pricing_rules r left join public.customers c on c.id=r.customer_id and c.company_id=r.company_id left join public.app_users cu on cu.id=r.created_by and cu.company_id=r.company_id
      left join public.app_users au on au.id=r.approved_by and au.company_id=r.company_id
      cross join lateral (select count(*) n from public.pricing_rule_brackets b where b.rule_id=r.id) bc
      cross join lateral (select case when r.status='approved' and r.effective_to<v_today then 'expired' when r.status='approved' and r.effective_from>v_today then 'scheduled' else r.status end s) st
    where r.company_id=p_company and (p_id is null or r.id=p_id) and (p_id is not null or p_state='all' or st.s in ('draft','approved','scheduled'))
    union all
    select jsonb_build_object('id',k.id,'label',concat('Price · ',c.customer_name,' · ',trim_scale(k.quantity),' ',k.unit_basis),'status',k.status,'owner',u.full_name,'due_date',null,
        'summary',concat(private.commercial_money(k.final_total),' · ',coalesce((k.snapshot->'bracket'->>'code')||' v'||(k.snapshot->'bracket'->>'version'),'no rate'),case when k.override_rate is not null then ' · override' else '' end),
        'source_href',case when k.quote_id is not null then '/quotes/'||k.quote_id end,
        'details',jsonb_build_object('kind','calculation','calculation_id',k.id,'customer',c.customer_name,'quantity',k.quantity,'unit_basis',k.unit_basis,'finishing_type',k.finishing_type,'calc_date',k.calc_date,
          'rule_total',k.rule_total,'final_total',k.final_total,'override_rate',k.override_rate,'override_reason',k.override_reason,'snapshot',k.snapshot,'quote_number',q.quote_number,'calc_status',k.status)),
      case k.status when 'recorded' then 4 else 9 end,null::date,k.created_at
    from public.pricing_calculations k join public.customers c on c.id=k.customer_id and c.company_id=k.company_id left join public.quotes q on q.id=k.quote_id and q.company_id=k.company_id
      left join public.app_users u on u.id=k.created_by and u.company_id=k.company_id
    where k.company_id=p_company and (p_id is null or k.id=p_id) and (p_id is not null or p_state='all' or k.status='recorded');

  elsif p_view='claims' then
    return query select jsonb_build_object('id',k.id,'label',concat(k.claim_number,' · ',v.vendor_name),'status',st.s,'owner',fu.full_name,'due_date',k.response_due,
        'summary',concat(replace(k.claim_type,'_',' '),' · ',trim_scale(k.claimed_quantity),' ',l.unit,' / ',private.commercial_money(k.claimed_amount),' · wants ',k.requested_remedy,' · recovered ',trim_scale(rc.q),' ',l.unit,' / ',private.commercial_money(rc.a)),
        'source_href',null,
        'details',jsonb_build_object('claim_id',k.id,'claim_number',k.claim_number,'raw_status',k.status,'vendor',v.vendor_name,'vendor_id',k.vendor_id,'po_number',p.po_number,'purchase_order_id',p.id,'line',l.line_number,
          'description',l.description,'unit',l.unit,'claim_type',k.claim_type,'claimed_quantity',k.claimed_quantity,'claimed_amount',k.claimed_amount,'requested_remedy',k.requested_remedy,
          'agreed_quantity',k.agreed_quantity,'agreed_amount',k.agreed_amount,'recovered_quantity',rc.q,'recovered_amount',rc.a,'response_due',k.response_due,'response_overdue',st.s='response_overdue','last_response_at',k.last_response_at,
          'follow_up_owner',fu.full_name,'follow_up_owner_id',k.follow_up_owner,'closed_at',k.closed_at,'close_note',k.close_note,'unresolved_quantity',k.unresolved_quantity,'unresolved_amount',k.unresolved_amount,'created_at',k.created_at,
          'pool',case when p_id is null then null else private.claim_pool(p_company,k.purchase_order_line_id,k.claim_type) end,
          'recoveries',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'quantity',x.quantity,'amount',x.amount,'recorded_at',x.recorded_at,'reversed',x.reversed_at is not null,
              'reference',coalesce(x.credit_id,x.receipt_line_id),'reverse_note',x.reverse_note) order by x.recorded_at desc),'[]'::jsonb) from public.supplier_claim_recoveries x where x.company_id=p_company and x.claim_id=k.id) end)),
      case st.s when 'response_overdue' then 0 when 'disputed' then 1 when 'submitted' then 2 when 'agreed' then 3 when 'partially_recovered' then 3 else 9 end,k.response_due,k.updated_at
    from public.supplier_claims k join public.vendors v on v.id=k.vendor_id and v.company_id=k.company_id join public.purchase_orders p on p.id=k.purchase_order_id and p.company_id=k.company_id
      join public.purchase_order_lines l on l.id=k.purchase_order_line_id and l.company_id=k.company_id left join public.app_users fu on fu.id=k.follow_up_owner and fu.company_id=k.company_id
      cross join lateral (select coalesce(sum(quantity),0) q,coalesce(sum(amount),0) a from public.supplier_claim_recoveries x where x.company_id=k.company_id and x.claim_id=k.id and x.reversed_at is null) rc
      cross join lateral (select case when k.status in ('submitted','disputed') and k.response_due<v_today then 'response_overdue' else k.status end s) st
    where k.company_id=p_company and (p_id is null or k.id=p_id) and (p_id is not null or p_state='all' or k.status not in ('rejected','closed'));

  elsif p_view='profitability' then
    return query select jsonb_build_object('id',o.id,'label',concat(o.order_number,' · ',cu.customer_name),'status',case when ps.finalized then 'finalized' when s.order_id is null then 'no_estimate' else 'provisional' end,'owner',null,
        'due_date',o.expected_dispatch_date,
        'summary',concat('Estimated revenue ',coalesce(private.commercial_money((s.quote_snapshot->>'total_before_gst')::numeric),'not recorded'),' · invoiced ',coalesce(private.commercial_money(inv.net),'not recorded'),
          case when ps.finalized then ' · finalised' else ' · provisional' end),
        'source_href','/orders/'||o.id,
        'details',jsonb_build_object('order_id',o.id)||case when p_id is not null then jsonb_build_object('model',private.profit_model(p_company,o.id)) else '{}'::jsonb end),
      case when ps.finalized then 9 when inv.n>0 then 1 when s.order_id is null then 2 else 5 end,o.expected_dispatch_date,o.created_at
    from public.orders o join public.customers cu on cu.id=o.customer_id and cu.company_id=o.company_id left join public.order_quote_snapshots s on s.order_id=o.id and s.company_id=o.company_id
      cross join lateral (select count(*) n,sum(i.subtotal)-coalesce((select sum(c.subtotal) from public.credit_notes c join public.invoices i2 on i2.id=c.invoice_id and i2.company_id=c.company_id where c.company_id=o.company_id and i2.order_id=o.id and c.status='issued'),0) net
        from public.invoices i where i.company_id=o.company_id and i.order_id=o.id and i.deleted_at is null and i.status not in ('draft','cancelled')) inv
      cross join lateral (select exists(select 1 from public.job_profit_snapshots x where x.company_id=o.company_id and x.order_id=o.id and x.finalized) finalized) ps
    where o.company_id=p_company and o.deleted_at is null and o.current_stage<>'cancelled' and (p_id is null or o.id=p_id) and (s.order_id is not null or inv.n>0)
      and (p_id is not null or p_state='all' or not coalesce(ps.finalized,false))
    order by o.created_at desc limit case when p_id is null then 500 else 1 end;

  elsif p_view='reliability' then
    return query select jsonb_build_object('id',v.id,'label',v.vendor_name,'status',st.s,'owner',null,'due_date',null,
        'summary',concat((x.m->>'purchase_orders'),' purchase order(s) · ',(x.m->>'on_time'),' on time and ',(x.m->>'late'),' late of ',(x.m->>'with_commitment'),' with a recorded promise',
          case when (x.m->>'open_past_date')::integer>0 then ' · '||(x.m->>'open_past_date')||' past the promised date with nothing received' else '' end,
          case when (x.m->'claims'->>'open')::integer>0 then ' · '||(x.m->'claims'->>'open')||' open claim(s)' else '' end,
          case when not (x.m->>'sample_ok')::boolean then ' · small sample: not a ranking' else '' end),
        'source_href','/vendors',
        'details',jsonb_build_object('vendor_id',v.id,'vendor_type',v.vendor_type,'metrics',x.m,'orders',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('purchase_order_id',po.id,'po_number',po.po_number,'order_date',po.order_date,
            'original_date',c.original_date,'current_date',c.current_date_promised,'revisions',c.revision_count,'first_receipt',fr.d,
            'result',case when c.id is null then 'no promise recorded' when fr.d is null and c.original_date<v_today then 'past promised date, nothing received' when fr.d is null then 'awaiting receipt' when fr.d<=c.original_date then 'on time' else 'late' end) order by po.order_date desc),'[]'::jsonb)
            from (select * from public.purchase_orders z where z.company_id=p_company and z.vendor_id=v.id order by z.order_date desc,z.id limit 10) po
            left join public.supplier_commitments c on c.company_id=po.company_id and c.purchase_order_id=po.id
            left join lateral (select min(r.receipt_date) d from public.purchase_receipts r where r.company_id=po.company_id and r.purchase_order_id=po.id) fr on true) end)),
      case st.s when 'attention' then 0 when 'low_sample' then 5 else 8 end,null::date,v.updated_at
    from public.vendors v cross join lateral (select private.vendor_reliability(p_company,v.id) m) x
      cross join lateral (select case when (x.m->>'open_past_date')::integer>0 or (x.m->'claims'->>'open')::integer>0 then 'attention' when not (x.m->>'sample_ok')::boolean and not (x.m->>'finishing_sample_ok')::boolean then 'low_sample' else 'measured' end s) st
    where v.company_id=p_company and (p_id is null or v.id=p_id) and ((x.m->>'purchase_orders')::integer>0 or (x.m->'finishing'->>'jobs')::integer>0) and (p_id is not null or p_state='all' or st.s='attention');

  elsif p_view='outcomes' then
    return query select jsonb_build_object('id',q.id,'label',concat(q.quote_number,' · ',cu.customer_name),'status',cl.s,'owner',su.full_name,'due_date',q.valid_until,
        'summary',concat(private.commercial_money(q.total_before_gst),' · quote status ',replace(q.status,'_',' '),case when (sh.sh->>'orders')::integer>0 then ' · '||(sh.sh->>'orders')||' order(s) cover '||trim_scale(round((sh.sh->>'ordered_kg')::numeric,1))||' of '||trim_scale(round((sh.sh->>'quoted_kg')::numeric,1))||' kg' else '' end,
          case when o.id is not null then ' · '||replace(o.reason_code,'_',' ')||' ('||replace(o.evidence,'_',' ')||')' else '' end),
        'source_href','/quotes/'||q.id,
        'details',jsonb_build_object('quote_id',q.id,'quote_number',q.quote_number,'customer',cu.customer_name,'quote_status',q.status,'quote_revision',q.revision_number,'quote_date',q.quote_date,'valid_until',q.valid_until,
          'value',q.total_before_gst,'share',sh.sh,'outcome',o.outcome,'reason_code',o.reason_code,'evidence',o.evidence,'product_family',o.product_family,'outcome_revision',o.quote_revision,'recorded_at',o.recorded_at,'class',cl.s)),
      case cl.s when 'needs_reason' then 0 when 'open' then 4 else 9 end,q.valid_until,q.updated_at
    from public.quotes q join public.customers cu on cu.id=q.customer_id and cu.company_id=q.company_id left join public.app_users su on su.id=q.created_by and su.company_id=q.company_id
      cross join lateral (select private.quote_order_share(p_company,q.id) sh) sh
      left join public.quote_outcomes o on o.quote_id=q.id and o.company_id=q.company_id and o.status='active'
      cross join lateral (select private.quote_class(q.status,q.valid_until,(sh.sh->>'orders')::integer,(sh.sh->>'ordered_kg')::numeric,(sh.sh->>'quoted_kg')::numeric,o.outcome) s) cl
    where q.company_id=p_company and q.deleted_at is null and q.dealer_id is null and (p_id is null or q.id=p_id) and cl.s<>'not_issued' and (p_id is not null or p_state='all' or cl.s in ('needs_reason','open'));

  elsif p_view='cohorts' then
    return query with base as (
        select q.id,to_char(q.quote_date,'YYYY-MM') as mth,q.total_before_gst value,cl.s,o.reason_code,o.evidence from public.quotes q
          cross join lateral (select private.quote_order_share(p_company,q.id) sh) sh left join public.quote_outcomes o on o.quote_id=q.id and o.company_id=q.company_id and o.status='active'
          cross join lateral (select private.quote_class(q.status,q.valid_until,(sh.sh->>'orders')::integer,(sh.sh->>'ordered_kg')::numeric,(sh.sh->>'quoted_kg')::numeric,o.outcome) s) cl
        where q.company_id=p_company and q.deleted_at is null and q.dealer_id is null and cl.s<>'not_issued'),
      agg as (select mth,count(*) n,count(*) filter (where s='won') won,count(*) filter (where s='partially_won') part,count(*) filter (where s='lost') lost,count(*) filter (where s='withdrawn') withdrawn,
          count(*) filter (where s='no_decision') nodec,count(*) filter (where s='needs_reason') needs,count(*) filter (where s='open') open_n,sum(value) value,sum(value) filter (where s in ('won','partially_won')) won_value from base group by mth)
      select jsonb_build_object('id',md5('cohort:'||a.mth)::uuid,'label',a.mth,'status',case when a.needs+a.open_n>0 then 'in_progress' else 'complete' end,'owner',null,'due_date',null,
          'summary',concat(a.n,' issued quotation(s): ',a.won,' won, ',a.part,' partly won, ',a.lost,' lost, ',a.withdrawn,' withdrawn, ',a.nodec,' no decision, ',a.needs,' awaiting a reason, ',a.open_n,' open'),'source_href',null,
          'details',jsonb_build_object('month',a.mth,'quotations',a.n,'won',a.won,'partially_won',a.part,'lost',a.lost,'withdrawn',a.withdrawn,'no_decision',a.nodec,'needs_reason',a.needs,'open',a.open_n,
            'decided',a.n-a.needs-a.open_n,'value',a.value,'won_value',a.won_value,
            'reasons',(select coalesce(jsonb_object_agg(r.reason_code,r.n),'{}'::jsonb) from (select reason_code,count(*) n from base b where b.mth=a.mth and b.reason_code is not null group by 1) r),
            'evidence',(select coalesce(jsonb_object_agg(r.evidence,r.n),'{}'::jsonb) from (select evidence,count(*) n from base b where b.mth=a.mth and b.evidence is not null group by 1) r))),
        case when a.needs+a.open_n>0 then 1 else 9 end,null::date,(a.mth||'-01')::date::timestamptz
      from agg a where (p_id is null or md5('cohort:'||a.mth)::uuid=p_id) and (p_id is not null or p_state='all' or a.needs+a.open_n>0);

  elsif p_view='remnants' then
    return query select jsonb_build_object('id',l.id,'label',concat(l.lot_number,' · ',pf.profile_code,' · ',l.length_mm,' mm × ',l.pieces),'status',l.status,'owner',null,'due_date',null,
        'summary',concat(l.finish,' · ',l.condition,' · ',l.location,' · ',greatest(l.pieces-rs.n,0),' of ',l.pieces,' piece(s) free · ',trim_scale(round(l.pieces*l.weight_per_piece_kg,3)),' kg'),'source_href','/profiles/'||l.profile_id,
        'details',jsonb_build_object('lot_id',l.id,'lot_number',l.lot_number,'profile_id',l.profile_id,'profile_code',pf.profile_code,'profile_name',pf.profile_name,'alloy',l.alloy,'temper',l.temper,'finish',l.finish,'length_mm',l.length_mm,
          'pieces',l.pieces,'original_pieces',l.original_pieces,'reserved_pieces',rs.n,'free_pieces',greatest(l.pieces-rs.n,0),'weight_per_piece_kg',l.weight_per_piece_kg,'total_weight_kg',round(l.pieces*l.weight_per_piece_kg,3),
          'origin_type',l.origin_type,'source_job_id',l.source_job_id,'location',l.location,'condition',l.condition,'lot_status',l.status,'ownership',l.ownership,'age_days',v_today-(l.created_at at time zone 'Asia/Kolkata')::date,
          'correction_count',l.correction_count,'history',l.history,
          'matches',case when p_id is null then '[]'::jsonb else private.remnant_matches(p_company,l.id) end,
          'allocations',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'order_number',o.order_number,'pieces',a.pieces,'cut_length_mm',a.cut_length_mm,'waste_mm_per_piece',a.waste_mm_per_piece,'status',a.status,'created_at',a.created_at) order by a.created_at desc),'[]'::jsonb)
            from public.remnant_allocations a join public.order_items oi on oi.id=a.order_item_id and oi.company_id=a.company_id join public.orders o on o.id=oi.order_id and o.company_id=oi.company_id where a.company_id=p_company and a.lot_id=l.id) end)),
      case l.status when 'held' then 1 when 'available' then 3 else 9 end,null::date,l.created_at
    from public.remnant_lots l join public.aluminium_profiles pf on pf.id=l.profile_id and pf.company_id=l.company_id
      cross join lateral (select coalesce(sum(a.pieces),0)::integer n from public.remnant_allocations a where a.company_id=l.company_id and a.lot_id=l.id and a.status='reserved') rs
    where l.company_id=p_company and (p_id is null or l.id=p_id) and (p_id is not null or p_state='all' or l.status in ('available','held'));

  elsif p_view='transfers' then
    return query
    select jsonb_build_object('id',m.id,'label',concat('Invoice export mapping v',m.version),'status',m.status,'owner',u.full_name,'due_date',null,
        'summary',concat('Sales ledger "',m.sales_ledger,'" · tax ledger "',m.tax_ledger,'" · party by ',replace(m.party_key,'_',' ')),'source_href',null,
        'details',jsonb_build_object('kind','mapping','mapping_id',m.id,'version',m.version,'sales_ledger',m.sales_ledger,'tax_ledger',m.tax_ledger,'party_key',m.party_key,'mapping_status',m.status,'created_by',u.full_name,'created_by_id',m.created_by,
          'approved_at',m.approved_at,'eligible_invoices',case when m.status='approved' and p_id is not null then (select count(*) from private.transfer_eligible(p_company)) end)),
      case m.status when 'draft' then 1 when 'approved' then 4 else 9 end,null::date,m.created_at
    from public.transfer_mappings m left join public.app_users u on u.id=m.created_by and u.company_id=m.company_id
    where m.company_id=p_company and (p_id is null or m.id=p_id) and (p_id is not null or p_state='all' or m.status in ('draft','approved'))
    union all
    select jsonb_build_object('id',b.id,'label',concat(b.batch_number,' · ',b.item_count,' invoice(s)'),'status',case when b.status='exported' and pend.n>0 then 'results_open' else b.status end,'owner',u.full_name,'due_date',null,
        'summary',concat(private.commercial_money(b.total_amount),' · mapping v',b.mapping_version,' · ',acc.n,' accepted, ',rej.n,' rejected, ',pend.n,' awaiting a result'),'source_href',null,
        'details',jsonb_build_object('kind','batch','batch_id',b.id,'batch_number',b.batch_number,'mapping_version',b.mapping_version,'batch_status',b.status,'item_count',b.item_count,'total_amount',b.total_amount,'checksum',b.checksum,
          'accepted',acc.n,'rejected',rej.n,'pending',pend.n,'prepared_at',b.prepared_at,'exported_at',b.exported_at,'prepared_by',u.full_name,'prepared_by_id',b.prepared_by,
          'items',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'external_ref',t.external_ref,'invoice_id',t.invoice_id,'invoice_number',i.invoice_number,'invoice_date',i.invoice_date,'amount',t.amount,'tax_amount',t.tax_amount,
              'state',t.state,'external_reference',t.external_reference,'reason',t.reason,'changed_since',private.transfer_fp(i)<>t.invoice_fingerprint,
              'party',case mp.party_key when 'gst_number' then coalesce(nullif(cu.gst_number,''),cu.customer_name) else cu.customer_name end) order by i.invoice_number,t.id),'[]'::jsonb)
            from public.transfer_items t join public.invoices i on i.id=t.invoice_id and i.company_id=t.company_id join public.customers cu on cu.id=i.customer_id and cu.company_id=i.company_id
              join public.transfer_mappings mp on mp.id=b.mapping_id and mp.company_id=b.company_id where t.company_id=p_company and t.batch_id=b.id) end,
          'sales_ledger',(select sales_ledger from public.transfer_mappings where id=b.mapping_id),'tax_ledger',(select tax_ledger from public.transfer_mappings where id=b.mapping_id))),
      case when b.status='prepared' then 1 when b.status='exported' and pend.n>0 then 2 else 9 end,null::date,b.prepared_at
    from public.transfer_batches b left join public.app_users u on u.id=b.prepared_by and u.company_id=b.company_id
      cross join lateral (select count(*) filter (where state='pending') n from public.transfer_items t where t.company_id=b.company_id and t.batch_id=b.id) pend
      cross join lateral (select count(*) filter (where state='accepted') n from public.transfer_items t where t.company_id=b.company_id and t.batch_id=b.id) acc
      cross join lateral (select count(*) filter (where state='rejected') n from public.transfer_items t where t.company_id=b.company_id and t.batch_id=b.id) rej
    where b.company_id=p_company and (p_id is null or b.id=p_id) and (p_id is not null or p_state='all' or b.status in ('prepared','exported'));

  elsif p_view='runs' then
    return query with g as (select x.value grp from jsonb_array_elements(private.run_groups(p_company)) x),
      latest as (select distinct on (group_key) * from public.run_proposals where company_id=p_company order by group_key,created_at desc),
      merged as (
        select coalesce(p.id,(g.grp->>'key')::uuid) rid,g.grp,p.id proposal_id,case when p.id is null then 'suggested' else p.status end st,p.decision_note,p.created_at
          from g left join latest p on p.group_key=g.grp->>'key'
        union all
        select p.id,jsonb_build_object('key',p.group_key,'die_number',null,'profile_code',null,'member_count',jsonb_array_length(p.members),'total_kg',null,'changeovers_saved',p.saving_changeovers,'members',p.members,'orders',null,'not_merged',null,'die_out',false),
          p.id,case when p.status='proposed' then 'stale' else p.status end,p.decision_note,p.created_at
          from latest p where not exists(select 1 from g where g.grp->>'key'=p.group_key))
      select jsonb_build_object('id',m.rid,'label',concat(coalesce(m.grp->>'die_number','Saved run'),' · ',coalesce(m.grp->>'profile_code','profile'),' · ',m.grp->>'member_count',' jobs'),'status',m.st,'owner',null,'due_date',nullif(m.grp->>'earliest_due','')::date,
          'summary',concat(coalesce(trim_scale(round((m.grp->>'total_kg')::numeric,1))::text||' kg across ','')||(m.grp->>'orders')||' order(s) · ' ,'one die setup instead of ',m.grp->>'member_count',' (saves ',m.grp->>'changeovers_saved',' changeover(s)) · duration and yield not estimated'),
          'source_href',null,
          'details',jsonb_build_object('group_key',m.grp->>'key','proposal_id',m.proposal_id,'run_status',m.st,'group',m.grp,'decision_note',m.decision_note,'blocked',coalesce((m.grp->>'die_out')::boolean,false) or coalesce(m.grp->>'die_status','') in ('blocked','scrapped','retired'))),
        case m.st when 'stale' then 0 when 'suggested' then 2 when 'proposed' then 1 else 9 end,nullif(m.grp->>'earliest_due','')::date,coalesce(m.created_at,now())
      from merged m where (p_id is null or m.rid=p_id) and (p_id is not null or p_state='all' or m.st in ('suggested','proposed','stale'));

  elsif p_view='scenarios' then
    return query select jsonb_build_object('id',s.id,'label',s.name,'status',s.status,'owner',u.full_name,'due_date',s.horizon_start,
        'summary',concat('Hypothetical · ',s.horizon_days,'-day horizon from ',to_char(s.horizon_start,'DD Mon'),' · ',jsonb_array_length(s.changes),' change(s) · ',(s.result->'summary'->>'jobs_delayed'),' job(s) finish later, ',
          (s.result->'summary'->>'newly_late'),' newly late'),'source_href',null,
        'details',jsonb_build_object('scenario_id',s.id,'name',s.name,'scenario_status',s.status,'horizon_start',s.horizon_start,'horizon_days',s.horizon_days,'changes',s.changes,'summary',s.result->'summary','created_by',u.full_name,'created_by_id',s.created_by,
          'created_at',s.created_at,'decision_note',s.decision_note,'excluded',s.baseline->'excluded','machines',(select coalesce(jsonb_agg(jsonb_build_object('name',mm.value->>'name','measured',(mm.value->>'measured')::boolean)),'[]'::jsonb) from jsonb_array_elements(s.baseline->'machines') mm),
          'stale',case when p_id is null then null else private.scenario_snapshot(p_company,s.horizon_start,s.horizon_days)::text is distinct from s.baseline::text end,
          'comparison',case when p_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('job',sj.value->>'number','order',sj.value->>'order_number','kg',sj.value->>'kg','due',sj.value->>'due','baseline_finish',bj.value->>'finish_date','scenario_finish',sj.value->>'finish_date',
              'simulated',(sj.value->>'simulated')::boolean,'late',sj.value->>'late','hypothetical',coalesce((sj.value->>'hypothetical')::boolean,false)) order by sj.value->>'machine_id',sj.value->>'number'),'[]'::jsonb)
            from jsonb_array_elements(s.result->'scenario') sj left join lateral (select y.value from jsonb_array_elements(s.result->'baseline') y where y.value->>'id' is not distinct from sj.value->>'id' and sj.value->>'id' is not null limit 1) bj on true) end)),
      case s.status when 'shared' then 1 when 'draft' then 2 else 9 end,s.horizon_start,s.created_at
    from public.planning_scenarios s left join public.app_users u on u.id=s.created_by and u.company_id=s.company_id
    where s.company_id=p_company and (p_id is null or s.id=p_id) and (p_id is not null or p_state='all' or s.status in ('draft','shared'));
  end if;
end $$;
revoke all on function private.commercial_rows(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;


------------------------------------------------------------------------------------------------
-- Shape checks and lookups.
------------------------------------------------------------------------------------------------
create function private.commercial_assert_shape(p_mutation jsonb) returns void language plpgsql set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_keys text[]; v_optional text[]:='{}'; v_noteless boolean; n text:=btrim(coalesce(p_mutation->>'note',''));
begin
  v_keys:=case a
    when 'pricing.define' then array['code','name','charge_type','unit_basis','effective_from','precedence'] when 'pricing.approve' then array['id'] when 'pricing.retire' then array['id'] when 'pricing.void' then array['id']
    when 'pricing.price' then array['customer_id','unit_basis','quantity']
    when 'claim.submit' then array['purchase_order_line_id','claim_type','quantity','amount','remedy','owner_id','response_due'] when 'claim.respond' then array['id','response']
    when 'claim.link' then array['id','kind'] when 'claim.unlink' then array['id','recovery_id'] when 'claim.close' then array['id']
    when 'profit.snapshot' then array['order_id','finalize'] when 'commitment.set' then array['purchase_order_id','promised_date']
    when 'outcome.record' then array['quote_id','outcome','reason_code','evidence'] when 'outcome.reopen' then array['quote_id']
    when 'remnant.record' then array['profile_id','length_mm','pieces','finish','origin_type','location'] when 'remnant.review' then array['id','decision'] when 'remnant.reserve' then array['id','order_item_id','pieces']
    when 'remnant.consume' then array['id'] when 'remnant.release' then array['id'] when 'remnant.scrap' then array['id'] when 'remnant.correct' then array['id','length_mm','pieces']
    when 'mapping.define' then array['sales_ledger','tax_ledger','party_key'] when 'mapping.approve' then array['id'] when 'mapping.retire' then array['id']
    when 'transfer.prepare' then array['count'] when 'transfer.export' then array['id'] when 'transfer.result' then array['id','result'] when 'transfer.cancel' then array['id']
    when 'run.save' then array['group_key'] when 'run.accept' then array['id'] when 'run.dismiss' then array['id']
    when 'scenario.create' then array['name','horizon_days','changes'] when 'scenario.share' then array['id'] when 'scenario.discard' then array['id'] when 'scenario.accept' then array['id'] end;
  v_optional:=case a
    when 'pricing.define' then array['customer_id','finishing_type','processing_code','amount','effective_to','brackets'] when 'pricing.price' then array['finishing_type','processing_codes','quote_id','override_rate','override_reason']
    when 'claim.respond' then array['agreed_quantity','agreed_amount'] when 'claim.link' then array['receipt_line_id','quantity','credit_id'] when 'outcome.record' then array['product_family']
    when 'remnant.record' then array['alloy','temper','source_job_id','condition'] when 'transfer.result' then array['external_reference'] else '{}'::text[] end;
  -- A price calculation and an outcome record carry their own meaning; a second explanation would only add typing.
  v_noteless:=a in ('pricing.price','outcome.record');
  if jsonb_typeof(p_mutation) is distinct from 'object' or v_keys is null or not(p_mutation ?& (v_keys||array['action']||case when v_noteless then '{}'::text[] else array['note'] end))
    or exists(select 1 from jsonb_object_keys(p_mutation) k where not(k=any(v_keys||v_optional||array['action']||case when v_noteless then '{}'::text[] else array['note'] end)))
    or (not v_noteless and (length(n) not between 5 and 500 or n ~ '[[:cntrl:]]'))
    or exists(select 1 from jsonb_each(p_mutation) x where jsonb_typeof(x.value)='null') then raise exception 'NOV: Review the required action details.'; end if;
end $$;
revoke all on function private.commercial_assert_shape(jsonb) from public,anon,authenticated;

create function private.commercial_lookup(p_company uuid,p_actor uuid,p_role text,p_payload jsonb) returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare k text:=p_payload->>'kind'; s text:=lower(btrim(coalesce(p_payload->>'search',''))); v_sel uuid; v_parent uuid; v jsonb; v_ok boolean;
begin
  if p_payload ? 'selected_id' then v_sel:=private.commercial_uuid(p_payload,'selected_id'); end if;
  if p_payload ? 'parent_id' then v_parent:=private.commercial_uuid(p_payload,'parent_id'); end if;
  v_ok:=case k when 'employees' then true when 'customers' then private.commercial_read_allowed(p_role,'pricing') or private.commercial_read_allowed(p_role,'outcomes')
    when 'quotes' then private.commercial_read_allowed(p_role,'pricing') or private.commercial_read_allowed(p_role,'outcomes') when 'orders' then private.commercial_read_allowed(p_role,'profitability')
    when 'po_lines' then private.commercial_read_allowed(p_role,'claims') when 'receipt_lines' then private.commercial_read_allowed(p_role,'claims') when 'credits' then private.commercial_read_allowed(p_role,'claims')
    when 'purchase_orders' then private.commercial_read_allowed(p_role,'reliability') when 'profiles' then private.commercial_read_allowed(p_role,'remnants') when 'order_items' then private.commercial_read_allowed(p_role,'remnants')
    when 'jobs' then private.commercial_read_allowed(p_role,'remnants') or private.commercial_read_allowed(p_role,'scenarios') when 'machines' then private.commercial_read_allowed(p_role,'scenarios') else false end;
  if k is null or not coalesce(v_ok,false) then raise exception 'Not permitted' using errcode='42501'; end if;
  if k='employees' then
    select coalesce(jsonb_agg(jsonb_build_object('value',u.id,'label',coalesce(nullif(u.full_name,''),u.email),'context',replace(u.role,'_',' ')) order by u.full_name,u.id),'[]'::jsonb) into v from (
      select * from public.app_users u where u.company_id=p_company and u.is_active and u.dealer_id is null and u.role not in ('viewer','dealer_admin','dealer_staff')
        and (v_sel is null or u.id=v_sel) and (s='' or position(s in lower(coalesce(u.full_name,'')||' '||coalesce(u.email,'')||' '||u.role))>0) order by u.full_name,u.id limit 20) u;
  elsif k='customers' then
    select coalesce(jsonb_agg(jsonb_build_object('value',c.id,'label',c.customer_name,'context',coalesce(nullif(c.city,''),c.customer_type)) order by c.customer_name,c.id),'[]'::jsonb) into v from (
      select * from public.customers c where c.company_id=p_company and c.deleted_at is null and c.is_active and (v_sel is null or c.id=v_sel) and (s='' or position(s in lower(c.customer_name))>0) order by c.customer_name,c.id limit 20) c;
  elsif k='quotes' then
    select coalesce(jsonb_agg(jsonb_build_object('value',q.id,'label',q.quote_number,'context',concat(cu.customer_name,' · ',replace(q.status,'_',' '))) order by q.quote_date desc,q.id),'[]'::jsonb) into v from (
      select * from public.quotes q where q.company_id=p_company and q.deleted_at is null and q.dealer_id is null and (v_sel is null or q.id=v_sel) and (v_parent is null or q.customer_id=v_parent)
        and (s='' or position(s in lower(q.quote_number))>0) order by q.quote_date desc,q.id limit 20) q join public.customers cu on cu.id=q.customer_id and cu.company_id=q.company_id;
  elsif k='orders' then
    select coalesce(jsonb_agg(jsonb_build_object('value',o.id,'label',o.order_number,'context',concat(coalesce(c.customer_name,'Customer'),' · ',replace(o.current_stage,'_',' '))) order by o.created_at desc,o.id),'[]'::jsonb) into v from (
      select * from public.orders o where o.company_id=p_company and o.deleted_at is null and (v_sel is null or o.id=v_sel) and (s='' or position(s in lower(o.order_number))>0) order by o.created_at desc,o.id limit 20) o
      left join public.customers c on c.id=o.customer_id and c.company_id=o.company_id;
  elsif k='po_lines' then
    select coalesce(jsonb_agg(jsonb_build_object('value',l.id,'label',concat(p.po_number,' · line ',l.line_number),'context',concat(p.vendor_name_snapshot,' · ',left(l.description,50),' · ',trim_scale(l.ordered_quantity),' ',l.unit)) order by p.order_date desc,l.line_number,l.id),'[]'::jsonb) into v from (
      select l.* from public.purchase_order_lines l join public.purchase_orders p0 on p0.id=l.purchase_order_id and p0.company_id=l.company_id where l.company_id=p_company and (v_sel is null or l.id=v_sel)
        and (s='' or position(s in lower(p0.po_number||' '||p0.vendor_name_snapshot||' '||l.description))>0) order by p0.order_date desc,l.line_number,l.id limit 20) l
      join public.purchase_orders p on p.id=l.purchase_order_id and p.company_id=l.company_id;
  elsif k='receipt_lines' then
    select coalesce(jsonb_agg(jsonb_build_object('value',r.id,'label',concat('Receipt ',to_char(pr.receipt_date,'DD Mon YYYY'),' · accepted ',trim_scale(r.accepted_quantity)),'context',coalesce(pr.reference,'no reference')) order by pr.receipt_date desc,r.id),'[]'::jsonb) into v from public.purchase_receipt_lines r
      join public.purchase_receipts pr on pr.id=r.receipt_id and pr.company_id=r.company_id where r.company_id=p_company and (v_sel is null or r.id=v_sel)
        and (v_parent is null or r.purchase_order_line_id=(select purchase_order_line_id from public.supplier_claims where id=v_parent and company_id=p_company)) and (s='' or position(s in lower(coalesce(pr.reference,'')))>0);
  elsif k='credits' then
    select coalesce(jsonb_agg(jsonb_build_object('value',c.id,'label',concat(case c.credit_type when 'credit_note' then 'Credit note ' else 'Refund ' end,private.commercial_money(c.amount)),'context',concat(to_char(c.credit_date,'DD Mon YYYY'),' · ',coalesce(c.reference_number,'no reference'))) order by c.credit_date desc,c.id),'[]'::jsonb) into v from public.expense_supplier_credits c
      join public.expense_ledger e on e.id=c.expense_ledger_id and e.company_id=c.company_id where c.company_id=p_company and c.status='posted' and c.reversed_at is null and (v_sel is null or c.id=v_sel)
        and (v_parent is null or e.vendor_id=(select vendor_id from public.supplier_claims where id=v_parent and company_id=p_company)) and (s='' or position(s in lower(coalesce(c.reference_number,'')))>0);
  elsif k='purchase_orders' then
    select coalesce(jsonb_agg(jsonb_build_object('value',p.id,'label',p.po_number,'context',concat(p.vendor_name_snapshot,' · ',to_char(p.order_date,'DD Mon YYYY'),case when c.id is not null then ' · promised '||to_char(c.current_date_promised,'DD Mon') else ' · no promise recorded' end)) order by p.order_date desc,p.id),'[]'::jsonb) into v from (
      select * from public.purchase_orders p where p.company_id=p_company and (v_sel is null or p.id=v_sel) and (s='' or position(s in lower(p.po_number||' '||p.vendor_name_snapshot))>0) order by p.order_date desc,p.id limit 20) p
      left join public.supplier_commitments c on c.company_id=p.company_id and c.purchase_order_id=p.id;
  elsif k='profiles' then
    select coalesce(jsonb_agg(jsonb_build_object('value',f.id,'label',f.profile_code,'context',concat(f.profile_name,' · ',coalesce(f.alloy,'alloy not set'),' ',coalesce(f.temper,''))) order by f.profile_code,f.id),'[]'::jsonb) into v from (
      select * from public.aluminium_profiles f where f.company_id=p_company and f.deleted_at is null and f.is_active and (v_sel is null or f.id=v_sel) and (s='' or position(s in lower(f.profile_code||' '||f.profile_name))>0) order by f.profile_code,f.id limit 20) f;
  elsif k='order_items' then
    select coalesce(jsonb_agg(jsonb_build_object('value',x.id,'label',concat(x.order_number,' · ',coalesce(x.item_description,'line')),'context',concat('cut ',x.cut_mm,' mm · ',x.need,' piece(s)')) order by x.expected_dispatch_date nulls last,x.order_number,x.id),'[]'::jsonb) into v from (
      select oi.id,o.order_number,oi.item_description,o.expected_dispatch_date,round(coalesce(oi.cut_length,oi.length_per_piece_m*1000)::numeric)::integer cut_mm,coalesce(oi.quantity_pieces,oi.order_quantity::integer,0) need
      from public.order_items oi join public.orders o on o.id=oi.order_id and o.company_id=oi.company_id where oi.company_id=p_company and o.deleted_at is null and o.current_stage not in ('cancelled','closed','delivered','payment_pending','dispatched')
        and (v_sel is null or oi.id=v_sel) and (v_parent is null or oi.profile_id=(select profile_id from public.remnant_lots where id=v_parent and company_id=p_company)) and (s='' or position(s in lower(o.order_number))>0)
      order by o.expected_dispatch_date nulls last,o.order_number,oi.id limit 20) x;
  elsif k='jobs' then
    select coalesce(jsonb_agg(jsonb_build_object('value',j.id,'label',coalesce(j.job_number,'Production job'),'context',concat(j.status,' · planned ',coalesce(to_char(j.planned_date,'DD Mon'),'no date'),' · ',trim_scale(j.planned_quantity_kg),' kg')) order by j.planned_date nulls last,j.id),'[]'::jsonb) into v from (
      select * from public.production_jobs j where j.company_id=p_company and (v_sel is null or j.id=v_sel) and (v_sel is not null or j.status in ('planned','ready','in_progress','completed'))
        and (s='' or position(s in lower(coalesce(j.job_number,'')))>0) order by j.planned_date nulls last,j.id limit 20) j;
  else
    select coalesce(jsonb_agg(jsonb_build_object('value',m.id,'label',m.machine_name,'context',coalesce(m.machine_code,m.machine_type)) order by m.machine_name,m.id),'[]'::jsonb) into v from (
      select * from public.machines m where m.company_id=p_company and m.is_active and (v_sel is null or m.id=v_sel) and (s='' or position(s in lower(m.machine_name))>0) order by m.machine_name,m.id limit 20) m;
  end if;
  return v;
end $$;
revoke all on function private.commercial_lookup(uuid,uuid,text,jsonb) from public,anon,authenticated;


------------------------------------------------------------------------------------------------
-- Context: validates an action against current sources and produces the server-generated review.
-- {source} feeds the fingerprint; {data} is passed to apply after the same checks under row locks.
------------------------------------------------------------------------------------------------
create function private.commercial_ctx_pricing(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; r public.pricing_rules; r2 public.pricing_rules; k public.pricing_calculations; c public.customers; q public.quotes; v_warn jsonb:='[]'::jsonb; v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_src jsonb:='{}'::jsonb;
  v_ver integer; v_type text; v_basis text; v_from date; v_to date; v_code text; v_calc jsonb; v_qty numeric; v_codes text[]; v_finish text; v_over numeric; v_rate numeric; v_disc numeric; v_auth public.decision_authority_revisions;
  v_ceiling numeric; v_sub numeric; v_total numeric; v_min numeric; v_prev uuid; v_data jsonb:='{}'::jsonb; v_proc text; v_next jsonb; v_brackets text; v_scope text;
begin
  if a='pricing.define' then
    v_code:=p_m->>'code';
    if v_code !~ '^[a-z0-9_]{3,30}$' then raise exception 'NOV: Use 3 to 30 lowercase letters, digits or underscores for the rule code.'; end if;
    perform private.assurance_text(p_m,'name',3,80);
    v_type:=p_m->>'charge_type'; v_basis:=p_m->>'unit_basis';
    if v_type is null or v_type not in ('bracket_rate','minimum_charge','processing_charge') then raise exception 'NOV: Choose a charge type.'; end if;
    if v_basis is null or v_basis not in ('kg','metre','piece') then raise exception 'NOV: Choose the unit the rule is priced in.'; end if;
    if p_m ? 'customer_id' then
      select * into c from public.customers where id=private.commercial_uuid(p_m,'customer_id') and company_id=p_company and deleted_at is null;
      if c.id is null then raise exception 'NOV: Choose a customer of this company.'; end if;
    end if;
    if p_m ? 'finishing_type' then perform private.assurance_text(p_m,'finishing_type',2,40); end if;
    if v_type='processing_charge' then
      if not (p_m ? 'processing_code') or p_m->>'processing_code' !~ '^[a-z0-9_]{2,30}$' then raise exception 'NOV: A processing charge needs a code of 2 to 30 lowercase letters, digits or underscores.'; end if;
    elsif p_m ? 'processing_code' then raise exception 'NOV: Only a processing charge has a processing code.'; end if;
    if v_type='bracket_rate' then
      if p_m ? 'amount' then raise exception 'NOV: A volume rate uses brackets, not a single amount.'; end if;
      perform private.pricing_validate_brackets(p_m->'brackets');
      select string_agg(format('%s to %s at INR %s',trim_scale((b->>'from')::numeric),coalesce(trim_scale((b->>'to')::numeric)::text,'and above'),trim_scale((b->>'rate')::numeric)),'; ' order by ord) into v_brackets from jsonb_array_elements(p_m->'brackets') with ordinality t(b,ord);
    else
      if p_m ? 'brackets' then raise exception 'NOV: Only a volume rate has brackets.'; end if;
      perform private.assurance_number(p_m,'amount',0.01,100000000,2);
    end if;
    perform private.assurance_number(p_m,'precedence',0,100,0);
    v_from:=private.assurance_date(p_m,'effective_from');
    if p_m ? 'effective_to' then v_to:=private.assurance_date(p_m,'effective_to'); if v_to<v_from then raise exception 'NOV: The rule cannot end before it starts.'; end if; end if;
    if exists(select 1 from public.pricing_rules where company_id=p_company and code=v_code and status='draft') then raise exception 'NOV: A draft of this rule already exists. Approve or retire it first.'; end if;
    select * into r2 from public.pricing_rules where company_id=p_company and code=v_code order by version desc limit 1;
    if r2.id is not null and (r2.charge_type<>v_type or r2.unit_basis<>v_basis) then raise exception 'NOV: Code % already prices a different charge or unit. Use a new code.',v_code; end if;
    v_ver:=coalesce(r2.version,0)+1;
    v_scope:=concat(coalesce(c.customer_name,'All customers'),' · ',coalesce(p_m->>'finishing_type','any finish'));
    v_title:='Define a pricing rule'; v_effect:='Creates a draft. A second person approves it before any price uses it. Cost and margin definitions are not changed.';
    v_facts:=jsonb_build_object('Rule',btrim(p_m->>'name'),'Code and version',v_code||' v'||v_ver,'Charge',replace(v_type,'_',' ')||' per '||v_basis,'Applies to',v_scope,'Effective',to_char(v_from,'DD Mon YYYY')||coalesce(' to '||to_char(v_to,'DD Mon YYYY'),' onwards'),
      'Precedence',p_m->>'precedence','Brackets',v_brackets,'Amount',case when p_m ? 'amount' then private.commercial_money((p_m->>'amount')::numeric) end,'Processing code',p_m->>'processing_code');
    v_src:=jsonb_build_object('version',v_ver);
  elsif a in ('pricing.approve','pricing.retire') then
    if p_lock then perform 1 from public.pricing_rules where id=private.commercial_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into r from public.pricing_rules where id=private.commercial_uuid(p_m,'id') and company_id=p_company;
    if r.id is null then raise exception 'NOV: The rule is unavailable.'; end if;
    v_src:=jsonb_build_object('status',r.status,'created_by',r.created_by,'version',r.version);
    v_facts:=jsonb_build_object('Rule',r.name,'Code and version',r.code||' v'||r.version,'Charge',replace(r.charge_type,'_',' ')||' per '||r.unit_basis,'Effective',to_char(r.effective_from,'DD Mon YYYY')||coalesce(' to '||to_char(r.effective_to,'DD Mon YYYY'),' onwards'));
    if a='pricing.approve' then
      if r.status<>'draft' then raise exception 'NOV: Only a draft rule can be approved; this one is %.',r.status; end if;
      if r.created_by=p_actor then raise exception 'NOV: A second person approves a rule; the person who defined it cannot.'; end if;
      select * into r2 from public.pricing_rules x where x.company_id=p_company and x.status='approved' and x.code<>r.code and x.charge_type=r.charge_type and x.unit_basis=r.unit_basis and x.customer_id is not distinct from r.customer_id
        and x.finishing_type is not distinct from r.finishing_type and x.processing_code is not distinct from r.processing_code and x.precedence=r.precedence
        and x.effective_from<=coalesce(r.effective_to,'infinity'::date) and coalesce(x.effective_to,'infinity'::date)>=r.effective_from limit 1;
      if r2.id is not null then raise exception 'NOV: Rule % v% already covers the same scope and dates at the same precedence. Change the precedence or the dates so only one rule applies.',r2.code,r2.version; end if;
      select * into r2 from public.pricing_rules where company_id=p_company and code=r.code and status='approved';
      if r2.id is not null then v_warn:=v_warn||jsonb_build_array(format('Version %s is retired by this approval. Calculations already recorded keep the version that priced them.',r2.version)); end if;
      v_title:='Approve the pricing rule'; v_effect:='Makes this version available to price quotations from its effective date.';
    else
      if r.status='retired' then raise exception 'NOV: This rule is already retired.'; end if;
      v_title:='Retire the pricing rule'; v_effect:='Stops new calculations from using this version. Recorded calculations keep their rule snapshot.';
    end if;
  elsif a='pricing.void' then
    if p_lock then perform 1 from public.pricing_calculations where id=private.commercial_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into k from public.pricing_calculations where id=private.commercial_uuid(p_m,'id') and company_id=p_company;
    if k.id is null or k.status<>'recorded' then raise exception 'NOV: Only a recorded price can be voided.'; end if;
    v_title:='Void the recorded price'; v_effect:='Keeps the calculation and its snapshot for audit and marks it voided. The quotation is not changed.';
    v_facts:=jsonb_build_object('Total',private.commercial_money(k.final_total),'Quantity',trim_scale(k.quantity)||' '||k.unit_basis); v_src:=jsonb_build_object('status',k.status);
  else
    select * into c from public.customers where id=private.commercial_uuid(p_m,'customer_id') and company_id=p_company and deleted_at is null;
    if c.id is null then raise exception 'NOV: Choose a customer of this company.'; end if;
    v_basis:=p_m->>'unit_basis';
    if v_basis not in ('kg','metre','piece') then raise exception 'NOV: Choose the unit to price in.'; end if;
    v_qty:=private.assurance_number(p_m,'quantity',0.001,100000000,3);
    if p_m ? 'finishing_type' then v_finish:=private.assurance_text(p_m,'finishing_type',2,40); end if;
    if p_m ? 'processing_codes' then
      if jsonb_typeof(p_m->'processing_codes') is distinct from 'array' or jsonb_array_length(p_m->'processing_codes') not between 1 and 5 then raise exception 'NOV: Choose up to five processing charges.'; end if;
      select array_agg(distinct x) into v_codes from jsonb_array_elements_text(p_m->'processing_codes') x;
      if cardinality(v_codes)<>jsonb_array_length(p_m->'processing_codes') or exists(select 1 from unnest(v_codes) x where x !~ '^[a-z0-9_]{2,30}$') then raise exception 'NOV: Use each processing charge once, by its code.'; end if;
    end if;
    if p_m ? 'quote_id' then
      select * into q from public.quotes where id=private.commercial_uuid(p_m,'quote_id') and company_id=p_company and deleted_at is null;
      if q.id is null or q.customer_id<>c.id then raise exception 'NOV: Choose a quotation of this customer.'; end if;
      if q.status not in ('draft','internal_review','approved_for_sending') then raise exception 'NOV: An issued quotation keeps the price it was issued with. Revise the quotation first.'; end if;
      select id into v_prev from public.pricing_calculations where company_id=p_company and quote_id=q.id and status='recorded' limit 1;
    end if;
    v_calc:=private.pricing_calc(p_company,c.id,v_finish,v_basis,v_qty,private.ist_today(),v_codes);
    if not (v_calc->>'priced')::boolean then raise exception 'NOV: %',v_calc->>'reason'; end if;
    v_total:=(v_calc->>'total')::numeric;
    if p_m ? 'override_rate' then
      if not (p_m ? 'override_reason') then raise exception 'NOV: Give the reason for the override rate.'; end if;
      v_over:=private.assurance_number(p_m,'override_rate',0.0001,10000000,4); perform private.assurance_text(p_m,'override_reason',5,300);
      if p_role not in ('owner','admin','sales_manager') then raise exception 'NOV: Only a sales manager, admin or owner may override a rate.'; end if;
      v_rate:=(v_calc->'bracket'->>'rate')::numeric; v_disc:=greatest((v_rate-v_over)/v_rate*100,0);
      v_auth:=private.current_authority(p_company,'low_margin_quote');
      if v_disc>0 and v_auth.id is not null and v_auth.limits ? p_role then
        v_ceiling:=(v_auth.limits->>p_role)::numeric;
        if v_disc>v_ceiling then raise exception 'NOV: This override is a % percent reduction, above your approval limit of % points (authority revision %). An approver with a higher limit records it.',trim_scale(round(v_disc,2)),trim_scale(v_ceiling),v_auth.revision; end if;
      end if;
      v_sub:=round(v_qty*v_over,2)+(v_calc->>'processing_amount')::numeric; v_min:=(v_calc->'minimum'->>'amount')::numeric;
      v_total:=case when v_min is not null and v_sub<v_min then v_min else v_sub end;
      v_warn:=v_warn||jsonb_build_array(format('Override: the rule rate of INR %s is replaced by INR %s per %s (%s percent %s). The reason is retained.',trim_scale(v_rate),trim_scale(v_over),v_basis,trim_scale(round(abs(v_rate-v_over)/v_rate*100,2)),case when v_over<v_rate then 'lower' else 'higher' end));
    elsif p_m ? 'override_reason' then raise exception 'NOV: An override reason needs an override rate.'; end if;
    select string_agg(format('%s v%s: INR %s per %s = %s',x->>'processing_code',x->>'version',trim_scale((x->>'rate')::numeric),v_basis,private.commercial_money((x->>'amount')::numeric)),'; ') into v_proc from jsonb_array_elements(v_calc->'processing') x;
    if (v_calc->'minimum'->>'applied')::boolean then v_warn:=v_warn||jsonb_build_array(format('The minimum charge of %s applies: the calculated %s is raised by %s.',private.commercial_money((v_calc->'minimum'->>'amount')::numeric),private.commercial_money((v_calc->>'subtotal')::numeric),private.commercial_money((v_calc->>'minimum_uplift')::numeric))); end if;
    v_next:=v_calc->'next_bracket';
    if v_next is not null and v_next<>'null'::jsonb then v_warn:=v_warn||jsonb_build_array(format('%s more %s reaches the next bracket (from %s at INR %s): the total would be %s, %s than now.',trim_scale((v_next->>'additional_qty')::numeric),v_basis,trim_scale((v_next->>'from_qty')::numeric),
      trim_scale((v_next->>'rate')::numeric),private.commercial_money((v_next->>'total_at_start')::numeric),case when (v_next->>'difference')::numeric<0 then 'lower' else 'higher' end)); end if;
    if v_prev is not null then v_warn:=v_warn||jsonb_build_array('This replaces the earlier recorded price for the quotation. The earlier one is kept as superseded.'); end if;
    v_warn:=v_warn||jsonb_build_array('Prices exclude GST. Tax follows the approved tax configuration on the quotation; this calculation adds none.');
    v_title:='Record a quantity-based price'; v_effect:='Stores this price breakdown and the rule versions that produced it. It does not change the quotation, costing or margin.';
    v_facts:=jsonb_build_object('Customer',c.customer_name,'Quantity',trim_scale(v_qty)||' '||v_basis,'Finish',coalesce(v_finish,'Not specified'),'Rule applied',(v_calc->'bracket'->>'code')||' v'||(v_calc->'bracket'->>'version')||': '||trim_scale((v_calc->'bracket'->>'from_qty')::numeric)||' to '||coalesce(trim_scale((v_calc->'bracket'->>'to_qty')::numeric)::text,'and above')||' at INR '||trim_scale((v_calc->'bracket'->>'rate')::numeric)||' per '||v_basis,
      'Volume amount',private.commercial_money((v_calc->>'base_amount')::numeric),'Processing',coalesce(v_proc,'None'),'Subtotal',private.commercial_money((v_calc->>'subtotal')::numeric),
      'Minimum charge',coalesce(case when (v_calc->'minimum'->>'applied')::boolean then 'Applied: '||private.commercial_money((v_calc->'minimum'->>'amount')::numeric) when v_calc->'minimum' is not null and v_calc->'minimum'<>'null'::jsonb then 'Not reached (minimum '||private.commercial_money((v_calc->'minimum'->>'amount')::numeric)||')' end,'No minimum rule'),
      'Total',private.commercial_money(v_total),'Quotation',coalesce(q.quote_number,'Not attached'));
    v_src:=jsonb_build_object('calc',v_calc-'date','total',v_total,'prev',v_prev,'over',v_over,'status',q.status);
    v_data:=jsonb_build_object('calc',v_calc,'total',v_total,'prev',v_prev,'override_rate',v_over,'authority',v_auth.id,'customer_id',c.id,'quote_id',q.id,'finishing',v_finish,'qty',v_qty,'basis',v_basis);
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.commercial_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.commercial_ctx_claim(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; l public.purchase_order_lines; po public.purchase_orders; k public.supplier_claims; rec public.supplier_claim_recoveries; rl public.purchase_receipt_lines; cr public.expense_supplier_credits;
  v_warn jsonb:='[]'::jsonb; v_title text; v_effect text; v_facts jsonb:='{}'::jsonb; v_src jsonb:='{}'::jsonb; v_pool jsonb; v_qty numeric; v_amt numeric; v_type text; v_remedy text; v_due date; v_resp text; v_aq numeric; v_aa numeric;
  v_rc jsonb; v_kind text; v_vendor uuid; v_unres_q numeric; v_unres_a numeric; v_data jsonb:='{}'::jsonb; v_expected numeric; v_remaining_q numeric; v_remaining_a numeric; v_line_unit text;
begin
  if a='claim.submit' then
    if p_lock then perform 1 from public.purchase_order_lines where id=private.commercial_uuid(p_m,'purchase_order_line_id') and company_id=p_company for update; end if;
    select * into l from public.purchase_order_lines where id=private.commercial_uuid(p_m,'purchase_order_line_id') and company_id=p_company;
    if l.id is null then raise exception 'NOV: Choose a purchase order line of this company.'; end if;
    select * into po from public.purchase_orders where id=l.purchase_order_id and company_id=p_company;
    v_type:=p_m->>'claim_type'; v_remedy:=p_m->>'remedy';
    if v_type not in ('shortage','rejected_receipt','wrong_specification','damage') then raise exception 'NOV: Choose the kind of claim.'; end if;
    if v_remedy not in ('replacement','credit','refund') then raise exception 'NOV: Choose the remedy requested.'; end if;
    v_qty:=private.assurance_number(p_m,'quantity',0.001,100000000,3); v_amt:=private.assurance_number(p_m,'amount',0.01,1000000000,2);
    perform private.commercial_member(p_company,private.commercial_uuid(p_m,'owner_id'));
    v_due:=private.assurance_date(p_m,'response_due');
    if v_due<private.ist_today() or v_due>private.ist_today()+90 then raise exception 'NOV: The supplier response date must be within the next 90 days.'; end if;
    v_pool:=private.claim_pool(p_company,l.id,v_type);
    if v_qty>(v_pool->>'available')::numeric then raise exception 'NOV: Only % % are open to claim for a % claim on this line (% available at receipt, % already claimed).',trim_scale((v_pool->>'available')::numeric),l.unit,replace(v_type,'_',' '),trim_scale((v_pool->>'capacity')::numeric),trim_scale((v_pool->>'claimed')::numeric); end if;
    v_expected:=round(v_qty*l.unit_rate,2);
    if abs(v_amt-v_expected)>0.01 then v_warn:=v_warn||jsonb_build_array(format('The amount differs from the quantity at the purchase rate (%s). Check the supplier-reported figure against the order.',private.commercial_money(v_expected))); end if;
    v_warn:=v_warn||jsonb_build_array('A claim is a request. Nothing is credited or replaced until a receipt or an approved credit is linked to it.');
    v_title:='Submit a supplier claim'; v_effect:='Opens a claim against exactly this quantity so it cannot be claimed twice, and tracks the supplier response until recovery is recorded.';
    v_facts:=jsonb_build_object('Supplier',po.vendor_name_snapshot,'Purchase order',po.po_number||' line '||l.line_number,'Item',left(l.description,80),'Claim',replace(v_type,'_',' '),'Quantity',trim_scale(v_qty)||' '||l.unit,'Amount',private.commercial_money(v_amt),
      'Remedy requested',v_remedy,'Response due',to_char(v_due,'DD Mon YYYY'),'Open to claim now',trim_scale((v_pool->>'available')::numeric)||' '||l.unit);
    v_src:=jsonb_build_object('pool',v_pool); v_data:=jsonb_build_object('vendor_id',po.vendor_id,'purchase_order_id',po.id);
  else
    if p_lock then perform 1 from public.supplier_claims where id=private.commercial_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into k from public.supplier_claims where id=private.commercial_uuid(p_m,'id') and company_id=p_company;
    if k.id is null then raise exception 'NOV: The claim is unavailable.'; end if;
    select * into l from public.purchase_order_lines where id=k.purchase_order_line_id and company_id=p_company;
    v_rc:=private.claim_recovery(p_company,k.id);
    v_src:=jsonb_build_object('status',k.status,'updated_at',k.updated_at,'recovered',v_rc,'agreed_q',k.agreed_quantity,'agreed_a',k.agreed_amount);
    v_facts:=jsonb_build_object('Claim',k.claim_number,'Claimed',trim_scale(k.claimed_quantity)||' '||l.unit||' / '||private.commercial_money(k.claimed_amount),'Agreed',case when k.agreed_quantity is null then 'Not yet agreed' else trim_scale(k.agreed_quantity)||' '||l.unit||' / '||private.commercial_money(k.agreed_amount) end,
      'Recovered so far',trim_scale((v_rc->>'quantity')::numeric)||' '||l.unit||' / '||private.commercial_money((v_rc->>'amount')::numeric));
    if a='claim.respond' then
      if k.status not in ('submitted','disputed','agreed','partially_recovered') then raise exception 'NOV: A % claim cannot take a new supplier response.',k.status; end if;
      v_resp:=p_m->>'response';
      if v_resp not in ('agreed','disputed','rejected') then raise exception 'NOV: Choose the supplier response.'; end if;
      if v_resp='agreed' then
        if not (p_m ? 'agreed_quantity' and p_m ? 'agreed_amount') then raise exception 'NOV: Enter the agreed quantity and the agreed amount (0 where one does not apply).'; end if;
        v_aq:=private.assurance_number(p_m,'agreed_quantity',0,k.claimed_quantity,3); v_aa:=private.assurance_number(p_m,'agreed_amount',0,k.claimed_amount,2);
        if v_aq+v_aa<=0 then raise exception 'NOV: An agreed claim needs an agreed quantity or an agreed amount.'; end if;
        if v_aq<(v_rc->>'quantity')::numeric or v_aa<(v_rc->>'amount')::numeric then raise exception 'NOV: The agreed figures cannot be below what is already recovered (% % and %).',trim_scale((v_rc->>'quantity')::numeric),l.unit,private.commercial_money((v_rc->>'amount')::numeric); end if;
        if v_aq<k.claimed_quantity or v_aa<k.claimed_amount then v_warn:=v_warn||jsonb_build_array('The supplier agreed less than was claimed. The difference stays visible as unresolved until the claim is closed.'); end if;
      else
        if p_m ? 'agreed_quantity' or p_m ? 'agreed_amount' then raise exception 'NOV: Agreed figures belong to an agreed response only.'; end if;
        if (v_rc->>'count')::integer>0 then raise exception 'NOV: Recoveries are already linked; the claim cannot be % now. Reverse them first.',v_resp; end if;
        if k.status in ('agreed','partially_recovered') and v_resp='rejected' then v_warn:=v_warn||jsonb_build_array('The supplier had agreed this claim. The earlier agreement stays in the history.'); end if;
      end if;
      v_title:='Record the supplier response'; v_effect:='Records the response with its date. An agreed claim stays open until recovery is linked; no credit is created.';
      v_facts:=v_facts||jsonb_build_object('Response',v_resp,'Agreed quantity',case when v_resp='agreed' then trim_scale(v_aq)||' '||l.unit end,'Agreed amount',case when v_resp='agreed' then private.commercial_money(v_aa) end);
    elsif a='claim.link' then
      if k.status not in ('agreed','partially_recovered') then raise exception 'NOV: Recovery is linked only to an agreed claim; this one is %.',k.status; end if;
      v_kind:=p_m->>'kind';
      if v_kind not in ('replacement','credit','refund') then raise exception 'NOV: Choose the kind of recovery.'; end if;
      v_remaining_q:=coalesce(k.agreed_quantity,0)-(v_rc->>'quantity')::numeric; v_remaining_a:=coalesce(k.agreed_amount,0)-(v_rc->>'amount')::numeric;
      if v_kind='replacement' then
        if not (p_m ? 'receipt_line_id' and p_m ? 'quantity') or p_m ? 'credit_id' then raise exception 'NOV: A replacement links a receipt line and the quantity it replaces.'; end if;
        v_qty:=private.assurance_number(p_m,'quantity',0.001,100000000,3);
        select * into rl from public.purchase_receipt_lines where id=private.commercial_uuid(p_m,'receipt_line_id') and company_id=p_company;
        if rl.id is null or rl.purchase_order_line_id<>k.purchase_order_line_id then raise exception 'NOV: Choose a receipt of this purchase order line.'; end if;
        if rl.created_at<k.created_at then raise exception 'NOV: This receipt was recorded before the claim, so it cannot be its replacement.'; end if;
        if v_qty>rl.accepted_quantity then raise exception 'NOV: The receipt accepted only % %.',trim_scale(rl.accepted_quantity),l.unit; end if;
        if v_qty>v_remaining_q then raise exception 'NOV: Only % % of replacement remain against the agreed claim.',trim_scale(greatest(v_remaining_q,0)),l.unit; end if;
        if exists(select 1 from public.supplier_claim_recoveries where company_id=p_company and receipt_line_id=rl.id and reversed_at is null) then raise exception 'NOV: This receipt is already linked to a claim.'; end if;
        v_facts:=v_facts||jsonb_build_object('Recovery','Replacement receipt','Quantity',trim_scale(v_qty)||' '||l.unit,'Remaining after this',trim_scale(v_remaining_q-v_qty)||' '||l.unit);
        v_src:=v_src||jsonb_build_object('receipt',rl.id,'accepted',rl.accepted_quantity);
      else
        if not (p_m ? 'credit_id') or p_m ? 'receipt_line_id' or p_m ? 'quantity' then raise exception 'NOV: A credit or refund links one posted supplier credit.'; end if;
        select c.* into cr from public.expense_supplier_credits c join public.expense_ledger e on e.id=c.expense_ledger_id and e.company_id=c.company_id where c.id=private.commercial_uuid(p_m,'credit_id') and c.company_id=p_company and e.vendor_id=k.vendor_id;
        if cr.id is null then raise exception 'NOV: Choose a supplier credit from the same supplier.'; end if;
        if cr.status<>'posted' or cr.reversed_at is not null then raise exception 'NOV: Only a posted, unreversed credit can be linked.'; end if;
        if cr.credit_type<>(case v_kind when 'credit' then 'credit_note' else 'refund' end) then raise exception 'NOV: This is a % but you chose %.',replace(cr.credit_type,'_',' '),v_kind; end if;
        if cr.created_at<k.created_at then raise exception 'NOV: This credit was posted before the claim, so it cannot be its recovery.'; end if;
        if exists(select 1 from public.supplier_claim_recoveries where company_id=p_company and credit_id=cr.id and reversed_at is null) then raise exception 'NOV: This credit is already linked to a claim.'; end if;
        if cr.amount>v_remaining_a then raise exception 'NOV: This credit is %, more than the % remaining against the agreed claim.',private.commercial_money(cr.amount),private.commercial_money(greatest(v_remaining_a,0)); end if;
        v_facts:=v_facts||jsonb_build_object('Recovery',case v_kind when 'credit' then 'Supplier credit note' else 'Refund' end,'Amount',private.commercial_money(cr.amount),'Remaining after this',private.commercial_money(v_remaining_a-cr.amount));
        v_src:=v_src||jsonb_build_object('credit',cr.id,'credit_status',cr.status);
      end if;
      v_warn:=v_warn||jsonb_build_array('This links an existing receipt or credit. It does not create or post anything in stores or finance.');
      v_title:='Link recovery to the claim'; v_effect:='Counts this receipt or credit against the agreed claim. When the agreed figures are fully recovered the claim closes.';
    elsif a='claim.unlink' then
      if k.status not in ('agreed','partially_recovered') and not (k.status='closed' and k.unresolved_quantity=0 and k.unresolved_amount=0) then raise exception 'NOV: Recovery cannot be reversed on a % claim.',k.status; end if;
      select * into rec from public.supplier_claim_recoveries where id=private.commercial_uuid(p_m,'recovery_id') and company_id=p_company and claim_id=k.id;
      if rec.id is null or rec.reversed_at is not null then raise exception 'NOV: Choose a recovery that is still linked to this claim.'; end if;
      v_facts:=v_facts||jsonb_build_object('Recovery to reverse',rec.kind||' '||case when rec.kind='replacement' then trim_scale(rec.quantity)||' '||l.unit else private.commercial_money(rec.amount) end);
      v_src:=v_src||jsonb_build_object('recovery',rec.id);
      v_title:='Reverse a linked recovery'; v_effect:='Removes this link so the quantity or amount is open again. The receipt or credit itself is not changed.';
      if k.status='closed' then v_warn:=v_warn||jsonb_build_array('The claim was closed by full recovery and reopens.'); end if;
    else
      if k.status not in ('submitted','disputed','agreed','partially_recovered') then raise exception 'NOV: A % claim is already finished.',k.status; end if;
      if k.agreed_quantity is not null then
        v_unres_q:=greatest(k.agreed_quantity-(v_rc->>'quantity')::numeric,0); v_unres_a:=greatest(k.agreed_amount-(v_rc->>'amount')::numeric,0);
      else v_unres_q:=k.claimed_quantity-(v_rc->>'quantity')::numeric; v_unres_a:=k.claimed_amount-(v_rc->>'amount')::numeric; end if;
      if v_unres_q>0 or v_unres_a>0 then v_warn:=v_warn||jsonb_build_array(format('Unresolved difference kept on the record: %s %s and %s.',trim_scale(v_unres_q),l.unit,private.commercial_money(v_unres_a))); end if;
      v_facts:=v_facts||jsonb_build_object('Unresolved quantity',trim_scale(v_unres_q)||' '||l.unit,'Unresolved amount',private.commercial_money(v_unres_a));
      v_title:='Close the claim'; v_effect:='Closes the claim with your reason. Any unresolved difference stays on the record.';
      v_data:=jsonb_build_object('unres_q',v_unres_q,'unres_a',v_unres_a);
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.commercial_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.commercial_ctx_profit(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; o public.orders; v_model jsonb; v_warn jsonb:='[]'::jsonb; v_final boolean; v_latest public.job_profit_snapshots; x text;
begin
  select * into o from public.orders where id=private.commercial_uuid(p_m,'order_id') and company_id=p_company and deleted_at is null;
  if o.id is null then raise exception 'NOV: The order is unavailable.'; end if;
  if jsonb_typeof(p_m->'finalize') is distinct from 'boolean' then raise exception 'NOV: Choose provisional or final.'; end if;
  v_final:=(p_m->>'finalize')::boolean;
  if p_lock then perform 1 from public.orders where id=o.id and company_id=p_company for update; end if;
  v_model:=private.profit_model(p_company,o.id);
  select * into v_latest from public.job_profit_snapshots where company_id=p_company and order_id=o.id order by recorded_at desc,id limit 1;
  if v_final then
    if not (v_model->>'has_estimate')::boolean then raise exception 'NOV: An order without an accepted quotation snapshot has no estimate and cannot be finalised.'; end if;
    if coalesce((v_model->>'finalized')::boolean,false) then raise exception 'NOV: This order is already finalised. Record a provisional adjustment snapshot for later evidence.'; end if;
  end if;
  for x in select jsonb_array_elements_text(v_model->'missing') loop v_warn:=v_warn||jsonb_build_array(x); end loop;
  if v_final then v_warn:=v_warn||jsonb_build_array('Finalising marks this comparison as the agreed record for the order. Later adjustments are kept as new snapshots, never edits.'); end if;
  v_warn:=v_warn||jsonb_build_array('Recorded cost covers only expenses linked to this order, its jobs, finishing jobs or dispatches. Material and conversion cost are not derived from stock or machine hours here.');
  return jsonb_build_object('source',jsonb_build_object('model',md5(v_model::text)),'data',jsonb_build_object('model',v_model),
    'review',private.commercial_review(case when v_final then 'Finalise the job profitability comparison' else 'Record a provisional profitability snapshot' end,
      'Stores the estimate, the recorded figures and the gaps as of now. It is an internal management record; no ledger, price or customer document changes.',v_warn,
      jsonb_build_object('Order',o.order_number,'Estimated revenue',coalesce(private.commercial_money((v_model->>'estimated_revenue')::numeric),'Not recorded'),'Net invoiced revenue',coalesce(private.commercial_money((v_model->>'net_revenue')::numeric),'Not recorded'),
        'Estimated cost',coalesce(private.commercial_money((v_model->>'estimated_cost')::numeric),'Not recorded'),'Recorded linked cost',coalesce(private.commercial_money((v_model->>'recorded_cost_total')::numeric),'Not recorded'),'Status',case when v_final then 'Final' else 'Provisional' end)));
end $$;

create function private.commercial_ctx_commitment(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare po public.purchase_orders; c public.supplier_commitments; v_date date; v_warn jsonb:='[]'::jsonb; v_first date; v_facts jsonb;
begin
  if p_lock then perform 1 from public.purchase_orders where id=private.commercial_uuid(p_m,'purchase_order_id') and company_id=p_company for update; end if;
  select * into po from public.purchase_orders where id=private.commercial_uuid(p_m,'purchase_order_id') and company_id=p_company;
  if po.id is null then raise exception 'NOV: Choose a purchase order of this company.'; end if;
  v_date:=private.assurance_date(p_m,'promised_date');
  if v_date<po.order_date or v_date>po.order_date+365 then raise exception 'NOV: The promised date must fall within a year of the order date (%).',to_char(po.order_date,'DD Mon YYYY'); end if;
  select * into c from public.supplier_commitments where company_id=p_company and purchase_order_id=po.id;
  select min(receipt_date) into v_first from public.purchase_receipts where company_id=p_company and purchase_order_id=po.id;
  if c.id is not null and c.current_date_promised=v_date then raise exception 'NOV: The supplier already promised %.',to_char(v_date,'DD Mon YYYY'); end if;
  if c.id is null and v_first is not null then v_warn:=v_warn||jsonb_build_array('A receipt is already recorded for this order, so this promise is entered after the fact and cannot show lateness reliably.'); end if;
  if c.id is not null then v_warn:=v_warn||jsonb_build_array(format('The original promise of %s is kept. Lateness is always measured against it, not against the revised date.',to_char(c.original_date,'DD Mon YYYY'))); end if;
  v_facts:=jsonb_build_object('Purchase order',po.po_number,'Supplier',po.vendor_name_snapshot,'Original promise',case when c.id is null then 'This will be the original promise' else to_char(c.original_date,'DD Mon YYYY') end,
    'Current promise',coalesce(to_char(c.current_date_promised,'DD Mon YYYY'),'None'),'New promise',to_char(v_date,'DD Mon YYYY'),'Revisions so far',coalesce(c.revision_count,0));
  return jsonb_build_object('source',jsonb_build_object('commitment',c.id,'current',c.current_date_promised,'rev',c.revision_count,'first_receipt',v_first),'data','{}'::jsonb,
    'review',private.commercial_review(case when c.id is null then 'Record the supplier''s promised date' else 'Record a revised promised date' end,'Keeps the original promise and every revision so rescheduling never erases lateness.',v_warn,v_facts));
end $$;

create function private.commercial_ctx_outcome(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; q public.quotes; o public.quote_outcomes; sh jsonb; v_class text; v_warn jsonb:='[]'::jsonb; v_facts jsonb; v_title text; v_effect text;
begin
  if p_lock then perform 1 from public.quotes where id=private.commercial_uuid(p_m,'quote_id') and company_id=p_company for update; end if;
  select * into q from public.quotes where id=private.commercial_uuid(p_m,'quote_id') and company_id=p_company and deleted_at is null and dealer_id is null;
  if q.id is null then raise exception 'NOV: Choose a quotation of this company.'; end if;
  select * into o from public.quote_outcomes where company_id=p_company and quote_id=q.id and status='active';
  sh:=private.quote_order_share(p_company,q.id);
  v_class:=private.quote_class(q.status,q.valid_until,(sh->>'orders')::integer,(sh->>'ordered_kg')::numeric,(sh->>'quoted_kg')::numeric,o.outcome);
  if v_class='not_issued' then raise exception 'NOV: Only an issued quotation has an outcome.'; end if;
  if a='outcome.record' then
    if v_class in ('won','partially_won') then raise exception 'NOV: Orders already show this quotation was won (%), so no loss is recorded for it.',v_class; end if;
    if o.id is not null then raise exception 'NOV: An outcome is already recorded. Reopen it first to record a different one.'; end if;
    if p_m->>'outcome' not in ('lost','withdrawn','no_decision') then raise exception 'NOV: Choose lost, withdrawn or no decision.'; end if;
    if p_m->>'reason_code' not in ('price','lead_time','availability','specification','competitor','project_cancelled','no_response','other') then raise exception 'NOV: Choose a reason.'; end if;
    if p_m->>'evidence' not in ('customer_stated','sales_observed') then raise exception 'NOV: Say whether the customer stated the reason or sales observed it.'; end if;
    if p_m ? 'product_family' then perform private.assurance_text(p_m,'product_family',2,60); end if;
    if p_m->>'outcome'='no_decision' and p_m->>'reason_code'<>'no_response' then v_warn:=v_warn||jsonb_build_array('No decision is usually paired with "no response".'); end if;
    if p_m->>'evidence'='sales_observed' then v_warn:=v_warn||jsonb_build_array('A sales-observed reason is an observation, not a customer-confirmed cause. Reports show the evidence type.'); end if;
    v_title:='Record the quotation outcome'; v_effect:='Closes this opportunity once, against the current quotation revision. Revisions are not counted as new opportunities.';
    v_facts:=jsonb_build_object('Quotation',q.quote_number,'Revision',q.revision_number,'Outcome',replace(p_m->>'outcome','_',' '),'Reason',replace(p_m->>'reason_code','_',' '),'Evidence',replace(p_m->>'evidence','_',' '),'Product family',coalesce(p_m->>'product_family','Not given'));
  else
    if o.id is null then raise exception 'NOV: No outcome is recorded for this quotation.'; end if;
    v_warn:=v_warn||jsonb_build_array('The earlier outcome stays in the history.');
    v_title:='Reopen the quotation'; v_effect:='Returns the quotation to open or awaiting a reason. The recorded outcome is retained as reopened.';
    v_facts:=jsonb_build_object('Quotation',q.quote_number,'Recorded outcome',replace(o.outcome,'_',' ')||' ('||replace(o.reason_code,'_',' ')||')');
  end if;
  return jsonb_build_object('source',jsonb_build_object('class',v_class,'outcome',o.id,'revision',q.revision_number,'orders',sh->'orders'),'data','{}'::jsonb,'review',private.commercial_review(v_title,v_effect,v_warn,v_facts));
end $$;


create function private.commercial_ctx_remnant(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; l public.remnant_lots; pf public.aluminium_profiles; oi public.order_items; o public.orders; al public.remnant_allocations; v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb; v_title text; v_effect text;
  v_src jsonb:='{}'::jsonb; v_data jsonb:='{}'::jsonb; v_len integer; v_pieces integer; v_wpp numeric; v_reserved integer; v_cut integer; v_open integer; v_need integer; v_alloy text; v_temper text; v_status text; v_dec text;
begin
  if a='remnant.record' then
    select * into pf from public.aluminium_profiles where id=private.commercial_uuid(p_m,'profile_id') and company_id=p_company and deleted_at is null and is_active;
    if pf.id is null then raise exception 'NOV: Choose an active profile of this company.'; end if;
    if coalesce(pf.section_weight_kg_per_m,0)<=0 then raise exception 'NOV: This profile has no section weight, so the lot weight cannot be derived.'; end if;
    v_len:=private.assurance_number(p_m,'length_mm',100,12000,0)::integer; v_pieces:=private.assurance_number(p_m,'pieces',1,10000,0)::integer;
    perform private.assurance_text(p_m,'finish',2,40); perform private.assurance_text(p_m,'location',2,60);
    if p_m->>'origin_type' not in ('cutting_remnant','approved_excess') then raise exception 'NOV: Choose where the material came from.'; end if;
    if p_m ? 'condition' and p_m->>'condition' not in ('good','damaged') then raise exception 'NOV: Choose the condition.'; end if;
    if p_m ? 'source_job_id' and not exists(select 1 from public.production_jobs where id=private.commercial_uuid(p_m,'source_job_id') and company_id=p_company) then raise exception 'NOV: Choose a production job of this company.'; end if;
    v_alloy:=case when p_m ? 'alloy' then private.assurance_text(p_m,'alloy',1,40) else pf.alloy end; v_temper:=case when p_m ? 'temper' then private.assurance_text(p_m,'temper',1,40) else pf.temper end;
    v_wpp:=round(pf.section_weight_kg_per_m*v_len/1000.0,4);
    v_status:=case when v_len<500 or coalesce(p_m->>'condition','good')='damaged' then 'held' else 'available' end;
    if v_len<500 then v_warn:=v_warn||jsonb_build_array('Below 500 mm the lot is rarely usable. It is recorded on hold until someone reviews it as usable.'); end if;
    if coalesce(p_m->>'condition','good')='damaged' then v_warn:=v_warn||jsonb_build_array('A damaged lot is recorded on hold and is never suggested for an order.'); end if;
    if p_m->>'origin_type'='approved_excess' then v_warn:=v_warn||jsonb_build_array('Excess output stays company material. It is not customer-owned and not billable until a separate decision.'); end if;
    v_warn:=v_warn||jsonb_build_array('This lot is a register entry. It does not post to the profile stock ledger; consumption is recorded here and reconciled with the physical rack.');
    v_title:='Record a reusable remnant'; v_effect:='Adds a physical lot with its measured length and piece count to the remnant register.';
    v_facts:=jsonb_build_object('Profile',pf.profile_code,'Length',v_len||' mm','Pieces',v_pieces,'Weight per piece',trim_scale(v_wpp)||' kg','Total',trim_scale(round(v_pieces*v_wpp,3))||' kg','Finish',p_m->>'finish','Alloy and temper',coalesce(v_alloy,'not set')||' '||coalesce(v_temper,''),
      'Origin',replace(p_m->>'origin_type','_',' '),'Location',p_m->>'location','Starts as',v_status);
    v_src:=jsonb_build_object('weight',pf.section_weight_kg_per_m); v_data:=jsonb_build_object('wpp',v_wpp,'status',v_status,'alloy',v_alloy,'temper',v_temper,'len',v_len,'pieces',v_pieces);
  elsif a in ('remnant.consume','remnant.release') then
    if p_lock then perform 1 from public.remnant_allocations where id=private.commercial_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into al from public.remnant_allocations where id=private.commercial_uuid(p_m,'id') and company_id=p_company;
    if al.id is null or al.status<>'reserved' then raise exception 'NOV: Choose a reservation that is still reserved.'; end if;
    select * into l from public.remnant_lots where id=al.lot_id and company_id=p_company;
    if l.status in ('scrapped','exhausted') then raise exception 'NOV: This lot is %.',l.status; end if;
    if a='remnant.consume' and l.pieces<al.pieces then raise exception 'NOV: The lot now holds % piece(s), fewer than reserved. Correct the lot first.',l.pieces; end if;
    select od.order_number into v_dec from public.orders od join public.order_items it on it.order_id=od.id and it.company_id=od.company_id where it.id=al.order_item_id and od.company_id=p_company;
    v_title:=case when a='remnant.consume' then 'Record the remnant as cut and used' else 'Release the reservation' end;
    v_effect:=case when a='remnant.consume' then 'Reduces the lot by the reserved pieces. Use this after the pieces were cut and issued. It does not post to the stock ledger.' else 'Returns the reserved pieces to the lot for other requirements.' end;
    v_facts:=jsonb_build_object('Lot',l.lot_number,'Order',v_dec,'Pieces',al.pieces,'Cut length',al.cut_length_mm||' mm','Lot pieces now',l.pieces);
    v_src:=jsonb_build_object('alloc',al.status,'lot_pieces',l.pieces,'lot_status',l.status);
  else
    if p_lock then perform 1 from public.remnant_lots where id=private.commercial_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into l from public.remnant_lots where id=private.commercial_uuid(p_m,'id') and company_id=p_company;
    if l.id is null then raise exception 'NOV: The lot is unavailable.'; end if;
    select coalesce(sum(pieces),0)::integer into v_reserved from public.remnant_allocations where company_id=p_company and lot_id=l.id and status='reserved';
    v_src:=jsonb_build_object('status',l.status,'pieces',l.pieces,'length',l.length_mm,'condition',l.condition,'reserved',v_reserved,'corrections',l.correction_count);
    v_facts:=jsonb_build_object('Lot',l.lot_number,'Length',l.length_mm||' mm','Pieces',l.pieces,'Reserved',v_reserved,'Status',l.status,'Condition',l.condition);
    if a='remnant.review' then
      if l.status not in ('available','held') then raise exception 'NOV: A % lot is not reviewed.',l.status; end if;
      v_dec:=p_m->>'decision';
      if v_dec not in ('usable','hold','damaged') then raise exception 'NOV: Choose usable, hold or damaged.'; end if;
      if v_dec='usable' and l.condition<>'good' then raise exception 'NOV: A damaged lot cannot be marked usable. Correct its condition through a new record.'; end if;
      if v_dec in ('hold','damaged') and v_reserved>0 then raise exception 'NOV: Release the % reserved piece(s) before putting this lot on hold or marking it damaged.',v_reserved; end if;
      if v_dec='usable' and l.length_mm<500 then v_warn:=v_warn||jsonb_build_array('The lot is below 500 mm. Marking it usable is your explicit decision and is recorded.'); end if;
      v_title:='Review the remnant'; v_effect:=case v_dec when 'usable' then 'Makes the lot available to suggest for matching requirements.' when 'hold' then 'Keeps the lot out of suggestions until it is reviewed again.' else 'Marks the lot damaged and removes it from suggestions.' end;
      v_facts:=v_facts||jsonb_build_object('Decision',v_dec);
    elsif a='remnant.reserve' then
      if l.status<>'available' or l.condition<>'good' then raise exception 'NOV: Only an available lot in good condition can be reserved; this one is % and %.',l.status,l.condition; end if;
      v_pieces:=private.assurance_number(p_m,'pieces',1,10000,0)::integer;
      if v_pieces>l.pieces-v_reserved then raise exception 'NOV: Only % piece(s) are free; the rest are reserved for other requirements.',greatest(l.pieces-v_reserved,0); end if;
      select * into oi from public.order_items where id=private.commercial_uuid(p_m,'order_item_id') and company_id=p_company;
      if oi.id is null then raise exception 'NOV: Choose an order line of this company.'; end if;
      select * into o from public.orders where id=oi.order_id and company_id=p_company and deleted_at is null;
      if o.id is null or o.current_stage in ('cancelled','closed','delivered','payment_pending','dispatched') then raise exception 'NOV: This order is no longer open for material.'; end if;
      if oi.profile_id is distinct from l.profile_id then raise exception 'NOV: The order line is for a different profile. Matching code alone is not enough; the profile must be the same.'; end if;
      select * into pf from public.aluminium_profiles where id=oi.profile_id and company_id=p_company;
      if l.alloy is not null and pf.alloy is not null and l.alloy<>pf.alloy then raise exception 'NOV: The alloy differs (lot %, profile %).',l.alloy,pf.alloy; end if;
      if l.temper is not null and pf.temper is not null and l.temper<>pf.temper then raise exception 'NOV: The temper differs (lot %, profile %).',l.temper,pf.temper; end if;
      if oi.finishing_type is not null and lower(oi.finishing_type)<>lower(l.finish) and lower(l.finish) not in ('mill finish','mill') then raise exception 'NOV: The finish differs (lot %, order line %).',l.finish,oi.finishing_type; end if;
      v_cut:=round(coalesce(oi.cut_length,oi.length_per_piece_m*1000))::integer;
      if v_cut is null or v_cut<=0 then raise exception 'NOV: The order line has no cut length, so fit cannot be judged.'; end if;
      if v_cut>l.length_mm then raise exception 'NOV: The cut length (% mm) is longer than the lot (% mm). Equal kilograms do not make a shorter length fit.',v_cut,l.length_mm; end if;
      v_need:=coalesce(oi.quantity_pieces,oi.order_quantity::integer,0);
      v_open:=greatest(v_need-coalesce((select sum(x.pieces) from public.remnant_allocations x where x.company_id=p_company and x.order_item_id=oi.id and x.status in ('reserved','consumed')),0),0);
      if v_pieces>v_open then raise exception 'NOV: The order line needs only % more piece(s) (% already covered by remnants).',v_open,greatest(v_need-v_open,0); end if;
      v_warn:=v_warn||jsonb_build_array(format('Each piece leaves %s mm of waste from a %s mm remnant. Reserving does not change stock; consume it once cut.',l.length_mm-v_cut,l.length_mm));
      v_title:='Reserve remnant pieces for an order line'; v_effect:='Holds these pieces for the order line so a competing requirement cannot take them.';
      v_facts:=v_facts||jsonb_build_object('Order',o.order_number,'Cut length',v_cut||' mm','Pieces to reserve',v_pieces,'Waste per piece',(l.length_mm-v_cut)||' mm');
      v_src:=v_src||jsonb_build_object('item_open',v_open,'cut',v_cut); v_data:=jsonb_build_object('cut',v_cut,'waste',l.length_mm-v_cut,'pieces',v_pieces,'item',oi.id);
    elsif a='remnant.scrap' then
      if l.status not in ('available','held') then raise exception 'NOV: A % lot cannot be scrapped.',l.status; end if;
      if v_reserved>0 then raise exception 'NOV: Release the % reserved piece(s) before scrapping the lot.',v_reserved; end if;
      v_warn:=v_warn||jsonb_build_array('Scrapping ends the lot. The scrap weight is not posted to scrap or foundry records here.');
      v_title:='Scrap the remnant lot'; v_effect:='Marks the lot scrapped and removes it from suggestions. The record and its history are kept.';
    else
      if l.status not in ('available','held') then raise exception 'NOV: A % lot cannot be corrected.',l.status; end if;
      v_len:=private.assurance_number(p_m,'length_mm',100,12000,0)::integer; v_pieces:=private.assurance_number(p_m,'pieces',1,10000,0)::integer;
      if v_pieces<v_reserved then raise exception 'NOV: % piece(s) are reserved; correct to at least that many or release them first.',v_reserved; end if;
      if exists(select 1 from public.remnant_allocations where company_id=p_company and lot_id=l.id and status='reserved' and cut_length_mm>v_len) then raise exception 'NOV: A reservation needs a longer cut than the corrected length.'; end if;
      if v_len=l.length_mm and v_pieces=l.pieces then raise exception 'NOV: The measurement is unchanged.'; end if;
      select * into pf from public.aluminium_profiles where id=l.profile_id and company_id=p_company;
      v_wpp:=round(pf.section_weight_kg_per_m*v_len/1000.0,4);
      v_title:='Correct the measured lot'; v_effect:='Replaces the length and piece count with the new measurement and keeps the earlier values in the lot history.';
      v_facts:=v_facts||jsonb_build_object('Corrected length',v_len||' mm','Corrected pieces',v_pieces,'Corrected weight',trim_scale(round(v_pieces*v_wpp,3))||' kg');
      v_data:=jsonb_build_object('wpp',v_wpp,'len',v_len,'pieces',v_pieces);
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.commercial_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.commercial_ctx_transfer(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; m public.transfer_mappings; m2 public.transfer_mappings; b public.transfer_batches; t public.transfer_items; i public.invoices; v_warn jsonb:='[]'::jsonb; v_facts jsonb:='{}'::jsonb; v_title text; v_effect text;
  v_src jsonb:='{}'::jsonb; v_data jsonb:='{}'::jsonb; v_n integer; v_ids uuid[]; v_total numeric; v_first text; v_last text; v_credited integer; v_fps text; v_ver integer; v_ref text; v_pending integer;
begin
  if a='mapping.define' then
    perform private.assurance_text(p_m,'sales_ledger',2,80); perform private.assurance_text(p_m,'tax_ledger',2,80);
    if p_m->>'party_key' not in ('gst_number','customer_name') then raise exception 'NOV: Choose how the party is identified in the export.'; end if;
    if exists(select 1 from public.transfer_mappings where company_id=p_company and family='invoice_export' and status='draft') then raise exception 'NOV: A draft mapping already exists. Approve or retire it first.'; end if;
    select coalesce(max(version),0)+1 into v_ver from public.transfer_mappings where company_id=p_company and family='invoice_export';
    v_title:='Define the invoice export mapping'; v_effect:='Creates a draft mapping of invoice fields to ledger names. A second person approves it before any export uses it.';
    v_facts:=jsonb_build_object('Version',v_ver,'Sales ledger',btrim(p_m->>'sales_ledger'),'Tax ledger',btrim(p_m->>'tax_ledger'),'Party identified by',replace(p_m->>'party_key','_',' '));
    v_src:=jsonb_build_object('version',v_ver);
  elsif a in ('mapping.approve','mapping.retire') then
    if p_lock then perform 1 from public.transfer_mappings where id=private.commercial_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into m from public.transfer_mappings where id=private.commercial_uuid(p_m,'id') and company_id=p_company;
    if m.id is null then raise exception 'NOV: The mapping is unavailable.'; end if;
    v_src:=jsonb_build_object('status',m.status,'created_by',m.created_by);
    v_facts:=jsonb_build_object('Version',m.version,'Sales ledger',m.sales_ledger,'Tax ledger',m.tax_ledger,'Party identified by',replace(m.party_key,'_',' '));
    if a='mapping.approve' then
      if m.status<>'draft' then raise exception 'NOV: Only a draft mapping can be approved; this one is %.',m.status; end if;
      if m.created_by=p_actor then raise exception 'NOV: A second person approves a mapping; the person who defined it cannot.'; end if;
      select * into m2 from public.transfer_mappings where company_id=p_company and family='invoice_export' and status='approved';
      if m2.id is not null then v_warn:=v_warn||jsonb_build_array(format('Version %s is retired. Batches already prepared keep the version that built them.',m2.version)); end if;
      v_title:='Approve the export mapping'; v_effect:='Makes this version the one used to prepare new export batches.';
    else
      if m.status='retired' then raise exception 'NOV: This mapping is already retired.'; end if;
      v_title:='Retire the export mapping'; v_effect:='No new batch can be prepared until another mapping is approved. Existing batches are unchanged.';
    end if;
  elsif a='transfer.prepare' then
    select * into m from public.transfer_mappings where company_id=p_company and family='invoice_export' and status='approved';
    if m.id is null then raise exception 'NOV: Approve an export mapping before preparing a batch.'; end if;
    v_n:=private.assurance_number(p_m,'count',1,25,0)::integer;
    with e as (select z.id from private.transfer_eligible(p_company) z order by z.invoice_date,z.invoice_number,z.id limit v_n)
    select array_agg(x.id order by x.invoice_date,x.invoice_number,x.id),sum(x.grand_total),min(x.invoice_number),max(x.invoice_number),count(*) filter (where x.credited_amount>0),md5(string_agg(private.transfer_fp(x),',' order by x.invoice_date,x.invoice_number,x.id))
      into v_ids,v_total,v_first,v_last,v_credited,v_fps from e join public.invoices x on x.id=e.id;
    if v_ids is null then raise exception 'NOV: No issued invoice is waiting to be exported.'; end if;
    if v_credited>0 then v_warn:=v_warn||jsonb_build_array(format('%s invoice(s) have a credit note. They are exported at their issued amounts; the credit is a separate entry.',v_credited)); end if;
    v_warn:=v_warn||jsonb_build_array('Preparing and exporting write nothing into the accounting package. Only a recorded result from that package shows an invoice was accepted.');
    v_title:='Prepare an invoice export batch'; v_effect:='Reserves these invoices in a batch so they cannot be exported twice, each with a stable external identity.';
    v_facts:=jsonb_build_object('Invoices',cardinality(v_ids),'First invoice',v_first,'Last invoice',v_last,'Total',private.commercial_money(v_total),'Mapping',m.version,'Waiting in all',(select count(*) from private.transfer_eligible(p_company)));
    v_src:=jsonb_build_object('ids',v_ids,'fps',v_fps,'mapping',m.id); v_data:=jsonb_build_object('ids',v_ids,'mapping_id',m.id,'mapping_version',m.version,'total',v_total);
  elsif a in ('transfer.export','transfer.cancel') then
    if p_lock then perform 1 from public.transfer_batches where id=private.commercial_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into b from public.transfer_batches where id=private.commercial_uuid(p_m,'id') and company_id=p_company;
    if b.id is null then raise exception 'NOV: The batch is unavailable.'; end if;
    if b.status<>'prepared' then raise exception 'NOV: Only a prepared batch can be %; this one is %.',case when a='transfer.export' then 'exported' else 'cancelled' end,b.status; end if;
    select count(*) into v_n from public.transfer_items ti join public.invoices iv on iv.id=ti.invoice_id and iv.company_id=ti.company_id where ti.company_id=p_company and ti.batch_id=b.id and private.transfer_fp(iv)<>ti.invoice_fingerprint;
    v_src:=jsonb_build_object('status',b.status,'changed',v_n);
    v_facts:=jsonb_build_object('Batch',b.batch_number,'Invoices',b.item_count,'Total',private.commercial_money(b.total_amount),'Mapping version',b.mapping_version);
    if v_n>0 then v_warn:=v_warn||jsonb_build_array(format('%s invoice(s) changed since the batch was prepared. Cancel this batch and prepare it again.',v_n)); end if;
    if a='transfer.export' then
      if v_n>0 then raise exception 'NOV: % invoice(s) changed since the batch was prepared. Cancel it and prepare a new batch.',v_n; end if;
      v_title:='Record the batch as exported'; v_effect:='Marks the batch exported after you downloaded the file from its page. Each invoice still needs an accepted or rejected result from the accounting package.';
    else
      v_title:='Cancel the prepared batch'; v_effect:='Releases the invoices so they can be exported in another batch.';
    end if;
  else
    if p_lock then perform 1 from public.transfer_items where id=private.commercial_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into t from public.transfer_items where id=private.commercial_uuid(p_m,'id') and company_id=p_company;
    if t.id is null or t.state<>'pending' then raise exception 'NOV: Choose an exported invoice that is still awaiting a result.'; end if;
    select * into b from public.transfer_batches where id=t.batch_id and company_id=p_company;
    if b.status<>'exported' then raise exception 'NOV: The batch has not been exported.'; end if;
    select * into i from public.invoices where id=t.invoice_id and company_id=p_company;
    if p_m->>'result' not in ('accepted','rejected') then raise exception 'NOV: Choose accepted or rejected.'; end if;
    if p_m->>'result'='accepted' then
      if not (p_m ? 'external_reference') then raise exception 'NOV: Enter the reference the accounting package gave this invoice.'; end if;
      v_ref:=private.assurance_text(p_m,'external_reference',1,60);
      if exists(select 1 from public.transfer_items where company_id=p_company and state='accepted' and lower(external_reference)=lower(v_ref)) then raise exception 'NOV: Reference % is already recorded against another invoice.',v_ref; end if;
    elsif p_m ? 'external_reference' then raise exception 'NOV: A rejected invoice has no external reference; explain the rejection instead.'; end if;
    if private.transfer_fp(i)<>t.invoice_fingerprint then v_warn:=v_warn||jsonb_build_array('The invoice changed after it was exported. The result is recorded against the exported version; reconcile the difference separately.'); end if;
    if p_m->>'result'='rejected' then v_warn:=v_warn||jsonb_build_array('A rejected invoice becomes available for a later batch.'); end if;
    v_title:='Record the accounting package result'; v_effect:=case when p_m->>'result'='accepted' then 'Records that the package accepted this invoice. This reflects the package''s answer, not a verified posting.' else 'Records the rejection with your reason and releases the invoice for a later batch.' end;
    v_facts:=jsonb_build_object('Invoice',i.invoice_number,'External identity',t.external_ref,'Amount',private.commercial_money(t.amount+t.tax_amount),'Result',p_m->>'result','Package reference',v_ref);
    select count(*) into v_pending from public.transfer_items where company_id=p_company and batch_id=b.id and state='pending';
    v_src:=jsonb_build_object('state',t.state,'pending',v_pending,'fp',private.transfer_fp(i)); v_data:=jsonb_build_object('batch',b.id,'pending',v_pending);
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.commercial_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.commercial_ctx_run(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; p public.run_proposals; g jsonb; v_key text; v_warn jsonb:='[]'::jsonb; v_facts jsonb; v_title text; v_effect text; v_src jsonb; v_data jsonb:='{}'::jsonb; v_members text;
begin
  if a='run.save' then
    v_key:=p_m->>'group_key';
    if v_key is null or v_key !~ '^[0-9a-f]{32}$' then raise exception 'NOV: Choose a proposed run.'; end if;
    select x.value into g from jsonb_array_elements(private.run_groups(p_company)) x where x.value->>'key'=v_key;
    if g is null then raise exception 'NOV: This grouping no longer exists. The jobs changed; open the proposals again.'; end if;
    if (g->>'die_out')::boolean or g->>'die_status' in ('blocked','scrapped','retired') then raise exception 'NOV: The die cannot run: it is % or out on a gate pass.',g->>'die_status'; end if;
    if exists(select 1 from public.run_proposals where company_id=p_company and group_key=v_key and status='proposed') then raise exception 'NOV: This grouping is already proposed.'; end if;
    select string_agg((m->>'job_number')||' ('||(m->>'order_number')||', '||trim_scale((m->>'kg')::numeric)||' kg)','; ') into v_members from jsonb_array_elements(g->'members') m;
    if (g->>'customers')::integer>1 then v_warn:=v_warn||jsonb_build_array('The jobs belong to several customers. Each order keeps its own quantity and ownership; the shared run only saves the die setup.'); end if;
    if (g->>'not_merged')::integer>0 then v_warn:=v_warn||jsonb_build_array(format('%s other job(s) on the same die differ in alloy, temper, finish or drawing revision and are deliberately not merged.',g->>'not_merged')); end if;
    v_warn:=v_warn||jsonb_build_array('Setup time, run time and yield are not estimated here. Saving a proposal does not change any job, date or press.');
    v_title:='Save a compatible run proposal'; v_effect:='Keeps this grouping and each job''s contribution as an advisory proposal for the planner to act on in production planning.';
    v_facts:=jsonb_build_object('Die',g->>'die_number','Profile',g->>'profile_code','Jobs',v_members,'Orders',g->>'orders','Total',trim_scale(round((g->>'total_kg')::numeric,1))||' kg','Changeovers saved',g->>'changeovers_saved','Earliest due date',g->>'earliest_due');
    v_src:=jsonb_build_object('key',v_key,'kg',g->'total_kg','n',g->'member_count'); v_data:=jsonb_build_object('group',g);
  else
    if p_lock then perform 1 from public.run_proposals where id=private.commercial_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into p from public.run_proposals where id=private.commercial_uuid(p_m,'id') and company_id=p_company;
    if p.id is null or p.status<>'proposed' then raise exception 'NOV: Choose a proposal that is still open.'; end if;
    select x.value into g from jsonb_array_elements(private.run_groups(p_company)) x where x.value->>'key'=p.group_key;
    v_facts:=jsonb_build_object('Proposal',p.label,'Jobs',jsonb_array_length(p.members),'Changeovers saved',p.saving_changeovers);
    v_src:=jsonb_build_object('status',p.status,'current',g is not null);
    if a='run.accept' then
      if g is null then raise exception 'NOV: The jobs changed since this was proposed, so it can no longer be accepted. Dismiss it and review the new proposal.'; end if;
      v_warn:=v_warn||jsonb_build_array('Accepting records the planner''s decision only. Schedule the jobs together in production planning; nothing is scheduled by this action.');
      v_title:='Accept the run proposal'; v_effect:='Records that the planner will run these jobs together.';
    else
      v_title:='Dismiss the run proposal'; v_effect:='Closes this proposal with your reason.';
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.commercial_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.commercial_ctx_scenario(p_company uuid,p_actor uuid,p_role text,p_m jsonb,p_lock boolean) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_m->>'action'; s public.planning_scenarios; v_snap jsonb; v_res jsonb; v_days integer; v_warn jsonb:='[]'::jsonb; v_facts jsonb; v_title text; v_effect text; v_src jsonb; v_data jsonb:='{}'::jsonb; v_start date:=private.ist_today();
  v_unm integer; v_excl integer; v_sum jsonb;
begin
  if a='scenario.create' then
    perform private.assurance_text(p_m,'name',3,80);
    v_days:=private.assurance_number(p_m,'horizon_days',3,14,0)::integer;
    v_snap:=private.scenario_snapshot(p_company,v_start,v_days);
    perform private.scenario_validate_changes(v_snap,p_m->'changes');
    v_res:=private.scenario_evaluate(v_snap,p_m->'changes'); v_sum:=v_res->'summary';
    select count(*) into v_unm from jsonb_array_elements(v_snap->'machines') m where not (m.value->>'measured')::boolean;
    v_excl:=jsonb_array_length(v_snap->'excluded');
    if v_unm>0 then v_warn:=v_warn||jsonb_build_array(format('%s press(es) have no recorded shift capacity, so their jobs are not simulated. This is stated, not treated as unlimited or zero capacity.',v_unm)); end if;
    if v_excl>0 then v_warn:=v_warn||jsonb_build_array(format('%s job(s) are left out: no press assigned or on hold.',v_excl)); end if;
    v_warn:=v_warn||jsonb_build_array('Everything in this scenario is hypothetical. Hypothetical capacity or receipts never satisfy actual readiness, and no customer commitment is made from it.');
    v_title:='Create a what-if planning scenario'; v_effect:='Stores an isolated snapshot, your hypothetical changes and the comparison. Live stock, assignments, dates and schedules are not touched.';
    v_facts:=jsonb_build_object('Scenario',btrim(p_m->>'name'),'Horizon',v_days||' days from '||to_char(v_start,'DD Mon YYYY'),'Jobs in the snapshot',jsonb_array_length(v_snap->'jobs'),'Hypothetical changes',jsonb_array_length(p_m->'changes'),
      'Jobs finishing later',v_sum->>'jobs_delayed','Newly late',v_sum->>'newly_late','Newly unscheduled in horizon',v_sum->>'newly_unscheduled','Not simulated',v_sum->>'not_simulated');
    v_src:=jsonb_build_object('snap',md5(v_snap::text),'changes',md5((p_m->'changes')::text));
    v_data:=jsonb_build_object('snapshot',v_snap,'result',v_res,'days',v_days,'start',v_start);
  else
    if p_lock then perform 1 from public.planning_scenarios where id=private.commercial_uuid(p_m,'id') and company_id=p_company for update; end if;
    select * into s from public.planning_scenarios where id=private.commercial_uuid(p_m,'id') and company_id=p_company;
    if s.id is null then raise exception 'NOV: The scenario is unavailable.'; end if;
    v_facts:=jsonb_build_object('Scenario',s.name,'Status',s.status,'Horizon',s.horizon_days||' days from '||to_char(s.horizon_start,'DD Mon YYYY'),'Jobs finishing later',s.result->'summary'->>'jobs_delayed');
    v_src:=jsonb_build_object('status',s.status);
    if a='scenario.share' then
      if s.status<>'draft' then raise exception 'NOV: Only a draft scenario can be shared; this one is %.',s.status; end if;
      v_title:='Share the scenario for review'; v_effect:='Marks it ready for a second planner to review. It remains hypothetical.';
    elsif a='scenario.discard' then
      if s.status not in ('draft','shared') then raise exception 'NOV: A % scenario cannot be discarded.',s.status; end if;
      v_title:='Discard the scenario'; v_effect:='Closes it. Nothing in the live plan changed, so nothing is undone.';
    else
      if s.status<>'shared' then raise exception 'NOV: Only a shared scenario can be accepted; this one is %.',s.status; end if;
      if s.created_by=p_actor then raise exception 'NOV: A second planner accepts a scenario; its creator cannot.'; end if;
      v_snap:=private.scenario_snapshot(p_company,s.horizon_start,s.horizon_days);
      if v_snap::text is distinct from s.baseline::text then raise exception 'NOV: Jobs, capacity or maintenance changed since the snapshot. The scenario cannot be rebased automatically; create a new one from current data.'; end if;
      v_warn:=v_warn||jsonb_build_array('Accepting retains this scenario as the agreed response. It changes no job, date, assignment or promise; make each change through production planning.');
      v_title:='Accept the scenario'; v_effect:='Records the scenario as accepted after confirming the live sources still match its snapshot.';
      v_src:=v_src||jsonb_build_object('snap',md5(v_snap::text));
    end if;
  end if;
  return jsonb_build_object('source',v_src,'data',v_data,'review',private.commercial_review(v_title,v_effect,v_warn,v_facts));
end $$;

create function private.commercial_context(p_company uuid,p_actor uuid,p_mutation jsonb,p_lock boolean default false) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; v_role text;
begin
  perform private.commercial_assert_shape(p_mutation);
  select role into v_role from public.app_users where id=p_actor and company_id=p_company and is_active and dealer_id is null;
  if not private.commercial_action_allowed(v_role,a) then raise exception 'Not permitted' using errcode='42501'; end if;
  return case split_part(a,'.',1)
    when 'pricing' then private.commercial_ctx_pricing(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'claim' then private.commercial_ctx_claim(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'profit' then private.commercial_ctx_profit(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'commitment' then private.commercial_ctx_commitment(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'outcome' then private.commercial_ctx_outcome(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'remnant' then private.commercial_ctx_remnant(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'mapping' then private.commercial_ctx_transfer(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'transfer' then private.commercial_ctx_transfer(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'run' then private.commercial_ctx_run(p_company,p_actor,v_role,p_mutation,p_lock)
    when 'scenario' then private.commercial_ctx_scenario(p_company,p_actor,v_role,p_mutation,p_lock)
  end;
end $$;
revoke all on function private.commercial_ctx_pricing(uuid,uuid,text,jsonb,boolean),private.commercial_ctx_claim(uuid,uuid,text,jsonb,boolean),private.commercial_ctx_profit(uuid,uuid,text,jsonb,boolean),
  private.commercial_ctx_commitment(uuid,uuid,text,jsonb,boolean),private.commercial_ctx_outcome(uuid,uuid,text,jsonb,boolean),private.commercial_ctx_remnant(uuid,uuid,text,jsonb,boolean),
  private.commercial_ctx_transfer(uuid,uuid,text,jsonb,boolean),private.commercial_ctx_run(uuid,uuid,text,jsonb,boolean),private.commercial_ctx_scenario(uuid,uuid,text,jsonb,boolean),
  private.commercial_context(uuid,uuid,jsonb,boolean) from public,anon,authenticated;


------------------------------------------------------------------------------------------------
-- Apply: runs inside the confirmed request, after the context was checked again under row locks.
------------------------------------------------------------------------------------------------
create function private.claim_settle(p_company uuid,p_claim uuid) returns void language plpgsql security definer set search_path=public,private as $$
declare k public.supplier_claims; rc jsonb; v_q numeric; v_a numeric; v_full boolean;
begin
  select * into k from public.supplier_claims where id=p_claim and company_id=p_company;
  if k.id is null then return; end if;
  if not (k.status in ('agreed','partially_recovered') or (k.status='closed' and k.unresolved_quantity=0 and k.unresolved_amount=0)) then return; end if;
  rc:=private.claim_recovery(p_company,k.id); v_q:=(rc->>'quantity')::numeric; v_a:=(rc->>'amount')::numeric;
  v_full:=(v_q>0 or v_a>0) and v_q>=coalesce(k.agreed_quantity,0) and v_a>=coalesce(k.agreed_amount,0);
  if v_full then
    update public.supplier_claims set status='closed',closed_at=coalesce(closed_at,clock_timestamp()),close_note='Fully recovered',unresolved_quantity=0,unresolved_amount=0,updated_at=clock_timestamp() where id=k.id;
  else
    update public.supplier_claims set status=case when v_q>0 or v_a>0 then 'partially_recovered' else 'agreed' end,closed_at=null,close_note=null,unresolved_quantity=null,unresolved_amount=null,updated_at=clock_timestamp() where id=k.id;
  end if;
end $$;
revoke all on function private.claim_settle(uuid,uuid) from public,anon,authenticated;

create function private.commercial_apply(p_company uuid,p_actor uuid,p_request uuid,p_mutation jsonb,p_context jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare a text:=p_mutation->>'action'; n text:=btrim(coalesce(p_mutation->>'note','')); v_id uuid:=nullif(p_mutation->>'id','')::uuid; v_view text:=private.commercial_view(p_mutation->>'action');
  v_facts jsonb:=p_context->'review'->'facts'; v_data jsonb:=coalesce(p_context->'data','{}'::jsonb); v_entity uuid; v_ver integer; v_num text; k public.supplier_claims; l public.remnant_lots; al public.remnant_allocations;
  po public.purchase_orders; c public.supplier_commitments; t public.transfer_items; b public.transfer_batches; p public.run_proposals; s public.planning_scenarios; v_count integer; v_pending integer; r public.supplier_claim_recoveries;
begin
  v_entity:=coalesce(v_id,p_request);
  -- NOV-064 -----------------------------------------------------------------------------------
  if a='pricing.define' then
    select coalesce(max(version),0)+1 into v_ver from public.pricing_rules where company_id=p_company and code=p_mutation->>'code';
    insert into public.pricing_rules(id,company_id,code,version,name,charge_type,unit_basis,customer_id,finishing_type,processing_code,amount,precedence,effective_from,effective_to,created_by)
    values(p_request,p_company,p_mutation->>'code',v_ver,btrim(p_mutation->>'name'),p_mutation->>'charge_type',p_mutation->>'unit_basis',nullif(p_mutation->>'customer_id','')::uuid,nullif(btrim(coalesce(p_mutation->>'finishing_type','')),''),
      nullif(p_mutation->>'processing_code',''),nullif(p_mutation->>'amount','')::numeric,(p_mutation->>'precedence')::integer,(p_mutation->>'effective_from')::date,nullif(p_mutation->>'effective_to','')::date,p_actor);
    insert into public.pricing_rule_brackets(company_id,rule_id,seq,from_qty,to_qty,rate)
    select p_company,p_request,ord::integer,(x->>'from')::numeric,nullif(x->>'to','')::numeric,(x->>'rate')::numeric from jsonb_array_elements(coalesce(p_mutation->'brackets','[]'::jsonb)) with ordinality t(x,ord);
    perform private.commercial_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Pricing rule drafted','href','/tasks/commercial/pricing/'||p_request,'message','A second person approves it before any price uses it.');
  elsif a='pricing.approve' then
    update public.pricing_rules set status='retired',retired_at=clock_timestamp() where company_id=p_company and status='approved' and code=(select code from public.pricing_rules where id=v_id and company_id=p_company);
    update public.pricing_rules set status='approved',approved_by=p_actor,approved_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='pricing.retire' then update public.pricing_rules set status='retired',retired_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='pricing.void' then update public.pricing_calculations set status='voided' where id=v_id and company_id=p_company;
  elsif a='pricing.price' then
    if nullif(v_data->>'prev','') is not null then update public.pricing_calculations set status='superseded' where id=(v_data->>'prev')::uuid and company_id=p_company; end if;
    insert into public.pricing_calculations(id,company_id,customer_id,quote_id,unit_basis,quantity,finishing_type,calc_date,rule_total,final_total,override_rate,override_reason,authority_revision,snapshot,created_by)
    values(p_request,p_company,(v_data->>'customer_id')::uuid,nullif(v_data->>'quote_id','')::uuid,v_data->>'basis',(v_data->>'qty')::numeric,v_data->>'finishing',private.ist_today(),(v_data->'calc'->>'total')::numeric,(v_data->>'total')::numeric,
      nullif(v_data->>'override_rate','')::numeric,nullif(p_mutation->>'override_reason',''),nullif(v_data->>'authority','')::uuid,v_data->'calc'||jsonb_build_object('final_total',(v_data->>'total')::numeric,'override_rate',nullif(v_data->>'override_rate','')::numeric),p_actor);
    perform private.commercial_record(p_company,v_view,p_request,a,p_actor,coalesce(nullif(p_mutation->>'override_reason',''),'Price recorded'),v_facts);
    return jsonb_build_object('label','Price recorded','href','/tasks/commercial/pricing/'||p_request,'message','The breakdown and the rule versions that produced it are stored.');
  -- NOV-078 -----------------------------------------------------------------------------------
  elsif a='claim.submit' then
    select count(*)+1 into v_count from public.supplier_claims where company_id=p_company;
    v_num:='CLM-'||to_char(now() at time zone 'Asia/Kolkata','YYMM')||'-'||lpad(v_count::text,4,'0');
    insert into public.supplier_claims(id,company_id,claim_number,vendor_id,purchase_order_id,purchase_order_line_id,claim_type,claimed_quantity,claimed_amount,requested_remedy,response_due,follow_up_owner,created_by)
    values(p_request,p_company,v_num,(v_data->>'vendor_id')::uuid,(v_data->>'purchase_order_id')::uuid,(p_mutation->>'purchase_order_line_id')::uuid,p_mutation->>'claim_type',(p_mutation->>'quantity')::numeric,(p_mutation->>'amount')::numeric,
      p_mutation->>'remedy',(p_mutation->>'response_due')::date,(p_mutation->>'owner_id')::uuid,p_actor);
    perform private.commercial_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Claim '||v_num||' submitted','href','/tasks/commercial/claims/'||p_request,'message','It stays open until an agreed recovery is linked or you close it.');
  elsif a='claim.respond' then
    if p_mutation->>'response'='agreed' then
      update public.supplier_claims set status=case when status='partially_recovered' then 'partially_recovered' else 'agreed' end,agreed_quantity=(p_mutation->>'agreed_quantity')::numeric,agreed_amount=(p_mutation->>'agreed_amount')::numeric,
        last_response_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_id and company_id=p_company;
      perform private.claim_settle(p_company,v_id);
    else
      update public.supplier_claims set status=p_mutation->>'response',agreed_quantity=null,agreed_amount=null,last_response_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_id and company_id=p_company;
    end if;
  elsif a='claim.link' then
    select * into k from public.supplier_claims where id=v_id and company_id=p_company;
    if p_mutation->>'kind'='replacement' then
      insert into public.supplier_claim_recoveries(id,company_id,claim_id,kind,receipt_line_id,quantity,amount,recorded_by) values(p_request,p_company,v_id,'replacement',(p_mutation->>'receipt_line_id')::uuid,(p_mutation->>'quantity')::numeric,0,p_actor);
    else
      insert into public.supplier_claim_recoveries(id,company_id,claim_id,kind,credit_id,quantity,amount,recorded_by)
      select p_request,p_company,v_id,p_mutation->>'kind',ec.id,0,ec.amount,p_actor from public.expense_supplier_credits ec where ec.id=(p_mutation->>'credit_id')::uuid and ec.company_id=p_company;
    end if;
    perform private.claim_settle(p_company,v_id);
  elsif a='claim.unlink' then
    update public.supplier_claim_recoveries set reversed_at=clock_timestamp(),reversed_by=p_actor,reverse_note=n where id=(p_mutation->>'recovery_id')::uuid and company_id=p_company and claim_id=v_id and reversed_at is null;
    perform private.claim_settle(p_company,v_id);
  elsif a='claim.close' then
    update public.supplier_claims set status='closed',closed_at=clock_timestamp(),close_note=n,unresolved_quantity=(v_data->>'unres_q')::numeric,unresolved_amount=(v_data->>'unres_a')::numeric,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  -- NOV-035 -----------------------------------------------------------------------------------
  elsif a='profit.snapshot' then
    v_entity:=(p_mutation->>'order_id')::uuid;
    insert into public.job_profit_snapshots(id,company_id,order_id,finalized,model,recorded_by) values(p_request,p_company,v_entity,(p_mutation->>'finalize')::boolean,v_data->'model',p_actor);
    perform private.commercial_record(p_company,v_view,v_entity,a,p_actor,n,v_facts);
    return jsonb_build_object('label',case when (p_mutation->>'finalize')::boolean then 'Comparison finalised' else 'Provisional snapshot recorded' end,'href','/tasks/commercial/profitability/'||v_entity,'message','The figures and their gaps are stored as of now.');
  -- NOV-039 -----------------------------------------------------------------------------------
  elsif a='commitment.set' then
    select * into po from public.purchase_orders where id=(p_mutation->>'purchase_order_id')::uuid and company_id=p_company;
    v_entity:=po.vendor_id;
    select * into c from public.supplier_commitments where company_id=p_company and purchase_order_id=po.id for update;
    if c.id is null then
      insert into public.supplier_commitments(company_id,purchase_order_id,original_date,current_date_promised,recorded_by) values(p_company,po.id,(p_mutation->>'promised_date')::date,(p_mutation->>'promised_date')::date,p_actor);
    else
      update public.supplier_commitments set current_date_promised=(p_mutation->>'promised_date')::date,revision_count=revision_count+1,
        history=history||jsonb_build_array(jsonb_build_object('from',c.current_date_promised,'to',p_mutation->>'promised_date','at',clock_timestamp(),'by',p_actor,'reason',n)),updated_at=clock_timestamp() where id=c.id;
    end if;
    perform private.commercial_record(p_company,v_view,v_entity,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Promise recorded','href','/tasks/commercial/reliability/'||v_entity,'message','The original promise is kept for every later comparison.');
  -- NOV-066 -----------------------------------------------------------------------------------
  elsif a='outcome.record' then
    v_entity:=(p_mutation->>'quote_id')::uuid;
    insert into public.quote_outcomes(company_id,quote_id,outcome,reason_code,evidence,product_family,quote_revision,recorded_by)
    select p_company,q.id,p_mutation->>'outcome',p_mutation->>'reason_code',p_mutation->>'evidence',nullif(btrim(coalesce(p_mutation->>'product_family','')),''),q.revision_number,p_actor from public.quotes q where q.id=v_entity and q.company_id=p_company;
    perform private.commercial_record(p_company,v_view,v_entity,a,p_actor,'Outcome recorded',v_facts);
    return jsonb_build_object('label','Outcome recorded','href','/tasks/commercial/outcomes/'||v_entity,'message','The opportunity is closed once, against the current quotation revision.');
  elsif a='outcome.reopen' then
    v_entity:=(p_mutation->>'quote_id')::uuid;
    update public.quote_outcomes set status='reopened',reopened_by=p_actor,reopened_at=clock_timestamp() where company_id=p_company and quote_id=v_entity and status='active';
  -- NOV-029 -----------------------------------------------------------------------------------
  elsif a='remnant.record' then
    select count(*)+1 into v_count from public.remnant_lots where company_id=p_company;
    v_num:='RM-'||to_char(now() at time zone 'Asia/Kolkata','YYMM')||'-'||lpad(v_count::text,4,'0');
    insert into public.remnant_lots(id,company_id,lot_number,profile_id,alloy,temper,finish,length_mm,pieces,original_pieces,weight_per_piece_kg,origin_type,source_job_id,location,condition,status,measured_by)
    values(p_request,p_company,v_num,(p_mutation->>'profile_id')::uuid,v_data->>'alloy',v_data->>'temper',btrim(p_mutation->>'finish'),(v_data->>'len')::integer,(v_data->>'pieces')::integer,(v_data->>'pieces')::integer,(v_data->>'wpp')::numeric,
      p_mutation->>'origin_type',nullif(p_mutation->>'source_job_id','')::uuid,btrim(p_mutation->>'location'),coalesce(p_mutation->>'condition','good'),v_data->>'status',p_actor);
    perform private.commercial_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Remnant '||v_num||' recorded','href','/tasks/commercial/remnants/'||p_request,'message','The lot is in the register with its measured length.');
  elsif a='remnant.review' then
    update public.remnant_lots set status=case p_mutation->>'decision' when 'usable' then 'available' else 'held' end,condition=case when p_mutation->>'decision'='damaged' then 'damaged' else condition end,updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='remnant.reserve' then
    insert into public.remnant_allocations(id,company_id,lot_id,order_item_id,pieces,cut_length_mm,waste_mm_per_piece,created_by)
    values(p_request,p_company,v_id,(v_data->>'item')::uuid,(v_data->>'pieces')::integer,(v_data->>'cut')::integer,(v_data->>'waste')::integer,p_actor);
  elsif a in ('remnant.consume','remnant.release') then
    select * into al from public.remnant_allocations where id=v_id and company_id=p_company; v_entity:=al.lot_id;
    update public.remnant_allocations set status=case when a='remnant.consume' then 'consumed' else 'released' end,resolved_by=p_actor,resolved_at=clock_timestamp() where id=al.id;
    if a='remnant.consume' then
      update public.remnant_lots set pieces=pieces-al.pieces,status=case when pieces-al.pieces<=0 then 'exhausted' else status end,updated_at=clock_timestamp() where id=al.lot_id and company_id=p_company;
    end if;
  elsif a='remnant.scrap' then update public.remnant_lots set status='scrapped',updated_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='remnant.correct' then
    select * into l from public.remnant_lots where id=v_id and company_id=p_company;
    update public.remnant_lots set length_mm=(v_data->>'len')::integer,pieces=(v_data->>'pieces')::integer,weight_per_piece_kg=(v_data->>'wpp')::numeric,correction_count=correction_count+1,
      history=history||jsonb_build_array(jsonb_build_object('at',clock_timestamp(),'by',p_actor,'from_length_mm',l.length_mm,'from_pieces',l.pieces,'to_length_mm',(v_data->>'len')::integer,'to_pieces',(v_data->>'pieces')::integer,'reason',n)),updated_at=clock_timestamp() where id=l.id;
  -- NOV-020 -----------------------------------------------------------------------------------
  elsif a='mapping.define' then
    select coalesce(max(version),0)+1 into v_ver from public.transfer_mappings where company_id=p_company and family='invoice_export';
    insert into public.transfer_mappings(id,company_id,version,sales_ledger,tax_ledger,party_key,created_by) values(p_request,p_company,v_ver,btrim(p_mutation->>'sales_ledger'),btrim(p_mutation->>'tax_ledger'),p_mutation->>'party_key',p_actor);
    perform private.commercial_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Mapping drafted','href','/tasks/commercial/transfers/'||p_request,'message','A second person approves it before a batch can use it.');
  elsif a='mapping.approve' then
    update public.transfer_mappings set status='retired',retired_at=clock_timestamp() where company_id=p_company and family='invoice_export' and status='approved';
    update public.transfer_mappings set status='approved',approved_by=p_actor,approved_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='mapping.retire' then update public.transfer_mappings set status='retired',retired_at=clock_timestamp() where id=v_id and company_id=p_company;
  elsif a='transfer.prepare' then
    select count(*)+1 into v_count from public.transfer_batches where company_id=p_company;
    v_num:='EXP-'||to_char(now() at time zone 'Asia/Kolkata','YYMM')||'-'||lpad(v_count::text,4,'0');
    insert into public.transfer_batches(id,company_id,batch_number,mapping_id,mapping_version,item_count,total_amount,checksum,prepared_by)
    select p_request,p_company,v_num,(v_data->>'mapping_id')::uuid,(v_data->>'mapping_version')::integer,count(*),sum(i.grand_total),md5(string_agg(private.transfer_ref(i.id)||':'||i.grand_total,',' order by i.invoice_date,i.invoice_number,i.id)),p_actor
      from public.invoices i where i.company_id=p_company and i.id in (select value::uuid from jsonb_array_elements_text(v_data->'ids'));
    insert into public.transfer_items(company_id,batch_id,invoice_id,external_ref,amount,tax_amount,invoice_fingerprint)
    select p_company,p_request,i.id,private.transfer_ref(i.id),i.subtotal,i.tax_total,private.transfer_fp(i) from public.invoices i where i.company_id=p_company and i.id in (select value::uuid from jsonb_array_elements_text(v_data->'ids'));
    perform private.commercial_record(p_company,v_view,p_request,a,p_actor,'Batch '||v_num||' prepared',v_facts);
    return jsonb_build_object('label','Batch '||v_num||' prepared','href','/tasks/commercial/transfers/'||p_request,'message','Download the file from the batch page, then record the package result for each invoice.');
  elsif a='transfer.export' then update public.transfer_batches set status='exported',exported_at=clock_timestamp(),exported_by=p_actor where id=v_id and company_id=p_company;
  elsif a='transfer.cancel' then
    update public.transfer_items set state='cancelled',recorded_by=p_actor,recorded_at=clock_timestamp() where company_id=p_company and batch_id=v_id and state='pending';
    update public.transfer_batches set status='cancelled' where id=v_id and company_id=p_company;
  elsif a='transfer.result' then
    v_entity:=(v_data->>'batch')::uuid;
    update public.transfer_items set state=p_mutation->>'result',external_reference=nullif(btrim(coalesce(p_mutation->>'external_reference','')),''),reason=case when p_mutation->>'result'='rejected' then n end,recorded_by=p_actor,recorded_at=clock_timestamp() where id=v_id and company_id=p_company;
    select count(*) into v_pending from public.transfer_items where company_id=p_company and batch_id=v_entity and state='pending';
    if v_pending=0 then update public.transfer_batches set status='closed',closed_at=clock_timestamp() where id=v_entity and company_id=p_company; end if;
  -- NOV-023 -----------------------------------------------------------------------------------
  elsif a='run.save' then
    insert into public.run_proposals(id,company_id,group_key,label,members,saving_changeovers,created_by)
    values(p_request,p_company,p_mutation->>'group_key',(v_data->'group'->>'die_number')||' · '||(v_data->'group'->>'profile_code')||' · '||(v_data->'group'->>'member_count')||' jobs',v_data->'group'->'members',(v_data->'group'->>'changeovers_saved')::integer,p_actor);
    perform private.commercial_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Run proposal saved','href','/tasks/commercial/runs/'||p_request,'message','It is advisory. Nothing was scheduled.');
  elsif a in ('run.accept','run.dismiss') then
    update public.run_proposals set status=case when a='run.accept' then 'accepted' else 'dismissed' end,decided_by=p_actor,decided_at=clock_timestamp(),decision_note=n where id=v_id and company_id=p_company and status='proposed';
  -- NOV-024 -----------------------------------------------------------------------------------
  elsif a='scenario.create' then
    insert into public.planning_scenarios(id,company_id,name,horizon_start,horizon_days,source_fingerprint,baseline,changes,result,created_by)
    values(p_request,p_company,btrim(p_mutation->>'name'),(v_data->>'start')::date,(v_data->>'days')::integer,md5((v_data->'snapshot')::text),v_data->'snapshot',p_mutation->'changes',v_data->'result',p_actor);
    perform private.commercial_record(p_company,v_view,p_request,a,p_actor,n,v_facts);
    return jsonb_build_object('label','Scenario created','href','/tasks/commercial/scenarios/'||p_request,'message','It is hypothetical and isolated from the live plan.');
  elsif a='scenario.share' then update public.planning_scenarios set status='shared' where id=v_id and company_id=p_company and status='draft';
  elsif a='scenario.discard' then update public.planning_scenarios set status='discarded',decided_by=p_actor,decided_at=clock_timestamp(),decision_note=n where id=v_id and company_id=p_company and status in ('draft','shared');
  elsif a='scenario.accept' then update public.planning_scenarios set status='accepted',decided_by=p_actor,decided_at=clock_timestamp(),decision_note=n where id=v_id and company_id=p_company and status='shared';
  else raise exception 'NOV: Unknown action.';
  end if;
  perform private.commercial_record(p_company,v_view,v_entity,a,p_actor,n,v_facts);
  return jsonb_build_object('label',p_context->'review'->>'title','href','/tasks/commercial/'||v_view||'/'||v_entity,'message','Recorded.');
end $$;
revoke all on function private.commercial_apply(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

create function public.commercial_command(p_command text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid();v_company uuid:=private.get_current_user_company_id();v_role text:=private.get_current_user_role();
  v_view text;v_page integer;v_search text;v_state text;v_sort text;v_status text;v_id uuid;v_total bigint;v_rows jsonb;v_row jsonb;v_events jsonb;
  r public.commercial_requests%rowtype;v_context jsonb;v_fingerprint text;v_result jsonb;v_message text;v_keys text[];
begin
  if v_actor is null or v_company is null or not exists(select 1 from public.app_users where id=v_actor and company_id=v_company and is_active and dealer_id is null)
    or not private.commercial_read_allowed(v_role,null) then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.app_users where id=v_actor and company_id=v_company for share;
  v_keys:=case p_command when 'list' then array['view','page','search','state','sort','status'] when 'detail' then array['view','id','page']
    when 'lookup' then array['kind','search','selected_id','parent_id'] when 'preview' then array['request_id','mutation'] when 'commit' then array['request_id','fingerprint']
    when 'outcome' then array['request_id'] when 'abandon' then array['request_id'] end;
  if jsonb_typeof(p_payload) is distinct from 'object' or v_keys is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(v_keys))) then raise exception 'NOV: Invalid commercial request.'; end if;
  if p_command in ('list','detail') then
    v_view:=p_payload->>'view';v_page:=coalesce((p_payload->>'page')::integer,1);v_search:=btrim(coalesce(p_payload->>'search',''));
    v_state:=coalesce(p_payload->>'state','active');v_sort:=coalesce(p_payload->>'sort','priority');v_status:=nullif(btrim(coalesce(p_payload->>'status','')),'');
    if v_view is null or v_view not in ('pricing','claims','profitability','reliability','outcomes','cohorts','remnants','transfers','runs','scenarios') or not private.commercial_read_allowed(v_role,v_view) then raise exception 'Not permitted' using errcode='42501'; end if;
    if v_page not between 1 and 100000 or length(v_search)>80 or v_state not in ('active','all') or v_sort not in ('priority','newest','due') or coalesce(v_status,'x') !~ '^[a-z_]{1,40}$' then raise exception 'NOV: Invalid commercial filters.'; end if;
    if p_command='detail' then
      v_id:=private.commercial_uuid(p_payload,'id');
      select row_data into v_row from private.commercial_rows(v_company,v_actor,v_role,v_view,'all',v_id) limit 1;
      if v_row is null then raise exception 'NOV: This record is unavailable.'; end if;
      select count(*) into v_total from public.commercial_events where company_id=v_company and view_name=v_view and entity_id=v_id;
      select coalesce(jsonb_agg(to_jsonb(x) order by recorded_at desc,id),'[]'::jsonb) into v_events from (
        select id,action,actor_name as actor,note,recorded_at from public.commercial_events where company_id=v_company and view_name=v_view and entity_id=v_id order by recorded_at desc,id limit 10 offset (v_page-1)*10
      ) x;
      return jsonb_build_object('row',v_row,'events',v_events,'event_count',v_total,'as_of',now());
    end if;
    with visible as (select * from private.commercial_rows(v_company,v_actor,v_role,v_view,v_state,null) where (v_status is null or row_data->>'status'=v_status)
      and (v_search='' or position(lower(v_search) in lower(coalesce(row_data->>'label','')||' '||coalesce(row_data->>'status','')||' '||coalesce(row_data->>'owner','')||' '||coalesce(row_data->>'summary','')))>0))
    select (select count(*) from visible),coalesce((select jsonb_agg(x.row_data order by x.position) from (
      select row_data,row_number() over(order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id')) as position
      from visible order by case when v_sort='priority' then sort_rank end,case when v_sort<>'newest' then sort_due end nulls last,case when v_sort='newest' then sort_new end desc nulls last,(row_data->>'id') limit 10 offset (v_page-1)*10
    ) x),'[]'::jsonb) into v_total,v_rows;
    return jsonb_build_object('rows',v_rows,'total_count',v_total,'as_of',now());
  elsif p_command='lookup' then
    if length(coalesce(p_payload->>'search',''))>80 then raise exception 'NOV: Keep search within 80 characters.'; end if;
    return private.commercial_lookup(v_company,v_actor,v_role,p_payload);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':commercial',0));
  v_id:=private.commercial_uuid(p_payload,'request_id');
  select * into r from public.commercial_requests where request_id=v_id for update;
  if found and (r.company_id<>v_company or r.actor_id<>v_actor) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_command='preview' then
    if r.request_id is not null then
      if r.mutation is distinct from p_payload->'mutation' then raise exception 'NOV: This request identity belongs to different details.'; end if;
      if not private.commercial_action_allowed(v_role,r.mutation->>'action') then raise exception 'Not permitted' using errcode='42501'; end if;
      return private.commercial_outcome(r);
    end if;
    v_context:=private.commercial_context(v_company,v_actor,p_payload->'mutation',false);
    v_fingerprint:=md5((v_context->'source')::text||(p_payload->'mutation')::text);
    insert into public.commercial_requests(request_id,company_id,actor_id,mutation,fingerprint,review)
      values(v_id,v_company,v_actor,p_payload->'mutation',v_fingerprint,v_context->'review') returning * into r;
  else
    if r.request_id is null then
      if p_command in ('outcome','abandon') then return jsonb_build_object('request_id',v_id,'state','not_recorded','fingerprint',repeat('0',32),'expires_at',now(),'action','',
        'review',jsonb_build_object('title','Original request check','effect','No prepared or committed action exists for this original request.','warnings','[]'::jsonb,'facts','{}'::jsonb),
        'result',jsonb_build_object('label','Not recorded','href',null,'message','No change was committed with this original request identity. It is safe to start a reviewed action.')); end if;
      raise exception 'NOV: The original request was not found. No action was committed with that request identity.';
    end if;
    if (p_command='commit' and not private.commercial_action_allowed(v_role,r.mutation->>'action'))
      or (p_command in ('outcome','abandon') and not private.commercial_read_allowed(v_role,private.commercial_view(r.mutation->>'action'))) then raise exception 'Not permitted' using errcode='42501'; end if;
    if p_command='commit' and r.state='prepared' then
      if r.fingerprint is distinct from p_payload->>'fingerprint' then raise exception 'NOV: Confirmation does not match the reviewed request.'; end if;
      begin
        if r.expires_at<=now() then raise exception 'NOV: This review expired. Review the current source again.'; end if;
        v_context:=private.commercial_context(v_company,v_actor,r.mutation,true);
        if r.fingerprint<>md5((v_context->'source')::text||r.mutation::text) then raise exception 'NOV: A relevant source changed. Review the current details again.'; end if;
        v_result:=private.commercial_apply(v_company,v_actor,v_id,r.mutation,v_context);
        update public.commercial_requests set state='confirmed',result=v_result where request_id=v_id returning * into r;
      exception when others then
        v_message:=case when sqlstate='P0001' and sqlerrm like 'NOV: %' then substring(sqlerrm from 6)
          when sqlstate in ('23514','23P01','55P03') and sqlerrm not like '%violates%' and sqlerrm not like '%constraint%' then sqlerrm
          else 'The existing workflow rejected this action. No change from this request was committed. Refresh the source and review its current requirements.' end;
        update public.commercial_requests set state='rejected',result=jsonb_build_object('label',r.review->>'title','href',null,'message',v_message) where request_id=v_id returning * into r;
      end;
    elsif p_command='abandon' and r.state='prepared' then
      update public.commercial_requests set state='abandoned',result=jsonb_build_object('label',r.review->>'title','href',null,'message','Review cancelled. This request made no change.') where request_id=v_id returning * into r;
    elsif p_command not in ('commit','outcome','abandon') then raise exception 'NOV: Invalid commercial request.';
    end if;
  end if;
  return private.commercial_outcome(r);
end $$;
revoke all on function public.commercial_command(text,jsonb) from public,anon;
grant execute on function public.commercial_command(text,jsonb) to authenticated;

