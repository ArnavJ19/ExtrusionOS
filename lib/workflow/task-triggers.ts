// UPGRADE_EOS feature 64 (tasks created and assigned from defined triggers). The database
// evaluates each rule, creates one task per (rule, source record, occurrence), applies the assignee
// rule and lists work it could not assign; this module validates commands and responses.
import { z } from "zod";

export const TRIGGER_MANAGERS = ["owner", "admin", "factory_manager"] as const;
export const TRIGGER_SUPERVISORS = ["production_manager", "dispatch_manager", "sales_manager"] as const;
export const canManageTriggerRules = (role: string) => (TRIGGER_MANAGERS as readonly string[]).includes(role);
export const canUseTriggers = (role: string) => canManageTriggerRules(role) || (TRIGGER_SUPERVISORS as readonly string[]).includes(role);

/** Mirrors the database: label, threshold unit and range, and the roles that may receive the work. */
export const TRIGGER_EVENTS = {
  order_dispatch_overdue: { label: "Order overdue for dispatch", unit: "days late", min: 0, max: 365, roles: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "production_manager", "sales_manager", "sales"] },
  inspection_rejected: { label: "Quality inspection rejected", unit: null, min: 0, max: 0, roles: ["owner", "admin", "factory_manager", "quality", "production_manager", "production"] },
  breakdown_open: { label: "Machine breakdown still open", unit: "hours open", min: 1, max: 720, roles: ["owner", "admin", "factory_manager", "production_manager", "production"] },
  quote_expiring: { label: "Sent quotation expiring", unit: "days before expiry", min: 0, max: 60, roles: ["owner", "admin", "sales_manager", "sales"] },
  invoice_overdue: { label: "Invoice payment overdue", unit: "days past due", min: 0, max: 365, roles: ["owner", "admin", "accounts", "sales_manager", "sales"] }
} as const;
export type TriggerEvent = keyof typeof TRIGGER_EVENTS;
const EVENT_KEYS = Object.keys(TRIGGER_EVENTS) as [TriggerEvent, ...TriggerEvent[]];

/** Events a role can see and run, as the database scopes them. */
export function triggerScope(role: string): TriggerEvent[] {
  if (canManageTriggerRules(role)) return [...EVENT_KEYS];
  if (role === "production_manager") return ["inspection_rejected", "breakdown_open", "order_dispatch_overdue"];
  if (role === "dispatch_manager") return ["order_dispatch_overdue"];
  if (role === "sales_manager") return ["quote_expiring", "invoice_overdue", "order_dispatch_overdue"];
  return [];
}

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner", admin: "Admin", factory_manager: "Factory manager", production_manager: "Production manager", production: "Production", dispatch_manager: "Dispatch manager",
  dispatch: "Dispatch", quality: "Quality", sales_manager: "Sales manager", sales: "Sales", accounts: "Accounts"
};

const uuid = z.string().uuid();
const whole = (message: string) => z.number({ invalid_type_error: message }).int(message);

export const ruleInputSchema = z.object({
  command: z.literal("rules.save"), id: uuid, expected_updated_at: z.string().nullable().optional(),
  name: z.string().trim().min(3, "Name the rule (3 to 120 characters)").max(120, "Name the rule (3 to 120 characters)"),
  event_type: z.enum(EVENT_KEYS, { errorMap: () => ({ message: "Choose a supported trigger event" }) }),
  threshold: whole("Enter whole numbers for the threshold, look-back and due days"),
  lookback_days: whole("Enter whole numbers for the threshold, look-back and due days").min(0).max(90, "Look back at most 90 days").default(7),
  assignee_mode: z.enum(["role", "person"]), assignee_role: z.string().nullable(), assignee_user_id: uuid.nullable(),
  due_days: whole("Enter whole numbers for the threshold, look-back and due days").min(0).max(30, "Set a due date within 30 days"),
  due_calendar: z.enum(["calendar", "working_days"]), priority: z.enum(["low", "normal", "high", "urgent"]), is_active: z.boolean()
}).strict().superRefine((value, ctx) => {
  const problem = ruleProblem(value);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});
export type RuleInput = z.input<typeof ruleInputSchema>;

/** Same rules as the database checks, so the form explains a refusal before saving. */
export function ruleProblem(value: { event_type: TriggerEvent; threshold: number; assignee_mode: "role" | "person"; assignee_role: string | null; assignee_user_id: string | null }): string | null {
  const event = TRIGGER_EVENTS[value.event_type];
  if (value.threshold < event.min || value.threshold > event.max) return event.unit ? `Set ${event.min} to ${event.max} ${event.unit}` : "A rejected inspection raises work immediately: no threshold";
  if (value.assignee_mode === "role" && (!value.assignee_role || value.assignee_user_id)) return "Choose the role that receives the work";
  if (value.assignee_mode === "person" && !value.assignee_user_id) return "Choose the employee who receives the work";
  if (value.assignee_role && !(event.roles as readonly string[]).includes(value.assignee_role)) return `The ${value.assignee_role.replace(/_/g, " ")} role cannot take this kind of work`;
  return null;
}

