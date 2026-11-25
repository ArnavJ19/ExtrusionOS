import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";
import { FLOOR_MESSAGES } from "../lib/i18n/floor.ts";
import { DELIVERY_CLOSURE_EN, DELIVERY_CLOSURE_HI } from "../lib/i18n/floor-delivery-closure.ts";
import {
  ACCEPTANCE_LABELS, ACCEPTANCE_OUTCOMES, ACKNOWLEDGEMENTS, CLOSURE_OVERALL_LABELS, CLOSURE_VIEWS, COMPLAINT_CATEGORIES, COMPLAINT_STATUSES, CONTAINMENT_ACTIONS, DELIVERY_VIEWS,
  REASON_CATEGORIES, RESOLUTIONS, SEVERITIES, SEVERITY_DUE_DAYS, SHIPMENT_STATE_LABELS, SHIPMENT_STATES, TRACKING_KINDS, canChangeShipmentStatus, canFollowUpPayments,
  canLogComplaint, canRecordReceipt, canTrackShipment, closureCommandSchema, closureDetailSchema, complaintCommandSchema, complaintDetailSchema, complaintNextStep,
  deliveryCommandSchema, deliveryDetailSchema, receiptDiscrepancy, receivableCommandSchema
} from "../lib/workflow/delivery-closure.ts";
import { OVERALL_LABELS, TASK_KIND_LABELS, orchestrationCommandSchema, taskWorkLink } from "../lib/workflow/orchestration.ts";

// Orchestration Phase 7, application layer: request validation, the receipt-discrepancy preview against the SQL rule,
// vocabularies against the migration, roles and routes, task kinds and links, live tables, actions and Hindi labels.
// The database rules are covered by order-lifecycle-orchestration-phase7-sql.
const id = "0e700000-0000-4000-8000-000000000001";
const id2 = "0e700000-0000-4000-8000-000000000002";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261126100000_order_lifecycle_orchestration_phase7.sql");
const LIVE_TABLES = read("lib/realtime/live.ts").match(/LIVE_TABLES = \[([\s\S]*?)\] as const/)[1].match(/"([a-z_]+)"/g).map(x => x.slice(1, -1));
const checkList = (column) => {
  const m = migration.match(new RegExp(`${column} [^\\n]*?check \\(${column}[^\\n]*? in \\(([^)]*)\\)`)) ?? migration.match(new RegExp(`check \\(${column} in \\(([^)]*)\\)`));
  assert.ok(m, `check list for ${column}`);
  return m[1].match(/'([a-z_]+)'/g).map(x => x.slice(1, -1));
};

test("requests: tracking and receipts", () => {
  const ok = input => deliveryCommandSchema.safeParse(input).success;
  assert.equal(ok({ command: "tracking.record", id, dispatch_id: id2, kind: "in_transit", source: "driver", note: "Crossed Nashik" }), true);
  assert.equal(ok({ command: "tracking.record", id, dispatch_id: id2, kind: "eta_revised", source: "transporter", note: "Queue at checkpost" }), false, "an ETA revision needs the time");
  assert.equal(ok({ command: "tracking.record", id, dispatch_id: id2, kind: "delivery_attempted", source: "driver", note: "Gate closed", revised_eta: "2026-11-27T10:00:00Z" }), false);
  assert.equal(ok({ command: "tracking.record", id, dispatch_id: id2, kind: "delayed", source: "driver", note: "Breakdown at Pune", revised_eta: "2026-11-27T10:00:00Z" }), true);
  assert.equal(ok({ command: "tracking.record", id, dispatch_id: id2, kind: "in_transit", source: "driver", note: "Bad\u0007note" }), false);
  const receipt = { command: "receipt.record", id, dispatch_id: id2, delivered_at: "2026-11-25T10:00:00Z", receiving_company: "Sharma Fabricators", receiver_name: "Mr Sharma",
    received_bundles: 2, received_kg: 228, acknowledgement: "signed_challan" };
  assert.equal(ok(receipt), true);
  assert.equal(ok({ ...receipt, accept_all: true, shortage_kg: 10 }), false, "accept all with a shortage is refused before sending");
  assert.equal(ok({ ...receipt, received_bundles: 1.5 }), false);
  assert.equal(ok({ ...receipt, receiver_phone: "call me" }), false);
  assert.equal(ok({ ...receipt, company_id: id }), false, "the company never comes from the request");
  assert.equal(ok({ command: "board", view: "pod_received", sort: "expected_at", direction: "asc", page: 2 }), true);
  assert.equal(ok({ command: "board", view: "lost" }), false);
});

