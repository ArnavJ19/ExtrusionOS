// November batch 7 (NOV-025/053/054/059): die operating history and service thresholds, recurring
// problems with an improvement owner, team outcome measures and the employee improvement channel.
// The database owns every read model and guarded action; this module validates commands and
// responses and mirrors role access so screens never offer an action the server would refuse.
import { z } from "zod";

export const IMPROVEMENT_VIEWS = {
  problems: "Recurring problems", suggestions: "Improvement suggestions", outcomes: "Team outcomes", dies: "Die operating history", thresholds: "Die service thresholds"
} as const;
export type ImprovementView = keyof typeof IMPROVEMENT_VIEWS;
export const IMPROVEMENT_DESCRIPTIONS: Record<ImprovementView, string> = {
  problems: "Repeated issues grouped with their occurrences, an accountable owner, a trial and an effectiveness review.",
  suggestions: "Friction reported by employees from the screen where it happened, and what became of it.",
  outcomes: "Team figures with numerator, denominator, sample size and missing evidence, compared with the previous 30 days.",
  dies: "Recorded runs, corrections, inspections, moves and service of each die, with reviewed service warnings.",
  thresholds: "Reviewed service counts that warn planners when a die needs nitriding or correction."
};
const viewKeys = Object.keys(IMPROVEMENT_VIEWS) as [ImprovementView, ...ImprovementView[]];

export const IMPROVEMENT_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"] as const;
const leads = ["owner", "admin", "factory_manager", "production_manager", "quality", "dispatch_manager", "inventory_manager", "sales_manager"];
const VIEW_ROLES: Record<ImprovementView, readonly string[]> = {
  problems: [...leads, "accounts", "viewer"], outcomes: [...leads, "accounts", "viewer"], suggestions: IMPROVEMENT_ROLES,
  dies: ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "viewer"], thresholds: ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "viewer"]
};

/** Mirrors private.improvement_read_allowed. */
export function canReadImprovement(role: string, view?: ImprovementView) {
  if (!(IMPROVEMENT_ROLES as readonly string[]).includes(role)) return false;
  return view ? VIEW_ROLES[view].includes(role) : true;
}

const uuid = z.string().uuid("Choose a record from the search results");
const control = /[\u0000-\u001f\u007f]/;
const note = z.string().trim().min(5, "Explain the action in at least 5 characters").max(500, "Keep the explanation within 500 characters")
  .refine(value => !control.test(value), "Remove control characters");
