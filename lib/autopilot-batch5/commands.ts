// Autopilot batch 5: command schemas for public.ap_usual (AP-026), ap_finishing (AP-056) and ap_quote_sales (AP-071,
// AP-072). The database re-checks every command and takes the company and the actor from the session.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value), `${label}: remove control characters`);

export const USUAL_ROLES = ["owner", "admin", "sales_manager", "sales", "dispatch_manager", "dispatch", "factory_manager", "inventory_manager", "accounts"] as const;
export const FINISHING_CHASE_ROLES = ["owner", "admin", "production_manager", "factory_manager", "production"] as const;
export const QUOTE_SALES_ROLES = ["owner", "admin", "sales_manager", "sales"] as const;
export const FLOOR_APPROVER_ROLES = ["owner", "admin"] as const;

export const usualCommands = {
  customer: z.object({ customer_id: uuid }).strict(),
  decide: z.object({ customer_id: uuid, field: z.enum(["finish", "payment_terms", "delivery_timeline", "packing", "transporter", "priority"]), surface: z.enum(["quote", "order", "loading"]),
    source: z.enum(["learned", "master"]), suggested: z.string().trim().min(1).max(300), decision: z.enum(["used", "dismissed"]) }).strict(),
  stats: z.object({ days: z.number().int().min(7).max(366).optional() }).strict()
};

export const finishingCommands = {
  chase: z.object({ page, show: z.enum(["chase", "all"]).optional(), vendor_id: uuid.optional() }).strict(),
  copied: z.object({ job_ids: z.array(uuid).min(1).max(50) }).strict(),
  promise: z.object({ job_ids: z.array(uuid).min(1).max(50), promised_date: day, channel: z.enum(["whatsapp", "phone_call", "email", "visit", "other"]), note: text(3, 300, "Note").optional() }).strict(),
  history: z.object({ job_id: uuid }).strict()
};

export const FOLLOWUP_RESULTS = { reached: "Spoke to them", no_answer: "No answer", considering: "Still considering", revision_requested: "Asked for a revision", ordered: "Confirmed the order", lost: "Said no" } as const;
export type FollowupResult = keyof typeof FOLLOWUP_RESULTS;

export const quoteSalesCommands = {
  followups: z.object({ quote_id: uuid }).strict(),
  followup_queue: z.object({ page, show: z.enum(["due", "upcoming"]).optional(), mine: z.boolean().optional() }).strict(),
  record_followup: z.object({ quote_id: uuid, result: z.enum(Object.keys(FOLLOWUP_RESULTS) as [FollowupResult, ...FollowupResult[]]), note: text(3, 300, "Note").optional(), next_date: day.optional() }).strict(),
  followup_settings: z.object({}).strict(),
  save_followup_settings: z.object({ day_steps: z.array(z.number().int().min(1).max(60)).max(6), before_expiry_days: z.number().int().min(1).max(30).optional() }).strict(),
  floors: z.object({ page, status: z.enum(["active", "retired", "all"]).optional() }).strict(),
  save_floor: z.object({ alloy: z.string().trim().regex(/^[0-9A-Za-z]{3,8}$/, "Enter the alloy, for example 6063").optional(), finishing_type: z.string().regex(/^[a-z_]{3,40}$/).optional(),
    min_kg: z.number().min(0).max(1000000).optional(), max_kg: z.number().positive().max(10000000).optional(), floor_per_kg: z.number().positive().max(10000), reason: text(5, 300, "Reason") }).strict()
    .refine(v => v.max_kg === undefined || v.max_kg > (v.min_kg ?? 0), { message: "The band must end above where it starts", path: ["max_kg"] }),
  retire_floor: z.object({ id: uuid }).strict(),
  floor_check: z.object({ quote_id: uuid }).strict(),
  floor_request: z.object({ quote_id: uuid, reason: text(10, 500, "Reason") }).strict(),
  floor_decide: z.object({ request_id: uuid, decision: z.enum(["approve", "reject"]), note: text(3, 300, "Note").optional() }).strict()
    .refine(v => v.decision === "approve" || v.note, { message: "Say why the price is refused", path: ["note"] }),
  floor_requests: z.object({ page, status: z.enum(["requested", "approved", "rejected", "superseded", "all"]).optional() }).strict()
};

export const BATCH5_READS = ["customer", "stats", "chase", "history", "followups", "followup_queue", "followup_settings", "floors", "floor_check", "floor_requests"] as const;
export const FINISH_OPTIONS = ["mill_finish", "powder_coating", "anodizing", "anodized_silver", "anodized_bronze", "anodized_black", "wood_finish", "wood_grain", "pvdf", "other"] as const;
