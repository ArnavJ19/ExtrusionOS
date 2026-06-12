create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  logo_url text,
  gst_number text,
  phone text,
  email text,
  website text,
  billing_address text,
  city text,
  state text,
  pincode text,
    country text default 'India',
    created_by uuid references auth.users(id) default auth.uid(),
    created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  role text not null default 'owner' check (role in ('owner','admin','sales_manager','sales','production_manager','production','dispatch_manager','dispatch','accounts','quality','viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_name text not null,
  company_name text,
  customer_type text not null default 'other' check (customer_type in ('fabricator','dealer','architect','industrial','solar','government','export','contractor','other')),
  phone text,
  whatsapp_number text,
  email text,
  gst_number text,
  billing_address text,
  shipping_address text,
  city text,
  state text,
  pincode text,
  contact_person text,
  payment_terms text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.aluminium_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_code text not null,
  profile_name text not null,
  application_category text not null default 'other' check (application_category in ('sliding_window','casement_window','door','curtain_wall','partition','railing','solar','heat_sink','industrial','electrical','automotive','aerospace','furniture','custom','other')),
  section_weight_kg_per_m numeric(12,3) not null check (section_weight_kg_per_m > 0),
  alloy text,
  temper text,
  finish_options text[] default '{}',
  standard_length_m numeric(12,2),
  drawing_url text,
  image_url text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint aluminium_profiles_company_code_unique unique (company_id, profile_code)
);

create table if not exists public.dies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  die_number text not null,
  profile_id uuid not null references public.aluminium_profiles(id),
  customer_id uuid references public.customers(id),
  ownership_type text not null default 'company_owned' check (ownership_type in ('company_owned', 'customer_owned')),
  die_status text not null default 'active' check (die_status in ('active','trial','correction','nitriding','inactive','dead')),
  rack_location text,
  total_production_kg numeric(14,3) not null default 0,
  total_runs integer not null default 0,
  last_used_date date,
  die_manufacturer text,
  die_cost numeric(14,2),
  purchase_date date,
  correction_history text,
  drawing_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint dies_company_number_unique unique (company_id, die_number)
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_number text not null,
  customer_id uuid not null references public.customers(id),
  quote_date date not null,
  valid_until date,
  status text not null default 'draft' check (status in ('draft','internal_review','approved_for_sending','sent','customer_approved','customer_rejected','expired','converted_to_order')),
  subtotal numeric(14,2) not null default 0,
  total_margin_amount numeric(14,2) not null default 0,
  total_before_gst numeric(14,2) not null default 0,
  gst_percent numeric(7,2) not null default 18,
  gst_amount numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  terms_and_conditions text,
  delivery_timeline text,
  payment_terms text,
  notes text,
  pdf_url text,
  revision_number integer not null default 1,
  low_margin_approval_required boolean not null default false,
  estimated_profit_amount numeric(14,2) not null default 0,
  estimated_profit_percent numeric(7,2) not null default 0,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_notes text,
  sent_at timestamptz,
  customer_decision_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint quotes_company_number_unique unique (company_id, quote_number)
);

