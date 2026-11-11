"use client";

// AP-066 / AP-014 / AP-015 / AP-054 supervisor screen: plan vs actual per press for the current shift, the downtime
// report with idle gaps that still need a reason, die changes per press per week, preventive maintenance proposals,
// and the per-press idle threshold and die-change allowance.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { autopilotAction } from "@/lib/actions/autopilot";
import { IDLE_REASONS, formatMinutes, idleReasonLabel, type IdleReason } from "@/lib/press/press-floor";
import { fmtClock, fmtKg, fmtNum, fmtTime, type ShiftActual, type ShiftTarget } from "@/lib/press/types";
import { ProposalCards } from "@/components/modules/autopilot/proposal-cards";

type Press = { machine_id: string; name: string; running: { id: string; job_number: string | null }[] | null; target: ShiftTarget | null; actual: ShiftActual | null;
  last_push_at: string | null; idle_gap_minutes: number; today: { idle_minutes: number; explained_minutes: number }; unexplained_open: number; die_changes_week: { count: number; avg_minutes: number | null } };
type Floor = { now: string; shift: { code: string; starts_at: string; ends_at: string } | null; presses: Press[] };
type Downtime = { from: string; to: string; days: { day: string; machine: string; idle_minutes: number; explained_minutes: number; coverage_percent: number | null; by_reason: Record<string, number> }[];
  totals: { idle_minutes: number; explained_minutes: number; coverage_percent: number | null };
  unexplained: { total_count: number; page: number; rows: { id: string; machine: string; gap_start: string; gap_end: string | null; minutes: number; suggested_reason: string | null; job_number: string | null }[] } };
type DieChanges = { weeks: number; summary: { week: string; machine: string; count: number; avg_minutes: number | null }[]; total_count: number; page: number;
  rows: { id: string; machine: string; from_die: string | null; to_die: string | null; to_job: string | null; to_job_id: string; first_push_at: string; minutes: number; corrected_minutes: number | null; notes: { note: string; at: string; by: string | null }[] | null }[] };
type Settings = { presses: { machine_id: string; name: string; idle_gap_minutes: number; die_change_allowance_minutes: number; configured: boolean; measured_die_change_minutes: number | null }[]; can_edit: boolean };

const SUPERVISOR = ["owner", "admin", "factory_manager", "production_manager"];
const istDay = (offset = 0) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

function Pager({ page, total, onPage, label }: { page: number; total: number; onPage: (page: number) => void; label: string }) {
  const pages = Math.max(1, Math.ceil(total / 10));
  if (pages <= 1) return null;
  return <nav aria-label={label} className="flex items-center justify-between text-sm"><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Previous</button>
    <span>Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Next</button></nav>;
}

