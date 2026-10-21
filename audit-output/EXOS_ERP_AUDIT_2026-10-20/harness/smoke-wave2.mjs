// Applies every Wave 2 migration, one at a time, on the post-Wave-1 hosted snapshot.
import { readdirSync } from "node:fs";
import { createLiveCatalogDb } from "./live-catalog-db.mjs";
const files = readdirSync(new URL("../../../supabase/migrations/", import.meta.url)).filter((f) => f >= "20261021080000" && f.endsWith(".sql")).sort();
const { db } = await createLiveCatalogDb({ dir: "live-20261021" });
const { readFileSync } = await import("node:fs");
for (const f of files) {
  try { await db.exec(readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), "utf8").replaceAll("\r\n", "\n")); console.log("ok  ", f); }
  catch (e) { console.log("FAIL", f, e.message); process.exitCode = 1; break; }
}
