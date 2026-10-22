-- ============================================================
-- PHASE 21: AUTOMATION WORKFLOW BUILDER
-- ============================================================

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('quote_created', 'quote_sent', 'quote_expiring', 'quote_approved', 'order_created', 'order_delayed', 'dispatch_created', 'invoice_overdue', 'inventory_low', 'quality_failed', 'die_high_rejection', 'complaint_created')),
  conditions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  trigger_entity_type TEXT,
  trigger_entity_id UUID,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'skipped')),
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "automation_rules_tenant_isolation" ON public.automation_rules
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE POLICY "automation_runs_tenant_isolation" ON public.automation_runs
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_automation_rules_company_trigger ON public.automation_rules(company_id, trigger_type);
CREATE INDEX IF NOT EXISTS idx_automation_rules_company_active ON public.automation_rules(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_automation_runs_company_created ON public.automation_runs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_rule ON public.automation_runs(rule_id);

DROP TRIGGER IF EXISTS set_automation_rules_updated_at ON public.automation_rules;
CREATE TRIGGER set_automation_rules_updated_at BEFORE UPDATE ON public.automation_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
