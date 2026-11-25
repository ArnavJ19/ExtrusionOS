import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";
import { FLOOR_MESSAGES, floorText, isFloorKey } from "../lib/i18n/floor.ts";
import { containmentCommandSchema, containmentDetailSchema } from "../lib/workflow/nonconforming.ts";
import { DEPARTMENTS, PREP_STATUS_LABELS, TASK_KIND_LABELS, taskWorkLink } from "../lib/workflow/orchestration.ts";
import {
  composeDispatchMessage, dispatchCommCommandSchema, dispatchFactsSchema, dispatchFinanceCommandSchema, messageLink, phoneDigits
} from "../lib/workflow/dispatch-orchestration.ts";

// Orchestration batch 3 / Phase 3, application layer: request validation, the customer message, live tables and the
// Hindi catalogue for the orchestration screens. The database rules are covered by order-lifecycle-orchestration-batch3-sql.
const id = "0e300000-0000-4000-8000-000000000001";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261122100000_order_lifecycle_orchestration_batch3.sql");
// lib/realtime/live.ts imports the browser client, so its table list is read from the source.
const LIVE_TABLES = read("lib/realtime/live.ts").match(/LIVE_TABLES = \[([\s\S]*?)\] as const/)[1].match(/"([a-z_]+)"/g).map(x => x.slice(1, -1));

const facts = dispatchFactsSchema.parse({
  dispatch_id: id, dispatch_number: "DC/26-27/0412", dispatched_at: "2026-11-22T06:30:00Z", delivery_status: "dispatched", order_id: id, order_number: "SO/26-27/0091",
  customer_name: "Sharma Fabricators", contact_person: "Mr Sharma", customer_po: "PO-7781", company_name: "Omalco Extrusion", vehicle_number: "MH12AB1234", driver_name: "Ramesh",
  driver_phone: "9822000111", transporter_name: "VRL Logistics", lr_number: "LR-310", eway_bill_number: "EWB-881", invoice_numbers: ["INV/26-27/0510"], bundles: 3, pieces: 150,
  net_weight_kg: 1500.4, items: [{ profile_code: "OM-2045", component_code: "SH-TRACK-6", pieces: 150, net_weight_kg: 1500.4, bundles: 3 }],
  expected_delivery: "2026-11-25T12:00:00Z", recipients: [{ channel: "whatsapp", value: "+91 98200 11223", label: "WhatsApp" }], can_send: true, history: []
});

test("customer message: logistics facts only, in English or Hindi; missing facts are left out", () => {
  const en = composeDispatchMessage(facts, "en");
  for (const fact of ["Dear Mr Sharma,", "SO/26-27/0091 (PO PO-7781) has been dispatched from Omalco Extrusion", "Vehicle: MH12AB1234 · Driver: Ramesh (9822000111)",
    "Transporter: VRL Logistics · LR: LR-310", "E-way bill: EWB-881", "Invoice: INV/26-27/0510", "3 bundles, 150 pcs, 1,500 kg net", "- OM-2045 / SH-TRACK-6: 150 pcs", "Expected delivery:", "— Omalco Extrusion"]) {
    assert.ok(en.includes(fact), `${fact} in\n${en}`);
  }
  assert.doesNotMatch(en, /₹|INR|rate|price|value|margin|cost/i, "never rates or values");
  const hi = composeDispatchMessage(facts, "hi");
  assert.match(hi, /आदरणीय Mr Sharma,/);
  assert.match(hi, /वाहन: MH12AB1234/);
  assert.match(hi, /ई-वे बिल: EWB-881/);
  const bare = composeDispatchMessage({ ...facts, customer_po: null, eway_bill_number: null, invoice_numbers: [], driver_name: null, vehicle_number: null, expected_delivery: null, company_name: null }, "en");
  assert.doesNotMatch(bare, /PO |E-way|Invoice|Vehicle|Expected/);
  assert.match(bare, /— us$/);
});

test("message links open the staff member's own app with the text; Indian numbers get the country code", () => {
  assert.equal(phoneDigits("+91 98200 11223"), "919820011223");
  assert.equal(phoneDigits("98200 11223"), "919820011223");
  assert.equal(phoneDigits("09820011223"), "919820011223");
  assert.equal(phoneDigits("+44 20 7946 0958"), "442079460958");
  assert.equal(messageLink("whatsapp", "98200 11223", "Hello & welcome"), "https://wa.me/919820011223?text=Hello%20%26%20welcome");
  assert.equal(messageLink("email", " a@b.in ", "Hi"), "mailto:a@b.in?subject=Dispatch%20update&body=Hi");
  assert.equal(messageLink("phone_call", "9820011223", "x"), "tel:+919820011223");
  assert.equal(messageLink("fax", "1", "x"), null);
});

