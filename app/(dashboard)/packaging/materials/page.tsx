import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function PackagingMaterialsPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "packaging")) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="packaging_materials" context={context} canCreate={can(context.role, "create", "packaging")} canUpdate={can(context.role, "update", "packaging")} />;
}
