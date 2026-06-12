import Link from "next/link";
import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfiguratorOutputNav } from "@/components/modules/systems-configurator/output-nav";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";
import { labelize } from "@/types/app";

export default async function SystemGlassListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const [{ data: glassCuts }, { data: beadingCuts }] = await Promise.all([
    supabase.from("system_glass_cuts").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("panel_index", { ascending: true }),
    supabase.from("system_beading_cuts").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("panel_index", { ascending: true })
  ]);
  const glassRows = glassCuts ?? [];
  const beadRows = beadingCuts ?? [];
  const areaSqft = glassRows.reduce((sum, cut: any) => sum + Number(cut.area_sqft ?? 0), 0);
  const areaSqm = glassRows.reduce((sum, cut: any) => sum + Number(cut.area_sqm ?? 0), 0);
  const beadLength = beadRows.reduce((sum, cut: any) => sum + Number(cut.total_length_m ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><PageHeader title="Glass & Beading" description="Glass panel cutting sizes and beading cuts around each glass panel." /><Link href={`/api/pdf/systems-configurator/${id}/glass_list`} target="_blank" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Download className="h-4 w-4" /> PDF</Link></div>
      <ConfiguratorOutputNav projectId={id} active="glass" />
      <div className="grid gap-3 md:grid-cols-3"><Metric label="Glass Area" value={`${areaSqft.toFixed(3)} sqft`} /><Metric label="Glass Area" value={`${areaSqm.toFixed(3)} sqm`} /><Metric label="Beading Length" value={`${beadLength.toFixed(3)} m`} highlight /></div>
      <OutputCard title="Glass List"><GlassTable rows={glassRows} id={id} /></OutputCard>
      <OutputCard title="Beading Cuts"><BeadingTable rows={beadRows} id={id} /></OutputCard>
    </div>
  );
}

function GlassTable({ rows, id }: { rows: any[]; id: string }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-4 py-3">Panel</th><th className="px-4 py-3">Glass Type</th><th className="px-4 py-3 text-right">Width mm</th><th className="px-4 py-3 text-right">Height mm</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Area sq ft</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Explanation</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((cut) => <tr key={cut.id} className="hover:bg-orange/5"><td className="px-4 py-3 font-black text-slate-950">{cut.glass_label}</td><td className="px-4 py-3 font-semibold text-slate-700">{labelize(cut.glass_type ?? "glass")} · {cut.thickness_mm}mm</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.width_mm ?? 0).toFixed(0)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.height_mm ?? 0).toFixed(0)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{cut.quantity}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.area_sqft ?? 0).toFixed(3)}</td><td className="px-4 py-3 text-right font-black tabular-nums">Rs. {Number(cut.amount ?? 0).toLocaleString("en-IN")}</td><td className="max-w-[280px] px-4 py-3 text-xs font-bold leading-5 text-slate-500">{cut.remarks ?? "Panel size minus glass deductions"}</td></tr>)}{!rows.length ? <EmptyRow colSpan={8} id={id} label="No glass list yet." /> : null}</tbody></table></div>;
}

function BeadingTable({ rows, id }: { rows: any[]; id: string }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-4 py-3">Panel</th><th className="px-4 py-3">Profile</th><th className="px-4 py-3">Position</th><th className="px-4 py-3 text-right">Cut Length mm</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Total m</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((cut) => <tr key={cut.id} className="hover:bg-orange/5"><td className="px-4 py-3 font-black text-slate-950">P{cut.panel_index}</td><td className="px-4 py-3 font-semibold text-slate-700">{cut.remarks || "Beading"}</td><td className="px-4 py-3 font-semibold text-slate-700">{labelize(cut.bead_position)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.cut_length_mm ?? 0).toFixed(0)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{cut.quantity}</td><td className="px-4 py-3 text-right font-black tabular-nums">{Number(cut.total_length_m ?? 0).toFixed(3)}</td></tr>)}{!rows.length ? <EmptyRow colSpan={6} id={id} label="No beading cuts yet." /> : null}</tbody></table></div>;
}

function OutputCard({ title, children }: { title: string; children: ReactNode }) {
  return <Card className="overflow-hidden border-slate-200 shadow-sm"><CardHeader className="border-b border-slate-100 bg-white"><h3 className="font-black text-slate-950">{title}</h3></CardHeader><CardContent className="p-0">{children}</CardContent></Card>;
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <Card className={highlight ? "border-orange/40" : undefined}><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${highlight ? "text-orange" : "text-slate-950"}`}>{value}</p></CardContent></Card>;
}

function EmptyRow({ colSpan, id, label }: { colSpan: number; id: string; label: string }) {
  return <tr><td colSpan={colSpan} className="px-4 py-12 text-center font-semibold text-slate-500">{label} <Link href={`/systems-configurator/projects/${id}`} className="font-black text-orange">Calculate this configuration</Link>.</td></tr>;
}
