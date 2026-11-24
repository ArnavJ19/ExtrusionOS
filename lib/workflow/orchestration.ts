// Order lifecycle orchestration (migration 20261120100000). The database derives queue ranks, gates, tasks, the
// quantity ledger and the timeline; this module validates requests, names departments and statuses, and decides which
// roles may see each page. It holds no business rules of its own.
import { z } from "zod";
import type { UserRole } from "@/types/app";

export const DEPARTMENTS = {
  sales: "Sales", finance: "Finance", production_planning: "Production planning", production: "Production", factory_management: "Factory management",
  foundry: "Foundry", billet_inventory: "Billet inventory", procurement: "Procurement", tool_room: "Tool room / dies", quality: "QA/QC", ageing: "Ageing",
  value_addition: "Value addition", packaging: "Packaging", dispatch: "Dispatch / logistics", administration: "Administration", management: "Management"
} as const;
export type Department = keyof typeof DEPARTMENTS;
export const departmentLabel = (value: string | null | undefined) => (value && value in DEPARTMENTS ? DEPARTMENTS[value as Department] : value ? value.replace(/_/g, " ") : "—");

export const ESCALATION_STAGES = ["Receives the work", "Department supervisor", "Factory manager", "Management"] as const;

export const OVERALL_LABELS: Record<string, string> = {
  cancelled: "Cancelled", fully_closed: "Fully closed", operationally_closed_financially_open: "Operationally closed — financial closure pending",
  operationally_closed: "Operationally closed", awaiting_commercial_clearance: "Awaiting commercial clearance", delivered_acceptance_pending: "Delivered — acceptance pending",
  dispatched_awaiting_delivery: "Dispatched — delivery pending", partially_fulfilled: "Partially fulfilled", in_production: "In production",
  awaiting_quality: "Awaiting QC decision", in_process: "In process", planned: "Planned", awaiting_production_planning: "Awaiting production planning"
};
export const overallLabel = (value: string | null | undefined) => (value ? OVERALL_LABELS[value] ?? value.replace(/_/g, " ") : "—");

export const RISK_LABELS: Record<string, string> = { late: "Late", at_risk: "At risk", on_track: "On track", none: "—" };

export const TASK_KIND_LABELS: Record<string, string> = {
  billet_allocation: "Billet allocation", die_preparation: "Die preparation", billet_shortage: "Billet shortage", reproduction: "Reproduction",
  delivery_confirmation: "Delivery confirmation", delivery_followup: "Customer acceptance", containment: "QC containment", remelt_approval: "Remelt approval",
  remelt_receipt: "Remelt receipt", priority_approval: "Priority approval", dispatch_clearance: "Dispatch finance clearance", dispatch_intimation: "Customer dispatch update",
  // Phase 5 (migration 20261124100000): production runs, ageing and final QC.
  initial_qc: "Initial QC after the run", ageing_release: "Material released for ageing", ageing_cycle: "Ageing cycle overdue", ageing_review: "Ageing treatment review",
  final_qc: "Final QC after ageing",
  // Phase 6 (migration 20261125100000): finished goods and invoicing.
  fg_transfer: "Move bundles to finished goods", fg_receipt: "Receive a finished-goods transfer", dispatch_invoice: "Invoice a dispatch that left"
};

