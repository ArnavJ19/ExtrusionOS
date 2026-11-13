import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LateLines } from "@/components/modules/autopilot-operations/operations";
import { getSessionContext } from "@/lib/auth";
import { COORDINATORS, PLANNERS } from "@/lib/autopilot-batch5/operations";

export default async function OrderRiskPage() {
  const context = await getSessionContext();
  if (context.dealerId || !COORDINATORS.includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="Order red list" description="Resolve blocking stages before a promised date is missed." /><LateLines canPredict={PLANNERS.includes(context.role) && context.role !== "inventory_manager"} /></div>;
}
