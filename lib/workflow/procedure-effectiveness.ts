import { z } from "zod";

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().min(3).max(max);
const page = z.number().int().min(1).max(100000).default(1);
export const effectivenessCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("outcomes"), procedure_id: uuid }).strict(),
  z.object({ command: z.literal("flags.list"), procedure_id: uuid, status: z.enum(["open", "linked", "dismissed"]).default("open"), page }).strict(),
  z.object({ command: z.literal("flag.raise"), task_id: uuid, id: uuid, step_no: z.number().int().min(1).max(30), kind: z.enum(["unclear", "unnecessary", "missing_step", "workaround"]), note: text(500) }).strict(),
  z.object({ command: z.literal("flag.dismiss"), flag_id: uuid, reason: text(300) }).strict(),
  z.object({ command: z.literal("improvements.list"), procedure_id: uuid, page }).strict(),
  z.object({ command: z.literal("improvement.load"), improvement_id: uuid }).strict(),
  z.object({ command: z.literal("improvement.propose"), procedure_id: uuid, id: uuid, title: text(120), problem_summary: text(800), flag_ids: z.array(uuid).max(50).refine(ids => new Set(ids).size === ids.length) }).strict(),
  z.object({ command: z.literal("improvement.trial"), improvement_id: uuid, trial_plan: text(800) }).strict(),
  z.object({ command: z.literal("improvement.decide"), improvement_id: uuid, decision: z.enum(["adopt", "reject"]), findings: text(800) }).strict(),
  z.object({ command: z.literal("improvement.link_release"), improvement_id: uuid, version_id: uuid }).strict(),
  z.object({ command: z.literal("improvement.measure"), improvement_id: uuid, note: z.string().trim().max(500).default("") }).strict()
]);
export const outcomeSchema = z.object({
  version_id: uuid, version_no: z.number().int(), effective_from: z.string().nullable(), tasks: z.number().int(), completed: z.number().int(),
  avg_hours: z.number().nullable(), median_hours: z.number().nullable(), duration_sample: z.number().int(), missing_duration: z.number().int(),
  reopened: z.number().int(), handoffs_accepted: z.number().int(), first_time_accepted: z.number().int(), handoff_returns: z.number().int(),
  exceptions: z.number().int(), tasks_with_exceptions: z.number().int(), step_flags: z.number().int(), comparable: z.boolean(), limits: z.array(z.string())
});
export type Outcome = z.infer<typeof outcomeSchema>;
export const outcomesSchema = z.object({
  procedure: z.object({ id: uuid, title: z.string(), owner_name: z.string() }), current_version_no: z.number().nullable(), versions: z.array(outcomeSchema).max(5),
  step_flags: z.array(z.object({ step_no: z.number(), open: z.number(), kinds: z.array(z.string()) })), can_review: z.boolean()
});
export const flagSchema = z.object({ id: uuid, step_no: z.number().int(), kind: z.string(), note: z.string(), flagged_by_name: z.string(), flagged_at: z.string(), status: z.string(), task_id: uuid, version_no: z.number(), step_text: z.string(), improvement_id: uuid.nullable(), dismissed_reason: z.string().nullable() });
export const flagsSchema = z.object({ rows: z.array(flagSchema).max(10), total_count: z.number().int() });
export const improvementSchema = z.object({
  id: uuid, procedure_id: uuid, title: z.string(), problem_summary: z.string(), status: z.enum(["proposed", "trial", "awaiting_release", "released", "measured", "rejected"]),
  baseline_version_no: z.number(), resolution_version_no: z.number().nullable(), proposed_by_name: z.string(), proposed_at: z.string(), trial_plan: z.string().nullable(), trial_started_at: z.string().nullable(),
  trial_findings: z.string().nullable(), trial_decided_by_name: z.string().nullable(), trial_decided_at: z.string().nullable(), released_linked_at: z.string().nullable(),
  measured_by_name: z.string().nullable(), measured_at: z.string().nullable(), updated_at: z.string(), flag_count: z.number().int(),
  outcome: z.object({ before: outcomeSchema, after: outcomeSchema, comparable: z.boolean(), note: z.string().nullable() }).nullable().optional()
});
export const improvementsSchema = z.object({ rows: z.array(improvementSchema).max(10), total_count: z.number().int() });
export type Improvement = z.infer<typeof improvementSchema>;
export const percent = (numerator: number, denominator: number) => denominator > 0 ? `${(100 * numerator / denominator).toFixed(1)}% (${numerator}/${denominator})` : "Not captured";
