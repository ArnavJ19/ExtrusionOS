import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfiguratorOutputNav } from "@/components/modules/systems-configurator/output-nav";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";

export default async function ProfileOptimizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const { data: run } = await supabase
    .from("profile_optimization_runs")
    .select("*")
    .eq("company_id", context.companyId)
    .eq("configuration_id", id)
    .order("run_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const output = run?.optimized_output_json as any;
  const profiles = Array.isArray(output?.profiles) ? output.profiles : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="Profile Optimization" description="First-fit decreasing stock-bar allocation grouped by profile code with kerf, waste, and reusable leftovers." />
        <Link href={`/api/pdf/systems-configurator/${id}/optimization_report`} target="_blank" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Download className="h-4 w-4" /> PDF</Link>
      </div>

      <ConfiguratorOutputNav projectId={id} active="optimization" />

      {run ? <div className="grid gap-3 md:grid-cols-4"><Metric label="Run" value={`#${run.run_number}`} /><Metric label="Stock Bars" value={String(run.total_stock_bars)} /><Metric label="Waste" value={`${Number(run.total_waste_mm ?? 0).toFixed(0)} mm`} /><Metric label="Waste %" value={`${Number(run.waste_percent ?? 0).toFixed(2)}%`} highlight /></div> : null}

      {!run ? <Card><CardContent><p className="text-sm font-semibold text-slate-500">No optimization run yet. Go back to the project detail page and click Optimize after calculating the cutting list.</p></CardContent></Card> : null}

      <div className="space-y-4">
        {profiles.map((profile: any) => (
          <Card key={profile.profileCode}>
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div><h3 className="font-black text-slate-950">{profile.profileCode} - {profile.profileName}</h3><p className="text-sm font-semibold text-slate-500">{profile.totalStockBars} bars · {Number(profile.totalWasteMm).toFixed(0)}mm waste · {Number(profile.wastePercent).toFixed(2)}%</p></div>
                <p className="rounded-full bg-orange/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-orange">Stock {profile.stockLengthMm}mm</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {(profile.bars ?? []).map((bar: any) => (
                <div key={bar.barNumber} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black text-slate-950">Bar {bar.barNumber}</p><p className="text-sm font-bold text-slate-500">Used {bar.usedLengthMm}mm · Waste {bar.wasteMm}mm{bar.reusableLeftoverMm ? ` · Reusable ${bar.reusableLeftoverMm}mm` : ""}</p></div>
                  <div className="mt-3 flex flex-wrap gap-2">{(bar.cuts ?? []).map((cut: any) => <span key={cut.cutId} className="rounded-xl bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{cut.cutLengthMm}mm {cut.kerfBeforeMm ? `+ ${cut.kerfBeforeMm} kerf` : ""}</span>)}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <Card className={highlight ? "border-orange/40" : undefined}><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${highlight ? "text-orange" : "text-slate-950"}`}>{value}</p></CardContent></Card>;
}
