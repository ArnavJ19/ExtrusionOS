import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function ProfilesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "profiles")) redirect("/dashboard");
  return <ModuleOverviewClient moduleKey="profiles" context={context} canCreate={can(context.role, "create", "profiles")} />;
}
