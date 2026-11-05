import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createNov7ActionsFixture, n7 } from "../scripts/lib/nov-batch7-actions-fixture.mjs";

const require = createRequire(import.meta.url); require("tsx/cjs");
const execution = require("../lib/workflow/execution.ts");
const form = require("../lib/workflow/execution-form.ts");
const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");
const strip = require("../components/modules/execution/progress-strip.tsx");
const migration = readFileSync("supabase/migrations/20261103600000_november_execution.sql", "utf8");
const read = path => readFileSync(path, "utf8");
const id = n => n7(n);
const note = "Reviewed with the responsible department";
const schema = execution.executionMutationSchema;

// Schema ------------------------------------------------------------------------------------------
test("every execution action has exactly one validated shape and rejects unknown keys", () => {
  const actions = schema._def.schema.options.map(option => option.shape.action.value);
  assert.equal(actions.length, 39);
  assert.equal(new Set(actions).size, 39);
  for (const action of actions) assert.match(migration, new RegExp(`'${action.replace(".", "\\.")}'`), `${action} is known to the database`);
  const ok = schema.safeParse({ action: "appointment.cancel", id: id(1), note });
  assert.equal(ok.success, true);
  assert.equal(schema.safeParse({ action: "appointment.cancel", id: id(1), note, company_id: id(2) }).success, false, "injected keys are refused");
  assert.equal(schema.safeParse({ action: "appointment.cancel", id: "not-a-uuid", note }).success, false);
  assert.equal(schema.safeParse({ action: "appointment.cancel", id: id(1), note: "no" }).success, false);
  assert.equal(schema.safeParse({ action: "appointment.cancel", id: id(1), note: "bad\nline break" }).success, false, "control characters are refused");
  assert.equal(schema.safeParse({ action: "message.prepare", template: "order_confirmation", entity_id: id(1) }).success, true, "messages carry no separate explanation");
  assert.equal(schema.safeParse({ action: "message.prepare", template: "order_confirmation", entity_id: id(1), note }).success, false);
  assert.equal(schema.safeParse({ action: "message.prepare", template: "newsletter", entity_id: id(1) }).success, false);
  assert.equal(schema.safeParse({ action: "message.mark", id: id(1), state: "sent" }).success, false, "no state claims delivery");
  assert.equal(schema.safeParse({ action: "message.mark", id: id(1), state: "copied" }).success, true);
});

test("appointment and gate pass shapes enforce the same rules the database does", () => {
  const request = { action: "appointment.request", order_id: id(1), requested_start: "2026-11-06T09:00:00+05:30", requested_end: "2026-11-06T11:00:00+05:30", owner_id: id(2), note };
  assert.equal(schema.safeParse(request).success, true);
  assert.equal(schema.safeParse({ ...request, requested_start: "2026-11-06 09:00" }).success, false, "an instant needs a time zone");
  assert.equal(schema.safeParse({ ...request, contact_phone: "12345" }).success, false);
  assert.equal(schema.safeParse({ ...request, contact_phone: "+91 98200 11122" }).success, true);
  assert.equal(schema.safeParse({ ...request, contact_phone: "098200-11122" }).success, true);
  const die = { action: "gatepass.issue", item_kind: "die", die_id: id(3), item_label: "DIE-1", quantity: 1, custodian_name: "Nitriding House", custodian_kind: "vendor", purpose: "Nitriding cycle", due_date: "2026-11-10", owner_id: id(2), note };
  assert.equal(schema.safeParse(die).success, true);
  assert.equal(schema.safeParse({ ...die, die_id: undefined }).success, false);
  assert.equal(schema.safeParse({ ...die, quantity: 2 }).success, false);
  assert.equal(schema.safeParse({ ...die, item_kind: "pallet" }).success, false, "only a die pass names a die");
  assert.equal(schema.safeParse({ ...die, item_kind: "pallet", die_id: undefined, quantity: 10 }).success, true);
  assert.equal(schema.safeParse({ ...die, item_kind: "pallet", die_id: undefined, quantity: 10, serial_ref: "P-1" }).success, false, "a serial number means quantity 1");
  assert.equal(schema.safeParse({ ...die, quantity: 1.5 }).success, false);
});

