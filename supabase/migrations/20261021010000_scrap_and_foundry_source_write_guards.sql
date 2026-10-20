-- EXOS-AUD-002 / EXOS-AUD-003: foundry metal can no longer be created or
-- re-released by direct table writes.
--
-- 002: scrap_records accepted inserts from any company user, and an
--      after-insert trigger turned process scrap into clean, available foundry
--      metal. Production scrap is now written only by the audited completion
--      workflow (SECURITY DEFINER), and the recovery trigger requires its job link.
-- 003: foundry_aluminium_scrap / foundry_external_aluminium_sources availability
--      was a freely writable column. Outside the charge writer
--      (private.apply_foundry_source_delta, reached only through foundry batch
--      triggers) availability now moves only with a received-weight correction,
--      can never fall below zero, and the available/reserved/used status follows
--      the balance. Manual 'rejected' / 'returned' holds remain available.
--
-- Existing rows are not rewritten. The new CHECK is added NOT VALID; reconcile
-- historical balances before validating it.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 002: close the direct insert path; the completion RPC writes as definer.
drop policy if exists "scrap_records tenant insert" on public.scrap_records;
revoke insert, update, delete, truncate on public.scrap_records from anon, authenticated;

create or replace function public.sync_process_scrap_to_foundry()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(new.scrap_type, '') = 'process_scrap' and coalesce(new.weight_kg, 0) > 0 then
    if new.production_job_id is null or not exists (
      select 1 from public.production_jobs job
      where job.id = new.production_job_id and job.company_id = new.company_id
    ) then
      raise exception 'Recoverable process scrap must come from a production job of this company'
        using errcode = '23514';
    end if;
    insert into public.foundry_aluminium_scrap (
      company_id, scrap_number, scrap_source, weight_kg, available_weight_kg,
      scrap_quality, status, received_date, origin_reference, created_by
    ) values (
      new.company_id,
      private.next_business_number_locked('public.foundry_aluminium_scrap'::regclass, 'scrap_number', new.company_id, 'SCR', current_date),
      'in_house',
      new.weight_kg,
      new.weight_kg,
      'clean',
      'available',
      coalesce(new.recorded_date, current_date),
      concat('Process scrap from production job ', new.production_job_id::text),
      new.recorded_by
    );
  end if;
  return new;
end;
$$;

-- 003: availability is owned by the charge ledger, not by the editing user.
create or replace function private.guard_foundry_source_balance()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_available numeric;
begin
  -- Nested writers: the batch charge/refund writer and the source's own
  -- expense/inventory synchronisation. None of them takes client values.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.status, 'available') not in ('available', 'rejected') then
      raise exception 'A new metal source must start as available or rejected' using errcode = '23514';
    end if;
    new.available_weight_kg := new.weight_kg;
    return new;
  end if;

  if new.id is distinct from old.id or new.company_id is distinct from old.company_id then
    raise exception 'Metal source identity is immutable' using errcode = '23514';
  end if;

  -- Client-supplied availability is ignored; only a received-weight correction moves it.
  v_available := coalesce(old.available_weight_kg, old.weight_kg) + (new.weight_kg - old.weight_kg);
  if v_available < 0 then
    raise exception 'Received weight % kg is below the % kg already charged to furnace batches',
      new.weight_kg, old.weight_kg - coalesce(old.available_weight_kg, old.weight_kg)
      using errcode = '23514';
  end if;
  new.available_weight_kg := v_available;

  if new.status not in ('rejected', 'returned') then
    new.status := case
      when v_available >= new.weight_kg then 'available'
      when v_available <= 0 then 'used'
      else 'reserved'
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_foundry_source_balance() from public, anon, authenticated;

drop trigger if exists a_guard_foundry_source_balance on public.foundry_aluminium_scrap;
create trigger a_guard_foundry_source_balance
  before insert or update on public.foundry_aluminium_scrap
  for each row execute function private.guard_foundry_source_balance();

drop trigger if exists a_guard_foundry_source_balance on public.foundry_external_aluminium_sources;
create trigger a_guard_foundry_source_balance
  before insert or update on public.foundry_external_aluminium_sources
  for each row execute function private.guard_foundry_source_balance();

alter table public.foundry_aluminium_scrap
  add constraint foundry_scrap_available_within_weight
  check (available_weight_kg is null or available_weight_kg <= weight_kg) not valid;
alter table public.foundry_external_aluminium_sources
  add constraint foundry_external_available_within_weight
  check (available_weight_kg is null or available_weight_kg <= weight_kg) not valid;

commit;
