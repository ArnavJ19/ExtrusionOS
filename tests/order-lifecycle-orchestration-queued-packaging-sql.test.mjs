import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAutopilotFixture, apIds as i } from "../scripts/lib/autopilot-batch1-fixture.mjs";

// Migration 20261124200000: a QC reversal is not blocked by the 'scheduled' packaging job a completed run queues, only
// by packaging that has started; a queued packaging job left larger than the approved material is flagged to
// packaging. Synthetic data only.
let f;
let seq = 60000;
const id = () => `0e600000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const PRESS = "0e600000-0000-4000-8000-000000000001";
const q = async (sql, p = []) => (await f.db.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
let inTx = false;
async function seed(sql, p = []) {
  if (!inTx) { await f.db.exec("set session_replication_role = replica"); try { return (await f.db.query(sql, p)).rows; } finally { await f.db.exec("set session_replication_role = origin"); } }
  await f.db.exec("savepoint qp_seed; set session_replication_role = replica");
  try { const r = await f.db.query(sql, p); await f.db.exec("set session_replication_role = origin; release savepoint qp_seed"); return r.rows; }
  catch (error) { await f.db.exec("rollback to savepoint qp_seed; set session_replication_role = origin; release savepoint qp_seed"); throw error; }
}
const rev = (command, payload = {}, actor = i.quality) => f.call("quality_reversal_command", command, payload, actor);
const qc = (command, payload, actor = i.quality) => f.call("quality_containment_command", command, payload, actor);
const num = v => Number(v);

test.before(async () => {
  f = await createAutopilotFixture();
  await seed("insert into machines(id,company_id,machine_name,machine_type,status,is_active,press_capacity_ton) values($1,$2,'Press E (1460 T)','extrusion_press','active',true,1460)", [PRESS, i.company]);
});
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); inTx = true; });
test.afterEach(async () => {
  inTx = false;
  const errors = await q("select source, message from olo_engine_errors");
  await f.rollback();
  assert.deepEqual(errors, [], "the orchestration engine logged no errors");
});

/** A completed 1000 kg run, approved in full, with the packaging queue entry its completion creates. */
async function run({ approved = 1000, packaging = [["scheduled", 1000]] } = {}) {
  const o = id(), line = id(), j = id(), ins = id();
  await seed(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,manufacturing_weight_kg,requested_weight_kg,production_quantity_kg,order_value)
    values($1,$2,$3,$4,current_date,current_date+10,'normal','order_confirmed',1000,1000,1000,236000)`, [o, i.company, `SO-QP-${o.slice(-4)}`, i.customer2]);
  await seed("insert into order_items(id,company_id,order_id,profile_id,die_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,section_weight_kg_per_m) values($1,$2,$3,$4,$5,'Sliding track',100,6,1000,0.95)", [line, i.company, o, i.profile2, i.die]);
  await seed(`insert into production_jobs(id,company_id,order_id,source_line_id,profile_id,die_id,machine_id,status,planned_date,planned_quantity_kg,actual_quantity_kg,completed_at,job_number)
    values($1,$2,$3,$4,$5,$6,$7,'completed',current_date,1000,1000,now(),$8)`, [j, i.company, o, line, i.profile2, i.die, PRESS, `JOB-QP-${j.slice(-4)}`]);
  await seed(`insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status,batch_number,inspector_name,surface_finish_ok,weight_per_meter_actual)
    values($1,$2,$3,$4,now()-interval '2 hours',$5,'approved','LOT-QP','QA day shift',true,0.95)`, [ins, i.company, j, i.profile2, approved]);
  const pkgs = [];
  for (const [status, kg] of packaging) {
    const p = id();
    await seed("insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,scheduled_date,pieces,profile_weight_kg,profile_length_m,status) values($1,$2,$3,$4,$5,current_date,10,$6,60,$7)",
      [p, i.company, `PKG-QP-${p.slice(-4)}`, o, j, kg, status]);
    pkgs.push(p);
  }
  return { order: o, job: j, ins, pkgs };
}
const reverse = (a, kg, extra = {}) => rev("reverse", { inspection_id: a.ins, reversed_kg: kg, reversed_as: "rejected", method: "Webster hardness re-test",
  reason: "Customer complaint: hardness below 12 HW on site", ...extra });

