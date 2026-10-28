-- UPGRADE_EOS features 63 (ready-to-start conditions) and 72 (hold and resume procedure).
--
-- private.production_readiness_issues() lists every start prerequisite at once, mirroring the
-- authoritative guards (transition_production_job_atomic, validate_production_start_resources,
-- validate_production_job_source_line). Readiness is advice; the guards still decide at commit.
-- Two conditions are newly enforced when a job starts or resumes:
--   * an active recorded hold must be resumed through its procedure, not bypassed;
--   * a linked billet that became scrap/cancelled or moved to another order blocks the start.
-- Additive only: one new table, new functions, and the transition function re-created with the
-- two extra checks and hold closure on cancellation. Existing error messages are unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.production_job_holds (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  production_job_id uuid not null references public.production_jobs(id),
  reason text not null check (reason in ('material_shortage','die_problem','machine_breakdown','quality_hold','customer_instruction','planning_change','other')),
  note text not null default '' check (length(note) <= 1000 and (reason <> 'other' or length(btrim(note)) > 0)),
  material_condition text not null check (length(btrim(material_condition)) between 1 and 500),
  resume_condition text not null check (length(btrim(resume_condition)) between 1 and 500),
  responsible_user_id uuid not null references public.app_users(id),
  responsible_name text not null,
  previous_status text not null check (previous_status in ('planned','ready','in_progress')),
  -- Progress recorded when the job stopped; resuming never rewrites these.
  recorded_output_kg numeric(14,3),
  recorded_output_pieces integer,
  issued_billet_count integer not null default 0 check (issued_billet_count >= 0),
  issued_billet_kg numeric(14,3) not null default 0 check (issued_billet_kg >= 0),
  status text not null default 'active' check (status in ('active','resumed','cancelled')),
  held_by uuid not null references public.app_users(id),
  held_by_name text not null,
  held_at timestamptz not null default now(),
  closed_by uuid references public.app_users(id),
  closed_by_name text,
  closed_at timestamptz,
  close_note text,
  close_request_id uuid unique,
  check ((status = 'active' and closed_at is null and close_note is null) or (status <> 'active' and closed_at is not null and length(btrim(close_note)) between 1 and 1000))
);
create unique index production_job_hold_active_key on public.production_job_holds(production_job_id) where status = 'active';
create index production_job_hold_job_idx on public.production_job_holds(company_id, production_job_id, held_at desc, id);
create index production_job_hold_responsible_idx on public.production_job_holds(responsible_user_id);
create index production_job_hold_held_by_idx on public.production_job_holds(held_by);
create index production_job_hold_closed_by_idx on public.production_job_holds(closed_by);

