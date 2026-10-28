// UPGRADE_EOS feature 77 (controlled SOP versions and effective dates). The database owns version
// numbering, review, release, effective dates and task bindings; this module validates commands
// and responses and explains versions in plain words.
import { z } from "zod";

export const KIND_MANAGERS = ["owner", "admin", "factory_manager"] as const;
export const canMapTaskKinds = (role: string) => (KIND_MANAGERS as readonly string[]).includes(role);
export const TASK_KIND_PATTERN = /^(handoff:(packaging|quality|dispatch|production)|type:[a-z0-9_]{1,40})$/;
export const IN_FLIGHT_POLICIES = {
  keep_current: "Tasks already given an earlier version keep it",
  move_unstarted: "Tasks not yet started move to this version; started work keeps its own"
} as const;
export type InFlightPolicy = keyof typeof IN_FLIGHT_POLICIES;
export const VERSION_STATUS = { draft: "Draft", in_review: "In review", released: "Released", withdrawn: "Withdrawn" } as const;

const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{32}$/);
export const stepSchema = z.object({
  text: z.string().trim().min(3, "Each step needs an instruction of 3 to 300 characters").max(300, "Each step needs an instruction of 3 to 300 characters"),
  check: z.string().trim().max(200, "Keep each key check under 200 characters").optional()
}).strict();
const steps = z.array(stepSchema).min(1, "Write between 1 and 30 steps").max(30, "Write between 1 and 30 steps");
const summary = z.string().trim().min(3, "Summarise what this version changes (3 to 500 characters)").max(500, "Summarise what this version changes (3 to 500 characters)");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an effective date");

export const procedureVersionCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("versions.list"), procedure_id: uuid, page: z.number().int().min(1).max(100000).default(1) }).strict(),
  z.object({ command: z.literal("version.load"), version_id: uuid }).strict(),
  z.object({ command: z.literal("draft.save"), procedure_id: uuid, version_id: uuid, steps, change_summary: summary, expected_hash: hash.nullable() }).strict(),
  z.object({ command: z.literal("draft.submit"), version_id: uuid, expected_hash: hash }).strict(),
  z.object({ command: z.literal("draft.discard"), version_id: uuid, expected_hash: hash }).strict(),
  z.object({ command: z.literal("review.return"), version_id: uuid, expected_hash: hash, note: z.string().trim().min(3, "Explain what must change (3 to 500 characters)").max(500) }).strict(),
  z.object({ command: z.literal("review.release"), version_id: uuid, expected_hash: hash, effective_from: isoDate, in_flight_policy: z.enum(["keep_current", "move_unstarted"]), note: z.string().trim().max(500).default("") }).strict(),
  z.object({ command: z.literal("release.withdraw"), version_id: uuid, reason: z.string().trim().min(3, "Record why the release is withdrawn (3 to 300 characters)").max(300) }).strict(),
  z.object({ command: z.literal("kinds.list") }).strict(),
  z.object({ command: z.literal("kinds.set"), task_kind: z.string().regex(TASK_KIND_PATTERN, "Choose the kind of task the procedure applies to"), procedure_id: uuid.nullable() }).strict(),
  z.object({ command: z.literal("task.instructions"), task_id: uuid }).strict(),
  z.object({ command: z.literal("sync") }).strict()
]);
export type ProcedureVersionCommand = z.infer<typeof procedureVersionCommandSchema>;

const versionBase = z.object({
  id: uuid, procedure_id: uuid, version_no: z.number().int().positive(), status: z.enum(["draft", "in_review", "released", "withdrawn"]), change_summary: z.string(),
  content_hash: hash, author_id: uuid, author_name: z.string(), updated_at: z.string(), submitted_at: z.string().nullable(), reviewer_name: z.string().nullable(),
  review_note: z.string().nullable(), released_at: z.string().nullable(), effective_from: z.string().nullable(), in_flight_policy: z.enum(["keep_current", "move_unstarted"]).nullable(),
  withdrawn_at: z.string().nullable(), withdraw_reason: z.string().nullable(), step_count: z.number().int(), tasks_changed: z.number().int().optional()
}).strict();
export const versionSummarySchema = versionBase;
export const versionSchema = versionBase.extend({ steps: z.array(z.object({ text: z.string(), check: z.string().optional() }).strict()) }).strict();
export type ProcedureVersion = z.infer<typeof versionSchema>;
export type ProcedureVersionSummary = z.infer<typeof versionSummarySchema>;

