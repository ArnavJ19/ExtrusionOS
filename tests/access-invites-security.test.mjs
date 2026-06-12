import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const createInviteRoute = readFileSync(join(repoRoot, "app/api/access/invites/route.ts"), "utf8");
const acceptInviteRoute = readFileSync(join(repoRoot, "app/api/access/invites/accept/route.ts"), "utf8");

test("invite creation does not expose raw token links outside email delivery", () => {
  assert.match(createInviteRoute, /sendInviteEmail\(\{[\s\S]*inviteLink[\s\S]*\}\)/);
  assert.doesNotMatch(createInviteRoute, /invite_link\s*:/);
  assert.doesNotMatch(createInviteRoute, /action_link:\s*inviteLink/);
  assert.match(createInviteRoute, /action_link:\s*"\/settings\/access"/);
  assert.match(createInviteRoute, /return NextResponse\.json\(\{ invite: inviteResult\.data, email: emailResult \}\)/);
});

test("invite acceptance does not reset passwords for existing auth users", () => {
  assert.match(acceptInviteRoute, /admin\.auth\.admin\.createUser\(\{[\s\S]*password/);
  assert.doesNotMatch(acceptInviteRoute, /updateUserById/);
  assert.match(acceptInviteRoute, /An account already exists for this email/);
  assert.match(acceptInviteRoute, /status:\s*409/);
});

test("invite acceptance is restricted to pending invites", () => {
  assert.match(acceptInviteRoute, /invite\.status !== "pending"/);
  assert.match(acceptInviteRoute, /\.eq\("status", "pending"\)/);
  assert.doesNotMatch(acceptInviteRoute, /\["pending",\s*"accepted"\]\.includes/);
});
