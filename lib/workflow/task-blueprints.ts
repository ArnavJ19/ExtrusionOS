// UPGRADE_EOS feature 61 (standard blueprint for every task). The database stores blueprints,
// evaluates prerequisites from current records and refuses to start work while one is unmet; this
// module validates commands and responses and lays out the shared eight-part structure.
import { z } from "zod";

export const BLUEPRINT_MANAGERS = ["owner", "admin", "factory_manager"] as const;
export const canManageBlueprints = (role: string) => (BLUEPRINT_MANAGERS as readonly string[]).includes(role);
/** Mirrors private.blueprint_roles: internal roles that can carry out or resolve work. */
export const BLUEPRINT_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality"] as const;
export type BlueprintRole = (typeof BLUEPRINT_ROLES)[number];
export const TASK_KIND_PATTERN = /^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$/;
/** Record types and states a prerequisite may name; mirrors private.task_source_states. */
export const PREREQUISITE_STATES = {
  order: ["order_confirmed", "die_ready", "billet_ready", "billet_heating", "extrusion_planned", "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing", "packing", "dispatched", "delivered", "payment_pending", "closed", "cancelled"],
  quality_inspection: ["pending", "approved", "rejected", "rework"],
  production_job: ["planned", "ready", "in_progress", "completed", "on_hold", "cancelled"],
  dispatch: ["pending", "dispatched", "in_transit", "delivered", "delayed", "damaged", "returned"],
  quote: ["draft", "internal_review", "approved_for_sending", "sent", "customer_approved", "customer_rejected", "expired", "converted_to_order"],
  invoice: ["draft", "generated", "sent", "partially_paid", "paid", "overdue", "credited", "cancelled"],
  breakdown_log: ["open", "in_progress", "resolved", "recurring"]
} as const;
export type PrerequisiteRecord = keyof typeof PREREQUISITE_STATES;
const RECORD_KEYS = Object.keys(PREREQUISITE_STATES) as [PrerequisiteRecord, ...PrerequisiteRecord[]];

const uuid = z.string().uuid();
const prerequisiteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("linked_record"), entity_type: z.enum(RECORD_KEYS) }).strict(),
  z.object({ kind: z.literal("record_state"), entity_type: z.enum(RECORD_KEYS), states: z.array(z.string()).min(1, "A record-state prerequisite needs at least one state") }).strict()
]);
export type Prerequisite = z.infer<typeof prerequisiteSchema>;

/** Mirrors private.blueprint_problem for prerequisites. */
export function prerequisiteProblem(list: Prerequisite[]): string | null {
  if (list.length > 6) return "List up to 6 prerequisites";
  for (const p of list) {
    if (p.kind === "record_state" && p.states.some((s) => !(PREREQUISITE_STATES[p.entity_type] as readonly string[]).includes(s))) return "A required state is not valid for that record type";
  }
  if (new Set(list.map((p) => p.entity_type)).size > 1) return "All prerequisites must refer to the same linked record type";
  return null;
}

const saveSchema = z.object({
  command: z.literal("blueprint.save"), id: uuid, expected_revision: z.number().int().positive().optional(),
  task_kind: z.string().regex(TASK_KIND_PATTERN, "Choose the kind of task the blueprint applies to"),
  title: z.string().trim().min(3).max(120), purpose: z.string().trim().min(3).max(800), trigger_text: z.string().trim().min(3).max(300),
  inputs: z.array(z.string().trim().min(2, "Each input needs 2 to 120 characters").max(120, "Each input needs 2 to 120 characters")).max(10, "List up to 10 inputs"),
  responsible_roles: z.array(z.enum(BLUEPRINT_ROLES)).min(1, "Choose at least one responsible employee role"),
  prerequisites: z.array(prerequisiteSchema).max(6, "List up to 6 prerequisites"),
  exception_role: z.enum(BLUEPRINT_ROLES), exception_instruction: z.string().trim().min(3).max(300), is_active: z.boolean(),
  note: z.string().trim().min(3, "Record why the blueprint is saved (3 to 300 characters)").max(300)
}).strict().superRefine((value, ctx) => {
  const problem = prerequisiteProblem(value.prerequisites);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ["prerequisites"] });
});

export const taskBlueprintCommandSchema = z.union([
  saveSchema,
  z.discriminatedUnion("command", [
    z.object({ command: z.literal("blueprints.list"), page: z.number().int().min(1).max(100000).default(1), search: z.string().trim().max(80).default(""), status: z.enum(["all", "active", "inactive"]).default("all"), sort: z.enum(["kind", "title", "updated"]).default("kind") }).strict(),
    z.object({ command: z.literal("blueprint.load"), blueprint_id: uuid, page: z.number().int().min(1).max(100000).default(1) }).strict(),
    z.object({ command: z.literal("task.blueprint"), task_id: uuid }).strict(),
    z.object({ command: z.literal("exception.raise"), task_id: uuid, id: uuid, reason: z.string().trim().min(3, "Describe why the task cannot proceed (3 to 500 characters)").max(500) }).strict(),
    z.object({ command: z.literal("exception.resolve"), exception_id: uuid, resolution: z.string().trim().min(3, "Record the outcome (3 to 500 characters)").max(500) }).strict(),
    z.object({ command: z.literal("exceptions.list"), status: z.enum(["open", "resolved"]).default("open"), page: z.number().int().min(1).max(100000).default(1) }).strict()
  ])
]);
export type TaskBlueprintCommand = z.infer<typeof taskBlueprintCommandSchema>;

