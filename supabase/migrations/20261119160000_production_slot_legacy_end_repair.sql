-- Press slots saved before 20260723010000 could be 'scheduled' with no planned end time (0058_production_plan_slots
-- allowed it). The schedule-integrity trigger now refuses an active slot without an end, so releasing such a slot
-- failed with "Active press slots require a planned end time" and offered no way forward.
--
-- Existing rows are still not rewritten: nobody can know the intended end of an old slot, so it is not invented here.
-- Instead:
--  1. release_production_schedule_slot_atomic refuses a slot with no end time up front, with a message that says
--     how to fix it (set the end time on the schedule), instead of failing inside the trigger.
--  2. The repair path is the existing save_production_schedule_slot_atomic(p_slot_id, ...) update, which already
--     accepts a scheduled (not released) slot and requires start and end; the schedule screen now offers it for
--     slots that have no end time.
-- Additive: replaces one function body; no table or data changes.

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
  if v_slot.planned_end_at is null then
    raise exception 'This press slot has no planned end time. Set its end time on the production schedule, then release it.' using errcode = '23514';
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

revoke all on function private.release_production_schedule_slot_atomic(uuid) from public, anon, authenticated;
