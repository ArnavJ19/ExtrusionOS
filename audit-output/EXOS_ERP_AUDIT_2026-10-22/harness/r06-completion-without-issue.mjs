// R06: production completion consumes billets that were never physically issued to the press.
import { current, ids } from "./current-db.mjs";
const out = (l, v) => console.log(`${l}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const lineA = "f5000000-0000-4000-8000-000000000001", fb = "f7000000-0000-4000-8000-000000000066", req = "f7100000-0000-4000-8000-000000000066";
const ctx = await current();
await ctx.replica(`
  insert into public.order_items (id, company_id, order_id, profile_id, quantity_kg, quantity_pieces, length_per_piece_m, net_rate, gst_percent, finishing_type)
    values ('${lineA}', '${ids.company}', '${ids.orderA}', '${ids.profile}', 1000, 172, 5.8, 300, 18, 'mill_finish');
  insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, source_line_id, source_record_id, status, planned_quantity_kg, pieces, length_per_piece_m, extrusion_efficiency_percent, finishing_type, machine_id)
    values ('${ids.jobA}', '${ids.company}', 'J-A', '${ids.orderA}', '${ids.profile}', '${ids.die}', '${lineA}', '${ids.orderA}', 'in_progress', 1000, 172, 5.8, 85, 'mill_finish', '${ids.pressA}');
  insert into public.production_plan_slots (company_id, production_job_id, machine_id, planned_start_at, planned_end_at, status) values ('${ids.company}', '${ids.jobA}', '${ids.pressA}', now(), now() + interval '4 hours', 'released');
  insert into public.foundry_batches (id, company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, status, billet_weight_density_kg, batch_sequence, production_date)
    values ('${fb}', '${ids.company}', 'FB-66', 'F1', '6063', 'T6', 1000, 101.6, 4, 3, 2700, 0, 100, 'ready', 500, 66, current_date);
  insert into public.order_billet_requirements (id, company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billets_required, billets_allocated, status)
    values ('${req}', '${ids.company}', '${ids.orderA}', '${ids.profile}', '6063', 'T6', 4, 3, 3, 'complete');
  insert into public.foundry_billets (company_id, source_type, foundry_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status, order_id, allocation_requirement_id, production_job_id, allocated_at, allocated_by)
    select '${ids.company}', 'in_house', '${fb}', 'F1-' || to_char(current_date,'YYYYMMDD') || '-66-' || g, g, 4, 101.6, 1000, '6063', 'T6', 500, 'allocated', '${ids.orderA}', '${req}', '${ids.jobA}', now(), '${ids.owner}' from generate_series(1,3) g`);
// Only billet 1 physically goes to the press.
const [b1] = await ctx.q(`select id from public.foundry_billets where foundry_batch_id='${fb}' and billet_number=1`);
out("R06 issue billet 1 only", await ctx.attempt(() => ctx.as(ids.production, `select public.issue_production_billets('${ids.jobA}', array['${b1.id}']::uuid[]) n`)));
out("R06 before completion", await ctx.q(`select billet_number n, status from public.foundry_billets where foundry_batch_id='${fb}' order by 1`));
// The press used 500 kg (one billet): 420 kg good + 80 kg butt/saw. Honest completion:
const honest = await ctx.attempt(() => ctx.as(ids.production, `select public.complete_production_job_with_scrap_atomic('${ids.jobA}', 420, 72, null, '[{"category":"butt_end","weight_kg":60},{"category":"saw_cut","weight_kg":20}]'::jsonb, 'one billet used') id`));
out("R06a honest completion (500 kg used of the 1,500 kg linked)", honest.ok ? "accepted" : honest.error);
// To close the job the operator must account all 1,500 kg linked, including the two billets still in the rack:
const forced = await ctx.attempt(() => ctx.as(ids.production, `select public.complete_production_job_with_scrap_atomic('${ids.jobA}', 420, 72, null, '[{"category":"butt_end","weight_kg":60},{"category":"saw_cut","weight_kg":20},{"category":"unrecoverable_loss","weight_kg":1000}]'::jsonb, 'closing') id`));
out("R06b completion booking 1,000 kg 'loss' for the unissued billets", forced.ok ? "accepted" : forced.error);
out("R06 billets after completion", await ctx.q(`select billet_number n, status from public.foundry_billets where foundry_batch_id='${fb}' order by 1`));
out("R06 issue evidence rows", await ctx.q(`select count(*) n from public.production_billet_issues where production_job_id='${ids.jobA}'`));
