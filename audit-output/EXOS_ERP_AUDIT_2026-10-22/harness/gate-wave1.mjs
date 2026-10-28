// Wave 1 gate for EXOS-AUD2-001, 004, 005 and 006.
// Every scenario runs on a fresh replica of the hosted catalog (ledger 129):
//   baseline  = hosted state              -> the defect still reproduces
//   candidate = hosted + Wave 1 migrations -> the defect is fixed and legitimate flows still work
// Run from the repo root: node audit-output/EXOS_ERP_AUDIT_2026-10-22/harness/gate-wave1.mjs
// GATE_ONLY=G001,G004 limits the run to scenario id prefixes; GATE_TRACE=1 prints every rejection.
import assert from "node:assert/strict";
import { current, ids } from "./current-db.mjs";

const ONLY = (process.env.GATE_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const TRACE = Boolean(process.env.GATE_TRACE);
const scenarios = [];
const scenario = (id, run, { candidateOnly = false } = {}) => scenarios.push({ id, run, candidateOnly });
const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (error) { if (TRACE) console.log(`  rejected: ${error.message}`); return { ok: false, error: error.message }; } };

// ---- shared seeds --------------------------------------------------------
const lineB = "f5000000-0000-4000-8000-000000000002";
const D1 = "fd000000-0000-4000-8000-000000000001", PL1 = "fd100000-0000-4000-8000-000000000001";
const seedPackedJob = (ctx, stage = "packing") => ctx.replica(`
  update public.orders set current_stage='${stage}' where id='${ids.orderB}';
  insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, net_rate, gst_percent) values ('${lineB}', '${ids.company}', '${ids.orderB}', '${ids.profile}', 10, 300, 18);
  insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, status, planned_quantity_kg, actual_quantity_kg, actual_pieces, actual_meters, finishing_type, completed_at)
    values ('${ids.jobB}', '${ids.company}', 'J-Q', '${ids.orderB}', '${ids.profile}', '${ids.die}', '${lineB}', 'completed', 10, 10, 2, 10, 'mill_finish', now());
  insert into public.quality_inspections (company_id, production_job_id, profile_id, quantity_checked_kg, status, inspector_name, surface_finish_ok) values ('${ids.company}', '${ids.jobB}', '${ids.profile}', 10, 'approved', 'QC', true);
  insert into public.packaging_materials (id, company_id, material_code, material_name, material_type, consumption_rate, calculation_method) values ('f8300000-0000-4000-8000-000000000001', '${ids.company}', 'PM1', 'Wrap', 'stretch_film', 1, 'fixed');
  insert into public.packaging_jobs (id, company_id, packaging_number, order_id, production_job_id, status, profile_weight_kg) values ('f8400000-0000-4000-8000-000000000001', '${ids.company}', 'PK1', '${ids.orderB}', '${ids.jobB}', 'completed', 10);
  insert into public.packaging_job_materials (company_id, job_id, material_id, quantity_required) values ('${ids.company}', 'f8400000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 1)`);
const seedDispatch = (ctx, status) => ctx.replica(`
  insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status, delivered_at, actual_dispatched_at, eway_bill_number, lr_number, vehicle_number)
    values ('${D1}', '${ids.company}', '${ids.orderB}', 'D-1', current_date, 1, 10, 0, '${status}', ${status === "delivered" ? "now()" : "null"}, ${status === "pending" ? "null" : "now()"}, 'EWB-1', 'LR-1', 'MH01AB1234');
  insert into public.dispatch_status_history (company_id, dispatch_id, from_status, to_status) values ('${ids.company}', '${D1}', null, '${status}');
  insert into public.packing_list_items (id, company_id, dispatch_id, profile_id, bundle_number, number_of_pieces, gross_weight_kg, tare_weight_kg, source_record_id, source_line_id, quantity_kg, order_item_id)
    values ('${PL1}', '${ids.company}', '${D1}', '${ids.profile}', 'B-1', 2, 10, 0, '${ids.orderB}', '${ids.jobB}', 10, '${lineB}')`);
