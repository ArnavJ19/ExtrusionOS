/**
 * PCDA Not-Captured Labels
 * 
 * Standard empty-state labels shown when source data is absent.
 * The system NEVER displays a fabricated value — only these labels.
 */

import { type CalcResult, isCaptured } from "../calculations/pcda/sentinel.ts";

export const NOT_CAPTURED_LABEL = "Not Captured" as const;
export const MISSING_COST_LABEL = "Missing Cost" as const;
export const PENDING_APPROVAL_LABEL = "Pending Approval" as const;
export const NO_DRAWING_LABEL = "No Drawing Uploaded" as const;
export const NO_ACTIVE_DIE_LABEL = "No Active Die Linked" as const;

export type NotCapturedLabel =
  | typeof NOT_CAPTURED_LABEL
  | typeof MISSING_COST_LABEL
  | typeof PENDING_APPROVAL_LABEL
  | typeof NO_DRAWING_LABEL
  | typeof NO_ACTIVE_DIE_LABEL;

/**
 * Maps a CalcResult to a display value.
 * If the result is NOT_CAPTURED, returns the specified label (defaults to "Not Captured").
 * If the result is a number, returns it as-is for formatting by the UI layer.
 */
export function mapCalcResultToDisplay(
  result: CalcResult,
  label?: string
): string | number {
  if (isCaptured(result)) return result;
  return label ?? NOT_CAPTURED_LABEL;
}

/**
 * Maps a nullable value to a display string.
 * Returns the label if the value is null/undefined, otherwise returns the value.
 */
export function mapNullableToDisplay(
  value: unknown,
  label?: string
): string | number | boolean {
  if (value === null || value === undefined) return label ?? NOT_CAPTURED_LABEL;
  return value as string | number | boolean;
}
