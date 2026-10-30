import { getSystemOutputStatus } from "../systems-configurator/output-status.ts";
import { nodeFontLoader } from "./font-loader-node.ts";
import { type PdfFontLoader } from "./unicode-text.ts";
import { PDF_COLORS, PdfDocumentWriter, type PdfTableRow } from "./document-kit.ts";
import { issuerName, joinParts, legalNameLine, pdfAmount, pdfDate, pdfInteger, pdfLabel, pdfMoney, pdfNumber, pdfPercent, pdfQuantity, pdfText, toNumber } from "./format.ts";

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
  releaseEvidence?: { status: string; snapshotId: string | null; reasons: string[] };
  loadFont?: PdfFontLoader;
  logo?: Uint8Array | null;
};

const TITLES: Record<SystemReportType, string> = {
  customer_quote: "SYSTEM QUOTATION",
  cutting_list: "PROFILE CUTTING LIST",
  glass_list: "GLASS CUTTING LIST",
  hardware_bom: "HARDWARE BOM",
  internal_costing: "INTERNAL COSTING",
  production_sheet: "PRODUCTION SHEET",
  optimization_report: "PROFILE OPTIMISATION"
};

const mm = (value: unknown) => pdfNumber(value, 1);
/** Fixed 0.1 mm precision for cut-list columns so figures align on the decimal. */
const mmCut = (value: unknown) => pdfQuantity(value, 1);
const angle = (value: unknown) => (toNumber(value) === null ? "90°" : `${pdfNumber(value, 1)}°`);
const sum = (rows: any[], key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

export async function buildSystemConfiguratorPdf(data: ReportData) {
  if (data.reportType === "internal_costing" && !data.canShowInternalCost) throw new Error("Internal costing report is restricted");
  const c = data.configuration;
  const customer = c.customers ?? {};
  const customerName = customer.company_name ?? customer.customer_name ?? "Walk-in customer";
  const company = data.company ?? {};
  const technicalSheet = ["cutting_list", "glass_list", "hardware_bom", "production_sheet", "optimization_report"].includes(data.reportType);
  const released = data.releaseEvidence?.status === "approved" || data.releaseEvidence?.status === "handed_off";

  const doc = await PdfDocumentWriter.create({
    title: TITLES[data.reportType],
    number: c.configuration_number ?? "DRAFT",
    logo: data.logo ?? null,
    issuer: {
      name: issuerName(company),
      lines: [
        // The customer quotation carries the trading name only; internal sheets add the legal name.
        data.reportType === "customer_quote" ? null : legalNameLine(company),
        joinParts([company.billing_address, company.city, company.state, company.pincode]),
        company.gst_number ? `GSTIN: ${company.gst_number}` : null,
        joinParts([company.phone, company.email], "   ·   ")
      ]
    },
    meta: [
      ["Configuration No.", c.configuration_number ?? "Draft"],
      ["Project", c.project_name],
      ["Customer", customerName],
      ["Date", pdfDate(new Date())]
    ],
    stamp: technicalSheet && !released ? { text: "Draft - not fabrication released", tone: "warning" }
      : data.reportType === "internal_costing" ? { text: "Internal — confidential", tone: "void" } : c.configuration_number ? null : { text: "Draft", tone: "warning" },
    subject: `${TITLES[data.reportType]} ${c.configuration_number ?? ""}`.trim()
  }, data.loadFont ?? nodeFontLoader, [data.company, data.configuration, data.profileCuts, data.glassCuts, data.beadingCuts, data.hardwareBom, data.materialSummary, data.optimizationRun]);

  if (technicalSheet) {
    doc.sectionTitle("Fabrication release", 40);
    doc.fields([["Release status", released ? "Approved current output" : "Draft - do not use for fabrication"],
      ["Captured snapshot", data.releaseEvidence?.snapshotId ?? "No captured snapshot"],
      ["Required review", data.releaseEvidence?.reasons.join(" ") || (released ? "Independent approval recorded" : "Calculate and independently approve the current inputs and output.")]], { columns: 1 });
  }

  const summary = () => {
    doc.sectionTitle("Configuration", 40);
    doc.fields([
      ["Project", c.project_name], ["Customer", customerName],
      ["Design reference", c.design_reference], ["System type", pdfLabel(c.system_type ?? "custom")],
      ["Series", c.system_series ? joinParts([c.system_series.series_code, c.system_series.series_name], " · ") : null], ["Opening size (W × H)", `${mm(c.width_mm)} × ${mm(c.height_mm)} mm`],
      ["Quantity", pdfInteger(c.quantity)], ["Panels", pdfInteger(c.no_of_panels ?? panelsOf(c).length)],
      ["Finish", c.finish_options?.finish_name ?? "To be confirmed"], ["Glass", c.glass_items?.glass_name ?? "To be confirmed"],
      ["Location / mark", c.location_label]
    ], { columns: 2 });
  };

  const elevation = () => {
    doc.sectionTitle("Elevation (viewed from outside)", 200);
    drawElevation(doc, c);
  };

  const cuttingList = (rows = data.profileCuts) => {
    const body: PdfTableRow[] = rows.map((cut) => [
      cut.profile_code, pdfLabel(cut.component_role), mmCut(cut.cut_length_mm), `${angle(cut.angle_left)} / ${angle(cut.angle_right)}`,
      pdfInteger(cut.quantity), pdfQuantity(cut.total_length_m, 3), pdfQuantity(cut.section_weight_kg_per_m, 3), pdfQuantity(cut.total_weight_kg, 3), cut.remarks
    ]);
    if (rows.length) body.push({ kind: "total", cells: ["Total", "", "", "", pdfInteger(sum(rows, "quantity")), pdfQuantity(sum(rows, "total_length_m"), 3), "", pdfQuantity(sum(rows, "total_weight_kg"), 3), ""] });
    doc.table([
      { header: "Profile", width: 10 }, { header: "Component", width: 17 }, { header: "Cut length (mm)", width: 9, align: "right" },
      { header: "Angle L/R", width: 9, align: "center", wrap: false }, { header: "Qty (pcs)", width: 6, align: "right" }, { header: "Total length (m)", width: 9, align: "right" },
      { header: "Section wt (kg/m)", width: 9, align: "right" }, { header: "Weight (kg)", width: 9, align: "right" }, { header: "Remarks", width: 22 }
    ], body, { emptyText: "Cutting list has not been generated for this configuration." });
  };

  const glassList = (rows = data.glassCuts) => {
    const body: PdfTableRow[] = rows.map((cut) => [
      cut.glass_label, pdfLabel(cut.glass_type ?? "glass"), mmCut(cut.width_mm), mmCut(cut.height_mm), pdfInteger(cut.quantity), pdfQuantity(cut.area_sqft, 2), cut.remarks
    ]);
    if (rows.length) body.push({ kind: "total", cells: ["Total", "", "", "", pdfInteger(sum(rows, "quantity")), pdfQuantity(sum(rows, "area_sqft"), 2), ""] });
    doc.table([
      { header: "Panel", width: 10 }, { header: "Glass type", width: 18 }, { header: "Width (mm)", width: 11, align: "right" }, { header: "Height (mm)", width: 11, align: "right" },
      { header: "Qty (pcs)", width: 8, align: "right" }, { header: "Area (sq ft)", width: 11, align: "right" }, { header: "Remarks", width: 31 }
    ], body, { emptyText: "Glass list has not been generated for this configuration." });
  };

  const beadingList = () => {
    if (!data.beadingCuts.length) return;
    doc.sectionTitle("Beading cuts", 40);
    const body: PdfTableRow[] = data.beadingCuts.map((cut) => [`P${cut.panel_index}`, pdfLabel(cut.bead_position), mmCut(cut.cut_length_mm), pdfInteger(cut.quantity), pdfQuantity(cut.total_length_m, 3), cut.remarks]);
    body.push({ kind: "total", cells: ["Total", "", "", pdfInteger(sum(data.beadingCuts, "quantity")), pdfQuantity(sum(data.beadingCuts, "total_length_m"), 3), ""] });
    doc.table([
      { header: "Panel", width: 9 }, { header: "Position", width: 16 }, { header: "Cut length (mm)", width: 13, align: "right" },
      { header: "Qty (pcs)", width: 9, align: "right" }, { header: "Total length (m)", width: 13, align: "right" }, { header: "Profile / remarks", width: 40 }
    ], body);
  };

  const hardwareList = (rows = data.hardwareBom) => {
    doc.table([
      { header: "Code", width: 12 }, { header: "Item", width: 28 }, { header: "Category", width: 16 },
      { header: "Qty", width: 8, align: "right" }, { header: "Unit", width: 8 }, { header: "Rule / remarks", width: 28 }
    ], rows.map((item) => [item.item_code, item.item_name, pdfLabel(item.hardware_category), pdfNumber(item.quantity, 3), item.unit, item.remarks]),
    { emptyText: "Hardware BOM has not been generated for this configuration." });
  };

  if (data.reportType === "customer_quote") {
    summary();
    elevation();
    doc.sectionTitle("Commercial summary", 70);
    doc.totals([
      { label: "Subtotal (before GST)", value: pdfMoney(c.subtotal) },
      { label: toNumber(c.gst_percent) !== null ? `GST @ ${pdfPercent(c.gst_percent)}` : "GST", value: pdfMoney(c.gst_amount) },
      { label: "Grand total", value: pdfMoney(c.grand_total), emphasis: true }
    ]);
    const terms = String(data.settings?.default_terms_and_conditions ?? data.settings?.default_quote_terms ?? "Prices are subject to final site measurement, applicable taxes and approved specifications.");
    const signers = ["Customer acceptance (sign and stamp)", "Authorised signatory"];
    const forName = issuerName(company);
    doc.closing(signers, { forName });
    doc.sectionTitle("Terms and conditions", 30);
    doc.list(terms.split(/\r?\n/));
    doc.space(8);
    doc.signatures(signers, { forName });
  }

  if (data.reportType === "cutting_list") {
    summary();
    const signers = ["Prepared by", "Checked by (cutting)", "Production supervisor"];
    doc.closing(signers);
    doc.sectionTitle("Profile cutting list", 60);
    cuttingList();
    doc.signatures(signers);
  }

  if (data.reportType === "glass_list") {
    summary();
    const signers = ["Prepared by", "Checked by (glass)", "Production supervisor"];
    doc.closing(signers);
    doc.sectionTitle("Glass cutting list", 60);
    glassList();
    beadingList();
    doc.signatures(signers);
  }

  if (data.reportType === "hardware_bom") {
    summary();
    const signers = ["Prepared by", "Issued by (stores)", "Received by"];
    doc.closing(signers);
    doc.sectionTitle("Hardware bill of materials", 60);
    hardwareList();
    doc.signatures(signers);
  }

  if (data.reportType === "internal_costing") {
    summary();
    doc.notice("Internal costing — contains cost and margin. Do not share with customers or dealers.", "void");
    doc.sectionTitle("Material summary", 60);
    const rows: PdfTableRow[] = data.materialSummary.map((item) => [pdfLabel(item.material_type), item.item_name, pdfNumber(item.quantity, 3), item.unit, pdfQuantity(item.total_weight_kg, 3), pdfAmount(item.amount)]);
    if (data.materialSummary.length) rows.push({ kind: "total", cells: ["Total", "", "", "", pdfQuantity(sum(data.materialSummary, "total_weight_kg"), 3), pdfAmount(sum(data.materialSummary, "amount"))] });
    doc.table([
      { header: "Type", width: 14 }, { header: "Item", width: 34 }, { header: "Qty", width: 10, align: "right" }, { header: "Unit", width: 8 },
      { header: "Weight (kg)", width: 14, align: "right" }, { header: "Amount (INR)", width: 20, align: "right" }
    ], rows, { emptyText: "Material summary has not been generated." });
    doc.sectionTitle("Cost and margin", 80);
    doc.totals([
      { label: "Internal cost", value: pdfMoney(c.internal_cost) },
      { label: "Margin", value: pdfPercent(c.margin_percent) },
      { label: "Selling price (before GST)", value: pdfMoney(c.subtotal ?? c.selling_price) },
      { label: "GST", value: pdfMoney(c.gst_amount) },
      { label: "Selling price (incl. GST)", value: pdfMoney(c.grand_total ?? c.selling_price), emphasis: true }
    ], { width: 280 });
  }

  if (data.reportType === "production_sheet") {
    const status = getSystemOutputStatus({ profileCuts: data.profileCuts.length, glassCuts: data.glassCuts.length, beadingCuts: data.beadingCuts.length, hardwareBom: data.hardwareBom.length, optimizationRuns: data.optimizationRun ? 1 : 0 });
    if (!status.productionReady) doc.notice(`Not ready for production. Missing: ${status.missingOutputs.join(", ") || "outputs"}.`, "warning");
    summary();
    elevation();
    doc.sectionTitle("Output checklist", 60);
    doc.table([
      { header: "Output", width: 40 }, { header: "Lines", width: 20, align: "right" }, { header: "Status", width: 40 }
    ], [
      ["Profile cutting list", pdfInteger(data.profileCuts.length), data.profileCuts.length ? "Ready" : "Pending"],
      ["Glass cutting list", pdfInteger(data.glassCuts.length), data.glassCuts.length ? "Ready" : "Pending"],
      ["Beading cuts", pdfInteger(data.beadingCuts.length), data.beadingCuts.length ? "Ready" : "Pending"],
      ["Hardware BOM", pdfInteger(data.hardwareBom.length), data.hardwareBom.length ? "Ready" : "Pending"],
      ["Profile optimisation", data.optimizationRun ? `Run #${data.optimizationRun.run_number ?? "-"}` : "—", status.optimizationReady ? "Ready" : "Pending"]
    ]);
    // The production sheet carries the complete lists; nothing is trimmed to a "top N".
    const signers = ["Planned by", "Production supervisor", "Quality check"];
    doc.closing(signers);
    doc.sectionTitle("Profile cutting list", 60);
    cuttingList();
    if (data.glassCuts.length) { doc.sectionTitle("Glass cutting list", 60); glassList(); }
    beadingList();
    if (data.hardwareBom.length) { doc.sectionTitle("Hardware bill of materials", 60); hardwareList(); }
    doc.signatures(signers);
  }

  if (data.reportType === "optimization_report") {
    const run = data.optimizationRun ?? {};
    const output = run.optimized_output_json ?? {};
    const profiles: any[] = Array.isArray(output.profiles) ? output.profiles : [];
    summary();
    if (!data.optimizationRun) doc.notice("No optimisation run has been saved for this configuration.", "warning");
    doc.sectionTitle("Optimisation summary", 60);
    const stockLengths = [...new Set(profiles.map((profile) => profile.stockLengthMm).filter((length) => length != null))];
    doc.fields([
      ["Run", run.run_number ? `#${run.run_number}` : null], ["Stock lengths", stockLengths.length ? stockLengths.map((length) => `${mm(length)} mm`).join(", ") : null],
      ["Stock bars", pdfInteger(run.total_stock_bars ?? output.totalStockBars)], ["Used length", `${mm(run.total_used_length_mm ?? output.totalUsedLengthMm ?? 0)} mm`],
      ["Waste", `${mm(run.total_waste_mm ?? output.totalWasteMm ?? 0)} mm`], ["Waste %", pdfPercent(run.waste_percent ?? output.wastePercent ?? 0)]
    ], { columns: 2 });
    for (const profile of profiles) {
      doc.sectionTitle(`${pdfText(profile.profileCode)} — ${pdfText(profile.profileName)}  ·  Stock length ${mm(profile.stockLengthMm)} mm`, 60, { uppercase: false });
      const bars: any[] = profile.bars ?? [];
      const rows: PdfTableRow[] = bars.map((bar) => [
        pdfInteger(bar.barNumber), (bar.cuts ?? []).map((cut: any) => mm(cut.cutLengthMm)).join(" + ") || "—",
        pdfInteger((bar.cuts ?? []).length), mmCut(bar.usedLengthMm), mmCut(bar.wasteMm), bar.reusableLeftoverMm ? mmCut(bar.reusableLeftoverMm) : "—"
      ]);
      if (bars.length) rows.push({ kind: "total", cells: ["Total", "", pdfInteger(bars.reduce((total, bar) => total + (bar.cuts ?? []).length, 0)), mmCut(sum(bars, "usedLengthMm")), mmCut(sum(bars, "wasteMm")), mmCut(sum(bars, "reusableLeftoverMm"))] });
      doc.table([
        { header: "Bar", width: 7, align: "right" }, { header: "Cuts (mm)", width: 49 }, { header: "Pieces", width: 8, align: "right" },
        { header: "Used (mm)", width: 12, align: "right" }, { header: "Waste (mm)", width: 12, align: "right" }, { header: "Reusable (mm)", width: 12, align: "right" }
      ], rows, { emptyText: "No bars allocated." });
    }
  }

  return doc.finish();
}

function panelsOf(configuration: any): any[] {
  return Array.isArray(configuration.panel_layout_json?.panels) ? configuration.panel_layout_json.panels : [];
}

/** Scaled elevation with panel divisions, opening types and dimension lines. */
function drawElevation(doc: PdfDocumentWriter, configuration: any) {
  const widthMm = toNumber(configuration.width_mm) ?? 0;
  const heightMm = toNumber(configuration.height_mm) ?? 0;
  if (widthMm <= 0 || heightMm <= 0) {
    doc.paragraph("Opening size not recorded; elevation cannot be drawn.", { color: PDF_COLORS.muted });
    return;
  }
  const panels = panelsOf(configuration);
  const panelCount = Math.max(1, panels.length || Number(configuration.no_of_panels ?? 1));
  const ratios = panels.length ? panels.map((panel) => Math.max(0.01, Number(panel.widthRatio) || 1)) : Array.from({ length: panelCount }, () => 1);
  const ratioTotal = ratios.reduce((total, ratio) => total + ratio, 0);

  const maxWidth = doc.contentWidth - 90;
  const maxHeight = 135;
  const scale = Math.min(maxWidth / widthMm, maxHeight / heightMm);
  const w = widthMm * scale;
  const h = heightMm * scale;
  doc.ensure(h + 50);
  const top = doc.y - 6;
  const x = doc.left + (doc.contentWidth - 60 - w) / 2;
  const frame = PDF_COLORS.ink;

  doc.rect(x, top - h, w, h, { fill: PDF_COLORS.groupFill, border: frame, borderWidth: 2.2 });
  let cursor = x;
  ratios.forEach((ratio, index) => {
    const panelWidth = (ratio / ratioTotal) * w;
    if (index > 0) doc.page.drawLine({ start: { x: cursor, y: top }, end: { x: cursor, y: top - h }, thickness: 1.6, color: frame });
    const panel = panels[index];
    doc.text(`P${index + 1}`, cursor + panelWidth / 2, top - h / 2 + 3, { size: 9, bold: true, color: PDF_COLORS.ink, align: "center" });
    if (panel?.type) doc.text(pdfLabel(panel.type), cursor + panelWidth / 2, top - h / 2 - 8, { size: 7, color: PDF_COLORS.muted, align: "center" });
    cursor += panelWidth;
  });

  // Width dimension below the frame.
  const dimY = top - h - 14;
  const tick = (x1: number, y1: number, x2: number, y2: number) => doc.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.6, color: PDF_COLORS.body });
  tick(x, top - h - 4, x, dimY - 4);
  tick(x + w, top - h - 4, x + w, dimY - 4);
  tick(x, dimY, x + w, dimY);
  tick(x - 3, dimY - 3, x + 3, dimY + 3);
  tick(x + w - 3, dimY - 3, x + w + 3, dimY + 3);
  const widthLabel = `${mm(widthMm)} mm`;
  const labelWidth = doc.measure(widthLabel, 8, true) + 8;
  doc.rect(x + w / 2 - labelWidth / 2, dimY - 5, labelWidth, 10, { fill: PDF_COLORS.white });
  doc.text(widthLabel, x + w / 2, dimY - 3, { size: 8, bold: true, color: PDF_COLORS.ink, align: "center" });

  // Height dimension right of the frame, label rotated.
  const dimX = x + w + 14;
  tick(x + w + 4, top, dimX + 4, top);
  tick(x + w + 4, top - h, dimX + 4, top - h);
  tick(dimX, top, dimX, top - h);
  tick(dimX - 3, top - 3, dimX + 3, top + 3);
  tick(dimX - 3, top - h - 3, dimX + 3, top - h + 3);
  const heightLabel = `${mm(heightMm)} mm`;
  const heightLabelWidth = doc.measure(heightLabel, 8, true);
  doc.rect(dimX - 5, top - h / 2 - heightLabelWidth / 2 - 4, 10, heightLabelWidth + 8, { fill: PDF_COLORS.white });
  doc.kit.draw(doc.page, heightLabel, { x: dimX + 3, y: top - h / 2 - heightLabelWidth / 2, size: 8, bold: true, color: PDF_COLORS.ink, rotate: 90 });
  doc.y = dimY - 18;
}
