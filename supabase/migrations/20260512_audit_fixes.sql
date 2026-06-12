-- ExtrusionOS Pro – Audit Fix Migration
-- Resolves: CRIT-4, HIGH-1, HIGH-2, MED-3, MED-4, MED-14

begin;

-- ============================================================
-- CRIT-4 & MACHINES: Add missing columns that Zod schema expects
-- ============================================================
alter table public.machines add column if not exists machine_code text;
alter table public.machines add column if not exists is_active boolean not null default true;
alter table public.machines add column if not exists updated_at timestamptz not null default now();

-- Add updated_at trigger for machines
drop trigger if exists set_machines_updated_at on public.machines;
create trigger set_machines_updated_at before update on public.machines
  for each row execute function public.set_updated_at();

-- ============================================================
-- HIGH-1: Add job_number column to production_jobs
-- ============================================================
alter table public.production_jobs add column if not exists job_number text;

-- Backfill existing rows with a generated job number
update public.production_jobs
set job_number = 'JOB-' || left(id::text, 8)
where job_number is null;

-- ============================================================
-- MED-3: Add updated_at to vendors
-- ============================================================
alter table public.vendors add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_vendors_updated_at on public.vendors;
create trigger set_vendors_updated_at before update on public.vendors
  for each row execute function public.set_updated_at();

-- ============================================================
-- MED-4: Add updated_at to quote_revisions (trigger exists but column didn't)
-- ============================================================
alter table public.quote_revisions add column if not exists updated_at timestamptz not null default now();

-- ============================================================
-- Add updated_at to billet_batches (missing trigger)
-- ============================================================
alter table public.billet_batches add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_billet_batches_updated_at on public.billet_batches;
create trigger set_billet_batches_updated_at before update on public.billet_batches
  for each row execute function public.set_updated_at();

-- ============================================================
-- Add updated_at to profile_stock_batches (missing trigger)
-- ============================================================
alter table public.profile_stock_batches add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_profile_stock_batches_updated_at on public.profile_stock_batches;
create trigger set_profile_stock_batches_updated_at before update on public.profile_stock_batches
  for each row execute function public.set_updated_at();

-- ============================================================
-- Ensure delete policies exist on invoices and payments
-- ============================================================
drop policy if exists "invoices tenant delete" on public.invoices;
create policy "invoices tenant delete" on public.invoices
  for delete using (
    company_id = public.get_current_user_company_id()
    and public.is_owner_or_admin()
  );

drop policy if exists "payments tenant update" on public.payments;
create policy "payments tenant update" on public.payments
  for update using (company_id = public.get_current_user_company_id())
  with check (company_id = public.get_current_user_company_id());

drop policy if exists "payments tenant delete" on public.payments;
create policy "payments tenant delete" on public.payments
  for delete using (
    company_id = public.get_current_user_company_id()
    and public.is_owner_or_admin()
  );

commit;
