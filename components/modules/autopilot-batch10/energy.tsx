"use client";

// AP-021: meter readings per press and shift, and the energy they give each job. Two readings per press per shift are
// typed; the previous shift's closing value is offered as the opening value. kWh is shared between the jobs that pressed
// in the shift by their running time. A shift without both readings shows no energy figure (blank, never zero).
import { useState } from "react";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Reading = { id: string; opening_kwh: number; closing_kwh: number | null; kwh: number | null; opened_by: string | null; closed_by: string | null; closed_at: string | null; note: string | null };
type ShiftRow = { machine_id: string; machine_name: string; shift_name: string; configured: boolean; starts_local: string | null; ends_local: string | null; reading: Reading | null;
  previous_closing: { kwh: number; shift_day: string; shift_name: string } | null };
type AllocJob = { job_id: string; job_number: string | null; die_number: string | null; profile_code: string | null; pushes: number; billet_kg: number | null; estimated_pushes: number; unweighed_pushes: number; runtime_min: number; kwh: number; kwh_per_kg: number | null };
type Allocation = { day: string; basis: string; readings: { id: string; machine_name: string; shift_name: string; opening_kwh: number; closing_kwh: number | null; kwh: number | null; jobs: AllocJob[] }[] };
type Monthly = { month: string; from: string; to: string; presses: { machine_id: string; machine_name: string; readings_closed: number; readings_open: number; kwh: number | null; allocated_kwh: number | null; billet_kg: number | null; pushes: number; unweighed_pushes: number; kwh_per_kg: number | null }[];
  dies: { die_id: string; die_number: string; kwh: number; billet_kg: number | null; kwh_per_kg: number | null }[] };

const n = (v: unknown, digits = 1) => (v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: digits }));
const blankOr = (text: string) => (text.trim() === "" ? undefined : Number(text));

function ShiftCard({ row, day, canWrite, canCorrect, onSaved }: { row: ShiftRow; day: string; canWrite: boolean; canCorrect: boolean; onSaved: () => void }) {
  const r = row.reading;
  const [opening, setOpening] = useState(r ? String(r.opening_kwh) : row.previous_closing ? String(row.previous_closing.kwh) : "");
  const [closing, setClosing] = useState(r?.closing_kwh !== null && r?.closing_kwh !== undefined ? String(r.closing_kwh) : "");
  const [note, setNote] = useState<Note>(null); const [busy, setBusy] = useState(false);
  const closed = r?.closing_kwh !== null && r?.closing_kwh !== undefined;
  const locked = !canWrite || (closed && !canCorrect);
  async function save() {
    const o = blankOr(opening), c = blankOr(closing);
    if (o === undefined && c === undefined) { setNote({ tone: "error", text: "Enter a meter reading." }); return; }
    if ((o !== undefined && !Number.isFinite(o)) || (c !== undefined && !Number.isFinite(c))) { setNote({ tone: "error", text: "Enter the readings as numbers." }); return; }
    setBusy(true);
    const out = await apWrite("ap_energy", "save", { machine_id: row.machine_id, shift_day: day, shift_name: row.shift_name, ...(o !== undefined ? { opening_kwh: o } : {}), ...(c !== undefined ? { closing_kwh: c } : {}) }, setNote, "Reading saved.");
    setBusy(false);
    if (out) onSaved();
  }
  return <li className="space-y-2 rounded-xl border border-neutral-200 p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="font-bold">{row.machine_name} · {row.configured ? `Shift ${row.shift_name}` : "Whole day"}{row.starts_local ? <span className="font-normal text-neutral-500"> {row.starts_local.slice(0, 5)}–{row.ends_local?.slice(0, 5)}</span> : null}</p>
      <p className="text-sm tabular-nums">{closed ? <b>{n(r?.kwh)} kWh</b> : r ? <span className="text-amber-800">Closing reading pending</span> : <span className="text-neutral-500">No reading yet</span>}</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <label className="block text-sm font-semibold">Opening reading (kWh)<input inputMode="decimal" className={`${inputClass} mt-1`} value={opening} disabled={locked} onChange={e => setOpening(e.target.value)} /></label>
      <label className="block text-sm font-semibold">Closing reading (kWh)<input inputMode="decimal" className={`${inputClass} mt-1`} value={closing} disabled={locked} onChange={e => setClosing(e.target.value)} /></label>
      <div className="flex items-end"><button type="button" className={closed ? secondaryClass : buttonClass} disabled={busy || locked} onClick={save}>{busy ? "Saving..." : closed ? "Correct" : "Save"}</button></div>
    </div>
    {!r && row.previous_closing ? <p className="text-xs text-neutral-500">Opening value offered from the closing reading of {fmtDay(row.previous_closing.shift_day)} shift {row.previous_closing.shift_name}. Check it against the meter.</p> : null}
    {r ? <p className="text-xs text-neutral-500">Opened by {r.opened_by ?? "—"}{r.closed_by ? ` · closed by ${r.closed_by} ${fmtWhen(r.closed_at)}` : ""}</p> : null}
    {closed && !canCorrect ? <p className="text-xs text-neutral-500">A closed reading is corrected by a production manager.</p> : null}
    <Message value={note} />
  </li>;
}

