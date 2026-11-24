import test from "node:test";
import assert from "node:assert/strict";
import { createAutopilotFixture, apIds as i } from "../scripts/lib/autopilot-batch1-fixture.mjs";

// Order lifecycle orchestration Phase 5 (migration 20261124100000): production runs, initial QC, ageing hand-off and
// cycle monitoring, final QC after ageing (rejections reverse the first-stage approval), the optional QC route
// control and the lifecycle view. Synthetic data only.
let f;
let seq = 50000;
const id = () => `0e500000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const PRESS = "0e500000-0000-4000-8000-000000000001";
const OVEN = "0e500000-0000-4000-8000-000000000002";
const RECIPE = "0e500000-0000-4000-8000-000000000003";
const PLAIN = "0e500000-0000-4000-8000-000000000004";   // profile with no ageing requirement recorded
const T4 = "0e500000-0000-4000-8000-000000000005";      // naturally aged profile

const q = async (sql, p = []) => (await f.db.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
let inTx = false;
async function seed(sql, p = []) {
  if (!inTx) { await f.db.exec("set session_replication_role = replica"); try { return (await f.db.query(sql, p)).rows; } finally { await f.db.exec("set session_replication_role = origin"); } }
  await f.db.exec("savepoint s5_seed; set session_replication_role = replica");
  try { const r = await f.db.query(sql, p); await f.db.exec("set session_replication_role = origin; release savepoint s5_seed"); return r.rows; }
  catch (error) { await f.db.exec("rollback to savepoint s5_seed; set session_replication_role = origin; release savepoint s5_seed"); throw error; }
}
async function raw(sql, p = []) {
  await f.db.exec("savepoint s5_raw");
  try { const r = await f.db.query(sql, p); await f.db.exec("release savepoint s5_raw"); return r.rows; }
  catch (error) { await f.db.exec("rollback to savepoint s5_raw; release savepoint s5_raw"); throw error; }
}
const fqc = (command, payload = {}, actor = i.quality) => f.call("final_qc_command", command, payload, actor);
const olo = (command, payload = {}, actor = i.owner) => f.call("olo_command", command, payload, actor);
const qcc = (command, payload, actor = i.quality) => f.call("quality_containment_command", command, payload, actor);
const denied = e => e.code === "42501";
const num = v => Number(v);
const flow = async job => (await one("select private.olo_job_quality_flow($1,$2) k", [i.company, job])).k;
const tasks = (kind, job) => q("select status, workflow_department dept, workflow_cycle cycle, system_resolution from tasks where workflow_kind=$1 and (workflow_job_id=$2 or workflow_source_id=$2) order by workflow_cycle", [kind, job]);
const approvedKg = async job => num((await one("select coalesce(sum(quantity_checked_kg),0) kg from quality_inspections where production_job_id=$1 and status='approved'", [job])).kg);

test.before(async () => {
  f = await createAutopilotFixture();
  await seed("insert into machines(id,company_id,machine_name,machine_type,status,is_active,press_capacity_ton) values($1,$2,'Press D (1800 T)','extrusion_press','active',true,1800)", [PRESS, i.company]);
  await seed("insert into machines(id,company_id,machine_name,machine_type,status,is_active) values($1,$2,'Ageing oven 1','aging_oven','active',true)", [OVEN, i.company]);
  await seed(`insert into treatment_recipes(id,company_id,recipe_code,revision,name,process,alloys,target_temper,temp_min_c,temp_max_c,soak_min_minutes,soak_max_minutes,min_readings,status,created_by,approved_by,approved_at)
    values($1,$2,'t5_6063',1,'6063 T5 artificial ageing','artificial_ageing','{6063}','T5',180,200,240,300,2,'approved',$3,$4,now())`, [RECIPE, i.company, i.productionManager, i.quality]);
  await seed("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy) values($1,$2,'OM-3010','Window frame',1.1,'6063')", [PLAIN, i.company]);
  await seed("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy,temper) values($1,$2,'OM-3011','Mullion T4',1.2,'6063','T4')", [T4, i.company]);
});
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); inTx = true; });
// The engine logs its own failures instead of blocking the business change, so each scenario also proves it logged none.
test.afterEach(async () => {
  inTx = false;
  const errors = await q("select source, message from olo_engine_errors");
  await f.rollback();
  assert.deepEqual(errors, [], "the orchestration engine logged no errors");
});

/** An order with one job of `kg` in `status` (completed by default) on profile `profile` (OM-2045, temper T5). */
async function order({ kg = 1000, status = "completed", profile = i.profile2 } = {}) {
  const o = id(), line = id(), j = id();
  await seed(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,manufacturing_weight_kg,requested_weight_kg,production_quantity_kg,order_value)
    values($1,$2,$3,$4,current_date,current_date+10,'normal','order_confirmed',$5,$5,$5,236000)`, [o, i.company, `SO-P5-${o.slice(-4)}`, i.customer2, kg]);
  await seed("insert into order_items(id,company_id,order_id,profile_id,die_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,section_weight_kg_per_m) values($1,$2,$3,$4,$5,'Section',100,6,$6,0.95)", [line, i.company, o, profile, i.die, kg]);
  await seed(`insert into production_jobs(id,company_id,order_id,source_line_id,profile_id,die_id,machine_id,status,planned_date,planned_quantity_kg,actual_quantity_kg,completed_at,job_number)
    values($1,$2,$3,$4,$5,$6,$7,$8,current_date,$9,$9,case when $8='completed' then now() end,$10)`, [j, i.company, o, line, profile, i.die, PRESS, status, kg, `JOB-P5-${j.slice(-4)}`]);
  return { order: o, line, job: j, profile };
}
/** Moves a job to a status with the press-slot and completion workflows set aside (they are tested elsewhere); every
 * orchestration trigger still runs. */
