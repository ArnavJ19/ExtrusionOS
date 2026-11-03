// November batch 4 (NOV-005/007/015/022/028/031/042/051/057): cross-module controls. The database
// owns every read model and guarded action; this module validates commands and responses and
// mirrors role access so screens never offer an action the server would refuse.
import { z } from "zod";

export const CONTROL_VIEWS = {
  ledger: "Order fulfilment", inheritance: "Inherited job facts", handoffs: "Handoff source reviews", procurement: "Billet purchasing plan",
  wip: "Work in progress", custody: "Finishing vendor custody", authority: "Decision authority", contracts: "Definition of done", rollouts: "Instruction rollouts"
} as const;
export type ControlView = keyof typeof CONTROL_VIEWS;
export const CONTROL_DESCRIPTIONS: Record<ControlView, string> = {
  ledger: "What each order line has produced, held, packed, shipped, delivered and had returned.",
  inheritance: "Production jobs whose technical or packing facts differ from their current order line.",
  handoffs: "Handoffs whose source was corrected or withdrawn after the receiving team accepted the work.",
  procurement: "Billet shortages netted against free stock and confirmed purchase supply, ready for purchasing review.",
  wip: "Unfinished material by physical stage, time in stage and last observed location.",
  custody: "Material with finishing vendors, what came back and what is still unaccounted for.",
  authority: "Who may approve each exception and up to what limit.",
  contracts: "Published definitions of done that new tasks are bound to.",
  rollouts: "Released instruction changes and who has acknowledged them."
};
const viewKeys = Object.keys(CONTROL_VIEWS) as [ControlView, ...ControlView[]];

export const CONTROL_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"] as const;
const VIEW_ROLES: Partial<Record<ControlView, readonly string[]>> = {
  inheritance: ["owner", "admin", "factory_manager", "production_manager", "production", "sales_manager", "quality", "viewer"],
  handoffs: ["owner", "admin", "factory_manager", "production_manager", "production", "dispatch_manager", "dispatch", "quality", "viewer"],
  procurement: ["owner", "admin", "factory_manager", "production_manager", "inventory_manager", "accounts", "viewer"],
  custody: ["owner", "admin", "factory_manager", "production_manager", "production", "inventory_manager", "accounts", "quality", "viewer"]
};

/** Mirrors private.control_read_allowed. */
export function canReadControl(role: string, view?: ControlView) {
  if (!(CONTROL_ROLES as readonly string[]).includes(role)) return false;
  const roles = view ? VIEW_ROLES[view] : undefined;
  return roles ? roles.includes(role) : true;
}

const uuid = z.string().uuid("Choose a record from the search results");
const note = z.string().trim().min(5, "Explain the action in at least 5 characters").max(500, "Keep the explanation within 500 characters")
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Remove control characters");
const decimals = (places: number) => (value: number) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6;
const kg = z.number().finite().positive("Enter a quantity above zero").max(1000000, "Enter a quantity up to 1,000,000 kg").refine(decimals(3), "Use at most three decimal places for kg");
const nonNegativeKg = z.number().finite().nonnegative("Enter zero or more").max(10000000).refine(decimals(3), "Use at most three decimal places for kg");
const alloy = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, "Enter the alloy as recorded on billets, such as 6063");
const diameter = z.number().finite().min(0.5, "Billet diameter is between 0.5 and 30 inches").max(30, "Billet diameter is between 0.5 and 30 inches").refine(decimals(3), "Use at most three decimal places for inches");
export const TASK_KIND_PATTERN = /^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$/;
export const AUTHORITY_ROLES = { overdue_dispatch: ["admin", "accounts", "sales_manager"], low_margin_quote: ["admin", "sales_manager"] } as const;
export const CUSTODY_CATEGORIES = { returned_unprocessed: "Returned unprocessed", process_loss: "Agreed process loss", lost_claimed: "Lost; claim with vendor" } as const;

