-- ============================================================
-- PCDA TECHNICAL ENRICHMENT: Invoice Items Table
-- Task 9.4 — Create invoice_items table with full PCDA column set.
-- Uses CREATE TABLE IF NOT EXISTS for safety.
-- Requirements: 1.2, 5.1
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Create the invoice_items table with full TechnicalLineItem field set
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,

  -- Identity / Reuse
  source_record_id UUID,
  source_line_id UUID,

  -- Basic tab: Section & Alloy details (Req 2)
  section_number TEXT,
  section_code TEXT,
  section_name TEXT,
  customer_component_code TEXT,
  component_description TEXT,
  drawing_document_id UUID,
  drawing_revision TEXT,
  drawing_approval_status TEXT,
  alloy_standard_id UUID,
  alloy_id UUID,
  temper_id UUID,

  -- Technical tab (Req 2, 4)
  cl_uom TEXT,
  cl_per_uom NUMERIC(14,3),
  cl_meter NUMERIC(14,3),
  order_uom TEXT,
  order_quantity NUMERIC(14,3),
  quantity_kg NUMERIC(14,3),
  section_weight_kg_per_m NUMERIC(12,3),
  min_weight NUMERIC(12,3),
  max_weight NUMERIC(12,3),
  weight_tolerance NUMERIC(12,3),
  quantity_calculation_method TEXT,
  packing_mode_id UUID,
  invoice_calc_uom TEXT,
  standard_length NUMERIC(14,3),
  cut_length NUMERIC(14,3),
  bundle_quantity NUMERIC(14,3),
  pieces_per_m_per_kg_per_bundle NUMERIC(14,3),
  packing_instruction TEXT,
  customer_packing_requirement TEXT,

  -- Commercial tab: Basic price & charges (Req 3)
  material_price NUMERIC(14,2),
  value_added_service_price NUMERIC(14,2),
  other_charges NUMERIC(14,2),
  basic_price NUMERIC(14,2),
  packing_charge NUMERIC(14,2),
  freight_charge NUMERIC(14,2),
  alloy_surcharge_per_kg NUMERIC(14,2),
  re_cutting_charge_per_kg NUMERIC(14,2),
  testing_service_charge_per_kg NUMERIC(14,2),
  die_cost NUMERIC(14,2),
  die_service_charge NUMERIC(14,2),
  packing_in_conversion BOOLEAN DEFAULT false,
  include_packing_in_basic BOOLEAN DEFAULT false,
  gst_percent NUMERIC(7,2),
  discount NUMERIC(14,2),
  margin NUMERIC(14,2),
  net_rate NUMERIC(14,2),
  final_line_value NUMERIC(14,2),

  -- Costing tab: technical weights/costs (Req 4)
  input_billet_weight NUMERIC(14,3),
  output_good_weight NUMERIC(14,3),
  rejected_weight NUMERIC(14,3),
  rework_weight NUMERIC(14,3),
  packing_weight NUMERIC(14,3),
  freight_weight NUMERIC(14,3),
  theoretical_weight NUMERIC(14,3),
  actual_weight NUMERIC(14,3),

  -- Internal fields (excluded from customer sheets — Req 5.5, 28)
  internal_cost NUMERIC(14,2),
  supplier_rate NUMERIC(14,2),
  internal_note TEXT,

  -- Versioning (Req 22.2)
  revision_number INTEGER DEFAULT 1,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. CHECK constraint on drawing_approval_status
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_items_drawing_approval_status_check'
      AND conrelid = 'public.invoice_items'::regclass
  ) THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_drawing_approval_status_check
      CHECK (drawing_approval_status IS NULL OR drawing_approval_status IN ('Pending', 'Approved', 'Rejected'));
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Enable RLS and create policies
-- ------------------------------------------------------------
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'invoice_items' AND policyname = 'invoice_items_select'
  ) THEN
    CREATE POLICY invoice_items_select ON public.invoice_items
      FOR SELECT USING (company_id = public.get_current_user_company_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'invoice_items' AND policyname = 'invoice_items_modify'
  ) THEN
    CREATE POLICY invoice_items_modify ON public.invoice_items
      FOR ALL USING (company_id = public.get_current_user_company_id())
      WITH CHECK (company_id = public.get_current_user_company_id());
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoice_items_company_invoice
  ON public.invoice_items(company_id, invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_pcda_source
  ON public.invoice_items(company_id, source_record_id, source_line_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_pcda_section
  ON public.invoice_items(company_id, section_number);

commit;
