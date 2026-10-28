alter table public.foundry_batches add column if not exists external_source_id uuid references public.foundry_external_aluminium_sources(id) on delete restrict;
alter table public.foundry_batches add column if not exists scrap_percentage numeric(7,3) not null default 0;
alter table public.foundry_batches add column if not exists external_aluminium_percentage numeric(7,3) not null default 100;
alter table public.foundry_batches add column if not exists furnace_efficiency_percent numeric(7,3) not null default 80;
alter table public.foundry_batches add column if not exists required_furnace_charge_kg numeric(14,3) not null default 0;
alter table public.foundry_batches add column if not exists external_aluminium_kg numeric(14,3) not null default 0;
alter table public.foundry_batches add column if not exists alloy_composition_default jsonb not null default '{}'::jsonb;
alter table public.foundry_batches add column if not exists alloy_composition_actual jsonb not null default '{}'::jsonb;
alter table public.foundry_batches add column if not exists alloy_composition_altered boolean not null default false;
alter table public.foundry_batches add column if not exists alloy_composition_source text;

alter table public.foundry_external_aluminium_sources add column if not exists available_weight_kg numeric(14,3);

update public.foundry_external_aluminium_sources
set available_weight_kg = weight_kg
where available_weight_kg is null;

update public.foundry_batches
set furnace_efficiency_percent = coalesce(nullif(furnace_efficiency_percent, 0), nullif(extrusion_efficiency_percent, 0), 80),
    required_furnace_charge_kg = case
      when coalesce(total_billet_weight_density_kg, 0) > 0 then round((total_billet_weight_density_kg / (coalesce(nullif(furnace_efficiency_percent, 0), nullif(extrusion_efficiency_percent, 0), 80) / 100))::numeric, 3)
      else 0
    end,
    external_aluminium_kg = coalesce(nullif(ingot_kg, 0), 0),
    external_aluminium_percentage = case
      when coalesce(scrap_aluminium_kg, 0) > 0 or coalesce(ingot_kg, 0) > 0 then round((coalesce(ingot_kg, 0) * 100 / nullif(coalesce(scrap_aluminium_kg, 0) + coalesce(ingot_kg, 0), 0))::numeric, 3)
      else 100
    end,
    scrap_percentage = case
      when coalesce(scrap_aluminium_kg, 0) > 0 or coalesce(ingot_kg, 0) > 0 then round((coalesce(scrap_aluminium_kg, 0) * 100 / nullif(coalesce(scrap_aluminium_kg, 0) + coalesce(ingot_kg, 0), 0))::numeric, 3)
      else 0
    end;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'foundry_batches_furnace_efficiency_valid') then
    alter table public.foundry_batches add constraint foundry_batches_furnace_efficiency_valid check (furnace_efficiency_percent > 0 and furnace_efficiency_percent <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'foundry_batches_mix_percent_valid') then
    alter table public.foundry_batches add constraint foundry_batches_mix_percent_valid check (
      scrap_percentage >= 0
      and external_aluminium_percentage >= 0
      and abs((scrap_percentage + external_aluminium_percentage) - 100) <= 0.001
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'foundry_batches_charge_weights_nonnegative') then
    alter table public.foundry_batches add constraint foundry_batches_charge_weights_nonnegative check (
      required_furnace_charge_kg >= 0
      and scrap_aluminium_kg >= 0
      and external_aluminium_kg >= 0
      and ingot_kg >= 0
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'foundry_external_sources_available_nonnegative') then
    alter table public.foundry_external_aluminium_sources add constraint foundry_external_sources_available_nonnegative check (available_weight_kg is null or available_weight_kg >= 0);
  end if;
end $$;

