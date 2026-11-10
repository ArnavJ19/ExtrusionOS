// Autopilot batch 2 (press floor capture): command schemas for public.ap_press, ap_scrap, ap_dies, ap_pm and ap_sampling,
// labels, and the station's offline tap queue. The database re-checks every command and takes the company and the actor
// from the session; these schemas only refuse malformed input early.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month");
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value), `${label}: remove control characters`);
const num = (min: number, max: number) => z.number().finite().min(min).max(max);

export const IDLE_REASONS = [
  { value: "die_change", label: "Die change" },
  { value: "billet_shortage", label: "Billet shortage" },
  { value: "power", label: "Power" },
  { value: "breakdown", label: "Breakdown" },
  { value: "waiting_qc", label: "Waiting for QC" },
  { value: "no_operator", label: "No operator" },
  { value: "other", label: "Other" }
] as const;
export type IdleReason = (typeof IDLE_REASONS)[number]["value"];
export const IDLE_REASON_KEYS = IDLE_REASONS.map(reason => reason.value) as [IdleReason, ...IdleReason[]];
export const idleReasonLabel = (value: string | null | undefined) => IDLE_REASONS.find(reason => reason.value === value)?.label ?? "Unexplained";

export const REJECT_REASONS = [
  { value: "die_lines", label: "Die lines" },
  { value: "dimension", label: "Dimension" },
  { value: "surface", label: "Surface" },
  { value: "bend_twist", label: "Bend / twist" },
  { value: "short_length", label: "Short length" },
  { value: "handling", label: "Handling damage" },
  { value: "other", label: "Other" }
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number]["value"];
export const REJECT_REASON_KEYS = REJECT_REASONS.map(reason => reason.value) as [RejectReason, ...RejectReason[]];

export const SAMPLING_KINDS = {
  first_after_die_change: "First piece after a die change",
  every_n_pushes: "Every N pushes",
  every_n_bundles: "Every N bundles (from expected pieces)",
  last_piece: "Last piece of the job"
} as const;
export type SamplingKind = keyof typeof SAMPLING_KINDS;

export const PM_ASSETS = { press: "Press", puller: "Puller", saw: "Saw", container: "Container", billet_heater: "Billet heater", stretcher: "Stretcher", other: "Other" } as const;
export type PmAsset = keyof typeof PM_ASSETS;

export const pressCommands = {
  station: z.object({ session_id: uuid, job_id: uuid.optional() }).strict(),
  push: z.object({ id: uuid, session_id: uuid, job_id: uuid, client_at: z.string().datetime({ offset: true }).optional() }).strict(),
  undo: z.object({ session_id: uuid, push_id: uuid }).strict(),
  void: z.object({ push_id: uuid, reason: text(8, 300, "Reason") }).strict(),
  backfill: z.object({ job_id: uuid, count: z.number().int().min(1).max(50), reason: text(8, 300, "Reason") }).strict(),
  idle_answer: z.union([
    z.object({ session_id: uuid, reason: z.enum(IDLE_REASON_KEYS), note: text(3, 300, "Note").optional() }).strict(),
    z.object({ interval_id: uuid, reason: z.enum(IDLE_REASON_KEYS), note: text(3, 300, "Note").optional() }).strict()
  ]),
  job: z.object({ job_id: uuid }).strict(),
  expected: z.object({ job_id: uuid }).strict(),
  cycle_times: z.object({ die_id: uuid }).strict(),
  floor: z.object({}).strict(),
  downtime: z.object({ from: day.optional(), to: day.optional(), machine_id: uuid.optional(), page }).strict(),
  die_changes: z.object({ weeks: z.number().int().min(1).max(26).optional(), machine_id: uuid.optional(), page }).strict(),
  die_change_correct: z.object({ id: uuid, duration_minutes: num(0, 1440).optional(), note: text(3, 300, "Note") }).strict(),
  settings: z.object({}).strict(),
  settings_save: z.object({ machine_id: uuid, idle_gap_minutes: z.number().int().min(2).max(240), die_change_allowance_minutes: z.number().int().min(0).max(480) }).strict()
};

export const scrapCommands = {
  list: z.object({ page, status: z.enum(["proposed", "approved", "retired"]).optional() }).strict(),
  propose: z.object({
    machine_id: uuid.optional(), die_id: uuid.optional(), butt_length_mm: num(0.1, 200), front_crop_mm: num(0, 5000), back_crop_mm: num(0, 5000), saw_kerf_mm: num(0, 20),
    density_kg_m3: num(2500, 2900).optional(), default_billet_length_mm: num(100, 2000).optional(), rationale: text(5, 500, "Rationale")
  }).strict().refine(value => !(value.machine_id && value.die_id), { message: "A standard applies to one press or one die, not both.", path: ["die_id"] }),
  approve: z.object({ id: uuid }).strict(),
  retire: z.object({ id: uuid }).strict(),
  reconcile: z.object({ month }).strict(),
  weigh: z.object({ month, weighed_kg: num(0.001, 100000000), reference: text(1, 80, "Reference").optional() }).strict()
};

