begin;

alter table public.profile_stock_reservations
  add column if not exists reserved_pieces integer,
  add column if not exists initial_reserved_weight_kg numeric(14,3),
  add column if not exists initial_reserved_pieces integer,
  add column if not exists initial_reserved_length_m numeric(14,3);

alter table public.profile_stock_consumptions
  add column if not exists consumed_pieces integer;

grant select (company_id, reservation_id, consumed_weight_kg, consumed_length_m, consumed_pieces)
  on public.profile_stock_consumptions to authenticated;

create or replace function public.get_profile_stock_consumption_totals(p_reservation_ids uuid[])
returns table(reservation_id uuid, consumed_weight_kg numeric, consumed_length_m numeric, consumed_pieces integer)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_ids uuid[] := coalesce(p_reservation_ids, array[]::uuid[]);
begin
  if auth.uid() is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'Request no more than 500 reservation ids at a time' using errcode = '22023';
  end if;
  if cardinality(v_ids) <> (select count(distinct requested.id)::integer from unnest(v_ids) requested(id)) then
    raise exception 'Reservation ids must be unique' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) requested(id)
    left join public.profile_stock_reservations reservation
      on reservation.id = requested.id and reservation.company_id = v_company_id
    where reservation.id is null
  ) then
    raise exception 'Reservation not found for current company' using errcode = '42501';
  end if;
  return query
  select requested.id,
    coalesce(sum(consumption.consumed_weight_kg),0),
    coalesce(sum(consumption.consumed_length_m),0),
    coalesce(sum(consumption.consumed_pieces),0)::integer
  from unnest(v_ids) requested(id)
  left join public.profile_stock_consumptions consumption
    on consumption.reservation_id = requested.id and consumption.company_id = v_company_id
  group by requested.id;
end;
$$;
revoke all on function public.get_profile_stock_consumption_totals(uuid[]) from public, anon;
grant execute on function public.get_profile_stock_consumption_totals(uuid[]) to authenticated;

alter table public.packing_list_items
  add column if not exists net_length_m numeric(14,3);

grant select (net_length_m) on public.packing_list_items to authenticated;

alter table public.dispatches
  add column if not exists actual_dispatched_at timestamptz;

update public.dispatches dispatch
set actual_dispatched_at = (
  select min(history.changed_at)
  from public.dispatch_status_history history
  where history.company_id = dispatch.company_id
    and history.dispatch_id = dispatch.id
    and history.to_status = 'dispatched'
)
where dispatch.actual_dispatched_at is null
  and exists (
    select 1 from public.dispatch_status_history history
    where history.company_id = dispatch.company_id
      and history.dispatch_id = dispatch.id
      and history.to_status = 'dispatched'
  );

create table if not exists private.production_completion_authorizations (
  transaction_id bigint not null,
  job_id uuid not null references public.production_jobs(id) on delete cascade,
  company_id uuid not null,
  actor_id uuid not null,
  expected_weight_kg numeric(14,3) not null,
  expected_pieces integer not null,
  expected_meters numeric(14,3) not null,
  expected_scrap_kg numeric(14,3) not null,
  scrap_inserted boolean not null default false,
  primary key (transaction_id, job_id)
);
revoke all on private.production_completion_authorizations from public, anon, authenticated;

create table if not exists private.production_output_correction_authorizations (
  transaction_id bigint not null,
  job_id uuid not null references public.production_jobs(id) on delete cascade,
  company_id uuid not null,
  actor_id uuid not null,
  reason text not null,
  expected_weight_kg numeric(14,3) not null,
  expected_pieces integer not null,
  expected_meters numeric(14,3) not null,
  primary key (transaction_id, job_id)
);
revoke all on private.production_output_correction_authorizations from public, anon, authenticated;

create table if not exists public.production_output_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  production_job_id uuid not null references public.production_jobs(id) on delete restrict,
  changed_by uuid not null references auth.users(id),
  reason text not null,
  prior_weight_kg numeric(14,3) not null,
  prior_pieces integer not null,
  prior_meters numeric(14,3) not null,
  corrected_weight_kg numeric(14,3) not null,
  corrected_pieces integer not null,
  corrected_meters numeric(14,3) not null,
  created_at timestamptz not null default now()
);
alter table public.production_output_corrections enable row level security;
drop policy if exists production_output_corrections_company_read on public.production_output_corrections;
create policy production_output_corrections_company_read on public.production_output_corrections
  for select to authenticated using (company_id = private.get_current_user_company_id());
revoke insert, update, delete on public.production_output_corrections from public, anon, authenticated;
grant select on public.production_output_corrections to authenticated;

create or replace function public.enforce_production_completion_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_auth private.production_completion_authorizations%rowtype;
  v_correction private.production_output_correction_authorizations%rowtype;
  v_input numeric := 0;
  v_scrap numeric := 0;
  v_tol numeric := 0.5;
begin
  if tg_op = 'DELETE' then
    if old.status = 'completed' then raise exception 'Completed production evidence cannot be deleted'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'completed' then raise exception 'Use the audited production completion workflow'; end if;
    return new;
  end if;

  if old.status = 'completed' then
    select * into v_correction from private.production_output_correction_authorizations
    where transaction_id = txid_current() and job_id = old.id and company_id = old.company_id and actor_id = auth.uid()
    for update;
    if not found then
      if new.status is distinct from old.status
        or (to_jsonb(new) - array['remarks','updated_at']) is distinct from (to_jsonb(old) - array['remarks','updated_at']) then
        raise exception 'Completed production job evidence is immutable outside the audited correction workflow';
      end if;
      return new;
    end if;
    if new.status is distinct from 'completed'
      or new.actual_quantity_kg is distinct from v_correction.expected_weight_kg
      or new.actual_pieces is distinct from v_correction.expected_pieces
      or new.actual_meters is distinct from v_correction.expected_meters
      or (to_jsonb(new) - array['actual_quantity_kg','actual_pieces','actual_meters','updated_at'])
        is distinct from (to_jsonb(old) - array['actual_quantity_kg','actual_pieces','actual_meters','updated_at']) then
      raise exception 'Correction is limited to audited completed output fields';
    end if;
    perform 1 from public.finishing_jobs where company_id = old.company_id and production_job_id = old.id for update;
    perform 1 from public.quality_inspections where company_id = old.company_id and production_job_id = old.id for update;
    perform 1 from public.packaging_jobs where company_id = old.company_id and production_job_id = old.id for update;
    if exists (select 1 from public.quality_inspections where company_id = old.company_id and production_job_id = old.id and status <> 'pending')
      or exists (select 1 from public.finishing_jobs where company_id = old.company_id and production_job_id = old.id and status not in ('planned','not_required'))
      or exists (select 1 from public.packaging_jobs where company_id = old.company_id and production_job_id = old.id and status <> 'scheduled')
      or exists (select 1 from public.packaging_material_movements movement join public.packaging_jobs package on package.id = movement.packaging_job_id
        where movement.company_id = old.company_id and package.production_job_id = old.id)
      or exists (select 1 from public.packing_list_items where company_id = old.company_id and source_line_id = old.id) then
      raise exception 'Completed output cannot be corrected after downstream QC, finishing, packaging, or dispatch evidence exists';
    end if;
    if exists (select 1 from public.quality_inspections where company_id = old.company_id and production_job_id = old.id
      and status = 'pending' and quantity_checked_kg > new.actual_quantity_kg + 0.001) then
      raise exception 'Corrected output is below the quantity already assigned to pending QC';
    end if;
    select coalesce(sum(weight_kg), 0) into v_input from public.foundry_billets
    where company_id = old.company_id and production_job_id = old.id and status in ('allocated','issued','consumed');
    select coalesce(sum(weight_kg), 0) into v_scrap from public.scrap_records
    where company_id = old.company_id and production_job_id = old.id;
    v_tol := greatest(0.5, round((v_input * 0.01)::numeric, 3));
    if v_input > 0 and abs(v_input - round((new.actual_quantity_kg + v_scrap)::numeric, 3)) > v_tol then
      raise exception 'Corrected output would violate billet mass balance';
    end if;
    insert into public.production_output_corrections(company_id, production_job_id, changed_by, reason,
      prior_weight_kg, prior_pieces, prior_meters, corrected_weight_kg, corrected_pieces, corrected_meters)
    values (old.company_id, old.id, auth.uid(), v_correction.reason, old.actual_quantity_kg, old.actual_pieces,
      old.actual_meters, new.actual_quantity_kg, new.actual_pieces, new.actual_meters);
    update public.finishing_jobs set input_weight_kg = new.actual_quantity_kg, updated_at = now()
    where company_id = old.company_id and production_job_id = old.id and status = 'planned';
    update public.quality_inspections set quantity_checked_kg = new.actual_quantity_kg, updated_at = now()
    where company_id = old.company_id and production_job_id = old.id and status = 'pending'
      and abs(quantity_checked_kg - old.actual_quantity_kg) <= 0.001;
    update public.packaging_jobs set profile_weight_kg = new.actual_quantity_kg,
      pieces = new.actual_pieces, profile_length_m = new.actual_meters, updated_at = now()
    where company_id = old.company_id and production_job_id = old.id and status = 'scheduled';
    return new;
  end if;

  if new.status = 'completed' then
    select * into v_auth from private.production_completion_authorizations
    where transaction_id = txid_current() and job_id = new.id and company_id = new.company_id and actor_id = auth.uid()
    for update;
    if not found or new.actual_quantity_kg is distinct from v_auth.expected_weight_kg
      or new.actual_pieces is distinct from v_auth.expected_pieces
      or new.actual_meters is distinct from v_auth.expected_meters then
      raise exception 'Only the validated completion workflow can record final production output' using errcode = '42501';
    end if;
    select coalesce(sum(weight_kg), 0) into v_input from public.foundry_billets
    where company_id = new.company_id and production_job_id = new.id and status in ('allocated','issued','consumed');
    select coalesce(sum(weight_kg), 0) into v_scrap from public.scrap_records
    where company_id = new.company_id and production_job_id = new.id;
    v_tol := greatest(0.5, round((v_input * 0.01)::numeric, 3));
    if v_input > 0 and abs(v_input - round((new.actual_quantity_kg + v_scrap + v_auth.expected_scrap_kg)::numeric, 3)) > v_tol then
      raise exception 'Billet mass balance failed: linked input % kg, accounted output and scrap % kg, tolerance % kg',
        v_input, new.actual_quantity_kg + v_scrap + v_auth.expected_scrap_kg, v_tol using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_production_completion_integrity() from public, anon, authenticated;
drop trigger if exists enforce_production_completion_integrity on public.production_jobs;
create trigger enforce_production_completion_integrity
before insert or update or delete on public.production_jobs
for each row execute function public.enforce_production_completion_integrity();

