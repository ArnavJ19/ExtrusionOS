import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";
import { FLOOR_MESSAGES, floorText, isFloorKey } from "../lib/i18n/floor.ts";
import { QUALITY_FLOW_EN, QUALITY_FLOW_HI } from "../lib/i18n/floor-quality-flow.ts";
import {
  QUALITY_STAGES, acceptableKg, belowSpec, collectResults, finalQcCommandSchema, finalQcJobSchema, finalQcRecordSchema, finalQcResultsSchema, qualityFlowSchema
} from "../lib/workflow/final-qc.ts";
import { TASK_KIND_LABELS, lifecycleSchema, orchestrationCommandSchema, settingsSchema, taskWorkLink } from "../lib/workflow/orchestration.ts";

// Orchestration Phase 5, application layer: final QC request validation, response shapes before and after the
// upgrade, the form helpers, task kinds and links, route access, live tables and the Hindi labels.
// The database rules are covered by order-lifecycle-orchestration-phase5-sql.
const id = "0e500000-0000-4000-8000-000000000001";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261124100000_order_lifecycle_orchestration_phase5.sql");
const LIVE_TABLES = read("lib/realtime/live.ts").match(/LIVE_TABLES = \[([\s\S]*?)\] as const/)[1].match(/"([a-z_]+)"/g).map(x => x.slice(1, -1));
const results = { tensile_strength_mpa: 205, samples_tested: 3 };
const record = extra => finalQcCommandSchema.safeParse({ command: "record", job_id: id, accepted_kg: 900, rejected_kg: 0, results, method: "Tensile test", sampling_reference: "QP-07 rev 2", ...extra });
const flow = {
  job_id: id, job_number: "JOB-1", order_id: id, job_status: "completed", route: { state: "required", source: "temper", detail: "Temper T5 is artificially aged", temper: "T5" },
  stage: "awaiting_final_qc", produced_kg: "1000", approved_kg: "1000", rejected_kg: 0, pending_kg: 0, rework_open_kg: 0, held_kg: 0, awaiting_decision_kg: 0, packed_kg: 0,
  loaded_kg: 1000, in_ageing_kg: 0, aged_accepted_kg: 950, aged_rejected_kg: 50, final_accepted_kg: 0, final_rejected_kg: 0, awaiting_ageing_kg: 0, awaiting_final_kg: 1000,
  packed_unaged_kg: 0, tolerance_kg: "1.000"
};

test("final QC requests need kilograms, results, the method and sampling plan, and a reason for any rejection", () => {
  assert.equal(record().success, true);
  assert.equal(record({ rejected_kg: 100, rejection_reason: "Hardness 7 HW on bundles 9 and 10" }).success, true);
  assert.equal(record({ rejected_kg: 100 }).success, false, "a rejection needs its reason");
  assert.equal(record({ accepted_kg: 0 }).success, false, "something must be accepted or rejected");
  assert.equal(record({ accepted_kg: -1 }).success, false);
  assert.equal(record({ method: "x" }).success, false);
  assert.equal(record({ sampling_reference: "" }).success, false);
  assert.equal(record({ results: { samples_tested: 3 } }).success, false, "at least one measured property or check");
  assert.equal(record({ results: { tensile_strength_mpa: 205 } }).success, false, "the sample count is required");
  assert.equal(record({ results: { ...results, samples_tested: 2.5 } }).success, false);
  assert.equal(record({ results: { ...results, density: 2.7 } }).success, false, "unknown results are refused");
  assert.equal(record({ results: { ...results, hardness_webster: 40 } }).success, false, "outside the possible range");
  assert.equal(record({ note: "A\u0007B" }).success, false);
  assert.equal(record({ company_id: id }).success, false, "company comes from the session, never the request");
  assert.equal(finalQcCommandSchema.safeParse({ command: "get", job_id: "nope" }).success, false);
  assert.equal(finalQcCommandSchema.safeParse({ command: "queue", view: "everything" }).success, false);
  assert.equal(finalQcResultsSchema.safeParse({ dimensional_ok: false, samples_tested: 1 }).success, true, "a failed check is a result");
});

