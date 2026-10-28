alter table public.foundry_batches add column if not exists furnace_number text;
alter table public.foundry_batches add column if not exists batch_sequence integer;
alter table public.foundry_batches add column if not exists billet_diameter_inch numeric(8,2);
alter table public.foundry_batches add column if not exists alloy_density_kg_m3 numeric(10,3) not null default 2700;
alter table public.foundry_batches add column if not exists order_id uuid references public.orders(id) on delete set null;
alter table public.foundry_batches add column if not exists extrusion_efficiency_percent numeric(7,2) not null default 80;
alter table public.foundry_batches add column if not exists billet_weight_density_kg numeric(14,3);
alter table public.foundry_batches add column if not exists total_billet_weight_density_kg numeric(14,3);

update public.foundry_batches
set furnace_number = coalesce(nullif(trim(furnace_number), ''), nullif(trim(furnace_name), ''), 'F1'),
    furnace_name = coalesce(nullif(trim(furnace_name), ''), nullif(trim(furnace_number), ''), 'F1'),
    batch_sequence = coalesce(batch_sequence, 1),
    billet_diameter_inch = coalesce(billet_diameter_inch, round((billet_diameter_mm / 25.4)::numeric, 2)),
    billet_weight_density_kg = round((pi() * power((billet_diameter_mm / 2000), 2) * (billet_length_mm / 1000) * alloy_density_kg_m3)::numeric, 3),
    total_billet_weight_density_kg = round((pi() * power((billet_diameter_mm / 2000), 2) * (billet_length_mm / 1000) * alloy_density_kg_m3 * billet_count)::numeric, 3);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'foundry_batches_furnace_required') then
    alter table public.foundry_batches add constraint foundry_batches_furnace_required check (furnace_number is not null and length(trim(furnace_number)) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'foundry_batches_batch_sequence_positive') then
    alter table public.foundry_batches add constraint foundry_batches_batch_sequence_positive check (batch_sequence is not null and batch_sequence > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'foundry_batches_density_positive') then
    alter table public.foundry_batches add constraint foundry_batches_density_positive check (alloy_density_kg_m3 > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'foundry_batches_efficiency_valid') then
    alter table public.foundry_batches add constraint foundry_batches_efficiency_valid check (extrusion_efficiency_percent > 0 and extrusion_efficiency_percent <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'foundry_batches_diameter_capacity') then
    alter table public.foundry_batches add constraint foundry_batches_diameter_capacity check (
      billet_diameter_inch is null
      or (billet_diameter_inch = 6 and billet_count <= 24)
      or (billet_diameter_inch = 4 and billet_count <= 48)
      or billet_diameter_inch not in (4, 6)
    );
  end if;
end $$;

