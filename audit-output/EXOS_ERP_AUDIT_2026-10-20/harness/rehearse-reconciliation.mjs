// Rehearses 20261021300000 on rows shaped like the drifted hosted metal sources (21 Oct).
import { readFileSync, readdirSync } from "node:fs";
import { createLiveCatalogDb } from "./live-catalog-db.mjs";
import { ids, seed } from "./seed.mjs";
const dir = new URL("../../../supabase/migrations/", import.meta.url);
const wave2 = readdirSync(dir).filter((f) => f >= "20261021080000" && f < "20261021290100").sort().map((f) => `supabase/migrations/${f}`);
const { db } = await createLiveCatalogDb({ dir: "live-20261021", migrations: wave2 });
await seed(db);
await db.exec(`set session_replication_role = replica;
  insert into public.foundry_aluminium_scrap (company_id, scrap_number, scrap_source, weight_kg, available_weight_kg, scrap_quality, status, vendor_id) values
    ('${ids.company}', 'SCR-2026-0001', 'incoming', 1000000, 900, 'clean', 'rejected', '${ids.vendor}'),
    ('${ids.company}', 'SCR-2026-0002', 'incoming', 1000000, 997429.051, 'clean', 'available', '${ids.vendor}'),
    ('${ids.company}', 'SCR-OK', 'incoming', 1000, 400, 'clean', 'available', '${ids.vendor}');
  insert into public.foundry_external_aluminium_sources (company_id, source_number, item_type, quantity, weight_kg, available_weight_kg, vendor_id, source_origin, alloy, status) values
    ('${ids.company}', 'EAS-2026-0001', 'aluminum_billets', 1, 2899.999, 2899.999, '${ids.vendor}', 'p', '6063', 'available'),
    ('${ids.company}', 'EAS-2026-0002', 'aluminum_ingot', 1, 2980, 2980, '${ids.vendor}', 'p', '6063', 'returned'),
    ('${ids.company}', 'EAS-2026-0003', 'aluminum_ingot', 1, 100000000, 99994001.119, '${ids.vendor}', 'p', '6063', 'reserved');
  set session_replication_role = origin;`);
await db.exec(readFileSync(new URL("20261021300000_reconcile_metal_sources_and_validate.sql", dir), "utf8").replaceAll("\r\n", "\n"));
const rows = (await db.query(`select scrap_number n, weight_kg::numeric w, available_weight_kg::numeric a, status from public.foundry_aluminium_scrap
  union all select source_number, weight_kg, available_weight_kg, status from public.foundry_external_aluminium_sources order by 1`)).rows;
console.log(JSON.stringify(rows, null, 1));
const expected = { "SCR-2026-0001": "rejected", "SCR-2026-0002": "rejected", "SCR-OK": "reserved", "EAS-2026-0001": "available", "EAS-2026-0002": "returned", "EAS-2026-0003": "rejected" };
const bad = rows.filter((r) => expected[r.n] !== r.status);
console.log(bad.length ? `REHEARSAL FAILED ${JSON.stringify(bad)}` : "REHEARSAL PASSED (balances untouched, statuses reconciled, constraints validated)");
process.exitCode = bad.length ? 1 : 0;