async function jobStatus(job, status) {
  await f.db.exec("alter table production_jobs disable trigger guard_production_job_status; alter table production_jobs disable trigger enforce_production_completion_integrity; alter table production_jobs disable trigger validate_production_start_resources");
  try { await raw("update production_jobs set status=$2, completed_at=case when $2='completed' then now() else completed_at end where id=$1", [job, status]); }
  finally { await f.db.exec("alter table production_jobs enable trigger guard_production_job_status; alter table production_jobs enable trigger enforce_production_completion_integrity; alter table production_jobs enable trigger validate_production_start_resources"); }
}
/** A first-stage QC decision written by QA, so the production QC guards run. */
async function inspect(a, kg, status = "approved") {
  const ins = id();
  await f.asUser(`insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status,batch_number,inspector_name,surface_finish_ok,weight_per_meter_actual)
    values($1,$2,$3,$4,now(),$5,$6,'LOT-P5','QA day shift',$7,0.95)`, [ins, i.company, a.job, a.profile, kg, status, status === "approved"], i.quality);
  return ins;
}
/** A treatment batch with one input of `kg` from the job, written with the production triggers enabled. */
async function load(a, kg, { started = null } = {}) {
  const b = id();
  await raw("insert into treatment_batches(id,company_id,batch_number,recipe_id,machine_id,load_note,loaded_by,status,started_at) values($1,$2,$3,$4,$5,'Racked on trolley 2',$6,$7,$8)",
    [b, i.company, `HT-P5-${b.slice(-4)}`, RECIPE, OVEN, i.production, started ? "running" : "loaded", started]);
  const input = id();
  await raw("insert into treatment_inputs(id,company_id,batch_id,production_job_id,profile_id,alloy,temper,quantity_kg) values($1,$2,$3,$4,$5,'6063','T5',$6)", [input, i.company, b, a.job, i.profile2, kg]);
  return { batch: b, input };
}
async function review(t, accepted, rejected = 0, retreat = 0) {
  await raw("update treatment_batches set status='ended', ended_at=now() where id=$1", [t.batch]);
  await raw("update treatment_inputs set accepted_kg=$2, rejected_kg=$3, retreat_kg=$4 where id=$1", [t.input, accepted, rejected, retreat]);
  await raw("update treatment_batches set status=$2, reviewed_by=$3, reviewed_at=now() where id=$1", [t.batch, rejected === 0 && retreat === 0 ? "released" : "partially_released", i.quality]);
}
const results = { hardness_webster: 11, tensile_strength_mpa: 205, yield_strength_mpa: 170, elongation_percent: 9, samples_tested: 3, dimensional_ok: true, surface_ok: true };
const record = (a, payload = {}, actor) => fqc("record", { job_id: a.job, accepted_kg: 1000, results, method: "Webster hardness and tensile test", sampling_reference: "QP-07 rev 2: 3 per lot", ...payload }, actor);

