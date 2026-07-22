import Link from "next/link";
import { ArrowRight, Factory, QrCode, ShieldCheck, Truck, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMobileDestinationKeys, type MobileDestinationKey } from "@/lib/auth/role-experience";

const links = [
  { key: "jobs", href: "/mobile/jobs", label: "Active Jobs", icon: Factory, description: "Open production jobs and update them from the job detail workflow." },
  { key: "scan", href: "/mobile/scan", label: "Scan Die/Bundle", icon: QrCode, description: "Use the real scanner workspace for QR, barcode, die tag, or bundle lookup." },
  { key: "dispatch", href: "/mobile/dispatch", label: "Dispatch Loading", icon: Truck, description: "Review active dispatches and open the dispatch workflow." },
  { key: "quality", href: "/mobile/quality", label: "Quality Checks", icon: ShieldCheck, description: "Open pending quality records for inspection updates." },
  { key: "tasks", href: "/mobile/tasks", label: "Tasks", icon: ListChecks, description: "Open assigned tasks and supervisor reminders." }
] satisfies { key: MobileDestinationKey; href: string; label: string; icon: typeof Factory; description: string }[];

export default async function MobileHomePage() {
  const context = await getSessionContext();
  const allowedDestinations = getMobileDestinationKeys(context.role);
  const supabase = await createClient();

  const countQueries: Partial<Record<MobileDestinationKey, () => PromiseLike<any>>> = {
    jobs: () => supabase.from("production_jobs").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).not("status", "in", "(completed,cancelled)"),
    dispatch: () => supabase.from("dispatches").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).not("delivery_status", "in", "(delivered,returned)"),
    quality: () => supabase.from("quality_inspections").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).not("status", "eq", "approved"),
    tasks: () => supabase.from("tasks").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).not("status", "eq", "completed"),
  };
  const countEntries = await Promise.all(
    allowedDestinations.filter((key) => countQueries[key]).map(async (key) => [key, await countQueries[key]!()] as const)
  );
  const counts = Object.fromEntries(countEntries.map(([key, result]) => [key, result.count ?? 0])) as Partial<Record<MobileDestinationKey, number>>;
  const queryError = countEntries.find(([, result]) => result.error)?.[1].error;
  if (queryError) throw new Error(`Could not load mobile factory queues: ${queryError.message}`);
  const visibleLinks = links.filter((link) => allowedDestinations.includes(link.key));

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title="Mobile Factory Floor" description="Fast, low-typing shortcuts for real operator, supervisor, quality, and dispatch records." />
      <div className="grid grid-cols-2 gap-3">
        {allowedDestinations.includes("jobs") ? <Stat label="Jobs" value={String(counts.jobs ?? 0)} /> : null}
        {allowedDestinations.includes("dispatch") ? <Stat label="Dispatches" value={String(counts.dispatch ?? 0)} /> : null}
        {allowedDestinations.includes("quality") ? <Stat label="Quality" value={String(counts.quality ?? 0)} /> : null}
        {allowedDestinations.includes("tasks") ? <Stat label="Tasks" value={String(counts.tasks ?? 0)} /> : null}
      </div>
      <div className="space-y-3">
        {visibleLinks.map((item) => {
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} className="flex items-center gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition active:scale-[0.99]"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950"><Icon className="h-6 w-6 text-orange" /></span><span className="min-w-0 flex-1"><span className="block text-lg font-black text-slate-950">{item.label}</span><span className="mt-1 block text-sm font-medium leading-5 text-slate-500">{item.description}</span></span><ArrowRight className="h-5 w-5 text-slate-400" /></Link>;
        })}
      </div>
      <Card><CardContent className="p-5"><div className="flex items-center justify-between gap-3"><div><p className="font-black text-slate-950">Real mobile shortcuts</p><p className="mt-1 text-sm font-medium text-slate-500">Counts and queues are loaded from tenant-scoped records. Actions open existing detail workflows.</p></div><Badge value="RLS" /></div></CardContent></Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p></div>;
}
