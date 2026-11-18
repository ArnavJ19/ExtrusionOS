// Autopilot batch 8: command schemas for the database gateways public.ap_views (AP-092), ap_die_window (AP-065),
// ap_capacity (AP-069), ap_customer_health (AP-050), ap_spc (AP-052) and ap_mtc (AP-020). The database re-checks every
// command and takes the company and the actor from the session; these schemas only refuse malformed input early.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const search = z.string().trim().max(80).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const clean = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`).refine(clean, `${label}: remove control characters`);
const weeks = z.number().int().min(2).max(16).optional();

/** URL query of a saved view: what URLSearchParams.toString() produces, without the leading "?". */
export const SAVED_VIEW_QUERY = /^[A-Za-z0-9_.~%&=+-]*$/;
export const pageKey = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, "Unknown list page");
export const viewCommands = {
  list: z.object({ page_key: pageKey }).strict(),
  default: z.object({ page_key: pageKey }).strict(),
  save: z.object({ page_key: pageKey, name: text(1, 60, "View name"), query: z.string().max(1500).regex(SAVED_VIEW_QUERY, "This view cannot be saved"), make_default: z.boolean().optional() }).strict(),
  set_default: z.object({ id: uuid }).strict(),
  clear_default: z.object({ page_key: pageKey }).strict(),
  delete: z.object({ id: uuid }).strict()
};

export const DIE_AWAY_REASONS = { nitriding: "Nitriding", correction: "Correction", maintenance: "Maintenance", at_vendor: "With a vendor", trial: "Trial", other: "Other" } as const;
export const DIE_WINDOW_EDITORS = ["owner", "admin", "factory_manager", "production_manager", "quality"] as const;
export const dieWindowCommands = {
  die: z.object({ die_id: uuid }).strict(),
  set: z.object({ die_id: uuid, reason: z.enum(Object.keys(DIE_AWAY_REASONS) as [keyof typeof DIE_AWAY_REASONS, ...(keyof typeof DIE_AWAY_REASONS)[]]), starts_on: day,
    expected_return: day.optional(), note: text(3, 300, "Note").optional() }).strict(),
  close: z.object({ id: uuid, note: text(3, 300, "Note"), outcome: z.enum(["closed", "cancelled"]).optional() }).strict(),
  conflicts: z.object({ page, days: z.number().int().min(1).max(60).optional() }).strict(),
  jobs: z.object({ job_ids: z.array(uuid).max(200) }).strict(),
  away: z.object({ page }).strict()
};

export const CAPACITY_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "factory_manager"] as const;
export const capacityCommands = {
  profile: z.object({ profile_id: uuid.optional(), quantity_kg: z.number().finite().min(0).max(10000000).optional(), finishing_type: text(2, 40, "Finish").optional(), weeks }).strict(),
  quote: z.object({ quote_id: uuid, weeks }).strict(),
  record: z.object({ quote_id: uuid, profile_id: uuid.optional(), used: z.boolean().optional(), weeks }).strict(),
  accuracy: z.object({ page, weeks }).strict()
};

export const HEALTH_ROLES = ["owner", "admin", "sales_manager", "sales"] as const;
export const HEALTH_BANDS = { at_risk: "At risk", watch: "Watch", healthy: "Healthy" } as const;
export const FOLLOW_UP_OUTCOMES = { called: "Called", visited: "Visited", messaged: "Messaged", not_reachable: "Not reachable", no_action_needed: "No action needed" } as const;
export const customerHealthCommands = {
  at_risk: z.object({ page, band: z.enum(["at_risk", "watch", "healthy", "all"]).optional(), search }).strict(),
  customer: z.object({ customer_id: uuid }).strict(),
  follow_up: z.object({ customer_id: uuid, outcome: z.enum(Object.keys(FOLLOW_UP_OUTCOMES) as [keyof typeof FOLLOW_UP_OUTCOMES, ...(keyof typeof FOLLOW_UP_OUTCOMES)[]]), note: text(5, 300, "Note") }).strict(),
  score_now: z.object({}).strict()
};

