-- Autopilot batch 2 (AUTOPILOT_UPGRADES.md, "Press floor capture"): AP-011 one tap per billet, AP-012 expected output
-- from the cut plan, AP-013 engineering scrap, AP-014 idle press reasons, AP-015 die changes from the job sequence,
-- AP-016 quality sampling from output, AP-028 die service prediction, AP-054 preventive maintenance from running hours,
-- AP-066 shift targets from the plan (AP-087 is a front-end keypad and needs no schema).
--
-- Additive only. Builds on batch 1 (proposals, scheduled jobs, factory calendar) and replaces batch 1 function bodies
-- with the same signatures to register the new jobs and proposal types. Every new table carries company_id with RLS and
-- a company index; clients read and write only through security-definer functions that take the company and the actor
-- from the session. Push events are append-only (a mistaken tap is voided by a later event). Nothing here posts stock,
-- approves quality or messages a customer by itself: completion from expected output runs only when a person accepts the
-- proposal, and it calls the existing completion transaction with its mass-balance check. Messages for people start 'AP: '.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- Extend batch 1 and earlier check lists (supersets only)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.proposals drop constraint if exists proposals_proposal_type_check;
alter table public.proposals add constraint proposals_proposal_type_check check (proposal_type in (
  'navigation.role_layout', 'period.close_month', 'series.adopt',
  'production.expected_output', 'die.service_due', 'maintenance.pm_due'));
create index if not exists proposals_target_idx on public.proposals(company_id, proposal_type, target_key, created_at desc);

alter table public.die_service_thresholds drop constraint if exists die_service_thresholds_basis_check;
alter table public.die_service_thresholds add constraint die_service_thresholds_basis_check
  check (basis in ('kg_since_service', 'runs_since_service', 'days_since_service', 'pushes_since_service'));

-- AP-013: scrap lines say whether they are engineering scrap (butt, crops, saw, cut-off) or process scrap, and whether the
-- weight was derived from approved standards or entered by a person. Existing rows stay null (not known).
alter table public.production_scrap_lines add column if not exists scrap_kind text check (scrap_kind in ('engineering', 'process'));
alter table public.production_scrap_lines add column if not exists scrap_basis text check (scrap_basis in ('derived', 'entered'));

create or replace function private.ap2_type_scrap_line()
returns trigger language plpgsql set search_path = public, private as $$
begin
  if new.scrap_kind is null then
    new.scrap_kind := case when new.category in ('butt_end', 'front_back_end', 'saw_cut') then 'engineering'
      when new.category in ('rejects', 'unrecoverable_loss') then 'process' end;
  end if;
  if new.scrap_basis is null then
    new.scrap_basis := case when current_setting('ap.scrap_basis', true) = 'derived' and new.category in ('butt_end', 'front_back_end', 'saw_cut') then 'derived' else 'entered' end;
  end if;
  return new;
end;
$$;
revoke all on function private.ap2_type_scrap_line() from public, anon, authenticated;
drop trigger if exists ap2_type_scrap_line on public.production_scrap_lines;
create trigger ap2_type_scrap_line before insert on public.production_scrap_lines for each row execute function private.ap2_type_scrap_line();

-- ---------------------------------------------------------------------------------------------------------------
-- AP-014 / AP-066: per-press floor settings
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.press_floor_settings (
  company_id uuid not null references public.companies(id) on delete cascade,
  machine_id uuid not null references public.machines(id) on delete cascade,
  idle_gap_minutes integer not null default 8 check (idle_gap_minutes between 2 and 240),
  die_change_allowance_minutes integer not null default 45 check (die_change_allowance_minutes between 0 and 480),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (company_id, machine_id)
);
create index if not exists press_floor_settings_machine_idx on public.press_floor_settings(machine_id);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-013: engineering scrap standards (owner-approved, versioned per company, press or die)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.scrap_standards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machine_id uuid references public.machines(id),
  die_id uuid references public.dies(id),
  version integer not null check (version >= 1),
  butt_length_mm numeric(8, 2) not null check (butt_length_mm > 0 and butt_length_mm <= 200),
  front_crop_mm numeric(8, 1) not null check (front_crop_mm >= 0 and front_crop_mm <= 5000),
  back_crop_mm numeric(8, 1) not null check (back_crop_mm >= 0 and back_crop_mm <= 5000),
  saw_kerf_mm numeric(6, 2) not null check (saw_kerf_mm >= 0 and saw_kerf_mm <= 20),
  density_kg_m3 numeric(7, 1) not null default 2700 check (density_kg_m3 between 2500 and 2900),
  default_billet_length_mm numeric(8, 1) check (default_billet_length_mm is null or default_billet_length_mm between 100 and 2000),
  rationale text not null check (length(btrim(rationale)) between 5 and 500),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'retired')),
  proposed_by uuid not null references auth.users(id),
  proposed_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  retired_by uuid references auth.users(id),
  retired_at timestamptz,
  check (status <> 'approved' or approved_at is not null),
  check (status <> 'proposed' or approved_at is null),
  check ((status = 'retired') = (retired_at is not null)),
  check (die_id is null or machine_id is null)
);
create index if not exists scrap_standards_company_idx on public.scrap_standards(company_id, status, proposed_at desc);
create unique index if not exists scrap_standards_one_approved on public.scrap_standards(company_id,
  coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(die_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'approved';
create unique index if not exists scrap_standards_version on public.scrap_standards(company_id,
  coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(die_id, '00000000-0000-0000-0000-000000000000'::uuid), version);

-- What was derived at each completion from expected output (the monthly reconciliation reads this).
create table if not exists public.production_scrap_derivations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id),
  proposal_id uuid references public.proposals(id),
  standard_id uuid references public.scrap_standards(id),
  standard_version integer,
  pushes integer not null check (pushes >= 0),
  billet_kg numeric(14, 3) not null check (billet_kg >= 0),
  butt_kg numeric(14, 3) not null check (butt_kg >= 0),
  crop_kg numeric(14, 3) not null check (crop_kg >= 0),
  saw_kg numeric(14, 3) not null check (saw_kg >= 0),
  cutoff_kg numeric(14, 3) not null check (cutoff_kg >= 0),
  reject_kg numeric(14, 3) not null check (reject_kg >= 0),
  reject_pieces integer not null check (reject_pieces >= 0),
  reject_reason text,
  good_kg numeric(14, 3) not null check (good_kg > 0),
  good_pieces integer not null check (good_pieces >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (production_job_id)
);
create index if not exists production_scrap_derivations_company_idx on public.production_scrap_derivations(company_id, created_at desc);

-- Scrap weighed at the scrap yard, per month (reconciled against derived scrap).
create table if not exists public.scrap_yard_weighings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  weighed_kg numeric(14, 3) not null check (weighed_kg > 0 and weighed_kg <= 100000000),
  reference text check (reference is null or length(reference) between 1 and 80),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);
create index if not exists scrap_yard_weighings_company_idx on public.scrap_yard_weighings(company_id, month);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-011: one push per billet, append-only
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.production_push_events (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id),
  machine_id uuid not null references public.machines(id),
  die_id uuid references public.dies(id),
  kind text not null check (kind in ('push', 'void')),
  voids_event_id uuid unique references public.production_push_events(id),
  reason text check (reason is null or length(reason) between 3 and 300),
  source text not null check (source in ('tap', 'backfill', 'undo', 'supervisor')),
  seq integer check (seq is null or seq >= 1),
  workstation_session_id uuid references public.workstation_sessions(id),
  operator_id uuid not null references auth.users(id),
  billet_id uuid references public.foundry_billets(id),
  billet_kg numeric(12, 3) check (billet_kg is null or billet_kg > 0),
  billet_kg_basis text check (billet_kg_basis in ('linked_billet', 'estimated')),
  billet_diameter_mm numeric(8, 2),
  event_at timestamptz not null,
  client_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  check ((kind = 'push') = (seq is not null)),
  check ((kind = 'void') = (voids_event_id is not null)),
  check (kind = 'push' or (billet_id is null and billet_kg is null)),
  check ((billet_kg is null) = (billet_kg_basis is null)),
  unique (production_job_id, seq)
);
create index if not exists push_events_company_idx on public.production_push_events(company_id, event_at desc);
create index if not exists push_events_machine_idx on public.production_push_events(company_id, machine_id, event_at);
create index if not exists push_events_die_idx on public.production_push_events(company_id, die_id, event_at);
create index if not exists push_events_job_idx on public.production_push_events(production_job_id, seq);
create index if not exists push_events_billet_idx on public.production_push_events(billet_id) where billet_id is not null;

create or replace function private.ap2_push_events_append_only()
returns trigger language plpgsql set search_path = public, private as $$
begin
  raise exception 'AP: Push events cannot be changed or deleted. Void a mistaken push instead.' using errcode = '42501';
end;
$$;
revoke all on function private.ap2_push_events_append_only() from public, anon, authenticated;
drop trigger if exists ap2_push_events_append_only on public.production_push_events;
create trigger ap2_push_events_append_only before update or delete on public.production_push_events
  for each row execute function private.ap2_push_events_append_only();

-- ---------------------------------------------------------------------------------------------------------------
-- AP-014: idle intervals between pushes (reason chosen by a person; never assigned by the system)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.press_idle_intervals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machine_id uuid not null references public.machines(id),
  production_job_id uuid references public.production_jobs(id),
  gap_start timestamptz not null,
  gap_end timestamptz check (gap_end is null or gap_end > gap_start),
  reason text check (reason in ('die_change', 'billet_shortage', 'power', 'breakdown', 'waiting_qc', 'no_operator', 'other')),
  suggested_reason text check (suggested_reason in ('die_change')),
  note text check (note is null or length(note) between 3 and 300),
  source text not null check (source in ('operator', 'reconciliation')),
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check ((reason is null) = (answered_by is null)),
  unique (company_id, machine_id, gap_start)
);
create index if not exists press_idle_company_idx on public.press_idle_intervals(company_id, gap_start desc);
create index if not exists press_idle_open_idx on public.press_idle_intervals(company_id, machine_id) where gap_end is null;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-015: die changes derived from the job sequence on a press
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.press_die_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machine_id uuid not null references public.machines(id),
  from_die_id uuid references public.dies(id),
  to_die_id uuid references public.dies(id),
  from_job_id uuid not null references public.production_jobs(id),
  to_job_id uuid not null references public.production_jobs(id),
  last_push_at timestamptz not null,
  first_push_at timestamptz not null check (first_push_at >= last_push_at),
  duration_seconds integer not null check (duration_seconds >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (to_job_id)
);
create index if not exists press_die_changes_company_idx on public.press_die_changes(company_id, machine_id, first_push_at desc);

-- Corrections and notes are appended; the read model uses the latest corrected duration.
create table if not exists public.press_die_change_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  die_change_id uuid not null references public.press_die_changes(id),
  corrected_duration_seconds integer check (corrected_duration_seconds is null or corrected_duration_seconds between 0 and 86400),
  note text not null check (length(btrim(note)) between 3 and 300),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists press_die_change_corrections_idx on public.press_die_change_corrections(company_id, die_change_id, created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-016: sampling triggers on approved inspection plans, and the samples they require
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.inspection_sampling_triggers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plan_id uuid not null references public.inspection_plans(id),
  kind text not null check (kind in ('first_after_die_change', 'every_n_pushes', 'every_n_bundles', 'last_piece')),
  every_n integer check (every_n is null or every_n between 1 and 10000),
  item_ids uuid[],
  blocks_release boolean not null default false,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  retired_by uuid references auth.users(id),
  retired_at timestamptz,
  check ((kind in ('every_n_pushes', 'every_n_bundles')) = (every_n is not null)),
  check ((status = 'retired') = (retired_at is not null))
);
create index if not exists sampling_triggers_company_idx on public.inspection_sampling_triggers(company_id, plan_id, status);

create table if not exists public.qc_sample_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id),
  trigger_id uuid not null references public.inspection_sampling_triggers(id),
  plan_id uuid not null references public.inspection_plans(id),
  kind text not null,
  occurrence_key text not null check (length(occurrence_key) between 1 and 80),
  at_push integer,
  window_push integer,
  window_ends_at timestamptz,
  due_at timestamptz not null default clock_timestamp(),
  blocks_release boolean not null,
  status text not null default 'open' check (status in ('open', 'missed', 'recorded', 'waived')),
  recorded_late boolean,
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz,
  missed_at timestamptz,
  waived_by uuid references auth.users(id),
  waived_at timestamptz,
  waive_reason text check (waive_reason is null or length(waive_reason) between 8 and 300),
  unique (production_job_id, trigger_id, occurrence_key),
  check ((status = 'recorded') = (recorded_at is not null)),
  check ((status = 'waived') = (waived_at is not null))
);
create index if not exists qc_samples_company_idx on public.qc_sample_requirements(company_id, status, due_at);
create index if not exists qc_samples_job_idx on public.qc_sample_requirements(production_job_id);

create table if not exists public.qc_sample_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  requirement_id uuid not null references public.qc_sample_requirements(id),
  item_id uuid not null references public.inspection_plan_items(id),
  observed numeric,
  visual_ok boolean,
  outcome text not null check (outcome in ('pass', 'fail')),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  check ((observed is null) <> (visual_ok is null)),
  unique (requirement_id, item_id)
);
create index if not exists qc_sample_results_company_idx on public.qc_sample_results(company_id, requirement_id);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-028: die service bookings made from a due proposal
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.die_service_bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  die_id uuid not null references public.dies(id),
  service_event text not null check (service_event in ('nitriding', 'correction')),
  scheduled_for date not null,
  proposal_id uuid references public.proposals(id),
  status text not null default 'booked' check (status in ('booked', 'done', 'cancelled')),
  booked_by uuid not null references auth.users(id),
  booked_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  close_note text check (close_note is null or length(close_note) between 3 and 300),
  check ((status = 'booked') = (closed_at is null))
);
create unique index if not exists die_service_one_booked on public.die_service_bookings(company_id, die_id, service_event) where status = 'booked';
create index if not exists die_service_bookings_company_idx on public.die_service_bookings(company_id, status, scheduled_for);

-- ---------------------------------------------------------------------------------------------------------------
-- AP-054: preventive maintenance plans on press counters, and their work orders
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.pm_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machine_id uuid not null references public.machines(id),
  asset_kind text not null check (asset_kind in ('press', 'puller', 'saw', 'container', 'billet_heater', 'stretcher', 'other')),
  asset_label text check (asset_label is null or length(asset_label) between 2 and 80),
  task text not null check (length(btrim(task)) between 3 and 120),
  basis text not null check (basis in ('running_hours', 'pushes')),
  interval_value numeric(12, 2) not null check (interval_value > 0 and interval_value <= 1000000),
  window_hours numeric(5, 2) not null default 2 check (window_hours > 0 and window_hours <= 72),
  safety_critical boolean not null default false,
  counter_start_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  retired_by uuid references auth.users(id),
  retired_at timestamptz,
  check ((status = 'retired') = (retired_at is not null))
);
create index if not exists pm_plans_company_idx on public.pm_plans(company_id, status, machine_id);

create table if not exists public.pm_work_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plan_id uuid not null references public.pm_plans(id),
  proposal_id uuid references public.proposals(id),
  maintenance_block_id uuid references public.factory_maintenance_blocks(id),
  window_start timestamptz,
  window_end timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'dismissed')),
  counter_at_schedule numeric(14, 2),
  counter_at_done numeric(14, 2),
  done_at timestamptz,
  done_note text check (done_note is null or length(done_note) between 3 and 300),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_by uuid references auth.users(id),
  check ((status = 'done') = (done_at is not null)),
  check (window_end is null or window_end > window_start)
);
create unique index if not exists pm_one_scheduled on public.pm_work_orders(company_id, plan_id) where status = 'scheduled';
create index if not exists pm_work_orders_company_idx on public.pm_work_orders(company_id, plan_id, created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- RLS for every new table: company-scoped reads for permitted roles; no client writes (functions write).
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare t text; r text;
begin
  foreach t in array array['press_floor_settings', 'scrap_standards', 'production_scrap_derivations', 'scrap_yard_weighings', 'production_push_events',
    'press_idle_intervals', 'press_die_changes', 'press_die_change_corrections', 'inspection_sampling_triggers', 'qc_sample_requirements',
    'qc_sample_results', 'die_service_bookings', 'pm_plans', 'pm_work_orders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'ap2 company read', t);
    r := case when t in ('inspection_sampling_triggers', 'qc_sample_requirements', 'qc_sample_results')
        then 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''production'',''quality'']'
      else 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''production'',''quality'',''inventory_manager'']' end;
    execute format('create policy %I on public.%I for select to authenticated using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) = any(%s))',
      'ap2 company read', t, r);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------------------------
-- Pushes that count: push events not voided by a later event.
create or replace view private.ap2_pushes as
  select p.* from public.production_push_events p
  where p.kind = 'push' and not exists (select 1 from public.production_push_events v where v.voids_event_id = p.id);
revoke all on private.ap2_pushes from public, anon, authenticated;

create or replace function private.ap2_num(p_payload jsonb, p_key text, p_label text, p_min numeric, p_max numeric, p_required boolean default true)
returns numeric language plpgsql immutable set search_path = public, private as $$
declare v text := nullif(btrim(coalesce(p_payload ->> p_key, '')), ''); n numeric;
begin
  if v is null then
    if p_required then raise exception 'AP: Enter %.', p_label; end if;
    return null;
  end if;
  if v !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'AP: % must be a number.', p_label; end if;
  n := v::numeric;
  if n < p_min or n > p_max then raise exception 'AP: % must be between % and %.', p_label, trim_scale(p_min), trim_scale(p_max); end if;
  return n;
end;
$$;
revoke all on function private.ap2_num(jsonb, text, text, numeric, numeric, boolean) from public, anon, authenticated;

create or replace function private.ap2_floor_roles() returns text[] language sql immutable set search_path = public, private as $$ select array['owner', 'admin', 'factory_manager', 'production_manager', 'production'] $$;
create or replace function private.ap2_supervisor_roles() returns text[] language sql immutable set search_path = public, private as $$ select array['owner', 'admin', 'factory_manager', 'production_manager'] $$;
create or replace function private.ap2_quality_roles() returns text[] language sql immutable set search_path = public, private as $$ select array['owner', 'admin', 'quality', 'factory_manager'] $$;
revoke all on function private.ap2_floor_roles() from public, anon, authenticated;
revoke all on function private.ap2_supervisor_roles() from public, anon, authenticated;
revoke all on function private.ap2_quality_roles() from public, anon, authenticated;

create or replace function private.ap2_machine_name(p_machine uuid)
returns text language sql stable security definer set search_path = public, private as $$
  select coalesce(nullif(btrim(m.machine_name), ''), m.machine_code, 'Press') from public.machines m where m.id = p_machine
$$;
revoke all on function private.ap2_machine_name(uuid) from public, anon, authenticated;

create or replace function private.ap2_settings(p_company uuid, p_machine uuid)
returns table(idle_gap_minutes integer, die_change_allowance_minutes integer, configured boolean)
language sql stable security definer set search_path = public, private as $$
  select coalesce(s.idle_gap_minutes, 8), coalesce(s.die_change_allowance_minutes, 45), s.machine_id is not null
  from (select 1) one left join public.press_floor_settings s on s.company_id = p_company and s.machine_id = p_machine
$$;
revoke all on function private.ap2_settings(uuid, uuid) from public, anon, authenticated;

-- AP-013: the approved standard that applies to a job: die-specific, then press-specific, then the company default.
create or replace function private.ap2_standard(p_company uuid, p_machine uuid, p_die uuid)
returns public.scrap_standards language sql stable security definer set search_path = public, private as $$
  select s.* from public.scrap_standards s
  where s.company_id = p_company and s.status = 'approved'
    and ((s.die_id = p_die) or (s.die_id is null and s.machine_id = p_machine) or (s.die_id is null and s.machine_id is null))
  order by (s.die_id is null), (s.machine_id is null) limit 1
$$;
revoke all on function private.ap2_standard(uuid, uuid, uuid) from public, anon, authenticated;

-- Section weight (kg/m), cut length (m), pieces per bundle and billet diameter of a job; null when not captured.
create or replace function private.ap2_job_geometry(p_job uuid)
returns table(kg_per_m numeric, cut_m numeric, pieces_per_bundle integer, billet_diameter_mm numeric)
language sql stable security definer set search_path = public, private as $$
  select nullif(coalesce(nullif(j.section_weight_kg_per_m, 0), nullif(p.actual_weight_kg_per_m, 0), nullif(p.section_weight_kg_per_m, 0)), 0),
    nullif(coalesce(nullif(j.length_per_piece_m, 0), nullif(j.cl_meter, 0)), 0),
    nullif(coalesce(nullif(floor(j.pieces_per_bundle), 0)::integer, nullif(p.pieces_per_bundle, 0)), 0),
    nullif(coalesce(nullif(p.billet_diameter_mm, 0), nullif(p.billet_diameter_required_inch, 0) * 25.4, nullif(d.billet_diameter_required_inch, 0) * 25.4), 0)
  from public.production_jobs j
  left join public.aluminium_profiles p on p.id = j.profile_id and p.company_id = j.company_id
  left join public.dies d on d.id = j.die_id and d.company_id = j.company_id
  where j.id = p_job
