// AP-004: one factory calendar for date calculations. Mirrors private.factory_is_working_day and
// private.factory_add_working_days in the database. Dates are IST calendar dates as YYYY-MM-DD strings.
import { z } from "zod";

export const CALENDAR_KINDS = { holiday: "Holiday", shutdown: "Planned shutdown", maintenance: "Maintenance day", working_day: "Extra working day" } as const;
export type CalendarKind = keyof typeof CALENDAR_KINDS;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DEFAULT_SHIFTS = [{ code: "A", start: "06:00", end: "14:00" }, { code: "B", start: "14:00", end: "22:00" }, { code: "C", start: "22:00", end: "06:00" }];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date").refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Choose a real date");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const label = z.string().trim().min(3, "Give a label of at least 3 characters").max(80, "Keep the label within 80 characters").refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Remove control characters");

export const calendarShiftSchema = z.object({ code: z.string().regex(/^[A-Z0-9]{1,3}$/, "Shift code: 1 to 3 capital letters or digits"), start: time, end: time }).strict()
  .refine(value => value.start !== value.end, "A shift must start and end at different times");
export const calendarSettingsSchema = z.object({
  weekly_off: z.array(z.number().int().min(0).max(6)).max(3, "Choose at most three weekly off days"),
  shifts: z.array(calendarShiftSchema).min(1, "Add at least one shift").max(4, "At most four shifts"),
  promise_basis: z.enum(["calendar", "working"])
}).strict().refine(value => new Set(value.shifts.map(shift => shift.code)).size === value.shifts.length, "Shift codes must be different");
export const calendarExceptionInputSchema = z.object({
  date_from: day, date_to: day, kind: z.enum(["holiday", "shutdown", "maintenance", "working_day"]), label
}).strict().refine(value => value.date_to >= value.date_from, "The end date cannot be before the start").refine(value => daysBetween(value.date_from, value.date_to) <= 62, "An entry may cover up to 63 days");

export const calendarReadSchema = z.object({
  settings: z.object({ weekly_off: z.array(z.number().int().min(0).max(6)), shifts: z.array(z.object({ code: z.string(), start: z.string(), end: z.string() })), promise_basis: z.enum(["calendar", "working"]), updated_at: z.string().nullable() }),
  exceptions: z.array(z.object({ id: z.string().uuid(), date_from: day, date_to: day, kind: z.enum(["holiday", "shutdown", "maintenance", "working_day"]), label: z.string(), days: z.number().int() })),
  can_edit: z.boolean(), from: day, to: day
});
export type CalendarRead = z.infer<typeof calendarReadSchema>;

export type FactoryCalendar = {
  weeklyOff: number[];
  exceptions: Array<{ date_from: string; date_to: string; kind: CalendarKind }>;
  promiseBasis: "calendar" | "working";
};

export const DEFAULT_CALENDAR: FactoryCalendar = { weeklyOff: [0], exceptions: [], promiseBasis: "calendar" };

export function calendarFromRead(read: CalendarRead): FactoryCalendar {
  return { weeklyOff: read.settings.weekly_off, exceptions: read.exceptions, promiseBasis: read.settings.promise_basis };
}

export function plusDays(value: string, count: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + count);
  return parsed.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function weekdayOf(value: string) {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay();
}

/** Non-working when a holiday, shutdown or maintenance entry covers it, or it is a weekly off without a working-day entry. */
export function isWorkingDay(calendar: FactoryCalendar, value: string) {
  const covering = calendar.exceptions.filter(entry => value >= entry.date_from && value <= entry.date_to);
  if (covering.some(entry => entry.kind !== "working_day")) return false;
  if (calendar.weeklyOff.includes(weekdayOf(value))) return covering.some(entry => entry.kind === "working_day");
  return true;
}

export function nonWorkingReason(calendar: FactoryCalendar, value: string): string | null {
  const blocking = calendar.exceptions.find(entry => value >= entry.date_from && value <= entry.date_to && entry.kind !== "working_day");
  if (blocking) return CALENDAR_KINDS[blocking.kind];
  if (!isWorkingDay(calendar, value)) return `Weekly off (${WEEKDAYS[weekdayOf(value)]})`;
  return null;
}

/** The date `count` working days after `start` (the start day itself is not counted). */
export function addWorkingDays(calendar: FactoryCalendar, start: string, count: number) {
  if (!Number.isInteger(count) || count < 0 || count > 730) throw new RangeError("Working days must be a whole number from 0 to 730");
  let current = start, left = count, guard = 0;
  while (left > 0) {
    current = plusDays(current, 1);
    if (++guard > 3000) throw new RangeError("The factory calendar has no working days in range");
    if (isWorkingDay(calendar, current)) left -= 1;
  }
  return current;
}

/** Working days after `from` up to and including `to`. */
export function workingDaysBetween(calendar: FactoryCalendar, from: string, to: string) {
  if (to <= from) return 0;
  let total = 0;
  for (let current = plusDays(from, 1); current <= to; current = plusDays(current, 1)) if (isWorkingDay(calendar, current)) total += 1;
  return total;
}

/** Adds a lead time on the basis the factory chose: calendar days (default) or working days. */
export function addLeadDays(calendar: FactoryCalendar, start: string, days: number) {
  return calendar.promiseBasis === "working" ? addWorkingDays(calendar, start, days) : plusDays(start, days);
}

export function basisLabel(calendar: FactoryCalendar) {
  return calendar.promiseBasis === "working" ? "working days (factory calendar)" : "calendar days";
}
