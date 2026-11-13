import { createOperationsFixture, ids as baseIds, istDay } from "./autopilot-batch5-operations-fixture.mjs";
import { createPressFixture, pIds } from "./autopilot-batch2-fixture.mjs";

export { istDay };
export const ids = baseIds;
export { pIds };

// Autopilot batch 6 fixture. Builds on the batch 5 operations fixture (full migration chain, synthetic Omalco company,
// one user per role, customers, invoices, approved billet rate 245/kg) and adds helpers for weighed die bundles,
// draft and sent quotations, consumables with consumption history, rejected jobs and receipts, and TDS receipts.
export async function createBatch6Fixture() {
  const f = await createOperationsFixture();
  return addBatch6Helpers(f);
}

export function addBatch6Helpers(f) {
  const i = baseIds;
  /** A completed production job on the die with weighed bundles of the given kg/m (net length 60 m each). */
  async function dieJob({ die = i.die, kgms = [], status = "completed", rejected = null, actual = 600 } = {}) {
    const o = await f.order({ kg: 600, pieces: 100 });
    const job = f.next();
    await f.seed(`insert into production_jobs(id,company_id,order_id,profile_id,die_id,source_line_id,status,planned_quantity_kg,actual_quantity_kg,rejected_weight,job_number,length_per_piece_m,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,600,$8,$9,$10,6,now())`, [job, i.company, o.order, i.profile2, die, o.line, status, actual, rejected, `JOB-W-${job.slice(-4)}`]);
    for (const [n, kgm] of kgms.entries()) await bundle({ order: o.order, job, kgm, minutesAgo: (kgms.length - n) * 10 });
    return { ...o, job };
  }
  async function bundle({ order, job, kgm, minutesAgo = 0, length = 60, tare = 6 }) {
    const id = f.next();
    await f.seed(`insert into prepared_physical_bundles(id,company_id,order_id,source_line_id,source_kind,profile_id,bundle_number,number_of_pieces,net_length_m,gross_weight_kg,tare_weight_kg,recorded_by,recorded_at,payload)
      values($1,$2,$3,$4,'production',$5,$6,10,$7,$8,$9,$10,now()-make_interval(mins=>$11::int),'{}')`,
      [id, i.company, order, job, i.profile2, `BW-${id.slice(-5)}`, length, Math.round((kgm * length + tare) * 1000) / 1000, tare, i.dispatchUser, minutesAgo]);
    return id;
  }
  /** A draft quotation with one line priced at the given billet rate; the canonical triggers price it. */
  async function draftQuote({ rate = 230, status = "draft", customer = i.customer2 } = {}) {
    const q = f.next(), item = f.next();
    await f.seed(`insert into quotes(id,company_id,quote_number,customer_id,quote_date,valid_until,status,gst_percent,revision_number,created_by)
      values($1,$2,$3,$4,current_date,current_date+15,$5,18,1,$6)`, [q, i.company, `Q-R-${q.slice(-4)}`, customer, status, i.sales]);
    await f.seed(`insert into quote_items(id,company_id,quote_id,profile_id,quantity_pieces,length_per_piece_m,section_weight_kg_per_m,billet_rate_per_kg,conversion_charge_per_kg,
        finishing_type,finishing_charge_type,finishing_charge,die_charge,packing_charge,transport_charge,other_charges,margin_percent,expected_recovery_percent,scrap_allowance_percent,gst_percent,revision_number)
      values($1,$2,$3,$4,100,6,0.95,$5,38,'mill_finish','per_kg',0,0,0,0,0,10,100,0,18,1)`, [item, i.company, q, i.profile2, rate]);
    await f.asOwnerFor("update quote_items set billet_rate_per_kg=billet_rate_per_kg where id=$1", [item], i.owner);
    return { quote: q, item };
  }
  /** A sent quotation whose bound billet rate differs from today's approved rate. */
  async function sentQuote({ boundRate = 230 } = {}) {
    const { quote } = await draftQuote({ rate: boundRate, status: "draft" });
    await f.seed("update quotes set status='sent', sent_at=now() where id=$1", [quote]);
    await f.seed(`insert into quote_rate_bindings(company_id,quote_id,revision_number,rate_type,basis,finishing_type,rate_id,rate,customer_specific,effective_from)
      values($1,$2,1,'billet','per_kg',null,$3,$4,false,current_date-10)`, [i.company, quote, i.rateBillet, boundRate]);
    return quote;
  }
  /** A stores item 100 days old with production issues (kg) on the given days ago. */
  async function consumable({ stock = 100, issues = [[10, 30], [40, 30], [70, 30]], ageDays = 100 } = {}) {
    const id = await f.item(stock);
    await f.seed("update inventory_items set created_at=now()-make_interval(days=>$2::int) where id=$1", [id, ageDays]);
    for (const [daysAgo, qty] of issues) {
      await f.seed("insert into inventory_movements(company_id,inventory_item_id,movement_type,quantity,unit,movement_date,created_by) values($1,$2,'production_issue',$3,'kg',current_date-$4::int,$5)",
        [i.company, id, qty, daysAgo, i.inventory]);
    }
    return id;
  }
  /** A goods receipt line with the given rejection. */
  async function rejectedReceipt({ received = 100, rejected = 20 } = {}) {
    const { po, line } = await f.incomingPo({ kg: received });
    const receipt = f.next(), rline = f.next();
    await f.seed("insert into purchase_receipts(id,company_id,purchase_order_id,receipt_date,reference,idempotency_key,request_hash,created_by) values($1,$2,$3,current_date,'GRN-F',$4,'fixture',$5)",
      [receipt, i.company, po, f.next(), i.inventory]);
    await f.seed("insert into purchase_receipt_lines(id,company_id,receipt_id,purchase_order_id,purchase_order_line_id,received_quantity,accepted_quantity,rejected_quantity,held_quantity) values($1,$2,$3,$4,$5,$6,$7,$8,0)",
      [rline, i.company, receipt, po, line, received, received - rejected, rejected]);
    return rline;
  }
  /** Posts a cash receipt through the canonical writer, as accounts. */
  async function receipt(invoice, amount, actor = i.accounts) {
    return (await f.asUser("select public.post_financial_receipt_atomic($1,$2,$3) data", [{ amount, payment_date: istDay(0), payment_method: "cash" }, [{ invoice_id: invoice, amount }], f.next()], actor))[0].data;
  }
  const ap = (rpc, command, payload = {}, actor = i.owner) => f.call(rpc, command, payload, actor);
  return { ...f, dieJob, bundle, draftQuote, sentQuote, consumable, rejectedReceipt, receipt, ap };
}

