import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SystemTemplateDetail } from "@/components/modules/systems-configurator/template-manager";
import { createClient } from "@/lib/supabase/server";
import { canManageSystemTemplates, getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";

export default async function SystemTemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const { data: template, error } = await supabase.from("system_templates_authorized").select("*").eq("id", id).eq("company_id", context.companyId).single();

  if (error || !template) {
    return (
      <div className="space-y-6">
        <PageHeader title="Template Not Found" description="The requested template does not exist or is outside your company workspace." />
        <Card><CardContent><Link href="/systems-configurator/templates" className="text-sm font-black text-orange">Back to templates</Link></CardContent></Card>
      </div>
    );
  }

  const { data: series } = template.series_id
    ? await supabase.from("system_series").select("series_code, series_name").eq("id", template.series_id).eq("company_id", context.companyId).maybeSingle()
    : { data: null };
  const templateWithSeries = { ...template, system_series: series };

  return (
    <div className="space-y-6">
      <PageHeader title={template.template_name} description="Review formula JSON, validation rules, preview config, and template metadata." />
      <SystemTemplateDetail template={templateWithSeries} canManage={canManageSystemTemplates(context.role)} />
    </div>
  );
}
