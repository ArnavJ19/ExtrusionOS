// AP-024: reading a bank statement export (CSV or Excel) into reviewed statement rows. Banks put a few lines of account
// details above the column headings, so the heading row is found by its words. Unreadable dates or amounts are reported
// per row and never turned into zero; a row needs exactly one of credit or debit. The database dedupes and matches.
import { z } from "zod";

export const BANK_DATE_FORMATS = ["DD/MM/YYYY", "DD-MM-YYYY", "YYYY-MM-DD", "DD-MMM-YYYY", "DD/MM/YY"] as const;
export type BankDateFormat = (typeof BANK_DATE_FORMATS)[number];
export type BankMapping = { date: number; narration: number; reference: number | null; credit: number | null; debit: number | null; amount: number | null; drcr: number | null };
export type StatementRow = { line_no: number; txn_date: string; narration: string; reference: string | null; credit: string | null; debit: string | null };
export type StatementRowError = { line_no: number; error: string };

export const bankMappingSchema = z.object({
  date: z.number().int().min(0), narration: z.number().int().min(0), reference: z.number().int().min(0).nullable(), credit: z.number().int().min(0).nullable(),
  debit: z.number().int().min(0).nullable(), amount: z.number().int().min(0).nullable(), drcr: z.number().int().min(0).nullable()
}).strict().refine(m => m.credit !== null || m.amount !== null, "Choose the credit (deposit) column or a single amount column");

const SYNONYMS: Record<keyof BankMapping, RegExp> = {
  date: /^(txn |transaction |value )?date$|^tran date$|^date of transaction$/,
  narration: /narration|description|particulars|remarks|details/,
  reference: /ref|utr|chq|cheque|instrument/,
  credit: /^(credit|deposit|cr)( amount| amt)?(\(inr\)| inr)?$|deposits?|credit amount/,
  debit: /^(debit|withdrawal|dr)( amount| amt)?(\(inr\)| inr)?$|withdrawals?|debit amount/,
  amount: /^(transaction )?amount( \(inr\))?$/,
  drcr: /^(dr ?\/ ?cr|cr ?\/ ?dr|type|txn type)$/
};
const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9/() ]+/g, " ").replace(/\s+/g, " ").trim();

/** The heading row: the first of the top 40 rows that names a date column and a narration column. */
export function findHeaderRow(grid: string[][]): number {
  for (let index = 0; index < Math.min(grid.length, 40); index++) {
    const cells = grid[index].map(norm);
    if (cells.some(c => SYNONYMS.date.test(c)) && cells.some(c => SYNONYMS.narration.test(c))) return index;
  }
  return -1;
}

export function autoMapBank(headers: string[]): BankMapping {
  const cells = headers.map(norm);
  const find = (key: keyof BankMapping, exclude: number[] = []) => {
    const index = cells.findIndex((c, i) => !exclude.includes(i) && SYNONYMS[key].test(c));
    return index < 0 ? null : index;
  };
  const date = find("date") ?? 0;
  const narration = find("narration", [date]) ?? 1;
  const credit = find("credit", [date, narration]);
  const debit = find("debit", [date, narration]);
  return { date, narration, reference: find("reference", [date, narration, credit ?? -1, debit ?? -1]), credit, debit,
    amount: credit === null ? find("amount", [date, narration]) : null, drcr: credit === null ? find("drcr", [date, narration]) : null };
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
};

/** A statement date as YYYY-MM-DD, or null when it cannot be read in the chosen format (Excel serial dates are accepted). */
export function parseBankDate(value: string, format: BankDateFormat): string | null {
  const text = value.trim().split(/[ T]/)[0];
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  let match: RegExpMatchArray | null;
  if (format === "YYYY-MM-DD") return (match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)) ? iso(+match[1], +match[2], +match[3]) : null;
  if (format === "DD-MMM-YYYY") {
    match = text.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2}|\d{4})$/);
    if (!match || !MONTHS[match[2].toLowerCase()]) return null;
    return iso(match[3].length === 2 ? 2000 + +match[3] : +match[3], MONTHS[match[2].toLowerCase()], +match[1]);
  }
  const separator = format === "DD-MM-YYYY" ? "-" : "/";
  match = text.match(new RegExp(`^(\\d{1,2})\\${separator}(\\d{1,2})\\${separator}(\\d{2}|\\d{4})$`));
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
  if (format === "DD/MM/YY" && match[3].length !== 2) return null;
  return iso(year, +match[2], +match[1]);
}