$$;
revoke all on function private.ap2_job_geometry(uuid) from public, anon, authenticated;

-- AP-012 / AP-013: what one billet yields under a scrap standard. Mirrored by lib/calculations/press-output.ts (a test
-- compares them). Every part is null when an input is missing, so an unknown never becomes zero.
--   butt    = butt length x billet cross-section x density
--   crops   = (front + back crop length) x kg/m
--   pieces  = whole cut lengths (plus one saw kerf each) in what remains
--   saw     = pieces x kerf x kg/m
--   cut-off = the remainder, so butt + crops + saw + good + cut-off = billet kg exactly
create or replace function private.ap2_push_yield(p_billet_kg numeric, p_diameter_mm numeric, p_kg_per_m numeric, p_cut_m numeric,
  p_butt_mm numeric, p_front_mm numeric, p_back_mm numeric, p_kerf_mm numeric, p_density numeric)
returns table(butt_kg numeric, crop_kg numeric, saw_kg numeric, good_kg numeric, cutoff_kg numeric, pieces integer)
language plpgsql immutable set search_path = public, private as $$
declare v_butt numeric; v_ext numeric; v_crop numeric; v_usable numeric; v_pieces integer; v_saw numeric; v_good numeric;
begin
  if p_billet_kg is null or p_diameter_mm is null or p_kg_per_m is null or p_cut_m is null or p_butt_mm is null or p_density is null
    or p_billet_kg <= 0 or p_diameter_mm <= 0 or p_kg_per_m <= 0 or p_cut_m <= 0 then
    return query select null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::integer; return;
  end if;
  v_butt := round(least(p_billet_kg, pi()::numeric / 4 * p_diameter_mm * p_diameter_mm * p_butt_mm * p_density / 1e9), 3);
  v_ext := p_billet_kg - v_butt;
  v_crop := round(least(v_ext, (coalesce(p_front_mm, 0) + coalesce(p_back_mm, 0)) / 1000 * p_kg_per_m), 3);
  v_usable := greatest(0, (v_ext - v_crop) / p_kg_per_m);
  v_pieces := floor(v_usable / (p_cut_m + coalesce(p_kerf_mm, 0) / 1000) + 1e-9)::integer;
  v_saw := round(v_pieces * coalesce(p_kerf_mm, 0) / 1000 * p_kg_per_m, 3);
  v_good := round(v_pieces * p_cut_m * p_kg_per_m, 3);
  if v_butt + v_crop + v_saw + v_good > p_billet_kg then v_good := p_billet_kg - v_butt - v_crop - v_saw; end if;
  return query select v_butt, v_crop, v_saw, v_good, round(p_billet_kg - v_butt - v_crop - v_saw - v_good, 3), v_pieces;
