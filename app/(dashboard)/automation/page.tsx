import Link from "next/link";
import { redirect } from "next/navigation";
import { AutomationClient } from "@/components/modules/automation-client";
import { JobsPanel } from "@/components/modules/autopilot/jobs-panel";
import { AlertResolutionsPanel } from "@/components/modules/order-to-cash/quotes-alerts";
import { ModuleDisabled } from "@/components/ui/module-disabled";
import { autopilotAction } from "@/lib/actions/autopilot";
import { getSessionContext } from "@/lib/auth";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { jobsOverviewSchema } from "@/lib/jobs/registry";
import { createClient } from "@/lib/supabase/server";

export default async function AutomationPage() {
  const context = await getSessionContext();
  if (!["owner", "admin"].includes(context.role)) redirect("/dashboard");

  const supabase = await createClient();
  const [flags, jobsResult] = await Promise.all([getFeatureFlagsForCompany(supabase, context.companyId), autopilotAction("ap_jobs", "overview", {})]);
  const jobs = jobsResult.success ? jobsOverviewSchema.safeParse(jobsResult.data) : null;
  // AP-001: scheduled jobs are system health, so they show even when the rule builder module is switched off.
  const jobsPanel = <><Link href="/automation/health" className="inline-flex min-h-10 items-center rounded-xl bg-neutral-950 px-3 text-sm font-semibold text-white">System health</Link><JobsPanel initial={jobs?.success ? jobs.data : null} initialError={jobs?.success ? null : jobsResult.success ? "The job ledger returned an unexpected result." : jobsResult.error} /><AlertResolutionsPanel /></>;
  if (!isFeatureEnabled(flags, "automation")) return <div className="space-y-5">{jobsPanel}<ModuleDisabled moduleName="automation" title="Automation rule builder" /></div>;

  const [rulesResult, runsResult] = await Promise.all([
    supabase.from("automation_rules").select("id, rule_name, trigger_type, conditions_json, actions_json, is_active, created_at").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(40),
    supabase.from("automation_runs").select("id, rule_id, trigger_entity_type, status, error_message, created_at, result_json").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(60)
  ]);

  return <div className="space-y-5">{jobsPanel}<AutomationClient companyId={context.companyId} initialRules={(rulesResult.data ?? []) as any[]} initialRuns={(runsResult.data ?? []) as any[]} /></div>;
}
