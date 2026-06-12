import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ConfiguratorOutputNav } from "@/components/modules/systems-configurator/output-nav";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";
import { labelize } from "@/types/app";

export default async function SystemCuttingListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const { data: cuts } = await supabase.from("system_profile_cuts").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("profile_code", { ascending: true }).order("sort_order", { ascending: true });
  const rows = cuts ?? [];
  const totalLength = rows.reduce((sum, cut: any) => sum + Number(cut.total_length_m ?? 0), 0);
  const totalWeight = rows.reduce((sum, cut: any) => sum + Number(cut.total_weight_kg ?? 0), 0);

  return (
    <div className="space-y-6">
      <Header id={id} />
      <ConfiguratorOutputNav projectId={id} active="cutting" />
      <div className="grid gap-3 md:grid-cols-3"><Metric label="Cut Groups" value={String(rows.length)} /><Metric label="Total Length" value={`${totalLength.toFixed(3)} m`} /><Metric label="Total Weight" value={`${totalWeight.toFixed(3)} kg`} highlight /></div>
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-4 py-3">Profile Code</th><th className="px-4 py-3">Component</th><th className="px-4 py-3 text-right">Cut Length mm</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Total m</th><th className="px-4 py-3 text-right">Kg/m</th><th className="px-4 py-3 text-right">Weight kg</th><th className="px-4 py-3">Calculation Explanation</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((cut: any) => <tr key={cut.id} className="hover:bg-orange/5"><td className="px-4 py-3 font-black text-slate-950">{cut.profile_code}<p className="text-xs font-semibold text-slate-500">{cut.profile_name}</p></td><td className="px-4 py-3 font-semibold text-slate-700">{labelize(cut.component_role)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.cut_length_mm ?? 0).toFixed(0)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{cut.quantity}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.total_length_m ?? 0).toFixed(3)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.section_weight_kg_per_m ?? 0).toFixed(3)}</td><td className="px-4 py-3 text-right font-black tabular-nums text-slate-950">{Number(cut.total_weight_kg ?? 0).toFixed(3)}</td><td className="max-w-[360px] px-4 py-3 text-xs font-bold leading-5 text-slate-500">{cut.remarks || `${cut.angle_left}/${cut.angle_right}`}</td></tr>)}
                {!rows.length ? <EmptyRow colSpan={8} id={id} label="No cutting list yet." /> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Header({ id }: { id: string }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><PageHeader title="Cutting List" description="Production-ready profile cuts grouped by profile, component, length, quantity, and weight." /><Link href={`/api/pdf/systems-configurator/${id}/cutting_list`} target="_blank" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Download className="h-4 w-4" /> PDF</Link></div>;
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <Card className={highlight ? "border-orange/40" : undefined}><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${highlight ? "text-orange" : "text-slate-950"}`}>{value}</p></CardContent></Card>;
}

function EmptyRow({ colSpan, id, label }: { colSpan: number; id: string; label: string }) {
  return <tr><td colSpan={colSpan} className="px-4 py-12 text-center font-semibold text-slate-500">{label} <Link href={`/systems-configurator/projects/${id}`} className="font-black text-orange">Calculate this configuration</Link>.</td></tr>;
}
