-- ============================================================
-- PHASE 16: API AND INTEGRATION LAYER
-- ============================================================
-- Integration registry and sync logs for accounting, lead,
-- communication, backup, and transport/payment providers.

CREATE TABLE IF NOT EXISTS public.integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL CHECK (integration_type IN ('tally', 'busy', 'zoho_books', 'whatsapp_business', 'email_smtp', 'indiamart_leads', 'tradeindia_leads', 'google_drive_backup', 'google_sheets_export', 'payment_gateway', 'broker_transport_api')),
  provider_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured', 'connected', 'error', 'disabled')),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_reference TEXT,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, integration_type, provider_name)
);

CREATE TABLE IF NOT EXISTS public.sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES public.integrations(id) ON DELETE SET NULL,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial')),
  records_processed INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integrations_tenant_isolation" ON public.integrations
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE POLICY "sync_logs_tenant_isolation" ON public.sync_logs
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_integrations_company_type ON public.integrations(company_id, integration_type);
CREATE INDEX IF NOT EXISTS idx_integrations_company_status ON public.integrations(company_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_company_started ON public.sync_logs(company_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_logs_integration ON public.sync_logs(integration_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON public.sync_logs(company_id, status);

DROP TRIGGER IF EXISTS set_integrations_updated_at ON public.integrations;
CREATE TRIGGER set_integrations_updated_at BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
