import { ModuleDatabaseClient } from "@/components/modules/operations/module-database-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function PendingExpenseApprovalsPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/expenses");
  return <ModuleDatabaseClient moduleKey="expenses" context={context} canCreate={can(context.role, "create", "financials")} initialStatus="pending_approval" />;
}