test("route: routing, recorded requirement and temper decide ageing; nothing is assumed when all are silent", async () => {
  const aged = await order();
  const plain = await order({ profile: PLAIN });
  const natural = await order({ profile: T4 });
  assert.deepEqual([(await flow(aged.job)).route.state, (await flow(aged.job)).route.source], ["required", "temper"]);
  assert.equal((await flow(plain.job)).route.state, "undocumented");
  assert.equal((await flow(natural.job)).route.state, "not_required");
  await seed("insert into profile_routing_steps(id,company_id,profile_id,step_order,stage_name,is_required,is_active) values($1,$2,$3,1,'Extrusion',true,true),($4,$2,$3,2,'Packaging',true,true)", [id(), i.company, PLAIN, id()]);
  assert.deepEqual([(await flow(plain.job)).route.state, (await flow(plain.job)).route.source], ["not_required", "routing"], "a packaging step is not read as ageing");
  await seed("insert into profile_routing_steps(id,company_id,profile_id,step_order,stage_name,is_required,is_active) values($1,$2,$3,3,'Artificial ageing',true,true)", [id(), i.company, PLAIN]);
  assert.equal((await flow(plain.job)).route.state, "required");
  await seed("update aluminium_profiles set aging_requirement='Natural ageing only' where id=$1", [T4]);
  assert.deepEqual([(await flow(natural.job)).route.state, (await flow(natural.job)).route.source], ["not_required", "profile"]);
});

test("runs: a completed run gives QA one initial QC task that closes only when every kilogram has a decision", async () => {
  const a = await order({ kg: 1000, status: "in_progress" });
  await jobStatus(a.job, "completed");
  let t = await tasks("initial_qc", a.job);
  assert.deepEqual(t.map(x => [x.status, x.dept, x.cycle]), [["open", "quality", 1]]);
  const body = await one("select description from tasks where workflow_kind='initial_qc' and workflow_job_id=$1", [a.job]);
  assert.match(body.description, /artificial ageing required/);
  await assert.rejects(() => f.asUser("update tasks set status='completed' where workflow_kind='initial_qc' and workflow_job_id=$1", [a.job], i.quality), /every produced kilogram/);
  await inspect(a, 600);
  assert.equal((await tasks("initial_qc", a.job))[0].status, "open", "400 kg still has no decision");
  await qcc("open", { job_id: a.job, scope_kg: 400, stage: "first_stage", defect: "Twist beyond tolerance on bundle 4", defect_kind: "non_destructive" });
  t = await tasks("initial_qc", a.job);
  assert.equal(t[0].status, "completed", "held kilograms are covered by the containment task");
  assert.match(t[0].system_resolution, /held 400 kg/);
  assert.equal((await q("select 1 from olo_events where event_type='production.qc_required' and production_job_id=$1", [a.job])).length, 1);
});

