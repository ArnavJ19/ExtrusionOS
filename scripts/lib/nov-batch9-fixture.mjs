import { createNov8Fixture, nid, nids as nov8Ids, day } from "./nov-batch8-fixture.mjs";

export { nid, day };
export const nids = {
  ...nov8Ids,
  vendor2: nid(700), customerFar: nid(701),
  quoteSent: nid(710), quoteWon: nid(711), quotePart: nid(712), quoteOpen: nid(713), quoteDraft: nid(714), quoteRejected: nid(715), quoteApproved: nid(716), quoteOld: nid(717),
  qiWon: nid(720), qiPart: nid(721), qiDraft: nid(722), qiSent: nid(723),
  orderWon: nid(730), orderPart: nid(731), orderProfit: nid(732), orderBare: nid(733),
  invProfit: nid(740), invDraft: nid(741), inv1: nid(742), inv2: nid(743), inv3: nid(744), invCancelled: nid(745),
  expenseA: nid(750), expenseB: nid(751), credit1: nid(752), creditOld: nid(753), creditRefund: nid(754), expenseCredit: nid(755), expenseOther: nid(756),
  receiptNew: nid(760), receiptLineNew: nid(761), receiptLineOld: nid(762), receiptOld: nid(763), receiptLineForeign: nid(764),
  vpo1: nid(770), vpo2: nid(771), vpo3: nid(772), vpo4: nid(773), vpo5: nid(774), vpo6: nid(775), vpoLine1: nid(776), vpoLine6: nid(777),
  jobRunA: nid(780), jobRunB: nid(781), jobRunPowder: nid(782), jobRunBlocked1: nid(783), jobRunBlocked2: nid(784), dieBlocked: nid(785), profile3: nid(786),
  itemMill: nid(790), itemLong: nid(791), itemOther: nid(792), orderRemnant: nid(793), orderRemnant2: nid(794), itemTwo: nid(795),
  finJob: nid(798), foreignQuote: nid(799)
};

