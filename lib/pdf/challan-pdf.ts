// AP-091: delivery challan for one dispatch, on the shared document engine, so a day's challans can be printed together.
// It lists what left the gate (bundles, pieces, lengths, weights) against the order. It carries no price, cost, margin or
// internal note: it is not a tax invoice.
import { type PdfFontLoader } from "./unicode-text.ts";
import { nodeFontLoader } from "./font-loader-node.ts";
import { PdfDocumentWriter, type PdfTableRow } from "./document-kit.ts";
import { pdfDate, pdfInteger, pdfQuantity, pdfText } from "./format.ts";

export type ChallanBundle = { bundle_number: string | null; profile: string | null; description: string | null; pieces: number | null; length_m: number | null; net_kg: number | null; gross_kg: number | null };
export type ChallanDocument = {
  company: { name: string; legal_name?: string | null; gst_number?: string | null; address?: string | null };
  customer: { name: string; gst_number?: string | null; address?: string | null };
  dispatch: { dispatch_number: string; dispatch_date: string | null; vehicle_number?: string | null; transporter_name?: string | null; driver_name?: string | null;
    lr_number?: string | null; eway_bill_number?: string | null };
  order: { order_number: string | null; order_date?: string | null };
  bundles: ChallanBundle[];
  logo?: Uint8Array | null;
};

/** Bundle rows and their totals; blank values stay blank (never 0). */
export function challanRows(bundles: ChallanBundle[]): { rows: PdfTableRow[]; pieces: number | null; netKg: number | null; grossKg: number | null } {
  const sum = (key: "pieces" | "net_kg" | "gross_kg") => bundles.some(b => b[key] === null || b[key] === undefined) ? null : bundles.reduce((n, b) => n + Number(b[key]), 0);
  const rows: PdfTableRow[] = bundles.map((b, i) => [String(i + 1), pdfText(b.bundle_number), [b.profile, b.description].filter(Boolean).join(" · ") || "—", pdfInteger(b.pieces),
    b.length_m === null ? "—" : pdfQuantity(b.length_m * 1000, 0, " mm"), pdfQuantity(b.net_kg, 3), pdfQuantity(b.gross_kg, 3)]);
  return { rows, pieces: sum("pieces"), netKg: sum("net_kg"), grossKg: sum("gross_kg") };
}

export async function buildChallanPdf(doc: ChallanDocument, loadFont: PdfFontLoader = nodeFontLoader) {
  const writer = await PdfDocumentWriter.create({
    title: "DELIVERY CHALLAN",
    number: doc.dispatch.dispatch_number,
    logo: doc.logo ?? null,
    issuer: { name: doc.company.name || "Company", lines: [doc.company.legal_name, doc.company.address, doc.company.gst_number ? `GSTIN: ${doc.company.gst_number}` : null] },
    meta: [["Challan date", pdfDate(doc.dispatch.dispatch_date)], ["Order", doc.order.order_number], ["Order date", doc.order.order_date ? pdfDate(doc.order.order_date) : null]],
    subject: `Delivery challan ${doc.dispatch.dispatch_number}`
  }, loadFont, doc);
  writer.panels([
    { label: "Deliver to", title: doc.customer.name || "Customer", lines: [doc.customer.address, doc.customer.gst_number ? `GSTIN: ${doc.customer.gst_number}` : null] },
    { label: "Transport", title: doc.dispatch.transporter_name || "Transporter not recorded", lines: [
      doc.dispatch.vehicle_number ? `Vehicle: ${doc.dispatch.vehicle_number}` : "Vehicle not recorded", doc.dispatch.driver_name ? `Driver: ${doc.dispatch.driver_name}` : null,
      doc.dispatch.lr_number ? `LR: ${doc.dispatch.lr_number}` : null, doc.dispatch.eway_bill_number ? `E-way bill: ${doc.dispatch.eway_bill_number}` : null] }
  ]);
  const t = challanRows(doc.bundles);
  writer.sectionTitle("Bundles", 30);
  writer.table([
    { header: "#", width: 5 }, { header: "Bundle", width: 17 }, { header: "Profile", width: 32 }, { header: "Pieces", width: 9, align: "right" },
    { header: "Length", width: 11, align: "right" }, { header: "Net kg", width: 13, align: "right" }, { header: "Gross kg", width: 13, align: "right" }
  ], t.rows, { emptyText: "No bundles are recorded on this dispatch.", keepWithNext: 90 });
  writer.totals([
    { label: "Bundles", value: String(doc.bundles.length) },
    { label: "Pieces", value: pdfInteger(t.pieces) },
    { label: "Net weight", value: pdfQuantity(t.netKg, 3, " kg"), emphasis: true },
    { label: "Gross weight", value: pdfQuantity(t.grossKg, 3, " kg") }
  ], { width: 260 });
  writer.space(6);
  writer.paragraph("Material sent for delivery against the order above. This challan is not a tax invoice.", { size: 8 });
  writer.signatures(["Prepared by", "Received in good condition (name, signature, date)"], { forName: doc.company.name });
  return writer.finish();
}
