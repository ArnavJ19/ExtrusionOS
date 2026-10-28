"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlagStep } from "@/components/modules/tasks/procedure-effectiveness";
import { Button } from "@/components/ui/button";
import { procedureVersionAction } from "@/lib/actions/procedure-versions";
import { formatDate } from "@/lib/utils/format";
import {
  IN_FLIGHT_POLICIES, VERSION_STATUS, describeUnbound, describeVersion, parseStepLines, reviewActions, stepLines,
  type InFlightPolicy, type ProcedureVersion, type TaskInstructions, type VersionsList
} from "@/lib/workflow/procedure-versions";

function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(input: unknown, success: string) {
    setBusy(true); setMessage("");
    const result = await procedureVersionAction(input);
    setBusy(false);
    setMessage(result.success ? success : result.error);
    if (result.success) router.refresh();
    return result;
  }
  return { busy, message, run };
}

function Status({ message }: { message: string }) {
  return message ? <p role="status" className="text-sm font-semibold text-slate-700">{message}</p> : null;
}

export function StepList({ steps }: { steps: ProcedureVersion["steps"] }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      {steps.map((step, index) => <li key={index} className="break-words"><span className="font-semibold text-slate-900">{step.text}</span>{step.check ? <span className="block text-xs text-slate-600">Key check: {step.check}</span> : null}</li>)}
    </ol>
  );
}

// UPGRADE_EOS feature 77: write a draft, send it for review, or release it with an effective date.
function DraftEditor({ procedureId, open, current }: { procedureId: string; open: ProcedureVersion | null; current: ProcedureVersion | null }) {
  const { busy, message, run } = useSubmit();
  const base = open ?? current;
  const [text, setText] = useState(base ? stepLines(base.steps) : "");
  const [summary, setSummary] = useState(open?.change_summary ?? "");
  const [versionId] = useState(() => open?.id ?? crypto.randomUUID());
  const steps = parseStepLines(text);
  return (
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run({ command: "draft.save", procedure_id: procedureId, version_id: versionId, steps, change_summary: summary, expected_hash: open?.content_hash ?? null }, "Draft saved."); }}>
      <label className="block space-y-1"><span className="form-label">Steps (one per line; add a key check after |)</span>
        <textarea className="form-input min-h-40 font-mono text-sm" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} placeholder={"Isolate the press | Lock-out tag fitted\nFit the die"} />
      </label>
      <p className="text-xs text-slate-500">{steps.length} step{steps.length === 1 ? "" : "s"} · up to 30</p>
      <label className="block space-y-1"><span className="form-label">What this version changes</span><input className="form-input" maxLength={500} value={summary} disabled={busy} onChange={(event) => setSummary(event.target.value)} /></label>
      <Button type="submit" disabled={busy || steps.length === 0 || summary.trim().length < 3}>{busy ? "Saving…" : open ? "Save draft" : "Start new draft"}</Button>
      <Status message={message} />
    </form>
  );
}

function OpenVersionActions({ open, viewerId, canAuthor, canReview, today }: { open: ProcedureVersion; viewerId: string; canAuthor: boolean; canReview: boolean; today: string }) {
  const { busy, message, run } = useSubmit();
  const [note, setNote] = useState("");
  const [effective, setEffective] = useState(today);
  const [policy, setPolicy] = useState<InFlightPolicy>("keep_current");
  const review = reviewActions(open, viewerId, canReview);
  return (
    <div className="space-y-3">
      {open.status === "draft" && canAuthor ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void run({ command: "draft.submit", version_id: open.id, expected_hash: open.content_hash }, "Sent for review.")}>Send for review</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void run({ command: "draft.discard", version_id: open.id, expected_hash: open.content_hash }, "Draft discarded.")}>Discard draft</Button>
        </div>
      ) : null}
      {review.selfAuthored ? <p className="text-sm text-amber-900">You wrote this version, so the procedure owner, backup or an owner/admin other than you must review it.</p> : null}
      {review.release ? (
        <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run({ command: "review.release", version_id: open.id, expected_hash: open.content_hash, effective_from: effective, in_flight_policy: policy, note }, "Version released."); }}>
          <label className="space-y-1"><span className="form-label">Effective from</span><input type="date" className="form-input" min={today} value={effective} disabled={busy} onChange={(event) => setEffective(event.target.value)} /></label>
          <label className="space-y-1"><span className="form-label">Work already underway</span>
            <select className="form-input" value={policy} disabled={busy} onChange={(event) => setPolicy(event.target.value as InFlightPolicy)}>{Object.entries(IN_FLIGHT_POLICIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          <label className="space-y-1 md:col-span-2"><span className="form-label">Review note (required to return; optional to release)</span><input className="form-input" maxLength={500} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button type="submit" disabled={busy || !effective}>Release version {open.version_no}</Button>
            <Button type="button" variant="secondary" disabled={busy || note.trim().length < 3} onClick={() => void run({ command: "review.return", version_id: open.id, expected_hash: open.content_hash, note }, "Returned to the author.")}>Return to author</Button>
          </div>
        </form>
      ) : null}
      <Status message={message} />
    </div>
  );
}

