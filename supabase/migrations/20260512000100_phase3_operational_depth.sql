-- Phase 3: Operational Depth (Inventory, Production, Yield)

begin;

-- 1. Vendors
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_name text not null,
  vendor_type text not null,
  contact_person text,
  phone text,
  email text,
  gst_number text,
  address text,
  city text,
  state text,
  payment_terms text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.vendors add constraint vendors_type_check check (
  vendor_type in ('billet_supplier', 'die_maker', 'powder_coating', 'anodizing', 'hardware_supplier', 'transporter', 'packing_supplier', 'maintenance', 'other')
);

alter table public.vendors enable row level security;
create policy "vendors tenant read" on public.vendors for select using (company_id = public.get_current_user_company_id());
create policy "vendors tenant insert" on public.vendors for insert with check (company_id = public.get_current_user_company_id());
create policy "vendors tenant update" on public.vendors for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());

-- 2. Inventory Items
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_code text not null,
  item_name text not null,
  item_category text not null,
  unit text not null,
  current_stock numeric(14,3) not null default 0,
  reorder_level numeric(14,3) not null default 0,
  average_rate numeric(14,2) not null default 0,
  location text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_items add constraint inventory_item_category_check check (
  item_category in ('billets', 'extruded_profiles', 'hardware', 'powder_coating_material', 'packing_material', 'scrap', 'finished_goods')
);
alter table public.inventory_items enable row level security;
create policy "inventory_items tenant read" on public.inventory_items for select using (company_id = public.get_current_user_company_id());
create policy "inventory_items tenant insert" on public.inventory_items for insert with check (company_id = public.get_current_user_company_id());
create policy "inventory_items tenant update" on public.inventory_items for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());

-- 3. Inventory Movements
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  movement_type text not null,
  quantity numeric(14,3) not null,
  unit text not null,
  reference_type text,
  reference_id uuid,
  rate numeric(14,2),
  amount numeric(14,2),
  movement_date date not null default current_date,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.inventory_movements add constraint movement_type_check check (
  movement_type in ('purchase_in', 'production_in', 'production_issue', 'dispatch_out', 'scrap_in', 'scrap_out', 'adjustment_in', 'adjustment_out', 'return_in')
);
alter table public.inventory_movements enable row level security;
create policy "inventory_movements tenant read" on public.inventory_movements for select using (company_id = public.get_current_user_company_id());
create policy "inventory_movements tenant insert" on public.inventory_movements for insert with check (company_id = public.get_current_user_company_id());

-- 4. Billet Batches
create table if not exists public.billet_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_number text not null,
  supplier_id uuid references public.vendors(id),
  alloy text not null,
  temper text not null,
  diameter_mm numeric(10,2),
  length_mm numeric(10,2),
  total_weight_kg numeric(14,3) not null,
  available_weight_kg numeric(14,3) not null,
  rate_per_kg numeric(14,2),
  heat_number text,
  coa_document_url text,
  received_date date not null,
  status text not null default 'available',
  notes text,
  created_at timestamptz not null default now()
);

alter table public.billet_batches enable row level security;
create policy "billet_batches tenant read" on public.billet_batches for select using (company_id = public.get_current_user_company_id());
create policy "billet_batches tenant insert" on public.billet_batches for insert with check (company_id = public.get_current_user_company_id());
create policy "billet_batches tenant update" on public.billet_batches for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());

-- 5. Profile Stock Batches
create table if not exists public.profile_stock_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.aluminium_profiles(id) on delete cascade,
  finish text not null,
  length_m numeric(10,3) not null,
  quantity_pieces integer not null,
  total_weight_kg numeric(14,3) not null,
  bundle_number text,
  location text,
  reserved_for_order_id uuid references public.orders(id),
  status text not null default 'available',
  created_at timestamptz not null default now()
);

alter table public.profile_stock_batches add constraint profile_stock_status_check check (
  status in ('available', 'reserved', 'dispatched', 'rejected', 'scrap')
);
alter table public.profile_stock_batches enable row level security;
create policy "profile_stock_batches tenant read" on public.profile_stock_batches for select using (company_id = public.get_current_user_company_id());
create policy "profile_stock_batches tenant insert" on public.profile_stock_batches for insert with check (company_id = public.get_current_user_company_id());
create policy "profile_stock_batches tenant update" on public.profile_stock_batches for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());

