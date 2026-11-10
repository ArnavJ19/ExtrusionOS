import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { TriggersClient } from "@/components/modules/press/sampling-client";

// AP-016: sampling triggers on approved inspection plans (quality owns them).
export default async function SamplingTriggersPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "quality", "factory_manager", "production_manager", "production"].includes(context.role)) redirect("/dashboard");
  return <div className="mx-auto max-w-4xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Quality</p><h1 className="text-2xl font-black">Sampling triggers</h1>
      <p className="mt-1 text-sm text-neutral-600">Say when a sample is needed. The press creates the sample task from its pushes; a trigger can block QC release until the sample is recorded or waived.</p></div>
    <TriggersClient />
  </div>;
}
