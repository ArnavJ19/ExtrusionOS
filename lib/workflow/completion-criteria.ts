// UPGRADE_EOS feature 67 (objective completion criteria). The database evaluates each criterion
// from current records and refuses completion while one is unmet; this module validates commands
// and responses and describes criteria for the task page.
import { z } from "zod";

export const CRITERIA_MANAGERS = ["owner", "admin", "factory_manager"] as const;
export const CRITERIA_SUPERVISORS = [...CRITERIA_MANAGERS, "production_manager", "dispatch_manager", "sales_manager"] as const;
export const canManageTemplates = (role: string) => (CRITERIA_MANAGERS as readonly string[]).includes(role);
export const canSuperviseCriteria = (role: string) => (CRITERIA_SUPERVISORS as readonly string[]).includes(role);
export const SIGN_OFF_ROLES = ["owner", "admin", "factory_manager", "production_manager", "dispatch_manager", "sales_manager", "quality", "accounts"] as const;

export const CRITERION_KINDS = {
  source_state: "Linked record is in a required state",
  inspection_pass: "Linked inspection passes its plan",
  handoff_accepted: "Handoff accepted by the receiving team",
  observation: "Recorded value within limits",
  sign_off: "Sign-off by another employee"
} as const;
export type CriterionKind = keyof typeof CRITERION_KINDS;
const KIND_KEYS = Object.keys(CRITERION_KINDS) as [CriterionKind, ...CriterionKind[]];

/** States each record type can be in; mirrors private.task_source_states. */
export const SOURCE_STATES = {
  order: ["order_confirmed", "die_ready", "billet_ready", "billet_heating", "extrusion_planned", "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing", "packing", "dispatched", "delivered", "payment_pending", "closed", "cancelled"],
  quality_inspection: ["pending", "approved", "rejected", "rework"],
  production_job: ["planned", "ready", "in_progress", "completed", "on_hold", "cancelled"],
  dispatch: ["pending", "dispatched", "in_transit", "delivered", "delayed", "damaged", "returned"],
  quote: ["draft", "internal_review", "approved_for_sending", "sent", "customer_approved", "customer_rejected", "expired", "converted_to_order"],
  invoice: ["draft", "generated", "sent", "partially_paid", "paid", "overdue", "credited", "cancelled"],
  breakdown_log: ["open", "in_progress", "resolved", "recurring"]
} as const;
export type SourceType = keyof typeof SOURCE_STATES;
export const TASK_KIND_PATTERN = /^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$/;

const uuid = z.string().uuid();
const label = z.string().trim().min(3, "Describe the criterion (3 to 120 characters)").max(120, "Describe the criterion (3 to 120 characters)");
const configSchema = z.record(z.unknown());

/** Mirrors private.criterion_config_problem. */
export function configProblem(kind: string, config: Record<string, unknown>): string | null {
  if (kind === "source_state") {
    const type = config.source_type as string;
    if (!(type in SOURCE_STATES)) return "Choose the kind of record this criterion checks";
    const states = config.states;
    if (!Array.isArray(states) || !states.length) return "Choose at least one required state";
    if (!states.every((state) => (SOURCE_STATES[type as SourceType] as readonly string[]).includes(String(state)))) return "A required state does not exist for this kind of record";
    return null;
  }
  if (kind === "observation") {
    const unit = String(config.unit ?? "").trim();
    if (unit.length < 1 || unit.length > 20) return "Give the unit of the observation (1 to 20 characters)";
    const bound = (value: unknown) => (value === null || value === undefined || value === "" ? null : Number(value));
    const min = bound(config.min); const max = bound(config.max);
    if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) return "Observation limits must be numbers";
    if (min === null && max === null) return "Set at least one observation limit";
    if (min !== null && max !== null && min > max) return "The lower limit is above the upper limit";
    return null;
  }
  if (kind === "sign_off") {
    const roles = config.roles;
    if (!Array.isArray(roles) || !roles.length) return "Choose who may sign off";
    if (!roles.every((role) => (SIGN_OFF_ROLES as readonly string[]).includes(String(role)))) return "Only supervisors, quality or accounts can sign off";
    return null;
  }
  return kind === "inspection_pass" || kind === "handoff_accepted" ? null : "Choose a supported criterion";
}

