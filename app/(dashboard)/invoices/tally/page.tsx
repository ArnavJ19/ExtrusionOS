import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { TallyClient } from "@/components/modules/dispatch-autopilot/tally";

// AP-083: Tally voucher export.
export default async function Page() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "accounts"].includes(context.role)) redirect("/invoices");
  return <div className="mx-auto max-w-6xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Invoices</p><h1 className="text-2xl font-black">Tally export</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Each posted voucher goes to Tally once, in one import file a day.</p></div>
    <TallyClient />
  </div>;
}
