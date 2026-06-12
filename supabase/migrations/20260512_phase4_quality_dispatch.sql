-- Phase 4: Quality Control & Dispatch Logistics Depth

begin;

-- 1. Quality Inspections
create table if not exists public.quality_inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  production_job_id uuid references public.production_jobs(id) on delete set null,
  profile_id uuid not null references public.aluminium_profiles(id) on delete cascade,
  inspection_date timestamptz not null default now(),
  batch_number text,
  quantity_checked_kg numeric(10,2) not null default 0,
  
  -- Metrics
  dimensional_variance text,
  hardness_webster numeric(5,2),
  surface_finish_ok boolean default true,
  weight_per_meter_actual numeric(8,3),
  
  status text not null default 'pending',
  inspector_name text,
  notes text,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quality_inspections add constraint quality_status_check check (
  status in ('pending', 'approved', 'rejected', 'rework')
);

alter table public.quality_inspections enable row level security;
create policy "quality_inspections tenant read" on public.quality_inspections for select using (company_id = public.get_current_user_company_id());
create policy "quality_inspections tenant insert" on public.quality_inspections for insert with check (company_id = public.get_current_user_company_id());
create policy "quality_inspections tenant update" on public.quality_inspections for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());
create policy "quality_inspections tenant delete" on public.quality_inspections for delete using (company_id = public.get_current_user_company_id());

-- 2. Packing List Items (Granular Dispatch Tracking)
create table if not exists public.packing_list_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  profile_id uuid not null references public.aluminium_profiles(id) on delete cascade,
  
  bundle_number text not null,
  number_of_pieces integer not null default 0,
  gross_weight_kg numeric(10,2) not null default 0,
  tare_weight_kg numeric(10,2) not null default 0,
  net_weight_kg numeric(10,2) generated always as (gross_weight_kg - tare_weight_kg) stored,
  
  notes text,
  created_at timestamptz not null default now()
);

alter table public.packing_list_items enable row level security;
create policy "packing_list_items tenant read" on public.packing_list_items for select using (company_id = public.get_current_user_company_id());
create policy "packing_list_items tenant insert" on public.packing_list_items for insert with check (company_id = public.get_current_user_company_id());
create policy "packing_list_items tenant update" on public.packing_list_items for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());
create policy "packing_list_items tenant delete" on public.packing_list_items for delete using (company_id = public.get_current_user_company_id());

-- Create index for performance
create index if not exists idx_quality_inspections_company_id on public.quality_inspections(company_id);
create index if not exists idx_packing_list_items_company_id on public.packing_list_items(company_id);
create index if not exists idx_packing_list_items_dispatch_id on public.packing_list_items(dispatch_id);

commit;
