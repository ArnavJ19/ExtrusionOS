// Rehearses 20261021320000 on rows shaped like hosted FB-2026-0001 (cancelled batch whose
// billets stayed allocated to an order), with controls that must not change.
import { readFileSync, readdirSync } from "node:fs";
import { createLiveCatalogDb } from "./live-catalog-db.mjs";
import { ids, seed } from "./seed.mjs";
const dir = new URL("../../../supabase/migrations/", import.meta.url);
const applied = readdirSync(dir).filter((f) => f >= "20261021080000" && f <= "20261021310000_~" && !f.startsWith("20261021290100")).sort().map((f) => `supabase/migrations/${f}`);
const { db } = await createLiveCatalogDb({ dir: "live-20261021", migrations: applied });
await seed(db);
const req = "f6400000-0000-4000-8000-000000000001";
const cancelledBatch = "f6410000-0000-4000-8000-000000000001";
const liveBatch = "f6410000-0000-4000-8000-000000000002";
const billet = (n) => `f6420000-0000-4000-8000-00000000000${n}`;
await db.exec(`set session_replication_role = replica;
  insert into public.order_billet_requirements (id, company_id, order_id, profile_id, alloy, temper, billet_diameter_inch, billets_required, billets_allocated, billets_short, status)
    values ('${req}', '${ids.company}', '${ids.orderA}', '${ids.profile}', '6063', 'T6', 6, 10, 4, 6, 'partial');
  insert into public.foundry_batches (id, company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, status, billet_weight_density_kg, batch_sequence, production_date)
    values ('${cancelledBatch}', '${ids.company}', 'FB-X1', 'F1', '6063', 'T6', 5800, 152.4, 6, 3, 2700, 0, 100, 'cancelled', 285.661, 901, current_date),
           ('${liveBatch}', '${ids.company}', 'FB-X2', 'F1', '6063', 'T6', 5800, 152.4, 6, 1, 2700, 0, 100, 'ready', 285.661, 902, current_date);
  insert into public.production_jobs (id, company_id, job_number, order_id, profile_id, die_id, status, planned_quantity_kg)
    values ('${ids.jobA}', '${ids.company}', 'J-A', '${ids.orderA}', '${ids.profile}', '${ids.die}', 'in_progress', 100);
  insert into public.foundry_billets (id, company_id, foundry_batch_id, billet_code, billet_number, billet_diameter_inch, billet_diameter_mm, billet_length_mm, alloy, temper, weight_kg, status, order_id, allocation_requirement_id, production_job_id, source_type)
    values ('${billet(1)}', '${ids.company}', '${cancelledBatch}', 'FB-X1-1', 1, 6, 152.4, 5800, '6063', 'T6', 285.661, 'allocated', '${ids.orderA}', '${req}', null, 'in_house'),
           ('${billet(2)}', '${ids.company}', '${cancelledBatch}', 'FB-X1-2', 2, 6, 152.4, 5800, '6063', 'T6', 285.661, 'allocated', '${ids.orderA}', '${req}', null, 'in_house'),
           ('${billet(3)}', '${ids.company}', '${cancelledBatch}', 'FB-X1-3', 3, 6, 152.4, 5800, '6063', 'T6', 285.661, 'issued', '${ids.orderA}', '${req}', '${ids.jobA}', 'in_house'),
           ('${billet(4)}', '${ids.company}', '${liveBatch}', 'FB-X2-1', 1, 6, 152.4, 5800, '6063', 'T6', 285.661, 'allocated', '${ids.orderA}', '${req}', null, 'in_house');
  set session_replication_role = origin;`);
await db.exec(readFileSync(new URL("20261021320000_cancelled_batch_phantom_billets.sql", dir), "utf8").replaceAll("\r\n", "\n"));
const rows = (await db.query(`select billet_code c, status, order_id is not null linked from public.foundry_billets where id in ('${billet(1)}','${billet(2)}','${billet(3)}','${billet(4)}') order by billet_code`)).rows;
const [r] = (await db.query(`select billets_allocated a, billets_short s, status from public.order_billet_requirements where id='${req}'`)).rows;
const audits = Number((await db.query(`select count(*) n from public.audit_logs where action='data_repair' and entity_type='foundry_billets'`)).rows[0].n);
const [guard] = (await db.query(`select tgenabled from pg_trigger where tgname='guard_foundry_billet_material_integrity'`)).rows;
console.log(JSON.stringify({ rows, requirement: r, audits, guardEnabled: guard.tgenabled }));
const expected = { "FB-X1-1": ["cancelled", false], "FB-X1-2": ["cancelled", false], "FB-X1-3": ["issued", true], "FB-X2-1": ["allocated", true] };
const bad = rows.filter((row) => expected[row.c][0] !== row.status || expected[row.c][1] !== row.linked);
// Requirement recount: billet 3 (issued) and billet 4 (allocated) remain -> 2 of 10.
const ok = !bad.length && Number(r.a) === 2 && Number(r.s) === 8 && r.status === "partial" && audits === 2 && guard.tgenabled === "O";
console.log(ok ? "REHEARSAL PASSED (phantom billets cancelled and unlinked, controls untouched, requirement recounted, guard re-enabled)" : `REHEARSAL FAILED ${JSON.stringify(bad)}`);
process.exitCode = ok ? 0 : 1;
