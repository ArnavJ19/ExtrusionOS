import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewInventoryItemPage() {
  const context = await getSessionContext();
  if (context.dealerId) redirect("/inventory");
  if (!can(context.role, "create", "inventory")) redirect("/inventory");
  return <RecordFormClient moduleKey="inventory" context={context} />;
}
