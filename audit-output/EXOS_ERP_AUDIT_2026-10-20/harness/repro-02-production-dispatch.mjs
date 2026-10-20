// Reproductions for production scheduling, completion and dispatch findings.
// Run: node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-02-production-dispatch.mjs
import { createLiveCatalogDb } from "./live-catalog-db.mjs";
import { ids, seed } from "./seed.mjs";

const { db } = await createLiveCatalogDb();
await seed(db);
const results = [];
const record = (id, outcome, detail) => { results.push({ id, outcome, detail }); console.log(`[${outcome}] ${id}: ${detail}`); };
const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error: error.message }; } };
const q = async (sql) => (await db.query(sql)).rows;
const one = async (userId, sql) => { await db.exec(`select set_config('audit.uid','${userId}',false); set role authenticated;`); try { return (await db.query(sql)).rows[0]; } finally { await db.exec("reset role;"); } };

const lineA = "f5000000-0000-4000-8000-000000000001";
const lineB = "f5000000-0000-4000-8000-000000000002";
await db.exec(`set session_replication_role = replica;
  insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, quantity_pieces, length_per_piece_m, net_rate, gst_percent, finishing_type)
  values ('${lineA}', '${ids.company}', '${ids.orderA}', '${ids.profile}', 1000, 172, 5.8, 300, 18, 'mill_finish'),
         ('${lineB}', '${ids.company}', '${ids.orderB}', '${ids.profile}', 1000, 172, 5.8, 300, 18, 'mill_finish');
  insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, source_record_id, status, planned_quantity_kg, pieces, length_per_piece_m, extrusion_efficiency_percent, finishing_type)
  values ('${ids.jobA}', '${ids.company}', 'J-A', '${ids.orderA}', '${ids.profile}', '${ids.die}', '${lineA}', '${ids.orderA}', 'planned', 1000, 172, 5.8, 85, 'mill_finish'),
         ('${ids.jobB}', '${ids.company}', 'J-B', '${ids.orderB}', '${ids.profile}', '${ids.die}', '${lineB}', '${ids.orderB}', 'planned', 1000, 172, 5.8, 85, 'mill_finish');
  set session_replication_role = origin;`);

// P1: one physical die released and started on two presses for overlapping windows.
{
  const slotA = await attempt(() => one(ids.productionManager, `select public.save_production_schedule_slot_atomic(null, jsonb_build_object('production_job_id','${ids.jobA}','machine_id','${ids.pressA}','planned_start_at','2026-11-01T10:00:00+05:30','planned_end_at','2026-11-01T14:00:00+05:30','status','scheduled')) id`));
  const slotB = await attempt(() => one(ids.productionManager, `select public.save_production_schedule_slot_atomic(null, jsonb_build_object('production_job_id','${ids.jobB}','machine_id','${ids.pressB}','planned_start_at','2026-11-01T10:00:00+05:30','planned_end_at','2026-11-01T14:00:00+05:30','status','scheduled')) id`));
  if (!slotA.ok || !slotB.ok) {
    record("P1 die-double-booking", "BLOCKED", `slot A ${slotA.error ?? "ok"}; slot B ${slotB.error ?? "ok"}`);
  } else {
    const relA = await attempt(() => one(ids.productionManager, `select public.release_production_schedule_slot_atomic('${slotA.value.id}') id`));
    const relB = await attempt(() => one(ids.productionManager, `select public.release_production_schedule_slot_atomic('${slotB.value.id}') id`));
    const startA = await attempt(() => one(ids.production, `select public.transition_production_job_atomic('${ids.jobA}','in_progress','start') id`));
    const startB = await attempt(() => one(ids.production, `select public.transition_production_job_atomic('${ids.jobB}','in_progress','start') id`));
    const jobs = await q(`select job_number, status, die_id = '${ids.die}' same_die, machine_id from public.production_jobs order by job_number`);
    record("P1 die-double-booking", startA.ok && startB.ok ? "REPRODUCED" : "NOT REPRODUCED",
      `release A ${relA.ok} B ${relB.ok}; start A ${startA.ok}${startA.error ? " " + startA.error : ""}; start B ${startB.ok}${startB.error ? " " + startB.error : ""}; ${JSON.stringify(jobs)}`);
  }
}

// P2: production completion with no linked billets and no requirement row -> output with no metal input.
{
  const c = await attempt(() => one(ids.production, `select public.complete_production_job_atomic('${ids.jobA}', 900, 155, null, 0, 'no billets') id`));
  const row = await q(`select status, actual_quantity_kg, (select count(*)::int from public.foundry_billets where production_job_id='${ids.jobA}') billets from public.production_jobs where id='${ids.jobA}'`);
  record("P2 completion-without-metal-input", c.ok ? "REPRODUCED" : "NOT REPRODUCED", c.ok ? `job completed with ${JSON.stringify(row[0])} against a 1000 kg plan` : c.error);
  const pkg = await q(`select status, profile_weight_kg from public.packaging_jobs where production_job_id='${ids.jobA}'`);
  record("P2b auto-packaging-from-unbacked-output", pkg.length ? "REPRODUCED" : "NOT REPRODUCED", JSON.stringify(pkg));
}

