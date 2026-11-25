// Order lifecycle orchestration Phase 7 (migration 20261126100000): shipment tracking, delivery receipts and
// discrepancies, customer acceptance, the complaint workflow, payment follow-up with disputes and write-offs, and the
// order closure states. The database derives every state and enforces who may act; this module validates requests,
// names states for the screens and mirrors the few rules a form previews before it is sent.
import { z } from "zod";

const uuid = z.string().uuid();
const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max).refine(noControl, "Remove control characters");
const optText = (min: number, max: number, message: string) => text(min, max, message).optional();
const search = z.string().trim().max(80).refine(noControl, "Remove control characters").optional();
const page = z.number().int().min(1).max(100000).optional();
const direction = z.enum(["asc", "desc"]).optional();
const kg = (label: string) => z.number().finite().min(0, `${label} cannot be negative`).max(10000000);
const isoTime = z.string().refine(v => !Number.isNaN(Date.parse(v)), "Enter a valid date and time");

// ---------------------------------------------------------------- roles (the database rechecks each one)
export const SHIPMENT_STATUS_ROLES = ["owner", "admin", "factory_manager", "inventory_manager", "dispatch_manager", "dispatch"];
export const TRACKING_ROLES = [...SHIPMENT_STATUS_ROLES, "sales_manager", "sales"];
export const RECEIPT_ROLES = ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "sales_manager", "sales"];
export const COMPLAINT_LOG_ROLES = ["owner", "admin", "quality", "factory_manager", "production_manager", "sales_manager", "sales", "dispatch_manager", "dispatch"];
export const FINANCE_ROLES = ["owner", "admin", "accounts"];
export const canTrackShipment = (role: string) => TRACKING_ROLES.includes(role);
export const canChangeShipmentStatus = (role: string) => SHIPMENT_STATUS_ROLES.includes(role);
export const canRecordReceipt = (role: string) => RECEIPT_ROLES.includes(role);
export const canLogComplaint = (role: string) => COMPLAINT_LOG_ROLES.includes(role);
export const canFollowUpPayments = (role: string) => FINANCE_ROLES.includes(role);

// ---------------------------------------------------------------- vocabularies (match the migration's check lists)
export const SHIPMENT_STATES = ["pending", "dispatched", "in_transit", "delivery_delayed", "delivery_attempted", "delivered_confirmation_pending", "pod_received",
  "delivery_disputed", "returned", "partially_returned"] as const;
export const SHIPMENT_STATE_LABELS: Record<(typeof SHIPMENT_STATES)[number], string> = {
  pending: "Not yet left", dispatched: "Dispatched", in_transit: "In transit", delivery_delayed: "Delivery delayed", delivery_attempted: "Delivery attempted",
  delivered_confirmation_pending: "Delivered — confirmation pending", pod_received: "Proof of delivery received", delivery_disputed: "Delivery disputed",
  returned: "Returned", partially_returned: "Partially returned"
};
export const DELIVERY_VIEWS = ["open", "all", "dispatched", "in_transit", "delivery_delayed", "delivery_attempted", "delivered_confirmation_pending", "pod_received",
  "delivery_disputed", "returned", "partially_returned"] as const;
export const DELIVERY_SORTS = ["dispatched_at", "expected_at", "dispatch_number"] as const;

export const ACCEPTANCE_OUTCOMES = ["not_delivered", "accepted_in_full", "accepted_partially", "acceptance_pending", "customer_quality_complaint", "quantity_shortage",
  "transit_damage", "material_return_requested", "commercial_dispute"] as const;
export const ACCEPTANCE_LABELS: Record<(typeof ACCEPTANCE_OUTCOMES)[number], string> = {
  not_delivered: "Not delivered yet", accepted_in_full: "Accepted in full", accepted_partially: "Accepted partially", acceptance_pending: "Acceptance pending",
  customer_quality_complaint: "Customer quality complaint", quantity_shortage: "Quantity shortage", transit_damage: "Transit damage",
  material_return_requested: "Material return requested", commercial_dispute: "Commercial dispute"
};

