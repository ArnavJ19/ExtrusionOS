-- Billet & scrap stock-integrity hardening (from the material-flow audit).
--
-- H1: When a foundry batch's billet_count is reduced, the existing sync_foundry_billets
--     trigger only upserts billets 1..count and never removes the now-surplus billets
--     (billet_number > count), leaving phantom stock that priority allocation can hand to
--     other orders. This adds a reconcile trigger that (a) blocks a reduction that would
--     orphan already-committed billets and (b) deletes surplus uncommitted billets.
-- M1: sync_foundry_scrap_usage decremented scrap available weight without checking the
--     scrap status, so a 'rejected'/contaminated batch could still be charged into a heat.
--     This adds the same status guard the external-source trigger already uses.
--
-- NOTE: these are additive (a new trigger + a redefined small trigger function); no data
-- is dropped. They MUST still be verified against a live database before production, since
-- stock triggers cannot be exercised by the local test suite.

-- H1 ---------------------------------------------------------------------------
create or replace function public.reconcile_foundry_billet_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never orphan billets that are already committed downstream.
  if exists (
    select 1 from public.foundry_billets
    where foundry_batch_id = new.id
      and company_id = new.company_id
      and billet_number > new.billet_count
      and status in ('allocated', 'issued', 'consumed')
  ) then
    raise exception 'Cannot reduce billet count: billets beyond the new count are already allocated, issued, or consumed';
  end if;

  -- Remove now-surplus uncommitted billets so on-hand stock is not over-counted.
  delete from public.foundry_billets
  where foundry_batch_id = new.id
    and company_id = new.company_id
    and billet_number > new.billet_count
    and status in ('cast', 'cancelled', 'scrap');

  return new;
end;
$$;

drop trigger if exists reconcile_foundry_billet_count on public.foundry_batches;
create trigger reconcile_foundry_billet_count
  after insert or update on public.foundry_batches
  for each row execute function public.reconcile_foundry_billet_count();

-- M1 ---------------------------------------------------------------------------
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
    -- M2: reversing a consumption frees the scrap again. Restore it to 'available' (weight is
    -- credited back and capped at the batch weight) unless it is terminally 'rejected', instead
    -- of leaving a partially-consumed batch stuck at 'reserved'/'used'.
    update public.foundry_aluminium_scrap
    set available_weight_kg = least(coalesce(available_weight_kg, weight_kg) + coalesce(old.scrap_aluminium_kg, 0), weight_kg),
        status = case when status = 'rejected' then 'rejected' else 'available' end,
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
      and status in ('available', 'reserved')
      and coalesce(available_weight_kg, weight_kg) >= new.scrap_aluminium_kg;

    if not found then
      raise exception 'Selected scrap batch is not available or does not have enough weight to charge';
    end if;
  end if;

  return new;
end;
$$;
