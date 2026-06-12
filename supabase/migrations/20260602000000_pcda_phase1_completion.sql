-- ============================================================
-- PCDA TECHNICAL ENRICHMENT: PHASE 1 COMPLETION
-- Safe additive completion for master catalogs and canonical line columns.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Complete missing PCDA master catalog tables
-- ------------------------------------------------------------
do $$
declare
  table_name text;
  policy_name text;
  index_name text;
begin
  foreach table_name in array array[
    'pcda_master_uoms',
    'pcda_master_packing_modes',
    'pcda_master_qty_methods',
    'pcda_master_profile_categories',
    'pcda_master_die_types',
    'pcda_master_surface_treatments',
    'pcda_master_cost_components',
    'pcda_master_document_types',
    'pcda_master_compliance_types',
    'pcda_master_machine_types'
  ]
  loop
    execute format($sql$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        company_id uuid not null references public.companies(id) on delete cascade,
        value text not null,
        description text,
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        created_by uuid references auth.users(id),
        unique (company_id, value)
      )
    $sql$, table_name);

    execute format('alter table public.%I enable row level security', table_name);

    policy_name := table_name || '_tenant';
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = policy_name
    ) then
      execute format(
        'create policy %I on public.%I for all using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id())',
        policy_name,
        table_name
      );
    end if;

    index_name := 'idx_' || table_name || '_company_active';
    execute format('create index if not exists %I on public.%I(company_id, is_active, value)', index_name, table_name);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2. Complete profile master columns required by PCDA quote sourcing
-- ------------------------------------------------------------
alter table public.aluminium_profiles add column if not exists section_code text;
alter table public.aluminium_profiles add column if not exists section_name text;
alter table public.aluminium_profiles add column if not exists drawing_document_id uuid;
alter table public.aluminium_profiles add column if not exists alloy_standard_id uuid references public.pcda_master_alloy_standards(id);
alter table public.aluminium_profiles add column if not exists alloy_id uuid references public.pcda_master_alloys(id);
alter table public.aluminium_profiles add column if not exists temper_id uuid references public.pcda_master_tempers(id);
alter table public.aluminium_profiles add column if not exists min_weight numeric(12,3);
alter table public.aluminium_profiles add column if not exists max_weight numeric(12,3);
alter table public.aluminium_profiles add column if not exists weight_tolerance numeric(12,3);
alter table public.aluminium_profiles add column if not exists standard_length numeric(14,3);
create index if not exists idx_profiles_pcda_master_refs on public.aluminium_profiles(company_id, alloy_standard_id, alloy_id, temper_id);

-- ------------------------------------------------------------
-- 3. Create missing host line tables for downstream reuse
-- ------------------------------------------------------------
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  profile_id uuid references public.aluminium_profiles(id),
  die_id uuid references public.dies(id),
  item_description text,
  quantity_pieces integer check (quantity_pieces is null or quantity_pieces > 0),
  length_per_piece_m numeric(12,3) check (length_per_piece_m is null or length_per_piece_m > 0),
  total_meters numeric(14,3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.order_items enable row level security;
drop policy if exists "order_items_tenant" on public.order_items;
create policy "order_items_tenant" on public.order_items
  for all using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());
create index if not exists idx_order_items_company_order on public.order_items(company_id, order_id);
create index if not exists idx_order_items_company_profile on public.order_items(company_id, profile_id);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  order_item_id uuid references public.order_items(id),
  profile_id uuid references public.aluminium_profiles(id),
  die_id uuid references public.dies(id),
  item_description text,
  quantity numeric(14,3),
  unit_rate numeric(14,2),
  line_total numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invoice_items enable row level security;
drop policy if exists "invoice_items_tenant" on public.invoice_items;
create policy "invoice_items_tenant" on public.invoice_items
  for all using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());
create index if not exists idx_invoice_items_company_invoice on public.invoice_items(company_id, invoice_id);
create index if not exists idx_invoice_items_company_profile on public.invoice_items(company_id, profile_id);

-- ------------------------------------------------------------
-- 4. Add canonical PCDA columns to host line tables
-- ------------------------------------------------------------
do $$
declare
  host_table text;
