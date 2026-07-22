import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const form = readFileSync(join(root, "components", "modules", "auth-forms.tsx"), "utf8");
const migration = readFileSync(
  join(root, "supabase", "migrations", "20260721091808_atomic_company_onboarding.sql"),
  "utf8",
);

test("company onboarding uses one database-owned transaction", () => {
  assert.match(form, /rpc\("onboard_company_atomic"/);
  assert.doesNotMatch(form, /from\("companies"\)\.insert/);
  assert.doesNotMatch(form, /from\("app_users"\)\.insert/);
  assert.doesNotMatch(form, /from\("company_settings"\)\.insert/);
  assert.match(migration, /create or replace function private\.onboard_company_atomic/);
  assert.match(migration, /if v_user_id is null/);
  assert.match(migration, /if exists \(select 1 from public\.app_users where id = v_user_id\)/);
});

test("new workspaces receive settings and explicit feature flags", () => {
  assert.match(migration, /insert into public\.company_settings/);
  assert.match(migration, /insert into public\.feature_flags/);
  assert.match(migration, /'bis_compliance'/);
  assert.match(migration, /'profitability_intelligence'/);
  assert.match(migration, /revoke all on function private\.onboard_company_atomic/);
  assert.match(migration, /grant execute on function public\.onboard_company_atomic[\s\S]*to authenticated/);
});
