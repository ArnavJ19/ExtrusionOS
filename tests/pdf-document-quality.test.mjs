import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { PdfDocumentWriter } from "../lib/pdf/document-kit.ts";
import { PdfTextKit } from "../lib/pdf/unicode-text.ts";
import { nodeFontLoader } from "../lib/pdf/font-loader-node.ts";
import { joinParts, pdfLabel } from "../lib/pdf/format.ts";
import { buildDieTechnicalSheetPdf } from "../lib/reports/pcda/die-technical-sheet.ts";
import { buildReportBuilderPdf } from "../lib/reports/report-builder-pdf.ts";
import { computeReportTotals } from "../lib/reports/report-builder.ts";
import { generateCSV, generateExcel } from "../lib/reports/pcda/generator.ts";
import { logoSource, validLogoBytes } from "../lib/pdf/logo.ts";
import { loadCompanyLogo } from "../lib/pdf/logo-loader-node.ts";
import { buildQuotePdf } from "../lib/pdf/quote-pdf.ts";
import { PDFName, PDFRawStream } from "pdf-lib";

test("company logos come only from app brand images or this project's public storage", () => {
  const supabase = "https://pkawmdxtmsdgigsehcmb.supabase.co";
  assert.deepEqual(logoSource("/brand/omalco-logo.png", supabase), { kind: "app", path: "/brand/omalco-logo.png" });
  assert.equal(logoSource(`${supabase}/storage/v1/object/public/branding/logo.png`, supabase)?.kind, "storage");
  for (const blocked of ["/brand/../.env.png", "/fonts/pdf/x.png", "/brand/logo.svg", "http://pkawmdxtmsdgigsehcmb.supabase.co/storage/v1/object/public/a.png",
    "https://evil.example.com/storage/v1/object/public/a.png", `${supabase}/rest/v1/companies`, "https://169.254.169.254/latest/meta-data", "", null]) {
    assert.equal(logoSource(blocked, supabase), null, String(blocked));
  }
  assert.equal(validLogoBytes(new TextEncoder().encode("<svg></svg>")), null, "only PNG or JPEG bytes are accepted");
});

test("documents carry the company logo, and a missing logo never blocks a document", async () => {
  const logo = await loadCompanyLogo("/brand/omalco-logo.png");
  assert.ok(logo && logo.length > 1000, "app logo is readable from public/brand");
  assert.equal(await loadCompanyLogo("/brand/does-not-exist.png"), null);
  const base = { company: { name: "Omalco Extrusions Pvt. Ltd.", legal_name: "Someone Else" }, settings: {}, quote: { quote_number: "Q-1", quote_date: "2026-10-01", valid_until: "2026-10-31", status: "draft", subtotal: 100, gst_percent: 18, gst_amount: 18, grand_total: 118, customers: { company_name: "Buyer", customer_name: "Buyer" } },
    items: [{ quantity_pieces: 1, length_per_piece_m: 6, total_meters: 6, total_weight_kg: 1, billing_weight_kg: 1, price_per_kg: 100, line_total_before_gst: 100, item_description: "SW-1 - Sliding frame", aluminium_profiles: { profile_code: "SW-1" } }] };
  const images = (pdf) => pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype"))?.toString() === "/Image").length;
  const { pdf, drawn } = await drawnText(() => buildQuotePdf({ ...base, logo }));
  assert.ok(images(pdf) >= 1, "logo image is embedded");
  assert.ok(drawn.includes("Omalco Extrusions Pvt. Ltd."), "the trading name is the heading");
  assert.ok(!drawn.some((line) => line.includes("Someone Else")), "a quotation does not print the legal name");
  assert.ok(drawn.includes("Sliding frame") && !drawn.includes("SW-1 - Sliding frame"), "the profile code is not repeated in the description");
  assert.ok(drawn.includes("DRAFT"), "draft quotations are stamped");
  const plain = await drawnText(() => buildQuotePdf({ ...base, logo: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]) }));
  assert.equal(images(plain.pdf), 0, "an unreadable logo is left out instead of failing the PDF");
});

