// Autopilot batch 3 (order-to-cash): command schemas for public.ap_credit, ap_jobdrafts, ap_billing, ap_cash, ap_quotes and
// ap_dupes, plus labels shared by the screens. The database re-checks every command and takes the company and the actor from
// the session; these schemas only refuse malformed input early.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month");
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value), `${label}: remove control characters`);
const money = z.number().finite().min(0).max(999_999_999_999.99);
const allocation = z.object({ invoice_id: uuid, amount: z.number().finite().positive().max(999_999_999_999.99) }).strict();

export const APPROVER_ROLES = ["owner", "admin", "accounts", "sales_manager"] as const;
export const PAYMENT_METHODS = { bank_transfer: "Bank transfer (NEFT/RTGS/IMPS)", upi: "UPI", cheque: "Cheque", cash: "Cash", other: "Other" } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
export const REMINDER_CHANNELS = { whatsapp: "WhatsApp", email: "Email", phone_call: "Phone call", other: "Other" } as const;
export type ReminderChannel = keyof typeof REMINDER_CHANNELS;

export const creditCommands = {
  customer: z.object({ customer_id: uuid }).strict(),
  set_limit: z.object({ customer_id: uuid, credit_limit: money, credit_days: z.number().int().min(0).max(365).optional(), grace_days: z.number().int().min(0).max(180).optional(),
    reason: text(5, 300, "Reason") }).strict(),
  remove_limit: z.object({ customer_id: uuid, reason: text(5, 300, "Reason") }).strict(),
  order: z.object({ order_id: uuid }).strict(),
  request: z.object({ order_id: uuid }).strict(),
  holds: z.object({ status: z.enum(["held", "approved", "rejected", "cleared", "all"]).optional(), page }).strict(),
  decide: z.object({ hold_id: uuid, decision: z.enum(["approve", "reject"]), note: text(3, 500, "Note").optional() }).strict()
    .refine(value => value.decision === "approve" || value.note, { message: "Say why credit is refused", path: ["note"] }),
  settings: z.object({}).strict(),
  save_settings: z.object({
    credit_approver_roles: z.array(z.enum(APPROVER_ROLES)).min(1).max(4).optional(), credit_approval_hours: z.number().int().min(1).max(720).optional(),
    quote_extension_needs_approval: z.boolean().optional(), quote_extension_roles: z.array(z.enum(APPROVER_ROLES)).min(1).max(4).optional(),
    reminder_steps: z.array(z.number().int().min(-30).max(180)).min(1).max(8).optional(), reminder_repeat_days: z.number().int().min(1).max(60).optional(),
    duplicate_window_days: z.number().int().min(1).max(30).optional()
  }).strict(),
  remove_remitter: z.object({ id: uuid }).strict()
};

export const jobDraftCommands = {
  list: z.object({ page, search: z.string().trim().max(60).optional(), status: z.enum(["open", "released", "cancelled"]).optional() }).strict(),
  draft: z.object({ id: uuid }).strict(),
  order: z.object({ order_id: uuid }).strict(),
  prepare: z.object({ order_id: uuid }).strict(),
  release: z.object({ id: uuid, machine_id: uuid.optional(), planned_date: day.optional(), line_ids: z.array(uuid).min(1).max(100).optional() }).strict(),
  remove_line: z.object({ line_id: uuid, reason: text(5, 300, "Reason") }).strict(),
  stats: z.object({}).strict()
};

export const billingCommands = {
  drafts: z.object({ status: z.enum(["open", "blocked", "posted", "cancelled", "all"]).optional(), page, search: z.string().trim().max(60).optional() }).strict(),
  draft: z.object({ id: uuid }).strict(),
  refresh: z.object({ id: uuid }).strict(),
  post_data: z.object({ ids: z.array(uuid).min(1).max(50) }).strict(),
  explain: z.object({ dispatch_id: uuid, reason: text(5, 300, "Reason") }).strict(),
  unbilled: z.object({ page, only_late: z.boolean().optional() }).strict(),
  gst_rule: z.object({}).strict(),
  gst_confirm: z.object({ hsn_profile: z.string().regex(/^(\d{4}|\d{6}|\d{8})$/, "HSN codes have 4, 6 or 8 digits").optional(),
    hsn_scrap: z.string().regex(/^(\d{4}|\d{6}|\d{8})$/, "HSN codes have 4, 6 or 8 digits").optional(), note: text(3, 300, "Note").optional() }).strict(),
  gst_derive: z.object({ customer_id: uuid.optional(), order_id: uuid.optional() }).strict().refine(v => v.customer_id || v.order_id, "Choose a customer or order"),
  gst_override: z.object({ dispatch_id: uuid, state: z.string().regex(/^\d{2}$/, "Choose a state"), reason: text(10, 300, "Reason") }).strict(),
  gst_sample: z.object({ page, only_mismatch: z.boolean().optional() }).strict(),
  hsn_apply: z.object({}).strict()
};

