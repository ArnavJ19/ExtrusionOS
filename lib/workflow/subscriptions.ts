// UPGRADE_EOS feature 48 (controlled subscriptions and grouped notifications). The database
// records events on followed records, groups them into one digest per person and delivery window,
// and reminds about action requests until their condition is resolved; this module validates
// commands and responses and formats summaries.
import { z } from "zod";

export const FOLLOW_TYPES = {
  order: { label: "Order", href: "/orders", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"], categories: ["status", "production", "quality", "dispatch", "payment"] },
  production_job: { label: "Production job", href: "/production", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "viewer"], categories: ["status", "quality"] },
  dispatch: { label: "Dispatch", href: "/dispatches", roles: ["owner", "admin", "sales_manager", "sales", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "viewer"], categories: ["dispatch"] },
  quality_inspection: { label: "Inspection", href: "/quality", roles: ["owner", "admin", "production_manager", "quality", "viewer"], categories: ["quality"] },
  quote: { label: "Quotation", href: "/quotes", roles: ["owner", "admin", "sales_manager", "sales", "accounts", "viewer"], categories: ["status"] },
  invoice: { label: "Invoice", href: "/invoices", roles: ["owner", "admin", "accounts", "viewer"], categories: ["payment"] }
} as const;
export type FollowType = keyof typeof FOLLOW_TYPES;
const FOLLOW_KEYS = Object.keys(FOLLOW_TYPES) as [FollowType, ...FollowType[]];
export const CATEGORY_LABELS = { status: "Status changes", production: "Production progress", quality: "Quality results", dispatch: "Dispatch and delivery", payment: "Invoices and payments" } as const;
export type Category = keyof typeof CATEGORY_LABELS;
const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS) as [Category, ...Category[]];

export const REQUEST_TYPES = {
  approve_quote: { label: "Approve the quotation", entities: ["quote"], resolves: "when the quotation leaves internal review" },
  record_payment: { label: "Record the payment", entities: ["invoice"], resolves: "when the invoice has no balance" },
  release_qc: { label: "Release or reject the inspection", entities: ["quality_inspection"], resolves: "when the inspection is no longer pending" },
  confirm_dispatch: { label: "Confirm the dispatch", entities: ["dispatch", "order"], resolves: "when the material is dispatched or delivered" },
  general: { label: "Something else", entities: ["order", "production_job", "dispatch", "quality_inspection", "quote", "invoice"], resolves: "when the person you ask marks it done" }
} as const;
export type RequestType = keyof typeof REQUEST_TYPES;
const REQUEST_KEYS = Object.keys(REQUEST_TYPES) as [RequestType, ...RequestType[]];

/** Whether a role may open (and so follow) a kind of record; dealers never follow. */
export const canFollow = (role: string, type: FollowType) => (FOLLOW_TYPES[type].roles as readonly string[]).includes(role);
export const requestTypesFor = (type: FollowType) => REQUEST_KEYS.filter((key) => (REQUEST_TYPES[key].entities as readonly string[]).includes(type));
export const canRunDelivery = (role: string) => ["owner", "admin", "factory_manager"].includes(role);

const uuid = z.string().uuid();
const record = { entity_type: z.enum(FOLLOW_KEYS), entity_id: uuid };
const page = z.number().int().min(1).max(100000).default(1);
const hour = z.number().int().min(0).max(23);

const commandSchemas = {
  "follow.status": z.object({ command: z.literal("follow.status"), ...record }).strict(),
  "follow.set": z.object({ command: z.literal("follow.set"), ...record, categories: z.array(z.enum(CATEGORY_KEYS)).min(1, "Choose at least one kind of update to follow").max(5) }).strict()
    .refine((value) => value.categories.every((c) => (FOLLOW_TYPES[value.entity_type].categories as readonly string[]).includes(c)), "A chosen kind of update does not apply to this record"),
  "follow.remove": z.object({ command: z.literal("follow.remove"), ...record }).strict(),
  "follow.list": z.object({ command: z.literal("follow.list"), page }).strict(),
  "prefs.get": z.object({ command: z.literal("prefs.get") }).strict(),
  "prefs.set": z.object({
    command: z.literal("prefs.set"), digest_mode: z.enum(["immediate", "hourly", "daily"]), daily_hour: hour.default(18),
    quiet_start: hour.nullable().default(null), quiet_end: hour.nullable().default(null), muted_categories: z.array(z.enum(CATEGORY_KEYS)).max(5).default([])
  }).strict().refine((value) => (value.quiet_start === null) === (value.quiet_end === null) && (value.quiet_start === null || value.quiet_start !== value.quiet_end), "Quiet hours need a different start and end"),
  "digest.list": z.object({ command: z.literal("digest.list"), page }).strict(),
  "digest.now": z.object({ command: z.literal("digest.now") }).strict(),
  "request.recipients": z.object({ command: z.literal("request.recipients"), ...record, request_type: z.enum(REQUEST_KEYS) }).strict(),
  "request.create": z.object({
    command: z.literal("request.create"), id: uuid, recipient_id: uuid, request_type: z.enum(REQUEST_KEYS), ...record,
    message: z.string().trim().min(3, "Say what you need (3 to 300 characters)").max(300, "Say what you need (3 to 300 characters)"),
    reminder_hours: z.number().int().min(1, "Remind every 1 to 72 hours").max(72, "Remind every 1 to 72 hours").default(4)
  }).strict().refine((value) => (REQUEST_TYPES[value.request_type].entities as readonly string[]).includes(value.entity_type), "This kind of request does not apply to this record"),
  "request.list": z.object({ command: z.literal("request.list"), box: z.enum(["inbox", "sent"]).default("inbox"), state: z.enum(["open", "resolved"]).default("open"), page }).strict(),
  "request.close": z.object({ command: z.literal("request.close"), id: uuid, note: z.string().trim().max(300).default("") }).strict(),
  "delivery.run": z.object({ command: z.literal("delivery.run") }).strict()
} as const;
export type SubscriptionCommandName = keyof typeof commandSchemas;
export const SUBSCRIPTION_WRITE_COMMANDS: readonly SubscriptionCommandName[] = ["follow.set", "follow.remove", "prefs.set", "digest.now", "request.create", "request.close", "delivery.run"];

