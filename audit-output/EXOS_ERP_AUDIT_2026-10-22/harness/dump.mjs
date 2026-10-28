// Dumps the replica's function bodies, triggers, policies, constraints, grants to current/ for static review.
import { writeFileSync, mkdirSync } from "node:fs";
import { current } from "./current-db.mjs";
const ctx = await current({ withSeed: false });
const out = new URL("./current/", import.meta.url); mkdirSync(out, { recursive: true });
const fns = await ctx.q(`select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' nm, p.prosecdef d, pg_get_functiondef(p.oid) def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1`);
writeFileSync(new URL("functions.sql", out), fns.map((f) => `-- FN ${f.nm}${f.d ? " [definer]" : ""}\n${f.def}`).join("\n\n"));
const trg = await ctx.q(`select pg_get_triggerdef(t.oid) d from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and not t.tgisinternal order by c.relname, t.tgname`);
writeFileSync(new URL("triggers.sql", out), trg.map((r) => r.d).join(";\n"));
const pol = await ctx.q(`select schemaname||'.'||tablename t, policyname, cmd, roles::text r, qual, with_check from pg_policies where schemaname in ('public','private') order by 1,2`);
writeFileSync(new URL("policies.txt", out), pol.map((p) => `${p.t} [${p.cmd}] "${p.policyname}" roles=${p.r}\n  USING: ${p.qual}\n  CHECK: ${p.with_check}`).join("\n"));
const con = await ctx.q(`select c.conrelid::regclass::text t, c.conname, pg_get_constraintdef(c.oid) d from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','private') order by 1,2`);
writeFileSync(new URL("constraints.txt", out), con.map((c) => `${c.t} ${c.conname}: ${c.d}`).join("\n"));
const gr = await ctx.q(`select table_name t, grantee g, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') group by 1,2 order by 1,2`);
writeFileSync(new URL("table_grants.txt", out), gr.map((r) => `${r.t} ${r.g}: ${r.p}`).join("\n"));
const fg = await ctx.q(`select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' nm, p.prosecdef d,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') auth, has_function_privilege('anon', p.oid, 'EXECUTE') anon
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by 1`);
writeFileSync(new URL("function_grants.txt", out), fg.map((r) => `${r.nm} definer=${r.d} auth=${r.auth} anon=${r.anon}`).join("\n"));
const cols = await ctx.q(`select table_name t, string_agg(column_name||':'||data_type, ', ' order by ordinal_position) c from information_schema.columns where table_schema='public' group by 1 order by 1`);
writeFileSync(new URL("columns.txt", out), cols.map((r) => `${r.t}: ${r.c}`).join("\n"));
console.log({ fns: fns.length, trg: trg.length, pol: pol.length, con: con.length, cols: cols.length });
