"use client";

// AP-022: who is working which press, from sign-ins at the press station. The operator signs in once at the start of
// the shift; a supervisor can add crew who have no device. Crew per shift and per job is derived from the sign-ins.
// This is press assignment, not an attendance or payroll record.
import { useState } from "react";
import { CREW_WORK, type CrewWork } from "@/lib/autopilot-batch10/commands";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Member = { id: string; user_id: string; name: string; crew_role: CrewWork; method: string; signed_in_at: string; competent: boolean | null };
type Station = { machine_id: string; can_lead: boolean; mine: { id: string; machine_id: string; machine_name: string; crew_role: CrewWork; signed_in_at: string } | null; crew: Member[]; competency_required: boolean };
type ShiftCrew = { user_id: string; name: string; crew_role: CrewWork; method: string; minutes: number; competent: boolean | null };
type ShiftRow = { machine_id: string; machine_name: string; shift_name: string; crew: ShiftCrew[]; pushes: number; billet_kg: number | null; jobs: { job_id: string; job_number: string | null }[] };
const NOT_ATTENDANCE = "Press assignment only. This is not an attendance or payroll record.";
const kg = (v: unknown) => (v === null || v === undefined ? "weight not known" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg pressed`);
const hours = (minutes: number) => `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
const Flag = ({ value }: { value: boolean | null }) => value === false ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">No current competency to start production</span> : null;

/** At the press station: sign in, see the crew, sign out; a supervisor adds or removes crew. */
export function StationCrew({ machineId, machineName }: { machineId: string; machineName?: string }) {
  const read = useApRead<Station>("ap_crew", "station", { machine_id: machineId }, []);
  const [work, setWork] = useState<CrewWork>("operator"); const [note, setNote] = useState<Note>(null);
  const [search, setSearch] = useState(""); const [adding, setAdding] = useState(false); const [addWork, setAddWork] = useState<CrewWork>("helper");
  const people = useApRead<{ rows: { id: string; name: string; role: string; on_press: string | null }[] }>("ap_crew", "people", { search }, [adding]);
  const s = read.data;
  const mineHere = s?.mine?.machine_id === machineId;
  async function act(command: string, payload: Record<string, unknown>, ok: string) { if (await apWrite("ap_crew", command, payload, setNote, ok)) { await read.reload(); if (adding) await people.reload(); } }
  return <Section id="crew" title={`Crew on ${machineName ?? "this press"}`} description={NOT_ATTENDANCE}>
    {read.loading && !s ? <Loading what="the crew" /> : read.error ? <Failure text={read.error} /> : s ? <>
      {mineHere ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
        <span>You are signed in as <b>{CREW_WORK[s.mine!.crew_role]}</b> since {fmtWhen(s.mine!.signed_in_at)}.</span>
        <button type="button" className={secondaryClass} onClick={() => act("sign_out", {}, "Signed out of the press.")}>Sign out</button></div>
        : <div className="space-y-2 rounded-xl bg-neutral-50 p-3">
          {s.mine ? <p className="text-sm text-amber-900">You are signed in on {s.mine.machine_name}. Signing in here ends that assignment now.</p> : null}
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><label className="block text-sm font-semibold">My work on this press<select className={`${inputClass} mt-1`} value={work} onChange={e => setWork(e.target.value as CrewWork)}>
            {Object.entries(CREW_WORK).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <div className="flex items-end"><button type="button" className={buttonClass} onClick={() => act("sign_in", { machine_id: machineId, crew_role: work }, "Signed in to the press.")}>Sign in</button></div></div></div>}
      {s.crew.length ? <ul className="divide-y rounded-xl border">{s.crew.map(m => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span><b>{m.name}</b> · {CREW_WORK[m.crew_role]} · since {fmtWhen(m.signed_in_at)}{m.method === "supervisor" ? " · added by supervisor" : ""}<Flag value={m.competent} /></span>
        {s.can_lead ? <button type="button" className="min-h-11 text-sm font-bold underline" onClick={() => act("sign_out", { id: m.id }, `${m.name} signed out.`)}>Sign out</button> : null}</li>)}</ul>
        : <Empty>Nobody is signed in on this press.</Empty>}
      {s.can_lead ? adding ? <div className="space-y-2 rounded-xl border border-neutral-200 p-3">
        <div className="grid gap-2 sm:grid-cols-2"><label className="block text-sm font-semibold">Find employee<input type="search" className={`${inputClass} mt-1`} value={search} maxLength={80} onChange={e => setSearch(e.target.value)} /></label>
          <label className="block text-sm font-semibold">Work<select className={`${inputClass} mt-1`} value={addWork} onChange={e => setAddWork(e.target.value as CrewWork)}>{Object.entries(CREW_WORK).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        {people.loading && !people.data ? <Loading what="employees" /> : people.error ? <Failure text={people.error} /> : people.data?.rows.length ? <ul className="divide-y">{people.data.rows.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <span>{p.name} · {p.role.replaceAll("_", " ")}{p.on_press ? ` · now on ${p.on_press}` : ""}</span>
          <button type="button" className={secondaryClass} onClick={() => act("add", { machine_id: machineId, user_id: p.id, crew_role: addWork }, `${p.name} added to the press.`)}>Add</button></li>)}</ul> : <Empty>No matching employee.</Empty>}
        <button type="button" className="min-h-11 text-sm font-bold underline" onClick={() => setAdding(false)}>Close</button></div>
        : <button type="button" className={secondaryClass} onClick={() => setAdding(true)}>Add crew member</button> : null}
      <Message value={note} />
    </> : null}
  </Section>;
}

/** Crew and output per press per shift for a day. */
export function CrewShiftReport({ today }: { today: string }) {
  const [day, setDay] = useState(today);
  const read = useApRead<{ day: string; rows: ShiftRow[]; label: string }>("ap_crew", "shift", { day }, []);
  return <Section title="Crew and output by shift" description={NOT_ATTENDANCE}>
    <label className="block text-sm font-semibold sm:w-56">Day<input type="date" className={`${inputClass} mt-1`} value={day} max={today} onChange={e => { if (e.target.value) setDay(e.target.value); }} /></label>
    {read.loading && !read.data ? <Loading what="shifts" /> : read.error ? <Failure text={read.error} /> : read.data ? read.data.rows.length ? <ul className="space-y-3">{read.data.rows.map(r => <li key={`${r.machine_id}:${r.shift_name}`} className="rounded-xl border border-neutral-200 p-3 text-sm">
      <p className="font-bold">{r.machine_name} · {r.shift_name} · {fmtDay(read.data!.day)}</p>
      <p className="text-neutral-700">{r.pushes} push(es) · {r.pushes ? kg(r.billet_kg) : "no output recorded"}{r.jobs.length ? ` · ${r.jobs.map(j => j.job_number ?? "job").join(", ")}` : ""}</p>
      {r.crew.length ? <ul className="mt-2 divide-y">{r.crew.map(m => <li key={`${m.user_id}:${m.crew_role}`} className="py-1.5">{m.name} · {CREW_WORK[m.crew_role]} · {hours(m.minutes)}<Flag value={m.competent} /></li>)}</ul>
        : <p className="mt-1 text-neutral-500">No one signed in on this press in the shift.</p>}
    </li>)}</ul> : <Empty>No active extrusion press is set up.</Empty> : null}
  </Section>;
}

/** On the job record: the crew signed in on the press while the job was pressed. */
export function JobCrewPanel({ jobId }: { jobId: string }) {
  const read = useApRead<{ crew: (ShiftCrew & { machine_name: string | null })[]; from: string | null; to: string | null }>("ap_crew", "job", { job_id: jobId }, []);
  return <Section id="crew" title="Press crew" description={NOT_ATTENDANCE}>
    {read.loading && !read.data ? <Loading what="the crew" /> : read.error ? <Failure text={read.error} /> : read.data ? read.data.from === null ? <Empty>The crew is shown once the job has recorded pushes.</Empty>
      : read.data.crew.length ? <ul className="divide-y text-sm">{read.data.crew.map(m => <li key={`${m.user_id}:${m.crew_role}`} className="py-1.5">{m.name} · {CREW_WORK[m.crew_role]} · {m.machine_name ?? "—"} · {hours(Math.max(m.minutes, 0))}<Flag value={m.competent} /></li>)}</ul>
      : <Empty>No one was signed in on the press while this job was pressed ({fmtWhen(read.data.from)} to {fmtWhen(read.data.to)}).</Empty> : null}
  </Section>;
}
