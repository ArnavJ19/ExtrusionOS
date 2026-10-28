import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canDelegate, canDelegateBetween, candidatesSchema, delegationCommandSchema, delegationDetailSchema, delegationListSchema, delegationState } from "../lib/workflow/task-delegation.ts";
import { createDelegationFixture, gids, gid } from "../scripts/lib/delegation-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";
const id2 = "00000000-0000-4000-8000-000000000061";
const later = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

test("supervisors delegate within the teams they supervise; others cannot delegate", () => {
  assert.ok(canDelegate("production_manager") && !canDelegate("production") && !canDelegate("viewer"));
  assert.equal(canDelegateBetween("production_manager", "production", "production"), true);
  assert.equal(canDelegateBetween("production_manager", "production", "dispatch"), false);
  assert.equal(canDelegateBetween("owner", "production", "dispatch"), true);
});

test("create commands check people, period and selection before reaching the database", () => {
  const base = { command: "delegation.create", request_id: id, delegator_id: id, delegate_id: id2, ends_at: later(24), scope: "all_open", reason: "Leave" };
  assert.equal(delegationCommandSchema.safeParse(base).success, true);
  assert.equal(delegationCommandSchema.safeParse({ ...base, delegate_id: id }).success, false);
  assert.equal(delegationCommandSchema.safeParse({ ...base, ends_at: later(-1), starts_at: later(1) }).success, false);
  assert.equal(delegationCommandSchema.safeParse({ ...base, ends_at: later(24 * 91) }).success, false);
  assert.equal(delegationCommandSchema.safeParse({ ...base, scope: "selected" }).success, false);
  assert.equal(delegationCommandSchema.safeParse({ ...base, reason: "x" }).success, false);
  assert.equal(delegationCommandSchema.safeParse({ ...base, ends_at: "tomorrow" }).success, false);
});

test("delegation state reflects time and closure", () => {
  const now = Date.parse("2026-10-22T10:00:00Z");
  const row = { starts_at: "2026-10-22T09:00:00Z", ends_at: "2026-10-24T09:00:00Z", activated_at: "2026-10-22T09:00:00Z", closed_at: null, close_reason: null };
  assert.equal(delegationState(row, now), "active");
  assert.equal(delegationState({ ...row, starts_at: "2026-10-23T09:00:00Z", activated_at: null }, now), "scheduled");
  assert.equal(delegationState({ ...row, ends_at: "2026-10-22T09:30:00Z" }, now), "expiring");
  assert.equal(delegationState({ ...row, closed_at: "x", close_reason: "cancelled" }, now), "cancelled");
  assert.equal(delegationState({ ...row, closed_at: "x", close_reason: "expired" }, now), "ended");
});

let f;
test.before(async () => { f = await createDelegationFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("database list, detail and candidate responses parse with the app's schemas", async () => {
  candidatesSchema.parse(await f.command("delegation.candidates", { delegator_id: gids.absent }));
  await f.create();
  await f.db.exec(`update tasks set status='completed' where id='${gids.t2}'`);
  await f.command("delegation.cancel", { id: gid(5000), note: "Back early" });
  assert.equal(delegationDetailSchema.parse(await f.command("delegation.load", { id: gid(5000) })).items.length, 4);
  assert.equal(delegationListSchema.parse(await f.command("delegation.list", { status: "closed" })).total_count, 1);
});

test("the action and pages keep delegation to supervisors and exclude dealer sessions", () => {
  const action = readFileSync("lib/actions/task-delegation.ts", "utf8");
  assert.match(action, /context\.dealerId \|\| \(\(mutation \|\| command === "delegation\.candidates"\) && !canDelegate\(context\.role\)\)/);
  const page = readFileSync("app/(dashboard)/tasks/delegations/page.tsx", "utf8");
  assert.match(page, /canDelegate\(context\.role\) && !unavailable \? <NewDelegationForm/);
  assert.match(page, /p_command: "delegation\.sync"/);
});
