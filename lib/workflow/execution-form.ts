// Pure conversion from execution form text inputs to a typed, validated mutation.
import { NOTELESS_ACTIONS, executionMutationSchema, istInstant, type ExecutionAction, type ExecutionLookupKind } from "@/lib/workflow/execution";

export type ExecutionFieldType = "text" | "note" | "number" | "date" | "datetime" | "bool" | "multi" | "phone";
export type ExecutionField = { key: string; label: string; type?: ExecutionFieldType; lookup?: ExecutionLookupKind; lookupBy?: { key: string; kinds: Record<string, ExecutionLookupKind> }; parentKey?: string;
  options?: Record<string, string>; step?: string; min?: number; max?: number; optional?: boolean; help?: string; when?: Record<string, readonly string[]> };

/** A field shown only for some choices (for example the die of a die pass) is omitted otherwise. */
export function executionFieldVisible(field: ExecutionField, values: Record<string, string>, fixed: Record<string, unknown>) {
  if (!field.when) return true;
  return Object.entries(field.when).every(([key, allowed]) => allowed.includes(String(fixed[key] ?? values[key] ?? "")));
}
/** The lookup a field uses, which can depend on an earlier choice. */
export function executionLookupKind(field: ExecutionField, values: Record<string, string>, fixed: Record<string, unknown>) {
  if (field.lookupBy) return field.lookupBy.kinds[String(fixed[field.lookupBy.key] ?? values[field.lookupBy.key] ?? "")];
  return field.lookup;
}

// The database refuses line breaks; multi-line text is joined into one line before it is sent.
const filled = (value: string | undefined) => (value ?? "").replace(/\s*\r?\n\s*/g, " ").trim();

/** Builds the typed mutation from text inputs. Blank optional values are omitted, never sent as zero. */
export function buildExecutionMutation(action: ExecutionAction, fields: ExecutionField[], values: Record<string, string>, fixed: Record<string, unknown>) {
  const mutation: Record<string, unknown> = { action, ...fixed };
  for (const field of fields) {
    if (field.key in fixed || !executionFieldVisible(field, values, fixed)) continue;
    if (field.key === "note" && NOTELESS_ACTIONS.includes(action)) continue;
    const value = filled(values[field.key]);
    if (field.type === "multi") {
      const items = value ? value.split(",").filter(Boolean) : [];
      if (items.length || !field.optional) mutation[field.key] = items;
    } else if (!value) { if (!field.optional) mutation[field.key] = field.type === "number" ? undefined : ""; }
    else if (field.type === "number") mutation[field.key] = Number(value);
    else if (field.type === "bool") mutation[field.key] = value === "yes";
    else if (field.type === "datetime") mutation[field.key] = istInstant(value);
    else mutation[field.key] = value;
  }
  return executionMutationSchema.safeParse(mutation);
}
