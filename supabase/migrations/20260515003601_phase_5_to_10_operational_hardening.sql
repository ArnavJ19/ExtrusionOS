-- ============================================================
-- PHASE 5-10 OPERATIONAL HARDENING
-- Documents, QR, die intelligence, energy rates, maintenance bills,
-- and maintenance spare-part stock usage.
-- ============================================================

-- Phase 7: file metadata for technical drawings.
ALTER TABLE public.technical_drawings
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS file_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT DEFAULT 'technical-drawings',
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

CREATE INDEX IF NOT EXISTS idx_technical_drawings_company_created
  ON public.technical_drawings(company_id, created_at DESC);

INSERT INTO storage.buckets (id, name, public)
VALUES ('technical-drawings', 'technical-drawings', false),
       ('maintenance-bills', 'maintenance-bills', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "technical drawings storage read" ON storage.objects;
CREATE POLICY "technical drawings storage read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'technical-drawings'
    AND (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  );

DROP POLICY IF EXISTS "technical drawings storage insert" ON storage.objects;
CREATE POLICY "technical drawings storage insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'technical-drawings'
    AND (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  );

DROP POLICY IF EXISTS "maintenance bills storage read" ON storage.objects;
CREATE POLICY "maintenance bills storage read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'maintenance-bills'
    AND (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  );

DROP POLICY IF EXISTS "maintenance bills storage insert" ON storage.objects;
CREATE POLICY "maintenance bills storage insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'maintenance-bills'
    AND (storage.foldername(name))[1] = public.get_current_user_company_id()::text
  );

