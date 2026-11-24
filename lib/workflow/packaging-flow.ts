// Order lifecycle orchestration Phase 6 (migration 20261125100000): packaging release by route, the bundle register and
// trace, finished-goods transfers and the invoice of a dispatch. The database derives every quantity and state and
// enforces who may send, receive, close or cancel a transfer; this module validates requests and response shapes and
// names states for the screens.
import { z } from "zod";

const uuid = z.string().uuid();
const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const search = z.string().trim().max(80).refine(noControl, "Remove control characters").optional();
const page = z.number().int().min(1).max(100000).optional();
const direction = z.enum(["asc", "desc"]).optional();
const note = (min: number, message: string) => z.string().trim().min(min, message).max(500).refine(noControl, "Remove control characters");
/** A scanned or typed tag: what a label carries (the bundle tag, or an EO2 label), never a link or control characters. */
export const tagSchema = z.string().trim().min(1, "Scan or type a bundle tag").max(160).refine(noControl, "Rescan the label: it contains control characters")
  .refine(v => !/\s/.test(v), "Bundle tags do not contain spaces. Rescan the label or type it again.")
  .refine(v => !/^[a-z][a-z0-9+.-]*:\/\//i.test(v), "This is a link, not a bundle label.");

export const FG_SENDERS = ["owner", "admin", "factory_manager", "production_manager", "production", "dispatch_manager", "dispatch"];
export const FG_RECEIVERS = ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager"];
export const BUNDLE_WRITERS = ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager"];
export const canSendFg = (role: string) => FG_SENDERS.includes(role);
export const canReceiveFg = (role: string) => FG_RECEIVERS.includes(role);

export const RELEASE_VIEWS = ["to_pack", "held", "all"] as const;
export const RELEASE_SORTS = ["completed_at", "job_number", "to_pack_kg", "release_kg"] as const;
export const BUNDLE_STATES = ["packed", "in_transfer", "in_fg", "loaded", "dispatched", "delivered"] as const;
export const BUNDLE_SORTS = ["recorded_at", "bundle_number", "net_kg"] as const;
export const FG_SORTS = ["sent_at", "transfer_number", "bundle_count"] as const;
export const RELEASE_BASES = ["final_qc", "first_qc", "first_qc_route_undocumented", "held"] as const;
export const FG_STATUSES = ["in_transit", "received", "closed_short", "cancelled"] as const;
export const FG_LINE_STATES = ["sent", "received", "missing", "withdrawn"] as const;
export const MAX_TRANSFER_BUNDLES = 60;

export const packagingFlowCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("release.queue"), view: z.enum(RELEASE_VIEWS).optional(), page, search, sort: z.enum(RELEASE_SORTS).optional(), direction }).strict(),
  z.object({ command: z.literal("release.get"), job_id: uuid }).strict(),
  z.object({
    command: z.literal("bundles.list"), state: z.enum(["all", ...BUNDLE_STATES]).optional(), not_invoiced: z.boolean().optional(), page, search,
    sort: z.enum(BUNDLE_SORTS).optional(), direction
  }).strict(),
  z.object({ command: z.literal("bundle.trace"), bundle_id: uuid.optional(), tag: tagSchema.optional() }).strict(),
  z.object({ command: z.literal("bundle.resolve"), tag: tagSchema }).strict(),
  z.object({ command: z.literal("fg.locations") }).strict(),
  z.object({ command: z.literal("fg.candidates"), page, search, order_id: uuid.optional() }).strict(),
  z.object({ command: z.literal("fg.list"), view: z.enum(["open", "done"]).optional(), page, search, sort: z.enum(FG_SORTS).optional(), direction }).strict(),
  z.object({ command: z.literal("fg.get"), transfer_id: uuid }).strict(),
  z.object({
    command: z.literal("fg.send"), id: uuid, location_id: uuid,
    bundle_ids: z.array(uuid).min(1, "Choose at least one bundle").max(MAX_TRANSFER_BUNDLES, `Send at most ${MAX_TRANSFER_BUNDLES} bundles on one transfer`)
      .refine(ids => new Set(ids).size === ids.length, "A bundle appears twice on the transfer"),
    note: z.string().trim().max(500).refine(noControl, "Remove control characters").optional()
  }).strict(),
  z.object({ command: z.literal("fg.receive"), transfer_id: uuid, tag: tagSchema }).strict(),
  z.object({ command: z.literal("fg.close"), transfer_id: uuid, note: note(10, "Write what happened to the bundles that did not arrive (at least 10 characters)") }).strict(),
  z.object({ command: z.literal("fg.cancel"), transfer_id: uuid, note: note(10, "Write why the transfer is cancelled (at least 10 characters)") }).strict()
]).superRefine((v, ctx) => {
  if (v.command === "bundle.trace" && (v.bundle_id === undefined) === (v.tag === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Scan or type one bundle tag" });
  }
});
export type PackagingFlowCommand = z.input<typeof packagingFlowCommandSchema>;
export const PACKAGING_FLOW_MUTATIONS = new Set(["fg.send", "fg.receive", "fg.close", "fg.cancel"]);

export function releaseSort(value: string | undefined): (typeof RELEASE_SORTS)[number] {
  return (RELEASE_SORTS as readonly string[]).includes(value ?? "") ? value as (typeof RELEASE_SORTS)[number] : "completed_at";
}
export function bundleSort(value: string | undefined): (typeof BUNDLE_SORTS)[number] {
  return (BUNDLE_SORTS as readonly string[]).includes(value ?? "") ? value as (typeof BUNDLE_SORTS)[number] : "recorded_at";
}
export function fgSort(value: string | undefined): (typeof FG_SORTS)[number] {
  return (FG_SORTS as readonly string[]).includes(value ?? "") ? value as (typeof FG_SORTS)[number] : "sent_at";
}

// ---------------------------------------------------------------- response shapes (the database is the source)
const kg = z.coerce.number();
const nkg = z.coerce.number().nullable();
const text = z.string().nullable();
const list = <T extends z.ZodTypeAny>(row: T) => z.object({ page: z.number(), page_size: z.number(), total: z.number(), rows: z.array(row) }).passthrough();

export const releaseRowSchema = z.object({
  job_id: z.string(), job_number: text, order_id: z.string(), order_number: text, customer: text, profile_code: text, job_status: z.string(), completed_at: text,
  route: z.string(), stage: z.string(), basis: z.enum(RELEASE_BASES), release_kg: kg, packed_kg: kg, to_pack_kg: kg, held_kg: kg, containment: text
}).passthrough();
export const releaseQueueSchema = list(releaseRowSchema);
export type ReleaseRow = z.infer<typeof releaseRowSchema>;

export const releaseSchema = z.object({ basis: z.enum(RELEASE_BASES), release_kg: kg, packed_kg: kg, to_pack_kg: kg }).passthrough();
export const bundleRowSchema = z.object({
  id: z.string(), bundle_number: z.string(), state: z.enum(BUNDLE_STATES), order_id: z.string(), order_number: text, job_id: text, job_number: text, profile_code: text,
  source_kind: z.string(), pieces: z.number(), net_kg: kg, recorded_at: z.string(), location: text, transfer_number: text, dispatch_id: text, dispatch_number: text,
  invoice_number: text, held: z.boolean()
}).passthrough();
export const bundleListSchema = list(bundleRowSchema).extend({ enforce_fg_receipt: z.boolean() });
export type BundleRow = z.infer<typeof bundleRowSchema>;

export const releaseDetailSchema = z.object({
  job: z.object({ id: z.string(), job_number: text, status: z.string(), completed_at: text, order_id: z.string(), order_number: text, customer: text, expected_dispatch_date: text,
    profile_code: text, profile_name: text, alloy: text, temper: text, machine_name: text }).passthrough(),
  flow: z.record(z.unknown()).nullable(), release: releaseSchema.nullable(), containment: text, spec: z.record(z.unknown()).nullable(), spec_text: z.string(),
  bundles: z.array(z.object({ id: z.string(), bundle_number: z.string(), state: z.enum(BUNDLE_STATES), pieces: z.number(), net_kg: kg, location: text, dispatch_number: text,
    invoice_number: text, recorded_at: z.string() }).passthrough()),
  packaging_jobs: z.array(z.object({ id: z.string(), packaging_number: z.string(), status: z.string(), weight_kg: kg, pieces: z.number(), scheduled_date: text }).passthrough()),
  handoffs: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), quantity_kg: nkg, acceptance: text }).passthrough()),
  can_record_bundles: z.boolean()
}).passthrough();
export type ReleaseDetail = z.infer<typeof releaseDetailSchema>;

