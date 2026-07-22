-- Keep technical-document object access aligned with technical_documents RLS.
-- This migration intentionally runs after the bucket-provisioning migration.

drop policy if exists "technical documents storage read" on storage.objects;
create policy "technical documents storage read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
    and public.get_current_user_role() in (
      'owner', 'admin', 'sales_manager', 'sales', 'production_manager',
      'production', 'accounts', 'quality', 'viewer'
    )
  );

drop policy if exists "technical documents storage insert" on storage.objects;
create policy "technical documents storage insert" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
    and public.get_current_user_role() in (
      'owner', 'admin', 'sales_manager', 'production_manager', 'quality'
    )
  );

drop policy if exists "technical documents storage update" on storage.objects;
create policy "technical documents storage update" on storage.objects
  for update using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
    and public.get_current_user_role() in (
      'owner', 'admin', 'sales_manager', 'production_manager', 'quality'
    )
  ) with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
    and public.get_current_user_role() in (
      'owner', 'admin', 'sales_manager', 'production_manager', 'quality'
    )
  );

drop policy if exists "technical documents storage delete" on storage.objects;
create policy "technical documents storage delete" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
    and public.get_current_user_role() in ('owner', 'admin')
  );
