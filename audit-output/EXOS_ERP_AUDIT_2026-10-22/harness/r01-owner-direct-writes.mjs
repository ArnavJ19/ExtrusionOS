// R01: owner/admin direct PostgREST writes on dispatches and orders (no RPC).
import { current, ids } from "./current-db.mjs";
const ONLY = process.env.ONLY ?? "abc";
const out = (label, v) => console.log(`${label}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const lineB = "f5000000-0000-4000-8000-000000000002";
const D1 = "fd000000-0000-4000-8000-000000000001", PL1 = "fd100000-0000-4000-8000-000000000001";
const I1 = "fe000000-0000-4000-8000-000000000001", II1 = "fe100000-0000-4000-8000-000000000001", P1 = "fe200000-0000-4000-8000-000000000001";

async function seedDelivered(ctx) {
  await ctx.replica(`
    update public.orders set current_stage='delivered' where id='${ids.orderB}';
    insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, net_rate, gst_percent) values ('${lineB}', '${ids.company}', '${ids.orderB}', '${ids.profile}', 10, 300, 18);
    insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, status, planned_quantity_kg, actual_quantity_kg, actual_pieces, actual_meters, finishing_type, completed_at)
      values ('${ids.jobB}', '${ids.company}', 'J-Q', '${ids.orderB}', '${ids.profile}', '${ids.die}', '${lineB}', 'completed', 10, 10, 2, 10, 'mill_finish', now());
    insert into public.dispatches (id, company_id, order_id, dispatch_number, dispatch_date, number_of_bundles, total_weight_kg, total_tare_weight_kg, delivery_status, delivered_at, actual_dispatched_at, eway_bill_number, lr_number, vehicle_number)
      values ('${D1}', '${ids.company}', '${ids.orderB}', 'D-1', current_date, 1, 10, 0, 'delivered', now(), now(), 'EWB-1', 'LR-1', 'MH01AB1234');
    insert into public.dispatch_status_history (company_id, dispatch_id, from_status, to_status) values ('${ids.company}', '${D1}', 'in_transit', 'delivered');
    insert into public.packing_list_items (id, company_id, dispatch_id, profile_id, bundle_number, number_of_pieces, gross_weight_kg, tare_weight_kg, source_record_id, source_line_id, quantity_kg, order_item_id)
      values ('${PL1}', '${ids.company}', '${D1}', '${ids.profile}', 'B-1', 2, 10, 0, '${ids.orderB}', '${ids.jobB}', 10, '${lineB}');
    insert into public.invoices (id, company_id, customer_id, order_id, dispatch_id, invoice_number, invoice_date, due_date, subtotal, tax_total, grand_total, amount_paid, status)
      values ('${I1}', '${ids.company}', '${ids.customer}', '${ids.orderB}', '${D1}', 'INV-1', current_date, current_date + 30, 3000, 540, 3540, 1000, 'partially_paid');
    insert into public.invoice_items (id, company_id, invoice_id, order_item_id, profile_id, quantity, unit_rate, line_total, source_record_id, source_line_id, quantity_kg, line_kind)
      values ('${II1}', '${ids.company}', '${I1}', '${lineB}', '${ids.profile}', 10, 300, 3000, '${D1}', '${PL1}', 10, 'goods');
    insert into public.payments (id, company_id, invoice_id, payment_date, amount, payment_method, order_id, payment_status) values ('${P1}', '${ids.company}', '${I1}', current_date, 1000, 'bank_transfer', '${ids.orderB}', 'completed')`);
}

if (ONLY.includes("a")) {
  const ctx = await current();
  await seedDelivered(ctx);
  const before = await ctx.q(`select (select count(*) from public.packing_list_items where dispatch_id='${D1}') pl, (select count(*) from public.dispatch_status_history where dispatch_id='${D1}') hist`);
  out("R01a before", before);
  const del = await ctx.attempt(() => ctx.as(ids.owner, `delete from public.dispatches where id='${D1}' returning dispatch_number`));
  out("R01a owner DELETE delivered+invoiced dispatch", del);
  out("R01a after", await ctx.q(`select (select count(*) from public.dispatches where id='${D1}') dispatch_rows,
    (select count(*) from public.packing_list_items where id='${PL1}') packing_rows,
    (select count(*) from public.dispatch_status_history where dispatch_id='${D1}') history_rows,
    (select row_to_json(x) from (select dispatch_id, status, grand_total, amount_paid from public.invoices where id='${I1}') x) invoice,
    (select row_to_json(x) from (select source_record_id, source_line_id from public.invoice_items where id='${II1}') x) invoice_line,
    (select current_stage from public.orders where id='${ids.orderB}') order_stage`));
  out("R01a audit rows for the delete", await ctx.q(`select count(*) n from public.audit_logs_enterprise where entity_id='${D1}'`).catch((e) => e.message));
  const delAdmin = await ctx.attempt(() => ctx.as(ids.dispatchManager, `delete from public.dispatches where id='${D1}' returning 1`));
  out("R01a control: dispatch manager delete", delAdmin);
}
if (ONLY.includes("b")) {
  const ctx = await current();
  // Owner direct order edits that the guard blocks for every other role.
  await ctx.replica(`update public.orders set order_value=500000 where id='${ids.orderA}'`);
  const r = await ctx.attempt(() => ctx.as(ids.owner, `update public.orders set current_stage='delivered', order_value=1, requested_weight_kg=5, production_quantity_kg=5 where id='${ids.orderA}'`));
  out("R01b order after owner PATCH", await ctx.q(`select current_stage, order_value, requested_weight_kg, production_quantity_kg from public.orders where id='${ids.orderA}'`));
  out("R01b owner direct PATCH order stage/value/qty", r);
  out("R01b stage history rows", await ctx.q(`select stage, changed_by from public.order_stage_history where order_id='${ids.orderA}'`).catch((e) => e.message));
  const s = await ctx.attempt(() => ctx.as(ids.salesManager, `update public.orders set order_value=1 where id='${ids.orderA}'`));
  out("R01b control: sales manager same PATCH", s);
}

if (ONLY.includes("c")) {
  const ctx = await current();
  await seedDelivered(ctx);
  await ctx.replica(`delete from public.payments; delete from public.invoice_items; delete from public.invoices`);
  const del = await ctx.attempt(() => ctx.as(ids.owner, `delete from public.dispatches where id='${D1}'`));
  out("R01c owner DELETE delivered, not-yet-invoiced dispatch", del);
  out("R01c after", await ctx.q(`select (select count(*) from public.dispatches where id='${D1}') dispatch_rows,
    (select count(*) from public.packing_list_items where id='${PL1}') packing_rows,
    (select count(*) from public.dispatch_status_history where dispatch_id='${D1}') history_rows,
    (select current_stage from public.orders where id='${ids.orderB}') order_stage,
    (select count(*) from public.audit_logs_enterprise where entity_id='${D1}' and action_type ilike '%delete%') delete_audit,
    (select count(*) from public.sensitive_action_logs where entity_id='${D1}') sensitive_log`));
}

if (ONLY.includes("d")) {
  // Same as R01c, but with QC + packaging evidence so the output is genuinely dispatchable, then re-ship it.
  const ctx = await current();
  await seedDelivered(ctx);
  await ctx.replica(`delete from public.payments; delete from public.invoice_items; delete from public.invoices;
    update public.orders set current_stage='packing' where id='${ids.orderB}';
    insert into public.quality_inspections (company_id, production_job_id, profile_id, quantity_checked_kg, status, inspector_name, surface_finish_ok) values ('${ids.company}', '${ids.jobB}', '${ids.profile}', 10, 'approved', 'QC', true);
    insert into public.packaging_materials (id, company_id, material_code, material_name, material_type, consumption_rate, calculation_method) values ('f8300000-0000-4000-8000-000000000001', '${ids.company}', 'PM1', 'Wrap', 'stretch_film', 1, 'fixed');
    insert into public.packaging_jobs (id, company_id, packaging_number, order_id, production_job_id, status, profile_weight_kg) values ('f8400000-0000-4000-8000-000000000001', '${ids.company}', 'PK1', '${ids.orderB}', '${ids.jobB}', 'completed', 10);
    insert into public.packaging_job_materials (company_id, job_id, material_id, quantity_required) values ('${ids.company}', 'f8400000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 1)`);
  const ship = (n) => ctx.attempt(() => ctx.as(ids.dispatchManager, `select public.save_ready_dispatch_atomic(null,
      jsonb_build_object('order_id','${ids.orderB}','dispatch_date',current_date,'number_of_bundles',1,'total_weight_kg',10,'total_tare_weight_kg',0,'delivery_status','pending'),
      jsonb_build_array(jsonb_build_object('bundle_number','B-${n}','profile_id','${ids.profile}','source_kind','production','source_record_id','${ids.orderB}','source_line_id','${ids.jobB}','number_of_pieces',2,'net_length_m',10,'gross_weight_kg',10,'tare_weight_kg',0,'operator_verified_at',now(),'operator_verified_by','${ids.dispatchManager}'))) id`));
  out("R01d control: second dispatch of the same 10 kg while D-1 exists", await ship(2));
  const del = await ctx.attempt(() => ctx.asExec(ids.owner, `delete from public.dispatches where id='${D1}'`));
  out("R01d owner deletes delivered D-1", del.ok ? "accepted" : del.error);
  out("R01d re-ship the same 10 kg after the delete", await ship(3));
  out("R01d dispatches now", await ctx.q(`select dispatch_number, delivery_status, total_weight_kg from public.dispatches where order_id='${ids.orderB}'`));
}
