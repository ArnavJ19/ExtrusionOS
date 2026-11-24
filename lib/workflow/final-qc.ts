// Order lifecycle orchestration Phase 5 (migration 20261124100000): the quality flow of a job from its first QC through
// ageing to the final QC after ageing. The database derives the ageing route, the quantities in each state and the
// tasks, and enforces every rule of a final QC record (who records it, how much is waiting, the profile minimums, the
// reversal of rejected kilograms); this module validates requests and response shapes and names stages.
import { z } from "zod";

const uuid = z.string().uuid();
const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max).refine(noControl, "Remove control characters");
const optionalText = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max).refine(noControl, "Remove control characters").optional();
const kgInput = z.number().min(0).max(10_000_000);

export const FINAL_QC_RECORDERS = ["owner", "quality"];
export const canRecordFinalQc = (role: string) => FINAL_QC_RECORDERS.includes(role);

/** Measured properties and checks a final QC may record; at least the sample count and one of the others. */
export const finalQcResultsSchema = z.object({
  hardness_webster: z.number().min(0).max(25).optional(), hardness_hb: z.number().min(0).max(300).optional(),
  tensile_strength_mpa: z.number().min(0).max(1000).optional(), yield_strength_mpa: z.number().min(0).max(1000).optional(),
  elongation_percent: z.number().min(0).max(100).optional(), conductivity_ms_m: z.number().min(0).max(70).optional(),
  dimensional_ok: z.boolean().optional(), surface_ok: z.boolean().optional(),
  samples_tested: z.number().int("Record how many samples were tested").min(1, "Record how many samples were tested").max(500)
}).strict().refine(r => Object.entries(r).some(([k, v]) => k !== "samples_tested" && v !== undefined), "Record at least one measured property or check");
export type FinalQcResults = z.infer<typeof finalQcResultsSchema>;

