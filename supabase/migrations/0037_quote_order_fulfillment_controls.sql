-- ============================================================
-- QUOTE -> ORDER AND DEALER FULFILLMENT CONTROLS
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS requested_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dealer_fulfilled_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manufacturing_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fulfillment_notes TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_weight_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_fulfillment_weight_check
      CHECK (
        requested_weight_kg >= 0
        AND dealer_fulfilled_weight_kg >= 0
        AND manufacturing_weight_kg >= 0
        AND dealer_fulfilled_weight_kg <= requested_weight_kg
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_factory_minimum_weight_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_factory_minimum_weight_check
      CHECK (
        current_stage NOT IN ('extrusion_planned','die_ready','billet_ready','billet_heating','extruded','stretching','cutting','aging','surface_treatment','finishing','packing')
        OR manufacturing_weight_kg >= 700
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_company_quote ON public.orders(company_id, quote_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_manufacturing_weight ON public.orders(company_id, manufacturing_weight_kg);
