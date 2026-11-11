-- Autopilot jobs scheduled by Supabase pg_cron.
--
-- The Vercel Hobby plan accepts only daily crons, so the hourly schedule in vercel.json made every deployment fail.
-- The database now runs all three Autopilot schedules itself. The schedules are the same UTC times as before:
--   hourly  at :05                  (proposals, die service, PM, missed samples, invoice drafts, bank rematch, alerts)
--   nightly at 19:00 UTC = 00:30 IST (navigation, series, calendar, quote expiry)
--   morning at 02:30 UTC = 08:00 IST (period close, payment reminders)
-- /api/cron/<schedule> stays as a manual trigger. Runs are recorded once per job and window
-- (system_job_runs unique on company, job and window), so a second trigger in the same window does nothing.
--
-- private.ap_jobs_run holds the body of public.ap_jobs_cron without the service-role check (pg_cron has no JWT). Clients and
-- the service role cannot execute it. public.ap_jobs_cron keeps its check and now calls it.
-- Where pg_cron is not available (the local PGlite replay), the functions are created and scheduling is skipped.

begin;

create or replace function private.ap_jobs_run(p_schedule text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_results jsonb := '[]'::jsonb; v_company uuid; j record;
begin
  if p_schedule is null or p_schedule not in ('hourly', 'nightly', 'morning') then raise exception 'AP: Unknown schedule.'; end if;
  for v_company in select id from public.companies order by created_at loop
    for j in select * from private.ap_job_registry() r where r.schedule = p_schedule order by r.job_key loop
      v_results := v_results || jsonb_build_array(private.ap_job_once(v_company, j.job_key, private.ap_job_window(p_schedule, now()), 'cron', null));
    end loop;
  end loop;
  return jsonb_build_object('schedule', p_schedule, 'runs', v_results);
end;
$$;
revoke all on function private.ap_jobs_run(text) from public, anon, authenticated, service_role;

create or replace function public.ap_jobs_cron(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_schedule text := p_payload ->> 'schedule';
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not permitted' using errcode = '42501'; end if;
  perform private.ap_keys(p_payload, array['schedule']);
  if v_schedule is null or v_schedule not in ('hourly', 'nightly', 'morning') then raise exception 'AP: Unknown schedule.'; end if;
  return private.ap_jobs_run(v_schedule);
end;
$$;
revoke all on function public.ap_jobs_cron(jsonb) from public, anon, authenticated;
grant execute on function public.ap_jobs_cron(jsonb) to service_role;

do $do$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here; Autopilot jobs are not scheduled by the database.';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  -- cron.schedule(name, ...) replaces a job of the same name, so re-running this migration does not add duplicates.
  perform cron.schedule('autopilot-hourly', '5 * * * *', $cmd$select private.ap_jobs_run('hourly')$cmd$);
  perform cron.schedule('autopilot-nightly', '0 19 * * *', $cmd$select private.ap_jobs_run('nightly')$cmd$);
  perform cron.schedule('autopilot-morning', '30 2 * * *', $cmd$select private.ap_jobs_run('morning')$cmd$);
end;
$do$;

commit;
