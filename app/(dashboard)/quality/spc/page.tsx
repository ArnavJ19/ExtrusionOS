import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SpcAlarmsPanel, SpcChartsClient } from "@/components/modules/autopilot-batch8/spc";
import { getSessionContext } from "@/lib/auth";
import { SPC_READERS } from "@/lib/autopilot-batch8/commands";

// AP-052: control charts for every active characteristic, and the alarm queue.
export default async function SpcPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(SPC_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="Quality control charts" description="Hardness, wall thickness, section weight and coating thickness trended against the approved plan limits." actions={<Link href="/quality" className="text-sm font-bold underline">Back to quality</Link>} />
    <SpcAlarmsPanel />
    <SpcChartsClient />
  </div>;
}
