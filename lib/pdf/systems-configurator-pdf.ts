import { PDFDocument, StandardFonts, rgb } from "pdf-lib/cjs";
import { getSystemOutputStatus } from "@/lib/systems-configurator/output-status";
import { labelize } from "@/types/app";

export type SystemReportType = "customer_quote" | "cutting_list" | "glass_list" | "hardware_bom" | "internal_costing" | "production_sheet" | "optimization_report";

type ReportData = {
  company: any;
  settings: any;
  configuration: any;
  profileCuts: any[];
  glassCuts: any[];
  beadingCuts: any[];
  hardwareBom: any[];
  materialSummary: any[];
  optimizationRun?: any;
  reportType: SystemReportType;
  canShowInternalCost: boolean;
};

const charcoal = rgb(0.07, 0.09, 0.13);
const orange = rgb(0.98, 0.45, 0.09);
const silver = rgb(0.9, 0.91, 0.93);
const pale = rgb(0.965, 0.97, 0.98);
const white = rgb(1, 1, 1);

function sanitizeText(text: unknown) {
  return String(text ?? "-")
    .replace(/\u20B9/g, "Rs. ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u202F\u200B]/g, " ")
    .replace(/[^\x00-\xFF]/g, "");
}

function money(value: unknown) {
  return `Rs. ${Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function number(value: unknown, digits = 2) {
  return Number(value ?? 0).toFixed(digits);
}

function titleFor(type: SystemReportType) {
  const titles: Record<SystemReportType, string> = {
    customer_quote: "Customer Quote",
    cutting_list: "Cutting List",
    glass_list: "Glass List",
    hardware_bom: "Hardware BOM",
    internal_costing: "Internal Costing",
    production_sheet: "Production Sheet",
    optimization_report: "Profile Optimization"
  };
  return titles[type];
}

export async function buildSystemConfiguratorPdf(data: ReportData) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 795;

  function newPage(subtitle = titleFor(data.reportType)) {
    page = pdf.addPage([595.28, 841.89]);
    y = 795;
    page.drawRectangle({ x: 0, y: 0, width: 16, height: 841.89, color: orange });
    page.drawText(sanitizeText(data.company.name ?? "Company"), { x: 40, y, size: 13, font: bold, color: charcoal });
    page.drawText(sanitizeText(subtitle), { x: 375, y, size: 10, font: bold, color: orange });
    y -= 28;
  }

  function ensureSpace(height = 70) {
    if (y < height) newPage();
  }

  function drawHeader() {
    page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: white });
    page.drawRectangle({ x: 0, y: 0, width: 16, height: 841.89, color: orange });
    page.drawRectangle({ x: 32, y: 742, width: 531, height: 76, color: charcoal });
    page.drawRectangle({ x: 44, y: 766, width: 32, height: 32, color: orange });
    page.drawText("EO", { x: 52, y: 777, size: 11, font: bold, color: white });
    page.drawText("SYSTEMBUILDER PRO", { x: 88, y: 790, size: 9, font: bold, color: silver });
    page.drawText(sanitizeText(titleFor(data.reportType)), { x: 88, y: 772, size: 18, font: bold, color: white });
    page.drawText(sanitizeText(data.configuration.configuration_number ?? "DRAFT"), { x: 405, y: 779, size: 16, font: bold, color: orange });
    y = 718;
  }

  function text(value: unknown, x: number, size = 9, font = regular, color = charcoal, maxWidth = 500) {
    page.drawText(sanitizeText(value), { x, y, size, font, color, maxWidth });
  }

  function section(title: string) {
    ensureSpace(90);
    page.drawRectangle({ x: 40, y: y - 5, width: 515, height: 22, color: pale });
    page.drawRectangle({ x: 40, y: y - 5, width: 5, height: 22, color: orange });
    page.drawText(sanitizeText(title), { x: 52, y: y + 1, size: 10, font: bold, color: charcoal });
    y -= 30;
  }

  function drawProjectSummary() {
    page.drawText(sanitizeText(data.company.name ?? "Company"), { x: 40, y, size: 18, font: bold, color: charcoal });
    page.drawText(`Generated: ${new Date().toLocaleDateString("en-IN")}`, { x: 420, y, size: 9, font: regular, color: charcoal });
    y -= 15;
    text(`${data.company.billing_address ?? ""} ${data.company.city ?? ""} ${data.company.state ?? ""}`, 40, 8);
    y -= 12;
    text(`GSTIN: ${data.company.gst_number ?? "-"} | ${data.company.phone ?? ""} ${data.company.email ?? ""}`, 40, 8);
    y -= 24;
    section("Configuration Summary");
    const c = data.configuration;
    const customer = c.customers ?? {};
    const rows = [
      ["Project", c.project_name], ["Customer", customer.company_name ?? customer.customer_name ?? "Walk-in"],
      ["Design Ref", c.design_reference], ["System", labelize(c.system_type ?? "custom")],
      ["Series", c.system_series?.series_code ?? "-"], ["Size", `${c.width_mm} x ${c.height_mm} mm`],
      ["Quantity", c.quantity], ["Finish", c.finish_options?.finish_name ?? "TBD"],
      ["Glass", c.glass_items?.glass_name ?? "TBD"], ["Location", c.location_label ?? "-"]
    ];
    for (let index = 0; index < rows.length; index += 2) {
      const left = rows[index];
      const right = rows[index + 1];
      page.drawText(`${left[0]}:`, { x: 48, y, size: 8, font: bold, color: charcoal });
      page.drawText(sanitizeText(left[1]), { x: 115, y, size: 8, font: regular, color: charcoal, maxWidth: 155 });
      if (right) {
        page.drawText(`${right[0]}:`, { x: 315, y, size: 8, font: bold, color: charcoal });
        page.drawText(sanitizeText(right[1]), { x: 382, y, size: 8, font: regular, color: charcoal, maxWidth: 155 });
      }
      y -= 14;
    }
    y -= 12;
  }

  function drawElevation() {
    section("Elevation");
    const x = 95;
    const top = y - 10;
    const w = 390;
    const h = 175;
    const panels = Array.isArray(data.configuration.panel_layout_json?.panels) ? data.configuration.panel_layout_json.panels : [];
    const panelCount = Math.max(1, panels.length || Number(data.configuration.no_of_panels ?? 1));
    page.drawRectangle({ x, y: top - h, width: w, height: h, color: rgb(0.86, 0.93, 1), borderColor: charcoal, borderWidth: 5 });
    for (let i = 1; i < panelCount; i += 1) page.drawLine({ start: { x: x + (w / panelCount) * i, y: top }, end: { x: x + (w / panelCount) * i, y: top - h }, thickness: 3, color: charcoal });
    for (let i = 0; i < panelCount; i += 1) page.drawText(`P${i + 1}`, { x: x + (w / panelCount) * i + w / panelCount / 2 - 8, y: top - h / 2, size: 11, font: bold, color: charcoal });
    page.drawText(`${data.configuration.width_mm} mm`, { x: x + w / 2 - 28, y: top - h - 18, size: 9, font: bold, color: charcoal });
    page.drawText(`${data.configuration.height_mm} mm`, { x: x + w + 12, y: top - h / 2, size: 9, font: bold, color: charcoal });
    y = top - h - 40;
  }

  function table(headers: string[], rows: unknown[][], widths: number[]) {
    const xs = widths.reduce<number[]>((acc, width, index) => [...acc, (acc[index - 1] ?? 40) + (index === 0 ? 0 : widths[index - 1])], []);
    ensureSpace(90);
    page.drawRectangle({ x: 40, y: y - 5, width: 515, height: 20, color: pale });
    headers.forEach((header, index) => page.drawText(sanitizeText(header), { x: xs[index] + 3, y, size: 7, font: bold, color: charcoal, maxWidth: widths[index] - 6 }));
    y -= 18;
    rows.forEach((row, rowIndex) => {
      ensureSpace(55);
      if (rowIndex % 2 === 0) page.drawRectangle({ x: 40, y: y - 5, width: 515, height: 18, color: rgb(0.985, 0.986, 0.988) });
      row.forEach((cell, index) => page.drawText(sanitizeText(cell), { x: xs[index] + 3, y, size: 7, font: regular, color: charcoal, maxWidth: widths[index] - 6 }));
      y -= 18;
    });
    y -= 10;
  }

  function drawCustomerQuote() {
    drawProjectSummary();
    drawElevation();
    section("Commercial Summary");
    const c = data.configuration;
    const rows = [["Subtotal", money(c.subtotal)], [`GST @ ${c.gst_percent}%`, money(c.gst_amount)], ["Grand Total", money(c.grand_total)]];
    rows.forEach(([label, value], index) => {
      page.drawRectangle({ x: 350, y: y - 4, width: 205, height: 22, color: index === 2 ? charcoal : pale });
      if (index === 2) page.drawRectangle({ x: 350, y: y - 4, width: 5, height: 22, color: orange });
      page.drawText(label, { x: 360, y: y + 2, size: 9, font: bold, color: index === 2 ? white : charcoal });
      page.drawText(value, { x: 460, y: y + 2, size: 9, font: bold, color: index === 2 ? white : charcoal });
      y -= 24;
    });
    y -= 12;
    text(data.settings?.default_terms_and_conditions ?? data.settings?.default_quote_terms ?? "Prices are subject to final site measurement, taxes, and approved specifications.", 40, 8, regular, charcoal, 500);
  }

  function drawCuttingList() {
    drawProjectSummary();
    section("Profile Cutting List");
    table(["Profile", "Component", "Cut", "Qty", "Total m", "Kg/m", "Weight", "Rule"], data.profileCuts.map((cut) => [cut.profile_code, labelize(cut.component_role), cut.cut_length_mm, cut.quantity, cut.total_length_m, cut.section_weight_kg_per_m, cut.total_weight_kg, cut.remarks ?? `${cut.angle_left ?? "90"}/${cut.angle_right ?? "90"}`]), [60, 105, 45, 35, 55, 45, 50, 120]);
  }

  function drawGlassList() {
    drawProjectSummary();
    section("Glass Cutting List");
    table(["Panel", "Type", "Width", "Height", "Qty", "Sqft", "Rule"], data.glassCuts.map((cut) => [cut.glass_label, labelize(cut.glass_type ?? "glass"), cut.width_mm, cut.height_mm, cut.quantity, cut.area_sqft, cut.remarks ?? "Panel size minus glass deductions"]), [55, 88, 55, 55, 35, 55, 172]);
    if (data.beadingCuts.length) {
      section("Beading Cuts");
      table(["Panel", "Position", "Cut", "Qty", "Total m", "Profile"], data.beadingCuts.map((cut) => [`P${cut.panel_index}`, labelize(cut.bead_position), cut.cut_length_mm, cut.quantity, cut.total_length_m, cut.remarks ?? "Beading"]), [55, 90, 55, 40, 65, 210]);
    }
  }

  function drawHardwareBom() {
    drawProjectSummary();
    section("Hardware BOM");
    table(["Code", "Item", "Category", "Qty", "Unit", "Rule"], data.hardwareBom.map((item) => [item.item_code, item.item_name, labelize(item.hardware_category), item.quantity, item.unit, item.remarks ?? "Default system hardware rule"]), [55, 120, 85, 45, 35, 175]);
  }

  function drawInternalCosting() {
    drawProjectSummary();
    section("Internal Material Summary");
    table(["Type", "Item", "Qty", "Unit", "Weight", "Amount"], data.materialSummary.map((item) => [labelize(item.material_type), item.item_name, item.quantity, item.unit, item.total_weight_kg, money(item.amount)]), [85, 155, 60, 45, 65, 95]);
    section("Internal Cost Summary");
    table(["Metric", "Value"], [["Internal Cost", money(data.configuration.internal_cost)], ["Margin %", `${number(data.configuration.margin_percent)}%`], ["Subtotal", money(data.configuration.subtotal)], ["GST", money(data.configuration.gst_amount)], ["Selling Price", money(data.configuration.selling_price)]], [180, 180]);
  }

  function drawProductionSheet() {
    drawProjectSummary();
    drawElevation();
    const outputStatus = getSystemOutputStatus({ profileCuts: data.profileCuts.length, glassCuts: data.glassCuts.length, beadingCuts: data.beadingCuts.length, hardwareBom: data.hardwareBom.length, optimizationRuns: data.optimizationRun ? 1 : 0 });
    section("Production Status");
    table(["Metric", "Value"], [["Production readiness", outputStatus.productionReady ? "Ready" : "Pending"], ["Completed outputs", outputStatus.completedOutputs.join(", ") || "-"], ["Missing outputs", outputStatus.missingOutputs.join(", ") || "-"], ["Optimization", outputStatus.optimizationReady ? "Ready" : "Pending"]], [150, 315]);
    section("Production Checklist");
    table(["Output", "Rows", "Status"], [["Profile cuts", data.profileCuts.length, data.profileCuts.length ? "Ready" : "Pending"], ["Glass cuts", data.glassCuts.length, data.glassCuts.length ? "Ready" : "Pending"], ["Beading cuts", data.beadingCuts.length, data.beadingCuts.length ? "Ready" : "Pending"], ["Hardware BOM", data.hardwareBom.length, data.hardwareBom.length ? "Ready" : "Pending"]], [140, 70, 120]);
    section("Top Cutting Items");
    table(["Profile", "Component", "Cut mm", "Qty"], data.profileCuts.slice(0, 12).map((cut) => [cut.profile_code, labelize(cut.component_role), cut.cut_length_mm, cut.quantity]), [90, 170, 80, 60]);
    if (data.glassCuts.length) {
      section("Top Glass Items");
      table(["Panel", "Width", "Height", "Qty", "Rule"], data.glassCuts.slice(0, 8).map((cut) => [cut.glass_label, cut.width_mm, cut.height_mm, cut.quantity, cut.remarks ?? "Glass sizing rule"]), [75, 60, 60, 40, 240]);
    }
    if (data.hardwareBom.length) {
      section("Top Hardware Items");
      table(["Item", "Category", "Qty", "Unit", "Rule"], data.hardwareBom.slice(0, 8).map((item) => [item.item_name, labelize(item.hardware_category), item.quantity, item.unit, item.remarks ?? "Hardware rule"]), [130, 85, 45, 35, 220]);
    }
  }

  function drawOptimizationReport() {
    drawProjectSummary();
    const run = data.optimizationRun ?? {};
    const output = run.optimized_output_json ?? {};
    const profiles = Array.isArray(output.profiles) ? output.profiles : [];
    section("Optimization Summary");
    table(["Metric", "Value"], [["Run", run.run_number ? `#${run.run_number}` : "-"], ["Stock length", `${run.stock_length_mm ?? output.stockLengthMm ?? "-"} mm`], ["Stock bars", run.total_stock_bars ?? output.totalStockBars ?? 0], ["Used length", `${run.total_used_length_mm ?? output.totalUsedLengthMm ?? 0} mm`], ["Waste", `${run.total_waste_mm ?? output.totalWasteMm ?? 0} mm`], ["Waste %", `${run.waste_percent ?? output.wastePercent ?? 0}%`]], [180, 180]);
    section("Profile Bar Allocation");
    for (const profile of profiles) {
      ensureSpace(120);
      page.drawText(`${profile.profileCode} - ${profile.profileName}`, { x: 40, y, size: 10, font: bold, color: orange, maxWidth: 500 });
      y -= 14;
      table(["Bar", "Cuts", "Used", "Waste", "Reusable"], (profile.bars ?? []).map((bar: any) => [bar.barNumber, (bar.cuts ?? []).map((cut: any) => `${cut.cutLengthMm}`).join(" + "), `${bar.usedLengthMm} mm`, `${bar.wasteMm} mm`, bar.reusableLeftoverMm ? `${bar.reusableLeftoverMm} mm` : "-"]), [45, 235, 70, 70, 80]);
    }
  }

  drawHeader();
  if (data.reportType === "customer_quote") drawCustomerQuote();
  if (data.reportType === "cutting_list") drawCuttingList();
  if (data.reportType === "glass_list") drawGlassList();
  if (data.reportType === "hardware_bom") drawHardwareBom();
  if (data.reportType === "internal_costing") {
    if (!data.canShowInternalCost) throw new Error("Internal costing report is restricted");
    drawInternalCosting();
  }
  if (data.reportType === "production_sheet") drawProductionSheet();
  if (data.reportType === "optimization_report") drawOptimizationReport();

  page.drawLine({ start: { x: 40, y: 28 }, end: { x: 555, y: 28 }, thickness: 1.2, color: orange });
  page.drawText("Generated by ExtrusionOS Pro - Aluminium Systems Configurator", { x: 40, y: 13, size: 8, font: regular, color: charcoal });

  return pdf.save();
}
