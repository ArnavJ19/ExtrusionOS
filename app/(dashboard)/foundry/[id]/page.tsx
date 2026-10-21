import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { foundryBatchControls } from "@/lib/workflow/erp-control-panels";

export default async function FoundryBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "foundry")) redirect("/dashboard");
  const supabase = await createClient();
  const controls = await foundryBatchControls(supabase, context, id);
  return <div className="space-y-6">
    <RecordDetailClient moduleKey="foundry" context={context} recordId={id} canEdit={can(context.role, "update", "foundry")} />
    <ErpControlPanel title="Cast result and chemistry release" actions={controls} />
  </div>;
}