end;
$$;
revoke all on function private.ap2_push_yield(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- Estimated billet weight from the standard's billet length when no billet is linked (always labelled "estimated").
create or replace function private.ap2_estimated_billet_kg(p_diameter_mm numeric, p_length_mm numeric, p_density numeric)
returns numeric language sql immutable set search_path = public, private as $$
  select case when p_diameter_mm > 0 and p_length_mm > 0 and p_density > 0 then round(pi()::numeric / 4 * p_diameter_mm * p_diameter_mm * p_length_mm * p_density / 1e9, 3) end
$$;
revoke all on function private.ap2_estimated_billet_kg(numeric, numeric, numeric) from public, anon, authenticated;

-- Running seconds of a press between two instants: the sum of gaps between consecutive pushes no longer than the press's
-- idle threshold (a longer gap is idle time, not running time).
create or replace function private.ap2_runtime(p_company uuid, p_machine uuid, p_from timestamptz, p_to timestamptz)
returns table(running_seconds numeric, pushes bigint)
language sql stable security definer set search_path = public, private as $$
  with p as (select x.event_at, lag(x.event_at) over (order by x.event_at, x.id) prev from private.ap2_pushes x
    where x.company_id = p_company and x.machine_id = p_machine and x.event_at >= p_from and x.event_at < p_to)
  select coalesce(sum(extract(epoch from p.event_at - p.prev)) filter (where p.prev is not null
      and p.event_at - p.prev <= make_interval(mins => (select s.idle_gap_minutes from private.ap2_settings(p_company, p_machine) s))), 0)::numeric,
    count(*) from p
$$;
revoke all on function private.ap2_runtime(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- AP-066: the shift containing an instant, from the factory calendar's shift list (IST times; a shift may cross midnight).
create or replace function private.ap2_shift_window(p_company uuid, p_at timestamptz)
returns table(code text, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
declare v_shifts jsonb; s jsonb; v_day date := (p_at at time zone 'Asia/Kolkata')::date; d date; v_start timestamptz; v_end timestamptz;
begin
  select coalesce((select x.shifts from public.factory_calendar_settings x where x.company_id = p_company),
    '[{"code":"A","start":"06:00","end":"14:00"},{"code":"B","start":"14:00","end":"22:00"},{"code":"C","start":"22:00","end":"06:00"}]'::jsonb) into v_shifts;
  foreach d in array array[v_day - 1, v_day] loop
    for s in select value from jsonb_array_elements(v_shifts) loop
      v_start := (d + (s ->> 'start')::time) at time zone 'Asia/Kolkata';
      v_end := (case when (s ->> 'end')::time <= (s ->> 'start')::time then d + 1 else d end + (s ->> 'end')::time) at time zone 'Asia/Kolkata';
      if p_at >= v_start and p_at < v_end then return query select s ->> 'code', v_start, v_end; return; end if;
    end loop;
  end loop;
end;
$$;
revoke all on function private.ap2_shift_window(uuid, timestamptz) from public, anon, authenticated;

-- AP-012: expected output of a job from its recorded pushes, linked billets and the applicable standard.
create or replace function private.ap2_job_expected(p_company uuid, p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  j public.production_jobs%rowtype; g record; s public.scrap_standards%rowtype; v_blockers text[] := '{}'; v_missing text[] := '{}';
  v_pushes integer; v_billet_kg numeric; v_unweighed integer; v_estimated integer; v_linked integer; v_linked_kg numeric; v_linked_pushed integer; v_extra integer;
  v_butt numeric; v_crop numeric; v_saw numeric; v_good numeric; v_cutoff numeric; v_pieces bigint; v_unknown integer; v_existing numeric; v_last uuid; v_input numeric;
  v_ok boolean;
begin
  select * into j from public.production_jobs where id = p_job and company_id = p_company;
  if j.id is null then return null; end if;
  select * into g from private.ap2_job_geometry(j.id);
  s := private.ap2_standard(p_company, j.machine_id, j.die_id);
  select count(*), sum(p.billet_kg), count(*) filter (where p.billet_kg is null), count(*) filter (where p.billet_kg_basis = 'estimated'),
    count(*) filter (where p.billet_kg_basis = 'linked_billet'), count(*) filter (where p.billet_id is null)
    into v_pushes, v_billet_kg, v_unweighed, v_estimated, v_linked_pushed, v_extra
    from private.ap2_pushes p where p.production_job_id = j.id;
  select count(*), coalesce(sum(coalesce(b.measured_weight_kg, b.weight_kg)), 0) into v_linked, v_linked_kg
    from public.foundry_billets b where b.company_id = p_company and b.production_job_id = j.id and b.status in ('allocated', 'issued', 'consumed');
  select coalesce(sum(weight_kg), 0) into v_existing from public.scrap_records where company_id = p_company and production_job_id = j.id;
  select e.id into v_last from public.production_push_events e where e.production_job_id = j.id order by e.recorded_at desc, e.id desc limit 1;
  select sum(y.butt_kg), sum(y.crop_kg), sum(y.saw_kg), sum(y.good_kg), sum(y.cutoff_kg), sum(y.pieces), count(*) filter (where y.good_kg is null)
    into v_butt, v_crop, v_saw, v_good, v_cutoff, v_pieces, v_unknown
    from private.ap2_pushes p
    cross join lateral private.ap2_push_yield(p.billet_kg, coalesce(p.billet_diameter_mm, g.billet_diameter_mm), g.kg_per_m, g.cut_m,
      s.butt_length_mm, s.front_crop_mm, s.back_crop_mm, s.saw_kerf_mm, s.density_kg_m3) y
    where p.production_job_id = j.id;

  if j.status <> 'in_progress' then v_blockers := v_blockers || 'The job is not running.'::text; end if;
  if v_pushes = 0 then v_blockers := v_blockers || 'No pushes are recorded for this job yet.'::text; end if;
  if s.id is null then v_missing := v_missing || 'No approved scrap standard applies to this press or die.'::text; end if;
  if g.kg_per_m is null then v_missing := v_missing || 'Section weight (kg/m) is not recorded on the job or profile.'::text; end if;
  if g.cut_m is null then v_missing := v_missing || 'Cut length is not recorded on the job.'::text; end if;
  if g.billet_diameter_mm is null and exists (select 1 from private.ap2_pushes p where p.production_job_id = j.id and p.billet_diameter_mm is null) then
    v_missing := v_missing || 'Billet diameter is not recorded on the billets, profile or die.'::text; end if;
  if v_unweighed > 0 then v_missing := v_missing || format('%s push(es) have no billet weight (no linked billet and no standard billet length).', v_unweighed); end if;
  if v_linked > 0 and v_linked_pushed < v_linked then
    v_blockers := v_blockers || format('%s linked billet(s) have no push. Record the missing pushes or return the billets before completing.', v_linked - v_linked_pushed); end if;
  if v_linked > 0 and v_extra > 0 then
    v_blockers := v_blockers || format('%s push(es) have no linked billet. Link the extra billets or void the extra pushes.', v_extra); end if;
  v_input := case when v_linked > 0 then v_linked_kg else v_billet_kg end;
  v_ok := cardinality(v_missing) = 0 and v_pushes > 0 and coalesce(v_unknown, 0) = 0;

  return jsonb_build_object(
    'job_id', j.id, 'job_status', j.status, 'pushes', v_pushes, 'billet_kg', v_billet_kg, 'estimated_pushes', v_estimated,
    'linked_billets', v_linked, 'linked_billet_kg', v_linked_kg, 'linked_pushed', v_linked_pushed, 'input_kg', v_input,
    'input_basis', case when v_linked > 0 then 'linked_billets' else 'pushes' end,
    'existing_scrap_kg', v_existing, 'kg_per_m', g.kg_per_m, 'cut_m', g.cut_m, 'pieces_per_bundle', g.pieces_per_bundle,
    'standard', case when s.id is not null then jsonb_build_object('id', s.id, 'version', s.version, 'butt_length_mm', s.butt_length_mm, 'front_crop_mm', s.front_crop_mm,
      'back_crop_mm', s.back_crop_mm, 'saw_kerf_mm', s.saw_kerf_mm, 'density_kg_m3', s.density_kg_m3,
      'scope', case when s.die_id is not null then 'die' when s.machine_id is not null then 'press' else 'company' end) end,
    'complete', v_ok,
    'expected', case when v_ok then jsonb_build_object(
      'good_pieces', v_pieces, 'good_kg', v_good, 'meters', round(v_pieces * g.cut_m, 3), 'butt_kg', v_butt, 'crop_kg', v_crop, 'saw_kg', v_saw, 'cutoff_kg', v_cutoff,
      'recovery_percent', case when v_billet_kg > 0 then round(v_good * 100 / v_billet_kg, 2) end,
      'bundles', case when g.pieces_per_bundle is not null then jsonb_build_object('per_bundle', g.pieces_per_bundle, 'full', v_pieces / g.pieces_per_bundle, 'loose', v_pieces % g.pieces_per_bundle) end) end,
    'blockers', to_jsonb(v_blockers), 'missing', to_jsonb(v_missing), 'last_event_id', v_last);
end;
$$;
revoke all on function private.ap2_job_expected(uuid, uuid) from public, anon, authenticated;

-- AP-066: expected good kg from one push of a job (average linked billet, else the standard's estimated billet).
create or replace function private.ap2_job_push_good_kg(p_company uuid, p_job uuid)
returns numeric language plpgsql stable security definer set search_path = public, private as $$
declare j public.production_jobs%rowtype; g record; s public.scrap_standards%rowtype; v_billet numeric; v_good numeric;
begin
  select * into j from public.production_jobs where id = p_job and company_id = p_company;
  if j.id is null then return null; end if;
  select * into g from private.ap2_job_geometry(j.id);
  s := private.ap2_standard(p_company, j.machine_id, j.die_id);
  select avg(coalesce(b.measured_weight_kg, b.weight_kg)) into v_billet from public.foundry_billets b
    where b.company_id = p_company and b.production_job_id = j.id and b.status in ('allocated', 'issued', 'consumed');
  v_billet := coalesce(v_billet, private.ap2_estimated_billet_kg(g.billet_diameter_mm, s.default_billet_length_mm, s.density_kg_m3));
  select y.good_kg into v_good from private.ap2_push_yield(v_billet, g.billet_diameter_mm, g.kg_per_m, g.cut_m, s.butt_length_mm, s.front_crop_mm, s.back_crop_mm, s.saw_kerf_mm, s.density_kg_m3) y;
  return nullif(v_good, 0);
end;
$$;
revoke all on function private.ap2_job_push_good_kg(uuid, uuid) from public, anon, authenticated;

-- Average die-change minutes measured on a press over eight weeks (null below three events), after corrections.
create or replace function private.ap2_measured_die_change_minutes(p_company uuid, p_machine uuid)
returns numeric language sql stable security definer set search_path = public, private as $$
  select case when count(*) >= 3 then round(avg(coalesce(x.corrected, c.duration_seconds)) / 60, 1) end
  from public.press_die_changes c
  left join lateral (select k.corrected_duration_seconds corrected from public.press_die_change_corrections k
    where k.die_change_id = c.id and k.corrected_duration_seconds is not null order by k.created_at desc limit 1) x on true
  where c.company_id = p_company and c.machine_id = p_machine and c.first_push_at > now() - interval '56 days'
$$;
revoke all on function private.ap2_measured_die_change_minutes(uuid, uuid) from public, anon, authenticated;

-- AP-066: a press's target for a shift from the published plan (scheduled and released slots), net of planned maintenance
-- and of a die-change allowance wherever consecutive planned jobs use different dies.
create or replace function private.ap2_shift_target(p_company uuid, p_machine uuid, p_starts timestamptz, p_ends timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  r record; v_prev_die uuid; v_prev_known boolean := false; v_allow numeric; v_measured numeric; v_target numeric := 0; v_pushes numeric := 0;
  v_push_known boolean := true; v_kg_known boolean := true; v_slots integer := 0; v_changes integer := 0; v_maint numeric := 0;
  v_end timestamptz; v_dur numeric; v_os timestamptz; v_oe timestamptz; v_ov numeric; v_m numeric; v_chg numeric; v_eff numeric; v_kg numeric; v_share numeric; v_per numeric;
begin
  v_measured := private.ap2_measured_die_change_minutes(p_company, p_machine);
  v_allow := coalesce(v_measured, (select s.die_change_allowance_minutes from private.ap2_settings(p_company, p_machine) s));
  select true, j.die_id into v_prev_known, v_prev_die from public.production_plan_slots s join public.production_jobs j on j.id = s.production_job_id
    where s.company_id = p_company and s.machine_id = p_machine and s.status in ('scheduled', 'released') and s.planned_start_at < p_starts
    order by s.planned_start_at desc, s.sequence_number desc limit 1;
  for r in select s.*, j.die_id, j.planned_quantity_kg, j.id job_id from public.production_plan_slots s join public.production_jobs j on j.id = s.production_job_id
      where s.company_id = p_company and s.machine_id = p_machine and s.status in ('scheduled', 'released') and j.status not in ('cancelled')
        and s.planned_start_at < p_ends and coalesce(s.planned_end_at, s.planned_start_at + interval '8 hours') > p_starts
      order by s.planned_start_at, s.sequence_number loop
    v_slots := v_slots + 1;
    v_end := coalesce(r.planned_end_at, r.planned_start_at + interval '8 hours');
    v_dur := extract(epoch from v_end - r.planned_start_at);
    v_os := greatest(r.planned_start_at, p_starts); v_oe := least(v_end, p_ends);
    v_ov := greatest(0, extract(epoch from v_oe - v_os));
    select coalesce(sum(greatest(0, extract(epoch from least(b.ends_at, v_oe) - greatest(b.starts_at, v_os)))), 0) into v_m
      from public.factory_maintenance_blocks b where b.company_id = p_company and b.machine_id = p_machine and b.status = 'planned' and b.starts_at < v_oe and b.ends_at > v_os;
    v_chg := 0;
    if v_prev_known and v_prev_die is distinct from r.die_id and r.planned_start_at >= p_starts then v_chg := v_allow * 60; v_changes := v_changes + 1; end if;
    v_prev_known := true; v_prev_die := r.die_id;
    v_eff := greatest(0, v_ov - v_m - v_chg);
    v_maint := v_maint + v_m;
    v_kg := coalesce(r.capacity_kg, r.planned_quantity_kg);
    if v_kg is null or v_dur <= 0 then v_kg_known := false; continue; end if;
    v_share := v_kg * v_eff / v_dur;
    v_target := v_target + v_share;
    v_per := private.ap2_job_push_good_kg(p_company, r.job_id);
    if v_per is null then v_push_known := false; else v_pushes := v_pushes + v_share / v_per; end if;
  end loop;
  return jsonb_build_object('slots', v_slots,
    'target_kg', case when v_slots > 0 and v_kg_known then round(v_target, 1) end,
    'target_pushes', case when v_slots > 0 and v_kg_known and v_push_known then ceil(v_pushes - 1e-9)::integer end,
    'die_changes', v_changes, 'die_change_allowance_minutes', v_allow, 'allowance_basis', case when v_measured is not null then 'measured' else 'setting' end,
    'maintenance_minutes', round(v_maint / 60), 'kg_unknown', not v_kg_known, 'pushes_unknown', not v_push_known);
end;
$$;
revoke all on function private.ap2_shift_target(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- AP-066: what a press has done in a window, from push events.
create or replace function private.ap2_shift_actual(p_company uuid, p_machine uuid, p_starts timestamptz, p_ends timestamptz)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('pushes', count(*), 'billet_kg', round(coalesce(sum(p.billet_kg), 0), 1),
    'estimated_output_kg', round(coalesce(sum(y.good_kg), 0), 1), 'pushes_without_estimate', count(*) filter (where y.good_kg is null),
    'last_push_at', max(p.event_at))
  from private.ap2_pushes p
  join public.production_jobs j on j.id = p.production_job_id
  left join lateral (select g.* from private.ap2_job_geometry(j.id) g) g on true
  left join lateral (select s.* from private.ap2_standard(p_company, j.machine_id, j.die_id) s) s on true
  left join lateral private.ap2_push_yield(p.billet_kg, coalesce(p.billet_diameter_mm, g.billet_diameter_mm), g.kg_per_m, g.cut_m,
      s.butt_length_mm, s.front_crop_mm, s.back_crop_mm, s.saw_kerf_mm, s.density_kg_m3) y on true
  where p.company_id = p_company and p.machine_id = p_machine and p.event_at >= p_starts and p.event_at < p_ends
$$;
revoke all on function private.ap2_shift_actual(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- AP-028: die counters since the last service, compared with the approved thresholds for the die family.
create or replace function private.ap2_die_service(p_company uuid, p_die uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  d public.dies%rowtype; v_today date := private.ist_today(); v_nitr date; v_corr date; v_since date; v_event text; v_service jsonb := '{}'::jsonb;
  v_pushes bigint; v_kg numeric; v_runs bigint; v_avg numeric; t public.die_service_thresholds%rowtype; v_value numeric; v_state text; v_due_in integer;
  v_checks jsonb := '[]'::jsonb; v_worst text := 'none'; v_booking jsonb;
begin
  select * into d from public.dies where id = p_die and company_id = p_company and deleted_at is null;
  if d.id is null then return null; end if;
  select max(n.nitriding_date) into v_nitr from public.die_nitriding_history n where n.company_id = p_company and n.die_id = d.id
    and n.nitriding_date <= v_today and coalesce(n.status, 'completed') = 'completed';
  select max(c.correction_date) into v_corr from public.die_corrections c where c.company_id = p_company and c.die_id = d.id and c.correction_date <= v_today;
  select round(avg(x.billet_kg), 3) into v_avg from (select p.billet_kg from private.ap2_pushes p where p.company_id = p_company and p.die_id = d.id and p.billet_kg is not null
    order by p.event_at desc limit 200) x;
  foreach v_event in array array['nitriding', 'correction', 'any'] loop
    v_since := case v_event when 'nitriding' then v_nitr when 'correction' then v_corr else greatest(v_nitr, v_corr) end;
    select count(*), coalesce(sum(p.billet_kg), 0) into v_pushes, v_kg from private.ap2_pushes p
      where p.company_id = p_company and p.die_id = d.id and (v_since is null or (p.event_at at time zone 'Asia/Kolkata')::date > v_since);
    -- Completed runs recorded without pushes (before push capture began) still count by their output.
    v_kg := v_kg + coalesce((select sum(coalesce(j.actual_quantity_kg, 0)) from public.production_jobs j where j.company_id = p_company and j.die_id = d.id
      and j.status = 'completed' and (v_since is null or private.die_run_date(j) > v_since)
      and not exists (select 1 from public.production_push_events e where e.production_job_id = j.id)), 0);
    select count(*) into v_runs from public.production_jobs j where j.company_id = p_company and j.die_id = d.id and j.status = 'completed'
      and (v_since is null or private.die_run_date(j) > v_since);
    if v_since is null then v_kg := v_kg + coalesce(d.opening_production_kg, 0); v_runs := v_runs + coalesce(d.opening_runs, 0); end if;
    v_service := v_service || jsonb_build_object(v_event, jsonb_build_object('since', v_since, 'pushes', v_pushes, 'kg', round(v_kg, 1), 'runs', v_runs,
      'days', case when v_since is not null then v_today - v_since end));
  end loop;
  for t in select * from public.die_service_thresholds x where x.company_id = p_company and x.status = 'approved' and (x.die_type is null or x.die_type = d.die_type)
      order by x.service_event, x.basis loop
    v_value := case t.basis when 'kg_since_service' then (v_service -> t.service_event ->> 'kg')::numeric when 'runs_since_service' then (v_service -> t.service_event ->> 'runs')::numeric
      when 'pushes_since_service' then (v_service -> t.service_event ->> 'pushes')::numeric else (v_service -> t.service_event ->> 'days')::numeric end;
    v_state := case when v_value is null then 'unknown' when v_value >= t.warn_at then 'due' when v_value >= t.warn_at * 0.9 then 'approaching' else 'ok' end;
    v_due_in := case when v_value is null then null when t.basis = 'pushes_since_service' then greatest(0, ceil(t.warn_at - v_value))::integer
      when t.basis = 'kg_since_service' and v_avg > 0 then greatest(0, ceil((t.warn_at - v_value) / v_avg))::integer end;
    v_checks := v_checks || jsonb_build_object('threshold_id', t.id, 'basis', t.basis, 'service_event', t.service_event, 'warn_at', t.warn_at, 'value', v_value,
      'state', v_state, 'due_in_pushes', v_due_in, 'die_type', t.die_type);
    v_worst := case when v_state = 'due' or v_worst = 'due' then 'due' when v_state = 'approaching' or v_worst = 'approaching' then 'approaching'
      when v_state = 'ok' or v_worst = 'ok' then 'ok' else v_worst end;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'service_event', b.service_event, 'scheduled_for', b.scheduled_for, 'booked_at', b.booked_at,
      'booked_by', (select u.full_name from public.app_users u where u.id = b.booked_by)) order by b.scheduled_for), '[]'::jsonb)
    into v_booking from public.die_service_bookings b where b.company_id = p_company and b.die_id = d.id and b.status = 'booked';
  return jsonb_build_object('die_id', d.id, 'die_number', d.die_number, 'die_type', d.die_type, 'die_status', d.die_status, 'service', v_service,
    'avg_billet_kg_per_push', v_avg, 'checks', v_checks, 'state', v_worst, 'bookings', v_booking,
    'due_in_pushes', (select min((c ->> 'due_in_pushes')::integer) from jsonb_array_elements(v_checks) c where c ->> 'due_in_pushes' is not null),
    'flag', case when v_worst = 'due' and jsonb_array_length(v_booking) = 0 then 'due_unbooked' when v_worst = 'due' then 'due_booked'
      when v_worst = 'approaching' then 'approaching' else null end);
end;
$$;
revoke all on function private.ap2_die_service(uuid, uuid) from public, anon, authenticated;

-- AP-054: a plan's counter since its last completed work order (running hours or pushes of its press).
create or replace function private.ap2_pm_counter(p_plan public.pm_plans)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_since timestamptz; v_run record;
begin
  select greatest(p_plan.counter_start_at, max(w.done_at)) into v_since from public.pm_work_orders w where w.plan_id = p_plan.id and w.status = 'done';
  v_since := coalesce(v_since, p_plan.counter_start_at);
  select * into v_run from private.ap2_runtime(p_plan.company_id, p_plan.machine_id, v_since, now() + interval '1 minute');
  return jsonb_build_object('since', v_since, 'running_hours', round(v_run.running_seconds / 3600, 2), 'pushes', v_run.pushes,
    'value', case p_plan.basis when 'running_hours' then round(v_run.running_seconds / 3600, 2) else v_run.pushes end,
    'percent', round(case p_plan.basis when 'running_hours' then v_run.running_seconds / 3600 else v_run.pushes end * 100 / p_plan.interval_value, 1));
end;
$$;
revoke all on function private.ap2_pm_counter(public.pm_plans) from public, anon, authenticated;

-- AP-016: create one required sample (idempotent per job, trigger and occurrence) and tell the quality team.
create or replace function private.ap2_sample_require(p_company uuid, p_job uuid, p_trigger public.inspection_sampling_triggers, p_key text,
  p_at_push integer, p_window_push integer, p_window_ends timestamptz)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v_id uuid; v_job text;
begin
  insert into public.qc_sample_requirements(company_id, production_job_id, trigger_id, plan_id, kind, occurrence_key, at_push, window_push, window_ends_at, blocks_release, due_at)
    values (p_company, p_job, p_trigger.id, p_trigger.plan_id, p_trigger.kind, p_key, p_at_push, p_window_push, p_window_ends, p_trigger.blocks_release, clock_timestamp())
    on conflict (production_job_id, trigger_id, occurrence_key) do nothing returning id into v_id;
  if v_id is not null then
    select coalesce(job_number, left(id::text, 8)) into v_job from public.production_jobs where id = p_job;
    insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, entity_reference, related_entity_type, related_entity_id, created_at)
      values (p_company, 'quality', 'qc_sample_due', case when p_trigger.blocks_release then 'warning' else 'info' end, 'Sample due on ' || v_job,
        case p_trigger.kind when 'first_after_die_change' then 'First piece after a die change.' when 'last_piece' then 'Last piece of the job.'
          when 'every_n_bundles' then format('Periodic check every %s bundles (from expected pieces).', p_trigger.every_n)
          else format('Periodic check every %s pushes (push %s).', p_trigger.every_n, p_at_push) end
          || case when p_trigger.blocks_release then ' QC release waits for this sample.' else '' end,
        '/quality/samples/' || v_id, 'qc-sample:' || v_id, 'production_job', p_job, clock_timestamp());
  end if;
  return v_id;
end;
$$;
revoke all on function private.ap2_sample_require(uuid, uuid, public.inspection_sampling_triggers, text, integer, integer, timestamptz) from public, anon, authenticated;

-- AP-016: evaluate the applicable plan's triggers after a push.
create or replace function private.ap2_sample_on_push(p_company uuid, p_job uuid, p_count integer, p_first_after_change boolean,
  p_pieces_before bigint, p_pieces_after bigint, p_pieces_this integer)
returns integer language plpgsql security definer set search_path = public, private as $$
declare j public.production_jobs%rowtype; v_plan uuid; t public.inspection_sampling_triggers%rowtype; v_ppb integer; v_per bigint; k integer; v_n integer := 0;
begin
  select * into j from public.production_jobs where id = p_job;
  v_plan := private.applicable_inspection_plan(p_company, j.profile_id);
  if v_plan is null then return 0; end if;
  select g.pieces_per_bundle into v_ppb from private.ap2_job_geometry(p_job) g;
  for t in select * from public.inspection_sampling_triggers x where x.company_id = p_company and x.plan_id = v_plan and x.status = 'active' order by x.created_at loop
    if t.kind = 'first_after_die_change' and p_first_after_change then
      if private.ap2_sample_require(p_company, p_job, t, 'first', p_count, p_count + 3, null) is not null then v_n := v_n + 1; end if;
    elsif t.kind = 'every_n_pushes' and p_count % t.every_n = 0 then
      if private.ap2_sample_require(p_company, p_job, t, 'push:' || p_count, p_count, p_count + t.every_n, null) is not null then v_n := v_n + 1; end if;
    elsif t.kind = 'every_n_bundles' and v_ppb is not null and p_pieces_after is not null and p_pieces_before is not null then
      v_per := t.every_n::bigint * v_ppb;
      for k in ((p_pieces_before / v_per) + 1)::integer .. (p_pieces_after / v_per)::integer loop
        if private.ap2_sample_require(p_company, p_job, t, 'bundle:' || k, p_count,
          p_count + greatest(3, ceil(v_per::numeric / greatest(coalesce(p_pieces_this, 1), 1))::integer), null) is not null then v_n := v_n + 1; end if;
      end loop;
    end if;
  end loop;
  -- A sample still open when its window of pushes has passed is missed (it can still be recorded, and is then late).
  update public.qc_sample_requirements set status = 'missed', missed_at = clock_timestamp()
    where production_job_id = p_job and status = 'open' and window_push is not null and window_push <= p_count and at_push < p_count;
  return v_n;
end;
$$;
revoke all on function private.ap2_sample_on_push(uuid, uuid, integer, boolean, bigint, bigint, integer) from public, anon, authenticated;

-- Sampling compliance for one job.
create or replace function private.ap2_job_sampling(p_company uuid, p_job uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('required', count(*), 'on_time', count(*) filter (where r.status = 'recorded' and not coalesce(r.recorded_late, false)),
    'late', count(*) filter (where r.status = 'recorded' and r.recorded_late), 'missed', count(*) filter (where r.status = 'missed'),
    'open', count(*) filter (where r.status = 'open'), 'waived', count(*) filter (where r.status = 'waived'),
    'blocking_open', count(*) filter (where r.blocks_release and r.status in ('open', 'missed')),
    'compliance_percent', case when count(*) filter (where r.status <> 'open') > 0
      then round(count(*) filter (where r.status = 'recorded' and not coalesce(r.recorded_late, false)) * 100.0 / count(*) filter (where r.status <> 'open'), 1) end)
  from public.qc_sample_requirements r where r.company_id = p_company and r.production_job_id = p_job
$$;
revoke all on function private.ap2_job_sampling(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-011 / AP-014 / AP-015 / AP-066: the press floor
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap2_session(p_company uuid, p_actor uuid, p_session uuid)
returns public.workstation_sessions language plpgsql security definer set search_path = public, private as $$
declare v public.workstation_sessions%rowtype;
begin
  select * into v from public.workstation_sessions where id = p_session and company_id = p_company and operator_id = p_actor for update;
  if v.id is null or v.ended_at is not null or v.expires_at <= clock_timestamp() then
    raise exception 'AP: The station session expired. Identify the operator again.';
  end if;
  return v;
end;
$$;
revoke all on function private.ap2_session(uuid, uuid, uuid) from public, anon, authenticated;

-- The job a station works on: the one asked for if it is running on this press, otherwise the running job with the
-- latest push, otherwise the earliest running job.
create or replace function private.ap2_running_job(p_company uuid, p_machine uuid, p_job uuid)
returns uuid language sql stable security definer set search_path = public, private as $$
  select j.id from public.production_jobs j
  where j.company_id = p_company and j.machine_id = p_machine and j.status = 'in_progress' and (p_job is null or j.id = p_job)
  order by (select max(p.event_at) from private.ap2_pushes p where p.production_job_id = j.id) desc nulls last, j.planned_date nulls last, j.id
  limit 1
$$;
revoke all on function private.ap2_running_job(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.ap2_record_push(p_company uuid, p_actor uuid, p_job uuid, p_machine uuid, p_session uuid, p_id uuid,
  p_client_at timestamptz, p_source text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  j public.production_jobs%rowtype; v_existing public.production_push_events%rowtype; v_last record; v_at timestamptz; v_seq integer; v_billet record;
  v_kg numeric; v_basis text; v_diam numeric; g record; s public.scrap_standards%rowtype; v_prev record; v_first boolean; v_change boolean := false;
  v_die_change boolean := false; v_count integer; v_before bigint; v_this integer; v_samples integer;
begin
  select * into v_existing from public.production_push_events where id = p_id;
  if v_existing.id is not null then
    if v_existing.company_id <> p_company or v_existing.production_job_id <> p_job then raise exception 'AP: Invalid request.'; end if;
    return jsonb_build_object('state', 'replayed', 'id', p_id, 'seq', v_existing.seq);
  end if;
  select * into j from public.production_jobs where id = p_job and company_id = p_company for update;
  if j.id is null or j.machine_id is distinct from p_machine then raise exception 'AP: This job is not planned on this press.'; end if;
  if j.status <> 'in_progress' then raise exception 'AP: Start the job before recording pushes.'; end if;
  -- A tap queued on a phone or station while offline keeps the time it was made (within 15 minutes).
  v_at := case when p_client_at is not null and p_client_at between now() - interval '15 minutes' and clock_timestamp() + interval '1 minute' then p_client_at else clock_timestamp() end;
  if p_source = 'tap' then
    select p.id, p.seq, p.event_at into v_last from private.ap2_pushes p where p.production_job_id = j.id order by p.event_at desc, p.seq desc limit 1;
    if v_last.id is not null and abs(extract(epoch from v_at - v_last.event_at)) < 5 then
      return jsonb_build_object('state', 'double_tap', 'id', v_last.id, 'seq', v_last.seq, 'message', 'A second tap within 5 seconds of the last push was ignored.');
    end if;
  end if;
  select coalesce(max(e.seq), 0) + 1 into v_seq from public.production_push_events e where e.production_job_id = j.id;
  -- The billet comes from the job's linked lot, in billet order; a voided push frees its billet again.
  select b.id, coalesce(b.measured_weight_kg, b.weight_kg) kg, b.billet_diameter_mm into v_billet from public.foundry_billets b
    where b.company_id = p_company and b.production_job_id = j.id and b.status in ('allocated', 'issued', 'consumed')
      and not exists (select 1 from private.ap2_pushes p where p.billet_id = b.id)
    order by b.billet_number, b.billet_code, b.id limit 1;
  select * into g from private.ap2_job_geometry(j.id);
  s := private.ap2_standard(p_company, j.machine_id, j.die_id);
  if v_billet.id is not null then
    v_kg := v_billet.kg; v_basis := 'linked_billet'; v_diam := coalesce(nullif(v_billet.billet_diameter_mm, 0), g.billet_diameter_mm);
  else
    v_diam := g.billet_diameter_mm; v_kg := private.ap2_estimated_billet_kg(v_diam, s.default_billet_length_mm, s.density_kg_m3);
    v_basis := case when v_kg is not null then 'estimated' end;
  end if;
  v_first := not exists (select 1 from private.ap2_pushes p where p.production_job_id = j.id);
  select coalesce(sum(y.pieces), 0) into v_before from private.ap2_pushes p
    cross join lateral private.ap2_push_yield(p.billet_kg, coalesce(p.billet_diameter_mm, g.billet_diameter_mm), g.kg_per_m, g.cut_m,
      s.butt_length_mm, s.front_crop_mm, s.back_crop_mm, s.saw_kerf_mm, s.density_kg_m3) y where p.production_job_id = j.id;
  insert into public.production_push_events(id, company_id, production_job_id, machine_id, die_id, kind, source, seq, workstation_session_id, operator_id,
    billet_id, billet_kg, billet_kg_basis, billet_diameter_mm, event_at, client_at, reason)
    values (p_id, p_company, j.id, p_machine, j.die_id, 'push', p_source, v_seq, p_session, p_actor, v_billet.id, v_kg, v_basis, v_diam, v_at, p_client_at, p_reason);
  -- AP-015: the first push of a job after another die's push on this press is a die change.
  if v_first then
    select p.die_id, p.event_at, p.production_job_id into v_prev from private.ap2_pushes p
      where p.company_id = p_company and p.machine_id = p_machine and p.production_job_id <> j.id and p.event_at <= v_at order by p.event_at desc, p.id desc limit 1;
    if v_prev.event_at is null then
      v_change := true;
    elsif v_prev.die_id is distinct from j.die_id then
      insert into public.press_die_changes(company_id, machine_id, from_die_id, to_die_id, from_job_id, to_job_id, last_push_at, first_push_at, duration_seconds)
        values (p_company, p_machine, v_prev.die_id, j.die_id, v_prev.production_job_id, j.id, v_prev.event_at, v_at, floor(extract(epoch from v_at - v_prev.event_at))::integer)
        on conflict (to_job_id) do nothing;
      v_change := true; v_die_change := true;
    end if;
  end if;
  -- AP-014: a push ends any open idle interval on this press.
  update public.press_idle_intervals set gap_end = v_at where company_id = p_company and machine_id = p_machine and gap_end is null and gap_start < v_at;
  select count(*) into v_count from private.ap2_pushes p where p.production_job_id = j.id;
  select y.pieces into v_this from private.ap2_push_yield(v_kg, v_diam, g.kg_per_m, g.cut_m, s.butt_length_mm, s.front_crop_mm, s.back_crop_mm, s.saw_kerf_mm, s.density_kg_m3) y;
  v_samples := private.ap2_sample_on_push(p_company, j.id, v_count, v_change, v_before, case when v_this is not null then v_before + v_this end, v_this);
  -- Station activity keeps the operator's session alive (at most 12 hours from when it was opened).
  if p_session is not null then
    update public.workstation_sessions set expires_at = greatest(expires_at, least(opened_at + interval '12 hours', clock_timestamp() + interval '10 minutes')) where id = p_session;
  end if;
  return jsonb_build_object('state', 'recorded', 'id', p_id, 'seq', v_seq, 'event_at', v_at, 'billet_kg', v_kg, 'billet_kg_basis', v_basis,
    'pushes', v_count, 'samples_created', v_samples, 'die_change', v_die_change);
end;
$$;
revoke all on function private.ap2_record_push(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, text) from public, anon, authenticated;

create or replace function private.ap2_station_view(p_company uuid, p_actor uuid, p_session public.workstation_sessions, p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  v_job uuid := private.ap2_running_job(p_company, p_session.machine_id, p_job); j public.production_jobs%rowtype; st record; v_last record; v_undo record;
  v_shift record; v_open_id uuid; v_open_reason text; v_idle numeric; v_job_json jsonb; v_expected jsonb;
begin
  select * into st from private.ap2_settings(p_company, p_session.machine_id);
  select p.id, p.event_at, p.production_job_id, u.full_name operator into v_last from private.ap2_pushes p left join public.app_users u on u.id = p.operator_id
    where p.company_id = p_company and p.machine_id = p_session.machine_id order by p.event_at desc, p.id desc limit 1;
  select * into v_shift from private.ap2_shift_window(p_company, clock_timestamp());
  if v_job is not null then
    select * into j from public.production_jobs where id = v_job;
    select p.id, p.seq, p.recorded_at + interval '30 seconds' until_at into v_undo from private.ap2_pushes p
      where p.production_job_id = j.id and p.operator_id = p_actor and p.source = 'tap' and p.recorded_at > clock_timestamp() - interval '30 seconds'
      order by p.recorded_at desc limit 1;
    v_expected := private.ap2_job_expected(p_company, j.id);
    v_job_json := jsonb_build_object('id', j.id, 'job_number', j.job_number, 'planned_quantity_kg', j.planned_quantity_kg, 'pieces', j.pieces,
      'die_number', (select d.die_number from public.dies d where d.id = j.die_id),
      'profile_code', (select p.profile_code from public.aluminium_profiles p where p.id = j.profile_id),
      'pushes', v_expected -> 'pushes', 'billet_kg', v_expected -> 'billet_kg', 'linked_billets', v_expected -> 'linked_billets',
      'linked_remaining', greatest(0, (v_expected ->> 'linked_billets')::integer - (v_expected ->> 'linked_pushed')::integer),
      'expected', v_expected -> 'expected', 'missing', v_expected -> 'missing', 'blockers', v_expected -> 'blockers',
      'samples_open', (select count(*) from public.qc_sample_requirements r where r.production_job_id = j.id and r.status in ('open', 'missed')),
      'undo', case when v_undo.id is not null then jsonb_build_object('push_id', v_undo.id, 'seq', v_undo.seq, 'until', v_undo.until_at) end);
  end if;
  if v_job is not null and v_last.event_at is not null and clock_timestamp() - v_last.event_at > make_interval(mins => st.idle_gap_minutes) then
    v_idle := floor(extract(epoch from clock_timestamp() - v_last.event_at) / 60);
    select i.id, i.reason into v_open_id, v_open_reason from public.press_idle_intervals i
      where i.company_id = p_company and i.machine_id = p_session.machine_id and i.gap_start = v_last.event_at;
  end if;
  return jsonb_build_object('kind', 'station', 'session_id', p_session.id, 'machine_id', p_session.machine_id, 'machine_name', private.ap2_machine_name(p_session.machine_id),
    'expires_at', p_session.expires_at, 'now', clock_timestamp(), 'idle_gap_minutes', st.idle_gap_minutes,
    'running_jobs', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'job_number', x.job_number) order by x.job_number) from public.production_jobs x where x.company_id = p_company and x.machine_id = p_session.machine_id and x.status = 'in_progress'), '[]'::jsonb),
    'job', v_job_json,
    'last_push', case when v_last.id is not null then jsonb_build_object('at', v_last.event_at, 'operator', v_last.operator, 'job_id', v_last.production_job_id) end,
    'idle', case when v_idle is not null then jsonb_build_object('since', v_last.event_at, 'minutes', v_idle, 'interval_id', v_open_id, 'reason', v_open_reason) end,
    'shift', case when v_shift.code is not null then jsonb_build_object('code', v_shift.code, 'starts_at', v_shift.starts_at, 'ends_at', v_shift.ends_at,
      'target', private.ap2_shift_target(p_company, p_session.machine_id, v_shift.starts_at, v_shift.ends_at),
      'actual', private.ap2_shift_actual(p_company, p_session.machine_id, v_shift.starts_at, v_shift.ends_at)) end);
end;
$$;
revoke all on function private.ap2_station_view(uuid, uuid, public.workstation_sessions, uuid) from public, anon, authenticated;

-- Daily idle minutes per press, clipped to each IST day; an interval still open ends now for today's figures.
create or replace function private.ap2_downtime_days(p_company uuid, p_from date, p_to date, p_machine uuid)
returns table(on_day date, machine_id uuid, idle_minutes numeric, explained_minutes numeric, by_reason jsonb)
language sql stable security definer set search_path = public, private as $$
  with days as (select d::date as on_day, (d::date::timestamp at time zone 'Asia/Kolkata') ds, ((d::date + 1)::timestamp at time zone 'Asia/Kolkata') de
      from generate_series(p_from, p_to, interval '1 day') d),
  parts as (
    select days.on_day, i.machine_id, i.reason,
      greatest(0, extract(epoch from least(coalesce(i.gap_end, clock_timestamp()), days.de) - greatest(i.gap_start, days.ds)) / 60) minutes
    from days join public.press_idle_intervals i on i.company_id = p_company and (p_machine is null or i.machine_id = p_machine)
      and i.gap_start < days.de and coalesce(i.gap_end, clock_timestamp()) > days.ds)
  select x.on_day, x.machine_id, round(sum(x.minutes), 1), round(coalesce(sum(x.minutes) filter (where x.reason is not null), 0), 1),
    coalesce((select jsonb_object_agg(y.reason, y.m) from (select reason, round(sum(minutes), 1) m from parts p where p.on_day = x.on_day and p.machine_id = x.machine_id and p.reason is not null group by reason) y), '{}'::jsonb)
  from parts x group by x.on_day, x.machine_id
$$;
revoke all on function private.ap2_downtime_days(uuid, date, date, uuid) from public, anon, authenticated;

create or replace function public.ap_press(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  c record; v_session public.workstation_sessions%rowtype; v_job uuid; v_id uuid; v_reason text; v_note text; v_result jsonb; e public.production_push_events%rowtype;
  j public.production_jobs%rowtype; v_last record; st record; v_from date; v_to date; v_page integer; v_machine uuid; v_n integer; v_total bigint; i public.press_idle_intervals%rowtype;
  v_weeks integer; v_minutes numeric; v_results jsonb := '[]'::jsonb; v_today date := private.ist_today(); v_shift record;
begin
  if p_command in ('station', 'push', 'undo', 'idle_answer', 'void', 'backfill', 'settings_save', 'die_change_correct', 'expected') then
    select * into c from private.ap_ctx(private.ap2_floor_roles());
  else
    select * into c from private.ap_ctx(private.ap2_floor_roles() || array['quality', 'inventory_manager']);
  end if;

  if p_command = 'station' then
    perform private.ap_keys(p_payload, array['session_id', 'job_id']);
    v_session := private.ap2_session(c.company_id, c.actor_id, private.ap_uuid(p_payload, 'session_id'));
    return private.ap2_station_view(c.company_id, c.actor_id, v_session, private.ap_uuid(p_payload, 'job_id', false));

  elsif p_command = 'push' then
    perform private.ap_keys(p_payload, array['id', 'session_id', 'job_id', 'client_at']);
    v_session := private.ap2_session(c.company_id, c.actor_id, private.ap_uuid(p_payload, 'session_id'));
    v_result := private.ap2_record_push(c.company_id, c.actor_id, private.ap_uuid(p_payload, 'job_id'), v_session.machine_id, v_session.id,
      private.ap_uuid(p_payload, 'id'), case when coalesce(p_payload ->> 'client_at', '') ~ '^\d{4}-\d{2}-\d{2}T' then (p_payload ->> 'client_at')::timestamptz end, 'tap', null);
    select * into v_session from public.workstation_sessions where id = v_session.id;
    return v_result || jsonb_build_object('expires_at', v_session.expires_at);

  elsif p_command = 'undo' then
    perform private.ap_keys(p_payload, array['session_id', 'push_id']);
    v_session := private.ap2_session(c.company_id, c.actor_id, private.ap_uuid(p_payload, 'session_id'));
    select * into e from public.production_push_events where id = private.ap_uuid(p_payload, 'push_id') and company_id = c.company_id and kind = 'push';
    if e.id is null or e.machine_id <> v_session.machine_id then raise exception 'AP: That push is not on this press.'; end if;
    if exists (select 1 from public.production_push_events v where v.voids_event_id = e.id) then return jsonb_build_object('state', 'already_undone', 'id', e.id); end if;
    if e.operator_id <> c.actor_id or e.source <> 'tap' or e.recorded_at < clock_timestamp() - interval '30 seconds' then
      raise exception 'AP: Undo is available to the same operator for 30 seconds after a tap. Ask a supervisor to void this push.';
    end if;
    select * into j from public.production_jobs where id = e.production_job_id for update;
    if j.status <> 'in_progress' then raise exception 'AP: The job is no longer running.'; end if;
    insert into public.production_push_events(id, company_id, production_job_id, machine_id, die_id, kind, voids_event_id, source, workstation_session_id, operator_id, event_at, reason)
      values (gen_random_uuid(), c.company_id, e.production_job_id, e.machine_id, e.die_id, 'void', e.id, 'undo', v_session.id, c.actor_id, clock_timestamp(), 'Undone by the operator within 30 seconds');
    return jsonb_build_object('state', 'undone', 'id', e.id, 'seq', e.seq);

  elsif p_command = 'void' then
    perform private.ap_keys(p_payload, array['push_id', 'reason']);
    if not (c.role = any(private.ap2_supervisor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 8, 300);
    select * into e from public.production_push_events where id = private.ap_uuid(p_payload, 'push_id') and company_id = c.company_id and kind = 'push';
    if e.id is null then raise exception 'AP: Push not found.'; end if;
    if exists (select 1 from public.production_push_events v where v.voids_event_id = e.id) then return jsonb_build_object('state', 'already_voided', 'id', e.id); end if;
    select * into j from public.production_jobs where id = e.production_job_id for update;
    if j.status in ('completed', 'cancelled') then raise exception 'AP: Pushes of a closed job cannot be voided; correct the output instead.'; end if;
    insert into public.production_push_events(id, company_id, production_job_id, machine_id, die_id, kind, voids_event_id, source, operator_id, event_at, reason)
      values (gen_random_uuid(), c.company_id, e.production_job_id, e.machine_id, e.die_id, 'void', e.id, 'supervisor', c.actor_id, clock_timestamp(), v_reason);
    return jsonb_build_object('state', 'voided', 'id', e.id, 'seq', e.seq);

  elsif p_command = 'backfill' then
    perform private.ap_keys(p_payload, array['job_id', 'count', 'reason']);
    if not (c.role = any(private.ap2_supervisor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 8, 300);
    v_n := private.ap2_num(p_payload, 'count', 'Number of pushes', 1, 50)::integer;
    select * into j from public.production_jobs where id = private.ap_uuid(p_payload, 'job_id') and company_id = c.company_id;
    if j.id is null then raise exception 'AP: Job not found.'; end if;
    for v_total in 1 .. v_n loop
      v_results := v_results || jsonb_build_array(private.ap2_record_push(c.company_id, c.actor_id, j.id, j.machine_id, null, gen_random_uuid(), null, 'backfill', v_reason));
    end loop;
    return jsonb_build_object('state', 'recorded', 'count', v_n, 'results', v_results);

  elsif p_command = 'idle_answer' then
    perform private.ap_keys(p_payload, array['session_id', 'interval_id', 'reason', 'note']);
    v_reason := p_payload ->> 'reason';
    if v_reason is null or v_reason not in ('die_change', 'billet_shortage', 'power', 'breakdown', 'waiting_qc', 'no_operator', 'other') then raise exception 'AP: Choose a reason.'; end if;
    v_note := private.ap_text(p_payload ->> 'note', 'Note', 3, 300, v_reason = 'other');
    if p_payload ? 'session_id' then
      v_session := private.ap2_session(c.company_id, c.actor_id, private.ap_uuid(p_payload, 'session_id'));
      select * into st from private.ap2_settings(c.company_id, v_session.machine_id);
      select p.event_at into v_last from private.ap2_pushes p where p.company_id = c.company_id and p.machine_id = v_session.machine_id order by p.event_at desc, p.id desc limit 1;
      if v_last.event_at is null then raise exception 'AP: No push is recorded on this press yet.'; end if;
      if clock_timestamp() - v_last.event_at <= make_interval(mins => st.idle_gap_minutes) then raise exception 'AP: The press is not idle yet.'; end if;
      insert into public.press_idle_intervals(company_id, machine_id, production_job_id, gap_start, reason, note, source, answered_by, answered_at)
        values (c.company_id, v_session.machine_id, private.ap2_running_job(c.company_id, v_session.machine_id, null), v_last.event_at, v_reason, v_note, 'operator', c.actor_id, clock_timestamp())
        on conflict (company_id, machine_id, gap_start) do update set reason = excluded.reason, note = excluded.note, answered_by = excluded.answered_by, answered_at = excluded.answered_at
        returning * into i;
      return jsonb_build_object('state', 'answered', 'id', i.id, 'reason', i.reason);
    end if;
    if not (c.role = any(private.ap2_supervisor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    select * into i from public.press_idle_intervals where id = private.ap_uuid(p_payload, 'interval_id') and company_id = c.company_id for update;
    if i.id is null then raise exception 'AP: Idle interval not found.'; end if;
    if i.reason is not null and v_note is null then raise exception 'AP: Add a note when changing a reason someone already gave.'; end if;
    update public.press_idle_intervals set reason = v_reason, note = coalesce(v_note, note), answered_by = c.actor_id, answered_at = clock_timestamp() where id = i.id returning * into i;
    return jsonb_build_object('state', 'answered', 'id', i.id, 'reason', i.reason);

  elsif p_command = 'job' then
    perform private.ap_keys(p_payload, array['job_id']);
    select * into j from public.production_jobs where id = private.ap_uuid(p_payload, 'job_id') and company_id = c.company_id;
    if j.id is null then raise exception 'AP: Job not found.'; end if;
    select * into st from private.ap2_settings(c.company_id, j.machine_id);
    return jsonb_build_object('job_id', j.id, 'status', j.status, 'expected', private.ap2_job_expected(c.company_id, j.id),
      'pushes', (select jsonb_build_object('count', count(*) filter (where p.kind = 'push' and not exists (select 1 from public.production_push_events v where v.voids_event_id = p.id)),
          'voided', count(*) filter (where p.kind = 'void'), 'backfilled', count(*) filter (where p.kind = 'push' and p.source = 'backfill'),
          'first_at', min(p.event_at) filter (where p.kind = 'push'), 'last_at', max(p.event_at) filter (where p.kind = 'push'))
        from public.production_push_events p where p.production_job_id = j.id),
      'cycle', (select jsonb_build_object('median_seconds', round((percentile_cont(0.5) within group (order by x.s))::numeric, 0), 'cycles', count(*),
          'running_seconds', round(coalesce(sum(x.s), 0)))
        from (select extract(epoch from p.event_at - lag(p.event_at) over (order by p.event_at, p.seq)) s, p.source from private.ap2_pushes p where p.production_job_id = j.id) x
        where x.s is not null and x.source = 'tap' and x.s <= st.idle_gap_minutes * 60),
      'recovery_percent', case when j.status = 'completed' and j.actual_quantity_kg > 0 then
          (select round(j.actual_quantity_kg * 100 / nullif(coalesce(nullif(sum(coalesce(b.measured_weight_kg, b.weight_kg)), 0),
            (select sum(p.billet_kg) from private.ap2_pushes p where p.production_job_id = j.id)), 0), 2)
           from public.foundry_billets b where b.company_id = c.company_id and b.production_job_id = j.id and b.status in ('allocated', 'issued', 'consumed')) end,
      'derivation', (select to_jsonb(d) - 'company_id' from public.production_scrap_derivations d where d.production_job_id = j.id),
      'die_change', (select jsonb_build_object('id', x.id, 'minutes', round(x.duration_seconds / 60.0, 1), 'from_die', (select die_number from public.dies where id = x.from_die_id))
        from public.press_die_changes x where x.to_job_id = j.id),
      'sampling', private.ap2_job_sampling(c.company_id, j.id),
      'samples', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'occurrence_key', r.occurrence_key, 'status', r.status, 'due_at', r.due_at,
          'blocks_release', r.blocks_release, 'recorded_late', r.recorded_late) order by r.due_at desc) from (select * from public.qc_sample_requirements x
          where x.production_job_id = j.id order by x.due_at desc limit 10) r), '[]'::jsonb),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'seq', p.seq, 'at', p.event_at, 'source', p.source, 'billet_kg', p.billet_kg, 'basis', p.billet_kg_basis,
          'operator', (select u.full_name from public.app_users u where u.id = p.operator_id),
          'voided', exists (select 1 from public.production_push_events v where v.voids_event_id = p.id)) order by p.seq desc)
        from (select * from public.production_push_events x where x.production_job_id = j.id and x.kind = 'push' order by x.seq desc limit 10) p), '[]'::jsonb));

  elsif p_command = 'expected' then
    perform private.ap_keys(p_payload, array['job_id']);
    if not (c.role = any(private.ap2_floor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    return private.ap2_prepare_expected(c.company_id, private.ap_uuid(p_payload, 'job_id'));

  elsif p_command = 'cycle_times' then
    perform private.ap_keys(p_payload, array['die_id']);
    v_id := private.ap_uuid(p_payload, 'die_id');
    if not exists (select 1 from public.dies d where d.id = v_id and d.company_id = c.company_id) then raise exception 'AP: Die not found.'; end if;
    return jsonb_build_object('die_id', v_id, 'points', coalesce((select jsonb_agg(jsonb_build_object('at', x.event_at, 'seconds', round(x.s), 'job', x.job_number) order by x.event_at)
      from (select * from (select p.event_at, j2.job_number, p.source, s2.idle_gap_minutes gap,
          extract(epoch from p.event_at - lag(p.event_at) over (partition by p.production_job_id order by p.event_at, p.seq)) s
        from private.ap2_pushes p join public.production_jobs j2 on j2.id = p.production_job_id
        cross join lateral private.ap2_settings(c.company_id, p.machine_id) s2
        where p.company_id = c.company_id and p.die_id = v_id) y where y.s is not null and y.source = 'tap' and y.s <= y.gap * 60 order by y.event_at desc limit 200) x), '[]'::jsonb));

  elsif p_command = 'floor' then
    perform private.ap_keys(p_payload, array[]::text[]);
    select * into v_shift from private.ap2_shift_window(c.company_id, clock_timestamp());
    return jsonb_build_object('now', clock_timestamp(), 'shift', case when v_shift.code is not null then jsonb_build_object('code', v_shift.code, 'starts_at', v_shift.starts_at, 'ends_at', v_shift.ends_at) end,
      'presses', coalesce((select jsonb_agg(x order by x ->> 'name') from (select jsonb_build_object('machine_id', m.id, 'name', private.ap2_machine_name(m.id),
        'running', (select jsonb_agg(jsonb_build_object('id', r.id, 'job_number', r.job_number)) from public.production_jobs r where r.company_id = c.company_id and r.machine_id = m.id and r.status = 'in_progress'),
        'target', case when v_shift.code is not null then private.ap2_shift_target(c.company_id, m.id, v_shift.starts_at, v_shift.ends_at) end,
        'actual', case when v_shift.code is not null then private.ap2_shift_actual(c.company_id, m.id, v_shift.starts_at, v_shift.ends_at) end,
        'last_push_at', (select max(p.event_at) from private.ap2_pushes p where p.company_id = c.company_id and p.machine_id = m.id),
        'idle_gap_minutes', (select s.idle_gap_minutes from private.ap2_settings(c.company_id, m.id) s),
        'today', (select jsonb_build_object('idle_minutes', coalesce(sum(d.idle_minutes), 0), 'explained_minutes', coalesce(sum(d.explained_minutes), 0))
          from private.ap2_downtime_days(c.company_id, v_today, v_today, m.id) d),
        'unexplained_open', (select count(*) from public.press_idle_intervals i2 where i2.company_id = c.company_id and i2.machine_id = m.id and i2.reason is null),
        'die_changes_week', (select jsonb_build_object('count', count(*), 'avg_minutes', round(avg(dc.duration_seconds) / 60.0, 1)) from public.press_die_changes dc
          where dc.company_id = c.company_id and dc.machine_id = m.id and dc.first_push_at >= date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')) x
        from public.machines m where m.company_id = c.company_id and m.is_active and m.machine_type = 'extrusion_press') m2(x)), '[]'::jsonb));

  elsif p_command = 'downtime' then
    perform private.ap_keys(p_payload, array['from', 'to', 'machine_id', 'page']);
    v_to := coalesce(nullif(p_payload ->> 'to', '')::date, v_today); v_from := coalesce(nullif(p_payload ->> 'from', '')::date, v_to - 6);
    if v_to < v_from or v_to - v_from > 62 then raise exception 'AP: Choose a range of up to 63 days.'; end if;
    v_machine := private.ap_uuid(p_payload, 'machine_id', false);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    select count(*) into v_total from public.press_idle_intervals i2 where i2.company_id = c.company_id and i2.reason is null and (v_machine is null or i2.machine_id = v_machine)
      and i2.gap_start < ((v_to + 1)::timestamp at time zone 'Asia/Kolkata') and coalesce(i2.gap_end, clock_timestamp()) > (v_from::timestamp at time zone 'Asia/Kolkata');
    return jsonb_build_object('from', v_from, 'to', v_to,
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.on_day, 'machine_id', d.machine_id, 'machine', private.ap2_machine_name(d.machine_id), 'idle_minutes', d.idle_minutes,
          'explained_minutes', d.explained_minutes, 'coverage_percent', case when d.idle_minutes > 0 then round(d.explained_minutes * 100 / d.idle_minutes, 1) end, 'by_reason', d.by_reason)
        order by d.on_day desc, private.ap2_machine_name(d.machine_id)) from private.ap2_downtime_days(c.company_id, v_from, v_to, v_machine) d), '[]'::jsonb),
      'totals', (select jsonb_build_object('idle_minutes', coalesce(sum(d.idle_minutes), 0), 'explained_minutes', coalesce(sum(d.explained_minutes), 0),
          'coverage_percent', case when sum(d.idle_minutes) > 0 then round(sum(d.explained_minutes) * 100 / sum(d.idle_minutes), 1) end)
        from private.ap2_downtime_days(c.company_id, v_from, v_to, v_machine) d),
      'unexplained', jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'machine', private.ap2_machine_name(x.machine_id),
          'gap_start', x.gap_start, 'gap_end', x.gap_end, 'minutes', round(extract(epoch from coalesce(x.gap_end, clock_timestamp()) - x.gap_start) / 60, 1),
          'suggested_reason', x.suggested_reason, 'job_number', (select job_number from public.production_jobs where id = x.production_job_id)) order by x.gap_start desc)
        from (select * from public.press_idle_intervals i2 where i2.company_id = c.company_id and i2.reason is null and (v_machine is null or i2.machine_id = v_machine)
          and i2.gap_start < ((v_to + 1)::timestamp at time zone 'Asia/Kolkata') and coalesce(i2.gap_end, clock_timestamp()) > (v_from::timestamp at time zone 'Asia/Kolkata')
          order by i2.gap_start desc limit 10 offset (v_page - 1) * 10) x), '[]'::jsonb)));

  elsif p_command = 'die_changes' then
    perform private.ap_keys(p_payload, array['weeks', 'machine_id', 'page']);
    v_weeks := coalesce(private.ap2_num(p_payload, 'weeks', 'Weeks', 1, 26, false)::integer, 8);
    v_machine := private.ap_uuid(p_payload, 'machine_id', false);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    select count(*) into v_total from public.press_die_changes dc where dc.company_id = c.company_id and (v_machine is null or dc.machine_id = v_machine)
      and dc.first_push_at > now() - make_interval(weeks => v_weeks);
    return jsonb_build_object('weeks', v_weeks,
      'summary', coalesce((select jsonb_agg(jsonb_build_object('week', w.wk, 'machine', private.ap2_machine_name(w.machine_id), 'machine_id', w.machine_id, 'count', w.n, 'avg_minutes', w.avg_min)
          order by w.wk desc, private.ap2_machine_name(w.machine_id))
        from (select (date_trunc('week', dc.first_push_at at time zone 'Asia/Kolkata'))::date wk, dc.machine_id, count(*) n,
            round(avg(coalesce((select k.corrected_duration_seconds from public.press_die_change_corrections k where k.die_change_id = dc.id and k.corrected_duration_seconds is not null
              order by k.created_at desc limit 1), dc.duration_seconds)) / 60.0, 1) avg_min
          from public.press_die_changes dc where dc.company_id = c.company_id and (v_machine is null or dc.machine_id = v_machine) and dc.first_push_at > now() - make_interval(weeks => v_weeks)
          group by 1, 2) w), '[]'::jsonb),
      'total_count', v_total, 'page', v_page,
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', dc.id, 'machine', private.ap2_machine_name(dc.machine_id), 'from_die', (select die_number from public.dies where id = dc.from_die_id),
          'to_die', (select die_number from public.dies where id = dc.to_die_id), 'to_job', (select job_number from public.production_jobs where id = dc.to_job_id), 'to_job_id', dc.to_job_id,
          'last_push_at', dc.last_push_at, 'first_push_at', dc.first_push_at, 'minutes', round(dc.duration_seconds / 60.0, 1),
          'corrected_minutes', (select round(k.corrected_duration_seconds / 60.0, 1) from public.press_die_change_corrections k where k.die_change_id = dc.id and k.corrected_duration_seconds is not null order by k.created_at desc limit 1),
          'notes', (select jsonb_agg(jsonb_build_object('note', k.note, 'at', k.created_at, 'by', (select full_name from public.app_users where id = k.created_by)) order by k.created_at)
            from public.press_die_change_corrections k where k.die_change_id = dc.id)) order by dc.first_push_at desc)
        from (select * from public.press_die_changes x where x.company_id = c.company_id and (v_machine is null or x.machine_id = v_machine) and x.first_push_at > now() - make_interval(weeks => v_weeks)
          order by x.first_push_at desc limit 10 offset (v_page - 1) * 10) dc), '[]'::jsonb));

  elsif p_command = 'die_change_correct' then
    perform private.ap_keys(p_payload, array['id', 'duration_minutes', 'note']);
    v_note := private.ap_text(p_payload ->> 'note', 'Note', 3, 300);
    v_minutes := private.ap2_num(p_payload, 'duration_minutes', 'Duration in minutes', 0, 1440, false);
    if v_minutes is not null and not (c.role = any(private.ap2_supervisor_roles())) then raise exception 'AP: Only a supervisor can correct a die change duration; add a note instead.'; end if;
    if not exists (select 1 from public.press_die_changes dc where dc.id = private.ap_uuid(p_payload, 'id') and dc.company_id = c.company_id) then raise exception 'AP: Die change not found.'; end if;
    insert into public.press_die_change_corrections(company_id, die_change_id, corrected_duration_seconds, note, created_by)
      values (c.company_id, private.ap_uuid(p_payload, 'id'), case when v_minutes is not null then round(v_minutes * 60)::integer end, v_note, c.actor_id) returning id into v_id;
    return jsonb_build_object('state', 'saved', 'id', v_id);

  elsif p_command = 'settings' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('presses', coalesce((select jsonb_agg(jsonb_build_object('machine_id', m.id, 'name', private.ap2_machine_name(m.id), 'idle_gap_minutes', s.idle_gap_minutes,
        'die_change_allowance_minutes', s.die_change_allowance_minutes, 'configured', s.configured, 'measured_die_change_minutes', private.ap2_measured_die_change_minutes(c.company_id, m.id))
        order by private.ap2_machine_name(m.id))
      from public.machines m cross join lateral private.ap2_settings(c.company_id, m.id) s where m.company_id = c.company_id and m.is_active and m.machine_type = 'extrusion_press'), '[]'::jsonb),
      'can_edit', c.role = any(private.ap2_supervisor_roles()));

  elsif p_command = 'settings_save' then
    perform private.ap_keys(p_payload, array['machine_id', 'idle_gap_minutes', 'die_change_allowance_minutes']);
    if not (c.role = any(private.ap2_supervisor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    v_machine := private.ap_uuid(p_payload, 'machine_id');
    if not exists (select 1 from public.machines m where m.id = v_machine and m.company_id = c.company_id and m.machine_type = 'extrusion_press') then raise exception 'AP: Choose a press.'; end if;
    insert into public.press_floor_settings(company_id, machine_id, idle_gap_minutes, die_change_allowance_minutes, updated_by, updated_at)
      values (c.company_id, v_machine, private.ap2_num(p_payload, 'idle_gap_minutes', 'Idle gap minutes', 2, 240)::integer,
        private.ap2_num(p_payload, 'die_change_allowance_minutes', 'Die change allowance minutes', 0, 480)::integer, c.actor_id, now())
      on conflict (company_id, machine_id) do update set idle_gap_minutes = excluded.idle_gap_minutes, die_change_allowance_minutes = excluded.die_change_allowance_minutes,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    return jsonb_build_object('state', 'saved');
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_press(text, jsonb) from public, anon;
grant execute on function public.ap_press(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-013: scrap standards and the monthly reconciliation
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap2_standard_row(s public.scrap_standards)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(s) - 'company_id' || jsonb_build_object(
    'scope', case when s.die_id is not null then 'die' when s.machine_id is not null then 'press' else 'company' end,
    'scope_label', coalesce((select 'Die ' || d.die_number from public.dies d where d.id = s.die_id), case when s.machine_id is not null then private.ap2_machine_name(s.machine_id) end, 'All presses'),
    'proposed_by_name', (select u.full_name from public.app_users u where u.id = s.proposed_by),
    'approved_by_name', (select u.full_name from public.app_users u where u.id = s.approved_by))
$$;
revoke all on function private.ap2_standard_row(public.scrap_standards) from public, anon, authenticated;

create or replace function public.ap_scrap(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer; v_total bigint; s public.scrap_standards%rowtype; v_machine uuid; v_die uuid; v_month date; v_id uuid; v_status text;
begin
  select * into c from private.ap_ctx(private.ap2_floor_roles() || array['quality', 'inventory_manager']);
  if p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'status']);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    v_status := nullif(p_payload ->> 'status', '');
    if v_status is not null and v_status not in ('proposed', 'approved', 'retired') then raise exception 'AP: Invalid filter.'; end if;
    select count(*) into v_total from public.scrap_standards x where x.company_id = c.company_id and (v_status is null or x.status = v_status);
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'can_propose', c.role = any(private.ap2_supervisor_roles()), 'can_approve', c.role = 'owner',
      'rows', coalesce((select jsonb_agg(private.ap2_standard_row(x) order by (x.status = 'approved') desc, x.proposed_at desc) from (select * from public.scrap_standards y
        where y.company_id = c.company_id and (v_status is null or y.status = v_status) order by (y.status = 'approved') desc, y.proposed_at desc limit 10 offset (v_page - 1) * 10) x), '[]'::jsonb));
  elsif p_command = 'propose' then
    perform private.ap_keys(p_payload, array['machine_id', 'die_id', 'butt_length_mm', 'front_crop_mm', 'back_crop_mm', 'saw_kerf_mm', 'density_kg_m3', 'default_billet_length_mm', 'rationale']);
    if not (c.role = any(private.ap2_supervisor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    v_machine := private.ap_uuid(p_payload, 'machine_id', false); v_die := private.ap_uuid(p_payload, 'die_id', false);
    if v_machine is not null and v_die is not null then raise exception 'AP: A standard applies to one press or one die, not both.'; end if;
    if v_machine is not null and not exists (select 1 from public.machines m where m.id = v_machine and m.company_id = c.company_id and m.machine_type = 'extrusion_press') then raise exception 'AP: Choose a press.'; end if;
    if v_die is not null and not exists (select 1 from public.dies d where d.id = v_die and d.company_id = c.company_id and d.deleted_at is null) then raise exception 'AP: Choose a die.'; end if;
    insert into public.scrap_standards(company_id, machine_id, die_id, version, butt_length_mm, front_crop_mm, back_crop_mm, saw_kerf_mm, density_kg_m3, default_billet_length_mm, rationale, proposed_by)
      values (c.company_id, v_machine, v_die,
        coalesce((select max(x.version) from public.scrap_standards x where x.company_id = c.company_id and x.machine_id is not distinct from v_machine and x.die_id is not distinct from v_die), 0) + 1,
        private.ap2_num(p_payload, 'butt_length_mm', 'Butt length (mm)', 0.1, 200), private.ap2_num(p_payload, 'front_crop_mm', 'Front crop (mm)', 0, 5000),
        private.ap2_num(p_payload, 'back_crop_mm', 'Back crop (mm)', 0, 5000), private.ap2_num(p_payload, 'saw_kerf_mm', 'Saw kerf (mm)', 0, 20),
        coalesce(private.ap2_num(p_payload, 'density_kg_m3', 'Density (kg/m3)', 2500, 2900, false), 2700),
        private.ap2_num(p_payload, 'default_billet_length_mm', 'Standard billet length (mm)', 100, 2000, false),
        private.ap_text(p_payload ->> 'rationale', 'Rationale', 5, 500), c.actor_id) returning * into s;
    return jsonb_build_object('state', 'proposed', 'standard', private.ap2_standard_row(s));
  elsif p_command in ('approve', 'retire') then
    perform private.ap_keys(p_payload, array['id']);
    if c.role <> 'owner' then raise exception 'AP: Only the owner approves or retires scrap standards.'; end if;
    select * into s from public.scrap_standards where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if s.id is null then raise exception 'AP: Standard not found.'; end if;
    if p_command = 'approve' then
      if s.status <> 'proposed' then raise exception 'AP: Only a proposed standard can be approved.'; end if;
      update public.scrap_standards set status = 'retired', retired_by = c.actor_id, retired_at = now()
        where company_id = c.company_id and status = 'approved' and machine_id is not distinct from s.machine_id and die_id is not distinct from s.die_id;
      update public.scrap_standards set status = 'approved', approved_by = c.actor_id, approved_at = now() where id = s.id returning * into s;
    else
      if s.status = 'retired' then return jsonb_build_object('state', 'retired', 'standard', private.ap2_standard_row(s)); end if;
      update public.scrap_standards set status = 'retired', retired_by = c.actor_id, retired_at = now() where id = s.id returning * into s;
    end if;
    return jsonb_build_object('state', s.status, 'standard', private.ap2_standard_row(s));
  elsif p_command = 'reconcile' then
    perform private.ap_keys(p_payload, array['month']);
    if coalesce(p_payload ->> 'month', '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'AP: Choose a month.'; end if;
    v_month := ((p_payload ->> 'month') || '-01')::date;
    return (select jsonb_build_object('month', to_char(v_month, 'YYYY-MM'),
      'derived_engineering_kg', coalesce((select sum(d.butt_kg + d.crop_kg + d.saw_kg + d.cutoff_kg) from public.production_scrap_derivations d where d.company_id = c.company_id
        and (d.created_at at time zone 'Asia/Kolkata')::date between v_month and (v_month + interval '1 month - 1 day')::date), 0),
      'derived_process_kg', coalesce((select sum(d.reject_kg) from public.production_scrap_derivations d where d.company_id = c.company_id
        and (d.created_at at time zone 'Asia/Kolkata')::date between v_month and (v_month + interval '1 month - 1 day')::date), 0),
      'jobs_derived', (select count(*) from public.production_scrap_derivations d where d.company_id = c.company_id
        and (d.created_at at time zone 'Asia/Kolkata')::date between v_month and (v_month + interval '1 month - 1 day')::date),
      'entered_kg', coalesce((select sum(l.weight_kg) from public.production_scrap_lines l where l.company_id = c.company_id and l.scrap_basis = 'entered'
        and (l.created_at at time zone 'Asia/Kolkata')::date between v_month and (v_month + interval '1 month - 1 day')::date), 0),
      'weighed_kg', (select sum(w.weighed_kg) from public.scrap_yard_weighings w where w.company_id = c.company_id and w.month = v_month),
      'weighings', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'weighed_kg', w.weighed_kg, 'reference', w.reference, 'recorded_at', w.recorded_at,
        'recorded_by', (select u.full_name from public.app_users u where u.id = w.recorded_by)) order by w.recorded_at) from public.scrap_yard_weighings w where w.company_id = c.company_id and w.month = v_month), '[]'::jsonb)) x);
  elsif p_command = 'weigh' then
    perform private.ap_keys(p_payload, array['month', 'weighed_kg', 'reference']);
    if not (c.role = any(private.ap2_supervisor_roles() || array['inventory_manager'])) then raise exception 'Not permitted' using errcode = '42501'; end if;
    if coalesce(p_payload ->> 'month', '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'AP: Choose a month.'; end if;
    v_month := ((p_payload ->> 'month') || '-01')::date;
    if v_month > date_trunc('month', private.ist_today())::date then raise exception 'AP: Weighings cannot be recorded for a future month.'; end if;
    insert into public.scrap_yard_weighings(company_id, month, weighed_kg, reference, recorded_by)
      values (c.company_id, v_month, private.ap2_num(p_payload, 'weighed_kg', 'Weighed kg', 0.001, 100000000), private.ap_text(p_payload ->> 'reference', 'Reference', 1, 80, false), c.actor_id)
      returning id into v_id;
    return jsonb_build_object('state', 'saved', 'id', v_id);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_scrap(text, jsonb) from public, anon;
grant execute on function public.ap_scrap(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-028: die service counters, flags, die selection hints and bookings
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.ap_dies(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer; v_total bigint; v_profile uuid; b public.die_service_bookings%rowtype; v_note text; v_reason text;
begin
  select * into c from private.ap_ctx(private.ap2_floor_roles() || array['quality', 'sales_manager']);
  if p_command = 'service' then
    perform private.ap_keys(p_payload, array['die_id']);
    return coalesce(private.ap2_die_service(c.company_id, private.ap_uuid(p_payload, 'die_id')), jsonb_build_object('missing', true))
      || jsonb_build_object('can_book', c.role = any(private.ap2_supervisor_roles()));
  elsif p_command = 'flags' then
    perform private.ap_keys(p_payload, array['page']);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    return (with f as materialized (select d.id, d.die_number, x info, case x ->> 'flag' when 'due_unbooked' then 0 when 'due_booked' then 1 else 2 end ord
        from public.dies d cross join lateral private.ap2_die_service(c.company_id, d.id) x
        where d.company_id = c.company_id and d.deleted_at is null and d.die_status not in ('retired', 'scrapped') and x ->> 'flag' is not null)
      select jsonb_build_object('total_count', (select count(*) from f), 'page', v_page, 'rows', coalesce((select jsonb_agg(t.info order by t.ord, t.die_number)
        from (select * from f order by f.ord, f.die_number limit 10 offset (v_page - 1) * 10) t), '[]'::jsonb)));
  elsif p_command = 'options' then
    perform private.ap_keys(p_payload, array['profile_id', 'page']);
    v_profile := private.ap_uuid(p_payload, 'profile_id', false);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    select count(*) into v_total from public.dies d where d.company_id = c.company_id and d.deleted_at is null and d.die_status in ('active', 'approved') and (v_profile is null or d.profile_id = v_profile);
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'die_number', d.die_number,
        'state', x ->> 'state', 'flag', x ->> 'flag', 'due_in_pushes', x -> 'due_in_pushes') order by d.die_number)
      from (select * from public.dies y where y.company_id = c.company_id and y.deleted_at is null and y.die_status in ('active', 'approved') and (v_profile is null or y.profile_id = v_profile)
        order by y.die_number limit 10 offset (v_page - 1) * 10) d cross join lateral private.ap2_die_service(c.company_id, d.id) x), '[]'::jsonb));
  elsif p_command = 'booking_close' then
    perform private.ap_keys(p_payload, array['id', 'status', 'note', 'correction_reason']);
    if not (c.role = any(private.ap2_supervisor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    if coalesce(p_payload ->> 'status', '') not in ('done', 'cancelled') then raise exception 'AP: Choose done or cancelled.'; end if;
    v_note := private.ap_text(p_payload ->> 'note', 'Note', 3, 300);
    select * into b from public.die_service_bookings where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if b.id is null then raise exception 'AP: Booking not found.'; end if;
    if b.status <> 'booked' then return jsonb_build_object('state', b.status, 'id', b.id, 'repeated', true); end if;
    update public.die_service_bookings set status = p_payload ->> 'status', closed_by = c.actor_id, closed_at = now(), close_note = v_note where id = b.id;
    if p_payload ->> 'status' = 'done' then
      -- Recording the service resets the die's counters through the existing die history.
      if b.service_event = 'nitriding' then
        insert into public.die_nitriding_history(company_id, die_id, nitriding_cycle_number, nitriding_date, status, notes, created_by)
          values (c.company_id, b.die_id, coalesce((select max(n.nitriding_cycle_number) from public.die_nitriding_history n where n.die_id = b.die_id), 0) + 1,
            private.ist_today(), 'completed', 'Recorded from service booking: ' || v_note, c.actor_id);
      else
        v_reason := coalesce(nullif(p_payload ->> 'correction_reason', ''), 'other');
        if v_reason not in ('die_lines', 'dimensional', 'surface_pickup', 'slow_speed', 'bearing_issue', 'tongue_ratio', 'other') then raise exception 'AP: Choose a correction reason.'; end if;
        insert into public.die_corrections(company_id, die_id, correction_date, correction_reason, notes, created_by)
          values (c.company_id, b.die_id, private.ist_today(), v_reason, 'Recorded from service booking: ' || v_note, c.actor_id);
      end if;
    end if;
    return jsonb_build_object('state', p_payload ->> 'status', 'id', b.id);
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_dies(text, jsonb) from public, anon;
grant execute on function public.ap_dies(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-054: preventive maintenance plans
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap2_pm_row(p public.pm_plans)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(p) - 'company_id' || jsonb_build_object('machine', private.ap2_machine_name(p.machine_id), 'counter', k,
    'state', case when p.status = 'retired' then 'retired' when (k ->> 'value')::numeric >= p.interval_value then 'due' when (k ->> 'value')::numeric >= p.interval_value * 0.9 then 'approaching' else 'ok' end,
    'scheduled', (select jsonb_build_object('id', w.id, 'window_start', w.window_start, 'window_end', w.window_end) from public.pm_work_orders w where w.plan_id = p.id and w.status = 'scheduled'),
    'last_done', (select jsonb_build_object('done_at', w.done_at, 'counter_at_done', w.counter_at_done, 'by', (select u.full_name from public.app_users u where u.id = w.completed_by))
      from public.pm_work_orders w where w.plan_id = p.id and w.status = 'done' order by w.done_at desc limit 1))
  from (select private.ap2_pm_counter(p) k) x
$$;
revoke all on function private.ap2_pm_row(public.pm_plans) from public, anon, authenticated;

create or replace function public.ap_pm(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer; v_total bigint; p public.pm_plans%rowtype; w public.pm_work_orders%rowtype; v_k jsonb; v_machine uuid;
begin
  select * into c from private.ap_ctx(private.ap2_floor_roles());
  if p_command = 'plans' then
    perform private.ap_keys(p_payload, array['page', 'machine_id', 'status']);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    v_machine := private.ap_uuid(p_payload, 'machine_id', false);
    select count(*) into v_total from public.pm_plans x where x.company_id = c.company_id and x.status = coalesce(nullif(p_payload ->> 'status', ''), 'active') and (v_machine is null or x.machine_id = v_machine);
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'can_edit', c.role = any(private.ap2_supervisor_roles()),
      'presses', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', private.ap2_machine_name(m.id)) order by private.ap2_machine_name(m.id)) from public.machines m
        where m.company_id = c.company_id and m.is_active and m.machine_type = 'extrusion_press'), '[]'::jsonb),
      'rows', coalesce((select jsonb_agg(private.ap2_pm_row(x) order by x.machine_id, x.asset_kind, x.task) from (select * from public.pm_plans y where y.company_id = c.company_id
        and y.status = coalesce(nullif(p_payload ->> 'status', ''), 'active') and (v_machine is null or y.machine_id = v_machine)
        order by y.machine_id, y.asset_kind, y.task limit 10 offset (v_page - 1) * 10) x), '[]'::jsonb));
  elsif p_command = 'save' then
    perform private.ap_keys(p_payload, array['machine_id', 'asset_kind', 'asset_label', 'task', 'basis', 'interval_value', 'window_hours', 'safety_critical']);
    if not (c.role = any(private.ap2_supervisor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    v_machine := private.ap_uuid(p_payload, 'machine_id');
    if not exists (select 1 from public.machines m where m.id = v_machine and m.company_id = c.company_id and m.machine_type = 'extrusion_press') then raise exception 'AP: Choose the press whose running hours drive this task.'; end if;
    if coalesce(p_payload ->> 'asset_kind', '') not in ('press', 'puller', 'saw', 'container', 'billet_heater', 'stretcher', 'other') then raise exception 'AP: Choose the asset.'; end if;
    if coalesce(p_payload ->> 'basis', '') not in ('running_hours', 'pushes') then raise exception 'AP: Choose running hours or pushes.'; end if;
    if jsonb_typeof(p_payload -> 'safety_critical') is distinct from 'boolean' then raise exception 'AP: Say whether the task is safety-critical.'; end if;
    insert into public.pm_plans(company_id, machine_id, asset_kind, asset_label, task, basis, interval_value, window_hours, safety_critical, created_by)
      values (c.company_id, v_machine, p_payload ->> 'asset_kind', private.ap_text(p_payload ->> 'asset_label', 'Asset name', 2, 80, false), private.ap_text(p_payload ->> 'task', 'Task', 3, 120),
        p_payload ->> 'basis', private.ap2_num(p_payload, 'interval_value', 'Interval', 0.01, 1000000), coalesce(private.ap2_num(p_payload, 'window_hours', 'Window hours', 0.25, 72, false), 2),
        (p_payload ->> 'safety_critical')::boolean, c.actor_id) returning * into p;
    return jsonb_build_object('state', 'saved', 'plan', private.ap2_pm_row(p));
  elsif p_command = 'retire' then
    perform private.ap_keys(p_payload, array['id']);
    if not (c.role = any(private.ap2_supervisor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    update public.pm_plans set status = 'retired', retired_by = c.actor_id, retired_at = now() where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'active' returning * into p;
    if p.id is null then raise exception 'AP: Active plan not found.'; end if;
    update public.proposals set status = 'stale' where company_id = c.company_id and proposal_type = 'maintenance.pm_due' and target_key = p.id::text and status = 'open';
    return jsonb_build_object('state', 'retired', 'id', p.id);
  elsif p_command = 'complete' then
    perform private.ap_keys(p_payload, array['plan_id', 'note']);
    select * into p from public.pm_plans where id = private.ap_uuid(p_payload, 'plan_id') and company_id = c.company_id and status = 'active' for update;
    if p.id is null then raise exception 'AP: Active plan not found.'; end if;
    v_k := private.ap2_pm_counter(p);
    select * into w from public.pm_work_orders where plan_id = p.id and status = 'scheduled' for update;
    if w.id is not null then
      update public.pm_work_orders set status = 'done', done_at = now(), counter_at_done = (v_k ->> 'value')::numeric, done_note = private.ap_text(p_payload ->> 'note', 'Note', 3, 300), completed_by = c.actor_id
        where id = w.id returning * into w;
    else
      insert into public.pm_work_orders(company_id, plan_id, status, counter_at_done, done_at, done_note, created_by, completed_by)
        values (c.company_id, p.id, 'done', (v_k ->> 'value')::numeric, now(), private.ap_text(p_payload ->> 'note', 'Note', 3, 300), c.actor_id, c.actor_id) returning * into w;
    end if;
    update public.proposals set status = 'stale' where company_id = c.company_id and proposal_type = 'maintenance.pm_due' and target_key = p.id::text and status = 'open';
    return jsonb_build_object('state', 'done', 'work_order_id', w.id, 'counter_at_done', w.counter_at_done);
  elsif p_command = 'compliance' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('assets', coalesce((select jsonb_agg(a order by a ->> 'machine', a ->> 'asset') from (
      select jsonb_build_object('machine', private.ap2_machine_name(x.machine_id), 'asset', x.asset_kind || coalesce(' · ' || x.asset_label, ''), 'plans', count(*),
        'done', sum(x.done), 'on_time', sum(x.on_time), 'overdue_now', sum(x.overdue),
        'compliance_percent', case when sum(x.done) + sum(x.overdue) > 0 then round(sum(x.on_time) * 100.0 / (sum(x.done) + sum(x.overdue)), 1) end) a
      from (select pl.machine_id, pl.asset_kind, pl.asset_label,
          (select count(*) from public.pm_work_orders w2 where w2.plan_id = pl.id and w2.status = 'done') done,
          (select count(*) from public.pm_work_orders w2 where w2.plan_id = pl.id and w2.status = 'done' and w2.counter_at_done <= pl.interval_value * 1.1) on_time,
          case when (private.ap2_pm_counter(pl) ->> 'value')::numeric > pl.interval_value * 1.1 then 1 else 0 end overdue
        from public.pm_plans pl where pl.company_id = c.company_id and pl.status = 'active') x
      group by x.machine_id, x.asset_kind, x.asset_label) s), '[]'::jsonb));
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_pm(text, jsonb) from public, anon;
grant execute on function public.ap_pm(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-016: sampling triggers and samples
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap2_sample_row(r public.qc_sample_requirements)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', r.id, 'job_id', r.production_job_id, 'job_number', j.job_number, 'machine', private.ap2_machine_name(j.machine_id),
    'profile_code', (select p.profile_code from public.aluminium_profiles p where p.id = j.profile_id), 'kind', r.kind, 'occurrence_key', r.occurrence_key,
    'at_push', r.at_push, 'window_push', r.window_push, 'window_ends_at', r.window_ends_at, 'due_at', r.due_at, 'blocks_release', r.blocks_release, 'status', r.status,
    'recorded_late', r.recorded_late, 'recorded_at', r.recorded_at, 'recorded_by', (select u.full_name from public.app_users u where u.id = r.recorded_by),
    'waive_reason', r.waive_reason, 'current_pushes', (select count(*) from private.ap2_pushes p where p.production_job_id = r.production_job_id))
  from public.production_jobs j where j.id = r.production_job_id
$$;
revoke all on function private.ap2_sample_row(public.qc_sample_requirements) from public, anon, authenticated;

create or replace function public.ap_sampling(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  c record; v_page integer; v_total bigint; v_plan public.inspection_plans%rowtype; t public.inspection_sampling_triggers%rowtype; r public.qc_sample_requirements%rowtype;
  v_items uuid[]; v_status text; x jsonb; it public.inspection_plan_items%rowtype; v_obs numeric; v_vis boolean; v_out text; v_fail integer := 0; v_late boolean; v_job text;
begin
  select * into c from private.ap_ctx(private.ap2_quality_roles() || array['production_manager', 'production']);
  if p_command = 'plans' then
    perform private.ap_keys(p_payload, array['page']);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    select count(*) into v_total from public.inspection_plans p where p.company_id = c.company_id and p.status = 'approved';
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'can_edit', c.role = any(private.ap2_quality_roles()),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version, 'profile_code', coalesce((select a.profile_code from public.aluminium_profiles a where a.id = p.profile_id), 'All profiles'),
          'sampling_instruction', p.sampling_instruction, 'items', (select count(*) from public.inspection_plan_items i where i.plan_id = p.id),
          'triggers', (select count(*) from public.inspection_sampling_triggers s where s.plan_id = p.id and s.status = 'active')) order by p.profile_id nulls first, p.version desc)
        from (select * from public.inspection_plans y where y.company_id = c.company_id and y.status = 'approved' order by y.profile_id nulls first, y.version desc limit 10 offset (v_page - 1) * 10) p), '[]'::jsonb));
  elsif p_command = 'triggers' then
    perform private.ap_keys(p_payload, array['plan_id']);
    select * into v_plan from public.inspection_plans where id = private.ap_uuid(p_payload, 'plan_id') and company_id = c.company_id;
    if v_plan.id is null then raise exception 'AP: Inspection plan not found.'; end if;
    return jsonb_build_object('plan', jsonb_build_object('id', v_plan.id, 'version', v_plan.version, 'status', v_plan.status, 'sampling_instruction', v_plan.sampling_instruction),
      'can_edit', c.role = any(private.ap2_quality_roles()),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'seq', i.seq, 'characteristic', i.characteristic, 'unit', i.unit) order by i.seq) from public.inspection_plan_items i where i.plan_id = v_plan.id), '[]'::jsonb),
      'triggers', coalesce((select jsonb_agg(to_jsonb(s) - 'company_id' order by s.status, s.created_at) from public.inspection_sampling_triggers s where s.plan_id = v_plan.id), '[]'::jsonb));
  elsif p_command = 'trigger_save' then
    perform private.ap_keys(p_payload, array['plan_id', 'kind', 'every_n', 'item_ids', 'blocks_release']);
    if not (c.role = any(private.ap2_quality_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    select * into v_plan from public.inspection_plans where id = private.ap_uuid(p_payload, 'plan_id') and company_id = c.company_id;
    if v_plan.id is null or v_plan.status <> 'approved' then raise exception 'AP: Sampling triggers attach to an approved inspection plan.'; end if;
    if coalesce(p_payload ->> 'kind', '') not in ('first_after_die_change', 'every_n_pushes', 'every_n_bundles', 'last_piece') then raise exception 'AP: Choose when the sample is taken.'; end if;
    if jsonb_typeof(p_payload -> 'blocks_release') is distinct from 'boolean' then raise exception 'AP: Say whether a missing sample blocks QC release.'; end if;
    if p_payload ? 'item_ids' and jsonb_typeof(p_payload -> 'item_ids') = 'array' and jsonb_array_length(p_payload -> 'item_ids') > 0 then
      select array_agg(distinct v::uuid) into v_items from jsonb_array_elements_text(p_payload -> 'item_ids') v;
      if exists (select 1 from unnest(v_items) u where not exists (select 1 from public.inspection_plan_items i where i.id = u and i.plan_id = v_plan.id)) then
        raise exception 'AP: Choose characteristics from this plan.'; end if;
    end if;
    insert into public.inspection_sampling_triggers(company_id, plan_id, kind, every_n, item_ids, blocks_release, created_by)
      values (c.company_id, v_plan.id, p_payload ->> 'kind',
        case when p_payload ->> 'kind' in ('every_n_pushes', 'every_n_bundles') then private.ap2_num(p_payload, 'every_n', 'Every how many', 1, 10000)::integer end,
        v_items, (p_payload ->> 'blocks_release')::boolean, c.actor_id) returning * into t;
    return jsonb_build_object('state', 'saved', 'trigger', to_jsonb(t) - 'company_id');
  elsif p_command = 'trigger_retire' then
    perform private.ap_keys(p_payload, array['id']);
    if not (c.role = any(private.ap2_quality_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    update public.inspection_sampling_triggers set status = 'retired', retired_by = c.actor_id, retired_at = now()
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'active' returning * into t;
    if t.id is null then raise exception 'AP: Active trigger not found.'; end if;
    return jsonb_build_object('state', 'retired', 'id', t.id);
  elsif p_command = 'samples' then
    perform private.ap_keys(p_payload, array['status', 'page', 'job_id']);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    v_status := coalesce(nullif(p_payload ->> 'status', ''), 'due');
    if v_status not in ('due', 'open', 'missed', 'recorded', 'waived', 'all') then raise exception 'AP: Invalid filter.'; end if;
    select count(*) into v_total from public.qc_sample_requirements q where q.company_id = c.company_id
      and (v_status = 'all' or (v_status = 'due' and q.status in ('open', 'missed')) or q.status = v_status)
      and (private.ap_uuid(p_payload, 'job_id', false) is null or q.production_job_id = private.ap_uuid(p_payload, 'job_id', false));
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', coalesce((select jsonb_agg(private.ap2_sample_row(q) order by q.blocks_release desc, q.due_at) from (
      select * from public.qc_sample_requirements y where y.company_id = c.company_id
        and (v_status = 'all' or (v_status = 'due' and y.status in ('open', 'missed')) or y.status = v_status)
        and (private.ap_uuid(p_payload, 'job_id', false) is null or y.production_job_id = private.ap_uuid(p_payload, 'job_id', false))
      order by (y.status in ('open', 'missed')) desc, y.blocks_release desc, y.due_at limit 10 offset (v_page - 1) * 10) q), '[]'::jsonb));
  elsif p_command = 'sample' then
    perform private.ap_keys(p_payload, array['id']);
    select * into r from public.qc_sample_requirements where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if r.id is null then raise exception 'AP: Sample not found.'; end if;
    select * into t from public.inspection_sampling_triggers where id = r.trigger_id;
    return private.ap2_sample_row(r) || jsonb_build_object('can_record', c.role = any(private.ap2_quality_roles()),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'seq', i.seq, 'characteristic', i.characteristic, 'unit', i.unit, 'method', i.method, 'nominal', i.nominal,
          'lower_limit', i.lower_limit, 'upper_limit', i.upper_limit, 'critical', i.critical,
          'result', (select jsonb_build_object('observed', s.observed, 'visual_ok', s.visual_ok, 'outcome', s.outcome) from public.qc_sample_results s where s.requirement_id = r.id and s.item_id = i.id)) order by i.seq)
        from public.inspection_plan_items i where i.plan_id = r.plan_id and (t.item_ids is null or i.id = any(t.item_ids))), '[]'::jsonb));
  elsif p_command = 'sample_record' then
    perform private.ap_keys(p_payload, array['id', 'results']);
    if not (c.role = any(private.ap2_quality_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    select * into r from public.qc_sample_requirements where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if r.id is null then raise exception 'AP: Sample not found.'; end if;
    if r.status in ('recorded', 'waived') then raise exception 'AP: This sample is already %.', r.status; end if;
    if jsonb_typeof(p_payload -> 'results') <> 'array' then raise exception 'AP: Record every characteristic.'; end if;
    select * into t from public.inspection_sampling_triggers where id = r.trigger_id;
    for it in select * from public.inspection_plan_items i where i.plan_id = r.plan_id and (t.item_ids is null or i.id = any(t.item_ids)) order by i.seq loop
      select value into x from jsonb_array_elements(p_payload -> 'results') where value ->> 'item_id' = it.id::text limit 1;
      if x is null then raise exception 'AP: Record %.', it.characteristic; end if;
      v_obs := case when coalesce(x ->> 'observed', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (x ->> 'observed')::numeric end;
      v_vis := case when jsonb_typeof(x -> 'visual_ok') = 'boolean' then (x ->> 'visual_ok')::boolean end;
      if (it.lower_limit is not null or it.upper_limit is not null) and v_obs is null then raise exception 'AP: Enter the measured value for %.', it.characteristic; end if;
      if (v_obs is null) = (v_vis is null) then raise exception 'AP: Give either a measured value or a visual result for %.', it.characteristic; end if;
      v_out := case when v_vis is not null then case when v_vis then 'pass' else 'fail' end
        when (it.lower_limit is null or v_obs >= it.lower_limit) and (it.upper_limit is null or v_obs <= it.upper_limit) then 'pass' else 'fail' end;
      if v_out = 'fail' then v_fail := v_fail + 1; end if;
      insert into public.qc_sample_results(company_id, requirement_id, item_id, observed, visual_ok, outcome, recorded_by) values (c.company_id, r.id, it.id, v_obs, v_vis, v_out, c.actor_id);
    end loop;
    v_late := r.status = 'missed' or (r.window_ends_at is not null and r.window_ends_at < clock_timestamp())
      or (r.window_push is not null and (select count(*) from private.ap2_pushes p where p.production_job_id = r.production_job_id) >= r.window_push);
    update public.qc_sample_requirements set status = 'recorded', recorded_at = clock_timestamp(), recorded_by = c.actor_id, recorded_late = v_late where id = r.id;
    if v_fail > 0 then
      select coalesce(job_number, left(id::text, 8)) into v_job from public.production_jobs where id = r.production_job_id;
      insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, entity_reference, related_entity_type, related_entity_id)
        select c.company_id, rl, 'qc_sample_failed', 'critical', 'Sample failed on ' || v_job, v_fail || ' characteristic(s) out of limits. Check the press before continuing.',
          '/production/' || r.production_job_id, 'qc-sample-failed:' || r.id, 'production_job', r.production_job_id
        from unnest(array['production_manager', 'factory_manager']) rl;
    end if;
    return jsonb_build_object('state', 'recorded', 'id', r.id, 'failed', v_fail, 'late', v_late);
  elsif p_command = 'sample_waive' then
    perform private.ap_keys(p_payload, array['id', 'reason']);
    if not (c.role = any(private.ap2_quality_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    update public.qc_sample_requirements set status = 'waived', waived_by = c.actor_id, waived_at = clock_timestamp(), waive_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 8, 300)
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status in ('open', 'missed') returning * into r;
    if r.id is null then raise exception 'AP: Only an open or missed sample can be waived.'; end if;
    return jsonb_build_object('state', 'waived', 'id', r.id);
  elsif p_command = 'queue' then
    perform private.ap_keys(p_payload, array['limit']);
    return jsonb_build_object('total_count', (select count(*) from public.qc_sample_requirements q where q.company_id = c.company_id and q.status in ('open', 'missed')),
      'rows', coalesce((select jsonb_agg(private.ap2_sample_row(q) order by q.blocks_release desc, q.due_at) from (select * from public.qc_sample_requirements y
        where y.company_id = c.company_id and y.status in ('open', 'missed') order by y.blocks_release desc, y.due_at
        limit greatest(1, least(20, coalesce((p_payload ->> 'limit')::integer, 10)))) q), '[]'::jsonb));
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_sampling(text, jsonb) from public, anon;
grant execute on function public.ap_sampling(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Batch 1 extension points. The batch 1 bodies are kept verbatim under ap1_* names; the public names now dispatch
-- batch 2 job keys and proposal types first and fall back to batch 1 unchanged.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap1_job_execute(p_company uuid, p_job text, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_examined integer := 0; v_proposals integer := 0; v_alerts integer := 0; v_n integer; v_id uuid; r record;
  v_today date := private.ist_today(); v_lock date; v_month date; v_items jsonb; v_days integer; v_total bigint; v_covered bigint; v_close_day integer;
begin
  if p_job = 'proposals.refresh' then
    select count(*) into v_examined from public.proposals where company_id = p_company and status = 'open';
    update public.proposals set status = 'expired' where company_id = p_company and status = 'open' and expires_at <= now();
    get diagnostics v_n = row_count;
    update public.proposals p set status = 'stale' where p.company_id = p_company and p.status = 'open'
      and md5(coalesce(private.ap_proposal_versions(p.company_id, p.proposal_type, p.target_key), 'null'::jsonb)::text) <> p.inputs_fingerprint;
    get diagnostics v_alerts = row_count;
    return jsonb_build_object('examined', v_examined, 'proposals', 0, 'alerts', 0, 'details', jsonb_build_object('expired', v_n, 'stale', v_alerts));
  elsif p_job = 'navigation.propose' then
    for r in select x.role_name from unnest(private.ap_nav_roles()) x(role_name) loop
      v_examined := v_examined + 1;
      select count(distinct v.visit_date) into v_days from public.navigation_visit_counts v where v.company_id = p_company and v.role = r.role_name and v.visit_date > v_today - 28;
      continue when v_days < 14;
      select coalesce(sum(v.visits), 0) into v_total from public.navigation_visit_counts v where v.company_id = p_company and v.role = r.role_name and v.visit_date > v_today - 28;
      select jsonb_agg(t.route order by t.visits desc, t.route), sum(t.visits) into v_items, v_covered from (
        select v.route, sum(v.visits) visits from public.navigation_visit_counts v where v.company_id = p_company and v.role = r.role_name and v.visit_date > v_today - 28
        group by v.route order by sum(v.visits) desc, v.route limit 9) t;
      continue when v_items is null or jsonb_array_length(v_items) < 3;
      continue when exists (select 1 from public.role_navigation n where n.company_id = p_company and n.role = r.role_name and to_jsonb(n.items) = v_items);
      v_id := private.ap_proposal_create(p_company, 'navigation.role_layout', r.role_name, 'Main navigation for ' || replace(r.role_name, '_', ' '),
        jsonb_build_object('items', v_items),
        jsonb_build_object('window_days', 28, 'days_observed', v_days, 'total_visits', v_total,
          'visits', (select jsonb_agg(jsonb_build_object('route', t.route, 'visits', t.visits) order by t.visits desc, t.route) from (
            select v.route, sum(v.visits)::integer visits from public.navigation_visit_counts v where v.company_id = p_company and v.role = r.role_name and v.visit_date > v_today - 28
            group by v.route order by sum(v.visits) desc, v.route limit 15) t)),
        'navigation.top_visited_28d', 'These are the destinations people in this role opened most over the last 28 days (' || v_days || ' days with visits). Other pages stay under More and in search.',
        case when v_total > 0 then round(v_covered::numeric / v_total, 3) end, array['owner', 'admin'], 24 * 14, p_run);
      if v_id is not null then v_proposals := v_proposals + 1; end if;
    end loop;
  elsif p_job = 'series.propose' then
    for r in select * from (values
      ('invoices', 'OMX/{FY}/', 'Tax invoice numbers that restart on 1 April (for example OMX/26-27/0001)'),
      ('credit_notes', 'CN/{FY}/', 'Credit note numbers that restart on 1 April (for example CN/26-27/0001)'),
      ('quotes', 'Q/{FY}/', 'Quotation numbers by financial year (for example Q/26-27/0001)'),
      ('orders', 'SO/{FY}/', 'Sales order numbers by financial year (for example SO/26-27/0001)'),
      ('dispatches', 'DC/{FY}/', 'Delivery challan numbers by financial year (for example DC/26-27/0001)')) d(doc_key, template, title) loop
      v_examined := v_examined + 1;
      continue when exists (select 1 from public.document_series s where s.company_id = p_company and s.doc_key = r.doc_key and s.status = 'active');
      v_id := private.ap_proposal_create(p_company, 'series.adopt', r.doc_key, r.title, jsonb_build_object('prefix_template', r.template, 'pad_width', 4),
        jsonb_build_object('fy', private.ap_fy_label(v_today, true), 'example', private.ap_series_stem(r.template, v_today) || '0001',
          'gst_limit', case when r.doc_key in ('invoices', 'credit_notes') then 16 end),
        'series.fy_default', 'Accounts and GST returns expect numbering that restarts every financial year. Existing numbers stay as they are; new documents use this series once you confirm it.',
        null, array['owner', 'admin', 'accounts'], 24 * 30, p_run);
      if v_id is not null then v_proposals := v_proposals + 1; end if;
    end loop;
  elsif p_job = 'calendar.check' then
    v_examined := 1;
    if not exists (select 1 from public.factory_calendar_exceptions e where e.company_id = p_company and e.removed_at is null and e.kind in ('holiday', 'shutdown')
        and e.date_to >= v_today and e.date_from <= v_today + 120)
      and not exists (select 1 from public.notifications n where n.company_id = p_company and n.entity_reference = 'calendar-check:' || to_char(v_today, 'YYYY-MM')) then
      insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, entity_reference)
      select p_company, rl, 'calendar_check', 'warning', 'Enter the factory holidays',
        'No holiday or shutdown is entered for the next four months. Delivery promises and capacity count every non-weekly-off day as working until they are entered.',
        '/production/calendar', 'calendar-check:' || to_char(v_today, 'YYYY-MM')
      from unnest(array['owner', 'factory_manager', 'production_manager']) rl;
      get diagnostics v_alerts = row_count;
    end if;
  elsif p_job = 'periods.propose_close' then
    v_examined := 1;
    select coalesce((select p.close_proposal_day from public.period_policies p where p.company_id = p_company), 5) into v_close_day;
    v_lock := private.books_locked_through(p_company);
    v_month := case when v_lock is null then (date_trunc('month', v_today) - interval '1 month')::date else date_trunc('month', v_lock + 1)::date end;
    if (v_month + interval '1 month - 1 day')::date < v_today
      and (v_month < (date_trunc('month', v_today) - interval '1 month')::date or extract(day from v_today) >= v_close_day)
      and (v_lock is not null or exists (select 1 from public.invoices i where i.company_id = p_company and i.invoice_date between v_month and (v_month + interval '1 month - 1 day')::date)
        or exists (select 1 from public.payments i where i.company_id = p_company and i.payment_date between v_month and (v_month + interval '1 month - 1 day')::date)) then
      v_id := private.ap_proposal_create(p_company, 'period.close_month', to_char(v_month, 'YYYY-MM'), 'Close ' || to_char(v_month, 'FMMonth YYYY'),
        jsonb_build_object('month', to_char(v_month, 'YYYY-MM')),
        jsonb_build_object('locked_through', v_lock, 'month_end', (v_month + interval '1 month - 1 day')::date,
          'invoices', (select count(*) from public.invoices i where i.company_id = p_company and i.invoice_date between v_month and (v_month + interval '1 month - 1 day')::date),
          'payments', (select count(*) from public.payments i where i.company_id = p_company and i.payment_date between v_month and (v_month + interval '1 month - 1 day')::date),
          'open_backdate_flags', (select count(*) from public.backdated_entry_flags f where f.company_id = p_company and f.reviewed_at is null)),
        'periods.close_after_day', 'The month has ended and the close day (' || v_close_day || ') has passed. Closing stops new entries dated in it; corrections then need an approved reopen.',
        null, array['owner', 'admin', 'accounts'], 24 * 10, p_run);
      if v_id is not null then v_proposals := 1; end if;
    end if;
  else
    raise exception 'Unknown job %', p_job;
  end if;
  return jsonb_build_object('examined', v_examined, 'proposals', v_proposals, 'alerts', v_alerts, 'details', '{}'::jsonb);
end;
$$;
revoke all on function private.ap1_job_execute(uuid, text, uuid) from public, anon, authenticated;
create or replace function private.ap1_proposal_versions(p_company uuid, p_type text, p_target text)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select case p_type
    when 'navigation.role_layout' then jsonb_build_object('layout_version',
      (select n.version from public.role_navigation n where n.company_id = p_company and n.role = p_target))
    when 'period.close_month' then jsonb_build_object('locked_through', private.books_locked_through(p_company))
    when 'series.adopt' then jsonb_build_object('active_series',
      (select s.id from public.document_series s where s.company_id = p_company and s.doc_key = p_target and s.status = 'active'))
  end
$$;
revoke all on function private.ap1_proposal_versions(uuid, text, text) from public, anon, authenticated;
create or replace function private.ap1_proposal_editable(p_type text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_type when 'navigation.role_layout' then array['items'] when 'series.adopt' then array['prefix_template', 'pad_width'] else array[]::text[] end
$$;
revoke all on function private.ap1_proposal_editable(text) from public, anon, authenticated;
create or replace function private.ap1_proposal_apply(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  if p_proposal.proposal_type = 'navigation.role_layout' then
    if p_role not in ('owner', 'admin') then raise exception 'Not permitted' using errcode = '42501'; end if;
    return private.ap_nav_apply(p_company, p_actor, p_proposal.target_key, private.ap_nav_items(p_payload -> 'items'), 'proposal', p_proposal.id);
  elsif p_proposal.proposal_type = 'period.close_month' then
    if (p_payload ->> 'month') is distinct from p_proposal.target_key then raise exception 'AP: The month of a close proposal cannot be changed.'; end if;
    return private.ap_close_month(p_company, p_actor, p_role, (p_proposal.target_key || '-01')::date, 'Month close accepted from the system proposal ' || p_proposal.id::text);
  elsif p_proposal.proposal_type = 'series.adopt' then
    return private.ap_series_activate(p_company, p_actor, p_role, p_proposal.target_key, p_payload, p_proposal.id);
  end if;
  raise exception 'AP: Unknown proposal type.';
end;
$$;
revoke all on function private.ap1_proposal_apply(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-012 / AP-028 / AP-054 proposal types
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap2_proposal_versions(p_company uuid, p_type text, p_target text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_job uuid; v_die uuid; v_event text; v_plan uuid;
begin
  if p_type = 'production.expected_output' then
    v_job := p_target::uuid;
    return jsonb_build_object('status', (select j.status from public.production_jobs j where j.id = v_job and j.company_id = p_company),
      'events', (select count(*) from public.production_push_events e where e.production_job_id = v_job),
      'last_event', (select e.id from public.production_push_events e where e.production_job_id = v_job order by e.recorded_at desc, e.id desc limit 1),
      'billets', (select jsonb_build_array(count(*), coalesce(sum(coalesce(b.measured_weight_kg, b.weight_kg)), 0)) from public.foundry_billets b
        where b.company_id = p_company and b.production_job_id = v_job and b.status in ('allocated', 'issued', 'consumed')),
      'standard', (select x.id from public.production_jobs j cross join lateral private.ap2_standard(p_company, j.machine_id, j.die_id) x where j.id = v_job),
      'scrap', (select coalesce(sum(s.weight_kg), 0) from public.scrap_records s where s.company_id = p_company and s.production_job_id = v_job));
  elsif p_type = 'die.service_due' then
    v_die := split_part(p_target, ':', 1)::uuid; v_event := split_part(p_target, ':', 2);
    return jsonb_build_object('last_nitriding', (select max(n.nitriding_date) from public.die_nitriding_history n where n.company_id = p_company and n.die_id = v_die and coalesce(n.status, 'completed') = 'completed'),
      'last_correction', (select max(c.correction_date) from public.die_corrections c where c.company_id = p_company and c.die_id = v_die),
      'booking', (select b.id from public.die_service_bookings b where b.company_id = p_company and b.die_id = v_die and b.service_event = v_event and b.status = 'booked'),
      'die_status', (select d.die_status from public.dies d where d.id = v_die and d.company_id = p_company));
  elsif p_type = 'maintenance.pm_due' then
    v_plan := p_target::uuid;
    return jsonb_build_object('status', (select p.status from public.pm_plans p where p.id = v_plan and p.company_id = p_company),
      'last_done', (select max(w.done_at) from public.pm_work_orders w where w.plan_id = v_plan and w.status = 'done'),
      'scheduled', (select w.id from public.pm_work_orders w where w.plan_id = v_plan and w.status = 'scheduled'));
  end if;
  return null;
end;
$$;
revoke all on function private.ap2_proposal_versions(uuid, text, text) from public, anon, authenticated;

create or replace function private.ap_proposal_versions(p_company uuid, p_type text, p_target text)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select case when p_type in ('production.expected_output', 'die.service_due', 'maintenance.pm_due') then private.ap2_proposal_versions(p_company, p_type, p_target)
    else private.ap1_proposal_versions(p_company, p_type, p_target) end
$$;
revoke all on function private.ap_proposal_versions(uuid, text, text) from public, anon, authenticated;

create or replace function private.ap_proposal_editable(p_type text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_type
    when 'production.expected_output' then array['reject_pieces', 'reject_kg', 'reject_reason', 'good_pieces', 'good_kg']
    when 'die.service_due' then array['scheduled_for']
    when 'maintenance.pm_due' then array['window_start', 'window_end']
    else private.ap1_proposal_editable(p_type) end
$$;
revoke all on function private.ap_proposal_editable(text) from public, anon, authenticated;

-- AP-012: prepare (or refresh) the expected-output proposal of a running job. Nothing is posted here.
create or replace function private.ap2_prepare_expected(p_company uuid, p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare e jsonb; x jsonb; v_id uuid; j public.production_jobs%rowtype; v_conf numeric; p public.proposals%rowtype;
begin
  select * into j from public.production_jobs where id = p_job and company_id = p_company;
  if j.id is null then raise exception 'AP: Job not found.'; end if;
  e := private.ap2_job_expected(p_company, j.id);
  if not (e ->> 'complete')::boolean or jsonb_array_length(e -> 'blockers') > 0 then
    update public.proposals set status = 'stale' where company_id = p_company and proposal_type = 'production.expected_output' and target_key = j.id::text and status = 'open';
    return jsonb_build_object('state', 'not_ready', 'expected', e);
  end if;
  x := e -> 'expected';
  v_conf := case when (e ->> 'pushes')::numeric > 0 then round(1 - (e ->> 'estimated_pushes')::numeric / (e ->> 'pushes')::numeric, 3) end;
  v_id := private.ap_proposal_create(p_company, 'production.expected_output', j.id::text, 'Close ' || coalesce(j.job_number, 'job') || ' from ' || (e ->> 'pushes') || ' pushes',
    jsonb_build_object('good_pieces', (x ->> 'good_pieces')::integer, 'good_kg', (x ->> 'good_kg')::numeric, 'meters', (x ->> 'meters')::numeric,
      'butt_kg', (x ->> 'butt_kg')::numeric, 'crop_kg', (x ->> 'crop_kg')::numeric, 'saw_kg', (x ->> 'saw_kg')::numeric, 'cutoff_kg', (x ->> 'cutoff_kg')::numeric,
      'reject_pieces', 0, 'reject_kg', null, 'reject_reason', null, 'recovery_percent', x -> 'recovery_percent', 'bundles', x -> 'bundles'),
    jsonb_build_object('pushes', e -> 'pushes', 'billet_kg', e -> 'billet_kg', 'input_kg', e -> 'input_kg', 'input_basis', e -> 'input_basis', 'linked_billets', e -> 'linked_billets',
      'estimated_pushes', e -> 'estimated_pushes', 'standard', e -> 'standard', 'kg_per_m', e -> 'kg_per_m', 'cut_m', e -> 'cut_m', 'existing_scrap_kg', e -> 'existing_scrap_kg'),
    'press.expected_from_pushes',
    'Expected from the recorded pushes, the billets they used and the approved scrap standard. Enter only rejects and any shortfall; confirmed output is what posts stock.',
    v_conf, private.ap2_floor_roles(), 24, null);
  select * into p from public.proposals where company_id = p_company and proposal_type = 'production.expected_output' and target_key = j.id::text and status = 'open';
  return jsonb_build_object('state', 'ready', 'expected', e, 'proposal_id', p.id, 'created', v_id is not null);
end;
$$;
revoke all on function private.ap2_prepare_expected(uuid, uuid) from public, anon, authenticated;

-- AP-012 / AP-013: accepting the expected output completes the job through the existing completion transaction, with
-- engineering scrap derived from the standard and only the rejects entered by the person.
create or replace function private.ap2_apply_expected(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  e jsonb; x jsonb; j public.production_jobs%rowtype; v_rp integer; v_rkg numeric; v_reason text; v_gp integer; v_gkg numeric; v_piece numeric; v_input numeric;
  v_front numeric; v_tol numeric; v_lines jsonb; v_crop numeric; v_existing numeric;
begin
  if not (p_role = any(private.ap2_floor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
  select * into j from public.production_jobs where id = p_proposal.target_key::uuid and company_id = p_company for update;
  e := private.ap2_job_expected(p_company, j.id);
  if jsonb_array_length(e -> 'blockers') > 0 then raise exception 'AP: %', e -> 'blockers' ->> 0; end if;
  if not (e ->> 'complete')::boolean then raise exception 'AP: %', coalesce(e -> 'missing' ->> 0, 'Expected output cannot be calculated.'); end if;
  if (e ->> 'linked_billets')::integer = 0 and not exists (select 1 from public.production_input_exceptions i where i.company_id = p_company and i.production_job_id = j.id) then
    raise exception 'AP: Link the billets used by this job, or have a manager record an input exception, before completing it.';
  end if;
  x := e -> 'expected';
  v_rp := coalesce(private.ap2_num(p_payload, 'reject_pieces', 'Reject pieces', 0, 1000000, false), 0)::integer;
  v_rkg := private.ap2_num(p_payload, 'reject_kg', 'Reject kg', 0, 100000000, false);
  v_reason := nullif(p_payload ->> 'reject_reason', '');
  if (v_rp > 0 or coalesce(v_rkg, 0) > 0) and (v_reason is null or v_reason not in ('die_lines', 'dimension', 'surface', 'bend_twist', 'short_length', 'handling', 'other')) then
    raise exception 'AP: Choose the reason for the rejects.';
  end if;
  v_piece := (e ->> 'cut_m')::numeric * (e ->> 'kg_per_m')::numeric;
  v_gp := case when (p_payload -> 'good_pieces') is distinct from (p_proposal.payload -> 'good_pieces')
    then private.ap2_num(p_payload, 'good_pieces', 'Good pieces', 0, 10000000)::integer else (x ->> 'good_pieces')::integer - v_rp end;
  if v_gp < 0 then raise exception 'AP: Rejects are more than the expected pieces. Enter the good pieces instead.'; end if;
  if coalesce(j.pieces, 0) > 0 and v_gp = 0 then raise exception 'AP: Enter the good pieces; this job is planned in pieces.'; end if;
  v_gkg := case when (p_payload -> 'good_kg') is distinct from (p_proposal.payload -> 'good_kg')
    then private.ap2_num(p_payload, 'good_kg', 'Good kg', 0.001, 100000000) else round(v_gp * v_piece, 3) end;
  if v_gkg <= 0 then raise exception 'AP: Good output must be more than zero.'; end if;
  v_rkg := coalesce(v_rkg, round(v_rp * v_piece, 3));
  v_input := (e ->> 'input_kg')::numeric; v_existing := (e ->> 'existing_scrap_kg')::numeric;
  v_front := round(v_input - v_gkg - v_rkg - (x ->> 'butt_kg')::numeric - (x ->> 'saw_kg')::numeric - v_existing, 3);
  v_tol := greatest(0.5, round(v_input * 0.01, 3));
  if v_front < -v_tol then
    raise exception 'AP: Good output and rejects are % kg more than the billets can make. Check the pieces.', trim_scale(-v_front);
  end if;
  v_front := greatest(v_front, 0);
  v_lines := jsonb_build_array(jsonb_build_object('category', 'butt_end', 'weight_kg', (x ->> 'butt_kg')::numeric), jsonb_build_object('category', 'front_back_end', 'weight_kg', v_front),
    jsonb_build_object('category', 'saw_cut', 'weight_kg', (x ->> 'saw_kg')::numeric), jsonb_build_object('category', 'rejects', 'weight_kg', v_rkg));
  perform set_config('ap.scrap_basis', 'derived', true);
  perform public.complete_production_job_with_scrap_atomic(j.id, v_gkg, v_gp, round(v_gp * (e ->> 'cut_m')::numeric, 3), v_lines,
    left('Completed from expected output (' || (e ->> 'pushes') || ' pushes)' || case when v_rp > 0 or v_rkg > 0 then '; rejects: ' || replace(v_reason, '_', ' ') else '' end, 500));
  perform set_config('ap.scrap_basis', '', true);
  v_crop := least((x ->> 'crop_kg')::numeric, v_front);
  insert into public.production_scrap_derivations(company_id, production_job_id, proposal_id, standard_id, standard_version, pushes, billet_kg, butt_kg, crop_kg, saw_kg, cutoff_kg,
      reject_kg, reject_pieces, reject_reason, good_kg, good_pieces, created_by)
    values (p_company, j.id, p_proposal.id, (e -> 'standard' ->> 'id')::uuid, (e -> 'standard' ->> 'version')::integer, (e ->> 'pushes')::integer, v_input,
      (x ->> 'butt_kg')::numeric, v_crop, (x ->> 'saw_kg')::numeric, v_front - v_crop, v_rkg, v_rp, v_reason, v_gkg, v_gp, p_actor);
  return jsonb_build_object('job_id', j.id, 'good_kg', v_gkg, 'good_pieces', v_gp, 'reject_kg', v_rkg, 'front_back_end_kg', v_front,
    'recovery_percent', case when v_input > 0 then round(v_gkg * 100 / v_input, 2) end);
end;
$$;
revoke all on function private.ap2_apply_expected(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

create or replace function private.ap_proposal_apply(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_day date; v_start timestamptz; v_end timestamptz; v_block uuid; pl public.pm_plans%rowtype; v_id uuid; v_k jsonb;
begin
  if p_proposal.proposal_type = 'production.expected_output' then
    return private.ap2_apply_expected(p_company, p_actor, p_role, p_proposal, p_payload);
  elsif p_proposal.proposal_type = 'die.service_due' then
    if not (p_role = any(private.ap2_supervisor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    if coalesce(p_payload ->> 'scheduled_for', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'AP: Choose the service date.'; end if;
    v_day := (p_payload ->> 'scheduled_for')::date;
    if v_day < private.ist_today() or v_day > private.ist_today() + 60 then raise exception 'AP: Choose a service date within the next 60 days.'; end if;
    insert into public.die_service_bookings(company_id, die_id, service_event, scheduled_for, proposal_id, booked_by)
      values (p_company, split_part(p_proposal.target_key, ':', 1)::uuid, split_part(p_proposal.target_key, ':', 2), v_day, p_proposal.id, p_actor) returning id into v_id;
    return jsonb_build_object('booking_id', v_id, 'scheduled_for', v_day);
  elsif p_proposal.proposal_type = 'maintenance.pm_due' then
    if not (p_role = any(private.ap2_floor_roles())) then raise exception 'Not permitted' using errcode = '42501'; end if;
    select * into pl from public.pm_plans where id = p_proposal.target_key::uuid and company_id = p_company and status = 'active' for update;
    if pl.id is null then raise exception 'AP: This maintenance plan is no longer active.'; end if;
    begin
      v_start := (p_payload ->> 'window_start')::timestamptz; v_end := (p_payload ->> 'window_end')::timestamptz;
    exception when others then raise exception 'AP: Enter the maintenance window.';
    end;
    if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > interval '72 hours' then raise exception 'AP: The window must end after it starts and last at most 72 hours.'; end if;
    if v_start < now() - interval '1 hour' or v_start > now() + interval '30 days' then raise exception 'AP: Start the window within the next 30 days.'; end if;
    if (p_payload -> 'window_start') = (p_proposal.payload -> 'window_start') and (p_payload -> 'window_end') = (p_proposal.payload -> 'window_end')
      and nullif(p_proposal.payload ->> 'block_id', '') is not null then
      select b.id into v_block from public.factory_maintenance_blocks b where b.id = (p_proposal.payload ->> 'block_id')::uuid and b.company_id = p_company and b.machine_id = pl.machine_id and b.status = 'planned';
    end if;
    if v_block is null then
      insert into public.factory_maintenance_blocks(company_id, machine_id, starts_at, ends_at, reason, status, created_by)
        values (p_company, pl.machine_id, v_start, v_end, left('Preventive maintenance: ' || pl.task, 240), 'planned', p_actor) returning id into v_block;
    end if;
    v_k := private.ap2_pm_counter(pl);
    insert into public.pm_work_orders(company_id, plan_id, proposal_id, maintenance_block_id, window_start, window_end, status, counter_at_schedule, created_by)
      values (p_company, pl.id, p_proposal.id, v_block, v_start, v_end, 'scheduled', (v_k ->> 'value')::numeric, p_actor) returning id into v_id;
    return jsonb_build_object('work_order_id', v_id, 'maintenance_block_id', v_block);
  end if;
  return private.ap1_proposal_apply(p_company, p_actor, p_role, p_proposal, p_payload);
end;
$$;
revoke all on function private.ap_proposal_apply(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

-- AP-054: a safety-critical preventive task can be dismissed only by a supervisor.
create or replace function private.ap2_reject_check(p public.proposals, p_role text)
returns void language plpgsql stable security definer set search_path = public, private as $$
begin
  if p.proposal_type = 'maintenance.pm_due' and coalesce((p.inputs -> 'evidence' ->> 'safety_critical')::boolean, true)
    and not (p_role = any(private.ap2_supervisor_roles())) then
    raise exception 'AP: This is a safety-critical maintenance task. Only a supervisor can dismiss it.';
  end if;
end;
$$;
revoke all on function private.ap2_reject_check(public.proposals, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-001 jobs added by batch 2
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap_job_registry()
returns table(job_key text, schedule text, label text, description text)
language sql immutable set search_path = public, private as $$
  values
    ('proposals.refresh', 'hourly', 'Refresh open proposals', 'Marks proposals stale when their inputs changed and expired when their time passed.'),
    ('navigation.propose', 'nightly', 'Propose role navigation', 'After two weeks of visit counts, proposes the most used destinations for each role.'),
    ('series.propose', 'nightly', 'Propose financial-year numbering', 'Proposes a financial-year number series for each document type that has none.'),
    ('calendar.check', 'nightly', 'Check the factory calendar', 'Alerts the plant head when the coming months have no holidays or shutdowns entered.'),
    ('periods.propose_close', 'morning', 'Propose month close', 'Proposes closing the previous month once the close day is reached.'),
    ('press.idle_reconcile', 'nightly', 'Find unexplained press idle time', 'Records gaps between pushes that nobody explained, as unexplained (never with a guessed reason).'),
    ('dies.predict_service', 'hourly', 'Propose die service', 'Proposes nitriding or correction when a die reaches its approved interval.'),
    ('maintenance.propose_pm', 'hourly', 'Propose preventive maintenance', 'Proposes a maintenance window when a plan nears its running-hours or push interval.'),
    ('quality.sample_windows', 'hourly', 'Mark missed samples', 'Marks required quality samples as missed when their window has passed.')
$$;
revoke all on function private.ap_job_registry() from public, anon, authenticated;

create or replace function private.ap2_job_execute(p_company uuid, p_job text, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_examined integer := 0; v_proposals integer := 0; v_alerts integer := 0; v_n integer; v_id uuid; r record; d record; pl public.pm_plans%rowtype; v_k jsonb;
  v_block_id uuid; v_start timestamptz; v_end timestamptz; v_day date; v_shift jsonb;
begin
  if p_job = 'press.idle_reconcile' then
    for r in select x.machine_id, x.prev_at, x.event_at, x.production_job_id from (
        select p.machine_id, p.event_at, p.production_job_id, lag(p.event_at) over (partition by p.machine_id order by p.event_at, p.id) prev_at
        from private.ap2_pushes p where p.company_id = p_company and p.event_at > now() - interval '50 hours') x
      cross join lateral private.ap2_settings(p_company, x.machine_id) s
      where x.prev_at is not null and x.event_at - x.prev_at > make_interval(mins => s.idle_gap_minutes) and x.event_at - x.prev_at <= interval '16 hours' loop
      v_examined := v_examined + 1;
      insert into public.press_idle_intervals(company_id, machine_id, production_job_id, gap_start, gap_end, source, suggested_reason)
        values (p_company, r.machine_id, r.production_job_id, r.prev_at, r.event_at, 'reconciliation',
          case when exists (select 1 from public.press_die_changes c where c.company_id = p_company and c.machine_id = r.machine_id and c.last_push_at = r.prev_at) then 'die_change' end)
        on conflict (company_id, machine_id, gap_start) do update set gap_end = coalesce(public.press_idle_intervals.gap_end, excluded.gap_end),
          suggested_reason = coalesce(public.press_idle_intervals.suggested_reason, excluded.suggested_reason);
    end loop;
    select count(*) into v_n from public.press_idle_intervals i where i.company_id = p_company and i.reason is null and i.gap_start > now() - interval '50 hours';
    if v_n > 0 and not exists (select 1 from public.notifications n where n.company_id = p_company and n.entity_reference = 'idle-unexplained:' || private.ist_today()) then
      insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, action_link, entity_reference)
        select p_company, rl, 'press_idle_unexplained', 'warning', 'Press idle time needs a reason',
          v_n || ' idle gap(s) in the last two days have no reason. Choose one for each so the downtime report is complete.', '/production/floor', 'idle-unexplained:' || private.ist_today()
        from unnest(array['production_manager', 'factory_manager']) rl;
      get diagnostics v_alerts = row_count;
    end if;
  elsif p_job = 'dies.predict_service' then
    for d in select x.id, x.die_number, s from public.dies x cross join lateral private.ap2_die_service(p_company, x.id) s
        where x.company_id = p_company and x.deleted_at is null and x.die_status in ('active', 'approved') loop
      v_examined := v_examined + 1;
      for r in select c ->> 'service_event' ev, c ->> 'basis' basis, (c ->> 'value')::numeric val, (c ->> 'warn_at')::numeric warn from jsonb_array_elements(d.s -> 'checks') c
          where c ->> 'state' = 'due' loop
        continue when exists (select 1 from public.die_service_bookings b where b.company_id = p_company and b.die_id = d.id
          and b.service_event = case when r.ev = 'correction' then 'correction' else 'nitriding' end and b.status = 'booked');
        v_id := private.ap_proposal_create(p_company, 'die.service_due', d.id::text || ':' || case when r.ev = 'correction' then 'correction' else 'nitriding' end,
          case when r.ev = 'correction' then 'Book a correction for die ' else 'Book nitriding for die ' end || d.die_number,
          jsonb_build_object('die_id', d.id, 'service_event', case when r.ev = 'correction' then 'correction' else 'nitriding' end,
            'scheduled_for', private.factory_add_working_days(p_company, private.ist_today(), 1)),
          jsonb_build_object('basis', r.basis, 'value', r.val, 'warn_at', r.warn, 'service', d.s -> 'service', 'avg_billet_kg_per_push', d.s -> 'avg_billet_kg_per_push'),
          'die.threshold_reached', 'The die reached the approved interval for its family. The interval is die-shop policy; this prediction is advisory.',
          null, private.ap2_supervisor_roles(), 24 * 7, p_run);
        if v_id is not null then v_proposals := v_proposals + 1; end if;
      end loop;
    end loop;
  elsif p_job = 'maintenance.propose_pm' then
    for pl in select * from public.pm_plans x where x.company_id = p_company and x.status = 'active' loop
      v_examined := v_examined + 1;
      continue when exists (select 1 from public.pm_work_orders w where w.plan_id = pl.id and w.status = 'scheduled');
      v_k := private.ap2_pm_counter(pl);
      continue when (v_k ->> 'value')::numeric < pl.interval_value * 0.9;
      -- Prefer a planned maintenance window already on the press in the next seven days.
      select b.id, b.starts_at, b.ends_at into v_block_id, v_start, v_end from public.factory_maintenance_blocks b
        where b.company_id = p_company and b.machine_id = pl.machine_id and b.status = 'planned' and b.starts_at > now() and b.starts_at < now() + interval '7 days'
        order by b.starts_at limit 1;
      if v_block_id is null then
        v_day := private.factory_add_working_days(p_company, private.ist_today(), 1);
        select coalesce((select x.shifts -> 0 from public.factory_calendar_settings x where x.company_id = p_company), '{"start":"06:00"}'::jsonb) into v_shift;
        v_start := (v_day + (v_shift ->> 'start')::time) at time zone 'Asia/Kolkata';
        v_end := v_start + make_interval(secs => (pl.window_hours * 3600)::double precision);
      end if;
      v_id := private.ap_proposal_create(p_company, 'maintenance.pm_due', pl.id::text, 'Schedule ' || pl.task || ' on ' || private.ap2_machine_name(pl.machine_id),
        jsonb_build_object('plan_id', pl.id, 'window_start', v_start, 'window_end', v_end, 'block_id', v_block_id),
        jsonb_build_object('basis', pl.basis, 'interval', pl.interval_value, 'counter', v_k, 'safety_critical', pl.safety_critical, 'asset_kind', pl.asset_kind,
          'asset_label', pl.asset_label, 'window_source', case when v_block_id is not null then 'planned_block' else 'next_working_day' end),
        'maintenance.counter_due', 'The asset reached 90% of its ' || replace(pl.basis, '_', ' ') || ' interval. Accepting books the window and blocks press capacity for it.',
        null, private.ap2_floor_roles(), 24 * 3, p_run);
      if v_id is not null then v_proposals := v_proposals + 1; end if;
    end loop;
  elsif p_job = 'quality.sample_windows' then
    select count(*) into v_examined from public.qc_sample_requirements q where q.company_id = p_company and q.status = 'open';
    update public.qc_sample_requirements set status = 'missed', missed_at = clock_timestamp()
      where company_id = p_company and status = 'open' and window_ends_at is not null and window_ends_at < clock_timestamp();
    get diagnostics v_n = row_count;
    return jsonb_build_object('examined', v_examined, 'proposals', 0, 'alerts', 0, 'details', jsonb_build_object('missed', v_n));
  else
    return null;
  end if;
  return jsonb_build_object('examined', v_examined, 'proposals', v_proposals, 'alerts', v_alerts, 'details', '{}'::jsonb);
end;
$$;
revoke all on function private.ap2_job_execute(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.ap_job_execute(p_company uuid, p_job text, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  if p_job in ('press.idle_reconcile', 'dies.predict_service', 'maintenance.propose_pm', 'quality.sample_windows') then
    return private.ap2_job_execute(p_company, p_job, p_run);
  end if;
  return private.ap1_job_execute(p_company, p_job, p_run);
end;
$$;
revoke all on function private.ap_job_execute(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-016: last-piece samples when a job completes, and the QC release guard
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap2_on_job_completed()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_plan uuid; t public.inspection_sampling_triggers%rowtype; v_count integer;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    v_plan := private.applicable_inspection_plan(new.company_id, new.profile_id);
    if v_plan is not null then
      select count(*) into v_count from private.ap2_pushes p where p.production_job_id = new.id;
      for t in select * from public.inspection_sampling_triggers x where x.company_id = new.company_id and x.plan_id = v_plan and x.status = 'active' and x.kind = 'last_piece' loop
        perform private.ap2_sample_require(new.company_id, new.id, t, 'last', v_count, null, clock_timestamp() + interval '60 minutes');
      end loop;
    end if;
    update public.proposals set status = 'stale' where company_id = new.company_id and proposal_type = 'production.expected_output' and target_key = new.id::text and status = 'open';
  end if;
  return new;
end;
$$;
revoke all on function private.ap2_on_job_completed() from public, anon, authenticated;
drop trigger if exists zz_ap2_on_job_completed on public.production_jobs;
create trigger zz_ap2_on_job_completed after update of status on public.production_jobs for each row execute function private.ap2_on_job_completed();

create or replace function private.ap2_guard_sampling_release()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_n integer;
begin
  if new.status = 'approved' and new.production_job_id is not null and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    select count(*) into v_n from public.qc_sample_requirements r
      where r.company_id = new.company_id and r.production_job_id = new.production_job_id and r.blocks_release and r.status in ('open', 'missed');
    if v_n > 0 then
      raise exception 'AP: % required in-process sample(s) are not recorded for this job. Record or waive them before QC release.', v_n using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.ap2_guard_sampling_release() from public, anon, authenticated;
drop trigger if exists b_ap2_guard_sampling_release on public.quality_inspections;
create trigger b_ap2_guard_sampling_release before insert or update of status on public.quality_inspections for each row execute function private.ap2_guard_sampling_release();

-- AP-054 reject guard and AP-012 per-record listing added to the batch 1 decision and list functions (bodies otherwise unchanged).
create or replace function private.ap_proposal_decide(p_company uuid, p_actor uuid, p_role text, p_id uuid, p_decision text, p_payload jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  p public.proposals%rowtype; v_final jsonb; v_edited text[] := '{}'; v_key text; v_outcome jsonb; v_state text; v_note text;
begin
  if p_decision not in ('accept', 'edit', 'reject') then raise exception 'AP: Choose accept, edit or reject.'; end if;
  v_note := private.ap_text(p_note, 'Note', 3, 300, p_decision = 'reject');
  select * into p from public.proposals where id = p_id and company_id = p_company for update;
  if p.id is null or not (p_role = any(p.decide_roles)) then raise exception 'AP: This proposal is not available to you.'; end if;
  if p.status <> 'open' then
    if p.decided_by = p_actor and ((p_decision = 'reject') = (p.status = 'rejected')) then
      return jsonb_build_object('id', p.id, 'state', p.status, 'outcome', p.outcome, 'repeated', true);
    end if;
    raise exception 'AP: This proposal is already %.', p.status;
  end if;
  if p.expires_at <= now() then
    update public.proposals set status = 'expired' where id = p.id;
    return jsonb_build_object('id', p.id, 'state', 'expired', 'message', 'This proposal expired. The next scheduled run prepares a current one.');
  end if;
  if md5(coalesce(private.ap_proposal_versions(p_company, p.proposal_type, p.target_key), 'null'::jsonb)::text) <> p.inputs_fingerprint then
    update public.proposals set status = 'stale' where id = p.id;
    return jsonb_build_object('id', p.id, 'state', 'stale', 'message', 'The facts behind this proposal changed after it was prepared. It cannot be accepted; the next run prepares a current one.');
  end if;
  if p_decision = 'reject' then
    perform private.ap2_reject_check(p, p_role);
    update public.proposals set status = 'rejected', decided_by = p_actor, decided_at = now(), decision_note = v_note where id = p.id;
    return jsonb_build_object('id', p.id, 'state', 'rejected');
  end if;
  v_final := p.payload;
  if p_decision = 'edit' then
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' or exists (select 1 from jsonb_object_keys(p_payload) k where not (k = any(private.ap_proposal_editable(p.proposal_type)))) then
      raise exception 'AP: Only % can be changed on this proposal.', coalesce(nullif(array_to_string(private.ap_proposal_editable(p.proposal_type), ', '), ''), 'nothing');
    end if;
    for v_key in select jsonb_object_keys(p_payload) loop
      if (p_payload -> v_key) is distinct from (p.payload -> v_key) then v_edited := v_edited || v_key; v_final := v_final || jsonb_build_object(v_key, p_payload -> v_key); end if;
    end loop;
  end if;
  v_outcome := private.ap_proposal_apply(p_company, p_actor, p_role, p, v_final);
  v_state := case when cardinality(v_edited) > 0 then 'edited' else 'accepted' end;
  update public.proposals set status = v_state, decided_by = p_actor, decided_at = now(), decision_payload = v_final, edited_fields = v_edited,
    decision_note = v_note, outcome = v_outcome where id = p.id;
  return jsonb_build_object('id', p.id, 'state', v_state, 'edited_fields', to_jsonb(v_edited), 'outcome', v_outcome);
end;
$$;
revoke all on function private.ap_proposal_decide(uuid, uuid, text, uuid, text, jsonb, text) from public, anon, authenticated;

create or replace function public.ap_proposals(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_page integer; v_status text; v_type text; v_total bigint; v_results jsonb := '[]'::jsonb; v_id uuid; v_result jsonb; v_message text; v_target text; v_prefix text;
begin
  select * into c from private.ap_ctx(null);
  if p_command = 'list' then
    perform private.ap_keys(p_payload, array['status', 'type', 'page', 'target', 'target_prefix']);
    v_page := greatest(1, least(100000, coalesce((p_payload ->> 'page')::integer, 1)));
    v_status := coalesce(p_payload ->> 'status', 'open'); v_type := nullif(p_payload ->> 'type', ''); v_target := nullif(p_payload ->> 'target', ''); v_prefix := nullif(p_payload ->> 'target_prefix', '');
    if v_prefix is not null and v_prefix !~ '^[0-9a-f-]{36}:?$' then raise exception 'AP: Invalid filter.'; end if;
    if v_status not in ('open', 'decided', 'all') then raise exception 'AP: Invalid filter.'; end if;
    select count(*) into v_total from public.proposals p where p.company_id = c.company_id and (c.role = any(p.decide_roles) or c.role in ('owner', 'admin'))
      and (v_type is null or p.proposal_type = v_type) and (v_target is null or p.target_key = v_target) and (v_prefix is null or left(p.target_key, length(v_prefix)) = v_prefix) and (v_status = 'all' or (v_status = 'open') = (p.status = 'open'));
    return jsonb_build_object('total_count', v_total, 'page', v_page, 'rows', coalesce((select jsonb_agg(private.ap_proposal_row(x, c.role) order by x.created_at desc, x.id) from (
      select * from public.proposals p where p.company_id = c.company_id and (c.role = any(p.decide_roles) or c.role in ('owner', 'admin'))
        and (v_type is null or p.proposal_type = v_type) and (v_target is null or p.target_key = v_target) and (v_prefix is null or left(p.target_key, length(v_prefix)) = v_prefix) and (v_status = 'all' or (v_status = 'open') = (p.status = 'open'))
      order by p.created_at desc, p.id limit 10 offset (v_page - 1) * 10) x), '[]'::jsonb));
  elsif p_command = 'decide' then
    perform private.ap_keys(p_payload, array['id', 'decision', 'payload', 'note']);
    return private.ap_proposal_decide(c.company_id, c.actor_id, c.role, private.ap_uuid(p_payload, 'id'), p_payload ->> 'decision', p_payload -> 'payload', p_payload ->> 'note');
  elsif p_command = 'decide_batch' then
    perform private.ap_keys(p_payload, array['ids', 'decision', 'note']);
    if jsonb_typeof(p_payload -> 'ids') <> 'array' or jsonb_array_length(p_payload -> 'ids') not between 1 and 50 then raise exception 'AP: Choose 1 to 50 proposals.'; end if;
    if (p_payload ->> 'decision') not in ('accept', 'reject') then raise exception 'AP: A batch can only be accepted or rejected.'; end if;
    for v_id in select distinct (x)::uuid from jsonb_array_elements_text(p_payload -> 'ids') x loop
      begin
        v_result := private.ap_proposal_decide(c.company_id, c.actor_id, c.role, v_id, p_payload ->> 'decision', null, p_payload ->> 'note');
      exception when others then
        v_message := case when sqlerrm like 'AP: %' then substring(sqlerrm from 5) when sqlstate = '42501' then 'Not permitted.' else 'This proposal could not be applied; open it to review.' end;
        v_result := jsonb_build_object('id', v_id, 'state', 'failed', 'message', v_message);
      end;
      v_results := v_results || jsonb_build_array(v_result);
    end loop;
    return jsonb_build_object('results', v_results);
  elsif p_command = 'pending_count' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('count', (select count(*) from public.proposals p where p.company_id = c.company_id and p.status = 'open' and c.role = any(p.decide_roles) and p.expires_at > now()));
  end if;
  raise exception 'AP: Invalid request.';
end;
$$;
revoke all on function public.ap_proposals(text, jsonb) from public, anon;
grant execute on function public.ap_proposals(text, jsonb) to authenticated;

commit;
