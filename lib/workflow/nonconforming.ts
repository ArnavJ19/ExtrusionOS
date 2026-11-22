// Orchestration batch 2 (migration 20261120200000): QC containment and lots, remelt approvals and priority requests.
// The database enforces every rule; this module validates requests and response shapes and names statuses.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max).refine(noControl, "Remove control characters");

export const CONTAINMENT_STATUS: Record<string, string> = { open: "Held", partially_resolved: "Partly released", resolved: "Resolved", cancelled: "Cancelled" };
export const REMELT_STATUS: Record<string, string> = { proposed: "Awaiting decision", rejected: "Rejected", awaiting_receipt: "Approved — awaiting foundry receipt", received: "Weighed in" };
export const LOT_STATUS: Record<string, string> = { held: "Held", split: "Split", released: "Released", awaiting_plan_results: "Accepted — plan results pending", rejected: "Rejected" };

export const QC_CONTAINMENT_OPENERS = ["owner", "admin", "quality", "factory_manager", "production_manager"];
export const QC_RESULT_RECORDERS = ["owner", "quality"];
export const REMELT_DECIDERS = ["owner", "factory_manager"];

export const containmentCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), status: z.enum(["active", "all", "open", "partially_resolved", "resolved", "cancelled"]).optional(), page }).strict(),
  z.object({ command: z.literal("candidates") }).strict(),
  z.object({ command: z.literal("get"), id: uuid }).strict(),
  z.object({
    command: z.literal("open"), job_id: uuid, scope_kg: z.number().positive().max(10_000_000), stage: z.enum(["first_stage", "final"]),
    defect: text(5, 500, "Describe the defect found"), defect_kind: z.enum(["non_destructive", "destructive"]),
    sampling_reference: z.string().trim().max(120).optional(), required_samples: z.number().int().min(2).max(500).optional()
  }).strict(),
  z.object({
    command: z.literal("result"), id: uuid, reference: text(1, 80, "Identify the piece, bundle or sample"), result: z.enum(["accepted", "rejected"]),
    quantity_kg: z.number().positive().max(10_000_000).optional(), pieces: z.number().int().positive().optional(), method: text(2, 120, "Record the inspection or test method"),
    note: z.string().trim().max(500).optional()
  }).strict(),
  z.object({ command: z.literal("release"), id: uuid, decision: z.enum(["accept_lot", "reject_lot"]).optional(), note: text(10, 1000, "Record the disposition basis (at least 10 characters)") }).strict(),
  // Batch 3: each approval recorded before the containment is reconfirmed or revoked; management closes a revocation.
  z.object({ command: z.literal("prior_review"), id: uuid, inspection_id: uuid, outcome: z.enum(["reconfirmed", "revoked"]), method: text(2, 120, "Record how the material was re-checked"),
    note: text(10, 500, "Record the review finding (at least 10 characters)") }).strict(),
  z.object({ command: z.literal("prior_close"), id: uuid, review_id: uuid, method: text(2, 120, "Record how the material was re-verified"),
    note: text(10, 500, "Record the re-verification evidence (at least 10 characters)") }).strict(),
  z.object({ command: z.literal("switch_mode"), id: uuid, note: text(10, 500, "Record why the lot moves to 100% inspection") }).strict(),
  z.object({ command: z.literal("cancel"), id: uuid, reason: text(10, 300, "Record why the containment is cancelled") }).strict()
]);
export const CONTAINMENT_MUTATIONS = new Set(["open", "result", "release", "switch_mode", "cancel", "prior_review", "prior_close"]);

export const remeltCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), status: z.enum(["active", "all", "proposed", "rejected", "awaiting_receipt", "received"]).optional(), page }).strict(),
  z.object({ command: z.literal("sources") }).strict(),
  z.object({ command: z.literal("get"), id: uuid }).strict(),
  z.object({
    command: z.literal("propose"), source_type: z.enum(["qc_reject", "finishing_reject", "dispatch_return"]), source_id: uuid, packing_list_item_id: uuid.optional(),
    quantity_kg: z.number().positive().max(10_000_000), reason: text(5, 500, "Record the failure reason"), evidence: z.string().trim().max(500).optional()
  }).strict(),
  z.object({ command: z.literal("decide"), id: uuid, decision: z.enum(["approve", "reject"]), note: text(5, 500, "Record the reason for the decision") }).strict(),
  z.object({ command: z.literal("receive"), id: uuid, received_kg: z.number().positive().max(10_000_000), weighbridge_reference: z.string().trim().max(60).optional(),
    variance_note: z.string().trim().max(500).optional() }).strict()
]);
export const REMELT_MUTATIONS = new Set(["propose", "decide", "receive"]);

export const priorityCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), status: z.enum(["pending", "approved", "rejected", "withdrawn", "all"]).optional(), order_id: uuid.optional(), page }).strict(),
  z.object({ command: z.literal("request"), order_id: uuid, to_priority: z.enum(["low", "normal", "high", "urgent"]), reason: text(10, 500, "Record why the priority should change (at least 10 characters)") }).strict(),
  z.object({ command: z.literal("decide"), id: uuid, decision: z.enum(["approve", "reject"]), note: text(5, 500, "Record the reason for the decision") }).strict(),
  z.object({ command: z.literal("withdraw"), id: uuid, note: z.string().trim().max(500).optional() }).strict()
]);
export const PRIORITY_MUTATIONS = new Set(["request", "decide", "withdraw"]);

