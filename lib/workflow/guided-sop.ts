import { z } from "zod";

const uuid = z.string().uuid();
const revision = z.number().int().positive();
const note = z.string().trim().min(3).max(500);
export const VERIFICATION_ROLES = ["owner", "admin", "factory_manager", "production_manager", "dispatch_manager", "inventory_manager", "quality", "accounts", "sales_manager"] as const;
export const SOURCE_TYPES = ["order", "production_job", "quality_inspection", "dispatch", "quote", "invoice", "breakdown_log"] as const;
const stepNo = z.number().int().min(1).max(30);
export const executionStepSchema = z.discriminatedUnion("kind", [
  z.object({ step_no: stepNo, kind: z.literal("check") }).strict(),
  z.object({ step_no: stepNo, kind: z.literal("measurement"), min: z.number().finite().min(-1e9).max(1e9), max: z.number().finite().min(-1e9).max(1e9), unit: z.string().trim().min(1).max(20) }).strict(),
  z.object({ step_no: stepNo, kind: z.literal("transaction"), source_type: z.enum(SOURCE_TYPES), states: z.array(z.string().min(1)).min(1).max(30) }).strict()
]);
export type ExecutionStep = z.infer<typeof executionStepSchema>;
const steps = z.array(executionStepSchema).min(1).max(30).refine(s => new Set(s.map(x => x.step_no)).size === s.length && s.every(x => x.kind !== "measurement" || x.min <= x.max), "Use distinct steps and ordered measurement limits");
export const guidedCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("plan.load"), version_id: uuid }).strict(),
  z.object({ command: z.literal("plan.save"), version_id: uuid, id: uuid, steps, normal_role: z.enum(VERIFICATION_ROLES).nullable(), elevated_role: z.enum(VERIFICATION_ROLES), expected_revision: revision.optional() }).strict(),
  z.object({ command: z.literal("plan.release"), version_id: uuid, expected_revision: revision }).strict(),
  z.object({ command: z.literal("run.load"), task_id: uuid }).strict(),
  z.object({ command: z.literal("run.start"), task_id: uuid }).strict(),
  z.object({ command: z.literal("step.record"), task_id: uuid, id: uuid, step_no: stepNo, expected_revision: revision, note, value: z.number().finite().min(-1e9).max(1e9).optional(), source_id: uuid.optional() }).strict(),
  z.object({ command: z.literal("step.retry"), task_id: uuid, id: uuid, step_no: stepNo, expected_revision: revision, note }).strict(),
  z.object({ command: z.literal("run.submit"), task_id: uuid, expected_revision: revision }).strict(),
  z.object({ command: z.literal("run.verify"), task_id: uuid, expected_revision: revision, note }).strict(),
  z.object({ command: z.literal("run.return"), task_id: uuid, expected_revision: revision, note, step_no: stepNo.optional() }).strict(),
  z.object({ command: z.literal("run.complete"), task_id: uuid, expected_revision: revision }).strict(),
  z.object({ command: z.literal("review.queue"), page: z.number().int().min(1).max(100000).default(1), search: z.string().trim().max(80).default(""), risk: z.enum(["all", "normal", "elevated"]).default("all"), sort: z.enum(["oldest", "newest", "title"]).default("oldest") }).strict()
]);
export const planSchema = z.object({ id: uuid, version_id: uuid, steps: z.array(executionStepSchema), normal_role: z.string().nullable(), elevated_role: z.string(), status: z.enum(["draft", "released"]), revision, author_id: uuid, author_name: z.string(), reviewer_name: z.string().nullable() });
export const planLoadSchema = z.object({ plan: planSchema.nullable(), can_manage: z.boolean(), instructions: z.array(z.object({ text: z.string(), check: z.string().optional() })) });
const eventSchema = z.object({ id: uuid, outcome: z.enum(["done", "review", "retry"]), actor_name: z.string(), note: z.string(), value: z.number().nullable(), source_id: uuid.nullable(), source_type: z.string().nullable(), recorded_at: z.string() });
export const runViewSchema = z.object({ task_id: uuid, task_status: z.string(), can_start: z.boolean(), verification_history: z.array(z.object({ decision: z.enum(["verified", "returned"]), actor_name: z.string(), note: z.string(), evidence_revision: revision, recorded_at: z.string() })).max(10), run: z.object({ id: uuid, task_id: uuid, performer_id: uuid, performer_name: z.string(), status: z.enum(["active", "review", "completed", "superseded"]), revision, attempt: revision, elevated: z.boolean(), required_role: z.string().nullable(), verification_current: z.boolean(), verified_by: uuid.nullable(), verified_by_name: z.string().nullable(), verification_note: z.string().nullable() }).nullable(), steps: z.array(z.object({ step_no: stepNo, kind: z.enum(["check", "measurement", "transaction"]), min: z.number().optional(), max: z.number().optional(), unit: z.string().optional(), source_type: z.string().optional(), states: z.array(z.string()).optional(), evidence: eventSchema.nullable(), valid: z.boolean(), current_source_state: z.string().nullable(), options: z.array(z.object({ id: uuid, label: z.string() })).default([]) })), next_step: stepNo.nullable() });
export type RunView = z.infer<typeof runViewSchema>;
export type PlanLoad = z.infer<typeof planLoadSchema>;
export const queueSchema = z.object({ rows: z.array(z.object({ id: uuid, task_id: uuid, title: z.string(), performer_name: z.string(), required_role: z.string(), submitted_at: z.string() })).max(10), total_count: z.number().int() });

