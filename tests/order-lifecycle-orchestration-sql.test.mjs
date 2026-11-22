import test from "node:test";
import assert from "node:assert/strict";
import { createAutopilotFixture, apIds as i } from "../scripts/lib/autopilot-batch1-fixture.mjs";

// Order lifecycle orchestration (migration 20261120100000): queue ranks derived from press slots, rank-5 billet and
// rank-3 die work created once per planning cycle, early billet shortage forecasting, verification-only completion,
// die preparation and preheat evidence, the configurable start guard, escalation and the order lifecycle ledger.
// Synthetic data only; preheat limits below are test values, not process recommendations.
let f;
let seq = 9000;
const id = () => `0e100000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const P1 = "0e100000-0000-4000-8000-000000000001", P2 = "0e100000-0000-4000-8000-000000000002", BATCH = "0e100000-0000-4000-8000-000000000003";

const q = async (sql, p = []) => (await f.db.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
/** Seeds with triggers suspended; a failing seed surfaces its own error and leaves the test transaction usable. */
let inTx = false;
async function seed(sql, p = []) {
  if (!inTx) { await f.db.exec("set session_replication_role = replica"); try { return (await f.db.query(sql, p)).rows; } finally { await f.db.exec("set session_replication_role = origin"); } }
  await f.db.exec("savepoint olo_seed; set session_replication_role = replica");
  try { const r = await f.db.query(sql, p); await f.db.exec("set session_replication_role = origin; release savepoint olo_seed"); return r.rows; }
  catch (error) { await f.db.exec("rollback to savepoint olo_seed; set session_replication_role = origin; release savepoint olo_seed"); throw error; }
}
const olo = (command, payload = {}, actor = i.owner) => f.call("olo_command", command, payload, actor);
const prep = (command, payload = {}, actor = i.production) => f.call("die_preparation_command", command, payload, actor);
const denied = e => e.code === "42501";
/** A statement expected to fail, isolated so the test transaction stays usable. */
async function raw(sql, p = []) {
  await f.db.exec("savepoint olo_raw");
  try { const r = await f.db.query(sql, p); await f.db.exec("release savepoint olo_raw"); return r.rows; }
  catch (error) { await f.db.exec("rollback to savepoint olo_raw; release savepoint olo_raw"); throw error; }
}

test.before(async () => {
  f = await createAutopilotFixture();
  await seed(`insert into machines(id,company_id,machine_name,machine_type,status,is_active,press_capacity_ton) values
    ($1,$3,'Press A (1500 T)','extrusion_press','active',true,1500),($2,$3,'Press B (750 T)','extrusion_press','active',true,750)`, [P1, P2, i.company]);
  await seed("update aluminium_profiles set billet_diameter_required_inch=7, drawing_approval_status='approved' where id=$1", [i.profile2]);
  await seed("update dies set die_type='solid', die_status='active' where id=$1", [i.die]);
  await seed(`insert into foundry_batches(id,company_id,batch_number,alloy,temper,billet_length_mm,billet_diameter_mm,billet_count,batch_sequence,furnace_number,status,production_date,billet_diameter_inch,billet_weight_density_kg)
    values($1,$2,'FB-OLO','6063','T5',800,178,40,1,'F-1','issued',current_date,7,60)`, [BATCH, i.company]);
});
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); inTx = true; });
test.afterEach(async () => { inTx = false; await f.rollback(); });

/** An order with one line, a billet requirement and a planned job; a scheduled slot `hours` from now when given. */
async function job({ press = P1, hours = null, kg = 800, billets = 10, allocated = 0, status = "planned", slot = "scheduled", die = i.die, priority = "normal", due = 10, requirement = true } = {}) {
  const order = id(), line = id(), j = id(), req = id(), s = id();
  await seed(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,manufacturing_weight_kg,requested_weight_kg,production_quantity_kg)
    values($1,$2,$3,$4,current_date,current_date+$5::int,$6,'order_confirmed',$7,$7,$7)`, [order, i.company, `SO-OLO-${order.slice(-4)}`, i.customer2, due, priority, kg]);
  await seed(`insert into order_items(id,company_id,order_id,profile_id,die_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,section_weight_kg_per_m)
    values($1,$2,$3,$4,$5,'Sliding track',100,6,$6,0.95)`, [line, i.company, order, i.profile2, die, kg]);
  if (requirement) {
    await seed(`insert into order_billet_requirements(id,company_id,order_id,profile_id,alloy,temper,billet_diameter_inch,billet_length_mm,required_weight_kg,billet_weight_kg,extrusion_efficiency_percent,billets_required,billets_allocated,billets_short,status)
      values($1,$2,$3,$4,'6063','T5',7,800,$5,60,80,$6,$7,$8,$9)`, [req, i.company, order, i.profile2, kg, billets, allocated, billets - allocated, allocated >= billets ? "complete" : allocated > 0 ? "partial" : "pending"]);
  }
  await seed(`insert into production_jobs(id,company_id,order_id,source_line_id,profile_id,die_id,machine_id,status,planned_date,planned_quantity_kg,job_number)
    values($1,$2,$3,$4,$5,$6,$7,$8,current_date,$9,$10)`, [j, i.company, order, line, i.profile2, die, press, status, kg, `JOB-OLO-${j.slice(-4)}`]);
  if (hours !== null) {
    await seed(`insert into production_plan_slots(id,company_id,production_job_id,machine_id,planned_start_at,planned_end_at,status,sequence_number,created_by,capacity_kg)
      values($1,$2,$3,$4,now()+make_interval(mins=>($5::numeric*60)::int),now()+make_interval(mins=>($5::numeric*60+30)::int),$6,0,$7,$8)`, [s, i.company, j, press, hours, slot, i.owner, kg]);
  }
  return { order, line, job: j, req, slot: s };
}
/** Billet code in the form the batch identity guard expects: furnace-date-sequence-number. */
const billetCode = n => `F-1-${new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10).replaceAll("-", "")}-1-${n}`;
const evaluate = () => olo("evaluate", {}, i.owner);
const tasksOf = (jobId, kind) => q("select * from tasks where workflow_job_id=$1 and workflow_kind=$2 order by workflow_cycle", [jobId, kind]);
const rankOf = async jobId => (await one("select queue_rank from production_queue_positions where production_job_id=$1", [jobId]))?.queue_rank ?? null;
/** Moves a slot with every orchestration trigger live; the shift-capacity guard is out of scope here and is suspended. */
async function moveSlot(slot, hours) {
  await f.db.exec("alter table production_plan_slots disable trigger enforce_factory_slot_capacity");
  await f.db.query("update production_plan_slots set planned_start_at=now()+make_interval(mins=>($2::numeric*60)::int), planned_end_at=now()+make_interval(mins=>($2::numeric*60+20)::int) where id=$1", [slot, hours]);
  await f.db.exec("alter table production_plan_slots enable trigger enforce_factory_slot_capacity");
}
/** The real priority allocator, run as a production manager. */
async function allocate() {
  await f.db.query("select set_config('request.jwt.claim.sub',$1,true)", [i.productionManager]);
  await f.db.query("select public.allocate_billets_by_priority($1)", [i.company]);
  await f.db.query("select set_config('request.jwt.claim.sub','',true)");
}

