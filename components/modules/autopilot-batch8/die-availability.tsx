"use client";

// AP-065: when a die is away (nitriding, correction, maintenance, with a vendor) and when it is expected back. The die shop
// records the expected return; planned jobs on the die are checked against it. An overdue return is highlighted and the
// die stays unavailable until someone marks it back: it is never assumed back.
import { useState } from "react";
import Link from "next/link";
import { fmtDay } from "@/lib/order-to-cash/commands";
import { DIE_AWAY_REASONS, DIE_WINDOW_EDITORS } from "@/lib/autopilot-batch8/commands";
import { Empty, Failure, Loading, Message, Pager, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type State = { state: "available" | "unavailable" | "retired"; reason: string | null; until: string | null; overdue: boolean; source: string | null; custodian?: string | null; pass_number?: string | null;
  leaves_on?: string | null; booking?: { service: string; on: string } | null };
type Window = { id: string; reason: string; starts_on: string; expected_return: string | null; note: string | null; status: string; set_by: string | null; set_at: string; closed_at: string | null;
  close_note: string | null; overdue: boolean };
export type Warning = { code: string; severity: "warning" | "info"; message: string; die_id?: string; die_number?: string };
type DieView = { die_id: string; die_number: string; today: State; open: Window | null; history: Window[]; jobs: { id: string; job_number: string; planned_date: string | null; status: string; warnings: Warning[] }[]; can_edit: boolean };
type Note = { tone: "ok" | "error"; text: string } | null;

const REASON = (r: string | null) => r ? (DIE_AWAY_REASONS as Record<string, string>)[r] ?? r.replaceAll("_", " ") : "Away";

export function stateLine(s: State) {
  if (s.state === "retired") return "Retired: not available for planning.";
  if (s.state === "available") return s.leaves_on ? `In the plant; leaves ${fmtDay(s.leaves_on)}.` : s.booking ? `In the plant; booked for ${s.booking.service} on ${fmtDay(s.booking.on)}.` : "In the plant and available.";
  const where = s.source === "gate_pass" ? `With ${s.custodian ?? "a vendor"}${s.pass_number ? ` (pass ${s.pass_number})` : ""}` : REASON(s.reason);
  if (s.overdue) return `${where}: was due back ${fmtDay(s.until)} and has not returned.`;
  return s.until ? `${where}: expected back ${fmtDay(s.until)}.` : `${where}: no expected return date recorded.`;
}

export function WarningList({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) return null;
  return <ul className="space-y-1">{warnings.map((w, i) => <li key={`${w.code}:${i}`} className={`rounded-lg px-2 py-1 text-xs font-semibold ${w.severity === "warning" ? "bg-amber-50 text-amber-900" : "bg-sky-50 text-sky-900"}`}>{w.message}</li>)}</ul>;
}

export function DieAvailabilityPanel({ dieId, role, today }: { dieId: string; role: string; today: string }) {
  const [key, setKey] = useState(0);
  const view = useApRead<DieView>("ap_die_window", "die", { die_id: dieId }, [key]);
  const [reason, setReason] = useState<string>("nitriding"); const [from, setFrom] = useState(today); const [back, setBack] = useState(""); const [note, setNote] = useState("");
  const [closing, setClosing] = useState(""); const [message, setMessage] = useState<Note>(null); const [busy, setBusy] = useState(false); const [editing, setEditing] = useState(false);
  const canEdit = (DIE_WINDOW_EDITORS as readonly string[]).includes(role) && Boolean(view.data?.can_edit);
  const d = view.data;
  async function save() {
    setBusy(true);
    const ok = await apWrite("ap_die_window", "set", { die_id: dieId, reason, starts_on: from, ...(back ? { expected_return: back } : {}), ...(note.trim() ? { note: note.trim() } : {}) }, setMessage, "Saved. Planned jobs on this die are checked against the return date.");
    setBusy(false); if (ok) { setEditing(false); setKey(k => k + 1); }
  }
  async function markBack(id: string) {
    setBusy(true);
    const ok = await apWrite("ap_die_window", "close", { id, note: closing.trim() }, setMessage, "Marked back in the plant.");
    setBusy(false); if (ok) { setClosing(""); setKey(k => k + 1); }
  }
  return <Section id="die-availability" title="Availability for planning" description="Where the die is and when it is expected back. Jobs planned while it is away are flagged to planners.">
    {view.loading && !d ? <Loading what="availability" /> : view.error ? <Failure text={view.error} /> : d ? <>
      <p className={`rounded-xl px-3 py-2 text-sm font-bold ${d.today.state === "available" ? "bg-emerald-50 text-emerald-900" : d.today.overdue ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"}`}>{stateLine(d.today)}</p>
      {d.open ? <div className="space-y-2 rounded-xl border border-neutral-200 p-3 text-sm">
        <p><b>{REASON(d.open.reason)}</b> from {fmtDay(d.open.starts_on)} · {d.open.expected_return ? `expected back ${fmtDay(d.open.expected_return)}` : "expected return not recorded"}{d.open.note ? ` · ${d.open.note}` : ""}</p>
        <p className="text-xs text-neutral-500">Recorded by {d.open.set_by ?? "a colleague"}</p>
        {canEdit ? <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs font-bold">What was done on return<input className={inputClass} value={closing} onChange={e => setClosing(e.target.value)} placeholder="Nitrided and inspected" /></label>
          <button type="button" className={buttonClass} disabled={busy || closing.trim().length < 3} onClick={() => void markBack(d.open!.id)}>Mark back in plant</button>
          <button type="button" className={secondaryClass} onClick={() => { setEditing(true); setReason(d.open!.reason); setFrom(d.open!.starts_on); setBack(d.open!.expected_return ?? ""); }}>Change return date</button>
        </div> : null}
      </div> : null}
      {canEdit && (editing || !d.open) ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-bold">Why away<select className={inputClass} value={reason} onChange={e => setReason(e.target.value)}>{Object.entries(DIE_AWAY_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-xs font-bold">Away from<input type="date" className={inputClass} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs font-bold">Expected back<input type="date" className={inputClass} value={back} min={from} onChange={e => setBack(e.target.value)} /></label>
        <label className="text-xs font-bold">Note<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} placeholder="Vendor, reason" /></label>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4"><button type="button" className={buttonClass} disabled={busy || !from} onClick={() => void save()}>{d.open ? "Save return date" : "Record die away"}</button>
          {editing ? <button type="button" className={secondaryClass} onClick={() => setEditing(false)}>Cancel</button> : null}</div>
      </div> : null}
      <Message value={message} />
      <div><h3 className="text-sm font-black">Open jobs on this die</h3>
        {d.jobs.length ? <ul className="mt-1 divide-y rounded-xl border">{d.jobs.map(j => <li key={j.id} className="space-y-1 p-2 text-sm"><p><Link className="font-bold underline" href={`/production/${j.id}`}>{j.job_number}</Link> · {j.planned_date ? `planned ${fmtDay(j.planned_date)}` : "not yet planned"} · {j.status.replaceAll("_", " ")}</p><WarningList warnings={j.warnings} /></li>)}</ul>
          : <Empty>No open job uses this die.</Empty>}</div>
      {d.history.filter(h => h.status !== "open").length ? <details className="text-sm"><summary className="cursor-pointer font-bold">Earlier periods away</summary>
        <ul className="mt-1 space-y-1">{d.history.filter(h => h.status !== "open").map(h => <li key={h.id}>{REASON(h.reason)} {fmtDay(h.starts_on)} – {h.closed_at ? fmtDay(h.closed_at.slice(0, 10)) : "?"}{h.close_note ? `: ${h.close_note}` : ""}</li>)}</ul></details> : null}
    </> : null}
  </Section>;
}