create or replace function private.guard_completed_production_scrap()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job_id uuid;
  v_job public.production_jobs%rowtype;
  v_auth private.production_completion_authorizations%rowtype;
  v_job_found boolean := false;
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    v_job_id := old.production_job_id;
    if v_job_id is not null then
      select * into v_job from public.production_jobs where id = v_job_id and company_id = old.company_id for update nowait;
      v_job_found := found;
    end if;
    if v_job_found and v_job.status = 'completed' then
      raise exception 'Scrap linked to completed production is immutable';
    end if;
    if tg_op = 'DELETE' then return old; end if;
  end if;
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    if new.production_job_id is not null then
      select * into v_job from public.production_jobs where id = new.production_job_id and company_id = new.company_id for update nowait;
      v_job_found := found;
    else
      v_job_found := false;
    end if;
    if v_job_found and v_job.status = 'completed' then
      select * into v_auth from private.production_completion_authorizations
      where transaction_id = txid_current() and job_id = new.production_job_id and company_id = new.company_id
        and actor_id = auth.uid() and expected_scrap_kg = new.weight_kg and scrap_inserted = false
      for update;
      if not found then raise exception 'Scrap linked to completed production requires the audited completion workflow'; end if;
      update private.production_completion_authorizations set scrap_inserted = true
      where transaction_id = v_auth.transaction_id and job_id = v_auth.job_id;
    end if;
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Production output is being finalized or corrected; retry the scrap change' using errcode = '55P03';
end;
$$;

revoke all on function private.guard_completed_production_scrap() from public, anon, authenticated;
drop trigger if exists guard_completed_production_scrap on public.scrap_records;
create trigger guard_completed_production_scrap
before insert or update or delete on public.scrap_records
for each row execute function private.guard_completed_production_scrap();

create or replace function private.guard_completed_billet_inputs()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job public.production_jobs%rowtype;
  v_completion_authorized boolean := false;
begin
  if tg_op in ('UPDATE','DELETE') and old.production_job_id is not null then
    select * into v_job from public.production_jobs where id = old.production_job_id and company_id = old.company_id for update nowait;
    if found and v_job.status = 'completed' then
      v_completion_authorized := tg_op = 'UPDATE' and (
        (to_jsonb(new) - array['updated_at']) is not distinct from (to_jsonb(old) - array['updated_at'])
        or (old.status in ('allocated','issued') and new.status = 'consumed'
          and (to_jsonb(new) - array['status','updated_at']) is not distinct from (to_jsonb(old) - array['status','updated_at'])
          and exists(select 1 from private.production_completion_authorizations completion_auth
            where completion_auth.transaction_id=txid_current() and completion_auth.job_id=old.production_job_id
              and completion_auth.company_id=old.company_id and completion_auth.actor_id=auth.uid()))
      );
      if not v_completion_authorized then raise exception 'Billet inputs linked to completed production are immutable'; end if;
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.production_job_id is not null then
    select * into v_job from public.production_jobs where id = new.production_job_id and company_id = new.company_id for update nowait;
    if found and v_job.status = 'completed' then
      v_completion_authorized := tg_op = 'UPDATE' and (
        (to_jsonb(new) - array['updated_at']) is not distinct from (to_jsonb(old) - array['updated_at'])
        or (old.status in ('allocated','issued') and new.status = 'consumed'
          and old.production_job_id is not distinct from new.production_job_id
          and (to_jsonb(new) - array['status','updated_at']) is not distinct from (to_jsonb(old) - array['status','updated_at'])
          and exists(select 1 from private.production_completion_authorizations completion_auth
            where completion_auth.transaction_id=txid_current() and completion_auth.job_id=new.production_job_id
              and completion_auth.company_id=new.company_id and completion_auth.actor_id=auth.uid()))
      );
      if not v_completion_authorized then raise exception 'Billet inputs linked to completed production are immutable'; end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
exception when lock_not_available then
  raise exception 'Production input is being finalized; retry the billet change' using errcode = '55P03';
end;
$$;

revoke all on function private.guard_completed_billet_inputs() from public, anon, authenticated;
drop trigger if exists guard_completed_billet_inputs on public.foundry_billets;
create trigger guard_completed_billet_inputs
before insert or update or delete on public.foundry_billets
for each row execute function private.guard_completed_billet_inputs();

