// UPGRADE_EOS feature 76 (competency-linked task authorisation). The database holds grants,
// computes each employee's effective level and refuses restricted actions; this module validates
// commands and responses and explains standings.
import { z } from "zod";

export const COMPETENCY_MANAGERS = ["owner", "admin", "factory_manager"] as const;
export const canManageCompetencies = (role: string) => (COMPETENCY_MANAGERS as readonly string[]).includes(role);
export const LEVELS = { trained: "Trained (procedure read)", supervised: "Supervised", independent: "Independent" } as const;
export type Level = keyof typeof LEVELS;
export const ACTIONS = { qc_release: "QC release of material", production_start: "Starting a production job" } as const;
export type RestrictedAction = keyof typeof ACTIONS;

const uuid = z.string().uuid();
export const competencyCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("catalog.list") }).strict(),
  z.object({
    command: z.literal("catalog.save"), id: uuid, code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, "Use 2 to 30 capitals, digits, - or _"),
    name: z.string().trim().min(3, "Name the competency").max(120), procedure_id: uuid.nullable(), validity_months: z.number().int().min(1).max(60).nullable(), is_active: z.boolean()
  }).strict(),
  z.object({ command: z.literal("grant.set"), employee_id: uuid, competency_id: uuid, level: z.enum(["trained", "supervised", "independent"]), note: z.string().trim().max(300).default("") }).strict(),
  z.object({ command: z.literal("grant.revoke"), employee_id: uuid, competency_id: uuid, reason: z.string().trim().min(3, "Record why the competency is withdrawn").max(300) }).strict(),
  z.object({ command: z.literal("grants.list"), competency_id: uuid.optional(), employee_id: uuid.optional(), page: z.number().int().min(1).max(100000).default(1) }).strict(),
  z.object({ command: z.literal("requirements.list") }).strict(),
  z.object({ command: z.literal("requirements.set"), action: z.enum(["qc_release", "production_start"]), competency_id: uuid.nullable() }).strict(),
  z.object({ command: z.literal("standing"), action: z.enum(["qc_release", "production_start"]), employee_id: uuid.optional() }).strict(),
  z.object({ command: z.literal("supervise.confirm"), action: z.enum(["qc_release", "production_start"]), record_id: uuid, performer_id: uuid }).strict()
]);

const standing = z.object({
  granted: z.enum(["trained", "supervised", "independent"]).nullable(), effective: z.enum(["none", "trained", "supervised", "independent"]),
  reason: z.enum(["not_granted", "expired", "procedure_revised"]).nullable(), expires_at: z.string().nullable().optional(),
  granted_revision: z.number().int().nullable().optional(), current_revision: z.number().int().optional()
}).strict();
export type Standing = z.infer<typeof standing>;

export const catalogSchema = z.array(z.object({
  id: uuid, code: z.string(), name: z.string(), procedure_id: uuid.nullable(), procedure_title: z.string().nullable(), procedure_revision: z.number().int().nullable(),
  validity_months: z.number().int().nullable(), is_active: z.boolean(), holders: z.union([z.number(), z.string()]).transform(Number)
}).strict());
export const holdersSchema = z.object({
  rows: z.array(z.object({ employee_id: uuid, employee_name: z.string().nullable(), employee_role: z.string(), level: z.enum(["trained", "supervised", "independent"]), granted_by_name: z.string(), granted_at: z.string(), expires_at: z.string().nullable(), standing }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();
export const myGrantsSchema = z.array(z.object({ competency_id: uuid, code: z.string(), name: z.string(), level: z.enum(["trained", "supervised", "independent"]), granted_by_name: z.string(), granted_at: z.string(), expires_at: z.string().nullable(), standing }).strict());
export const requirementsSchema = z.array(z.object({ action: z.enum(["qc_release", "production_start"]), competency_id: uuid.nullable(), competency_name: z.string().nullable(), competency_code: z.string().nullable() }).strict());
export const standingResultSchema = z.union([
  z.object({ action: z.string(), required: z.literal(false), effective: z.literal("not_required") }).strict(),
  standing.extend({ action: z.string(), required: z.literal(true), competency_name: z.string() }).strict()
]);

/** Plain-language explanation of an employee's standing for a competency. */
export function describeStanding(value: Standing) {
  if (value.reason === "not_granted") return "Not qualified";
  if (value.reason === "expired") return "Qualification expired: re-qualify to act";
  if (value.reason === "procedure_revised") return `Procedure revised to revision ${value.current_revision}: supervised until re-qualified`;
  if (value.effective === "trained") return "Trained only: cannot perform the restricted step";
  if (value.effective === "supervised") return "May act with a supervisor's confirmation";
  return "May act independently";
}
