import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { inventoryControls } from "@/lib/workflow/erp-control-panels";

export default async function InventoryItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "inventory")) redirect("/dashboard");
  const controls = inventoryControls(context, id);
  return <div className="space-y-6">
    <RecordDetailClient moduleKey="inventory" context={context} recordId={id} canEdit={can(context.role, "update", "inventory")} />
    <ErpControlPanel title="Stock ledger" actions={controls} />
  </div>;
}
