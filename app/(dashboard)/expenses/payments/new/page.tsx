import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewExpensePaymentPage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "financials")) redirect("/expenses/payments");
  return <RecordFormClient moduleKey="expense_payments" context={context} />;
}