test("runs: start and interruption notify planning and the production manager; the start alert clears when the run stops", async () => {
  const a = await order({ kg: 1000, status: "ready" });
  await jobStatus(a.job, "in_progress");
  const started = await q("select recipient_role, resolved_at from notifications where condition_key=$1", [`olo-run-started:${a.job}`]);
  assert.ok(started.some(n => n.recipient_role === "production_manager"));
  const hold = id();
  await seed(`insert into production_job_holds(id,company_id,production_job_id,reason,note,material_condition,resume_condition,responsible_user_id,responsible_name,previous_status,recorded_output_kg,held_by,held_by_name)
    values($1,$2,$3,'machine_breakdown','Container liner cracked','420 kg on the cooling table, tagged','Liner replaced and press trial run',$4,'Fixture productionManager','in_progress',420,$4,'Fixture productionManager')`, [hold, i.company, a.job, i.productionManager]);
  await jobStatus(a.job, "on_hold");
  assert.ok((await q("select resolved_at from notifications where condition_key=$1", [`olo-run-started:${a.job}`])).every(n => n.resolved_at));
  const alert = await one("select body from notifications where condition_key=$1 and recipient_role='production_manager'", [`olo-run-interrupted:${hold}`]);
  assert.match(alert.body, /machine breakdown — Container liner cracked/);
  assert.match(alert.body, /To resume: Liner replaced/);
  await seed("update production_job_holds set status='resumed', closed_at=now() where id=$1", [hold]);
  await jobStatus(a.job, "in_progress");
  assert.ok((await q("select resolved_at from notifications where condition_key=$1", [`olo-run-interrupted:${hold}`])).every(n => n.resolved_at), "the interruption alert clears with the hold");
});

test("ageing: release, cycle, overdue, deviation and review tasks follow the batch records", async () => {
  const a = await order();
  await inspect(a, 1000);
  let t = await tasks("ageing_release", a.job);
  assert.deepEqual(t.map(x => [x.status, x.dept]), [["open", "ageing"]]);
  assert.equal((await flow(a.job)).stage, "awaiting_ageing");
  const lc = await olo("lifecycle.order", { order_id: a.order }, i.sales);
  assert.equal(lc.next_action.department, "ageing", "the next step is ageing, not packing");
  assert.equal(lc.domains.find(d => d.key === "ageing").status, "awaiting_ageing");

  const b = await load(a, 1000, { started: new Date(Date.now() - 7 * 3600 * 1000).toISOString() });
  assert.equal((await tasks("ageing_release", a.job))[0].status, "completed");
  assert.equal((await flow(a.job)).stage, "in_ageing");
  await raw("update treatment_batches set started_at=now()-interval '7 hours' where id=$1", [b.batch]);
  assert.deepEqual((await tasks("ageing_cycle", b.batch)).map(x => [x.status, x.dept]), [["open", "ageing"]], "300 min soak + 60 min grace is past");
  await raw("insert into treatment_observations(company_id,batch_id,temperature_c,instrument_ref,recorded_by) values($1,$2,212,'TC-04',$3)", [i.company, b.batch, i.production]);
  const dev = await q("select recipient_role from notifications where condition_key=$1", [`olo-ageing-deviation:${b.batch}`]);
  assert.ok(dev.some(n => n.recipient_role === "quality") && dev.some(n => n.recipient_role === "factory_manager"));
  await raw("insert into treatment_observations(company_id,batch_id,temperature_c,instrument_ref,recorded_by) values($1,$2,214,'TC-04',$3)", [i.company, b.batch, i.production]);
  assert.equal((await one("select count(*)::int n from notifications where condition_key=$1 and recipient_role='quality'", [`olo-ageing-deviation:${b.batch}`])).n, 1, "alerted once per batch");

  await raw("update treatment_batches set status='ended', ended_at=now() where id=$1", [b.batch]);
  assert.equal((await tasks("ageing_cycle", b.batch))[0].status, "completed");
  assert.deepEqual((await tasks("ageing_review", b.batch)).map(x => [x.status, x.dept]), [["open", "quality"]]);
  await raw("update treatment_inputs set accepted_kg=950, rejected_kg=50, retreat_kg=0 where id=$1", [b.input]);
  await raw("update treatment_batches set status='partially_released', reviewed_by=$2, reviewed_at=now() where id=$1", [b.batch, i.quality]);
  assert.equal((await tasks("ageing_review", b.batch))[0].status, "completed");
  t = await tasks("final_qc", a.job);
  assert.deepEqual(t.map(x => [x.status, x.dept]), [["open", "quality"]]);
  const k = await flow(a.job);
  assert.deepEqual([k.stage, num(k.awaiting_final_kg), num(k.aged_accepted_kg), num(k.aged_rejected_kg)], ["awaiting_final_qc", 1000, 950, 50]);
  const events = (await q("select event_type from olo_events where production_job_id=$1", [a.job])).map(e => e.event_type);
  for (const e of ["ageing.release_required", "ageing.cycle_started", "ageing.cycle_completed", "ageing.reviewed", "ageing.final_qc_required"]) assert.ok(events.includes(e), e);
});

