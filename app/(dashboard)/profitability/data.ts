import { z } from "zod";

export type ProfitAlert = {
  id: string;
  alert_type: string;
  severity: string;
  entity_type: string;
  entity_name: string;
  description: string;
  metric_value: number;
  threshold_value: number;
  is_acknowledged: boolean;
};

export const DIMENSIONS = ["customer", "profile", "die", "salesperson", "category", "finishing", "branch", "month"] as const;
export type Dimension = typeof DIMENSIONS[number];

// Server-side aggregates from get_profitability_summary (RPT-05). Every company row is
// included; rows with any unknown cost component are counted as incomplete and excluded
// from cost and margin instead of being costed at zero (RPT-08). Pay days come from the
// settling receipt of paid invoices; open invoices are reported as outstanding age (RPT-09).
const amount = z.union([z.number(), z.string()]).pipe(z.coerce.number().finite());
const optionalAmount = z.union([z.number(), z.string(), z.null()]).transform((value) => (value === null ? null : Number(value)))
  .refine((value) => value === null || Number.isFinite(value));

const group = z.object({
  key: z.string(),
  rows: amount,
  incompleteRows: amount,
  revenue: amount,
  completeRevenue: amount,
  totalCost: amount,
  margin: amount,
  marginPct: optionalAmount,
  scrapCost: amount,
  weightKg: amount,
  avgPayDays: optionalAmount,
  settledRows: amount,
  avgOpenAgeDays: optionalAmount,
  openRows: amount
});

const summarySchema = z.object({
  dimension: z.enum(DIMENSIONS),
  totals: z.object({
    rows: amount,
    incompleteRows: amount,
    revenue: amount,
    completeRevenue: amount,
    totalCost: amount,
    margin: amount,
    weightKg: amount,
    scrapCost: amount,
    avgPayDays: optionalAmount,
    settledRows: amount,
    avgOpenAgeDays: optionalAmount,
    openRows: amount
  }),
  groups: z.array(group)
});

export type ProfitabilitySummary = z.infer<typeof summarySchema>;
export type ProfitabilityGroup = z.infer<typeof group>;

export function parseProfitabilitySummary(value: unknown): ProfitabilitySummary | null {
  const parsed = summarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function marginPercent(margin: number, completeRevenue: number) {
  return completeRevenue > 0 ? (margin / completeRevenue) * 100 : null;
}

export function sortGroups(groups: ProfitabilityGroup[], sortBy: "revenue" | "margin" | "marginPct", direction: "asc" | "desc") {
  const value = (row: ProfitabilityGroup) => (sortBy === "marginPct" ? row.marginPct ?? Number.NEGATIVE_INFINITY : row[sortBy]);
  return [...groups].sort((a, b) => (direction === "desc" ? value(b) - value(a) : value(a) - value(b)) || a.key.localeCompare(b.key));
}
