-- Phase 5: Financials, Costing & Analytics

begin;

-- 1. Invoices
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  dispatch_id uuid references public.dispatches(id) on delete set null,
  
  invoice_number text,
  invoice_date date not null default current_date,
  due_date date,
  
  -- Financials
  subtotal numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  balance_due numeric(14,2) generated always as (grand_total - amount_paid) stored,
  
  status text not null default 'draft',
  notes text,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  unique(company_id, invoice_number)
);

alter table public.invoices add constraint invoice_status_check check (
  status in ('draft', 'generated', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled')
);

alter table public.invoices enable row level security;
create policy "invoices tenant read" on public.invoices for select using (company_id = public.get_current_user_company_id());
create policy "invoices tenant insert" on public.invoices for insert with check (company_id = public.get_current_user_company_id());
create policy "invoices tenant update" on public.invoices for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());

-- 2. Payments
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null,
  reference_number text,
  notes text,
  
  created_at timestamptz not null default now()
);

alter table public.payments add constraint payment_method_check check (
  payment_method in ('bank_transfer', 'upi', 'cheque', 'cash', 'credit_note', 'other')
);

alter table public.payments enable row level security;
create policy "payments tenant read" on public.payments for select using (company_id = public.get_current_user_company_id());
create policy "payments tenant insert" on public.payments for insert with check (company_id = public.get_current_user_company_id());

-- 3. Analytics Views (Yield & Amortization)

-- View for Die Amortization Status
create or replace view public.die_amortization_status as
select 
  d.company_id,
  d.id as die_id,
  d.die_number,
  d.profile_id,
  d.ownership_type,
  d.die_cost,
  d.total_production_kg,
  coalesce(qi.die_amortization_quantity_kg, 0) as required_amortization_kg,
  case 
    when coalesce(qi.die_amortization_quantity_kg, 0) = 0 then true
    when d.total_production_kg >= qi.die_amortization_quantity_kg then true
    else false
  end as is_amortized
from public.dies d
left join public.quote_items qi on qi.die_id = d.id and qi.die_amortization_type = 'per_kg'
where d.ownership_type = 'customer_owned';

-- Note on RLS for Views: 
-- In Supabase, views bypass RLS by default unless created with security invoker.
-- We will recreate the view with security invoker for tenant isolation.
drop view if exists public.die_amortization_status;
create view public.die_amortization_status with (security_invoker = true) as
select 
  d.company_id,
  d.id as die_id,
  d.die_number,
  d.profile_id,
  d.ownership_type,
  d.die_cost,
  d.total_production_kg,
  coalesce(qi.die_amortization_quantity_kg, 0) as required_amortization_kg,
  case 
    when coalesce(qi.die_amortization_quantity_kg, 0) = 0 then true
    when d.total_production_kg >= qi.die_amortization_quantity_kg then true
    else false
  end as is_amortized
from public.dies d
left join public.quote_items qi on qi.die_id = d.id and qi.die_amortization_type = 'per_kg'
where d.ownership_type = 'customer_owned';

commit;
