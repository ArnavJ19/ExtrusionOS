import { DiesOverviewClient } from "@/components/modules/dies/dies-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function DiesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dies")) redirect("/dashboard");
  return <DiesOverviewClient context={context} canCreate={can(context.role, "create", "dies")} />;
}
