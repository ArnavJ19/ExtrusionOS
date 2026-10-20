// Reproductions for foundry source / scrap integrity findings.
// Run: node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-01-foundry-scrap.mjs
import { createLiveCatalogDb } from "./live-catalog-db.mjs";
import { ids, seed, asUser } from "./seed.mjs";

const { db } = await createLiveCatalogDb();
await seed(db);
const results = [];
const record = (id, outcome, detail) => { results.push({ id, outcome, detail }); console.log(`[${outcome}] ${id}: ${detail}`); };
const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error: error.message }; } };
const q = async (sql) => (await db.query(sql)).rows;

// R1: a read-only "viewer" inserts process scrap with no production job -> foundry gets clean, available metal.
{
  const before = await q(`select count(*)::int n, coalesce(sum(weight_kg),0)::numeric kg from public.foundry_aluminium_scrap`);
  const r = await attempt(() => asUser(db, ids.viewer, `insert into public.scrap_records (company_id, scrap_type, weight_kg, reason, recorded_by)
    values ('${ids.company}', 'process_scrap', 5000, 'viewer test', '${ids.viewer}');`));
  const after = await q(`select scrap_number, scrap_source, scrap_quality, status, weight_kg, available_weight_kg from public.foundry_aluminium_scrap order by created_at desc limit 1`);
  record("R1 viewer-fabricates-foundry-scrap", r.ok ? "REPRODUCED" : "NOT REPRODUCED",
    r.ok ? `viewer insert accepted; foundry scrap rows ${before[0].n}->${(await q(`select count(*)::int n from public.foundry_aluminium_scrap`))[0].n}; new lot ${JSON.stringify(after[0])}` : r.error);
  // R1b: the viewer cannot delete/correct the erroneous record.
  const del = await attempt(() => asUser(db, ids.viewer, `delete from public.scrap_records where reason='viewer test'`));
  const left = await q(`select count(*)::int n from public.scrap_records where reason='viewer test'`);
  record("R1b scrap-record-uncorrectable", left[0].n === 1 ? "REPRODUCED" : "NOT REPRODUCED", `delete ok=${del.ok}; rows remaining ${left[0].n} (no update/delete policy; owner too)`);
  const ownerDel = await attempt(() => asUser(db, ids.owner, `delete from public.scrap_records where reason='viewer test'`));
  const left2 = await q(`select count(*)::int n from public.scrap_records where reason='viewer test'`);
  record("R1c owner-cannot-correct-scrap-record", left2[0].n === 1 ? "REPRODUCED" : "NOT REPRODUCED", `owner delete ok=${ownerDel.ok}; rows remaining ${left2[0].n}`);
}

// R2: production role directly inflates available weight of a scrap lot beyond its received weight.
{
  await db.exec(`set session_replication_role = replica;
    insert into public.foundry_aluminium_scrap (id, company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, scrap_quality, status, vendor_id)
    values ('99999999-0000-4000-8000-000000000001', '${ids.company}', 'SCR-R2', 'incoming', 1000, 0, 'clean', 'used', '${ids.vendor}');
    set session_replication_role = origin;`);
  const r = await attempt(() => asUser(db, ids.production, `update public.foundry_aluminium_scrap set available_weight_kg = 25000, status = 'available' where id = '99999999-0000-4000-8000-000000000001'`));
  const row = await q(`select weight_kg, available_weight_kg, status from public.foundry_aluminium_scrap where id = '99999999-0000-4000-8000-000000000001'`);
  record("R2 direct-available-weight-inflation", r.ok && Number(row[0].available_weight_kg) === 25000 ? "REPRODUCED" : "NOT REPRODUCED",
    r.ok ? `production role set used lot (1000 kg received, 0 available) to ${JSON.stringify(row[0])}` : r.error);
}

// R3: the record form's edit payload (available_weight_kg = weight_kg when 0) resurrects a consumed lot.
{
  await db.exec(`set session_replication_role = replica;
    insert into public.foundry_aluminium_scrap (id, company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, scrap_quality, status, vendor_id, notes)
    values ('99999999-0000-4000-8000-000000000003', '${ids.company}', 'SCR-R3', 'incoming', 1000, 0, 'clean', 'used', '${ids.vendor}', 'fully charged');
    set session_replication_role = origin;`);
  // Mirrors record-form-client.tsx:846 -> payload.available_weight_kg = payload.weight_kg because 0 is falsy.
  const r = await attempt(() => asUser(db, ids.production, `update public.foundry_aluminium_scrap set notes = 'typo fixed', available_weight_kg = weight_kg, status = 'used'
    where id = '99999999-0000-4000-8000-000000000003' and company_id = '${ids.company}'`));
  const row = await q(`select weight_kg, available_weight_kg, status from public.foundry_aluminium_scrap where id = '99999999-0000-4000-8000-000000000003'`);
  record("R3 edit-resurrects-consumed-scrap", r.ok && Number(row[0].available_weight_kg) === 1000 ? "REPRODUCED" : "NOT REPRODUCED", r.ok ? JSON.stringify(row[0]) : r.error);
}

