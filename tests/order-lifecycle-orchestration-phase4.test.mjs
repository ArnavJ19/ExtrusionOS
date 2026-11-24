import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";
import { FLOOR_MESSAGES, floorText, isFloorKey } from "../lib/i18n/floor.ts";
import { containmentDetailSchema } from "../lib/workflow/nonconforming.ts";
import { orchestrationCommandSchema, settingsSchema } from "../lib/workflow/orchestration.ts";
import { clearanceDetailSchema, clearanceStateText, termsScopeText, termsText } from "../lib/workflow/dispatch-orchestration.ts";
import { reversalCommandSchema, reversalPreviewSchema, reversibleKg } from "../lib/workflow/quality-reversal.ts";

// Orchestration Phase 4, application layer: request validation for QC reversals and settings, response shapes before
// and after the upgrade, route access, live tables and the Hindi labels of the remaining orchestration screens.
// The database rules are covered by order-lifecycle-orchestration-phase4-sql.
const id = "0e400000-0000-4000-8000-000000000001";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261123100000_order_lifecycle_orchestration_phase4.sql");
const LIVE_TABLES = read("lib/realtime/live.ts").match(/LIVE_TABLES = \[([\s\S]*?)\] as const/)[1].match(/"([a-z_]+)"/g).map(x => x.slice(1, -1));
const reverse = extra => reversalCommandSchema.safeParse({ command: "reverse", inspection_id: id, reversed_kg: 250, reversed_as: "rejected", method: "Webster re-test",
  reason: "Customer complaint: hardness below 12 HW", ...extra });

test("reversal requests need a positive quantity, an outcome, the re-check method and a reason", () => {
  assert.equal(reverse().success, true);
  assert.equal(reverse({ reference: "NCR/26-27/014" }).success, true);
  assert.equal(reverse({ reversed_kg: 0 }).success, false);
  assert.equal(reverse({ reversed_as: "scrap" }).success, false, "scrap is decided later through remelt approval");
  assert.equal(reverse({ reason: "bad" }).success, false);
  assert.equal(reverse({ method: "x" }).success, false);
  assert.equal(reverse({ reference: "A\u0007B" }).success, false);
  assert.equal(reverse({ company_id: id }).success, false, "company comes from the session, never the request");
  assert.equal(reversalCommandSchema.safeParse({ command: "preview", inspection_id: "not-a-uuid" }).success, false);
});

test("the form offers at most what has not moved on; the preview shape is read as numbers", () => {
  const preview = reversalPreviewSchema.parse({
    inspection_id: id, status: "approved", batch_number: "LOT-7", quantity_kg: "1000.000", inspection_date: null, inspector_name: "QA", stage: "production",
    job_id: id, job_number: "JOB-1", order_id: id, order_number: "SO-1", profile_code: "OM-2045", job_approved_kg: "1000", moved_on_kg: "600", max_reversible_kg: "400",
    containment: null, reversal_id: null, can_reverse: true, blocker: null
  });
  assert.equal(reversibleKg(preview), 400);
  assert.equal(reversibleKg({ quantity_kg: 300, max_reversible_kg: 400 }), 300);
  assert.equal(reversibleKg({ quantity_kg: 300, max_reversible_kg: -2 }), 0);
});

test("settings: the batch 2 settings and the release validity are validated before the database", () => {
  const save = extra => orchestrationCommandSchema.safeParse({ command: "settings.save", ...extra }).success;
  assert.equal(save({ dispatch_release_hours: 24, delivery_confirmation_days: 3, reproduction_tolerance_kg: 2.5 }), true);
  assert.equal(save({ dispatch_release_hours: 2 }), false);
  assert.equal(save({ dispatch_release_hours: 200 }), false);
  assert.equal(save({ delivery_confirmation_days: 0 }), false);
  assert.equal(save({ reproduction_tolerance_kg: -1 }), false);
  const base = { billet_rank_threshold: 5, die_rank_threshold: 3, material_risk_horizon_days: 21, ack_sla_hours: 4, action_sla_hours: 24, enforce_die_preparation: false, enforce_preheat: false };
  const page = { can_edit: true, can_edit_routing: true, can_edit_standards: true, routing: [], standards: [], engine_errors: [] };
  assert.equal(settingsSchema.parse({ settings: base, ...page }).settings.dispatch_release_hours, undefined, "before the upgrade the form hides the new fields");
  assert.equal(settingsSchema.parse({ settings: { ...base, dispatch_release_hours: 12, delivery_confirmation_days: 5, reproduction_tolerance_kg: "1.000" }, ...page }).settings.reproduction_tolerance_kg, 1);
  const form = read("components/modules/orchestration/settings-forms.tsx");
  assert.match(form, /phase4 = s\.dispatch_release_hours !== undefined/, "batch 2 fields are sent only once the database reports the Phase 4 setting");
});

