-- Migration: Phase 5 Barcode and QR Shop Floor Tracking
-- Adds: qr_codes, scan_events

-- 1. QR Codes Table
CREATE TABLE IF NOT EXISTS public.qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- die, profile, order, production_job, dispatch, inventory_item, billet_batch, profile_stock_batch, bundle
  entity_id UUID NOT NULL,
  qr_value TEXT NOT NULL UNIQUE,
  qr_url TEXT,
  status TEXT DEFAULT 'active', -- active, inactive, archived
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_qr_codes_company ON public.qr_codes(company_id);
CREATE INDEX idx_qr_codes_entity ON public.qr_codes(entity_type, entity_id);

ALTER TABLE public.qr_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view qr_codes for their company" ON public.qr_codes FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Users can manage qr_codes for their company" ON public.qr_codes FOR ALL USING (company_id = public.get_current_user_company_id());

-- 2. Scan Events Table
CREATE TABLE IF NOT EXISTS public.scan_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  qr_code_id UUID REFERENCES public.qr_codes(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  scanned_by UUID REFERENCES auth.users(id),
  scan_location TEXT, -- warehouse_a, packing_station, dispatch_bay
  action_type TEXT NOT NULL, -- viewed, status_updated, issued_to_production, moved_to_packing, loaded_for_dispatch, delivered, stock_checked, die_checked
  metadata_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_scan_events_company ON public.scan_events(company_id);
CREATE INDEX idx_scan_events_qr ON public.scan_events(qr_code_id);
CREATE INDEX idx_scan_events_entity ON public.scan_events(entity_type, entity_id);

ALTER TABLE public.scan_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view scan_events for their company" ON public.scan_events FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "Users can insert scan_events for their company" ON public.scan_events FOR INSERT WITH CHECK (company_id = public.get_current_user_company_id());
