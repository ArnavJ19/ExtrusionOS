-- Defect found by the Wave 2 regression gate (not in the original audit):
-- private.apply_foundry_source_delta read v_new.status even when no source of that
-- type was selected, so any furnace batch charged from only scrap or only external
-- aluminium failed with "record v_new is not assigned yet". The availability check is
-- now nested under a positive debit with a selected source. Behaviour is otherwise
-- unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

CREATE OR REPLACE FUNCTION private.apply_foundry_source_delta(p_source_table text, p_company_id uuid, p_old_source_id uuid, p_old_kg numeric, p_new_source_id uuid, p_new_kg numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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

  -- Nested so v_new is only read when a source was selected (a batch charged from one
  -- source type otherwise failed with "record v_new is not assigned yet").
  if v_debit > 0 then
    if p_new_source_id is null then
      raise exception 'A same-company source is required for every positive foundry charge component';
    end if;
    if v_new.status not in ('available', 'reserved')
      or coalesce(v_new.available_weight_kg, v_new.weight_kg, 0) < v_debit then
      raise exception 'Selected foundry source does not have enough usable available weight';
    end if;
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
$function$;

commit;
