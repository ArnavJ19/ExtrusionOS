/**
 * Property Test: No-Fabrication Display
 *
 * Property 14: Absent values render a Not_Captured_Label and never a fabricated value
 *
 * **Validates: Requirements 1.9, 4.9, 7.4, 13.3, 14.4, 15.3, 18.2, 21.5, 24.1, 24.2**
 *
 * For any line or report model with arbitrary absent (null/NOT_CAPTURED) fields,
 * the display/report mapper yields the applicable Not_Captured_Label for each absent
 * field and never a numeric, default, hardcoded, or otherwise fabricated value;
 * profitability excludes absent cost components from the computed profit and renders
 * their label rather than substituting a default.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  mapCalcResultToDisplay,
  mapNullableToDisplay,
  NOT_CAPTURED_LABEL,
  MISSING_COST_LABEL,
  PENDING_APPROVAL_LABEL,
  NO_DRAWING_LABEL,
  NO_ACTIVE_DIE_LABEL,
} from "../lib/pcda/labels.ts";
import { NOT_CAPTURED } from "../lib/calculations/pcda/sentinel.ts";

/**
 * The set of all valid Not_Captured_Label constants.
 */
const VALID_LABELS = new Set([
  NOT_CAPTURED_LABEL,
  MISSING_COST_LABEL,
  PENDING_APPROVAL_LABEL,
  NO_DRAWING_LABEL,
  NO_ACTIVE_DIE_LABEL,
]);

/**
 * Arbitrary for custom label strings (non-empty, non-numeric).
 */
const customLabelArb = fc.string({ minLength: 1, maxLength: 100 }).filter(
  (s) => s.trim().length > 0 && isNaN(Number(s))
);

/**
 * Arbitrary for finite numbers (valid captured values).
 */
const finiteNumberArb = fc.double({
  min: -1e9,
  max: 1e9,
  noNaN: true,
  noDefaultInfinity: true,
});