const reship = (ctx, n) => attempt(() => ctx.as(ids.dispatchManager, `select public.save_ready_dispatch_atomic(null,
    jsonb_build_object('order_id','${ids.orderB}','dispatch_date',current_date,'number_of_bundles',1,'total_weight_kg',10,'total_tare_weight_kg',0,'delivery_status','pending'),
    jsonb_build_array(jsonb_build_object('bundle_number','B-${n}','profile_id','${ids.profile}','source_kind','production','source_record_id','${ids.orderB}','source_line_id','${ids.jobB}','number_of_pieces',2,'net_length_m',10,'gross_weight_kg',10,'tare_weight_kg',0,'operator_verified_at',now(),'operator_verified_by','${ids.dispatchManager}'))) id`));

// ---- EXOS-AUD2-001 -------------------------------------------------------
scenario("G001-delete-delivered-dispatch-then-reship", async (ctx, candidate) => {
  await seedPackedJob(ctx, "delivered");
  await seedDispatch(ctx, "delivered");
  const del = await attempt(() => ctx.asExec(ids.owner, `delete from public.dispatches where id='${D1}'`));
  const again = await reship(ctx, 2);
  const [left] = await ctx.q(`select (select count(*) from public.dispatches where id='${D1}')::int d, (select count(*) from public.packing_list_items where id='${PL1}')::int p, (select count(*) from public.dispatch_status_history where dispatch_id='${D1}')::int h`);
  if (!candidate) {
    assert.equal(del.ok, true, del.error); assert.equal(again.ok, true, again.error); assert.deepEqual(left, { d: 0, p: 0, h: 0 });
    return "baseline: delivered D-1 deleted with its packing row and history; the same 10 kg shipped again";
  }
  assert.equal(del.ok, false); assert.match(del.error, /has left the plant/);
  assert.equal(again.ok, false); assert.match(again.error, /exceeds QC-released and packaged output/);
  assert.deepEqual(left, { d: 1, p: 1, h: 1 });
  return `rejected (${del.error}); re-ship still capped`;
});

scenario("G001-in-transit-dispatch-delete", async (ctx, candidate) => {
  await seedPackedJob(ctx, "dispatched");
  await seedDispatch(ctx, "in_transit");
  const del = await attempt(() => ctx.asExec(ids.admin ?? ids.owner, `delete from public.dispatches where id='${D1}'`));
  if (!candidate) { assert.equal(del.ok, true, del.error); return "baseline: in-transit dispatch deleted"; }
  assert.equal(del.ok, false); assert.match(del.error, /has left the plant/);
  return "in-transit dispatch delete rejected";
});

scenario("G001-pending-dispatch-still-deletable", async (ctx) => {
  await seedPackedJob(ctx);
  await seedDispatch(ctx, "pending");
  const del = await attempt(() => ctx.asExec(ids.owner, `delete from public.dispatches where id='${D1}'`));
  assert.equal(del.ok, true, del.error);
  const [n] = await ctx.q(`select count(*)::int n from public.dispatches where id='${D1}'`);
  assert.equal(n.n, 0);
  const again = await reship(ctx, 3);
  assert.equal(again.ok, true, again.error);
  return "a pending dispatch that never left the plant can still be deleted, and its output re-planned";
}, { candidateOnly: true });

scenario("G001-cancelled-invoice-history-blocks-delete", async (ctx) => {
  await seedPackedJob(ctx);
  await seedDispatch(ctx, "pending");
  await ctx.replica(`insert into public.invoices (id, company_id, customer_id, order_id, dispatch_id, invoice_number, invoice_date, due_date, subtotal, tax_total, grand_total, amount_paid, status)
    values ('fe000000-0000-4000-8000-000000000001', '${ids.company}', '${ids.customer}', '${ids.orderB}', '${D1}', 'INV-1', current_date, current_date + 30, 3000, 540, 3540, 0, 'cancelled')`);
  const del = await attempt(() => ctx.asExec(ids.owner, `delete from public.dispatches where id='${D1}'`));
  assert.equal(del.ok, false); assert.match(del.error, /invoice history/);
  return `rejected: ${del.error}`;
}, { candidateOnly: true });

// ---- EXOS-AUD2-005 -------------------------------------------------------
const openBreakdown = (ctx, machine = "PB") => ctx.as(ids.productionManager, `insert into public.breakdown_logs (company_id, machine_id, machine_type, breakdown_date, start_time, issue_description, status, cost, vendor_id, bill_number, bill_date)
  values ('${ids.company}', '${machine}', 'extrusion_press', current_date, now() - interval '5 hours', 'Container liner cracked', 'open', 25000, '${ids.vendor}', 'RB-77', current_date) returning id`);