create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  profile_id uuid not null references public.aluminium_profiles(id),
  die_id uuid references public.dies(id),
  item_description text,
  quantity_pieces integer not null check (quantity_pieces > 0),
  length_per_piece_m numeric(12,3) not null check (length_per_piece_m > 0),
  total_meters numeric(14,3) not null default 0,
  section_weight_kg_per_m numeric(12,3) not null check (section_weight_kg_per_m > 0),
  total_weight_kg numeric(14,3) not null default 0,
  billet_rate_per_kg numeric(12,2) not null default 0,
  raw_material_cost numeric(14,2) not null default 0,
  conversion_charge_per_kg numeric(12,2) not null default 0,
  conversion_cost numeric(14,2) not null default 0,
  finishing_type text not null default 'mill_finish' check (finishing_type in ('mill_finish','powder_coating','anodizing','anodized_silver','anodized_bronze','anodized_black','wood_finish','wood_grain','pvdf','other')),
  finishing_charge_type text not null default 'per_kg' check (finishing_charge_type in ('per_kg','per_meter','fixed','per_sqft')),
  finishing_charge numeric(12,2) not null default 0,
  finishing_cost numeric(14,2) not null default 0,
  die_charge numeric(14,2) not null default 0,
  scrap_allowance_percent numeric(7,2) not null default 0,
  expected_recovery_percent numeric(7,2) not null default 100,
  effective_weight_kg numeric(14,3) not null default 0,
  minimum_billing_weight_kg numeric(14,3) not null default 0,
  billing_weight_kg numeric(14,3) not null default 0,
  die_amortization_type text not null default 'full_die_charge' check (die_amortization_type in ('full_die_charge','per_kg','waived','customer_paid')),
  die_amortization_quantity_kg numeric(14,3) not null default 0,
  die_amortization_amount numeric(14,2) not null default 0,
  packing_charge numeric(14,2) not null default 0,
  transport_charge numeric(14,2) not null default 0,
  other_charges numeric(14,2) not null default 0,
  margin_percent numeric(7,2) not null default 0,
  margin_amount numeric(14,2) not null default 0,
  sales_price_override numeric(14,2),
  minimum_margin_percent numeric(7,2) not null default 0,
  approval_required boolean not null default false,
  estimated_profit_amount numeric(14,2) not null default 0,
  estimated_profit_percent numeric(7,2) not null default 0,
  line_subtotal numeric(14,2) not null default 0,
  line_total_before_gst numeric(14,2) not null default 0,
  price_per_kg numeric(12,2) not null default 0,
  price_per_meter numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quote_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_number integer not null,
  snapshot_json jsonb not null,
  revised_by uuid references auth.users(id),
  revised_at timestamptz not null default now(),
  reason text,
  pdf_url text,
  constraint quote_revisions_quote_revision_unique unique (quote_id, revision_number)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_number text not null,
  quote_id uuid references public.quotes(id),
  customer_id uuid not null references public.customers(id),
  order_date date not null,
  expected_dispatch_date date,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  current_stage text not null default 'order_confirmed' check (current_stage in ('order_confirmed','die_ready','billet_ready','billet_heating','extrusion_planned','extruded','stretching','cutting','aging','surface_treatment','finishing','packing','dispatched','delivered','payment_pending','closed','cancelled')),
  order_value numeric(14,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint orders_company_number_unique unique (company_id, order_number)
);

create table if not exists public.order_stage_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  stage text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  remarks text
);

create table if not exists public.dispatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id),
  dispatch_number text,
  dispatch_date date not null,
  number_of_bundles integer not null default 0,
  total_weight_kg numeric(14,3) not null default 0,
  transporter_name text,
  vehicle_number text,
  driver_name text,
  driver_phone text,
  eway_bill_number text,
  lr_number text,
  delivery_status text not null default 'pending' check (delivery_status in ('pending','dispatched','in_transit','delivered','delayed','damaged','returned')),
  proof_of_delivery_url text,
  packing_list_url text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint dispatches_company_number_unique unique (company_id, dispatch_number)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  related_entity_type text not null check (related_entity_type in ('customer','profile','die','quote','order','dispatch','company')),
  related_entity_id uuid not null,
  document_type text not null check (document_type in ('drawing','quotation_pdf','purchase_order','dispatch_proof','packing_list','test_certificate','gst_document','other')),
  file_name text not null,
  file_url text not null,
  mime_type text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  default_gst_percent numeric(7,2) not null default 18,
  default_margin_percent numeric(7,2) not null default 10,
  default_conversion_charge_per_kg numeric(12,2) not null default 0,
  default_packing_charge numeric(12,2) not null default 0,
  default_transport_charge numeric(12,2) not null default 0,
  default_quote_validity_days integer not null default 15,
  default_quote_terms text,
  bank_details text,
  signature_url text,
  quote_prefix text not null default 'Q',
  order_prefix text not null default 'O',
  dispatch_prefix text not null default 'D',
  invoice_prefix text not null default 'INV',
  minimum_margin_percent numeric(7,2) not null default 8,
  require_approval_below_margin boolean not null default true,
  default_payment_terms text,
  default_delivery_terms text,
  default_bank_details text,
  default_terms_and_conditions text,
  enable_customer_portal boolean not null default false,
  enable_inventory boolean not null default false,
  enable_quality boolean not null default false,
  enable_payments boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_company_search_idx on public.customers(company_id, customer_name, company_name);
