-- Phase 1 RLS Fixes and Missing Indexes

begin;

-- 1. Ensure all core tables have RLS enabled
alter table public.companies enable row level security;
alter table public.app_users enable row level security;
alter table public.customers enable row level security;
alter table public.aluminium_profiles enable row level security;
alter table public.dies enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_stage_history enable row level security;
alter table public.dispatches enable row level security;
alter table public.documents enable row level security;
alter table public.company_settings enable row level security;

-- 2. Add baseline RLS policies if missing (tenant isolation)
-- Companies
drop policy if exists "companies tenant read" on public.companies;
create policy "companies tenant read" on public.companies
  for select using (id = public.get_current_user_company_id());

-- Customers
drop policy if exists "customers tenant read" on public.customers;
create policy "customers tenant read" on public.customers
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "customers tenant insert" on public.customers;
create policy "customers tenant insert" on public.customers
  for insert with check (company_id = public.get_current_user_company_id());

drop policy if exists "customers tenant update" on public.customers;
create policy "customers tenant update" on public.customers
  for update using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());

-- Profiles
drop policy if exists "profiles tenant read" on public.aluminium_profiles;
create policy "profiles tenant read" on public.aluminium_profiles
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "profiles tenant insert" on public.aluminium_profiles;
create policy "profiles tenant insert" on public.aluminium_profiles
  for insert with check (company_id = public.get_current_user_company_id());

drop policy if exists "profiles tenant update" on public.aluminium_profiles;
create policy "profiles tenant update" on public.aluminium_profiles
  for update using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());

-- Dies
drop policy if exists "dies tenant read" on public.dies;
create policy "dies tenant read" on public.dies
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "dies tenant insert" on public.dies;
create policy "dies tenant insert" on public.dies
  for insert with check (company_id = public.get_current_user_company_id());

drop policy if exists "dies tenant update" on public.dies;
create policy "dies tenant update" on public.dies
  for update using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());

-- Quotes
drop policy if exists "quotes tenant read" on public.quotes;
create policy "quotes tenant read" on public.quotes
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "quotes tenant insert" on public.quotes;
create policy "quotes tenant insert" on public.quotes
  for insert with check (company_id = public.get_current_user_company_id());

drop policy if exists "quotes tenant update" on public.quotes;
create policy "quotes tenant update" on public.quotes
  for update using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());

-- Quote Items
drop policy if exists "quote items tenant read" on public.quote_items;
create policy "quote items tenant read" on public.quote_items
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "quote items tenant insert" on public.quote_items;
create policy "quote items tenant insert" on public.quote_items
  for insert with check (company_id = public.get_current_user_company_id());

drop policy if exists "quote items tenant update" on public.quote_items;
create policy "quote items tenant update" on public.quote_items
  for update using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());

drop policy if exists "quote items tenant delete" on public.quote_items;
create policy "quote items tenant delete" on public.quote_items
  for delete using (company_id = public.get_current_user_company_id());

-- Orders
drop policy if exists "orders tenant read" on public.orders;
create policy "orders tenant read" on public.orders
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "orders tenant insert" on public.orders;
create policy "orders tenant insert" on public.orders
  for insert with check (company_id = public.get_current_user_company_id());

drop policy if exists "orders tenant update" on public.orders;
create policy "orders tenant update" on public.orders
  for update using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());

-- Dispatches
drop policy if exists "dispatches tenant read" on public.dispatches;
create policy "dispatches tenant read" on public.dispatches
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "dispatches tenant insert" on public.dispatches;
create policy "dispatches tenant insert" on public.dispatches
  for insert with check (company_id = public.get_current_user_company_id());

drop policy if exists "dispatches tenant update" on public.dispatches;
create policy "dispatches tenant update" on public.dispatches
  for update using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());

-- Settings
drop policy if exists "settings tenant read" on public.company_settings;
create policy "settings tenant read" on public.company_settings
  for select using (company_id = public.get_current_user_company_id());

drop policy if exists "settings tenant update" on public.company_settings;
create policy "settings tenant update" on public.company_settings
  for update using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());

-- 3. Add additional performance indexes
create index if not exists orders_company_stage_idx on public.orders(company_id, current_stage);
create index if not exists dies_company_customer_idx on public.dies(company_id, customer_id);

commit;
