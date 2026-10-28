import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CriteriaTemplateForm } from "@/components/modules/tasks/completion-criteria";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageTemplates, templateListSchema } from "@/lib/workflow/completion-criteria";

// UPGRADE_EOS feature 67: edit a standard criterion (applies to tasks created afterwards).
export default async function EditCriteriaTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canManageTemplates(context.role)) redirect("/tasks/criteria");
  const { id } = await params;
  const supabase = await createClient();
  const result = await supabase.rpc("task_criteria_command", { p_command: "templates.list", p_payload: {} });
  const parsed = result.error ? null : templateListSchema.safeParse(result.data);
  const template = parsed?.success ? parsed.data.find((row) => row.id === id) : undefined;
  if (!template) redirect("/tasks/criteria");
  return (
    <div className="space-y-5">
      <PageHeader title={`Edit: ${template.label}`} description="Changes apply to tasks created from now on." />
      <CriteriaTemplateForm templateId={template.id} initial={template} />
    </div>
  );
}