export const TRACKING_KINDS = ["in_transit", "delayed", "delivery_attempted", "eta_revised", "delivered_reported"] as const;
export const TRACKING_KIND_LABELS: Record<(typeof TRACKING_KINDS)[number], string> = {
  in_transit: "In transit", delayed: "Delayed", delivery_attempted: "Delivery attempted, not delivered", eta_revised: "Revised delivery time",
  delivered_reported: "Reported delivered (not yet confirmed)"
};
/** Updates that move the dispatch status; only dispatch roles record them. */
export const STATUS_TRACKING_KINDS = new Set(["in_transit", "delayed"]);
export const TRACKING_SOURCES = ["transporter", "driver", "customer", "staff"] as const;
export const ACKNOWLEDGEMENTS = ["signed_challan", "stamped_lr", "signed_invoice", "email", "whatsapp", "photo", "phone_call"] as const;
export const ACKNOWLEDGEMENT_LABELS: Record<(typeof ACKNOWLEDGEMENTS)[number], string> = {
  signed_challan: "Signed delivery challan", stamped_lr: "Stamped LR copy", signed_invoice: "Signed invoice copy", email: "Email", whatsapp: "WhatsApp message",
  photo: "Photo of the unloaded material", phone_call: "Phone call"
};

export const COMPLAINT_CATEGORIES = ["quality", "dimensional", "surface_finish", "wrong_material", "quantity_shortage", "transit_damage", "documentation", "delivery_delay", "commercial"] as const;
export const COMPLAINT_CATEGORY_LABELS: Record<(typeof COMPLAINT_CATEGORIES)[number], string> = {
  quality: "Quality defect", dimensional: "Dimensional", surface_finish: "Surface finish", wrong_material: "Wrong material", quantity_shortage: "Quantity shortage",
  transit_damage: "Transit damage", documentation: "Documentation", delivery_delay: "Delivery delay", commercial: "Commercial"
};
/** Categories that draft an NCR for QA and count as a customer quality complaint. */
export const QUALITY_CATEGORIES = new Set(["quality", "dimensional", "surface_finish", "wrong_material"]);
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
/** Days to resolve by severity (the database sets the due time the same way). */
export const SEVERITY_DUE_DAYS: Record<(typeof SEVERITIES)[number], number> = { critical: 1, high: 3, medium: 7, low: 14 };
export const COMPLAINT_STATUSES = ["open", "investigating", "action", "resolved", "closed", "rejected", "withdrawn"] as const;
export const COMPLAINT_STATUS_LABELS: Record<(typeof COMPLAINT_STATUSES)[number], string> = {
  open: "Logged — investigation due", investigating: "Investigating", action: "Root cause recorded — resolution due", resolved: "Resolved — verification due",
  closed: "Closed", rejected: "Rejected (not valid)", withdrawn: "Withdrawn by the customer"
};
export const OPEN_COMPLAINT_STATUSES = new Set(["open", "investigating", "action", "resolved"]);
export const COMPLAINT_VIEWS = ["all", "open", "overdue", "open_complaints", "investigating", "action", "resolved", "closed", "rejected", "withdrawn"] as const;
export const COMPLAINT_SORTS = ["logged_at", "due_at", "severity", "complaint_number"] as const;
export const CONTAINMENT_ACTIONS = ["not_required", "stock_held", "qc_containment", "customer_stock_held", "recall"] as const;
export const CONTAINMENT_LABELS: Record<(typeof CONTAINMENT_ACTIONS)[number], string> = {
  not_required: "Not required", stock_held: "Our remaining stock held", qc_containment: "QC containment opened", customer_stock_held: "Customer holds the material", recall: "Recall from the customer"
};
export const RESOLUTIONS = ["replacement", "credit_note", "rework_at_site", "return_for_rework", "commercial_settlement", "no_fault_found"] as const;
export const RESOLUTION_LABELS: Record<(typeof RESOLUTIONS)[number] | "legacy_ncr", string> = {
  replacement: "Replacement material", credit_note: "Credit note", rework_at_site: "Rework at site", return_for_rework: "Return for rework",
  commercial_settlement: "Commercial settlement", no_fault_found: "No fault found", legacy_ncr: "Closed through the NCR (before this workflow)"
};
export const REPLACEMENT_BILLING = ["free_of_charge", "chargeable"] as const;
export const COMMUNICATION_CHANNELS = ["phone", "whatsapp", "email", "visit", "letter"] as const;
export const DEPARTMENTS = ["sales", "finance", "production_planning", "production", "factory_management", "foundry", "billet_inventory", "procurement", "tool_room", "quality",
  "ageing", "value_addition", "packaging", "dispatch", "administration", "management"] as const;