begin
  foreach host_table in array array[
    'quote_items',
    'order_items',
    'production_jobs',
    'packing_list_items',
    'invoice_items'
  ]
  loop
    execute format('alter table public.%I add column if not exists source_record_id uuid', host_table);
    execute format('alter table public.%I add column if not exists source_line_id uuid', host_table);

    execute format('alter table public.%I add column if not exists section_number text', host_table);
    execute format('alter table public.%I add column if not exists section_code text', host_table);
    execute format('alter table public.%I add column if not exists section_name text', host_table);
    execute format('alter table public.%I add column if not exists customer_component_code text', host_table);
    execute format('alter table public.%I add column if not exists component_description text', host_table);
    execute format('alter table public.%I add column if not exists drawing_document_id uuid', host_table);
    execute format('alter table public.%I add column if not exists drawing_revision text', host_table);
    execute format('alter table public.%I add column if not exists drawing_approval_status text', host_table);
    execute format('alter table public.%I add column if not exists alloy_standard_id uuid references public.pcda_master_alloy_standards(id)', host_table);
    execute format('alter table public.%I add column if not exists alloy_id uuid references public.pcda_master_alloys(id)', host_table);
    execute format('alter table public.%I add column if not exists temper_id uuid references public.pcda_master_tempers(id)', host_table);

    execute format('alter table public.%I add column if not exists cl_uom text', host_table);
    execute format('alter table public.%I add column if not exists cl_per_uom numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists cl_meter numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists order_uom text', host_table);
    execute format('alter table public.%I add column if not exists order_quantity numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists quantity_kg numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists min_weight numeric(12,3)', host_table);
    execute format('alter table public.%I add column if not exists max_weight numeric(12,3)', host_table);
    execute format('alter table public.%I add column if not exists weight_tolerance numeric(12,3)', host_table);
    execute format('alter table public.%I add column if not exists quantity_calculation_method text', host_table);
    execute format('alter table public.%I add column if not exists packing_mode_id uuid references public.pcda_master_packing_modes(id)', host_table);
    execute format('alter table public.%I add column if not exists invoice_calc_uom text', host_table);
    execute format('alter table public.%I add column if not exists standard_length numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists cut_length numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists bundle_quantity numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists pieces_per_bundle numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists meter_per_bundle numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists kg_per_bundle numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists packing_instruction text', host_table);
    execute format('alter table public.%I add column if not exists customer_packing_requirement text', host_table);

    execute format('alter table public.%I add column if not exists material_price numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists value_added_service_price numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists basic_price numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists freight_charge numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists alloy_surcharge_per_kg numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists re_cutting_charge_per_kg numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists testing_service_charge_per_kg numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists die_cost numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists die_service_charge numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists packing_in_conversion boolean not null default false', host_table);
    execute format('alter table public.%I add column if not exists include_packing_in_basic boolean not null default false', host_table);
    execute format('alter table public.%I add column if not exists gst_percent numeric(7,2)', host_table);
    execute format('alter table public.%I add column if not exists discount numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists margin numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists net_rate numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists final_line_value numeric(14,2)', host_table);

    execute format('alter table public.%I add column if not exists input_billet_weight numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists output_good_weight numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists rejected_weight numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists rework_weight numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists packing_weight numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists freight_weight numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists theoretical_weight numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists actual_weight numeric(14,3)', host_table);
    execute format('alter table public.%I add column if not exists internal_cost numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists supplier_rate numeric(14,2)', host_table);
    execute format('alter table public.%I add column if not exists internal_note text', host_table);
    execute format('alter table public.%I add column if not exists revision_number integer not null default 1', host_table);

    execute format('create index if not exists %I on public.%I(company_id, source_record_id, source_line_id)', 'idx_' || host_table || '_pcda_source', host_table);
    execute format('create index if not exists %I on public.%I(company_id, section_number)', 'idx_' || host_table || '_pcda_section', host_table);
  end loop;
end $$;

-- Existing quote_items uses transport_charge; add canonical freight_charge as nullable alias field.
-- Existing quote_items also has non-null section_weight_kg_per_m and other_charges columns, so ADD IF NOT EXISTS above preserves them.

commit;
