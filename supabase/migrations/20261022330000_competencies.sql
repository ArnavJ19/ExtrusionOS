-- UPGRADE_EOS feature 76: competency-linked task authorisation.
--
-- A company keeps a catalogue of competencies, optionally linked to an operating procedure (SOP)
-- and a validity period. Employees hold a grant at one of three levels:
--   trained     - has read / been trained on the procedure (acknowledgement only),
--   supervised  - may perform it only with an independent holder confirming supervision,
--   independent - may perform it alone.
-- Training acknowledgement is therefore separate from demonstrated competency. A grant lapses
-- when it expires or is revoked; when its linked procedure is revised, an independent grant is
-- treated as supervised until the employee is re-qualified on the new revision. Grants keep
-- their history (a new grant revokes the previous one) and nobody grants their own competency
-- except the owner. A company may require a competency for two restricted actions: releasing
-- material in QC (an inspection becoming approved) and starting a production job. When required,
-- the database refuses the action unless the employee is independent, or supervised with a
-- valid supervision confirmation from a different independent holder. Without a requirement,
-- nothing changes. Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.competencies (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$'),
  name text not null check (length(btrim(name)) between 3 and 120),
  procedure_id uuid references public.operating_procedures(id),
  validity_months integer check (validity_months is null or validity_months between 1 and 60),
  is_active boolean not null default true,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now()
);
create unique index competencies_code_key on public.competencies(company_id, code);
create index competencies_procedure_idx on public.competencies(procedure_id);
create index competencies_created_by_idx on public.competencies(created_by);

create table public.employee_competencies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.app_users(id),
  competency_id uuid not null references public.competencies(id),
  level text not null check (level in ('trained','supervised','independent')),
  procedure_revision integer,
  granted_by uuid not null references public.app_users(id),
  granted_by_name text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  note text check (note is null or length(note) <= 300),
  revoked_at timestamptz,
  revoked_by uuid references public.app_users(id),
  revoke_reason text check (revoke_reason is null or length(revoke_reason) <= 300)
);
create unique index employee_competencies_current on public.employee_competencies(employee_id, competency_id) where revoked_at is null;
create index employee_competencies_company_idx on public.employee_competencies(company_id, competency_id);
create index employee_competencies_competency_idx on public.employee_competencies(competency_id);
create index employee_competencies_granted_by_idx on public.employee_competencies(granted_by);
create index employee_competencies_revoked_by_idx on public.employee_competencies(revoked_by);

create table public.competency_requirements (
  company_id uuid not null references public.companies(id),
  action text not null check (action in ('qc_release','production_start')),
  competency_id uuid not null references public.competencies(id),
  set_by uuid not null references public.app_users(id),
  set_at timestamptz not null default now(),
  primary key (company_id, action)
);
create index competency_requirements_competency_idx on public.competency_requirements(competency_id);
create index competency_requirements_set_by_idx on public.competency_requirements(set_by);

create table public.supervision_confirmations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  action text not null check (action in ('qc_release','production_start')),
  record_id uuid not null,
  performer_id uuid not null references public.app_users(id),
  supervisor_id uuid not null references public.app_users(id),
  supervisor_name text not null,
  confirmed_at timestamptz not null default now(),
  used_at timestamptz,
  check (performer_id <> supervisor_id)
);
create index supervision_confirmations_lookup on public.supervision_confirmations(company_id, action, record_id, performer_id) where used_at is null;
create index supervision_confirmations_performer_idx on public.supervision_confirmations(performer_id);
create index supervision_confirmations_supervisor_idx on public.supervision_confirmations(supervisor_id);

alter table public.competencies enable row level security;
alter table public.employee_competencies enable row level security;
alter table public.competency_requirements enable row level security;
alter table public.supervision_confirmations enable row level security;
revoke all on public.competencies, public.employee_competencies, public.competency_requirements, public.supervision_confirmations from public, anon, authenticated;
grant select on public.competencies, public.employee_competencies, public.competency_requirements, public.supervision_confirmations to authenticated;
create policy competencies_read on public.competencies for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy employee_competencies_read on public.employee_competencies for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy competency_requirements_read on public.competency_requirements for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy supervision_confirmations_read on public.supervision_confirmations for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);

