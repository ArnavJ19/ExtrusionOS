-- ============================================================
-- PHASE 13: BIS/QCO COMPLIANCE CENTER
-- ============================================================

-- 1. Compliance Standards Library
CREATE TABLE IF NOT EXISTS public.compliance_standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  standard_code TEXT NOT NULL,
  standard_name TEXT NOT NULL,
  product_category TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  is_applicable BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.compliance_standards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compliance_standards_tenant_isolation" ON public.compliance_standards
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_compliance_standards_company ON public.compliance_standards(company_id);

-- 2. Product-Standard Mappings
CREATE TABLE IF NOT EXISTS public.product_standard_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  profile_id UUID,
  standard_id UUID REFERENCES public.compliance_standards(id) ON DELETE CASCADE,
  required_tests_json JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_standard_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_standard_mappings_tenant_isolation" ON public.product_standard_mappings
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_product_standard_mappings_company ON public.product_standard_mappings(company_id);

-- 3. Calibration Records
CREATE TABLE IF NOT EXISTS public.calibration_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  equipment_name TEXT NOT NULL,
  equipment_id_code TEXT NOT NULL,
  calibration_date DATE NOT NULL,
  next_due_date DATE NOT NULL,
  certificate_url TEXT,
  calibrated_by TEXT,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'due_soon', 'overdue', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.calibration_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calibration_records_tenant_isolation" ON public.calibration_records
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_calibration_records_company ON public.calibration_records(company_id);
CREATE INDEX idx_calibration_records_due ON public.calibration_records(next_due_date);

-- 4. Compliance Audit Records
CREATE TABLE IF NOT EXISTS public.compliance_audit_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  audit_name TEXT NOT NULL,
  audit_type TEXT NOT NULL DEFAULT 'internal' CHECK (audit_type IN ('internal', 'external', 'bis', 'iso', 'customer', 'surveillance')),
  audit_date DATE NOT NULL,
  auditor_name TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'non_conformance', 'closed')),
  findings TEXT,
  corrective_actions TEXT,
  document_pack_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.compliance_audit_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compliance_audit_records_tenant_isolation" ON public.compliance_audit_records
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_compliance_audit_company ON public.compliance_audit_records(company_id);
CREATE INDEX idx_compliance_audit_date ON public.compliance_audit_records(audit_date);