create table if not exists public.foundry_billets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  foundry_batch_id uuid not null references public.foundry_batches(id) on delete cascade,
  billet_code text not null,
  billet_number integer not null check (billet_number > 0),
  billet_diameter_inch numeric(8,2) not null,
  billet_diameter_mm numeric(12,2) not null,
  billet_length_mm numeric(12,2) not null,
  alloy text not null,
  temper text not null,
  weight_kg numeric(14,3) not null check (weight_kg > 0),
  order_id uuid references public.orders(id) on delete set null,
  production_job_id uuid references public.production_jobs(id) on delete set null,
  status text not null default 'cast' check (status in ('cast','allocated','issued','consumed','scrap','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint foundry_billets_company_code_unique unique (company_id, billet_code),
  constraint foundry_billets_batch_number_unique unique (foundry_batch_id, billet_number)
);

create table if not exists public.foundry_external_aluminium_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_number text not null,
  item_type text not null check (item_type in ('ingot','bar','billet','wire','chips')),
  weight_kg numeric(14,3) not null check (weight_kg > 0),
  quantity numeric(14,3),
  vendor_id uuid references public.vendors(id) on delete set null,
  source_origin text not null,
  received_date date not null default current_date,
  alloy text,
  quality_grade text,
  status text not null default 'available' check (status in ('available','reserved','used','rejected','returned')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint foundry_external_sources_company_number_unique unique (company_id, source_number),
  constraint foundry_external_sources_quantity_required check (item_type = 'chips' or quantity is not null)
);

create table if not exists public.foundry_aluminium_scrap (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  scrap_number text not null,
  scrap_source text not null check (scrap_source in ('incoming','in_house')),
  weight_kg numeric(14,3) not null check (weight_kg > 0),
  vendor_id uuid references public.vendors(id) on delete set null,
  scrap_quality text not null check (scrap_quality in ('clean','painted','mixed','contaminated','segregation_required','rejected')),
  received_date date not null default current_date,
  origin_reference text,
  status text not null default 'available' check (status in ('available','reserved','used','rejected')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint foundry_scrap_company_number_unique unique (company_id, scrap_number),
  constraint foundry_scrap_incoming_vendor_required check (scrap_source <> 'incoming' or vendor_id is not null)
);

alter table public.production_jobs add column if not exists extrusion_efficiency_percent numeric(7,2) not null default 80;
alter table public.production_jobs add column if not exists required_billet_count integer not null default 0;
alter table public.production_jobs add column if not exists length_per_piece_m numeric(12,3);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'production_jobs_efficiency_valid') then
    alter table public.production_jobs add constraint production_jobs_efficiency_valid check (extrusion_efficiency_percent > 0 and extrusion_efficiency_percent <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'production_jobs_required_billets_nonnegative') then
    alter table public.production_jobs add constraint production_jobs_required_billets_nonnegative check (required_billet_count >= 0);
  end if;
end $$;

create table if not exists public.production_efficiency_change_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  old_efficiency_percent numeric(7,2),
  new_efficiency_percent numeric(7,2) not null,
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.packaging_materials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  material_code text not null,
  material_name text not null,
  material_type text not null check (material_type in ('stretch_film','bubble_wrap','paper','hdpe','wooden_crate','strapping','corner_protector','other')),
  unit text not null default 'meter',
  current_stock numeric(14,3) not null default 0 check (current_stock >= 0),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  consumption_per_profile_meter numeric(12,3) not null default 1 check (consumption_per_profile_meter > 0),
  vendor_id uuid references public.vendors(id) on delete set null,
  location text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packaging_materials_company_code_unique unique (company_id, material_code)
);

create table if not exists public.packaging_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  packaging_number text not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  production_job_id uuid references public.production_jobs(id) on delete set null,
  material_id uuid not null references public.packaging_materials(id) on delete restrict,
  scheduled_date date not null default current_date,
  pieces integer not null default 0 check (pieces >= 0),
  profile_weight_kg numeric(14,3) not null default 0 check (profile_weight_kg >= 0),
  profile_length_m numeric(14,3) not null default 0 check (profile_length_m >= 0),
  material_quantity_required numeric(14,3) not null default 0 check (material_quantity_required >= 0),
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packaging_jobs_company_number_unique unique (company_id, packaging_number)
);

