// Pure conversion from improvement form text inputs to a typed, validated mutation.
import { NOTELESS_ACTIONS, improvementMutationSchema, type ImprovementAction, type ImprovementLookupKind } from "@/lib/workflow/improvement";

export type ImprovementField = { key: string; label: string; type?: "text" | "note" | "number" | "date";
  lookup?: ImprovementLookupKind; filterKey?: string; options?: Record<string, string>; step?: string; min?: number; max?: number; optional?: boolean; help?: string;
  when?: Record<string, readonly string[]> };

/** A field shown only for some choices (for example the decline reason) is omitted otherwise. */
export function improvementFieldVisible(field: ImprovementField, values: Record<string, string>, fixed: Record<string, unknown>) {
  if (!field.when) return true;
  return Object.entries(field.when).every(([key, allowed]) => allowed.includes(String(fixed[key] ?? values[key] ?? "")));
}

// The database refuses line breaks; multi-line text is joined into one line before it is sent.
const filled = (value: string | undefined) => (value ?? "").replace(/\s*\r?\n\s*/g, " ").trim();

/** Builds the typed mutation from text inputs. Blank optional values are omitted, never sent as zero. */
export function buildImprovementMutation(action: ImprovementAction, fields: ImprovementField[], values: Record<string, string>, fixed: Record<string, unknown>) {
  const mutation: Record<string, unknown> = { action, ...fixed };
  for (const field of fields) {
    if (field.key in fixed || !improvementFieldVisible(field, values, fixed)) continue;
    if (field.key === "note" && NOTELESS_ACTIONS.includes(action)) continue;
    const value = filled(values[field.key]);
    if (!value) { if (!field.optional) mutation[field.key] = field.type === "number" ? undefined : ""; }
    else if (field.type === "number") mutation[field.key] = Number(value);
    else mutation[field.key] = value;
  }
  return improvementMutationSchema.safeParse(mutation);
}
