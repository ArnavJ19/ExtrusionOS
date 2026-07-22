-- Private tenant-scoped storage for technical document attachments.
-- Object names must start with the authenticated user's company id.

alter table public.technical_documents
  add column if not exists storage_bucket text default 'documents',
  add column if not exists storage_path text;

update public.technical_documents
set storage_bucket = 'documents',
    storage_path = file_url
where storage_path is null
  and file_url is not null
  and file_url !~* '^https?://';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'technical_documents_storage_path_tenant_prefix'
  ) then
    alter table public.technical_documents
      add constraint technical_documents_storage_path_tenant_prefix
      check (storage_path is null or split_part(storage_path, '/', 1) = company_id::text)
      not valid;
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;

drop policy if exists "technical documents storage read" on storage.objects;
create policy "technical documents storage read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  );

drop policy if exists "technical documents storage insert" on storage.objects;
create policy "technical documents storage insert" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  );

drop policy if exists "technical documents storage update" on storage.objects;
create policy "technical documents storage update" on storage.objects
  for update using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  ) with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  );

drop policy if exists "technical documents storage delete" on storage.objects;
create policy "technical documents storage delete" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  );
