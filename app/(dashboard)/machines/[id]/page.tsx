import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { machineControls } from "@/lib/workflow/erp-control-panels";

export default async function MachineDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "machine_maintenance")) redirect("/dashboard");
  const supabase = await createClient();
  const controls = await machineControls(supabase, context, params.id);
  return <div className="space-y-6">
    <RecordDetailClient moduleKey="machines" recordId={params.id} context={context} canEdit={can(context.role, "update", "machine_maintenance")} />
    <ErpControlPanel title="Return to service" actions={controls} />
  </div>;
}