test("window, stage limit, route and queue shapes reject unsafe or ambiguous values", () => {
  assert.equal(schema.safeParse({ action: "window.set", horizon_hours: 48, enforce: false, note }).success, true);
  assert.equal(schema.safeParse({ action: "window.set", horizon_hours: 6, enforce: false, note }).success, false);
  assert.equal(schema.safeParse({ action: "window.set", horizon_hours: 48, enforce: "yes", note }).success, false);
  const limit = { action: "wip.set_limit", stage: "awaiting_qc", unit: "kg", limit_value: 1200.5, basis: "One shift of inspection", note };
  assert.equal(schema.safeParse(limit).success, true);
  assert.equal(schema.safeParse({ ...limit, limit_value: 1200.5555 }).success, false);
  assert.equal(schema.safeParse({ ...limit, unit: "jobs", limit_value: 2.5 }).success, false);
  assert.equal(schema.safeParse({ ...limit, unit: "tons" }).success, false);
  const route = { action: "route.define", code: "stock_sale", name: "Stock sale", applies_when: "Sold from stock", required_stages: ["order_confirmed", "packing", "dispatched"], note };
  assert.equal(schema.safeParse(route).success, true);
  assert.equal(schema.safeParse({ ...route, required_stages: ["order_confirmed", "dispatched", "delivered"] }).success, false, "packing is a core control");
  assert.equal(schema.safeParse({ ...route, optional_stages: ["packing"] }).success, false);
  assert.equal(schema.safeParse({ ...route, required_stages: ["order_confirmed", "packing", "dispatched", "dispatched"] }).success, false);
  assert.equal(schema.safeParse({ action: "route.deviate", order_id: id(1), stage: "packing", note }).success, false);
  assert.equal(schema.safeParse({ action: "route.deviate", order_id: id(1), stage: "stretching", note }).success, true);
  const record = { id: id(5), version: "2026-11-05T10:00:00.000000Z" };
  const queue = { action: "queue.update", selection: "page", field: "priority", value: "high", records: [record] };
  assert.equal(schema.safeParse(queue).success, true);
  assert.equal(schema.safeParse({ ...queue, records: [record, record] }).success, false, "duplicates are refused");
  assert.equal(schema.safeParse({ ...queue, records: Array.from({ length: 11 }, (_, n) => ({ ...record, id: id(100 + n) })) }).success, false, "a page selection holds ten");
  assert.equal(schema.safeParse({ ...queue, selection: "filtered", records: Array.from({ length: 11 }, (_, n) => ({ ...record, id: id(100 + n) })) }).success, true);
  assert.equal(schema.safeParse({ ...queue, field: "status", value: "completed" }).success, false, "status changes stay in their own workflows");
  assert.equal(schema.safeParse({ ...queue, field: "priority", value: "critical" }).success, false);
  assert.equal(schema.safeParse({ ...queue, field: "assigned_to", value: "someone" }).success, false);
  assert.equal(schema.safeParse({ ...queue, field: "due_date", value: "next week" }).success, false);
  assert.equal(schema.safeParse({ ...queue, records: [{ id: id(5) }] }).success, false, "the version the person saw is required");
  assert.equal(schema.safeParse({ ...queue, records: Array.from({ length: 51 }, (_, n) => ({ ...record, id: id(200 + n) })), selection: "filtered" }).success, false);
});

test("the stage, template and rule lists in TypeScript and SQL are identical", () => {
  const sqlStages = /array\['order_confirmed',[^\]]*'closed'\]/.exec(migration)[0].match(/'([a-z_]+)'/g).map(item => item.replaceAll("'", ""));
  assert.deepEqual(sqlStages, Object.keys(execution.STAGES));
  for (const stage of Object.keys(execution.WIP_STAGES)) assert.match(migration, new RegExp(`'${stage}'`));
  for (const template of Object.keys(execution.MESSAGE_TEMPLATES)) assert.match(migration, new RegExp(`'${template}'`));
  for (const stage of execution.ROUTE_NON_SKIPPABLE) assert.match(migration, new RegExp(`'${stage}'`));
  assert.match(migration, /v_stage in \('order_confirmed','packing','dispatched','closed'\)/);
  for (const kind of Object.keys(execution.GATE_KINDS)) assert.match(migration, new RegExp(`'${kind}'`));
  for (const view of Object.keys(execution.EXECUTION_VIEWS)) assert.match(migration, new RegExp(`'${view}'`));
});

