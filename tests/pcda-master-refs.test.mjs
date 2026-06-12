/**
 * Property Test: Master references and active-duplicate rules are enforced
 *
 * Property 16: For any line and master set, save validation passes iff every
 * referenced Alloy, Temper, and Alloy_Standard exists as an active company-scoped
 * master record; and for any catalog, inserting a value equal (after case/whitespace
 * normalization) to an existing active value in the same company and table is rejected
 * as a duplicate.
 *
 * **Validates: Requirements 6.7, 6.9, 20.6**
 */
import { describe, it } from "node:test";
import fc from "fast-check";

import {
  isDuplicateValue,
  validateReferences,
  normalizeValue,
} from "../lib/master-data/service.ts";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Two fixed company IDs for cross-company testing */
const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const arbCompanyId = fc.constantFrom(COMPANY_A, COMPANY_B);

/** Generate a UUID-like string for record IDs */
const arbId = fc.uuid();

/** Generate a non-empty value string (printable, trimmed) */
const arbValue = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

/** Generate a single MasterRecord */
const arbMasterRecord = fc.record({
  id: arbId,
  company_id: arbCompanyId,
  value: arbValue,
  description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  is_active: fc.boolean(),
  created_at: fc.constant("2024-01-01T00:00:00Z"),
});

/** Generate an array of MasterRecords */
const arbMasterRecords = fc.array(arbMasterRecord, {
  minLength: 0,
  maxLength: 100,
});

/** Generate a field name */
const arbFieldName = fc.constantFrom(
  "alloy_id",
  "temper_id",
  "alloy_standard_id",
  "packing_mode_id"
);

// ---------------------------------------------------------------------------
// Property Tests — validateReferences
// ---------------------------------------------------------------------------

