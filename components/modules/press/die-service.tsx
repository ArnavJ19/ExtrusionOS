"use client";

// AP-028: die service counters from push events against the approved interval for the die family, with the booking
// made from a due proposal, and the AP-011 cycle-time chart for the die. Intervals are die-shop policy; the prediction
// ("due in ~N pushes") is advisory.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { autopilotAction } from "@/lib/actions/autopilot";
import { fmtKg, fmtNum, fmtTime, type DieService } from "@/lib/press/types";
import { ProposalCards } from "@/components/modules/autopilot/proposal-cards";
import { dieServiceSummary } from "@/components/modules/press/die-service-hint";

export { DieServiceHint } from "@/components/modules/press/die-service-hint";

const stateStyle: Record<string, string> = { due: "bg-rose-50 text-rose-800", approaching: "bg-amber-50 text-amber-900", ok: "bg-emerald-50 text-emerald-800", unknown: "bg-neutral-100 text-neutral-700", none: "bg-neutral-100 text-neutral-700" };
const basisLabel = (basis: string) => basis === "pushes_since_service" ? "pushes" : basis === "kg_since_service" ? "kg" : basis === "runs_since_service" ? "runs" : "days";

function CycleTimeChart({ dieId }: { dieId: string }) {
  const [points, setPoints] = useState<{ at: string; seconds: number; job: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void autopilotAction("ap_press", "cycle_times", { die_id: dieId }).then(result => {
      if (!result.success) { setError(result.error); return; }
      setPoints((result.data as { points: { at: string; seconds: number; job: string | null }[] }).points);
    });
  }, [dieId]);
  if (error) return <p className="text-sm text-amber-900">{error}</p>;
  if (!points) return <p role="status" className="text-sm">Loading cycle times…</p>;
  if (points.length < 2) return <p className="text-sm text-neutral-600">Cycle times appear after two consecutive pushes on this die at a workstation.</p>;
  const width = 600, height = 160, max = Math.max(...points.map(p => p.seconds)), min = Math.min(...points.map(p => p.seconds));
  const sorted = [...points.map(p => p.seconds)].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
  const x = (index: number) => 30 + index * (width - 40) / Math.max(1, points.length - 1);
  const y = (value: number) => height - 20 - (max === min ? 0.5 : (value - min) / (max - min)) * (height - 40);
  return <figure className="min-w-0">
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label={`Cycle time per push, last ${points.length} pushes; median ${median} seconds, range ${min} to ${max} seconds`}>
      <line x1={30} x2={width - 10} y1={y(median)} y2={y(median)} stroke="currentColor" strokeDasharray="4 4" className="text-neutral-400" />
      <polyline fill="none" stroke="currentColor" strokeWidth={2} className="text-neutral-900" points={points.map((p, i) => `${x(i)},${y(p.seconds)}`).join(" ")} />
      <text x={2} y={y(max) + 4} className="fill-neutral-500 text-[10px]">{max}s</text><text x={2} y={y(min) + 4} className="fill-neutral-500 text-[10px]">{min}s</text>
    </svg>
    <figcaption className="text-xs text-neutral-600">Seconds between consecutive taps (idle gaps and supervisor-added pushes excluded). Dashed line: median {median} s over {points.length} pushes.</figcaption>
  </figure>;
}

