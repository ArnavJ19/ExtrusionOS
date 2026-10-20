-- EXOS-AUD-012: QC approval checked only an inspector-name string and the
-- surface flag; the producer could approve their own output; and the dispatch
-- QC gate could be switched off by any admin.
--
-- 1. Every final disposition (approved/rejected/rework) records the signed-in
--    user and time (new nullable columns; history is not backfilled).
-- 2. Approval is limited to owner, admin, quality and factory_manager (the
--    roles that may already resolve rework). Production roles may still reject
--    or send material to rework.
-- 3. When the profile master defines a specification, approval requires the
--    measurement and enforces it:
--      - weight_tolerance_percent: actual kg/m within ± tolerance of the
--        section weight;
--      - hardness_requirement given as a plain minimum (e.g. "12", ">= 12 HW",
--        "min 12 webster"): Webster hardness at or above it.
--    Profiles without a configured specification are not checked (no default
--    tolerance is invented here).
-- 4. Only the owner may disable or delete the quality_compliance flag that the
--    dispatch QC gate reads.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.quality_inspections
  add column if not exists dispositioned_by uuid references auth.users(id),
  add column if not exists dispositioned_at timestamptz;

create or replace function private.enforce_quality_release_rules()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_role text := private.get_current_user_role();
  v_profile record;
  v_min_hardness numeric;
  v_match text[];
begin
  if new.status not in ('approved', 'rejected', 'rework')
    or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
    return new;
  end if;

  new.dispositioned_by := coalesce(auth.uid(), new.dispositioned_by);
  new.dispositioned_at := now();

  if new.status <> 'approved' then return new; end if;

  if auth.uid() is not null and coalesce(v_role, '') not in ('owner', 'admin', 'quality', 'factory_manager') then
    raise exception 'QC approval requires a quality, factory manager, owner or admin user' using errcode = '42501';
  end if;

  select section_weight_kg_per_m, weight_tolerance_percent, hardness_requirement
  into v_profile
  from public.aluminium_profiles
  where id = new.profile_id and company_id = new.company_id;

  if coalesce(v_profile.weight_tolerance_percent, 0) > 0 and coalesce(v_profile.section_weight_kg_per_m, 0) > 0 then
    if new.weight_per_meter_actual is null then
      raise exception 'Record the actual kg/m: this profile has a % %% weight tolerance', v_profile.weight_tolerance_percent
        using errcode = '23514';
    end if;
    if abs(new.weight_per_meter_actual - v_profile.section_weight_kg_per_m) * 100 / v_profile.section_weight_kg_per_m
      > v_profile.weight_tolerance_percent then
      raise exception 'Actual % kg/m is outside % kg/m ± % %%; QC cannot approve', new.weight_per_meter_actual,
        v_profile.section_weight_kg_per_m, v_profile.weight_tolerance_percent using errcode = '23514';
    end if;
  end if;

  v_match := regexp_match(coalesce(v_profile.hardness_requirement, ''),
    '^\s*(?:>=|≥|min\.?|minimum)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:hw|webster)?\s*$', 'i');
  if v_match is not null then
    v_min_hardness := v_match[1]::numeric;
    if new.hardness_webster is null then
      raise exception 'Record Webster hardness: this profile requires at least %', v_min_hardness using errcode = '23514';
    end if;
    if new.hardness_webster < v_min_hardness then
      raise exception 'Hardness % HW is below the required % HW; QC cannot approve', new.hardness_webster, v_min_hardness
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_quality_release_rules() from public, anon, authenticated;

drop trigger if exists a_enforce_quality_release_rules on public.quality_inspections;
create trigger a_enforce_quality_release_rules
  before insert or update on public.quality_inspections
  for each row execute function private.enforce_quality_release_rules();

create or replace function private.guard_quality_gate_flag()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.module_name = 'quality_compliance' and coalesce(private.get_current_user_role(), '') <> 'owner' then
      raise exception 'Only the owner may remove the dispatch quality gate' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.module_name = 'quality_compliance' and new.is_enabled is false
    and (tg_op = 'INSERT' or old.is_enabled is distinct from false)
    and coalesce(private.get_current_user_role(), '') <> 'owner' then
    raise exception 'Only the owner may disable the dispatch quality gate' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_quality_gate_flag() from public, anon, authenticated;

drop trigger if exists a_guard_quality_gate_flag on public.feature_flags;
create trigger a_guard_quality_gate_flag
  before insert or update or delete on public.feature_flags
  for each row execute function private.guard_quality_gate_flag();

commit;
