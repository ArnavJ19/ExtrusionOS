import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runFactoryWorkflowIntegrityChecks } from "../scripts/test-factory-workflow-integrity.mjs";

describe("factory workflow integrity migration", () => {
  it("applies the full additive migration twice and exercises protected workflows", async () => {
    const checks = await runFactoryWorkflowIntegrityChecks();
    assert.deepEqual(checks, [
      "direct completed status spoof is rejected",
      "actual completion preserves issued billet consumption and balanced scrap atomically",
      "completed output correction is audited and keeps mass balance",
      "completed correction reconciles the actual planned finishing handoff",
      "dispatch actual activation cannot be caller forged",
      "reservation snapshots are exact and consumed reservations cannot reactivate",
      "partial dispatch reservation consumption is exact and idempotent",
      "mixed reservation dispatch rollback restores earlier source debits",
      "authenticated credit-note wrappers issue idempotently and reverse the actual ledger",
      "partial-dispatched order permits its exact 800 kg remainder and current resource-safe release",
      "factory managers can manually allocate and reallocate temper-compatible billets",
      "priority allocator selects matching alloy, temper, and diameter",
      "quality rework resolution creates once-only approved/rejected children",
      "open rework SQL feed excludes resolved rows before ten-row pagination",
      "private trigger helper execute is revoked",
      "foundry and factory migrations protect one source-backed billet through completion",
      "read-only factory preflight detects incomplete legacy unit provenance"
    ]);
  });
});
