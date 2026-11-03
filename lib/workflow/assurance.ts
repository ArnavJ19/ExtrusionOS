// November batch 5 (NOV-026/030/033/034/038/055/062/069/070/076): assurance over drawings, incoming
// material, deliveries, order changes, people, instruments, capacity, counts, quality packs and returns.
// The database owns every read model and guarded action; this module validates commands and responses
// and mirrors role access so screens never offer an action the server would refuse.
import { z } from "zod";

export const ASSURANCE_VIEWS = {
  drawings: "Drawing approval", incoming: "Incoming acceptance", deliveries: "Delivery exceptions", revisions: "Order change impact", capability: "Demonstrated capability",
  instruments: "Measuring instruments", capacity: "Maintenance and capacity", counts: "Cycle counts", packs: "Quality document packs", returns: "Return resolution"
} as const;
export type AssuranceView = keyof typeof ASSURANCE_VIEWS;
export const ASSURANCE_DESCRIPTIONS: Record<AssuranceView, string> = {
  drawings: "Which drawing revision the customer approved and which is released for manufacture.",
  incoming: "Received purchase material awaiting a quality decision, release into stock or return to the supplier.",
  deliveries: "What customers accepted, refused, found damaged or reported short, and who owns each exception.",
  revisions: "Proposed order-line changes and the downstream work each one affects.",
  capability: "Who can perform each qualified task independently and where cover is thin.",
  instruments: "Instrument check evidence and the inspection results that relied on it.",
  capacity: "Maintenance and breakdowns that affect planned press slots and order promises.",
  counts: "Stock counts by location with movements, recounts and approved adjustments.",
  packs: "Quality evidence each dispatch requires and the packs issued from it.",
  returns: "Customer returns from authorization through receipt, resolution and closure."
};
const viewKeys = Object.keys(ASSURANCE_VIEWS) as [AssuranceView, ...AssuranceView[]];

export const ASSURANCE_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"] as const;
const VIEW_ROLES: Record<AssuranceView, readonly string[]> = {
  drawings: ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "sales_manager", "sales", "viewer"],
  incoming: ["owner", "admin", "factory_manager", "production_manager", "inventory_manager", "quality", "accounts", "viewer"],
  deliveries: ["owner", "admin", "dispatch_manager", "dispatch", "sales_manager", "sales", "accounts", "inventory_manager", "viewer"],
  revisions: ASSURANCE_ROLES,
  capability: ["owner", "admin", "factory_manager", "production_manager", "quality", "dispatch_manager", "inventory_manager", "viewer"],
  instruments: ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "viewer"],
  capacity: ["owner", "admin", "factory_manager", "production_manager", "production", "sales_manager", "sales", "viewer"],
  counts: ["owner", "admin", "factory_manager", "inventory_manager", "dispatch_manager", "dispatch", "accounts", "viewer"],
  packs: ["owner", "admin", "quality", "dispatch_manager", "dispatch", "sales_manager", "factory_manager", "viewer"],
  returns: ["owner", "admin", "sales_manager", "sales", "quality", "inventory_manager", "dispatch_manager", "accounts", "factory_manager", "viewer"]
};

/** Mirrors private.assurance_read_allowed. */
export function canReadAssurance(role: string, view?: AssuranceView) {
  if (!(ASSURANCE_ROLES as readonly string[]).includes(role)) return false;
  return view ? VIEW_ROLES[view].includes(role) : true;
}

