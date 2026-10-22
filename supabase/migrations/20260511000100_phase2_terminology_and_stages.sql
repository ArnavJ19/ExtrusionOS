-- Phase 2: Terminology and Production Stage Expansion
-- Fixed: Removed broken quotes.finishing_type constraint (column doesn't exist on quotes table)
-- The finishing_type constraint belongs on quote_items, which is already defined elsewhere.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_current_stage_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_current_stage_check 
  CHECK (current_stage IN (
    'order_confirmed',
    'die_ready',
    'billet_ready',
    'billet_heating',
    'extrusion_planned',
    'extruded',
    'stretching',
    'cutting',
    'aging',
    'surface_treatment',
    'finishing',
    'packing',
    'dispatched',
    'delivered',
    'payment_pending',
    'closed',
    'cancelled'
  ));
