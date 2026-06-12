-- ============================================================
-- PCDA TECHNICAL ENRICHMENT: Production Jobs & Packing List Items
-- Task 9.3 — Add PCDA columns to production batch (production_jobs)
-- and dispatch line (packing_list_items) tables.
-- Safe, additive only. Uses ADD COLUMN IF NOT EXISTS throughout.
-- Requirements: 1.2, 5.1
-- ============================================================

begin;

-- ============================================================
-- PART 1: production_jobs — Production batch/job enrichment
-- ============================================================
-- The production_jobs table already has: profile_id, die_id,
-- planned_quantity_kg, actual_quantity_kg, extrusion_efficiency_percent,
-- length_per_piece_m, pieces. We add the remaining PCDA fields
-- relevant to production context.

-- Identity / Reuse (track source order line)
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS source_record_id UUID;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS source_line_id UUID;

-- Basic tab: Section & Alloy details
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS section_number TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS section_code TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS section_name TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS customer_component_code TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS component_description TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS drawing_document_id UUID;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS drawing_revision TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS drawing_approval_status TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS alloy_standard_id UUID;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS alloy_id UUID;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS temper_id UUID;

-- Technical tab
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS cl_uom TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS cl_per_uom NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS cl_meter NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS order_uom TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS order_quantity NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS quantity_kg NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS section_weight_kg_per_m NUMERIC(12,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS min_weight NUMERIC(12,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS max_weight NUMERIC(12,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS weight_tolerance NUMERIC(12,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS quantity_calculation_method TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS packing_mode_id UUID;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS invoice_calc_uom TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS standard_length NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS cut_length NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS bundle_quantity NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS pieces_per_m_per_kg_per_bundle NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS packing_instruction TEXT;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS customer_packing_requirement TEXT;

-- Costing tab: production-specific weights
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS input_billet_weight NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS output_good_weight NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS rejected_weight NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS rework_weight NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS packing_weight NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS freight_weight NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS theoretical_weight NUMERIC(14,3);
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS actual_weight NUMERIC(14,3);

-- Versioning
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS revision_number INTEGER DEFAULT 1;

-- CHECK constraint on drawing_approval_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'production_jobs_drawing_approval_status_check'
      AND conrelid = 'public.production_jobs'::regclass
  ) THEN
    ALTER TABLE public.production_jobs
      ADD CONSTRAINT production_jobs_drawing_approval_status_check
      CHECK (drawing_approval_status IS NULL OR drawing_approval_status IN ('Pending', 'Approved', 'Rejected'));
  END IF;
END $$;

-- Indexes for production PCDA enrichment
CREATE INDEX IF NOT EXISTS idx_production_jobs_pcda_source
  ON public.production_jobs(company_id, source_record_id, source_line_id);

CREATE INDEX IF NOT EXISTS idx_production_jobs_pcda_section
  ON public.production_jobs(company_id, section_number);

CREATE INDEX IF NOT EXISTS idx_production_jobs_pcda_alloy
  ON public.production_jobs(company_id, alloy_id, temper_id);


-- ============================================================
-- PART 2: packing_list_items — Dispatch line enrichment
-- ============================================================
-- The packing_list_items table already has: dispatch_id, profile_id,
-- bundle_number, number_of_pieces, gross_weight_kg, tare_weight_kg,
-- net_weight_kg (generated). We add the PCDA fields relevant to
-- dispatch/packing context.

-- Identity / Reuse (track source order line / production job)
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS source_record_id UUID;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS source_line_id UUID;

-- Basic tab: Section & Alloy details
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS section_number TEXT;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS section_code TEXT;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS section_name TEXT;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS customer_component_code TEXT;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS component_description TEXT;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS alloy_standard_id UUID;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS alloy_id UUID;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS temper_id UUID;

-- Technical tab: packing/dispatch-specific fields
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS quantity_kg NUMERIC(14,3);
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS section_weight_kg_per_m NUMERIC(12,3);
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS quantity_calculation_method TEXT;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS packing_mode_id UUID;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS bundle_quantity NUMERIC(14,3);
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS pieces_per_m_per_kg_per_bundle NUMERIC(14,3);
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS packing_instruction TEXT;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS customer_packing_requirement TEXT;
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS standard_length NUMERIC(14,3);
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS cut_length NUMERIC(14,3);

-- Costing tab: dispatch weights
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS packing_weight NUMERIC(14,3);
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS freight_weight NUMERIC(14,3);
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS theoretical_weight NUMERIC(14,3);
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS actual_weight NUMERIC(14,3);

-- Versioning
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS revision_number INTEGER DEFAULT 1;

-- Indexes for dispatch line PCDA enrichment
CREATE INDEX IF NOT EXISTS idx_packing_list_items_pcda_source
  ON public.packing_list_items(company_id, source_record_id, source_line_id);

CREATE INDEX IF NOT EXISTS idx_packing_list_items_pcda_section
  ON public.packing_list_items(company_id, section_number);

CREATE INDEX IF NOT EXISTS idx_packing_list_items_pcda_alloy
  ON public.packing_list_items(company_id, alloy_id, temper_id);

commit;
