import { addBatch8Helpers, createBatch8Fixture, ids as baseIds, istDay } from "./autopilot-batch8-fixture.mjs";

export { istDay };
export const ids = baseIds;

// Autopilot batch 9 fixture. Builds on the batch 8 fixture (full migration chain, synthetic Omalco company, one user per
// role, customers with GSTINs and open invoices, approved billet 245/kg and conversion 38/kg, presses and planned jobs)
// and adds helpers for finishing rates and floors, an issued invoice with a dispatch, in-house scrap, released stock,
// prepared bundles and payables. Synthetic data only.
export async function createBatch9Fixture() {
  const f = await createBatch8Fixture();
  // The company's GSTIN state (Delhi) for place-of-supply on scrap invoices.
  await f.db.exec("set session_replication_role = replica");
  await f.db.query("update companies set gst_state_code='07', gst_number='07AAACO1234A1Z5' where id=$1", [baseIds.company]);
  await f.db.exec("set session_replication_role = origin");
  return addBatch9Helpers(f);
}

export function addBatch9Helpers(f) {
  const i = baseIds;
  /** An approved costing rate effective from yesterday. */
  async function rate({ type, basis = "per_kg", rate, customer = null, alloy = null, finishing = null }) {
    const id = f.next();
    await f.seed(`insert into costing_rates(id,company_id,rate_type,basis,customer_id,alloy,finishing_type,rate,effective_from,status,created_by,created_by_name,approved_by,approved_by_name,approved_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,current_date-1,'approved',$9,'Fixture owner',$9,'Fixture owner',now())`, [id, i.company, type, basis, customer, alloy, finishing, rate, i.owner]);
    return id;
  }
  async function floor({ alloy = null, finishing = null, perKg }) {
    await f.seed("insert into price_floors(company_id,alloy,finishing_type,floor_per_kg,reason,set_by) values($1,$2,$3,$4,'Fixture floor',$5)", [i.company, alloy, finishing, perKg, i.owner]);
  }
  /** An issued invoice for a gated-out dispatch with one goods line of `kg` at `rate` per kg, GST 18%. */
  async function invoice({ customer = i.customer2, kg = 570, rate = 300, status = "sent" } = {}) {
    const o = await f.order({ customer, kg });
    const dispatch = f.next(), invoiceId = f.next();
    await f.seed("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,total_weight_kg,number_of_bundles) values($1,$2,$3,$4,current_date,'dispatched',$5,1)",
      [dispatch, i.company, o.order, `DC-9-${dispatch.slice(-4)}`, kg]);
    const value = Math.round(kg * rate * 100) / 100, tax = Math.round(value * 18) / 100;
    await f.seed(`insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,invoice_date,due_date,status,subtotal,tax_total,grand_total,amount_paid,issued_at)
      values($1,$2,$3,$4,$5,$6,current_date-3,current_date+27,$7,$8,$9,$10,0,now())`, [invoiceId, i.company, customer, o.order, dispatch, `OMX/26-27/9${invoiceId.slice(-3)}`, status, value, tax, value + tax]);
    await f.seed(`insert into invoice_items(company_id,invoice_id,profile_id,item_description,quantity,quantity_kg,invoice_calc_uom,unit_rate,line_total,gst_percent,line_kind)
      values($1,$2,$3,'Sliding track',$4,$4,'kg',$5,$6,18,'goods')`, [i.company, invoiceId, i.profile2, kg, rate, value]);
    return { ...o, dispatch, invoice: invoiceId, value, tax };
  }
  /** In-house scrap: a process-scrap record classified as `category` and sent to the foundry pool, or another scrap type kept in the yard. */
  async function scrap({ kg, type = "process_scrap", category = "butt_end", daysAgo = 2 } = {}) {
    const record = f.next();
    const scrapJob = type === "process_scrap" ? (await f.job({ status: "completed", plannedIn: -3 })).job : null;
    await f.seed("insert into scrap_records(id,company_id,scrap_type,weight_kg,recorded_date,scrap_category,recoverable,alloy,production_job_id) values($1,$2,$3,$4,current_date-$5::int,$6,$7,'6063',$8)",
      [record, i.company, type, kg, daysAgo, type === "process_scrap" ? category : "unclassified", type === "process_scrap", type === "process_scrap" ? scrapJob : null]);
    let lot = null;
    if (type === "process_scrap") {
      lot = f.next();
      await f.seed(`insert into foundry_aluminium_scrap(id,company_id,scrap_number,scrap_source,weight_kg,available_weight_kg,scrap_quality,status,received_date,alloy,scrap_category,source_scrap_record_id)
        values($1,$2,$3,'in_house',$4,$4,'clean','available',current_date-$5::int,'6063',$6,$7)`, [lot, i.company, `SCR-9-${lot.slice(-4)}`, kg, daysAgo, category, record]);
      await f.seed("insert into production_scrap_lines(company_id,scrap_record_id,production_job_id,category,weight_kg,recoverable,alloy,foundry_scrap_id) values($1,$2,$3,$4,$5,true,'6063',$6)", [i.company, record, scrapJob, category, kg, lot]);
    }
    return { record, lot };
  }
  /** Released finished stock of the profile: pieces of `length` m. */
  async function stock({ pieces = 50, length = 6, kgm = 0.95, finish = "mill_finish", qc = "released", profile = i.profile2, alloy = "6063", temper = "T5" } = {}) {
    const id = f.next();
    await f.seed(`insert into profile_stock_batches(id,company_id,profile_id,finish,length_m,quantity_pieces,total_weight_kg,bundle_number,status,origin_type,alloy,temper,qc_status,piece_length_m)
      values($1,$2,$3,$4,$5,$6,$7,$8,'available','opening_balance',$9,$10,$11,$12)`, [id, i.company, profile, finish, pieces * length, pieces, Math.round(pieces * length * kgm * 1000) / 1000,
      `STK-${id.slice(-4)}`, alloy, temper, qc, length]);
    return id;
  }
  /** A prepared physical bundle (production source) of `length` m with gross and tare kg. */
  async function preparedBundle({ gross = 120, tare = 6, length = 120, pieces = 20 } = {}) {
    const o = await f.order({});
    const id = f.next();
    await f.seed(`insert into prepared_physical_bundles(id,company_id,order_id,source_line_id,source_kind,profile_id,bundle_number,number_of_pieces,net_length_m,gross_weight_kg,tare_weight_kg,recorded_by,payload)
      values($1,$2,$3,$4,'production',$5,$6,$7,$8,$9,$10,$11,'{}')`, [id, i.company, o.order, o.line, i.profile2, `B-9-${id.slice(-4)}`, pieces, length, gross, tare, i.dispatchUser]);
    return id;
  }
  /** An approved unpaid expense bill due in `due` days. */
  async function bill({ amount = 5000, due = 10, vendor = i.vendor } = {}) {
    const id = f.next();
    await f.seed(`insert into expense_ledger(id,company_id,expense_number,expense_category,vendor_id,vendor_name_snapshot,total_amount,base_amount,balance_amount,amount_paid,payment_status,approval_status,invoice_date,due_date,invoice_number)
      values($1,$2,$3,'raw_material',$4,'Fixture supplier',$5,$5,$5,0,'unpaid','approved',current_date,current_date+$6::int,$7)`, [id, i.company, `EXP-9-${id.slice(-4)}`, vendor, amount, due, `BILL-${id.slice(-4)}`]);
    return id;
  }
  const decide = (id, decision = "accept", actor = i.owner, extra = {}) => f.call("ap_proposals", "decide", { id, decision, ...extra }, actor);
  const openProposals = type => f.db.query("select * from proposals where company_id=$1 and proposal_type=$2 and status='open' order by created_at, target_key", [i.company, type]).then(r => r.rows);
  return { ...f, rate, floor, invoice, scrap, stock, preparedBundle, bill, decide, openProposals };
}

export { addBatch8Helpers };
