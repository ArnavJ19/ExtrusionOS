import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fc from "fast-check";
import { LIFECYCLE_VIEWS, lifecycleCommandSchema, lifecycleMutationSchema, lifecycleMutationView, canReadLifecycle, canUseLifecycleAction, lifecycleStatusLabel } from "../lib/workflow/lifecycle.ts";
import { createNov6ActionsFixture, nov6Outcome } from "../scripts/lib/nov-batch6-actions-fixture.mjs";
import { nids as i, nid } from "../scripts/lib/nov-batch6-fixture.mjs";

const require = createRequire(import.meta.url); require("tsx/cjs");
const { buildLifecycleMutation } = require("../lib/workflow/lifecycle-form.ts");
const { applyVisibleDefaults, resolveVisibleDefault, isDefaultableField, systemDateDefaults, personalDefaultKey, personalDefaultKeys, defaultOriginText } = require("../lib/forms/visible-defaults.ts");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { PageHeader } = require("../components/layout/page-header.tsx");
const { DataTable } = require("../components/data/data-table.tsx");
const f = createNov6ActionsFixture();
test.beforeEach(() => f.reset());
const note = "Reviewed with the responsible department";
const journey = () => ({ action: "journey.open", order_id: i.orderC, title: "SO-NOV6-C walk-through", participants: "Sales and dispatch", baseline_from: "2026-10-01", baseline_to: "2026-10-31", note });
const preview = () => ({ command: "preview", request_id: nid(1000), mutation: journey() });
const ok = value => lifecycleMutationSchema.safeParse(value).success;

test("input contracts reject injected identity, unknown actions and inconsistent details", () => {
  assert.equal(lifecycleCommandSchema.safeParse({ ...preview(), company_id: i.foreignCompany }).success, false);
  assert.equal(lifecycleCommandSchema.safeParse({ ...preview(), mutation: { ...journey(), actor_id: i.foreign } }).success, false);
  assert.equal(ok({ action: "order.delete", note }), false);
  assert.equal(ok({ ...journey(), baseline_to: "2026-09-30" }), false, "a baseline ends after it starts");
  assert.equal(ok({ ...journey(), note: "Bad\u0007note" }), false);
  assert.equal(ok({ action: "closure.carry", order_id: i.orderC, item_key: `job:${i.job1}`, note }), false, "only returns, exceptions and changes are carriable");
  assert.equal(ok({ action: "closure.carry", order_id: i.orderC, item_key: `exception:${i.job1}`, note }), true);
  const tranche = (date, kg) => ({ date, kg });
  assert.equal(ok({ action: "promise.propose", order_id: i.orderP, tranches: [tranche("2026-11-10", 100), tranche("2026-11-09", 100)], note }), false);
  assert.equal(ok({ action: "promise.propose", order_id: i.orderP, tranches: [], note }), false);
  assert.equal(ok({ action: "promise.propose", order_id: i.orderP, tranches: Array.from({ length: 5 }, (_, n) => tranche(`2026-11-1${n}`, 10)), note }), false);
  assert.equal(ok({ action: "promise.propose", order_id: i.orderP, tranches: [tranche("2026-11-10", 0.0001)], note }), false);
  const output = (bundle_number, pieces, kg) => ({ bundle_number, pieces, kg });
  assert.equal(ok({ action: "bundle.split", stock_batch_id: i.stock2, outputs: [output("A1", 1, 1), output("a1", 1, 1)], note }), false, "tags are compared in upper case");
  assert.equal(ok({ action: "bundle.split", stock_batch_id: i.stock2, outputs: [output("A1", 1, 1)], note }), false, "a split makes at least two bundles");
  assert.equal(ok({ action: "bundle.split", stock_batch_id: i.stock2, outputs: [output("A 1", 1, 1), output("A2", 1, 1)], note }), false);
  assert.equal(ok({ action: "bundle.merge", stock_batch_ids: [i.stock1, i.stock1], bundle_number: "M1", output_kg: 1, note }), false);
  assert.equal(ok({ action: "template.create", scope: "company", customer_id: i.customer, instructions: "Wrap well", spacer_required: false, label_fields: ["bundle_number"], note }), false);
  assert.equal(ok({ action: "template.create", scope: "customer", instructions: "Wrap well", spacer_required: false, label_fields: ["bundle_number"], note }), false);
  assert.equal(ok({ action: "template.create", scope: "company", instructions: "Wrap well", spacer_required: false, label_fields: ["unit_rate"], note }), false, "prices are not label fields");
  assert.equal(ok({ action: "template.create", scope: "company", instructions: "Wrap well", spacer_required: false, label_fields: ["pieces", "pieces"], note }), false);
  assert.equal(ok({ action: "sample.decide", id: i.order, decision: "conditional", evidence: "Customer email", note }), false, "a conditional approval states its kg");
  assert.equal(ok({ action: "sample.decide", id: i.order, decision: "approved", evidence: "Customer email", limit_kg: 10, note }), false);
  assert.equal(ok({ action: "sample.record", id: i.order, event: "produced", evidence: "Cut first piece", note }), false, "a produced sample names job, tag and location");
  assert.equal(ok({ action: "sample.record", id: i.order, event: "measured", evidence: "Vernier", recipient: "Buyer", note }), false);
  assert.equal(ok({ action: "trace.link", from_type: "production_job", from_id: i.job1, to_type: "production_job", to_id: i.job2, evidence: "Issue slip", note }), false);
  assert.equal(ok({ action: "trace.link", from_type: "foundry_billet", from_id: i.billet, to_type: "stock_batch", to_id: i.stock1, evidence: "Issue slip", note }), false);
  assert.equal(ok({ action: "journey.measure", id: i.order, phase: "baseline", metric: "Quote Days", value: 1, unit: "days", sample_size: 1, limitations: "One order only", note }), false);
});

