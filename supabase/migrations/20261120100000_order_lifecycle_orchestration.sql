-- Order lifecycle orchestration, batch 1 (ORDER-TO-DELIVERY directive, stages 4, 5, 7, 9 and sections 31-35, 40).
--
-- What this adds on top of the existing ERP (which already holds quotations, follow-ups, PO intake, credit holds,
-- billet requirements and allocation, die trials, sample gates, production readiness and holds, QC, ageing,
-- packaging, dispatch, delivery dispositions and closures):
--   * Production queue: each scheduled job's rank on its press is derived from released/scheduled press slots
--     (never typed in). Every observed rank change is appended to production_queue_rank_events.
--   * Threshold work: a job at rank <= 5 (configurable) gets one billet allocation task; at rank <= 3 one die
--     preparation task and a die preparation record. Tasks carry a unique workflow key per (kind, job, cycle), so
--     re-running the queue never duplicates them. A task closes only when the records verify the work (billets
--     allocated, die prepared); reading or acknowledging a task never completes it.
--   * Early material risk: every open billet requirement is checked against compatible unreserved billets, after the
--     demand of orders ahead of it in allocation priority. A forecast shortfall inside the horizon opens one shortage
--     task for procurement and the foundry, linked to the same order.
--   * Die preparation and preheating: check -> prepare -> preheat scheduled -> preheating -> ready -> issued -> returned,
--     each step with who/when and evidence. Preheat completion is validated against an approved, company-defined
--     preheat standard (no temperatures are assumed). Starting a job can be refused unless the die is prepared and,
--     separately, preheated within the standard's hold time; both are company settings that default off.
--   * Readiness gates: one function lists every mandatory gate (commercial, specification, billets, die, custom die
--     trial, sample, schedule, hold, die preparation, preheat, start checks) with its owning department, separating
--     planning readiness from physical start readiness. "Ready for production" is announced once per transition.
--   * Escalation: unacknowledged tasks go to the department supervisor after the acknowledgement SLA, overdue tasks to
--     the factory manager, and long-overdue tasks to the owner. Recipients come from configurable department roles.
--   * Order lifecycle: separate domain statuses, a quantity ledger kept per physical state (never summed across
--     states), the next action and owning department, the blocker, and an append-only timeline drawn from the
--     authoritative records. Payment amounts are returned only to owner, admin and accounts.
-- Engine failures inside triggers never block the business change that fired them; they are logged to
-- olo_engine_errors and the hourly job repeats the evaluation. Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ---------------------------------------------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_departments() returns text[] language sql immutable set search_path = public, private as $$
  select array['sales','finance','production_planning','production','factory_management','foundry','billet_inventory','procurement',
    'tool_room','quality','ageing','value_addition','packaging','dispatch','administration','management']
$$;
create or replace function private.olo_internal_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner','admin','sales_manager','sales','production_manager','production','dispatch_manager','dispatch','accounts','quality','viewer','factory_manager','inventory_manager']
$$;
-- Staff who may read orchestration data (dealers never).
create or replace function private.olo_reader_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner','admin','sales_manager','sales','production_manager','production','dispatch_manager','dispatch','accounts','quality','viewer','factory_manager','inventory_manager']
$$;
-- Staff who may see payment amounts and balances.
create or replace function private.olo_finance_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner','admin','accounts']
$$;
create or replace function private.olo_manager_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner','admin','factory_manager','production_manager']
$$;
create or replace function private.olo_die_writer_roles() returns text[] language sql immutable set search_path = public, private as $$
  select array['owner','admin','factory_manager','production_manager','production']
$$;
revoke all on function private.olo_departments(), private.olo_internal_roles(), private.olo_reader_roles(), private.olo_finance_roles(),
  private.olo_manager_roles(), private.olo_die_writer_roles() from public, anon, authenticated;
-- Row policies and check constraints evaluate these lists as the signed-in user.
grant execute on function private.olo_departments(), private.olo_internal_roles(), private.olo_reader_roles(), private.olo_manager_roles() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Settings and department routing
-- ---------------------------------------------------------------------------------------------------------------
create table public.olo_settings (
  company_id uuid primary key references public.companies(id),
  billet_rank_threshold smallint not null default 5 check (billet_rank_threshold between 1 and 50),
  die_rank_threshold smallint not null default 3 check (die_rank_threshold between 1 and 50),
  material_risk_horizon_days smallint not null default 21 check (material_risk_horizon_days between 1 and 120),
  ack_sla_hours smallint not null default 4 check (ack_sla_hours between 1 and 168),
  action_sla_hours smallint not null default 24 check (action_sla_hours between 1 and 720),
  enforce_die_preparation boolean not null default false,
  enforce_preheat boolean not null default false,
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default now(),
  check (not enforce_preheat or enforce_die_preparation)
);
create index olo_settings_updated_by_idx on public.olo_settings(updated_by);

create or replace function private.olo_settings_for(p_company uuid) returns public.olo_settings
language plpgsql stable security definer set search_path = public, private as $$
declare s public.olo_settings;
begin
  select * into s from public.olo_settings where company_id = p_company;
  if not found then
    s.company_id := p_company; s.billet_rank_threshold := 5; s.die_rank_threshold := 3; s.material_risk_horizon_days := 21;
    s.ack_sla_hours := 4; s.action_sla_hours := 24; s.enforce_die_preparation := false; s.enforce_preheat := false;
  end if;
  return s;
end;
$$;

create table public.olo_department_roles (
  company_id uuid not null references public.companies(id),
  department text not null check (department = any(private.olo_departments())),
  stage smallint not null check (stage between 0 and 3),
  roles text[] not null check (cardinality(roles) between 1 and 8 and roles <@ private.olo_internal_roles()),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default now(),
  primary key (company_id, department, stage)
);
create index olo_department_roles_updated_by_idx on public.olo_department_roles(updated_by);

-- Stage 0 receives the work, 1 is the department supervisor, 2 the factory manager, 3 management.
create or replace function private.olo_default_roles(p_department text, p_stage integer) returns text[]
language sql immutable set search_path = public, private as $$
  select case
    when p_stage = 0 then case p_department
      when 'sales' then array['sales_manager','sales'] when 'finance' then array['accounts']
      when 'production_planning' then array['production_manager'] when 'production' then array['production_manager','production']
      when 'factory_management' then array['factory_manager'] when 'foundry' then array['production_manager','production']
      when 'billet_inventory' then array['inventory_manager','production_manager'] when 'procurement' then array['inventory_manager','production_manager']
      when 'tool_room' then array['production_manager','production'] when 'quality' then array['quality']
      when 'ageing' then array['production'] when 'value_addition' then array['production']
      when 'packaging' then array['dispatch_manager','production'] when 'dispatch' then array['dispatch_manager','dispatch']
      when 'administration' then array['admin'] when 'management' then array['owner'] else array['factory_manager'] end
    when p_stage = 1 then case p_department
      when 'sales' then array['sales_manager'] when 'finance' then array['admin'] when 'dispatch' then array['dispatch_manager']
      when 'packaging' then array['dispatch_manager'] when 'quality' then array['factory_manager'] when 'administration' then array['owner']
      when 'management' then array['owner'] else array['production_manager'] end
    when p_stage = 2 then array['factory_manager']
    else array['owner'] end
$$;

create or replace function private.olo_roles(p_company uuid, p_department text, p_stage integer) returns text[]
language sql stable security definer set search_path = public, private as $$
  select coalesce((select r.roles from public.olo_department_roles r where r.company_id = p_company and r.department = p_department and r.stage = p_stage),
    private.olo_default_roles(p_department, p_stage))
$$;

-- The active employee of the given roles with the fewest open tasks (ties by name), or null.
create or replace function private.olo_pick_assignee(p_company uuid, p_roles text[]) returns uuid
language sql stable security definer set search_path = public, private as $$
  select u.id from public.app_users u
  where u.company_id = p_company and u.is_active and u.dealer_id is null and u.role = any(p_roles)
    and coalesce(u.status, 'active') = 'active'
  order by (select count(*) from public.tasks t where t.company_id = p_company and t.assigned_to = u.id and t.status in ('open','in_progress')),
    u.full_name, u.id
  limit 1
$$;
revoke all on function private.olo_settings_for(uuid), private.olo_default_roles(text, integer), private.olo_roles(uuid, text, integer),
  private.olo_pick_assignee(uuid, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Append-only records
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_append_only() returns trigger language plpgsql set search_path = public, private as $$
begin
  raise exception '% is an append-only history; record a correcting event instead', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function private.olo_append_only() from public, anon, authenticated;

create table public.olo_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  event_type text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  order_id uuid,
  production_job_id uuid,
  department text check (department is null or department = any(private.olo_departments())),
  summary text not null check (length(summary) between 3 and 500),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  actor_id uuid,
  dedupe_key text,
  occurred_at timestamptz not null default clock_timestamp()
);
create unique index olo_events_dedupe_key on public.olo_events(company_id, dedupe_key) where dedupe_key is not null;
create index olo_events_order_idx on public.olo_events(company_id, order_id, occurred_at desc);
create index olo_events_job_idx on public.olo_events(company_id, production_job_id, occurred_at desc);
create trigger olo_events_append_only before update or delete on public.olo_events for each row execute function private.olo_append_only();

create table public.olo_engine_errors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  source text not null check (length(source) between 1 and 80),
  message text not null check (length(message) between 1 and 500),
  occurred_at timestamptz not null default clock_timestamp()
);
create index olo_engine_errors_company_idx on public.olo_engine_errors(company_id, occurred_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- Production queue
-- ---------------------------------------------------------------------------------------------------------------
create table public.production_queue_positions (
  production_job_id uuid primary key references public.production_jobs(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  machine_id uuid not null references public.machines(id) on delete cascade,
  slot_id uuid not null,
  queue_rank integer not null check (queue_rank >= 1),
  planned_start_at timestamptz not null,
  planning_ready boolean not null default false,
  entered_at timestamptz not null default clock_timestamp(),
  observed_at timestamptz not null default clock_timestamp()
);
create index production_queue_positions_rank_idx on public.production_queue_positions(company_id, machine_id, queue_rank);
create index production_queue_positions_machine_idx on public.production_queue_positions(machine_id);

create table public.production_queue_rank_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  production_job_id uuid not null,
  order_id uuid,
  machine_id uuid,
  previous_machine_id uuid,
  previous_rank integer,
  new_rank integer,
  source text not null check (source in ('slot_change','job_change','settings_change','scheduled_check','manual_check')),
  actor_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  check (previous_rank is distinct from new_rank or previous_machine_id is distinct from machine_id)
);
create index production_queue_rank_events_job_idx on public.production_queue_rank_events(company_id, production_job_id, occurred_at desc);
create index production_queue_rank_events_order_idx on public.production_queue_rank_events(company_id, order_id, occurred_at desc);
create trigger production_queue_rank_events_append_only before update or delete on public.production_queue_rank_events for each row execute function private.olo_append_only();

-- Rank 1 is the next job to run on a press. A job's place comes from its earliest scheduled or released slot; running,
-- completed and cancelled jobs are not queued. Ties keep the planner's sequence and then the slot identity.
create or replace function private.olo_queue_ranks(p_company uuid)
returns table(production_job_id uuid, machine_id uuid, queue_rank integer, slot_id uuid, planned_start_at timestamptz)
language sql stable security definer set search_path = public, private as $$
  with s as (
    select s.id as slot_id, s.production_job_id, s.machine_id, s.planned_start_at, s.sequence_number,
      row_number() over (partition by s.production_job_id order by s.planned_start_at, s.sequence_number, s.id) as nth
    from public.production_plan_slots s
    join public.production_jobs j on j.id = s.production_job_id and j.company_id = s.company_id
    where s.company_id = p_company and s.status in ('scheduled','released') and j.status in ('planned','ready','on_hold')
  )
  select s.production_job_id, s.machine_id,
    (row_number() over (partition by s.machine_id order by s.planned_start_at, s.sequence_number, s.slot_id))::integer,
    s.slot_id, s.planned_start_at
  from s where s.nth = 1
$$;
revoke all on function private.olo_queue_ranks(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Workflow tasks: existing tasks table, with a workflow key and verification-only completion
-- ---------------------------------------------------------------------------------------------------------------
alter table public.tasks
  add column if not exists workflow_key text,
  add column if not exists workflow_kind text,
  add column if not exists workflow_department text,
  add column if not exists workflow_order_id uuid references public.orders(id),
  add column if not exists workflow_job_id uuid references public.production_jobs(id),
  add column if not exists workflow_source_id uuid,
  add column if not exists workflow_cycle smallint,
  add column if not exists workflow_due_at timestamptz,
  add column if not exists workflow_escalation_level smallint not null default 0,
  add column if not exists workflow_escalated_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid references public.app_users(id),
  add column if not exists completion_evidence jsonb;
alter table public.tasks drop constraint if exists tasks_workflow_shape_check;
alter table public.tasks add constraint tasks_workflow_shape_check check (
  (workflow_key is null and workflow_kind is null and workflow_department is null and workflow_cycle is null and workflow_due_at is null)
  or (workflow_key is not null and workflow_kind in ('billet_allocation','die_preparation','billet_shortage')
      and workflow_department = any(private.olo_departments()) and workflow_cycle >= 1 and workflow_due_at is not null
      and workflow_escalation_level between 0 and 3));
create unique index if not exists tasks_workflow_key_unique on public.tasks(company_id, workflow_key) where workflow_key is not null;
create index if not exists tasks_workflow_open_idx on public.tasks(company_id, workflow_kind, status) where workflow_key is not null;
create index if not exists tasks_workflow_order_idx on public.tasks(workflow_order_id) where workflow_order_id is not null;
create index if not exists tasks_workflow_job_idx on public.tasks(workflow_job_id) where workflow_job_id is not null;
create index if not exists tasks_acknowledged_by_idx on public.tasks(acknowledged_by) where acknowledged_by is not null;

create table public.olo_task_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  task_id uuid not null,
  action text not null check (action in ('created','acknowledged','started','escalated','verified_complete','superseded','reassigned')),
  actor_id uuid,
  note text check (note is null or length(note) <= 500),
  facts jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);
create index olo_task_events_task_idx on public.olo_task_events(company_id, task_id, occurred_at);
create trigger olo_task_events_append_only before update or delete on public.olo_task_events for each row execute function private.olo_append_only();

create or replace function private.olo_system(p_on boolean) returns void language sql set search_path = public, private as $$
  select set_config('olo.system', case when p_on then 'on' else 'off' end, true)
$$;
revoke all on function private.olo_system(boolean) from public, anon, authenticated;

-- A workflow task is created and closed by the engine only. People acknowledge, start and reassign it; it completes
-- when the records verify the work, and it is withdrawn when the work is no longer needed.
create or replace function private.olo_guard_workflow_task() returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_system boolean := coalesce(current_setting('olo.system', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.workflow_key is not null and not v_system then
      raise exception 'Workflow tasks are created by the order lifecycle engine' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.workflow_key is null and new.workflow_key is null then return new; end if;
  if (new.workflow_key, new.workflow_kind, new.workflow_department, new.workflow_order_id, new.workflow_job_id, new.workflow_source_id, new.workflow_cycle)
     is distinct from (old.workflow_key, old.workflow_kind, old.workflow_department, old.workflow_order_id, old.workflow_job_id, old.workflow_source_id, old.workflow_cycle) then
    raise exception 'The workflow identity of a task cannot be changed' using errcode = '42501';
  end if;
  if not v_system and new.status is distinct from old.status and new.status in ('completed','cancelled') then
    raise exception '%', case old.workflow_kind
      when 'billet_allocation' then 'This task closes when the billets are allocated in the billet records. Allocate them, and the task completes itself.'
      when 'die_preparation' then 'This task closes when the die preparation is recorded as prepared. Record the die check and preparation, and the task completes itself.'
      else 'This task closes when the billet shortfall is covered by allocated or available compatible billets.' end
      using errcode = '23514';
  end if;
  if not v_system and (new.workflow_escalation_level, new.workflow_escalated_at, new.workflow_due_at, new.completion_evidence, new.resolved_by_system_at)
     is distinct from (old.workflow_escalation_level, old.workflow_escalated_at, old.workflow_due_at, old.completion_evidence, old.resolved_by_system_at) then
    raise exception 'Escalation, due time and completion evidence of a workflow task are kept by the engine' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.olo_guard_workflow_task() from public, anon, authenticated;
create trigger b_guard_olo_workflow_task before insert or update on public.tasks for each row execute function private.olo_guard_workflow_task();

-- ---------------------------------------------------------------------------------------------------------------
-- Die preparation and preheating
-- ---------------------------------------------------------------------------------------------------------------
create table public.die_preheat_standards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(btrim(name)) between 3 and 120),
  die_type text check (die_type is null or die_type in ('solid','hollow','semi_hollow','porthole','bridge','feeder','multi_cavity','flat','special')),
  min_temperature_c numeric(6,1) not null,
  max_temperature_c numeric(6,1) not null,
  min_soak_minutes integer not null check (min_soak_minutes between 1 and 1440),
  max_hold_minutes integer not null check (max_hold_minutes between 1 and 2880),
  sop_reference text not null check (length(btrim(sop_reference)) between 2 and 120),
  is_active boolean not null default true,
  approved_by uuid not null references public.app_users(id),
  approved_at timestamptz not null default now(),
  retired_by uuid references public.app_users(id),
  retired_at timestamptz,
  check (min_temperature_c > 0 and max_temperature_c > min_temperature_c and max_temperature_c <= 800),
  check (is_active = (retired_at is null))
);
create unique index die_preheat_standards_active_key on public.die_preheat_standards(company_id, coalesce(die_type, '*')) where is_active;
create index die_preheat_standards_approved_by_idx on public.die_preheat_standards(approved_by);
create index die_preheat_standards_retired_by_idx on public.die_preheat_standards(retired_by);

create table public.die_preparations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  production_job_id uuid not null references public.production_jobs(id),
  order_id uuid references public.orders(id),
  die_id uuid not null references public.dies(id),
  machine_id uuid references public.machines(id),
  cycle smallint not null default 1 check (cycle >= 1),
  status text not null default 'required' check (status in ('required','checked','blocked','under_preparation','prepared','preheat_scheduled',
    'preheating','ready','issued','returned','cancelled')),
  check_results jsonb check (check_results is null or jsonb_typeof(check_results) = 'object'),
  check_note text check (check_note is null or length(check_note) <= 500),
  checked_by uuid references public.app_users(id), checked_at timestamptz,
  preparation_note text check (preparation_note is null or length(preparation_note) between 5 and 500),
  prepared_by uuid references public.app_users(id), prepared_at timestamptz,
  preheat_standard_id uuid references public.die_preheat_standards(id),
  preheat_scheduled_for timestamptz, preheat_scheduled_by uuid references public.app_users(id),
  oven_reference text check (oven_reference is null or length(btrim(oven_reference)) between 1 and 60),
  preheat_started_at timestamptz, preheat_started_by uuid references public.app_users(id),
  preheat_completed_at timestamptz, preheat_completed_by uuid references public.app_users(id),
  preheat_temperature_c numeric(6,1), preheat_soak_minutes integer check (preheat_soak_minutes is null or preheat_soak_minutes between 1 and 1440),
  issued_at timestamptz, issued_by uuid references public.app_users(id),
  returned_at timestamptz, returned_by uuid references public.app_users(id),
  return_condition text check (return_condition is null or length(btrim(return_condition)) between 5 and 300),
  cancelled_at timestamptz, cancelled_by uuid references public.app_users(id),
  cancel_reason text check (cancel_reason is null or length(btrim(cancel_reason)) between 5 and 300),
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  -- Every state carries the evidence of the steps it depends on.
  check (status in ('required','blocked','cancelled') or checked_at is not null),
  check (status not in ('prepared','preheat_scheduled','preheating','ready','issued','returned') or prepared_at is not null),
  check (status not in ('preheat_scheduled','preheating') or (preheat_scheduled_for is not null and preheat_standard_id is not null)),
  check (status <> 'preheating' or preheat_started_at is not null),
  check (status <> 'ready' or (preheat_completed_at is not null and preheat_temperature_c is not null and preheat_soak_minutes is not null)),
  check (status not in ('issued','returned') or issued_at is not null),
  check (status <> 'returned' or (returned_at is not null and return_condition is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null and cancel_reason is not null))
);
create unique index die_preparations_live_key on public.die_preparations(production_job_id) where status not in ('returned','cancelled');
create index die_preparations_company_idx on public.die_preparations(company_id, status, created_at desc);
create index die_preparations_die_idx on public.die_preparations(die_id);
create index die_preparations_order_idx on public.die_preparations(order_id);
create index die_preparations_machine_idx on public.die_preparations(machine_id);
create index die_preparations_standard_idx on public.die_preparations(preheat_standard_id);
create index die_preparations_people_idx on public.die_preparations(checked_by, prepared_by, preheat_scheduled_by);
create index die_preparations_people2_idx on public.die_preparations(preheat_started_by, preheat_completed_by, issued_by);
create index die_preparations_people3_idx on public.die_preparations(returned_by, cancelled_by, created_by);

