import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function MachineDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "machine_maintenance")) redirect("/dashboard");
  return <RecordDetailClient moduleKey="machines" recordId={params.id} context={context} canEdit={can(context.role, "update", "machine_maintenance")} />;
}