const limits = z.record(z.number().finite().nonnegative("Limits cannot be negative").max(1e12).refine(decimals(2), "Use at most two decimals for a limit"));
export const controlMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("facts.refresh"), job_id: uuid, note }).strict(),
  z.object({ action: z.literal("facts.keep"), job_id: uuid, note }).strict(),
  z.object({ action: z.literal("handoff.resolve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("policy.set"), alloy, diameter_inch: diameter, lead_days: z.number().int().min(0).max(365), min_order_kg: nonNegativeKg, pack_kg: kg.optional(), safety_stock_kg: nonNegativeKg, note }).strict(),
  z.object({ action: z.literal("supply.link"), po_line_id: uuid, alloy, diameter_inch: diameter, note }).strict(),
  z.object({ action: z.literal("plan.generate"), note }).strict(),
  z.object({ action: z.literal("plan.review"), id: uuid, decision: z.enum(["accepted", "dismissed"]), note }).strict(),
  z.object({ action: z.literal("wip.observe"), job_id: uuid, location_id: uuid, quantity_kg: kg.optional(), note }).strict(),
  z.object({ action: z.literal("custody.explain"), job_id: uuid, category: z.enum(["returned_unprocessed", "process_loss", "lost_claimed"]), quantity_kg: kg,
    evidence: z.string().trim().min(5, "Describe the evidence in 5 to 500 characters").max(500), note }).strict(),
  z.object({ action: z.literal("custody.reverse"), id: uuid, note }).strict(),
  z.object({ action: z.literal("authority.publish"), decision_type: z.enum(["overdue_dispatch", "low_margin_quote"]), limits, effective_from: z.string().datetime({ offset: true }), note }).strict(),
  z.object({ action: z.literal("contract.publish"), task_kind: z.string().regex(TASK_KIND_PATTERN, "Choose the kind of task"), exclusive_source: z.boolean(), note }).strict(),
  z.object({ action: z.literal("rollout.classify"), version_id: uuid, change_class: z.enum(["informational", "acknowledgement_required"]), note }).strict(),
  z.object({ action: z.literal("rollout.acknowledge"), version_id: uuid, note }).strict()
]).superRefine((value, ctx) => {
  if (value.action !== "authority.publish") return;
  const allowed = AUTHORITY_ROLES[value.decision_type] as readonly string[];
  for (const role of Object.keys(value.limits)) if (!allowed.includes(role)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limits", role], message: `${role.replace(/_/g, " ")} cannot carry an approval limit for this decision. Owners are never limited.` });
});
export type ControlMutation = z.infer<typeof controlMutationSchema>;
export type ControlAction = ControlMutation["action"];

export function controlMutationView(action: ControlAction): ControlView {
  const views: Record<string, ControlView> = { facts: "inheritance", handoff: "handoffs", policy: "procurement", supply: "procurement", plan: "procurement",
    wip: "wip", custody: "custody", authority: "authority", contract: "contracts", rollout: "rollouts" };
  return views[action.split(".")[0]];
}

const ACTION_ROLES: Record<ControlAction, readonly string[]> = {
  "facts.refresh": ["owner", "admin", "factory_manager", "production_manager"], "facts.keep": ["owner", "admin", "factory_manager", "production_manager"],
  "handoff.resolve": ["owner", "admin", "factory_manager", "production_manager", "production", "dispatch_manager", "dispatch", "quality"],
  "policy.set": ["owner", "admin", "inventory_manager"], "plan.review": ["owner", "admin", "inventory_manager"],
  "supply.link": ["owner", "admin", "inventory_manager", "factory_manager"], "plan.generate": ["owner", "admin", "inventory_manager", "factory_manager"],
  "wip.observe": ["owner", "admin", "factory_manager", "production_manager", "production", "inventory_manager", "dispatch_manager", "dispatch", "quality"],
  "custody.explain": ["owner", "admin", "factory_manager", "production_manager", "inventory_manager"], "custody.reverse": ["owner", "admin", "factory_manager", "production_manager", "inventory_manager"],
  "authority.publish": ["owner", "admin"], "contract.publish": ["owner", "admin", "factory_manager"], "rollout.classify": ["owner", "admin", "factory_manager"],
  "rollout.acknowledge": CONTROL_ROLES.filter(role => role !== "viewer")
};
/** Mirrors private.control_action_allowed. Handoff resolution is further limited to the receiving team on the server. */
export function canUseControlAction(role: string, action: ControlAction) {
  return canReadControl(role, controlMutationView(action)) && role !== "viewer" && ACTION_ROLES[action].includes(role);
}

const page = z.number().int().min(1).max(100000).default(1);
export const controlCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), view: z.enum(viewKeys), page, search: z.string().trim().max(80).default(""), state: z.enum(["active", "all"]).default("active"),
    status: z.string().regex(/^[a-z_]{1,40}$/).optional(), sort: z.enum(["priority", "newest", "due"]).default("priority") }).strict(),
  z.object({ command: z.literal("detail"), view: z.enum(viewKeys), id: uuid, page }).strict(),
  z.object({ command: z.literal("lookup"), kind: z.enum(["locations", "po_lines", "task_kinds"]), search: z.string().trim().max(80).default(""), selected_id: uuid.optional() }).strict(),
  z.object({ command: z.literal("preview"), request_id: uuid, mutation: controlMutationSchema }).strict(),
  z.object({ command: z.literal("commit"), request_id: uuid, fingerprint: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
  z.object({ command: z.literal("outcome"), request_id: uuid }).strict(),
  z.object({ command: z.literal("abandon"), request_id: uuid }).strict()
]);
export type ControlCommand = z.input<typeof controlCommandSchema>;

