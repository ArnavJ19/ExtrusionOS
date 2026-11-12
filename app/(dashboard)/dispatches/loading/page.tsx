import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { LoadingSessionsClient } from "@/components/modules/dispatch-autopilot/loading";

// AP-018: loading sessions.
export default async function Page() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager"].includes(context.role)) redirect("/dispatches");
  return <div className="mx-auto max-w-6xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Dispatches</p><h1 className="text-2xl font-black">Load a vehicle</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Scan each bundle into the vehicle. The dispatch is written from the scans; nothing is typed.</p></div>
    <LoadingSessionsClient />
  </div>;
}