create or replace function public.complete_production_job_atomic(
  p_job_id uuid,
  p_actual_weight_kg numeric,
  p_actual_pieces integer,
  p_actual_meters numeric default null,
  p_scrap_weight_kg numeric default 0,
  p_remarks text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_job public.production_jobs%rowtype;
  v_meters numeric;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'Permission denied for production completion' using errcode = '42501';
  end if;
  select * into v_job from public.production_jobs where id = p_job_id and company_id = v_company_id for update;
  if not found then raise exception 'Production job not found for this company'; end if;
  v_meters := coalesce(p_actual_meters, case when p_actual_pieces > 0 and coalesce(v_job.length_per_piece_m, 0) > 0 then p_actual_pieces * v_job.length_per_piece_m else 0 end);
  insert into private.production_completion_authorizations(transaction_id, job_id, company_id, actor_id,
    expected_weight_kg, expected_pieces, expected_meters, expected_scrap_kg)
  values (txid_current(), p_job_id, v_company_id, auth.uid(), round(p_actual_weight_kg, 3), p_actual_pieces,
    round(v_meters, 3), round(coalesce(p_scrap_weight_kg, 0), 3));
  perform private.complete_production_job_atomic(p_job_id, p_actual_weight_kg, p_actual_pieces,
    p_actual_meters, p_scrap_weight_kg, p_remarks);
  delete from private.production_completion_authorizations where transaction_id = txid_current() and job_id = p_job_id;
  return p_job_id;
end;
$$;

revoke all on function public.complete_production_job_atomic(uuid, numeric, integer, numeric, numeric, text) from public, anon;
grant execute on function public.complete_production_job_atomic(uuid, numeric, integer, numeric, numeric, text) to authenticated;

create or replace function public.correct_completed_production_output_atomic(
  p_job_id uuid,
  p_actual_weight_kg numeric,
  p_actual_pieces integer,
  p_actual_meters numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_job public.production_jobs%rowtype;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','production_manager') then
    raise exception 'Only an owner, administrator, or production manager can correct completed output' using errcode = '42501';
  end if;
  if coalesce(p_actual_weight_kg, 0) <= 0 or coalesce(p_actual_pieces, 0) < 0 or coalesce(p_actual_meters, 0) < 0
    or length(btrim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Corrected output and a reason of at least eight characters are required';
  end if;
  select * into v_job from public.production_jobs where id = p_job_id and company_id = v_company_id for update;
  if not found or v_job.status <> 'completed' then raise exception 'Completed production job not found'; end if;
  insert into private.production_output_correction_authorizations(transaction_id, job_id, company_id, actor_id, reason,
    expected_weight_kg, expected_pieces, expected_meters)
  values (txid_current(), p_job_id, v_company_id, auth.uid(), btrim(p_reason), round(p_actual_weight_kg, 3),
    p_actual_pieces, round(p_actual_meters, 3));
  update public.production_jobs set actual_quantity_kg = round(p_actual_weight_kg, 3),
    actual_pieces = p_actual_pieces, actual_meters = round(p_actual_meters, 3), updated_at = now()
  where id = p_job_id and company_id = v_company_id;
  delete from private.production_output_correction_authorizations where transaction_id = txid_current() and job_id = p_job_id;
  return p_job_id;
end;
$$;

revoke all on function public.correct_completed_production_output_atomic(uuid, numeric, integer, numeric, text) from public, anon;
grant execute on function public.correct_completed_production_output_atomic(uuid, numeric, integer, numeric, text) to authenticated;

create or replace function private.guard_profile_reservation_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_batch public.profile_stock_batches%rowtype;
  v_other_weight numeric;
  v_other_length numeric;
  v_other_pieces bigint;
  v_own_weight numeric := 0;
  v_own_length numeric := 0;
  v_own_pieces bigint := 0;
begin
  if tg_op = 'UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.profile_stock_batch_id is distinct from old.profile_stock_batch_id
    or new.profile_id is distinct from old.profile_id
    or new.order_id is distinct from old.order_id
    or new.configuration_id is distinct from old.configuration_id
  ) then
    raise exception 'Reservation source is immutable';
  end if;

  if new.configuration_id is not null then
    perform 1 from public.system_configurations
    where id = new.configuration_id and company_id = new.company_id and order_id = new.order_id
    for update;
    if not found then raise exception 'Reservation configuration must match its order and company'; end if;
  end if;

  select * into v_batch
  from public.profile_stock_batches
  where id = new.profile_stock_batch_id and company_id = new.company_id
  for update;
  if not found or v_batch.profile_id is distinct from new.profile_id then
    raise exception 'Reservation batch must match its profile and company';
  end if;
  if not exists (select 1 from public.orders where id = new.order_id and company_id = new.company_id) then
    raise exception 'Reservation order not found';
  end if;

  if tg_op = 'INSERT' and new.status = 'active' then
    new.initial_reserved_weight_kg := new.reserved_weight_kg;
    new.initial_reserved_pieces := new.reserved_pieces;
    new.initial_reserved_length_m := new.reserved_length_m;
  elsif tg_op = 'UPDATE' then
    if new.initial_reserved_weight_kg is distinct from old.initial_reserved_weight_kg
      or new.initial_reserved_pieces is distinct from old.initial_reserved_pieces
      or new.initial_reserved_length_m is distinct from old.initial_reserved_length_m then
      raise exception 'Initial reservation quantities are immutable';
    end if;
    if old.status in ('released','consumed','cancelled') and new.status = 'active' then
      raise exception 'A terminal stock reservation cannot be reactivated';
    end if;
    if old.status = 'consumed' and new.status is distinct from 'consumed' then
      raise exception 'A consumed stock reservation is terminal';
    end if;
  end if;

  if new.status = 'active' then
    if new.initial_reserved_weight_kg is null or new.initial_reserved_pieces is null or new.initial_reserved_length_m is null then
      raise exception 'Legacy active reservation lacks exact immutable source units and requires data repair';
    end if;
    if v_batch.status not in ('available', 'reserved') then raise exception 'Stock batch is not available'; end if;
    if new.reserved_weight_kg <= 0 or new.reserved_length_m <= 0 or coalesce(new.reserved_pieces, 0) <= 0 then
      raise exception 'Active stock reservations require exact positive kilograms, metres, and whole pieces';
    end if;
    if coalesce(v_batch.quantity_pieces, 0) <= 0
      or abs(new.reserved_weight_kg - (v_batch.total_weight_kg * new.reserved_pieces / v_batch.quantity_pieces)) > 0.01
      or abs(new.reserved_length_m - (v_batch.length_m * new.reserved_pieces / v_batch.quantity_pieces)) > 0.001 then
      raise exception 'Reservation kilograms and metres must match the exact whole-piece source ratio';
    end if;
    if tg_op = 'UPDATE' and old.status = 'active' and (
      new.reserved_weight_kg is distinct from old.reserved_weight_kg
      or new.reserved_length_m is distinct from old.reserved_length_m
      or new.reserved_pieces is distinct from old.reserved_pieces
    ) then raise exception 'Active reservation quantities are immutable'; end if;

    if tg_op = 'UPDATE' then
      select coalesce(sum(consumed_weight_kg), 0), coalesce(sum(consumed_length_m), 0), coalesce(sum(consumed_pieces), 0)
      into v_own_weight, v_own_length, v_own_pieces
      from public.profile_stock_consumptions
      where reservation_id = old.id and company_id = old.company_id;
    end if;

    select
      coalesce(sum(r.reserved_weight_kg - coalesce(c.weight_kg, 0)), 0),
      coalesce(sum(r.reserved_length_m - coalesce(c.length_m, 0)), 0),
      coalesce(sum(coalesce(r.reserved_pieces, 0) - coalesce(c.pieces, 0)), 0)
    into v_other_weight, v_other_length, v_other_pieces
    from public.profile_stock_reservations r
    left join lateral (
      select sum(consumed_weight_kg) weight_kg, sum(consumed_length_m) length_m, sum(consumed_pieces) pieces
      from public.profile_stock_consumptions
      where reservation_id = r.id and company_id = r.company_id
    ) c on true
    where r.profile_stock_batch_id = v_batch.id and r.company_id = v_batch.company_id
      and r.status = 'active' and r.id <> new.id;

    if v_other_weight + greatest(new.reserved_weight_kg - v_own_weight, 0) > v_batch.total_weight_kg + 0.001
      or v_other_length + greatest(new.reserved_length_m - v_own_length, 0) > v_batch.length_m + 0.001
      or v_other_pieces + greatest(new.reserved_pieces - v_own_pieces, 0) > v_batch.quantity_pieces then
      raise exception 'Insufficient stock: active reservations exceed exact batch capacity';
    end if;
  elsif new.status = 'consumed' then
    select coalesce(sum(consumed_weight_kg), 0), coalesce(sum(consumed_length_m), 0), coalesce(sum(consumed_pieces), 0)
    into v_own_weight, v_own_length, v_own_pieces
    from public.profile_stock_consumptions
    where reservation_id = new.id and company_id = new.company_id;
    if new.initial_reserved_weight_kg is null or new.initial_reserved_length_m is null or new.initial_reserved_pieces is null
      or abs(v_own_weight - new.initial_reserved_weight_kg) > 0.001
      or abs(v_own_length - new.initial_reserved_length_m) > 0.001
      or v_own_pieces <> new.initial_reserved_pieces then
      raise exception 'A reservation can be consumed only after its exact reserved units are posted';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_profile_reservation_capacity() from public, anon, authenticated;
drop trigger if exists astra_reservation_capacity on public.profile_stock_reservations;
create trigger astra_reservation_capacity
before insert or update on public.profile_stock_reservations
for each row execute function private.guard_profile_reservation_capacity();

create or replace function private.guard_reserved_stock_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_reserved_weight numeric;
  v_reserved_length numeric;
  v_reserved_pieces bigint;
begin
  select
    coalesce(sum(r.reserved_weight_kg - coalesce(c.weight_kg, 0)), 0),
    coalesce(sum(r.reserved_length_m - coalesce(c.length_m, 0)), 0),
    coalesce(sum(coalesce(r.reserved_pieces, 0) - coalesce(c.pieces, 0)), 0)
  into v_reserved_weight, v_reserved_length, v_reserved_pieces
  from public.profile_stock_reservations r
  left join lateral (
    select sum(consumed_weight_kg) weight_kg, sum(consumed_length_m) length_m, sum(consumed_pieces) pieces
    from public.profile_stock_consumptions
    where reservation_id = r.id and company_id = r.company_id
  ) c on true
  where r.company_id = old.company_id and r.profile_stock_batch_id = old.id and r.status = 'active';

  if new.company_id is distinct from old.company_id or new.profile_id is distinct from old.profile_id
    or new.total_weight_kg + 0.001 < v_reserved_weight
    or new.length_m + 0.001 < v_reserved_length
    or new.quantity_pieces < v_reserved_pieces
    or (v_reserved_weight > 0 and new.status not in ('available', 'reserved')) then
    raise exception 'Release or consume active reservations before changing reserved stock';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_reserved_stock_capacity() from public, anon, authenticated;
drop trigger if exists astra_reserved_stock on public.profile_stock_batches;
create trigger astra_reserved_stock before update on public.profile_stock_batches
for each row execute function private.guard_reserved_stock_capacity();

create or replace function public.validate_operator_dispatch_bundle()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_reservation record;
begin
  if nullif(trim(new.bundle_number), '') is null then raise exception 'Scan or enter the physical bundle identifier'; end if;
  if new.source_line_id is null or new.profile_id is null or new.source_kind is null then
    raise exception 'Every bundle must select its exact production, reservation, or dealer-stock source';
  end if;
  if new.operator_verified_at is null or new.operator_verified_by is null then raise exception 'Every dispatch bundle requires operator verification'; end if;
  if coalesce(new.number_of_pieces, 0) <= 0 then raise exception 'Every physical bundle must record its actual piece count'; end if;
  if coalesce(new.net_length_m, 0) <= 0 then raise exception 'Every physical bundle must record its actual length in metres'; end if;
  if coalesce(new.gross_weight_kg, 0) > 0 and coalesce(new.tare_weight_kg, 0) >= 0 then
    new.net_weight_kg := round(new.gross_weight_kg - new.tare_weight_kg, 3);
  end if;
  if new.source_kind = 'reservation' then
    select initial_reserved_weight_kg, initial_reserved_length_m, initial_reserved_pieces
    into v_reservation
    from public.profile_stock_reservations
    where id = new.reservation_id and company_id = new.company_id and profile_id = new.profile_id
      and profile_stock_batch_id = new.profile_stock_batch_id and status in ('active','consumed')
    for update;
    if not found or coalesce(v_reservation.initial_reserved_pieces, 0) <= 0
      or abs(new.net_weight_kg - (v_reservation.initial_reserved_weight_kg * new.number_of_pieces / v_reservation.initial_reserved_pieces)) > 0.01
      or abs(new.net_length_m - (v_reservation.initial_reserved_length_m * new.number_of_pieces / v_reservation.initial_reserved_pieces)) > 0.001 then
      raise exception 'Reserved-stock bundle units must preserve the exact whole-piece source ratio';
    end if;
  end if;
  if coalesce(new.gross_weight_kg, 0) <= 0 or coalesce(new.tare_weight_kg, 0) < 0 or new.gross_weight_kg <= new.tare_weight_kg then
    raise exception 'Bundle gross weight must be greater than its non-negative tare weight';
  end if;
  new.net_weight_kg := round(new.gross_weight_kg - new.tare_weight_kg, 3);
  return new;
end;
$$;

revoke all on function public.validate_operator_dispatch_bundle() from public, anon, authenticated;
drop trigger if exists validate_operator_dispatch_bundle on public.packing_list_items;
create trigger validate_operator_dispatch_bundle
before insert or update of bundle_number, source_line_id, profile_id, source_kind, number_of_pieces,
  net_length_m, gross_weight_kg, tare_weight_kg, operator_verified_at, operator_verified_by
on public.packing_list_items for each row execute function public.validate_operator_dispatch_bundle();

create or replace function private.validate_production_start_resources()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_order public.orders%rowtype;
  v_die public.dies%rowtype;
  v_machine public.machines%rowtype;
  v_slot public.production_plan_slots%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'planned' then
      raise exception 'Production jobs must be created as planned and started through the current resource-release workflow' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.status is distinct from 'in_progress' or old.status = 'in_progress' then return new; end if;
  select * into v_order from public.orders where id = new.order_id and company_id = new.company_id for update nowait;
  if not found or v_order.current_stage in ('closed','cancelled','delivered','payment_pending') then
    raise exception 'Order is no longer eligible for production start' using errcode = '23514';
  end if;
  select * into v_die from public.dies where id = new.die_id and company_id = new.company_id for update nowait;
  if not found or v_die.profile_id is distinct from new.profile_id or v_die.die_status not in ('active','approved') then
    raise exception 'Assigned die is no longer eligible for production start' using errcode = '23514';
  end if;
  select * into v_machine from public.machines where id = new.machine_id and company_id = new.company_id for update nowait;
  if not found or v_machine.machine_type <> 'extrusion_press' or v_machine.is_active is distinct from true
    or v_machine.status not in ('active','operational','idle') then
    raise exception 'Assigned extrusion press is no longer eligible for production start' using errcode = '23514';
  end if;
  select * into v_slot from public.production_plan_slots
  where company_id = new.company_id and production_job_id = new.id and machine_id = new.machine_id and status = 'released'
  for update nowait;
  if not found then raise exception 'Production job requires its currently released press slot before start' using errcode = '23514'; end if;
  return new;
exception when lock_not_available then
  raise exception 'Production resource is being changed; retry the start after refresh' using errcode = '55P03';
end;
$$;

revoke all on function private.validate_production_start_resources() from public, anon, authenticated;
drop trigger if exists validate_production_start_resources on public.production_jobs;
create trigger validate_production_start_resources before insert or update of status on public.production_jobs
for each row execute function private.validate_production_start_resources();

create or replace function private.validate_production_slot_release_resources()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job public.production_jobs%rowtype;
  v_order public.orders%rowtype;
  v_die public.dies%rowtype;
  v_machine public.machines%rowtype;
begin
  if (tg_op = 'UPDATE' and old.status = 'released') or new.status <> 'released' then return new; end if;
  select * into v_job from public.production_jobs where id = new.production_job_id and company_id = new.company_id for update nowait;
  if not found or v_job.status not in ('planned','ready','on_hold') or v_job.die_id is null then
    raise exception 'Production job is no longer eligible for press release' using errcode = '23514';
  end if;
  select * into v_order from public.orders where id = v_job.order_id and company_id = new.company_id for update nowait;
  if not found or v_order.current_stage in ('closed','cancelled','delivered','payment_pending')
    or (v_order.current_stage = 'dispatched' and not private.order_job_has_remaining_production(new.company_id, v_job.order_id, v_job.id)) then
    raise exception 'Order is no longer eligible for press release' using errcode = '23514';
  end if;
  select * into v_die from public.dies where id = v_job.die_id and company_id = new.company_id for update nowait;
  if not found or v_die.profile_id is distinct from v_job.profile_id or v_die.die_status not in ('active','approved') then
    raise exception 'Assigned die is no longer eligible for press release' using errcode = '23514';
  end if;
  select * into v_machine from public.machines where id = new.machine_id and company_id = new.company_id for update nowait;
  if not found or v_machine.machine_type <> 'extrusion_press' or v_machine.is_active is distinct from true
    or v_machine.status not in ('active','operational','idle') then
    raise exception 'Selected extrusion press is no longer eligible for release' using errcode = '23514';
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Production resource is being changed; retry release after refresh' using errcode = '55P03';
end;
$$;

revoke all on function private.validate_production_slot_release_resources() from public, anon, authenticated;
drop trigger if exists validate_production_slot_release_resources on public.production_plan_slots;
create trigger validate_production_slot_release_resources before insert or update of status on public.production_plan_slots
for each row execute function private.validate_production_slot_release_resources();

create or replace function private.order_has_remaining_production(p_company_id uuid, p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_header numeric := 0;
  v_line_total numeric := 0;
  v_job_total numeric := 0;
  v_stock_total numeric := 0;
  v_lines integer := 0;
begin
  select coalesce(production_quantity_kg, manufacturing_weight_kg, 0) into v_header
  from public.orders where id = p_order_id and company_id = p_company_id;
  if not found then return false; end if;
  select count(*), coalesce(sum(quantity_kg), 0) into v_lines, v_line_total
  from public.order_items where company_id = p_company_id and order_id = p_order_id;
  if v_lines > 0 then
    return exists (
      select 1 from public.order_items line
      where line.company_id = p_company_id and line.order_id = p_order_id
        and line.quantity_kg is not null and line.quantity_kg > 0
        and line.quantity_kg > coalesce((
          select sum(case when job.status = 'completed' and coalesce(job.actual_quantity_kg, 0) > 0
            then job.actual_quantity_kg else job.planned_quantity_kg end)
          from public.production_jobs job where job.company_id = p_company_id and job.order_id = p_order_id
            and job.source_line_id = line.id and job.status <> 'cancelled'
        ), 0) + coalesce((
          select sum(fulfillment.fulfilled_weight_kg) from public.order_dealer_stock_fulfillments fulfillment
          where fulfillment.company_id = p_company_id and fulfillment.order_id = p_order_id
            and fulfillment.order_item_id = line.id and fulfillment.credited_at is null
        ), 0) + 0.001
    );
  end if;
  select coalesce(sum(case when status = 'completed' and coalesce(actual_quantity_kg, 0) > 0
    then actual_quantity_kg else planned_quantity_kg end), 0)
  into v_job_total from public.production_jobs
  where company_id = p_company_id and order_id = p_order_id and status <> 'cancelled';
  select coalesce(sum(fulfilled_weight_kg), 0) into v_stock_total
  from public.order_dealer_stock_fulfillments
  where company_id = p_company_id and order_id = p_order_id and credited_at is null;
  return greatest(v_header, v_line_total) > v_job_total + v_stock_total + 0.001;
end;
$$;
revoke all on function private.order_has_remaining_production(uuid, uuid) from public, anon, authenticated;

create or replace function private.order_job_has_remaining_production(p_company_id uuid, p_order_id uuid, p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_header numeric := 0;
  v_line_count integer := 0;
  v_line_id uuid;
  v_target numeric := 0;
  v_committed numeric := 0;
  v_stock numeric := 0;
begin
  select coalesce(production_quantity_kg, manufacturing_weight_kg, 0) into v_header
  from public.orders where id = p_order_id and company_id = p_company_id;
  if not found then return false; end if;
  select count(*) into v_line_count from public.order_items where company_id = p_company_id and order_id = p_order_id;
  if v_line_count > 0 then
    select id, coalesce(quantity_kg, case when v_line_count = 1 then v_header else 0 end) into v_line_id, v_target
    from public.order_items where company_id = p_company_id and order_id = p_order_id
      and id = (select source_line_id from public.production_jobs where id = p_job_id and company_id = p_company_id);
    if not found or v_target <= 0 then return false; end if;
    select coalesce(sum(case when status='completed' and coalesce(actual_quantity_kg,0)>0 then actual_quantity_kg else planned_quantity_kg end),0)
    into v_committed from public.production_jobs where company_id=p_company_id and order_id=p_order_id
      and source_line_id=v_line_id and status<>'cancelled' and id<>p_job_id;
    select coalesce(sum(fulfilled_weight_kg),0) into v_stock from public.order_dealer_stock_fulfillments
    where company_id=p_company_id and order_id=p_order_id and order_item_id=v_line_id and credited_at is null;
  else
    v_target := v_header;
    select coalesce(sum(case when status='completed' and coalesce(actual_quantity_kg,0)>0 then actual_quantity_kg else planned_quantity_kg end),0)
    into v_committed from public.production_jobs where company_id=p_company_id and order_id=p_order_id
      and status<>'cancelled' and id<>p_job_id;
    select coalesce(sum(fulfilled_weight_kg),0) into v_stock from public.order_dealer_stock_fulfillments
    where company_id=p_company_id and order_id=p_order_id and credited_at is null;
  end if;
  return v_target > v_committed + v_stock + 0.001;
end;
$$;
revoke all on function private.order_job_has_remaining_production(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.guard_production_order_balance()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_order public.orders%rowtype;
  v_line public.order_items%rowtype;
  v_target numeric;
  v_committed numeric;
  v_stock numeric;
  v_line_count integer;
  v_exclude_job_id uuid;
begin
  if tg_op = 'UPDATE' then v_exclude_job_id := old.id; end if;
  if tg_op = 'UPDATE' and old.order_id is not distinct from new.order_id and old.source_line_id is not distinct from new.source_line_id
    and old.planned_quantity_kg is not distinct from new.planned_quantity_kg and old.actual_quantity_kg is not distinct from new.actual_quantity_kg
    and old.status is not distinct from new.status then return new; end if;
  if new.order_id is null or new.status = 'cancelled' then return new; end if;
  select * into v_order from public.orders where id = new.order_id and company_id = new.company_id for update nowait;
  if not found or v_order.current_stage in ('closed','cancelled','delivered','payment_pending') then
    raise exception 'Order is not available for production commitment' using errcode = '23514';
  end if;
  select count(*) into v_line_count from public.order_items where company_id = new.company_id and order_id = new.order_id;
  if v_line_count > 0 then
    if new.source_line_id is null then raise exception 'Select the exact order line before committing production quantity'; end if;
    select * into v_line from public.order_items where id = new.source_line_id and company_id = new.company_id and order_id = new.order_id for update nowait;
    if not found then raise exception 'Production order line does not belong to the selected order'; end if;
    v_target := v_line.quantity_kg;
    if v_target is null and v_line_count = 1 then v_target := coalesce(v_order.production_quantity_kg, v_order.manufacturing_weight_kg); end if;
    if v_target is null or v_target <= 0 then raise exception 'Order line lacks an authoritative kilogram quantity for safe production planning'; end if;
    select coalesce(sum(case when job.status = 'completed' and coalesce(job.actual_quantity_kg, 0) > 0 then job.actual_quantity_kg else job.planned_quantity_kg end), 0)
      into v_committed from public.production_jobs job
      where job.company_id = new.company_id and job.order_id = new.order_id and job.source_line_id = new.source_line_id
        and job.status <> 'cancelled' and (v_exclude_job_id is null or job.id <> v_exclude_job_id);
    select coalesce(sum(fulfilled_weight_kg), 0) into v_stock from public.order_dealer_stock_fulfillments
      where company_id = new.company_id and order_id = new.order_id and order_item_id = new.source_line_id and credited_at is null;
  else
    v_target := coalesce(v_order.production_quantity_kg, v_order.manufacturing_weight_kg, 0);
    select coalesce(sum(case when job.status = 'completed' and coalesce(job.actual_quantity_kg, 0) > 0 then job.actual_quantity_kg else job.planned_quantity_kg end), 0)
      into v_committed from public.production_jobs job
      where job.company_id = new.company_id and job.order_id = new.order_id and job.status <> 'cancelled'
        and (v_exclude_job_id is null or job.id <> v_exclude_job_id);
    select coalesce(sum(fulfilled_weight_kg), 0) into v_stock from public.order_dealer_stock_fulfillments
      where company_id = new.company_id and order_id = new.order_id and credited_at is null;
  end if;
  if v_target <= 0 or v_committed + v_stock + (case when new.status = 'completed' then coalesce(new.actual_quantity_kg, 0) else coalesce(new.planned_quantity_kg, 0) end) > v_target + 0.001 then
    raise exception 'Production commitment exceeds the order line remaining kilogram balance';
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Order or line balance is being changed; retry production planning after refresh' using errcode = '55P03';
end;
$$;
revoke all on function private.guard_production_order_balance() from public, anon, authenticated;
drop trigger if exists guard_production_order_balance on public.production_jobs;
create trigger guard_production_order_balance before insert or update of company_id, order_id, source_line_id, planned_quantity_kg, actual_quantity_kg, status
on public.production_jobs for each row execute function private.guard_production_order_balance();

create or replace function private.save_production_schedule_slot_atomic(p_slot_id uuid, p_slot jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_job_id uuid := nullif(p_slot ->> 'production_job_id', '')::uuid;
  v_machine_id uuid := nullif(p_slot ->> 'machine_id', '')::uuid;
  v_start timestamptz := nullif(p_slot ->> 'planned_start_at', '')::timestamptz;
  v_end timestamptz := nullif(p_slot ->> 'planned_end_at', '')::timestamptz;
  v_status text := coalesce(nullif(p_slot ->> 'status', ''), 'scheduled');
  v_existing public.production_plan_slots%rowtype;
  v_job public.production_jobs%rowtype;
  v_slot_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager','production') then raise exception 'Permission denied to schedule production jobs' using errcode = '42501'; end if;
  if v_job_id is null or v_machine_id is null or v_start is null or v_end is null then raise exception 'Production job, extrusion press, start, and end are required' using errcode = '23514'; end if;
  if v_end <= v_start then raise exception 'Planned end must be after planned start' using errcode = '23514'; end if;
  if v_status not in ('draft','scheduled') then raise exception 'Use the release action to release a scheduled slot' using errcode = '23514'; end if;

  select * into v_job from public.production_jobs where id = v_job_id and company_id = v_company_id for update;
  if not found or v_job.status not in ('planned','ready','on_hold') then raise exception 'Production job is not eligible for press scheduling' using errcode = '23514'; end if;
  perform 1 from public.orders order_record where order_record.id = v_job.order_id and order_record.company_id = v_company_id
    and order_record.current_stage not in ('closed','cancelled','delivered','payment_pending')
    and (order_record.current_stage <> 'dispatched' or private.order_job_has_remaining_production(v_company_id, v_job.order_id, v_job.id))
  for update;
  if not found then raise exception 'Production job order has no remaining eligible quantity for press scheduling' using errcode = '23514'; end if;
  perform 1 from public.dies die where die.id = v_job.die_id and die.company_id = v_company_id and die.profile_id = v_job.profile_id
    and die.die_status in ('active','approved') for update;
  if not found then raise exception 'Assigned die is no longer available for production scheduling' using errcode = '23514'; end if;
  perform 1 from public.machines machine where machine.id = v_machine_id and machine.company_id = v_company_id
    and machine.machine_type = 'extrusion_press' and machine.is_active = true and machine.status in ('active','operational','idle')
  for update;
  if not found then raise exception 'Selected extrusion press is not available for planning' using errcode = '23514'; end if;

  if p_slot_id is not null then
    select * into v_existing from public.production_plan_slots where id = p_slot_id and company_id = v_company_id for update;
    if not found then raise exception 'Production schedule slot not found for this company' using errcode = '23514'; end if;
    if v_existing.status = 'released' then raise exception 'Released press slots are locked and cannot be rescheduled' using errcode = '23514'; end if;
    if v_existing.production_job_id <> v_job_id then raise exception 'A schedule slot cannot be reassigned to a different production job' using errcode = '23514'; end if;
    update public.production_plan_slots set machine_id = v_machine_id, planned_start_at = v_start, planned_end_at = v_end,
      shift = nullif(p_slot ->> 'shift',''), sequence_number = greatest(coalesce(nullif(p_slot ->> 'sequence_number','')::integer,0),0),
      capacity_kg = nullif(p_slot ->> 'capacity_kg','')::numeric, status = v_status, locked_by = null, locked_at = null, updated_at = now()
    where id = p_slot_id and company_id = v_company_id returning id into v_slot_id;
  else
    insert into public.production_plan_slots(company_id, production_job_id, machine_id, planned_start_at, planned_end_at, shift,
      sequence_number, capacity_kg, status, created_by)
    values (v_company_id, v_job_id, v_machine_id, v_start, v_end, nullif(p_slot ->> 'shift',''),
      greatest(coalesce(nullif(p_slot ->> 'sequence_number','')::integer,0),0), nullif(p_slot ->> 'capacity_kg','')::numeric, v_status, auth.uid())
    returning id into v_slot_id;
  end if;

  update public.production_jobs set machine_id = v_machine_id,
    planned_date = (v_start at time zone 'Asia/Kolkata')::date,
    shift = nullif(p_slot ->> 'shift',''),
    status = v_job.status,
    updated_at = now()
  where id = v_job_id and company_id = v_company_id;
  return v_slot_id;
end;
$$;

revoke all on function private.save_production_schedule_slot_atomic(uuid, jsonb) from public, anon, authenticated;

create or replace function private.transition_production_job_atomic(p_job_id uuid, p_status text, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_job public.production_jobs%rowtype;
  v_has_released_slot boolean;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager','production') then raise exception 'Permission denied to transition production jobs' using errcode = '42501'; end if;
  if p_status not in ('planned','ready','in_progress','on_hold','cancelled') then raise exception 'Use the completion workflow for completed production jobs' using errcode = '23514'; end if;
  select * into v_job from public.production_jobs where id = p_job_id and company_id = v_company_id for update;
  if not found then raise exception 'Production job not found for this company' using errcode = '23514'; end if;
  if p_status = v_job.status then return v_job.id; end if;
  if not ((v_job.status = 'planned' and p_status in ('on_hold','cancelled'))
    or (v_job.status = 'ready' and p_status in ('in_progress','on_hold','cancelled'))
    or (v_job.status = 'in_progress' and p_status = 'on_hold')
    or (v_job.status = 'on_hold' and p_status in ('in_progress','cancelled'))) then
    raise exception 'Illegal production status transition from % to %', v_job.status, p_status using errcode = '23514';
  end if;
  if p_status in ('in_progress','on_hold') and v_job.machine_id is null then raise exception 'Assign an extrusion press before starting or holding production' using errcode = '23514'; end if;
  if p_status = 'in_progress' then
    select exists (select 1 from public.production_plan_slots slot where slot.company_id = v_company_id
      and slot.production_job_id = v_job.id and slot.machine_id = v_job.machine_id and slot.status = 'released') into v_has_released_slot;
    if not v_has_released_slot then raise exception 'Production job requires a released press slot before it can start' using errcode = '23514'; end if;
  end if;
  update public.production_jobs set status = p_status,
    remarks = case when nullif(btrim(p_reason),'') is null then remarks when nullif(btrim(remarks),'') is null then btrim(p_reason) else remarks || E'\n' || btrim(p_reason) end,
    updated_at = now()
  where id = v_job.id and company_id = v_company_id;
  insert into public.production_job_status_history(company_id, production_job_id, previous_status, new_status, reason, changed_by, changed_by_role)
  values (v_company_id, v_job.id, v_job.status, p_status, nullif(btrim(p_reason),''), auth.uid(), v_role);
  return v_job.id;
end;
$$;

revoke all on function private.transition_production_job_atomic(uuid, text, text) from public, anon, authenticated;

create or replace function private.consume_dispatch_reservations(p_dispatch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_dispatch record;
  v_group record;
  v_reservation record;
  v_batch record;
  v_used record;
  v_existing public.profile_stock_consumptions%rowtype;
  v_remaining_weight numeric;
  v_remaining_length numeric;
  v_remaining_pieces integer;
begin
  select id, company_id, order_id into v_dispatch
  from public.dispatches where id = p_dispatch_id for update;
  if not found then raise exception 'Dispatch not found'; end if;

  for v_group in
    select reservation_id, profile_stock_batch_id, profile_id,
      round(sum(net_weight_kg), 3) consumed_weight_kg,
      round(sum(net_length_m), 3) consumed_length_m,
      sum(number_of_pieces)::integer consumed_pieces
    from public.packing_list_items
    where dispatch_id = p_dispatch_id and company_id = v_dispatch.company_id and source_kind = 'reservation'
    group by reservation_id, profile_stock_batch_id, profile_id
    order by reservation_id
  loop
    select * into v_reservation
    from public.profile_stock_reservations
    where id = v_group.reservation_id and company_id = v_dispatch.company_id and order_id = v_dispatch.order_id
    for update;
    if not found or v_reservation.profile_stock_batch_id <> v_group.profile_stock_batch_id
      or v_reservation.profile_id <> v_group.profile_id or v_reservation.status not in ('active', 'consumed') then
      raise exception 'Reservation is stale or no longer available for dispatch';
    end if;
    if v_reservation.reserved_pieces is null or v_reservation.initial_reserved_weight_kg is null
      or v_reservation.initial_reserved_length_m is null or v_reservation.initial_reserved_pieces is null then
      raise exception 'Legacy reservation lacks exact metre or piece provenance and cannot be consumed';
    end if;

    select * into v_existing from public.profile_stock_consumptions
    where company_id = v_dispatch.company_id and dispatch_id = p_dispatch_id and reservation_id = v_reservation.id
    for update;
    if found then
      if v_existing.consumed_weight_kg is distinct from v_group.consumed_weight_kg
        or v_existing.consumed_length_m is distinct from v_group.consumed_length_m
        or v_existing.consumed_pieces is distinct from v_group.consumed_pieces then
        raise exception 'Posted dispatch consumption is immutable';
      end if;
      continue;
    end if;

    select coalesce(sum(consumed_weight_kg), 0) weight_kg,
      coalesce(sum(consumed_length_m), 0) length_m, coalesce(sum(consumed_pieces), 0) pieces
    into v_used
    from public.profile_stock_consumptions
    where reservation_id = v_reservation.id and company_id = v_dispatch.company_id and dispatch_id <> p_dispatch_id;
    if v_used.weight_kg + v_group.consumed_weight_kg > v_reservation.initial_reserved_weight_kg + 0.001
      or v_used.length_m + v_group.consumed_length_m > v_reservation.initial_reserved_length_m + 0.001
      or v_used.pieces + v_group.consumed_pieces > v_reservation.initial_reserved_pieces then
      raise exception 'Dispatch exceeds the reservation remaining weight, metre, or piece balance';
    end if;

    insert into public.profile_stock_consumptions (
      company_id, reservation_id, profile_stock_batch_id, profile_id, order_id, dispatch_id,
      consumed_weight_kg, consumed_length_m, consumed_pieces, notes, created_by
    ) values (
      v_dispatch.company_id, v_reservation.id, v_reservation.profile_stock_batch_id, v_reservation.profile_id,
      v_reservation.order_id, p_dispatch_id, v_group.consumed_weight_kg, v_group.consumed_length_m,
      v_group.consumed_pieces, 'Consumed from operator-verified packing ledger', auth.uid()
    );

    select * into v_batch from public.profile_stock_batches
    where id = v_reservation.profile_stock_batch_id and company_id = v_dispatch.company_id for update;
    if not found or v_batch.total_weight_kg + 0.001 < v_group.consumed_weight_kg
      or v_batch.length_m + 0.001 < v_group.consumed_length_m
      or v_batch.quantity_pieces < v_group.consumed_pieces then
      raise exception 'Reserved stock batch no longer contains the exact dispatched quantity';
    end if;

    v_remaining_weight := round(v_reservation.initial_reserved_weight_kg - v_used.weight_kg - v_group.consumed_weight_kg, 3);
    v_remaining_length := round(v_reservation.initial_reserved_length_m - v_used.length_m - v_group.consumed_length_m, 3);
    v_remaining_pieces := v_reservation.initial_reserved_pieces - v_used.pieces - v_group.consumed_pieces;

    update public.profile_stock_batches set
      total_weight_kg = round(greatest(total_weight_kg - v_group.consumed_weight_kg, 0), 3),
      length_m = round(greatest(length_m - v_group.consumed_length_m, 0), 3),
      quantity_pieces = greatest(quantity_pieces - v_group.consumed_pieces, 0),
      status = case when total_weight_kg - v_group.consumed_weight_kg <= 0.001 then 'dispatched' else 'reserved' end
    where id = v_batch.id and company_id = v_dispatch.company_id;

    if v_remaining_weight <= 0.001 and v_remaining_length <= 0.001 and v_remaining_pieces = 0 then
      update public.profile_stock_reservations set status = 'consumed', released_at = now()
      where id = v_reservation.id and company_id = v_dispatch.company_id;
    end if;
  end loop;
end;
$$;

revoke all on function private.consume_dispatch_reservations(uuid) from public, anon, authenticated;

create or replace function private.assert_dispatch_source_units(p_dispatch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_dispatch public.dispatches%rowtype;
  v_source record;
  v_available record;
  v_used record;
begin
  select * into v_dispatch from public.dispatches where id = p_dispatch_id for update;
  if not found then raise exception 'Dispatch not found'; end if;

  for v_source in
    select source_kind, source_line_id, reservation_id, profile_stock_batch_id, profile_id,
      round(sum(net_weight_kg), 3) weight_kg, round(sum(net_length_m), 3) length_m,
      sum(number_of_pieces)::integer pieces
    from public.packing_list_items
    where company_id = v_dispatch.company_id and dispatch_id = p_dispatch_id
    group by source_kind, source_line_id, reservation_id, profile_stock_batch_id, profile_id
    order by coalesce(reservation_id, source_line_id)
  loop
    if v_source.source_kind = 'reservation' then
      select r.initial_reserved_weight_kg weight_kg,
        r.initial_reserved_length_m length_m,
        r.initial_reserved_pieces pieces
      into v_available
      from public.profile_stock_reservations r
      where r.id = v_source.reservation_id and r.company_id = v_dispatch.company_id
        and r.order_id = v_dispatch.order_id and r.profile_id = v_source.profile_id
        and r.profile_stock_batch_id = v_source.profile_stock_batch_id and r.status = 'active'
      for update of r;
    elsif v_source.source_kind = 'dealer_stock' then
      select f.fulfilled_weight_kg weight_kg, f.fulfilled_length_m length_m, f.fulfilled_pieces pieces
      into v_available from public.order_dealer_stock_fulfillments f
      where f.id = v_source.source_line_id and f.company_id = v_dispatch.company_id
        and f.order_id = v_dispatch.order_id and f.profile_id = v_source.profile_id and f.credited_at is null
      for update;
    else
      select j.actual_quantity_kg weight_kg, j.actual_meters length_m, j.actual_pieces pieces
      into v_available from public.production_jobs j
      where j.id = v_source.source_line_id and j.company_id = v_dispatch.company_id
        and j.order_id = v_dispatch.order_id and j.profile_id = v_source.profile_id and j.status = 'completed'
      for update;
    end if;
    if not found or v_available.weight_kg is null or v_available.length_m is null or v_available.pieces is null then
      raise exception 'Dispatch source lacks exact kilograms, metres, or piece provenance';
    end if;

    select coalesce(sum(i.net_weight_kg), 0) weight_kg,
      coalesce(sum(i.net_length_m), 0) length_m, coalesce(sum(i.number_of_pieces), 0) pieces
    into v_used
    from public.packing_list_items i join public.dispatches d on d.id = i.dispatch_id and d.company_id = i.company_id
    where i.company_id = v_dispatch.company_id and i.source_line_id = v_source.source_line_id
      and i.dispatch_id <> p_dispatch_id and d.delivery_status <> 'pending';

    if v_used.weight_kg + v_source.weight_kg > v_available.weight_kg + 0.001
      or v_used.length_m + v_source.length_m > v_available.length_m + 0.001
      or v_used.pieces + v_source.pieces > v_available.pieces then
      raise exception 'Dispatch packing exceeds the source remaining weight, metre, or piece balance';
    end if;
  end loop;
end;
$$;

revoke all on function private.assert_dispatch_source_units(uuid) from public, anon, authenticated;

create table if not exists private.dispatch_activation_authorizations (
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  transaction_id bigint not null,
  primary key (dispatch_id, transaction_id)
);
revoke all on private.dispatch_activation_authorizations from public, anon, authenticated;

create or replace function private.save_ready_dispatch_atomic(
  p_dispatch_id uuid,
  p_dispatch jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_current record;
  v_payload jsonb := p_dispatch;
  v_dispatch_id uuid;
  v_tare_weight numeric := round(coalesce(nullif(p_dispatch ->> 'total_tare_weight_kg', '')::numeric, 0), 3);
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied for dispatches' using errcode = '42501';
  end if;
  if v_tare_weight < 0 then raise exception 'Total tare weight cannot be negative'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A dispatch requires at least one physical bundle';
  end if;
  if p_dispatch_id is null then
    v_payload := v_payload || jsonb_build_object('delivery_status', 'pending');
  else
    select order_id, delivery_status into v_current from public.dispatches
    where id = p_dispatch_id and company_id = v_company_id for update;
    if not found then raise exception 'Dispatch not found for this company'; end if;
    if v_current.delivery_status <> 'pending' then raise exception 'Activated dispatch packing cannot be edited; use the delivery workflow for status and logistics updates'; end if;
    if nullif(v_payload ->> 'order_id', '')::uuid <> v_current.order_id then raise exception 'Dispatch order cannot be changed after creation'; end if;
    v_payload := v_payload || jsonb_build_object('delivery_status', v_current.delivery_status);
  end if;

  v_payload := v_payload || jsonb_build_object('number_of_bundles', jsonb_array_length(p_items));
  v_dispatch_id := private.save_dispatch_atomic(p_dispatch_id, v_payload, p_items, null);
  update public.dispatches set total_tare_weight_kg = v_tare_weight, updated_at = now()
  where id = v_dispatch_id and company_id = v_company_id;
  insert into private.dispatch_activation_authorizations(dispatch_id, transaction_id)
  values (v_dispatch_id, txid_current());
  update public.dispatches set delivery_status = 'dispatched', updated_at = now()
  where id = v_dispatch_id and company_id = v_company_id;
  perform private.assert_dispatch_ready(v_dispatch_id);
  perform private.consume_dispatch_reservations(v_dispatch_id);
  perform private.assert_dispatch_ready(v_dispatch_id);
  perform private.sync_order_delivery_stage(v_company_id, nullif(v_payload ->> 'order_id', '')::uuid,
    'Dispatch created from exact physical bundles and source-linked stock.');
  return v_dispatch_id;
end;
$$;

revoke all on function private.save_ready_dispatch_atomic(uuid, jsonb, jsonb) from public, anon, authenticated;

create or replace function private.set_actual_dispatch_activation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' then
    if new.delivery_status <> 'pending' or new.actual_dispatched_at is not null then
      raise exception 'Dispatches must be created pending; actual activation time is database recorded';
    end if;
    return new;
  end if;
  if new.actual_dispatched_at is distinct from old.actual_dispatched_at then raise exception 'Actual dispatch activation time is immutable'; end if;
  if old.delivery_status = 'pending' and new.delivery_status = 'dispatched' then
    perform 1 from private.dispatch_activation_authorizations
    where dispatch_id = old.id and transaction_id = txid_current()
    for update;
    if not found then raise exception 'Dispatch activation must use the verified stock posting workflow' using errcode = '42501'; end if;
    delete from private.dispatch_activation_authorizations
    where dispatch_id = old.id and transaction_id = txid_current();
    perform private.assert_dispatch_ready(old.id);
    perform private.assert_dispatch_source_units(old.id);
    new.actual_dispatched_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function private.transition_dispatch_delivery_atomic(
  p_dispatch_id uuid,
  p_status text,
  p_proof_of_delivery_url text,
  p_remarks text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_dispatch public.dispatches%rowtype;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied for dispatches' using errcode = '42501';
  end if;
  select * into v_dispatch from public.dispatches where id = p_dispatch_id and company_id = v_company_id for update;
  if not found then raise exception 'Dispatch not found for this company'; end if;
  if v_dispatch.delivery_status = 'pending' and p_status = 'dispatched' then
    insert into private.dispatch_activation_authorizations(dispatch_id, transaction_id)
    values (v_dispatch.id, txid_current());
  end if;
  update public.dispatches set delivery_status = p_status,
    proof_of_delivery_url = case when nullif(btrim(coalesce(p_proof_of_delivery_url, '')), '') is not null
      then btrim(p_proof_of_delivery_url) else proof_of_delivery_url end,
    remarks = case when nullif(btrim(coalesce(p_remarks, '')), '') is not null then btrim(p_remarks) else remarks end,
    updated_at = now()
  where id = v_dispatch.id and company_id = v_company_id;
  if v_dispatch.delivery_status = 'pending' and p_status = 'dispatched' then
    perform private.consume_dispatch_reservations(v_dispatch.id);
    perform private.sync_order_delivery_stage(v_company_id, v_dispatch.order_id, 'Dispatch activated from verified packing.');
  end if;
  return v_dispatch.order_id;
end;
$$;

revoke all on function private.transition_dispatch_delivery_atomic(uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.set_actual_dispatch_activation() from public, anon, authenticated;

create or replace function public.save_ready_dispatch_atomic(p_dispatch_id uuid, p_dispatch jsonb, p_items jsonb)
returns uuid
language sql
security definer
set search_path = public, private
as $$ select private.save_ready_dispatch_atomic(p_dispatch_id, p_dispatch, p_items) $$;

create or replace function public.transition_dispatch_delivery_atomic(p_dispatch_id uuid, p_status text, p_proof_of_delivery_url text, p_remarks text)
returns uuid
language sql
security definer
set search_path = public, private
as $$ select private.transition_dispatch_delivery_atomic(p_dispatch_id, p_status, p_proof_of_delivery_url, p_remarks) $$;

revoke all on function public.save_ready_dispatch_atomic(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.transition_dispatch_delivery_atomic(uuid, text, text, text) from public, anon;
grant execute on function public.save_ready_dispatch_atomic(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.transition_dispatch_delivery_atomic(uuid, text, text, text) to authenticated;

create or replace function public.issue_dispatch_return_credit_note_atomic(
  p_dispatch_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language sql
security definer
set search_path = public, private
as $$ select private.issue_dispatch_return_credit_note_atomic(p_dispatch_id, p_reason, p_idempotency_key) $$;

create or replace function public.reverse_credit_note_atomic(p_credit_note_id uuid, p_reason text)
returns uuid
language sql
security definer
set search_path = public, private
as $$ select private.reverse_credit_note_atomic(p_credit_note_id, p_reason) $$;

revoke all on function public.issue_dispatch_return_credit_note_atomic(uuid, text, uuid) from public, anon;
revoke all on function public.reverse_credit_note_atomic(uuid, text) from public, anon;
grant execute on function public.issue_dispatch_return_credit_note_atomic(uuid, text, uuid) to authenticated;
grant execute on function public.reverse_credit_note_atomic(uuid, text) to authenticated;

drop trigger if exists set_actual_dispatch_activation on public.dispatches;
create trigger set_actual_dispatch_activation
before insert or update of delivery_status, actual_dispatched_at on public.dispatches
for each row execute function private.set_actual_dispatch_activation();

create or replace function public.allocate_billets_by_priority(p_company_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := coalesce(p_company_id, private.get_current_user_company_id());
  v_req record;
  v_billet record;
  v_needed integer;
  v_previous_status text;
  v_order_status text;
begin
  if v_company_id is null then return; end if;
  if auth.uid() is not null and v_company_id is distinct from private.get_current_user_company_id() then
    raise exception 'Cannot allocate billets outside the active company' using errcode='42501';
  end if;
  if auth.uid() is not null and private.get_current_user_role() not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'Permission denied to allocate billets' using errcode='42501';
  end if;

  for v_req in
    select r.*, o.order_number, o.priority, o.expected_dispatch_date, o.order_date, o.current_stage
    from public.order_billet_requirements r
    join public.orders o on o.id=r.order_id and o.company_id=r.company_id
    where r.company_id=v_company_id and r.status in ('pending','partial','shortage')
      and o.current_stage not in ('closed','cancelled','delivered','payment_pending')
      and (o.current_stage <> 'dispatched' or private.order_has_remaining_production(v_company_id,o.id)
        or exists(select 1 from public.production_jobs job where job.company_id=v_company_id and job.order_id=o.id
          and job.profile_id=r.profile_id and job.status in ('planned','ready','in_progress','on_hold')))
    order by case o.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
      o.expected_dispatch_date nulls last,o.order_date,o.created_at
  loop
    perform 1 from public.orders where id=v_req.order_id and company_id=v_company_id for update;
    v_previous_status := v_req.status;
    perform public.refresh_order_billet_allocations(v_req.order_id);
    select greatest(billets_required-billets_allocated,0) into v_needed
      from public.order_billet_requirements where id=v_req.id for update;
    for v_billet in
      select id from public.foundry_billets
      where company_id=v_company_id and status='cast' and order_id is null and allocation_requirement_id is null
        and lower(coalesce(alloy,''))=lower(v_req.alloy)
        and lower(coalesce(temper,''))=lower(coalesce(v_req.temper,''))
        and billet_diameter_inch=v_req.billet_diameter_inch
      order by case source_type when 'in_house' then 0 else 1 end,created_at,billet_code
      for update skip locked
    loop
      exit when v_needed<=0;
      update public.foundry_billets set order_id=v_req.order_id,allocation_requirement_id=v_req.id,
        status='allocated',allocated_at=now(),allocated_by=auth.uid()
      where id=v_billet.id and company_id=v_company_id and status='cast';
      v_needed:=v_needed-1;
    end loop;
    perform public.refresh_order_billet_allocations(v_req.order_id);
    select billet_allocation_status into v_order_status from public.orders where id=v_req.order_id and company_id=v_company_id;
    if v_order_status='complete' and v_previous_status<>'complete' then
      perform public.notify_billet_allocation(v_company_id,'Billet requirement complete',concat('Order ',v_req.order_number,' has all required billets allocated and is ready for production.'),'success',v_req.order_id);
    elsif v_needed>0 and v_previous_status<>'shortage' then
      perform public.notify_billet_allocation(v_company_id,'Billet shortage',concat('Order ',v_req.order_number,' still needs ',v_needed::text,' more billet',case when v_needed=1 then '' else 's' end,'. Schedule a foundry job or outsource compatible billets.'),'warning',v_req.order_id);
    end if;
  end loop;
end;
$$;

create or replace function private.allocate_billet_to_order(p_billet_id uuid, p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_billet record;
  v_req record;
  v_order record;
  v_locked_orders integer;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'You do not have permission to allocate billets' using errcode = '42501';
  end if;
  select * into v_billet from public.foundry_billets where id = p_billet_id and company_id = v_company_id;
  if v_billet.id is null then raise exception 'Billet not found' using errcode = '23514'; end if;
  if v_billet.status <> 'cast' or v_billet.order_id is not null then raise exception 'Only unallocated cast billets can be allocated manually' using errcode = '23514'; end if;
  perform 1 from public.orders where company_id=v_company_id and id in (p_order_id, v_billet.order_id) order by id for update nowait;
  get diagnostics v_locked_orders = row_count;
  if v_locked_orders < 1 then raise exception 'Order not found'; end if;
  select * into v_billet from public.foundry_billets where id=p_billet_id and company_id=v_company_id for update nowait;
  if v_billet.status <> 'cast' or v_billet.order_id is not null then raise exception 'Billet was allocated while this request was waiting'; end if;
  select id, order_number, current_stage into v_order from public.orders where id = p_order_id and company_id = v_company_id;
  if v_order.id is null then raise exception 'Order not found' using errcode = '23514'; end if;
  if v_order.current_stage in ('closed','cancelled','delivered','payment_pending')
    or (v_order.current_stage='dispatched' and not private.order_has_remaining_production(v_company_id,p_order_id)
      and not exists(select 1 from public.production_jobs job where job.company_id=v_company_id and job.order_id=p_order_id
        and job.profile_id=v_billet.profile_id and job.status in ('planned','ready','in_progress','on_hold'))) then
    raise exception 'This order has no remaining production eligible for billet allocation' using errcode = '23514';
  end if;
  perform public.rebuild_order_billet_requirements(p_order_id);
  select r.* into v_req from public.order_billet_requirements r
  where r.company_id = v_company_id and r.order_id = p_order_id
    and lower(r.alloy) = lower(coalesce(v_billet.alloy,''))
    and lower(coalesce(r.temper,'')) = lower(coalesce(v_billet.temper,''))
    and r.billet_diameter_inch = v_billet.billet_diameter_inch
    and r.billets_allocated < r.billets_required and r.status <> 'cancelled'
  order by r.created_at limit 1 for update;
  if v_req.id is null then
    if not exists(select 1 from public.order_billet_requirements r where r.company_id = v_company_id and r.order_id = p_order_id and lower(r.alloy)=lower(coalesce(v_billet.alloy,''))) then
      raise exception 'Billet alloy % does not match the alloy required for this order', v_billet.alloy using errcode = '23514';
    end if;
    if not exists(select 1 from public.order_billet_requirements r where r.company_id = v_company_id and r.order_id = p_order_id and r.billet_diameter_inch=v_billet.billet_diameter_inch) then
      raise exception 'Billet diameter % inch does not match the diameter required for this order', v_billet.billet_diameter_inch using errcode = '23514';
    end if;
    raise exception 'This order already has enough compatible billets allocated' using errcode = '23514';
  end if;
  update public.foundry_billets set order_id = p_order_id, allocation_requirement_id = v_req.id,
    status = 'allocated', allocated_at = now(), allocated_by = auth.uid()
  where id = p_billet_id and company_id = v_company_id;
  perform public.refresh_order_billet_allocations(p_order_id);
  if exists(select 1 from public.orders where id = p_order_id and company_id = v_company_id and billet_allocation_status = 'complete') then
    perform public.notify_billet_allocation(v_company_id,'Billet requirement complete',concat('Order ',v_order.order_number,' has all required billets allocated and is ready for production.'),'success',p_order_id);
  end if;
  return v_req.id;
end;
$$;
revoke all on function private.allocate_billet_to_order(uuid, uuid) from public, anon;
grant execute on function private.allocate_billet_to_order(uuid, uuid) to authenticated;

create or replace function private.reallocate_billet_to_order(p_billet_id uuid, p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_billet record;
  v_req record;
  v_order record;
  v_old_order_id uuid;
  v_locked_orders integer;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'You do not have permission to allocate billets' using errcode = '42501';
  end if;
  select * into v_billet from public.foundry_billets where id = p_billet_id and company_id = v_company_id;
  if v_billet.id is null then raise exception 'Billet not found' using errcode = '23514'; end if;
  if v_billet.status not in ('cast','allocated') then raise exception 'Only cast or allocated billets can be reallocated' using errcode = '23514'; end if;
  if v_billet.production_job_id is not null then raise exception 'This billet is already issued to a production job' using errcode = '23514'; end if;
  v_old_order_id := v_billet.order_id;
  perform 1 from public.orders where company_id=v_company_id and id in (p_order_id, v_old_order_id) order by id for update nowait;
  get diagnostics v_locked_orders = row_count;
  if v_locked_orders < 1 then raise exception 'Order not found'; end if;
  select * into v_billet from public.foundry_billets where id=p_billet_id and company_id=v_company_id for update nowait;
  if v_billet.order_id is distinct from v_old_order_id or v_billet.status not in ('cast','allocated') or v_billet.production_job_id is not null then
    raise exception 'Billet allocation changed while this request was waiting';
  end if;
  select id, order_number, current_stage into v_order from public.orders where id = p_order_id and company_id = v_company_id;
  if v_order.id is null then raise exception 'Order not found' using errcode = '23514'; end if;
  if v_order.current_stage in ('closed','cancelled','delivered','payment_pending') then raise exception 'This order is not open for billet allocation' using errcode = '23514'; end if;
  if v_order.current_stage='dispatched' and not private.order_has_remaining_production(v_company_id,p_order_id)
    and not exists(select 1 from public.production_jobs job where job.company_id=v_company_id and job.order_id=p_order_id
      and job.profile_id=v_billet.profile_id and job.status in ('planned','ready','in_progress','on_hold')) then
    raise exception 'This order has no remaining production eligible for billet allocation' using errcode='23514';
  end if;
  perform public.rebuild_order_billet_requirements(p_order_id);
  select r.* into v_req from public.order_billet_requirements r
  where r.company_id = v_company_id and r.order_id = p_order_id and lower(r.alloy)=lower(coalesce(v_billet.alloy,''))
    and lower(coalesce(r.temper,''))=lower(coalesce(v_billet.temper,''))
    and r.billet_diameter_inch = v_billet.billet_diameter_inch and r.billets_allocated < r.billets_required and r.status <> 'cancelled'
  order by r.created_at limit 1 for update;
  if v_req.id is null then
    if not exists(select 1 from public.order_billet_requirements r where r.company_id=v_company_id and r.order_id=p_order_id and lower(r.alloy)=lower(coalesce(v_billet.alloy,''))) then
      raise exception 'Billet alloy % does not match the alloy required for this order',v_billet.alloy using errcode='23514';
    end if;
    if not exists(select 1 from public.order_billet_requirements r where r.company_id=v_company_id and r.order_id=p_order_id and r.billet_diameter_inch=v_billet.billet_diameter_inch) then
      raise exception 'Billet diameter % inch does not match the diameter required for this order',v_billet.billet_diameter_inch using errcode='23514';
    end if;
    raise exception 'This order already has enough compatible billets allocated' using errcode='23514';
  end if;
  update public.foundry_billets set order_id = p_order_id, allocation_requirement_id = v_req.id,
    status = 'allocated', allocated_at = now(), allocated_by = auth.uid()
  where id = p_billet_id and company_id = v_company_id;
  if v_old_order_id is not null and v_old_order_id <> p_order_id then perform public.refresh_order_billet_allocations(v_old_order_id); end if;
  perform public.refresh_order_billet_allocations(p_order_id);
  if exists(select 1 from public.orders where id = p_order_id and company_id=v_company_id and billet_allocation_status='complete') then
    perform public.notify_billet_allocation(v_company_id,'Billet requirement complete',concat('Order ',v_order.order_number,' has all required billets allocated and is ready for production.'),'success',p_order_id);
  end if;
  return v_req.id;
end;
$$;
revoke all on function private.reallocate_billet_to_order(uuid, uuid) from public, anon;
grant execute on function private.reallocate_billet_to_order(uuid, uuid) to authenticated;

create table if not exists public.quality_rework_resolutions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  source_inspection_id uuid not null references public.quality_inspections(id) on delete restrict,
  production_job_id uuid not null references public.production_jobs(id) on delete restrict,
  finishing_job_id uuid references public.finishing_jobs(id) on delete restrict,
  profile_id uuid not null references public.aluminium_profiles(id) on delete restrict,
  source_quantity_kg numeric(14,3) not null check (source_quantity_kg > 0),
  approved_weight_kg numeric(14,3) not null check (approved_weight_kg >= 0),
  rejected_weight_kg numeric(14,3) not null check (rejected_weight_kg >= 0),
  reason text not null,
  inspector_name text not null,
  resolved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(company_id, source_inspection_id),
  check (round(approved_weight_kg + rejected_weight_kg, 3) = round(source_quantity_kg, 3))
);
alter table public.quality_rework_resolutions enable row level security;
drop policy if exists quality_rework_resolutions_company_read on public.quality_rework_resolutions;
create policy quality_rework_resolutions_company_read on public.quality_rework_resolutions
  for select to authenticated using (company_id = private.get_current_user_company_id());
revoke insert, update, delete on public.quality_rework_resolutions from public, anon, authenticated;
grant select on public.quality_rework_resolutions to authenticated;
alter table public.quality_inspections add column if not exists resolution_id uuid references public.quality_rework_resolutions(id) on delete restrict;

create or replace function public.list_open_quality_rework_inspections(p_offset integer default 0, p_limit integer default 10)
returns table(
  id uuid,
  batch_number text,
  quantity_checked_kg numeric,
  profile_id uuid,
  production_job_id uuid,
  profile_code text,
  profile_name text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 10);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null or v_company_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not coalesce(public.get_current_user_role() in ('owner','admin','production_manager','quality','viewer'), false) then
    raise exception 'Role is not authorized to read quality inspections' using errcode = '42501';
  end if;
  return query
  select q.id, q.batch_number, q.quantity_checked_kg, q.profile_id, q.production_job_id,
    p.profile_code, p.profile_name, count(*) over ()
  from public.quality_inspections q
  left join public.aluminium_profiles p on p.id = q.profile_id and p.company_id = q.company_id
  where q.company_id = v_company_id and q.status = 'rework'
    and not exists (
      select 1 from public.quality_rework_resolutions resolution
      where resolution.company_id = q.company_id and resolution.source_inspection_id = q.id
    )
  order by q.inspection_date, q.id
  offset v_offset limit v_limit;
end;
$$;
revoke all on function public.list_open_quality_rework_inspections(integer, integer) from public, anon;
grant execute on function public.list_open_quality_rework_inspections(integer, integer) to authenticated;

create table if not exists private.quality_resolution_authorizations (
  transaction_id bigint not null,
  resolution_id uuid not null references public.quality_rework_resolutions(id) on delete cascade,
  actor_id uuid not null,
  children_remaining integer not null,
  primary key (transaction_id, resolution_id)
);
revoke all on private.quality_resolution_authorizations from public, anon, authenticated;

create or replace function private.guard_quality_resolution_child()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare v_auth private.quality_resolution_authorizations%rowtype;
begin
  if new.resolution_id is null then return new; end if;
  select * into v_auth from private.quality_resolution_authorizations
  where transaction_id = txid_current() and resolution_id = new.resolution_id and actor_id = auth.uid() and children_remaining > 0
  for update;
  if not found then raise exception 'Quality rework resolutions must use the audited resolution action' using errcode = '42501'; end if;
  update private.quality_resolution_authorizations set children_remaining = children_remaining - 1
  where transaction_id = v_auth.transaction_id and resolution_id = v_auth.resolution_id;
  return new;
end;
$$;
revoke all on function private.guard_quality_resolution_child() from public, anon, authenticated;
drop trigger if exists guard_quality_resolution_child on public.quality_inspections;
create trigger guard_quality_resolution_child before insert or update of resolution_id on public.quality_inspections
for each row execute function private.guard_quality_resolution_child();

create or replace function private.guard_quality_resolution_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.resolution_id is not null or exists (
    select 1 from public.quality_rework_resolutions resolution
    where resolution.company_id = old.company_id and resolution.source_inspection_id = old.id
  ) then
    raise exception 'Resolved rework source and disposition evidence are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_quality_resolution_immutability() from public, anon, authenticated;
drop trigger if exists guard_quality_resolution_immutability on public.quality_inspections;
create trigger guard_quality_resolution_immutability before update or delete on public.quality_inspections
for each row execute function private.guard_quality_resolution_immutability();

create or replace function public.validate_quality_production_link()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job record;
  v_finishing record;
  v_source_kg numeric;
  v_disposed_kg numeric;
begin
  if new.production_job_id is null then
    if tg_op = 'INSERT' or new.status in ('approved','rejected','rework') then raise exception 'Select the completed production job inspected by this QC record' using errcode = '23514'; end if;
    return new;
  end if;
  select id, company_id, order_id, profile_id, status, actual_quantity_kg, finishing_type
  into v_job from public.production_jobs where id = new.production_job_id for update nowait;
  if not found or v_job.company_id <> new.company_id or v_job.profile_id <> new.profile_id or v_job.status <> 'completed' then
    raise exception 'QC must link to completed production for the same company/profile' using errcode = '23514';
  end if;
  v_source_kg := v_job.actual_quantity_kg;
  if coalesce(v_job.finishing_type,'mill_finish') <> 'mill_finish' then
    if new.finishing_job_id is null then raise exception 'Post-finishing QC must link the completed finishing job' using errcode = '23514'; end if;
    select id, company_id, production_job_id, status, output_weight_kg into v_finishing from public.finishing_jobs where id = new.finishing_job_id;
    if not found or v_finishing.company_id <> new.company_id or v_finishing.production_job_id <> new.production_job_id or v_finishing.status <> 'completed' then
      raise exception 'QC finishing job must be completed and match this production job' using errcode = '23514';
    end if;
    v_source_kg := v_finishing.output_weight_kg;
  elsif new.finishing_job_id is not null then raise exception 'Mill-finish QC must not link an unrelated finishing job' using errcode = '23514'; end if;

  if new.status in ('approved','rejected','rework') then
    if coalesce(new.quantity_checked_kg,0) <= 0 then raise exception 'QC disposition quantity must be greater than zero' using errcode = '23514'; end if;
    perform pg_advisory_xact_lock(hashtextextended('qc-disposition:' || new.company_id::text || ':' || new.production_job_id::text || ':' || coalesce(new.finishing_job_id::text,'mill-finish'),0));
    select coalesce(sum(q.quantity_checked_kg),0) into v_disposed_kg from public.quality_inspections q
    where q.company_id=new.company_id and q.production_job_id=new.production_job_id
      and coalesce(q.finishing_job_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(new.finishing_job_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and q.status in ('approved','rejected','rework') and q.id <> coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
      and not exists(select 1 from public.quality_rework_resolutions resolution where resolution.source_inspection_id=q.id);
    if v_disposed_kg + new.quantity_checked_kg > v_source_kg + 0.01 then raise exception 'QC disposition exceeds available source output (%)',v_source_kg using errcode='23514'; end if;
  end if;
  if new.status='approved' then
    if coalesce(btrim(new.inspector_name),'')='' then raise exception 'Approved QC requires an inspector name' using errcode='23514'; end if;
    if new.surface_finish_ok is distinct from true then raise exception 'QC cannot be approved while surface finish is marked failed' using errcode='23514'; end if;
  end if;
  if new.resolution_id is not null and not exists(select 1 from public.quality_rework_resolutions r where r.id=new.resolution_id
    and r.company_id=new.company_id and r.production_job_id=new.production_job_id and r.finishing_job_id is not distinct from new.finishing_job_id and r.profile_id=new.profile_id
    and ((new.status='approved' and new.quantity_checked_kg <= r.approved_weight_kg) or (new.status='rejected' and new.quantity_checked_kg <= r.rejected_weight_kg))) then
    raise exception 'Resolved QC disposition must match its immutable rework resolution';
  end if;
  return new;
exception when lock_not_available then
  raise exception 'Production output is being corrected; retry quality disposition after refresh' using errcode='55P03';
end;
$$;
revoke all on function public.validate_quality_production_link() from public, anon, authenticated;
drop trigger if exists validate_quality_production_link on public.quality_inspections;
create trigger validate_quality_production_link before insert or update of company_id, production_job_id, finishing_job_id,
  profile_id, status, quantity_checked_kg, inspector_name, surface_finish_ok, resolution_id on public.quality_inspections
for each row execute function public.validate_quality_production_link();

create or replace function public.resolve_quality_rework_atomic(
  p_inspection_id uuid,
  p_approved_weight_kg numeric,
  p_rejected_weight_kg numeric,
  p_inspector_name text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_source public.quality_inspections%rowtype;
  v_resolution_id uuid;
  v_children integer;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','quality_manager','quality') then raise exception 'Permission denied to resolve quality rework' using errcode='42501'; end if;
  if coalesce(p_approved_weight_kg,0)<0 or coalesce(p_rejected_weight_kg,0)<0 or length(btrim(coalesce(p_reason,'')))<8 or length(btrim(coalesce(p_inspector_name,'')))=0 then
    raise exception 'Enter non-negative approved/rejected kilograms, inspector name, and a reason of at least eight characters';
  end if;
  select * into v_source from public.quality_inspections where id=p_inspection_id and company_id=v_company_id and status='rework' for update;
  if not found then raise exception 'Open rework inspection not found'; end if;
  if round(p_approved_weight_kg + p_rejected_weight_kg,3) <> round(v_source.quantity_checked_kg,3) then
    raise exception 'Approved and rejected kilograms must exactly equal the original rework quantity';
  end if;
  if exists(select 1 from public.quality_rework_resolutions where company_id=v_company_id and source_inspection_id=v_source.id) then raise exception 'This rework inspection is already resolved'; end if;
  insert into public.quality_rework_resolutions(company_id,source_inspection_id,production_job_id,finishing_job_id,profile_id,
    source_quantity_kg,approved_weight_kg,rejected_weight_kg,reason,inspector_name,resolved_by)
  values(v_company_id,v_source.id,v_source.production_job_id,v_source.finishing_job_id,v_source.profile_id,
    v_source.quantity_checked_kg,round(p_approved_weight_kg,3),round(p_rejected_weight_kg,3),btrim(p_reason),btrim(p_inspector_name),auth.uid())
  returning id into v_resolution_id;
  v_children := (case when p_approved_weight_kg > 0 then 1 else 0 end) + (case when p_rejected_weight_kg > 0 then 1 else 0 end);
  insert into private.quality_resolution_authorizations(transaction_id,resolution_id,actor_id,children_remaining)
  values(txid_current(),v_resolution_id,auth.uid(),v_children);
  if p_approved_weight_kg > 0 then
    insert into public.quality_inspections(company_id,production_job_id,finishing_job_id,profile_id,inspection_date,batch_number,
      quantity_checked_kg,status,inspector_name,surface_finish_ok,notes,resolution_id)
    values(v_company_id,v_source.production_job_id,v_source.finishing_job_id,v_source.profile_id,now(),v_source.batch_number,
      round(p_approved_weight_kg,3),'approved',btrim(p_inspector_name),true,'Approved by linked immutable rework resolution '||v_resolution_id::text,v_resolution_id);
  end if;
  if p_rejected_weight_kg > 0 then
    insert into public.quality_inspections(company_id,production_job_id,finishing_job_id,profile_id,inspection_date,batch_number,
      quantity_checked_kg,status,inspector_name,surface_finish_ok,notes,resolution_id)
    values(v_company_id,v_source.production_job_id,v_source.finishing_job_id,v_source.profile_id,now(),v_source.batch_number,
      round(p_rejected_weight_kg,3),'rejected',btrim(p_inspector_name),false,'Rejected by linked immutable rework resolution '||v_resolution_id::text,v_resolution_id);
  end if;
  delete from private.quality_resolution_authorizations where transaction_id=txid_current() and resolution_id=v_resolution_id and children_remaining=0;
  return v_resolution_id;
end;
$$;
revoke all on function public.resolve_quality_rework_atomic(uuid,numeric,numeric,text,text) from public, anon;
grant execute on function public.resolve_quality_rework_atomic(uuid,numeric,numeric,text,text) to authenticated;

commit;
