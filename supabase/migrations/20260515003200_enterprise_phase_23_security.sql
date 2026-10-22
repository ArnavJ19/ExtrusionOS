-- ============================================================
-- PHASE 23: ADVANCED SECURITY CENTER
-- ============================================================

-- Login events tracking
CREATE TABLE IF NOT EXISTS public.login_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('login_success', 'login_failed', 'logout', 'password_reset', 'invite_accepted')),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "login_events_tenant_isolation" ON public.login_events
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_login_events_company ON public.login_events(company_id);
CREATE INDEX IF NOT EXISTS idx_login_events_user ON public.login_events(user_id);
CREATE INDEX IF NOT EXISTS idx_login_events_created ON public.login_events(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_type ON public.login_events(company_id, event_type);

-- Sensitive action confirmation log
CREATE TABLE IF NOT EXISTS public.sensitive_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'delete_quote', 'delete_order', 'change_company_settings', 'change_user_role',
    'export_all_data', 'disable_user', 'revoke_portal_access', 'delete_customer',
    'delete_profile', 'delete_die', 'delete_invoice', 'bulk_delete', 'role_escalation'
  )),
  entity_type TEXT,
  entity_id TEXT,
  description TEXT,
  ip_address TEXT,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sensitive_action_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sensitive_action_logs_tenant_isolation" ON public.sensitive_action_logs
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_sensitive_action_logs_company ON public.sensitive_action_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_sensitive_action_logs_user ON public.sensitive_action_logs(company_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sensitive_action_logs_created ON public.sensitive_action_logs(company_id, created_at DESC);
