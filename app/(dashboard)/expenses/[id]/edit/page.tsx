import Link from "next/link";
import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { canEditManualExpense } from "@/lib/financials/expenses";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  const { id } = await params;
  if (!can(context.role, "update", "financials")) redirect(`/expenses/${id}`);
  const supabase = await createClient();
  const { data: expense } = await supabase.from("expense_ledger")
    .select("id, expense_number, approval_status, source_table, deleted_at")
    .eq("company_id", context.companyId).eq("id", id).maybeSingle();
  if (!expense) redirect("/expenses");
  if (!canEditManualExpense(expense)) {
    const reason = expense.source_table
      ? "This expense is posted from a source record. Change the cost at its source so stock, payables and the source stay reconciled."
      : `This expense is ${String(expense.approval_status).replace(/_/g, " ")} and locked. An owner or admin can reopen an approved expense with a reason from its detail page.`;
    return (
      <Card>
        <CardContent className="space-y-4 py-8">
          <h1 className="text-xl font-bold text-neutral-950">{expense.expense_number} cannot be edited here</h1>
          <p className="max-w-2xl text-sm font-medium leading-6 text-neutral-600">{reason}</p>
          <Link href={`/expenses/${id}`} className="inline-flex rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">Back to expense</Link>
        </CardContent>
      </Card>
    );
  }
  return <RecordFormClient moduleKey="expenses" context={context} recordId={id} />;
}
