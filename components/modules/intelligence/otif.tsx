"use client";

// FS-68: on-time-in-full against the FIRST promise of every order line, by customer, salesperson, profile and cause.
import { useState } from "react";
import Link from "next/link";
import { fmtDay } from "@/lib/order-to-cash/commands";
import { DELAY_CAUSES, OTIF_OUTCOMES, causeLabel } from "@/lib/intelligence/commands";
import { kgText, pct } from "@/lib/intelligence/format";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, Stat, buttonClass, fsWrite, inputClass, secondaryClass, useFsRead, type Note } from "./shared";

type Group = { key: string; label: string; due: number; otif: number; otif_percent: number | null };
type Summary = { from: string; to: string; due: number; otif: number; late: number; open_late: number; quantity_missing: number; otif_percent: number | null;
  tolerance_percent: number; reconstructed_first_promises: number; by: Record<string, Group[]>; basis: string };
type Line = { order_item_id: string; order_id: string; order_number: string; customer_name: string; salesperson: string; profile_code: string | null; ordered_kg: number | null;
  dispatched_kg: number; first_promised_date: string; first_promise_source: string; current_promise: string | null; changes: number; complete_on: string | null; outcome: string; cause: string };
type History = { first: { first_promised_date: string; source: string; captured_at: string } | null;
  changes: { id: string; previous_date: string | null; new_date: string | null; cause: string; reason: string | null; agreed_with: string | null; source: string; changed_by: string | null; changed_at: string; annotated_by: string | null }[];
  causes: { cause: string; note: string | null; recorded_by: string; recorded_at: string }[] };

const PERIODS = [{ days: 30, label: "30 days" }, { days: 90, label: "90 days" }, { days: 365, label: "12 months" }];
const DIMENSIONS: Record<string, string> = { customer: "Customer", salesperson: "Salesperson", profile: "Profile", cause: "Cause of delay" };
const istDay = (offset: number) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