test("requests: complaints, receivables and closure", () => {
  const c = input => complaintCommandSchema.safeParse(input).success;
  const log = { command: "log", id, order_id: id2, category: "surface_finish", severity: "high", description: "Pitting on visible face of sash" };
  assert.equal(c(log), true);
  assert.equal(c({ ...log, items: [{ packing_list_item_id: id }, { packing_list_item_id: id }] }), false, "a bundle twice");
  assert.equal(c({ ...log, description: "short" }), false);
  assert.equal(c({ command: "resolve", complaint_id: id, resolution: "replacement", resolution_note: "Replace one bundle free" }), false, "replacement needs kg and billing");
  assert.equal(c({ command: "resolve", complaint_id: id, resolution: "replacement", resolution_note: "Replace one bundle free", replacement_kg: 114, replacement_billing: "free_of_charge" }), true);
  assert.equal(c({ command: "resolve", complaint_id: id, resolution: "credit_note", resolution_note: "Credit for 100 kg agreed", replacement_kg: 10 }), false);
  assert.equal(c({ command: "investigate", complaint_id: id, containment_action: "qc_containment", containment_note: "Hold the lot" }), false, "QC containment needs its record");
  assert.equal(c({ command: "investigate", complaint_id: id, containment_action: "stock_held", containment_note: "Hold the lot", containment_id: id2 }), false);
  assert.equal(c({ command: "close", complaint_id: id, note: "Verified next run" }), true);
  const r = input => receivableCommandSchema.safeParse(input).success;
  assert.equal(r({ command: "dispute.open", id, invoice_id: id2, amount: 300.5, reason_category: "rate_difference", reason: "Pays the old rate only" }), true);
  assert.equal(r({ command: "dispute.open", id, invoice_id: id2, amount: 300.555, reason_category: "rate_difference", reason: "Pays the old rate only" }), false, "paise only");
  assert.equal(r({ command: "write_off.decide", id, decision: "approve", note: "Bank charges approved" }), true);
  assert.equal(r({ command: "write_off.decide", id, decision: "maybe", note: "Bank charges approved" }), false);
  assert.equal(closureCommandSchema.safeParse({ command: "finalize", order_id: id, note: "Paid and complete" }).success, true);
  assert.equal(closureCommandSchema.safeParse({ command: "finalize", order_id: id, note: "short" }).success, false);
  assert.equal(orchestrationCommandSchema.safeParse({ command: "settings.save", payment_followup_lead_days: 31 }).success, false);
  assert.equal(orchestrationCommandSchema.safeParse({ command: "settings.save", payment_followup_lead_days: 5 }).success, true);
});

