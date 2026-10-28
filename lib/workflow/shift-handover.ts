// UPGRADE_EOS feature 39 (shift-handover summaries). The database builds the summary from
// recorded activity; this module validates commands and responses and suggests shift windows.
import { z } from "zod";

export const HANDOVER_WRITERS = ["owner", "admin", "factory_manager", "production_manager", "production"] as const;
export const HANDOVER_READERS = [...HANDOVER_WRITERS, "quality", "dispatch_manager", "viewer"] as const;
export const canSubmitHandover = (role: string) => (HANDOVER_WRITERS as readonly string[]).includes(role);
export const canReadHandover = (role: string) => (HANDOVER_READERS as readonly string[]).includes(role);

const HOUR = 3_600_000;
const IST_OFFSET = 5.5 * HOUR; // India observes no daylight saving, so the offset is fixed.
export const MAX_WINDOW_HOURS = 24;

const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const uuid = z.string().uuid();
const iso = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Choose a valid date and time");

export const handoverCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("handover.preview"), period_start: iso, period_end: iso }).strict(),
  z.object({
    command: z.literal("handover.submit"), period_start: iso, period_end: iso,
    shift_label: z.string().trim().min(1, "Enter a shift name").max(40, "Keep the shift name under 40 characters").refine(noControl, "Remove control characters"),
    note: z.string().trim().max(2000, "Keep the note under 2,000 characters").refine(noControl, "Remove control characters"),
    request_id: uuid
  }).strict(),
  z.object({ command: z.literal("handover.acknowledge"), handover_id: uuid, note: z.string().trim().max(1000, "Keep the acknowledgement under 1,000 characters").refine(noControl, "Remove control characters") }).strict(),
  z.object({ command: z.literal("handover.load"), handover_id: uuid }).strict(),
  z.object({ command: z.literal("handover.list"), page: z.number().int().min(1).max(100000).default(1), status: z.enum(["submitted", "acknowledged"]).optional() }).strict()
]).superRefine((value, ctx) => {
  if (value.command !== "handover.preview" && value.command !== "handover.submit") return;
  const problem = windowProblem(value.period_start, value.period_end);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ["period_end"] });
});
export type HandoverCommand = z.input<typeof handoverCommandSchema>;

/** Mirrors the server's window rule so the form can explain a problem before submitting. */
export function windowProblem(start: string, end: string, now = Date.now()): string | null {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return "Choose a valid shift start and end";
  if (e <= s) return "The shift must end after it starts";
  if (e - s > MAX_WINDOW_HOURS * HOUR) return "A handover covers at most 24 hours";
  if (s < now - 31 * 24 * HOUR) return "Handovers can be prepared only for shifts in the last 31 days";
  if (e > now + HOUR) return "The shift has not ended yet. Prepare the handover within an hour of its end";
  return null;
}

export type ShiftWindow = { key: string; label: string; start: string; end: string };

const istParts = (ms: number) => {
  const d = new Date(ms + IST_OFFSET);
  return { day: d.getUTCDate(), month: d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }), hour: d.getUTCHours() };
};

/**
 * The three most recent standard shifts (Day 08:00-20:00, Night 20:00-08:00 IST) whose end is
 * no more than an hour away, newest first. Presets are suggestions; any valid window is accepted.
 */
export function recentShiftWindows(now = Date.now()): ShiftWindow[] {
  // Shift boundaries fall at 02:30 and 14:30 UTC. Find the latest one that is at most an hour ahead.
  const dayStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  let boundary = dayStart + 2.5 * HOUR + 24 * HOUR;
  while (boundary > now + HOUR) boundary -= 12 * HOUR;
  return [0, 1, 2].map((index) => {
    const end = boundary - index * 12 * HOUR;
    const start = end - 12 * HOUR;
    const a = istParts(start);
    const b = istParts(end);
    const isDay = a.hour === 8;
    const label = isDay ? `Day shift, ${a.day} ${a.month} (08:00–20:00)` : `Night shift, ${a.day}–${b.day} ${b.month} (20:00–08:00)`;
    return { key: new Date(start).toISOString(), label, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  });
}

/** Converts a `datetime-local` value entered in IST ("2026-10-22T08:00") to an ISO instant. */
export function istLocalToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET;
  const check = new Date(ms + IST_OFFSET);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return new Date(ms).toISOString();
}

