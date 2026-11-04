// Pure conversion from lifecycle form text inputs to a typed, validated mutation.
import { LABEL_FIELDS, lifecycleMutationSchema, type LifecycleAction, type LifecycleLookupKind } from "@/lib/workflow/lifecycle";

export type LifecycleField = { key: string; label: string; type?: "text" | "note" | "number" | "boolean" | "date" | "tranches" | "outputs" | "stock_list" | "label_fields";
  lookup?: LifecycleLookupKind; contextKey?: string; filter?: string; filterKey?: string; options?: Record<string, string>; step?: string; min?: number; max?: number; optional?: boolean;
  help?: string; upper?: boolean; when?: Record<string, readonly string[]> };

export const MAX_TRANCHES = 4;
export const MAX_OUTPUTS = 6;
export const MAX_MERGE = 6;

/** A field shown only for some choices (for example the sample event) is omitted otherwise. */
export function lifecycleFieldVisible(field: LifecycleField, values: Record<string, string>, fixed: Record<string, unknown>) {
  if (!field.when) return true;
  return Object.entries(field.when).every(([key, allowed]) => allowed.includes(String(fixed[key] ?? values[key] ?? "")));
}

const filled = (value: string | undefined) => (value ?? "").trim();

/** Builds the typed mutation from text inputs. Blank optional values and blank list rows are omitted, never sent as zero. */
export function buildLifecycleMutation(action: LifecycleAction, fields: LifecycleField[], values: Record<string, string>, fixed: Record<string, unknown>) {
  const mutation: Record<string, unknown> = { action, ...fixed };
  for (const field of fields) {
    if (field.key in fixed || !lifecycleFieldVisible(field, values, fixed)) continue;
    const value = filled(values[field.key]);
    if (field.type === "tranches") {
      mutation.tranches = Array.from({ length: MAX_TRANCHES }, (_, index) => ({ date: filled(values[`tranche:${index}:date`]), kg: filled(values[`tranche:${index}:kg`]) }))
        .filter(row => row.date || row.kg).map(row => ({ date: row.date, kg: row.kg ? Number(row.kg) : Number.NaN }));
    } else if (field.type === "outputs") {
      mutation.outputs = Array.from({ length: MAX_OUTPUTS }, (_, index) => ({ bundle_number: filled(values[`output:${index}:bundle_number`]).toUpperCase(),
        pieces: filled(values[`output:${index}:pieces`]), kg: filled(values[`output:${index}:kg`]) }))
        .filter(row => row.bundle_number || row.pieces || row.kg).map(row => ({ bundle_number: row.bundle_number, pieces: row.pieces ? Number(row.pieces) : Number.NaN, kg: row.kg ? Number(row.kg) : Number.NaN }));
    } else if (field.type === "stock_list") {
      mutation[field.key] = Array.from({ length: MAX_MERGE }, (_, index) => filled(values[`stock:${index}`])).filter(Boolean);
    } else if (field.type === "label_fields") {
      mutation[field.key] = Object.keys(LABEL_FIELDS).filter(key => values[`label:${key}`] === "true");
    } else if (!value) { if (!field.optional) mutation[field.key] = field.type === "number" || field.type === "boolean" ? undefined : ""; }
    else if (field.type === "number") mutation[field.key] = Number(value);
    else if (field.type === "boolean") mutation[field.key] = value === "true";
    else mutation[field.key] = field.upper ? value.toUpperCase() : value;
  }
  return lifecycleMutationSchema.safeParse(mutation);
}
