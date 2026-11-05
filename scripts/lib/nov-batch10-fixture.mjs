import { createNov9Fixture, nid, nids as nov9Ids, day } from "./nov-batch9-fixture.mjs";

export { nid, day };
export const nids = {
  ...nov9Ids,
  alias: nid(900), qiQuote: nid(901), orderIntake: nid(902), itemIntake: nid(903), itemIntake2: nid(904),
  lab: nid(910), billet: nid(911), oven: nid(912), ovenDown: nid(913), jobAlloy: nid(914), lineMix: nid(915), fin1: nid(916), fin2: nid(917),
  invTool: nid(920), payTool: nid(921), cnTool: nid(922), invRec: nid(923), invOther: nid(924),
  locFactory: nid(930), locWarehouse: nid(931), stockHold: nid(932), stockReserved: nid(933),
  orderToll: nid(940), orderTollMix: nid(941), jobToll: nid(942), jobTollMix: nid(943), lineToll: nid(944), lineTollMix: nid(945)
};

// Builds on the batch 9 fixture (the full chain, which includes the batch 10 migration) and seeds the source
// records the specialist workflows read. Seeding runs with source triggers suspended; every scenario then
// runs with all production triggers and guards enabled.
export async function createNov10Fixture() {
  const base = await createNov9Fixture();
  const { db } = base, ids = nids;
  await db.exec("set session_replication_role = replica");
  // NOV-061: a customer alias, an accepted quotation with a price, and the order later entered from the PO.
  await db.query("insert into customer_profile_aliases(id,company_id,customer_id,profile_id,alias,created_by) values($1,$2,$3,$4,'TRK-6',$5)", [ids.alias, ids.company, ids.customer, ids.profile, ids.owner]);
  await db.query("update quote_items set price_per_kg=250,finishing_type='anodizing' where id=$1", [ids.qiWon]);
  await db.query("insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,requested_weight_kg,manufacturing_weight_kg) values($1,$2,'SO-NOV10-INTAKE',$3,current_date,current_date+20,'normal','order_confirmed',1000,1000)",
    [ids.orderIntake, ids.company, ids.customer]);
  await db.query(`insert into order_items(id,company_id,order_id,profile_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,manufacturing_weight_kg,cut_length,section_weight_kg_per_m,finishing_type)
    values($1,$2,$3,$4,'Track from PO',100,6,1000,1000,6000,1.2,'anodizing')`, [ids.itemIntake, ids.company, ids.orderIntake, ids.profile]);

  // NOV-080: overdue invoices, a pending dispatch past its date and a quotation about to expire.
  await db.query("update invoices set due_date=current_date-10 where id=$1", [ids.inv1]);
  await db.query("update invoices set due_date=current_date-3 where id=$1", [ids.inv2]);
  await db.query("update invoices set due_date=current_date-30 where id=$1", [ids.inv3]);
  await db.query("update dispatches set dispatch_date=current_date-5 where id=$1", [ids.dispatchPending]);
  await db.query("update quotes set valid_until=current_date+3 where id=$1", [ids.quoteOpen]);

  // NOV-071: a billet batch, recorded output on the in-progress job.
  await db.query("insert into billet_batches(id,company_id,batch_number,alloy,temper,total_weight_kg,available_weight_kg,received_date,heat_number) values($1,$2,'BB-NOV10','6063','F',2000,2000,current_date-5,'H-77')", [ids.billet, ids.company]);
  await db.query("update production_jobs set actual_quantity_kg=400 where id=$1", [ids.job2]);
  await db.query("update production_jobs set status='completed',actual_quantity_kg=300 where id=$1", [ids.job3]);

  // NOV-072: an ageing oven in service, one under maintenance, and a job of a different alloy.
  await db.query("insert into machines(id,company_id,machine_name,machine_type,status,is_active,machine_code) values($1,$2,'Ageing oven 1','aging_oven','active',true,'OVEN-1'),($3,$2,'Ageing oven 2','aging_oven','maintenance',true,'OVEN-2')",
    [ids.oven, ids.company, ids.ovenDown]);
  await db.query(`insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,job_number,planned_date) values($1,$2,$3,$4,'completed',200,200,'J-NOV10-6061',current_date)`,
    [ids.jobAlloy, ids.company, ids.order, ids.profile3]);

  // NOV-073: a second line on the main order with the same profile, and two finishing jobs for that order.
  await db.query(`insert into order_items(id,company_id,order_id,profile_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,manufacturing_weight_kg,cut_length,section_weight_kg_per_m,finishing_type)
    values($1,$2,$3,$4,'Track second shade',20,6,144,144,6000,1.2,'anodizing')`, [ids.lineMix, ids.company, ids.order, ids.profile]);
  await db.query("insert into finishing_jobs(id,company_id,order_id,finishing_type,status,vendor_id,sent_date,input_weight_kg,shade_name) values($1,$2,$3,'anodizing','received',$4,current_date-4,300,'Silver'),($5,$2,$3,'anodizing','received',$4,current_date-3,200,'Silver')",
    [ids.fin1, ids.company, ids.order, ids.vendor, ids.fin2]);

  // NOV-065: a die charge invoice, its payment and credit note, and a dispatch-linked invoice for recovery.
  const invoice = (id, number, orderId, dispatchId, subtotal) => db.query("insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,invoice_date,subtotal,tax_total,grand_total,status) values($1,$2,$3,$4,$5,$6,current_date-2,$7,$7*0.18,$7*1.18,'generated')",
    [id, ids.company, ids.customer, orderId, dispatchId, number, subtotal]);
  await invoice(ids.invTool, "INV-NOV10-DIE", ids.order, null, 50000);
  await invoice(ids.invRec, "INV-NOV10-REC", ids.order, ids.dispatch1, 120000);
  await db.query("insert into invoices(id,company_id,customer_id,order_id,invoice_number,invoice_date,subtotal,tax_total,grand_total,status) values($1,$2,$3,$4,'INV-NOV10-OTHER',current_date,1000,180,1180,'generated')", [ids.invOther, ids.company, ids.customer2, ids.orderNoPhone]);
  await db.query("insert into payments(id,company_id,invoice_id,payment_date,amount,payment_method,reference_number,payment_status) values($1,$2,$3,current_date,20000,'bank_transfer','UTR-NOV10','CONFIRMED')", [ids.payTool, ids.company, ids.invTool]);
  await db.query("insert into credit_notes(id,company_id,invoice_id,dispatch_id,credit_note_number,reason,subtotal,tax_total,grand_total,status,idempotency_key) values($1,$2,$3,$4,'CN-NOV10',$5,5000,900,5900,'issued',gen_random_uuid())",
    [ids.cnTool, ids.company, ids.invTool, ids.dispatch1, "Die charge correction"]);

  // NOV-067: two locations; stock on QC hold and stock already reserved for an order.
  await db.query("insert into inventory_locations(id,company_id,location_code,location_name,location_type) values($1,$2,'FAC','Rack 4','factory'),($3,$2,'BHW','Bhiwandi warehouse','warehouse')", [ids.locFactory, ids.company, ids.locWarehouse]);
  await db.query(`insert into profile_stock_batches(id,company_id,profile_id,finish,length_m,quantity_pieces,total_weight_kg,bundle_number,location,status,origin_type,qc_status,piece_length_m)
    values($1,$2,$3,'mill_finish',60,10,72,'S-HOLD','Rack 4','available','opening_balance','on_hold',6),($4,$2,$3,'mill_finish',60,10,72,'S-RES','Rack 4','available','opening_balance','released',6)`, [ids.stockHold, ids.company, ids.profile, ids.stockReserved]);
  await db.query("update profile_stock_batches set reserved_for_order_id=$2 where id=$1", [ids.stockReserved, ids.order]);

  // NOV-032: a customer with its own orders and jobs; one order already has company billets allocated.
  for (const [id, number, allocated] of [[ids.orderToll, "SO-NOV10-TOLL", 0], [ids.orderTollMix, "SO-NOV10-MIX", 2]]) {
    await db.query("insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,requested_weight_kg,manufacturing_weight_kg,billets_allocated) values($1,$2,$3,$4,current_date,current_date+15,'normal','order_confirmed',800,800,$5)",
      [id, ids.company, number, ids.customer3, allocated]);
  }
  await db.query(`insert into order_items(id,company_id,order_id,profile_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,manufacturing_weight_kg,cut_length,section_weight_kg_per_m,finishing_type)
    values($1,$2,$3,$4,'Job-work track',100,6,800,800,6000,1.2,'anodizing')`, [ids.lineToll, ids.company, ids.orderToll, ids.profile]);
  for (const [id, orderId, number] of [[ids.jobToll, ids.orderToll, "J-NOV10-TOLL"], [ids.jobTollMix, ids.orderTollMix, "J-NOV10-MIX"]]) {
    await db.query("insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,job_number,planned_date) values($1,$2,$3,$4,'planned',800,0,$5,current_date)", [id, ids.company, orderId, ids.profile, number]);
  }
  await db.exec("set session_replication_role = origin");

  const command = async (name, payload, actor = ids.owner) => (await base.asUser("select public.specialist_command($1,$2) data", [name, payload], actor))[0].data;
  const prepare = (mutation, actor = ids.owner, request_id = base.nextId()) => command("preview", { mutation, request_id }, actor);
  const commit = (preview, actor = ids.owner) => command("commit", { request_id: preview.request_id, fingerprint: preview.fingerprint }, actor);
  const apply = async (mutation, actor = ids.owner) => commit(await prepare(mutation, actor), actor);
  return { ...base, ids, command, prepare, commit, apply, specialistCommand: command };
}
