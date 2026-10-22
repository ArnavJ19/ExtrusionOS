alter table public.vendors
  add column if not exists created_by uuid references auth.users(id);

create index if not exists vendors_company_created_by_idx on public.vendors(company_id, created_by);
