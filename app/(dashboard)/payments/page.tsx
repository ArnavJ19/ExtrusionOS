import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function PaymentsPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "payments", context.permissions)) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="payments" context={context} canCreate={can(context.role, "create", "payments", context.permissions)} />;
}
