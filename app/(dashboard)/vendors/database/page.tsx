import { ModuleDatabaseClient } from "@/components/modules/operations/module-database-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function VendorsDatabasePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "vendors")) redirect("/dashboard");
  const params = await searchParams;
  return <ModuleDatabaseClient moduleKey="vendors" context={context} canCreate={can(context.role, "create", "vendors")} initialStatus={params.status ?? ""} />;
}
