import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260718010000_financial_closure.sql");
const analyticsMigration = read("supabase/migrations/20260718010100_financial_collection_analytics.sql");
const aggregateAnalyticsMigration = read("supabase/migrations/20260721091327_advanced_analytics_aggregates.sql");
const invoiceActions = read("lib/actions/invoices.ts");
const paymentActions = read("lib/actions/payments.ts");
const paymentApi = read("app/api/payments/route.ts");
const invoiceForm = read("components/modules/financials/invoice-form-client.tsx");
const paymentForm = read("components/modules/financials/payment-form-client.tsx");
const paymentDetail = read("components/modules/financials/payment-detail-client.tsx");
const analyticsPage = read("app/(dashboard)/analytics/page.tsx");
const analyticsLibrary = read("lib/analytics/advanced-dashboard.ts");

test("invoice totals are derived from the selected dispatch lines inside one atomic save", () => {
  assert.match(migration, /from public\.invoice_items\s+where invoice_id = p_invoice_id\s+and company_id = p_company_id/);
  assert.match(migration, /perform private\.recalculate_invoice_totals\(v_invoice_id, v_company_id\)/);
  assert.match(migration, /perform private\.recalculate_invoice_totals\(p_invoice_id, v_company_id\)/);
  assert.match(migration, /if v_dispatch_id is null then\s+raise exception 'Select a packed dispatch/);
  assert.match(migration, /invoices_company_dispatch_active_unique/);
  assert.match(invoiceActions, /dispatch_id: z\.string\(\)\.uuid\("Select the packed dispatch to invoice"\)/);
  assert.match(invoiceActions, /rpc\("save_invoice_atomic"/);
  assert.match(invoiceActions, /from\("packing_list_items"\)/);
  assert.doesNotMatch(invoiceActions, /subtotal\s*:/);
  assert.doesNotMatch(invoiceActions, /grand_total\s*:/);
  assert.match(invoiceForm, /Full-order proformas are intentionally kept out of receivables/);
});

test("receipt posting is idempotent, locked, lineage checked, and prevents overpayment", () => {
  assert.match(migration, /create or replace function private\.record_payment_atomic/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /v_existing_invoice_id <> p_invoice_id/);
  assert.match(migration, /from public\.invoices[\s\S]*where id = p_invoice_id[\s\S]*for update/);
  assert.match(migration, /Invoice customer must match the source order customer/);
  assert.match(migration, /v_amount > v_invoice\.balance_due/);
  assert.match(migration, /perform private\.recalculate_invoice_collection_state\(p_invoice_id, v_company_id\)/);
  assert.match(migration, /'payment_recorded'/);
  assert.match(paymentActions, /rpc\("record_payment_atomic"/);
  assert.doesNotMatch(paymentActions, /from\("payments"\)\s*\.insert/);
  assert.match(paymentApi, /recordPaymentAction/);
  assert.doesNotMatch(paymentApi, /from\("payments"\)\s*\.insert/);
});

test("posted receipts are immutable and corrected by an audited reversal", () => {
  assert.match(migration, /create or replace function private\.reverse_payment_atomic/);
  assert.match(migration, /v_payment\.reversal_idempotency_key = p_idempotency_key/);
  assert.match(migration, /'payment_reversed'/);
  assert.match(paymentActions, /rpc\("reverse_payment_atomic"/);
  assert.match(paymentDetail, /A posted receipt is immutable/);
  assert.match(paymentDetail, /reversePaymentAction/);
  assert.doesNotMatch(paymentDetail, /\.from\("payments"\)\s*\.update/);
});

test("purpose-built financial screens replace generic no-op payment forms", () => {
  assert.match(paymentForm, /recordPaymentAction/);
  assert.match(paymentForm, /open balance/i);
  assert.match(paymentForm, /idempotency_key/);
  assert.match(read("app/(dashboard)/payments/new/page.tsx"), /PaymentFormClient/);
  assert.match(read("app/(dashboard)/payments/[id]/page.tsx"), /PaymentDetailClient/);
  assert.match(read("app/(dashboard)/payments/[id]/edit/page.tsx"), /reversalMode/);
  assert.match(read("app/(dashboard)/invoices/new/page.tsx"), /InvoiceFormClient/);
  assert.match(read("app/(dashboard)/invoices/[id]/edit/page.tsx"), /InvoiceFormClient/);
});

test("collection analytics use dated receipt events rather than cumulative invoice state", () => {
  assert.match(analyticsMigration, /create or replace function public\.get_financial_collection_events/);
  assert.match(analyticsMigration, /p\.payment_date >= p_start_date/);
  assert.match(analyticsMigration, /p\.payment_method <> 'credit_note'/);
  assert.match(aggregateAnalyticsMigration, /from public\.get_financial_collection_events\(v_trend_start\)/);
  assert.match(analyticsPage, /rpc\("get_advanced_analytics_snapshot"/);
  assert.match(analyticsLibrary, /const collectionsMtd = input\.payments/);
  assert.match(analyticsLibrary, /groupByMonth\(input\.payments/);
});
