import { z } from "zod";
import { can, defaultRolePermissions, type Resource } from "@/lib/auth/permissions";
import { isCalendarDate } from "./operator-workflows";
import type { UserRole } from "@/types/app";

const uuid = z.string().uuid(), page = z.number().int().min(1).max(100000).default(1);
const text = (max: number) => z.string().trim().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Remove control characters.");
const required = (max: number) => text(max).refine(value => value.length > 0, "This value is required.");
const date = z.string().refine(value => { try { return isCalendarDate(value); } catch { return false; } }, "Use a valid calendar date.");
export const discussionTypes = { order: { resource: "orders", path: "/orders", label: "Order" }, production_job: { resource: "production", path: "/production", label: "Production job" }, dispatch: { resource: "dispatches", path: "/dispatches", label: "Dispatch" }, quality_inspection: { resource: "quality", path: "/quality", label: "Quality inspection" } } as const;
export type DiscussionType = keyof typeof discussionTypes;
const entity = z.enum(["order", "production_job", "dispatch", "quality_inspection"]);
const procedureFields = {
  title: required(120), purpose: required(800), scope_label: required(80), owner_id: uuid, backup_id: uuid.nullable(),
  review_due: date.nullable(), routine_kind: z.enum(["none", "opening", "closing"]), prompts: z.array(required(160)).max(6)
};
const answers = z.array(z.object({ index: z.number().int().min(0).max(5), answer: z.enum(["confirmed", "follow_up"]), note: text(500) }).strict()).max(6);
export const collaborationCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("discussions.list"), entity_type: entity, entity_id: uuid, comment_id: uuid.optional(), page }).strict(),
  z.object({ command: z.literal("discussions.people"), entity_type: entity, entity_id: uuid, search: text(80).default(""), page }).strict(),
  z.object({ command: z.literal("discussions.post"), entity_type: entity, entity_id: uuid, body: required(2000), reference: text(240), mentions: z.array(uuid).max(3), reply_to: uuid.nullable(), request_id: uuid }).strict(),
  z.object({ command: z.literal("procedures.list"), search: text(80).default(""), status: z.enum(["active", "archived", "all"]).default("active"), sort: z.enum(["review", "title"]).default("review"), page }).strict(),
  z.object({ command: z.literal("procedures.people"), search: text(80).default(""), page }).strict(),
  z.object({ command: z.literal("procedures.load"), procedure_id: uuid, page }).strict(),
  z.object({ command: z.literal("procedures.create"), ...procedureFields, request_id: uuid }).strict(),
  z.object({ command: z.literal("procedures.update"), ...procedureFields, procedure_id: uuid, expected_revision: z.number().int().positive(), is_active: z.boolean(), reason: required(800), request_id: uuid }).strict(),
  z.object({ command: z.literal("procedures.review"), procedure_id: uuid, expected_revision: z.number().int().positive(), next_review_due: date, note: required(800), request_id: uuid }).strict(),
  z.object({ command: z.literal("routines.list"), status: z.enum(["open", "completed", "all"]).default("open"), search: text(80).default(""), sort: z.enum(["newest", "oldest"]).default("newest"), page }).strict(),
  z.object({ command: z.literal("routines.start"), procedure_id: uuid, request_id: uuid }).strict(),
  z.object({ command: z.literal("routines.load"), run_id: uuid }).strict(),
  z.object({ command: z.literal("routines.finish"), run_id: uuid, source_fingerprint: z.string().regex(/^[0-9a-f]{32}$/), answers, note: required(800), reviewed: z.literal(true), request_id: uuid }).strict()
]);
export type CollaborationCommand = z.infer<typeof collaborationCommandSchema>;
export type CollaborationName = CollaborationCommand["command"];
export const collaborationReads: CollaborationName[] = ["discussions.list", "discussions.people", "procedures.list", "procedures.people", "procedures.load", "routines.list", "routines.load"];
export function canUseCollaboration(role: UserRole, command: CollaborationName, entityType?: DiscussionType) {
  if (!Object.hasOwn(defaultRolePermissions, role) || ["dealer_admin", "dealer_staff"].includes(role)) return false;
  if (command.startsWith("discussions.")) return Boolean(entityType && Object.hasOwn(discussionTypes, entityType) && can(role, "read", discussionTypes[entityType].resource as Resource) && (command !== "discussions.post" || role !== "viewer"));
  if (["procedures.create", "procedures.update"].includes(command)) return ["owner", "admin"].includes(role);
  return collaborationReads.includes(command) || role !== "viewer";
}

