-- ============================================================
-- PHASE 6 SCHEMA UPGRADE: Align system_configurations with
-- the hyper-precision configurator engine
-- Non-destructive: all new columns are nullable or have defaults
-- ============================================================

-- 1. Add missing configurator input fields
ALTER TABLE public.system_configurations
  ADD COLUMN IF NOT EXISTS configuration_number TEXT,
  ADD COLUMN IF NOT EXISTS system_type TEXT,
  ADD COLUMN IF NOT EXISTS lock_type TEXT,
  ADD COLUMN IF NOT EXISTS handle_type TEXT,
  ADD COLUMN IF NOT EXISTS screen_type TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS mullion_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_thermal_break BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS include_installation BOOLEAN DEFAULT true;

-- 2. Add pricing and status tracking
ALTER TABLE public.system_configurations
  ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'approved', 'ordered', 'archived')),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3. Add structured output fields for PDF/export
ALTER TABLE public.system_configurations
  ADD COLUMN IF NOT EXISTS hardware_bom_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS labour_cost NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wastage_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 4. Indexes for new query patterns
CREATE INDEX IF NOT EXISTS idx_system_configurations_status ON public.system_configurations(status);
CREATE INDEX IF NOT EXISTS idx_system_configurations_system_type ON public.system_configurations(system_type);
