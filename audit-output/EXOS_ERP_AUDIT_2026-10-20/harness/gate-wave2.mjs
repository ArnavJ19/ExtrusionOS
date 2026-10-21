// Wave 2 regression gate for the findings left open after Wave 1.
// Each scenario runs twice on a fresh replica of the hosted catalog captured after
// Wave 1 was applied (harness/live-20261021):
//   baseline  = that snapshot only            -> the defect must still reproduce
//   candidate = snapshot + Wave 2 migrations  -> the defect is fixed and legitimate flows still work
// Run from the codex/v1 root: node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/gate-wave2.mjs
// GATE_ONLY=G004,G015 limits the run to scenario id prefixes.
import assert from "node:assert/strict";
import { createLiveCatalogDb } from "./live-catalog-db.mjs";
import { ids, seed } from "./seed.mjs";

export const WAVE2 = [
  "supabase/migrations/20261021080000_close_low_level_dispatch_rpc.sql",
  "supabase/migrations/20261021090000_outsourced_billet_commitment_guard.sql",
  "supabase/migrations/20261021100000_production_cancel_billet_release.sql",
  "supabase/migrations/20261021110000_revoke_client_truncate_and_anon_writes.sql",
  "supabase/migrations/20261021120000_order_delivery_stage_resolution.sql",
  "supabase/migrations/20261021130000_die_identity_and_derived_usage.sql",
  "supabase/migrations/20261021140000_dispatch_packaged_weight_cap.sql",
  "supabase/migrations/20261021150000_production_input_evidence.sql",
  "supabase/migrations/20261021160000_role_explicit_write_policies.sql",
  "supabase/migrations/20261021170000_dispatch_document_amendments.sql",
  "supabase/migrations/20261021180000_machine_maintenance_lifecycle.sql",
  "supabase/migrations/20261021190000_accounting_period_lock.sql",
  "supabase/migrations/20261021200000_metal_receipt_plausibility.sql",
  "supabase/migrations/20261021210000_scrap_genealogy_and_alloy_segregation.sql",
  "supabase/migrations/20261021220000_inventory_ledger_integrity.sql",
  "supabase/migrations/20261021230000_finished_goods_origin_and_qc_hold.sql",
  "supabase/migrations/20261021240000_casting_results_and_chemistry_release.sql",
  "supabase/migrations/20261021250000_material_dispositions_and_partial_credit_notes.sql",
  "supabase/migrations/20261021260000_physical_billet_issue_step.sql",
  "supabase/migrations/20261021270000_kpi_definitions.sql",
  "supabase/migrations/20261021280000_profile_spec_change_control.sql",
  "supabase/migrations/20261021290000_foundry_single_source_charge_fix.sql",
  "supabase/migrations/20261021310000_quote_invoice_rate_basis.sql",
  "supabase/migrations/20261021330000_invoice_die_freight_charge_lines.sql",
];

const BASE_DIR = "live-20261021";
const PREFIX = (process.env.GATE_PREFIX_MIGRATIONS ?? "").split(",").map((file) => file.trim()).filter(Boolean);
const POST_APPLY_DIR = process.env.GATE_POST_APPLY_DIR ?? "";
const ONLY = (process.env.GATE_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// GATE_TRACE=1 prints every rejection so an accidental permission error cannot pass as an expected refusal.
const TRACE = Boolean(process.env.GATE_TRACE);
const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (error) { if (TRACE) console.log(`  rejected: ${error.message}`); return { ok: false, error: error.message }; } };

