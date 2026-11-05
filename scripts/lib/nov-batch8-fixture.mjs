import { createHash } from "node:crypto";
import { createNov7Fixture, nid, nids as nov7Ids } from "./nov-batch7-fixture.mjs";

export { nid };
export const nids = {
  ...nov7Ids,
  customer2: nid(500), customer3: nid(501), orderNoPhone: nid(502), orderReopen: nid(503), orderGap: nid(504), orderPay: nid(505), dispatch3: nid(506), dispatch4: nid(507), dispatchPending: nid(508),
  bundleX1: nid(510), bundleX2: nid(511), vehicle1: nid(512), vehicle2: nid(513), load1: nid(514), load2: nid(515), loadClosed: nid(516), item1: nid(517), item2: nid(518), item3: nid(519), itemC1: nid(520), itemC2: nid(521),
  dieC: nid(522), jobDieUse: nid(523), jobWin1: nid(524), jobWin2: nid(525), jobWin3: nid(526), jobWin4: nid(527), jobHold: nid(528), jobReady: nid(529),
  taskIns: nid(530), taskQc: nid(531), taskAssigned1: nid(532), taskAssigned2: nid(533), taskDone: nid(534), taskPrio: nid(535), taskPrio2: nid(536), taskDue: nid(537)
};

const day = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export { day };