/** Press-floor fixture for AP-029, AP-061 and AP-094: two presses, jobs with dies, shift capacity for the next working day. */
export async function createFloorFixture() {
  const f = await createPressFixture();
  const i = pIds;
  let seq = 7000;
  const next = () => `bd000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
  const seed = async (sql, params = []) => {
    await f.db.exec("savepoint ap6_seed; set session_replication_role = replica");
    try { const r = await f.db.query(sql, params); await f.db.exec("set session_replication_role = origin; release savepoint ap6_seed"); return r.rows; }
    catch (error) { await f.db.exec("rollback to savepoint ap6_seed; set session_replication_role = origin; release savepoint ap6_seed"); throw error; }
  };
  const raw = async (sql, params = []) => {
    await f.db.exec("savepoint ap6_raw");
    try { const r = await f.db.query(sql, params); await f.db.exec("release savepoint ap6_raw"); return r; }
    catch (error) { await f.db.exec("rollback to savepoint ap6_raw; release savepoint ap6_raw"); throw error; }
  };
  /** Shift capacity on every weekday for both presses: A 06:00-14:00 and B 14:00-22:00, 800 kg each. */
  async function shifts({ kg = 800 } = {}) {
    for (const machine of [i.press, i.press2]) for (let weekday = 1; weekday <= 7; weekday++) {
      await seed("insert into factory_shift_capacities(company_id,machine_id,weekday,shift_name,starts_local,ends_local,capacity_kg,created_by) values($1,$2,$3,'A','06:00','14:00',$4,$5),($1,$2,$3,'B','14:00','22:00',$4,$5)",
        [i.company, machine, weekday, kg, i.owner]);
    }
  }
  /** A planned job for an order with remaining quantity, on the given die. */
  async function plannedJob({ die = i.die, kg = 300, due = 3, billetsShort = 0, number } = {}) {
    const order = next(), job = next(), line = next();
    await seed(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,billets_short,manufacturing_weight_kg,production_quantity_kg)
      values($1,$2,$3,$4,current_date,current_date+$5::int,'normal','order_confirmed',$6,$7,$7)`, [order, i.company, `SO-P-${order.slice(-4)}`, i.customer2, due, billetsShort, kg]);
    await seed("insert into order_items(id,company_id,order_id,profile_id,die_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,section_weight_kg_per_m) values($1,$2,$3,$4,$5,'Track',50,6,$6,0.95)",
      [line, i.company, order, i.profile2, die, kg]);
    await seed(`insert into production_jobs(id,company_id,job_number,die_id,profile_id,status,planned_quantity_kg,pieces,length_per_piece_m,section_weight_kg_per_m,order_id,source_line_id)
      values($1,$2,$3,$4,$5,'planned',$6,50,6,0.95,$7,$8)`, [job, i.company, number ?? `PJ-P-${job.slice(-4)}`, die, i.profile2, kg, order, line]);
    return { order, job, line };
  }
  const ap = (rpc, command, payload = {}, actor = i.productionManager) => f.call(rpc, command, payload, actor);
  return { ...f, ids: i, next, seed, raw, shifts, plannedJob, ap };
}
