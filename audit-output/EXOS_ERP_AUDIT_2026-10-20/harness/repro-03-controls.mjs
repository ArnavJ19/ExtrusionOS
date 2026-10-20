// Reproductions for authorization / internal-control findings, plus negative
// controls that show the harness enforces tenant isolation like the live database.
// Run: node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-03-controls.mjs
import { createLiveCatalogDb } from "./live-catalog-db.mjs";
import { ids, seed, asUser } from "./seed.mjs";

const { db } = await createLiveCatalogDb();
await seed(db);
const results = [];
const record = (id, outcome, detail) => { results.push({ id, outcome, detail }); console.log(`[${outcome}] ${id}: ${detail}`); };
const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error: error.message }; } };
const q = async (sql) => (await db.query(sql)).rows;
const one = async (userId, sql) => { await db.exec(`select set_config('audit.uid','${userId}',false); set role authenticated;`); try { return (await db.query(sql)).rows[0]; } finally { await db.exec("reset role;"); } };

// Negative controls (expected to be blocked).
{
  const crossTenant = await attempt(() => asUser(db, ids.viewer, `insert into public.scrap_records (company_id, scrap_type, weight_kg) values ('${ids.otherCompany}', 'process_scrap', 1)`));
  record("N1 cross-tenant-insert-blocked (control)", !crossTenant.ok ? "CONTROL HOLDS" : "CONTROL FAILED", crossTenant.error ?? "accepted");
  const viewerInvoice = await attempt(() => asUser(db, ids.viewer, `insert into public.invoices (company_id, customer_id, invoice_number, invoice_date) values ('${ids.company}', '${ids.customer}', 'X', current_date)`));
  record("N2 viewer-direct-invoice-blocked (control)", !viewerInvoice.ok ? "CONTROL HOLDS" : "CONTROL FAILED", viewerInvoice.error ?? "accepted");
  const viewerPayment = await attempt(() => one(ids.viewer, `select public.record_payment_atomic(gen_random_uuid(), '{"amount":1}'::jsonb) x`));
  record("N3 viewer-payment-rpc-blocked (control)", !viewerPayment.ok ? "CONTROL HOLDS" : "CONTROL FAILED", viewerPayment.error ?? "accepted");
}

// C1: a viewer marks an activated shipment as 'returned' and rewrites its e-way bill / vehicle after activation.
{
  const d = "f8000000-0000-4000-8000-000000000001";
  await db.exec(`set session_replication_role = replica;
    update public.orders set current_stage='dispatched' where id='${ids.orderA}';
    insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status, actual_dispatched_at, eway_bill_number, vehicle_number)
      values ('${d}', '${ids.company}', '${ids.orderA}', 'D-C1', current_date, 1, 10, 0, 'dispatched', now(), 'EWB-111', 'MH01AB1234');
    insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, net_rate, gst_percent) values ('f8100000-0000-4000-8000-000000000001', '${ids.company}', '${ids.orderA}', '${ids.profile}', 1000, 300, 18);
    insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, status, planned_quantity_kg, actual_quantity_kg, actual_pieces, actual_meters, finishing_type, completed_at)
      values ('f8200000-0000-4000-8000-000000000001', '${ids.company}', 'J-Q', '${ids.orderA}', '${ids.profile}', '${ids.die}', 'f8100000-0000-4000-8000-000000000001', 'completed', 10, 10, 2, 10, 'mill_finish', now());
    insert into public.quality_inspections (company_id, production_job_id, profile_id, quantity_checked_kg, status, inspector_name, surface_finish_ok) values ('${ids.company}', 'f8200000-0000-4000-8000-000000000001', '${ids.profile}', 10, 'approved', 'QC', true);
    insert into public.packaging_materials (id, company_id, material_code, material_name, material_type, consumption_rate, calculation_method) values ('f8300000-0000-4000-8000-000000000001', '${ids.company}', 'PM1', 'Wrap', 'stretch_film', 1, 'fixed');
    insert into public.packaging_jobs (id, company_id, packaging_number, order_id, production_job_id, status, profile_weight_kg) values ('f8400000-0000-4000-8000-000000000001', '${ids.company}', 'PK1', '${ids.orderA}', 'f8200000-0000-4000-8000-000000000001', 'completed', 10);
    insert into public.packaging_job_materials (company_id, job_id, material_id, quantity_required) values ('${ids.company}', 'f8400000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 1);
    insert into public.packing_list_items (company_id, dispatch_id, profile_id, bundle_number, source_kind, source_record_id, source_line_id, number_of_pieces, net_length_m, gross_weight_kg, tare_weight_kg, operator_verified_at, operator_verified_by, order_item_id, net_rate, gst_percent)
      values ('${ids.company}', '${d}', '${ids.profile}', 'B1', 'production', '${ids.orderA}', 'f8200000-0000-4000-8000-000000000001', 2, 10, 10, 0, now(), '${ids.dispatch}', 'f8100000-0000-4000-8000-000000000001', 300, 18);
    set session_replication_role = origin;`);
  const r = await attempt(() => asUser(db, ids.viewer, `update public.dispatches set eway_bill_number='EWB-999', vehicle_number='XX00ZZ0000', lr_number='LR-FAKE' where id='${d}'`));
  const r2 = await attempt(() => asUser(db, ids.viewer, `update public.dispatches set delivery_status='returned', remarks='viewer says returned' where id='${d}'`));
  const row = await q(`select delivery_status, eway_bill_number, vehicle_number, lr_number from public.dispatches where id='${d}'`);
  const hist = await q(`select from_status, to_status, changed_by = '${ids.viewer}' by_viewer from public.dispatch_status_history where dispatch_id='${d}'`);
  record("C1 viewer-rewrites-shipped-dispatch", r.ok && r2.ok && row[0].delivery_status === "returned" ? "REPRODUCED" : "NOT REPRODUCED",
    `logistics edit ${r.ok ? "ok" : r.error}; return ${r2.ok ? "ok" : r2.error}; row ${JSON.stringify(row[0])}; history ${JSON.stringify(hist)}`);
}

