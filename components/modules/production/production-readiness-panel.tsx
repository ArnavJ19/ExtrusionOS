"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { productionHoldAction } from "@/lib/actions/production-holds";
import { holdHistorySchema, holdReasons, issueResolution, summariseReadiness, type HoldReason, type ReadinessIssue, type ReadinessResponse, type ResolutionLinks } from "@/lib/workflow/production-readiness";
import { formatDate, formatWeight } from "@/lib/utils/format";
import type { z } from "zod";

type Person = { id: string; name: string };
type History = z.infer<typeof holdHistorySchema>;
const label = (value: string) => value.replace(/_/g, " ");

function IssueList({ issues, links, tone }: { issues: ReadinessIssue[]; links: ResolutionLinks; tone: "block" | "advice" }) {
  return (
    <ul className="mt-2 space-y-2">
      {issues.map((issue, index) => {
        const resolution = issueResolution(issue.code, links);
        return (
          <li key={`${issue.code}-${index}`} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${tone === "block" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            <span>{issue.message}</span>
            {resolution ? <Link href={resolution.href} className="shrink-0 rounded-lg border border-current px-2 py-1 text-xs font-bold">{resolution.label}</Link> : null}
          </li>
        );
      })}
    </ul>
  );
}

// UPGRADE_EOS features 63 and 72: start prerequisites, recorded holds and guarded resumption.
export function ProductionReadinessPanel({ jobId, initial, unavailableMessage, links, canWrite, people }: {
  jobId: string; initial: ReadinessResponse | null; unavailableMessage: string | null; links: ResolutionLinks; canWrite: boolean; people: Person[];
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [error, setError] = useState(unavailableMessage ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [form, setForm] = useState({ reason: "material_shortage" as HoldReason, note: "", material_condition: "", resume_condition: "", responsible_user_id: people[0]?.id ?? "" });
  const [resumeNote, setResumeNote] = useState("");
  // One request identity per intended action, reused on an uncertain retry so it cannot record twice.
  const pendingRequest = useRef<{ kind: string; id: string } | null>(null);
  const requestId = (kind: string) => {
    if (pendingRequest.current?.kind !== kind) pendingRequest.current = { kind, id: crypto.randomUUID() };
    return pendingRequest.current.id;
  };

  async function reload() {
    const result = await productionHoldAction({ command: "holds.readiness", job_id: jobId });
    if (result.success) { setData(result.data as ReadinessResponse); setError(""); }
    else setError(result.error);
  }

  async function submit(kind: "place" | "resume") {
    if (busy || !data) return;
    setBusy(true); setError(""); setMessage("");
    const command = kind === "place"
      ? { command: "holds.place" as const, job_id: jobId, ...form, expected_status: data.job_status as "planned" | "ready" | "in_progress", request_id: requestId("place") }
      : { command: "holds.resume" as const, job_id: jobId, hold_id: data.hold?.id ?? "", note: resumeNote, request_id: requestId("resume") };
    const result = await productionHoldAction(command);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      setUncertain(result.uncertain === true);
      if (!result.uncertain) pendingRequest.current = null;
      return;
    }
    pendingRequest.current = null;
    setUncertain(false);
    setMessage(kind === "place" ? "Hold recorded. The job is on hold." : "Hold resolved. The job has returned to its earlier state.");
    setResumeNote("");
    await reload();
    router.refresh();
  }

  async function loadHistory() {
    const result = await productionHoldAction({ command: "holds.list", job_id: jobId, page: 1 });
    if (result.success) setHistory(result.data as History);
    else setError(result.error);
  }

  if (!data) {
    return (
      <section id="production-hold" aria-labelledby="readiness-title" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 id="readiness-title" className="font-bold tracking-tight text-slate-900">Readiness and holds</h3>
        <p role="alert" className="mt-2 text-sm font-semibold text-amber-800">{error || "Readiness could not be checked. Refresh before starting this job."}</p>
      </section>
    );
  }
  const summary = summariseReadiness(data);
  const canHold = canWrite && !data.hold && ["planned", "ready", "in_progress"].includes(data.job_status);
  const actionLabel = summary.action === "start" ? "start" : summary.action === "release" ? "be released to a press" : summary.action === "resume" ? "resume" : null;

  return (
    <section id="production-hold" aria-labelledby="readiness-title" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="readiness-title" className="font-bold tracking-tight text-slate-900">Readiness and holds</h3>
        {actionLabel ? (
          <span className={`rounded-full px-3 py-1 text-xs font-black ${summary.ready ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
            {summary.ready ? `Ready to ${actionLabel}` : `${summary.blockers.length} condition${summary.blockers.length === 1 ? "" : "s"} block this job from ${summary.action === "release" ? "release" : summary.action === "resume" ? "resuming" : "starting"}`}
          </span>
        ) : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">Job is {label(data.job_status)}</span>}
      </div>
      <p className="mt-1 text-sm font-medium text-slate-500">Checked against the same rules the database applies when the job is committed. Conditions are rechecked at that moment, so a change after this check still blocks it.</p>

      {summary.blockers.length ? <IssueList issues={summary.blockers} links={links} tone="block" /> : null}
      {summary.advisories.length ? <IssueList issues={summary.advisories} links={links} tone="advice" /> : null}

      {data.hold ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-black">On hold: {holdReasons[data.hold.reason as HoldReason] ?? label(data.hold.reason)}{data.hold.note ? ` — ${data.hold.note}` : ""}</p>
          <dl className="mt-2 grid gap-1 sm:grid-cols-2">
            <div><dt className="inline font-bold">Material and work condition: </dt><dd className="inline">{data.hold.material_condition}</dd></div>
            <div><dt className="inline font-bold">Resume when: </dt><dd className="inline">{data.hold.resume_condition}</dd></div>
            <div><dt className="inline font-bold">Responsible: </dt><dd className="inline">{data.hold.responsible_name}</dd></div>
            <div><dt className="inline font-bold">Held by: </dt><dd className="inline">{data.hold.held_by_name}, {formatDate(data.hold.held_at)}</dd></div>
            <div><dt className="inline font-bold">Progress at hold: </dt><dd className="inline">{data.hold.recorded_output_kg === null ? "No output recorded" : formatWeight(data.hold.recorded_output_kg)}{data.hold.recorded_output_pieces === null ? "" : `, ${data.hold.recorded_output_pieces} pcs`}; {data.hold.issued_billet_count} billet{data.hold.issued_billet_count === 1 ? "" : "s"} issued ({formatWeight(data.hold.issued_billet_kg)})</dd></div>
            <div><dt className="inline font-bold">Resumes to: </dt><dd className="inline">{label(data.hold.previous_status)}</dd></div>
          </dl>
          {canWrite ? (
            <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void submit("resume"); }}>
              <label className="block space-y-1"><span className="form-label">What was done to clear the hold</span>
                <textarea className="form-input" required maxLength={1000} value={resumeNote} disabled={busy || uncertain} onChange={(event) => setResumeNote(event.target.value)} />
              </label>
              <Button type="submit" disabled={busy || (uncertain && !resumeNote) || !resumeNote.trim()}>{busy ? "Checking…" : uncertain ? "Retry the same resume" : "Recheck and resume"}</Button>
            </form>
          ) : null}
        </div>
      ) : data.job_status === "on_hold" ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">This job was put on hold without a recorded hold procedure. It starts through the normal start checks above.</p>
      ) : null}

      {canHold ? (
        <details className="mt-4 rounded-2xl border border-slate-200 p-4">
          <summary className="cursor-pointer text-sm font-black text-slate-900">Place this job on hold</summary>
          <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void submit("place"); }}>
            <label className="space-y-1"><span className="form-label">Reason</span>
              <select className="form-input" value={form.reason} disabled={busy || uncertain} onChange={(event) => setForm({ ...form, reason: event.target.value as HoldReason })}>
                {Object.entries(holdReasons).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className="form-label">Responsible person</span>
              <select className="form-input" required value={form.responsible_user_id} disabled={busy || uncertain} onChange={(event) => setForm({ ...form, responsible_user_id: event.target.value })}>
                {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 md:col-span-2"><span className="form-label">Note{form.reason === "other" ? " (required)" : " (optional)"}</span>
              <input className="form-input" maxLength={1000} value={form.note} disabled={busy || uncertain} onChange={(event) => setForm({ ...form, note: event.target.value })} />
            </label>
            <label className="space-y-1"><span className="form-label">Current material and work condition</span>
              <textarea className="form-input" required maxLength={500} placeholder="e.g. 3 billets issued at press, 120 pcs cut, die in press" value={form.material_condition} disabled={busy || uncertain} onChange={(event) => setForm({ ...form, material_condition: event.target.value })} />
            </label>
            <label className="space-y-1"><span className="form-label">What permits resumption</span>
              <textarea className="form-input" required maxLength={500} placeholder="e.g. Billet batch FB-22 released by QC" value={form.resume_condition} disabled={busy || uncertain} onChange={(event) => setForm({ ...form, resume_condition: event.target.value })} />
            </label>
            <div className="md:col-span-2">
              <Button type="submit" variant="danger" disabled={busy || !people.length || !form.material_condition.trim() || !form.resume_condition.trim() || (form.reason === "other" && !form.note.trim())}>
                {busy ? "Recording…" : uncertain ? "Retry the same hold" : "Record hold"}
              </Button>
              {!people.length ? <p className="mt-1 text-xs font-semibold text-red-700">No active production employee is available to be responsible.</p> : null}
            </div>
          </form>
        </details>
      ) : null}

      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">{message}</p> : null}

      <div className="mt-4">
        {history ? (
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Hold history ({history.total_count})</p>
            {history.rows.map((row) => (
              <div key={row.id} className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700">
                <p className="font-bold text-slate-900">{holdReasons[row.reason as HoldReason] ?? label(row.reason)} · {label(row.status)} · held {formatDate(row.held_at)} by {row.held_by_name}</p>
                <p>Responsible: {row.responsible_name}. Resume when: {row.resume_condition}</p>
                {row.closed_at ? <p>Closed {formatDate(row.closed_at)} by {row.closed_by_name ?? "unrecorded"}: {row.close_note}</p> : null}
              </div>
            ))}
            {!history.rows.length ? <p className="text-xs font-semibold text-slate-500">No holds have been recorded for this job.</p> : null}
          </div>
        ) : <button type="button" className="text-xs font-bold text-slate-600 underline" onClick={() => void loadHistory()}>Show hold history</button>}
      </div>
    </section>
  );
}
