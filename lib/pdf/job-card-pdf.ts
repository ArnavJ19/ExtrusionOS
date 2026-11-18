// AP-096: a one-page paper job card for the press, for when no tablet is at hand. Everything the operator needs to run the
// job (die, alloy and temper, billet, cut length, quantities, packing, QC checks) and a QR that opens the job in the app.
// Unknown values print as "—", never as 0. No price, cost, margin or customer contact is printed.
import { rgb } from "pdf-lib";
import { type PdfFontLoader } from "./unicode-text.ts";
import { nodeFontLoader } from "./font-loader-node.ts";
import { PdfDocumentWriter, type PdfField, type PdfTableRow } from "./document-kit.ts";
import { pdfDate, pdfInteger, pdfLabel, pdfNumber, pdfQuantity, pdfText } from "./format.ts";
import type { QrRuns } from "./qr-modules.ts";

export type JobCardCheck = { characteristic: string; unit: string; nominal: number | null; lower_limit: number | null; upper_limit: number | null; method: string | null; critical: boolean };
export type JobCardDocument = {
  company: { name: string };
  job: { job_number: string; status: string; planned_date: string | null; shift: string | null; machine: string | null; order_number: string | null; customer: string | null; due_date: string | null;
    planned_kg: number | null; pieces: number | null; planned_meters: number | null; cut_length_m: number | null; finishing_type: string | null; remarks: string | null };
  profile: { code: string | null; name: string | null; kg_per_m: number | null; alloy: string | null; temper: string | null; special_notes: string | null };
  die: { number: string | null; cavities: number | null; status: string | null } ;
  billet: { length_mm: number | null; length_basis: string | null; diameter: string | null; alloy: string | null };
  packing: { instruction: string | null; pieces_per_bundle: number | null; kg_per_bundle: number | null; customer_requirement: string | null };
  checks: JobCardCheck[];
  sampling: string | null;
  qr: { runs: QrRuns | null; text: string } | null;
  printed_at: Date;
};

const limits = (c: JobCardCheck) => c.unit === "visual" ? "Visual: pass / fail"
  : [c.lower_limit !== null ? `min ${pdfNumber(c.lower_limit, 3)}` : null, c.nominal !== null ? `nom ${pdfNumber(c.nominal, 3)}` : null, c.upper_limit !== null ? `max ${pdfNumber(c.upper_limit, 3)}` : null].filter(Boolean).join(" · ");

/** The checks table, with an empty column for the operator's reading. */
export function jobCardCheckRows(checks: JobCardCheck[]): PdfTableRow[] {
  return checks.map(c => [`${c.characteristic}${c.critical ? " *" : ""}`, c.unit, limits(c) || "—", pdfText(c.method), ""]);
}

