import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function MachinesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "machine_maintenance")) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="machines" context={context} canCreate={can(context.role, "create", "machine_maintenance")} canUpdate={can(context.role, "update", "machine_maintenance")} />;
}
