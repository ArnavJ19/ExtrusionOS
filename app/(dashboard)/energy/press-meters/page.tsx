import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PressMetersClient } from "@/components/modules/autopilot-batch10/energy";
import { getSessionContext } from "@/lib/auth";
import { ENERGY_ROLES, ENERGY_WRITERS } from "@/lib/autopilot-batch10/commands";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

// AP-021: meter readings per press and shift, and the energy they give each job and die.
export default async function PressMetersPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(ENERGY_ROLES as readonly string[]).includes(context.role)) redirect("/energy");
  return <div className="space-y-5">
    <PageHeader title="Press meter readings" description="Two readings per press per shift give kWh per job, die and press from actual running time." actions={<Link href="/energy" className="text-sm font-bold underline">Back to energy</Link>} />
    <PressMetersClient today={getBusinessDateBoundaries().today} canWrite={(ENERGY_WRITERS as readonly string[]).includes(context.role)} />
  </div>;
}
