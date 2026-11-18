"use client";

// AP-055: powder coating runs batched by shade and powder brand. The waiting jobs are grouped so the line changes colour
// as few times as possible, in order of the earliest promised date. The supervisor can move runs up or down; jobs that
// would finish after their promised date are shown before confirming, and confirming them needs a reason.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { coatingPlanAction, confirmCoatingRunAction, type CoatingView } from "@/lib/actions/autopilot-batch10";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
const kg = (v: unknown) => (v === null || v === undefined ? "weight not recorded" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg`);

function LineSettings({ settings, onSaved }: { settings: CoatingView["settings"]; onSaved: () => void }) {
  const [capacity, setCapacity] = useState(settings ? String(settings.capacity_kg_per_hour) : ""); const [change, setChange] = useState(settings ? String(settings.changeover_minutes) : "");
  const [start, setStart] = useState(settings?.day_start ?? "08:00"); const [hours, setHours] = useState(settings ? String(settings.hours_per_day) : "8"); const [note, setNote] = useState<Note>(null);
  async function save() {
    if (!(Number(capacity) > 0) || change.trim() === "" || !Number.isInteger(Number(change)) || Number(change) < 0) { setNote({ tone: "error", text: "Enter the line capacity in kg per hour and the minutes a colour change takes." }); return; }
    if (await apWrite("ap_coating", "save_settings", { capacity_kg_per_hour: Number(capacity), changeover_minutes: Number(change), day_start: start, hours_per_day: Number(hours) || 8 }, setNote, "Line settings saved.")) onSaved();
  }
  return <details className="rounded-xl bg-neutral-50 p-3" open={!settings}>
    <summary className="min-h-10 cursor-pointer py-2 text-sm font-bold">Coating line settings{settings ? ` (${settings.capacity_kg_per_hour} kg/h, ${settings.changeover_minutes} min per colour change)` : " (not set)"}</summary>
    <div className="mt-2 grid gap-2 sm:grid-cols-4">
      <label className="block text-sm font-semibold">Capacity (kg per hour)<input inputMode="decimal" className={`${inputClass} mt-1`} value={capacity} onChange={e => setCapacity(e.target.value)} /></label>
      <label className="block text-sm font-semibold">Colour change (minutes)<input inputMode="numeric" className={`${inputClass} mt-1`} value={change} onChange={e => setChange(e.target.value)} /></label>
      <label className="block text-sm font-semibold">Line starts at<input type="time" className={`${inputClass} mt-1`} value={start} onChange={e => setStart(e.target.value)} /></label>
      <label className="block text-sm font-semibold">Hours per day<input inputMode="decimal" className={`${inputClass} mt-1`} value={hours} onChange={e => setHours(e.target.value)} /></label>
    </div>
    <button type="button" className={`${secondaryClass} mt-2`} onClick={save}>Save settings</button>
    <Message value={note} />
  </details>;
}

export function CoatingRunsClient() {
  const [view, setView] = useState<CoatingView | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<string[] | undefined>(undefined); const [runDay, setRunDay] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<Note>(null); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [brand, setBrand] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const history = useApRead<{ rows: { id: string; run_day: string; jobs: number; runs: number; total_kg: number | null; shade_changes: number; baseline_changes: number; late_jobs: number; breach_note: string | null; confirmed_by: string | null; confirmed_at: string }[]; total_count: number; saved_changes_30d: number }>("ap_coating", "runs", { page }, []);
  const orderKey = JSON.stringify(order ?? null);
  const load = useCallback(async () => {
    setLoading(true);
    const out = await coatingPlanAction({ ...(runDay ? { run_day: runDay } : {}), ...(orderKey !== "null" ? { order: JSON.parse(orderKey) as string[] } : {}) });
    setLoading(false);
    if (!out.success) { setError(out.error); return; }
    setError(null); setView(out.data);
  }, [runDay, orderKey]);
  useEffect(() => { void load(); }, [load]);
  const plan = view?.plan;
  function move(index: number, delta: number) {
    if (!plan) return;
    const keys = plan.groups.map(g => g.key); const to = index + delta;
    if (to < 0 || to >= keys.length) return;
    [keys[index], keys[to]] = [keys[to], keys[index]]; setOrder(keys); setNote(null);
  }
  async function confirm() {
    if (!view || !plan) return;
    if (plan.breaches.length && reason.trim().length < 5) { setNote({ tone: "error", text: "Give the reason for running these jobs after their promised date (at least 5 characters)." }); return; }
    setBusy(true);
    const out = await confirmCoatingRunAction({ run_day: plan.run_day, fingerprint: view.fingerprint, ...(order ? { order } : {}), ...(plan.breaches.length ? { breach_note: reason.trim() } : {}) });
    setBusy(false);
    if (!out.success) { setNote({ tone: "error", text: out.error }); if (/changed/.test(out.error)) void load(); return; }
    setNote({ tone: "ok", text: `Run order confirmed for ${fmtDay(out.data.run_day)}: ${out.data.shade_changes} colour change(s) instead of ${out.data.baseline_changes} in promised-date order.` });
    setReason(""); await load(); void history.reload();
  }
  async function saveBrand(id: string) {
    const value = (brand[id] ?? "").trim();
    if (value.length < 2) { setNote({ tone: "error", text: "Enter the powder brand." }); return; }
    if (await apWrite("ap_coating", "set_brand", { finishing_job_id: id, powder_brand: value }, setNote, "Powder brand saved.")) { setOrder(undefined); await load(); }
  }
  return <div className="space-y-5">
    <Section title="Proposed coating runs" description="Jobs waiting for powder coating, grouped by shade and powder brand. Runs follow the earliest promised date; move a run up or down to change the order."
      actions={order ? <button type="button" className={secondaryClass} onClick={() => setOrder(undefined)}>Back to proposed order</button> : undefined}>
      {loading && !view ? <Loading what="the coating queue" /> : error ? <Failure text={error} /> : view && plan ? <>
        {view.can_confirm ? <LineSettings settings={view.settings} onSaved={() => void load()} /> : null}
        {view.confirmed ? <p className={`rounded-xl px-3 py-2 text-sm ${view.confirmed.stale ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
          Run order for {fmtDay(view.confirmed.run_day)} confirmed by {view.confirmed.confirmed_by ?? "—"} {fmtWhen(view.confirmed.confirmed_at)}: {view.confirmed.shade_changes} colour change(s).
          {view.confirmed.stale ? " The queue has changed since; review and confirm again." : ""}</p> : null}
        {!plan.groups.length ? <Empty>Nothing is waiting for powder coating.</Empty> : <>
          <div className="grid gap-2 sm:grid-cols-4">
            <label className="block text-sm font-semibold">Run day<select className={`${inputClass} mt-1`} value={plan.run_day} onChange={e => setRunDay(e.target.value)}>{view.working_days.map(d => <option key={d} value={d}>{fmtDay(d)}</option>)}</select></label>
            {[["Colour changes", plan.shade_changes], ["In promised-date order", plan.baseline_changes], ["Late if run this way", plan.timed ? plan.breaches.length : "—"]].map(([l, v]) =>
              <div key={String(l)} className="rounded-xl bg-neutral-50 p-3"><p className="text-xs font-bold uppercase text-neutral-500">{l}</p><p className="text-xl font-black tabular-nums">{v}</p></div>)}
          </div>
          {plan.notes.map(text => <p key={text} className="text-sm text-amber-900">{text}</p>)}
          <ol className="space-y-3">{plan.groups.map((g, index) => <li key={g.key} className="rounded-xl border border-neutral-200 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p><span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-neutral-950 text-xs font-black text-white">{index + 1}</span><b>{g.shade ?? "Shade not recorded"}</b>{g.brand ? ` · ${g.brand}` : " · brand not recorded"} · {g.jobs.length} job(s) · {kg(g.kg)}{g.unweighed_jobs && g.kg !== null ? ` (+${g.unweighed_jobs} without weight)` : ""}</p>
              {view.can_confirm ? <span className="flex gap-1"><button type="button" aria-label={`Move run ${index + 1} earlier`} className={secondaryClass} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                <button type="button" aria-label={`Move run ${index + 1} later`} className={secondaryClass} disabled={index === plan.groups.length - 1} onClick={() => move(index, 1)}>↓</button></span> : null}
            </div>
            <p className="text-xs text-neutral-500">{g.finish_day ? `Starts ${fmtDay(g.start_day)}, finishes ${fmtDay(g.finish_day)}${g.hours !== null ? ` (${g.hours} h)` : ""}` : plan.timed ? "Beyond the days checked" : "Finish day not known"} · earliest promise {g.earliest_due ? fmtDay(g.earliest_due) : "not set"}</p>
            <ul className="mt-2 divide-y">{g.jobs.map(j => { const late = plan.breaches.find(b => b.job_id === j.id); return <li key={j.id} className="space-y-1 py-1.5">
              <p>{j.order_number ?? "Order"} · {j.customer ?? "—"} · {kg(j.kg)} · promised {j.due ? fmtDay(j.due) : "not set"}{late ? <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">{late.days_late} day(s) late</span> : null}</p>
              {!j.brand && view.can_confirm ? <span className="flex flex-wrap gap-2"><input aria-label={`Powder brand for ${j.order_number ?? "job"}`} className={`${inputClass} sm:w-48`} placeholder="Powder brand" maxLength={60} value={brand[j.id] ?? ""} onChange={e => setBrand({ ...brand, [j.id]: e.target.value })} />
                <button type="button" className={secondaryClass} onClick={() => saveBrand(j.id)}>Save brand</button></span> : null}
            </li>; })}</ul>
          </li>)}</ol>
          {plan.breaches.length ? <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            <p className="font-bold">{plan.breaches.length} job(s) would finish after the promised date in this order:</p>
            <ul className="list-disc pl-5">{plan.breaches.map(b => <li key={b.job_id}>{b.order_number ?? "Order"} · {b.customer ?? "—"}: promised {fmtDay(b.due)}, finishes {fmtDay(b.finish_day)} ({b.days_late} day(s) late)</li>)}</ul>
            {view.can_confirm ? <label className="block font-semibold">Reason for confirming anyway<input className={`${inputClass} mt-1`} value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></label> : null}
          </div> : null}
          {view.can_confirm ? <button type="button" className={buttonClass} disabled={busy} onClick={confirm}>{busy ? "Confirming..." : `Confirm run order for ${fmtDay(plan.run_day)}`}</button>
            : <p className="text-sm text-neutral-600">The finishing supervisor or a production manager confirms the run order.</p>}
        </>}
        <Message value={note} />
        <p className="text-xs text-neutral-500">Confirming records the order of runs. It does not move material or change a finishing job; record progress on each <Link className="underline" href="/production/finishing">finishing job</Link> as usual.</p>
      </> : null}
    </Section>
    <Section title="Confirmed run orders" description="Colour changes against running the same jobs in promised-date order.">
      {history.loading && !history.data ? <Loading what="run orders" /> : history.error ? <Failure text={history.error} /> : history.data ? <>
        <p className="text-sm">Colour changes saved in the last 30 days: <b>{history.data.saved_changes_30d}</b></p>
        {history.data.rows.length ? <ul className="divide-y rounded-xl border">{history.data.rows.map(r => <li key={r.id} className="p-3 text-sm">
          <p><b>{fmtDay(r.run_day)}</b> · {r.runs} run(s), {r.jobs} job(s){r.total_kg !== null ? `, ${kg(r.total_kg)}` : ""} · {r.shade_changes} colour change(s) against {r.baseline_changes}{r.late_jobs ? ` · ${r.late_jobs} late job(s): ${r.breach_note ?? ""}` : ""}</p>
          <p className="text-xs text-neutral-500">Confirmed by {r.confirmed_by ?? "—"} {fmtWhen(r.confirmed_at)}</p></li>)}</ul> : <Empty>No run order confirmed yet.</Empty>}
        <Pager page={page} total={history.data.total_count} onPage={setPage} />
      </> : null}
    </Section>
  </div>;
}
