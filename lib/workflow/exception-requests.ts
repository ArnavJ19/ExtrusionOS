// UPGRADE_EOS feature 45 (approval requests at the point of restriction). The database defines
// which restrictions a company lets employees request an exception to, binds each request to the
// record's content, and its guards accept an approval only for that exact record and content; this
// module validates commands and responses.
import { z } from "zod";

export const EXCEPTION_TYPES = {
  low_margin_quote: {
    label: "Low-margin quotation release", entity: "quote", requesters: ["sales_manager", "sales"], approvers: ["owner", "admin", "sales_manager"],
    restriction: "A quotation below its minimum margin can be released only by an owner or admin."
  },
  overdue_dispatch: {
    label: "Dispatch to a customer with overdue payments", entity: "order", requesters: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch"], approvers: ["owner", "admin", "accounts", "sales_manager"],
    restriction: "When enabled, material is not dispatched to a customer whose overdue balance reaches the set amount."
  }
} as const;
export type ExceptionType = keyof typeof EXCEPTION_TYPES;
const TYPE_KEYS = Object.keys(EXCEPTION_TYPES) as [ExceptionType, ...ExceptionType[]];

export const canRequestException = (role: string, type: ExceptionType) => (EXCEPTION_TYPES[type].requesters as readonly string[]).includes(role);
export const canSetExceptionPolicy = (role: string) => role === "owner" || role === "admin";
/** Whether a role may ever approve an exception (the policy picks which of these actually do). */
export const canApproveExceptions = (role: string) => TYPE_KEYS.some((type) => (EXCEPTION_TYPES[type].approvers as readonly string[]).includes(role));