const commandSchemas = {
  "rules.list": z.object({ command: z.literal("rules.list") }).strict(),
  "rules.save": ruleInputSchema,
  "triggers.run": z.object({ command: z.literal("triggers.run"), request_id: uuid }).strict(),
  "tasks.list": z.object({ command: z.literal("tasks.list"), rule_id: uuid.optional(), page: z.number().int().min(1).max(100000).default(1) }).strict(),
  "recovery.list": z.object({ command: z.literal("recovery.list"), page: z.number().int().min(1).max(100000).default(1) }).strict(),
  "recovery.assign": z.object({ command: z.literal("recovery.assign"), task_id: uuid, assignee_id: uuid }).strict(),
  "recovery.retry": z.object({ command: z.literal("recovery.retry"), task_id: uuid }).strict()
} as const;
export type TriggerCommandName = keyof typeof commandSchemas;
export const TRIGGER_WRITE_COMMANDS: readonly TriggerCommandName[] = ["rules.save", "triggers.run", "recovery.assign", "recovery.retry"];

export function parseTriggerCommand(input: unknown) {
  const name = input && typeof input === "object" ? (input as { command?: unknown }).command : undefined;
  if (typeof name !== "string" || !(name in commandSchemas)) return { success: false as const, error: "Invalid task trigger request" };
  const parsed = commandSchemas[name as TriggerCommandName].safeParse(input);
  if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid task trigger request" };
  return { success: true as const, data: parsed.data as { command: TriggerCommandName } & Record<string, unknown> };
}

const count = z.union([z.number(), z.string()]).transform(Number);
export const ruleRowSchema = z.object({
  id: uuid, name: z.string(), event_type: z.enum(EVENT_KEYS), threshold: z.number().int(), lookback_days: z.number().int(),
  assignee_mode: z.enum(["role", "person"]), assignee_role: z.string().nullable(), assignee_user_id: uuid.nullable(), assignee_name: z.string().nullable(),
  due_days: z.number().int(), due_calendar: z.enum(["calendar", "working_days"]), priority: z.enum(["low", "normal", "high", "urgent"]), is_active: z.boolean(),
  created_by: uuid, created_at: z.string(), updated_by: uuid, updated_at: z.string(), open_tasks: count, unassigned_tasks: count
}).strict();
export type RuleRow = z.infer<typeof ruleRowSchema>;
export const ruleListSchema = z.object({
  rows: z.array(ruleRowSchema).max(50),
  last_run: z.object({ started_at: z.string(), created: z.number().int(), unassigned: z.number().int() }).strict().nullable()
}).strict();

export const runResultSchema = z.object({
  request_id: uuid, replayed: z.boolean(), created: z.number().int(), existing: z.number().int(), unassigned: z.number().int(), more_pending: z.boolean(),
  rules: z.array(z.object({ rule_id: uuid, name: z.string(), created: z.number().int(), existing: z.number().int(), unassigned: z.number().int(), more_pending: z.boolean() }).strict())
}).strict();
export type RunResult = z.infer<typeof runResultSchema>;

export const triggeredTaskListSchema = z.object({
  rows: z.array(z.object({
    id: uuid, title: z.string(), status: z.enum(["open", "in_progress", "completed", "cancelled"]), priority: z.string(), due_date: z.string().nullable(),
    assigned_to: uuid.nullable(), assignee_name: z.string().nullable(), rule_id: uuid, rule_name: z.string(), event_type: z.enum(EVENT_KEYS),
    source_type: z.enum(["order", "quality_inspection", "breakdown_log", "quote", "invoice"]), source_id: uuid, event_at: z.string(), created_at: z.string(),
    assignment: z.enum(["assigned", "unassigned"]), assignment_note: z.string().nullable(), source_open: z.boolean(),
    eligible: z.array(z.object({ id: uuid, name: z.string(), role: z.string() }).strict())
  }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();
export type TriggeredTask = z.infer<typeof triggeredTaskListSchema>["rows"][number];
export const recoveryResultSchema = z.object({ id: uuid, assigned_to: uuid.nullable(), note: z.string().nullable() }).strict();

/** Link to the record that raised the work. Breakdowns have no detail page, so they link to maintenance. */
export function sourceHref(type: TriggeredTask["source_type"], id: string) {
  return type === "order" ? `/orders/${id}` : type === "quality_inspection" ? `/quality/${id}` : type === "quote" ? `/quotes/${id}` : type === "invoice" ? `/invoices/${id}` : "/maintenance";
}

/** "After 2 days late · dispatch role · due in 1 working day". */
export function ruleSummary(rule: Pick<RuleRow, "event_type" | "threshold" | "assignee_mode" | "assignee_role" | "assignee_name" | "due_days" | "due_calendar">) {
  const event = TRIGGER_EVENTS[rule.event_type];
  const when = event.unit ? `${rule.threshold} ${event.unit}` : "as soon as it happens";
  const who = rule.assignee_mode === "person"
    ? `${rule.assignee_name ?? "named employee"}${rule.assignee_role ? `, else ${ROLE_LABELS[rule.assignee_role] ?? rule.assignee_role}` : ""}`
    : `least-loaded ${ROLE_LABELS[rule.assignee_role ?? ""] ?? rule.assignee_role}`;
  const due = rule.due_days === 0 ? "due the same day" : `due in ${rule.due_days} ${rule.due_calendar === "working_days" ? "working " : ""}day${rule.due_days === 1 ? "" : "s"}`;
  return `${when} · ${who} · ${due}`;
}

/** Whether a failed run should be retried with the same request id (the response may have been lost). */
export const isRetryableRunError = (error: string) => /could not be completed\. Check your session and retry/.test(error);
