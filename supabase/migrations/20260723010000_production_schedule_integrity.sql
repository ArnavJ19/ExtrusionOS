-- Make press scheduling a single, conflict-safe business transaction.
-- Existing rows are not rewritten; future active slot writes must be complete and non-conflicting.

create schema if not exists private;

create or replace function private.enforce_production_schedule_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status not in ('scheduled', 'released') then
    return new;
  end if;

  if new.planned_end_at is null then
    raise exception 'Active press slots require a planned end time' using errcode = '23514';
  end if;

  -- Serialize all writers that can contend for either this press or this job.
  perform pg_advisory_xact_lock(hashtextextended(
    'production-slot-machine:' || new.company_id::text || ':' || new.machine_id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'production-slot-job:' || new.company_id::text || ':' || new.production_job_id::text,
    0
  ));

  if exists (
    select 1
    from public.production_plan_slots slot
    where slot.company_id = new.company_id
      and slot.production_job_id = new.production_job_id
      and slot.status in ('scheduled', 'released')
      and slot.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'This production job already has an active press slot' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.production_plan_slots slot
    where slot.company_id = new.company_id
      and slot.machine_id = new.machine_id
      and slot.status in ('scheduled', 'released')
      and slot.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and new.planned_start_at < slot.planned_end_at
      and new.planned_end_at > slot.planned_start_at
  ) then
    raise exception 'This extrusion press already has an overlapping active slot' using errcode = '23P01';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_production_schedule_integrity()
  from public, anon, authenticated;

drop trigger if exists enforce_production_schedule_integrity on public.production_plan_slots;
create trigger enforce_production_schedule_integrity
before insert or update of company_id, production_job_id, machine_id, planned_start_at, planned_end_at, status
on public.production_plan_slots
for each row execute function private.enforce_production_schedule_integrity();

create or replace function private.save_production_schedule_slot_atomic(
  p_slot_id uuid,
  p_slot jsonb
)
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
  v_slot_id uuid;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'factory_manager', 'production_manager', 'production') then
    raise exception 'Permission denied to schedule production jobs' using errcode = '42501';
  end if;
  if v_job_id is null or v_machine_id is null or v_start is null or v_end is null then
    raise exception 'Production job, extrusion press, start, and end are required' using errcode = '23514';
  end if;
  if v_end <= v_start then
    raise exception 'Planned end must be after planned start' using errcode = '23514';
  end if;
  if v_status not in ('draft', 'scheduled') then
    raise exception 'Use the release action to release a scheduled slot' using errcode = '23514';
  end if;

  perform 1
  from public.production_jobs job
  join public.orders order_record
    on order_record.id = job.order_id and order_record.company_id = job.company_id
  join public.dies die
    on die.id = job.die_id and die.company_id = job.company_id and die.profile_id = job.profile_id
  where job.id = v_job_id
    and job.company_id = v_company_id
    and job.status in ('planned', 'ready', 'on_hold')
    and order_record.current_stage not in ('closed', 'cancelled', 'dispatched', 'delivered')
    and die.die_status not in ('inactive', 'dead', 'blocked', 'retired', 'scrapped', 'under_maintenance')
  for update of job;
  if not found then
    raise exception 'Production job is not eligible for press scheduling' using errcode = '23514';
  end if;

  perform 1
  from public.machines machine
  where machine.id = v_machine_id
    and machine.company_id = v_company_id
    and machine.machine_type = 'extrusion_press'
    and machine.is_active = true
    and machine.status in ('active', 'operational', 'idle')
  for update;
  if not found then
    raise exception 'Selected extrusion press is not available for planning' using errcode = '23514';
  end if;

  if p_slot_id is not null then
    select * into v_existing
    from public.production_plan_slots
    where id = p_slot_id and company_id = v_company_id
    for update;
    if not found then
      raise exception 'Production schedule slot not found for this company' using errcode = '23514';
    end if;
    if v_existing.status = 'released' then
      raise exception 'Released press slots are locked and cannot be rescheduled' using errcode = '23514';
    end if;
    if v_existing.production_job_id <> v_job_id then
      raise exception 'A schedule slot cannot be reassigned to a different production job' using errcode = '23514';
    end if;

    update public.production_plan_slots
    set machine_id = v_machine_id,
        planned_start_at = v_start,
        planned_end_at = v_end,
        shift = nullif(p_slot ->> 'shift', ''),
        sequence_number = greatest(coalesce(nullif(p_slot ->> 'sequence_number', '')::integer, 0), 0),
        capacity_kg = nullif(p_slot ->> 'capacity_kg', '')::numeric,
        status = v_status,
        locked_by = null,
        locked_at = null,
        updated_at = now()
    where id = p_slot_id and company_id = v_company_id
    returning id into v_slot_id;
  else
    insert into public.production_plan_slots (
      company_id, production_job_id, machine_id, planned_start_at, planned_end_at,
      shift, sequence_number, capacity_kg, status, created_by
    ) values (
      v_company_id, v_job_id, v_machine_id, v_start, v_end,
      nullif(p_slot ->> 'shift', ''),
      greatest(coalesce(nullif(p_slot ->> 'sequence_number', '')::integer, 0), 0),
      nullif(p_slot ->> 'capacity_kg', '')::numeric,
      v_status,
      auth.uid()
    ) returning id into v_slot_id;
  end if;

  update public.production_jobs
  set machine_id = v_machine_id,
      planned_date = (v_start at time zone 'Asia/Kolkata')::date,
      shift = nullif(p_slot ->> 'shift', ''),
      status = 'planned',
      updated_at = now()
  where id = v_job_id and company_id = v_company_id;

  return v_slot_id;
