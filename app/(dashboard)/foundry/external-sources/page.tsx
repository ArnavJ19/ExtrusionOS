import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function ExternalSourcesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "foundry")) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="foundry_external_sources" context={context} canCreate={can(context.role, "create", "foundry")} canUpdate={can(context.role, "update", "foundry")} />;
}