describe("Property 16: Master references and active-duplicate rules are enforced", () => {
  /**
   * **Validates: Requirements 6.7, 20.6**
   *
   * validateReferences returns empty array when all referenced IDs exist
   * as active, company-scoped records.
   */
  it("validateReferences returns empty array when all referenced IDs exist as active, company-scoped records", () => {
    fc.assert(
      fc.property(
        arbMasterRecords.filter(
          (recs) => recs.some((r) => r.is_active && r.company_id === COMPANY_A)
        ),
        arbFieldName,
        (records, fieldName) => {
          // Pick an active record for COMPANY_A to reference
          const activeRecs = records.filter(
            (r) => r.is_active && r.company_id === COMPANY_A
          );
          if (activeRecs.length === 0) return true; // precondition guard

          const targetRecord = activeRecs[0];
          const refs = [{ id: targetRecord.id, fieldName, records }];
          const result = validateReferences(refs, COMPANY_A);
          return result.length === 0;
        }
      ),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 6.7, 20.6**
   *
   * validateReferences returns the field name when a referenced ID does NOT
   * exist in the records.
   */
  it("validateReferences returns the field name when a referenced ID does NOT exist in the records", () => {
    fc.assert(
      fc.property(arbMasterRecords, arbFieldName, arbId, (records, fieldName, fakeId) => {
        // Ensure fakeId doesn't match any record
        const ids = new Set(records.map((r) => r.id));
        if (ids.has(fakeId)) return true; // skip if collision

        const refs = [{ id: fakeId, fieldName, records }];
        const result = validateReferences(refs, COMPANY_A);
        return result.length === 1 && result[0] === fieldName;
      }),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 6.7, 20.6**
   *
   * validateReferences returns the field name when the referenced record exists
   * but is inactive.
   */
  it("validateReferences returns the field name when the referenced record exists but is inactive", () => {
    fc.assert(
      fc.property(arbId, arbValue, arbFieldName, (id, value, fieldName) => {
        // Create a record that matches the ID but is inactive
        const inactiveRecord = {
          id,
          company_id: COMPANY_A,
          value,
          description: null,
          is_active: false,
          created_at: "2024-01-01T00:00:00Z",
        };
        const records = [inactiveRecord];
        const refs = [{ id, fieldName, records }];
        const result = validateReferences(refs, COMPANY_A);
        return result.length === 1 && result[0] === fieldName;
      }),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 6.7, 20.6**
   *
   * validateReferences returns the field name when the referenced record exists
   * but belongs to a different company.
   */
  it("validateReferences returns the field name when the referenced record exists but belongs to a different company", () => {
    fc.assert(
      fc.property(arbId, arbValue, arbFieldName, (id, value, fieldName) => {
        // Create a record that is active but belongs to COMPANY_B
        const wrongCompanyRecord = {
          id,
          company_id: COMPANY_B,
          value,
          description: null,
          is_active: true,
          created_at: "2024-01-01T00:00:00Z",
        };
        const records = [wrongCompanyRecord];
        const refs = [{ id, fieldName, records }];
        // Validate against COMPANY_A — record belongs to COMPANY_B
        const result = validateReferences(refs, COMPANY_A);
        return result.length === 1 && result[0] === fieldName;
      }),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 6.7**
   *
   * validateReferences skips null IDs (null means "not referenced").
   */
  it("validateReferences skips null IDs (null means not referenced)", () => {
    fc.assert(
      fc.property(arbMasterRecords, arbFieldName, (records, fieldName) => {
        const refs = [{ id: null, fieldName, records }];
        const result = validateReferences(refs, COMPANY_A);
        return result.length === 0;
      }),
      { numRuns: 5000 }
    );
  });

  // -------------------------------------------------------------------------
  // Property Tests — isDuplicateValue
  // -------------------------------------------------------------------------

  /**
   * **Validates: Requirements 6.9**
   *
   * isDuplicateValue returns true when an active record with the same
   * normalized value exists for the company.
   */
  it("isDuplicateValue returns true when an active record with the same normalized value exists for the company", () => {
    fc.assert(
      fc.property(arbValue, (value) => {
        const existingRecord = {
          id: "11111111-1111-1111-1111-111111111111",
          company_id: COMPANY_A,
          value: value,
          description: null,
          is_active: true,
          created_at: "2024-01-01T00:00:00Z",
        };
        const records = [existingRecord];
        // Same value should be flagged as duplicate
        return isDuplicateValue(records, value, COMPANY_A) === true;
      }),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 6.9**
   *
   * isDuplicateValue returns false when no matching active record exists.
   */
  it("isDuplicateValue returns false when no matching active record exists", () => {
    fc.assert(
      fc.property(arbValue, arbValue, (existingValue, newValue) => {
        // Skip when values normalize to the same thing
        if (normalizeValue(existingValue) === normalizeValue(newValue)) return true;

        const existingRecord = {
          id: "11111111-1111-1111-1111-111111111111",
          company_id: COMPANY_A,
          value: existingValue,
          description: null,
          is_active: true,
          created_at: "2024-01-01T00:00:00Z",
        };
        const records = [existingRecord];
        return isDuplicateValue(records, newValue, COMPANY_A) === false;
      }),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 6.9**
   *
   * isDuplicateValue treats differently-cased and whitespace-variant values
   * as duplicates.
   */
  it("isDuplicateValue treats differently-cased and whitespace-variant values as duplicates", () => {
    fc.assert(
      fc.property(arbValue, (baseValue) => {
        const normalized = normalizeValue(baseValue);
        // Skip if normalization produces empty string
        if (normalized.length === 0) return true;

        const existingRecord = {
          id: "11111111-1111-1111-1111-111111111111",
          company_id: COMPANY_A,
          value: baseValue,
          description: null,
          is_active: true,
          created_at: "2024-01-01T00:00:00Z",
        };
        const records = [existingRecord];

        // Test with uppercase variant
        const upperVariant = baseValue.toUpperCase();
        const upperIsDuplicate = isDuplicateValue(records, upperVariant, COMPANY_A);

        // Test with extra whitespace variant
        const spacedVariant = "  " + baseValue + "  ";
        const spacedIsDuplicate = isDuplicateValue(records, spacedVariant, COMPANY_A);

        // Both should be detected as duplicates
        return upperIsDuplicate === true && spacedIsDuplicate === true;
      }),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 6.9**
   *
   * isDuplicateValue does NOT flag inactive records as duplicates.
   */
  it("isDuplicateValue does NOT flag inactive records as duplicates", () => {
    fc.assert(
      fc.property(arbValue, (value) => {
        const inactiveRecord = {
          id: "11111111-1111-1111-1111-111111111111",
          company_id: COMPANY_A,
          value: value,
          description: null,
          is_active: false,
          created_at: "2024-01-01T00:00:00Z",
        };
        const records = [inactiveRecord];
        // Inactive record with same value should NOT trigger duplicate
        return isDuplicateValue(records, value, COMPANY_A) === false;
      }),
      { numRuns: 5000 }
    );
  });
});
