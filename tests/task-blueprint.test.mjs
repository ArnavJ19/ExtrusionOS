import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLUEPRINT_ROLES, PREREQUISITE_STATES, blueprintLoadSchema, blueprintSections, blueprintsListSchema, canManageBlueprints, describeKind, exceptionsListSchema,
  prerequisiteProblem, taskBlueprintCommandSchema, taskBlueprintSchema
} from "../lib/workflow/task-blueprints.ts";
import { createTaskBlueprintFixture, bids } from "../scripts/lib/task-blueprint-fixture.mjs";

const migration = readFileSync("supabase/migrations/20261022400000_task_blueprints.sql", "utf8");

test("the app's role and state tables mirror the database", () => {
  const roles = migration.match(/blueprint_roles\(\) returns text\[\][^$]*\$\$\s*select array\[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual([...BLUEPRINT_ROLES], roles);
  const criteria = readFileSync("supabase/migrations/20261022360000_task_completion_criteria.sql", "utf8");
  for (const [type, states] of Object.entries(PREREQUISITE_STATES)) {
    const line = criteria.match(new RegExp(`when '${type}' then array\\[([^\\]]+)\\]`))[1];
    assert.deepEqual([...states], line.match(/'([a-z_]+)'/g).map(s => s.slice(1, -1)), type);
  }
});

test("prerequisite validation mirrors the database", () => {
  assert.equal(prerequisiteProblem([{ kind: "record_state", entity_type: "production_job", states: ["ready"] }]), null);
  assert.match(prerequisiteProblem([{ kind: "record_state", entity_type: "production_job", states: ["flying"] }]), /not valid/);
  assert.match(prerequisiteProblem([{ kind: "linked_record", entity_type: "order" }, { kind: "linked_record", entity_type: "dispatch" }]), /same linked record type/);
  const base = { command: "blueprint.save", id: bids.sop, task_kind: "type:die_change", title: "Die change", purpose: "Change dies", trigger_text: "Job needs die", inputs: [],
    responsible_roles: ["production"], prerequisites: [], exception_role: "production_manager", exception_instruction: "Call supervisor", is_active: true, note: "First issue" };
  assert.equal(taskBlueprintCommandSchema.safeParse(base).success, true);
  assert.equal(taskBlueprintCommandSchema.safeParse({ ...base, responsible_roles: ["viewer"] }).success, false);
  assert.equal(taskBlueprintCommandSchema.safeParse({ ...base, prerequisites: [{ kind: "record_state", entity_type: "order", states: ["flying"] }] }).success, false);
  assert.equal(taskBlueprintCommandSchema.safeParse({ ...base, task_kind: "handoff:accounts" }).success, false);
  assert.ok(canManageBlueprints("factory_manager") && !canManageBlueprints("production_manager"));
  assert.equal(describeKind("handoff:packaging"), "Handoff to packaging");
  assert.equal(describeKind("type:die_change"), "Task type die change");
});

let f;
test.before(async () => { f = await createTaskBlueprintFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("database responses parse with the app's schemas, and every blueprint shows the same eight headings", async () => {
  const saved = await f.command("blueprint.save", f.blueprint());
  blueprintsListSchema.parse(await f.command("blueprints.list", {}, bids.viewer));
  const loaded = blueprintLoadSchema.parse(await f.command("blueprint.load", { blueprint_id: saved.id }));
  const sections = blueprintSections(loaded.blueprint).map(s => s.heading);
  assert.deepEqual(sections, ["Purpose", "Trigger", "Inputs", "Responsible", "Prerequisites", "Steps", "Completion evidence", "Exception route"]);
  assert.equal(blueprintSections(loaded.blueprint)[5].body, "No operating procedure is set for this task kind");
  const task = await f.addTask();
  const view = taskBlueprintSchema.parse(await f.command("task.blueprint", { task_id: task }, bids.operator));
  assert.equal(view.has_blueprint && view.can_raise, true);
  await f.command("exception.raise", { task_id: task, id: f.nextId(), reason: "Die cracked" }, bids.operator);
  exceptionsListSchema.parse(await f.command("exceptions.list", {}, bids.sopOwner));
  assert.equal(taskBlueprintSchema.parse(await f.command("task.blueprint", { task_id: await f.addTask({ task_type: "general" }) })).has_blueprint, false);
});

function raisedMessages(sql) {
  return [...sql.matchAll(/(?:raise exception|\breturn) '((?:[^']|'')+)'/g)].map(m => m[1].replace(/''/g, "'")).filter(m => !m.includes("%"));
}

test("business messages passed through are raised by the migration; start refusals reach handoff takers", () => {
  const action = readFileSync("lib/actions/task-blueprints.ts", "utf8");
  const listed = [...action.match(/const taskBlueprintBusinessErrors = \[([\s\S]*?)\];/)[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
  const raised = new Set(raisedMessages(migration));
  for (const message of listed) assert.ok(raised.has(message), `not raised: ${message}`);
  const internal = new Set(["Authentication required", "Invalid blueprint request", "This action is not permitted for your role"]);
  for (const message of raised) assert.ok(listed.includes(message) || internal.has(message), `not passed through: ${message}`);
  assert.doesNotMatch(action, /^export const/m);
  assert.match(migration, /left\('This task cannot start yet: '/);
  assert.match(readFileSync("lib/actions/department-handoffs.ts", "utf8"), /message\.startsWith\("This task cannot start yet:"\)/);
  assert.match(readFileSync("lib/utils/errors.ts", "utf8"), /message\.length <= 240/, "the tasks API passes refusals of up to 240 characters");
});
