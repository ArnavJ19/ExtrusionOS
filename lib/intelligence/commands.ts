// FABLE_SUGGESTIONS Phase 4 ("make it intelligent"): command schemas for the database gateways public.fs_otif (FS-68),
// fs_metal_exposure (FS-72), fs_order_book (FS-71), fs_mrp (FS-27), fs_die_life (FS-16), fs_promise (FS-26 stage),
// fs_development (FS-54) and fs_cockpit (FS-38). The 13-week cash forecast (FS-73) extends ap_cash_forecast.
// The database re-checks every command and takes the company and the actor from the session; these schemas only
// refuse malformed input early and list the roles each screen is for.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const search = z.string().trim().max(80).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const clean = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`).refine(clean, `${label}: remove control characters`);
const none = z.object({}).strict();

export const DELAY_CAUSES = {
  die: "Die", material: "Material / billet", press_breakdown: "Press breakdown", finishing_vendor: "Finishing vendor", credit_hold: "Credit hold",
  transport: "Transport", quality: "Quality", capacity: "Press capacity", customer_request: "Customer request", other: "Other"
} as const;
export type DelayCause = keyof typeof DELAY_CAUSES;
const cause = z.enum(Object.keys(DELAY_CAUSES) as [DelayCause, ...DelayCause[]], { errorMap: () => ({ message: "Choose the cause" }) });
export const causeLabel = (value: string | null | undefined) => value === "not_recorded" || !value ? "Not recorded" : (DELAY_CAUSES as Record<string, string>)[value] ?? value;

export const OTIF_READERS = ["owner", "admin", "sales_manager", "accounts", "factory_manager", "production_manager", "dispatch_manager"] as const;
export const OTIF_EDITORS = ["owner", "admin", "sales_manager", "factory_manager", "production_manager", "dispatch_manager"] as const;
export const OTIF_OUTCOMES: Record<string, string> = { otif: "On time in full", late: "Late", open_late: "Not yet complete", quantity_missing: "Quantity missing" };
export const otifCommands = {
  summary: z.object({ from: day.optional(), to: day.optional() }).strict(),
  lines: z.object({ from: day.optional(), to: day.optional(), page, outcome: z.enum(["all", "otif", "late", "open_late", "missed"]).optional(), customer_id: uuid.optional(),
    cause: z.union([cause, z.literal("not_recorded")]).optional() }).strict(),
  history: z.object({ order_item_id: uuid }).strict(),
  set_cause: z.object({ order_item_id: uuid, cause, note: text(3, 300, "Note").optional() }).strict(),
  annotate_change: z.object({ id: uuid, cause, agreed_with: text(2, 120, "Agreed with").optional() }).strict(),
  settings: none,
  save_settings: z.object({ in_full_tolerance_percent: z.number().finite().min(0, "Tolerance cannot be negative").max(10, "At most 10%"), reason: text(5, 300, "Reason") }).strict()
};

export const EXPOSURE_ROLES = ["owner", "admin", "accounts"] as const;
export const exposureCommands = {
  position: none, trend: none, settings: none, snapshot_now: none,
  bookings: z.object({ page, status: z.enum(["open", "cancelled", "all"]).optional() }).strict(),
  book: z.object({ order_id: uuid, purchase_order_id: uuid.optional(), supplier_reference: text(2, 120, "Supplier reference"),
    quantity_kg: z.number({ invalid_type_error: "Quantity must be a number" }).finite().min(0.001, "Quantity must be more than zero").max(100000000),
    rate_per_kg: z.number({ invalid_type_error: "Rate must be a number" }).finite().min(1, "Rate must be at least ₹1").max(100000),
    booked_on: day.optional(), note: text(3, 300, "Note").optional() }).strict(),
  cancel_booking: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict(),
  set_terms: z.object({ order_id: uuid, basis: z.enum(["fixed", "price_linked"]), note: text(5, 300, "Note") }).strict(),
  save_settings: z.object({ open_position_limit_kg: z.number().finite().min(1).max(100000000).optional(), price_step_per_kg: z.number().finite().min(0.5).max(1000).optional(), reason: text(5, 300, "Reason") }).strict()
};

