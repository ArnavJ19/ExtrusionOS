import test from "node:test";
import assert from "node:assert/strict";
import { createFloorFixture, pIds as i } from "../scripts/lib/autopilot-batch6-fixture.mjs";
import { planBilletLength } from "../lib/calculations/billet-length.ts";

let f;
test.before(async () => { f = await createFloorFixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });
const plan = (command, payload = {}, actor = i.productionManager) => f.ap("ap_press_plan", command, payload, actor);
const press2 = { machine_id: i.press2, min_billet_mm: 400, max_billet_mm: 1100, standard_billet_mm: 900, container_diameter_mm: 185, butt_mm: 25, runout_m: 70, front_crop_m: 0.5, back_crop_m: 0.5, step_mm: 10 };

// ---------------------------------------------------------------- AP-061
test("AP-061 without shift capacity every job is listed with the reason; with capacity jobs are placed with reasons", async () => {
  const a = await f.plannedJob({ die: i.die, kg: 300, due: 2 });
  let v = await plan("prepare");
  assert.ok(v.unscheduled.some(u => u.job_id === a.job && u.reasons.some(r => /No press shift capacity/.test(r))));
  await f.shifts();
  const short = await f.plannedJob({ die: i.die2, kg: 200, due: 1, billetsShort: 4 });
  const b = await f.plannedJob({ die: i.die, kg: 300, due: 3 });
  v = await plan("prepare");
  assert.equal(v.draft.status, "draft");
  const la = v.lines.find(l => l.job_id === a.job), lb = v.lines.find(l => l.job_id === b.job);
  assert.ok(la && lb, JSON.stringify(v.unscheduled));
  assert.equal(la.machine_id, lb.machine_id, "the same die stays on one press");
  assert.ok(lb.reasons.some(r => /no die change/.test(r)));
  assert.ok(Date.parse(lb.planned_start_at) >= Date.parse(la.planned_end_at), "lines do not overlap");
  assert.ok(v.unscheduled.find(u => u.job_id === short.job).reasons.some(r => /Billets short: 4/.test(r)));
  assert.equal(v.draft.edit_count, 0);
  assert.equal(v.published.length, 0);
});

test("AP-061 a large job is placed partially; edits are counted; publishing goes through the schedule writer once", async () => {
  await f.shifts({ kg: 800 });
  const big = await f.plannedJob({ die: i.die2, kg: 1200, due: 1 });
  const small = await f.plannedJob({ die: i.die, kg: 200, due: 2 });
  let v = await plan("prepare");
  const lbig = v.lines.find(l => l.job_id === big.job);
  assert.equal(Number(lbig.capacity_kg), 800);
  assert.ok(lbig.reasons.some(r => /Partial: 800/.test(r)));
  await assert.rejects(() => plan("edit_line", { line_id: lbig.id, remove: true }, i.production), e => e.code === "42501");
  v = await plan("edit_line", { line_id: v.lines.find(l => l.job_id === small.job).id, remove: true });
  assert.equal(v.draft.edit_count, 1);
  v = await plan("edit_line", { line_id: v.lines.find(l => l.job_id === small.job).id, remove: true });
  assert.equal(v.draft.edit_count, 2);
  assert.equal(v.lines.filter(l => !l.removed).length >= 2, true);
  const published = await plan("publish", { draft_id: v.draft.id });
  assert.equal(published.state, "published");
  const slots = await f.db.query("select production_job_id, status, capacity_kg from production_plan_slots where production_job_id = any($1)", [[big.job, small.job]]);
  assert.equal(slots.rows.length, 2); assert.ok(slots.rows.every(s => s.status === "scheduled"));
  assert.equal((await plan("publish", { draft_id: v.draft.id })).repeated, true);
  const night = await f.one("select private.ap6_plan_job($1,null) data", [i.company]);
  assert.match(night.data.details.reason, /already published/);
  const history = await plan("history", {}, i.viewer);
  assert.equal(history.published_last_10.count, 1); assert.equal(history.published_last_10.under_five_edits, 1);
});

test("AP-061 a line the writer refuses blocks the whole publish; the nightly job keeps an edited draft", async () => {
  await f.shifts({ kg: 800 });
  const a = await f.plannedJob({ die: i.die, kg: 300, due: 1 });
  const b = await f.plannedJob({ die: i.die2, kg: 300, due: 1 });
  let v = await plan("prepare");
  const la = v.lines.find(l => l.job_id === a.job);
  v = await plan("edit_line", { line_id: la.id, machine_id: la.machine_id, shift: la.shift, planned_start_at: la.planned_start_at, planned_end_at: la.planned_end_at, capacity_kg: 5000 });
  await assert.rejects(() => plan("publish", { draft_id: v.draft.id }), /cannot be scheduled as drafted/);
  assert.equal((await f.one("select count(*)::int n from production_plan_slots where production_job_id = any($1)", [[a.job, b.job]])).n, 0, "nothing was published");
  const kept = await f.one("select private.ap6_plan_job($1,null) data", [i.company]);
  assert.match(kept.data.details.reason, /edited/);
  await assert.rejects(() => plan("prepare", { date: "2020-01-01" }), /today to 14 days/);
  assert.equal((await plan("draft", {}, i.production)).can_plan, false);
});

