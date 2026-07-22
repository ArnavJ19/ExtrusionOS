import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260715000000_atomic_business_workflows.sql");
const quoteOrders = read("lib/actions/quotes-orders.ts");
const dispatches = read("lib/actions/dispatches.ts");
const invoices = read("lib/actions/invoices.ts");
const production = read("lib/actions/production.ts");
const dealerRoute = read("app/api/dealer-orders/from-quote-order/route.ts");
const dieActions = read("lib/actions/die-actions.ts");

test("multi-table business saves use atomic database functions", () => {
  assert.match(quoteOrders, /rpc\("convert_quote_to_order_atomic"/);
  assert.match(quoteOrders, /rpc\("save_order_atomic"/);
  assert.match(dispatches, /rpc\("save_ready_dispatch_atomic"/);
  assert.match(invoices, /rpc\("save_invoice_atomic"/);
  assert.match(invoices, /rpc\("replace_invoice_items_atomic"/);
  assert.match(production, /rpc\("save_production_job_atomic"/);
  assert.match(dealerRoute, /rpc\("create_dealer_order_from_order_atomic"/);
  assert.doesNotMatch(dealerRoute, /createAdminClient/);
});

test("atomic implementations enforce auth, tenant permissions, and row locks", () => {
  assert.match(migration, /create or replace function private\.convert_quote_to_order_atomic[\s\S]*security definer/);
  assert.match(migration, /private\.get_current_user_role\(\) not in \('owner','admin','sales','sales_manager'\)/);
  assert.match(migration, /private\.get_current_user_role\(\) not in \('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch'\)/);
  assert.match(migration, /private\.get_current_user_role\(\) not in \('owner','admin','accounts'\)/);
  assert.match(migration, /p_job_id is null and private\.get_current_user_role\(\) not in \('owner','admin','production_manager','factory_manager'\)/);
  assert.match(migration, /p_job_id is not null and private\.get_current_user_role\(\) not in \('owner','admin','production_manager','factory_manager','production'\)/);
  assert.match(migration, /where id = p_quote_id and company_id = v_company_id[\s\S]*for update/);
  assert.match(migration, /from public\.foundry_billets[\s\S]*for update/);
  assert.match(migration, /revoke all on function public\.save_dispatch_atomic[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function public\.save_dispatch_atomic[\s\S]*to authenticated/);
  assert.match(migration, /returns uuid language sql security definer set search_path = public, private/);
  assert.match(migration, /revoke all on function private\.save_dispatch_atomic[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant execute on function private\.save_dispatch_atomic[\s\S]*to authenticated/);
});

test("business numbers are allocated under a company and year lock", () => {
  assert.match(migration, /create or replace function private\.next_business_number_locked/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /p_company_id::text \|\| ':' \|\| p_table::text \|\| ':' \|\| p_prefix/);
  for (const prefix of ["'O'", "'D'", "'INV'", "'J'"]) {
    assert.match(migration, new RegExp(prefix));
  }
  assert.doesNotMatch(dispatches, /nextBusinessNumber/);
  assert.doesNotMatch(invoices, /nextBusinessNumber/);
  assert.doesNotMatch(production, /nextBusinessNumber/);
});

test("quote and dealer conversion retries are idempotent", () => {
  assert.match(migration, /where company_id = v_company_id and quote_id = p_quote_id[\s\S]*if v_existing_id is not null then return v_existing_id/);
  assert.match(migration, /where company_id = v_company_id and linked_order_id = p_order_id[\s\S]*if found then/);
  assert.match(migration, /orders_company_quote_unique/);
  assert.match(migration, /dealer_orders_company_linked_order_unique/);
});

test("die and profile updates are allowlisted, permission checked, and versioned atomically", () => {
  assert.match(dieActions, /can\(context\.role, "update", "dies"\)/);
  assert.match(dieActions, /can\(context\.role, "update", "profiles"\)/);
  assert.match(dieActions, /dieSchema\.safeParse\(payload\)/);
  assert.match(dieActions, /profileSchema\.safeParse\(payload\)/);
  assert.match(dieActions, /rpc\("update_versioned_entity_atomic"/);
  assert.doesNotMatch(dieActions, /recordRevision/);
  assert.match(migration, /v_allowed_fields := array\[[\s\S]*'die_number'[\s\S]*'die_vendor_id'/);
  assert.match(migration, /v_allowed_fields := array\[[\s\S]*'profile_code'[\s\S]*'primary_die_id'/);
  assert.match(migration, /private\.keep_jsonb_keys\(p_payload, v_allowed_fields\)/);
  assert.match(migration, /insert into public\.entity_revisions[\s\S]*private\.update_jsonb_row/);
});

test("RPC JSON payloads are filtered through server-owned field allowlists", () => {
  assert.match(migration, /create or replace function private\.keep_jsonb_keys/);
  assert.match(migration, /private\.keep_jsonb_keys\(p_order, array\[/);
  assert.match(migration, /private\.keep_jsonb_keys\(p_dispatch, array\[/);
  assert.match(migration, /private\.keep_jsonb_keys\(p_invoice, array\[/);
  assert.match(migration, /private\.keep_jsonb_keys\(p_job, array\[/);
});
