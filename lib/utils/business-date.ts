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
