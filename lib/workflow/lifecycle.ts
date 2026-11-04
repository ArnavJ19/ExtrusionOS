// November batch 6 (NOV-021/027/058/060/063/068/079): order closure, samples, packing templates and
// labels, delivery promises, traceability, bundle transformations and journey reviews. The database
// owns every read model and guarded action; this module validates commands and responses and mirrors
// role access so screens never offer an action the server would refuse.
import { z } from "zod";

export const LIFECYCLE_VIEWS = {
  closure: "Order closure", samples: "Samples and first piece", templates: "Packing templates", labels: "Bundle labels", promises: "Delivery promises",
  trace: "Traceability", bundles: "Bundle split and combine", journeys: "Journey reviews"
} as const;
export type LifecycleView = keyof typeof LIFECYCLE_VIEWS;
export const LIFECYCLE_DESCRIPTIONS: Record<LifecycleView, string> = {
  closure: "Delivered orders with what is still open before closure, who owns it and where to resolve it.",
  samples: "Sample and first-piece approvals by order line, and the production waiting on them.",
  templates: "Approved packing instructions and label fields by customer, project or order.",
  labels: "Packed bundles awaiting a packing check, a label, or a reprint on a newer template.",
  promises: "Delivery dates checked against stock, press capacity and finishing lead time before promising.",
  trace: "Investigations that follow material from billet to customer and back.",
  bundles: "Bundles split or combined, with their source bundles and any weight variance.",
  journeys: "Reviews of how real orders moved from enquiry to payment, with owned improvements."
};
const viewKeys = Object.keys(LIFECYCLE_VIEWS) as [LifecycleView, ...LifecycleView[]];

export const LIFECYCLE_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"] as const;
const labelReaders = ["owner", "admin", "quality", "dispatch_manager", "dispatch", "inventory_manager", "factory_manager", "sales_manager", "viewer"];
const VIEW_ROLES: Record<LifecycleView, readonly string[]> = {
  closure: ["owner", "admin", "sales_manager", "sales", "accounts", "factory_manager", "production_manager", "dispatch_manager", "inventory_manager", "quality", "viewer"],
  samples: ["owner", "admin", "quality", "factory_manager", "production_manager", "production", "sales_manager", "sales", "dispatch_manager", "viewer"],
  templates: labelReaders, labels: labelReaders,
  promises: ["owner", "admin", "sales_manager", "sales", "factory_manager", "production_manager", "viewer"],
  trace: ["owner", "admin", "quality", "factory_manager", "production_manager", "inventory_manager", "dispatch_manager", "viewer"],
  bundles: ["owner", "admin", "inventory_manager", "dispatch_manager", "dispatch", "factory_manager", "quality", "viewer"],
  journeys: ["owner", "admin", "factory_manager", "production_manager", "sales_manager", "quality", "dispatch_manager", "inventory_manager", "accounts", "viewer"]
};

/** Mirrors private.lifecycle_read_allowed. */
export function canReadLifecycle(role: string, view?: LifecycleView) {
  if (!(LIFECYCLE_ROLES as readonly string[]).includes(role)) return false;
  return view ? VIEW_ROLES[view].includes(role) : true;
}