test("role mirrors cover every view and action, and dealers or unknown roles are refused", () => {
  for (const role of ["dealer_admin", "dealer_staff", "superuser"]) assert.equal(canReadLifecycle(role), false, role);
  assert.equal(canReadLifecycle("production", "closure"), false); assert.equal(canReadLifecycle("dispatch", "promises"), false); assert.equal(canReadLifecycle("viewer", "trace"), true);
  assert.equal(canUseLifecycleAction("viewer", "journey.annotate"), false); assert.equal(canUseLifecycleAction("sales", "promise.accept"), false); assert.equal(canUseLifecycleAction("sales_manager", "promise.accept"), true);
  assert.equal(canUseLifecycleAction("sales_manager", "closure.reopen"), false); assert.equal(canUseLifecycleAction("dispatch", "label.pack"), true); assert.equal(canUseLifecycleAction("quality", "label.pack"), false);
  assert.equal(canUseLifecycleAction("inventory_manager", "bundle.reverse"), true); assert.equal(canUseLifecycleAction("dispatch_manager", "bundle.reverse"), false);
  assert.equal(lifecycleMutationView("bundle.merge"), "bundles"); assert.equal(lifecycleMutationView("label.reprint"), "labels"); assert.equal(lifecycleMutationView("sample.decide"), "samples");
  for (const view of Object.keys(LIFECYCLE_VIEWS)) assert.equal(canReadLifecycle("owner", view), true);
  assert.equal(lifecycleStatusLabel("relabel_needed"), "Reprint on current template"); assert.equal(lifecycleStatusLabel("some_new_state"), "some new state");
});