/** Where the work of a workflow task is done, and the label of that action. */
export function taskWorkLink(task: { kind: string; order_id: string | null; job_id?: string | null; source_id?: string | null }): { href: string; label: string } {
  switch (task.kind) {
    case "die_preparation": return { href: "/dies/preparation", label: "Prepare die" };
    case "billet_shortage": return { href: "/production/material-plan", label: "Review shortage" };
    case "billet_allocation": return { href: task.order_id ? `/orders/${task.order_id}` : "/production/order-book", label: "Allocate billets" };
    case "reproduction": return { href: "/production/drafts", label: "Plan the balance" };
    case "delivery_confirmation": return { href: task.source_id ? `/dispatches/${task.source_id}` : "/dispatches", label: "Record delivery" };
    case "delivery_followup": return { href: task.source_id ? `/dispatches/${task.source_id}` : "/dispatches", label: "Record customer acceptance" };
    case "containment": return { href: task.source_id ? `/quality/containment/${task.source_id}` : "/quality/containment", label: "Start QC" };
    case "remelt_approval": return { href: "/foundry/remelt", label: "Approve / reject" };
    case "remelt_receipt": return { href: "/foundry/remelt", label: "Record remelt receipt" };
    case "priority_approval": return { href: "/orders/priority-requests", label: "Decide priority" };
    case "dispatch_clearance": return { href: task.source_id ? `/dispatches/clearance/${task.source_id}` : "/dispatches/clearance", label: "Clear dispatch" };
    case "dispatch_intimation": return { href: task.source_id ? `/dispatches/communications/${task.source_id}` : "/dispatches/communications", label: "Send customer update" };
    case "initial_qc": return { href: "/quality/new", label: "Record QC" };
    case "ageing_release": return { href: "/tasks/specialist/new?action=treat.create", label: "Load ageing batch" };
    case "ageing_cycle": return { href: task.source_id ? `/tasks/specialist/treatment/${task.source_id}` : "/tasks/specialist/database?view=treatment", label: "End the cycle" };
    case "ageing_review": return { href: task.source_id ? `/tasks/specialist/treatment/${task.source_id}` : "/tasks/specialist/database?view=treatment", label: "Review the batch" };
    case "final_qc": return { href: task.job_id ? `/quality/final-qc/${task.job_id}` : "/quality/final-qc", label: "Record final QC" };
    case "fg_transfer": return { href: task.order_id ? `/packaging/fg-transfers/new?order_id=${task.order_id}` : "/packaging/fg-transfers/new", label: "Send to finished goods" };
    case "fg_receipt": return { href: task.source_id ? `/packaging/fg-transfers/${task.source_id}` : "/packaging/fg-transfers", label: "Scan bundles in" };
    case "dispatch_invoice": return { href: "/invoices/drafts", label: "Issue the invoice" };
    default: return { href: task.order_id ? `/orders/${task.order_id}/lifecycle` : "/orders/lifecycle", label: "Open order" };
  }
}

export const PREP_STATUS_LABELS: Record<string, string> = {
  required: "Check required", checked: "Checked", blocked: "Blocked", under_preparation: "Under preparation", prepared: "Prepared",
  preheat_scheduled: "Preheat scheduled", preheating: "Preheating", ready: "Preheated and ready", issued: "Issued to press", returned: "Returned", cancelled: "Cancelled"
};

export const DIE_CHECKS = {
  die_present: "Die is physically present at its location",
  revision_matches: "Die revision matches the approved drawing",
  press_compatible: "Die fits the planned press (bolster, container, billet size)",
  condition_acceptable: "Bearing and surface condition acceptable",
  maintenance_complete: "Required maintenance / nitriding is complete"
} as const;
export type DieCheck = keyof typeof DIE_CHECKS;

const READERS: UserRole[] = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "dispatch_manager", "dispatch", "accounts", "quality", "viewer", "factory_manager", "inventory_manager"];
const MANAGERS: UserRole[] = ["owner", "admin", "factory_manager", "production_manager"];
const DIE_WRITERS: UserRole[] = ["owner", "admin", "factory_manager", "production_manager", "production"];
export const canReadOrchestration = (role: string) => (READERS as string[]).includes(role);
export const isOrchestrationManager = (role: string) => (MANAGERS as string[]).includes(role);
export const canWriteDiePreparation = (role: string) => (DIE_WRITERS as string[]).includes(role);
export const canEditOrchestrationSettings = (role: string) => ["owner", "admin", "factory_manager"].includes(role);

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const note = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max).refine(noControl, "Remove control characters");
const departmentEnum = z.enum(Object.keys(DEPARTMENTS) as [Department, ...Department[]]);
const roleEnum = z.enum(READERS as [UserRole, ...UserRole[]]);

