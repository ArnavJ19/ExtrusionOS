// Autopilot batch 9: command schemas for the database gateways public.ap_rate_card (AP-073), ap_scrap_sale (AP-074),
// ap_weight_note (AP-075), ap_cash (AP-076), ap_language (AP-095), ap_enquiry (AP-008), ap_register (AP-009),
// ap_scale (AP-010) and ap_geometry (AP-048); AP-034 uses the shared proposal gateway. The database re-checks every
// command and takes the company and the actor from the session; these schemas only refuse malformed input early.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const search = z.string().trim().max(80).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const clean = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`).refine(clean, `${label}: remove control characters`);
const money = (label: string, max = 1_000_000_000) => z.number({ invalid_type_error: `${label} must be a number` }).finite().min(0.01, `${label} must be more than zero`).max(max);
const kg = (label: string) => z.number({ invalid_type_error: `${label} must be a number` }).finite().min(0, `${label} cannot be negative`).max(100000);

export const CUSTOMER_TYPES = { dealer: "Dealers", fabricator: "Fabricators", contractor: "Contractors", architect: "Architects", industrial: "Industrial", solar: "Solar", government: "Government", export: "Export", other: "Other" } as const;
type CustomerType = keyof typeof CUSTOMER_TYPES;
export const RATE_CARD_READERS = ["owner", "admin", "sales_manager", "sales", "accounts"] as const;
export const RATE_CARD_MAKERS = ["owner", "admin", "sales_manager", "sales"] as const;
export const rateCardCommands = {
  status: z.object({}).strict(),
  preview: z.object({ customer_id: uuid, valid_days: z.number().int().min(0).max(15).optional() }).strict(),
  generate: z.object({ customer_id: uuid, valid_days: z.number().int().min(0).max(15).optional(), fingerprint: z.string().regex(/^[0-9a-f]{32}$/).optional() }).strict(),
  generate_all: z.object({ customer_type: z.enum(Object.keys(CUSTOMER_TYPES) as [CustomerType, ...CustomerType[]]), valid_days: z.number().int().min(0).max(15).optional() }).strict(),
  list: z.object({ page, search, day: day.optional() }).strict(),
  get: z.object({ id: uuid }).strict(),
  shared: z.object({ id: uuid, channel: z.enum(["pdf", "whatsapp"]) }).strict()
};

export const SCRAP_READERS = ["owner", "admin", "accounts", "factory_manager", "inventory_manager", "production_manager"] as const;
export const SCRAP_MANAGERS = ["owner", "admin", "accounts", "factory_manager", "inventory_manager"] as const;
export const SCRAP_MONEY = ["owner", "admin", "accounts"] as const;
export const FOUNDRY_CATEGORIES = { butt_end: "Butt ends", front_back_end: "Front and back ends", saw_cut: "Saw cuts", rejects: "Rejects", qc_reject: "QC rejects", finishing_reject: "Finishing rejects",
  returned_goods: "Returned goods", unclassified: "Unclassified", categorised: "Mixed categories", unrecoverable_loss: "Unrecoverable", other: "Other" } as const;
export const SCRAP_TYPES = { butt_scrap: "Butt scrap", process_scrap: "Process scrap", rejection: "Rejection", cutting_waste: "Cutting waste", coating_rejection: "Coating rejection",
  anodizing_rejection: "Anodising rejection", packing_damage: "Packing damage", customer_return: "Customer return", remelt_scrap: "Remelt scrap", other: "Other" } as const;