create table public.die_preparation_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  preparation_id uuid not null references public.die_preparations(id),
  action text not null check (action in ('opened','checked','blocked','preparation_started','prepared','preheat_scheduled','preheat_started',
    'preheat_completed','issued','returned','cancelled')),
  from_status text,
  to_status text not null,
  actor_id uuid,
  actor_name text,
  note text check (note is null or length(note) <= 500),
  facts jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);
create index die_preparation_events_prep_idx on public.die_preparation_events(company_id, preparation_id, occurred_at);
create trigger die_preparation_events_append_only before update or delete on public.die_preparation_events for each row execute function private.olo_append_only();

create or replace function private.olo_prep_live(p_company uuid, p_job uuid) returns public.die_preparations
language sql stable security definer set search_path = public, private as $$
  select * from public.die_preparations p where p.company_id = p_company and p.production_job_id = p_job and p.status not in ('returned','cancelled')
  order by p.created_at desc limit 1
$$;
create or replace function private.olo_prep_is_prepared(p public.die_preparations, p_die uuid) returns boolean
language sql immutable set search_path = public, private as $$
  select p.id is not null and p.die_id is not distinct from p_die and p.status in ('prepared','preheat_scheduled','preheating','ready','issued')
$$;
-- A ready (preheated) die is usable until the approved hold time since preheat completion passes.
create or replace function private.olo_prep_hold_expired(p public.die_preparations) returns boolean
language sql stable security definer set search_path = public, private as $$
  select p.status = 'ready' and exists (select 1 from public.die_preheat_standards s where s.id = p.preheat_standard_id
    and clock_timestamp() > p.preheat_completed_at + make_interval(mins => s.max_hold_minutes))
