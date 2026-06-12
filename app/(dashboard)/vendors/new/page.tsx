import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewVendorPage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "vendors")) redirect("/vendors");
  return <RecordFormClient moduleKey="vendors" context={context} />;
}
