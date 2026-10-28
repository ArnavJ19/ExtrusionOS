// UPGRADE_EOS feature 54 (approved inspection plans in quality entry). The database stores
// versioned plans, judges each recorded observation and refuses to approve an inspection with a
// missing or failing result; this module validates commands and responses.
import { z } from "zod";

export const PLAN_EDITORS = ["owner", "admin", "quality"] as const;
export const PLAN_READERS = [...PLAN_EDITORS, "factory_manager", "production_manager", "viewer"] as const;
export const canEditPlans = (role: string) => (PLAN_EDITORS as readonly string[]).includes(role);
export const canReadPlans = (role: string) => (PLAN_READERS as readonly string[]).includes(role);
export const UNITS = { mm: "mm", "kg/m": "kg/m", HW: "Webster hardness (HW)", micron: "micron (coating)", percent: "percent", visual: "Visual pass/fail" } as const;
export type Unit = keyof typeof UNITS;

const uuid = z.string().uuid();
const optionalNumber = z.union([z.number().finite(), z.null()]);
export const planItemInputSchema = z.object({
  characteristic: z.string().trim().min(2, "Name each characteristic").max(120),
  unit: z.enum(["mm", "kg/m", "HW", "micron", "percent", "visual"]),
  method: z.string().trim().max(200).default(""),
  nominal: optionalNumber.default(null), lower_limit: optionalNumber.default(null), upper_limit: optionalNumber.default(null),
  critical: z.boolean().default(true)
}).strict().superRefine((item, ctx) => {
  const problem = itemProblem(item);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.characteristic || "Characteristic"}: ${problem}` });
});
export type PlanItemInput = z.input<typeof planItemInputSchema>;

/** Mirrors the database checks on one characteristic. */
export function itemProblem(item: { unit: string; nominal: number | null; lower_limit: number | null; upper_limit: number | null }): string | null {
  if (item.unit === "visual") return item.nominal !== null || item.lower_limit !== null || item.upper_limit !== null ? "a visual check has no limits" : null;
  if (item.lower_limit === null && item.upper_limit === null) return "set at least one limit";
  if (item.lower_limit !== null && item.upper_limit !== null && item.lower_limit > item.upper_limit) return "the lower limit is above the upper limit";
  if (item.nominal !== null && ((item.lower_limit !== null && item.nominal < item.lower_limit) || (item.upper_limit !== null && item.nominal > item.upper_limit))) return "the nominal value is outside the limits";
  return null;
}

/** Same pass/fail rule as the database: limits are inclusive. */
export function judge(observed: number, lower: number | null, upper: number | null): "pass" | "fail" {
  return (lower === null || observed >= lower) && (upper === null || observed <= upper) ? "pass" : "fail";
}

export const planCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("plan.list"), page: z.number().int().min(1).max(100000).default(1) }).strict(),
  z.object({ command: z.literal("plan.load"), plan_id: uuid }).strict(),
  z.object({
    command: z.literal("plan.save_draft"), plan_id: uuid, profile_id: uuid.nullable(),
    sampling_instruction: z.string().trim().min(3, "Describe the sampling instruction").max(500), items: z.array(planItemInputSchema).min(1, "Add at least one characteristic").max(50)
  }).strict(),
  z.object({ command: z.literal("plan.approve"), plan_id: uuid }).strict(),
  z.object({ command: z.literal("plan.discard_draft"), plan_id: uuid }).strict(),
  z.object({ command: z.literal("inspection.plan"), inspection_id: uuid }).strict(),
  z.object({
    command: z.literal("results.record"), inspection_id: uuid, plan_id: uuid,
    results: z.array(z.union([z.object({ item_id: uuid, observed: z.number().finite() }).strict(), z.object({ item_id: uuid, visual_ok: z.boolean() }).strict()])).min(1).max(50)
  }).strict()
]);

const num = z.union([z.number(), z.string()]).nullable().transform((value) => (value === null ? null : Number(value)));
export const evaluationSchema = z.union([
  z.object({ plan_id: z.null(), state: z.literal("no_plan"), inspection_status: z.string().optional() }).strict(),
  z.object({
    plan_id: uuid, plan_version: z.number().int(), plan_scope: z.enum(["profile", "default"]), sampling_instruction: z.string(), state: z.enum(["pass", "fail", "incomplete"]),
    total: z.number().int(), missing: z.number().int(), failed: z.number().int(), inspection_status: z.string().optional(),
    items: z.array(z.object({
      item_id: uuid, seq: z.number().int(), characteristic: z.string(), unit: z.enum(["mm", "kg/m", "HW", "micron", "percent", "visual"]), method: z.string().nullable(),
      nominal: num, lower_limit: num, upper_limit: num, critical: z.boolean(), observed: num, visual_ok: z.boolean().nullable(), outcome: z.enum(["pass", "fail", "missing"]),
      recorded_by_name: z.string().nullable(), recorded_at: z.string().nullable()
    }).strict())
  }).strict()
]);
export type Evaluation = z.infer<typeof evaluationSchema>;

export const planDetailSchema = z.object({
  id: uuid, profile_id: uuid.nullable(), profile_code: z.string().nullable(), version: z.number().int(), status: z.enum(["draft", "approved", "superseded"]),
  sampling_instruction: z.string(), created_by: uuid, created_at: z.string(), approved_by: uuid.nullable(), approved_by_name: z.string().nullable(), approved_at: z.string().nullable(), superseded_at: z.string().nullable(),
  items: z.array(z.object({
    id: uuid, seq: z.number().int(), characteristic: z.string(), unit: z.enum(["mm", "kg/m", "HW", "micron", "percent", "visual"]), method: z.string().nullable(),
    nominal: num, lower_limit: num, upper_limit: num, critical: z.boolean()
  }).strict())
}).strict();
export type PlanDetail = z.infer<typeof planDetailSchema>;

export const planListSchema = z.object({
  rows: z.array(z.object({
    id: uuid, profile_id: uuid.nullable(), profile_code: z.string().nullable(), version: z.number().int(), status: z.enum(["draft", "approved"]),
    approved_by_name: z.string().nullable(), approved_at: z.string().nullable(), created_at: z.string(), item_count: z.union([z.number(), z.string()]).transform(Number)
  }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();

/** "1.52 – 1.68 mm", "≥ 12 HW", "Visual". */
export function limitText(item: { unit: string; lower_limit: number | null; upper_limit: number | null }) {
  if (item.unit === "visual") return "Visual pass/fail";
  if (item.lower_limit !== null && item.upper_limit !== null) return `${item.lower_limit} – ${item.upper_limit} ${item.unit}`;
  if (item.lower_limit !== null) return `≥ ${item.lower_limit} ${item.unit}`;
  return `≤ ${item.upper_limit} ${item.unit}`;
}
