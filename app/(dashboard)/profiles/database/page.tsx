import { ModuleDatabaseClient } from "@/components/modules/operations/module-database-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function ProfilesDatabasePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "profiles")) redirect("/dashboard");
  const params = await searchParams;
  return <ModuleDatabaseClient moduleKey="profiles" context={context} canCreate={can(context.role, "create", "profiles")} initialStatus={params.status ?? ""} />;
}
