/**
 * Property Tests: Numeric field validation, weight range, text/enum/flag rules
 *
 * Property 8: Numeric field validation accepts a value iff it satisfies that field's rule
 * Property 9: Weight range validation accepts iff minimum does not exceed maximum
 * Property 10: Text length and enum/flag rules are enforced exactly
 *
 * **Validates: Requirements 2.9, 2.11, 2.12, 2.13, 2.14, 2.15, 3.5, 3.9, 3.10, 3.11, 20.1–20.4**
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  technicalLineItemSchema,
  hasAtMostNDecimalPlaces,
} from "../lib/validations/pcda/line-item.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_VALUE = 999_999_999.99;

/**
 * Builds a minimal valid line-item object for testing specific field overrides.
 * All fields are optional in the schema, so we only set what's needed for the test.
 */
function basePayload(overrides = {}) {
  return {
    packing_in_conversion: false,
    include_packing_in_basic: false,
    ...overrides,
  };
}

/**
 * Checks whether a safeParse result has an error on a specific path.
 */
function hasErrorOnPath(result, path) {
  if (result.success) return false;
  return result.error.issues.some(
    (issue) => issue.path.join(".") === path
  );
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a positive number with at most 2 decimal places, within monetary bounds */
const validMoneyArb = fc
  .integer({ min: 1, max: 99999999999 }) // 1 to 999_999_999_99 in cents
  .map((cents) => cents / 100);

/** Generates a positive number with exactly 3 decimal places (invalid for money).
 *  Built as integer / 1000 where the integer is NOT divisible by 10 (ensuring 3dp). */
const invalidDecimalMoneyArb = fc
  .integer({ min: 1, max: 999999999 })
  .filter((v) => v % 10 !== 0) // ensure last digit is non-zero → exactly 3dp
  .map((v) => v / 1000);

/** Generates a valid GST value: 0-100 with at most 2 decimal places */
const validGstArb = fc
  .integer({ min: 0, max: 10000 })
  .map((v) => v / 100);

/** Generates a GST value >100 (invalid) */
const invalidGstTooHighArb = fc
  .integer({ min: 10001, max: 50000 })
  .map((v) => v / 100);

/** Generates a signed value for margin with at most 2 decimal places in range */
const validMarginArb = fc
  .integer({ min: -99999999999, max: 99999999999 })
  .map((v) => v / 100);

/** Generates a positive value within bounds (for weight/quantity fields) */
const validPositiveArb = fc.double({
  min: 0.001,
  max: MAX_VALUE,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Generates a non-positive value (invalid for positive fields) */
const nonPositiveArb = fc.oneof(
  fc.constant(0),
  fc.double({ min: -1e9, max: -0.001, noNaN: true, noDefaultInfinity: true })
);

/** Generates a value too large (> MAX_VALUE) */
const tooLargeArb = fc.double({
  min: MAX_VALUE + 0.01,
  max: 1e12,
  noNaN: true,
  noDefaultInfinity: true,
});

// ---------------------------------------------------------------------------
// Property 8: Numeric field validation
// ---------------------------------------------------------------------------

describe("Property 8: Numeric field validation accepts a value iff it satisfies that field's rule", () => {
  /**
   * **Validates: Requirements 3.5, 20.1, 20.2**
   *
   * Monetary fields (material_price, packing_charge, etc.): accept positive,
   * ≤ MAX_VALUE, at most 2 decimal places.
   */
  describe("Monetary fields (positive, ≤2dp, ≤MAX_VALUE)", () => {
    const monetaryFields = [
      "material_price",
      "value_added_service_price",
      "other_charges",
      "basic_price",
      "packing_charge",
      "freight_charge",
      "alloy_surcharge_per_kg",
      "re_cutting_charge_per_kg",
      "testing_service_charge_per_kg",
      "die_cost",
      "die_service_charge",
      "discount",
      "net_rate",
      "final_line_value",
    ];

    for (const field of monetaryFields) {
      it(`${field}: accepts valid positive values with ≤2dp`, () => {
        fc.assert(
          fc.property(validMoneyArb, (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ [field]: value })
            );
            return !hasErrorOnPath(result, field);
          }),
          { numRuns: 500 }
        );
      });

      it(`${field}: rejects values with >2 decimal places`, () => {
        fc.assert(
          fc.property(invalidDecimalMoneyArb, (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ [field]: value })
            );
            return hasErrorOnPath(result, field);
          }),
          { numRuns: 500 }
        );
      });

      it(`${field}: rejects non-positive values`, () => {
        fc.assert(
          fc.property(nonPositiveArb, (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ [field]: value })
            );
            return hasErrorOnPath(result, field);
          }),
          { numRuns: 200 }
        );
      });

      it(`${field}: rejects values > MAX_VALUE`, () => {
        fc.assert(
          fc.property(tooLargeArb, (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ [field]: value })
            );
            return hasErrorOnPath(result, field);
          }),
          { numRuns: 200 }
        );
      });
    }
  });

  /**
   * **Validates: Requirements 3.9**
   *
   * GST: accepts 0-100 with at most 2 decimal places; rejects outside range or >2dp.
   */
  describe("GST percentage (0-100, ≤2dp)", () => {
    it("gst_percent: accepts values in [0, 100] with ≤2dp", () => {
      fc.assert(
        fc.property(validGstArb, (value) => {
          const result = technicalLineItemSchema.safeParse(
            basePayload({ gst_percent: value })
          );
          return !hasErrorOnPath(result, "gst_percent");
        }),
        { numRuns: 1000 }
      );
    });

    it("gst_percent: rejects values > 100", () => {
      fc.assert(
        fc.property(invalidGstTooHighArb, (value) => {
          const result = technicalLineItemSchema.safeParse(
            basePayload({ gst_percent: value })
          );
          return hasErrorOnPath(result, "gst_percent");
        }),
        { numRuns: 500 }
      );
    });

    it("gst_percent: rejects negative values", () => {
      fc.assert(
        fc.property(
          fc.double({ min: -1e6, max: -0.01, noNaN: true, noDefaultInfinity: true }),
          (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ gst_percent: value })
            );
            return hasErrorOnPath(result, "gst_percent");
          }
        ),
        { numRuns: 500 }
      );
    });

    it("gst_percent: rejects values with >2 decimal places", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 99 }),
          fc.integer({ min: 1, max: 999 }),
          (intPart, frac) => {
            // Create a value like intPart.XYZ where XYZ has 3dp
            const value = intPart + frac / 1000;
            if (!hasAtMostNDecimalPlaces(value, 2)) {
              const result = technicalLineItemSchema.safeParse(
                basePayload({ gst_percent: value })
              );
              return hasErrorOnPath(result, "gst_percent");
            }
            return true; // skip if floating point made it 2dp anyway
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.10**
   *
   * Margin: accepts signed values with ≤2dp in range; rejects if >2dp or out of range.
   */
  describe("Margin (signed, ≤2dp, -MAX_VALUE to MAX_VALUE)", () => {
    it("margin: accepts valid signed values with ≤2dp", () => {
      fc.assert(
        fc.property(validMarginArb, (value) => {
          const result = technicalLineItemSchema.safeParse(
            basePayload({ margin: value })
          );
          return !hasErrorOnPath(result, "margin");
        }),
        { numRuns: 1000 }
      );
    });

    it("margin: accepts negative values within range", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -99999999999, max: -1 }).map((v) => v / 100),
          (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ margin: value })
            );
            return !hasErrorOnPath(result, "margin");
          }
        ),
        { numRuns: 500 }
      );
    });

    it("margin: rejects values with >2 decimal places", () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: -999, max: 999 }),
            fc.integer({ min: 1, max: 999 })
          ),
          ([intPart, frac]) => {
            const value = intPart + frac / 1000;
            if (!hasAtMostNDecimalPlaces(value, 2)) {
              const result = technicalLineItemSchema.safeParse(
                basePayload({ margin: value })
              );
              return hasErrorOnPath(result, "margin");
            }
            return true;
          }
        ),
        { numRuns: 500 }
      );
    });

    it("margin: rejects values outside [-MAX_VALUE, MAX_VALUE]", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.double({ min: -1e12, max: -(MAX_VALUE + 0.01), noNaN: true, noDefaultInfinity: true }),
            fc.double({ min: MAX_VALUE + 0.01, max: 1e12, noNaN: true, noDefaultInfinity: true })
          ),
          (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ margin: value })
            );
            return hasErrorOnPath(result, "margin");
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.11, 2.13, 20.4**
   *
   * Positive weight/quantity fields: accepts >0, ≤MAX_VALUE; rejects ≤0 or too large.
   */
  describe("Positive weight/quantity fields (>0, ≤MAX_VALUE)", () => {
    const positiveFields = [
      "section_weight_kg_per_m",
      "min_weight",
      "max_weight",
      "order_quantity",
      "quantity_kg",
      "cl_per_uom",
      "cl_meter",
      "standard_length",
      "cut_length",
      "bundle_quantity",
      "pieces_per_m_per_kg_per_bundle",
    ];

    for (const field of positiveFields) {
      it(`${field}: accepts positive values ≤ MAX_VALUE`, () => {
        fc.assert(
          fc.property(validPositiveArb, (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ [field]: value })
            );
            return !hasErrorOnPath(result, field);
          }),
          { numRuns: 300 }
        );
      });

      it(`${field}: rejects non-positive values`, () => {
        fc.assert(
          fc.property(nonPositiveArb, (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ [field]: value })
            );
            return hasErrorOnPath(result, field);
          }),
          { numRuns: 200 }
        );
      });

      it(`${field}: rejects values > MAX_VALUE`, () => {
        fc.assert(
          fc.property(tooLargeArb, (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ [field]: value })
            );
            return hasErrorOnPath(result, field);
          }),
          { numRuns: 200 }
        );
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Property 9: Weight range validation
// ---------------------------------------------------------------------------