test("receipt preview matches the database rule: weighbridge variance is no shortage; a reported shortage or a missing bundle is", () => {
  const base = { dispatched_kg: 228, dispatched_bundles: 2, received_kg: 228, received_bundles: 2 };
  assert.deepEqual(receiptDiscrepancy({ ...base, received_kg: 227.4 }), { open: false, discrepancyKg: 0.6, missingBundles: 0 }, "0.26 % below is weighbridge variance");
  assert.equal(receiptDiscrepancy({ ...base, received_kg: 226 }).open, true, "2 kg below 228 exceeds max(1 kg, 0.5 %)");
  assert.equal(receiptDiscrepancy({ ...base, shortage_kg: 1.5 }).open, true, "an explicitly reported shortage above the tolerance");
  assert.equal(receiptDiscrepancy({ ...base, damaged_kg: 0.5 }).open, false);
  assert.deepEqual(receiptDiscrepancy({ ...base, received_bundles: 1, received_kg: 114, shortage_kg: 114 }), { open: true, discrepancyKg: 114, missingBundles: 1 });
  assert.equal(receiptDiscrepancy({ dispatched_kg: 10000, dispatched_bundles: 80, received_kg: 9960, received_bundles: 80 }).open, false, "0.4 % of 10 t is within weighbridge variance");
  // The SQL encodes the same rule.
  assert.match(migration, /v_open := r\.shortage_kg \+ r\.damaged_kg > v_tol or r\.dispatched_kg - r\.received_kg > greatest\(v_tol, round\(r\.dispatched_kg \* 0\.005, 3\)\)\s+or r\.received_bundles < r\.dispatched_bundles;/);
});

test("vocabularies: the screens' lists match the migration's check lists", () => {
  assert.deepEqual(checkList("category"), [...COMPLAINT_CATEGORIES]);
  assert.deepEqual(checkList("severity"), [...SEVERITIES]);
  const complaintStatus = migration.match(/add column if not exists status text not null default 'open' check \(status in \(([^)]*)\)\)/);
  assert.deepEqual(complaintStatus[1].match(/'([a-z_]+)'/g).map(x => x.slice(1, -1)), [...COMPLAINT_STATUSES]);
  assert.deepEqual(checkList("containment_action"), [...CONTAINMENT_ACTIONS]);
  assert.deepEqual(checkList("kind").filter(k => TRACKING_KINDS.includes(k)), [...TRACKING_KINDS]);
  assert.deepEqual(checkList("acknowledgement"), [...ACKNOWLEDGEMENTS]);
  assert.deepEqual(checkList("reason_category"), [...REASON_CATEGORIES]);
  for (const r of RESOLUTIONS) assert.match(migration, new RegExp(`'${r}'`), r);
  for (const s of SHIPMENT_STATES) { assert.match(migration, new RegExp(`'${s}'`), s); assert.ok(SHIPMENT_STATE_LABELS[s], s); }
  for (const v of DELIVERY_VIEWS) assert.match(migration, new RegExp(`'${v}'`), v);
  for (const o of ACCEPTANCE_OUTCOMES) { assert.match(migration, new RegExp(`'${o}'`), o); assert.ok(ACCEPTANCE_LABELS[o], o); }
  for (const v of CLOSURE_VIEWS) assert.match(migration, new RegExp(`'${v}'`), v);
  for (const o of Object.keys(CLOSURE_OVERALL_LABELS)) { assert.match(migration, new RegExp(`'${o}'`), o); assert.equal(OVERALL_LABELS[o], CLOSURE_OVERALL_LABELS[o], o); }
  // Severity due days match the SQL.
  for (const [s, days] of Object.entries(SEVERITY_DUE_DAYS)) {
    if (s !== "medium") assert.match(migration, new RegExp(`when '${s}' then interval '${days} days?'`), s);
  }
  assert.match(migration, /else interval '7 days' end/);
});

