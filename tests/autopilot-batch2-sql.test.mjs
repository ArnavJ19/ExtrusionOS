import test from "node:test";
import assert from "node:assert/strict";
import { createPressFixture, pIds as i, nid } from "../scripts/lib/autopilot-batch2-fixture.mjs";

let f;
test.before(async () => { f = await createPressFixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const n = value => (value === null || value === undefined ? value : Number(value));
const count = async (sql, params = []) => Number((await f.one(sql, params)).c);
/** Insert rows as the database owner with triggers off (to place pushes in the past). */
async function seed(sql, params = []) {
  await f.db.exec("savepoint ap2_seed; set session_replication_role = replica");
  try { await f.db.query(sql, params); await f.db.exec("set session_replication_role = origin; release savepoint ap2_seed"); }
  catch (error) { await f.db.exec("rollback to savepoint ap2_seed; set session_replication_role = origin; release savepoint ap2_seed"); throw error; }
}
/** Run a statement that is expected to fail without aborting the test transaction. */
async function raw(sql, params = []) {
  await f.db.exec("savepoint ap2_raw");
  try { const r = await f.db.query(sql, params); await f.db.exec("release savepoint ap2_raw"); return r; }
  catch (error) { await f.db.exec("rollback to savepoint ap2_raw; release savepoint ap2_raw"); throw error; }
}
async function oldPush(job, seq, minutesAgo, { die = i.die, billet = null, kg = null, machine = i.press, source = "tap" } = {}) {
  await seed(`insert into production_push_events(id,company_id,production_job_id,machine_id,die_id,kind,source,seq,operator_id,billet_id,billet_kg,billet_kg_basis,billet_diameter_mm,event_at,recorded_at)
    values(gen_random_uuid(),$1,$2,$3,$4,'push',$5,$6,$7,$8,$9,$10,178,now()-make_interval(mins=>$11),now()-make_interval(mins=>$11))`,
    [i.company, job, machine, die, source, seq, i.production, billet, kg, kg === null ? null : "linked_billet", minutesAgo]);
}
const proposalFor = async (type, target) => f.one("select * from proposals where proposal_type=$1 and target_key=$2 and status='open'", [type, target]);
const decide = (id, decision, extra = {}, actor = i.production) => f.call("ap_proposals", "decide", { id, decision, ...extra }, actor);

test("AP-011 one tap records a push from the job's linked billet; double taps, replays, wrong press and closed jobs are refused", async () => {
  const first = await f.push(-120);
  assert.equal(first.state, "recorded");
  assert.equal(first.seq, 1);
  assert.equal(n(first.billet_kg), 60);
  assert.equal(first.billet_kg_basis, "linked_billet");
  const replay = await f.press("push", { id: first.id, session_id: i.session, job_id: i.jobA }, i.production);
  assert.equal(replay.state, "replayed");
  const double = await f.push(-118);
  assert.equal(double.state, "double_tap");
  const second = await f.push(-60);
  assert.equal(second.seq, 2);
  const billets = await f.db.query("select billet_id from production_push_events where production_job_id=$1 and kind='push' order by seq", [i.jobA]);
  assert.deepEqual(billets.rows.map(r => r.billet_id), [i.billets[0], i.billets[1]], "billets are taken in billet order");
  await assert.rejects(() => f.press("push", { id: nid(9001), session_id: i.session, job_id: i.jobC }, i.production), /not planned on this press/);
  await f.db.query("update production_jobs set machine_id=$1 where id=$2", [i.press, i.jobC]);
  await assert.rejects(() => f.press("push", { id: nid(9002), session_id: i.session, job_id: i.jobC }, i.production), /Start the job/);
  await assert.rejects(() => f.press("push", { id: nid(9003), session_id: i.session, job_id: i.jobA }, i.backup), /session expired/, "another operator's session cannot be used");
  await assert.rejects(() => f.press("push", { id: nid(9004), session_id: i.session, job_id: i.jobA }, i.sales), err => err.code === "42501");
  await assert.rejects(() => f.press("push", { id: nid(9005), session_id: i.session, job_id: i.foreignJob }, i.production), /not planned on this press/);
  await assert.rejects(() => raw("update production_push_events set billet_kg=1 where id=$1", [first.id]), /cannot be changed/);
  await assert.rejects(() => raw("delete from production_push_events where id=$1", [first.id]), /cannot be changed/);
  await f.db.query("update workstation_sessions set expires_at=now()-interval '1 second' where id=$1", [i.session]);
  await assert.rejects(() => f.push(0), /session expired/);
});

test("AP-011 a tap renews the station session, and undo works only for the same operator within 30 seconds", async () => {
  await f.db.query("update workstation_sessions set expires_at=clock_timestamp()+interval '2 minutes' where id=$1", [i.session]);
  const tap = await f.push(0);
  assert.ok(Date.parse(tap.expires_at) > Date.now() + 8 * 60 * 1000, "activity extends the session to ten minutes");
  await assert.rejects(() => f.press("undo", { session_id: i.session2, push_id: tap.id }, i.backup), /same operator/);
  const undone = await f.press("undo", { session_id: i.session, push_id: tap.id });
  assert.equal(undone.state, "undone");
  assert.equal((await f.press("undo", { session_id: i.session, push_id: tap.id })).state, "already_undone");
  const again = await f.push(30);
  const row = await f.one("select billet_id from production_push_events where id=$1", [again.id]);
  assert.equal(row.billet_id, i.billets[0], "the voided push freed its billet");
  await oldPush(i.jobA, 99, 5, { billet: i.billets[3], kg: 60 });
  const old = await f.one("select id from production_push_events where seq=99");
  await assert.rejects(() => f.press("undo", { session_id: i.session, push_id: old.id }), /30 seconds/);
  await assert.rejects(() => f.press("void", { push_id: old.id, reason: "Wrong tap" }, i.production), err => err.code === "42501");
  assert.equal((await f.press("void", { push_id: old.id, reason: "Operator tapped twice on a die trial" }, i.productionManager)).state, "voided");
  assert.equal(await count("select count(*) c from private.ap2_pushes where production_job_id=$1", [i.jobA]), 1);
});

test("AP-012/013 expected output, engineering scrap and completion from the proposal with only rejects entered", async () => {
  for (const offset of [-400, -300, -200, -100]) await f.push(offset);
  const prepared = await f.press("expected", { job_id: i.jobA });
  assert.equal(prepared.state, "ready");
  const p = await proposalFor("production.expected_output", i.jobA);
  assert.equal(p.payload.good_pieces, 40);
  assert.equal(n(p.payload.good_kg), 228);
  assert.equal(n(p.payload.butt_kg), 6.72, "4 x 1.680 kg butt");
  assert.equal(n(p.payload.crop_kg), 3.8);
  assert.equal(n(p.payload.saw_kg), 0.152);
  assert.equal(n(p.payload.cutoff_kg), 1.328);
  assert.deepEqual(p.payload.bundles, { per_bundle: 10, full: 4, loose: 0 });
  await assert.rejects(() => decide(p.id, "edit", { payload: { reject_pieces: 2 } }), /reason for the rejects/);
  await assert.rejects(() => decide(p.id, "edit", { payload: { reject_pieces: 41, reject_reason: "surface" } }), /more than the expected pieces/);
  await assert.rejects(() => decide(p.id, "accept", {}, i.quality), /not available to you/);
  const result = await decide(p.id, "edit", { payload: { reject_pieces: 2, reject_reason: "surface" } });
  assert.equal(result.state, "edited");
  assert.deepEqual(result.edited_fields.sort(), ["reject_pieces", "reject_reason"]);
  const job = await f.one("select status, actual_quantity_kg, actual_pieces from production_jobs where id=$1", [i.jobA]);
  assert.deepEqual({ status: job.status, kg: n(job.actual_quantity_kg), pieces: job.actual_pieces }, { status: "completed", kg: 216.6, pieces: 38 });
  const lines = await f.db.query("select category, weight_kg, scrap_kind, scrap_basis from production_scrap_lines where production_job_id=$1 order by category", [i.jobA]);
  assert.deepEqual(lines.rows.map(r => [r.category, n(r.weight_kg), r.scrap_kind, r.scrap_basis]), [
    ["butt_end", 6.72, "engineering", "derived"], ["front_back_end", 5.128, "engineering", "derived"], ["rejects", 11.4, "process", "entered"], ["saw_cut", 0.152, "engineering", "derived"]]);
  const d = await f.one("select * from production_scrap_derivations where production_job_id=$1", [i.jobA]);
  assert.equal(n(d.billet_kg), 240);
  assert.equal(n(d.crop_kg) + n(d.cutoff_kg), 5.128);
  const view = await f.press("job", { job_id: i.jobA }, i.productionManager);
  assert.equal(n(view.recovery_percent), 90.25, "216.6 / 240 without any scrap typed by a person");
  assert.equal((await decide(p.id, "edit", { payload: { reject_pieces: 2, reject_reason: "surface" } })).repeated, true);
});

test("AP-012 a proposal goes stale when pushes change, and unpushed billets or missing inputs block it (blank, never zero)", async () => {
  for (const offset of [-300, -200, -100]) await f.push(offset);
  let prepared = await f.press("expected", { job_id: i.jobA });
  assert.equal(prepared.state, "not_ready");
  assert.match(prepared.expected.blockers.join(" "), /1 linked billet\(s\) have no push/);
  assert.equal(prepared.expected.expected.good_pieces, 30, "expected shown while blocked");
  await f.push(0);
  prepared = await f.press("expected", { job_id: i.jobA });
  const p = await proposalFor("production.expected_output", i.jobA);
  await seed("insert into foundry_billets(id,company_id,foundry_batch_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,temper,weight_kg,production_job_id,status,source_type,alloy) values(gen_random_uuid(),$1,$2,'B-A-X',99,7,178,900,'T5',60,$3,'issued','in_house','6063')", [i.company, i.batch, i.jobA]);
  const stale = await decide(p.id, "accept");
  assert.equal(stale.state, "stale");
  assert.equal((await f.one("select status from production_jobs where id=$1", [i.jobA])).status, "in_progress");

  await seed("update production_jobs set length_per_piece_m=null, cl_meter=null where id=$1", [i.jobNoWeight]);
  await f.db.query("update workstation_sessions set machine_id=$1 where id=$2", [i.press2, i.session]);
  await f.push(0, {}, i.production, i.session, i.jobNoWeight);
  const blank = await f.press("expected", { job_id: i.jobNoWeight });
  assert.equal(blank.state, "not_ready");
  assert.equal(blank.expected.expected, null);
  assert.equal(blank.expected.cut_m, null);
  assert.match(blank.expected.missing.join(" "), /Cut length/);
});

test("AP-013 standards are versioned and only the owner approves; the newest approved standard replaces the old one", async () => {
  const proposed = await f.call("ap_scrap", "propose", { butt_length_mm: 30, front_crop_mm: 400, back_crop_mm: 600, saw_kerf_mm: 4.5, rationale: "Trial on Press 1 in November" }, i.productionManager);
  assert.equal(proposed.standard.version, 2);
  await assert.rejects(() => f.call("ap_scrap", "propose", { butt_length_mm: 30, front_crop_mm: 0, back_crop_mm: 0, saw_kerf_mm: 4, rationale: "x" }, i.production), err => err.code === "42501");
  await assert.rejects(() => f.call("ap_scrap", "approve", { id: proposed.standard.id }, i.productionManager), /Only the owner/);
  await f.call("ap_scrap", "approve", { id: proposed.standard.id }, i.owner);
  assert.equal((await f.one("select status from scrap_standards where id=$1", [i.standard])).status, "retired");
  const die = await f.call("ap_scrap", "propose", { die_id: i.die, butt_length_mm: 20, front_crop_mm: 300, back_crop_mm: 300, saw_kerf_mm: 4, rationale: "Die-specific butt" }, i.productionManager);
  await f.call("ap_scrap", "approve", { id: die.standard.id }, i.owner);
  const applied = await f.one("select (private.ap2_standard($1,$2,$3)).butt_length_mm b", [i.company, i.press, i.die]);
  assert.equal(n(applied.b), 20, "a die-specific standard wins over the company default");
  await assert.rejects(() => f.call("ap_scrap", "propose", { machine_id: i.press, die_id: i.die, butt_length_mm: 20, front_crop_mm: 0, back_crop_mm: 0, saw_kerf_mm: 4, rationale: "Both scopes" }, i.productionManager), /not both/);
  const month = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
  await f.call("ap_scrap", "weigh", { month, weighed_kg: 1250.5, reference: "WB-1102" }, i.inventory);
  const rec = await f.call("ap_scrap", "reconcile", { month }, i.productionManager);
  assert.equal(n(rec.weighed_kg), 1250.5);
});

test("AP-014 idle gaps: the operator's reason is stored against the gap, the next push closes it, and unanswered gaps stay unexplained", async () => {
  await oldPush(i.jobA, 1, 30, { billet: i.billets[0], kg: 60 });
  const station = await f.press("station", { session_id: i.session });
  assert.ok(station.idle, "press idle beyond the 8-minute default");
  assert.equal(station.idle.reason, null);
  await assert.rejects(() => f.press("idle_answer", { session_id: i.session, reason: "other" }), /Note is required/);
  const answered = await f.press("idle_answer", { session_id: i.session, reason: "billet_shortage" });
  assert.equal(answered.reason, "billet_shortage");
  await f.push(0);
  const interval = await f.one("select reason, gap_end is not null closed, source from press_idle_intervals where id=$1", [answered.id]);
  assert.deepEqual(interval, { reason: "billet_shortage", closed: true, source: "operator" });
  await assert.rejects(() => f.press("idle_answer", { session_id: i.session, reason: "power" }), /not idle yet/);

  await oldPush(i.jobB, 1, 120, { die: i.die2, billet: i.billetsB[0], kg: 60 });
  await oldPush(i.jobB, 2, 90, { die: i.die2, billet: i.billetsB[1], kg: 60 });
  const run = await f.call("ap_jobs", "run_now", { job_key: "press.idle_reconcile" }, i.owner);
  assert.equal(run.state, "succeeded");
  const unexplained = await f.db.query("select reason, suggested_reason, source from press_idle_intervals where reason is null");
  assert.ok(unexplained.rows.length >= 1);
  assert.ok(unexplained.rows.every(r => r.reason === null && r.source === "reconciliation"), "never auto-assigned a reason");
  const report = await f.press("downtime", {}, i.productionManager);
  assert.ok(n(report.totals.idle_minutes) > 0);
  assert.ok(n(report.totals.coverage_percent) < 100);
  const gap = report.unexplained.rows[0];
  await assert.rejects(() => f.press("idle_answer", { interval_id: gap.id, reason: "power" }, i.production), err => err.code === "42501");
  await f.press("idle_answer", { interval_id: gap.id, reason: "power" }, i.productionManager);
  assert.equal((await f.one("select reason from press_idle_intervals where id=$1", [gap.id])).reason, "power");
});

test("AP-015 a die change is derived from the job sequence; only supervisors correct its duration", async () => {
  await oldPush(i.jobB, 1, 50, { die: i.die2, billet: i.billetsB[0], kg: 60 });
  const tap = await f.push(-120);
  assert.equal(tap.die_change, true);
  const change = await f.one("select * from press_die_changes where to_job_id=$1", [i.jobA]);
  assert.equal(change.from_die_id, i.die2);
  assert.equal(change.to_die_id, i.die);
  assert.ok(change.duration_seconds >= 47 * 60 && change.duration_seconds <= 49 * 60, String(change.duration_seconds));
  const second = await f.push(-60);
  assert.equal(second.die_change, false);
  await assert.rejects(() => f.press("die_change_correct", { id: change.id, duration_minutes: 35, note: "Clock was wrong" }, i.production), /Only a supervisor/);
  await f.press("die_change_correct", { id: change.id, note: "Bolster swap needed" }, i.production);
  await f.press("die_change_correct", { id: change.id, duration_minutes: 35, note: "Timed on the floor" }, i.productionManager);
  const weekly = await f.press("die_changes", {}, i.productionManager);
  assert.equal(weekly.summary[0].count, 1);
  assert.equal(n(weekly.summary[0].avg_minutes), 35);
  assert.equal(weekly.rows[0].notes.length, 2);
});

test("AP-016 sampling triggers create QC samples from pushes, missed samples block QC release until recorded or waived", async () => {
  const save = (kind, extra) => f.call("ap_sampling", "trigger_save", { plan_id: i.plan, kind, blocks_release: true, ...extra }, i.quality);
  await assert.rejects(() => save("every_n_pushes", {}), /Every how many/);
  await assert.rejects(() => f.call("ap_sampling", "trigger_save", { plan_id: i.plan, kind: "last_piece", blocks_release: true }, i.production), err => err.code === "42501");
  await save("every_n_pushes", { every_n: 2 });
  await save("first_after_die_change", { item_ids: [i.item2] });
  await save("last_piece", {});
  await f.push(-400);
  assert.equal(await count("select count(*) c from qc_sample_requirements where production_job_id=$1 and kind='first_after_die_change'", [i.jobA]), 1, "first known push on the press");
  await f.push(-300);
  await f.push(-200);
  await f.push(-100);
  const reqs = await f.db.query("select occurrence_key, status from qc_sample_requirements where production_job_id=$1 order by due_at, occurrence_key", [i.jobA]);
  assert.deepEqual(reqs.rows.map(r => `${r.occurrence_key}:${r.status}`), ["first:missed", "push:2:missed", "push:4:open"]);
  assert.ok(await count("select count(*) c from notifications where notification_type='qc_sample_due'") >= 3);
  await assert.rejects(() => f.asUser("insert into quality_inspections(company_id,production_job_id,profile_id,status,inspection_date) values($1,$2,$3,'approved',now())", [i.company, i.jobA, i.profile2], i.quality), /in-process sample/);
  const sample = await f.one("select id from qc_sample_requirements where occurrence_key='push:2'");
  const detail = await f.call("ap_sampling", "sample", { id: sample.id }, i.quality);
  assert.equal(detail.items.length, 2);
  await assert.rejects(() => f.call("ap_sampling", "sample_record", { id: sample.id, results: [{ item_id: i.item1, visual_ok: true }, { item_id: i.item2, visual_ok: true }] }, i.quality), /measured value for Wall thickness/);
  await assert.rejects(() => f.call("ap_sampling", "sample_record", { id: sample.id, results: [{ item_id: i.item1, observed: 1.4 }] }, i.quality), /Record Surface/);
  await assert.rejects(() => f.call("ap_sampling", "sample_record", { id: sample.id, results: [{ item_id: i.item1, observed: 1.4 }, { item_id: i.item2, visual_ok: true }] }, i.production), err => err.code === "42501");
  const recorded = await f.call("ap_sampling", "sample_record", { id: sample.id, results: [{ item_id: i.item1, observed: 1.6 }, { item_id: i.item2, visual_ok: true }] }, i.quality);
  assert.deepEqual({ failed: recorded.failed, late: recorded.late }, { failed: 1, late: true });
  assert.ok(await count("select count(*) c from notifications where notification_type='qc_sample_failed'") >= 1);
  for (const key of ["first", "push:4"]) {
    const r = await f.one("select id from qc_sample_requirements where occurrence_key=$1", [key]);
    await f.call("ap_sampling", "sample_waive", { id: r.id, reason: "Checked on the previous shift's sheet" }, i.quality);
  }
  const summary = (await f.press("job", { job_id: i.jobA }, i.productionManager)).sampling;
  assert.deepEqual([summary.required, summary.late, summary.waived, summary.blocking_open].map(Number), [3, 1, 2, 0]);
  await assert.rejects(() => f.asUser("insert into quality_inspections(company_id,production_job_id,profile_id,status,inspection_date) values($1,$2,$3,'approved',now())", [i.company, i.jobA, i.profile2], i.quality),
    error => !/in-process sample/.test(error.message), "the sampling guard no longer refuses release");
});

test("AP-016 a last-piece sample is required when the job completes and is marked missed after its window", async () => {
  await f.call("ap_sampling", "trigger_save", { plan_id: i.plan, kind: "last_piece", blocks_release: false }, i.quality);
  await f.asUser("select public.complete_production_job_with_scrap_atomic($1,114,20,null,$2::jsonb,null)", [i.jobB, JSON.stringify([{ category: "butt_end", weight_kg: 6 }])], i.productionManager);
  const last = await f.one("select id, status from qc_sample_requirements where production_job_id=$1 and kind='last_piece'", [i.jobB]);
  assert.equal(last.status, "open");
  await f.db.query("update qc_sample_requirements set window_ends_at=clock_timestamp()-interval '1 minute' where id=$1", [last.id]);
  const run = await f.call("ap_jobs", "run_now", { job_key: "quality.sample_windows" }, i.owner);
  assert.equal(run.state, "succeeded", JSON.stringify(run));
  assert.equal((await f.one("select status from qc_sample_requirements where id=$1", [last.id])).status, "missed");
});

test("AP-028 push counters reach the die interval, a proposal books the service, and recording it resets the counters", async () => {
  await seed(`insert into die_service_thresholds(id,company_id,die_type,basis,service_event,warn_at,rationale,status,proposed_by,proposed_at,approved_by,approved_at)
    values($1,$2,'solid','pushes_since_service','nitriding',3,'Nitride solid dies every 3 pushes (fixture)','approved',$3,now(),$4,now())`, [i.threshold, i.company, i.productionManager, i.owner]);
  await f.push(-300);
  let service = await f.call("ap_dies", "service", { die_id: i.die }, i.production);
  assert.equal(service.state, "ok");
  assert.equal(service.due_in_pushes, 2);
  await f.push(-200);
  service = await f.call("ap_dies", "service", { die_id: i.die }, i.production);
  assert.equal(service.due_in_pushes, 1);
  await f.push(-100);
  service = await f.call("ap_dies", "service", { die_id: i.die }, i.production);
  assert.deepEqual([service.state, service.flag, service.due_in_pushes], ["due", "due_unbooked", 0]);
  const flags = await f.call("ap_dies", "flags", {}, i.quality);
  assert.equal(flags.rows[0].die_id, i.die);
  const options = await f.call("ap_dies", "options", { profile_id: i.profile2 }, i.productionManager);
  assert.equal(options.rows.find(r => r.id === i.die).due_in_pushes, 0, "die selection shows the hint");
  await f.call("ap_jobs", "run_now", { job_key: "dies.predict_service" }, i.owner);
  const p = await proposalFor("die.service_due", `${i.die}:nitriding`);
  assert.ok(p);
  await assert.rejects(() => decide(p.id, "accept", {}, i.production), /not available to you/);
  const tomorrow = new Date(Date.now() + 5.5 * 3600e3 + 86400e3 * 2).toISOString().slice(0, 10);
  const accepted = await decide(p.id, "edit", { payload: { scheduled_for: tomorrow } }, i.productionManager);
  assert.equal(accepted.state, "edited");
  service = await f.call("ap_dies", "service", { die_id: i.die }, i.production);
  assert.equal(service.flag, "due_booked");
  await f.db.query("delete from system_job_runs where job_key='dies.predict_service'");
  await f.call("ap_jobs", "run_now", { job_key: "dies.predict_service" }, i.owner);
  assert.equal(await count("select count(*) c from proposals where proposal_type='die.service_due'"), 1, "booked dies are not proposed again");
  await f.call("ap_dies", "booking_close", { id: service.bookings[0].id, status: "done", note: "Nitrided at Shree Works" }, i.productionManager);
  assert.equal(await count("select count(*) c from die_nitriding_history where die_id=$1 and status='completed'", [i.die]), 1);
  service = await f.call("ap_dies", "service", { die_id: i.die }, i.production);
  assert.equal(service.service.nitriding.pushes, 0);
});

test("AP-054 PM proposals from push counters book a capacity window; safety-critical tasks need a supervisor to dismiss", async () => {
  await assert.rejects(() => f.call("ap_pm", "save", { machine_id: i.press, asset_kind: "puller", task: "Puller chain check", basis: "pushes", interval_value: 4, safety_critical: true }, i.production), err => err.code === "42501");
  const plan = (await f.call("ap_pm", "save", { machine_id: i.press, asset_kind: "puller", task: "Puller chain check", basis: "pushes", interval_value: 4, safety_critical: true }, i.productionManager)).plan;
  await f.db.query("update pm_plans set counter_start_at=now()-interval '1 hour' where id=$1", [plan.id]);
  for (const offset of [-400, -300, -200]) await f.push(offset);
  await f.call("ap_jobs", "run_now", { job_key: "maintenance.propose_pm" }, i.owner);
  assert.equal(await count("select count(*) c from proposals where proposal_type='maintenance.pm_due'"), 0, "75% is not yet due");
  await f.push(-100);
  await f.db.query("delete from system_job_runs where job_key='maintenance.propose_pm'");
  await f.call("ap_jobs", "run_now", { job_key: "maintenance.propose_pm" }, i.owner);
  const p = await proposalFor("maintenance.pm_due", plan.id);
  assert.ok(p, "proposed at the interval");
  await assert.rejects(() => decide(p.id, "reject", { note: "Not needed now" }, i.production), /safety-critical/);
  const accepted = await decide(p.id, "accept", {}, i.production);
  assert.equal(accepted.state, "accepted");
  const block = await f.one("select b.status, b.reason from pm_work_orders w join factory_maintenance_blocks b on b.id=w.maintenance_block_id where w.plan_id=$1", [plan.id]);
  assert.equal(block.status, "planned");
  const done = await f.call("ap_pm", "complete", { plan_id: plan.id, note: "Chain tensioned" }, i.production);
  assert.equal(n(done.counter_at_done), 4);
  const compliance = await f.call("ap_pm", "compliance", {}, i.productionManager);
  assert.equal(n(compliance.assets[0].compliance_percent), 100);
});

test("AP-066 shift target from the published plan nets planned maintenance and the die-change allowance", async () => {
  const shift = await f.one("select * from private.ap2_shift_window($1, clock_timestamp())", [i.company]);
  assert.ok(shift.code);
  const hours = (Date.parse(shift.ends_at) - Date.parse(shift.starts_at)) / 3600e3;
  await seed(`insert into production_plan_slots(id,company_id,production_job_id,machine_id,planned_start_at,planned_end_at,sequence_number,capacity_kg,status)
    values(gen_random_uuid(),$1,$2,$3,$4::timestamptz-interval '2 hours',$4,0,100,'scheduled'),(gen_random_uuid(),$1,$5,$3,$4,$6,1,800,'released')`,
    [i.company, i.jobB, i.press, shift.starts_at, i.jobA, shift.ends_at]);
  await seed("insert into factory_maintenance_blocks(id,company_id,machine_id,starts_at,ends_at,reason,status,created_by) values(gen_random_uuid(),$1,$2,$3::timestamptz+interval '1 hour',$3::timestamptz+interval '2 hours','Container cleaning','planned',$4)", [i.company, i.press, shift.starts_at, i.owner]);
  const target = await f.one("select private.ap2_shift_target($1,$2,$3,$4) t", [i.company, i.press, shift.starts_at, shift.ends_at]);
  const expectedKg = Math.round(800 * (hours - 1 - 0.75) / hours * 10) / 10;
  assert.equal(n(target.t.target_kg), expectedKg);
  assert.equal(target.t.die_changes, 1);
  assert.equal(target.t.target_pushes, Math.ceil(expectedKg / 57 - 1e-9), "57 kg good output per 60 kg billet");
  await f.push(-60);
  const station = await f.press("station", { session_id: i.session });
  assert.equal(n(station.shift.target.target_kg), expectedKg);
  assert.equal(station.shift.actual.pushes, 1);
  const floor = await f.press("floor", {}, i.productionManager);
  assert.equal(floor.presses.find(p => p.machine_id === i.press).actual.pushes, 1);
});

test("Batch 2 tables are company-scoped with RLS, no client writes, and only the batch functions are callable", async () => {
  const tables = ["press_floor_settings", "scrap_standards", "production_scrap_derivations", "scrap_yard_weighings", "production_push_events", "press_idle_intervals", "press_die_changes",
    "press_die_change_corrections", "inspection_sampling_triggers", "qc_sample_requirements", "qc_sample_results", "die_service_bookings", "pm_plans", "pm_work_orders"];
  for (const t of tables) {
    const row = await f.one("select c.relrowsecurity rls, exists(select 1 from pg_index x join pg_attribute a on a.attrelid=x.indrelid and a.attnum=x.indkey[0] where x.indrelid=c.oid and a.attname='company_id') idx, has_table_privilege('authenticated', c.oid, 'INSERT') ins, has_table_privilege('authenticated', c.oid, 'SELECT') sel from pg_class c where c.oid=('public.'||$1)::regclass", [t]);
    assert.deepEqual(row, { rls: true, idx: true, ins: false, sel: false }, t);
  }
  for (const fn of ["ap_press", "ap_scrap", "ap_dies", "ap_pm", "ap_sampling"]) {
    const row = await f.one("select has_function_privilege('authenticated', ('public.'||$1||'(text,jsonb)')::regprocedure, 'EXECUTE') a, has_function_privilege('anon', ('public.'||$1||'(text,jsonb)')::regprocedure, 'EXECUTE') b", [fn]);
    assert.deepEqual(row, { a: true, b: false }, fn);
  }
  await assert.rejects(() => f.call("ap_press", "floor", {}, i.dealer), err => err.code === "42501");
  await assert.rejects(() => f.call("ap_press", "job", { job_id: i.foreignJob }, i.productionManager), /Job not found/);
  const foreign = await f.call("ap_press", "floor", {}, i.foreign).catch(e => e);
  assert.ok(foreign instanceof Error || !foreign.presses.some(p => p.machine_id === i.press), "a foreign company never sees this factory's presses");
});

test("AP-012 the TypeScript yield mirror matches the database function on varied inputs", async () => {
  const { pushYield } = await import("../lib/calculations/press-output.ts");
  const cases = [[60, 178, 0.95, 6, 25, 500, 500, 4], [48.2, 152.4, 1.312, 5.8, 20, 300, 700, 3.5], [3, 178, 0.95, 6, 25, 500, 500, 4], [120, 203, 2.4, 3.66, 30, 0, 0, 0], [75.5, 178, 0.512, 6.4, 22.5, 450, 450, 4.2]];
  for (const [billet, diameter, kgpm, cut, butt, front, back, kerf] of cases) {
    const ts = pushYield({ billetKg: billet, billetDiameterMm: diameter, kgPerM: kgpm, cutM: cut, buttLengthMm: butt, frontCropMm: front, backCropMm: back, sawKerfMm: kerf, densityKgM3: 2700 });
    const row = await f.one("select * from private.ap2_push_yield($1,$2,$3,$4,$5,$6,$7,$8,2700)", [billet, diameter, kgpm, cut, butt, front, back, kerf]);
    assert.deepEqual({ buttKg: n(row.butt_kg), cropKg: n(row.crop_kg), sawKg: n(row.saw_kg), goodKg: n(row.good_kg), cutoffKg: n(row.cutoff_kg), pieces: row.pieces }, ts, JSON.stringify([billet, diameter, kgpm, cut]));
  }
  const blank = await f.one("select * from private.ap2_push_yield(null,178,0.95,6,25,500,500,4,2700)");
  assert.equal(blank.good_kg, null);
});
