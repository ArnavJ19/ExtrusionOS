-- ============================================================
-- PHASE 7: CAD/DRAWING AND DOCUMENT INTELLIGENCE
-- ============================================================

-- 1. Technical Drawings
CREATE TABLE IF NOT EXISTS public.technical_drawings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  drawing_number TEXT NOT NULL,
  title TEXT NOT NULL,
  related_entity_type TEXT NOT NULL CHECK (related_entity_type IN ('die', 'profile', 'quote', 'order', 'customer', 'system_configuration', 'general')),
  related_entity_id UUID,
  file_url TEXT,
  revision_number INTEGER NOT NULL DEFAULT 1,
  uploaded_by UUID,
  approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'under_review', 'approved_internal', 'sent_to_customer', 'customer_approved', 'rejected', 'obsolete')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.technical_drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "technical_drawings_tenant_isolation" ON public.technical_drawings
  FOR ALL USING (company_id = public.get_current_user_company_id());

CREATE INDEX idx_technical_drawings_company ON public.technical_drawings(company_id);
CREATE INDEX idx_technical_drawings_entity ON public.technical_drawings(related_entity_type, related_entity_id);
CREATE INDEX idx_technical_drawings_status ON public.technical_drawings(approval_status);

-- 2. Drawing Reviews
CREATE TABLE IF NOT EXISTS public.drawing_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  drawing_id UUID NOT NULL REFERENCES public.technical_drawings(id) ON DELETE CASCADE,
  reviewer_id UUID,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected', 'changes_requested', 'commented')),
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.drawing_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drawing_reviews_tenant_isolation" ON public.drawing_reviews
  FOR ALL USING (company_id = public.get_current_user_company_id());

CREATE INDEX idx_drawing_reviews_drawing ON public.drawing_reviews(drawing_id);

-- 3. Technical Queries (TQs)
CREATE TABLE IF NOT EXISTS public.technical_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tq_number TEXT NOT NULL,
  customer_id UUID,
  related_drawing_id UUID REFERENCES public.technical_drawings(id),
  related_quote_id UUID,
  query_text TEXT NOT NULL,
  response_text TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'responded', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  assigned_to UUID,
  raised_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.technical_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "technical_queries_tenant_isolation" ON public.technical_queries
  FOR ALL USING (company_id = public.get_current_user_company_id());

CREATE INDEX idx_technical_queries_company ON public.technical_queries(company_id);
CREATE INDEX idx_technical_queries_status ON public.technical_queries(status);
CREATE INDEX idx_technical_queries_drawing ON public.technical_queries(related_drawing_id);