test("roles and routes: receivables are finance only; complaints for every department; dealers never", () => {
  for (const role of ["dispatch", "dispatch_manager", "owner", "inventory_manager"]) assert.equal(canChangeShipmentStatus(role), true, role);
  for (const role of ["sales", "sales_manager", "quality", "accounts"]) assert.equal(canChangeShipmentStatus(role), false, role);
  assert.equal(canTrackShipment("sales"), true, "sales records customer reports");
  assert.equal(canRecordReceipt("sales"), true);
  assert.equal(canRecordReceipt("viewer"), false);
  assert.equal(canLogComplaint("dispatch"), true);
  assert.equal(canLogComplaint("accounts"), false);
  for (const role of ["owner", "admin", "accounts"]) assert.equal(canFollowUpPayments(role), true, role);
  for (const role of ["sales_manager", "dispatch_manager", "viewer"]) assert.equal(canFollowUpPayments(role), false, role);
  assert.equal(hasRouteAccess("/payments/follow-up", "accounts"), true);
  for (const role of ["sales_manager", "viewer", "dispatch"]) assert.equal(hasRouteAccess("/payments/follow-up/x", role), false, `${role} sees no balances`);
  assert.equal(hasRouteAccess("/quality/complaints/new", "sales"), true);
  assert.equal(hasRouteAccess("/dispatches/deliveries/x", "sales"), true);
  assert.equal(hasRouteAccess("/orders/closure", "accounts"), true);
  for (const path of ["/dispatches/deliveries", "/quality/complaints", "/payments/follow-up", "/orders/closure"]) {
    for (const role of ["dealer_admin", "dealer_staff"]) assert.equal(hasRouteAccess(path, role), false, `${role} ${path}`);
  }
  // The finance-only command and table are finance-only in the database too.
  assert.match(migration, /a := private\.olo_actor\(private\.olo_finance_roles\(\)\);/);
  assert.match(migration, /create policy receivable_exceptions_read [\s\S]*?private\.get_current_user_role\(\) in \('owner','admin','accounts'\)\);/);
});

test("task kinds, work links, live tables, actions and the migration's shape", () => {
  const kinds = ["delivery_discrepancy", "complaint_investigation", "complaint_resolution", "complaint_replacement", "complaint_credit_note", "complaint_closure", "payment_followup",
    "closure_review", "final_closure"];
  for (const kind of kinds) {
    assert.ok(TASK_KIND_LABELS[kind], kind);
    assert.match(migration, new RegExp(`'${kind}'`), kind);
    assert.match(migration, new RegExp(`when '${kind}' then|else 'This task closes when the final closure`), `${kind} has a guard message`);
  }
  assert.equal(taskWorkLink({ kind: "payment_followup", order_id: id, source_id: id2 }).href, `/payments/follow-up/${id2}`);
  assert.equal(taskWorkLink({ kind: "complaint_closure", order_id: id, source_id: id2 }).href, `/quality/complaints/${id2}`);
  assert.equal(taskWorkLink({ kind: "final_closure", order_id: id, source_id: id }).href, `/orders/closure/${id}`);
  assert.equal(taskWorkLink({ kind: "delivery_discrepancy", order_id: id, source_id: id2 }).href, `/dispatches/deliveries/${id2}`);
  for (const table of ["dispatch_tracking_updates", "delivery_receipts", "customer_complaint_events"]) {
    assert.ok(LIVE_TABLES.includes(table), table);
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.doesNotMatch(migration.match(/foreach v_table in array array\[([^\]]*)\]/g).at(-1), /receivable_exceptions/, "finance records are not published to Realtime");
  const actions = read("lib/actions/orchestration.ts");
  for (const [fn, rpc] of [["deliveryTrackingAction", "delivery_tracking_command"], ["complaintAction", "customer_complaint_command"],
    ["receivableFollowupAction", "receivable_followup_command"], ["orderClosureAction", "order_closure_command"]]) {
    assert.match(actions, new RegExp(`export async function ${fn}[\\s\\S]*?runCommand\\("${rpc}"`), fn);
    assert.match(migration, new RegExp(`create or replace function public\\.${rpc}\\(p_command text, p_payload jsonb default '\\{\\}'::jsonb\\)`), rpc);
    assert.match(migration, new RegExp(`grant execute on function [^;]*public\\.${rpc}\\(text, jsonb\\)[^;]* to authenticated`), `${rpc} granted`);
  }
  // Wrapped, not rewritten; one transaction; the earlier function bodies keep their names with a phase suffix.
  for (const name of ["olo_command_p6", "olo_verify_tasks_p6", "olo_run_all_p6", "olo_order_core_p6", "closure_readiness_nov"]) assert.match(migration, new RegExp(`rename to ${name}`), name);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;\s*$/m);
  assert.doesNotMatch(migration, /\bdrop table\b|\bdrop column\b|\btruncate\b/i, "additive only");
  assert.match(read("tests/nov-batch9.test.mjs"), /name\.startsWith\("20261126"\)/);
});