test("responses from a database without the upgrade still parse", () => {
  const detail = containmentDetailSchema.parse({
    id, containment_number: "QCH/26-27/0001", status: "open", stage: "final", defect: "Wall thin", defect_kind: "non_destructive", inspection_mode: "full_inspection",
    sampling_reference: null, required_samples: null, scope_kg: 600, suspended_approved_kg: 0, released_accepted_kg: 0, released_rejected_kg: 0, held_kg: 600, job_number: "J",
    order_id: null, order_number: null, profile_code: null, die_number: null, ncr_number: null, opened_at: "2026-11-23T05:00:00Z",
    recorded: { accepted_kg: 0, rejected_kg: 0, unreleased_accepted_kg: 0, unreleased_rejected_kg: 0, passing_samples: 0, failing_samples: 0 },
    results: [], lots: [], trace: { machine_name: null, billets: [] }, can_record: true, can_cancel: true
  });
  assert.deepEqual([detail.reversals, detail.can_reverse], [[], false]);
  const clearance = clearanceDetailSchema.parse({
    dispatch_id: id, dispatch_number: "DC-1", order_id: id, order_number: "SO-1", customer_name: "C", created_at: null, delivery_status: "pending", bundles: 1, net_weight_kg: 500,
    state: "blocked", terms: { id: null, terms: "payment_before_dispatch", advance_percent: null, scope: "order", reason: null, label: "payment before dispatch" },
    requires_clearance: true, priced: true, release: null, finance_visible: false, can_release: false, can_exception: false, releases: []
  });
  assert.equal(clearance.release_hours, 48);
});

test("QC reversal pages are open to the orchestration readers who can see QC, never to dealers or sales", () => {
  for (const role of ["owner", "admin", "quality", "factory_manager", "production_manager", "viewer"]) assert.equal(hasRouteAccess("/quality/reversals", role), true, role);
  for (const role of ["sales", "accounts", "dealer_admin"]) assert.equal(hasRouteAccess("/quality/reversals/new", role), false, role);
});

test("live screens: reversals are published and subscribed", () => {
  assert.ok(LIVE_TABLES.includes("quality_reversals"));
  assert.match(migration, /alter publication supabase_realtime add table public\.quality_reversals/);
  assert.ok(!LIVE_TABLES.includes("dispatch_finance_releases"), "finance amounts are still not pushed");
});

test("Hindi: payment terms, clearance states and scopes follow the screen language", () => {
  const hi = floorText("hi"), en = floorText("en");
  assert.equal(termsText(en, { terms: "advance_part", advance_percent: 30 }), "Advance of 30% before dispatch");
  assert.equal(termsText(hi, { terms: "advance_part", advance_percent: 30 }), "डिस्पैच से पहले 30% अग्रिम");
  assert.equal(termsText(hi, { terms: "credit", advance_percent: null }), "उधार शर्तें");
  assert.equal(termsText(hi, { terms: "unknown_terms", advance_percent: null }), "unknown_terms");
  assert.equal(clearanceStateText(hi, "blocked"), "वित्त मंज़ूरी बाकी");
  assert.equal(clearanceStateText(hi, "odd"), "odd");
  assert.equal(termsScopeText(en, "default"), "Not set (credit terms)");
  for (const k of ["olo.rev.title", "olo.qc.title", "olo.fc.title", "olo.lc.title", "olo.lc.overall.awaiting_quality", "olo.lc.risk.late", "olo.pr.title"]) {
    assert.ok(isFloorKey(k), k);
    assert.match(FLOOR_MESSAGES.hi[k], /[ऀ-ॿ]/, `${k} is Devanagari`);
  }
});

test("the remaining orchestration screens take their labels from the catalogue", () => {
  for (const [file, english] of [
    ["app/(dashboard)/quality/containment/page.tsx", ["No containments here.", "Still held", "Remelt approvals"]],
    ["app/(dashboard)/quality/containment/[id]/page.tsx", ["Traceability", "Record and release", "No results recorded yet."]],
    ["components/modules/orchestration/nonconforming-forms.tsx", ["Hold lot", "Record result", "Close revocation", "Reconfirm approval", "Send request"]],
    ["app/(dashboard)/dispatches/clearance/page.tsx", ["Needs clearance", "Payment terms in force"]],
    ["app/(dashboard)/dispatches/clearance/[id]/page.tsx", ["Releases", "Dispatch record"]],
    ["components/modules/orchestration/dispatch-forms.tsx", ["Record release", "Save terms", "Withdraw release"]],
    ["app/(dashboard)/orders/lifecycle/page.tsx", ["Order lifecycle command centre", "Jobs ready for production", "Apply"]],
    ["app/(dashboard)/orders/[id]/lifecycle/page.tsx", ["Quantity ledger", "Lifecycle timeline", "Go to the work"]],
    ["app/(dashboard)/quality/reversals/page.tsx", ["QC reversals"]],
    ["components/modules/orchestration/reversal-forms.tsx", ["Reverse approval"]]
  ]) {
    const source = read(file);
    for (const text of english) assert.ok(!source.includes(`>${text}<`) && !source.includes(`"${text}"`), `${file} hard-codes "${text}"`);
  }
  assert.doesNotMatch(read("components/modules/orchestration/dispatch-forms.tsx"), /48 hours/, "the release validity comes from the setting");
});

test("the migration changes earlier functions only where it says so and keeps QC records immutable", () => {
  assert.equal((migration.match(/-- Phase 4:/g) ?? []).length, 6);
  assert.match(migration, /status = any \(array\['pending','approved','rejected','rework','reversed'\]\)/);
  assert.match(migration, /if old.status in \('approved', 'rejected', 'rework', 'reversed'\) then/, "reversed is final");
  assert.match(migration, /create trigger quality_reversals_evidence before update or delete/);
  assert.match(migration, /and t\.workflow_key is null and \(/, "engine-verified tasks are not held for source review");
  assert.doesNotMatch(migration, /drop table|drop column|disable row level security/i);
});
