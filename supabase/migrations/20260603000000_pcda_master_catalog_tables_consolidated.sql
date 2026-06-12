-- ============================================================
-- PCDA MASTER DATA CATALOGS — CONSOLIDATED
-- All 17 governed reference tables for technical catalog values.
-- Safe: uses CREATE TABLE IF NOT EXISTS throughout.
-- Requirements: 6.1, 6.2, 25.1, 25.2, 25.4
-- ============================================================

-- ============================================================
-- 1. pcda_master_alloy_standards
-- ============================================================
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_alloy_standards' AND policyname = 'pcda_master_alloy_standards_select') THEN
    CREATE POLICY "pcda_master_alloy_standards_select" ON public.pcda_master_alloy_standards
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_alloy_standards' AND policyname = 'pcda_master_alloy_standards_modify') THEN
    CREATE POLICY "pcda_master_alloy_standards_modify" ON public.pcda_master_alloy_standards
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_alloy_standards_company_active
  ON public.pcda_master_alloy_standards(company_id, is_active, value);

-- ============================================================
-- 2. pcda_master_alloys
-- ============================================================
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_alloys' AND policyname = 'pcda_master_alloys_select') THEN
    CREATE POLICY "pcda_master_alloys_select" ON public.pcda_master_alloys
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_alloys' AND policyname = 'pcda_master_alloys_modify') THEN
    CREATE POLICY "pcda_master_alloys_modify" ON public.pcda_master_alloys
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_alloys_company_active
  ON public.pcda_master_alloys(company_id, is_active, value);

-- ============================================================
-- 3. pcda_master_tempers
-- ============================================================
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_tempers' AND policyname = 'pcda_master_tempers_select') THEN
    CREATE POLICY "pcda_master_tempers_select" ON public.pcda_master_tempers
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_tempers' AND policyname = 'pcda_master_tempers_modify') THEN
    CREATE POLICY "pcda_master_tempers_modify" ON public.pcda_master_tempers
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_tempers_company_active
  ON public.pcda_master_tempers(company_id, is_active, value);

