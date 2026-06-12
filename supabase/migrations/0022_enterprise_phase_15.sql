-- ============================================================
-- PHASE 15: ADVANCED CRM AND SALES PIPELINE
-- ============================================================
-- Sales pipeline tables for extrusion leads, opportunities,
-- follow-ups, site visits, lost reasons, and salesperson targets.

CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_name TEXT NOT NULL,
  company_name TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  city TEXT,
  state TEXT,
  lead_source TEXT NOT NULL DEFAULT 'other' CHECK (lead_source IN ('referral', 'website', 'indiaMart', 'tradeIndia', 'exhibition', 'field_sales', 'architect', 'contractor', 'government_tender', 'repeat_customer', 'other')),
  customer_type TEXT NOT NULL DEFAULT 'other' CHECK (customer_type IN ('fabricator', 'dealer', 'architect', 'industrial', 'solar', 'government', 'export', 'contractor', 'other')),
  estimated_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'quotation_sent', 'negotiation', 'won', 'lost', 'dormant')),
  assigned_to UUID REFERENCES auth.users(id),
  segment TEXT NOT NULL DEFAULT 'unassigned' CHECK (segment IN ('key_account', 'dealer', 'fabricator', 'architect', 'government', 'export', 'project', 'price_sensitive', 'unassigned')),
  lost_reason TEXT,
  competitor_pricing_notes TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  opportunity_name TEXT NOT NULL,
  estimated_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  expected_close_date DATE,
  probability_percent NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (probability_percent >= 0 AND probability_percent <= 100),
  stage TEXT NOT NULL DEFAULT 'enquiry' CHECK (stage IN ('enquiry', 'requirement_collected', 'quote_preparation', 'quote_sent', 'negotiation', 'sampling', 'approved', 'won', 'lost')),
  assigned_to UUID REFERENCES auth.users(id),
  segment TEXT NOT NULL DEFAULT 'unassigned' CHECK (segment IN ('key_account', 'dealer', 'fabricator', 'architect', 'government', 'export', 'project', 'price_sensitive', 'unassigned')),
  lead_source TEXT DEFAULT 'other' CHECK (lead_source IN ('referral', 'website', 'indiaMart', 'tradeIndia', 'exhibition', 'field_sales', 'architect', 'contractor', 'government_tender', 'repeat_customer', 'other')),
  lost_reason TEXT,
  competitor_pricing_notes TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('call', 'whatsapp', 'email', 'meeting', 'site_visit', 'sample_sent', 'quote_followup', 'payment_followup')),
  activity_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  next_followup_date DATE,
  assigned_to UUID REFERENCES auth.users(id),
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  salesperson_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  salesperson_name TEXT NOT NULL,
  period_month TEXT NOT NULL,
  target_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  achieved_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  target_leads INTEGER NOT NULL DEFAULT 0,
  achieved_leads INTEGER NOT NULL DEFAULT 0,
  target_visits INTEGER NOT NULL DEFAULT 0,
  achieved_visits INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, salesperson_name, period_month)
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_tenant_isolation" ON public.leads
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE POLICY "opportunities_tenant_isolation" ON public.opportunities
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE POLICY "sales_activities_tenant_isolation" ON public.sales_activities
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE POLICY "sales_targets_tenant_isolation" ON public.sales_targets
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_leads_company_status ON public.leads(company_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_company_source ON public.leads(company_id, lead_source);
CREATE INDEX IF NOT EXISTS idx_leads_company_assigned ON public.leads(company_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_company_segment ON public.leads(company_id, segment);
CREATE INDEX IF NOT EXISTS idx_opportunities_company_stage ON public.opportunities(company_id, stage);
CREATE INDEX IF NOT EXISTS idx_opportunities_company_close ON public.opportunities(company_id, expected_close_date);
CREATE INDEX IF NOT EXISTS idx_opportunities_company_assigned ON public.opportunities(company_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_sales_activities_company_followup ON public.sales_activities(company_id, next_followup_date);
CREATE INDEX IF NOT EXISTS idx_sales_activities_company_type ON public.sales_activities(company_id, activity_type);
CREATE INDEX IF NOT EXISTS idx_sales_targets_company_month ON public.sales_targets(company_id, period_month);

DROP TRIGGER IF EXISTS set_leads_updated_at ON public.leads;
CREATE TRIGGER set_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_opportunities_updated_at ON public.opportunities;
CREATE TRIGGER set_opportunities_updated_at BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_sales_targets_updated_at ON public.sales_targets;
CREATE TRIGGER set_sales_targets_updated_at BEFORE UPDATE ON public.sales_targets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