export const ORDER_BOOK_ROLES = ["owner", "admin", "sales_manager", "accounts", "factory_manager"] as const;
const percent = (label: string) => z.number({ invalid_type_error: `${label} must be a number` }).finite().min(0).max(100);
export const orderBookCommands = {
  overview: none,
  save_settings: z.object({ probability_unsent_percent: percent("Probability for unsent quotes").optional(), probability_sent_percent: percent("Probability for sent quotes").optional(),
    drop_threshold_percent: z.number().finite().min(5).max(95).optional(), reason: text(5, 300, "Reason") }).strict()
};

export const MRP_ROLES = ["owner", "admin", "factory_manager", "inventory_manager", "accounts", "production_manager"] as const;
export const MRP_APPROVERS = ["owner", "admin"] as const;
export const MRP_ACTIONS = { po_raised: "Purchase order raised", cast_planned: "Cast planned", not_needed: "Not needed" } as const;
export const mrpCommands = {
  plan: z.object({ weeks: z.number().int().min(1).max(13).optional() }).strict(),
  approve: z.object({ fingerprint: z.string().regex(/^[0-9a-f]{32}$/), note: text(3, 300, "Note").optional(), weeks: z.number().int().min(1).max(13).optional() }).strict(),
  action: z.object({ plan_id: uuid, line_key: z.string().min(3).max(160), action: z.enum(["po_raised", "cast_planned", "not_needed"]), reference: text(2, 120, "Reference").optional(), note: text(3, 300, "Note").optional() }).strict()
    .refine(v => v.action === "not_needed" ? !!v.note : !!v.reference, { message: "Give the purchase order or cast reference, or say why it is not needed", path: ["reference"] }),
  history: z.object({ page }).strict()
};

export const DIE_LIFE_ROLES = ["owner", "admin", "production_manager", "factory_manager", "production", "quality", "sales_manager", "accounts"] as const;
export const DIE_LIFE_EDITORS = ["owner", "admin", "production_manager"] as const;
export const DIE_MAKER_ROLES = ["owner", "admin", "production_manager", "factory_manager", "accounts"] as const;
export const dieLifeCommands = {
  dies: z.object({ page, filter: z.enum(["all", "replace", "unknown_life", "open_corrections", "customer_owned"]).optional(), search }).strict(),
  makers: none, settings: none,
  save_settings: z.object({ replacement_lead_days: z.number().int().min(1).max(365).optional(), reason: text(5, 300, "Reason") }).strict()
};

export const PROMISE_ROLES = ["owner", "admin", "sales_manager", "sales", "factory_manager", "production_manager"] as const;
export const promiseCommands = {
  estimate: z.object({ profile_id: uuid, quantity_kg: z.number({ invalid_type_error: "Quantity must be a number" }).finite().min(1, "Enter the quantity in kg").max(10000000), finishing_type: text(2, 40, "Finish").optional() }).strict(),
  reflow: none
};

