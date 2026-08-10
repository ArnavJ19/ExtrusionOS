/**
 * Builds invoice lines from order or dispatch PCDA lines while preserving
 * source identity and technical/commercial fields.
 */

import { TECHNICAL_LINE_ITEM_FIELDS } from "./field-map.ts";

// Internal cost/margin/supplier fields must never be copied onto invoice_items: an invoice
// is a customer billing document, and any invoice PDF/portal doing select("*") would leak them.
const RESTRICTED_INVOICE_FIELDS = ["internal_cost", "supplier_rate", "margin", "internal_note"];

const invoiceCopyFields = TECHNICAL_LINE_ITEM_FIELDS.filter(
  (field) => !["id", "company_id", ...RESTRICTED_INVOICE_FIELDS].includes(String(field))
);

export function buildInvoiceItems(
  sourceLines: Record<string, any>[],
  invoiceId: string,
  companyId: string
): Record<string, any>[] {
  return sourceLines.map((line) => {
    const item: Record<string, any> = { company_id: companyId, invoice_id: invoiceId };

    for (const field of invoiceCopyFields) {
      if (Object.prototype.hasOwnProperty.call(line, field)) item[field] = line[field];
    }

    item.source_record_id = line.dispatch_id ?? line.order_id ?? line.source_record_id ?? null;
    item.source_line_id = line.id ?? line.source_line_id ?? null;
    item.order_item_id = line.order_item_id ?? (line.order_id ? line.id : null) ?? null;
    item.quote_item_id = line.quote_item_id ?? null;
    item.profile_id = line.profile_id ?? null;
    item.die_id = line.die_id ?? null;
    item.finishing_type = line.finishing_type ?? null;
    item.item_description = line.item_description ?? line.component_description ?? line.notes ?? null;

    const isDispatchLine = Boolean(line.dispatch_id || line.bundle_number || line.gross_weight_kg);
    const weight = Number(
      isDispatchLine
        ? line.net_weight_kg ?? line.gross_weight_kg ?? line.actual_weight ?? line.quantity_kg ?? 0
        : line.actual_weight ?? line.billing_weight_kg ?? line.quantity_kg ?? line.total_weight_kg ?? 0
    );
    const rate = Number(line.net_rate ?? line.price_per_kg ?? line.unit_rate ?? 0);
    const sourceLineTotal = Number(line.final_line_value ?? line.line_total_before_gst ?? line.line_total ?? 0);
    const weightRateTotal = weight > 0 && rate > 0 ? Math.round(weight * rate * 100) / 100 : 0;

    item.quantity = weight > 0 ? weight : Number(line.order_quantity ?? line.quantity ?? 0);
    item.unit_rate = rate > 0 ? rate : null;
    // A packing line can represent only part of the original order line. Billing
    // its copied final_line_value would charge the full order once per dispatch.
    item.line_total = isDispatchLine && weightRateTotal > 0
      ? weightRateTotal
      : sourceLineTotal > 0
        ? sourceLineTotal
        : weightRateTotal > 0
          ? weightRateTotal
          : null;

    return item;
  });
}
