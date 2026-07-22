import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/modules/report-builder-client.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260718040000_report_builder_data_sources.sql", import.meta.url), "utf8");

test("report sources resolve to real tables and production uses actual output", () => {
  assert.match(component, /production_jobs:\s*\[[^\]]*actual_quantity_kg/);
  assert.match(component, /scrap_records:\s*\[[^\]]*weight_kg[^\]]*recorded_date/);
  assert.doesNotMatch(component, /scrap_value|recorded_at/);
  assert.doesNotMatch(component, /produced_quantity_kg/);
  assert.doesNotMatch(component, /purchase_orders/);
  assert.match(
    component,
    /report\.data_source === "purchases" \? "packaging_material_purchases" : report\.data_source/,
  );
});

test("saved report constraint accepts every current expense and packaging source", () => {
  for (const source of ["expenses", "expense_payments", "packaging_material_purchases"]) {
    assert.match(migration, new RegExp(`'${source}'`));
  }
  assert.match(migration, /drop constraint if exists saved_reports_data_source_check/);
  assert.match(migration, /add constraint saved_reports_data_source_check/);
});

test("grouping changes exported data instead of remaining decorative", () => {
  assert.match(component, /allowedFields\.has\(config\.grouping\)/);
  assert.match(
    component,
    /grouping && !selected\.includes\(grouping\) \? \[grouping, \.\.\.selected\] : selected/,
  );
  assert.match(component, /query\.order\(grouping, \{ ascending: true, nullsFirst: false \}\)/);
  assert.match(component, /Grouped by:/);
  assert.match(component, /let activeGroupValue: string \| null = null/);
  assert.match(component, /prettyFieldLabel\(grouping\).*short\(groupValue/);
});


test("date ranges use each module's business date and an exclusive next-day boundary", () => {
  assert.match(component, /const sourceDateFieldMap/);
  assert.match(component, /quotes: "quote_date"/);
  assert.match(component, /dispatches: "dispatch_date"/);
  assert.match(component, /query\.gte\(dateField, dateRange\.from\)/);
  assert.match(component, /query\.lt\(dateField, nextIsoDate\(dateRange\.to\)\)/);
});

test("exports fail honestly when rows are incomplete or PDF generation fails", () => {
  assert.match(component, /select\(selectClause, \{ count: "exact" \}\)/);
  assert.match(component, /rowCount > rows\.length/);
  assert.match(component, /Add a date range or filters and try again/);
  assert.doesNotMatch(component, /Report export fallback/);
  assert.doesNotMatch(component, /fallback\.pdf/);
  assert.match(component, /PDF export failed/);
});
