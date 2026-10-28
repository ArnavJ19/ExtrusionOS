import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { TriggerRuleForm } from "@/components/modules/tasks/task-triggers";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageTriggerRules } from "@/lib/workflow/task-triggers";

// UPGRADE_EOS feature 64: create a trigger rule.
export default async function NewTaskTriggerPage() {
  const context = await getSessionContext();
  if (context.dealerId || !canManageTriggerRules(context.role)) redirect("/tasks/triggers");
  const supabase = await createClient();
  const { data } = await supabase.from("app_users").select("id, full_name, role").eq("company_id", context.companyId).eq("is_active", true).is("dealer_id", null).order("full_name").limit(1000);
  const employees = (data ?? []).map((user: { id: string; full_name: string | null; role: string }) => ({ value: user.id, label: user.full_name || "Employee", role: user.role }));
  return (
    <div className="space-y-5">
      <PageHeader title="New trigger rule" description="Choose the event, when it raises work, who receives it and when it is due." />
      <TriggerRuleForm ruleId={randomUUID()} employees={employees} />
    </div>
  );
}
