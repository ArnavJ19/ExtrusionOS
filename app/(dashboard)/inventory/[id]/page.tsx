import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { InventoryMovements } from "@/components/modules/autopilot-operations/operations";

export default async function InventoryItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "inventory")) redirect("/dashboard");
  return <div className="space-y-6">
    <RecordDetailClient moduleKey="inventory" context={context} recordId={id} canEdit={can(context.role, "update", "inventory")} />
    <InventoryMovements itemId={id} canAdjust={["owner", "admin", "inventory_manager", "factory_manager"].includes(context.role)} />
  </div>;
}
