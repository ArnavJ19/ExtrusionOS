import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const page = readFileSync(join(root, "app", "(dashboard)", "analytics", "page.tsx"), "utf8");
const migration = readFileSync(
  join(root, "supabase", "migrations", "20260721091327_advanced_analytics_aggregates.sql"),
  "utf8",
);

test("management analytics are loaded through one complete database aggregate", () => {
  assert.match(page, /rpc\("get_advanced_analytics_snapshot"/);
  assert.match(page, /parseAdvancedAnalyticsSnapshot\(analyticsResult\.data\)/);
  assert.match(page, /database returned an invalid snapshot/);
  assert.doesNotMatch(page, /\.limit\(1500\)/);
  assert.doesNotMatch(page, /supabase\.from\("(?:orders|quotes|production_jobs|dispatches|invoices|expense_ledger|quality_inspections|inventory_items|tasks)"\)/);
  assert.match(migration, /create or replace function public\.get_advanced_analytics_snapshot/);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test("aggregate RPC derives tenant identity and grants no anonymous execution", () => {
  assert.match(migration, /v_company_id uuid := public\.get_current_user_company_id\(\)/);
  assert.match(migration, /where o\.company_id = v_company_id/);
  assert.match(migration, /where i\.company_id = v_company_id/);
  assert.match(migration, /revoke all on function public\.get_advanced_analytics_snapshot\(date, integer\) from public, anon/);
  assert.match(migration, /grant execute on function public\.get_advanced_analytics_snapshot\(date, integer\) to authenticated/);
});

test("aggregate totals remain independent from presentation queue limits", () => {
  assert.match(migration, /count\(\*\) filter[\s\S]*as overdue_invoices/);
  assert.match(migration, /count\(\*\) filter \(where reorder_level > 0 and current_stock <= reorder_level\)[\s\S]*as at_risk_count/);
  assert.match(migration, /overdue_invoices > 0 then metrics\.overdue_invoices/);
  assert.match(migration, /at_risk_count > 0 then metrics\.at_risk_count/);
  assert.match(migration, /limit 8/);
  assert.match(migration, /limit 10/);
});

test("six-month trends exclude cancelled orders, draft invoices, and deleted expenses", () => {
  assert.match(migration, /order_date >= v_trend_start[\s\S]*current_stage <> 'cancelled'/);
  assert.match(migration, /invoice_date >= v_trend_start[\s\S]*status in \('generated', 'sent', 'partially_paid', 'paid', 'overdue'\)/);
  assert.match(migration, /from public\.expense_ledger e[\s\S]*e\.deleted_at is null/);
  assert.match(migration, /from public\.get_financial_collection_events\(v_trend_start\)/);
});