-- Phase 5: QR hardening.
ALTER TABLE public.qr_codes
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'qr_codes_status_check'
  ) THEN
    ALTER TABLE public.qr_codes
      ADD CONSTRAINT qr_codes_status_check CHECK (status IN ('active', 'expired', 'inactive', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_qr_codes_company_created
  ON public.qr_codes(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_company_created
  ON public.scan_events(company_id, created_at DESC);

-- Phase 9: editable rates and extra energy/electricity sources.
ALTER TABLE public.energy_readings
  DROP CONSTRAINT IF EXISTS energy_readings_energy_type_check;

ALTER TABLE public.energy_readings
  ADD CONSTRAINT energy_readings_energy_type_check
  CHECK (energy_type IN ('electricity', 'solar', 'grid_electricity', 'dg_electricity', 'natural_gas', 'diesel', 'furnace_oil', 'lpg', 'compressed_air', 'other'));

CREATE TABLE IF NOT EXISTS public.energy_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  energy_type TEXT NOT NULL CHECK (energy_type IN ('electricity', 'solar', 'grid_electricity', 'dg_electricity', 'natural_gas', 'diesel', 'furnace_oil', 'lpg', 'compressed_air', 'other')),
  unit TEXT NOT NULL DEFAULT 'kWh' CHECK (unit IN ('kWh', 'litres', 'kg', 'cubic_m', 'units')),
  default_rate_per_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT energy_sources_company_name_unique UNIQUE (company_id, source_name)
);

ALTER TABLE public.energy_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "energy_sources_tenant_isolation" ON public.energy_sources;
CREATE POLICY "energy_sources_tenant_isolation" ON public.energy_sources
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_energy_sources_company_active
  ON public.energy_sources(company_id, is_active, energy_type);

ALTER TABLE public.energy_readings
  ADD COLUMN IF NOT EXISTS energy_source_id UUID REFERENCES public.energy_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_name TEXT,
  ADD COLUMN IF NOT EXISTS rate_locked_at TIMESTAMPTZ;

-- Phase 10: bill/document proof for chargeable maintenance/breakdown work.
ALTER TABLE public.breakdown_logs
  ADD COLUMN IF NOT EXISTS vendor_name TEXT,
  ADD COLUMN IF NOT EXISTS bill_number TEXT,
  ADD COLUMN IF NOT EXISTS bill_date DATE,
  ADD COLUMN IF NOT EXISTS bill_file_url TEXT,
  ADD COLUMN IF NOT EXISTS bill_storage_bucket TEXT DEFAULT 'maintenance-bills',
  ADD COLUMN IF NOT EXISTS bill_storage_path TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'breakdown_logs_cost_bill_documentation_check'
  ) THEN
    ALTER TABLE public.breakdown_logs
      ADD CONSTRAINT breakdown_logs_cost_bill_documentation_check
      CHECK (cost <= 0 OR bill_number IS NOT NULL OR bill_file_url IS NOT NULL OR bill_storage_path IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.maintenance_spare_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  part_code TEXT NOT NULL,
  part_name TEXT NOT NULL,
  machine_type TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  current_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0,
  average_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  vendor_name TEXT,
  location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_spare_parts_company_code_unique UNIQUE (company_id, part_code),
  CONSTRAINT maintenance_spare_parts_stock_nonnegative CHECK (current_stock >= 0)
);

ALTER TABLE public.maintenance_spare_parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "maintenance_spare_parts_tenant_isolation" ON public.maintenance_spare_parts;
CREATE POLICY "maintenance_spare_parts_tenant_isolation" ON public.maintenance_spare_parts
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE TABLE IF NOT EXISTS public.breakdown_spare_part_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  breakdown_id UUID NOT NULL REFERENCES public.breakdown_logs(id) ON DELETE CASCADE,
  spare_part_id UUID NOT NULL REFERENCES public.maintenance_spare_parts(id) ON DELETE RESTRICT,
  quantity_used NUMERIC(12,3) NOT NULL CHECK (quantity_used > 0),
  rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.breakdown_spare_part_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "breakdown_spare_part_usage_tenant_isolation" ON public.breakdown_spare_part_usage;
CREATE POLICY "breakdown_spare_part_usage_tenant_isolation" ON public.breakdown_spare_part_usage
  FOR ALL USING (company_id = public.get_current_user_company_id())
  WITH CHECK (company_id = public.get_current_user_company_id());

CREATE INDEX IF NOT EXISTS idx_maintenance_spare_parts_company_active
  ON public.maintenance_spare_parts(company_id, is_active, part_name);
CREATE INDEX IF NOT EXISTS idx_breakdown_spare_usage_breakdown
  ON public.breakdown_spare_part_usage(company_id, breakdown_id);

CREATE OR REPLACE FUNCTION public.apply_breakdown_spare_part_usage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  available_stock NUMERIC(12,3);
  part_rate NUMERIC(12,2);
BEGIN
  SELECT current_stock, average_rate
    INTO available_stock, part_rate
  FROM public.maintenance_spare_parts
  WHERE id = NEW.spare_part_id
    AND company_id = NEW.company_id
  FOR UPDATE;

  IF available_stock IS NULL THEN
    RAISE EXCEPTION 'Spare part not found for this company' USING ERRCODE = '23514';
  END IF;

  IF available_stock < NEW.quantity_used THEN
    RAISE EXCEPTION 'Insufficient spare part stock. Available %, requested %', available_stock, NEW.quantity_used USING ERRCODE = '23514';
  END IF;

  IF NEW.rate <= 0 THEN
    NEW.rate := part_rate;
  END IF;

  NEW.amount := ROUND((NEW.quantity_used * NEW.rate)::numeric, 2);

  UPDATE public.maintenance_spare_parts
  SET current_stock = current_stock - NEW.quantity_used,
      updated_at = now()
  WHERE id = NEW.spare_part_id
    AND company_id = NEW.company_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_breakdown_spare_part_usage ON public.breakdown_spare_part_usage;
CREATE TRIGGER apply_breakdown_spare_part_usage
  BEFORE INSERT ON public.breakdown_spare_part_usage
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_breakdown_spare_part_usage();
