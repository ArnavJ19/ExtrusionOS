-- ============================================================
-- PHASE 17: MOBILE FACTORY FLOOR EXPERIENCE
-- ============================================================
-- Checklist templates and responses for mobile production,
-- quality, dispatch, maintenance, die-trial, and scan workflows.

CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  checklist_type TEXT NOT NULL CHECK (checklist_type IN ('production_start', 'production_completion', 'quality_inspection', 'dispatch_loading', 'machine_maintenance', 'die_trial')),
  template_name TEXT NOT NULL,
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checklist_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  related_entity_type TEXT NOT NULL,
  related_entity_id UUID,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_by UUID REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checklist_templates_tenant_isolation" ON public.checklist_templates
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE POLICY "checklist_responses_tenant_isolation" ON public.checklist_responses
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_checklist_templates_company_type ON public.checklist_templates(company_id, checklist_type);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_company_active ON public.checklist_templates(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_checklist_responses_company_entity ON public.checklist_responses(company_id, related_entity_type, related_entity_id);
CREATE INDEX IF NOT EXISTS idx_checklist_responses_company_completed ON public.checklist_responses(company_id, completed_at DESC);

DROP TRIGGER IF EXISTS set_checklist_templates_updated_at ON public.checklist_templates;
CREATE TRIGGER set_checklist_templates_updated_at BEFORE UPDATE ON public.checklist_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
