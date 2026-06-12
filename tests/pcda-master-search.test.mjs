/**
 * Property Test: Master search and selection lists return only active, company-scoped, matching records
 *
 * Property 15: For any catalog data and any non-empty query, the master search returns only records
 * that are active, scoped to the user's company, and whose value contains the query text
 * (case-insensitive), with at most 50 results; inactive records are excluded from selection lists,
 * and a query with no match yields an empty result.
 *
 * **Validates: Requirements 6.4, 6.6, 6.8**
 */
import { describe, it } from "node:test";
import fc from "fast-check";

import { filterMasterRecords } from "../lib/master-data/service.ts";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate a random UUID-like string for IDs */
const arbId = fc.uuid();

/** Generate a company ID — we use two fixed IDs so we can test cross-company filtering */
const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const arbCompanyId = fc.constantFrom(COMPANY_A, COMPANY_B);

/** Generate a non-empty value string (printable characters) */
const arbValue = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

/** Generate a single MasterRecord with varying fields */
const arbMasterRecord = fc.record({
  id: arbId,
  company_id: arbCompanyId,
  value: arbValue,
  description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  is_active: fc.boolean(),
  created_at: fc.constant("2024-01-01T00:00:00Z"),
});

/** Generate an array of MasterRecords (varying sizes, including large arrays) */
const arbMasterRecords = fc.array(arbMasterRecord, { minLength: 0, maxLength: 200 });

/** Generate a non-empty query string (at least 1 char, printable) */
const arbQuery = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 15: Master search and selection lists return only active, company-scoped, matching records", () => {
  /**
   * **Validates: Requirements 6.4, 6.6**
   *
   * All returned records must have is_active === true.
   * Inactive records are excluded from selection lists.
   */
  it("all returned records have is_active === true", () => {
    fc.assert(
      fc.property(arbMasterRecords, arbQuery, (records, query) => {
        const results = filterMasterRecords(records, query, COMPANY_A);
        return results.every((r) => r.is_active === true);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 6.6**
   *
   * All returned records must be scoped to the requesting company.
   */
  it("all returned records have company_id === companyId", () => {
    fc.assert(
      fc.property(arbMasterRecords, arbQuery, arbCompanyId, (records, query, companyId) => {
        const results = filterMasterRecords(records, query, companyId);
        return results.every((r) => r.company_id === companyId);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 6.6**
   *
   * All returned records must have a value containing the query text (case-insensitive).
   */
  it("all returned records have value containing the query text (case-insensitive)", () => {
    fc.assert(
      fc.property(arbMasterRecords, arbQuery, (records, query) => {
        const results = filterMasterRecords(records, query, COMPANY_A);
        const lowerQuery = query.toLowerCase();
        return results.every((r) => r.value.toLowerCase().includes(lowerQuery));
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 6.8**
   *
   * At most 50 results are returned regardless of input size.
   */
  it("at most 50 results are returned regardless of input size", () => {
    fc.assert(
      fc.property(
        fc.array(arbMasterRecord, { minLength: 0, maxLength: 500 }),
        arbQuery,
        (records, query) => {
          const results = filterMasterRecords(records, query, COMPANY_A);
          return results.length <= 50;
        }
      ),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * Inactive records are never included in results, even when they match query and company.
   */
  it("inactive records are never included in results", () => {
    fc.assert(
      fc.property(arbMasterRecords, arbQuery, (records, query) => {
        const results = filterMasterRecords(records, query, COMPANY_A);
        const inactiveIds = new Set(
          records.filter((r) => !r.is_active).map((r) => r.id)
        );
        return results.every((r) => !inactiveIds.has(r.id));
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 6.6**
   *
   * Records from other companies are never included in results.
   */
  it("records from other companies are never included", () => {
    fc.assert(
      fc.property(arbMasterRecords, arbQuery, (records, query) => {
        const results = filterMasterRecords(records, query, COMPANY_A);
        return results.every((r) => r.company_id === COMPANY_A);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 6.8**
   *
   * A query with no match yields an empty result.
   * We construct a query guaranteed not to appear in any record value.
   */
  it("a query with no match yields an empty result", () => {
    fc.assert(
      fc.property(arbMasterRecords, (records) => {
        // Construct a query that cannot match any value by using a string
        // that is longer than any possible value + unique chars
        const impossibleQuery = "\x00\x01IMPOSSIBLE_MATCH_" + Date.now();
        const results = filterMasterRecords(records, impossibleQuery, COMPANY_A);
        return results.length === 0;
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 6.4, 6.6, 6.8**
   *
   * Completeness: all records that ARE active, company-scoped, and match the query
   * are included in the result (up to the 50-record cap).
   */
  it("all qualifying records are included (up to 50 cap)", () => {
    fc.assert(
      fc.property(arbMasterRecords, arbQuery, arbCompanyId, (records, query, companyId) => {
        const results = filterMasterRecords(records, query, companyId);
        const lowerQuery = query.toLowerCase();
        const expected = records.filter(
          (r) =>
            r.is_active === true &&
            r.company_id === companyId &&
            r.value.toLowerCase().includes(lowerQuery)
        );
        // All qualifying records should be returned, up to the 50 cap
        if (expected.length <= 50) {
          return results.length === expected.length;
        } else {
          return results.length === 50;
        }
      }),
      { numRuns: 10000 }
    );
  });
});