test("PCDA Excel export styles sections and keeps long reference numbers as text", () => {
  const model = {
    templateKey: "dispatch_report", metadata: {},
    header: { companyName: "Shree Ganesh", companyGst: "24AAKCS1234F1Z9", moduleName: "Dispatch", reportTitle: "Dispatch Report", recordNumber: "DSP-1", references: "", revisionNumber: "1", generatedDate: "20/10/2026", generatedBy: "QA", approvalStatus: "Approved" },
    sections: [{ title: "Transporter & Vehicle", fields: [{ label: "E-way bill", value: "341022367781" }, { label: "PIN", value: "0382445" }, { label: "Bundles", value: 14 }, { label: "Proof of delivery", value: false }] }]
  };
  const xls = new TextDecoder().decode(generateExcel(model).bytes);
  assert.match(xls, /<td colspan="2" class="section">Transporter &amp; Vehicle<\/td>/);
  assert.match(xls, /<th>Field<\/th><th>Value<\/th>/);
  assert.match(xls, /<td class="text">341022367781<\/td>/, "e-way bill is not turned into 3.41E+11");
  assert.match(xls, /<td class="text">0382445<\/td>/, "leading zero is kept");
  assert.match(xls, /<td>Bundles<\/td><td>14<\/td>/, "ordinary figures stay numeric");
  assert.match(xls, /<td>Proof of delivery<\/td><td>No<\/td>/);
  const csvBytes = generateCSV(model).bytes;
  assert.match(new TextDecoder().decode(csvBytes), /Proof of delivery,No/);
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "CSV starts with a UTF-8 byte-order mark for Excel");
});

// Records every string the document engine draws, so layout regressions (cut-off footers,
// words split mid-word, wrong totals labels) are caught without a PDF text extractor.
async function drawnText(build) {
  const original = PdfDocumentWriter.prototype.text;
  const drawn = [];
  PdfDocumentWriter.prototype.text = function (text, ...rest) {
    drawn.push(String(text));
    return original.call(this, text, ...rest);
  };
  try {
    const bytes = await build();
    return { drawn, pdf: await PDFDocument.load(bytes) };
  } finally {
    PdfDocumentWriter.prototype.text = original;
  }
}

test("engineering symbols render from embedded fonts instead of '?'", async () => {
  const sample = "Wall 1.80 ± 0.10 mm · coating ≥ 60 µm · area 2.5 m² · ⌀ 50.8 mm · ½ bar · 6 × 2 mm · 520 °C · μ ✓ → ≤";
  const kit = await PdfTextKit.create(await PDFDocument.create(), nodeFontLoader, [sample]);
  assert.equal(kit.runs(sample).map((run) => run.text).join(""), sample);
  assert.equal(kit.missing.size, 0, `missing: ${[...kit.missing].join(" ")}`);
});

test("labels keep abbreviations in capitals and joining words in lower case", () => {
  assert.equal(pdfLabel("neft"), "NEFT");
  assert.equal(pdfLabel("rtgs"), "RTGS");
  assert.equal(pdfLabel("ifsc"), "IFSC");
  assert.equal(pdfLabel("out_of_tolerance"), "Out of Tolerance");
  assert.equal(pdfLabel("dgu_toughened"), "DGU Toughened");
  assert.equal(pdfLabel("of_grade_a"), "Of Grade A");
  assert.equal(pdfLabel("partially_paid"), "Partially Paid");
});

test("addresses do not repeat a city, state or PIN already in the street line", () => {
  assert.equal(joinParts(["Plot 214, Vatva, Ahmedabad 382445", "Ahmedabad", "Gujarat", "382445"]), "Plot 214, Vatva, Ahmedabad 382445, Gujarat");
  assert.equal(joinParts(["12 MG Road", "Pune", "Maharashtra", "411001"]), "12 MG Road, Pune, Maharashtra, 411001");
  assert.equal(joinParts(["Gandhinagar Road, Sector 5", "Gandhinagar", "Gujarat"]), "Gandhinagar Road, Sector 5, Gandhinagar, Gujarat");
});

test("footer note and timestamp are printed in full, never cut off", async () => {
  const { drawn, pdf } = await drawnText(() => buildDieTechnicalSheetPdf({
    company: { name: "Shree Ganesh Aluminium Extrusions Private Limited" }, die: { die_number: "DIE-SGE-1089-A" }, profile: null, customer: null,
    trials: [{ trial_date: "2026-08-02", trial_result: "rejected", output_quality: "poor", dimensional_status: "out_of_tolerance", surface_status: "die_lines", correction_required: true, remarks: "Sent for correction" }],
    corrections: [{ correction_date: "2026-08-06", correction_reason: "bearing_adjustment", correction_vendor: "Castool Tooling", cost: 12500, result_status: "successful", notes: "OK" }],
    nitridings: [], generatedBy: "QA"
  }));
  const footerLines = drawn.filter((line) => /Technical record generated|^Generated \d/.test(line));
  assert.equal(footerLines.filter((line) => /^Generated \d{2} \w{3} \d{4}, \d{2}:\d{2} IST$/.test(line)).length, pdf.getPageCount(), "timestamp line on every page");
  assert.ok(footerLines.some((line) => line.endsWith("were not recorded.")), "note is complete");
  // Column headers and short words shrink to fit instead of splitting ("Correctio" / "n").
  assert.ok(drawn.includes("Correction"));
  assert.ok(drawn.includes("Successful"));
  assert.ok(drawn.includes("02 Aug 2026"), "dates never wrap");
  assert.ok(drawn.some((line) => line.startsWith("Out of")) && !drawn.some((line) => line.includes("Out Of")));
});

