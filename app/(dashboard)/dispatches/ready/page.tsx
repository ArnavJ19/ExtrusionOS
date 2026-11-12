import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { ReadyToShipClient } from "@/components/modules/dispatch-autopilot/gate";

// AP-051: the ready-to-ship list.
export default async function Page() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "sales_manager", "sales", "accounts", "production_manager"].includes(context.role)) redirect("/dispatches");
  return <div className="mx-auto max-w-6xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Dispatches</p><h1 className="text-2xl font-black">Ready to ship</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Plan vehicles from what is packed and released, not from phone calls. Credit holds are shown and marked.</p></div>
    <ReadyToShipClient canLoad={["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager"].includes(context.role)} />
  </div>;
}
