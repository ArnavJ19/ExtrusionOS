import { ExpensePaymentFormClient } from "@/components/modules/financials/expense-payment-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { redirect } from "next/navigation";

export default async function NewExpensePaymentPage({ searchParams }: { searchParams: Promise<{ expense_id?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "create", "financials")) redirect("/expenses/payments");
  const params = await searchParams;
  const expenseId = /^[0-9a-f-]{36}$/i.test(params.expense_id ?? "") ? params.expense_id! : "";
  return <ExpensePaymentFormClient initialExpenseId={expenseId} today={getBusinessDateBoundaries().today} />;
}
