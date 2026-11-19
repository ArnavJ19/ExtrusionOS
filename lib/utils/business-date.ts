export const DEFAULT_BUSINESS_TIME_ZONE = "Asia/Kolkata";

type DateParts = { year: number; month: number; day: number };

export type BusinessDateBoundaries = {
  timeZone: string;
  today: string;
  monthStart: string;
  lastMonthStart: string;
  lastMonthEnd: string;
  monthStartIso: string;
  tomorrowStartIso: string;
};

function isSupportedTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function resolveBusinessTimeZone(companyTimeZone?: string | null) {
  const candidate = companyTimeZone?.trim();
  return candidate && isSupportedTimeZone(candidate) ? candidate : DEFAULT_BUSINESS_TIME_ZONE;
}

export function formatBusinessDateTime(value: string | Date | null | undefined, companyTimeZone?: string | null) {
  if (!value) return "Not captured";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not captured";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: resolveBusinessTimeZone(companyTimeZone),
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h12",
  }).format(date);
}

function getDateParts(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function formatYmd(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function zonedStartOfDayIso(year: number, month: number, day: number, timeZone: string) {
  const desiredUtcShape = Date.UTC(year, month - 1, day);
  let instant = desiredUtcShape;

  // Converge the UTC instant until its formatted wall-clock time is midnight
  // on the requested business date. Two passes cover standard and DST zones.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const wallClockAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    const adjustment = desiredUtcShape - wallClockAsUtc;
    instant += adjustment;
    if (adjustment === 0) break;
  }

  return new Date(instant).toISOString();
}

/**
 * FS-82: "today in India" as YYYY-MM-DD. Use this, not `new Date().toISOString().slice(0, 10)`, which is the UTC date
 * and is still yesterday between 00:00 and 05:30 IST. The SQL twin is `private.business_today()`.
 */
export function businessToday(now: Date = new Date(), companyTimeZone?: string | null) {
  const { year, month, day } = getDateParts(now, resolveBusinessTimeZone(companyTimeZone));
  return formatYmd(year, month, day);
}

/** The business (IST) date of an instant, or null. SQL twin: `private.business_date_of(timestamptz)`. */
export function businessDateOf(value: string | Date | null | undefined, companyTimeZone?: string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return businessToday(date, companyTimeZone);
}

export type FinancialYear = { startYear: number; label: string; startsOn: string; endsOn: string };

/** Indian financial year (1 April to 31 March) of a YYYY-MM-DD date. SQL twin: `private.business_financial_year(date)`. */
export function financialYearOf(ymd: string): FinancialYear {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error("Use a YYYY-MM-DD date");
  const year = Number(match[1]), month = Number(match[2]);
  const startYear = month >= 4 ? year : year - 1;
  return { startYear, label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`, startsOn: `${startYear}-04-01`, endsOn: `${startYear + 1}-03-31` };
}

export type ShiftDefinition = { code: string; start: string; end: string };
/** The factory calendar default (the same default the database uses when no calendar is saved). */
export const DEFAULT_SHIFTS: ShiftDefinition[] = [
  { code: "A", start: "06:00", end: "14:00" },
  { code: "B", start: "14:00", end: "22:00" },
  { code: "C", start: "22:00", end: "06:00" },
];

const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/**
 * The shift running at an instant and its shift day. A shift belongs to the date it started on, so the night shift that
 * starts at 22:00 on the 18th is still the 18th's shift at 03:00 on the 19th. SQL twin: `private.business_shift`.
 */
export function businessShift(now: Date = new Date(), shifts: ShiftDefinition[] = DEFAULT_SHIFTS, companyTimeZone?: string | null) {
  const timeZone = resolveBusinessTimeZone(companyTimeZone);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0);
  const minute = value("hour") * 60 + value("minute");
  const today = businessToday(now, timeZone);
  for (const shift of shifts) {
    const start = minutesOf(shift.start), end = minutesOf(shift.end);
    if (end > start ? minute >= start && minute < end : minute >= start) return { code: shift.code, shiftDate: today };
    if (end <= start && minute < end) {
      const [y, m, d] = today.split("-").map(Number);
      const previous = new Date(Date.UTC(y, m - 1, d - 1));
      return { code: shift.code, shiftDate: formatYmd(previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate()) };
    }
  }
  return null;
}

/**
 * Calendar boundaries for date-only business records. These are intentionally
 * derived in the company's timezone rather than from the server's timezone.
 */
export function getBusinessDateBoundaries(now = new Date(), companyTimeZone?: string | null): BusinessDateBoundaries {
  const timeZone = resolveBusinessTimeZone(companyTimeZone);
  const { year, month, day } = getDateParts(now, timeZone);
  const previousMonth = new Date(Date.UTC(year, month - 2, 1));
  const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0));
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));

  return {
    timeZone,
    today: formatYmd(year, month, day),
    monthStart: formatYmd(year, month, 1),
    lastMonthStart: formatYmd(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, 1),
    lastMonthEnd: formatYmd(previousMonthEnd.getUTCFullYear(), previousMonthEnd.getUTCMonth() + 1, previousMonthEnd.getUTCDate()),
    monthStartIso: zonedStartOfDayIso(year, month, 1, timeZone),
    tomorrowStartIso: zonedStartOfDayIso(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), timeZone),
  };
}
