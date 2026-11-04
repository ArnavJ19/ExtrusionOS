import { createNov5Fixture, nid, nids as nov5Ids } from "./nov-batch5-fixture.mjs";

export { nid };
export const nids = {
  ...nov5Ids,
  orderC: nid(300), lineC: nid(301), jobC: nid(302), dispatchC: nid(303), packC: nid(304), invoiceC: nid(305),
  orderP: nid(310), lineP: nid(311), jobP: nid(312),
  dieA: nid(320), dieB: nid(321), project: nid(330),
  packed1: nid(340), packed2: nid(341), packedShipped: nid(342),
  billetBatch: nid(350), billet: nid(351), stockJob: nid(352)
};

// Builds on the batch 5 fixture (the full chain, which includes the batch 6 migration) and seeds the
// extra source records the lifecycle workflows read. Seeding runs with source triggers suspended; every
// scenario then runs with all production triggers and guards enabled.
export async function createNov6Fixture() {
  const base = await createNov5Fixture();
  const { db } = base, ids = nids;
  await db.exec("set session_replication_role = replica");
  // NOV-058: a delivered, invoiced order that is ready for operational closure.
  await db.query(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,requested_weight_kg,manufacturing_weight_kg)
    values($1,$2,'SO-NOV6-C',$3,current_date-20,current_date-2,'normal','delivered',500,500)`, [ids.orderC, ids.company, ids.customer]);
  await db.query(`insert into order_items(id,company_id,order_id,profile_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,manufacturing_weight_kg,drawing_revision,cut_length,section_weight_kg_per_m,finishing_type)
    values($1,$2,$3,$4,'Track 6 m',70,6,500,500,'R1',6000,1.2,'mill_finish')`, [ids.lineC, ids.company, ids.orderC, ids.profile]);
  await db.query(`insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,job_number,source_line_id,finishing_type,planned_date)
    values($1,$2,$3,$4,'completed',500,500,'J-NOV6-C',$5,'mill_finish',current_date-10)`, [ids.jobC, ids.company, ids.orderC, ids.profile, ids.lineC]);
  await db.query(`insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,number_of_bundles,total_weight_kg,delivery_status,actual_dispatched_at,delivered_at,last_status_changed_at)
    values($1,$2,$3,'D-NOV6-C',current_date-3,1,500,'delivered',now()-interval '3 days',now()-interval '2 days',now())`, [ids.dispatchC, ids.company, ids.orderC]);
  await db.query(`insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,order_item_id,net_length_m)
    values($1,$2,$3,$4,'C1',70,502,2,$5,420)`, [ids.packC, ids.company, ids.dispatchC, ids.profile, ids.lineC]);
  await db.query(`insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,invoice_date,status,grand_total,amount_paid,credited_amount,issued_at)
    values($1,$2,$3,$4,$5,'INV-NOV6-C',current_date-2,'sent',59000,0,0,now()-interval '2 days')`, [ids.invoiceC, ids.company, ids.customer, ids.orderC, ids.dispatchC]);
  // NOV-021: an order still to be produced on the compatible press only.
  await db.query(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,requested_weight_kg,manufacturing_weight_kg)
    values($1,$2,'SO-NOV6-P',$3,current_date,current_date+30,'normal','extrusion_planned',2000,2000)`, [ids.orderP, ids.company, ids.customer]);
  await db.query(`insert into order_items(id,company_id,order_id,profile_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,manufacturing_weight_kg,drawing_revision,cut_length,section_weight_kg_per_m,finishing_type)
    values($1,$2,$3,$4,'Frame 3 m',666,3,2000,2000,'R1',3000,1.0,'mill_finish')`, [ids.lineP, ids.company, ids.orderP, ids.profile2]);
  await db.query(`insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,job_number,source_line_id,finishing_type,planned_date)
    values($1,$2,$3,$4,'planned',2000,0,'J-NOV6-P',$5,'mill_finish',current_date)`, [ids.jobP, ids.company, ids.orderP, ids.profile2, ids.lineP]);
  // NOV-063: the sampled die and a changed die for AL-NOV5B.
  await db.query("insert into dies(id,company_id,die_number,profile_id,die_status) values($1,$2,'DIE-NOV6-A',$3,'active'),($4,$2,'DIE-NOV6-B',$3,'active')", [ids.dieA, ids.company, ids.profile2, ids.dieB]);
  // NOV-079: a project linked to SO-NOV5-01 for template precedence and the label destination.
  await db.query(`insert into customer_projects(id,company_id,customer_id,project_code,name,site_name,created_by,updated_by) values($1,$2,$3,'PRJ-NOV6','Riverside towers','Riverside site',$4,$4)`,
    [ids.project, ids.company, ids.customer, ids.owner]);
  await db.query("insert into customer_project_links(company_id,project_id,entity_type,entity_id,linked_by,linked_by_name) values($1,$2,'order',$3,$4,'Fixture owner')", [ids.company, ids.project, ids.order, ids.owner]);
  // Packed bundles for SO-NOV5-01 from job 2: two awaiting labels and one already loaded as dispatch bundle B1.
  for (const [id, bundle, pieces, gross, dispatch] of [[ids.packed1, "PB-1", 10, 62, null], [ids.packed2, "PB-2", 30, 182, null], [ids.packedShipped, "B1", 10, 302, ids.dispatch1]]) {
    await db.query(`insert into prepared_physical_bundles(id,company_id,order_id,source_line_id,source_kind,profile_id,bundle_number,number_of_pieces,net_length_m,gross_weight_kg,tare_weight_kg,recorded_by,payload,dispatch_id)
      values($1,$2,$3,$4,'production',$5,$6,$7,$7*6,$8,2,$9,'{}',$10)`, [id, ids.company, ids.order, ids.job2, ids.profile, bundle, pieces, gross, ids.owner, dispatch]);
  }
  // NOV-027: purchased billets issued to job 2, and production stock from job 2.
  await db.query(`insert into outsourced_billet_batches(id,company_id,batch_number,alloy,temper,billet_count,billet_diameter_inch,billet_diameter_mm,billet_length_mm,weight_kg,status)
    values($1,$2,'OBB-NOV6','6063','F',1,7,178,600,40,'received')`, [ids.billetBatch, ids.company]);
  await db.query(`insert into foundry_billets(id,company_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,alloy,temper,weight_kg,source_type,outsourced_batch_id,production_job_id,status)
    values($1,$2,'BLT-NOV6-1',1,7,178,600,'6063','F',40,'outsourced',$3,$4,'issued')`, [ids.billet, ids.company, ids.billetBatch, ids.job2]);
  await db.query(`insert into profile_stock_batches(id,company_id,profile_id,finish,length_m,quantity_pieces,total_weight_kg,bundle_number,location,status,origin_type,production_job_id,qc_status,piece_length_m)
    values($1,$2,$3,'mill_finish',72,12,86.4,'SJ-1','Rack 4','available','production_surplus',$4,'released',6)`, [ids.stockJob, ids.company, ids.profile, ids.job2]);
  await db.exec("set session_replication_role = origin");

  const command = async (name, payload, actor = ids.owner) => (await base.asUser("select public.lifecycle_command($1,$2) data", [name, payload], actor))[0].data;
  const prepare = (mutation, actor = ids.owner, request_id = base.nextId()) => command("preview", { mutation, request_id }, actor);
  const commit = (preview, actor = ids.owner) => command("commit", { request_id: preview.request_id, fingerprint: preview.fingerprint }, actor);
  const apply = async (mutation, actor = ids.owner) => commit(await prepare(mutation, actor), actor);
  const defaults = async (name, payload, actor = ids.owner) => (await base.asUser("select public.form_defaults_command($1,$2) data", [name, payload], actor))[0].data;
  return { ...base, ids, command, prepare, commit, apply, defaults };
}
