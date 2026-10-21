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
  "supabase/migrations/20261021040000_reservation_packing_commercial_lineage.sql",
  "supabase/migrations/20261021050000_die_schedule_exclusivity.sql",
  "supabase/migrations/20261021060000_quality_release_rules.sql",
  "supabase/migrations/20261021070000_audit_log_actor_identity.sql",
];

// Optional migrations applied before Wave 1 in the candidate build (rollout rehearsal),
// e.g. GATE_PREFIX_MIGRATIONS=supabase/migrations/a.sql,supabase/migrations/b.sql
const PREFIX = (process.env.GATE_PREFIX_MIGRATIONS ?? "").split(",").map((file) => file.trim()).filter(Boolean);
// Post-apply verification: GATE_POST_APPLY_DIR=live-20261021 runs only the candidate
// assertions against a fresh capture of the hosted catalog, with no migrations layered on.
const POST_APPLY_DIR = process.env.GATE_POST_APPLY_DIR ?? "";
// Regression run: later migrations layered after Wave 1, e.g. GATE_SUFFIX_MIGRATIONS=a.sql,b.sql
const SUFFIX = (process.env.GATE_SUFFIX_MIGRATIONS ?? "").split(",").map((file) => file.trim()).filter(Boolean);

const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error: error.message }; } };

