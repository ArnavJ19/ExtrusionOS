import { z } from "zod";

export const quoteEditTokenSchema = z.object({
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export type QuoteEditToken = z.infer<typeof quoteEditTokenSchema>;
export type QuoteEditConflict = {
  token: QuoteEditToken;
  status: string;
  paymentTerms: string;
  deliveryTimeline: string;
  notes: string;
  grandTotal: number;
};

export function quoteEditToken(row: { revision_number?: unknown; updated_at?: unknown }): QuoteEditToken | null {
  const result = quoteEditTokenSchema.safeParse({ revision: Number(row.revision_number), updatedAt: row.updated_at });
  return result.success ? result.data : null;
}

export function sameQuoteEditToken(a: QuoteEditToken | null, b: QuoteEditToken | null): boolean {
  const micros = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6);
  return Boolean(a && b && a.revision === b.revision && Date.parse(a.updatedAt) === Date.parse(b.updatedAt) && micros(a.updatedAt) === micros(b.updatedAt));
}
