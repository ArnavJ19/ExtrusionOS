// AP-077: reads a tax-credit statement (Form 26AS / AIS TDS part, exported as CSV) into reviewable rows.
// Columns are found by their headings, so the deductor TAN, section, transaction date and tax deducted are required;
// a row missing any of them is reported, not guessed. The statement is matched to recorded deductions in the database.

export type TdsStatementRow = { row_number: number; tan: string; deductor_name: string | null; section: string | null; transaction_date: string; amount_credited: number | null; tds_amount: number; booking_status: string | null };
export type TdsStatementParse = { rows: TdsStatementRow[]; problems: { row: number; message: string }[]; columns: Record<string, string | null> };

export function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ""));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const HEADINGS: Record<string, string[]> = {
  tan: ["tan of deductor", "deductor tan", "tan"],
  deductor_name: ["name of deductor", "deductor name", "deductor"],
  section: ["section", "section code", "section 1"],
  transaction_date: ["transaction date", "date of payment credit", "date of credit", "transaction dt", "date"],
  amount_credited: ["amount paid credited", "amount credited", "amount paid", "amount paid credited rs"],
  tds_amount: ["tax deducted", "tds deducted", "tds amount", "tax deducted rs", "tax deducted at source"],
  booking_status: ["status of booking", "booking status"]
};
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

export function readStatementDate(value: string): string | null {
  const v = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  let iso = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  if (!iso && (m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v))) iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (!iso && (m = /^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$/.exec(v)) && MONTHS[m[2].toLowerCase()]) iso = `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
const amount = (value: string | undefined) => {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value.replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export function parseTdsStatement(text: string): TdsStatementParse {
  const table = parseCsv(text);
  const problems: TdsStatementParse["problems"] = [];
  const headerIndex = table.findIndex(r => r.some(c => /tan/i.test(c)) && r.some(c => /deducted|tds/i.test(c)));
  if (headerIndex < 0) return { rows: [], problems: [{ row: 0, message: "No heading row with the deductor TAN and tax deducted was found." }], columns: {} };
  const header = table[headerIndex].map(norm);
  const columns: Record<string, string | null> = {};
  const index: Record<string, number> = {};
  for (const [key, names] of Object.entries(HEADINGS)) {
    const at = names.map(name => header.indexOf(name)).find(i => i >= 0) ?? header.findIndex(h => names.some(name => h.startsWith(name)));
    index[key] = at ?? -1; columns[key] = at !== undefined && at >= 0 ? table[headerIndex][at] : null;
  }
  for (const key of ["tan", "transaction_date", "tds_amount"]) if (index[key] < 0) problems.push({ row: headerIndex + 1, message: `The ${key.replace("_", " ")} column was not found.` });
  if (problems.length) return { rows: [], problems, columns };
  const rows: TdsStatementRow[] = [];
  table.slice(headerIndex + 1).forEach((r, offset) => {
    const rowNumber = headerIndex + 2 + offset;
    const tan = (r[index.tan] ?? "").toUpperCase();
    if (!tan && !(r[index.tds_amount] ?? "")) return;
    const date = readStatementDate(r[index.transaction_date] ?? "");
    const tds = amount(r[index.tds_amount]);
    if (!/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(tan)) { problems.push({ row: rowNumber, message: "The deductor TAN is missing or malformed." }); return; }
    if (!date) { problems.push({ row: rowNumber, message: "The transaction date is not readable." }); return; }
    if (tds === null || Number.isNaN(tds) || tds <= 0) { problems.push({ row: rowNumber, message: "The tax deducted is missing or not a positive amount." }); return; }
    const credited = index.amount_credited >= 0 ? amount(r[index.amount_credited]) : null;
    rows.push({ row_number: rowNumber, tan, deductor_name: index.deductor_name >= 0 ? r[index.deductor_name] || null : null,
      section: index.section >= 0 ? (r[index.section] || "").toUpperCase().replace(/[^0-9A-Z]/g, "") || null : null, transaction_date: date,
      amount_credited: credited === null || Number.isNaN(credited) ? null : credited, tds_amount: tds, booking_status: index.booking_status >= 0 ? r[index.booking_status] || null : null });
  });
  return { rows, problems, columns };
}
