"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { shiftHandoverAction } from "@/lib/actions/shift-handover";
import { formatWeight } from "@/lib/utils/format";
import {
  formatIst, handoverWhatsAppText, istLocalToIso, recentShiftWindows, summariseHandover, windowProblem,
  type HandoverRecord, type HandoverSummary
} from "@/lib/workflow/shift-handover";

const label = (value: string | null) => (value ?? "").replace(/_/g, " ");
const categoryText = { held: "On hold", running: "Running", ready: "Ready to start", completed: "Completed in shift" } as const;
const categoryTone = { held: "bg-amber-100 text-amber-900", running: "bg-sky-100 text-sky-900", ready: "bg-slate-100 text-slate-800", completed: "bg-emerald-100 text-emerald-900" } as const;

function Section({ title, total, shown, children }: { title: string; total: number; shown: number; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-black text-slate-900">{title} <span className="font-semibold text-slate-500">({total})</span></h3>
      {shown < total ? <p className="mt-1 text-xs font-semibold text-amber-800">Showing the first {shown} of {total}.</p> : null}
      <div className="mt-2">{total ? children : <p className="text-sm font-medium text-slate-500">Nothing recorded.</p>}</div>
    </section>
  );
}

/** Read-only rendering of a summary, used by both the preview and the stored handover. */
export function HandoverSummaryView({ summary }: { summary: HandoverSummary }) {
  const s = summariseHandover(summary);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Completed in shift", `${s.byCategory.completed} · ${formatWeight(s.completedKg)}`],
          ["Running / on hold", `${s.byCategory.running} / ${s.byCategory.held}`],
          ["Outstanding on open jobs", s.outstandingUnknown ? `${formatWeight(s.outstandingKg)} + ${s.outstandingUnknown} unplanned` : formatWeight(s.outstandingKg)],
          ["Downtime in shift", `${s.downtimeMinutes} min${s.unresolvedBreakdowns ? ` · ${s.unresolvedBreakdowns} open` : ""}`]
        ].map(([title, value]) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{title}</p>
            <p className="mt-1 text-base font-black text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      <Section title="Production jobs" total={summary.jobs_total} shown={summary.jobs.length}>
        <ul className="divide-y divide-slate-100">
          {summary.jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <Link href={`/production/${job.id}`} className="font-bold text-slate-900 underline-offset-2 hover:underline">{job.job_number ?? "Job"}</Link>
                <span className="ml-2 text-slate-500">{[job.order_number, job.machine_name].filter(Boolean).join(" · ")}</span>
                {job.category === "held" ? (
                  <p className="mt-1 text-xs font-semibold text-amber-900">Reason: {label(job.hold_reason) || "not recorded"}{job.hold_resume_condition ? ` · Resume when: ${job.hold_resume_condition}` : ""}{job.hold_responsible ? ` · Responsible: ${job.hold_responsible}` : ""}</p>
                ) : null}
                {job.exceptions_in_window ? <p className="mt-1 text-xs font-semibold text-red-700">{job.exceptions_in_window} exception{job.exceptions_in_window === 1 ? "" : "s"} reported in this shift</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">
                  {job.category === "completed" ? formatWeight(job.actual_kg) : job.outstanding_kg === null ? "Planned quantity not set" : `${formatWeight(job.outstanding_kg)} outstanding`}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-black ${categoryTone[job.category]}`}>{categoryText[job.category]}</span>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Breakdowns overlapping the shift" total={summary.downtime_total} shown={summary.downtime.length}>
          <ul className="space-y-1 text-sm">
            {summary.downtime.map((row) => (
              <li key={row.id}><span className="font-bold">{row.machine_name ?? "Machine"}</span>: {row.issue} · {row.minutes_in_window} min in shift{row.unresolved ? <span className="ml-1 font-bold text-red-700">· still {label(row.status)}</span> : null}</li>
            ))}
          </ul>
        </Section>
        <Section title="Production exceptions" total={summary.exceptions_total} shown={summary.exceptions.length}>
          <ul className="space-y-1 text-sm">
            {summary.exceptions.map((row) => (
              <li key={row.id}><span className="font-bold">{row.job_number ?? "Job"}</span>: {label(row.reason)}{row.note ? ` — ${row.note}` : ""} <span className="text-slate-500">({row.reporter_name}, {formatIst(row.recorded_at)})</span></li>
            ))}
          </ul>
        </Section>
        <Section title="Open quality inspections from the shift" total={summary.quality_total} shown={summary.quality.length}>
          <ul className="space-y-1 text-sm">
            {summary.quality.map((row) => (
              <li key={row.id}><span className="font-bold">{row.batch_number ?? "Batch"}</span> · {label(row.status)} · {formatWeight(row.quantity_checked_kg)}{row.job_number ? ` · ${row.job_number}` : ""}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs font-semibold text-slate-600">Finished stock currently on quality hold: {summary.stock_holds_count} batch{summary.stock_holds_count === 1 ? "" : "es"}, {formatWeight(summary.stock_holds_kg)}</p>
        </Section>
        <Section title="Loads pending dispatch" total={summary.pending_loads_total} shown={summary.pending_loads.length}>
          <ul className="space-y-1 text-sm">
            {summary.pending_loads.map((load) => (
              <li key={load.id}>
                <Link href={`/dispatches/${load.id}`} className="font-bold underline-offset-2 hover:underline">{load.dispatch_number ?? "Dispatch"}</Link> · {load.order_number ?? "-"} · {formatWeight(load.total_weight_kg)}{load.vehicle_number ? ` · ${load.vehicle_number}` : " · vehicle not set"}
                {load.overdue ? <span className="ml-1 font-bold text-red-700">· overdue since {load.dispatch_date}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <p className="text-xs font-medium text-slate-500">Built from recorded activity at {formatIst(summary.generated_at)} IST.</p>
    </div>
  );
}

// UPGRADE_EOS feature 39: choose a window, preview the generated summary, add context, submit.
export function NewHandoverForm() {
  const router = useRouter();
  const presets = useMemo(() => recentShiftWindows(), []);
  const [range, setRange] = useState({ start: presets[0].start, end: presets[0].end, label: presets[0].label.split(",")[0] });
  const [custom, setCustom] = useState({ start: "", end: "" });
  const [preview, setPreview] = useState<HandoverSummary | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const requestId = useRef<string | null>(null);
  const windowKey = `${range.start}|${range.end}`;

  function choose(start: string, end: string, shiftLabel: string) {
    setRange({ start, end, label: shiftLabel });
    setPreview(null); setError(""); requestId.current = null; setUncertain(false);
  }

  function applyCustom() {
    const start = istLocalToIso(custom.start);
    const end = istLocalToIso(custom.end);
    if (!start || !end) { setError("Enter both the start and end in IST"); return; }
    choose(start, end, range.label || "Custom shift");
  }

  async function loadPreview() {
    const problem = windowProblem(range.start, range.end);
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    const result = await shiftHandoverAction({ command: "handover.preview", period_start: range.start, period_end: range.end });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setPreview(result.data as HandoverSummary);
    setPreviewKey(windowKey);
  }

  async function submit() {
    if (busy || !preview || previewKey !== windowKey) return;
    requestId.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    const result = await shiftHandoverAction({ command: "handover.submit", period_start: range.start, period_end: range.end, shift_label: range.label, note, request_id: requestId.current });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      setUncertain(result.uncertain === true);
      if (!result.uncertain) requestId.current = null;
      return;
    }
    router.push(`/production/handover/${(result.data as { id: string }).id}`);
  }

  const locked = busy || uncertain;
  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">1. Choose the shift</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button key={preset.key} type="button" disabled={locked}
              className={`rounded-xl border px-3 py-2 text-sm font-bold ${range.start === preset.start && range.end === preset.end ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700"}`}
              onClick={() => choose(preset.start, preset.end, preset.label.split(",")[0])}>
              {preset.label}
            </button>
          ))}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-700">Use a different window (IST)</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="space-y-1"><span className="form-label">Start</span><input type="datetime-local" className="form-input" value={custom.start} disabled={locked} onChange={(event) => setCustom({ ...custom, start: event.target.value })} /></label>
            <label className="space-y-1"><span className="form-label">End</span><input type="datetime-local" className="form-input" value={custom.end} disabled={locked} onChange={(event) => setCustom({ ...custom, end: event.target.value })} /></label>
            <div className="flex items-end"><Button type="button" variant="secondary" disabled={locked} onClick={applyCustom}>Use this window</Button></div>
          </div>
        </details>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="space-y-1"><span className="form-label">Shift name</span>
            <input className="form-input" maxLength={40} value={range.label} disabled={locked} onChange={(event) => setRange({ ...range, label: event.target.value })} />
          </label>
          <Button type="button" disabled={busy || uncertain} onClick={() => void loadPreview()}>{busy && !preview ? "Building…" : "Build summary"}</Button>
        </div>
        <p className="mt-2 text-xs font-semibold text-slate-500">Window: {formatIst(range.start)} to {formatIst(range.end)} IST</p>
      </section>

      {preview && previewKey === windowKey ? (
        <>
          <section className="space-y-3">
            <h2 className="font-bold text-slate-900">2. Review what the next shift receives</h2>
            <HandoverSummaryView summary={preview} />
          </section>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">3. Add context and submit</h2>
            <label className="mt-2 block space-y-1"><span className="form-label">Supervisor note (optional)</span>
              <textarea className="form-input" rows={4} maxLength={2000} value={note} disabled={locked} placeholder="e.g. Die DIE-12 back from correction at 21:00; run PJ-3 first" onChange={(event) => setNote(event.target.value)} />
            </label>
            <p className="mt-1 text-xs font-medium text-slate-500">On submit the summary is rebuilt on the server and stored unchanged. It will not update if records change later.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" disabled={busy || !range.label.trim()} onClick={() => void submit()}>{busy ? "Submitting…" : uncertain ? "Retry the same submission" : "Submit handover"}</Button>
            </div>
          </section>
        </>
      ) : null}
      {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
    </div>
  );
}

