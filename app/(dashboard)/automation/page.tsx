import { redirect } from "next/navigation";
import { AutomationClient } from "@/components/modules/automation-client";
import { ModuleDisabled } from "@/components/ui/module-disabled";
import { getSessionContext } from "@/lib/auth";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { createClient } from "@/lib/supabase/server";

export default async function AutomationPage() {
  const context = await getSessionContext();
  if (!["owner", "admin"].includes(context.role)) redirect("/dashboard");

  const supabase = await createClient();
  const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
  if (!isFeatureEnabled(flags, "automation")) return <ModuleDisabled moduleName="automation" title="Automation" />;

  const [rulesResult, runsResult] = await Promise.all([
    supabase.from("automation_rules").select("id, rule_name, trigger_type, conditions_json, actions_json, is_active, created_at").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(40),
    supabase.from("automation_runs").select("id, rule_id, trigger_entity_type, status, error_message, created_at").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(60)
  ]);

  return <AutomationClient companyId={context.companyId} initialRules={(rulesResult.data ?? []) as any[]} initialRuns={(runsResult.data ?? []) as any[]} />;
}