$$;
revoke all on function private.olo_prep_live(uuid, uuid), private.olo_prep_is_prepared(public.die_preparations, uuid),
  private.olo_prep_hold_expired(public.die_preparations) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Billet position of a job and early material risk of a requirement
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_billet_state(p_company uuid, p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare j public.production_jobs%rowtype; v_rows integer; v_not_required integer; v_req integer; v_alloc integer; v_linked integer;
  v_alloy text; v_temper text; v_dia numeric; v_bw numeric;
begin
  select * into j from public.production_jobs where id = p_job and company_id = p_company;
  if not found then return jsonb_build_object('state', 'unknown', 'required', 0, 'allocated', 0, 'short', 0); end if;
  select count(*), count(*) filter (where r.status = 'not_required'),
    coalesce(sum(r.billets_required) filter (where r.status <> 'not_required'), 0),
    coalesce(sum(least(r.billets_allocated, r.billets_required)) filter (where r.status <> 'not_required'), 0),
    max(r.alloy), max(r.temper), max(r.billet_diameter_inch), max(r.billet_weight_kg)
    into v_rows, v_not_required, v_req, v_alloc, v_alloy, v_temper, v_dia, v_bw
  from public.order_billet_requirements r
  where r.company_id = p_company and r.order_id = j.order_id and r.profile_id = j.profile_id and r.status <> 'cancelled';
  select count(*) into v_linked from public.foundry_billets b
  where b.company_id = p_company and b.production_job_id = j.id and b.order_id = j.order_id and b.status in ('allocated','issued','consumed');
  if v_rows = 0 then
    if coalesce(j.required_billet_count, 0) > 0 then
      return jsonb_build_object('state', case when v_linked >= j.required_billet_count then 'allocated' when v_linked > 0 then 'partial' else 'none' end,
        'required', j.required_billet_count, 'allocated', least(v_linked, j.required_billet_count), 'short', greatest(j.required_billet_count - v_linked, 0), 'basis', 'job');
    end if;
    return jsonb_build_object('state', 'not_calculated', 'required', 0, 'allocated', v_linked, 'short', 0, 'basis', 'none');
  end if;
  if v_rows = v_not_required then return jsonb_build_object('state', 'not_required', 'required', 0, 'allocated', 0, 'short', 0, 'basis', 'order_requirement'); end if;
  return jsonb_build_object('state', case when v_alloc >= v_req then 'allocated' when v_alloc > 0 then 'partial' else 'none' end,
    'required', v_req, 'allocated', v_alloc, 'short', greatest(v_req - v_alloc, 0), 'alloy', v_alloy, 'temper', v_temper,
    'diameter_inch', v_dia, 'billet_weight_kg', v_bw, 'basis', 'order_requirement');
end;
$$;

-- Unmet need of a requirement against compatible, unreserved cast billets after the unmet need of every requirement of
-- the same specification that the priority allocator serves first. Planned casts are reported, not counted.
create or replace function private.olo_requirement_risk(p_company uuid, p_requirement uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r public.order_billet_requirements%rowtype; o public.orders%rowtype; v_needed integer; v_in_house integer; v_outsourced integer; v_planned integer;
  v_ahead integer; v_available integer; v_short integer;
begin
  select * into r from public.order_billet_requirements where id = p_requirement and company_id = p_company;
  if not found then return jsonb_build_object('short', 0, 'needed', 0, 'state', 'unknown'); end if;
  select * into o from public.orders where id = r.order_id and company_id = p_company;
  v_needed := greatest(r.billets_required - r.billets_allocated, 0);
  if r.status in ('cancelled','not_required','complete') or v_needed = 0 or o.current_stage in ('closed','cancelled','delivered','payment_pending') then
    return jsonb_build_object('short', 0, 'needed', v_needed, 'state', 'covered');
  end if;
  select count(*) filter (where b.status = 'cast' and b.source_type = 'in_house'), count(*) filter (where b.status = 'cast' and b.source_type = 'outsourced'),
    count(*) filter (where b.status = 'planned')
    into v_in_house, v_outsourced, v_planned
  from public.foundry_billets b
  where b.company_id = p_company and b.status in ('cast','planned') and b.order_id is null and b.allocation_requirement_id is null and b.production_job_id is null
    and lower(btrim(coalesce(b.alloy,''))) = lower(btrim(coalesce(r.alloy,''))) and lower(btrim(coalesce(b.temper,''))) = lower(btrim(coalesce(r.temper,'')))
    and b.billet_diameter_inch = r.billet_diameter_inch;
  select coalesce(sum(greatest(x.billets_required - x.billets_allocated, 0)), 0) into v_ahead
  from public.order_billet_requirements x join public.orders xo on xo.id = x.order_id and xo.company_id = x.company_id
  where x.company_id = p_company and x.id <> r.id and x.status in ('pending','partial','shortage')
    and xo.current_stage not in ('closed','cancelled','delivered','payment_pending') and xo.deleted_at is null
    and lower(btrim(coalesce(x.alloy,''))) = lower(btrim(coalesce(r.alloy,''))) and lower(btrim(coalesce(x.temper,''))) = lower(btrim(coalesce(r.temper,'')))
    and x.billet_diameter_inch = r.billet_diameter_inch
    and (case xo.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
         coalesce(xo.expected_dispatch_date, 'infinity'::date), xo.order_date, xo.created_at, xo.id, x.created_at, x.id)
      < (case o.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end,
         coalesce(o.expected_dispatch_date, 'infinity'::date), o.order_date, o.created_at, o.id, r.created_at, r.id);
  v_available := greatest(v_in_house + v_outsourced - v_ahead, 0);
  v_short := greatest(v_needed - v_available, 0);
  return jsonb_build_object('state', case when v_short = 0 then 'stock_available' else 'short' end, 'needed', v_needed, 'short', v_short,
    'short_kg', round(v_short * coalesce(r.billet_weight_kg, 0), 3), 'in_house_available', v_in_house, 'outsourced_available', v_outsourced,
    'planned_casts', v_planned, 'demand_ahead', v_ahead, 'alloy', r.alloy, 'temper', r.temper, 'diameter_inch', r.billet_diameter_inch,
    'billet_weight_kg', r.billet_weight_kg, 'order_id', r.order_id, 'profile_id', r.profile_id);
end;
$$;
revoke all on function private.olo_billet_state(uuid, uuid), private.olo_requirement_risk(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Readiness gates
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_gate(p_code text, p_label text, p_department text, p_phase text, p_state text, p_required boolean,
  p_enforced boolean, p_message text) returns jsonb
language sql immutable set search_path = public, private as $$
  select jsonb_build_object('code', p_code, 'label', p_label, 'department', p_department, 'phase', p_phase, 'state', p_state,
    'required', p_required, 'enforced', p_enforced, 'message', p_message)
$$;

-- Every mandatory gate of a job with its owning department. planning_ready: scheduled and resourced; start_ready: the
-- immediate pre-start checks also pass. Gates marked enforced are refused by the database at start.
create or replace function private.olo_job_gates(p_company uuid, p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare j public.production_jobs%rowtype; o public.orders%rowtype; d public.dies%rowtype; pr public.aluminium_profiles%rowtype;
  s public.olo_settings; p public.die_preparations; v_plan jsonb; v_start jsonb; v_codes text[]; v_start_codes text[]; v_msg text;
  v_gates jsonb := '[]'::jsonb; v_hold text; v_bst jsonb; v_trial text; v_sample text; v_sr record; v_ss jsonb; v_g jsonb;
  v_plan_ready boolean := true; v_start_ready boolean := true; v_blocker jsonb;
begin
  select * into j from public.production_jobs where id = p_job and company_id = p_company;
  if not found then raise exception 'Production job is unavailable for this company' using errcode = '23514'; end if;
  select * into o from public.orders where id = j.order_id and company_id = p_company;
  select * into pr from public.aluminium_profiles where id = j.profile_id and company_id = p_company;
  if j.die_id is not null then select * into d from public.dies where id = j.die_id and company_id = p_company; end if;
  s := private.olo_settings_for(p_company);
  p := private.olo_prep_live(p_company, j.id);
  v_plan := private.production_readiness_issues(p_company, j.id, 'ready', false);
  v_start := private.production_readiness_issues(p_company, j.id, 'in_progress', false);
  select coalesce(array_agg(e ->> 'code'), '{}') into v_codes from jsonb_array_elements(v_plan) e;
  select coalesce(array_agg(e ->> 'code'), '{}') into v_start_codes from jsonb_array_elements(v_start) e;

  -- 1. Commercial clearance (finance). Amounts are never part of a gate.
  if o.id is null or o.current_stage in ('closed','cancelled','delivered','payment_pending') or o.deleted_at is not null then
    v_gates := v_gates || private.olo_gate('commercial', 'Commercial clearance', 'finance', 'planning', 'failed', true, true,
      'The order is closed, cancelled, delivered or awaiting payment.');
  elsif exists (select 1 from public.order_credit_holds h where h.company_id = p_company and h.order_id = o.id and h.status in ('held','rejected')) then
    v_gates := v_gates || private.olo_gate('commercial', 'Commercial clearance', 'finance', 'planning', 'failed', true, false,
      'Finance has a credit hold open on this order.');
  else
    v_gates := v_gates || private.olo_gate('commercial', 'Commercial clearance', 'finance', 'planning', 'passed', true, true, 'Cleared by finance.');
  end if;

  -- 2. Specification: approved drawing and defined alloy/temper.
  if (nullif(btrim(coalesce(pr.alloy, '')), '') is null and coalesce(j.alloy_id, pr.alloy_id) is null)
     or (nullif(btrim(coalesce(pr.temper, '')), '') is null and coalesce(j.temper_id, pr.temper_id) is null) then
    v_gates := v_gates || private.olo_gate('specification', 'Specification', 'sales', 'planning', 'failed', true, false, 'Alloy or temper is not defined for this profile.');
  elsif 'drawing_not_approved' = any(v_codes) or j.drawing_approval_status in ('Pending','Rejected') then
    v_gates := v_gates || private.olo_gate('specification', 'Specification', 'sales', 'planning', 'failed', true, false,
      coalesce((select e ->> 'message' from jsonb_array_elements(v_plan) e where e ->> 'code' = 'drawing_not_approved'), format('The order line drawing is %s.', lower(j.drawing_approval_status))));
  else
    v_gates := v_gates || private.olo_gate('specification', 'Specification', 'sales', 'planning', 'passed', true, false, 'Drawing approved; alloy and temper defined.');
  end if;

  -- 3. Billets allocated for the run.
  v_bst := private.olo_billet_state(p_company, j.id);
  if 'billet_ineligible' = any(v_codes) then
    v_gates := v_gates || private.olo_gate('billets', 'Billet allocation', 'billet_inventory', 'planning', 'failed', true, true,
      (select string_agg(e ->> 'message', ' ') from jsonb_array_elements(v_plan) e where e ->> 'code' = 'billet_ineligible'));
  elsif v_bst ->> 'state' in ('allocated','not_required') then
    v_gates := v_gates || private.olo_gate('billets', 'Billet allocation', 'billet_inventory', 'planning', 'passed', true, false,
      case when v_bst ->> 'state' = 'not_required' then 'No billet allocation is required.' else format('%s of %s billets allocated.', v_bst ->> 'allocated', v_bst ->> 'required') end);
  elsif v_bst ->> 'state' = 'not_calculated' then
    v_gates := v_gates || private.olo_gate('billets', 'Billet allocation', 'production_planning', 'planning', 'failed', true, false,
      'The billet requirement for this order line is not calculated. Set the profile billet diameter so the requirement can be built.');
  else
    v_gates := v_gates || private.olo_gate('billets', 'Billet allocation', 'billet_inventory', 'planning', 'failed', true, false,
      format('%s of %s billets allocated; %s short.', v_bst ->> 'allocated', v_bst ->> 'required', v_bst ->> 'short'));
  end if;

  -- 4. Die assigned, approved for the profile and not in development; 5. custom die trial.
  if j.die_id is null then
    v_gates := v_gates || private.olo_gate('die', 'Die available', 'tool_room', 'planning', 'failed', true, true, 'Assign an approved die for this profile.');
  elsif d.die_status in ('design','ordered','received','under_trial','trial','under_correction','correction') then
    select t.trial_result into v_trial from public.die_trials t where t.company_id = p_company and t.die_id = d.id order by t.trial_date desc, t.created_at desc limit 1;
    v_gates := v_gates || private.olo_gate('die', 'Die available', 'tool_room', 'planning', 'failed', true, true, format('Die %s is %s.', d.die_number, replace(d.die_status, '_', ' ')));
    v_gates := v_gates || private.olo_gate('die_trial', 'Custom die trial approved', 'tool_room', 'planning', 'failed', true, true,
      case when v_trial = 'fail' then format('The latest trial of die %s failed. Correct the die and record a passing trial.', d.die_number)
           when v_trial is null then format('No trial is recorded for die %s. Run and record a trial before normal production.', d.die_number)
           else format('The latest trial of die %s is %s; the die is not yet released for production.', d.die_number, v_trial) end);
  elsif 'die_ineligible' = any(v_codes) then
    v_gates := v_gates || private.olo_gate('die', 'Die available', 'tool_room', 'planning', 'failed', true, true,
      (select e ->> 'message' from jsonb_array_elements(v_plan) e where e ->> 'code' = 'die_ineligible'));
  else
    v_gates := v_gates || private.olo_gate('die', 'Die available', 'tool_room', 'planning', 'passed', true, true, format('Die %s is %s.', d.die_number, d.die_status));
  end if;

  -- 6. Customer sample approval where the order line is gated.
  v_sample := null;
  for v_sr in select * from public.sample_requirements sr where sr.company_id = p_company and sr.order_id = j.order_id and sr.profile_id = j.profile_id and sr.gates_production loop
    v_ss := private.sample_state(p_company, v_sr.id);
    continue when v_ss ->> 'state' in ('approved','conditional','withdrawn') or coalesce(v_ss -> 'sample_jobs', '[]'::jsonb) @> to_jsonb(j.id);
    v_sample := format('Customer sample approval is %s.', replace(v_ss ->> 'state', '_', ' '));
  end loop;
  if exists (select 1 from public.sample_requirements sr where sr.company_id = p_company and sr.order_id = j.order_id and sr.profile_id = j.profile_id and sr.gates_production) then
    v_gates := v_gates || private.olo_gate('sample', 'Customer sample approval', 'quality', 'planning', case when v_sample is null then 'passed' else 'failed' end, true, true,
      coalesce(v_sample, 'Sample approved for production.'));
  end if;

  -- 7. Press and released slot.
  if 'machine_missing' = any(v_codes) or 'machine_ineligible' = any(v_codes) or 'slot_missing' = any(v_codes) then
    v_gates := v_gates || private.olo_gate('schedule', 'Press and schedule', 'production_planning', 'planning', 'failed', true, true,
      (select string_agg(e ->> 'message', ' ') from jsonb_array_elements(v_plan) e where e ->> 'code' in ('machine_missing','machine_ineligible','slot_missing')));
  else
    v_gates := v_gates || private.olo_gate('schedule', 'Press and schedule', 'production_planning', 'planning', 'passed', true, true, 'Press assigned and slot released.');
  end if;

  -- 8. Recorded production hold.
  if 'active_hold' = any(v_codes) then
    v_gates := v_gates || private.olo_gate('hold', 'Production hold', 'production', 'planning', 'failed', true, true,
      (select e ->> 'message' from jsonb_array_elements(v_plan) e where e ->> 'code' = 'active_hold'));
  end if;

  -- 9. Die preparation (tool room) and 10. preheat, each required only when the company enforces it.
  if j.die_id is not null then
    if private.olo_prep_is_prepared(p, j.die_id) then
      v_gates := v_gates || private.olo_gate('die_preparation', 'Die prepared', 'tool_room', 'planning', 'passed', s.enforce_die_preparation, s.enforce_die_preparation,
        format('Die %s is %s.', d.die_number, replace(p.status, '_', ' ')));
    else
      v_gates := v_gates || private.olo_gate('die_preparation', 'Die prepared', 'tool_room', 'planning', 'failed', s.enforce_die_preparation, s.enforce_die_preparation,
        case when p.id is null then format('No die preparation is recorded for die %s.', d.die_number)
             when p.die_id is distinct from j.die_id then 'The recorded preparation is for a different die than the job now uses.'
             else format('Die preparation is %s.', replace(p.status, '_', ' ')) end
        || case when s.enforce_die_preparation then '' else ' (Not enforced: the company has not switched on die preparation control.)' end);
    end if;
    if p.id is not null and p.status in ('ready','issued') and p.die_id = j.die_id and not private.olo_prep_hold_expired(p) then
      v_gates := v_gates || private.olo_gate('die_preheat', 'Die preheated', 'tool_room', 'start', 'passed', s.enforce_preheat, s.enforce_preheat,
        case when p.status = 'issued' then 'Die issued to the press.' else format('Preheated to %s °C for %s minutes.', trim_scale(p.preheat_temperature_c), p.preheat_soak_minutes) end);
    else
      v_gates := v_gates || private.olo_gate('die_preheat', 'Die preheated', 'tool_room', 'start', case when s.enforce_preheat then 'failed' else 'pending' end, s.enforce_preheat, s.enforce_preheat,
        case when p.id is not null and private.olo_prep_hold_expired(p) then 'The die has been held hot longer than the approved hold time. Reheat or re-check it.'
             when p.status in ('preheat_scheduled','preheating') then format('Preheat is %s.', replace(p.status, '_', ' '))
             else 'Preheat is not recorded yet; schedule it against the run window under the approved standard.' end
        || case when s.enforce_preheat then '' else ' (Not enforced: the company has not switched on preheat control.)' end);
    end if;
  end if;

  -- 11. Immediate start checks.
  select string_agg(e ->> 'message', ' ') into v_msg from jsonb_array_elements(v_start) e where e ->> 'code' in ('status_not_startable','die_busy','billets_not_issued');
  v_gates := v_gates || private.olo_gate('start_checks', 'Start checks', 'production', 'start', case when v_msg is null then 'passed' else 'failed' end, true, true,
    coalesce(v_msg, 'The job is ready, its die is free and billets are issued.'));

  for v_g in select e from jsonb_array_elements(v_gates) e loop
    if (v_g ->> 'required')::boolean and v_g ->> 'state' not in ('passed','not_applicable') then
      if v_g ->> 'phase' = 'planning' then v_plan_ready := false; end if;
      v_start_ready := false;
      if v_blocker is null or (v_blocker ->> 'phase' = 'start' and v_g ->> 'phase' = 'planning') then v_blocker := v_g; end if;
    end if;
  end loop;
  return jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'job_status', j.status, 'planning_ready', v_plan_ready,
    'start_ready', v_plan_ready and v_start_ready, 'blocker', v_blocker, 'gates', v_gates);
end;
$$;
revoke all on function private.olo_gate(text, text, text, text, text, boolean, boolean, text), private.olo_job_gates(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Task creation, verification and escalation
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_uniq(p text[]) returns text[] language sql immutable set search_path = public, private as $$
  select coalesce(array_agg(distinct x order by x), '{}') from unnest(p) x where x is not null
$$;

create or replace function private.olo_create_task(p_company uuid, p_kind text, p_department text, p_cycle integer, p_order uuid, p_job uuid,
  p_source uuid, p_title text, p_body text, p_priority text, p_link text, p_notify_extra text[]) returns integer
language plpgsql security definer set search_path = public, private as $$
declare v_key text := p_kind || ':' || coalesce(p_job, p_source)::text || ':' || p_cycle; v_id uuid := gen_random_uuid();
  v_roles text[] := private.olo_roles(p_company, p_department, 0); v_user uuid; s public.olo_settings := private.olo_settings_for(p_company); v_due timestamptz;
begin
  v_due := clock_timestamp() + make_interval(hours => s.action_sla_hours);
  v_user := private.olo_pick_assignee(p_company, v_roles);
  perform private.olo_system(true);
  insert into public.tasks(id, company_id, task_type, title, description, priority, status, assigned_to, due_date, related_entity_type, related_entity_id,
    workflow_key, workflow_kind, workflow_department, workflow_order_id, workflow_job_id, workflow_source_id, workflow_cycle, workflow_due_at)
  values (v_id, p_company, 'olo_' || p_kind, left(p_title, 200), left(p_body, 2000), p_priority, 'open', v_user, (v_due at time zone 'Asia/Kolkata')::date,
    case when p_job is not null then 'production_job' else 'order' end, coalesce(p_job, p_order), v_key, p_kind, p_department, p_order, p_job, p_source, p_cycle, v_due)
  on conflict (company_id, workflow_key) where workflow_key is not null do nothing;
  if not found then perform private.olo_system(false); return 0; end if;
  insert into public.olo_task_events(company_id, task_id, action, facts)
    values (p_company, v_id, 'created', jsonb_build_object('assigned_to', v_user, 'department', p_department, 'cycle', p_cycle, 'roles', to_jsonb(v_roles)));
  perform private.ap3_notify_roles(p_company, private.olo_uniq(v_roles || coalesce(p_notify_extra, '{}')), 'olo_' || p_kind,
    case p_priority when 'urgent' then 'critical' else 'warning' end, p_title, p_body, 'task', v_id, p_link, v_key, null);
  perform private.olo_system(false);
  return 1;
end;
$$;

create or replace function private.olo_event(p_company uuid, p_type text, p_order uuid, p_job uuid, p_department text, p_summary text, p_facts jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  insert into public.olo_events(company_id, event_type, order_id, production_job_id, department, summary, facts, actor_id, dedupe_key)
  values (p_company, p_type, p_order, p_job, p_department, left(p_summary, 500), coalesce(p_facts, '{}'::jsonb),
    (select u.id from public.app_users u where u.id = auth.uid()), p_dedupe)
  on conflict (company_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

create or replace function private.olo_fmt_kg(p numeric) returns text language sql immutable set search_path = public, private as $$
  select coalesce(to_char(round(p, 0), 'FM99,99,99,990') || ' kg', 'not recorded')
$$;

-- Rank-5 billet allocation work. Nothing is created when the billets are already allocated or no allocation applies;
-- an open task is kept; a completed or withdrawn task whose billets are no longer allocated starts a new cycle.
create or replace function private.olo_ensure_billet_task(p_company uuid, p_job uuid, p_rank integer, p_machine uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare j public.production_jobs%rowtype; t public.tasks%rowtype; st jsonb; v_order text; v_press text; v_profile text; v_shortage text; v_body text;
begin
  select * into j from public.production_jobs where id = p_job and company_id = p_company;
  if not found then return 0; end if;
  select * into t from public.tasks x where x.company_id = p_company and x.workflow_kind = 'billet_allocation' and x.workflow_job_id = p_job
    order by x.workflow_cycle desc limit 1;
  if t.id is not null and t.status in ('open','in_progress') then return 0; end if;
  st := private.olo_billet_state(p_company, p_job);
  if st ->> 'state' in ('allocated','not_required','unknown') then return 0; end if;
  select order_number into v_order from public.orders where id = j.order_id;
  select machine_name into v_press from public.machines where id = p_machine;
  select profile_code into v_profile from public.aluminium_profiles where id = j.profile_id;
  select x.title into v_shortage from public.tasks x where x.company_id = p_company and x.workflow_kind = 'billet_shortage' and x.workflow_order_id = j.order_id
    and x.status in ('open','in_progress') limit 1;
  v_body := format('Order %s (job %s, profile %s) is now within the top %s positions on press %s (rank %s). Alloy %s %s, billet diameter %s in. Required finished output %s. Billets: %s required, %s allocated, %s short. Review available billet stock and reserve suitable material; in-house cast billets are offered first.%s',
    coalesce(v_order, '-'), coalesce(j.job_number, '-'), coalesce(v_profile, '-'), (private.olo_settings_for(p_company)).billet_rank_threshold, coalesce(v_press, '-'), p_rank,
    coalesce(st ->> 'alloy', '-'), coalesce(st ->> 'temper', ''), coalesce(trim_scale((st ->> 'diameter_inch')::numeric)::text, '-'), private.olo_fmt_kg(j.planned_quantity_kg),
    st ->> 'required', st ->> 'allocated', st ->> 'short',
    case when v_shortage is not null then ' A shortage task is already open for this order: ' || v_shortage || '.' else '' end);
  perform private.olo_event(p_company, 'billet.allocation_required', j.order_id, j.id, 'billet_inventory',
    format('Billet allocation requested for job %s at rank %s', coalesce(j.job_number, '-'), p_rank), st, 'billet_allocation:' || j.id || ':' || (coalesce(t.workflow_cycle, 0) + 1));
  return private.olo_create_task(p_company, 'billet_allocation', 'billet_inventory', coalesce(t.workflow_cycle, 0) + 1, j.order_id, j.id, null,
    format('Billet allocation required: %s', coalesce(v_order, j.job_number)), v_body, case when p_rank <= 2 then 'urgent' else 'high' end,
    '/production/order-book', private.olo_roles(p_company, 'foundry', 0) || private.olo_roles(p_company, 'production_planning', 0));
end;
$$;

-- Rank-3 die preparation work and its die preparation record. Preheating is not started here; it is scheduled
-- against the run window under the approved standard.
create or replace function private.olo_ensure_die_task(p_company uuid, p_job uuid, p_rank integer, p_machine uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare j public.production_jobs%rowtype; t public.tasks%rowtype; p public.die_preparations; v_order text; v_press text; v_die text; v_prep uuid; v_cycle integer; v_start timestamptz;
begin
  select * into j from public.production_jobs where id = p_job and company_id = p_company;
  if not found then return 0; end if;
  select * into t from public.tasks x where x.company_id = p_company and x.workflow_kind = 'die_preparation' and x.workflow_job_id = p_job
    order by x.workflow_cycle desc limit 1;
  if t.id is not null and t.status in ('open','in_progress') then return 0; end if;
  p := private.olo_prep_live(p_company, p_job);
  if private.olo_prep_is_prepared(p, j.die_id) then return 0; end if;
  select order_number into v_order from public.orders where id = j.order_id;
  select machine_name into v_press from public.machines where id = p_machine;
  select die_number into v_die from public.dies where id = j.die_id;
  select planned_start_at into v_start from public.production_queue_positions where production_job_id = j.id;
  if j.die_id is not null and p.id is null then
    select coalesce(max(cycle), 0) + 1 into v_cycle from public.die_preparations where company_id = p_company and production_job_id = j.id;
    insert into public.die_preparations(company_id, production_job_id, order_id, die_id, machine_id, cycle, status)
      values (p_company, j.id, j.order_id, j.die_id, p_machine, v_cycle, 'required') returning id into v_prep;
    insert into public.die_preparation_events(company_id, preparation_id, action, to_status, note, facts)
      values (p_company, v_prep, 'opened', 'required', format('Opened when job %s reached rank %s on %s', coalesce(j.job_number, '-'), p_rank, coalesce(v_press, 'the press')), jsonb_build_object('rank', p_rank));
  else
    v_prep := p.id;
  end if;
  perform private.olo_event(p_company, 'die.preparation_required', j.order_id, j.id, 'tool_room',
    format('Die preparation requested for job %s at rank %s', coalesce(j.job_number, '-'), p_rank), jsonb_build_object('die', v_die, 'rank', p_rank),
    'die_preparation:' || j.id || ':' || (coalesce(t.workflow_cycle, 0) + 1));
  return private.olo_create_task(p_company, 'die_preparation', 'tool_room', coalesce(t.workflow_cycle, 0) + 1, j.order_id, j.id, v_prep,
    format('Die preparation required: %s', coalesce(v_die, 'assign a die for ' || coalesce(v_order, j.job_number))),
    format('Order %s (job %s) is now within the top %s positions on press %s (rank %s). %s Inspect, prepare and confirm readiness for the planned run%s. Do not start preheating now: schedule it against the run window under the approved preheat standard.',
      coalesce(v_order, '-'), coalesce(j.job_number, '-'), (private.olo_settings_for(p_company)).die_rank_threshold, coalesce(v_press, '-'), p_rank,
      case when v_die is null then 'No die is assigned to this job yet; assign an approved die first.' else format('Required die: %s.', v_die) end,
      case when v_start is null then '' else ' starting ' || to_char(v_start at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') end),
    case when p_rank = 1 then 'urgent' else 'high' end, '/dies/preparation' || case when v_prep is null then '' else '/' || v_prep end,
    private.olo_roles(p_company, 'production_planning', 0));
end;
$$;

-- Early material risk (mechanism A): one shortage task per requirement and cycle while compatible stock cannot cover it.
create or replace function private.olo_evaluate_material_risk(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare r record; k jsonb; t public.tasks%rowtype; v_n integer := 0; s public.olo_settings := private.olo_settings_for(p_company); v_body text;
begin
  for r in select x.id, x.order_id, o.order_number, o.expected_dispatch_date, pr.profile_code from public.order_billet_requirements x
      join public.orders o on o.id = x.order_id and o.company_id = x.company_id
      left join public.aluminium_profiles pr on pr.id = x.profile_id
    where x.company_id = p_company and x.status in ('pending','partial','shortage') and x.billets_required > x.billets_allocated
      and o.deleted_at is null and o.current_stage not in ('closed','cancelled','delivered','payment_pending')
      and (o.expected_dispatch_date is null or o.expected_dispatch_date <= private.ist_today() + s.material_risk_horizon_days
           or exists (select 1 from public.production_queue_positions q join public.production_jobs j on j.id = q.production_job_id
                      where q.company_id = p_company and j.order_id = x.order_id))
  loop
    select * into t from public.tasks x where x.company_id = p_company and x.workflow_kind = 'billet_shortage' and x.workflow_source_id = r.id
      order by x.workflow_cycle desc limit 1;
    continue when t.id is not null and t.status in ('open','in_progress');
    k := private.olo_requirement_risk(p_company, r.id);
    continue when coalesce((k ->> 'short')::integer, 0) = 0;
    v_body := format('Order %s, profile %s: %s billets (%s, alloy %s %s, %s in) are still needed and compatible stock cannot cover %s of them after orders ahead in priority. Available: %s in-house cast, %s external; %s casts planned. Options: cast additional billets in-house, procure externally, or an approved combination. Production needs them before the run reaches the top of the queue.',
      r.order_number, coalesce(r.profile_code, '-'), k ->> 'needed', private.olo_fmt_kg((k ->> 'short_kg')::numeric), coalesce(k ->> 'alloy', '-'), coalesce(k ->> 'temper', ''),
      coalesce(trim_scale((k ->> 'diameter_inch')::numeric)::text, '-'), k ->> 'short', k ->> 'in_house_available', k ->> 'outsourced_available', k ->> 'planned_casts');
    perform private.olo_event(p_company, 'billet.shortage_detected', r.order_id, null, 'procurement',
      format('Billet shortage forecast for order %s: %s billets', r.order_number, k ->> 'short'), k, 'billet_shortage:' || r.id || ':' || (coalesce(t.workflow_cycle, 0) + 1));
    v_n := v_n + private.olo_create_task(p_company, 'billet_shortage', 'procurement', coalesce(t.workflow_cycle, 0) + 1, r.order_id, null, r.id,
      format('Billet procurement / casting required: %s', r.order_number), v_body,
      case when r.expected_dispatch_date is not null and r.expected_dispatch_date <= private.ist_today() + 3 then 'urgent' else 'high' end,
      '/production/material-plan', private.olo_roles(p_company, 'foundry', 0) || private.olo_roles(p_company, 'production_planning', 0));
  end loop;
  return v_n;
end;
$$;

create or replace function private.olo_close_task(t public.tasks, p_complete boolean, p_note text, p_evidence jsonb) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.olo_system(true);
  update public.tasks set status = case when p_complete then 'completed' else 'cancelled' end, completed_at = coalesce(completed_at, clock_timestamp()),
    resolved_by_system_at = clock_timestamp(), system_resolution = left(p_note, 300), completion_evidence = p_evidence
  where id = t.id and status in ('open','in_progress');
  insert into public.olo_task_events(company_id, task_id, action, note, facts)
    values (t.company_id, t.id, case when p_complete then 'verified_complete' else 'superseded' end, left(p_note, 500), coalesce(p_evidence, '{}'::jsonb));
  update public.notifications set resolved_at = clock_timestamp(), resolution = left(p_note, 300), is_read = true, read_at = coalesce(read_at, now())
    where company_id = t.company_id and resolved_at is null and (condition_key = t.workflow_key or condition_key like 'olo-esc:' || t.id || ':%');
  perform private.olo_system(false);
end;
$$;

-- Closes open workflow tasks whose work the records now verify; withdraws those no longer needed.
create or replace function private.olo_verify_tasks(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare t public.tasks%rowtype; v_job public.production_jobs%rowtype; st jsonb; p public.die_preparations; k jsonb; v_n integer := 0; v_req text;
begin
  for t in select * from public.tasks x where x.company_id = p_company and x.workflow_key is not null and x.status in ('open','in_progress')
      order by x.created_at for update skip locked loop
    v_job := null;
    if t.workflow_job_id is not null then select * into v_job from public.production_jobs where id = t.workflow_job_id; end if;
    if t.workflow_kind in ('billet_allocation','die_preparation') and (v_job.id is null or v_job.status = 'cancelled') then
      perform private.olo_close_task(t, false, 'Withdrawn: the production job was cancelled', jsonb_build_object('job_status', v_job.status)); v_n := v_n + 1;
    elsif t.workflow_kind = 'billet_allocation' then
      st := private.olo_billet_state(p_company, v_job.id);
      if st ->> 'state' in ('allocated','not_required') then
        perform private.olo_close_task(t, true, format('Verified: %s of %s billets allocated', st ->> 'allocated', st ->> 'required'), st || jsonb_build_object('verified_at', clock_timestamp())); v_n := v_n + 1;
      elsif v_job.status in ('in_progress','completed') then
        perform private.olo_close_task(t, false, 'Withdrawn: production started; billet issue is checked by the start guard', st); v_n := v_n + 1;
      end if;
    elsif t.workflow_kind = 'die_preparation' then
      p := private.olo_prep_live(p_company, v_job.id);
      if private.olo_prep_is_prepared(p, v_job.die_id) then
        perform private.olo_close_task(t, true, format('Verified: die preparation is %s', replace(p.status, '_', ' ')),
          jsonb_build_object('preparation_id', p.id, 'status', p.status, 'prepared_at', p.prepared_at, 'prepared_by', p.prepared_by)); v_n := v_n + 1;
      elsif v_job.status in ('in_progress','completed') then
        perform private.olo_close_task(t, false, 'Withdrawn: production started before die preparation was recorded', jsonb_build_object('job_status', v_job.status)); v_n := v_n + 1;
      end if;
    elsif t.workflow_kind = 'billet_shortage' then
      select status into v_req from public.order_billet_requirements where id = t.workflow_source_id;
      k := private.olo_requirement_risk(p_company, t.workflow_source_id);
      if v_req is null or v_req = 'cancelled' then
        perform private.olo_close_task(t, false, 'Withdrawn: the billet requirement no longer applies', k); v_n := v_n + 1;
      elsif coalesce((k ->> 'short')::integer, 0) = 0 then
        perform private.olo_close_task(t, true, case when k ->> 'state' = 'covered' then 'Verified: required billets allocated' else 'Verified: compatible billet stock now covers the requirement' end,
          k || jsonb_build_object('verified_at', clock_timestamp())); v_n := v_n + 1;
        perform private.olo_event(p_company, 'billet.shortage_resolved', t.workflow_order_id, null, 'procurement', 'Billet shortage resolved', k, 'shortage_resolved:' || t.id);
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Ready-for-production announcements, once per transition, for queued jobs inside the billet threshold.
create or replace function private.olo_refresh_readiness(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare q record; g jsonb; v_ready boolean; v_n integer := 0; s public.olo_settings := private.olo_settings_for(p_company); v_body text; v_summary text;
begin
  for q in select p.*, j.job_number, j.order_id, j.planned_quantity_kg, o.order_number, m.machine_name, pr.profile_code, pr.alloy, pr.temper, d.die_number,
      (select sl.planned_end_at from public.production_plan_slots sl where sl.id = p.slot_id) as planned_end_at
    from public.production_queue_positions p join public.production_jobs j on j.id = p.production_job_id
    left join public.orders o on o.id = j.order_id left join public.machines m on m.id = p.machine_id
    left join public.aluminium_profiles pr on pr.id = j.profile_id left join public.dies d on d.id = j.die_id
    where p.company_id = p_company and (p.queue_rank <= s.billet_rank_threshold or p.planning_ready) loop
    g := private.olo_job_gates(p_company, q.production_job_id);
    v_ready := (g ->> 'planning_ready')::boolean;
    continue when v_ready = q.planning_ready;
    update public.production_queue_positions set planning_ready = v_ready where production_job_id = q.production_job_id;
    v_n := v_n + 1;
    if v_ready then
      select string_agg(format('%s: %s', e ->> 'label', case e ->> 'state' when 'passed' then 'passed' else e ->> 'state' end), '; ') into v_summary
        from jsonb_array_elements(g -> 'gates') e where (e ->> 'required')::boolean;
      v_body := format('Order %s, job %s is ready for production. Rank %s on %s. Profile %s, alloy %s %s, %s. Billets: %s. Die %s. Run window %s%s. Gates: %s.',
        coalesce(q.order_number, '-'), coalesce(q.job_number, '-'), q.queue_rank, coalesce(q.machine_name, '-'), coalesce(q.profile_code, '-'),
        coalesce(q.alloy, '-'), coalesce(q.temper, ''), private.olo_fmt_kg(q.planned_quantity_kg),
        (select x ->> 'message' from jsonb_array_elements(g -> 'gates') x where x ->> 'code' = 'billets'), coalesce(q.die_number, '-'),
        to_char(q.planned_start_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'),
        case when q.planned_end_at is null then '' else ' to ' || to_char(q.planned_end_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') end, v_summary);
      perform private.olo_event(p_company, 'production.readiness_changed', q.order_id, q.production_job_id, 'production',
        format('Job %s is ready for production', coalesce(q.job_number, '-')), jsonb_build_object('ready', true, 'rank', q.queue_rank), null);
      perform private.ap3_notify_roles(p_company, private.olo_uniq(private.olo_roles(p_company, 'production', 0) || private.olo_roles(p_company, 'production_planning', 0)),
        'olo_ready_for_production', 'success', format('Order ready for production: %s', coalesce(q.order_number, q.job_number)), v_body, 'production_job',
        q.production_job_id, '/production/' || q.production_job_id, 'olo-ready:' || q.production_job_id, null);
    else
      perform private.olo_event(p_company, 'production.readiness_changed', q.order_id, q.production_job_id, 'production',
        format('Job %s is no longer ready: %s', coalesce(q.job_number, '-'), coalesce(g -> 'blocker' ->> 'message', 'a gate changed')), jsonb_build_object('ready', false, 'blocker', g -> 'blocker'), null);
      update public.notifications set resolved_at = clock_timestamp(), resolution = 'Readiness changed', is_read = true, read_at = coalesce(read_at, now())
        where company_id = p_company and condition_key = 'olo-ready:' || q.production_job_id and resolved_at is null;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Recomputes the queue from the press slots, records rank changes and does the threshold work. Serialised per company.
create or replace function private.olo_sync_queue(p_company uuid, p_source text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s public.olo_settings; r record; v_changed integer := 0; v_tasks integer := 0; v_actor uuid := (select u.id from public.app_users u where u.id = auth.uid());
  v_order uuid; v_job text;
begin
  perform pg_advisory_xact_lock(hashtextextended('olo-queue:' || p_company::text, 0));
  s := private.olo_settings_for(p_company);
  for r in
    with n as (select * from private.olo_queue_ranks(p_company)),
    o as (select * from public.production_queue_positions where company_id = p_company)
    select coalesce(n.production_job_id, o.production_job_id) as job_id, o.queue_rank as old_rank, n.queue_rank as new_rank,
      o.machine_id as old_machine, n.machine_id as new_machine, n.slot_id, n.planned_start_at
    from n full join o on o.production_job_id = n.production_job_id
    where n.production_job_id is null or o.production_job_id is null or o.queue_rank <> n.queue_rank or o.machine_id <> n.machine_id
      or o.slot_id <> n.slot_id or o.planned_start_at <> n.planned_start_at
  loop
    select order_id, job_number into v_order, v_job from public.production_jobs where id = r.job_id;
    if r.old_rank is distinct from r.new_rank or r.old_machine is distinct from r.new_machine then
      insert into public.production_queue_rank_events(company_id, production_job_id, order_id, machine_id, previous_machine_id, previous_rank, new_rank, source, actor_id)
        values (p_company, r.job_id, v_order, r.new_machine, r.old_machine, r.old_rank, r.new_rank, p_source, v_actor);
      v_changed := v_changed + 1;
      if r.new_rank is not null and r.new_rank <= s.billet_rank_threshold and (r.old_rank is null or r.old_rank > s.billet_rank_threshold or r.old_machine is distinct from r.new_machine) then
        perform private.olo_event(p_company, 'order.queue_threshold_entered', v_order, r.job_id, 'production_planning',
          format('Job %s entered the top %s on its press (rank %s)', coalesce(v_job, '-'), s.billet_rank_threshold, r.new_rank),
          jsonb_build_object('previous_rank', r.old_rank, 'new_rank', r.new_rank, 'machine_id', r.new_machine), null);
      end if;
    end if;
    if r.new_rank is null then
      delete from public.production_queue_positions where production_job_id = r.job_id;
    else
      insert into public.production_queue_positions(production_job_id, company_id, machine_id, slot_id, queue_rank, planned_start_at)
        values (r.job_id, p_company, r.new_machine, r.slot_id, r.new_rank, r.planned_start_at)
      on conflict (production_job_id) do update set machine_id = excluded.machine_id, slot_id = excluded.slot_id, queue_rank = excluded.queue_rank,
        planned_start_at = excluded.planned_start_at, observed_at = clock_timestamp(),
        entered_at = case when production_queue_positions.machine_id <> excluded.machine_id then clock_timestamp() else production_queue_positions.entered_at end;
    end if;
  end loop;
  for r in select p.production_job_id, p.queue_rank, p.machine_id from public.production_queue_positions p
      where p.company_id = p_company and p.queue_rank <= greatest(s.billet_rank_threshold, s.die_rank_threshold) order by p.machine_id, p.queue_rank loop
    if r.queue_rank <= s.billet_rank_threshold then v_tasks := v_tasks + private.olo_ensure_billet_task(p_company, r.production_job_id, r.queue_rank, r.machine_id); end if;
    if r.queue_rank <= s.die_rank_threshold then v_tasks := v_tasks + private.olo_ensure_die_task(p_company, r.production_job_id, r.queue_rank, r.machine_id); end if;
  end loop;
  return jsonb_build_object('rank_changes', v_changed, 'tasks_created', v_tasks, 'verified', private.olo_verify_tasks(p_company),
    'readiness_changes', private.olo_refresh_readiness(p_company));
end;
$$;

-- Escalation: supervisor after the acknowledgement SLA, factory manager once overdue, management one SLA after that.
create or replace function private.olo_escalate(p_company uuid) returns integer
language plpgsql security definer set search_path = public, private as $$
declare t public.tasks%rowtype; s public.olo_settings := private.olo_settings_for(p_company); v_target integer; v_n integer := 0; v_roles text[];
begin
  for t in select * from public.tasks x where x.company_id = p_company and x.workflow_key is not null and x.status in ('open','in_progress') for update skip locked loop
    v_target := case
      when clock_timestamp() > t.workflow_due_at + make_interval(hours => s.action_sla_hours) then 3
      when clock_timestamp() > t.workflow_due_at then 2
      when t.acknowledged_at is null and clock_timestamp() > t.created_at + make_interval(hours => s.ack_sla_hours) then 1
      else 0 end;
    continue when v_target <= t.workflow_escalation_level;
    v_roles := private.olo_roles(p_company, t.workflow_department, v_target);
    perform private.olo_system(true);
    update public.tasks set workflow_escalation_level = v_target, workflow_escalated_at = clock_timestamp(),
      priority = case when v_target >= 2 then 'urgent' else priority end where id = t.id;
    insert into public.olo_task_events(company_id, task_id, action, note, facts)
      values (p_company, t.id, 'escalated', case v_target when 1 then 'Not acknowledged within the agreed time' when 2 then 'Overdue' else 'Overdue beyond the escalation limit' end,
        jsonb_build_object('level', v_target, 'roles', to_jsonb(v_roles)));
    perform private.ap3_notify_roles(p_company, v_roles, 'olo_escalation', case when v_target >= 2 then 'critical' else 'warning' end,
      format('Escalated (level %s): %s', v_target, t.title),
      format('%s %s Owner department: %s.', case v_target when 1 then 'Not acknowledged within ' || s.ack_sla_hours || ' hours.' when 2 then 'Past its due time.' else 'Overdue by more than ' || s.action_sla_hours || ' hours.' end,
        coalesce(t.description, ''), replace(t.workflow_department, '_', ' ')), 'task', t.id, '/tasks/orchestration', 'olo-esc:' || t.id || ':' || v_target, null);
    perform private.olo_system(false);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function private.olo_run_all(p_company uuid, p_source text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v jsonb;
begin
  v := private.olo_sync_queue(p_company, p_source);
  return v || jsonb_build_object('shortage_tasks', private.olo_evaluate_material_risk(p_company), 'escalated', private.olo_escalate(p_company),
    'verified_after_risk', private.olo_verify_tasks(p_company));
end;
$$;
revoke all on function private.olo_uniq(text[]), private.olo_create_task(uuid, text, text, integer, uuid, uuid, uuid, text, text, text, text, text[]),
  private.olo_event(uuid, text, uuid, uuid, text, text, jsonb, text), private.olo_fmt_kg(numeric), private.olo_ensure_billet_task(uuid, uuid, integer, uuid),
  private.olo_ensure_die_task(uuid, uuid, integer, uuid), private.olo_evaluate_material_risk(uuid), private.olo_close_task(public.tasks, boolean, text, jsonb),
  private.olo_verify_tasks(uuid), private.olo_refresh_readiness(uuid), private.olo_sync_queue(uuid, text), private.olo_escalate(uuid), private.olo_run_all(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Event triggers. Failures are logged, never block the business change, and are retried by the hourly job.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_after_change() returns trigger language plpgsql security definer set search_path = public, private as $$
declare c record; v_mode text := tg_argv[0];
begin
  if coalesce(current_setting('olo.engine', true), '') = 'running' then return null; end if;
  perform set_config('olo.engine', 'running', true);
  for c in select id from public.companies order by created_at loop
    begin
      if v_mode = 'queue' then
        perform private.olo_sync_queue(c.id, case when tg_table_name = 'production_jobs' then 'job_change' else 'slot_change' end);
      else
        perform private.olo_verify_tasks(c.id);
        perform private.olo_refresh_readiness(c.id);
        if v_mode = 'requirement' then perform private.olo_evaluate_material_risk(c.id); end if;
      end if;
    exception when others then
      insert into public.olo_engine_errors(company_id, source, message) values (c.id, left(tg_table_name || ':' || v_mode, 80), left(sqlerrm, 500));
    end;
  end loop;
  perform set_config('olo.engine', '', true);
  return null;
end;
$$;
revoke all on function private.olo_after_change() from public, anon, authenticated;
create trigger zzz_olo_queue_slots after insert or update or delete on public.production_plan_slots for each statement execute function private.olo_after_change('queue');
create trigger zzz_olo_queue_jobs after update of status, die_id, machine_id, profile_id on public.production_jobs for each statement execute function private.olo_after_change('queue');
create trigger zzz_olo_verify_billets after insert or update of status, order_id, production_job_id, allocation_requirement_id or delete on public.foundry_billets
  for each statement execute function private.olo_after_change('verify');
create trigger zzz_olo_verify_requirements after insert or update or delete on public.order_billet_requirements for each statement execute function private.olo_after_change('requirement');

-- Start guard: when the company enforces it, a job starts only on a prepared die and, separately, on a die preheated
-- within the approved hold time. Resuming a held job whose die was already issued is unaffected.
create or replace function private.olo_guard_production_start() returns trigger language plpgsql security definer set search_path = public, private as $$
declare s public.olo_settings; p public.die_preparations; v_die text;
begin
  if new.status <> 'in_progress' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'in_progress' then return new; end if;
  s := private.olo_settings_for(new.company_id);
  if not s.enforce_die_preparation then return new; end if;
  p := private.olo_prep_live(new.company_id, new.id);
  select die_number into v_die from public.dies where id = new.die_id;
  if p.id is null or p.status not in ('prepared','preheat_scheduled','preheating','ready','issued') then
    raise exception 'Die preparation for die % is not recorded as prepared. The tool room must check and prepare the die before production starts.', coalesce(v_die, '(none assigned)') using errcode = '23514';
  end if;
  if p.die_id is distinct from new.die_id then
    raise exception 'The prepared die is not the die assigned to this job. Prepare die % before starting.', coalesce(v_die, '(none assigned)') using errcode = '23514';
  end if;
  if s.enforce_preheat then
    if p.status not in ('ready','issued') then
      raise exception 'Die % preheating is not complete. Record the preheat against the approved standard before starting.', v_die using errcode = '23514';
    end if;
    if private.olo_prep_hold_expired(p) then
      raise exception 'Die % has been held hot for longer than the approved hold time. Reheat or re-check it before starting.', v_die using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.olo_guard_production_start() from public, anon, authenticated;
create trigger zzz_guard_olo_die_readiness before insert or update of status on public.production_jobs for each row execute function private.olo_guard_production_start();

-- A started job takes its prepared die: the preparation becomes issued and its ready announcement closes.
create or replace function private.olo_after_job_start() returns trigger language plpgsql security definer set search_path = public, private as $$
declare p public.die_preparations; v_name text;
begin
  if new.status = old.status then return null; end if;
  if new.status = 'in_progress' then
    p := private.olo_prep_live(new.company_id, new.id);
    if p.id is not null and p.die_id = new.die_id and p.status in ('prepared','preheat_scheduled','preheating','ready') then
      select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users where id = auth.uid();
      update public.die_preparations set status = 'issued', issued_at = clock_timestamp(), issued_by = (select u.id from public.app_users u where u.id = auth.uid()),
        updated_at = clock_timestamp() where id = p.id;
      insert into public.die_preparation_events(company_id, preparation_id, action, from_status, to_status, actor_id, actor_name, note)
        values (new.company_id, p.id, 'issued', p.status, 'issued', (select u.id from public.app_users u where u.id = auth.uid()), v_name, 'Issued to the press when the job started');
    end if;
    perform private.olo_event(new.company_id, 'production.run_started', new.order_id, new.id, 'production', format('Job %s started', coalesce(new.job_number, '-')),
      jsonb_build_object('machine_id', new.machine_id, 'die_id', new.die_id), null);
  elsif new.status in ('completed','on_hold','cancelled') then
    perform private.olo_event(new.company_id, 'production.run_' || case new.status when 'completed' then 'completed' when 'on_hold' then 'interrupted' else 'cancelled' end,
      new.order_id, new.id, 'production', format('Job %s %s', coalesce(new.job_number, '-'), replace(new.status, '_', ' ')), jsonb_build_object('previous_status', old.status), null);
  end if;
  if new.status in ('in_progress','completed','cancelled') then
    update public.notifications set resolved_at = clock_timestamp(), resolution = 'Job ' || replace(new.status, '_', ' '), is_read = true, read_at = coalesce(read_at, now())
      where company_id = new.company_id and condition_key = 'olo-ready:' || new.id and resolved_at is null;
  end if;
  return null;
end;
$$;
revoke all on function private.olo_after_job_start() from public, anon, authenticated;
create trigger zzz_olo_job_status_events after update of status on public.production_jobs for each row execute function private.olo_after_job_start();

-- ---------------------------------------------------------------------------------------------------------------
-- Order lifecycle: domains, quantity ledger, next action, blocker and timeline
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_dept_link(p_department text) returns text language sql immutable set search_path = public, private as $$
  select case p_department when 'finance' then '/orders/credit' when 'billet_inventory' then '/production/order-book' when 'procurement' then '/production/material-plan'
    when 'foundry' then '/foundry' when 'tool_room' then '/dies/preparation' when 'quality' then '/quality' when 'packaging' then '/packaging'
    when 'dispatch' then '/dispatches' when 'production_planning' then '/production/order-book' when 'production' then '/production' when 'sales' then '/quotes'
    else '/orders/lifecycle' end
$$;

create or replace function private.olo_order_core(p_company uuid, p_order uuid, p_finance boolean, p_with_gates boolean) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare o public.orders%rowtype; v_customer text; v_quote record; v_ordered numeric; v_produced numeric; v_qc_ok numeric; v_qc_pending numeric; v_qc_rej numeric;
  v_packed numeric; v_dispatched numeric; v_delivered numeric; v_hold text; v_po text; v_jobs jsonb := '[]'::jsonb; jr record; g jsonb; v_next jsonb; v_blocker jsonb;
  v_first_gate jsonb; v_counts jsonb; v_disp record; v_pod_missing integer; v_closure_op boolean; v_closure_final boolean; v_inv record; v_overall text;
  v_stage_since timestamptz; v_uninspected record; v_unscheduled record; v_ready_job record; v_running record; v_disputes integer; v_billet text; v_dies jsonb;
begin
  select * into o from public.orders where id = p_order and company_id = p_company and deleted_at is null;
  if not found then raise exception 'Order is unavailable for this company' using errcode = '23514'; end if;
  select coalesce(nullif(c.company_name, ''), c.customer_name) into v_customer from public.customers c where c.id = o.customer_id;
  select q.quote_number, q.status, q.sent_at, q.customer_decision_at into v_quote from public.quotes q where q.id = o.quote_id;
  select max(h.changed_at) into v_stage_since from public.order_stage_history h where h.company_id = p_company and h.order_id = o.id and h.stage = o.current_stage;

  -- Quantity ledger: each figure comes from its own record and describes a different physical state.
  v_ordered := coalesce(nullif(o.requested_weight_kg, 0), (select sum(i.quantity_kg) from public.order_items i where i.order_id = o.id), 0);
  select coalesce(sum(j.actual_quantity_kg) filter (where j.status in ('in_progress','completed','on_hold')), 0) into v_produced
    from public.production_jobs j where j.company_id = p_company and j.order_id = o.id;
  select coalesce(sum(qi.quantity_checked_kg) filter (where qi.status = 'approved'), 0), coalesce(sum(qi.quantity_checked_kg) filter (where qi.status in ('pending','rework')), 0),
    coalesce(sum(qi.quantity_checked_kg) filter (where qi.status = 'rejected'), 0)
    into v_qc_ok, v_qc_pending, v_qc_rej
  from public.quality_inspections qi join public.production_jobs j on j.id = qi.production_job_id where qi.company_id = p_company and j.order_id = o.id;
  select coalesce(sum(coalesce(pl.net_weight_kg, pl.gross_weight_kg - coalesce(pl.tare_weight_kg, 0))), 0),
    coalesce(sum(coalesce(pl.net_weight_kg, pl.gross_weight_kg - coalesce(pl.tare_weight_kg, 0))) filter (where d.actual_dispatched_at is not null and d.delivery_status not in ('returned')), 0),
    coalesce(sum(coalesce(pl.net_weight_kg, pl.gross_weight_kg - coalesce(pl.tare_weight_kg, 0))) filter (where d.delivery_status = 'delivered'), 0)
    into v_packed, v_dispatched, v_delivered
  from public.packing_list_items pl join public.dispatches d on d.id = pl.dispatch_id where d.company_id = p_company and d.order_id = o.id;
  v_packed := v_packed + coalesce((select sum(b.gross_weight_kg - b.tare_weight_kg) from public.prepared_physical_bundles b
    where b.company_id = p_company and b.order_id = o.id and b.dispatch_id is null), 0);

  select h.status into v_hold from public.order_credit_holds h where h.company_id = p_company and h.order_id = o.id and h.status in ('held','approved','rejected') order by h.created_at desc limit 1;
  select pi.customer_po_ref into v_po from public.po_intakes pi where pi.company_id = p_company and pi.order_id = o.id and pi.status = 'linked' order by pi.created_at desc limit 1;
  select count(*) filter (where d.delivery_status = 'pending') pending, count(*) filter (where d.actual_dispatched_at is not null and d.delivery_status in ('dispatched','in_transit','delayed')) moving,
    count(*) filter (where d.delivery_status = 'delivered') delivered, count(*) filter (where d.delivery_status in ('damaged','returned')) troubled, count(*) total,
    (array_agg(d.id order by d.actual_dispatched_at) filter (where d.actual_dispatched_at is not null and d.delivery_status in ('dispatched','in_transit','delayed')))[1] first_moving,
    (array_agg(d.id order by d.created_at) filter (where d.delivery_status = 'pending'))[1] first_pending
    into v_disp from public.dispatches d where d.company_id = p_company and d.order_id = o.id;
  select count(*) into v_pod_missing from public.dispatches d where d.company_id = p_company and d.order_id = o.id and d.delivery_status = 'delivered' and nullif(d.proof_of_delivery_url, '') is null;
  select count(*) into v_disputes from public.delivery_dispositions x join public.dispatches d on d.id = x.dispatch_id
    where d.company_id = p_company and d.order_id = o.id and x.disposition <> 'accepted' and x.resolved_at is null and x.reversed_at is null;
  select exists (select 1 from public.order_closures c where c.company_id = p_company and c.order_id = o.id and c.kind = 'operational' and c.status = 'closed'),
    exists (select 1 from public.order_closures c where c.company_id = p_company and c.order_id = o.id and c.kind = 'final' and c.status = 'closed')
    into v_closure_op, v_closure_final;
  select coalesce(sum(i.grand_total), 0) invoiced, coalesce(sum(i.amount_paid), 0) paid, coalesce(sum(i.balance_due), 0) balance, count(*) n
    into v_inv from public.invoices i where i.company_id = p_company and i.order_id = o.id and i.deleted_at is null and i.status not in ('draft','cancelled');

  select jsonb_object_agg(x.status, x.n) into v_counts from (select j.status, count(*) n from public.production_jobs j where j.company_id = p_company and j.order_id = o.id group by j.status) x;
  select coalesce(jsonb_agg(jsonb_build_object('die_number', d.die_number, 'die_status', d.die_status, 'preparation', p.status) order by d.die_number), '[]'::jsonb) into v_dies
    from (select distinct j.die_id, j.id from public.production_jobs j where j.company_id = p_company and j.order_id = o.id and j.status in ('planned','ready','on_hold','in_progress') and j.die_id is not null) jj
    join public.dies d on d.id = jj.die_id left join lateral (select * from private.olo_prep_live(p_company, jj.id)) p on true;

  for jr in select pj.id, pj.job_number, pj.status, pj.planned_quantity_kg, pj.actual_quantity_kg, pj.planned_date, m.machine_name, q.queue_rank, q.planned_start_at, q.planning_ready
      from public.production_jobs pj left join public.machines m on m.id = pj.machine_id left join public.production_queue_positions q on q.production_job_id = pj.id
      where pj.company_id = p_company and pj.order_id = o.id and pj.status <> 'cancelled'
      order by case pj.status when 'in_progress' then 0 when 'ready' then 1 when 'planned' then 2 when 'on_hold' then 3 else 4 end, q.queue_rank nulls last, pj.planned_date nulls last, pj.created_at
  loop
    g := case when p_with_gates and jr.status in ('planned','ready','on_hold') then private.olo_job_gates(p_company, jr.id) else null end;
    if g is not null and v_first_gate is null and not (g ->> 'start_ready')::boolean then v_first_gate := g -> 'blocker' || jsonb_build_object('job_number', jr.job_number, 'job_id', jr.id); end if;
    v_jobs := v_jobs || jsonb_build_object('id', jr.id, 'job_number', jr.job_number, 'status', jr.status, 'machine_name', jr.machine_name, 'queue_rank', jr.queue_rank,
      'planned_start_at', jr.planned_start_at, 'planned_date', jr.planned_date, 'planned_kg', jr.planned_quantity_kg, 'actual_kg', jr.actual_quantity_kg,
      'planning_ready', coalesce((g ->> 'planning_ready')::boolean, jr.planning_ready), 'start_ready', (g ->> 'start_ready')::boolean,
      'blocker', g -> 'blocker', 'gates', coalesce(g -> 'gates', '[]'::jsonb));
  end loop;

  select pj.id, pj.job_number into v_uninspected from public.production_jobs pj where pj.company_id = p_company and pj.order_id = o.id and pj.status = 'completed'
    and not exists (select 1 from public.quality_inspections qi where qi.production_job_id = pj.id) order by pj.completed_at limit 1;
  select pj.id, pj.job_number into v_unscheduled from public.production_jobs pj where pj.company_id = p_company and pj.order_id = o.id and pj.status = 'planned'
    and not exists (select 1 from public.production_queue_positions q where q.production_job_id = pj.id) order by pj.planned_date nulls last, pj.created_at limit 1;
  select (e ->> 'id')::uuid id, e ->> 'job_number' job_number into v_ready_job from jsonb_array_elements(v_jobs) e where (e ->> 'start_ready')::boolean limit 1;
  select (e ->> 'id')::uuid id, e ->> 'job_number' job_number into v_running from jsonb_array_elements(v_jobs) e where e ->> 'status' = 'in_progress' limit 1;

  -- Next action and owning department, from the first unmet obligation in the order's flow.
  v_next := case
    when o.current_stage = 'cancelled' or v_closure_final then null
    when v_hold in ('held','rejected') then jsonb_build_object('label', 'Decide the credit hold before production and dispatch', 'department', 'finance', 'link', '/orders/credit')
    when coalesce(o.manufacturing_weight_kg, 0) > 0 and coalesce(v_counts, '{}'::jsonb) - 'cancelled' = '{}'::jsonb
      then jsonb_build_object('label', 'Create and schedule production jobs', 'department', 'production_planning', 'link', '/production/drafts')
    when v_running.id is not null then jsonb_build_object('label', format('Complete production run %s', v_running.job_number), 'department', 'production', 'link', '/production/' || v_running.id)
    when v_ready_job.id is not null then jsonb_build_object('label', format('Start job %s: every gate has passed', v_ready_job.job_number), 'department', 'production', 'link', '/production/' || v_ready_job.id)
    when v_first_gate is not null then jsonb_build_object('label', format('Job %s: %s', v_first_gate ->> 'job_number', v_first_gate ->> 'message'), 'department', v_first_gate ->> 'department',
      'link', case when v_first_gate ->> 'code' in ('schedule','start_checks','hold') then '/production/' || (v_first_gate ->> 'job_id') else private.olo_dept_link(v_first_gate ->> 'department') end)
    when v_unscheduled.id is not null then jsonb_build_object('label', format('Schedule job %s on a press', v_unscheduled.job_number), 'department', 'production_planning', 'link', '/production/schedule')
    when v_uninspected.id is not null then jsonb_build_object('label', format('Inspect the output of job %s', v_uninspected.job_number), 'department', 'quality', 'link', '/quality')
    when v_qc_pending > 0 then jsonb_build_object('label', format('Decide %s of material awaiting a QC disposition', private.olo_fmt_kg(v_qc_pending)), 'department', 'quality', 'link', '/quality')
    when v_qc_ok > v_packed + 1 and v_produced > 0 then jsonb_build_object('label', format('Pack %s of QC-released material', private.olo_fmt_kg(v_qc_ok - v_packed)), 'department', 'packaging', 'link', '/packaging')
    when v_disp.first_pending is not null then jsonb_build_object('label', 'Complete dispatch documents and load the pending dispatch', 'department', 'dispatch', 'link', '/dispatches/' || v_disp.first_pending)
    when v_disp.first_moving is not null then jsonb_build_object('label', 'Confirm delivery of the dispatched material', 'department', 'dispatch', 'link', '/dispatches/' || v_disp.first_moving)
    when v_pod_missing > 0 then jsonb_build_object('label', 'Upload the proof of delivery', 'department', 'dispatch', 'link', '/dispatches')
    when v_disputes > 0 then jsonb_build_object('label', 'Resolve the customer delivery discrepancy', 'department', 'sales', 'link', '/dispatches')
    when v_ordered > 0 and v_dispatched + 1 < v_ordered and o.current_stage not in ('closed','delivered') then jsonb_build_object('label', format('Plan the remaining %s', private.olo_fmt_kg(v_ordered - v_dispatched)), 'department', 'production_planning', 'link', '/production/drafts')
    when v_inv.balance > 0 then jsonb_build_object('label', 'Follow up the customer payment', 'department', 'finance', 'link', '/payments')
    when not v_closure_op then jsonb_build_object('label', 'Review and close the order', 'department', 'management', 'link', '/orders/' || o.id)
    else jsonb_build_object('label', 'Record final closure once finance is settled', 'department', 'management', 'link', '/orders/' || o.id) end;
  v_blocker := case when v_hold in ('held','rejected') then jsonb_build_object('label', 'Credit hold open', 'department', 'finance')
    when v_first_gate is not null and v_ready_job.id is null and v_running.id is null then jsonb_build_object('label', v_first_gate ->> 'message', 'department', v_first_gate ->> 'department', 'gate', v_first_gate ->> 'label')
    when v_disputes > 0 then jsonb_build_object('label', 'Customer delivery discrepancy unresolved', 'department', 'sales')
    else null end;

  v_overall := case
    when o.current_stage = 'cancelled' then 'cancelled'
    when v_closure_final then 'fully_closed'
    when v_closure_op and v_inv.balance > 0 then 'operationally_closed_financially_open'
    when v_closure_op then 'operationally_closed'
    when v_hold in ('held','rejected') then 'awaiting_commercial_clearance'
    when v_ordered > 0 and v_dispatched + 1 >= v_ordered and v_disp.delivered = v_disp.total and v_disp.total > 0 then 'delivered_acceptance_pending'
    when v_ordered > 0 and v_dispatched + 1 >= v_ordered then 'dispatched_awaiting_delivery'
    when v_dispatched > 0 then 'partially_fulfilled'
    when v_running.id is not null then 'in_production'
    when v_qc_pending > 0 or v_uninspected.id is not null then 'awaiting_quality'
    when v_produced > 0 then 'in_process'
    when coalesce(v_counts, '{}'::jsonb) - 'cancelled' <> '{}'::jsonb then 'planned'
    else 'awaiting_production_planning' end;
  v_billet := coalesce(o.billet_allocation_status, 'not_required');

  return jsonb_build_object(
    'order', jsonb_build_object('id', o.id, 'order_number', o.order_number, 'customer_name', v_customer, 'priority', o.priority, 'current_stage', o.current_stage,
      'order_date', o.order_date, 'expected_dispatch_date', o.expected_dispatch_date, 'stage_since', coalesce(v_stage_since, o.updated_at),
      'days_in_stage', greatest(private.ist_today() - (coalesce(v_stage_since, o.updated_at) at time zone 'Asia/Kolkata')::date, 0), 'quote_number', v_quote.quote_number,
      'customer_po', v_po),
    'quantities', jsonb_build_object('ordered_kg', v_ordered, 'produced_kg', v_produced, 'qc_accepted_kg', v_qc_ok, 'qc_pending_kg', v_qc_pending, 'qc_rejected_kg', v_qc_rej,
      'packed_kg', v_packed, 'dispatched_kg', v_dispatched, 'delivered_kg', v_delivered, 'outstanding_kg', greatest(v_ordered - v_dispatched, 0)),
    'domains', jsonb_build_array(
      jsonb_build_object('key', 'commercial', 'label', 'Commercial', 'status', case when v_quote.quote_number is null then 'direct_order' else coalesce(v_quote.status, 'unknown') end,
        'detail', concat_ws(' · ', 'Quote ' || v_quote.quote_number, 'PO ' || v_po)),
      jsonb_build_object('key', 'finance_clearance', 'label', 'Finance clearance', 'status', case v_hold when 'held' then 'blocked' when 'rejected' then 'blocked' when 'approved' then 'cleared_by_exception' else 'cleared' end,
        'detail', case v_hold when 'held' then 'Credit hold awaiting decision' when 'rejected' then 'Credit hold rejected' when 'approved' then 'Released under an approved credit exception' else 'No open credit hold' end),
      jsonb_build_object('key', 'billets', 'label', 'Billets', 'status', v_billet, 'detail', format('%s of %s billets allocated', coalesce(o.billets_allocated, 0), coalesce(o.billets_required, 0))),
      jsonb_build_object('key', 'dies', 'label', 'Dies', 'status', case when jsonb_array_length(v_dies) = 0 then 'none_active' when exists (select 1 from jsonb_array_elements(v_dies) x where x ->> 'die_status' not in ('active','approved')) then 'not_approved'
        when exists (select 1 from jsonb_array_elements(v_dies) x where coalesce(x ->> 'preparation', '') not in ('prepared','preheat_scheduled','preheating','ready','issued')) then 'preparation_pending' else 'ready' end, 'detail', v_dies),
      jsonb_build_object('key', 'production', 'label', 'Production', 'status', case when v_running.id is not null then 'running' when coalesce(v_counts ->> 'completed', '0')::integer > 0 and coalesce(v_counts ->> 'planned', '0')::integer + coalesce(v_counts ->> 'ready', '0')::integer + coalesce(v_counts ->> 'on_hold', '0')::integer > 0 then 'partially_produced'
        when coalesce(v_counts ->> 'completed', '0')::integer > 0 then 'produced' when coalesce(v_counts, '{}'::jsonb) - 'cancelled' <> '{}'::jsonb then 'planned' else 'not_planned' end, 'detail', coalesce(v_counts, '{}'::jsonb)),
      jsonb_build_object('key', 'quality', 'label', 'Quality', 'status', case when v_qc_pending > 0 then 'held' when v_qc_rej > 0 and v_qc_ok > 0 then 'partially_accepted' when v_qc_rej > 0 then 'rejected'
        when v_qc_ok > 0 then 'accepted' when v_uninspected.id is not null then 'awaiting_inspection' else 'not_started' end,
        'detail', format('Accepted %s · pending %s · rejected %s', private.olo_fmt_kg(v_qc_ok), private.olo_fmt_kg(v_qc_pending), private.olo_fmt_kg(v_qc_rej))),
      jsonb_build_object('key', 'packaging', 'label', 'Packaging', 'status', case when v_packed <= 0 then 'not_started' when v_packed + 1 < v_qc_ok then 'partially_packed' else 'packed' end, 'detail', 'Packed ' || private.olo_fmt_kg(v_packed)),
      jsonb_build_object('key', 'dispatch', 'label', 'Dispatch', 'status', case when coalesce(v_disp.total, 0) = 0 then 'not_started' when v_disp.pending > 0 then 'awaiting_dispatch' when v_disp.moving > 0 then 'in_transit'
        when v_dispatched + 1 < v_ordered then 'partially_dispatched' else 'dispatched' end, 'detail', format('Dispatched %s of %s', private.olo_fmt_kg(v_dispatched), private.olo_fmt_kg(v_ordered))),
      jsonb_build_object('key', 'delivery', 'label', 'Delivery', 'status', case when coalesce(v_disp.delivered, 0) = 0 then 'not_delivered' when v_disputes > 0 then 'disputed' when v_pod_missing > 0 then 'pod_pending'
        when v_disp.delivered < v_disp.total then 'partially_delivered' else 'delivered' end, 'detail', format('Delivered %s; %s without proof of delivery', private.olo_fmt_kg(v_delivered), v_pod_missing)),
      jsonb_build_object('key', 'closure', 'label', 'Closure', 'status', case when v_closure_final then 'fully_closed' when v_closure_op then 'operationally_closed' else 'open' end,
        'detail', case when v_closure_final then 'Final closure recorded' when v_closure_op then 'Operational closure recorded; final closure pending' else 'Not closed' end)
    ) || case when p_finance then jsonb_build_array(jsonb_build_object('key', 'payment', 'label', 'Payment', 'status', case when v_inv.n = 0 then 'not_invoiced' when v_inv.balance <= 0 then 'settled' else 'outstanding' end,
        'detail', format('Invoiced ₹%s · paid ₹%s · balance ₹%s', to_char(v_inv.invoiced, 'FM99,99,99,99,990.00'), to_char(v_inv.paid, 'FM99,99,99,99,990.00'), to_char(v_inv.balance, 'FM99,99,99,99,990.00'))))
      else jsonb_build_array(jsonb_build_object('key', 'payment', 'label', 'Payment', 'status', case when v_inv.n = 0 then 'not_invoiced' when v_inv.balance <= 0 then 'settled' else 'outstanding' end, 'detail', 'Amounts are visible to finance')) end,
    'overall', v_overall,
    'next_action', v_next,
    'blocker', v_blocker,
    'risk', case when o.current_stage in ('closed','cancelled') then 'none' when o.expected_dispatch_date < private.ist_today() and v_dispatched + 1 < v_ordered then 'late'
      when o.expected_dispatch_date <= private.ist_today() + 3 and v_dispatched + 1 < v_ordered and v_qc_ok + 1 < v_ordered then 'at_risk' else 'on_track' end,
    'jobs', v_jobs,
    'finance', case when p_finance then jsonb_build_object('invoiced', v_inv.invoiced, 'paid', v_inv.paid, 'balance', v_inv.balance) else null end
  );
end;
$$;

create or replace function private.olo_order_timeline(p_company uuid, p_order uuid, p_finance boolean) returns jsonb
language sql stable security definer set search_path = public, private as $$
  with jobs as (select id, job_number from public.production_jobs where company_id = p_company and order_id = p_order),
  ev as (
    select o.created_at at_, 'order' kind, 'sales' department, 'Order ' || o.order_number || ' recorded' summary, o.created_by actor from public.orders o where o.id = p_order and o.company_id = p_company
    union all select q.sent_at, 'quote', 'sales', 'Quotation ' || q.quote_number || ' sent', null from public.quotes q join public.orders o on o.quote_id = q.id where o.id = p_order and q.sent_at is not null
    union all select q.customer_decision_at, 'quote', 'sales', 'Customer decision on ' || q.quote_number || ': ' || replace(q.status, '_', ' '), null from public.quotes q join public.orders o on o.quote_id = q.id where o.id = p_order and q.customer_decision_at is not null
    union all select h.changed_at, 'stage', null, 'Stage: ' || replace(h.stage, '_', ' ') || coalesce(' (' || nullif(h.remarks, '') || ')', ''), h.changed_by from public.order_stage_history h where h.company_id = p_company and h.order_id = p_order
    union all select pi.created_at, 'commercial', 'finance', 'Customer PO ' || pi.customer_po_ref || ' received (' || pi.status || ')', pi.created_by from public.po_intakes pi where pi.company_id = p_company and pi.order_id = p_order
    union all select h.created_at, 'finance', 'finance', 'Credit hold opened', h.requested_by from public.order_credit_holds h where h.company_id = p_company and h.order_id = p_order
    union all select h.decided_at, 'finance', 'finance', 'Credit hold ' || h.status, h.decided_by from public.order_credit_holds h where h.company_id = p_company and h.order_id = p_order and h.decided_at is not null
    union all select h.cleared_at, 'finance', 'finance', 'Credit hold cleared', null from public.order_credit_holds h where h.company_id = p_company and h.order_id = p_order and h.cleared_at is not null
    union all select c.proposed_at, 'change', 'sales', 'Order change proposed: ' || left(c.reason, 120), c.proposed_by from public.order_change_proposals c where c.company_id = p_company and c.order_id = p_order
    union all select c.decided_at, 'change', 'sales', 'Order change ' || c.status, c.decided_by from public.order_change_proposals c where c.company_id = p_company and c.order_id = p_order and c.decided_at is not null
    union all select e.occurred_at, 'workflow', e.department, e.summary, e.actor_id from public.olo_events e where e.company_id = p_company and e.order_id = p_order
    union all select r.occurred_at, 'queue', 'production_planning', 'Job ' || coalesce(j.job_number, '-') || ' queue rank ' || coalesce(r.previous_rank::text, 'unranked') || ' → ' || coalesce(r.new_rank::text, 'left queue'), r.actor_id
      from public.production_queue_rank_events r join jobs j on j.id = r.production_job_id where r.company_id = p_company
    union all select h.created_at, 'production', 'production', 'Job ' || coalesce(j.job_number, '-') || ': ' || replace(coalesce(h.previous_status, 'new'), '_', ' ') || ' → ' || replace(h.new_status, '_', ' ') || coalesce(' (' || nullif(h.reason, '') || ')', ''), h.changed_by
      from public.production_job_status_history h join jobs j on j.id = h.production_job_id where h.company_id = p_company
    union all select pe.occurred_at, 'die', 'tool_room', 'Die preparation ' || replace(pe.action, '_', ' ') || ' for job ' || coalesce(j.job_number, '-') || coalesce(': ' || nullif(pe.note, ''), ''), pe.actor_id
      from public.die_preparation_events pe join public.die_preparations p on p.id = pe.preparation_id join jobs j on j.id = p.production_job_id where pe.company_id = p_company
    union all select qi.inspection_date, 'quality', 'quality', 'QC ' || qi.status || ' for job ' || coalesce(j.job_number, '-') || ': ' || private.olo_fmt_kg(qi.quantity_checked_kg), null
      from public.quality_inspections qi join jobs j on j.id = qi.production_job_id where qi.company_id = p_company
    union all select pk.created_at, 'packaging', 'packaging', 'Packaging ' || coalesce(pk.packaging_number, '') || ' ' || pk.status, pk.created_by from public.packaging_jobs pk where pk.company_id = p_company and pk.order_id = p_order
    union all select d.actual_dispatched_at, 'dispatch', 'dispatch', 'Dispatch ' || d.dispatch_number || ' left the factory' || coalesce(' (LR ' || nullif(d.lr_number, '') || ')', ''), null
      from public.dispatches d where d.company_id = p_company and d.order_id = p_order and d.actual_dispatched_at is not null
    union all select sh.changed_at, 'dispatch', 'dispatch', 'Dispatch ' || d.dispatch_number || ': ' || replace(coalesce(sh.from_status, 'new'), '_', ' ') || ' → ' || replace(sh.to_status, '_', ' '), sh.changed_by
      from public.dispatch_status_history sh join public.dispatches d on d.id = sh.dispatch_id where d.company_id = p_company and d.order_id = p_order
    union all select x.recorded_at, 'delivery', 'sales', 'Delivery ' || replace(x.disposition, '_', ' ') || ': ' || private.olo_fmt_kg(x.quantity_kg) || ' received by ' || x.receiver_name, x.recorded_by
      from public.delivery_dispositions x join public.dispatches d on d.id = x.dispatch_id where d.company_id = p_company and d.order_id = p_order
    union all select cc.logged_at, 'complaint', 'quality', 'Customer complaint logged: ' || left(cc.description, 120), cc.logged_by from public.customer_complaints cc where cc.company_id = p_company and cc.order_id = p_order
    union all select i.issued_at, 'invoice', 'finance', 'Invoice ' || i.invoice_number || ' issued' || case when p_finance then ' for ₹' || to_char(i.grand_total, 'FM99,99,99,99,990.00') else '' end, null
      from public.invoices i where i.company_id = p_company and i.order_id = p_order and i.issued_at is not null and i.deleted_at is null
    union all select p.created_at, 'payment', 'finance', 'Payment received: ₹' || to_char(p.amount, 'FM99,99,99,99,990.00'), p.recorded_by_user_id
      from public.payments p join public.invoices i on i.id = p.invoice_id where p_finance and i.company_id = p_company and i.order_id = p_order and p.reversed_at is null
    union all select c.closed_at, 'closure', 'management', initcap(c.kind) || ' closure recorded' || coalesce(': ' || nullif(c.close_note, ''), ''), c.closed_by from public.order_closures c where c.company_id = p_company and c.order_id = p_order
    union all select c.reopened_at, 'closure', 'management', initcap(c.kind) || ' closure reopened' || coalesce(': ' || nullif(c.reopen_note, ''), ''), c.reopened_by from public.order_closures c where c.company_id = p_company and c.order_id = p_order and c.reopened_at is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('at', x.at_, 'kind', x.kind, 'department', x.department, 'summary', x.summary, 'actor_name', x.actor_name) order by x.at_ desc), '[]'::jsonb)
  from (select ev.*, (select nullif(u.full_name, '') from public.app_users u where u.id = ev.actor) actor_name from ev where ev.at_ is not null order by ev.at_ desc limit 200) x
$$;
revoke all on function private.olo_dept_link(text), private.olo_order_core(uuid, uuid, boolean, boolean), private.olo_order_timeline(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.olo_keys(p_payload jsonb, p_allowed text[]) returns void language plpgsql immutable set search_path = public, private as $$
declare k text;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid request' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_payload) loop
    if not (k = any(p_allowed)) then raise exception 'Unexpected field: %', k using errcode = '22023'; end if;
  end loop;
end;
$$;
create or replace function private.olo_page(p_payload jsonb) returns integer language sql immutable set search_path = public, private as $$
  select greatest(1, least(coalesce(nullif(p_payload ->> 'page', '')::integer, 1), 100000))
$$;
revoke all on function private.olo_keys(jsonb, text[]), private.olo_page(jsonb) from public, anon, authenticated;

create or replace function public.olo_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_actor uuid := auth.uid(); v_company uuid := private.get_current_user_company_id(); v_role text := private.get_current_user_role();
  v_finance boolean; v_page integer; v_rows jsonb; v_total bigint; v_payload jsonb := coalesce(p_payload, '{}'::jsonb); s public.olo_settings; t public.tasks%rowtype;
  v_view text; v_dept text; v_stage integer; v_roles text[]; v_user uuid; v_order uuid; v_job uuid; v_search text; v_result jsonb; v_machine uuid;
  v_my_depts text[]; c jsonb; v_list jsonb;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_dealer_id() is not null or not exists (select 1 from public.app_users u where u.id = v_actor and u.company_id = v_company and u.is_active and u.role = v_role)
     or not (v_role = any(private.olo_reader_roles())) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;
  v_finance := v_role = any(private.olo_finance_roles());
  v_page := private.olo_page(v_payload);
  s := private.olo_settings_for(v_company);
  select coalesce(array_agg(d), '{}') into v_my_depts from unnest(private.olo_departments()) d where v_role = any(private.olo_roles(v_company, d, 0));

  if p_command = 'settings.get' then
    perform private.olo_keys(v_payload, '{}');
    return jsonb_build_object('settings', to_jsonb(s) - 'company_id', 'can_edit', v_role in ('owner','admin','factory_manager'), 'can_edit_routing', v_role in ('owner','admin'),
      'can_edit_standards', v_role = any(private.olo_manager_roles()),
      'routing', (select jsonb_agg(jsonb_build_object('department', d, 'stage', st, 'roles', to_jsonb(private.olo_roles(v_company, d, st)),
          'customised', exists (select 1 from public.olo_department_roles r where r.company_id = v_company and r.department = d and r.stage = st)) order by d, st)
        from unnest(private.olo_departments()) d cross join generate_series(0, 3) st),
      'standards', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'die_type', x.die_type, 'min_temperature_c', x.min_temperature_c, 'max_temperature_c', x.max_temperature_c,
          'min_soak_minutes', x.min_soak_minutes, 'max_hold_minutes', x.max_hold_minutes, 'sop_reference', x.sop_reference, 'approved_at', x.approved_at,
          'approved_by_name', (select full_name from public.app_users u where u.id = x.approved_by)) order by x.die_type nulls first), '[]'::jsonb)
        from public.die_preheat_standards x where x.company_id = v_company and x.is_active),
      'engine_errors', case when v_role = any(private.olo_manager_roles()) then (select coalesce(jsonb_agg(jsonb_build_object('source', e.source, 'message', e.message, 'occurred_at', e.occurred_at) order by e.occurred_at desc), '[]'::jsonb)
        from (select * from public.olo_engine_errors e where e.company_id = v_company and e.occurred_at > now() - interval '7 days' order by e.occurred_at desc limit 20) e) else '[]'::jsonb end);

  elsif p_command = 'settings.save' then
    perform private.olo_keys(v_payload, array['billet_rank_threshold','die_rank_threshold','material_risk_horizon_days','ack_sla_hours','action_sla_hours','enforce_die_preparation','enforce_preheat']);
    if v_role not in ('owner','admin','factory_manager') then raise exception 'Only the owner, admin or factory manager can change orchestration settings' using errcode = '42501'; end if;
    insert into public.olo_settings(company_id, billet_rank_threshold, die_rank_threshold, material_risk_horizon_days, ack_sla_hours, action_sla_hours, enforce_die_preparation, enforce_preheat, updated_by, updated_at)
    values (v_company, coalesce((v_payload ->> 'billet_rank_threshold')::smallint, s.billet_rank_threshold), coalesce((v_payload ->> 'die_rank_threshold')::smallint, s.die_rank_threshold),
      coalesce((v_payload ->> 'material_risk_horizon_days')::smallint, s.material_risk_horizon_days), coalesce((v_payload ->> 'ack_sla_hours')::smallint, s.ack_sla_hours),
      coalesce((v_payload ->> 'action_sla_hours')::smallint, s.action_sla_hours), coalesce((v_payload ->> 'enforce_die_preparation')::boolean, s.enforce_die_preparation),
      coalesce((v_payload ->> 'enforce_preheat')::boolean, s.enforce_preheat), v_actor, now())
    on conflict (company_id) do update set billet_rank_threshold = excluded.billet_rank_threshold, die_rank_threshold = excluded.die_rank_threshold,
      material_risk_horizon_days = excluded.material_risk_horizon_days, ack_sla_hours = excluded.ack_sla_hours, action_sla_hours = excluded.action_sla_hours,
      enforce_die_preparation = excluded.enforce_die_preparation, enforce_preheat = excluded.enforce_preheat, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
      values (v_company, v_actor, 'olo_settings.updated', 'olo_settings', v_company, jsonb_build_object('before', to_jsonb(s) - 'company_id', 'changes', v_payload));
    perform private.olo_sync_queue(v_company, 'settings_change');
    return to_jsonb(private.olo_settings_for(v_company)) - 'company_id';

  elsif p_command = 'routing.save' then
    perform private.olo_keys(v_payload, array['department','stage','roles','reset']);
    if v_role not in ('owner','admin') then raise exception 'Only the owner or admin can change who receives department work' using errcode = '42501'; end if;
    v_dept := v_payload ->> 'department'; v_stage := (v_payload ->> 'stage')::integer;
    if v_dept is null or not (v_dept = any(private.olo_departments())) or v_stage is null or v_stage not between 0 and 3 then raise exception 'Choose a department and escalation stage' using errcode = '22023'; end if;
    if coalesce((v_payload ->> 'reset')::boolean, false) then
      delete from public.olo_department_roles where company_id = v_company and department = v_dept and stage = v_stage;
    else
      select coalesce(array_agg(distinct x), '{}') into v_roles from jsonb_array_elements_text(coalesce(v_payload -> 'roles', '[]'::jsonb)) x;
      if cardinality(v_roles) = 0 or not (v_roles <@ private.olo_internal_roles()) then raise exception 'Choose one or more staff roles' using errcode = '22023'; end if;
      insert into public.olo_department_roles(company_id, department, stage, roles, updated_by) values (v_company, v_dept, v_stage, v_roles, v_actor)
      on conflict (company_id, department, stage) do update set roles = excluded.roles, updated_by = excluded.updated_by, updated_at = now();
    end if;
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
      values (v_company, v_actor, 'olo_routing.updated', 'olo_department_roles', v_company, v_payload);
    return jsonb_build_object('department', v_dept, 'stage', v_stage, 'roles', to_jsonb(private.olo_roles(v_company, v_dept, v_stage)));

  elsif p_command = 'standards.save' then
    perform private.olo_keys(v_payload, array['name','die_type','min_temperature_c','max_temperature_c','min_soak_minutes','max_hold_minutes','sop_reference']);
    if not (v_role = any(private.olo_manager_roles())) then raise exception 'Only managers can approve a die preheat standard' using errcode = '42501'; end if;
    update public.die_preheat_standards set is_active = false, retired_at = now(), retired_by = v_actor
      where company_id = v_company and is_active and coalesce(die_type, '*') = coalesce(nullif(v_payload ->> 'die_type', ''), '*');
    insert into public.die_preheat_standards(company_id, name, die_type, min_temperature_c, max_temperature_c, min_soak_minutes, max_hold_minutes, sop_reference, approved_by)
    values (v_company, btrim(v_payload ->> 'name'), nullif(v_payload ->> 'die_type', ''), (v_payload ->> 'min_temperature_c')::numeric, (v_payload ->> 'max_temperature_c')::numeric,
      (v_payload ->> 'min_soak_minutes')::integer, (v_payload ->> 'max_hold_minutes')::integer, btrim(v_payload ->> 'sop_reference'), v_actor)
    returning jsonb_build_object('id', id) into v_result;
    return v_result;

  elsif p_command = 'standards.retire' then
    perform private.olo_keys(v_payload, array['id']);
    if not (v_role = any(private.olo_manager_roles())) then raise exception 'Only managers can retire a die preheat standard' using errcode = '42501'; end if;
    update public.die_preheat_standards set is_active = false, retired_at = now(), retired_by = v_actor where id = (v_payload ->> 'id')::uuid and company_id = v_company and is_active;
    if not found then raise exception 'This standard is not active' using errcode = '23514'; end if;
    return jsonb_build_object('id', v_payload ->> 'id');

  elsif p_command = 'tasks.inbox' then
    perform private.olo_keys(v_payload, array['view','page']);
    v_view := coalesce(v_payload ->> 'view', 'mine');
    if v_view not in ('mine','department','overdue','escalated','completed','all') then raise exception 'Unknown inbox view' using errcode = '22023'; end if;
    select coalesce(jsonb_agg(r.row_data order by r.ord), '[]'::jsonb), max(r.total) into v_rows, v_total from (
      select jsonb_build_object('id', b.id, 'title', b.title, 'description', b.description, 'kind', b.workflow_kind, 'department', b.workflow_department,
        'status', b.status, 'priority', b.priority, 'order_id', b.workflow_order_id, 'order_number', o.order_number, 'job_id', b.workflow_job_id, 'job_number', j.job_number, 'source_id', b.workflow_source_id,
        'assigned_to', b.assigned_to, 'assignee_name', (select full_name from public.app_users u where u.id = b.assigned_to), 'acknowledged_at', b.acknowledged_at,
        'acknowledged_by_name', (select full_name from public.app_users u where u.id = b.acknowledged_by), 'due_at', b.workflow_due_at, 'created_at', b.created_at,
        'escalation_level', b.workflow_escalation_level, 'cycle', b.workflow_cycle, 'system_resolution', b.system_resolution, 'completed_at', b.completed_at,
        'can_act', b.status in ('open','in_progress') and (b.assigned_to = v_actor or b.workflow_department = any(v_my_depts) or v_role = any(private.olo_manager_roles())),
        'can_reassign', b.status in ('open','in_progress') and v_role = any(private.olo_manager_roles())) row_data,
        count(*) over () total,
        row_number() over (order by case when b.status in ('open','in_progress') then 0 else 1 end, b.workflow_escalation_level desc,
          case b.priority when 'urgent' then 0 when 'high' then 1 else 2 end, b.workflow_due_at, b.id) ord
      from public.tasks b left join public.orders o on o.id = b.workflow_order_id left join public.production_jobs j on j.id = b.workflow_job_id
      where b.company_id = v_company and b.workflow_key is not null
        and case v_view
          when 'mine' then b.assigned_to = v_actor and b.status in ('open','in_progress')
          when 'department' then b.workflow_department = any(v_my_depts) and b.status in ('open','in_progress')
          when 'overdue' then b.status in ('open','in_progress') and b.workflow_due_at < clock_timestamp()
          when 'escalated' then b.status in ('open','in_progress') and b.workflow_escalation_level > 0
          when 'completed' then b.status in ('completed','cancelled')
          else true end
      order by ord offset (v_page - 1) * 10 limit 10) r;
    return jsonb_build_object('view', v_view, 'page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows, 'departments', to_jsonb(v_my_depts),
      'counts', (select jsonb_build_object(
        'mine', count(*) filter (where t2.assigned_to = v_actor and t2.status in ('open','in_progress')),
        'department', count(*) filter (where t2.workflow_department = any(v_my_depts) and t2.status in ('open','in_progress')),
        'overdue', count(*) filter (where t2.status in ('open','in_progress') and t2.workflow_due_at < clock_timestamp()),
        'escalated', count(*) filter (where t2.status in ('open','in_progress') and t2.workflow_escalation_level > 0))
        from public.tasks t2 where t2.company_id = v_company and t2.workflow_key is not null));

  elsif p_command in ('tasks.acknowledge','tasks.start','tasks.reassign') then
    perform private.olo_keys(v_payload, array['task_id','note','user_id']);
    select * into t from public.tasks where id = (v_payload ->> 'task_id')::uuid and company_id = v_company and workflow_key is not null for update;
    if not found then raise exception 'Workflow task not found' using errcode = '23514'; end if;
    if t.status not in ('open','in_progress') then raise exception 'This task is already closed' using errcode = '23514'; end if;
    if p_command = 'tasks.reassign' then
      if not (v_role = any(private.olo_manager_roles())) then raise exception 'Only managers can reassign workflow tasks' using errcode = '42501'; end if;
      v_user := (v_payload ->> 'user_id')::uuid;
      if not exists (select 1 from public.app_users u where u.id = v_user and u.company_id = v_company and u.is_active and u.dealer_id is null
          and (u.role = any(private.olo_roles(v_company, t.workflow_department, 0)) or u.role = any(private.olo_manager_roles()))) then
        raise exception 'Choose an active employee of the responsible department' using errcode = '23514';
      end if;
      if length(btrim(coalesce(v_payload ->> 'note', ''))) < 5 then raise exception 'Record why the task is reassigned' using errcode = '23514'; end if;
      update public.tasks set assigned_to = v_user, assigned_by_user_id = v_actor where id = t.id;
      insert into public.olo_task_events(company_id, task_id, action, actor_id, note, facts)
        values (v_company, t.id, 'reassigned', v_actor, left(btrim(v_payload ->> 'note'), 500), jsonb_build_object('from', t.assigned_to, 'to', v_user));
      return jsonb_build_object('id', t.id, 'assigned_to', v_user);
    end if;
    if not (t.assigned_to = v_actor or t.workflow_department = any(v_my_depts) or v_role = any(private.olo_manager_roles())) then
      raise exception 'This task belongs to another department' using errcode = '42501';
    end if;
    if t.acknowledged_at is null then
      update public.tasks set acknowledged_at = clock_timestamp(), acknowledged_by = v_actor where id = t.id;
      insert into public.olo_task_events(company_id, task_id, action, actor_id, note) values (v_company, t.id, 'acknowledged', v_actor, nullif(left(btrim(coalesce(v_payload ->> 'note', '')), 500), ''));
    end if;
    if p_command = 'tasks.start' and t.status = 'open' then
      update public.tasks set status = 'in_progress', assigned_to = coalesce(assigned_to, v_actor) where id = t.id;
      insert into public.olo_task_events(company_id, task_id, action, actor_id) values (v_company, t.id, 'started', v_actor);
    end if;
    return jsonb_build_object('id', t.id, 'status', (select status from public.tasks where id = t.id), 'acknowledged', true);

  elsif p_command = 'queue.book' then
    perform private.olo_keys(v_payload, array['machine_id','page']);
    v_machine := nullif(v_payload ->> 'machine_id', '')::uuid;
    select coalesce(jsonb_agg(x.r order by x.machine_name, x.queue_rank), '[]'::jsonb), max(x.total) into v_rows, v_total from (
      select m.machine_name, q.queue_rank, count(*) over () total,
        jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'job_status', j.status, 'queue_rank', q.queue_rank, 'machine_id', q.machine_id, 'machine_name', m.machine_name,
          'press_capacity_ton', m.press_capacity_ton, 'planned_start_at', q.planned_start_at, 'order_id', o.id, 'order_number', o.order_number,
          'customer_name', (select coalesce(nullif(c.company_name, ''), c.customer_name) from public.customers c where c.id = o.customer_id), 'priority', o.priority,
          'profile_code', pr.profile_code, 'alloy', pr.alloy, 'temper', pr.temper, 'billet_diameter_inch', coalesce(d.billet_diameter_required_inch, pr.billet_diameter_required_inch),
          'die_number', d.die_number, 'planned_kg', j.planned_quantity_kg, 'customer_commitment_date', o.expected_dispatch_date, 'planning_ready', q.planning_ready,
          'gates', g -> 'gates', 'blocker', g -> 'blocker', 'start_ready', (g ->> 'start_ready')::boolean) r
      from public.production_queue_positions q join public.production_jobs j on j.id = q.production_job_id join public.machines m on m.id = q.machine_id
      left join public.orders o on o.id = j.order_id left join public.aluminium_profiles pr on pr.id = j.profile_id left join public.dies d on d.id = j.die_id
      cross join lateral (select private.olo_job_gates(v_company, j.id) g) gg(g)
      where q.company_id = v_company and (v_machine is null or q.machine_id = v_machine)
      order by m.machine_name, q.queue_rank offset (v_page - 1) * 10 limit 10) x;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows,
      'thresholds', jsonb_build_object('billet', s.billet_rank_threshold, 'die', s.die_rank_threshold),
      'presses', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.machine_name, 'capacity_ton', m.press_capacity_ton,
          'queued', (select count(*) from public.production_queue_positions q where q.machine_id = m.id)) order by m.machine_name), '[]'::jsonb)
        from public.machines m where m.company_id = v_company and m.machine_type = 'extrusion_press' and m.is_active),
      'unscheduled', (select jsonb_build_object('count', count(*), 'rows', coalesce(jsonb_agg(jsonb_build_object('job_id', u.id, 'job_number', u.job_number, 'order_number', u.order_number, 'planned_date', u.planned_date)) filter (where u.n <= 10), '[]'::jsonb))
        from (select j.id, j.job_number, o.order_number, j.planned_date, row_number() over (order by j.planned_date nulls last, j.created_at) n
          from public.production_jobs j left join public.orders o on o.id = j.order_id
          where j.company_id = v_company and j.status in ('planned','ready','on_hold') and not exists (select 1 from public.production_queue_positions q where q.production_job_id = j.id)) u));

  elsif p_command = 'readiness.job' then
    perform private.olo_keys(v_payload, array['job_id']);
    return private.olo_job_gates(v_company, (v_payload ->> 'job_id')::uuid)
      || jsonb_build_object('queue', (select to_jsonb(q) - 'company_id' from public.production_queue_positions q where q.production_job_id = (v_payload ->> 'job_id')::uuid and q.company_id = v_company));

  elsif p_command = 'evaluate' then
    perform private.olo_keys(v_payload, '{}');
    if not (v_role = any(private.olo_manager_roles())) then raise exception 'Only managers can run the orchestration check' using errcode = '42501'; end if;
    return private.olo_run_all(v_company, 'manual_check');

  elsif p_command = 'lifecycle.order' then
    perform private.olo_keys(v_payload, array['order_id']);
    v_order := (v_payload ->> 'order_id')::uuid;
    return private.olo_order_core(v_company, v_order, v_finance, true)
      || jsonb_build_object('timeline', private.olo_order_timeline(v_company, v_order, v_finance), 'finance_visible', v_finance,
        'open_tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', t2.id, 'title', t2.title, 'department', t2.workflow_department, 'status', t2.status,
            'due_at', t2.workflow_due_at, 'escalation_level', t2.workflow_escalation_level, 'assignee_name', (select full_name from public.app_users u where u.id = t2.assigned_to)) order by t2.created_at), '[]'::jsonb)
          from public.tasks t2 where t2.company_id = v_company and t2.workflow_order_id = v_order and t2.status in ('open','in_progress')));

  elsif p_command = 'lifecycle.board' then
    perform private.olo_keys(v_payload, array['search','stage','priority','department','page']);
    v_search := nullif(btrim(coalesce(v_payload ->> 'search', '')), '');
    v_dept := nullif(v_payload ->> 'department', '');
    if v_dept is not null and not (v_dept = any(private.olo_departments())) then raise exception 'Unknown department' using errcode = '22023'; end if;
    -- Without a department filter only the requested page is derived; a department filter derives up to 300 orders.
    select coalesce(jsonb_agg(c2.core order by c2.n), '[]'::jsonb), max(c2.total) into v_list, v_total from (
      select private.olo_order_core(v_company, f.id, v_finance, true) core, f.n, f.total from (
        select o.id, row_number() over (order by o.expected_dispatch_date nulls last, o.order_date desc, o.id) n, count(*) over () total
        from public.orders o left join public.customers cu on cu.id = o.customer_id
        where o.company_id = v_company and o.deleted_at is null
          and case coalesce(v_payload ->> 'stage', 'active') when 'active' then o.current_stage not in ('closed','cancelled') when 'all' then true else o.current_stage = v_payload ->> 'stage' end
          and (v_payload ->> 'priority' is null or o.priority = v_payload ->> 'priority')
          and (v_search is null or o.order_number ilike '%' || v_search || '%' or cu.customer_name ilike '%' || v_search || '%' or cu.company_name ilike '%' || v_search || '%')) f
      where (v_dept is null and f.n > (v_page - 1) * 10 and f.n <= v_page * 10) or (v_dept is not null and f.n <= 300)) c2;
    if v_dept is not null then
      select coalesce(jsonb_agg(e order by ord), '[]'::jsonb), count(*) into v_rows, v_total
        from (select e, ord from jsonb_array_elements(v_list) with ordinality x(e, ord) where e -> 'next_action' ->> 'department' = v_dept) f;
      select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into v_rows from (select e, ord from jsonb_array_elements(v_rows) with ordinality y(e, ord)
        where ord > (v_page - 1) * 10 and ord <= v_page * 10) p;
    else
      v_rows := v_list;
    end if;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'capped', v_dept is not null and jsonb_array_length(v_list) >= 300,
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('order', e -> 'order', 'overall', e -> 'overall', 'next_action', e -> 'next_action', 'blocker', e -> 'blocker',
        'risk', e -> 'risk', 'quantities', e -> 'quantities')), '[]'::jsonb) from jsonb_array_elements(v_rows) e));

  elsif p_command = 'lifecycle.summary' then
    perform private.olo_keys(v_payload, '{}');
    return jsonb_build_object(
      'quotes_follow_up_due', (select count(distinct f.quote_id) from public.quote_followup_steps f join public.quotes q on q.id = f.quote_id
        where f.company_id = v_company and f.status in ('pending','task_created') and f.due_date <= private.ist_today() and q.status = 'sent' and q.deleted_at is null),
      'quotes_accepted_awaiting_order', (select count(*) from public.quotes q where q.company_id = v_company and q.status = 'customer_approved' and q.deleted_at is null),
      'orders_awaiting_finance', (select count(distinct h.order_id) from public.order_credit_holds h where h.company_id = v_company and h.status in ('held','rejected')),
      'orders_awaiting_planning', (select count(*) from public.orders o where o.company_id = v_company and o.deleted_at is null and o.current_stage not in ('closed','cancelled','delivered','dispatched','payment_pending')
        and coalesce(o.manufacturing_weight_kg, 0) > 0 and not exists (select 1 from public.production_jobs j where j.order_id = o.id and j.status <> 'cancelled')),
      'orders_billet_shortage', (select count(*) from public.orders o where o.company_id = v_company and o.deleted_at is null and o.current_stage not in ('closed','cancelled') and o.billet_allocation_status in ('shortage','partial')),
      'jobs_awaiting_die_readiness', (select count(*) from public.production_queue_positions q join public.production_jobs j on j.id = q.production_job_id
        where q.company_id = v_company and q.queue_rank <= s.die_rank_threshold and not private.olo_prep_is_prepared(private.olo_prep_live(v_company, j.id), j.die_id)),
      'jobs_blocked_by_die_trial', (select count(*) from public.production_jobs j join public.dies d on d.id = j.die_id where j.company_id = v_company and j.status in ('planned','ready','on_hold')
        and d.die_status in ('design','ordered','received','under_trial','trial','under_correction','correction')),
      'jobs_ready', (select count(*) from public.production_queue_positions q where q.company_id = v_company and q.planning_ready),
      'jobs_running', (select count(*) from public.production_jobs j where j.company_id = v_company and j.status = 'in_progress'),
      'jobs_awaiting_first_qc', (select count(*) from public.production_jobs j where j.company_id = v_company and j.status = 'completed' and j.completed_at > now() - interval '90 days'
        and not exists (select 1 from public.quality_inspections qi where qi.production_job_id = j.id)),
      'qc_hold_kg', (select coalesce(sum(qi.quantity_checked_kg), 0) from public.quality_inspections qi join public.production_jobs j on j.id = qi.production_job_id
        join public.orders o on o.id = j.order_id where qi.company_id = v_company and qi.status in ('pending','rework') and o.current_stage not in ('closed','cancelled')),
      'ageing_in_progress', (select count(*) from public.treatment_batches b where b.company_id = v_company and b.status in ('loaded','running')),
      'ageing_awaiting_review', (select count(*) from public.treatment_batches b where b.company_id = v_company and b.status = 'ended'),
      'dispatches_pending', (select count(*) from public.dispatches d where d.company_id = v_company and d.delivery_status = 'pending'),
      'shipments_in_transit', (select count(*) from public.dispatches d where d.company_id = v_company and d.actual_dispatched_at is not null and d.delivery_status in ('dispatched','in_transit','delayed')),
      'deliveries_unconfirmed_7_days', (select count(*) from public.dispatches d where d.company_id = v_company and d.actual_dispatched_at < now() - interval '7 days' and d.delivery_status in ('dispatched','in_transit','delayed')),
      'orders_partially_fulfilled', (select count(*) from public.orders o where o.company_id = v_company and o.deleted_at is null and o.current_stage not in ('closed','cancelled')
        and exists (select 1 from public.dispatches d where d.order_id = o.id and d.actual_dispatched_at is not null)
        and coalesce(nullif(o.requested_weight_kg, 0), 0) > (select coalesce(sum(coalesce(pl.net_weight_kg, pl.gross_weight_kg - coalesce(pl.tare_weight_kg, 0))), 0) + 1
          from public.packing_list_items pl join public.dispatches d on d.id = pl.dispatch_id where d.order_id = o.id and d.actual_dispatched_at is not null and d.delivery_status <> 'returned')),
      'orders_financially_outstanding', case when v_finance then (select count(distinct i.order_id) from public.invoices i where i.company_id = v_company and i.deleted_at is null and i.balance_due > 0
        and i.status not in ('draft','cancelled') and i.order_id is not null) else null end,
      'workflow_tasks_open', (select count(*) from public.tasks t2 where t2.company_id = v_company and t2.workflow_key is not null and t2.status in ('open','in_progress')),
      'workflow_tasks_overdue', (select count(*) from public.tasks t2 where t2.company_id = v_company and t2.workflow_key is not null and t2.status in ('open','in_progress') and t2.workflow_due_at < clock_timestamp()),
      'workflow_tasks_escalated', (select count(*) from public.tasks t2 where t2.company_id = v_company and t2.workflow_key is not null and t2.status in ('open','in_progress') and t2.workflow_escalation_level > 0),
      'finance_visible', v_finance);
  end if;
  raise exception 'Unknown orchestration command' using errcode = '22023';
end;
$$;
revoke all on function public.olo_command(text, jsonb) from public, anon;
grant execute on function public.olo_command(text, jsonb) to authenticated;

-- Die preparation commands. Each step records who and when; the database checks the die itself, the step order and
-- the preheat values against the approved standard.
create or replace function public.die_preparation_command(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_actor uuid := auth.uid(); v_company uuid := private.get_current_user_company_id(); v_role text := private.get_current_user_role(); v_name text;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb); p public.die_preparations%rowtype; j public.production_jobs%rowtype; d public.dies%rowtype; st public.die_preheat_standards%rowtype;
  v_page integer; v_rows jsonb; v_total bigint; v_status text; v_results jsonb; v_system jsonb; v_failed text[]; v_note text; v_from text; v_to text; v_action text;
  v_temp numeric; v_soak integer; v_busy text; v_slot timestamptz;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users u where u.id = v_actor and u.company_id = v_company and u.is_active and u.role = v_role and u.dealer_id is null;
  if not found or not (v_role = any(private.olo_reader_roles())) then raise exception 'This action is not permitted for your role' using errcode = '42501'; end if;
  if p_command not in ('prep.list','prep.get') and not (v_role = any(private.olo_die_writer_roles())) then raise exception 'Only the tool room and production managers record die preparation' using errcode = '42501'; end if;
  v_page := private.olo_page(v_payload);

  if p_command = 'prep.list' then
    perform private.olo_keys(v_payload, array['status','page']);
    v_status := coalesce(nullif(v_payload ->> 'status', ''), 'live');
    select coalesce(jsonb_agg(x.r order by x.ord), '[]'::jsonb), max(x.total) into v_rows, v_total from (
      select jsonb_build_object('id', p2.id, 'status', p2.status, 'cycle', p2.cycle, 'job_id', p2.production_job_id, 'job_number', j2.job_number, 'job_status', j2.status,
        'order_id', p2.order_id, 'order_number', o.order_number, 'die_id', p2.die_id, 'die_number', d2.die_number, 'die_status', d2.die_status, 'machine_name', m.machine_name,
        'queue_rank', q.queue_rank, 'planned_start_at', q.planned_start_at, 'preheat_scheduled_for', p2.preheat_scheduled_for, 'updated_at', p2.updated_at,
        'hold_expired', private.olo_prep_hold_expired(p2), 'die_matches_job', p2.die_id is not distinct from j2.die_id) r,
        count(*) over () total, row_number() over (order by q.queue_rank nulls last, q.planned_start_at nulls last, p2.created_at) ord
      from public.die_preparations p2 join public.production_jobs j2 on j2.id = p2.production_job_id left join public.orders o on o.id = p2.order_id
      join public.dies d2 on d2.id = p2.die_id left join public.production_queue_positions q on q.production_job_id = p2.production_job_id
      left join public.machines m on m.id = coalesce(q.machine_id, p2.machine_id)
      where p2.company_id = v_company and case v_status when 'live' then p2.status not in ('returned','cancelled') when 'all' then true else p2.status = v_status end
      order by ord offset (v_page - 1) * 10 limit 10) x;
    return jsonb_build_object('page', v_page, 'page_size', 10, 'total', coalesce(v_total, 0), 'rows', v_rows,
      'standards_configured', exists (select 1 from public.die_preheat_standards s where s.company_id = v_company and s.is_active),
      'enforcement', (select jsonb_build_object('die_preparation', x.enforce_die_preparation, 'preheat', x.enforce_preheat) from private.olo_settings_for(v_company) x));
  end if;

  if p_command = 'prep.open' then
    perform private.olo_keys(v_payload, array['job_id']);
    select * into j from public.production_jobs where id = (v_payload ->> 'job_id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Production job is unavailable for this company' using errcode = '23514'; end if;
    if j.status not in ('planned','ready','on_hold') then raise exception 'Die preparation is opened for planned, ready or held jobs only' using errcode = '23514'; end if;
    if j.die_id is null then raise exception 'Assign a die to the job before preparing it' using errcode = '23514'; end if;
    p := private.olo_prep_live(v_company, j.id);
    if p.id is not null then return jsonb_build_object('id', p.id, 'status', p.status, 'existing', true); end if;
    insert into public.die_preparations(company_id, production_job_id, order_id, die_id, machine_id, cycle, status, created_by)
      values (v_company, j.id, j.order_id, j.die_id, j.machine_id, (select coalesce(max(cycle), 0) + 1 from public.die_preparations where production_job_id = j.id), 'required', v_actor)
      returning * into p;
    insert into public.die_preparation_events(company_id, preparation_id, action, to_status, actor_id, actor_name) values (v_company, p.id, 'opened', 'required', v_actor, v_name);
    perform private.olo_verify_tasks(v_company);
    return jsonb_build_object('id', p.id, 'status', p.status, 'existing', false);
  end if;

  select * into p from public.die_preparations where id = (v_payload ->> 'id')::uuid and company_id = v_company for update;
  if not found then raise exception 'Die preparation not found' using errcode = '23514'; end if;
  select * into j from public.production_jobs where id = p.production_job_id;
  select * into d from public.dies where id = p.die_id;

  if p_command = 'prep.get' then
    perform private.olo_keys(v_payload, array['id']);
    select planned_start_at into v_slot from public.production_queue_positions where production_job_id = j.id;
    return to_jsonb(p) - 'company_id' || jsonb_build_object('job_number', j.job_number, 'job_status', j.status, 'job_die_id', j.die_id, 'die_number', d.die_number, 'die_status', d.die_status,
      'die_type', d.die_type, 'die_location', coalesce(d.rack_location, d.storage_bin), 'order_number', (select order_number from public.orders where id = p.order_id),
      'profile_code', (select profile_code from public.aluminium_profiles where id = j.profile_id), 'planned_start_at', v_slot,
      'queue_rank', (select queue_rank from public.production_queue_positions where production_job_id = j.id),
      'machine_name', (select machine_name from public.machines where id = coalesce(j.machine_id, p.machine_id)), 'hold_expired', private.olo_prep_hold_expired(p),
      'standard', (select to_jsonb(s2) - 'company_id' from public.die_preheat_standards s2 where s2.id = coalesce(p.preheat_standard_id,
         (select s3.id from public.die_preheat_standards s3 where s3.company_id = v_company and s3.is_active and (s3.die_type = d.die_type or s3.die_type is null) order by s3.die_type nulls last limit 1))),
      'events', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'from_status', e.from_status, 'to_status', e.to_status, 'actor_name', e.actor_name, 'note', e.note,
         'facts', e.facts, 'occurred_at', e.occurred_at) order by e.occurred_at), '[]'::jsonb) from public.die_preparation_events e where e.preparation_id = p.id),
      'can_write', v_role = any(private.olo_die_writer_roles()));
  end if;

  v_from := p.status;
  if p_command = 'prep.check' then
    perform private.olo_keys(v_payload, array['id','results','note']);
    if p.status not in ('required','blocked','checked') then raise exception 'The die check is recorded before preparation starts' using errcode = '23514'; end if;
    v_results := coalesce(v_payload -> 'results', '{}'::jsonb);
    if jsonb_typeof(v_results) <> 'object' or exists (select 1 from unnest(array['die_present','revision_matches','press_compatible','condition_acceptable','maintenance_complete']) k
        where jsonb_typeof(v_results -> k) is distinct from 'boolean') then
      raise exception 'Answer every die check: present, revision, press compatibility, condition and maintenance' using errcode = '23514';
    end if;
    select other.job_number into v_busy from public.production_jobs other where other.company_id = v_company and other.die_id = p.die_id and other.id <> j.id and other.status = 'in_progress' limit 1;
    v_system := jsonb_build_object('approved_for_profile', d.profile_id is not distinct from j.profile_id and d.die_status in ('active','approved'),
      'die_matches_job', p.die_id is not distinct from j.die_id, 'not_running_elsewhere', v_busy is null);
    select coalesce(array_agg(replace(k, '_', ' ')), '{}') into v_failed from (select key k from jsonb_each(v_results || v_system) where value = 'false'::jsonb) x;
    v_note := nullif(btrim(coalesce(v_payload ->> 'note', '')), '');
    if cardinality(v_failed) > 0 and length(coalesce(v_note, '')) < 5 then raise exception 'Record what is wrong with the die (%)', array_to_string(v_failed, ', ') using errcode = '23514'; end if;
    v_to := case when cardinality(v_failed) = 0 then 'checked' else 'blocked' end;
    update public.die_preparations set status = v_to, check_results = v_results || jsonb_build_object('system', v_system), check_note = v_note,
      checked_by = v_actor, checked_at = clock_timestamp(), updated_at = clock_timestamp() where id = p.id;
    v_action := case when v_to = 'checked' then 'checked' else 'blocked' end;
  elsif p_command = 'prep.start' then
    perform private.olo_keys(v_payload, array['id']);
    if p.status <> 'checked' then raise exception 'Record a passing die check before starting preparation' using errcode = '23514'; end if;
    v_to := 'under_preparation'; v_action := 'preparation_started';
    update public.die_preparations set status = v_to, updated_at = clock_timestamp() where id = p.id;
  elsif p_command = 'prep.prepared' then
    perform private.olo_keys(v_payload, array['id','note']);
    if p.status not in ('checked','under_preparation') then raise exception 'Only a checked die can be recorded as prepared' using errcode = '23514'; end if;
    if p.die_id is distinct from j.die_id then raise exception 'The job now uses a different die; open a new preparation for it' using errcode = '23514'; end if;
    v_note := btrim(coalesce(v_payload ->> 'note', ''));
    if length(v_note) < 5 then raise exception 'Record what was done to prepare the die' using errcode = '23514'; end if;
    v_to := 'prepared'; v_action := 'prepared';
    update public.die_preparations set status = v_to, preparation_note = left(v_note, 500), prepared_by = v_actor, prepared_at = clock_timestamp(), updated_at = clock_timestamp() where id = p.id;
  elsif p_command = 'prep.schedule_preheat' then
    perform private.olo_keys(v_payload, array['id','scheduled_for']);
    if p.status not in ('prepared','ready') and not (p.status = 'preheat_scheduled') then raise exception 'Preheat is scheduled for a prepared die' using errcode = '23514'; end if;
    select * into st from public.die_preheat_standards s2 where s2.company_id = v_company and s2.is_active and (s2.die_type = d.die_type or s2.die_type is null)
      order by s2.die_type nulls last limit 1;
    if not found then raise exception 'No approved die preheat standard covers this die type. A manager must add one in orchestration settings first.' using errcode = '23514'; end if;
    if (v_payload ->> 'scheduled_for') is null or (v_payload ->> 'scheduled_for')::timestamptz < clock_timestamp() - interval '2 hours' then
      raise exception 'Choose when preheating will start' using errcode = '23514';
    end if;
    v_to := 'preheat_scheduled'; v_action := 'preheat_scheduled';
    update public.die_preparations set status = v_to, preheat_standard_id = st.id, preheat_scheduled_for = (v_payload ->> 'scheduled_for')::timestamptz, preheat_scheduled_by = v_actor,
      preheat_started_at = null, preheat_started_by = null, preheat_completed_at = null, preheat_completed_by = null, preheat_temperature_c = null, preheat_soak_minutes = null,
      updated_at = clock_timestamp() where id = p.id;
  elsif p_command = 'prep.start_preheat' then
    perform private.olo_keys(v_payload, array['id','oven_reference']);
    if p.status <> 'preheat_scheduled' then raise exception 'Schedule the preheat before starting it' using errcode = '23514'; end if;
    if length(btrim(coalesce(v_payload ->> 'oven_reference', ''))) < 1 then raise exception 'Record the die oven used' using errcode = '23514'; end if;
    v_to := 'preheating'; v_action := 'preheat_started';
    update public.die_preparations set status = v_to, oven_reference = left(btrim(v_payload ->> 'oven_reference'), 60), preheat_started_at = clock_timestamp(), preheat_started_by = v_actor,
      updated_at = clock_timestamp() where id = p.id;
  elsif p_command = 'prep.complete_preheat' then
    perform private.olo_keys(v_payload, array['id','temperature_c','soak_minutes']);
    if p.status <> 'preheating' then raise exception 'Only a die that is preheating can complete preheat' using errcode = '23514'; end if;
    select * into st from public.die_preheat_standards where id = p.preheat_standard_id;
    v_temp := (v_payload ->> 'temperature_c')::numeric; v_soak := (v_payload ->> 'soak_minutes')::integer;
    if v_temp is null or v_soak is null then raise exception 'Record the measured die temperature and the soak time' using errcode = '23514'; end if;
    if v_temp < st.min_temperature_c or v_temp > st.max_temperature_c then
      raise exception 'Die temperature % °C is outside the approved %–% °C (%). Correct the preheat before completing it.', trim_scale(v_temp), trim_scale(st.min_temperature_c), trim_scale(st.max_temperature_c), st.sop_reference using errcode = '23514';
    end if;
    if v_soak < st.min_soak_minutes then
      raise exception 'Soak of % minutes is shorter than the approved % minutes (%).', v_soak, st.min_soak_minutes, st.sop_reference using errcode = '23514';
    end if;
    if v_soak > extract(epoch from (clock_timestamp() - p.preheat_started_at)) / 60 + 1 then
      raise exception 'The recorded soak is longer than the time since preheating started' using errcode = '23514';
    end if;
    v_to := 'ready'; v_action := 'preheat_completed';
    update public.die_preparations set status = v_to, preheat_temperature_c = v_temp, preheat_soak_minutes = v_soak, preheat_completed_at = clock_timestamp(), preheat_completed_by = v_actor,
      updated_at = clock_timestamp() where id = p.id;
  elsif p_command = 'prep.return' then
    perform private.olo_keys(v_payload, array['id','condition']);
    if p.status <> 'issued' then raise exception 'Only a die issued to the press is returned' using errcode = '23514'; end if;
    if j.status = 'in_progress' then raise exception 'The job is still running on this die' using errcode = '23514'; end if;
    v_note := btrim(coalesce(v_payload ->> 'condition', ''));
    if length(v_note) < 5 then raise exception 'Record the die condition on return' using errcode = '23514'; end if;
    v_to := 'returned'; v_action := 'returned';
    update public.die_preparations set status = v_to, returned_at = clock_timestamp(), returned_by = v_actor, return_condition = left(v_note, 300), updated_at = clock_timestamp() where id = p.id;
  elsif p_command = 'prep.cancel' then
    perform private.olo_keys(v_payload, array['id','reason']);
    if not (v_role = any(private.olo_manager_roles())) then raise exception 'Only managers can cancel a die preparation' using errcode = '42501'; end if;
    if p.status in ('issued','returned','cancelled') then raise exception 'An issued, returned or cancelled preparation cannot be cancelled' using errcode = '23514'; end if;
    v_note := btrim(coalesce(v_payload ->> 'reason', ''));
    if length(v_note) < 5 then raise exception 'Record why the preparation is cancelled' using errcode = '23514'; end if;
    v_to := 'cancelled'; v_action := 'cancelled';
    update public.die_preparations set status = v_to, cancelled_at = clock_timestamp(), cancelled_by = v_actor, cancel_reason = left(v_note, 300), updated_at = clock_timestamp() where id = p.id;
  else
    raise exception 'Unknown die preparation command' using errcode = '22023';
  end if;

  insert into public.die_preparation_events(company_id, preparation_id, action, from_status, to_status, actor_id, actor_name, note, facts)
    values (v_company, p.id, v_action, v_from, v_to, v_actor, v_name, coalesce(v_note, case when p_command = 'prep.start_preheat' then 'Oven ' || btrim(v_payload ->> 'oven_reference') end),
      case p_command when 'prep.check' then jsonb_build_object('failed', to_jsonb(v_failed))
        when 'prep.complete_preheat' then jsonb_build_object('temperature_c', v_temp, 'soak_minutes', v_soak, 'standard', st.sop_reference)
        when 'prep.schedule_preheat' then jsonb_build_object('scheduled_for', v_payload ->> 'scheduled_for', 'standard', st.sop_reference) else '{}'::jsonb end);
  perform private.olo_event(v_company, 'die.' || v_action, p.order_id, p.production_job_id, 'tool_room',
    format('Die %s: %s for job %s', d.die_number, replace(v_action, '_', ' '), coalesce(j.job_number, '-')), jsonb_build_object('preparation_id', p.id, 'status', v_to), null);
  perform private.olo_verify_tasks(v_company);
  perform private.olo_refresh_readiness(v_company);
  return jsonb_build_object('id', p.id, 'status', v_to);
