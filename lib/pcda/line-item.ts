/**
 * PCDA Line Item Reuse/Copy Utilities
 *
 * Pure functions for copying a Technical Line Item from an upstream record
 * to a downstream module. Preserves not-captured state and stamps source reference.
 *
 * Requirements: 1.3, 1.4, 1.5
 */

import type { TechnicalLineItem, SourceRef } from "./types";
import { TECHNICAL_LINE_ITEM_FIELDS } from "./field-map.ts";

/**
 * Creates a deep copy of a source line for reuse in a downstream module.
 *
 * - Copies every field in TECHNICAL_LINE_ITEM_FIELDS from source (preserving null/not-captured state)
 * - Stamps source_record_id and source_line_id from the provided reference
 * - Generates a new unique id via crypto.randomUUID()
 * - Preserves company_id from source (same tenant)
 * - Resets revision_number to 1 for the downstream copy
 * - Pure function: the source object is never mutated; downstream edits do not affect source
 *
 * All fields on TechnicalLineItem are primitives (string | number | boolean | null),
 * so a field-by-field copy is sufficient to guarantee isolation.
 */
export function copyLineForReuse(source: TechnicalLineItem, ref: SourceRef): TechnicalLineItem {
  const copy: Record<string, unknown> = {};

  // Copy every canonical field, preserving null/not-captured state
  for (const field of TECHNICAL_LINE_ITEM_FIELDS) {
    copy[field] = source[field];
  }

  // New unique identity for the downstream line
  copy.id = crypto.randomUUID();

  // Preserve tenant scope from source
  copy.company_id = source.company_id;

  // Stamp source reference for traceability (Req 1.4)
  copy.source_record_id = ref.sourceRecordId;
  copy.source_line_id = ref.sourceLineId;

  // Reset revision for the new downstream copy
  copy.revision_number = 1;

  return copy as unknown as TechnicalLineItem;
}

/**
 * Validates that a line has the complete canonical field set.
 * Returns true if all fields from TECHNICAL_LINE_ITEM_FIELDS exist as keys.
 */
export function hasCompleteFieldSet(line: Record<string, unknown>): boolean {
  for (const field of TECHNICAL_LINE_ITEM_FIELDS) {
    if (!(field in line)) return false;
  }
  return true;
}
