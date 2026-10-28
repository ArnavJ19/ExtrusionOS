// UPGRADE_EOS feature 14 (automatic department handoffs). The database creates one task per
// confirmed source event; this module validates queue commands and responses and maps each
// handoff to the page where its source record is opened.
import { z } from "zod";

export const HANDOFF_TEAMS = { packaging: "Packaging", quality: "Quality", dispatch: "Dispatch", production: "Production" } as const;
export type HandoffTeam = keyof typeof HANDOFF_TEAMS;

const TEAM_ROLES: Record<HandoffTeam, readonly string[]> = {
  packaging: ["owner", "admin", "factory_manager", "production_manager", "production"],
  production: ["owner", "admin", "factory_manager", "production_manager", "production"],
  dispatch: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch"],
  quality: ["owner", "admin", "factory_manager", "quality_manager", "quality"]
};
export const HANDOFF_READERS = ["owner", "admin", "factory_manager", "production_manager", "production", "dispatch_manager", "dispatch", "quality_manager", "quality", "viewer"] as const;
export const HANDOFF_REPROCESSORS = ["owner", "admin", "factory_manager", "production_manager", "quality_manager", "quality", "dispatch_manager"] as const;
export const canReadHandoffs = (role: string) => (HANDOFF_READERS as readonly string[]).includes(role);
export const canReprocessHandoffs = (role: string) => (HANDOFF_REPROCESSORS as readonly string[]).includes(role);
/** Teams whose work this role takes on; mirrors private.handoff_team_roles. */
export const teamsForRole = (role: string) => (Object.keys(TEAM_ROLES) as HandoffTeam[]).filter((team) => TEAM_ROLES[team].includes(role));

const uuid = z.string().uuid();
export const handoffCommandSchema = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("handoff.list"), team: z.enum(["packaging", "quality", "dispatch", "production"]).optional(),
    status: z.enum(["active", "open", "in_progress", "completed", "cancelled", "all"]).default("active"), page: z.number().int().min(1).max(100000).default(1)
  }).strict(),
  z.object({ command: z.literal("handoff.take"), task_id: uuid }).strict(),
  z.object({ command: z.literal("handoff.reprocess"), source_type: z.enum(["quality_inspection", "finishing_job", "packaging_job"]), source_id: uuid }).strict()
]);

const num = z.union([z.number(), z.string()]).transform((value) => Number(value));
export const handoffQueueSchema = z.object({
  rows: z.array(z.object({
    id: uuid, title: z.string(), description: z.string().nullable(), priority: z.enum(["low", "normal", "high", "urgent"]), status: z.enum(["open", "in_progress", "completed", "cancelled"]),
    due_date: z.string().nullable(), handoff_team: z.enum(["packaging", "quality", "dispatch", "production"]), handoff_quantity_kg: num,
    handoff_source_type: z.enum(["quality_inspection", "finishing_job", "packaging_job"]), handoff_source_id: uuid,
    created_at: z.string(), completed_at: z.string().nullable(), assigned_to_name: z.string().nullable(), mine: z.boolean().nullable(), can_take: z.boolean()
  }).strict()).max(10),
  total_count: num
}).strict();
export type HandoffQueue = z.infer<typeof handoffQueueSchema>;
export type HandoffRow = HandoffQueue["rows"][number];

/** Where the source record of a handoff is opened. */
export function handoffSourceHref(row: Pick<HandoffRow, "handoff_source_type" | "handoff_source_id">) {
  switch (row.handoff_source_type) {
    case "quality_inspection": return `/quality/${row.handoff_source_id}`;
    case "finishing_job": return `/production/finishing/${row.handoff_source_id}`;
    case "packaging_job": return `/packaging/${row.handoff_source_id}`;
  }
}
export const sourceLabel = { quality_inspection: "QC release", finishing_job: "Finishing receipt", packaging_job: "Completed packaging" } as const;

/** Overdue only while the handoff is still open or in progress. */
export function handoffOverdue(row: Pick<HandoffRow, "due_date" | "status">, today: string) {
  return Boolean(row.due_date) && ["open", "in_progress"].includes(row.status) && (row.due_date as string) < today;
}

// UPGRADE_EOS feature 69 (accepted department handovers).
export const RETURN_REASONS = {
  no_packaging_job: "No packaging job is open", quantity_mismatch: "Quantity does not match", material_not_found: "Material not found at the location",
  source_reversed: "Source step was reversed", order_not_live: "Order is cancelled or closed", documents_missing: "Documents or certificates missing", other: "Other"
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;

export const acceptanceCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("acceptance.status"), task_ids: z.array(uuid).min(1).max(10) }).strict(),
  z.object({ command: z.literal("acceptance.accept"), task_id: uuid, received_quantity_kg: z.number().finite().nonnegative(), note: z.string().trim().max(500).default("") }).strict(),
  z.object({
    command: z.literal("acceptance.return"), task_id: uuid, reason: z.enum(Object.keys(RETURN_REASONS) as [ReturnReason, ...ReturnReason[]]),
    note: z.string().trim().min(5, "Describe what the source team must resolve").max(500).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Remove control characters")
  }).strict(),
  z.object({ command: z.literal("policy.list") }).strict(),
  z.object({ command: z.literal("policy.set"), team: z.enum(["packaging", "dispatch", "quality"]), auto_accept: z.boolean(), quantity_tolerance_percent: z.number().min(0).max(10) }).strict()
]);

const nullableNum = z.union([z.number(), z.string()]).nullable().transform((value) => (value === null ? null : Number(value)));
export const acceptanceStatusSchema = z.array(z.object({
  task_id: uuid, state: z.enum(["pending", "accepted", "returned"]), legacy: z.boolean(), auto_accepted: z.boolean(), accepted_by_name: z.string().nullable(),
  accepted_at: z.string().nullable(), received_quantity_kg: nullableNum, return_count: z.number().int().nonnegative(),
  issues: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  open_return: z.object({ reason: z.string(), note: z.string(), returned_by_name: z.string(), returned_at: z.string(), return_task_id: uuid, owner_name: z.string().nullable() }).strict().nullable()
}).strict()).max(10);
export type AcceptanceStatus = z.infer<typeof acceptanceStatusSchema>[number];

export const policyListSchema = z.array(z.object({ team: z.enum(["packaging", "dispatch", "quality"]), auto_accept: z.boolean(), quantity_tolerance_percent: nullableNum }).strict());

/** Mirrors the database tolerance rule so the form can warn before submitting. */
export function withinTolerance(expectedKg: number, receivedKg: number, tolerancePercent = 0.5) {
  return Math.abs(receivedKg - expectedKg) <= Math.max((expectedKg * tolerancePercent) / 100, 0.001) + 1e-9;
}
