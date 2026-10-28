// UPGRADE_EOS features 63 (ready-to-start conditions) and 72 (hold and resume procedure).
// The database computes readiness with the same rules its start guards enforce; this module
// validates the response, maps each issue to the place it is resolved, and validates hold input.
import { z } from "zod";

export const holdReasons = {
  material_shortage: "Material shortage",
  die_problem: "Die problem",
  machine_breakdown: "Machine breakdown",
  quality_hold: "Quality hold",
  customer_instruction: "Customer instruction",
  planning_change: "Planning change",
  other: "Other reason"
} as const;
export type HoldReason = keyof typeof holdReasons;

export const HOLD_WRITERS = ["owner", "admin", "factory_manager", "production_manager", "production"] as const;
export const HOLD_READERS = [...HOLD_WRITERS, "quality", "viewer"] as const;
export const canPlaceHolds = (role: string) => (HOLD_WRITERS as readonly string[]).includes(role);
export const canReadHolds = (role: string) => (HOLD_READERS as readonly string[]).includes(role);

const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max).refine(noControl, "Remove control characters");
const uuid = z.string().uuid();

export const holdCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("holds.readiness"), job_id: uuid }).strict(),
  z.object({ command: z.literal("holds.list"), job_id: uuid, page: z.number().int().min(1).max(100000).default(1) }).strict(),
  z.object({
    command: z.literal("holds.place"), job_id: uuid, reason: z.enum(Object.keys(holdReasons) as [HoldReason, ...HoldReason[]]),
    note: z.string().trim().max(1000).refine(noControl, "Remove control characters"),
    material_condition: text(1, 500, "Describe the material and work condition"),
    resume_condition: text(1, 500, "State what permits resumption"),
    responsible_user_id: uuid, expected_status: z.enum(["planned", "ready", "in_progress"]), request_id: uuid
  }).strict(),
  z.object({ command: z.literal("holds.resume"), job_id: uuid, hold_id: uuid, note: text(1, 1000, "Record what was done before resuming"), request_id: uuid }).strict()
]).superRefine((value, ctx) => {
  if (value.command === "holds.place" && value.reason === "other" && !value.note) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Explain the other reason", path: ["note"] });
});
export type HoldCommand = z.input<typeof holdCommandSchema>;

export const readinessIssueSchema = z.object({ code: z.string().min(1).max(40), enforced: z.boolean(), message: z.string().min(1).max(600) }).strict();
export type ReadinessIssue = z.infer<typeof readinessIssueSchema>;
const num = z.union([z.number(), z.string()]).nullable().transform((value) => (value === null ? null : Number(value)));
export const readinessResponseSchema = z.object({
  job_status: z.string(),
  start_issues: z.array(readinessIssueSchema).max(30),
  release_issues: z.array(readinessIssueSchema).max(30),
  resume_issues: z.array(readinessIssueSchema).max(30),
  hold: z.object({
    id: uuid, reason: z.string(), note: z.string(), material_condition: z.string(), resume_condition: z.string(), responsible_name: z.string(),
    previous_status: z.enum(["planned", "ready", "in_progress"]), recorded_output_kg: num, recorded_output_pieces: z.number().int().nullable(),
    issued_billet_count: z.number().int().nonnegative(), issued_billet_kg: num, held_by_name: z.string(), held_at: z.string()
  }).strict().nullable()
}).strict();
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const holdHistorySchema = z.object({
  rows: z.array(z.object({
    id: uuid, reason: z.string(), note: z.string(), material_condition: z.string(), resume_condition: z.string(), responsible_name: z.string(),
    previous_status: z.string(), status: z.enum(["active", "resumed", "cancelled"]), held_by_name: z.string(), held_at: z.string(),
    closed_by_name: z.string().nullable(), closed_at: z.string().nullable(), close_note: z.string().nullable()
  }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();

export type ResolutionLinks = { jobId: string; orderId?: string | null; dieId?: string | null; machineId?: string | null; profileId?: string | null };

/** Where an employee resolves each readiness issue. Links only to existing routes. */
export function issueResolution(code: string, links: ResolutionLinks): { label: string; href: string } | null {
  const edit = { label: "Edit job resources", href: `/production/${links.jobId}/edit` };
  switch (code) {
    case "die_missing": case "machine_missing": case "billet_ineligible": return edit;
    case "die_ineligible": case "die_busy": return links.dieId ? { label: "Open die", href: `/dies/${links.dieId}` } : edit;
    case "machine_ineligible": return links.machineId ? { label: "Open press", href: `/machines/${links.machineId}` } : edit;
    case "slot_missing": return { label: "Open press schedule", href: "/production/schedule" };
    case "billets_not_issued": return { label: "Issue billets below", href: "#production-controls" };
    case "order_ineligible": return links.orderId ? { label: "Open order", href: `/orders/${links.orderId}` } : null;
    case "active_hold": return { label: "Review the hold", href: "#production-hold" };
    case "drawing_not_approved": return links.profileId ? { label: "Open profile", href: `/profiles/${links.profileId}` } : null;
    default: return null;
  }
}

/** Summary for the panel heading. Only enforced issues block; advisories are shown separately. */
export function summariseReadiness(data: ReadinessResponse) {
  const relevant = data.hold ? data.resume_issues : data.job_status === "planned" ? data.release_issues : data.start_issues;
  const blockers = relevant.filter((issue) => issue.enforced);
  const advisories = relevant.filter((issue) => !issue.enforced);
  const action = data.hold ? "resume" : data.job_status === "planned" ? "release" : ["ready", "on_hold"].includes(data.job_status) ? "start" : null;
  return { action, blockers, advisories, ready: action !== null && blockers.length === 0 } as const;
}
