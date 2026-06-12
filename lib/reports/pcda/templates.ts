/**
 * PCDA Report Template Registry
 *
 * Defines metadata for all available report templates.
 * Used by the report generation UI to show available reports
 * and by the server action to validate template requests.
 *
 * Requirements: 8.1 (all 12 template types), 8.2 (PCDA_Line_Report section order)
 */

/**
 * All template keys required by Requirement 8.1.
 */
export type ReportTemplateKey =
  | "quote_line"
  | "order_line"
  | "profile_technical"
  | "die_technical"
  | "die_trial"
  | "production_batch"
  | "quality_inspection"
  | "packing"
  | "dispatch"
  | "export"
  | "compliance"
  | "profitability";

/**
 * Record types that reports can be generated for.
 */
export type ReportRecordType =
  | "quote"
  | "order"
  | "profile"
  | "die"
  | "die_trial"
  | "production_job"
  | "quality_inspection"
  | "dispatch_package"
  | "dispatch"
  | "export_shipment"
  | "compliance_record"
  | "analysis";

/**
 * Output formats supported by a template.
 */
export interface ReportOutputFormats {
  pdf: boolean;
  csv: boolean;
  excel: boolean;
}

/**
 * Metadata for a single report template.
 */
export interface ReportTemplate {
  /** Unique template identifier */
  key: ReportTemplateKey;
  /** Human-readable report title */
  title: string;
  /** Description of what the report contains */
  description: string;
  /** The entity/record type this report is generated from */
  recordType: ReportRecordType;
  /** Roles that are allowed to generate this report */
  roles: string[];
  /** Ordered list of sections in the report */
  sections: string[];
  /** Output formats supported */
  supportsCsv: boolean;
  supportsExcel: boolean;
  /** Whether this is a customer-facing report that needs sanitization */
  customerFacing: boolean;
}

/**
 * Section order for PCDA_Line_Report (quote_line and order_line).
 * Requirement 8.2: structured in this exact order.
 */
export const PCDA_LINE_REPORT_SECTIONS = [
  "Section and Alloy Details",
  "Basic Price",
  "Charges",
  "Calculated Summary",
  "Options",
  "Bottom Summary Line",
] as const;

export type PcdaLineReportSection = (typeof PCDA_LINE_REPORT_SECTIONS)[number];

/**
 * All report templates required by Requirement 8.1.
 *
 * Includes the 12 mandatory templates:
 * quote_line, order_line, profile_technical, die_technical, die_trial,
 * production_batch, quality_inspection, packing, dispatch, export,
 * compliance, profitability.
 */
