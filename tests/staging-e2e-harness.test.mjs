import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const environment = read("tests/e2e/staging/support/environment.ts");
const setup = read("tests/e2e/staging/global-setup.ts");
const spec = read("tests/e2e/staging/staging.spec.ts");
const config = read("playwright.staging.config.ts");
const runner = read("scripts/run-staging-e2e.ts");

test("staging E2E refuses implicit or current-project credentials", () => {
  assert.match(environment, /E2E_STAGING_MUTATION_CONFIRM/);
  assert.match(environment, /seed-isolated-staging-fixtures/);
  assert.match(environment, /E2E_STAGING_SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(setup, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(environment, /matches the app's currently configured project; refusing to mutate it/);
  assert.match(environment, /dedicated staging key matches SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(runner, /SKIPPED staging E2E/);
  assert.doesNotMatch(config, /webServer/);
});

test("staging E2E seeds only disposable notification state", () => {
  assert.match(setup, /\.from\("notifications"\)\s*\.insert/);
  assert.match(setup, /\.from\("notifications"\)\s*\.delete/);
  assert.doesNotMatch(setup, /\.from\("(?:orders|dispatches|invoices|production_jobs)"\)\s*\.(?:insert|update|delete)/);
});

test("staging journeys cover practical factory fixes", () => {
  assert.match(spec, /\/production\/consolidation/);
  assert.match(spec, /Operator-Verified Bundle Manifest/);
  assert.match(spec, /Exact material source/);
  assert.match(spec, /Gross kg/);
  assert.match(spec, /Tare kg/);
  assert.match(spec, /Return Accounting/);
  assert.match(spec, /reading a broadcast notification is isolated per user/);
});
