-- UPGRADE_EOS feature 67: objective completion criteria.
--
-- A task can carry criteria that define the business outcome, evaluated on the server from current
-- records. Each criterion is one of:
--   * source_state      the linked record (order, inspection, production job, dispatch, quote,
--                       invoice or breakdown) is in one of the stated states
--   * inspection_pass   the linked inspection is not rejected and every result of its approved plan
--                       is recorded and within limits (feature 54); with no plan, it is approved
--   * handoff_accepted  the receiving team accepted this department handoff (feature 69)
--   * observation       a recorded value is within limits (for example coating thickness)
--   * sign_off          an employee of a named role, other than the assignee, signed off; results
--                       recorded after the sign-off invalidate it
-- A criterion binds the record the task was linked to when it was attached, so a task re-linked to
-- another record fails as "linked to the wrong source". Templates per task kind attach criteria to
-- new tasks automatically; supervisors add or remove (with a reason) criteria on one task.
-- A trigger on tasks refuses completion, by any path, while a criterion is unmet, and lists why.
-- Completing the checklist is therefore separate from completing the business work. Completed
-- tasks whose outcome is later reversed appear for review and can be reopened with a reason.
-- Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.completion_criteria_templates (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  task_kind text not null check (task_kind ~ '^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$'),
  seq integer not null default 1 check (seq between 1 and 100),
  kind text not null check (kind in ('source_state','inspection_pass','handoff_accepted','observation','sign_off')),
  label text not null check (length(btrim(label)) between 3 and 120),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  is_active boolean not null default true,
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default now()
);
create index completion_criteria_templates_kind_idx on public.completion_criteria_templates(company_id, task_kind, is_active);
create index completion_criteria_templates_updated_by_idx on public.completion_criteria_templates(updated_by);

create table public.task_completion_criteria (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  task_id uuid not null references public.tasks(id) on delete cascade,
  seq integer not null,
  kind text not null check (kind in ('source_state','inspection_pass','handoff_accepted','observation','sign_off')),
  label text not null check (length(btrim(label)) between 3 and 120),
  config jsonb not null default '{}'::jsonb,
  source_type text,
  source_id uuid,
  template_id uuid references public.completion_criteria_templates(id),
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.app_users(id),
  remove_reason text,
  check ((removed_at is null) = (remove_reason is null))
);
create index task_completion_criteria_task_idx on public.task_completion_criteria(task_id, seq) where removed_at is null;
create index task_completion_criteria_company_idx on public.task_completion_criteria(company_id);
create index task_completion_criteria_template_idx on public.task_completion_criteria(template_id);
create index task_completion_criteria_created_by_idx on public.task_completion_criteria(created_by);
create index task_completion_criteria_removed_by_idx on public.task_completion_criteria(removed_by);

create table public.task_criterion_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  task_id uuid not null references public.tasks(id) on delete cascade,
  criterion_id uuid not null references public.task_completion_criteria(id) on delete cascade,
  kind text not null check (kind in ('observation','sign_off')),
  value numeric(14,4),
  note text check (note is null or length(note) <= 300),
  recorded_by uuid not null references public.app_users(id),
  recorded_by_name text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  check ((kind = 'observation') = (value is not null))
);
create unique index task_criterion_evidence_current on public.task_criterion_evidence(criterion_id) where superseded_at is null;
create index task_criterion_evidence_task_idx on public.task_criterion_evidence(task_id, recorded_at);
create index task_criterion_evidence_company_idx on public.task_criterion_evidence(company_id);
create index task_criterion_evidence_recorded_by_idx on public.task_criterion_evidence(recorded_by);

-- Completions and reopenings with the evaluation at that moment.
create table public.task_completion_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  task_id uuid not null references public.tasks(id) on delete cascade,
  event text not null check (event in ('completed','reopened')),
  evaluation jsonb not null,
  reason text check (reason is null or length(reason) <= 300),
  actor_id uuid references public.app_users(id),
  created_at timestamptz not null default now()
);
create index task_completion_checks_task_idx on public.task_completion_checks(task_id, created_at);
create index task_completion_checks_company_idx on public.task_completion_checks(company_id, created_at desc);
create index task_completion_checks_actor_idx on public.task_completion_checks(actor_id);

