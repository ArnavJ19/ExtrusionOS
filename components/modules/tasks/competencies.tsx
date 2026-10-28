"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { competencyAction } from "@/lib/actions/competencies";
import { formatDate } from "@/lib/utils/format";
import { ACTIONS, LEVELS, describeStanding, type Level, type RestrictedAction, type Standing } from "@/lib/workflow/competencies";

type Option = { value: string; label: string };
type Holder = { employee_id: string; employee_name: string | null; employee_role: string; level: Level; granted_by_name: string; granted_at: string; expires_at: string | null; standing: Standing };

function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(input: unknown, success: string) {
    setBusy(true); setMessage("");
    const result = await competencyAction(input);
    setBusy(false);
    setMessage(result.success ? success : result.error);
    if (result.success) router.refresh();
    return result;
  }
  return { busy, message, run };
}

// UPGRADE_EOS feature 76: add a competency to the catalogue.
export function CompetencyForm({ procedures }: { procedures: Option[] }) {
  const { busy, message, run } = useSubmit();
  const [form, setForm] = useState({ code: "", name: "", procedure_id: "", validity: "" });
  return (
    <form className="grid gap-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); void run({ command: "catalog.save", id: crypto.randomUUID(), code: form.code, name: form.name, procedure_id: form.procedure_id || null, validity_months: form.validity ? Number(form.validity) : null, is_active: true }, "Competency added."); }}>
      <label className="space-y-1"><span className="form-label">Code</span><input className="form-input" maxLength={30} placeholder="QC-RELEASE" value={form.code} disabled={busy} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} /></label>
      <label className="space-y-1"><span className="form-label">Name</span><input className="form-input" maxLength={120} value={form.name} disabled={busy} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label className="space-y-1"><span className="form-label">Linked procedure (optional)</span>
        <select className="form-input" value={form.procedure_id} disabled={busy} onChange={(event) => setForm({ ...form, procedure_id: event.target.value })}>
          <option value="">None</option>{procedures.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      <label className="space-y-1"><span className="form-label">Valid for (months, optional)</span><input className="form-input" inputMode="numeric" value={form.validity} disabled={busy} onChange={(event) => setForm({ ...form, validity: event.target.value })} /></label>
      <div className="md:col-span-4"><Button type="submit" disabled={busy || form.code.length < 2 || form.name.trim().length < 3}>{busy ? "Saving…" : "Add competency"}</Button>{message ? <span role="status" className="ml-3 text-sm font-semibold text-slate-700">{message}</span> : null}</div>
    </form>
  );
}

