import { isRestrictedField } from "../../pcda/sanitize.ts";
import type { ReportField, ReportModel } from "./builder.ts";
import { getReportTemplate, type ReportTemplateKey } from "./templates.ts";

const RESTRICTED_LABEL_PATTERNS = [
  "internal cost",
  "total cost",
  "cost per",
  "supplier rate",
  "margin",
  "profit",
  "internal note",
  // Internal tooling / landed cost must never appear on a customer document. The amount
  // the customer actually pays for a die is shown separately as "Die Service Charge"
  // (the amortized amount), not the raw die tooling cost.
  "die cost",
  "tooling cost",
  "landed cost",
];

function isRestrictedReportField(field: ReportField): boolean {
  const label = field.label.toLowerCase();
  return isRestrictedField(label.replace(/\s+/g, "_")) || RESTRICTED_LABEL_PATTERNS.some((pattern) => label.includes(pattern));
}

export function sanitizeReportModelForCustomer(model: ReportModel): ReportModel {
  return {
    ...model,
    sections: model.sections.map((section) => ({
      ...section,
      fields: section.fields.filter((field) => !isRestrictedReportField(field)),
    })),
  };
}

export async function buildCustomerSafeReportModel(
  templateKey: ReportTemplateKey,
  recordId: string,
  companyId: string
): Promise<ReportModel> {
  const { buildReportModel } = await import("./builder.ts");
  const model = await buildReportModel(templateKey, recordId, companyId);
  const template = getReportTemplate(templateKey);
  return template?.customerFacing ? sanitizeReportModelForCustomer(model) : model;
}
