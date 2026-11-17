// Autopilot batch 6: command schemas for the database gateways public.ap_weight (AP-027), ap_reprice (AP-030),
// ap_health (AP-100), ap_reorder (AP-033), ap_ncr (AP-053), ap_tds (AP-077), ap_einvoice (AP-082), ap_billet_length
// (AP-029), ap_offline (AP-094) and ap_press_plan (AP-061). The database re-checks every command and takes the company
// and the actor from the session; these schemas only refuse malformed input early.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const search = z.string().trim().max(80).optional();
const sort = z.enum(["date", "name"]).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const iso = z.string().datetime({ offset: true });
const clean = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`).refine(clean, `${label}: remove control characters`);
const num = (min: number, max: number) => z.number().finite().min(min).max(max);

export const WEIGHT_READERS = ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "sales_manager"] as const;
export const WEIGHT_SETTERS = ["owner", "admin", "quality", "factory_manager"] as const;
export const REPRICE_READERS = ["owner", "admin", "sales_manager", "sales", "accounts"] as const;
export const REPRICE_APPLIERS = ["owner", "admin"] as const;
export const HEALTH_READERS = ["owner", "admin"] as const;
export const REORDER_READERS = ["owner", "admin", "inventory_manager", "factory_manager", "production_manager", "accounts"] as const;
export const REORDER_APPROVERS = ["owner", "admin", "inventory_manager"] as const;
export const NCR_READERS = ["owner", "admin", "quality", "factory_manager", "production_manager"] as const;
export const NCR_DECIDERS = ["owner", "admin", "quality", "factory_manager"] as const;
export const COMPLAINT_LOGGERS = ["owner", "admin", "quality", "factory_manager", "sales_manager", "sales", "dispatch_manager"] as const;
export const FINANCE_ROLES = ["owner", "admin", "accounts"] as const;
export const BILLET_PLANNERS = ["owner", "admin", "factory_manager", "production_manager"] as const;
export const BILLET_READERS = [...BILLET_PLANNERS, "production"] as const;
export const PLAN_READERS = ["owner", "admin", "factory_manager", "production_manager", "production", "viewer"] as const;
export const PLAN_EDITORS = ["owner", "admin", "factory_manager", "production_manager"] as const;

export const weightCommands = {
  die: z.object({ die_id: uuid }).strict(),
  list: z.object({ page, search, sort, show: z.enum(["attention", "all"]).optional() }).strict(),
  settings: z.object({}).strict(),
  save_settings: z.object({ tolerance_percent: num(0.1, 25).optional(), window_bundles: z.number().int().min(3).max(100), min_bundles: z.number().int().min(2).max(50) }).strict()
    .refine(v => v.min_bundles <= v.window_bundles, { message: "The minimum cannot exceed the bundles averaged", path: ["min_bundles"] }),
  prepare: z.object({}).strict()
};

export const repriceCommands = {
  impact: z.object({}).strict(),
  apply: z.object({ fingerprint: z.string().regex(/^[a-f0-9]{32}$/), exclude_quote_ids: z.array(uuid).max(200).optional() }).strict(),
  runs: z.object({ page }).strict(),
  run: z.object({ id: uuid }).strict()
};

export const healthCommands = { overview: z.object({}).strict() };

const reorderSource = z.enum(["inventory_items", "packaging_materials"]);
export const reorderCommands = {
  suggestions: z.object({ page, search, sort, show: z.enum(["attention", "all"]).optional(), kind: z.enum(["all", "inventory", "packaging"]).optional() }).strict(),
  save_lead: z.object({ source: reorderSource, id: uuid, lead_days: z.number().int().min(1).max(365), safety_days: z.number().int().min(0).max(365).optional(), review_days: z.number().int().min(1).max(180).optional() }).strict(),
  approve: z.object({ source: reorderSource, id: uuid, min_level: num(0, 100000000), reorder_qty: num(0.001, 100000000), reason: text(10, 300, "Reason").optional() }).strict(),
  requisitions: z.object({ page, status: z.enum(["open", "ordered", "cancelled", "all"]).optional() }).strict(),
  update_requisition: z.object({ id: uuid, status: z.enum(["ordered", "cancelled"]), reference: text(2, 60, "Purchase order reference").optional(), note: text(3, 300, "Note").optional() }).strict()
    .refine(v => v.status !== "ordered" || v.reference, { message: "Enter the purchase order reference", path: ["reference"] })
    .refine(v => v.status !== "cancelled" || v.note, { message: "Say why it is cancelled", path: ["note"] }),
  prepare: z.object({}).strict()
};

export const ncrCommands = {
  settings: z.object({}).strict(),
  save_settings: z.object({ job_reject_percent: num(0.01, 100).optional(), job_reject_kg: num(0.001, 1000000).optional(), receipt_reject_percent: num(0.01, 100).optional() }).strict(),
  list: z.object({ page, search, sort, status: z.enum(["attention", "draft", "open", "closed", "dismissed", "all"]).optional() }).strict(),
  get: z.object({ id: uuid }).strict(),
  coverage: z.object({}).strict(),
  detect: z.object({}).strict(),
  confirm: z.object({ id: uuid, title: text(5, 160, "Title").optional(), description: text(5, 2000, "Description").optional() }).strict(),
  dismiss: z.object({ id: uuid, reason: text(10, 500, "Reason") }).strict(),
  update: z.object({ id: uuid, cause: text(5, 2000, "Cause").optional(), action: text(5, 2000, "Corrective action").optional(), description: text(5, 2000, "Description").optional() }).strict(),
  close: z.object({ id: uuid }).strict(),
  log_complaint: z.object({ request_id: uuid, customer_id: uuid, order_id: uuid.optional(), dispatch_id: uuid.optional(), description: text(10, 1000, "Complaint") }).strict()
};

const tan = z.string().trim().toUpperCase().regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/, "TAN must look like PNEA12345B");
export const tdsCommands = {
  settings: z.object({}).strict(),
  save_settings: z.object({ sections: z.array(z.string().trim().regex(/^[0-9]{3}[A-Z]{0,2}$/, "Enter sections such as 194Q")).min(1).max(10), default_section: z.string().trim().min(3).max(6),
    default_rate_percent: num(0.001, 30).optional(), basis: z.enum(["taxable", "gross"]), tolerance_inr: num(0, 1000).optional() }).strict()
    .refine(v => v.sections.includes(v.default_section), { message: "The default section must be one of the sections", path: ["default_section"] }),
  customer_tax: z.object({ customer_id: uuid }).strict(),
  save_customer_tax: z.object({ customer_id: uuid, tan: tan.or(z.literal("")).optional(), pan: z.string().trim().toUpperCase().regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, "PAN must look like ABCDE1234F").optional() }).strict(),
  open_invoices: z.object({ customer_id: uuid }).strict(),
  record: z.object({ request_id: uuid, customer_id: uuid, deducted_on: day, section: z.string().trim().min(3).max(6).optional(), certificate_ref: text(3, 60, "Certificate").optional(),
    lines: z.array(z.object({ invoice_id: uuid, amount: num(0.01, 100000000).refine(v => Math.round(v * 100) === v * 100, "Use at most two decimals") }).strict()).min(1).max(50) }).strict()
    .refine(v => new Set(v.lines.map(l => l.invoice_id)).size === v.lines.length, { message: "Each invoice once", path: ["lines"] }),
  likely: z.object({ page }).strict(),
  register: z.object({ page, fy: z.string().regex(/^\d{2}-\d{2}$/).optional(), quarter: z.number().int().min(1).max(4).optional(), customer_id: uuid.optional(), show: z.enum(["all", "attention"]).optional() }).strict(),
  deductions: z.object({ page, customer_id: uuid.optional(), fy: z.string().regex(/^\d{2}-\d{2}$/).optional(), quarter: z.number().int().min(1).max(4).optional() }).strict(),
  imports: z.object({ page }).strict()
};

export const einvoiceCommands = {
  settings: z.object({}).strict(),
  save_settings: z.object({ applicable: z.boolean(), applicable_from: day.optional(), reason: text(10, 500, "Reason") }).strict()
    .refine(v => !v.applicable || v.applicable_from, { message: "Choose the date e-invoicing applies from", path: ["applicable_from"] }),
  queue: z.object({ page, search, show: z.enum(["pending", "with_irn", "all"]).optional() }).strict(),
  irn: z.object({ invoice_id: uuid }).strict()
};

export const billetLengthCommands = {
  presses: z.object({}).strict(),
  save_press: z.object({ machine_id: uuid, min_billet_mm: num(50, 3000), max_billet_mm: num(50, 3000), standard_billet_mm: num(50, 3000).optional(), container_diameter_mm: num(50, 600).optional(),
    butt_mm: num(0, 200), runout_m: num(5, 200), front_crop_m: num(0, 10).optional(), back_crop_m: num(0, 10).optional(), step_mm: num(1, 200).optional() }).strict()
    .refine(v => v.max_billet_mm > v.min_billet_mm, { message: "The longest billet must exceed the shortest", path: ["max_billet_mm"] })
    .refine(v => v.standard_billet_mm === undefined || (v.standard_billet_mm >= v.min_billet_mm && v.standard_billet_mm <= v.max_billet_mm), { message: "The standard length must be within the limits", path: ["standard_billet_mm"] }),
  job_inputs: z.object({ job_id: uuid }).strict(),
  summary: z.object({}).strict()
};

export const OFFLINE_COMMANDS = [["ap_press", "push"], ["ap_dispatch", "scan"], ["ap_sampling", "sample_record"]] as const;
export const offlineCommands = {
  submit: z.object({ request_id: uuid, rpc: z.enum(["ap_press", "ap_dispatch", "ap_sampling"]), command: z.enum(["push", "scan", "sample_record"]), payload: z.record(z.unknown()), queued_at: iso.optional() }).strict()
    .refine(v => OFFLINE_COMMANDS.some(([rpc, command]) => rpc === v.rpc && command === v.command), { message: "This entry cannot be queued", path: ["command"] }),
  conflicts: z.object({ page }).strict(),
  resolve: z.object({ request_id: uuid, resolution: z.enum(["discarded", "redone"]) }).strict()
};

const lineEdit = { machine_id: uuid, shift: text(1, 40, "Shift"), planned_start_at: iso, planned_end_at: iso, capacity_kg: num(0.001, 10000000) };
export const pressPlanCommands = {
  draft: z.object({ date: day.optional(), id: uuid.optional() }).strict(),
  history: z.object({ page }).strict(),
  prepare: z.object({ date: day.optional() }).strict(),
  edit_line: z.union([
    z.object({ line_id: uuid, remove: z.literal(true) }).strict(),
    z.object({ line_id: uuid, ...lineEdit }).strict().refine(v => Date.parse(v.planned_end_at) > Date.parse(v.planned_start_at), { message: "The end must be after the start", path: ["planned_end_at"] })
  ]),
  add_line: z.object({ draft_id: uuid, job_id: uuid, ...lineEdit }).strict().refine(v => Date.parse(v.planned_end_at) > Date.parse(v.planned_start_at), { message: "The end must be after the start", path: ["planned_end_at"] }),
  discard: z.object({ draft_id: uuid, reason: text(5, 300, "Reason") }).strict(),
  publish: z.object({ draft_id: uuid }).strict()
};

export const BATCH6_READS = ["die", "list", "settings", "impact", "runs", "run", "overview", "suggestions", "requisitions", "get", "coverage", "customer_tax", "open_invoices",
  "likely", "register", "deductions", "imports", "queue", "irn", "presses", "job_inputs", "summary", "conflicts", "draft", "history"] as const;

export const WEIGHT_STATES: Record<string, string> = {
  heavy: "Heavier than the master", light: "Lighter than the master", within: "Within tolerance", insufficient: "Not enough weighed bundles",
  no_theoretical: "Master kg/m missing", no_tolerance: "Tolerance not set"
};
export const REORDER_STATES: Record<string, string> = {
  suggested: "Suggestion ready", lead_time_missing: "Enter the supplier lead time", insufficient_history: "Less than 14 days of history", not_consumed: "No consumption in 90 days"
};