const signOff = (ctx) => attempt(() => ctx.as(ids.productionManager, `select public.return_machine_to_service_atomic('${ids.pressB}', 'Liner replaced and pressure tested') id`));

scenario("G005-delete-open-breakdown-lifts-lockout", async (ctx, candidate) => {
  const [bd] = await openBreakdown(ctx);
  const del = await attempt(() => ctx.asExec(ids.owner, `delete from public.breakdown_logs where id='${bd.id}'`));
  const so = await signOff(ctx);
  const [m] = await ctx.q(`select status from public.machines where id='${ids.pressB}'`);
  if (!candidate) {
    assert.equal(del.ok, true, del.error); assert.equal(so.ok, true, so.error); assert.equal(m.status, "active");
    return "baseline: open breakdown deleted, press signed back into service with no root cause";
  }
  assert.equal(del.ok, false); assert.match(del.error, /retained as evidence/);
  assert.equal(so.ok, false); assert.match(so.error, /open breakdown/);
  assert.equal(m.status, "breakdown");
  return `delete rejected (${del.error}); sign-off still blocked`;
});

scenario("G005-resolve-then-sign-off-and-audit", async (ctx) => {
  const [bd] = await openBreakdown(ctx);
  await ctx.asExec(ids.productionManager, `update public.breakdown_logs set status='resolved', root_cause='Liner fatigue', action_taken='Liner replaced' where id='${bd.id}'`);
  const so = await signOff(ctx);
  assert.equal(so.ok, true, so.error);
  const audit = await ctx.q(`select action_type, actor_user_id::text actor, actor_role, previous_value ->> 'status' before, new_value ->> 'status' after
    from public.audit_logs_enterprise where entity_id='${bd.id}' and action_type='update_breakdown_logs' and new_value ? 'status'`);
  assert.equal(audit.length, 1, JSON.stringify(audit));
  assert.deepEqual(audit[0], { action_type: "update_breakdown_logs", actor: ids.productionManager, actor_role: "production_manager", before: "open", after: "resolved" });
  return `resolution and sign-off work; audit row ${JSON.stringify(audit[0])}`;
}, { candidateOnly: true });

scenario("G005-delete-calibration-die-correction-schedule", async (ctx, candidate) => {
  const [cal] = await ctx.as(ids.owner, `insert into public.calibration_records (company_id, equipment_name, equipment_id_code, calibration_date, next_due_date, status, calibrated_by)
    values ('${ids.company}', 'Spectrometer', 'SPEC-1', current_date - 400, current_date - 35, 'overdue', 'NABL lab') returning id`);
  const [dc] = await ctx.as(ids.productionManager, `insert into public.die_corrections (company_id, die_id, correction_date, correction_reason, cost, result_status) values ('${ids.company}', '${ids.die}', current_date, 'bearing_issue', 8000, 'failed') returning id`);
  const [ms] = await ctx.as(ids.productionManager, `insert into public.maintenance_schedules (company_id, machine_id, machine_type, maintenance_type, description, frequency_type, frequency_value, last_done_date, status)
    values ('${ids.company}', 'PA', 'extrusion_press', 'preventive', 'Container alignment', 'monthly', 1, current_date - 10, 'scheduled') returning id`);
  const results = {};
  for (const [table, id] of [["calibration_records", cal.id], ["die_corrections", dc.id], ["maintenance_schedules", ms.id]]) {
    results[table] = await attempt(() => ctx.asExec(ids.owner, `delete from public.${table} where id='${id}'`));
  }
  if (!candidate) {
    for (const r of Object.values(results)) assert.equal(r.ok, true, r.error);
    return "baseline: calibration, failed die correction and PM schedule hard-deleted";
  }
  for (const r of Object.values(results)) { assert.equal(r.ok, false); assert.match(r.error, /retained as evidence/); }
  const cancel = await attempt(() => ctx.asExec(ids.productionManager, `update public.maintenance_schedules set status='cancelled' where id='${ms.id}'`));
  assert.equal(cancel.ok, true, cancel.error);
  const fix = await attempt(() => ctx.asExec(ids.productionManager, `update public.die_corrections set result_status='partial' where id='${dc.id}'`));
  assert.equal(fix.ok, true, fix.error);
  const [a] = await ctx.q(`select previous_value ->> 'result_status' before, new_value ->> 'result_status' after from public.audit_logs_enterprise where entity_id='${dc.id}' and action_type='update_die_corrections'`);
  assert.deepEqual(a, { before: "failed", after: "partial" });
  return "deletes rejected; schedule cancelled and die correction corrected with old/new values audited";
});