end;
$$;
revoke all on function public.die_preparation_command(text, jsonb) from public, anon;
grant execute on function public.die_preparation_command(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security (reads only; every write goes through the functions above)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.olo_settings enable row level security;
alter table public.olo_department_roles enable row level security;
alter table public.olo_events enable row level security;
alter table public.olo_engine_errors enable row level security;
alter table public.production_queue_positions enable row level security;
alter table public.production_queue_rank_events enable row level security;
alter table public.olo_task_events enable row level security;
alter table public.die_preheat_standards enable row level security;
alter table public.die_preparations enable row level security;
alter table public.die_preparation_events enable row level security;
revoke all on public.olo_settings, public.olo_department_roles, public.olo_events, public.olo_engine_errors, public.production_queue_positions,
  public.production_queue_rank_events, public.olo_task_events, public.die_preheat_standards, public.die_preparations, public.die_preparation_events from public, anon, authenticated;
grant select on public.olo_settings, public.olo_department_roles, public.olo_events, public.production_queue_positions, public.production_queue_rank_events,
  public.olo_task_events, public.die_preheat_standards, public.die_preparations, public.die_preparation_events to authenticated;
grant select on public.olo_engine_errors to authenticated;

create policy olo_settings_read on public.olo_settings for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy olo_department_roles_read on public.olo_department_roles for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy olo_events_read on public.olo_events for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy olo_engine_errors_read on public.olo_engine_errors for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_manager_roles()));
create policy production_queue_positions_read on public.production_queue_positions for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy production_queue_rank_events_read on public.production_queue_rank_events for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy olo_task_events_read on public.olo_task_events for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy die_preheat_standards_read on public.die_preheat_standards for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy die_preparations_read on public.die_preparations for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));
create policy die_preparation_events_read on public.die_preparation_events for select to authenticated using (company_id = private.get_current_user_company_id()
  and private.get_current_user_dealer_id() is null and private.get_current_user_role() = any(private.olo_reader_roles()));

