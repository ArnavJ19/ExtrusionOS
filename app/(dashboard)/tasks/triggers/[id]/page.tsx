import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { TriggerRuleForm } from "@/components/modules/tasks/task-triggers";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageTriggerRules, ruleListSchema } from "@/lib/workflow/task-triggers";

// UPGRADE_EOS feature 64: edit a trigger rule (its event is fixed once saved).
export default async function EditTaskTriggerPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canManageTriggerRules(context.role)) redirect("/tasks/triggers");
  const { id } = await params;
  const supabase = await createClient();
  const [rulesResult, usersResult] = await Promise.all([
    supabase.rpc("task_trigger_command", { p_command: "rules.list", p_payload: {} }),
    supabase.from("app_users").select("id, full_name, role").eq("company_id", context.companyId).eq("is_active", true).is("dealer_id", null).order("full_name").limit(1000)
  ]);
  const parsed = rulesResult.error ? null : ruleListSchema.safeParse(rulesResult.data);
  const rule = parsed?.success ? parsed.data.rows.find((row) => row.id === id) : undefined;
  if (!rule) redirect("/tasks/triggers");
  const employees = (usersResult.data ?? []).map((user: { id: string; full_name: string | null; role: string }) => ({ value: user.id, label: user.full_name || "Employee", role: user.role }));
  return (
    <div className="space-y-5">
      <PageHeader title={`Edit rule: ${rule.name}`} description="Changes apply to work raised from now on. Tasks already raised keep their source and assignee." />
      <TriggerRuleForm ruleId={rule.id} employees={employees} initial={rule} />
    </div>
  );
}
