import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ESCALATION_ROLES, TASK_KIND_PATTERN, escalationListSchema, formatMinutes, headlineState, targetsSchema, taskKindLabel, turnaroundCommandSchema, turnaroundStatusSchema } from "../lib/workflow/turnaround.ts";
import { createTurnaroundFixture, tids } from "../scripts/lib/turnaround-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";

test("durations read naturally", () => {
  assert.equal(formatMinutes(45.4), "45 min");
  assert.equal(formatMinutes(185), "3 h 05 min");
  assert.equal(formatMinutes(120), "2 h");
  assert.equal(formatMinutes(3120), "2 d 4 h");
  assert.equal(formatMinutes(-5), "0 min");
  assert.equal(formatMinutes(null), "-");
});

test("task kinds, escalation roles and the start/complete rule mirror the database", () => {
  const sql = readFileSync("supabase/migrations/20261022300000_turnaround_targets.sql", "utf8");
  assert.ok(sql.includes(TASK_KIND_PATTERN.source.replace(/\\\//g, "/")), "same task-kind pattern");
  for (const role of ESCALATION_ROLES) assert.ok(sql.includes(`'${role}'`), role);
  const base = { command: "targets.set", task_kind: "type:maintenance", response_minutes: 30, completion_minutes: 600, calendar: "day_shift", escalation_role: "factory_manager", is_active: true };
  assert.equal(turnaroundCommandSchema.safeParse(base).success, true);
  assert.equal(turnaroundCommandSchema.safeParse({ ...base, response_minutes: 700 }).success, false);
  assert.equal(turnaroundCommandSchema.safeParse({ ...base, task_kind: "type:Bad Kind" }).success, false);
  assert.equal(turnaroundCommandSchema.safeParse({ ...base, escalation_role: "sales" }).success, false);
  assert.equal(turnaroundCommandSchema.safeParse({ command: "wait.start", task_id: id, reason: "other", note: "x" }).success, false);
});

test("labels and the headline state pick the most urgent condition", () => {
  assert.equal(taskKindLabel("handoff:packaging"), "Packaging handoffs");
  assert.equal(taskKindLabel("handoff_return"), "Returned handoffs");
  assert.equal(taskKindLabel("type:die_maintenance"), "Tasks of type die maintenance");
  const base = { task_id: id, task_kind: "x", has_target: true, calendar: "24x7", elapsed_minutes: 1, working_minutes: 1, waiting_minutes: 0, active_minutes: 1, response_minutes_target: 1, response_active_minutes: 1, completion_minutes_target: 1, escalation_role: "owner" };
  assert.equal(headlineState({ ...base, response_state: "met", completion_state: "breached" }), "breached");
  assert.equal(headlineState({ ...base, response_state: "due_soon", completion_state: "on_track" }), "due_soon");
  assert.equal(headlineState({ task_id: id, task_kind: "x", has_target: false, elapsed_minutes: 5 }), "none");
});

let f;
test.before(async () => { f = await createTurnaroundFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("database responses parse with the app's schemas (status, targets, escalations, wait)", async () => {
  const statuses = turnaroundStatusSchema.parse(await f.command("task.status", { task_ids: [tids.pack, tids.untargeted, tids.general] }));
  assert.equal(statuses.length, 3);
  assert.equal(targetsSchema.parse(await f.command("targets.list", {})).length, 2);
  await f.command("escalations.run", {}, tids.factory);
  assert.ok(escalationListSchema.parse(await f.command("escalations.list", {})).total_count >= 1);
  const waiting = turnaroundStatusSchema.parse([await f.command("wait.start", { task_id: tids.general, reason: "waiting_customer", note: "Shade approval" }, tids.packer)])[0];
  assert.equal(waiting.open_wait.reason, "waiting_customer");
});

test("pages and action restrict target changes and escalation runs to managers", () => {
  const action = readFileSync("lib/actions/turnaround.ts", "utf8");
  assert.match(action, /\(command === "targets\.set" \|\| command === "escalations\.run"\) && !canManageTargets\(context\.role\)/);
  assert.match(readFileSync("app/(dashboard)/tasks/turnaround/page.tsx", "utf8"), /manager \? <TargetEditor/);
  assert.match(readFileSync("app/(dashboard)/tasks/[id]/page.tsx", "utf8"), /if \(!context\.dealerId && UUID\.test\(id\)\)/);
});
