import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { MetalExposureClient } from "@/components/modules/intelligence/metal-exposure";
import { getSessionContext } from "@/lib/auth";
import { EXPOSURE_ROLES } from "@/lib/intelligence/commands";

// FS-72: metal price exposure and back-to-back bookings. Visibility only.
export default async function MetalExposurePage() {
  const context = await getSessionContext();
  if (context.dealerId || !(EXPOSURE_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="Metal price exposure" description="Tonnes sold at a fixed metal price and not yet covered, against metal held and on order. This screen does not trade or advise on hedging." actions={<Link href="/insights" className="text-sm font-bold underline">Insights</Link>} />
    <MetalExposureClient canSetLimit={context.role === "owner"} />
  </div>;
}
