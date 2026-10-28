// UPGRADE_EOS feature 43 (project and site grouping). Projects belong to one customer; quotations,
// orders and dispatches are grouped by explicit links that the database checks for company and
// customer. This module validates commands and responses and labels link outcomes.
import { z } from "zod";

export const PROJECT_WRITERS = ["owner", "admin", "sales_manager", "sales"] as const;
export const PROJECT_READERS = [...PROJECT_WRITERS, "production_manager", "factory_manager", "dispatch_manager", "dispatch", "accounts", "viewer"] as const;
export const canManageProjects = (role: string) => (PROJECT_WRITERS as readonly string[]).includes(role);
export const canReadProjects = (role: string) => (PROJECT_READERS as readonly string[]).includes(role);

export const PROJECT_STATUSES = { active: "Active", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" } as const;
export type ProjectStatus = keyof typeof PROJECT_STATUSES;
export const ENTITY_LABELS = { quote: "Quotation", order: "Order", dispatch: "Dispatch" } as const;
export type ProjectEntity = keyof typeof ENTITY_LABELS;

const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const uuid = z.string().uuid();
const optional = (max: number, label: string) => z.string().trim().max(max, `Keep the ${label} under ${max} characters`).refine(noControl, "Remove control characters").optional().default("");

export const projectFieldsSchema = z.object({
  name: z.string().trim().min(2, "Enter a project name of 2 to 120 characters").max(120, "Enter a project name of 2 to 120 characters").refine(noControl, "Remove control characters"),
  site_name: optional(120, "site name"),
  site_address: optional(500, "site address"),
  city: optional(80, "city"),
  state: optional(80, "state"),
  pincode: z.string().trim().refine((value) => value === "" || /^[1-9][0-9]{5}$/.test(value), "Enter a valid 6-digit PIN code").optional().default(""),
  contact_name: optional(120, "contact name"),
  contact_phone: z.string().trim().refine((value) => value === "" || /^(\+91)?[6-9][0-9]{9}$/.test(value.replace(/\s/g, "")), "Enter a valid Indian mobile number").optional().default(""),
  notes: optional(2000, "notes")
}).strict();
export type ProjectFields = z.input<typeof projectFieldsSchema>;

const entity = z.enum(["quote", "order", "dispatch"]);
export const projectCommandSchema = z.discriminatedUnion("command", [
  projectFieldsSchema.extend({ command: z.literal("project.create"), request_id: uuid, customer_id: uuid }).strict(),
  projectFieldsSchema.extend({ command: z.literal("project.update"), project_id: uuid, expected_version: z.number().int().min(1), status: z.enum(["active", "on_hold", "completed", "cancelled"]) }).strict(),
  z.object({ command: z.literal("project.link"), project_id: uuid, entity_type: entity, entity_id: uuid, include_related: z.boolean().default(false) }).strict(),
  z.object({ command: z.literal("project.unlink"), project_id: uuid, entity_type: entity, entity_id: uuid, reason: z.string().trim().min(1, "Record why the record is being removed from the project").max(500).refine(noControl, "Remove control characters") }).strict(),
  z.object({ command: z.literal("project.load"), project_id: uuid }).strict(),
  z.object({ command: z.literal("project.candidates"), project_id: uuid, entity_type: entity, search: z.string().trim().max(60).default("") }).strict(),
  z.object({ command: z.literal("project.list"), page: z.number().int().min(1).max(100000).default(1), search: z.string().trim().max(80).default(""), status: z.enum(["active", "on_hold", "completed", "cancelled"]).optional(), customer_id: uuid.optional() }).strict()
]);
export type ProjectCommand = z.input<typeof projectCommandSchema>;

const num = z.union([z.number(), z.string()]).nullable().transform((value) => (value === null ? null : Number(value)));
const count = z.union([z.number(), z.string()]).transform((value) => Number(value));
const str = z.string().nullable();

export const projectSchema = z.object({
  id: uuid, customer_id: uuid, customer_name: str, project_code: z.string(), name: z.string(), site_name: str, site_address: str, city: str, state: str, pincode: str,
  contact_name: str, contact_phone: str, status: z.enum(["active", "on_hold", "completed", "cancelled"]), notes: str, version: z.number().int(),
  created_by: uuid, created_at: z.string(), updated_by: uuid, updated_at: z.string()
}).strict();
export type Project = z.infer<typeof projectSchema>;

const linked = { linked_at: z.string(), linked_by_name: z.string() };
export const projectDetailSchema = z.object({
  project: projectSchema,
  can_see_values: z.boolean(),
  quotes: z.array(z.object({ id: uuid, number: z.string(), date: z.string(), status: z.string(), value: num, ...linked }).strict()),
  orders: z.array(z.object({ id: uuid, number: z.string(), date: z.string(), stage: z.string(), expected_dispatch_date: str, ordered_kg: num, value: num, ...linked }).strict()),
  dispatches: z.array(z.object({ id: uuid, number: str, date: z.string(), status: z.string(), weight_kg: num, order_number: str, vehicle_number: str, ...linked }).strict()),
  totals: z.object({ order_count: count, ordered_kg: num, order_value: num, dispatched_kg: num, delivered_kg: num, open_quote_count: count }).strict(),
  history: z.array(z.object({ id: uuid, entity_type: z.string(), entity_id: uuid, action: z.enum(["linked", "unlinked"]), reason: str, actor_name: z.string(), created_at: z.string() }).strict()).max(10)
}).strict();
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const projectListSchema = z.object({
  rows: z.array(z.object({
    id: uuid, project_code: z.string(), name: z.string(), site_name: str, city: str, status: z.string(), customer_id: uuid, customer_name: str, updated_at: z.string(),
    order_count: count, link_count: count
  }).strict()).max(10),
  total_count: count
}).strict();
export type ProjectList = z.infer<typeof projectListSchema>;

export const candidateSchema = z.object({ rows: z.array(z.object({ id: uuid, number: z.string(), date: str, status: z.string() }).strict()).max(10) }).strict();
export const linkResultSchema = z.object({ results: z.array(z.object({ entity_type: entity, entity_id: uuid, outcome: z.enum(["linked", "already_linked", "other_project", "other_customer", "unavailable"]) }).strict()) }).strict();
export type LinkResult = z.infer<typeof linkResultSchema>;

const outcomeText = {
  linked: "linked", already_linked: "already in this project", other_project: "skipped: grouped under another project",
  other_customer: "skipped: belongs to another customer", unavailable: "skipped: not available"
} as const;

/** One sentence per affected record, so a partial link never silently drops a related record. */
export function describeLinkResults(result: LinkResult): string[] {
  return result.results.map((row) => `${ENTITY_LABELS[row.entity_type]} ${outcomeText[row.outcome]}`);
}

/** Fraction of ordered kilograms that has left the factory; null when nothing measurable is ordered. */
export function projectDispatchShare(totals: Pick<ProjectDetail["totals"], "ordered_kg" | "dispatched_kg">): number | null {
  if (!totals.ordered_kg || totals.ordered_kg <= 0) return null;
  return Math.min(Math.max((totals.dispatched_kg ?? 0) / totals.ordered_kg, 0), 1);
}

