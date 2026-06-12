/**
 * Unit Tests: Min/Max Weight Range Validation (Task 8.3)
 *
 * Verifies the superRefine in technicalLineItemSchema rejects when min_weight > max_weight.
 *
 * **Validates: Requirements 2.12, 20.3**
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  technicalLineItemSchema,
} from "../lib/validations/pcda/line-item.ts";

/**
 * Helper: build a minimal valid payload with only weight fields set.
 * All other fields are either optional or have defaults.
 */
function buildPayload(overrides = {}) {
  return {
    ...overrides,
  };
}

describe("Min/Max Weight Range Validation (Req 2.12, 20.3)", () => {
  it("rejects when min_weight > max_weight", () => {
    const result = technicalLineItemSchema.safeParse(
      buildPayload({ min_weight: 5, max_weight: 3 })
    );

    assert.strictEqual(result.success, false, "Should reject when min_weight > max_weight");

    // Verify the error targets the min_weight field with the correct message
    const issues = result.error.issues;
    const weightIssue = issues.find(
      (i) => i.path.includes("min_weight") && i.message.includes("min_weight cannot exceed max_weight")
    );
    assert.ok(weightIssue, `Expected weight-range error, got: ${JSON.stringify(issues)}`);
  });

  it("accepts when min_weight < max_weight", () => {
    const result = technicalLineItemSchema.safeParse(
      buildPayload({ min_weight: 3, max_weight: 5 })
    );

    // Check there are no weight-range errors (other validation errors may exist for other fields)
    if (!result.success) {
      const weightIssue = result.error.issues.find(
        (i) => i.path.includes("min_weight") && i.message.includes("min_weight cannot exceed max_weight")
      );
      assert.strictEqual(weightIssue, undefined, "Should not have weight-range error when min < max");
    }
  });

  it("accepts when min_weight equals max_weight", () => {
    const result = technicalLineItemSchema.safeParse(
      buildPayload({ min_weight: 5, max_weight: 5 })
    );

    // Check there are no weight-range errors
    if (!result.success) {
      const weightIssue = result.error.issues.find(
        (i) => i.path.includes("min_weight") && i.message.includes("min_weight cannot exceed max_weight")
      );
      assert.strictEqual(weightIssue, undefined, "Should not have weight-range error when min == max");
    }
  });

  it("accepts when min_weight is set and max_weight is null (not captured)", () => {
    const result = technicalLineItemSchema.safeParse(
      buildPayload({ min_weight: 5, max_weight: null })
    );

    // Null max_weight means not captured — refinement should not trigger
    if (!result.success) {
      const weightIssue = result.error.issues.find(
        (i) => i.path.includes("min_weight") && i.message.includes("min_weight cannot exceed max_weight")
      );
      assert.strictEqual(weightIssue, undefined, "Should not have weight-range error when max_weight is null");
    }
  });

  it("accepts when max_weight is set and min_weight is null (not captured)", () => {
    const result = technicalLineItemSchema.safeParse(
      buildPayload({ min_weight: null, max_weight: 5 })
    );

    // Null min_weight means not captured — refinement should not trigger
    if (!result.success) {
      const weightIssue = result.error.issues.find(
        (i) => i.path.includes("min_weight") && i.message.includes("min_weight cannot exceed max_weight")
      );
      assert.strictEqual(weightIssue, undefined, "Should not have weight-range error when min_weight is null");
    }
  });

  it("accepts when both min_weight and max_weight are null", () => {
    const result = technicalLineItemSchema.safeParse(
      buildPayload({ min_weight: null, max_weight: null })
    );

    // Both null — refinement should not trigger
    if (!result.success) {
      const weightIssue = result.error.issues.find(
        (i) => i.path.includes("min_weight") && i.message.includes("min_weight cannot exceed max_weight")
      );
      assert.strictEqual(weightIssue, undefined, "Should not have weight-range error when both are null");
    }
  });

  it("accepts when both min_weight and max_weight are undefined (not provided)", () => {
    const result = technicalLineItemSchema.safeParse(buildPayload({}));

    // Neither provided — refinement should not trigger
    if (!result.success) {
      const weightIssue = result.error.issues.find(
        (i) => i.path.includes("min_weight") && i.message.includes("min_weight cannot exceed max_weight")
      );
      assert.strictEqual(weightIssue, undefined, "Should not have weight-range error when both are undefined");
    }
  });
});
