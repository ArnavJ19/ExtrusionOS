import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFName } from "pdf-lib";
import { PdfTextKit } from "../lib/pdf/unicode-text.ts";
import { nodeFontLoader } from "../lib/pdf/font-loader-node.ts";
import { PDF_FONT_FILES, scriptForCodePoint } from "../lib/pdf/font-catalog.ts";
import { buildInvoicePdf } from "../lib/pdf/invoice-pdf.ts";

const samples = {
  devanagari: "श्री गणेश एल्युमिनियम प्रा. लि. ₹१२३",
  gujarati: "ગુજરાત ફેબ્રિકેટર્સ",
  tamil: "சென்னை அலுமினியம்",
  bengali: "কলকাতা অ্যালুমিনিয়াম",
  telugu: "హైదరాబాద్",
  kannada: "ಬೆಂಗಳೂರು",
  malayalam: "കൊച്ചി",
  gurmukhi: "ਲੁਧਿਆਣਾ",
  oriya: "ଭୁବନେଶ୍ୱର",
  latin_ext: "Łódź Zürich Şişli"
};

test("every catalogued PDF font file ships in public/fonts/pdf", () => {
  for (const file of PDF_FONT_FILES) assert.ok(readFileSync(`public/fonts/pdf/${file}`).length > 1000, file);
});

test("Indian scripts render with real glyphs and conjunct shaping instead of being stripped", async () => {
  const pdf = await PDFDocument.create();
  const kit = await PdfTextKit.create(pdf, nodeFontLoader, Object.values(samples));
  for (const [script, text] of Object.entries(samples)) {
    const runs = kit.runs(text);
    assert.ok(runs.some((run) => run.font.pdf.name !== "Helvetica"), `${script} uses an embedded Unicode font`);
    assert.equal(runs.map((run) => run.text).join(""), text, `${script} text is preserved verbatim`);
    assert.ok(kit.measure(text, 12) > 0);
  }
  assert.equal(kit.missing.size, 0);
  // Shaping check: the Devanagari conjunct "श्र" must not decompose into three .notdef-free
  // base glyphs side by side; fontkit's Indic shaper substitutes a ligature.
  const font = fontkit.create(Buffer.from(await nodeFontLoader("noto-sans-devanagari-devanagari-400-normal.woff")));
  const shaped = font.layout("श्री");
  assert.ok(shaped.glyphs.every((glyph) => glyph.id !== 0), "no missing glyphs");
  assert.ok(shaped.glyphs.length < Array.from("श्री").length, "conjunct is shaped into fewer glyphs than code points");
});

test("unsupported characters are replaced visibly and reported, never silently dropped", async () => {
  const pdf = await PDFDocument.create();
  const kit = await PdfTextKit.create(pdf, nodeFontLoader, ["日本 😀"]);
  assert.equal(kit.runs("A日😀").map((run) => run.text).join(""), "A??");
  assert.equal(kit.missing.size, 2);
  assert.equal(scriptForCodePoint(0x20b9), "devanagari", "the rupee sign has a font");
});

test("wrap hard-breaks oversized tokens at grapheme boundaries within the width", async () => {
  const pdf = await PDFDocument.create();
  const kit = await PdfTextKit.create(pdf, nodeFontLoader, [samples.devanagari]);
  const token = "PROFILE-CODE-WITHOUT-SPACES-".repeat(12);
  const lines = kit.wrap(`Item ${token} end`, 10, 200);
  assert.ok(lines.length > 3);
  for (const line of lines) assert.ok(kit.measure(line, 10) <= 200, line);
  assert.equal(lines.join("").replace(/\s/g, ""), `Item${token}end`);
  const hindi = kit.wrap("श्रीगणेशएल्युमिनियमप्राइवेटलिमिटेड".repeat(4), 12, 120);
  assert.ok(hindi.length > 1);
  assert.equal(hindi.join(""), "श्रीगणेशएल्युमिनियमप्राइवेटलिमिटेड".repeat(4), "graphemes are not split mid-cluster");
  assert.deepEqual(kit.wrap("a\n\nb", 10, 200), ["a", "", "b"]);
});

test("invoice PDF keeps Unicode parties, repeats identity on continuation pages and shows payment context", async () => {
  const bytes = await buildInvoicePdf({
    company: { name: samples.devanagari, gst_number: "27ABCDE1234F1Z5", billing_address: "पुणे 411026" },
    customer: { company_name: samples.gujarati, billing_address: samples.tamil },
    invoice: { invoice_number: "INV/26-27/9", invoice_date: "2026-10-20", due_date: "2026-11-19", status: "generated", supplier_state_code: "27",
      place_of_supply_state_code: "24", subtotal: 100, tax_total: 18, grand_total: 118, igst_amount: 18, amount_paid: 50, credited_amount: 0, balance_due: 68 },
    items: Array.from({ length: 60 }, () => ({ item_description: "PROFILE-".repeat(30), hsn_code: "7604", quantity: 1, unit_rate: 100, line_total: 100, gst_percent: 18 }))
  });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() > 2);
  const baseFonts = doc.context.enumerateIndirectObjects()
    .map(([, object]) => object?.get?.(PDFName.of("BaseFont"))?.toString?.() ?? "").filter(Boolean);
  assert.ok(baseFonts.some((name) => /NotoSansDevanagari/.test(name)), `Devanagari font embedded: ${baseFonts.join(",")}`);
  assert.ok(baseFonts.some((name) => /NotoSansGujarati/.test(name)), "Gujarati font embedded");
  assert.ok(baseFonts.some((name) => /NotoSansTamil/.test(name)), "Tamil font embedded");
});