// C2: a viewer creates production jobs that consume order production balance.
{
  const r = await attempt(() => asUser(db, ids.viewer, `insert into public.production_jobs (company_id, job_number, order_id, profile_id, die_id, status, planned_quantity_kg)
    values ('${ids.company}', 'J-VIEWER', '${ids.orderB}', '${ids.profile}', '${ids.die}', 'planned', 900)`));
  const row = await q(`select job_number, status, planned_quantity_kg from public.production_jobs where job_number like 'J%VIEW%' or created_by is null order by created_at desc limit 1`);
  record("C2 viewer-creates-production-job", r.ok ? "REPRODUCED" : "NOT REPRODUCED", r.ok ? JSON.stringify(row[0]) : r.error);
}

// C3: any user forges audit trail rows attributed to another user.
{
  const r = await attempt(() => asUser(db, ids.viewer, `insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values ('${ids.company}', '${ids.owner}', 'payment_recorded', 'payment', gen_random_uuid(), '{"amount":500000,"note":"forged by viewer"}'::jsonb)`));
  const r2 = await attempt(() => asUser(db, ids.viewer, `insert into public.audit_logs_enterprise (company_id, actor_user_id, actor_name, actor_role, action_type, module_name, entity_type, change_summary)
    values ('${ids.company}', '${ids.owner}', 'Owner', 'owner', 'invoice_approved', 'financials', 'invoice', 'forged')`));
  record("C3 viewer-forges-audit-entries", r.ok ? "REPRODUCED" : "NOT REPRODUCED", `audit_logs as owner: ${r.ok ? "accepted" : r.error}; audit_logs_enterprise as owner: ${r2.ok ? "accepted" : r2.error}`);
}

// C4: die renumbered, moved to another profile and given fabricated production history while referenced by a running job.
{
  const job = "f4000000-0000-4000-8000-000000000009";
  await db.exec(`set session_replication_role = replica;
    insert into public.aluminium_profiles (id, company_id, profile_code, profile_name, section_weight_kg_per_m, alloy, temper) values ('f0000000-0000-4000-8000-000000000009', '${ids.company}', 'P-900', 'Other', 2, '6061', 'T6');
    insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, status, planned_quantity_kg, machine_id) values ('${job}', '${ids.company}', 'J-RUN', '${ids.orderA}', '${ids.profile}', '${ids.die}', 'in_progress', 500, '${ids.pressA}');
    set session_replication_role = origin;`);
  const r = await attempt(() => one(ids.sales, `select public.update_versioned_entity_atomic('die','${ids.die}', '{"die_number":"D-REUSED","profile_id":"f0000000-0000-4000-8000-000000000009","total_production_kg":250000,"total_runs":900,"die_status":"active"}'::jsonb) rev`));
  const r2 = await attempt(() => one(ids.productionManager, `select public.update_versioned_entity_atomic('die','${ids.die}', '{"die_number":"D-REUSED","profile_id":"f0000000-0000-4000-8000-000000000009","total_production_kg":250000,"total_runs":900}'::jsonb) rev`));
  const die = await q(`select die_number, profile_id = 'f0000000-0000-4000-8000-000000000009' moved_profile, total_production_kg, total_runs from public.dies where id='${ids.die}'`);
  const running = await q(`select job_number, status, profile_id = '${ids.profile}' job_profile_unchanged from public.production_jobs where id='${job}'`);
  record("C4 die-identity-and-history-editable-while-running", r2.ok ? "REPRODUCED" : "NOT REPRODUCED",
    `sales: ${r.ok ? "ok" : r.error}; production_manager: ${r2.ok ? "ok" : r2.error}; die ${JSON.stringify(die[0])}; running job ${JSON.stringify(running[0])}`);
}

// C5: owner changes profile section weight / alloy while open orders and jobs depend on it.
{
  const r = await attempt(() => one(ids.owner, `select public.update_versioned_entity_atomic('profile','${ids.profile}', '{"section_weight_kg_per_m":1.35,"alloy":"6061","billet_diameter_required_inch":6}'::jsonb) rev`));
  const p = await q(`select section_weight_kg_per_m, alloy, billet_diameter_required_inch from public.aluminium_profiles where id='${ids.profile}'`);
  const open = await q(`select count(*)::int n from public.production_jobs where profile_id='${ids.profile}' and status not in ('completed','cancelled')`);
  record("C5 profile-master-change-under-open-work", r.ok ? "REPRODUCED" : "NOT REPRODUCED", r.ok ? `profile now ${JSON.stringify(p[0])} with ${open[0].n} open jobs; no impact check or reapproval` : r.error);
}

console.log(JSON.stringify(results, null, 1));
