import { PageHeader } from "@/components/layout/page-header";
import { ConfiguratorForm } from "@/components/modules/systems-configurator/configurator-form";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";

export default async function NewSystemConfigurationPage() {
  const context = await getSystemsConfiguratorContext("create");
  const supabase = await createClient();
  const [customers, series, templates, systemProfiles, hardwareItems, glassItems, finishOptions] = await Promise.all([
    supabase.from("customers").select("id, customer_name, company_name").eq("company_id", context.companyId).eq("is_active", true).order("customer_name", { ascending: true }).limit(200),
    supabase.from("system_series").select("id, series_code, series_name, system_type, stock_length_mm").eq("company_id", context.companyId).eq("is_active", true).order("series_code", { ascending: true }).limit(200),
    supabase.from("system_templates").select("id, template_code, template_name, system_type, series_id, is_default, formula_json").eq("company_id", context.companyId).eq("is_active", true).order("is_default", { ascending: false }).limit(200),
    supabase.from("system_profiles").select("id, series_id, profile_id, component_role, display_name, is_required, is_active, sort_order, default_quantity_formula, default_length_formula, aluminium_profiles(profile_code, profile_name, section_weight_kg_per_m)").eq("company_id", context.companyId).eq("is_active", true).order("sort_order", { ascending: true }).limit(500),
    supabase.from("hardware_items").select("id, item_code, item_name, hardware_category, default_rate, unit, is_active").eq("company_id", context.companyId).eq("is_active", true).order("item_code", { ascending: true }).limit(300),
    supabase.from("glass_items").select("id, glass_code, glass_name, glass_type, thickness_mm, rate_per_sqft, rate_per_sqm, is_active").eq("company_id", context.companyId).eq("is_active", true).order("glass_code", { ascending: true }).limit(200),
    supabase.from("finish_options").select("id, finish_code, finish_name, finish_type, color_code, rate, is_active").eq("company_id", context.companyId).eq("is_active", true).order("finish_code", { ascending: true }).limit(200)
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="New System Configuration" description="Configure project details, dimensions, system layout, libraries, and a live 2D elevation before saving a draft." />
      <ConfiguratorForm
        customers={customers.data ?? []}
        series={series.data ?? []}
        templates={templates.data ?? []}
        systemProfiles={systemProfiles.data ?? []}
        hardwareItems={hardwareItems.data ?? []}
        glassItems={glassItems.data ?? []}
        finishOptions={finishOptions.data ?? []}
      />
    </div>
  );
}
