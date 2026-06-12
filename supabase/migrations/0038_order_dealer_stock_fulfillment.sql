-- ============================================================
-- BATCH-LEVEL DEALER STOCK FULFILLMENT FOR QUOTE -> ORDER
-- ============================================================

CREATE TABLE IF NOT EXISTS public.order_dealer_stock_fulfillments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  profile_id UUID NOT NULL REFERENCES public.aluminium_profiles(id) ON DELETE RESTRICT,
  profile_stock_batch_id UUID NOT NULL REFERENCES public.profile_stock_batches(id) ON DELETE RESTRICT,
  fulfilled_weight_kg NUMERIC(14,3) NOT NULL CHECK (fulfilled_weight_kg > 0),
  fulfilled_length_m NUMERIC(14,3) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.order_dealer_stock_fulfillments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_dealer_stock_fulfillments tenant read" ON public.order_dealer_stock_fulfillments;
CREATE POLICY "order_dealer_stock_fulfillments tenant read" ON public.order_dealer_stock_fulfillments
  FOR SELECT USING (company_id = public.get_current_user_company_id());

DROP POLICY IF EXISTS "order_dealer_stock_fulfillments tenant insert" ON public.order_dealer_stock_fulfillments;
CREATE POLICY "order_dealer_stock_fulfillments tenant insert" ON public.order_dealer_stock_fulfillments
  FOR INSERT WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_order_dealer_fulfillments_order
  ON public.order_dealer_stock_fulfillments(company_id, order_id);
CREATE INDEX IF NOT EXISTS idx_order_dealer_fulfillments_batch
  ON public.order_dealer_stock_fulfillments(company_id, profile_stock_batch_id);

