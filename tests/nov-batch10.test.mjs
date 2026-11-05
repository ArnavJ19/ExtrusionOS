import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url); require("tsx/cjs");
const { SPECIALIST_CREATES, SPECIALIST_VIEWS, SPECIALIST_STATUS, canReadSpecialist, canUseSpecialistAction, normalizeRegistration, specialistCommandSchema, specialistMutationSchema, specialistMutationView,
  specialistStatusLabel, NOTELESS_ACTIONS } = require("../lib/workflow/specialist.ts");
const { buildSpecialistMutation, parseRows, specialistFieldVisible } = require("../lib/workflow/specialist-form.ts");

const id = "be500000-0000-4000-8000-000000000001";
const id2 = "be500000-0000-4000-8000-000000000002";
const note = "Reviewed with the responsible department";
const ok = value => { const result = specialistMutationSchema.safeParse(value); assert.equal(result.success, true, JSON.stringify(result.error?.issues)); return result.data; };
const bad = (value, pattern) => { const result = specialistMutationSchema.safeParse(value); assert.equal(result.success, false, "expected refusal"); assert.match(result.error.issues.map(issue => issue.message).join(" | "), pattern); };

test("every view has a description, a create action the role can use, and statuses with labels", () => {
  for (const view of Object.keys(SPECIALIST_VIEWS)) {
    assert.ok(SPECIALIST_CREATES[view]?.length, view);
    for (const action of SPECIALIST_CREATES[view]) assert.equal(specialistMutationView(action), view, `${action} belongs to ${view}`);
  }
  assert.equal(specialistStatusLabel("simulated"), "Simulation only: nothing executed");
  assert.equal(specialistStatusLabel("open", "weighing"), "Open; readings being recorded");
  assert.equal(specialistStatusLabel("unknown_status"), "unknown status");
  for (const status of ["needs_resolution", "overdue", "mixed_reference", "in_transit", "interrupted", "unexplained_difference", "paired", "nothing_due"]) assert.ok(SPECIALIST_STATUS[status], status);
  assert.equal(canReadSpecialist("dealer_admin"), false);
  assert.equal(canUseSpecialistAction("viewer", "weigh.read"), false);
  assert.equal(canReadSpecialist("viewer", "weighing"), true);
  assert.equal(canUseSpecialistAction("sales", "tooling.allocate"), false);
  assert.equal(canUseSpecialistAction("accounts", "automation.simulate"), true);
  assert.equal(canUseSpecialistAction("accounts", "automation.execute"), false);
  assert.equal(canUseSpecialistAction("quality", "toll.inspect"), true);
  assert.equal(canUseSpecialistAction("inventory_manager", "toll.inspect"), false);
});

