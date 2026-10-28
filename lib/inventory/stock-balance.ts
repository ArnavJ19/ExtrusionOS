// UPGRADE_EOS feature 51 (stock half). The database expands a profile stock batch's available
// quantity into signed components; this module validates that response, rechecks that it
// reconciles in every unit, and labels the parts for display.
import { z } from "zod";

export const BALANCE_READERS = ["owner", "admin", "production_manager", "production", "factory_manager", "inventory_manager", "dispatch_manager", "dispatch", "dealer_admin", "dealer_staff"] as const;
export const canExplainStock = (role: string) => (BALANCE_READERS as readonly string[]).includes(role);

const uuid = z.string().uuid();
const n = z.union([z.number(), z.string()]).transform((value) => Number(value)).refine(Number.isFinite, "Invalid quantity");
const str = z.string().nullable();
const quantity = z.object({ weight_kg: n, pieces: n, length_m: n }).strict();

export const balanceCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("balance.explain"), batch_id: uuid }).strict(),
  z.object({ command: z.literal("balance.list"), page: z.number().int().min(1).max(100000).default(1), search: z.string().trim().max(80).default(""), filter: z.enum(["in_stock", "reservable", "held", "over_reserved"]).default("in_stock") }).strict()
]);

const batchSchema = z.object({
  id: uuid, bundle_number: str, profile_code: str, profile_name: str, finish: str, location: str, status: z.string(), qc_status: z.string(),
  origin_type: str, origin_reference: str, created_at: z.string(), dealer_owned: z.boolean()
}).strict();
const parts = {
  on_hand: quantity, open_reserved: quantity.extend({ count: n }).strict(), excluded: quantity.extend({ reason: str }).strict(), shortfall: quantity, available: quantity
};

export const balanceExplanationSchema = z.object({
  batch: batchSchema, ...parts,
  reservations: z.array(z.object({
    id: uuid, order_id: uuid.optional(), order_number: str, customer_name: str.optional(), created_at: z.string(),
    reserved_weight_kg: n, consumed_weight_kg: n, open_weight_kg: n, open_pieces: n, open_length_m: n
  }).strict()).max(100),
  reservations_total: n,
  withdrawals: z.array(z.object({
    kind: z.enum(["dispatch", "dealer_debit", "dealer_credit"]), id: uuid, at: z.string(), reference: str, reference_id: uuid.nullable().optional(), order_number: str,
    weight_kg: n, pieces: n, length_m: n
  }).strict()).max(100),
  withdrawals_total: n,
  net_withdrawn: quantity,
  before_recorded_withdrawals: quantity
}).strict().superRefine((value, ctx) => {
  const problem = reconciliationProblem(value);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});
export type BalanceExplanation = z.infer<typeof balanceExplanationSchema>;

export const balanceListSchema = z.object({
  rows: z.array(z.object({ batch: batchSchema, ...parts }).strict()).max(10),
  total_count: n
}).strict();
export type BalanceList = z.infer<typeof balanceListSchema>;

const units = ["weight_kg", "pieces", "length_m"] as const;
const milli = (value: number) => Math.round(value * 1000);

/**
 * Rechecks the identity available = on hand − open − excluded + shortfall, and that recorded
 * withdrawals explain on hand, in integer thousandths so float noise cannot hide a mismatch.
 */
export function reconciliationProblem(value: Pick<BalanceExplanation, "on_hand" | "open_reserved" | "excluded" | "shortfall" | "available"> & Partial<Pick<BalanceExplanation, "net_withdrawn" | "before_recorded_withdrawals">>): string | null {
  for (const unit of units) {
    const expected = milli(value.on_hand[unit]) - milli(value.open_reserved[unit]) - milli(value.excluded[unit]) + milli(value.shortfall[unit]);
    if (expected !== milli(value.available[unit])) return `The ${unit.replace("_", " ")} explanation does not reconcile to the available balance`;
    if (value.available[unit] < 0) return "Available stock cannot be negative";
    if (value.net_withdrawn && value.before_recorded_withdrawals
      && milli(value.before_recorded_withdrawals[unit]) + milli(value.net_withdrawn[unit]) !== milli(value.on_hand[unit])) {
      return "Recorded withdrawals do not explain the on-hand quantity";
    }
  }
  return null;
}

export const exclusionText: Record<string, string> = {
  qc_on_hold: "On QC hold: cannot be reserved or shipped until quality releases it",
  qc_rejected: "QC rejected: cannot be reserved or shipped",
  qc_not_released: "Not released by quality",
  batch_rejected: "Batch is marked rejected",
  batch_scrap: "Batch is marked scrap",
  batch_dispatched: "Batch has been dispatched"
};
export const withdrawalText = { dispatch: "Dispatched", dealer_debit: "Dealer stock debit", dealer_credit: "Credited back on order cancellation" } as const;
