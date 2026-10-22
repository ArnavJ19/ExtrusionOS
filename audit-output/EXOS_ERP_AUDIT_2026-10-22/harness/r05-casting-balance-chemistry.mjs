// R05: casting mass balance and chemistry verdict.
import { current, ids } from "./current-db.mjs";
const out = (l, v) => console.log(`${l}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const ext1 = "f7400000-0000-4000-8000-000000000001", fb1 = "f7500000-0000-4000-8000-000000000001";
const ctx = await current();
await ctx.replica(`
  insert into public.foundry_external_aluminium_sources (id, company_id, source_number, item_type, quantity, weight_kg, available_weight_kg, vendor_id, source_origin, received_date, alloy, status)
    values ('${ext1}', '${ids.company}', 'EAS-1', 'aluminum_ingot', 1, 1000, 1000, '${ids.vendor}', 'purchased', current_date, '6063', 'available');
  insert into public.foundry_batches (id, company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, status, billet_weight_density_kg, batch_sequence, production_date, furnace_efficiency_percent, external_source_id, external_aluminium_kg)
    values ('${fb1}', '${ids.company}', 'FB-1', 'F1', '6063', 'T6', 1000, 101.6, 4, 3, 2700, 0, 100, 'planned', 21.89, 1, current_date, 100, '${ext1}', 0)`);
await ctx.sys(ids.productionManager, `update public.foundry_batches set notes = 'r05' where id='${fb1}'`);
await ctx.sys(ids.productionManager, `update public.foundry_batches set status = 'melting' where id='${fb1}'`);
await ctx.sys(ids.productionManager, `update public.foundry_batches set status = 'cast' where id='${fb1}'`);
out("R05 batch charge", await ctx.q(`select external_aluminium_kg charged, billet_weight_density_kg per_billet, billet_count from public.foundry_batches where id='${fb1}'`));
// 3 good billets weighed 14% heavier than theoretical: more metal out than went into the furnace
const [b] = await ctx.q(`select billet_weight_density_kg::numeric w, external_aluminium_kg::numeric c from public.foundry_batches where id='${fb1}'`);
const heavy = Math.round(Number(b.w) * 3 * 1.14 * 1000) / 1000;
const cr = await ctx.attempt(() => ctx.as(ids.production, `select public.record_foundry_cast_result('${fb1}', 3, ${heavy}, 5, null) id`));
out(`R05a cast result: 3 good billets at ${heavy} kg (charge ${b.c} kg) + 5 kg dross`, cr.ok ? "accepted" : cr.error);
out("R05a recorded balance", await ctx.q(`select charged_kg, measured_good_weight_kg, dross_kg, melt_loss_kg from public.foundry_cast_results where foundry_batch_id='${fb1}'`));
// Chemistry out of 6063 spec (Fe 0.60 > 0.35, Mg 0.30 < 0.45) recorded as pass, approved by a second person, batch released
const t = await ctx.attempt(() => ctx.as(ids.quality, `select public.record_foundry_chemistry_test('${fb1}', 'cast', '{"Si":0.45,"Mg":0.30,"Fe":0.60,"Cu":0.25}'::jsonb, 'pass', 'SPEC-78', null) id`));
out("R05b record out-of-spec composition as 'pass'", t.ok ? "accepted" : t.error);
const ap = await ctx.attempt(() => ctx.as(ids.factoryManager, `select public.approve_foundry_chemistry_test('${t.value?.[0]?.id}') id`));
out("R05b second person approves", ap.ok ? "accepted" : ap.error);
const rel = await ctx.attempt(() => ctx.sys(ids.productionManager, `update public.foundry_batches set status='ready' where id='${fb1}'`));
out("R05b batch released", rel.ok ? "accepted" : rel.error);
out("R05 billets now", await ctx.q(`select billet_number, status, measured_weight_kg from public.foundry_billets where foundry_batch_id='${fb1}' order by billet_number`));