export const orchestrationCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("settings.get") }).strict(),
  z.object({
    command: z.literal("settings.save"),
    billet_rank_threshold: z.number().int().min(1).max(50).optional(), die_rank_threshold: z.number().int().min(1).max(50).optional(),
    material_risk_horizon_days: z.number().int().min(1).max(120).optional(), ack_sla_hours: z.number().int().min(1).max(168).optional(),
    action_sla_hours: z.number().int().min(1).max(720).optional(), enforce_die_preparation: z.boolean().optional(), enforce_preheat: z.boolean().optional(),
    // Phase 4 (migration 20261123100000): batch 2 settings and the finance release validity.
    delivery_confirmation_days: z.number().int().min(1).max(60).optional(), reproduction_tolerance_kg: z.number().min(0).max(1000).optional(),
    dispatch_release_hours: z.number().int().min(4).max(168).optional(),
    // Phase 5 (migration 20261124100000): the QC route control and the ageing overdue grace.
    enforce_qc_route: z.boolean().optional(), ageing_overdue_grace_minutes: z.number().int().min(0).max(720).optional(),
    // Phase 6 (migration 20261125100000): finished-goods transfer and invoice reminders, and the receipt control.
    fg_transfer_hours: z.number().int().min(1).max(168).optional(), invoice_due_hours: z.number().int().min(0).max(168).optional(), enforce_fg_receipt: z.boolean().optional()
  }).strict(),
  z.object({ command: z.literal("routing.save"), department: departmentEnum, stage: z.number().int().min(0).max(3), roles: z.array(roleEnum).min(1).max(8).optional(), reset: z.boolean().optional() }).strict(),
  z.object({
    command: z.literal("standards.save"), name: note(3, 120, "Name the standard"), die_type: z.enum(["solid", "hollow", "semi_hollow", "porthole", "bridge", "feeder", "multi_cavity", "flat", "special"]).nullable(),
    min_temperature_c: z.number().positive().max(800), max_temperature_c: z.number().positive().max(800), min_soak_minutes: z.number().int().min(1).max(1440),
    max_hold_minutes: z.number().int().min(1).max(2880), sop_reference: note(2, 120, "Record the SOP reference")
  }).strict(),
  z.object({ command: z.literal("standards.retire"), id: uuid }).strict(),
  z.object({ command: z.literal("tasks.inbox"), view: z.enum(["mine", "department", "overdue", "escalated", "completed", "all"]).optional(), page }).strict(),
  z.object({ command: z.literal("tasks.acknowledge"), task_id: uuid, note: z.string().trim().max(500).optional() }).strict(),
  z.object({ command: z.literal("tasks.start"), task_id: uuid }).strict(),
  z.object({ command: z.literal("tasks.reassign"), task_id: uuid, user_id: uuid, note: note(5, 500, "Record why the task is reassigned") }).strict(),
  z.object({ command: z.literal("queue.book"), machine_id: uuid.optional(), page }).strict(),
  z.object({ command: z.literal("readiness.job"), job_id: uuid }).strict(),
  z.object({ command: z.literal("evaluate") }).strict(),
  z.object({ command: z.literal("lifecycle.order"), order_id: uuid }).strict(),
  z.object({
    command: z.literal("lifecycle.board"), search: z.string().trim().max(80).optional(), stage: z.string().max(40).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(), department: departmentEnum.optional(), page
  }).strict(),
  z.object({ command: z.literal("lifecycle.summary") }).strict()
]).superRefine((v, ctx) => {
  if (v.command === "settings.save" && v.enforce_preheat === true && v.enforce_die_preparation === false) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Preheat control needs die preparation control" });
  if (v.command === "standards.save" && v.max_temperature_c <= v.min_temperature_c) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The maximum temperature must be above the minimum" });
});
export type OrchestrationCommand = z.input<typeof orchestrationCommandSchema>;
export const ORCHESTRATION_MUTATIONS = new Set(["settings.save", "routing.save", "standards.save", "standards.retire", "tasks.acknowledge", "tasks.start", "tasks.reassign", "evaluate"]);

const checks = z.object(Object.fromEntries(Object.keys(DIE_CHECKS).map(k => [k, z.boolean()])) as Record<DieCheck, z.ZodBoolean>).strict();
export const diePreparationCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("prep.list"), status: z.string().max(30).optional(), page }).strict(),
  z.object({ command: z.literal("prep.get"), id: uuid }).strict(),
  z.object({ command: z.literal("prep.open"), job_id: uuid }).strict(),
  z.object({ command: z.literal("prep.check"), id: uuid, results: checks, note: z.string().trim().max(500).optional() }).strict(),
  z.object({ command: z.literal("prep.start"), id: uuid }).strict(),
  z.object({ command: z.literal("prep.prepared"), id: uuid, note: note(5, 500, "Record what was done to prepare the die") }).strict(),
  z.object({ command: z.literal("prep.schedule_preheat"), id: uuid, scheduled_for: z.string().datetime({ offset: true }) }).strict(),
  z.object({ command: z.literal("prep.start_preheat"), id: uuid, oven_reference: note(1, 60, "Record the die oven used") }).strict(),
  z.object({ command: z.literal("prep.complete_preheat"), id: uuid, temperature_c: z.number().positive().max(800), soak_minutes: z.number().int().min(1).max(1440) }).strict(),
  z.object({ command: z.literal("prep.return"), id: uuid, condition: note(5, 300, "Record the die condition on return") }).strict(),
  z.object({ command: z.literal("prep.cancel"), id: uuid, reason: note(5, 300, "Record why the preparation is cancelled") }).strict()
]);
export type DiePreparationCommand = z.input<typeof diePreparationCommandSchema>;

