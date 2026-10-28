"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { completionCriteriaAction } from "@/lib/actions/completion-criteria";
import { formatDate } from "@/lib/utils/format";
import {
  CRITERION_KINDS, SIGN_OFF_ROLES, SOURCE_STATES, configProblem, criterionActions, criterionRule,
  type CriteriaEvaluation, type CriteriaTemplate, type Criterion, type CriterionKind, type SourceType
} from "@/lib/workflow/completion-criteria";

type Config = Record<string, unknown>;
const words = (value: string) => value.replace(/_/g, " ");

function defaultConfig(kind: CriterionKind, sourceType: string | null): Config {
  if (kind === "source_state") return { source_type: sourceType && sourceType in SOURCE_STATES ? sourceType : "order", states: [] };
  if (kind === "observation") return { unit: "", min: "", max: "" };
  if (kind === "sign_off") return { roles: ["quality"] };
  return {};
}
/** Observation limits are sent as numbers or omitted. */
function cleanConfig(kind: CriterionKind, config: Config): Config {
  if (kind !== "observation") return config;
  const bound = (value: unknown) => (value === "" || value === null || value === undefined ? undefined : Number(value));
  return { unit: String(config.unit ?? "").trim(), ...(bound(config.min) !== undefined ? { min: bound(config.min) } : {}), ...(bound(config.max) !== undefined ? { max: bound(config.max) } : {}) };
}

function ConfigFields({ kind, config, onChange, lockedSource, busy }: { kind: CriterionKind; config: Config; onChange: (next: Config) => void; lockedSource?: string | null; busy: boolean }) {
  if (kind === "source_state") {
    const type = String(config.source_type) as SourceType;
    const states = (config.states as string[]) ?? [];
    return (
      <div className="space-y-2 md:col-span-2">
        {lockedSource ? <p className="text-xs text-slate-600">Checks this task&apos;s linked {words(type)}.</p> : (
          <label className="space-y-1"><span className="form-label">Record type</span>
            <select className="form-input" value={type} disabled={busy} onChange={(e) => onChange({ source_type: e.target.value, states: [] })}>
              {Object.keys(SOURCE_STATES).map((key) => <option key={key} value={key}>{words(key)}</option>)}
            </select>
          </label>
        )}
        <fieldset className="flex flex-wrap gap-2 text-xs"><legend className="form-label">Required state (any of)</legend>
          {SOURCE_STATES[type]?.map((state) => (
            <label key={state} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1">
              <input type="checkbox" checked={states.includes(state)} disabled={busy} onChange={(e) => onChange({ ...config, states: e.target.checked ? [...states, state] : states.filter((s) => s !== state) })} />{words(state)}
            </label>
          ))}
        </fieldset>
      </div>
    );
  }
  if (kind === "observation") {
    return (
      <div className="grid gap-2 md:col-span-2 md:grid-cols-3">
        {(["unit", "min", "max"] as const).map((key) => (
          <label key={key} className="space-y-1"><span className="form-label">{key === "unit" ? "Unit" : key === "min" ? "Lower limit" : "Upper limit"}</span>
            <input className="form-input" inputMode={key === "unit" ? "text" : "decimal"} maxLength={20} placeholder={key === "unit" ? "micron, mm, °C" : "optional"} value={String(config[key] ?? "")} disabled={busy} onChange={(e) => onChange({ ...config, [key]: e.target.value })} />
          </label>
        ))}
      </div>
    );
  }
  if (kind === "sign_off") {
    const roles = (config.roles as string[]) ?? [];
    return (
      <fieldset className="flex flex-wrap gap-2 text-xs md:col-span-2"><legend className="form-label">Who may sign off (never the assignee)</legend>
        {SIGN_OFF_ROLES.map((role) => (
          <label key={role} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1">
            <input type="checkbox" checked={roles.includes(role)} disabled={busy} onChange={(e) => onChange({ roles: e.target.checked ? [...roles, role] : roles.filter((r) => r !== role) })} />{words(role)}
          </label>
        ))}
      </fieldset>
    );
  }
  return null;
}