test("schemas refuse inconsistent combinations before a request is sent", () => {
  ok({ action: "intake.resolve", line_id: id, decision: "not_a_line", note });
  bad({ action: "intake.resolve", line_id: id, decision: "not_a_line", quantity: 5, note }, /not an order line has no values/);
  bad({ action: "automation.define", rule_code: "q_rule", name: "Quote rule", trigger_kind: "quote_expiring", min_days: 3, min_amount: 5, task_priority: "normal", due_in_days: 1, note }, /Only the overdue invoice trigger/);
  bad({ action: "automation.define", rule_code: "q_rule", name: "Quote rule", trigger_kind: "quote_expiring", min_days: 3.5, task_priority: "normal", due_in_days: 1, note }, /whole number/);
  bad({ action: "lab.request", sample_ref: "S-1", material_kind: "production_job", lab_vendor_id: id, tests: [{ code: "tensile", method: "IS 1608" }], promised_date: "2026-12-01", note }, /Choose the production job/);
  bad({ action: "lab.request", sample_ref: "S-1", material_kind: "other", lab_vendor_id: id, tests: [{ code: "tensile", method: "IS 1608" }, { code: "tensile", method: "ASTM" }], promised_date: "2026-12-01", note }, /Describe the material|listed once/);
  bad({ action: "lab.review", id, decision: "release", retest_promised_date: "2026-12-01", note }, /only a retest has one/);
  bad({ action: "agreement.close", id, carry_forward: true, note }, /needs the new end date/);
  bad({ action: "agreement.define", customer_id: id, customer_ref: "B-1", valid_from: "2026-12-01", valid_to: "2026-11-01", overrun_percent: 0, lines: [{ profile_id: id, finish: "mill", agreed_kg: 1, rate_per_kg: 1 }], note }, /cannot end before it starts/);
  bad({ action: "tooling.define", die_id: id, customer_id: id2, owner_party: "customer", die_charge: 100, customer_contribution: 150, waiver_amount: 0, recovery_basis: "none", tax_reference: "GST", terms: "Agreed terms", note }, /cannot exceed the die charge/);
  bad({ action: "tooling.define", die_id: id, customer_id: id2, owner_party: "customer", die_charge: 100, customer_contribution: 50, waiver_amount: 0, recovery_basis: "per_kg", recovery_rate_per_kg: 1, tax_reference: "GST", terms: "Agreed terms", note }, /needs a rate and a cap/);
  bad({ action: "tooling.allocate", id, kind: "recovery", invoice_id: id2, amount: 10, note }, /leave the amount blank/);
  bad({ action: "tooling.allocate", id, kind: "payment", invoice_id: id2, amount: 10, note }, /Link one record of the chosen kind/);
  bad({ action: "transfer.request", to_location_id: id, batch_ids: [id2, id2], planned_date: "2026-12-01", note }, /listed twice/);
  bad({ action: "recipe.define", recipe_code: "age_x", name: "Ageing", process: "artificial_ageing", alloys: ["6063"], target_temper: "T6", temp_min_c: 185, temp_max_c: 175, soak_min_minutes: 1, soak_max_minutes: 2, min_readings: 1, note }, /above the minimum/);
  bad({ action: "treat.create", recipe_id: id, machine_id: id2, inputs: [{ job_id: id, kg: 1 }, { job_id: id, kg: 2 }], load_note: "Two racks" }, /listed twice/);
  bad({ action: "toll.move", customer_id: id, kind: "return_scrap", quantity_kg: 5, receipt_id: id2, note }, /does not name a receipt/);
  bad({ action: "toll.move", customer_id: id, kind: "issue", quantity_kg: 5, receipt_id: id2, note }, /Choose the production job/);
  bad({ action: "weigh.open", movement_kind: "dispatch", purchase_receipt_id: id, vehicle_registration: "MH12AB1234", instrument_ref: "WB-1", calibration_valid_until: "2026-12-01", tolerance_kg: 10, note }, /Choose the dispatch/);
  bad({ action: "weigh.read", id, kind: "gross", weight_value: 10, unit: "kg", read_at: "2026-11-06T10:00:00Z", source: "device", stable: true, vehicle_registration_read: "MH12AB1234" }, /packet reference/);
  bad({ action: "weigh.read", id, kind: "gross", weight_value: 10, unit: "lb", read_at: "2026-11-06T10:00:00Z", source: "manual", stable: true, vehicle_registration_read: "MH12AB1234" }, /Invalid enum value|kg/);
  bad({ action: "weigh.read", id, kind: "gross", weight_value: 10, unit: "kg", read_at: "yesterday", source: "manual", stable: true, vehicle_registration_read: "MH12AB1234" }, /when the reading was taken/);
  bad({ action: "intake.ready", id, note: "ok" }, /at least 5 characters/);
  bad({ action: "intake.ready", id, note: "Has a\u0007 bell" }, /control characters/);
  // A noteless action never carries a note.
  for (const action of NOTELESS_ACTIONS) assert.equal("note" in specialistMutationSchema._def.schema.options.find(option => option.shape.action.value === action).shape, false, action);
  assert.equal(specialistCommandSchema.safeParse({ command: "list", view: "intake", page: 0 }).success, false);
  assert.equal(specialistCommandSchema.safeParse({ command: "lookup", kind: "secrets" }).success, false);
});