test("queue: ranks come from press slots; rank 6 to 5 opens one billet task; reruns never duplicate", async () => {
  const jobs = [];
  for (let h = 1; h <= 6; h++) jobs.push(await job({ hours: h }));
  await job({ press: P2, hours: 1 });
  await evaluate();
  assert.deepEqual(await Promise.all(jobs.map(x => rankOf(x.job))), [1, 2, 3, 4, 5, 6]);
  for (const x of jobs.slice(0, 5)) assert.equal((await tasksOf(x.job, "billet_allocation")).length, 1, "top five get billet work");
  assert.equal((await tasksOf(jobs[5].job, "billet_allocation")).length, 0, "rank 6 waits");
  for (const x of jobs.slice(0, 3)) assert.equal((await tasksOf(x.job, "die_preparation")).length, 1, "top three get die work");
  assert.equal((await tasksOf(jobs[3].job, "die_preparation")).length, 0);
  assert.equal((await one("select count(*)::int n from die_preparations where production_job_id = any($1) and status='required'", [jobs.slice(0, 3).map(x => x.job)])).n, 3);

  // A real slot change (triggers on) moves job 6 ahead of job 5.
  await moveSlot(jobs[5].slot, 4.55);
  assert.equal(await rankOf(jobs[5].job), 5);
  assert.equal(await rankOf(jobs[4].job), 6);
  const created = await tasksOf(jobs[5].job, "billet_allocation");
  assert.equal(created.length, 1);
  assert.match(created[0].description, /within the top 5 positions on press Press A \(1500 T\) \(rank 5\)/);
  assert.match(created[0].description, /Billets: 10 required, 0 allocated, 10 short/);
  assert.equal((await tasksOf(jobs[4].job, "billet_allocation"))[0].status, "open", "work already given is not withdrawn when a job slips one place");
  const ev = await q("select previous_rank, new_rank, source from production_queue_rank_events where production_job_id=$1 order by occurred_at", [jobs[5].job]);
  assert.deepEqual(ev.map(e => [e.previous_rank, e.new_rank]), [[null, 6], [6, 5]]);
  assert.equal(ev[1].source, "slot_change");

  const before = (await one("select count(*)::int n from tasks where workflow_key is not null and company_id=$1", [i.company])).n;
  await evaluate(); await evaluate();
  assert.equal((await one("select count(*)::int n from tasks where workflow_key is not null and company_id=$1", [i.company])).n, before, "re-evaluation is idempotent");
  assert.equal((await one("select count(*)::int n from notifications where condition_key=$1", [created[0].workflow_key])).n > 0, true);
  assert.equal((await one("select count(*)::int n from olo_engine_errors")).n, 0);
});

