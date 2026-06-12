import { ModuleDatabaseClient } from "@/components/modules/operations/module-database-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function DispatchesDatabasePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dispatches")) redirect("/dashboard");
  const params = await searchParams;
  return <ModuleDatabaseClient moduleKey="dispatches" context={context} canCreate={can(context.role, "create", "dispatches")} initialStatus={params.status ?? ""} />;
}
