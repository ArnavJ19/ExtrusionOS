-- ============================================================
-- PHASE 12: EXPORT DOCUMENTATION MODULE
-- ============================================================

-- 1. Export Orders
CREATE TABLE IF NOT EXISTS public.export_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  order_id UUID,
  export_customer_name TEXT NOT NULL,
  destination_country TEXT NOT NULL,
  incoterm TEXT NOT NULL DEFAULT 'FOB' CHECK (incoterm IN ('EXW', 'FOB', 'CIF', 'CFR', 'DAP', 'DDP')),
  port_of_loading TEXT,
  port_of_discharge TEXT,
  shipment_mode TEXT NOT NULL DEFAULT 'sea' CHECK (shipment_mode IN ('sea', 'air', 'road', 'courier')),
  container_number TEXT,
  seal_number TEXT,
  shipping_bill_number TEXT,
  commercial_invoice_number TEXT,
  total_value NUMERIC(14,2) DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'EUR', 'GBP', 'AED', 'SAR', 'AUD', 'INR')),
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'lc_received', 'advance_received', 'partial', 'full', 'overdue')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'production', 'packing', 'shipped', 'in_transit', 'delivered', 'completed', 'cancelled')),
  estimated_ship_date DATE,
  actual_ship_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.export_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "export_orders_tenant_isolation" ON public.export_orders
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_export_orders_company ON public.export_orders(company_id);
CREATE INDEX idx_export_orders_status ON public.export_orders(status);
CREATE INDEX idx_export_orders_country ON public.export_orders(destination_country);

-- 2. Export Documents
CREATE TABLE IF NOT EXISTS public.export_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  export_order_id UUID NOT NULL REFERENCES public.export_orders(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('proforma_invoice', 'commercial_invoice', 'packing_list', 'certificate_of_origin', 'test_certificate', 'bill_of_lading', 'shipping_bill', 'insurance', 'fumigation_certificate', 'other')),
  file_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'verified', 'sent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.export_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "export_documents_tenant_isolation" ON public.export_documents
  FOR ALL USING (company_id = public.get_current_user_company_id());
CREATE INDEX idx_export_documents_order ON public.export_documents(export_order_id);