test("queue: a job jumping from rank 10 to rank 2 gets billet and die work at once", async () => {
  const jobs = [];
  for (let h = 1; h <= 10; h++) jobs.push(await job({ hours: h }));
  await evaluate();
  assert.equal(await rankOf(jobs[9].job), 10);
  assert.equal((await tasksOf(jobs[9].job, "billet_allocation")).length, 0);
  await moveSlot(jobs[9].slot, 1.55);
  assert.equal(await rankOf(jobs[9].job), 2);
  assert.equal((await tasksOf(jobs[9].job, "billet_allocation")).length, 1);
  const die = await tasksOf(jobs[9].job, "die_preparation");
  assert.equal(die.length, 1);
  assert.equal(die[0].priority, "high");
  assert.match(die[0].description, /Do not start preheating now/);
  assert.equal((await one("select event_type from olo_events where production_job_id=$1 and event_type='order.queue_threshold_entered'", [jobs[9].job])).event_type, "order.queue_threshold_entered");
});

test("billets: allocated stock means no task; the priority allocator verifies an open task; people cannot close it by hand", async () => {
  const ready = await job({ hours: 1, billets: 4, allocated: 4 });
  const short = await job({ hours: 2, billets: 4 });
  await evaluate();
  assert.equal((await tasksOf(ready.job, "billet_allocation")).length, 0, "nothing to do when billets are allocated");
  const [t] = await tasksOf(short.job, "billet_allocation");
  assert.equal(t.status, "open");

  const assignee = t.assigned_to;
  assert.ok([i.inventory, i.productionManager].includes(assignee), "assigned to the billet inventory department");
  await assert.rejects(() => f.asUser("update tasks set status='completed' where id=$1", [t.id], assignee), /closes when the billets are allocated/);
  await assert.rejects(() => f.asUser("insert into tasks(company_id,title,workflow_key,workflow_kind,workflow_department,workflow_cycle,workflow_due_at) values($1,'Fake','x:1','billet_allocation','foundry',1,now())", [i.company], i.owner), denied);
  const ack = await olo("tasks.acknowledge", { task_id: t.id }, assignee);
  assert.equal(ack.status, "open", "acknowledging does not complete the work");

  for (let n = 1; n <= 4; n++) {
    await seed(`insert into foundry_billets(id,company_id,foundry_batch_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,alloy,temper,weight_kg,status,source_type)
      values($1,$2,$3,$4,$5,7,178,800,'6063','T5',60,'cast','in_house')`, [id(), i.company, BATCH, billetCode(n), n]);
  }
  await allocate();
  const done = await one("select status, system_resolution, completion_evidence from tasks where id=$1", [t.id]);
  assert.equal(done.status, "completed");
  assert.match(done.system_resolution, /Verified: 4 of 4 billets allocated/);
  assert.equal(done.completion_evidence.allocated, 4);
  assert.equal((await one("select count(*)::int n from notifications where condition_key=$1 and resolved_at is null", [t.workflow_key])).n, 0, "its alerts close with it");
  const events = (await q("select action from olo_task_events where task_id=$1 order by occurred_at", [t.id])).map(e => e.action);
  assert.deepEqual(events, ["created", "acknowledged", "verified_complete"]);
});

