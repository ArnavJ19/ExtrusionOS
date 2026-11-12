import { redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { LoadingStation } from "@/components/modules/dispatch-autopilot/loading";

// AP-018: one loading session (the scan screen at the vehicle).
export default async function LoadingSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager"].includes(context.role)) redirect("/dispatches");
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return <p role="alert">That loading session reference is invalid. <Link className="underline" href="/dispatches/loading">Open the loads</Link></p>;
  return <div className="mx-auto max-w-5xl space-y-4">
    <div><Link href="/dispatches/loading" className="text-sm font-semibold underline">Loads</Link><h1 className="text-2xl font-black">Load the vehicle</h1></div>
    <LoadingStation key={`${context.companyId}:${context.userId}:${id.data}`} sessionId={id.data} today={getBusinessDateBoundaries().today} />
  </div>;
}