export const REPORT_TEMPLATES: ReportTemplate[] = [
  // --- PCDA Line Reports (Req 8.2 section order) ---
  {
    key: "quote_line",
    title: "Quote Line Report (PCDA)",
    description:
      "Dense technical-commercial report for a single quote line item.",
    recordType: "quote",
    roles: ["owner", "admin", "sales_manager", "sales", "accounts"],
    sections: [...PCDA_LINE_REPORT_SECTIONS],
    supportsCsv: false,
    supportsExcel: false,
    customerFacing: true,
  },
  {
    key: "order_line",
    title: "Order Line Report (PCDA)",
    description:
      "Dense technical-commercial report for a single order line item.",
    recordType: "order",
    roles: [
      "owner",
      "admin",
      "sales_manager",
      "production_manager",
      "accounts",
    ],
    sections: [...PCDA_LINE_REPORT_SECTIONS],
    supportsCsv: false,
    supportsExcel: false,
    customerFacing: true,
  },

  // --- Profile & Die Technical Sheets ---
  {
    key: "profile_technical",
    title: "Profile Technical Sheet",
    description:
      "Complete profile engineering, production parameters, surface treatment, and costing.",
    recordType: "profile",
    roles: [
      "owner",
      "admin",
      "sales_manager",
      "production_manager",
      "quality",
    ],
    sections: [
      "Profile Identity",
      "Weight & Geometry",
      "Alloy & Mechanical",
      "Production Parameters",
      "Surface Treatment",
    ],
    supportsCsv: false,
    supportsExcel: false,
    customerFacing: false,
  },
  {
    key: "die_technical",
    title: "Die Technical Sheet",
    description:
      "Complete die identity, geometry, material, performance, and maintenance data.",
    recordType: "die",
    roles: ["owner", "admin", "production_manager", "quality"],
    sections: [
      "Die Identity",
      "Geometry & Design",
      "Material & Manufacturing",
      "Performance",
    ],
    supportsCsv: false,
    supportsExcel: false,
    customerFacing: false,
  },
  {
    key: "die_trial",
    title: "Die Trial Report",
    description:
      "Trial parameters, results, and approval status for a specific die trial.",
    recordType: "die_trial",
    roles: ["owner", "admin", "production_manager", "quality"],
    sections: [
      "Trial Parameters",
      "Extrusion Conditions",
      "Results",
      "Approval",
    ],
    supportsCsv: false,
    supportsExcel: false,
    customerFacing: false,
  },

  // --- Production ---
  {
    key: "production_batch",
    title: "Production Batch Report",
    description:
      "Billet consumption, output weight, recovery, and quality results for a production run.",
    recordType: "production_job",
    roles: ["owner", "admin", "production_manager", "production"],
    sections: [
      "Batch Identity",
      "Input Material",
      "Output & Recovery",
      "Quality Results",
    ],
    supportsCsv: false,
    supportsExcel: false,
    customerFacing: false,
  },

  // --- Quality ---
  {
    key: "quality_inspection",
    title: "Quality Inspection Report",
    description:
      "Measured values, defects, accepted/rejected/rework/scrap quantities, approval status, and certificate data.",
    recordType: "quality_inspection",
    roles: ["owner", "admin", "production_manager", "quality"],
    sections: [
      "Inspection Identity",
      "Measured Parameters",
      "Defects & Non-Conformances",
      "Disposition",
      "Approval & Certificates",
    ],
    supportsCsv: false,
    supportsExcel: true,
    customerFacing: false,
  },

  // --- Packing & Dispatch ---
  {
    key: "packing",
    title: "Packing Report",
    description:
      "Packing details including bundle quantities, packing mode, weights, and instructions for a dispatch package.",
    recordType: "dispatch_package",
    roles: ["owner", "admin", "production_manager", "dispatch"],
    sections: [
      "Package Identity",
      "Packing Details",
      "Weight Summary",
      "Packing Instructions",
    ],
    supportsCsv: false,
    supportsExcel: false,
    customerFacing: true,
  },
  {
    key: "dispatch",
    title: "Dispatch Report",
    description:
      "Dispatch details including transporter, LR number, vehicle, packages, weights, and delivery status.",
    recordType: "dispatch",
    roles: ["owner", "admin", "sales_manager", "dispatch", "accounts"],
    sections: [
      "Dispatch Identity",
      "Transporter & Vehicle",
      "Package List",
      "Weight & Quantity Summary",
      "Delivery Status",
    ],
    supportsCsv: true,
    supportsExcel: true,
    customerFacing: true,
  },

  // --- Export & Compliance ---
  {
    key: "export",
    title: "Export Report",
    description:
      "Export shipment documentation including HS codes, packing list, container, ports, incoterms, and certificates.",
    recordType: "export_shipment",
    roles: ["owner", "admin", "compliance", "accounts"],
    sections: [
      "Shipment Identity",
      "Product & HS Codes",
      "Packing List",
      "Container & Logistics",
      "Certificates & Compliance",
    ],
    supportsCsv: true,
    supportsExcel: true,
    customerFacing: true,
  },
  {
    key: "compliance",
    title: "Compliance Report",
    description:
      "Compliance register including certificate details, issuing authority, validity, status, and linked entities.",
    recordType: "compliance_record",
    roles: ["owner", "admin", "compliance", "quality"],
    sections: [
      "Certificate Identity",
      "Issuing Authority",
      "Validity & Status",
      "Linked Products & Orders",
      "Renewal Schedule",
    ],
    supportsCsv: true,
    supportsExcel: true,
    customerFacing: false,
  },

  // --- Profitability (restricted access — Req 8.4) ---
  {
    key: "profitability",
    title: "Profitability Report",
    description:
      "Revenue, cost, margin, and contribution analysis per profile/die/customer.",
    recordType: "analysis",
    roles: ["owner", "accounts"],
    sections: [
      "Revenue",
      "Variable Cost",
      "Contribution Margin",
      "Fixed Cost Allocation",
    ],
    supportsCsv: true,
    supportsExcel: true,
    customerFacing: false,
  },
];

/**
 * Get a template by key. Returns null if not found.
 */
export function getReportTemplate(
  key: string
): ReportTemplate | null {
  return REPORT_TEMPLATES.find((t) => t.key === key) ?? null;
}

/**
 * Get templates available for a given role.
 */
export function getTemplatesForRole(role: string): ReportTemplate[] {
  return REPORT_TEMPLATES.filter((t) => t.roles.includes(role));
}

/**
 * Get templates for a specific record type.
 */
export function getTemplatesForRecordType(
  recordType: string
): ReportTemplate[] {
  return REPORT_TEMPLATES.filter((t) => t.recordType === recordType);
}

/**
 * Check if a template is a PCDA Line Report (quote_line or order_line).
 */
export function isPcdaLineReport(key: string): boolean {
  return key === "quote_line" || key === "order_line";
}

/**
 * All required template keys per Requirement 8.1.
 * Useful for validation and testing that all templates are registered.
 */
export const REQUIRED_TEMPLATE_KEYS: readonly ReportTemplateKey[] = [
  "quote_line",
  "order_line",
  "profile_technical",
  "die_technical",
  "die_trial",
  "production_batch",
  "quality_inspection",
  "packing",
  "dispatch",
  "export",
  "compliance",
  "profitability",
] as const;
