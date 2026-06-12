import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewPackagingPurchasePage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "packaging")) redirect("/packaging/purchases");
  return <RecordFormClient moduleKey="packaging_material_purchases" context={context} />;
}
