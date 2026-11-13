import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { GateClient } from "@/components/modules/dispatch-autopilot/gate";

// AP-019: gate-out derived from the dispatch.
export default async function Page() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "accounts", "inventory_manager"].includes(context.role)) redirect("/dispatches");
  return <div className="mx-auto max-w-6xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Dispatches</p><h1 className="text-2xl font-black">Gate</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Loaded vehicles wait here. Check the number plate and tap Vehicle out; the gate register is kept for you.</p></div>
    <GateClient supervisor={["owner", "admin", "factory_manager", "dispatch_manager"].includes(context.role)} canGate={["owner", "admin", "factory_manager", "dispatch_manager", "dispatch"].includes(context.role)} />
  </div>;
}
