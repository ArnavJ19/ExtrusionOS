import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function InvoicesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="invoices" context={context} canCreate={can(context.role, "create", "financials")} />;
}
