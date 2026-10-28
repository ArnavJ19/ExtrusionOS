// UPGRADE_EOS feature 13 (quick queue updates and safe bulk actions). The database previews and
// applies a change record by record; this module validates commands and outcomes and mirrors the
// role rules so the page offers only what the database will accept.
import { z } from "zod";

export const BULK_LIMIT = 50;
export const TASK_BULK_ROLES = ["owner", "admin", "factory_manager", "production_manager", "dispatch_manager", "sales_manager"] as const;
export const JOB_BULK_ROLES = ["owner", "admin", "factory_manager", "production_manager"] as const;
export const canBulkTasks = (role: string) => (TASK_BULK_ROLES as readonly string[]).includes(role);
export const canBulkJobs = (role: string) => (JOB_BULK_ROLES as readonly string[]).includes(role);

const SUPERVISED: Record<string, readonly string[]> = {
  factory_manager: ["factory_manager", "production_manager", "production", "dispatch_manager", "dispatch", "inventory_manager", "quality_manager", "quality"],
  production_manager: ["production_manager", "production"],
  dispatch_manager: ["dispatch_manager", "dispatch"],
  sales_manager: ["sales_manager", "sales"]
};
/** Whether a supervisor may assign work to an employee of this role; mirrors private.bulk_supervised_roles. */
export function canAssignTo(supervisorRole: string, assigneeRole: string) {
  if (supervisorRole === "owner" || supervisorRole === "admin") return !["dealer_admin", "dealer_staff"].includes(assigneeRole);
  return (SUPERVISED[supervisorRole] ?? []).includes(assigneeRole);
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date");
const change = z.discriminatedUnion("action", [
  z.object({ target: z.literal("tasks"), action: z.literal("assign"), value: uuid }),
  z.object({ target: z.literal("tasks"), action: z.literal("due_date"), value: isoDate }),
  z.object({ target: z.literal("tasks"), action: z.literal("priority"), value: z.enum(["low", "normal", "high", "urgent"]) }),
  z.object({ target: z.literal("production_jobs"), action: z.literal("planned_date"), value: isoDate }),
  z.object({ target: z.literal("production_jobs"), action: z.literal("shift"), value: z.string().trim().min(1, "Enter a shift name").max(20, "Keep the shift name under 20 characters") })
]);
const ids = z.array(uuid).min(1, "Select at least one record").max(BULK_LIMIT, `Select at most ${BULK_LIMIT} records`);

export const bulkCommandSchema = z.union([
  z.object({ command: z.literal("bulk.preview"), change, ids }).strict(),
  z.object({ command: z.literal("bulk.apply"), change, ids, expected: z.record(uuid, z.string().regex(/^[0-9a-f]{32}$/)), request_id: uuid }).strict()
]);
export type BulkCommand = z.input<typeof bulkCommandSchema>;
export type BulkChange = z.input<typeof change>;

export const bulkOutcomeSchema = z.object({
  results: z.array(z.object({
    id: uuid, label: z.string().optional(), outcome: z.enum(["will_change", "changed", "unchanged", "rejected", "unavailable", "duplicate_selection"]),
    message: z.string(), fingerprint: z.string().optional()
  }).strict()).max(BULK_LIMIT),
  changed_count: z.number().int().nonnegative(),
  replayed: z.boolean()
}).strict();
export type BulkOutcome = z.infer<typeof bulkOutcomeSchema>;

export const outcomeText = {
  will_change: "Will change", changed: "Changed", unchanged: "No change needed", rejected: "Not changed", unavailable: "Not available", duplicate_selection: "Selected twice"
} as const;

/** Fingerprints to send with the apply: only records the preview could evaluate. */
export function expectedFromPreview(preview: BulkOutcome): Record<string, string> {
  return Object.fromEntries(preview.results.filter((row) => row.fingerprint).map((row) => [row.id, row.fingerprint as string]));
}

/** Counts per outcome so the confirmation states exactly what will happen to the selection. */
export function summariseOutcome(outcome: BulkOutcome) {
  const counts = { will_change: 0, changed: 0, unchanged: 0, rejected: 0, unavailable: 0, duplicate_selection: 0 };
  for (const row of outcome.results) counts[row.outcome] += 1;
  return counts;
}
