import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { BundleWeightsClient } from "@/components/modules/autopilot-batch9/bundle-weights";
import { getSessionContext } from "@/lib/auth";
import { SCALE_ROLES } from "@/lib/autopilot-batch9/commands";

// AP-010: scale and typed bundle weights, and bundles outside the approved section-weight tolerance.
export default async function BundleWeightsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(SCALE_ROLES as readonly string[]).includes(context.role)) redirect("/dispatches");
  return <div className="space-y-5">
    <PageHeader title="Bundle weights" description="How each bundle was weighed and how it compares with its theoretical weight." actions={<Link href="/dispatches" className="text-sm font-bold underline">Back to dispatches</Link>} />
    <BundleWeightsClient />
  </div>;
}
