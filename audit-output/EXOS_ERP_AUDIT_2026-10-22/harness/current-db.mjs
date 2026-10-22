// Audit 2026-10-22 harness: replica of the hosted catalog (ledger 129 as of 22 Oct 2026).
// = 20 Oct audit snapshot taken after Wave 1 (live-20261021, ledger 97)
//   + every migration hosted applied afterwards, in hosted ledger order.
// Read-only with respect to hosted: everything runs in in-memory PGlite.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createLiveCatalogDb } from "../../EXOS_ERP_AUDIT_2026-10-20/harness/live-catalog-db.mjs";
import { ids, seed } from "../../EXOS_ERP_AUDIT_2026-10-20/harness/seed.mjs";
const WAVE2 = [
  "supabase/migrations/20261021080000_close_low_level_dispatch_rpc.sql",
  "supabase/migrations/20261021090000_outsourced_billet_commitment_guard.sql",
  "supabase/migrations/20261021100000_production_cancel_billet_release.sql",
  "supabase/migrations/20261021110000_revoke_client_truncate_and_anon_writes.sql",
  "supabase/migrations/20261021120000_order_delivery_stage_resolution.sql",
  "supabase/migrations/20261021130000_die_identity_and_derived_usage.sql",
  "supabase/migrations/20261021140000_dispatch_packaged_weight_cap.sql",
  "supabase/migrations/20261021150000_production_input_evidence.sql",
  "supabase/migrations/20261021160000_role_explicit_write_policies.sql",
  "supabase/migrations/20261021170000_dispatch_document_amendments.sql",
  "supabase/migrations/20261021180000_machine_maintenance_lifecycle.sql",
  "supabase/migrations/20261021190000_accounting_period_lock.sql",
  "supabase/migrations/20261021200000_metal_receipt_plausibility.sql",
  "supabase/migrations/20261021210000_scrap_genealogy_and_alloy_segregation.sql",
  "supabase/migrations/20261021220000_inventory_ledger_integrity.sql",
  "supabase/migrations/20261021230000_finished_goods_origin_and_qc_hold.sql",
  "supabase/migrations/20261021240000_casting_results_and_chemistry_release.sql",
  "supabase/migrations/20261021250000_material_dispositions_and_partial_credit_notes.sql",
  "supabase/migrations/20261021260000_physical_billet_issue_step.sql",
  "supabase/migrations/20261021270000_kpi_definitions.sql",
  "supabase/migrations/20261021280000_profile_spec_change_control.sql",
  "supabase/migrations/20261021290000_foundry_single_source_charge_fix.sql",
  "supabase/migrations/20261021310000_quote_invoice_rate_basis.sql",
  "supabase/migrations/20261021330000_invoice_die_freight_charge_lines.sql",
];
export { ids };

// Hosted ledger order after row 97 (see 05_COVERAGE_MATRIX / hosted list_migrations).
const AFTER_WAVE2 = [
  "supabase/migrations/20261021300000_reconcile_metal_sources_and_validate.sql",
  "supabase/migrations/20261021310000_quote_invoice_rate_basis.sql",
  "supabase/migrations/20261021320000_cancelled_batch_phantom_billets.sql",
  "supabase/migrations/20261021290100_operation_page_null_projection.sql",
  "supabase/migrations/20261021330000_invoice_die_freight_charge_lines.sql",
  "supabase/migrations/20261022000000_operator_workflow_helpers.sql",
  "supabase/migrations/20261022010000_fk_covering_indexes_and_rls_initplan.sql",
  "supabase/migrations/20261021190916_collaboration_procedure_routines.sql",
  "supabase/migrations/20261021201325_collaboration_foreign_key_indexes.sql",
  // Applied to hosted (ledger 20261022014811) from another branch; snapshot kept as a fixture.
  "audit-output/EXOS_ERP_AUDIT_2026-10-22/harness/hosted-fixtures/20261022020000_ai_provider_and_report_source_checks.sql",
];
// Wave 1 candidates for EXOS-AUD2-001/004/005/006 (not applied to hosted).
export const WAVE1 = [
  "supabase/migrations/20261022100000_dispatch_delete_lifecycle_guard.sql",
  "supabase/migrations/20261022110000_operational_history_retention.sql",
  "supabase/migrations/20261022120000_profile_master_delete_restrict.sql",
  "supabase/migrations/20261022130000_metal_source_disposition.sql",
];
export const CURRENT = [
  ...WAVE2.filter((f) => !f.includes("20261021310000") && !f.includes("20261021330000")),
  ...AFTER_WAVE2,
];