export const assuranceCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("policy.load"), task_id: uuid }).strict(),
  z.object({ command: z.literal("policy.save"), task_kind: z.string().regex(/^(type:[a-z0-9_]{1,40}|handoff:(production|quality|packaging|dispatch))$/), permitted_work: note, prohibited_work: note, reconcile_role: z.enum(["factory_manager", "production_manager", "quality", "dispatch_manager", "inventory_manager", "accounts"]), expected_revision: revision.optional() }).strict(),
  z.object({ command: z.literal("recovery.record"), id: uuid, task_id: uuid, reference: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9/-]{2,39}$/), observation: z.string().trim().min(3).max(1000), observed_at: z.string().datetime({ offset: true }) }).strict(),
  z.object({ command: z.literal("recovery.decide"), id: uuid, decision: z.enum(["reconcile", "reject"]), note, source_type: z.enum(SOURCE_TYPES).optional(), source_id: uuid.optional() }).strict(),
  z.object({ command: z.literal("recovery.list"), task_id: uuid.optional(), page: z.number().int().min(1).max(100000).default(1) }).strict(),
  z.object({ command: z.literal("trial.list"), task_id: uuid.optional(), page: z.number().int().min(1).max(100000).default(1) }).strict(),
  z.object({ command: z.literal("trial.start"), id: uuid, task_id: uuid }).strict(),
  z.object({ command: z.literal("trial.submit"), id: uuid, expected_revision: revision, findings: z.array(z.object({ step_no: stepNo, result: z.enum(["followed", "unclear", "workaround", "blocked"]), note }).strict()).min(1).max(30), employee_feedback: z.string().trim().min(3).max(1000) }).strict(),
  z.object({ command: z.literal("trial.review"), id: uuid, expected_revision: revision, decision: z.enum(["retain", "revise", "training"]), note }).strict()
]);
export const continuityPolicySchema = z.object({ task_kind: z.string(), permitted_work: z.string(), prohibited_work: z.string(), reconcile_role: z.string(), revision });
export const recoveryNoteSchema = z.object({ id: uuid, task_id: uuid, reference: z.string(), observation: z.string(), observed_at: z.string(), status: z.enum(["pending", "reconciled", "rejected"]), recorded_by: uuid, recorded_by_name: z.string(), policy_snapshot: continuityPolicySchema, decision_note: z.string().nullable(), decided_by_name: z.string().nullable(), source_type: z.string().nullable(), source_id: uuid.nullable() });
export const trialSchema = z.object({ id: uuid, task_id: uuid, version_id: uuid, observer_id: uuid, observer_name: z.string(), employee_name: z.string(), employee_id: uuid, revision, status: z.enum(["observing", "submitted", "reviewed"]), findings: z.array(z.object({ step_no: stepNo, result: z.string(), note: z.string() })).nullable(), employee_feedback: z.string().nullable(), decision: z.string().nullable(), decision_note: z.string().nullable(), improvement_id: uuid.nullable().optional(), procedure_id: uuid.optional(), can_review: z.boolean().default(false) });
export const recoveryListSchema = z.object({ rows: z.array(recoveryNoteSchema).max(10), total_count: z.number().int() });
export const trialsListSchema = z.object({ rows: z.array(trialSchema).max(10), total_count: z.number().int() });
export type RecoveryNote = z.infer<typeof recoveryNoteSchema>;
export type ObservedTrial = z.infer<typeof trialSchema>;
