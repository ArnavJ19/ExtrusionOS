import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { gstStateLabel } from "../calculations/gst.ts";
import { numberToWordsINR } from "../utils/number-to-words.ts";
import { PdfTextKit, type PdfFontLoader } from "./unicode-text.ts";
import { nodeFontLoader } from "./font-loader-node.ts";

type InvoiceDocumentData = {
  company: Record<string, any>;
  customer: Record<string, any>;
  invoice: Record<string, any>;
  items: Record<string, any>[];
  loadFont?: PdfFontLoader;
};

const PAGE: [number, number] = [595, 842];
const LEFT = 42;
const RIGHT = 553;
const WIDTH = RIGHT - LEFT;
const TOP = 800;
const BOTTOM = 60;
const INK = rgb(0.12, 0.15, 0.18);
const MUTED = rgb(0.4, 0.43, 0.47);

const money = (value: unknown) => `INR ${Number(value ?? 0).toFixed(2)}`;

export async function buildInvoicePdf({ company, customer, invoice, items, loadFont = nodeFontLoader }: InvoiceDocumentData) {
  if (!invoice.supplier_state_code || !invoice.place_of_supply_state_code || !items.length || items.some((item) => !item.hsn_code)) {
    throw new Error("Complete supply states and HSN codes before generating this invoice.");
  }
  const pdf = await PDFDocument.create();
  const companyName = String(company.legal_name || company.name || "");
  const customerName = String(customer.company_name || customer.customer_name || "");
  const title = invoice.status === "draft" ? "DRAFT INVOICE" : invoice.status === "cancelled" ? "CANCELLED INVOICE" : "TAX INVOICE";
  // Every value that may be drawn is scanned so the right Unicode fonts are embedded (PDF-01).
  const kit = await PdfTextKit.create(pdf, loadFont, [
    companyName, company.billing_address, company.gst_number, customerName, customer.billing_address, customer.shipping_address,
    customer.gst_number, invoice.invoice_number, invoice.notes, ...items.map((item) => item.item_description)
  ]);
  let page: PDFPage;
  let y = TOP;

  // Continuation pages repeat a compact identity header (PDF-02).
  function newPage(first: boolean) {
    page = pdf.addPage(PAGE);
    y = TOP;
    if (!first) {
      kit.draw(page, `${title} ${invoice.invoice_number} | ${invoice.invoice_date} | ${companyName} -> ${customerName} (continued)`, { x: LEFT, y, size: 9, bold: true, color: MUTED });
      y -= 18;
      page.drawLine({ start: { x: LEFT, y: y + 8 }, end: { x: RIGHT, y: y + 8 }, thickness: 0.5, color: MUTED });
    }
  }
  function ensure(height: number) {
    if (y - height < BOTTOM) newPage(false);
  }
  function text(value: unknown, size = 10, bold = false, indent = 0) {
    for (const line of kit.wrap(String(value ?? ""), size, WIDTH - indent, bold)) {
      ensure(size + 6);
      kit.draw(page, line, { x: LEFT + indent, y, size, bold, color: INK });
      y -= size + 6;
    }
  }
  function pair(label: string, value: string, size = 10, bold = false) {
    ensure(size + 6);
    kit.draw(page, label, { x: LEFT, y, size, bold, color: INK });
    kit.drawRight(page, value, { right: RIGHT, y, size, bold, color: INK });
    y -= size + 6;
  }

  newPage(true);
  text(title, 20, true);
  text(`${invoice.invoice_number} | Date: ${invoice.invoice_date}${invoice.due_date ? ` | Due: ${invoice.due_date}` : ""}`, 11, true);
  text(companyName, 13, true);
  text(`GSTIN: ${company.gst_number || "Not recorded"} | State: ${gstStateLabel(invoice.supplier_state_code)}`);
  text(company.billing_address);
  y -= 4;
  text(`Bill to: ${customerName}`, 12, true);
  text(`GSTIN: ${customer.gst_number || "Unregistered"}`);
  text(customer.billing_address);
  text(`Deliver to: ${customer.shipping_address || customer.billing_address || "Not recorded"}`);
  text(`Place of supply: ${gstStateLabel(invoice.place_of_supply_state_code)}`, 11, true);
  y -= 10;
  items.forEach((item, index) => {
    ensure(48);
    text(`${index + 1}. ${item.item_description || "Aluminium profile"}`, 11, true);
    text(`HSN ${item.hsn_code} | ${Number(item.quantity).toFixed(3)} kg x ${money(item.unit_rate)} | Taxable ${money(item.line_total)}`, 10, false, 12);
    text(invoice.supplier_state_code !== invoice.place_of_supply_state_code
      ? `IGST rate: ${Number(item.gst_percent)}%`
      : `CGST rate: ${Number(item.gst_percent) / 2}% | ${Number(invoice.utgst_amount) > 0 ? "UTGST" : "SGST"} rate: ${Number(item.gst_percent) / 2}%`, 10, false, 12);
    y -= 5;
  });
  ensure(140);
  pair("Taxable total", money(invoice.subtotal), 11, true);
  for (const [label, key] of [["CGST", "cgst_amount"], ["SGST", "sgst_amount"], ["UTGST", "utgst_amount"], ["IGST", "igst_amount"]]) {
    if (Number(invoice[key]) > 0) pair(label, money(invoice[key]));
  }
  pair("Grand total", money(invoice.grand_total), 14, true);
  text(numberToWordsINR(Number(invoice.grand_total)));
  // Payment terms and receivable context (PDF-03).
  if (invoice.due_date || invoice.amount_paid != null || invoice.balance_due != null) {
    y -= 6;
    text("Payment status", 11, true);
    if (invoice.due_date) pair("Payment due by", String(invoice.due_date));
    if (invoice.amount_paid != null) pair("Received to date (net of refunds)", money(invoice.amount_paid));
    if (Number(invoice.credited_amount ?? 0) > 0) pair("Return credit notes", money(invoice.credited_amount));
    if (invoice.balance_due != null) pair("Balance due", money(invoice.balance_due), 11, true);
  }
  y -= 10;
  text(`For ${companyName}`, 11, true);
  text("Authorised signatory: ____________________");

  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    kit.drawRight(current, `${invoice.invoice_number} | Page ${index + 1} of ${pages.length}`, { right: RIGHT, y: 30, size: 8, color: MUTED });
  });
  if (kit.missing.size) {
    const last = pages[pages.length - 1];
    kit.draw(last, `Note: ${kit.missing.size} character(s) outside supported scripts are shown as "?".`, { x: LEFT, y: 42, size: 7, color: MUTED });
  }
  return pdf.save();
}
