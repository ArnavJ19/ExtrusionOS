"use client";

// AP-054: preventive maintenance driven by press running hours and push counts (puller, saw, container and the press
// itself run with the press). Due tasks become proposals that book a capacity window; compliance is reported per asset.
import { useCallback, useEffect, useState } from "react";
import { autopilotAction } from "@/lib/actions/autopilot";
import { PM_ASSETS, type PmAsset } from "@/lib/press/press-floor";
import { fmtNum, fmtTime, type PmPlanRow } from "@/lib/press/types";
import { NumericField } from "@/components/ui/numeric-field";
import { parseKeypadValue } from "@/lib/forms/numeric-keypad";
import { ProposalCards } from "@/components/modules/autopilot/proposal-cards";

type Plans = { total_count: number; page: number; can_edit: boolean; presses: { id: string; name: string }[]; rows: PmPlanRow[] };
type Compliance = { assets: { machine: string; asset: string; plans: number; done: number; on_time: number; overdue_now: number; compliance_percent: number | null }[] };
const stateStyle: Record<string, string> = { due: "bg-rose-50 text-rose-800", approaching: "bg-amber-50 text-amber-900", ok: "bg-emerald-50 text-emerald-800", retired: "bg-neutral-100" };

export function PmPanel({ today }: { today: string }) {
  const [plans, setPlans] = useState<Plans | null>(null);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ machine_id: "", asset_kind: "puller" as PmAsset, asset_label: "", task: "", basis: "running_hours" as "running_hours" | "pushes", interval: "", window: "2", safety: false });
  const [completing, setCompleting] = useState<{ id: string; note: string } | null>(null);
  const load = useCallback(async () => {
    const [list, comp] = await Promise.all([autopilotAction("ap_pm", "plans", { page }), autopilotAction("ap_pm", "compliance", {})]);
    if (!list.success) { setError(list.error); return; }
    setError(null); setPlans(list.data as Plans); if (comp.success) setCompliance(comp.data as Compliance);
  }, [page]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    const interval = parseKeypadValue(form.interval), windowHours = parseKeypadValue(form.window);
    if (!form.machine_id || !interval || form.task.trim().length < 3) { setMessage("Choose the press, the task and its interval."); return; }
    const result = await autopilotAction("ap_pm", "save", { machine_id: form.machine_id, asset_kind: form.asset_kind, ...(form.asset_label.trim() ? { asset_label: form.asset_label.trim() } : {}),
      task: form.task.trim(), basis: form.basis, interval_value: interval, ...(windowHours ? { window_hours: windowHours } : {}), safety_critical: form.safety });
    setMessage(result.success ? "Plan saved. Its counter starts now." : result.error);
    if (result.success) setForm(f => ({ ...f, asset_label: "", task: "", interval: "" }));
    await load();
  }
  async function complete() {
    if (!completing) return;
    const result = await autopilotAction("ap_pm", "complete", { plan_id: completing.id, note: completing.note.trim() });
    setMessage(result.success ? "Completion recorded; the counter restarts." : result.error);
    if (result.success) setCompleting(null);
    await load();
  }
  async function retire(id: string) {
    const result = await autopilotAction("ap_pm", "retire", { id });
    setMessage(result.success ? "Plan retired." : result.error);
    await load();
  }
  const pages = Math.max(1, Math.ceil((plans?.total_count ?? 0) / 10));
  return <div className="min-w-0 space-y-6">
    <ProposalCards type="maintenance.pm_due" initial={null} today={today} onDecided={() => { void load(); }} title="Preventive maintenance due" description="Prepared at 90% of the interval inside the next planned window. Accepting books it and blocks press capacity." emptyText="No maintenance is due." />
    <section aria-labelledby="pm-plans" className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <div><h2 id="pm-plans" className="text-lg font-bold">Running-hours maintenance plans</h2><p className="text-sm text-neutral-600">Counters come from the press&apos;s pushes; running hours exclude idle gaps.</p></div>
      {message ? <p role="status" className="rounded-xl bg-neutral-100 p-3 text-sm font-semibold">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-amber-900">{error}</p> : !plans ? <p role="status" className="text-sm">Loading…</p> : !plans.rows.length
        ? <p className="rounded-xl border border-dashed p-3 text-sm text-neutral-600">No plan yet. Add the first one below.</p>
        : <ul className="space-y-2">{plans.rows.map(row => <li key={row.id} className="rounded-xl border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold [overflow-wrap:anywhere]">{row.machine} · {PM_ASSETS[row.asset_kind as PmAsset] ?? row.asset_kind}{row.asset_label ? ` (${row.asset_label})` : ""} · {row.task}</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${stateStyle[row.state]}`}>{row.state}{row.safety_critical ? " · safety-critical" : ""}</span></div>
          <p className="mt-1 tabular-nums">{fmtNum(row.counter.value, 1)} of {fmtNum(row.interval_value, 1)} {row.basis === "pushes" ? "pushes" : "running hours"} ({fmtNum(row.counter.percent, 0)}%) since {fmtTime(row.counter.since)}</p>
          <p className="text-xs text-neutral-600">{row.scheduled ? `Booked ${fmtTime(row.scheduled.window_start)}–${fmtTime(row.scheduled.window_end)}` : "Not booked"}{row.last_done ? ` · last done ${fmtTime(row.last_done.done_at)} by ${row.last_done.by ?? "—"}` : ""}</p>
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => setCompleting({ id: row.id, note: "" })} className="min-h-10 rounded-lg bg-neutral-950 px-3 font-bold text-white">Record completion</button>
            {plans.can_edit ? <button type="button" onClick={() => retire(row.id)} className="min-h-10 rounded-lg border px-3 font-bold">Retire</button> : null}</div>
          {completing?.id === row.id ? <div className="mt-2 flex flex-wrap items-end gap-2"><label className="block min-w-0 flex-1 font-semibold">What was done<input className="mt-1 h-11 w-full rounded-xl border px-3" value={completing.note} maxLength={300} onChange={event => setCompleting({ ...completing, note: event.target.value })} /></label>
            <button type="button" disabled={completing.note.trim().length < 3} onClick={complete} className="min-h-11 rounded-xl bg-neutral-950 px-4 font-bold text-white disabled:opacity-50">Save</button></div> : null}
        </li>)}</ul>}
      {pages > 1 ? <nav aria-label="Plan pages" className="flex items-center justify-between text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Next</button></nav> : null}
    </section>
    {plans?.can_edit ? <section aria-labelledby="pm-new" className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <h2 id="pm-new" className="text-lg font-bold">Add a plan</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-semibold">Press<select aria-label="Press" className="mt-1 h-11 w-full rounded-xl border px-3" value={form.machine_id} onChange={event => setForm({ ...form, machine_id: event.target.value })}><option value="">Choose</option>{plans.presses.map(press => <option key={press.id} value={press.id}>{press.name}</option>)}</select></label>
        <label className="block text-sm font-semibold">Asset<select aria-label="Asset" className="mt-1 h-11 w-full rounded-xl border px-3" value={form.asset_kind} onChange={event => setForm({ ...form, asset_kind: event.target.value as PmAsset })}>{Object.entries(PM_ASSETS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-sm font-semibold">Asset name (optional)<input className="mt-1 h-11 w-full rounded-xl border px-3" value={form.asset_label} maxLength={80} onChange={event => setForm({ ...form, asset_label: event.target.value })} /></label>
        <label className="block text-sm font-semibold sm:col-span-2">Task<input className="mt-1 h-11 w-full rounded-xl border px-3" value={form.task} maxLength={120} placeholder="Hydraulic filter change" onChange={event => setForm({ ...form, task: event.target.value })} /></label>
        <label className="block text-sm font-semibold">Counted in<select aria-label="Counted in" className="mt-1 h-11 w-full rounded-xl border px-3" value={form.basis} onChange={event => setForm({ ...form, basis: event.target.value as "running_hours" | "pushes" })}><option value="running_hours">Running hours</option><option value="pushes">Pushes</option></select></label>
        <NumericField label="Interval" unit={form.basis === "pushes" ? "pushes" : "hours"} value={form.interval} onChange={value => setForm({ ...form, interval: value })} />
        <NumericField label="Window length" unit="hours" value={form.window} onChange={value => setForm({ ...form, window: value })} />
        <label className="flex items-center gap-2 self-end text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={form.safety} onChange={event => setForm({ ...form, safety: event.target.checked })} />Safety-critical (only a supervisor can dismiss)</label>
      </div>
      <button type="button" onClick={save} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white">Save plan</button>
    </section> : null}
    <section aria-labelledby="pm-compliance" className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <h2 id="pm-compliance" className="text-lg font-bold">Compliance per asset</h2>
      {!compliance ? <p role="status" className="text-sm">Loading…</p> : !compliance.assets.length ? <p className="text-sm text-neutral-600">No active plans.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[30rem] text-sm"><thead><tr className="text-left text-xs uppercase text-neutral-500"><th className="py-1">Press</th><th>Asset</th><th className="text-right">Done</th><th className="text-right">On time</th><th className="text-right">Overdue now</th><th className="text-right">Compliance</th></tr></thead>
          <tbody className="divide-y">{compliance.assets.map(row => <tr key={`${row.machine}:${row.asset}`}><td className="py-1.5">{row.machine}</td><td>{row.asset}</td><td className="text-right">{row.done}</td><td className="text-right">{row.on_time}</td><td className="text-right">{row.overdue_now}</td><td className="text-right font-bold">{row.compliance_percent === null ? "—" : `${row.compliance_percent}%`}</td></tr>)}</tbody></table></div>}
      <p className="text-xs text-neutral-600">On time: completed within 110% of the interval. Overdue now: past 110% and not done.</p>
    </section>
  </div>;
}
