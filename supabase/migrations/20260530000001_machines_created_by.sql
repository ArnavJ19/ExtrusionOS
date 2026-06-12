alter table public.machines
  add column if not exists created_by uuid references auth.users(id);

create index if not exists machines_company_created_by_idx on public.machines(company_id, created_by);
