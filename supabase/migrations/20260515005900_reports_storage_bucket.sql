-- Ensure generated PCDA/technical reports can be uploaded and downloaded.
-- Files are stored as <company_id>/reports/<record_type>/<record_id>/...

insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do update set public = false;

drop policy if exists "tenant storage read" on storage.objects;
create policy "tenant storage read" on storage.objects for select using (
  bucket_id in ('company-assets','profile-drawings','die-drawings','quote-pdfs','dispatch-documents','reports')
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
);

drop policy if exists "tenant storage insert" on storage.objects;
create policy "tenant storage insert" on storage.objects for insert with check (
  bucket_id in ('company-assets','profile-drawings','die-drawings','quote-pdfs','dispatch-documents','reports')
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
);

drop policy if exists "tenant storage update" on storage.objects;
create policy "tenant storage update" on storage.objects for update using (
  bucket_id in ('company-assets','profile-drawings','die-drawings','quote-pdfs','dispatch-documents','reports')
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
) with check (
  bucket_id in ('company-assets','profile-drawings','die-drawings','quote-pdfs','dispatch-documents','reports')
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
);

drop policy if exists "tenant storage delete" on storage.objects;
create policy "tenant storage delete" on storage.objects for delete using (
  bucket_id in ('company-assets','profile-drawings','die-drawings','quote-pdfs','dispatch-documents','reports')
  and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
);
