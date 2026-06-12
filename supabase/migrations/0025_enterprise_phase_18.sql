-- ============================================================
-- PHASE 18: ADVANCED DOCUMENT AND PDF CENTER
-- ============================================================
-- Versioning and pack management on top of public.documents.

CREATE TABLE IF NOT EXISTS public.document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  file_url TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id),
  change_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.document_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pack_name TEXT NOT NULL,
  pack_type TEXT NOT NULL CHECK (pack_type IN ('quote_pack', 'order_pack', 'dispatch_pack', 'quality_pack', 'export_pack', 'tender_pack', 'customer_pack')),
  related_entity_type TEXT,
  related_entity_id UUID,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_pack_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES public.document_packs(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pack_id, document_id)
);

ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_pack_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "document_versions_tenant_isolation" ON public.document_versions
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE POLICY "document_packs_tenant_isolation" ON public.document_packs
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE POLICY "document_pack_items_tenant_isolation" ON public.document_pack_items
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_document_versions_company_document ON public.document_versions(company_id, document_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_company_created ON public.document_versions(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_packs_company_type ON public.document_packs(company_id, pack_type);
CREATE INDEX IF NOT EXISTS idx_document_packs_company_entity ON public.document_packs(company_id, related_entity_type, related_entity_id);
CREATE INDEX IF NOT EXISTS idx_document_pack_items_company_pack ON public.document_pack_items(company_id, pack_id, sort_order);
