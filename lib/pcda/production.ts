import { TECHNICAL_LINE_ITEM_FIELDS } from "./field-map.ts";

const productionCopyFields = TECHNICAL_LINE_ITEM_FIELDS.filter((field) => !["id", "company_id"].includes(String(field)));

export function buildProductionJobPcdaFields(sourceLine: Record<string, any> | null | undefined, companyId: string) {
  if (!sourceLine) return { company_id: companyId };
  const copied: Record<string, any> = { company_id: companyId };
  for (const field of productionCopyFields) {
    if (Object.prototype.hasOwnProperty.call(sourceLine, field)) copied[field] = sourceLine[field];
  }
  copied.source_record_id = sourceLine.order_id ?? sourceLine.quote_id ?? sourceLine.source_record_id ?? null;
  copied.source_line_id = sourceLine.id ?? sourceLine.source_line_id ?? null;
  return copied;
}

export function chooseProductionSourceLine(lines: Record<string, any>[], profileId: string, sourceLineId?: string | null) {
  if (sourceLineId) {
    return lines.find((line) => line.id === sourceLineId && line.profile_id === profileId) ?? null;
  }

  const matchingLines = lines.filter((line) => line.profile_id === profileId);
  return matchingLines.length === 1 ? matchingLines[0] : null;
}