test("the form builder keeps lines in pasted text, converts rows, lists, sets and readings, and omits blanks", () => {
  const fields = [{ key: "customer_id", label: "Customer" }, { key: "customer_po_ref", label: "PO" }, { key: "po_date", label: "Date", type: "date", optional: true }, { key: "source_text", label: "Text", type: "multiline" }];
  const intake = buildSpecialistMutation("intake.submit", fields, { customer_id: id, customer_po_ref: " PO-1 ", source_text: "AL-1 10 kg\r\nAL-2 5 pcs" }, {});
  assert.equal(intake.success, true);
  assert.equal(intake.data.source_text, "AL-1 10 kg\nAL-2 5 pcs", "line breaks are preserved for the document");
  assert.equal("po_date" in intake.data, false, "a blank optional date is omitted, not sent as empty");
  const rows = parseRows(JSON.stringify([{ job_id: id, kg: "12.5", label: "ignored" }, { job_id: "", kg: "" }]), [{ key: "job_id", label: "Job" }, { key: "kg", label: "Kg", type: "number" }]);
  assert.deepEqual(rows, [{ job_id: id, kg: 12.5 }, {}]);
  assert.deepEqual(parseRows("not json", []), []);
  const recipe = buildSpecialistMutation("recipe.define", [{ key: "recipe_code", label: "Code" }, { key: "name", label: "Name" }, { key: "process", label: "Process" }, { key: "alloys", label: "Alloys", type: "list" }, { key: "target_temper", label: "Temper" },
    ...["temp_min_c", "temp_max_c", "soak_min_minutes", "soak_max_minutes", "min_readings"].map(key => ({ key, label: key, type: "number" })), { key: "note", label: "Note", type: "note" }],
    { recipe_code: "age_x", name: "Ageing", process: "artificial_ageing", alloys: "6063, 6060 ,", target_temper: "T6", temp_min_c: "175", temp_max_c: "185", soak_min_minutes: "360", soak_max_minutes: "480", min_readings: "3", note: `${note}\nsecond line` }, {});
  assert.equal(recipe.success, true, JSON.stringify(recipe.error?.issues));
  assert.deepEqual(recipe.data.alloys, ["6063", "6060"]);
  assert.equal(recipe.data.note, `${note} second line`, "explanations are joined into one line");
  const transfer = buildSpecialistMutation("transfer.request", [{ key: "to_location_id", label: "To" }, { key: "batch_ids", label: "Bundles", type: "multi" }, { key: "planned_date", label: "Date", type: "date" }, { key: "note", label: "Note", type: "note" }],
    { to_location_id: id, batch_ids: JSON.stringify([id2]), planned_date: "2026-12-01", note }, {});
  assert.deepEqual(transfer.data.batch_ids, [id2]);
  const empty = buildSpecialistMutation("transfer.request", [{ key: "to_location_id", label: "To" }, { key: "batch_ids", label: "Bundles", type: "multi" }, { key: "planned_date", label: "Date", type: "date" }, { key: "note", label: "Note", type: "note" }],
    { to_location_id: id, batch_ids: "[]", planned_date: "2026-12-01", note }, {});
  assert.match(empty.error.issues[0].message, /at least one bundle/);
  const reading = buildSpecialistMutation("weigh.read", [{ key: "kind", label: "Kind" }, { key: "weight_value", label: "Weight", type: "number" }, { key: "unit", label: "Unit" }, { key: "read_at", label: "At", type: "datetime" },
    { key: "source", label: "Source" }, { key: "stable", label: "Stable", type: "bool" }, { key: "vehicle_registration_read", label: "Vehicle" }], { kind: "tare", weight_value: "4.2", unit: "t", read_at: "2026-11-06T09:30", source: "manual", stable: "yes", vehicle_registration_read: "MH12AB1234" }, { id });
  assert.equal(reading.success, true, JSON.stringify(reading.error?.issues));
  assert.equal(reading.data.stable, true); assert.equal(reading.data.read_at, new Date("2026-11-06T09:30").toISOString(), "a local reading time is sent with its offset");
  const close = buildSpecialistMutation("agreement.close", [{ key: "carry_forward", label: "Carry", type: "bool" }, { key: "new_valid_to", label: "To", type: "date", when: { carry_forward: ["yes"] } }, { key: "note", label: "Note", type: "note" }],
    { carry_forward: "no", new_valid_to: "2027-01-01", note }, { id });
  assert.equal(close.success, true); assert.equal("new_valid_to" in close.data, false, "a hidden field is never sent");
  assert.equal(specialistFieldVisible({ key: "x", label: "x", when: { kind: ["issue"] } }, { kind: "scrap" }, {}), false);
  assert.equal(specialistFieldVisible({ key: "x", label: "x", when: { kind: ["issue"] } }, {}, { kind: "issue" }), true);
  assert.equal(normalizeRegistration("mh-12 ab 1234"), "MH12AB1234");
});

test("the hub is linked from Tasks, the action is server-only and the legacy builder labels simulations honestly", () => {
  assert.match(readFileSync("app/(dashboard)/tasks/layout.tsx", "utf8"), /\/tasks\/specialist/);
  const action = readFileSync("lib/actions/specialist.ts", "utf8");
  assert.match(action, /^"use server";/);
  assert.doesNotMatch(action, /SERVICE_ROLE/);
  assert.match(action, /startsWith\("NOV: "\)/, "only intentional database messages are shown");
  const legacy = readFileSync("components/modules/automation-client.tsx", "utf8");
  assert.match(legacy, /Simulate \(nothing is executed\)/);
  assert.match(legacy, /Simulated · nothing executed/);
  assert.doesNotMatch(legacy, /Automation run logged/);
  const migration = readFileSync("supabase/migrations/20261103800000_november_specialist.sql", "utf8");
  assert.doesNotMatch(migration, /drop table|drop column|truncate/i, "additive migration");
  assert.match(migration, /check \(status in \('available','reserved','dispatched','rejected','scrap','transformed','in_transit'\)\)/, "the stock status check is only widened");
  for (const table of ["po_intakes", "automation_effects", "lab_results", "shade_decisions", "blanket_releases", "tooling_allocations", "stock_transfer_lines", "treatment_observations", "toll_movements", "weighing_readings"]) {
    assert.match(migration, new RegExp(`'${table}'`), `${table} has RLS enabled and grants revoked`);
  }
});