test("roles: viewers and dealers never act, supervisors are separated from the floor, contact numbers follow dispatch and sales", () => {
  const { canReadExecution, canUseExecutionAction, EXECUTION_ROLES, CONTACT_ROLES } = execution;
  for (const action of schema._def.schema.options.map(option => option.shape.action.value)) {
    assert.equal(canUseExecutionAction("viewer", action), false, `viewer ${action}`);
    assert.equal(canUseExecutionAction("dealer_admin", action), false);
    assert.equal(canUseExecutionAction("accounts", action) && !action.startsWith("message."), false, `accounts only prepares messages: ${action}`);
  }
  assert.equal(canReadExecution("dealer_staff"), false);
  assert.equal(canReadExecution("production", "queue"), false);
  assert.equal(canReadExecution("production", "assignments"), false, "individual availability and workload stay with supervisors");
  assert.equal(canReadExecution("production", "gate_passes"), true);
  assert.equal(canUseExecutionAction("production", "gatepass.issue"), false);
  assert.equal(canUseExecutionAction("quality", "gatepass.return"), true);
  assert.equal(canUseExecutionAction("quality", "gatepass.depart"), false);
  assert.equal(canUseExecutionAction("production_manager", "window.approve"), true);
  assert.equal(canUseExecutionAction("sales_manager", "window.approve"), false);
  assert.equal(canUseExecutionAction("sales", "message.prepare"), true);
  assert.equal(canUseExecutionAction("production", "message.prepare"), false);
  assert.deepEqual(EXECUTION_ROLES.filter(role => !CONTACT_ROLES.includes(role) && canReadExecution(role, "appointments")).sort(), ["inventory_manager", "production_manager", "viewer"]);
});

test("status labels, the IST conversion and the recovery key are stable", () => {
  assert.equal(execution.executionStatusLabel("outcome_due"), "Slot has passed; record the outcome");
  assert.equal(execution.executionStatusLabel("some_new_state"), "some new state");
  assert.equal(execution.istInstant("2026-11-06T09:30"), "2026-11-06T09:30:00+05:30");
  assert.equal(execution.istInstant("2026-11-06T09:30:15"), "2026-11-06T09:30:15+05:30");
  assert.equal(execution.executionRecoveryKey("c", "u"), "extrusionos:execution:v1:c:u");
});