test("cycles: a cancelled job withdraws its work; a job whose billets are released re-enters with a new cycle", async () => {
  const a = await job({ hours: 1, billets: 2 });
  const b = await job({ hours: 2, billets: 2 });
  await evaluate();
  const [ta] = await tasksOf(a.job, "billet_allocation");
  await f.db.query("update production_jobs set status='cancelled' where id=$1", [a.job]);
  assert.equal(await rankOf(a.job), null);
  const withdrawn = await one("select status, system_resolution from tasks where id=$1", [ta.id]);
  assert.equal(withdrawn.status, "cancelled");
  assert.match(withdrawn.system_resolution, /Withdrawn: the production job was cancelled/);
  assert.equal(await rankOf(b.job), 1, "the next job moves up");

  // b's billets are allocated (task verified), then released again: the next evaluation opens cycle 2.
  await seed("update order_billet_requirements set billets_allocated=2, billets_short=0, status='complete' where order_id=$1", [b.order]);
  await evaluate();
  assert.equal((await tasksOf(b.job, "billet_allocation"))[0].status, "completed");
  await seed("update order_billet_requirements set billets_allocated=0, billets_short=2, status='pending' where order_id=$1", [b.order]);
  await evaluate();
  const cycles = await tasksOf(b.job, "billet_allocation");
  assert.deepEqual(cycles.map(t => [t.workflow_cycle, t.status]), [[1, "completed"], [2, "open"]]);
});

test("billets: in-house cast billets are allocated before outsourced ones by the existing allocator", async () => {
  const a = await job({ hours: 1, billets: 1 });
  const outsourcedBatch = id();
  await seed("insert into outsourced_billet_batches(id,company_id,batch_number,vendor_id,received_date,alloy,temper,billet_count,billet_diameter_inch,billet_diameter_mm,billet_length_mm,weight_kg,status) values($1,$2,'OB-OLO',$3,current_date,'6063','T5',1,7,178,800,60,'received')", [outsourcedBatch, i.company, i.vendor]);
  const ext = id(), own = id();
  await seed("insert into foundry_billets(id,company_id,outsourced_batch_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,alloy,temper,weight_kg,status,source_type,created_at) values($1,$2,$3,'OB-1',1,7,178,800,'6063','T5',60,'cast','outsourced',now()-interval '2 days')", [ext, i.company, outsourcedBatch]);
  await seed("insert into foundry_billets(id,company_id,foundry_batch_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,alloy,temper,weight_kg,status,source_type) values($1,$2,$3,$4,1,7,178,800,'6063','T5',60,'cast','in_house')", [own, i.company, BATCH, billetCode(1)]);
  await allocate();
  assert.equal((await one("select order_id from foundry_billets where id=$1", [own])).order_id, a.order);
  assert.equal((await one("select order_id from foundry_billets where id=$1", [ext])).order_id, null);
});

test("material risk: a shortfall after higher-priority demand opens one shortage task before rank 5, and new stock resolves it", async () => {
  for (let n = 1; n <= 10; n++) {
    await seed(`insert into foundry_billets(id,company_id,foundry_batch_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,alloy,temper,weight_kg,status,source_type)
      values($1,$2,$3,$4,$5,7,178,800,'6063','T5',60,'cast','in_house')`, [id(), i.company, BATCH, billetCode(n), n]);
  }
  const urgent = await job({ billets: 8, priority: "urgent", due: 5 });
  const normal = await job({ billets: 6, priority: "normal", due: 7 });
  const later = await job({ billets: 50, due: 90 });
  await evaluate();
  assert.equal((await q("select 1 from tasks where workflow_kind='billet_shortage' and workflow_order_id=$1", [urgent.order])).length, 0, "the urgent order is covered first");
  const [t] = await q("select * from tasks where workflow_kind='billet_shortage' and workflow_order_id=$1", [normal.order]);
  assert.ok(t, "the normal order's shortfall is forecast before any rank trigger");
  assert.match(t.description, /6 billets .* cannot cover 4 of them/);
  assert.match(t.description, /cast additional billets in-house, procure externally/);
  assert.doesNotMatch(t.description, /₹|rate|price/i, "no commercial figures reach the foundry");
  assert.equal(t.workflow_department, "procurement");
  assert.equal((await q("select 1 from tasks where workflow_kind='billet_shortage' and workflow_order_id=$1", [later.order])).length, 0, "outside the horizon and not queued");
  await evaluate();
  assert.equal((await q("select 1 from tasks where workflow_kind='billet_shortage' and workflow_order_id=$1", [normal.order])).length, 1, "one task per shortage cycle");

  // Rank 5 later finds the shortage task and references it instead of raising a second shortage.
  await seed(`insert into production_plan_slots(id,company_id,production_job_id,machine_id,planned_start_at,planned_end_at,status,sequence_number,created_by,capacity_kg) values($1,$2,$3,$4,now()+interval '3 hours',now()+interval '4 hours','scheduled',0,$5,600)`, [id(), i.company, normal.job, P1, i.owner]);
  await evaluate();
  const [alloc] = await tasksOf(normal.job, "billet_allocation");
  assert.match(alloc.description, /A shortage task is already open for this order/);

  for (let n = 11; n <= 14; n++) {
    await seed(`insert into foundry_billets(id,company_id,foundry_batch_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,alloy,temper,weight_kg,status,source_type)
      values($1,$2,$3,$4,$5,7,178,800,'6063','T5',60,'cast','in_house')`, [id(), i.company, BATCH, billetCode(n), n]);
  }
  await evaluate();
  const closed = await one("select status, system_resolution from tasks where id=$1", [t.id]);
  assert.equal(closed.status, "completed");
  assert.match(closed.system_resolution, /compatible billet stock now covers/);
});

