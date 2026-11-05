// November batch 8 (NOV-014/019/036/044/045/047/052/075/077/087): delivery appointments, returnable
// gate passes, vehicle load plans, a protected execution window, advisory stage limits, capacity-aware
// assignment, approved workflow routes, prepared customer messages and small queue updates.
// The database owns every read model and guarded action; this module validates commands and
// responses and mirrors role access so screens never offer an action the server would refuse.
import { z } from "zod";

export const EXECUTION_VIEWS = {
  appointments: "Delivery appointments", gate_passes: "Returnable gate passes", loads: "Vehicle load plans", windows: "Protected execution window", wip: "Stage work-in-progress limits",
  assignments: "Task assignment", rules: "Assignment rules and availability", routes: "Workflow routes", messages: "Customer messages", queue: "Queue updates"
} as const;
export type ExecutionView = keyof typeof EXECUTION_VIEWS;
export const EXECUTION_DESCRIPTIONS: Record<ExecutionView, string> = {
  appointments: "Requested slots, site confirmations and actual arrivals, kept as separate facts with every reviewed revision.",
  gate_passes: "Dies, gauges, racks and pallets that left temporarily: who holds them, what is outstanding and what is overdue.",
  loads: "Reviewed vehicle loads with unloading stops, loading confirmation and a departure check across several orders.",
  windows: "Near-term work that changes only through a reviewed request, plus the policy that protects it.",
  wip: "Queued, active and held work at each stage against advisory limits in one stated unit.",
  assignments: "Open tasks with nobody eligible and available assigned, with the evidence behind each candidate.",
  rules: "Which roles and competencies may take each task type, and who is unavailable.",
  routes: "Approved step sequences for different order types and the deviations awaiting a second person.",
  messages: "Customer messages prepared from a transaction. Preparation is recorded; sending is not tracked.",
  queue: "Open tasks where assignee, priority or planned date can be changed in place after a review."
};
const viewKeys = Object.keys(EXECUTION_VIEWS) as [ExecutionView, ...ExecutionView[]];

export const EXECUTION_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"] as const;
const supervisors = ["owner", "admin", "factory_manager", "production_manager", "quality", "dispatch_manager", "inventory_manager", "sales_manager"];
const VIEW_ROLES: Record<ExecutionView, readonly string[]> = {
  appointments: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "sales_manager", "sales", "inventory_manager", "production_manager", "viewer"],
  gate_passes: ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "inventory_manager", "dispatch_manager", "dispatch", "viewer"],
  loads: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "production_manager", "viewer"],
  windows: ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "dispatch_manager", "inventory_manager", "viewer"],
  wip: ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "dispatch_manager", "inventory_manager", "viewer"],
  assignments: supervisors, rules: supervisors, queue: supervisors, routes: EXECUTION_ROLES,
  messages: ["owner", "admin", "factory_manager", "sales_manager", "sales", "accounts", "dispatch_manager", "dispatch"]
};

/** Mirrors private.execution_read_allowed. */
export function canReadExecution(role: string, view?: ExecutionView) {
  if (!(EXECUTION_ROLES as readonly string[]).includes(role)) return false;
  return view ? VIEW_ROLES[view].includes(role) : true;
}
/** Roles that may see a receiving contact's full phone number. */
export const CONTACT_ROLES = ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "sales_manager", "sales"];

