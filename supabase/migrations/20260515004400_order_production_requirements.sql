-- Store minimal production requirements on direct orders so production planning
-- can autofill even when the order was not converted from a quote.

alter table public.orders
  add column if not exists production_profile_id uuid references public.aluminium_profiles(id) on delete restrict,
  add column if not exists production_die_id uuid references public.dies(id) on delete restrict,
  add column if not exists production_quantity_kg numeric(14,3),
  add column if not exists production_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_production_quantity_nonnegative'
  ) then
    alter table public.orders
      add constraint orders_production_quantity_nonnegative
      check (production_quantity_kg is null or production_quantity_kg >= 0);
  end if;
end $$;

create index if not exists orders_company_production_profile_idx on public.orders(company_id, production_profile_id);
create index if not exists orders_company_production_die_idx on public.orders(company_id, production_die_id);
