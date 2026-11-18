import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { MaterialPlanClient } from "@/components/modules/intelligence/material-plan";
import { getSessionContext } from "@/lib/auth";
import { MRP_APPROVERS, MRP_ROLES } from "@/lib/intelligence/commands";

// FS-27: weekly material requirements plan.
export default async function MaterialPlanPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(MRP_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="What to buy and what to cast" description="Billet by alloy, diameter and week from open orders and the plan, against stock and incoming; packaging and consumables; dies due for replacement." />
    <MaterialPlanClient canApprove={(MRP_APPROVERS as readonly string[]).includes(context.role)} />
  </div>;
}
