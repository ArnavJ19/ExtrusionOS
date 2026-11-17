// Autopilot batch 10: command schemas for the database gateways public.ap_energy (AP-021), ap_crew (AP-022),
// ap_equivalents (AP-049), ap_stock_runs (AP-068), ap_coating (AP-055), ap_cut_combine (AP-067), ap_systems_order (AP-070)
// and ap_undo (AP-093). The database re-checks every command and takes the company and the actor from the session; these
// schemas only refuse malformed input early.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const search = z.string().trim().max(80).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const clean = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`).refine(clean, `${label}: remove control characters`);
const num = (min: number, max: number, label: string) => z.number({ invalid_type_error: `${label}: enter a number` }).finite().min(min, `${label}: at least ${min}`).max(max, `${label}: at most ${max}`);

// ---- AP-021 energy from shift meter readings
export const ENERGY_ROLES = ["owner", "admin", "factory_manager", "production_manager", "production", "accounts"] as const;
export const ENERGY_WRITERS = ["owner", "admin", "factory_manager", "production_manager", "production"] as const;
export const energyCommands = {
  shifts: z.object({ day: day.optional() }).strict(),
  save: z.object({ machine_id: uuid, shift_day: day, shift_name: text(1, 40, "Shift"), opening_kwh: num(0, 999999999, "Opening reading").optional(),
    closing_kwh: num(0, 999999999, "Closing reading").optional(), note: text(3, 300, "Note").optional() }).strict()
    .refine(v => v.opening_kwh !== undefined || v.closing_kwh !== undefined, { message: "Enter a meter reading", path: ["opening_kwh"] })
    .refine(v => v.opening_kwh === undefined || v.closing_kwh === undefined || v.closing_kwh >= v.opening_kwh, { message: "The closing reading cannot be below the opening reading", path: ["closing_kwh"] }),
  allocation: z.object({ day: day.optional() }).strict(),
  monthly: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "Choose a month").optional() }).strict(),
  job: z.object({ job_id: uuid }).strict(),
  list: z.object({ page, machine_id: uuid.optional(), state: z.enum(["all", "open", "closed"]).optional() }).strict()
};

// ---- AP-022 crew from station sign-ins
export const CREW_ROLES = ["owner", "admin", "factory_manager", "production_manager", "production", "quality"] as const;
export const CREW_LEADS = ["owner", "admin", "factory_manager", "production_manager"] as const;
export const CREW_WORK = { operator: "Press operator", helper: "Helper", puller: "Puller", stretcher: "Stretcher", saw: "Saw", supervisor: "Supervisor" } as const;
export type CrewWork = keyof typeof CREW_WORK;
const crewWork = z.enum(Object.keys(CREW_WORK) as [CrewWork, ...CrewWork[]]);
export const crewCommands = {
  station: z.object({ machine_id: uuid }).strict(),
  sign_in: z.object({ machine_id: uuid, crew_role: crewWork }).strict(),
  add: z.object({ machine_id: uuid, user_id: uuid, crew_role: crewWork }).strict(),
  sign_out: z.object({ id: uuid.optional() }).strict(),
  people: z.object({ search }).strict(),
  shift: z.object({ day: day.optional() }).strict(),
  job: z.object({ job_id: uuid }).strict()
};

// ---- AP-049 equivalent profiles
export const EQUIVALENT_ROLES = ["owner", "admin", "sales_manager", "sales", "quality", "production_manager", "factory_manager", "inventory_manager"] as const;
export const EQUIVALENT_APPROVERS = ["owner", "admin", "quality", "production_manager", "factory_manager"] as const;
export const CONSENT_RECORDERS = ["owner", "admin", "sales_manager", "sales"] as const;
export const EQUIVALENT_BASIS = { same_section: "Same section, different code", customer_approved: "Alternative approved by the customer" } as const;
export const CONSENT_CHANNELS = { whatsapp: "WhatsApp", phone: "Phone call", email: "Email", in_person: "In person", written: "Written order" } as const;
type Channel = keyof typeof CONSENT_CHANNELS;
export const equivalentCommands = {
  profile: z.object({ profile_id: uuid }).strict(),
  propose: z.object({ profile_id: uuid, equivalent_profile_id: uuid, basis: z.enum(["same_section", "customer_approved"]), customer_id: uuid.optional(), note: text(3, 300, "Note").optional() }).strict()
    .refine(v => v.profile_id !== v.equivalent_profile_id, { message: "Choose a different profile as the equivalent", path: ["equivalent_profile_id"] })
    .refine(v => (v.basis === "customer_approved") === Boolean(v.customer_id), { message: "A customer-approved alternative names the customer", path: ["customer_id"] }),
  approve: z.object({ id: uuid }).strict(),
  retire: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict(),
  order: z.object({ order_id: uuid }).strict(),
  shortages: z.object({ page }).strict(),
  consent: z.object({ order_item_id: uuid, equivalence_id: uuid, consent_by_name: text(2, 80, "Person who agreed"), consent_channel: z.enum(Object.keys(CONSENT_CHANNELS) as [Channel, ...Channel[]]),
    consent_reference: text(1, 120, "Reference").optional(), consented_on: day, note: text(3, 300, "Note").optional() }).strict(),
  withdraw_consent: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict()
};

