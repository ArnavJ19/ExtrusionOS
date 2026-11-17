import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CrewShiftReport } from "@/components/modules/autopilot-batch10/crew";
import { getSessionContext } from "@/lib/auth";
import { CREW_ROLES } from "@/lib/autopilot-batch10/commands";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

// AP-022: crew and output per press per shift, derived from sign-ins at the press station.
export default async function PressCrewPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(CREW_ROLES as readonly string[]).includes(context.role)) redirect("/production");
  return <div className="space-y-5">
    <PageHeader title="Press crew" description="Who worked which press, from sign-ins at the press workstation. Press assignment only, not attendance." actions={<Link href="/production" className="text-sm font-bold underline">Back to production</Link>} />
    <p className="text-sm text-neutral-700">Operators sign in on the <Link className="font-bold underline" href="/production/workstation">press workstation</Link> at the start of the shift.</p>
    <CrewShiftReport today={getBusinessDateBoundaries().today} />
  </div>;
}
