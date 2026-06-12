-- Migration: Add created_by column to production_jobs table
alter table public.production_jobs
  add column if not exists created_by uuid references auth.users(id);

create index if not exists production_jobs_company_created_by_idx on public.production_jobs(company_id, created_by);
