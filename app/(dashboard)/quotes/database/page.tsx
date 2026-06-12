import { ModuleDatabaseClient } from "@/components/modules/operations/module-database-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function QuotesDatabasePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "quotes")) redirect("/dashboard");
  const params = await searchParams;
  return <ModuleDatabaseClient moduleKey="quotes" context={context} canCreate={can(context.role, "create", "quotes")} initialStatus={params.status ?? ""} />;
}
