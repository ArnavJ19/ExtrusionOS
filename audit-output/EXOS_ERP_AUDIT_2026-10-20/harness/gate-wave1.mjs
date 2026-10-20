// Wave 1 regression gate for EXOS-AUD-009 / 002 / 003.
// Each scenario runs twice on a fresh replica of the live catalog:
//   baseline  = live snapshot only          -> the defect must still reproduce
//   candidate = snapshot + Wave 1 migrations -> the defect is fixed and legitimate flows still work
// Run from the codex/v1 root: node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/gate-wave1.mjs
import assert from "node:assert/strict";
import { createLiveCatalogDb } from "./live-catalog-db.mjs";
import { ids, seed } from "./seed.mjs";

const WAVE1 = [
  "supabase/migrations/20261021000000_order_stage_allocation_side_effect.sql",
  "supabase/migrations/20261021010000_scrap_and_foundry_source_write_guards.sql",
  "supabase/migrations/20261021020000_machine_and_die_status_authority.sql",
  "supabase/migrations/20261021030000_dispatch_logistics_freeze.sql",
];

const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error: error.message }; } };

async function fresh(candidate) {
  const { db } = await createLiveCatalogDb({ migrations: candidate ? WAVE1 : [] });
  await seed(db);
  const q = async (sql) => (await db.query(sql)).rows;
  const replica = (sql) => db.exec(`set session_replication_role = replica; ${sql}; set session_replication_role = origin;`);
  const as = async (userId, sql) => {
    await db.exec(`select set_config('audit.uid','${userId}',false); set role authenticated;`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
  };
  return { db, q, replica, as };
}

const lineA = "f5000000-0000-4000-8000-000000000001";
const fb = "f7000000-0000-4000-8000-000000000001";
const req = "f7100000-0000-4000-8000-000000000001";
const billet = "f7200000-0000-4000-8000-000000000001";

// Dispatched shipment for order A plus a pending billet requirement and one free cast billet.
async function seedDispatchedOrder(ctx, dispatchId) {
  await ctx.replica(`
    update public.orders set current_stage='packing' where id='${ids.orderA}';
    insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status, actual_dispatched_at, eway_bill_number, vehicle_number, transporter_name)
      values ('${dispatchId}', '${ids.company}', '${ids.orderA}', 'D-${dispatchId.slice(-4)}', current_date, 1, 10, 0, 'dispatched', now(), 'EWB-111', 'MH01AB1234', 'Shree Roadlines');
    insert into public.foundry_batches (id, company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, status, billet_weight_density_kg, batch_sequence, production_date)
      values ('${fb}', '${ids.company}', 'FB-G', 'F1', '6063', 'T6', 1000, 101.6, 4, 1, 2700, 0, 100, 'ready', 21.89, 9, current_date);
    insert into public.order_billet_requirements (id, company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billets_required, status)
      values ('${req}', '${ids.company}', '${ids.orderA}', '${ids.profile}', '6063', 'T6', 4, 1, 'pending');
    insert into public.foundry_billets (id, company_id, source_type, foundry_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status)
      values ('${billet}', '${ids.company}', 'in_house', '${fb}', 'F1-G-1', 1, 4, 101.6, 1000, '6063', 'T6', 21.89, 'cast');
    -- Physically valid manifest so delivery transitions pass private.assert_dispatch_ready.
    insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, net_rate, gst_percent) values ('${lineA}', '${ids.company}', '${ids.orderA}', '${ids.profile}', 1000, 300, 18);
    insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, status, planned_quantity_kg, actual_quantity_kg, actual_pieces, actual_meters, finishing_type, completed_at)
      values ('${ids.jobB}', '${ids.company}', 'J-Q', '${ids.orderA}', '${ids.profile}', '${ids.die}', '${lineA}', 'completed', 10, 10, 2, 10, 'mill_finish', now());
    insert into public.quality_inspections (company_id, production_job_id, profile_id, quantity_checked_kg, status, inspector_name, surface_finish_ok) values ('${ids.company}', '${ids.jobB}', '${ids.profile}', 10, 'approved', 'QC', true);
    insert into public.packaging_materials (id, company_id, material_code, material_name, material_type, consumption_rate, calculation_method) values ('f8300000-0000-4000-8000-000000000001', '${ids.company}', 'PM1', 'Wrap', 'stretch_film', 1, 'fixed');
    insert into public.packaging_jobs (id, company_id, packaging_number, order_id, production_job_id, status, profile_weight_kg) values ('f8400000-0000-4000-8000-000000000001', '${ids.company}', 'PK1', '${ids.orderA}', '${ids.jobB}', 'completed', 10);
    insert into public.packaging_job_materials (company_id, job_id, material_id, quantity_required) values ('${ids.company}', 'f8400000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 1);
    insert into public.packing_list_items (company_id, dispatch_id, profile_id, bundle_number, source_kind, source_record_id, source_line_id, number_of_pieces, net_length_m, gross_weight_kg, tare_weight_kg, operator_verified_at, operator_verified_by, order_item_id, net_rate, gst_percent)
      values ('${ids.company}', '${dispatchId}', '${ids.profile}', 'B1', 'production', '${ids.orderA}', '${ids.jobB}', 2, 10, 10, 0, now(), '${ids.dispatch}', '${lineA}', 300, 18)`);
}

const scenarios = [];
const scenario = (id, finding, run) => scenarios.push({ id, finding, run });

// ---- EXOS-AUD-009 -------------------------------------------------------
for (const [role, user] of [["dispatch", ids.dispatch], ["dispatch_manager", ids.dispatchManager], ["inventory_manager", ids.inventoryManager]]) {
  scenario(`G009-${role}-delivery-update`, "009", async (ctx, candidate) => {
    const d = "f6300000-0000-4000-8000-00000000000" + { dispatch: 1, dispatch_manager: 2, inventory_manager: 3 }[role];
    await seedDispatchedOrder(ctx, d);
    const r = await attempt(() => ctx.as(user, `select public.transition_dispatch_delivery_atomic('${d}','in_transit',null,'truck left') x`));
    const [order] = await ctx.q(`select current_stage from public.orders where id='${ids.orderA}'`);
    const [b] = await ctx.q(`select status from public.foundry_billets where id='${billet}'`);
    if (!candidate) { assert.equal(r.ok, false); assert.match(r.error, /allocate billets/); return `baseline blocked: ${r.error}`; }
    assert.equal(r.ok, true, r.error);
    assert.equal(order.current_stage, "dispatched");
    assert.equal(b.status, "cast", "allocation is deferred for non-factory callers");
    return `in_transit recorded; order dispatched; allocation deferred (billet ${b.status})`;
  });
}

// Factory roles keep the pre-fix behavior: same transition, same allocation outcome in both builds.
const factoryOutcome = {};
scenario("G009-factory-stage-change-unchanged", "009", async (ctx, candidate) => {
  const d = "f6300000-0000-4000-8000-000000000009";
  await seedDispatchedOrder(ctx, d);
  const r = await attempt(() => ctx.as(ids.owner, `select public.transition_dispatch_delivery_atomic('${d}','in_transit',null,'owner') x`));
  assert.equal(r.ok, true, r.error);
  const [order] = await ctx.q(`select current_stage from public.orders where id='${ids.orderA}'`);
  const reqs = await ctx.q(`select status, billets_allocated from public.order_billet_requirements where order_id='${ids.orderA}' order by id`);
  const [b] = await ctx.q(`select status from public.foundry_billets where id='${billet}'`);
  const outcome = JSON.stringify({ stage: order.current_stage, billet: b.status, reqs });
  factoryOutcome[candidate ? "candidate" : "baseline"] = outcome;
  if (candidate) assert.equal(outcome, factoryOutcome.baseline, "owner path must behave exactly as before");
  return `owner transition ok; outcome ${outcome}`;
});

scenario("G009-sales-quote-conversion", "009", async (ctx, candidate) => {
  const quote = "fa000000-0000-4000-8000-000000000001";
  await ctx.replica(`
    insert into public.quotes (id, company_id, quote_number, customer_id, quote_date, status, gst_percent) values ('${quote}', '${ids.company}', 'Q-G', '${ids.customer}', current_date, 'customer_approved', 18);
    insert into public.quote_items (company_id, quote_id, profile_id, quantity_pieces, length_per_piece_m, section_weight_kg_per_m, total_meters, total_weight_kg, billing_weight_kg, line_total_before_gst, net_rate, gst_percent, drawing_approval_status, finishing_type)
      values ('${ids.company}', '${quote}', '${ids.profile}', 172, 5.8, 1, 997.6, 997.6, 997.6, 299280, 300, 18, 'Approved', 'mill_finish')`);
  const r = await attempt(() => ctx.as(ids.sales, `select public.convert_quote_to_order_atomic('${quote}', '{"order_date":"2026-10-21","priority":"normal"}'::jsonb) id`));
  if (!candidate) {
    assert.equal(r.ok, false, "baseline sales conversion expected to fail");
    return `baseline blocked: ${r.error}`;
  }
  assert.equal(r.ok, true, r.error);
  const [req2] = await ctx.q(`select count(*)::int n from public.order_billet_requirements where order_id='${r.value[0].id}'`);
  return `sales converted the quote; ${req2.n} billet requirement row(s) rebuilt, allocation deferred`;
});

// ---- EXOS-AUD-002 -------------------------------------------------------
scenario("G002-viewer-scrap-insert", "002", async (ctx, candidate) => {
  const r = await attempt(() => ctx.as(ids.viewer, `insert into public.scrap_records (company_id, scrap_type, weight_kg) values ('${ids.company}', 'process_scrap', 5000) returning id`));
  const [lots] = await ctx.q(`select count(*)::int n from public.foundry_aluminium_scrap`);
  if (!candidate) { assert.equal(r.ok, true); assert.equal(lots.n, 1); return "baseline: viewer created a 5000 kg lot"; }
  assert.equal(r.ok, false); assert.equal(lots.n, 0);
  return `rejected: ${r.error}`;
});

scenario("G002-production-scrap-insert", "002", async (ctx, candidate) => {
  const r = await attempt(() => ctx.as(ids.production, `insert into public.scrap_records (company_id, production_job_id, scrap_type, weight_kg) values ('${ids.company}', null, 'process_scrap', 300) returning id`));
  if (!candidate) { assert.equal(r.ok, true); return "baseline: production created unlinked scrap"; }
  assert.equal(r.ok, false);
  return `rejected: ${r.error}`;
});

scenario("G002-completion-still-books-scrap", "002", async (ctx) => {
  await ctx.replica(`
    insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, quantity_pieces, length_per_piece_m, net_rate, gst_percent, finishing_type)
      values ('${lineA}', '${ids.company}', '${ids.orderA}', '${ids.profile}', 1000, 172, 5.8, 300, 18, 'mill_finish');
    insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, source_record_id, status, planned_quantity_kg, pieces, length_per_piece_m, extrusion_efficiency_percent, finishing_type, machine_id)
      values ('${ids.jobA}', '${ids.company}', 'J-A', '${ids.orderA}', '${ids.profile}', '${ids.die}', '${lineA}', '${ids.orderA}', 'in_progress', 1000, 172, 5.8, 85, 'mill_finish', '${ids.pressA}');
    insert into public.production_plan_slots (company_id, production_job_id, machine_id, planned_start_at, planned_end_at, status) values ('${ids.company}', '${ids.jobA}', '${ids.pressA}', now(), now() + interval '4 hours', 'released')`);
  const r = await attempt(() => ctx.as(ids.production, `select public.complete_production_job_atomic('${ids.jobA}', 600, 100, null, 400, 'loss') id`));
  assert.equal(r.ok, true, r.error);
  const lots = await ctx.q(`select weight_kg, available_weight_kg, status from public.foundry_aluminium_scrap where origin_reference like '%${ids.jobA}%'`);
  assert.equal(lots.length, 1);
  assert.equal(Number(lots[0].available_weight_kg), 400);
  return `completion posted 400 kg process scrap -> ${JSON.stringify(lots[0])}`;
});

// ---- EXOS-AUD-003 -------------------------------------------------------
const usedLot = "99999999-0000-4000-8000-000000000001";
const seedUsedLot = (ctx) => ctx.replica(`insert into public.foundry_aluminium_scrap (id, company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, scrap_quality, status, vendor_id, notes)
  values ('${usedLot}', '${ids.company}', 'SCR-G', 'incoming', 1000, 0, 'clean', 'used', '${ids.vendor}', 'fully charged')`);
const lot = async (ctx) => (await ctx.q(`select weight_kg::numeric w, available_weight_kg::numeric a, status from public.foundry_aluminium_scrap where id='${usedLot}'`))[0];

scenario("G003-direct-availability-inflation", "003", async (ctx, candidate) => {
  await seedUsedLot(ctx);
  const r = await attempt(() => ctx.as(ids.production, `update public.foundry_aluminium_scrap set available_weight_kg = 25000, status = 'available' where id = '${usedLot}'`));
  const row = await lot(ctx);
  if (!candidate) { assert.equal(Number(row.a), 25000); return "baseline: available 25000"; }
  assert.equal(r.ok, true, r.error); assert.equal(Number(row.a), 0); assert.equal(row.status, "used");
  return `client value ignored -> ${JSON.stringify(row)}`;
});

scenario("G003-form-edit-resurrection", "003", async (ctx, candidate) => {
  await seedUsedLot(ctx);
  // Old record-form payload for an edit: available_weight_kg = weight_kg because 0 was falsy.
  await attempt(() => ctx.as(ids.production, `update public.foundry_aluminium_scrap set notes='typo fixed', available_weight_kg = weight_kg, status='used' where id='${usedLot}'`));
  const row = await lot(ctx);
  if (!candidate) { assert.equal(Number(row.a), 1000); return "baseline: resurrected to 1000"; }
  assert.equal(Number(row.a), 0); assert.equal(row.status, "used");
  return `used lot stays used -> ${JSON.stringify(row)}`;
});

scenario("G003-weight-correction-moves-balance", "003", async (ctx) => {
  await seedUsedLot(ctx);
  const up = await attempt(() => ctx.as(ids.production, `update public.foundry_aluminium_scrap set weight_kg = 1500 where id='${usedLot}'`));
  assert.equal(up.ok, true, up.error);
  const afterUp = await lot(ctx);
  assert.equal(Number(afterUp.a), 500); assert.equal(afterUp.status, "reserved");
  const down = await attempt(() => ctx.as(ids.production, `update public.foundry_aluminium_scrap set weight_kg = 900 where id='${usedLot}'`));
  assert.equal(down.ok, false, "weight below charged quantity must be rejected");
  const hold = await attempt(() => ctx.as(ids.production, `update public.foundry_aluminium_scrap set status = 'rejected' where id='${usedLot}'`));
  assert.equal(hold.ok, true, hold.error);
  return `+500 kg receipt correction -> ${JSON.stringify(afterUp)}; below-charged rejected (${down.error}); rejected hold allowed`;
});

scenario("G003-insert-forces-full-availability", "003", async (ctx, candidate) => {
  const r = await attempt(() => ctx.as(ids.production, `insert into public.foundry_external_aluminium_sources (company_id, source_number, item_type, weight_kg, available_weight_kg, source_origin, alloy, status, quantity, vendor_id)
    values ('${ids.company}', 'EAS-G', 'aluminum_ingot', 100, 99999, 'import', '6063', 'available', 1, '${ids.vendor}') returning available_weight_kg`));
  if (!candidate) { assert.equal(r.ok, true); assert.equal(Number(r.value[0].available_weight_kg), 99999); return "baseline: available 99999 on a 100 kg receipt"; }
  assert.equal(r.ok, true, r.error); assert.equal(Number(r.value[0].available_weight_kg), 100);
  const used = await attempt(() => ctx.as(ids.production, `insert into public.foundry_external_aluminium_sources (company_id, source_number, item_type, weight_kg, source_origin, alloy, status, quantity, vendor_id)
    values ('${ids.company}', 'EAS-G2', 'aluminum_ingot', 100, 'import', '6063', 'used', 1, '${ids.vendor}')`));
  assert.equal(used.ok, false);
  return "receipt availability forced to 100 kg; 'used' receipt rejected";
});

scenario("G003-furnace-charge-and-cancel-still-work", "003", async (ctx) => {
  const src = "99999999-0000-4000-8000-000000000004";
  await ctx.replica(`insert into public.foundry_external_aluminium_sources (id, company_id, source_number, item_type, weight_kg, available_weight_kg, source_origin, alloy, status, quantity, vendor_id)
    values ('${src}', '${ids.company}', 'EAS-C', 'aluminum_ingot', 10000, 10000, 'import', '6063', 'available', 10, '${ids.vendor}')`);
  const ins = await attempt(() => ctx.as(ids.productionManager, `insert into public.foundry_batches (company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, external_source_id, furnace_efficiency_percent, production_date, status, created_by)
    values ('${ids.company}', 'FB-C', 'F2', '6063', 'T6', 1000, 101.6, 4, 10, 2700, 0, 100, '${src}', 80, current_date, 'planned', '${ids.productionManager}') returning id`));
  assert.equal(ins.ok, true, ins.error);
  const [charged] = await ctx.q(`select available_weight_kg::numeric a, status from public.foundry_external_aluminium_sources where id='${src}'`);
  assert.ok(Number(charged.a) < 10000 && charged.status === "reserved", JSON.stringify(charged));
  const cancel = await attempt(() => ctx.as(ids.productionManager, `update public.foundry_batches set status='cancelled' where id='${ins.value[0].id}'`));
  assert.equal(cancel.ok, true, cancel.error);
  const [refunded] = await ctx.q(`select available_weight_kg::numeric a, status from public.foundry_external_aluminium_sources where id='${src}'`);
  assert.equal(Number(refunded.a), 10000); assert.equal(refunded.status, "available");
  return `charge debited to ${charged.a} (${charged.status}); cancel refunded to ${refunded.a}`;
});

// ---- EXOS-AUD-008 -------------------------------------------------------
const pressStatus = async (ctx) => (await ctx.q(`select status from public.machines where id='${ids.pressB}'`))[0].status;
const dieStatus = async (ctx) => (await ctx.q(`select die_status from public.dies where id='${ids.die}'`))[0].die_status;

scenario("G008-viewer-returns-broken-press", "008", async (ctx, candidate) => {
  await ctx.replica(`update public.machines set status='breakdown' where id='${ids.pressB}'`);
  await attempt(() => ctx.as(ids.viewer, `update public.machines set status='idle' where id='${ids.pressB}'`));
  const status = await pressStatus(ctx);
  if (!candidate) { assert.equal(status, "idle"); return "baseline: viewer moved press to idle"; }
  assert.equal(status, "breakdown");
  return "viewer update affected no rows; press stays in breakdown";
});

scenario("G008-production-manager-returns-press", "008", async (ctx) => {
  await ctx.replica(`update public.machines set status='breakdown' where id='${ids.pressB}'`);
  const r = await attempt(() => ctx.as(ids.productionManager, `update public.machines set status='active' where id='${ids.pressB}' returning status`));
  assert.equal(r.ok, true, r.error); assert.equal(r.value[0]?.status, "active");
  const bad = await attempt(() => ctx.as(ids.productionManager, `update public.machines set status='running fine' where id='${ids.pressB}'`));
  assert.equal(bad.ok, false);
  return `production manager returned press to active; free-text status rejected (${bad.error})`;
});

scenario("G008-sales-reactivates-retired-die", "008", async (ctx, candidate) => {
  await ctx.replica(`update public.dies set die_status='retired' where id='${ids.die}'`);
  const r = await attempt(() => ctx.as(ids.sales, `update public.dies set die_status='active' where id='${ids.die}'`));
  const status = await dieStatus(ctx);
  if (!candidate) { assert.equal(status, "active"); return "baseline: sales reactivated the die"; }
  assert.equal(r.ok, false); assert.equal(status, "retired");
  return `rejected: ${r.error}`;
});

scenario("G008-sales-manager-rpc-reactivates-die", "008", async (ctx, candidate) => {
  await ctx.replica(`update public.dies set die_status='retired' where id='${ids.die}'`);
  const r = await attempt(() => ctx.as(ids.salesManager, `select public.update_versioned_entity_atomic('die','${ids.die}','{"die_status":"active","notes":"reactivate"}'::jsonb) rev`));
  const status = await dieStatus(ctx);
  if (!candidate) { assert.equal(status, "active"); return "baseline: sales manager reactivated the die via RPC"; }
  assert.equal(r.ok, false); assert.equal(status, "retired");
  const notes = await attempt(() => ctx.as(ids.salesManager, `select public.update_versioned_entity_atomic('die','${ids.die}','{"notes":"customer owned"}'::jsonb) rev`));
  assert.equal(notes.ok, true, notes.error);
  return `status change rejected (${r.error}); commercial edit still allowed`;
});

scenario("G008-operator-out-of-service-only", "008", async (ctx) => {
  const out = await attempt(() => ctx.as(ids.production, `update public.dies set die_status='under_correction' where id='${ids.die}'`));
  assert.equal(out.ok, true, out.error); assert.equal(await dieStatus(ctx), "under_correction");
  const back = await attempt(() => ctx.as(ids.production, `update public.dies set die_status='active' where id='${ids.die}'`));
  assert.equal(back.ok, false); assert.equal(await dieStatus(ctx), "under_correction");
  const manager = await attempt(() => ctx.as(ids.productionManager, `update public.dies set die_status='active' where id='${ids.die}'`));
  assert.equal(manager.ok, true, manager.error); assert.equal(await dieStatus(ctx), "active");
  return "operator took die out of service; only the production manager returned it";
});

scenario("G008-sales-manager-registers-die", "008", async (ctx) => {
  const ok = await attempt(() => ctx.as(ids.salesManager, `insert into public.dies (company_id, die_number, profile_id, die_status) values ('${ids.company}', 'D-NEW', '${ids.profile}', 'ordered')`));
  assert.equal(ok.ok, true, ok.error);
  const usable = await attempt(() => ctx.as(ids.salesManager, `insert into public.dies (company_id, die_number, profile_id, die_status) values ('${ids.company}', 'D-NEW2', '${ids.profile}', 'active')`));
  assert.equal(usable.ok, false);
  return `ordered die registered; usable die rejected (${usable.error})`;
});

// ---- EXOS-AUD-011 -------------------------------------------------------
const dispatchRow = async (ctx, d) => (await ctx.q(`select delivery_status, eway_bill_number, vehicle_number, lr_number, transporter_name from public.dispatches where id='${d}'`))[0];

scenario("G011-viewer-rewrites-shipped-dispatch", "011", async (ctx, candidate) => {
  const d = "f8000000-0000-4000-8000-000000000001";
  await seedDispatchedOrder(ctx, d);
  // Order already 'dispatched', so the baseline is not masked by the EXOS-AUD-009 veto.
  await ctx.replica(`update public.orders set current_stage='dispatched' where id='${ids.orderA}'`);
  await attempt(() => ctx.as(ids.viewer, `update public.dispatches set eway_bill_number='EWB-999', vehicle_number='XX00ZZ0000', lr_number='LR-FAKE' where id='${d}'`));
  await attempt(() => ctx.as(ids.viewer, `update public.dispatches set delivery_status='returned', remarks='viewer' where id='${d}'`));
  const row = await dispatchRow(ctx, d);
  if (!candidate) { assert.equal(row.delivery_status, "returned"); assert.equal(row.eway_bill_number, "EWB-999"); return "baseline: viewer rewrote documents and returned the shipment"; }
  assert.equal(row.delivery_status, "dispatched"); assert.equal(row.eway_bill_number, "EWB-111");
  return `viewer writes affected no rows -> ${JSON.stringify(row)}`;
});

scenario("G011-dispatch-role-document-freeze", "011", async (ctx, candidate) => {
  const d = "f8000000-0000-4000-8000-000000000002";
  await seedDispatchedOrder(ctx, d);
  const change = await attempt(() => ctx.as(ids.dispatch, `update public.dispatches set eway_bill_number='EWB-999' where id='${d}'`));
  const fill = await attempt(() => ctx.as(ids.dispatch, `update public.dispatches set lr_number='LR-778' where id='${d}'`));
  const row = await dispatchRow(ctx, d);
  if (!candidate) { assert.equal(row.eway_bill_number, "EWB-999"); return "baseline: shipped e-way bill rewritten by dispatch role"; }
  assert.equal(change.ok, false); assert.equal(fill.ok, true, fill.error);
  assert.equal(row.eway_bill_number, "EWB-111"); assert.equal(row.lr_number, "LR-778");
  return `recorded e-way bill frozen (${change.error}); late LR number filled`;
});

scenario("G011-status-only-through-workflow", "011", async (ctx, candidate) => {
  const d = "f8000000-0000-4000-8000-000000000003";
  await seedDispatchedOrder(ctx, d);
  // Order already 'dispatched', so the baseline is not masked by the EXOS-AUD-009 veto.
  await ctx.replica(`update public.orders set current_stage='dispatched' where id='${ids.orderA}'`);
  const direct = await attempt(() => ctx.as(ids.dispatch, `update public.dispatches set delivery_status='returned' where id='${d}'`));
  const afterDirect = (await dispatchRow(ctx, d)).delivery_status;
  if (!candidate) { assert.equal(afterDirect, "returned"); return "baseline: direct table return accepted"; }
  assert.equal(direct.ok, false); assert.equal(afterDirect, "dispatched");
  const rpc = await attempt(() => ctx.as(ids.dispatch, `select public.transition_dispatch_delivery_atomic('${d}','returned',null,'customer refused 2 bundles') x`));
  assert.equal(rpc.ok, true, rpc.error);
  assert.equal((await dispatchRow(ctx, d)).delivery_status, "returned");
  return `direct status change rejected (${direct.error}); workflow return recorded`;
});

scenario("G011-pending-dispatch-still-editable", "011", async (ctx) => {
  const d = "f8000000-0000-4000-8000-000000000004";
  await seedDispatchedOrder(ctx, d);
  await ctx.replica(`update public.dispatches set delivery_status='pending', actual_dispatched_at=null where id='${d}'`);
  const r = await attempt(() => ctx.as(ids.dispatch, `update public.dispatches set eway_bill_number='EWB-222', vehicle_number='GJ01CD5678' where id='${d}' returning eway_bill_number`));
  assert.equal(r.ok, true, r.error); assert.equal(r.value[0]?.eway_bill_number, "EWB-222");
  return "pending dispatch documents remain editable";
});

// ---- runner ---------------------------------------------------------------
const onlyCandidate = new Set(["G008-production-manager-returns-press", "G008-operator-out-of-service-only", "G008-sales-manager-registers-die", "G011-pending-dispatch-still-editable", "G002-completion-still-books-scrap", "G003-weight-correction-moves-balance", "G003-furnace-charge-and-cancel-still-work"]);
let failures = 0;
for (const s of scenarios) {
  for (const candidate of onlyCandidate.has(s.id) ? [true] : [false, true]) {
    const label = `${s.id} [${candidate ? "candidate" : "baseline"}]`;
    const ctx = await fresh(candidate);
    try {
      const detail = await s.run(ctx, candidate);
      console.log(`PASS ${label}: ${detail}`);
    } catch (error) {
      failures++;
      console.log(`FAIL ${label}: ${error.message}`);
    } finally {
      await ctx.db.close();
    }
  }
}
console.log(failures ? `GATE FAILED (${failures})` : "GATE PASSED");
process.exitCode = failures ? 1 : 0;