export const SPC_READERS = ["owner", "admin", "quality", "production_manager", "factory_manager"] as const;
export const SPC_REVIEWERS = ["owner", "admin", "quality"] as const;
export const SPC_OUTCOMES = { process_adjusted: "Process adjusted", die_sent_for_correction: "Die sent for correction", measurement_error: "Measurement error", no_action_needed: "No action needed" } as const;
export const SPC_RULES = { outside_limits: "Reading outside the plan limits", run_of_seven: "Seven readings in a row on one side of the centre" } as const;
export const spcCommands = {
  charts: z.object({ page, search, state: z.enum(["all", "alarm"]).optional(), die_id: uuid.optional() }).strict(),
  chart: z.object({ item_id: uuid, subgroup: z.string().regex(/^(die:([0-9a-f-]{36}|none)|finish:[a-z_]{2,40})$/) }).strict(),
  alarms: z.object({ page, status: z.enum(["open", "reviewed"]).optional() }).strict(),
  review: z.object({ id: uuid, outcome: z.enum(Object.keys(SPC_OUTCOMES) as [keyof typeof SPC_OUTCOMES, ...(keyof typeof SPC_OUTCOMES)[]]), note: text(5, 300, "Review note") }).strict(),
  check: z.object({}).strict()
};

export const MTC_READERS = ["owner", "admin", "quality", "factory_manager", "production_manager", "inventory_manager", "accounts"] as const;
export const MTC_UPLOADERS = ["owner", "admin", "quality", "factory_manager", "inventory_manager"] as const;
export const MTC_CONFIRMERS = ["owner", "admin", "quality"] as const;
export const MTC_FIELDS = ["heat_number", "alloy", "si", "fe", "cu", "mn", "mg", "zn", "ti"] as const;
export type MtcField = (typeof MTC_FIELDS)[number];
const percent = z.union([z.number().finite().min(0).max(100), z.null()]).optional();
const extractedField = z.object({ value: z.union([z.string().max(60), z.number().finite(), z.null()]), confidence: z.enum(["high", "medium", "low"]).nullable(), source: z.string().max(160).nullable().optional() }).strict();
export const mtcCommands = {
  get: z.object({ id: uuid }).strict(),
  confirm: z.object({ id: uuid, heat_number: text(2, 40, "Heat number"), alloy: z.string().trim().toUpperCase().regex(/^[0-9]{4}[A-Z]?$/, "Enter the alloy as four digits, such as 6063"),
    si: percent, fe: percent, cu: percent, mn: percent, mg: percent, zn: percent, ti: percent, note: text(3, 300, "Note").optional() }).strict(),
  discard: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict(),
  list: z.object({ page, search, status: z.enum(["all", "draft", "confirmed", "superseded", "discarded"]).optional(), spec: z.enum(["in_spec", "out_of_spec", "incomplete", "unknown_alloy"]).optional() }).strict(),
  line: z.object({ receipt_line_id: uuid }).strict(),
  coverage: z.object({ page }).strict(),
  target: z.object({ receipt_line_id: uuid.optional(), billet_batch_id: uuid.optional() }).strict(),
  template: z.object({ vendor_id: uuid }).strict(),
  save_template: z.object({ vendor_id: uuid, heat_labels: z.array(text(2, 40, "Label")).max(10), alloy_labels: z.array(text(2, 40, "Label")).max(10),
    element_order: z.array(z.enum(["Si", "Fe", "Cu", "Mn", "Mg", "Zn", "Ti", "Cr", "Al", "Others"])).max(10), decimal_comma: z.boolean(), note: text(3, 300, "Note").optional() }).strict()
};
/** The draft is written only by lib/actions/autopilot-batch8 after it read the uploaded file itself. */
export const mtcDraftSchema = z.object({
  receipt_line_id: uuid.optional(), billet_batch_id: uuid.optional(), file_name: text(1, 200, "File name"), storage_path: z.string().min(10).max(400),
  mime_type: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]).optional(), file_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  source_kind: z.enum(["pdf_text", "pdf_no_text", "photo", "pasted_text"]), extracted: z.record(z.enum(MTC_FIELDS), extractedField)
}).strict().refine(v => Boolean(v.receipt_line_id) !== Boolean(v.billet_batch_id), { message: "Choose the received line or the billet batch" });

export const BATCH8_READS = ["list", "default", "die", "conflicts", "jobs", "away", "profile", "quote", "accuracy", "at_risk", "customer", "charts", "chart", "alarms", "get", "line",
  "coverage", "template", "target"] as const;

export const SPEC_RESULT: Record<string, string> = { in_spec: "In specification", out_of_spec: "Out of specification", incomplete: "Values missing", unknown_alloy: "Alloy not recognised" };
export const CERT_STATUS: Record<string, string> = { draft: "To confirm", confirmed: "Confirmed", superseded: "Replaced", discarded: "Discarded" };
