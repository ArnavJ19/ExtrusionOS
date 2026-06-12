-- ============================================================
-- PCDA TECHNICAL ENRICHMENT: Order Items Column Completion
-- Task 9.2 — Add remaining TechnicalLineItem fields to order_items.
-- Safe, additive only. Uses ADD COLUMN IF NOT EXISTS throughout.
-- Requirements: 1.2, 5.1
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Add the canonical pieces_per_m_per_kg_per_bundle column
--    (Prior migration added decomposed pieces_per_bundle/meter_per_bundle/kg_per_bundle;
--     this adds the canonical single-field name from TechnicalLineItem.)
-- ------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS pieces_per_m_per_kg_per_bundle NUMERIC(14,3);

-- ------------------------------------------------------------
-- 2. Add CHECK constraint on drawing_approval_status
--    (Column was added in 20260602000000 but without a constraint.)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_items_drawing_approval_status_check'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_drawing_approval_status_check
      CHECK (drawing_approval_status IS NULL OR drawing_approval_status IN ('Pending', 'Approved', 'Rejected'));
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Verify all TechnicalLineItem columns exist on order_items.
--    These are all IF NOT EXISTS so they are no-ops if already present.
--    Included for completeness/safety to guarantee the full field set.
-- ------------------------------------------------------------

-- Identity / Reuse
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS source_record_id UUID;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS source_line_id UUID;

-- Basic tab: Section & Alloy details
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS section_number TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS section_code TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS section_name TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS customer_component_code TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS component_description TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS drawing_document_id UUID;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS drawing_revision TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS drawing_approval_status TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS alloy_standard_id UUID;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS alloy_id UUID;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS temper_id UUID;

-- Technical tab
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS cl_uom TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS cl_per_uom NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS cl_meter NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS order_uom TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS order_quantity NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS quantity_kg NUMERIC(14,3);
-- section_weight_kg_per_m may already exist on original table
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS section_weight_kg_per_m NUMERIC(12,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS min_weight NUMERIC(12,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS max_weight NUMERIC(12,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS weight_tolerance NUMERIC(12,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS quantity_calculation_method TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS packing_mode_id UUID;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS invoice_calc_uom TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS standard_length NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS cut_length NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS bundle_quantity NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS packing_instruction TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS customer_packing_requirement TEXT;

-- Commercial tab
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS material_price NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS value_added_service_price NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS other_charges NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS basic_price NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS packing_charge NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS freight_charge NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS alloy_surcharge_per_kg NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS re_cutting_charge_per_kg NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS testing_service_charge_per_kg NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS die_cost NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS die_service_charge NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS packing_in_conversion BOOLEAN DEFAULT false;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS include_packing_in_basic BOOLEAN DEFAULT false;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(7,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS discount NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS margin NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS net_rate NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS final_line_value NUMERIC(14,2);

-- Costing tab
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS input_billet_weight NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS output_good_weight NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS rejected_weight NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS rework_weight NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS packing_weight NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS freight_weight NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS theoretical_weight NUMERIC(14,3);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS actual_weight NUMERIC(14,3);

-- Internal fields
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS internal_cost NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS supplier_rate NUMERIC(14,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS internal_note TEXT;

-- Versioning
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS revision_number INTEGER DEFAULT 1;

-- ------------------------------------------------------------
-- 4. Indexes for reuse tracking (IF NOT EXISTS)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_order_items_pcda_source
  ON public.order_items(company_id, source_record_id, source_line_id);

CREATE INDEX IF NOT EXISTS idx_order_items_pcda_section
  ON public.order_items(company_id, section_number);

CREATE INDEX IF NOT EXISTS idx_order_items_pcda_alloy
  ON public.order_items(company_id, alloy_id, temper_id);

commit;
