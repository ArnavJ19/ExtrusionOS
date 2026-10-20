begin;

-- Only the missing additive portion of 20260512_audit_fixes.sql is required.
-- Initialize maintenance timestamps now; this does not reconstruct past edits.
alter table public.machines add column if not exists updated_at timestamptz not null default now();
alter table public.vendors add column if not exists updated_at timestamptz not null default now();
alter table public.quote_revisions add column if not exists updated_at timestamptz not null default now();
alter table public.billet_batches add column if not exists updated_at timestamptz not null default now();
alter table public.profile_stock_batches add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_machines_updated_at on public.machines;
create trigger set_machines_updated_at before update on public.machines
for each row execute function public.set_updated_at();
drop trigger if exists set_vendors_updated_at on public.vendors;
create trigger set_vendors_updated_at before update on public.vendors
for each row execute function public.set_updated_at();
drop trigger if exists set_billet_batches_updated_at on public.billet_batches;
create trigger set_billet_batches_updated_at before update on public.billet_batches
for each row execute function public.set_updated_at();
drop trigger if exists set_profile_stock_batches_updated_at on public.profile_stock_batches;
create trigger set_profile_stock_batches_updated_at before update on public.profile_stock_batches
for each row execute function public.set_updated_at();

commit;