create index if not exists foundry_batches_company_external_source_idx on public.foundry_batches(company_id, external_source_id);
create index if not exists foundry_external_sources_company_available_idx on public.foundry_external_aluminium_sources(company_id, status, available_weight_kg);

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
  new.furnace_efficiency_percent := coalesce(nullif(new.furnace_efficiency_percent, 0), 80);
  new.scrap_percentage := coalesce(new.scrap_percentage, 0);
  new.external_aluminium_percentage := coalesce(new.external_aluminium_percentage, 100 - new.scrap_percentage);
  new.billet_diameter_inch := coalesce(new.billet_diameter_inch, round((new.billet_diameter_mm / 25.4)::numeric, 2));
  new.billet_diameter_mm := round((new.billet_diameter_inch * 25.4)::numeric, 2);
  new.billet_weight_density_kg := round((pi() * power((new.billet_diameter_mm / 2000), 2) * (new.billet_length_mm / 1000) * new.alloy_density_kg_m3)::numeric, 3);
  new.total_billet_weight_density_kg := round((new.billet_weight_density_kg * new.billet_count)::numeric, 3);
  new.required_furnace_charge_kg := case
    when coalesce(new.total_billet_weight_density_kg, 0) > 0 then round((new.total_billet_weight_density_kg / (new.furnace_efficiency_percent / 100))::numeric, 3)
    else 0
  end;
  new.scrap_aluminium_kg := round((new.required_furnace_charge_kg * new.scrap_percentage / 100)::numeric, 3);
  new.external_aluminium_kg := round((new.required_furnace_charge_kg * new.external_aluminium_percentage / 100)::numeric, 3);
  new.ingot_kg := new.external_aluminium_kg;
  new.alloy_composition_default := coalesce(new.alloy_composition_default, '{}'::jsonb);
  new.alloy_composition_actual := coalesce(new.alloy_composition_actual, new.alloy_composition_default, '{}'::jsonb);
  new.alloy_composition_altered := coalesce(new.alloy_composition_altered, new.alloy_composition_actual is distinct from new.alloy_composition_default);
  new.batch_number := concat(new.furnace_number, '-', to_char(new.production_date, 'YYYYMMDD'), '-', new.batch_sequence::text);
  return new;
end;
$$;

drop trigger if exists refresh_foundry_batch_calculations on public.foundry_batches;
create trigger refresh_foundry_batch_calculations
before insert or update
on public.foundry_batches
for each row execute function public.refresh_foundry_batch_calculations();

create or replace function public.sync_foundry_scrap_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apply_usage boolean := false;
begin
  if tg_op = 'INSERT' then
    v_apply_usage := true;
  elsif tg_op = 'UPDATE' then
    v_apply_usage := old.scrap_id is distinct from new.scrap_id or old.scrap_aluminium_kg is distinct from new.scrap_aluminium_kg;
  end if;

  if tg_op = 'UPDATE' and old.scrap_id is not null and (old.scrap_id is distinct from new.scrap_id or old.scrap_aluminium_kg is distinct from new.scrap_aluminium_kg) then
    update public.foundry_aluminium_scrap
    set available_weight_kg = coalesce(available_weight_kg, weight_kg) + coalesce(old.scrap_aluminium_kg, 0),
        status = case when status = 'used' then 'available' else status end,
        updated_at = now()
    where id = old.scrap_id and company_id = old.company_id;
  end if;

  if v_apply_usage and new.scrap_id is not null and coalesce(new.scrap_aluminium_kg, 0) > 0 then
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
create trigger sync_foundry_scrap_usage before insert or update on public.foundry_batches for each row execute function public.sync_foundry_scrap_usage();

create or replace function public.sync_foundry_external_source_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apply_usage boolean := false;
begin
  if tg_op = 'INSERT' then
    v_apply_usage := true;
  elsif tg_op = 'UPDATE' then
    v_apply_usage := old.external_source_id is distinct from new.external_source_id or old.external_aluminium_kg is distinct from new.external_aluminium_kg;
  end if;

  if tg_op = 'UPDATE' and old.external_source_id is not null and (old.external_source_id is distinct from new.external_source_id or old.external_aluminium_kg is distinct from new.external_aluminium_kg) then
    update public.foundry_external_aluminium_sources
    set available_weight_kg = coalesce(available_weight_kg, weight_kg) + coalesce(old.external_aluminium_kg, 0),
        status = case when status = 'used' then 'available' else status end,
        updated_at = now()
    where id = old.external_source_id and company_id = old.company_id;
  end if;

  if v_apply_usage and new.external_source_id is not null and coalesce(new.external_aluminium_kg, 0) > 0 then
    update public.foundry_external_aluminium_sources
    set available_weight_kg = coalesce(available_weight_kg, weight_kg) - new.external_aluminium_kg,
        status = case when coalesce(available_weight_kg, weight_kg) - new.external_aluminium_kg <= 0 then 'used' else 'reserved' end,
        updated_at = now()
    where id = new.external_source_id
      and company_id = new.company_id
      and status in ('available','reserved')
      and coalesce(available_weight_kg, weight_kg) >= new.external_aluminium_kg;

    if not found then
      raise exception 'Selected external aluminium source does not have enough available weight';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_foundry_external_source_usage on public.foundry_batches;
create trigger sync_foundry_external_source_usage before insert or update on public.foundry_batches for each row execute function public.sync_foundry_external_source_usage();
