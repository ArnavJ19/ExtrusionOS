// UPGRADE_EOS feature 71 (turnaround targets and escalation rules). The database computes
// elapsed, working, waiting and active minutes; this module validates commands and responses
// and formats durations.
import { z } from "zod";

export const TARGET_MANAGERS = ["owner", "admin", "factory_manager"] as const;
export const WAIT_SUPERVISORS = ["owner", "admin", "factory_manager", "production_manager", "dispatch_manager", "quality_manager", "sales_manager"] as const;
export const canManageTargets = (role: string) => (TARGET_MANAGERS as readonly string[]).includes(role);
export const ESCALATION_ROLES = ["owner", "admin", "factory_manager", "production_manager", "dispatch_manager", "quality_manager", "sales_manager"] as const;
export const WAIT_REASONS = { waiting_customer: "Waiting for the customer", waiting_material: "Waiting for material", waiting_approval: "Waiting for an approval", other: "Other" } as const;
export type WaitReason = keyof typeof WAIT_REASONS;
export const TASK_KIND_PATTERN = /^(handoff:(packaging|quality|dispatch|production)|handoff_return|type:[a-z0-9_]{1,40})$/;

const uuid = z.string().uuid();
export const turnaroundCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("targets.list") }).strict(),
  z.object({
    command: z.literal("targets.set"), task_kind: z.string().regex(TASK_KIND_PATTERN, "Choose a valid task kind"),
    response_minutes: z.number().int().min(1).max(43200).nullable(), completion_minutes: z.number().int().min(1).max(129600),
    calendar: z.enum(["24x7", "day_shift"]), escalation_role: z.enum(ESCALATION_ROLES), is_active: z.boolean()
  }).strict(),
  z.object({ command: z.literal("task.status"), task_ids: z.array(uuid).min(1).max(25) }).strict(),
  z.object({ command: z.literal("wait.start"), task_id: uuid, reason: z.enum(["waiting_customer", "waiting_material", "waiting_approval", "other"]), note: z.string().trim().min(3, "Say what the work is waiting for").max(300) }).strict(),
  z.object({ command: z.literal("wait.end"), task_id: uuid }).strict(),
  z.object({ command: z.literal("escalations.run") }).strict(),
  z.object({ command: z.literal("escalations.list"), page: z.number().int().min(1).max(100000).default(1) }).strict()
]).superRefine((value, ctx) => {
  if (value.command === "targets.set" && value.response_minutes !== null && value.response_minutes > value.completion_minutes) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The start target cannot be longer than the completion target", path: ["response_minutes"] });
  }
});

const num = z.union([z.number(), z.string()]).nullable().transform((value) => (value === null ? null : Number(value)));
const state = z.enum(["none", "on_track", "due_soon", "breached", "met", "missed"]);
const openWait = z.object({ reason: z.string(), since: z.string(), note: z.string() }).strict().nullable().optional();
export const turnaroundStatusSchema = z.array(z.union([
  z.object({
    task_id: uuid, task_kind: z.string(), has_target: z.literal(true), calendar: z.enum(["24x7", "day_shift"]), elapsed_minutes: num, working_minutes: num, waiting_minutes: num,
    active_minutes: num, response_minutes_target: num, response_active_minutes: num, response_state: state, completion_minutes_target: num, completion_state: state,
    escalation_role: z.string(), open_wait: openWait
  }).strict(),
  z.object({ task_id: uuid, task_kind: z.string(), has_target: z.literal(false), elapsed_minutes: num, open_wait: openWait }).strict()
])).max(25);
export type TurnaroundStatus = z.infer<typeof turnaroundStatusSchema>[number];

export const targetsSchema = z.array(z.object({
  task_kind: z.string(), response_minutes: z.number().int().nullable(), completion_minutes: z.number().int(), calendar: z.enum(["24x7", "day_shift"]),
  escalation_role: z.string(), is_active: z.boolean(), updated_at: z.string()
}).strict());
export const escalationListSchema = z.object({
  rows: z.array(z.object({
    id: uuid, task_id: uuid, level: z.number().int(), escalation_role: z.string(), escalated_at: z.string(), title: z.string(), status: z.string(),
    due_date: z.string().nullable(), assigned_to_name: z.string().nullable()
  }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();

/** "3 h 05 min", "45 min", "2 d 4 h": readable on a phone. */
export function formatMinutes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const total = Math.max(Math.round(value), 0);
  if (total < 60) return `${total} min`;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days) return `${days} d${hours ? ` ${hours} h` : ""}`;
  return `${hours} h${minutes ? ` ${String(minutes).padStart(2, "0")} min` : ""}`;
}

/** The most urgent of the two states, for one chip. */
export function headlineState(status: TurnaroundStatus): "none" | "on_track" | "due_soon" | "breached" | "met" | "missed" {
  if (!status.has_target) return "none";
  const order = ["breached", "missed", "due_soon", "on_track", "met", "none"] as const;
  for (const value of order) if (status.response_state === value || status.completion_state === value) return value;
  return "none";
}

/** Human label for a task kind, e.g. "Packaging handoffs" or "Tasks of type maintenance". */
export function taskKindLabel(kind: string) {
  if (kind.startsWith("handoff:")) return `${kind.slice(8).replace(/^./, (c) => c.toUpperCase())} handoffs`;
  if (kind === "handoff_return") return "Returned handoffs";
  return `Tasks of type ${kind.replace(/^type:/, "").replace(/_/g, " ")}`;
}
