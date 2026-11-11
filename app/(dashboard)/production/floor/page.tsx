import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { FloorClient } from "@/components/modules/press/floor-client";

// Autopilot batch 2: the supervisor's press floor (plan vs actual, downtime, die changes, PM proposals). Data comes from
// the push events recorded at the workstation; nothing here is typed in again.
export default async function PressFloorPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "factory_manager", "production_manager", "production"].includes(context.role)) redirect("/production");
  return <div className="mx-auto max-w-7xl space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Production</p>
      <h1 className="text-2xl font-black">Press floor</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Live from one tap per billet at each press workstation. Targets come from the published plan; idle time, die changes and maintenance counters come from the same taps.</p></div>
      <div className="flex flex-wrap gap-2 text-sm font-semibold"><Link className="rounded-xl border bg-white px-3 py-2" href="/production/workstation">Workstation</Link>
        <Link className="rounded-xl border bg-white px-3 py-2" href="/production/scrap-standards">Scrap standards</Link></div></div>
    <FloorClient role={context.role} today={getBusinessDateBoundaries().today} />
  </div>;
}
