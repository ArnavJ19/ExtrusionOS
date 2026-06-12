import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function MachineNewPage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "machine_maintenance")) redirect("/dashboard");
  return <RecordFormClient moduleKey="machines" context={context} />;
}
