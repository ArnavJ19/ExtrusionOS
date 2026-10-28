import { z } from "zod";

const uuid = z.string().uuid();
const fingerprint = z.string().regex(/^[a-f0-9]{32}$/);
const finite = z.number().finite();
export const commercialReviewCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("quote.review"), quote_id: uuid }).strict(),
  z.object({ command: z.literal("quote.convert"), quote_id: uuid, request_id: uuid, fingerprint }).strict()
]);
export const commercialReviewSchema = z.object({
  quote_id: uuid, quote_number: z.string(), revision_number: z.number().int().positive(), updated_at: z.string(), status: z.string(), fingerprint,
  currency: z.literal("INR"), line_count: z.number().int().nonnegative(), subtotal: finite, tax: finite, grand_total: finite, recorded_total: finite, difference: finite,
  can_convert: z.boolean(), existing_order_id: uuid.nullable(), cost: finite.optional(), profit: finite.optional(), margin_percent: finite.nullable().optional(),
  items: z.array(z.object({ id: uuid, profile_id: uuid, description: z.string().nullable(), pieces: finite, cut_length_m: finite,
    physical_kg: finite, billing_kg: finite, net: finite, gst_percent: finite, tax: finite, invoice_rate_per_kg: finite.nullable(),
    separate_charges: z.boolean(), costing_complete: z.boolean().nullable() }).strict())
}).strict();
export type CommercialReview = z.infer<typeof commercialReviewSchema>;
export const conversionResultSchema = z.object({ order_id: uuid, revision_number: z.number().int().positive().optional(), replayed: z.boolean() }).strict();

export function commercialReviewProblems(review: Pick<CommercialReview, "line_count" | "difference" | "items">): string[] {
  const problems: string[] = [];
  if (review.line_count === 0) problems.push("Add at least one quotation line.");
  if (Math.abs(review.difference) > 0.01) problems.push("Recorded totals differ from the sum of the saved lines. Revise the quotation before conversion.");
  review.items.forEach((line, index) => {
    if (line.costing_complete !== true) problems.push(`Line ${index + 1} needs complete costing.`);
    if (line.billing_kg !== line.physical_kg) problems.push(`Line ${index + 1} bills ${line.billing_kg} kg against ${line.physical_kg} theoretical kg. Review this basis.`);
  });
  return problems;
}
