import { createBatch7Fixture, ids as baseIds, istDay } from "./autopilot-batch7-fixture.mjs";

export { istDay };
export const ids = baseIds;

// Autopilot batch 8 fixture. Builds on the batch 7 fixture (full migration chain, synthetic Omalco company, one user per
// role, customers, orders, die, profiles) and adds presses with shift capacity, planned jobs, a received billet purchase
// line, an approved inspection plan with readings, and customer order/payment history. Synthetic data only.
export async function createBatch8Fixture() {
  return addBatch8Helpers(await createBatch7Fixture());
}

export function addBatch8Helpers(f) {
  const i = baseIds;
  /** An active extrusion press. */
  async function press({ name = `Press ${f.next().slice(-3)}`, code = null } = {}) {
    const id = f.next();
    await f.seed("insert into machines(id,company_id,machine_name,machine_type,status,is_active,machine_code) values($1,$2,$3,'extrusion_press','active',true,$4)", [id, i.company, name, code]);
    return id;
  }
  /** Two shifts every weekday, kg each. */
  async function shifts(machine, kg = 1000) {
    for (let weekday = 1; weekday <= 7; weekday++) {
      await f.seed("insert into factory_shift_capacities(company_id,machine_id,weekday,shift_name,starts_local,ends_local,capacity_kg,created_by) values($1,$2,$3,'A','06:00','14:00',$4,$5),($1,$2,$3,'B','14:00','22:00',$4,$5)",
        [i.company, machine, weekday, kg, i.owner]);
    }
  }
  /** An open production job on an order of its own. plannedIn: days from today, or null for not yet planned. */
  async function job({ die = i.die, profile = i.profile2, kg = 500, plannedIn = 2, machine = null, status = "planned", due = 10 } = {}) {
    const o = await f.order({ kg, pieces: 100 });
    await f.seed("update orders set expected_dispatch_date=current_date+$2::int where id=$1", [o.order, due]);
    // The job stands for the order line, as releasing its draft line would (AP-045).
    await f.seed("update production_job_draft_lines set status='removed' where order_id=$1 and status='open'", [o.order]);
    const id = f.next();
    await f.seed(`insert into production_jobs(id,company_id,order_id,profile_id,die_id,machine_id,source_line_id,status,planned_date,planned_quantity_kg,pieces,length_per_piece_m,job_number,section_weight_kg_per_m)
      values($1,$2,$3,$4,$5,$6,$7,$8,case when $9::int is null then null else current_date+$9::int end,$10,100,6,$11,0.95)`,
      [id, i.company, o.order, profile, die, machine, o.line, status, plannedIn, kg, `JOB-8-${id.slice(-4)}`]);
    return { ...o, job: id };
  }
  /** A received billet purchase line (1000 kg) awaiting its quality decision. */
  async function receiptLine({ kg = 1000, vendor = i.vendor } = {}) {
    const po = f.next(), pol = f.next(), receipt = f.next(), line = f.next();
    await f.seed("insert into purchase_orders(id,company_id,vendor_id,vendor_name_snapshot,po_number,order_date,status,idempotency_key,request_hash,created_by,updated_by) values($1,$2,$3,'Fixture billet supplier',$4,current_date-5,'open',$5,'fixture',$6,$6)",
      [po, i.company, vendor, `PO-8-${po.slice(-4)}`, f.next(), i.owner]);
    await f.seed("insert into purchase_order_lines(id,company_id,purchase_order_id,line_number,description,specification,unit,ordered_quantity,unit_rate,gst_percent) values($1,$2,$3,1,'6063 billet','7 inch billet','kg',$4,245,18)", [pol, i.company, po, kg]);
    await f.seed("insert into purchase_receipts(id,company_id,purchase_order_id,receipt_date,reference,idempotency_key,request_hash,created_by) values($1,$2,$3,current_date,'GRN-8',$4,'fixture',$5)", [receipt, i.company, po, f.next(), i.owner]);
    await f.seed("insert into purchase_receipt_lines(id,company_id,receipt_id,purchase_order_id,purchase_order_line_id,received_quantity,accepted_quantity,rejected_quantity,held_quantity) values($1,$2,$3,$4,$5,$6,$6,0,0)",
      [line, i.company, receipt, po, pol, kg]);
    return { po, pol, receipt, line };
  }
  /** A certificate draft as the server action writes it (file already "uploaded"). */
  async function certificate({ line, batch, extracted = {}, sha = null, actor = i.quality } = {}) {
    return f.call("ap_mtc", "draft", { ...(line ? { receipt_line_id: line } : { billet_batch_id: batch }), file_name: "mtc.pdf", storage_path: `${i.company}/billet-certificates/${line ?? batch}/mtc.pdf`,
      mime_type: "application/pdf", file_sha256: sha ?? f.next().replace(/-/g, "").padEnd(64, "a").slice(0, 64), source_kind: "pdf_text", extracted }, actor);
  }
  /** An approved inspection plan for the profile with numeric items. */
  async function plan({ profile = i.profile2, items = [{ characteristic: "Wall thickness", unit: "mm", nominal: 1.4, lower: 1.3, upper: 1.5 }] } = {}) {
    const id = f.next();
    await f.seed("insert into inspection_plans(id,company_id,profile_id,version,status,sampling_instruction,created_by,approved_by,approved_by_name,approved_at) values($1,$2,$3,1,'approved','First and every tenth bundle',$4,$5,'Fixture quality',now())",
      [id, i.company, profile, i.owner, i.quality]);
    const itemIds = [];
    for (const [n, it] of items.entries()) {
      const item = f.next(); itemIds.push(item);
      await f.seed("insert into inspection_plan_items(id,plan_id,company_id,seq,characteristic,unit,method,nominal,lower_limit,upper_limit,critical) values($1,$2,$3,$4,$5,$6,'Micrometer',$7,$8,$9,true)",
        [item, id, i.company, n + 1, it.characteristic, it.unit, it.nominal, it.lower, it.upper]);
    }
    return { plan: id, items: itemIds };
  }
  /** Inspection readings for a job, oldest first, one hour apart, the last one `endMinutesAgo` before now. */
  async function readings({ job: jobId, plan: planId, item, values, profile = i.profile2, endMinutesAgo = 0 }) {
    for (const [n, value] of values.entries()) {
      const q = f.next(), ago = (values.length - 1 - n) * 60 + endMinutesAgo;
      await f.seed("insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,status,inspector_name) values($1,$2,$3,$4,now()-make_interval(mins=>$5::int),'pending','Fixture QC')",
        [q, i.company, jobId, profile, ago]);
      await f.seed("insert into inspection_results(company_id,inspection_id,plan_id,item_id,observed,outcome,recorded_by,recorded_by_name,recorded_at) values($1,$2,$3,$4,$5,'pass',$6,'Fixture QC',now()-make_interval(mins=>$7::int))",
        [i.company, q, planId, item, value, i.quality, ago]);
    }
  }
  /** Orders on given days ago for a customer, each with kg. */
  async function orderHistory(customer, entries) {
    for (const [daysAgo, kg] of entries) {
      const o = await f.order({ kg, pieces: 100, customer });
      await f.seed("update orders set order_date=current_date-$2::int where id=$1", [o.order, daysAgo]);
    }
  }
  /** An assurance action (NOV-069 incoming decision and others) previewed and committed as the employee. */
  async function assurance(mutation, actor) {
    const request_id = f.next();
    const preview = await f.call("assurance_command", "preview", { request_id, mutation }, actor);
    const outcome = await f.call("assurance_command", "commit", { request_id, fingerprint: preview.fingerprint }, actor);
    if (outcome.state !== "confirmed") throw new Error(JSON.stringify(outcome));
    return outcome;
  }
  const ap = (rpc, command, payload = {}, actor = i.owner) => f.call(rpc, command, payload, actor);
  return { ...f, assurance, press, shifts, job, receiptLine, certificate, plan, readings, orderHistory, ap };
}