export const finalQcCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("queue"), view: z.enum(["awaiting", "recorded"]).optional(), page: z.number().int().min(1).max(100000).optional() }).strict(),
  z.object({ command: z.literal("get"), job_id: uuid }).strict(),
  z.object({ command: z.literal("record_get"), id: uuid }).strict(),
  z.object({
    command: z.literal("record"), job_id: uuid, accepted_kg: kgInput, rejected_kg: kgInput, results: finalQcResultsSchema,
    method: text(2, 120, "Record the test method"), sampling_reference: text(2, 120, "Record the approved sampling plan used"),
    certificate_reference: optionalText(2, 80, "The certificate reference must be at least 2 characters"),
    temper_verified: optionalText(1, 10, "Record the verified temper"),
    rejection_reason: optionalText(10, 500, "Record why material is rejected (at least 10 characters)"),
    note: z.string().trim().max(500).refine(noControl, "Remove control characters").optional()
  }).strict()
]).superRefine((v, ctx) => {
  if (v.command !== "record") return;
  if (v.accepted_kg + v.rejected_kg <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Record the kilograms accepted and/or rejected (more than 0 in total)" });
  if (v.rejected_kg > 0 && !v.rejection_reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Record why material is rejected (at least 10 characters)" });
});
export type FinalQcCommand = z.input<typeof finalQcCommandSchema>;
export const FINAL_QC_MUTATIONS = new Set(["record"]);

export const QUALITY_STAGES = ["not_started", "contained", "awaiting_initial_qc", "awaiting_ageing", "in_ageing", "awaiting_final_qc", "released", "rejected"] as const;
export type QualityStage = (typeof QUALITY_STAGES)[number];

const kg = z.coerce.number();
export const routeSchema = z.object({ state: z.enum(["required", "not_required", "undocumented"]), source: z.string().nullable(), detail: z.string().nullable().optional(),
  temper: z.string().nullable().optional() }).passthrough();
export const qualityFlowSchema = z.object({
  job_id: z.string(), job_number: z.string().nullable(), order_id: z.string().nullable(), job_status: z.string(), route: routeSchema, stage: z.enum(QUALITY_STAGES),
  produced_kg: kg, approved_kg: kg, rejected_kg: kg, pending_kg: kg, rework_open_kg: kg, held_kg: kg, awaiting_decision_kg: kg, packed_kg: kg, loaded_kg: kg,
  in_ageing_kg: kg, aged_accepted_kg: kg, aged_rejected_kg: kg, final_accepted_kg: kg, final_rejected_kg: kg, awaiting_ageing_kg: kg, awaiting_final_kg: kg,
  packed_unaged_kg: kg, tolerance_kg: kg
}).passthrough();
export type QualityFlow = z.infer<typeof qualityFlowSchema>;

export const finalQcRecordSchema = z.object({
  id: z.string(), record_number: z.string(), job_id: z.string(), job_number: z.string().nullable(), order_id: z.string().nullable(), order_number: z.string().nullable(),
  profile_code: z.string().nullable(), accepted_kg: kg, rejected_kg: kg, results: z.record(z.union([z.number(), z.boolean()])), method: z.string(), sampling_reference: z.string(),
  certificate_reference: z.string().nullable(), temper_verified: z.string().nullable(), rejection_reason: z.string().nullable(), note: z.string().nullable(), awaiting_before_kg: kg,
  recorded_by_name: z.string().nullable(), recorded_at: z.string(),
  reversals: z.array(z.object({ id: z.string(), reversal_number: z.string(), reversed_kg: kg })).default([])
}).passthrough();
export type FinalQcRecord = z.infer<typeof finalQcRecordSchema>;

export const finalQcJobSchema = qualityFlowSchema.extend({
  order_number: z.string().nullable(), profile_code: z.string().nullable(), alloy: z.string().nullable(), temper: z.string().nullable(),
  spec: z.object({ tensile_strength_mpa: kg.optional(), yield_strength_mpa: kg.optional(), elongation_percent: kg.optional(), hardness_requirement: z.string().optional(),
    temper_requirement: z.string().optional() }).passthrough(),
  batches: z.array(z.object({ batch_id: z.string(), batch_number: z.string(), status: z.string(), recipe: z.string(), loaded_kg: kg, accepted_kg: kg.nullable(), rejected_kg: kg.nullable(),
    retreat_kg: kg.nullable(), retreatment: z.boolean(), started_at: z.string().nullable(), ended_at: z.string().nullable(), reviewed_at: z.string().nullable() }).passthrough()),
  records: z.array(finalQcRecordSchema), containment_number: z.string().nullable(), max_accept_kg: kg, can_record: z.boolean(), blocker: z.string().nullable(), enforced: z.boolean()
}).passthrough();
export type FinalQcJob = z.infer<typeof finalQcJobSchema>;

export const finalQcQueueSchema = z.object({
  view: z.enum(["awaiting", "recorded"]), page: z.number(), page_size: z.number(), total: z.number(), can_record: z.boolean(), enforced: z.boolean(),
  rows: z.array(z.record(z.unknown()))
});

/** The most the form offers to accept: never more than is waiting, than the treatment review accepted, or than first-stage QC approved. */
export function acceptableKg(job: Pick<FinalQcJob, "max_accept_kg" | "awaiting_final_kg">): number {
  return Math.max(0, Math.min(job.max_accept_kg, job.awaiting_final_kg));
}

export const FINAL_QC_NUMBER_RESULTS = ["hardness_webster", "hardness_hb", "tensile_strength_mpa", "yield_strength_mpa", "elongation_percent", "conductivity_ms_m"] as const;
export type FinalQcCheck = "" | "passed" | "failed";

/** Results as the request sends them: blank fields are left out, never sent as zero. */
export function collectResults(values: Record<string, string>, checks: { dimensional: FinalQcCheck; surface: FinalQcCheck }, samples: string): Partial<FinalQcResults> {
  const out: Partial<FinalQcResults> = {};
  for (const key of FINAL_QC_NUMBER_RESULTS) {
    const raw = values[key]?.trim();
    if (raw) out[key] = Number(raw);
  }
  if (samples.trim()) out.samples_tested = Number(samples);
  if (checks.dimensional) out.dimensional_ok = checks.dimensional === "passed";
  if (checks.surface) out.surface_ok = checks.surface === "passed";
  return out;
}

/** Measured values below the profile's recorded minimums, which the database refuses to accept. */
export function belowSpec(results: Partial<FinalQcResults>, spec: FinalQcJob["spec"]): string[] {
  const out: string[] = [];
  const check = (key: "tensile_strength_mpa" | "yield_strength_mpa" | "elongation_percent") => {
    const min = spec[key]; const got = results[key];
    if (min !== undefined && got !== undefined && got < min) out.push(key);
  };
  check("tensile_strength_mpa"); check("yield_strength_mpa"); check("elongation_percent");
  if (results.dimensional_ok === false) out.push("dimensional_ok");
  if (results.surface_ok === false) out.push("surface_ok");
  return out;
}
