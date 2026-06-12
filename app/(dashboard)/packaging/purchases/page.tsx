import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function PackagingPurchasesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "packaging")) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="packaging_material_purchases" context={context} canCreate={can(context.role, "create", "packaging")} canUpdate={can(context.role, "update", "packaging")} />;
}