function WithdrawRelease({ versionId }: { versionId: string }) {
  const { busy, message, run } = useSubmit();
  const [reason, setReason] = useState("");
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void run({ command: "release.withdraw", version_id: versionId, reason }, "Release withdrawn."); }}>
      <label className="min-w-0 flex-1 space-y-1"><span className="form-label">Reason to withdraw</span><input className="form-input" maxLength={300} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
      <Button type="submit" variant="secondary" disabled={busy || reason.trim().length < 3}>Withdraw</Button>
      <Status message={message} />
    </form>
  );
}

function KindMapping({ procedureId, kinds }: { procedureId: string; kinds: string[] }) {
  const { busy, message, run } = useSubmit();
  const [kind, setKind] = useState("");
  return (
    <div className="space-y-2">
      {kinds.length ? <ul className="flex flex-wrap gap-2 text-xs">{kinds.map((k) => <li key={k} className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 font-semibold">{k}<button type="button" className="text-red-700 underline" disabled={busy} onClick={() => void run({ command: "kinds.set", task_kind: k, procedure_id: null }, "Task kind removed.")}>remove</button></li>)}</ul> : <p className="text-sm text-slate-500">No task kinds follow this procedure yet.</p>}
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void run({ command: "kinds.set", task_kind: kind.trim(), procedure_id: procedureId }, "Task kind set. Open tasks of that kind now carry the current version."); }}>
        <label className="min-w-0 flex-1 space-y-1"><span className="form-label">Task kind (type:&lt;task type&gt; or handoff:&lt;team&gt;)</span><input className="form-input" placeholder="type:die_change" value={kind} disabled={busy} onChange={(event) => setKind(event.target.value)} /></label>
        <Button type="submit" disabled={busy || !kind.trim()}>Apply to tasks</Button>
      </form>
      <Status message={message} />
    </div>
  );
}

export function ProcedureVersionsWorkspace({ list, viewerId, canMap, today }: { list: VersionsList; viewerId: string; canMap: boolean; today: string }) {
  const currentNo = list.current?.version_no ?? null;
  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">In effect today</h2>
        <div className="mt-2 flex flex-wrap gap-3 text-sm font-semibold"><a className="underline" href={`/tasks/procedures/${list.procedure.id}/effectiveness`}>Review effectiveness</a>{list.current ? <a className="underline" href={`/tasks/procedures/${list.procedure.id}/versions/${list.current.id}/execution`}>Configure execution rules</a> : null}</div>
        {list.current ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-slate-600">Version {list.current.version_no} · effective from {list.current.effective_from} · reviewed by {list.current.reviewer_name} · {IN_FLIGHT_POLICIES[list.current.in_flight_policy ?? "keep_current"]}</p>
            <StepList steps={list.current.steps} />
          </div>
        ) : <p className="mt-2 text-sm text-slate-500">No version has been released yet. Tasks of mapped kinds carry no instructions until one is.</p>}
        {list.scheduled.length ? (
          <div className="mt-4 space-y-2 rounded-2xl bg-amber-50 p-3">
            {list.scheduled.map((s) => <div key={s.id}><p className="text-sm font-semibold text-amber-900">Version {s.version_no} takes effect on {s.effective_from}: {s.change_summary}</p>{list.can_review ? <WithdrawRelease versionId={s.id} /> : null}</div>)}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">{list.open ? `Version ${list.open.version_no} · ${VERSION_STATUS[list.open.status]}` : "Next version"}</h2>
        {list.open ? <p className="mt-1 text-sm text-slate-600">Last written by {list.open.author_name} · {list.open.change_summary}{list.open.review_note ? ` · Reviewer note: ${list.open.review_note}` : ""}</p> : null}
        <div className="mt-3 space-y-4">
          {list.open?.status === "in_review" ? <StepList steps={list.open.steps} /> : null}
          {list.can_author && list.procedure.is_active && list.open?.status !== "in_review" ? <DraftEditor key={list.open?.content_hash ?? "new"} procedureId={list.procedure.id} open={list.open} current={list.current} /> : null}
          {list.open ? <OpenVersionActions key={list.open.content_hash} open={list.open} viewerId={viewerId} canAuthor={list.can_author} canReview={list.can_review} today={today} /> : null}
          {!list.can_author ? <p className="text-sm text-slate-500">Only {list.procedure.owner_name}{list.procedure.backup_name ? `, ${list.procedure.backup_name}` : ""} or an owner/admin can write or review versions.</p> : null}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Tasks that follow this procedure</h2>
        <div className="mt-3">{canMap ? <KindMapping procedureId={list.procedure.id} kinds={list.task_kinds} /> : <p className="text-sm text-slate-600">{list.task_kinds.length ? list.task_kinds.join(", ") : "None yet."}</p>}</div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Version history</h2>
        {list.rows.length ? (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {list.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="min-w-0 break-words"><a className="font-bold underline" href={`/tasks/procedures/${list.procedure.id}/versions/${row.id}`}>v{row.version_no}</a> · {row.change_summary}</span>
                <span className="text-xs font-semibold text-slate-600">{describeVersion(row, today, currentNo)} · {row.author_name}{row.released_at ? ` · released ${formatDate(row.released_at)}` : ""}{row.withdraw_reason ? ` · ${row.withdraw_reason}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-500">No versions yet.</p>}
      </section>
    </div>
  );
}

// UPGRADE_EOS feature 77: the instructions this task follows, fixed once it is completed.
export function TaskInstructionsPanel({ instructions, taskId, canFlag = false }: { instructions: TaskInstructions; taskId?: string; canFlag?: boolean }) {
  if (!instructions.bound) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Instructions</h2>
        <p className="mt-2 text-sm text-slate-600">{describeUnbound(instructions.reason)}</p>
      </section>
    );
  }
  const v = instructions.version;
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-slate-900">Instructions · {instructions.procedure_title} v{v.version_no}</h2>
        <a className="text-sm font-semibold underline" href={`/tasks/procedures/${instructions.procedure_id}/versions`}>All versions</a>
      </div>
      <p className="mt-1 text-xs text-slate-600">Process owner {instructions.owner_name}{instructions.backup_name ? ` · backup ${instructions.backup_name}` : ""} · effective from {v.effective_from}</p>
      {instructions.frozen_at ? <p className="mt-2 text-xs font-semibold text-emerald-800">Completed under version {v.version_no}. Later releases do not change this record.</p> : null}
      {!instructions.frozen_at && instructions.newer_version_no ? <p className="mt-2 text-xs font-semibold text-amber-900">Version {instructions.newer_version_no} is now in effect. This task {instructions.started_at ? "started" : "was given"} version {v.version_no} and keeps it under the release policy.</p> : null}
      <div className="mt-3"><StepList steps={v.steps} /></div>
      <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold"><a className="underline" href={`/tasks/procedures/${instructions.procedure_id}/effectiveness`}>Review procedure effectiveness</a><a className="underline" href={`/tasks/procedures/${instructions.procedure_id}/versions/${v.id}/execution`}>Execution rules</a></div>
      {taskId && canFlag ? <FlagStep taskId={taskId} steps={v.steps} /> : null}
      {instructions.history.length > 1 ? <p className="mt-3 text-xs text-slate-500">{instructions.history.map((h) => h.event === "moved" ? `moved v${h.from_version_no}→v${h.version_no}` : `${h.event} v${h.version_no}`).join(" · ")}</p> : null}
    </section>
  );
}
