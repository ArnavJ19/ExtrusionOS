-- FABLE_SUGGESTIONS FS-125: feed Die Intelligence.
--
-- die_health_metrics had no key to dies and nothing wrote it, so the die health screen showed status-based guesses.
-- Now every die has one row, keyed to the die, written only by private.fs_refresh_die_health from recorded facts:
--   * usage maintained by refresh_die_usage (dies.total_production_kg, total_runs, average_recovery_percent), which
--     runs on every completed job, so press events reach the metrics through the die row;
--   * QC rejections on the die's completed jobs;
--   * trials, corrections (with the FS-16 correction loop stage) and nitriding history, including kg and runs since
--     the last nitriding (kg, runs and issued billets);
--   * the recovery trend: average recovery of the last five completed jobs with billet input against the five before.
-- The health score keeps the published status rule (lib/dies/intelligence.ts healthFromStatus); the recommendation
-- is derived only from recorded facts and the die's own rated life. No new thresholds are introduced.

alter table public.die_health_metrics
  add column if not exists open_correction_count integer not null default 0,
  add column if not exists last_nitriding_date date,
  add column if not exists next_nitriding_due_date date,
  add column if not exists kg_since_nitriding numeric(14, 3),
  add column if not exists runs_since_nitriding integer,
  add column if not exists billets_since_nitriding integer,
  add column if not exists rated_life_kg numeric(14, 3),
  add column if not exists life_used_percent numeric(7, 2),
  add column if not exists recent_recovery_percent numeric(7, 2),
  add column if not exists previous_recovery_percent numeric(7, 2),
  add column if not exists recovery_trend text,
  add column if not exists basis jsonb not null default '{}'::jsonb;

alter table public.die_health_metrics drop constraint if exists die_health_metrics_recovery_trend_check;
alter table public.die_health_metrics add constraint die_health_metrics_recovery_trend_check
  check (recovery_trend is null or recovery_trend in ('improving', 'steady', 'declining', 'not_enough_runs'));

-- Rows whose die no longer exists cannot be keyed; they are kept aside, never silently dropped.
create table if not exists public.die_health_metrics_orphans (like public.die_health_metrics);
alter table public.die_health_metrics_orphans enable row level security;
revoke all on public.die_health_metrics_orphans from public, anon, authenticated;
insert into public.die_health_metrics_orphans
  select m.* from public.die_health_metrics m where not exists (select 1 from public.dies d where d.id = m.die_id and d.company_id = m.company_id)
  on conflict do nothing;
delete from public.die_health_metrics m where not exists (select 1 from public.dies d where d.id = m.die_id and d.company_id = m.company_id);

alter table public.die_health_metrics drop constraint if exists die_health_metrics_die_fk;
alter table public.die_health_metrics add constraint die_health_metrics_die_fk foreign key (die_id) references public.dies(id) on delete cascade; -- derived data: it goes with its die
create index if not exists die_health_metrics_company_die_idx on public.die_health_metrics(company_id, die_id);

-- Only the refresh function writes the metrics.
revoke insert, update, delete, truncate on public.die_health_metrics from public, anon, authenticated;

