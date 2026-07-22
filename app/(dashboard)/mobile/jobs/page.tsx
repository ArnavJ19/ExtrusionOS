import Link from "next/link";
import { ArrowRight, Factory, Gauge } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatWeight } from "@/lib/utils/format";

export default async function MobileJobsPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const { data: jobs, error } = await supabase
    .from("production_jobs")
    .select("id, job_number, status, planned_date, planned_quantity_kg, actual_quantity_kg, machines(machine_name), dies(die_number), orders(order_number, priority, customers(customer_name, company_name)), aluminium_profiles(profile_code, profile_name), scrap_records(weight_kg)")
    .eq("company_id", context.companyId)
    .not("status", "in", "(completed,cancelled)")
    .order("planned_date", { ascending: true, nullsFirst: false })
    .limit(20);
  if (error) throw new Error(`Could not load active production jobs: ${error.message}`);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <MobileTitle icon={Factory} title="Active Jobs" subtitle="Open real production jobs to record status, output, scrap, and proof from the job workflow." />
      {jobs?.length ? jobs.map((job: any) => (
        <Link href={`/production/${job.id}`} key={job.id} className="block rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition active:scale-[0.99]">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xl font-black text-slate-950">{job.job_number}</p><p className="mt-1 text-sm font-medium text-slate-500">{job.orders?.customers?.company_name || job.orders?.customers?.customer_name || job.orders?.order_number || "Customer"} - {job.aluminium_profiles?.profile_code || job.aluminium_profiles?.profile_name || "Profile"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusClass(job.orders?.priority || "normal")}`}>{String(job.orders?.priority || "normal").replace(/_/g, " ")}</span></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center"><Mini label="Plan" value={formatWeight(job.planned_quantity_kg)} /><Mini label="Actual" value={formatWeight(job.actual_quantity_kg)} /><Mini label="Scrap" value={formatWeight(totalScrapWeight(job.scrap_records))} /></div>
          <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-700"><Gauge className="mr-2 inline h-4 w-4 text-orange" />{job.machines?.machine_name || "Machine not assigned"} - {String(job.status || "planned").replace(/_/g, " ")} - {job.dies?.die_number || "No die"}</div>
          <p className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">Open job workflow <ArrowRight className="h-4 w-4" /></p>
        </Link>
      )) : <EmptyState title="No active production jobs" description="Production jobs appear here when they are planned or in progress." />}
    </div>
  );
}

function MobileTitle({ icon: Icon, title, subtitle }: { icon: typeof Factory; title: string; subtitle: string }) {
  return <div className="rounded-3xl bg-slate-950 p-5 text-white"><Icon className="h-7 w-7 text-orange" /><h1 className="mt-3 text-2xl font-black">{title}</h1><p className="mt-1 text-sm font-medium text-slate-300">{subtitle}</p></div>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-aluminium p-3"><p className="text-[10px] font-black uppercase text-slate-500">{label}</p><p className="mt-1 font-black text-slate-950">{value}</p></div>;
}

function totalScrapWeight(records: Record<string, any>[] | null | undefined) {
  return (records ?? []).reduce((total, record) => total + Number(record.weight_kg ?? 0), 0);
}

function statusClass(status: string) {
  if (["urgent", "high"].includes(status)) return "bg-orange/10 text-orange";
  if (["low"].includes(status)) return "bg-slate-100 text-slate-700";
  return "bg-blue-100 text-blue-800";
}
