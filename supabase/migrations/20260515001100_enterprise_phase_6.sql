-- Migration: Phase 6 Advanced Aluminium Systems Configurator
-- Adds: system_series, system_components, system_configurations

-- 1. System Series
CREATE TABLE IF NOT EXISTS public.system_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  series_code TEXT NOT NULL,
  series_name TEXT NOT NULL,
  system_type TEXT NOT NULL, -- sliding_window, casement_window, partition, etc.
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_system_series_company ON public.system_series(company_id);

ALTER TABLE public.system_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view system series for their company" ON public.system_series FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Admins can manage system series" ON public.system_series FOR ALL USING (
  company_id = public.get_current_user_company_id() AND public.get_current_user_role() IN ('admin', 'sales_manager')
);

-- 2. System Components
CREATE TABLE IF NOT EXISTS public.system_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  series_id UUID NOT NULL REFERENCES public.system_series(id) ON DELETE CASCADE,
  component_type TEXT NOT NULL, -- profile, glass, hardware, accessory, gasket, brush
  related_profile_id UUID REFERENCES public.aluminium_profiles(id),
  item_name TEXT NOT NULL,
  item_code TEXT,
  unit_of_measure TEXT NOT NULL, -- kg, meter, pieces, sqft
  default_cost NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_system_components_series ON public.system_components(series_id);

ALTER TABLE public.system_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view system components for their company" ON public.system_components FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Admins can manage system components" ON public.system_components FOR ALL USING (
  company_id = public.get_current_user_company_id() AND public.get_current_user_role() IN ('admin', 'sales_manager')
);

-- 3. System Configurations (Saved instances)
CREATE TABLE IF NOT EXISTS public.system_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id),
  series_id UUID NOT NULL REFERENCES public.system_series(id),
  width_mm NUMERIC(8,2) NOT NULL,
  height_mm NUMERIC(8,2) NOT NULL,
  no_of_panels INT DEFAULT 2,
  finish_type TEXT,
  glass_type TEXT,
  hardware_type TEXT,
  calculated_price NUMERIC(12,2) DEFAULT 0,
  bom_json JSONB DEFAULT '{}'::jsonb,
  cutting_list_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_system_configurations_company ON public.system_configurations(company_id);
CREATE INDEX idx_system_configurations_customer ON public.system_configurations(customer_id);

ALTER TABLE public.system_configurations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view system configs for their company" ON public.system_configurations FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Users can manage system configs for their company" ON public.system_configurations FOR ALL USING (company_id = public.get_current_user_company_id());