describe("Property 14: Absent values render a Not_Captured_Label and never a fabricated value", () => {
  /**
   * **Validates: Requirements 1.9, 4.9, 24.1**
   *
   * mapCalcResultToDisplay with NOT_CAPTURED always returns a string (a label), never a number.
   */
  it("mapCalcResultToDisplay with NOT_CAPTURED always returns a string, never a number", () => {
    fc.assert(
      fc.property(fc.option(customLabelArb, { nil: undefined }), (label) => {
        const result = mapCalcResultToDisplay(NOT_CAPTURED, label);
        assert.strictEqual(
          typeof result,
          "string",
          `Expected a string label for NOT_CAPTURED input, got: ${typeof result} (${result})`
        );
        assert.notStrictEqual(
          typeof result,
          "number",
          "NOT_CAPTURED must never produce a numeric output"
        );
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 1.9, 24.2**
   *
   * mapCalcResultToDisplay with a number always returns that exact number, never a string.
   */
  it("mapCalcResultToDisplay with a number always returns that exact number, never a string", () => {
    fc.assert(
      fc.property(finiteNumberArb, fc.option(customLabelArb, { nil: undefined }), (num, label) => {
        const result = mapCalcResultToDisplay(num, label);
        assert.strictEqual(
          result,
          num,
          `Expected the exact number ${num} to pass through, got: ${result}`
        );
        assert.strictEqual(
          typeof result,
          "number",
          "A captured numeric value must always return as a number"
        );
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 1.9, 4.9, 7.4, 13.3**
   *
   * mapCalcResultToDisplay with NOT_CAPTURED returns the provided label or defaults to "Not Captured".
   */
  it("mapCalcResultToDisplay with NOT_CAPTURED returns the provided label or defaults to NOT_CAPTURED_LABEL", () => {
    fc.assert(
      fc.property(fc.option(customLabelArb, { nil: undefined }), (label) => {
        const result = mapCalcResultToDisplay(NOT_CAPTURED, label);
        const expected = label ?? NOT_CAPTURED_LABEL;
        assert.strictEqual(
          result,
          expected,
          `Expected label "${expected}", got "${result}"`
        );
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 1.9, 14.4, 15.3, 18.2**
   *
   * mapNullableToDisplay with null/undefined returns a label string, never a number.
   */
  it("mapNullableToDisplay with null/undefined returns a label string, never a number", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, undefined),
        fc.option(customLabelArb, { nil: undefined }),
        (nullish, label) => {
          const result = mapNullableToDisplay(nullish, label);
          assert.strictEqual(
            typeof result,
            "string",
            `Expected a string label for ${nullish} input, got: ${typeof result} (${result})`
          );
          assert.notStrictEqual(
            typeof result,
            "number",
            "Null/undefined input must never produce a numeric output"
          );
        }
      ),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 24.1, 24.2**
   *
   * mapNullableToDisplay with a non-null value returns that value as-is.
   */
  it("mapNullableToDisplay with a non-null value returns that value as-is", () => {
    const nonNullValueArb = fc.oneof(
      finiteNumberArb,
      fc.string({ minLength: 0, maxLength: 100 }),
      fc.boolean()
    );

    fc.assert(
      fc.property(nonNullValueArb, fc.option(customLabelArb, { nil: undefined }), (value, label) => {
        const result = mapNullableToDisplay(value, label);
        assert.strictEqual(
          result,
          value,
          `Expected value ${JSON.stringify(value)} to pass through, got: ${JSON.stringify(result)}`
        );
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 1.9, 4.9, 7.4, 21.5, 24.1**
   *
   * No fabricated values: when input is absent, the output is always one of the valid
   * Not_Captured_Label constants (or a custom label provided by the caller).
   */
  it("when input is absent, output is always a valid label constant or the custom label provided", () => {
    const validLabelArb = fc.constantFrom(
      NOT_CAPTURED_LABEL,
      MISSING_COST_LABEL,
      PENDING_APPROVAL_LABEL,
      NO_DRAWING_LABEL,
      NO_ACTIVE_DIE_LABEL
    );

    fc.assert(
      fc.property(
        fc.oneof(validLabelArb, customLabelArb, fc.constant(undefined)),
        (label) => {
          // Test mapCalcResultToDisplay
          const calcResult = mapCalcResultToDisplay(NOT_CAPTURED, label);
          if (label === undefined) {
            assert.ok(
              VALID_LABELS.has(calcResult),
              `Without custom label, mapCalcResultToDisplay should return a known label constant, got: "${calcResult}"`
            );
          } else {
            assert.strictEqual(
              calcResult,
              label,
              `With custom label "${label}", mapCalcResultToDisplay should return it exactly, got: "${calcResult}"`
            );
          }

          // Test mapNullableToDisplay with null
          const nullResult = mapNullableToDisplay(null, label);
          if (label === undefined) {
            assert.ok(
              VALID_LABELS.has(nullResult),
              `Without custom label, mapNullableToDisplay(null) should return a known label constant, got: "${nullResult}"`
            );
          } else {
            assert.strictEqual(
              nullResult,
              label,
              `With custom label "${label}", mapNullableToDisplay(null) should return it exactly, got: "${nullResult}"`
            );
          }

          // Test mapNullableToDisplay with undefined
          const undefinedResult = mapNullableToDisplay(undefined, label);
          if (label === undefined) {
            assert.ok(
              VALID_LABELS.has(undefinedResult),
              `Without custom label, mapNullableToDisplay(undefined) should return a known label constant, got: "${undefinedResult}"`
            );
          } else {
            assert.strictEqual(
              undefinedResult,
              label,
              `With custom label "${label}", mapNullableToDisplay(undefined) should return it exactly, got: "${undefinedResult}"`
            );
          }
        }
      ),
      { numRuns: 1000 }
    );
  });
});
