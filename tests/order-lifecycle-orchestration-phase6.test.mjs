import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";
import { FLOOR_MESSAGES, floorText } from "../lib/i18n/floor.ts";
import { PACKAGING_FLOW_EN, PACKAGING_FLOW_HI } from "../lib/i18n/floor-packaging-flow.ts";
import { QR_ENTITY_TYPES } from "../lib/qr/entities.ts";
import { parseScanInput, qrEntityTypes } from "../lib/qr/payload.ts";
import { scanActions, scanWarnings } from "../lib/qr/scan-task.ts";
import {
  BUNDLE_STATES, FG_LINE_STATES, FG_STATUSES, RELEASE_BASES, bundleListSchema, bundleLookupSchema, bundleResolveSchema, bundleSort, canReceiveFg, canSendFg, fgSort,
  fgTransferSchema, packagingFlowCommandSchema, releaseDetailSchema, releaseQueueSchema, releaseSort, selectedNetKg, tagSchema
} from "../lib/workflow/packaging-flow.ts";
import { TASK_KIND_LABELS, lifecycleSchema, orchestrationCommandSchema, settingsSchema, taskWorkLink } from "../lib/workflow/orchestration.ts";

// Orchestration Phase 6, application layer: request validation, response shapes, roles and routes, task kinds and
// links, scanning a bundle label, live tables and the Hindi labels. The database rules are covered by
// order-lifecycle-orchestration-phase6-sql.
const id = "0e600000-0000-4000-8000-000000000001";
const id2 = "0e600000-0000-4000-8000-000000000002";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261125100000_order_lifecycle_orchestration_phase6.sql");
const LIVE_TABLES = read("lib/realtime/live.ts").match(/LIVE_TABLES = \[([\s\S]*?)\] as const/)[1].match(/"([a-z_]+)"/g).map(x => x.slice(1, -1));
const cmd = input => packagingFlowCommandSchema.safeParse(input);

test("requests: transfers need a location and 1-60 distinct bundles; receipts a clean tag; closing and cancelling a reason", () => {
  assert.equal(cmd({ command: "fg.send", id, location_id: id2, bundle_ids: [id] }).success, true);
  assert.equal(cmd({ command: "fg.send", id, location_id: id2, bundle_ids: [] }).success, false);
  assert.equal(cmd({ command: "fg.send", id, location_id: id2, bundle_ids: [id, id] }).success, false, "duplicates are refused");
  assert.equal(cmd({ command: "fg.send", id, location_id: id2, bundle_ids: Array.from({ length: 61 }, (_, n) => `0e600000-0000-4000-8000-${String(n).padStart(12, "0")}`) }).success, false);
  assert.equal(cmd({ command: "fg.send", id, location_id: id2, bundle_ids: [id], company_id: id }).success, false, "the company never comes from the request");
  assert.equal(cmd({ command: "fg.receive", transfer_id: id, tag: "BND-001" }).success, true);
  for (const bad of ["", "BND 001", "https://evil.example/x", "BND\u0007"]) assert.equal(cmd({ command: "fg.receive", transfer_id: id, tag: bad }).success, false, JSON.stringify(bad));
  assert.equal(cmd({ command: "fg.close", transfer_id: id, note: "short" }).success, false);
  assert.equal(cmd({ command: "fg.close", transfer_id: id, note: "Two bundles not at the bay" }).success, true);
  assert.equal(cmd({ command: "fg.cancel", transfer_id: id, note: "Sent to the wrong bay" }).success, true);
  assert.equal(cmd({ command: "bundle.trace", tag: "BND-001" }).success, true);
  assert.equal(cmd({ command: "bundle.trace", bundle_id: id }).success, true);
  assert.equal(cmd({ command: "bundle.trace" }).success, false, "one of tag or id");
  assert.equal(cmd({ command: "bundle.trace", bundle_id: id, tag: "BND-001" }).success, false);
  assert.equal(cmd({ command: "bundles.list", state: "lost" }).success, false);
  assert.equal(cmd({ command: "release.queue", view: "to_pack", sort: "to_pack_kg", direction: "desc", page: 2, search: "job" }).success, true);
  assert.equal(tagSchema.parse("  EO2:bundle:x:y "), "EO2:bundle:x:y");
  assert.deepEqual([releaseSort("price"), bundleSort("net_kg"), fgSort(undefined)], ["completed_at", "net_kg", "sent_at"]);
  assert.equal(selectedNetKg([{ id: "a", net_kg: 114.0004 }, { id: "b", net_kg: 113.5 }, { id: "c", net_kg: 9 }], ["a", "b"]), 227.5);
});

