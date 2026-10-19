import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const weight = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,3})?$/)])
  .refine(value => /^\d+(\.\d{1,3})?$/.test(String(value)))
  .transform(Number).refine(value => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1000)));
const resultSchema = z.object({
  company_id: z.string().uuid(), order_id: z.string().uuid(), total_count: z.number().int().nonnegative().max(100000),
  rows: z.array(z.object({production_job_id: z.string().uuid(), ready_weight_kg: weight})),
});

export async function loadFinishedProductionReadiness(
  client: Pick<SupabaseClient, "rpc">, companyId: string, orderId: string,
  jobs: {id: string; actual_quantity_kg: number | string | null}[]
): Promise<Map<string, number>> {
  if (!jobs.length) return new Map();
  const result = await client.rpc("get_finished_production_readiness", {p_order_id: orderId});
  if (result.error) throw new Error("Finished production release could not be verified. Refresh or review the finishing receipts.");
  const parsed = resultSchema.safeParse(result.data);
  const expected = new Map(jobs.map(job => [job.id.toLowerCase(), Number(job.actual_quantity_kg)]));
  if (!parsed.success || parsed.data.company_id.toLowerCase() !== companyId.toLowerCase()
    || parsed.data.order_id.toLowerCase() !== orderId.toLowerCase() || expected.size !== jobs.length
    || parsed.data.total_count !== parsed.data.rows.length || parsed.data.rows.length !== expected.size) {
    throw new Error("The complete finished production release could not be verified. Refresh before dispatch.");
  }
  const totals = new Map<string, number>();
  for (const row of parsed.data.rows) {
    const id = row.production_job_id.toLowerCase();
    const actual = expected.get(id);
    if (actual === undefined || !Number.isFinite(actual) || actual <= 0 || totals.has(id) || row.ready_weight_kg > actual + 0.001) {
      throw new Error("Finished production release has conflicting identities or quantities. Review it before dispatch.");
    }
    totals.set(id, row.ready_weight_kg);
  }
  return totals;
}
