import { ModuleWorkflows } from "@/components/modules/home-work/module-workflows";
import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { OperationalWorkLinks } from "@/components/modules/shared/operational-work-links";

export default async function InvoicesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/dashboard");
  return <><OperationalWorkLinks area="invoices" role={context.role} dealer={!!context.dealerId}/>{!context.dealerId ? <ModuleWorkflows module="invoices" role={context.role} /> : null}<ModuleOverviewClient moduleKey="invoices" context={context} canCreate={can(context.role, "create", "financials")} /></>;
}
