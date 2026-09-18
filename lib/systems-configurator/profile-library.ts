import type { SupabaseClient } from "@supabase/supabase-js";

export const systemProfileLibrarySelect = "id, series_id, profile_id, component_role, display_name, is_required, is_active, sort_order, deduction_mm, addition_mm, default_quantity_formula, default_length_formula, aluminium_profiles(id, profile_code, profile_name, section_weight_kg_per_m)";

const SYSTEM_PROFILE_PAGE_SIZE = 200;

export async function loadCompleteSystemProfileSeries(
  supabase: SupabaseClient<any>,
  companyId: string,
  seriesId: string
) {
  if (!seriesId) return [];

  const rows: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("system_profiles")
      .select(systemProfileLibrarySelect)
      .eq("company_id", companyId)
      .eq("series_id", seriesId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + SYSTEM_PROFILE_PAGE_SIZE - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);
    if (page.length < SYSTEM_PROFILE_PAGE_SIZE) break;
    offset += SYSTEM_PROFILE_PAGE_SIZE;
  }
  return rows;
}
