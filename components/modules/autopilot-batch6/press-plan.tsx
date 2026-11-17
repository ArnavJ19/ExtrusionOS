"use client";

import { useState } from "react";
import Link from "next/link";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, inputClass, useApRead } from "../order-to-cash/ui";
import { Action, Field, NumberInput, Stat, kg, write, type Note, type Queue } from "./shared";

type Line = { id: string; job_id: string; job_number: string | null; order_number: string | null; profile_code: string | null; die_number: string | null; alloy: string | null; machine_id: string;
  machine_name: string; shift: string; planned_start_at: string; planned_end_at: string; capacity_kg: number; sequence_number: number; reasons: string[]; origin: string; edited: boolean; removed: boolean };
type View = { plan_date: string; can_plan?: boolean; draft: null | { id: string; status: string; generated_at: string; generated_by_name: string; edit_count: number; inputs_changed: boolean; basis: Record<string, unknown>;
    published_at: string | null; published_by_name: string | null; plan_date: string };
  lines: Line[]; unscheduled: { job_id: string; job_number: string | null; order_number: string | null; reasons: string[]; planned_quantity_kg: number | null }[];
  published: { slot_id: string; job_number: string | null; machine_name: string; shift: string; planned_start_at: string; planned_end_at: string; capacity_kg: number; status: string }[];
  machines: { id: string; machine_name: string }[]; shifts: string[] };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const toLocal = (iso: string) => { const d = new Date(new Date(iso).getTime() + 330 * 60000); return d.toISOString().slice(0, 16); };
const fromLocal = (value: string) => new Date(`${value}:00+05:30`).toISOString();

