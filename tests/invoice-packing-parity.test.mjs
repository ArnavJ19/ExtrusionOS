import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const invoiceBuilder = readFileSync(new URL("../lib/pcda/invoice.ts", import.meta.url), "utf8");
const invoiceActions = readFileSync(new URL("../lib/actions/invoices.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260718052000_invoice_packing_line_parity.sql", import.meta.url), "utf8");

test("dispatch invoice calculation prefers packed net weight over inherited production weight", () => {
  assert.match(invoiceBuilder, /line\.net_weight_kg \?\? line\.gross_weight_kg \?\? line\.actual_weight/);
  assert.match(invoiceBuilder, /isDispatchLine && weightRateTotal > 0/);
});

test("invoice action fails closed when any packed line is unpriced", () => {
  assert.match(invoiceActions, /function invoiceItemsAreBillable/);
  assert.match(invoiceActions, /Number\.isFinite\(amount\) && amount > 0/);
  assert.match(invoiceActions, /Every packed line needs a positive shipped weight and commercial rate before invoicing/);
});

test("database canonicalizes amount fields and requires full packing coverage", () => {
  assert.match(migration, /create or replace function private\.canonicalize_invoice_packing_line/);
  assert.match(migration, /v_expected_quantity := round\(coalesce/);
  assert.match(migration, /v_expected_total := round\(v_expected_quantity \* v_expected_rate, 2\)/);
  assert.match(migration, /Invoice quantity, rate, and total must match the immutable packing row/);
  assert.match(migration, /count\(distinct source_line_id\)/);
  assert.match(migration, /Invoice must include every packing row from its dispatch exactly once/);
  assert.match(migration, /deferrable initially deferred/);
});

test("packing rows become read-only and immutable once invoiced", () => {
  assert.match(migration, /create or replace function private\.lock_invoiced_packing_list/);
  assert.match(migration, /Packing rows are locked after an active invoice is created/);
  assert.match(migration, /tablename = 'packing_list_items'/);
  assert.match(migration, /create policy packing_list_items_tenant_read/);
  assert.doesNotMatch(migration, /create policy [^\n]+ on public\.packing_list_items\s+for (insert|update|delete)/);
  assert.match(migration, /create or replace function private\.enforce_one_active_dispatch_invoice/);
});
