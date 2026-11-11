import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { SamplesClient } from "@/components/modules/press/sampling-client";

// AP-016: the QC sample queue created from press output (phone-friendly; also in My Work for quality).
export default async function QualitySamplesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "quality", "factory_manager", "production_manager", "production"].includes(context.role)) redirect("/dashboard");
  return <div className="mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Quality</p><h1 className="text-2xl font-black">In-process samples</h1>
      <p className="mt-1 text-sm text-neutral-600">Created when press output crosses an inspection plan trigger: first piece after a die change, every N pushes or bundles, and the last piece.</p></div>
      {["owner", "admin", "quality", "factory_manager"].includes(context.role) ? <Link href="/quality/samples/triggers" className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold">Sampling triggers</Link> : null}</div>
    <SamplesClient />
  </div>;
}