function CriterionRow({ taskId, criterion, actions }: { taskId: string; criterion: Criterion; actions: ReturnType<typeof criterionActions> }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(input: unknown) {
    setBusy(true); setMessage("");
    const result = await completionCriteriaAction(input);
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    setValue(""); setReason(""); setRemoving(false);
    router.refresh();
  }
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">{criterion.label}</p>
          <p className="text-xs text-slate-500">{criterionRule(criterion)}{criterion.from_template ? " · standard for this kind of task" : ""}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-black ${criterion.met ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{criterion.met ? "Met" : "Not met"}</span>
      </div>
      {criterion.reason ? <p className="text-xs font-semibold text-amber-900">{criterion.reason}</p> : null}
      {criterion.evidence ? (
        <p className="text-xs text-slate-600">
          {criterion.kind === "observation" ? `Recorded ${criterion.evidence.value} ${String(criterion.config.unit ?? "")}` : "Signed off"} by {criterion.evidence.recorded_by_name}, {formatDate(criterion.evidence.recorded_at)}{criterion.evidence.note ? ` · ${criterion.evidence.note}` : ""}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {actions.observe ? (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const n = Number(value); if (!value.trim() || !Number.isFinite(n)) { setMessage("Enter the observed value as a number"); return; } void run({ command: "evidence.observe", task_id: taskId, criterion_id: criterion.id, value: n }); }}>
            <input className="form-input w-32" inputMode="decimal" aria-label={`Observed ${criterion.label}`} placeholder={String(criterion.config.unit ?? "value")} value={value} disabled={busy} onChange={(e) => setValue(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={busy || !value.trim()}>Record</Button>
          </form>
        ) : null}
        {actions.signOff ? <Button type="button" variant="secondary" disabled={busy} onClick={() => void run({ command: "evidence.sign_off", task_id: taskId, criterion_id: criterion.id })}>Sign off</Button> : null}
        {actions.remove && !removing ? <button type="button" className="text-xs font-bold text-slate-600 underline" disabled={busy} onClick={() => setRemoving(true)}>Remove</button> : null}
        {removing ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void run({ command: "criteria.remove", task_id: taskId, criterion_id: criterion.id, reason }); }}>
            <input className="form-input w-60" aria-label="Reason for removing" maxLength={300} placeholder="Why it no longer applies" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={busy || reason.trim().length < 3}>Remove criterion</Button>
          </form>
        ) : null}
      </div>
      {message ? <p role="alert" className="text-xs font-semibold text-red-700">{message}</p> : null}
    </li>
  );
}

