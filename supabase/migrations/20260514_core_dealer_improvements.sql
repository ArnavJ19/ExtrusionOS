-- Add new columns to orders
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS created_by_role text,
ADD COLUMN IF NOT EXISTS created_by_organization_type text,
ADD COLUMN IF NOT EXISTS created_by_dealership_id uuid REFERENCES dealers(id),
ADD COLUMN IF NOT EXISTS order_origin text CHECK (order_origin IN ('FACTORY_DIRECT', 'DEALER_ADMIN_CREATED', 'DEALER_EMPLOYEE_CREATED', 'UNKNOWN_LEGACY')),
ADD COLUMN IF NOT EXISTS order_source_label text;

-- Update existing orders to populate order_origin and created_by_user_id
UPDATE orders
SET 
  order_origin = CASE
    WHEN dealer_id IS NOT NULL THEN 'DEALER_ADMIN_CREATED'
    ELSE 'FACTORY_DIRECT'
  END,
  created_by_user_id = created_by
WHERE order_origin IS NULL;

-- Ensure app_users has organization_type
ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS organization_type text DEFAULT 'factory' CHECK (organization_type IN ('factory', 'dealer'));

UPDATE app_users
SET organization_type = CASE WHEN dealer_id IS NOT NULL THEN 'dealer' ELSE 'factory' END
WHERE organization_type IS NULL OR organization_type = 'factory' AND dealer_id IS NOT NULL;

-- Update tasks table
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES dealers(id),
ADD COLUMN IF NOT EXISTS assigned_by_user_id uuid REFERENCES auth.users(id);

-- Update payments table
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES dealers(id),
ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id),
ADD COLUMN IF NOT EXISTS payment_type text CHECK (payment_type IN ('CUSTOMER_TO_DEALER', 'DEALER_TO_FACTORY', 'ADVANCE_PAYMENT', 'PARTIAL_PAYMENT', 'FINAL_PAYMENT', 'REFUND', 'ADJUSTMENT')),
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'PARTIALLY_PAID', 'FAILED', 'REFUNDED', 'CANCELLED')),
ADD COLUMN IF NOT EXISTS recorded_by_user_id uuid REFERENCES auth.users(id);

-- Make invoice_id optional on payments since it can be linked to an order directly
ALTER TABLE payments ALTER COLUMN invoice_id DROP NOT NULL;

-- Update audit_logs_enterprise
ALTER TABLE audit_logs_enterprise
ADD COLUMN IF NOT EXISTS actor_organization_type text,
ADD COLUMN IF NOT EXISTS description text;

