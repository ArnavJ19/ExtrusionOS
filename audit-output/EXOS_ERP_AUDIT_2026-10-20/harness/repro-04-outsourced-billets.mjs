// Reproduction: outsourced billet receipts bypass the billet material-integrity guard.
// Run: node audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/repro-04-outsourced-billets.mjs
import { createLiveCatalogDb } from "./live-catalog-db.mjs";
import { ids, seed, asUser } from "./seed.mjs";

const { db } = await createLiveCatalogDb();
await seed(db);
const results = [];
const record = (id, outcome, detail) => { results.push({ id, outcome, detail }); console.log(`[${outcome}] ${id}: ${detail}`); };
const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error: error.message }; } };
const q = async (sql) => (await db.query(sql)).rows;
const batch = "f9000000-0000-4000-8000-000000000001";

const ins = await attempt(() => asUser(db, ids.productionManager, `insert into public.outsourced_billet_batches (id, company_id, batch_number, vendor_id, alloy, temper, billet_count, billet_diameter_inch, billet_diameter_mm, billet_length_mm, weight_kg, created_by)
  values ('${batch}', '${ids.company}', 'OB-1', '${ids.vendor}', '6063', 'T6', 10, 4, 101.6, 1000, 220, '${ids.productionManager}')`));
const before = await q(`select status, count(*)::int n, sum(weight_kg) kg, min(alloy) alloy from public.foundry_billets where outsourced_batch_id='${batch}' group by status`);
record("O0 receipt-creates-billets", ins.ok ? "OBSERVED" : "ERROR", ins.ok ? JSON.stringify(before) : ins.error);

// Simulate two billets already committed to a production job (seeded directly).
await db.exec(`set session_replication_role = replica;
  update public.foundry_billets set status='consumed', order_id='${ids.orderA}', production_job_id=null where outsourced_batch_id='${batch}' and billet_number in (1,2);
  set session_replication_role = origin;`);

const edit = await attempt(() => asUser(db, ids.production, `update public.outsourced_billet_batches set alloy='6061', temper='T5', weight_kg=440, billet_count=4 where id='${batch}'`));
const after = await q(`select billet_number, status, alloy, temper, weight_kg from public.foundry_billets where outsourced_batch_id='${batch}' order by billet_number`);
const consumedRewritten = after.filter((b) => b.status === "consumed" && b.alloy === "6061").length;
const surplus = after.filter((b) => b.billet_number > 4 && b.status === "cast").length;
record("O1 consumed-outsourced-billets-rewritten", edit.ok && consumedRewritten > 0 ? "REPRODUCED" : "NOT REPRODUCED", `edit ${edit.ok ? "ok" : edit.error}; consumed billets re-labelled 6061/T5 and reweighed: ${JSON.stringify(after.filter((b) => b.status === "consumed"))}`);
record("O2 reduced-count-leaves-surplus-billets-usable", edit.ok && surplus > 0 ? "REPRODUCED" : "NOT REPRODUCED", `${surplus} billets numbered above the new count of 4 remain 'cast' (allocatable)`);

const cancel = await attempt(() => asUser(db, ids.production, `update public.outsourced_billet_batches set status='cancelled' where id='${batch}'`));
const afterCancel = await q(`select status, count(*)::int n from public.foundry_billets where outsourced_batch_id='${batch}' group by status`);
record("O3 cancelled-receipt-keeps-billets-in-stock", cancel.ok && afterCancel.some((b) => b.status === "cast") ? "REPRODUCED" : "NOT REPRODUCED", `cancel ${cancel.ok ? "ok" : cancel.error}; billets ${JSON.stringify(afterCancel)}`);
console.log(JSON.stringify(results, null, 1));
