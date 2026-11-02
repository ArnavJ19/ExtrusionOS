"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { FormIssueSummary } from "@/components/forms/form-issue-summary";
import { inspectionPlanAction } from "@/lib/actions/inspection-plans";
import { evaluationSchema, judge, limitText, type Evaluation } from "@/lib/workflow/inspection-plans";
import { buildInspectionEntry, inspectionDraftKey, observationMatches, restoreInspectionDraftState } from "@/lib/ui/inspection-entry";
import { focusFormField, formFieldId, type FormIssue } from "@/lib/ui/form-workflow";
import { formatDate } from "@/lib/utils/format";

type Props = { inspectionId: string; initial: Evaluation; canRecord: boolean; contextScope?: string; referenceHref?: string; focused?: boolean; queueHref?: "/quality" | "/mobile/quality" };
export function InspectionResultsPanel(props: Props) {
  const plan = props.initial.state === "no_plan" ? "none" : `${props.initial.plan_id}:${props.initial.plan_version}`;
  return <InspectionWorkspace key={`${props.contextScope ?? "session"}:${props.inspectionId}:${plan}:${props.initial.inspection_status}`} {...props} />;
}

function InspectionWorkspace({ inspectionId, initial, canRecord, contextScope, referenceHref, focused = false, queueHref = "/quality" }: Props) {
  const router = useRouter();
  const scope = useId();
  const form = useRef<HTMLFormElement>(null);
  const [evaluation, setEvaluation] = useState(initial);
  const [values, setValues] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<FormIssue[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [oneAtATime, setOneAtATime] = useState(focused);
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const pending = evaluation.inspection_status === "pending";
  const storageKey = contextScope && initial.state !== "no_plan" ? inspectionDraftKey(contextScope, inspectionId, initial.plan_id, initial.plan_version) : null;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    setEvaluation(initial);
    if (storageKey && contextScope && pending && canRecord) {
      try {
        const recovered = restoreInspectionDraftState(sessionStorage.getItem(storageKey), contextScope, initial);
        setValues(recovered.values); setUncertain(recovered.uncertain);
        if (Object.keys(recovered.values).length) setDraftMessage(recovered.uncertain ? "Recovered observations from an interrupted save. Check current observations before submitting again." : "Recovered unsubmitted observations on this device. Review the current plan before saving.");
      } catch { setDraftMessage("Device draft storage is unavailable. Keep this page open to retain entries."); }
    }
    setDraftLoaded(true);
  }, [storageKey, contextScope, initial, pending, canRecord]);
  useEffect(() => {
    if (!storageKey || !contextScope || !draftLoaded || !pending || !canRecord || initial.state === "no_plan") return;
    try {
      if (!Object.values(values).some((value) => value.trim())) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify({ scope: contextScope, planId: initial.plan_id, version: initial.plan_version, savedAt: Date.now(), values, uncertain }));
    } catch { setDraftMessage("Device draft storage is unavailable. Keep this page open to retain entries."); }
  }, [values, uncertain, storageKey, contextScope, draftLoaded, pending, canRecord, initial]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (Object.values(values).some((value) => value.trim())) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [values]);

  if (evaluation.state === "no_plan") return <section id="inspection-results" className="rounded-2xl border border-amber-300 bg-amber-50 p-4"><h3 className="font-bold">Inspection reference unavailable</h3><p className="mt-2 text-sm">No approved applicable inspection plan was returned. Open the full inspection and resolve its reference before recording planned observations.</p></section>;
  const entry = buildInspectionEntry(evaluation, values);
  const editable = canRecord && pending;
  const visibleItems = oneAtATime ? evaluation.items.slice(activeIndex, activeIndex + 1) : evaluation.items;

  function showIssue(issue: FormIssue) {
    if (evaluation.state === "no_plan") return;
    const index = evaluation.items.findIndex((item) => item.item_id === issue.path);
    if (index >= 0) setActiveIndex(index);
    requestAnimationFrame(() => focusFormField(form.current, formFieldId(scope, issue.path)));
  }
  function review() {
    if (!editable || blocked || busy || uncertain) return;
    setMessage(""); setIssues(entry.issues);
    if (entry.issues.length) { showIssue(entry.issues[0]); return; }
    setReviewing(true);
    requestAnimationFrame(() => document.getElementById(`${scope}-review`)?.focus());
  }
  async function checkCurrent() {
    if (inFlight.current || !online) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await inspectionPlanAction({ command: "inspection.plan", inspection_id: inspectionId });
      if (!result.success) { setMessage(result.error); return; }
      const parsed = evaluationSchema.safeParse(result.data);
      if (!parsed.success || parsed.data.state === "no_plan" || evaluation.state === "no_plan" || parsed.data.plan_id !== evaluation.plan_id || parsed.data.plan_version !== evaluation.plan_version) {
        setBlocked(true); setMessage("The applicable plan changed or is unavailable. Your entries are retained here. Reload the inspection and review its current plan before entering them again."); return;
      }
      if (entry.results.length && entry.results.every((row) => observationMatches(row, parsed.data))) {
        setEvaluation(parsed.data); setValues({}); setUncertain(false); setBlocked(false); setReviewing(false); setMessage("Current saved observations match your reviewed entries. No additional save was sent.");
      } else {
        setEvaluation(parsed.data); setUncertain(false); setBlocked(false); setReviewing(false); setMessage("Current observations loaded. Your entries are retained; review the differences before another save.");
      }
    } catch { setMessage("Current observations could not be checked. Keep your entries and check again after reconnecting."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function save(savedAt: number) {
    if (inFlight.current || !reviewing || !editable || blocked || !online || uncertain || evaluation.state === "no_plan") return;
    const checked = buildInspectionEntry(evaluation, values);
    if (checked.issues.length) { setReviewing(false); setIssues(checked.issues); showIssue(checked.issues[0]); return; }
    inFlight.current = true; setBusy(true); setMessage("");
    setUncertain(true);
    if (storageKey && contextScope) {
      try { sessionStorage.setItem(storageKey, JSON.stringify({ scope: contextScope, planId: evaluation.plan_id, version: evaluation.plan_version, savedAt, values, uncertain: true })); }
      catch { setDraftMessage("Device draft storage is unavailable. Keep this page open until the save is resolved."); }
    }
    try {
      const result = await inspectionPlanAction({ command: "results.record", inspection_id: inspectionId, plan_id: evaluation.plan_id, results: checked.results });
      if (!result.success) {
        setUncertain(Boolean(result.uncertain)); setMessage(result.error);
        if (!result.uncertain && /applicable inspection plan changed/i.test(result.error)) setBlocked(true);
        if (!result.uncertain) setReviewing(false);
        return;
      }
      const parsed = evaluationSchema.safeParse(result.data);
      if (!parsed.success || parsed.data.state === "no_plan" || parsed.data.plan_id !== evaluation.plan_id) { setUncertain(true); setMessage("The save response could not be verified. Check current observations before trying again."); return; }
      setEvaluation(parsed.data); setValues({}); setIssues([]); setReviewing(false); setUncertain(false);
      setDraftMessage(""); setMessage("Observations saved and confirmed. Inspection approval remains a separate action.");
      router.refresh();
    } catch { setUncertain(true); setMessage("The save outcome is uncertain. Check current observations before submitting again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section id="inspection-results" className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
    <h3 className="font-bold text-neutral-950">Inspection plan v{evaluation.plan_version} ({evaluation.plan_scope === "default" ? "company default" : "this profile"})</h3>
    <p className="mt-2 text-sm">Sampling: {evaluation.sampling_instruction}</p>
    {referenceHref ? <a href={referenceHref} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-11 items-center rounded-lg text-sm font-semibold underline">Open approved plan v{evaluation.plan_version} in a new tab</a> : null}
    <p className="my-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{evaluation.missing} of {evaluation.total} observations missing; {evaluation.failed} outside limits. All required observations must be recorded within limits before approval. Planned or theoretical quantities are never physical observations.</p>
    {!online ? <p role="status" className="my-3 rounded-xl border border-amber-300 p-3 text-sm">Offline. Entries stay on this device where draft storage is available. Reconnect before saving; no offline posting is available.</p> : null}
    {draftMessage ? <p role="status" className="my-2 text-sm text-neutral-600">{draftMessage}</p> : null}
    {message ? <p role="status" className="my-3 rounded-xl border border-neutral-300 bg-neutral-50 p-3 text-sm font-semibold">{message}</p> : null}
    <form ref={form} noValidate onSubmit={(event) => { event.preventDefault(); if (reviewing) void save(Math.floor(performance.timeOrigin + event.timeStamp)); else review(); }} aria-busy={busy || undefined} className="operational-record-form space-y-4">
      {issues.length ? <div onClick={(event) => { const anchor = (event.target as HTMLElement).closest("a"); const issue = anchor ? issues.find((item) => anchor.hash === `#${formFieldId(scope, item.path)}`) : null; if (issue) showIssue(issue); }}><FormIssueSummary issues={issues} scope={scope} container={form} /></div> : null}
      {!reviewing ? <>
        {editable ? <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={oneAtATime} onChange={(event) => setOneAtATime(event.target.checked)} />One check at a time</label> : null}
        {visibleItems.map((item) => {
          const id = formFieldId(scope, item.item_id);
          const issue = issues.find((value) => value.path === item.item_id);
          const value = values[item.item_id] ?? "";
          const proposed = entry.results.find((row) => row.item_id === item.item_id);
          const preview = proposed && "observed" in proposed ? judge(proposed.observed, item.lower_limit, item.upper_limit) : proposed && "visual_ok" in proposed ? proposed.visual_ok ? "pass" : "fail" : null;
          return <div key={item.item_id} className="grid items-start gap-3 rounded-2xl border border-neutral-200 p-4 md:grid-cols-2">
            <div><label htmlFor={id} className="font-bold">{item.characteristic}{item.critical ? "" : " (non-critical)"}</label><p className="mt-2 text-sm">Saved: {item.unit === "visual" ? item.visual_ok === null ? "Not recorded" : item.visual_ok ? "Pass" : "Fail" : item.observed === null ? "Not recorded" : `${item.observed} ${item.unit}`}</p><p className="text-xs">Recorded outcome: {item.outcome}</p>{item.recorded_by_name ? <p className="mt-1 text-xs text-neutral-600">{item.recorded_by_name}, {formatDate(item.recorded_at)}</p> : null}</div>
            <div id={`${id}-reference`} className="rounded-xl bg-neutral-50 p-3 text-sm"><p className="font-semibold">Approved plan v{evaluation.plan_version}: {limitText(item)}</p>{item.nominal !== null ? <p>Nominal: {item.nominal} {item.unit}</p> : null}{item.method ? <p className="mt-1">Method: {item.method}</p> : null}<p className="mt-1 text-xs">This is the plan returned for this inspection, with its recorded version.</p></div>
            {editable ? <div className="md:col-span-2">
              {item.unit === "visual" ? <select id={id} aria-label={`${item.characteristic} result`} aria-describedby={`${id}-reference${issue ? ` ${id}-error` : ""}`} aria-invalid={Boolean(issue) || undefined} className="form-input min-h-12" value={value} disabled={busy || uncertain || blocked} onChange={(event) => { setValues({ ...values, [item.item_id]: event.target.value }); setIssues(issues.filter((entry) => entry.path !== item.item_id)); }}><option value="">{item.visual_ok === null ? "Choose an observed result" : "Keep saved result"}</option><option value="pass">Pass</option><option value="fail">Fail</option></select> : <input id={id} className="form-input min-h-12" inputMode="decimal" aria-label={`Measured ${item.characteristic}`} aria-describedby={`${id}-reference${issue ? ` ${id}-error` : ""}`} aria-invalid={Boolean(issue) || undefined} placeholder={`Measured (${item.unit})`} value={value} disabled={busy || uncertain || blocked} onChange={(event) => { setValues({ ...values, [item.item_id]: event.target.value }); setIssues(issues.filter((entry) => entry.path !== item.item_id)); }} />}
              {issue ? <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-red-800">{issue.message}</p> : null}
              {preview ? <p className={`mt-1 text-sm font-bold ${preview === "pass" ? "text-emerald-800" : "text-red-800"}`}>Proposed observation would {preview}</p> : null}
            </div> : null}
          </div>;
        })}
        {oneAtATime && evaluation.items.length > 1 ? <nav aria-label="Inspection observations" className="flex flex-wrap items-center justify-between gap-2"><Button type="button" variant="secondary" disabled={activeIndex === 0 || busy} onClick={() => setActiveIndex(activeIndex - 1)}>Previous check</Button><span role="status" className="text-sm">Check {activeIndex + 1} of {evaluation.items.length}</span><Button type="button" variant="secondary" disabled={activeIndex === evaluation.items.length - 1 || busy} onClick={() => setActiveIndex(activeIndex + 1)}>Next check</Button></nav> : null}
      </> : <div id={`${scope}-review`} tabIndex={-1} className="rounded-2xl border border-neutral-300 bg-neutral-50 p-4 focus:outline focus:outline-2"><h4 className="font-bold">Review actual observations</h4><p className="my-2 text-sm">Only these entries will replace saved observations against plan v{evaluation.plan_version}. Blank checks keep their saved values. This does not approve or release material.</p><ul className="space-y-2 text-sm">{entry.results.map((row) => {
        const item = evaluation.items.find((item) => item.item_id === row.item_id)!;
        return <li key={row.item_id} className="break-words"><strong>{item.characteristic}:</strong> {"observed" in row ? `${row.observed} ${item.unit}` : row.visual_ok ? "Pass" : "Fail"} (saved: {item.unit === "visual" ? item.visual_ok === null ? "not recorded" : item.visual_ok ? "Pass" : "Fail" : item.observed === null ? "not recorded" : `${item.observed} ${item.unit}`})</li>;
      })}</ul></div>}
      {editable ? <FormActionBar pending={busy} explanation={uncertain ? "Check current observations to resolve the interrupted save. A second save is disabled." : reviewing ? "Confirm the observations after checking the approved limits." : "Record only what you observed. You can review a partial set without replacing blank checks."}>
        {uncertain || blocked ? <Button type="button" disabled={busy || !online} onClick={() => void checkCurrent()}>Check current observations</Button> : null}
        {reviewing ? <Button type="button" variant="secondary" disabled={busy || uncertain || blocked} onClick={() => setReviewing(false)}>Back to observations</Button> : null}
        <Button type="submit" disabled={busy || !online || uncertain || blocked}>{busy ? "Saving..." : reviewing ? "Confirm and save observations" : "Review observations"}</Button>
      </FormActionBar> : null}
    </form>
    {blocked ? <Button type="button" variant="secondary" className="mt-3" onClick={() => router.refresh()}>Reload inspection reference</Button> : null}
    <a href={queueHref} className="mt-4 inline-flex min-h-11 items-center rounded-lg text-sm font-semibold underline">Return to quality queue</a>
  </section>;
}
