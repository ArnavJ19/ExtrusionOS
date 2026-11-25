import test from "node:test";
import assert from "node:assert/strict";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";
import {
  canReadOrchestration, canWriteDiePreparation, departmentLabel, diePreparationCommandSchema, gateTone, nextPrepSteps, orchestrationCommandSchema,
  overallLabel, presentableDatabaseMessage
} from "../lib/workflow/orchestration.ts";

const id = "0e100000-0000-4000-8000-000000000001";

test("orchestration commands: unknown fields, bad ids and contradictory settings are refused before the database", () => {
  assert.equal(orchestrationCommandSchema.safeParse({ command: "tasks.acknowledge", task_id: id }).success, true);
  assert.equal(orchestrationCommandSchema.safeParse({ command: "tasks.acknowledge", task_id: "x" }).success, false);
  assert.equal(orchestrationCommandSchema.safeParse({ command: "tasks.acknowledge", task_id: id, status: "completed" }).success, false, "no way to send a completion");
  assert.equal(orchestrationCommandSchema.safeParse({ command: "settings.save", enforce_preheat: true, enforce_die_preparation: false }).success, false);
  assert.equal(orchestrationCommandSchema.safeParse({ command: "settings.save", billet_rank_threshold: 0 }).success, false);
  assert.equal(orchestrationCommandSchema.safeParse({ command: "standards.save", name: "Solid", die_type: null, min_temperature_c: 500, max_temperature_c: 400, min_soak_minutes: 60, max_hold_minutes: 120, sop_reference: "SOP-1" }).success, false);
  assert.equal(orchestrationCommandSchema.safeParse({ command: "tasks.reassign", task_id: id, user_id: id, note: "no" }).success, false, "a reassignment needs a reason");
  assert.equal(orchestrationCommandSchema.safeParse({ command: "lifecycle.board", department: "foundry", page: 2 }).success, true);
  assert.equal(orchestrationCommandSchema.safeParse({ command: "lifecycle.board", department: "marketing" }).success, false);
});

test("die preparation commands: every check is answered and preheat values are numbers", () => {
  const results = { die_present: true, revision_matches: true, press_compatible: true, condition_acceptable: true, maintenance_complete: true };
  assert.equal(diePreparationCommandSchema.safeParse({ command: "prep.check", id, results }).success, true);
  assert.equal(diePreparationCommandSchema.safeParse({ command: "prep.check", id, results: { ...results, maintenance_complete: undefined } }).success, false);
  assert.equal(diePreparationCommandSchema.safeParse({ command: "prep.complete_preheat", id, temperature_c: "460", soak_minutes: 60 }).success, false);
  assert.equal(diePreparationCommandSchema.safeParse({ command: "prep.schedule_preheat", id, scheduled_for: "2026-11-21T06:00:00.000Z" }).success, true);
  assert.deepEqual(nextPrepSteps("required"), ["prep.check"]);
  assert.deepEqual(nextPrepSteps("prepared"), ["prep.schedule_preheat"]);
  assert.deepEqual(nextPrepSteps("issued"), ["prep.return"]);
  assert.deepEqual(nextPrepSteps("cancelled"), []);
});

test("database messages: intentional explanations are shown, constraint internals are not", () => {
  assert.equal(presentableDatabaseMessage("23514", "Die preparation for die D-1 is not recorded as prepared."), "Die preparation for die D-1 is not recorded as prepared.");
  assert.equal(presentableDatabaseMessage("23514", 'new row for relation "tasks" violates check constraint "tasks_workflow_shape_check"'), null);
  assert.equal(presentableDatabaseMessage("23505", "duplicate key"), null);
});

test("roles and routes: dealers never reach orchestration; tool room writes die steps; inventory sees the order book", () => {
  assert.equal(canReadOrchestration("dealer_admin"), false);
  assert.equal(canReadOrchestration("viewer"), true);
  assert.equal(canWriteDiePreparation("quality"), false);
  assert.equal(canWriteDiePreparation("production"), true);
  assert.equal(hasRouteAccess("/production/order-book", "inventory_manager"), true);
  assert.equal(hasRouteAccess("/production", "inventory_manager"), false, "the wider production area is unchanged");
  assert.equal(hasRouteAccess("/dies/preparation/abc", "factory_manager"), true);
  assert.equal(hasRouteAccess("/tasks/orchestration", "dealer_staff"), false);
  assert.equal(hasRouteAccess("/settings/orchestration", "production_manager"), true);
  assert.equal(hasRouteAccess("/settings/orchestration", "production"), false);
  assert.equal(hasRouteAccess("/settings/access", "production_manager"), false);
});

test("labels and gate tone", () => {
  assert.equal(departmentLabel("tool_room"), "Tool room / dies");
  assert.equal(overallLabel("partially_fulfilled"), "Partially fulfilled");
  assert.equal(gateTone({ state: "passed", required: true }), "passed");
  assert.equal(gateTone({ state: "failed", required: true }), "failed");
  assert.equal(gateTone({ state: "failed", required: false }), "advisory");
});

test("batch 2 commands: containment, remelt and priority requests are validated before the database", async () => {
  const { containmentCommandSchema, remeltCommandSchema, priorityCommandSchema } = await import("../lib/workflow/nonconforming.ts");
  const { taskWorkLink } = await import("../lib/workflow/orchestration.ts");
  assert.equal(containmentCommandSchema.safeParse({ command: "open", job_id: id, scope_kg: 1000, stage: "final", defect: "Wall thin", defect_kind: "non_destructive" }).success, true);
  assert.equal(containmentCommandSchema.safeParse({ command: "open", job_id: id, scope_kg: 0, stage: "final", defect: "Wall thin", defect_kind: "non_destructive" }).success, false);
  assert.equal(containmentCommandSchema.safeParse({ command: "release", id, note: "ok" }).success, false, "a disposition needs its basis");
  assert.equal(containmentCommandSchema.safeParse({ command: "result", id, reference: "P1", result: "maybe", method: "Micrometer" }).success, false);
  assert.equal(remeltCommandSchema.safeParse({ command: "decide", id, decision: "approve", note: "Agreed" }).success, true);
  assert.equal(remeltCommandSchema.safeParse({ command: "decide", id, decision: "approve" }).success, false);
  assert.equal(remeltCommandSchema.safeParse({ command: "receive", id, received_kg: -1 }).success, false);
  assert.equal(priorityCommandSchema.safeParse({ command: "request", order_id: id, to_priority: "urgent", reason: "too short" }).success, false);
  assert.equal(priorityCommandSchema.safeParse({ command: "request", order_id: id, to_priority: "emergency", reason: "Customer moved the date" }).success, false);
  assert.deepEqual(taskWorkLink({ kind: "containment", order_id: null, source_id: id }), { href: `/quality/containment/${id}`, label: "Start QC" });
  assert.equal(taskWorkLink({ kind: "remelt_approval", order_id: null }).href, "/foundry/remelt");
  assert.equal(hasRouteAccess("/quality/containment", "factory_manager"), true);
  assert.equal(hasRouteAccess("/quality/containment/x", "sales"), false);
  assert.equal(hasRouteAccess("/foundry/remelt", "inventory_manager"), true);
  assert.equal(hasRouteAccess("/foundry/remelt", "dealer_admin"), false);
  assert.equal(hasRouteAccess("/orders/priority-requests", "sales"), true);
});
