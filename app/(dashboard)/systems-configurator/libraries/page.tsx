import { PageHeader } from "@/components/layout/page-header";
import { SystemsLibraryManager } from "@/components/modules/systems-configurator/library-manager";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";

export default async function SystemLibrariesPage() {
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const canManage = ["owner", "admin", "sales_manager"].includes(context.role);

  const [series, profiles, systemProfiles, hardwareItems, glassItems, finishOptions, vendors] = await Promise.all([
    supabase.from("system_series").select("*").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(50),
    supabase.from("aluminium_profiles").select("id, profile_code, profile_name, section_weight_kg_per_m").eq("company_id", context.companyId).eq("is_active", true).order("profile_code", { ascending: true }).limit(200),
    supabase.from("system_profiles").select("*, system_series(series_code, series_name), aluminium_profiles(profile_code, profile_name, section_weight_kg_per_m)").eq("company_id", context.companyId).order("sort_order", { ascending: true }).limit(100),
    supabase.from("hardware_items").select("*").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(50),
    supabase.from("glass_items").select("*").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(50),
    supabase.from("finish_options").select("*").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(50),
    supabase.from("vendors").select("id, vendor_name").eq("company_id", context.companyId).eq("is_active", true).order("vendor_name", { ascending: true }).limit(100)
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Configurator Libraries" description="Set up system series, profile roles, hardware, glass, finish options, accessories, and rates for the rule engine." />
      <SystemsLibraryManager
        canManage={canManage}
        series={series.data ?? []}
        profiles={profiles.data ?? []}
        systemProfiles={systemProfiles.data ?? []}
        hardwareItems={hardwareItems.data ?? []}
        glassItems={glassItems.data ?? []}
        finishOptions={finishOptions.data ?? []}
        vendors={vendors.data ?? []}
      />
    </div>
  );
}