export function DieServicePanel({ dieId, today }: { dieId: string; today: string }) {
  const [service, setService] = useState<DieService | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ id: string; status: "done" | "cancelled"; note: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = await autopilotAction("ap_dies", "service", { die_id: dieId });
    if (!result.success) { setError(result.error); return; }
    setError(null); setService(result.data as DieService);
  }, [dieId]);
  useEffect(() => { void load(); }, [load]);
  async function close() {
    if (!closing) return;
    const result = await autopilotAction("ap_dies", "booking_close", { id: closing.id, status: closing.status, note: closing.note.trim() });
    setMessage(result.success ? (closing.status === "done" ? "Service recorded in the die history; counters restart from today." : "Booking cancelled.") : result.error);
    if (result.success) setClosing(null);
    await load();
  }
  if (error) return <section className="rounded-2xl border bg-white p-4"><h2 className="text-lg font-bold">Die service</h2><p role="alert" className="mt-2 text-sm text-amber-900">{error}</p></section>;
  if (!service) return <section className="rounded-2xl border bg-white p-4"><p role="status" className="text-sm">Loading die service…</p></section>;
  if (service.missing) return null;
  return <section aria-labelledby="die-service" className="min-w-0 space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 id="die-service" className="text-lg font-bold">Die service</h2>
      <p className="text-sm text-neutral-600">Counted from pushes since the last nitriding or correction. Intervals are die-shop policy; this prediction is advisory.</p></div>
      <span className={`rounded-full px-3 py-1 text-sm font-bold ${stateStyle[service.state] ?? stateStyle.none}`}>{dieServiceSummary(service)}</span></div>
    <div className="grid gap-2 sm:grid-cols-3">{(["nitriding", "correction", "any"] as const).map(event => <div key={event} className="rounded-xl bg-neutral-50 p-3 text-sm">
      <p className="font-bold">{event === "any" ? "Since any service" : `Since last ${event}`}</p>
      <p className="text-neutral-600">{service.service[event].since ?? "No record yet"}</p>
      <p className="mt-1 tabular-nums">{fmtNum(service.service[event].pushes)} pushes · {fmtKg(service.service[event].kg, 0)} · {fmtNum(service.service[event].runs)} runs</p></div>)}</div>
    {service.checks.length ? <ul className="divide-y rounded-xl border text-sm">{service.checks.map(check => <li key={check.threshold_id} className="flex flex-wrap items-center justify-between gap-2 p-2">
      <span>{check.service_event === "any" ? "Nitriding or correction" : check.service_event} every {fmtNum(check.warn_at)} {basisLabel(check.basis)}{check.die_type ? ` (${check.die_type} dies)` : ""}</span>
      <span className="tabular-nums">{fmtNum(check.value)} so far{check.due_in_pushes !== null && check.state !== "due" ? ` · due in ~${check.due_in_pushes} pushes` : ""} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${stateStyle[check.state]}`}>{check.state}</span></span></li>)}</ul>
      : <p className="text-sm text-neutral-600">No approved interval covers this die family yet. Intervals are proposed and approved under Die Intelligence.</p>}
    {service.bookings.length ? <div className="space-y-2"><h3 className="font-bold">Booked service</h3>{service.bookings.map(booking => <div key={booking.id} className="rounded-xl border p-3 text-sm">
      <p>{booking.service_event} on {booking.scheduled_for} · booked by {booking.booked_by ?? "—"} {fmtTime(booking.booked_at)}</p>
      {service.can_book ? <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="min-h-10 rounded-lg bg-neutral-950 px-3 font-bold text-white" onClick={() => setClosing({ id: booking.id, status: "done", note: "" })}>Mark done</button>
        <button type="button" className="min-h-10 rounded-lg border px-3 font-bold" onClick={() => setClosing({ id: booking.id, status: "cancelled", note: "" })}>Cancel booking</button></div> : null}
      {closing?.id === booking.id ? <div className="mt-2 flex flex-wrap items-end gap-2"><label className="block min-w-0 flex-1 font-semibold">{closing.status === "done" ? "What was done (vendor, result)" : "Why cancel"}
        <input className="mt-1 h-11 w-full rounded-xl border px-3" value={closing.note} maxLength={300} onChange={event => setClosing({ ...closing, note: event.target.value })} /></label>
        <button type="button" disabled={closing.note.trim().length < 3} onClick={close} className="min-h-11 rounded-xl bg-neutral-950 px-4 font-bold text-white disabled:opacity-50">Save</button></div> : null}
    </div>)}</div> : null}
    <ProposalCards type="die.service_due" targetPrefix={`${dieId}:`} initial={null} today={today} onDecided={() => { void load(); }} title="Service proposals" description="Prepared when the die reaches its approved interval. Accepting books the service; nothing is sent to a vendor." emptyText="No service proposal for this die." />
    <div><h3 className="font-bold">Cycle time per push</h3><CycleTimeChart dieId={dieId} /></div>
    {message ? <p role="status" className="rounded-xl bg-neutral-100 p-3 text-sm font-semibold">{message}</p> : null}
  </section>;
}

export function DieFlagsPanel() {
  const [data, setData] = useState<{ total_count: number; rows: DieService[] } | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void autopilotAction("ap_dies", "flags", { page }).then(result => {
      if (!result.success) { setError(result.error); return; }
      setError(null); setData(result.data as { total_count: number; rows: DieService[] });
    });
  }, [page]);
  const pages = Math.max(1, Math.ceil((data?.total_count ?? 0) / 10));
  return <section aria-labelledby="die-flags" className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
    <div><h2 id="die-flags" className="text-lg font-bold">Dies at or near their service interval</h2>
      <p className="text-sm text-neutral-600">From push counts since the last nitriding or correction. Due dies without a booking come first.</p></div>
    {error ? <p role="alert" className="text-sm text-amber-900">{error}</p> : !data ? <p role="status" className="text-sm">Loading…</p>
      : !data.rows.length ? <p className="rounded-xl border border-dashed p-3 text-sm text-neutral-600">No die is at or near its approved interval.</p>
      : <ul className="divide-y rounded-xl border">{data.rows.map(row => <li key={row.die_id}><Link href={`/dies/${row.die_id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-neutral-50">
        <span className="font-bold">{row.die_number}</span><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${stateStyle[row.state]}`}>{dieServiceSummary(row)}</span></Link></li>)}</ul>}
    {pages > 1 ? <nav aria-label="Flagged die pages" className="flex items-center justify-between text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Previous</button>
      <span>Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Next</button></nav> : null}
  </section>;
}