export function OtifClient({ canEdit, canSetTolerance }: { canEdit: boolean; canSetTolerance: boolean }) {
  const [days, setDays] = useState(30); const [dim, setDim] = useState("customer"); const [key, setKey] = useState(0);
  const range = { from: istDay(-(days - 1)), to: istDay(0) };
  const s = useFsRead<Summary>("fs_otif", "summary", range, [key]);
  const v = s.data;
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Period">{PERIODS.map(p => <button key={p.days} type="button" aria-pressed={days === p.days}
      className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${days === p.days ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-300 bg-white"}`} onClick={() => setDays(p.days)}>{p.label}</button>)}</div>
    {s.loading && !v ? <Loading what="on-time-in-full" /> : s.error ? <Failure text={s.error} /> : v ? <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="OTIF" value={pct(v.otif_percent)} hint={`${v.otif} of ${v.due} lines due`} tone={v.otif_percent !== null && v.otif_percent < 80 ? "bad" : undefined} />
        <Stat label="Delivered late" value={String(v.late)} hint="Complete after the first promise" />
        <Stat label="Still incomplete" value={String(v.open_late)} hint="First promise passed" tone={v.open_late > 0 ? "bad" : undefined} />
        <Stat label="In-full tolerance" value={`${v.tolerance_percent}%`} hint={v.quantity_missing ? `${v.quantity_missing} line(s) without quantity left out` : "Of ordered kg"} />
      </div>
      <p className="text-xs text-neutral-600">{v.basis}{v.reconstructed_first_promises ? ` ${v.reconstructed_first_promises} line(s) predate promise capture; their first promise was reconstructed from the schedule history or the current date.` : ""}</p>
      <Section title="Where it slips" description="Share of lines due that were on time in full.">
        <div className="flex flex-wrap gap-1" role="tablist">{Object.entries(DIMENSIONS).map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={dim === k}
          className={`rounded-xl px-3 py-2 text-sm font-semibold ${dim === k ? "bg-neutral-950 text-white" : "bg-neutral-100"}`} onClick={() => setDim(k)}>{label}</button>)}</div>
        {(v.by[dim] ?? []).length ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[480px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">{DIMENSIONS[dim]}</th><th className="p-2 text-right">{dim === "cause" ? "Missed lines" : "Lines due"}</th>{dim === "cause" ? null : <><th className="p-2 text-right">OTIF</th><th className="p-2 text-right">%</th></>}</tr></thead>
          <tbody>{(v.by[dim] ?? []).slice(0, 10).map(g => <tr key={g.key} className="border-t"><td className="p-2">{dim === "cause" ? causeLabel(g.key) : g.label}</td><td className="p-2 text-right tabular-nums">{g.due}</td>
            {dim === "cause" ? null : <><td className="p-2 text-right tabular-nums">{g.otif}</td><td className={`p-2 text-right font-bold tabular-nums ${(g.otif_percent ?? 100) < 80 ? "text-rose-700" : ""}`}>{pct(g.otif_percent)}</td></>}</tr>)}</tbody>
        </table></div> : <Empty>No lines fell due in this period.</Empty>}
      </Section>
    </> : null}
    <Lines range={range} canEdit={canEdit} onChange={() => setKey(k => k + 1)} />
    {canSetTolerance ? <Tolerance onSaved={() => setKey(k => k + 1)} /> : null}
  </div>;
}

function Lines({ range, canEdit, onChange }: { range: { from: string; to: string }; canEdit: boolean; onChange: () => void }) {
  const [page, setPage] = useState(1); const [outcome, setOutcome] = useState("missed"); const [key, setKey] = useState(0); const [open, setOpen] = useState<string | null>(null);
  const d = useFsRead<{ rows: Line[]; total_count: number }>("fs_otif", "lines", { ...range, page, outcome }, [key]);
  return <Section id="lines" title="Order lines" description="Each line is judged against its first promised date. Changes are listed; they never move the target.">
    <select aria-label="Outcome" className={`${inputClass} w-auto`} value={outcome} onChange={e => { setOutcome(e.target.value); setPage(1); }}>
      <option value="missed">Missed (late or incomplete)</option><option value="otif">On time in full</option><option value="all">All lines due</option></select>
    {d.loading && !d.data ? <Loading what="lines" /> : d.error ? <Failure text={d.error} /> : d.data ? <>
      {d.data.rows.length ? <ul className="divide-y rounded-xl border">{d.data.rows.map(l => <li key={l.order_item_id} className="space-y-2 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><Link className="font-bold underline" href={`/orders/${l.order_id}`}>{l.order_number}</Link> · {l.customer_name}{l.profile_code ? ` · ${l.profile_code}` : ""}
            <p className="text-xs text-neutral-600">First promise {fmtDay(l.first_promised_date)}{l.current_promise && l.current_promise !== l.first_promised_date ? ` · now ${fmtDay(l.current_promise)}` : ""} · {l.changes} change(s) · complete {l.complete_on ? fmtDay(l.complete_on) : "not yet"} · {kgText(l.dispatched_kg)} of {kgText(l.ordered_kg)} · {l.salesperson}</p></div>
          <div className="flex items-center gap-2"><Pill value={l.outcome === "otif" ? "passed" : l.outcome === "late" ? "held" : "blocked"} label={OTIF_OUTCOMES[l.outcome] ?? l.outcome} />
            {l.outcome !== "otif" ? <span className="text-xs text-neutral-600">Cause: {causeLabel(l.cause)}</span> : null}
            <button type="button" className="text-xs font-bold underline" onClick={() => setOpen(open === l.order_item_id ? null : l.order_item_id)}>{open === l.order_item_id ? "Hide" : "History"}</button></div>
        </div>
        {open === l.order_item_id ? <LineHistory line={l} canEdit={canEdit} onChange={() => { setKey(k => k + 1); onChange(); }} /> : null}
      </li>)}</ul> : <Empty>No lines match.</Empty>}
      <Pager page={page} total={d.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

function LineHistory({ line, canEdit, onChange }: { line: Line; canEdit: boolean; onChange: () => void }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null); const [cause, setCause] = useState(""); const [note, setNote] = useState("");
  const [annot, setAnnot] = useState<Record<string, { cause: string; agreed: string }>>({});
  const h = useFsRead<History>("fs_otif", "history", { order_item_id: line.order_item_id }, [key]);
  const done = (text: string) => { setMessage({ tone: "ok", text }); setKey(k => k + 1); onChange(); };
  return <div className="space-y-2 rounded-xl bg-neutral-50 p-3">
    <Message value={message} />
    {h.loading && !h.data ? <Loading what="promise history" /> : h.error ? <Failure text={h.error} /> : h.data ? <>
      <p className="text-xs">First promise {h.data.first ? `${fmtDay(h.data.first.first_promised_date)} (${h.data.first.source === "captured" ? "captured when set" : "reconstructed at upgrade"})` : "none"}.</p>
      {h.data.changes.length ? <ul className="space-y-1 text-xs">{h.data.changes.map(c => <li key={c.id} className="rounded-lg bg-white p-2">
        <b>{c.previous_date ? fmtDay(c.previous_date) : "none"} → {c.new_date ? fmtDay(c.new_date) : "none"}</b> · {c.source === "line_schedule" ? "line date" : "order date"} · {c.changed_by ?? "system"} {new Date(c.changed_at).toLocaleString("en-IN")}
        {c.reason ? <> · “{c.reason}”</> : null} · cause {causeLabel(c.cause)}{c.agreed_with ? ` · agreed with ${c.agreed_with}` : ""}{c.annotated_by ? ` (recorded by ${c.annotated_by})` : ""}
        {canEdit && c.cause === "not_recorded" ? <div className="mt-1 flex flex-wrap items-end gap-2">
          <select aria-label="Cause of this change" className={`${inputClass} w-auto`} value={annot[c.id]?.cause ?? ""} onChange={e => setAnnot(a => ({ ...a, [c.id]: { cause: e.target.value, agreed: a[c.id]?.agreed ?? "" } }))}>
            <option value="">Cause…</option>{Object.entries(DELAY_CAUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input aria-label="Agreed with" className={`${inputClass} w-48`} placeholder="Agreed with (customer contact)" value={annot[c.id]?.agreed ?? ""} onChange={e => setAnnot(a => ({ ...a, [c.id]: { cause: a[c.id]?.cause ?? "", agreed: e.target.value } }))} />
          <button type="button" className={secondaryClass} disabled={!annot[c.id]?.cause} onClick={async () => {
            if (await fsWrite("fs_otif", "annotate_change", { id: c.id, cause: annot[c.id].cause, ...(annot[c.id].agreed.trim() ? { agreed_with: annot[c.id].agreed.trim() } : {}) }, setMessage)) done("Cause recorded.");
          }}>Record</button></div> : null}
      </li>)}</ul> : <p className="text-xs text-neutral-600">The promise was never changed.</p>}
      {h.data.causes.length ? <p className="text-xs">Delay cause recorded: {h.data.causes.map(c => `${causeLabel(c.cause)} by ${c.recorded_by}${c.note ? ` (“${c.note}”)` : ""}`).join("; ")}</p> : null}
      {canEdit && line.outcome !== "otif" ? <div className="flex flex-wrap items-end gap-2">
        <select aria-label="Cause of the delay" className={`${inputClass} w-auto`} value={cause} onChange={e => setCause(e.target.value)}><option value="">Cause of the delay…</option>{Object.entries(DELAY_CAUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input aria-label="Note" className={`${inputClass} min-w-0 flex-1`} placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
        <button type="button" className={buttonClass} disabled={!cause} onClick={async () => {
          if (await fsWrite("fs_otif", "set_cause", { order_item_id: line.order_item_id, cause, ...(note.trim() ? { note: note.trim() } : {}) }, setMessage)) { setCause(""); setNote(""); done("Delay cause recorded."); }
        }}>Record cause</button></div> : null}
    </> : null}
  </div>;
}

function Tolerance({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null); const [value, setValue] = useState(""); const [reason, setReason] = useState("");
  const s = useFsRead<{ in_full_tolerance_percent: number; set: { reason: string; updated_by: string; updated_at: string } | null }>("fs_otif", "settings", {}, [key]);
  return <Section id="tolerance" title="In-full tolerance" description="How far below the ordered kg a line may be dispatched and still count as in full. It stays 0% until Omalco decides; every change is recorded.">
    <Message value={message} />
    {s.data ? <p className="text-sm">Now {s.data.in_full_tolerance_percent}%{s.data.set ? ` · set by ${s.data.set.updated_by} on ${new Date(s.data.set.updated_at).toLocaleDateString("en-IN")} (“${s.data.set.reason}”)` : " · never set"}.</p> : null}
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-bold">Tolerance %<input className={`${inputClass} w-28`} inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} /></label>
      <label className="min-w-0 flex-1 text-xs font-bold">Reason<input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} placeholder="Decision reference" /></label>
      <button type="button" className={buttonClass} disabled={!value.trim() || reason.trim().length < 5} onClick={async () => {
        if (await fsWrite("fs_otif", "save_settings", { in_full_tolerance_percent: Number(value), reason: reason.trim() }, setMessage, "Tolerance saved.")) { setValue(""); setReason(""); setKey(k => k + 1); onSaved(); }
      }}>Save</button></div>
  </Section>;
}