test("Report Builder statements keep subtotals for linked groups and count rows per currency", async () => {
  const prettyValue = (value) => (value === null || value === undefined || value === "" ? "-" : typeof value === "number" ? value.toLocaleString("en-IN") : String(value));
  const prettyFieldLabel = (field) => field.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  const customerA = "11111111-aaaa-4bbb-8ccc-000000000001";
  const raw = [
    { customer_id: customerA, invoice_number: "INV-1", invoice_date: "2026-09-30", status: "partially_paid", grand_total: 1000, amount_paid: 400, credited_amount: 0, balance_due: 600, customer_credit_due: 0 },
    { customer_id: customerA, invoice_number: "INV-2", invoice_date: "2026-10-01", status: "paid", grand_total: 500, amount_paid: 500, credited_amount: 0, balance_due: 0, customer_credit_due: 0 }
  ];
  // The client resolves linked IDs to names before export and totals must use the same rows.
  const rows = raw.map((row) => ({ ...row, customer_id: `Patel Windows (ID: ${customerA})` }));
  const fields = ["invoice_number", "invoice_date", "status", "grand_total", "amount_paid", "balance_due"];
  const { drawn } = await drawnText(() => buildReportBuilderPdf({
    reportName: "Receivables", companyName: "Shree Ganesh", source: "invoices", visibility: "company", grouping: "customer_id",
    dateRange: { from: "2026-09-01", to: "2026-10-31" }, filters: [], rules: [], fields, rows,
    totals: computeReportTotals("invoices", rows, "customer_id", prettyValue), prettyFieldLabel, prettyValue, loadFont: nodeFontLoader
  }));
  assert.ok(drawn.includes("Customer Id: Patel Windows"), "group heading prints the name without the UUID");
  assert.ok(drawn.includes("Subtotal (2 rows)"), "group subtotal is printed");
  assert.ok(drawn.includes("Grand total (2 rows)"));
  assert.ok(drawn.includes("Patel Windows"), "statement totals label the group by name");
  assert.ok(!drawn.some((line) => line.includes(customerA)), "no UUID is printed");
  assert.ok(drawn.includes("Partially Paid"), "workflow enums print as labels");
  assert.ok(drawn.includes("30 Sep 2026") && drawn.includes("01 Sep 2026 to 31 Oct 2026"), "dates print as stored");

  const expenses = [
    { expense_number: "E-1", expense_category: "raw_material", currency: "INR", total_amount: 100, amount_paid: 0, refunded_amount: 0, credited_amount: 0, balance_amount: 100, supplier_credit_due: 0 },
    { expense_number: "E-2", expense_category: "raw_material", currency: "INR", total_amount: 200, amount_paid: 0, refunded_amount: 0, credited_amount: 0, balance_amount: 200, supplier_credit_due: 0 },
    { expense_number: "E-3", expense_category: "spares", currency: "USD", total_amount: 50, amount_paid: 0, refunded_amount: 0, credited_amount: 0, balance_amount: 50, supplier_credit_due: 0 }
  ];
  const totals = computeReportTotals("expenses", expenses, "expense_category", prettyValue);
  assert.deepEqual(totals.grand.countByCurrency, { INR: 2, USD: 1 });
  const multi = await drawnText(() => buildReportBuilderPdf({
    reportName: "Payables", companyName: "Shree Ganesh", source: "expenses", visibility: "company", grouping: "expense_category", dateRange: null,
    filters: [], rules: [], fields: ["expense_number", "currency", "total_amount", "balance_amount"], rows: expenses, totals, prettyFieldLabel, prettyValue, loadFont: nodeFontLoader
  }));
  assert.ok(multi.drawn.includes("Grand total (2 rows) · INR"));
  assert.ok(multi.drawn.includes("Grand total (1 row) · USD"));
  assert.ok(multi.drawn.includes("Expense Category: Raw Material"));
});
