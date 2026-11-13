import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { VendorChaseClient } from "@/components/modules/finishing/vendor-chase";

// AP-056: chase list for finishing vendors.
export default async function FinishingChasePage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "production_manager", "factory_manager", "production", "viewer"].includes(context.role)) redirect("/production");
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><Link href="/production/finishing" className="text-sm font-semibold underline">Finishing board</Link><h1 className="text-2xl font-black">Chase finishing vendors</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Material at anodizing and coating vendors past its expected return, with a prepared message per vendor. Copying a message does not mark it sent; record the date the vendor promises.</p></div>
    <VendorChaseClient canRecord={["owner", "admin", "production_manager", "factory_manager", "production"].includes(context.role)} />
  </div>;
}