/** Formats an instant as IST date and time, e.g. "22 Oct 2026, 08:00". */
export function formatIst(value: string | null | undefined): string {
  if (!value) return "-";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return "-";
  const d = new Date(ms + IST_OFFSET);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const num = z.union([z.number(), z.string()]).nullable().transform((value) => (value === null ? null : Number(value)));
const count = z.union([z.number(), z.string()]).transform((value) => Number(value));
const str = z.string().nullable();

export const handoverJobSchema = z.object({
  id: uuid, job_number: str, category: z.enum(["held", "running", "ready", "completed"]), status: z.string(),
  machine_name: str, order_number: str, planned_kg: num, actual_kg: num, outstanding_kg: num, completed_at: str,
  hold_reason: str, hold_resume_condition: str, hold_responsible: str, exceptions_in_window: count
}).strict();

export const handoverSummarySchema = z.object({
  period_start: z.string(), period_end: z.string(), generated_at: z.string(),
  jobs: z.array(handoverJobSchema).max(100), jobs_total: count,
  downtime: z.array(z.object({ id: uuid, machine_name: str, status: z.string(), issue: z.string(), start_time: str, end_time: str, unresolved: z.boolean(), minutes_in_window: count }).strict()).max(100), downtime_total: count,
  exceptions: z.array(z.object({ id: uuid, job_id: uuid, job_number: str, reason: z.string(), note: z.string(), reporter_name: z.string(), recorded_at: z.string() }).strict()).max(100), exceptions_total: count,
  quality: z.array(z.object({ id: uuid, batch_number: str, status: z.string(), job_number: str, quantity_checked_kg: num, inspection_date: z.string() }).strict()).max(100), quality_total: count,
  stock_holds_count: count, stock_holds_kg: num,
  pending_loads: z.array(z.object({ id: uuid, dispatch_number: str, dispatch_date: z.string(), order_number: str, vehicle_number: str, transporter_name: str, total_weight_kg: num, overdue: z.boolean() }).strict()).max(100), pending_loads_total: count
}).strict();
export type HandoverSummary = z.infer<typeof handoverSummarySchema>;

export const handoverRecordSchema = z.object({
  id: uuid, period_start: z.string(), period_end: z.string(), shift_label: z.string(), summary: handoverSummarySchema, note: z.string(),
  prepared_by: uuid, prepared_by_name: z.string(), prepared_at: z.string(), status: z.enum(["submitted", "acknowledged"]),
  acknowledged_by_name: str, acknowledged_at: str, acknowledgement_note: str
}).strict();
export type HandoverRecord = z.infer<typeof handoverRecordSchema>;

export const handoverListSchema = z.object({
  rows: z.array(z.object({
    id: uuid, shift_label: z.string(), period_start: z.string(), period_end: z.string(), prepared_by_name: z.string(), prepared_at: z.string(),
    status: z.enum(["submitted", "acknowledged"]), acknowledged_by_name: str, acknowledged_at: str, job_count: count, open_job_count: count
  }).strict()).max(10),
  total_count: count
}).strict();
export type HandoverList = z.infer<typeof handoverListSchema>;

/** Headline counts for the summary card; "truncated" when the server listed fewer rows than exist. */
export function summariseHandover(summary: HandoverSummary) {
  const byCategory = { held: 0, running: 0, ready: 0, completed: 0 };
  for (const job of summary.jobs) byCategory[job.category] += 1;
  const outstandingKnown = summary.jobs.filter((job) => job.outstanding_kg !== null);
  const downtimeMinutes = summary.downtime.reduce((total, row) => total + row.minutes_in_window, 0);
  return {
    byCategory,
    completedKg: summary.jobs.filter((job) => job.category === "completed").reduce((total, job) => total + (job.actual_kg ?? 0), 0),
    outstandingKg: outstandingKnown.reduce((total, job) => total + (job.outstanding_kg ?? 0), 0),
    outstandingUnknown: summary.jobs.filter((job) => job.category !== "completed" && job.outstanding_kg === null).length,
    downtimeMinutes,
    unresolvedBreakdowns: summary.downtime.filter((row) => row.unresolved).length,
    overdueLoads: summary.pending_loads.filter((load) => load.overdue).length,
    truncated: summary.jobs.length < summary.jobs_total || summary.downtime.length < summary.downtime_total || summary.exceptions.length < summary.exceptions_total
      || summary.quality.length < summary.quality_total || summary.pending_loads.length < summary.pending_loads_total
  };
}

/** Plain-text summary suitable for pasting into a WhatsApp group. */
export function handoverWhatsAppText(record: Pick<HandoverRecord, "shift_label" | "period_start" | "period_end" | "summary" | "note" | "prepared_by_name">): string {
  const s = summariseHandover(record.summary);
  const lines = [
    `*Shift handover: ${record.shift_label}*`,
    `${formatIst(record.period_start)} to ${formatIst(record.period_end)} IST, by ${record.prepared_by_name}`,
    `Jobs: ${s.byCategory.completed} completed (${s.completedKg.toFixed(1)} kg), ${s.byCategory.running} running, ${s.byCategory.held} on hold, ${s.byCategory.ready} ready`,
    `Downtime in shift: ${s.downtimeMinutes} min${s.unresolvedBreakdowns ? `, ${s.unresolvedBreakdowns} breakdown(s) still open` : ""}`
  ];
  for (const job of record.summary.jobs.filter((row) => row.category === "held")) {
    lines.push(`HOLD ${job.job_number ?? "job"}: ${job.hold_reason?.replace(/_/g, " ") ?? "reason not recorded"}${job.hold_resume_condition ? `; resume when ${job.hold_resume_condition}` : ""}`);
  }
  if (record.summary.quality_total) lines.push(`Quality items open: ${record.summary.quality_total}`);
  if (record.summary.pending_loads_total) lines.push(`Loads pending: ${record.summary.pending_loads_total}${s.overdueLoads ? ` (${s.overdueLoads} overdue)` : ""}`);
  if (record.note) lines.push(`Note: ${record.note}`);
  if (s.truncated) lines.push("(Some lists were longer than shown; open the handover in ExtrusionOS for the full record.)");
  return lines.join("\n");
}
