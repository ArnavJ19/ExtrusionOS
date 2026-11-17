import { addBatch10Helpers, createBatch10Fixture, ids as baseIds, istDay } from "./autopilot-batch10-fixture.mjs";

export { istDay };
export const ids = baseIds;

// FABLE_SUGGESTIONS Phase 4 fixture. Builds on the Autopilot batch 10 fixture (full migration chain, synthetic Omalco
// company, one user per role, customers, profiles, die, presses, jobs, invoices) and adds helpers for dispatched order
// lines, promises, quotes, dies with history and billet stock. Synthetic data only.
export async function createPhase4Fixture() {
  return addPhase4Helpers(await createBatch10Fixture());
}

export function addPhase4Helpers(f0) {
  const f = f0.pushes ? f0 : addBatch10Helpers(f0);
  const i = baseIds;
  /** Moves an order's expected dispatch date through the real triggers (not the trigger-bypassing seed). */
  async function promise(order, offsetDays) {
    await f.raw("update orders set expected_dispatch_date=current_date+$2::int where id=$1", [order, offsetDays]);
  }
  /** A dispatched packed line of `kg` for the order line, gated out `daysAgo` days ago. */
  async function dispatchLine({ order, line, kg, daysAgo, profile = i.profile2 }) {
    const dispatch = f.next(), item = f.next();
    await f.seed(`insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,total_weight_kg,number_of_bundles,actual_dispatched_at)
      values($1,$2,$3,$4,current_date-$5::int,'dispatched',$6,1,now()-make_interval(days=>$5::int))`, [dispatch, i.company, order, `DC-P4-${dispatch.slice(-4)}`, daysAgo, kg]);
    await f.seed(`insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,net_length_m,order_item_id,source_kind,source_record_id)
      values($1,$2,$3,$4,$5,10,$6,0,60,$7,'production',$8)`, [item, i.company, dispatch, profile, `B-P4-${item.slice(-4)}`, kg, line, order]);
    return dispatch;
  }
  /** A quote of `kg` and `value` in a status; sent_at set when it was sent. */
  async function quote({ status = "sent", kg = 1000, value = 100000, sent = true, daysAgo = 10, customer = i.customer2 }) {
    const id = f.next();
    await f.seed(`insert into quotes(id,company_id,quote_number,customer_id,quote_date,valid_until,status,subtotal,total_before_gst,grand_total,sent_at,created_by)
      values($1,$2,$3,$4,current_date-$5::int,current_date+30,$6,$7,$7,$7,$8,$9)`, [id, i.company, `QT-P4-${id.slice(-4)}`, customer, daysAgo, status, value, sent ? new Date(Date.now() - daysAgo * 86400e3).toISOString() : null, i.sales]);
    await f.seed(`insert into quote_items(company_id,quote_id,profile_id,item_description,quantity_pieces,length_per_piece_m,section_weight_kg_per_m,total_weight_kg,quantity_kg)
      values($1,$2,$3,'Sliding track',100,6,0.95,$4,$4)`, [i.company, id, i.profile2, kg]);
    return id;
  }
  /** A die of a type with optional rated life, maker, cost and dates. */
  async function die({ number = `D-P4-${f.next().slice(-4)}`, type = "solid", status = "active", lifeTons = null, maker = null, cost = null, profile = i.profile2, ownership = "company_owned",
    purchased = null, received = null, opening = 0 } = {}) {
    const id = f.next();
    await f.seed(`insert into dies(id,company_id,die_number,profile_id,die_type,die_status,die_life_tons,die_manufacturer,die_cost,ownership_type,purchase_date,receipt_date,opening_production_kg)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id, i.company, number, profile, type, status, lifeTons, maker, cost, ownership, purchased, received, opening]);
    return id;
  }
  /** A completed job on a die with `kg` output, completed `daysAgo` days ago. */
  async function completedRun({ die: dieId, kg, daysAgo = 3, input = null }) {
    const id = f.next();
    const o = await f.order({ kg });
    await f.seed("update orders set current_stage='closed' where id=$1", [o.order]);
    await f.seed(`insert into production_jobs(id,company_id,order_id,source_line_id,profile_id,die_id,status,planned_date,planned_quantity_kg,actual_quantity_kg,input_billet_weight,completed_at,job_number)
      values($1,$2,$9,$10,$3,$4,'completed',current_date-$5::int,$6,$6,$7,now()-make_interval(days=>$5::int),$8)`, [id, i.company, i.profile2, dieId, daysAgo, kg, input, `JOB-P4-${id.slice(-4)}`, o.order, o.line]);
    return id;
  }
  /** Available purchased billet. */
  async function billetStock({ kg, alloy = "6063", diameterMm = 177.8 }) {
    const id = f.next();
    await f.seed(`insert into billet_batches(id,company_id,batch_number,alloy,diameter_mm,total_weight_kg,available_weight_kg,rate_per_kg,received_date,status,temper)
      values($1,$2,$3,$4,$5,$6,$6,240,current_date,'available','T5')`, [id, i.company, `BB-P4-${id.slice(-4)}`, alloy, diameterMm, kg]);
    return id;
  }
  return { ...f, promise, dispatchLine, quote, die, completedRun, billetStock };
}
