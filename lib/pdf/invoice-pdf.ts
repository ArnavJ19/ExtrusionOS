import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { gstStateLabel } from "../calculations/gst.ts";
import { numberToWordsINR } from "../utils/number-to-words.ts";

type InvoiceDocumentData = {
  company: Record<string, any>;
  customer: Record<string, any>;
  invoice: Record<string, any>;
  items: Record<string, any>[];
};

export async function buildInvoicePdf({ company, customer, invoice, items }: InvoiceDocumentData) {
  if (!invoice.supplier_state_code || !invoice.place_of_supply_state_code || !items.length || items.some((item) => !item.hsn_code)) {
    throw new Error("Complete supply states and HSN codes before generating this invoice.");
  }
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  let y = 800;
  const money = (value: unknown) => `INR ${Number(value ?? 0).toFixed(2)}`;
  function text(value: unknown, size = 10, strong = false) {
    const clean = String(value ?? "").replace(/[^\x20-\x7e\n]/g, " ");
    const font = strong ? bold : regular;
    for (const paragraph of clean.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        // Split long identifiers as well as ordinary prose to prevent overflow.
        for (const part of word.match(/.{1,65}/g) ?? [""]) {
          const candidate = line ? `${line} ${part}` : part;
          if (font.widthOfTextAtSize(candidate, size) > 510 && line) { draw(line); line = part; }
          else line = candidate;
        }
      }
      draw(line);
    }
    function draw(line: string) {
      if (y < 55) { page = pdf.addPage([595, 842]); y = 800; }
      page.drawText(line, { x: 42, y, size, font, color: rgb(0.12, 0.15, 0.18) });
      y -= size + 6;
    }
  }
  text(invoice.status === "draft" ? "DRAFT INVOICE" : invoice.status === "cancelled" ? "CANCELLED INVOICE" : "TAX INVOICE", 20, true);
  text(`${invoice.invoice_number} | Date: ${invoice.invoice_date}`, 11, true);
  text(company.legal_name || company.name, 13, true);
  text(`GSTIN: ${company.gst_number || "Not recorded"} | State: ${gstStateLabel(invoice.supplier_state_code)}`);
  text(company.billing_address);
  text(`Bill to: ${customer.company_name || customer.customer_name}`, 12, true);
  text(`GSTIN: ${customer.gst_number || "Unregistered"}`);
  text(customer.billing_address);
  text(`Deliver to: ${customer.shipping_address || customer.billing_address || "Not recorded"}`);
  text(`Place of supply: ${gstStateLabel(invoice.place_of_supply_state_code)}`, 11, true);
  y -= 10;
  items.forEach((item, i) => {
    text(`${i + 1}. ${item.item_description || "Aluminium profile"}`, 11, true);
    text(`HSN ${item.hsn_code} | ${Number(item.quantity).toFixed(3)} kg x ${money(item.unit_rate)} | Taxable ${money(item.line_total)}`);
    text(invoice.supplier_state_code !== invoice.place_of_supply_state_code
      ? `IGST rate: ${Number(item.gst_percent)}%`
      : `CGST rate: ${Number(item.gst_percent) / 2}% | ${Number(invoice.utgst_amount) > 0 ? "UTGST" : "SGST"} rate: ${Number(item.gst_percent) / 2}%`);
    y -= 5;
  });
  text(`Taxable total: ${money(invoice.subtotal)}`, 11, true);
  for (const [label, key] of [["CGST", "cgst_amount"], ["SGST", "sgst_amount"], ["UTGST", "utgst_amount"], ["IGST", "igst_amount"]]) {
    if (Number(invoice[key]) > 0) text(`${label}: ${money(invoice[key])}`);
  }
  text(`Grand total: ${money(invoice.grand_total)}`, 14, true);
  text(numberToWordsINR(Number(invoice.grand_total)));
  text(`For ${company.legal_name || company.name}`, 11, true);
  text("Authorised signatory: ____________________");
  return pdf.save();
}