// Forms -------------------------------------------------------------------------------------------
test("forms convert times to IST, checkboxes to arrays and yes/no to booleans, and omit blank optional fields", () => {
  const stages = form.buildExecutionMutation("route.define", [
    { key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "applies_when", label: "When", type: "note" }, { key: "required_stages", label: "Req", type: "multi" },
    { key: "optional_stages", label: "Opt", type: "multi", optional: true }, { key: "note", label: "Note", type: "note" }],
    { code: "stock_sale", name: "Stock sale", applies_when: "Sold from\nfinished stock", required_stages: "order_confirmed,packing,dispatched", optional_stages: "", note: "Agreed with sales" }, {});
  assert.equal(stages.success, true, JSON.stringify(stages.error?.issues));
  assert.deepEqual(stages.data.required_stages, ["order_confirmed", "packing", "dispatched"]);
  assert.equal("optional_stages" in stages.data, false);
  assert.equal(stages.data.applies_when, "Sold from finished stock");
  const slot = form.buildExecutionMutation("appointment.request", [
    { key: "order_id", label: "Order", lookup: "orders" }, { key: "requested_start", label: "Start", type: "datetime" }, { key: "requested_end", label: "End", type: "datetime" }, { key: "owner_id", label: "Owner", lookup: "employees" },
    { key: "contact_phone", label: "Phone", type: "phone", optional: true }, { key: "note", label: "Note", type: "note" }],
    { order_id: id(1), requested_start: "2026-11-06T09:00", requested_end: "2026-11-06T11:00", owner_id: id(2), contact_phone: "", note }, {});
  assert.equal(slot.success, true, JSON.stringify(slot.error?.issues));
  assert.equal(slot.data.requested_start, "2026-11-06T09:00:00+05:30");
  assert.equal("contact_phone" in slot.data, false);
  const windowForm = form.buildExecutionMutation("window.set", [{ key: "horizon_hours", label: "Hours", type: "number" }, { key: "enforce", label: "Mode", type: "bool" }, { key: "note", label: "Note", type: "note" }],
    { horizon_hours: "48", enforce: "yes", note }, {});
  assert.equal(windowForm.data.enforce, true);
  assert.equal(windowForm.data.horizon_hours, 48);
  assert.equal(form.buildExecutionMutation("window.set", [{ key: "horizon_hours", label: "Hours", type: "number" }, { key: "enforce", label: "Mode", type: "bool" }, { key: "note", label: "Note", type: "note" }], { horizon_hours: "", enforce: "no", note }, {}).success, false);
  const messageFields = [{ key: "template", label: "T" }, { key: "entity_id", label: "E", lookupBy: { key: "template", kinds: { order_confirmation: "orders", dispatch_notice: "dispatches" } } }];
  assert.equal(form.executionLookupKind(messageFields[1], { template: "dispatch_notice" }, {}), "dispatches");
  assert.equal(form.executionLookupKind(messageFields[1], {}, {}), undefined);
  const dieField = { key: "die_id", label: "Die", lookup: "dies", when: { item_kind: ["die"] } };
  assert.equal(form.executionFieldVisible(dieField, { item_kind: "pallet" }, {}), false);
  assert.equal(form.executionFieldVisible(dieField, { item_kind: "die" }, {}), true);
  const mark = form.buildExecutionMutation("message.mark", [{ key: "state", label: "S" }, { key: "note", label: "Note", type: "note" }], { state: "copied", note: "ignored" }, { id: id(1) });
  assert.deepEqual(mark.data, { action: "message.mark", id: id(1), state: "copied" }, "noteless actions never send a note");
});

// Progress strip ----------------------------------------------------------------------------------
test("NOV-087: the strip shows state, evidence, quantities in kilograms and missing evidence, and never a percentage", () => {
  const stage = (stage, label, state, extra = {}) => ({ stage, label, state, reason: null, applicable: true, optional: false, evidence: null, reopened: false, planned_date: null, quantity: null, href: null, ...extra });
  const stages = ["order_confirmed", "die_ready", "billet_ready", "billet_heating", "extrusion_planned", "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing", "packing", "dispatched", "delivered", "payment_pending", "closed"].map(key => stage(key, execution.STAGES[key], "upcoming"));
  const set = (key, patch) => Object.assign(stages.find(item => item.stage === key), patch);
  set("order_confirmed", { state: "complete", evidence: { changed_at: "2026-11-01T05:00:00Z", by: "Asha" } });
  set("die_ready", { state: "unavailable", reason: "Passed without a recorded stage change" });
  set("extruded", { state: "blocked", quantity: { produced_kg: 1200, planned_kg: 2000, jobs: 3, jobs_completed: 1 }, href: "/production/abc", reopened: true });
  set("aging", { state: "skipped_by_policy", reason: "Not part of the approved route Custom extrusion (v2)", applicable: false });
  set("finishing", { optional: true });
  set("dispatched", { quantity: { dispatched_kg: 500, delivered_kg: 0, ordered_kg: 1600 } });
  const progress = { order_id: id(1), order_number: "SO-1", current_stage: "extruded", cancelled: false, route: { code: "custom", name: "Custom extrusion", version: 2 }, stages, blockers: ["Production job J-1 is on hold: die damage"], reopened: true, errors: {}, as_of: "2026-11-05T10:00:00Z" };
  assert.equal(execution.orderProgressSchema.safeParse(progress).success, true);
  const html = renderToStaticMarkup(React.createElement(strip.ProgressStripView, { progress }));
  assert.match(html, /Now: Extruded \(blocked\)\./);
  assert.match(html, /Evidence unavailable/);
  assert.match(html, /Passed without a recorded stage change/);
  assert.match(html, /1,200 of 2,000 kg planned, 1 of 3 job\(s\) finished/);
  assert.match(html, /500 kg dispatched of 1,600 kg ordered/);
  assert.match(html, /Route: Custom extrusion v2/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /href="\/production\/abc"/);
  assert.match(html, /Finishing \(optional\)/);
  assert.match(html, /reopened/);
  assert.doesNotMatch(html, /\d\s?%/, "no percentage is ever computed from stage labels");
  assert.equal(execution.orderProgressSchema.safeParse({ ...progress, stages: stages.slice(1) }).success, false, "a strip always has all sixteen stages");
  const failing = renderToStaticMarkup(React.createElement(strip.ProgressStripView, { progress: { ...progress, errors: { production: true }, cancelled: true } }));
  assert.match(failing, /This order was cancelled\./);
  assert.match(failing, /could not be read/);
});