create index if not exists customers_company_created_idx on public.customers(company_id, created_at desc);
create index if not exists profiles_company_search_idx on public.aluminium_profiles(company_id, profile_code, profile_name);
create index if not exists profiles_company_active_idx on public.aluminium_profiles(company_id, is_active, profile_code);
create index if not exists dies_company_search_idx on public.dies(company_id, die_number, die_status);
create index if not exists dies_company_profile_status_idx on public.dies(company_id, profile_id, die_status);
create index if not exists quotes_company_date_idx on public.quotes(company_id, quote_date desc);
create index if not exists quotes_company_number_idx on public.quotes(company_id, quote_number);
create index if not exists quotes_company_status_created_idx on public.quotes(company_id, status, created_at desc);
create index if not exists quotes_company_customer_idx on public.quotes(company_id, customer_id, quote_date desc);
create index if not exists quote_items_company_quote_idx on public.quote_items(company_id, quote_id);
create index if not exists quote_items_company_profile_idx on public.quote_items(company_id, profile_id);
create index if not exists quote_items_company_die_idx on public.quote_items(company_id, die_id);
create index if not exists orders_company_stage_idx on public.orders(company_id, current_stage, expected_dispatch_date);
create index if not exists orders_company_number_idx on public.orders(company_id, order_number);
create index if not exists orders_company_customer_idx on public.orders(company_id, customer_id, order_date desc);
create index if not exists dispatches_company_date_idx on public.dispatches(company_id, dispatch_date desc);
create index if not exists dispatches_company_number_idx on public.dispatches(company_id, dispatch_number);
create index if not exists dispatches_company_order_idx on public.dispatches(company_id, order_id);
create index if not exists documents_company_entity_idx on public.documents(company_id, related_entity_type, related_entity_id);
create index if not exists quote_revisions_company_quote_idx on public.quote_revisions(company_id, quote_id, revision_number desc);
create index if not exists quote_revisions_company_revised_idx on public.quote_revisions(company_id, revised_at desc);

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at before update on public.companies for each row execute function public.set_updated_at();
drop trigger if exists set_app_users_updated_at on public.app_users;
create trigger set_app_users_updated_at before update on public.app_users for each row execute function public.set_updated_at();
drop trigger if exists set_customers_updated_at on public.customers;
create trigger set_customers_updated_at before update on public.customers for each row execute function public.set_updated_at();
drop trigger if exists set_profiles_updated_at on public.aluminium_profiles;
create trigger set_profiles_updated_at before update on public.aluminium_profiles for each row execute function public.set_updated_at();
drop trigger if exists set_dies_updated_at on public.dies;
create trigger set_dies_updated_at before update on public.dies for each row execute function public.set_updated_at();
drop trigger if exists set_quotes_updated_at on public.quotes;
create trigger set_quotes_updated_at before update on public.quotes for each row execute function public.set_updated_at();
drop trigger if exists set_quote_items_updated_at on public.quote_items;
create trigger set_quote_items_updated_at before update on public.quote_items for each row execute function public.set_updated_at();
drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
drop trigger if exists set_dispatches_updated_at on public.dispatches;
create trigger set_dispatches_updated_at before update on public.dispatches for each row execute function public.set_updated_at();
drop trigger if exists set_company_settings_updated_at on public.company_settings;
create trigger set_company_settings_updated_at before update on public.company_settings for each row execute function public.set_updated_at();
