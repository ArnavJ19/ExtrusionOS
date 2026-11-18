// AP-074: tax invoice for a scrap sale (HSN from the scrap grade, GST split by place of supply). Its numbers come from
// the scrap invoice series; the weight is the weighbridge net weight recorded on the sale.
import { type PdfFontLoader } from "./unicode-text.ts";
import { nodeFontLoader } from "./font-loader-node.ts";
import { PdfDocumentWriter } from "./document-kit.ts";
import { pdfDate, pdfMoney, pdfQuantity, pdfText } from "./format.ts";

export type ScrapInvoice = { invoice_number: string; invoice_date: string; sale_number: string; grade: { code: string; name: string }; hsn_code: string; gst_percent: number;
  net_kg: number; gross_kg: number | null; tare_kg: number | null; weighbridge_ref: string | null; vehicle_registration: string | null; rate_per_kg: number; taxable_value: number;
  cgst_amount: number; sgst_amount: number; igst_amount: number; invoice_total: number; place_of_supply: string | null;
  buyer: { name: string; gst_number: string | null; state: string | null; address: string | null };
  company: { name: string; gst_number: string | null; address: string | null; city: string | null; state: string | null } };

export async function buildScrapInvoicePdf(doc: ScrapInvoice & { logo?: Uint8Array | null }, loadFont: PdfFontLoader = nodeFontLoader) {
  const writer = await PdfDocumentWriter.create({
    title: "TAX INVOICE", number: doc.invoice_number, logo: doc.logo ?? null,
    issuer: { name: doc.company.name || "Company", lines: [doc.company.address, [doc.company.city, doc.company.state].filter(Boolean).join(", ") || null, doc.company.gst_number ? `GSTIN: ${doc.company.gst_number}` : null] },
    meta: [["Invoice date", pdfDate(doc.invoice_date)], ["Sale", doc.sale_number], ["Place of supply", doc.place_of_supply]],
    subject: `Scrap invoice ${doc.invoice_number}`
  }, loadFont, doc);
  writer.panels([
    { label: "Bill to", title: doc.buyer.name, lines: [doc.buyer.address, doc.buyer.state, doc.buyer.gst_number ? `GSTIN: ${doc.buyer.gst_number}` : "Unregistered buyer"] },
    { label: "Weighbridge", title: doc.weighbridge_ref ? `Slip ${doc.weighbridge_ref}` : "Slip not recorded", lines: [doc.vehicle_registration ? `Vehicle ${doc.vehicle_registration}` : null,
      `Gross ${pdfQuantity(doc.gross_kg, 3, " kg")} · Tare ${pdfQuantity(doc.tare_kg, 3, " kg")}`] }
  ]);
  writer.table([{ header: "Description", width: 40 }, { header: "HSN", width: 10 }, { header: "Net kg", width: 14, align: "right" }, { header: "Rate / kg", width: 16, align: "right" }, { header: "Taxable value", width: 20, align: "right" }],
    [[`Aluminium scrap — ${pdfText(doc.grade.name)} (${doc.grade.code})`, doc.hsn_code, pdfQuantity(doc.net_kg, 3), pdfMoney(doc.rate_per_kg), pdfMoney(doc.taxable_value)]]);
  writer.totals([
    { label: "Taxable value", value: pdfMoney(doc.taxable_value) },
    ...(Number(doc.igst_amount) > 0 ? [{ label: `IGST ${doc.gst_percent}%`, value: pdfMoney(doc.igst_amount) }]
      : [{ label: `CGST ${Number(doc.gst_percent) / 2}%`, value: pdfMoney(doc.cgst_amount) }, { label: `SGST ${Number(doc.gst_percent) / 2}%`, value: pdfMoney(doc.sgst_amount) }]),
    { label: "Invoice total", value: pdfMoney(doc.invoice_total), emphasis: true }
  ], { width: 260 });
  writer.signatures(["Receiver's signature", "Authorised signatory"], { forName: doc.company.name });
  return writer.finish();
}
