import type { SupabaseClient } from "@supabase/supabase-js";
import { compareQuoteVersions, compareResponseSchema, type CompareResponse } from "./quote-revision-compare";

export type QuoteComparisonState =
  | { status: "ready"; data: CompareResponse; result: ReturnType<typeof compareQuoteVersions>; names: { profiles: Record<string, string>; customers: Record<string, string>; dies: Record<string, string> } }
  | { status: "error"; message: string };

const unavailableCodes = new Set(["PGRST202", "42883", "42P01"]);

// UPGRADE_EOS feature 25: loads two role-projected versions and the display names they reference.
export async function loadQuoteComparison(supabase: Pick<SupabaseClient, "rpc" | "from">, companyId: string, quoteId: string, from: number | null, to: number | null): Promise<QuoteComparisonState> {
  const result = await supabase.rpc("quote_revision_compare", { p_quote_id: quoteId, p_from: from, p_to: to });
  if (result.error) {
    const code = result.error.code ?? "";
    if (unavailableCodes.has(code)) return { status: "error", message: "Version comparison is not available on this database yet. The database upgrade must be applied first." };
    if (code === "42501") return { status: "error", message: "You do not have permission to compare versions of this quotation." };
    if (code === "P0001" && ["Choose two different recorded versions", "That version was not recorded", "That recorded version cannot be compared", "Quotation is unavailable"].includes(result.error.message)) {
      return { status: "error", message: result.error.message };
    }
    return { status: "error", message: "The recorded versions could not be loaded. Refresh and try again." };
  }
  const parsed = compareResponseSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.quote.id !== quoteId) return { status: "error", message: "The recorded versions returned an unexpected shape, so no comparison is shown." };
  const data = parsed.data;
  const ids = (key: string, rows: Record<string, unknown>[]) => [...new Set(rows.map((row) => row[key]).filter((value): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)))];
  const allItems = [...data.from.items, ...data.to.items];
  const profileIds = ids("profile_id", allItems);
  const dieIds = ids("die_id", allItems);
  const customerIds = ids("customer_id", [data.from.header, data.to.header]);
  const [profiles, dies, customers] = await Promise.all([
    profileIds.length ? supabase.from("aluminium_profiles").select("id, profile_code").eq("company_id", companyId).in("id", profileIds) : Promise.resolve({ data: [], error: null }),
    dieIds.length ? supabase.from("dies").select("id, die_number").eq("company_id", companyId).in("id", dieIds) : Promise.resolve({ data: [], error: null }),
    customerIds.length ? supabase.from("customers").select("id, customer_name").eq("company_id", companyId).in("id", customerIds) : Promise.resolve({ data: [], error: null })
  ]);
  // Missing names fall back to "Unavailable record" in the view; they never block the comparison.
  const map = (rows: unknown, label: string) => Object.fromEntries(((rows as Record<string, unknown>[] | null) ?? []).map((row) => [String(row.id), String(row[label] ?? "")]));
  return {
    status: "ready",
    data,
    result: compareQuoteVersions(data.from, data.to),
    names: { profiles: map(profiles.data, "profile_code"), dies: map(dies.data, "die_number"), customers: map(customers.data, "customer_name") }
  };
}
