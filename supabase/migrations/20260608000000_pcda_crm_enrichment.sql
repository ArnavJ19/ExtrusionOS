-- ============================================================
-- PCDA CRM ENRICHMENT — Customer Technical Fields & Compliance
-- Adds PCDA technical columns to customers table and creates
-- the customer_compliance_requirements table.
-- Safe: uses IF NOT EXISTS and DO $$ blocks throughout.
-- Requirements: 9.2, 19.7
-- ============================================================

-- ============================================================
-- 1. Add PCDA columns to customers table (additive, nullable)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'default_packing_requirements'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN default_packing_requirements TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'required_certificates'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN required_certificates TEXT[];
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'default_alloy_standard_id'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN default_alloy_standard_id UUID REFERENCES public.pcda_master_alloy_standards(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'credit_terms'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN credit_terms TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'commercial_terms'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN commercial_terms TEXT;
  END IF;
END $$;

-- ============================================================
-- 2. customer_compliance_requirements table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_compliance_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  certificate_type TEXT NOT NULL,
  description TEXT,
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.customer_compliance_requirements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_compliance_requirements'
      AND policyname = 'customer_compliance_requirements_select'
  ) THEN
    CREATE POLICY "customer_compliance_requirements_select"
      ON public.customer_compliance_requirements
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_compliance_requirements'
      AND policyname = 'customer_compliance_requirements_modify'
  ) THEN
    CREATE POLICY "customer_compliance_requirements_modify"
      ON public.customer_compliance_requirements
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_compliance_requirements_company_customer
  ON public.customer_compliance_requirements(company_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_compliance_requirements_company_cert_type
  ON public.customer_compliance_requirements(company_id, certificate_type);
