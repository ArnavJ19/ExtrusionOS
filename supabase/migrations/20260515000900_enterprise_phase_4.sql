-- Migration: Phase 4 Dealer & Fabricator Portal
-- Adds: portal_users, quote_requests, support_tickets

-- 1. Portal Users
CREATE TABLE IF NOT EXISTS public.portal_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  phone TEXT,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'dealer', -- customer_owner, customer_staff, dealer, fabricator, architect, viewer
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(email, company_id)
);

CREATE INDEX idx_portal_users_company ON public.portal_users(company_id);
CREATE INDEX idx_portal_users_customer ON public.portal_users(customer_id);

ALTER TABLE public.portal_users ENABLE ROW LEVEL SECURITY;
-- Internal users can see all portal users in their company
CREATE POLICY "Internal users can view portal users" ON public.portal_users FOR SELECT USING (
  company_id = public.get_current_user_company_id() AND public.get_current_user_role() IS NOT NULL
);
-- Portal users can only see their own profile and profiles of their customer organization
CREATE POLICY "Portal users can view their own org" ON public.portal_users FOR SELECT USING (
  customer_id = (SELECT customer_id FROM public.portal_users WHERE id = auth.uid())
);
-- Internal admins/sales managers can manage portal users
CREATE POLICY "Internal admins can manage portal users" ON public.portal_users FOR ALL USING (
  company_id = public.get_current_user_company_id() AND public.get_current_user_role() IN ('admin', 'sales_manager')
);

-- 2. Quote Requests (from portal)
CREATE TABLE IF NOT EXISTS public.quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portal_user_id UUID REFERENCES public.portal_users(id),
  request_number TEXT NOT NULL,
  request_type TEXT NOT NULL, -- profile_custom, standard_order, systems
  description TEXT,
  uploaded_file_url TEXT,
  status TEXT DEFAULT 'submitted', -- submitted, under_review, quote_created, rejected, closed
  assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quote_requests_company ON public.quote_requests(company_id);
CREATE INDEX idx_quote_requests_customer ON public.quote_requests(customer_id);

ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;
-- Internal users can see and manage quote requests
CREATE POLICY "Internal users can view quote requests" ON public.quote_requests FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Internal users can manage quote requests" ON public.quote_requests FOR ALL USING (company_id = public.get_current_user_company_id());
-- Portal users can only see and create for their own org
CREATE POLICY "Portal users can view org quote requests" ON public.quote_requests FOR SELECT USING (
  customer_id = (SELECT customer_id FROM public.portal_users WHERE id = auth.uid())
);
CREATE POLICY "Portal users can create quote requests" ON public.quote_requests FOR INSERT WITH CHECK (
  customer_id = (SELECT customer_id FROM public.portal_users WHERE id = auth.uid())
);

-- 3. Support Tickets (from portal)
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portal_user_id UUID REFERENCES public.portal_users(id),
  ticket_number TEXT NOT NULL,
  related_order_id UUID REFERENCES public.orders(id),
  issue_type TEXT NOT NULL, -- delivery_delay, damaged_material, wrong_profile, etc.
  priority TEXT DEFAULT 'medium', -- low, medium, high, critical
  description TEXT NOT NULL,
  status TEXT DEFAULT 'open', -- open, investigating, resolved, closed
  assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_support_tickets_company ON public.support_tickets(company_id);
CREATE INDEX idx_support_tickets_customer ON public.support_tickets(customer_id);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
-- Internal users
CREATE POLICY "Internal users can view tickets" ON public.support_tickets FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Internal users can manage tickets" ON public.support_tickets FOR ALL USING (company_id = public.get_current_user_company_id());
-- Portal users
CREATE POLICY "Portal users can view org tickets" ON public.support_tickets FOR SELECT USING (
  customer_id = (SELECT customer_id FROM public.portal_users WHERE id = auth.uid())
);
CREATE POLICY "Portal users can create tickets" ON public.support_tickets FOR INSERT WITH CHECK (
  customer_id = (SELECT customer_id FROM public.portal_users WHERE id = auth.uid())
);