function AddCriterion({ taskId, sourceType }: { taskId: string; sourceType: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CriterionKind>("observation");
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState<Config>(defaultConfig("observation", sourceType));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Record checks are offered only for a link the database can evaluate.
  const kinds = (Object.keys(CRITERION_KINDS) as CriterionKind[]).filter((k) => (k !== "source_state" || Boolean(sourceType && sourceType in SOURCE_STATES)) && (k !== "inspection_pass" || sourceType === "quality_inspection"));
  const problem = configProblem(kind, cleanConfig(kind, config));
  if (!open) return <button type="button" className="text-xs font-bold underline" onClick={() => setOpen(true)}>Add a criterion</button>;
  async function save() {
    setBusy(true); setMessage("");
    const result = await completionCriteriaAction({ command: "criteria.add", task_id: taskId, id: crypto.randomUUID(), kind, label, config: cleanConfig(kind, config) });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    setOpen(false); setLabel(""); router.refresh();
  }
  return (
    <form className="grid gap-2 rounded-xl border border-dashed border-slate-300 p-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="space-y-1"><span className="form-label">Criterion</span>
        <select className="form-input" value={kind} disabled={busy} onChange={(e) => { const next = e.target.value as CriterionKind; setKind(next); setConfig(defaultConfig(next, sourceType)); }}>
          {kinds.map((k) => <option key={k} value={k}>{CRITERION_KINDS[k]}</option>)}
        </select>
      </label>
      <label className="space-y-1"><span className="form-label">Label</span><input className="form-input" maxLength={120} placeholder="e.g. Coating thickness" value={label} disabled={busy} onChange={(e) => setLabel(e.target.value)} /></label>
      <ConfigFields kind={kind} config={config} onChange={setConfig} lockedSource={sourceType} busy={busy} />
      {problem ? <p className="text-xs font-semibold text-red-700 md:col-span-2">{problem}</p> : null}
      <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={busy || Boolean(problem) || label.trim().length < 3}>{busy ? "Adding…" : "Add criterion"}</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button></div>
      {message ? <p role="alert" className="text-xs font-semibold text-red-700 md:col-span-2">{message}</p> : null}
    </form>
  );
}

// UPGRADE_EOS feature 67: the business outcome a task must reach before it can be completed.
export function TaskCriteriaPanel({ evaluation, viewer, task }: { evaluation: CriteriaEvaluation; viewer: { userId: string; role: string; supervisor: boolean }; task: { id: string; status: string; assigned_to: string | null; related_entity_type: string | null } }) {
  const open = task.status === "open" || task.status === "in_progress";
  if (evaluation.state === "none" && !(viewer.supervisor && open)) return null;
  return (
    <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900">Completion criteria</h3>
        {evaluation.state !== "none" ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-black ${evaluation.state === "met" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
            {evaluation.state === "met" ? "Business outcome reached" : `${evaluation.unmet} of ${evaluation.total} not met`}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-slate-500">These are checked against current records when the task is completed. Ticking a checklist does not complete the work; the task cannot be marked completed while a criterion is not met.</p>
      <ul className="space-y-2">
        {evaluation.criteria.map((criterion) => <CriterionRow key={criterion.id} taskId={task.id} criterion={criterion} actions={criterionActions(criterion, viewer, task)} />)}
      </ul>
      {viewer.supervisor && open ? <AddCriterion taskId={task.id} sourceType={task.related_entity_type} /> : null}
    </section>
  );
}

// Standard criteria for a kind of task (managers).
export function CriteriaTemplateForm({ templateId, initial }: { templateId: string; initial?: CriteriaTemplate }) {
  const router = useRouter();
  const [taskKind, setTaskKind] = useState(initial?.task_kind ?? "type:");
  const [kind, setKind] = useState<CriterionKind>(initial?.kind ?? "source_state");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [config, setConfig] = useState<Config>(initial?.config ?? defaultConfig("source_state", "order"));
  const [seq, setSeq] = useState(String(initial?.seq ?? 1));
  const [active, setActive] = useState(initial?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const problem = configProblem(kind, cleanConfig(kind, config));
  async function save() {
    setBusy(true); setMessage("");
    const result = await completionCriteriaAction({ command: "templates.save", id: templateId, expected_updated_at: initial?.updated_at ?? null, task_kind: taskKind.trim(), seq: Number(seq) || 1, kind, label, config: cleanConfig(kind, config), is_active: active });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    router.push("/tasks/criteria"); router.refresh();
  }
  return (
    <form className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="space-y-1"><span className="form-label">Applies to tasks of kind</span>
        <input className="form-input" list="task-kinds" value={taskKind} disabled={busy} onChange={(e) => setTaskKind(e.target.value.toLowerCase())} />
        <datalist id="task-kinds">
          {["type:dispatch_follow_up", "type:quality_follow_up", "type:breakdown_follow_up", "type:quote_follow_up", "type:collection_follow_up", "type:general", "handoff:packaging", "handoff:quality", "handoff:dispatch"].map((k) => <option key={k} value={k} />)}
        </datalist>
        <span className="block text-xs text-slate-500">type:&lt;task type&gt; or handoff:&lt;team&gt;</span>
      </label>
      <label className="space-y-1"><span className="form-label">Criterion</span>
        <select className="form-input" value={kind} disabled={busy} onChange={(e) => { const next = e.target.value as CriterionKind; setKind(next); setConfig(defaultConfig(next, "order")); }}>
          {(Object.keys(CRITERION_KINDS) as CriterionKind[]).map((k) => <option key={k} value={k}>{CRITERION_KINDS[k]}</option>)}
        </select>
      </label>
      <label className="space-y-1"><span className="form-label">Label</span><input className="form-input" maxLength={120} value={label} disabled={busy} onChange={(e) => setLabel(e.target.value)} /></label>
      <label className="space-y-1"><span className="form-label">Order</span><input className="form-input" inputMode="numeric" value={seq} disabled={busy} onChange={(e) => setSeq(e.target.value)} /></label>
      <ConfigFields kind={kind} config={config} onChange={setConfig} busy={busy} />
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={active} disabled={busy} onChange={(e) => setActive(e.target.checked)} /> Attach to new tasks</label>
      {problem ? <p className="text-xs font-semibold text-red-700 md:col-span-2">{problem}</p> : null}
      <p className="text-xs text-slate-500 md:col-span-2">Applies to tasks created from now on, bound to the record each task links to. Existing tasks keep their criteria.</p>
      <div className="md:col-span-2"><Button type="submit" disabled={busy || Boolean(problem) || label.trim().length < 3}>{busy ? "Saving…" : "Save standard criterion"}</Button></div>
      {message ? <p role="alert" className="text-sm font-semibold text-red-700 md:col-span-2">{message}</p> : null}
    </form>
  );
}

export function ReopenTask({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMessage("");
      const result = await completionCriteriaAction({ command: "task.reopen", task_id: taskId, reason });
      setBusy(false);
      if (!result.success) { setMessage(result.error); return; }
      router.refresh();
    }}>
      <input className="form-input w-64" aria-label="Reason for reopening" maxLength={300} placeholder="Why the work must be redone" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
      <Button type="submit" variant="secondary" disabled={busy || reason.trim().length < 3}>Reopen</Button>
      {message ? <p role="alert" className="w-full text-xs font-semibold text-red-700">{message}</p> : null}
    </form>
  );
}