-- ---------------------------------------------------------------------------------------------------------------
-- Hourly job: queue, material risk, verification and escalation (pg_cron calls private.ap_jobs_run('hourly'))
-- ---------------------------------------------------------------------------------------------------------------
alter function private.ap_job_registry() rename to olo_previous_job_registry;
create function private.ap_job_registry() returns table(job_key text, schedule text, label text, description text)
language sql immutable set search_path = public, private as $$
  select * from private.olo_previous_job_registry() union all values
    ('orchestration.hourly', 'hourly', 'Order lifecycle orchestration', 'Re-derives press queue ranks, opens billet and die work for jobs entering the top of the queue, forecasts billet shortages, closes verified tasks and escalates unacknowledged or overdue work.')
$$;
revoke all on function private.ap_job_registry() from public, anon, authenticated;

alter function private.ap_job_execute(uuid, text, uuid) rename to olo_previous_job_execute;
create function private.ap_job_execute(p_company uuid, p_job text, p_run uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v jsonb;
begin
  if p_job = 'orchestration.hourly' then
    v := private.olo_run_all(p_company, 'scheduled_check');
    return jsonb_build_object('examined', coalesce((v ->> 'rank_changes')::integer, 0), 'proposals', coalesce((v ->> 'tasks_created')::integer, 0) + coalesce((v ->> 'shortage_tasks')::integer, 0),
      'alerts', coalesce((v ->> 'escalated')::integer, 0), 'details', v);
  end if;
  return private.olo_previous_job_execute(p_company, p_job, p_run);
end;
$$;
revoke all on function private.ap_job_execute(uuid, text, uuid) from public, anon, authenticated;

-- First evaluation of the existing queue.
do $$
declare c record;
begin
  perform set_config('olo.engine', 'running', true);
  for c in select id from public.companies loop
    begin
      perform private.olo_run_all(c.id, 'scheduled_check');
    exception when others then
      insert into public.olo_engine_errors(company_id, source, message) values (c.id, 'migration:first_evaluation', left(sqlerrm, 500));
    end;
  end loop;
  perform set_config('olo.engine', '', true);
end;
$$;

commit;
