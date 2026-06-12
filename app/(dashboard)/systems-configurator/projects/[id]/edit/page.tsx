import { PageHeader } from "@/components/layout/page-header";
import { ConfiguratorForm } from "@/components/modules/systems-configurator/configurator-form";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";
import { updateSystemConfigurationDraft } from "@/lib/systems-configurator/actions";

export default async function EditSystemProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSystemsConfiguratorContext("update");
  const supabase = await createClient();
  const { data: configuration, error } = await supabase
    .from("system_configurations")
    .select("*")
    .eq("id", id)
    .eq("company_id", context.companyId)
    .single();

  if (error || !configuration) {
    return <PageHeader title="Configuration Not Found" description="The requested system configuration does not exist or is outside your company workspace." />;
  }

  const [customers, series, templates, systemProfiles, hardwareItems, glassItems, finishOptions] = await Promise.all([
    supabase.from("customers").select("id, customer_name, company_name").eq("company_id", context.companyId).order("customer_name", { ascending: true }).limit(200),
    supabase.from("system_series").select("id, series_code, series_name, system_type, stock_length_mm, is_active").eq("company_id", context.companyId).order("series_code", { ascending: true }).limit(200),
    supabase.from("system_templates").select("id, template_code, template_name, system_type, series_id, is_default, is_active, formula_json").eq("company_id", context.companyId).order("is_default", { ascending: false }).limit(200),
    supabase.from("system_profiles").select("id, series_id, profile_id, component_role, display_name, is_required, is_active, sort_order, default_quantity_formula, default_length_formula, aluminium_profiles(profile_code, profile_name, section_weight_kg_per_m)").eq("company_id", context.companyId).order("sort_order", { ascending: true }).limit(500),
    supabase.from("hardware_items").select("id, item_code, item_name, hardware_category, default_rate, unit, is_active").eq("company_id", context.companyId).order("item_code", { ascending: true }).limit(300),
    supabase.from("glass_items").select("id, glass_code, glass_name, glass_type, thickness_mm, rate_per_sqft, rate_per_sqm, is_active").eq("company_id", context.companyId).order("glass_code", { ascending: true }).limit(200),
    supabase.from("finish_options").select("id, finish_code, finish_name, finish_type, color_code, rate, is_active").eq("company_id", context.companyId).order("finish_code", { ascending: true }).limit(200)
  ]);
  const updateAction = updateSystemConfigurationDraft.bind(null, id);

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Configuration" description="Update dimensions, system layout, selected libraries, and project details. Saving resets stale calculations so the configuration can be recalculated." />
      <ConfiguratorForm
        customers={customers.data ?? []}
        series={series.data ?? []}
        templates={templates.data ?? []}
        systemProfiles={systemProfiles.data ?? []}
        hardwareItems={hardwareItems.data ?? []}
        glassItems={glassItems.data ?? []}
        finishOptions={finishOptions.data ?? []}
        initialConfiguration={configuration}
        action={updateAction}
        submitLabel="Update Draft"
      />
    </div>
  );
}
