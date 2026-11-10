import { DiesOverviewClient } from "@/components/modules/dies/dies-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { DieFlagsPanel } from "@/components/modules/press/die-service";

export default async function DiesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dies")) redirect("/dashboard");
  // AP-028: dies at or near their approved service interval are flagged before the rest of the overview.
  const showFlags = !context.dealerId && ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "sales_manager"].includes(context.role);
  return <div className="space-y-6">{showFlags ? <DieFlagsPanel /> : null}<DiesOverviewClient context={context} canCreate={can(context.role, "create", "dies")} /></div>;
}
