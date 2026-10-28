import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canMapTaskKinds, describeUnbound, describeVersion, kindsListSchema, parseStepLines, procedureVersionCommandSchema, reviewActions, stepLines,
  taskInstructionsSchema, versionSchema, versionSummarySchema, versionsListSchema
} from "../lib/workflow/procedure-versions.ts";
import { createProcedureVersionFixture, pids } from "../scripts/lib/procedure-version-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";
const hash = "0123456789abcdef0123456789abcdef";

test("step lines round-trip, with an optional key check after |", () => {
  const steps = parseStepLines("  Isolate the press | Lock-out tag fitted \n\nFit the die\nRun trial | check a | b ");
  assert.deepEqual(steps, [{ text: "Isolate the press", check: "Lock-out tag fitted" }, { text: "Fit the die" }, { text: "Run trial", check: "check a | b" }]);
  assert.deepEqual(parseStepLines(stepLines(steps)), steps);
  assert.deepEqual(parseStepLines("Blank check |   "), [{ text: "Blank check" }]);
});

test("command validation mirrors the database limits", () => {
  const save = (steps, change_summary = "First issue") => procedureVersionCommandSchema.safeParse({ command: "draft.save", procedure_id: id, version_id: id, steps, change_summary, expected_hash: null }).success;
  assert.equal(save([{ text: "Fit the die" }]), true);
  assert.equal(save([]), false);
  assert.equal(save(Array.from({ length: 31 }, () => ({ text: "Fit the die" }))), false);
  assert.equal(save([{ text: "ok" }]), false);
  assert.equal(save([{ text: "Fit the die", extra: "x" }]), false, "unknown step keys are refused, as in the database");
  assert.equal(save([{ text: "Fit the die" }], "x"), false);
  assert.equal(procedureVersionCommandSchema.safeParse({ command: "review.release", version_id: id, expected_hash: hash, effective_from: "2026-10-22", in_flight_policy: "always" }).success, false);
  assert.equal(procedureVersionCommandSchema.safeParse({ command: "draft.submit", version_id: id, expected_hash: "stale" }).success, false);
  assert.equal(procedureVersionCommandSchema.safeParse({ command: "kinds.set", task_kind: "handoff:accounts", procedure_id: id }).success, false);
  assert.equal(procedureVersionCommandSchema.safeParse({ command: "kinds.set", task_kind: "type:die_change", procedure_id: null }).success, true);
  assert.ok(canMapTaskKinds("factory_manager") && !canMapTaskKinds("production_manager"));
});

test("versions are described relative to today and the version in effect", () => {
  assert.equal(describeVersion({ status: "released", effective_from: "2026-11-01", version_no: 3 }, "2026-10-22", 2), "Scheduled: takes effect on 2026-11-01");
  assert.equal(describeVersion({ status: "released", effective_from: "2026-10-01", version_no: 2 }, "2026-10-22", 2), "In effect");
  assert.match(describeVersion({ status: "released", effective_from: "2026-09-01", version_no: 1 }, "2026-10-22", 2), /Superseded/);
  assert.match(describeVersion({ status: "withdrawn", effective_from: null, version_no: 4 }, "2026-10-22", 2), /Withdrawn/);
  assert.match(describeUnbound("started_before_procedure"), /started before/);
});

test("review buttons are hidden from the author and from non-reviewers", () => {
  const v = { status: "in_review", author_id: id };
  assert.deepEqual(reviewActions(v, id, true), { release: false, returnToDraft: false, selfAuthored: true });
  assert.deepEqual(reviewActions(v, pids.sopBackup, true), { release: true, returnToDraft: true, selfAuthored: false });
  assert.equal(reviewActions(v, pids.sopBackup, false).release, false);
  assert.equal(reviewActions({ ...v, status: "draft" }, pids.sopBackup, true).release, false);
});

let f;
test.before(async () => { f = await createProcedureVersionFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("database responses parse with the app's schemas", async () => {
  const released = await f.release();
  versionSummarySchema.parse(released);
  await f.command("kinds.set", { task_kind: "type:die_change", procedure_id: pids.sop }, pids.owner);
  const draft = await f.command("draft.save", { procedure_id: pids.sop, version_id: f.nextId(), steps: [{ text: "Fit the die", check: "Bolts torqued" }], change_summary: "Second", expected_hash: null });
  versionSchema.parse(draft);
  versionSchema.parse(await f.command("version.load", { version_id: released.id }, pids.viewer));
  const list = versionsListSchema.parse(await f.command("versions.list", { procedure_id: pids.sop }, pids.operator));
  assert.equal(list.can_author, false);
  assert.equal(list.current?.version_no, 1);
  assert.equal(list.open?.version_no, 2);
  kindsListSchema.parse(await f.command("kinds.list", {}, pids.operator));
  const task = await f.addTask();
  assert.equal(taskInstructionsSchema.parse(await f.command("task.instructions", { task_id: task }, pids.operator)).bound, true);
  const unmapped = await f.addTask({ task_type: "general" });
  assert.equal(taskInstructionsSchema.parse(await f.command("task.instructions", { task_id: unmapped }, pids.operator)).bound, false);
});

/** Literal messages raised by the migration, including problems returned by validators and raised with '%'. */
function raisedMessages(sql) {
  return [...sql.matchAll(/(?:raise exception|\breturn) '((?:[^']|'')+)'/g)].map(m => m[1].replace(/''/g, "'")).filter(m => !m.includes("%"));
}

test("every business message the action passes through is raised by the migration, and every user-facing refusal is passed through", () => {
  const sql = readFileSync("supabase/migrations/20261022390000_procedure_versions.sql", "utf8");
  const action = readFileSync("lib/actions/procedure-versions.ts", "utf8");
  const listed = [...action.match(/const procedureVersionBusinessErrors = \[([\s\S]*?)\];/)[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
  const raised = new Set(raisedMessages(sql));
  for (const message of listed) assert.ok(raised.has(message), `not raised by the migration: ${message}`);
  const internal = new Set(["Authentication required", "Invalid procedure version request", "This action is not permitted for your role",
    "Procedure versions are kept as history and cannot be deleted", "A withdrawn procedure version is final", "A submitted or released procedure version cannot be edited. Start a new draft",
    "A procedure version cannot be moved or renumbered", "A released procedure version cannot be changed", "That procedure version change is not allowed",
    "Task procedure bindings are kept as history", "The instructions recorded for a completed task cannot change", "A binding cannot be moved to another task"]);
  for (const message of raised) assert.ok(listed.includes(message) || internal.has(message), `raised but neither passed through nor internal: ${message}`);
  assert.doesNotMatch(action, /^export const/m, "a 'use server' module may export only async functions");
});