export function GrantForm({ competencies, employees }: { competencies: Option[]; employees: Option[] }) {
  const { busy, message, run } = useSubmit();
  const [form, setForm] = useState({ competency_id: competencies[0]?.value ?? "", employee_id: "", level: "trained" as Level, note: "", reason: "" });
  return (
    <div className="space-y-3">
      <form className="grid gap-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); void run({ command: "grant.set", competency_id: form.competency_id, employee_id: form.employee_id, level: form.level, note: form.note }, "Grant recorded."); }}>
        <label className="space-y-1"><span className="form-label">Competency</span>
          <select className="form-input" value={form.competency_id} disabled={busy} onChange={(event) => setForm({ ...form, competency_id: event.target.value })}>{competencies.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        </label>
        <label className="space-y-1"><span className="form-label">Employee</span>
          <select className="form-input" value={form.employee_id} disabled={busy} onChange={(event) => setForm({ ...form, employee_id: event.target.value })}><option value="">Choose</option>{employees.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}</select>
        </label>
        <label className="space-y-1"><span className="form-label">Level</span>
          <select className="form-input" value={form.level} disabled={busy} onChange={(event) => setForm({ ...form, level: event.target.value as Level })}>{Object.entries(LEVELS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </label>
        <label className="space-y-1"><span className="form-label">Evidence (optional)</span><input className="form-input" maxLength={300} placeholder="e.g. Observed 5 releases on 21 Oct" value={form.note} disabled={busy} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        <div className="flex flex-wrap items-center gap-2 md:col-span-4">
          <Button type="submit" disabled={busy || !form.employee_id || !form.competency_id}>{busy ? "Saving…" : "Record grant"}</Button>
          <input className="form-input max-w-xs" maxLength={300} placeholder="Reason, to withdraw instead" value={form.reason} disabled={busy} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          <Button type="button" variant="danger" disabled={busy || !form.employee_id || form.reason.trim().length < 3} onClick={() => void run({ command: "grant.revoke", competency_id: form.competency_id, employee_id: form.employee_id, reason: form.reason }, "Competency withdrawn.")}>Withdraw</Button>
        </div>
      </form>
      <p className="text-xs text-slate-500">&quot;Trained&quot; records that the procedure was read; it never authorises the restricted step. Recording a new grant replaces the previous one and keeps it in history.</p>
      {message ? <p role="status" className="text-sm font-semibold text-slate-700">{message}</p> : null}
    </div>
  );
}

export function RequirementForm({ action, current, competencies }: { action: RestrictedAction; current: string | null; competencies: Option[] }) {
  const { busy, message, run } = useSubmit();
  const [value, setValue] = useState(current ?? "");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void run({ command: "requirements.set", action, competency_id: value || null }, value ? "Requirement saved." : "Requirement removed."); }}>
      <label className="min-w-[220px] flex-1 space-y-1"><span className="form-label">{ACTIONS[action]}</span>
        <select className="form-input" value={value} disabled={busy} onChange={(event) => setValue(event.target.value)}><option value="">No competency required</option>{competencies.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
      </label>
      <Button type="submit" variant="secondary" disabled={busy || value === (current ?? "")}>{busy ? "Saving…" : "Save"}</Button>
      {message ? <span role="status" className="text-sm font-semibold text-slate-700">{message}</span> : null}
    </form>
  );
}

export function SupervisionForm({ employees }: { employees: Option[] }) {
  const { busy, message, run } = useSubmit();
  const [form, setForm] = useState({ action: "qc_release" as RestrictedAction, record_id: "", performer_id: "" });
  return (
    <form className="grid gap-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); void run({ command: "supervise.confirm", ...form, record_id: form.record_id.trim() }, "Supervision confirmed for the next 8 hours."); }}>
      <label className="space-y-1"><span className="form-label">Step</span><select className="form-input" value={form.action} disabled={busy} onChange={(event) => setForm({ ...form, action: event.target.value as RestrictedAction })}>{Object.entries(ACTIONS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
      <label className="space-y-1"><span className="form-label">Inspection or job ID</span><input className="form-input" value={form.record_id} disabled={busy} onChange={(event) => setForm({ ...form, record_id: event.target.value })} /></label>
      <label className="space-y-1"><span className="form-label">Employee you supervise</span><select className="form-input" value={form.performer_id} disabled={busy} onChange={(event) => setForm({ ...form, performer_id: event.target.value })}><option value="">Choose</option>{employees.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}</select></label>
      <div className="flex items-end"><Button type="submit" disabled={busy || !form.record_id.trim() || !form.performer_id}>{busy ? "Confirming…" : "Confirm I supervise this"}</Button></div>
      {message ? <p role="status" className="text-sm font-semibold text-slate-700 md:col-span-4">{message}</p> : null}
    </form>
  );
}

export function HoldersList({ holders }: { holders: Holder[] }) {
  if (!holders.length) return <p className="text-sm text-slate-500">Nobody holds this competency yet.</p>;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {holders.map((h) => (
        <li key={h.employee_id} className="flex flex-wrap justify-between gap-2 py-2">
          <span><span className="font-bold">{h.employee_name ?? "Employee"}</span> · {h.employee_role.replace(/_/g, " ")} · {LEVELS[h.level]}</span>
          <span className={`text-xs font-semibold ${h.standing.effective === "independent" ? "text-emerald-700" : h.standing.effective === "none" ? "text-red-700" : "text-amber-800"}`}>
            {describeStanding(h.standing)}{h.expires_at ? ` · until ${formatDate(h.expires_at)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
