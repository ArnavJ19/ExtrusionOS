-- Migration: Phase 2 AI Quotation & Costing Copilot
-- Adds: ai_interactions, quote_suggestions

-- 1. AI Interactions
CREATE TABLE IF NOT EXISTS public.ai_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  interaction_type TEXT NOT NULL, -- quotation_assist, customer_summary, order_summary, etc.
  input_text TEXT NOT NULL,
  output_json JSONB DEFAULT '{}'::jsonb,
  related_entity_type TEXT,
  related_entity_id UUID,
  status TEXT DEFAULT 'completed', -- pending, processing, completed, failed
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ai_interactions_company ON public.ai_interactions(company_id);
CREATE INDEX idx_ai_interactions_entity ON public.ai_interactions(related_entity_type, related_entity_id);

ALTER TABLE public.ai_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view AI interactions for their company" ON public.ai_interactions FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Users can create AI interactions for their company" ON public.ai_interactions FOR INSERT WITH CHECK (company_id = public.get_current_user_company_id());

-- 2. Quote Suggestions
CREATE TABLE IF NOT EXISTS public.quote_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id),
  suggested_by UUID REFERENCES auth.users(id),
  source_type TEXT NOT NULL, -- text_input, whatsapp_message, drawing_upload
  source_text TEXT,
  suggestion_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score NUMERIC(5,2),
  status TEXT DEFAULT 'draft', -- draft, accepted, rejected, converted_to_quote
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quote_suggestions_company ON public.quote_suggestions(company_id);
CREATE INDEX idx_quote_suggestions_customer ON public.quote_suggestions(customer_id);

ALTER TABLE public.quote_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view quote suggestions for their company" ON public.quote_suggestions FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Users can manage quote suggestions for their company" ON public.quote_suggestions FOR ALL USING (company_id = public.get_current_user_company_id());

-- 3. AI Settings (added to company_settings)
ALTER TABLE public.company_settings 
  ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'openai',
  ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'gpt-4',
  ADD COLUMN IF NOT EXISTS allow_external_ai BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS redact_sensitive_data BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_context_records INT DEFAULT 10;