test("final QC: QA records accepted and rejected kilograms; rejection reverses the first-stage approval and opens remelt", async () => {
  const a = await order();
  await inspect(a, 1000);
  const b = await load(a, 1000);
  await review(b, 950, 50);
  await assert.rejects(() => record(a, {}, i.productionManager), denied);
  await assert.rejects(() => record(a, { accepted_kg: 1000 }), /At most 950 kg can be accepted/);
  await assert.rejects(() => record(a, { accepted_kg: 900, rejected_kg: 50 }), /why material is rejected/);
  await seed("update aluminium_profiles set tensile_strength_mpa=210 where id=$1", [i.profile2]);
  await assert.rejects(() => record(a, { accepted_kg: 900 }), /Tensile strength 205 MPa is below the profile minimum 210 MPa/);
  await seed("update aluminium_profiles set tensile_strength_mpa=null where id=$1", [i.profile2]);
  await assert.rejects(() => record(a, { accepted_kg: 900, results: { ...results, samples_tested: undefined } }), /how many samples/);
  await assert.rejects(() => record(a, { accepted_kg: 900, results: { samples_tested: 2 } }), /at least one measured property/);

  const view = await fqc("get", { job_id: a.job });
  assert.deepEqual([view.can_record, num(view.max_accept_kg)], [true, 950]);
  const r = await record(a, { accepted_kg: 900, rejected_kg: 100, rejection_reason: "Hardness 7 HW on bundles 9 and 10 after ageing", certificate_reference: "MTC-5521", temper_verified: "t5" });
  assert.match(r.record_number, /^FQC\/.+\/0001$/);
  assert.deepEqual([num(r.accepted_kg), num(r.rejected_kg), r.temper_verified, r.reversals.length], [900, 100, "T5", 1]);
  assert.equal(await approvedKg(a.job), 900, "the rejected 100 kg left the approved ledger");
  const child = await one("select status, quantity_checked_kg kg from quality_inspections where production_job_id=$1 and status='rejected'", [a.job]);
  assert.equal(num(child.kg), 100);
  const sources = await f.call("remelt_command", "sources", {}, i.quality);
  assert.ok(sources.rows.some(s => num(s.remaining_kg) === 100), "the rejected kilograms can be proposed for remelt");
  const k = await flow(a.job);
  assert.deepEqual([k.stage, num(k.final_accepted_kg), num(k.final_rejected_kg), num(k.awaiting_final_kg), num(k.awaiting_ageing_kg)], ["released", 900, 100, 0, 0]);
  assert.equal((await tasks("final_qc", a.job))[0].status, "completed");
  assert.equal((await tasks("ageing_release", a.job)).filter(x => x.status === "open").length, 0, "a final rejection does not send the material back for ageing");
  assert.ok((await q("select 1 from tasks where workflow_kind='reproduction' and workflow_order_id=$1 and status='open'", [a.order])).length === 1, "planning is told the order is short");
  assert.ok((await q("select 1 from notifications where condition_key=$1 and recipient_role='factory_manager'", [`olo-final-rejected:${r.id}`])).length === 1);
  assert.ok((await q("select 1 from notifications where condition_key=$1", [`olo-final-released:${r.id}`])).length >= 1);
  const lc = await olo("lifecycle.order", { order_id: a.order }, i.sales);
  assert.equal(num(lc.quantities.final_released_kg), 900);
  assert.equal(lc.domains.find(d => d.key === "ageing").status, "released");
  assert.equal(lc.jobs[0].quality_flow.stage, "released");

  await assert.rejects(() => record(a, { accepted_kg: 1 }), /No material of this job is waiting for final QC/);
  await assert.rejects(() => raw("update final_qc_records set accepted_kg=950 where id=$1", [r.id]), /append-only/);
  await assert.rejects(() => raw("delete from final_qc_records where id=$1", [r.id]), /append-only/);
  await assert.rejects(() => f.asUser("insert into final_qc_records(company_id,record_number,production_job_id,accepted_kg,results,method,sampling_reference,awaiting_before_kg,recorded_by,recorded_by_role) values($1,'X',$2,1,'{}','m1','s1',1,$3,'quality')",
    [i.company, a.job, i.quality], i.quality));
  const list = await fqc("queue", { view: "recorded" }, i.viewer);
  assert.deepEqual([list.total, list.can_record], [1, false]);
});