const nullable = z.string().nullable();
export const personRow = z.object({ id: uuid, name: z.string(), role: z.string() }).strict();
export const discussionRow = z.object({ id: uuid, body: z.string(), reference: z.string(), author_name: z.string(), recorded_at: z.string(), mentions: z.string(), reply_to: uuid.nullable() }).strict();
export const procedureRow = z.object({ id: uuid, title: z.string(), purpose: z.string(), scope_label: z.string(), owner_id: uuid, owner_name: z.string(), owner_available: z.boolean(), backup_id: uuid.nullable(), backup_name: nullable, backup_available: z.boolean(), review_due: nullable, reviewed_at: nullable, routine_kind: z.enum(["none", "opening", "closing"]), prompts: z.array(z.string()).max(6), revision: z.number().int().positive(), is_active: z.boolean() }).strict();
export const procedureEventRow = z.object({ id: uuid, event_type: z.string(), previous_owner: nullable, owner_name: z.string(), previous_backup: nullable, backup_name: nullable, note: z.string(), actor_name: z.string(), recorded_at: z.string(), revision: z.number().int().positive() }).strict();
export const routineRow = z.object({ id: uuid, procedure_id: uuid, title: z.string(), scope_label: z.string(), routine_kind: z.enum(["opening", "closing"]), business_date: z.string(), procedure_revision: z.number().int().positive(), prompts: z.array(z.string()).max(6), started_by: uuid, starter_name: z.string(), status: z.enum(["open", "completed"]), completed_at: nullable, completed_by_name: nullable, answers: answers.nullable(), outcome: nullable }).strict();
const source = z.object({ count: z.number().int().nonnegative(), carried: z.number().int().nonnegative(), changed_at: z.string().nullable(), rows: z.array(z.object({ id: uuid, label: z.string(), status: z.string() }).strict()).max(5) }).strict();
export const routineSources = z.object({ tasks: source, jobs: source.nullable(), holds: source.nullable(), exceptions: source.nullable() }).strict();
const paged = <T extends z.ZodTypeAny>(row: T) => z.object({ rows: z.array(row).max(10), total_count: z.number().int().nonnegative() }).strict().superRefine((data, ctx) => {
  if (data.total_count < data.rows.length || new Set(data.rows.map((entry: any) => entry.id)).size !== data.rows.length) ctx.addIssue({ code: "custom", message: "Invalid page identities or count." });
});
export type ProcedureRow = z.infer<typeof procedureRow>;
export type RoutineRow = z.infer<typeof routineRow>;
export type DiscussionRow = z.infer<typeof discussionRow>;
export type PersonRow = z.infer<typeof personRow>;
export type ProcedureEventRow = z.infer<typeof procedureEventRow>;
export type RoutineSources = z.infer<typeof routineSources>;
export type CollaborationData = { rows?: (ProcedureRow | RoutineRow | DiscussionRow | PersonRow | ProcedureEventRow)[]; total_count?: number; record?: ProcedureRow | RoutineRow; sources?: RoutineSources; source_fingerprint?: string; id?: string };
export function parseCollaborationData(value: unknown, command: CollaborationName): CollaborationData {
  if (command === "discussions.list") return paged(discussionRow).parse(value);
  if (command.endsWith("people")) return paged(personRow).parse(value);
  if (command === "procedures.list") return paged(procedureRow).parse(value);
  if (command === "routines.list") return paged(routineRow).parse(value);
  if (command === "procedures.load") return z.object({ record: procedureRow, ...paged(procedureEventRow).innerType().shape }).strict().superRefine((data, ctx) => {
    if (data.total_count < data.rows.length || new Set(data.rows.map(entry => entry.id)).size !== data.rows.length) ctx.addIssue({ code: "custom", message: "Invalid history identities or count." });
  }).parse(value);
  if (command === "routines.load") return z.object({ record: routineRow, sources: routineSources, source_fingerprint: z.string().regex(/^[0-9a-f]{32}$/) }).strict().parse(value);
  return z.object({ id: uuid }).strict().parse(value);
}
export type CollaborationResult = { success: true; data: CollaborationData } | { success: false; error: string; unavailable?: boolean; uncertain?: boolean };
