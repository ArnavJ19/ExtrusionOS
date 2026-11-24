// Order lifecycle Phase 5 screens on a replayed local database with synthetic records only:
//   A. a T5 job: 1000 kg first-stage approved, aged in HT-P5 and reviewed (950 kg accepted, 50 kg rejected) — final QC;
//   B. a T5 job: 600 kg approved and not yet loaded — waiting for ageing (listed in the queue, no final QC yet);
//   C. a T5 job whose ageing cycle is past its maximum soak with an out-of-range reading (overdue and deviation alerts).
// Prints the screen URLs. Usage: node --experimental-strip-types scripts/olo-phase5-preview.mjs
import { createOloPhase5BrowserFixture } from "./lib/olo-phase5-browser-fixture.mjs";

process.env.OLO_PHASE5_FIXTURE_PORT ??= "4193";
const fx = await createOloPhase5BrowserFixture();
await fx.start();
const i = fx.ids;
const OVEN = "0e5f0000-0000-4000-8000-000000000001", RECIPE = "0e5f0000-0000-4000-8000-000000000002";
let seq = 100;
const id = () => `0e5f0000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const data = await fx.run(async () => {
  const f = fx.f;
  const raw = async (sql, p = []) => (await f.db.query(sql, p)).rows;
  await f.seed("insert into machines(id,company_id,machine_name,machine_type,status,is_active) values($1,$2,'Ageing oven 1','aging_oven','active',true)", [OVEN, i.company]);
  await f.seed(`insert into treatment_recipes(id,company_id,recipe_code,revision,name,process,alloys,target_temper,temp_min_c,temp_max_c,soak_min_minutes,soak_max_minutes,min_readings,status,created_by,approved_by,approved_at)
    values($1,$2,'t5_6063',1,'6063 T5 artificial ageing','artificial_ageing','{6063}','T5',180,200,240,300,2,'approved',$3,$4,now())`, [RECIPE, i.company, i.productionManager, i.quality]);
  async function batch(job, kg, { started = null, status = "loaded" } = {}) {
    const b = id(), input = id();
    await raw("insert into treatment_batches(id,company_id,batch_number,recipe_id,machine_id,load_note,loaded_by,status,started_at) values($1,$2,$3,$4,$5,'Racked on trolley 2',$6,$7,$8)",
      [b, i.company, `HT-P5-${b.slice(-3)}`, RECIPE, OVEN, i.production, status, started]);
    await raw("insert into treatment_inputs(id,company_id,batch_id,production_job_id,profile_id,alloy,temper,quantity_kg) values($1,$2,$3,$4,$5,'6063','T5',$6)", [input, i.company, b, job, i.profile2, kg]);
    return { b, input };
  }
  // A. Aged and reviewed: final QC to record.
  const a = await f.order({ kg: 1000, pieces: 175 });
  const jobA = await f.readyJob({ order: a.order, line: a.line, kg: 1000, packagedKg: 0, number: "JOB-P5-A" });
  const ba = await batch(jobA, 1000, { started: new Date(Date.now() - 5 * 3600 * 1000).toISOString(), status: "running" });
  for (const c of [188, 190, 191]) await raw("insert into treatment_observations(company_id,batch_id,temperature_c,instrument_ref,recorded_by) values($1,$2,$3,'TC-04',$4)", [i.company, ba.b, c, i.production]);
  await raw("update treatment_batches set status='ended', ended_at=now() where id=$1", [ba.b]);
  await raw("update treatment_inputs set accepted_kg=950, rejected_kg=50, retreat_kg=0 where id=$1", [ba.input]);
  await raw("update treatment_batches set status='partially_released', reviewed_by=$2, reviewed_at=now() where id=$1", [ba.b, i.quality]);
  await f.seed("update aluminium_profiles set tensile_strength_mpa=160, yield_strength_mpa=110, elongation_percent=8 where id=$1", [i.profile2]);
  // B. Approved, waiting for an oven.
  const b = await f.order({ kg: 600 });
  const jobB = await f.readyJob({ order: b.order, line: b.line, kg: 600, packagedKg: 0, number: "JOB-P5-B" });
  // C. Overdue cycle with a reading out of range.
  const c = await f.order({ kg: 500 });
  const jobC = await f.readyJob({ order: c.order, line: c.line, kg: 500, packagedKg: 0, number: "JOB-P5-C" });
  const bc = await batch(jobC, 500, { started: new Date(Date.now() - 8 * 3600 * 1000).toISOString(), status: "running" });
  await raw("insert into treatment_observations(company_id,batch_id,temperature_c,instrument_ref,recorded_by) values($1,$2,212,'TC-07',$3)", [i.company, bc.b, i.production]);
  // Approvals recorded through the QC screen always carry the inspector (the release guard requires it).
  await f.seed("update quality_inspections set inspector_name='QA day shift', batch_number='LOT-P5', surface_finish_ok=true where production_job_id = any($1)", [[jobA, jobB, jobC]]);
  await f.call("olo_command", "evaluate", {}, i.owner);
  return { jobA, jobB, jobC };
});
const u = (screen, user, extra = "") => `${fx.base}/?screen=${screen}&user=${user}${extra}`;
console.log(JSON.stringify({ base: fx.base, users: { quality: i.quality, production: i.production, factory: i.factory }, screens: [
  u("final", i.quality, `&job=${data.jobA}`), u("final", i.quality, `&job=${data.jobA}&lang=hi`), u("final", i.quality, `&job=${data.jobB}`),
  u("final", i.production, `&job=${data.jobA}`), u("queue", i.quality), u("alerts", i.quality), u("alerts", i.factory)] }, null, 2));
process.on("SIGINT", async () => { await fx.close(); process.exit(0); });
