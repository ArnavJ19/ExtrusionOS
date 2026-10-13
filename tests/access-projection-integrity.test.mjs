import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAccessProjectionIntegrityChecks } from "../scripts/test-access-projection-integrity.mjs";

describe("access projection integrity", () => {
  it("replaces effective policies and enforces fixed projections under authenticated SQL role", async () => {
    const checks = await runAccessProjectionIntegrityChecks();
    assert.deepEqual(checks, [
      "migration applies and view grants are SELECT-only despite permissive default grants",
      "dealer reads are company- and relationship-scoped with commercial but no internal fields",
      "sales and operations projections mask costs, rates, margins, formula JSON, and embedded options",
      "accounts may read approved costs while direct protected base columns remain unavailable",
      "calculation RPC is owner/admin-only while accounts retain costing reads",
      "dispatch managers can inspect reservations without receiving reservation-write capability",
      "order and order-line writes require the authorized workflow for non-admin roles",
      "cross-dealer, cross-company, suspended, and viewer mutation probes fail closed"
    ]);
  });
});