test("roles: packaging sends, dispatch and stores receive; QA, accounts and sales do neither", () => {
  for (const role of ["owner", "production", "production_manager", "dispatch_manager", "dispatch"]) assert.equal(canSendFg(role), true, role);
  for (const role of ["quality", "accounts", "sales", "viewer", "inventory_manager"]) assert.equal(canSendFg(role), false, role);
  for (const role of ["owner", "dispatch", "dispatch_manager", "inventory_manager", "factory_manager"]) assert.equal(canReceiveFg(role), true, role);
  for (const role of ["production", "quality", "accounts", "viewer"]) assert.equal(canReceiveFg(role), false, role);
  assert.equal(hasRouteAccess("/packaging/bundles", "quality"), true, "QA traces bundles for a recall");
  assert.equal(hasRouteAccess("/packaging/bundles/x", "accounts"), true);
  assert.equal(hasRouteAccess("/packaging/fg-transfers", "inventory_manager"), true);
  assert.equal(hasRouteAccess("/packaging/fg-transfers", "quality"), false);
  assert.equal(hasRouteAccess("/packaging/release", "quality"), true);
  for (const path of ["/packaging/bundles", "/packaging/fg-transfers/new", "/packaging/release"]) {
    for (const role of ["sales", "dealer_admin", "dealer_staff"]) assert.equal(hasRouteAccess(path, role), false, `${role} ${path}`);
  }
  assert.equal(hasRouteAccess("/packaging/materials", "quality"), false, "the rest of packaging keeps its own roles");
});

test("response shapes parse: release queue and detail, bundle list, trace, resolution and transfer", () => {
  assert.equal(releaseQueueSchema.safeParse({ page: 1, page_size: 10, total: 1, view: "to_pack", rows: [{ job_id: id, job_number: "JOB-1", order_id: id2, order_number: "SO-1", customer: "Sharma",
    profile_code: "OM-1", job_status: "completed", completed_at: null, route: "required", stage: "released", basis: "final_qc", release_kg: "400.000", packed_kg: 114, to_pack_kg: 286,
    held_kg: 0, containment: null }] }).success, true);
  assert.equal(releaseDetailSchema.safeParse({ job: { id, job_number: "JOB-1", status: "completed", completed_at: null, order_id: id2, order_number: "SO-1", customer: "C", expected_dispatch_date: null,
    profile_code: "P", profile_name: "N", alloy: "6063", temper: "T5", machine_name: null }, flow: {}, release: { basis: "first_qc", release_kg: 1, packed_kg: 0, to_pack_kg: 1 }, containment: null,
    spec: null, spec_text: "No packing specification", bundles: [], packaging_jobs: [], handoffs: [], can_record_bundles: true }).success, true);
  assert.equal(bundleListSchema.safeParse({ page: 1, page_size: 10, total: 0, rows: [], enforce_fg_receipt: false }).success, true);
  assert.equal(bundleLookupSchema.safeParse({ found: false, tag: "X", dispatch_id: null, dispatch_number: null }).success, true);
  const trace = { found: true, bundle: { id, bundle_number: "B1", state: "in_fg", source_kind: "production", pieces: 20, net_length_m: "120.000", gross_kg: 120, tare_kg: 6, net_kg: 114,
    recorded_at: "2026-11-25T05:00:00Z", recorded_by: "D", location: "Bay 1", transfer_number: "FGT-2611-0001", loaded_vehicle: null },
    order: { id: id2, order_number: "SO-1", customer: "C", stage: "in_production" }, profile: null, stock: null, job: null, route: null, billets: [], qc: [], ageing: [], final_qc: [], hold: null,
    packaging: [], labels: { prints: 0, last_printed_at: null, active: 0 }, custody: [], loading: [], dispatch: null, invoices: [], invoice: null, gaps: ["No billet issue"] };
  assert.equal(bundleLookupSchema.safeParse(trace).success, true);
  assert.equal(bundleResolveSchema.safeParse({ found: true, id, bundle_number: "B1", state: "packed", order_number: null, job_number: null, profile_code: null, pieces: 1, net_kg: "1",
    location: null, transfer_id: null, transfer_number: null, dispatch_number: null, invoice_number: null, hold: null }).success, true);
  assert.equal(fgTransferSchema.safeParse({ id, transfer_number: "FGT-2611-0001", status: "in_transit", location: "Bay", location_code: "FG-1", bundle_count: 1, net_kg: 114, note: null,
    sent_by_name: "P", sent_at: "2026-11-25T05:00:00Z", closed_by_name: null, closed_at: null, close_note: null, received: 0, remaining: 1, missing: 0, lines: [], can_receive: true, can_cancel: false }).success, true);
  assert.deepEqual([BUNDLE_STATES.length, FG_STATUSES.length, FG_LINE_STATES.length, RELEASE_BASES.length], [6, 4, 4, 4]);
});

