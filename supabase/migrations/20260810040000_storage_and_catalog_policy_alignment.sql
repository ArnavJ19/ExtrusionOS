begin;

insert into storage.buckets (id, name, public)
values ('technical-drawings', 'technical-drawings', false), ('maintenance-bills', 'maintenance-bills', false)
on conflict (id) do update set public = false;

drop policy if exists "technical drawings storage read" on storage.objects;
create policy "technical drawings storage read" on storage.objects for select using (
  bucket_id = 'technical-drawings'
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production','quality','viewer')
);
drop policy if exists "technical drawings storage insert" on storage.objects;
create policy "technical drawings storage insert" on storage.objects for insert with check (
  bucket_id = 'technical-drawings'
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  and public.get_current_user_role() in ('owner','admin','sales_manager','production_manager','production','quality')
);
drop policy if exists "technical drawings storage update" on storage.objects;
create policy "technical drawings storage update" on storage.objects for update using (
  bucket_id = 'technical-drawings'
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  and public.get_current_user_role() in ('owner','admin','sales_manager','production_manager','production','quality')
) with check (
  bucket_id = 'technical-drawings'
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  and public.get_current_user_role() in ('owner','admin','sales_manager','production_manager','production','quality')
);
drop policy if exists "technical drawings storage delete" on storage.objects;
create policy "technical drawings storage delete" on storage.objects for delete using (
  bucket_id = 'technical-drawings'
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  and public.get_current_user_role() in ('owner','admin')
);

drop policy if exists "maintenance bills storage read" on storage.objects;
create policy "maintenance bills storage read" on storage.objects for select using (
  bucket_id = 'maintenance-bills'
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  and public.get_current_user_role() in ('owner','admin','production_manager','factory_manager','accounts','quality','viewer')
);
drop policy if exists "maintenance bills storage insert" on storage.objects;
create policy "maintenance bills storage insert" on storage.objects for insert with check (
  bucket_id = 'maintenance-bills'
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  and public.get_current_user_role() in ('owner','admin','production_manager','factory_manager')
);
drop policy if exists "maintenance bills storage update" on storage.objects;
create policy "maintenance bills storage update" on storage.objects for update using (
  bucket_id = 'maintenance-bills'
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  and public.get_current_user_role() in ('owner','admin','production_manager','factory_manager')
) with check (
  bucket_id = 'maintenance-bills'
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  and public.get_current_user_role() in ('owner','admin','production_manager','factory_manager')
);
drop policy if exists "maintenance bills storage delete" on storage.objects;
create policy "maintenance bills storage delete" on storage.objects for delete using (
  bucket_id = 'maintenance-bills'
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  and public.get_current_user_role() in ('owner','admin')
);

drop policy if exists "profiles tenant read" on public.aluminium_profiles;
create policy "profiles tenant read" on public.aluminium_profiles for select using (company_id = public.get_current_user_company_id());
drop policy if exists "profiles tenant insert" on public.aluminium_profiles;
create policy "profiles tenant insert" on public.aluminium_profiles for insert with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production')
);
drop policy if exists "profiles tenant update" on public.aluminium_profiles;
create policy "profiles tenant update" on public.aluminium_profiles for update using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production')
) with check (company_id = public.get_current_user_company_id());

drop policy if exists "dies tenant read" on public.dies;
create policy "dies tenant read" on public.dies for select using (company_id = public.get_current_user_company_id());
drop policy if exists "dies tenant insert" on public.dies;
create policy "dies tenant insert" on public.dies for insert with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production')
);
drop policy if exists "dies tenant update" on public.dies;
create policy "dies tenant update" on public.dies for update using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','production')
) with check (company_id = public.get_current_user_company_id());

commit;