export type ActionResult<T = unknown> = { success: true; data: T } | { success: false; error: string; unavailable?: boolean; uncertain?: boolean };

/** Database messages raised on purpose by the orchestration functions are written for staff; constraint internals are not. */
export function presentableDatabaseMessage(code: string, message: string): string | null {
  if (!["23514", "P0001", "22023"].includes(code)) return null;
  if (/violates|relation "|constraint "|syntax|column "/i.test(message)) return null;
  return message;
}

// Response shapes (validated loosely: the database is the source; unknown fields are kept).
export const gateSchema = z.object({
  code: z.string(), label: z.string(), department: z.string(), phase: z.enum(["planning", "start"]), state: z.string(),
  required: z.boolean(), enforced: z.boolean(), message: z.string().nullable()
}).passthrough();
export type Gate = z.infer<typeof gateSchema>;
export const readinessSchema = z.object({
  job_id: z.string(), job_number: z.string().nullable(), job_status: z.string(), planning_ready: z.boolean(), start_ready: z.boolean(),
  blocker: gateSchema.nullable(), gates: z.array(gateSchema)
}).passthrough();

const nextAction = z.object({ label: z.string(), department: z.string(), link: z.string().nullable().optional() }).nullable();
const blocker = z.object({ label: z.string().nullable(), department: z.string() }).passthrough().nullable();
const quantities = z.object({
  ordered_kg: z.coerce.number(), produced_kg: z.coerce.number(), qc_accepted_kg: z.coerce.number(), qc_pending_kg: z.coerce.number(), qc_rejected_kg: z.coerce.number(),
  packed_kg: z.coerce.number(), dispatched_kg: z.coerce.number(), delivered_kg: z.coerce.number(), outstanding_kg: z.coerce.number(),
  qc_held_kg: z.coerce.number().optional(), reproduction_shortfall_kg: z.coerce.number().optional(),
  // Phase 5: absent before migration 20261124100000.
  awaiting_qc_decision_kg: z.coerce.number().optional(), awaiting_ageing_kg: z.coerce.number().optional(), in_ageing_kg: z.coerce.number().optional(),
  awaiting_final_qc_kg: z.coerce.number().optional(), final_released_kg: z.coerce.number().optional(), final_rejected_kg: z.coerce.number().optional(),
  // Phase 6: absent before migration 20261125100000.
  released_for_packing_kg: z.coerce.number().optional(), to_pack_kg: z.coerce.number().optional(), in_fg_kg: z.coerce.number().optional(),
  in_fg_transfer_kg: z.coerce.number().optional(), invoiced_kg: z.coerce.number().optional(), dispatches_not_invoiced: z.coerce.number().optional()
});
const orderHeader = z.object({
  id: z.string(), order_number: z.string(), customer_name: z.string().nullable(), priority: z.string().nullable(), current_stage: z.string(),
  order_date: z.string().nullable(), expected_dispatch_date: z.string().nullable(), stage_since: z.string().nullable(), days_in_stage: z.number().nullable(),
  quote_number: z.string().nullable(), customer_po: z.string().nullable()
}).passthrough();
export const lifecycleSchema = z.object({
  order: orderHeader, quantities,
  domains: z.array(z.object({ key: z.string(), label: z.string(), status: z.string(), detail: z.unknown() }).passthrough()),
  overall: z.string(), next_action: nextAction, blocker, risk: z.string(),
  jobs: z.array(z.object({
    id: z.string(), job_number: z.string().nullable(), status: z.string(), machine_name: z.string().nullable(), queue_rank: z.number().nullable(),
    planned_start_at: z.string().nullable(), planned_kg: z.coerce.number().nullable(), actual_kg: z.coerce.number().nullable(), planning_ready: z.boolean().nullable(),
    start_ready: z.boolean().nullable(), blocker: gateSchema.nullable(), gates: z.array(gateSchema)
  }).passthrough()),
  finance: z.object({ invoiced: z.coerce.number(), paid: z.coerce.number(), balance: z.coerce.number() }).nullable(),
  timeline: z.array(z.object({ at: z.string(), kind: z.string(), department: z.string().nullable(), summary: z.string(), actor_name: z.string().nullable() })),
  finance_visible: z.boolean(),
  open_tasks: z.array(z.object({ id: z.string(), title: z.string(), department: z.string(), status: z.string(), due_at: z.string().nullable(), escalation_level: z.number(), assignee_name: z.string().nullable() }))
}).passthrough();
export type Lifecycle = z.infer<typeof lifecycleSchema>;

export const boardSchema = z.object({
  page: z.number(), page_size: z.number(), total: z.number(), capped: z.boolean(),
  rows: z.array(z.object({ order: orderHeader, overall: z.string(), next_action: nextAction, blocker, risk: z.string(), quantities }))
});
export type Board = z.infer<typeof boardSchema>;

export const summarySchema = z.record(z.union([z.number(), z.string(), z.boolean(), z.null()]));

export const inboxSchema = z.object({
  view: z.string(), page: z.number(), page_size: z.number(), total: z.number(), departments: z.array(z.string()),
  counts: z.object({ mine: z.number(), department: z.number(), overdue: z.number(), escalated: z.number() }),
  rows: z.array(z.object({
    id: z.string(), title: z.string(), description: z.string().nullable(), kind: z.string(), department: z.string(), status: z.string(), priority: z.string(),
    order_id: z.string().nullable(), order_number: z.string().nullable(), job_id: z.string().nullable(), job_number: z.string().nullable(), assignee_name: z.string().nullable(),
    acknowledged_at: z.string().nullable(), acknowledged_by_name: z.string().nullable(), due_at: z.string().nullable(), created_at: z.string(),
    escalation_level: z.number(), cycle: z.number(), system_resolution: z.string().nullable(), completed_at: z.string().nullable(), can_act: z.boolean(), can_reassign: z.boolean()
  }).passthrough())
});
export type Inbox = z.infer<typeof inboxSchema>;

export const orderBookSchema = z.object({
  page: z.number(), page_size: z.number(), total: z.number(), thresholds: z.object({ billet: z.number(), die: z.number() }),
  presses: z.array(z.object({ id: z.string(), name: z.string(), capacity_ton: z.coerce.number().nullable(), queued: z.number() })),
  unscheduled: z.object({ count: z.number(), rows: z.array(z.object({ job_id: z.string(), job_number: z.string().nullable(), order_number: z.string().nullable(), planned_date: z.string().nullable() })) }),
  rows: z.array(z.object({
    job_id: z.string(), job_number: z.string().nullable(), job_status: z.string(), queue_rank: z.number(), machine_name: z.string(), planned_start_at: z.string(),
    order_id: z.string().nullable(), order_number: z.string().nullable(), customer_name: z.string().nullable(), priority: z.string().nullable(), profile_code: z.string().nullable(),
    alloy: z.string().nullable(), temper: z.string().nullable(), billet_diameter_inch: z.coerce.number().nullable(), die_number: z.string().nullable(),
    planned_kg: z.coerce.number().nullable(), customer_commitment_date: z.string().nullable(), planning_ready: z.boolean(), start_ready: z.boolean(),
    blocker: gateSchema.nullable(), gates: z.array(gateSchema)
  }).passthrough())
});
export type OrderBook = z.infer<typeof orderBookSchema>;

export const prepListSchema = z.object({
  page: z.number(), page_size: z.number(), total: z.number(), standards_configured: z.boolean(),
  enforcement: z.object({ die_preparation: z.boolean(), preheat: z.boolean() }),
  rows: z.array(z.object({
    id: z.string(), status: z.string(), cycle: z.number(), job_id: z.string(), job_number: z.string().nullable(), job_status: z.string(), order_number: z.string().nullable(),
    die_number: z.string(), die_status: z.string(), machine_name: z.string().nullable(), queue_rank: z.number().nullable(), planned_start_at: z.string().nullable(),
    preheat_scheduled_for: z.string().nullable(), updated_at: z.string(), hold_expired: z.boolean().nullable(), die_matches_job: z.boolean()
  }).passthrough())
});
export type PrepList = z.infer<typeof prepListSchema>;

export const prepDetailSchema = z.object({
  id: z.string(), status: z.string(), cycle: z.number(), production_job_id: z.string(), job_number: z.string().nullable(), job_status: z.string(), job_die_id: z.string().nullable(),
  die_id: z.string(), die_number: z.string(), die_status: z.string(), die_type: z.string().nullable(), die_location: z.string().nullable(), order_number: z.string().nullable(),
  profile_code: z.string().nullable(), planned_start_at: z.string().nullable(), queue_rank: z.number().nullable(), machine_name: z.string().nullable(), hold_expired: z.boolean().nullable(),
  check_results: z.record(z.unknown()).nullable(), check_note: z.string().nullable(), preparation_note: z.string().nullable(), preheat_scheduled_for: z.string().nullable(),
  oven_reference: z.string().nullable(), preheat_started_at: z.string().nullable(), preheat_completed_at: z.string().nullable(), preheat_temperature_c: z.coerce.number().nullable(),
  preheat_soak_minutes: z.number().nullable(), issued_at: z.string().nullable(), returned_at: z.string().nullable(), return_condition: z.string().nullable(),
  standard: z.object({ id: z.string(), name: z.string(), die_type: z.string().nullable(), min_temperature_c: z.coerce.number(), max_temperature_c: z.coerce.number(),
    min_soak_minutes: z.number(), max_hold_minutes: z.number(), sop_reference: z.string() }).passthrough().nullable(),
  events: z.array(z.object({ action: z.string(), from_status: z.string().nullable(), to_status: z.string(), actor_name: z.string().nullable(), note: z.string().nullable(), occurred_at: z.string() }).passthrough()),
  can_write: z.boolean()
}).passthrough();
export type PrepDetail = z.infer<typeof prepDetailSchema>;

export const settingsSchema = z.object({
  settings: z.object({ billet_rank_threshold: z.number(), die_rank_threshold: z.number(), material_risk_horizon_days: z.number(), ack_sla_hours: z.number(),
    action_sla_hours: z.number(), enforce_die_preparation: z.boolean(), enforce_preheat: z.boolean(),
    delivery_confirmation_days: z.number().optional(), reproduction_tolerance_kg: z.coerce.number().optional(), dispatch_release_hours: z.number().optional(),
    enforce_qc_route: z.boolean().optional(), ageing_overdue_grace_minutes: z.number().optional(),
    fg_transfer_hours: z.number().optional(), invoice_due_hours: z.number().optional(), enforce_fg_receipt: z.boolean().optional() }).passthrough(),
  can_edit: z.boolean(), can_edit_routing: z.boolean(), can_edit_standards: z.boolean(),
  routing: z.array(z.object({ department: z.string(), stage: z.number(), roles: z.array(z.string()), customised: z.boolean() })),
  standards: z.array(z.object({ id: z.string(), name: z.string(), die_type: z.string().nullable(), min_temperature_c: z.coerce.number(), max_temperature_c: z.coerce.number(),
    min_soak_minutes: z.number(), max_hold_minutes: z.number(), sop_reference: z.string(), approved_at: z.string(), approved_by_name: z.string().nullable() })),
  engine_errors: z.array(z.object({ source: z.string(), message: z.string(), occurred_at: z.string() }))
});
export type OrchestrationSettings = z.infer<typeof settingsSchema>;

/** The next prep step a tool-room user may record, given the current status. */
export function nextPrepSteps(status: string): string[] {
  switch (status) {
    case "required": case "blocked": return ["prep.check"];
    case "checked": return ["prep.check", "prep.start", "prep.prepared"];
    case "under_preparation": return ["prep.prepared"];
    case "prepared": return ["prep.schedule_preheat"];
    case "preheat_scheduled": return ["prep.start_preheat", "prep.schedule_preheat"];
    case "preheating": return ["prep.complete_preheat"];
    case "ready": return ["prep.schedule_preheat"];
    case "issued": return ["prep.return"];
    default: return [];
  }
}

export const gateTone = (gate: Pick<Gate, "state" | "required">) =>
  gate.state === "passed" || gate.state === "not_applicable" ? "passed" : gate.required ? "failed" : "advisory";
