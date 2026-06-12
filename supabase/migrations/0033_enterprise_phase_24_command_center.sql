-- ============================================================
-- PHASE 24: OWNER COMMAND CENTER
-- No new tables required. The command center aggregates existing 
-- data from quotes, orders, dispatches, invoices, payments,
-- inventory_items, production_jobs, quality_inspections, dies,
-- customers, scrap records, tasks, and notifications.
--
-- This phase creates optimized indexes to support dashboard queries.
-- ============================================================

-- Optimized indexes for command center aggregation queries
CREATE INDEX IF NOT EXISTS idx_quotes_company_status_date ON public.quotes(company_id, status, quote_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_company_stage_date ON public.orders(company_id, current_stage, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_dispatches_company_status_date ON public.dispatches(company_id, delivery_status, dispatch_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_company_status_date ON public.invoices(company_id, status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_company_date ON public.payments(company_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_production_jobs_company_status ON public.production_jobs(company_id, status);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_company_status ON public.quality_inspections(company_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_company_status_due ON public.tasks(company_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_notifications_company_unread ON public.notifications(company_id, is_read);