test("form building omits blank optional values and rows, hides choice-specific fields and keeps lists typed", () => {
  const promise = buildLifecycleMutation("promise.propose", [{ key: "tranches", label: "T", type: "tranches" }, { key: "note", label: "N", type: "note" }],
    { "tranche:0:date": "2026-11-10", "tranche:0:kg": "1000", "tranche:1:date": "", "tranche:1:kg": "", "tranche:2:date": "2026-11-20", "tranche:2:kg": "1000", note }, { order_id: i.orderP });
  assert.equal(promise.success, true); assert.deepEqual(promise.data.tranches, [{ date: "2026-11-10", kg: 1000 }, { date: "2026-11-20", kg: 1000 }]);
  const missingKg = buildLifecycleMutation("promise.propose", [{ key: "tranches", label: "T", type: "tranches" }, { key: "note", label: "N", type: "note" }], { "tranche:0:date": "2026-11-10", note }, { order_id: i.orderP });
  assert.equal(missingKg.success, false, "a blank kg is not zero");
  const split = buildLifecycleMutation("bundle.split", [{ key: "stock_batch_id", label: "S" }, { key: "outputs", label: "O", type: "outputs" }, { key: "variance_reason", label: "V", optional: true }, { key: "note", label: "N", type: "note" }],
    { stock_batch_id: i.stock2, "output:0:bundle_number": "s2-a", "output:0:pieces": "8", "output:0:kg": "57.6", "output:1:bundle_number": "S2-B", "output:1:pieces": "12", "output:1:kg": "86.4", variance_reason: " ", note }, {});
  assert.equal(split.success, true); assert.equal(split.data.outputs[0].bundle_number, "S2-A"); assert.equal("variance_reason" in split.data, false);
  const merge = buildLifecycleMutation("bundle.merge", [{ key: "stock_batch_ids", label: "S", type: "stock_list" }, { key: "bundle_number", label: "B", upper: true }, { key: "output_kg", label: "K", type: "number" }, { key: "note", label: "N", type: "note" }],
    { "stock:0": i.stock1, "stock:1": "", "stock:2": i.stock3, bundle_number: "m-1", output_kg: "108", note }, {});
  assert.equal(merge.success, true); assert.deepEqual(merge.data.stock_batch_ids, [i.stock1, i.stock3]); assert.equal(merge.data.bundle_number, "M-1");
  const fields = [{ key: "event", label: "E" }, { key: "job_id", label: "J", when: { event: ["produced"] } }, { key: "sample_tag", label: "T", when: { event: ["produced"] } }, { key: "location", label: "L", when: { event: ["produced"] } },
    { key: "recipient", label: "R", when: { event: ["sent"] } }, { key: "expected_response", label: "D", type: "date", when: { event: ["sent"] } }, { key: "evidence", label: "Ev", type: "note" }, { key: "note", label: "N", type: "note" }];
  const measured = buildLifecycleMutation("sample.record", fields, { job_id: i.job1, recipient: "Stale entry", evidence: "Vernier readings", note }, { id: i.order, event: "measured" });
  assert.equal(measured.success, true, JSON.stringify(measured.error?.issues)); assert.equal("job_id" in measured.data, false); assert.equal("recipient" in measured.data, false);
  const labels = buildLifecycleMutation("template.create", [{ key: "scope", label: "S" }, { key: "instructions", label: "I", type: "note" }, { key: "spacer_required", label: "Sp", type: "boolean" }, { key: "label_fields", label: "L", type: "label_fields" }, { key: "note", label: "N", type: "note" }],
    { scope: "company", instructions: "Wrap in film", spacer_required: "false", "label:pieces": "true", "label:bundle_number": "true", "label:net_kg": "", note }, {});
  assert.equal(labels.success, true); assert.deepEqual(labels.data.label_fields, ["bundle_number", "pieces"]); assert.equal(labels.data.spacer_required, false);
  fc.assert(fc.property(fc.double({ min: 0.001, max: 1e6, noNaN: true }), kg => {
    const result = buildLifecycleMutation("promise.propose", [{ key: "tranches", label: "T", type: "tranches" }, { key: "note", label: "N", type: "note" }], { "tranche:0:date": "2026-11-10", "tranche:0:kg": String(kg), note }, { order_id: i.orderP });
    assert.equal(result.success, Math.abs(kg * 1000 - Math.round(kg * 1000)) < 1e-6);
  }), { numRuns: 150 });
});

