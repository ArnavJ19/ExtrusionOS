-- ============================================================
-- PHASE 11: TENDER AND GOVERNMENT ORDER MANAGEMENT
-- ============================================================

-- 1. Tenders
CREATE TABLE IF NOT EXISTS public.tenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tender_number TEXT NOT NULL,
  tender_title TEXT NOT NULL,
  issuing_authority TEXT NOT NULL,
  sector TEXT NOT NULL CHECK (sector IN ('railways', 'airport', 'solar', 'power', 'defence', 'metro', 'government_building', 'infrastructure', 'industrial', 'other')),
  tender_url TEXT,
  publish_date DATE,
  submission_deadline DATE NOT NULL,
  estimated_value NUMERIC(14,2) DEFAULT 0,
  emd_amount NUMERIC(12,2) DEFAULT 0,
  emd_status TEXT DEFAULT 'not_paid' CHECK (emd_status IN ('not_paid', 'paid', 'refunded', 'forfeited')),
  document_fee NUMERIC(10,2) DEFAULT 0,
  bid_value NUMERIC(14,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'identified' CHECK (status IN ('identified', 'under_review', 'eligible', 'not_eligible', 'documents_pending', 'submitted', 'technically_qualified', 'commercially_opened', 'won', 'lost', 'cancelled')),
  technical_status TEXT DEFAULT 'pending' CHECK (technical_status IN ('pending', 'qualified', 'disqualified')),
  commercial_status TEXT DEFAULT 'pending' CHECK (commercial_status IN ('pending', 'l1', 'l2', 'l3', 'above_l3')),
  competitor_notes TEXT,
  assigned_to TEXT,
  result_date DATE,
  converted_order_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenders_tenant_isolation" ON public.tenders
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_tenders_company ON public.tenders(company_id);
CREATE INDEX idx_tenders_status ON public.tenders(status);
CREATE INDEX idx_tenders_deadline ON public.tenders(submission_deadline);
CREATE INDEX idx_tenders_sector ON public.tenders(sector);

-- 2. Tender Documents
CREATE TABLE IF NOT EXISTS public.tender_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tender_id UUID NOT NULL REFERENCES public.tenders(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'general' CHECK (document_type IN ('technical', 'commercial', 'financial', 'eligibility', 'general')),
  required BOOLEAN DEFAULT true,
  uploaded_file_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'verified', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tender_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tender_documents_tenant_isolation" ON public.tender_documents
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_tender_documents_tender ON public.tender_documents(tender_id);

-- 3. Tender Checklist Items
CREATE TABLE IF NOT EXISTS public.tender_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tender_id UUID NOT NULL REFERENCES public.tenders(id) ON DELETE CASCADE,
  checklist_item TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'not_applicable')),
  assigned_to TEXT,
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tender_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tender_checklist_tenant_isolation" ON public.tender_checklist_items
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_tender_checklist_tender ON public.tender_checklist_items(tender_id);
