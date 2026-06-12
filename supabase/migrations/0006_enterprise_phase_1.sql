-- Migration: Phase 1 Enterprise Foundation
-- Adds: Feature flags, Branches, Subscription Plans, Company Subscriptions

-- 1. Feature Flags
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  config_json JSONB DEFAULT '{}'::jsonb,
  enabled_by UUID REFERENCES auth.users(id),
  enabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, module_name)
);

CREATE INDEX idx_feature_flags_company ON public.feature_flags(company_id);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view feature flags for their company" ON public.feature_flags FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Admins can modify feature flags" ON public.feature_flags FOR ALL USING (
  company_id = public.get_current_user_company_id() AND public.get_current_user_role() = 'admin'
);

-- 2. Branches
CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_name TEXT NOT NULL,
  branch_type TEXT NOT NULL, -- head_office, factory, warehouse, sales_office, depot, dealer_location
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  phone TEXT,
  manager_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_branches_company ON public.branches(company_id);

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view branches for their company" ON public.branches FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Admins can modify branches" ON public.branches FOR ALL USING (
  company_id = public.get_current_user_company_id() AND public.get_current_user_role() = 'admin'
);

-- 3. Subscription Plans (Global/System Level - no company_id)
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_name TEXT NOT NULL,
  plan_type TEXT NOT NULL, -- Free/demo, Starter, Pro, Enterprise
  monthly_price NUMERIC(10, 2) DEFAULT 0,
  annual_price NUMERIC(10, 2) DEFAULT 0,
  module_limits_json JSONB DEFAULT '{}'::jsonb,
  feature_limits_json JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Everyone can read active subscription plans
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active plans" ON public.subscription_plans FOR SELECT USING (is_active = true);

-- 4. Company Subscriptions
CREATE TABLE IF NOT EXISTS public.company_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'active',
  billing_cycle TEXT DEFAULT 'monthly',
  started_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_company_subscriptions_company ON public.company_subscriptions(company_id);

ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view subscriptions for their company" ON public.company_subscriptions FOR SELECT USING (company_id = public.get_current_user_company_id());
-- Only service role or strict system processes should modify subscriptions in production, but allowing admins for now during dev
CREATE POLICY "Admins can manage subscriptions" ON public.company_subscriptions FOR ALL USING (
  company_id = public.get_current_user_company_id() AND public.get_current_user_role() = 'admin'
);

-- Seed Subscription Plans
INSERT INTO public.subscription_plans (plan_name, plan_type, monthly_price, annual_price) VALUES
('Starter Edition', 'Starter', 4999.00, 49990.00),
('Professional Edition', 'Pro', 14999.00, 149990.00),
('Enterprise Operating System', 'Enterprise', 34999.00, 349990.00)
ON CONFLICT DO NOTHING;