end;
$$;

create or replace function private.release_production_schedule_slot_atomic(p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_slot public.production_plan_slots%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'factory_manager', 'production_manager', 'production') then
    raise exception 'Permission denied to release production jobs' using errcode = '42501';
  end if;

  select * into v_slot
  from public.production_plan_slots
  where id = p_slot_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Production schedule slot not found for this company' using errcode = '23514';
  end if;
  if v_slot.status <> 'scheduled' then
    raise exception 'Only a scheduled press slot can be released' using errcode = '23514';
  end if;

  perform 1
  from public.production_jobs
  where id = v_slot.production_job_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Production job not found for this schedule slot' using errcode = '23514';
  end if;

  update public.production_plan_slots
  set status = 'released', locked_by = auth.uid(), locked_at = now(), updated_at = now()
  where id = v_slot.id and company_id = v_company_id;

  update public.production_jobs
  set status = 'ready',
      machine_id = v_slot.machine_id,
      planned_date = (v_slot.planned_start_at at time zone 'Asia/Kolkata')::date,
      shift = v_slot.shift,
      updated_at = now()
  where id = v_slot.production_job_id and company_id = v_company_id;

  return v_slot.production_job_id;
end;
$$;

create or replace function public.save_production_schedule_slot_atomic(p_slot_id uuid, p_slot jsonb)
returns uuid
language sql
security definer
set search_path = public, private
as $$ select private.save_production_schedule_slot_atomic(p_slot_id, p_slot) $$;

create or replace function public.release_production_schedule_slot_atomic(p_slot_id uuid)
returns uuid
language sql
security definer
set search_path = public, private
as $$ select private.release_production_schedule_slot_atomic(p_slot_id) $$;

revoke all on function private.save_production_schedule_slot_atomic(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function private.release_production_schedule_slot_atomic(uuid)
  from public, anon, authenticated;
revoke all on function public.save_production_schedule_slot_atomic(uuid, jsonb)
  from public, anon;
revoke all on function public.release_production_schedule_slot_atomic(uuid)
  from public, anon;
grant execute on function public.save_production_schedule_slot_atomic(uuid, jsonb)
  to authenticated;
grant execute on function public.release_production_schedule_slot_atomic(uuid)
  to authenticated;