test("finance clearance commands: references, percentages and scopes are required before the database", () => {
  assert.equal(dispatchFinanceCommandSchema.safeParse({ command: "release", dispatch_id: id, basis: "payment_confirmed", note: "RTGS seen in the bank statement" }).success, false);
  assert.equal(dispatchFinanceCommandSchema.safeParse({ command: "release", dispatch_id: id, basis: "payment_confirmed", reference: "UTR-55120", note: "RTGS seen in the bank statement" }).success, true);
  assert.equal(dispatchFinanceCommandSchema.safeParse({ command: "release", dispatch_id: id, basis: "approved_exception", note: "Owner approves against the LC" }).success, true);
  assert.equal(dispatchFinanceCommandSchema.safeParse({ command: "release", dispatch_id: id, basis: "approved_exception", note: "short" }).success, false);
  assert.equal(dispatchFinanceCommandSchema.safeParse({ command: "terms.set", scope: "customer", terms: "payment_before_dispatch", reason: "Agreed terms" }).success, false, "customer scope needs the customer");
  assert.equal(dispatchFinanceCommandSchema.safeParse({ command: "terms.set", scope: "company", terms: "advance_part", reason: "Agreed terms" }).success, false, "advance needs a percentage");
  assert.equal(dispatchFinanceCommandSchema.safeParse({ command: "terms.set", scope: "company", terms: "advance_part", advance_percent: 101, reason: "Agreed terms" }).success, false);
  assert.equal(dispatchFinanceCommandSchema.safeParse({ command: "terms.set", scope: "company", terms: "advance_part", advance_percent: 30, reason: "Agreed terms" }).success, true);
  assert.equal(dispatchFinanceCommandSchema.safeParse({ command: "status", dispatch_id: id, company_id: id }).success, false, "the company never comes from the browser");
});

test("customer message commands: channel, length and failure reasons are checked; no message can be edited", () => {
  const body = "Dispatch DC/26-27/0412 has left. Vehicle MH12AB1234.";
  assert.equal(dispatchCommCommandSchema.safeParse({ command: "record_sent", dispatch_id: id, channel: "whatsapp", recipient: "9820011223", body, language: "en" }).success, true);
  assert.equal(dispatchCommCommandSchema.safeParse({ command: "record_sent", dispatch_id: id, channel: "pigeon", recipient: "9820011223", body, language: "en" }).success, false);
  assert.equal(dispatchCommCommandSchema.safeParse({ command: "record_sent", dispatch_id: id, channel: "sms", recipient: "9820011223", body: "hi", language: "en" }).success, false);
  assert.equal(dispatchCommCommandSchema.safeParse({ command: "record_sent", dispatch_id: id, channel: "sms", recipient: "9820011223", body: `${body}\u0007`, language: "en" }).success, false);
  assert.equal(dispatchCommCommandSchema.safeParse({ command: "mark", id, status: "failed" }).success, false, "a failure needs its reason");
  assert.equal(dispatchCommCommandSchema.safeParse({ command: "mark", id, status: "failed", note: "Number not on WhatsApp" }).success, true);
  assert.equal(dispatchCommCommandSchema.safeParse({ command: "mark", id, status: "sent" }).success, false);
  assert.equal(dispatchCommCommandSchema.safeParse({ command: "edit", id, body }).success, false);
});

test("containment: the blanket earlier-approval confirmation is gone; each approval is reviewed and a revocation closed", () => {
  assert.equal(containmentCommandSchema.safeParse({ command: "release", id, note: "Balance re-measured and in drawing", prior_approved_confirmed: true }).success, false);
  assert.equal(containmentCommandSchema.safeParse({ command: "prior_review", id, inspection_id: id, outcome: "revoked", method: "Hardness re-test", note: "Below 12 HW on 3 of 5" }).success, true);
  assert.equal(containmentCommandSchema.safeParse({ command: "prior_review", id, inspection_id: id, outcome: "deleted", method: "x1", note: "Below 12 HW on 3 of 5" }).success, false);
  assert.equal(containmentCommandSchema.safeParse({ command: "prior_close", id, review_id: id, method: "Re-aged", note: "short" }).success, false);
  assert.doesNotMatch(read("components/modules/orchestration/nonconforming-forms.tsx"), /prior_approved_confirmed/);
  const detail = containmentDetailSchema.safeParse({});
  assert.equal(detail.success, false);
});

