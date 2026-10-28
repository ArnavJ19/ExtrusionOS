import { gstStateLabel } from "../calculations/gst.ts";
import { numberToWordsINR } from "../utils/number-to-words.ts";
import { type PdfFontLoader } from "./unicode-text.ts";
import { nodeFontLoader } from "./font-loader-node.ts";
import { PdfDocumentWriter, type PdfTableRow } from "./document-kit.ts";
import { issuerName, joinParts, legalNameLine, pdfAmount, pdfDate, pdfMoney, pdfPercent, pdfQuantity, toNumber } from "./format.ts";

type InvoiceDocumentData = {
  company: Record<string, any>;
  customer: Record<string, any>;
  invoice: Record<string, any>;
  items: Record<string, any>[];
  loadFont?: PdfFontLoader;
  /** Company logo bytes (lib/pdf/logo-loader-node.ts). */
  logo?: Uint8Array | null;
};

// Union-territory GST codes, matching private.canonicalize_invoice_supply().
const UT_STATE_CODES = new Set(["04", "26", "31", "35", "38"]);
const paise = (value: number) => Math.round(value * 100);
const lineTax = (item: Record<string, any>) => Math.round(Number(item.line_total ?? 0) * Number(item.gst_percent ?? 0) + 1e-7) / 100;

