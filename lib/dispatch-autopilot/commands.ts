// Autopilot batch 4 (dispatch and compliance): command schemas for public.ap_dispatch, ap_freight, ap_eway, ap_tally and
// ap_share. The database re-checks every command and takes the company and the actor from the session; these schemas
// only refuse malformed input early.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const search = z.string().trim().max(60).optional();
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value), `${label}: remove control characters`);
const vehicle = z.string().trim().max(20).optional();

export const DISPATCH_FLOOR_ROLES = ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager"] as const;
export const DISPATCH_SUPERVISOR_ROLES = ["owner", "admin", "factory_manager", "dispatch_manager"] as const;
export const GATE_ROLES = ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch"] as const;
export const READY_ROLES = ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "sales_manager", "sales", "accounts", "production_manager"] as const;
export const FREIGHT_ROLES = ["owner", "admin", "dispatch_manager", "dispatch", "factory_manager", "sales_manager", "sales", "accounts"] as const;
export const EWAY_ROLES = ["owner", "admin", "accounts", "dispatch_manager", "dispatch"] as const;
export const SHARE_ROLES = ["owner", "admin", "sales_manager", "sales", "dispatch_manager", "dispatch", "accounts", "factory_manager"] as const;
export const PACK_SPEC_ROLES = ["owner", "admin", "sales_manager", "dispatch_manager", "factory_manager", "quality"] as const;
export const hasRole = (roles: readonly string[], role: string) => roles.includes(role);
/** Who may copy a record summary (mirrors private.ap4_summary_roles); viewers get only the customer version. */
export const SUMMARY_ROLES = {
  order: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"],
  dispatch: ["owner", "admin", "sales_manager", "sales", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "viewer"],
  invoice: ["owner", "admin", "accounts", "viewer"],
  job: ["owner", "admin", "production_manager", "production", "factory_manager", "viewer"],
  quote: ["owner", "admin", "sales_manager", "sales", "accounts", "viewer"]
} as const;
export const canSummarise = (kind: keyof typeof SUMMARY_ROLES, role: string, dealer: boolean) => !dealer && (SUMMARY_ROLES[kind] as readonly string[]).includes(role);
export const canInternalSummary = (kind: keyof typeof SUMMARY_ROLES, role: string, dealer: boolean) => canSummarise(kind, role, dealer) && role !== "viewer";

const transport = { vehicle_number: vehicle, transporter_name: z.string().trim().max(120).optional(), transporter_id: uuid.optional(), driver_name: z.string().trim().max(80).optional(),
  driver_phone: z.string().trim().max(20).optional(), lr_number: z.string().trim().max(40).optional() };

export const dispatchCommands = {
  sessions: z.object({ status: z.enum(["open", "completed", "cancelled", "all"]).optional(), search, page }).strict(),
  session: z.object({ id: uuid }).strict(),
  order_session: z.object({ order_id: uuid }).strict(),
  start: z.object({ order_id: uuid, ...transport }).strict(),
  update: z.object({ id: uuid, ...transport }).strict(),
  scan: z.object({ session_id: uuid, tag: z.string().trim().min(1, "Scan or type the bundle tag").max(160), confirm: z.boolean().optional(), note: text(5, 300, "Note").optional() }).strict(),
  remove: z.object({ scan_id: uuid, reason: text(5, 300, "Reason") }).strict(),
  cancel: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict(),
  bundles_for_dispatch: z.object({ id: uuid }).strict(),
  complete: z.object({ id: uuid, dispatch_id: uuid }).strict(),
  gate_queue: z.object({ search, page }).strict(),
  gate_out: z.object({ dispatch_id: uuid, vehicle_number: z.string().trim().min(4, "Enter the vehicle number").max(20), override_reason: text(10, 300, "Override reason").optional(),
    eway_reason: text(10, 300, "E-way bill reason").optional() }).strict(),
  gate_register: z.object({ search, page, from: day.optional(), to: day.optional() }).strict(),
  ready: z.object({ search, page, due_within_days: z.number().int().min(0).max(365).optional(), released_only: z.boolean().optional() }).strict(),
  stations: z.object({}).strict(),
  save_station: z.object({ id: uuid.optional(), name: text(2, 60, "Station name"), location: z.string().trim().max(120).optional(), auto_print: z.boolean().optional(),
    is_default: z.boolean().optional(), active: z.boolean().optional() }).strict(),
  label_queue: z.object({ station_id: uuid.optional(), status: z.enum(["queued", "blocked", "printed", "cancelled", "all"]).optional(), page }).strict(),
  label_printed: z.object({ job_id: uuid }).strict(),
  label_reprint: z.object({ bundle_id: uuid, reason: z.enum(["reprint", "damaged", "relabel"]), note: text(5, 300, "Reason") }).strict(),
  label_retry: z.object({ job_id: uuid }).strict(),
  label_cancel: z.object({ job_id: uuid, reason: text(5, 300, "Reason") }).strict(),
  label_audit: z.object({ days: z.number().int().min(1).max(31).optional(), page }).strict(),
  pack_plan: z.object({ order_id: uuid }).strict(),
  pack_specs: z.object({ customer_id: uuid.optional() }).strict(),
  save_pack_spec: z.object({ customer_id: uuid.optional(), max_bundle_kg: z.number().positive().max(5000).optional(), max_pieces: z.number().int().min(1).max(5000).optional(),
    wrapping: z.enum(["stretch_film", "bubble_wrap", "pp_woven_sheet", "hdpe", "paper", "none"]), interleaving_paper: z.boolean(), battens_per_bundle: z.number().int().min(0).max(20),
    material_ids: z.array(uuid).max(12), notes: z.string().trim().max(500).optional(), reason: text(5, 300, "Reason") }).strict(),
  deviations: z.object({ page, order_id: uuid.optional(), open_only: z.boolean().optional() }).strict(),
  deviation_note: z.object({ id: uuid, note: text(5, 300, "Note") }).strict(),
  pack_report: z.object({ page, days: z.number().int().min(1).max(90).optional() }).strict(),
  settings: z.object({}).strict(),
  save_settings: z.object({ eway_threshold: z.number().min(0).max(100000000).optional(), eway_gate_policy: z.enum(["warn", "block"]).optional(),
    status_link_days: z.number().int().min(1).max(90).optional() }).strict()
};

