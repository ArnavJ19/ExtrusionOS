-- ============================================================
-- PHASE 10: MACHINE MAINTENANCE AND BREAKDOWN TRACKING
-- ============================================================

-- 1. Maintenance Schedules
CREATE TABLE IF NOT EXISTS public.maintenance_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL,
  machine_type TEXT NOT NULL CHECK (machine_type IN ('extrusion_press', 'billet_heater', 'aging_oven', 'puller', 'stretcher', 'cutting_machine', 'powder_coating_line', 'anodizing_line', 'compressor', 'packing_equipment', 'other')),
  maintenance_type TEXT NOT NULL DEFAULT 'preventive' CHECK (maintenance_type IN ('preventive', 'corrective', 'inspection', 'calibration', 'breakdown')),
  description TEXT,
  frequency_type TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency_type IN ('daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'run_hours')),
  frequency_value INTEGER NOT NULL DEFAULT 1,
  last_done_date DATE,
  next_due_date DATE NOT NULL DEFAULT CURRENT_DATE,
  assigned_to TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'overdue', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "maintenance_schedules_tenant_isolation" ON public.maintenance_schedules
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_maintenance_schedules_company ON public.maintenance_schedules(company_id);
CREATE INDEX idx_maintenance_schedules_due ON public.maintenance_schedules(next_due_date);
CREATE INDEX idx_maintenance_schedules_status ON public.maintenance_schedules(status);
CREATE INDEX idx_maintenance_schedules_machine ON public.maintenance_schedules(machine_id);

-- 2. Breakdown Logs
CREATE TABLE IF NOT EXISTS public.breakdown_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL,
  machine_type TEXT NOT NULL CHECK (machine_type IN ('extrusion_press', 'billet_heater', 'aging_oven', 'puller', 'stretcher', 'cutting_machine', 'powder_coating_line', 'anodizing_line', 'compressor', 'packing_equipment', 'other')),
  breakdown_date DATE NOT NULL DEFAULT CURRENT_DATE,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  downtime_minutes INTEGER DEFAULT 0,
  issue_description TEXT NOT NULL,
  root_cause TEXT,
  action_taken TEXT,
  spare_parts_used TEXT,
  cost NUMERIC(12,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'recurring')),
  reported_by TEXT,
  resolved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.breakdown_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "breakdown_logs_tenant_isolation" ON public.breakdown_logs
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_breakdown_logs_company ON public.breakdown_logs(company_id);
CREATE INDEX idx_breakdown_logs_date ON public.breakdown_logs(breakdown_date);
CREATE INDEX idx_breakdown_logs_status ON public.breakdown_logs(status);
CREATE INDEX idx_breakdown_logs_machine ON public.breakdown_logs(machine_id);
