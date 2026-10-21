// Audit harness: fingerprints every function, trigger and policy the Wave 2
// migrations (and the 026 follow-up 20261021310000) define. Without arguments it prints the hosted-side SQL; with
// --local it applies Wave 2 to the live-20261021 catalog in PGlite and prints the
// same fingerprint, so the two can be diffed after a hosted apply.
import { readFileSync, readdirSync } from "node:fs";
import { createLiveCatalogDb } from "./live-catalog-db.mjs";

const ROOT = new URL("../../../", import.meta.url);
const files = readdirSync(new URL("supabase/migrations/", ROOT))
  .filter((f) => f >= "20261021080000" && f <= "20261021310000_~" && f.endsWith(".sql") && !f.startsWith("20261021290100"))
  .sort();

const functions = new Set();
const triggers = new Set();
const policies = new Set();
for (const file of files) {
  const sql = readFileSync(new URL(`supabase/migrations/${file}`, ROOT), "utf8");
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w]+)\.([\w]+)\s*\(/gi)) functions.add(`${m[1]}.${m[2]}`.toLowerCase());
  for (const m of sql.matchAll(/create\s+(?:constraint\s+)?trigger\s+(\w+)/gi)) triggers.add(m[1].toLowerCase());
  for (const m of sql.matchAll(/create\s+policy\s+"([^"]+)"/gi)) policies.add(m[1]);
}
const list = (set) => [...set].sort().map((v) => `'${v.replace(/'/g, "''")}'`).join(",");

const query = `
select 'fn' kind, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' name,
  md5(p.prosrc||p.prosecdef::text||coalesce(array_to_string(p.proconfig,','),'')) fp
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname||'.'||p.proname in (${list(functions)})
union all
select 'trg', c.relname||'.'||t.tgname, md5(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid=t.tgrelid
where t.tgname in (${list(triggers)}) and not t.tgisinternal
union all
select 'pol', schemaname||'.'||tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,','))
from pg_policies where policyname in (${list(policies)})
order by 1,2`;

if (!process.argv.includes("--local")) {
  console.log(query);
} else {
  const { db } = await createLiveCatalogDb({ dir: "live-20261021", migrations: files.map((f) => `supabase/migrations/${f}`) });
  const rows = (await db.query(query)).rows;
  console.log(JSON.stringify(rows));
}
