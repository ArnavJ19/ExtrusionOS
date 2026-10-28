"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { turnaroundAction } from "@/lib/actions/turnaround";
import { formatDate } from "@/lib/utils/format";
import { ESCALATION_ROLES, WAIT_REASONS, formatMinutes, headlineState, taskKindLabel, type TurnaroundStatus, type WaitReason } from "@/lib/workflow/turnaround";

const chipTone = { breached: "bg-red-100 text-red-800", missed: "bg-red-50 text-red-700", due_soon: "bg-amber-100 text-amber-900", on_track: "bg-emerald-100 text-emerald-800", met: "bg-emerald-50 text-emerald-700", none: "bg-slate-100 text-slate-600" } as const;
const chipText = { breached: "Over target", missed: "Finished late", due_soon: "Near target", on_track: "Within target", met: "Met target", none: "No target" } as const;

/** One-line turnaround state for queue rows. */
export function TurnaroundChip({ status }: { status: TurnaroundStatus }) {
  const headline = headlineState(status);
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-black ${chipTone[headline]}`} title={status.has_target ? `Active ${formatMinutes(status.active_minutes)} of ${formatMinutes(status.completion_minutes_target)}; elapsed ${formatMinutes(status.elapsed_minutes)}` : `Elapsed ${formatMinutes(status.elapsed_minutes)}`}>
      {chipText[headline]}{status.open_wait ? " · waiting" : ""}
    </span>
  );
}

// UPGRADE_EOS feature 71: a task's targets, its active and total time, and recorded waiting.
export function TaskTurnaroundPanel({ initial, canRecordWait }: { initial: TurnaroundStatus; canRecordWait: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [form, setForm] = useState({ reason: "waiting_material" as WaitReason, note: "" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(command: "wait.start" | "wait.end") {
    setBusy(true); setError("");
    const result = command === "wait.start"
      ? await turnaroundAction({ command, task_id: status.task_id, reason: form.reason, note: form.note })
      : await turnaroundAction({ command, task_id: status.task_id });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setStatus(result.data as TurnaroundStatus); setOpen(false); setForm({ ...form, note: "" });
    router.refresh();
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900">Turnaround</h3>
        <TurnaroundChip status={status} />
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="inline font-bold">Total elapsed: </dt><dd className="inline">{formatMinutes(status.elapsed_minutes)}</dd></div>
        {status.has_target ? (
          <>
            <div><dt className="inline font-bold">Active working time: </dt><dd className="inline">{formatMinutes(status.active_minutes)} of {formatMinutes(status.completion_minutes_target)} ({status.calendar === "24x7" ? "round the clock" : "Mon–Sat 08:00–20:00"})</dd></div>
            <div><dt className="inline font-bold">Recorded waiting: </dt><dd className="inline">{formatMinutes(status.waiting_minutes)}</dd></div>
            <div><dt className="inline font-bold">Start target: </dt><dd className="inline">{status.response_minutes_target === null ? "none" : `${formatMinutes(status.response_minutes_target)} · ${chipText[status.response_state]}`}</dd></div>
            <div><dt className="inline font-bold">Escalates to: </dt><dd className="inline">{status.escalation_role.replace(/_/g, " ")}</dd></div>
          </>
        ) : <div className="text-slate-500">{taskKindLabel(status.task_kind)} have no agreed target.</div>}
      </dl>
      <p className="mt-2 text-xs text-slate-500">Waiting pauses the target clock only; total elapsed time is never reduced.</p>
      {status.open_wait ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-bold">{WAIT_REASONS[status.open_wait.reason as WaitReason] ?? status.open_wait.reason} since {formatDate(status.open_wait.since)}</p>
          <p>{status.open_wait.note}</p>
          {canRecordWait ? <Button type="button" className="mt-2" variant="secondary" disabled={busy} onClick={() => void run("wait.end")}>{busy ? "Saving…" : "Waiting is over"}</Button> : null}
        </div>
      ) : canRecordWait ? (
        open ? (
          <form className="mt-3 grid gap-2 sm:grid-cols-[200px_1fr_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); void run("wait.start"); }}>
            <label className="space-y-1"><span className="form-label">Waiting for</span>
              <select className="form-input" value={form.reason} disabled={busy} onChange={(event) => setForm({ ...form, reason: event.target.value as WaitReason })}>
                {Object.entries(WAIT_REASONS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className="form-label">Details</span>
              <input className="form-input" maxLength={300} value={form.note} disabled={busy} placeholder="e.g. Billet batch FB-22 expected Friday" onChange={(event) => setForm({ ...form, note: event.target.value })} />
            </label>
            <Button type="submit" disabled={busy || form.note.trim().length < 3}>{busy ? "Saving…" : "Record waiting"}</Button>
          </form>
        ) : <button type="button" className="mt-3 text-xs font-bold text-slate-700 underline" onClick={() => setOpen(true)}>Record that this work is waiting</button>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
    </section>
  );
}

type Target = { task_kind: string; response_minutes: number | null; completion_minutes: number; calendar: "24x7" | "day_shift"; escalation_role: string; is_active: boolean };

/** Managers add or change a target; values are entered in hours for readability. */
export function TargetEditor({ existing }: { existing: Target[] }) {
  const router = useRouter();
  const blank = { task_kind: "handoff:packaging", response_hours: "", completion_hours: "4", calendar: "day_shift" as Target["calendar"], escalation_role: "factory_manager", is_active: true };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const toMinutes = (hours: string) => Math.round(Number(hours) * 60);

  function load(target: Target) {
    setForm({ task_kind: target.task_kind, response_hours: target.response_minutes === null ? "" : String(target.response_minutes / 60), completion_hours: String(target.completion_minutes / 60), calendar: target.calendar, escalation_role: target.escalation_role, is_active: target.is_active });
  }

  async function save() {
    setBusy(true); setMessage("");
    const result = await turnaroundAction({
      command: "targets.set", task_kind: form.task_kind.trim(), response_minutes: form.response_hours === "" ? null : toMinutes(form.response_hours),
      completion_minutes: toMinutes(form.completion_hours), calendar: form.calendar, escalation_role: form.escalation_role, is_active: form.is_active
    });
    setBusy(false);
    setMessage(result.success ? "Target saved." : result.error);
    if (result.success) router.refresh();
  }

  return (
    <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-bold text-slate-900">Set a target</h2>
      {existing.length ? (
        <div className="flex flex-wrap gap-2">{existing.map((target) => <button key={target.task_kind} type="button" className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold" onClick={() => load(target)}>Edit {taskKindLabel(target.task_kind).toLowerCase()}</button>)}</div>
      ) : null}
      <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="space-y-1"><span className="form-label">Task kind</span>
          <input className="form-input" list="task-kinds" value={form.task_kind} disabled={busy} onChange={(event) => setForm({ ...form, task_kind: event.target.value })} />
          <datalist id="task-kinds">{["handoff:packaging", "handoff:quality", "handoff:dispatch", "handoff_return", "type:general", "type:maintenance"].map((kind) => <option key={kind} value={kind} />)}</datalist>
        </label>
        <label className="space-y-1"><span className="form-label">Start within (hours, optional)</span>
          <input className="form-input" inputMode="decimal" value={form.response_hours} disabled={busy} onChange={(event) => setForm({ ...form, response_hours: event.target.value })} />
        </label>
        <label className="space-y-1"><span className="form-label">Complete within (hours)</span>
          <input className="form-input" inputMode="decimal" value={form.completion_hours} disabled={busy} onChange={(event) => setForm({ ...form, completion_hours: event.target.value })} />
        </label>
        <label className="space-y-1"><span className="form-label">Working time</span>
          <select className="form-input" value={form.calendar} disabled={busy} onChange={(event) => setForm({ ...form, calendar: event.target.value as Target["calendar"] })}>
            <option value="day_shift">Mon–Sat 08:00–20:00 IST</option><option value="24x7">Round the clock</option>
          </select>
        </label>
        <label className="space-y-1"><span className="form-label">Escalate to</span>
          <select className="form-input" value={form.escalation_role} disabled={busy} onChange={(event) => setForm({ ...form, escalation_role: event.target.value })}>
            {ESCALATION_ROLES.map((role) => <option key={role} value={role}>{role.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm font-semibold"><input type="checkbox" checked={form.is_active} disabled={busy} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Active</label>
        <div className="md:col-span-3"><Button type="submit" disabled={busy || !form.completion_hours}>{busy ? "Saving…" : "Save target"}</Button></div>
      </form>
      {message ? <p role="status" className="text-sm font-semibold text-slate-700">{message}</p> : null}
    </section>
  );
}

export function RunEscalations() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run() {
    setBusy(true); setMessage("");
    const result = await turnaroundAction({ command: "escalations.run" });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    const data = result.data as { raised: number; resolved: number };
    setMessage(`${data.raised} new escalation${data.raised === 1 ? "" : "s"} raised, ${data.resolved} resolved.`);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void run()}>{busy ? "Checking…" : "Check for overdue work now"}</Button>
      {message ? <span role="status" className="text-sm font-semibold text-slate-700">{message}</span> : null}
    </div>
  );
}