// Server actions ----------------------------------------------------------------------------------
test("execution server action keeps unsafe database text private, reports a missing upgrade and never reaches the database for refused requests", async () => {
  const f = createNov7ActionsFixture("../../lib/actions/execution.ts");
  const list = { rows: [], total_count: 0, as_of: new Date().toISOString() };
  f.state.rpcHandler = () => ({ data: list, error: null });
  assert.deepEqual((await f.actions.executionAction({ command: "list", view: "appointments" })).data, list);
  f.state.rpcHandler = () => ({ data: null, error: { code: "PGRST202", message: "function missing" } });
  const missing = await f.actions.executionAction({ command: "list", view: "wip" });
  assert.equal(missing.unavailable, true); assert.match(missing.error, /batch 8 database upgrade/);
  f.state.rpcHandler = () => ({ data: null, error: { code: "P0001", message: "NOV: The appointment is unavailable." } });
  assert.equal((await f.actions.executionAction({ command: "detail", view: "appointments", id: n7(1) })).error, "The appointment is unavailable.");
  f.state.rpcHandler = () => ({ data: null, error: { code: "XX000", message: "internal relation private.secret" } });
  assert.doesNotMatch((await f.actions.executionAction({ command: "list", view: "loads" })).error, /secret|relation/);
  f.state.context.role = "production";
  const calls = f.state.calls.length;
  assert.match((await f.actions.executionAction({ command: "list", view: "queue" })).error, /not permitted/);
  assert.match((await f.actions.executionAction({ command: "preview", request_id: n7(2), mutation: { action: "gatepass.issue", item_kind: "pallet", item_label: "Pallets", quantity: 4, custodian_name: "Finisher", custodian_kind: "vendor", purpose: "Anodising carriers", due_date: "2026-11-20", owner_id: n7(3), note } })).error, /not permitted/);
  f.state.context.role = "viewer";
  assert.match((await f.actions.executionAction({ command: "preview", request_id: n7(2), mutation: { action: "appointment.cancel", id: n7(4), note } })).error, /not permitted/);
  f.state.context.role = "owner"; f.state.context.dealerId = n7(9);
  assert.match((await f.actions.executionAction({ command: "list", view: "appointments" })).error, /not permitted/);
  f.state.context.dealerId = null;
  assert.equal(f.state.calls.length, calls, "refused requests never reach the database");
  assert.match((await f.actions.executionAction({ command: "preview", request_id: "x", mutation: {} })).error, /Choose a record|Invalid|Required|match/i);
  f.state.rpcHandler = () => { throw Error("Transport lost"); };
  assert.equal((await f.actions.executionAction({ command: "commit", request_id: n7(2), fingerprint: "a".repeat(32) })).uncertain, true);
  assert.equal((await f.actions.executionAction({ command: "list", view: "appointments" })).uncertain, false);
});

