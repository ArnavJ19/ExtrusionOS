-- Fix system_configurations status check constraint to include all operational statuses
ALTER TABLE public.system_configurations DROP CONSTRAINT IF EXISTS system_configurations_status_check;

ALTER TABLE public.system_configurations ADD CONSTRAINT system_configurations_status_check CHECK (
  status = ANY (ARRAY[
    'draft'::text,
    'calculated'::text,
    'quoted'::text,
    'approved'::text,
    'converted_to_order'::text,
    'in_production'::text,
    'completed'::text,
    'cancelled'::text,
    'sent'::text,
    'ordered'::text,
    'archived'::text
  ])
);