create table if not exists public.packaging_material_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  packaging_job_id uuid not null references public.packaging_jobs(id) on delete cascade,
  material_id uuid not null references public.packaging_materials(id) on delete restrict,
  movement_type text not null check (movement_type in ('issue','restore')),
  quantity numeric(14,3) not null check (quantity > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace function public.refresh_foundry_batch_calculations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required_kg numeric;
begin
  new.furnace_number := coalesce(nullif(trim(new.furnace_number), ''), nullif(trim(new.furnace_name), ''));
  new.furnace_name := coalesce(nullif(trim(new.furnace_name), ''), new.furnace_number);
  new.batch_sequence := coalesce(new.batch_sequence, 1);
  new.billet_diameter_inch := coalesce(new.billet_diameter_inch, round((new.billet_diameter_mm / 25.4)::numeric, 2));
  new.billet_weight_density_kg := round((pi() * power((new.billet_diameter_mm / 2000), 2) * (new.billet_length_mm / 1000) * new.alloy_density_kg_m3)::numeric, 3);

  if new.order_id is not null and new.billet_weight_density_kg > 0 then
    select production_quantity_kg into v_required_kg
    from public.orders
    where id = new.order_id and company_id = new.company_id;

    if coalesce(v_required_kg, 0) > 0 then
      new.billet_count := least(
        case when new.billet_diameter_inch = 6 then 24 when new.billet_diameter_inch = 4 then 48 else new.billet_count end,
        greatest(1, ceil((v_required_kg / (new.extrusion_efficiency_percent / 100)) / new.billet_weight_density_kg)::integer)
      );
    end if;
  end if;

  new.total_billet_weight_density_kg := round((new.billet_weight_density_kg * new.billet_count)::numeric, 3);
  return new;
end;
$$;

drop trigger if exists refresh_foundry_batch_calculations on public.foundry_batches;
create trigger refresh_foundry_batch_calculations
before insert or update of furnace_number, furnace_name, batch_sequence, billet_diameter_mm, billet_diameter_inch, billet_length_mm, alloy_density_kg_m3, billet_count, order_id, extrusion_efficiency_percent
on public.foundry_batches
for each row execute function public.refresh_foundry_batch_calculations();

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
    v_code := concat(new.furnace_number, '-', to_char(new.production_date, 'DDMMYYYY'), '-', lpad(new.batch_sequence::text, 2, '0'), '-', trim(to_char(new.billet_diameter_inch, 'FM999999990.##')), '-', i::text);
    insert into public.foundry_billets (company_id, foundry_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, order_id, status)
    values (new.company_id, new.id, v_code, i, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_length_mm, new.alloy, new.temper, new.billet_weight_density_kg, new.order_id, case when new.order_id is null then 'cast' else 'allocated' end)
    on conflict (foundry_batch_id, billet_number) do update set
      billet_code = excluded.billet_code,
      billet_diameter_inch = excluded.billet_diameter_inch,
      billet_diameter_mm = excluded.billet_diameter_mm,
      billet_length_mm = excluded.billet_length_mm,
      alloy = excluded.alloy,
      temper = excluded.temper,
      weight_kg = excluded.weight_kg,
      order_id = excluded.order_id,
      status = case when public.foundry_billets.status in ('issued','consumed','scrap') then public.foundry_billets.status else excluded.status end,
      updated_at = now();
  end loop;
  return new;
end;
$$;

drop trigger if exists sync_foundry_billets on public.foundry_batches;
create trigger sync_foundry_billets after insert or update of furnace_number, production_date, batch_sequence, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, billet_weight_density_kg, billet_count, order_id on public.foundry_batches for each row execute function public.sync_foundry_billets();

create or replace function public.log_production_efficiency_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager uuid;
begin
  if tg_op = 'INSERT' and new.extrusion_efficiency_percent <> 80 then
    insert into public.production_efficiency_change_logs(company_id, production_job_id, old_efficiency_percent, new_efficiency_percent, changed_by)
    values (new.company_id, new.id, 80, new.extrusion_efficiency_percent, auth.uid());
  elsif tg_op = 'UPDATE' and old.extrusion_efficiency_percent is distinct from new.extrusion_efficiency_percent then
    insert into public.production_efficiency_change_logs(company_id, production_job_id, old_efficiency_percent, new_efficiency_percent, changed_by)
    values (new.company_id, new.id, old.extrusion_efficiency_percent, new.extrusion_efficiency_percent, auth.uid());
  end if;

  if (tg_op = 'INSERT' and new.extrusion_efficiency_percent <> 80) or (tg_op = 'UPDATE' and old.extrusion_efficiency_percent is distinct from new.extrusion_efficiency_percent) then
    select id into v_manager from public.app_users where company_id = new.company_id and role in ('owner','admin','production_manager') and is_active = true order by case role when 'production_manager' then 0 when 'owner' then 1 else 2 end limit 1;
    insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by)
    values (new.company_id, v_manager, 'production_efficiency_changed', 'warning', 'Production efficiency changed', concat('Job ', coalesce(new.job_number, new.id::text), ' uses ', new.extrusion_efficiency_percent::text, '% extrusion efficiency.'), 'production_job', new.id, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists log_production_efficiency_change on public.production_jobs;
create trigger log_production_efficiency_change after insert or update of extrusion_efficiency_percent on public.production_jobs for each row execute function public.log_production_efficiency_change();

create or replace function public.refresh_production_billet_requirement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_billet_weight numeric;
begin
  select avg(weight_kg) into v_billet_weight
  from public.foundry_billets
  where company_id = new.company_id and order_id = new.order_id and status in ('allocated','issued');

  if coalesce(v_billet_weight, 0) > 0 and coalesce(new.planned_quantity_kg, 0) > 0 then
    new.required_billet_count := greatest(1, ceil((new.planned_quantity_kg / (new.extrusion_efficiency_percent / 100)) / v_billet_weight)::integer);
  end if;
  return new;
end;
$$;

drop trigger if exists refresh_production_billet_requirement on public.production_jobs;
create trigger refresh_production_billet_requirement before insert or update of order_id, planned_quantity_kg, extrusion_efficiency_percent on public.production_jobs for each row execute function public.refresh_production_billet_requirement();

create or replace function public.link_billets_to_production_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.foundry_billets
  set production_job_id = new.id,
      status = case when new.status = 'completed' then 'consumed' else 'issued' end,
      updated_at = now()
  where id in (
    select id from public.foundry_billets
    where company_id = new.company_id
      and order_id = new.order_id
      and (production_job_id is null or production_job_id = new.id)
      and status in ('allocated','issued')
    order by billet_number
    limit greatest(new.required_billet_count, 0)
  );

  if new.status = 'completed' then
    insert into public.packaging_jobs(company_id, packaging_number, order_id, production_job_id, material_id, scheduled_date, pieces, profile_weight_kg, profile_length_m, status, notes, created_by)
    select new.company_id,
           concat('PKG-', to_char(now(), 'YYYY'), '-', substring(new.id::text, 1, 8)),
           new.order_id,
           new.id,
           pm.id,
           current_date,
           coalesce(new.pieces, 0),
           coalesce(new.actual_quantity_kg, new.planned_quantity_kg, 0),
           coalesce(new.length_per_piece_m, 0) * coalesce(new.pieces, 0),
           'scheduled',
           'Auto-created after production completion. Select/confirm packaging material before starting.',
           auth.uid()
    from public.packaging_materials pm
    where pm.company_id = new.company_id and pm.is_active = true
    order by pm.created_at asc
    limit 1
    on conflict (company_id, packaging_number) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists link_billets_to_production_job on public.production_jobs;
create trigger link_billets_to_production_job after insert or update of order_id, required_billet_count, status on public.production_jobs for each row execute function public.link_billets_to_production_job();

create or replace function public.refresh_packaging_job_material()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consumption numeric;
  v_stock numeric;
begin
  select consumption_per_profile_meter, current_stock into v_consumption, v_stock
  from public.packaging_materials
  where id = new.material_id and company_id = new.company_id;

  if not found then
    raise exception 'Packaging material not found for this company' using errcode = '23503';
  end if;

  if coalesce(new.profile_length_m, 0) = 0 and new.production_job_id is not null then
    select coalesce(length_per_piece_m, 0) * coalesce(pieces, 0), coalesce(actual_quantity_kg, planned_quantity_kg, 0), coalesce(pieces, 0)
    into new.profile_length_m, new.profile_weight_kg, new.pieces
    from public.production_jobs
    where id = new.production_job_id and company_id = new.company_id;
  end if;

  new.material_quantity_required := round((coalesce(new.profile_length_m, 0) * v_consumption)::numeric, 3);

  if tg_op = 'INSERT' and new.status <> 'cancelled' and v_stock < new.material_quantity_required then
    raise exception 'Not enough packaging material stock' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists refresh_packaging_job_material on public.packaging_jobs;
create trigger refresh_packaging_job_material before insert or update of material_id, production_job_id, profile_length_m, status on public.packaging_jobs for each row execute function public.refresh_packaging_job_material();

create or replace function public.apply_packaging_material_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta numeric := 0;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'cancelled' then v_delta := new.material_quantity_required; end if;
  elsif tg_op = 'UPDATE' then
    if old.status <> 'cancelled' then
      update public.packaging_materials set current_stock = current_stock + old.material_quantity_required, updated_at = now() where id = old.material_id and company_id = old.company_id;
      insert into public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by) values (old.company_id, old.id, old.material_id, 'restore', old.material_quantity_required, auth.uid());
    end if;
    if new.status <> 'cancelled' then v_delta := new.material_quantity_required; end if;
  end if;

  if v_delta > 0 then
    update public.packaging_materials set current_stock = current_stock - v_delta, updated_at = now() where id = new.material_id and company_id = new.company_id and current_stock >= v_delta;
    if not found then raise exception 'Not enough packaging material stock' using errcode = '23514'; end if;
    insert into public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by) values (new.company_id, new.id, new.material_id, 'issue', v_delta, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists apply_packaging_material_stock on public.packaging_jobs;
create trigger apply_packaging_material_stock after insert or update of material_id, material_quantity_required, status on public.packaging_jobs for each row execute function public.apply_packaging_material_stock();

alter table public.foundry_billets enable row level security;
alter table public.foundry_external_aluminium_sources enable row level security;
alter table public.foundry_aluminium_scrap enable row level security;
alter table public.production_efficiency_change_logs enable row level security;
alter table public.packaging_materials enable row level security;
alter table public.packaging_jobs enable row level security;
alter table public.packaging_material_movements enable row level security;

create index if not exists foundry_billets_company_order_idx on public.foundry_billets(company_id, order_id, status);
create index if not exists foundry_external_sources_company_status_idx on public.foundry_external_aluminium_sources(company_id, status, received_date desc);
create index if not exists foundry_scrap_company_status_idx on public.foundry_aluminium_scrap(company_id, status, received_date desc);
create index if not exists packaging_materials_company_stock_idx on public.packaging_materials(company_id, is_active, current_stock);
create index if not exists packaging_jobs_company_status_idx on public.packaging_jobs(company_id, status, scheduled_date desc);

drop trigger if exists set_foundry_billets_updated_at on public.foundry_billets;
create trigger set_foundry_billets_updated_at before update on public.foundry_billets for each row execute function public.set_updated_at();
drop trigger if exists set_external_sources_updated_at on public.foundry_external_aluminium_sources;
create trigger set_external_sources_updated_at before update on public.foundry_external_aluminium_sources for each row execute function public.set_updated_at();
drop trigger if exists set_foundry_scrap_updated_at on public.foundry_aluminium_scrap;
create trigger set_foundry_scrap_updated_at before update on public.foundry_aluminium_scrap for each row execute function public.set_updated_at();
drop trigger if exists set_packaging_materials_updated_at on public.packaging_materials;
create trigger set_packaging_materials_updated_at before update on public.packaging_materials for each row execute function public.set_updated_at();
drop trigger if exists set_packaging_jobs_updated_at on public.packaging_jobs;
create trigger set_packaging_jobs_updated_at before update on public.packaging_jobs for each row execute function public.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['foundry_billets','foundry_external_aluminium_sources','foundry_aluminium_scrap','production_efficiency_change_logs','packaging_materials','packaging_jobs','packaging_material_movements'] loop
    execute format('drop policy if exists "%s tenant read" on public.%I', t, t);
    execute format('create policy "%s tenant read" on public.%I for select using (company_id = public.get_current_user_company_id())', t, t);
  end loop;
end $$;

create policy "foundry external sources tenant insert" on public.foundry_external_aluminium_sources for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production'));
create policy "foundry external sources tenant update" on public.foundry_external_aluminium_sources for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production')) with check (company_id = public.get_current_user_company_id());
create policy "foundry scrap tenant insert" on public.foundry_aluminium_scrap for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production'));
create policy "foundry scrap tenant update" on public.foundry_aluminium_scrap for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production')) with check (company_id = public.get_current_user_company_id());
create policy "packaging materials tenant insert" on public.packaging_materials for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production','dispatch_manager','dispatch'));
create policy "packaging materials tenant update" on public.packaging_materials for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production','dispatch_manager','dispatch')) with check (company_id = public.get_current_user_company_id());
create policy "packaging jobs tenant insert" on public.packaging_jobs for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production','dispatch_manager','dispatch'));
create policy "packaging jobs tenant update" on public.packaging_jobs for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','production_manager','production','dispatch_manager','dispatch')) with check (company_id = public.get_current_user_company_id());
create policy "packaging movements tenant insert" on public.packaging_material_movements for insert with check (company_id = public.get_current_user_company_id());
