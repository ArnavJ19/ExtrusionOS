import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnterpriseModuleName } from "@/types/app";

const enterpriseModules: EnterpriseModuleName[] = ["ai_assistant", "whatsapp_automation", "dealer_portal", "advanced_inventory", "production_planning", "quality_compliance", "export_docs", "tender_management", "energy_monitoring", "machine_maintenance", "bis_compliance", "profitability_intelligence", "barcode_tracking", "accounting_integrations", "mobile_floor_app", "multi_plant", "systems_configurator", "document_intelligence", "die_intelligence", "crm", "report_builder", "automation", "command_center"];

export type FeatureFlagState = Record<EnterpriseModuleName, boolean>;

export const defaultFeatureFlags: FeatureFlagState = enterpriseModules.reduce((flags, moduleName) => {
  flags[moduleName] = ["production_planning", "advanced_inventory", "quality_compliance", "command_center", "energy_monitoring", "machine_maintenance", "tender_management", "export_docs", "bis_compliance", "profitability_intelligence"].includes(moduleName);
  return flags;
}, {} as FeatureFlagState);

export async function getFeatureFlagsForCompany(supabase: SupabaseClient, companyId: string): Promise<FeatureFlagState> {
  const { data, error } = await supabase
    .from("feature_flags")
    .select("module_name, is_enabled")
    .eq("company_id", companyId);

  if (error || !data) return defaultFeatureFlags;

  return data.reduce((flags, flag) => {
    if (enterpriseModules.includes(flag.module_name as EnterpriseModuleName)) {
      flags[flag.module_name as EnterpriseModuleName] = Boolean(flag.is_enabled);
    }
    return flags;
  }, { ...defaultFeatureFlags });
}

export function isFeatureEnabled(flags: Partial<FeatureFlagState>, moduleName: EnterpriseModuleName) {
  return flags[moduleName] ?? defaultFeatureFlags[moduleName] ?? false;
}
