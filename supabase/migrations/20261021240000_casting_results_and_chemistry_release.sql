-- EXOS-AUD-001: casting recorded the planned billets, not what was cast. Every
-- planned billet became allocatable 'cast' stock at theoretical weight the moment
-- the batch reached 'cast', before homogenising and with no chemistry approval,
-- and nothing could record rejected billets or the measured weight.
--
--   * public.record_foundry_cast_result(batch, good_count, measured_total_kg,
--     dross_kg, reject_reason): once per batch while it is cast/homogenizing.
--     Billets above the good count become 'scrap' and go to a foundry scrap lot
--     (alloy-tagged, category casting_reject); good billets get measured_weight_kg.
--   * public.record_foundry_chemistry_test / public.approve_foundry_chemistry_test:
--     spectrometer results per batch with pass/fail; approval by owner, admin,
--     quality or factory_manager, and not by the person who entered the test
--     (except the owner).
--   * A batch can move to 'ready' only with a cast result and an approved passing
--     chemistry test. Billets become allocatable ('cast') only when the batch is
--     ready; before that they stay 'planned'. Billets that were already cast
--     before this migration keep their status.
--   * public.reject_foundry_billet(billet, reason): an allocatable or allocated
--     billet found defective later goes to scrap and releases its allocation.
--   * Production mass balance uses the measured billet weight when recorded.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.foundry_billets add column if not exists measured_weight_kg numeric(14,3);
alter table public.foundry_billets drop constraint if exists foundry_billets_measured_weight_positive;
alter table public.foundry_billets add constraint foundry_billets_measured_weight_positive check (measured_weight_kg is null or measured_weight_kg > 0);
alter table public.foundry_billets add column if not exists rejected_reason text;

create table if not exists public.foundry_cast_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  foundry_batch_id uuid not null unique references public.foundry_batches(id) on delete cascade,
  planned_billet_count integer not null,
  good_billet_count integer not null check (good_billet_count >= 0),
  rejected_billet_count integer not null check (rejected_billet_count >= 0),
  measured_good_weight_kg numeric(14,3) not null check (measured_good_weight_kg >= 0),
  theoretical_good_weight_kg numeric(14,3) not null,
  dross_kg numeric(14,3) not null default 0 check (dross_kg >= 0),
  charged_kg numeric(14,3),
  melt_loss_kg numeric(14,3),
  reject_reason text,
  reject_scrap_lot_id uuid references public.foundry_aluminium_scrap(id) on delete set null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);
alter table public.foundry_cast_results enable row level security;
drop policy if exists "foundry cast results tenant read" on public.foundry_cast_results;
create policy "foundry cast results tenant read" on public.foundry_cast_results
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.foundry_cast_results from public, anon, authenticated;
grant select on public.foundry_cast_results to authenticated;

create table if not exists public.foundry_chemistry_tests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  foundry_batch_id uuid not null references public.foundry_batches(id) on delete cascade,
  sample_stage text not null check (sample_stage in ('melt','cast','retest')),
  spectrometer_reference text,
  composition jsonb not null default '{}'::jsonb,
  result text not null check (result in ('pass','fail')),
  notes text,
  tested_by uuid not null references auth.users(id),
  tested_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz
);
create index if not exists foundry_chemistry_tests_company_batch_idx on public.foundry_chemistry_tests(company_id, foundry_batch_id, tested_at desc);
alter table public.foundry_chemistry_tests enable row level security;
drop policy if exists "foundry chemistry tests tenant read" on public.foundry_chemistry_tests;
create policy "foundry chemistry tests tenant read" on public.foundry_chemistry_tests
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.foundry_chemistry_tests from public, anon, authenticated;
grant select on public.foundry_chemistry_tests to authenticated;

CREATE OR REPLACE FUNCTION public.sync_foundry_billets()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  -- EXOS-AUD-001: billets become allocatable stock only when the batch is released
  -- (status ready/issued, which requires a cast result and approved chemistry).
  v_status := case when new.status in ('ready','issued') then 'cast' else 'planned' end;
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
      status = case when public.foundry_billets.status in ('cast','allocated','issued','consumed','scrap') then public.foundry_billets.status else excluded.status end,
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
$function$;

