// Orchestration batch 3 (migration 20261122100000): dispatch finance clearance by payment terms and the customer
// dispatch update. The database decides clearance and records every message; this module validates requests and
// response shapes, names states, and composes the customer message from the safe dispatch facts (never prices).
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max).refine(noControl, "Remove control characters");

export const TERMS_LABELS: Record<string, string> = { credit: "Credit terms", advance_part: "Advance before dispatch", payment_before_dispatch: "Payment before dispatch" };
export const TERMS_SCOPE_LABELS: Record<string, string> = { company: "Company default", customer: "Customer", order: "Order", default: "Not set (credit terms)" };
export const CLEARANCE_STATE_LABELS: Record<string, string> = {
  not_required: "No clearance needed", covered: "Covered by receipts", released: "Released by accounts", blocked: "Awaiting finance clearance", dispatched: "Dispatched"
};
export const COMM_STATUS_LABELS: Record<string, string> = { sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed" };
export const CHANNEL_LABELS: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email", phone_call: "Phone call" };
export const FINANCE_CLEARANCE_ROLES = ["owner", "admin", "accounts"];
export const CUSTOMER_MESSAGE_SENDERS = ["owner", "admin", "dispatch_manager", "dispatch", "sales_manager", "sales", "factory_manager"];

export const dispatchFinanceCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("queue"), view: z.enum(["attention", "pending"]).optional(), page }).strict(),
  z.object({ command: z.literal("terms.list"), page }).strict(),
  z.object({
    command: z.literal("terms.set"), scope: z.enum(["company", "customer", "order"]), customer_id: uuid.optional(), order_id: uuid.optional(),
    terms: z.enum(["credit", "advance_part", "payment_before_dispatch"]), advance_percent: z.number().positive().max(100).optional(), reason: text(5, 300, "Record why these terms apply")
  }).strict(),
  z.object({ command: z.literal("terms.clear"), id: uuid, reason: text(5, 300, "Record why the terms are removed") }).strict(),
  z.object({ command: z.literal("status"), dispatch_id: uuid }).strict(),
  z.object({
    command: z.literal("release"), dispatch_id: uuid, basis: z.enum(["payment_confirmed", "approved_exception"]), reference: z.string().trim().max(80).optional(),
    note: text(10, 500, "Record the basis of the release (at least 10 characters)")
  }).strict(),
  z.object({ command: z.literal("revoke"), release_id: uuid, reason: text(5, 300, "Record why the release is withdrawn") }).strict()
]).superRefine((v, ctx) => {
  if (v.command === "terms.set" && v.terms === "advance_part" && !v.advance_percent) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Record the advance percentage" });
  if (v.command === "terms.set" && v.scope === "customer" && !v.customer_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the customer" });
  if (v.command === "terms.set" && v.scope === "order" && !v.order_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the order" });
  if (v.command === "release" && v.basis === "payment_confirmed" && (v.reference ?? "").trim().length < 4) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Record the payment reference (UTR, cheque or receipt number)" });
});
export const DISPATCH_FINANCE_MUTATIONS = new Set(["terms.set", "terms.clear", "release", "revoke"]);

export const dispatchCommCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("queue"), view: z.enum(["pending", "sent"]).optional(), page }).strict(),
  z.object({ command: z.literal("facts"), dispatch_id: uuid }).strict(),
  z.object({
    command: z.literal("record_sent"), dispatch_id: uuid, channel: z.enum(["whatsapp", "sms", "email", "phone_call"]), recipient: text(5, 120, "Record who received the message"),
    body: text(20, 2000, "The message must be 20 to 2000 characters"), language: z.enum(["en", "hi"])
  }).strict(),
  z.object({ command: z.literal("mark"), id: uuid, status: z.enum(["delivered", "read", "failed"]), note: z.string().trim().max(300).refine(noControl, "Remove control characters").optional() }).strict()
]).superRefine((v, ctx) => {
  if (v.command === "mark" && v.status === "failed" && (v.note ?? "").trim().length < 5) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Record why the message failed" });
});
export const DISPATCH_COMM_MUTATIONS = new Set(["record_sent", "mark"]);

const money = z.coerce.number().nullable();
const terms = z.object({ id: z.string().nullable(), terms: z.string(), advance_percent: z.coerce.number().nullable(), scope: z.string(), reason: z.string().nullable(), label: z.string() });
const release = z.object({ id: z.string(), basis: z.string(), reference: z.string().nullable(), note: z.string(), released_at: z.string(), expires_at: z.string(), consumed_at: z.string().nullable(),
  expired: z.boolean(), value_grown: z.boolean(), released_by_name: z.string().nullable() }).passthrough();