test("NOV-008: visible defaults follow precedence, keep overrides and never default measurements, prices or approvals", () => {
  for (const name of ["planned_quantity_kg", "length_per_piece_m", "unit_rate", "grand_total", "approval_status", "quality_result", "pieces", "wall_thickness"]) assert.equal(isDefaultableField(name), false, name);
  for (const name of ["machine_id", "shift", "transporter_name", "dispatch_date", "planned_date"]) assert.equal(isDefaultableField(name), true, name);
  const winner = resolveVisibleDefault("machine_id", [{ tier: "system", value: "x", sourceId: "s", label: "system" }, { tier: "personal", value: "p", sourceId: "p", label: "press" },
    { tier: "company", value: "", sourceId: "c", label: "company" }, { tier: "source", value: "o", sourceId: "o", label: "order" }]);
  assert.equal(winner.tier, "source"); assert.equal(resolveVisibleDefault("unit_rate", [{ tier: "personal", value: 210, sourceId: "p", label: "rate" }]), null);
  const now = "2026-11-04T05:00:00.000Z";
  const system = applyVisibleDefaults({}, {}, "system", { dispatch_date: "2026-11-04" }, { id: "system:date", label: "today's business date (IST)" }, now);
  assert.equal(system.values.dispatch_date, "2026-11-04"); assert.equal(system.provenance.dispatch_date.tier, "system");
  assert.equal(defaultOriginText("system", "today's business date (IST)"), "Suggested: today's business date (IST)"); assert.equal(defaultOriginText("personal", "press"), "Your usual press");
  const source = { machine_id: { kind: "source", sourceId: "order", sourceLabel: "order", refreshedAt: now, suggested: "order-press", overridden: false } };
  const kept = applyVisibleDefaults({ machine_id: "order-press" }, source, "personal", { machine_id: "my-press" }, { id: "personal:machine_id", label: "press" }, now);
  assert.equal(kept.values.machine_id, "order-press", "a personal default never displaces a source value");
  const overridden = { shift: { kind: "default", tier: "personal", sourceId: "personal:shift", sourceLabel: "shift", refreshedAt: now, suggested: "Day", overridden: true } };
  assert.equal(applyVisibleDefaults({ shift: "Night" }, overridden, "personal", { shift: "Day" }, { id: "personal:shift", label: "shift" }, now).values.shift, "Night", "a deliberate override stays");
  assert.equal(applyVisibleDefaults({ shift: "Typed" }, {}, "personal", { shift: "Day" }, { id: "personal:shift", label: "shift" }, now).values.shift, "Typed", "a typed value stays");
  const higher = applyVisibleDefaults({ shift: "Day" }, { shift: { kind: "default", tier: "personal", sourceId: "personal:shift", sourceLabel: "shift", refreshedAt: now, suggested: "Day", overridden: false } }, "company", { shift: "General" }, { id: "company:shift", label: "shift" }, now);
  assert.equal(higher.values.shift, "General", "a company default outranks a personal one");
  const incompatible = applyVisibleDefaults({}, {}, "personal", { machine_id: "retired" }, { id: "personal:machine_id", label: "press" }, now, () => false);
  assert.equal("machine_id" in incompatible.values, false);
  assert.deepEqual(systemDateDefaults([{ name: "dispatch_date", type: "date" }, { name: "due_date", type: "date" }, { name: "remarks" }], { dispatch_date: "2026-01-01", due_date: "" }, "2026-11-04"), { dispatch_date: "2026-11-04" });
  assert.equal(personalDefaultKey("production", "machine_id"), "production.machine_id"); assert.equal(personalDefaultKey("orders", "machine_id"), null);
  assert.deepEqual(personalDefaultKeys("dispatches"), ["dispatches.transporter_name"]);
});

test("NOV-081: the compact header keeps one heading and actions but drops the product eyebrow", () => {
  const compact = renderToStaticMarkup(React.createElement(PageHeader, { title: "Bundle labels", description: "Ten records per page", density: "compact", actions: React.createElement("a", { href: "/x" }, "Back") }));
  const standard = renderToStaticMarkup(React.createElement(PageHeader, { title: "Bundle labels" }));
  assert.equal((compact.match(/<h1/g) ?? []).length, 1); assert.doesNotMatch(compact, /ExtrusionOS Pro/); assert.match(compact, /text-2xl/); assert.match(compact, /mb-4/); assert.match(compact, /href="\/x"/);
  assert.match(standard, /ExtrusionOS Pro/); assert.match(standard, /text-3xl/);
  assert.match(renderToStaticMarkup(React.createElement(PageHeader, { title: "Detail", density: "compact", backHref: "/tasks" })), /Back to overview/);
});

