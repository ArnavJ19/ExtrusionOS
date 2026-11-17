import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { ReorderClient } from "@/components/modules/autopilot-batch6/reorder";
import { REORDER_APPROVERS, REORDER_READERS } from "@/lib/autopilot-batch6/commands";

export default async function ReorderPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(REORDER_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="Reorder points" description="Consumption-based reorder points for consumables, and the requisitions they raise." actions={<Link href="/inventory" className="text-sm font-bold underline">Back to inventory</Link>} />
    <ReorderClient canApprove={(REORDER_APPROVERS as readonly string[]).includes(context.role)} /></div>;
}
