import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const createRoute = readFileSync(join(repoRoot, "app/api/access/invites/route.ts"), "utf8");
const acceptRoute = readFileSync(join(repoRoot, "app/api/access/invites/accept/route.ts"), "utf8");
const accessClient = readFileSync(join(repoRoot, "components/modules/access-control-client.tsx"), "utf8");
const migration = readFileSync(join(repoRoot, "supabase/migrations/20260812020000_invite_acceptance_integrity.sql"), "utf8");

test("invite routes reject unsupported custom roles before creating an Auth user", () => {
  assert.match(createRoute, /!roleResult\.data\.is_system[\s\S]*Custom roles cannot be assigned by invitation yet/);
  assert.match(acceptRoute, /!role\.is_system \|\| !CANONICAL_ROLE_KEYS\.has\(role\.role_key\)/);
  assert.ok(acceptRoute.indexOf("!role.is_system") < acceptRoute.indexOf("admin.auth.admin.createUser"));
  assert.match(accessClient, /disabled=\{!role\.is_system\}/);
  assert.match(accessClient, /custom, not inviteable/);
});

test("invite acceptance claims authorization atomically and compensates Auth failures", () => {
  assert.match(acceptRoute, /rpc\("accept_invitation_atomic"/);
  assert.match(acceptRoute, /admin\.auth\.admin\.deleteUser\(userId\)/);
  assert.doesNotMatch(acceptRoute, /from\("app_users"\)\.upsert/);
  assert.match(migration, /from public\.invitations invitation[\s\S]*for update/);
  assert.match(migration, /insert into public\.app_users[\s\S]*insert into public\.user_roles[\s\S]*update public\.invitations/);
  assert.match(migration, /revoke all on function public\.accept_invitation_atomic\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.accept_invitation_atomic\(uuid, uuid\) to service_role/);
});
