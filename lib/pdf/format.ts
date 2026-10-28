// Deterministic value formatting for printed documents. Amounts use Indian digit grouping,
// dates are printed as "20 Oct 2026" and timestamps in IST so a serverless (UTC) render
// matches what the factory sees. Empty values print as an em dash, never as "0" or "null".

export const PDF_BLANK = "—";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(min: number, max: number) {
  const key = `${min}:${max}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", { minimumFractionDigits: min, maximumFractionDigits: max });
    formatters.set(key, formatter);
  }
  return formatter;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value: number, decimals: number) {
  const factor = 10 ** decimals;
  const result = Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor;
  return result === 0 ? 0 : result;
}

/** 1,23,456.00 */
export function pdfAmount(value: unknown, blank = PDF_BLANK) {
  const number = toNumber(value);
  return number === null ? blank : numberFormat(2, 2).format(rounded(number, 2));
}

/** INR 1,23,456.00 */
export function pdfMoney(value: unknown, currency = "INR", blank = PDF_BLANK) {
  const amount = pdfAmount(value, "");
  return amount ? `${currency} ${amount}` : blank;
}

/** Fixed-decimal quantity with an optional unit, e.g. 1,234.500 kg. */
export function pdfQuantity(value: unknown, decimals = 3, unit = "", blank = PDF_BLANK) {
  const number = toNumber(value);
  if (number === null) return blank;
  const text = numberFormat(decimals, decimals).format(rounded(number, decimals));
  return unit ? `${text} ${unit}` : text;
}

/** Up to `decimals` places, trailing zeros removed: 6, 6.5, 6.25. */
export function pdfNumber(value: unknown, decimals = 2, unit = "", blank = PDF_BLANK) {
  const number = toNumber(value);
  if (number === null) return blank;
  const text = numberFormat(0, decimals).format(rounded(number, decimals));
  return unit ? `${text} ${unit}` : text;
}

export function pdfInteger(value: unknown, blank = PDF_BLANK) {
  return pdfNumber(value, 0, "", blank);
}

export function pdfPercent(value: unknown, decimals = 2, blank = PDF_BLANK) {
  const text = pdfNumber(value, decimals, "", "");
  return text ? `${text}%` : blank;
}

function istParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: get("year"), month: Number(get("month")), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** 20 Oct 2026. Date-only strings are printed as stored; timestamps are converted to IST. */
export function pdfDate(value: unknown, blank = PDF_BLANK) {
  if (value === null || value === undefined || value === "") return blank;
  const text = value instanceof Date ? "" : String(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) return `${dateOnly[3]} ${MONTHS[Number(dateOnly[2]) - 1] ?? dateOnly[2]} ${dateOnly[1]}`;
  const date = value instanceof Date ? value : new Date(text);
  if (Number.isNaN(date.getTime())) return text || blank;
  const parts = istParts(date);
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

/** 20 Oct 2026, 14:05 IST */
export function pdfDateTime(value: unknown = new Date(), blank = PDF_BLANK) {
  if (value === null || value === undefined || value === "") return blank;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = istParts(date);
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}, ${parts.hour}:${parts.minute} IST`;
}

// Abbreviations printed in capitals when an enum or key is title-cased ("neft" → "NEFT", "ifsc" → "IFSC").
const ACRONYMS = new Set([
  "neft", "rtgs", "imps", "upi", "utr", "ifsc", "micr", "swift", "iban", "pan", "tan", "gst", "gstin", "igst", "cgst", "sgst", "utgst",
  "hsn", "sac", "tds", "tcs", "po", "lr", "ncr", "qc", "qa", "id", "dd", "emi", "pvdf", "dgu", "ccd", "hrc", "hv", "ral", "cnc", "inr", "usd"
]);

// Joining words stay lower case inside a label ("Out of Tolerance", "Sent for Correction").
// Single letters are kept as capitals so grades and variants ("Grade A") are not lowered.
const MINOR_WORDS = new Set(["and", "at", "by", "for", "in", "of", "on", "or", "per", "the", "to", "via", "with"]);

/** snake_case enum → "Title Case". */
export function pdfLabel(value: unknown, blank = PDF_BLANK) {
  if (value === null || value === undefined || value === "") return blank;
  let first = true;
  return String(value).replace(/_/g, " ").replace(/\s+/g, " ").trim()
    .replace(/[A-Za-z0-9]+/g, (word) => {
      const lower = word.toLowerCase();
      const result = ACRONYMS.has(lower) ? word.toUpperCase()
        : !first && MINOR_WORDS.has(lower) && word === lower ? lower
          : word.charAt(0).toUpperCase() + word.slice(1);
      first = false;
      return result;
    });
}

export function pdfText(value: unknown, blank = PDF_BLANK) {
  if (value === null || value === undefined) return blank;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value).trim();
  return text ? text : blank;
}

export function pdfYesNo(value: unknown, blank = PDF_BLANK) {
  if (value === null || value === undefined || value === "") return blank;
  return value === true || value === "true" ? "Yes" : "No";
}

type CompanyNames = { name?: unknown; legal_name?: unknown } | null | undefined;

/**
 * The name printed as a document's heading: the company's trading name, the same name its logo
 * and customers use. The registered legal name follows as a separate line when it differs.
 */
export function issuerName(company: CompanyNames, fallback = "Company") {
  return String(company?.name || company?.legal_name || fallback).trim();
}

export function legalNameLine(company: CompanyNames) {
  const name = String(company?.name ?? "").trim();
  const legal = String(company?.legal_name ?? "").trim();
  return name && legal && legal.toLowerCase() !== name.toLowerCase() ? `Legal name: ${legal}` : null;
}

/** Comma-separated segments of an address, with a trailing PIN split off ("Ahmedabad 382445"). */
function addressSegments(text: string) {
  return text.split(/[,\n]/).flatMap((segment) => {
    const pins = segment.match(/\b\d{6}\b/g) ?? [];
    const rest = segment.replace(/\b\d{6}\b/g, "").replace(/[\s\-–]+$/, "").trim();
    return [rest, ...pins].map((value) => value.toLowerCase()).filter(Boolean);
  });
}

/**
 * Joins the non-empty parts of an address or contact line. A city, state or PIN that the street
 * address already ends with ("…, Ahmedabad 382445") is not printed twice.
 */
export function joinParts(parts: unknown[], separator = ", ") {
  const kept: string[] = [];
  for (const part of parts) {
    const text = part === null || part === undefined ? "" : String(part).trim();
    if (!text) continue;
    if (kept.some((earlier) => addressSegments(earlier).includes(text.toLowerCase()))) continue;
    kept.push(text);
  }
  return kept.join(separator);
}
