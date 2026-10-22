-- ============================================================
-- PHASE 8: DIE INTELLIGENCE AND LIFECYCLE OPTIMIZATION
-- ============================================================

-- 1. Die Trials
CREATE TABLE IF NOT EXISTS public.die_trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  die_id UUID NOT NULL,
  trial_date DATE NOT NULL DEFAULT CURRENT_DATE,
  trial_result TEXT NOT NULL DEFAULT 'pending' CHECK (trial_result IN ('pass', 'fail', 'conditional', 'pending')),
  output_quality TEXT CHECK (output_quality IN ('excellent', 'good', 'acceptable', 'poor', 'rejected')),
  dimensional_status TEXT CHECK (dimensional_status IN ('within_tolerance', 'marginal', 'out_of_spec')),
  surface_status TEXT CHECK (surface_status IN ('smooth', 'minor_lines', 'rough', 'die_lines', 'pickup')),
  correction_required BOOLEAN DEFAULT false,
  remarks TEXT,
  trial_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.die_trials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "die_trials_tenant_isolation" ON public.die_trials
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_die_trials_company ON public.die_trials(company_id);
CREATE INDEX idx_die_trials_die ON public.die_trials(die_id);

-- 2. Die Corrections
CREATE TABLE IF NOT EXISTS public.die_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  die_id UUID NOT NULL,
  correction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  correction_reason TEXT NOT NULL CHECK (correction_reason IN ('die_lines', 'dimensional', 'surface_pickup', 'slow_speed', 'bearing_issue', 'tongue_ratio', 'other')),
  correction_vendor TEXT,
  cost NUMERIC(12,2) DEFAULT 0,
  result_status TEXT DEFAULT 'pending' CHECK (result_status IN ('pending', 'success', 'partial', 'failed')),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.die_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "die_corrections_tenant_isolation" ON public.die_corrections
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_die_corrections_company ON public.die_corrections(company_id);
CREATE INDEX idx_die_corrections_die ON public.die_corrections(die_id);

-- 3. Die Health Metrics (Computed / Materialized View)
CREATE TABLE IF NOT EXISTS public.die_health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  die_id UUID NOT NULL UNIQUE,
  total_output_kg NUMERIC(12,2) DEFAULT 0,
  total_rejection_kg NUMERIC(12,2) DEFAULT 0,
  rejection_rate NUMERIC(5,2) DEFAULT 0,
  correction_count INTEGER DEFAULT 0,
  trial_count INTEGER DEFAULT 0,
  last_correction_date DATE,
  last_trial_date DATE,
  average_recovery_percent NUMERIC(5,2) DEFAULT 0,
  health_score INTEGER DEFAULT 100 CHECK (health_score >= 0 AND health_score <= 100),
  recommendation TEXT DEFAULT 'healthy' CHECK (recommendation IN ('healthy', 'monitor', 'correction_needed', 'replace_soon', 'dead')),
  total_die_cost NUMERIC(12,2) DEFAULT 0,
  cost_per_kg NUMERIC(8,4) DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.die_health_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "die_health_metrics_tenant_isolation" ON public.die_health_metrics
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_die_health_company ON public.die_health_metrics(company_id);
CREATE INDEX idx_die_health_score ON public.die_health_metrics(health_score);
CREATE INDEX idx_die_health_recommendation ON public.die_health_metrics(recommendation);
