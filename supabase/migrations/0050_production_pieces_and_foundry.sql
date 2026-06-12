alter table public.orders
  add column if not exists production_pieces integer;

alter table public.production_jobs
  add column if not exists pieces integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_production_pieces_nonnegative') then
    alter table public.orders add constraint orders_production_pieces_nonnegative check (production_pieces is null or production_pieces >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'production_jobs_pieces_nonnegative') then
    alter table public.production_jobs add constraint production_jobs_pieces_nonnegative check (pieces >= 0);
  end if;
end $$;

update public.orders o
set production_pieces = q.pieces
from (
  select quote_id, company_id, sum(quantity_pieces)::integer as pieces
  from public.quote_items
  group by quote_id, company_id
) q
where o.quote_id = q.quote_id
  and o.company_id = q.company_id
  and o.production_pieces is null;

update public.production_jobs pj
set pieces = coalesce(o.production_pieces, 0)
from public.orders o
where pj.order_id = o.id
  and pj.company_id = o.company_id
  and pj.pieces = 0;

create index if not exists orders_company_production_pieces_idx on public.orders(company_id, production_pieces);
create index if not exists production_jobs_company_pieces_idx on public.production_jobs(company_id, pieces);
create index if not exists production_jobs_company_die_idx on public.production_jobs(company_id, die_id);

create or replace function public.set_order_production_pieces_from_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.quote_id is not null and new.production_pieces is null then
    select sum(quantity_pieces)::integer
    into new.production_pieces
    from public.quote_items
    where quote_id = new.quote_id
      and company_id = new.company_id;
  end if;

  return new;
end;
$$;

drop trigger if exists set_order_production_pieces_from_quote on public.orders;
create trigger set_order_production_pieces_from_quote
before insert or update of quote_id, production_pieces on public.orders
for each row execute function public.set_order_production_pieces_from_quote();

create or replace function public.validate_production_job_die()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.die_id is null then
    raise exception 'Production cannot be scheduled without an existing die' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.dies d
    where d.id = new.die_id
      and d.company_id = new.company_id
      and d.profile_id = new.profile_id
      and d.die_status not in ('inactive', 'dead')
  ) then
    raise exception 'Production die must exist, match the profile, and be active/trial/correction/nitriding' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_production_job_die on public.production_jobs;
create trigger validate_production_job_die
before insert or update of die_id, profile_id, company_id on public.production_jobs
for each row execute function public.validate_production_job_die();

create table if not exists public.foundry_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_number text not null,
  furnace_name text,
  production_date date not null default current_date,
  scrap_aluminium_kg numeric(14,3) not null default 0 check (scrap_aluminium_kg >= 0),
  ingot_kg numeric(14,3) not null default 0 check (ingot_kg >= 0),
  alloy text not null,
  temper text not null,
  billet_length_mm numeric(12,2) not null check (billet_length_mm > 0),
  billet_diameter_mm numeric(12,2) not null check (billet_diameter_mm > 0),
  billet_count integer not null check (billet_count > 0),
  billet_weight_kg numeric(14,3) generated always as (round(((pi() * power((billet_diameter_mm / 2000), 2) * (billet_length_mm / 1000) * 2700))::numeric, 3)) stored,
  total_billet_weight_kg numeric(14,3) generated always as (round(((pi() * power((billet_diameter_mm / 2000), 2) * (billet_length_mm / 1000) * 2700 * billet_count))::numeric, 3)) stored,
  status text not null default 'planned' check (status in ('planned', 'melting', 'cast', 'homogenizing', 'ready', 'issued', 'cancelled')),
  heat_number text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint foundry_batches_company_number_unique unique (company_id, batch_number)
);

alter table public.foundry_batches enable row level security;

drop policy if exists "foundry batches tenant read" on public.foundry_batches;
create policy "foundry batches tenant read" on public.foundry_batches for select using (company_id = public.get_current_user_company_id());
drop policy if exists "foundry batches tenant insert" on public.foundry_batches;
create policy "foundry batches tenant insert" on public.foundry_batches for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production'));
drop policy if exists "foundry batches tenant update" on public.foundry_batches;
create policy "foundry batches tenant update" on public.foundry_batches for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production')) with check (company_id = public.get_current_user_company_id());
drop policy if exists "foundry batches tenant delete" on public.foundry_batches;
create policy "foundry batches tenant delete" on public.foundry_batches for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

create index if not exists foundry_batches_company_status_idx on public.foundry_batches(company_id, status, production_date desc);
create index if not exists foundry_batches_company_alloy_idx on public.foundry_batches(company_id, alloy, temper);

drop trigger if exists set_foundry_batches_updated_at on public.foundry_batches;
create trigger set_foundry_batches_updated_at before update on public.foundry_batches for each row execute function public.set_updated_at();
