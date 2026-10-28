-- ============================================================
-- PHASE 9: ENERGY AND FURNACE COST MONITORING
-- ============================================================

CREATE TABLE IF NOT EXISTS public.energy_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id UUID,
  machine_id TEXT,
  reading_date DATE NOT NULL DEFAULT CURRENT_DATE,
  energy_type TEXT NOT NULL CHECK (energy_type IN ('electricity', 'natural_gas', 'diesel', 'furnace_oil', 'lpg', 'compressed_air', 'other')),
  opening_reading NUMERIC(12,2) DEFAULT 0,
  closing_reading NUMERIC(12,2) DEFAULT 0,
  consumption NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kWh' CHECK (unit IN ('kWh', 'litres', 'kg', 'cubic_m', 'units')),
  rate_per_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  production_kg NUMERIC(12,2) DEFAULT 0,
  cost_per_kg NUMERIC(8,4) DEFAULT 0,
  recorded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.energy_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "energy_readings_tenant_isolation" ON public.energy_readings
  FOR ALL USING (company_id = public.get_current_user_company_id());

CREATE INDEX idx_energy_readings_company ON public.energy_readings(company_id);
CREATE INDEX idx_energy_readings_date ON public.energy_readings(reading_date);
CREATE INDEX idx_energy_readings_type ON public.energy_readings(energy_type);
CREATE INDEX idx_energy_readings_machine ON public.energy_readings(machine_id);