test("final QC: material first-stage QC never approved, a job without ageing and a contained job are refused", async () => {
  const a = await order();
  await inspect(a, 600);
  const b = await load(a, 1000);
  await review(b, 1000);
  await assert.rejects(() => record(a, { accepted_kg: 700 }), /Only 600 kg of this job passed first-stage QC/);
  await assert.rejects(() => record(a, { accepted_kg: 500, temper_verified: "T6" }), /verified temper T6 differs from the profile temper T5/);
  const natural = await order({ profile: T4 });
  await inspect(natural, 1000);
  assert.match((await fqc("get", { job_id: natural.job })).blocker, /no ageing step/);
  assert.equal((await tasks("ageing_release", natural.job)).length, 0, "a naturally aged profile raises no ageing work");
  const c = await order();
  await inspect(c, 500);
  const cb = await load(c, 500);
  await review(cb, 500);
  await qcc("open", { job_id: c.job, scope_kg: 500, stage: "first_stage", defect: "Die lines on the visible face", defect_kind: "non_destructive" });
  assert.match((await fqc("get", { job_id: c.job })).blocker, /under QC containment/);
  const queue = await fqc("queue", {});
  assert.ok(queue.rows.some(x => x.job_id === a.job && num(x.awaiting_final_kg) === 1000), "listed for final QC although 400 kg still awaits initial QC");
});

test("QC route control: off by default; when on, ageing loads need first-stage QC and ageing jobs pack only what final QC released", async () => {
  const a = await order();
  await inspect(a, 400);
  await load(a, 600);   // allowed while the control is off
  await assert.rejects(() => olo("settings.save", { enforce_qc_route: true }, i.sales), denied);
  await assert.rejects(() => olo("settings.save", { ageing_overdue_grace_minutes: 900 }), /0 to 720 minutes/);
  const s = await olo("settings.save", { enforce_qc_route: true, ageing_overdue_grace_minutes: 30 }, i.factory);
  assert.deepEqual([s.enforce_qc_route, s.ageing_overdue_grace_minutes], [true, 30]);
  assert.equal((await olo("settings.get")).settings.enforce_qc_route, true);
  assert.ok((await q("select 1 from audit_logs where action='olo_settings.updated' and metadata_json->'changes' ? 'enforce_qc_route'")).length === 1);

  const b = await order();
  await inspect(b, 500);
  await assert.rejects(() => load(b, 600), /Only 500 kg of job .* has passed first-stage QC/);
  const tb = await load(b, 500);
  await assert.rejects(() => raw("insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,scheduled_date,pieces,profile_weight_kg,profile_length_m,status) values($1,$2,'PK-P5-1',$3,$4,current_date,10,300,60,'in_progress')",
    [id(), i.company, b.order, b.job]), /needs ageing: 0 kg is released by final QC/);
  await review(tb, 500);
  await record(b, { accepted_kg: 500 });
  await raw("insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,scheduled_date,pieces,profile_weight_kg,profile_length_m,status) values($1,$2,'PK-P5-2',$3,$4,current_date,10,500,60,'in_progress')",
    [id(), i.company, b.order, b.job]);
  await assert.rejects(() => raw(`insert into prepared_physical_bundles(id,company_id,order_id,source_line_id,source_kind,profile_id,bundle_number,number_of_pieces,net_length_m,gross_weight_kg,tare_weight_kg,recorded_by,payload)
    values($1,$2,$3,$4,'production',$5,'B-P5-1',50,300,520,5,$6,'{}')`, [id(), i.company, b.order, b.job, i.profile2, i.production]), /would make 515 kg packed/);

  const natural = await order({ profile: T4 });
  await inspect(natural, 300);
  await raw("insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,scheduled_date,pieces,profile_weight_kg,profile_length_m,status) values($1,$2,'PK-P5-3',$3,$4,current_date,10,300,60,'scheduled')",
    [id(), i.company, natural.order, natural.job]);
  assert.ok(true, "a job without ageing packs on its QC approval as before");
});