export function AcknowledgeHandover({ record, canAcknowledge, isPreparer }: { record: HandoverRecord; canAcknowledge: boolean; isPreparer: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  async function acknowledge() {
    setBusy(true); setError("");
    const result = await shiftHandoverAction({ command: "handover.acknowledge", handover_id: record.id, note });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    router.refresh();
  }

  async function copy() {
    try { await navigator.clipboard.writeText(handoverWhatsAppText(record)); setCopied("Summary copied. Paste it into the shift WhatsApp group."); }
    catch { setCopied("Copy is not available in this browser."); }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-slate-900">Acknowledgement</h2>
        <button type="button" className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700" onClick={() => void copy()}>Copy WhatsApp summary</button>
      </div>
      {copied ? <p role="status" className="mt-1 text-xs font-semibold text-emerald-700">{copied}</p> : null}
      {record.status === "acknowledged" ? (
        <p className="mt-2 text-sm font-semibold text-emerald-800">Received by {record.acknowledged_by_name} on {formatIst(record.acknowledged_at)} IST{record.acknowledgement_note ? `: ${record.acknowledgement_note}` : ""}</p>
      ) : isPreparer ? (
        <p className="mt-2 text-sm font-semibold text-slate-600">Waiting for the incoming supervisor. The person who prepared a handover cannot acknowledge it.</p>
      ) : canAcknowledge ? (
        <form className="mt-2 space-y-2" onSubmit={(event) => { event.preventDefault(); void acknowledge(); }}>
          <label className="block space-y-1"><span className="form-label">Note for the record (optional)</span>
            <input className="form-input" maxLength={1000} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
          </label>
          <Button type="submit" disabled={busy}>{busy ? "Recording…" : "I have received this handover"}</Button>
        </form>
      ) : <p className="mt-2 text-sm font-semibold text-slate-600">Awaiting acknowledgement by the incoming supervisor.</p>}
      {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
    </section>
  );
}