export const SCRAP_SALE_STATUS: Record<string, string> = { ordered: "Ordered", weighed: "Weighed", invoiced: "Invoiced", paid: "Paid", cancelled: "Cancelled" };
export const RECEIPT_METHODS = { bank_transfer: "Bank transfer", upi: "UPI", cheque: "Cheque", cash: "Cash", other: "Other" } as const;
type FoundryCategory = keyof typeof FOUNDRY_CATEGORIES; type ScrapType = keyof typeof SCRAP_TYPES; type ReceiptMethod = keyof typeof RECEIPT_METHODS;
export const scrapSaleCommands = {
  stock: z.object({}).strict(),
  grades: z.object({}).strict(),
  save_grade: z.object({ id: uuid.optional(), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, "Grade code: 2 to 20 capitals, digits or -").optional(), name: text(3, 80, "Grade name"),
    hsn_code: z.string().regex(/^[0-9]{4,8}$/, "HSN: 4 to 8 digits").optional(), gst_percent: z.number().min(0).max(28).optional(),
    foundry_categories: z.array(z.enum(Object.keys(FOUNDRY_CATEGORIES) as [FoundryCategory, ...FoundryCategory[]])).max(11), scrap_types: z.array(z.enum(Object.keys(SCRAP_TYPES) as [ScrapType, ...ScrapType[]])).max(10),
    sort_order: z.number().int().min(0).max(1000).optional(), is_active: z.boolean().optional() }).strict().refine(v => v.id || v.code, { message: "Give the grade code", path: ["code"] }),
  offers: z.object({ grade_id: uuid.optional(), status: z.enum(["open", "accepted", "withdrawn", "all"]).optional(), page }).strict(),
  offer: z.object({ grade_id: uuid, buyer_id: uuid, rate_per_kg: money("Rate per kg", 10000), quantity_kg: money("Quantity", 10000000), valid_until: day, note: text(3, 300, "Note").optional() }).strict(),
  withdraw_offer: z.object({ id: uuid }).strict(),
  accept_offer: z.object({ offer_id: uuid, reason: text(5, 300, "Reason").optional() }).strict(),
  sales: z.object({ page, status: z.enum(["all", "ordered", "weighed", "invoiced", "paid", "cancelled"]).optional(), search }).strict(),
  sale: z.object({ id: uuid }).strict(),
  weigh: z.object({ id: uuid, gross_kg: kg("Gross weight"), tare_kg: kg("Tare weight"), weighbridge_ref: text(1, 80, "Weighbridge slip"), vehicle_registration: z.string().trim().max(20).optional() }).strict()
    .refine(v => v.gross_kg > v.tare_kg, { message: "Gross weight must be more than tare weight", path: ["gross_kg"] }),
  invoice: z.object({ id: uuid }).strict(),
  receipt: z.object({ id: uuid, amount: money("Amount", 100000000), received_on: day.optional(), method: z.enum(Object.keys(RECEIPT_METHODS) as [ReceiptMethod, ...ReceiptMethod[]]), reference: text(1, 80, "Reference").optional() }).strict(),
  cancel: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict()
};

export const WEIGHT_NOTE_READERS = ["owner", "admin", "accounts", "sales_manager", "sales", "dispatch_manager"] as const;
export const WEIGHT_NOTE_APPROVERS = ["owner", "admin", "accounts"] as const;
export const WEIGHT_NOTE_STATUS: Record<string, string> = { recorded: "Within tolerance", draft: "To approve", approved: "Approved", rejected: "Rejected" };
export const weightNoteCommands = {
  tolerances: z.object({}).strict(),
  save_tolerance: z.object({ customer_id: uuid.optional(), tolerance_percent: z.number().min(0).max(10).optional(), tolerance_kg: z.number().min(0).max(10000).optional(), reason: text(5, 300, "Reason") }).strict()
    .refine(v => v.tolerance_percent !== undefined || v.tolerance_kg !== undefined, { message: "Give the tolerance in percent, in kg, or both", path: ["tolerance_percent"] }),
  invoice: z.object({ invoice_id: uuid }).strict(),
  report: z.object({ invoice_id: uuid, reported_kg: money("Customer's weight", 10000000), customer_reference: text(2, 80, "Customer's weighbridge reference"), note: text(3, 300, "Note").optional() }).strict(),
  approve: z.object({ id: uuid, note: text(3, 300, "Note").optional() }).strict(),
  reject: z.object({ id: uuid, note: text(3, 300, "Reason") }).strict(),
  list: z.object({ page, status: z.enum(["draft", "approved", "rejected", "recorded", "all"]).optional() }).strict()
};

