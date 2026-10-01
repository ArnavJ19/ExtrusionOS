import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const migrationPath = new URL("../supabase/migrations/20260918000000_production_source_line_integrity.sql", import.meta.url);
const actionPath = new URL("../lib/actions/production.ts", import.meta.url);
const formPath = new URL("../components/modules/operations/record-form-client.tsx", import.meta.url);

describe("production source-line integrity", () => {
  it("enforces order-line ownership and billet presence in the database", async () => {
    const sql = await readFile(migrationPath, "utf8");
    assert.match(sql, /new\.source_line_id is null/i);
    assert.match(sql, /item\.order_id = new\.order_id/i);
    assert.match(sql, /v_order_line\.profile_id is distinct from new\.profile_id/i);
    assert.match(sql, /billet\.production_job_id = new\.id/i);
    assert.match(sql, /billet\.status in \('issued', 'consumed'\)/i);
    assert.match(sql, /old\.status not in \('planned', 'ready'\)/i);
    assert.match(sql, /Production lineage cannot change after the job leaves planning/i);
  });

  it("carries the explicit source line through the form and server action", async () => {
    const [action, form] = await Promise.all([
      readFile(actionPath, "utf8"),
      readFile(formPath, "utf8")
    ]);
    assert.match(action, /parsed\.data\.source_line_id/);
    assert.match(action, /Select the exact order line before planning production/);
    assert.match(action, /converted order has no order lines/);
    assert.match(form, /source_line_id: item\.id \?\? ""/);
    assert.match(form, /Select the exact order line/);
  });
});
