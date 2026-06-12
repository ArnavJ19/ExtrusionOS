-- ============================================================
-- PCDA TECHNICAL ENRICHMENT: DIE MASTER & PROFILE MASTER
-- Phase 1 — Additive columns and new supporting tables
-- ============================================================

-- ===========================================
-- 1. ENRICH DIES TABLE (additive columns only)
-- ===========================================

-- Die Design and Geometry
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_code TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS internal_die_reference TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS customer_die_reference TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_type TEXT DEFAULT 'solid'
  CHECK (die_type IN ('solid','hollow','semi_hollow','porthole','bridge','feeder','multi_cavity','flat','special'));
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS number_of_cavities INTEGER DEFAULT 1;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS number_of_holes INTEGER;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_class TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS application_category TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS end_use_industry TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS press_compatibility TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS priority_level TEXT DEFAULT 'normal'
  CHECK (priority_level IN ('low','normal','high','critical'));

-- Die Geometry
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_diameter_mm NUMERIC(10,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_thickness_mm NUMERIC(10,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_stack_height_mm NUMERIC(10,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS backer_diameter_mm NUMERIC(10,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS bolster_diameter_mm NUMERIC(10,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS feeder_plate_details TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS mandrel_details TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS bridge_details TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS porthole_details TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS welding_chamber_details TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS bearing_length_mm NUMERIC(10,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS bearing_corrections TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS entry_angle_degrees NUMERIC(6,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS relief_angle_degrees NUMERIC(6,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS pocketing_details TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS choke_details TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS tongue_ratio NUMERIC(8,4);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS extrusion_ratio NUMERIC(8,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS ccd_mm NUMERIC(10,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS output_per_stroke_kg NUMERIC(10,3);

-- Die Drawing
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS drawing_revision TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS drawing_approval_status TEXT DEFAULT 'pending'
  CHECK (drawing_approval_status IN ('pending','approved','rejected','superseded'));
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS drawing_approved_by UUID REFERENCES auth.users(id);

-- Die Material and Manufacturing
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_steel_grade TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_vendor_id UUID;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS purchase_order_reference TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS manufacturing_date DATE;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS receipt_date DATE;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS heat_treatment_status TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS hardness_before_nitriding NUMERIC(6,1);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS hardness_after_nitriding NUMERIC(6,1);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS hrc_value NUMERIC(5,1);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS hv_value NUMERIC(6,1);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS dimensional_inspection_status TEXT
  CHECK (dimensional_inspection_status IN ('pending','passed','failed','not_required'));

-- Die Performance (extended)
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS total_billets_used INTEGER DEFAULT 0;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS total_input_weight_kg NUMERIC(14,3) DEFAULT 0;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS total_good_output_kg NUMERIC(14,3) DEFAULT 0;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS total_scrap_kg NUMERIC(14,3) DEFAULT 0;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS average_recovery_percent NUMERIC(6,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS average_rejection_percent NUMERIC(6,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS average_extrusion_speed NUMERIC(8,2);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_life_tons NUMERIC(12,3);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_life_billets INTEGER;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS performance_grade TEXT DEFAULT 'good'
  CHECK (performance_grade IN ('excellent','good','average','problematic','blocked'));

-- Die Maintenance / Storage
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_blocked_reason TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS die_retirement_reason TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS storage_bin TEXT;
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id);
ALTER TABLE public.dies ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Expand die_status check constraint to include new statuses
ALTER TABLE public.dies DROP CONSTRAINT IF EXISTS dies_die_status_check;
ALTER TABLE public.dies ADD CONSTRAINT dies_die_status_check
  CHECK (die_status IN (
    'design','ordered','received','under_trial','approved','active',
    'under_correction','under_maintenance','blocked','retired','scrapped',
    'trial','correction','nitriding','inactive','dead'
  ));

-- Expand ownership_type check constraint
ALTER TABLE public.dies DROP CONSTRAINT IF EXISTS dies_ownership_type_check;
ALTER TABLE public.dies ADD CONSTRAINT dies_ownership_type_check
  CHECK (ownership_type IN ('company_owned','customer_owned','shared','trial','archived'));

-- ===========================================
-- 2. DIE NITRIDING HISTORY TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS public.die_nitriding_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  die_id UUID NOT NULL REFERENCES public.dies(id) ON DELETE CASCADE,
  nitriding_cycle_number INTEGER NOT NULL DEFAULT 1,
  nitriding_vendor TEXT,
  nitriding_date DATE,
  nitriding_process_type TEXT,
  nitriding_temperature_c NUMERIC(6,1),
  nitriding_duration_hours NUMERIC(6,1),
  case_depth_mm NUMERIC(6,3),
  white_layer_thickness_mm NUMERIC(6,4),
  surface_hardness NUMERIC(6,1),
  core_hardness NUMERIC(6,1),
  pre_nitriding_cleaning_done BOOLEAN DEFAULT false,
  post_nitriding_inspection_done BOOLEAN DEFAULT false,
  certificate_document_id UUID,
  tons_since_last_nitriding NUMERIC(12,3),
  runs_since_last_nitriding INTEGER,
  next_nitriding_due_date DATE,
  status TEXT DEFAULT 'completed' CHECK (status IN ('scheduled','in_progress','completed','failed')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.die_nitriding_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "die_nitriding_tenant" ON public.die_nitriding_history
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_die_nitriding_company ON public.die_nitriding_history(company_id);
CREATE INDEX idx_die_nitriding_die ON public.die_nitriding_history(die_id, nitriding_date DESC);

-- ===========================================
-- 3. ENRICH DIE TRIALS TABLE (additive columns)
-- ===========================================
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS trial_press TEXT;
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS trial_billet_alloy TEXT;
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS trial_billet_diameter_mm NUMERIC(8,2);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS trial_billet_length_mm NUMERIC(8,2);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS trial_billet_temperature_c NUMERIC(6,1);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS container_temperature_c NUMERIC(6,1);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS ram_speed_mm_per_sec NUMERIC(8,2);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS pressure_tons NUMERIC(8,2);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS exit_temperature_c NUMERIC(6,1);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS puller_speed NUMERIC(8,2);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS quench_method TEXT;
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS straightness_result TEXT;
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS surface_finish_result TEXT;
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS trial_output_weight_kg NUMERIC(10,3);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS trial_recovery_percent NUMERIC(6,2);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS trial_rejection_percent NUMERIC(6,2);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id);
ALTER TABLE public.die_trials ADD COLUMN IF NOT EXISTS trial_report_document_id UUID;

-- ===========================================
-- 4. ENRICH DIE CORRECTIONS TABLE (additive columns)
-- ===========================================
ALTER TABLE public.die_corrections ADD COLUMN IF NOT EXISTS correction_type TEXT;
ALTER TABLE public.die_corrections ADD COLUMN IF NOT EXISTS correction_technician TEXT;
ALTER TABLE public.die_corrections ADD COLUMN IF NOT EXISTS before_issue TEXT;
ALTER TABLE public.die_corrections ADD COLUMN IF NOT EXISTS after_result TEXT;
ALTER TABLE public.die_corrections ADD COLUMN IF NOT EXISTS bearing_correction_details TEXT;
ALTER TABLE public.die_corrections ADD COLUMN IF NOT EXISTS polishing_details TEXT;
ALTER TABLE public.die_corrections ADD COLUMN IF NOT EXISTS welding_choke_flow_details TEXT;

-- ===========================================
-- 5. ENRICH ALUMINIUM PROFILES TABLE (additive columns)
-- ===========================================

-- Engineering and Drawing Data
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS section_number TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS internal_profile_reference TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS customer_profile_reference TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS product_family TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS system_type TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS end_use_industry TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'draft'
  CHECK (approval_status IN ('draft','submitted','approved','rejected','superseded'));
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Drawing details
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS drawing_revision TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS drawing_approval_status TEXT DEFAULT 'pending'
  CHECK (drawing_approval_status IN ('pending','approved','rejected','superseded'));
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS drawing_approved_by UUID REFERENCES auth.users(id);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS drawing_effective_date DATE;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS cross_section_image_url TEXT;

-- Geometry
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS section_perimeter_mm NUMERIC(10,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS circumscribing_circle_diameter_mm NUMERIC(10,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS nominal_wall_thickness_mm NUMERIC(8,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS min_wall_thickness_mm NUMERIC(8,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS max_wall_thickness_mm NUMERIC(8,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS critical_wall_thickness_mm NUMERIC(8,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS profile_classification TEXT DEFAULT 'solid'
  CHECK (profile_classification IN ('solid','hollow','semi_hollow'));
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS number_of_voids INTEGER DEFAULT 0;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS complexity_rating TEXT DEFAULT 'standard'
  CHECK (complexity_rating IN ('simple','standard','complex','very_complex'));
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS tolerance_class TEXT;

-- Weight and Measurement (extended)
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS actual_weight_kg_per_m NUMERIC(12,3);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS weight_tolerance_percent NUMERIC(5,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS min_cutting_length_m NUMERIC(8,3);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS max_cutting_length_m NUMERIC(8,3);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS bundle_quantity INTEGER;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS pieces_per_bundle INTEGER;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS meter_per_bundle NUMERIC(10,3);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS kg_per_bundle NUMERIC(10,3);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS surface_area_per_meter_sqm NUMERIC(8,4);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS powder_coating_area_sqm NUMERIC(8,4);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS anodizing_area_sqm NUMERIC(8,4);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS scrap_factor_percent NUMERIC(5,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS recovery_target_percent NUMERIC(5,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS min_acceptable_recovery_percent NUMERIC(5,2);

-- Alloy and Temper (extended)
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS recommended_alloy TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS allowed_alloys TEXT[];
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS temper_requirement TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS hardness_requirement TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS tensile_strength_mpa NUMERIC(8,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS yield_strength_mpa NUMERIC(8,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS elongation_percent NUMERIC(5,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS heat_treatment_requirement TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS aging_cycle_requirement TEXT;

-- Production Parameters
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS recommended_press TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS compatible_presses TEXT[];
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS billet_diameter_mm NUMERIC(8,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS billet_length_range TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS billet_alloy TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS billet_temperature_range TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS container_temperature_range TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS die_temperature_range TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS ram_speed_range TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS exit_temperature_range TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS puller_speed_range TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS quench_method TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS stretching_requirement TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS aging_requirement TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS cutting_instructions TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS handling_instructions TEXT;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS special_production_notes TEXT;

-- Surface Treatment
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS mill_finish_allowed BOOLEAN DEFAULT true;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS powder_coating_allowed BOOLEAN DEFAULT true;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS anodizing_allowed BOOLEAN DEFAULT true;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS wood_finish_allowed BOOLEAN DEFAULT false;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS pvdf_allowed BOOLEAN DEFAULT false;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS special_finish_allowed BOOLEAN DEFAULT false;
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS approved_colors TEXT[];
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS coating_thickness_microns NUMERIC(6,1);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS anodizing_micron_requirement NUMERIC(6,1);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS pre_treatment_requirement TEXT;

-- Commercial / Costing
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS base_rate_per_kg NUMERIC(12,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS minimum_order_quantity_kg NUMERIC(10,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS packing_cost_per_kg NUMERIC(10,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS production_cost_per_kg NUMERIC(10,2);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS energy_cost_per_kg NUMERIC(10,2);

-- Die Linkage
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS primary_die_id UUID REFERENCES public.dies(id);
ALTER TABLE public.aluminium_profiles ADD COLUMN IF NOT EXISTS backup_die_id UUID REFERENCES public.dies(id);

-- ===========================================
-- 6. PROFILE ROUTING TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS public.profile_routing_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.aluminium_profiles(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  stage_name TEXT NOT NULL,
  is_required BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  estimated_duration_hours NUMERIC(8,2),
  department TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_routing_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profile_routing_tenant" ON public.profile_routing_steps
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_profile_routing_company ON public.profile_routing_steps(company_id, profile_id, step_order);

-- ===========================================
-- 7. PROFILE QUALITY PLAN TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS public.profile_quality_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.aluminium_profiles(id) ON DELETE CASCADE,
  inspection_stage TEXT NOT NULL,
  parameter_name TEXT NOT NULL,
  acceptance_criteria TEXT,
  rejection_criteria TEXT,
  inspection_frequency TEXT,
  is_mandatory BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_quality_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profile_quality_plan_tenant" ON public.profile_quality_plans
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_profile_quality_plan_company ON public.profile_quality_plans(company_id, profile_id);

-- ===========================================
-- 8. PROFILE DEFECT RULES TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS public.profile_defect_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.aluminium_profiles(id) ON DELETE CASCADE,
  defect_type TEXT NOT NULL,
  severity TEXT DEFAULT 'minor' CHECK (severity IN ('minor','major','critical')),
  process_stage TEXT,
  possible_root_cause TEXT,
  corrective_action TEXT,
  linked_die_id UUID REFERENCES public.dies(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_defect_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profile_defect_rules_tenant" ON public.profile_defect_rules
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_profile_defect_rules_company ON public.profile_defect_rules(company_id, profile_id);

-- ===========================================
-- 9. ENTITY REVISIONS TABLE (versioning)
-- ===========================================
CREATE TABLE IF NOT EXISTS public.entity_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  prior_state JSONB NOT NULL,
  actor_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, entity_type, entity_id, revision_number)
);

ALTER TABLE public.entity_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "entity_revisions_tenant" ON public.entity_revisions
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_entity_revisions_lookup ON public.entity_revisions(company_id, entity_type, entity_id, revision_number DESC);

-- ===========================================
-- 10. TECHNICAL DOCUMENTS TABLE (enriched)
-- ===========================================
CREATE TABLE IF NOT EXISTS public.technical_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  linked_entity_type TEXT NOT NULL,
  linked_entity_id UUID NOT NULL,
  version_number INTEGER DEFAULT 1,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  approval_status TEXT DEFAULT 'pending'
    CHECK (approval_status IN ('pending','approved','rejected','superseded')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  expiry_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.technical_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "technical_documents_tenant" ON public.technical_documents
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_technical_documents_entity ON public.technical_documents(company_id, linked_entity_type, linked_entity_id);
CREATE INDEX idx_technical_documents_type ON public.technical_documents(company_id, document_type);

-- ===========================================
-- 11. TECHNICAL REPORTS TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS public.technical_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id UUID NOT NULL,
  record_number TEXT,
  revision_number INTEGER,
  storage_path TEXT NOT NULL,
  generated_by UUID REFERENCES auth.users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.technical_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "technical_reports_tenant" ON public.technical_reports
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());
CREATE INDEX idx_technical_reports_record ON public.technical_reports(company_id, record_type, record_id);

-- ===========================================
-- 12. ADDITIONAL INDEXES FOR PERFORMANCE
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_dies_type ON public.dies(company_id, die_type);
CREATE INDEX IF NOT EXISTS idx_dies_performance ON public.dies(company_id, performance_grade);
CREATE INDEX IF NOT EXISTS idx_profiles_classification ON public.aluminium_profiles(company_id, profile_classification);
CREATE INDEX IF NOT EXISTS idx_profiles_approval ON public.aluminium_profiles(company_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_profiles_drawing_approval ON public.aluminium_profiles(company_id, drawing_approval_status);

-- ===========================================
-- 13. TRIGGERS FOR updated_at
-- ===========================================
DROP TRIGGER IF EXISTS set_die_nitriding_updated_at ON public.die_nitriding_history;
CREATE TRIGGER set_die_nitriding_updated_at BEFORE UPDATE ON public.die_nitriding_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_profile_routing_updated_at ON public.profile_routing_steps;
CREATE TRIGGER set_profile_routing_updated_at BEFORE UPDATE ON public.profile_routing_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_profile_quality_plan_updated_at ON public.profile_quality_plans;
CREATE TRIGGER set_profile_quality_plan_updated_at BEFORE UPDATE ON public.profile_quality_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_profile_defect_rules_updated_at ON public.profile_defect_rules;
CREATE TRIGGER set_profile_defect_rules_updated_at BEFORE UPDATE ON public.profile_defect_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_technical_documents_updated_at ON public.technical_documents;
CREATE TRIGGER set_technical_documents_updated_at BEFORE UPDATE ON public.technical_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
