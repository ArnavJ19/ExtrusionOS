-- ============================================================
-- PHASE 23: ALUMINIUM SYSTEMS CONFIGURATOR FOUNDATION
-- Adds production-grade schema foundation, RLS, and indexes.
-- Existing Phase 6 configurator tables are evolved in place.
-- ============================================================

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.system_configurator_system_type AS ENUM (
    'two_track_sliding_window', 'three_track_sliding_window', 'sliding_door',
    'casement_window', 'fixed_window', 'top_hung_window', 'hinged_door',
    'swing_door', 'partition', 'ventilator', 'combination', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_component_role AS ENUM (
    'outer_frame_top', 'outer_frame_bottom', 'outer_frame_left', 'outer_frame_right',
    'frame_jamb', 'frame_head', 'sill', 'threshold', 'shutter_vertical',
    'shutter_horizontal_top', 'shutter_horizontal_bottom', 'sash_vertical',
    'sash_horizontal', 'interlock', 'meeting_stile', 'lock_stile', 'mullion',
    'transom', 'coupler', 'add_on', 'adapter', 'reinforcement', 'support_profile',
    'glazing_bead_vertical', 'glazing_bead_horizontal', 'mesh_frame_vertical',
    'mesh_frame_horizontal', 'corner_profile', 'track_profile', 'cover_profile', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.hardware_category AS ENUM (
    'lock', 'handle', 'roller', 'hinge', 'stay_arm', 'tower_bolt', 'fastener',
    'screw', 'gasket', 'wool_pile', 'weather_strip', 'silicone', 'drainage_cap',
    'corner_cleat', 'connector', 'accessory', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_glass_type AS ENUM (
    'clear', 'toughened', 'laminated', 'frosted', 'tinted', 'reflective',
    'low_e', 'dgu', 'textured', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_finish_type AS ENUM (
    'mill_finish', 'powder_coating', 'anodizing', 'wood_finish', 'pvdf', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_finish_rate_type AS ENUM ('per_kg', 'per_sqft', 'per_sqm', 'per_meter', 'fixed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_configuration_status AS ENUM (
    'draft', 'calculated', 'quoted', 'approved', 'converted_to_order',
    'in_production', 'completed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_measurement_type AS ENUM ('brick_to_brick', 'frame_outer_size', 'finished_size', 'manufacturing_size');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_view_direction AS ENUM ('inside_view', 'outside_view');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_panel_type AS ENUM ('fixed', 'sliding', 'casement', 'top_hung', 'mesh', 'door_leaf', 'dummy', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_opening_direction AS ENUM ('left', 'right', 'top', 'bottom', 'sliding_left', 'sliding_right', 'fixed', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_bead_position AS ENUM ('top', 'bottom', 'left', 'right');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_material_type AS ENUM (
    'aluminium_profile', 'glass', 'hardware', 'gasket', 'mesh', 'finish',
    'labor', 'installation', 'packing', 'transport', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.system_report_type AS ENUM (
    'customer_quote', 'internal_costing', 'cutting_list', 'glass_list',
    'hardware_bom', 'production_sheet', 'installation_sheet', 'optimization_report'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Evolve existing Phase 6 system_series table without destructive changes.
ALTER TABLE public.system_series ADD COLUMN IF NOT EXISTS default_alloy TEXT;
ALTER TABLE public.system_series ADD COLUMN IF NOT EXISTS default_temper TEXT;
ALTER TABLE public.system_series ADD COLUMN IF NOT EXISTS default_finish TEXT;
ALTER TABLE public.system_series ADD COLUMN IF NOT EXISTS stock_length_mm NUMERIC(10,2) NOT NULL DEFAULT 6000;
ALTER TABLE public.system_series ADD COLUMN IF NOT EXISTS wastage_percent_default NUMERIC(7,3) NOT NULL DEFAULT 5;
ALTER TABLE public.system_series ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.system_series ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

DROP TRIGGER IF EXISTS set_system_series_updated_at ON public.system_series;
CREATE TRIGGER set_system_series_updated_at BEFORE UPDATE ON public.system_series FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.system_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  series_id UUID NOT NULL REFERENCES public.system_series(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.aluminium_profiles(id) ON DELETE SET NULL,
  component_role public.system_component_role NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  is_required BOOLEAN NOT NULL DEFAULT true,
  default_quantity_formula TEXT,
  default_length_formula TEXT,
  deduction_mm NUMERIC(10,2) NOT NULL DEFAULT 0,
  addition_mm NUMERIC(10,2) NOT NULL DEFAULT 0,
  applies_to_system_types TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hardware_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  hardware_category public.hardware_category NOT NULL,
  description TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  default_rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  brand TEXT,
  finish TEXT,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.glass_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  glass_code TEXT NOT NULL,
  glass_name TEXT NOT NULL,
  glass_type public.system_glass_type NOT NULL,
  thickness_mm NUMERIC(8,2) NOT NULL DEFAULT 0,
  composition TEXT,
  rate_per_sqft NUMERIC(14,2) NOT NULL DEFAULT 0,
  rate_per_sqm NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finish_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  finish_code TEXT NOT NULL,
  finish_name TEXT NOT NULL,
  finish_type public.system_finish_type NOT NULL,
  color_code TEXT,
  rate_type public.system_finish_rate_type NOT NULL DEFAULT 'per_kg',
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_code TEXT NOT NULL,
  template_name TEXT NOT NULL,
  system_type public.system_configurator_system_type NOT NULL,
  series_id UUID REFERENCES public.system_series(id) ON DELETE SET NULL,
  formula_version INTEGER NOT NULL DEFAULT 1,
  formula_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  preview_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Evolve existing Phase 6 system_configurations table.
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS configuration_number TEXT;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS project_name TEXT;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS system_type public.system_configurator_system_type;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.system_templates(id) ON DELETE SET NULL;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS design_reference TEXT;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS location_label TEXT;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS measurement_type public.system_measurement_type NOT NULL DEFAULT 'frame_outer_size';
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS view_direction public.system_view_direction NOT NULL DEFAULT 'inside_view';
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS panel_layout_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS options_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS finish_id UUID REFERENCES public.finish_options(id) ON DELETE SET NULL;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS glass_id UUID REFERENCES public.glass_items(id) ON DELETE SET NULL;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS status public.system_configuration_status NOT NULL DEFAULT 'draft';
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(7,3) NOT NULL DEFAULT 18;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS grand_total NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS margin_percent NUMERIC(7,3) NOT NULL DEFAULT 0;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS internal_cost NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS selling_price NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS set_system_configurations_updated_at ON public.system_configurations;
CREATE TRIGGER set_system_configurations_updated_at BEFORE UPDATE ON public.system_configurations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.system_panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  configuration_id UUID NOT NULL REFERENCES public.system_configurations(id) ON DELETE CASCADE,
  panel_index INTEGER NOT NULL,
  panel_type public.system_panel_type NOT NULL,
  panel_function TEXT,
  width_mm NUMERIC(10,2) NOT NULL DEFAULT 0,
  height_mm NUMERIC(10,2) NOT NULL DEFAULT 0,
  x_position_mm NUMERIC(10,2) NOT NULL DEFAULT 0,
  y_position_mm NUMERIC(10,2) NOT NULL DEFAULT 0,
  glass_required BOOLEAN NOT NULL DEFAULT true,
  mesh_required BOOLEAN NOT NULL DEFAULT false,
  is_openable BOOLEAN NOT NULL DEFAULT false,
  opening_direction public.system_opening_direction NOT NULL DEFAULT 'fixed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_profile_cuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  configuration_id UUID NOT NULL REFERENCES public.system_configurations(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.aluminium_profiles(id) ON DELETE SET NULL,
  component_role public.system_component_role NOT NULL,
  profile_code TEXT NOT NULL,
  profile_name TEXT NOT NULL,
  cut_length_mm NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  total_length_m NUMERIC(12,3) NOT NULL DEFAULT 0,
  section_weight_kg_per_m NUMERIC(12,4) NOT NULL DEFAULT 0,
  total_weight_kg NUMERIC(12,3) NOT NULL DEFAULT 0,
  angle_left TEXT NOT NULL DEFAULT '90',
  angle_right TEXT NOT NULL DEFAULT '90',
  deduction_mm NUMERIC(10,2) NOT NULL DEFAULT 0,
  addition_mm NUMERIC(10,2) NOT NULL DEFAULT 0,
  stock_length_mm NUMERIC(10,2) NOT NULL DEFAULT 6000,
  wastage_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  remarks TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT system_profile_cuts_positive CHECK (cut_length_mm > 0 AND quantity > 0)
);

CREATE TABLE IF NOT EXISTS public.system_glass_cuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  configuration_id UUID NOT NULL REFERENCES public.system_configurations(id) ON DELETE CASCADE,
  glass_id UUID REFERENCES public.glass_items(id) ON DELETE SET NULL,
  panel_index INTEGER NOT NULL,
  glass_label TEXT,
  width_mm NUMERIC(10,2) NOT NULL,
  height_mm NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  area_sqft NUMERIC(12,3) NOT NULL DEFAULT 0,
  area_sqm NUMERIC(12,3) NOT NULL DEFAULT 0,
  glass_type public.system_glass_type,
  thickness_mm NUMERIC(8,2) NOT NULL DEFAULT 0,
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  deduction_width_mm NUMERIC(10,2) NOT NULL DEFAULT 0,
  deduction_height_mm NUMERIC(10,2) NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT system_glass_cuts_positive CHECK (width_mm > 0 AND height_mm > 0 AND quantity > 0)
);

CREATE TABLE IF NOT EXISTS public.system_beading_cuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  configuration_id UUID NOT NULL REFERENCES public.system_configurations(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.aluminium_profiles(id) ON DELETE SET NULL,
  panel_index INTEGER NOT NULL,
  bead_position public.system_bead_position NOT NULL,
  cut_length_mm NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  total_length_m NUMERIC(12,3) NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT system_beading_cuts_positive CHECK (cut_length_mm > 0 AND quantity > 0)
);

CREATE TABLE IF NOT EXISTS public.system_hardware_bom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  configuration_id UUID NOT NULL REFERENCES public.system_configurations(id) ON DELETE CASCADE,
  hardware_item_id UUID REFERENCES public.hardware_items(id) ON DELETE SET NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  hardware_category public.hardware_category NOT NULL,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pcs',
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_material_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  configuration_id UUID NOT NULL REFERENCES public.system_configurations(id) ON DELETE CASCADE,
  material_type public.system_material_type NOT NULL,
  item_id UUID,
  item_code TEXT,
  item_name TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  total_weight_kg NUMERIC(12,3) NOT NULL DEFAULT 0,
  total_length_m NUMERIC(12,3) NOT NULL DEFAULT 0,
  total_area_sqft NUMERIC(12,3) NOT NULL DEFAULT 0,
  total_area_sqm NUMERIC(12,3) NOT NULL DEFAULT 0,
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profile_optimization_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  configuration_id UUID NOT NULL REFERENCES public.system_configurations(id) ON DELETE CASCADE,
  run_number INTEGER NOT NULL DEFAULT 1,
  stock_length_mm NUMERIC(10,2) NOT NULL DEFAULT 6000,
  input_cuts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  optimized_output_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_stock_bars INTEGER NOT NULL DEFAULT 0,
  total_used_length_mm NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_waste_mm NUMERIC(14,2) NOT NULL DEFAULT 0,
  waste_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.system_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  configuration_id UUID NOT NULL REFERENCES public.system_configurations(id) ON DELETE CASCADE,
  report_type public.system_report_type NOT NULL,
  file_url TEXT NOT NULL,
  generated_by UUID REFERENCES auth.users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: enforce company isolation on every configurator table.
ALTER TABLE public.system_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hardware_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glass_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finish_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_profile_cuts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_glass_cuts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_beading_cuts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_hardware_bom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_material_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_optimization_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_profiles_tenant_isolation" ON public.system_profiles;
CREATE POLICY "system_profiles_tenant_isolation" ON public.system_profiles FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "hardware_items_tenant_isolation" ON public.hardware_items;
CREATE POLICY "hardware_items_tenant_isolation" ON public.hardware_items FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "glass_items_tenant_isolation" ON public.glass_items;
CREATE POLICY "glass_items_tenant_isolation" ON public.glass_items FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "finish_options_tenant_isolation" ON public.finish_options;
CREATE POLICY "finish_options_tenant_isolation" ON public.finish_options FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "system_templates_tenant_isolation" ON public.system_templates;
CREATE POLICY "system_templates_tenant_isolation" ON public.system_templates FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "system_panels_tenant_isolation" ON public.system_panels;
CREATE POLICY "system_panels_tenant_isolation" ON public.system_panels FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "system_profile_cuts_tenant_isolation" ON public.system_profile_cuts;
CREATE POLICY "system_profile_cuts_tenant_isolation" ON public.system_profile_cuts FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "system_glass_cuts_tenant_isolation" ON public.system_glass_cuts;
CREATE POLICY "system_glass_cuts_tenant_isolation" ON public.system_glass_cuts FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "system_beading_cuts_tenant_isolation" ON public.system_beading_cuts;
CREATE POLICY "system_beading_cuts_tenant_isolation" ON public.system_beading_cuts FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "system_hardware_bom_tenant_isolation" ON public.system_hardware_bom;
CREATE POLICY "system_hardware_bom_tenant_isolation" ON public.system_hardware_bom FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "system_material_summary_tenant_isolation" ON public.system_material_summary;
CREATE POLICY "system_material_summary_tenant_isolation" ON public.system_material_summary FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "profile_optimization_runs_tenant_isolation" ON public.profile_optimization_runs;
CREATE POLICY "profile_optimization_runs_tenant_isolation" ON public.profile_optimization_runs FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "system_reports_tenant_isolation" ON public.system_reports;
CREATE POLICY "system_reports_tenant_isolation" ON public.system_reports FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

-- Tighten evolved table policies while preserving old names if they already exist.
DROP POLICY IF EXISTS "system_series_tenant_isolation" ON public.system_series;
CREATE POLICY "system_series_tenant_isolation" ON public.system_series FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "system_configurations_tenant_isolation" ON public.system_configurations;
CREATE POLICY "system_configurations_tenant_isolation" ON public.system_configurations FOR ALL
  USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

-- Updated-at triggers.
DROP TRIGGER IF EXISTS set_system_profiles_updated_at ON public.system_profiles;
CREATE TRIGGER set_system_profiles_updated_at BEFORE UPDATE ON public.system_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_hardware_items_updated_at ON public.hardware_items;
CREATE TRIGGER set_hardware_items_updated_at BEFORE UPDATE ON public.hardware_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_glass_items_updated_at ON public.glass_items;
CREATE TRIGGER set_glass_items_updated_at BEFORE UPDATE ON public.glass_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_finish_options_updated_at ON public.finish_options;
CREATE TRIGGER set_finish_options_updated_at BEFORE UPDATE ON public.finish_options FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_system_templates_updated_at ON public.system_templates;
CREATE TRIGGER set_system_templates_updated_at BEFORE UPDATE ON public.system_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Indexes for configurator workflows.
CREATE INDEX IF NOT EXISTS idx_system_series_company_active ON public.system_series(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_system_profiles_company_series ON public.system_profiles(company_id, series_id, is_active);
CREATE INDEX IF NOT EXISTS idx_system_profiles_role ON public.system_profiles(company_id, component_role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hardware_items_company_code ON public.hardware_items(company_id, item_code);
CREATE INDEX IF NOT EXISTS idx_hardware_items_category ON public.hardware_items(company_id, hardware_category, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_glass_items_company_code ON public.glass_items(company_id, glass_code);
CREATE INDEX IF NOT EXISTS idx_glass_items_type ON public.glass_items(company_id, glass_type, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_finish_options_company_code ON public.finish_options(company_id, finish_code);
CREATE INDEX IF NOT EXISTS idx_finish_options_type ON public.finish_options(company_id, finish_type, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_templates_company_code ON public.system_templates(company_id, template_code);
CREATE INDEX IF NOT EXISTS idx_system_templates_type ON public.system_templates(company_id, system_type, is_default, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_configurations_company_number ON public.system_configurations(company_id, configuration_number) WHERE configuration_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_configurations_company_status ON public.system_configurations(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_configurations_customer ON public.system_configurations(company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_system_panels_configuration ON public.system_panels(company_id, configuration_id, panel_index);
CREATE INDEX IF NOT EXISTS idx_system_profile_cuts_configuration ON public.system_profile_cuts(company_id, configuration_id, profile_code, cut_length_mm);
CREATE INDEX IF NOT EXISTS idx_system_glass_cuts_configuration ON public.system_glass_cuts(company_id, configuration_id, panel_index);
CREATE INDEX IF NOT EXISTS idx_system_beading_cuts_configuration ON public.system_beading_cuts(company_id, configuration_id, panel_index);
CREATE INDEX IF NOT EXISTS idx_system_hardware_bom_configuration ON public.system_hardware_bom(company_id, configuration_id, hardware_category);
CREATE INDEX IF NOT EXISTS idx_system_material_summary_configuration ON public.system_material_summary(company_id, configuration_id, material_type);
CREATE INDEX IF NOT EXISTS idx_profile_optimization_runs_configuration ON public.profile_optimization_runs(company_id, configuration_id, run_number DESC);
CREATE INDEX IF NOT EXISTS idx_system_reports_configuration ON public.system_reports(company_id, configuration_id, report_type);

COMMIT;