const uuid = z.string().uuid("Choose a record from the search results");
const control = /[\u0000-\u001f\u007f]/;
const note = z.string().trim().min(5, "Explain the action in at least 5 characters").max(500, "Keep the explanation within 500 characters")
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Remove control characters");
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label} needs at least ${min} characters`).max(max, `Keep ${label.toLowerCase()} within ${max} characters`)
  .refine(value => !control.test(value), "Remove control characters");
const evidence = text(5, 500, "Evidence");
const decimals = (places: number) => (value: number) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6;
const kg = z.number().finite().positive("Enter a quantity above zero").max(1000000, "Enter a quantity up to 1,000,000 kg").refine(decimals(3), "Use at most three decimal places for kg");
const whole = (min: number, max: number) => z.number().int("Enter a whole number").min(min).max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
export const BUNDLE_TAG = /^[A-Z0-9][A-Z0-9/_-]{0,39}$/;
const tag = z.string().trim().toUpperCase().regex(BUNDLE_TAG, "Use letters, digits, slash, dash or underscore for the tag");

export const LABEL_FIELDS = {
  bundle_number: "Bundle tag", order_number: "Order number", customer: "Customer", customer_profile_ref: "Customer profile reference", profile_code: "Profile code", finish: "Finish",
  cut_length_mm: "Cut length (mm)", pieces: "Pieces", net_kg: "Net weight (kg)", gross_kg: "Gross weight (kg)", drawing_revision: "Drawing revision", destination: "Destination",
  project: "Project", packed_on: "Packed on"
} as const;
export type LabelField = keyof typeof LABEL_FIELDS;
const labelFieldKeys = Object.keys(LABEL_FIELDS) as [LabelField, ...LabelField[]];
export const SAMPLE_REASONS = { new_die: "New die", new_profile: "New profile", customer_request: "Customer request", process_change: "Process change", requalification: "Requalification" } as const;
export const JOURNEY_KINDS = { active_work: "Active work", waiting: "Waiting", rework: "Rework", approval: "Approval", information_search: "Searching for information", missing_event: "Step not recorded" } as const;
export const TRACE_START_TYPES = { production_job: "Production job", stock_batch: "Stock bundle", dispatch: "Dispatch", packing_item: "Dispatch bundle", prepared_bundle: "Packed bundle",
  billet_batch: "Billet batch", foundry_billet: "Cast billet" } as const;

const tranche = z.object({ date: day, kg }).strict();
const output = z.object({ bundle_number: tag, pieces: whole(1, 1000000), kg }).strict();

export const lifecycleMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("closure.carry"), order_id: uuid, item_key: z.string().regex(/^(return|exception|change):[0-9a-f-]{36}$/, "Choose a carriable item"), note }).strict(),
  z.object({ action: z.literal("closure.close"), order_id: uuid, kind: z.enum(["operational", "final"]), note }).strict(),
  z.object({ action: z.literal("closure.reopen"), order_id: uuid, note }).strict(),
  z.object({ action: z.literal("sample.require"), order_id: uuid, profile_id: uuid, die_id: uuid.optional(), drawing_revision_id: uuid.optional(),
    reason: z.enum(["new_die", "new_profile", "customer_request", "process_change", "requalification"]), quantity_pieces: whole(1, 10000), authority: z.enum(["customer", "internal"]),
    gates_production: z.boolean(), response_days: whole(1, 90), note }).strict(),
  z.object({ action: z.literal("sample.record"), id: uuid, event: z.enum(["produced", "measured", "sent", "lost"]), evidence, job_id: uuid.optional(), sample_tag: text(2, 60, "Sample tag").optional(),
    location: text(2, 120, "Location").optional(), recipient: text(2, 120, "Recipient").optional(), expected_response: day.optional(), note }).strict(),
  z.object({ action: z.literal("sample.decide"), id: uuid, decision: z.enum(["approved", "conditional", "rejected", "clarification"]), evidence,
    customer_contact: text(2, 120, "Customer contact").optional(), limit_kg: kg.optional(), note }).strict(),
  z.object({ action: z.literal("sample.invalidate"), id: uuid, note }).strict(),
  z.object({ action: z.literal("sample.withdraw"), id: uuid, note }).strict(),
  z.object({ action: z.literal("template.create"), scope: z.enum(["company", "customer", "project", "order"]), customer_id: uuid.optional(), project_id: uuid.optional(), order_id: uuid.optional(),
    instructions: text(5, 1000, "Instructions"), max_bundle_kg: kg.optional(), max_pieces: whole(1, 100000).optional(), spacer_required: z.boolean(), wrapping: text(2, 200, "Wrapping").optional(),
    label_fields: z.array(z.enum(labelFieldKeys)).min(1, "Choose at least one label field").max(12).refine(values => new Set(values).size === values.length, "Choose each label field once"), note }).strict(),
  z.object({ action: z.literal("template.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("label.pack"), bundle_id: uuid, spacers_used: z.boolean(), wrapping_done: z.boolean(), deviation: text(5, 500, "Deviation").optional(), note }).strict(),
  z.object({ action: z.literal("label.reprint"), bundle_id: uuid, reason: z.enum(["reprint", "damaged"]), note }).strict(),
  z.object({ action: z.literal("promise.propose"), order_id: uuid, tranches: z.array(tranche).min(1, "Add a delivery part").max(4, "Propose at most four delivery parts"), note }).strict(),
  z.object({ action: z.literal("promise.accept"), id: uuid, note }).strict(),
  z.object({ action: z.literal("promise.withdraw"), id: uuid, note }).strict(),
  z.object({ action: z.literal("trace.open"), node_type: z.enum(Object.keys(TRACE_START_TYPES) as [keyof typeof TRACE_START_TYPES, ...(keyof typeof TRACE_START_TYPES)[]]), node_id: uuid, note }).strict(),
  z.object({ action: z.literal("trace.link"), from_type: z.enum(["billet_batch", "foundry_billet", "production_job"]), from_id: uuid, to_type: z.enum(["production_job", "stock_batch"]), to_id: uuid,
    quantity_kg: kg.optional(), evidence, note }).strict(),
  z.object({ action: z.literal("trace.hold"), id: uuid, stock_batch_id: uuid, note }).strict(),
  z.object({ action: z.literal("trace.close"), id: uuid, note }).strict(),
  z.object({ action: z.literal("bundle.split"), stock_batch_id: uuid, outputs: z.array(output).min(2, "Split into at least two bundles").max(6, "Split into at most six bundles"),
    variance_reason: text(5, 300, "Variance reason").optional(), note }).strict(),
  z.object({ action: z.literal("bundle.merge"), stock_batch_ids: z.array(uuid).min(2, "Combine at least two bundles").max(6, "Combine at most six bundles"), bundle_number: tag, output_kg: kg,
    variance_reason: text(5, 300, "Variance reason").optional(), note }).strict(),
  z.object({ action: z.literal("bundle.reverse"), id: uuid, note }).strict(),
  z.object({ action: z.literal("journey.open"), order_id: uuid, title: text(5, 120, "Title"), participants: text(3, 300, "Participants"), baseline_from: day, baseline_to: day, note }).strict(),
  z.object({ action: z.literal("journey.annotate"), id: uuid, kind: z.enum(["active_work", "waiting", "rework", "approval", "information_search", "missing_event"]), private: z.boolean(),
    minutes: whole(1, 100000).optional(), note }).strict(),
  z.object({ action: z.literal("journey.action"), id: uuid, finding: text(5, 300, "Finding"), owner_id: uuid, due_date: day, note }).strict(),
  z.object({ action: z.literal("journey.progress"), action_id: uuid, status: z.enum(["trial", "done", "dropped"]), note }).strict(),
  z.object({ action: z.literal("journey.measure"), id: uuid, phase: z.enum(["baseline", "trial"]), metric: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, "Name the metric in lower case, such as quote_to_order_days"),
    value: z.number().finite().min(0).max(100000000).refine(decimals(3), "Use at most three decimals"), unit: z.enum(["hours", "days", "count", "percent", "minutes"]), sample_size: whole(1, 100000),
    limitations: text(5, 500, "Limitations"), note }).strict(),
  z.object({ action: z.literal("journey.close"), id: uuid, note }).strict()
]).superRefine((value, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (value.action === "sample.record") {
    const produced = [value.job_id, value.sample_tag, value.location], sent = [value.recipient, value.expected_response];
    if (value.event === "produced" ? !produced.every(Boolean) : produced.some(Boolean)) issue(value.event === "produced" ? "job_id" : "event", value.event === "produced" ? "Record the sample job, tag and location" : "Job, tag and location belong to a produced sample");
    if (value.event === "sent" ? !sent.every(Boolean) : sent.some(Boolean)) issue(value.event === "sent" ? "recipient" : "event", value.event === "sent" ? "Record the recipient and the expected response date" : "Recipient and response date belong to a sent sample");
  }
  if (value.action === "sample.decide" && (value.decision === "conditional") !== (value.limit_kg !== undefined)) issue("limit_kg", "A conditional approval states the kg it covers, and only a conditional approval has a limit");
  if (value.action === "template.create") {
    const target = { customer: value.customer_id, project: value.project_id, order: value.order_id };
    for (const [scope, id] of Object.entries(target)) if ((value.scope === scope) !== Boolean(id)) issue(`${scope}_id`, value.scope === scope ? `Choose the ${scope} this template applies to` : `Only the ${value.scope} record applies to this scope`);
  }
  if (value.action === "promise.propose") {
    for (let index = 1; index < value.tranches.length; index++) if (value.tranches[index].date <= value.tranches[index - 1].date) issue("tranches", "Delivery dates must increase from one part to the next");
  }
  if (value.action === "bundle.split" && new Set(value.outputs.map(entry => entry.bundle_number)).size !== value.outputs.length) issue("outputs", "Each new bundle needs its own tag");
  if (value.action === "bundle.merge" && new Set(value.stock_batch_ids).size !== value.stock_batch_ids.length) issue("stock_batch_ids", "A bundle was scanned twice");
  if (value.action === "journey.open" && value.baseline_to < value.baseline_from) issue("baseline_to", "The baseline period must end after it starts");
  if (value.action === "trace.link" && !((value.to_type === "production_job" && value.from_type !== "production_job") || (value.to_type === "stock_batch" && value.from_type === "production_job"))) issue("to_type", "Map a billet to a job, or a job to stock");
});
export type LifecycleMutation = z.infer<typeof lifecycleMutationSchema>;
export type LifecycleAction = LifecycleMutation["action"];

export function lifecycleMutationView(action: LifecycleAction): LifecycleView {
  const views: Record<string, LifecycleView> = { closure: "closure", sample: "samples", template: "templates", label: "labels", promise: "promises", trace: "trace", bundle: "bundles", journey: "journeys" };
  return views[action.split(".")[0]];
}

const journeyLeads = ["owner", "admin", "factory_manager", "production_manager", "sales_manager", "quality"];
const journeyAll = [...journeyLeads, "dispatch_manager", "inventory_manager", "accounts"];
const ACTION_ROLES: Record<LifecycleAction, readonly string[]> = {
  "closure.carry": ["owner", "admin", "sales_manager", "accounts"], "closure.close": ["owner", "admin", "sales_manager", "factory_manager", "accounts"], "closure.reopen": ["owner", "admin"],
  "sample.require": ["owner", "admin", "quality", "sales_manager", "factory_manager"], "sample.record": ["owner", "admin", "quality", "factory_manager", "production_manager", "dispatch_manager"],
  "sample.decide": ["owner", "admin", "quality", "sales_manager", "sales", "factory_manager"], "sample.invalidate": ["owner", "admin", "quality", "factory_manager"], "sample.withdraw": ["owner", "admin", "quality"],
  "template.create": ["owner", "admin", "quality", "dispatch_manager"], "template.approve": ["owner", "admin", "quality", "dispatch_manager"],
  "label.pack": ["owner", "admin", "dispatch_manager", "dispatch", "inventory_manager"], "label.reprint": ["owner", "admin", "dispatch_manager", "dispatch", "inventory_manager", "quality"],
  "promise.propose": ["owner", "admin", "sales_manager", "sales", "factory_manager", "production_manager"], "promise.accept": ["owner", "admin", "sales_manager"], "promise.withdraw": ["owner", "admin", "sales_manager", "sales"],
  "trace.open": ["owner", "admin", "quality", "factory_manager"], "trace.close": ["owner", "admin", "quality", "factory_manager"], "trace.link": ["owner", "admin", "quality", "inventory_manager", "factory_manager"],
  "trace.hold": ["owner", "admin", "quality"],
  "bundle.split": ["owner", "admin", "inventory_manager", "dispatch_manager"], "bundle.merge": ["owner", "admin", "inventory_manager", "dispatch_manager"], "bundle.reverse": ["owner", "admin", "inventory_manager"],
  "journey.open": journeyLeads, "journey.action": journeyLeads, "journey.close": journeyLeads, "journey.annotate": journeyAll, "journey.progress": journeyAll,
  "journey.measure": ["owner", "admin", "factory_manager", "production_manager", "quality"]
};
/** Mirrors private.lifecycle_action_allowed. Some actions are further limited on the server (closure kind, internal sample decisions, deviations, action owners). */
export function canUseLifecycleAction(role: string, action: LifecycleAction) {
  return canReadLifecycle(role, lifecycleMutationView(action)) && role !== "viewer" && ACTION_ROLES[action].includes(role);
}

export const LIFECYCLE_LOOKUPS = ["orders", "profiles", "dies", "drawing_revisions", "jobs", "customers", "projects", "stock", "trace_nodes", "employees"] as const;
export type LifecycleLookupKind = typeof LIFECYCLE_LOOKUPS[number];
const page = z.number().int().min(1).max(100000).default(1);
export const lifecycleCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), view: z.enum(viewKeys), page, search: z.string().trim().max(80).default(""), state: z.enum(["active", "all"]).default("active"),
    status: z.string().regex(/^[a-z_]{1,40}$/).optional(), sort: z.enum(["priority", "newest", "due"]).default("priority") }).strict(),
  z.object({ command: z.literal("detail"), view: z.enum(viewKeys), id: uuid, page }).strict(),
  z.object({ command: z.literal("lookup"), kind: z.enum(LIFECYCLE_LOOKUPS), search: z.string().trim().max(80).default(""), selected_id: uuid.optional(), context_id: uuid.optional(),
    filter: z.string().regex(/^[a-z_]{1,40}$/).optional() }).strict(),
  z.object({ command: z.literal("preview"), request_id: uuid, mutation: lifecycleMutationSchema }).strict(),
  z.object({ command: z.literal("commit"), request_id: uuid, fingerprint: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
  z.object({ command: z.literal("outcome"), request_id: uuid }).strict(),
  z.object({ command: z.literal("abandon"), request_id: uuid }).strict()
]);
export type LifecycleCommand = z.input<typeof lifecycleCommandSchema>;

export const lifecycleRowSchema = z.object({
  id: uuid, label: z.string(), status: z.string(), owner: z.string().nullable(), due_date: z.string().nullable(),
  summary: z.string(), source_href: z.string().nullable(), details: z.record(z.unknown())
}).strict();
export type LifecycleRow = z.infer<typeof lifecycleRowSchema>;
export const lifecycleListSchema = z.object({ rows: z.array(lifecycleRowSchema).max(10), total_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type LifecycleList = z.infer<typeof lifecycleListSchema>;
export const lifecycleDetailSchema = z.object({ row: lifecycleRowSchema, events: z.array(z.object({ id: uuid, action: z.string(), actor: z.string(), note: z.string(), recorded_at: z.string() }).strict()).max(10),
  event_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type LifecycleDetail = z.infer<typeof lifecycleDetailSchema>;
export const lifecycleLookupSchema = z.array(z.object({ value: uuid, label: z.string(), context: z.string() }).strict()).max(20);
export const lifecycleOutcomeSchema = z.object({
  request_id: uuid, state: z.enum(["prepared", "confirmed", "rejected", "abandoned", "not_recorded"]), fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  expires_at: z.string(), action: z.string(), review: z.object({ title: z.string(), effect: z.string(), warnings: z.array(z.string()), facts: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])) }).strict(),
  result: z.object({ label: z.string(), href: z.string().nullable(), message: z.string() }).strict().nullable()
}).strict();
export type LifecycleOutcome = z.infer<typeof lifecycleOutcomeSchema>;
export type LifecycleResult<T = unknown> = { success: true; data: T } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

export function parseLifecycleData(command: string, value: unknown) {
  if (command === "list") return lifecycleListSchema.parse(value);
  if (command === "detail") return lifecycleDetailSchema.parse(value);
  if (command === "lookup") return lifecycleLookupSchema.parse(value);
  return lifecycleOutcomeSchema.parse(value);
}

export const LIFECYCLE_STATUS: Record<string, string> = {
  blocked: "Open items before closure", ready: "Ready to close", closed_operational: "Closed operationally", closed_final: "Closed after final review",
  required: "Sample not produced", produced: "Sample produced", measured: "Sample measured", sent: "Awaiting decision", response_overdue: "Decision overdue", approved: "Approved",
  conditional: "Conditionally approved", rejected: "Rejected", clarification: "Clarification requested", lost: "Sample lost", renewal_needed: "Approval needs renewal", withdrawn: "Withdrawn",
  draft: "Draft; awaiting approval", superseded: "Superseded",
  no_template: "No packing template", fields_missing: "Label facts missing", label_overflow: "Label value too long", to_label: "Packing check pending", labelled: "Labelled", relabel_needed: "Reprint on current template",
  proposed: "Proposed", expired: "Proposal expired", accepted: "Promise accepted", promise_at_risk: "Accepted promise at risk",
  open: "Investigation open", closed: "Closed", completed: "Completed", reversed: "Reversed",
  scoping: "No observations yet", reviewing: "Under review", actions_open: "Improvement actions open", awaiting_trial_measure: "Trial measure needed"
};
export function lifecycleStatusLabel(status: string) { return LIFECYCLE_STATUS[status] ?? status.replace(/_/g, " "); }
export const PROMISE_VERDICTS: Record<string, string> = { feasible: "Feasible on current capacity", at_risk: "Feasible, material not confirmed", infeasible: "Not feasible by these dates", incomplete: "Cannot be checked yet" };

export function lifecycleRecoveryKey(companyId: string, userId: string) { return `extrusionos:lifecycle:v1:${companyId}:${userId}`; }
