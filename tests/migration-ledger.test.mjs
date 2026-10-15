import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import fc from "fast-check";
import { PGlite } from "@electric-sql/pglite";
import { buildMigrationManifest, reconcileMigrationLedger } from "../lib/deployment/migration-ledger.ts";

const files = ["0006_foundation.sql", "20260511_quotes.sql", "20261008010000_access.sql"];
const snapshot = (rows) => ({ migration_ledger_present: true, migrations: rows });
const rowsFor = (names) => buildMigrationManifest(names).map(({ version, name }) => ({ version, name }));
const exportSql = readFileSync(new URL("../sql/export-migration-ledger.sql", import.meta.url), "utf8");

test("matching metadata preserves version strings and does not certify schema or workflows", () => {
  const report = reconcileMigrationLedger(files, snapshot(rowsFor(files)));
  assert.equal(report.status, "ledger_matches");
  assert.equal(report.local_file_count, 3);
  assert.equal(report.matched_file_count, 3);
  assert.equal(report.hosted_row_count, 3);
  assert.deepEqual(report.pending, []);
  assert.match(report.evidence, /contents.*baseline.*replay.*grants.*JWTs/);
  assert.equal(rowsFor(files)[0].version, "0006");
});

test("an absent or unprovided ledger is unavailable and cannot invent pending migrations", () => {
  for (const ledger of [null, undefined, { migration_ledger_present: false }]) {
    const report = reconcileMigrationLedger(files, ledger);
    assert.equal(report.status, "unavailable");
    assert.equal(report.hosted_row_count, null);
    assert.equal(report.matched_file_count, 0);
    assert.deepEqual(report.pending, []);
  }
  const empty = reconcileMigrationLedger(files, snapshot([]));
  assert.equal(empty.status, "blocked");
  assert.equal(empty.pending.length, files.length);
});

test("missing prerequisites before a later applied version block a latest-only rollout", () => {
  const report = reconcileMigrationLedger(files, snapshot([rowsFor(files).at(-1)]));
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.pending.map(({ file }) => file), files.slice(0, 2));
  assert.deepEqual(report.gaps_before_applied, report.pending);
  const tail = reconcileMigrationLedger(files, snapshot(rowsFor(files).slice(0, 2)));
  assert.equal(tail.pending.length, 1);
  assert.deepEqual(tail.gaps_before_applied, []);
});

test("same-version scripts remain ambiguous even when one hosted name matches", () => {
  const names = ["0032_first.sql", "0032_second.sql", "20260512_one.sql", "20260512_two.sql"];
  for (const migrations of [
    [{ version: "0032", name: null }, { version: "20260512", name: null }],
    [{ version: "0032", name: "first" }, { version: "20260512", name: "one" }]
  ]) {
    const report = reconcileMigrationLedger(names, snapshot(migrations));
    assert.equal(report.status, "blocked");
    assert.equal(report.local_version_collisions.length, 2);
    assert.ok(report.matched_file_count < names.length);
    assert.deepEqual(report.pending, [], "existing versions cannot be labelled safe new migration applications");
  }
});

test("duplicate and foreign hosted versions and wrong names cannot become a match", () => {
  const rows = rowsFor(files);
  const duplicate = reconcileMigrationLedger(files, snapshot([...rows, rows[0]]));
  assert.equal(duplicate.status, "blocked");
  assert.deepEqual(duplicate.duplicate_hosted_versions, ["0006"]);
  assert.equal(duplicate.matched_file_count, 2);
  const foreign = reconcileMigrationLedger(files, snapshot([...rows, { version: "20990101000000", name: "foreign" }]));
  assert.equal(foreign.status, "blocked");
  assert.equal(foreign.unknown_hosted.length, 1);
  const wrongName = reconcileMigrationLedger(files, snapshot([{ ...rows[0], name: "other" }, ...rows.slice(1)]));
  assert.equal(wrongName.status, "blocked");
  assert.equal(wrongName.name_mismatches.length, 1);
  assert.equal(wrongName.matched_file_count, 2);
});

test("legacy nameless rows and the SQL Editor export wrapper work for unique versions", () => {
  const ledger = snapshot(rowsFor(files).map(({ version }) => ({ version })));
  assert.equal(reconcileMigrationLedger(files, ledger).status, "ledger_matches");
  assert.equal(reconcileMigrationLedger(files, [{ migration_ledger: ledger }]).status, "ledger_matches");
});