export const CASH_ROLES = ["owner", "admin", "accounts"] as const;
export const cashForecastCommands = {
  forecast: z.object({ weeks: z.number().int().min(1).max(8).optional() }).strict(),
  save_opening: z.object({ opening_balance: z.number().finite().min(-1000000000).max(1000000000).optional(), balance_as_of: day.optional() }).strict(),
  fixed: z.object({}).strict(),
  save_fixed: z.object({ label: text(3, 80, "Expense"), amount: money("Amount", 100000000), frequency: z.enum(["monthly", "weekly"]), day_of_month: z.number().int().min(1).max(28).optional(), weekday: z.number().int().min(1).max(7).optional() }).strict(),
  retire_fixed: z.object({ id: uuid }).strict(),
  save_one_off: z.object({ on_date: day, direction: z.enum(["in", "out"]), amount: money("Amount"), label: text(3, 120, "Description") }).strict(),
  remove_one_off: z.object({ id: uuid }).strict(),
  accuracy: z.object({ page }).strict(),
  snapshot_now: z.object({}).strict()
};

export const languageCommands = {
  get: z.object({}).strict(),
  set: z.object({ language: z.enum(["en", "hi"]) }).strict()
};

export const ENQUIRY_ROLES = ["owner", "admin", "sales_manager", "sales"] as const;
export const ENQUIRY_STATUS: Record<string, string> = { draft: "To review", quoted: "Quoted", discarded: "Discarded" };
const confidence = z.enum(["high", "medium", "low"]);
export const enquiryLineSchema = z.object({
  seq: z.number().int().min(1).max(100), text: z.string().max(300), code: z.string().max(60).nullable(), code_key: z.string().regex(/^[A-Z0-9]{1,40}$/).nullable(),
  profile_id: uuid.nullable(), profile_code: z.string().max(80).nullable(), basis: z.string().max(40).nullable(),
  length_m: z.number().positive().max(20).nullable(), length_text: z.string().max(40).nullable(), pieces: z.number().int().positive().max(1000000).nullable(), kg: z.number().positive().max(10000000).nullable(),
  finish: z.string().regex(/^[a-z_]{3,40}$/).nullable(), shade: z.string().max(60).nullable(), alloy: z.string().max(10).nullable(), confidence, issues: z.array(z.string().max(160)).max(10)
}).strict();
export type EnquiryLine = z.infer<typeof enquiryLineSchema>;
export const enquiryCommands = {
  context: z.object({ codes: z.array(z.string().max(60)).max(100), phone: z.string().max(20).optional(), name: z.string().max(80).optional(), customer_id: uuid.optional() }).strict(),
  get: z.object({ id: uuid }).strict(),
  list: z.object({ page, status: z.enum(["draft", "quoted", "discarded", "all"]).optional(), search }).strict(),
  map: z.object({ id: uuid, code_key: z.string().regex(/^[A-Z0-9]{1,40}$/), profile_id: uuid, remember: z.enum(["customer", "everyone", "no"]) }).strict(),
  set_customer: z.object({ id: uuid, customer_id: uuid }).strict(),
  draft: z.object({ id: uuid }).strict(),
  link_quote: z.object({ id: uuid, quote_id: uuid }).strict(),
  discard: z.object({ id: uuid, reason: text(3, 300, "Reason") }).strict()
};
/** Written only by lib/actions/autopilot-batch9 after it parsed the text itself. */
export const enquirySaveSchema = z.object({
  raw_text: z.string().min(3).max(20000), source: z.enum(["paste", "chat_export"]), sender_phone: z.string().regex(/^[0-9]{10,13}$/).optional(), sender_name: text(1, 80, "Sender").optional(),
  customer_id: uuid.optional(), customer_basis: z.enum(["phone", "name", "chosen"]).optional(), lines: z.array(enquiryLineSchema).max(100), unknown_codes: z.array(z.string().regex(/^[A-Z0-9]{1,40}$/)).max(100)
}).strict();

