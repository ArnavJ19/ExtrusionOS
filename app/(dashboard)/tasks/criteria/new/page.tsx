import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CriteriaTemplateForm } from "@/components/modules/tasks/completion-criteria";
import { getSessionContext } from "@/lib/auth";
import { canManageTemplates } from "@/lib/workflow/completion-criteria";

// UPGRADE_EOS feature 67: a standard criterion for a kind of task.
export default async function NewCriteriaTemplatePage() {
  const context = await getSessionContext();
  if (context.dealerId || !canManageTemplates(context.role)) redirect("/tasks/criteria");
  return (
    <div className="space-y-5">
      <PageHeader title="New standard criterion" description="Choose the kind of task and the outcome it must reach before it can be completed." />
      <CriteriaTemplateForm templateId={randomUUID()} />
    </div>
  );
}
