// R04: weight rules that assume no physical weight change and zero scale variance.
import { current, ids } from "./current-db.mjs";
const out = (l, v) => console.log(`${l}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const lineB = "f5000000-0000-4000-8000-000000000002", FJ = "fa000000-0000-4000-8000-000000000001";
{ // a) powder coating adds weight: 1,000 kg mill output weighs ~1,020 kg after coating
  const ctx = await current();
  await ctx.replica(`
    update public.orders set current_stage='finishing' where id='${ids.orderB}';
    insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, net_rate, gst_percent) values ('${lineB}', '${ids.company}', '${ids.orderB}', '${ids.profile}', 1000, 300, 18);
    insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, status, planned_quantity_kg, actual_quantity_kg, actual_pieces, actual_meters, finishing_type, completed_at)
      values ('${ids.jobB}', '${ids.company}', 'J-PC', '${ids.orderB}', '${ids.profile}', '${ids.die}', '${lineB}', 'completed', 1000, 1000, 172, 1000, 'powder_coating', now());
    insert into public.finishing_jobs (id, company_id, order_id, production_job_id, finishing_type, vendor_id, planned_date, sent_date, input_weight_kg, output_weight_kg, rejection_weight_kg, status)
      values ('${FJ}', '${ids.company}', '${ids.orderB}', '${ids.jobB}', 'powder_coating', '${ids.vendor}', current_date - 3, current_date - 2, 1000, 0, 0, 'in_process')`);
  const r = await ctx.attempt(() => ctx.as(ids.productionManager, `select public.transition_finishing_job_atomic('${FJ}', 'completed', '${ids.vendor}', current_date - 2, current_date, 1020, 0, 'Weighed after coating') x`));
  out("R04a record 1,020 kg coated output for 1,000 kg mill input", r.ok ? "accepted" : r.error);
  const r2 = await ctx.attempt(() => ctx.as(ids.productionManager, `select public.transition_finishing_job_atomic('${FJ}', 'completed', '${ids.vendor}', current_date - 2, current_date, 1000, 0, 'Recorded at mill weight') x`));
  out("R04a control: record 1,000 kg", r2.ok ? "accepted" : r2.error);
}
{ // b) dispatch weighing differs from production weighing by 0.4 kg on a 600 kg mill-finish job
  const ctx = await current();
  await ctx.replica(`
    update public.orders set current_stage='packing' where id='${ids.orderB}';
    insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, net_rate, gst_percent) values ('${lineB}', '${ids.company}', '${ids.orderB}', '${ids.profile}', 1000, 300, 18);
    insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, status, planned_quantity_kg, actual_quantity_kg, actual_pieces, actual_meters, finishing_type, completed_at)
      values ('${ids.jobB}', '${ids.company}', 'J-Q', '${ids.orderB}', '${ids.profile}', '${ids.die}', '${lineB}', 'completed', 600, 600, 103, 600, 'mill_finish', now());
    insert into public.quality_inspections (company_id, production_job_id, profile_id, quantity_checked_kg, status, inspector_name, surface_finish_ok) values ('${ids.company}', '${ids.jobB}', '${ids.profile}', 600, 'approved', 'QC', true);
    insert into public.packaging_materials (id, company_id, material_code, material_name, material_type, consumption_rate, calculation_method) values ('f8300000-0000-4000-8000-000000000001', '${ids.company}', 'PM1', 'Wrap', 'stretch_film', 1, 'fixed');
    insert into public.packaging_jobs (id, company_id, packaging_number, order_id, production_job_id, status, profile_weight_kg) values ('f8400000-0000-4000-8000-000000000001', '${ids.company}', 'PK1', '${ids.orderB}', '${ids.jobB}', 'completed', 600);
    insert into public.packaging_job_materials (company_id, job_id, material_id, quantity_required) values ('${ids.company}', 'f8400000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 1)`);
  const ship = (kg, n) => ctx.attempt(() => ctx.as(ids.dispatchManager, `select public.save_ready_dispatch_atomic(null,
      jsonb_build_object('order_id','${ids.orderB}','dispatch_date',current_date,'number_of_bundles',1,'total_weight_kg',${kg},'total_tare_weight_kg',0,'delivery_status','pending'),
      jsonb_build_array(jsonb_build_object('bundle_number','B-${n}','profile_id','${ids.profile}','source_kind','production','source_record_id','${ids.orderB}','source_line_id','${ids.jobB}','number_of_pieces',103,'net_length_m',600,'gross_weight_kg',${kg},'tare_weight_kg',0,'operator_verified_at',now(),'operator_verified_by','${ids.dispatchManager}'))) id`));
  const a = await ship(600.4, 1);
  out("R04b dispatch weighs the 600 kg job at 600.4 kg", a.ok ? "accepted" : a.error);
}
