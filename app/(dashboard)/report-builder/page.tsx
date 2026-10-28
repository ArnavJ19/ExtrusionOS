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

  const [reportsResult, companyResult] = await Promise.all([
    supabase
      .from("saved_reports")
      .select("id, report_name, data_source, visibility, created_at, config_json")
      .eq("company_id", context.companyId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("companies").select("logo_url").eq("id", context.companyId).maybeSingle()
  ]);

  return <ReportBuilderClient companyId={context.companyId} companyName={context.companyName} companyLogoUrl={companyResult.data?.logo_url ?? null} preparedBy={context.fullName ?? null} role={context.role} initialReports={(reportsResult.data ?? []) as any[]} />;
}
