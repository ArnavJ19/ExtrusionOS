import { ExpenseControlPanel, type ExpensePanelCredit, type ExpensePanelExpense, type ExpensePanelPayment } from "@/components/modules/financials/expense-control-panel";
import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { redirect } from "next/navigation";

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/expenses");
  const { id } = await params;
  const supabase = await createClient();
  const [expense, payments, credits] = await Promise.all([
    supabase.from("expense_ledger_authorized").select("id, expense_number, approval_status, payment_status, total_amount, amount_paid, refunded_amount, credited_amount, balance_amount, supplier_credit_due, source_table, deleted_at, approval_note")
      .eq("company_id", context.companyId).eq("id", id).maybeSingle(),
    supabase.from("expense_payments").select("id, payment_date, amount_paid, payment_method, reference_number, status, reversal_reason")
      .eq("company_id", context.companyId).eq("expense_ledger_id", id).order("payment_date", { ascending: false }).limit(200),
    supabase.from("expense_supplier_credits").select("id, credit_type, credit_date, amount, payment_method, reference_number, reason, status, reversal_reason")
      .eq("company_id", context.companyId).eq("expense_ledger_id", id).order("credit_date", { ascending: false }).limit(200)
  ]);
  const errors = [expense.error, payments.error, credits.error].filter(Boolean).map((error) => error!.message);
  return (
    <div className="space-y-6">
      <RecordDetailClient moduleKey="expenses" recordId={id} context={context} canEdit={can(context.role, "update", "financials")} />
      <QueryErrorNotice messages={errors.length ? ["Settlement details are unavailable. Retry after the database deployment is verified."] : []} />
      {expense.data ? (
        <ExpenseControlPanel
          expense={expense.data as ExpensePanelExpense}
          payments={(payments.data ?? []) as ExpensePanelPayment[]}
          credits={(credits.data ?? []) as ExpensePanelCredit[]}
          role={context.role}
          today={getBusinessDateBoundaries().today}
        />
      ) : null}
    </div>
  );
}