export async function buildJobCardPdf(doc: JobCardDocument, loadFont: PdfFontLoader = nodeFontLoader) {
  const writer = await PdfDocumentWriter.create({
    title: "PRODUCTION JOB CARD",
    number: doc.job.job_number,
    issuer: { name: doc.company.name || "Company", lines: [] },
    meta: [["Status", pdfLabel(doc.job.status)], ["Planned", doc.job.planned_date ? `${pdfDate(doc.job.planned_date)}${doc.job.shift ? ` · ${pdfLabel(doc.job.shift)}` : ""}` : null],
      ["Press", doc.job.machine], ["Due", doc.job.due_date ? pdfDate(doc.job.due_date) : null]],
    subject: `Job card ${doc.job.job_number}`,
    generatedAt: doc.printed_at
  }, loadFont, doc);
  if (doc.qr?.runs) {
    // QR at the top right of the body: scanning it with the app opens this job.
    const size = 84, top = writer.y, cell = size / doc.qr.runs.size, x0 = writer.right - size;
    writer.rect(x0 - 3, top - size - 3, size + 6, size + 6, { fill: rgb(1, 1, 1) });
    for (const run of doc.qr.runs.runs) writer.rect(x0 + run.x * cell, top - (run.y + 1) * cell, run.w * cell, cell, { fill: rgb(0, 0, 0) });
    writer.text("Scan in ExtrusionOS to open this job", writer.right - size / 2, top - size - 12, { size: 6.5, align: "center" });
  }
  const fieldWidth = doc.qr?.runs ? writer.contentWidth - 100 : undefined;
  const before = writer.y;
  writer.paragraph(`${doc.profile.code ?? "Profile not recorded"}${doc.profile.name ? ` · ${doc.profile.name}` : ""}`, { size: 13, bold: true, width: fieldWidth });
  writer.paragraph(`Order ${doc.job.order_number ?? "—"}${doc.job.customer ? ` · ${doc.job.customer}` : ""}`, { size: 9, width: fieldWidth });
  writer.space(4);
  const main: PdfField[] = [
    ["Die", doc.die.number ? `${doc.die.number}${doc.die.cavities ? ` (${doc.die.cavities} cavity)` : ""}` : null],
    ["Alloy / temper", [doc.profile.alloy, doc.profile.temper].filter(Boolean).join(" / ") || null],
    ["Billet", doc.billet.length_mm ? `${pdfInteger(doc.billet.length_mm)} mm${doc.billet.length_basis ? ` (${doc.billet.length_basis})` : ""}` : null],
    ["Billet diameter", doc.billet.diameter],
    ["Cut length", doc.job.cut_length_m !== null ? pdfQuantity(doc.job.cut_length_m * 1000, 0, " mm") : null],
    ["Section weight", doc.profile.kg_per_m !== null ? pdfQuantity(doc.profile.kg_per_m, 3, " kg/m") : null],
    ["Planned quantity", doc.job.planned_kg !== null ? pdfQuantity(doc.job.planned_kg, 0, " kg") : null],
    ["Pieces", pdfInteger(doc.job.pieces)],
    ["Finish", doc.job.finishing_type ? pdfLabel(doc.job.finishing_type) : null],
    ["Planned metres", doc.job.planned_meters !== null ? pdfQuantity(doc.job.planned_meters, 1, " m") : null]
  ];
  writer.fields(main, { columns: 2 });
  if (doc.qr?.runs && writer.y > before - 110) writer.y = before - 110;
  writer.sectionTitle("Packing", 30);
  writer.fields([["Pieces per bundle", pdfInteger(doc.packing.pieces_per_bundle)], ["kg per bundle", doc.packing.kg_per_bundle !== null ? pdfQuantity(doc.packing.kg_per_bundle, 1, " kg") : null],
    ["Instruction", doc.packing.instruction], ["Customer requirement", doc.packing.customer_requirement]], { columns: 2 });
  writer.sectionTitle("Quality checks", 40);
  writer.table([{ header: "Characteristic", width: 26 }, { header: "Unit", width: 9 }, { header: "Limits", width: 27 }, { header: "Method", width: 20 }, { header: "Reading", width: 18 }],
    jobCardCheckRows(doc.checks), { emptyText: "No approved inspection plan applies to this profile. Ask quality before releasing the output." });
  if (doc.sampling) writer.paragraph(`Sampling: ${doc.sampling}`, { size: 8 });
  if (doc.checks.some(c => c.critical)) writer.paragraph("* critical characteristic", { size: 7 });
  const notes = [doc.profile.special_notes, doc.job.remarks].filter(Boolean).join("\n");
  if (notes) { writer.sectionTitle("Notes", 24); writer.paragraph(notes, { size: 8.5 }); }
  writer.space(6);
  writer.fields([["Operator", ""], ["Billets used", ""], ["Good pieces", ""], ["Start / end time", ""]], { columns: 2, blank: "" });
  writer.paragraph(`Printed ${pdfDate(doc.printed_at)}. If this card and the screen differ, the screen is current: scan the QR.`, { size: 7 });
  return writer.finish();
}
