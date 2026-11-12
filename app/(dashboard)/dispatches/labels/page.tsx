import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { LabelStationClient } from "@/components/modules/dispatch-autopilot/labels";

// AP-017: the packing station print queue.
export default async function Page() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager"].includes(context.role)) redirect("/dispatches");
  return <div className="mx-auto max-w-6xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Dispatches</p><h1 className="text-2xl font-black">Bundle labels</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Every recorded bundle queues its label here, from the approved packing template.</p></div>
    <LabelStationClient supervisor={["owner", "admin", "factory_manager", "dispatch_manager"].includes(context.role)} />
  </div>;
}
