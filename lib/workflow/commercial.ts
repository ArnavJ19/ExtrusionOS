// November batch 9 (NOV-020/023/024/029/035/039/064/066/078): quantity-based pricing, supplier claims,
// job profitability, supplier reliability, quotation outcomes, reusable remnants, accounting export
// batches, compatible run proposals and what-if planning scenarios. NOV-082 (display density) lives in
// lib/preferences/density.ts. The database owns every read model and guarded action; this module
// validates commands and responses and mirrors role access so screens never offer an action the
// server would refuse.
import { z } from "zod";

export const COMMERCIAL_VIEWS = {
  pricing: "Quantity pricing", claims: "Supplier claims", profitability: "Job profitability", reliability: "Supplier reliability", outcomes: "Quotation outcomes",
  cohorts: "Outcome cohorts", remnants: "Reusable remnants", transfers: "Accounting export", runs: "Compatible runs", scenarios: "What-if scenarios"
} as const;
export type CommercialView = keyof typeof COMMERCIAL_VIEWS;
export const COMMERCIAL_DESCRIPTIONS: Record<CommercialView, string> = {
  pricing: "Approved volume rates, minimum charges and processing charges, and the recorded breakdown of each price.",
  claims: "Shortages, rejected receipts and damage claimed from suppliers, open until the agreed recovery is actually linked.",
  profitability: "The accepted quotation estimate beside invoiced revenue and linked costs, with every gap stated.",
  reliability: "Promised dates, receipts and acceptance by supplier and finishing vendor, with the sample size shown.",
  outcomes: "Issued quotations that were won, lost, withdrawn or are still waiting for a reason.",
  cohorts: "Quotation results by month with the denominator, the reasons and who stated them.",
  remnants: "Measured leftover lengths and approved excess, matched to open requirements by profile, finish and length.",
  transfers: "Issued invoices prepared for the accounting package, with the result the package returned for each.",
  runs: "Jobs on the same die and specification that could run together, with every job kept visible.",
  scenarios: "Hypothetical breakdowns, extra shifts and urgent orders compared with the current plan."
};
const viewKeys = Object.keys(COMMERCIAL_VIEWS) as [CommercialView, ...CommercialView[]];

export const COMMERCIAL_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"] as const;
const VIEW_ROLES: Record<CommercialView, readonly string[]> = {
  pricing: ["owner", "admin", "sales_manager", "sales", "accounts", "factory_manager"],
  claims: ["owner", "admin", "factory_manager", "inventory_manager", "accounts", "quality"],
  profitability: ["owner", "admin", "accounts", "factory_manager"],
  reliability: ["owner", "admin", "factory_manager", "inventory_manager", "accounts", "quality", "production_manager"],
  outcomes: ["owner", "admin", "sales_manager", "sales"],
  cohorts: ["owner", "admin", "sales_manager"],
  remnants: ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "inventory_manager", "dispatch_manager", "viewer"],
  transfers: ["owner", "admin", "accounts"],
  runs: ["owner", "admin", "factory_manager", "production_manager", "production", "viewer"],
  scenarios: ["owner", "admin", "factory_manager", "production_manager", "production", "viewer"]
};
/** Mirrors private.commercial_read_allowed. */
export function canReadCommercial(role: string, view?: CommercialView) {
  if (!(COMMERCIAL_ROLES as readonly string[]).includes(role)) return false;
  return view ? VIEW_ROLES[view].includes(role) : true;
}

