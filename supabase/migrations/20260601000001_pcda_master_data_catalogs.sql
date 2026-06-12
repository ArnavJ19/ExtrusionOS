-- ============================================================
-- PCDA MASTER DATA CATALOGS
-- Governed reference tables for technical catalog values
-- ============================================================

-- Helper to create a standard master data table
-- Each table: company_id, value, description, is_active, created_at, updated_at, created_by
-- RLS, indexes, unique constraint on (company_id, value)

CREATE TABLE IF NOT EXISTS public.pcda_master_alloy_standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (company_id, value)
);
ALTER TABLE public.pcda_master_alloy_standards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcda_alloy_standards_tenant" ON public.pcda_master_alloy_standards
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_pcda_alloy_standards_co ON public.pcda_master_alloy_standards(company_id, is_active, value);

CREATE TABLE IF NOT EXISTS public.pcda_master_alloys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (company_id, value)
);
ALTER TABLE public.pcda_master_alloys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcda_alloys_tenant" ON public.pcda_master_alloys
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_pcda_alloys_co ON public.pcda_master_alloys(company_id, is_active, value);

CREATE TABLE IF NOT EXISTS public.pcda_master_tempers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (company_id, value)
);
ALTER TABLE public.pcda_master_tempers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcda_tempers_tenant" ON public.pcda_master_tempers
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_pcda_tempers_co ON public.pcda_master_tempers(company_id, is_active, value);

CREATE TABLE IF NOT EXISTS public.pcda_master_finish_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (company_id, value)
);
ALTER TABLE public.pcda_master_finish_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcda_finish_types_tenant" ON public.pcda_master_finish_types
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_pcda_finish_types_co ON public.pcda_master_finish_types(company_id, is_active, value);

CREATE TABLE IF NOT EXISTS public.pcda_master_defect_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (company_id, value)
);
ALTER TABLE public.pcda_master_defect_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcda_defect_types_tenant" ON public.pcda_master_defect_types
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_pcda_defect_types_co ON public.pcda_master_defect_types(company_id, is_active, value);

CREATE TABLE IF NOT EXISTS public.pcda_master_production_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (company_id, value)
);
ALTER TABLE public.pcda_master_production_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcda_production_stages_tenant" ON public.pcda_master_production_stages
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_pcda_production_stages_co ON public.pcda_master_production_stages(company_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS public.pcda_master_quality_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  description TEXT,
  unit TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (company_id, value)
);
ALTER TABLE public.pcda_master_quality_parameters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pcda_quality_params_tenant" ON public.pcda_master_quality_parameters
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_pcda_quality_params_co ON public.pcda_master_quality_parameters(company_id, is_active, value);
