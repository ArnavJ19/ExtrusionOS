import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function ExpensesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="expenses" context={context} canCreate={can(context.role, "create", "financials")} canUpdate={can(context.role, "update", "financials")} />;
}