-- ============================================================
-- 4. pcda_master_uoms
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_uoms (
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
ALTER TABLE public.pcda_master_uoms ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_uoms' AND policyname = 'pcda_master_uoms_select') THEN
    CREATE POLICY "pcda_master_uoms_select" ON public.pcda_master_uoms
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_uoms' AND policyname = 'pcda_master_uoms_modify') THEN
    CREATE POLICY "pcda_master_uoms_modify" ON public.pcda_master_uoms
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_uoms_company_active
  ON public.pcda_master_uoms(company_id, is_active, value);

-- ============================================================
-- 5. pcda_master_packing_modes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_packing_modes (
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
ALTER TABLE public.pcda_master_packing_modes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_packing_modes' AND policyname = 'pcda_master_packing_modes_select') THEN
    CREATE POLICY "pcda_master_packing_modes_select" ON public.pcda_master_packing_modes
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_packing_modes' AND policyname = 'pcda_master_packing_modes_modify') THEN
    CREATE POLICY "pcda_master_packing_modes_modify" ON public.pcda_master_packing_modes
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_packing_modes_company_active
  ON public.pcda_master_packing_modes(company_id, is_active, value);

-- ============================================================
-- 6. pcda_master_qty_methods
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_qty_methods (
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
ALTER TABLE public.pcda_master_qty_methods ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_qty_methods' AND policyname = 'pcda_master_qty_methods_select') THEN
    CREATE POLICY "pcda_master_qty_methods_select" ON public.pcda_master_qty_methods
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_qty_methods' AND policyname = 'pcda_master_qty_methods_modify') THEN
    CREATE POLICY "pcda_master_qty_methods_modify" ON public.pcda_master_qty_methods
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_qty_methods_company_active
  ON public.pcda_master_qty_methods(company_id, is_active, value);

-- ============================================================
-- 7. pcda_master_profile_categories
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_profile_categories (
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
ALTER TABLE public.pcda_master_profile_categories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_profile_categories' AND policyname = 'pcda_master_profile_categories_select') THEN
    CREATE POLICY "pcda_master_profile_categories_select" ON public.pcda_master_profile_categories
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_profile_categories' AND policyname = 'pcda_master_profile_categories_modify') THEN
    CREATE POLICY "pcda_master_profile_categories_modify" ON public.pcda_master_profile_categories
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_profile_categories_company_active
  ON public.pcda_master_profile_categories(company_id, is_active, value);

-- ============================================================
-- 8. pcda_master_die_types
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_die_types (
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
ALTER TABLE public.pcda_master_die_types ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_die_types' AND policyname = 'pcda_master_die_types_select') THEN
    CREATE POLICY "pcda_master_die_types_select" ON public.pcda_master_die_types
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_die_types' AND policyname = 'pcda_master_die_types_modify') THEN
    CREATE POLICY "pcda_master_die_types_modify" ON public.pcda_master_die_types
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_die_types_company_active
  ON public.pcda_master_die_types(company_id, is_active, value);

-- ============================================================
-- 9. pcda_master_finish_types
-- ============================================================
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_finish_types' AND policyname = 'pcda_master_finish_types_select') THEN
    CREATE POLICY "pcda_master_finish_types_select" ON public.pcda_master_finish_types
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_finish_types' AND policyname = 'pcda_master_finish_types_modify') THEN
    CREATE POLICY "pcda_master_finish_types_modify" ON public.pcda_master_finish_types
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_finish_types_company_active
  ON public.pcda_master_finish_types(company_id, is_active, value);

-- ============================================================
-- 10. pcda_master_surface_treatments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_surface_treatments (
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
ALTER TABLE public.pcda_master_surface_treatments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_surface_treatments' AND policyname = 'pcda_master_surface_treatments_select') THEN
    CREATE POLICY "pcda_master_surface_treatments_select" ON public.pcda_master_surface_treatments
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_surface_treatments' AND policyname = 'pcda_master_surface_treatments_modify') THEN
    CREATE POLICY "pcda_master_surface_treatments_modify" ON public.pcda_master_surface_treatments
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_surface_treatments_company_active
  ON public.pcda_master_surface_treatments(company_id, is_active, value);

-- ============================================================
-- 11. pcda_master_defect_types
-- ============================================================
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_defect_types' AND policyname = 'pcda_master_defect_types_select') THEN
    CREATE POLICY "pcda_master_defect_types_select" ON public.pcda_master_defect_types
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_defect_types' AND policyname = 'pcda_master_defect_types_modify') THEN
    CREATE POLICY "pcda_master_defect_types_modify" ON public.pcda_master_defect_types
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_defect_types_company_active
  ON public.pcda_master_defect_types(company_id, is_active, value);

-- ============================================================
-- 12. pcda_master_quality_parameters
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_quality_parameters (
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
ALTER TABLE public.pcda_master_quality_parameters ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_quality_parameters' AND policyname = 'pcda_master_quality_parameters_select') THEN
    CREATE POLICY "pcda_master_quality_parameters_select" ON public.pcda_master_quality_parameters
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_quality_parameters' AND policyname = 'pcda_master_quality_parameters_modify') THEN
    CREATE POLICY "pcda_master_quality_parameters_modify" ON public.pcda_master_quality_parameters
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_quality_parameters_company_active
  ON public.pcda_master_quality_parameters(company_id, is_active, value);

-- ============================================================
-- 13. pcda_master_cost_components
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_cost_components (
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
ALTER TABLE public.pcda_master_cost_components ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_cost_components' AND policyname = 'pcda_master_cost_components_select') THEN
    CREATE POLICY "pcda_master_cost_components_select" ON public.pcda_master_cost_components
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_cost_components' AND policyname = 'pcda_master_cost_components_modify') THEN
    CREATE POLICY "pcda_master_cost_components_modify" ON public.pcda_master_cost_components
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_cost_components_company_active
  ON public.pcda_master_cost_components(company_id, is_active, value);

-- ============================================================
-- 14. pcda_master_document_types
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_document_types (
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
ALTER TABLE public.pcda_master_document_types ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_document_types' AND policyname = 'pcda_master_document_types_select') THEN
    CREATE POLICY "pcda_master_document_types_select" ON public.pcda_master_document_types
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_document_types' AND policyname = 'pcda_master_document_types_modify') THEN
    CREATE POLICY "pcda_master_document_types_modify" ON public.pcda_master_document_types
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_document_types_company_active
  ON public.pcda_master_document_types(company_id, is_active, value);

-- ============================================================
-- 15. pcda_master_compliance_types
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_compliance_types (
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
ALTER TABLE public.pcda_master_compliance_types ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_compliance_types' AND policyname = 'pcda_master_compliance_types_select') THEN
    CREATE POLICY "pcda_master_compliance_types_select" ON public.pcda_master_compliance_types
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_compliance_types' AND policyname = 'pcda_master_compliance_types_modify') THEN
    CREATE POLICY "pcda_master_compliance_types_modify" ON public.pcda_master_compliance_types
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_compliance_types_company_active
  ON public.pcda_master_compliance_types(company_id, is_active, value);

-- ============================================================
-- 16. pcda_master_machine_types
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_machine_types (
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
ALTER TABLE public.pcda_master_machine_types ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_machine_types' AND policyname = 'pcda_master_machine_types_select') THEN
    CREATE POLICY "pcda_master_machine_types_select" ON public.pcda_master_machine_types
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_machine_types' AND policyname = 'pcda_master_machine_types_modify') THEN
    CREATE POLICY "pcda_master_machine_types_modify" ON public.pcda_master_machine_types
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_machine_types_company_active
  ON public.pcda_master_machine_types(company_id, is_active, value);

-- ============================================================
-- 17. pcda_master_production_stages
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pcda_master_production_stages (
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
ALTER TABLE public.pcda_master_production_stages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_production_stages' AND policyname = 'pcda_master_production_stages_select') THEN
    CREATE POLICY "pcda_master_production_stages_select" ON public.pcda_master_production_stages
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pcda_master_production_stages' AND policyname = 'pcda_master_production_stages_modify') THEN
    CREATE POLICY "pcda_master_production_stages_modify" ON public.pcda_master_production_stages
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pcda_master_production_stages_company_active
  ON public.pcda_master_production_stages(company_id, is_active, value);
