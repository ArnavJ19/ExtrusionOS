import { ModuleDatabaseClient } from "@/components/modules/operations/module-database-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function MachinesDatabasePage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "machine_maintenance")) redirect("/dashboard");
  return <ModuleDatabaseClient moduleKey="machines" context={context} canCreate={can(context.role, "create", "machine_maintenance")} />;
}
