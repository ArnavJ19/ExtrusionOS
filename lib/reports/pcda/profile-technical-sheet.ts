/**
 * Profile Technical Sheet Report Generator
 *
 * Generates a PDF technical sheet for a profile/section on the shared document engine.
 * All data comes from real persisted records — no fabricated values.
 */

import { PdfDocumentWriter, type PdfField } from "../../pdf/document-kit.ts";
import { nodeFontLoader } from "../../pdf/font-loader-node.ts";
import { pdfDate, pdfLabel, pdfNumber, pdfPercent, toNumber } from "../../pdf/format.ts";
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

function allowed(v: unknown): string {
  if (v === null || v === undefined) return NOT_CAPTURED;
  return v ? "Allowed" : "Not allowed";
}

export type ProfileReportData = {
  company: { name: string; gst_number?: string };
  profile: Record<string, any>;
  primaryDie?: { die_number?: string; die_status?: string } | null;
  backupDie?: { die_number?: string; die_status?: string } | null;
  generatedBy: string;
  loadFont?: PdfFontLoader;
};

export async function buildProfileTechnicalSheetPdf(data: ProfileReportData): Promise<Uint8Array> {
  const p = data.profile;
  const doc = await PdfDocumentWriter.create({
    title: "PROFILE TECHNICAL SHEET",
    number: p.profile_code ?? null,
    issuer: { name: data.company.name, lines: [data.company.gst_number ? `GSTIN: ${data.company.gst_number}` : null] },
    meta: [
      ["Profile code", val(p.profile_code)],
      ["Section No.", p.section_number ?? null],
      ["Approval", label(p.approval_status)],
      ["Prepared by", data.generatedBy],
      ["Date", pdfDate(new Date())]
    ],
    footerNote: "Technical record generated from captured profile data. Values marked Not Captured were not recorded.",
    subject: `Profile technical sheet ${p.profile_code ?? ""}`.trim()
  }, data.loadFont ?? nodeFontLoader, data);

  const section = (title: string, fields: PdfField[]) => {
    doc.sectionTitle(title, 40);
    doc.fields(fields, { columns: 2, blank: NOT_CAPTURED });
  };
  const die = (entry?: { die_number?: string; die_status?: string } | null) =>
    entry?.die_number ? `${entry.die_number}${entry.die_status ? ` (${pdfLabel(entry.die_status)})` : ""}` : NOT_CAPTURED;

  section("Profile identity", [
    ["Profile code", val(p.profile_code)], ["Profile name", val(p.profile_name)],
    ["Section number", val(p.section_number)], ["Application", label(p.application_category)],
    ["System type", label(p.system_type)], ["Classification", label(p.profile_classification)],
    ["Complexity", label(p.complexity_rating)], ["Approval status", label(p.approval_status)]
  ]);

  section("Weight and geometry", [
    ["Weight, theoretical", num(p.section_weight_kg_per_m, 3, "kg/m")], ["Weight, actual", num(p.actual_weight_kg_per_m, 3, "kg/m")],
    ["Weight tolerance", pdfPercent(p.weight_tolerance_percent, 2, NOT_CAPTURED)], ["CCD", num(p.circumscribing_circle_diameter_mm, 2, "mm")],
    ["Nominal wall", num(p.nominal_wall_thickness_mm, 2, "mm")], ["Minimum wall", num(p.min_wall_thickness_mm, 2, "mm")],
    ["Maximum wall", num(p.max_wall_thickness_mm, 2, "mm")], ["Voids", num(p.number_of_voids, 0)],
    ["Standard length", num(p.standard_length_m, 3, "m")]
  ]);

  section("Alloy and mechanical properties", [
    ["Alloy", val(p.alloy)], ["Temper", val(p.temper)],
    ["Tensile strength", num(p.tensile_strength_mpa, 1, "MPa")], ["Yield strength", num(p.yield_strength_mpa, 1, "MPa")],
    ["Elongation", pdfPercent(p.elongation_percent, 2, NOT_CAPTURED)]
  ]);

  section("Production parameters", [
    ["Recommended press", val(p.recommended_press)], ["Billet alloy", val(p.billet_alloy)],
    ["Billet temperature", val(p.billet_temperature_range)], ["Ram speed", val(p.ram_speed_range)],
    ["Exit temperature", val(p.exit_temperature_range)], ["Quench method", label(p.quench_method)],
    ["Recovery target", pdfPercent(p.recovery_target_percent, 2, NOT_CAPTURED)], ["Minimum recovery", pdfPercent(p.min_acceptable_recovery_percent, 2, NOT_CAPTURED)],
    ["Scrap factor", pdfPercent(p.scrap_factor_percent, 2, NOT_CAPTURED)]
  ]);

  section("Die linkage", [["Primary die", die(data.primaryDie)], ["Backup die", die(data.backupDie)]]);

  section("Surface treatment", [
    ["Mill finish", allowed(p.mill_finish_allowed)], ["Powder coating", allowed(p.powder_coating_allowed)],
    ["Anodizing", allowed(p.anodizing_allowed)], ["Coating thickness", num(p.coating_thickness_microns, 1, "µm")],
    ["Anodizing thickness", num(p.anodizing_micron_requirement, 1, "µm")]
  ]);

  doc.space(6);
  doc.signatures(["Prepared by", "Quality / technical", "Approved by"]);
  return doc.finish();
}