export const cashCommands = {
  propose: z.object({ customer_id: uuid, amount: z.number().finite().positive().max(999_999_999_999.99), narration: z.string().max(500).optional() }).strict(),
  post: z.object({ key: uuid, customer_id: uuid, amount: z.number().finite().positive().max(999_999_999_999.99), payment_date: day,
    payment_method: z.enum(Object.keys(PAYMENT_METHODS) as [PaymentMethod, ...PaymentMethod[]]), reference_number: text(1, 80, "Reference").optional(),
    notes: text(1, 300, "Notes").optional(), allocations: z.array(allocation).max(100), on_account: money, proposed: z.record(z.unknown()).optional() }).strict(),
  on_account: z.object({ customer_id: uuid.optional(), page }).strict(),
  apply_on_account: z.object({ credit_id: uuid, key: uuid, allocations: z.array(allocation).min(1).max(100).optional() }).strict(),
  bank_profiles: z.object({ header_signature: z.string().regex(/^[0-9a-f]{32}$/).optional() }).strict(),
  bank_statements: z.object({ page }).strict(),
  bank_lines: z.object({ state: z.enum(["waiting", "unmatched", "proposed", "receipted", "ignored", "all"]).optional(), class: z.enum(["exact", "likely", "unknown"]).optional(),
    search: z.string().trim().max(60).optional(), page, statement_id: uuid.optional() }).strict(),
  bank_assign: z.object({ line_id: uuid, customer_id: uuid }).strict(),
  bank_rematch: z.object({ line_id: uuid }).strict(),
  bank_ignore: z.object({ line_id: uuid, reason: text(5, 300, "Reason") }).strict(),
  bank_reverse: z.object({ line_id: uuid, reason: text(10, 300, "Reason") }).strict(),
  bank_rate: z.object({ month: month.optional() }).strict(),
  reminders: z.object({ date: day.optional(), status: z.enum(["prepared", "sent", "skipped", "superseded", "all"]).optional(), page }).strict(),
  reminder_copied: z.object({ id: uuid }).strict(),
  reminder_sent: z.object({ id: uuid, channel: z.enum(Object.keys(REMINDER_CHANNELS) as [ReminderChannel, ...ReminderChannel[]]) }).strict(),
  reminder_skip: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict(),
  reminder_coverage: z.object({ page }).strict(),
  prepare_reminders: z.object({}).strict(),
  customers: z.object({ search: z.string().trim().max(60).optional() }).strict()
};

export const quoteCommands = {
  validity: z.object({ quote_id: uuid }).strict(),
  extend: z.object({ quote_id: uuid, valid_until: day, reason: text(10, 500, "Reason") }).strict(),
  decide_extension: z.object({ request_id: uuid, decision: z.enum(["approve", "reject"]), note: text(3, 300, "Note").optional() }).strict()
    .refine(value => value.decision === "approve" || value.note, { message: "Say why the extension is rejected", path: ["note"] }),
  withdraw_extension: z.object({ request_id: uuid }).strict(),
  requote: z.object({ quote_id: uuid, reason: text(5, 300, "Reason").optional() }).strict(),
  requests: z.object({ page }).strict(),
  lapsed: z.object({ page }).strict()
};

export const DUPLICATE_KINDS = ["quote", "order", "receipt", "dispatch"] as const;
export type DuplicateKind = (typeof DUPLICATE_KINDS)[number];
export const dupeCommands = {
  check: z.object({ kind: z.enum(DUPLICATE_KINDS), customer_id: uuid.optional(), exclude_id: uuid.optional(), profile_ids: z.array(uuid).max(50).optional(),
    order_value: z.number().finite().optional(), quote_id: uuid.optional(), production_profile_id: uuid.optional(), production_quantity_kg: z.number().finite().optional(),
    amount: z.number().finite().optional(), reference_number: z.string().max(80).optional(), payment_date: day.optional(), order_id: uuid.optional(),
    total_weight_kg: z.number().finite().optional() }).strict(),
  acknowledge: z.object({ kind: z.enum(DUPLICATE_KINDS), matches: z.array(uuid).min(1).max(10), decision: z.enum(["saved_anyway", "opened_existing"]), note: text(3, 300, "Note").optional() }).strict(),
  attention: z.object({}).strict(),
  log: z.object({ page, kind: z.enum(DUPLICATE_KINDS).optional() }).strict(),
  scan: z.object({ page, kind: z.enum(["order", "receipt"]).optional() }).strict(),
  alerts: z.object({ page }).strict()
};

export const CASH_READS = ["customer", "order", "holds", "settings", "list", "draft", "stats", "drafts", "unbilled", "gst_rule", "gst_derive", "gst_sample", "propose", "on_account",
  "bank_profiles", "bank_statements", "bank_lines", "bank_rate", "reminders", "reminder_coverage", "customers", "validity", "requests", "lapsed", "check", "attention", "log", "scan",
  "alerts", "post_data"] as const;

export const GST_STATE_OPTIONS: ReadonlyArray<[string, string]> = [
  ["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"],
  ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"], ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"],
  ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"],
  ["26", "Dadra and Nagar Haveli and Daman and Diu"], ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"],
  ["34", "Puducherry"], ["35", "Andaman and Nicobar Islands"], ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"]
];

/** Indian digit grouping (12,34,567.00), the same as private.ap3_inr. */
export function inr(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `₹${number.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const fmtDay = (value: unknown) => (typeof value === "string" && value
  ? new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");
export const fmtWhen = (value: unknown) => (typeof value === "string" && value
  ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

/** A wa.me link for an Indian mobile number; null when the number is not a 10-digit mobile (with or without 91). */
export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const mobile = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(mobile)) return null;
  return `https://wa.me/91${mobile}?text=${encodeURIComponent(message)}`;
}

/** A random v4 identity for one submission (idempotency key), so a retried tap posts once. */
export function newKey(): string {
  return globalThis.crypto.randomUUID();
}
