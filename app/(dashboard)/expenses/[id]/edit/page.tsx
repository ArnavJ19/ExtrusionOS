import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  const { id } = await params;
  if (!can(context.role, "update", "financials")) redirect(`/expenses/${id}`);
  return <RecordFormClient moduleKey="expenses" context={context} recordId={id} />;
}
