// AP-043: what needs attention on dies now (nitriding due, away, poor recovery, section-weight drift), at the top of the
// die overview, and per-die performance on the die record. Server-rendered from lib/dies/intelligence.
import Link from "next/link";
import type { DieAttention, DieAttentionItem } from "@/lib/dies/intelligence";
import { formatCurrency } from "@/lib/utils/format";

function List({ title, items, empty }: { title: string; items: DieAttentionItem[]; empty: string }) {
  return <div className="min-w-0 rounded-xl border border-neutral-200 p-3">
    <h3 className="text-sm font-black">{title} <span className="font-semibold text-neutral-500">({items.length}{items.length === 10 ? "+" : ""})</span></h3>
    {items.length ? <ul className="mt-2 divide-y">{items.map(item => <li key={`${title}:${item.die_id}`}><Link href={`/dies/${item.die_id}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm hover:bg-neutral-50">
      <span className="font-bold">{item.die_number}</span><span className={`min-w-0 break-words text-xs font-semibold ${item.tone === "warning" ? "text-amber-800" : "text-neutral-600"}`}>{item.detail}</span></Link></li>)}</ul>
      : <p className="mt-2 text-sm text-neutral-500">{empty}</p>}
  </div>;
}

export function DieAttentionPanel({ data }: { data: DieAttention }) {
  return <section aria-labelledby="die-attention" className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
    <div><h2 id="die-attention" className="text-lg font-bold">Dies that need attention</h2>
      <p className="text-sm text-neutral-600">From nitriding dates, die custody and expected returns, job recovery and bundle weights. Open a die to act.</p></div>
    {data.errors.length ? <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{data.errors.join(" ")}</p> : null}
    <div className="grid gap-3 md:grid-cols-2">
      <List title="Nitriding due in 7 days" items={data.nitriding} empty="No die is due for nitriding this week." />
      <List title="Away from the plant" items={data.away} empty="Every die is in the plant." />
      <List title="Poor recovery" items={data.recovery} empty="No die with three or more runs is below its recovery target." />
      <List title="Section-weight drift to review" items={data.drift} empty="No open section-weight review." />
    </div>
  </section>;
}

export type DiePerformance = { health_score: number | null; recommendation: string | null; rejection_rate: number | null; total_rejection_kg: number | null; correction_count: number | null;
  trial_count: number | null; cost_per_kg: number | null; last_correction_date: string | null; last_trial_date: string | null; updated_at: string | null } | null;

const RECOMMENDATION: Record<string, string> = { healthy: "Healthy", monitor: "Monitor", correction_needed: "Correction needed", replace_soon: "Replace soon", dead: "Dead" };

/** Die health on the die record (moved from Die Intelligence). Cost per kg only for the roles that saw it there. */
export function DiePerformancePanel({ metric, showCost, fallbackScore, fallbackRecommendation }: { metric: DiePerformance; showCost: boolean; fallbackScore: number; fallbackRecommendation: string }) {
  const score = metric?.health_score ?? fallbackScore;
  const rec = metric?.recommendation ?? fallbackRecommendation;
  const fact = (label: string, value: string) => <div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">{label}</p><p className="mt-1 font-black">{value}</p></div>;
  return <section id="die-health" aria-labelledby="die-health-title" className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
    <div><h2 id="die-health-title" className="text-lg font-bold">Die health</h2>
      <p className="text-sm text-neutral-600">{metric ? "From recorded output, rejections, corrections and trials." : "No health metrics are recorded yet; the score follows the die status."}</p></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {fact("Health", `${score}/100`)}
      {fact("Status", RECOMMENDATION[rec] ?? rec.replaceAll("_", " "))}
      {fact("Rejection", metric?.rejection_rate === null || metric?.rejection_rate === undefined ? "Not captured" : `${Number(metric.rejection_rate).toFixed(1)}%`)}
      {fact("Corrections", String(metric?.correction_count ?? 0))}
      {fact("Trials", String(metric?.trial_count ?? 0))}
      {showCost ? fact("Die cost per kg", metric?.cost_per_kg === null || metric?.cost_per_kg === undefined ? "Not captured" : formatCurrency(Number(metric.cost_per_kg))) : null}
    </div>
  </section>;
}
