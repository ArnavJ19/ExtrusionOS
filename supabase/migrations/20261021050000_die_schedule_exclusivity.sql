-- EXOS-AUD-007: one physical die could be scheduled, released and run on two
-- presses at the same time. Each dies row is one physical die.
--
-- 1. Press slots: a scheduled/released slot may not overlap another active slot
--    whose open production job uses the same die (serialized per die with an
--    advisory lock, like the existing press and job locks).
-- 2. Production start: a job cannot go in_progress while another job with the
--    same die is in_progress, whatever the schedule says (covers die edits made
--    after scheduling).
-- Machine and job rules are unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.enforce_production_schedule_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_die_id uuid;
begin
  if new.status not in ('scheduled', 'released') then
    return new;
  end if;

  if new.planned_end_at is null then
    raise exception 'Active press slots require a planned end time' using errcode = '23514';
  end if;

  -- Serialize all writers that can contend for this press, this job or this die.
  perform pg_advisory_xact_lock(hashtextextended(
    'production-slot-machine:' || new.company_id::text || ':' || new.machine_id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'production-slot-job:' || new.company_id::text || ':' || new.production_job_id::text,
    0
  ));
  select die_id into v_die_id from public.production_jobs
  where id = new.production_job_id and company_id = new.company_id;
  if v_die_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'production-slot-die:' || new.company_id::text || ':' || v_die_id::text,
      0
    ));
  end if;

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

  if v_die_id is not null and exists (
    select 1
    from public.production_plan_slots slot
    join public.production_jobs job on job.id = slot.production_job_id and job.company_id = slot.company_id
    where slot.company_id = new.company_id
      and slot.status in ('scheduled', 'released')
      and slot.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and slot.production_job_id <> new.production_job_id
      and job.die_id = v_die_id
      and job.status not in ('completed', 'cancelled')
      and new.planned_start_at < slot.planned_end_at
      and new.planned_end_at > slot.planned_start_at
  ) then
    raise exception 'This die is already scheduled on another press slot in that window' using errcode = '23P01';
  end if;

  return new;
end;
$$;

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
  -- The die row lock above serializes concurrent starts on the same die.
  if exists (
    select 1 from public.production_jobs other
    where other.company_id = new.company_id and other.die_id = new.die_id
      and other.id <> new.id and other.status = 'in_progress'
  ) then
    raise exception 'Die % is already running on another production job', v_die.die_number using errcode = '23P01';
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

revoke all on function private.enforce_production_schedule_integrity() from public, anon, authenticated;
revoke all on function private.validate_production_start_resources() from public, anon, authenticated;
commit;
