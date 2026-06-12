alter table public.aluminium_profiles add column if not exists billet_diameter_required_inch numeric(8,2);
alter table public.dies add column if not exists billet_diameter_required_inch numeric(8,2);
alter table public.orders add column if not exists billet_diameter_required_inch numeric(8,2);

alter table public.foundry_batches add column if not exists scrap_id uuid references public.foundry_aluminium_scrap(id) on delete restrict;
alter table public.foundry_aluminium_scrap add column if not exists available_weight_kg numeric(14,3);

update public.foundry_aluminium_scrap
set available_weight_kg = weight_kg
where available_weight_kg is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_billet_diameter_valid') then
    alter table public.aluminium_profiles add constraint profiles_billet_diameter_valid check (billet_diameter_required_inch is null or billet_diameter_required_inch > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dies_billet_diameter_valid') then
    alter table public.dies add constraint dies_billet_diameter_valid check (billet_diameter_required_inch is null or billet_diameter_required_inch > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_billet_diameter_valid') then
    alter table public.orders add constraint orders_billet_diameter_valid check (billet_diameter_required_inch is null or billet_diameter_required_inch > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'foundry_scrap_available_nonnegative') then
    alter table public.foundry_aluminium_scrap add constraint foundry_scrap_available_nonnegative check (available_weight_kg is null or available_weight_kg >= 0);
  end if;
  if exists (select 1 from pg_constraint where conname = 'vendors_type_check') then
    alter table public.vendors drop constraint vendors_type_check;
  end if;
  if exists (select 1 from pg_constraint where conname = 'foundry_external_aluminium_sources_item_type_check') then
    alter table public.foundry_external_aluminium_sources drop constraint foundry_external_aluminium_sources_item_type_check;
  end if;
  if exists (select 1 from pg_constraint where conname = 'foundry_external_sources_quantity_required') then
    alter table public.foundry_external_aluminium_sources drop constraint foundry_external_sources_quantity_required;
  end if;
end $$;

update public.vendors set vendor_type = 'aluminum_billets' where vendor_type = 'billet_supplier';
update public.foundry_external_aluminium_sources set item_type = 'aluminum_ingot' where item_type = 'ingot';
update public.foundry_external_aluminium_sources set item_type = 'aluminum_billets' where item_type = 'billet';
update public.foundry_external_aluminium_sources set item_type = 'aluminum_wire_rods' where item_type in ('wire','bar');
update public.foundry_external_aluminium_sources set item_type = 'aluminum_chips' where item_type = 'chips';

alter table public.vendors add constraint vendors_type_check check (
  vendor_type in ('aluminum_ingot','aluminum_sows','aluminum_billets','aluminum_wire_rods','aluminum_t_ingots','aluminum_chips','die_maker','powder_coating','anodizing','hardware_supplier','transporter','packing_supplier','maintenance','other')
);

alter table public.foundry_external_aluminium_sources add constraint foundry_external_aluminium_sources_item_type_check check (
  item_type in ('aluminum_ingot','aluminum_sows','aluminum_billets','aluminum_wire_rods','aluminum_t_ingots','aluminum_chips')
);

alter table public.foundry_external_aluminium_sources add constraint foundry_external_sources_quantity_required check (item_type = 'aluminum_chips' or quantity is not null);

update public.dies d
set billet_diameter_required_inch = p.billet_diameter_required_inch
from public.aluminium_profiles p
where d.profile_id = p.id and d.company_id = p.company_id and d.billet_diameter_required_inch is null and p.billet_diameter_required_inch is not null;

update public.orders o
set billet_diameter_required_inch = coalesce(d.billet_diameter_required_inch, p.billet_diameter_required_inch)
from public.dies d
left join public.aluminium_profiles p on p.id = d.profile_id and p.company_id = d.company_id
where o.production_die_id = d.id and o.company_id = d.company_id and o.billet_diameter_required_inch is null;

create index if not exists profiles_company_billet_diameter_idx on public.aluminium_profiles(company_id, billet_diameter_required_inch);
create index if not exists dies_company_billet_diameter_idx on public.dies(company_id, billet_diameter_required_inch);
create index if not exists orders_company_billet_diameter_idx on public.orders(company_id, billet_diameter_required_inch);
create index if not exists foundry_batches_company_scrap_idx on public.foundry_batches(company_id, scrap_id);
create index if not exists foundry_scrap_company_available_idx on public.foundry_aluminium_scrap(company_id, status, available_weight_kg);

create or replace function public.refresh_foundry_batch_calculations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required_kg numeric;
  v_required_diameter numeric;
begin
  new.furnace_number := coalesce(nullif(trim(new.furnace_number), ''), nullif(trim(new.furnace_name), ''));
  new.furnace_name := coalesce(nullif(trim(new.furnace_name), ''), new.furnace_number);
  new.batch_sequence := coalesce(new.batch_sequence, 1);

  if new.order_id is not null then
    select coalesce(o.billet_diameter_required_inch, d.billet_diameter_required_inch, p.billet_diameter_required_inch), o.production_quantity_kg
    into v_required_diameter, v_required_kg
    from public.orders o
    left join public.dies d on d.id = o.production_die_id and d.company_id = o.company_id
    left join public.aluminium_profiles p on p.id = o.production_profile_id and p.company_id = o.company_id
    where o.id = new.order_id and o.company_id = new.company_id;

    if v_required_diameter is not null then
      new.billet_diameter_inch := v_required_diameter;
    end if;
  end if;

  new.billet_diameter_mm := round((new.billet_diameter_inch * 25.4)::numeric, 2);
  new.billet_count := case when new.billet_diameter_inch = 6 then 24 when new.billet_diameter_inch = 4 then 48 else new.billet_count end;
  new.billet_weight_density_kg := round((pi() * power((new.billet_diameter_mm / 2000), 2) * (new.billet_length_mm / 1000) * new.alloy_density_kg_m3)::numeric, 3);

  if new.order_id is not null and new.billet_weight_density_kg > 0 and coalesce(v_required_kg, 0) > 0 then
    new.billet_count := least(new.billet_count, greatest(1, ceil(v_required_kg / new.billet_weight_density_kg)::integer));
  end if;

  new.total_billet_weight_density_kg := round((new.billet_weight_density_kg * new.billet_count)::numeric, 3);
  return new;
end;
$$;

drop trigger if exists refresh_foundry_batch_calculations on public.foundry_batches;
create trigger refresh_foundry_batch_calculations
before insert or update of furnace_number, furnace_name, batch_sequence, billet_diameter_mm, billet_diameter_inch, billet_length_mm, alloy_density_kg_m3, billet_count, order_id
on public.foundry_batches
for each row execute function public.refresh_foundry_batch_calculations();

create or replace function public.sync_foundry_scrap_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.scrap_id is not null and (old.scrap_id is distinct from new.scrap_id or old.scrap_aluminium_kg is distinct from new.scrap_aluminium_kg) then
    update public.foundry_aluminium_scrap
    set available_weight_kg = coalesce(available_weight_kg, weight_kg) + coalesce(old.scrap_aluminium_kg, 0),
        status = case when status = 'used' then 'available' else status end,
        updated_at = now()
    where id = old.scrap_id and company_id = old.company_id;
  end if;

  if tg_op in ('INSERT','UPDATE') and new.scrap_id is not null and coalesce(new.scrap_aluminium_kg, 0) > 0 then
    update public.foundry_aluminium_scrap
    set available_weight_kg = coalesce(available_weight_kg, weight_kg) - new.scrap_aluminium_kg,
        status = case when coalesce(available_weight_kg, weight_kg) - new.scrap_aluminium_kg <= 0 then 'used' else 'reserved' end,
        updated_at = now()
    where id = new.scrap_id
      and company_id = new.company_id
      and coalesce(available_weight_kg, weight_kg) >= new.scrap_aluminium_kg;

    if not found then
      raise exception 'Selected scrap batch does not have enough available weight';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_foundry_scrap_usage on public.foundry_batches;
create trigger sync_foundry_scrap_usage before insert or update of scrap_id, scrap_aluminium_kg on public.foundry_batches for each row execute function public.sync_foundry_scrap_usage();
