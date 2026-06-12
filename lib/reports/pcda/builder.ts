/**
 * PCDA Report Model Builder
 *
 * Builds structured report models from real persisted records.
 * Populates every field from database records and maps absent values
 * to Not_Captured_Label constants.
 *
 * Requirements: 7.1, 7.4, 8.2, 22.3
 */

import { createClient } from "@/lib/supabase/server";
import { getReportTemplate, isPcdaLineReport, PCDA_LINE_REPORT_SECTIONS } from "./templates";
import type { ReportTemplateKey } from "./templates";
import { NOT_CAPTURED_LABEL, mapNullableToDisplay } from "@/lib/pcda/labels";

// ---------------------------------------------------------------------------
// Report Model Types
// ---------------------------------------------------------------------------

/** Header fields required by Req 7.1 */
export interface ReportHeader {
  companyName: string;
  companyGst: string;
  moduleName: string;
  reportTitle: string;
  recordNumber: string;
  references: string;
  revisionNumber: string;
  generatedDate: string;
  generatedBy: string;
  approvalStatus: string;
}

/** A key-value field for report sections */
export interface ReportField {
  label: string;
  value: string | number | boolean;
}

/** A named section within a report */
export interface ReportSection {
  title: string;
  fields: ReportField[];
}

/** The complete report model produced by the builder */
export interface ReportModel {
  templateKey: ReportTemplateKey;
  header: ReportHeader;
  sections: ReportSection[];
  metadata: {
    recordId: string;
    companyId: string;
    recordType: string;
    generatedAt: string;
  };
}

// ---------------------------------------------------------------------------
// Helper: display value (never returns fabricated data)
// ---------------------------------------------------------------------------

function d(value: unknown, suffix = ""): string {
  if (value === null || value === undefined || value === "") return NOT_CAPTURED_LABEL;
  return `${value}${suffix}`;
}

