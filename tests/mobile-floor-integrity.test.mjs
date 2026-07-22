import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync(new URL("../app/(dashboard)/mobile/page.tsx", import.meta.url), "utf8");
const jobs = readFileSync(new URL("../app/(dashboard)/mobile/jobs/page.tsx", import.meta.url), "utf8");
const quality = readFileSync(new URL("../app/(dashboard)/mobile/quality/page.tsx", import.meta.url), "utf8");

test("mobile home counts the real active production and inspection records", () => {
  assert.match(home, /from\("production_jobs"\)[\s\S]*\.not\("status", "in", "\(completed,cancelled\)"\)/);
  assert.match(home, /from\("quality_inspections"\)/);
  assert.doesNotMatch(home, /quality_tests|planned_start_date/);
  assert.match(home, /queryError/);
});

test("mobile production queue uses actual production schema and surfaces errors", () => {
  assert.match(jobs, /actual_quantity_kg/);
  assert.match(jobs, /scrap_records\(weight_kg\)/);
  assert.match(jobs, /\.not\("status", "in", "\(completed,cancelled\)"\)/);
  assert.match(jobs, /Could not load active production jobs/);
  assert.doesNotMatch(jobs, /current_stage|actual_output_kg|planned_start_date|scrap_kg/);
});

test("mobile quality queue uses quality inspections and their real measurements", () => {
  assert.match(quality, /from\("quality_inspections"\)/);
  assert.match(quality, /quantity_checked_kg/);
  assert.match(quality, /surface_finish_ok/);
  assert.match(quality, /Could not load quality inspections/);
  assert.doesNotMatch(quality, /quality_tests|test_number|test_type/);
});
