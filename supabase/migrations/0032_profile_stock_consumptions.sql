begin;

create table if not exists public.profile_stock_consumptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reservation_id uuid not null references public.profile_stock_reservations(id) on delete cascade,
  profile_stock_batch_id uuid not null references public.profile_stock_batches(id) on delete cascade,
  profile_id uuid not null references public.aluminium_profiles(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  consumed_weight_kg numeric(14,3) not null,
  consumed_length_m numeric(14,3) not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint profile_stock_consumptions_weight_positive check (consumed_weight_kg > 0)
);

alter table public.profile_stock_consumptions enable row level security;

drop policy if exists "profile_stock_consumptions tenant read" on public.profile_stock_consumptions;
create policy "profile_stock_consumptions tenant read" on public.profile_stock_consumptions
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "profile_stock_consumptions tenant insert" on public.profile_stock_consumptions;
create policy "profile_stock_consumptions tenant insert" on public.profile_stock_consumptions
  for insert with check (company_id = public.get_current_user_company_id());

create index if not exists profile_stock_consumptions_company_order_idx on public.profile_stock_consumptions(company_id, order_id, dispatch_id);
create index if not exists profile_stock_consumptions_reservation_idx on public.profile_stock_consumptions(company_id, reservation_id);
create index if not exists profile_stock_consumptions_batch_idx on public.profile_stock_consumptions(company_id, profile_stock_batch_id);
create unique index if not exists profile_stock_consumptions_dispatch_reservation_idx
  on public.profile_stock_consumptions(company_id, dispatch_id, reservation_id);

commit;