const traceJob = z.object({ id: z.string(), job_number: text, status: z.string(), completed_at: text, actual_quantity_kg: nkg, machine_name: text, die_number: text }).passthrough();
export const bundleTraceSchema = z.object({
  found: z.literal(true),
  bundle: z.object({ id: z.string(), bundle_number: z.string(), state: z.enum(BUNDLE_STATES), source_kind: z.string(), pieces: z.number(), net_length_m: kg, gross_kg: kg, tare_kg: kg,
    net_kg: kg, recorded_at: z.string(), recorded_by: text, location: text, transfer_number: text, loaded_vehicle: text }).passthrough(),
  order: z.object({ id: z.string(), order_number: text, customer: text, stage: text }).passthrough(),
  profile: z.object({ profile_code: text, profile_name: text, alloy: text, temper: text }).passthrough().nullable(),
  stock: z.object({ bundle_number: text, origin_type: z.string(), qc_status: z.string() }).passthrough().nullable(),
  job: traceJob.nullable(), route: z.object({ state: z.string(), detail: text.optional() }).passthrough().nullable(),
  billets: z.array(z.object({ billet_code: z.string(), alloy: text, temper: text, weight_kg: nkg, source_type: z.string(), batch_number: text, heat_number: text, issued_at: text }).passthrough()),
  qc: z.array(z.object({ id: z.string(), batch_number: text, status: z.string(), quantity_kg: kg, inspected_at: text, inspector: text, from_reversal: z.boolean() }).passthrough()),
  ageing: z.array(z.object({ batch_number: z.string(), status: z.string(), recipe: z.string(), loaded_kg: kg, accepted_kg: nkg, rejected_kg: nkg }).passthrough()),
  final_qc: z.array(z.object({ record_number: z.string(), accepted_kg: kg, rejected_kg: kg, method: z.string(), certificate_reference: text, recorded_at: z.string() }).passthrough()),
  hold: text,
  packaging: z.array(z.object({ packaging_number: z.string(), status: z.string(), weight_kg: kg, pieces: z.number() }).passthrough()),
  labels: z.object({ prints: z.coerce.number(), last_printed_at: text, active: z.coerce.number() }).passthrough().nullable(),
  custody: z.array(z.object({ transfer_id: z.string(), transfer_number: z.string(), location: z.string(), state: z.enum(FG_LINE_STATES), sent_at: z.string(), received_at: text,
    received_by: text, sent_by: text }).passthrough()),
  loading: z.array(z.object({ vehicle_number: text, scanned_at: z.string(), session_status: z.string(), removed: z.boolean() }).passthrough()),
  dispatch: z.object({ id: z.string(), dispatch_number: text, dispatch_date: text, delivery_status: z.string(), vehicle_number: text, transporter_name: text, lr_number: text,
    eway_bill_number: text, left_at: text, delivered_at: text }).passthrough().nullable(),
  invoices: z.array(z.object({ id: z.string(), invoice_number: text, status: z.string(), invoice_date: text }).passthrough()),
  invoice: z.object({ id: z.string(), invoice_number: text, status: z.string() }).passthrough().nullable(),
  gaps: z.array(z.string())
}).passthrough();
export type BundleTrace = z.infer<typeof bundleTraceSchema>;
export const bundleNotFoundSchema = z.object({ found: z.literal(false), tag: text.optional(), dispatch_id: text.optional(), dispatch_number: text.optional() }).passthrough();
export const bundleLookupSchema = z.union([bundleTraceSchema, bundleNotFoundSchema]);

