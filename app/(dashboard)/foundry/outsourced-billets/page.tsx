import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function OutsourcedBilletsPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "foundry")) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="outsourced_billets" context={context} canCreate={false} canUpdate={can(context.role, "update", "foundry")} />;
}
