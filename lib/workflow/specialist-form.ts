// Pure conversion from specialist form text inputs to a typed, validated mutation.
import { NOTELESS_ACTIONS, specialistMutationSchema, type SpecialistAction, type SpecialistLookupKind } from "@/lib/workflow/specialist";

export type SpecialistFieldType = "text" | "note" | "multiline" | "number" | "date" | "datetime" | "bool" | "rows" | "list" | "multi";
export type SpecialistColumn = { key: string; label: string; type?: "text" | "number"; lookup?: SpecialistLookupKind; step?: string; min?: number };
export type SpecialistField = { key: string; label: string; type?: SpecialistFieldType; lookup?: SpecialistLookupKind; parentKey?: string; options?: Record<string, string>; step?: string; min?: number; max?: number;
  optional?: boolean; help?: string; when?: Record<string, readonly string[]>; columns?: SpecialistColumn[] };

/** A field shown only for some choices (for example the job of an issue) is omitted otherwise. */
export function specialistFieldVisible(field: SpecialistField, values: Record<string, string>, fixed: Record<string, unknown>) {
  if (!field.when) return true;
  return Object.entries(field.when).every(([key, allowed]) => allowed.includes(String(fixed[key] ?? values[key] ?? "")));
}

// The database refuses line breaks in one-line text; multi-line explanations are joined before they are sent.
const filled = (value: string | undefined) => (value ?? "").replace(/\s*\r?\n\s*/g, " ").trim();

/** Rows are kept as JSON text in the form; numeric columns are converted, blank cells are omitted. */
export function parseRows(raw: string, columns: SpecialistColumn[]): Record<string, unknown>[] {
  let rows: unknown;
  try { rows = JSON.parse(raw || "[]"); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.map(entry => {
    const source = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const column of columns) {
      const value = String(source[column.key] ?? "").trim();
      if (value === "") continue;
      out[column.key] = column.type === "number" ? Number(value) : value;
    }
    return out;
  });
}

/** Builds the typed mutation from text inputs. Blank optional values are omitted, never sent as zero. */
export function buildSpecialistMutation(action: SpecialistAction, fields: SpecialistField[], values: Record<string, string>, fixed: Record<string, unknown>) {
  const mutation: Record<string, unknown> = { action, ...fixed };
  for (const field of fields) {
    if (field.key in fixed || !specialistFieldVisible(field, values, fixed)) continue;
    if (field.key === "note" && NOTELESS_ACTIONS.includes(action)) continue;
    const keepLines = field.type === "multiline" || field.type === "rows" || field.type === "multi";
    const raw = keepLines ? (values[field.key] ?? "").trim() : filled(values[field.key]);
    if (!raw || (field.type === "rows" && raw === "[]") || (field.type === "multi" && raw === "[]")) {
      if (!field.optional) mutation[field.key] = field.type === "number" ? undefined : ["rows", "list", "multi"].includes(field.type ?? "") ? [] : field.type === "bool" ? undefined : "";
      continue;
    }
    if (field.type === "number") mutation[field.key] = Number(raw);
    else if (field.type === "bool") mutation[field.key] = raw === "yes";
    else if (field.type === "datetime") { const date = new Date(raw); mutation[field.key] = Number.isNaN(date.getTime()) ? raw : date.toISOString(); }
    else if (field.type === "list") mutation[field.key] = raw.split(",").map(item => item.trim()).filter(Boolean);
    else if (field.type === "rows") mutation[field.key] = parseRows(raw, field.columns ?? []);
    else if (field.type === "multi") { try { const ids = JSON.parse(raw); mutation[field.key] = Array.isArray(ids) ? ids : []; } catch { mutation[field.key] = []; } }
    else if (field.type === "multiline") mutation[field.key] = raw.replace(/\r\n/g, "\n");
    else mutation[field.key] = raw;
  }
  return specialistMutationSchema.safeParse(mutation);
}
