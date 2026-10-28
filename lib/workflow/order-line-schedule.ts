// UPGRADE_EOS feature 38 (delivery dates and priorities by order line). The database computes
// each line's effective requirement and progress; this module validates commands and responses.
import { z } from "zod";

export const LINE_PRIORITIES = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" } as const;
export type LinePriority = keyof typeof LINE_PRIORITIES;

export const SCHEDULE_WRITERS = ["owner", "admin", "sales_manager", "sales", "production_manager", "factory_manager"] as const;
export const SCHEDULE_READERS = [...SCHEDULE_WRITERS, "production", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"] as const;
export const canSetLineSchedule = (role: string) => (SCHEDULE_WRITERS as readonly string[]).includes(role);
export const canReadLineSchedule = (role: string) => (SCHEDULE_READERS as readonly string[]).includes(role);

const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid required date").refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Choose a valid required date");

export const lineScheduleCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("schedule.lines"), order_id: uuid }).strict(),
  z.object({
    command: z.literal("schedule.set"), order_item_id: uuid, required_date: isoDate.nullable(), priority: z.enum(["urgent", "high", "normal", "low"]).nullable(),
    reason: z.string().trim().min(1, "Record why the line requirement is changing").max(500, "Keep the reason under 500 characters").refine(noControl, "Remove control characters"),
    expected_version: z.number().int().min(0), request_id: uuid
  }).strict(),
  z.object({ command: z.literal("schedule.history"), order_item_id: uuid, page: z.number().int().min(1).max(100000).default(1) }).strict(),
  z.object({
    command: z.literal("schedule.queue"), scope: z.enum(["production", "dispatch"]), filter: z.enum(["all", "overdue", "due_soon", "line_set"]).default("all"),
    page: z.number().int().min(1).max(100000).default(1)
  }).strict()
]);
export type LineScheduleCommand = z.input<typeof lineScheduleCommandSchema>;

const num = z.union([z.number(), z.string()]).nullable().transform((value) => (value === null ? null : Number(value)));
const str = z.string().nullable();
export const lineRequirementSchema = z.object({
  order_item_id: uuid, order_id: uuid, order_number: z.string(), customer_name: str, order_stage: z.string(), line_label: z.string(), profile_code: str,
  ordered_kg: num, from_stock_kg: num, produced_kg: num, planned_open_kg: num, packed_kg: num, dispatched_kg: num,
  line_required_date: str, line_priority: str, effective_date: str, effective_priority: z.string(), date_source: z.enum(["line", "order", "none"]), priority_source: z.enum(["line", "order"]),
  version: z.number().int().nonnegative(), updated_by_name: str, updated_at: str, order_closed: z.boolean(), effective_rank: z.number().int()
}).strict();
export type LineRequirement = z.infer<typeof lineRequirementSchema>;

export const lineListSchema = z.object({ rows: z.array(lineRequirementSchema).max(200), total_count: z.number().int().nonnegative(), today: z.string() }).strict();
export const lineQueueSchema = z.object({
  rows: z.array(lineRequirementSchema.extend({ overdue: z.boolean(), remaining_kg: num }).strict()).max(10),
  total_count: z.number().int().nonnegative(), today: z.string()
}).strict();
export type LineQueue = z.infer<typeof lineQueueSchema>;
export const lineHistorySchema = z.object({
  rows: z.array(z.object({
    id: uuid, previous_required_date: str, new_required_date: str, previous_priority: str, new_priority: str, reason: z.string(), changed_by_name: z.string(), changed_at: z.string()
  }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();
export type LineHistory = z.infer<typeof lineHistorySchema>;

const DAY = 86_400_000;
/** Due state against the database's IST "today". Completed lines are never overdue. */
export function lineDueState(effectiveDate: string | null, today: string, fulfilled = false): "none" | "overdue" | "due_soon" | "scheduled" | "fulfilled" {
  if (fulfilled) return "fulfilled";
  if (!effectiveDate) return "none";
  const diff = (Date.parse(`${effectiveDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY;
  if (Number.isNaN(diff)) return "none";
  if (diff < 0) return "overdue";
  return diff <= 3 ? "due_soon" : "scheduled";
}

/** Supplied = packed + uncredited dealer stock, matching the database's "fully packed" rule. */
export function lineSupply(row: Pick<LineRequirement, "ordered_kg" | "packed_kg" | "from_stock_kg">) {
  const supplied = (row.packed_kg ?? 0) + (row.from_stock_kg ?? 0);
  if (row.ordered_kg === null || row.ordered_kg <= 0) return { supplied, remaining: null, fulfilled: false };
  const remaining = Math.max(row.ordered_kg - supplied, 0);
  return { supplied, remaining, fulfilled: remaining <= 0 };
}

/** Human description of one recorded change, e.g. "Date 30 Oct → 25 Oct; priority normal → urgent". */
export function describeScheduleChange(row: Pick<LineHistory["rows"][number], "previous_required_date" | "new_required_date" | "previous_priority" | "new_priority">) {
  const parts: string[] = [];
  const date = (value: string | null) => value ?? "order date";
  const priority = (value: string | null) => value ?? "order priority";
  if (row.previous_required_date !== row.new_required_date) parts.push(`Date ${date(row.previous_required_date)} → ${date(row.new_required_date)}`);
  if (row.previous_priority !== row.new_priority) parts.push(`priority ${priority(row.previous_priority)} → ${priority(row.new_priority)}`);
  return parts.join("; ") || "No change";
}
