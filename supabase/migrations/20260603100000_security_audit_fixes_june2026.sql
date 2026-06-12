-- Security audit fixes — June 2026
-- Addresses: self-update RLS, dealer order number uniqueness

-- Fix #3: Allow users to update their own app_users record (name, phone, etc.)
-- but NOT escalate their own role or change company_id.
DROP POLICY IF EXISTS "app_users_update_self" ON public.app_users;
CREATE POLICY "app_users_update_self" ON public.app_users
  FOR UPDATE
  USING (
    id = auth.uid()
    AND company_id = public.get_current_user_company_id()
  )
  WITH CHECK (
    id = auth.uid()
    AND company_id = public.get_current_user_company_id()
    -- Prevent self-role escalation: role must remain unchanged
    AND role = (SELECT role FROM public.app_users WHERE id = auth.uid())
    -- Prevent moving to another company
    AND company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid())
  );

-- Fix #4: Ensure dealer_orders.order_number is unique per company
-- (prevents collisions from Date.now()-based generation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'dealer_orders'
      AND indexname = 'dealer_orders_company_order_number_unique'
  ) THEN
    CREATE UNIQUE INDEX dealer_orders_company_order_number_unique
      ON public.dealer_orders(company_id, order_number);
  END IF;
END $$;