test("response shapes: the detail schemas accept the database's answer and keep unknown fields", () => {
  const shipment = { state: "pod_received", delivery_status: "delivered", dispatched_at: null, delivered_at: null, expected_at: null, overdue: false, pod_on_file: true, last_update: null,
    receipt_id: null, discrepancy: null, acceptance: { outcome: "accepted_in_full", lines: 2, pending_lines: 0, accepted_kg: "228", refused_kg: 0, damaged_kg: 0, short_kg: 0, unresolved: 0, extra: 1 } };
  const delivery = { dispatch: { id, dispatch_number: "D-1", delivery_status: "delivered", dispatched_at: null, delivered_at: null, vehicle_number: null, transporter_name: null,
    driver_name: null, driver_phone: null, lr_number: null, eway_bill_number: null, pod_on_file: true }, order: { id, order_number: "O-1", customer: "C", stage: "delivered" },
    manifest: { bundles: 2, kg: 228 }, shipment, tracking: [], receipts: [], lines: [], complaints: [], replacement_for: null, can_track: true, can_change_status: false, can_record_receipt: true };
  const parsed = deliveryDetailSchema.parse(delivery);
  assert.equal(parsed.shipment.acceptance.accepted_kg, 228);
  assert.equal(parsed.shipment.acceptance.extra, 1);
  assert.equal(complaintDetailSchema.safeParse({}).success, false);
  assert.equal(closureDetailSchema.safeParse({ order: { id, order_number: "O", customer: null, stage: "closed", order_date: "2026-11-01" },
    state: { operational: "closed", financial: "settled", closure_kind: "final", closed_at: null, authorization: false, overall: "fully_closed", readiness_kind: null, blocking: 0, first_blocker: null, administrative: "complete" },
    closure: null, history: [], operational: null, final: null, can_close_operational: false, can_finalize: false, can_close_final_directly: false }).success, true);
  assert.deepEqual(complaintNextStep("open", "surface_finish"), { label: "Decide the containment", department: "quality" });
  assert.equal(complaintNextStep("open", "transit_damage").department, "dispatch");
  assert.equal(complaintNextStep("action", "quality").department, "sales");
  assert.equal(complaintNextStep("closed", "quality"), null);
  assert.match(migration, /when p_category in \('quality','dimensional','surface_finish','wrong_material'\) then 'quality'\s+when p_category in \('quantity_shortage','transit_damage','delivery_delay','documentation'\) then 'dispatch' else 'sales' end/);
});

test("Hindi: every Phase 7 floor label exists in both languages and is in the floor catalogue", () => {
  assert.deepEqual(Object.keys(DELIVERY_CLOSURE_HI).sort(), Object.keys(DELIVERY_CLOSURE_EN).sort());
  const vars = s => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  for (const [key, en] of Object.entries(DELIVERY_CLOSURE_EN)) {
    assert.equal(vars(DELIVERY_CLOSURE_HI[key]), vars(en), `${key} placeholders`);
    assert.equal(FLOOR_MESSAGES.en[key], en, `${key} is in the floor catalogue`);
    assert.match(FLOOR_MESSAGES.hi[key], /[ऀ-ॿ]/, `${key} is Devanagari`);
  }
  for (const kind of Object.keys(TASK_KIND_LABELS).slice(-9)) assert.ok(FLOOR_MESSAGES.hi[`olo.kind.${kind}`], kind);
  for (const overall of Object.keys(CLOSURE_OVERALL_LABELS)) assert.ok(FLOOR_MESSAGES.hi[`olo.lc.overall.${overall}`], overall);
});
