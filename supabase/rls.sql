create or replace function public.get_current_user_company_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select company_id from public.app_users where id = auth.uid() and is_active = true;
$$;

create or replace function public.get_current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.app_users where id = auth.uid() and is_active = true;
$$;

create or replace function public.is_owner_or_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.get_current_user_role() in ('owner', 'admin');
$$;

alter table public.companies enable row level security;
alter table public.app_users enable row level security;
alter table public.customers enable row level security;
alter table public.aluminium_profiles enable row level security;
alter table public.dies enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_revisions enable row level security;
alter table public.orders enable row level security;
alter table public.order_stage_history enable row level security;
alter table public.dispatches enable row level security;
alter table public.documents enable row level security;
alter table public.company_settings enable row level security;

  drop policy if exists "companies select own" on public.companies;
  create policy "companies select own" on public.companies for select using (id = public.get_current_user_company_id() or created_by = auth.uid());
  drop policy if exists "companies insert authenticated" on public.companies;
create policy "companies insert authenticated" on public.companies for insert with check (auth.uid() is not null);
drop policy if exists "companies update own admin" on public.companies;
create policy "companies update own admin" on public.companies for update using (id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin')) with check (id = public.get_current_user_company_id());

drop policy if exists "app users select own company" on public.app_users;
create policy "app users select own company" on public.app_users for select using (company_id = public.get_current_user_company_id() or id = auth.uid());
drop policy if exists "app users insert self" on public.app_users;
create policy "app users insert self" on public.app_users for insert with check (
  id = auth.uid()
  and (
    company_id is null
    or exists (select 1 from public.companies where companies.id = app_users.company_id and companies.created_by = auth.uid())
  )
);
drop policy if exists "app users update admin" on public.app_users;
create policy "app users update admin non self" on public.app_users
  for update
  using (
    company_id = public.get_current_user_company_id()
    and public.is_owner_or_admin()
    and id <> auth.uid()
  )
  with check (
    company_id = public.get_current_user_company_id()
    and id <> auth.uid()
  );

drop policy if exists "customers tenant read" on public.customers;
create policy "customers tenant read" on public.customers for select using (company_id = public.get_current_user_company_id());
drop policy if exists "customers tenant insert" on public.customers;
create policy "customers tenant insert" on public.customers for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales'));
drop policy if exists "customers tenant update" on public.customers;
create policy "customers tenant update" on public.customers for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales')) with check (company_id = public.get_current_user_company_id());
drop policy if exists "customers tenant delete" on public.customers;
create policy "customers tenant delete" on public.customers for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "profiles tenant read" on public.aluminium_profiles;
create policy "profiles tenant read" on public.aluminium_profiles for select using (company_id = public.get_current_user_company_id());
drop policy if exists "profiles tenant insert" on public.aluminium_profiles;
create policy "profiles tenant insert" on public.aluminium_profiles for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager'));
drop policy if exists "profiles tenant update" on public.aluminium_profiles;
create policy "profiles tenant update" on public.aluminium_profiles for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager')) with check (company_id = public.get_current_user_company_id());
drop policy if exists "profiles tenant delete" on public.aluminium_profiles;
create policy "profiles tenant delete" on public.aluminium_profiles for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "dies tenant read" on public.dies;
create policy "dies tenant read" on public.dies for select using (company_id = public.get_current_user_company_id());
drop policy if exists "dies tenant insert" on public.dies;
create policy "dies tenant insert" on public.dies for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production'));
drop policy if exists "dies tenant update" on public.dies;
create policy "dies tenant update" on public.dies for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production')) with check (company_id = public.get_current_user_company_id());
drop policy if exists "dies tenant delete" on public.dies;
create policy "dies tenant delete" on public.dies for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "quotes tenant read" on public.quotes;
create policy "quotes tenant read" on public.quotes for select using (company_id = public.get_current_user_company_id());
drop policy if exists "quotes tenant insert" on public.quotes;
create policy "quotes tenant insert" on public.quotes for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales'));
drop policy if exists "quotes tenant update" on public.quotes;
create policy "quotes tenant update" on public.quotes for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales')) with check (company_id = public.get_current_user_company_id());
drop policy if exists "quotes tenant delete" on public.quotes;
create policy "quotes tenant delete" on public.quotes for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "quote items tenant all read" on public.quote_items;
create policy "quote items tenant all read" on public.quote_items for select using (company_id = public.get_current_user_company_id());
drop policy if exists "quote items tenant insert" on public.quote_items;
create policy "quote items tenant insert" on public.quote_items for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales'));
drop policy if exists "quote items tenant update" on public.quote_items;
create policy "quote items tenant update" on public.quote_items for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales')) with check (company_id = public.get_current_user_company_id());
drop policy if exists "quote items tenant delete" on public.quote_items;
create policy "quote items tenant delete" on public.quote_items for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales'));

drop policy if exists "quote revisions tenant read" on public.quote_revisions;
create policy "quote revisions tenant read" on public.quote_revisions for select using (company_id = public.get_current_user_company_id());
drop policy if exists "quote revisions tenant insert" on public.quote_revisions;
create policy "quote revisions tenant insert" on public.quote_revisions for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales'));
drop policy if exists "quote revisions tenant update admin" on public.quote_revisions;
create policy "quote revisions tenant update admin" on public.quote_revisions for update using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin()) with check (company_id = public.get_current_user_company_id());
drop policy if exists "quote revisions tenant delete admin" on public.quote_revisions;
create policy "quote revisions tenant delete admin" on public.quote_revisions for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "orders tenant read" on public.orders;
create policy "orders tenant read" on public.orders for select using (company_id = public.get_current_user_company_id());
drop policy if exists "orders tenant insert" on public.orders;
create policy "orders tenant insert" on public.orders for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales'));
drop policy if exists "orders tenant update" on public.orders;
create policy "orders tenant update" on public.orders for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','dispatch_manager','dispatch')) with check (company_id = public.get_current_user_company_id());
drop policy if exists "orders tenant delete" on public.orders;
create policy "orders tenant delete" on public.orders for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "history tenant read" on public.order_stage_history;
create policy "history tenant read" on public.order_stage_history for select using (company_id = public.get_current_user_company_id());
drop policy if exists "history tenant insert" on public.order_stage_history;
create policy "history tenant insert" on public.order_stage_history for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','dispatch_manager','dispatch'));

