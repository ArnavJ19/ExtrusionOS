"use client";

import { useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle, Eye, Skull, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatDate, formatWeight } from "@/lib/utils/format";

type DieRow = Record<string, any>;

const healthConfig: Record<string, { color: string; bg: string; icon: typeof CheckCircle; label: string }> = {
  healthy: { color: "text-green-700", bg: "bg-green-100", icon: CheckCircle, label: "Healthy" },
  monitor: { color: "text-amber-700", bg: "bg-amber-100", icon: Eye, label: "Monitor" },
  correction_needed: { color: "text-orange-700", bg: "bg-orange-100", icon: Wrench, label: "Correction Needed" },
  replace_soon: { color: "text-red-700", bg: "bg-red-100", icon: AlertTriangle, label: "Replace Soon" },
  dead: { color: "text-slate-700", bg: "bg-slate-200", icon: Skull, label: "Dead" },
};

export function DieIntelligenceClient({ dies, trials, corrections }: { dies: DieRow[]; trials: DieRow[]; corrections: DieRow[] }) {
  const [selectedDie, setSelectedDie] = useState<DieRow | null>(null);
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? dies : dies.filter((die) => die.recommendation === filter);
  const stats = useMemo(() => {
    const avgHealth = dies.length ? Math.round(dies.reduce((sum, die) => sum + Number(die.health_score ?? 0), 0) / dies.length) : 0;
    return {
      avgHealth,
      healthy: dies.filter((die) => die.recommendation === "healthy").length,
      atRisk: dies.filter((die) => ["correction_needed", "replace_soon"].includes(die.recommendation)).length,
      dead: dies.filter((die) => die.recommendation === "dead").length,
      corrections: corrections.length,
      trials: trials.length,
    };
  }, [dies, corrections.length, trials.length]);
  const dieTrials = selectedDie ? trials.filter((trial) => trial.die_id === selectedDie.id) : [];
  const dieCorrections = selectedDie ? corrections.filter((correction) => correction.die_id === selectedDie.id) : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Metric label="Avg Health" value={`${stats.avgHealth}/100`} icon={Activity} />
        <Metric label="Healthy Dies" value={stats.healthy} icon={CheckCircle} />
        <Metric label="At Risk" value={stats.atRisk} icon={AlertTriangle} />
        <Metric label="Dead Dies" value={stats.dead} icon={Skull} />
        <Metric label="Corrections" value={stats.corrections} icon={Wrench} />
        <Metric label="Trials" value={stats.trials} icon={Eye} />
      </div>

      <div className="flex flex-wrap gap-2">
        {["all", "healthy", "monitor", "correction_needed", "replace_soon", "dead"].map((value) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize transition ${filter === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {value === "all" ? "All" : value.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="industrial-table min-w-[920px]">
              <thead><tr><th>Die #</th><th>Profile</th><th>Health</th><th>Status</th><th>Output</th><th>Rejection</th><th>Corrections</th><th>Cost/Kg</th><th className="text-right">Action</th></tr></thead>
              <tbody>
                {filtered.map((die) => {
                  const cfg = healthConfig[die.recommendation] ?? healthConfig.healthy;
                  const Icon = cfg.icon;
                  return (
                    <tr key={die.id}>
                      <td className="font-mono text-xs font-black text-slate-950">{die.die_number}</td>
                      <td><p className="font-bold text-slate-900">{die.profile_name}</p><p className="text-xs font-semibold text-slate-500">{die.customer_name}</p></td>
                      <td><HealthBar score={Number(die.health_score ?? 0)} /></td>
                      <td><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.bg} ${cfg.color}`}><Icon className="h-3 w-3" /> {cfg.label}</span></td>
                      <td className="font-semibold tabular-nums">{formatWeight(Number(die.total_production_kg ?? 0))}</td>
                      <td className="font-semibold tabular-nums">{Number(die.rejection_rate ?? 0).toFixed(1)}%</td>
                      <td className="font-semibold tabular-nums">{die.correction_count}</td>
                      <td className="font-semibold tabular-nums">{formatCurrency(Number(die.cost_per_kg ?? 0))}</td>
                      <td className="text-right"><Button variant="ghost" className="text-xs" onClick={() => setSelectedDie(die)}><Eye className="mr-1 h-3.5 w-3.5" /> Details</Button></td>
                    </tr>
                  );
                })}
                {!filtered.length ? <tr><td colSpan={9} className="px-4 py-12 text-center font-semibold text-slate-500">No dies found in your die database for this filter.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selectedDie ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setSelectedDie(null)}>
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between rounded-t-3xl bg-slate-900 p-5 text-white">
              <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Die Database Report</p><p className="text-lg font-black">{selectedDie.die_number} - {selectedDie.profile_name}</p></div>
              <button type="button" onClick={() => setSelectedDie(null)} className="rounded-lg p-2 transition hover:bg-white/10"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-5 p-5">
              <div className="grid gap-3 md:grid-cols-3">
                <Info label="Die Status" value={selectedDie.die_status} />
                <Info label="Last Used" value={formatDate(selectedDie.last_used_date)} />
                <Info label="Manufacturer" value={selectedDie.die_manufacturer ?? "-"} />
                <Info label="Die Cost" value={formatCurrency(Number(selectedDie.die_cost ?? 0))} />
                <Info label="Total Runs" value={String(selectedDie.total_runs ?? 0)} />
                <Info label="Recovery" value={`${Number(selectedDie.average_recovery_percent ?? 0).toFixed(1)}%`} />
              </div>
              <History title="Trial History" rows={dieTrials} dateKey="trial_date" statusKey="trial_result" textKey="remarks" empty="No die trials logged." />
              <History title="Correction History" rows={dieCorrections} dateKey="correction_date" statusKey="result_status" textKey="notes" empty="No die corrections logged." />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Activity }) {
  return <Card><CardContent className="p-4"><div className="mb-1 flex items-center gap-2"><Icon className="h-4 w-4 text-orange" /><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p></div><p className="text-xl font-black text-slate-900">{value}</p></CardContent></Card>;
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-amber-500" : score >= 40 ? "bg-orange-500" : score >= 20 ? "bg-red-500" : "bg-slate-500";
  return <div className="flex items-center gap-2"><div className="h-2 w-20 overflow-hidden rounded-full bg-slate-200"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></div><span className="text-xs font-black text-slate-900">{score}</span></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p><p className="text-sm font-black capitalize text-slate-900">{value}</p></div>;
}

function History({ title, rows, dateKey, statusKey, textKey, empty }: { title: string; rows: DieRow[]; dateKey: string; statusKey: string; textKey: string; empty: string }) {
  return <div><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{title}</p><div className="space-y-2">{rows.map((row) => <div key={row.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><div className="mb-1 flex items-center justify-between"><span className="text-xs font-bold text-slate-900">{formatDate(row[dateKey])}</span><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">{String(row[statusKey] ?? "logged").replace(/_/g, " ")}</span></div><p className="text-xs text-slate-600">{row[textKey] ?? "-"}</p></div>)}{!rows.length ? <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">{empty}</div> : null}</div></div>;
}
