import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { EwayClient } from "@/components/modules/dispatch-autopilot/eway";

// AP-081: e-way bill bulk upload file.
export default async function Page() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "accounts", "dispatch_manager", "dispatch"].includes(context.role)) redirect("/dispatches");
  return <div className="mx-auto max-w-6xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Dispatches</p><h1 className="text-2xl font-black">E-way bills</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">One upload for the day: download the portal file for the selected dispatches, upload it on the e-way bill portal, then paste the numbers back.</p></div>
    <EwayClient />
  </div>;
}
