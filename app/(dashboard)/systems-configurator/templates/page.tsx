import { PageHeader } from "@/components/layout/page-header";
import { SystemTemplateManager } from "@/components/modules/systems-configurator/template-manager";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";

export default async function SystemTemplatesPage() {
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const canManage = ["owner", "admin", "sales_manager"].includes(context.role);
  const [templates, series] = await Promise.all([
    supabase.from("system_templates").select("*, system_series(series_code, series_name)").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(100),
    supabase.from("system_series").select("id, series_code, series_name").eq("company_id", context.companyId).eq("is_active", true).order("series_code", { ascending: true }).limit(100)
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="System Templates" description="Create and manage formula template shells for system types, series defaults, validations, and preview settings." />
      <SystemTemplateManager canManage={canManage} templates={templates.data ?? []} series={series.data ?? []} />
    </div>
  );
}