create or replace function private.fs_refresh_die_health(p_die uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  d public.dies%rowtype; n record; t record; c record; q record; r record;
  v_rated numeric; v_used numeric; v_trend text; v_recommendation text;
begin
  select * into d from public.dies where id = p_die;
  if d.id is null then return; end if;

  select count(*) n, max(trial_date) last into t from public.die_trials where company_id = d.company_id and die_id = d.id;
  select count(*) n, max(correction_date) last,
    count(*) filter (where coalesce(result_status, 'pending') in ('pending', 'partial')) open into c
    from public.die_corrections where company_id = d.company_id and die_id = d.id;
  select h.nitriding_date, h.next_nitriding_due_date into n from public.die_nitriding_history h
    where h.company_id = d.company_id and h.die_id = d.id order by h.nitriding_date desc nulls last, h.created_at desc limit 1;

  select coalesce(sum(j.actual_quantity_kg), 0) output,
    coalesce(sum((select coalesce(sum(x.quantity_checked_kg), 0) from public.quality_inspections x
      where x.company_id = d.company_id and x.production_job_id = j.id and x.status = 'rejected' and x.quantity_checked_kg > 0)), 0) rejected,
    coalesce(sum(j.actual_quantity_kg) filter (where n.nitriding_date is null or (j.completed_at at time zone 'Asia/Kolkata')::date > n.nitriding_date), 0) since_kg,
    count(*) filter (where n.nitriding_date is null or (j.completed_at at time zone 'Asia/Kolkata')::date > n.nitriding_date) since_runs,
    coalesce(sum((select count(*) from public.foundry_billets b where b.company_id = d.company_id and b.production_job_id = j.id and b.status in ('issued', 'consumed')))
      filter (where n.nitriding_date is null or (j.completed_at at time zone 'Asia/Kolkata')::date > n.nitriding_date), 0) since_billets
    into q from public.production_jobs j
    where j.company_id = d.company_id and j.die_id = d.id and j.status = 'completed';

  -- Recovery of each completed job with issued billet input, newest first.
  with runs as (
    select j.id, j.completed_at,
      (coalesce(j.actual_quantity_kg, 0) - coalesce((select sum(x.quantity_checked_kg) from public.quality_inspections x
         where x.company_id = d.company_id and x.production_job_id = j.id and x.status = 'rejected' and x.quantity_checked_kg > 0), 0)) good,
      (select sum(coalesce(b.measured_weight_kg, b.weight_kg)) from public.foundry_billets b
         where b.company_id = d.company_id and b.production_job_id = j.id and b.status in ('issued', 'consumed') and coalesce(b.measured_weight_kg, b.weight_kg) > 0) input
    from public.production_jobs j where j.company_id = d.company_id and j.die_id = d.id and j.status = 'completed' and j.completed_at is not null
  ), ranked as (select good, input, row_number() over (order by completed_at desc, id desc) rn from runs where input > 0 and good >= 0)
  select round(sum(good) filter (where rn <= 5) * 100 / nullif(sum(input) filter (where rn <= 5), 0), 2) recent,
    round(sum(good) filter (where rn between 6 and 10) * 100 / nullif(sum(input) filter (where rn between 6 and 10), 0), 2) previous,
    count(*) runs into r from ranked;
  v_trend := case when r.runs < 10 then 'not_enough_runs'
    when r.recent > r.previous then 'improving' when r.recent < r.previous then 'declining' else 'steady' end;

  v_rated := case when d.die_life_tons > 0 then d.die_life_tons * 1000 end;
  v_used := case when v_rated > 0 then round(coalesce(d.total_production_kg, 0) * 100 / v_rated, 2) end;
  v_recommendation := case
    when d.die_status = 'dead' then 'dead'
    when d.die_status = 'correction' or c.open > 0 then 'correction_needed'
    when v_used >= 100 then 'replace_soon'
    when d.die_status in ('trial', 'nitriding', 'inactive') or (n.next_nitriding_due_date is not null and n.next_nitriding_due_date <= private.business_today()) then 'monitor'
    else 'healthy' end;

  insert into public.die_health_metrics as m (company_id, die_id, total_output_kg, total_rejection_kg, rejection_rate, correction_count, trial_count,
    last_correction_date, last_trial_date, average_recovery_percent, health_score, recommendation, total_die_cost, cost_per_kg,
    open_correction_count, last_nitriding_date, next_nitriding_due_date, kg_since_nitriding, runs_since_nitriding, billets_since_nitriding, rated_life_kg, life_used_percent,
    recent_recovery_percent, previous_recovery_percent, recovery_trend, basis, updated_at)
  values (d.company_id, d.id, coalesce(d.total_production_kg, 0), q.rejected,
    case when q.output > 0 then least(round(q.rejected * 100 / q.output, 2), 999.99) else 0 end,
    c.n, t.n, c.last, t.last, d.average_recovery_percent,
    case d.die_status when 'dead' then 0 when 'inactive' then 25 when 'correction' then 45 when 'trial' then 70 when 'nitriding' then 70 else 85 end,
    v_recommendation, coalesce(d.die_cost, 0),
    case when coalesce(d.total_production_kg, 0) > 0 and coalesce(d.die_cost, 0) > 0 then least(round(d.die_cost / d.total_production_kg, 4), 9999.9999) else 0 end,
    c.open, n.nitriding_date, n.next_nitriding_due_date, q.since_kg, q.since_runs, q.since_billets, v_rated, v_used, r.recent, r.previous, v_trend,
    jsonb_build_object('usage', 'dies.total_production_kg from refresh_die_usage', 'rejections', 'rejected quality inspections on the die''s completed jobs',
      'recovery_trend', 'last 5 completed jobs with billet input against the 5 before', 'rated_life', case when v_rated is null then 'not recorded on the die' else 'dies.die_life_tons' end),
    now())
  on conflict (die_id) do update set total_output_kg = excluded.total_output_kg, total_rejection_kg = excluded.total_rejection_kg,
    rejection_rate = excluded.rejection_rate, correction_count = excluded.correction_count, trial_count = excluded.trial_count,
    last_correction_date = excluded.last_correction_date, last_trial_date = excluded.last_trial_date,
    average_recovery_percent = excluded.average_recovery_percent, health_score = excluded.health_score, recommendation = excluded.recommendation,
    total_die_cost = excluded.total_die_cost, cost_per_kg = excluded.cost_per_kg, open_correction_count = excluded.open_correction_count,
    last_nitriding_date = excluded.last_nitriding_date, next_nitriding_due_date = excluded.next_nitriding_due_date,
    kg_since_nitriding = excluded.kg_since_nitriding, runs_since_nitriding = excluded.runs_since_nitriding, billets_since_nitriding = excluded.billets_since_nitriding, rated_life_kg = excluded.rated_life_kg,
    life_used_percent = excluded.life_used_percent, recent_recovery_percent = excluded.recent_recovery_percent,
    previous_recovery_percent = excluded.previous_recovery_percent, recovery_trend = excluded.recovery_trend, basis = excluded.basis, updated_at = now();
end;
$$;
revoke all on function private.fs_refresh_die_health(uuid) from public, anon, authenticated;

create or replace function private.fs_die_health_from_child()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.die_id is distinct from new.die_id) then
    if old.die_id is not null then perform private.fs_refresh_die_health(old.die_id); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.die_id is not null then perform private.fs_refresh_die_health(new.die_id); end if;
  return null;
