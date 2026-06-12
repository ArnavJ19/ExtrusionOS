-- Migration: Phase 3 WhatsApp Business Automation
-- Adds: whatsapp_templates, message_campaigns, outbound_messages

-- 1. WhatsApp Templates
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  template_category TEXT NOT NULL, -- quote_sent, order_confirmation, dispatch_update, etc.
  language TEXT DEFAULT 'en_US',
  body TEXT NOT NULL,
  variables_json JSONB DEFAULT '[]'::jsonb,
  approval_status TEXT DEFAULT 'approved', -- draft, pending_provider, approved, rejected
  provider_template_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_whatsapp_templates_company ON public.whatsapp_templates(company_id);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view whatsapp templates for their company" ON public.whatsapp_templates FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Admins can manage whatsapp templates" ON public.whatsapp_templates FOR ALL USING (
  company_id = public.get_current_user_company_id() AND public.get_current_user_role() IN ('admin', 'sales_manager')
);

-- 2. Message Campaigns (Automations)
CREATE TABLE IF NOT EXISTS public.message_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  campaign_name TEXT NOT NULL,
  campaign_type TEXT DEFAULT 'automated',
  trigger_event TEXT NOT NULL, -- quote_sent, quote_expiring_tomorrow, etc.
  delay_hours INT DEFAULT 0,
  template_id UUID REFERENCES public.whatsapp_templates(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_message_campaigns_company ON public.message_campaigns(company_id);

ALTER TABLE public.message_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view message campaigns for their company" ON public.message_campaigns FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Admins can manage message campaigns" ON public.message_campaigns FOR ALL USING (
  company_id = public.get_current_user_company_id() AND public.get_current_user_role() IN ('admin', 'sales_manager')
);

-- 3. Outbound Messages
CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id),
  related_entity_type TEXT, -- quote, order, dispatch, invoice
  related_entity_id UUID,
  channel TEXT DEFAULT 'whatsapp', -- whatsapp, email, sms
  template_id UUID REFERENCES public.whatsapp_templates(id),
  message_body TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  status TEXT DEFAULT 'draft', -- draft, queued, sent, delivered, read, failed, manually_logged
  provider_message_id TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_outbound_messages_company ON public.outbound_messages(company_id);
CREATE INDEX idx_outbound_messages_customer ON public.outbound_messages(customer_id);
CREATE INDEX idx_outbound_messages_entity ON public.outbound_messages(related_entity_type, related_entity_id);

ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view outbound messages for their company" ON public.outbound_messages FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Users can create outbound messages for their company" ON public.outbound_messages FOR INSERT WITH CHECK (company_id = public.get_current_user_company_id());
CREATE POLICY "Users can update outbound messages" ON public.outbound_messages FOR UPDATE USING (company_id = public.get_current_user_company_id());
