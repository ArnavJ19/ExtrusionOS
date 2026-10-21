-- EXOS-AUD-004: editing an outsourced billet receipt rewrote billets that were
-- already allocated, issued or consumed, and reducing the count or cancelling the
-- receipt left the surplus billets in allocatable stock.
--
-- In-house billets are protected by guard_foundry_billet_material_integrity, which
-- returns early for outsourced billets. This migration adds the equivalent rules
-- for outsourced receipts:
--   * A receipt edit may not change the alloy, temper, size or per-billet weight of
--     any committed billet (allocated / issued / consumed / scrap, or linked to an
--     order, requirement or job), and may not drop a committed billet number above
--     the new count. Corrections to committed metal need a new receipt.
--   * Uncommitted billets above a reduced count are cancelled, and are restored to
--     stock if the count is raised again.
--   * Cancelling a receipt cancels all of its uncommitted billets, and is rejected
--     while any billet is committed. A cancelled receipt is terminal.
--   * Outsourced billets keep their physical attributes once committed, and a
--     linked billet can never be cancelled.
-- Existing rows are not rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.outsourced_billet_is_committed(p_billet public.foundry_billets)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p_billet.status in ('allocated','issued','consumed','scrap')
    or p_billet.order_id is not null
    or p_billet.allocation_requirement_id is not null
    or p_billet.production_job_id is not null
$$;
revoke all on function private.outsourced_billet_is_committed(public.foundry_billets) from public, anon, authenticated;

-- BEFORE UPDATE on the receipt: reject edits that would rewrite committed metal.
create or replace function private.guard_outsourced_billet_receipt()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_weight_per_billet numeric;
  v_conflict integer;
begin
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'A cancelled outsourced billet receipt cannot be reopened; record a new receipt' using errcode = '23514';
  end if;
  if old.status = 'cancelled' and row(new.alloy, new.temper, new.billet_count, new.billet_diameter_inch, new.billet_diameter_mm,
      new.billet_length_mm, new.weight_kg) is distinct from row(old.alloy, old.temper, old.billet_count, old.billet_diameter_inch,
      old.billet_diameter_mm, old.billet_length_mm, old.weight_kg) then
    raise exception 'A cancelled outsourced billet receipt cannot be changed' using errcode = '23514';
  end if;

  -- Lock the receipt's billets so allocation cannot commit one while this check runs.
  perform 1 from public.foundry_billets b
  where b.outsourced_batch_id = old.id and b.company_id = old.company_id and b.source_type = 'outsourced'
  for update;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    select count(*) into v_conflict from public.foundry_billets b
    where b.outsourced_batch_id = old.id and b.company_id = old.company_id and b.source_type = 'outsourced'
      and private.outsourced_billet_is_committed(b);
    if v_conflict > 0 then
      raise exception 'Cannot cancel this receipt: % billet(s) are already allocated, issued or consumed', v_conflict using errcode = '23514';
    end if;
  end if;

  if row(new.alloy, new.temper, new.billet_count, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_length_mm, new.weight_kg)
     is not distinct from row(old.alloy, old.temper, old.billet_count, old.billet_diameter_inch, old.billet_diameter_mm, old.billet_length_mm, old.weight_kg) then
    return new;
  end if;

  v_weight_per_billet := round((new.weight_kg / nullif(new.billet_count, 0))::numeric, 3);
  select count(*) into v_conflict from public.foundry_billets b
  where b.outsourced_batch_id = old.id and b.company_id = old.company_id and b.source_type = 'outsourced'
    and private.outsourced_billet_is_committed(b)
    and (b.billet_number > new.billet_count
      or b.alloy is distinct from new.alloy or b.temper is distinct from new.temper
      or b.billet_diameter_inch is distinct from new.billet_diameter_inch
      or b.billet_diameter_mm is distinct from new.billet_diameter_mm
      or b.billet_length_mm is distinct from new.billet_length_mm
      or b.weight_kg is distinct from v_weight_per_billet);
  if v_conflict > 0 then
    raise exception 'Receipt edit would change % committed billet(s); alloy, temper, size, per-billet weight and count of allocated, issued or consumed billets are frozen. Record a correcting receipt instead.', v_conflict
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_outsourced_billet_receipt() from public, anon, authenticated;

