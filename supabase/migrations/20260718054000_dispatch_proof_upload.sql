-- Dispatch teams may capture proof of delivery, but only inside dispatch-scoped
-- document rows and storage folders for their own company.

drop policy if exists "dispatch documents read" on public.technical_documents;
create policy "dispatch documents read" on public.technical_documents
  for select using (
    company_id = public.get_current_user_company_id()
    and linked_entity_type = 'dispatch'
    and public.get_current_user_role() in ('dispatch_manager', 'dispatch')
  );

drop policy if exists "dispatch documents insert" on public.technical_documents;
create policy "dispatch documents insert" on public.technical_documents
  for insert with check (
    company_id = public.get_current_user_company_id()
    and linked_entity_type = 'dispatch'
    and document_type = 'proof_of_delivery'
    and uploaded_by = auth.uid()
    and public.get_current_user_role() in ('dispatch_manager', 'dispatch')
  );

drop policy if exists "dispatch document objects read" on storage.objects;
create policy "dispatch document objects read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
    and (storage.foldername(name))[2] = 'dispatches'
    and public.get_current_user_role() in ('dispatch_manager', 'dispatch')
  );

drop policy if exists "dispatch document objects insert" on storage.objects;
create policy "dispatch document objects insert" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.get_current_user_company_id()::text
    and (storage.foldername(name))[2] = 'dispatches'
    and public.get_current_user_role() in ('dispatch_manager', 'dispatch')
  );
