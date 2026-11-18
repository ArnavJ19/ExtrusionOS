// Autopilot batch 7: command schemas for the database gateways public.ap_quality (AP-003), ap_price (AP-057),
// ap_delay (AP-064) and ap_statement (AP-079). The database re-checks every command and takes the company and the actor
// from the session; these schemas only refuse malformed input early.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const search = z.string().trim().max(80).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const clean = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`).refine(clean, `${label}: remove control characters`);
/** Message text may contain line breaks; other control characters are refused. */
const message = z.string().max(4000, "Message: at most 4000 characters").refine(v => v.replace(/\r/g, "").trim().length >= 20, "Message: at least 20 characters")
  .refine(v => !/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(v), "Message: remove control characters");
const weeks = z.union([z.literal(4), z.literal(12)]).optional();
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose the month").optional();

export const QUALITY_READERS = ["owner", "admin", "factory_manager"] as const;
export const QUALITY_RECORDERS = ["owner", "admin"] as const;
export const PRICE_READERS = ["owner", "admin", "accounts", "inventory_manager", "factory_manager"] as const;
export const PRICE_JUSTIFIERS = ["owner", "admin", "accounts"] as const;
export const DELAY_READERS = ["owner", "admin", "sales_manager", "sales", "factory_manager", "dispatch_manager"] as const;
export const DELAY_SENDERS = ["owner", "admin", "sales_manager", "sales"] as const;
export const STATEMENT_ROLES = ["owner", "admin", "accounts"] as const;

export const qualityCommands = {
  overview: z.object({ weeks }).strict(),
  weekly: z.object({ weeks, proposal_type: text(3, 60, "Proposal type") }).strict(),
  roles: z.object({ weeks, proposal_type: text(3, 60, "Proposal type") }).strict(),
  corrections: z.object({ weeks, proposal_type: text(3, 60, "Proposal type") }).strict(),
  changes: z.object({ weeks, page, proposal_type: text(3, 60, "Proposal type").optional() }).strict(),
  record_change: z.object({ proposal_type: text(3, 60, "Proposal type"), changed_on: day, description: text(10, 500, "What changed") }).strict(),
  compare: z.object({ id: uuid }).strict()
};

export const PURCHASE_UNITS = ["kg", "m", "piece", "set", "box", "lot"] as const;
export const priceCommands = {
  history: z.object({ description: z.string().trim().max(240), unit: z.enum(PURCHASE_UNITS), vendor_id: uuid.optional(),
    rate: z.number().finite().min(0).max(1000000000).optional() }).strict(),
  order_checks: z.object({ purchase_order_id: uuid }).strict(),
  justify: z.object({ line_id: uuid, reason: text(10, 300, "Price reason") }).strict(),
  flagged: z.object({ page, show: z.enum(["all", "missing"]).optional() }).strict(),
  settings: z.object({}).strict(),
  save_settings: z.object({ variance_percent: z.number().finite().min(0.1).max(100).refine(v => Math.round(v * 100) === v * 100, "Use at most two decimals") }).strict()
};

const via = z.enum(["whatsapp", "email", "phone_call", "other"]);
export const delayCommands = {
  list: z.object({ page, search, status: z.enum(["prepared", "sent", "skipped", "superseded", "all"]).optional(), sort: z.enum(["date", "name"]).optional() }).strict(),
  order: z.object({ order_id: uuid }).strict(),
  get: z.object({ id: uuid }).strict(),
  edit: z.object({ id: uuid, message, new_date: day.optional() }).strict(),
  copy: z.object({ id: uuid }).strict(),
  send: z.object({ id: uuid, via }).strict(),
  skip: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict(),
  prepare: z.object({}).strict(),
  coverage: z.object({}).strict()
};

export const statementCommands = {
  queue: z.object({ page, search, status: z.enum(["prepared", "sent", "skipped", "superseded", "all"]).optional(), period, sort: z.enum(["date", "amount"]).optional() }).strict(),
  get: z.object({ id: uuid }).strict(),
  prepare: z.object({ period }).strict(),
  copy: z.object({ id: uuid }).strict(),
  // "email_provider" is recorded only by lib/actions/autopilot-batch7 after the provider accepted the email.
  send: z.object({ id: uuid, via: z.enum(["whatsapp", "email", "phone_call", "post", "other"]) }).strict(),
  skip: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict(),
  rebuild: z.object({ id: uuid }).strict(),
  coverage: z.object({ period }).strict()
};

export const BATCH7_READS = ["overview", "weekly", "roles", "corrections", "changes", "compare", "history", "order_checks", "flagged", "settings", "list", "order", "get",
  "coverage", "queue"] as const;

export const DELAY_STATUS: Record<string, string> = { prepared: "To send", sent: "Sent", skipped: "Skipped", superseded: "Replaced" };
export const SENT_VIA: Record<string, string> = { whatsapp: "WhatsApp", email: "Email", email_provider: "Email (sent by provider)", phone_call: "Phone call", post: "Post / courier", other: "Other" };
export const QUALITY_FLAGS: Record<string, string> = {
  review: "Overridden more than accepted: review the rule",
  sample: "Every decision accepted: sample a few to check they are not rubber-stamped",
  ignored: "Most proposals expire unanswered: check who should decide them"
};
