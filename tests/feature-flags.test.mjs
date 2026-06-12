import test from "node:test";
import assert from "node:assert/strict";
import { defaultFeatureFlags, isFeatureEnabled } from "../lib/enterprise/features.ts";

test("enterprise feature flags keep operational defaults enabled", () => {
  assert.equal(isFeatureEnabled(defaultFeatureFlags, "production_planning"), true);
  assert.equal(isFeatureEnabled(defaultFeatureFlags, "advanced_inventory"), true);
  assert.equal(isFeatureEnabled(defaultFeatureFlags, "quality_compliance"), true);
});

test("enterprise feature flags allow company overrides", () => {
  assert.equal(isFeatureEnabled({ ai_assistant: true }, "ai_assistant"), true);
  assert.equal(isFeatureEnabled({ barcode_tracking: false }, "barcode_tracking"), false);
});