const blueprintSchema = z.object({
  id: uuid, task_kind: z.string(), title: z.string(), purpose: z.string(), trigger_text: z.string(), inputs: z.array(z.string()), responsible_roles: z.array(z.string()),
  prerequisites: z.array(prerequisiteSchema), exception_role: z.string(), exception_instruction: z.string(), is_active: z.boolean(), revision: z.number().int(),
  updated_by_name: z.string(), updated_at: z.string(),
  procedure: z.object({ id: uuid, title: z.string(), version_no: z.number().int().nullable() }).strict().nullable(), criteria_templates: z.number().int()
}).strict();
export type Blueprint = z.infer<typeof blueprintSchema>;

const checkSchema = z.object({ kind: z.enum(["assignee_role", "linked_record", "record_state"]), label: z.string(), met: z.boolean(), reason: z.string().nullable(), current: z.string().nullable() }).strict();
export const evaluationSchema = z.object({ blueprint_id: uuid, revision: z.number().int(), unmet: z.number().int(), checks: z.array(checkSchema) }).strict();

export const blueprintsListSchema = z.object({ rows: z.array(z.object({
  id: uuid, task_kind: z.string(), title: z.string(), is_active: z.boolean(), revision: z.number().int(), responsible_roles: z.array(z.string()),
  prerequisite_count: z.number().int(), exception_role: z.string(), open_exceptions: z.number().int()
}).strict()).max(10), total_count: z.number().int().nonnegative() }).strict();
export const blueprintLoadSchema = z.object({
  blueprint: blueprintSchema,
  revisions: z.array(z.object({ revision: z.number().int(), note: z.string(), saved_by_name: z.string(), saved_at: z.string(), snapshot: z.record(z.unknown()) }).strict()).max(10),
  total_count: z.number().int()
}).strict();
export const taskBlueprintSchema = z.union([
  z.object({ has_blueprint: z.literal(false) }).strict(),
  z.object({
    has_blueprint: z.literal(true), blueprint: blueprintSchema, evaluation: evaluationSchema,
    started_check: z.object({ revision: z.number().int(), started_at: z.string(), evaluation: evaluationSchema }).strict().nullable(),
    open_exception: z.object({ id: uuid, reason: z.string(), routed_role: z.string(), raised_by_name: z.string(), raised_at: z.string() }).strict().nullable(),
    can_raise: z.boolean()
  }).strict()
]);
export type TaskBlueprintView = z.infer<typeof taskBlueprintSchema>;
export const exceptionsListSchema = z.object({
  rows: z.array(z.object({
    id: uuid, task_id: uuid, task_title: z.string(), routed_role: z.string(), reason: z.string(), raised_by_name: z.string(), raised_at: z.string(), status: z.enum(["open", "resolved"]),
    resolution: z.string().nullable(), resolved_by_name: z.string().nullable(), resolved_at: z.string().nullable(), can_resolve: z.boolean()
  }).strict()).max(10),
  total_count: z.number().int()
}).strict();

export const roleLabel = (role: string) => role.replace(/_/g, " ");
export function describeKind(kind: string) {
  return kind.startsWith("handoff:") ? `Handoff to ${kind.slice(8)}` : `Task type ${kind.slice(5).replace(/_/g, " ")}`;
}

/** The same eight headings for every blueprint, in order. */
export function blueprintSections(b: Blueprint) {
  return [
    { heading: "Purpose", body: b.purpose },
    { heading: "Trigger", body: b.trigger_text },
    { heading: "Inputs", body: b.inputs.length ? b.inputs.join(" · ") : "None listed" },
    { heading: "Responsible", body: b.responsible_roles.map(roleLabel).join(", ") },
    { heading: "Prerequisites", body: b.prerequisites.length ? b.prerequisites.map((p) => p.kind === "linked_record" ? `Linked to a ${roleLabel(p.entity_type)}` : `Linked ${roleLabel(p.entity_type)} is ${p.states.map(roleLabel).join(" or ")}`).join("; ") : "Assignment to a responsible role only" },
    { heading: "Steps", body: b.procedure ? `${b.procedure.title}${b.procedure.version_no ? ` v${b.procedure.version_no}` : " (no released version)"}` : "No operating procedure is set for this task kind" },
    { heading: "Completion evidence", body: b.criteria_templates ? `${b.criteria_templates} completion criteria apply` : "No completion criteria are set" },
    { heading: "Exception route", body: `${roleLabel(b.exception_role)}: ${b.exception_instruction}` }
  ];
}