test("completion path: the packaging queue entry of a completed run is not packing; the control and a final rejection both allow for it", async () => {
  await olo("settings.save", { enforce_qc_route: true }, i.factory);
  const a = await order({ kg: 1000, status: "in_progress" });
  await jobStatus(a.job, "completed");   // the completion creates a 'scheduled' packaging job for the full output
  const queued = await one("select status, profile_weight_kg kg from packaging_jobs where production_job_id=$1", [a.job]);
  assert.deepEqual([queued.status, num(queued.kg)], ["scheduled", 1000], "the control does not refuse the run's completion");
  assert.equal(num((await flow(a.job)).packed_kg), 0, "a queued packaging job is not packed material");
  await inspect(a, 1000);
  assert.equal((await tasks("ageing_release", a.job))[0].status, "open");
  await assert.rejects(() => raw("update packaging_jobs set status='in_progress' where production_job_id=$1", [a.job]), /needs ageing: 0 kg is released by final QC/,
    "packing cannot start before final QC");
  const b = await load(a, 1000);
  await review(b, 1000);
  const r = await record(a, { accepted_kg: 900, rejected_kg: 100, rejection_reason: "Bundle 10 below 8 HW after ageing" });
  assert.equal(r.reversals.length, 1, "the queued packaging job does not block the reversal of the rejected kilograms");
  assert.equal(await approvedKg(a.job), 900);
});

test("closure: Phase 5 work of an order that is closed or cancelled is withdrawn, not left open", async () => {
  const a = await order({ kg: 1000, status: "in_progress" });
  await jobStatus(a.job, "completed");
  await inspect(a, 400);
  assert.deepEqual((await tasks("initial_qc", a.job)).map(x => x.status), ["open"]);
  assert.deepEqual((await tasks("ageing_release", a.job)).map(x => x.status), ["open"]);
  await seed("update orders set current_stage='cancelled' where id=$1", [a.order]);
  await olo("evaluate", {}, i.owner);
  const all = await q("select workflow_kind kind, status, system_resolution from tasks where workflow_job_id=$1 order by workflow_kind", [a.job]);
  assert.deepEqual(all.map(x => [x.kind, x.status]), [["ageing_release", "cancelled"], ["initial_qc", "cancelled"]]);
  assert.match(all[0].system_resolution, /order is cancelled/);
});

test("deviation: ageing-route material packed without final QC alerts QA and factory management and withdraws the ageing task", async () => {
  const a = await order();
  await inspect(a, 1000);
  assert.equal((await tasks("ageing_release", a.job))[0].status, "open");
  await raw("insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,scheduled_date,pieces,profile_weight_kg,profile_length_m,status) values($1,$2,'PK-P5-9',$3,$4,current_date,10,1000,60,'in_progress')",
    [id(), i.company, a.order, a.job]);
  await olo("evaluate", {}, i.owner);
  const t = await tasks("ageing_release", a.job);
  assert.equal(t[0].status, "cancelled");
  assert.match(t[0].system_resolution, /without a recorded ageing cycle/);
  const alert = await q("select recipient_role from notifications where condition_key=$1", [`olo-unaged-packed:${a.job}`]);
  assert.ok(alert.some(n => n.recipient_role === "quality") && alert.some(n => n.recipient_role === "factory_manager"));
});
