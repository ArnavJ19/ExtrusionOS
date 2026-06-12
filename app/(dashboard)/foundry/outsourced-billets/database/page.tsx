import { ModuleDatabaseClient } from "@/components/modules/operations/module-database-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function OutsourcedBilletsDatabasePage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "foundry")) redirect("/dashboard");
  return <ModuleDatabaseClient moduleKey="outsourced_billets" context={context} canCreate={false} />;
}
