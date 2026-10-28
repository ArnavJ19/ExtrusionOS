begin;

create table if not exists public.profile_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_stock_batch_id uuid not null references public.profile_stock_batches(id) on delete cascade,
  profile_id uuid not null references public.aluminium_profiles(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  configuration_id uuid references public.system_configurations(id) on delete set null,
  reserved_weight_kg numeric(14,3) not null,
  reserved_length_m numeric(14,3) not null default 0,
  status text not null default 'active',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  constraint profile_stock_reservations_weight_positive check (reserved_weight_kg > 0),
  constraint profile_stock_reservations_status_check check (status in ('active', 'released', 'consumed', 'cancelled'))
);

alter table public.profile_stock_reservations enable row level security;

drop policy if exists "profile_stock_reservations tenant read" on public.profile_stock_reservations;
create policy "profile_stock_reservations tenant read" on public.profile_stock_reservations
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "profile_stock_reservations tenant insert" on public.profile_stock_reservations;
create policy "profile_stock_reservations tenant insert" on public.profile_stock_reservations
  for insert with check (company_id = public.get_current_user_company_id());

drop policy if exists "profile_stock_reservations tenant update" on public.profile_stock_reservations;
create policy "profile_stock_reservations tenant update" on public.profile_stock_reservations
  for update using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());

create index if not exists profile_stock_reservations_company_order_idx on public.profile_stock_reservations(company_id, order_id, status);
create index if not exists profile_stock_reservations_company_profile_idx on public.profile_stock_reservations(company_id, profile_id, status);
create index if not exists profile_stock_reservations_batch_idx on public.profile_stock_reservations(company_id, profile_stock_batch_id, status);
create unique index if not exists profile_stock_reservations_config_batch_active_idx
  on public.profile_stock_reservations(company_id, configuration_id, profile_stock_batch_id, order_id)
  where status = 'active' and configuration_id is not null;

commit;
