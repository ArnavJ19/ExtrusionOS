import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewFoundryBatchPage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "foundry")) redirect("/foundry");
  return <RecordFormClient moduleKey="foundry" context={context} />;
}
