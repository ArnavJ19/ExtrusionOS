"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { taskTriggerAction } from "@/lib/actions/task-triggers";
import { ROLE_LABELS, TRIGGER_EVENTS, isRetryableRunError, ruleProblem, type RuleRow, type RunResult, type TriggerEvent, type TriggeredTask } from "@/lib/workflow/task-triggers";

type Option = { value: string; label: string; role: string };

// UPGRADE_EOS feature 64: create or edit a trigger rule. The event of a saved rule is fixed.
export function TriggerRuleForm({ ruleId, employees, initial }: { ruleId: string; employees: Option[]; initial?: RuleRow }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: initial?.name ?? "", event_type: (initial?.event_type ?? "order_dispatch_overdue") as TriggerEvent, threshold: String(initial?.threshold ?? 2),
    lookback_days: String(initial?.lookback_days ?? 7), assignee_mode: initial?.assignee_mode ?? "role" as "role" | "person",
    assignee_role: initial?.assignee_role ?? "", assignee_user_id: initial?.assignee_user_id ?? "", due_days: String(initial?.due_days ?? 1),
    due_calendar: initial?.due_calendar ?? "working_days" as "calendar" | "working_days", priority: initial?.priority ?? "normal" as "low" | "normal" | "high" | "urgent", is_active: initial?.is_active ?? true
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const event = TRIGGER_EVENTS[form.event_type];
  const eligibleRoles = event.roles as readonly string[];
  const people = employees.filter((employee) => eligibleRoles.includes(employee.role));
  const values = {
    event_type: form.event_type, threshold: event.unit ? Number(form.threshold) : 0, assignee_mode: form.assignee_mode,
    assignee_role: form.assignee_role || null, assignee_user_id: form.assignee_mode === "person" ? form.assignee_user_id || null : null
  };
  const problem = Number.isInteger(values.threshold) ? ruleProblem(values) : "Enter whole numbers for the threshold, look-back and due days";

  async function save() {
    setBusy(true); setMessage("");
    const result = await taskTriggerAction({
      command: "rules.save", id: ruleId, expected_updated_at: initial?.updated_at ?? null, name: form.name, ...values,
      lookback_days: Number(form.lookback_days), due_days: Number(form.due_days), due_calendar: form.due_calendar, priority: form.priority, is_active: form.is_active
    });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    router.push("/tasks/triggers");
    router.refresh();
  }

  return (
    <form className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 md:col-span-2"><span className="form-label">Rule name</span><input className="form-input" maxLength={120} placeholder="e.g. Call customer when dispatch slips" value={form.name} disabled={busy} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="space-y-1"><span className="form-label">Event</span>
          {initial ? <span className="block py-2 text-sm font-bold">{event.label}</span> : (
            <select className="form-input" value={form.event_type} disabled={busy} onChange={(e) => { const next = e.target.value as TriggerEvent; setForm({ ...form, event_type: next, threshold: String(TRIGGER_EVENTS[next].min), assignee_role: "", assignee_user_id: "" }); }}>
              {(Object.keys(TRIGGER_EVENTS) as TriggerEvent[]).map((key) => <option key={key} value={key}>{TRIGGER_EVENTS[key].label}</option>)}
            </select>
          )}
        </label>
        {event.unit ? (
          <label className="space-y-1"><span className="form-label">Raise after ({event.unit})</span><input className="form-input" inputMode="numeric" value={form.threshold} disabled={busy} onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></label>
        ) : (
          <label className="space-y-1"><span className="form-label">Look back for missed rejections (days)</span><input className="form-input" inputMode="numeric" value={form.lookback_days} disabled={busy} onChange={(e) => setForm({ ...form, lookback_days: e.target.value })} /></label>
        )}
        <label className="space-y-1"><span className="form-label">Assign to</span>
          <select className="form-input" value={form.assignee_mode} disabled={busy} onChange={(e) => setForm({ ...form, assignee_mode: e.target.value as "role" | "person" })}>
            <option value="role">A role (least-loaded employee)</option><option value="person">A named employee</option>
          </select>
        </label>
        {form.assignee_mode === "person" ? (
          <label className="space-y-1"><span className="form-label">Employee</span>
            <select className="form-input" value={form.assignee_user_id} disabled={busy} onChange={(e) => setForm({ ...form, assignee_user_id: e.target.value })}>
              <option value="">Choose</option>{people.map((p) => <option key={p.value} value={p.value}>{p.label} ({ROLE_LABELS[p.role] ?? p.role})</option>)}
            </select>
          </label>
        ) : null}
        <label className="space-y-1"><span className="form-label">{form.assignee_mode === "person" ? "Fallback role (optional)" : "Role"}</span>
          <select className="form-input" value={form.assignee_role} disabled={busy} onChange={(e) => setForm({ ...form, assignee_role: e.target.value })}>
            <option value="">{form.assignee_mode === "person" ? "None: leave unassigned for recovery" : "Choose"}</option>
            {eligibleRoles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role] ?? role}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="form-label">Due in (days)</span><input className="form-input" inputMode="numeric" value={form.due_days} disabled={busy} onChange={(e) => setForm({ ...form, due_days: e.target.value })} /></label>
        <label className="space-y-1"><span className="form-label">Count</span>
          <select className="form-input" value={form.due_calendar} disabled={busy} onChange={(e) => setForm({ ...form, due_calendar: e.target.value as "calendar" | "working_days" })}>
            <option value="working_days">Working days (Mon to Sat)</option><option value="calendar">Calendar days</option>
          </select>
        </label>
        <label className="space-y-1"><span className="form-label">Priority</span>
          <select className="form-input" value={form.priority} disabled={busy} onChange={(e) => setForm({ ...form, priority: e.target.value as typeof form.priority })}>
            {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.is_active} disabled={busy} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
      </div>
      <p className="text-xs text-slate-500">Each source record raises at most one task per occurrence, however often the rule runs. Work that cannot be assigned is still created, flagged and listed under Unassigned work.</p>
      {problem ? <p className="text-xs font-semibold text-red-700">{problem}</p> : null}
      <Button type="submit" disabled={busy || Boolean(problem) || form.name.trim().length < 3}>{busy ? "Saving…" : "Save rule"}</Button>
      {message ? <p role="alert" className="text-sm font-semibold text-red-700">{message}</p> : null}
    </form>
  );
}