export const RECEIVABLE_VIEWS = ["due", "overdue", "disputed", "write_off_pending", "all_open"] as const;
export const RECEIVABLE_SORTS = ["due_date", "collectible", "invoice_number", "days_overdue"] as const;
export const REASON_CATEGORIES = ["rate_difference", "quantity_shortage", "quality_claim", "transit_damage", "late_delivery_penalty", "tds_mismatch", "settlement_discount",
  "bad_debt", "rounding", "other"] as const;
export const REASON_LABELS: Record<(typeof REASON_CATEGORIES)[number], string> = {
  rate_difference: "Rate difference", quantity_shortage: "Quantity shortage", quality_claim: "Quality claim", transit_damage: "Transit damage",
  late_delivery_penalty: "Late delivery penalty", tds_mismatch: "TDS mismatch", settlement_discount: "Settlement discount", bad_debt: "Bad debt", rounding: "Rounding / bank charges", other: "Other"
};
export const DISPUTE_OUTCOMES = ["customer_to_pay", "credit_note", "written_off"] as const;

export const CLOSURE_VIEWS = ["ready", "acceptance_pending", "in_progress", "financially_open", "financially_settled", "fully_closed", "partially_closed", "all"] as const;
export const CLOSURE_SORTS = ["last_at", "order_number", "blocking"] as const;
export const CLOSURE_VIEW_LABELS: Record<(typeof CLOSURE_VIEWS)[number], string> = {
  ready: "Ready for operational closure", acceptance_pending: "Delivered — acceptance pending", in_progress: "Still in fulfilment", financially_open: "Operationally closed — finance open",
  financially_settled: "Settled — final closure due", fully_closed: "Fully closed", partially_closed: "Partially closed by authorisation", all: "All"
};
/** Phase 7 overall states (directive section 30), added to the lifecycle labels. */
export const CLOSURE_OVERALL_LABELS: Record<string, string> = {
  operationally_fulfilled: "Operationally fulfilled — closure review due", operationally_closed_financially_settled: "Operationally closed — financially settled",
  partially_closed_by_authorization: "Partially closed by authorisation"
};

