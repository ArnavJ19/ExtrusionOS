/**
 * Property Test: Line Reuse
 *
 * Property 12: Line reuse copies the full field set, preserves not-captured state, and is non-destructive
 *
 * **Validates: Requirements 1.3, 1.4, 1.5**
 *
 * Verifies:
 * 1. Every field (except id, source_record_id, source_line_id, revision_number) in the copy equals the source value
 * 2. Null values in source remain null in the copy (not-captured state preserved)
 * 3. source_record_id and source_line_id are stamped with the ref values
 * 4. The copy gets a new unique id (different from source)
 * 5. revision_number is reset to 1
 * 6. Editing the copy does not affect the source (non-destructive)
 * 7. The copy has the complete canonical field set
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { copyLineForReuse, hasCompleteFieldSet } from "../lib/pcda/line-item.ts";
import { TECHNICAL_LINE_ITEM_FIELDS } from "../lib/pcda/field-map.ts";

/**
 * Arbitrary for DrawingApprovalStatus values (or null).
 */
const drawingApprovalStatus = fc.constantFrom("Pending", "Approved", "Rejected", null);

/**
 * Arbitrary for QtyMethod values (or null).
 */
const qtyMethod = fc.constantFrom("length_weight_qty", "theoretical", "actual", null);

/**
 * Arbitrary for nullable strings (simulating not-captured text fields).
 */
const nullableString = fc.oneof(
  fc.string({ minLength: 0, maxLength: 50 }),
  fc.constant(null)
);

/**
 * Arbitrary for nullable positive numbers (simulating not-captured numeric fields).
 */
const nullableNumber = fc.oneof(
  fc.double({ min: 0.01, max: 999999.99, noNaN: true, noDefaultInfinity: true }),
  fc.constant(null)
);

/**
 * Arbitrary for generating a complete TechnicalLineItem with random values,
 * including many null fields to test not-captured state preservation.
 */
const technicalLineItemArb = fc.record({
  // Identity
  id: fc.uuid(),
  company_id: fc.uuid(),
  source_record_id: fc.oneof(fc.uuid(), fc.constant(null)),
  source_line_id: fc.oneof(fc.uuid(), fc.constant(null)),

  // Basic tab
  section_number: nullableString,
  section_code: nullableString,
  section_name: nullableString,
  customer_component_code: nullableString,
  component_description: nullableString,
  drawing_document_id: fc.oneof(fc.uuid(), fc.constant(null)),
  drawing_revision: nullableString,
  drawing_approval_status: drawingApprovalStatus,
  alloy_standard_id: fc.oneof(fc.uuid(), fc.constant(null)),
  alloy_id: fc.oneof(fc.uuid(), fc.constant(null)),
  temper_id: fc.oneof(fc.uuid(), fc.constant(null)),

  // Technical tab
  cl_uom: nullableString,
  cl_per_uom: nullableNumber,
  cl_meter: nullableNumber,
  order_uom: nullableString,
  order_quantity: nullableNumber,
  quantity_kg: nullableNumber,
  section_weight_kg_per_m: nullableNumber,
  min_weight: nullableNumber,
  max_weight: nullableNumber,
  weight_tolerance: nullableNumber,
  quantity_calculation_method: qtyMethod,
  packing_mode_id: fc.oneof(fc.uuid(), fc.constant(null)),
  invoice_calc_uom: nullableString,
  standard_length: nullableNumber,
  cut_length: nullableNumber,
  bundle_quantity: nullableNumber,
  pieces_per_m_per_kg_per_bundle: nullableNumber,
  packing_instruction: nullableString,
  customer_packing_requirement: nullableString,

  // Commercial tab
  material_price: nullableNumber,
  value_added_service_price: nullableNumber,
  other_charges: nullableNumber,
  basic_price: nullableNumber,
  packing_charge: nullableNumber,
  freight_charge: nullableNumber,
  alloy_surcharge_per_kg: nullableNumber,
  re_cutting_charge_per_kg: nullableNumber,
  testing_service_charge_per_kg: nullableNumber,
  die_cost: nullableNumber,
  die_service_charge: nullableNumber,
  packing_in_conversion: fc.boolean(),
  include_packing_in_basic: fc.boolean(),
  gst_percent: nullableNumber,
  discount: nullableNumber,
  margin: fc.oneof(
    fc.double({ min: -999999.99, max: 999999.99, noNaN: true, noDefaultInfinity: true }),
    fc.constant(null)
  ),
  net_rate: nullableNumber,
  final_line_value: nullableNumber,

  // Costing tab
  input_billet_weight: nullableNumber,
  output_good_weight: nullableNumber,
  rejected_weight: nullableNumber,
  rework_weight: nullableNumber,
  packing_weight: nullableNumber,
  freight_weight: nullableNumber,
  theoretical_weight: nullableNumber,
  actual_weight: nullableNumber,

  // Internal-only
  internal_cost: nullableNumber,
  supplier_rate: nullableNumber,
  internal_note: nullableString,

  // Audit
  revision_number: fc.integer({ min: 1, max: 1000 }),
});

/**
 * Arbitrary for generating SourceRef values.
 */
const sourceRefArb = fc.record({
  sourceRecordId: fc.uuid(),
  sourceLineId: fc.uuid(),
});

