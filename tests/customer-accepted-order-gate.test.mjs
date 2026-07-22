import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actions = readFileSync(new URL("../lib/actions/quotes-orders.ts", import.meta.url), "utf8");
const quoteClient = readFileSync(new URL("../components/modules/quotes-client.tsx", import.meta.url), "utf8");
const ordersClient = readFileSync(new URL("../components/modules/orders-client.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260718050000_customer_accepted_quote_orders.sql", import.meta.url), "utf8");
const atomicQuoteMigration = readFileSync(new URL("../supabase/migrations/20260721091620_quote_atomic_dealer_lineage.sql", import.meta.url), "utf8");

test("quote commercial edits cannot directly fabricate workflow acceptance", () => {
  assert.match(actions, /rpc\("save_quote_atomic"/);
  assert.match(atomicQuoteMigration, /'status', case when v_needs_revision then 'draft' else coalesce\(v_current\.status, 'draft'\) end/);
  assert.match(atomicQuoteMigration, /if v_current\.status = 'converted_to_order'/);
  assert.doesNotMatch(actions, /status: parsed\.data\.status/);
  assert.doesNotMatch(quoteClient, /quoteStatuses\.filter/);
  assert.match(quoteClient, /Use the workflow actions after saving/);
});

test("only a customer-approved quote can create a linked order", () => {
  assert.match(actions, /quote\.status !== "customer_approved"/);
  assert.match(actions, /Only customer-approved quotes can be converted to orders/);
  assert.match(actions, /allowedLinkedQuoteStatuses = editingId \? \["customer_approved", "converted_to_order"\] : \["customer_approved"\]/);
  assert.match(ordersClient, /\.eq\("status", "customer_approved"\)/);
  assert.doesNotMatch(ordersClient, /"approved_for_sending", "customer_approved"/);
});

test("order form saves preserve server-owned stage", () => {
  assert.match(actions, /current_stage: editingId \? currentOrder\?\.current_stage \?\? "order_confirmed" : "order_confirmed"/);
  assert.doesNotMatch(ordersClient, /<span className="form-label">Stage<\/span><select/);
  assert.match(ordersClient, /Production and dispatch events advance this stage/);
  assert.doesNotMatch(ordersClient, /updateOrderStageAction/);
  assert.match(ordersClient, /Stage updates when the linked factory workflow completes/);
});

test("database trigger enforces acceptance, ownership, and one order per quote", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /v_quote_status <> 'customer_approved'/);
  assert.match(migration, /v_quote_company_id <> new\.company_id or v_quote_customer_id <> new\.customer_id/);
  assert.match(migration, /existing\.quote_id = new\.quote_id/);
  assert.match(migration, /before insert or update of quote_id, company_id, customer_id on public\.orders/);
});
