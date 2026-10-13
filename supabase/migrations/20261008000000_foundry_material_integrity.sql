begin;

-- Foundry batch source reservations are charged at planning time. This helper
-- applies only the difference between the previous and replacement charge.
create or replace function private.apply_foundry_source_delta(
  p_source_table text,
  p_company_id uuid,
  p_old_source_id uuid,
  p_old_kg numeric,
  p_new_source_id uuid,
  p_new_kg numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_old record;
  v_new record;
  v_debit numeric := 0;
  v_refund numeric := 0;
  v_refund_on_new numeric := 0;
  v_delta numeric := 0;
  v_rows integer;
begin
  if p_source_table not in ('foundry_aluminium_scrap', 'foundry_external_aluminium_sources') then
    raise exception 'Unsupported foundry source table';
  end if;
  if p_company_id is null then raise exception 'Foundry company is required'; end if;

  select array_agg(x order by x) into v_ids
  from (select distinct unnest(array[p_old_source_id, p_new_source_id]) as x) ids
  where x is not null;

  -- Lock both sides in the same order for every source switch.
  foreach v_id in array coalesce(v_ids, array[]::uuid[]) loop
    execute format('select 1 from public.%I where id = $1 for update', p_source_table)
      using v_id;
  end loop;

  if p_old_source_id is not null then
    execute format('select id, company_id, weight_kg, available_weight_kg, status from public.%I where id = $1', p_source_table)
      into v_old using p_old_source_id;
    if v_old.id is null or v_old.company_id is distinct from p_company_id then
      raise exception 'Previously selected foundry source does not belong to this company';
    end if;
  end if;

  if coalesce(p_new_kg, 0) > 0 and p_new_source_id is null then
    raise exception 'A same-company source is required for every positive foundry charge component';
  end if;

  if p_new_source_id is not null then
    execute format('select id, company_id, weight_kg, available_weight_kg, status from public.%I where id = $1', p_source_table)
      into v_new using p_new_source_id;
    if v_new.id is null or v_new.company_id is distinct from p_company_id then
      raise exception 'Selected foundry source does not belong to this company';
    end if;
    if coalesce(p_new_kg, 0) > 0
      and v_new.status not in ('available', 'reserved')
      and not (v_new.status = 'used' and p_new_source_id = p_old_source_id
        and coalesce(p_new_kg, 0) <= coalesce(p_old_kg, 0)) then
      raise exception 'Selected foundry source is not usable';
    end if;
  end if;

  if p_old_source_id is not null and coalesce(p_old_kg, 0) > 0 then
    if p_old_source_id = p_new_source_id then
      v_delta := coalesce(p_new_kg, 0) - coalesce(p_old_kg, 0);
      if v_delta > 0 then v_debit := v_delta; elsif v_delta < 0 then v_refund := -v_delta; end if;
    else
      v_refund := coalesce(p_old_kg, 0);
    end if;
  end if;
  if p_new_source_id is not null and p_new_source_id is distinct from p_old_source_id then
    v_debit := coalesce(p_new_kg, 0);
  elsif p_old_source_id is null then
    v_debit := coalesce(p_new_kg, 0);
  end if;

  if v_debit > 0 and (v_new.status not in ('available', 'reserved')
    or coalesce(v_new.available_weight_kg, v_new.weight_kg, 0) < v_debit) then
    raise exception 'Selected foundry source does not have enough usable available weight';
  end if;

  if p_old_source_id is not null and p_old_source_id is distinct from p_new_source_id and v_refund > 0 then
    execute format($sql$
      update public.%1$I
      set available_weight_kg = least(weight_kg, coalesce(available_weight_kg, weight_kg) + $2),
          status = case
            when status not in ('available','reserved','used') then status
            when least(weight_kg, coalesce(available_weight_kg, weight_kg) + $2) >= weight_kg then 'available'
            when least(weight_kg, coalesce(available_weight_kg, weight_kg) + $2) <= 0 then 'used'
            else 'reserved'
          end,
          updated_at = now()
      where id = $1 and company_id = $3
    $sql$, p_source_table) using p_old_source_id, v_refund, p_company_id;
  end if;

  if p_new_source_id is not null and (v_debit > 0 or (p_old_source_id = p_new_source_id and v_refund > 0)) then
    if p_old_source_id = p_new_source_id then v_refund_on_new := v_refund; end if;
    execute format($sql$
      update public.%1$I
      set available_weight_kg = coalesce(available_weight_kg, weight_kg) - $2 + $3,
          status = case
            when status not in ('available','reserved','used') then status
            when coalesce(available_weight_kg, weight_kg) - $2 + $3 <= 0 then 'used'
            when coalesce(available_weight_kg, weight_kg) - $2 + $3 >= weight_kg then 'available'
            else 'reserved'
          end,
          updated_at = now()
      where id = $1 and company_id = $4
    $sql$, p_source_table) using p_new_source_id, v_debit, v_refund_on_new, p_company_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'Selected foundry source changed during reservation'; end if;
  end if;
end;
$$;
revoke all on function private.apply_foundry_source_delta(text, uuid, uuid, numeric, uuid, numeric) from public, anon, authenticated;

create or replace function public.sync_foundry_scrap_usage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_old_id uuid;
  v_old_kg numeric;
  v_new_id uuid;
  v_new_kg numeric;
begin
  if tg_op = 'DELETE' then raise exception 'Foundry batches cannot be deleted; cancel a planned batch instead'; end if;
  v_old_id := case when tg_op = 'UPDATE' and old.status <> 'cancelled' then old.scrap_id end;
  v_old_kg := case when tg_op = 'UPDATE' and old.status <> 'cancelled' then old.scrap_aluminium_kg else 0 end;
  v_new_id := new.scrap_id;
  v_new_kg := case when new.status = 'cancelled' then 0 else new.scrap_aluminium_kg end;
  perform private.apply_foundry_source_delta('foundry_aluminium_scrap', new.company_id, v_old_id, v_old_kg, v_new_id, v_new_kg);
  return new;
end;
$$;
revoke all on function public.sync_foundry_scrap_usage() from public, anon, authenticated;

create or replace function public.sync_foundry_external_source_usage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_old_id uuid;
  v_old_kg numeric;
  v_new_id uuid;
  v_new_kg numeric;
begin
  if tg_op = 'DELETE' then raise exception 'Foundry batches cannot be deleted; cancel a planned batch instead'; end if;
  v_old_id := case when tg_op = 'UPDATE' and old.status <> 'cancelled' then old.external_source_id end;
  v_old_kg := case when tg_op = 'UPDATE' and old.status <> 'cancelled' then old.external_aluminium_kg else 0 end;
  v_new_id := new.external_source_id;
  v_new_kg := case when new.status = 'cancelled' then 0 else new.external_aluminium_kg end;
  perform private.apply_foundry_source_delta('foundry_external_aluminium_sources', new.company_id, v_old_id, v_old_kg, v_new_id, v_new_kg);
  return new;
end;
$$;
revoke all on function public.sync_foundry_external_source_usage() from public, anon, authenticated;

create or replace function public.guard_foundry_batch_material_integrity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_committed boolean;
  v_physical_changed boolean;
  v_rank_old integer;
  v_rank_new integer;
begin
  if tg_op = 'DELETE' then raise exception 'Foundry batches cannot be deleted; cancel a planned batch instead'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'planned' then raise exception 'New foundry batches must start as planned'; end if;
    if coalesce(new.scrap_percentage, 0) > 0 and coalesce(new.scrap_aluminium_kg, 0) > 0 and new.scrap_id is null then
      raise exception 'A same-company scrap source is required for a positive scrap charge';
    end if;
    if coalesce(new.external_aluminium_percentage, 0) > 0 and coalesce(new.external_aluminium_kg, 0) > 0 and new.external_source_id is null then
      raise exception 'A same-company external source is required for a positive external-aluminium charge';
    end if;
    return new;
  end if;

  if old.id is distinct from new.id or old.company_id is distinct from new.company_id then raise exception 'Foundry batch identity is immutable'; end if;
  if old.status = 'cancelled' then raise exception 'Cancelled foundry batches are immutable'; end if;
  if coalesce(new.scrap_percentage, 0) > 0 and coalesce(new.scrap_aluminium_kg, 0) > 0 and new.scrap_id is null then
    raise exception 'A same-company scrap source is required for a positive scrap charge';
  end if;
  if coalesce(new.external_aluminium_percentage, 0) > 0 and coalesce(new.external_aluminium_kg, 0) > 0 and new.external_source_id is null then
    raise exception 'A same-company external source is required for a positive external-aluminium charge';
  end if;

  select exists (
    select 1 from public.foundry_billets b
    where b.company_id = old.company_id and b.foundry_batch_id = old.id and b.source_type = 'in_house'
      and (b.status in ('allocated','issued','consumed','scrap') or b.order_id is not null
        or b.allocation_requirement_id is not null or b.production_job_id is not null
        or b.allocated_at is not null or b.allocated_by is not null)
  ) into v_committed;

  v_physical_changed := row(
    old.scrap_id, old.external_source_id, old.scrap_percentage, old.external_aluminium_percentage,
    old.furnace_efficiency_percent, old.alloy, old.temper, old.alloy_density_kg_m3,
    old.billet_length_mm, old.billet_diameter_inch, old.billet_diameter_mm, old.billet_count,
    old.production_date, old.furnace_number, old.furnace_name, old.batch_sequence,
    old.alloy_composition_default, old.alloy_composition_actual, old.alloy_composition_altered
  ) is distinct from row(
    new.scrap_id, new.external_source_id, new.scrap_percentage, new.external_aluminium_percentage,
    new.furnace_efficiency_percent, new.alloy, new.temper, new.alloy_density_kg_m3,
    new.billet_length_mm, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_count,
    new.production_date, new.furnace_number, new.furnace_name, new.batch_sequence,
    new.alloy_composition_default, new.alloy_composition_actual, new.alloy_composition_altered
  );

  if v_committed and v_physical_changed then
    raise exception 'Foundry batch material is committed; physical, source, mix, and count fields are immutable';
  end if;
  if old.status <> 'planned' and v_physical_changed then
    raise exception 'Foundry batch physical, source, mix, and count fields freeze after planning';
  end if;

  if new.status = 'cancelled' then
    if old.status <> 'planned' or v_committed then
      raise exception 'Only an uncommitted planned foundry batch can be cancelled';
    end if;
    return new;
  end if;

  v_rank_old := case old.status when 'planned' then 0 when 'melting' then 1 when 'cast' then 2 when 'homogenizing' then 3 when 'ready' then 4 when 'issued' then 5 else -1 end;
  v_rank_new := case new.status when 'planned' then 0 when 'melting' then 1 when 'cast' then 2 when 'homogenizing' then 3 when 'ready' then 4 when 'issued' then 5 else -1 end;
  if v_rank_new < v_rank_old then raise exception 'Foundry batch status cannot regress'; end if;

  if new.billet_count < old.billet_count then
    if old.status <> 'planned' or v_committed then
      raise exception 'Billet count cannot shrink after material commitment';
    end if;
    if exists (
      select 1 from public.foundry_billets b
      where b.company_id = old.company_id and b.foundry_batch_id = old.id and b.source_type = 'in_house'
        and b.billet_number > new.billet_count
        and (b.status not in ('planned','cancelled') or b.order_id is not null or b.allocation_requirement_id is not null
          or b.production_job_id is not null or b.allocated_at is not null or b.allocated_by is not null)
    ) then raise exception 'Surplus billets are allocated or otherwise committed and cannot be cancelled'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_foundry_batch_material_integrity() from public, anon, authenticated;

create or replace function public.sync_foundry_billets()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  i integer;
  v_code text;
  v_status text;
  v_order_ids uuid[];
  v_order_id uuid;
begin
  if new.status = 'cancelled' then
    update public.foundry_billets
    set status = 'cancelled', updated_at = now()
    where company_id = new.company_id and foundry_batch_id = new.id and source_type = 'in_house'
      and status = 'planned' and order_id is null and allocation_requirement_id is null and production_job_id is null;
    return new;
  end if;

  v_status := case when new.status in ('cast','homogenizing','ready','issued') then 'cast' else 'planned' end;
  for i in 1..new.billet_count loop
    v_code := concat(new.furnace_number, '-', to_char(new.production_date, 'YYYYMMDD'), '-', new.batch_sequence::text, '-', i::text);
    insert into public.foundry_billets (company_id, source_type, foundry_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status)
    values (new.company_id, 'in_house', new.id, v_code, i, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_length_mm, new.alloy, new.temper, new.billet_weight_density_kg, v_status)
    on conflict (foundry_batch_id, billet_number) where source_type = 'in_house' do update set
      billet_code = excluded.billet_code,
      billet_diameter_inch = excluded.billet_diameter_inch,
      billet_diameter_mm = excluded.billet_diameter_mm,
      billet_length_mm = excluded.billet_length_mm,
      alloy = excluded.alloy,
      temper = excluded.temper,
      weight_kg = excluded.weight_kg,
      status = case when public.foundry_billets.status in ('allocated','issued','consumed','scrap') then public.foundry_billets.status else excluded.status end,
      updated_at = now();
  end loop;

  update public.foundry_billets
  set status = 'cancelled', updated_at = now()
  where company_id = new.company_id and foundry_batch_id = new.id and source_type = 'in_house'
    and billet_number > new.billet_count and status = 'planned'
    and order_id is null and allocation_requirement_id is null and production_job_id is null
    and allocated_at is null and allocated_by is null;
  if (select count(*) from public.foundry_billets b where b.company_id = new.company_id
      and b.foundry_batch_id = new.id and b.source_type = 'in_house' and b.status <> 'cancelled') <> new.billet_count then
    raise exception 'Active in-house billet count must equal the accepted batch count';
  end if;
  return new;
end;
$$;
revoke all on function public.sync_foundry_billets() from public, anon, authenticated;

create or replace function public.guard_foundry_billet_material_integrity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_batch public.foundry_batches%rowtype;
  v_physical_changed boolean;
  v_new_rank integer;
  v_old_rank integer;
begin
  if tg_op = 'DELETE' then
    if old.source_type = 'in_house' then raise exception 'In-house billet records cannot be deleted'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (old.id is distinct from new.id or old.company_id is distinct from new.company_id
    or old.source_type is distinct from new.source_type or old.foundry_batch_id is distinct from new.foundry_batch_id
    or old.billet_number is distinct from new.billet_number) then
    raise exception 'Billet identity and batch lineage are immutable';
  end if;
  if new.source_type <> 'in_house' then return new; end if;
  if pg_trigger_depth() < 2 and (tg_op = 'INSERT' or old.weight_kg is distinct from new.weight_kg
    or old.billet_diameter_inch is distinct from new.billet_diameter_inch or old.billet_diameter_mm is distinct from new.billet_diameter_mm
    or old.billet_length_mm is distinct from new.billet_length_mm or old.alloy is distinct from new.alloy or old.temper is distinct from new.temper) then
    raise exception 'In-house billet physical attributes are maintained only by the batch calculation';
  end if;

  begin
    select * into v_batch from public.foundry_batches
    where id = new.foundry_batch_id and company_id = new.company_id
    for share nowait;
  exception when lock_not_available then
    raise exception 'Foundry batch is being changed; retry billet update' using errcode = '55P03';
  end;
  if not found then raise exception 'Foundry batch does not belong to this company'; end if;

  if new.billet_code is distinct from concat(v_batch.furnace_number, '-', to_char(v_batch.production_date, 'YYYYMMDD'), '-', v_batch.batch_sequence::text, '-', new.billet_number::text)
    or (tg_op = 'UPDATE' and old.billet_code is distinct from new.billet_code and pg_trigger_depth() < 2) then
    raise exception 'In-house billet code must match its batch identity';
  end if;
  if new.billet_number > v_batch.billet_count and new.status <> 'cancelled'
    or new.billet_diameter_inch is distinct from v_batch.billet_diameter_inch
    or new.billet_diameter_mm is distinct from v_batch.billet_diameter_mm
    or new.billet_length_mm is distinct from v_batch.billet_length_mm
    or new.alloy is distinct from v_batch.alloy or new.temper is distinct from v_batch.temper
    or new.weight_kg is distinct from v_batch.billet_weight_density_kg then
    raise exception 'In-house billet attributes and active number must match the calculated parent batch';
  end if;

  v_physical_changed := tg_op = 'UPDATE' and row(old.weight_kg, old.billet_diameter_inch, old.billet_diameter_mm,
    old.billet_length_mm, old.alloy, old.temper) is distinct from row(new.weight_kg, new.billet_diameter_inch,
    new.billet_diameter_mm, new.billet_length_mm, new.alloy, new.temper);
  if v_physical_changed and (v_batch.status <> 'planned'
    or (old.status <> 'planned' and not (old.status = 'cancelled' and new.status = 'planned'
      and new.billet_number <= v_batch.billet_count and pg_trigger_depth() >= 2))
    or old.order_id is not null or old.allocation_requirement_id is not null or old.production_job_id is not null) then
    raise exception 'Committed billet physical attributes are immutable';
  end if;
  if v_batch.status in ('planned','melting') and new.status in ('cast','allocated','issued','consumed','scrap') then
    raise exception 'Billets cannot become usable before the parent batch is cast';
  end if;
  if tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'cast' and pg_trigger_depth() < 2 then
    raise exception 'Cast stock status is maintained only by the batch workflow';
  end if;
  if tg_op = 'UPDATE' then
    v_old_rank := case old.status when 'planned' then 0 when 'cast' then 1 when 'allocated' then 2 when 'issued' then 3 when 'consumed' then 4 when 'scrap' then 4 when 'cancelled' then 5 else -1 end;
    v_new_rank := case new.status when 'planned' then 0 when 'cast' then 1 when 'allocated' then 2 when 'issued' then 3 when 'consumed' then 4 when 'scrap' then 4 when 'cancelled' then 5 else -1 end;
    if v_new_rank < v_old_rank and not (old.status = 'allocated' and new.status = 'cast'
      and new.order_id is null and new.allocation_requirement_id is null and new.production_job_id is null)
      and not (old.status = 'cancelled' and v_batch.status = 'planned' and new.status = 'planned'
        and new.order_id is null and new.allocation_requirement_id is null and new.production_job_id is null
        and new.billet_number <= v_batch.billet_count and pg_trigger_depth() >= 2) then
      raise exception 'Committed billet status cannot regress';
    end if;
    if old.status in ('issued','consumed','scrap') and (
      old.order_id is distinct from new.order_id or old.allocation_requirement_id is distinct from new.allocation_requirement_id
      or old.production_job_id is distinct from new.production_job_id or old.allocated_at is distinct from new.allocated_at
      or old.allocated_by is distinct from new.allocated_by
    ) then raise exception 'Issued and consumed billet lineage is immutable'; end if;
    if old.status in ('consumed','scrap') and old.status is distinct from new.status then
      raise exception 'Consumed or scrapped billet status is terminal';
    end if;
    if old.status = 'cancelled' and new.status <> 'cancelled' and not (v_batch.status = 'planned'
      and new.status = 'planned' and new.order_id is null and new.allocation_requirement_id is null
      and new.production_job_id is null and new.billet_number <= v_batch.billet_count and pg_trigger_depth() >= 2) then
      raise exception 'Cancelled billet can only be restored by expanding its planned batch';
    end if;
  end if;
  if new.status = 'cancelled' and (new.order_id is not null or new.allocation_requirement_id is not null or new.production_job_id is not null) then
    raise exception 'Linked billets cannot be cancelled';
  end if;
  if new.status = 'allocated' and (new.order_id is null or new.allocation_requirement_id is null
    or new.allocated_at is null or new.allocated_by is null) then
    raise exception 'Allocated billets require complete order and allocation lineage';
  end if;
  if new.status in ('issued','consumed') and (new.order_id is null or new.production_job_id is null) then
    raise exception 'Issued or consumed billets require order and production-job lineage';
  end if;
  if new.status = 'cancelled' and not (pg_trigger_depth() >= 2
    and ((v_batch.status = 'cancelled' and old.status = 'planned')
      or (v_batch.status = 'planned' and old.status = 'planned' and new.billet_number > v_batch.billet_count))) then
    raise exception 'Billet cancellation must be performed by its planned batch';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_foundry_billet_material_integrity() from public, anon, authenticated;

drop trigger if exists sync_foundry_scrap_usage on public.foundry_batches;
drop trigger if exists sync_foundry_external_source_usage on public.foundry_batches;
drop trigger if exists sync_foundry_billets on public.foundry_batches;
drop trigger if exists refresh_foundry_batch_calculations on public.foundry_batches;
create trigger refresh_foundry_batch_calculations before insert or update on public.foundry_batches
for each row execute function public.refresh_foundry_batch_calculations();
create trigger sync_foundry_external_source_usage before insert or update on public.foundry_batches
for each row execute function public.sync_foundry_external_source_usage();
create trigger sync_foundry_scrap_usage before insert or update on public.foundry_batches
for each row execute function public.sync_foundry_scrap_usage();
drop trigger if exists s_foundry_batch_material_integrity on public.foundry_batches;
create trigger s_foundry_batch_material_integrity before insert or update or delete on public.foundry_batches
for each row execute function public.guard_foundry_batch_material_integrity();
create trigger sync_foundry_billets after insert or update on public.foundry_batches
for each row execute function public.sync_foundry_billets();

drop trigger if exists guard_foundry_billet_material_integrity on public.foundry_billets;
create trigger guard_foundry_billet_material_integrity before insert or update or delete on public.foundry_billets
for each row execute function public.guard_foundry_billet_material_integrity();

commit;