export const versionsListSchema = z.object({
  procedure: z.object({ id: uuid, title: z.string(), owner_id: uuid, owner_name: z.string(), backup_id: uuid.nullable(), backup_name: z.string().nullable(), is_active: z.boolean() }).strict(),
  current: versionSchema.nullable(), scheduled: z.array(versionSummarySchema), open: versionSchema.nullable(), task_kinds: z.array(z.string()),
  can_author: z.boolean(), can_review: z.boolean(), rows: z.array(versionSummarySchema).max(10), total_count: z.number().int().nonnegative()
}).strict();
export type VersionsList = z.infer<typeof versionsListSchema>;

export const kindsListSchema = z.array(z.object({ task_kind: z.string(), procedure_id: uuid, procedure_title: z.string(), current_version: z.number().int().nullable() }).strict());

export const taskInstructionsSchema = z.union([
  z.object({ bound: z.literal(false), procedure_id: uuid.nullable(), reason: z.enum(["not_mapped", "started_before_procedure", "no_released_version", "not_synchronised"]) }).strict(),
  z.object({
    bound: z.literal(true), procedure_id: uuid, procedure_title: z.string(), owner_name: z.string(), backup_name: z.string().nullable(), version: versionSchema,
    bound_reason: z.enum(["task_created", "kind_mapped", "release_moved_unstarted"]), started_at: z.string().nullable(), frozen_at: z.string().nullable(),
    newer_version_no: z.number().int().nullable(),
    history: z.array(z.object({ event: z.enum(["bound", "moved", "started", "completed", "reopened"]), version_no: z.number().int(), from_version_no: z.number().int().nullable(), recorded_at: z.string() }).strict())
  }).strict()
]);
export type TaskInstructions = z.infer<typeof taskInstructionsSchema>;

/** Splits the editor's one-step-per-line text ("instruction | key check") into steps. */
export function parseStepLines(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [instruction, ...rest] = line.split("|");
    const check = rest.join("|").trim();
    return check ? { text: instruction.trim(), check } : { text: instruction.trim() };
  });
}
export const stepLines = (value: { text: string; check?: string }[]) => value.map((s) => (s.check ? `${s.text} | ${s.check}` : s.text)).join("\n");

/** Plain-language status of a version on a given IST date (YYYY-MM-DD). */
export function describeVersion(v: Pick<ProcedureVersionSummary, "status" | "effective_from" | "version_no">, today: string, currentVersionNo: number | null) {
  if (v.status === "draft") return "Draft: not used by any task";
  if (v.status === "in_review") return "Waiting for review";
  if (v.status === "withdrawn") return "Withdrawn: never used for new work";
  if (v.effective_from && v.effective_from > today) return `Scheduled: takes effect on ${v.effective_from}`;
  return v.version_no === currentVersionNo ? "In effect" : "Superseded: kept for tasks that used it";
}

export function describeUnbound(reason: Extract<TaskInstructions, { bound: false }>["reason"]) {
  return {
    not_mapped: "No operating procedure is set for this kind of task.",
    started_before_procedure: "This task started before its procedure applied, so no version is recorded for it.",
    no_released_version: "The procedure for this task has no released version yet.",
    not_synchronised: "A procedure version applies; a manager can apply releases from the procedure page."
  }[reason];
}

/** Which version-moving review command an employee may see for a version. */
export function reviewActions(v: Pick<ProcedureVersion, "status" | "author_id">, viewerId: string, canReview: boolean) {
  if (!canReview || v.status !== "in_review") return { release: false, returnToDraft: false, selfAuthored: false };
  const selfAuthored = v.author_id === viewerId;
  return { release: !selfAuthored, returnToDraft: !selfAuthored, selfAuthored };
}