/**
 * Fields that are explicitly overridden during copy (not expected to match source).
 */
const OVERRIDDEN_FIELDS = new Set(["id", "source_record_id", "source_line_id", "revision_number"]);

describe("Property 12: Line reuse copies the full field set, preserves not-captured state, and is non-destructive", () => {
  /**
   * **Validates: Requirements 1.3**
   *
   * Every field (except id, source_record_id, source_line_id, revision_number)
   * in the copy equals the source value.
   */
  it("every non-overridden field in the copy equals the source value", () => {
    fc.assert(
      fc.property(technicalLineItemArb, sourceRefArb, (source, ref) => {
        const copy = copyLineForReuse(source, ref);

        for (const field of TECHNICAL_LINE_ITEM_FIELDS) {
          if (OVERRIDDEN_FIELDS.has(field)) continue;
          assert.strictEqual(
            copy[field],
            source[field],
            `Field '${field}' should be copied from source. Expected: ${source[field]}, Got: ${copy[field]}`
          );
        }
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 1.3, 1.5**
   *
   * Null values in source remain null in the copy (not-captured state preserved).
   */
  it("null values in source remain null in the copy (not-captured state preserved)", () => {
    fc.assert(
      fc.property(technicalLineItemArb, sourceRefArb, (source, ref) => {
        const copy = copyLineForReuse(source, ref);

        for (const field of TECHNICAL_LINE_ITEM_FIELDS) {
          if (OVERRIDDEN_FIELDS.has(field)) continue;
          if (source[field] === null) {
            assert.strictEqual(
              copy[field],
              null,
              `Field '${field}' is null in source but not null in copy: ${copy[field]}`
            );
          }
        }
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * source_record_id and source_line_id are stamped with the ref values.
   */
  it("source_record_id and source_line_id are stamped with the provided reference", () => {
    fc.assert(
      fc.property(technicalLineItemArb, sourceRefArb, (source, ref) => {
        const copy = copyLineForReuse(source, ref);

        assert.strictEqual(
          copy.source_record_id,
          ref.sourceRecordId,
          "source_record_id should equal the provided ref.sourceRecordId"
        );
        assert.strictEqual(
          copy.source_line_id,
          ref.sourceLineId,
          "source_line_id should equal the provided ref.sourceLineId"
        );
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 1.3**
   *
   * The copy gets a new unique id (different from source).
   */
  it("the copy gets a new unique id different from the source", () => {
    fc.assert(
      fc.property(technicalLineItemArb, sourceRefArb, (source, ref) => {
        const copy = copyLineForReuse(source, ref);

        assert.notStrictEqual(
          copy.id,
          source.id,
          "Copy id must differ from source id"
        );
        // Verify it's a valid UUID format (basic check: non-empty string)
        assert.ok(
          typeof copy.id === "string" && copy.id.length > 0,
          "Copy id must be a non-empty string"
        );
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 1.3**
   *
   * revision_number is reset to 1 for the downstream copy.
   */
  it("revision_number is reset to 1 in the copy", () => {
    fc.assert(
      fc.property(technicalLineItemArb, sourceRefArb, (source, ref) => {
        const copy = copyLineForReuse(source, ref);

        assert.strictEqual(
          copy.revision_number,
          1,
          `revision_number should be 1 in the copy, got: ${copy.revision_number}`
        );
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * Editing the copy does not affect the source (non-destructive).
   * Since all TechnicalLineItem fields are primitives (string | number | boolean | null),
   * field-by-field copy guarantees isolation.
   */
  it("editing the copy does not affect the source (non-destructive)", () => {
    fc.assert(
      fc.property(technicalLineItemArb, sourceRefArb, (source, ref) => {
        // Snapshot original source values
        const originalValues = {};
        for (const field of TECHNICAL_LINE_ITEM_FIELDS) {
          originalValues[field] = source[field];
        }

        const copy = copyLineForReuse(source, ref);

        // Mutate several fields on the copy
        copy.section_name = "MUTATED_NAME";
        copy.material_price = 99999.99;
        copy.quantity_kg = 12345.678;
        copy.internal_note = "MUTATED_NOTE";
        copy.packing_in_conversion = !copy.packing_in_conversion;
        copy.revision_number = 999;

        // Verify source is structurally unchanged
        for (const field of TECHNICAL_LINE_ITEM_FIELDS) {
          assert.strictEqual(
            source[field],
            originalValues[field],
            `Source field '${field}' was mutated after editing the copy. Original: ${originalValues[field]}, Current: ${source[field]}`
          );
        }
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.3**
   *
   * The copy has the complete canonical field set (all keys from TECHNICAL_LINE_ITEM_FIELDS exist).
   */
  it("the copy has the complete canonical field set", () => {
    fc.assert(
      fc.property(technicalLineItemArb, sourceRefArb, (source, ref) => {
        const copy = copyLineForReuse(source, ref);

        assert.ok(
          hasCompleteFieldSet(copy),
          "Copy should have all fields from TECHNICAL_LINE_ITEM_FIELDS"
        );

        // Double-check each field exists
        for (const field of TECHNICAL_LINE_ITEM_FIELDS) {
          assert.ok(
            field in copy,
            `Field '${field}' is missing from the copy`
          );
        }
      }),
      { numRuns: 1000 }
    );
  });
});