const kg = z.coerce.number();
export const containmentListSchema = z.object({
  page: z.number(), page_size: z.number(), total: z.number(), can_open: z.boolean(),
  rows: z.array(z.object({ id: z.string(), containment_number: z.string(), status: z.string(), stage: z.string(), defect: z.string(), inspection_mode: z.string(), scope_kg: kg,
    released_accepted_kg: kg, released_rejected_kg: kg, held_kg: kg, job_id: z.string(), job_number: z.string().nullable(), order_id: z.string().nullable(),
    order_number: z.string().nullable(), opened_at: z.string() }))
});
export const containmentCandidatesSchema = z.object({ rows: z.array(z.object({ job_id: z.string(), job_number: z.string().nullable(), order_number: z.string().nullable(), open_kg: kg, status: z.string() }).passthrough()) });
export const containmentDetailSchema = z.object({
  id: z.string(), containment_number: z.string(), status: z.string(), stage: z.string(), defect: z.string(), defect_kind: z.string(), inspection_mode: z.string(),
  sampling_reference: z.string().nullable(), required_samples: z.number().nullable(), scope_kg: kg, suspended_approved_kg: kg, released_accepted_kg: kg, released_rejected_kg: kg,
  held_kg: kg, job_number: z.string().nullable(), order_id: z.string().nullable(), order_number: z.string().nullable(), profile_code: z.string().nullable(), die_number: z.string().nullable(),
  ncr_number: z.string().nullable(), opened_at: z.string(),
  recorded: z.object({ accepted_kg: kg, rejected_kg: kg, unreleased_accepted_kg: kg, unreleased_rejected_kg: kg, passing_samples: z.number(), failing_samples: z.number() }),
  results: z.array(z.object({ id: z.string(), reference: z.string(), result: z.string(), quantity_kg: kg.nullable(), pieces: z.number().nullable(), method: z.string(),
    note: z.string().nullable(), released: z.boolean(), recorded_at: z.string(), recorded_by_name: z.string().nullable() }).passthrough()),
  lots: z.array(z.object({ id: z.string(), lot_code: z.string(), kind: z.string(), quantity_kg: kg, status: z.string(), parent_lot_id: z.string().nullable(), created_at: z.string() }).passthrough()),
  trace: z.object({ machine_name: z.string().nullable(), billets: z.array(z.object({ billet_code: z.string().nullable(), source: z.string().nullable(), alloy: z.string().nullable(),
    cast_batch: z.string().nullable(), external_batch: z.string().nullable() })) }).passthrough(),
  can_record: z.boolean(), can_cancel: z.boolean(),
  can_review: z.boolean().default(false),
  prior_approvals: z.array(z.object({
    inspection_id: z.string(), batch_number: z.string().nullable(), quantity_kg: kg, inspection_date: z.string().nullable(), inspector_name: z.string().nullable(),
    review: z.object({ id: z.string(), outcome: z.enum(["reconfirmed", "revoked"]), method: z.string(), note: z.string(), reviewed_at: z.string(), reviewed_by_name: z.string().nullable(),
      closed_at: z.string().nullable(), close_method: z.string().nullable(), close_note: z.string().nullable(), closed_by_name: z.string().nullable(), can_close: z.boolean() }).nullable()
  })).default([])
}).passthrough();
export type ContainmentDetail = z.infer<typeof containmentDetailSchema>;

export const remeltListSchema = z.object({
  page: z.number(), page_size: z.number(), total: z.number(), role: z.string(),
  rows: z.array(z.object({ id: z.string(), approval_number: z.string(), source_type: z.string(), status: z.string(), quantity_kg: kg, alloy: z.string().nullable(), reason: z.string(),
    evidence: z.string().nullable(), order_number: z.string().nullable(), job_number: z.string().nullable(), proposed_by_name: z.string().nullable(), proposed_at: z.string(),
    decided_by_name: z.string().nullable(), decision_note: z.string().nullable(), received_kg: kg.nullable(), variance_kg: kg.nullable(), variance_note: z.string().nullable(),
    can_decide: z.boolean(), can_receive: z.boolean() }).passthrough())
});
export type RemeltRow = z.infer<typeof remeltListSchema>["rows"][number];
export const remeltSourcesSchema = z.object({ rows: z.array(z.object({ source_type: z.string(), source_id: z.string(), label: z.string(), order_number: z.string().nullable(), remaining_kg: kg })) });

export const priorityListSchema = z.object({
  page: z.number(), page_size: z.number(), total: z.number(), can_request: z.boolean(),
  rows: z.array(z.object({ id: z.string(), order_id: z.string(), order_number: z.string(), from_priority: z.string(), to_priority: z.string(), reason: z.string(), status: z.string(),
    impact: z.array(z.object({ job_number: z.string().nullable(), machine: z.string().nullable(), queue_rank: z.number().nullable(), status: z.string() }).passthrough()),
    requested_by_name: z.string().nullable(), requested_at: z.string(), decided_by_name: z.string().nullable(), decision_note: z.string().nullable(), can_decide: z.boolean() }).passthrough())
});
export type PriorityRow = z.infer<typeof priorityListSchema>["rows"][number];