drop policy if exists "dispatch tenant read" on public.dispatches;
create policy "dispatch tenant read" on public.dispatches for select using (company_id = public.get_current_user_company_id());
drop policy if exists "dispatch tenant insert" on public.dispatches;
create policy "dispatch tenant insert" on public.dispatches for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dispatch_manager','dispatch'));
drop policy if exists "dispatch tenant update" on public.dispatches;
create policy "dispatch tenant update" on public.dispatches for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dispatch_manager','dispatch')) with check (company_id = public.get_current_user_company_id());
drop policy if exists "dispatch tenant delete" on public.dispatches;
create policy "dispatch tenant delete" on public.dispatches for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "documents tenant read" on public.documents;
create policy "documents tenant read" on public.documents for select using (company_id = public.get_current_user_company_id());
drop policy if exists "documents tenant insert" on public.documents;
create policy "documents tenant insert" on public.documents for insert with check (company_id = public.get_current_user_company_id());
drop policy if exists "documents tenant update" on public.documents;
create policy "documents tenant update" on public.documents for update using (company_id = public.get_current_user_company_id()) with check (company_id = public.get_current_user_company_id());
drop policy if exists "documents tenant delete" on public.documents;
create policy "documents tenant delete" on public.documents for delete using (company_id = public.get_current_user_company_id() and public.is_owner_or_admin());

drop policy if exists "settings tenant read" on public.company_settings;
create policy "settings tenant read" on public.company_settings for select using (company_id = public.get_current_user_company_id());
drop policy if exists "settings insert own" on public.company_settings;
create policy "settings insert own" on public.company_settings for insert with check (
  company_id = public.get_current_user_company_id()
  or exists (select 1 from public.companies where companies.id = company_settings.company_id and companies.created_by = auth.uid())
);
drop policy if exists "settings update admin" on public.company_settings;
create policy "settings update admin" on public.company_settings for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin')) with check (company_id = public.get_current_user_company_id());

insert into storage.buckets (id, name, public) values
  ('company-assets', 'company-assets', false),
  ('profile-drawings', 'profile-drawings', false),
  ('die-drawings', 'die-drawings', false),
  ('quote-pdfs', 'quote-pdfs', false),
  ('dispatch-documents', 'dispatch-documents', false)
on conflict (id) do nothing;

drop policy if exists "tenant storage read" on storage.objects;
create policy "tenant storage read" on storage.objects for select using (
  bucket_id in ('company-assets','profile-drawings','die-drawings','quote-pdfs','dispatch-documents')
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
);
drop policy if exists "tenant storage insert" on storage.objects;
create policy "tenant storage insert" on storage.objects for insert with check (
  bucket_id in ('company-assets','profile-drawings','die-drawings','quote-pdfs','dispatch-documents')
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
);
drop policy if exists "tenant storage update" on storage.objects;
create policy "tenant storage update" on storage.objects for update using (
  bucket_id in ('company-assets','profile-drawings','die-drawings','quote-pdfs','dispatch-documents')
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
) with check ((storage.foldername(name))[1] = public.get_current_user_company_id()::text);
drop policy if exists "tenant storage delete" on storage.objects;
create policy "tenant storage delete" on storage.objects for delete using (
  bucket_id in ('company-assets','profile-drawings','die-drawings','quote-pdfs','dispatch-documents')
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
);
