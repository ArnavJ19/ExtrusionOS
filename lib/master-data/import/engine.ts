// AP-006: column mapping, row validation and the rejected-row report. Pure functions shared by the master import
// (Settings → Data → Import masters) and the cut-over opening sections (Settings → Data → Cut-over).
import { recordsToCsv } from "../../utils/csv.ts";
import { parseRow, type ImportDefinition } from "./definitions.ts";
import type { Sheet } from "./spreadsheet.ts";

export type ColumnMapping = Record<string, string | null>;
export type StagedRow = { row: number; values: Record<string, string | number | null>; source: Record<string, string> };
export type RejectedRow = { row: number; errors: string[]; values: Record<string, string> };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();

/** Header text joined in order; the server hashes it so a remembered mapping is found for the same sheet layout. */
export function headerSignatureSource(headers: string[]) {
  return headers.map(normalize).join("|");
}

/** Maps each sheet column to a field: a remembered mapping first, then the field key, label or a known synonym. */
export function autoMap(headers: string[], definition: ImportDefinition, remembered?: ColumnMapping | null): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  const known = new Set(definition.fields.map(field => field.key));
  for (const header of headers) {
    if (!header) continue;
    const prior = remembered?.[header];
    if (prior && known.has(prior) && !taken.has(prior)) { mapping[header] = prior; taken.add(prior); continue; }
    if (remembered && header in remembered && remembered[header] === null) { mapping[header] = null; continue; }
    const text = normalize(header);
    const field = definition.fields.find(candidate => !taken.has(candidate.key)
      && [candidate.key.replace(/_/g, " "), candidate.label, ...(candidate.synonyms ?? [])].some(name => normalize(name) === text));
    mapping[header] = field?.key ?? null;
    if (field) taken.add(field.key);
  }
  return mapping;
}

export function mappingProblems(mapping: ColumnMapping, definition: ImportDefinition) {
  const used = Object.values(mapping).filter((value): value is string => Boolean(value));
  const duplicates = used.filter((value, index) => used.indexOf(value) !== index);
  const missing = definition.fields.filter(field => field.required && !used.includes(field.key)).map(field => field.label);
  const unknown = used.filter(value => !definition.fields.some(field => field.key === value));
  return { missing, duplicates: [...new Set(duplicates)], unknown };
}

export function validateSheet(sheet: Sheet, mapping: ColumnMapping, definition: ImportDefinition) {
  const valid: StagedRow[] = [];
  const rejected: RejectedRow[] = [];
  for (const entry of sheet.rows) {
    if (entry.cells.every(cell => cell.trim() === "")) continue;
    const source: Record<string, string> = {};
    const record: Record<string, string> = {};
    sheet.headers.forEach((header, index) => {
      if (!header) return;
      source[header] = entry.cells[index] ?? "";
      const key = mapping[header];
      if (key) record[key] = entry.cells[index] ?? "";
    });
    const parsed = parseRow(definition, record);
    if (parsed.ok) valid.push({ row: entry.row, values: parsed.values, source });
    else rejected.push({ row: entry.row, errors: parsed.errors, values: source });
  }
  return { valid, rejected };
}

/** The rejected rows with the original cells and the reasons, ready to fix in Excel and upload again. */
export function rejectedRowsCsv(headers: string[], rejected: RejectedRow[]) {
  const columns = ["Sheet row", ...headers.filter(Boolean), "Problems"];
  return recordsToCsv(columns, rejected.map(row => ({ ...row.values, "Sheet row": row.row, Problems: row.errors.join("; ") })));
}

/** A blank template: the column headings only (the page lists what each column accepts). */
export function templateCsv(definition: ImportDefinition) {
  return recordsToCsv(definition.fields.map(field => field.label), []);
}

export function fieldGuide(definition: ImportDefinition) {
  return definition.fields.map(field => ({
    label: field.label, required: Boolean(field.required),
    accepts: field.options ? Object.values(field.options).join(", ") : field.kind === "date" ? "Date as DD/MM/YYYY" : field.kind === "number" || field.kind === "integer" ? "Number" : field.kind === "gstin" ? "15-character GSTIN" : field.kind === "phone" ? "10-digit Indian number" : "Text",
    hint: field.hint ?? null, defaultValue: field.defaultValue && field.options ? field.options[field.defaultValue] : null
  }));
}