test("lifecycle and settings parse before and after the upgrade; the Phase 6 settings save with their limits", () => {
  const base = { ordered_kg: 1, produced_kg: 1, qc_accepted_kg: 1, qc_pending_kg: 0, qc_rejected_kg: 0, packed_kg: 0, dispatched_kg: 0, delivered_kg: 0, outstanding_kg: 1 };
  const order = { id, order_number: "SO-1", customer_name: "C", priority: "normal", current_stage: "order_confirmed", order_date: null, expected_dispatch_date: null, stage_since: null, days_in_stage: 0, quote_number: null, customer_po: null };
  const lc = q => lifecycleSchema.safeParse({ order, overall: "in_process", next_action: null, blocker: null, risk: "none", quantities: q, domains: [], jobs: [], tasks: [], open_tasks: [], timeline: [], finance: null, finance_visible: false });
  const before = lc(base), after = lc({ ...base, released_for_packing_kg: "300", to_pack_kg: 300, in_fg_kg: 0, in_fg_transfer_kg: 0, invoiced_kg: 0, dispatches_not_invoiced: 0 });
  assert.deepEqual([before.success, after.success], [true, true], before.success ? "" : JSON.stringify(before.error.issues.slice(0, 3)));
  assert.equal(after.data.quantities.released_for_packing_kg, 300, "read as a number");
  assert.equal(orchestrationCommandSchema.safeParse({ command: "settings.save", fg_transfer_hours: 8, invoice_due_hours: 0, enforce_fg_receipt: false }).success, true);
  assert.equal(orchestrationCommandSchema.safeParse({ command: "settings.save", fg_transfer_hours: 0 }).success, false);
  assert.equal(orchestrationCommandSchema.safeParse({ command: "settings.save", invoice_due_hours: 169 }).success, false);
  const settings = { billet_rank_threshold: 5, die_rank_threshold: 3, material_risk_horizon_days: 21, ack_sla_hours: 4, action_sla_hours: 24, enforce_die_preparation: false, enforce_preheat: false };
  const s = { can_edit: true, can_edit_routing: true, can_edit_standards: true, routing: [], standards: [], engine_errors: [] };
  assert.equal(settingsSchema.safeParse({ ...s, settings }).success, true, "before the upgrade");
  assert.equal(settingsSchema.safeParse({ ...s, settings: { ...settings, fg_transfer_hours: 8, invoice_due_hours: 4, enforce_fg_receipt: false } }).success, true);
  assert.match(read("components/modules/orchestration/settings-forms.tsx"), /phase6 \? \{ enforce_fg_receipt: s\.enforce_fg_receipt, fg_transfer_hours: s\.fg_transfer_hours, invoice_due_hours: s\.invoice_due_hours \}/);
});

test("Phase 6 task kinds are named and link to the screen where the work is done", () => {
  for (const kind of ["fg_transfer", "fg_receipt", "dispatch_invoice"]) {
    assert.ok(TASK_KIND_LABELS[kind], kind);
    assert.match(migration, new RegExp(`'${kind}'`), `${kind} is an engine task kind`);
  }
  assert.equal(taskWorkLink({ kind: "fg_transfer", order_id: id }).href, `/packaging/fg-transfers/new?order_id=${id}`);
  assert.equal(taskWorkLink({ kind: "fg_receipt", order_id: null, source_id: id2 }).href, `/packaging/fg-transfers/${id2}`);
  assert.equal(taskWorkLink({ kind: "dispatch_invoice", order_id: id }).href, "/invoices/drafts");
});

