"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { guidedSopAction } from "@/lib/actions/guided-sop";
import { SOURCE_TYPES, VERIFICATION_ROLES, type ExecutionStep, type PlanLoad, type RunView } from "@/lib/workflow/guided-sop";

function useCommand() {
  const router = useRouter(); const [busy, start] = useTransition(); const [message, setMessage] = useState("");
  return { busy, message, send: (payload: object) => start(async () => { const r = await guidedSopAction(payload); setMessage(r.success ? "Recorded." : r.error); if (r.success) router.refresh(); }) };
}
const labelRole = (role: string) => role.replaceAll("_", " ");

export function ExecutionPlanEditor({ versionId, data, userId }: { versionId: string; data: PlanLoad; userId: string }) {
  const state = useCommand(); const p = data.plan;
  const [steps, setSteps] = useState<ExecutionStep[]>(p?.steps ?? data.instructions.map((_, n) => ({ step_no: n + 1, kind: "check" })));
  const [id] = useState(() => p?.id ?? crypto.randomUUID());
  const update = (n: number, next: ExecutionStep) => setSteps(previous => previous.map((s, i) => i === n ? next : s));
  return <div className="space-y-4"><p className="text-sm text-slate-600">Configure the evidence for each instruction. Measurements inside the inclusive range continue; results outside it stop for independent rework review. High or urgent tasks and any out-of-range result require the elevated verification role.</p>{p?.status === "released" ? <p className="rounded-xl bg-emerald-50 p-3 text-sm">Released by {p.reviewer_name}. The execution rules are retained with this version.</p> : null}<form className="space-y-4" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); state.send({ command: "plan.save", version_id: versionId, id, steps, normal_role: d.get("normal") || null, elevated_role: d.get("elevated"), ...(p ? { expected_revision: p.revision } : {}) }); }}><fieldset disabled={state.busy || !data.can_manage || p?.status === "released"} className="space-y-4">{steps.map((s, n) => <div key={n} className="space-y-2 rounded-2xl border border-slate-200 p-4"><p className="font-semibold">{n + 1}. {data.instructions[n]?.text}</p><label className="block text-sm">Required evidence<select className="form-input" value={s.kind} onChange={e => update(n, e.target.value === "measurement" ? { step_no: n + 1, kind: "measurement", min: 0, max: 1, unit: "mm" } : e.target.value === "transaction" ? { step_no: n + 1, kind: "transaction", source_type: "production_job", states: ["completed"] } : { step_no: n + 1, kind: "check" })}><option value="check">Observed confirmation</option><option value="measurement">Measured decision branch</option><option value="transaction">Confirmed transaction</option></select></label>{s.kind === "measurement" ? <div className="grid gap-2 sm:grid-cols-3"><label className="text-sm">Minimum<input type="number" step="any" required className="form-input" value={s.min} onChange={e => update(n, { ...s, min: Number(e.target.value) })} /></label><label className="text-sm">Maximum<input type="number" step="any" required className="form-input" value={s.max} onChange={e => update(n, { ...s, max: Number(e.target.value) })} /></label><label className="text-sm">Unit<input required maxLength={20} className="form-input" value={s.unit} onChange={e => update(n, { ...s, unit: e.target.value })} /></label></div> : s.kind === "transaction" ? <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Transaction type<select className="form-input" value={s.source_type} onChange={e => update(n, { ...s, source_type: e.target.value as typeof s.source_type })}>{SOURCE_TYPES.map(t => <option key={t} value={t}>{labelRole(t)}</option>)}</select></label><label className="text-sm">Accepted states (comma separated)<input required className="form-input" value={s.states.join(",")} onChange={e => update(n, { ...s, states: e.target.value.split(",").map(v => v.trim()) })} /></label></div> : null}</div>)}<div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Normal task verification<select name="normal" className="form-input" defaultValue={p?.normal_role ?? ""}><option value="">Performer may complete after evidence checks</option>{VERIFICATION_ROLES.map(r => <option key={r} value={r}>{labelRole(r)}</option>)}</select></label><label className="text-sm">Elevated risk verification<select name="elevated" className="form-input" defaultValue={p?.elevated_role ?? "quality"}>{VERIFICATION_ROLES.map(r => <option key={r} value={r}>{labelRole(r)}</option>)}</select></label></div><Button>Save execution plan</Button></fieldset></form>{p?.status === "draft" && data.can_manage ? <Button disabled={state.busy || p.author_id === userId} variant="secondary" onClick={() => state.send({ command: "plan.release", version_id: versionId, expected_revision: p.revision })}>{p.author_id === userId ? "Another reviewer must release this plan" : "Review and release execution rules"}</Button> : null}{state.message ? <p role="status" className="text-sm">{state.message}</p> : null}</div>;
}