// ---------------------------------------------------------------- commands
export const deliveryCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("board"), view: z.enum(DELIVERY_VIEWS).optional(), page, search, sort: z.enum(DELIVERY_SORTS).optional(), direction }).strict(),
  z.object({ command: z.literal("get"), dispatch_id: uuid }).strict(),
  z.object({
    command: z.literal("tracking.record"), id: uuid, dispatch_id: uuid, kind: z.enum(TRACKING_KINDS), source: z.enum(TRACKING_SOURCES),
    note: text(5, 500, "Write what was reported (at least 5 characters)"), location: optText(2, 120, "The location is 2 to 120 characters"), revised_eta: isoTime.optional()
  }).strict(),
  z.object({
    command: z.literal("receipt.record"), id: uuid, dispatch_id: uuid, delivered_at: isoTime, receiving_company: text(2, 160, "Name the receiving company"),
    receiver_name: text(2, 120, "Name the person who received it"), receiver_phone: z.string().trim().regex(/^[0-9+ -]{8,20}$/, "Enter the receiver's phone as digits").optional(),
    received_bundles: z.number().int().min(0), received_kg: kg("Kilograms received"), shortage_kg: kg("Shortage").optional(), damaged_kg: kg("Damaged").optional(),
    acknowledgement: z.enum(ACKNOWLEDGEMENTS), note: optText(2, 1000, "The note is 2 to 1000 characters"), accept_all: z.boolean().optional(),
    correction_reason: optText(10, 500, "Write why the receipt is corrected (at least 10 characters)")
  }).strict()
]).superRefine((v, ctx) => {
  if (v.command === "tracking.record") {
    if (v.kind === "eta_revised" && !v.revised_eta) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the revised delivery time" });
    if (v.revised_eta && v.kind !== "eta_revised" && v.kind !== "delayed") ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A revised delivery time goes with a delay or an ETA revision" });
  }
  if (v.command === "receipt.record" && v.accept_all && ((v.shortage_kg ?? 0) > 0 || (v.damaged_kg ?? 0) > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A receipt with shortage or damage cannot accept every bundle; record the affected bundles" });
  }
});
export type DeliveryCommand = z.input<typeof deliveryCommandSchema>;
export const DELIVERY_MUTATIONS = new Set(["tracking.record", "receipt.record"]);

const complaintId = { complaint_id: uuid };
export const complaintCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("board") }).strict(),
  z.object({ command: z.literal("list"), view: z.enum(COMPLAINT_VIEWS).optional(), category: z.enum(COMPLAINT_CATEGORIES).optional(), severity: z.enum(SEVERITIES).optional(),
    page, search, sort: z.enum(COMPLAINT_SORTS).optional(), direction }).strict(),
  z.object({ command: z.literal("get"), ...complaintId }).strict(),
  z.object({ command: z.literal("candidates"), search, order_id: uuid.optional() }).strict(),
  z.object({
    command: z.literal("log"), id: uuid, order_id: uuid, dispatch_id: uuid.optional(), category: z.enum(COMPLAINT_CATEGORIES), severity: z.enum(SEVERITIES),
    description: text(10, 1000, "Describe the reported defect (at least 10 characters)"), customer_reference: optText(2, 120, "The customer reference is 2 to 120 characters"),
    reported_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the report date").optional(), suspected_kg: z.number().positive().max(10000000).optional(),
    evidence: optText(5, 1000, "Describe the evidence (at least 5 characters)"),
    items: z.array(z.object({ packing_list_item_id: uuid, affected_kg: z.number().positive().optional() }).strict()).max(60, "Name at most 60 affected bundles")
      .refine(rows => new Set(rows.map(r => r.packing_list_item_id)).size === rows.length, "A bundle appears twice").optional()
  }).strict(),
  z.object({ command: z.literal("investigate"), ...complaintId, containment_action: z.enum(CONTAINMENT_ACTIONS), containment_note: text(5, 1000, "Describe the containment (at least 5 characters)"),
    containment_id: uuid.optional() }).strict(),
  z.object({ command: z.literal("root_cause"), ...complaintId, root_cause: text(10, 1000, "Write the root cause (at least 10 characters)"),
    corrective_action: text(10, 1000, "Write the corrective action (at least 10 characters)"), preventive_action: optText(10, 1000, "The preventive action is at least 10 characters"),
    responsible_department: z.enum(DEPARTMENTS) }).strict(),
  z.object({ command: z.literal("resolve"), ...complaintId, resolution: z.enum(RESOLUTIONS), resolution_note: text(10, 1000, "Write what was agreed with the customer (at least 10 characters)"),
    replacement_kg: z.number().positive().max(10000000).optional(), replacement_billing: z.enum(REPLACEMENT_BILLING).optional() }).strict(),
  z.object({ command: z.literal("link_replacement"), ...complaintId, id: uuid, dispatch_id: uuid, kg: z.number().positive().optional() }).strict(),
  z.object({ command: z.literal("unlink_replacement"), ...complaintId, id: uuid, note: text(10, 500, "Write why the link is withdrawn (at least 10 characters)") }).strict(),
  z.object({ command: z.literal("link_credit_note"), ...complaintId, credit_note_id: uuid }).strict(),
  z.object({ command: z.literal("communicate"), ...complaintId, channel: z.enum(COMMUNICATION_CHANNELS), summary: text(10, 1000, "Write what was communicated (at least 10 characters)") }).strict(),
  z.object({ command: z.literal("close"), ...complaintId, note: text(10, 1000, "Write how the fix and the customer's acceptance were verified (at least 10 characters)") }).strict(),
  z.object({ command: z.literal("reject"), ...complaintId, note: text(10, 1000, "Write why the complaint is not valid and what the customer was told (at least 10 characters)") }).strict(),
  z.object({ command: z.literal("withdraw"), ...complaintId, note: text(10, 1000, "Write how the customer withdrew it (at least 10 characters)") }).strict()
]).superRefine((v, ctx) => {
  if (v.command === "resolve") {
    const replacement = v.resolution === "replacement";
    if (replacement && (v.replacement_kg === undefined || !v.replacement_billing)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the replacement quantity and whether it is free of charge or chargeable" });
    if (!replacement && (v.replacement_kg !== undefined || v.replacement_billing)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Replacement quantity and billing go with a replacement resolution" });
  }
  if (v.command === "investigate" && (v.containment_action === "qc_containment") !== Boolean(v.containment_id)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: v.containment_id ? "A QC containment is linked only with the QC containment decision" : "Choose the QC containment" });
  }
});
export type ComplaintCommand = z.input<typeof complaintCommandSchema>;
export const COMPLAINT_MUTATIONS = new Set(["log", "investigate", "root_cause", "resolve", "link_replacement", "unlink_replacement", "link_credit_note", "communicate", "close", "reject", "withdraw"]);

