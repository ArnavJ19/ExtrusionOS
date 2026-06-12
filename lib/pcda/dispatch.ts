import { buildProductionJobPcdaFields } from "./production.ts";

export function buildPackingListItems(sourceLines: Record<string, any>[], dispatchId: string, dispatchNumber: string, companyId: string) {
  return sourceLines.map((line, index) => {
    const weight = Number(line.actual_quantity_kg ?? line.planned_quantity_kg ?? line.total_weight_kg ?? line.quantity_kg ?? line.billing_weight_kg ?? 0);
    const pieces = Number(line.pieces ?? line.quantity_pieces ?? line.order_quantity ?? 0);
    return {
      ...buildProductionJobPcdaFields(line, companyId),
      company_id: companyId,
      dispatch_id: dispatchId,
      profile_id: line.profile_id,
      bundle_number: `${dispatchNumber}-${String(index + 1).padStart(2, "0")}`,
      number_of_pieces: Number.isFinite(pieces) && pieces > 0 ? Math.round(pieces) : 0,
      gross_weight_kg: weight,
      tare_weight_kg: Number(line.packing_weight ?? 0),
      notes: line.job_number ? `Generated from production job ${line.job_number}` : "Generated from order technical line"
    };
  });
}