// Builds on the batch 7 fixture (the full chain, which includes the batch 8 migration) and seeds the
// source records the execution workflows read. Seeding runs with source triggers suspended; every
// scenario then runs with all production triggers and guards enabled.
export async function createNov8Fixture() {
  const base = await createNov7Fixture();
  const { db } = base, ids = nids;
  await db.exec("set session_replication_role = replica");
  await db.query("update customers set shipping_address='Plot 14, MIDC Road, Pune 411019',whatsapp_number='98765 43210',phone='09876543211',city='Pune' where id=$1", [ids.customer]);
  await db.query("insert into customers(id,company_id,customer_name,customer_type,phone,shipping_address,city) values($1,$2,'Fixture dealer no phone','fabricator',null,'Gat 9, Nashik','Nashik'),($3,$2,'Fixture second site','fabricator','9123456789','Shed 3, Bhosari, Pune','Pune')",
    [ids.customer2, ids.company, ids.customer3]);
  const order = (id, number, customer, stage) => db.query("insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,requested_weight_kg,manufacturing_weight_kg) values($1,$2,$3,$4,current_date-6,current_date+8,'normal',$5,1500,1500)",
    [id, ids.company, number, customer, stage]);
  await order(ids.orderNoPhone, "SO-NOV8-NOPHONE", ids.customer2, "extrusion_planned");
  await order(ids.orderReopen, "SO-NOV8-REOPEN", ids.customer, "extruded");
  await order(ids.orderGap, "SO-NOV8-GAP", ids.customer, "cutting");
  await order(ids.orderPay, "SO-NOV8-PAY", ids.customer3, "payment_pending");
  // Stage evidence: a clean order, a reopened one and one that skipped evidence.
  const hist = (orderId, stage, daysAgo) => db.query("insert into order_stage_history(company_id,order_id,stage,changed_by,changed_at) values($1,$2,$3,$4,now()-($5||' days')::interval)", [ids.company, orderId, stage, ids.owner, daysAgo]);
  for (const [stage, ago] of [["order_confirmed", 5], ["die_ready", 4], ["billet_ready", 3], ["extrusion_planned", 2]]) await hist(ids.order, stage, ago);
  for (const [stage, ago] of [["order_confirmed", 6], ["extruded", 5], ["cutting", 4], ["extruded", 3]]) await hist(ids.orderReopen, stage, ago);
  await hist(ids.orderGap, "order_confirmed", 6);
  // Dispatches: a part dispatch on the main order, one for the second customer, one pending.
  await db.query("update dispatches set total_weight_kg=500,delivery_status='in_transit',vehicle_number='MH12AB1234',transporter_name='Fixture Carriers',lr_number='LR-77',number_of_bundles=2 where id=$1", [ids.dispatch1]);
  await db.query("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,number_of_bundles,total_weight_kg,delivery_status,last_status_changed_at) values($1,$2,$3,'D-NOV8-3',current_date,2,650,'pending',now()),($4,$2,$5,'D-NOV8-4',current_date,1,300,'dispatched',now()),($6,$2,$7,'D-NOV8-P',current_date,1,100,'pending',now())",
    [ids.dispatch3, ids.company, ids.order2, ids.dispatch4, ids.orderPay, ids.dispatchPending, ids.order]);
  for (const [id, dispatch, number, net, order2] of [[ids.bundleX1, ids.dispatch3, "BX1", 150, ids.line2], [ids.bundleX2, ids.dispatch3, "BX2", 500, ids.line2]]) {
    await db.query(`insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,order_item_id,drawing_revision,net_length_m)
      values($1,$2,$3,$4,$5,10,$6,2,$7,'R1',60)`, [id, ids.company, dispatch, ids.profile2, number, net + 2, order2]);
  }
  // Vehicles and two reviewed loads: load1 mixes two orders within capacity; load2 is over capacity.
  await db.query("insert into factory_vehicles(id,company_id,registration_number,vehicle_label,capacity_kg,created_by) values($1,$2,'MH12-1000','Tipper 1000',1000,$3),($4,$2,'MH12-0400','Pickup 400',400,$3)", [ids.vehicle1, ids.company, ids.owner, ids.vehicle2]);
  for (const [id, vehicle, cap, status] of [[ids.load1, ids.vehicle1, 1000, "reviewed"], [ids.load2, ids.vehicle2, 400, "reviewed"], [ids.loadClosed, ids.vehicle1, 1000, "closed"]]) {
    await db.query("insert into factory_vehicle_loads(id,company_id,vehicle_id,load_date,status,capacity_kg,created_by) values($1,$2,$3,current_date+1,$4,$5,$6)", [id, ids.company, vehicle, status, cap, ids.owner]);
  }
  const item = (id, load, bundle, order2, line, kg) => db.query(`insert into factory_vehicle_load_items(id,company_id,load_id,bundle_id,order_id,source_line_id,source_kind,profile_id,net_weight_kg,number_of_pieces,net_length_m,status,source_fingerprint,snapshot,created_by)
    values($1,$2,$3,$4,$5,$6,'production',$7,$8,10,60,'active',$10,'{}',$9)`, [id, ids.company, load, bundle, order2, line, ids.profile, kg, ids.owner, createHash("md5").update(String(id)).digest("hex")]);
  await item(ids.item1, ids.load1, ids.bundle1, ids.order, ids.line1, 300);
  await item(ids.item2, ids.load1, ids.bundle2, ids.order, ids.line1, 200);
  await item(ids.item3, ids.load1, ids.bundleX1, ids.order2, ids.line2, 150);
  await item(ids.itemC1, ids.load2, ids.bundle3, ids.order, ids.line1, 250);
  await item(ids.itemC2, ids.load2, ids.bundleX2, ids.order2, ids.line2, 500);
  // Dies, a job using one, and protected-window jobs on a press.
  await db.query("insert into dies(id,company_id,die_number,profile_id,die_status,die_type,rack_location) values($1,$2,'DIE-NOV8-C',$3,'active','solid','Rack D3')", [ids.dieC, ids.company, ids.profile]);
  const job = (id, orderId, line, status, number, date, shift, machine, kg, die) => db.query(`insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,job_number,source_line_id,planned_date,shift,machine_id,die_id,created_by,drawing_revision,cut_length,packing_instruction,section_weight_kg_per_m,finishing_type)
    values($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12,$13,'R1',6000,'Wrap each bundle',1.2,'anodizing')`, [id, ids.company, orderId, ids.profile, status, kg, number, line, date, shift, machine, die, ids.productionManager]);
  await job(ids.jobDieUse, ids.order, ids.line1, "planned", "J-NOV8-DIE", day(2), "Day", null, 300, ids.dieC);
  await job(ids.jobWin1, ids.order, ids.line1, "planned", "J-NOV8-W1", day(1), "Day", ids.press1, 500, null);
  await job(ids.jobWin2, ids.order, ids.line1, "planned", "J-NOV8-W2", day(10), "Day", ids.press1, 500, null);
  await job(ids.jobWin3, ids.order, ids.line1, "in_progress", "J-NOV8-W3", day(1), "Day", ids.press1, 400, null);
  await job(ids.jobWin4, ids.order2, ids.line2, "planned", "J-NOV8-W4", day(1), "Night", ids.press1, 300, null);
  await job(ids.jobHold, ids.order2, ids.line2, "on_hold", "J-NOV8-H", day(1), "Day", ids.press2, 300, null);
  await job(ids.jobReady, ids.order2, ids.line2, "ready", "J-NOV8-R", day(3), "Day", ids.press2, 500, null);
  // Tasks for assignment, queue updates and workload.
  const task = (id, title, type, status, priority, assignee, due) => db.query("insert into tasks(id,company_id,title,task_type,status,priority,assigned_to,due_date,created_by,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now()-interval '1 day',now()-interval '1 hour')",
    [id, ids.company, title, type, status, priority, assignee, due, ids.owner]);
  await task(ids.taskIns, "Inspect incoming billets", "inspection", "open", "normal", null, day(2));
  await task(ids.taskQc, "Recheck anodising batch", "quality_check", "open", "high", null, day(1));
  await task(ids.taskAssigned1, "Count rack 4", "general", "open", "normal", ids.production2, day(-1));
  await task(ids.taskAssigned2, "Label bundles", "general", "open", "normal", ids.production2, day(3));
  await task(ids.taskDone, "Closed errand", "general", "completed", "normal", ids.production, day(-3));
  await task(ids.taskPrio, "Sweep press bay", "general", "open", "low", ids.production, day(4));
  await task(ids.taskPrio2, "Update die register", "general", "open", "low", ids.production, day(4));
  await task(ids.taskDue, "Order gloves", "general", "in_progress", "normal", ids.production, day(2));
  await db.query("insert into employee_competencies(company_id,employee_id,competency_id,level,granted_by,granted_by_name) values($1,$2,$3,'independent',$4,'Fixture factory')", [ids.company, ids.production, ids.competency, ids.factory]);
  await db.exec("set session_replication_role = origin");

  const command = async (name, payload, actor = ids.owner) => (await base.asUser("select public.execution_command($1,$2) data", [name, payload], actor))[0].data;
  const prepare = (mutation, actor = ids.owner, request_id = base.nextId()) => command("preview", { mutation, request_id }, actor);
  const commit = (preview, actor = ids.owner) => command("commit", { request_id: preview.request_id, fingerprint: preview.fingerprint }, actor);
  const apply = async (mutation, actor = ids.owner) => commit(await prepare(mutation, actor), actor);
  const progress = async (order, actor = ids.owner) => (await base.asUser("select public.order_progress($1) data", [order], actor))[0].data;
  return { ...base, ids, command, prepare, commit, apply, progress, executionCommand: command };
}
