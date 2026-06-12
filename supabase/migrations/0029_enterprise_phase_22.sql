-- ============================================================
-- PHASE 22: DATA BACKUP AND RECOVERY CENTER
-- ============================================================

CREATE TABLE IF NOT EXISTS public.data_retention_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  soft_delete_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (soft_delete_retention_days >= 7 AND soft_delete_retention_days <= 3650),
  export_retention_days INTEGER NOT NULL DEFAULT 180 CHECK (export_retention_days >= 7 AND export_retention_days <= 3650),
  audit_log_retention_days INTEGER NOT NULL DEFAULT 365 CHECK (audit_log_retention_days >= 30 AND audit_log_retention_days <= 3650),
  auto_purge_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.data_retention_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "data_retention_settings_tenant_isolation" ON public.data_retention_settings
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_data_retention_settings_company ON public.data_retention_settings(company_id);

DROP TRIGGER IF EXISTS set_data_retention_settings_updated_at ON public.data_retention_settings;
CREATE TRIGGER set_data_retention_settings_updated_at BEFORE UPDATE ON public.data_retention_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id);

ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id);

ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id);

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id);

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id);

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_customers_company_deleted_at ON public.customers(company_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_profiles_company_deleted_at ON public.aluminium_profiles(company_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_dies_company_deleted_at ON public.dies(company_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_quotes_company_deleted_at ON public.quotes(company_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_orders_company_deleted_at ON public.orders(company_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_invoices_company_deleted_at ON public.invoices(company_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_documents_company_deleted_at ON public.documents(company_id, deleted_at);
