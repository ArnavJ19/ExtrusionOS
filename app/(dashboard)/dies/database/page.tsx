import { DiesDatabaseClient } from "@/components/modules/dies/dies-database-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function DiesDatabasePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dies")) redirect("/dashboard");
  const params = await searchParams;
  return <DiesDatabaseClient context={context} canCreate={can(context.role, "create", "dies")} initialStatus={params.status ?? ""} />;
}