-- Create Indexes
CREATE INDEX IF NOT EXISTS idx_orders_dealership_id ON orders(dealer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_by_user_id ON orders(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_origin ON orders(order_origin);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_user_id ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by_user_id ON tasks(assigned_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_dealership_id ON tasks(dealership_id);
CREATE INDEX IF NOT EXISTS idx_payments_dealership_id ON payments(dealership_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_status ON payments(payment_status);

-- Update RLS for tasks
DROP POLICY IF EXISTS "Tasks viewable by everyone in company" ON tasks;
DROP POLICY IF EXISTS "Tasks insertable by everyone in company" ON tasks;
DROP POLICY IF EXISTS "Tasks updatable by everyone in company" ON tasks;

CREATE POLICY "Tasks viewable by authorized users" ON tasks
  FOR SELECT USING (
    company_id = (SELECT get_current_user_company_id())
    AND (
      (SELECT get_current_user_role()) IN ('owner', 'admin')
      OR
      (dealership_id IS NULL AND (SELECT get_current_user_dealer_id()) IS NULL)
      OR
      (dealership_id = (SELECT get_current_user_dealer_id()) AND (SELECT get_current_user_role()) = 'dealer_admin')
      OR
      (assigned_to = auth.uid())
      OR 
      (created_by = auth.uid())
    )
  );

CREATE POLICY "Tasks insertable by authorized users" ON tasks
  FOR INSERT WITH CHECK (
    company_id = (SELECT get_current_user_company_id())
    AND (
      (dealership_id = (SELECT get_current_user_dealer_id()))
      OR 
      ((SELECT get_current_user_role()) IN ('owner', 'admin'))
    )
  );

CREATE POLICY "Tasks updatable by authorized users" ON tasks
  FOR UPDATE USING (
    company_id = (SELECT get_current_user_company_id())
    AND (
      (SELECT get_current_user_role()) IN ('owner', 'admin')
      OR
      (dealership_id = (SELECT get_current_user_dealer_id()) AND (SELECT get_current_user_role()) = 'dealer_admin')
      OR
      (assigned_to = auth.uid())
    )
  );

-- Update RLS for audit logs enterprise (allow dealer admin to view their own)
DROP POLICY IF EXISTS "Enable read access for permitted users" ON audit_logs_enterprise;

CREATE POLICY "Enable read access for permitted users" ON audit_logs_enterprise
  FOR SELECT USING (
    company_id = (SELECT get_current_user_company_id())
    AND (
      current_user_has_permission('view_audit_logs')
      OR
      ((SELECT get_current_user_role()) = 'dealer_admin' AND actor_dealer_id = (SELECT get_current_user_dealer_id()))
    )
  );

-- Update the create_order_from_quote_with_dealer_stock function to populate order origin fields
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
AS $function
DECLARE
  v_company_id uuid;
  v_user_id uuid;
  v_user_role text;
  v_user_org_type text;
  v_user_dealer_id uuid;
  v_quote record;
  v_order_id uuid;
  v_requested_weight numeric(14,3);
  v_profile_requested_weight numeric(14,3);
  v_available_dealer_weight numeric(14,3);
  v_dealer_weight numeric(14,3);
  v_manufacturing_weight numeric(14,3);
  v_stage text;
  v_fulfillment_notes text;
  v_remaining_dealer_weight numeric(14,3);
  v_profile record;
  v_profile_target numeric(14,3);
  v_profile_remaining numeric(14,3);
  v_allocated_profiles integer := 0;
  v_profile_count integer;
  v_batch record;
  v_reserved_weight numeric(14,3);
  v_available_weight numeric(14,3);
  v_consume_weight numeric(14,3);
  v_new_batch_weight numeric(14,3);
  v_new_piece_count integer;
  v_order_origin text;
BEGIN
  v_company_id := public.get_current_user_company_id();
  v_user_id := auth.uid();
  v_user_role := public.get_current_user_role();
  v_user_dealer_id := public.get_current_user_dealer_id();

  IF v_company_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT organization_type INTO v_user_org_type FROM app_users WHERE id = v_user_id;

  v_order_origin := CASE
    WHEN v_user_dealer_id IS NOT NULL AND v_user_role = 'dealer_admin' THEN 'DEALER_ADMIN_CREATED'
    WHEN v_user_dealer_id IS NOT NULL THEN 'DEALER_EMPLOYEE_CREATED'
    ELSE 'FACTORY_DIRECT'
  END;

  SELECT id, customer_id, grand_total, status INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id AND company_id = v_company_id
  FOR UPDATE;

  IF v_quote.id IS NULL THEN RAISE EXCEPTION 'Quote not found' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE company_id = v_company_id AND quote_id = p_quote_id) THEN RAISE EXCEPTION 'This quote is already linked to an order' USING ERRCODE = '23505'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE company_id = v_company_id AND order_number = p_order_number) THEN RAISE EXCEPTION 'Order number already exists' USING ERRCODE = '23505'; END IF;

  SELECT ROUND(COALESCE(SUM(COALESCE(billing_weight_kg, total_weight_kg, 0)), 0)::numeric, 3) INTO v_requested_weight FROM public.quote_items WHERE quote_id = p_quote_id AND company_id = v_company_id;
  SELECT ROUND(COALESCE(SUM(COALESCE(billing_weight_kg, total_weight_kg, 0)), 0)::numeric, 3) INTO v_profile_requested_weight FROM public.quote_items WHERE quote_id = p_quote_id AND company_id = v_company_id AND profile_id IS NOT NULL;

  IF v_requested_weight <= 0 THEN RAISE EXCEPTION 'Quote has no billable profile weight' USING ERRCODE = '23514'; END IF;

  SELECT ROUND(COALESCE(SUM(GREATEST(b.total_weight_kg - COALESCE(r.reserved_weight_kg, 0), 0)), 0)::numeric, 3)
  INTO v_available_dealer_weight
  FROM public.profile_stock_batches b
  JOIN (SELECT DISTINCT profile_id FROM public.quote_items WHERE quote_id = p_quote_id AND company_id = v_company_id AND profile_id IS NOT NULL) qi ON qi.profile_id = b.profile_id
  LEFT JOIN (
    SELECT profile_stock_batch_id, SUM(reserved_weight_kg) reserved_weight_kg
    FROM public.profile_stock_reservations
    WHERE company_id = v_company_id AND status = 'active'
    GROUP BY profile_stock_batch_id
  ) r ON r.profile_stock_batch_id = b.id
  WHERE b.company_id = v_company_id
    AND b.status = 'available'
    AND b.total_weight_kg > 0
    AND (v_user_dealer_id IS NULL OR b.dealer_id = v_user_dealer_id);

  v_dealer_weight := ROUND(GREATEST(COALESCE(p_dealer_fulfilled_weight_kg, 0), 0)::numeric, 3);
  IF v_user_dealer_id IS NOT NULL THEN
    v_dealer_weight := LEAST(v_requested_weight, v_profile_requested_weight, COALESCE(v_available_dealer_weight, 0));
  END IF;

  IF v_dealer_weight > v_requested_weight THEN RAISE EXCEPTION 'Dealer fulfilled weight cannot exceed quote weight' USING ERRCODE = '23514'; END IF;
  IF v_dealer_weight > 0 AND v_profile_requested_weight <= 0 THEN RAISE EXCEPTION 'Dealer fulfilled weight requires profile-backed quote items' USING ERRCODE = '23514'; END IF;
  IF v_dealer_weight > v_profile_requested_weight THEN RAISE EXCEPTION 'Dealer fulfilled weight cannot exceed profile-backed quote weight' USING ERRCODE = '23514'; END IF;

  v_manufacturing_weight := ROUND((v_requested_weight - v_dealer_weight)::numeric, 3);
  IF v_manufacturing_weight > 0 AND v_manufacturing_weight < 700 THEN
    RAISE EXCEPTION 'Urgent: factory balance % kg is below the 700 kg manufacturing minimum. Fulfill locally or arrange profile from another dealer/manufacturer.', v_manufacturing_weight USING ERRCODE = '23514';
  END IF;

  v_stage := CASE WHEN v_manufacturing_weight >= 700 THEN 'extrusion_planned' ELSE 'order_confirmed' END;
  v_fulfillment_notes := CASE WHEN v_dealer_weight > 0 THEN FORMAT('Dealer stock automatically fulfilled %s kg from unreserved profile stock batches. Factory balance %s kg.', v_dealer_weight, v_manufacturing_weight) ELSE FORMAT('Factory manufacturing weight %s kg.', v_manufacturing_weight) END;

  INSERT INTO public.orders (company_id, dealer_id, order_number, quote_id, customer_id, order_date, expected_dispatch_date, priority, current_stage, order_value, requested_weight_kg, dealer_fulfilled_weight_kg, manufacturing_weight_kg, fulfillment_notes, notes, created_by, created_by_user_id, created_by_role, created_by_organization_type, created_by_dealership_id, order_origin)
  VALUES (v_company_id, v_user_dealer_id, p_order_number, p_quote_id, v_quote.customer_id, p_order_date, p_expected_dispatch_date, p_priority, v_stage, COALESCE(v_quote.grand_total, 0), v_requested_weight, 0, v_requested_weight, v_fulfillment_notes, NULLIF(CONCAT_WS(E'\n', NULLIF(p_notes, ''), v_fulfillment_notes), ''), v_user_id, v_user_id, v_user_role, v_user_org_type, v_user_dealer_id, v_order_origin)
  RETURNING id INTO v_order_id;

  IF v_dealer_weight > 0 THEN
    SELECT COUNT(*) INTO v_profile_count FROM (SELECT profile_id FROM public.quote_items WHERE quote_id = p_quote_id AND company_id = v_company_id AND profile_id IS NOT NULL GROUP BY profile_id) profile_groups;
    v_remaining_dealer_weight := v_dealer_weight;

    FOR v_profile IN SELECT profile_id, ROUND(SUM(COALESCE(billing_weight_kg, total_weight_kg, 0))::numeric, 3) required_weight_kg FROM public.quote_items WHERE quote_id = p_quote_id AND company_id = v_company_id AND profile_id IS NOT NULL GROUP BY profile_id ORDER BY profile_id LOOP
      v_allocated_profiles := v_allocated_profiles + 1;
      IF v_allocated_profiles = v_profile_count THEN v_profile_target := v_remaining_dealer_weight; ELSE v_profile_target := ROUND((v_dealer_weight * v_profile.required_weight_kg / v_profile_requested_weight)::numeric, 3); END IF;
      v_profile_target := LEAST(v_profile_target, v_profile.required_weight_kg);
      v_profile_remaining := v_profile_target;

      FOR v_batch IN SELECT id, profile_id, total_weight_kg, length_m, quantity_pieces, created_at FROM public.profile_stock_batches WHERE company_id = v_company_id AND profile_id = v_profile.profile_id AND status = 'available' AND total_weight_kg > 0 AND (v_user_dealer_id IS NULL OR dealer_id = v_user_dealer_id) ORDER BY created_at ASC, id ASC FOR UPDATE LOOP
        EXIT WHEN v_profile_remaining <= 0;
        SELECT COALESCE(SUM(reserved_weight_kg), 0) INTO v_reserved_weight FROM public.profile_stock_reservations WHERE company_id = v_company_id AND profile_stock_batch_id = v_batch.id AND status = 'active';
        v_available_weight := ROUND(GREATEST(v_batch.total_weight_kg - v_reserved_weight, 0)::numeric, 3);
        IF v_available_weight <= 0 THEN CONTINUE; END IF;
        v_consume_weight := LEAST(v_profile_remaining, v_available_weight);
        v_new_batch_weight := ROUND((v_batch.total_weight_kg - v_consume_weight)::numeric, 3);
        v_new_piece_count := CASE WHEN v_batch.total_weight_kg > 0 THEN GREATEST(0, ROUND(v_batch.quantity_pieces * (v_new_batch_weight / v_batch.total_weight_kg))::integer) ELSE 0 END;

        INSERT INTO public.order_dealer_stock_fulfillments (company_id, order_id, quote_id, profile_id, profile_stock_batch_id, fulfilled_weight_kg, fulfilled_length_m, fulfilled_pieces, notes, created_by)
        VALUES (v_company_id, v_order_id, p_quote_id, v_profile.profile_id, v_batch.id, v_consume_weight, CASE WHEN v_batch.total_weight_kg > 0 THEN ROUND((COALESCE(v_batch.length_m, 0) * v_consume_weight / v_batch.total_weight_kg)::numeric, 3) ELSE 0 END, GREATEST(0, v_batch.quantity_pieces - v_new_piece_count), 'Automatic dealer stock debit on order confirmation', v_user_id);

        UPDATE public.profile_stock_batches SET total_weight_kg = v_new_batch_weight, quantity_pieces = v_new_piece_count, status = CASE WHEN v_new_batch_weight <= 0 THEN 'dispatched' ELSE status END, updated_at = NOW() WHERE id = v_batch.id AND company_id = v_company_id;

        INSERT INTO public.inventory_transactions (company_id, inventory_item_id, item_type, quantity, unit, inventory_state, from_owner_type, from_owner_id, to_owner_type, to_owner_id, order_id, created_by_user_id, created_by_role, reason, status)
        SELECT v_company_id, ii.id, 'profile', -v_consume_weight, 'kg', 'dealer_inventory_on_hand', 'dealer', v_user_dealer_id, 'customer', NULL, v_order_id, v_user_id, public.get_current_user_role(), 'Automatic dealer stock debit on order confirmation', 'posted'
        FROM public.inventory_items ii
        WHERE ii.company_id = v_company_id AND ii.item_code = (SELECT profile_code FROM public.aluminium_profiles WHERE id = v_profile.profile_id)
        LIMIT 1;

        v_profile_remaining := ROUND((v_profile_remaining - v_consume_weight)::numeric, 3);
        v_remaining_dealer_weight := ROUND((v_remaining_dealer_weight - v_consume_weight)::numeric, 3);
      END LOOP;

      IF v_profile_remaining > 0.001 THEN RAISE EXCEPTION 'Insufficient unreserved stock for one or more quoted profiles. Remaining profile shortfall: % kg', v_profile_remaining USING ERRCODE = '23514'; END IF;
    END LOOP;

    IF v_remaining_dealer_weight > 0.001 THEN RAISE EXCEPTION 'Could not allocate the full dealer fulfilled weight to quoted profile stock. Remaining dealer weight: % kg', v_remaining_dealer_weight USING ERRCODE = '23514'; END IF;
  END IF;

  UPDATE public.orders SET dealer_fulfilled_weight_kg = v_dealer_weight, manufacturing_weight_kg = v_manufacturing_weight, fulfillment_notes = v_fulfillment_notes WHERE id = v_order_id AND company_id = v_company_id;
  INSERT INTO public.order_stage_history (company_id, order_id, stage, changed_by, remarks) VALUES (v_company_id, v_order_id, v_stage, v_user_id, v_fulfillment_notes);
  UPDATE public.quotes SET status = 'converted_to_order' WHERE id = p_quote_id AND company_id = v_company_id;
  RETURN v_order_id;
END;
$function;
