// UPGRADE_EOS feature 35 (temporary task delegation). Delegation moves task assignment only;
// the database checks eligibility, overlaps and supervision, and returns work on expiry.
import { z } from "zod";
import { canAssignTo } from "./bulk-queue.ts";

export const DELEGATION_SUPERVISORS = ["owner", "admin", "factory_manager", "production_manager", "dispatch_manager", "sales_manager"] as const;
export const canDelegate = (role: string) => (DELEGATION_SUPERVISORS as readonly string[]).includes(role);
/** A supervisor may delegate between two employees only if both are in teams they supervise. */
export const canDelegateBetween = (supervisorRole: string, fromRole: string, toRole: string) => canAssignTo(supervisorRole, fromRole) && canAssignTo(supervisorRole, toRole);

const uuid = z.string().uuid();
const iso = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Choose a valid date and time");
export const delegationCommandSchema = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("delegation.create"), request_id: uuid, delegator_id: uuid, delegate_id: uuid, starts_at: iso.optional(), ends_at: iso,
    scope: z.enum(["all_open", "selected"]), task_ids: z.array(uuid).max(100).optional(),
    reason: z.string().trim().min(3, "Record why the work is delegated").max(300).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Remove control characters")
  }).strict(),
  z.object({ command: z.literal("delegation.cancel"), id: uuid, note: z.string().trim().min(3, "Record why the delegation ends early").max(300) }).strict(),
  z.object({ command: z.literal("delegation.sync") }).strict(),
  z.object({ command: z.literal("delegation.list"), page: z.number().int().min(1).max(100000).default(1), status: z.enum(["current", "closed"]).default("current") }).strict(),
  z.object({ command: z.literal("delegation.load"), id: uuid }).strict(),
  z.object({ command: z.literal("delegation.candidates"), delegator_id: uuid }).strict()
]).superRefine((value, ctx) => {
  if (value.command !== "delegation.create") return;
  if (value.delegator_id === value.delegate_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose a different employee as the replacement", path: ["delegate_id"] });
  if (value.scope === "selected" && !value.task_ids?.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the tasks to delegate", path: ["task_ids"] });
  const start = value.starts_at ? Date.parse(value.starts_at) : Date.now();
  const end = Date.parse(value.ends_at);
  if (end <= start) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The delegation must end after it starts", path: ["ends_at"] });
  if (end - start > 90 * 86_400_000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A delegation lasts at most 90 days", path: ["ends_at"] });
});

const count = z.union([z.number(), z.string()]).transform((value) => Number(value));
export const delegationListSchema = z.object({
  rows: z.array(z.object({
    id: uuid, starts_at: z.string(), ends_at: z.string(), scope: z.enum(["all_open", "selected"]), reason: z.string(), activated_at: z.string().nullable(), closed_at: z.string().nullable(),
    close_reason: z.enum(["expired", "cancelled"]).nullable(), created_by_name: z.string(), delegator_name: z.string().nullable(), delegate_name: z.string().nullable(),
    task_count: count, open_count: count
  }).strict()).max(10),
  total_count: count
}).strict();
export type DelegationRow = z.infer<typeof delegationListSchema>["rows"][number];

export const delegationDetailSchema = z.object({
  id: uuid, delegator_id: uuid, delegate_id: uuid, starts_at: z.string(), ends_at: z.string(), scope: z.enum(["all_open", "selected"]), reason: z.string(),
  created_by: uuid, created_by_name: z.string(), created_at: z.string(), activated_at: z.string().nullable(), closed_at: z.string().nullable(),
  close_reason: z.enum(["expired", "cancelled"]).nullable(), close_note: z.string().nullable(), delegator_name: z.string().nullable(), delegate_name: z.string().nullable(),
  items: z.array(z.object({
    task_id: uuid, title: z.string(), status: z.string(), how: z.enum(["selected", "all_open", "redirected"]),
    outcome: z.enum(["returned", "kept_by_delegate", "completed", "reassigned", "cancelled_task"]).nullable(), delegated_at: z.string(), closed_at: z.string().nullable()
  }).strict())
}).strict();

export const candidatesSchema = z.array(z.object({ id: uuid, title: z.string(), status: z.string(), due_date: z.string().nullable(), handoff_team: z.string().nullable(), held: z.boolean() }).strict());

/** Where a delegation stands at a moment, for its badge. */
export function delegationState(row: Pick<DelegationRow, "starts_at" | "ends_at" | "activated_at" | "closed_at" | "close_reason">, now = Date.now()) {
  if (row.closed_at) return row.close_reason === "cancelled" ? "cancelled" : "ended";
  if (Date.parse(row.ends_at) <= now) return "expiring";
  if (!row.activated_at || Date.parse(row.starts_at) > now) return "scheduled";
  return "active";
}

export const outcomeText = { returned: "Returned to owner", kept_by_delegate: "Kept by delegate (owner inactive)", completed: "Completed during cover", reassigned: "Reassigned to someone else", cancelled_task: "Task cancelled" } as const;
