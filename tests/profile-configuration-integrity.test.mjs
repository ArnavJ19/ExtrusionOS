import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routingClient = readFileSync("components/modules/profiles/profile-routing-client.tsx", "utf8");
const qualityClient = readFileSync("components/modules/profiles/profile-quality-plan-client.tsx", "utf8");
const detailPage = readFileSync("app/(dashboard)/profiles/[id]/page.tsx", "utf8");
const action = readFileSync("lib/actions/profile-configuration.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260812030000_profile_configuration_integrity.sql", "utf8");

test("profile manufacturing configuration uses authorized atomic replacements", () => {
  assert.match(action, /can\(context\.role, "update", "profiles"\)/);
  assert.match(routingClient, /replaceProfileRoutingAction/);
  assert.doesNotMatch(routingClient, /from\("profile_routing_steps"\)\.delete/);
  assert.match(qualityClient, /replaceProfileQualityPlanAction/);
  assert.doesNotMatch(qualityClient, /from\("profile_quality_plans"\)\.update/);
  assert.match(detailPage, /canEdit=\{canEditProfileConfiguration\}/);
});

test("database owns configuration mutation and keeps direct access read-only", () => {
  assert.match(migration, /drop policy if exists "profile_routing_tenant"/);
  assert.match(migration, /create policy "profile_routing_read"[\s\S]+for select to authenticated/i);
  assert.match(migration, /drop policy if exists "profile_quality_plan_tenant"/);
  assert.match(migration, /private\.get_current_user_role\(\) not in \('owner', 'admin'\)/);
  assert.match(migration, /for update;/i);
  assert.match(migration, /delete from public\.profile_routing_steps[\s\S]+insert into public\.profile_routing_steps/i);
  assert.match(migration, /update public\.profile_quality_plans[\s\S]+insert into public\.profile_quality_plans/i);
  assert.match(migration, /revoke all on function private\.replace_profile_routing_atomic\(uuid, jsonb\) from public, anon, authenticated/);
});