test("order progress action reads through the database function and reports a failed read without guessing", async () => {
  const f = createNov7ActionsFixture("../../lib/actions/execution.ts");
  f.state.rpcHandler = () => ({ data: null, error: { code: "XX000", message: "relation private.secret missing" } });
  const failed = await f.actions.orderProgressAction(n7(1));
  assert.equal(failed.success, false); assert.doesNotMatch(failed.error, /secret|relation/);
  f.state.rpcHandler = () => ({ data: { not: "progress" }, error: null });
  assert.equal((await f.actions.orderProgressAction(n7(1))).success, false, "malformed data is not shown");
  f.state.rpcHandler = () => ({ data: null, error: { code: "42501", message: "Not permitted" } });
  assert.match((await f.actions.orderProgressAction(n7(1))).error, /not available/);
  f.state.context.dealerId = n7(9);
  const calls = f.state.calls.length;
  assert.match((await f.actions.orderProgressAction(n7(1))).error, /not available/);
  assert.equal(f.state.calls.length, calls);
});

// Migration and screen guards ---------------------------------------------------------------------
test("the migration is additive, tenant-scoped, RLS-protected and keeps every function pinned and private", () => {
  assert.doesNotMatch(migration, /drop\s+(table|column|schema)|truncate|delete\s+from\s+public\./i, "additive only");
  assert.doesNotMatch(migration, /disable row level security/i);
  const tables = [...migration.matchAll(/create table public\.(\w+)/g)].map(match => match[1]);
  assert.equal(tables.length, 20);
  for (const table of tables) {
    assert.match(migration, new RegExp(`'${table}'`), `${table} enables RLS`);
    const body = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(migration)?.[1] ?? "";
    assert.match(body, /company_id uuid not null references public\.companies\(id\)/, `${table} is tenant-scoped`);
  }
  assert.match(migration, /revoke all on public\.%I from public,anon,authenticated/);
  assert.equal([...migration.matchAll(/grant select on public\.(\w+)/g)].map(match => match[1]).join(), "execution_requests", "only a person's own request is directly readable");
  assert.match(migration, /grant execute on function public\.execution_command\(text,jsonb\) to authenticated/);
  assert.match(migration, /grant execute on function public\.order_progress\(uuid\) to authenticated/);
  const functions = [...migration.matchAll(/create function ([\w.]+)\(([\s\S]*?)\bas \$\$/g)];
  assert.equal(functions.length, 40);
  for (const [, name, head] of functions) assert.match(head, /search_path/, `${name} pins search_path`);
  for (const [, name] of functions) {
    if (name.startsWith("private.") && name !== "private.execution_view" && !/execution_(read|action)_allowed/.test(name)) {
      assert.match(migration, new RegExp(`revoke all on function[^;]*${name.replace(".", "\\.")}\\(`), `${name} is not executable by clients`);
    }
  }
  assert.doesNotMatch(migration, /company_id\s*:=\s*\(p_/, "company never comes from a payload");
  assert.match(migration, /current_setting\('app\.execution_window_apply',true\)=old\.id::text/, "enforcement is bypassed only for the one reviewed job");
});

test("screens: the hub is guarded, the order page shows progress, the layout links the hub and nothing imports a privileged client", () => {
  const layout = read("app/(dashboard)/tasks/execution/layout.tsx");
  assert.match(layout, /context\.dealerId \|\| !canReadExecution/);
  assert.match(read("app/(dashboard)/tasks/layout.tsx"), /Execution planning/);
  assert.match(read("app/(dashboard)/orders/[id]/page.tsx"), /<OrderProgressStrip orderId=\{order\.id\} \/>/);
  assert.match(read("components/modules/operations/record-form-client.tsx"), /<DieCustodyNote dieId=/);
  for (const file of ["lib/actions/execution.ts", "components/modules/execution/record.tsx", "components/modules/execution/queue-panel.tsx", "components/modules/execution/progress-strip.tsx", "components/modules/execution/message-tools.tsx"]) {
    assert.doesNotMatch(read(file), /SERVICE_ROLE|service_role|createAdminClient/, `${file} uses no privileged client`);
  }
  const database = read("app/(dashboard)/tasks/execution/database/page.tsx");
  assert.match(database, /command: "list", view, page/, "lists are paginated on the server");
  assert.match(database, /Ten records per page/);
  const messageTools = read("components/modules/execution/message-tools.tsx");
  assert.doesNotMatch(messageTools, /\bsent\b.*\bdelivered\b.*\bread\b.*\btracked\b|Message sent|has been sent/i, "no false delivery claim");
  assert.match(read("lib/workflow/execution.ts"), /Preparation is recorded; sending is not tracked/);
});