// P3: completion loss is booked as clean, available foundry scrap with no alloy (1:1 recoverable).
{
  const c = await attempt(() => one(ids.production, `select public.complete_production_job_atomic('${ids.jobB}', 600, 100, null, 400, 'loss') id`));
  const scrap = await q(`select scrap_source, scrap_quality, status, weight_kg, available_weight_kg, origin_reference from public.foundry_aluminium_scrap where origin_reference like '%${ids.jobB}%'`);
  record("P3 completion-loss-becomes-clean-recoverable-scrap", c.ok && scrap.length ? "REPRODUCED" : "NOT REPRODUCED", c.ok ? JSON.stringify(scrap) : c.error);
}

// P4: dispatch role sets an order to 'delivered' through the exposed lower-level save_dispatch_atomic without shipping anything.
{
  const r = await attempt(() => one(ids.factoryManager, `select public.save_dispatch_atomic(null,
      jsonb_build_object('order_id','${ids.orderB}','dispatch_date','2026-11-02','number_of_bundles',1,'total_weight_kg',10,'delivery_status','pending'),
      jsonb_build_array(jsonb_build_object('bundle_number','B-1','profile_id','${ids.profile}','source_kind','production','source_record_id','${ids.orderB}','source_line_id','${ids.jobB}','number_of_pieces',1,'net_length_m',5.8,'gross_weight_kg',11,'tare_weight_kg',1)),
      'delivered') id`));
  const order = await q(`select current_stage from public.orders where id='${ids.orderB}'`);
  const disp = await q(`select delivery_status, actual_dispatched_at from public.dispatches where order_id='${ids.orderB}'`);
  record("P4 factory-manager-marks-order-delivered-via-low-level-rpc", r.ok && order[0].current_stage === "delivered" ? "REPRODUCED" : "NOT REPRODUCED",
    r.ok ? `order stage=${order[0].current_stage}; dispatch=${JSON.stringify(disp)} (no stock moved, no POD)` : r.error);
}

// P4b: a dispatch-role user cannot record an in-transit update because the order-stage sync trips the billet-allocation role guard.
{
  const d = "f6300000-0000-4000-8000-000000000001";
  await db.exec(`set session_replication_role = replica;
    update public.orders set current_stage='packing' where id='${ids.orderA}';
    insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status, actual_dispatched_at)
      values ('${d}', '${ids.company}', '${ids.orderA}', 'D-T', current_date, 1, 10, 0, 'dispatched', now());
    set session_replication_role = origin;`);
  const asDispatch = await attempt(() => one(ids.dispatch, `select public.transition_dispatch_delivery_atomic('${d}','in_transit',null,'truck left') id`));
  const asOwner = await attempt(() => one(ids.owner, `select public.transition_dispatch_delivery_atomic('${d}','in_transit',null,'truck left') id`));
  record("P4b dispatch-role-cannot-move-delivery-status", !asDispatch.ok && /allocate billets/.test(asDispatch.error) ? "REPRODUCED" : "NOT REPRODUCED",
    `dispatch role: ${asDispatch.ok ? "ok" : asDispatch.error}; owner: ${asOwner.ok ? "ok" : asOwner.error}`);
}

// P5: QC approval ignores hardness and section-weight results that are far out of specification.
{
  const r = await attempt(() => one(ids.productionManager, `insert into public.quality_inspections (company_id, production_job_id, profile_id, quantity_checked_kg, hardness_webster, weight_per_meter_actual, dimensional_variance, surface_finish_ok, status, inspector_name)
    values ('${ids.company}', '${ids.jobB}', '${ids.profile}', 600, 2, 1.6, 'wall thickness -0.4 mm, out of tolerance', true, 'approved', 'PM self-approval') returning id`));
  record("P5 qc-approves-out-of-spec-by-production-manager", r.ok ? "REPRODUCED" : "NOT REPRODUCED", r.ok ? "approved QC with hardness 2 HW, 1.6 kg/m vs 1.0 kg/m nominal, failed dimension text, approver = production manager" : r.error);
}