export const dieCommands = {
  service: z.object({ die_id: uuid }).strict(),
  flags: z.object({ page }).strict(),
  options: z.object({ profile_id: uuid.optional(), page }).strict(),
  booking_close: z.object({ id: uuid, status: z.enum(["done", "cancelled"]), note: text(3, 300, "Note"),
    correction_reason: z.enum(["die_lines", "dimensional", "surface_pickup", "slow_speed", "bearing_issue", "tongue_ratio", "other"]).optional() }).strict()
};

export const pmCommands = {
  plans: z.object({ page, machine_id: uuid.optional(), status: z.enum(["active", "retired"]).optional() }).strict(),
  save: z.object({ machine_id: uuid, asset_kind: z.enum(Object.keys(PM_ASSETS) as [PmAsset, ...PmAsset[]]), asset_label: text(2, 80, "Asset name").optional(),
    task: text(3, 120, "Task"), basis: z.enum(["running_hours", "pushes"]), interval_value: num(0.01, 1000000), window_hours: num(0.25, 72).optional(), safety_critical: z.boolean() }).strict(),
  retire: z.object({ id: uuid }).strict(),
  complete: z.object({ plan_id: uuid, note: text(3, 300, "Note") }).strict(),
  compliance: z.object({}).strict()
};

export const samplingCommands = {
  plans: z.object({ page }).strict(),
  triggers: z.object({ plan_id: uuid }).strict(),
  trigger_save: z.object({ plan_id: uuid, kind: z.enum(Object.keys(SAMPLING_KINDS) as [SamplingKind, ...SamplingKind[]]), every_n: z.number().int().min(1).max(10000).optional(),
    item_ids: z.array(uuid).max(50).optional(), blocks_release: z.boolean() }).strict()
    .refine(value => !["every_n_pushes", "every_n_bundles"].includes(value.kind) || value.every_n, { message: "Say every how many.", path: ["every_n"] }),
  trigger_retire: z.object({ id: uuid }).strict(),
  samples: z.object({ status: z.enum(["due", "open", "missed", "recorded", "waived", "all"]).optional(), page, job_id: uuid.optional() }).strict(),
  sample: z.object({ id: uuid }).strict(),
  sample_record: z.object({ id: uuid, results: z.array(z.object({ item_id: uuid, observed: z.number().finite().optional(), visual_ok: z.boolean().optional() }).strict()
    .refine(value => (value.observed === undefined) !== (value.visual_ok === undefined), "Give a measured value or a visual result")).min(1).max(50) }).strict(),
  sample_waive: z.object({ id: uuid, reason: text(8, 300, "Reason") }).strict(),
  queue: z.object({ limit: z.number().int().min(1).max(20).optional() }).strict()
};

// ---------------------------------------------------------------------------------------------------------------
// Station tap queue (AP-011 offline tolerance). A tap that cannot reach the server is kept on this device with its own
// id and the time it was made; the server ignores a repeated id, so replaying the queue never double-counts.
// ---------------------------------------------------------------------------------------------------------------
export type QueuedTap = { id: string; session_id: string; job_id: string; client_at: string };
export const tapQueueKey = (companyId: string, userId: string) => `eos:press-taps:${uuid.parse(companyId)}:${uuid.parse(userId)}`;
const queuedTapSchema = z.array(z.object({ id: uuid, session_id: uuid, job_id: uuid, client_at: z.string().datetime({ offset: true }) }).strict()).max(200);

export function readTapQueue(raw: string | null): QueuedTap[] {
  if (!raw) return [];
  try { const parsed = queuedTapSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : []; } catch { return []; }
}
export function enqueueTap(queue: QueuedTap[], tap: QueuedTap): QueuedTap[] {
  return queue.some(item => item.id === tap.id) ? queue : [...queue, tap].slice(-200);
}
/** Taps older than 15 minutes still send, but the server then records them at arrival time (cycle times stay honest). */
export function tapIsStale(tap: QueuedTap, now = Date.now()) { return now - Date.parse(tap.client_at) > 15 * 60 * 1000; }

export function formatMinutes(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const whole = Math.round(minutes);
  return whole >= 60 ? `${Math.floor(whole / 60)} h ${whole % 60} min` : `${whole} min`;
}
export function percent(part: number | null | undefined, whole: number | null | undefined) {
  if (part == null || whole == null || !Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round(part * 1000 / whole) / 10;
}