const withConfig = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict().superRefine((value: { kind?: string; config?: Record<string, unknown> }, ctx) => {
  const problem = configProblem(String(value.kind), value.config ?? {});
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

const commandSchemas = {
  "task.evaluate": z.object({ command: z.literal("task.evaluate"), task_id: uuid }).strict(),
  "evidence.observe": z.object({ command: z.literal("evidence.observe"), task_id: uuid, criterion_id: uuid, value: z.number({ invalid_type_error: "Enter the observed value as a number" }).finite("Enter the observed value as a number"), note: z.string().trim().max(300).default("") }).strict(),
  "evidence.sign_off": z.object({ command: z.literal("evidence.sign_off"), task_id: uuid, criterion_id: uuid, note: z.string().trim().max(300).default("") }).strict(),
  "criteria.add": withConfig({ command: z.literal("criteria.add"), task_id: uuid, id: uuid, kind: z.enum(KIND_KEYS), label, config: configSchema.default({}) }),
  "criteria.remove": z.object({ command: z.literal("criteria.remove"), task_id: uuid, criterion_id: uuid, reason: z.string().trim().min(3, "Record why the criterion is removed (3 to 300 characters)").max(300, "Record why the criterion is removed (3 to 300 characters)") }).strict(),
  "templates.list": z.object({ command: z.literal("templates.list") }).strict(),
  "templates.save": withConfig({
    command: z.literal("templates.save"), id: uuid, expected_updated_at: z.string().nullable().optional(),
    task_kind: z.string().regex(TASK_KIND_PATTERN, "Choose the kind of task the criterion applies to"), seq: z.number().int().min(1).max(100).default(1),
    kind: z.enum(KIND_KEYS), label, config: configSchema.default({}), is_active: z.boolean().default(true)
  }),
  "review.list": z.object({ command: z.literal("review.list"), page: z.number().int().min(1).max(100000).default(1) }).strict(),
  "task.reopen": z.object({ command: z.literal("task.reopen"), task_id: uuid, reason: z.string().trim().min(3, "Record why the task is reopened (3 to 300 characters)").max(300, "Record why the task is reopened (3 to 300 characters)") }).strict()
} as const;
export type CriteriaCommandName = keyof typeof commandSchemas;
export const CRITERIA_WRITE_COMMANDS: readonly CriteriaCommandName[] = ["evidence.observe", "evidence.sign_off", "criteria.add", "criteria.remove", "templates.save", "task.reopen"];
export const CRITERIA_SUPERVISOR_COMMANDS: readonly CriteriaCommandName[] = ["criteria.add", "criteria.remove", "review.list", "task.reopen", "templates.list"];

export function parseCriteriaCommand(input: unknown) {
  const name = input && typeof input === "object" ? (input as { command?: unknown }).command : undefined;
  if (typeof name !== "string" || !(name in commandSchemas)) return { success: false as const, error: "Invalid completion criteria request" };
  const parsed = commandSchemas[name as CriteriaCommandName].safeParse(input);
  if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid completion criteria request" };
  return { success: true as const, data: parsed.data as { command: CriteriaCommandName } & Record<string, unknown> };
}

const num = z.union([z.number(), z.string()]).transform(Number);
export const evaluationSchema = z.object({
  task_id: uuid, status: z.enum(["open", "in_progress", "completed", "cancelled"]), total: z.number().int(), unmet: z.number().int(), state: z.enum(["none", "met", "unmet"]),
  criteria: z.array(z.object({
    id: uuid, seq: z.number().int(), kind: z.enum(KIND_KEYS), label: z.string(), config: z.record(z.unknown()), source_type: z.string().nullable(), source_id: uuid.nullable(),
    met: z.boolean(), reason: z.string().nullable(), state: z.string().nullable(), from_template: z.boolean(),
    evidence: z.object({ value: num.nullable(), note: z.string().nullable(), recorded_by_name: z.string(), recorded_at: z.string() }).strict().nullable()
  }).strict()).max(20)
}).strict();
export type CriteriaEvaluation = z.infer<typeof evaluationSchema>;
export type Criterion = CriteriaEvaluation["criteria"][number];

export const templateListSchema = z.array(z.object({
  id: uuid, task_kind: z.string(), seq: z.number().int(), kind: z.enum(KIND_KEYS), label: z.string(), config: z.record(z.unknown()), is_active: z.boolean(), updated_by: uuid, updated_at: z.string()
}).strict());
export type CriteriaTemplate = z.infer<typeof templateListSchema>[number];

export const reviewListSchema = z.object({
  rows: z.array(z.object({ id: uuid, title: z.string(), completed_at: z.string().nullable(), assigned_to: uuid.nullable(), assignee_name: z.string().nullable(), evaluation: evaluationSchema }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();

const words = (value: string) => value.replace(/_/g, " ");
/** "Order is dispatched or delivered", "Coating thickness 60 – 120 micron", "Sign-off by quality". */
export function criterionRule(criterion: { kind: CriterionKind; label: string; config: Record<string, unknown> }) {
  const c = criterion.config;
  if (criterion.kind === "source_state") return `${words(String(c.source_type))} is ${(c.states as string[]).map(words).join(" or ")}`;
  if (criterion.kind === "observation") {
    const min = c.min ?? null; const max = c.max ?? null;
    return min !== null && max !== null ? `${min} – ${max} ${c.unit}` : min !== null ? `at least ${min} ${c.unit}` : `at most ${max} ${c.unit}`;
  }
  if (criterion.kind === "sign_off") return `sign-off by ${(c.roles as string[]).map(words).join(" or ")}, not the assignee`;
  return CRITERION_KINDS[criterion.kind].toLowerCase();
}

/** What the current employee can do on one criterion of an open task. */
export function criterionActions(criterion: { kind: CriterionKind; config: Record<string, unknown> }, viewer: { userId: string; role: string }, task: { status: string; assigned_to: string | null }) {
  const open = task.status === "open" || task.status === "in_progress";
  const isAssignee = task.assigned_to !== null && task.assigned_to === viewer.userId;
  return {
    observe: open && criterion.kind === "observation" && (isAssignee || canSuperviseCriteria(viewer.role)),
    signOff: open && criterion.kind === "sign_off" && !isAssignee && ((criterion.config.roles as string[] | undefined) ?? []).includes(viewer.role),
    remove: open && canSuperviseCriteria(viewer.role)
  };
}