test("task kinds of every batch have a label, a work link and Hindi labels; departments and die statuses too", () => {
  const kinds = migration.match(/workflow_kind in \(([^)]+)\)/)[1].match(/'([a-z_]+)'/g).map(k => k.slice(1, -1));
  assert.ok(kinds.includes("dispatch_clearance") && kinds.includes("dispatch_intimation"));
  for (const kind of kinds) {
    assert.ok(TASK_KIND_LABELS[kind], `${kind} label`);
    assert.ok(isFloorKey(`olo.kind.${kind}`) && isFloorKey(`olo.work.${kind}`), `${kind} Hindi`);
  }
  assert.equal(taskWorkLink({ kind: "dispatch_clearance", order_id: id, source_id: id }).href, `/dispatches/clearance/${id}`);
  assert.equal(taskWorkLink({ kind: "dispatch_intimation", order_id: id, source_id: id }).href, `/dispatches/communications/${id}`);
  for (const d of Object.keys(DEPARTMENTS)) assert.ok(isFloorKey(`olo.dept.${d}`), d);
  for (const s of Object.keys(PREP_STATUS_LABELS)) assert.ok(isFloorKey(`olo.prep.${s}`), s);
  assert.equal(floorText("hi")("olo.tasks.due", { at: "22 Nov" }), "अंतिम समय 22 Nov");
  assert.equal(FLOOR_MESSAGES.en["olo.task.start"], "Start work");
  for (const [file, english] of [["app/(dashboard)/tasks/orchestration/page.tsx", ["Nothing here right now.", "My department"]],
    ["components/modules/orchestration/die-prep-actions.tsx", ["Record check", "Schedule preheat", "Cancel preparation"]],
    ["app/(dashboard)/dies/preparation/page.tsx", ["Check required", "Run starts"]]]) {
    const source = read(file);
    for (const text of english) assert.ok(!source.includes(`>${text}<`) && !source.includes(`"${text}"`), `${file} hard-codes "${text}"`);
  }
});

test("live screens subscribe only to published tables; the migration publishes the new ones", () => {
  for (const t of ["olo_events", "olo_task_events", "quality_containments", "die_preparation_events", "dispatch_communications"]) {
    assert.ok(LIVE_TABLES.includes(t), t);
    assert.match(migration, new RegExp(`'${t}'`), `${t} published`);
  }
  assert.ok(!LIVE_TABLES.includes("dispatch_finance_releases"), "finance amounts are not pushed");
  for (const file of ["app/(dashboard)/tasks/orchestration/page.tsx", "app/(dashboard)/dies/preparation/page.tsx", "app/(dashboard)/dispatches/communications/page.tsx", "app/(dashboard)/orders/lifecycle/page.tsx"]) {
    assert.match(read(file), /<LiveRefresh name=/, file);
  }
});

test("new pages are open to internal staff only and amounts stay with finance", () => {
  for (const path of ["/dispatches/clearance", "/dispatches/communications"]) {
    assert.equal(hasRouteAccess(path, "accounts"), true);
    assert.equal(hasRouteAccess(path, "dispatch"), true);
    assert.equal(hasRouteAccess(path, "dealer_admin"), false);
  }
  const page = read("app/(dashboard)/dispatches/clearance/page.tsx");
  assert.match(page, /queue\.finance_visible \?/, "amount columns only for finance");
  assert.match(migration, /case when p_finance then k else k - 'amounts' end/);
  assert.match(migration, /dispatch_finance_releases_read[\s\S]*olo_finance_roles/);
});

test("gate-outs of one customer are serialised and re-read after the lock, so concurrent dispatches cannot share an advance", () => {
  const guard = migration.slice(migration.indexOf("create or replace function private.olo_guard_dispatch_finance()"), migration.indexOf("create trigger b_olo_guard_dispatch_finance"));
  assert.match(guard, /pg_advisory_xact_lock\(hashtextextended\(new\.company_id::text \|\| ':olo-dispatch-clearance:' \|\| v_customer::text, 0\)\)/);
  assert.ok(guard.indexOf("pg_advisory_xact_lock") < guard.indexOf("olo_dispatch_clearance(new.company_id"), "lock before the check");
  assert.match(migration, /function private\.olo_dispatch_clearance\(p_company uuid, p_dispatch uuid\) returns jsonb\nlanguage plpgsql volatile/);
});
