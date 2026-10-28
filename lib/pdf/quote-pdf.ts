import { numberToWordsINR } from "../utils/number-to-words.ts";
import { savedLineInvoiceBasis } from "../calculations/quote.ts";
import { nodeFontLoader } from "./font-loader-node.ts";
import { type PdfFontLoader } from "./unicode-text.ts";
import { PDF_COLORS, PdfDocumentWriter, type PdfTableRow } from "./document-kit.ts";
import { issuerName, joinParts, pdfAmount, pdfDate, pdfInteger, pdfLabel, pdfMoney, pdfPercent, pdfQuantity, toNumber } from "./format.ts";

// Customer quotation. Only customer-safe fields are printed: no cost, margin or supplier rate.

const DEFAULT_TERMS = [
  "1. Prices are valid until the validity date mentioned above.",
  "2. GST is charged extra at the applicable rate unless stated otherwise.",
  "3. Delivery timeline depends on die availability, billet availability and finishing requirements.",
  "4. Transport charges are extra unless included above."
].join("\n");

function bankLines(value: unknown): string[] {
  if (!value) return [];
  // One account per line; "Bank: … | A/c: … | IFSC: …" separators print as the document's middle dot.
  if (typeof value === "string") return value.split(/\r?\n/).map((line) => line.trim().replace(/\s*\|\s*/g, "   ·   ")).filter(Boolean);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== null && entry !== undefined && String(entry).trim() !== "")
      .map(([key, entry]) => `${pdfLabel(key)}: ${String(entry)}`);
  }
  return [String(value)];
}

