"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { taskDelegationAction } from "@/lib/actions/task-delegation";
import { formatDate } from "@/lib/utils/format";
import { canDelegateBetween } from "@/lib/workflow/task-delegation";

type Employee = { id: string; name: string; role: string };
type Candidate = { id: string; title: string; status: string; due_date: string | null; handoff_team: string | null; held: boolean };

/** Converts an IST `datetime-local` entry to an ISO instant (India has no daylight saving). */
function istToIso(value: string) {
  const ms = Date.parse(`${value}:00+05:30`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// UPGRADE_EOS feature 35: a supervisor covers an absent employee's work for a period.
export function NewDelegationForm({ employees, supervisorRole }: { employees: Employee[]; supervisorRole: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ delegator_id: "", delegate_id: "", ends_at: "", starts_at: "", scope: "all_open" as "all_open" | "selected", reason: "" });
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const requestId = useRef<string | null>(null);
  const delegator = employees.find((employee) => employee.id === form.delegator_id);
  const replacements = employees.filter((employee) => employee.id !== form.delegator_id && (!delegator || canDelegateBetween(supervisorRole, delegator.role, employee.role)));

  async function loadCandidates(delegatorId: string) {
    setCandidates(null); setChosen([]);
    if (!delegatorId) return;
    const result = await taskDelegationAction({ command: "delegation.candidates", delegator_id: delegatorId });
    if (result.success) setCandidates(result.data as Candidate[]);
    else setMessage(result.error);
  }

  async function submit() {
    const ends = istToIso(form.ends_at);
    const starts = form.starts_at ? istToIso(form.starts_at) : null;
    if (!ends || (form.starts_at && !starts)) { setMessage("Choose valid dates and times (IST)"); return; }
    requestId.current ??= crypto.randomUUID();
    setBusy(true); setMessage("");
    const result = await taskDelegationAction({
      command: "delegation.create", request_id: requestId.current, delegator_id: form.delegator_id, delegate_id: form.delegate_id,
      ends_at: ends, ...(starts ? { starts_at: starts } : {}), scope: form.scope, ...(form.scope === "selected" ? { task_ids: chosen } : {}), reason: form.reason
    });
    setBusy(false);
    if (!result.success) { setMessage(result.error); setUncertain(result.uncertain === true); if (!result.uncertain) requestId.current = null; return; }
    const data = result.data as { id: string; moved: number; scheduled?: boolean };
    requestId.current = null; setUncertain(false);
    setMessage(data.scheduled ? "Delegation scheduled. Tasks move when it starts." : `${data.moved} task${data.moved === 1 ? "" : "s"} delegated.`);
    router.push(`/tasks/delegations/${data.id}`);
  }

  const locked = busy || uncertain;
  return (
    <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-bold text-slate-900">Cover an absent employee</h2>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="space-y-1"><span className="form-label">Employee who is away</span>
          <select className="form-input" value={form.delegator_id} disabled={locked} onChange={(event) => { setForm({ ...form, delegator_id: event.target.value, delegate_id: "" }); void loadCandidates(event.target.value); }}>
            <option value="">Choose</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.role.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="form-label">Replacement</span>
          <select className="form-input" value={form.delegate_id} disabled={locked || !form.delegator_id} onChange={(event) => setForm({ ...form, delegate_id: event.target.value })}>
            <option value="">Choose</option>
            {replacements.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.role.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="form-label">Starts (IST, empty = now)</span>
          <input type="datetime-local" className="form-input" value={form.starts_at} disabled={locked || form.scope === "selected"} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} />
        </label>
        <label className="space-y-1"><span className="form-label">Ends (IST)</span>
          <input type="datetime-local" className="form-input" required value={form.ends_at} disabled={locked} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} />
        </label>
        <fieldset className="space-y-1 md:col-span-2">
          <legend className="form-label">Which work</legend>
          <label className="mr-4 text-sm font-semibold"><input type="radio" checked={form.scope === "all_open"} disabled={locked} onChange={() => setForm({ ...form, scope: "all_open" })} /> All open tasks, and any assigned during the period</label>
          <label className="text-sm font-semibold"><input type="radio" checked={form.scope === "selected"} disabled={locked} onChange={() => setForm({ ...form, scope: "selected", starts_at: "" })} /> Only the tasks I choose (from now)</label>
        </fieldset>
        {form.scope === "selected" ? (
          <div className="md:col-span-2">
            {!candidates ? <p className="text-sm text-slate-500">Choose the employee first.</p> : candidates.length ? (
              <ul className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 text-sm">
                {candidates.map((task) => (
                  <li key={task.id}><label className="flex items-center gap-2">
                    <input type="checkbox" disabled={locked || task.held} checked={chosen.includes(task.id)} onChange={() => setChosen(chosen.includes(task.id) ? chosen.filter((id) => id !== task.id) : [...chosen, task.id])} />
                    <span>{task.title}</span><span className="text-xs text-slate-500">{task.status.replace(/_/g, " ")}{task.due_date ? ` · due ${formatDate(task.due_date)}` : ""}{task.handoff_team ? ` · ${task.handoff_team} handoff` : ""}{task.held ? " · already delegated" : ""}</span>
                  </label></li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">This employee has no open tasks.</p>}
          </div>
        ) : null}
        <label className="space-y-1 md:col-span-2"><span className="form-label">Reason (recorded)</span>
          <input className="form-input" maxLength={300} value={form.reason} disabled={locked} placeholder="e.g. Annual leave 23–27 Oct" onChange={(event) => setForm({ ...form, reason: event.target.value })} />
        </label>
        <div className="md:col-span-2">
          <p className="mb-2 text-xs text-slate-500">Only task assignment moves; nobody gains new permissions. Tasks the replacement is not eligible for (for example another team&apos;s handoffs) stay where they are. Unfinished work returns to the owner when the period ends.</p>
          <Button type="submit" disabled={busy || !form.delegator_id || !form.delegate_id || !form.ends_at || form.reason.trim().length < 3 || (form.scope === "selected" && !chosen.length)}>
            {busy ? "Saving…" : uncertain ? "Retry the same delegation" : "Delegate"}
          </Button>
        </div>
      </form>
      {message ? <p role="status" className="text-sm font-semibold text-slate-700">{message}</p> : null}
    </section>
  );
}

export function CancelDelegation({ id }: { id: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function cancel() {
    setBusy(true); setMessage("");
    const result = await taskDelegationAction({ command: "delegation.cancel", id, note });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    setMessage(`Ended. ${(result.data as { returned: number }).returned} task(s) returned to the owner.`);
    router.refresh();
  }
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void cancel(); }}>
      <label className="min-w-[240px] flex-1 space-y-1"><span className="form-label">End early: reason</span>
        <input className="form-input" maxLength={300} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
      </label>
      <Button type="submit" variant="danger" disabled={busy || note.trim().length < 3}>{busy ? "Ending…" : "End delegation now"}</Button>
      {message ? <p role="status" className="w-full text-sm font-semibold text-slate-700">{message}</p> : null}
    </form>
  );
}