test("the form sends only what was entered, offers at most what may be accepted and flags results below the profile minimums", () => {
  assert.deepEqual(collectResults({ hardness_webster: " 11 ", tensile_strength_mpa: "", yield_strength_mpa: "170" }, { dimensional: "passed", surface: "" }, "3"),
    { hardness_webster: 11, yield_strength_mpa: 170, samples_tested: 3, dimensional_ok: true });
  assert.deepEqual(collectResults({}, { dimensional: "", surface: "failed" }, ""), { surface_ok: false });
  assert.equal(acceptableKg({ max_accept_kg: 950, awaiting_final_kg: 1000 }), 950);
  assert.equal(acceptableKg({ max_accept_kg: 950, awaiting_final_kg: 400 }), 400);
  assert.equal(acceptableKg({ max_accept_kg: -3, awaiting_final_kg: 400 }), 0);
  assert.deepEqual(belowSpec({ tensile_strength_mpa: 205, elongation_percent: 7 }, { tensile_strength_mpa: 210, elongation_percent: 8 }), ["tensile_strength_mpa", "elongation_percent"]);
  assert.deepEqual(belowSpec({ tensile_strength_mpa: 215 }, { tensile_strength_mpa: 210 }), []);
  assert.deepEqual(belowSpec({ yield_strength_mpa: 100 }, {}), [], "nothing is assumed where the profile is silent");
  assert.deepEqual(belowSpec({ dimensional_ok: false }, {}), ["dimensional_ok"]);
});

test("response shapes: the quality flow, a job and a record read as numbers; lifecycle and settings parse before the upgrade", () => {
  const k = qualityFlowSchema.parse(flow);
  assert.deepEqual([k.produced_kg, k.tolerance_kg, k.stage], [1000, 1, "awaiting_final_qc"]);
  assert.equal(qualityFlowSchema.safeParse({ ...flow, stage: "somewhere" }).success, false);
  const job = finalQcJobSchema.parse({ ...flow, order_number: "SO-1", profile_code: "OM-2045", alloy: "6063", temper: "T5", spec: { tensile_strength_mpa: "210.00" }, batches: [],
    records: [], containment_number: null, max_accept_kg: "950", can_record: true, blocker: null, enforced: false });
  assert.deepEqual([job.spec.tensile_strength_mpa, job.max_accept_kg], [210, 950]);
  const r = finalQcRecordSchema.parse({ id, record_number: "FQC/26-27/0001", job_id: id, job_number: "J", order_id: null, order_number: null, profile_code: null, accepted_kg: "900",
    rejected_kg: "100", results: { samples_tested: 3, dimensional_ok: true }, method: "m", sampling_reference: "s", certificate_reference: null, temper_verified: "T5",
    rejection_reason: "Hardness below 8 HW", note: null, awaiting_before_kg: "1000", recorded_by_name: "QA", recorded_at: "2026-11-24T05:00:00Z" });
  assert.deepEqual([r.accepted_kg, r.reversals], [900, []]);
  const base = { billet_rank_threshold: 5, die_rank_threshold: 3, material_risk_horizon_days: 21, ack_sla_hours: 4, action_sla_hours: 24, enforce_die_preparation: false, enforce_preheat: false };
  const page = { can_edit: true, can_edit_routing: true, can_edit_standards: true, routing: [], standards: [], engine_errors: [] };
  assert.equal(settingsSchema.parse({ settings: base, ...page }).settings.enforce_qc_route, undefined, "before the upgrade the form hides the control");
  assert.equal(settingsSchema.parse({ settings: { ...base, enforce_qc_route: true, ageing_overdue_grace_minutes: 30 }, ...page }).settings.ageing_overdue_grace_minutes, 30);
  assert.match(read("components/modules/orchestration/settings-forms.tsx"), /phase5 = s\.enforce_qc_route !== undefined/, "Phase 5 fields are sent only once the database reports them");
  const save = extra => orchestrationCommandSchema.safeParse({ command: "settings.save", ...extra }).success;
  assert.equal(save({ enforce_qc_route: true, ageing_overdue_grace_minutes: 0 }), true);
  assert.equal(save({ ageing_overdue_grace_minutes: 721 }), false);
  assert.equal(save({ enforce_qc_route: "yes" }), false);
  const lc = lifecycleSchema.shape.quantities.parse({ ordered_kg: 1, produced_kg: 1, qc_accepted_kg: 1, qc_pending_kg: 0, qc_rejected_kg: 0, packed_kg: 0, dispatched_kg: 0, delivered_kg: 0, outstanding_kg: 1 });
  assert.equal(lc.final_released_kg, undefined, "a lifecycle from an older database still parses");
});