const uuid = z.string().uuid();
const money = z.number().finite().positive().max(1e12);
const commandSchemas = {
  "policy.list": z.object({ command: z.literal("policy.list") }).strict(),
  "policy.set": z.object({
    command: z.literal("policy.set"), exception_type: z.enum(TYPE_KEYS), is_active: z.boolean(), approver_roles: z.array(z.string()).min(1, "Choose who approves these exceptions").max(4),
    validity_hours: z.number().int().min(1).max(168), overdue_days: z.number().int().min(0).max(365).default(0), min_overdue_amount: money.default(1),
    hard_limit_amount: money.nullable().default(null), max_shortfall_points: z.number().finite().min(0).max(100).nullable().default(null)
  }).strict().superRefine((value, ctx) => {
    if (!value.approver_roles.every((role) => (EXCEPTION_TYPES[value.exception_type].approvers as readonly string[]).includes(role))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose approvers allowed for this exception" });
    if (value.hard_limit_amount !== null && value.hard_limit_amount < value.min_overdue_amount) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The hard limit must be at or above the minimum overdue amount" });
  }),
  "restriction.check": z.object({ command: z.literal("restriction.check"), exception_type: z.enum(TYPE_KEYS), entity_id: uuid }).strict(),
  "request.create": z.object({
    command: z.literal("request.create"), id: uuid, exception_type: z.enum(TYPE_KEYS), entity_id: uuid,
    reason: z.string().trim().min(10, "Explain why the exception is needed (10 to 500 characters)").max(500, "Explain why the exception is needed (10 to 500 characters)"),
    weight_kg: z.number().finite().positive("Enter the weight to dispatch in kg").max(1000000).optional()
  }).strict().refine((value) => (value.exception_type === "overdue_dispatch") === (value.weight_kg !== undefined), "Enter the weight to dispatch in kg"),
  "request.list": z.object({ command: z.literal("request.list"), view: z.enum(["to_decide", "mine", "decided"]).default("to_decide"), page: z.number().int().min(1).max(100000).default(1) }).strict(),
  "request.decide": z.object({ command: z.literal("request.decide"), id: uuid, decision: z.enum(["approve", "reject"]), version: z.string().regex(/^[0-9a-f]{32}$/), note: z.string().trim().max(500).default("") }).strict()
    .refine((value) => value.decision === "approve" || value.note.length >= 3, "Say why the exception is rejected (3 to 500 characters)"),
  "request.withdraw": z.object({ command: z.literal("request.withdraw"), id: uuid }).strict()
} as const;
export type ExceptionCommandName = keyof typeof commandSchemas;
export const EXCEPTION_WRITE_COMMANDS: readonly ExceptionCommandName[] = ["policy.set", "request.create", "request.decide", "request.withdraw"];

export function parseExceptionCommand(input: unknown) {
  const name = input && typeof input === "object" ? (input as { command?: unknown }).command : undefined;
  if (typeof name !== "string" || !(name in commandSchemas)) return { success: false as const, error: "Invalid exception request" };
  const parsed = commandSchemas[name as ExceptionCommandName].safeParse(input);
  if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid exception request" };
  return { success: true as const, data: parsed.data as { command: ExceptionCommandName } & Record<string, unknown> };
}

const num = z.union([z.number(), z.string()]).transform(Number);
const nullableNum = z.union([z.number(), z.string()]).nullable().transform((value) => (value === null ? null : Number(value)));
const STATUSES = ["pending", "approved", "rejected", "withdrawn", "superseded", "expired", "used"] as const;
export type ExceptionStatus = (typeof STATUSES)[number];

export const policySchema = z.object({
  exception_type: z.enum(TYPE_KEYS), is_active: z.boolean(), approver_roles: z.array(z.string()), validity_hours: z.number().int(), overdue_days: z.number().int(),
  min_overdue_amount: num, hard_limit_amount: nullableNum, max_shortfall_points: nullableNum, updated_by: uuid, updated_at: z.string()
}).strict();
export type ExceptionPolicy = z.infer<typeof policySchema>;
export const policyListSchema = z.array(policySchema);

export const restrictionSchema = z.object({
  entity_type: z.enum(["quote", "order"]), reference: z.string().nullable(), restricted: z.boolean(), reason: z.string(), policy_active: z.boolean(), blocker: z.string().nullable(),
  exposure: nullableNum, detail: z.record(z.unknown()), can_request: z.boolean(),
  requests: z.array(z.object({
    id: uuid, status: z.enum(STATUSES), weight_kg: nullableNum, requested_by_name: z.string(), requested_at: z.string(), decided_by_name: z.string().nullable(),
    decision_note: z.string().nullable(), expires_at: z.string().nullable(), covers_current: z.boolean()
  }).strict()).max(5)
}).strict();
export type Restriction = z.infer<typeof restrictionSchema>;

export const requestListSchema = z.object({
  rows: z.array(z.object({
    id: uuid, exception_type: z.enum(TYPE_KEYS), entity_type: z.enum(["quote", "order"]), entity_id: uuid, reference: z.string(), detail: z.record(z.unknown()), reason: z.string(),
    return_path: z.string(), requested_by_name: z.string(), requested_at: z.string(), status: z.enum(STATUSES), decided_by_name: z.string().nullable(), decided_at: z.string().nullable(),
    weight_kg: nullableNum, decision_note: z.string().nullable(), expires_at: z.string().nullable(), first_used_at: z.string().nullable(), version: z.string(), current: z.boolean(),
    blocker: z.string().nullable(), current_detail: z.record(z.unknown()).nullable()
  }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();
export type ExceptionRequestRow = z.infer<typeof requestListSchema>["rows"][number];
export const decisionSchema = z.object({ id: uuid, status: z.enum(["approved", "rejected", "superseded"]), message: z.string().nullable() }).strict();

export const STATUS_LABELS: Record<ExceptionStatus, string> = {
  pending: "Waiting for a decision", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", superseded: "Superseded: the record changed", expired: "Approval expired", used: "Used by a dispatch"
};

/** "QT-0101 · INR 5,00,000 · margin 4.4% (8% required)" or "SO-0042 · Kumar Facades · INR 1,80,000 overdue · 1,250.5 kg". */
export function exceptionSummary(row: { exception_type: ExceptionType; reference: string; detail: Record<string, unknown> }, formatMoney: (value: number) => string) {
  const d = row.detail;
  if (row.exception_type === "low_margin_quote") {
    return [row.reference, d.grand_total !== undefined ? formatMoney(Number(d.grand_total)) : null, d.margin_percent !== undefined ? `margin ${d.margin_percent}% (${d.required_percent}% required)` : null].filter(Boolean).join(" · ");
  }
  return [row.reference, d.customer ? String(d.customer) : null, d.overdue_amount !== undefined ? `${formatMoney(Number(d.overdue_amount))} overdue` : null, d.weight_kg !== undefined ? `${d.weight_kg} kg to dispatch` : null].filter(Boolean).join(" · ");
}

/** Database messages that carry amounts or weights (shown as written). */
export const DYNAMIC_EXCEPTION_MESSAGES = [
  /^Margin [-0-9.]+% is below/, /^The margin is [0-9.]+ points short, more than the [0-9.]+ points an exception may cover$/,
  /^INR [0-9.]+ overdue is above the INR [0-9.]+ hard limit: collect payment before dispatching$/,
  /^Dispatch held: INR [0-9.]+ (is overdue for more than [0-9]+ days\. Collect payment or request an exception|overdue is above the INR [0-9.]+ hard limit\. Collect payment before dispatching)$/,
  /^More has fallen overdue since the exception was approved \(now INR [0-9.]+\)\. Request a new exception$/,
  /^This dispatch \([0-9.]+ kg\) is more than the [0-9.]+ kg the exception approved$/
];
