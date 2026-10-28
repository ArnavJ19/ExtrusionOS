// UPGRADE_EOS feature 85 (approved dated costing rates). The database keeps billet, conversion
// and finishing rates as dated, four-eyes approved records, binds them to a quotation when it is
// approved for sending, and compares each quote line's entered rates with the approved rate;
// this module validates commands and responses.
import { z } from "zod";

export { marginToMarkup, sellingPriceFromMargin } from "../calculations/quote.ts";

export const RATE_READERS = ["owner", "admin", "sales_manager", "sales", "accounts"] as const;
export const RATE_WRITERS = ["owner", "admin", "sales_manager", "accounts"] as const;
export const RATE_APPROVERS = ["owner", "admin", "sales_manager"] as const;
export const canReadRates = (role: string) => (RATE_READERS as readonly string[]).includes(role);
export const canWriteRates = (role: string) => (RATE_WRITERS as readonly string[]).includes(role);
export const canApproveRates = (role: string) => (RATE_APPROVERS as readonly string[]).includes(role);
/** Four eyes: the author of a draft cannot approve it, except the owner. */
export const canApproveDraft = (role: string, userId: string, createdBy: string) => canApproveRates(role) && (createdBy !== userId || role === "owner");

export const RATE_TYPES = { billet: "Billet", conversion: "Conversion", finishing: "Finishing" } as const;
export const BASES = { per_kg: "per kg", per_sqft: "per sq ft", per_meter: "per metre" } as const;
/** Finishing types a rate can be set for (mill finish has no finishing charge). */
export const RATE_FINISHING_TYPES = ["powder_coating", "anodizing", "anodized_silver", "anodized_bronze", "anodized_black", "wood_finish", "wood_grain", "pvdf", "other"] as const;
export type RateType = keyof typeof RATE_TYPES;
export type Basis = keyof typeof BASES;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter dates as YYYY-MM-DD").refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), "Enter a real date");

