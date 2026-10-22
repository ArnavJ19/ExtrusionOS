alter table public.packaging_jobs alter column material_id drop not null;

alter table public.packaging_materials add column if not exists calculation_method text not null default 'per_profile_meter';
alter table public.packaging_materials add column if not exists consumption_rate numeric(12,3);

update public.packaging_materials
set consumption_rate = coalesce(consumption_rate, consumption_per_profile_meter, 1)
where consumption_rate is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'packaging_materials_calculation_method_check') then
    alter table public.packaging_materials add constraint packaging_materials_calculation_method_check
      check (calculation_method in ('per_profile_meter','per_piece','per_kg','fixed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'packaging_materials_consumption_rate_positive') then
    alter table public.packaging_materials add constraint packaging_materials_consumption_rate_positive
      check (consumption_rate is not null and consumption_rate > 0);
  end if;
end $$;

create or replace function public.refresh_packaging_job_material()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_method text;
  v_rate numeric;
  v_stock numeric;
begin
  if coalesce(new.profile_length_m, 0) = 0 and new.production_job_id is not null then
    select coalesce(length_per_piece_m, 0) * coalesce(pieces, 0), coalesce(actual_quantity_kg, planned_quantity_kg, 0), coalesce(pieces, 0)
    into new.profile_length_m, new.profile_weight_kg, new.pieces
    from public.production_jobs
    where id = new.production_job_id and company_id = new.company_id;
  end if;

  if new.material_id is null then
    new.material_quantity_required := 0;
    return new;
  end if;

  select calculation_method, consumption_rate, current_stock
  into v_method, v_rate, v_stock
  from public.packaging_materials
  where id = new.material_id and company_id = new.company_id and is_active = true;

  if not found then
    raise exception 'Active packaging material not found for this company' using errcode = '23503';
  end if;

  new.material_quantity_required := round((case v_method
    when 'per_piece' then coalesce(new.pieces, 0) * v_rate
    when 'per_kg' then coalesce(new.profile_weight_kg, 0) * v_rate
    when 'fixed' then v_rate
    else coalesce(new.profile_length_m, 0) * v_rate
  end)::numeric, 3);

  if tg_op = 'INSERT' and new.status <> 'cancelled' and v_stock < new.material_quantity_required then
    raise exception 'Not enough packaging material stock' using errcode = '23514';
  end if;

  return new;
end;
$$;

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
    if new.status <> 'cancelled' and new.material_id is not null and new.material_quantity_required > 0 then
      v_delta := new.material_quantity_required;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status <> 'cancelled' and old.material_id is not null and old.material_quantity_required > 0 then
      update public.packaging_materials
      set current_stock = current_stock + old.material_quantity_required,
          updated_at = now()
      where id = old.material_id and company_id = old.company_id;

      insert into public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
      values (old.company_id, old.id, old.material_id, 'restore', old.material_quantity_required, auth.uid());
    end if;

    if new.status <> 'cancelled' and new.material_id is not null and new.material_quantity_required > 0 then
      v_delta := new.material_quantity_required;
    end if;
  end if;

  if v_delta > 0 then
    update public.packaging_materials
    set current_stock = current_stock - v_delta,
        updated_at = now()
    where id = new.material_id
      and company_id = new.company_id
      and current_stock >= v_delta;

    if not found then
      raise exception 'Not enough packaging material stock' using errcode = '23514';
    end if;

    insert into public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
    values (new.company_id, new.id, new.material_id, 'issue', v_delta, auth.uid());
  end if;

  return new;
end;
$$;

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
    values (
      new.company_id,
      concat('PKG-', to_char(now(), 'YYYY'), '-', substring(new.id::text, 1, 8)),
      new.order_id,
      new.id,
      null,
      current_date,
      coalesce(new.pieces, 0),
      coalesce(new.actual_quantity_kg, new.planned_quantity_kg, 0),
      coalesce(new.length_per_piece_m, 0) * coalesce(new.pieces, 0),
      'scheduled',
      'Auto-created after production completion. Select packaging material to issue stock.',
      auth.uid()
    )
    on conflict (company_id, packaging_number) do nothing;
  end if;
  return new;
end;
$$;
