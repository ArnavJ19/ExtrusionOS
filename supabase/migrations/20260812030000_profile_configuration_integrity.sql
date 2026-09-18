begin;

drop policy if exists "profile_routing_tenant" on public.profile_routing_steps;
drop policy if exists "profile_routing_read" on public.profile_routing_steps;
create policy "profile_routing_read" on public.profile_routing_steps
for select to authenticated
using (company_id = private.get_current_user_company_id());

drop policy if exists "profile_quality_plan_tenant" on public.profile_quality_plans;
drop policy if exists "profile_quality_plan_read" on public.profile_quality_plans;
create policy "profile_quality_plan_read" on public.profile_quality_plans
for select to authenticated
using (company_id = private.get_current_user_company_id());

create or replace function private.replace_profile_routing_atomic(p_profile_id uuid, p_steps jsonb)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_count integer;
begin
  if auth.uid() is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin') then
    raise exception 'Permission denied to change profile routing' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_steps, 'null'::jsonb)) <> 'array' then
    raise exception 'Profile routing must be an array';
  end if;
  v_count := jsonb_array_length(p_steps);
  if v_count < 1 or v_count > 50 then
    raise exception 'Profile routing requires between 1 and 50 steps';
  end if;

  perform 1 from public.aluminium_profiles
  where id = p_profile_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Profile not found for this company'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_steps) as step(
      stage_name text,
      is_required boolean,
      department text,
      estimated_duration_hours numeric,
      notes text
    )
    where nullif(btrim(step.stage_name), '') is null
      or char_length(step.stage_name) > 120
      or coalesce(step.estimated_duration_hours, 0) < 0
  ) then
    raise exception 'Every routing step requires a valid stage and duration';
  end if;

  delete from public.profile_routing_steps
  where company_id = v_company_id and profile_id = p_profile_id;

  insert into public.profile_routing_steps(
    company_id, profile_id, step_order, stage_name, is_required,
    department, estimated_duration_hours, notes
  )
  select
    v_company_id,
    p_profile_id,
    step.ordinality::integer,
    btrim(step.stage_name),
    coalesce(step.is_required, true),
    nullif(btrim(step.department), ''),
    step.estimated_duration_hours,
    nullif(btrim(step.notes), '')
  from jsonb_to_recordset(p_steps) with ordinality as step(
    stage_name text,
    is_required boolean,
    department text,
    estimated_duration_hours numeric,
    notes text,
    ordinality bigint
  );
end;
$$;

create or replace function private.replace_profile_quality_plan_atomic(p_profile_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_count integer;
begin
  if auth.uid() is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin') then
    raise exception 'Permission denied to change profile quality plans' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then
    raise exception 'Profile quality plan must be an array';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 100 then
    raise exception 'Profile quality plan requires between 1 and 100 parameters';
  end if;

  perform 1 from public.aluminium_profiles
  where id = p_profile_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Profile not found for this company'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(
      inspection_stage text,
      parameter_name text,
      acceptance_criteria text,
      rejection_criteria text,
      inspection_frequency text,
      is_mandatory boolean
    )
    where nullif(btrim(item.inspection_stage), '') is null
      or nullif(btrim(item.parameter_name), '') is null
      or char_length(item.inspection_stage) > 120
      or char_length(item.parameter_name) > 160
  ) then
    raise exception 'Every quality-plan row requires a valid stage and parameter';
  end if;

  update public.profile_quality_plans
  set is_active = false, updated_at = now()
  where company_id = v_company_id and profile_id = p_profile_id and is_active = true;

  insert into public.profile_quality_plans(
    company_id, profile_id, inspection_stage, parameter_name,
    acceptance_criteria, rejection_criteria, inspection_frequency,
    is_mandatory, is_active
  )
  select
    v_company_id,
    p_profile_id,
    btrim(item.inspection_stage),
    btrim(item.parameter_name),
    nullif(btrim(item.acceptance_criteria), ''),
    nullif(btrim(item.rejection_criteria), ''),
    nullif(btrim(item.inspection_frequency), ''),
    coalesce(item.is_mandatory, true),
    true
  from jsonb_to_recordset(p_items) as item(
    inspection_stage text,
    parameter_name text,
    acceptance_criteria text,
    rejection_criteria text,
    inspection_frequency text,
    is_mandatory boolean
  );
end;
$$;

create or replace function public.replace_profile_routing_atomic(p_profile_id uuid, p_steps jsonb)
returns void language sql security definer set search_path = public, private
as $$ select private.replace_profile_routing_atomic(p_profile_id, p_steps) $$;

create or replace function public.replace_profile_quality_plan_atomic(p_profile_id uuid, p_items jsonb)
returns void language sql security definer set search_path = public, private
as $$ select private.replace_profile_quality_plan_atomic(p_profile_id, p_items) $$;

revoke all on function private.replace_profile_routing_atomic(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.replace_profile_quality_plan_atomic(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.replace_profile_routing_atomic(uuid, jsonb) from public, anon;
revoke all on function public.replace_profile_quality_plan_atomic(uuid, jsonb) from public, anon;
grant execute on function public.replace_profile_routing_atomic(uuid, jsonb) to authenticated;
grant execute on function public.replace_profile_quality_plan_atomic(uuid, jsonb) to authenticated;

commit;
