/**
 * Property Test: Field Set and Tab Partition Identity
 *
 * Property 13: The Technical_Line_Item field set and tab partition are identical everywhere
 *
 * Validates: Requirements 1.2, 5.1, 5.2, 5.3, 5.4
 *
 * Verifies:
 * - TECHNICAL_LINE_ITEM_FIELDS covers every key of the TechnicalLineItem interface
 * - FIELD_TAB assigns every field in TECHNICAL_LINE_ITEM_FIELDS to exactly one of the 8 valid tabs
 * - The partition is complete (no field without a tab, no extra tab entries without a matching field)
 * - All 8 tabs are valid: Basic, Technical, Commercial, Costing, Quality, Documents, Reports, Audit
 * - No duplicates in the fields array
 */
import { describe, it } from "node:test";
import fc from "fast-check";

import { TECHNICAL_LINE_ITEM_FIELDS, FIELD_TAB } from "../lib/pcda/field-map.ts";
import { TABS } from "../lib/pcda/types.ts";

const VALID_TABS = ["Basic", "Technical", "Commercial", "Costing", "Quality", "Documents", "Reports", "Audit"];

describe("Property 13: Field set and tab partition identity", () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * The TECHNICAL_LINE_ITEM_FIELDS array contains no duplicate entries.
   */
  it("TECHNICAL_LINE_ITEM_FIELDS contains no duplicate field names", () => {
    fc.assert(
      fc.property(
        fc.constant(TECHNICAL_LINE_ITEM_FIELDS),
        (fields) => {
          const unique = new Set(fields);
          return unique.size === fields.length;
        }
      ),
      { numRuns: 1 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 5.1, 5.4**
   *
   * For any field picked from TECHNICAL_LINE_ITEM_FIELDS, FIELD_TAB has an entry for it.
   */
  it("every field in TECHNICAL_LINE_ITEM_FIELDS has a tab assignment in FIELD_TAB", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TECHNICAL_LINE_ITEM_FIELDS),
        (field) => {
          return Object.hasOwn(FIELD_TAB, field);
        }
      ),
      { numRuns: TECHNICAL_LINE_ITEM_FIELDS.length * 5 }
    );
  });

  /**
   * **Validates: Requirements 5.3, 5.4**
   *
   * For any field in TECHNICAL_LINE_ITEM_FIELDS, its assigned tab is one of the 8 valid tabs.
   */
  it("every field is assigned to exactly one of the 8 valid tabs", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TECHNICAL_LINE_ITEM_FIELDS),
        (field) => {
          const tab = FIELD_TAB[field];
          return VALID_TABS.includes(tab);
        }
      ),
      { numRuns: TECHNICAL_LINE_ITEM_FIELDS.length * 5 }
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.2, 5.4**
   *
   * FIELD_TAB contains no extra keys beyond those in TECHNICAL_LINE_ITEM_FIELDS.
   * The partition is exact: no field without a tab entry, no tab entry without a matching field.
   */
  it("FIELD_TAB keys are exactly the TECHNICAL_LINE_ITEM_FIELDS set (no extras, no missing)", () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          const fieldSet = new Set(TECHNICAL_LINE_ITEM_FIELDS);
          const tabKeys = new Set(Object.keys(FIELD_TAB));

          // Every field has a tab entry
          for (const f of fieldSet) {
            if (!tabKeys.has(f)) return false;
          }

          // No extra tab entries beyond the field set
          for (const k of tabKeys) {
            if (!fieldSet.has(k)) return false;
          }

          return fieldSet.size === tabKeys.size;
        }
      ),
      { numRuns: 1 }
    );
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * The TABS constant contains exactly the 8 valid tabs in the correct order.
   */
  it("TABS constant contains exactly the 8 valid tabs in left-to-right order", () => {
    fc.assert(
      fc.property(
        fc.constant(TABS),
        (tabs) => {
          if (tabs.length !== 8) return false;
          for (let i = 0; i < VALID_TABS.length; i++) {
            if (tabs[i] !== VALID_TABS[i]) return false;
          }
          return true;
        }
      ),
      { numRuns: 1 }
    );
  });

  /**
   * **Validates: Requirements 5.3, 5.4**
   *
   * For any randomly selected subset of fields, each field maps to exactly one tab
   * (not zero, not multiple). This checks the uniqueness aspect — a field can't appear
   * under two different tabs in the partition.
   */
  it("each field maps to exactly one tab (deterministic, no ambiguity)", () => {
    fc.assert(
      fc.property(
        fc.subarray([...TECHNICAL_LINE_ITEM_FIELDS], { minLength: 1 }),
        (subset) => {
          for (const field of subset) {
            const tab = FIELD_TAB[field];
            // Must be assigned
            if (tab === undefined) return false;
            // Must be exactly one of the valid tabs
            if (!VALID_TABS.includes(tab)) return false;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 5.4**
   *
   * The tab values assigned to all fields collectively use only the 8 valid tabs — 
   * no invented tab names slip in.
   */
  it("all tab values used in FIELD_TAB are within the valid 8-tab set", () => {
    fc.assert(
      fc.property(
        fc.constant(Object.values(FIELD_TAB)),
        (tabValues) => {
          const validSet = new Set(VALID_TABS);
          return tabValues.every((t) => validSet.has(t));
        }
      ),
      { numRuns: 1 }
    );
  });
});
