// Pure conversion from commercial form text inputs to a typed, validated mutation.
import { NOTELESS_ACTIONS, commercialMutationSchema, type CommercialAction, type CommercialLookupKind } from "@/lib/workflow/commercial";

export type CommercialFieldType = "text" | "note" | "number" | "date" | "bool" | "brackets" | "changes" | "codes";
export type CommercialField = { key: string; label: string; type?: CommercialFieldType; lookup?: CommercialLookupKind; parentKey?: string; options?: Record<string, string>; step?: string; min?: number; max?: number;
  optional?: boolean; help?: string; when?: Record<string, readonly string[]> };

/** A field shown only for some choices (for example the credit of a credit refund) is omitted otherwise. */
export function commercialFieldVisible(field: CommercialField, values: Record<string, string>, fixed: Record<string, unknown>) {
  if (!field.when) return true;
  return Object.entries(field.when).every(([key, allowed]) => allowed.includes(String(fixed[key] ?? values[key] ?? "")));
}

// The database refuses line breaks; multi-line text is joined into one line before it is sent.
const filled = (value: string | undefined) => (value ?? "").replace(/\s*\r?\n\s*/g, " ").trim();

/** One bracket per line: "from | to | rate". A blank end means the bracket has no upper limit. */
export function parseBrackets(input: string): { from: number; to?: number; rate: number }[] | null {
  const rows: { from: number; to?: number; rate: number }[] = [];
  for (const line of input.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
    const parts = line.split("|").map(item => item.trim());
    if (parts.length !== 3 || !/^\d+(\.\d+)?$/.test(parts[0]) || (parts[1] !== "" && !/^\d+(\.\d+)?$/.test(parts[1])) || !/^\d+(\.\d+)?$/.test(parts[2])) return null;
    rows.push({ from: Number(parts[0]), ...(parts[1] === "" ? {} : { to: Number(parts[1]) }), rate: Number(parts[2]) });
  }
  return rows.length ? rows : null;
}

/** Builds the typed mutation from text inputs. Blank optional values are omitted, never sent as zero. */
export function buildCommercialMutation(action: CommercialAction, fields: CommercialField[], values: Record<string, string>, fixed: Record<string, unknown>) {
  const mutation: Record<string, unknown> = { action, ...fixed };
  for (const field of fields) {
    if (field.key in fixed || !commercialFieldVisible(field, values, fixed)) continue;
    if (field.key === "note" && NOTELESS_ACTIONS.includes(action)) continue;
    const raw = field.type === "brackets" ? (values[field.key] ?? "").trim() : filled(values[field.key]);
    if (!raw) { if (!field.optional) mutation[field.key] = field.type === "number" ? undefined : field.type === "brackets" || field.type === "changes" || field.type === "codes" ? [] : ""; continue; }
    if (field.type === "number") mutation[field.key] = Number(raw);
    else if (field.type === "bool") mutation[field.key] = raw === "yes";
    else if (field.type === "brackets") mutation[field.key] = parseBrackets(raw) ?? [{ from: Number.NaN, rate: Number.NaN }];
    else if (field.type === "codes") mutation[field.key] = raw.split(",").map(item => item.trim()).filter(Boolean);
    else if (field.type === "changes") { try { mutation[field.key] = JSON.parse(raw); } catch { mutation[field.key] = []; } }
    else mutation[field.key] = raw;
  }
  return commercialMutationSchema.safeParse(mutation);
}