-- The level an employee may act at now, and why it is lower than granted when it is.
create or replace function private.competency_standing(p_employee uuid, p_competency uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare g public.employee_competencies%rowtype; v_revision integer; v_active boolean;
begin
  select * into g from public.employee_competencies where employee_id = p_employee and competency_id = p_competency and revoked_at is null;
  if not found then return jsonb_build_object('granted', null, 'effective', 'none', 'reason', 'not_granted'); end if;
  if g.expires_at is not null and g.expires_at <= now() then
    return jsonb_build_object('granted', g.level, 'effective', 'none', 'reason', 'expired', 'expires_at', g.expires_at);
  end if;
  select p.revision, p.is_active into v_revision, v_active from public.competencies c join public.operating_procedures p on p.id = c.procedure_id where c.id = p_competency;
  if v_revision is not null and g.level = 'independent' and coalesce(g.procedure_revision, 0) < v_revision then
    return jsonb_build_object('granted', g.level, 'effective', 'supervised', 'reason', 'procedure_revised', 'granted_revision', g.procedure_revision, 'current_revision', v_revision);
  end if;
  return jsonb_build_object('granted', g.level, 'effective', g.level, 'reason', null, 'expires_at', g.expires_at);
end;
$$;
revoke all on function private.competency_standing(uuid, uuid) from public, anon, authenticated;

-- Raises unless the current user may perform a restricted action on a record.
create or replace function private.require_competency(p_company uuid, p_action text, p_record uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_req record; v_standing jsonb; v_confirmation uuid;
begin
  if v_actor is null then return; end if;  -- system processes are not employees
  select r.competency_id, c.name into v_req from public.competency_requirements r join public.competencies c on c.id = r.competency_id
  where r.company_id = p_company and r.action = p_action and c.is_active;
  if not found then return; end if;
  v_standing := private.competency_standing(v_actor, v_req.competency_id);
  if v_standing ->> 'effective' = 'independent' then return; end if;
  if v_standing ->> 'effective' = 'supervised' then
    select id into v_confirmation from public.supervision_confirmations
    where company_id = p_company and action = p_action and record_id = p_record and performer_id = v_actor and used_at is null and confirmed_at > now() - interval '8 hours'
    order by confirmed_at desc limit 1 for update;
    if found then
      update public.supervision_confirmations set used_at = now() where id = v_confirmation;
      return;
    end if;
    raise exception '% requires supervision for you%. An independent holder must confirm supervision first',
      v_req.name, case when v_standing ->> 'reason' = 'procedure_revised' then ' (the procedure was revised since you qualified)' else '' end using errcode = '42501';
  end if;
  raise exception 'You are not authorised for %: %', v_req.name,
    case v_standing ->> 'reason' when 'expired' then 'your qualification has expired'
      when 'not_granted' then 'no qualification is recorded'
      else 'training is recorded, but competency has not been confirmed' end using errcode = '42501';
end;
$$;
revoke all on function private.require_competency(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.guard_competency_actions()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_table_name = 'quality_inspections' then
    if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
      perform private.require_competency(new.company_id, 'qc_release', new.id);
    end if;
  elsif new.status = 'in_progress' and (tg_op = 'INSERT' or old.status is distinct from 'in_progress') then
    perform private.require_competency(new.company_id, 'production_start', new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_competency_actions() from public, anon, authenticated;
drop trigger if exists c_guard_competency_actions on public.quality_inspections;
create trigger c_guard_competency_actions before insert or update on public.quality_inspections for each row execute function private.guard_competency_actions();
drop trigger if exists c_guard_competency_actions on public.production_jobs;
create trigger c_guard_competency_actions before insert or update on public.production_jobs for each row execute function private.guard_competency_actions();

create or replace function public.competency_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  v_manager boolean := v_role in ('owner','admin','factory_manager');
  c public.competencies%rowtype; v_employee record; v_level text; v_revision integer; v_expires timestamptz; v_note text; v_req record; v_standing jsonb;
  v_performer uuid; v_record uuid; v_action text; v_page integer; v_total bigint; v_rows jsonb;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid competency request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found or p_command not in ('catalog.list','catalog.save','grant.set','grant.revoke','grants.list','requirements.list','requirements.set','standing','supervise.confirm')
     or (p_command in ('catalog.save','grant.set','grant.revoke','requirements.set') and not v_manager) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'catalog.list' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name, 'procedure_id', x.procedure_id, 'procedure_title', p.title, 'procedure_revision', p.revision,
        'validity_months', x.validity_months, 'is_active', x.is_active,
        'holders', (select count(*) from public.employee_competencies g where g.competency_id = x.id and g.revoked_at is null and g.level = 'independent' and (g.expires_at is null or g.expires_at > now()))) order by x.code)
      from public.competencies x left join public.operating_procedures p on p.id = x.procedure_id and p.company_id = v_company where x.company_id = v_company), '[]'::jsonb);

  elsif p_command = 'catalog.save' then
    if (p_payload ->> 'procedure_id') is not null and not exists (select 1 from public.operating_procedures where id = (p_payload ->> 'procedure_id')::uuid and company_id = v_company) then
      raise exception 'Procedure is unavailable';
    end if;
    begin
      insert into public.competencies(id, company_id, code, name, procedure_id, validity_months, is_active, created_by)
      values ((p_payload ->> 'id')::uuid, v_company, upper(btrim(p_payload ->> 'code')), btrim(p_payload ->> 'name'), nullif(p_payload ->> 'procedure_id', '')::uuid,
        nullif(p_payload ->> 'validity_months', '')::integer, coalesce((p_payload ->> 'is_active')::boolean, true), v_actor)
      on conflict (id) do update set name = excluded.name, procedure_id = excluded.procedure_id, validity_months = excluded.validity_months, is_active = excluded.is_active
      where competencies.company_id = v_company
      returning * into c;
    exception when check_violation or not_null_violation or invalid_text_representation then
      raise exception 'Enter a code (capitals, digits, - or _), a name of 3 to 120 characters and a validity of 1 to 60 months if it expires';
    when unique_violation then raise exception 'That competency code is already used';
    end;
    if c.id is null then raise exception 'Competency is unavailable'; end if;
    return jsonb_build_object('id', c.id);

  elsif p_command = 'grant.set' then
    select * into c from public.competencies where id = (p_payload ->> 'competency_id')::uuid and company_id = v_company and is_active;
    if not found then raise exception 'Choose an active competency'; end if;
    select id, role into v_employee from public.app_users where id = (p_payload ->> 'employee_id')::uuid and company_id = v_company and is_active and dealer_id is null;
    if v_employee.id is null then raise exception 'Choose an active employee'; end if;
    if v_employee.id = v_actor and v_role <> 'owner' then raise exception 'You cannot grant a competency to yourself' using errcode = '42501'; end if;
    v_level := p_payload ->> 'level';
    if v_level not in ('trained','supervised','independent') then raise exception 'Choose trained, supervised or independent'; end if;
    v_note := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
    if v_note is not null and length(v_note) > 300 then raise exception 'Keep the note under 300 characters'; end if;
    select revision into v_revision from public.operating_procedures where id = c.procedure_id;
    v_expires := case when c.validity_months is null then null else now() + make_interval(months => c.validity_months) end;
    perform pg_advisory_xact_lock(hashtextextended(v_employee.id::text || ':' || c.id::text, 0));
    update public.employee_competencies set revoked_at = now(), revoked_by = v_actor, revoke_reason = 'Replaced by a new grant'
    where employee_id = v_employee.id and competency_id = c.id and revoked_at is null;
    insert into public.employee_competencies(company_id, employee_id, competency_id, level, procedure_revision, granted_by, granted_by_name, expires_at, note)
    values (v_company, v_employee.id, c.id, v_level, v_revision, v_actor, v_name, v_expires, v_note);
    return private.competency_standing(v_employee.id, c.id);

  elsif p_command = 'grant.revoke' then
    v_note := btrim(coalesce(p_payload ->> 'reason', ''));
    if length(v_note) not between 3 and 300 then raise exception 'Record why the competency is withdrawn (3 to 300 characters)'; end if;
    update public.employee_competencies set revoked_at = now(), revoked_by = v_actor, revoke_reason = v_note
    where company_id = v_company and employee_id = (p_payload ->> 'employee_id')::uuid and competency_id = (p_payload ->> 'competency_id')::uuid and revoked_at is null;
    if not found then raise exception 'No current grant to withdraw'; end if;
    return jsonb_build_object('revoked', true);

  elsif p_command = 'grants.list' then
    -- One competency's current holders, or one employee's competencies (employees may see their own).
    if (p_payload ->> 'employee_id') is not null then
      if (p_payload ->> 'employee_id')::uuid <> v_actor and v_role not in ('owner','admin','factory_manager','production_manager','quality','dispatch_manager') then
        raise exception 'This action is not permitted for your role' using errcode = '42501';
      end if;
      return coalesce((select jsonb_agg(jsonb_build_object('competency_id', x.id, 'code', x.code, 'name', x.name, 'level', g.level, 'granted_by_name', g.granted_by_name, 'granted_at', g.granted_at,
          'expires_at', g.expires_at, 'standing', private.competency_standing(g.employee_id, x.id)) order by x.code)
        from public.employee_competencies g join public.competencies x on x.id = g.competency_id
        where g.company_id = v_company and g.employee_id = (p_payload ->> 'employee_id')::uuid and g.revoked_at is null), '[]'::jsonb);
    end if;
    v_page := coalesce((p_payload ->> 'page')::integer, 1);
    if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
    select count(*) into v_total from public.employee_competencies where company_id = v_company and competency_id = (p_payload ->> 'competency_id')::uuid and revoked_at is null;
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from (
      select g.employee_id, u.full_name as employee_name, u.role as employee_role, g.level, g.granted_by_name, g.granted_at, g.expires_at, private.competency_standing(g.employee_id, g.competency_id) as standing
      from public.employee_competencies g join public.app_users u on u.id = g.employee_id
      where g.company_id = v_company and g.competency_id = (p_payload ->> 'competency_id')::uuid and g.revoked_at is null
      order by u.full_name, g.employee_id limit 10 offset (v_page - 1) * 10) r;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total);

  elsif p_command = 'requirements.list' then
    return coalesce((select jsonb_agg(jsonb_build_object('action', a.action_name, 'competency_id', r.competency_id, 'competency_name', x.name, 'competency_code', x.code) order by a.action_name)
      from unnest(array['production_start','qc_release']) as a(action_name)
      left join public.competency_requirements r on r.company_id = v_company and r.action = a.action_name
      left join public.competencies x on x.id = r.competency_id), '[]'::jsonb);

  elsif p_command = 'requirements.set' then
    v_action := p_payload ->> 'action';
    if v_action not in ('qc_release','production_start') then raise exception 'Choose QC release or production start'; end if;
    if nullif(p_payload ->> 'competency_id', '') is null then
      delete from public.competency_requirements where company_id = v_company and action = v_action;
      return jsonb_build_object('action', v_action, 'required', false);
    end if;
    select * into c from public.competencies where id = (p_payload ->> 'competency_id')::uuid and company_id = v_company and is_active;
    if not found then raise exception 'Choose an active competency'; end if;
    if not exists (select 1 from public.employee_competencies g where g.competency_id = c.id and g.revoked_at is null and g.level = 'independent' and (g.expires_at is null or g.expires_at > now())) then
      raise exception 'Grant this competency at independent level to at least one employee before requiring it';
    end if;
    insert into public.competency_requirements(company_id, action, competency_id, set_by) values (v_company, v_action, c.id, v_actor)
    on conflict (company_id, action) do update set competency_id = excluded.competency_id, set_by = v_actor, set_at = now();
    return jsonb_build_object('action', v_action, 'required', true);

  elsif p_command = 'standing' then
    -- Whether an employee (default: me) may perform an action now.
    v_action := p_payload ->> 'action';
    if v_action not in ('qc_release','production_start') then raise exception 'Choose QC release or production start'; end if;
    select r.competency_id, x.name into v_req from public.competency_requirements r join public.competencies x on x.id = r.competency_id
    where r.company_id = v_company and r.action = v_action and x.is_active;
    if not found then return jsonb_build_object('action', v_action, 'required', false, 'effective', 'not_required'); end if;
    return jsonb_build_object('action', v_action, 'required', true, 'competency_name', v_req.name)
      || private.competency_standing(coalesce((p_payload ->> 'employee_id')::uuid, v_actor), v_req.competency_id);
  end if;

  -- supervise.confirm: an independent holder confirms they supervise one action on one record.
  v_action := p_payload ->> 'action';
  v_record := (p_payload ->> 'record_id')::uuid;
  v_performer := (p_payload ->> 'performer_id')::uuid;
  if v_action not in ('qc_release','production_start') or v_record is null or v_performer is null then raise exception 'Choose the action, record and employee being supervised'; end if;
  if v_performer = v_actor then raise exception 'You cannot supervise yourself' using errcode = '42501'; end if;
  if not exists (select 1 from public.app_users where id = v_performer and company_id = v_company and is_active and dealer_id is null) then raise exception 'Choose an active employee'; end if;
  if (v_action = 'qc_release' and not exists (select 1 from public.quality_inspections where id = v_record and company_id = v_company))
     or (v_action = 'production_start' and not exists (select 1 from public.production_jobs where id = v_record and company_id = v_company)) then
    raise exception 'The record is unavailable';
  end if;
  select r.competency_id into v_req from public.competency_requirements r where r.company_id = v_company and r.action = v_action;
  if not found then raise exception 'This action does not require a competency'; end if;
  v_standing := private.competency_standing(v_actor, v_req.competency_id);
  if v_standing ->> 'effective' <> 'independent' then raise exception 'Only an independent holder of the competency can confirm supervision' using errcode = '42501'; end if;
  insert into public.supervision_confirmations(company_id, action, record_id, performer_id, supervisor_id, supervisor_name)
  values (v_company, v_action, v_record, v_performer, v_actor, v_name);
  return jsonb_build_object('confirmed', true, 'valid_hours', 8);
end;
$$;
revoke all on function public.competency_command(text, jsonb) from public, anon;
grant execute on function public.competency_command(text, jsonb) to authenticated;

commit;
