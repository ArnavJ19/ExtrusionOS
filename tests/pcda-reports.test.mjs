import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sanitizeReportModelForCustomer } from "../lib/reports/pcda/customer-report.ts";
import { generateCSV, generateExcel, storeReport } from "../lib/reports/pcda/generator.ts";
import { checkFieldsPresent, checkPcdaLineReadiness, checkQuoteLineReadiness, checkReportReadiness } from "../lib/reports/pcda/readiness.ts";
import { sanitizeForCustomer } from "../lib/pcda/sanitize.ts";

const repoRoot = process.cwd();

const baseModel = {
  templateKey: "quote_line",
  header: {
    companyName: "Extrusion Co",
    companyGst: "27ABCDE1234F1Z5",
    moduleName: "Quotations",
    reportTitle: "Quote Line Report",
    recordNumber: "Q-2026-0001",
    references: "Customer PO",
    revisionNumber: "1",
    generatedDate: "06/06/2026",
    generatedBy: "Owner",
    approvalStatus: "Approved",
  },
  sections: [
    {
      title: "Commercial",
      fields: [
        { label: "Net Rate", value: "250" },
        { label: "Internal Cost", value: "200" },
        { label: "Supplier Rate", value: "190" },
        { label: "Total Cost", value: "195" },
        { label: "Cost per kg", value: "20" },
        { label: "Contribution Margin", value: "50" },
        { label: "Internal Note", value: "Do not show" },
      ],
    },
  ],
  metadata: {
    recordId: "record-1",
    companyId: "company-1",
    recordType: "quote",
    generatedAt: "2026-06-06T00:00:00.000Z",
  },
};

describe("PCDA report customer sanitization", () => {
  it("omits restricted fields from customer-facing report sections", () => {
    const sanitized = sanitizeReportModelForCustomer(baseModel);
    const labels = sanitized.sections.flatMap((section) => section.fields.map((field) => field.label));
    assert.deepEqual(labels, ["Net Rate"]);
  });

  it("removes internal cost, supplier rate, margin, profit, and internal notes from line items", () => {
    const sanitized = sanitizeForCustomer({
      id: "line-1",
      company_id: "company-1",
      internal_cost: 100,
      supplier_rate: 90,
      margin: 20,
      profit: 10,
      gross_margin: 30,
      internal_note: "secret",
      section_code: "SEC-1",
    });
    assert.equal("internal_cost" in sanitized, false);
    assert.equal("supplier_rate" in sanitized, false);
    assert.equal("margin" in sanitized, false);
    assert.equal("profit" in sanitized, false);
    assert.equal("gross_margin" in sanitized, false);
    assert.equal("internal_note" in sanitized, false);
    assert.equal(sanitized.section_code, "SEC-1");
  });
});

