import { ModuleDatabaseClient } from "@/components/modules/operations/module-database-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function ProductionDatabasePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "production")) redirect("/dashboard");
  const params = await searchParams;
  return <ModuleDatabaseClient moduleKey="production" context={context} canCreate={can(context.role, "create", "production")} initialStatus={params.status ?? ""} />;
}
