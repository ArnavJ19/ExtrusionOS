import { createNov5Fixture, nid, nids as nov5Ids } from "./nov-batch5-fixture.mjs";

export { nid };
export const nids = {
  ...nov5Ids,
  dieA: nid(400), dieB: nid(401), jobC1: nid(402), jobC2: nid(403), jobC3: nid(404), jobX: nid(405), jobRun: nid(406),
  qiR1: nid(410), qiR2: nid(411), qiA1: nid(412), qiA2: nid(413), qiA3: nid(414), qiA4: nid(415), qiPend: nid(416),
  exception1: nid(420), disposition1: nid(421), ticket1: nid(422), correction1: nid(423), nitriding1: nid(424), outputCorrection1: nid(425), flag1: nid(426),
  orderLate: nid(430), orderNoDate: nid(431), dispatchLate: nid(432), dispatchNoDate: nid(433),
  taskT1: nid(440), taskT2: nid(441), taskOverdue: nid(442), taskLater: nid(443), taskNoDue: nid(444), purchase1: nid(450), procedureVersion: nid(460), procedureImprovement: nid(461), procedureRejected: nid(462)
};

const hoursAgo = hours => new Date(Date.now() - hours * 3600000).toISOString();

// Builds on the batch 5 fixture (the full chain, which includes the batch 7 migration) and seeds the
// source records the improvement workflows read. Seeding runs with source triggers suspended; every
// scenario then runs with all production triggers and guards enabled.
export async function createNov7Fixture() {
  const base = await createNov5Fixture();
  const { db } = base, ids = nids;
  await db.exec("set session_replication_role = replica");
  // NOV-025: a hollow die with an opening balance, three completed runs (one without output), a
  // cancelled run, a correction 15 days ago and nitriding 5 days ago; and a blocked solid die.
  await db.query(`insert into dies(id,company_id,die_number,profile_id,die_status,die_type,rack_location,opening_production_kg,opening_runs,total_production_kg,total_runs)
    values($1,$3,'DIE-NOV7-A',$4,'active','hollow','Rack D1',1000,2,1700,5),($2,$3,'DIE-NOV7-B',$4,'blocked','solid','Rack D2',0,0,0,0)`, [ids.dieA, ids.dieB, ids.company, ids.profile]);
  const job = (id, status, number, kg, completedHoursAgo) => db.query(`insert into production_jobs(id,company_id,order_id,profile_id,die_id,status,planned_quantity_kg,actual_quantity_kg,job_number,source_line_id,planned_date,completed_at,created_by,created_at,updated_at)
    values($1,$2,$3,$4,$5,$6,500,$7,$8,$9,current_date-20,$10,$11,now()-interval '30 days',now())`, [id, ids.company, ids.order, ids.profile, ids.dieA, status, kg, number, ids.line1, completedHoursAgo === null ? null : hoursAgo(completedHoursAgo), ids.production]);
  await job(ids.jobC1, "completed", "J-NOV7-C1", 400, 240);
  await job(ids.jobC2, "completed", "J-NOV7-C2", 300, 48);
  await job(ids.jobC3, "completed", "J-NOV7-C3", 0, 24);
  await job(ids.jobX, "cancelled", "J-NOV7-X", 0, null);
  await db.query("insert into production_output_corrections(id,company_id,production_job_id,changed_by,reason,prior_weight_kg,prior_pieces,prior_meters,corrected_weight_kg,corrected_pieces,corrected_meters,created_at) values($1,$2,$3,$4,'Weighbridge slip re-read',450,60,360,400,55,330,now()-interval '9 days')",
    [ids.outputCorrection1, ids.company, ids.jobC1, ids.productionManager]);
  await db.query("insert into die_corrections(id,company_id,die_id,correction_date,correction_reason,correction_type,result_status) values($1,$2,$3,current_date-15,'bearing_issue','polishing','success')", [ids.correction1, ids.company, ids.dieA]);
  await db.query("insert into die_nitriding_history(id,company_id,die_id,nitriding_cycle_number,nitriding_date,status) values($1,$2,$3,1,current_date-5,'completed')", [ids.nitriding1, ids.company, ids.dieA]);
  await db.query("insert into operator_location_history(company_id,entity_type,entity_id,previous_location,location,reason,recorded_by,recorded_at) values($1,'die',$2,'Rack D9','Rack D1','Returned after nitriding',$3,now()-interval '4 days')", [ids.company, ids.dieA, ids.production]);
  // NOV-053 and NOV-054: inspections in a baseline window (15 and 12 days ago) and a recent one.
  const inspection = (id, jobId, status, hours, batch) => db.query("insert into quality_inspections(id,company_id,production_job_id,profile_id,batch_number,quantity_checked_kg,status,inspection_date) values($1,$2,$3,$4,$5,100,$6,$7)",
    [id, ids.company, jobId, ids.profile, batch, status, hoursAgo(hours)]);
  await inspection(ids.qiR2, ids.jobC1, "rejected", 15 * 24, "QC-R2");
  await inspection(ids.qiA1, ids.jobC1, "approved", 12 * 24, "QC-A1");
  await inspection(ids.qiR1, ids.jobC2, "rejected", 24, "QC-R1");
  await inspection(ids.qiA2, ids.jobC2, "approved", 20, "QC-A2");
  await inspection(ids.qiA3, ids.jobC3, "approved", 18, "QC-A3");
  await inspection(ids.qiA4, ids.jobC3, "approved", 16, "QC-A4");
  await inspection(ids.qiPend, ids.jobC3, "pending", 12, "QC-P");
  await db.query("insert into production_exceptions(id,company_id,production_job_id,order_id,reason,note,recorded_by,reporter_name,recorded_at) values($1,$2,$3,$4,'die_damage','Drag marks on the web',$5,'Fixture production',now()-interval '2 days')",
    [ids.exception1, ids.company, ids.jobC2, ids.order, ids.production]);
  await db.query("insert into delivery_dispositions(id,company_id,dispatch_id,packing_list_item_id,disposition,quantity_kg,receiver_name,evidence,owner_id,recorded_by) values($1,$2,$3,$4,'damaged',20,'Site store','Photo of scratched bundle',$5,$5)",
    [ids.disposition1, ids.company, ids.dispatch1, ids.bundle1, ids.dispatchManager]);
  await db.query("insert into support_tickets(id,company_id,customer_id,ticket_number,issue_type,description,status) values($1,$2,$3,'TKT-NOV7','quality_issue','Private customer complaint text','open')", [ids.ticket1, ids.company, ids.customer]);
  // NOV-054: one dispatch left after its expected date and one for an order without an expected date.
  for (const [id, number, expected] of [[ids.orderLate, "SO-NOV7-LATE", "current_date-5"], [ids.orderNoDate, "SO-NOV7-NODATE", "null"]]) {
    await db.query(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,requested_weight_kg,manufacturing_weight_kg) values($1,$2,$3,$4,current_date-20,${expected},'normal','dispatched',100,100)`,
      [id, ids.company, number, ids.customer]);
  }
  for (const [id, order, number] of [[ids.dispatchLate, ids.orderLate, "D-NOV7-LATE"], [ids.dispatchNoDate, ids.orderNoDate, "D-NOV7-NODATE"]]) {
    await db.query("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,number_of_bundles,total_weight_kg,delivery_status,actual_dispatched_at,last_status_changed_at) values($1,$2,$3,$4,current_date,1,100,'in_transit',now()-interval '1 day',now())",
      [id, ids.company, order, number]);
  }
  // NOV-054: tasks with a start mark and a recorded wait, one without a start, and open tasks.
  const task = (id, title, type, status, created, completed, due) => db.query("insert into tasks(id,company_id,title,task_type,status,priority,created_at,completed_at,due_date,created_by) values($1,$2,$3,$4,$5,'normal',$6,$7,$8,$9)",
    [id, ids.company, title, type, status, created, completed, due, ids.owner]);
  await task(ids.taskT1, "Inspect returned bundle", "inspection", "completed", hoursAgo(10), hoursAgo(0.01), null);
  await task(ids.taskT2, "Update rack labels", "general", "completed", hoursAgo(2.01), hoursAgo(0.01), null);
  await task(ids.taskOverdue, "Chase LR copy", "general", "open", hoursAgo(72), null, new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10));
  await task(ids.taskLater, "Plan die trial", "general", "open", hoursAgo(5), null, new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10));
  await task(ids.taskNoDue, "Tidy die rack", "general", "in_progress", hoursAgo(5), null, null);
  await db.query("insert into task_turnaround_marks(task_id,company_id,first_started_at,finished_at) values($1,$2,$3,$4)", [ids.taskT1, ids.company, hoursAgo(6.01), hoursAgo(0.01)]);
  await db.query("insert into task_waits(company_id,task_id,reason,note,started_at,ended_at,started_by) values($1,$2,'waiting_material','Bundle not at the bay',$3,$4,$5)", [ids.company, ids.taskT1, hoursAgo(5.01), hoursAgo(4.01), ids.quality]);
  await db.query("insert into turnaround_targets(company_id,task_kind,completion_minutes,calendar,escalation_role,updated_by) values($1,'type:inspection',60,'24x7','factory_manager',$2)", [ids.company, ids.owner]);
  // A procedure change in trial that a problem or suggestion can be linked to.
  await db.query("insert into procedure_versions(id,company_id,procedure_id,version_no,status,steps,change_summary,content_hash,author_id,author_name) values($1,$2,$3,1,'draft','[{\"text\":\"Check die bearing\"}]','First draft','fixture',$4,'Fixture factory')",
    [ids.procedureVersion, ids.company, ids.procedure, ids.factory]);
  await db.query("insert into procedure_improvements(id,company_id,procedure_id,title,problem_summary,status,baseline_version_id,proposed_by,proposed_by_name) values($1,$2,$3,'Bearing check before every run','Drag marks recur after start-up','trial',$4,$5,'Fixture factory'),($6,$2,$3,'Rejected idea','Not useful','rejected',$4,$5,'Fixture factory')",
    [ids.procedureImprovement, ids.company, ids.procedure, ids.procedureVersion, ids.factory, ids.procedureRejected]);
  await db.exec("set session_replication_role = origin");

  const command = async (name, payload, actor = ids.owner) => (await base.asUser("select public.improvement_command($1,$2) data", [name, payload], actor))[0].data;
  const prepare = (mutation, actor = ids.owner, request_id = base.nextId()) => command("preview", { mutation, request_id }, actor);
  const commit = (preview, actor = ids.owner) => command("commit", { request_id: preview.request_id, fingerprint: preview.fingerprint }, actor);
  const apply = async (mutation, actor = ids.owner) => commit(await prepare(mutation, actor), actor);
  const repeatLink = async (resource, source, target, fields, actor = ids.owner) => (await base.asUser("select public.record_repeat_link($1,$2,$3,$4) data", [resource, source, target, fields], actor))[0].data;
  return { ...base, ids, command, prepare, commit, apply, repeatLink };
}
