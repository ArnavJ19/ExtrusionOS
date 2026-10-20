import { createLiveCatalogDb } from "./live-catalog-db.mjs";
const t0 = Date.now();
const { db, failures } = await createLiveCatalogDb();
console.log("failures", failures.length, "ms", Date.now() - t0);
for (const f of failures) console.log(f.slice(0, 300));
const r = await db.query("select count(*) n from pg_trigger where not tgisinternal");
console.log(r.rows);