test("die preparation: checks, evidence, approved preheat standard and hold time; the die task closes on preparation", async () => {
  const a = await job({ hours: 1 });
  await evaluate();
  const [dieTask] = await tasksOf(a.job, "die_preparation");
  const p = await one("select * from die_preparations where production_job_id=$1", [a.job]);
  assert.equal(p.status, "required");
  assert.equal(dieTask.workflow_source_id, p.id);

  const results = { die_present: true, revision_matches: true, press_compatible: true, condition_acceptable: false, maintenance_complete: true };
  await assert.rejects(() => prep("prep.check", { id: p.id, results }), /Record what is wrong with the die \(condition acceptable\)/);
  assert.equal((await prep("prep.check", { id: p.id, results, note: "Bearing wash marks; send for polishing" })).status, "blocked");
  await assert.rejects(() => prep("prep.start", { id: p.id }), /passing die check/);
  assert.equal((await prep("prep.check", { id: p.id, results: { ...results, condition_acceptable: true } })).status, "checked");
  await assert.rejects(() => prep("prep.prepared", { id: p.id, note: "ok" }), /what was done/);
  await assert.rejects(() => prep("prep.check", { id: p.id, results }, i.quality), denied);
  await prep("prep.start", { id: p.id });
  assert.equal((await prep("prep.prepared", { id: p.id, note: "Polished bearings, cleaned pockets, nitriding checked" })).status, "prepared");
  const verified = await one("select status, system_resolution from tasks where id=$1", [dieTask.id]);
  assert.equal(verified.status, "completed");
  assert.match(verified.system_resolution, /Verified: die preparation is prepared/);

  await assert.rejects(() => prep("prep.schedule_preheat", { id: p.id, scheduled_for: new Date().toISOString() }), /No approved die preheat standard/);
  await assert.rejects(() => olo("standards.save", { name: "Solid die preheat", die_type: "solid", min_temperature_c: 420, max_temperature_c: 500, min_soak_minutes: 60, max_hold_minutes: 240, sop_reference: "SOP-TR-07" }, i.production), denied);
  await olo("standards.save", { name: "Solid die preheat", die_type: "solid", min_temperature_c: 420, max_temperature_c: 500, min_soak_minutes: 60, max_hold_minutes: 240, sop_reference: "SOP-TR-07" }, i.productionManager);
  await prep("prep.schedule_preheat", { id: p.id, scheduled_for: new Date().toISOString() });
  await assert.rejects(() => prep("prep.start_preheat", { id: p.id }), /die oven/);
  await prep("prep.start_preheat", { id: p.id, oven_reference: "Die oven 2" });
  await assert.rejects(() => prep("prep.complete_preheat", { id: p.id, temperature_c: 460, soak_minutes: 60 }), /longer than the time since preheating started/);
  await seed("update die_preparations set preheat_started_at=now()-interval '90 minutes' where id=$1", [p.id]);
  await assert.rejects(() => prep("prep.complete_preheat", { id: p.id, temperature_c: 520, soak_minutes: 70 }), /outside the approved 420–500 °C \(SOP-TR-07\)/);
  await assert.rejects(() => prep("prep.complete_preheat", { id: p.id, temperature_c: 460, soak_minutes: 30 }), /shorter than the approved 60 minutes/);
  assert.equal((await prep("prep.complete_preheat", { id: p.id, temperature_c: 460, soak_minutes: 75 })).status, "ready");
  const gates = await olo("readiness.job", { job_id: a.job }, i.production);
  assert.equal(gates.gates.find(g => g.code === "die_preheat").state, "passed");

  await seed("update die_preparations set preheat_completed_at=now()-interval '5 hours' where id=$1", [p.id]);
  const stale = await olo("readiness.job", { job_id: a.job }, i.production);
  assert.match(stale.gates.find(g => g.code === "die_preheat").message, /held hot longer than the approved hold time/);
  const events = (await q("select action from die_preparation_events where preparation_id=$1 order by occurred_at", [p.id])).map(e => e.action);
  assert.deepEqual(events, ["opened", "blocked", "checked", "preparation_started", "prepared", "preheat_scheduled", "preheat_started", "preheat_completed"]);
  await assert.rejects(() => raw("delete from die_preparation_events where preparation_id=$1", [p.id]), /append-only/);
});

