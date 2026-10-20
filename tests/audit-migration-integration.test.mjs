import test from "node:test";
import assert from "node:assert/strict";
import { runAuditMigrationIntegrationChecks } from "../scripts/test-audit-migration-integration.mjs";

test("whole audit migrations coexist with authorized views, masks and RPC grants",async()=>{
  const result = await runAuditMigrationIntegrationChecks();
  assert.equal(result.migrations,8);
  assert.equal(result.preparedFunctions,44);
  assert.equal(result.preparedTriggers,13);
  assert.ok(result.views >= 10);
  assert.ok(result.tables > 30);
});