test("Phase 5 task kinds are named and link to the screen where the work is done", () => {
  for (const kind of ["initial_qc", "ageing_release", "ageing_cycle", "ageing_review", "final_qc"]) {
    assert.ok(TASK_KIND_LABELS[kind], kind);
    assert.match(migration, new RegExp(`'${kind}'`), `${kind} is in the task vocabulary`);
    assert.ok(isFloorKey(`olo.kind.${kind}`) && isFloorKey(`olo.work.${kind}`), `${kind} has floor labels`);
  }
  assert.deepEqual(taskWorkLink({ kind: "final_qc", order_id: null, job_id: id }), { href: `/quality/final-qc/${id}`, label: "Record final QC" });
  assert.equal(taskWorkLink({ kind: "ageing_review", order_id: null, source_id: id }).href, `/tasks/specialist/treatment/${id}`);
  assert.equal(taskWorkLink({ kind: "ageing_release", order_id: null }).href, "/tasks/specialist/new?action=treat.create");
  assert.equal(taskWorkLink({ kind: "initial_qc", order_id: null }).href, "/quality/new");
});

test("final QC pages are open to QA, production, packaging and management; never to sales, accounts or dealers", () => {
  for (const role of ["owner", "admin", "quality", "factory_manager", "production_manager", "production", "dispatch_manager", "viewer"]) assert.equal(hasRouteAccess("/quality/final-qc", role), true, role);
  for (const role of ["sales", "accounts", "dealer_admin", "dispatch"]) assert.equal(hasRouteAccess(`/quality/final-qc/${id}`, role), false, role);
});

test("live screens: final QC records are published and subscribed", () => {
  assert.ok(LIVE_TABLES.includes("final_qc_records"));
  assert.match(migration, /alter publication supabase_realtime add table public\.final_qc_records/);
  assert.match(read("app/(dashboard)/quality/final-qc/page.tsx"), /tables=\{\["final_qc_records"/);
});

test("Hindi: every Phase 5 label exists in both languages, placeholders match and the screens use the catalogue", () => {
  assert.deepEqual(Object.keys(QUALITY_FLOW_HI).sort(), Object.keys(QUALITY_FLOW_EN).sort());
  const vars = s => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  for (const [key, en] of Object.entries(QUALITY_FLOW_EN)) {
    assert.equal(vars(QUALITY_FLOW_HI[key]), vars(en), `${key} placeholders`);
    assert.equal(FLOOR_MESSAGES.en[key], en, `${key} is in the floor catalogue`);
  }
  for (const stage of QUALITY_STAGES) assert.match(FLOOR_MESSAGES.hi[`fqc.stage.${stage}`], /[ऀ-ॿ]/, `${stage} is Devanagari`);
  assert.equal(floorText("hi")("fqc.detailTitle", { job: "JOB-7" }), "अंतिम QC — काम JOB-7");
  for (const [file, english] of [
    ["app/(dashboard)/quality/final-qc/page.tsx", ["Ageing and final QC", "Awaiting final QC", "Final QC records"]],
    ["app/(dashboard)/quality/final-qc/[jobId]/page.tsx", ["Profile minimums", "Ageing batches of this job", "Released by final QC"]],
    ["components/modules/orchestration/final-qc-forms.tsx", ["Record final QC", "Test method", "Samples tested"]]
  ]) {
    const source = read(file);
    for (const text of english) assert.ok(!source.includes(`>${text}<`) && !source.includes(`"${text}"`), `${file} hard-codes "${text}"`);
  }
});

test("the migration is additive, keeps records immutable and changes one earlier function where it says so", () => {
  assert.equal((migration.match(/-- Phase 5:/g) ?? []).length, 1);
  assert.match(migration, /create trigger final_qc_records_append_only before update or delete on public\.final_qc_records/);
  assert.match(migration, /alter table public\.final_qc_records enable row level security/);
  assert.match(migration, /revoke all on public\.final_qc_records from public, anon, authenticated;\s*grant select on public\.final_qc_records to authenticated;/);
  assert.match(migration, /add column if not exists enforce_qc_route boolean not null default false/, "the control defaults off");
  assert.match(migration, /\\mageing\\M\|\\maging\\M/, "the routing match uses whole words, so packaging is not ageing");
  assert.doesNotMatch(migration, /drop table|drop column|disable row level security/i);
  for (const fn of ["olo_verify_tasks", "olo_run_all", "olo_order_core", "olo_command"]) assert.match(migration, new RegExp(`alter function (public|private)\\.${fn}\\(`), `${fn} is wrapped`);
});
