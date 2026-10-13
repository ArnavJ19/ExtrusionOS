import { z } from "zod";

const metric = z.number().finite().nonnegative().nullable();
const row = z.record(z.unknown());
const schema = z.object({
  version: z.literal("20261008"),
  asOf: z.string(),
  generatedAt: z.string().datetime({ offset: true }),
  unknownShipmentCount: z.number().int().nonnegative(),
  quoteRows: z.array(row).max(5),
  orderRows: z.array(row).max(8),
  monthlyQuoteValue: metric,
  monthlyOrderValue: metric,
  monthlyQuoteCount: metric,
  monthlyOrderCount: metric,
  activeCustomerCount: metric,
  pendingQuoteCount: metric,
  productionCount: metric,
  todayJobCount: metric,
  pendingDispatchCount: metric,
  dispatchCount: metric,
  dieCorrectionCount: metric,
  qualityHoldCount: metric,
  delayedOrderCount: z.number().int().nonnegative(),
  delayedOrders: z.array(row).max(5),
  lowInventoryCount: metric,
  lowInventoryRows: z.array(row).max(5),
  orderStageDistribution: z.array(z.object({ stage: z.string(), count: z.number().int().nonnegative() }))
});

export function parseDashboardSnapshot(value: unknown, asOf: string, now = new Date()) {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data.asOf !== asOf) return null;
  const age = now.getTime() - new Date(parsed.data.generatedAt).getTime();
  return age >= -60_000 && age <= 15 * 60_000 ? parsed.data : null;
}