// P6: stock-reservation packing line built by the app (no order_item/quote_item/rate) is rejected; with a foreign order line it is accepted at any rate.
{
  const batch = "f6000000-0000-4000-8000-000000000001";
  const resv = "f6100000-0000-4000-8000-000000000001";
  const dispatch = "f6200000-0000-4000-8000-000000000001";
  await db.exec(`set session_replication_role = replica;
    insert into public.profile_stock_batches (id, company_id, profile_id, finish, length_m, quantity_pieces, total_weight_kg, status) values ('${batch}', '${ids.company}', '${ids.profile}', 'mill_finish', 58, 10, 58, 'reserved');
    insert into public.profile_stock_reservations (id, company_id, profile_stock_batch_id, profile_id, order_id, reserved_weight_kg, reserved_length_m, reserved_pieces, initial_reserved_weight_kg, initial_reserved_length_m, initial_reserved_pieces, status)
      values ('${resv}', '${ids.company}', '${batch}', '${ids.profile}', '${ids.orderA}', 58, 58, 10, 58, 58, 10, 'active');
    insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status) values ('${dispatch}', '${ids.company}', '${ids.orderA}', 'D-R', current_date, 1, 5.8, 0, 'pending');
    set session_replication_role = origin;
    select set_config('audit.uid','${ids.dispatch}',false);`);
  const appShape = await attempt(() => db.exec(`insert into public.packing_list_items (company_id, dispatch_id, profile_id, bundle_number, source_kind, source_record_id, source_line_id, reservation_id, profile_stock_batch_id, number_of_pieces, net_length_m, gross_weight_kg, tare_weight_kg, operator_verified_at, operator_verified_by, order_item_id, quote_item_id, net_rate)
    values ('${ids.company}', '${dispatch}', '${ids.profile}', 'S-1', 'reservation', '${ids.orderA}', '${resv}', '${resv}', '${batch}', 1, 5.8, 5.8, 0, now(), '${ids.dispatch}', null, null, null)`));
  record("P6a app-built-stock-packing-line-rejected", !appShape.ok ? "REPRODUCED" : "NOT REPRODUCED", appShape.error ?? "accepted");
  const forged = await attempt(() => db.exec(`insert into public.packing_list_items (company_id, dispatch_id, profile_id, bundle_number, source_kind, source_record_id, source_line_id, reservation_id, profile_stock_batch_id, number_of_pieces, net_length_m, gross_weight_kg, tare_weight_kg, operator_verified_at, operator_verified_by, order_item_id, quote_item_id, net_rate)
    values ('${ids.company}', '${dispatch}', '${ids.profile}', 'S-2', 'reservation', '${ids.orderA}', '${resv}', '${resv}', '${batch}', 1, 5.8, 5.8, 0, now(), '${ids.dispatch}', '${lineB}', null, 1.00)`));
  const line = await q(`select order_item_id = '${lineB}' foreign_order_line, net_rate, gst_percent from public.packing_list_items where bundle_number='S-2'`);
  record("P6b stock-packing-accepts-foreign-line-and-any-rate", forged.ok ? "REPRODUCED" : "NOT REPRODUCED", forged.ok ? `accepted ${JSON.stringify(line[0])} (orderA reservation priced from orderB line at Rs 1/kg)` : forged.error);
}

// P7: cancelling a held job leaves its billets linked and issued to the cancelled job.
{
  const job = "f4000000-0000-4000-8000-000000000003";
  const fb = "f7000000-0000-4000-8000-000000000001";
  const req = "f7100000-0000-4000-8000-000000000001";
  await db.exec(`set session_replication_role = replica;
    insert into public.foundry_batches (id, company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, status, billet_weight_density_kg, batch_sequence, production_date) values ('${fb}', '${ids.company}', 'FB-P7', 'F1', '6063', 'T6', 1000, 101.6, 4, 2, 2700, 0, 100, 'ready', 21.89, 7, current_date);
    insert into public.order_billet_requirements (id, company_id, order_id, profile_id, alloy, billet_diameter_inch, billets_required, status) values ('${req}', '${ids.company}', '${ids.orderA}', '${ids.profile}', '6063', 4, 2, 'pending');
    insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, source_record_id, status, planned_quantity_kg, machine_id) values ('${job}', '${ids.company}', 'J-C', '${ids.orderA}', '${ids.profile}', '${ids.die}', '${lineA}', '${ids.orderA}', 'on_hold', 40, '${ids.pressA}');
    insert into public.foundry_billets (company_id, source_type, foundry_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status, order_id, allocation_requirement_id, production_job_id, allocated_at, allocated_by)
      values ('${ids.company}', 'in_house', '${fb}', 'F1-X-1', 1, 4, 101.6, 1000, '6063', 'T6', 21.89, 'issued', '${ids.orderA}', '${req}', '${job}', now(), '${ids.owner}'),
             ('${ids.company}', 'in_house', '${fb}', 'F1-X-2', 2, 4, 101.6, 1000, '6063', 'T6', 21.89, 'issued', '${ids.orderA}', '${req}', '${job}', now(), '${ids.owner}');
    set session_replication_role = origin;`);
  const c = await attempt(() => one(ids.productionManager, `select public.transition_production_job_atomic('${job}','cancelled','order changed') id`));
  const billets = await q(`select status, production_job_id = '${job}' linked_to_cancelled_job, count(*)::int n from public.foundry_billets where foundry_batch_id='${fb}' group by 1,2`);
  record("P7 cancelled-job-strands-issued-billets", c.ok && billets.some((b) => b.linked_to_cancelled_job && b.status === "issued") ? "REPRODUCED" : "NOT REPRODUCED", c.ok ? JSON.stringify(billets) : c.error);
}

console.log(JSON.stringify(results, null, 1));
