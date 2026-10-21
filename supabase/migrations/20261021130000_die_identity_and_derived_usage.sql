-- EXOS-AUD-020: die identity, profile and usage history were freely editable.
-- A production manager could renumber a die and move it to another profile while
-- a job was running on it, and die life / cost-per-kg / "Life Review" alerts used
-- hand-typed totals that no function maintained.
--
--   * die_number and profile_id are frozen once any non-cancelled production job
--     references the die. Re-cut or transferred tooling needs a new die record.
--   * Usage KPIs are derived from completed production:
--       total_production_kg = opening_production_kg + completed actual kg
--       total_runs          = opening_runs + completed job count
--       last_used_date      = latest of opening_last_used_date and completion dates
--       total_good_output_kg, total_input_weight_kg, total_billets_used,
--       total_scrap_kg, average_recovery_percent come from completed jobs only.
--     The opening_* columns hold pre-system history. On insert, posted totals are
--     taken as the opening balance. On update only an owner or admin may change
--     the totals, which is recorded as an opening adjustment (audited by the
--     existing dies audit trigger); other roles are rejected.
--   * Completion, output correction and scrap posting refresh the die.
-- Backfill keeps every die's current totals: opening = current - derived.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.dies
  add column if not exists opening_production_kg numeric(14,3) not null default 0,
  add column if not exists opening_runs integer not null default 0,
  add column if not exists opening_last_used_date date;

create or replace function private.die_usage_from_production(p_company_id uuid, p_die_id uuid)
returns table (good_kg numeric, runs integer, last_used date, input_kg numeric, billets integer, scrap_kg numeric)
language sql
stable
security definer
set search_path = public, private
as $$
  with jobs as (
    select j.id, j.actual_quantity_kg, j.completed_at, j.updated_at
    from public.production_jobs j
    where j.company_id = p_company_id and j.die_id = p_die_id and j.status = 'completed'
  )
  select
    coalesce((select sum(coalesce(actual_quantity_kg, 0)) from jobs), 0)::numeric,
    (select count(*) from jobs)::integer,
    (select max(coalesce(completed_at, updated_at))::date from jobs),
    coalesce((select sum(b.weight_kg) from public.foundry_billets b join jobs on jobs.id = b.production_job_id
      where b.company_id = p_company_id and b.status = 'consumed'), 0)::numeric,
    (select count(*) from public.foundry_billets b join jobs on jobs.id = b.production_job_id
      where b.company_id = p_company_id and b.status = 'consumed')::integer,
    coalesce((select sum(s.weight_kg) from public.scrap_records s join jobs on jobs.id = s.production_job_id
      where s.company_id = p_company_id), 0)::numeric
$$;
revoke all on function private.die_usage_from_production(uuid, uuid) from public, anon, authenticated;

-- Backfill opening balances before the derivation trigger exists (totals unchanged).
update public.dies d
set opening_production_kg = greatest(coalesce(d.total_production_kg, 0) - u.good_kg, 0),
    opening_runs = greatest(coalesce(d.total_runs, 0) - u.runs, 0),
    opening_last_used_date = d.last_used_date
from public.dies d2
cross join lateral private.die_usage_from_production(d2.company_id, d2.id) u
where d2.id = d.id;

create or replace function private.derive_die_usage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_usage record;
  v_role text := private.get_current_user_role();
  v_totals_changed boolean;
