import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { OperationalWorkLinks } from "@/components/modules/shared/operational-work-links";

export default async function PaymentsPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/dashboard");
  return <><OperationalWorkLinks area="payments" role={context.role} dealer={!!context.dealerId}/><ModuleOverviewClient moduleKey="payments" context={context} canCreate={can(context.role, "create", "financials")} /></>;
}
