-- UPGRADE_EOS feature 54: approved inspection plans in quality entry.
--
-- An inspection plan lists, for one profile (or as the company default), the characteristics
-- to check with unit, method, nominal and acceptance limits (or a visual pass/fail), and the
-- sampling instruction. Plans are versioned: a draft is edited, a different quality employee (or
-- an owner/admin) approves it, and the previously approved version for that profile is
-- superseded. Approved versions are
-- immutable. Quality entry loads the applicable approved plan (the profile's own, else the
-- default) and the inspector records each observation explicitly: nothing is pre-filled from
-- nominal values, and an unrecorded characteristic stays "missing". A database guard refuses to
-- approve an inspection while any planned result is missing or out of limits; failing material
-- needs a rework or rejection disposition instead. Only inspections that have an applicable
-- approved plan are affected; approved children of a rework resolution are exempt (their
-- disposition is already decided by the resolution). Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.inspection_plans (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  profile_id uuid references public.aluminium_profiles(id),
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft','approved','superseded')),
  sampling_instruction text not null check (length(btrim(sampling_instruction)) between 3 and 500),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  approved_by uuid references public.app_users(id),
  approved_by_name text,
  approved_at timestamptz,
  superseded_at timestamptz,
  check ((status = 'draft') = (approved_at is null))
);
create unique index inspection_plans_version_key on public.inspection_plans(company_id, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
create unique index inspection_plans_one_approved on public.inspection_plans(company_id, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'approved';
create unique index inspection_plans_one_draft on public.inspection_plans(company_id, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'draft';
create index inspection_plans_profile_idx on public.inspection_plans(profile_id);
create index inspection_plans_created_by_idx on public.inspection_plans(created_by);
create index inspection_plans_approved_by_idx on public.inspection_plans(approved_by);

create table public.inspection_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.inspection_plans(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  seq integer not null check (seq between 1 and 50),
  characteristic text not null check (length(btrim(characteristic)) between 2 and 120),
  unit text not null check (unit in ('mm','kg/m','HW','micron','percent','visual')),
  method text check (method is null or length(method) <= 200),
  nominal numeric(14,4),
  lower_limit numeric(14,4),
  upper_limit numeric(14,4),
  critical boolean not null default true,
  unique (plan_id, seq),
  check ((unit = 'visual') = (lower_limit is null and upper_limit is null and nominal is null)),
  check (unit = 'visual' or lower_limit is not null or upper_limit is not null),
  check (lower_limit is null or upper_limit is null or lower_limit <= upper_limit),
  check (nominal is null or ((lower_limit is null or nominal >= lower_limit) and (upper_limit is null or nominal <= upper_limit)))
);
create index inspection_plan_items_company_idx on public.inspection_plan_items(company_id, plan_id);

create table public.inspection_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  inspection_id uuid not null references public.quality_inspections(id) on delete cascade,
  plan_id uuid not null references public.inspection_plans(id),
  item_id uuid not null references public.inspection_plan_items(id),
  observed numeric(14,4),
  visual_ok boolean,
  outcome text not null check (outcome in ('pass','fail')),
  recorded_by uuid not null references public.app_users(id),
  recorded_by_name text not null,
  recorded_at timestamptz not null default now(),
  unique (inspection_id, item_id),
  check ((observed is null) <> (visual_ok is null))
);
create index inspection_results_inspection_idx on public.inspection_results(company_id, inspection_id);
create index inspection_results_plan_idx on public.inspection_results(plan_id);
create index inspection_results_item_idx on public.inspection_results(item_id);
create index inspection_results_recorded_by_idx on public.inspection_results(recorded_by);

alter table public.inspection_plans enable row level security;
alter table public.inspection_plan_items enable row level security;
alter table public.inspection_results enable row level security;
revoke all on public.inspection_plans, public.inspection_plan_items, public.inspection_results from public, anon, authenticated;
grant select on public.inspection_plans, public.inspection_plan_items, public.inspection_results to authenticated;
create policy inspection_plans_read on public.inspection_plans for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy inspection_plan_items_read on public.inspection_plan_items for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy inspection_results_read on public.inspection_results for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);

-- The approved plan that applies to a profile: its own, else the company default.
create or replace function private.applicable_inspection_plan(p_company uuid, p_profile uuid)
returns uuid language sql stable security definer set search_path = public, private as $$
  select id from public.inspection_plans
  where company_id = p_company and status = 'approved' and (profile_id = p_profile or profile_id is null)
  order by (profile_id is null), version desc limit 1
$$;
revoke all on function private.applicable_inspection_plan(uuid, uuid) from public, anon, authenticated;

-- Evaluation of one inspection against its applicable plan.
create or replace function private.inspection_plan_evaluation(p_inspection uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  q record; v_plan uuid; v_items jsonb; v_missing integer; v_failed integer; v_total integer;
begin
  select id, company_id, profile_id, status, resolution_id into q from public.quality_inspections where id = p_inspection;
  if not found then return null; end if;
  v_plan := private.applicable_inspection_plan(q.company_id, q.profile_id);
  if v_plan is null then return jsonb_build_object('plan_id', null, 'state', 'no_plan'); end if;
  select count(*), count(*) filter (where r.id is null), count(*) filter (where r.outcome = 'fail'),
         coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'seq', i.seq, 'characteristic', i.characteristic, 'unit', i.unit, 'method', i.method,
           'nominal', i.nominal, 'lower_limit', i.lower_limit, 'upper_limit', i.upper_limit, 'critical', i.critical,
           'observed', r.observed, 'visual_ok', r.visual_ok, 'outcome', coalesce(r.outcome, 'missing'), 'recorded_by_name', r.recorded_by_name, 'recorded_at', r.recorded_at) order by i.seq), '[]'::jsonb)
    into v_total, v_missing, v_failed, v_items
  from public.inspection_plan_items i
  left join public.inspection_results r on r.item_id = i.id and r.inspection_id = q.id and r.plan_id = v_plan
  where i.plan_id = v_plan;
  return jsonb_build_object('plan_id', v_plan, 'plan_version', (select version from public.inspection_plans where id = v_plan),
    'plan_scope', case when (select profile_id from public.inspection_plans where id = v_plan) is null then 'default' else 'profile' end,
    'sampling_instruction', (select sampling_instruction from public.inspection_plans where id = v_plan),
    'state', case when v_failed > 0 then 'fail' when v_missing > 0 then 'incomplete' else 'pass' end,
    'total', v_total, 'missing', v_missing, 'failed', v_failed, 'items', v_items);
