import Link from "next/link";
import { ArrowRight, Ruler, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatWeight } from "@/lib/utils/format";

export default async function MobileQualityPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const { data: checks, error } = await supabase
    .from("quality_inspections")
    .select("id, batch_number, quantity_checked_kg, dimensional_variance, hardness_webster, surface_finish_ok, weight_per_meter_actual, status, inspector_name, production_jobs(job_number), aluminium_profiles(profile_code, profile_name)")
    .eq("company_id", context.companyId)
    .not("status", "eq", "approved")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`Could not load quality inspections: ${error.message}`);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="rounded-3xl bg-slate-950 p-6 text-white"><ShieldCheck className="h-8 w-8 text-orange" /><h1 className="mt-3 text-2xl font-black">Quality Checks</h1><p className="mt-1 text-sm font-medium text-slate-300">Open real inspection records for dimension, hardness, finish, NCR, and packing approval updates.</p></div>
      {checks?.length ? checks.map((check: any) => (
        <Link href={`/quality/${check.id}`} key={check.id} className="block rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition active:scale-[0.99]">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xl font-black text-slate-950">{check.batch_number || check.production_jobs?.job_number || "Inspection"}</p><p className="mt-1 text-sm font-medium text-slate-500">{check.aluminium_profiles?.profile_code || check.aluminium_profiles?.profile_name || "Profile"} - {check.inspector_name || "Inspector not assigned"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusClass(check.status)}`}>{String(check.status || "pending").replace(/_/g, " ")}</span></div>
          <p className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-700"><Ruler className="mr-2 inline h-4 w-4 text-orange" />Checked {formatWeight(check.quantity_checked_kg)} - {check.surface_finish_ok === false ? "Surface review required" : "Surface acceptable"}</p>
          <p className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">Open inspection workflow <ArrowRight className="h-4 w-4" /></p>
        </Link>
      )) : <EmptyState title="No open quality checks" description="Pending and rework quality records appear here after inspections are created." />}
    </div>
  );
}

function statusClass(status: string) {
  if (["approved", "passed"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (["rework", "failed", "rejected"].includes(status)) return "bg-orange/10 text-orange";
  return "bg-blue-100 text-blue-800";
}