alter table public.production_job_holds enable row level security;
revoke all on public.production_job_holds from public, anon, authenticated;
grant select on public.production_job_holds to authenticated;
create policy production_job_hold_read on public.production_job_holds for select to authenticated
  using (company_id = private.get_current_user_company_id()
    and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','factory_manager','production_manager','production','quality','viewer'));

-- Every unmet start prerequisite for p_target ('in_progress', 'ready' or 'planned').
-- enforced=true issues are rejected by the database at commit; enforced=false are advisory.
create or replace function private.production_readiness_issues(p_company uuid, p_job_id uuid, p_target text, p_ignore_hold boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  v_job public.production_jobs%rowtype;
  v_issues jsonb := '[]'::jsonb;
  v_order public.orders%rowtype;
  v_die public.dies%rowtype;
  v_machine public.machines%rowtype;
  v_profile_drawing text;
  v_busy text;
  v_bad record;
  v_hold public.production_job_holds%rowtype;
  v_requires boolean;
begin
  if p_target not in ('in_progress','ready','planned') then raise exception 'Invalid readiness target'; end if;
  select * into v_job from public.production_jobs where id = p_job_id and company_id = p_company;
  if not found then raise exception 'Production job is unavailable for this company'; end if;

  if p_target = 'in_progress' and v_job.status not in ('ready','on_hold') then
    v_issues := v_issues || jsonb_build_object('code','status_not_startable','enforced',true,'message',
      format('Only a ready or held job can start; this job is %s.', replace(v_job.status, '_', ' ')));
  end if;

  if not p_ignore_hold then
    select * into v_hold from public.production_job_holds where company_id = p_company and production_job_id = v_job.id and status = 'active';
    if found then
      v_issues := v_issues || jsonb_build_object('code','active_hold','enforced',true,'message',
        format('Held for %s. Resume through the recorded hold once this is true: %s', replace(v_hold.reason, '_', ' '), v_hold.resume_condition));
    end if;
  end if;

  select * into v_order from public.orders where id = v_job.order_id and company_id = p_company;
  if not found or v_order.current_stage in ('closed','cancelled','delivered','payment_pending') then
    v_issues := v_issues || jsonb_build_object('code','order_ineligible','enforced',true,'message',
      'The order is closed, cancelled, delivered or awaiting payment, so production cannot start.');
  end if;

  if v_job.die_id is null then
    if p_target <> 'planned' then
      v_issues := v_issues || jsonb_build_object('code','die_missing','enforced',true,'message','Assign an approved die for this profile.');
    end if;
  else
    select * into v_die from public.dies where id = v_job.die_id and company_id = p_company;
    if not found or v_die.profile_id is distinct from v_job.profile_id or v_die.die_status not in ('active','approved') then
      v_issues := v_issues || jsonb_build_object('code','die_ineligible','enforced',true,'message',
        format('Die %s is %s or belongs to another profile.', coalesce(v_die.die_number, 'record'), coalesce(replace(v_die.die_status, '_', ' '), 'unavailable')));
    elsif p_target = 'in_progress' then
      select other.job_number into v_busy from public.production_jobs other
      where other.company_id = p_company and other.die_id = v_job.die_id and other.id <> v_job.id and other.status = 'in_progress' limit 1;
      if found then
        v_issues := v_issues || jsonb_build_object('code','die_busy','enforced',true,'message',
          format('Die %s is already running on job %s.', v_die.die_number, coalesce(v_busy, 'another job')));
      end if;
    end if;
  end if;

  if p_target in ('in_progress','ready') then
    if v_job.machine_id is null then
      v_issues := v_issues || jsonb_build_object('code','machine_missing','enforced',true,'message','Assign an extrusion press.');
    else
      select * into v_machine from public.machines where id = v_job.machine_id and company_id = p_company;
      if not found or v_machine.machine_type <> 'extrusion_press' or v_machine.is_active is distinct from true
         or v_machine.status not in ('active','operational','idle') then
        v_issues := v_issues || jsonb_build_object('code','machine_ineligible','enforced',true,'message',
          format('Press %s is %s.', coalesce(v_machine.machine_name, 'record'),
            case when not found then 'unavailable' when v_machine.machine_type <> 'extrusion_press' then 'not an extrusion press'
                 when v_machine.is_active is distinct from true then 'inactive' else coalesce(v_machine.status, 'in an unknown state') end));
      elsif not exists (select 1 from public.production_plan_slots s where s.company_id = p_company and s.production_job_id = v_job.id
                          and s.machine_id = v_job.machine_id and s.status = 'released') then
        v_issues := v_issues || jsonb_build_object('code','slot_missing','enforced',true,'message','Release a press slot for this job on its assigned press.');
      end if;
    end if;
  end if;

  if p_target = 'in_progress' then
    select exists (select 1 from public.order_billet_requirements r where r.company_id = p_company and r.order_id = v_job.order_id
      and r.profile_id = v_job.profile_id and r.status <> 'cancelled' and r.billets_required > 0) into v_requires;
    if v_requires and not exists (select 1 from public.foundry_billets b where b.company_id = p_company and b.order_id = v_job.order_id
        and b.production_job_id = v_job.id and b.status in ('issued','consumed')) then
      v_issues := v_issues || jsonb_build_object('code','billets_not_issued','enforced',true,'message','Issue at least one linked billet to the press.');
    end if;
  end if;

  for v_bad in
    select b.billet_code, b.status, (b.order_id is distinct from v_job.order_id) as moved from public.foundry_billets b
    where b.company_id = p_company and b.production_job_id = v_job.id
      and (b.status not in ('allocated','issued','consumed') or b.order_id is distinct from v_job.order_id)
    order by b.billet_code limit 5
  loop
    v_issues := v_issues || jsonb_build_object('code','billet_ineligible','enforced',true,'message',
      format('Linked billet %s %s. Replace or unlink it before continuing.', coalesce(v_bad.billet_code, 'record'),
        case when v_bad.moved then 'is now allocated to another order' else 'is ' || v_bad.status end));
  end loop;

  select drawing_approval_status into v_profile_drawing from public.aluminium_profiles where id = v_job.profile_id and company_id = p_company;
  if v_profile_drawing is distinct from 'approved' then
    v_issues := v_issues || jsonb_build_object('code','drawing_not_approved','enforced',false,'message',
      case when v_profile_drawing is null then 'Profile drawing approval is not recorded.' else format('Profile drawing is %s.', v_profile_drawing) end);
  end if;
  return v_issues;
end;
$$;
revoke all on function private.production_readiness_issues(uuid, uuid, text, boolean) from public, anon, authenticated;

create or replace function private.production_enforced_messages(p_issues jsonb)
returns text language sql immutable set search_path = public, private as $$
select string_agg(e ->> 'message', ' ' order by o) from jsonb_array_elements(p_issues) with ordinality x(e, o) where (e ->> 'enforced')::boolean;
$$;
revoke all on function private.production_enforced_messages(jsonb) from public, anon, authenticated;

-- Re-created from 20261021100000 with: active-hold and ineligible-billet start checks, and hold closure on cancel.
create or replace function private.transition_production_job_atomic(p_job_id uuid, p_status text, p_reason text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'private'
as $function$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_job public.production_jobs%rowtype;
  v_has_released_slot boolean;
  v_issue jsonb;
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
    -- UPGRADE_EOS 63/72: a recorded hold and material that became ineligible cannot be bypassed.
    for v_issue in select e from jsonb_array_elements(private.production_readiness_issues(v_company_id, v_job.id, 'in_progress', false)) e
      where e ->> 'code' in ('active_hold','billet_ineligible') loop
      raise exception '%', v_issue ->> 'message' using errcode = '23514';
    end loop;
  end if;
  update public.production_jobs set status = p_status,
    remarks = case when nullif(btrim(p_reason),'') is null then remarks when nullif(btrim(remarks),'') is null then btrim(p_reason) else remarks || E'\n' || btrim(p_reason) end,
    updated_at = now()
  where id = v_job.id and company_id = v_company_id;
  insert into public.production_job_status_history(company_id, production_job_id, previous_status, new_status, reason, changed_by, changed_by_role)
  values (v_company_id, v_job.id, v_job.status, p_status, nullif(btrim(p_reason),''), auth.uid(), v_role);
  if p_status = 'cancelled' then
    update public.production_job_holds set status = 'cancelled', closed_by = auth.uid(),
      closed_by_name = coalesce((select nullif(full_name, '') from public.app_users where id = auth.uid()), 'Employee'),
      closed_at = now(), close_note = coalesce(nullif(btrim(p_reason), ''), 'Production job cancelled')
    where company_id = v_company_id and production_job_id = v_job.id and status = 'active';
    perform private.release_production_job_billets(v_company_id, v_job.id, null);
  end if;
  return v_job.id;
end;
$function$;
revoke all on function private.transition_production_job_atomic(uuid, text, text) from public, anon, authenticated;

create or replace function public.production_hold_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  v_job public.production_jobs%rowtype;
  v_hold public.production_job_holds%rowtype;
  v_request uuid;
  v_job_id uuid;
  v_reason text; v_note text; v_material text; v_resume text; v_responsible uuid; v_responsible_name text;
  v_expected text; v_issues jsonb; v_messages text; v_page integer; v_rows jsonb; v_total bigint;
  v_billets integer; v_billet_kg numeric;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid hold request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found
     or (p_command in ('holds.place','holds.resume') and v_role not in ('owner','admin','factory_manager','production_manager','production'))
     or (p_command in ('holds.readiness','holds.list') and v_role not in ('owner','admin','factory_manager','production_manager','production','quality','viewer'))
     or p_command not in ('holds.place','holds.resume','holds.readiness','holds.list') then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;
  v_job_id := (p_payload ->> 'job_id')::uuid;

  if p_command = 'holds.readiness' then
    select * into v_job from public.production_jobs where id = v_job_id and company_id = v_company;
    if not found then raise exception 'Production job is unavailable for this company'; end if;
    select * into v_hold from public.production_job_holds where company_id = v_company and production_job_id = v_job.id and status = 'active';
    return jsonb_build_object(
      'job_status', v_job.status,
      'start_issues', case when v_job.status in ('ready','on_hold') then private.production_readiness_issues(v_company, v_job.id, 'in_progress', false) else '[]'::jsonb end,
      'release_issues', case when v_job.status = 'planned' then private.production_readiness_issues(v_company, v_job.id, 'ready', false) else '[]'::jsonb end,
      'resume_issues', case when v_hold.id is not null then private.production_readiness_issues(v_company, v_job.id, v_hold.previous_status, true) else '[]'::jsonb end,
      'hold', case when v_hold.id is null then null else jsonb_build_object(
        'id', v_hold.id, 'reason', v_hold.reason, 'note', v_hold.note, 'material_condition', v_hold.material_condition,
        'resume_condition', v_hold.resume_condition, 'responsible_name', v_hold.responsible_name, 'previous_status', v_hold.previous_status,
        'recorded_output_kg', v_hold.recorded_output_kg, 'recorded_output_pieces', v_hold.recorded_output_pieces,
        'issued_billet_count', v_hold.issued_billet_count, 'issued_billet_kg', v_hold.issued_billet_kg,
        'held_by_name', v_hold.held_by_name, 'held_at', v_hold.held_at) end);
  elsif p_command = 'holds.list' then
    if not exists (select 1 from public.production_jobs where id = v_job_id and company_id = v_company) then raise exception 'Production job is unavailable for this company'; end if;
    v_page := coalesce((p_payload ->> 'page')::integer, 1);
    if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
    select count(*) into v_total from public.production_job_holds where company_id = v_company and production_job_id = v_job_id;
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from (
      select id, reason, note, material_condition, resume_condition, responsible_name, previous_status, status,
             held_by_name, held_at::text, closed_by_name, closed_at::text, close_note
      from public.production_job_holds where company_id = v_company and production_job_id = v_job_id
      order by held_at desc, id limit 10 offset (v_page - 1) * 10) r;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total);
  end if;

  v_request := (p_payload ->> 'request_id')::uuid;
  if v_request is null then raise exception 'A request identity is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':' || v_actor::text || ':' || v_request::text, 0));

  if p_command = 'holds.place' then
    v_reason := p_payload ->> 'reason';
    v_note := btrim(coalesce(p_payload ->> 'note', ''));
    v_material := btrim(coalesce(p_payload ->> 'material_condition', ''));
    v_resume := btrim(coalesce(p_payload ->> 'resume_condition', ''));
    v_responsible := (p_payload ->> 'responsible_user_id')::uuid;
    v_expected := p_payload ->> 'expected_status';
    if v_reason is null or v_reason not in ('material_shortage','die_problem','machine_breakdown','quality_hold','customer_instruction','planning_change','other')
       or length(v_note) > 1000 or (v_reason = 'other' and v_note = '')
       or length(v_material) not between 1 and 500 or length(v_resume) not between 1 and 500
       or v_material ~ '[[:cntrl:]]' or v_resume ~ '[[:cntrl:]]' then
      raise exception 'Record the hold reason, material condition and what permits resumption';
    end if;
    select * into v_hold from public.production_job_holds where id = v_request;
    if found then
      if v_hold.company_id <> v_company or v_hold.held_by <> v_actor or v_hold.production_job_id is distinct from v_job_id or v_hold.reason <> v_reason
         or v_hold.note <> v_note or v_hold.material_condition <> v_material or v_hold.resume_condition <> v_resume or v_hold.responsible_user_id is distinct from v_responsible then
        raise exception 'The request identity was already used for different details';
      end if;
      return jsonb_build_object('id', v_hold.id);
    end if;
    select coalesce(nullif(full_name, ''), 'Employee') into v_responsible_name from public.app_users
    where id = v_responsible and company_id = v_company and is_active and dealer_id is null
      and role in ('owner','admin','factory_manager','production_manager','production','quality');
    if not found then raise exception 'Choose an active production employee as the responsible person'; end if;
    select * into v_job from public.production_jobs where id = v_job_id and company_id = v_company for update;
    if not found then raise exception 'Production job is unavailable for this company'; end if;
    if v_job.status is distinct from v_expected then raise exception 'The job status changed. Refresh before placing it on hold'; end if;
    if v_job.status not in ('planned','ready','in_progress') then raise exception 'Only planned, ready or running jobs can be placed on hold'; end if;
    select count(*), coalesce(sum(coalesce(measured_weight_kg, weight_kg)), 0) into v_billets, v_billet_kg from public.foundry_billets
    where company_id = v_company and production_job_id = v_job.id and status in ('issued','consumed');
    -- The authoritative transition records status history and applies the existing press rule.
    perform private.transition_production_job_atomic(v_job.id, 'on_hold', 'Hold: ' || replace(v_reason, '_', ' ') || case when v_note = '' then '' else ' - ' || v_note end);
    insert into public.production_job_holds(id, company_id, production_job_id, reason, note, material_condition, resume_condition,
      responsible_user_id, responsible_name, previous_status, recorded_output_kg, recorded_output_pieces, issued_billet_count, issued_billet_kg, held_by, held_by_name)
    values (v_request, v_company, v_job.id, v_reason, v_note, v_material, v_resume, v_responsible, v_responsible_name, v_job.status,
      v_job.actual_quantity_kg, v_job.actual_pieces, v_billets, v_billet_kg, v_actor, v_name);
    return jsonb_build_object('id', v_request);
  end if;

  -- holds.resume
  v_note := btrim(coalesce(p_payload ->> 'note', ''));
  if length(v_note) not between 1 and 1000 or v_note ~ '[[:cntrl:]]' then raise exception 'Record what was done before resuming'; end if;
  select * into v_hold from public.production_job_holds where close_request_id = v_request;
  if found then
    if v_hold.company_id <> v_company or v_hold.closed_by <> v_actor or v_hold.id::text <> p_payload ->> 'hold_id' or v_hold.close_note <> v_note then
      raise exception 'The request identity was already used for different details';
    end if;
    return jsonb_build_object('id', v_hold.id);
  end if;
  select * into v_job from public.production_jobs where id = v_job_id and company_id = v_company for update;
  if not found then raise exception 'Production job is unavailable for this company'; end if;
  select * into v_hold from public.production_job_holds where id = (p_payload ->> 'hold_id')::uuid and company_id = v_company and production_job_id = v_job.id for update;
  if not found or v_hold.status <> 'active' then raise exception 'This hold was already resolved. Refresh before resuming'; end if;
  if v_job.status <> 'on_hold' then raise exception 'The job is no longer on hold. Refresh before resuming'; end if;
  v_issues := private.production_readiness_issues(v_company, v_job.id, v_hold.previous_status, true);
  v_messages := private.production_enforced_messages(v_issues);
  if v_messages is not null then raise exception 'Cannot resume yet. %', v_messages using errcode = '23514'; end if;
  update public.production_job_holds set status = 'resumed', closed_by = v_actor, closed_by_name = v_name, closed_at = now(), close_note = v_note, close_request_id = v_request
  where id = v_hold.id;
  if v_hold.previous_status = 'in_progress' then
    perform private.transition_production_job_atomic(v_job.id, 'in_progress', 'Resumed: ' || v_note);
  else
    -- planned/ready are not general on_hold targets; the recorded hold restores the prior state after its checks.
    update public.production_jobs set status = v_hold.previous_status, updated_at = now() where id = v_job.id and company_id = v_company;
    insert into public.production_job_status_history(company_id, production_job_id, previous_status, new_status, reason, changed_by, changed_by_role)
    values (v_company, v_job.id, 'on_hold', v_hold.previous_status, 'Resumed: ' || v_note, v_actor, v_role);
  end if;
  return jsonb_build_object('id', v_hold.id);
end;
$$;
revoke all on function public.production_hold_command(text, jsonb) from public, anon;
grant execute on function public.production_hold_command(text, jsonb) to authenticated;

commit;