alter table public.completion_criteria_templates enable row level security;
alter table public.task_completion_criteria enable row level security;
alter table public.task_criterion_evidence enable row level security;
alter table public.task_completion_checks enable row level security;
revoke all on public.completion_criteria_templates, public.task_completion_criteria, public.task_criterion_evidence, public.task_completion_checks from public, anon, authenticated;
grant select on public.completion_criteria_templates, public.task_completion_criteria, public.task_criterion_evidence, public.task_completion_checks to authenticated;
create policy completion_criteria_templates_read on public.completion_criteria_templates for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy task_completion_criteria_read on public.task_completion_criteria for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy task_criterion_evidence_read on public.task_criterion_evidence for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy task_completion_checks_read on public.task_completion_checks for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);

-- States each source type can be in (mirrors the app's status types).
create or replace function private.task_source_states(p_type text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_type
    when 'order' then array['order_confirmed','die_ready','billet_ready','billet_heating','extrusion_planned','extruded','stretching','cutting','aging','surface_treatment','finishing','packing','dispatched','delivered','payment_pending','closed','cancelled']
    when 'quality_inspection' then array['pending','approved','rejected','rework']
    when 'production_job' then array['planned','ready','in_progress','completed','on_hold','cancelled']
    when 'dispatch' then array['pending','dispatched','in_transit','delivered','delayed','damaged','returned']
    when 'quote' then array['draft','internal_review','approved_for_sending','sent','customer_approved','customer_rejected','expired','converted_to_order']
    when 'invoice' then array['draft','generated','sent','partially_paid','paid','overdue','credited','cancelled']
    when 'breakdown_log' then array['open','in_progress','resolved','recurring']
    else array[]::text[] end
$$;
revoke all on function private.task_source_states(text) from public, anon, authenticated;

-- Current state of a linked record, or null when it is missing or belongs to another company.
-- An invoice with no balance counts as paid; a breakdown with an end time counts as resolved.
create or replace function private.task_source_state(p_company uuid, p_type text, p_id uuid)
returns text language sql stable security definer set search_path = public, private as $$
  select case p_type
    when 'order' then (select current_stage from public.orders where id = p_id and company_id = p_company and deleted_at is null)
    when 'quality_inspection' then (select status from public.quality_inspections where id = p_id and company_id = p_company)
    when 'production_job' then (select status from public.production_jobs where id = p_id and company_id = p_company)
    when 'dispatch' then (select delivery_status from public.dispatches where id = p_id and company_id = p_company)
    when 'quote' then (select status from public.quotes where id = p_id and company_id = p_company and deleted_at is null)
    when 'invoice' then (select case when status in ('draft','cancelled','credited') then status when balance_due <= 0 then 'paid' else status end
      from public.invoices where id = p_id and company_id = p_company and deleted_at is null)
    when 'breakdown_log' then (select case when end_time is not null or resolved_at is not null then 'resolved' else status end
      from public.breakdown_logs where id = p_id and company_id = p_company)
  end
$$;
revoke all on function private.task_source_state(uuid, text, uuid) from public, anon, authenticated;

-- Why a criterion configuration is invalid, or null.
create or replace function private.criterion_config_problem(p_kind text, p_config jsonb)
returns text language plpgsql immutable set search_path = public, private as $$
declare v_type text := p_config ->> 'source_type'; v_states text[]; v_roles text[]; v_min numeric; v_max numeric;
begin
  if jsonb_typeof(p_config) is distinct from 'object' then return 'Invalid criterion settings'; end if;
  if p_kind = 'source_state' then
    if cardinality(private.task_source_states(v_type)) = 0 then return 'Choose the kind of record this criterion checks'; end if;
    if jsonb_typeof(p_config -> 'states') is distinct from 'array' or jsonb_array_length(p_config -> 'states') = 0 then return 'Choose at least one required state'; end if;
    select array_agg(value) into v_states from jsonb_array_elements_text(p_config -> 'states');
    if not (v_states <@ private.task_source_states(v_type)) then return 'A required state does not exist for this kind of record'; end if;
  elsif p_kind = 'observation' then
    if length(btrim(coalesce(p_config ->> 'unit', ''))) not between 1 and 20 then return 'Give the unit of the observation (1 to 20 characters)'; end if;
    begin
      v_min := nullif(p_config ->> 'min', '')::numeric; v_max := nullif(p_config ->> 'max', '')::numeric;
    exception when invalid_text_representation then return 'Observation limits must be numbers'; end;
    if v_min is null and v_max is null then return 'Set at least one observation limit'; end if;
    if v_min > v_max then return 'The lower limit is above the upper limit'; end if;
  elsif p_kind = 'sign_off' then
    if jsonb_typeof(p_config -> 'roles') is distinct from 'array' or jsonb_array_length(p_config -> 'roles') = 0 then return 'Choose who may sign off'; end if;
    select array_agg(value) into v_roles from jsonb_array_elements_text(p_config -> 'roles');
    if not (v_roles <@ array['owner','admin','factory_manager','production_manager','dispatch_manager','sales_manager','quality','accounts']) then return 'Only supervisors, quality or accounts can sign off'; end if;
  elsif p_kind not in ('inspection_pass','handoff_accepted') then
    return 'Choose a supported criterion';
  end if;
  return null;
end;
$$;
revoke all on function private.criterion_config_problem(text, jsonb) from public, anon, authenticated;

-- Evaluates every active criterion of a task row (the row being saved, so a re-link in the same
-- update is seen).
create or replace function private.task_criteria_evaluate(t public.tasks)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  c record; v_items jsonb := '[]'::jsonb; v_met boolean; v_reason text; v_state text; v_eval jsonb; v_ev record; v_evidence jsonb;
  v_total integer := 0; v_unmet integer := 0; v_expected text; v_acc text; v_last_obs timestamptz;
begin
  for c in select * from public.task_completion_criteria where task_id = t.id and removed_at is null order by seq, id loop
    v_total := v_total + 1; v_met := false; v_reason := null; v_state := null; v_evidence := null;
    v_expected := case c.kind when 'inspection_pass' then 'quality_inspection' when 'source_state' then c.config ->> 'source_type' end;
    if c.kind in ('source_state','inspection_pass') then
      if c.source_id is null then
        v_reason := 'This task is not linked to the record this criterion checks';
      elsif (t.related_entity_type, t.related_entity_id) is distinct from (c.source_type, c.source_id) then
        v_reason := 'The task now refers to a different record than the one this criterion checks';
      elsif c.source_type is distinct from v_expected then
        v_reason := format('This criterion checks a linked %s, but the task links a different kind of record (%s)', replace(v_expected, '_', ' '), replace(coalesce(c.source_type, 'record'), '_', ' '));
      else
        v_state := private.task_source_state(t.company_id, c.source_type, c.source_id);
        if v_state is null then v_reason := format('The linked %s is missing or outside this company', replace(c.source_type, '_', ' '));
        elsif c.kind = 'source_state' then
          v_met := v_state = any(array(select jsonb_array_elements_text(c.config -> 'states')));
          if not v_met then v_reason := format('The %s is %s; it must be %s', replace(c.source_type, '_', ' '), replace(v_state, '_', ' '),
            (select string_agg(replace(s, '_', ' '), ' or ') from jsonb_array_elements_text(c.config -> 'states') s)); end if;
        elsif v_state = 'rejected' then v_reason := 'The inspection was rejected';
        else
          v_eval := private.inspection_plan_evaluation(c.source_id);
          if v_eval ->> 'state' = 'pass' then v_met := true;
          elsif v_eval ->> 'state' = 'fail' then v_reason := format('%s inspection result(s) are outside limits', v_eval ->> 'failed');
          elsif v_eval ->> 'state' = 'incomplete' then v_reason := format('%s of %s inspection results are missing', v_eval ->> 'missing', v_eval ->> 'total');
          else
            v_met := v_state = 'approved';
            if not v_met then v_reason := 'No inspection plan applies, and the inspection is not approved yet'; end if;
          end if;
        end if;
      end if;
    elsif c.kind = 'handoff_accepted' then
      if t.handoff_key is null then v_reason := 'This task is not a department handoff';
      else
        select state into v_acc from public.handoff_acceptances where task_id = t.id;
        v_met := v_acc = 'accepted'; v_state := v_acc;
        if not coalesce(v_met, false) then v_met := false; v_reason := case v_acc when 'returned' then 'The handoff was returned for a missing prerequisite'
          when 'pending' then 'The receiving team has not accepted the handoff' else 'The handoff has no acceptance record' end; end if;
      end if;
    else
      select e.* into v_ev from public.task_criterion_evidence e where e.criterion_id = c.id and e.superseded_at is null;
      if v_ev.id is not null then v_evidence := jsonb_build_object('value', v_ev.value, 'note', v_ev.note, 'recorded_by_name', v_ev.recorded_by_name, 'recorded_at', v_ev.recorded_at); end if;
      if c.kind = 'observation' then
        if v_ev.id is null then v_reason := format('Record %s (%s)', c.label, c.config ->> 'unit');
        elsif (nullif(c.config ->> 'min', '') is not null and v_ev.value < (c.config ->> 'min')::numeric) or (nullif(c.config ->> 'max', '') is not null and v_ev.value > (c.config ->> 'max')::numeric) then
          v_reason := format('%s %s is outside %s to %s', c.label, trim_scale(v_ev.value) || ' ' || (c.config ->> 'unit'), coalesce(c.config ->> 'min', 'any'), coalesce(c.config ->> 'max', 'any'));
        else v_met := true; end if;
      else
        select max(e.recorded_at) into v_last_obs from public.task_criterion_evidence e where e.task_id = t.id and e.kind = 'observation';
        if v_ev.id is null then v_reason := format('Needs sign-off by %s', (select string_agg(replace(r, '_', ' '), ' or ') from jsonb_array_elements_text(c.config -> 'roles') r));
        elsif v_last_obs > v_ev.recorded_at then v_reason := 'Results changed after the sign-off; sign off again';
        else v_met := true; end if;
      end if;
    end if;
    if not v_met then v_unmet := v_unmet + 1; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('id', c.id, 'seq', c.seq, 'kind', c.kind, 'label', c.label, 'config', c.config,
      'source_type', c.source_type, 'source_id', c.source_id, 'met', v_met, 'reason', v_reason, 'state', v_state, 'evidence', v_evidence, 'from_template', c.template_id is not null));
  end loop;
  return jsonb_build_object('task_id', t.id, 'status', t.status, 'total', v_total, 'unmet', v_unmet,
    'state', case when v_total = 0 then 'none' when v_unmet = 0 then 'met' else 'unmet' end, 'criteria', v_items);
end;
$$;
revoke all on function private.task_criteria_evaluate(public.tasks) from public, anon, authenticated;

-- The first two unmet reasons and a count of the rest, kept short enough for every task screen to
-- show it as written (the task page lists all of them).
create or replace function private.task_criteria_refusal(p_eval jsonb)
returns text language sql immutable set search_path = public, private as $$
  select left('This task cannot be completed yet: ' || string_agg(reason, '; ' order by n) filter (where n <= 2)
    || case when count(*) > 2 then format(' (and %s more)', count(*) - 2) else '' end, 240)
  from (select x ->> 'reason' reason, row_number() over (order by (x ->> 'seq')::integer, x ->> 'id') n
        from jsonb_array_elements(p_eval -> 'criteria') x where not (x ->> 'met')::boolean) unmet
$$;
revoke all on function private.task_criteria_refusal(jsonb) from public, anon, authenticated;

-- Completion is refused by any path while a criterion is unmet.
create or replace function private.guard_task_completion_criteria()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v jsonb;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    v := private.task_criteria_evaluate(new);
    if (v ->> 'unmet')::integer > 0 then raise exception '%', private.task_criteria_refusal(v) using errcode = '23514'; end if;
    if (v ->> 'total')::integer > 0 then
      insert into public.task_completion_checks(company_id, task_id, event, evaluation, actor_id) values (new.company_id, new.id, 'completed', v, auth.uid());
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_task_completion_criteria() from public, anon, authenticated;
drop trigger if exists zz_guard_task_completion_criteria on public.tasks;
create trigger zz_guard_task_completion_criteria before update of status on public.tasks for each row execute function private.guard_task_completion_criteria();

-- New internal tasks receive the active templates for their kind, bound to the record they link to.
-- Dealer tasks never do: dealers cannot see criteria, so they could not satisfy them.
create or replace function private.attach_completion_templates()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v jsonb;
begin
  if new.dealership_id is not null then return null; end if;
  insert into public.task_completion_criteria(id, company_id, task_id, seq, kind, label, config, source_type, source_id, template_id, created_by)
  select gen_random_uuid(), new.company_id, new.id, row_number() over (order by tp.seq, tp.id), tp.kind, tp.label, tp.config,
    new.related_entity_type, new.related_entity_id, tp.id, auth.uid()
  from public.completion_criteria_templates tp
  where tp.company_id = new.company_id and tp.is_active
    and (tp.task_kind = 'type:' || new.task_type or (new.handoff_team is not null and tp.task_kind = 'handoff:' || new.handoff_team));
  if found and new.status = 'completed' then
    v := private.task_criteria_evaluate(new);
    if (v ->> 'unmet')::integer > 0 then raise exception '%', private.task_criteria_refusal(v) using errcode = '23514'; end if;
  end if;
  return null;
end;
$$;
revoke all on function private.attach_completion_templates() from public, anon, authenticated;
drop trigger if exists zz_attach_completion_templates on public.tasks;
create trigger zz_attach_completion_templates after insert on public.tasks for each row execute function private.attach_completion_templates();

create or replace function public.task_criteria_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text; v_manager boolean; v_supervisor boolean;
  t public.tasks%rowtype; c public.task_completion_criteria%rowtype; tp public.completion_criteria_templates%rowtype; v_old public.completion_criteria_templates%rowtype;
  v_text text; v_problem text; v_value numeric; v_eval jsonb; v_page integer; v_total bigint; v_rows jsonb;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid completion criteria request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  v_manager := v_role in ('owner','admin','factory_manager');
  v_supervisor := v_manager or v_role in ('production_manager','dispatch_manager','sales_manager');
  if v_name is null
     or p_command not in ('task.evaluate','evidence.observe','evidence.sign_off','criteria.add','criteria.remove','templates.list','templates.save','review.list','task.reopen')
     or (p_command in ('criteria.add','criteria.remove','review.list','task.reopen') and not v_supervisor)
     or (p_command = 'templates.save' and not v_manager)
     or (p_command = 'templates.list' and not v_supervisor) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'templates.list' then
    return coalesce((select jsonb_agg(to_jsonb(x) - 'company_id' order by x.task_kind, x.seq, x.id) from public.completion_criteria_templates x where x.company_id = v_company), '[]'::jsonb);

  elsif p_command = 'templates.save' then
    begin
      tp.id := (p_payload ->> 'id')::uuid; tp.seq := coalesce((p_payload ->> 'seq')::integer, 1); tp.is_active := coalesce((p_payload ->> 'is_active')::boolean, true);
    exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid completion criteria request'; end;
    tp.task_kind := p_payload ->> 'task_kind'; tp.kind := p_payload ->> 'kind'; tp.label := btrim(coalesce(p_payload ->> 'label', '')); tp.config := coalesce(p_payload -> 'config', '{}'::jsonb);
    if tp.id is null or tp.task_kind is null or tp.task_kind !~ '^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$' then raise exception 'Choose the kind of task the criterion applies to'; end if;
    if length(tp.label) not between 3 and 120 then raise exception 'Describe the criterion (3 to 120 characters)'; end if;
    v_problem := private.criterion_config_problem(tp.kind, tp.config);
    if v_problem is not null then raise exception '%', v_problem; end if;
    select * into v_old from public.completion_criteria_templates where id = tp.id for update;
    if found then
      if v_old.company_id <> v_company then raise exception 'Criterion template is unavailable'; end if;
      if nullif(p_payload ->> 'expected_updated_at', '') is null or v_old.updated_at <> (p_payload ->> 'expected_updated_at')::timestamptz then
        raise exception 'This template was changed by someone else. Reload it before saving';
      end if;
    end if;
    if tp.is_active and (select count(*) from public.completion_criteria_templates where company_id = v_company and task_kind = tp.task_kind and is_active and id <> tp.id) >= 10 then
      raise exception 'A task kind can have at most 10 active criteria';
    end if;
    insert into public.completion_criteria_templates(id, company_id, task_kind, seq, kind, label, config, is_active, updated_by)
    values (tp.id, v_company, tp.task_kind, tp.seq, tp.kind, tp.label, tp.config, tp.is_active, v_actor)
    on conflict (id) do update set task_kind = excluded.task_kind, seq = excluded.seq, kind = excluded.kind, label = excluded.label, config = excluded.config,
      is_active = excluded.is_active, updated_by = v_actor, updated_at = clock_timestamp()
    returning * into tp;
    return jsonb_build_object('id', tp.id, 'updated_at', tp.updated_at);

  elsif p_command = 'review.list' then
    -- Completed tasks (most recent 500) whose criteria no longer hold.
    begin v_page := coalesce((p_payload ->> 'page')::integer, 1); exception when invalid_text_representation then v_page := 0; end;
    if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
    with candidates as (
      select t2.*, private.task_criteria_evaluate(t2) e from public.tasks t2
      where t2.id in (select t3.id from public.tasks t3 where t3.company_id = v_company and t3.status = 'completed' and t3.dealership_id is null
          and exists (select 1 from public.task_completion_criteria k where k.task_id = t3.id and k.removed_at is null)
        order by t3.completed_at desc nulls last, t3.id limit 500)
    ), broken as (select * from candidates where (e ->> 'unmet')::integer > 0)
    select (select count(*) from broken),
      coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'completed_at', b.completed_at, 'assigned_to', b.assigned_to,
          'assignee_name', (select full_name from public.app_users where id = b.assigned_to), 'evaluation', b.e) order by b.completed_at desc nulls last, b.id)
        from (select * from broken order by completed_at desc nulls last, id limit 10 offset (v_page - 1) * 10) b), '[]'::jsonb)
    into v_total, v_rows;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total);
  end if;

  -- Task-scoped commands.
  begin
    select t2.* into t from public.tasks t2 where t2.id = (p_payload ->> 'task_id')::uuid and t2.company_id = v_company and t2.dealership_id is null
    for update;
  exception when invalid_text_representation then raise exception 'Task is unavailable'; end;
  if t.id is null then raise exception 'Task is unavailable'; end if;

  if p_command = 'task.evaluate' then
    return private.task_criteria_evaluate(t);

  elsif p_command = 'task.reopen' then
    v_text := btrim(coalesce(p_payload ->> 'reason', ''));
    if t.status <> 'completed' then raise exception 'Only a completed task can be reopened'; end if;
    if length(v_text) not between 3 and 300 then raise exception 'Record why the task is reopened (3 to 300 characters)'; end if;
    v_eval := private.task_criteria_evaluate(t);
    update public.tasks set status = 'open', completed_at = null, updated_at = now() where id = t.id;
    insert into public.task_completion_checks(company_id, task_id, event, evaluation, reason, actor_id) values (v_company, t.id, 'reopened', v_eval, v_text, v_actor);
    if t.assigned_to is not null then
      insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
      values (v_company, t.assigned_to, 'task_reopened', 'warning', left('Reopened: ' || t.title, 200), concat(v_name, ': ', v_text), 'task', t.id, v_actor, '/tasks/' || t.id);
    end if;
    return jsonb_build_object('id', t.id, 'status', 'open');

  elsif p_command = 'criteria.add' then
    if t.status not in ('open','in_progress') then raise exception 'Criteria can be changed only while the task is open'; end if;
    c.kind := p_payload ->> 'kind'; c.label := btrim(coalesce(p_payload ->> 'label', '')); c.config := coalesce(p_payload -> 'config', '{}'::jsonb);
    begin c.id := (p_payload ->> 'id')::uuid; exception when invalid_text_representation then raise exception 'Invalid completion criteria request'; end;
    if c.id is null then raise exception 'Invalid completion criteria request'; end if;
    if length(c.label) not between 3 and 120 then raise exception 'Describe the criterion (3 to 120 characters)'; end if;
    v_problem := private.criterion_config_problem(c.kind, c.config);
    if v_problem is not null then raise exception '%', v_problem; end if;
    if c.kind in ('source_state','inspection_pass') and t.related_entity_id is null then raise exception 'This task is not linked to a record, so it cannot check one'; end if;
    if exists (select 1 from public.task_completion_criteria where id = c.id) then
      if exists (select 1 from public.task_completion_criteria where id = c.id and task_id = t.id) then return jsonb_build_object('id', c.id, 'replayed', true); end if;
      raise exception 'Invalid completion criteria request';
    end if;
    if (select count(*) from public.task_completion_criteria where task_id = t.id and removed_at is null) >= 10 then raise exception 'A task can have at most 10 criteria'; end if;
    insert into public.task_completion_criteria(id, company_id, task_id, seq, kind, label, config, source_type, source_id, created_by)
    values (c.id, v_company, t.id, coalesce((select max(seq) from public.task_completion_criteria where task_id = t.id), 0) + 1, c.kind, c.label, c.config,
      t.related_entity_type, t.related_entity_id, v_actor);
    return jsonb_build_object('id', c.id, 'replayed', false);
  end if;

  -- Criterion-scoped commands.
  select * into c from public.task_completion_criteria where id = nullif(p_payload ->> 'criterion_id', '')::uuid and task_id = t.id and removed_at is null for update;
  if not found then raise exception 'Criterion is unavailable'; end if;

  if p_command = 'criteria.remove' then
    v_text := btrim(coalesce(p_payload ->> 'reason', ''));
    if t.status not in ('open','in_progress') then raise exception 'Criteria can be changed only while the task is open'; end if;
    if length(v_text) not between 3 and 300 then raise exception 'Record why the criterion is removed (3 to 300 characters)'; end if;
    update public.task_completion_criteria set removed_at = now(), removed_by = v_actor, remove_reason = v_text where id = c.id;
    return jsonb_build_object('id', c.id);
  end if;

  if t.status not in ('open','in_progress') then raise exception 'Evidence can be recorded only while the task is open'; end if;
  if p_command = 'evidence.observe' then
    if c.kind <> 'observation' then raise exception 'This criterion does not take an observation'; end if;
    if not (coalesce(t.assigned_to = v_actor, false) or v_supervisor) then raise exception 'Only the assignee or a supervisor can record results' using errcode = '42501'; end if;
    begin v_value := (p_payload ->> 'value')::numeric; exception when invalid_text_representation then v_value := null; end;
    if v_value is null or abs(v_value) >= 1e10 then raise exception 'Enter the observed value as a number'; end if;
    update public.task_criterion_evidence set superseded_at = clock_timestamp() where criterion_id = c.id and superseded_at is null;
    insert into public.task_criterion_evidence(company_id, task_id, criterion_id, kind, value, note, recorded_by, recorded_by_name)
    values (v_company, t.id, c.id, 'observation', v_value, nullif(left(btrim(coalesce(p_payload ->> 'note', '')), 300), ''), v_actor, v_name);
  elsif p_command = 'evidence.sign_off' then
    if c.kind <> 'sign_off' then raise exception 'This criterion does not take a sign-off'; end if;
    if not (v_role = any(array(select jsonb_array_elements_text(c.config -> 'roles')))) then raise exception 'Your role cannot sign off this criterion' using errcode = '42501'; end if;
    if coalesce(t.assigned_to = v_actor, false) then raise exception 'The assignee cannot sign off their own work' using errcode = '42501'; end if;
    update public.task_criterion_evidence set superseded_at = clock_timestamp() where criterion_id = c.id and superseded_at is null;
    insert into public.task_criterion_evidence(company_id, task_id, criterion_id, kind, note, recorded_by, recorded_by_name)
    values (v_company, t.id, c.id, 'sign_off', nullif(left(btrim(coalesce(p_payload ->> 'note', '')), 300), ''), v_actor, v_name);
  end if;
  return private.task_criteria_evaluate(t);
end;
$$;
revoke all on function public.task_criteria_command(text, jsonb) from public, anon;
grant execute on function public.task_criteria_command(text, jsonb) to authenticated;

commit;
