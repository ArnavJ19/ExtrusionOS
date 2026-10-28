"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { approvalInboxAction } from "@/lib/actions/approval-inbox";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { DECISIONS, decisionEffect, sourceHref, type ApprovalItem, type Decision } from "@/lib/workflow/approval-inbox";

const doneText: Record<Decision, string> = { approve: "Approved.", reject: "Rejected.", clarify: "Question sent. The request stays in the inbox." };

function ApprovalCard({ item }: { item: ApprovalItem }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [done, setDone] = useState("");
  const requestId = useRef<string | null>(null);

  async function submit() {
    if (!decision) return;
    requestId.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    const result = await approvalInboxAction({ command: "inbox.decide", source_type: item.source_type, source_id: item.source_id, version: item.version, decision, note, request_id: requestId.current });
    setBusy(false);
    if (!result.success) { setError(result.error); setUncertain(result.uncertain === true); if (!result.uncertain) requestId.current = null; return; }
    setDone(doneText[decision]);
    requestId.current = null; setUncertain(false); setDecision(null); setNote("");
    router.refresh();
  }

  return (
    <li className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-slate-900">
            {item.source_type === "quote" ? "Quotation" : "Expense"} <Link href={sourceHref(item)} className="underline-offset-2 hover:underline">{item.reference ?? "record"}</Link>
            {item.low_margin ? <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-black text-red-800">Low margin</span> : null}
          </p>
          <p className="text-sm text-slate-600">
            {[item.counterparty, item.category?.replace(/_/g, " "), item.revision ? `revision ${item.revision}` : null].filter(Boolean).join(" · ")}
          </p>
          {item.detail ? <p className="mt-1 text-sm text-slate-500">{item.detail}</p> : null}
          <p className="mt-1 text-xs font-semibold text-slate-500">Requested by {item.requester_name ?? "unknown"} · last changed {formatDate(item.requested_at)}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-black text-slate-900">{formatCurrency(item.amount)}</p>
          {item.profit_percent !== null ? <p className={`text-xs font-bold ${item.low_margin ? "text-red-700" : "text-slate-600"}`}>Estimated profit {item.profit_percent.toFixed(1)}%</p> : null}
        </div>
      </div>
      {item.last_clarification ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          {item.clarifications} question{item.clarifications === 1 ? "" : "s"} asked. Latest by {item.last_clarification.by} on {formatDate(item.last_clarification.at)}: {item.last_clarification.note}
        </p>
      ) : null}
      {done ? <p role="status" className="text-sm font-bold text-emerald-700">{done}</p> : !item.can_decide ? (
        <p className="text-sm font-semibold text-slate-500">{item.blocked_reason ?? "Not yours to decide"}: another approver must decide it.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(DECISIONS) as Decision[]).map((value) => (
              <button key={value} type="button" disabled={busy || uncertain} onClick={() => { setDecision(value); setError(""); }}
                className={`rounded-xl border px-3 py-1.5 text-sm font-bold ${decision === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700"}`}>{DECISIONS[value]}</button>
            ))}
          </div>
          {decision ? (
            <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <p className="text-xs font-semibold text-slate-600">{decisionEffect(item, decision)} The decision covers the version shown here; if the record changes first, it is refused.</p>
              <label className="block space-y-1"><span className="form-label">{decision === "approve" ? "Note (optional)" : decision === "reject" ? "Reason (required)" : "Question for the requester (required)"}</span>
                <textarea className="form-input" rows={2} maxLength={1000} value={note} disabled={busy || uncertain} onChange={(event) => setNote(event.target.value)} />
              </label>
              <Button type="submit" variant={decision === "reject" ? "danger" : "primary"} disabled={busy || (decision !== "approve" && note.trim().length < 5)}>
                {busy ? "Recording…" : uncertain ? "Retry the same decision" : `Confirm: ${DECISIONS[decision]}`}
              </Button>
            </form>
          ) : null}
        </div>
      )}
      {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
    </li>
  );
}

// UPGRADE_EOS feature 44: one queue of the approvals this employee may decide.
export function ApprovalInboxList({ items }: { items: ApprovalItem[] }) {
  return <ul className="space-y-3">{items.map((item) => <ApprovalCard key={`${item.source_type}:${item.source_id}:${item.version}`} item={item} />)}</ul>;
}