test("a packaging job that is only queued does not block a reversal; packaging is told to pack only approved material", async () => {
  const a = await run();
  const preview = await rev("preview", { inspection_id: a.ins });
  assert.deepEqual([num(preview.moved_on_kg), num(preview.max_reversible_kg), preview.can_reverse], [0, 1000, true]);
  const r = await reverse(a, 100);
  assert.deepEqual([num(r.reversed_kg), num(r.retained_kg)], [100, 900]);
  assert.deepEqual(r.queued_packaging_over.map(x => [x.packaging_number.startsWith("PKG-QP-"), num(x.scheduled_kg), num(x.over_kg)]), [[true, 1000, 100]]);
  const alert = await q("select recipient_role, body from notifications where condition_key=$1", [`olo-pkg-over:${a.pkgs[0]}:${r.id}`]);
  assert.ok(alert.some(n => n.recipient_role === "dispatch_manager"), "packaging is told");
  assert.ok(alert.some(n => n.recipient_role === "production_manager"), "production planning is told");
  assert.match(alert[0].body, /Pack only QC-approved material/);
  assert.equal((await one("select status, profile_weight_kg kg from packaging_jobs where id=$1", [a.pkgs[0]])).status, "scheduled", "the packaging job itself is not changed");
  assert.equal((await q("select 1 from olo_events where event_type='packaging.queue_over_approved' and production_job_id=$1", [a.job])).length, 1);
});

test("packaging that has started still limits the reversal; a queued job within what remains approved is not flagged", async () => {
  // A run has at most one live packaging job (packaging_jobs_one_active_unfinished_source_idx).
  const a = await run({ packaging: [["in_progress", 600]] });
  const preview = await rev("preview", { inspection_id: a.ins });
  assert.deepEqual([num(preview.moved_on_kg), num(preview.max_reversible_kg)], [600, 400]);
  await assert.rejects(() => reverse(a, 500), /600 kg of this job has already moved.*at most 400 kg/);
  assert.deepEqual((await reverse(a, 100)).queued_packaging_over, [], "nothing is queued");

  const b = await run({ packaging: [["scheduled", 800]] });
  const r = await reverse(b, 100);
  assert.deepEqual(r.queued_packaging_over, [], "900 kg stays approved, enough for the 800 kg queued");
  const r2 = await rev("reverse", { inspection_id: r.retained_inspection_id, reversed_kg: 150, reversed_as: "rework", method: "Micrometer re-check", reason: "Wall below drawing on bundle 7" });
  assert.deepEqual(r2.queued_packaging_over.map(x => num(x.over_kg)), [50], "750 kg approved for an 800 kg queue entry");
});

test("revoking an approval under containment raises no recall for a run whose packaging is only queued", async () => {
  const a = await run({ approved: 400, packaging: [["scheduled", 1000]] });
  const c = await qc("open", { job_id: a.job, scope_kg: 600, stage: "final", defect: "Hardness below specification on sample 2", defect_kind: "non_destructive" });
  await qc("prior_review", { id: c.id, inspection_id: a.ins, outcome: "revoked", method: "Webster hardness re-test", note: "Below 12 HW on 3 of 5 pieces" });
  const alert = await one("select severity, body from notifications where condition_key=$1 order by created_at desc limit 1", [`olo-prior-revoked:${a.ins}`]);
  assert.ok(alert, "the revocation is still announced");
  assert.doesNotMatch(alert.body, /already moved to ageing, packaging or dispatch/, "no recall is asked for material that was never packed");
});

test("the migration changes one function where it says so and wraps the reversal command", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261124200000_order_lifecycle_reversal_queued_packaging.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/-- Queued packaging:/g) ?? []).length, 1);
  assert.match(sql, /x\.status in \('in_progress','completed'\)\), 0\),/);
  assert.match(sql, /alter function public\.quality_reversal_command\(text, jsonb\) rename to olo_quality_reversal_command_p4/);
  assert.doesNotMatch(sql, /drop table|drop column|disable row level security|update public\.packaging_jobs/i, "packaging jobs are never rewritten");
});