scenario("G005-spare-part-usage-reversal-still-works", async (ctx) => {
  const [bd] = await openBreakdown(ctx);
  const [part] = await ctx.as(ids.productionManager, `insert into public.maintenance_spare_parts (company_id, part_name, part_code, current_stock, unit) values ('${ids.company}', 'Seal kit', 'SK-1', 10, 'nos') returning id`);
  const [use] = await ctx.as(ids.productionManager, `insert into public.breakdown_spare_part_usage (company_id, breakdown_id, spare_part_id, quantity_used) values ('${ids.company}', '${bd.id}', '${part.id}', 3) returning id`);
  const del = await attempt(() => ctx.asExec(ids.owner, `delete from public.breakdown_spare_part_usage where id='${use.id}'`));
  assert.equal(del.ok, true, del.error);
  const [p] = await ctx.q(`select current_stock::numeric s from public.maintenance_spare_parts where id='${part.id}'`);
  assert.equal(Number(p.s), 10);
  const [a] = await ctx.q(`select count(*)::int n from public.audit_logs_enterprise where entity_id='${use.id}' and action_type='delete_breakdown_spare_part_usage' and previous_value ? 'quantity_used'`);
  assert.equal(a.n, 1);
  return "wrong spare-part usage can still be reversed (stock 7 -> 10) and the reversal is audited";
}, { candidateOnly: true });

// ---- EXOS-AUD2-006 -------------------------------------------------------
const P2 = "f0000000-0000-4000-8000-000000000002", SB = "fb000000-0000-4000-8000-000000000001", RS = "fb100000-0000-4000-8000-000000000001";
const seedStockedProfile = (ctx) => ctx.replica(`
  insert into public.aluminium_profiles (id, company_id, profile_code, profile_name, section_weight_kg_per_m, alloy, temper, standard_length_m, is_active)
    values ('${P2}', '${ids.company}', 'P-200', 'Casement outer frame', 1.2, '6063', 'T6', 5.8, true);
  insert into public.profile_stock_batches (id, company_id, profile_id, finish, length_m, piece_length_m, quantity_pieces, total_weight_kg, status, origin_type, alloy, temper, qc_status, origin_reference)
    values ('${SB}', '${ids.company}', '${P2}', 'mill_finish', 580, 5.8, 100, 696, 'available', 'opening_balance', '6063', 'T6', 'released', 'Opening count 1-Apr');
  insert into public.profile_stock_reservations (id, company_id, profile_stock_batch_id, profile_id, order_id, reserved_weight_kg, reserved_length_m, reserved_pieces, status, initial_reserved_weight_kg, initial_reserved_pieces, initial_reserved_length_m)
    values ('${RS}', '${ids.company}', '${SB}', '${P2}', '${ids.orderA}', 348, 290, 50, 'active', 348, 50, 290)`);

scenario("G006-delete-stocked-profile", async (ctx, candidate) => {
  await seedStockedProfile(ctx);
  const del = await attempt(() => ctx.asExec(ids.owner, `delete from public.aluminium_profiles where id='${P2}'`));
  const [left] = await ctx.q(`select (select count(*) from public.profile_stock_batches where id='${SB}')::int b, (select count(*) from public.profile_stock_reservations where id='${RS}')::int r`);
  if (!candidate) { assert.equal(del.ok, true, del.error); assert.deepEqual(left, { b: 0, r: 0 }); return "baseline: 696 kg stock and a 348 kg reservation erased"; }
  assert.equal(del.ok, false); assert.match(del.error, /finished-goods stock; deactivate it/);
  assert.deepEqual(left, { b: 1, r: 1 });
  const deact = await attempt(() => ctx.asExec(ids.owner, `update public.aluminium_profiles set is_active=false where id='${P2}'`));
  assert.equal(deact.ok, true, deact.error);
  return `rejected (${del.error}); deactivation works`;
});