test("scanning: a bundle tag resolves to the bundle; dispatched or held bundles warn; the generator does not offer bundles", () => {
  assert.ok(qrEntityTypes.includes("bundle"));
  assert.ok(!QR_ENTITY_TYPES.includes("bundle"), "bundle labels carry the tag; the QR generator keeps its list");
  assert.deepEqual(parseScanInput(`EO2:bundle:${id}:n1`), { kind: "v2", entityType: "bundle", entityId: id, raw: `EO2:bundle:${id}:n1` });
  assert.equal(parseScanInput("P6-T1").kind, "value");
  const all = { read: () => true, create: () => true, readDieHistory: true, splitBundles: true, traceBundles: true, receiveFg: true };
  assert.deepEqual(scanWarnings("bundle", { state: "dispatched", dispatch_number: "DC-1" }).map(w => w.tone), ["critical"]);
  assert.match(scanWarnings("bundle", { state: "packed", hold: "QCH/1" })[0].text, /held in QC containment QCH\/1/);
  assert.deepEqual(scanWarnings("bundle", { state: "in_fg" }), []);
  assert.deepEqual(scanActions("bundle", { id, state: "in_transfer", transfer_id: id2 }, all).map(a => a.href), [`/packaging/bundles/${id}`, `/packaging/fg-transfers/${id2}`]);
  assert.deepEqual(scanActions("bundle", { id, state: "in_transfer", transfer_id: id2 }, { ...all, traceBundles: false, receiveFg: false }), []);
  const scan = read("lib/actions/scan.ts");
  assert.match(scan, /packaging_flow_command", \{ p_command: "bundle\.resolve"/, "resolved through the company-scoped command, not a table read");
});

test("database: guards and wrappers are in place, the bundle register is private and the new tables are read-only to staff", () => {
  for (const name of ["olo_command_p5", "olo_verify_tasks_p5", "olo_run_all_p5", "olo_order_core_p5", "handoff_for_inspection_p5"]) assert.match(migration, new RegExp(`rename to ${name}`));
  assert.match(migration, /revoke all on private\.olo_bundle_register from public, anon, authenticated/);
  assert.match(migration, /grant select on public\.fg_transfers, public\.fg_transfer_bundles to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*fg_transfer/);
  assert.match(migration, /create trigger zzz_olo_p6_guard_fg before insert on public\.loading_scans/);
  assert.match(migration, /create trigger zzz_olo_p6_guard_fg before insert on public\.packing_list_items/);
  assert.match(migration, /You sent this transfer; another person must receive the bundles/);
  assert.match(migration, /'final_qc_release:' \|\| new\.id, 'packaging', 'quality_inspection'/, "the final-QC release uses an existing handoff source type");
});

test("live screens: transfers are published and subscribed", () => {
  for (const table of ["fg_transfers", "fg_transfer_bundles"]) {
    assert.ok(LIVE_TABLES.includes(table), table);
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(read("app/(dashboard)/packaging/fg-transfers/[id]/page.tsx"), /tables=\{\["fg_transfers", "fg_transfer_bundles"\]\}/);
});

test("Hindi: every Phase 6 label exists in both languages, placeholders match and the screens use the catalogue", () => {
  assert.deepEqual(Object.keys(PACKAGING_FLOW_HI).sort(), Object.keys(PACKAGING_FLOW_EN).sort());
  const vars = s => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  for (const [key, en] of Object.entries(PACKAGING_FLOW_EN)) {
    assert.equal(vars(PACKAGING_FLOW_HI[key]), vars(en), `${key} placeholders`);
    assert.equal(FLOOR_MESSAGES.en[key], en, `${key} is in the floor catalogue`);
  }
  for (const state of BUNDLE_STATES) assert.match(FLOOR_MESSAGES.hi[`pkf.state.${state}`], /[ऀ-ॿ]/, `${state} is Devanagari`);
  for (const basis of RELEASE_BASES) assert.ok(FLOOR_MESSAGES.en[`pkf.basis.${basis}`], basis);
  for (const s of [...FG_STATUSES.map(x => `pkf.status.${x}`), ...FG_LINE_STATES.map(x => `pkf.line.${x}`)]) assert.ok(FLOOR_MESSAGES.hi[s], s);
  assert.equal(floorText("hi")("pkf.fg.received", { tag: "B1", n: 2 }), "B1 प्राप्त। 2 स्कैन बाकी।");
  for (const [file, english] of [
    ["app/(dashboard)/packaging/release/page.tsx", ["Packaging release", "To pack", "Released by"]],
    ["app/(dashboard)/packaging/bundles/[id]/page.tsx", ["Missing records", "Finished goods", "Tax invoice"]],
    ["app/(dashboard)/packaging/fg-transfers/[id]/page.tsx", ["Scan bundles in", "Close with missing bundles"]],
    ["components/modules/orchestration/packaging-flow-forms.tsx", ["Send transfer", "Record arrival", "Holding location"]]
  ]) {
    const source = read(file);
    for (const text of english) assert.ok(!source.includes(`>${text}<`) && !source.includes(`"${text}"`), `${file} hard-codes "${text}"`);
  }
});
