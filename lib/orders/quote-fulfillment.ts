import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadQuoteDealerAvailability(client: Pick<SupabaseClient, "rpc">, quoteId: string) {
  const result = await client.rpc("get_dealer_quote_stock_availability", { p_quote_id: quoteId });
  if (result.error) throw result.error;
  const value = result.data;
  const weightKg = typeof value === "number" || (typeof value === "string" && value.trim() !== "")
    ? Number(value) : NaN;
  if (!Number.isFinite(weightKg) || weightKg < 0) {
    throw new Error("Dealer stock availability is unavailable. Refresh before creating the order.");
  }
  return weightKg;
}

export function canSubmitQuoteOrder(input: {
  quoteSelected: boolean;
  saving: boolean;
  availabilityLoading: boolean;
  availabilityError: string | null;
}) {
  return input.quoteSelected && !input.saving && !input.availabilityLoading && !input.availabilityError;
}
