/**
 * Profile Technical Sheet Report Generator
 * 
 * Generates a PDF technical sheet for a profile/section using pdf-lib.
 * All data comes from real persisted records — no fabricated values.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib/cjs";

const ORANGE = rgb(0.98, 0.45, 0.09);
const DARK = rgb(0.07, 0.09, 0.13);
const TEXT = rgb(0.07, 0.09, 0.13);
const LIGHT_GRAY = rgb(0.96, 0.97, 0.98);
const WHITE = rgb(1, 1, 1);
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;

function val(v: any, suffix = ""): string {
  if (v === null || v === undefined || v === "") return "Not Captured";
  return `${v}${suffix}`;
}

export type ProfileReportData = {
  company: { name: string; gst_number?: string };
  profile: Record<string, any>;
  primaryDie?: { die_number?: string; die_status?: string } | null;
  backupDie?: { die_number?: string; die_status?: string } | null;
  generatedBy: string;
};

export async function buildProfileTechnicalSheetPdf(data: ProfileReportData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = null!;
  let y: number = 0;

  function addPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    page.drawRectangle({ x: 0, y: 0, width: 14, height: PAGE_HEIGHT, color: ORANGE });
  }

  function text(str: string, x: number, yPos: number, font: PDFFont, size: number, color = TEXT) {
    const safe = (str || "Not Captured").replace(/[^\x00-\xFF]/g, "");
    page.drawText(safe, { x, y: yPos, font, size, color });
  }

  function sectionHeader(title: string) {
    y -= 25;
    if (y < 80) addPage();
    page.drawRectangle({ x: MARGIN, y: y - 2, width: PAGE_WIDTH - MARGIN * 2, height: 18, color: LIGHT_GRAY });
    text(title, MARGIN + 8, y + 2, bold, 10, ORANGE);
    y -= 18;
  }

  function row(label: string, value: string) {
    if (y < 60) addPage();
    y -= 14;
    text(label, MARGIN + 8, y, regular, 8, rgb(0.4, 0.4, 0.4));
    text(value, MARGIN + 200, y, bold, 8);
  }

  addPage();

  // Header banner
  const bannerH = 50;
  page.drawRectangle({ x: MARGIN - 10, y: y - bannerH, width: PAGE_WIDTH - MARGIN + 10, height: bannerH, color: DARK });
  text("PROFILE TECHNICAL SHEET", MARGIN + 5, y - 32, bold, 16, WHITE);
  text(data.company.name, PAGE_WIDTH - MARGIN - 5 - bold.widthOfTextAtSize(data.company.name, 10), y - 32, bold, 10, ORANGE);
  y -= bannerH + 10;

  const p = data.profile;

  // Identity
  sectionHeader("Profile Identity");
  row("Profile Code", val(p.profile_code));
  row("Profile Name", val(p.profile_name));
  row("Section Number", val(p.section_number));
  row("Application", val(p.application_category));
  row("System Type", val(p.system_type));
  row("Classification", val(p.profile_classification));
  row("Complexity", val(p.complexity_rating));
  row("Approval Status", val(p.approval_status));

  // Weight & Geometry
  sectionHeader("Weight & Geometry");
  row("Weight kg/m (theoretical)", val(p.section_weight_kg_per_m, " kg/m"));
  row("Weight kg/m (actual)", val(p.actual_weight_kg_per_m, " kg/m"));
  row("Weight Tolerance", val(p.weight_tolerance_percent, "%"));
  row("CCD", val(p.circumscribing_circle_diameter_mm, " mm"));
  row("Nominal Wall", val(p.nominal_wall_thickness_mm, " mm"));
  row("Min Wall", val(p.min_wall_thickness_mm, " mm"));
  row("Max Wall", val(p.max_wall_thickness_mm, " mm"));
  row("Voids", val(p.number_of_voids));
  row("Standard Length", val(p.standard_length_m, " m"));

  // Alloy
  sectionHeader("Alloy & Mechanical");
  row("Alloy", val(p.alloy));
  row("Temper", val(p.temper));
  row("Tensile Strength", val(p.tensile_strength_mpa, " MPa"));
  row("Yield Strength", val(p.yield_strength_mpa, " MPa"));
  row("Elongation", val(p.elongation_percent, "%"));

  // Production
  sectionHeader("Production Parameters");
  row("Recommended Press", val(p.recommended_press));
  row("Billet Alloy", val(p.billet_alloy));
  row("Billet Temp Range", val(p.billet_temperature_range));
  row("Ram Speed Range", val(p.ram_speed_range));
  row("Exit Temp Range", val(p.exit_temperature_range));
  row("Quench Method", val(p.quench_method));
  row("Recovery Target", val(p.recovery_target_percent, "%"));
  row("Min Recovery", val(p.min_acceptable_recovery_percent, "%"));
  row("Scrap Factor", val(p.scrap_factor_percent, "%"));

  // Die linkage
  sectionHeader("Die Linkage");
  row("Primary Die", data.primaryDie ? `${data.primaryDie.die_number} (${data.primaryDie.die_status})` : "Not Captured");
  row("Backup Die", data.backupDie ? `${data.backupDie.die_number} (${data.backupDie.die_status})` : "Not Captured");

  // Surface
  sectionHeader("Surface Treatment");
  row("Mill Finish", p.mill_finish_allowed ? "Allowed" : "Not Allowed");
  row("Powder Coating", p.powder_coating_allowed ? "Allowed" : "Not Allowed");
  row("Anodizing", p.anodizing_allowed ? "Allowed" : "Not Allowed");
  row("Coating Thickness", val(p.coating_thickness_microns, " µm"));
  row("Anodizing Microns", val(p.anodizing_micron_requirement, " µm"));

  // Footer
  text(`Generated by ${data.generatedBy} on ${new Date().toLocaleDateString("en-IN")}`, MARGIN, 25, regular, 7, rgb(0.5, 0.5, 0.5));
  text("ExtrusionOS Profile Technical Sheet", PAGE_WIDTH - MARGIN - 180, 25, regular, 7, rgb(0.5, 0.5, 0.5));

  return pdf.save();
}