const uuid = z.string().uuid("Choose a record from the search results");
const note = z.string().trim().min(5, "Explain the action in at least 5 characters").max(500, "Keep the explanation within 500 characters")
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Remove control characters");
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label} needs at least ${min} characters`).max(max, `Keep ${label.toLowerCase()} within ${max} characters`)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Remove control characters");
const evidence = text(5, 500, "Evidence");
const decimals = (places: number) => (value: number) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6;
const quantity = z.number().finite().positive("Enter a quantity above zero").max(100000000).refine(decimals(3), "Use at most three decimal places");
const kg = z.number().finite().positive("Enter a quantity above zero").max(1000000, "Enter a quantity up to 1,000,000 kg").refine(decimals(3), "Use at most three decimal places for kg");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const instant = z.string().datetime({ offset: true, message: "Choose a date and time" });
export const REVISION_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
const revisionLabel = z.string().trim().regex(REVISION_LABEL, "Use a revision label such as R2");

export const CHANGE_FIELDS = { quantity_kg: "Quantity (kg)", cut_length: "Cut length (mm)", drawing_revision: "Drawing revision", finishing_type: "Finishing type",
  packing_instruction: "Packing instruction", pieces_per_bundle: "Pieces per bundle" } as const;
const changes = z.object({
  quantity_kg: kg.optional(), cut_length: z.number().finite().min(1).max(100000).refine(decimals(3), "Use at most three decimals").optional(),
  drawing_revision: revisionLabel.optional(), finishing_type: z.string().trim().regex(/^[a-z][a-z_]{1,39}$/, "Choose a finishing type such as anodizing").optional(),
  packing_instruction: text(3, 500, "Packing instruction").optional(), pieces_per_bundle: z.number().int().min(1).max(100000).optional()
}).strict().refine(value => Object.keys(value).length > 0, "Propose at least one change");

export const DELIVERY_DISPOSITIONS = { accepted: "Accepted", refused: "Refused", damaged: "Damaged", short_claimed: "Reported short" } as const;
export const DELIVERY_RESOLUTIONS = { redelivery: "Redeliver", credit_claim: "Route to accounts for credit", return_expected: "Material will be returned", verified_shortage: "Shortage verified by stores", claim_rejected: "Claim rejected" } as const;
export const RETURN_RESPONSES = { credit: "Credit", replacement: "Replacement", rework_return: "Rework and return", claim_review: "Claim under review" } as const;
export const COUNT_DECISIONS = { adjust: "Approve adjustment", recount: "Request recount", accept_movement: "Accept movement", no_change: "Close without change", not_counted: "Not counted" } as const;

export const assuranceMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("drawing.register"), drawing_id: uuid, revision_label: revisionLabel, file_sha256: z.string().regex(/^[0-9a-f]{64}$/, "Choose the drawing file so its checksum can be recorded"),
    customer_approval_required: z.boolean(), profile_id: uuid.optional(), file_name: text(1, 180, "File name").optional(), technical_note: text(3, 300, "Technical note").optional(), note }).strict(),
  z.object({ action: z.literal("drawing.customer"), revision_id: uuid, event: z.enum(["submitted", "customer_query", "customer_approved", "customer_rejected"]), evidence,
    customer_contact: text(2, 120, "Customer contact").optional(), note }).strict(),
  z.object({ action: z.literal("drawing.release"), revision_id: uuid, note }).strict(),
  z.object({ action: z.literal("drawing.deviation"), revision_id: uuid, job_id: uuid, valid_until: day, evidence, note }).strict(),
  z.object({ action: z.literal("drawing.withdraw"), revision_id: uuid, note }).strict(),
  z.object({ action: z.literal("incoming.dispose"), receipt_line_id: uuid, disposition: z.enum(["accept", "concession", "reject"]), quantity, evidence, certificate_ref: text(2, 80, "Certificate reference").optional(), note }).strict(),
  z.object({ action: z.literal("incoming.return"), receipt_line_id: uuid, quantity, evidence, note }).strict(),
  z.object({ action: z.literal("incoming.release"), receipt_line_id: uuid, quantity_kg: kg, batch_number: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9/_-]{1,39}$/, "Use letters, digits, slash, dash or underscore"),
    alloy: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, "Enter the alloy such as 6063"), temper: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,10}$/, "Enter the temper such as F"),
    diameter_mm: z.number().finite().min(20).max(800).refine(decimals(1), "Use at most one decimal").optional(), heat_number: text(2, 40, "Heat number").optional(), note }).strict(),
  z.object({ action: z.literal("incoming.reverse"), id: uuid, note }).strict(),
  z.object({ action: z.literal("delivery.record"), packing_item_id: uuid, disposition: z.enum(["accepted", "refused", "damaged", "short_claimed"]), quantity_kg: kg, receiver_name: text(2, 120, "Receiver name"), evidence, note }).strict(),
  z.object({ action: z.literal("delivery.resolve"), id: uuid, resolution: z.enum(["redelivery", "credit_claim", "return_expected", "verified_shortage", "claim_rejected"]),
    response: z.enum(["credit", "replacement", "rework_return"]).optional(), note }).strict(),
  z.object({ action: z.literal("delivery.reverse"), id: uuid, note }).strict(),
  z.object({ action: z.literal("change.propose"), order_item_id: uuid, changes, note }).strict(),
  z.object({ action: z.literal("change.decide"), id: uuid, decision: z.enum(["approved", "abandoned"]), note }).strict(),
  z.object({ action: z.literal("change.resolve"), id: uuid, outcome: z.enum(["done", "not_required"]), note }).strict(),
  z.object({ action: z.literal("capability.criteria"), competency_id: uuid, supervised_required: z.number().int().min(0).max(50), observed_trial_required: z.boolean(), note }).strict(),
  z.object({ action: z.literal("capability.assess"), employee_id: uuid, competency_id: uuid, outcome: z.enum(["independent", "more_practice"]), note }).strict(),
  z.object({ action: z.literal("instrument.register"), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, "Use capitals, digits, dash or underscore"), name: text(3, 120, "Name"),
    unit: z.enum(["mm", "kg/m", "HW", "micron", "percent"]), range_min: z.number().finite().min(-1000000).max(1000000).refine(decimals(4)), range_max: z.number().finite().min(-1000000).max(1000000).refine(decimals(4)),
    location: text(2, 120, "Location").optional(), note }).strict(),
  z.object({ action: z.literal("instrument.check"), instrument_id: uuid, checked_on: day, valid_until: day, result: z.enum(["pass", "fail"]), certificate_ref: text(2, 80, "Certificate reference"), note }).strict(),
  z.object({ action: z.literal("instrument.withdraw"), instrument_id: uuid, note }).strict(),
  z.object({ action: z.literal("instrument.bind"), result_id: uuid, instrument_id: uuid, note }).strict(),
  z.object({ action: z.literal("instrument.policy"), mode: z.enum(["warn", "block"]), note }).strict(),
  z.object({ action: z.literal("instrument.review"), id: uuid, note }).strict(),
  z.object({ action: z.literal("capacity.move"), slot_id: uuid, unavailability_id: uuid, machine_id: uuid, start_at: instant, end_at: instant, shift: text(1, 40, "Shift"), note }).strict(),
  z.object({ action: z.literal("capacity.unplan"), slot_id: uuid, unavailability_id: uuid, note }).strict(),
  z.object({ action: z.literal("capacity.review"), order_id: uuid, unavailability_id: uuid, decision: z.enum(["promise_holds", "customer_informed", "date_review_needed"]), note }).strict(),
  z.object({ action: z.literal("count.open"), location: text(1, 120, "Location"), blind: z.boolean(), note }).strict(),
  z.object({ action: z.literal("count.record"), count_id: uuid, line_id: uuid.optional(), unlisted_label: text(2, 80, "Bundle label").optional(), counted_pieces: z.number().int().min(0).max(1000000),
    counted_kg: z.number().finite().min(0).max(10000000).refine(decimals(3), "Use at most three decimals").optional(), note }).strict(),
  z.object({ action: z.literal("count.review"), line_id: uuid, decision: z.enum(["adjust", "recount", "accept_movement", "no_change", "not_counted"]), note }).strict(),
  z.object({ action: z.literal("count.close"), count_id: uuid, note }).strict(),
  z.object({ action: z.literal("pack.link"), dispatch_id: uuid, requirement_id: uuid, document_id: uuid, note }).strict(),
  z.object({ action: z.literal("pack.waive"), dispatch_id: uuid, requirement_key: z.string().regex(/^(cert|inspection|drawing|source):[0-9a-f-]{36}$/, "Choose a requirement"), note }).strict(),
  z.object({ action: z.literal("pack.issue"), dispatch_id: uuid, note }).strict(),
  z.object({ action: z.literal("pack.withdraw"), id: uuid, note }).strict(),
  z.object({ action: z.literal("return.authorize"), packing_item_id: uuid, expected_kg: kg, response: z.enum(["credit", "replacement", "rework_return", "claim_review"]), note }).strict(),
  z.object({ action: z.literal("return.link"), id: uuid, link_type: z.enum(["replacement_dispatch", "replacement_job", "credit_note"]), target_id: uuid, quantity_kg: kg.optional(), note }).strict(),
  z.object({ action: z.literal("return.close"), id: uuid, note }).strict(),
  z.object({ action: z.literal("return.reject"), id: uuid, note }).strict()
]).superRefine((value, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (value.action === "drawing.customer" && ["customer_approved", "customer_rejected"].includes(value.event) && !value.customer_contact) issue("customer_contact", "Record who at the customer gave this decision");
  if (value.action === "incoming.dispose" && value.disposition === "accept" && !value.certificate_ref) issue("certificate_ref", "Record the mill test certificate reference before accepting");
  if (value.action === "delivery.resolve" && (value.resolution === "return_expected") !== Boolean(value.response)) issue("response", "Choose the response only for an expected return");
  if (value.action === "instrument.register" && value.range_max <= value.range_min) issue("range_max", "The upper range must be above the lower range");
  if (value.action === "instrument.check" && value.valid_until < value.checked_on) issue("valid_until", "Validity must start on or after the check date");
  if (value.action === "capacity.move" && Date.parse(value.end_at) <= Date.parse(value.start_at)) issue("end_at", "The slot must end after it starts");
  if (value.action === "count.record" && Boolean(value.line_id) === Boolean(value.unlisted_label)) issue("unlisted_label", "Count a listed bundle or record one unlisted bundle");
  if (value.action === "return.link" && (value.link_type === "credit_note") === (value.quantity_kg !== undefined)) issue("quantity_kg", "Enter the replacement quantity; credit quantities come from the credit note");
});
export type AssuranceMutation = z.infer<typeof assuranceMutationSchema>;
export type AssuranceAction = AssuranceMutation["action"];

export function assuranceMutationView(action: AssuranceAction): AssuranceView {
  const views: Record<string, AssuranceView> = { drawing: "drawings", incoming: "incoming", delivery: "deliveries", change: "revisions", capability: "capability",
    instrument: "instruments", capacity: "capacity", count: "counts", pack: "packs", return: "returns" };
  return views[action.split(".")[0]];
}

const ACTION_ROLES: Record<AssuranceAction, readonly string[]> = {
  "drawing.register": ["owner", "admin", "factory_manager", "production_manager", "quality"], "drawing.customer": ["owner", "admin", "sales_manager", "sales", "factory_manager", "quality"],
  "drawing.release": ["owner", "admin", "factory_manager", "quality"], "drawing.deviation": ["owner", "admin", "factory_manager", "quality"], "drawing.withdraw": ["owner", "admin", "factory_manager", "quality"],
  "incoming.dispose": ["owner", "admin", "factory_manager", "quality"], "incoming.reverse": ["owner", "admin", "factory_manager", "quality"],
  "incoming.return": ["owner", "admin", "factory_manager", "inventory_manager"], "incoming.release": ["owner", "admin", "inventory_manager"],
  "delivery.record": ["owner", "admin", "dispatch_manager", "dispatch", "sales_manager"], "delivery.reverse": ["owner", "admin", "dispatch_manager", "dispatch", "sales_manager"],
  "delivery.resolve": ["owner", "admin", "dispatch_manager", "sales_manager", "inventory_manager", "accounts"],
  "change.propose": ["owner", "admin", "sales_manager", "sales", "factory_manager"], "change.decide": ["owner", "admin", "factory_manager", "sales_manager"], "change.resolve": ASSURANCE_ROLES,
  "capability.criteria": ["owner", "admin", "factory_manager", "quality"], "capability.assess": ["owner", "admin", "factory_manager", "production_manager", "quality", "dispatch_manager", "inventory_manager"],
  "instrument.register": ["owner", "admin", "factory_manager", "quality"], "instrument.check": ["owner", "admin", "factory_manager", "quality"], "instrument.withdraw": ["owner", "admin", "factory_manager", "quality"],
  "instrument.review": ["owner", "admin", "factory_manager", "quality"], "instrument.policy": ["owner", "admin", "quality"],
  "instrument.bind": ["owner", "admin", "factory_manager", "production_manager", "production", "quality"],
  "capacity.move": ["owner", "admin", "factory_manager", "production_manager"], "capacity.unplan": ["owner", "admin", "factory_manager", "production_manager"],
  "capacity.review": ["owner", "admin", "factory_manager", "sales_manager", "sales"],
  "count.open": ["owner", "admin", "factory_manager", "inventory_manager"], "count.close": ["owner", "admin", "factory_manager", "inventory_manager"],
  "count.record": ["owner", "admin", "factory_manager", "inventory_manager", "dispatch_manager", "dispatch"], "count.review": ["owner", "admin", "factory_manager", "accounts"],
  "pack.link": ["owner", "admin", "quality"], "pack.withdraw": ["owner", "admin", "quality"], "pack.waive": ["owner", "admin", "quality", "factory_manager"], "pack.issue": ["owner", "admin", "quality", "dispatch_manager"],
  "return.authorize": ["owner", "admin", "sales_manager", "quality"], "return.link": ["owner", "admin", "sales_manager", "accounts", "dispatch_manager"],
  "return.close": ["owner", "admin", "sales_manager"], "return.reject": ["owner", "admin", "sales_manager"]
};
/** Mirrors private.assurance_action_allowed. Some actions are further limited on the server (concessions, verified shortages, impact owners, assessors). */
export function canUseAssuranceAction(role: string, action: AssuranceAction) {
  return canReadAssurance(role, assuranceMutationView(action)) && role !== "viewer" && ACTION_ROLES[action].includes(role);
}

export const LOOKUP_KINDS = ["drawings", "profiles", "jobs", "order_items", "competencies", "employees", "instruments", "results", "presses", "packing_items", "documents", "return_targets"] as const;
export type AssuranceLookupKind = typeof LOOKUP_KINDS[number];
const page = z.number().int().min(1).max(100000).default(1);
export const assuranceCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), view: z.enum(viewKeys), page, search: z.string().trim().max(80).default(""), state: z.enum(["active", "all"]).default("active"),
    status: z.string().regex(/^[a-z_]{1,40}$/).optional(), sort: z.enum(["priority", "newest", "due"]).default("priority") }).strict(),
  z.object({ command: z.literal("detail"), view: z.enum(viewKeys), id: uuid, page }).strict(),
  z.object({ command: z.literal("lookup"), kind: z.enum(LOOKUP_KINDS), search: z.string().trim().max(80).default(""), selected_id: uuid.optional(), context_id: uuid.optional(),
    filter: z.string().regex(/^[a-z_]{1,40}$/).optional() }).strict(),
  z.object({ command: z.literal("preview"), request_id: uuid, mutation: assuranceMutationSchema }).strict(),
  z.object({ command: z.literal("commit"), request_id: uuid, fingerprint: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
  z.object({ command: z.literal("outcome"), request_id: uuid }).strict(),
  z.object({ command: z.literal("abandon"), request_id: uuid }).strict()
]);
export type AssuranceCommand = z.input<typeof assuranceCommandSchema>;

export const assuranceRowSchema = z.object({
  id: uuid, label: z.string(), status: z.string(), owner: z.string().nullable(), due_date: z.string().nullable(),
  summary: z.string(), source_href: z.string().nullable(), details: z.record(z.unknown())
}).strict();
export type AssuranceRow = z.infer<typeof assuranceRowSchema>;
export const assuranceListSchema = z.object({ rows: z.array(assuranceRowSchema).max(10), total_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type AssuranceList = z.infer<typeof assuranceListSchema>;
export const assuranceDetailSchema = z.object({ row: assuranceRowSchema, events: z.array(z.object({ id: uuid, action: z.string(), actor: z.string(), note: z.string(), recorded_at: z.string() }).strict()).max(10),
  event_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type AssuranceDetail = z.infer<typeof assuranceDetailSchema>;
export const assuranceLookupSchema = z.array(z.object({ value: uuid, label: z.string(), context: z.string() }).strict()).max(20);
export const assuranceOutcomeSchema = z.object({
  request_id: uuid, state: z.enum(["prepared", "confirmed", "rejected", "abandoned", "not_recorded"]), fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  expires_at: z.string(), action: z.string(), review: z.object({ title: z.string(), effect: z.string(), warnings: z.array(z.string()), facts: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])) }).strict(),
  result: z.object({ label: z.string(), href: z.string().nullable(), message: z.string() }).strict().nullable()
}).strict();
export type AssuranceOutcome = z.infer<typeof assuranceOutcomeSchema>;
export type AssuranceResult<T = unknown> = { success: true; data: T } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

export function parseAssuranceData(command: string, value: unknown) {
  if (command === "list") return assuranceListSchema.parse(value);
  if (command === "detail") return assuranceDetailSchema.parse(value);
  if (command === "lookup") return assuranceLookupSchema.parse(value);
  return assuranceOutcomeSchema.parse(value);
}

export const ASSURANCE_STATUS: Record<string, string> = {
  registered: "Registered", submitted: "With the customer", customer_query: "Customer query open", customer_approved: "Customer approved; not released", customer_rejected: "Customer rejected",
  released: "Released for manufacture", superseded: "Superseded", withdrawn: "Withdrawn",
  awaiting_decision: "Awaiting quality decision", awaiting_release: "Accepted; awaiting release", awaiting_return: "Rejected; awaiting return", complete: "Complete",
  open_exceptions: "Exceptions open", partly_confirmed: "Partly confirmed", awaiting_confirmation: "Awaiting customer confirmation", confirmed: "Fully confirmed",
  assessed: "Assessed; awaiting decision", approved: "Approved; impacts open", abandoned: "Abandoned", completed: "Completed",
  no_cover: "No independent cover", single_cover: "Single point of cover", requalification_due: "Requalification due", covered: "Covered",
  impact_review: "Impact review open", failed: "Check failed", expired: "Evidence expired", no_evidence: "No check evidence", due_soon: "Check due soon", valid: "Evidence valid",
  replan_needed: "Slots need replanning", running_affected: "Running job affected", promises_to_review: "Order promises to review", clear: "No open consequence",
  counting: "Counting", review: "Differences to review", recount: "Recount requested", ready_to_close: "Ready to close", closed: "Closed",
  not_ready: "Evidence outstanding", ready: "Ready to issue", issued: "Pack issued", issued_out_of_date: "Issued pack out of date",
  awaiting_inspection: "Awaiting inspection", awaiting_resolution: "Awaiting resolution", awaiting_receipt: "Awaiting receipt", rejected: "Claim rejected"
};
export function assuranceStatusLabel(status: string) { return ASSURANCE_STATUS[status] ?? status.replace(/_/g, " "); }


export function assuranceRecoveryKey(companyId: string, userId: string) { return `extrusionos:assurance:v1:${companyId}:${userId}`; }