export async function buildQuotePdf(data: { company: any; settings: any; quote: any; items: any[]; loadFont?: PdfFontLoader; logo?: Uint8Array | null }) {
  const { company, quote, items, settings } = data;
  const customer = quote.customers ?? {};
  const customerName = String(customer.company_name || customer.customer_name || "Customer");
  const revision = Number(quote.revision_number ?? 1);
  const companyName = issuerName(company);
  const draft = quote.status === "draft";

  const doc = await PdfDocumentWriter.create({
    title: "QUOTATION",
    number: revision > 1 ? `${quote.quote_number} Rev ${revision}` : quote.quote_number,
    logo: data.logo ?? null,
    stamp: draft ? { text: "Draft", tone: "warning" } : null,
    issuer: {
      name: companyName,
      // A quotation is not a tax document: it carries the trading name, address and GSTIN only.
      lines: [
        joinParts([company.billing_address, company.city, company.state, company.pincode]),
        company.gst_number ? `GSTIN: ${company.gst_number}` : null,
        joinParts([company.phone, company.email], "   ·   ")
      ]
    },
    meta: [
      ["Quotation No.", quote.quote_number],
      ["Revision", String(revision)],
      ["Quotation date", pdfDate(quote.quote_date)],
      ["Valid until", pdfDate(quote.valid_until)]
    ],
    subject: `Quotation ${quote.quote_number} for ${customerName}`
  }, data.loadFont ?? nodeFontLoader, [company, customer, quote, items, settings]);

  // "Attn:" only when a contact person is recorded besides the company name printed as the title.
  const contact = customer.company_name && customer.customer_name && customer.customer_name !== customer.company_name ? `Attn: ${customer.customer_name}` : null;
  doc.panels([
    { label: "Quotation for", title: customerName, lines: [contact, customer.billing_address, customer.gst_number ? `GSTIN: ${customer.gst_number}` : null] },
    { label: "Delivery to", title: customerName, lines: [customer.shipping_address || customer.billing_address || "To be confirmed"] }
  ]);

  if (draft) doc.notice("Draft quotation for internal review. Prices are not confirmed until the quotation is issued.", "warning");

  const rows: PdfTableRow[] = items.map((item, index) => {
    const profile = item.aluminium_profiles ?? {};
    const finish = item.finishing_type ? `Finish: ${pdfLabel(item.finishing_type)}` : "";
    // The profile code has its own column, so a "1098 - …" prefix is not repeated in the description.
    const code = String(profile.profile_code ?? "").trim();
    const rawDescription = String(item.item_description || profile.profile_name || "Aluminium profile");
    const itemDescription = code && rawDescription.startsWith(`${code} - `) ? rawDescription.slice(code.length + 3) : rawDescription;
    const description = [itemDescription, finish].filter(Boolean).join("\n");
    const perKg = toNumber(item.price_per_kg);
    const perMeter = toNumber(item.price_per_meter);
    const rate = perKg && perKg > 0 ? `${pdfAmount(perKg)} /kg` : perMeter && perMeter > 0 ? `${pdfAmount(perMeter)} /m` : "—";
    return [
      String(index + 1),
      profile.profile_code || "—",
      description,
      pdfInteger(item.quantity_pieces),
      pdfQuantity(item.length_per_piece_m, 3),
      pdfQuantity(item.total_meters, 2),
      pdfQuantity(item.billing_weight_kg ?? item.total_weight_kg, 3),
      rate,
      pdfAmount(item.line_total_before_gst)
    ];
  });
  const sum = (key: string, fallback?: string) => items.reduce((total, item) => total + Number(item[key] ?? (fallback ? item[fallback] : 0) ?? 0), 0);
  const totalMeters = sum("total_meters");
  const totalWeight = sum("total_weight_kg");
  const billingWeight = sum("billing_weight_kg", "total_weight_kg");
  // The total row adds the printed line amounts; the quotation's stored subtotal is printed below.
  const lineSum = items.reduce((total, item) => total + Math.round(Number(item.line_total_before_gst ?? 0) * 100), 0) / 100;
  rows.push({ kind: "total", cells: ["", "", "Total", pdfInteger(sum("quantity_pieces")), "", pdfQuantity(totalMeters, 2), pdfQuantity(billingWeight, 3), "", pdfAmount(lineSum)] });

  doc.table([
    { header: "#", width: 3.5, align: "right" },
    { header: "Profile", width: 10 },
    { header: "Description", width: 27 },
    { header: "Pcs", width: 6, align: "right" },
    { header: "Length (m)", width: 8, align: "right" },
    { header: "Total (m)", width: 9.5, align: "right" },
    { header: "Billing wt (kg)", width: 11, align: "right" },
    { header: "Rate* (INR)", width: 11.5, align: "right" },
    { header: "Amount (INR)", width: 13.5, align: "right" }
  ], rows, { emptyText: "No line items on this quotation." });

  doc.paragraph(`Physical weight ${pdfQuantity(totalWeight, 3, "kg")}   ·   Billing weight ${pdfQuantity(billingWeight, 3, "kg")}   ·   Total length ${pdfQuantity(totalMeters, 2, "m")}`, { size: 7.5 });
  // EXOS-AUD-026: invoices bill the actual net weight at the invoice rate; die and freight are billed once.
  const invoiceBasis = items.map((item, index) => ({ label: item.aluminium_profiles?.profile_code || `Line ${index + 1}`, ...savedLineInvoiceBasis(item) }))
    .filter((line) => line.invoiceRatePerKg > 0);
  if (invoiceBasis.length) {
    const rates = invoiceBasis.map((line) => `${line.label} ${pdfAmount(line.invoiceRatePerKg)} /kg`).join("   ·   ");
    const charges = invoiceBasis.filter((line) => line.oneOffCharges > 0).map((line) => (line.dieCharge !== null && line.freightCharge !== null
      ? joinParts([line.dieCharge > 0 ? `die ${pdfAmount(line.dieCharge)}` : null, line.freightCharge > 0 ? `freight ${pdfAmount(line.freightCharge)}` : null], " + ")
      : `die and freight ${pdfAmount(line.oneOffCharges)}`) + ` (${line.label})`);
    doc.paragraph(`Invoicing: actual net weight at ${rates}.${charges.length ? ` Billed once on the first invoice: ${charges.join("; ")}.` : ""} Shipping the quoted quantity invoices the quoted amount.`, { size: 7.5 });
  }
  // price_per_kg is line amount ÷ billing weight rounded to paise (lib/calculations/quote.ts), so
  // rate × weight can differ from the amount by a few rupees; the amount is the binding figure.
  doc.paragraph("* Rate is the line amount divided by the billing weight (or length), rounded to the paisa. Line amounts are exact and are the figures quoted.", { size: 7, color: PDF_COLORS.muted });
  if (Math.abs(lineSum - Number(quote.subtotal || 0)) >= 0.01) {
    doc.notice(`Line amounts total ${pdfMoney(lineSum)} but the quotation subtotal is ${pdfMoney(quote.subtotal)}. Recalculate the quotation before sending.`, "void");
  }
  doc.space(6);

  const subtotal = Number(quote.subtotal || 0);
  const gstAmount = Number(quote.gst_amount || 0);
  const gstPercent = toNumber(quote.gst_percent);
  // A single rate is printed only when it reproduces the stored GST; otherwise rates vary by line.
  const uniformRate = gstPercent !== null && Math.abs(Math.round(subtotal * gstPercent) / 100 - gstAmount) <= 0.01 * Math.max(1, items.length);
  doc.totals([
    { label: "Subtotal (before GST)", value: pdfMoney(subtotal) },
    { label: uniformRate ? `GST @ ${pdfPercent(gstPercent)}` : "GST (line-wise rates)", value: pdfMoney(gstAmount) },
    { label: "Grand total", value: pdfMoney(quote.grand_total), emphasis: true }
  ]);
  doc.amountInWords(numberToWordsINR(Number(quote.grand_total || 0)));

  doc.sectionTitle("Commercial terms", 30);
  doc.fields([
    ["Delivery", quote.delivery_timeline || settings?.default_delivery_terms || "As mutually agreed"],
    ["Payment", quote.payment_terms || settings?.default_payment_terms || "As mutually agreed"]
  ], { columns: 1, labelRatio: 0.2 });

  const terms = String(quote.terms_and_conditions || settings?.default_terms_and_conditions || settings?.default_quote_terms || DEFAULT_TERMS);
  const signers = ["Customer acceptance (sign and stamp)", "Authorised signatory"];
  const forName = companyName;
  doc.closing(signers, { forName });
  doc.sectionTitle("Terms and conditions", 30);
  doc.list(terms.split(/\r?\n/));
  doc.space(8);

  const bank = bankLines(settings?.default_bank_details ?? settings?.bank_details);
  if (bank.length) doc.panels([{ label: "Bank details for payment", lines: bank }]);

  doc.signatures(signers, { forName });
  return doc.finish();
}