describe("Property 9: Weight range validation accepts iff minimum does not exceed maximum", () => {
  /**
   * **Validates: Requirements 2.12, 20.3**
   *
   * Accepts when min_weight ≤ max_weight.
   */
  it("accepts when min_weight ≤ max_weight", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: MAX_VALUE / 2, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: MAX_VALUE / 2, noNaN: true, noDefaultInfinity: true }),
        (base, extra) => {
          const minW = base;
          const maxW = base + extra; // ensures maxW >= minW
          if (maxW > MAX_VALUE) return true; // skip edge
          const result = technicalLineItemSchema.safeParse(
            basePayload({ min_weight: minW, max_weight: maxW })
          );
          return !hasErrorOnPath(result, "min_weight");
        }
      ),
      { numRuns: 2000 }
    );
  });

  /**
   * **Validates: Requirements 2.12, 20.3**
   *
   * Rejects when min_weight > max_weight with a weight-range error.
   */
  it("rejects when min_weight > max_weight", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: MAX_VALUE / 2, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: MAX_VALUE / 2, noNaN: true, noDefaultInfinity: true }),
        (base, extra) => {
          const maxW = base;
          const minW = base + extra; // ensures minW > maxW
          if (minW > MAX_VALUE) return true; // skip edge
          if (minW <= maxW) return true; // skip equal/less case
          const result = technicalLineItemSchema.safeParse(
            basePayload({ min_weight: minW, max_weight: maxW })
          );
          return hasErrorOnPath(result, "min_weight");
        }
      ),
      { numRuns: 2000 }
    );
  });

  /**
   * **Validates: Requirements 2.12, 20.3**
   *
   * When only one of min/max is provided (the other null), validation passes
   * (range check only applies when both are present).
   */
  it("accepts when only min_weight is provided (max is null)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: MAX_VALUE, noNaN: true, noDefaultInfinity: true }),
        (minW) => {
          const result = technicalLineItemSchema.safeParse(
            basePayload({ min_weight: minW, max_weight: null })
          );
          return !hasErrorOnPath(result, "min_weight");
        }
      ),
      { numRuns: 500 }
    );
  });

  it("accepts when only max_weight is provided (min is null)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: MAX_VALUE, noNaN: true, noDefaultInfinity: true }),
        (maxW) => {
          const result = technicalLineItemSchema.safeParse(
            basePayload({ min_weight: null, max_weight: maxW })
          );
          return !hasErrorOnPath(result, "min_weight");
        }
      ),
      { numRuns: 500 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Text length and enum/flag rules
// ---------------------------------------------------------------------------

describe("Property 10: Text length and enum/flag rules are enforced exactly", () => {
  /**
   * **Validates: Requirements 2.9, 2.15**
   *
   * Text: accepts strings within length limits; rejects if over limit.
   */
  describe("Text length limits", () => {
    const textFields200 = ["section_name", "customer_component_code"];
    const textFields500 = [
      "component_description",
      "packing_instruction",
      "customer_packing_requirement",
    ];

    for (const field of textFields200) {
      it(`${field}: accepts strings with length ≤ 200`, () => {
        fc.assert(
          fc.property(
            fc.string({ minLength: 0, maxLength: 200 }),
            (value) => {
              const result = technicalLineItemSchema.safeParse(
                basePayload({ [field]: value })
              );
              return !hasErrorOnPath(result, field);
            }
          ),
          { numRuns: 500 }
        );
      });

      it(`${field}: rejects strings with length > 200`, () => {
        fc.assert(
          fc.property(
            fc.string({ minLength: 201, maxLength: 500 }),
            (value) => {
              const result = technicalLineItemSchema.safeParse(
                basePayload({ [field]: value })
              );
              return hasErrorOnPath(result, field);
            }
          ),
          { numRuns: 500 }
        );
      });
    }

    for (const field of textFields500) {
      it(`${field}: accepts strings with length ≤ 500`, () => {
        fc.assert(
          fc.property(
            fc.string({ minLength: 0, maxLength: 500 }),
            (value) => {
              const result = technicalLineItemSchema.safeParse(
                basePayload({ [field]: value })
              );
              return !hasErrorOnPath(result, field);
            }
          ),
          { numRuns: 500 }
        );
      });

      it(`${field}: rejects strings with length > 500`, () => {
        fc.assert(
          fc.property(
            fc.string({ minLength: 501, maxLength: 800 }),
            (value) => {
              const result = technicalLineItemSchema.safeParse(
                basePayload({ [field]: value })
              );
              return hasErrorOnPath(result, field);
            }
          ),
          { numRuns: 500 }
        );
      });
    }
  });

  /**
   * **Validates: Requirements 2.14**
   *
   * Drawing_Approval_Status: accepts iff value is one of {Pending, Approved, Rejected}.
   */
  describe("Drawing_Approval_Status enum", () => {
    it("accepts valid enum values: Pending, Approved, Rejected", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("Pending", "Approved", "Rejected"),
          (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ drawing_approval_status: value })
            );
            return !hasErrorOnPath(result, "drawing_approval_status");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects invalid Drawing_Approval_Status values", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter(
            (s) => !["Pending", "Approved", "Rejected"].includes(s)
          ),
          (value) => {
            const result = technicalLineItemSchema.safeParse(
              basePayload({ drawing_approval_status: value })
            );
            return hasErrorOnPath(result, "drawing_approval_status");
          }
        ),
        { numRuns: 500 }
      );
    });

    it("accepts null for Drawing_Approval_Status", () => {
      const result = technicalLineItemSchema.safeParse(
        basePayload({ drawing_approval_status: null })
      );
      assert.ok(!hasErrorOnPath(result, "drawing_approval_status"));
    });
  });

  /**
   * **Validates: Requirements 3.11**
   *
   * Packing flags: rejects iff both include_packing_in_basic and packing_in_conversion are true.
   */
  describe("Packing flag mutual exclusion", () => {
    it("rejects when both packing flags are true", () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const result = technicalLineItemSchema.safeParse({
            include_packing_in_basic: true,
            packing_in_conversion: true,
          });
          return hasErrorOnPath(result, "include_packing_in_basic");
        }),
        { numRuns: 10 }
      );
    });

    it("accepts when only include_packing_in_basic is true", () => {
      const result = technicalLineItemSchema.safeParse({
        include_packing_in_basic: true,
        packing_in_conversion: false,
      });
      assert.ok(!hasErrorOnPath(result, "include_packing_in_basic"));
    });

    it("accepts when only packing_in_conversion is true", () => {
      const result = technicalLineItemSchema.safeParse({
        include_packing_in_basic: false,
        packing_in_conversion: true,
      });
      assert.ok(!hasErrorOnPath(result, "include_packing_in_basic"));
    });

    it("accepts when both packing flags are false", () => {
      const result = technicalLineItemSchema.safeParse({
        include_packing_in_basic: false,
        packing_in_conversion: false,
      });
      assert.ok(!hasErrorOnPath(result, "include_packing_in_basic"));
    });

    it("accepts all flag combinations except both-true", () => {
      fc.assert(
        fc.property(fc.boolean(), fc.boolean(), (flagA, flagB) => {
          const result = technicalLineItemSchema.safeParse({
            include_packing_in_basic: flagA,
            packing_in_conversion: flagB,
          });
          if (flagA && flagB) {
            // Should reject
            return hasErrorOnPath(result, "include_packing_in_basic");
          } else {
            // Should accept
            return !hasErrorOnPath(result, "include_packing_in_basic");
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
