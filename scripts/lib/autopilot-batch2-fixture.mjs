import { createAutopilotFixture, apIds, istDay, nid } from "./autopilot-batch1-fixture.mjs";

export { istDay, nid };
// Press floor fixture: two presses, a running job with four linked 60 kg billets (178 mm), an approved company scrap
// standard, an approved inspection plan with two characteristics, and an open station session for the operator.
export const pIds = {
  ...apIds,
  press: nid(300), press2: nid(301), foreignPress: nid(302), jobA: nid(310), jobB: nid(311), jobC: nid(312), jobNoWeight: nid(313), foreignJob: nid(314),
  die2: nid(320), session: nid(330), session2: nid(331), standard: nid(340), plan: nid(350), item1: nid(351), item2: nid(352), batch: nid(360),
  billets: [nid(370), nid(371), nid(372), nid(373)], billetsB: [nid(380), nid(381)], threshold: nid(390)
};

export async function createPressFixture() {
  const f = await createAutopilotFixture();
  const { db } = f, i = pIds;
  await db.exec("set session_replication_role = replica");
  await db.query(`insert into machines(id,company_id,machine_name,machine_type,status,is_active) values
    ($1,$4,'Press 1 (1460 T)','extrusion_press','active',true),($2,$4,'Press 2 (880 T)','extrusion_press','active',true),($3,$5,'Foreign press','extrusion_press','active',true)`,
    [i.press, i.press2, i.foreignPress, i.company, i.foreignCompany]);
  await db.query("update aluminium_profiles set billet_diameter_mm=178, pieces_per_bundle=10 where id=$1", [i.profile2]);
  await db.query("update orders set production_quantity_kg=5000, manufacturing_weight_kg=5000 where id = any($1)", [[i.order, i.order2]]);
  await db.query("update dies set die_type='solid' where id=$1", [i.die]);
  await db.query("insert into dies(id,company_id,die_number,profile_id,die_status,die_type) values($1,$2,'D-2045-B',$3,'active','solid')", [i.die2, i.company, i.profile2]);
  const job = `insert into production_jobs(id,company_id,job_number,machine_id,die_id,profile_id,status,planned_quantity_kg,pieces,length_per_piece_m,section_weight_kg_per_m,order_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;
  await db.query(job, [i.jobA, i.company, "PJ-A", i.press, i.die, i.profile2, "in_progress", 228, 40, 6, 0.95, i.order]);
  await db.query(job, [i.jobB, i.company, "PJ-B", i.press, i.die2, i.profile2, "in_progress", 114, 20, 6, 0.95, i.order2]);
  await db.query(job, [i.jobC, i.company, "PJ-C", i.press2, i.die, i.profile2, "planned", 300, 50, 6, 0.95, i.order]);
  await db.query(job, [i.jobNoWeight, i.company, "PJ-NW", i.press2, i.die2, i.profile2, "in_progress", 100, 0, 6, null, i.order2]);
  await db.query(job, [i.foreignJob, i.foreignCompany, "PJ-F", i.foreignPress, null, i.profile, "in_progress", 100, 0, 6, 0.95, i.foreignOrder]);
  // Section weight also on the profile, so the job without its own kg/m must fall back (and then be cleared in a test).
  await db.query("update aluminium_profiles set section_weight_kg_per_m=0.95 where id=$1", [i.profile2]);
  await db.query("insert into foundry_batches(id,company_id,batch_number,alloy,temper,billet_length_mm,billet_diameter_mm,billet_count,batch_sequence,furnace_number,status,production_date,billet_diameter_inch,billet_weight_density_kg) values($1,$2,'FB-AP2','6063','T5',900,178,6,1,'F-1','issued','2026-11-01',7,60)", [i.batch, i.company]);
  let n = 1;
  for (const id of i.billets) {
    await db.query(`insert into foundry_billets(id,company_id,foundry_batch_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,alloy,temper,weight_kg,production_job_id,status,source_type,order_id)
      values($1,$2,$3,$4,$5,7,178,900,'6063','T5',60,$6,'issued','in_house',$7)`, [id, i.company, i.batch, `F-1-20261101-1-${n}`, n, i.jobA, i.order]);
    n++;
  }
  for (const id of i.billetsB) {
    await db.query(`insert into foundry_billets(id,company_id,foundry_batch_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,alloy,temper,weight_kg,production_job_id,status,source_type,order_id)
      values($1,$2,$3,$4,$5,7,178,900,'6063','T5',60,$6,'issued','in_house',$7)`, [id, i.company, i.batch, `F-1-20261101-1-${n}`, n, i.jobB, i.order2]);
    n++;
  }
  await db.query(`insert into scrap_standards(id,company_id,version,butt_length_mm,front_crop_mm,back_crop_mm,saw_kerf_mm,density_kg_m3,default_billet_length_mm,rationale,status,proposed_by,approved_by,approved_at)
    values($1,$2,1,25,500,500,4,2700,900,'Fixture standard from press trials','approved',$3,$4,now())`, [i.standard, i.company, i.productionManager, i.owner]);
  await db.query(`insert into inspection_plans(id,company_id,profile_id,version,status,sampling_instruction,created_by,approved_by,approved_at) values($1,$2,$3,1,'approved','First piece and periodic checks',$4,$5,now())`,
    [i.plan, i.company, i.profile2, i.quality, i.owner]);
  await db.query(`insert into inspection_plan_items(id,plan_id,company_id,seq,characteristic,unit,method,nominal,lower_limit,upper_limit,critical) values
    ($1,$3,$4,1,'Wall thickness','mm','Micrometer',1.4,1.3,1.5,true),($2,$3,$4,2,'Surface','visual','Visual',null,null,null,false)`, [i.item1, i.item2, i.plan, i.company]);
  await db.query("insert into workstation_sessions(id,company_id,operator_id,machine_id,expires_at) values($1,$2,$3,$4,now()+interval '1 day'),($5,$2,$6,$4,now()+interval '1 day')",
    [i.session, i.company, i.production, i.press, i.session2, i.backup]);
  await db.exec("set session_replication_role = origin");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  const press = (command, payload = {}, actor = i.production) => f.call("ap_press", command, payload, actor);
  let tap = 0;
  // A tap at a chosen offset in seconds from now (offline taps keep their own time; replays reuse the id).
  const push = (offsetSeconds = 0, extra = {}, actor = i.production, session = i.session, jobId = i.jobA) =>
    press("push", { id: nid(5000 + tap++), session_id: session, job_id: jobId, client_at: new Date(Date.now() + offsetSeconds * 1000).toISOString(), ...extra }, actor);
  return { ...f, ids: i, press, push };
}
