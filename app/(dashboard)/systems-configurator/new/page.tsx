import { PageHeader } from "@/components/layout/page-header";
import { ConfiguratorForm } from "@/components/modules/systems-configurator/configurator-form";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";
import { loadCompleteSystemProfileSeries } from "@/lib/systems-configurator/profile-library";

export default async function NewSystemConfigurationPage() {
  const context = await getSystemsConfiguratorContext("create");
  const supabase = await createClient();
  const series = await supabase.from("system_series").select("id, series_code, series_name, system_type, stock_length_mm").eq("company_id", context.companyId).eq("is_active", true).order("series_code", { ascending: true }).limit(200);
  const availableSeries = series.data ?? [];
  const initialSeriesId = availableSeries.find((item) => item.system_type === "two_track_sliding_window")?.id
    ?? availableSeries.find((item) => item.system_type === "custom")?.id
    ?? "";
  const [customers, templates, systemProfiles, hardwareItems, glassItems, finishOptions] = await Promise.all([
    supabase.from("customers").select("id, customer_name, company_name").eq("company_id", context.companyId).eq("is_active", true).order("customer_name", { ascending: true }).limit(200),
    supabase.from("system_templates_authorized").select("id, template_code, template_name, system_type, series_id, is_default, formula_json").eq("company_id", context.companyId).eq("is_active", true).order("is_default", { ascending: false }).limit(200),
    loadCompleteSystemProfileSeries(supabase, context.companyId, initialSeriesId),
    supabase.from("hardware_items_authorized").select("id, item_code, item_name, hardware_category, default_rate, unit, is_active").eq("company_id", context.companyId).eq("is_active", true).order("item_code", { ascending: true }).limit(300),
    supabase.from("glass_items_authorized").select("id, glass_code, glass_name, glass_type, thickness_mm, rate_per_sqft, rate_per_sqm, is_active").eq("company_id", context.companyId).eq("is_active", true).order("glass_code", { ascending: true }).limit(200),
    supabase.from("finish_options_authorized").select("id, finish_code, finish_name, finish_type, color_code, rate, is_active").eq("company_id", context.companyId).eq("is_active", true).order("finish_code", { ascending: true }).limit(200)
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="New System Configuration" description="Configure project details, dimensions, system layout, libraries, and a live 2D elevation before saving a draft." />
      <ConfiguratorForm
        customers={customers.data ?? []}
        series={availableSeries}
        templates={templates.data ?? []}
        systemProfiles={systemProfiles}
        hardwareItems={hardwareItems.data ?? []}
        glassItems={glassItems.data ?? []}
        finishOptions={finishOptions.data ?? []}
      />
    </div>
  );
}
