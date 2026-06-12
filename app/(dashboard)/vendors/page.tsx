import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function VendorsPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "vendors")) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="vendors" context={context} canCreate={can(context.role, "create", "vendors")} />;
}