scenario("G006-fk-blocks-direct-cascade", async (ctx) => {
  // Even without the guard's user-session check (service context), stock now blocks the delete.
  await seedStockedProfile(ctx);
  const del = await attempt(() => ctx.db.query(`delete from public.aluminium_profiles where id='${P2}'`));
  assert.equal(del.ok, false); assert.match(del.error, /foreign key/);
  return `service-context delete blocked by FK: ${del.error.slice(0, 90)}`;
}, { candidateOnly: true });

scenario("G006-unused-profile-deletable", async (ctx) => {
  await ctx.replica(`insert into public.aluminium_profiles (id, company_id, profile_code, profile_name, section_weight_kg_per_m, is_active) values ('${P2}', '${ids.company}', 'P-TYPO', 'Typo profile', 1, true);
    insert into public.profile_defect_rules (company_id, profile_id, defect_type, severity) values ('${ids.company}', '${P2}', 'die_line', 'minor')`);
  const del = await attempt(() => ctx.asExec(ids.owner, `delete from public.aluminium_profiles where id='${P2}'`));
  assert.equal(del.ok, true, del.error);
  return "a profile with only configuration children can still be deleted";
}, { candidateOnly: true });

// ---- EXOS-AUD2-004 -------------------------------------------------------
const EXT = "9a000000-0000-4000-8000-000000000003", HUGE = "9a000000-0000-4000-8000-000000000001";
const receive = (ctx, kg = 2000, rate = 200) => ctx.asExec(ids.productionManager, `insert into public.foundry_external_aluminium_sources (id, company_id, item_type, quantity, weight_kg, vendor_id, source_origin, received_date, alloy, status, rate, invoice_number, invoice_date)
  values ('${EXT}', '${ids.company}', 'aluminum_ingot', 1, ${kg}, '${ids.vendor}', 'purchased', current_date, '6063', 'available', ${rate}, 'VB-1', current_date)`);
const charge = (n) => `insert into public.foundry_batches (company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, status, batch_sequence, production_date, external_source_id, furnace_efficiency_percent)
  values ('${ids.company}', 'FB-G-${n}', 'F1', '6063', 'T6', 1000, 101.6, 4, ${n}, 2700, 0, 100, 'planned', ${n}, current_date, '${EXT}', 100)`;
const dispose = (ctx, user, disposition, reason = "Spectro Fe 0.6% out of spec", table = "foundry_external_aluminium_sources", id = EXT) =>
  attempt(() => ctx.as(user, `select public.set_metal_source_disposition('${table}', '${id}', '${disposition}', '${reason}') r`));
const lot = async (ctx, id = EXT) => (await ctx.q(`select s.status, s.available_weight_kg::numeric avail, i.current_stock::numeric stock from public.foundry_external_aluminium_sources s left join public.inventory_items i on i.id=s.inventory_item_id where s.id='${id}'`))[0];

scenario("G004-operator-releases-rejected-lot", async (ctx, candidate) => {
  await receive(ctx);
  if (candidate) assert.equal((await dispose(ctx, ids.productionManager, "hold")).ok, true);
  else await ctx.asExec(ids.productionManager, `update public.foundry_external_aluminium_sources set status='rejected' where id='${EXT}'`);
  const flip = await attempt(() => ctx.asExec(ids.production, `update public.foundry_external_aluminium_sources set status='available' where id='${EXT}'`));
  const c = await attempt(() => ctx.asExec(ids.production, charge(42)));
  if (!candidate) { assert.equal(flip.ok, true, flip.error); assert.equal(c.ok, true, c.error); return "baseline: operator released the rejected lot and charged it"; }
  assert.equal(flip.ok, false); assert.match(flip.error, /lot disposition/);
  assert.equal(c.ok, false); assert.match(c.error, /not usable/);
  assert.equal((await lot(ctx)).status, "rejected");
  return `operator flip rejected (${flip.error}); charge refused`;
});