-- 6. Machines
create table if not exists public.machines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machine_name text not null,
  machine_type text not null,
  press_capacity_ton numeric(10,2),
  status text not null default 'active',
  location text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.machines add constraint machine_type_check check (
  machine_type in ('extrusion_press', 'aging_oven', 'powder_coating_line', 'anodizing_line', 'cutting_machine', 'packing_station', 'other')
);
alter table public.machines enable row level security;
create policy "machines tenant read" on public.machines for select using (company_id = public.get_current_user_company_id());
create policy "machines tenant insert" on public.machines for insert with check (company_id = public.get_current_user_company_id());
create policy "machines tenant update" on public.machines for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());

-- 7. Production Jobs
create table if not exists public.production_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  machine_id uuid references public.machines(id),
  die_id uuid references public.dies(id),
  profile_id uuid not null references public.aluminium_profiles(id),
  planned_date date,
  shift text,
  planned_quantity_kg numeric(14,3) not null default 0,
  actual_quantity_kg numeric(14,3) not null default 0,
  planned_meters numeric(14,2) not null default 0,
  actual_meters numeric(14,2) not null default 0,
  status text not null default 'planned',
  operator_name text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.production_jobs add constraint production_jobs_status_check check (
  status in ('planned', 'ready', 'in_progress', 'completed', 'on_hold', 'cancelled')
);
alter table public.production_jobs enable row level security;
create policy "production_jobs tenant read" on public.production_jobs for select using (company_id = public.get_current_user_company_id());
create policy "production_jobs tenant insert" on public.production_jobs for insert with check (company_id = public.get_current_user_company_id());
create policy "production_jobs tenant update" on public.production_jobs for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());

-- 8. Scrap Records
create table if not exists public.scrap_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid references public.orders(id),
  production_job_id uuid references public.production_jobs(id),
  profile_id uuid references public.aluminium_profiles(id),
  die_id uuid references public.dies(id),
  scrap_type text not null,
  weight_kg numeric(14,3) not null,
  reason text,
  recorded_date date not null default current_date,
  recorded_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.scrap_records add constraint scrap_type_check check (
  scrap_type in ('butt_scrap', 'process_scrap', 'rejection', 'cutting_waste', 'coating_rejection', 'anodizing_rejection', 'packing_damage', 'customer_return', 'remelt_scrap', 'other')
);
alter table public.scrap_records enable row level security;
create policy "scrap_records tenant read" on public.scrap_records for select using (company_id = public.get_current_user_company_id());
create policy "scrap_records tenant insert" on public.scrap_records for insert with check (company_id = public.get_current_user_company_id());

-- 9. Finishing Jobs
create table if not exists public.finishing_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  production_job_id uuid references public.production_jobs(id),
  finishing_type text not null,
  color_code text,
  shade_name text,
  vendor_id uuid references public.vendors(id),
  planned_date date,
  sent_date date,
  received_date date,
  input_weight_kg numeric(14,3) not null default 0,
  output_weight_kg numeric(14,3) not null default 0,
  rejection_weight_kg numeric(14,3) not null default 0,
  status text not null default 'planned',
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.finishing_jobs add constraint finishing_jobs_status_check check (
  status in ('not_required', 'planned', 'sent_to_vendor', 'in_process', 'received', 'rejected', 'completed')
);
alter table public.finishing_jobs enable row level security;
create policy "finishing_jobs tenant read" on public.finishing_jobs for select using (company_id = public.get_current_user_company_id());
create policy "finishing_jobs tenant insert" on public.finishing_jobs for insert with check (company_id = public.get_current_user_company_id());
create policy "finishing_jobs tenant update" on public.finishing_jobs for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());

-- Indexes
create index if not exists vendors_company_idx on public.vendors(company_id, vendor_type);
create index if not exists inventory_items_company_idx on public.inventory_items(company_id, item_category);
create index if not exists inventory_movements_item_idx on public.inventory_movements(company_id, inventory_item_id);
create index if not exists billet_batches_company_idx on public.billet_batches(company_id, status);
create index if not exists profile_stock_company_idx on public.profile_stock_batches(company_id, profile_id);
create index if not exists machines_company_idx on public.machines(company_id, machine_type);
create index if not exists production_jobs_company_idx on public.production_jobs(company_id, order_id);
create index if not exists production_jobs_machine_idx on public.production_jobs(company_id, machine_id);
create index if not exists scrap_records_company_idx on public.scrap_records(company_id, order_id);
create index if not exists scrap_records_die_idx on public.scrap_records(company_id, die_id);
create index if not exists finishing_jobs_company_idx on public.finishing_jobs(company_id, order_id);

commit;
