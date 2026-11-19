import { createPhase4Fixture, ids as baseIds, istDay } from "./fs-phase4-fixture.mjs";

export { istDay };
export const ids = baseIds;

// FABLE_SUGGESTIONS batch 4 fixture (FS-82, 77, 132, 125, 79, 07, 51, 65, 75). Builds on the Phase 4 fixture (full
// migration chain, one synthetic Omalco company plus a foreign company, one user per role) and adds helpers for
// weighed shipments, completed jobs with billet input, quotes and expenses awaiting approval. Synthetic data only.
export async function createBatch4Fixture() {
  const f = await createPhase4Fixture();
  const i = baseIds;

  /** A shipment of one packed bundle with recorded net kg, dispatched `daysAgo` days ago against the order. */
  async function shipment({ order, line = null, kg, pieces = 10, cutLength = 6, expectedOffset = null, daysAgo = 0, profile = i.profile2 }) {
    if (expectedOffset !== null) await f.seed("update orders set expected_dispatch_date=current_date+$2::int where id=$1", [order, expectedOffset]);
    const dispatch = f.next(), item = f.next();
    await f.seed(`insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,total_weight_kg,number_of_bundles,actual_dispatched_at)
      values($1,$2,$3,$4,current_date-$5::int,'dispatched',$6,1,now()-make_interval(days=>$5::int))`, [dispatch, i.company, order, `DC-B4-${dispatch.slice(-4)}`, daysAgo, kg]);
    await f.seed(`insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,net_length_m,cut_length,order_item_id,source_kind,source_record_id)
      values($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,'production',$11)`, [item, i.company, dispatch, profile, `B-B4-${item.slice(-4)}`, pieces, kg, pieces * cutLength, cutLength, line, order]);
    return { dispatch, item };
  }

  /** A completed job (today, IST) with output, optional issued billet input (measured kg) and QC-rejected kg. */
  async function job({ kg, input = null, rejected = 0, die = null, planned = kg, scrap = 0, status = "completed" }) {
    const id = f.next();
    const o = await f.order({ kg });
    await f.seed(`insert into production_jobs(id,company_id,order_id,source_line_id,profile_id,die_id,status,planned_date,planned_quantity_kg,actual_quantity_kg,completed_at,job_number)
      values($1,$2,$8,$9,$3,$4,$10,current_date,$5,$6,case when $10 = 'completed' then now() end,$7)`, [id, i.company, i.profile2, die, planned, kg, `JOB-B4-${id.slice(-4)}`, o.order, o.line, status]);
    if (input !== null) {
      await f.seed(`insert into foundry_billets(id,company_id,foundry_batch_id,billet_code,billet_number,billet_diameter_inch,billet_diameter_mm,billet_length_mm,alloy,temper,weight_kg,measured_weight_kg,production_job_id,status)
        values($1,$2,$3,$4,1,7,177.8,800,'6063','T5',$5,$6,$7,'consumed')`, [f.next(), i.company, f.next(), `BL-B4-${id.slice(-4)}`, input + 5, input, id]);
    }
    if (rejected > 0) {
      await f.seed(`insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status)
        values($1,$2,$3,$4,current_date,$5,'rejected')`, [f.next(), i.company, id, i.profile2, rejected]);
    }
    if (scrap > 0) {
      const record = f.next();
      await f.seed(`insert into scrap_records(id,company_id,production_job_id,profile_id,scrap_type,weight_kg,recorded_date) values($1,$2,$3,$4,'process_scrap',$5,current_date)`, [record, i.company, id, i.profile2, scrap]);
      await f.seed(`insert into production_scrap_lines(id,company_id,scrap_record_id,production_job_id,category,weight_kg,recoverable) values($1,$2,$3,$4,'butt_end',$5,true)`, [f.next(), i.company, record, id, scrap]);
    }
    return id;
  }

  /** A quotation awaiting internal review, with complete costing on its line. */
  async function reviewQuote({ total, createdBy = i.sales, lowMargin = false }) {
    const id = f.next();
    await f.seed(`insert into quotes(id,company_id,quote_number,customer_id,quote_date,valid_until,status,subtotal,total_before_gst,grand_total,created_by,low_margin_approval_required)
      values($1,$2,$3,$4,current_date,current_date+15,'internal_review',$5,$5,$5,$6,$7)`, [id, i.company, `QT-B4-${id.slice(-4)}`, i.customer2, total, createdBy, lowMargin]);
    await f.seed(`insert into quote_items(company_id,quote_id,profile_id,item_description,quantity_pieces,length_per_piece_m,section_weight_kg_per_m,total_weight_kg,quantity_kg,costing_complete)
      values($1,$2,$3,'Sliding track',100,6,0.95,570,570,true)`, [i.company, id, i.profile2]);
    return id;
  }

  /** An expense awaiting approval. */
  async function pendingExpense({ total, createdBy = i.accounts2 }) {
    const id = f.next();
    await f.seed(`insert into expense_ledger(id,company_id,expense_number,vendor_id,expense_category,description,total_amount,approval_status,created_by,invoice_date,currency)
      values($1,$2,$3,$4,'repairs','Press hydraulic seal kit',$5,'pending_approval',$6,current_date,'INR')`, [id, i.company, `EXP-B4-${id.slice(-4)}`, i.vendor, total, createdBy]);
    return id;
  }

  /** Decide a quote or expense through the real approval inbox, reading the current version from the inbox list. */
  async function decide(sourceType, sourceId, decision, actor, note = null) {
    const list = await f.call("approval_inbox_command", "inbox.list", { type: sourceType }, actor);
    const row = list.rows.find(r => r.source_id === sourceId);
    if (!row) throw Object.assign(new Error("not in this person's inbox"), { code: "NOT_LISTED" });
    return f.call("approval_inbox_command", "inbox.decide", { source_type: sourceType, source_id: sourceId, version: row.version, decision, note, request_id: crypto.randomUUID() }, actor);
  }

  return { ...f, shipment, job, reviewQuote, pendingExpense, decide };
}