// Builds on the batch 8 fixture (the full chain, which includes the batch 9 migration) and seeds the source
// records the commercial workflows read. Seeding runs with source triggers suspended; every scenario then
// runs with all production triggers and guards enabled.
export async function createNov9Fixture() {
  const base = await createNov8Fixture();
  const { db } = base, ids = nids;
  await db.exec("set session_replication_role = replica");
  await db.query("insert into vendors(id,company_id,vendor_name,vendor_type) values($1,$2,'Fixture second supplier','aluminum_billets')", [ids.vendor2, ids.company]);
  await db.query("insert into customers(id,company_id,customer_name,customer_type) values($1,$2,'Fixture far customer','fabricator')", [ids.customerFar, ids.company]);

  // NOV-066 and NOV-035: quotations in every position, with orders linked where they were won.
  const quote = (id, number, status, valid, total, customer = ids.customer) => db.query(`insert into quotes(id,company_id,quote_number,customer_id,quote_date,valid_until,status,subtotal,total_before_gst,gst_percent,gst_amount,grand_total,revision_number,created_by)
    values($1,$2,$3,$4,current_date-30,$5,$6,$7,$7,18,$7*0.18,$7*1.18,2,$8)`, [id, ids.company, number, customer, valid, status, total, ids.salesManager]);
  await quote(ids.quoteSent, "Q-NOV9-SENT", "sent", `${day(-5)}`, 100000);
  await quote(ids.quoteWon, "Q-NOV9-WON", "customer_approved", `${day(20)}`, 100000);
  await quote(ids.quotePart, "Q-NOV9-PART", "customer_approved", `${day(20)}`, 100000);
  await quote(ids.quoteOpen, "Q-NOV9-OPEN", "sent", `${day(20)}`, 100000);
  await quote(ids.quoteDraft, "Q-NOV9-DRAFT", "draft", `${day(20)}`, 100000);
  await quote(ids.quoteRejected, "Q-NOV9-REJ", "customer_rejected", `${day(20)}`, 100000);
  await quote(ids.quoteApproved, "Q-NOV9-ISSUED", "sent", `${day(20)}`, 100000);
  await quote(ids.quoteOld, "Q-NOV9-OLD", "expired", `${day(-40)}`, 50000);
  const qitem = (id, quoteId, kg) => db.query(`insert into quote_items(id,company_id,quote_id,profile_id,quantity_pieces,length_per_piece_m,total_meters,section_weight_kg_per_m,total_weight_kg,raw_material_cost,conversion_cost,finishing_cost,die_amortization_amount,packing_charge,transport_charge,other_charges,line_total_before_gst,billing_weight_kg)
    values($1,$2,$3,$4,100,6,600,1,$5,60000,10000,8000,2000,1000,1500,500,100000,$5)`, [id, ids.company, quoteId, ids.profile, kg]);
  await qitem(ids.qiWon, ids.quoteWon, 1000); await qitem(ids.qiPart, ids.quotePart, 1000); await qitem(ids.qiDraft, ids.quoteDraft, 1000); await qitem(ids.qiSent, ids.quoteSent, 1000);
  const orderQ = (id, number, quoteId, kg, value) => db.query(`insert into orders(id,company_id,order_number,quote_id,customer_id,order_date,expected_dispatch_date,priority,current_stage,requested_weight_kg,manufacturing_weight_kg,order_value)
    values($1,$2,$3,$4,$5,current_date-10,current_date+10,'normal','order_confirmed',$6,$6,$7)`, [id, ids.company, number, quoteId, ids.customer, kg, value]);
  await orderQ(ids.orderWon, "SO-NOV9-WON", ids.quoteWon, 1000, 100000);
  await orderQ(ids.orderPart, "SO-NOV9-PART", ids.quotePart, 700, 70000);
  await orderQ(ids.orderProfit, "SO-NOV9-PROFIT", ids.quoteApproved, 1000, 100000);
  await db.query(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,requested_weight_kg,manufacturing_weight_kg) values($1,$2,'SO-NOV9-BARE',$3,current_date-3,current_date+7,'normal','order_confirmed',200,200)`,
    [ids.orderBare, ids.company, ids.customer]);
  // The profitability order has an accepted quotation snapshot, an issued invoice, a draft invoice and linked expenses.
  await db.query(`insert into order_quote_snapshots(order_id,company_id,quote_id,revision_number,quote_snapshot,line_snapshots)
    select $1,$2,q.id,q.revision_number,to_jsonb(q),(select jsonb_agg(to_jsonb(i)) from quote_items i where i.quote_id=$4) from quotes q where q.id=$3`, [ids.orderProfit, ids.company, ids.quoteApproved, ids.quoteSent]);
  await db.query(`insert into invoices(id,company_id,customer_id,order_id,invoice_number,invoice_date,subtotal,tax_total,grand_total,status) values
    ($1,$2,$3,$4,'INV-NOV9-P1',current_date-2,90000,16200,106200,'generated'),($5,$2,$3,$4,'INV-NOV9-DRAFT',current_date,5000,900,5900,'draft')`, [ids.invProfit, ids.company, ids.customer, ids.orderProfit, ids.invDraft]);
  await db.query(`insert into invoices(id,company_id,customer_id,order_id,invoice_number,invoice_date,subtotal,tax_total,grand_total,status) values($1,$2,$3,$4,'INV-NOV9-BARE',current_date-1,5000,900,5900,'generated')`, [nid(746), ids.company, ids.customer, ids.orderBare]);
  const expense = (id, number, category, total, source) => db.query(`insert into expense_ledger(id,company_id,expense_number,source_module,expense_category,quantity,rate,base_amount,tax_amount,freight_amount,discount_amount,total_amount,currency,amount_paid,balance_amount,payment_status,approval_status,source_record_id)
    values($1,$2,$3,'finishing',$4,1,$5,$5,0,0,0,$5,'INR',0,$5,'unpaid','approved',$6)`, [id, ids.company, number, category, total, source]);
  await expense(ids.expenseA, "EXP-NOV9-A", "finishing_vendor", 9000, ids.orderProfit);
  await expense(ids.expenseB, "EXP-NOV9-B", "freight", 1500, ids.orderProfit);
  await expense(ids.expenseOther, "EXP-NOV9-O", "freight", 700, ids.orderBare);

  // NOV-078: credits and receipts that came after a claim, and ones that were already there.
  await db.query(`insert into expense_ledger(id,company_id,expense_number,source_module,expense_category,vendor_id,quantity,rate,base_amount,tax_amount,freight_amount,discount_amount,total_amount,currency,amount_paid,balance_amount,payment_status,approval_status)
    values($1,$2,'EXP-NOV9-CR','purchasing','material',$3,1,100000,100000,0,0,0,100000,'INR',0,100000,'unpaid','approved'),($4,$2,'EXP-NOV9-CR2','purchasing','material',$5,1,50000,50000,0,0,0,50000,'INR',0,50000,'unpaid','approved')`,
    [ids.expenseCredit, ids.company, ids.vendor, nid(757), ids.vendor2]);
  const credit = (id, expenseId, type, amount, createdAt, ref) => db.query(`insert into expense_supplier_credits(id,company_id,expense_ledger_id,credit_type,credit_date,amount,reason,status,idempotency_key,request_hash,created_at)
    values($1,$2,$3,$4,current_date,$5,'Shortage credit','posted',gen_random_uuid(),$7,$6)`, [id, ids.company, expenseId, type, amount, createdAt, ref]);
  const future = new Date(Date.now() + 3600000).toISOString(), past = new Date(Date.now() - 7 * 86400000).toISOString();
  await credit(ids.credit1, ids.expenseCredit, "credit_note", 10000, future, "h1");
  await credit(ids.creditRefund, ids.expenseCredit, "refund", 4000, future, "h2");
  await credit(ids.creditOld, ids.expenseCredit, "credit_note", 3000, past, "h3");
  await credit(nid(758), nid(757), "credit_note", 2000, future, "h4");
  await db.query(`insert into purchase_receipts(id,company_id,purchase_order_id,receipt_date,reference,idempotency_key,request_hash,created_by) values($1,$2,$3,current_date,'REPLACEMENT',gen_random_uuid(),'h',$4),($5,$2,$3,current_date-12,'OLD',gen_random_uuid(),'h',$4)`,
    [ids.receiptNew, ids.company, ids.po, ids.owner, ids.receiptOld]);
  await db.query(`insert into purchase_receipt_lines(id,company_id,receipt_id,purchase_order_id,purchase_order_line_id,received_quantity,accepted_quantity,rejected_quantity,held_quantity,created_at) values
    ($1,$2,$3,$4,$5,300,300,0,0,$7),($6,$2,$8,$4,$5,100,100,0,0,$9)`, [ids.receiptLineNew, ids.company, ids.receiptNew, ids.po, ids.poLine, ids.receiptLineOld, future, ids.receiptOld, past]);

  // NOV-039: six purchase orders for the second supplier with promised dates and receipts.
  const vpo = async (id, number, offset, original, receipt) => {
    await db.query("insert into purchase_orders(id,company_id,vendor_id,vendor_name_snapshot,po_number,order_date,status,idempotency_key,request_hash,created_by,updated_by) values($1,$2,$3,'Fixture second supplier',$4,current_date-$5::int,'open',gen_random_uuid(),'h',$6,$6)", [id, ids.company, ids.vendor2, number, offset, ids.owner]);
    await db.query("insert into purchase_order_lines(id,company_id,purchase_order_id,line_number,description,specification,unit,ordered_quantity,unit_rate,gst_percent) values(gen_random_uuid(),$1,$2,1,'Billets 6063','6063 T6 billet','kg',100,200,18)", [ids.company, id]);
    if (original !== null) await db.query("insert into supplier_commitments(company_id,purchase_order_id,original_date,current_date_promised,recorded_by) values($1,$2,current_date-$3::int,current_date-$3::int,$4)", [ids.company, id, original, ids.owner]);
    if (receipt !== null) {
      const receiptId = nid(800 + Number(number.slice(-1)));
      await db.query("insert into purchase_receipts(id,company_id,purchase_order_id,receipt_date,idempotency_key,request_hash,created_by) values($1,$2,$3,current_date-$4::int,gen_random_uuid(),'h',$5)", [receiptId, ids.company, id, receipt, ids.owner]);
      await db.query("insert into purchase_receipt_lines(company_id,receipt_id,purchase_order_id,purchase_order_line_id,received_quantity,accepted_quantity,rejected_quantity,held_quantity) select $1,$2,$3,l.id,100,90,10,0 from purchase_order_lines l where l.purchase_order_id=$3", [ids.company, receiptId, id]);
    }
  };
  await vpo(ids.vpo1, "VPO-NOV9-1", 40, 30, 32); // promised 30 days ago, received 32 days ago: on time
  await vpo(ids.vpo2, "VPO-NOV9-2", 40, 30, 28); // received 28 days ago: two days late
  await vpo(ids.vpo3, "VPO-NOV9-3", 30, 20, 20); // on the promised day: on time
  await vpo(ids.vpo4, "VPO-NOV9-4", 30, 20, 15); // five days late
  await vpo(ids.vpo5, "VPO-NOV9-5", 20, 10, 11); // early
  await vpo(ids.vpo6, "VPO-NOV9-6", 20, 10, null); // past the promised date, nothing received

  // NOV-029: order lines with different cut lengths, and a second profile.
  await db.query("update order_items set cut_length=3000,length_per_piece_m=3,quantity_pieces=40,finishing_type='anodizing' where id=$1", [ids.line1]);
  await db.query("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy,temper,drawing_approval_status) values($1,$2,'AL-NOV9-3','Third section',1.5,'6061','T5','approved')", [ids.profile3, ids.company]);
  await db.query("update production_jobs set finishing_type='anodizing' where id=$1", [ids.jobDieUse]);

  // NOV-023: jobs sharing a die with matching attributes, a mismatched finish and a blocked die pair.
  const job = (id, orderId, line, status, number, planned, kg, die, finish, rev = "R1") => db.query(`insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,job_number,source_line_id,planned_date,shift,die_id,created_by,drawing_revision,cut_length,section_weight_kg_per_m,finishing_type)
    values($1,$2,$3,$4,$5,$6,0,$7,$8,$9,'Day',$10,$11,$12,6000,1.2,$13)`, [id, ids.company, orderId, ids.profile, status, kg, number, line, planned, die, ids.productionManager, rev, finish]);
  await job(ids.jobRunA, ids.order2, ids.line2, "planned", "J-NOV9-A", day(4), 200, ids.dieC, "anodizing");
  await job(ids.jobRunB, ids.orderBare, ids.line1, "ready", "J-NOV9-B", day(5), 150, ids.dieC, "anodizing");
  await job(ids.jobRunPowder, ids.order2, ids.line2, "planned", "J-NOV9-POWDER", day(4), 100, ids.dieC, "powder coating");
  await db.query("insert into dies(id,company_id,die_number,profile_id,die_status,die_type,rack_location) values($1,$2,'DIE-NOV9-BLOCKED',$3,'blocked','solid','Rack D9')", [ids.dieBlocked, ids.company, ids.profile]);
  await job(ids.jobRunBlocked1, ids.order, ids.line1, "planned", "J-NOV9-BL1", day(6), 100, ids.dieBlocked, "anodizing");
  await job(ids.jobRunBlocked2, ids.order2, ids.line2, "planned", "J-NOV9-BL2", day(6), 100, ids.dieBlocked, "anodizing");

  // NOV-024: recorded shift capacity for Press A only. Press B is deliberately unmeasured.
  await db.query("update factory_shift_capacities set capacity_kg=600 where company_id=$1 and machine_id=$2", [ids.company, ids.press1]);
  await db.query("delete from factory_shift_capacities where company_id=$1 and machine_id=$2", [ids.company, ids.press2]);

  // NOV-020: issued invoices waiting for export, a draft and a cancelled one that must never be offered.
  const invoice = (id, number, status, subtotal, daysAgo) => db.query("insert into invoices(id,company_id,customer_id,order_id,invoice_number,invoice_date,subtotal,tax_total,grand_total,status) values($1,$2,$3,$4,$5,current_date-$6::int,$7,$7*0.18,$7*1.18,$8)",
    [id, ids.company, ids.customer, ids.order, number, daysAgo, subtotal, status]);
  await invoice(ids.inv1, "INV-NOV9-1", "generated", 1000, 5); await invoice(ids.inv2, "INV-NOV9-2", "sent", 2000, 4); await invoice(ids.inv3, "INV-NOV9-3", "paid", 3000, 3);
  await invoice(ids.invCancelled, "INV-NOV9-X", "cancelled", 500, 2);
  await db.exec("set session_replication_role = origin");

  const command = async (name, payload, actor = ids.owner) => (await base.asUser("select public.commercial_command($1,$2) data", [name, payload], actor))[0].data;
  const prepare = (mutation, actor = ids.owner, request_id = base.nextId()) => command("preview", { mutation, request_id }, actor);
  const commit = (preview, actor = ids.owner) => command("commit", { request_id: preview.request_id, fingerprint: preview.fingerprint }, actor);
  const apply = async (mutation, actor = ids.owner) => commit(await prepare(mutation, actor), actor);
  return { ...base, ids, command, prepare, commit, apply, commercialCommand: command };
}