test("start guard: off by default; when enforced, an unprepared or unheated die cannot start and a started job issues its die", async () => {
  const a = await job({ hours: 1, status: "ready", slot: "released", billets: 2, allocated: 2 });
  await evaluate();
  // Isolate the orchestration guard from the other start guards for this scenario.
  await f.db.exec("alter table production_jobs disable trigger user; alter table production_jobs enable trigger zzz_guard_olo_die_readiness; alter table production_jobs enable trigger zzz_olo_job_status_events; alter table production_jobs enable trigger zzz_olo_queue_jobs");
  const p = await one("select id from die_preparations where production_job_id=$1", [a.job]);

  await assert.rejects(() => olo("settings.save", { enforce_die_preparation: true }, i.productionManager), denied);
  await olo("settings.save", { enforce_die_preparation: true, enforce_preheat: true }, i.factory);
  await assert.rejects(() => raw("update production_jobs set status='in_progress' where id=$1", [a.job]), /Die preparation for die D-2045-A is not recorded as prepared/);

  await prep("prep.check", { id: p.id, results: { die_present: true, revision_matches: true, press_compatible: true, condition_acceptable: true, maintenance_complete: true } });
  await prep("prep.prepared", { id: p.id, note: "Cleaned and polished, ready for preheat" });
  await assert.rejects(() => raw("update production_jobs set status='in_progress' where id=$1", [a.job]), /preheating is not complete/);

  await olo("settings.save", { enforce_preheat: false }, i.factory);
  await f.db.query("update production_jobs set status='in_progress' where id=$1", [a.job]);
  const issued = await one("select status, issued_at from die_preparations where id=$1", [p.id]);
  assert.equal(issued.status, "issued");
  assert.ok(issued.issued_at);
  assert.equal(await rankOf(a.job), null, "a running job leaves the queue");
  await f.db.exec("alter table production_jobs enable trigger user");
});