type Conflict = { id: string; job_number: string; planned_date: string | null; status: string; die_id: string; die_number: string; warnings: Warning[] };

/** Planned jobs in the next two weeks whose die is away, overdue back, or decides the due date (planning screens). */
export function DieConflictsPanel() {
  const [page, setPage] = useState(1);
  const data = useApRead<{ rows: Conflict[]; total_count: number; away: number; overdue: number; days: number }>("ap_die_window", "conflicts", { page, days: 14 }, []);
  return <Section id="die-conflicts" title="Jobs that depend on a die that is away" description="Next 14 days, and open jobs not yet planned. Checked against expected returns, gate passes and die status.">
    {data.loading && !data.data ? <Loading what="die checks" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      <p className="text-sm text-neutral-600">{data.data.away} die(s) away now · {data.data.overdue} overdue back</p>
      {data.data.rows.length ? <ul className="divide-y rounded-xl border">{data.data.rows.map(r => <li key={r.id} className="space-y-1 p-3 text-sm">
        <p><Link className="font-bold underline" href={`/production/${r.id}`}>{r.job_number}</Link> · die <Link className="underline" href={`/dies/${r.die_id}#die-availability`}>{r.die_number}</Link> · {r.planned_date ? `planned ${fmtDay(r.planned_date)}` : "not yet planned"}</p>
        <WarningList warnings={r.warnings} /></li>)}</ul> : <Empty>No planned job depends on a die that is away.</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

/** The warnings for one job (job record). */
export function JobDieWarnings({ jobId }: { jobId: string }) {
  const data = useApRead<{ warnings: Record<string, Warning[]> }>("ap_die_window", "jobs", { job_ids: [jobId] }, []);
  const warnings = data.data?.warnings?.[jobId] ?? [];
  if (!warnings.length) return null;
  return <section aria-label="Die availability" className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3"><p className="mb-1 text-sm font-black text-amber-950">Die availability</p><WarningList warnings={warnings} /></section>;
}
