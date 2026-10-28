"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { taskBlueprintAction } from "@/lib/actions/task-blueprints";
import { formatDate } from "@/lib/utils/format";
import {
  BLUEPRINT_ROLES, PREREQUISITE_STATES, blueprintSections, prerequisiteProblem, roleLabel,
  type Blueprint, type BlueprintRole, type Prerequisite, type PrerequisiteRecord, type TaskBlueprintView
} from "@/lib/workflow/task-blueprints";

function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(input: unknown, success: string, after?: (data: unknown) => void) {
    setBusy(true); setMessage("");
    const result = await taskBlueprintAction(input);
    setBusy(false);
    setMessage(result.success ? success : result.error);
    if (result.success) { after?.(result.data); router.refresh(); }
    return result;
  }
  return { busy, message, run };
}
const Status = ({ message }: { message: string }) => (message ? <p role="status" className="text-sm font-semibold text-slate-700">{message}</p> : null);

// UPGRADE_EOS feature 61: the eight-part blueprint, shown identically for every task kind.
export function BlueprintSections({ blueprint }: { blueprint: Blueprint }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {blueprintSections(blueprint).map((s) => (
        <div key={s.heading} className="min-w-0 rounded-2xl bg-slate-50 p-3"><dt className="text-xs font-bold uppercase tracking-wider text-slate-500">{s.heading}</dt><dd className="mt-1 break-words text-sm text-slate-800">{s.body}</dd></div>
      ))}
    </dl>
  );
}

type FormState = { task_kind: string; title: string; purpose: string; trigger_text: string; inputs: string; roles: BlueprintRole[]; record: PrerequisiteRecord | ""; requireLink: boolean; states: string[]; exception_role: BlueprintRole; exception_instruction: string; is_active: boolean; note: string };

function initialForm(b: Blueprint | null): FormState {
  const state = b?.prerequisites.find((p) => p.kind === "record_state");
  const record = (b?.prerequisites[0]?.entity_type ?? "") as PrerequisiteRecord | "";
  return {
    task_kind: b?.task_kind ?? "type:", title: b?.title ?? "", purpose: b?.purpose ?? "", trigger_text: b?.trigger_text ?? "", inputs: b?.inputs.join("\n") ?? "",
    roles: (b?.responsible_roles ?? []) as BlueprintRole[], record, requireLink: Boolean(b?.prerequisites.some((p) => p.kind === "linked_record")),
    states: state && state.kind === "record_state" ? state.states : [], exception_role: (b?.exception_role ?? "factory_manager") as BlueprintRole,
    exception_instruction: b?.exception_instruction ?? "", is_active: b?.is_active ?? true, note: ""
  };
}