const uuid = z.string().uuid("Choose a record from the search results");
const control = /[\u0000-\u001f\u007f]/;
const note = z.string().trim().min(5, "Explain the action in at least 5 characters").max(500, "Keep the explanation within 500 characters").refine(value => !control.test(value), "Remove control characters");
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label} needs at least ${min} characters`).max(max, `Keep ${label.toLowerCase()} within ${max} characters`)
  .refine(value => !control.test(value), "Remove control characters");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const whole = (min: number, max: number, label: string) => z.number().int(`${label} must be a whole number`).min(min, `${label}: ${min} or more`).max(max, `${label}: at most ${max}`);
const decimals = (value: number, places: number) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6;
const amount = (min: number, max: number, label: string, places: number) => z.number({ invalid_type_error: `Enter ${label.toLowerCase()}` }).finite().min(min, `${label}: ${min} or more`).max(max, `${label}: at most ${max.toLocaleString("en-IN")}`)
  .refine(value => decimals(value, places), `${label}: at most ${places} decimal place(s)`);
const keysOf = <T extends Record<string, string>>(value: T) => Object.keys(value) as [keyof T & string, ...(keyof T & string)[]];

export const UNIT_BASES = { kg: "Per kilogram", metre: "Per metre", piece: "Per piece" } as const;
export const CHARGE_TYPES = { bracket_rate: "Volume rate by quantity bracket", minimum_charge: "Minimum charge", processing_charge: "Processing charge" } as const;
export const CLAIM_TYPES = { shortage: "Shortage", rejected_receipt: "Rejected receipt", wrong_specification: "Wrong specification", damage: "Damage" } as const;
export const REMEDIES = { replacement: "Replacement", credit: "Credit note", refund: "Refund" } as const;
export const OUTCOME_KINDS = { lost: "Lost", withdrawn: "Withdrawn", no_decision: "No decision" } as const;
export const REASON_CODES = { price: "Price", lead_time: "Lead time", availability: "Availability", specification: "Specification", competitor: "Competitor", project_cancelled: "Project cancelled", no_response: "No response", other: "Other" } as const;
export const EVIDENCE_KINDS = { customer_stated: "Customer stated the reason", sales_observed: "Sales observed it" } as const;
export const ORIGIN_KINDS = { cutting_remnant: "Cutting remnant", approved_excess: "Approved excess output" } as const;
export const PARTY_KEYS = { gst_number: "GST number (customer name if none)", customer_name: "Customer name" } as const;
export const SCENARIO_KINDS = { machine_down: "A press is down", extra_shift: "An extra shift", urgent_order: "An urgent order", delayed_receipt: "A delayed receipt" } as const;

const bracket = z.object({ from: amount(0, 100000000, "Bracket start", 3), to: amount(0.001, 100000000, "Bracket end", 3).optional(), rate: amount(0.0001, 10000000, "Rate", 4) }).strict();
const scenarioChange = z.discriminatedUnion("type", [
  z.object({ type: z.literal("machine_down"), machine_id: uuid, from_date: day, days: whole(1, 14, "Days") }).strict(),
  z.object({ type: z.literal("extra_shift"), machine_id: uuid, date: day, kg: amount(0.001, 1000000, "Extra kilograms", 3) }).strict(),
  z.object({ type: z.literal("urgent_order"), machine_id: uuid, kg: amount(0.001, 1000000, "Quantity", 3), due_date: day }).strict(),
  z.object({ type: z.literal("delayed_receipt"), job_id: uuid, days: whole(1, 14, "Delay") }).strict()
]);
export type ScenarioChange = z.infer<typeof scenarioChange>;

export const commercialMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pricing.define"), code: z.string().regex(/^[a-z0-9_]{3,30}$/, "Use 3 to 30 lowercase letters, digits or underscores"), name: text(3, 80, "Name"), charge_type: z.enum(keysOf(CHARGE_TYPES)), unit_basis: z.enum(keysOf(UNIT_BASES)),
    customer_id: uuid.optional(), finishing_type: text(2, 40, "Finish").optional(), processing_code: z.string().regex(/^[a-z0-9_]{2,30}$/, "Use 2 to 30 lowercase letters, digits or underscores").optional(),
    amount: amount(0.01, 100000000, "Amount", 2).optional(), precedence: whole(0, 100, "Precedence"), effective_from: day, effective_to: day.optional(), brackets: z.array(bracket).min(1).max(12).optional(), note }).strict(),
  z.object({ action: z.literal("pricing.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("pricing.retire"), id: uuid, note }).strict(),
  z.object({ action: z.literal("pricing.void"), id: uuid, note }).strict(),
  z.object({ action: z.literal("pricing.price"), customer_id: uuid, unit_basis: z.enum(keysOf(UNIT_BASES)), quantity: amount(0.001, 100000000, "Quantity", 3), finishing_type: text(2, 40, "Finish").optional(),
    processing_codes: z.array(z.string().regex(/^[a-z0-9_]{2,30}$/, "Use the processing code")).min(1).max(5).optional(), quote_id: uuid.optional(),
    override_rate: amount(0.0001, 10000000, "Override rate", 4).optional(), override_reason: text(5, 300, "Override reason").optional() }).strict(),
  z.object({ action: z.literal("claim.submit"), purchase_order_line_id: uuid, claim_type: z.enum(keysOf(CLAIM_TYPES)), quantity: amount(0.001, 100000000, "Quantity", 3), amount: amount(0.01, 1000000000, "Amount", 2),
    remedy: z.enum(keysOf(REMEDIES)), owner_id: uuid, response_due: day, note }).strict(),
  z.object({ action: z.literal("claim.respond"), id: uuid, response: z.enum(["agreed", "disputed", "rejected"]), agreed_quantity: amount(0, 100000000, "Agreed quantity", 3).optional(), agreed_amount: amount(0, 1000000000, "Agreed amount", 2).optional(), note }).strict(),
  z.object({ action: z.literal("claim.link"), id: uuid, kind: z.enum(keysOf(REMEDIES)), receipt_line_id: uuid.optional(), quantity: amount(0.001, 100000000, "Quantity", 3).optional(), credit_id: uuid.optional(), note }).strict(),
  z.object({ action: z.literal("claim.unlink"), id: uuid, recovery_id: uuid, note }).strict(),
  z.object({ action: z.literal("claim.close"), id: uuid, note }).strict(),
  z.object({ action: z.literal("profit.snapshot"), order_id: uuid, finalize: z.boolean(), note }).strict(),
  z.object({ action: z.literal("commitment.set"), purchase_order_id: uuid, promised_date: day, note }).strict(),
  z.object({ action: z.literal("outcome.record"), quote_id: uuid, outcome: z.enum(keysOf(OUTCOME_KINDS)), reason_code: z.enum(keysOf(REASON_CODES)), evidence: z.enum(keysOf(EVIDENCE_KINDS)), product_family: text(2, 60, "Product family").optional() }).strict(),
  z.object({ action: z.literal("outcome.reopen"), quote_id: uuid, note }).strict(),
  z.object({ action: z.literal("remnant.record"), profile_id: uuid, length_mm: whole(100, 12000, "Length"), pieces: whole(1, 10000, "Pieces"), finish: text(2, 40, "Finish"), origin_type: z.enum(keysOf(ORIGIN_KINDS)), location: text(2, 60, "Location"),
    alloy: text(1, 40, "Alloy").optional(), temper: text(1, 40, "Temper").optional(), source_job_id: uuid.optional(), condition: z.enum(["good", "damaged"]).optional(), note }).strict(),
  z.object({ action: z.literal("remnant.review"), id: uuid, decision: z.enum(["usable", "hold", "damaged"]), note }).strict(),
  z.object({ action: z.literal("remnant.reserve"), id: uuid, order_item_id: uuid, pieces: whole(1, 10000, "Pieces"), note }).strict(),
  z.object({ action: z.literal("remnant.consume"), id: uuid, note }).strict(),
  z.object({ action: z.literal("remnant.release"), id: uuid, note }).strict(),
  z.object({ action: z.literal("remnant.scrap"), id: uuid, note }).strict(),
  z.object({ action: z.literal("remnant.correct"), id: uuid, length_mm: whole(100, 12000, "Length"), pieces: whole(1, 10000, "Pieces"), note }).strict(),
  z.object({ action: z.literal("mapping.define"), sales_ledger: text(2, 80, "Sales ledger"), tax_ledger: text(2, 80, "Tax ledger"), party_key: z.enum(keysOf(PARTY_KEYS)), note }).strict(),
  z.object({ action: z.literal("mapping.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("mapping.retire"), id: uuid, note }).strict(),
  z.object({ action: z.literal("transfer.prepare"), count: whole(1, 25, "Invoices"), note }).strict(),
  z.object({ action: z.literal("transfer.export"), id: uuid, note }).strict(),
  z.object({ action: z.literal("transfer.result"), id: uuid, result: z.enum(["accepted", "rejected"]), external_reference: text(1, 60, "Package reference").optional(), note }).strict(),
  z.object({ action: z.literal("transfer.cancel"), id: uuid, note }).strict(),
  z.object({ action: z.literal("run.save"), group_key: z.string().regex(/^[0-9a-f]{32}$/, "Choose a proposed run"), note }).strict(),
  z.object({ action: z.literal("run.accept"), id: uuid, note }).strict(),
  z.object({ action: z.literal("run.dismiss"), id: uuid, note }).strict(),
  z.object({ action: z.literal("scenario.create"), name: text(3, 80, "Name"), horizon_days: whole(3, 14, "Horizon"), changes: z.array(scenarioChange).min(1, "Add a hypothetical change").max(6, "A scenario holds at most six changes"), note }).strict(),
  z.object({ action: z.literal("scenario.share"), id: uuid, note }).strict(),
  z.object({ action: z.literal("scenario.discard"), id: uuid, note }).strict(),
  z.object({ action: z.literal("scenario.accept"), id: uuid, note }).strict()
]).superRefine((value, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (value.action === "pricing.define") {
    if (value.charge_type === "bracket_rate") {
      if (!value.brackets) issue("brackets", "A volume rate needs its brackets");
      if (value.amount !== undefined) issue("amount", "A volume rate uses brackets, not a single amount");
      if (value.processing_code) issue("processing_code", "Only a processing charge has a code");
      const rows = value.brackets ?? [];
      rows.forEach((row, index) => {
        if (index === 0 && row.from !== 0) issue("brackets", "The first bracket starts at 0");
        if (row.to !== undefined && row.to <= row.from) issue("brackets", `Bracket ${index + 1} must end after it starts`);
        if (index > 0 && rows[index - 1].to !== row.from) issue("brackets", `Bracket ${index + 1} must start exactly where bracket ${index} ends`);
        if (index > 0 && rows[index - 1].to === undefined) issue("brackets", "Only the last bracket may be open-ended");
      });
    } else {
      if (value.brackets) issue("brackets", "Only a volume rate has brackets");
      if (value.amount === undefined) issue("amount", value.charge_type === "minimum_charge" ? "Enter the minimum charge" : "Enter the charge per unit");
      if (value.charge_type === "processing_charge" && !value.processing_code) issue("processing_code", "A processing charge needs a code");
      if (value.charge_type === "minimum_charge" && value.processing_code) issue("processing_code", "Only a processing charge has a code");
    }
    if (value.effective_to && value.effective_to < value.effective_from) issue("effective_to", "The rule cannot end before it starts");
  }
  if (value.action === "pricing.price") {
    if (value.override_rate !== undefined && !value.override_reason) issue("override_reason", "Give the reason for the override rate");
    if (value.override_rate === undefined && value.override_reason) issue("override_rate", "An override reason needs an override rate");
    if (value.processing_codes && new Set(value.processing_codes).size !== value.processing_codes.length) issue("processing_codes", "Use each processing charge once");
  }
  if (value.action === "claim.respond") {
    if (value.response === "agreed") {
      if (value.agreed_quantity === undefined || value.agreed_amount === undefined) issue("agreed_quantity", "Enter the agreed quantity and amount (0 where one does not apply)");
      else if (value.agreed_quantity + value.agreed_amount <= 0) issue("agreed_quantity", "An agreed claim needs an agreed quantity or amount");
    } else if (value.agreed_quantity !== undefined || value.agreed_amount !== undefined) issue("agreed_quantity", "Agreed figures belong to an agreed response only");
  }
  if (value.action === "claim.link") {
    if (value.kind === "replacement") {
      if (!value.receipt_line_id || value.quantity === undefined) issue("receipt_line_id", "A replacement links a receipt line and the quantity it replaces");
      if (value.credit_id) issue("credit_id", "A replacement does not link a credit");
    } else {
      if (!value.credit_id) issue("credit_id", "A credit or refund links one posted supplier credit");
      if (value.receipt_line_id || value.quantity !== undefined) issue("receipt_line_id", "A credit or refund does not link a receipt");
    }
  }
  if (value.action === "transfer.result") {
    if (value.result === "accepted" && !value.external_reference) issue("external_reference", "Enter the reference the accounting package gave this invoice");
    if (value.result === "rejected" && value.external_reference) issue("external_reference", "A rejected invoice has no package reference");
  }
});
export type CommercialMutation = z.infer<typeof commercialMutationSchema>;
export type CommercialAction = CommercialMutation["action"];
/** Actions carried by their own meaning; they have no separate explanation field. */
export const NOTELESS_ACTIONS: readonly CommercialAction[] = ["pricing.price", "outcome.record"];

const ACTION_VIEW: Record<string, CommercialView> = { pricing: "pricing", claim: "claims", profit: "profitability", commitment: "reliability", outcome: "outcomes", remnant: "remnants", mapping: "transfers", transfer: "transfers", run: "runs", scenario: "scenarios" };
export function commercialMutationView(action: CommercialAction): CommercialView { return ACTION_VIEW[action.split(".")[0]]; }

const ACTION_ROLES = (action: CommercialAction): readonly string[] => {
  if (["pricing.define", "pricing.approve", "pricing.retire"].includes(action)) return ["owner", "admin", "sales_manager", "accounts"];
  if (action === "pricing.price") return ["owner", "admin", "sales_manager", "sales"];
  if (action === "pricing.void") return ["owner", "admin", "sales_manager"];
  if (action.startsWith("claim.")) return ["owner", "admin", "factory_manager", "inventory_manager", "accounts"];
  if (action.startsWith("profit.")) return ["owner", "admin", "accounts"];
  if (action.startsWith("commitment.")) return ["owner", "admin", "factory_manager", "inventory_manager"];
  if (action.startsWith("outcome.")) return ["owner", "admin", "sales_manager", "sales"];
  if (action === "remnant.record" || action === "remnant.correct") return ["owner", "admin", "factory_manager", "production_manager", "production", "inventory_manager"];
  if (action === "remnant.review") return ["owner", "admin", "factory_manager", "production_manager", "quality", "inventory_manager"];
  if (action.startsWith("remnant.")) return ["owner", "admin", "factory_manager", "production_manager", "inventory_manager"];
  if (action.startsWith("mapping.") || action.startsWith("transfer.")) return ["owner", "admin", "accounts"];
  return ["owner", "admin", "factory_manager", "production_manager"];
};
/** Mirrors private.commercial_action_allowed. The server further limits some actions to a second person. */
export function canUseCommercialAction(role: string, action: CommercialAction) {
  return canReadCommercial(role, commercialMutationView(action)) && role !== "viewer" && ACTION_ROLES(action).includes(role);
}

export const COMMERCIAL_LOOKUPS = ["employees", "customers", "quotes", "orders", "po_lines", "receipt_lines", "credits", "purchase_orders", "profiles", "order_items", "jobs", "machines"] as const;
export type CommercialLookupKind = typeof COMMERCIAL_LOOKUPS[number];
const page = z.number().int().min(1).max(100000).default(1);
export const commercialCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), view: z.enum(viewKeys), page, search: z.string().trim().max(80).default(""), state: z.enum(["active", "all"]).default("active"),
    status: z.string().regex(/^[a-z_]{1,40}$/).optional(), sort: z.enum(["priority", "newest", "due"]).default("priority") }).strict(),
  z.object({ command: z.literal("detail"), view: z.enum(viewKeys), id: uuid, page }).strict(),
  z.object({ command: z.literal("lookup"), kind: z.enum(COMMERCIAL_LOOKUPS), search: z.string().trim().max(80).default(""), selected_id: uuid.optional(), parent_id: uuid.optional() }).strict(),
  z.object({ command: z.literal("preview"), request_id: uuid, mutation: commercialMutationSchema }).strict(),
  z.object({ command: z.literal("commit"), request_id: uuid, fingerprint: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
  z.object({ command: z.literal("outcome"), request_id: uuid }).strict(),
  z.object({ command: z.literal("abandon"), request_id: uuid }).strict()
]);
export type CommercialCommand = z.input<typeof commercialCommandSchema>;

export const commercialRowSchema = z.object({
  id: uuid, label: z.string(), status: z.string(), owner: z.string().nullable(), due_date: z.string().nullable(), summary: z.string(), source_href: z.string().nullable(), details: z.record(z.unknown())
}).strict();
export type CommercialRow = z.infer<typeof commercialRowSchema>;
export const commercialListSchema = z.object({ rows: z.array(commercialRowSchema).max(10), total_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type CommercialList = z.infer<typeof commercialListSchema>;
export const commercialDetailSchema = z.object({ row: commercialRowSchema, events: z.array(z.object({ id: uuid, action: z.string(), actor: z.string(), note: z.string(), recorded_at: z.string() }).strict()).max(10),
  event_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type CommercialDetail = z.infer<typeof commercialDetailSchema>;
export const commercialLookupSchema = z.array(z.object({ value: uuid, label: z.string(), context: z.string() }).strict()).max(20);
export const commercialOutcomeSchema = z.object({
  request_id: uuid, state: z.enum(["prepared", "confirmed", "rejected", "abandoned", "not_recorded"]), fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  expires_at: z.string(), action: z.string(),
  review: z.object({ title: z.string(), effect: z.string(), warnings: z.array(z.string()), facts: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])) }).strict(),
  result: z.object({ label: z.string(), href: z.string().nullable(), message: z.string() }).strict().nullable()
}).strict();
export type CommercialOutcome = z.infer<typeof commercialOutcomeSchema>;
export type CommercialResult<T = unknown> = { success: true; data: T } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

export function parseCommercialData(command: string, value: unknown) {
  if (command === "list") return commercialListSchema.parse(value);
  if (command === "detail") return commercialDetailSchema.parse(value);
  if (command === "lookup") return commercialLookupSchema.parse(value);
  return commercialOutcomeSchema.parse(value);
}

export const COMMERCIAL_STATUS: Record<string, string> = {
  draft: "Draft; awaiting a second approver", approved: "Approved", scheduled: "Approved; not yet effective", expired: "Expired", retired: "Retired", recorded: "Recorded", superseded: "Replaced", voided: "Voided",
  submitted: "Submitted to the supplier", response_overdue: "Supplier response overdue", disputed: "Disputed by the supplier", agreed: "Agreed; awaiting recovery", partially_recovered: "Partly recovered", rejected: "Rejected by the supplier", closed: "Closed",
  provisional: "Provisional", finalized: "Finalised", no_estimate: "No accepted estimate",
  attention: "Needs attention", low_sample: "Small sample", measured: "Measured",
  needs_reason: "Needs an outcome and reason", open: "Open", won: "Won", partially_won: "Partly won", lost: "Lost", withdrawn: "Withdrawn", no_decision: "No decision",
  in_progress: "Still has open quotations", complete: "Every quotation has an outcome",
  available: "Available", held: "On hold", scrapped: "Scrapped", exhausted: "Fully used",
  results_open: "Exported; results awaited", prepared: "Prepared", exported: "Exported", cancelled: "Cancelled",
  suggested: "Suggested; not saved", proposed: "Proposed", accepted: "Accepted", dismissed: "Dismissed", stale: "Jobs changed since the proposal",
  shared: "Shared for review", discarded: "Discarded"
};
/** The same word can mean different things in different views, so a view may override the label. */
const VIEW_STATUS: Partial<Record<CommercialView, Record<string, string>>> = { scenarios: { draft: "Draft; not yet shared for review", accepted: "Accepted by a second planner" }, runs: { accepted: "Accepted by the planner" }, transfers: { approved: "Approved; used for new batches" } };
export function commercialStatusLabel(status: string, view?: CommercialView) { return (view && VIEW_STATUS[view]?.[status]) ?? COMMERCIAL_STATUS[status] ?? status.replace(/_/g, " "); }

export function commercialRecoveryKey(companyId: string, userId: string) { return `extrusionos:commercial:v1:${companyId}:${userId}`; }

/** Builds the CSV an accounting package imports. Cells that start with a formula character are neutralised. */
export function transferCsv(items: { external_ref: string; invoice_number: string; invoice_date: string; party: string; amount: number; tax_amount: number }[], mapping: { sales_ledger: string; tax_ledger: string }) {
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [["External reference", "Invoice number", "Invoice date", "Party", "Sales ledger", "Taxable amount", "Tax ledger", "Tax amount", "Total"],
    ...items.map(item => [item.external_ref, item.invoice_number, item.invoice_date, item.party, mapping.sales_ledger, item.amount.toFixed(2), mapping.tax_ledger, item.tax_amount.toFixed(2), (item.amount + item.tax_amount).toFixed(2)])];
  return rows.map(row => row.map(cell).join(",")).join("\r\n");
}
