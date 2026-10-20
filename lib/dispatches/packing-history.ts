import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const amount = z.union([z.number(), z.string().trim().min(1)]).transform(Number)
  .refine(value => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1000)), "Invalid packing quantity");
const packingRow = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  dispatch_id: z.string().uuid(),
  source_line_id: z.string().uuid(),
  net_weight_kg: amount,
  net_length_m: amount,
  number_of_pieces: amount.refine(Number.isSafeInteger, "Invalid packing piece count"),
  dispatches: z.object({company_id: z.string().uuid(), order_id: z.string().uuid()})
});
type PackingTotals = {weightKg: number; lengthM: number; pieces: number};

export async function loadDispatchPackingTotals(
  client: Pick<SupabaseClient, "from">, companyId: string, orderId: string, editingId: string | null
): Promise<Map<string, PackingTotals>> {
  const totals = new Map<string, {weightMilliKg: number; lengthMilliM: number; pieces: number}>();
  const pageSize = 200;
  let expected: number | null = null;
  let previousId = "";
  for (let offset = 0; ;) {
    // The inner relationship avoids enumerating a potentially capped dispatch-ID list.
    let query = client.from("packing_list_items")
      .select("id, company_id, dispatch_id, source_line_id, net_weight_kg, number_of_pieces, net_length_m, dispatches!inner(company_id, order_id)", {count: "exact"})
      .eq("company_id", companyId).eq("dispatches.company_id", companyId).eq("dispatches.order_id", orderId)
      .order("id", {ascending: true}).range(offset, offset + pageSize - 1);
    if (editingId) query = query.neq("dispatch_id", editingId);
    const result = await query;
    if (result.error) throw result.error;
    if (!Array.isArray(result.data) || typeof result.count !== "number" || !Number.isSafeInteger(result.count) || result.count < 0 || result.count > 100000
      || (expected !== null && result.count !== expected)) {
      throw new Error("The complete packing history could not be verified. Refresh before preparing dispatch.");
    }
    const count: number = result.count;
    expected = count;
    const remaining = Math.min(pageSize, Math.max(count - offset, 0));
    if (result.data.length > remaining || (remaining > 0 && result.data.length === 0)) {
      throw new Error("The packing history is incomplete. Refresh before preparing dispatch.");
    }
    for (const value of result.data) {
      const parsed = packingRow.safeParse(value);
      if (!parsed.success) throw new Error("Packing history has invalid source identities or quantities. Review it before preparing dispatch.");
      const row = parsed.data;
      if (row.company_id !== companyId || row.dispatches.company_id !== companyId || row.dispatches.order_id !== orderId
        || row.dispatch_id === editingId || row.id <= previousId) {
        throw new Error("Packing history has conflicting source identities. Refresh before preparing dispatch.");
      }
      previousId = row.id;
      const used = totals.get(row.source_line_id) ?? {weightMilliKg: 0, lengthMilliM: 0, pieces: 0};
      used.weightMilliKg += Math.round(row.net_weight_kg * 1000);
      used.lengthMilliM += Math.round(row.net_length_m * 1000);
      used.pieces += row.number_of_pieces;
      if (![used.weightMilliKg, used.lengthMilliM, used.pieces].every(Number.isSafeInteger)) {
        throw new Error("Packing history quantities exceed the supported range. Review them before dispatch.");
      }
      totals.set(row.source_line_id, used);
    }
    offset += result.data.length;
    if (offset === count) break;
  }
  return new Map([...totals].map(([id, used]) => [id, {weightKg: used.weightMilliKg / 1000, lengthM: used.lengthMilliM / 1000, pieces: used.pieces}]));
}
