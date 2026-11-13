import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { WeightDriftList } from "@/components/modules/autopilot-batch6/weight";
import { WEIGHT_READERS, WEIGHT_SETTERS } from "@/lib/autopilot-batch6/commands";

export default async function WeightDriftPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(WEIGHT_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="Section weight" description="Actual kg/m from weighed bundles against each die's master weight." actions={<Link href="/dies" className="text-sm font-bold underline">Back to dies</Link>} />
    <WeightDriftList canSet={(WEIGHT_SETTERS as readonly string[]).includes(context.role)} /></div>;
}
