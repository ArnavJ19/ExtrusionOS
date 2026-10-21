-- EXOS-AUD-013 and EXOS-AUD-024: finished-goods stock batches carried no
-- production, alloy, QC or origin, could be typed in with any weight, and the
-- dealer entry route always failed (it posted a non-existent "notes" column and
-- treated length_m as a per-piece length while the database treats it as the
-- batch's total metres).
--
--   * profile_stock_batches gains origin_type, production_job_id,
--     packaging_job_id, source_dispatch_id, alloy, temper, qc_status,
--     qc_released_by/at, origin_reference, piece_length_m and notes.
--   * Factory users can no longer insert stock batches directly. Batches come from
--       public.create_stock_from_production_surplus  (QC-released output of a
--         completed job that was not shipped; alloy/temper from the job)
--       public.record_opening_stock_batch            (owner/admin, with a reason;
--         starts on QC hold)
--       the return-disposition workflow               (EXOS-AUD-016)
--     Dealers may still record their own stock (origin 'dealer_manual').
--   * Reconciliation: pieces x piece length x section kg/m must be within 10% of
--     the batch weight when the profile has a section weight.
--   * Quality hold: stock that is on hold or rejected cannot be reserved or used
--     for dealer fulfilment; public.release_stock_batch_qc releases or rejects it
--     (owner, admin, quality, factory_manager).
-- The hosted database had 0 stock batches when this was written; any legacy
-- rows are labelled origin 'legacy_unverified' and stay usable.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.profile_stock_batches
  add column if not exists origin_type text,
  add column if not exists production_job_id uuid references public.production_jobs(id) on delete restrict,
  add column if not exists packaging_job_id uuid references public.packaging_jobs(id) on delete set null,
  add column if not exists source_dispatch_id uuid references public.dispatches(id) on delete restrict,
  add column if not exists alloy text,
  add column if not exists temper text,
  add column if not exists qc_status text,
  add column if not exists qc_released_by uuid references auth.users(id),
  add column if not exists qc_released_at timestamptz,
  add column if not exists origin_reference text,
  add column if not exists piece_length_m numeric(10,3),
  add column if not exists notes text;
update public.profile_stock_batches set origin_type = coalesce(origin_type, case when dealer_id is not null then 'dealer_manual' else 'legacy_unverified' end),
  qc_status = coalesce(qc_status, case when dealer_id is not null then 'not_required' else 'released' end)
where origin_type is null or qc_status is null;
alter table public.profile_stock_batches alter column origin_type set default 'dealer_manual';
alter table public.profile_stock_batches alter column qc_status set default 'on_hold';
alter table public.profile_stock_batches alter column origin_type set not null;
alter table public.profile_stock_batches alter column qc_status set not null;
alter table public.profile_stock_batches drop constraint if exists profile_stock_batches_origin_type_check;
alter table public.profile_stock_batches add constraint profile_stock_batches_origin_type_check
  check (origin_type in ('production_surplus','customer_return','opening_balance','dealer_manual','dealer_receipt','legacy_unverified'));
alter table public.profile_stock_batches drop constraint if exists profile_stock_batches_qc_status_check;
alter table public.profile_stock_batches add constraint profile_stock_batches_qc_status_check
  check (qc_status in ('released','on_hold','rejected','not_required'));
alter table public.profile_stock_batches drop constraint if exists profile_stock_batches_production_origin_check;
alter table public.profile_stock_batches add constraint profile_stock_batches_production_origin_check
  check (origin_type <> 'production_surplus' or production_job_id is not null);
create index if not exists profile_stock_batches_company_job_idx on public.profile_stock_batches(company_id, production_job_id);

-- Invoker on purpose: current_user is 'authenticated' only for direct client
-- writes; the stock RPCs below run as the function owner.
create or replace function private.guard_profile_stock_batch_origin()
returns trigger
language plpgsql
set search_path = public, private
as $$
declare
  v_kg_m numeric;
  v_expected numeric;
  v_dealer uuid := public.get_current_user_dealer_id();
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then
      if v_dealer is null or new.dealer_id is distinct from v_dealer or new.origin_type <> 'dealer_manual' then
        raise exception 'Finished-goods stock is created from QC-released production, an approved opening balance or a return disposition'
          using errcode = '42501';
      end if;
      new.qc_status := 'not_required';
      new.production_job_id := null;
      new.packaging_job_id := null;
      new.source_dispatch_id := null;
    end if;
    if new.piece_length_m is not null and coalesce(new.quantity_pieces, 0) > 0 then
      new.length_m := round(new.piece_length_m * new.quantity_pieces, 3);
    end if;
    select section_weight_kg_per_m into v_kg_m from public.aluminium_profiles where id = new.profile_id and company_id = new.company_id;
    if coalesce(v_kg_m, 0) > 0 and coalesce(new.length_m, 0) > 0 then
      v_expected := v_kg_m * new.length_m;
      if abs(coalesce(new.total_weight_kg, 0) - v_expected) > v_expected * 0.10 then
        raise exception 'Batch weight % kg does not reconcile with % m x % kg/m = % kg (10%% tolerance)',
          new.total_weight_kg, new.length_m, v_kg_m, round(v_expected, 3) using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  -- Origin and QC evidence are immutable for clients.
  if current_user = 'authenticated' and (
    new.origin_type is distinct from old.origin_type or new.production_job_id is distinct from old.production_job_id
    or new.packaging_job_id is distinct from old.packaging_job_id or new.source_dispatch_id is distinct from old.source_dispatch_id
    or new.alloy is distinct from old.alloy or new.temper is distinct from old.temper
    or new.qc_status is distinct from old.qc_status or new.qc_released_by is distinct from old.qc_released_by
    or new.qc_released_at is distinct from old.qc_released_at) then
    raise exception 'Stock origin and QC status change only through the stock workflows' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_stock_batch_origin() from public, anon, authenticated;
drop trigger if exists a_guard_profile_stock_batch_origin on public.profile_stock_batches;
create trigger a_guard_profile_stock_batch_origin before insert or update on public.profile_stock_batches
  for each row execute function private.guard_profile_stock_batch_origin();

-- Stock on QC hold or rejected cannot be reserved or used for dealer fulfilment.
create or replace function private.guard_stock_batch_qc_release()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_qc text;
begin
  if new.profile_stock_batch_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.profile_stock_batch_id is not distinct from old.profile_stock_batch_id then return new; end if;
  select qc_status into v_qc from public.profile_stock_batches where id = new.profile_stock_batch_id;
  if v_qc not in ('released','not_required') then
    raise exception 'Stock batch is on QC % and cannot be reserved or shipped', replace(coalesce(v_qc, 'hold'), '_', ' ') using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_stock_batch_qc_release() from public, anon, authenticated;
drop trigger if exists a_guard_stock_batch_qc_release on public.profile_stock_reservations;
create trigger a_guard_stock_batch_qc_release before insert or update on public.profile_stock_reservations
  for each row execute function private.guard_stock_batch_qc_release();
drop trigger if exists a_guard_stock_batch_qc_release on public.order_dealer_stock_fulfillments;
create trigger a_guard_stock_batch_qc_release before insert or update on public.order_dealer_stock_fulfillments
  for each row execute function private.guard_stock_batch_qc_release();

create or replace function private.create_stock_from_production_surplus(
  p_production_job_id uuid, p_weight_kg numeric, p_pieces integer, p_piece_length_m numeric,
  p_bundle_number text, p_location text, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_job public.production_jobs%rowtype;
  v_released numeric;
  v_shipped numeric;
  v_stocked numeric;
  v_finish text;
  v_id uuid;
  v_alloy text;
  v_temper text;
  v_packaging uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager','inventory_manager') then
    raise exception 'Permission denied to move production surplus to stock' using errcode = '42501';
  end if;
  if coalesce(p_weight_kg, 0) <= 0 or coalesce(p_pieces, 0) <= 0 then raise exception 'Give the surplus weight and pieces' using errcode = '23514'; end if;
  select * into v_job from public.production_jobs where id = p_production_job_id and company_id = v_company_id for update;
  if not found then raise exception 'Production job not found for this company' using errcode = '23514'; end if;
  if v_job.status <> 'completed' then raise exception 'Only completed production can be moved to stock' using errcode = '23514'; end if;
  if coalesce(v_job.finishing_type, 'mill_finish') = 'mill_finish' then
    select coalesce(sum(quantity_checked_kg), 0) into v_released from public.quality_inspections
    where company_id = v_company_id and production_job_id = v_job.id and status = 'approved' and finishing_job_id is null;
    v_finish := 'mill_finish';
  else
    select coalesce(sum(quantity_checked_kg), 0) into v_released from public.quality_inspections
    where company_id = v_company_id and production_job_id = v_job.id and status = 'approved' and finishing_job_id is not null;
    v_finish := v_job.finishing_type;
  end if;
  select coalesce(sum(net_weight_kg), 0) into v_shipped from public.packing_list_items where company_id = v_company_id and source_line_id = v_job.id;
  select coalesce(sum(total_weight_kg), 0) into v_stocked from public.profile_stock_batches
  where company_id = v_company_id and production_job_id = v_job.id and origin_type = 'production_surplus';
  if p_weight_kg > v_released - v_shipped - v_stocked + 0.01 then
    raise exception 'Only % kg of QC-released output of this job is unshipped and not yet in stock', greatest(v_released - v_shipped - v_stocked, 0)
      using errcode = '23514';
  end if;
  v_alloy := private.production_job_alloy(v_company_id, v_job.id);
  select temper into v_temper from public.aluminium_profiles where id = v_job.profile_id;
  select id into v_packaging from public.packaging_jobs where company_id = v_company_id and production_job_id = v_job.id and status = 'completed' order by updated_at desc limit 1;

  insert into public.profile_stock_batches(company_id, profile_id, finish, length_m, piece_length_m, quantity_pieces, total_weight_kg, bundle_number, location,
    status, origin_type, production_job_id, packaging_job_id, alloy, temper, qc_status, qc_released_by, qc_released_at, origin_reference, notes)
  values (v_company_id, v_job.profile_id, v_finish, round(coalesce(p_piece_length_m, 0) * p_pieces, 3), p_piece_length_m, p_pieces, p_weight_kg,
    nullif(btrim(coalesce(p_bundle_number, '')), ''), nullif(btrim(coalesce(p_location, '')), ''), 'available', 'production_surplus', v_job.id, v_packaging,
    v_alloy, v_temper, 'released', auth.uid(), now(), concat('Surplus from job ', coalesce(v_job.job_number, v_job.id::text)), nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.create_stock_from_production_surplus(uuid, numeric, integer, numeric, text, text, text) from public, anon, authenticated;
create or replace function public.create_stock_from_production_surplus(
  p_production_job_id uuid, p_weight_kg numeric, p_pieces integer, p_piece_length_m numeric,
  p_bundle_number text default null, p_location text default null, p_notes text default null)
returns uuid language sql security definer set search_path = public, private
as $$ select private.create_stock_from_production_surplus(p_production_job_id, p_weight_kg, p_pieces, p_piece_length_m, p_bundle_number, p_location, p_notes) $$;
revoke all on function public.create_stock_from_production_surplus(uuid, numeric, integer, numeric, text, text, text) from public, anon;
grant execute on function public.create_stock_from_production_surplus(uuid, numeric, integer, numeric, text, text, text) to authenticated;

create or replace function private.record_opening_stock_batch(
  p_profile_id uuid, p_finish text, p_weight_kg numeric, p_pieces integer, p_piece_length_m numeric,
  p_alloy text, p_temper text, p_bundle_number text, p_location text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin') then raise exception 'Only an owner or admin can record an opening stock balance' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Give the opening-stock reference of at least 10 characters' using errcode = '23514'; end if;
  if coalesce(p_weight_kg, 0) <= 0 or coalesce(p_pieces, 0) <= 0 then raise exception 'Give the weight and pieces' using errcode = '23514'; end if;
  insert into public.profile_stock_batches(company_id, profile_id, finish, length_m, piece_length_m, quantity_pieces, total_weight_kg, bundle_number, location,
    status, origin_type, alloy, temper, qc_status, origin_reference)
  values (v_company_id, p_profile_id, coalesce(nullif(btrim(coalesce(p_finish, '')), ''), 'mill_finish'), round(coalesce(p_piece_length_m, 0) * p_pieces, 3),
    p_piece_length_m, p_pieces, p_weight_kg, nullif(btrim(coalesce(p_bundle_number, '')), ''), nullif(btrim(coalesce(p_location, '')), ''),
    'available', 'opening_balance', nullif(btrim(coalesce(p_alloy, '')), ''), nullif(btrim(coalesce(p_temper, '')), ''), 'on_hold', btrim(p_reason))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.record_opening_stock_batch(uuid, text, numeric, integer, numeric, text, text, text, text, text) from public, anon, authenticated;
create or replace function public.record_opening_stock_batch(
  p_profile_id uuid, p_finish text, p_weight_kg numeric, p_pieces integer, p_piece_length_m numeric,
  p_alloy text, p_temper text, p_bundle_number text, p_location text, p_reason text)
returns uuid language sql security definer set search_path = public, private
as $$ select private.record_opening_stock_batch(p_profile_id, p_finish, p_weight_kg, p_pieces, p_piece_length_m, p_alloy, p_temper, p_bundle_number, p_location, p_reason) $$;
revoke all on function public.record_opening_stock_batch(uuid, text, numeric, integer, numeric, text, text, text, text, text) from public, anon;
grant execute on function public.record_opening_stock_batch(uuid, text, numeric, integer, numeric, text, text, text, text, text) to authenticated;

create or replace function private.release_stock_batch_qc(p_batch_id uuid, p_decision text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_batch public.profile_stock_batches%rowtype;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','quality','factory_manager') then raise exception 'Only quality, factory manager, owner or admin can release stock' using errcode = '42501'; end if;
  if p_decision not in ('released','rejected') then raise exception 'Decision must be released or rejected' using errcode = '23514'; end if;
  select * into v_batch from public.profile_stock_batches where id = p_batch_id and company_id = v_company_id for update;
  if not found then raise exception 'Stock batch not found for this company' using errcode = '23514'; end if;
  if v_batch.qc_status not in ('on_hold','released','rejected') then raise exception 'This stock batch does not need QC release' using errcode = '23514'; end if;
  if p_decision = 'rejected' and exists (select 1 from public.profile_stock_reservations r where r.profile_stock_batch_id = p_batch_id and r.status = 'active') then
    raise exception 'Release the active reservations on this batch before rejecting it' using errcode = '23514';
  end if;
  update public.profile_stock_batches set qc_status = p_decision, qc_released_by = auth.uid(), qc_released_at = now(),
    status = case when p_decision = 'rejected' and status = 'available' then 'rejected' else status end,
    notes = concat_ws(E'\n', nullif(notes, ''), concat('QC ', p_decision, ': ', nullif(btrim(coalesce(p_note, '')), ''))), updated_at = now()
  where id = p_batch_id;
  return p_batch_id;
end;
$$;
revoke all on function private.release_stock_batch_qc(uuid, text, text) from public, anon, authenticated;
create or replace function public.release_stock_batch_qc(p_batch_id uuid, p_decision text, p_note text default null)
returns uuid language sql security definer set search_path = public, private
as $$ select private.release_stock_batch_qc(p_batch_id, p_decision, p_note) $$;
revoke all on function public.release_stock_batch_qc(uuid, text, text) from public, anon;
grant execute on function public.release_stock_batch_qc(uuid, text, text) to authenticated;

commit;