const uuid = z.string().uuid("Choose a record from the search results");
const control = /[\u0000-\u001f\u007f]/;
const note = z.string().trim().min(5, "Explain the action in at least 5 characters").max(500, "Keep the explanation within 500 characters").refine(value => !control.test(value), "Remove control characters");
// The database refuses control characters, including line breaks; forms join lines before sending.
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label} needs at least ${min} characters`).max(max, `Keep ${label.toLowerCase()} within ${max} characters`)
  .refine(value => !control.test(value), "Remove control characters");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/, "Choose a date and time");
const phone = z.string().trim().regex(/^(\+91[\s-]?|91[\s-]?|0)?[6-9][0-9\s-]{9,12}$/, "Enter a 10-digit Indian mobile number");
const whole = (min: number, max: number, label: string) => z.number().int(`${label} must be a whole number`).min(min, `${label}: ${min} or more`).max(max, `${label}: at most ${max}`);

export const STAGES = { order_confirmed: "Order confirmed", die_ready: "Die ready", billet_ready: "Billet ready", billet_heating: "Billet heating", extrusion_planned: "Extrusion planned", extruded: "Extruded",
  stretching: "Stretching", cutting: "Cutting", aging: "Ageing", surface_treatment: "Surface treatment", finishing: "Finishing", packing: "Packing", dispatched: "Dispatched", delivered: "Delivered",
  payment_pending: "Payment pending", closed: "Closed" } as const;
export const WIP_STAGES = { at_press: "At the press", at_vendor: "At a finishing vendor", awaiting_finishing: "Awaiting finishing", awaiting_qc: "Awaiting quality check", awaiting_packing: "Awaiting packing", on_hold: "On hold" } as const;
export const GATE_KINDS = { die: "Die", gauge: "Gauge", rack: "Rack", pallet: "Pallet", other: "Other returnable" } as const;
export const CUSTODIAN_KINDS = { vendor: "Vendor", customer: "Customer", employee: "Employee", other: "Other" } as const;
export const MESSAGE_TEMPLATES = { order_confirmation: "Order confirmation", dispatch_notice: "Dispatch notice", appointment_notice: "Appointment notice" } as const;
export const ROUTE_NON_SKIPPABLE = ["order_confirmed", "packing", "dispatched", "closed"] as const;
export const ASSIGNABLE_ROLES = { owner: "Owner", admin: "Admin", factory_manager: "Factory manager", production_manager: "Production manager", production: "Production", quality: "Quality", dispatch_manager: "Dispatch manager",
  dispatch: "Dispatch", inventory_manager: "Inventory manager", sales_manager: "Sales manager", sales: "Sales", accounts: "Accounts" } as const;
const keysOf = <T extends Record<string, string>>(value: T) => Object.keys(value) as [keyof T & string, ...(keyof T & string)[]];

const queueRecord = z.object({ id: uuid, version: z.string().min(10).max(40) }).strict();

export const executionMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("appointment.request"), order_id: uuid, dispatch_id: uuid.optional(), requested_start: instant, requested_end: instant, owner_id: uuid, site_address: text(5, 400, "Site address").optional(),
    contact_name: text(2, 80, "Contact name").optional(), contact_phone: phone.optional(), access_restrictions: text(5, 300, "Access restrictions").optional(), preparations: text(5, 300, "Preparations").optional(), note }).strict(),
  z.object({ action: z.literal("appointment.confirm"), id: uuid, confirmed_start: instant, confirmed_end: instant, confirmed_by_name: text(3, 80, "Confirmed by"), note }).strict(),
  z.object({ action: z.literal("appointment.reschedule"), id: uuid, requested_start: instant, requested_end: instant, site_address: text(5, 400, "Site address").optional(), contact_name: text(2, 80, "Contact name").optional(),
    contact_phone: phone.optional(), access_restrictions: text(5, 300, "Access restrictions").optional(), preparations: text(5, 300, "Preparations").optional(), note }).strict(),
  z.object({ action: z.literal("appointment.cancel"), id: uuid, note }).strict(),
  z.object({ action: z.literal("appointment.arrive"), id: uuid, note }).strict(),
  z.object({ action: z.literal("appointment.outcome"), id: uuid, result: z.enum(["completed", "unloading_failed", "missed"]), note }).strict(),
  z.object({ action: z.literal("gatepass.issue"), item_kind: z.enum(keysOf(GATE_KINDS)), die_id: uuid.optional(), item_label: text(2, 120, "Item"), serial_ref: text(1, 60, "Serial reference").optional(), quantity: whole(1, 10000, "Quantity"),
    custodian_name: text(2, 120, "Custodian"), custodian_kind: z.enum(keysOf(CUSTODIAN_KINDS)), purpose: text(5, 300, "Purpose"), due_date: day, owner_id: uuid, note }).strict(),
  z.object({ action: z.literal("gatepass.depart"), id: uuid, note }).strict(),
  z.object({ action: z.literal("gatepass.acknowledge"), id: uuid, acknowledged_by_name: text(2, 80, "Acknowledged by"), note }).strict(),
  z.object({ action: z.literal("gatepass.return"), id: uuid, quantity: whole(1, 10000, "Quantity"), condition: z.enum(["good", "damaged"]), note }).strict(),
  z.object({ action: z.literal("gatepass.lose"), id: uuid, quantity: whole(1, 10000, "Quantity"), note }).strict(),
  z.object({ action: z.literal("gatepass.extend"), id: uuid, due_date: day, note }).strict(),
  z.object({ action: z.literal("gatepass.cancel"), id: uuid, note }).strict(),
  z.object({ action: z.literal("loadplan.stop"), load_id: uuid, order_id: uuid, stop_seq: whole(1, 20, "Stop"), unload_note: text(5, 200, "Unloading note").optional(), note }).strict(),
  z.object({ action: z.literal("loadplan.confirm"), item_id: uuid, status: z.enum(["loaded", "not_loaded", "unloaded_exception"]), method: z.enum(["scan", "manual"]), note }).strict(),
  z.object({ action: z.literal("loadplan.review"), load_id: uuid, note }).strict(),
  z.object({ action: z.literal("window.set"), machine_id: uuid.optional(), horizon_hours: whole(12, 168, "Window"), enforce: z.boolean(), note }).strict(),
  z.object({ action: z.literal("window.retire"), id: uuid, note }).strict(),
  z.object({ action: z.literal("window.request"), job_id: uuid, new_date: day, new_shift: text(1, 20, "Shift").optional(), customer_effect: text(5, 300, "Customer effect"), note }).strict(),
  z.object({ action: z.literal("window.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("window.reject"), id: uuid, note }).strict(),
  z.object({ action: z.literal("wip.set_limit"), stage: z.enum(keysOf(WIP_STAGES)), unit: z.enum(["kg", "jobs"]), limit_value: z.number().finite().min(0.001).max(100000000), basis: text(5, 300, "Basis"), note }).strict(),
  z.object({ action: z.literal("wip.retire_limit"), id: uuid, note }).strict(),
  z.object({ action: z.literal("wip.release"), job_id: uuid, stage: z.enum(keysOf(WIP_STAGES)), note }).strict(),
  z.object({ action: z.literal("rule.set"), task_type: z.string().regex(/^[a-z0-9_]{2,40}$/, "Use 2 to 40 lowercase letters, digits or underscores"), allowed_roles: z.array(z.enum(keysOf(ASSIGNABLE_ROLES))).min(1, "Choose at least one role").max(12),
    competency_id: uuid.optional(), estimate_minutes: whole(1, 1440, "Estimate").optional(), note }).strict(),
  z.object({ action: z.literal("rule.retire"), id: uuid, note }).strict(),
  z.object({ action: z.literal("availability.record"), employee_id: uuid, starts_on: day, ends_on: day, kind: z.enum(["leave", "training", "off_shift", "other"]), note }).strict(),
  z.object({ action: z.literal("availability.cancel"), id: uuid, note }).strict(),
  z.object({ action: z.literal("assignment.assign"), id: uuid, assignee_id: uuid, override_reason: text(5, 300, "Override reason").optional(), note }).strict(),
  z.object({ action: z.literal("route.define"), code: z.string().regex(/^[a-z0-9_]{3,30}$/, "Use 3 to 30 lowercase letters, digits or underscores"), name: text(3, 80, "Name"), applies_when: text(5, 300, "Applies when"),
    required_stages: z.array(z.enum(keysOf(STAGES))).min(3, "A route needs its core stages").max(16), optional_stages: z.array(z.enum(keysOf(STAGES))).max(16).optional(), note }).strict(),
  z.object({ action: z.literal("route.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("route.retire"), id: uuid, note }).strict(),
  z.object({ action: z.literal("route.bind"), order_id: uuid, family_id: uuid, note }).strict(),
  z.object({ action: z.literal("route.deviate"), order_id: uuid, stage: z.enum(keysOf(STAGES)), note }).strict(),
  z.object({ action: z.literal("route.decide"), id: uuid, decision: z.enum(["approve", "reject"]), note }).strict(),
  z.object({ action: z.literal("message.prepare"), template: z.enum(keysOf(MESSAGE_TEMPLATES)), entity_id: uuid, recipient_phone: phone.optional() }).strict(),
  z.object({ action: z.literal("message.mark"), id: uuid, state: z.enum(["copied", "printed", "downloaded"]) }).strict(),
  z.object({ action: z.literal("message.cancel"), id: uuid }).strict(),
  z.object({ action: z.literal("queue.update"), selection: z.enum(["page", "filtered"]), field: z.enum(["assigned_to", "priority", "due_date"]), value: z.string().trim().min(3).max(40),
    records: z.array(queueRecord).min(1, "Select at least one task").max(50) }).strict()
]).superRefine((value, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (value.action === "gatepass.issue") {
    if (value.item_kind === "die" && !value.die_id) issue("die_id", "Choose the die that is leaving");
    if (value.item_kind !== "die" && value.die_id) issue("die_id", "Only a die pass names a die");
    if ((value.item_kind === "die" || value.serial_ref) && value.quantity !== 1) issue("quantity", "A serialised item leaves as quantity 1");
  }
  if (value.action === "wip.set_limit") {
    if (value.unit === "jobs" && !Number.isInteger(value.limit_value)) issue("limit_value", "A job limit is a whole number");
    if (value.unit === "kg" && Math.abs(value.limit_value * 1000 - Math.round(value.limit_value * 1000)) > 1e-6) issue("limit_value", "Use at most three decimals for kg");
  }
  if (value.action === "route.define") {
    const required = new Set(value.required_stages);
    if (required.size !== value.required_stages.length) issue("required_stages", "Use each stage once");
    for (const core of ["order_confirmed", "packing", "dispatched"]) if (!required.has(core as keyof typeof STAGES)) issue("required_stages", "Every route keeps order confirmation, packing and dispatch");
    if ((value.optional_stages ?? []).some(stage => required.has(stage))) issue("optional_stages", "A stage cannot be both required and optional");
  }
  if (value.action === "route.deviate" && (ROUTE_NON_SKIPPABLE as readonly string[]).includes(value.stage)) issue("stage", "This is a core control and is never skipped");
  if (value.action === "queue.update") {
    const ids = value.records.map(record => record.id);
    if (new Set(ids).size !== ids.length) issue("records", "A task is selected twice");
    if (value.selection === "page" && ids.length > 10) issue("records", "A page selection holds at most 10 tasks");
    if (value.field === "assigned_to" && !z.string().uuid().safeParse(value.value).success) issue("value", "Choose the assignee");
    if (value.field === "priority" && !["low", "normal", "high", "urgent"].includes(value.value)) issue("value", "Choose a priority");
    if (value.field === "due_date" && !day.safeParse(value.value).success) issue("value", "Choose a date");
  }
});
export type ExecutionMutation = z.infer<typeof executionMutationSchema>;
export type ExecutionAction = ExecutionMutation["action"];
/** Actions carried by their own meaning; they have no separate explanation field. */
export const NOTELESS_ACTIONS: readonly ExecutionAction[] = ["message.prepare", "message.mark", "message.cancel", "queue.update"];

const ACTION_VIEW: Record<string, ExecutionView> = { appointment: "appointments", gatepass: "gate_passes", loadplan: "loads", window: "windows", wip: "wip", rule: "rules", availability: "rules", assignment: "assignments",
  route: "routes", message: "messages", queue: "queue" };
export function executionMutationView(action: ExecutionAction): ExecutionView { return ACTION_VIEW[action.split(".")[0]]; }

const STORES = ["owner", "admin", "factory_manager", "production_manager", "inventory_manager", "dispatch_manager"];
const PLANNERS = ["owner", "admin", "factory_manager", "production_manager"];
const ACTION_ROLES = (action: ExecutionAction): readonly string[] => {
  if (action.startsWith("appointment.")) return ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "sales_manager", "sales"];
  if (action === "gatepass.return") return [...STORES, "quality"];
  if (action.startsWith("gatepass.")) return STORES;
  if (action.startsWith("loadplan.")) return ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager"];
  if (action.startsWith("window.") || action === "wip.set_limit" || action === "wip.retire_limit" || action === "rule.set" || action === "rule.retire") return PLANNERS;
  if (action === "wip.release") return [...PLANNERS, "quality"];
  if (["availability.record", "availability.cancel", "assignment.assign", "queue.update"].includes(action)) return supervisors;
  if (["route.define", "route.bind", "route.deviate"].includes(action)) return [...PLANNERS, "sales_manager"];
  if (["route.approve", "route.retire", "route.decide"].includes(action)) return PLANNERS;
  return ["owner", "admin", "factory_manager", "sales_manager", "sales", "accounts", "dispatch_manager", "dispatch"];
};
/** Mirrors private.execution_action_allowed. The server further limits some actions to a second person. */
export function canUseExecutionAction(role: string, action: ExecutionAction) {
  return canReadExecution(role, executionMutationView(action)) && role !== "viewer" && ACTION_ROLES(action).includes(role);
}

export const EXECUTION_LOOKUPS = ["employees", "orders", "dispatches", "dies", "jobs", "machines", "competencies", "families"] as const;
export type ExecutionLookupKind = typeof EXECUTION_LOOKUPS[number];
const page = z.number().int().min(1).max(100000).default(1);
export const executionCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), view: z.enum(viewKeys), page, search: z.string().trim().max(80).default(""), state: z.enum(["active", "all"]).default("active"),
    status: z.string().regex(/^[a-z_]{1,40}$/).optional(), sort: z.enum(["priority", "newest", "due"]).default("priority") }).strict(),
  z.object({ command: z.literal("detail"), view: z.enum(viewKeys), id: uuid, page }).strict(),
  z.object({ command: z.literal("lookup"), kind: z.enum(EXECUTION_LOOKUPS), search: z.string().trim().max(80).default(""), selected_id: uuid.optional(), parent_id: uuid.optional() }).strict(),
  z.object({ command: z.literal("preview"), request_id: uuid, mutation: executionMutationSchema }).strict(),
  z.object({ command: z.literal("commit"), request_id: uuid, fingerprint: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
  z.object({ command: z.literal("outcome"), request_id: uuid }).strict(),
  z.object({ command: z.literal("abandon"), request_id: uuid }).strict()
]);
export type ExecutionCommand = z.input<typeof executionCommandSchema>;

export const executionRowSchema = z.object({
  id: uuid, label: z.string(), status: z.string(), owner: z.string().nullable(), due_date: z.string().nullable(), summary: z.string(), source_href: z.string().nullable(), details: z.record(z.unknown())
}).strict();
export type ExecutionRow = z.infer<typeof executionRowSchema>;
export const executionListSchema = z.object({ rows: z.array(executionRowSchema).max(10), total_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type ExecutionList = z.infer<typeof executionListSchema>;
export const executionDetailSchema = z.object({ row: executionRowSchema, events: z.array(z.object({ id: uuid, action: z.string(), actor: z.string(), note: z.string(), recorded_at: z.string() }).strict()).max(10),
  event_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type ExecutionDetail = z.infer<typeof executionDetailSchema>;
export const executionLookupSchema = z.array(z.object({ value: uuid, label: z.string(), context: z.string() }).strict()).max(20);
export const recordOutcomeSchema = z.object({ id: uuid, label: z.string(), outcome: z.string(), reason: z.string().nullable() }).strict();
export type RecordOutcome = z.infer<typeof recordOutcomeSchema>;
export const executionOutcomeSchema = z.object({
  request_id: uuid, state: z.enum(["prepared", "confirmed", "rejected", "abandoned", "not_recorded"]), fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  expires_at: z.string(), action: z.string(),
  review: z.object({ title: z.string(), effect: z.string(), warnings: z.array(z.string()), facts: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])), records: z.array(recordOutcomeSchema).max(50).optional() }).strict(),
  result: z.object({ label: z.string(), href: z.string().nullable(), message: z.string(), records: z.array(recordOutcomeSchema).max(50).optional() }).strict().nullable()
}).strict();
export type ExecutionOutcome = z.infer<typeof executionOutcomeSchema>;
export type ExecutionResult<T = unknown> = { success: true; data: T } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

export function parseExecutionData(command: string, value: unknown) {
  if (command === "list") return executionListSchema.parse(value);
  if (command === "detail") return executionDetailSchema.parse(value);
  if (command === "lookup") return executionLookupSchema.parse(value);
  return executionOutcomeSchema.parse(value);
}

export const PROGRESS_STATES = ["complete", "current", "blocked", "skipped_by_policy", "unavailable", "upcoming"] as const;
export const orderProgressSchema = z.object({
  order_id: uuid, order_number: z.string(), current_stage: z.string(), cancelled: z.boolean(), route: z.object({ code: z.string(), name: z.string(), version: z.number() }).nullable(),
  stages: z.array(z.object({ stage: z.string(), label: z.string(), state: z.enum(PROGRESS_STATES), reason: z.string().nullable(), applicable: z.boolean(), optional: z.boolean(),
    evidence: z.object({ changed_at: z.string(), by: z.string().nullable() }).nullable(), reopened: z.boolean(), planned_date: z.string().nullable(), quantity: z.record(z.unknown()).nullable(), href: z.string().nullable() }).strict()).length(16),
  blockers: z.array(z.string()), reopened: z.boolean(), errors: z.record(z.unknown()), as_of: z.string()
}).strict();
export type OrderProgress = z.infer<typeof orderProgressSchema>;

export const EXECUTION_STATUS: Record<string, string> = {
  requested: "Requested; the site has not confirmed", changed: "Changed after confirmation; needs reconfirmation", confirmed: "Confirmed by the site", outcome_due: "Slot has passed; record the outcome", arrived: "Vehicle at the site",
  completed: "Completed", unloading_failed: "Unloading failed", missed: "Missed", cancelled: "Cancelled",
  approved: "Approved; has not left", out: "Out with the custodian", overdue: "Overdue", partially_returned: "Partly returned", partially_returned_overdue: "Partly returned and overdue", closed: "Closed",
  planning: "Planning the stops", loading: "Being loaded", ready: "Ready for departure", not_ready: "Not ready; findings open",
  active: "Active", retired: "Retired", applied: "Applied", rejected: "Rejected", stale: "Job changed since the request; reject and request again",
  no_limit: "No limit set", within: "Within the limit", near: "Close to the limit", over: "Over the limit", unmeasured_incomplete: "Some work has no recorded quantity",
  unassigned: "Nobody assigned", assignee_away: "Assignee unavailable today", assignee_ineligible: "Assignee no longer eligible", assigned: "Assigned",
  draft: "Draft; awaiting a second approver", current: "Away today", upcoming: "Upcoming", past: "Past",
  prepared: "Prepared, not sent", copied: "Copied", printed: "Printed", downloaded: "Downloaded", superseded: "Replaced", open: "Open", in_progress: "In progress"
};
export function executionStatusLabel(status: string) { return EXECUTION_STATUS[status] ?? status.replace(/_/g, " "); }
export const PROGRESS_LABELS: Record<(typeof PROGRESS_STATES)[number], string> = { complete: "Complete", current: "Current", blocked: "Blocked", skipped_by_policy: "Skipped by policy", unavailable: "Evidence unavailable", upcoming: "Upcoming" };

/** Converts a datetime-local value to an IST instant for the database. */
export function istInstant(local: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(local.trim());
  return match ? `${match[1]}T${match[2]}:${match[3] ?? "00"}+05:30` : local;
}
export function executionRecoveryKey(companyId: string, userId: string) { return `extrusionos:execution:v1:${companyId}:${userId}`; }