drop trigger if exists guard_outsourced_billet_receipt on public.outsourced_billet_batches;
create trigger guard_outsourced_billet_receipt
before update on public.outsourced_billet_batches
for each row execute function private.guard_outsourced_billet_receipt();

-- Sync: create/refresh billets up to the count, never touch committed billets,
-- cancel uncommitted surplus, and cancel all uncommitted billets of a cancelled receipt.
create or replace function public.sync_outsourced_billets()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  i integer;
  v_code text;
  v_weight_per_billet numeric;
begin
  if new.status = 'cancelled' then
    update public.foundry_billets b
    set status = 'cancelled', updated_at = now()
    where b.outsourced_batch_id = new.id and b.company_id = new.company_id and b.source_type = 'outsourced'
      and b.status <> 'cancelled' and not private.outsourced_billet_is_committed(b);
    return new;
  end if;
  if coalesce(new.billet_count, 0) > 0 then
    v_weight_per_billet := round((new.weight_kg / new.billet_count)::numeric, 3);
    for i in 1..new.billet_count loop
      v_code := concat('OUT-', new.batch_number, '-', i::text);
      insert into public.foundry_billets as existing (company_id, source_type, outsourced_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status)
      values (new.company_id, 'outsourced', new.id, v_code, i, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_length_mm, new.alloy, new.temper, v_weight_per_billet, 'cast')
      on conflict (outsourced_batch_id, billet_number) where source_type = 'outsourced' do update set
        billet_code = excluded.billet_code,
        billet_diameter_inch = excluded.billet_diameter_inch,
        billet_diameter_mm = excluded.billet_diameter_mm,
        billet_length_mm = excluded.billet_length_mm,
        alloy = excluded.alloy,
        temper = excluded.temper,
        weight_kg = excluded.weight_kg,
        status = excluded.status,
        updated_at = now()
      where not private.outsourced_billet_is_committed(existing);
    end loop;
    update public.foundry_billets b
    set status = 'cancelled', updated_at = now()
    where b.outsourced_batch_id = new.id and b.company_id = new.company_id and b.source_type = 'outsourced'
      and b.billet_number > new.billet_count and b.status <> 'cancelled'
      and not private.outsourced_billet_is_committed(b);
  end if;
  return new;
end;
$function$;

drop trigger if exists sync_outsourced_billets on public.outsourced_billet_batches;
create trigger sync_outsourced_billets
after insert or update of received_date, batch_number, billet_count, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status
on public.outsourced_billet_batches
for each row execute function public.sync_outsourced_billets();

-- Defense in depth on the billet rows themselves (any writer).
create or replace function private.guard_outsourced_billet_commitment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.source_type <> 'outsourced' then return new; end if;
  if private.outsourced_billet_is_committed(old)
    and row(new.alloy, new.temper, new.billet_diameter_inch, new.billet_diameter_mm, new.billet_length_mm, new.weight_kg)
      is distinct from row(old.alloy, old.temper, old.billet_diameter_inch, old.billet_diameter_mm, old.billet_length_mm, old.weight_kg) then
    raise exception 'Committed outsourced billet physical attributes are immutable' using errcode = '23514';
  end if;
  if new.status = 'cancelled' and (new.order_id is not null or new.allocation_requirement_id is not null or new.production_job_id is not null) then
    raise exception 'Linked billets cannot be cancelled' using errcode = '23514';
  end if;
  if old.status in ('consumed','scrap') and new.status is distinct from old.status then
    raise exception 'Consumed or scrapped billet status is terminal' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_outsourced_billet_commitment() from public, anon, authenticated;

drop trigger if exists guard_outsourced_billet_commitment on public.foundry_billets;
create trigger guard_outsourced_billet_commitment
before update on public.foundry_billets
for each row execute function private.guard_outsourced_billet_commitment();

commit;