export function PressMetersClient({ today, canWrite }: { today: string; canWrite: boolean }) {
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const shifts = useApRead<{ day: string; rows: ShiftRow[]; can_correct: boolean }>("ap_energy", "shifts", { day }, []);
  const alloc = useApRead<Allocation>("ap_energy", "allocation", { day }, []);
  const monthly = useApRead<Monthly>("ap_energy", "monthly", { month }, []);
  const reload = () => { void shifts.reload(); void alloc.reload(); void monthly.reload(); };
  return <div className="space-y-5">
    <Section title="Meter readings by shift" description="Two readings per press per shift. Missing readings leave the energy blank; nothing is estimated.">
      <label className="block text-sm font-semibold sm:w-56">Day<input type="date" className={`${inputClass} mt-1`} value={day} max={today} onChange={e => { if (e.target.value) setDay(e.target.value); }} /></label>
      {shifts.loading && !shifts.data ? <Loading what="shifts" /> : shifts.error ? <Failure text={shifts.error} /> : shifts.data ? shifts.data.rows.length
        ? <ul className="space-y-3">{shifts.data.rows.map(row => <ShiftCard key={`${row.machine_id}:${row.shift_name}:${shifts.data!.day}:${row.reading?.closing_kwh ?? ""}:${row.reading?.opening_kwh ?? ""}:${row.previous_closing?.kwh ?? ""}`} row={row} day={shifts.data!.day} canWrite={canWrite} canCorrect={shifts.data!.can_correct} onSaved={reload} />)}</ul>
        : <Empty>No active extrusion press is set up.</Empty> : null}
    </Section>
    <Section title={`Energy by job on ${fmtDay(day)}`} description="Each closed reading shared between the jobs that pressed in that shift, by running time.">
      {alloc.loading && !alloc.data ? <Loading what="the allocation" /> : alloc.error ? <Failure text={alloc.error} /> : alloc.data ? <>
        {!alloc.data.readings.length ? <Empty>No reading for this day.</Empty> : <ul className="space-y-3">{alloc.data.readings.map(r => <li key={r.id} className="rounded-xl border border-neutral-200 p-3 text-sm">
          <p className="font-bold">{r.machine_name} · {r.shift_name} · {r.kwh === null ? "closing reading pending" : `${n(r.kwh)} kWh`}</p>
          {r.kwh === null ? <p className="text-neutral-600">Energy is shown once the closing reading is entered.</p>
            : !r.jobs.length ? <p className="text-neutral-600">No billet was recorded on this press in the shift, so the energy is not allocated to a job.</p>
            : <ul className="mt-2 divide-y">{r.jobs.map(j => <li key={j.job_id} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span><b>{j.job_number ?? "Job"}</b> · {j.profile_code ?? "—"} · die {j.die_number ?? "—"} · {j.pushes} push(es) · {n(j.runtime_min)} min</span>
              <span className="tabular-nums">{n(j.kwh)} kWh · {j.kwh_per_kg === null ? "kWh/kg not known" : `${n(j.kwh_per_kg, 3)} kWh/kg pressed`}{j.estimated_pushes ? ` (${j.estimated_pushes} estimated billet weight)` : ""}</span></li>)}</ul>}
        </li>)}</ul>}
        <p className="text-xs text-neutral-500">{alloc.data.basis}</p>
      </> : null}
    </Section>
    <Section title="Month by press and die" description="From actual readings only. A press with missing readings shows what was captured and how many are still open.">
      <label className="block text-sm font-semibold sm:w-56">Month<input type="month" className={`${inputClass} mt-1`} value={month} max={today.slice(0, 7)} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></label>
      {monthly.loading && !monthly.data ? <Loading what="the month" /> : monthly.error ? <Failure text={monthly.error} /> : monthly.data ? <>
        <ul className="divide-y rounded-xl border">{monthly.data.presses.map(p => <li key={p.machine_id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
          <span><b>{p.machine_name}</b> · {p.readings_closed} closed reading(s){p.readings_open ? `, ${p.readings_open} open` : ""}</span>
          <span className="tabular-nums">{p.kwh === null ? "No reading" : `${n(p.kwh)} kWh`} · {p.kwh_per_kg === null ? "kWh/kg not known" : `${n(p.kwh_per_kg, 3)} kWh/kg pressed`}</span></li>)}</ul>
        {monthly.data.dies.length ? <><h3 className="text-sm font-bold">Dies using the most energy</h3><ul className="divide-y rounded-xl border">{monthly.data.dies.map(d => <li key={d.die_id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
          <span><b>{d.die_number}</b></span><span className="tabular-nums">{n(d.kwh)} kWh · {d.kwh_per_kg === null ? "kWh/kg not known" : `${n(d.kwh_per_kg, 3)} kWh/kg pressed`}</span></li>)}</ul></> : null}
      </> : null}
    </Section>
  </div>;
}

/** On the job record: energy allocated to this job from the shifts it pressed in. */
export function JobEnergyPanel({ jobId }: { jobId: string }) {
  const read = useApRead<{ shifts: { shift_day: string; shift_name: string; machine_name: string | null; kwh: number; billet_kg: number | null; pushes: number; runtime_min: number }[]; kwh: number | null; billet_kg: number | null; kwh_per_kg: number | null; shifts_without_reading?: number }>("ap_energy", "job", { job_id: jobId }, []);
  return <Section id="energy" title="Energy used" description="From the press meter readings of the shifts this job pressed in.">
    {read.loading && !read.data ? <Loading what="energy" /> : read.error ? <Failure text={read.error} /> : read.data ? read.data.shifts.length ? <>
      <p className="text-sm"><b>{n(read.data.kwh)} kWh</b> · {read.data.kwh_per_kg === null ? "kWh/kg not known" : `${n(read.data.kwh_per_kg, 3)} kWh per kg pressed`}</p>
      <ul className="divide-y text-sm">{read.data.shifts.map(s => <li key={`${s.shift_day}:${s.shift_name}`} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{fmtDay(s.shift_day)} · {s.shift_name} · {s.machine_name ?? "—"} · {s.pushes} push(es)</span><span className="tabular-nums">{n(s.kwh)} kWh</span></li>)}</ul>
      {read.data.shifts_without_reading ? <p className="text-xs text-amber-800">{read.data.shifts_without_reading} day(s) of this job have no closed meter reading; their energy is not included.</p> : null}
    </> : <Empty>{read.data.shifts_without_reading ? "This job pressed in shifts without a closed meter reading, so its energy is not known." : "No energy yet: the job has no recorded pushes in a shift with meter readings."}</Empty> : null}
  </Section>;
}