export async function buildInvoicePdf({ company, customer, invoice, items, loadFont = nodeFontLoader, logo = null }: InvoiceDocumentData) {
  if (!invoice.supplier_state_code || !invoice.place_of_supply_state_code || !items.length || items.some((item) => !item.hsn_code)) {
    throw new Error("Complete supply states and HSN codes before generating this invoice.");
  }
  const companyName = issuerName(company, "");
  const customerName = String(customer.company_name || customer.customer_name || "");
  const status = String(invoice.status ?? "");
  const title = status === "draft" ? "DRAFT INVOICE" : status === "cancelled" ? "CANCELLED INVOICE" : "TAX INVOICE";
  const interState = invoice.supplier_state_code !== invoice.place_of_supply_state_code;
  const stateTaxLabel = UT_STATE_CODES.has(String(invoice.supplier_state_code)) || Number(invoice.utgst_amount) > 0 ? "UTGST" : "SGST";

  const doc = await PdfDocumentWriter.create({
    title,
    number: invoice.invoice_number,
    logo,
    issuer: {
      name: companyName,
      lines: [
        legalNameLine(company),
        joinParts([company.billing_address, company.city, company.state, company.pincode]),
        `GSTIN: ${company.gst_number || "Not recorded"}   ·   State: ${gstStateLabel(invoice.supplier_state_code)}`,
        joinParts([company.phone, company.email], "   ·   ")
      ]
    },
    meta: [
      ["Invoice No.", invoice.invoice_number],
      ["Invoice date", pdfDate(invoice.invoice_date)],
      ["Due date", invoice.due_date ? pdfDate(invoice.due_date) : null],
      ["Place of supply", gstStateLabel(invoice.place_of_supply_state_code)],
      ["Supply type", interState ? "Inter-state (IGST)" : `Intra-state (CGST + ${stateTaxLabel})`]
    ],
    stamp: status === "draft" ? { text: "Draft", tone: "warning" } : status === "cancelled" ? { text: "Cancelled", tone: "void" } : null,
    subject: `Tax invoice ${invoice.invoice_number} to ${customerName}`
  }, loadFont, [company, customer, invoice, items]);

  if (status === "draft") doc.notice("Draft for review only. This document is not a valid tax invoice until it is issued.", "warning");
  if (status === "cancelled") doc.notice("This invoice has been cancelled and is not payable.", "void");

  doc.panels([
    { label: "Billed to", title: customerName, lines: [customer.billing_address, `GSTIN: ${customer.gst_number || "Unregistered"}`] },
    { label: "Shipped to", title: customerName, lines: [customer.shipping_address || customer.billing_address || "Same as billing address"] }
  ]);

  // Line items. Tax per line follows the database rule: round(line_total × rate, 2).
  const rows: PdfTableRow[] = items.map((item, index) => {
    const tax = lineTax(item);
    return [
      String(index + 1),
      item.item_description || "Aluminium profile",
      item.hsn_code,
      pdfQuantity(item.quantity, 3),
      pdfAmount(item.unit_rate),
      pdfAmount(item.line_total),
      pdfPercent(item.gst_percent),
      pdfAmount(tax),
      pdfAmount(Number(item.line_total ?? 0) + tax)
    ];
  });
  const sumQuantity = items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
  const sumTaxable = items.reduce((sum, item) => sum + paise(Number(item.line_total ?? 0)), 0) / 100;
  const sumTax = items.reduce((sum, item) => sum + paise(lineTax(item)), 0) / 100;
  rows.push({ kind: "total", cells: ["", "Total", "", pdfQuantity(sumQuantity, 3), "", pdfAmount(sumTaxable), "", pdfAmount(sumTax), pdfAmount(sumTaxable + sumTax)] });

  doc.table([
    { header: "#", width: 3.5, align: "right" },
    { header: "Description of goods", width: 24 },
    { header: "HSN", width: 8.5 },
    { header: "Qty (kg)", width: 9.5, align: "right" },
    { header: "Rate (INR/kg)", width: 9, align: "right" },
    { header: "Taxable value (INR)", width: 12.5, align: "right" },
    { header: "GST rate", width: 6, align: "right" },
    { header: "GST (INR)", width: 11.5, align: "right" },
    { header: "Amount (INR)", width: 13.5, align: "right" }
  ], rows);

  // HSN-wise tax summary, printed only when line-level tax reconciles with the invoice so the
  // document never shows two different tax figures.
  const taxTotal = toNumber(invoice.tax_total) ?? (Number(invoice.cgst_amount ?? 0) + Number(invoice.sgst_amount ?? 0) + Number(invoice.utgst_amount ?? 0) + Number(invoice.igst_amount ?? 0));
  if (paise(sumTax) === paise(taxTotal)) {
    const groups = new Map<string, { hsn: string; rate: number; taxable: number; tax: number }>();
    for (const item of items) {
      const key = `${item.hsn_code}|${Number(item.gst_percent)}`;
      const group = groups.get(key) ?? { hsn: String(item.hsn_code), rate: Number(item.gst_percent), taxable: 0, tax: 0 };
      group.taxable += paise(Number(item.line_total ?? 0));
      group.tax += paise(lineTax(item));
      groups.set(key, group);
    }
    const summary = Array.from(groups.values());
    // Central share per group; the last group absorbs rounding so columns equal the invoice amounts.
    const centralTotal = paise(Number(invoice.cgst_amount ?? 0));
    let centralAllocated = 0;
    const summaryRows: PdfTableRow[] = summary.map((group, index) => {
      if (interState) return [group.hsn, pdfPercent(group.rate), pdfAmount(group.taxable / 100), pdfAmount(group.tax / 100), pdfAmount(group.tax / 100)];
      const central = index === summary.length - 1 ? centralTotal - centralAllocated : Math.round(group.tax / 2);
      centralAllocated += central;
      return [group.hsn, pdfPercent(group.rate), pdfAmount(group.taxable / 100), pdfAmount(central / 100), pdfAmount((group.tax - central) / 100), pdfAmount(group.tax / 100)];
    });
    summaryRows.push({ kind: "total", cells: interState
      ? ["Total", "", pdfAmount(sumTaxable), pdfAmount(invoice.igst_amount), pdfAmount(sumTax)]
      : ["Total", "", pdfAmount(sumTaxable), pdfAmount(invoice.cgst_amount), pdfAmount(Number(invoice.sgst_amount ?? 0) + Number(invoice.utgst_amount ?? 0)), pdfAmount(sumTax)] });
    doc.sectionTitle("Tax summary (HSN-wise)", 40);
    doc.table(interState ? [
      { header: "HSN", width: 14 }, { header: "GST rate", width: 10, align: "right" }, { header: "Taxable value (INR)", width: 18, align: "right" },
      { header: "IGST (INR)", width: 16, align: "right" }, { header: "Total tax (INR)", width: 16, align: "right" }
    ] : [
      { header: "HSN", width: 14 }, { header: "GST rate", width: 10, align: "right" }, { header: "Taxable value (INR)", width: 18, align: "right" },
      { header: "CGST (INR)", width: 15, align: "right" }, { header: `${stateTaxLabel} (INR)`, width: 15, align: "right" }, { header: "Total tax (INR)", width: 16, align: "right" }
    ], summaryRows);
  }

  const signers = ["Receiver's signature", "Authorised signatory"];
  doc.closing(signers, { forName: companyName });
  const totalRows = [{ label: "Taxable value", value: pdfMoney(invoice.subtotal) }];
  if (interState) totalRows.push({ label: "IGST", value: pdfMoney(invoice.igst_amount ?? 0) });
  else {
    totalRows.push({ label: "CGST", value: pdfMoney(invoice.cgst_amount ?? 0) });
    totalRows.push({ label: stateTaxLabel, value: pdfMoney(stateTaxLabel === "UTGST" ? invoice.utgst_amount ?? 0 : invoice.sgst_amount ?? 0) });
  }
  doc.totals([...totalRows, { label: "Invoice total", value: pdfMoney(invoice.grand_total), emphasis: true }]);
  doc.amountInWords(numberToWordsINR(Number(invoice.grand_total ?? 0)));

  // Receivable position (PDF-03).
  if (invoice.due_date || invoice.amount_paid != null || invoice.balance_due != null) {
    doc.sectionTitle("Payment status", 30);
    doc.fields([
      ["Payment due by", invoice.due_date ? pdfDate(invoice.due_date) : null],
      ["Received to date (net of refunds)", invoice.amount_paid != null ? pdfMoney(invoice.amount_paid) : null],
      ...(Number(invoice.credited_amount ?? 0) > 0 ? [["Return credit notes", pdfMoney(invoice.credited_amount)] as [string, string]] : []),
      ["Balance due", invoice.balance_due != null ? pdfMoney(invoice.balance_due) : null]
    ].filter(([, value]) => value !== null) as [string, string][], { columns: 2, labelRatio: 0.5 });
  }

  if (invoice.notes) {
    doc.sectionTitle("Notes", 20);
    doc.paragraph(invoice.notes, { size: 8 });
    doc.space(8);
  }

  doc.space(6);
  doc.signatures(signers, { forName: companyName });
  return doc.finish();
}
