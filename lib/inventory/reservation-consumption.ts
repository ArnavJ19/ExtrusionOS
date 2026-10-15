import type { SupabaseClient } from "@supabase/supabase-js";

type ConsumptionTotals = { weightKg: number; lengthM: number; pieces: number };

export async function loadReservationConsumptionTotals(client: Pick<SupabaseClient, "rpc">, reservationIds: string[]) {
  const ids = [...new Set(reservationIds)];
  const totals = new Map<string, ConsumptionTotals>();
  for (let offset = 0; offset < ids.length; offset += 500) {
    const requested = ids.slice(offset, offset + 500);
    const result = await client.rpc("get_profile_stock_consumption_totals", { p_reservation_ids: requested });
    if (result.error) throw result.error;
    if (!Array.isArray(result.data) || result.data.length !== requested.length) {
      throw new Error("Reservation consumption totals are incomplete. Refresh before reserving stock.");
    }
    const expected = new Set(requested);
    for (const row of result.data) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("Reservation consumption totals are invalid. Refresh before using stock.");
      }
      const values = [row.consumed_weight_kg, row.consumed_length_m, row.consumed_pieces];
      const valid = values.every(value => (typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
        && Number.isFinite(Number(value)) && Number(value) >= 0);
      if (!expected.delete(row.reservation_id) || !valid || !Number.isInteger(Number(row.consumed_pieces))) {
        throw new Error("Reservation consumption totals are invalid. Refresh before reserving stock.");
      }
      totals.set(row.reservation_id, {
        weightKg: Number(row.consumed_weight_kg), lengthM: Number(row.consumed_length_m), pieces: Number(row.consumed_pieces)
      });
    }
  }
  return totals;
}