export function PressPlanDraft({ initialDate, canEdit }: { initialDate?: string; canEdit: boolean }) {
  const [date, setDate] = useState(initialDate ?? ""); const [rev, setRev] = useState(0); const [note, setNote] = useState<Note>(null); const [reason, setReason] = useState("");
  const [view, setView] = useState<View | null>(null);
  const read = useApRead<View>("ap_press_plan", "draft", date ? { date } : {}, [rev]);
  const v = view && view.plan_date === read.data?.plan_date && view.draft?.id === read.data?.draft?.id ? view : read.data;
  const live = (v?.lines ?? []).filter(l => !l.removed);
  const byMachine = new Map<string, Line[]>(); for (const l of v?.lines ?? []) byMachine.set(l.machine_name, [...(byMachine.get(l.machine_name) ?? []), l]);
  const apply = (next: View | null) => { if (next) setView(next); };
  return <div className="space-y-5">
    <Section title="Draft press plan" description="Prepared overnight for the next working day from released jobs, die and billet availability, promise dates, shift capacity and maintenance. Adjust it, then publish through the normal schedule checks.">
      <div className="flex flex-wrap items-end gap-3"><div className="w-48"><Field label="Plan date"><input type="date" className={inputClass} value={date || v?.plan_date || ""} onChange={e => { setDate(e.target.value); setView(null); }} /></Field></div>
        {canEdit ? <Action secondary run={async () => { const r = await write<View>("ap_press_plan", "prepare", { date: date || v?.plan_date }, setNote, "Draft rebuilt from current facts. Earlier draft edits for this date are superseded."); apply(r); setRev(x => x + 1); }}>{v?.draft ? "Rebuild draft" : "Prepare draft now"}</Action> : null}</div>
      <Message value={note} />
      {read.error ? <Failure text={read.error} /> : read.loading && !v ? <Loading what="the draft plan" /> : !v?.draft ? <Empty>No draft for {fmtDay(v?.plan_date)} yet. The overnight job prepares one; a planner can prepare it now.</Empty> : <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Status" value={v.draft.status} tone={v.draft.status === "published" ? "ok" : undefined} /><Stat label="Jobs placed" value={live.length} />
          <Stat label="Could not schedule" value={v.unscheduled.length} tone={v.unscheduled.length ? "warn" : undefined} /><Stat label="Planner edits" value={v.draft.edit_count} tone={v.draft.edit_count >= 5 ? "warn" : undefined} /></div>
        <p className="text-xs text-neutral-600">Prepared {fmtWhen(v.draft.generated_at)} by {v.draft.generated_by_name}. {String(v.draft.basis.order ?? "")}{v.draft.published_at ? ` Published ${fmtWhen(v.draft.published_at)} by ${v.draft.published_by_name}.` : ""}</p>
        {v.draft.inputs_changed && v.draft.status === "draft" ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">The schedule, jobs or capacity changed since this draft was prepared. Publishing still runs every schedule check; rebuild if the changes matter.</p> : null}
        {[...byMachine.entries()].map(([machine, lines]) => <article key={machine} className="min-w-0 rounded-xl border p-3"><h3 className="font-bold">{machine}</h3>
          <ul className="divide-y">{lines.map(l => <PlanLine key={l.id} line={l} view={v} canEdit={canEdit && v.draft!.status === "draft"} onChanged={apply} setNote={setNote} />)}</ul></article>)}
        {v.unscheduled.length ? <article className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-3"><h3 className="font-bold">Could not be scheduled</h3>
          <ul className="divide-y divide-amber-200">{v.unscheduled.map(u => <li key={u.job_id} className="py-2 text-sm"><Link className="font-semibold underline" href={`/production/${u.job_id}`}>{u.job_number ?? "Job"}</Link> · {u.order_number ?? ""} · {kg(u.planned_quantity_kg)}
            <ul className="list-disc pl-5">{u.reasons.map(r => <li key={r}>{r}</li>)}</ul>{canEdit && v.draft!.status === "draft" ? <AddLine jobId={u.job_id} view={v} onChanged={apply} setNote={setNote} /> : null}</li>)}</ul></article> : null}
        <Section title="Already published for this day" description="Slots already in the schedule. The draft adds jobs without a slot; it does not move published slots.">
          {!v.published.length ? <Empty>Nothing is published for this day yet.</Empty> : <ul className="divide-y text-sm">{v.published.map(p => <li key={p.slot_id} className="py-2">{p.machine_name} · {p.shift} · {time(p.planned_start_at)}–{time(p.planned_end_at)} · {p.job_number ?? ""} · {kg(p.capacity_kg)} <Pill value={p.status} /></li>)}</ul>}
        </Section>
        {canEdit && v.draft.status === "draft" ? <div className="flex flex-wrap items-end gap-2">
          <Action disabled={!live.length} run={async () => { const r = await write<{ slots: number; edit_count: number }>("ap_press_plan", "publish", { draft_id: v.draft!.id }, setNote, "Published."); if (r) { setNote({ tone: "ok", text: `${r.slots} slot(s) published with ${r.edit_count} edit(s). The schedule now shows them.` }); setView(null); setRev(x => x + 1); } }}>Publish {live.length} slot(s)</Action>
          <div className="w-64"><Field label="Reason to discard"><input className={inputClass} value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></Field></div>
          <Action secondary disabled={reason.trim().length < 5} run={async () => { if (await write("ap_press_plan", "discard", { draft_id: v.draft!.id, reason: reason.trim() }, setNote, "Draft discarded.")) { setView(null); setRev(x => x + 1); } }}>Discard draft</Action>
        </div> : null}
      </>}
    </Section>
    <PlanHistory rev={rev} />
  </div>;
}

function PlanLine({ line, view, canEdit, onChanged, setNote }: { line: Line; view: View; canEdit: boolean; onChanged: (v: View | null) => void; setNote: (n: Note) => void }) {
  const [open, setOpen] = useState(false);
  const [machine, setMachine] = useState(line.machine_id); const [shift, setShift] = useState(line.shift); const [start, setStart] = useState(toLocal(line.planned_start_at)); const [end, setEnd] = useState(toLocal(line.planned_end_at)); const [qty, setQty] = useState(String(line.capacity_kg));
  return <li className={`py-3 text-sm ${line.removed ? "opacity-60" : ""}`}>
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{time(line.planned_start_at)}–{time(line.planned_end_at)} · {line.shift} · <Link className="underline" href={`/production/${line.job_id}`}>{line.job_number ?? "Job"}</Link> · {line.profile_code ?? ""} · die {line.die_number ?? "—"} · {kg(line.capacity_kg)}</p>
      <ul className="list-disc pl-5 text-xs text-neutral-600">{line.reasons.map(r => <li key={r}>{r}</li>)}</ul></div>
      <div className="flex flex-wrap gap-1">{line.removed ? <Pill value="cancelled" label="Removed" /> : line.edited ? <Pill value="pending" label="Edited" /> : null}</div></div>
    {canEdit ? <div className="mt-2 flex flex-wrap gap-2">
      <Action secondary run={async () => onChanged(await write<View>("ap_press_plan", "edit_line", { line_id: line.id, remove: true }, setNote, line.removed ? "Line restored." : "Line removed from the draft."))}>{line.removed ? "Restore" : "Remove"}</Action>
      {!line.removed ? <button type="button" className="min-h-11 rounded-xl border px-3 text-sm font-bold" onClick={() => setOpen(!open)}>{open ? "Close" : "Change"}</button> : null}</div> : null}
    {open && canEdit ? <div className="mt-2 grid gap-3 rounded-xl bg-neutral-50 p-3 sm:grid-cols-3">
      <Field label="Press"><select className={inputClass} value={machine} onChange={e => setMachine(e.target.value)}>{view.machines.map(m => <option key={m.id} value={m.id}>{m.machine_name}</option>)}</select></Field>
      <Field label="Shift"><select className={inputClass} value={shift} onChange={e => setShift(e.target.value)}>{(view.shifts.length ? view.shifts : [line.shift]).map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="Quantity (kg)"><NumberInput value={qty} onChange={setQty} /></Field>
      <Field label="Start (IST)"><input type="datetime-local" className={inputClass} value={start} onChange={e => setStart(e.target.value)} /></Field>
      <Field label="End (IST)"><input type="datetime-local" className={inputClass} value={end} onChange={e => setEnd(e.target.value)} /></Field>
      <div className="flex items-end"><Action disabled={!start || !end || end <= start || !(Number(qty) > 0)} run={async () => { const r = await write<View>("ap_press_plan", "edit_line", { line_id: line.id, machine_id: machine, shift, planned_start_at: fromLocal(start), planned_end_at: fromLocal(end), capacity_kg: Number(qty) }, setNote, "Line changed."); if (r) { onChanged(r); setOpen(false); } }}>Save change</Action></div>
    </div> : null}
  </li>;
}

function AddLine({ jobId, view, onChanged, setNote }: { jobId: string; view: View; onChanged: (v: View | null) => void; setNote: (n: Note) => void }) {
  const [open, setOpen] = useState(false); const [machine, setMachine] = useState(view.machines[0]?.id ?? ""); const [shift, setShift] = useState(view.shifts[0] ?? "");
  const [start, setStart] = useState(`${view.plan_date}T08:00`); const [end, setEnd] = useState(`${view.plan_date}T10:00`); const [qty, setQty] = useState("");
  if (!open) return <button type="button" className="mt-1 min-h-11 rounded-xl border border-amber-300 bg-white px-3 text-sm font-bold" onClick={() => setOpen(true)}>Place it myself</button>;
  return <div className="mt-2 grid gap-3 rounded-xl bg-white p-3 sm:grid-cols-3">
    <Field label="Press"><select className={inputClass} value={machine} onChange={e => setMachine(e.target.value)}>{view.machines.map(m => <option key={m.id} value={m.id}>{m.machine_name}</option>)}</select></Field>
    <Field label="Shift"><input className={inputClass} value={shift} onChange={e => setShift(e.target.value)} /></Field>
    <Field label="Quantity (kg)"><NumberInput value={qty} onChange={setQty} /></Field>
    <Field label="Start (IST)"><input type="datetime-local" className={inputClass} value={start} onChange={e => setStart(e.target.value)} /></Field>
    <Field label="End (IST)"><input type="datetime-local" className={inputClass} value={end} onChange={e => setEnd(e.target.value)} /></Field>
    <div className="flex items-end"><Action disabled={!machine || !shift.trim() || !(Number(qty) > 0) || end <= start} run={async () => { const r = await write<View>("ap_press_plan", "add_line", { draft_id: view.draft!.id, job_id: jobId, machine_id: machine, shift: shift.trim(), planned_start_at: fromLocal(start), planned_end_at: fromLocal(end), capacity_kg: Number(qty) }, setNote, "Added to the draft. Publishing still checks capacity and maintenance."); if (r) { onChanged(r); setOpen(false); } }}>Add to draft</Action></div>
  </div>;
}

function PlanHistory({ rev }: { rev: number }) {
  const [page, setPage] = useState(1);
  const read = useApRead<Queue<{ id: string; plan_date: string; status: string; generated_at: string; edit_count: number; published_at: string | null; published_by: string | null; placed: number | null; unscheduled: number | null }> & { published_last_10: { count: number; under_five_edits: number; median_edits: number | null } }>("ap_press_plan", "history", { page }, [rev]);
  return <Section title="Draft history" description="Edits per published plan show whether the draft is good enough to publish with few changes.">
    {read.error ? <Failure text={read.error} /> : !read.data ? <Loading what="history" /> : <>
      <p className="text-sm">Last {read.data.published_last_10.count} published plan(s): {read.data.published_last_10.under_five_edits} with fewer than five edits{read.data.published_last_10.median_edits != null ? `; median ${read.data.published_last_10.median_edits} edit(s)` : ""}.</p>
      {!read.data.rows.length ? <Empty>No drafts yet.</Empty> : <ul className="divide-y text-sm">{read.data.rows.map(r => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2"><span className="font-semibold">{fmtDay(r.plan_date)} · {r.status}</span>
        <span>{r.placed ?? 0} placed · {r.unscheduled ?? 0} unscheduled · {r.edit_count} edit(s){r.published_at ? ` · published ${fmtWhen(r.published_at)} by ${r.published_by ?? "—"}` : ""}</span></li>)}</ul>}
      <Pager page={page} total={read.data.total_count} onPage={setPage} />
    </>}
  </Section>;
}
