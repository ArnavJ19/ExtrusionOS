import { redirect } from "next/navigation";
import { ReportBuilderClient } from "@/components/modules/report-builder-client";
import { ModuleDisabled } from "@/components/ui/module-disabled";
import { getSessionContext } from "@/lib/auth";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { createClient } from "@/lib/supabase/server";

export default async function ReportBuilderPage() {
  const context = await getSessionContext();
  if (!["owner", "admin", "sales_manager", "accounts"].includes(context.role)) redirect("/dashboard");

  const supabase = await createClient();
  const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
  if (!isFeatureEnabled(flags, "report_builder")) return <ModuleDisabled moduleName="report_builder" title="Report Builder" />;

  const reportsResult = await supabase
    .from("saved_reports")
    .select("id, report_name, data_source, visibility, created_at, config_json")
    .eq("company_id", context.companyId)
    .order("created_at", { ascending: false })
    .limit(30);

  return <ReportBuilderClient companyId={context.companyId} role={context.role} initialReports={(reportsResult.data ?? []) as any[]} />;
}