export function BlueprintForm({ blueprint }: { blueprint: Blueprint | null }) {
  const router = useRouter();
  const { busy, message, run } = useSubmit();
  const [form, setForm] = useState<FormState>(() => initialForm(blueprint));
  const [id] = useState(() => blueprint?.id ?? crypto.randomUUID());
  const prerequisites: Prerequisite[] = form.record ? [
    ...(form.requireLink ? [{ kind: "linked_record" as const, entity_type: form.record }] : []),
    ...(form.states.length ? [{ kind: "record_state" as const, entity_type: form.record, states: form.states }] : [])
  ] : [];
  const problem = prerequisiteProblem(prerequisites);
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const payload = {
    command: "blueprint.save", id, ...(blueprint ? { expected_revision: blueprint.revision } : {}), task_kind: form.task_kind.trim(), title: form.title, purpose: form.purpose,
    trigger_text: form.trigger_text, inputs: form.inputs.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), responsible_roles: form.roles, prerequisites,
    exception_role: form.exception_role, exception_instruction: form.exception_instruction, is_active: form.is_active, note: form.note
  };
  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void run(payload, "Blueprint saved.", () => router.push(`/tasks/blueprints/${id}`)); }}>
      <fieldset disabled={busy} className="grid min-w-0 gap-3 md:grid-cols-2">
        <label className="space-y-1"><span className="form-label">Task kind (type:&lt;task type&gt; or handoff:&lt;team&gt;)</span><input className="form-input" value={form.task_kind} onChange={(e) => setForm({ ...form, task_kind: e.target.value })} /></label>
        <label className="space-y-1"><span className="form-label">Title</span><input className="form-input" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="space-y-1 md:col-span-2"><span className="form-label">Purpose</span><textarea className="form-input" maxLength={800} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></label>
        <label className="space-y-1"><span className="form-label">Trigger (what starts this task)</span><input className="form-input" maxLength={300} value={form.trigger_text} onChange={(e) => setForm({ ...form, trigger_text: e.target.value })} /></label>
        <label className="space-y-1"><span className="form-label">Inputs (one per line, up to 10)</span><textarea className="form-input" value={form.inputs} onChange={(e) => setForm({ ...form, inputs: e.target.value })} /></label>
        <fieldset className="space-y-1 md:col-span-2"><legend className="form-label">Responsible roles</legend>
          <div className="flex flex-wrap gap-3 text-sm">{BLUEPRINT_ROLES.map((r) => <label key={r} className="flex items-center gap-1"><input type="checkbox" checked={form.roles.includes(r)} onChange={() => setForm({ ...form, roles: toggle(form.roles, r) })} />{roleLabel(r)}</label>)}</div>
        </fieldset>
        <label className="space-y-1"><span className="form-label">Prerequisite record (optional)</span>
          <select className="form-input" value={form.record} onChange={(e) => setForm({ ...form, record: e.target.value as PrerequisiteRecord | "", states: [] })}><option value="">None</option>{Object.keys(PREREQUISITE_STATES).map((k) => <option key={k} value={k}>{roleLabel(k)}</option>)}</select>
        </label>
        {form.record ? (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requireLink} onChange={(e) => setForm({ ...form, requireLink: e.target.checked })} />The task must be linked to this record</label>
            <fieldset><legend className="form-label">Required states to start (optional)</legend><div className="flex flex-wrap gap-3 text-sm">{PREREQUISITE_STATES[form.record].map((s) => <label key={s} className="flex items-center gap-1"><input type="checkbox" checked={form.states.includes(s)} onChange={() => setForm({ ...form, states: toggle(form.states, s) })} />{roleLabel(s)}</label>)}</div></fieldset>
          </div>
        ) : null}
        <label className="space-y-1"><span className="form-label">Exceptions go to</span><select className="form-input" value={form.exception_role} onChange={(e) => setForm({ ...form, exception_role: e.target.value as BlueprintRole })}>{BLUEPRINT_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</select></label>
        <label className="space-y-1"><span className="form-label">Exception instruction</span><input className="form-input" maxLength={300} value={form.exception_instruction} onChange={(e) => setForm({ ...form, exception_instruction: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />Active</label>
        <label className="space-y-1"><span className="form-label">Reason for this revision</span><input className="form-input" maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
      </fieldset>
      {problem ? <p className="text-sm text-amber-900">{problem}</p> : null}
      <p className="text-xs text-slate-500">Steps come from the operating procedure set for this task kind, and completion evidence from its completion criteria.</p>
      <Button type="submit" disabled={busy || Boolean(problem) || form.roles.length === 0 || form.note.trim().length < 3}>{busy ? "Saving…" : "Save blueprint"}</Button>
      <Status message={message} />
    </form>
  );
}

function RaiseException({ taskId }: { taskId: string }) {
  const { busy, message, run } = useSubmit();
  const [reason, setReason] = useState("");
  const [id] = useState(() => crypto.randomUUID());
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void run({ command: "exception.raise", task_id: taskId, id, reason }, "Exception routed."); }}>
      <label className="min-w-0 flex-1 space-y-1"><span className="form-label">Why can this task not proceed?</span><input className="form-input" maxLength={500} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} /></label>
      <Button type="submit" variant="secondary" disabled={busy || reason.trim().length < 3}>Route exception</Button>
      <Status message={message} />
    </form>
  );
}

export function TaskBlueprintPanel({ view, taskId }: { view: Extract<TaskBlueprintView, { has_blueprint: true }>; taskId: string }) {
  const { blueprint, evaluation, started_check: started, open_exception: open } = view;
  return (
    <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-slate-900">Blueprint · {blueprint.title}</h2>
        <a className="text-sm font-semibold underline" href={`/tasks/blueprints/${blueprint.id}`}>Revision {blueprint.revision}</a>
      </div>
      <BlueprintSections blueprint={blueprint} />
      <div>
        <h3 className="text-sm font-bold text-slate-900">Ready to start?</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {evaluation.checks.map((c, i) => <li key={i} className={c.met ? "text-emerald-800" : "text-amber-900"}>{c.met ? "✓" : "✗"} {c.label}{c.met ? "" : ` — ${c.reason}`}</li>)}
        </ul>
        {started ? <p className="mt-2 text-xs text-slate-500">Started {formatDate(started.started_at)} after the revision {started.revision} checks passed.</p> : null}
      </div>
      {open ? <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">Exception routed to {roleLabel(open.routed_role)} by {open.raised_by_name}: {open.reason}</p>
        : view.can_raise ? <RaiseException taskId={taskId} /> : null}
    </section>
  );
}

export function ResolveException({ exceptionId }: { exceptionId: string }) {
  const { busy, message, run } = useSubmit();
  const [resolution, setResolution] = useState("");
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void run({ command: "exception.resolve", exception_id: exceptionId, resolution }, "Exception resolved."); }}>
      <label className="min-w-0 flex-1 space-y-1"><span className="form-label">Outcome</span><input className="form-input" maxLength={500} value={resolution} disabled={busy} onChange={(e) => setResolution(e.target.value)} /></label>
      <Button type="submit" disabled={busy || resolution.trim().length < 3}>Resolve</Button>
      <Status message={message} />
    </form>
  );
}
