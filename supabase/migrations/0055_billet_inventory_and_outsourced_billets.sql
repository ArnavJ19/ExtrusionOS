-- 1. Create outsourced_billet_batches table
create table if not exists public.outsourced_billet_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_number text not null,
  vendor_id uuid references public.vendors(id) on delete restrict,
  received_date date not null default current_date,
  alloy text not null,
  temper text not null,
  billet_count integer not null check (billet_count > 0),
  billet_diameter_inch numeric(8,2) not null,
  billet_diameter_mm numeric(12,2) not null,
  billet_length_mm numeric(12,2) not null,
  weight_kg numeric(14,3) not null check (weight_kg > 0),
  price_per_kg numeric(14,2),
  total_price numeric(14,2),
  status text not null default 'received' check (status in ('received', 'consumed', 'cancelled')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outsourced_billet_batches_company_number_unique unique (company_id, batch_number)
);

alter table public.outsourced_billet_batches enable row level security;
create policy "outsourced billet batches tenant read" on public.outsourced_billet_batches for select using (company_id = public.get_current_user_company_id());
create policy "outsourced billet batches tenant insert" on public.outsourced_billet_batches for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production'));
create policy "outsourced billet batches tenant update" on public.outsourced_billet_batches for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production')) with check (company_id = public.get_current_user_company_id());

create trigger set_outsourced_billet_batches_updated_at before update on public.outsourced_billet_batches for each row execute function public.set_updated_at();

-- 2. Modify foundry_billets to support outsourced batches
alter table public.foundry_billets add column if not exists source_type text not null default 'in_house' check (source_type in ('in_house', 'outsourced'));
alter table public.foundry_billets add column if not exists outsourced_batch_id uuid references public.outsourced_billet_batches(id) on delete cascade;

-- Make foundry_batch_id nullable
alter table public.foundry_billets alter column foundry_batch_id drop not null;

-- Ensure it has exactly one batch reference
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'foundry_billets_source_batch_check') then
    alter table public.foundry_billets add constraint foundry_billets_source_batch_check check (
      (source_type = 'in_house' and foundry_batch_id is not null and outsourced_batch_id is null) or
      (source_type = 'outsourced' and outsourced_batch_id is not null and foundry_batch_id is null)
    );
  end if;
end $$;

-- Fix unique constraint which used foundry_batch_id + billet_number
alter table public.foundry_billets drop constraint if exists foundry_billets_batch_number_unique;
create unique index if not exists foundry_billets_inhouse_batch_number_unique on public.foundry_billets(foundry_batch_id, billet_number) where source_type = 'in_house';
create unique index if not exists foundry_billets_outsourced_batch_number_unique on public.foundry_billets(outsourced_batch_id, billet_number) where source_type = 'outsourced';

-- 3. Modify foundry_batches by removing order_id
drop trigger if exists refresh_foundry_batch_calculations on public.foundry_batches;
drop trigger if exists sync_foundry_billets on public.foundry_batches;

alter table public.foundry_batches drop column if exists order_id cascade;

-- 4. Update sync_foundry_billets trigger (remove order_id references)
create or replace function public.sync_foundry_billets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  i integer;
  v_code text;
begin
  for i in 1..new.billet_count loop
    v_code := concat(new.furnace_number, '-', to_char(new.production_date, 'YYYYMMDD'), '-', new.batch_sequence::text, '-', i::text);
    insert into public.foundry_billets (company_id, source_type, foundry_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status)
    values (new.company_id, 'in_house', new.id, v_code, i, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_length_mm, new.alloy, new.temper, new.billet_weight_density_kg, 'cast')
    on conflict (foundry_batch_id, billet_number) where source_type = 'in_house' do update set
      billet_code = excluded.billet_code,
      billet_diameter_inch = excluded.billet_diameter_inch,
      billet_diameter_mm = excluded.billet_diameter_mm,
      billet_length_mm = excluded.billet_length_mm,
      alloy = excluded.alloy,
      temper = excluded.temper,
      weight_kg = excluded.weight_kg,
      status = case when public.foundry_billets.status in ('issued','consumed','scrap') then public.foundry_billets.status else excluded.status end,
      updated_at = now();
  end loop;
  return new;
end;
$$;

create trigger sync_foundry_billets after insert or update of furnace_number, production_date, batch_sequence, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, billet_weight_density_kg, billet_count on public.foundry_batches for each row execute function public.sync_foundry_billets();

-- 5. Update refresh_foundry_batch_calculations trigger
create or replace function public.refresh_foundry_batch_calculations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.furnace_number := coalesce(nullif(trim(new.furnace_number), ''), nullif(trim(new.furnace_name), ''));
  new.furnace_name := coalesce(nullif(trim(new.furnace_name), ''), new.furnace_number);
  new.batch_sequence := coalesce(new.batch_sequence, 1);
  new.billet_diameter_inch := coalesce(new.billet_diameter_inch, round((new.billet_diameter_mm / 25.4)::numeric, 2));
  new.billet_weight_density_kg := round((pi() * power((new.billet_diameter_mm / 2000), 2) * (new.billet_length_mm / 1000) * new.alloy_density_kg_m3)::numeric, 3);
  
  new.total_billet_weight_density_kg := round((new.billet_weight_density_kg * new.billet_count)::numeric, 3);

  -- Auto-generate batch_number as F1-20260529-1
  new.batch_number := concat(new.furnace_number, '-', to_char(new.production_date, 'YYYYMMDD'), '-', new.batch_sequence::text);

  return new;
end;
$$;

create trigger refresh_foundry_batch_calculations
before insert or update of furnace_number, furnace_name, batch_sequence, billet_diameter_mm, billet_diameter_inch, billet_length_mm, alloy_density_kg_m3, billet_count, production_date
on public.foundry_batches
for each row execute function public.refresh_foundry_batch_calculations();

-- 6. Add trigger for outsourced billet batches to auto-generate billets
create or replace function public.sync_outsourced_billets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  i integer;
  v_code text;
  v_weight_per_billet numeric;
begin
  if coalesce(new.billet_count, 0) > 0 then
    v_weight_per_billet := round((new.weight_kg / new.billet_count)::numeric, 3);
    for i in 1..new.billet_count loop
      v_code := concat('OUT-', new.batch_number, '-', i::text);
      insert into public.foundry_billets (company_id, source_type, outsourced_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status)
      values (new.company_id, 'outsourced', new.id, v_code, i, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_length_mm, new.alloy, new.temper, v_weight_per_billet, 'cast')
      on conflict (outsourced_batch_id, billet_number) where source_type = 'outsourced' do update set
        billet_code = excluded.billet_code,
        billet_diameter_inch = excluded.billet_diameter_inch,
        billet_diameter_mm = excluded.billet_diameter_mm,
        billet_length_mm = excluded.billet_length_mm,
        alloy = excluded.alloy,
        temper = excluded.temper,
        weight_kg = excluded.weight_kg,
        status = case when public.foundry_billets.status in ('issued','consumed','scrap') then public.foundry_billets.status else excluded.status end,
        updated_at = now();
    end loop;
  end if;
  return new;
end;
$$;

create trigger sync_outsourced_billets after insert or update of received_date, batch_number, billet_count, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg on public.outsourced_billet_batches for each row execute function public.sync_outsourced_billets();