export const DEVELOPMENT_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "factory_manager", "quality", "production"] as const;
export const DEVELOPMENT_EDITORS = ["owner", "admin", "sales_manager", "sales", "production_manager", "factory_manager", "quality"] as const;
export const DEVELOPMENT_STAGES = {
  enquiry: "Enquiry with drawing", feasibility: "Feasibility", die_quotation: "Die quotation", die_ordered: "Die ordered", die_received: "Die received",
  trial: "Trials", sample_submitted: "Sample submitted", customer_approval: "Customer approval", released: "Released for production", dropped: "Dropped"
} as const;
export type DevelopmentStage = keyof typeof DEVELOPMENT_STAGES;
export const DEVELOPMENT_ORDER: DevelopmentStage[] = ["enquiry", "feasibility", "die_quotation", "die_ordered", "die_received", "trial", "sample_submitted", "customer_approval", "released"];
const optionalUuid = z.union([uuid, z.literal("")]).optional();
const optionalDay = z.union([day, z.literal("")]).optional();
export const developmentCommands = {
  board: none,
  list: z.object({ page, stage: z.enum(Object.keys(DEVELOPMENT_STAGES) as [DevelopmentStage, ...DevelopmentStage[]]).optional(), search }).strict(),
  get: z.object({ id: uuid }).strict(),
  create: z.object({ title: text(3, 160, "Title"), customer_id: uuid, drawing_reference: text(2, 120, "Drawing reference").optional(), owner_id: uuid.optional(), note: text(3, 500, "Note").optional() }).strict(),
  update: z.object({ id: uuid,
    feasibility: z.object({ ccd_mm: z.number().finite().min(1).max(1000).optional(), weight_kg_per_m: z.number().finite().min(0.001).max(100).optional(), min_wall_mm: z.number().finite().min(0.1).max(100).optional(),
      tongue_ratio: z.number().finite().min(0).max(50).optional(), press_id: uuid.optional(), verdict: z.enum(["pending", "feasible", "not_feasible"]), note: text(3, 300, "Feasibility note").optional() }).strict().optional(),
    die_cost: z.number().finite().min(0).max(100000000).optional(), die_cost_payer: z.enum(["company", "customer", "shared"]).optional(), amortisation_terms: text(3, 300, "Amortisation terms").optional(),
    die_cost_approved_by_customer_at: optionalDay, die_vendor_id: optionalUuid, expected_die_date: optionalDay, die_id: optionalUuid, profile_id: optionalUuid,
    sample_reference: text(2, 120, "Sample reference").optional(), customer_approval_reference: text(2, 120, "Customer approval reference").optional(),
    drawing_reference: text(2, 120, "Drawing reference").optional(), owner_id: uuid.optional() }).strict(),
  move: z.object({ id: uuid, to_stage: z.enum(Object.keys(DEVELOPMENT_STAGES) as [DevelopmentStage, ...DevelopmentStage[]]), note: text(3, 500, "Note"), owner_id: uuid.optional() }).strict()
};

export const COCKPIT_ROLES = ["owner", "admin"] as const;
export const cockpitCommands = { today: none, trend: none };

export const WALL_ROLES = ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "viewer", "dispatch_manager", "sales_manager"] as const;
export const wallCommands = { board: none };

/** Gateway name -> command schemas. Commands not listed here never reach the database. */
export const INTELLIGENCE_COMMANDS = {
  fs_otif: otifCommands, fs_metal_exposure: exposureCommands, fs_order_book: orderBookCommands, fs_mrp: mrpCommands,
  fs_die_life: dieLifeCommands, fs_promise: promiseCommands, fs_development: developmentCommands, fs_cockpit: cockpitCommands, fs_wall: wallCommands
} as const;
export type IntelligenceGateway = keyof typeof INTELLIGENCE_COMMANDS;

/** Commands that only read; everything else revalidates the screens in INTELLIGENCE_PATHS. */
export const INTELLIGENCE_READS = new Set(["summary", "lines", "history", "settings", "position", "trend", "bookings", "overview", "plan", "dies", "makers", "estimate", "reflow", "board", "list", "get", "today"]);
export const INTELLIGENCE_PATHS: Record<IntelligenceGateway, string[]> = {
  fs_otif: ["/insights/otif"], fs_metal_exposure: ["/insights/metal-exposure"], fs_order_book: ["/insights/order-book"], fs_mrp: ["/production/material-plan"],
  fs_die_life: ["/dies/life"], fs_promise: [], fs_development: ["/profiles/development"], fs_cockpit: [], fs_wall: []
};