function dMoney(value: unknown): string {
  if (value === null || value === undefined || value === "") return NOT_CAPTURED_LABEL;
  return `INR ${value}`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build a structured report model from real persisted records.
 *
 * @param templateKey - The report template to generate
 * @param recordId - The UUID of the source record
 * @param companyId - The authenticated user's company (derived server-side)
 * @returns ReportModel populated from real data, with Not_Captured_Label for absent fields
 *
 * Requirements: 7.1 (header fields), 7.4 (real data, Not_Captured_Label for absent),
 *              8.2 (PCDA_Line_Report section structure), 22.3 (revision number)
 */
export async function buildReportModel(
  templateKey: ReportTemplateKey,
  recordId: string,
  companyId: string
): Promise<ReportModel> {
  const template = getReportTemplate(templateKey);
  if (!template) {
    throw new Error(`Unknown report template: ${templateKey}`);
  }

  const supabase = await createClient();

  // Fetch company info for the header
  const { data: company } = await supabase
    .from("companies")
    .select("name, gst_number")
    .eq("id", companyId)
    .single();

  const companyName = company?.name ?? NOT_CAPTURED_LABEL;
  const companyGst = company?.gst_number ?? NOT_CAPTURED_LABEL;

  // Dispatch to template-specific builders
  if (isPcdaLineReport(templateKey)) {
    return buildPcdaLineReportModel(templateKey, recordId, companyId, supabase, {
      companyName,
      companyGst,
      template,
    });
  }

  switch (templateKey) {
    case "profile_technical":
      return buildProfileReportModel(recordId, companyId, supabase, { companyName, companyGst, template });
    case "die_technical":
      return buildDieReportModel(recordId, companyId, supabase, { companyName, companyGst, template });
    case "production_batch":
      return buildProductionBatchReportModel(recordId, companyId, supabase, { companyName, companyGst, template });
    case "die_trial":
      return buildDieTrialReportModel(recordId, companyId, supabase, { companyName, companyGst, template });
    case "quality_inspection":
      return buildQualityInspectionReportModel(recordId, companyId, supabase, { companyName, companyGst, template });
    case "packing":
      return buildPackingReportModel(recordId, companyId, supabase, { companyName, companyGst, template });
    case "dispatch":
      return buildDispatchReportModel(recordId, companyId, supabase, { companyName, companyGst, template });
    case "export":
      return buildExportReportModel(recordId, companyId, supabase, { companyName, companyGst, template });
    case "compliance":
      return buildComplianceReportModel(recordId, companyId, supabase, { companyName, companyGst, template });
    case "profitability":
      return buildProfitabilityReportModel(recordId, companyId, supabase, { companyName, companyGst, template });
    default:
      return buildGenericReportModel(templateKey, recordId, companyId, supabase, { companyName, companyGst, template });
  }
}

// ---------------------------------------------------------------------------
// Context passed to sub-builders
// ---------------------------------------------------------------------------

type BuildContext = {
  companyName: string;
  companyGst: string;
  template: NonNullable<ReturnType<typeof getReportTemplate>>;
};

// ---------------------------------------------------------------------------
// PCDA Line Report Builder (quote_line / order_line)
// Req 8.2: sections in order — Section and Alloy Details, Basic Price,
// Charges, Calculated Summary, Options, Bottom Summary Line
// ---------------------------------------------------------------------------

async function buildPcdaLineReportModel(
  templateKey: ReportTemplateKey,
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const isQuote = templateKey === "quote_line";
  const table = isQuote ? "quote_items" : "order_items";
  const parentTable = isQuote ? "quotes" : "orders";
  const moduleName = isQuote ? "Quotations" : "Orders";

  // Fetch the line item record
  const { data: line, error: lineError } = await supabase
    .from(table)
    .select("*")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .single();
  if (lineError || !line) {
    throw new Error(`${isQuote ? "Quote" : "Order"} line not found`);
  }

  // Fetch parent record for record_number and references
  const parentId = isQuote ? line.quote_id : line.order_id;
  if (!parentId) {
    throw new Error(`${isQuote ? "Quote" : "Order"} line is not linked to its parent record`);
  }
  const { data: parent, error: parentError } = await supabase
    .from(parentTable)
    .select("*")
    .eq("id", parentId)
    .eq("company_id", companyId)
    .single();
  if (parentError || !parent) {
    throw new Error(`Linked ${isQuote ? "quote" : "order"} not found`);
  }

  // Fetch generated-by user name
  const generatedBy = await resolveUserName(supabase, null);

  const recordNumber = parent?.quote_number ?? parent?.order_number ?? NOT_CAPTURED_LABEL;
  const revisionNumber = line?.revision_number ?? parent?.revision_number ?? NOT_CAPTURED_LABEL;
  const approvalStatus = line?.drawing_approval_status ?? parent?.status ?? NOT_CAPTURED_LABEL;
  const references = parent?.reference ?? parent?.customer_reference ?? NOT_CAPTURED_LABEL;

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName,
    reportTitle: ctx.template.title,
    recordNumber: d(recordNumber),
    references: d(references),
    revisionNumber: d(revisionNumber),
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: d(approvalStatus),
  };

  // Build sections per Req 8.2 order
  const sections: ReportSection[] = [
    buildSectionAndAlloyDetails(line),
    buildBasicPriceSection(line),
    buildChargesSection(line),
    buildCalculatedSummarySection(line),
    buildOptionsSection(line),
    buildBottomSummaryLine(line),
  ];

  return {
    templateKey,
    header,
    sections,
    metadata: {
      recordId,
      companyId,
      recordType: ctx.template.recordType,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// PCDA Line Report Section Builders
// ---------------------------------------------------------------------------

function buildSectionAndAlloyDetails(line: Record<string, any> | null): ReportSection {
  return {
    title: PCDA_LINE_REPORT_SECTIONS[0], // "Section and Alloy Details"
    fields: [
      { label: "Section Number", value: d(line?.section_number) },
      { label: "Section Code", value: d(line?.section_code) },
      { label: "Section Name", value: d(line?.section_name) },
      { label: "Customer Component Code", value: d(line?.customer_component_code) },
      { label: "Component Description", value: d(line?.component_description) },
      { label: "Drawing Revision", value: d(line?.drawing_revision) },
      { label: "Drawing Approval Status", value: d(line?.drawing_approval_status) },
      { label: "Alloy Standard", value: d(line?.alloy_standard_id) },
      { label: "Alloy", value: d(line?.alloy_id) },
      { label: "Temper", value: d(line?.temper_id) },
      { label: "Section Weight kg/m", value: mapNullableToDisplay(line?.section_weight_kg_per_m) },
      { label: "Cut Length", value: mapNullableToDisplay(line?.cut_length) },
      { label: "Standard Length", value: mapNullableToDisplay(line?.standard_length) },
      { label: "Order UOM", value: d(line?.order_uom) },
      { label: "Order Quantity", value: mapNullableToDisplay(line?.order_quantity) },
      { label: "Quantity kg", value: mapNullableToDisplay(line?.quantity_kg) },
    ],
  };
}

function buildBasicPriceSection(line: Record<string, any> | null): ReportSection {
  return {
    title: PCDA_LINE_REPORT_SECTIONS[1], // "Basic Price"
    fields: [
      { label: "Material Price", value: dMoney(line?.material_price) },
      { label: "Value Added Service Price", value: dMoney(line?.value_added_service_price) },
      { label: "Other Charges", value: dMoney(line?.other_charges) },
      { label: "Basic Price", value: dMoney(line?.basic_price) },
      { label: "Include Packing in Basic", value: d(line?.include_packing_in_basic) },
    ],
  };
}

function buildChargesSection(line: Record<string, any> | null): ReportSection {
  return {
    title: PCDA_LINE_REPORT_SECTIONS[2], // "Charges"
    fields: [
      { label: "Alloy Surcharge / kg", value: dMoney(line?.alloy_surcharge_per_kg) },
      { label: "Re-Cutting Charge / kg", value: dMoney(line?.re_cutting_charge_per_kg) },
      { label: "Testing Service Charge / kg", value: dMoney(line?.testing_service_charge_per_kg) },
      { label: "Die Cost", value: dMoney(line?.die_cost) },
      { label: "Die Service Charge", value: dMoney(line?.die_service_charge) },
      { label: "Packing Charge", value: dMoney(line?.packing_charge) },
      { label: "Freight Charge", value: dMoney(line?.freight_charge) },
      { label: "Packing in Conversion", value: d(line?.packing_in_conversion) },
    ],
  };
}

function buildCalculatedSummarySection(line: Record<string, any> | null): ReportSection {
  return {
    title: PCDA_LINE_REPORT_SECTIONS[3], // "Calculated Summary"
    fields: [
      { label: "Net Rate", value: dMoney(line?.net_rate) },
      { label: "Final Line Value", value: dMoney(line?.final_line_value) },
      { label: "GST %", value: mapNullableToDisplay(line?.gst_percent) },
      { label: "Discount", value: dMoney(line?.discount) },
      { label: "Margin", value: dMoney(line?.margin) },
      { label: "Theoretical Weight", value: mapNullableToDisplay(line?.theoretical_weight) },
      { label: "Actual Weight", value: mapNullableToDisplay(line?.actual_weight) },
    ],
  };
}

function buildOptionsSection(line: Record<string, any> | null): ReportSection {
  return {
    title: PCDA_LINE_REPORT_SECTIONS[4], // "Options"
    fields: [
      { label: "Quantity Calculation Method", value: d(line?.quantity_calculation_method) },
      { label: "Packing Mode", value: d(line?.packing_mode_id) },
      { label: "Invoice Calculation UOM", value: d(line?.invoice_calc_uom) },
      { label: "Bundle Quantity", value: mapNullableToDisplay(line?.bundle_quantity) },
      { label: "Pieces/m/kg/bundle", value: mapNullableToDisplay(line?.pieces_per_m_per_kg_per_bundle) },
      { label: "Packing Instruction", value: d(line?.packing_instruction) },
      { label: "Customer Packing Requirement", value: d(line?.customer_packing_requirement) },
      { label: "Weight Tolerance", value: mapNullableToDisplay(line?.weight_tolerance) },
      { label: "Min Weight", value: mapNullableToDisplay(line?.min_weight) },
      { label: "Max Weight", value: mapNullableToDisplay(line?.max_weight) },
    ],
  };
}

function buildBottomSummaryLine(line: Record<string, any> | null): ReportSection {
  return {
    title: PCDA_LINE_REPORT_SECTIONS[5], // "Bottom Summary Line"
    fields: [
      { label: "Section Code", value: d(line?.section_code) },
      { label: "Alloy", value: d(line?.alloy_id) },
      { label: "Temper", value: d(line?.temper_id) },
      { label: "Cut Length", value: mapNullableToDisplay(line?.cut_length) },
      { label: "Quantity kg", value: mapNullableToDisplay(line?.quantity_kg) },
      { label: "Net Rate", value: dMoney(line?.net_rate) },
      { label: "Final Line Value", value: dMoney(line?.final_line_value) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Profile Technical Report Builder
// ---------------------------------------------------------------------------

async function buildProfileReportModel(
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const { data: profile } = await supabase
    .from("aluminium_profiles")
    .select("*")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .single();

  const generatedBy = await resolveUserName(supabase, null);

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName: "Profile Master",
    reportTitle: ctx.template.title,
    recordNumber: d(profile?.profile_code),
    references: d(profile?.profile_name),
    revisionNumber: d(profile?.revision_number),
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: d(profile?.approval_status ?? profile?.drawing_approval_status),
  };

  const sections: ReportSection[] = [
    {
      title: "Profile Identity",
      fields: [
        { label: "Profile Code", value: d(profile?.profile_code) },
        { label: "Profile Name", value: d(profile?.profile_name) },
        { label: "Section Number", value: d(profile?.section_number) },
        { label: "Application", value: d(profile?.application_category) },
        { label: "Classification", value: d(profile?.profile_classification) },
      ],
    },
    {
      title: "Weight & Geometry",
      fields: [
        { label: "Section Weight kg/m", value: mapNullableToDisplay(profile?.section_weight_kg_per_m) },
        { label: "Standard Length", value: mapNullableToDisplay(profile?.standard_length_m ?? profile?.standard_length) },
        { label: "Min Weight", value: mapNullableToDisplay(profile?.min_weight) },
        { label: "Max Weight", value: mapNullableToDisplay(profile?.max_weight) },
        { label: "Weight Tolerance", value: mapNullableToDisplay(profile?.weight_tolerance ?? profile?.weight_tolerance_percent) },
      ],
    },
    {
      title: "Alloy & Mechanical",
      fields: [
        { label: "Alloy", value: d(profile?.alloy ?? profile?.alloy_id) },
        { label: "Temper", value: d(profile?.temper ?? profile?.temper_id) },
        { label: "Alloy Standard", value: d(profile?.alloy_standard_id) },
      ],
    },
    {
      title: "Production Parameters",
      fields: [
        { label: "Recommended Press", value: d(profile?.recommended_press) },
        { label: "Recovery Target %", value: mapNullableToDisplay(profile?.recovery_target_percent) },
      ],
    },
    {
      title: "Surface Treatment",
      fields: [
        { label: "Finish Type", value: d(profile?.finish_type) },
        { label: "Drawing Revision", value: d(profile?.drawing_revision) },
        { label: "Drawing Approval", value: d(profile?.drawing_approval_status) },
      ],
    },
  ];

  return {
    templateKey: "profile_technical",
    header,
    sections,
    metadata: {
      recordId,
      companyId,
      recordType: ctx.template.recordType,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Die Technical Report Builder
// ---------------------------------------------------------------------------

async function buildDieReportModel(
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const { data: die } = await supabase
    .from("dies")
    .select("*")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .single();

  const generatedBy = await resolveUserName(supabase, null);

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName: "Die Intelligence",
    reportTitle: ctx.template.title,
    recordNumber: d(die?.die_number),
    references: d(die?.die_code),
    revisionNumber: d(die?.revision_number),
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: d(die?.die_status),
  };

  const sections: ReportSection[] = [
    {
      title: "Die Identity",
      fields: [
        { label: "Die Number", value: d(die?.die_number) },
        { label: "Die Code", value: d(die?.die_code) },
        { label: "Status", value: d(die?.die_status) },
        { label: "Type", value: d(die?.die_type) },
        { label: "Cavities", value: mapNullableToDisplay(die?.number_of_cavities ?? die?.cavity_count) },
      ],
    },
    {
      title: "Geometry & Design",
      fields: [
        { label: "Die Diameter", value: d(die?.die_diameter_mm, " mm") },
        { label: "Die Thickness", value: d(die?.die_thickness_mm, " mm") },
        { label: "Bearing Length", value: d(die?.bearing_length_mm, " mm") },
        { label: "Extrusion Ratio", value: mapNullableToDisplay(die?.extrusion_ratio) },
      ],
    },
    {
      title: "Material & Manufacturing",
      fields: [
        { label: "Steel Grade", value: d(die?.die_steel_grade) },
        { label: "Manufacturer", value: d(die?.die_manufacturer) },
        { label: "Cost", value: dMoney(die?.die_cost) },
      ],
    },
    {
      title: "Performance",
      fields: [
        { label: "Total Production kg", value: mapNullableToDisplay(die?.total_production_kg) },
        { label: "Total Runs", value: mapNullableToDisplay(die?.total_runs) },
        { label: "Recovery %", value: mapNullableToDisplay(die?.average_recovery_percent) },
      ],
    },
  ];

  return {
    templateKey: "die_technical",
    header,
    sections,
    metadata: {
      recordId,
      companyId,
      recordType: ctx.template.recordType,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Production Batch Report Builder
// ---------------------------------------------------------------------------

async function buildProductionBatchReportModel(
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const { data: job } = await supabase
    .from("production_jobs")
    .select("*")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .single();

  const generatedBy = await resolveUserName(supabase, null);

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName: "Production",
    reportTitle: ctx.template.title,
    recordNumber: d(job?.job_number),
    references: d(job?.order_number ?? job?.order_id),
    revisionNumber: d(job?.revision_number),
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: d(job?.status ?? job?.job_status),
  };

  const sections: ReportSection[] = [
    {
      title: "Batch Identity",
      fields: [
        { label: "Job Number", value: d(job?.job_number) },
        { label: "Profile", value: d(job?.profile_id ?? job?.profile_code) },
        { label: "Die", value: d(job?.die_id ?? job?.die_number) },
        { label: "Press", value: d(job?.press ?? job?.machine_id) },
        { label: "Status", value: d(job?.status ?? job?.job_status) },
      ],
    },
    {
      title: "Input Material",
      fields: [
        { label: "Billet Alloy", value: d(job?.billet_alloy ?? job?.alloy) },
        { label: "Billet Weight kg", value: mapNullableToDisplay(job?.input_billet_weight ?? job?.billet_weight_kg) },
        { label: "Billet Length", value: mapNullableToDisplay(job?.billet_length) },
      ],
    },
    {
      title: "Output & Recovery",
      fields: [
        { label: "Output Good kg", value: mapNullableToDisplay(job?.output_good_weight ?? job?.actual_quantity_kg) },
        { label: "Rejected kg", value: mapNullableToDisplay(job?.rejected_weight ?? job?.rejected_kg) },
        { label: "Scrap kg", value: mapNullableToDisplay(job?.scrap_weight ?? job?.scrap_kg) },
        { label: "Recovery %", value: mapNullableToDisplay(job?.recovery_percent) },
        { label: "Scrap %", value: mapNullableToDisplay(job?.scrap_percent) },
      ],
    },
    {
      title: "Quality Results",
      fields: [
        { label: "Quality Status", value: d(job?.quality_status) },
        { label: "Quality Approved By", value: d(job?.quality_approved_by) },
        { label: "Quality Date", value: d(job?.quality_date) },
      ],
    },
  ];

  return {
    templateKey: "production_batch",
    header,
    sections,
    metadata: {
      recordId,
      companyId,
      recordType: ctx.template.recordType,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Die Trial Report Builder
// ---------------------------------------------------------------------------

async function buildDieTrialReportModel(
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const { data: trial } = await supabase
    .from("die_trials")
    .select("*")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .single();

  const generatedBy = await resolveUserName(supabase, null);

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName: "Die Intelligence",
    reportTitle: ctx.template.title,
    recordNumber: d(trial?.id),
    references: d(trial?.die_id),
    revisionNumber: d(trial?.revision_number),
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: d(trial?.trial_result),
  };

  const sections: ReportSection[] = [
    {
      title: "Trial Parameters",
      fields: [
        { label: "Trial Date", value: d(trial?.trial_date) },
        { label: "Die", value: d(trial?.die_id) },
        { label: "Trial Press", value: d(trial?.trial_press) },
        { label: "Billet Alloy", value: d(trial?.trial_billet_alloy) },
        { label: "Billet Diameter", value: mapNullableToDisplay(trial?.trial_billet_diameter_mm) },
        { label: "Billet Length", value: mapNullableToDisplay(trial?.trial_billet_length_mm) },
      ],
    },
    {
      title: "Extrusion Conditions",
      fields: [
        { label: "Billet Temperature", value: d(trial?.trial_billet_temperature_c, " °C") },
        { label: "Container Temperature", value: d(trial?.container_temperature_c, " °C") },
        { label: "Ram Speed", value: mapNullableToDisplay(trial?.ram_speed_mm_per_sec) },
        { label: "Pressure", value: d(trial?.pressure_tons, " tons") },
        { label: "Exit Temperature", value: d(trial?.exit_temperature_c, " °C") },
        { label: "Puller Speed", value: mapNullableToDisplay(trial?.puller_speed) },
        { label: "Quench Method", value: d(trial?.quench_method) },
      ],
    },
    {
      title: "Results",
      fields: [
        { label: "Trial Result", value: d(trial?.trial_result) },
        { label: "Output Quality", value: d(trial?.output_quality) },
        { label: "Dimensional Status", value: d(trial?.dimensional_status) },
        { label: "Surface Status", value: d(trial?.surface_status) },
        { label: "Straightness Result", value: d(trial?.straightness_result) },
        { label: "Surface Finish Result", value: d(trial?.surface_finish_result) },
        { label: "Output Weight kg", value: mapNullableToDisplay(trial?.trial_output_weight_kg) },
        { label: "Recovery %", value: mapNullableToDisplay(trial?.trial_recovery_percent) },
        { label: "Rejection %", value: mapNullableToDisplay(trial?.trial_rejection_percent) },
      ],
    },
    {
      title: "Approval",
      fields: [
        { label: "Correction Required", value: d(trial?.correction_required) },
        { label: "Approved By", value: d(trial?.approved_by) },
        { label: "Trial Report Document", value: d(trial?.trial_report_document_id) },
        { label: "Remarks", value: d(trial?.remarks) },
      ],
    },
  ];

  return {
    templateKey: "die_trial",
    header,
    sections,
    metadata: { recordId, companyId, recordType: ctx.template.recordType, generatedAt: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------------------
// Quality Inspection Report Builder
// ---------------------------------------------------------------------------

async function buildQualityInspectionReportModel(
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const { data: inspection } = await supabase
    .from("quality_inspections")
    .select("*")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .single();

  const generatedBy = await resolveUserName(supabase, null);

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName: "Quality",
    reportTitle: ctx.template.title,
    recordNumber: d(inspection?.batch_number ?? inspection?.id),
    references: d(inspection?.production_job_id ?? inspection?.profile_id),
    revisionNumber: d(inspection?.revision_number),
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: d(inspection?.status),
  };

  const sections: ReportSection[] = [
    {
      title: "Inspection Identity",
      fields: [
        { label: "Batch Number", value: d(inspection?.batch_number) },
        { label: "Inspection Date", value: d(inspection?.inspection_date) },
        { label: "Production Job", value: d(inspection?.production_job_id) },
        { label: "Profile", value: d(inspection?.profile_id) },
        { label: "Inspector", value: d(inspection?.inspector_name) },
      ],
    },
    {
      title: "Measured Parameters",
      fields: [
        { label: "Quantity Checked kg", value: mapNullableToDisplay(inspection?.quantity_checked_kg) },
        { label: "Dimensional Variance", value: d(inspection?.dimensional_variance) },
        { label: "Hardness Webster", value: mapNullableToDisplay(inspection?.hardness_webster) },
        { label: "Surface Finish OK", value: d(inspection?.surface_finish_ok) },
        { label: "Actual Weight per Meter", value: mapNullableToDisplay(inspection?.weight_per_meter_actual) },
      ],
    },
    {
      title: "Defects & Non-Conformances",
      fields: [
        { label: "Defect Notes", value: d(inspection?.defect_notes ?? inspection?.notes) },
        { label: "NCR Reference", value: d(inspection?.ncr_id ?? inspection?.ncr_reference) },
      ],
    },
    {
      title: "Disposition",
      fields: [
        { label: "Status", value: d(inspection?.status) },
        { label: "Accepted kg", value: mapNullableToDisplay(inspection?.accepted_kg) },
        { label: "Rejected kg", value: mapNullableToDisplay(inspection?.rejected_kg) },
        { label: "Rework kg", value: mapNullableToDisplay(inspection?.rework_kg) },
        { label: "Scrap kg", value: mapNullableToDisplay(inspection?.scrap_kg) },
      ],
    },
    {
      title: "Approval & Certificates",
      fields: [
        { label: "Approved By", value: d(inspection?.approved_by) },
        { label: "Certificate", value: d(inspection?.certificate_document_id ?? inspection?.certificate_url) },
        { label: "Notes", value: d(inspection?.notes) },
      ],
    },
  ];

  return {
    templateKey: "quality_inspection",
    header,
    sections,
    metadata: { recordId, companyId, recordType: ctx.template.recordType, generatedAt: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------------------
// Packing Report Builder
// ---------------------------------------------------------------------------

async function buildPackingReportModel(
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const { data: pack } = await supabase
    .from("packing_list_items")
    .select("*")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .single();

  const generatedBy = await resolveUserName(supabase, null);

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName: "Dispatch Packing",
    reportTitle: ctx.template.title,
    recordNumber: d(pack?.bundle_number),
    references: d(pack?.dispatch_id),
    revisionNumber: d(pack?.revision_number),
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: d(pack?.status),
  };

  const sections: ReportSection[] = [
    {
      title: "Package Identity",
      fields: [
        { label: "Bundle Number", value: d(pack?.bundle_number) },
        { label: "Dispatch", value: d(pack?.dispatch_id) },
        { label: "Profile", value: d(pack?.profile_id) },
        { label: "Section Number", value: d(pack?.section_number) },
        { label: "Section Code", value: d(pack?.section_code) },
      ],
    },
    {
      title: "Packing Details",
      fields: [
        { label: "Number of Pieces", value: mapNullableToDisplay(pack?.number_of_pieces) },
        { label: "Bundle Quantity", value: mapNullableToDisplay(pack?.bundle_quantity) },
        { label: "Packing Mode", value: d(pack?.packing_mode_id) },
        { label: "Standard Length", value: mapNullableToDisplay(pack?.standard_length) },
        { label: "Cut Length", value: mapNullableToDisplay(pack?.cut_length) },
      ],
    },
    {
      title: "Weight Summary",
      fields: [
        { label: "Gross Weight kg", value: mapNullableToDisplay(pack?.gross_weight_kg) },
        { label: "Tare Weight kg", value: mapNullableToDisplay(pack?.tare_weight_kg) },
        { label: "Net Weight kg", value: mapNullableToDisplay(pack?.net_weight_kg) },
        { label: "Packing Weight kg", value: mapNullableToDisplay(pack?.packing_weight) },
        { label: "Freight Weight kg", value: mapNullableToDisplay(pack?.freight_weight) },
      ],
    },
    {
      title: "Packing Instructions",
      fields: [
        { label: "Packing Instruction", value: d(pack?.packing_instruction) },
        { label: "Customer Packing Requirement", value: d(pack?.customer_packing_requirement) },
        { label: "Notes", value: d(pack?.notes) },
      ],
    },
  ];

  return {
    templateKey: "packing",
    header,
    sections,
    metadata: { recordId, companyId, recordType: ctx.template.recordType, generatedAt: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------------------
// Dispatch Report Builder
// ---------------------------------------------------------------------------

async function buildDispatchReportModel(
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const { data: dispatch } = await supabase
    .from("dispatches")
    .select("*")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .single();

  const generatedBy = await resolveUserName(supabase, null);

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName: "Dispatch",
    reportTitle: ctx.template.title,
    recordNumber: d(dispatch?.dispatch_number),
    references: d(dispatch?.order_number ?? dispatch?.order_id),
    revisionNumber: d(dispatch?.revision_number),
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: d(dispatch?.status ?? dispatch?.delivery_status),
  };

  const sections: ReportSection[] = [
    {
      title: "Dispatch Identity",
      fields: [
        { label: "Dispatch Number", value: d(dispatch?.dispatch_number) },
        { label: "Customer", value: d(dispatch?.customer_name ?? dispatch?.customer_id) },
        { label: "Dispatch Date", value: d(dispatch?.dispatch_date) },
        { label: "Status", value: d(dispatch?.status ?? dispatch?.delivery_status) },
      ],
    },
    {
      title: "Transporter & Vehicle",
      fields: [
        { label: "Transporter", value: d(dispatch?.transporter_name ?? dispatch?.transporter) },
        { label: "Vehicle Number", value: d(dispatch?.vehicle_number) },
        { label: "LR Number", value: d(dispatch?.lr_number) },
        { label: "E-Way Bill", value: d(dispatch?.eway_bill_number ?? dispatch?.eway_bill) },
      ],
    },
    {
      title: "Package List",
      fields: [
        { label: "Number of Packages", value: mapNullableToDisplay(dispatch?.package_count ?? dispatch?.total_packages) },
        { label: "Total Bundles", value: mapNullableToDisplay(dispatch?.total_bundles) },
      ],
    },
    {
      title: "Weight & Quantity Summary",
      fields: [
        { label: "Total Weight kg", value: mapNullableToDisplay(dispatch?.total_weight_kg ?? dispatch?.total_weight) },
        { label: "Total Pieces", value: mapNullableToDisplay(dispatch?.total_pieces) },
        { label: "Gross Weight kg", value: mapNullableToDisplay(dispatch?.gross_weight_kg) },
      ],
    },
    {
      title: "Delivery Status",
      fields: [
        { label: "Delivery Status", value: d(dispatch?.delivery_status ?? dispatch?.status) },
        { label: "Delivered Date", value: d(dispatch?.delivered_date) },
        { label: "POD Reference", value: d(dispatch?.pod_reference ?? dispatch?.pod_number) },
      ],
    },
  ];

  return {
    templateKey: "dispatch",
    header,
    sections,
    metadata: {
      recordId,
      companyId,
      recordType: ctx.template.recordType,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Export Report Builder
// ---------------------------------------------------------------------------

async function buildExportReportModel(
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const { data: exportOrder } = await supabase
    .from("export_orders")
    .select("*")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .single();

  const { data: documents } = exportOrder
    ? await supabase
        .from("export_documents")
        .select("*")
        .eq("export_order_id", recordId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

  const generatedBy = await resolveUserName(supabase, null);
  const documentSummary = Array.isArray(documents) && documents.length
    ? documents.map((doc: Record<string, any>) => `${doc.document_type}: ${doc.status}`).join(", ")
    : NOT_CAPTURED_LABEL;

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName: "Exports",
    reportTitle: ctx.template.title,
    recordNumber: d(exportOrder?.commercial_invoice_number ?? exportOrder?.shipping_bill_number ?? exportOrder?.id),
    references: d(exportOrder?.order_id),
    revisionNumber: d(exportOrder?.revision_number),
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: d(exportOrder?.status),
  };

  const sections: ReportSection[] = [
    {
      title: "Shipment Identity",
      fields: [
        { label: "Customer", value: d(exportOrder?.export_customer_name) },
        { label: "Destination Country", value: d(exportOrder?.destination_country) },
        { label: "Status", value: d(exportOrder?.status) },
        { label: "Estimated Ship Date", value: d(exportOrder?.estimated_ship_date) },
        { label: "Actual Ship Date", value: d(exportOrder?.actual_ship_date) },
      ],
    },
    {
      title: "Product & HS Codes",
      fields: [
        { label: "Order", value: d(exportOrder?.order_id) },
        { label: "Total Value", value: d(exportOrder?.total_value) },
        { label: "Currency", value: d(exportOrder?.currency) },
        { label: "HS Code", value: d(exportOrder?.hs_code) },
      ],
    },
    {
      title: "Packing List",
      fields: [
        { label: "Commercial Invoice", value: d(exportOrder?.commercial_invoice_number) },
        { label: "Shipping Bill", value: d(exportOrder?.shipping_bill_number) },
        { label: "Document Summary", value: documentSummary },
      ],
    },
    {
      title: "Container & Logistics",
      fields: [
        { label: "Incoterm", value: d(exportOrder?.incoterm) },
        { label: "Shipment Mode", value: d(exportOrder?.shipment_mode) },
        { label: "Port of Loading", value: d(exportOrder?.port_of_loading) },
        { label: "Port of Discharge", value: d(exportOrder?.port_of_discharge) },
        { label: "Container Number", value: d(exportOrder?.container_number) },
        { label: "Seal Number", value: d(exportOrder?.seal_number) },
      ],
    },
    {
      title: "Certificates & Compliance",
      fields: [
        { label: "Payment Status", value: d(exportOrder?.payment_status) },
        { label: "Documents", value: documentSummary },
        { label: "Notes", value: d(exportOrder?.notes) },
      ],
    },
  ];

  return {
    templateKey: "export",
    header,
    sections,
    metadata: { recordId, companyId, recordType: ctx.template.recordType, generatedAt: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------------------
// Compliance Report Builder
// ---------------------------------------------------------------------------

async function buildComplianceReportModel(
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const standardResult = await supabase
    .from("compliance_standards")
    .select("*")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .maybeSingle();

  const auditResult = standardResult.data
    ? { data: null }
    : await supabase
        .from("compliance_audit_records")
        .select("*")
        .eq("id", recordId)
        .eq("company_id", companyId)
        .maybeSingle();

  const calibrationResult = standardResult.data || auditResult.data
    ? { data: null }
    : await supabase
        .from("calibration_records")
        .select("*")
        .eq("id", recordId)
        .eq("company_id", companyId)
        .maybeSingle();

  const record = standardResult.data ?? auditResult.data ?? calibrationResult.data;
  const generatedBy = await resolveUserName(supabase, null);

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName: "Compliance",
    reportTitle: ctx.template.title,
    recordNumber: d(record?.standard_code ?? record?.equipment_id_code ?? record?.audit_name ?? record?.id),
    references: d(record?.standard_name ?? record?.equipment_name ?? record?.audit_type),
    revisionNumber: d(record?.revision_number),
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: d(record?.status ?? record?.is_applicable),
  };

  const sections: ReportSection[] = [
    {
      title: "Certificate Identity",
      fields: [
        { label: "Standard Code", value: d(record?.standard_code) },
        { label: "Standard Name", value: d(record?.standard_name) },
        { label: "Equipment", value: d(record?.equipment_name) },
        { label: "Audit Name", value: d(record?.audit_name) },
      ],
    },
    {
      title: "Issuing Authority",
      fields: [
        { label: "Product Category", value: d(record?.product_category) },
        { label: "Calibrated By", value: d(record?.calibrated_by) },
        { label: "Auditor", value: d(record?.auditor_name) },
      ],
    },
    {
      title: "Validity & Status",
      fields: [
        { label: "Applicable", value: d(record?.is_applicable) },
        { label: "Status", value: d(record?.status) },
        { label: "Calibration Date", value: d(record?.calibration_date) },
        { label: "Next Due Date", value: d(record?.next_due_date) },
        { label: "Audit Date", value: d(record?.audit_date) },
      ],
    },
    {
      title: "Linked Products & Orders",
      fields: [
        { label: "Profile/Product Scope", value: d(record?.product_category) },
        { label: "Description", value: d(record?.description) },
      ],
    },
    {
      title: "Renewal Schedule",
      fields: [
        { label: "Certificate URL", value: d(record?.certificate_url) },
        { label: "Document Pack URL", value: d(record?.document_pack_url) },
        { label: "Findings", value: d(record?.findings) },
        { label: "Corrective Actions", value: d(record?.corrective_actions) },
      ],
    },
  ];

  return {
    templateKey: "compliance",
    header,
    sections,
    metadata: { recordId, companyId, recordType: ctx.template.recordType, generatedAt: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------------------
// Profitability Report Builder
// ---------------------------------------------------------------------------

async function buildProfitabilityReportModel(
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const { data: breakdown } = await supabase
    .from("order_cost_breakdown")
    .select("*")
    .eq("id", recordId)
    .eq("company_id", companyId)
    .single();

  const generatedBy = await resolveUserName(supabase, null);

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName: "Profitability Intelligence",
    reportTitle: ctx.template.title,
    recordNumber: d(breakdown?.order_id ?? breakdown?.id),
    references: d(breakdown?.customer_name),
    revisionNumber: d(breakdown?.revision_number),
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: d(breakdown?.payment_status),
  };

  const sections: ReportSection[] = [
    {
      title: "Revenue",
      fields: [
        { label: "Customer", value: d(breakdown?.customer_name) },
        { label: "Profile", value: d(breakdown?.profile_name) },
        { label: "Die", value: d(breakdown?.die_code) },
        { label: "Revenue", value: dMoney(breakdown?.revenue) },
        { label: "Total Weight kg", value: mapNullableToDisplay(breakdown?.total_weight_kg) },
        { label: "Rate per kg", value: dMoney(breakdown?.rate_per_kg) },
      ],
    },
    {
      title: "Variable Cost",
      fields: [
        { label: "Material Cost", value: dMoney(breakdown?.material_cost) },
        { label: "Conversion Cost", value: dMoney(breakdown?.conversion_cost) },
        { label: "Finishing Cost", value: dMoney(breakdown?.finishing_cost) },
        { label: "Packing Cost", value: dMoney(breakdown?.packing_cost) },
        { label: "Transport Cost", value: dMoney(breakdown?.transport_cost) },
        { label: "Scrap Cost", value: dMoney(breakdown?.scrap_cost) },
        { label: "Energy Cost", value: dMoney(breakdown?.energy_cost) },
      ],
    },
    {
      title: "Contribution Margin",
      fields: [
        { label: "Total Cost", value: dMoney(breakdown?.total_cost) },
        { label: "Gross Margin", value: dMoney(breakdown?.gross_margin) },
        { label: "Payment Status", value: d(breakdown?.payment_status) },
        { label: "Payment Days", value: mapNullableToDisplay(breakdown?.payment_days) },
      ],
    },
    {
      title: "Fixed Cost Allocation",
      fields: [
        { label: "Die Cost Allocated", value: dMoney(breakdown?.die_cost_allocated) },
        { label: "Overhead Cost", value: dMoney(breakdown?.overhead_cost) },
        { label: "Other Cost", value: dMoney(breakdown?.other_cost) },
        { label: "Branch", value: d(breakdown?.branch) },
        { label: "Month", value: d(breakdown?.month_key) },
      ],
    },
  ];

  return {
    templateKey: "profitability",
    header,
    sections,
    metadata: { recordId, companyId, recordType: ctx.template.recordType, generatedAt: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------------------
// Generic Report Builder (fallback for templates without specific logic)
// ---------------------------------------------------------------------------

async function buildGenericReportModel(
  templateKey: ReportTemplateKey,
  recordId: string,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: BuildContext
): Promise<ReportModel> {
  const generatedBy = await resolveUserName(supabase, null);

  const header: ReportHeader = {
    companyName: ctx.companyName,
    companyGst: ctx.companyGst,
    moduleName: ctx.template.recordType,
    reportTitle: ctx.template.title,
    recordNumber: NOT_CAPTURED_LABEL,
    references: NOT_CAPTURED_LABEL,
    revisionNumber: NOT_CAPTURED_LABEL,
    generatedDate: new Date().toLocaleDateString("en-IN"),
    generatedBy,
    approvalStatus: NOT_CAPTURED_LABEL,
  };

  // Build empty sections from template definition
  const sections: ReportSection[] = ctx.template.sections.map((title) => ({
    title,
    fields: [],
  }));

  return {
    templateKey,
    header,
    sections,
    metadata: {
      recordId,
      companyId,
      recordType: ctx.template.recordType,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Utility: resolve user name from current auth session
// ---------------------------------------------------------------------------

async function resolveUserName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string | null
): Promise<string> {
  try {
    if (userId) {
      const { data } = await supabase
        .from("app_users")
        .select("full_name, email")
        .eq("id", userId)
        .single();
      return data?.full_name ?? data?.email ?? NOT_CAPTURED_LABEL;
    }
    // Fall back to current session user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NOT_CAPTURED_LABEL;
    const { data } = await supabase
      .from("app_users")
      .select("full_name, email")
      .eq("id", user.id)
      .single();
    return data?.full_name ?? data?.email ?? NOT_CAPTURED_LABEL;
  } catch {
    return NOT_CAPTURED_LABEL;
  }
}