async function fresh(candidate) {
  const { db } = POST_APPLY_DIR
    ? await createLiveCatalogDb({ dir: POST_APPLY_DIR })
    : await createLiveCatalogDb({ migrations: candidate ? [...PREFIX, ...WAVE1, ...SUFFIX] : [] });
  await seed(db);
  const q = async (sql) => (await db.query(sql)).rows;
  const replica = (sql) => db.exec(`set session_replication_role = replica; ${sql}; set session_replication_role = origin;`);
  const as = async (userId, sql) => {
    await db.exec(`select set_config('audit.uid','${userId}',false); set role authenticated;`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
  };
  // Definer-equivalent context: auth.uid() is set, but the statement runs with the
  // function owner's privileges, as inside the SECURITY DEFINER dispatch RPCs.
  const sys = async (userId, sql) => {
    await db.exec(`select set_config('audit.uid','${userId}',false);`);
    return (await db.query(sql)).rows;
  };
  return { db, q, replica, as, sys };
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
  // Post-apply runs have no in-process baseline; use the outcome recorded on the pre-fix snapshot.
  const baseline = factoryOutcome.baseline ?? '{"stage":"dispatched","billet":"cast","reqs":[]}';
  if (candidate) assert.equal(outcome, baseline, "owner path must behave exactly as before");
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
  // With Wave 2 layered on (GATE_SUFFIX_MIGRATIONS), completion needs input evidence (EXOS-AUD-014) and only
  // weighed, categorised scrap becomes furnace metal (EXOS-AUD-006), so the legitimate flow uses those steps.
  const [{ wave2 }] = await ctx.q(`select to_regprocedure('public.complete_production_job_with_scrap_atomic(uuid,numeric,integer,numeric,jsonb,text)') is not null wave2`);
  if (wave2) {
    const ex = await attempt(() => ctx.as(ids.productionManager, `select public.record_production_input_exception('${ids.jobA}', 'Trial run on customer-supplied billets') id`));
    assert.equal(ex.ok, true, ex.error);
  }
  const r = await attempt(() => ctx.as(ids.production, wave2
    ? `select public.complete_production_job_with_scrap_atomic('${ids.jobA}', 600, 100, null, '[{"category":"butt_end","weight_kg":400}]'::jsonb, 'loss') id`
    : `select public.complete_production_job_atomic('${ids.jobA}', 600, 100, null, 400, 'loss') id`));
  assert.equal(r.ok, true, r.error);
  const lots = await ctx.q(`select weight_kg, available_weight_kg, status from public.foundry_aluminium_scrap where ${wave2 ? "scrap_source = 'in_house'" : `origin_reference like '%${ids.jobA}%'`}`);
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
  // With Wave 2 layered on, a press leaves 'breakdown' only through the return-to-service sign-off (EXOS-AUD-008 follow-up).
  const [{ wave2 }] = await ctx.q(`select to_regprocedure('public.return_machine_to_service_atomic(uuid,text)') is not null wave2`);
  if (wave2) {
    const direct = await attempt(() => ctx.as(ids.productionManager, `update public.machines set status='active' where id='${ids.pressB}'`));
    assert.equal(direct.ok, false);
    const signoff = await attempt(() => ctx.as(ids.productionManager, `select public.return_machine_to_service_atomic('${ids.pressB}', 'Inspected and pressure tested') id`));
    assert.equal(signoff.ok, true, signoff.error);
  }
  const r = wave2
    ? { ok: true, value: await ctx.q(`select status from public.machines where id='${ids.pressB}'`) }
    : await attempt(() => ctx.as(ids.productionManager, `update public.machines set status='active' where id='${ids.pressB}' returning status`));
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

// ---- EXOS-AUD-010 -------------------------------------------------------
const lineB = "f5000000-0000-4000-8000-000000000002";
const stockBatch = "f6000000-0000-4000-8000-000000000001";
const reservation = "f6100000-0000-4000-8000-000000000001";
const pendingDispatch = "f6200000-0000-4000-8000-000000000001";

async function seedReservation(ctx, { lines = [{ id: lineA, finish: "mill_finish", rate: 300 }] } = {}) {
  const values = lines.map((line) => `('${line.id}', '${ids.company}', '${ids.orderA}', '${ids.profile}', 1000, 300, ${line.rate}, 18, '${line.finish}')`).join(",");
  await ctx.replica(`
    insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, quantity_pieces, net_rate, gst_percent, finishing_type) values ${values};
    insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, net_rate, gst_percent, finishing_type) values ('${lineB}', '${ids.company}', '${ids.orderB}', '${ids.profile}', 1000, 999, 5, 'mill_finish');
    insert into public.profile_stock_batches (id, company_id, profile_id, finish, length_m, quantity_pieces, total_weight_kg, status) values ('${stockBatch}', '${ids.company}', '${ids.profile}', 'mill_finish', 58, 10, 58, 'reserved');
    insert into public.profile_stock_reservations (id, company_id, profile_stock_batch_id, profile_id, order_id, reserved_weight_kg, reserved_length_m, reserved_pieces, initial_reserved_weight_kg, initial_reserved_length_m, initial_reserved_pieces, status)
      values ('${reservation}', '${ids.company}', '${stockBatch}', '${ids.profile}', '${ids.orderA}', 58, 58, 10, 58, 58, 10, 'active');
    insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status) values ('${pendingDispatch}', '${ids.company}', '${ids.orderA}', 'D-R', current_date, 1, 5.8, 0, 'pending')`);
}
// Column shape produced by lib/pcda/dispatch.ts for a reservation source (see repro-05).
const reservationRow = (bundle, extra = "null, null, null") => `insert into public.packing_list_items (company_id, dispatch_id, profile_id, bundle_number, source_kind, source_record_id, source_line_id, reservation_id, profile_stock_batch_id, number_of_pieces, net_length_m, gross_weight_kg, tare_weight_kg, operator_verified_at, operator_verified_by, order_item_id, quote_item_id, net_rate)
  values ('${ids.company}', '${pendingDispatch}', '${ids.profile}', '${bundle}', 'reservation', '${ids.orderA}', '${reservation}', '${reservation}', '${stockBatch}', 1, 5.8, 5.8, 0, now(), '${ids.dispatch}', ${extra})`;
const packed = async (ctx, bundle) => (await ctx.q(`select order_item_id::text, net_rate::numeric, gst_percent::numeric from public.packing_list_items where bundle_number='${bundle}'`))[0];

scenario("G010-app-shaped-reservation-line", "010", async (ctx, candidate) => {
  await seedReservation(ctx);
  const r = await attempt(() => ctx.sys(ids.dispatch, reservationRow("S-1")));
  if (!candidate) { assert.equal(r.ok, false); assert.match(r.error, /authoritative commercial source/); return `baseline rejected: ${r.error}`; }
  assert.equal(r.ok, true, r.error);
  const row = await packed(ctx, "S-1");
  assert.equal(row.order_item_id, lineA); assert.equal(Number(row.net_rate), 300); assert.equal(Number(row.gst_percent), 18);
  return `accepted with order A line, Rs ${row.net_rate}/kg, GST ${row.gst_percent}%`;
});

scenario("G010-forged-foreign-line-and-rate", "010", async (ctx, candidate) => {
  await seedReservation(ctx);
  await ctx.replica(`delete from public.dispatches where id='${pendingDispatch}'; update public.orders set current_stage='packing' where id='${ids.orderA}'`);
  // Direct RPC call (as in scripts/run-local-reservation-invoice-acceptance.mjs) supplying another order's line and Rs 1/kg.
  const items = `jsonb_build_array(jsonb_build_object('bundle_number','FG-1','source_kind','reservation','source_record_id','${ids.orderA}','source_line_id','${reservation}','reservation_id','${reservation}','profile_stock_batch_id','${stockBatch}','profile_id','${ids.profile}','number_of_pieces',1,'net_length_m',5.8,'gross_weight_kg',5.8,'tare_weight_kg',0,'order_item_id','${lineB}','net_rate',1.00,'gst_percent',5))`;
  const r = await attempt(() => ctx.as(ids.owner, `select public.save_ready_dispatch_atomic(null, jsonb_build_object('order_id','${ids.orderA}','dispatch_date','2026-10-21','total_weight_kg',5.8,'total_tare_weight_kg',0), ${items}) id`));
  assert.equal(r.ok, true, r.error);
  const row = await packed(ctx, "FG-1");
  if (!candidate) { assert.equal(row.order_item_id, lineB); assert.equal(Number(row.net_rate), 1); return `baseline: shipped and priced from order B line at Rs ${row.net_rate}/kg, GST ${row.gst_percent}%`; }
  assert.equal(row.order_item_id, lineA); assert.equal(Number(row.net_rate), 300); assert.equal(Number(row.gst_percent), 18);
  return `client lineage overwritten -> order A line, Rs ${row.net_rate}/kg, GST ${row.gst_percent}%`;
});

scenario("G010-finish-disambiguates-lines", "010", async (ctx) => {
  await seedReservation(ctx, { lines: [{ id: lineA, finish: "mill_finish", rate: 300 }, { id: "f5000000-0000-4000-8000-000000000003", finish: "powder_coating", rate: 380 }] });
  const r = await attempt(() => ctx.sys(ids.dispatch, reservationRow("S-3")));
  assert.equal(r.ok, true, r.error);
  const row = await packed(ctx, "S-3");
  assert.equal(row.order_item_id, lineA); assert.equal(Number(row.net_rate), 300);
  return "mill-finish batch matched the mill-finish line (not the powder-coated one)";
});

scenario("G010-ambiguous-lines-rejected", "010", async (ctx) => {
  await seedReservation(ctx, { lines: [{ id: lineA, finish: "powder_coating", rate: 380 }, { id: "f5000000-0000-4000-8000-000000000003", finish: "anodizing", rate: 420 }] });
  const r = await attempt(() => ctx.sys(ids.dispatch, reservationRow("S-4")));
  assert.equal(r.ok, false);
  return `rejected: ${r.error}`;
});

scenario("G010-reserved-stock-shipment-end-to-end", "010", async (ctx, candidate) => {
  await seedReservation(ctx);
  await ctx.replica(`delete from public.dispatches where id='${pendingDispatch}'; update public.orders set current_stage='packing' where id='${ids.orderA}'`);
  const items = `jsonb_build_array(jsonb_build_object('bundle_number','RS-1','source_kind','reservation','source_record_id','${ids.orderA}','source_line_id','${reservation}','reservation_id','${reservation}','profile_stock_batch_id','${stockBatch}','profile_id','${ids.profile}','number_of_pieces',1,'net_length_m',5.8,'gross_weight_kg',5.8,'tare_weight_kg',0,'order_item_id',null,'quote_item_id',null,'net_rate',null))`;
  const r = await attempt(() => ctx.as(ids.dispatch, `select public.save_ready_dispatch_atomic(null, jsonb_build_object('order_id','${ids.orderA}','dispatch_date','2026-10-21','total_weight_kg',5.8,'total_tare_weight_kg',0,'transporter_name','Shree Roadlines','vehicle_number','MH01AB1234'), ${items}) id`));
  if (!candidate) { assert.equal(r.ok, false); return `baseline blocked: ${r.error}`; }
  assert.equal(r.ok, true, r.error);
  const [batch] = await ctx.q(`select total_weight_kg::numeric kg, quantity_pieces from public.profile_stock_batches where id='${stockBatch}'`);
  const row = await packed(ctx, "RS-1");
  assert.equal(Number(batch.kg), 52.2); assert.equal(Number(row.net_rate), 300);
  return `dispatch role shipped 1 reserved piece; stock 58 -> ${batch.kg} kg; packed at Rs ${row.net_rate}/kg`;
});

// ---- EXOS-AUD-007 -------------------------------------------------------
async function seedTwoJobsOneDie(ctx) {
  await ctx.replica(`
    insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, quantity_pieces, length_per_piece_m, net_rate, gst_percent, finishing_type)
    values ('${lineA}', '${ids.company}', '${ids.orderA}', '${ids.profile}', 1000, 172, 5.8, 300, 18, 'mill_finish'),
           ('${lineB}', '${ids.company}', '${ids.orderB}', '${ids.profile}', 1000, 172, 5.8, 300, 18, 'mill_finish');
    insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, source_record_id, status, planned_quantity_kg, pieces, length_per_piece_m, extrusion_efficiency_percent, finishing_type)
    values ('${ids.jobA}', '${ids.company}', 'J-A', '${ids.orderA}', '${ids.profile}', '${ids.die}', '${lineA}', '${ids.orderA}', 'planned', 1000, 172, 5.8, 85, 'mill_finish'),
           ('${ids.jobB}', '${ids.company}', 'J-B', '${ids.orderB}', '${ids.profile}', '${ids.die}', '${lineB}', '${ids.orderB}', 'planned', 1000, 172, 5.8, 85, 'mill_finish')`);
}
const slot = (job, press, start, end) => `select public.save_production_schedule_slot_atomic(null, jsonb_build_object('production_job_id','${job}','machine_id','${press}','planned_start_at','${start}','planned_end_at','${end}','status','scheduled')) id`;

scenario("G007-same-die-two-presses-overlap", "007", async (ctx, candidate) => {
  await seedTwoJobsOneDie(ctx);
  const a = await attempt(() => ctx.as(ids.productionManager, slot(ids.jobA, ids.pressA, "2026-11-01T10:00:00+05:30", "2026-11-01T14:00:00+05:30")));
  assert.equal(a.ok, true, a.error);
  const b = await attempt(() => ctx.as(ids.productionManager, slot(ids.jobB, ids.pressB, "2026-11-01T12:00:00+05:30", "2026-11-01T16:00:00+05:30")));
  if (!candidate) { assert.equal(b.ok, true, b.error); return "baseline: overlapping slot for the same die accepted on press B"; }
  assert.equal(b.ok, false);
  return `second press slot rejected: ${b.error}`;
});

scenario("G007-same-die-later-window-allowed", "007", async (ctx) => {
  await seedTwoJobsOneDie(ctx);
  const a = await attempt(() => ctx.as(ids.productionManager, slot(ids.jobA, ids.pressA, "2026-11-01T10:00:00+05:30", "2026-11-01T14:00:00+05:30")));
  const b = await attempt(() => ctx.as(ids.productionManager, slot(ids.jobB, ids.pressB, "2026-11-01T14:00:00+05:30", "2026-11-01T18:00:00+05:30")));
  assert.equal(a.ok, true, a.error); assert.equal(b.ok, true, b.error);
  return "back-to-back windows for the same die are allowed";
});

scenario("G007-completed-job-does-not-block", "007", async (ctx) => {
  await seedTwoJobsOneDie(ctx);
  await ctx.replica(`update public.production_jobs set status='completed', machine_id='${ids.pressA}' where id='${ids.jobA}';
    insert into public.production_plan_slots (company_id, production_job_id, machine_id, planned_start_at, planned_end_at, status) values ('${ids.company}', '${ids.jobA}', '${ids.pressA}', '2026-11-01T10:00:00+05:30', '2026-11-01T14:00:00+05:30', 'released')`);
  const b = await attempt(() => ctx.as(ids.productionManager, slot(ids.jobB, ids.pressB, "2026-11-01T12:00:00+05:30", "2026-11-01T16:00:00+05:30")));
  assert.equal(b.ok, true, b.error);
  return "a completed job's released slot does not block the die";
});

scenario("G007-die-already-running", "007", async (ctx, candidate) => {
  await seedTwoJobsOneDie(ctx);
  // Job A runs on press A; job B (same die) has a released slot on another day and is ready.
  await ctx.replica(`update public.production_jobs set status='in_progress', machine_id='${ids.pressA}' where id='${ids.jobA}';
    update public.production_jobs set status='ready', machine_id='${ids.pressB}' where id='${ids.jobB}';
    insert into public.production_plan_slots (company_id, production_job_id, machine_id, planned_start_at, planned_end_at, status) values ('${ids.company}', '${ids.jobB}', '${ids.pressB}', '2026-11-03T10:00:00+05:30', '2026-11-03T14:00:00+05:30', 'released')`);
  const r = await attempt(() => ctx.as(ids.production, `select public.transition_production_job_atomic('${ids.jobB}','in_progress','start') id`));
  if (!candidate) { assert.equal(r.ok, true, r.error); return "baseline: second job started while the die was running"; }
  assert.equal(r.ok, false);
  return `start rejected: ${r.error}`;
});

// ---- EXOS-AUD-012 -------------------------------------------------------
// Completed mill-finish job (600 kg) on a profile with a 5% weight tolerance and a 12 HW minimum.
async function seedCompletedJobForQc(ctx) {
  await ctx.replica(`
    update public.aluminium_profiles set weight_tolerance_percent = 5, hardness_requirement = '>= 12 HW' where id = '${ids.profile}';
    insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, net_rate, gst_percent, finishing_type) values ('${lineA}', '${ids.company}', '${ids.orderA}', '${ids.profile}', 1000, 300, 18, 'mill_finish');
    insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, status, planned_quantity_kg, actual_quantity_kg, actual_pieces, actual_meters, finishing_type, completed_at)
      values ('${ids.jobA}', '${ids.company}', 'J-QC', '${ids.orderA}', '${ids.profile}', '${ids.die}', '${lineA}', 'completed', 600, 600, 100, 580, 'mill_finish', now())`);
}
const qcInsert = (status, hardness, kgm, kg = 100) => `insert into public.quality_inspections (company_id, production_job_id, profile_id, quantity_checked_kg, hardness_webster, weight_per_meter_actual, surface_finish_ok, status, inspector_name)
  values ('${ids.company}', '${ids.jobA}', '${ids.profile}', ${kg}, ${hardness ?? "null"}, ${kgm ?? "null"}, true, '${status}', 'Inspector') returning id`;

scenario("G012-production-manager-self-approval", "012", async (ctx, candidate) => {
  await seedCompletedJobForQc(ctx);
  const r = await attempt(() => ctx.as(ids.productionManager, qcInsert("approved", 14, 1.02)));
  if (!candidate) { assert.equal(r.ok, true, r.error); return "baseline: production manager approved own output"; }
  assert.equal(r.ok, false);
  const reject = await attempt(() => ctx.as(ids.productionManager, qcInsert("rejected", null, null)));
  assert.equal(reject.ok, true, reject.error);
  return `approval rejected (${r.error}); production manager can still reject`;
});

scenario("G012-out-of-spec-approval", "012", async (ctx, candidate) => {
  await seedCompletedJobForQc(ctx);
  const heavy = await attempt(() => ctx.as(ids.quality, qcInsert("approved", 14, 1.6)));
  const soft = await attempt(() => ctx.as(ids.quality, qcInsert("approved", 2, 1.0)));
  if (!candidate) { assert.equal(heavy.ok, true, heavy.error); assert.equal(soft.ok, true, soft.error); return "baseline: 1.6 kg/m and 2 HW approved"; }
  assert.equal(heavy.ok, false); assert.equal(soft.ok, false);
  return `rejected: ${heavy.error} | ${soft.error}`;
});

scenario("G012-in-spec-approval-records-approver", "012", async (ctx) => {
  await seedCompletedJobForQc(ctx);
  const missing = await attempt(() => ctx.as(ids.quality, qcInsert("approved", null, 1.02)));
  assert.equal(missing.ok, false, "a configured hardness spec requires the measurement");
  const ok = await attempt(() => ctx.as(ids.quality, qcInsert("approved", 13, 1.03)));
  assert.equal(ok.ok, true, ok.error);
  const [row] = await ctx.q(`select dispositioned_by::text, dispositioned_at is not null stamped from public.quality_inspections where id = '${ok.value[0].id}'`);
  assert.equal(row.dispositioned_by, ids.quality); assert.equal(row.stamped, true);
  return `missing hardness rejected (${missing.error}); in-spec approval stored with approver = quality user`;
});

scenario("G012-unconfigured-profile-not-checked", "012", async (ctx) => {
  await seedCompletedJobForQc(ctx);
  await ctx.replica(`update public.aluminium_profiles set weight_tolerance_percent = null, hardness_requirement = null where id = '${ids.profile}'`);
  const ok = await attempt(() => ctx.as(ids.quality, qcInsert("approved", null, null)));
  assert.equal(ok.ok, true, ok.error);
  return "profiles without a specification approve without measurements (no invented tolerance)";
});

scenario("G012-admin-disables-qc-gate", "012", async (ctx, candidate) => {
  const admin = "a0000000-0000-4000-8000-000000000014";
  await ctx.replica(`insert into auth.users (id) values ('${admin}');
    insert into public.app_users (id, company_id, full_name, email, role, is_active) values ('${admin}', '${ids.company}', 'Admin', 'ad@x', 'admin', true);
    insert into public.feature_flags (company_id, module_name, is_enabled) values ('${ids.company}', 'quality_compliance', true)`);
  const r = await attempt(() => ctx.as(admin, `update public.feature_flags set is_enabled = false where company_id = '${ids.company}' and module_name = 'quality_compliance'`));
  const [flag] = await ctx.q(`select is_enabled from public.feature_flags where module_name = 'quality_compliance'`);
  if (!candidate) { assert.equal(flag.is_enabled, false); return "baseline: admin switched the dispatch QC gate off"; }
  assert.equal(r.ok, false); assert.equal(flag.is_enabled, true);
  const owner = await attempt(() => ctx.as(ids.owner, `update public.feature_flags set is_enabled = false where company_id = '${ids.company}' and module_name = 'quality_compliance'`));
  assert.equal(owner.ok, true, owner.error);
  return `admin rejected (${r.error}); owner may still disable it`;
});

// ---- EXOS-AUD-019 -------------------------------------------------------
scenario("G019-viewer-forges-audit-rows", "019", async (ctx, candidate) => {
  await ctx.as(ids.viewer, `insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json) values ('${ids.company}', '${ids.owner}', 'payment_recorded', 'payment', gen_random_uuid(), '{"amount":500000}'::jsonb)`);
  await ctx.as(ids.viewer, `insert into public.audit_logs_enterprise (company_id, actor_user_id, actor_name, actor_role, action_type, module_name, entity_type, change_summary) values ('${ids.company}', '${ids.owner}', 'Owner', 'owner', 'invoice_approved', 'financials', 'invoice', 'forged')`);
  const [log] = await ctx.q(`select actor_id::text from public.audit_logs where action = 'payment_recorded'`);
  const [ent] = await ctx.q(`select actor_user_id::text, actor_name, actor_role from public.audit_logs_enterprise where change_summary = 'forged'`);
  if (!candidate) { assert.equal(log.actor_id, ids.owner); assert.equal(ent.actor_user_id, ids.owner); return "baseline: rows attributed to the owner"; }
  assert.equal(log.actor_id, ids.viewer); assert.equal(ent.actor_user_id, ids.viewer);
  assert.equal(ent.actor_role, "viewer"); assert.equal(ent.actor_name, "Viewer");
  return `rows stamped with the real actor -> ${JSON.stringify(ent)}`;
});

scenario("G019-server-audit-writers-unchanged", "019", async (ctx) => {
  // record_enterprise_audit (definer trigger) still attributes a business change to the session user.
  await ctx.as(ids.productionManager, `update public.machines set status = 'idle' where id = '${ids.pressA}'`);
  const rows = await ctx.q(`select actor_id::text, action from public.audit_logs where entity_id = '${ids.pressA}' and action = 'update_machines'`);
  assert.ok(rows.length >= 1, "machine change audited");
  assert.ok(rows.every((row) => row.actor_id === ids.productionManager), JSON.stringify(rows));
  return `machine change audited by the trigger writer -> ${JSON.stringify(rows[0])}`;
});

// ---- runner ---------------------------------------------------------------
const onlyCandidate = new Set(["G012-in-spec-approval-records-approver", "G012-unconfigured-profile-not-checked", "G019-server-audit-writers-unchanged", "G010-finish-disambiguates-lines", "G010-ambiguous-lines-rejected", "G007-same-die-later-window-allowed", "G007-completed-job-does-not-block", "G008-production-manager-returns-press", "G008-operator-out-of-service-only", "G008-sales-manager-registers-die", "G011-pending-dispatch-still-editable", "G002-completion-still-books-scrap", "G003-weight-correction-moves-balance", "G003-furnace-charge-and-cancel-still-work"]);
let failures = 0;
for (const s of scenarios) {
  for (const candidate of onlyCandidate.has(s.id) || POST_APPLY_DIR ? [true] : [false, true]) {
    const label = `${s.id} [${POST_APPLY_DIR ? `hosted ${POST_APPLY_DIR}` : candidate ? "candidate" : "baseline"}]`;
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
