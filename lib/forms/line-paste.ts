// NOV-011: reviewable paste of repeated lines from a spreadsheet, starting with the dispatch bundle
// manifest. Pasted text is parsed into a review grid; nothing is saved or executed. Each row is
// valid, ambiguous (needs an explicit source choice) or invalid with its reason.
import { delimiterFor, splitDelimitedLine } from "./quote-paste";

export const MAX_PASTED_BUNDLES = 60;
export const BUNDLE_TAG_PATTERN = /^[A-Z0-9][A-Z0-9/_-]{0,39}$/;

export type PasteSource = { id: string; labels: string[] };
export type BundleLine = { bundle_number: string; source_line_id: string; number_of_pieces: string; net_length_m: string; gross_weight_kg: string; tare_weight_kg: string };
export type PastedBundleRow = { sourceRow: number; status: "valid" | "ambiguous" | "invalid"; errors: string[]; candidates: string[]; values: BundleLine; sourceText: string };

const COLUMNS = {
  bundle_number: ["bundle", "bundle id", "bundle number", "bundle tag", "tag", "scan bundle id"],
  source: ["source", "material source", "job", "job number", "stock batch", "batch"],
  number_of_pieces: ["pieces", "actual pieces", "pcs", "qty pcs", "quantity pcs"],
  net_length_m: ["metres", "meters", "actual metres", "actual meters", "length m", "net length m", "metres m", "meters m"],
  gross_weight_kg: ["gross kg", "gross weight kg", "gross wt kg"],
  tare_weight_kg: ["tare kg", "tare weight kg", "tare wt kg"]
} as const;
type Column = keyof typeof COLUMNS;
const WRONG_UNITS = /\b(mm|millimetres?|millimeters?|cm|grams?|g|tons?|tonnes?|lbs?|ft|feet)\b/;

function header(value: string) {
  return value.toLowerCase().replace(/[()[\]]/g, " ").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
/** A cell that a spreadsheet would treat as a formula is refused rather than interpreted. */
export function isFormulaCell(value: string) {
  return /^[=+@]/.test(value.trim()) || /^\t|^\r/.test(value);
}
const decimal = (value: string, places: number) => new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(value);

export function parseBundlePaste(text: string, sources: PasteSource[], existingTags: readonly string[]): { rows: PastedBundleRow[]; error: string | null } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return { rows: [], error: "Paste a header row and at least one bundle row." };
  if (lines.length - 1 > MAX_PASTED_BUNDLES) return { rows: [], error: `Paste up to ${MAX_PASTED_BUNDLES} bundles at a time.` };
  const delimiter = delimiterFor(lines[0]);
  const parsedHeader = splitDelimitedLine(lines[0], delimiter);
  if (parsedHeader.error) return { rows: [], error: `Header row: ${parsedHeader.error}` };
  const headers = parsedHeader.cells.map(header);
  const index: Partial<Record<Column, number>> = {};
  for (const [position, name] of headers.entries()) {
    const column = (Object.keys(COLUMNS) as Column[]).find(key => (COLUMNS[key] as readonly string[]).includes(name));
    if (!column) {
      if (WRONG_UNITS.test(name)) return { rows: [], error: `Column "${parsedHeader.cells[position]}" uses an unsupported unit. Use metres and kg.` };
      return { rows: [], error: `Unsupported column "${parsedHeader.cells[position] || "(blank header)"}". Use Bundle, Source, Pieces, Metres, Gross kg and Tare kg.` };
    }
    if (index[column] !== undefined) return { rows: [], error: `Column headers must be unique; "${parsedHeader.cells[position]}" repeats ${column.replace(/_/g, " ")}.` };
    index[column] = position;
  }
  const missing = (["bundle_number", "number_of_pieces", "net_length_m", "gross_weight_kg", "tare_weight_kg"] as Column[]).filter(column => index[column] === undefined);
  if (missing.length) return { rows: [], error: "Required columns: Bundle, Pieces, Metres, Gross kg and Tare kg. Source is optional when the order has one source." };

  const taken = new Map<string, string>(existingTags.filter(Boolean).map(tag => [tag.trim().toUpperCase(), "already on this load"]));
  const rows: PastedBundleRow[] = [];
  for (const [offset, line] of lines.slice(1).entries()) {
    const sourceRow = offset + 2;
    const parsed = splitDelimitedLine(line, delimiter);
    const empty: BundleLine = { bundle_number: "", source_line_id: "", number_of_pieces: "", net_length_m: "", gross_weight_kg: "", tare_weight_kg: "" };
    // A formula often contains quotes the splitter cannot read; name the real reason.
    if (parsed.error) { rows.push({ sourceRow, status: "invalid", errors: [line.split(delimiter).some(isFormulaCell) ? "Formulas are not accepted. Paste values only." : parsed.error], candidates: [], values: empty, sourceText: "" }); continue; }
    const cells = parsed.cells;
    const errors: string[] = [];
    if (cells.length > headers.length && cells.slice(headers.length).some(cell => cell.trim())) errors.push(`Found ${cells.length - headers.length} cell(s) beyond the declared columns.`);
    if (cells.some(isFormulaCell)) errors.push("Formulas are not accepted. Paste values only.");
    const cell = (column: Column) => (index[column] === undefined ? "" : (cells[index[column]!] ?? "").trim());
    const tag = cell("bundle_number").toUpperCase();
    const values: BundleLine = { ...empty, bundle_number: tag, number_of_pieces: cell("number_of_pieces"), net_length_m: cell("net_length_m"), gross_weight_kg: cell("gross_weight_kg"), tare_weight_kg: cell("tare_weight_kg") };
    if (!BUNDLE_TAG_PATTERN.test(tag)) errors.push("Enter the bundle tag using letters, digits, slash, dash or underscore.");
    else if (taken.has(tag)) errors.push(`Bundle ${tag} is ${taken.get(tag)}.`);
    else taken.set(tag, `repeated in row ${sourceRow}`);
    if (!/^\d+$/.test(values.number_of_pieces) || Number(values.number_of_pieces) < 1) errors.push("Pieces must be a whole number of at least 1.");
    if (!decimal(values.net_length_m, 3) || Number(values.net_length_m) <= 0) errors.push("Metres must be above zero with at most 3 decimals.");
    if (!decimal(values.gross_weight_kg, 3) || Number(values.gross_weight_kg) <= 0) errors.push("Gross kg must be above zero with at most 3 decimals.");
    if (!decimal(values.tare_weight_kg, 3)) errors.push("Tare kg must be zero or more with at most 3 decimals.");
    else if (decimal(values.gross_weight_kg, 3) && Number(values.tare_weight_kg) >= Number(values.gross_weight_kg)) errors.push("Tare kg must be less than gross kg.");
    const sourceText = cell("source");
    const key = sourceText.toLowerCase();
    const candidates = key ? sources.filter(source => source.labels.some(label => label.trim().toLowerCase() === key)).map(source => source.id) : sources.map(source => source.id);
    if (key && !candidates.length) errors.push(`Source "${sourceText}" does not match a dispatch-ready source of this order.`);
    if (!errors.length && candidates.length === 1) values.source_line_id = candidates[0];
    rows.push({ sourceRow, values, sourceText, candidates, errors, status: errors.length ? "invalid" : candidates.length === 1 ? "valid" : "ambiguous" });
  }
  return { rows, error: null };
}

/** Duplicating a line keeps its source and typical counts, and clears the tag and the weighed gross. */
export function duplicateBundleLine(line: BundleLine): BundleLine {
  return { ...line, bundle_number: "", gross_weight_kg: "" };
}