async function fresh(candidate) {
  const { db } = POST_APPLY_DIR
    ? await createLiveCatalogDb({ dir: POST_APPLY_DIR })
    : await createLiveCatalogDb({ dir: BASE_DIR, migrations: candidate ? [...PREFIX, ...WAVE2] : [] });
  await seed(db);
  const q = async (sql) => (await db.query(sql)).rows;
  const replica = (sql) => db.exec(`set session_replication_role = replica; ${sql}; set session_replication_role = origin;`);
  const as = async (userId, sql) => {
    await db.exec(`select set_config('audit.uid','${userId}',false); set role authenticated;`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
  };
  const asAnon = async (sql) => {
    await db.exec(`select set_config('audit.uid','',false); set role anon;`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
  };
  // Definer-equivalent context: auth.uid() is set but the statement runs as the owner.
  const sys = async (userId, sql) => { await db.exec(`select set_config('audit.uid','${userId}',false);`); return (await db.query(sql)).rows; };
  return { db, q, replica, as, asAnon, sys };
}

const lineA = "f5000000-0000-4000-8000-000000000001";
const scenarios = [];
const scenario = (id, finding, run, { candidateOnly = false } = {}) => scenarios.push({ id, finding, run, candidateOnly });

// ---- EXOS-AUD-017 -------------------------------------------------------
const lineB = "f5000000-0000-4000-8000-000000000002";
// Completed, QC-approved, packed mill-finish output for order B (a valid packing source).
const seedPackedOutputForOrderB = (ctx) => ctx.replica(`
  update public.orders set current_stage='packing' where id='${ids.orderB}';
  insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, net_rate, gst_percent) values ('${lineB}', '${ids.company}', '${ids.orderB}', '${ids.profile}', 1000, 300, 18);
  insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, status, planned_quantity_kg, actual_quantity_kg, actual_pieces, actual_meters, finishing_type, completed_at)
    values ('${ids.jobB}', '${ids.company}', 'J-Q', '${ids.orderB}', '${ids.profile}', '${ids.die}', '${lineB}', 'completed', 10, 10, 2, 10, 'mill_finish', now());
  insert into public.quality_inspections (company_id, production_job_id, profile_id, quantity_checked_kg, status, inspector_name, surface_finish_ok) values ('${ids.company}', '${ids.jobB}', '${ids.profile}', 10, 'approved', 'QC', true);
  insert into public.packaging_materials (id, company_id, material_code, material_name, material_type, consumption_rate, calculation_method) values ('f8300000-0000-4000-8000-000000000001', '${ids.company}', 'PM1', 'Wrap', 'stretch_film', 1, 'fixed');
  insert into public.packaging_jobs (id, company_id, packaging_number, order_id, production_job_id, status, profile_weight_kg) values ('f8400000-0000-4000-8000-000000000001', '${ids.company}', 'PK1', '${ids.orderB}', '${ids.jobB}', 'completed', 10);
  insert into public.packaging_job_materials (company_id, job_id, material_id, quantity_required) values ('${ids.company}', 'f8400000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 1)`);

scenario("G017-low-level-rpc-marks-order-delivered", "017", async (ctx, candidate) => {
  await seedPackedOutputForOrderB(ctx);
  const r = await attempt(() => ctx.as(ids.factoryManager, `select public.save_dispatch_atomic(null,
      jsonb_build_object('order_id','${ids.orderB}','dispatch_date','2026-11-02','number_of_bundles',1,'total_weight_kg',10,'total_tare_weight_kg',0,'delivery_status','pending'),
      jsonb_build_array(jsonb_build_object('bundle_number','B-1','profile_id','${ids.profile}','source_kind','production','source_record_id','${ids.orderB}','source_line_id','${ids.jobB}','number_of_pieces',2,'net_length_m',10,'gross_weight_kg',10,'tare_weight_kg',0,'operator_verified_at',now(),'operator_verified_by','${ids.factoryManager}')),
      'delivered') id`));
  const [order] = await ctx.q(`select current_stage from public.orders where id='${ids.orderB}'`);
  if (!candidate) { assert.equal(r.ok, true, r.error); assert.equal(order.current_stage, "delivered"); return "baseline: pending dispatch set the order to delivered"; }
  assert.equal(r.ok, false); assert.match(r.error, /permission denied/i);
  assert.equal(order.current_stage, "packing");
  return `rejected: ${r.error}`;
});

scenario("G017-ready-dispatch-writer-still-granted", "017", async (ctx) => {
  const [acl] = await ctx.q(`select has_function_privilege('authenticated','public.save_ready_dispatch_atomic(uuid,jsonb,jsonb)','EXECUTE') ready,
    has_function_privilege('authenticated','public.save_dispatch_atomic(uuid,jsonb,jsonb,text)','EXECUTE') low,
    has_function_privilege('anon','public.save_dispatch_atomic(uuid,jsonb,jsonb,text)','EXECUTE') low_anon`);
  assert.equal(acl.ready, true); assert.equal(acl.low, false); assert.equal(acl.low_anon, false);
  return JSON.stringify(acl);
}, { candidateOnly: true });

// ---- EXOS-AUD-004 -------------------------------------------------------
const ob = "f9000000-0000-4000-8000-000000000001";
const insertReceipt = (ctx, count = 10, kg = 220) => ctx.as(ids.productionManager, `insert into public.outsourced_billet_batches (id, company_id, batch_number, vendor_id, alloy, temper, billet_count, billet_diameter_inch, billet_diameter_mm, billet_length_mm, weight_kg, created_by)
  values ('${ob}', '${ids.company}', 'OB-1', '${ids.vendor}', '6063', 'T6', ${count}, 4, 101.6, 1000, ${kg}, '${ids.productionManager}')`);
const consumeFirstTwo = (ctx) => ctx.replica(`update public.foundry_billets set status='consumed', order_id='${ids.orderA}' where outsourced_batch_id='${ob}' and billet_number in (1,2)`);
const obBillets = (ctx) => ctx.q(`select billet_number n, status, alloy, temper, weight_kg::numeric kg from public.foundry_billets where outsourced_batch_id='${ob}' order by billet_number`);

scenario("G004-edit-rewrites-consumed-billets", "004", async (ctx, candidate) => {
  await insertReceipt(ctx); await consumeFirstTwo(ctx);
  const edit = await attempt(() => ctx.as(ids.production, `update public.outsourced_billet_batches set alloy='6061', temper='T5', weight_kg=440, billet_count=4 where id='${ob}'`));
  const rows = await obBillets(ctx);
  const consumed = rows.filter((b) => b.status === "consumed");
  if (!candidate) { assert.equal(edit.ok, true, edit.error); assert.ok(consumed.every((b) => b.alloy === "6061" && Number(b.kg) === 110)); return `baseline: consumed billets rewritten -> ${JSON.stringify(consumed)}`; }
  assert.equal(edit.ok, false); assert.match(edit.error, /committed billet/);
  assert.ok(consumed.every((b) => b.alloy === "6063" && Number(b.kg) === 22));
  return `rejected: ${edit.error}`;
});

scenario("G004-reduced-count-leaves-surplus", "004", async (ctx, candidate) => {
  await insertReceipt(ctx); await consumeFirstTwo(ctx);
  // Same per-billet weight (22 kg): a count typo fix that does not touch committed metal.
  const edit = await attempt(() => ctx.as(ids.production, `update public.outsourced_billet_batches set weight_kg=88, billet_count=4 where id='${ob}'`));
  assert.equal(edit.ok, true, edit.error);
  const rows = await obBillets(ctx);
  const surplusUsable = rows.filter((b) => b.n > 4 && b.status === "cast").length;
  if (!candidate) { assert.equal(surplusUsable, 6); return "baseline: 6 billets above the new count stay cast"; }
  assert.equal(surplusUsable, 0);
  assert.equal(rows.filter((b) => b.n > 4 && b.status === "cancelled").length, 6);
  assert.deepEqual(rows.filter((b) => b.n <= 2).map((b) => b.status), ["consumed", "consumed"]);
  return `count 10 -> 4: billets 5-10 cancelled, consumed 1-2 untouched -> ${JSON.stringify(rows.map((b) => `${b.n}:${b.status}`))}`;
});

scenario("G004-cancelled-receipt-keeps-billets", "004", async (ctx, candidate) => {
  await insertReceipt(ctx); await consumeFirstTwo(ctx);
  const blocked = await attempt(() => ctx.as(ids.production, `update public.outsourced_billet_batches set status='cancelled' where id='${ob}'`));
  const rows = await obBillets(ctx);
  if (!candidate) { assert.equal(blocked.ok, true, blocked.error); assert.equal(rows.filter((b) => b.status === "cast").length, 8); return "baseline: cancelled receipt left 8 billets in stock"; }
  assert.equal(blocked.ok, false); assert.match(blocked.error, /already allocated, issued or consumed/);
  return `cancel with consumed billets rejected (${blocked.error})`;
});

scenario("G004-cancel-uncommitted-receipt", "004", async (ctx) => {
  await insertReceipt(ctx);
  const c = await attempt(() => ctx.as(ids.production, `update public.outsourced_billet_batches set status='cancelled' where id='${ob}'`));
  assert.equal(c.ok, true, c.error);
  const rows = await obBillets(ctx);
  assert.ok(rows.every((b) => b.status === "cancelled"), JSON.stringify(rows));
  const reopen = await attempt(() => ctx.as(ids.production, `update public.outsourced_billet_batches set status='received' where id='${ob}'`));
  assert.equal(reopen.ok, false);
  return `all 10 billets cancelled; reopen rejected (${reopen.error})`;
}, { candidateOnly: true });

scenario("G004-uncommitted-edit-and-regrow", "004", async (ctx) => {
  await insertReceipt(ctx);
  const a = await attempt(() => ctx.as(ids.production, `update public.outsourced_billet_batches set alloy='6061', billet_count=5, weight_kg=150 where id='${ob}'`));
  assert.equal(a.ok, true, a.error);
  let rows = await obBillets(ctx);
  assert.equal(rows.filter((b) => b.status === "cast" && b.alloy === "6061" && Number(b.kg) === 30).length, 5);
  assert.equal(rows.filter((b) => b.status === "cancelled").length, 5);
  const b = await attempt(() => ctx.as(ids.production, `update public.outsourced_billet_batches set billet_count=8, weight_kg=240 where id='${ob}'`));
  assert.equal(b.ok, true, b.error);
  rows = await obBillets(ctx);
  assert.equal(rows.filter((r) => r.status === "cast").length, 8);
  return "uncommitted receipt edits still flow to billets; reduced then raised count restores billets 6-8";
}, { candidateOnly: true });

scenario("G004-allocated-billet-not-reset", "004", async (ctx) => {
  await insertReceipt(ctx);
  const req = "f7100000-0000-4000-8000-000000000004";
  await ctx.replica(`insert into public.order_billet_requirements (id, company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billets_required, status)
      values ('${req}', '${ids.company}', '${ids.orderA}', '${ids.profile}', '6063', 'T6', 4, 1, 'pending');
    update public.foundry_billets set status='allocated', order_id='${ids.orderA}', allocation_requirement_id='${req}', allocated_at=now(), allocated_by='${ids.owner}' where outsourced_batch_id='${ob}' and billet_number=3`);
  const e = await attempt(() => ctx.as(ids.production, `update public.outsourced_billet_batches set received_date = received_date - 1 where id='${ob}'`));
  assert.equal(e.ok, true, e.error);
  const [b3] = await ctx.q(`select status, order_id::text from public.foundry_billets where outsourced_batch_id='${ob}' and billet_number=3`);
  assert.equal(b3.status, "allocated"); assert.equal(b3.order_id, ids.orderA);
  return `allocated billet kept its allocation after a receipt edit -> ${JSON.stringify(b3)}`;
}, { candidateOnly: true });

// ---- EXOS-AUD-015 -------------------------------------------------------
const job15 = "f4000000-0000-4000-8000-000000000003";
const fb15 = "f7000000-0000-4000-8000-000000000015";
const req15 = "f7100000-0000-4000-8000-000000000015";
async function seedHeldJobWithIssuedBillets(ctx, jobStatus = "on_hold") {
  await ctx.replica(`
    insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, net_rate, gst_percent) values ('${lineA}', '${ids.company}', '${ids.orderA}', '${ids.profile}', 1000, 300, 18);
    insert into public.foundry_batches (id, company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, status, billet_weight_density_kg, batch_sequence, production_date)
      values ('${fb15}', '${ids.company}', 'FB-15', 'F1', '6063', 'T6', 1000, 101.6, 4, 3, 2700, 0, 100, 'ready', 21.89, 15, current_date);
    insert into public.order_billet_requirements (id, company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billets_required, billets_allocated, status)
      values ('${req15}', '${ids.company}', '${ids.orderA}', '${ids.profile}', '6063', 'T6', 4, 3, 3, 'complete');
    insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, source_record_id, status, planned_quantity_kg, machine_id)
      values ('${job15}', '${ids.company}', 'J-C', '${ids.orderA}', '${ids.profile}', '${ids.die}', '${lineA}', '${ids.orderA}', '${jobStatus}', 40, '${ids.pressA}');
    insert into public.foundry_billets (company_id, source_type, foundry_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status, order_id, allocation_requirement_id, production_job_id, allocated_at, allocated_by)
      select '${ids.company}', 'in_house', '${fb15}', 'F1-' || to_char(current_date,'YYYYMMDD') || '-15-' || n, n, 4, 101.6, 1000, '6063', 'T6', 21.89,
        case when n = 3 then 'consumed' else 'issued' end, '${ids.orderA}', '${req15}', '${job15}', now(), '${ids.owner}'
      from generate_series(1,3) n`);
}
const billets15 = (ctx) => ctx.q(`select billet_number n, status, production_job_id::text job, order_id::text ord, allocation_requirement_id::text req from public.foundry_billets where foundry_batch_id='${fb15}' order by billet_number`);

scenario("G015-cancel-strands-issued-billets", "015", async (ctx, candidate) => {
  await seedHeldJobWithIssuedBillets(ctx);
  const c = await attempt(() => ctx.as(ids.productionManager, `select public.transition_production_job_atomic('${job15}','cancelled','order changed') id`));
  assert.equal(c.ok, true, c.error);
  const rows = await billets15(ctx);
  if (!candidate) { assert.ok(rows.filter((b) => b.n < 3).every((b) => b.status === "issued" && b.job === job15)); return "baseline: issued billets stay linked to the cancelled job"; }
  assert.deepEqual(rows.filter((b) => b.n < 3).map((b) => [b.status, b.job, b.ord, b.req]), [["allocated", null, ids.orderA, req15], ["allocated", null, ids.orderA, req15]]);
  assert.equal(rows[2].status, "consumed"); assert.equal(rows[2].job, job15);
  return `issued billets returned to the order allocation; consumed billet untouched -> ${JSON.stringify(rows)}`;
});

scenario("G015-save-on-cancelled-job", "015", async (ctx, candidate) => {
  await seedHeldJobWithIssuedBillets(ctx, "cancelled");
  // Billets already released (the baseline guard would otherwise reject the save for another reason).
  await ctx.replica(`update public.foundry_billets set status='allocated', production_job_id=null where foundry_batch_id='${fb15}' and billet_number < 3`);
  const payload = `jsonb_build_object('order_id','${ids.orderA}','profile_id','${ids.profile}','die_id','${ids.die}','planned_quantity_kg',40,'status','cancelled','remarks','edited after cancel')`;
  const r = await attempt(() => ctx.as(ids.productionManager, `select public.save_production_job_atomic('${job15}', ${payload}, array[]::uuid[]) id`));
  const [j] = await ctx.q(`select remarks from public.production_jobs where id='${job15}'`);
  if (!candidate) { assert.equal(r.ok, true, r.error); assert.equal(j.remarks, "edited after cancel"); return "baseline: cancelled job edited through the save RPC"; }
  assert.equal(r.ok, false); assert.match(r.error, /cannot be edited/);
  return `rejected: ${r.error}`;
});

scenario("G015-deselect-issued-billet-in-save", "015", async (ctx, candidate) => {
  await seedHeldJobWithIssuedBillets(ctx);
  const [b1] = await ctx.q(`select id from public.foundry_billets where foundry_batch_id='${fb15}' and billet_number=1`);
  const payload = `jsonb_build_object('order_id','${ids.orderA}','profile_id','${ids.profile}','die_id','${ids.die}','machine_id','${ids.pressA}','planned_quantity_kg',40,'status','on_hold')`;
  const r = await attempt(() => ctx.as(ids.productionManager, `select public.save_production_job_atomic('${job15}', ${payload}, array['${b1.id}']::uuid[]) id`));
  const rows = await billets15(ctx);
  if (!candidate) { assert.equal(r.ok, false); return `baseline: deselecting an issued in-house billet fails (${r.error})`; }
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(rows.map((b) => b.status), ["issued", "allocated", "consumed"]);
  return `billet 2 released to allocation; billet 1 kept issued -> ${JSON.stringify(rows.map((b) => `${b.n}:${b.status}`))}`;
});

scenario("G015-save-cannot-change-status", "015", async (ctx) => {
  await seedHeldJobWithIssuedBillets(ctx, "planned");
  await ctx.replica(`update public.foundry_billets set status='consumed' where foundry_batch_id='${fb15}' and billet_number=3`);
  const payload = `jsonb_build_object('order_id','${ids.orderA}','profile_id','${ids.profile}','die_id','${ids.die}','planned_quantity_kg',40,'status','on_hold','remarks','try hold via save')`;
  const r = await attempt(() => ctx.as(ids.productionManager, `select public.save_production_job_atomic('${job15}', ${payload}, array[]::uuid[]) id`));
  assert.equal(r.ok, true, r.error);
  const [j] = await ctx.q(`select status, remarks from public.production_jobs where id='${job15}'`);
  assert.equal(j.status, "planned"); assert.equal(j.remarks, "try hold via save");
  return `save kept status planned and applied the edit -> ${JSON.stringify(j)}`;
}, { candidateOnly: true });

// ---- EXOS-AUD-030 -------------------------------------------------------
scenario("G030-client-truncate-and-anon-writes", "030", async (ctx, candidate) => {
  const [acl] = await ctx.q(`select has_table_privilege('authenticated','public.invoices','TRUNCATE') auth_trunc,
    has_table_privilege('authenticated','public.audit_logs_enterprise','TRUNCATE') audit_trunc,
    has_table_privilege('authenticated','public.invoices','INSERT') auth_insert`);
  if (!candidate) { assert.equal(acl.auth_trunc, true); return `baseline: ${JSON.stringify(acl)}`; }
  assert.equal(acl.auth_trunc, false); assert.equal(acl.audit_trunc, false); assert.equal(acl.auth_insert, true);
  const t = await attempt(() => ctx.as(ids.owner, `truncate public.audit_logs_enterprise`));
  assert.equal(t.ok, false);
  return `TRUNCATE revoked; authenticated DML kept; owner truncate rejected (${t.error})`;
});

// ---- EXOS-AUD-018 -------------------------------------------------------
const d18a = "f6180000-0000-4000-8000-000000000001";
const d18b = "f6180000-0000-4000-8000-000000000002";
const seedOrderShipments = (ctx, firstStatus, firstKg, secondStatus, secondKg) => ctx.replica(`
  update public.orders set current_stage='dispatched' where id='${ids.orderA}';
  insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, net_rate, gst_percent) values ('${lineA}', '${ids.company}', '${ids.orderA}', '${ids.profile}', 1000, 300, 18);
  insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status, actual_dispatched_at)
    values ('${d18a}', '${ids.company}', '${ids.orderA}', 'D-18A', current_date, 1, ${firstKg}, 0, '${firstStatus}', now())
    ${secondStatus ? `, ('${d18b}', '${ids.company}', '${ids.orderA}', 'D-18B', current_date, 1, ${secondKg}, 0, '${secondStatus}', now())` : ""}`);
const syncStage = async (ctx) => { await ctx.q(`select private.sync_order_delivery_stage('${ids.company}', '${ids.orderA}', 'gate')`); return (await ctx.q(`select current_stage from public.orders where id='${ids.orderA}'`))[0].current_stage; };

scenario("G018-returned-shipment-blocks-delivery", "018", async (ctx, candidate) => {
  await seedOrderShipments(ctx, "returned", 1000, "delivered", 1000);
  const stage = await syncStage(ctx);
  if (!candidate) { assert.equal(stage, "dispatched"); return "baseline: replacement delivered but the returned shipment keeps the order dispatched"; }
  assert.equal(stage, "delivered");
  return "returned shipment is a closed exception; replacement delivery closes the order";
});

scenario("G018-shortfall-never-closes", "018", async (ctx, candidate) => {
  await seedOrderShipments(ctx, "delivered", 980, null, 0);
  const stage = await syncStage(ctx);
  assert.equal(stage, "dispatched");
  const sc = await attempt(() => ctx.as(ids.dispatchManager, `select public.short_close_order_delivery_atomic('${ids.orderA}', 'Customer accepted 980 kg against 1000 kg plan') id`));
  if (!candidate) { assert.equal(sc.ok, false); return `baseline: 980/1000 kg stays dispatched; no short-close path (${sc.error})`; }
  assert.equal(sc.ok, true, sc.error);
  const [o] = await ctx.q(`select current_stage from public.orders where id='${ids.orderA}'`);
  assert.equal(o.current_stage, "delivered");
  const [c] = await ctx.q(`select delivered_weight_kg::numeric kg, closed_by::text from public.order_delivery_short_closures where order_id='${ids.orderA}'`);
  assert.equal(Number(c.kg), 980); assert.equal(c.closed_by, ids.dispatchManager);
  return "dispatch manager short-closed 980/1000 kg with a reason; order delivered and closure recorded";
});

scenario("G018-short-close-guards", "018", async (ctx) => {
  await seedOrderShipments(ctx, "delivered", 980, "in_transit", 20);
  const viewer = await attempt(() => ctx.as(ids.viewer, `select public.short_close_order_delivery_atomic('${ids.orderA}', 'viewer trying to close') id`));
  assert.equal(viewer.ok, false);
  const open = await attempt(() => ctx.as(ids.owner, `select public.short_close_order_delivery_atomic('${ids.orderA}', 'still a truck on the road') id`));
  assert.equal(open.ok, false); assert.match(open.error, /still in transit/);
  const direct = await attempt(() => ctx.as(ids.owner, `insert into public.order_delivery_short_closures (company_id, order_id, delivered_weight_kg, required_weight_kg, reason, closed_by, closed_by_role) values ('${ids.company}', '${ids.orderA}', 1, 1, 'forged closure row', '${ids.owner}', 'owner')`));
  assert.equal(direct.ok, false);
  return `viewer rejected; open shipment rejected (${open.error}); direct insert rejected`;
}, { candidateOnly: true });

scenario("G018-company-tolerance", "018", async (ctx) => {
  await seedOrderShipments(ctx, "delivered", 985, null, 0);
  await ctx.replica(`update public.company_settings set delivery_completion_tolerance_percent = 2 where company_id='${ids.company}'`);
  assert.equal(await syncStage(ctx), "delivered");
  return "985/1000 kg within a 2% company tolerance closes the order";
}, { candidateOnly: true });

// ---- EXOS-AUD-020 -------------------------------------------------------
const seedRunningJob = (ctx) => ctx.replica(`
  insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, quantity_pieces, length_per_piece_m, net_rate, gst_percent, finishing_type)
    values ('${lineA}', '${ids.company}', '${ids.orderA}', '${ids.profile}', 1000, 172, 5.8, 300, 18, 'mill_finish');
  insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, source_record_id, status, planned_quantity_kg, pieces, length_per_piece_m, extrusion_efficiency_percent, finishing_type, machine_id)
    values ('${ids.jobA}', '${ids.company}', 'J-A', '${ids.orderA}', '${ids.profile}', '${ids.die}', '${lineA}', '${ids.orderA}', 'in_progress', 1000, 172, 5.8, 85, 'mill_finish', '${ids.pressA}');
  insert into public.production_plan_slots (company_id, production_job_id, machine_id, planned_start_at, planned_end_at, status) values ('${ids.company}', '${ids.jobA}', '${ids.pressA}', now(), now() + interval '4 hours', 'released')`);

scenario("G020-renumber-die-while-running", "020", async (ctx, candidate) => {
  await seedRunningJob(ctx);
  const r = await attempt(() => ctx.as(ids.productionManager, `update public.dies set die_number='D-REUSED' where id='${ids.die}'`));
  const [d] = await ctx.q(`select die_number from public.dies where id='${ids.die}'`);
  if (!candidate) { assert.equal(d.die_number, "D-REUSED"); return "baseline: running die renumbered"; }
  assert.equal(r.ok, false); assert.equal(d.die_number, "D-100");
  return `rejected: ${r.error}`;
});

scenario("G020-manual-die-kpis", "020", async (ctx, candidate) => {
  const r = await attempt(() => ctx.as(ids.productionManager, `update public.dies set total_production_kg=250000, total_runs=900 where id='${ids.die}'`));
  const [d] = await ctx.q(`select total_production_kg::numeric kg, total_runs from public.dies where id='${ids.die}'`);
  if (!candidate) { assert.equal(Number(d.kg), 250000); return "baseline: production manager typed 250,000 kg / 900 runs"; }
  assert.equal(r.ok, false); assert.equal(Number(d.kg), 0);
  const owner = await attempt(() => ctx.as(ids.owner, `update public.dies set total_production_kg=5000, total_runs=12 where id='${ids.die}'`));
  assert.equal(owner.ok, true, owner.error);
  const [o] = await ctx.q(`select total_production_kg::numeric kg, opening_production_kg::numeric opening, total_runs from public.dies where id='${ids.die}'`);
  assert.equal(Number(o.opening), 5000); assert.equal(Number(o.kg), 5000); assert.equal(o.total_runs, 12);
  return `production manager rejected (${r.error}); owner recorded a 5,000 kg / 12-run opening balance`;
});

scenario("G020-usage-derived-from-completion", "020", async (ctx) => {
  await seedRunningJob(ctx);
  await ctx.replica(`update public.dies set opening_production_kg = 1000, total_production_kg = 1000, opening_runs = 2, total_runs = 2 where id='${ids.die}'`);
  const ex = await attempt(() => ctx.as(ids.productionManager, `select public.record_production_input_exception('${ids.jobA}', 'Customer-supplied billets, weighed at gate', 'customer_supplied') id`));
  assert.equal(ex.ok, true, ex.error);
  const c = await attempt(() => ctx.as(ids.production, `select public.complete_production_job_atomic('${ids.jobA}', 600, 100, null, 0, 'run') id`));
  assert.equal(c.ok, true, c.error);
  const [d] = await ctx.q(`select total_production_kg::numeric kg, total_runs, last_used_date = current_date used_today, total_good_output_kg::numeric good from public.dies where id='${ids.die}'`);
  assert.equal(Number(d.kg), 1600); assert.equal(d.total_runs, 3); assert.equal(d.used_today, true); assert.equal(Number(d.good), 600);
  return `completion refreshed die usage -> ${JSON.stringify(d)}`;
}, { candidateOnly: true });

// ---- EXOS-AUD-025 -------------------------------------------------------
scenario("G025-small-packaging-unlocks-all-output", "025", async (ctx, candidate) => {
  await seedPackedOutputForOrderB(ctx);
  const disp = "f6250000-0000-4000-8000-000000000001";
  await ctx.replica(`
    update public.production_jobs set actual_quantity_kg = 600, actual_pieces = 100, actual_meters = 580 where id='${ids.jobB}';
    update public.quality_inspections set quantity_checked_kg = 600 where production_job_id='${ids.jobB}';
    update public.packaging_jobs set profile_weight_kg = 50 where production_job_id='${ids.jobB}';
    insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status)
      values ('${disp}', '${ids.company}', '${ids.orderB}', 'D-25', current_date, 1, 600, 0, 'pending');
    insert into public.packing_list_items (company_id, dispatch_id, profile_id, bundle_number, source_kind, source_record_id, source_line_id, number_of_pieces, net_length_m, gross_weight_kg, tare_weight_kg, operator_verified_at, operator_verified_by, order_item_id, net_rate, gst_percent)
      values ('${ids.company}', '${disp}', '${ids.profile}', 'B1', 'production', '${ids.orderB}', '${ids.jobB}', 100, 580, 600, 0, now(), '${ids.dispatch}', '${lineB}', 300, 18)`);
  const r = await attempt(() => ctx.q(`select private.assert_dispatch_ready('${disp}') x`));
  if (!candidate) { assert.equal(r.ok, true, r.error); return "baseline: 50 kg of completed packaging released 600 kg for dispatch"; }
  assert.equal(r.ok, false); assert.match(r.error, /packaged output/);
  await ctx.replica(`update public.packaging_jobs set profile_weight_kg = 600 where production_job_id='${ids.jobB}'`);
  const ok = await attempt(() => ctx.q(`select private.assert_dispatch_ready('${disp}') x`));
  assert.equal(ok.ok, true, ok.error);
  return `rejected (${r.error}); fully packed 600 kg passes`;
});

// ---- EXOS-AUD-014 -------------------------------------------------------
scenario("G014-complete-without-input", "014", async (ctx, candidate) => {
  await seedRunningJob(ctx);
  const r = await attempt(() => ctx.as(ids.production, `select public.complete_production_job_atomic('${ids.jobA}', 900, 150, null, 0, 'no billets') id`));
  if (!candidate) { assert.equal(r.ok, true, r.error); return "baseline: 900 kg output completed with no metal input"; }
  assert.equal(r.ok, false); assert.match(r.error, /input exception/);
  const op = await attempt(() => ctx.as(ids.production, `select public.record_production_input_exception('${ids.jobA}', 'operator wants to skip billets') id`));
  assert.equal(op.ok, false, "operators cannot grant their own exception");
  const direct = await attempt(() => ctx.as(ids.productionManager, `insert into public.production_input_exceptions (company_id, production_job_id, reason, recorded_by, recorded_by_role) values ('${ids.company}', '${ids.jobA}', 'forged exception row', '${ids.productionManager}', 'production_manager')`));
  assert.equal(direct.ok, false);
  const pm = await attempt(() => ctx.as(ids.productionManager, `select public.record_production_input_exception('${ids.jobA}', 'Trial run on customer-supplied billets') id`));
  assert.equal(pm.ok, true, pm.error);
  const done = await attempt(() => ctx.as(ids.production, `select public.complete_production_job_atomic('${ids.jobA}', 900, 150, null, 0, 'with exception') id`));
  assert.equal(done.ok, true, done.error);
  return `rejected without evidence (${r.error}); operator self-exception and direct insert rejected; manager exception allows completion`;
});

// ---- EXOS-AUD-033 -------------------------------------------------------
scenario("G033-viewer-writes-tenant-only-tables", "033", async (ctx, candidate) => {
  const v = await attempt(() => ctx.as(ids.viewer, `insert into public.vendors (company_id, vendor_name, vendor_type) values ('${ids.company}', 'Viewer Vendor', 'aluminum_billets') returning id`));
  const m = await attempt(() => ctx.as(ids.viewer, `insert into public.profile_defect_rules (company_id, profile_id) values ('${ids.company}', '${ids.profile}') returning id`));
  const [pol] = await ctx.q(`select count(*)::int n from pg_policies where tablename='production_jobs' and cmd in ('INSERT','UPDATE') and coalesce(qual,'')||coalesce(with_check,'') !~ 'get_current_user_role'`);
  if (!candidate) { assert.equal(v.ok, true, v.error); assert.equal(pol.n, 2); return `baseline: viewer created a vendor; production_jobs has ${pol.n} tenant-only write policies (defect rule: ${m.ok ? "created" : m.error})`; }
  assert.equal(v.ok, false); assert.equal(m.ok, false); assert.equal(pol.n, 0);
  const pm = await attempt(() => ctx.as(ids.productionManager, `insert into public.vendors (company_id, vendor_name, vendor_type) values ('${ids.company}', 'PM Vendor', 'aluminum_billets') returning id`));
  assert.equal(pm.ok, true, pm.error);
  return "viewer vendor and defect-rule inserts rejected; production_jobs policies are role-explicit; production manager can still add a vendor";
});

scenario("G033-policy-lint", "033", async (ctx) => {
  const allow = new Set(["audit_logs", "audit_logs_enterprise", "notifications", "outbound_messages", "dealer_order_status_history", "inventory_movements", "company_settings"]);
  const rows = await ctx.q(`select tablename, policyname, cmd from pg_policies where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
    and coalesce(qual,'')||coalesce(with_check,'') !~ '(get_current_user_role|is_owner_or_admin|current_user_has_permission|auth\\.uid|dealer_id|user_id|created_by)'`);
  const offenders = rows.filter((row) => !allow.has(row.tablename));
  assert.deepEqual(offenders, []);
  return `${rows.length} tenant-only write policies remain, all on reviewed tables: ${[...new Set(rows.map((r) => r.tablename))].join(", ")}`;
}, { candidateOnly: true });

// ---- EXOS-AUD-011 follow-up: audited amendment ---------------------------
const d11 = "f6110000-0000-4000-8000-000000000001";
const seedShipped = (ctx) => ctx.replica(`insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status, actual_dispatched_at, eway_bill_number, vehicle_number, transporter_name)
  values ('${d11}', '${ids.company}', '${ids.orderA}', 'D-11', current_date, 1, 10, 0, 'dispatched', now(), 'EWB-111', 'MH01AB1234', 'Shree Roadlines')`);
scenario("G011-amend-recorded-eway-bill", "011", async (ctx, candidate) => {
  await seedShipped(ctx);
  const direct = await attempt(() => ctx.as(ids.dispatch, `update public.dispatches set eway_bill_number='EWB-222' where id='${d11}'`));
  assert.equal(direct.ok, false, "Wave 1 freeze holds in both builds"); assert.match(direct.error, /frozen/);
  const lateLr = await attempt(() => ctx.as(ids.dispatch, `update public.dispatches set lr_number='LR-LATE' where id='${d11}'`));
  assert.equal(lateLr.ok, true, lateLr.error);
  await ctx.replica(`update public.dispatches set lr_number=null where id='${d11}'`);
  const r = await attempt(() => ctx.as(ids.dispatch, `select public.amend_dispatch_transport_documents('${d11}', '{"eway_bill_number":"EWB-222","lr_number":"LR-9"}'::jsonb, 'Portal regenerated the e-way bill after vehicle change') n`));
  if (!candidate) { assert.equal(r.ok, false); return `baseline: no amendment path (${r.error})`; }
  assert.equal(r.ok, true, r.error); assert.equal(r.value[0].n, 2);
  const [d] = await ctx.q(`select eway_bill_number, lr_number from public.dispatches where id='${d11}'`);
  assert.equal(d.eway_bill_number, "EWB-222"); assert.equal(d.lr_number, "LR-9");
  const log = await ctx.q(`select field_name, old_value, new_value, amended_by::text actor from public.dispatch_document_amendments where dispatch_id='${d11}' order by field_name`);
  assert.equal(log.length, 2); assert.equal(log[0].old_value, "EWB-111"); assert.equal(log[0].actor, ids.dispatch);
  const viewer = await attempt(() => ctx.as(ids.viewer, `select public.amend_dispatch_transport_documents('${d11}', '{"vehicle_number":"X"}'::jsonb, 'viewer trying an amendment') n`));
  assert.equal(viewer.ok, false);
  const after = await attempt(() => ctx.as(ids.dispatch, `update public.dispatches set eway_bill_number='EWB-333' where id='${d11}'`));
  assert.equal(after.ok, false, "freeze still applies outside the RPC"); assert.match(after.error, /frozen/);
  return `amended with audit rows ${JSON.stringify(log)}; viewer rejected; direct edit still frozen`;
});

// ---- EXOS-AUD-008 follow-up / 027 ---------------------------------------
scenario("G027-breakdown-locks-press-and-signoff", "027", async (ctx, candidate) => {
  const ins = await attempt(() => ctx.as(ids.productionManager, `insert into public.breakdown_logs (company_id, machine_id, machine_type, breakdown_date, start_time, issue_description, status)
    values ('${ids.company}', 'PB', 'extrusion_press', current_date, now() - interval '3 hours', 'Main cylinder seal leak', 'open') returning id`));
  assert.equal(ins.ok, true, ins.error);
  const [m1] = await ctx.q(`select status from public.machines where id='${ids.pressB}'`);
  if (!candidate) { assert.equal(m1.status, "active"); return "baseline: logging a press breakdown leaves the press active and schedulable"; }
  assert.equal(m1.status, "breakdown");
  const [b] = await ctx.q(`select machine_ref_id::text ref from public.breakdown_logs where id='${ins.value[0].id}'`);
  assert.equal(b.ref, ids.pressB);
  const direct = await attempt(() => ctx.as(ids.productionManager, `update public.machines set status='active' where id='${ids.pressB}'`));
  assert.equal(direct.ok, false);
  const early = await attempt(() => ctx.as(ids.productionManager, `select public.return_machine_to_service_atomic('${ids.pressB}', 'Seal replaced and pressure tested') id`));
  assert.equal(early.ok, false); assert.match(early.error, /open breakdown/);
  await ctx.as(ids.productionManager, `update public.breakdown_logs set status='resolved', root_cause='Seal wear', action_taken='Replaced seal' where id='${ins.value[0].id}'`);
  const [res] = await ctx.q(`select downtime_minutes, resolved_by_user_id::text actor from public.breakdown_logs where id='${ins.value[0].id}'`);
  assert.ok(res.downtime_minutes >= 179); assert.equal(res.actor, ids.productionManager);
  const ok = await attempt(() => ctx.as(ids.productionManager, `select public.return_machine_to_service_atomic('${ids.pressB}', 'Seal replaced and pressure tested') id`));
  assert.equal(ok.ok, true, ok.error);
  const [m2] = await ctx.q(`select status from public.machines where id='${ids.pressB}'`);
  assert.equal(m2.status, "active");
  return `breakdown locked press B; direct return and early sign-off rejected; resolved (${res.downtime_minutes} min) then signed off`;
});

scenario("G027-overlap-unknown-machine-and-spares", "027", async (ctx) => {
  const unknown = await attempt(() => ctx.as(ids.productionManager, `insert into public.breakdown_logs (company_id, machine_id, machine_type, breakdown_date, status, issue_description) values ('${ids.company}', 'Press Z', 'extrusion_press', current_date, 'open', 'x')`));
  assert.equal(unknown.ok, false);
  await ctx.as(ids.productionManager, `insert into public.breakdown_logs (company_id, machine_id, machine_type, breakdown_date, start_time, end_time, status, issue_description) values ('${ids.company}', 'PA', 'extrusion_press', current_date, now() - interval '5 hours', now() - interval '3 hours', 'resolved', 'Heater coil')`);
  const overlap = await attempt(() => ctx.as(ids.productionManager, `insert into public.breakdown_logs (company_id, machine_id, machine_type, breakdown_date, start_time, end_time, status, issue_description) values ('${ids.company}', 'PA', 'extrusion_press', current_date, now() - interval '4 hours', now() - interval '2 hours', 'resolved', 'Overlap')`));
  assert.equal(overlap.ok, false); assert.match(overlap.error, /overlaps/);
  const part = "f2900000-0000-4000-8000-000000000001";
  await ctx.replica(`insert into public.maintenance_spare_parts (id, company_id, part_code, part_name, unit, current_stock, average_rate) values ('${part}', '${ids.company}', 'SP1', 'Seal kit', 'nos', 10, 500)`);
  const [bd] = await ctx.q(`select id from public.breakdown_logs where machine_ref_id='${ids.pressA}'`);
  const [use] = await ctx.as(ids.productionManager, `insert into public.breakdown_spare_part_usage (company_id, breakdown_id, spare_part_id, quantity_used, rate) values ('${ids.company}', '${bd.id}', '${part}', 3, 0) returning id`);
  const [mid] = await ctx.q(`select current_stock::numeric s from public.maintenance_spare_parts where id='${part}'`);
  assert.equal(Number(mid.s), 7);
  await ctx.as(ids.owner, `delete from public.breakdown_spare_part_usage where id='${use.id}'`);
  const [p] = await ctx.q(`select current_stock::numeric s from public.maintenance_spare_parts where id='${part}'`);
  assert.equal(Number(p.s), 10);
  return `unknown machine rejected (${unknown.error}); overlapping downtime rejected; deleted spare usage restored stock 7 -> ${p.s}`;
}, { candidateOnly: true });

scenario("G027-maintenance-schedule-rolls-forward", "027", async (ctx) => {
  const [s] = await ctx.as(ids.productionManager, `insert into public.maintenance_schedules (company_id, machine_id, machine_type, maintenance_type, frequency_type, frequency_value, last_done_date, status)
    values ('${ids.company}', 'PA', 'extrusion_press', 'preventive', 'monthly', 1, current_date - 40, 'scheduled') returning id, status`);
  assert.equal(s.status, "overdue");
  const c = await attempt(() => ctx.as(ids.productionManager, `select public.complete_maintenance_schedule_atomic('${s.id}', current_date, 'Oil changed') id`));
  assert.equal(c.ok, true, c.error);
  const [after] = await ctx.q(`select status, next_due_date > current_date future from public.maintenance_schedules where id='${s.id}'`);
  assert.equal(after.status, "scheduled"); assert.equal(after.future, true);
  return `40-day-old monthly schedule saved as overdue; completion rolled it forward -> ${JSON.stringify(after)}`;
}, { candidateOnly: true });

// ---- EXOS-AUD-023 -------------------------------------------------------
scenario("G023-backdated-financial-entries", "023", async (ctx, candidate) => {
  const lock = await attempt(() => ctx.as(ids.accounts, `select public.set_books_locked_through((date_trunc('month', current_date) - interval '1 day')::date, 'September GST return filed') id`));
  if (!candidate) { assert.equal(lock.ok, false); return `baseline: no period lock exists (${lock.error})`; }
  assert.equal(lock.ok, true, lock.error);
  const inv = "f8800000-0000-4000-8000-000000000001";
  const r = await attempt(() => ctx.q(`insert into public.invoices (id, company_id, invoice_number, customer_id, invoice_date, status) values ('${inv}', '${ids.company}', 'INV-OLD', '${ids.customer}', current_date - 60, 'draft')`));
  assert.equal(r.ok, false); assert.match(r.error, /Books are closed/);
  const reopen = await attempt(() => ctx.as(ids.accounts, `select public.set_books_locked_through(current_date - 90, 'accounts trying to reopen') id`));
  assert.equal(reopen.ok, false);
  const owner = await attempt(() => ctx.as(ids.owner, `select public.set_books_locked_through(current_date - 90, 'Owner reopened for audit correction') id`));
  assert.equal(owner.ok, true, owner.error);
  const [n] = await ctx.q(`select count(*)::int n from public.accounting_period_locks`);
  assert.equal(n.n, 2);
  return `closed-period invoice rejected (${r.error}); accounts cannot reopen; owner reopen recorded`;
});

scenario("G023-payment-before-invoice", "023", async (ctx) => {
  const inv = "f8800000-0000-4000-8000-000000000002";
  await ctx.replica(`insert into public.invoices (id, company_id, invoice_number, customer_id, invoice_date, status) values ('${inv}', '${ids.company}', 'INV-2', '${ids.customer}', current_date - 5, 'sent')`);
  const r = await attempt(() => ctx.q(`insert into public.payments (company_id, invoice_id, payment_date, amount) values ('${ids.company}', '${inv}', current_date - 10, 100)`));
  assert.equal(r.ok, false); assert.match(r.error, /predate its invoice/);
  return `rejected: ${r.error}`;
}, { candidateOnly: true });

// ---- EXOS-AUD-029 -------------------------------------------------------
scenario("G029-implausible-receipt", "029", async (ctx, candidate) => {
  const huge = await attempt(() => ctx.as(ids.productionManager, `insert into public.foundry_external_aluminium_sources (company_id, item_type, quantity, weight_kg, vendor_id, received_date, alloy, status, source_origin) values ('${ids.company}', 'aluminum_ingot', 1, 100000000, '${ids.vendor}', current_date, '6063', 'available', 'purchased') returning id`));
  if (!candidate) { assert.equal(huge.ok, true, huge.error); return "baseline: a 100,000 t ingot receipt was accepted"; }
  assert.equal(huge.ok, false); assert.match(huge.error, /exceeds the company limit/);
  const noSlip = await attempt(() => ctx.as(ids.productionManager, `insert into public.foundry_external_aluminium_sources (company_id, item_type, quantity, weight_kg, vendor_id, received_date, alloy, status, source_origin) values ('${ids.company}', 'aluminum_ingot', 1, 20000, '${ids.vendor}', current_date, '6063', 'available', 'purchased') returning id`));
  assert.equal(noSlip.ok, false); assert.match(noSlip.error, /weighbridge/);
  const ok = await attempt(() => ctx.as(ids.productionManager, `insert into public.foundry_external_aluminium_sources (company_id, item_type, quantity, weight_kg, vendor_id, received_date, alloy, status, source_origin, weighbridge_reference) values ('${ids.company}', 'aluminum_ingot', 1, 20000, '${ids.vendor}', current_date, '6063', 'available', 'purchased', 'WB-5521') returning id`));
  assert.equal(ok.ok, true, ok.error);
  return "100,000 t rejected; 20 t without slip rejected; 20 t with weighbridge slip accepted";
});

// ---- EXOS-AUD-006 / 005 / 002 reversal ----------------------------------
const seedBilletedRunningJob = async (ctx, inputKg = 1000) => {
  await seedRunningJob(ctx);
  const fb = "f7000000-0000-4000-8000-000000000006";
  const req = "f7100000-0000-4000-8000-000000000006";
  await ctx.replica(`
    insert into public.foundry_batches (id, company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, status, billet_weight_density_kg, batch_sequence, production_date)
      values ('${fb}', '${ids.company}', 'FB-6', 'F1', '6063', 'T6', 1000, 101.6, 4, 1, 2700, 0, 100, 'ready', ${inputKg}, 6, current_date);
    insert into public.order_billet_requirements (id, company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billets_required, billets_allocated, status)
      values ('${req}', '${ids.company}', '${ids.orderA}', '${ids.profile}', '6063', 'T6', 4, 1, 1, 'complete');
    insert into public.foundry_billets (company_id, source_type, foundry_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status, order_id, allocation_requirement_id, production_job_id, allocated_at, allocated_by)
      values ('${ids.company}', 'in_house', '${fb}', 'F1-' || to_char(current_date,'YYYYMMDD') || '-6-1', 1, 4, 101.6, 1000, '6063', 'T6', ${inputKg}, 'issued', '${ids.orderA}', '${req}', '${ids.jobA}', now(), '${ids.owner}')`);
};

scenario("G006-completion-loss-is-all-clean-scrap", "006", async (ctx, candidate) => {
  await seedBilletedRunningJob(ctx);
  const r = await attempt(() => ctx.as(ids.production, `select public.complete_production_job_atomic('${ids.jobA}', 600, 100, null, 400, 'legacy single figure') id`));
  assert.equal(r.ok, true, r.error);
  const lots = await ctx.q(`select weight_kg::numeric kg from public.foundry_aluminium_scrap where scrap_source='in_house'`);
  if (!candidate) { assert.equal(lots.length, 1); assert.equal(Number(lots[0].kg), 400); return "baseline: the whole 400 kg loss became a clean, alloy-less furnace lot"; }
  assert.equal(lots.length, 0);
  const [line] = await ctx.q(`select category, recoverable from public.production_scrap_lines where production_job_id='${ids.jobA}'`);
  assert.equal(line.category, "unclassified"); assert.equal(line.recoverable, false);
  return "uncategorised loss is recorded but does not become furnace metal";
});

scenario("G006-categorised-scrap-lines", "006", async (ctx) => {
  await seedBilletedRunningJob(ctx);
  const r = await attempt(() => ctx.as(ids.production, `select public.complete_production_job_with_scrap_atomic('${ids.jobA}', 600, 100, null,
    '[{"category":"butt_end","weight_kg":250},{"category":"saw_cut","weight_kg":50},{"category":"unrecoverable_loss","weight_kg":100}]'::jsonb, 'categorised') id`));
  assert.equal(r.ok, true, r.error);
  const lots = await ctx.q(`select weight_kg::numeric kg, alloy, scrap_category from public.foundry_aluminium_scrap where scrap_source='in_house' order by weight_kg desc`);
  assert.deepEqual(lots.map((l) => [Number(l.kg), l.alloy, l.scrap_category]), [[250, "6063", "butt_end"], [50, "6063", "saw_cut"]]);
  const [rec] = await ctx.q(`select weight_kg::numeric kg, scrap_category, recoverable, alloy from public.scrap_records where production_job_id='${ids.jobA}'`);
  assert.equal(Number(rec.kg), 400); assert.equal(rec.scrap_category, "categorised"); assert.equal(rec.recoverable, true);
  const bad = await attempt(() => ctx.as(ids.production, `select public.complete_production_job_with_scrap_atomic('${ids.jobA}', 600, 100, null, '[{"category":"magic","weight_kg":1}]'::jsonb, null) id`));
  assert.equal(bad.ok, false);
  return `400 kg loss: 300 kg recoverable in two 6063 lots, 100 kg unrecoverable; mass balance held -> ${JSON.stringify(lots)}`;
}, { candidateOnly: true });

scenario("G002r-reverse-scrap-posting", "002", async (ctx) => {
  await seedBilletedRunningJob(ctx);
  await ctx.as(ids.production, `select public.complete_production_job_with_scrap_atomic('${ids.jobA}', 600, 100, null, '[{"category":"butt_end","weight_kg":400}]'::jsonb, null)`);
  const [rec] = await ctx.q(`select id from public.scrap_records where production_job_id='${ids.jobA}'`);
  const op = await attempt(() => ctx.as(ids.production, `select public.reverse_process_scrap_posting('${rec.id}', 'Operator keyed 400 instead of 40') id`));
  assert.equal(op.ok, false, "operators cannot reverse");
  const pm = await attempt(() => ctx.as(ids.productionManager, `select public.reverse_process_scrap_posting('${rec.id}', 'Operator keyed 400 instead of 40') id`));
  assert.equal(pm.ok, true, pm.error);
  const [lot] = await ctx.q(`select status from public.foundry_aluminium_scrap where source_scrap_record_id='${rec.id}'`);
  assert.equal(lot.status, "rejected");
  const again = await attempt(() => ctx.as(ids.productionManager, `select public.reverse_process_scrap_posting('${rec.id}', 'second reversal attempt') id`));
  assert.equal(again.ok, false);
  return "manager reversal retired the unconsumed lot; operator and double reversal rejected";
}, { candidateOnly: true });

scenario("G002r-consumed-lot-cannot-reverse", "002", async (ctx) => {
  await seedBilletedRunningJob(ctx);
  await ctx.as(ids.production, `select public.complete_production_job_with_scrap_atomic('${ids.jobA}', 600, 100, null, '[{"category":"butt_end","weight_kg":400}]'::jsonb, null)`);
  const [rec] = await ctx.q(`select id from public.scrap_records where production_job_id='${ids.jobA}'`);
  await ctx.replica(`update public.foundry_aluminium_scrap set available_weight_kg = 100, status = 'reserved' where source_scrap_record_id='${rec.id}'`);
  const r = await attempt(() => ctx.as(ids.productionManager, `select public.reverse_process_scrap_posting('${rec.id}', 'Too late, lot already charged') id`));
  assert.equal(r.ok, false); assert.match(r.error, /already been charged/);
  return `rejected: ${r.error}`;
}, { candidateOnly: true });

const scrapLot = "99999999-0000-4000-8000-000000000005";
const seedForeignAlloyCharge = (ctx, lotAlloy) => ctx.replica(`
  insert into public.foundry_aluminium_scrap (id, company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, scrap_quality, status, vendor_id, alloy)
    values ('${scrapLot}', '${ids.company}', 'SCR-A', 'incoming', 1000, 1000, 'clean', 'available', '${ids.vendor}', ${lotAlloy ? `'${lotAlloy}'` : "null"})`);
const ext5 = "f7400000-0000-4000-8000-000000000005";
const chargeSql = `insert into public.foundry_batches (company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, status, batch_sequence, production_date, scrap_id, external_source_id, furnace_efficiency_percent)
  values ('${ids.company}', 'FB-5', 'F1', '6063', 'T6', 1000, 101.6, 4, 4, 2700, 50, 50, 'planned', 5, current_date, '${scrapLot}', '${ext5}', 100) returning id, scrap_aluminium_kg`;
const seedPrimaryIngot = (ctx) => ctx.replica(`insert into public.foundry_external_aluminium_sources (id, company_id, source_number, item_type, quantity, weight_kg, available_weight_kg, vendor_id, source_origin, received_date, alloy, status)
  values ('${ext5}', '${ids.company}', 'EAS-5', 'aluminum_ingot', 1, 1000, 1000, '${ids.vendor}', 'purchased', current_date, 'P1020', 'available')`);

scenario("G005-foreign-alloy-charge", "005", async (ctx, candidate) => {
  await seedPrimaryIngot(ctx);
  if (candidate) await seedForeignAlloyCharge(ctx, "6061");
  else await ctx.replica(`insert into public.foundry_aluminium_scrap (id, company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, scrap_quality, status, vendor_id) values ('${scrapLot}', '${ids.company}', 'SCR-A', 'incoming', 1000, 1000, 'clean', 'available', '${ids.vendor}')`);
  const r = await attempt(() => ctx.sys(ids.productionManager, chargeSql));
  if (!candidate) { assert.equal(r.ok, true, r.error); assert.ok(Number(r.value[0].scrap_aluminium_kg) > 0); return `baseline: alloy-less scrap charged into a 6063 batch (${r.value[0].scrap_aluminium_kg} kg)`; }
  assert.equal(r.ok, false); assert.match(r.error, /not compatible/);
  const dev = await attempt(() => ctx.as(ids.quality, `select public.approve_foundry_alloy_deviation('foundry_aluminium_scrap', '${scrapLot}', '6063', 'Diluted below 10% of charge; Cu within 6063 limit') id`));
  assert.equal(dev.ok, true, dev.error);
  const ok = await attempt(() => ctx.sys(ids.productionManager, chargeSql));
  assert.equal(ok.ok, true, ok.error);
  return `6061 lot rejected (${r.error}); accepted after an approved deviation`;
});

scenario("G005-compatible-and-unknown-alloy", "005", async (ctx) => {
  await seedPrimaryIngot(ctx);
  await seedForeignAlloyCharge(ctx, "AA 6063");
  const same = await attempt(() => ctx.sys(ids.productionManager, chargeSql));
  assert.equal(same.ok, true, same.error);
  await ctx.replica(`delete from public.foundry_billets; delete from public.foundry_batches; delete from public.foundry_aluminium_scrap; update public.foundry_external_aluminium_sources set available_weight_kg = weight_kg, status = 'available'`);
  await seedForeignAlloyCharge(ctx, null);
  const unknown = await attempt(() => ctx.sys(ids.productionManager, chargeSql));
  assert.equal(unknown.ok, false);
  const setOnce = await attempt(() => ctx.as(ids.productionManager, `update public.foundry_aluminium_scrap set alloy='6063' where id='${scrapLot}'`));
  assert.equal(setOnce.ok, true, setOnce.error);
  const change = await attempt(() => ctx.as(ids.productionManager, `update public.foundry_aluminium_scrap set alloy='6082' where id='${scrapLot}'`));
  assert.equal(change.ok, false);
  return "same alloy (AA 6063 = 6063) accepted; unknown alloy rejected until set; alloy set once";
}, { candidateOnly: true });

// ---- EXOS-AUD-022 -------------------------------------------------------
const item = "f9220000-0000-4000-8000-000000000001";
const seedItem = (ctx) => ctx.replica(`insert into public.inventory_items (id, company_id, item_code, item_name, item_category, unit, current_stock, average_rate) values ('${item}', '${ids.company}', 'ING-1', 'Ingot', 'billets', 'kg', 100, 200)`);
scenario("G022-ledger-decoupled-from-balance", "022", async (ctx, candidate) => {
  await seedItem(ctx);
  const mv = await attempt(() => ctx.as(ids.viewer, `insert into public.inventory_movements (company_id, inventory_item_id, movement_type, quantity, unit) values ('${ids.company}', '${item}', 'adjustment_in', 9999, 'kg')`));
  const edit = await attempt(() => ctx.as(ids.inventoryManager, `update public.inventory_items set current_stock = 5000 where id='${item}' returning current_stock`));
  const [it] = await ctx.q(`select current_stock::numeric s from public.inventory_items where id='${item}'`);
  if (!candidate) { assert.equal(mv.ok, true, mv.error); assert.equal(Number(it.s), 5000); return "baseline: viewer posted 9,999 kg with no balance change; manager typed the balance"; }
  assert.equal(mv.ok, false); assert.equal(edit.ok, false); assert.equal(Number(it.s), 100);
  const adj = await attempt(() => ctx.as(ids.inventoryManager, `select public.post_inventory_adjustment('${item}', 'out', 30, 'Physical count 21 Oct, shortage') id`));
  assert.equal(adj.ok, true, adj.error);
  const neg = await attempt(() => ctx.as(ids.inventoryManager, `select public.post_inventory_adjustment('${item}', 'out', 500, 'Trying to go negative here') id`));
  assert.equal(neg.ok, false);
  const [rec] = await ctx.q(`select current_stock::numeric s from public.inventory_items where id='${item}'`);
  assert.equal(Number(rec.s), 70);
  return `direct movement and balance edit rejected; adjustment moved 100 -> 70 with a movement; negative rejected`;
});

// ---- EXOS-AUD-013 -------------------------------------------------------
scenario("G013-stock-without-origin", "013", async (ctx, candidate) => {
  const direct = await attempt(() => ctx.as(ids.inventoryManager, `insert into public.profile_stock_batches (company_id, profile_id, finish, length_m, quantity_pieces, total_weight_kg, status) values ('${ids.company}', '${ids.profile}', 'mill_finish', 580, 100, 580, 'available') returning id`));
  if (!candidate) { assert.equal(direct.ok, true, direct.error); return "baseline: factory stock typed in with no origin or QC"; }
  assert.equal(direct.ok, false);
  const dealer = await attempt(() => ctx.as(ids.dealerStaff, `insert into public.profile_stock_batches (company_id, dealer_id, profile_id, finish, length_m, piece_length_m, quantity_pieces, total_weight_kg, status) values ('${ids.company}', '${ids.dealer}', '${ids.profile}', 'mill_finish', 5.8, 5.8, 10, 58, 'available') returning id, length_m, qc_status`));
  assert.equal(dealer.ok, true, dealer.error); assert.equal(Number(dealer.value[0].length_m), 58); assert.equal(dealer.value[0].qc_status, "not_required");
  const off = await attempt(() => ctx.as(ids.dealerStaff, `insert into public.profile_stock_batches (company_id, dealer_id, profile_id, finish, piece_length_m, quantity_pieces, total_weight_kg, status) values ('${ids.company}', '${ids.dealer}', '${ids.profile}', 'mill_finish', 5.8, 10, 200, 'available')`));
  assert.equal(off.ok, false); assert.match(off.error, /reconcile/);
  return `factory direct insert rejected; dealer entry stores 58 total metres (10 x 5.8); 200 kg for 58 kg of section rejected`;
});

scenario("G013-surplus-and-qc-hold", "013", async (ctx) => {
  await seedPackedOutputForOrderB(ctx);
  const over = await attempt(() => ctx.as(ids.inventoryManager, `select public.create_stock_from_production_surplus('${ids.jobB}', 50, 9, 5.8) id`));
  assert.equal(over.ok, false, "only 10 kg is QC-released");
  const ok = await attempt(() => ctx.as(ids.inventoryManager, `select public.create_stock_from_production_surplus('${ids.jobB}', 10, 2, 5) id`));
  assert.equal(ok.ok, true, ok.error);
  const [b] = await ctx.q(`select origin_type, qc_status, alloy, production_job_id::text job from public.profile_stock_batches where id='${ok.value[0].id}'`);
  assert.equal(b.origin_type, "production_surplus"); assert.equal(b.qc_status, "released"); assert.equal(b.job, ids.jobB);
  const open = await attempt(() => ctx.as(ids.owner, `select public.record_opening_stock_batch('${ids.profile}', 'mill_finish', 58, 10, 5.8, '6063', 'T6', 'OB-1', 'Store', 'Stock-take sheet 21-10-2026') id`));
  assert.equal(open.ok, true, open.error);
  const res = await attempt(() => ctx.q(`insert into public.profile_stock_reservations (company_id, profile_stock_batch_id, profile_id, order_id, reserved_weight_kg, reserved_length_m, status) values ('${ids.company}', '${open.value[0].id}', '${ids.profile}', '${ids.orderA}', 10, 10, 'active')`));
  assert.equal(res.ok, false); assert.match(res.error, /QC/);
  const rel = await attempt(() => ctx.as(ids.quality, `select public.release_stock_batch_qc('${open.value[0].id}', 'released', 'Checked') id`));
  assert.equal(rel.ok, true, rel.error);
  return `over-release rejected; 10 kg surplus stocked with job lineage (${JSON.stringify(b)}); opening stock held until QC release`;
}, { candidateOnly: true });

// ---- EXOS-AUD-001 -------------------------------------------------------
const fb1 = "f7000000-0000-4000-8000-000000000001";
const ext1 = "f7400000-0000-4000-8000-000000000001";
const seedMeltingBatch = async (ctx) => {
  await ctx.replica(`
    insert into public.foundry_external_aluminium_sources (id, company_id, source_number, item_type, quantity, weight_kg, available_weight_kg, vendor_id, source_origin, received_date, alloy, status)
      values ('${ext1}', '${ids.company}', 'EAS-1', 'aluminum_ingot', 1, 1000, 1000, '${ids.vendor}', 'purchased', current_date, '6063', 'available');
    insert into public.foundry_batches (id, company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, status, billet_weight_density_kg, batch_sequence, production_date, furnace_efficiency_percent, external_source_id, external_aluminium_kg)
      values ('${fb1}', '${ids.company}', 'FB-1', 'F1', '6063', 'T6', 1000, 101.6, 4, 3, 2700, 0, 100, 'planned', 21.89, 1, current_date, 100, '${ext1}', 0)`);
  // Normalise through the live calculation and billet sync while planned, then melt.
  await ctx.sys(ids.productionManager, `update public.foundry_batches set notes = 'gate' where id='${fb1}'`);
  await ctx.sys(ids.productionManager, `update public.foundry_batches set status = 'melting' where id='${fb1}'`);
};
const billets1 = (ctx) => ctx.q(`select billet_number n, status, (to_jsonb(b) ->> 'measured_weight_kg')::numeric m from public.foundry_billets b where foundry_batch_id='${fb1}' order by billet_number`);

scenario("G001-cast-billets-allocatable-immediately", "001", async (ctx, candidate) => {
  await seedMeltingBatch(ctx);
  const cast = await attempt(() => ctx.sys(ids.productionManager, `update public.foundry_batches set status='cast' where id='${fb1}'`));
  assert.equal(cast.ok, true, cast.error);
  const rows = await billets1(ctx);
  if (!candidate) { assert.ok(rows.every((b) => b.status === "cast")); return "baseline: all 3 planned billets became allocatable stock at 'cast'"; }
  assert.ok(rows.every((b) => b.status === "planned"), JSON.stringify(rows));
  const early = await attempt(() => ctx.sys(ids.productionManager, `update public.foundry_batches set status='ready' where id='${fb1}'`));
  assert.equal(early.ok, false); assert.match(early.error, /cast result/);
  return `billets stay planned after casting; release without a cast result rejected (${early.error})`;
});

scenario("G001-cast-result-chemistry-release", "001", async (ctx) => {
  await seedMeltingBatch(ctx);
  await ctx.sys(ids.productionManager, `update public.foundry_batches set status='cast' where id='${fb1}'`);
  const cr = await attempt(() => ctx.as(ids.production, `select public.record_foundry_cast_result('${fb1}', 2, 43.2, 3.5, 'Cold shut on billet 3') id`));
  assert.equal(cr.ok, true, cr.error);
  let rows = await billets1(ctx);
  assert.deepEqual(rows.map((b) => b.status), ["planned", "planned", "scrap"]);
  assert.equal(Number(rows[0].m), 21.6);
  const [lot] = await ctx.q(`select weight_kg::numeric kg, alloy, scrap_category from public.foundry_aluminium_scrap where scrap_category='casting_reject'`);
  const [batch] = await ctx.q(`select billet_weight_density_kg::numeric w from public.foundry_batches where id='${fb1}'`);
  assert.equal(Number(lot.kg), Number(batch.w)); assert.equal(lot.alloy, "6063");
  const noChem = await attempt(() => ctx.sys(ids.productionManager, `update public.foundry_batches set status='ready' where id='${fb1}'`));
  assert.equal(noChem.ok, false); assert.match(noChem.error, /chemistry/);
  const t = await ctx.as(ids.quality, `select public.record_foundry_chemistry_test('${fb1}', 'cast', '{"Si":0.45,"Mg":0.55,"Fe":0.2}'::jsonb, 'pass', 'SPEC-77', null) id`);
  const self = await attempt(() => ctx.as(ids.quality, `select public.approve_foundry_chemistry_test('${t[0].id}') id`));
  assert.equal(self.ok, false, "tester cannot approve own test");
  const ap = await attempt(() => ctx.as(ids.factoryManager, `select public.approve_foundry_chemistry_test('${t[0].id}') id`));
  assert.equal(ap.ok, true, ap.error);
  const ready = await attempt(() => ctx.sys(ids.productionManager, `update public.foundry_batches set status='ready' where id='${fb1}'`));
  assert.equal(ready.ok, true, ready.error);
  rows = await billets1(ctx);
  assert.deepEqual(rows.map((b) => b.status), ["cast", "cast", "scrap"]);
  return "cast result scrapped billet 3 (theoretical-weight 6063 lot) and weighed 2 good billets at 21.6 kg; self-approval rejected; release made 2 billets allocatable";
}, { candidateOnly: true });

// ---- EXOS-AUD-031 -------------------------------------------------------
scenario("G031-save-marks-billets-issued", "031", async (ctx, candidate) => {
  await seedHeldJobWithIssuedBillets(ctx, "planned");
  await ctx.replica(`update public.foundry_billets set status='allocated', production_job_id=null where foundry_batch_id='${fb15}' and billet_number < 3`);
  const ids2 = (await ctx.q(`select id from public.foundry_billets where foundry_batch_id='${fb15}' and billet_number < 3 order by billet_number`)).map((r) => r.id);
  const payload = `jsonb_build_object('order_id','${ids.orderA}','profile_id','${ids.profile}','die_id','${ids.die}','planned_quantity_kg',40,'status','planned')`;
  const r = await attempt(() => ctx.as(ids.productionManager, `select public.save_production_job_atomic('${job15}', ${payload}, array['${ids2[0]}','${ids2[1]}']::uuid[]) id`));
  assert.equal(r.ok, true, r.error);
  const rows = await billets15(ctx);
  if (!candidate) { assert.deepEqual(rows.slice(0, 2).map((b) => b.status), ["issued", "issued"]); return "baseline: saving the plan marked both billets issued"; }
  assert.deepEqual(rows.slice(0, 2).map((b) => [b.status, b.job]), [["allocated", job15], ["allocated", job15]]);
  const issue = await attempt(() => ctx.as(ids.production, `select public.issue_production_billets('${job15}', array['${ids2[0]}']::uuid[]) n`));
  assert.equal(issue.ok, true, issue.error);
  const after = await billets15(ctx);
  assert.deepEqual(after.slice(0, 2).map((b) => b.status), ["issued", "allocated"]);
  return "planning links billets as allocated; the physical issue RPC issued billet 1 only";
});

// ---- EXOS-AUD-016 -------------------------------------------------------
scenario("G016-partial-return-credit", "016", async (ctx, candidate) => {
  const d = "f6160000-0000-4000-8000-000000000001";
  const inv = "f8800000-0000-4000-8000-000000000016";
  const p1 = "f6170000-0000-4000-8000-000000000001";
  const p2 = "f6170000-0000-4000-8000-000000000002";
  await seedPackedOutputForOrderB(ctx);
  await ctx.replica(`
    insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status, actual_dispatched_at)
      values ('${d}', '${ids.company}', '${ids.orderB}', 'D-16', current_date, 2, 10, 0, 'delivered', now());
    insert into public.packing_list_items (id, company_id, dispatch_id, profile_id, bundle_number, source_kind, source_record_id, source_line_id, number_of_pieces, net_length_m, gross_weight_kg, tare_weight_kg, order_item_id, net_rate, gst_percent, finishing_type)
      values ('${p1}', '${ids.company}', '${d}', '${ids.profile}', 'B1', 'production', '${ids.orderB}', '${ids.jobB}', 1, 5, 5, 0, '${lineB}', 300, 18, 'mill_finish'),
             ('${p2}', '${ids.company}', '${d}', '${ids.profile}', 'B2', 'production', '${ids.orderB}', '${ids.jobB}', 1, 5, 5, 0, '${lineB}', 300, 18, 'mill_finish');
    insert into public.invoices (id, company_id, customer_id, order_id, dispatch_id, invoice_number, invoice_date, status, subtotal, tax_total, grand_total)
      values ('${inv}', '${ids.company}', '${ids.customer}', '${ids.orderB}', '${d}', 'INV-16', current_date - 1, 'sent', 3000, 540, 3540);
    insert into public.invoice_items (company_id, invoice_id, profile_id, source_line_id, quantity, unit_rate, line_total, gst_percent)
      values ('${ids.company}', '${inv}', '${ids.profile}', '${p1}', 5, 300, 1500, 18), ('${ids.company}', '${inv}', '${ids.profile}', '${p2}', 5, 300, 1500, 18)`);
  const disp = await attempt(() => ctx.as(ids.dispatchManager, `select public.record_material_disposition('dispatch_return', '${d}', '${p1}', 'return_to_stock', 5, 1, 'Customer returned bundle B1, wrong length') id`));
  const credit = await attempt(() => ctx.as(ids.accounts, `select public.issue_partial_return_credit_note_atomic('${d}', array['${p1}']::uuid[], 'Bundle B1 returned by customer', gen_random_uuid()) id`));
  if (!candidate) { assert.equal(disp.ok, false); assert.equal(credit.ok, false); return "baseline: no disposition or partial credit path (only a 100% credit note)"; }
  assert.equal(disp.ok, true, disp.error);
  assert.equal(credit.ok, true, credit.error);
  const [cn] = await ctx.q(`select subtotal::numeric s, tax_total::numeric t, grand_total::numeric g from public.credit_notes where id='${credit.value[0].id}'`);
  assert.deepEqual([Number(cn.s), Number(cn.t), Number(cn.g)], [1500, 270, 1770]);
  const [stock] = await ctx.q(`select origin_type, qc_status, total_weight_kg::numeric kg from public.profile_stock_batches where source_dispatch_id='${d}'`);
  assert.equal(stock.origin_type, "customer_return"); assert.equal(stock.qc_status, "on_hold");
  const twice = await attempt(() => ctx.as(ids.accounts, `select public.issue_partial_return_credit_note_atomic('${d}', array['${p1}']::uuid[], 'Bundle B1 returned by customer', gen_random_uuid()) id`));
  assert.equal(twice.ok, false);
  const noDisp = await attempt(() => ctx.as(ids.accounts, `select public.issue_partial_return_credit_note_atomic('${d}', array['${p2}']::uuid[], 'Bundle B2 never came back', gen_random_uuid()) id`));
  assert.equal(noDisp.ok, false); assert.match(noDisp.error, /disposition/);
  return `one returned bundle credited 1,500 + 270 GST of a 3,540 invoice; stock back on QC hold; double credit and undispositioned bundle rejected`;
});

scenario("G016-qc-reject-to-scrap", "016", async (ctx) => {
  await seedPackedOutputForOrderB(ctx);
  const qi = "f6180000-0000-4000-8000-000000000099";
  await ctx.replica(`insert into public.quality_inspections (id, company_id, production_job_id, profile_id, quantity_checked_kg, status, inspector_name, surface_finish_ok) values ('${qi}', '${ids.company}', '${ids.jobB}', '${ids.profile}', 4, 'rejected', 'QC', false)`);
  const over = await attempt(() => ctx.as(ids.quality, `select public.record_material_disposition('qc_reject', '${qi}', null, 'scrap', 5, null, 'Die lines') id`));
  assert.equal(over.ok, false);
  const ok = await attempt(() => ctx.as(ids.quality, `select public.record_material_disposition('qc_reject', '${qi}', null, 'scrap', 4, null, 'Die lines') id`));
  assert.equal(ok.ok, true, ok.error);
  const [lot] = await ctx.q(`select weight_kg::numeric kg, scrap_category, scrap_quality from public.foundry_aluminium_scrap where scrap_category='qc_reject'`);
  assert.equal(Number(lot.kg), 4); assert.equal(lot.scrap_quality, "clean");
  const stock = await attempt(() => ctx.as(ids.quality, `select public.record_material_disposition('qc_reject', '${qi}', null, 'return_to_stock', 1, null, 'try sell') id`));
  assert.equal(stock.ok, false);
  return "rejected kg capped; 4 kg QC reject became a furnace lot; rejected profiles cannot go back to sellable stock";
}, { candidateOnly: true });

// ---- EXOS-AUD-021 -------------------------------------------------------
scenario("G021-profile-change-with-open-work", "021", async (ctx, candidate) => {
  await seedRunningJob(ctx);
  const r = await attempt(() => ctx.as(ids.owner, `update public.aluminium_profiles set section_weight_kg_per_m = 1.35, alloy = '6061' where id='${ids.profile}'`));
  const [p] = await ctx.q(`select section_weight_kg_per_m::numeric w from public.aluminium_profiles where id='${ids.profile}'`);
  if (!candidate) { assert.equal(Number(p.w), 1.35); return "baseline: owner changed kg/m and alloy under a running job with no warning"; }
  assert.equal(r.ok, false); assert.match(r.error, /open work/); assert.equal(Number(p.w), 1);
  const notes = await attempt(() => ctx.as(ids.owner, `update public.aluminium_profiles set profile_name = 'Sliding track 2' where id='${ids.profile}'`));
  assert.equal(notes.ok, true, notes.error);
  const pm = await attempt(() => ctx.as(ids.productionManager, `select public.approve_profile_spec_change('${ids.profile}', '{"section_weight_kg_per_m":1.35}'::jsonb, 'Die corrected, customer approved new drawing') id`));
  assert.equal(pm.ok, false);
  const ap = await attempt(() => ctx.as(ids.owner, `select public.approve_profile_spec_change('${ids.profile}', '{"section_weight_kg_per_m":1.35}'::jsonb, 'Die corrected, customer approved new drawing') id`));
  assert.equal(ap.ok, true, ap.error);
  const [log] = await ctx.q(`select previous_values, new_values, open_work from public.profile_spec_change_approvals where profile_id='${ids.profile}'`);
  assert.equal(Number(log.open_work.production_jobs), 1);
  return `spec edit under open work rejected (${r.error}); non-spec edit allowed; owner approval recorded ${JSON.stringify(log)}`;
});

// ---- EXOS-AUD-026 -------------------------------------------------------
const quote26 = "f6260000-0000-4000-8000-000000000001";
const qiAllowance = "f6270000-0000-4000-8000-000000000001";
const qiMinimum = "f6270000-0000-4000-8000-000000000002";
// Line 1: 100 pcs x 5 m x 2 kg/m = 1,000 kg physical, 5% scrap allowance, freight 1,500.
// Line 2: 10 pcs x 5 m x 2 kg/m = 100 kg physical, minimum billing weight 500 kg.
async function seedQuote26(ctx) {
  await ctx.replica(`insert into public.quotes (id, company_id, quote_number, customer_id, quote_date, status, gst_percent) values ('${quote26}', '${ids.company}', 'Q-26', '${ids.customer}', current_date, 'draft', 18)`);
  await ctx.sys(ids.owner, `insert into public.quote_items (id, company_id, quote_id, profile_id, quantity_pieces, length_per_piece_m, section_weight_kg_per_m, scrap_allowance_percent, minimum_billing_weight_kg, billet_rate_per_kg, conversion_charge_per_kg, finishing_charge_type, finishing_charge, die_charge, die_amortization_type, packing_charge, transport_charge, other_charges, margin_percent, gst_percent, invoice_calc_uom)
    values ('${qiAllowance}', '${ids.company}', '${quote26}', '${ids.profile}', 100, 5, 2, 5, 0, 250, 40, 'per_kg', 0, 0, 'waived', 0, 1500, 0, 10, 18, 'kg'),
           ('${qiMinimum}', '${ids.company}', '${quote26}', '${ids.profile}', 10, 5, 2, 0, 500, 250, 40, 'per_kg', 0, 0, 'waived', 0, 0, 0, 10, 18, 'kg')`);
  return ctx.q(`select id, total_weight_kg::numeric kg, billing_weight_kg::numeric bkg, line_total_before_gst::numeric total, net_rate::numeric rate,
    case when to_jsonb(quote_items)->>'charges_billed_separately' = 'true' then coalesce(die_service_charge, 0) + coalesce(freight_charge, 0) else 0 end::numeric charges
    from public.quote_items where quote_id='${quote26}' order by quantity_pieces desc`);
}

scenario("G026-invoice-rate-loses-quoted-value", "026", async (ctx, candidate) => {
  const [allowance, minimum] = await seedQuote26(ctx);
  // The invoice bills the actual net kg shipped at the line's net_rate, plus any die and
  // freight charges billed once as separate lines (20261021330000).
  const invoiced = (line) => Math.round((Number(line.kg) * Number(line.rate) + Number(line.charges ?? 0)) * 100) / 100;
  const gapA = Number(allowance.total) - invoiced(allowance);
  const gapM = Number(minimum.total) - invoiced(minimum);
  if (!candidate) {
    assert.ok(gapA > 0.04 * Number(allowance.total), `allowance gap ${gapA}`);
    assert.ok(gapM > 0.75 * Number(minimum.total), `minimum gap ${gapM}`);
    return `baseline: shipping the quoted 1,000 kg invoices ${invoiced(allowance)} of ${allowance.total} (-${gapA.toFixed(2)}); the 500 kg minimum line invoices ${invoiced(minimum)} of ${minimum.total}`;
  }
  // Rate is rounded to the paisa, so the shipped value may differ by at most 0.005 x kg.
  assert.ok(Math.abs(gapA) <= 0.005 * Number(allowance.kg), `allowance gap ${gapA}`);
  assert.ok(Math.abs(gapM) <= 0.005 * Number(minimum.kg), `minimum gap ${gapM}`);
  return `quoted 1,000 kg invoices ${invoiced(allowance)} of ${allowance.total} at ${allowance.rate}/kg; 100 kg under a 500 kg minimum invoices ${invoiced(minimum)} of ${minimum.total} at ${minimum.rate}/kg`;
});

scenario("G026-non-kg-invoice-unit-ignored", "026", async (ctx, candidate) => {
  await seedQuote26(ctx);
  const r = await attempt(() => ctx.sys(ids.owner, `update public.quote_items set invoice_calc_uom='meter' where id='${qiAllowance}'`));
  if (!candidate) { assert.equal(r.ok, true, r.error); return "baseline: per-metre invoicing stored and silently ignored"; }
  assert.equal(r.ok, false); assert.match(r.error, /invoice_calc_uom_kg/);
  return `rejected: ${r.error}`;
});

scenario("G026-billing-reconciliation", "026", async (ctx) => {
  const [allowance] = await seedQuote26(ctx);
  const line = "f6280000-0000-4000-8000-000000000001";
  const d = "f6290000-0000-4000-8000-000000000001";
  const p = "f6300000-0000-4000-8000-000000000001";
  const inv = "f6310000-0000-4000-8000-000000000001";
  const rate = Number(allowance.rate);
  const value = Math.round(600 * rate * 100) / 100;
  await ctx.replica(`
    insert into public.order_items (id, company_id, order_id, profile_id, quote_item_id, quantity_kg, net_rate, gst_percent, final_line_value, theoretical_weight)
      values ('${line}', '${ids.company}', '${ids.orderB}', '${ids.profile}', '${qiAllowance}', ${allowance.bkg}, ${rate}, 18, ${allowance.total}, ${allowance.kg});
    insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status, actual_dispatched_at)
      values ('${d}', '${ids.company}', '${ids.orderB}', 'D-26', current_date, 1, 600, 0, 'delivered', now());
    insert into public.packing_list_items (id, company_id, dispatch_id, profile_id, bundle_number, source_kind, source_record_id, source_line_id, number_of_pieces, net_length_m, gross_weight_kg, tare_weight_kg, order_item_id, net_rate, gst_percent, finishing_type)
      values ('${p}', '${ids.company}', '${d}', '${ids.profile}', 'B1', 'production', '${ids.orderB}', '${ids.jobB}', 60, 300, 600, 0, '${line}', ${rate}, 18, 'mill_finish');
    insert into public.invoices (id, company_id, customer_id, order_id, dispatch_id, invoice_number, invoice_date, status, subtotal, tax_total, grand_total)
      values ('${inv}', '${ids.company}', '${ids.customer}', '${ids.orderB}', '${d}', 'INV-26', current_date, 'sent', ${value}, 0, ${value});
    insert into public.invoice_items (company_id, invoice_id, profile_id, source_line_id, order_item_id, quantity, unit_rate, line_total, gst_percent)
      values ('${ids.company}', '${inv}', '${ids.profile}', '${p}', '${line}', 600, ${rate}, ${value}, 18)`);
  const [rec] = await ctx.as(ids.accounts, `select public.get_order_billing_reconciliation('${ids.orderB}') r`);
  const row = rec.r.find((x) => x.orderItemId === line);
  assert.equal(Number(row.invoicedKg), 600); assert.equal(Number(row.invoicedValue), value);
  assert.equal(Number(row.uninvoicedValue), Math.round((Number(allowance.total) - value) * 100) / 100);
  const op = await attempt(() => ctx.as(ids.production, `select public.get_order_billing_reconciliation('${ids.orderB}') r`));
  assert.equal(op.ok, false); assert.match(op.error, /owner, admin or accounts/);
  return `600 of 1,000 kg invoiced ${value}; ${row.uninvoicedValue} of the quoted ${allowance.total} still to invoice; production role refused`;
}, { candidateOnly: true });

// ---- EXOS-AUD-026 follow-up: die and freight as separate invoice lines --------
scenario("G026-die-freight-rate-excludes-charges", "026", async (ctx) => {
  await ctx.replica(`insert into public.quotes (id, company_id, quote_number, customer_id, quote_date, status, gst_percent) values ('${quote26}', '${ids.company}', 'Q-26', '${ids.customer}', current_date, 'draft', 18)`);
  await ctx.sys(ids.owner, `insert into public.quote_items (id, company_id, quote_id, profile_id, quantity_pieces, length_per_piece_m, section_weight_kg_per_m, scrap_allowance_percent, billet_rate_per_kg, conversion_charge_per_kg, finishing_charge_type, finishing_charge, die_charge, die_amortization_type, packing_charge, transport_charge, other_charges, margin_percent, gst_percent)
    values ('${qiAllowance}', '${ids.company}', '${quote26}', '${ids.profile}', 100, 5, 2, 5, 250, 40, 'per_kg', 0, 20000, 'full_die_charge', 0, 1500, 0, 10, 18),
           ('${qiMinimum}', '${ids.company}', '${quote26}', '${ids.profile}', 100, 5, 2, 0, 250, 40, 'per_kg', 0, 0, 'waived', 0, 0, 0, 10, 18)`);
  const [withCharges, plain] = await ctx.q(`select total_weight_kg::numeric kg, line_total_before_gst::numeric total, net_rate::numeric rate, die_service_charge::numeric die, freight_charge::numeric freight, charges_billed_separately sep
    from public.quote_items where quote_id='${quote26}' order by die_charge desc`);
  assert.equal(withCharges.sep, true); assert.equal(Number(withCharges.die), 20000); assert.equal(Number(withCharges.freight), 1500);
  const shipped = Number(withCharges.kg) * Number(withCharges.rate) + 21500;
  assert.ok(Math.abs(shipped - Number(withCharges.total)) <= 0.005 * Number(withCharges.kg), `charges line ${shipped} vs ${withCharges.total}`);
  assert.equal(plain.sep, false);
  assert.ok(Math.abs(Number(plain.kg) * Number(plain.rate) - Number(plain.total)) <= 0.005 * Number(plain.kg));
  return `goods rate ${withCharges.rate}/kg x ${withCharges.kg} kg + die 20,000 + freight 1,500 = ${shipped.toFixed(2)} of quoted ${withCharges.total}; a line without charges keeps the all-in rate`;
}, { candidateOnly: true });

scenario("G026-die-freight-billed-once", "026", async (ctx) => {
  await seedPackedOutputForOrderB(ctx);
  const d1 = "f6500000-0000-4000-8000-000000000001", d2 = "f6500000-0000-4000-8000-000000000002";
  const p1 = "f6510000-0000-4000-8000-000000000001", p2 = "f6510000-0000-4000-8000-000000000002";
  await ctx.replica(`
    update public.companies set gst_state_code='24', gst_number='24ABCDE1234F1Z5' where id='${ids.company}';
    update public.aluminium_profiles set hsn_code='760421' where id='${ids.profile}';
    update public.order_items set hsn_code='760421', net_rate=300, die_service_charge=20000, freight_charge=1500, charges_billed_separately=true where id='${lineB}';
    update public.production_jobs set completed_at=now() - interval '3 hours', actual_quantity_kg=10, actual_pieces=2, actual_meters=10 where id='${ids.jobB}';
    insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status, actual_dispatched_at, created_at)
      values ('${d1}', '${ids.company}', '${ids.orderB}', 'D-C1', current_date, 1, 5, 0, 'delivered', now() - interval '1 hour', now() - interval '2 hours'),
             ('${d2}', '${ids.company}', '${ids.orderB}', 'D-C2', current_date, 1, 5, 0, 'delivered', now() - interval '1 hour', now() - interval '2 hours');
    insert into public.packing_list_items (id, company_id, dispatch_id, profile_id, bundle_number, source_kind, source_record_id, source_line_id, number_of_pieces, net_length_m, gross_weight_kg, tare_weight_kg, order_item_id, net_rate, gst_percent, finishing_type, operator_verified_at, operator_verified_by)
      values ('${p1}', '${ids.company}', '${d1}', '${ids.profile}', 'C1', 'production', '${ids.orderB}', '${ids.jobB}', 1, 5, 5, 0, '${lineB}', 300, 18, 'mill_finish', now() - interval '90 minutes', '${ids.factoryManager}'),
             ('${p2}', '${ids.company}', '${d2}', '${ids.profile}', 'C2', 'production', '${ids.orderB}', '${ids.jobB}', 1, 5, 5, 0, '${lineB}', 300, 18, 'mill_finish', now() - interval '90 minutes', '${ids.factoryManager}')`);
  const lines = (pid, d) => `jsonb_build_array(jsonb_build_object('source_record_id','${d}','source_line_id','${pid}','order_item_id','${lineB}','profile_id','${ids.profile}','quantity',5,'unit_rate',300,'line_total',1500))`;
  const save = (d, pid) => attempt(() => ctx.as(ids.accounts, `select public.save_invoice_atomic(null, jsonb_build_object('order_id','${ids.orderB}','dispatch_id','${d}','invoice_date',current_date,'place_of_supply_state_code','24','status','generated'), ${lines(pid, d)}, true) id`));
  const first = await save(d1, p1);
  assert.equal(first.ok, true, first.error);
  const inv1 = first.value[0].id;
  const rows1 = await ctx.q(`select line_kind, quantity, unit_rate, line_total::numeric total, hsn_code, gst_percent::numeric gst, item_description from public.invoice_items where invoice_id='${inv1}' order by line_kind`);
  assert.deepEqual(rows1.map((r) => [r.line_kind, Number(r.total)]), [["die_charge", 20000], ["freight_charge", 1500], ["goods", 1500]]);
  assert.ok(rows1.filter((r) => r.line_kind !== "goods").every((r) => r.quantity === null && r.unit_rate === null && r.hsn_code === "760421" && Number(r.gst) === 18));
  const [t1] = await ctx.q(`select subtotal::numeric s, tax_total::numeric t, grand_total::numeric g from public.invoices where id='${inv1}'`);
  assert.deepEqual([Number(t1.s), Number(t1.t), Number(t1.g)], [23000, 4140, 27140]);
  const second = await save(d2, p2);
  assert.equal(second.ok, true, second.error);
  const rows2 = await ctx.q(`select line_kind from public.invoice_items where invoice_id='${second.value[0].id}'`);
  assert.deepEqual(rows2.map((r) => r.line_kind), ["goods"]);
  const dup = await attempt(() => ctx.sys(ids.accounts, `insert into public.invoice_items (company_id, invoice_id, order_item_id, line_kind, line_total) values ('${ids.company}', '${second.value[0].id}', '${lineB}', 'die_charge', 1)`));
  assert.equal(dup.ok, false); assert.match(dup.error, /already billed/);
  await ctx.replica(`update public.invoices set status='cancelled' where id='${inv1}'`);
  const regen = await attempt(() => ctx.as(ids.accounts, `select public.replace_invoice_items_atomic('${second.value[0].id}', ${lines(p2, d2)}) id`));
  assert.equal(regen.ok, true, regen.error);
  const rows3 = await ctx.q(`select line_kind from public.invoice_items where invoice_id='${second.value[0].id}' order by line_kind`);
  assert.deepEqual(rows3.map((r) => r.line_kind), ["die_charge", "freight_charge", "goods"]);
  const [rec] = await ctx.as(ids.accounts, `select public.get_order_billing_reconciliation('${ids.orderB}') r`);
  const row = rec.r.find((x) => x.orderItemId === lineB);
  assert.equal(Number(row.invoicedKg), 5);
  return `invoice 1: goods 1,500 + die 20,000 + freight 1,500 = 23,000 + 4,140 GST; invoice 2: goods only; duplicate charge rejected; after invoice 1 was cancelled, regenerating invoice 2 took the charges; reconciliation counts 5 kg (goods only)`;
}, { candidateOnly: true });

// ---- runner ---------------------------------------------------------------
let failures = 0;
for (const s of scenarios) {
  if (ONLY.length && !ONLY.some((prefix) => s.id.startsWith(prefix))) continue;
  for (const candidate of s.candidateOnly || POST_APPLY_DIR ? [true] : [false, true]) {
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
