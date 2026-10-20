/**
 * Die Technical Sheet Report Generator
 *
 * Generates a PDF technical sheet for a die on the shared document engine.
 * All data comes from real persisted records — no fabricated values.
 * Absent fields display "Not Captured" labels.
 */

import { PdfDocumentWriter, type PdfField } from "../../pdf/document-kit.ts";
import { nodeFontLoader } from "../../pdf/font-loader-node.ts";
import { pdfAmount, pdfDate, pdfLabel, pdfNumber, pdfPercent, pdfQuantity, pdfYesNo, toNumber } from "../../pdf/format.ts";
import type { PdfFontLoader } from "../../pdf/unicode-text.ts";

const NOT_CAPTURED = "Not Captured";

function val(v: unknown, suffix = ""): string {
  if (v === null || v === undefined || v === "") return NOT_CAPTURED;
  return `${v}${suffix}`;
}

function num(v: unknown, decimals: number, unit = ""): string {
  return toNumber(v) === null ? NOT_CAPTURED : pdfNumber(v, decimals, unit);
}

function label(v: unknown): string {
  return v === null || v === undefined || v === "" ? NOT_CAPTURED : pdfLabel(v);
}

export type DieReportData = {
  company: { name: string; gst_number?: string };
  die: Record<string, any>;
  profile?: { profile_code?: string; profile_name?: string; section_weight_kg_per_m?: number } | null;
  customer?: { customer_name?: string; company_name?: string } | null;
  trials: Record<string, any>[];
  corrections: Record<string, any>[];
  nitridings: Record<string, any>[];
  generatedBy: string;
  loadFont?: PdfFontLoader;
};

export async function buildDieTechnicalSheetPdf(data: DieReportData): Promise<Uint8Array> {
  const d = data.die;
  const doc = await PdfDocumentWriter.create({
    title: "DIE TECHNICAL SHEET",
    number: d.die_number ?? null,
    issuer: { name: data.company.name, lines: [data.company.gst_number ? `GSTIN: ${data.company.gst_number}` : null] },
    meta: [
      ["Die No.", val(d.die_number)],
      ["Status", label(d.die_status)],
      ["Profile", data.profile?.profile_code ?? null],
      ["Prepared by", data.generatedBy],
      ["Date", pdfDate(new Date())]
    ],
    footerNote: "Technical record generated from captured die data. Values marked Not Captured were not recorded.",
    subject: `Die technical sheet ${d.die_number ?? ""}`.trim()
  }, data.loadFont ?? nodeFontLoader, data);

  const section = (title: string, fields: PdfField[]) => {
    doc.sectionTitle(title, 40);
    doc.fields(fields, { columns: 2, blank: NOT_CAPTURED });
  };

  section("Die identity", [
    ["Die number", val(d.die_number)], ["Die code", val(d.die_code)],
    ["Status", label(d.die_status)], ["Type", label(d.die_type)],
    ["Ownership", label(d.ownership_type)], ["Cavities", num(d.number_of_cavities, 0)],
    ["Profile", data.profile ? [data.profile.profile_code, data.profile.profile_name].filter(Boolean).join(" · ") || NOT_CAPTURED : NOT_CAPTURED],
    ["Section weight", num(data.profile?.section_weight_kg_per_m, 3, "kg/m")],
    ["Customer", data.customer?.company_name || data.customer?.customer_name || "Company owned"], ["Priority", label(d.priority_level)]
  ]);

  section("Geometry and design", [
    ["Die diameter", num(d.die_diameter_mm, 2, "mm")], ["Die thickness", num(d.die_thickness_mm, 2, "mm")],
    ["Bearing length", num(d.bearing_length_mm, 2, "mm")], ["Extrusion ratio", num(d.extrusion_ratio, 2)],
    ["CCD", num(d.ccd_mm, 2, "mm")], ["Tongue ratio", num(d.tongue_ratio, 2)],
    ["Output per stroke", num(d.output_per_stroke_kg, 3, "kg")]
  ]);

  section("Material and manufacturing", [
    ["Steel grade", val(d.die_steel_grade)], ["Manufacturer", val(d.die_manufacturer)],
    ["Die cost", toNumber(d.die_cost) === null ? NOT_CAPTURED : `INR ${pdfAmount(d.die_cost)}`], ["Hardness (HRC)", num(d.hrc_value, 1)],
    ["Hardness (HV)", num(d.hv_value, 0)], ["Heat treatment", label(d.heat_treatment_status)]
  ]);

  section("Performance", [
    ["Total production", toNumber(d.total_production_kg) === null ? NOT_CAPTURED : pdfQuantity(d.total_production_kg, 3, "kg")], ["Total runs", num(d.total_runs, 0)],
    ["Average recovery", pdfPercent(d.average_recovery_percent, 2, NOT_CAPTURED)], ["Performance grade", val(d.performance_grade)],
    ["Last used", d.last_used_date ? pdfDate(d.last_used_date) : NOT_CAPTURED]
  ]);

  doc.sectionTitle("Trial history", 50);
  doc.table([
    { header: "Date", width: 11 }, { header: "Result", width: 10 }, { header: "Output quality", width: 11 }, { header: "Dimensional", width: 13 },
    { header: "Surface", width: 11 }, { header: "Correction", width: 9 }, { header: "Remarks", width: 35 }
  ], data.trials.map((trial) => [
    pdfDate(trial.trial_date), pdfLabel(trial.trial_result), pdfLabel(trial.output_quality), pdfLabel(trial.dimensional_status),
    pdfLabel(trial.surface_status), pdfYesNo(trial.correction_required), trial.remarks
  ]), { emptyText: "No die trials recorded." });

  doc.sectionTitle("Correction history", 50);
  doc.table([
    { header: "Date", width: 11 }, { header: "Reason", width: 15 }, { header: "Vendor", width: 18 },
    { header: "Cost (INR)", width: 12, align: "right" }, { header: "Result", width: 10 }, { header: "Notes", width: 34 }
  ], data.corrections.map((correction) => [
    pdfDate(correction.correction_date), pdfLabel(correction.correction_reason), correction.correction_vendor,
    pdfAmount(correction.cost), pdfLabel(correction.result_status), correction.notes
  ]), { emptyText: "No die corrections recorded." });

  doc.sectionTitle("Nitriding history", 50);
  doc.table([
    { header: "Cycle", width: 6, align: "right" }, { header: "Date", width: 11 }, { header: "Vendor", width: 15 }, { header: "Process", width: 11 },
    { header: "Temp (°C)", width: 8, align: "right" }, { header: "Duration (h)", width: 9, align: "right" }, { header: "Case depth (mm)", width: 10, align: "right" },
    { header: "Surface hardness", width: 9, align: "right" }, { header: "Next due", width: 11 }, { header: "Status", width: 10 }
  ], data.nitridings.map((cycle) => [
    pdfNumber(cycle.nitriding_cycle_number, 0), pdfDate(cycle.nitriding_date), cycle.nitriding_vendor, pdfLabel(cycle.nitriding_process_type),
    pdfNumber(cycle.nitriding_temperature_c, 1), pdfNumber(cycle.nitriding_duration_hours, 1), pdfQuantity(cycle.case_depth_mm, 3),
    pdfNumber(cycle.surface_hardness, 1), pdfDate(cycle.next_nitriding_due_date), pdfLabel(cycle.status)
  ]), { emptyText: "No nitriding cycles recorded." });

  doc.space(6);
  doc.signatures(["Prepared by", "Die shop in-charge", "Approved by"]);
  return doc.finish();
}
