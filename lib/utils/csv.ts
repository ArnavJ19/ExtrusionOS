const SPREADSHEET_FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/;

/**
 * Prevent spreadsheet applications from interpreting user-controlled cells as formulas.
 * A leading apostrophe is rendered as text by Excel and compatible spreadsheet tools.
 */
export function neutralizeSpreadsheetFormula(value: unknown): string {
  const text = String(value ?? "");
  return SPREADSHEET_FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export function escapeCsvCell(value: unknown): string {
  const text = neutralizeSpreadsheetFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function recordsToCsv(headers: string[], rows: Record<string, unknown>[]): string {
  return [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(",")),
  ].join("\n");
}
