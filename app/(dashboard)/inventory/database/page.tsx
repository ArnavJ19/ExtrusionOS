import { ModuleDatabaseClient } from "@/components/modules/operations/module-database-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function InventoryDatabasePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId) redirect("/inventory");
  if (!can(context.role, "read", "inventory")) redirect("/dashboard");
  const params = await searchParams;
  return <ModuleDatabaseClient moduleKey="inventory" context={context} canCreate={can(context.role, "create", "inventory")} initialStatus={params.status ?? ""} />;
}