// Runs every active rule in scope. A lost response is retried with the same request id, so the
// database returns the original result instead of evaluating twice.
export function RunTriggersButton() {
  const router = useRouter();
  const request = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run() {
    request.current ??= crypto.randomUUID();
    setBusy(true); setMessage("");
    let result = await taskTriggerAction({ command: "triggers.run", request_id: request.current });
    if (!result.success && isRetryableRunError(result.error)) result = await taskTriggerAction({ command: "triggers.run", request_id: request.current });
    setBusy(false);
    if (!result.success) { setMessage(`${result.error} Running again is safe: no work is created twice.`); return; }
    request.current = null;
    const data = result.data as RunResult;
    setMessage(`${data.created} assigned, ${data.unassigned} unassigned, ${data.existing} already raised.${data.more_pending ? " More records are waiting: run again." : ""}`);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" disabled={busy} onClick={() => void run()}>{busy ? "Running…" : "Run rules now"}</Button>
      {message ? <span role="status" className="text-sm font-semibold text-slate-700">{message}</span> : null}
    </div>
  );
}

export function RecoveryControls({ task }: { task: TriggeredTask }) {
  const router = useRouter();
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(input: unknown) {
    setBusy(true); setMessage("");
    const result = await taskTriggerAction(input);
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    const data = result.data as { assigned_to: string | null; note: string | null };
    if (!data.assigned_to) { setMessage(data.note ?? "Still no one available."); return; }
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="form-input w-56" aria-label={`Assign ${task.title}`} value={assignee} disabled={busy} onChange={(e) => setAssignee(e.target.value)}>
        <option value="">Choose employee</option>{task.eligible.map((p) => <option key={p.id} value={p.id}>{p.name} ({ROLE_LABELS[p.role] ?? p.role})</option>)}
      </select>
      <Button type="button" disabled={busy || !assignee} onClick={() => void submit({ command: "recovery.assign", task_id: task.id, assignee_id: assignee })}>Assign</Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void submit({ command: "recovery.retry", task_id: task.id })}>Retry rule</Button>
      {message ? <p role="alert" className="w-full text-xs font-semibold text-red-700">{message}</p> : null}
    </div>
  );
}