export const clearanceSchema = z.object({
  dispatch_id: z.string(), dispatch_number: z.string().nullable(), order_id: z.string().nullable(), order_number: z.string().nullable(), customer_name: z.string().nullable(),
  created_at: z.string().nullable(), delivery_status: z.string().nullable(), bundles: z.number(), net_weight_kg: z.coerce.number(),
  state: z.string(), terms, requires_clearance: z.boolean(), priced: z.boolean(), release: release.nullable(),
  amounts: z.object({ dispatch_value: money, earlier_dispatched_value: money, order_value: money, required: money, paid_on_order: money, customer_advance: money,
    other_obligations: money.optional(), advance_available: money.optional(), received: money, shortfall: money, released_value: money }).nullable().optional()
}).passthrough();
export type Clearance = z.infer<typeof clearanceSchema>;
export const clearanceQueueSchema = z.object({
  view: z.string(), page: z.number(), page_size: z.number(), total: z.number(), finance_visible: z.boolean(), can_release: z.boolean(), can_set_terms: z.boolean(),
  company_terms: z.object({ id: z.string(), terms: z.string(), advance_percent: z.coerce.number().nullable(), label: z.string(), reason: z.string() }).nullable(), rows: z.array(clearanceSchema)
});
export const clearanceDetailSchema = clearanceSchema.extend({
  finance_visible: z.boolean(), can_release: z.boolean(), can_exception: z.boolean(),
  releases: z.array(z.object({ id: z.string(), basis: z.string(), reference: z.string().nullable(), note: z.string(), released_at: z.string(), expires_at: z.string(),
    consumed_at: z.string().nullable(), revoked_at: z.string().nullable(), revoke_reason: z.string().nullable(), released_value: money.optional(), released_by_name: z.string().nullable(), can_revoke: z.boolean() }))
});
export type ClearanceDetail = z.infer<typeof clearanceDetailSchema>;
export const termsListSchema = z.object({
  page: z.number(), page_size: z.number(), total: z.number(), can_set_terms: z.boolean(), customers: z.array(z.object({ id: z.string(), name: z.string() })),
  rows: z.array(z.object({ id: z.string(), scope: z.string(), terms: z.string(), advance_percent: z.coerce.number().nullable(), label: z.string(), reason: z.string(), set_at: z.string(),
    set_by_name: z.string().nullable(), customer_id: z.string().nullable(), customer_name: z.string().nullable(), order_id: z.string().nullable(), order_number: z.string().nullable() }))
});
export type TermsRow = z.infer<typeof termsListSchema>["rows"][number];

export const dispatchFactsSchema = z.object({
  dispatch_id: z.string(), dispatch_number: z.string().nullable(), dispatched_at: z.string().nullable(), delivery_status: z.string(), order_id: z.string().nullable(),
  order_number: z.string().nullable(), customer_name: z.string().nullable(), contact_person: z.string().nullable(), customer_po: z.string().nullable(), company_name: z.string().nullable(),
  vehicle_number: z.string().nullable(), driver_name: z.string().nullable(), driver_phone: z.string().nullable(), transporter_name: z.string().nullable(), lr_number: z.string().nullable(),
  eway_bill_number: z.string().nullable(), invoice_numbers: z.array(z.string()), bundles: z.number(), pieces: z.coerce.number(), net_weight_kg: z.coerce.number(),
  items: z.array(z.object({ profile_code: z.string().nullable(), component_code: z.string().nullable(), pieces: z.coerce.number(), net_weight_kg: z.coerce.number(), bundles: z.number() })),
  expected_delivery: z.string().nullable(), recipients: z.array(z.object({ channel: z.string(), value: z.string(), label: z.string() })),
  can_send: z.boolean().default(false),
  history: z.array(z.object({ id: z.string(), channel: z.string(), recipient: z.string(), language: z.string(), message_body: z.string(), status: z.string(), sent_at: z.string(),
    delivered_at: z.string().nullable(), read_at: z.string().nullable(), failed_at: z.string().nullable(), failed_reason: z.string().nullable(), note: z.string().nullable(),
    sent_by_name: z.string().nullable(), can_mark: z.boolean() })).default([])
});
export type DispatchFacts = z.infer<typeof dispatchFactsSchema>;
export const commQueueSchema = z.object({ view: z.string(), page: z.number(), page_size: z.number(), total: z.number(), can_send: z.boolean(), rows: z.array(z.record(z.unknown())) });