test("readiness: every gate names its department; ready is announced once and withdrawn when a gate fails", async () => {
  const a = await job({ hours: 1, status: "ready", slot: "released", billets: 2, allocated: 2 });
  const b = await job({ hours: 2, status: "planned", billets: 3 });
  await evaluate();
  const ga = await olo("readiness.job", { job_id: a.job }, i.production);
  assert.equal(ga.planning_ready, true, JSON.stringify(ga.blocker));
  assert.equal(ga.start_ready, false, "billets are allocated but not yet issued to the press");
  assert.equal(ga.blocker.code, "start_checks");
  assert.deepEqual(ga.gates.map(g => [g.code, g.department]).slice(0, 4), [["commercial", "finance"], ["specification", "sales"], ["billets", "billet_inventory"], ["die", "tool_room"]]);
  const notes = await q("select recipient_role from notifications where condition_key=$1 order by recipient_role", [`olo-ready:${a.job}`]);
  assert.deepEqual(notes.map(n => n.recipient_role), ["production", "production_manager"]);
  await evaluate();
  assert.equal((await q("select 1 from notifications where condition_key=$1", [`olo-ready:${a.job}`])).length, 2, "announced once");

  const gb = await olo("readiness.job", { job_id: b.job }, i.production);
  assert.equal(gb.planning_ready, false);
  assert.equal(gb.gates.find(g => g.code === "billets").message, "0 of 3 billets allocated; 3 short.");
  assert.equal(gb.gates.find(g => g.code === "schedule").state, "failed");

  await seed("insert into order_credit_holds(company_id,order_id,customer_id,status,reasons,exposure,credit_limit,overdue_beyond_grace,requested_by) values($1,$2,$3,'held',array['over_limit'],100000,50000,0,$4)", [i.company, a.order, i.customer2, i.owner]);
  await evaluate();
  const held = await olo("readiness.job", { job_id: a.job }, i.production);
  assert.equal(held.planning_ready, false);
  assert.equal(held.blocker.department, "finance");
  assert.doesNotMatch(held.blocker.message, /\d{4,}/, "no exposure figures in the gate");
  assert.equal((await q("select 1 from notifications where condition_key=$1 and resolved_at is null", [`olo-ready:${a.job}`])).length, 0, "the ready alert is withdrawn");
  assert.equal((await one("select count(*)::int n from olo_events where production_job_id=$1 and event_type='production.readiness_changed'", [a.job])).n, 2);

  await seed("update dies set die_status='under_trial' where id=$1", [i.die]);
  const trial = await olo("readiness.job", { job_id: b.job }, i.production);
  assert.match(trial.gates.find(g => g.code === "die_trial").message, /No trial is recorded for die D-2045-A/);
});

test("escalation: supervisor after the acknowledgement SLA, factory manager when overdue, owner after that", async () => {
  const a = await job({ hours: 1 });
  await evaluate();
  const [t] = await tasksOf(a.job, "billet_allocation");
  await seed("update tasks set created_at=now()-interval '5 hours' where id=$1", [t.id]);
  await evaluate();
  let row = await one("select workflow_escalation_level, priority from tasks where id=$1", [t.id]);
  assert.equal(row.workflow_escalation_level, 1);
  assert.deepEqual((await q("select recipient_role from notifications where condition_key=$1", [`olo-esc:${t.id}:1`])).map(n => n.recipient_role), ["production_manager"]);
  await evaluate();
  assert.equal((await q("select 1 from notifications where condition_key like $1", [`olo-esc:${t.id}:%`])).length, 1, "no repeated alerts");
  await seed("update tasks set workflow_due_at=now()-interval '1 hour' where id=$1", [t.id]);
  await evaluate();
  row = await one("select workflow_escalation_level, priority from tasks where id=$1", [t.id]);
  assert.equal(row.workflow_escalation_level, 2);
  assert.equal(row.priority, "urgent");
  assert.deepEqual((await q("select recipient_role from notifications where condition_key=$1", [`olo-esc:${t.id}:2`])).map(n => n.recipient_role), ["factory_manager"]);
  await seed("update tasks set workflow_due_at=now()-interval '30 hours' where id=$1", [t.id]);
  await evaluate();
  assert.deepEqual((await q("select recipient_role from notifications where condition_key=$1", [`olo-esc:${t.id}:3`])).map(n => n.recipient_role), ["owner"]);
  await assert.rejects(() => f.asUser("update tasks set workflow_escalation_level=0 where id=$1", [t.id], i.owner), denied);
  const inbox = await olo("tasks.inbox", { view: "escalated" }, i.factory);
  assert.equal(inbox.rows.some(r => r.id === t.id), true);
});

