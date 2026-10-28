-- EXOS-AUD2-005: owner/admin could hard-delete breakdown, calibration, die trial,
-- die correction, maintenance schedule and energy records, and none of those tables
-- had an audit trigger. Deleting an open breakdown also released the press lockout
-- added for EXOS-AUD-027 without any root cause or repair on record.
--
-- 1. These records are retained evidence: user sessions can no longer delete them.
--    Corrections stay possible through the existing update paths (resolve a breakdown
--    logged in error with a reason, cancel a schedule, correct a reading), and every
--    change is now audited with its previous and new values.
--    Callers without a user session (service maintenance, tenant offboarding
--    cascades) are not restricted.
-- 2. private.audit_row_change() records old/new values (changed fields only on update)
--    in audit_logs_enterprise. Unlike record_enterprise_audit() it does not swallow
--    errors. It is reused by later Wave 1 migrations.
begin;
set local lock_timeout = '5s';

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_company uuid := (v_row ->> 'company_id')::uuid;
  v_actor uuid := auth.uid();
  v_before jsonb := v_old;
  v_after jsonb := v_new;
begin
  -- A company being deleted (tenant offboarding cascade) cannot receive new audit rows.
  if v_company is null or (tg_op = 'DELETE' and not exists (select 1 from public.companies c where c.id = v_company)) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(o.key, o.value) into v_before
    from jsonb_each(v_old) o where o.key <> 'updated_at' and v_new -> o.key is distinct from o.value;
    if v_before is null then
      return null;
    end if;
    select jsonb_object_agg(n.key, n.value) into v_after
    from jsonb_each(v_new) n where n.key <> 'updated_at' and v_old -> n.key is distinct from n.value;
  end if;

  insert into public.audit_logs_enterprise (
    company_id, actor_user_id, actor_name, actor_role, actor_company_id, actor_dealer_id,
    action_type, module_name, entity_type, entity_id, entity_reference_number,
    previous_value, new_value, change_summary, status
  )
  values (
    v_company,
    v_actor,
    (select coalesce(nullif(btrim(u.full_name), ''), u.email) from public.app_users u where u.id = v_actor),
    case when v_actor is not null then private.get_current_user_role() end,
    case when v_actor is not null then private.get_current_user_company_id() end,
    case when v_actor is not null then private.get_current_user_dealer_id() end,
    lower(tg_op) || '_' || tg_table_name,
    coalesce(tg_argv[0], tg_table_name),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    case when tg_nargs > 1 then v_row ->> tg_argv[1] end,
    coalesce(v_before, '{}'::jsonb),
    coalesce(v_after, '{}'::jsonb),
    initcap(lower(tg_op)) || ' ' || replace(tg_table_name, '_', ' '),
    'success'
  );
  return null;
end;
$$;

revoke all on function private.audit_row_change() from public, anon, authenticated;

create or replace function private.guard_operational_history_delete()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  raise exception '% records are retained as evidence and cannot be deleted; %',
    replace(tg_table_name, '_', ' '), coalesce(tg_argv[0], 'correct the record instead')
    using errcode = '42501';
end;
$$;

revoke all on function private.guard_operational_history_delete() from public, anon, authenticated;

drop trigger if exists a_retain_breakdown_logs on public.breakdown_logs;
create trigger a_retain_breakdown_logs before delete on public.breakdown_logs
for each row execute function private.guard_operational_history_delete('resolve a breakdown logged in error with the reason instead');

drop trigger if exists a_retain_calibration_records on public.calibration_records;
create trigger a_retain_calibration_records before delete on public.calibration_records
for each row execute function private.guard_operational_history_delete('record a new calibration or mark the instrument expired instead');

drop trigger if exists a_retain_die_trials on public.die_trials;
create trigger a_retain_die_trials before delete on public.die_trials
for each row execute function private.guard_operational_history_delete('correct the trial result instead');

drop trigger if exists a_retain_die_corrections on public.die_corrections;
create trigger a_retain_die_corrections before delete on public.die_corrections
for each row execute function private.guard_operational_history_delete('correct the correction result instead');

drop trigger if exists a_retain_maintenance_schedules on public.maintenance_schedules;
create trigger a_retain_maintenance_schedules before delete on public.maintenance_schedules
for each row execute function private.guard_operational_history_delete('set the schedule to cancelled instead');

drop trigger if exists a_retain_energy_readings on public.energy_readings;
create trigger a_retain_energy_readings before delete on public.energy_readings
for each row execute function private.guard_operational_history_delete('correct the reading instead');

drop trigger if exists audit_row_breakdown_logs on public.breakdown_logs;
create trigger audit_row_breakdown_logs after insert or update or delete on public.breakdown_logs
for each row execute function private.audit_row_change('maintenance', 'machine_id');

drop trigger if exists audit_row_breakdown_spare_part_usage on public.breakdown_spare_part_usage;
create trigger audit_row_breakdown_spare_part_usage after insert or update or delete on public.breakdown_spare_part_usage
for each row execute function private.audit_row_change('maintenance');

drop trigger if exists audit_row_calibration_records on public.calibration_records;
create trigger audit_row_calibration_records after insert or update or delete on public.calibration_records
for each row execute function private.audit_row_change('quality', 'equipment_id_code');

drop trigger if exists audit_row_die_trials on public.die_trials;
create trigger audit_row_die_trials after insert or update or delete on public.die_trials
for each row execute function private.audit_row_change('dies');

drop trigger if exists audit_row_die_corrections on public.die_corrections;
create trigger audit_row_die_corrections after insert or update or delete on public.die_corrections
for each row execute function private.audit_row_change('dies');

drop trigger if exists audit_row_maintenance_schedules on public.maintenance_schedules;
create trigger audit_row_maintenance_schedules after insert or update or delete on public.maintenance_schedules
for each row execute function private.audit_row_change('maintenance', 'machine_id');

drop trigger if exists audit_row_energy_readings on public.energy_readings;
create trigger audit_row_energy_readings after insert or update or delete on public.energy_readings
for each row execute function private.audit_row_change('energy', 'machine_id');

commit;