export function GuidedExecution({ taskId, view, instructions, userId, role }: { taskId: string; view: RunView; instructions: { text: string; check?: string }[]; userId: string; role: string }) {
  const state = useCommand();
  const run = view.run;
  const [requestId] = useState(() => crypto.randomUUID());
  if (!run) return <div className="space-y-3"><p className="text-sm">Start the reviewed procedure for this task. Progress is retained after each confirmed step.</p><Button disabled={state.busy || !view.can_start} onClick={() => state.send({ command: "run.start", task_id: taskId })}>Start guided work</Button>{!view.can_start ? <p className="text-sm">Only the assigned employee can start this procedure.</p> : null}{state.message ? <p role="status">{state.message}</p> : null}</div>;
  const current = view.steps.find(s => s.step_no === view.next_step);
  const performer = run.performer_id === userId && view.can_start;
  const reviewer = run.performer_id !== userId && (role === run.required_role || ["owner", "admin"].includes(role));
  const ready = view.task_status === "in_progress";
  const base = { task_id: taskId, expected_revision: run.revision };
  return (
    <div className="space-y-4">
      <p className="text-sm">Attempt {run.attempt} / {run.performer_name} / {run.status} / {run.elevated ? "Elevated risk" : "Normal risk"}{run.required_role ? ` / verification by ${labelRole(run.required_role)}` : ""}</p>
      {view.can_start && run.status !== "completed" && (!ready || run.performer_id !== userId) ? (
        <div className="space-y-2 rounded-2xl bg-amber-50 p-4 text-sm">
          <p>{run.performer_id !== userId ? "This work was reassigned to you. Start a new attempt; the earlier employee's evidence remains in the history." : "Resume this task to recheck its start prerequisites before continuing."}</p>
          <Button disabled={state.busy} onClick={() => state.send({ command: "run.start", task_id: taskId })}>{run.performer_id !== userId ? "Start my assigned attempt" : "Resume guided work"}</Button>
        </div>
      ) : null}
      <ol className="space-y-2">
        {view.steps.map(s => (
          <li key={s.step_no} className={`rounded-2xl border p-3 text-sm ${s.valid ? "border-emerald-200 bg-emerald-50" : s.step_no === view.next_step ? "border-orange bg-orange/5" : "border-slate-200"}`}>
            <p className="font-semibold">{s.step_no}. {instructions[s.step_no - 1]?.text}</p>
            {instructions[s.step_no - 1]?.check ? <p>Check: {instructions[s.step_no - 1].check}</p> : null}
            {s.evidence ? <p className="mt-1 text-xs">{s.valid ? "Confirmed" : s.evidence.outcome === "review" ? "Outside range: review required" : "Evidence required"}: {s.evidence.note}{s.evidence.value !== null ? ` / ${s.evidence.value} ${s.unit}` : ""} / {s.evidence.actor_name}{s.current_source_state ? ` / source now ${s.current_source_state}` : ""}</p> : null}
          </li>
        ))}
      </ol>
      {ready && current && run.status === "active" && (performer || (current.evidence?.outcome === "review" && reviewer)) ? (
        <form className="space-y-3 rounded-2xl border border-slate-200 p-4" onSubmit={e => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          state.send({ ...base, command: current.evidence?.outcome === "review" ? "step.retry" : "step.record", id: requestId, step_no: current.step_no, note: d.get("note"),
            ...(current.kind === "measurement" && current.evidence?.outcome !== "review" ? { value: Number(d.get("value")) } : {}),
            ...(current.kind === "transaction" ? { source_id: d.get("source") } : {}) });
        }}>
          <h3 className="font-bold">{current.evidence?.outcome === "review" ? "Independent rework decision" : `Record step ${current.step_no}`}</h3>
          {current.evidence?.outcome === "review" && performer ? (
            <p className="text-sm text-amber-900">This result is outside the approved range. A different authorized employee must route rework before another measurement.</p>
          ) : (
            <fieldset disabled={state.busy} className="space-y-2">
              {current.kind === "measurement" && current.evidence?.outcome !== "review" ? <label className="block text-sm">Actual measurement ({current.unit}); accepted {current.min} to {current.max}<input name="value" required type="number" step="any" className="form-input" /></label> : null}
              {current.kind === "transaction" ? <label className="block text-sm">Related {labelRole(current.source_type ?? "transaction")} reference ID<select name="source" required className="form-input"><option value="">Select a related transaction</option>{current.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select><span className="text-xs text-slate-500">Accepted states: {current.states?.join(", ")}. The record and its relationship are verified again on completion.</span></label> : null}
              <label className="block text-sm">{current.evidence?.outcome === "review" ? "Rework instruction" : "Observation"}<textarea name="note" required minLength={3} maxLength={500} className="form-input" /></label>
              <Button>{current.evidence?.outcome === "review" ? "Route rework and allow a new measurement" : "Confirm step"}</Button>
            </fieldset>
          )}
        </form>
      ) : null}
      {ready && !current && run.status !== "completed" ? (
        <div className="space-y-3">
          {run.status === "review" ? reviewer ? (
            <form className="space-y-2" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); state.send({ ...base, command: "run.verify", note: d.get("note") }); }}>
              <label className="block text-sm">Independent verification finding<textarea name="note" required minLength={3} maxLength={500} className="form-input" /></label>
              <Button disabled={state.busy}>Verify evidence</Button>
            </form>
          ) : <p className="text-sm">Waiting for an independent {labelRole(run.required_role ?? "reviewer")}.</p> : performer ? (
            <div className="flex flex-wrap gap-2">{run.required_role && !run.verification_current ? <Button disabled={state.busy} onClick={() => state.send({ ...base, command: "run.submit" })}>Submit for verification</Button> : <Button disabled={state.busy} onClick={() => state.send({ ...base, command: "run.complete" })}>Complete task with current evidence</Button>}</div>
          ) : null}
        </div>
      ) : null}
      {ready && run.status === "review" && (performer || reviewer) ? (
        <form className="space-y-2 rounded-2xl border border-slate-200 p-4" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); state.send({ ...base, command: "run.return", note: d.get("note"), step_no: Number(d.get("step")) }); }}>
          <label className="block text-sm">First step to redo<select name="step" className="form-input" defaultValue={current?.step_no ?? 1}>{view.steps.map(s => <option key={s.step_no} value={s.step_no}>{s.step_no}. {instructions[s.step_no - 1]?.text}</option>)}</select></label>
          <p className="text-xs text-slate-600">This step and the steps after it need new evidence. Earlier observations remain in the history.</p>
          <label className="block text-sm">Correction or withdrawal reason<textarea name="note" required minLength={3} maxLength={500} className="form-input" /></label>
          <Button variant="secondary" disabled={state.busy}>{performer ? "Withdraw submission for correction" : "Return for correction"}</Button>
        </form>
      ) : null}
      {run.verified_by_name ? <p className="text-sm text-emerald-800">{run.verification_current ? "Verified" : "Earlier verification"} by {run.verified_by_name}: {run.verification_note}</p> : null}
      {view.verification_history.length ? <details className="text-sm"><summary className="cursor-pointer font-semibold">Verification history</summary><ul className="mt-2 space-y-1">{view.verification_history.map((h, n) => <li key={n}>{h.decision} at evidence revision {h.evidence_revision} / {h.actor_name}: {h.note}</li>)}</ul></details> : null}
      {state.message ? <p role="status" className="text-sm">{state.message}</p> : null}
    </div>
  );
}
