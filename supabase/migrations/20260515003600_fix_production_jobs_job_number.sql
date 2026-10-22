begin;

alter table public.production_jobs add column if not exists job_number text;

update public.production_jobs
set job_number = 'JOB-' || left(id::text, 8)
where job_number is null;

commit;
