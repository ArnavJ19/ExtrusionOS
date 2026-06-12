-- ============================================================
-- PHASE 20: ADVANCED REPORT BUILDER
-- ============================================================

CREATE TABLE IF NOT EXISTS public.saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  report_name TEXT NOT NULL,
  data_source TEXT NOT NULL CHECK (data_source IN ('customers', 'quotes', 'orders', 'dispatches', 'invoices', 'payments', 'inventory', 'production_jobs', 'scrap_records', 'dies', 'quality_tests', 'vendors', 'purchases')),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'company', 'owner_only')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_reports_tenant_isolation" ON public.saved_reports
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_saved_reports_company_source ON public.saved_reports(company_id, data_source);
CREATE INDEX IF NOT EXISTS idx_saved_reports_company_visibility ON public.saved_reports(company_id, visibility);
CREATE INDEX IF NOT EXISTS idx_saved_reports_company_created ON public.saved_reports(company_id, created_at DESC);

DROP TRIGGER IF EXISTS set_saved_reports_updated_at ON public.saved_reports;
CREATE TRIGGER set_saved_reports_updated_at BEFORE UPDATE ON public.saved_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