describe("PCDA report generators", () => {
  it("generates CSV and Excel-compatible bytes from report models", () => {
    const csv = generateCSV(baseModel);
    const xls = generateExcel(baseModel);
    assert.equal(csv.extension, "csv");
    assert.equal(xls.extension, "xls");
    assert.match(new TextDecoder().decode(csv.bytes), /Quote Line Report/);
    assert.match(new TextDecoder().decode(xls.bytes), /<table>/);
  });

  it("stores generated reports in the private reports bucket", async () => {
    let uploadedBucket = "";
    let uploadedPath = "";
    const supabase = {
      storage: {
        from(bucket) {
          uploadedBucket = bucket;
          return {
            async upload(path) {
              uploadedPath = path;
              return { error: null };
            },
          };
        },
      },
    };

    await storeReport(
      supabase,
      { bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf", extension: "pdf" },
      "company-1/reports/quote/line-1/report.pdf"
    );

    assert.equal(uploadedBucket, "reports");
    assert.equal(uploadedPath.startsWith("company-1/reports/"), true);
  });

  it("keeps the reports storage bucket and tenant policies in migrations", () => {
    const migration = readFileSync(join(repoRoot, "supabase/migrations/0059_reports_storage_bucket.sql"), "utf8");
    assert.match(migration, /insert into storage\.buckets[\s\S]*\('reports', 'reports', false\)/);
    assert.match(migration, /bucket_id in \('company-assets','profile-drawings','die-drawings','quote-pdfs','dispatch-documents','reports'\)/);
    assert.match(migration, /\(storage\.foldername\(name\)\)\[1\] = public\.get_current_user_company_id\(\)::text/);
  });
});

describe("PCDA report readiness", () => {
  it("gates quote line reports on section or profile, quantity, and rate", () => {
    const blocked = checkQuoteLineReadiness({});
    assert.equal(blocked.ready, false);
    assert.deepEqual(blocked.missingFields, ["Section code or linked profile", "Quantity", "Rate/Price"]);

    const ready = checkQuoteLineReadiness({ profile_id: "profile-1", order_quantity: 10, net_rate: 250 });
    assert.equal(ready.ready, true);
  });

  it("requires PCDA lines to remain linked to the correct parent record", () => {
    const quoteLine = checkPcdaLineReadiness(
      { profile_id: "profile-1", order_quantity: 10, net_rate: 250 },
      "quote"
    );
    assert.equal(quoteLine.ready, false);
    assert.deepEqual(quoteLine.missingFields, ["Linked quote"]);

    const orderLine = checkPcdaLineReadiness(
      { order_id: "order-1", profile_id: "profile-1", order_quantity: 10, net_rate: 250 },
      "order"
    );
    assert.equal(orderLine.ready, true);
  });

  it("checks the tenant-scoped parent before allowing quote or order generation", async () => {
    const supabase = fakeSupabase({
      quote_items: {
        quote_id: "quote-1",
        profile_id: "profile-1",
        order_quantity: 10,
        net_rate: 250,
      },
      quotes: { id: "quote-1" },
      order_items: {
        order_id: "order-1",
        profile_id: "profile-1",
        order_quantity: 10,
        net_rate: 250,
      },
      orders: { id: "order-1" },
    });

    assert.equal((await checkReportReadiness("quote_line", "line-1", "company-1", supabase)).ready, true);
    assert.equal((await checkReportReadiness("order_line", "line-2", "company-1", supabase)).ready, true);
  });

  it("treats absent, empty, and zero required fields as missing", () => {
    const result = checkFieldsPresent({ a: "", b: 0, c: "ok" }, [
      { field: "a", label: "A" },
      { field: "b", label: "B" },
      { field: "c", label: "C" },
    ]);
    assert.deepEqual(result.missingFields, ["A", "B"]);
  });

  it("gates all non-generic report templates against real source records", async () => {
    const supabase = fakeSupabase({
      die_trials: { die_id: "die-1", trial_date: "2026-06-06", trial_result: "pass" },
      quality_inspections: { profile_id: "profile-1", inspection_date: "2026-06-06", status: "approved" },
      packing_list_items: { dispatch_id: "dispatch-1", bundle_number: "B-1", profile_id: "profile-1" },
      export_orders: { export_customer_name: "ACME", destination_country: "UAE", incoterm: "FOB", status: "draft" },
      compliance_standards: { standard_code: "IS-733", standard_name: "Aluminium Bar", product_category: "extrusion" },
      order_cost_breakdown: { customer_name: "ACME", month_key: "2026-06", revenue: 1000 },
    });

    for (const templateKey of ["die_trial", "quality_inspection", "packing", "export", "compliance", "profitability"]) {
      const result = await checkReportReadiness(templateKey, "record-1", "company-1", supabase);
      assert.equal(result.ready, true, templateKey);
    }
  });
});

function fakeSupabase(records) {
  return {
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        single() {
          const data = records[table] ?? null;
          return { data, error: data ? null : { message: "missing" } };
        },
        maybeSingle() {
          return { data: records[table] ?? null, error: null };
        },
      };
    },
  };
}
