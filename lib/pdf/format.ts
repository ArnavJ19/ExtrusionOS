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

/** snake_case enum → "Title Case". */
export function pdfLabel(value: unknown, blank = PDF_BLANK) {
  if (value === null || value === undefined || value === "") return blank;
  return String(value).replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (char) => char.toUpperCase());
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

/** Joins the non-empty parts of an address or contact line. */
export function joinParts(parts: unknown[], separator = ", ") {
  return parts.map((part) => (part === null || part === undefined ? "" : String(part).trim())).filter(Boolean).join(separator);
}