export const freightCommands = {
  cards: z.object({ transporter_id: uuid.optional(), state: z.string().regex(/^\d{2}$/).optional(), status: z.enum(["active", "retired", "all"]).optional(), page }).strict(),
  save_card: z.object({ transporter_id: uuid, basis: z.enum(["per_kg", "per_vehicle"]), vehicle_type: z.string().trim().max(40).optional(), vehicle_capacity_kg: z.number().positive().max(60000).optional(),
    destination_state: z.string().regex(/^\d{2}$/, "Choose the destination state"), destination_city: z.string().trim().max(60).optional(), rate: z.number().positive().max(10000000),
    min_charge: z.number().min(0).max(10000000).optional(), effective_from: day, effective_to: day.optional(), note: z.string().trim().max(300).optional() }).strict()
    .refine(v => v.basis === "per_kg" || (v.vehicle_type && v.vehicle_capacity_kg), { message: "Per-vehicle cards need the vehicle type and capacity", path: ["vehicle_type"] }),
  retire_card: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict(),
  transporters: z.object({}).strict(),
  estimate: z.object({ weight_kg: z.number().positive().max(1000000), state: z.string().regex(/^\d{2}$/), city: z.string().trim().max(60).optional() }).strict(),
  propose: z.object({ target_kind: z.enum(["quote", "loading", "dispatch"]), target_id: uuid }).strict(),
  decision: z.object({ target_kind: z.enum(["quote", "loading", "dispatch"]), target_id: uuid }).strict(),
  record_billed: z.object({ decision_id: uuid, amount: z.number().min(0).max(10000000), reference: text(1, 80, "Bill reference") }).strict(),
  refresh_billed: z.object({ decision_id: uuid }).strict(),
  variance: z.object({ days: z.number().int().min(7).max(366).optional(), page }).strict()
};

export const ewayCommands = {
  queue: z.object({ search, page, show: z.enum(["missing", "all"]).optional() }).strict(),
  sources: z.object({ dispatch_ids: z.array(uuid).min(1).max(50) }).strict(),
  save_inputs: z.object({ dispatch_id: uuid, distance_km: z.number().int().min(0).max(4000), transport_mode: z.enum(["road", "rail", "air", "ship"]).optional(),
    vehicle_type: z.enum(["regular", "over_dimensional"]).optional(), transporter_gstin: z.string().trim().max(15).optional() }).strict(),
  record_ewb: z.object({ entries: z.array(z.object({ doc: z.string().trim().min(1).max(40), ewb: z.string().trim().min(12).max(14) }).strict()).min(1).max(200) }).strict(),
  exports: z.object({ page }).strict()
};

const voucherKinds = z.array(z.enum(["sales", "receipt", "on_account", "purchase", "credit_note"])).max(5).optional();
export const tallyCommands = {
  mappings: z.object({}).strict(),
  save_mapping: z.object({ kind: z.enum(["customer", "vendor", "sales", "purchase", "output_cgst", "output_sgst", "output_igst", "input_cgst", "input_sgst", "input_igst", "round_off", "bank", "cash",
    "freight_inward", "discount_received"]), entity_id: uuid.optional(), gst_rate: z.number().min(0).max(28).optional(), supply: z.enum(["local", "interstate"]).optional(),
    ledger_name: text(1, 100, "Ledger name").refine(v => !/[<>&]/.test(v), "Ledger names cannot contain < > or &") }).strict(),
  remove_mapping: z.object({ id: uuid }).strict(),
  pending: z.object({ from: day, to: day, kinds: voucherKinds, page, show: z.enum(["pending", "all"]).optional() }).strict(),
  re_export: z.object({ kind: z.enum(["sales", "receipt", "on_account", "purchase", "credit_note"]), voucher_id: uuid, reason: text(10, 300, "Reason") }).strict(),
  batches: z.object({ page }).strict()
};

export const shareCommands = {
  summary: z.object({ kind: z.enum(["order", "dispatch", "invoice", "job", "quote"]), id: uuid, audience: z.enum(["customer", "internal"]) }).strict(),
  create_link: z.object({ order_id: uuid, days: z.number().int().min(1).max(90).optional() }).strict(),
  links: z.object({ order_id: uuid }).strict(),
  revoke_link: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict()
};

export const DISPATCH_READS = ["sessions", "session", "order_session", "bundles_for_dispatch", "gate_queue", "gate_register", "ready", "stations", "label_queue", "label_audit", "pack_plan",
  "pack_specs", "deviations", "pack_report", "cards", "transporters", "estimate", "decision", "variance", "queue", "sources", "exports", "mappings", "pending", "batches", "summary", "links"] as const;

export const SCAN_WARNING_LABELS: Record<string, string> = {
  unknown: "Unknown tag", dispatched: "Already dispatched", loaded_elsewhere: "On another vehicle", other_customer: "Another customer's bundle", other_order: "Another order's bundle",
  held: "QC hold / not released", over_plan: "More than ordered", not_in_plan: "Not in the order"
};
export const DEVIATION_LABELS: Record<string, string> = { over_pieces: "More pieces than the standard", under_pieces: "Fewer pieces than the standard", over_kg: "Heavier than the bundle limit" };
