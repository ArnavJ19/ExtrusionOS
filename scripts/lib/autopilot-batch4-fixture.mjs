import { createCashFixture, cIds, GSTIN, nid, istDay } from "./autopilot-batch3-fixture.mjs";

export { nid, istDay, GSTIN };
// Dispatch-and-compliance fixture (Autopilot batch 4). Builds on the order-to-cash fixture and adds a dispatch manager,
// a transporter with a GSTIN, a packaging material and helpers that make an order line ready to ship: a completed
// production job with QC-approved and packaged output, so bundles recorded against it pass the dispatch writer's own
// readiness checks. Seeds run with triggers suspended; scenarios run with them on.
export const dIds = {
  ...cIds,
  dispatchUser: nid(22), dispatchManager: nid(500), film: nid(501), paper: nid(502)
};

export async function createDispatchFixture() {
  const f = await createCashFixture();
  const { db } = f, i = dIds;
  await db.exec("set session_replication_role = replica");
  await db.query("insert into auth.users(id,email) values($1,'dm@ap4.invalid')", [i.dispatchManager]);
  await db.query("insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,'Fixture dispatch manager','dm@ap4.invalid','dispatch_manager',true)", [i.dispatchManager, i.company]);
  await db.query("update companies set legal_name='Omalco Extrusion Pvt Ltd', gst_number=$2, billing_address='Plot 7, Industrial Area', city='Delhi', pincode='110020' where id=$1", [i.company, GSTIN.delhi]);
  await db.query("update vendors set gst_number='27AAACV1234B1Z1', vendor_type='transporter', is_active=true where id=$1", [i.transporter]);
  await db.query("update customers set pincode='411001', city='Pune', shipping_address='Gate 3, Chakan MIDC' where id=$1", [i.customer2]);
  await db.query(`insert into packaging_materials(id,company_id,material_code,material_name,material_type,unit,current_stock,calculation_method,consumption_rate,is_active) values
    ($1,$3,'SF-23','Stretch film 23 micron','stretch_film','meter',100000,'per_profile_meter',1.2,true),($2,$3,'IP-01','Interleaving paper','paper','sheet',100000,'per_piece',1,true)`, [i.film, i.paper, i.company]);
  await db.query("insert into feature_flags(company_id,module_name,is_enabled) values($1,'quality_compliance',true) on conflict do nothing", [i.company]);
  await db.exec("set session_replication_role = origin");

  let seq = 6000;
  const next = () => nid(seq++);
  const ap = (rpc, command, payload = {}, actor = i.dispatchUser) => f.call(rpc, command, payload, actor);

  /** A completed, QC-approved, packaged production job for one order line (seeded; the readiness trail the dispatch writer needs). */
  async function readyJob({ order, line, kg, pieces = 100, approvedKg = kg, packagedKg = kg, profile = i.profile2, number }) {
    const job = next(), pack = next(), qi = next(), mat = next();
    await f.seed(`insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,actual_meters,pieces,actual_pieces,job_number,source_line_id,length_per_piece_m)
      values($1,$2,$3,$4,'completed',$5,$5,$6,$7,$7,$8,$9,6)`, [job, i.company, order, profile, kg, pieces * 6, pieces, number ?? `JOB-${job.slice(-4)}`, line]);
    if (approvedKg > 0) await f.seed(`insert into quality_inspections(id,company_id,production_job_id,profile_id,quantity_checked_kg,status) values($1,$2,$3,$4,$5,'approved')`, [qi, i.company, job, profile, approvedKg]);
    if (packagedKg > 0) {
      await f.seed(`insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,status,pieces,profile_weight_kg,profile_length_m) values($1,$2,$3,$4,$5,'completed',$6,$7,$8)`,
        [pack, i.company, `PK-${pack.slice(-4)}`, order, job, pieces, packagedKg, pieces * 6]);
      await f.seed("insert into packaging_job_materials(id,company_id,job_id,material_id,quantity_required) values($1,$2,$3,$4,10)", [mat, i.company, pack, i.film]);
    }
    return job;
  }

  /** Records a measured bundle through the existing bundle command (as the dispatch user, production triggers on). */
  async function bundle({ order, job, tag, pieces = 20, gross = 120, tare = 6, length = 120, actor = i.dispatchUser }) {
    const id = next();
    await f.asUser("select public.physical_bundle_command('bundle.record',$1)", [{ id, order_id: order, source_line_id: job, source_kind: "production", bundle_number: tag,
      number_of_pieces: pieces, net_length_m: length, gross_weight_kg: gross, tare_weight_kg: tare }], actor);
    return id;
  }

  /** An order with one line, confirmed through the batch 3 helper. */
  async function order({ id = next(), customer = i.customer2, pieces = 100, kg = 570, length = 6, kgm = 0.95, line = next(), number }) {
    await f.confirmOrder({ id, customer, value: 50000, lines: [{ id: line, kg, pieces, length, kgm }], number: number ?? `SO-B4-${id.slice(-4)}` });
    await f.seed("update order_items set length_per_piece_m=$2, section_weight_kg_per_m=$3 where id=$1", [line, length, kgm]);
    return { order: id, line };
  }

  /** Sends the scanned bundles of a session through the real dispatch writer, as the server action does. */
  async function writeDispatch(sessionId, actor = i.dispatchUser) {
    const data = await ap("ap_dispatch", "bundles_for_dispatch", { id: sessionId }, actor);
    const jobs = (await db.query("select id, order_id, profile_id, source_line_id from production_jobs where id = any($1)", [data.bundles.map(b => b.source_line_id)])).rows;
    const items = data.bundles.map(b => {
      const j = jobs.find(x => x.id === b.source_line_id);
      return { company_id: i.company, profile_id: j.profile_id, source_record_id: data.order_id, source_line_id: j.id, order_item_id: j.source_line_id, source_kind: "production",
        reservation_id: null, profile_stock_batch_id: null, bundle_number: b.bundle_number, number_of_pieces: b.number_of_pieces, net_length_m: Number(b.net_length_m),
        gross_weight_kg: Number(b.gross_weight_kg), tare_weight_kg: Number(b.tare_weight_kg), net_weight_kg: Number((b.gross_weight_kg - b.tare_weight_kg).toFixed(3)), notes: "Loaded by scan" };
    });
    const net = items.reduce((s, x) => s + x.net_weight_kg, 0), tare = items.reduce((s, x) => s + x.tare_weight_kg, 0);
    const rows = await f.asUser("select public.save_ready_dispatch_atomic(null,$1,$2) id", [{ order_id: data.order_id, dispatch_date: istDay(0), delivery_status: "dispatched",
      number_of_bundles: items.length, total_weight_kg: Number(net.toFixed(3)), total_tare_weight_kg: Number(tare.toFixed(3)), vehicle_number: data.vehicle_number,
      transporter_name: data.transporter_name, lr_number: data.lr_number }, items], actor);
    await f.immediate();
    return rows[0].id;
  }

  /** Runs a statement as an anonymous visitor (no session), returning the first row's first column. */
  async function asAnon(sql, params = []) {
    await db.exec("savepoint ap4_anon");
    try {
      await db.query("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','anon',true)");
      await db.exec("set local role anon");
      const rows = (await db.query(sql, params)).rows;
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.role','',true)");
      await db.exec("release savepoint ap4_anon");
      return rows[0] ? Object.values(rows[0])[0] : undefined;
    } catch (error) {
      await db.exec("rollback to savepoint ap4_anon; reset role; release savepoint ap4_anon");
      throw error;
    }
  }

  return { ...f, ids: i, next, ap, readyJob, bundle, order, writeDispatch, asAnon };
}
