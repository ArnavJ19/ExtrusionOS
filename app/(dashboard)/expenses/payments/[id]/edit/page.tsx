import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function EditExpensePaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  const { id } = await params;
  if (!can(context.role, "update", "financials")) redirect(`/expenses/payments/${id}`);
  return <RecordFormClient moduleKey="expense_payments" context={context} recordId={id} />;
}
