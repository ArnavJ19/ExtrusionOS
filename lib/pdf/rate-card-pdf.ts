// AP-073: the customer rate card PDF. Selling prices only, with the validity date and GST printed.
import { type PdfFontLoader } from "./unicode-text.ts";
import { nodeFontLoader } from "./font-loader-node.ts";
import { PdfDocumentWriter, type PdfTableRow } from "./document-kit.ts";
import { pdfDate, pdfMoney, pdfText } from "./format.ts";
import { rateCardValidity, sortRateLines, type RateCard } from "../commercial/rate-card.ts";

export function rateCardRows(card: RateCard): PdfTableRow[] {
  return sortRateLines(card.lines).map(l => [pdfText(l.families ?? "All profiles"), pdfText(l.alloy ?? "As specified"), l.finish_label, pdfMoney(l.rate_per_kg),
    l.finish_extra ? `${pdfMoney(l.finish_extra.rate)} ${l.finish_extra.basis === "per_sqft" ? "per sq ft" : "per metre"}` : "—"]);
}

export async function buildRateCardPdf(card: RateCard & { logo?: Uint8Array | null }, loadFont: PdfFontLoader = nodeFontLoader) {
  const writer = await PdfDocumentWriter.create({
    title: "RATE CARD", number: card.card_number, logo: card.logo ?? null,
    issuer: { name: card.company.name || "Company", lines: [card.company.city, card.company.gst_number ? `GSTIN: ${card.company.gst_number}` : null, [card.company.phone, card.company.email].filter(Boolean).join(" · ") || null] },
    meta: [["Rate date", pdfDate(card.rate_day)], ["Valid until", pdfDate(card.valid_until)], ["GST", `${card.gst_percent}% extra`]],
    subject: `Rate card ${card.card_number}`
  }, loadFont, card);
  writer.panels([{ label: "Prepared for", title: card.customer_name, lines: [rateCardValidity(card)] }]);
  writer.sectionTitle("Rates per kg", 30);
  writer.table([{ header: "Profile family", width: 34 }, { header: "Alloy", width: 12 }, { header: "Finish", width: 18 }, { header: "Rate / kg", width: 16, align: "right" }, { header: "Finishing extra", width: 20, align: "right" }],
    rateCardRows(card), { emptyText: "No rates on this card." });
  writer.space(6);
  writer.paragraph("Rates are per kg of aluminium profile, ex-works, based on today's metal rate. GST is extra. The quotation and invoice carry the final price for the profiles, lengths and quantities ordered.", { size: 8 });
  return writer.finish();
}