end;
$$;
revoke all on function private.inspection_plan_evaluation(uuid) from public, anon, authenticated;

-- Approval guard: an inspection with an applicable plan is approved only when every result is
-- recorded and within limits.
create or replace function private.guard_inspection_plan_approval()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_eval jsonb;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') or new.resolution_id is not null then return new; end if;
  if private.applicable_inspection_plan(new.company_id, new.profile_id) is null then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'Record the inspection plan results before approving this inspection' using errcode = '23514';
  end if;
  v_eval := private.inspection_plan_evaluation(new.id);
  if v_eval ->> 'state' = 'incomplete' then
    raise exception 'Inspection cannot be approved: % of % planned results are missing', v_eval ->> 'missing', v_eval ->> 'total' using errcode = '23514';
  elsif v_eval ->> 'state' = 'fail' then
    raise exception 'Inspection cannot be approved: % result(s) are outside the plan limits. Record a rework or rejection instead', v_eval ->> 'failed' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_inspection_plan_approval() from public, anon, authenticated;
drop trigger if exists b_guard_inspection_plan_approval on public.quality_inspections;
create trigger b_guard_inspection_plan_approval before insert or update on public.quality_inspections for each row execute function private.guard_inspection_plan_approval();

create or replace function public.inspection_plan_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  v_plan public.inspection_plans%rowtype; v_profile uuid; v_item jsonb; v_seq integer := 0; v_text text;
  q record; v_eval jsonb; v_result jsonb; v_pi public.inspection_plan_items%rowtype; v_observed numeric; v_visual boolean; v_outcome text;
  v_page integer; v_total bigint; v_rows jsonb; v_lower numeric; v_upper numeric; v_nominal numeric; v_unit text;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid inspection plan request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found or p_command not in ('plan.list','plan.load','plan.save_draft','plan.approve','plan.discard_draft','inspection.plan','results.record')
     or v_role not in ('owner','admin','factory_manager','production_manager','quality_manager','quality','viewer')
     or (p_command in ('plan.save_draft','plan.discard_draft','results.record') and v_role not in ('owner','admin','quality_manager','quality'))
     or (p_command = 'plan.approve' and v_role not in ('owner','admin','quality_manager','quality')) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'plan.save_draft' then
    v_profile := nullif(p_payload ->> 'profile_id', '')::uuid;
    if v_profile is not null and not exists (select 1 from public.aluminium_profiles where id = v_profile and company_id = v_company) then raise exception 'Profile is unavailable'; end if;
    v_text := btrim(coalesce(p_payload ->> 'sampling_instruction', ''));
    if length(v_text) not between 3 and 500 then raise exception 'Describe the sampling instruction (3 to 500 characters)'; end if;
    if jsonb_typeof(p_payload -> 'items') is distinct from 'array' or jsonb_array_length(p_payload -> 'items') not between 1 and 50 then raise exception 'A plan needs between 1 and 50 characteristics'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':inspection-plan:' || coalesce(v_profile::text, 'default'), 0));
    select * into v_plan from public.inspection_plans where company_id = v_company and profile_id is not distinct from v_profile and status = 'draft' for update;
    if found then
      if v_plan.id <> coalesce((p_payload ->> 'plan_id')::uuid, v_plan.id) then raise exception 'Another draft exists for this profile. Open it instead'; end if;
      update public.inspection_plans set sampling_instruction = v_text where id = v_plan.id;
      delete from public.inspection_plan_items where plan_id = v_plan.id;
    else
      insert into public.inspection_plans(id, company_id, profile_id, version, sampling_instruction, created_by)
      values (coalesce((p_payload ->> 'plan_id')::uuid, gen_random_uuid()), v_company, v_profile,
        coalesce((select max(version) from public.inspection_plans where company_id = v_company and profile_id is not distinct from v_profile), 0) + 1, v_text, v_actor)
      returning * into v_plan;
    end if;
    for v_item in select value from jsonb_array_elements(p_payload -> 'items') loop
      v_seq := v_seq + 1;
      v_unit := v_item ->> 'unit';
      begin
        v_lower := nullif(v_item ->> 'lower_limit', '')::numeric;
        v_upper := nullif(v_item ->> 'upper_limit', '')::numeric;
        v_nominal := nullif(v_item ->> 'nominal', '')::numeric;
        insert into public.inspection_plan_items(plan_id, company_id, seq, characteristic, unit, method, nominal, lower_limit, upper_limit, critical)
        values (v_plan.id, v_company, v_seq, btrim(coalesce(v_item ->> 'characteristic', '')), v_unit, nullif(btrim(coalesce(v_item ->> 'method', '')), ''),
          v_nominal, v_lower, v_upper, coalesce((v_item ->> 'critical')::boolean, true));
      exception when check_violation or invalid_text_representation or not_null_violation then
        raise exception 'Characteristic % needs a name, a unit, and limits that enclose the nominal value (visual checks have no limits)', v_seq;
      end;
    end loop;
    return jsonb_build_object('id', v_plan.id, 'version', v_plan.version);

  elsif p_command = 'plan.approve' then
    select * into v_plan from public.inspection_plans where id = (p_payload ->> 'plan_id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Inspection plan is unavailable'; end if;
    if v_plan.status <> 'draft' then raise exception 'Only a draft plan can be approved'; end if;
    -- Four eyes: quality staff approve plans drafted by someone else; owners and admins may approve their own.
    if v_plan.created_by = v_actor and v_role not in ('owner','admin') then raise exception 'Another person must approve the plan you drafted' using errcode = '42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':inspection-plan:' || coalesce(v_plan.profile_id::text, 'default'), 0));
    update public.inspection_plans set status = 'superseded', superseded_at = now()
    where company_id = v_company and profile_id is not distinct from v_plan.profile_id and status = 'approved';
    update public.inspection_plans set status = 'approved', approved_by = v_actor, approved_by_name = v_name, approved_at = now() where id = v_plan.id;
    return jsonb_build_object('id', v_plan.id, 'version', v_plan.version);

  elsif p_command = 'plan.discard_draft' then
    delete from public.inspection_plans where id = (p_payload ->> 'plan_id')::uuid and company_id = v_company and status = 'draft';
    if not found then raise exception 'Only a draft plan can be discarded'; end if;
    return jsonb_build_object('discarded', true);

  elsif p_command = 'plan.load' then
    select * into v_plan from public.inspection_plans where id = (p_payload ->> 'plan_id')::uuid and company_id = v_company;
    if not found then raise exception 'Inspection plan is unavailable'; end if;
    return to_jsonb(v_plan) - 'company_id' || jsonb_build_object(
      'profile_code', (select profile_code from public.aluminium_profiles where id = v_plan.profile_id),
      'items', coalesce((select jsonb_agg(to_jsonb(i) - 'company_id' - 'plan_id' order by i.seq) from public.inspection_plan_items i where i.plan_id = v_plan.id), '[]'::jsonb));

  elsif p_command = 'inspection.plan' then
    select id, company_id, status into q from public.quality_inspections where id = (p_payload ->> 'inspection_id')::uuid and company_id = v_company;
    if not found then raise exception 'Inspection is unavailable'; end if;
    return private.inspection_plan_evaluation(q.id) || jsonb_build_object('inspection_status', q.status);

  elsif p_command = 'results.record' then
    select id, company_id, profile_id, status into q from public.quality_inspections where id = (p_payload ->> 'inspection_id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Inspection is unavailable'; end if;
    if q.status <> 'pending' then raise exception 'Results can be recorded only while the inspection is pending'; end if;
    v_eval := private.inspection_plan_evaluation(q.id);
    if v_eval ->> 'plan_id' is null then raise exception 'No approved inspection plan applies to this profile'; end if;
    if (p_payload ->> 'plan_id')::uuid is distinct from (v_eval ->> 'plan_id')::uuid then raise exception 'The applicable inspection plan changed. Reload it before recording results'; end if;
    if jsonb_typeof(p_payload -> 'results') is distinct from 'array' or jsonb_array_length(p_payload -> 'results') not between 1 and 50 then raise exception 'Record between 1 and 50 results'; end if;
    for v_result in select value from jsonb_array_elements(p_payload -> 'results') loop
      select * into v_pi from public.inspection_plan_items where id = (v_result ->> 'item_id')::uuid and plan_id = (v_eval ->> 'plan_id')::uuid;
      if not found then raise exception 'A result refers to a characteristic outside the applicable plan'; end if;
      if v_pi.unit = 'visual' then
        v_visual := (v_result ->> 'visual_ok')::boolean;
        if v_visual is null then raise exception 'Record pass or fail for %', v_pi.characteristic; end if;
        v_observed := null;
        v_outcome := case when v_visual then 'pass' else 'fail' end;
      else
        begin v_observed := (v_result ->> 'observed')::numeric; exception when others then v_observed := null; end;
        if v_observed is null then raise exception 'Enter the measured value for %', v_pi.characteristic; end if;
        v_visual := null;
        v_outcome := case when (v_pi.lower_limit is null or v_observed >= v_pi.lower_limit) and (v_pi.upper_limit is null or v_observed <= v_pi.upper_limit) then 'pass' else 'fail' end;
      end if;
      insert into public.inspection_results(company_id, inspection_id, plan_id, item_id, observed, visual_ok, outcome, recorded_by, recorded_by_name)
      values (v_company, q.id, v_pi.plan_id, v_pi.id, v_observed, v_visual, v_outcome, v_actor, v_name)
      on conflict (inspection_id, item_id) do update set observed = excluded.observed, visual_ok = excluded.visual_ok, outcome = excluded.outcome,
        recorded_by = excluded.recorded_by, recorded_by_name = excluded.recorded_by_name, recorded_at = now();
    end loop;
    return private.inspection_plan_evaluation(q.id) || jsonb_build_object('inspection_status', q.status);
  end if;

  -- plan.list
  v_page := coalesce((p_payload ->> 'page')::integer, 1);
  if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
  select count(*) into v_total from public.inspection_plans where company_id = v_company and status in ('draft','approved');
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from (
    select p.id, p.profile_id, a.profile_code, p.version, p.status, p.approved_by_name, p.approved_at, p.created_at,
      (select count(*) from public.inspection_plan_items i where i.plan_id = p.id) as item_count
    from public.inspection_plans p left join public.aluminium_profiles a on a.id = p.profile_id and a.company_id = v_company
    where p.company_id = v_company and p.status in ('draft','approved')
    order by (p.profile_id is not null), a.profile_code nulls first, p.status, p.version desc limit 10 offset (v_page - 1) * 10) r;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;
revoke all on function public.inspection_plan_command(text, jsonb) from public, anon;
grant execute on function public.inspection_plan_command(text, jsonb) to authenticated;

commit;