scenario("G004-hold-release-segregation-and-audit", async (ctx) => {
  await receive(ctx);
  const op = await dispose(ctx, ids.production, "hold");
  assert.equal(op.ok, false); assert.match(op.error, /cannot hold/);
  assert.equal((await dispose(ctx, ids.productionManager, "hold")).ok, true);
  const self = await dispose(ctx, ids.productionManager, "release", "Retest passed SPEC-90");
  assert.equal(self.ok, false); assert.match(self.error, /cannot release|someone other/);
  const short = await dispose(ctx, ids.quality, "release", "ok");
  assert.equal(short.ok, false); assert.match(short.error, /at least 10/);
  const rel = await dispose(ctx, ids.quality, "release", "Retest passed SPEC-90");
  assert.equal(rel.ok, true, rel.error);
  assert.equal((await lot(ctx)).status, "available");
  const c = await attempt(() => ctx.asExec(ids.production, charge(42)));
  assert.equal(c.ok, true, c.error);
  assert.equal((await lot(ctx)).status, "reserved");
  const log = await ctx.q(`select disposition, from_status, to_status, recorded_by_role from public.metal_source_dispositions where source_id='${EXT}' order by recorded_at`);
  assert.deepEqual(log.map((r) => `${r.disposition}:${r.from_status}->${r.to_status}:${r.recorded_by_role}`), ["hold:available->rejected:production_manager", "release:rejected->available:quality"]);
  const audit = await ctx.q(`select previous_value ->> 'status' before, new_value ->> 'status' after, actor_role from public.audit_logs_enterprise where entity_id='${EXT}' and action_type='update_foundry_external_aluminium_sources' and new_value ? 'status' order by timestamp, created_at`);
  assert.ok(audit.some((a) => a.before === "available" && a.after === "rejected" && a.actor_role === "production_manager"), JSON.stringify(audit));
  return `operator hold refused; holder cannot release; quality release then charge works; log ${JSON.stringify(log.map((r) => r.disposition))}`;
}, { candidateOnly: true });

scenario("G004-release-implausible-held-lot", async (ctx, candidate) => {
  await ctx.replica(`insert into public.foundry_external_aluminium_sources (id, company_id, source_number, item_type, quantity, weight_kg, available_weight_kg, vendor_id, source_origin, received_date, alloy, status, notes)
    values ('${HUGE}', '${ids.company}', 'EAS-X', 'aluminum_ingot', 1, 100000000, 99994001.119, '${ids.vendor}', 'purchased', current_date, '6063', 'rejected', 'Held: implausible receipt')`);
  if (!candidate) {
    const flip = await attempt(() => ctx.asExec(ids.production, `update public.foundry_external_aluminium_sources set status='available' where id='${HUGE}'`));
    assert.equal(flip.ok, true, flip.error);
    return "baseline: the held 100,000 t lot was set available by an operator";
  }
  const rel = await dispose(ctx, ids.quality, "release", "Released for production use", "foundry_external_aluminium_sources", HUGE);
  assert.equal(rel.ok, false); assert.match(rel.error, /receipt limit/);
  return `release refused: ${rel.error}`;
});

scenario("G004-return-to-vendor", async (ctx, candidate) => {
  await receive(ctx, 1000, 200);
  if (!candidate) {
    await ctx.asExec(ids.production, `update public.foundry_external_aluminium_sources set status='returned' where id='${EXT}'`);
    const r = await lot(ctx);
    assert.equal(Number(r.stock), 1000);
    const back = await attempt(() => ctx.asExec(ids.production, `update public.foundry_external_aluminium_sources set status='available' where id='${EXT}'`));
    assert.equal(back.ok, true, back.error);
    return "baseline: 'returned' lot kept 1,000 kg in inventory and was flipped back to available";
  }
  const ret = await dispose(ctx, ids.productionManager, "return", "Returned to vendor, gate pass GP-17");
  assert.equal(ret.ok, true, ret.error);
  assert.deepEqual({ ...(ret.value[0].r) }, { id: ret.value[0].r.id, lot: ret.value[0].r.lot, status: "returned", returned_kg: 1000, credit_due_amount: 200000 });
  const r = await lot(ctx);
  assert.equal(r.status, "returned"); assert.equal(Number(r.avail), 0); assert.equal(Number(r.stock), 0);
  const [mv] = await ctx.q(`select movement_type, quantity::numeric q from public.inventory_movements where reference_id='${EXT}' and movement_type='purchase_return'`);
  assert.equal(Number(mv.q), 1000);
  const back = await attempt(() => ctx.asExec(ids.production, `update public.foundry_external_aluminium_sources set status='available' where id='${EXT}'`));
  assert.equal(back.ok, false); assert.match(back.error, /final/);
  const again = await dispose(ctx, ids.quality, "release", "Material came back from vendor");
  assert.equal(again.ok, false); assert.match(again.error, /returned to the vendor/);
  const c = await attempt(() => ctx.asExec(ids.production, charge(40)));
  assert.equal(c.ok, false);
  const [d] = await ctx.q(`select returned_kg::numeric kg, credit_due_amount::numeric credit, expense_ledger_id is not null has_expense from public.metal_source_dispositions where source_id='${EXT}' and disposition='return'`);
  assert.deepEqual([Number(d.kg), Number(d.credit), d.has_expense], [1000, 200000, true]);
  return "return emptied the lot (purchase_return 1,000 kg, inventory 0), recorded ₹2,00,000 credit due against the bill, and is final";
});