const money = z.number().positive().max(100000000).refine(v => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "Enter the amount in rupees and paise");
const exceptionFields = {
  id: uuid, invoice_id: uuid, amount: money, reason_category: z.enum(REASON_CATEGORIES), reason: text(10, 500, "Explain it (at least 10 characters)"),
  customer_reference: optText(2, 120, "The customer reference is 2 to 120 characters"), complaint_id: uuid.optional()
};
export const receivableCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), view: z.enum(RECEIVABLE_VIEWS).optional(), page, search, sort: z.enum(RECEIVABLE_SORTS).optional(), direction }).strict(),
  z.object({ command: z.literal("get"), invoice_id: uuid }).strict(),
  z.object({ command: z.literal("dispute.open"), ...exceptionFields }).strict(),
  z.object({ command: z.literal("write_off.propose"), ...exceptionFields }).strict(),
  z.object({ command: z.literal("write_off.decide"), id: uuid, decision: z.enum(["approve", "reject"]), note: text(10, 500, "Write the reason for the decision (at least 10 characters)") }).strict(),
  z.object({ command: z.literal("dispute.resolve"), id: uuid, outcome: z.enum(DISPUTE_OUTCOMES), note: text(10, 500, "Write how the dispute ended (at least 10 characters)") }).strict(),
  z.object({ command: z.literal("exception.withdraw"), id: uuid, note: text(10, 500, "Write why it is withdrawn (at least 10 characters)") }).strict()
]);
export const RECEIVABLE_MUTATIONS = new Set(["dispute.open", "write_off.propose", "write_off.decide", "dispute.resolve", "exception.withdraw"]);

export const closureCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("board"), view: z.enum(CLOSURE_VIEWS).optional(), page, search, sort: z.enum(CLOSURE_SORTS).optional(), direction }).strict(),
  z.object({ command: z.literal("get"), order_id: uuid }).strict(),
  z.object({ command: z.literal("finalize"), order_id: uuid, note: text(10, 500, "Write the final closure note (at least 10 characters)") }).strict()
]);
export const CLOSURE_MUTATIONS = new Set(["finalize"]);

// ---------------------------------------------------------------- previews of database rules
/**
 * Whether a delivery receipt records a discrepancy (mirrors private.olo_receipt_discrepancy): any reported shortage or
 * damage above the tolerance, a missing bundle, or received kilograms below the dispatched net by more than the
 * tolerance or 0.5 % (weighbridge variance).
 */
export function receiptDiscrepancy(r: { dispatched_kg: number; dispatched_bundles: number; received_kg: number; received_bundles: number; shortage_kg?: number; damaged_kg?: number },
  toleranceKg = 1): { open: boolean; discrepancyKg: number; missingBundles: number } {
  const reported = (r.shortage_kg ?? 0) + (r.damaged_kg ?? 0);
  const discrepancyKg = Math.max(reported, r.dispatched_kg - r.received_kg, 0);
  const weighbridge = Math.max(toleranceKg, Math.round(r.dispatched_kg * 0.005 * 1000) / 1000);
  const missingBundles = r.dispatched_bundles - r.received_bundles;
  return { open: reported > toleranceKg || r.dispatched_kg - r.received_kg > weighbridge || missingBundles > 0, discrepancyKg: Math.round(discrepancyKg * 1000) / 1000, missingBundles };
}

/** The complaint's next step and who takes it (mirrors the task each status raises). */
export function complaintNextStep(status: string, category: string): { label: string; department: string } | null {
  switch (status) {
    case "open": return { label: "Decide the containment", department: QUALITY_CATEGORIES.has(category) ? "quality" : ["commercial"].includes(category) ? "sales" : "dispatch" };
    case "investigating": return { label: "Record the root cause and corrective action", department: QUALITY_CATEGORIES.has(category) ? "quality" : ["commercial"].includes(category) ? "sales" : "dispatch" };
    case "action": return { label: "Agree the resolution with the customer", department: "sales" };
    case "resolved": return { label: "Verify and close (a second person)", department: "factory_management" };
    default: return null;
  }
}

export const deliverySort = (v: string | undefined) => ((DELIVERY_SORTS as readonly string[]).includes(v ?? "") ? v as (typeof DELIVERY_SORTS)[number] : "dispatched_at");
export const complaintSort = (v: string | undefined) => ((COMPLAINT_SORTS as readonly string[]).includes(v ?? "") ? v as (typeof COMPLAINT_SORTS)[number] : "logged_at");
export const receivableSort = (v: string | undefined) => ((RECEIVABLE_SORTS as readonly string[]).includes(v ?? "") ? v as (typeof RECEIVABLE_SORTS)[number] : "due_date");
export const pick = <T extends readonly string[]>(list: T, v: string | undefined, fallback: T[number]): T[number] => ((list as readonly string[]).includes(v ?? "") ? v as T[number] : fallback);
export const labelOf = (labels: Record<string, string>, v: string | null | undefined) => (v ? labels[v] ?? v.replace(/_/g, " ") : "—");

