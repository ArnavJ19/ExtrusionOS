import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function MachineEditPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const context = await getSessionContext();
  if (!can(context.role, "update", "machine_maintenance")) redirect("/dashboard");
  return <RecordFormClient moduleKey="machines" recordId={params.id} context={context} />;
}