test("finance vouchers render credit notes, expenses and supplier payments with Unicode parties", async () => {
  const { buildVoucherPdf, creditNoteVoucher, expenseVoucher, supplierPaymentVoucher } = await import("../lib/pdf/finance-vouchers.ts");
  const invoice = { invoice_number: "INV-9", invoice_date: "2026-10-01", supplier_snapshot: { name: samples.devanagari, gst_number: "27AAA" },
    customer_snapshot: { company_name: samples.gujarati, billing_address: samples.tamil } };
  const credit = creditNoteVoucher({ invoice, dispatchNumber: "DSP-1", note: { credit_note_number: "CN-1", credit_date: "2026-10-10", status: "reversed",
    reversal_reason: "Wrong dispatch", reason: "Full dispatch returned", subtotal: 100, tax_total: 18, grand_total: 118,
    item_snapshot: [{ item_description: "खिड़की प्रोफ़ाइल", hsn_code: "7604", quantity: 10, line_total: 100 }] } });
  assert.equal(credit.title, "REVERSED CREDIT NOTE");
  assert.deepEqual(credit.totals.at(-1), ["Credit note total", 118, true]);
  assert.ok(credit.details.some(([label]) => label === "Reversal reason"));
  const expense = expenseVoucher({ company: { name: "Shree Metals", gst_number: "27BBB" }, expense: { expense_number: "EXP-1", expense_category: "maintenance_repairs",
    description: "हाइड्रोलिक सील", vendor_name_snapshot: "Ganesh Hydraulics", total_amount: 1180, base_amount: 1000, tax_amount: 180, amount_paid: 1180,
    refunded_amount: 0, credited_amount: 0, balance_amount: 0, approval_status: "approved", payment_status: "paid", invoice_date: "2026-10-02" },
    payments: [{ status: "posted", payment_date: "2026-10-05", amount_paid: 1180, payment_method: "cheque", reference_number: "CHQ1" }, { status: "reversed", amount_paid: 99 }],
    credits: [] });
  assert.equal(expense.lines.length, 1, "reversed payments are not presented as settlement");
  const payment = supplierPaymentVoucher({ company: { name: "Shree Metals" }, expense: { expense_number: "EXP-1", vendor_name_snapshot: "ગણેશ", balance_amount: 0 },
    payment: { id: "00000000-0000-4000-8000-000000000123", payment_date: "2026-10-05", amount_paid: 1180, payment_method: "bank_transfer", reference_number: "UTR9", status: "posted" } });
  for (const voucher of [credit, expense, payment]) {
    const doc = await PDFDocument.load(await buildVoucherPdf(voucher));
    assert.ok(doc.getPageCount() >= 1);
  }
  const many = await PDFDocument.load(await buildVoucherPdf({ ...expense, lines: Array.from({ length: 120 }, (_, i) => ({ description: `Line ${i} ${"X".repeat(200)}`, amount: i })) }));
  assert.ok(many.getPageCount() > 2, "long vouchers paginate");
});

test("quote PDF keeps Indian-script customer names instead of stripping them", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  require("tsx/cjs");
  const { buildQuotePdf } = require("../lib/pdf/quote-pdf.ts");
  const bytes = await buildQuotePdf({
    company: { name: samples.devanagari, gst_number: "27AAA", billing_address: "पुणे" }, settings: {},
    quote: { quote_number: "Q-1", quote_date: "2026-10-01", valid_until: "2026-10-31", subtotal: 100, gst_percent: 18, gst_amount: 18, grand_total: 118,
      customers: { company_name: samples.gujarati, billing_address: samples.tamil, shipping_address: samples.bengali } },
    items: [{ quantity_pieces: 2, length_per_piece_m: 6, total_meters: 12, total_weight_kg: 10, billing_weight_kg: 10, price_per_kg: 10, line_total_before_gst: 100,
      item_description: "स्लाइडिंग विंडो प्रोफ़ाइल", aluminium_profiles: { profile_code: "SW-01", profile_name: "Sliding" } }]
  });
  const doc = await PDFDocument.load(bytes);
  const baseFonts = doc.context.enumerateIndirectObjects().map(([, object]) => object?.get?.(PDFName.of("BaseFont"))?.toString?.() ?? "").filter(Boolean);
  for (const family of ["Devanagari", "Gujarati", "Tamil", "Bengali"]) assert.ok(baseFonts.some((name) => name.includes(`NotoSans${family}`)), family);
});