// The database refuses control characters, including line breaks; forms join lines before sending.
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label} needs at least ${min} characters`).max(max, `Keep ${label.toLowerCase()} within ${max} characters`)
  .refine(value => !control.test(value), "Remove control characters");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const PROBLEM_CATEGORIES = { packing: "Packing", dimensional: "Dimensions", surface: "Surface or finish", dispatch: "Dispatch", documentation: "Documents", process: "Process or instruction", equipment: "Equipment", material: "Material", other: "Other" } as const;
export const OCCURRENCE_TYPES = { quality_inspection: "Rejected or rework inspection", production_exception: "Production exception", task_exception: "Task exception", delivery_disposition: "Refused, damaged or short delivery",
  return_authorization: "Return authorization", support_ticket: "Customer ticket", procedure_step_flag: "Flagged procedure step" } as const;
export const DENOMINATORS = { dispatches: "Dispatches", production_jobs: "Completed production jobs", inspections: "Inspections", tasks: "Completed tasks" } as const;
export const SUGGESTION_CATEGORIES = { unnecessary_entry: "Unnecessary entry", confusing_instruction: "Confusing instruction", repeated_lookup: "Repeated lookup", avoidable_waiting: "Avoidable waiting", other: "Other" } as const;
export const SUGGESTION_RESPONSES = { acknowledged: "Acknowledged", clarification: "Ask for clarification", trial: "Trial the change", adopted: "Adopted", declined: "Declined with reason", resolved: "Resolved" } as const;
export const DIE_TYPES = { solid: "Solid", hollow: "Hollow", semi_hollow: "Semi-hollow", porthole: "Porthole", bridge: "Bridge", feeder: "Feeder", multi_cavity: "Multi-cavity", flat: "Flat", special: "Special" } as const;
export const THRESHOLD_BASES = { kg_since_service: "Kg since service", runs_since_service: "Runs since service", days_since_service: "Days since service" } as const;
export const SERVICE_EVENTS = { nitriding: "Nitriding", correction: "Correction", any: "Nitriding or correction" } as const;
const keysOf = <T extends Record<string, string>>(value: T) => Object.keys(value) as [keyof T & string, ...(keyof T & string)[]];

/** A screen reference is the page path only; query strings may hold draft values and are never sent. */
export const SOURCE_PATH = /^\/[A-Za-z0-9/_.-]{0,200}$/;
export function suggestionSourcePath(pathname: string) {
  const path = (pathname || "/").split(/[?#]/)[0].replace(/\/+/g, "/").slice(0, 200);
  return SOURCE_PATH.test(path) && !path.includes("..") ? path : "/";
}

export const improvementMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("problem.open"), title: text(5, 120, "Title"), category: z.enum(keysOf(PROBLEM_CATEGORIES)), description: text(5, 1000, "Description"), owner_id: uuid,
    containment: text(5, 500, "Containment").optional(), note }).strict(),
  z.object({ action: z.literal("problem.link"), id: uuid, source_type: z.enum(keysOf(OCCURRENCE_TYPES)), source_id: uuid, note }).strict(),
  z.object({ action: z.literal("problem.unlink"), id: uuid, link_id: uuid, note }).strict(),
  z.object({ action: z.literal("problem.investigate"), id: uuid, cause: text(5, 800, "Cause"), cause_basis: z.enum(["observation", "established"]), cause_evidence: text(5, 500, "Evidence").optional(), note }).strict(),
  z.object({ action: z.literal("problem.plan"), id: uuid, proposed_action: text(5, 800, "Proposed change"), trial_scope: text(5, 300, "Trial scope"), review_date: day,
    denominator: z.enum(keysOf(DENOMINATORS)), procedure_improvement_id: uuid.optional(), note }).strict(),
  z.object({ action: z.literal("problem.trial"), id: uuid, note }).strict(),
  z.object({ action: z.literal("problem.cancel_trial"), id: uuid, note }).strict(),
  z.object({ action: z.literal("problem.review"), id: uuid, decision: z.enum(["effective", "not_effective"]), evidence: text(5, 500, "Evidence"), note }).strict(),
  z.object({ action: z.literal("problem.reopen"), id: uuid, note }).strict(),
  z.object({ action: z.literal("problem.reassign"), id: uuid, owner_id: uuid, note }).strict(),
  z.object({ action: z.literal("suggestion.submit"), category: z.enum(keysOf(SUGGESTION_CATEGORIES)), source_path: z.string().regex(SOURCE_PATH, "The screen reference is not a page of this application")
    .refine(value => !value.includes("..") && !value.includes("//"), "The screen reference is not a page of this application"), description: text(10, 1000, "Description"), evidence: text(5, 500, "Supporting reference").optional() }).strict(),
  z.object({ action: z.literal("suggestion.respond"), id: uuid, status: z.enum(keysOf(SUGGESTION_RESPONSES)), response: text(5, 800, "Response"), decline_reason: text(5, 500, "Decline reason").optional(),
    internal_note: text(5, 800, "Internal note").optional() }).strict(),
  z.object({ action: z.literal("suggestion.clarify"), id: uuid, clarification: text(5, 800, "Clarification") }).strict(),
  z.object({ action: z.literal("suggestion.merge"), id: uuid, into_id: uuid, note }).strict(),
  z.object({ action: z.literal("suggestion.link"), id: uuid, problem_id: uuid.optional(), procedure_improvement_id: uuid.optional(), note }).strict(),
  z.object({ action: z.literal("suggestion.reassign"), id: uuid, owner_id: uuid, note }).strict(),
  z.object({ action: z.literal("route.set"), category: z.enum(keysOf(SUGGESTION_CATEGORIES)), owner_id: uuid, note }).strict(),
  z.object({ action: z.literal("threshold.propose"), die_type: z.enum(keysOf(DIE_TYPES)).optional(), basis: z.enum(keysOf(THRESHOLD_BASES)), service_event: z.enum(keysOf(SERVICE_EVENTS)),
    warn_at: z.number().finite().min(1, "Warn at 1 or more").max(100000000), rationale: text(5, 500, "Rationale"), note }).strict(),
  z.object({ action: z.literal("threshold.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("threshold.retire"), id: uuid, note }).strict()
]).superRefine((value, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (value.action === "problem.investigate" && value.cause_basis === "established" && !value.cause_evidence) issue("cause_evidence", "An established cause needs its investigation evidence");
  if (value.action === "suggestion.respond" && (value.status === "declined") !== Boolean(value.decline_reason)) issue("decline_reason", value.status === "declined" ? "State why the suggestion is declined" : "Only a declined suggestion has a decline reason");
  if (value.action === "suggestion.link" && !value.problem_id && !value.procedure_improvement_id) issue("problem_id", "Choose a problem or a procedure change to link");
  if (value.action === "suggestion.merge" && value.into_id === value.id) issue("into_id", "Choose another suggestion to merge into");
  if (value.action === "threshold.propose") {
    if (value.basis === "kg_since_service" ? Math.abs(value.warn_at * 1000 - Math.round(value.warn_at * 1000)) > 1e-6 : !Number.isInteger(value.warn_at)) issue("warn_at", value.basis === "kg_since_service" ? "Use at most three decimals for kg" : "Enter a whole number");
    if (value.basis !== "kg_since_service" && value.warn_at > 100000) issue("warn_at", "Enter at most 100,000");
  }
});
export type ImprovementMutation = z.infer<typeof improvementMutationSchema>;
export type ImprovementAction = ImprovementMutation["action"];
/** Actions carried by the employee's own words; they have no separate explanation field. */
export const NOTELESS_ACTIONS: readonly ImprovementAction[] = ["suggestion.submit", "suggestion.respond", "suggestion.clarify"];

export function improvementMutationView(action: ImprovementAction): ImprovementView {
  const prefix = action.split(".")[0];
  return prefix === "problem" ? "problems" : prefix === "threshold" ? "thresholds" : "suggestions";
}

const ACTION_ROLES: Record<ImprovementAction, readonly string[]> = {
  "problem.open": leads, "problem.link": leads, "problem.unlink": leads, "problem.investigate": leads, "problem.plan": leads, "problem.trial": leads, "problem.cancel_trial": leads, "problem.review": leads,
  "problem.reopen": ["owner", "admin", "factory_manager", "quality"], "problem.reassign": ["owner", "admin", "factory_manager", "quality"],
  "suggestion.submit": IMPROVEMENT_ROLES, "suggestion.clarify": IMPROVEMENT_ROLES,
  "suggestion.respond": [...leads, "accounts"], "suggestion.merge": [...leads, "accounts"], "suggestion.link": [...leads, "accounts"], "suggestion.reassign": [...leads, "accounts"],
  "route.set": ["owner", "admin"],
  "threshold.propose": ["owner", "admin", "factory_manager", "production_manager", "quality"], "threshold.approve": ["owner", "admin", "factory_manager", "production_manager", "quality"],
  "threshold.retire": ["owner", "admin", "factory_manager", "quality"]
};
/** Mirrors private.improvement_action_allowed. The server further limits some actions to the record owner, contributor or a second person. */
export function canUseImprovementAction(role: string, action: ImprovementAction) {
  return canReadImprovement(role, improvementMutationView(action)) && role !== "viewer" && ACTION_ROLES[action].includes(role);
}

export const IMPROVEMENT_LOOKUPS = ["employees", "managers", "incidents", "problems", "suggestions", "procedure_improvements", "dies"] as const;
export type ImprovementLookupKind = typeof IMPROVEMENT_LOOKUPS[number];
const page = z.number().int().min(1).max(100000).default(1);
export const improvementCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), view: z.enum(viewKeys), page, search: z.string().trim().max(80).default(""), state: z.enum(["active", "all"]).default("active"),
    status: z.string().regex(/^[a-z_]{1,40}$/).optional(), sort: z.enum(["priority", "newest", "due"]).default("priority") }).strict(),
  z.object({ command: z.literal("detail"), view: z.enum(viewKeys), id: uuid, page }).strict(),
  z.object({ command: z.literal("lookup"), kind: z.enum(IMPROVEMENT_LOOKUPS), search: z.string().trim().max(80).default(""), selected_id: uuid.optional(), filter: z.string().regex(/^[a-z_]{1,40}$/).optional() }).strict(),
  z.object({ command: z.literal("preview"), request_id: uuid, mutation: improvementMutationSchema }).strict(),
  z.object({ command: z.literal("commit"), request_id: uuid, fingerprint: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
  z.object({ command: z.literal("outcome"), request_id: uuid }).strict(),
  z.object({ command: z.literal("abandon"), request_id: uuid }).strict()
]);
export type ImprovementCommand = z.input<typeof improvementCommandSchema>;

export const improvementRowSchema = z.object({
  id: uuid, label: z.string(), status: z.string(), owner: z.string().nullable(), due_date: z.string().nullable(),
  summary: z.string(), source_href: z.string().nullable(), details: z.record(z.unknown())
}).strict();
export type ImprovementRow = z.infer<typeof improvementRowSchema>;
export const improvementListSchema = z.object({ rows: z.array(improvementRowSchema).max(10), total_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type ImprovementList = z.infer<typeof improvementListSchema>;
export const improvementDetailSchema = z.object({ row: improvementRowSchema, events: z.array(z.object({ id: uuid, action: z.string(), actor: z.string(), note: z.string(), recorded_at: z.string() }).strict()).max(10),
  event_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type ImprovementDetail = z.infer<typeof improvementDetailSchema>;
export const improvementLookupSchema = z.array(z.object({ value: uuid, label: z.string(), context: z.string() }).strict()).max(20);
export const improvementOutcomeSchema = z.object({
  request_id: uuid, state: z.enum(["prepared", "confirmed", "rejected", "abandoned", "not_recorded"]), fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  expires_at: z.string(), action: z.string(), review: z.object({ title: z.string(), effect: z.string(), warnings: z.array(z.string()), facts: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])) }).strict(),
  result: z.object({ label: z.string(), href: z.string().nullable(), message: z.string() }).strict().nullable()
}).strict();
export type ImprovementOutcome = z.infer<typeof improvementOutcomeSchema>;
export type ImprovementResult<T = unknown> = { success: true; data: T } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

export function parseImprovementData(command: string, value: unknown) {
  if (command === "list") return improvementListSchema.parse(value);
  if (command === "detail") return improvementDetailSchema.parse(value);
  if (command === "lookup") return improvementLookupSchema.parse(value);
  return improvementOutcomeSchema.parse(value);
}

export const IMPROVEMENT_STATUS: Record<string, string> = {
  open: "Open; occurrences being gathered", investigating: "Cause being investigated", planned: "Improvement planned", trial: "Trial running", review_due: "Effectiveness review due", closed: "Closed after review",
  submitted: "Waiting for the process owner", acknowledged: "Acknowledged", clarification: "Clarification requested", adopted: "Adopted", declined: "Declined", resolved: "Resolved", merged: "Merged with a similar suggestion",
  improved: "Improved", worsened: "Worsened", steady: "Steady", no_data: "No records in the period", small_sample: "Too few records to compare", no_comparison: "No earlier period to compare", current_only: "Current position",
  service_due: "Service check due", history_incomplete: "History incomplete", unavailable: "Not usable for production", in_service: "In service",
  proposed: "Proposed; awaiting a second approver", approved: "Approved", retired: "Retired"
};
export function improvementStatusLabel(status: string) { return IMPROVEMENT_STATUS[status] ?? status.replace(/_/g, " "); }

export function improvementRecoveryKey(companyId: string, userId: string) { return `extrusionos:improvement:v1:${companyId}:${userId}`; }