/** Indian-format amount ("1,23,456.50", "1,234.00 Cr"); null when blank or zero-like dash; NaN when unreadable. */
export function parseBankAmount(value: string | undefined): number | null {
  const text = String(value ?? "").trim().replace(/^(inr|rs\.?|₹)\s*/i, "").replace(/\s*(cr|dr)\.?$/i, "");
  if (text === "" || text === "-" || text === "--") return null;
  if (!/^-?[\d,]*\.?\d+$/.test(text) || /,,/.test(text)) return Number.NaN;
  const number = Number(text.replace(/,/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : Number.NaN;
}

const money = (value: number) => value.toFixed(2);

export function buildStatementRows(grid: string[][], headerIndex: number, mapping: BankMapping, format: BankDateFormat): { rows: StatementRow[]; errors: StatementRowError[] } {
  const rows: StatementRow[] = [], errors: StatementRowError[] = [];
  for (let index = headerIndex + 1; index < grid.length; index++) {
    const cells = grid[index], line = index - headerIndex;
    const cell = (column: number | null) => (column === null ? "" : String(cells[column] ?? "").trim());
    if (cells.every(c => String(c ?? "").trim() === "")) continue;
    const rawDate = cell(mapping.date), narration = cell(mapping.narration).replace(/\s+/g, " ");
    if (!rawDate && !narration) continue;
    // Closing-balance and total lines at the bottom of an export carry no date.
    if (!rawDate && /total|closing|opening|balance/i.test(narration)) continue;
    const txnDate = parseBankDate(rawDate, format);
    if (!txnDate) { errors.push({ line_no: line, error: `Date "${rawDate || "blank"}" is not ${format}` }); continue; }
    let credit: number | null, debit: number | null;
    if (mapping.credit !== null || mapping.debit !== null) {
      credit = parseBankAmount(cell(mapping.credit)); debit = parseBankAmount(cell(mapping.debit));
    } else {
      const amount = parseBankAmount(cell(mapping.amount)), marker = cell(mapping.drcr).toLowerCase();
      const isDebit = /^d|withdraw/.test(marker) || /dr\.?$/i.test(cell(mapping.amount)) || (amount !== null && amount < 0);
      credit = isDebit ? null : amount; debit = isDebit && amount !== null ? Math.abs(amount) : null;
    }
    if (Number.isNaN(credit) || Number.isNaN(debit)) { errors.push({ line_no: line, error: "Amount cannot be read" }); continue; }
    if ((credit ?? 0) > 0 === (debit ?? 0) > 0) { errors.push({ line_no: line, error: "Needs exactly one of credit or debit" }); continue; }
    if (!narration) { errors.push({ line_no: line, error: "Narration is empty" }); continue; }
    rows.push({ line_no: line, txn_date: txnDate, narration: narration.slice(0, 500), reference: cell(mapping.reference).slice(0, 80) || null,
      credit: credit && credit > 0 ? money(credit) : null, debit: debit && debit > 0 ? money(debit) : null });
  }
  return { rows, errors };
}

/** Header words used to remember a bank's column layout (hashed on the server). */
export const headerSignatureSource = (headers: string[]) => headers.map(norm).join("|");

const STOP_WORDS = new Set(["NEFT", "RTGS", "IMPS", "UPI", "INB", "INF", "NETBANKING", "MOB", "MB", "BY", "TRANSFER", "TRF", "FROM", "TO", "CR", "DR", "CREDIT", "DEBIT", "DEP",
  "DEPOSIT", "CLG", "CHQ", "CHEQUE", "FT", "BIL", "ONL", "IFT", "ACH", "NACH", "P2A", "P2M", "PAYMENT", "PMT", "REF", "UTR", "NO", "A", "C", "AC", "OF", "THE", "IN", "FOR", "BANK",
  "LTD", "LIMITED", "PVT", "PRIVATE"]);

/** The remitter part of a narration: the same rule as private.ap3_remitter (a test compares them). */
export function remitterFromNarration(narration: string): string | null {
  const words = narration.toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim().split(" ")
    .filter(word => word && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(word) && !/^[A-Z]*[0-9][A-Z0-9]*$/.test(word) && !STOP_WORDS.has(word));
  const text = words.join(" ").slice(0, 60);
  return text || null;
}
