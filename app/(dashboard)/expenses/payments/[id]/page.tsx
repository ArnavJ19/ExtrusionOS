import { ExpensePaymentReversalClient } from "@/components/modules/financials/expense-payment-reversal-client";
import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function ExpensePaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/expenses/payments");
  const { id } = await params;
  const supabase = await createClient();
  const { data: payment } = await supabase.from("expense_payments")
    .select("id, expense_ledger_id, status, reversal_reason, reversed_at")
    .eq("company_id", context.companyId).eq("id", id).maybeSingle();
  return (
    <div className="space-y-6">
      <RecordDetailClient moduleKey="expense_payments" recordId={id} context={context} canEdit={false} />
      {payment ? <ExpensePaymentReversalClient payment={payment} canReverse={can(context.role, "update", "financials")} /> : null}
    </div>
  );
}
