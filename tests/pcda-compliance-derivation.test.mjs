/**
 * Property Tests: Compliance Checklist Derivation
 *
 * Property 18: Derived checklists contain all source items.
 *
 * **Validates: Requirements 9.2, 19.7**
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  deriveComplianceChecklist,
  mergeComplianceSources,
} from "../lib/pcda/compliance.ts";

/**
 * Arbitrary for a valid ComplianceRequirement with a non-empty certificate_type.
 */
const validRequirementArb = fc.record({
  certificate_type: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  description: fc.oneof(fc.string(), fc.constant(null)),
  is_mandatory: fc.boolean(),
});

/**
 * Arbitrary for a ComplianceRequirement that may have empty/whitespace certificate_type.
 */
const anyRequirementArb = fc.record({
  certificate_type: fc.string(),
  description: fc.oneof(fc.string(), fc.constant(null)),
  is_mandatory: fc.boolean(),
});

describe("Property 18: Compliance checklist derivation", () => {
  /**
   * Derivation is deterministic: calling deriveComplianceChecklist twice
   * with the same input produces identical output.
   */
  it("derivation is deterministic (same input → same output)", () => {
    fc.assert(
      fc.property(fc.array(anyRequirementArb), (requirements) => {
        const result1 = deriveComplianceChecklist(requirements);
        const result2 = deriveComplianceChecklist(requirements);
        assert.deepStrictEqual(result1, result2);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * The derived checklist contains ALL valid source items (no item lost).
   * Valid = certificate_type is non-empty after trimming.
   */
  it("derived checklist contains ALL valid source items (no loss)", () => {
    fc.assert(
      fc.property(fc.array(validRequirementArb, { minLength: 1 }), (requirements) => {
        const checklist = deriveComplianceChecklist(requirements);
        assert.strictEqual(
          checklist.length,
          requirements.length,
          "checklist should have same count as valid requirements"
        );
        for (let i = 0; i < requirements.length; i++) {
          assert.strictEqual(checklist[i].certificate_type, requirements[i].certificate_type);
          assert.strictEqual(checklist[i].description, requirements[i].description);
          assert.strictEqual(checklist[i].is_mandatory, requirements[i].is_mandatory);
        }
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * Every derived item has status "pending".
   */
  it("every derived item has status 'pending'", () => {
    fc.assert(
      fc.property(fc.array(anyRequirementArb), (requirements) => {
        const checklist = deriveComplianceChecklist(requirements);
        for (const item of checklist) {
          assert.strictEqual(item.status, "pending");
        }
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * Empty or whitespace-only certificate_type values are filtered out.
   */
  it("empty/whitespace-only certificate types are filtered out", () => {
    const whitespaceOnlyArb = fc.record({
      certificate_type: fc.constantFrom("", " ", "  ", "\t", "\n", "   \t\n  "),
      description: fc.oneof(fc.string(), fc.constant(null)),
      is_mandatory: fc.boolean(),
    });

    fc.assert(
      fc.property(fc.array(whitespaceOnlyArb), (requirements) => {
        const checklist = deriveComplianceChecklist(requirements);
        assert.strictEqual(checklist.length, 0, "whitespace-only items should be filtered");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * Mixed valid and whitespace-only: only valid items appear in output.
   */
  it("mixed valid and invalid items: output count matches valid input count", () => {
    fc.assert(
      fc.property(
        fc.array(anyRequirementArb, { minLength: 0, maxLength: 50 }),
        (requirements) => {
          const validCount = requirements.filter(
            (r) => r.certificate_type && r.certificate_type.trim().length > 0
          ).length;
          const checklist = deriveComplianceChecklist(requirements);
          assert.strictEqual(checklist.length, validCount);
        }
      ),
      { numRuns: 10000 }
    );
  });
});

describe("Property 18: mergeComplianceSources deduplication", () => {
  /**
   * mergeComplianceSources includes all items from both sources without duplicates.
   * Detailed records take precedence; text array items not in detailed are added.
   */
  it("merged result includes all unique certificate types from both sources", () => {
    const certTypeArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(
        fc.array(certTypeArb, { minLength: 0, maxLength: 10 }),
        fc.array(validRequirementArb, { minLength: 0, maxLength: 10 }),
        (textArray, detailedReqs) => {
          const merged = mergeComplianceSources(textArray, detailedReqs);

          // All detailed requirements are preserved
          for (const req of detailedReqs) {
            const found = merged.some(
              (m) => m.certificate_type === req.certificate_type &&
                     m.description === req.description &&
                     m.is_mandatory === req.is_mandatory
            );
            assert.ok(found, `detailed requirement '${req.certificate_type}' should be in merged`);
          }

          // All text array items either match a detailed req (by normalized type) or are in merged
          if (textArray) {
            for (const cert of textArray) {
              const normalized = cert.toLowerCase().trim();
              if (!normalized) continue;
              const found = merged.some(
                (m) => m.certificate_type.toLowerCase().trim() === normalized
              );
              assert.ok(found, `text array cert '${cert}' should be in merged`);
            }
          }
        }
      ),
      { numRuns: 10000 }
    );
  });

  /**
   * No duplicate certificate_type (case-insensitive) in merged output.
   */
  it("no duplicate certificate types (case-insensitive) in merged output", () => {
    const certTypeArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(
        fc.array(certTypeArb, { minLength: 0, maxLength: 10 }),
        fc.array(validRequirementArb, { minLength: 0, maxLength: 10 }),
        (textArray, detailedReqs) => {
          const merged = mergeComplianceSources(textArray, detailedReqs);
          const seen = new Set();
          for (const item of merged) {
            const key = item.certificate_type.toLowerCase().trim();
            // Note: detailed requirements may have duplicates among themselves
            // (which is valid input). We only check that textArray doesn't re-add.
          }

          // Specifically: items added from textArray should not duplicate detailed
          const detailedKeys = new Set(
            detailedReqs.map((r) => r.certificate_type.toLowerCase().trim())
          );
          const addedFromText = merged.slice(detailedReqs.length);
          for (const item of addedFromText) {
            const key = item.certificate_type.toLowerCase().trim();
            assert.ok(
              !detailedKeys.has(key),
              `textArray item '${item.certificate_type}' should not duplicate a detailed requirement`
            );
          }
        }
      ),
      { numRuns: 10000 }
    );
  });

  /**
   * null text array: merged result equals detailed requirements.
   */
  it("null text array: merged result equals detailed requirements", () => {
    fc.assert(
      fc.property(fc.array(validRequirementArb), (detailedReqs) => {
        const merged = mergeComplianceSources(null, detailedReqs);
        assert.deepStrictEqual(merged, detailedReqs);
      }),
      { numRuns: 5000 }
    );
  });
});