// R4: a 6061 external ingot lot is charged into a 6063 furnace batch.
{
  await db.exec(`set session_replication_role = replica;
    insert into public.foundry_external_aluminium_sources (id, company_id, source_number, item_type, weight_kg, available_weight_kg, source_origin, alloy, status, quantity, vendor_id)
    values ('99999999-0000-4000-8000-000000000004', '${ids.company}', 'EAS-R4', 'aluminum_ingot', 10000, 10000, 'import', '6061', 'available', 10, '${ids.vendor}');
    set session_replication_role = origin;`);
  const r = await attempt(() => asUser(db, ids.productionManager, `insert into public.foundry_batches (company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, external_source_id, furnace_efficiency_percent, production_date, status, created_by)
    values ('${ids.company}', 'FB-R4', 'F1', '6063', 'T6', 1000, 101.6, 4, 10, 2700, 0, 100, '99999999-0000-4000-8000-000000000004', 80, current_date, 'planned', '${ids.productionManager}')`));
  const batch = await q(`select alloy, external_aluminium_kg from public.foundry_batches where batch_number like 'FB%' order by created_at desc limit 1`);
  const src = await q(`select alloy, available_weight_kg from public.foundry_external_aluminium_sources where id='99999999-0000-4000-8000-000000000004'`);
  record("R4 cross-alloy-charge", r.ok ? "REPRODUCED" : "NOT REPRODUCED", r.ok ? `batch ${JSON.stringify(batch[0])} consumed source ${JSON.stringify(src[0])}` : r.error);
}

// R5: billets become usable at 'cast' with theoretical weight; billet_count and chemistry are frozen once melting starts.
{
  const batchId = (await q(`select id from public.foundry_batches order by created_at desc limit 1`))[0]?.id;
  if (batchId) {
    const toMelting = await attempt(() => asUser(db, ids.productionManager, `update public.foundry_batches set status='melting' where id='${batchId}'`));
    const actualChem = await attempt(() => asUser(db, ids.productionManager, `update public.foundry_batches set alloy_composition_actual = '{"Si":0.9,"Mg":1.2}'::jsonb where id='${batchId}'`));
    const shrink = await attempt(() => asUser(db, ids.productionManager, `update public.foundry_batches set billet_count = 8 where id='${batchId}'`));
    const toCast = await attempt(() => asUser(db, ids.productionManager, `update public.foundry_batches set status='cast' where id='${batchId}'`));
    const billets = await q(`select status, count(*)::int n, min(weight_kg) w from public.foundry_billets where foundry_batch_id='${batchId}' group by status`);
    const reject = await attempt(() => asUser(db, ids.owner, `update public.foundry_billets set status='scrap' where foundry_batch_id='${batchId}' and billet_number=1`));
    const rejected = await q(`select count(*)::int n from public.foundry_billets where foundry_batch_id='${batchId}' and status='scrap'`);
    record("R5a measured-chemistry-rejected-after-melt", !actualChem.ok ? "REPRODUCED" : "NOT REPRODUCED", `melting ok=${toMelting.ok}; enter spectro result ok=${actualChem.ok} ${actualChem.error ?? ""}`);
    record("R5b actual-cast-count-cannot-be-recorded", !shrink.ok ? "REPRODUCED" : "NOT REPRODUCED", `reduce 10->8 good billets ok=${shrink.ok} ${shrink.error ?? ""}`);
    record("R5c all-planned-billets-enter-stock", toCast.ok ? "REPRODUCED" : "NOT REPRODUCED", `cast ok=${toCast.ok} ${toCast.error ?? ""}; billets ${JSON.stringify(billets)}`);
    record("R5d no-billet-rejection-path", rejected[0].n === 0 ? "REPRODUCED" : "NOT REPRODUCED", `owner mark billet scrap ok=${reject.ok}; scrap billets=${rejected[0].n} ${reject.error ?? ""}`);
  }
}

// R6: viewer / sales roles change press and die operational status.
{
  await db.exec(`set session_replication_role = replica; update public.dies set die_status='retired' where id='${ids.die}'; set session_replication_role = origin;`);
  const d = await attempt(() => asUser(db, ids.sales, `update public.dies set die_status = 'active' where id = '${ids.die}'`));
  const dRows = await q(`select die_status from public.dies where id='${ids.die}'`);
  await db.exec(`set session_replication_role = replica; update public.machines set status='breakdown' where id='${ids.pressB}'; set session_replication_role = origin;`);
  const freeText = await attempt(() => asUser(db, ids.viewer, `update public.machines set status = 'idle' where id = '${ids.pressB}'`));
  const bRows = await q(`select status from public.machines where id='${ids.pressB}'`);
  record("R6a viewer-edits-press-status", freeText.ok && bRows[0].status === "idle" ? "REPRODUCED" : "NOT REPRODUCED", `viewer moved press B from 'breakdown' to '${bRows[0].status}' (eligible for release/start)`);
  record("R6b sales-reactivates-retired-die", d.ok && dRows[0].die_status === "active" ? "REPRODUCED" : "NOT REPRODUCED", d.ok ? `die_status now ${dRows[0].die_status}` : d.error);
}

// R7: any company user posts arbitrary inventory movements that never reach current_stock.
{
  await db.exec(`set session_replication_role = replica;
    insert into public.inventory_items (id, company_id, item_code, item_name, item_category, unit, current_stock) values ('99999999-0000-4000-8000-000000000007', '${ids.company}', 'ING-6063', 'Ingot 6063', 'billets', 'kg', 100);
    set session_replication_role = origin;`);
  const r = await attempt(() => asUser(db, ids.viewer, `insert into public.inventory_movements (company_id, inventory_item_id, movement_type, quantity, unit, movement_date, notes)
    values ('${ids.company}', '99999999-0000-4000-8000-000000000007', 'adjustment_in', 9999, 'kg', current_date, 'viewer')`));
  const stock = await q(`select current_stock from public.inventory_items where id='99999999-0000-4000-8000-000000000007'`);
  const moves = await q(`select count(*)::int n from public.inventory_movements where notes='viewer'`);
  record("R7 viewer-posts-inventory-movement", r.ok && moves[0].n === 1 ? "REPRODUCED" : "NOT REPRODUCED", r.ok ? `movement accepted; item current_stock still ${stock[0].current_stock} -> ledger and balance diverge` : r.error);
}

console.log(JSON.stringify(results, null, 1));