begin
  select * into v_usage from private.die_usage_from_production(new.company_id, new.id);

  if tg_op = 'INSERT' then
    new.opening_production_kg := coalesce(nullif(new.opening_production_kg, 0), new.total_production_kg, 0);
    new.opening_runs := coalesce(nullif(new.opening_runs, 0), new.total_runs, 0);
    new.opening_last_used_date := coalesce(new.opening_last_used_date, new.last_used_date);
  else
    if (new.die_number is distinct from old.die_number or new.profile_id is distinct from old.profile_id)
      and exists (select 1 from public.production_jobs j where j.company_id = old.company_id and j.die_id = old.id and j.status <> 'cancelled') then
      raise exception 'Die number and profile are frozen once the die has production history; register re-cut or transferred tooling as a new die'
        using errcode = '23514';
    end if;
    v_totals_changed := new.total_production_kg is distinct from old.total_production_kg
      or new.total_runs is distinct from old.total_runs
      or new.last_used_date is distinct from old.last_used_date
      or new.opening_production_kg is distinct from old.opening_production_kg
      or new.opening_runs is distinct from old.opening_runs
      or new.opening_last_used_date is distinct from old.opening_last_used_date;
    if v_totals_changed then
      if auth.uid() is not null and coalesce(v_role, '') not in ('owner','admin') then
        raise exception 'Die usage is derived from completed production; only an owner or admin can adjust the opening (pre-system) usage'
          using errcode = '42501';
      end if;
      -- Owner/admin edited the totals: record the difference as the opening balance.
      if new.opening_production_kg is not distinct from old.opening_production_kg and new.total_production_kg is distinct from old.total_production_kg then
        new.opening_production_kg := greatest(coalesce(new.total_production_kg, 0) - v_usage.good_kg, 0);
      end if;
      if new.opening_runs is not distinct from old.opening_runs and new.total_runs is distinct from old.total_runs then
        new.opening_runs := greatest(coalesce(new.total_runs, 0) - v_usage.runs, 0);
      end if;
      if new.opening_last_used_date is not distinct from old.opening_last_used_date and new.last_used_date is distinct from old.last_used_date then
        new.opening_last_used_date := new.last_used_date;
      end if;
    end if;
  end if;

  new.opening_production_kg := greatest(coalesce(new.opening_production_kg, 0), 0);
  new.opening_runs := greatest(coalesce(new.opening_runs, 0), 0);
  new.total_production_kg := new.opening_production_kg + v_usage.good_kg;
  new.total_runs := new.opening_runs + v_usage.runs;
  new.last_used_date := case
    when new.opening_last_used_date is null then v_usage.last_used
    when v_usage.last_used is null then new.opening_last_used_date
    else greatest(new.opening_last_used_date, v_usage.last_used) end;
  new.total_good_output_kg := v_usage.good_kg;
  new.total_input_weight_kg := v_usage.input_kg;
  new.total_billets_used := v_usage.billets;
  new.total_scrap_kg := v_usage.scrap_kg;
  new.average_recovery_percent := case when v_usage.input_kg > 0 then round(v_usage.good_kg / v_usage.input_kg * 100, 2) else null end;
  return new;
end;
$$;
revoke all on function private.derive_die_usage() from public, anon, authenticated;

drop trigger if exists b_derive_die_usage on public.dies;
create trigger b_derive_die_usage
before insert or update on public.dies
for each row execute function private.derive_die_usage();

create or replace function private.refresh_die_usage(p_company_id uuid, p_die_id uuid)
returns void
language sql
security definer
set search_path = public, private
as $$
  update public.dies set updated_at = now() where id = p_die_id and company_id = p_company_id;
$$;
revoke all on function private.refresh_die_usage(uuid, uuid) from public, anon, authenticated;

create or replace function private.refresh_die_usage_from_job()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'UPDATE' and old.die_id is not null and old.die_id is distinct from new.die_id then
    perform private.refresh_die_usage(old.company_id, old.die_id);
  end if;
  if new.die_id is not null and (new.status = 'completed' or (tg_op = 'UPDATE' and old.status = 'completed')) then
    perform private.refresh_die_usage(new.company_id, new.die_id);
  end if;
  return null;
end;
$$;
revoke all on function private.refresh_die_usage_from_job() from public, anon, authenticated;

drop trigger if exists refresh_die_usage_from_job on public.production_jobs;
create trigger refresh_die_usage_from_job
after insert or update of status, actual_quantity_kg, die_id, completed_at on public.production_jobs
for each row execute function private.refresh_die_usage_from_job();

create or replace function private.refresh_die_usage_from_scrap()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_die_id uuid;
begin
  if new.production_job_id is null then return null; end if;
  select die_id into v_die_id from public.production_jobs where id = new.production_job_id and company_id = new.company_id and status = 'completed';
  if v_die_id is not null then perform private.refresh_die_usage(new.company_id, v_die_id); end if;
  return null;
end;
$$;
revoke all on function private.refresh_die_usage_from_scrap() from public, anon, authenticated;

drop trigger if exists refresh_die_usage_from_scrap on public.scrap_records;
create trigger refresh_die_usage_from_scrap
after insert on public.scrap_records
for each row execute function private.refresh_die_usage_from_scrap();

commit;