// ---------------------------------------------------------------- response shapes (the database is the source)
const num = z.coerce.number();
const nnum = z.coerce.number().nullable();
const str = z.string().nullable();
const list = <T extends z.ZodTypeAny>(row: T) => z.object({ page: z.number(), page_size: z.number(), total: z.number(), rows: z.array(row) }).passthrough();

const acceptanceSchema = z.object({ outcome: z.enum(ACCEPTANCE_OUTCOMES), lines: z.number(), pending_lines: z.number(), accepted_kg: num, refused_kg: num, damaged_kg: num,
  short_kg: num, unresolved: z.number() }).passthrough();
const discrepancySchema = z.object({ receipt_id: z.string(), open: z.boolean(), discrepancy_kg: num, missing_bundles: z.number(), shortage_kg: num, damaged_kg: num,
  covered_kg: num, unresolved: z.number(), resolved: z.boolean() }).passthrough();
export const shipmentSchema = z.object({
  state: z.enum(SHIPMENT_STATES), delivery_status: z.string(), dispatched_at: str, delivered_at: str, expected_at: str, overdue: z.boolean().nullable(), pod_on_file: z.boolean(),
  last_update: z.object({ kind: z.enum(TRACKING_KINDS), at: z.string(), location: str, note: z.string(), source: z.string() }).nullable(),
  receipt_id: str, discrepancy: discrepancySchema.nullable(), acceptance: acceptanceSchema
}).passthrough();
export const deliveryBoardSchema = list(z.object({ dispatch_id: z.string(), dispatch_number: str, order_id: z.string(), order_number: str, customer: str, dispatched_at: str,
  vehicle_number: str, lr_number: str, transporter_name: str, state: z.enum(SHIPMENT_STATES), expected_at: str, overdue: z.boolean().nullable(), acceptance: str }).passthrough())
  .extend({ counts: z.record(z.number()) });
export type DeliveryRow = z.infer<typeof deliveryBoardSchema>["rows"][number];
export const deliveryDetailSchema = z.object({
  dispatch: z.object({ id: z.string(), dispatch_number: str, delivery_status: z.string(), dispatched_at: str, delivered_at: str, vehicle_number: str, transporter_name: str,
    driver_name: str, driver_phone: str, lr_number: str, eway_bill_number: str, pod_on_file: z.boolean() }).passthrough(),
  order: z.object({ id: z.string(), order_number: str, customer: str, stage: z.string() }).passthrough(),
  manifest: z.object({ bundles: z.number(), kg: num }), shipment: shipmentSchema,
  tracking: z.array(z.object({ id: z.string(), kind: z.enum(TRACKING_KINDS), source: z.string(), location: str, revised_eta: str, note: z.string(), status_changed_to: str,
    recorded_by_name: str, recorded_at: z.string() }).passthrough()),
  receipts: z.array(z.object({ id: z.string(), status: z.enum(["current", "superseded"]), delivered_at: z.string(), receiving_company: z.string(), receiver_name: z.string(),
    receiver_phone: str, dispatched_bundles: z.number(), dispatched_kg: num, received_bundles: z.number(), received_kg: num, shortage_kg: num, damaged_kg: num,
    acknowledgement: z.enum(ACKNOWLEDGEMENTS), note: str, accepted_all: z.boolean(), correction_reason: str, recorded_by_name: str, recorded_at: z.string() }).passthrough()),
  lines: z.array(z.object({ id: z.string(), bundle_number: z.string(), pieces: z.number(), net_kg: num,
    dispositions: z.array(z.object({ disposition: z.string(), quantity_kg: num, resolution: str, receiver_name: z.string(), recorded_at: z.string() }).passthrough()) }).passthrough()),
  complaints: z.array(z.object({ id: z.string(), complaint_number: z.string(), status: z.enum(COMPLAINT_STATUSES), category: z.string(), severity: z.string() }).passthrough()),
  replacement_for: str, can_track: z.boolean(), can_change_status: z.boolean(), can_record_receipt: z.boolean()
}).passthrough();
export type DeliveryDetail = z.infer<typeof deliveryDetailSchema>;

