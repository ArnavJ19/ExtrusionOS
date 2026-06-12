/**
 * PCDA Invoice Item Builder
 * 
 * Builds invoice_items from PCDA source lines (packing_list_items or order_items).
 * Propagates the full Technical_Line_Item field set for traceability.
 */

import { TECHNICAL_LINE_ITEM_FIELDS } from "./field-map.ts";

const invoiceCopyFields = TECHNICAL_LINE_ITEM_FIELDS.filter(
  (field) => !["id", "company_id"].includes(String(field))
);

/**
 * Build invoice items from source lines (packing_list_items or order_items).
 * Each source line becomes one invoice item with full PCDA field propagation.
 */
export function buildInvoiceItems(
  sourceLines: Record<string, any>[],
  invoiceId: string,
  companyId: string
): Record<string, any>[] {
  return sourceLines.map((line) => {
    const item: Record<string, any> = { company_id: companyId, invoice_id: invoiceId };

    // Copy all PCDA technical fields from source
    for (const field of invoiceCopyFields) {
      if (Object.prototype.hasOwnProperty.call(line, field)) {
        item[field] = line[field];
      }
    }

    // Set traceability references
    item.source_record_id = line.dispatch_id ?? line.order_id ?? line.source_record_id ?? null;
    item.source_line_id = line.id ?? line.source_line_id ?? null;

    // Map to invoice_items specific columns
    item.order_item_id = line.order_item_id ?? (line.order_id ? line.id : null) ?? null;
    item.profile_id = line.profile_id ?? null;
    item.die_id = line.die_id ?? null;
    item.item_description = line.item_description ?? line.component_description ?? line.notes ?? null;

    // Calculate line value from PCDA fields or source weights
    const weight = Number(
      line.actual_weight ?? line.gross_weight_kg ?? line.billing_weight_kg ??
      line.quantity_kg ?? line.total_weight_kg ?? 0
    );
    const rate = Number(line.net_rate ?? line.price_per_kg ?? line.unit_rate ?? 0);
    const lineTotal = Number(line.final_line_value ?? line.line_total_before_gst ?? line.line_total ?? 0);

    item.quantity = weight > 0 ? weight : Number(line.order_quantity ?? line.quantity ?? 0);
    item.unit_rate = rate > 0 ? rate : null;
    item.line_total = lineTotal > 0 ? lineTotal : (weight > 0 && rate > 0 ? Math.round(weight * rate * 100) / 100 : null);

    return item;
  });
}