end;
$$;
revoke all on function private.fs_die_health_from_child() from public, anon, authenticated;

create or replace function private.fs_die_health_from_die()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  perform private.fs_refresh_die_health(new.id);
  return null;
end;
$$;
revoke all on function private.fs_die_health_from_die() from public, anon, authenticated;

create or replace function private.fs_die_health_from_inspection()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_die uuid;
begin
  for v_die in
    select distinct j.die_id from public.production_jobs j
    where j.die_id is not null and j.id in (case when tg_op <> 'INSERT' then old.production_job_id end, case when tg_op <> 'DELETE' then new.production_job_id end)
  loop perform private.fs_refresh_die_health(v_die); end loop;
  return null;
end;
$$;
revoke all on function private.fs_die_health_from_inspection() from public, anon, authenticated;

drop trigger if exists fs_die_health_trials on public.die_trials;
create trigger fs_die_health_trials after insert or update or delete on public.die_trials for each row execute function private.fs_die_health_from_child();
drop trigger if exists fs_die_health_corrections on public.die_corrections;
create trigger fs_die_health_corrections after insert or update or delete on public.die_corrections for each row execute function private.fs_die_health_from_child();
drop trigger if exists fs_die_health_nitriding on public.die_nitriding_history;
create trigger fs_die_health_nitriding after insert or update or delete on public.die_nitriding_history for each row execute function private.fs_die_health_from_child();
drop trigger if exists fs_die_health_die on public.dies;
create trigger fs_die_health_die after insert or update of total_production_kg, total_runs, average_recovery_percent, die_status, die_cost, die_life_tons
  on public.dies for each row execute function private.fs_die_health_from_die();
drop trigger if exists fs_die_health_jobs on public.production_jobs;
create trigger fs_die_health_jobs after update of status, actual_quantity_kg, die_id on public.production_jobs for each row
  when (new.die_id is not null and (new.status = 'completed' or old.status = 'completed')) execute function private.fs_die_health_from_child();
drop trigger if exists fs_die_health_inspections on public.quality_inspections;
create trigger fs_die_health_inspections after insert or update of status, quantity_checked_kg, production_job_id or delete on public.quality_inspections
  for each row execute function private.fs_die_health_from_inspection();

-- Backfill every die.
do $$ declare v uuid; begin for v in select id from public.dies loop perform private.fs_refresh_die_health(v); end loop; end $$;