function PressCard({ press, now }: { press: Press; now: number }) {
  const t = press.target, a = press.actual;
  const idleFor = press.last_push_at && press.running?.length ? Math.floor((now - Date.parse(press.last_push_at)) / 60000) : null;
  const pct = (actual: number | undefined, target: number | null | undefined) => (target && actual !== undefined ? Math.round(actual * 100 / target) : null);
  return <li className="min-w-0 rounded-2xl border border-neutral-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-bold [overflow-wrap:anywhere]">{press.name}</p>
      {idleFor !== null && idleFor >= press.idle_gap_minutes ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">Idle {formatMinutes(idleFor)}</span>
        : press.running?.length ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800">Running</span> : <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-bold">No running job</span>}</div>
    <p className="mt-1 text-sm text-neutral-600">{press.running?.length ? press.running.map(job => <Link key={job.id} href={`/production/${job.id}`} className="mr-2 underline">{job.job_number}</Link>) : "—"}</p>
    {t && t.slots > 0 ? <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
      <div><dt className="text-xs text-neutral-500">Pushes (plan)</dt><dd className="font-black tabular-nums">{fmtNum(a?.pushes)} / {t.target_pushes ?? "—"}{pct(a?.pushes, t.target_pushes) !== null ? ` · ${pct(a?.pushes, t.target_pushes)}%` : ""}</dd></div>
      <div><dt className="text-xs text-neutral-500">Est. output (plan)</dt><dd className="font-black tabular-nums">{fmtKg(a?.estimated_output_kg, 0)} / {fmtKg(t.target_kg, 0)}{pct(a?.estimated_output_kg, t.target_kg) !== null ? ` · ${pct(a?.estimated_output_kg, t.target_kg)}%` : ""}</dd></div>
      <p className="col-span-2 text-xs text-neutral-600">Net of {t.maintenance_minutes} min maintenance and {t.die_changes} die change(s) at {fmtNum(t.die_change_allowance_minutes)} min.</p>
    </dl> : <p className="mt-3 text-sm text-neutral-600">No published plan this shift · {fmtNum(a?.pushes)} pushes</p>}
    <p className="mt-2 text-xs text-neutral-600">Today idle {formatMinutes(press.today.idle_minutes)}, explained {formatMinutes(press.today.explained_minutes)} · {press.unexplained_open} gap(s) without a reason · {press.die_changes_week.count} die change(s) this week{press.die_changes_week.avg_minutes !== null ? `, avg ${press.die_changes_week.avg_minutes} min` : ""}</p>
  </li>;
}

