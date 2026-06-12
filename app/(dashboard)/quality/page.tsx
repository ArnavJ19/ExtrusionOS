import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { ModuleDisabled } from "@/components/ui/module-disabled";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function QualityPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
  if (!isFeatureEnabled(flags, "quality_compliance")) return <ModuleDisabled moduleName="quality_compliance" title="Quality" />;
  if (!can(context.role, "read", "quality")) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="quality" context={context} canCreate={can(context.role, "create", "quality")} canUpdate={can(context.role, "update", "quality")} />;
}
