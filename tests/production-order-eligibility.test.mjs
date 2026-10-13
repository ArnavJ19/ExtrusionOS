import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isProductionOrderStageOpenForPlanning } from "../lib/actions/production-order-eligibility.ts";

describe("production order stage eligibility", () => {
  it("keeps remaining work schedulable after a partial dispatch", () => {
    assert.equal(isProductionOrderStageOpenForPlanning("dispatched"), true);
    assert.equal(isProductionOrderStageOpenForPlanning("in_production"), true);
  });

  it("keeps terminal fulfillment stages closed", () => {
    for (const stage of ["closed", "cancelled", "delivered", "payment_pending"]) {
      assert.equal(isProductionOrderStageOpenForPlanning(stage), false, `${stage} must stay closed`);
    }
  });
});