CREATE OR REPLACE FUNCTION public.create_order_from_quote_with_dealer_stock(
  p_quote_id UUID,
  p_order_number TEXT,
  p_order_date DATE,
  p_expected_dispatch_date DATE,
  p_priority TEXT,
  p_dealer_fulfilled_weight_kg NUMERIC,
  p_notes TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_user_id UUID;
  v_quote RECORD;
  v_order_id UUID;
  v_requested_weight NUMERIC(14,3);
  v_profile_requested_weight NUMERIC(14,3);
  v_dealer_weight NUMERIC(14,3);
  v_manufacturing_weight NUMERIC(14,3);
  v_stage TEXT;
  v_fulfillment_notes TEXT;
  v_remaining_dealer_weight NUMERIC(14,3);
  v_profile RECORD;
  v_profile_target NUMERIC(14,3);
  v_profile_remaining NUMERIC(14,3);
  v_allocated_profiles INTEGER := 0;
  v_profile_count INTEGER;
  v_batch RECORD;
  v_reserved_weight NUMERIC(14,3);
  v_available_weight NUMERIC(14,3);
  v_consume_weight NUMERIC(14,3);
  v_new_batch_weight NUMERIC(14,3);
  v_new_piece_count INTEGER;
BEGIN
  v_company_id := public.get_current_user_company_id();
  v_user_id := auth.uid();

  IF v_company_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT id, customer_id, grand_total, status
    INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id
    AND company_id = v_company_id
  FOR UPDATE;

  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'Quote not found' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders WHERE company_id = v_company_id AND quote_id = p_quote_id) THEN
    RAISE EXCEPTION 'This quote is already linked to an order' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders WHERE company_id = v_company_id AND order_number = p_order_number) THEN
    RAISE EXCEPTION 'Order number already exists' USING ERRCODE = '23505';
  END IF;

  SELECT ROUND(COALESCE(SUM(COALESCE(billing_weight_kg, total_weight_kg, 0)), 0)::numeric, 3)
    INTO v_requested_weight
  FROM public.quote_items
  WHERE quote_id = p_quote_id
    AND company_id = v_company_id;

  SELECT ROUND(COALESCE(SUM(COALESCE(billing_weight_kg, total_weight_kg, 0)), 0)::numeric, 3)
    INTO v_profile_requested_weight
  FROM public.quote_items
  WHERE quote_id = p_quote_id
    AND company_id = v_company_id
    AND profile_id IS NOT NULL;

  v_dealer_weight := ROUND(GREATEST(COALESCE(p_dealer_fulfilled_weight_kg, 0), 0)::numeric, 3);

  IF v_requested_weight <= 0 THEN
    RAISE EXCEPTION 'Quote has no billable profile weight' USING ERRCODE = '23514';
  END IF;

  IF v_dealer_weight > v_requested_weight THEN
    RAISE EXCEPTION 'Dealer fulfilled weight cannot exceed quote weight' USING ERRCODE = '23514';
  END IF;

  IF v_dealer_weight > 0 AND v_profile_requested_weight <= 0 THEN
    RAISE EXCEPTION 'Dealer fulfilled weight requires profile-backed quote items' USING ERRCODE = '23514';
  END IF;

  IF v_dealer_weight > v_profile_requested_weight THEN
    RAISE EXCEPTION 'Dealer fulfilled weight cannot exceed profile-backed quote weight' USING ERRCODE = '23514';
  END IF;

  v_manufacturing_weight := ROUND((v_requested_weight - v_dealer_weight)::numeric, 3);

  IF v_manufacturing_weight > 0 AND v_manufacturing_weight < 700 THEN
    RAISE EXCEPTION 'Urgent: factory balance % kg is below the 700 kg manufacturing minimum. Fulfill locally or arrange profile from another dealer/manufacturer.', v_manufacturing_weight USING ERRCODE = '23514';
  END IF;

  v_stage := CASE WHEN v_manufacturing_weight >= 700 THEN 'extrusion_planned' ELSE 'order_confirmed' END;
  v_fulfillment_notes := CASE
    WHEN v_dealer_weight > 0 THEN format('Dealer fulfilled %s kg from exact unreserved profile stock batches. Factory balance %s kg.', v_dealer_weight, v_manufacturing_weight)
    ELSE format('Factory manufacturing weight %s kg.', v_manufacturing_weight)
  END;

  INSERT INTO public.orders (
    company_id, order_number, quote_id, customer_id, order_date, expected_dispatch_date,
    priority, current_stage, order_value, requested_weight_kg, dealer_fulfilled_weight_kg,
    manufacturing_weight_kg, fulfillment_notes, notes, created_by
  ) VALUES (
    v_company_id, p_order_number, p_quote_id, v_quote.customer_id, p_order_date, p_expected_dispatch_date,
    p_priority, v_stage, COALESCE(v_quote.grand_total, 0), v_requested_weight, 0,
    v_requested_weight, v_fulfillment_notes, NULLIF(CONCAT_WS(E'\n', NULLIF(p_notes, ''), v_fulfillment_notes), ''), v_user_id
  ) RETURNING id INTO v_order_id;

  IF v_dealer_weight > 0 THEN
    SELECT COUNT(*)
      INTO v_profile_count
    FROM (
      SELECT profile_id
      FROM public.quote_items
      WHERE quote_id = p_quote_id
        AND company_id = v_company_id
        AND profile_id IS NOT NULL
      GROUP BY profile_id
    ) profile_groups;

    v_remaining_dealer_weight := v_dealer_weight;

    FOR v_profile IN
      SELECT profile_id, ROUND(SUM(COALESCE(billing_weight_kg, total_weight_kg, 0))::numeric, 3) AS required_weight_kg
      FROM public.quote_items
      WHERE quote_id = p_quote_id
        AND company_id = v_company_id
        AND profile_id IS NOT NULL
      GROUP BY profile_id
      ORDER BY profile_id
    LOOP
      v_allocated_profiles := v_allocated_profiles + 1;
      IF v_allocated_profiles = v_profile_count THEN
        v_profile_target := v_remaining_dealer_weight;
      ELSE
        v_profile_target := ROUND((v_dealer_weight * v_profile.required_weight_kg / v_profile_requested_weight)::numeric, 3);
      END IF;
      v_profile_target := LEAST(v_profile_target, v_profile.required_weight_kg);
      v_profile_remaining := v_profile_target;

      FOR v_batch IN
        SELECT id, profile_id, total_weight_kg, length_m, quantity_pieces, created_at
        FROM public.profile_stock_batches
        WHERE company_id = v_company_id
          AND profile_id = v_profile.profile_id
          AND status = 'available'
          AND total_weight_kg > 0
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
      LOOP
        EXIT WHEN v_profile_remaining <= 0;

        SELECT COALESCE(SUM(reserved_weight_kg), 0)
          INTO v_reserved_weight
        FROM public.profile_stock_reservations
        WHERE company_id = v_company_id
          AND profile_stock_batch_id = v_batch.id
          AND status = 'active';

        v_available_weight := ROUND(GREATEST(v_batch.total_weight_kg - v_reserved_weight, 0)::numeric, 3);
        IF v_available_weight <= 0 THEN
          CONTINUE;
        END IF;

        v_consume_weight := LEAST(v_profile_remaining, v_available_weight);
        v_new_batch_weight := ROUND((v_batch.total_weight_kg - v_consume_weight)::numeric, 3);
        v_new_piece_count := CASE
          WHEN v_batch.total_weight_kg > 0 THEN GREATEST(0, ROUND(v_batch.quantity_pieces * (v_new_batch_weight / v_batch.total_weight_kg))::integer)
          ELSE 0
        END;

        INSERT INTO public.order_dealer_stock_fulfillments (
          company_id, order_id, quote_id, profile_id, profile_stock_batch_id,
          fulfilled_weight_kg, fulfilled_length_m, notes, created_by
        ) VALUES (
          v_company_id, v_order_id, p_quote_id, v_profile.profile_id, v_batch.id,
          v_consume_weight,
          CASE WHEN v_batch.total_weight_kg > 0 THEN ROUND((COALESCE(v_batch.length_m, 0) * v_consume_weight / v_batch.total_weight_kg)::numeric, 3) ELSE 0 END,
          'Dealer partial fulfillment from unreserved profile stock',
          v_user_id
        );

        UPDATE public.profile_stock_batches
        SET total_weight_kg = v_new_batch_weight,
            quantity_pieces = v_new_piece_count,
            status = CASE WHEN v_new_batch_weight <= 0 THEN 'dispatched' ELSE status END,
            updated_at = now()
        WHERE id = v_batch.id
          AND company_id = v_company_id;

        v_profile_remaining := ROUND((v_profile_remaining - v_consume_weight)::numeric, 3);
        v_remaining_dealer_weight := ROUND((v_remaining_dealer_weight - v_consume_weight)::numeric, 3);
      END LOOP;

      IF v_profile_remaining > 0.001 THEN
        RAISE EXCEPTION 'Insufficient unreserved stock for one or more quoted profiles. Remaining profile shortfall: % kg', v_profile_remaining USING ERRCODE = '23514';
      END IF;
    END LOOP;

    IF v_remaining_dealer_weight > 0.001 THEN
      RAISE EXCEPTION 'Could not allocate the full dealer fulfilled weight to quoted profile stock. Remaining dealer weight: % kg', v_remaining_dealer_weight USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.orders
  SET dealer_fulfilled_weight_kg = v_dealer_weight,
      manufacturing_weight_kg = v_manufacturing_weight,
      fulfillment_notes = v_fulfillment_notes
  WHERE id = v_order_id
    AND company_id = v_company_id;

  INSERT INTO public.order_stage_history (company_id, order_id, stage, changed_by, remarks)
  VALUES (v_company_id, v_order_id, v_stage, v_user_id, v_fulfillment_notes);

  UPDATE public.quotes
  SET status = 'converted_to_order'
  WHERE id = p_quote_id
    AND company_id = v_company_id;

  RETURN v_order_id;
END;
$$;
