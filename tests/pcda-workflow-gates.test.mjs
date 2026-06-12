import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  canUseDieForProduction,
  canApproveProfile,
  canConvertQuoteToOrder,
  shouldTriggerNitridingAlert,
  isProductionRouteComplete
} from "../lib/workflow/pcda/gates.ts";

describe("Die production gate", () => {
  it("allows active die", () => {
    const result = canUseDieForProduction("active");
    assert.equal(result.allowed, true);
  });

  it("blocks blocked die without override", () => {
    const result = canUseDieForProduction("blocked");
    assert.equal(result.allowed, false);
    assert.equal(result.requiresOverride, true);
  });

  it("allows blocked die with owner override", () => {
    const result = canUseDieForProduction("blocked", true);
    assert.equal(result.allowed, true);
  });

  it("blocks retired die", () => {
    assert.equal(canUseDieForProduction("retired").allowed, false);
    assert.equal(canUseDieForProduction("scrapped").allowed, false);
    assert.equal(canUseDieForProduction("dead").allowed, false);
    assert.equal(canUseDieForProduction("under_correction").allowed, false);
  });

  it("warns on trial/nitriding but allows", () => {
    const trial = canUseDieForProduction("trial");
    assert.equal(trial.allowed, true);
    assert.ok(trial.reason?.includes("Warning"));

    const nitriding = canUseDieForProduction("nitriding");
    assert.equal(nitriding.allowed, true);
  });

  it("blocks unknown status", () => {
    assert.equal(canUseDieForProduction(null).allowed, false);
  });
});

describe("Profile approval gate", () => {
  it("blocks approval without drawing", () => {
    const result = canApproveProfile(false);
    assert.equal(result.allowed, false);
    assert.equal(result.requiresOverride, true);
  });

  it("allows approval with drawing", () => {
    assert.equal(canApproveProfile(true).allowed, true);
  });

  it("allows without drawing with owner override", () => {
    assert.equal(canApproveProfile(false, true).allowed, true);
  });
});

describe("Quote to order conversion gate", () => {
  it("blocks if drawing not approved", () => {
    assert.equal(canConvertQuoteToOrder("pending").allowed, false);
    assert.equal(canConvertQuoteToOrder(null).allowed, false);
  });

  it("allows if drawing approved", () => {
    assert.equal(canConvertQuoteToOrder("approved").allowed, true);
  });
});

describe("Nitriding alert trigger", () => {
  it("triggers when tons exceed threshold", () => {
    assert.equal(shouldTriggerNitridingAlert(16, 50), true);
  });

  it("triggers when runs exceed threshold", () => {
    assert.equal(shouldTriggerNitridingAlert(5, 101), true);
  });

  it("does not trigger below both thresholds", () => {
    assert.equal(shouldTriggerNitridingAlert(10, 80), false);
  });

  it("does not trigger with null values", () => {
    assert.equal(shouldTriggerNitridingAlert(null, null), false);
  });
});

describe("Production route completeness", () => {
  it("blocks when no steps are defined", () => {
    const result = isProductionRouteComplete(0);
    assert.equal(result.allowed, false);
    assert.equal(result.requiresOverride, true);
    assert.ok(result.reason?.includes("incomplete"));
  });

  it("allows when steps exist", () => {
    assert.equal(isProductionRouteComplete(5).allowed, true);
    assert.equal(isProductionRouteComplete(5).reason, undefined);
  });
});
