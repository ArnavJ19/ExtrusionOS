// Pure conversion from assurance form text inputs to a typed, validated mutation.
import { CHANGE_FIELDS, assuranceMutationSchema, type AssuranceAction, type AssuranceLookupKind } from "@/lib/workflow/assurance";

export type AssuranceField = { key: string; label: string; type?: "text" | "note" | "number" | "boolean" | "date" | "instant" | "file_hash" | "changes"; lookup?: AssuranceLookupKind;
  contextKey?: string; filterKey?: string; options?: Record<string, string>; step?: string; min?: number; max?: number; optional?: boolean; help?: string; upper?: boolean };

export const NUMERIC_CHANGES = new Set(["quantity_kg", "cut_length", "pieces_per_bundle"]);
/** Builds the typed mutation from text inputs. Blank optional values are omitted, never sent as zero. */
export function buildAssuranceMutation(action: AssuranceAction, fields: AssuranceField[], values: Record<string, string>, fixed: Record<string, unknown>) {
  const mutation: Record<string, unknown> = { action, ...fixed };
  for (const field of fields) {
    const value = (values[field.key] ?? "").trim();
    if (field.type === "changes") {
      const changes: Record<string, unknown> = {};
      for (const key of Object.keys(CHANGE_FIELDS)) { const raw = (values[`change:${key}`] ?? "").trim(); if (raw) changes[key] = NUMERIC_CHANGES.has(key) ? Number(raw) : raw; }
      mutation.changes = changes;
    } else if (!value) { if (!field.optional) mutation[field.key] = field.type === "number" || field.type === "boolean" ? undefined : ""; }
    else if (field.type === "number") mutation[field.key] = Number(value);
    else if (field.type === "boolean") mutation[field.key] = value === "true";
    else if (field.type === "instant") { const parsed = new Date(`${value}:00+05:30`); mutation[field.key] = Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : ""; }
    else mutation[field.key] = field.upper ? value.toUpperCase() : value;
  }
  if (action === "drawing.register" && values["file_name"]) mutation.file_name = values["file_name"].slice(0, 180);
  return assuranceMutationSchema.safeParse(mutation);
}