export const bundleResolveSchema = z.union([
  z.object({ found: z.literal(true), id: z.string(), bundle_number: z.string(), state: z.enum(BUNDLE_STATES), order_number: text, job_number: text, profile_code: text,
    pieces: z.number(), net_kg: kg, location: text, transfer_id: text, transfer_number: text, dispatch_number: text, invoice_number: text, hold: text }).passthrough(),
  bundleNotFoundSchema
]);
export type BundleResolution = z.infer<typeof bundleResolveSchema>;

export const fgLocationsSchema = z.object({ rows: z.array(z.object({ id: z.string(), location_code: z.string(), location_name: z.string(), location_type: z.string() })), can_send: z.boolean() });
export const fgCandidateSchema = z.object({ id: z.string(), bundle_number: z.string(), order_id: z.string(), order_number: text, job_number: text, profile_code: text, pieces: z.number(),
  net_kg: kg, recorded_at: z.string(), hold: text }).passthrough();
export const fgCandidatesSchema = list(fgCandidateSchema);
export type FgCandidate = z.infer<typeof fgCandidateSchema>;
export const fgListRowSchema = z.object({ id: z.string(), transfer_number: z.string(), status: z.enum(FG_STATUSES), location: z.string(), bundle_count: z.number(), net_kg: kg,
  sent_by_name: text, sent_at: z.string(), closed_at: text, received: z.coerce.number(), missing: z.coerce.number() }).passthrough();
export const fgListSchema = list(fgListRowSchema).extend({ can_send: z.boolean() });
export const fgTransferSchema = z.object({
  id: z.string(), transfer_number: z.string(), status: z.enum(FG_STATUSES), location: z.string(), location_code: z.string(), bundle_count: z.number(), net_kg: kg, note: text,
  sent_by_name: text, sent_at: z.string(), closed_by_name: text, closed_at: text, close_note: text, received: z.coerce.number(), remaining: z.coerce.number(), missing: z.coerce.number(),
  lines: z.array(z.object({ bundle_id: z.string(), bundle_number: z.string(), order_id: z.string(), order_number: text, job_number: text, profile_code: text, pieces: z.number(), net_kg: kg,
    state: z.enum(FG_LINE_STATES), received_by_name: text, received_at: text }).passthrough()),
  can_receive: z.boolean(), can_cancel: z.boolean()
}).passthrough();
export type FgTransfer = z.infer<typeof fgTransferSchema>;
export const fgReceiveSchema = z.object({ state: z.enum(["received", "already_received"]), bundle_number: z.string(), remaining: z.number().optional(), transfer: fgTransferSchema }).passthrough();

/** Net kilograms of the chosen candidates (shown before sending; the database recomputes it). */
export function selectedNetKg(rows: { id: string; net_kg: number }[], ids: Iterable<string>): number {
  const chosen = new Set(ids);
  return Math.round(rows.filter(r => chosen.has(r.id)).reduce((sum, r) => sum + r.net_kg, 0) * 1000) / 1000;
}