test("lifecycle: separate quantity states, partial QC acceptance is not completion, and payment figures stay with finance", async () => {
  const a = await job({ kg: 1000, status: "completed", billets: 2, allocated: 2 });
  await seed("update production_jobs set actual_quantity_kg=1000, completed_at=now() where id=$1", [a.job]);
  for (const [status, kg] of [["approved", 700], ["rejected", 200], ["pending", 100]]) {
    await seed("insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status) values($1,$2,$3,$4,now(),$5,$6)", [id(), i.company, a.job, i.profile2, kg, status]);
  }
  await seed("insert into invoices(id,company_id,customer_id,order_id,invoice_number,invoice_date,due_date,status,subtotal,tax_total,grand_total,amount_paid,place_of_supply_state_code,issued_at) values($1,$2,$3,$4,'INV-OLO-1',current_date,current_date+30,'generated',120000,0,120000,0,'07',now())", [id(), i.company, i.customer2, a.order]);
  const life = await olo("lifecycle.order", { order_id: a.order }, i.production);
  assert.deepEqual([life.quantities.ordered_kg, life.quantities.produced_kg, life.quantities.qc_accepted_kg, life.quantities.qc_pending_kg, life.quantities.qc_rejected_kg].map(Number), [1000, 1000, 700, 100, 200]);
  assert.equal(Number(life.quantities.outstanding_kg), 1000, "nothing is dispatched, so the whole order is outstanding");
  assert.equal(life.overall, "awaiting_quality");
  assert.equal(life.domains.find(d => d.key === "quality").status, "held");
  assert.equal(life.next_action.department, "quality");
  assert.match(life.next_action.label, /Decide 100 kg of material awaiting a QC disposition/);
  assert.equal(life.finance, null);
  assert.equal(life.domains.find(d => d.key === "payment").detail, "Amounts are visible to finance");
  assert.equal(life.timeline.some(e => /₹/.test(e.summary)), false);

  const fin = await olo("lifecycle.order", { order_id: a.order }, i.accounts);
  assert.equal(Number(fin.finance.balance), 120000);
  assert.match(fin.domains.find(d => d.key === "payment").detail, /balance ₹1,20,000.00/);

  // 500 kg dispatched: partially fulfilled, never completed.
  const d = id();
  await seed("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,total_weight_kg,number_of_bundles,actual_dispatched_at) values($1,$2,$3,'DC-OLO-1',current_date,'dispatched',500,1,now())", [d, i.company, a.order]);
  await seed("insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,net_length_m,source_kind,source_record_id) values($1,$2,$3,$4,'B-OLO-1',50,505,5,300,'production',$5)", [id(), i.company, d, i.profile2, a.order]);
  await seed("update quality_inspections set status='approved' where production_job_id=$1 and status='pending'", [a.job]);
  const part = await olo("lifecycle.order", { order_id: a.order }, i.sales);
  assert.equal(part.overall, "partially_fulfilled");
  assert.deepEqual([part.quantities.dispatched_kg, part.quantities.delivered_kg, part.quantities.outstanding_kg].map(Number), [500, 0, 500]);
  assert.equal(part.domains.find(d => d.key === "dispatch").status, "in_transit");
  assert.equal(part.domains.find(d => d.key === "delivery").status, "not_delivered", "dispatched is not delivered");

  const board = await olo("lifecycle.board", { search: "SO-OLO" }, i.viewer);
  assert.ok(board.rows.length >= 1 && board.rows.length <= 10);
  const summary = await olo("lifecycle.summary", {}, i.production);
  assert.equal(summary.orders_financially_outstanding, null);
  assert.equal(typeof summary.workflow_tasks_open, "number");
});

test("security: dealers and foreign companies see nothing; only owner, admin or factory manager change settings", async () => {
  const a = await job({ hours: 1 });
  await evaluate();
  await assert.rejects(() => olo("tasks.inbox", {}, i.dealer), denied);
  await assert.rejects(() => olo("settings.save", { billet_rank_threshold: 4 }, i.production), denied);
  await assert.rejects(() => olo("routing.save", { department: "foundry", stage: 0, roles: ["production"] }, i.factory), denied);
  const foreign = await olo("tasks.inbox", { view: "all" }, i.foreign);
  assert.equal(foreign.total, 0);
  await assert.rejects(() => olo("lifecycle.order", { order_id: a.order }, i.foreign), /unavailable/);
  assert.equal(Number((await f.asUser("select count(*) n from production_queue_positions", [], i.dealer))[0].n), 0);
  assert.equal(Number((await f.asUser("select count(*) n from production_queue_positions", [], i.foreign))[0].n), 0);
  assert.ok(Number((await f.asUser("select count(*) n from production_queue_positions", [], i.viewer))[0].n) >= 1);
  await assert.rejects(() => raw("update production_queue_rank_events set new_rank=1"), /append-only/);

  // Routing is configurable: the owner sends foundry work to production staff only.
  await olo("routing.save", { department: "billet_inventory", stage: 0, roles: ["production"] }, i.owner);
  const b = await job({ hours: 0.5 });
  await evaluate();
  const [t] = await tasksOf(b.job, "billet_allocation");
  assert.ok([i.production, i.backup].includes(t.assigned_to));
  assert.equal(await rankOf(b.job), 1);
});