export function parseSubscriptionCommand(input: unknown) {
  const name = input && typeof input === "object" ? (input as { command?: unknown }).command : undefined;
  if (typeof name !== "string" || !(name in commandSchemas)) return { success: false as const, error: "Invalid notification request" };
  const parsed = commandSchemas[name as SubscriptionCommandName].safeParse(input);
  if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid notification request" };
  return { success: true as const, data: parsed.data as { command: SubscriptionCommandName } & Record<string, unknown> };
}

export const followStatusSchema = z.object({ following: z.boolean(), categories: z.array(z.enum(CATEGORY_KEYS)), available: z.array(z.enum(CATEGORY_KEYS)) }).strict();
export const followListSchema = z.object({
  rows: z.array(z.object({ entity_type: z.enum(FOLLOW_KEYS), entity_id: uuid, categories: z.array(z.enum(CATEGORY_KEYS)), created_at: z.string(), label: z.string(), state: z.string().nullable(), can_open: z.boolean() }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();
export const preferencesSchema = z.object({
  digest_mode: z.enum(["immediate", "hourly", "daily"]), daily_hour: z.number().int(), quiet_start: z.number().int().nullable(), quiet_end: z.number().int().nullable(),
  muted_categories: z.array(z.enum(CATEGORY_KEYS)), last_digest_at: z.string().nullable(), updated_at: z.string().nullable()
}).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
const digestItem = z.object({ entity_type: z.enum(FOLLOW_KEYS), entity_id: uuid, label: z.string(), updates: z.number().int(), latest: z.string(), earlier: z.array(z.string()), last_at: z.string() }).strict();
export const digestListSchema = z.object({
  rows: z.array(z.object({ id: uuid, period_start: z.string(), period_end: z.string(), record_count: z.number().int(), event_count: z.number().int(), items: z.array(digestItem), notification_id: uuid.nullable(), created_at: z.string() }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();
export type Digest = z.infer<typeof digestListSchema>["rows"][number];
export const recipientsSchema = z.array(z.object({ id: uuid, name: z.string(), role: z.string() }).strict());
export const requestListSchema = z.object({
  rows: z.array(z.object({
    id: uuid, request_type: z.enum(REQUEST_KEYS), entity_type: z.enum(FOLLOW_KEYS), entity_id: uuid, label: z.string(), message: z.string(), requester_name: z.string().nullable(), recipient_name: z.string().nullable(),
    created_at: z.string(), reminder_count: z.number().int(), reminder_hours: z.number().int(), resolved_at: z.string().nullable(),
    resolution: z.enum(["condition_met", "done", "cancelled", "source_missing", "recipient_unavailable"]).nullable(), resolution_note: z.string().nullable(), can_close: z.boolean()
  }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();
export type ActionRequest = z.infer<typeof requestListSchema>["rows"][number];
export const deliverySchema = z.object({ digests: z.number().int(), resolved: z.number().int(), reminded: z.number().int() }).strict();

export const RESOLUTION_LABELS: Record<NonNullable<ActionRequest["resolution"]>, string> = {
  condition_met: "Resolved by the record", done: "Marked done", cancelled: "Withdrawn", source_missing: "Record no longer available", recipient_unavailable: "Recipient can no longer act"
};

export const recordHref = (type: FollowType, id: string) => `${FOLLOW_TYPES[type].href}/${id}`;

/** A WhatsApp-friendly copy of a digest: one line per record, plain text. */
export function digestWhatsAppText(digest: Pick<Digest, "items" | "event_count" | "record_count" | "period_end">, formatTime: (iso: string) => string) {
  const lines = digest.items.map((item) => `• ${item.label}: ${item.latest}${item.updates > 1 ? ` (${item.updates} updates)` : ""}`);
  const extra = digest.record_count - digest.items.length;
  return [`*Updates till ${formatTime(digest.period_end)}*`, ...lines, ...(extra > 0 ? [`…and ${extra} more record${extra === 1 ? "" : "s"}`] : [])].join("\n");
}

/** "22:00 – 07:00 IST" or "Off". */
export const quietText = (start: number | null, end: number | null) => (start === null || end === null ? "Off" : `${String(start).padStart(2, "0")}:00 – ${String(end).padStart(2, "0")}:00 IST`);