export const draftInputSchema = z.object({
  command: z.literal("rates.save_draft"), id: uuid,
  rate_type: z.enum(["billet", "conversion", "finishing"]), basis: z.enum(["per_kg", "per_sqft", "per_meter"]).default("per_kg"),
  customer_id: uuid.nullable().default(null),
  alloy: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{3,8}$/, "Alloy is 3 to 8 letters or digits, e.g. 6063").nullable().default(null),
  finishing_type: z.string().trim().toLowerCase().regex(/^[a-z_]{3,40}$/, "Choose a finishing type").nullable().default(null),
  rate: z.number().finite().positive("Enter a positive rate").max(1e9),
  effective_from: isoDate, effective_to: isoDate.nullable().default(null),
  note: z.string().trim().max(300).default("")
}).strict().superRefine((value, ctx) => {
  const problem = draftProblem(value);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

/** Mirrors the table checks so the form explains a refusal before saving. */
export function draftProblem(value: { rate_type: string; basis: string; alloy: string | null; finishing_type: string | null; effective_from: string; effective_to: string | null }): string | null {
  if (value.rate_type !== "finishing" && value.basis !== "per_kg") return "Billet and conversion rates are per kg";
  if (value.rate_type !== "billet" && value.alloy) return "Only a billet rate can be limited to an alloy";
  if ((value.rate_type === "finishing") !== Boolean(value.finishing_type)) return value.rate_type === "finishing" ? "Choose the finishing type this rate is for" : "Only a finishing rate has a finishing type";
  if (value.finishing_type === "mill_finish") return "Mill finish has no finishing rate";
  if (value.effective_to && value.effective_to < value.effective_from) return "The end date is before the start date";
  return null;
}

const commandSchemas = {
  "rates.list": z.object({ command: z.literal("rates.list"), status: z.enum(["current", "draft", "history"]).default("current"), rate_type: z.enum(["billet", "conversion", "finishing"]).optional(), page: z.number().int().min(1).max(100000).default(1) }).strict(),
  "rates.save_draft": draftInputSchema,
  "rates.approve": z.object({ command: z.literal("rates.approve"), id: uuid }).strict(),
  "rates.withdraw": z.object({ command: z.literal("rates.withdraw"), id: uuid, reason: z.string().trim().min(3, "Record why the rate is withdrawn (3 to 300 characters)").max(300, "Record why the rate is withdrawn (3 to 300 characters)") }).strict(),
  "rates.lookup": z.object({
    command: z.literal("rates.lookup"), date: isoDate.optional(), customer_id: uuid.nullable().optional(),
    alloy: z.string().trim().toUpperCase().max(8).optional(), finishing_type: z.string().trim().toLowerCase().max(40).optional(), finishing_basis: z.enum(["per_kg", "per_sqft", "per_meter"]).optional()
  }).strict(),
  "rates.review": z.object({ command: z.literal("rates.review") }).strict(),
  "quote.check": z.object({ command: z.literal("quote.check"), quote_id: uuid }).strict()
} as const;
export type CostingRateCommandName = keyof typeof commandSchemas;
export const RATE_WRITE_COMMANDS: readonly CostingRateCommandName[] = ["rates.save_draft", "rates.approve", "rates.withdraw"];

/** Picks the schema by command so a refusal names the field, not "invalid input". */
export function parseCostingRateCommand(input: unknown) {
  const name = input && typeof input === "object" ? (input as { command?: unknown }).command : undefined;
  if (typeof name !== "string" || !(name in commandSchemas)) return { success: false as const, error: "Invalid costing rate request" };
  const parsed = commandSchemas[name as CostingRateCommandName].safeParse(input);
  if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid costing rate request" };
  return { success: true as const, data: parsed.data as { command: CostingRateCommandName } & Record<string, unknown> };
}

const num = z.union([z.number(), z.string()]).transform(Number);
const nullableNum = z.union([z.number(), z.string()]).nullable().transform((value) => (value === null ? null : Number(value)));
const rateRow = z.object({
  id: uuid, rate_type: z.enum(["billet", "conversion", "finishing"]), basis: z.enum(["per_kg", "per_sqft", "per_meter"]), customer_id: uuid.nullable(),
  alloy: z.string().nullable(), finishing_type: z.string().nullable(), rate: num, effective_from: z.string(), effective_to: z.string().nullable(),
  status: z.enum(["draft", "approved", "withdrawn"]), note: z.string().nullable(), created_by: uuid, created_by_name: z.string(), created_at: z.string(),
  approved_by: uuid.nullable(), approved_by_name: z.string().nullable(), approved_at: z.string().nullable(), withdrawn_at: z.string().nullable(), withdraw_reason: z.string().nullable()
});
export const rateListSchema = z.object({
  rows: z.array(rateRow.extend({ customer_name: z.string().nullable(), in_effect: z.boolean() }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();
export type RateListRow = z.infer<typeof rateListSchema>["rows"][number];
export const rateLookupSchema = z.object({ date: z.string(), billet: rateRow.strict().nullable(), conversion: rateRow.strict().nullable(), finishing: rateRow.strict().nullable() }).strict();
export const rateReviewSchema = z.array(rateRow.extend({ expired: z.boolean(), customer_name: z.string().nullable() }).strict());
export type RateReviewRow = z.infer<typeof rateReviewSchema>[number];

const CHECK_STATUSES = ["matches", "below_approved", "above_approved", "no_rate", "expired_rate"] as const;
export const quoteRateCheckSchema = z.object({
  quote_id: uuid, quote_date: z.string(), revision_number: z.number().int(), bound: z.boolean(),
  bindings: z.array(z.object({
    id: uuid, quote_id: uuid, revision_number: z.number().int(), rate_type: z.enum(["billet", "conversion", "finishing"]), basis: z.string(), finishing_type: z.string().nullable(),
    rate_id: uuid, rate: num, customer_specific: z.boolean(), effective_from: z.string(), bound_at: z.string()
  }).strict()),
  lines: z.array(z.object({
    item_id: uuid, description: z.string(),
    checks: z.array(z.object({
      rate_type: z.enum(["billet", "conversion", "finishing"]), basis: z.string(), finishing_type: z.string().nullable(), entered: nullableNum, approved: nullableNum,
      status: z.enum(CHECK_STATUSES), source: z.enum(["bound", "general", "customer"]).optional(), rate_id: uuid.optional(), difference: num.optional(), expired_on: z.string().nullable().optional()
    }).strict())
  }).strict())
}).strict();
export type QuoteRateCheck = z.infer<typeof quoteRateCheckSchema>;
export type RateCheckStatus = (typeof CHECK_STATUSES)[number];

export const CHECK_LABELS: Record<RateCheckStatus, string> = {
  matches: "Matches approved rate", below_approved: "Below approved rate", above_approved: "Above approved rate", no_rate: "No approved rate", expired_rate: "Approved rate expired"
};

/** Worst status first, so a line's summary shows what needs attention. */
export function lineAttention(checks: { status: RateCheckStatus }[]): RateCheckStatus {
  const order: RateCheckStatus[] = ["below_approved", "expired_rate", "no_rate", "above_approved", "matches"];
  return order.find((status) => checks.some((check) => check.status === status)) ?? "matches";
}

/** "Billet · alloy 6061 · Kumar Facades" — the scope a rate applies to. */
export function scopeText(row: { rate_type: RateType; basis: Basis; alloy: string | null; finishing_type: string | null; customer_name?: string | null }) {
  return [
    RATE_TYPES[row.rate_type],
    row.finishing_type ? row.finishing_type.replace(/_/g, " ") : null,
    row.alloy ? `alloy ${row.alloy}` : null,
    row.customer_name ?? "all customers"
  ].filter(Boolean).join(" · ");
}

/** Rate-lookup key for a line's finishing charge; null when the line has no comparable finishing rate. */
export function finishingRateKey(line: { finishing_type: string | null | undefined; finishing_charge_type: string | null | undefined }) {
  const basis = line.finishing_charge_type === "per_kg" || line.finishing_charge_type === "per_sqft" || line.finishing_charge_type === "per_meter" ? line.finishing_charge_type : null;
  return line.finishing_type && line.finishing_type !== "mill_finish" && basis ? `${line.finishing_type}|${basis}` : null;
}

type RateLine = { billet_rate_per_kg: number; conversion_charge_per_kg: number; finishing_type?: string | null; finishing_charge_type?: string | null; finishing_charge: number };
/**
 * Fills each line's billet, conversion and finishing rate from the approved rates found for the
 * quote date and customer. A rate with no approved value is left as entered and reported, so the
 * user can still type it; nothing is applied silently on save.
 */
export function applyApprovedRates<T extends RateLine>(lines: T[], rates: { billet: number | null; conversion: number | null; finishing: Record<string, number | null> }) {
  let changed = 0;
  const missing = new Set<string>();
  const next = lines.map((line) => {
    const update = { ...line };
    if (rates.billet === null) missing.add("billet"); else if (update.billet_rate_per_kg !== rates.billet) { update.billet_rate_per_kg = rates.billet; changed += 1; }
    if (rates.conversion === null) missing.add("conversion"); else if (update.conversion_charge_per_kg !== rates.conversion) { update.conversion_charge_per_kg = rates.conversion; changed += 1; }
    const key = finishingRateKey({ finishing_type: line.finishing_type, finishing_charge_type: line.finishing_charge_type });
    if (key) {
      const rate = rates.finishing[key] ?? null;
      if (rate === null) missing.add(`finishing ${key.split("|")[0].replace(/_/g, " ")}`); else if (update.finishing_charge !== rate) { update.finishing_charge = rate; changed += 1; }
    }
    return update;
  });
  return { lines: next, changed, missing: [...missing] };
}