const complaintRow = z.object({ id: z.string(), complaint_number: z.string(), status: z.enum(COMPLAINT_STATUSES).optional(), category: z.enum(COMPLAINT_CATEGORIES),
  severity: z.enum(SEVERITIES), customer: str, order_number: str, description: z.string(), logged_at: z.string(), due_at: str, overdue: z.boolean().nullable() }).passthrough();
export const complaintListSchema = list(complaintRow).extend({ can_log: z.boolean() });
export type ComplaintRow = z.infer<typeof complaintRow>;
export const complaintBoardSchema = z.object({ counts: z.record(z.number()), overdue: z.number(), groups: z.record(z.array(complaintRow)) }).passthrough();
export const complaintDetailSchema = z.object({
  complaint: z.object({ id: z.string(), complaint_number: z.string(), status: z.enum(COMPLAINT_STATUSES), category: z.enum(COMPLAINT_CATEGORIES), severity: z.enum(SEVERITIES),
    description: z.string(), customer_reference: str, reported_on: str, suspected_kg: nnum, evidence: str, logged_by_name: str, logged_at: z.string(), due_at: str,
    overdue: z.boolean().nullable(), containment_action: str, containment_note: str, containment_number: str, containment_id: str, investigated_by_name: str, investigated_at: str,
    root_cause: str, corrective_action: str, preventive_action: str, responsible_department: str, cause_recorded_by_name: str, cause_recorded_at: str,
    resolution: str, resolution_note: str, replacement_kg: nnum, replacement_billing: str, replaced_kg: num, credit_note_number: str, credit_note_status: str,
    resolved_by_name: str, resolved_at: str, closed_by_name: str, closed_at: str, closure_note: str, ncr_id: str, ncr_number: str, ncr_status: str }).passthrough(),
  customer: z.object({ id: z.string(), name: str }), order: z.object({ id: z.string(), order_number: str, stage: z.string() }).nullable(),
  dispatch: z.object({ id: z.string(), dispatch_number: str, delivery_status: z.string(), dispatched_at: str }).nullable(),
  items: z.array(z.object({ packing_list_item_id: z.string(), bundle_number: z.string(), dispatch_id: z.string(), affected_kg: num })),
  replacements: z.array(z.object({ id: z.string(), dispatch_id: z.string(), dispatch_number: str, delivery_status: z.string(), dispatched_at: str, kg: num, linked_by_name: str,
    linked_at: z.string(), withdrawn_at: str, withdraw_note: str }).passthrough()),
  events: z.array(z.object({ action: z.string(), from_status: str, to_status: str, note: str, actor_name: str, occurred_at: z.string() }).passthrough()),
  tasks: z.array(z.object({ id: z.string(), kind: z.string(), status: z.string(), title: z.string(), department: z.string(), resolution: str }).passthrough()),
  close_blocker: str,
  replacement_candidates: z.array(z.object({ id: z.string(), dispatch_number: str, delivery_status: z.string(), kg: num, invoiced: z.boolean() })).optional(),
  credit_note_candidates: z.array(z.object({ id: z.string(), credit_note_number: z.string(), credit_date: z.string(), invoice_number: str })).optional(),
  containment_candidates: z.array(z.object({ id: z.string(), containment_number: z.string(), defect: z.string(), status: z.string() })).optional(),
  can: z.object({ investigate: z.boolean(), root_cause: z.boolean(), resolve: z.boolean(), link_replacement: z.boolean(), link_credit_note: z.boolean(), communicate: z.boolean(),
    close: z.boolean(), reject: z.boolean(), withdraw: z.boolean() })
}).passthrough();
export type ComplaintDetail = z.infer<typeof complaintDetailSchema>;
export const complaintCandidatesSchema = z.object({
  orders: z.array(z.object({ id: z.string(), order_number: z.string(), customer: str, stage: z.string() })).optional(),
  order: z.object({ id: z.string(), order_number: z.string(), customer: str }).passthrough().optional(),
  dispatches: z.array(z.object({ id: z.string(), dispatch_number: str, delivery_status: z.string(), dispatched_at: str,
    lines: z.array(z.object({ id: z.string(), bundle_number: z.string(), pieces: z.number(), net_kg: num })) })).optional()
}).passthrough();
export type ComplaintCandidates = z.infer<typeof complaintCandidatesSchema>;