export const controlRowSchema = z.object({
  id: uuid, label: z.string(), status: z.string(), owner: z.string().nullable(), due_date: z.string().nullable(),
  summary: z.string(), source_href: z.string().nullable(), details: z.record(z.unknown())
}).strict();
export type ControlRow = z.infer<typeof controlRowSchema>;
export const controlListSchema = z.object({ rows: z.array(controlRowSchema).max(10), total_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type ControlList = z.infer<typeof controlListSchema>;
export const controlDetailSchema = z.object({ row: controlRowSchema, events: z.array(z.object({ id: uuid, action: z.string(), actor: z.string(), note: z.string(), recorded_at: z.string() }).strict()).max(10),
  event_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type ControlDetail = z.infer<typeof controlDetailSchema>;
export const controlLookupSchema = z.array(z.object({ value: uuid, label: z.string(), context: z.string() }).strict()).max(20);
export const controlOutcomeSchema = z.object({
  request_id: uuid, state: z.enum(["prepared", "confirmed", "rejected", "abandoned", "not_recorded"]), fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  expires_at: z.string(), action: z.string(), review: z.object({ title: z.string(), effect: z.string(), warnings: z.array(z.string()), facts: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])) }).strict(),
  result: z.object({ label: z.string(), href: z.string().nullable(), message: z.string() }).strict().nullable()
}).strict();
export type ControlOutcome = z.infer<typeof controlOutcomeSchema>;
export type ControlResult<T = unknown> = { success: true; data: T } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

export function parseControlData(command: string, value: unknown) {
  if (command === "list") return controlListSchema.parse(value);
  if (command === "detail") return controlDetailSchema.parse(value);
  if (command === "lookup") return controlLookupSchema.parse(value);
  return controlOutcomeSchema.parse(value);
}

// NOV-005: the order page's ledger. Null quantities mean the source was unavailable or unknown, never zero.
const qty = z.union([z.number(), z.string()]).nullable().transform(value => (value === null ? null : Number(value))).refine(value => value === null || Number.isFinite(value));
export const LEDGER_STATUS = {
  source_unavailable: "A source could not be read", quantity_unknown: "Ordered quantity unknown", on_hold: "Material on hold", delivered: "Delivered",
  departed: "Departed; delivery not confirmed", part_departed: "Partly departed", packed: "Packed, not departed", in_production: "In production or covered from stock",
  awaiting_production: "Awaiting production"
} as const;
export const ledgerSchema = z.object({
  order_id: uuid, as_of: z.string(), status: z.enum(Object.keys(LEDGER_STATUS) as [keyof typeof LEDGER_STATUS, ...(keyof typeof LEDGER_STATUS)[]]),
  line_count: z.number().int().nonnegative(), basis: z.string(), ordered_kg: qty, departed_kg: qty, packed_kg: qty, delivered_kg: qty,
  sources: z.record(z.enum(["available", "unavailable"])),
  unlinked: z.object({ packing_rows: z.number().int(), packing_kg: qty, returns: z.number().int(), returned_kg: qty, jobs: z.number().int(), held_jobs: z.number().int() }).strict(),
  lines: z.array(z.object({
    id: uuid, label: z.string(), ordered_kg: qty, from_stock_kg: qty, produced_kg: qty, planned_open_kg: qty, packed_kg: qty, departed_kg: qty,
    held_jobs: z.number().int().nullable(), held_output_kg: qty, qc_hold_kg: qty, delivered_kg: qty, returned_kg: qty, open_returns: z.number().int().nullable(),
    remaining_to_depart_kg: qty, over_departed: z.boolean()
  }).strict()).max(50)
}).strict();
export type FulfilmentLedger = z.infer<typeof ledgerSchema>;

export const WIP_STAGES = { on_hold: "On hold", at_press: "At press", awaiting_qc: "Awaiting QC", awaiting_finishing: "Awaiting finishing dispatch", at_vendor: "At finishing vendor", awaiting_packing: "QC released, awaiting packing" } as const;
export const STATUS_LABELS: Record<string, string> = {
  ...LEDGER_STATUS, ...WIP_STAGES, matches: "Matches order line", drifted: "Differs; can refresh", drift_locked: "Differs; job already started", overridden: "Recorded difference",
  unlinked: "No order line", open: "Review open", resolved: "Resolved", proposed: "Proposed", accepted: "Accepted for purchasing", dismissed: "Dismissed", obsolete: "Superseded by a newer plan",
  at_vendor_custody: "At vendor", unaccounted: "Not yet accounted", reconciled: "Reconciled", over_received: "More received than issued",
  limits_active: "Role limits in force", no_limits: "No role limits", published: "Published", templates_changed: "Criteria changed since publication", unpublished: "Not published",
  informational: "Informational", awaiting_acknowledgement: "Awaiting acknowledgement", acknowledged: "Acknowledged", withdrawn: "Withdrawn"
};
export function controlStatusLabel(view: ControlView, status: string) {
  if (view === "custody" && status === "at_vendor") return STATUS_LABELS.at_vendor_custody;
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

/** Remaining kg to depart for a line. Unknown ordered quantity stays unknown. */
export function remainingToDepart(orderedKg: number | null, departedKg: number | null) {
  if (orderedKg === null || departedKg === null || !Number.isFinite(orderedKg) || !Number.isFinite(departedKg)) return null;
  return Math.max(Math.round((orderedKg - departedKg) * 1000) / 1000, 0);
}

export function controlRecoveryKey(companyId: string, userId: string) { return `extrusionos:control:v1:${companyId}:${userId}`; }