export function FloorClient({ role, today }: { role: string; today: string }) {
  const supervisor = SUPERVISOR.includes(role);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [downtime, setDowntime] = useState<Downtime | null>(null);
  const [changes, setChanges] = useState<DieChanges | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [range, setRange] = useState({ from: istDay(-6), to: istDay(0) });
  const [gapPage, setGapPage] = useState(1);
  const [changePage, setChangePage] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; minutes: string; note: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, { idle: string; allowance: string }>>({});

  const read = useCallback(async <T,>(command: string, payload: object, set: (value: T) => void, key: string) => {
    const result = await autopilotAction("ap_press", command, payload);
    if (!result.success) { setErrors(previous => ({ ...previous, [key]: result.error })); return; }
    setErrors(previous => { const next = { ...previous }; delete next[key]; return next; }); set(result.data as T);
  }, []);
  const loadFloor = useCallback(() => read<Floor>("floor", {}, setFloor, "floor"), [read]);
  const loadDowntime = useCallback(() => read<Downtime>("downtime", { ...range, page: gapPage }, setDowntime, "downtime"), [read, range, gapPage]);
  const loadChanges = useCallback(() => read<DieChanges>("die_changes", { page: changePage }, setChanges, "changes"), [read, changePage]);
  const loadSettings = useCallback(() => read<Settings>("settings", {}, setSettings, "settings"), [read]);
  useEffect(() => { void loadFloor(); const poll = setInterval(() => { void loadFloor(); }, 30000); return () => clearInterval(poll); }, [loadFloor]);
  useEffect(() => { void loadDowntime(); }, [loadDowntime]);
  useEffect(() => { void loadChanges(); }, [loadChanges]);
  useEffect(() => { void loadSettings(); }, [loadSettings]);

  async function answer(id: string, reason: IdleReason) {
    const result = await autopilotAction("ap_press", "idle_answer", { interval_id: id, reason, ...(reason === "other" ? { note: "Recorded by supervisor" } : {}) });
    setMessage(result.success ? "Reason recorded." : result.error);
    await Promise.all([loadDowntime(), loadFloor()]);
  }
  async function correct() {
    if (!noteFor) return;
    const minutes = noteFor.minutes.trim() === "" ? undefined : Number(noteFor.minutes);
    const result = await autopilotAction("ap_press", "die_change_correct", { id: noteFor.id, note: noteFor.note.trim(), ...(minutes !== undefined && Number.isFinite(minutes) ? { duration_minutes: minutes } : {}) });
    setMessage(result.success ? "Saved on the die change." : result.error);
    if (result.success) setNoteFor(null);
    await loadChanges();
  }
  async function saveSetting(machineId: string) {
    const edit = edits[machineId]; if (!edit) return;
    const result = await autopilotAction("ap_press", "settings_save", { machine_id: machineId, idle_gap_minutes: Number(edit.idle), die_change_allowance_minutes: Number(edit.allowance) });
    setMessage(result.success ? "Press setting saved." : result.error);
    await loadSettings();
  }
  const chips = [{ label: "Today", from: istDay(0), to: istDay(0) }, { label: "Yesterday", from: istDay(-1), to: istDay(-1) }, { label: "Last 7 days", from: istDay(-6), to: istDay(0) }, { label: "Last 30 days", from: istDay(-29), to: istDay(0) }];

  return <div className="min-w-0 space-y-6">
    {message ? <p role="status" className="rounded-xl bg-neutral-100 p-3 text-sm font-semibold">{message}</p> : null}
    <section aria-labelledby="plan-actual" className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="plan-actual" className="text-lg font-bold">Plan vs actual {floor?.shift ? `· shift ${floor.shift.code}` : ""}</h2>
        {floor?.shift ? <p className="text-sm text-neutral-600">{fmtClock(floor.shift.starts_at)}–{fmtClock(floor.shift.ends_at)} · refreshes every 30 s</p> : null}</div>
      {errors.floor ? <p role="alert" className="text-sm text-amber-900">{errors.floor}</p> : !floor ? <p role="status" className="text-sm">Loading presses…</p>
        : !floor.presses.length ? <p className="rounded-xl border border-dashed p-3 text-sm text-neutral-600">No active extrusion press is set up.</p>
        : <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{floor.presses.map(press => <PressCard key={press.machine_id} press={press} now={Date.parse(floor.now)} />)}</ul>}
    </section>

    <section aria-labelledby="downtime" className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <div><h2 id="downtime" className="text-lg font-bold">Downtime report</h2>
        <p className="text-sm text-neutral-600">Idle time is the gap between pushes longer than the press threshold. Reasons come from the operator or a supervisor; the system never chooses one.</p></div>
      <div role="group" aria-label="Date range" className="flex flex-wrap gap-2">{chips.map(chip => <button key={chip.label} type="button" aria-pressed={range.from === chip.from && range.to === chip.to}
        onClick={() => { setRange({ from: chip.from, to: chip.to }); setGapPage(1); }} className={`min-h-10 rounded-full border px-3 text-sm font-semibold ${range.from === chip.from && range.to === chip.to ? "border-neutral-950 bg-neutral-950 text-white" : "bg-white"}`}>{chip.label}</button>)}</div>
      {errors.downtime ? <p role="alert" className="text-sm text-amber-900">{errors.downtime}</p> : !downtime ? <p role="status" className="text-sm">Loading downtime…</p> : <>
        <p className="text-sm"><strong>{formatMinutes(downtime.totals.idle_minutes)}</strong> idle, <strong>{formatMinutes(downtime.totals.explained_minutes)}</strong> with a reason
          {downtime.totals.coverage_percent !== null ? <> · <strong className={downtime.totals.coverage_percent >= 90 ? "text-emerald-700" : "text-amber-800"}>{downtime.totals.coverage_percent}% explained</strong> (target 90%)</> : null}</p>
        {downtime.days.length ? <div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-sm"><thead><tr className="text-left text-xs uppercase text-neutral-500"><th className="py-1">Day</th><th>Press</th><th className="text-right">Idle</th><th className="text-right">Explained</th><th>Reasons</th></tr></thead>
          <tbody className="divide-y">{downtime.days.slice(0, 10).map(row => <tr key={`${row.day}:${row.machine}`}><td className="py-1.5">{row.day}</td><td>{row.machine}</td><td className="text-right tabular-nums">{formatMinutes(row.idle_minutes)}</td>
            <td className="text-right tabular-nums">{row.coverage_percent ?? "—"}%</td><td className="text-xs">{Object.entries(row.by_reason).map(([reason, minutes]) => `${idleReasonLabel(reason)} ${formatMinutes(minutes)}`).join(", ") || "—"}</td></tr>)}</tbody></table></div>
          : <p className="rounded-xl border border-dashed p-3 text-sm text-neutral-600">No idle gaps in this range.</p>}
        <h3 className="pt-2 font-bold">Gaps without a reason ({downtime.unexplained.total_count})</h3>
        {downtime.unexplained.rows.length ? <ul className="space-y-2">{downtime.unexplained.rows.map(gap => <li key={gap.id} className="rounded-xl border p-3 text-sm">
          <p className="font-semibold">{gap.machine} · {fmtTime(gap.gap_start)} for {formatMinutes(gap.minutes)}{gap.job_number ? ` · ${gap.job_number}` : ""}{gap.gap_end ? "" : " · still idle"}</p>
          {gap.suggested_reason ? <p className="text-xs text-neutral-600">A die change was recorded at this gap; confirm it if that is the reason.</p> : null}
          {supervisor ? <div className="mt-2 flex flex-wrap gap-2">{IDLE_REASONS.filter(reason => reason.value !== "other").map(reason => <button key={reason.value} type="button" onClick={() => answer(gap.id, reason.value)}
            className={`min-h-10 rounded-lg border px-3 text-xs font-bold ${gap.suggested_reason === reason.value ? "border-neutral-950" : ""}`}>{reason.label}</button>)}</div> : null}
        </li>)}</ul> : <p className="text-sm text-neutral-600">Every gap in this range has a reason.</p>}
        <Pager page={gapPage} total={downtime.unexplained.total_count} onPage={setGapPage} label="Unexplained gap pages" />
      </>}
    </section>

    <section aria-labelledby="die-changes" className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <div><h2 id="die-changes" className="text-lg font-bold">Die changes</h2><p className="text-sm text-neutral-600">Derived when a press starts a job with a different die: from the last push of the old die to the first push of the new one. Corrections are added, never overwritten.</p></div>
      {errors.changes ? <p role="alert" className="text-sm text-amber-900">{errors.changes}</p> : !changes ? <p role="status" className="text-sm">Loading die changes…</p> : <>
        {changes.summary.length ? <div className="overflow-x-auto"><table className="w-full min-w-[24rem] text-sm"><caption className="mb-1 text-left text-xs text-neutral-600">Per press per week (last {changes.weeks} weeks)</caption>
          <thead><tr className="text-left text-xs uppercase text-neutral-500"><th>Week of</th><th>Press</th><th className="text-right">Changes</th><th className="text-right">Average</th></tr></thead>
          <tbody className="divide-y">{changes.summary.slice(0, 10).map(row => <tr key={`${row.week}:${row.machine}`}><td className="py-1.5">{row.week}</td><td>{row.machine}</td><td className="text-right">{row.count}</td><td className="text-right">{row.avg_minutes ?? "—"} min</td></tr>)}</tbody></table></div>
          : <p className="rounded-xl border border-dashed p-3 text-sm text-neutral-600">No die changes recorded yet.</p>}
        {changes.rows.length ? <ul className="space-y-2">{changes.rows.map(row => <li key={row.id} className="rounded-xl border p-3 text-sm">
          <p className="font-semibold">{row.machine} · {row.from_die ?? "—"} → {row.to_die ?? "—"} · {row.corrected_minutes ?? row.minutes} min{row.corrected_minutes !== null ? ` (corrected from ${row.minutes})` : ""}</p>
          <p className="text-xs text-neutral-600">{fmtTime(row.first_push_at)} · <Link href={`/production/${row.to_job_id}`} className="underline">{row.to_job}</Link></p>
          {row.notes?.length ? <ul className="mt-1 list-disc pl-5 text-xs">{row.notes.map((n, i) => <li key={i}>{n.note} · {n.by ?? "—"}</li>)}</ul> : null}
          {noteFor?.id === row.id ? <div className="mt-2 flex flex-wrap items-end gap-2">
            {supervisor ? <label className="block w-32 font-semibold">Minutes<input inputMode="decimal" className="mt-1 h-10 w-full rounded-lg border px-2" value={noteFor.minutes} onChange={event => setNoteFor({ ...noteFor, minutes: event.target.value.replace(/[^0-9.]/g, "") })} /></label> : null}
            <label className="block min-w-0 flex-1 font-semibold">Note<input className="mt-1 h-10 w-full rounded-lg border px-2" value={noteFor.note} maxLength={300} onChange={event => setNoteFor({ ...noteFor, note: event.target.value })} /></label>
            <button type="button" disabled={noteFor.note.trim().length < 3} onClick={correct} className="min-h-10 rounded-lg bg-neutral-950 px-3 font-bold text-white disabled:opacity-50">Save</button></div>
            : <button type="button" onClick={() => setNoteFor({ id: row.id, minutes: "", note: "" })} className="mt-2 min-h-9 rounded-lg border px-3 text-xs font-bold">{supervisor ? "Correct or add note" : "Add note"}</button>}
        </li>)}</ul> : null}
        <Pager page={changePage} total={changes.total_count} onPage={setChangePage} label="Die change pages" />
      </>}
    </section>

    <ProposalCards type="maintenance.pm_due" initial={null} today={today} onDecided={() => { void loadFloor(); }} title="Preventive maintenance due" description="Proposed from press running hours and pushes. Accepting books the window and blocks press capacity; safety-critical tasks can only be dismissed by a supervisor." emptyText="No maintenance is due." />

    <section aria-labelledby="press-settings" className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <h2 id="press-settings" className="text-lg font-bold">Press settings</h2>
      {errors.settings ? <p role="alert" className="text-sm text-amber-900">{errors.settings}</p> : !settings ? <p role="status" className="text-sm">Loading…</p> : !settings.presses.length ? <p className="text-sm text-neutral-600">No active press.</p>
        : <ul className="space-y-2">{settings.presses.map(press => { const edit = edits[press.machine_id] ?? { idle: String(press.idle_gap_minutes), allowance: String(press.die_change_allowance_minutes) };
          return <li key={press.machine_id} className="flex flex-wrap items-end gap-3 rounded-xl border p-3 text-sm">
            <p className="w-full font-semibold sm:w-auto sm:flex-1">{press.name}{press.configured ? "" : " (defaults)"}{press.measured_die_change_minutes !== null ? ` · measured die change ${press.measured_die_change_minutes} min` : ""}</p>
            <label className="block w-36 font-semibold">Idle after (min)<input inputMode="numeric" disabled={!settings.can_edit} className="mt-1 h-10 w-full rounded-lg border px-2" value={edit.idle} onChange={event => setEdits(e => ({ ...e, [press.machine_id]: { ...edit, idle: event.target.value.replace(/\D/g, "") } }))} /></label>
            <label className="block w-44 font-semibold">Die change allowance (min)<input inputMode="numeric" disabled={!settings.can_edit} className="mt-1 h-10 w-full rounded-lg border px-2" value={edit.allowance} onChange={event => setEdits(e => ({ ...e, [press.machine_id]: { ...edit, allowance: event.target.value.replace(/\D/g, "") } }))} /></label>
            {settings.can_edit ? <button type="button" onClick={() => saveSetting(press.machine_id)} className="min-h-10 rounded-lg bg-neutral-950 px-3 font-bold text-white">Save</button> : null}
          </li>; })}</ul>}
      <p className="text-xs text-neutral-600">The measured average die change (three or more in eight weeks) replaces the allowance in shift targets.</p>
    </section>
  </div>;
}
