import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewExpensePage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "financials")) redirect("/expenses");
  return <RecordFormClient moduleKey="expenses" context={context} />;
}