export const REGISTER_ROLES = ["owner", "admin", "factory_manager", "production_manager", "production"] as const;
export const REGISTER_CONFIRMERS = ["owner", "admin", "factory_manager", "production_manager"] as const;
export const REGISTER_COLUMNS = { die_no: "Die no.", job_no: "Job no.", billets: "Billets", pushes: "Pushes", output_pcs: "Output pcs", rejects: "Rejects", downtime_min: "Downtime (min)", remarks: "Remarks" } as const;
export type RegisterColumn = keyof typeof REGISTER_COLUMNS;
const count = (max: number) => z.number().int().min(0).max(max).nullable().optional();
export const registerRowSchema = z.object({ id: uuid.optional(), job_id: uuid.nullable().optional(), die_no: z.string().trim().max(40).nullable().optional(), billets: count(5000), pushes: count(5000),
  output_pcs: count(1000000), rejects: count(1000000), downtime_min: count(1440), remarks: z.string().trim().max(200).nullable().optional(),
  cells: z.record(z.object({ source: z.enum(["system", "typed", "image"]), confidence: confidence.optional() }).strict()).optional() }).strict();
export const registerCommands = {
  templates: z.object({}).strict(),
  save_template: z.object({ name: text(3, 60, "Template name"), columns: z.array(z.enum(Object.keys(REGISTER_COLUMNS) as [RegisterColumn, ...RegisterColumn[]])).min(1).max(8), notes: text(3, 300, "Notes").optional() }).strict(),
  retire_template: z.object({ id: uuid }).strict(),
  get: z.object({ id: uuid }).strict(),
  list: z.object({ page, status: z.enum(["draft", "confirmed", "discarded", "all"]).optional() }).strict(),
  save_rows: z.object({ id: uuid, rows: z.array(registerRowSchema).max(100) }).strict(),
  confirm: z.object({ id: uuid, rows: z.array(registerRowSchema).max(100) }).strict(),
  discard: z.object({ id: uuid, reason: text(3, 300, "Reason") }).strict(),
  job: z.object({ job_id: uuid }).strict()
};

export const SCALE_ROLES = ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "quality"] as const;
export const scaleCaptureSchema = z.object({ source: z.enum(["scale", "manual"]), indicator_ref: z.string().trim().min(2).max(60).optional(), raw_reading: z.string().max(80).refine(clean).optional(),
  stable: z.boolean().optional(), readings_count: z.number().int().min(1).max(1000).optional() }).strict()
  .refine(v => v.source === "manual" || (v.raw_reading && v.stable === true), { message: "A scale weight needs a stable reading.", path: ["raw_reading"] });
export const scaleCommands = {
  share: z.object({ days: z.number().int().min(1).max(365).optional() }).strict(),
  list: z.object({ page, show: z.enum(["flagged", "manual", "all"]).optional() }).strict()
};

export const GEOMETRY_READERS = ["owner", "admin", "production_manager", "factory_manager", "quality", "sales_manager"] as const;
export const GEOMETRY_UPLOADERS = ["owner", "admin", "production_manager", "factory_manager", "quality"] as const;
export const geometryCommands = {
  reads: z.object({ profile_id: uuid }).strict(),
  get: z.object({ id: uuid }).strict(),
  densities: z.object({}).strict(),
  set_density: z.object({ alloy: z.string().trim().toUpperCase().regex(/^[0-9]{4}[A-Z]?$/, "Enter the alloy as four digits, such as 6063"), density_kg_m3: z.number().min(2500).max(3000) }).strict()
};

export const BATCH9_READS = ["status", "preview", "list", "get", "stock", "grades", "offers", "sales", "sale", "tolerances", "forecast", "fixed", "accuracy", "context",
  "draft", "templates", "job", "share", "reads", "densities"] as const;
