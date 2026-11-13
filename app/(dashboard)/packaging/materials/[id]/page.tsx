import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { QuantityTrace } from "@/components/modules/autopilot-operations/operations";

export default async function PackagingMaterialDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "packaging")) redirect("/dashboard");
  return <div className="space-y-5"><RecordDetailClient moduleKey="packaging_materials" context={context} recordId={id} canEdit={can(context.role, "update", "packaging")} />
    {["owner", "admin", "inventory_manager", "factory_manager", "production_manager", "accounts"].includes(context.role) ? <QuantityTrace table="packaging_materials" id={id} /> : null}</div>;
}