// The built replica (+ seed) is cached as a PGlite data-dir tarball so each scenario starts in seconds.
// Set CANDIDATE=1 (or pass { candidate: true }) to layer the Wave 1 candidates on top.
// Caches are keyed by variant; delete cache/ after editing a candidate migration.
const cacheFor = (candidate) => new URL(`./cache/${candidate ? "wave1" : "current"}-seeded.tar.gz`, import.meta.url);
const migrationsFor = (candidate) => (candidate ? [...CURRENT, ...WAVE1] : CURRENT);
async function build(candidate) {
  const { db, failures } = await createLiveCatalogDb({ dir: "live-20261021", migrations: migrationsFor(candidate) });
  if (failures?.length) throw new Error(`catalog failures: ${failures.length}`);
  await seed(db);
  const blob = await db.dumpDataDir("gzip");
  mkdirSync(new URL("./cache/", import.meta.url), { recursive: true });
  writeFileSync(cacheFor(candidate), Buffer.from(await blob.arrayBuffer()));
  await db.close();
}
export async function current({ withSeed = true, candidate = Boolean(process.env.CANDIDATE) } = {}) {
  let db, failures = [];
  if (!withSeed) ({ db, failures } = await createLiveCatalogDb({ dir: "live-20261021", migrations: migrationsFor(candidate) }));
  else {
    if (!existsSync(cacheFor(candidate))) await build(candidate);
    db = new PGlite({ loadDataDir: new Blob([readFileSync(cacheFor(candidate))]) });
    await db.waitReady;
    await db.exec(`set statement_timeout = '${process.env.STMT_TIMEOUT ?? "120s"}'`);
  }
  const q = async (sql) => (await db.query(sql)).rows;
  const replica = (sql) => db.exec(`set session_replication_role = replica; ${sql}; set session_replication_role = origin;`);
  const as = async (userId, sql) => {
    await db.exec(`select set_config('audit.uid','${userId}',false); set role authenticated;`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
  };
  const asExec = async (userId, sql) => {
    await db.exec(`select set_config('audit.uid','${userId}',false); set role authenticated;`);
    try { return await db.exec(sql); } finally { await db.exec("reset role;"); }
  };
  const sys = async (userId, sql) => { await db.exec(`select set_config('audit.uid','${userId}',false);`); return (await db.query(sql)).rows; };
  const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: e.message }; } };
  return { db, q, replica, as, asExec, sys, attempt, failures };
}

export const FINGERPRINT_SQL = `
with f as (select 'fn' k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' nm,
  md5(replace(p.prosrc,chr(13),'')||p.prosecdef::text) fp
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'),
t as (select 'trg' k, c.relname||'.'||t.tgname nm, md5(pg_get_triggerdef(t.oid)) fp from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and not t.tgisinternal),
p as (select 'pol' k, schemaname||'.'||tablename||'.'||policyname nm, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd) fp from pg_policies where schemaname in ('public','private')),
a as (select * from f union all select * from t union all select * from p)
select k, count(*) n, md5(string_agg(nm||'|'||fp, ',' order by nm collate "C")) h from a group by k order by k`;

if (process.argv[1]?.endsWith("current-db.mjs")) {
  const ctx = await current({ withSeed: false });
  console.log(`catalog statement failures: ${ctx.failures?.length ?? "n/a"}`);
  if (process.argv.includes("--fingerprint")) console.log(JSON.stringify(await ctx.q(FINGERPRINT_SQL)));
  if (process.argv.includes("--names")) console.log(JSON.stringify(await ctx.q(FINGERPRINT_SQL.replace(/select k, count\(\*\)[\s\S]*$/, "select k, nm, fp from a order by k, nm collate \"C\""))));
}