// ---------------------------------------------------------------- AP-029
test("AP-029 options come from press limits; the choice is checked against limits, inputs and job state", async () => {
  const inputs0 = await f.ap("ap_billet_length", "job_inputs", { job_id: i.jobC });
  assert.equal(inputs0.presses.length, 0, "no press limits, no recommendation");
  assert.equal(planBilletLength({ kg_per_m: 0.95, cut_length_m: 6, billet_diameter_mm: 178, extrusion_ratio: null }, null).ok, false);
  await assert.rejects(() => f.ap("ap_billet_length", "save_press", press2, i.production), e => e.code === "42501");
  await f.ap("ap_billet_length", "save_press", press2);
  const inputs = await f.ap("ap_billet_length", "job_inputs", { job_id: i.jobC }, i.production);
  assert.equal(Number(inputs.kg_per_m), 0.95); assert.equal(Number(inputs.cut_length_m), 6); assert.equal(Number(inputs.billet_diameter_mm), 178);
  const p = inputs.presses[0];
  const result = planBilletLength({ kg_per_m: 0.95, cut_length_m: 6, billet_diameter_mm: 178, extrusion_ratio: null },
    { ...p, min_billet_mm: +p.min_billet_mm, max_billet_mm: +p.max_billet_mm, standard_billet_mm: +p.standard_billet_mm, container_diameter_mm: +p.container_diameter_mm, butt_mm: +p.butt_mm, runout_m: +p.runout_m, front_crop_m: +p.front_crop_m, back_crop_m: +p.back_crop_m, step_mm: +p.step_mm });
  assert.equal(result.ok, true);
  assert.ok(result.recommended.recovery_percent >= result.standard.recovery_percent);
  const choice = { job_id: i.jobC, machine_id: i.press2, chosen_mm: result.recommended.billet_mm, recommended_mm: result.recommended.billet_mm, standard_mm: 900,
    chosen_recovery: result.recommended.recovery_percent, recommended_recovery: result.recommended.recovery_percent, standard_recovery: result.standard.recovery_percent, options: result.options, inputs_fingerprint: inputs.fingerprint };
  await assert.rejects(() => f.ap("ap_billet_length", "record_choice", { ...choice, chosen_mm: 1500 }), /between/);
  await assert.rejects(() => f.ap("ap_billet_length", "record_choice", { ...choice, chosen_mm: 401 }), /listed lengths/);
  await assert.rejects(() => f.ap("ap_billet_length", "record_choice", { ...choice, job_id: i.jobA }), /before the job runs/);
  assert.equal((await f.ap("ap_billet_length", "record_choice", choice)).saved, true);
  assert.equal((await f.ap("ap_billet_length", "record_choice", choice)).saved, true);
  assert.equal((await f.one("select count(*)::int n from job_billet_length_choices where production_job_id=$1 and superseded_at is null", [i.jobC])).n, 1, "one current choice");
  await f.ap("ap_billet_length", "save_press", { ...press2, butt_mm: 30 });
  await assert.rejects(() => f.ap("ap_billet_length", "record_choice", choice), /changed/);
  const s = await f.ap("ap_billet_length", "summary", {});
  assert.equal(s.jobs, 1); assert.equal(Number(s.avg_chosen_recovery) >= Number(s.avg_standard_recovery), true);
});

// ---------------------------------------------------------------- AP-094
test("AP-094 a queued press push posts exactly once; a reused identity with other details is refused", async () => {
  const entry = { id: f.next(), session_id: i.session, job_id: i.jobA, client_at: new Date(Date.now() - 60000).toISOString() };
  const request = { request_id: entry.id, rpc: "ap_press", command: "push", payload: entry, queued_at: entry.client_at };
  const first = await f.ap("ap_offline", "submit", request, i.production);
  assert.equal(first.state, "applied"); assert.equal(first.replayed, false);
  const again = await f.ap("ap_offline", "submit", request, i.production);
  assert.equal(again.replayed, true); assert.deepEqual(again.result, first.result);
  assert.equal((await f.one("select count(*)::int n from production_push_events where id=$1", [entry.id])).n, 1);
  await assert.rejects(() => f.ap("ap_offline", "submit", { ...request, payload: { ...entry, job_id: i.jobB } }, i.production), /different details/);
  await assert.rejects(() => f.ap("ap_offline", "submit", request, i.backup), /different details/);
  await assert.rejects(() => f.ap("ap_offline", "submit", { ...request, request_id: f.next(), rpc: "ap_reprice", command: "apply" }, i.production), /cannot be sent from the offline queue/);
});

test("AP-094 a refused entry becomes a conflict that is kept, replayed and resolved by its own employee", async () => {
  const entry = { id: f.next(), session_id: i.session, job_id: i.jobC };
  const request = { request_id: entry.id, rpc: "ap_press", command: "push", payload: entry };
  const r = await f.ap("ap_offline", "submit", request, i.production);
  assert.equal(r.state, "conflict"); assert.ok(r.message.length > 5);
  assert.equal((await f.one("select count(*)::int n from production_push_events where id=$1", [entry.id])).n, 0, "nothing posted");
  assert.equal((await f.ap("ap_offline", "submit", request, i.production)).state, "conflict");
  assert.equal((await f.ap("ap_offline", "conflicts", {}, i.backup)).total_count, 0, "another employee does not see it");
  assert.equal((await f.ap("ap_offline", "conflicts", {}, i.production)).total_count, 1);
  assert.equal((await f.ap("ap_offline", "resolve", { request_id: entry.id, resolution: "discarded" }, i.production)).resolved, true);
  await assert.rejects(() => f.ap("ap_offline", "resolve", { request_id: entry.id, resolution: "discarded" }, i.production), /already resolved/);
  await assert.rejects(() => f.asUser("select count(*) from offline_receipts", [], i.production), e => e.code === "42501");
});
