"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { departmentHandoffAction, handoffAcceptanceAction } from "@/lib/actions/department-handoffs";
import { TurnaroundChip } from "@/components/modules/tasks/turnaround";
import type { TurnaroundStatus } from "@/lib/workflow/turnaround";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { HANDOFF_TEAMS, RETURN_REASONS, handoffOverdue, handoffSourceHref, sourceLabel, withinTolerance, type AcceptanceStatus, type HandoffQueue, type HandoffRow, type ReturnReason } from "@/lib/workflow/department-handoffs";

const priorityTone: Record<string, string> = { urgent: "bg-red-100 text-red-800", high: "bg-amber-100 text-amber-900", normal: "bg-slate-100 text-slate-700", low: "bg-slate-50 text-slate-500" };

// UPGRADE_EOS feature 14: the next team's work, created automatically from confirmed events.
export function HandoffQueueList({ queue, today, acceptance = {}, canAct = false, turnaround = {} }: { queue: HandoffQueue; today: string; acceptance?: Record<string, AcceptanceStatus>; canAct?: boolean; turnaround?: Record<string, TurnaroundStatus> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function take(id: string) {
    setBusy(id); setError("");
    const result = await departmentHandoffAction({ command: "handoff.take", task_id: id });
    setBusy(null);
    if (!result.success) { setError(result.error); return; }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {queue.rows.map((row) => {
          const overdue = handoffOverdue(row, today);
          return (
            <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1">
                <p className="font-bold text-slate-900">{row.title}</p>
                {row.description ? <p className="text-sm text-slate-600">{row.description}</p> : null}
                <p className="text-xs font-semibold text-slate-500">
                  {HANDOFF_TEAMS[row.handoff_team]} · {formatWeight(row.handoff_quantity_kg)} · from <Link href={handoffSourceHref(row)} className="underline">{sourceLabel[row.handoff_source_type]}</Link>
                  {" · "}{row.status === "open" ? "Waiting to be taken" : row.status === "in_progress" ? `Taken by ${row.mine ? "you" : row.assigned_to_name ?? "a team member"}` : row.status === "completed" ? `Completed ${formatDate(row.completed_at)}` : "Cancelled"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  {turnaround[row.id] ? <TurnaroundChip status={turnaround[row.id]} /> : null}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-black ${priorityTone[row.priority]}`}>{row.priority}</span>
                  <span className={`text-xs font-bold ${overdue ? "text-red-700" : "text-slate-600"}`}>{overdue ? "Overdue · " : "Due "}{formatDate(row.due_date)}</span>
                </div>
                {row.can_take && (!acceptance[row.id] || acceptance[row.id].state === "accepted") ? <Button type="button" disabled={busy !== null} onClick={() => void take(row.id)}>{busy === row.id ? "Taking…" : "Take this handoff"}</Button> : null}
                {row.mine && ["open", "in_progress"].includes(row.status) ? <Link href={`/tasks/${row.id}`} className="text-xs font-bold text-slate-700 underline">Open task to complete it</Link> : null}
              </div>
              {acceptance[row.id] ? <AcceptancePanel row={row} status={acceptance[row.id]} canAct={canAct && row.status === "open"} /> : null}
            </li>
          );
        })}
      </ul>
      {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
    </div>
  );
}

const sourceTypes = { quality_inspection: "QC inspection", finishing_job: "Finishing job", packaging_job: "Packaging job" } as const;

/** Re-runs the handoff rule for one source record. Safe to repeat: it never creates a duplicate. */
export function ReprocessHandoff() {
  const router = useRouter();
  const [form, setForm] = useState({ source_type: "quality_inspection" as keyof typeof sourceTypes, source_id: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run() {
    setBusy(true); setMessage("");
    const result = await departmentHandoffAction({ command: "handoff.reprocess", ...form, source_id: form.source_id.trim() });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    const outcome = (result.data as { outcome: string }).outcome;
    setMessage(outcome === "created" ? "A handoff was created." : outcome === "existing" ? "This event already has its handoff. Nothing was duplicated." : "This record is not in a state that hands work to another team.");
    router.refresh();
  }

  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-bold text-slate-700">Recheck one source record</summary>
      <form className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); void run(); }}>
        <label className="space-y-1"><span className="form-label">Source</span>
          <select className="form-input" value={form.source_type} disabled={busy} onChange={(event) => setForm({ ...form, source_type: event.target.value as keyof typeof sourceTypes })}>
            {Object.entries(sourceTypes).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="form-label">Record ID (from its page address)</span>
          <input className="form-input" value={form.source_id} disabled={busy} onChange={(event) => setForm({ ...form, source_id: event.target.value })} />
        </label>
        <Button type="submit" variant="secondary" disabled={busy || !form.source_id.trim()}>{busy ? "Checking…" : "Recheck"}</Button>
      </form>
      {message ? <p role="status" className="mt-2 text-sm font-semibold text-slate-700">{message}</p> : null}
    </details>
  );
}

const stateTone = { pending: "bg-amber-100 text-amber-900", accepted: "bg-emerald-100 text-emerald-800", returned: "bg-red-100 text-red-800" } as const;

// UPGRADE_EOS feature 69: accept with the received quantity, or return with what is missing.
function AcceptancePanel({ row, status, canAct }: { row: HandoffRow; status: AcceptanceStatus; canAct: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"accept" | "return" | null>(null);
  const [received, setReceived] = useState(String(row.handoff_quantity_kg));
  const [reason, setReason] = useState<ReturnReason>((status.issues[0]?.code as ReturnReason) in RETURN_REASONS ? (status.issues[0]?.code as ReturnReason) : "other");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const receivedKg = Number(received);
  const mismatch = received !== "" && Number.isFinite(receivedKg) && !withinTolerance(row.handoff_quantity_kg, receivedKg);

  async function run() {
    setBusy(true); setError("");
    const result = mode === "accept"
      ? await handoffAcceptanceAction({ command: "acceptance.accept", task_id: row.id, received_quantity_kg: receivedKg, note: "" })
      : await handoffAcceptanceAction({ command: "acceptance.return", task_id: row.id, reason, note });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setMode(null);
    router.refresh();
  }

  return (
    <div className="w-full space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-black ${stateTone[status.state]}`}>{status.state === "pending" ? "Waiting for acceptance" : status.state === "accepted" ? "Accepted" : "Returned to source"}</span>
        {status.state === "accepted" ? <span className="text-xs text-slate-600">{status.accepted_by_name ?? "Accepted"}{status.received_quantity_kg !== null ? ` · ${formatWeight(status.received_quantity_kg)} received` : ""}</span> : null}
        {status.return_count ? <span className="text-xs text-slate-500">Returned {status.return_count} time{status.return_count === 1 ? "" : "s"}</span> : null}
      </p>
      {status.open_return ? (
        <p className="text-xs font-semibold text-red-800">{RETURN_REASONS[status.open_return.reason as ReturnReason] ?? status.open_return.reason}: {status.open_return.note} · being resolved by {status.open_return.owner_name ?? "the source team"}</p>
      ) : null}
      {status.state === "pending" && status.issues.length ? (
        <ul className="list-disc pl-5 text-xs font-semibold text-amber-900">{status.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>
      ) : null}
      {canAct && status.state !== "returned" ? (
        <div className="flex flex-wrap gap-2">
          {status.state === "pending" ? <button type="button" className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold" disabled={busy} onClick={() => setMode(mode === "accept" ? null : "accept")}>Accept</button> : null}
          <button type="button" className="rounded-lg border border-red-300 px-2 py-1 text-xs font-bold text-red-700" disabled={busy} onClick={() => setMode(mode === "return" ? null : "return")}>Return to source</button>
        </div>
      ) : null}
      {mode === "accept" ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void run(); }}>
          <label className="space-y-1"><span className="form-label">Quantity received (kg)</span>
            <input className="form-input w-36" inputMode="decimal" value={received} disabled={busy} onChange={(event) => setReceived(event.target.value)} />
          </label>
          <Button type="submit" disabled={busy || received === "" || !Number.isFinite(receivedKg) || status.issues.length > 0}>{busy ? "Accepting…" : "Confirm acceptance"}</Button>
          {mismatch ? <p className="w-full text-xs font-semibold text-amber-800">This differs from {formatWeight(row.handoff_quantity_kg)} by more than the team tolerance. Return it as a quantity mismatch instead.</p> : null}
        </form>
      ) : null}
      {mode === "return" ? (
        <form className="grid gap-2 sm:grid-cols-[220px_1fr_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); void run(); }}>
          <label className="space-y-1"><span className="form-label">What is missing</span>
            <select className="form-input" value={reason} disabled={busy} onChange={(event) => setReason(event.target.value as ReturnReason)}>
              {Object.entries(RETURN_REASONS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="form-label">What the source team must resolve</span>
            <input className="form-input" maxLength={500} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
          </label>
          <Button type="submit" variant="danger" disabled={busy || note.trim().length < 5}>{busy ? "Returning…" : "Return"}</Button>
        </form>
      ) : null}
      {error ? <p role="alert" className="text-xs font-semibold text-red-700">{error}</p> : null}
    </div>
  );
}
