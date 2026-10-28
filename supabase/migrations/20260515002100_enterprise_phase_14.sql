-- ============================================================
-- PHASE 14: ADVANCED PROFITABILITY AND COST INTELLIGENCE
-- ============================================================
-- This is the core analytics engine for margin analysis.
-- It stores cost-line-item breakdowns per order and computes
-- profitability at every dimension the business cares about.

-- 1. Order Cost Breakdown (line-item cost capture per order)
CREATE TABLE IF NOT EXISTS public.order_cost_breakdown (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  order_id UUID,
  customer_name TEXT NOT NULL,
  profile_name TEXT,
  die_code TEXT,
  salesperson TEXT,
  product_category TEXT DEFAULT 'section',
  finishing_type TEXT DEFAULT 'mill_finish',
  branch TEXT DEFAULT 'main',
  month_key TEXT NOT NULL, -- e.g. '2026-05'

  -- Revenue
  revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_weight_kg NUMERIC(10,2) DEFAULT 0,
  rate_per_kg NUMERIC(8,2) DEFAULT 0,

  -- Cost components
  material_cost NUMERIC(14,2) DEFAULT 0,
  conversion_cost NUMERIC(14,2) DEFAULT 0,
  finishing_cost NUMERIC(14,2) DEFAULT 0,
  packing_cost NUMERIC(12,2) DEFAULT 0,
  transport_cost NUMERIC(12,2) DEFAULT 0,
  scrap_cost NUMERIC(12,2) DEFAULT 0,
  energy_cost NUMERIC(12,2) DEFAULT 0,
  die_cost_allocated NUMERIC(12,2) DEFAULT 0,
  overhead_cost NUMERIC(12,2) DEFAULT 0,
  other_cost NUMERIC(12,2) DEFAULT 0,

  -- Derived
  total_cost NUMERIC(14,2) GENERATED ALWAYS AS (
    material_cost + conversion_cost + finishing_cost + packing_cost +
    transport_cost + scrap_cost + energy_cost + die_cost_allocated +
    overhead_cost + other_cost
  ) STORED,
  gross_margin NUMERIC(14,2) GENERATED ALWAYS AS (
    revenue - (material_cost + conversion_cost + finishing_cost + packing_cost +
    transport_cost + scrap_cost + energy_cost + die_cost_allocated +
    overhead_cost + other_cost)
  ) STORED,

  -- Payment tracking
  payment_days INTEGER DEFAULT 0,
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid', 'overdue', 'written_off')),

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.order_cost_breakdown ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_cost_breakdown_tenant_isolation" ON public.order_cost_breakdown
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_ocb_company ON public.order_cost_breakdown(company_id);
CREATE INDEX idx_ocb_customer ON public.order_cost_breakdown(customer_name);
CREATE INDEX idx_ocb_month ON public.order_cost_breakdown(month_key);
CREATE INDEX idx_ocb_profile ON public.order_cost_breakdown(profile_name);
CREATE INDEX idx_ocb_die ON public.order_cost_breakdown(die_code);
CREATE INDEX idx_ocb_salesperson ON public.order_cost_breakdown(salesperson);
CREATE INDEX idx_ocb_category ON public.order_cost_breakdown(product_category);

-- 2. Profitability Alerts / Warnings
CREATE TABLE IF NOT EXISTS public.profitability_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'high_revenue_low_margin', 'negative_margin', 'high_scrap', 'underpriced_quote',
    'transport_too_high', 'payment_delay', 'finishing_cost_spike', 'energy_cost_spike',
    'die_cost_overrun', 'customer_declining_margin'
  )),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  entity_type TEXT NOT NULL, -- 'customer', 'order', 'profile', 'die'
  entity_name TEXT NOT NULL,
  description TEXT NOT NULL,
  metric_value NUMERIC(14,2),
  threshold_value NUMERIC(14,2),
  is_acknowledged BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profitability_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profitability_alerts_tenant_isolation" ON public.profitability_alerts
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_prof_alerts_company ON public.profitability_alerts(company_id);
CREATE INDEX idx_prof_alerts_type ON public.profitability_alerts(alert_type);
CREATE INDEX idx_prof_alerts_severity ON public.profitability_alerts(severity);