scenario("G004-partly-charged-lot-return", async (ctx) => {
  await receive(ctx, 2000, 200);
  assert.equal((await attempt(() => ctx.asExec(ids.production, charge(42)))).ok, true);
  const before = await lot(ctx);
  const ret = await dispose(ctx, ids.factoryManager, "return", "Balance returned, supplier recall");
  assert.equal(ret.ok, true, ret.error);
  const after = await lot(ctx);
  assert.equal(after.status, "returned"); assert.equal(Number(after.avail), 0);
  assert.equal(Number(ret.value[0].r.returned_kg), Number(before.avail));
  assert.equal(Number(after.stock), 0);
  return `only the unused ${before.avail} kg was returned; the charged metal stays with its batch`;
}, { candidateOnly: true });

scenario("G004-client-weight-correction-unchanged", async (ctx) => {
  await receive(ctx, 1000, 200);
  const fix = await attempt(() => ctx.asExec(ids.productionManager, `update public.foundry_external_aluminium_sources set weight_kg=1010, weighbridge_reference='WB-9' where id='${EXT}'`));
  assert.equal(fix.ok, true, fix.error);
  const r = await lot(ctx);
  assert.deepEqual([r.status, Number(r.avail), Number(r.stock)], ["available", 1010, 1010]);
  const [a] = await ctx.q(`select previous_value ->> 'weight_kg' before, new_value ->> 'weight_kg' after from public.audit_logs_enterprise where entity_id='${EXT}' and action_type='update_foundry_external_aluminium_sources' and new_value ? 'weight_kg'`);
  assert.deepEqual([Number(a.before), Number(a.after)], [1000, 1010]);
  return "received-weight correction still flows to availability and inventory, now audited";
}, { candidateOnly: true });

scenario("G004-in-house-scrap-cannot-be-returned", async (ctx) => {
  const S = "9a000000-0000-4000-8000-000000000009";
  await ctx.replica(`insert into public.foundry_aluminium_scrap (id, company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, scrap_quality, status, alloy, scrap_category) values ('${S}', '${ids.company}', 'SCR-IH', 'in_house', 50, 50, 'clean', 'available', '6063', 'butt_end')`);
  const ret = await dispose(ctx, ids.productionManager, "return", "Return to vendor attempt", "foundry_aluminium_scrap", S);
  assert.equal(ret.ok, false); assert.match(ret.error, /In-house scrap/);
  const hold = await dispose(ctx, ids.productionManager, "hold", "Contaminated with steel inserts", "foundry_aluminium_scrap", S);
  assert.equal(hold.ok, true, hold.error);
  return "in-house scrap can be held, not returned";
}, { candidateOnly: true });

// ---- runner ----------------------------------------------------------------
let failed = 0, passed = 0;
for (const s of scenarios) {
  if (ONLY.length && !ONLY.some((prefix) => s.id.startsWith(prefix))) continue;
  for (const candidate of s.candidateOnly ? [true] : [false, true]) {
    const label = candidate ? "candidate" : "baseline";
    try {
      const ctx = await current({ candidate });
      const note = await s.run(ctx, candidate);
      await ctx.db.close();
      passed++;
      console.log(`PASS ${s.id} [${label}]: ${note}`);
    } catch (error) {
      failed++;
      console.log(`FAIL ${s.id} [${label}]: ${error.message}`);
    }
  }
}
console.log(failed ? `GATE FAILED (${failed} failed, ${passed} passed)` : `GATE PASSED (${passed}/${passed})`);
if (failed) process.exitCode = 1;