CREATE OR REPLACE FUNCTION private.complete_production_job_atomic(p_job_id uuid, p_actual_weight_kg numeric, p_actual_pieces integer, p_actual_meters numeric, p_scrap_weight_kg numeric, p_remarks text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_job record;
  v_actual_meters numeric;
  v_linked_billet_count integer := 0;
  v_input_weight_kg numeric := 0;
  v_existing_scrap_kg numeric := 0;
  v_accounted_weight_kg numeric := 0;
  v_tolerance_kg numeric := 0;
  v_has_allocation_requirement boolean := false;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in (
    'owner', 'admin', 'factory_manager', 'production_manager', 'production'
  ) then
    raise exception 'Permission denied for production completion' using errcode = '42501';
  end if;

  select id, company_id, order_id, profile_id, die_id, status, pieces,
    length_per_piece_m, job_number, required_billet_count
  into v_job
  from public.production_jobs
  where id = p_job_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Production job not found for this company';
  end if;
  if v_job.status <> 'in_progress' then
    raise exception 'Start the production job before recording final output';
  end if;
  if coalesce(p_actual_weight_kg, 0) <= 0 then
    raise exception 'Actual output weight must be greater than zero';
  end if;
  if coalesce(p_actual_pieces, 0) < 0 then
    raise exception 'Actual pieces cannot be negative';
  end if;
  if coalesce(v_job.pieces, 0) > 0 and coalesce(p_actual_pieces, 0) <= 0 then
    raise exception 'Actual pieces are required for a piece-planned production job';
  end if;
  if coalesce(p_scrap_weight_kg, 0) < 0 then
    raise exception 'Scrap weight cannot be negative';
  end if;

  perform 1
  from public.foundry_billets
  where company_id = v_company_id
    and production_job_id = p_job_id
    and status in ('allocated', 'issued', 'consumed')
  for update;

  select count(*), coalesce(sum(coalesce(measured_weight_kg, weight_kg)), 0)
  into v_linked_billet_count, v_input_weight_kg
  from public.foundry_billets
  where company_id = v_company_id
    and production_job_id = p_job_id
    and status in ('allocated', 'issued', 'consumed');

  select exists (
    select 1
    from public.order_billet_requirements requirement
    where requirement.company_id = v_company_id
      and requirement.order_id = v_job.order_id
      and requirement.profile_id = v_job.profile_id
      and requirement.billets_required > 0
      and requirement.status <> 'cancelled'
  ) into v_has_allocation_requirement;

  if v_linked_billet_count = 0 then
    if coalesce(v_job.required_billet_count, 0) > 0 or v_has_allocation_requirement then
      raise exception 'Allocate the required billets to this production job before completion'
        using errcode = '23514';
    end if;
    -- EXOS-AUD-014: output without metal input needs an audited manager exception.
    if not exists (select 1 from public.production_input_exceptions exception_record
      where exception_record.company_id = v_company_id and exception_record.production_job_id = p_job_id) then
      raise exception 'Link the billets used by this job, or have a manager record an input exception, before completing it'
        using errcode = '23514';
    end if;
  else
    if exists (
      select 1
      from public.scrap_records
      where company_id = v_company_id
        and production_job_id = p_job_id
        and weight_kg < 0
    ) then
      raise exception 'Production scrap records cannot contain negative weight'
        using errcode = '23514';
    end if;
    select coalesce(sum(weight_kg), 0)
    into v_existing_scrap_kg
    from public.scrap_records
    where company_id = v_company_id
      and production_job_id = p_job_id;

    v_accounted_weight_kg := round((
      p_actual_weight_kg + v_existing_scrap_kg + coalesce(p_scrap_weight_kg, 0)
    )::numeric, 3);
    v_tolerance_kg := greatest(0.5, round((v_input_weight_kg * 0.01)::numeric, 3));

    if abs(v_input_weight_kg - v_accounted_weight_kg) > v_tolerance_kg then
      raise exception 'Billet mass balance failed: linked input % kg, accounted output and scrap % kg, tolerance % kg',
        v_input_weight_kg, v_accounted_weight_kg, v_tolerance_kg
        using errcode = '23514';
    end if;
  end if;

  v_actual_meters := coalesce(
    p_actual_meters,
    case
      when coalesce(p_actual_pieces, 0) > 0 and coalesce(v_job.length_per_piece_m, 0) > 0
        then p_actual_pieces * v_job.length_per_piece_m
      else 0
    end
  );
  if v_actual_meters < 0 then
    raise exception 'Actual metres cannot be negative';
  end if;

  update public.production_jobs
  set actual_quantity_kg = p_actual_weight_kg,
      actual_pieces = coalesce(p_actual_pieces, 0),
      actual_meters = v_actual_meters,
      status = 'completed',
      remarks = case
        when coalesce(btrim(p_remarks), '') = '' then remarks
        when coalesce(btrim(remarks), '') = '' then btrim(p_remarks)
        else concat(remarks, E'\nCompletion: ', btrim(p_remarks))
      end,
      updated_at = now()
  where id = p_job_id and company_id = v_company_id;

  if coalesce(p_scrap_weight_kg, 0) > 0 then
    insert into public.scrap_records(
      company_id, order_id, production_job_id, profile_id, die_id,
      scrap_type, weight_kg, reason, recorded_date, recorded_by, notes
    ) values (
      v_company_id, v_job.order_id, v_job.id, v_job.profile_id, v_job.die_id,
      'process_scrap', p_scrap_weight_kg, 'Production completion loss',
      current_date, auth.uid(),
      concat('Recorded while completing ', coalesce(v_job.job_number, v_job.id::text))
    );
  end if;

  return p_job_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_production_completion_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
    select coalesce(sum(coalesce(measured_weight_kg, weight_kg)), 0) into v_input from public.foundry_billets
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
    select coalesce(sum(coalesce(measured_weight_kg, weight_kg)), 0) into v_input from public.foundry_billets
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
$function$;

-- Batch release gate.
create or replace function private.guard_foundry_batch_release()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status in ('ready','issued') and old.status not in ('ready','issued') then
    if not exists (select 1 from public.foundry_cast_results r where r.foundry_batch_id = new.id) then
      raise exception 'Record the cast result (good billets, measured weight, rejects) before releasing the batch' using errcode = '23514';
    end if;
    if not exists (select 1 from public.foundry_chemistry_tests t where t.foundry_batch_id = new.id and t.result = 'pass'
        and t.approved_at is not null
        and t.tested_at = (select max(t2.tested_at) from public.foundry_chemistry_tests t2 where t2.foundry_batch_id = new.id)) then
      raise exception 'The latest chemistry test of this batch must be an approved pass before release' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_foundry_batch_release() from public, anon, authenticated;
drop trigger if exists rz_guard_foundry_batch_release on public.foundry_batches;
create trigger rz_guard_foundry_batch_release before update of status on public.foundry_batches
  for each row execute function private.guard_foundry_batch_release();

create or replace function private.record_foundry_cast_result(p_batch_id uuid, p_good_count integer, p_measured_good_kg numeric, p_dross_kg numeric, p_reject_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_batch public.foundry_batches%rowtype;
  v_rejected integer;
  v_theoretical numeric;
  v_lot uuid;
  v_id uuid;
  v_charged numeric;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager','production') then
    raise exception 'Permission denied to record a cast result' using errcode = '42501';
  end if;
  select * into v_batch from public.foundry_batches where id = p_batch_id and company_id = v_company_id for update;
  if not found then raise exception 'Foundry batch not found for this company' using errcode = '23514'; end if;
  if v_batch.status not in ('cast','homogenizing') then
    raise exception 'A cast result is recorded after casting and before release (batch is %)', v_batch.status using errcode = '23514';
  end if;
  if exists (select 1 from public.foundry_cast_results r where r.foundry_batch_id = p_batch_id) then
    raise exception 'The cast result of this batch is already recorded' using errcode = '23514';
  end if;
  if p_good_count is null or p_good_count < 0 or p_good_count > v_batch.billet_count then
    raise exception 'Good billet count must be between 0 and the planned % billets', v_batch.billet_count using errcode = '23514';
  end if;
  if coalesce(p_measured_good_kg, 0) < 0 or (p_good_count > 0 and coalesce(p_measured_good_kg, 0) <= 0) then
    raise exception 'Give the measured weight of the good billets' using errcode = '23514';
  end if;
  v_rejected := v_batch.billet_count - p_good_count;
  if v_rejected > 0 and length(btrim(coalesce(p_reject_reason, ''))) < 5 then
    raise exception 'Give the reason for the % rejected billet(s)', v_rejected using errcode = '23514';
  end if;
  if exists (select 1 from public.foundry_billets b where b.foundry_batch_id = p_batch_id and b.source_type = 'in_house'
      and b.billet_number > p_good_count and (b.status not in ('planned','cast') or b.order_id is not null or b.production_job_id is not null)) then
    raise exception 'Billets above the good count are already allocated or issued; reject them individually instead' using errcode = '23514';
  end if;
  v_theoretical := round(coalesce(v_batch.billet_weight_density_kg, 0) * p_good_count, 3);
  if p_good_count > 0 and abs(p_measured_good_kg - v_theoretical) > greatest(v_theoretical * 0.15, 1) then
    raise exception 'Measured good weight % kg is more than 15%% away from the theoretical % kg; re-weigh before recording', p_measured_good_kg, v_theoretical
      using errcode = '23514';
  end if;

  update public.foundry_billets set status = 'scrap', rejected_reason = btrim(p_reject_reason), updated_at = now()
  where foundry_batch_id = p_batch_id and company_id = v_company_id and source_type = 'in_house'
    and billet_number > p_good_count and status in ('planned','cast');
  if p_good_count > 0 then
    update public.foundry_billets set measured_weight_kg = round(p_measured_good_kg / p_good_count, 3), updated_at = now()
    where foundry_batch_id = p_batch_id and company_id = v_company_id and source_type = 'in_house'
      and billet_number <= p_good_count and status <> 'cancelled';
  end if;
  if v_rejected > 0 then
    insert into public.foundry_aluminium_scrap(company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, scrap_quality, status,
      received_date, origin_reference, created_by, alloy, scrap_category)
    values (v_company_id, private.next_business_number_locked('public.foundry_aluminium_scrap'::regclass, 'scrap_number', v_company_id, 'SCR', current_date),
      'in_house', round(coalesce(v_batch.billet_weight_density_kg, 0) * v_rejected, 3), round(coalesce(v_batch.billet_weight_density_kg, 0) * v_rejected, 3),
      'clean', 'available', current_date, concat('Casting rejects from batch ', v_batch.batch_number), auth.uid(), v_batch.alloy, 'casting_reject')
    returning id into v_lot;
  end if;
  v_charged := coalesce(v_batch.scrap_aluminium_kg, 0) + coalesce(v_batch.external_aluminium_kg, 0);
  insert into public.foundry_cast_results(company_id, foundry_batch_id, planned_billet_count, good_billet_count, rejected_billet_count,
    measured_good_weight_kg, theoretical_good_weight_kg, dross_kg, charged_kg, melt_loss_kg, reject_reason, reject_scrap_lot_id, recorded_by)
  values (v_company_id, p_batch_id, v_batch.billet_count, p_good_count, v_rejected, coalesce(p_measured_good_kg, 0), v_theoretical,
    coalesce(p_dross_kg, 0), nullif(v_charged, 0),
    case when v_charged > 0 then round(v_charged - coalesce(p_measured_good_kg, 0) - coalesce(v_batch.billet_weight_density_kg, 0) * v_rejected, 3) end,
    nullif(btrim(coalesce(p_reject_reason, '')), ''), v_lot, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.record_foundry_cast_result(uuid, integer, numeric, numeric, text) from public, anon, authenticated;
create or replace function public.record_foundry_cast_result(p_batch_id uuid, p_good_count integer, p_measured_good_kg numeric, p_dross_kg numeric default 0, p_reject_reason text default null)
returns uuid language sql security definer set search_path = public, private
as $$ select private.record_foundry_cast_result(p_batch_id, p_good_count, p_measured_good_kg, p_dross_kg, p_reject_reason) $$;
revoke all on function public.record_foundry_cast_result(uuid, integer, numeric, numeric, text) from public, anon;
grant execute on function public.record_foundry_cast_result(uuid, integer, numeric, numeric, text) to authenticated;

create or replace function private.record_foundry_chemistry_test(p_batch_id uuid, p_sample_stage text, p_composition jsonb, p_result text, p_spectrometer_reference text, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_id uuid;
  v_key text;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','quality','factory_manager','production_manager') then
    raise exception 'Permission denied to record chemistry' using errcode = '42501';
  end if;
  perform 1 from public.foundry_batches where id = p_batch_id and company_id = v_company_id and status not in ('planned','cancelled');
  if not found then raise exception 'Chemistry is recorded for a batch that has been melted' using errcode = '23514'; end if;
  if p_result not in ('pass','fail') then raise exception 'Chemistry result must be pass or fail' using errcode = '23514'; end if;
  if p_composition is null or jsonb_typeof(p_composition) <> 'object' or p_composition = '{}'::jsonb then
    raise exception 'Record the measured composition (element percentages)' using errcode = '23514';
  end if;
  for v_key in select jsonb_object_keys(p_composition) loop
    if jsonb_typeof(p_composition -> v_key) <> 'number' or (p_composition ->> v_key)::numeric < 0 or (p_composition ->> v_key)::numeric > 100 then
      raise exception 'Composition value for % must be a percentage between 0 and 100', v_key using errcode = '23514';
    end if;
  end loop;
  insert into public.foundry_chemistry_tests(company_id, foundry_batch_id, sample_stage, spectrometer_reference, composition, result, notes, tested_by)
  values (v_company_id, p_batch_id, coalesce(p_sample_stage, 'cast'), nullif(btrim(coalesce(p_spectrometer_reference, '')), ''), p_composition, p_result,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.record_foundry_chemistry_test(uuid, text, jsonb, text, text, text) from public, anon, authenticated;
create or replace function public.record_foundry_chemistry_test(p_batch_id uuid, p_sample_stage text, p_composition jsonb, p_result text, p_spectrometer_reference text default null, p_notes text default null)
returns uuid language sql security definer set search_path = public, private
as $$ select private.record_foundry_chemistry_test(p_batch_id, p_sample_stage, p_composition, p_result, p_spectrometer_reference, p_notes) $$;
revoke all on function public.record_foundry_chemistry_test(uuid, text, jsonb, text, text, text) from public, anon;
grant execute on function public.record_foundry_chemistry_test(uuid, text, jsonb, text, text, text) to authenticated;

create or replace function private.approve_foundry_chemistry_test(p_test_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_test public.foundry_chemistry_tests%rowtype;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','quality','factory_manager') then
    raise exception 'Only an owner, admin, quality or factory manager can approve chemistry' using errcode = '42501';
  end if;
  select * into v_test from public.foundry_chemistry_tests where id = p_test_id and company_id = v_company_id for update;
  if not found then raise exception 'Chemistry test not found for this company' using errcode = '23514'; end if;
  if v_test.approved_at is not null then raise exception 'This chemistry test is already approved' using errcode = '23514'; end if;
  if v_test.tested_by = auth.uid() and v_role <> 'owner' then
    raise exception 'A chemistry test must be approved by someone other than the person who recorded it' using errcode = '42501';
  end if;
  update public.foundry_chemistry_tests set approved_by = auth.uid(), approved_at = now() where id = p_test_id;
  return p_test_id;
end;
$$;
revoke all on function private.approve_foundry_chemistry_test(uuid) from public, anon, authenticated;
create or replace function public.approve_foundry_chemistry_test(p_test_id uuid)
returns uuid language sql security definer set search_path = public, private
as $$ select private.approve_foundry_chemistry_test(p_test_id) $$;
revoke all on function public.approve_foundry_chemistry_test(uuid) from public, anon;
grant execute on function public.approve_foundry_chemistry_test(uuid) to authenticated;

create or replace function private.reject_foundry_billet(p_billet_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_billet public.foundry_billets%rowtype;
  v_lot uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager','quality') then
    raise exception 'Permission denied to reject billets' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the billet rejection reason' using errcode = '23514'; end if;
  select * into v_billet from public.foundry_billets where id = p_billet_id and company_id = v_company_id for update;
  if not found then raise exception 'Billet not found for this company' using errcode = '23514'; end if;
  if v_billet.status not in ('planned','cast','allocated') or v_billet.production_job_id is not null then
    raise exception 'Only billets not yet issued to production can be rejected (billet is %)', v_billet.status using errcode = '23514';
  end if;
  update public.foundry_billets set status = 'scrap', rejected_reason = btrim(p_reason), order_id = null, allocation_requirement_id = null,
    allocated_at = null, allocated_by = null, updated_at = now()
  where id = p_billet_id;
  insert into public.foundry_aluminium_scrap(company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, scrap_quality, status,
    received_date, origin_reference, created_by, alloy, scrap_category)
  values (v_company_id, private.next_business_number_locked('public.foundry_aluminium_scrap'::regclass, 'scrap_number', v_company_id, 'SCR', current_date),
    'in_house', coalesce(v_billet.measured_weight_kg, v_billet.weight_kg), coalesce(v_billet.measured_weight_kg, v_billet.weight_kg),
    'clean', 'available', current_date, concat('Rejected billet ', v_billet.billet_code, ': ', btrim(p_reason)), auth.uid(), v_billet.alloy, 'billet_reject')
  returning id into v_lot;
  if v_billet.order_id is not null then perform public.refresh_order_billet_allocations(v_billet.order_id); end if;
  return v_lot;
end;
$$;
revoke all on function private.reject_foundry_billet(uuid, text) from public, anon, authenticated;
create or replace function public.reject_foundry_billet(p_billet_id uuid, p_reason text)
returns uuid language sql security definer set search_path = public, private
as $$ select private.reject_foundry_billet(p_billet_id, p_reason) $$;
revoke all on function public.reject_foundry_billet(uuid, text) from public, anon;
grant execute on function public.reject_foundry_billet(uuid, text) to authenticated;

commit;
