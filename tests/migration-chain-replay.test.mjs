import assert from "node:assert/strict";
import test from "node:test";
import { migrationFiles, replayMigrationChain } from "../scripts/lib/migration-chain-replay.mjs";

test("every migration has a unique 14-digit version so file order is unambiguous", () => {
  const versions = migrationFiles().map(name => name.split("_")[0]);
  assert.deepEqual(versions.filter(version => !/^\d{14}$/.test(version)), []);
  assert.deepEqual(versions.filter((version, index) => versions.indexOf(version) !== index), []);
});

test("a fresh database builds from the baseline and every migration in file order", { timeout: 300_000 }, async () => {
  const { db, files, applied, failures } = await replayMigrationChain({ stopOnFailure: false });
  try {
    assert.deepEqual(failures, []);
    assert.equal(applied, files.length);
    const { rows } = await db.query(`select
      to_regclass('public.tasks') is not null as tasks,
      to_regclass('public.production_plan_slots') is not null as plan_slots,
      exists (select 1 from pg_indexes where indexname = 'idx_tasks_company_status_due') as command_center_index,
      (select array_agg(plan_type order by plan_type) from public.subscription_plans) as plan_types`);
    assert.deepEqual(rows[0], {
      tasks: true, plan_slots: true, command_center_index: true,
      plan_types: ["enterprise", "free_demo", "pro", "starter"]
    });
  } finally {
    await db.close();
  }
});
