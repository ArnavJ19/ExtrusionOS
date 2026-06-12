import Link from "next/link";
import { ArrowRight, Factory, QrCode, ShieldCheck, Truck, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const links = [
  { href: "/mobile/jobs", label: "Today Jobs", icon: Factory, description: "Open production jobs and update them from the job detail workflow." },
  { href: "/mobile/scan", label: "Scan Die/Bundle", icon: QrCode, description: "Use the real scanner workspace for QR, barcode, die tag, or bundle lookup." },
  { href: "/mobile/dispatch", label: "Dispatch Loading", icon: Truck, description: "Review active dispatches and open the dispatch workflow." },
  { href: "/mobile/quality", label: "Quality Checks", icon: ShieldCheck, description: "Open pending quality records for inspection updates." },
  { href: "/mobile/tasks", label: "Tasks", icon: ListChecks, description: "Open assigned tasks and supervisor reminders." }
];

export default async function MobileHomePage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [jobsResult, dispatchesResult, qualityResult, tasksResult] = await Promise.all([
    supabase.from("production_jobs").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).gte("planned_start_date", today),
    supabase.from("dispatches").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).not("delivery_status", "in", "(delivered,cancelled)"),
    supabase.from("quality_tests").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).not("status", "eq", "approved"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).not("status", "eq", "completed")
  ]);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title="Mobile Factory Floor" description="Fast, low-typing shortcuts for real operator, supervisor, quality, and dispatch records." />
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Jobs" value={(jobsResult.count ?? 0).toString()} />
        <Stat label="Dispatches" value={(dispatchesResult.count ?? 0).toString()} />
        <Stat label="Quality" value={(qualityResult.count ?? 0).toString()} />
        <Stat label="Tasks" value={(tasksResult.count ?? 0).toString()} />
      </div>
      <div className="space-y-3">
        {links.map((item) => {
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