const IST = "Asia/Kolkata";
const day = (value: string | null, lang: "en" | "hi") => (value ? new Date(value).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric" }) : null);
const kg = (value: number) => `${Math.round(value).toLocaleString("en-IN")} kg`;

const WORDS = {
  en: { greet: "Dear", order: "Your order", po: "PO", left: "has been dispatched from", on: "on", dispatch: "Dispatch", vehicle: "Vehicle", driver: "Driver", transporter: "Transporter",
    lr: "LR", ewb: "E-way bill", invoice: "Invoice", material: "Material", bundles: "bundles", pcs: "pcs", net: "net", expected: "Expected delivery",
    close: "Please check the bundle count and weight on arrival and confirm receipt.", us: "us" },
  hi: { greet: "आदरणीय", order: "आपका ऑर्डर", po: "पीओ", left: "भेज दिया गया है —", on: "दिनांक", dispatch: "डिस्पैच", vehicle: "वाहन", driver: "ड्राइवर", transporter: "ट्रांसपोर्टर",
    lr: "एलआर", ewb: "ई-वे बिल", invoice: "इनवॉइस", material: "माल", bundles: "बंडल", pcs: "पीस", net: "शुद्ध", expected: "अनुमानित डिलीवरी",
    close: "कृपया माल पहुँचने पर बंडल की संख्या और वज़न जाँचें और प्राप्ति की पुष्टि करें।", us: "हमारी ओर से" }
} as const;

/** The customer dispatch update, from logistics facts only (no prices, costs or internal notes). Missing facts are left out. */
export function composeDispatchMessage(f: DispatchFacts, lang: "en" | "hi" = "en"): string {
  const w = WORDS[lang];
  const from = f.company_name ?? w.us;
  const lines: (string | null)[] = [
    `${w.greet} ${f.contact_person || f.customer_name || ""}`.trim() + ",",
    lang === "hi"
      ? `${w.order} ${f.order_number ?? ""}${f.customer_po ? ` (${w.po} ${f.customer_po})` : ""} ${from} से ${w.left} ${w.on} ${day(f.dispatched_at, lang) ?? ""}।`.replace(/\s+/g, " ").trim()
      : `${w.order} ${f.order_number ?? ""}${f.customer_po ? ` (${w.po} ${f.customer_po})` : ""} ${w.left} ${from}${f.dispatched_at ? ` ${w.on} ${day(f.dispatched_at, lang)}` : ""}.`.replace(/\s+/g, " ").trim(),
    f.dispatch_number ? `${w.dispatch}: ${f.dispatch_number}` : null,
    f.vehicle_number || f.driver_name ? [f.vehicle_number ? `${w.vehicle}: ${f.vehicle_number}` : null, f.driver_name ? `${w.driver}: ${f.driver_name}${f.driver_phone ? ` (${f.driver_phone})` : ""}` : null].filter(Boolean).join(" · ") : null,
    f.transporter_name || f.lr_number ? [f.transporter_name ? `${w.transporter}: ${f.transporter_name}` : null, f.lr_number ? `${w.lr}: ${f.lr_number}` : null].filter(Boolean).join(" · ") : null,
    f.eway_bill_number ? `${w.ewb}: ${f.eway_bill_number}` : null,
    f.invoice_numbers.length ? `${w.invoice}: ${f.invoice_numbers.join(", ")}` : null,
    `${w.material}: ${f.bundles} ${w.bundles}, ${f.pieces} ${w.pcs}, ${kg(f.net_weight_kg)} ${w.net}`,
    ...f.items.map(i => `- ${[i.profile_code, i.component_code].filter(Boolean).join(" / ") || "—"}: ${i.pieces} ${w.pcs}, ${kg(i.net_weight_kg)}`),
    f.expected_delivery ? `${w.expected}: ${day(f.expected_delivery, lang)}` : null,
    w.close,
    `— ${from}`
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

/** Digits for a phone number; a 10-digit Indian mobile (or 0-prefixed) gets the 91 country code. */
export function phoneDigits(value: string): string {
  const d = value.replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  return d;
}

/** The link that opens the prepared message in the staff member's own app; nothing is sent by the system. */
export function messageLink(channel: string, recipient: string, body: string): string | null {
  if (channel === "whatsapp") return `https://wa.me/${phoneDigits(recipient)}?text=${encodeURIComponent(body)}`;
  if (channel === "sms") return `sms:${phoneDigits(recipient)}?body=${encodeURIComponent(body)}`;
  if (channel === "email") return `mailto:${recipient.trim()}?subject=${encodeURIComponent("Dispatch update")}&body=${encodeURIComponent(body)}`;
  if (channel === "phone_call") return `tel:+${phoneDigits(recipient)}`;
  return null;
}

export const formatInr = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