test("NOV-090: table headings stay visible and the identifier column stays fixed while scrolling", () => {
  const html = renderToStaticMarkup(React.createElement(DataTable, { rows: [{ id: "1", code: "DIE-1", status: "active" }], getRowId: row => row.id, emptyTitle: "None", emptyDescription: "None",
    columns: [{ id: "code", header: "Die Number", sticky: true, sortable: false, accessor: row => row.code }, { id: "status", header: "Status", accessor: row => row.status }] }));
  assert.match(html, /max-h-\[70vh\] overflow-auto/);
  const headers = [...html.matchAll(/<th [^>]*class="([^"]*)"[^>]*>/g)].map(match => match[1]);
  assert.equal(headers.length, 2); for (const header of headers) assert.match(header, /sticky top-0/);
  assert.match(headers[0], /left-0 z-40/); assert.doesNotMatch(headers[1], /left-0/);
  assert.match(html, /<td class="[^"]*sticky left-0 z-10[^"]*bg-white/); assert.equal((html.match(/scope="col"/g) ?? []).length, 2);
});

test("server action: dealers, unpermitted previews and malformed input never reach the database", async () => {
  f.state.context = { ...f.state.context, dealerId: i.customer, role: "dealer_admin" };
  assert.equal((await f.action(preview())).success, false);
  f.reset(); f.state.context = { ...f.state.context, role: "dispatch" };
  assert.equal((await f.action(preview())).success, false);
  assert.equal((await f.action({ command: "list", view: "promises" })).success, false);
  f.reset();
  assert.equal((await f.action({ ...preview(), mutation: { ...journey(), baseline_from: "yesterday" } })).success, false);
  assert.equal(f.state.calls.length, 0);
  const result = await f.action(preview());
  assert.equal(result.success, true); assert.deepEqual(f.state.calls[0], { name: "lifecycle_command", payload: { p_command: "preview", p_payload: { request_id: nid(1000), mutation: journey() } } });
});

test("server action: database errors map to safe messages and uncertain finalizing outcomes", async () => {
  f.state.error = { code: "P0001", message: "NOV: A baseline period describes past work; it cannot end in the future." };
  assert.deepEqual(await f.action(preview()), { success: false, error: "A baseline period describes past work; it cannot end in the future." });
  f.state.error = { code: "P0001", message: "internal detail leaked" };
  const hidden = await f.action(preview());
  assert.equal(hidden.success, false); assert.equal(hidden.uncertain, true); assert.doesNotMatch(hidden.error, /internal detail/);
  f.state.error = { code: "PGRST202", message: "missing" };
  const unavailable = await f.action({ command: "list", view: "journeys" });
  assert.equal(unavailable.unavailable, true); assert.match(unavailable.error, /November batch 6 database upgrade/);
  f.state.error = { code: "42501", message: "Not permitted" };
  assert.match((await f.action({ command: "list", view: "journeys" })).error, /not available/);
  f.reset(); f.state.throws = true;
  const commit = await f.action({ command: "commit", request_id: nid(1000), fingerprint: "a".repeat(32) });
  assert.equal(commit.success, false); assert.equal(commit.uncertain, true);
  f.reset(); f.state.malformed = true;
  assert.equal((await f.action(preview())).success, false, "an unexpected response shape is not treated as success");
  f.reset(); f.state.revalidateThrows = true; f.state.response = nov6Outcome({ state: "confirmed", result: { label: "Journey review started", href: "/tasks/lifecycle/journeys/x", message: "Walk the journey." } });
  assert.equal((await f.action({ command: "commit", request_id: nid(1000), fingerprint: "a".repeat(32) })).success, true, "cache refresh failure does not hide a confirmed outcome");
});
