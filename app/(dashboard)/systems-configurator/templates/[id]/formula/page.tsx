import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SystemFormulaEditor } from "@/components/modules/systems-configurator/template-manager";
import { createClient } from "@/lib/supabase/server";
import { canManageSystemTemplates, getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";

export default async function SystemFormulaEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSystemsConfiguratorContext("update");
  if (!canManageSystemTemplates(context.role)) redirect(`/systems-configurator/templates/${id}`);

  const supabase = await createClient();
  const { data: template, error } = await supabase.from("system_templates").select("*").eq("id", id).eq("company_id", context.companyId).single();

  if (error || !template) {
    return (
      <div className="space-y-6">
        <PageHeader title="Template Not Found" description="The requested template does not exist or is outside your company workspace." />
        <Card><CardContent>Return to the template list and select an active template.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`Formula Editor: ${template.template_name}`} description="Edit safe JSON formula definitions. Arbitrary JavaScript is never executed from database formulas." />
      <SystemFormulaEditor template={template} />
    </div>
  );
}