test("malformed snapshots and filenames reject without including source payloads", () => {
  for (const ledger of [
    {}, [], [{ migration_ledger: null }], { migration_ledger_present: "true", migrations: [] },
    snapshot(null), snapshot([null]), snapshot([{ version: 6 }]), snapshot([{ version: "6e3" }]),
    snapshot([{ version: " 0006" }]), snapshot([{ version: "0006", name: "private-secret!" }])
  ]) {
    assert.throws(() => reconcileMigrationLedger(files, ledger), (error) => !error.message.includes("private-secret"));
  }
  for (const names of [[], ["../0006_escape.sql"], ["unversioned.sql"], ["0006_bad.sql.bak"]]) {
    assert.throws(() => buildMigrationManifest(names));
  }
});

test("any missing version blocks acceptance regardless of ledger order", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 60 }), fc.nat(), (count, seed) => {
    const names = Array.from({ length: count }, (_, index) => `${String(index + 1).padStart(4, "0")}_step_${index}.sql`);
    const missing = seed % count;
    const migrations = rowsFor(names).filter((_, index) => index !== missing).reverse();
    const report = reconcileMigrationLedger(names.reverse(), snapshot(migrations));
    assert.equal(report.status, "blocked");
    assert.equal(report.matched_file_count, count - 1);
    assert.equal(report.pending.length, 1);
    assert.equal(report.pending[0].version, String(missing + 1).padStart(4, "0"));
  }), { numRuns: 150, seed: 20261014 });
});

test("the actual SQL export returns metadata only and preserves legacy version padding", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
      insert into supabase_migrations.schema_migrations values
        ('0006','foundation',array['private SQL body']), ('20261008010000','access',array['private SQL body']);`);
    const result = await db.exec(exportSql);
    const ledger = result.flatMap(({ rows }) => rows).find((row) => row.migration_ledger).migration_ledger;
    assert.deepEqual(ledger, snapshot([{ version: "0006", name: "foundation" }, { version: "20261008010000", name: "access" }]));
    assert.ok(!JSON.stringify(ledger).includes("private"));
    assert.equal(reconcileMigrationLedger([files[0], files[2]], ledger).status, "ledger_matches");
  } finally { await db.close(); }
});

test("the actual SQL export accepts a legacy ledger without a name column", async () => {
  const db = new PGlite();
  try {
    await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key); insert into supabase_migrations.schema_migrations values('0006');");
    const result = await db.exec(exportSql);
    const ledger = result.flatMap(({ rows }) => rows).find((row) => row.migration_ledger).migration_ledger;
    assert.deepEqual(ledger.migrations, [{ version: "0006", name: null }]);
  } finally { await db.close(); }
});

test("the actual SQL export never interprets an absent catalog as empty history", async () => {
  const db = new PGlite();
  try {
    await assert.rejects(db.exec(exportSql), { code: "42P01" });
    await db.exec("rollback;");
  } finally { await db.close(); }
});

test("the export transaction rejects an accidental write and leaves the ledger unchanged", async () => {
  const db = new PGlite();
  try {
    await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key); insert into supabase_migrations.schema_migrations values('0006');");
    const accidentalWrite = exportSql.replace("rollback;", "insert into supabase_migrations.schema_migrations values('0007'); rollback;");
    await assert.rejects(db.exec(accidentalWrite), { code: "25006" });
    await db.exec("rollback;");
    assert.deepEqual((await db.query("select version from supabase_migrations.schema_migrations")).rows, [{ version: "0006" }]);
  } finally { await db.close(); }
});

test("the export enforces read-only access inside an existing outer transaction", async () => {
  const db = new PGlite();
  try {
    await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key); insert into supabase_migrations.schema_migrations values('0006');");
    await db.exec("begin;");
    const accidentalWrite = exportSql.replace("rollback;", "insert into supabase_migrations.schema_migrations values('0007'); rollback;");
    await assert.rejects(db.exec(accidentalWrite), { code: "25006" });
    await db.exec("rollback;");
    assert.deepEqual((await db.query("select version from supabase_migrations.schema_migrations")).rows, [{ version: "0006" }]);
  } finally { await db.close(); }
});

test("the reconciliation CLI diagnoses this checkout without database credentials", () => {
  const script = fileURLToPath(new URL("../scripts/check-migration-ledger.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", script], { encoding: "utf8" });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "unavailable");
  assert.ok(report.local_file_count > 0);
  assert.equal(report.hosted_row_count, null);
  assert.deepEqual(report.pending, []);
  const invalid = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", script, "--unknown", "private-secret"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.ok(!invalid.stderr.includes("private-secret"));
});
