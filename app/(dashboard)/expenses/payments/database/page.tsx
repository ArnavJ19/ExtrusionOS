import { ModuleDatabaseClient } from "@/components/modules/operations/module-database-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function ExpensePaymentsDatabasePage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/dashboard");
  return <ModuleDatabaseClient moduleKey="expense_payments" context={context} canCreate={can(context.role, "create", "financials")} />;
}