// ---- AP-068 make-to-stock runs for idle capacity
export const STOCK_RUN_ROLES = ["owner", "admin", "factory_manager", "production_manager", "sales_manager", "inventory_manager"] as const;
export const STOCK_RUN_DECIDERS = ["owner", "admin", "factory_manager", "production_manager"] as const;
export const stockRunCommands = {
  idle: z.object({}).strict(),
  targets: z.object({ page, search }).strict(),
  fast_movers: z.object({ page }).strict(),
  save_target: z.object({ profile_id: uuid, finish: z.string().regex(/^[a-z_]{2,40}$/, "Choose the finish").optional(), piece_length_m: num(0.1, 100, "Piece length"), target_kg: num(1, 10000000, "Target stock"),
    max_kg: num(1, 10000000, "Holding limit").optional(), note: text(3, 300, "Note").optional() }).strict()
    .refine(v => v.max_kg === undefined || v.max_kg >= v.target_kg, { message: "The holding limit cannot be below the target stock", path: ["max_kg"] }),
  retire_target: z.object({ id: uuid }).strict(),
  suggest: z.object({}).strict(),
  list: z.object({ page, status: z.enum(["suggested", "approved", "dismissed", "expired", "all"]).optional() }).strict(),
  approve: z.object({ id: uuid, note: text(3, 300, "Note").optional() }).strict(),
  dismiss: z.object({ id: uuid, note: text(3, 300, "Reason") }).strict()
};

// ---- AP-055 powder coating runs by shade
export const COATING_ROLES = ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "dispatch_manager"] as const;
export const COATING_LEADS = ["owner", "admin", "factory_manager", "production_manager"] as const;
export const coatingCommands = {
  queue: z.object({}).strict(),
  save_settings: z.object({ capacity_kg_per_hour: num(1, 100000, "Line capacity"), changeover_minutes: z.number().int().min(0).max(480), day_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the start time as HH:MM").optional(),
    hours_per_day: num(1, 24, "Hours per day").optional(), include_vendor_jobs: z.boolean().optional() }).strict(),
  set_brand: z.object({ finishing_job_id: uuid, powder_brand: text(2, 60, "Powder brand") }).strict(),
  runs: z.object({ page }).strict()
};
/** What lib/actions/autopilot-batch10 sends to public.ap_coating("confirm") after it sequenced the queue itself. */
export const coatingConfirmSchema = z.object({ run_day: day, order: z.array(z.string().min(1).max(160)).max(200).optional(), fingerprint: z.string().regex(/^[a-f0-9]{32}$/), breach_note: text(5, 300, "Reason").optional() }).strict();

// ---- AP-067 combined cut lengths
export const CUT_ROLES = ["owner", "admin", "factory_manager", "production_manager", "production"] as const;
export const CUT_PLANNERS = ["owner", "admin", "factory_manager", "production_manager"] as const;
export const cutCombineCommands = {
  candidates: z.object({ page }).strict(),
  inputs: z.object({ die_id: uuid, job_ids: z.array(uuid).max(20).optional(), machine_id: uuid.optional() }).strict(),
  accept: z.object({ id: uuid, note: text(3, 300, "Note").optional() }).strict(),
  cancel: z.object({ id: uuid, note: text(3, 300, "Reason") }).strict(),
  get: z.object({ id: uuid }).strict(),
  job: z.object({ job_id: uuid }).strict(),
  list: z.object({ page, status: z.enum(["proposed", "accepted", "superseded", "cancelled", "all"]).optional() }).strict()
};
export const cutPrepareSchema = z.object({ die_id: uuid, job_ids: z.array(uuid).min(2, "Choose at least two jobs of the die").max(20), machine_id: uuid.optional(),
  billet_mm: num(50, 3000, "Billet length").optional(), fingerprint: z.string().regex(/^[a-f0-9]{32}$/) }).strict();

// ---- AP-070 configurator project to order
export const SYSTEM_ORDER_ROLES = ["owner", "admin", "sales_manager", "sales"] as const;
export const systemsOrderCommands = {
  settings: z.object({}).strict(),
  save_settings: z.object({ enabled: z.boolean(), note: text(3, 300, "Note").optional() }).strict(),
  status: z.object({ configuration_id: uuid }).strict()
};

// ---- AP-093 undo
export const UNDO_KINDS = ["task.status", "saved_view.delete", "saved_view.default", "notification.read"] as const;
export const undoCommands = {
  record: z.object({ kind: z.enum(UNDO_KINDS), target: z.string().min(1).max(80) }).strict(),
  notification_unread: z.object({ id: uuid }).strict(),
  summary: z.object({}).strict()
};

export const BATCH10_READS = ["shifts", "allocation", "monthly", "job", "list", "station", "people", "shift", "profile", "order", "shortages", "idle", "targets", "fast_movers", "queue", "runs",
  "candidates", "inputs", "get", "settings", "status", "summary"] as const;