export const receivableListSchema = list(z.object({ invoice_id: z.string(), invoice_number: str, invoice_date: z.string(), due_date: str, days_overdue: z.number(), customer: str,
  order_id: str, order_number: str, dispatch_number: str, delivery_status: str, balance: num, collectible: num, disputed: num, written_off: num, pending_write_off: num }).passthrough())
  .extend({ lead_days: z.number() });
export const receivableDetailSchema = z.object({
  invoice: z.object({ id: z.string(), invoice_number: str, invoice_date: z.string(), due_date: str, status: z.string(), grand_total: num, amount_paid: num, credited_amount: num,
    balance_due: nnum, days_overdue: z.number() }).passthrough(),
  collectible: z.object({ balance: num, written_off: num, pending_write_off: num, disputed: num, open_exceptions: z.number(), collectible: num }),
  customer: z.object({ id: z.string(), name: str }), order: z.object({ id: z.string(), order_number: str, stage: z.string() }).nullable(),
  dispatch: z.object({ id: z.string(), dispatch_number: str, delivery_status: z.string(), delivered_at: str, shipment_state: str }).nullable(),
  payments: z.array(z.object({ id: z.string(), payment_date: z.string(), amount: num, method: z.string(), reference: str, reversed: z.boolean() })),
  credit_notes: z.array(z.object({ id: z.string(), credit_note_number: z.string(), credit_date: z.string(), grand_total: num, status: z.string(), reason: z.string() })),
  promise: z.object({ due_date: z.string(), amount: num, disputed_amount: num, employee: str }).nullable(),
  exceptions: z.array(z.object({ id: z.string(), kind: z.enum(["dispute", "write_off"]), status: z.string(), amount: num, reason_category: z.enum(REASON_CATEGORIES), reason: z.string(),
    customer_reference: str, complaint_number: str, raised_by_name: str, raised_at: z.string(), first_approved_by_name: str, outcome: str, decided_by_name: str, decided_at: str,
    decision_note: str, can_decide: z.boolean(), can_resolve: z.boolean(), can_withdraw: z.boolean() }).passthrough()),
  complaints: z.array(z.object({ id: z.string(), complaint_number: z.string(), status: z.string(), category: z.string() })),
  task: z.object({ id: z.string(), status: z.string(), cycle: z.number(), escalation_level: z.number() }).nullable()
}).passthrough();
export type ReceivableDetail = z.infer<typeof receivableDetailSchema>;

const closureState = z.object({ operational: z.string(), financial: z.string(), closure_kind: str, closed_at: str, authorization: z.boolean(), overall: str, readiness_kind: str,
  blocking: z.number(), first_blocker: z.object({ label: z.string(), owner: str, href: str, domain: str }).nullable(), administrative: str }).passthrough();
export const closureBoardSchema = list(z.object({ order_id: z.string(), order_number: z.string(), customer: str, stage: z.string(), group: z.string(), overall: str, operational: z.string(),
  financial: z.string(), administrative: str, blocking: z.number(), first_blocker: closureState.shape.first_blocker, authorization: z.boolean(), last_at: str }).passthrough())
  .extend({ counts: z.record(z.number()) });
const readinessItem = z.object({ key: z.string(), domain: z.string(), label: z.string(), owner: str.optional(), href: str.optional(), detail: str.optional(), blocking: z.boolean(),
  carried: z.boolean().optional(), carry_reason: str.optional(), resolved: z.boolean().optional() }).passthrough();
const readiness = z.object({ items: z.array(readinessItem), blocking: z.number(), ordered_kg: num, dispatched_kg: num }).passthrough();
export const closureDetailSchema = z.object({
  order: z.object({ id: z.string(), order_number: z.string(), customer: str, stage: z.string(), order_date: z.string() }).passthrough(),
  state: closureState,
  closure: z.object({ id: z.string(), kind: z.enum(["operational", "final"]), closed_at: z.string(), close_note: z.string(), closed_by_name: str }).passthrough().nullable(),
  history: z.array(z.object({ kind: z.string(), status: z.string(), closed_at: z.string(), close_note: z.string(), closed_by_name: str, reopened_at: str, reopen_note: str, superseded_at: str }).passthrough()),
  operational: readiness.nullable(), final: readiness.nullable(),
  can_close_operational: z.boolean(), can_finalize: z.boolean(), can_close_final_directly: z.boolean()
}).passthrough();
export type ClosureDetail = z.infer<typeof closureDetailSchema>;
export type ReadinessItem = z.infer<typeof readinessItem>;
