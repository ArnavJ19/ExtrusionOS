import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function CustomersPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "customers")) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="customers" context={context} canCreate={can(context.role, "create", "customers")} />;
}
