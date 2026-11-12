import { createDispatchFixture, dIds, istDay } from "./autopilot-batch4-fixture.mjs";
export { dIds as ids, istDay };

export async function createOperationsFixture() {
  const f = await createDispatchFixture();
  return addOperationsHelpers(f);
}
export function addOperationsHelpers(f) {
  const i = dIds;
  async function item(stock = 100) {
    const id = f.next();
    await f.asOwnerFor("insert into inventory_items(id,company_id,item_code,item_name,item_category,unit,current_stock,average_rate) values($1,$2,$3,'Traceable consumable','hardware','kg',$4,10)", [id, i.company, `ST-${id.slice(-4)}`, stock], i.owner);
    return id;
  }
  async function plannedJob({ kg = 800, recovery = 80, days = 3, firm = true } = {}) {
    const o = await f.order({ kg, pieces: 100 });
    await f.seed("update aluminium_profiles set billet_diameter_required_inch=7 where id=$1", [i.profile2]);
    await f.seed("insert into order_billet_requirements(company_id,order_id,profile_id,alloy,billet_diameter_inch,billet_weight_kg,extrusion_efficiency_percent,required_weight_kg,billets_required,billets_short) values($1,$2,$3,'6063',7,100,80,$4,10,10)", [i.company, o.order, i.profile2, kg]);
    if (!firm) { await f.seed("update production_job_draft_lines set due_date=current_date+$2::int where order_id=$1 and status='open'", [o.order, days]); return { ...o, job: null }; }
    await f.seed("update production_job_draft_lines set status='removed' where order_id=$1 and status='open'", [o.order]);
    const job = f.next();
    await f.seed("insert into production_jobs(id,company_id,order_id,profile_id,source_line_id,status,planned_date,planned_quantity_kg,extrusion_efficiency_percent,job_number) values($1,$2,$3,$4,$5,'planned',current_date+$6::int,$7,$8,$9)",
      [job, i.company, o.order, i.profile2, o.line, days, kg, recovery, `JOB-F-${job.slice(-4)}`]);
    return { ...o, job };
  }
  async function supplierBill({ accepted = null, age = 30, amount = 1000 } = {}) {
    const bill = f.next(), expense = f.next();
    await f.seed("insert into expense_ledger(id,company_id,expense_number,source_module,expense_category,description,vendor_id,invoice_date,total_amount,base_amount,amount_paid,balance_amount,payment_status,approval_status) values($1,$2,$3,'vendors','raw_material','Fixture supplier bill',$4,current_date-$5::int,$6,$6,0,$6,'unpaid','approved')", [expense, i.company, `EXP-${expense.slice(-4)}`, i.vendor, age, amount]);
    await f.seed("insert into supplier_purchase_bills(id,company_id,purchase_order_id,vendor_id,vendor_name_snapshot,source_document_id,source_hash,review_revision,review_hash,invoice_number,normalized_invoice_number,invoice_date,tax_amount,freight_amount,discount_amount,total_amount,status,expense_ledger_id,created_by,updated_by) values($1,$2,$3,$4,'Shree Nitriding Works',$5,$6,1,'fixture-review','MSME-001','msme-001',current_date-$7::int,0,0,0,$8,'posted',$9,$10,$10)", [bill, i.company, f.next(), i.vendor, f.next(), 'a'.repeat(64), age, amount, expense, i.owner]);
    if (accepted) await f.call("ap_accounts", "bill_acceptance", { bill_id: bill, accepted_on: accepted, reason: "Signed acceptance record verified" }, i.accounts);
    return { bill, expense };
  }
  async function incomingPo({ kg = 600, days = 4, status = "open" } = {}) {
    const po = f.next(), line = f.next();
    await f.seed("insert into purchase_orders(id,company_id,vendor_id,vendor_name_snapshot,po_number,order_date,status,idempotency_key,request_hash,created_by,updated_by) values($1,$2,$3,'Fixture supplier',$4,current_date,$5,$6,'fixture',$7,$7)", [po, i.company, i.vendor, `PO-F-${po.slice(-4)}`, status, f.next(), i.owner]);
    await f.seed("insert into purchase_order_lines(id,company_id,purchase_order_id,line_number,description,specification,unit,ordered_quantity,unit_rate,gst_percent) values($1,$2,$3,1,'6063 billet','7 inch billet','kg',$4,245,18)", [line,i.company,po,kg]);
    await f.seed("insert into procurement_supply_links(purchase_order_line_id,company_id,alloy,diameter_inch,linked_by) values($1,$2,'6063',7,$3)", [line,i.company,i.owner]);
    if (days !== null) await f.seed("insert into supplier_commitments(company_id,purchase_order_id,original_date,current_date_promised,recorded_by) values($1,$2,current_date+$3::int,current_date+$3::int,$4)", [i.company,po,days,i.owner]);
    return { po, line };
  }
  return { ...f, item, plannedJob, supplierBill, incomingPo };
}
