/**
 * PCDA Customer Sanitization
 * 
 * Strips internal-only fields from a Technical Line Item before
 * rendering customer-facing documents (quote PDFs, approval sheets, portal views).
 * 
 * Omitted fields: internal cost, supplier rate, margin/profit, and internal notes.
 * These are omitted entirely (not masked) from the output type.
 */

import type { TechnicalLineItem } from "./types";

/** Fields that must never appear in customer-facing outputs */
const RESTRICTED_FIELDS = [
  "internal_cost",
  "supplier_rate",
  "margin",
  "profit",
  "gross_margin",
  "total_cost",
  "cost_per_kg",
  "cost_per_meter",
  "cost_per_piece",
  "internal_note",
] as const;

export type RestrictedField = typeof RESTRICTED_FIELDS[number];

/** A sanitized line item with restricted fields removed */
export type SanitizedLineItem = Omit<TechnicalLineItem, Extract<RestrictedField, keyof TechnicalLineItem>>;

/**
 * Removes restricted fields from a line item for customer-facing use.
 * Returns a new object — does not mutate the source.
 */
export function sanitizeForCustomer(line: TechnicalLineItem): SanitizedLineItem {
  const sanitized = { ...line } as Record<string, unknown>;
  for (const field of RESTRICTED_FIELDS) {
    delete sanitized[field];
  }
  return sanitized as SanitizedLineItem;
}

/**
 * Checks whether a field is restricted from customer-facing outputs.
 */
export function isRestrictedField(field: string): field is RestrictedField {
  return (RESTRICTED_FIELDS as readonly string[]).includes(field);
}
