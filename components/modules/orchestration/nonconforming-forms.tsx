"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { containmentAction, priorityAction, remeltAction } from "@/lib/actions/orchestration";
import type { ActionResult } from "@/lib/workflow/orchestration";
import type { ContainmentDetail, PriorityRow, RemeltRow } from "@/lib/workflow/nonconforming";

const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const box = "space-y-2 rounded-2xl border border-slate-200 bg-white p-4";

export function useSubmit(action: (input: unknown) => Promise<ActionResult>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(payload: Record<string, unknown>, done: string, after?: (data: unknown) => void) {
    setBusy(true); setMessage(null);
    const result = await action(payload);
    setBusy(false);
    if (!result.success) { setMessage({ ok: false, text: result.error }); return false; }
    setMessage({ ok: true, text: done });
    after?.(result.data);
    router.refresh();
    return true;
  }
  const note = message ? <p role={message.ok ? "status" : "alert"} className={`text-sm font-semibold ${message.ok ? "text-emerald-800" : "text-red-800"}`}>{message.text}</p> : null;
  return { busy, submit, note };
}

// ------------------------------------------------------------------ QC containment
export function OpenContainmentForm({ candidates }: { candidates: { job_id: string; job_number: string | null; order_number: string | null; open_kg: number }[] }) {
  const router = useRouter();
  const { busy, submit, note } = useSubmit(containmentAction);
  const [v, setV] = useState({ job_id: candidates[0]?.job_id ?? "", scope_kg: String(candidates[0]?.open_kg ?? ""), stage: "first_stage", defect: "", defect_kind: "non_destructive", sampling_reference: "", required_samples: "" });
  if (!candidates.length) return <p className="text-sm text-slate-600">No recent production output is waiting for a QC decision.</p>;
  return (
    <form className={box} onSubmit={e => { e.preventDefault(); submit({ command: "open", job_id: v.job_id, scope_kg: Number(v.scope_kg), stage: v.stage, defect: v.defect, defect_kind: v.defect_kind,
      ...(v.defect_kind === "destructive" ? { sampling_reference: v.sampling_reference, required_samples: Number(v.required_samples) } : {}) },
      "Lot held. QA has a containment task.", data => router.push(`/quality/containment/${(data as { id: string }).id}`)); }}>
      <h2 className="text-lg font-bold">Hold a lot after a failed sample</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Production job<select className={input} value={v.job_id} onChange={e => { const c = candidates.find(x => x.job_id === e.target.value); setV({ ...v, job_id: e.target.value, scope_kg: String(c?.open_kg ?? "") }); }}>
          {candidates.map(c => <option key={c.job_id} value={c.job_id}>{c.job_number ?? "Job"} · {c.order_number ?? "—"} · {c.open_kg} kg awaiting QC</option>)}</select></label>
        <label className="text-sm font-semibold">Affected quantity (kg)<input required inputMode="decimal" className={input} value={v.scope_kg} onChange={e => setV({ ...v, scope_kg: e.target.value })} /></label>
        <label className="text-sm font-semibold">QC stage<select className={input} value={v.stage} onChange={e => setV({ ...v, stage: e.target.value })}><option value="first_stage">First-stage (before ageing)</option><option value="final">Final (after ageing)</option></select></label>
        <label className="text-sm font-semibold">How the defect is checked<select className={input} value={v.defect_kind} onChange={e => setV({ ...v, defect_kind: e.target.value })}>
          <option value="non_destructive">Dimensional / visual — 100% inspection</option><option value="destructive">Destructive test — expanded sampling</option></select></label>
      </div>
      <label className="block text-sm font-semibold">Defect found<textarea required minLength={5} maxLength={500} rows={2} className={input} value={v.defect} onChange={e => setV({ ...v, defect: e.target.value })} /></label>
      {v.defect_kind === "destructive" ? <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Approved sampling plan reference<input required className={input} value={v.sampling_reference} onChange={e => setV({ ...v, sampling_reference: e.target.value })} /></label>
        <label className="text-sm font-semibold">Samples the plan requires<input required inputMode="numeric" className={input} value={v.required_samples} onChange={e => setV({ ...v, required_samples: e.target.value })} /></label>
      </div> : null}
      <Button disabled={busy}>Hold lot</Button>{note}
    </form>
  );
}

export function ContainmentActions({ c }: { c: ContainmentDetail }) {
  const { busy, submit, note } = useSubmit(containmentAction);
  const full = c.inspection_mode === "full_inspection";
  const [r, setR] = useState({ reference: "", result: "accepted", quantity_kg: "", pieces: "", method: full ? "Measured piece by piece" : "", note: "" });
  const [rel, setRel] = useState({ note: "", decision: "accept_lot" });
  const [other, setOther] = useState("");
  if (!c.can_record && !c.can_cancel) return <p className="text-sm text-slate-600">QA/QC records results and releases contained material.</p>;
  return (
    <div className="space-y-4">
      {c.can_record ? <form className={box} onSubmit={async e => { e.preventDefault();
        if (await submit({ command: "result", id: c.id, reference: r.reference, result: r.result, method: r.method, ...(r.quantity_kg ? { quantity_kg: Number(r.quantity_kg) } : {}), ...(r.pieces ? { pieces: Number(r.pieces) } : {}), ...(r.note ? { note: r.note } : {}) }, "Result recorded."))
          setR({ ...r, reference: "", quantity_kg: "", pieces: "", note: "" }); }}>
        <h3 className="font-bold">{full ? "Record a piece or sublot result" : "Record a sample test result"}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold">{full ? "Piece / bundle / sublot" : "Sample"}<input required maxLength={80} className={input} value={r.reference} onChange={e => setR({ ...r, reference: e.target.value })} /></label>
          <label className="text-sm font-semibold">Result<select className={input} value={r.result} onChange={e => setR({ ...r, result: e.target.value })}><option value="accepted">{full ? "Accepted" : "Pass"}</option><option value="rejected">{full ? "Rejected" : "Fail"}</option></select></label>
          {full ? <label className="text-sm font-semibold">Weight (kg)<input required inputMode="decimal" className={input} value={r.quantity_kg} onChange={e => setR({ ...r, quantity_kg: e.target.value })} /></label> : null}
          <label className="text-sm font-semibold">Pieces<input inputMode="numeric" className={input} value={r.pieces} onChange={e => setR({ ...r, pieces: e.target.value })} /></label>
        </div>
        <label className="block text-sm font-semibold">Method<input required maxLength={120} className={input} value={r.method} onChange={e => setR({ ...r, method: e.target.value })} /></label>
        <label className="block text-sm font-semibold">Note<input maxLength={500} className={input} value={r.note} onChange={e => setR({ ...r, note: e.target.value })} /></label>
        <Button disabled={busy}>Record result</Button>
      </form> : null}
      {c.can_record ? <form className={box} onSubmit={e => { e.preventDefault(); submit({ command: "release", id: c.id, note: rel.note, ...(full ? {} : { decision: rel.decision }) }, "Disposition recorded."); }}>
        <h3 className="font-bold">{full ? "Release recorded results" : "Lot disposition on the sampling plan"}</h3>
        <p className="text-xs text-slate-600">{full ? `Releases ${c.recorded.unreleased_accepted_kg} kg accepted and ${c.recorded.unreleased_rejected_kg} kg rejected as child lots. Anything without a result stays held.`
          : `${c.recorded.passing_samples} of ${c.required_samples} required passing samples recorded; ${c.recorded.failing_samples} failed. One passing replacement sample never releases a lot.`}</p>
        {!full ? <label className="text-sm font-semibold">Decision<select className={input} value={rel.decision} onChange={e => setRel({ ...rel, decision: e.target.value })}><option value="accept_lot">Accept the lot</option><option value="reject_lot">Reject the lot</option></select></label> : null}
        <label className="block text-sm font-semibold">Disposition basis<textarea required minLength={10} maxLength={1000} rows={2} className={input} value={rel.note} onChange={e => setRel({ ...rel, note: e.target.value })} /></label>
        {c.suspended_approved_kg > 0 ? <p className="text-xs font-semibold text-amber-900">{c.suspended_approved_kg} kg approved before this containment is still suspended: review each earlier approval below before the lot can be fully resolved.</p> : null}
        <Button disabled={busy}>Record disposition</Button>
      </form> : null}
      {c.can_record && !full ? <form className={box} onSubmit={e => { e.preventDefault(); submit({ command: "switch_mode", id: c.id, note: other }, "Moved to 100% inspection."); }}>
        <h3 className="font-bold">Move to 100% inspection</h3><p className="text-xs text-slate-600">Use when the defect can also be found non-destructively piece by piece.</p>
        <label className="block text-sm font-semibold">Reason<input required minLength={10} maxLength={500} className={input} value={other} onChange={e => setOther(e.target.value)} /></label>
        <Button variant="secondary" disabled={busy}>Switch to 100% inspection</Button>
      </form> : null}
      {c.can_cancel ? <details className={box}><summary className="cursor-pointer text-sm font-bold">Cancel this containment (opened in error)</summary>
        <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); submit({ command: "cancel", id: c.id, reason: other }, "Containment cancelled."); }}>
          <label className="block text-sm font-semibold">Reason<input required minLength={10} maxLength={300} className={input} value={other} onChange={e => setOther(e.target.value)} /></label>
          <Button variant="danger" disabled={busy}>Cancel containment</Button></form></details> : null}
      {note}
    </div>
  );
}

/** Review each approval recorded before the containment: QA reconfirms or revokes; the factory manager or owner closes a revocation. */
export function PriorApprovalReviews({ c }: { c: ContainmentDetail }) {
  const { busy, submit, note } = useSubmit(containmentAction);
  const [form, setForm] = useState<Record<string, { outcome: string; method: string; note: string }>>({});
  const [close, setClose] = useState<Record<string, { method: string; note: string }>>({});
  if (!c.prior_approvals.length) return null;
  return (
    <section className={box}>
      <h3 className="font-bold">Approvals recorded before this containment</h3>
      <p className="text-xs text-slate-600">QC records stay unchanged. Reconfirm an approval after re-checking the material, or revoke it: a revoked approval keeps the job blocked until the factory manager or owner closes it with re-verification evidence.</p>
      <ul className="space-y-3">{c.prior_approvals.map(p => {
        const f = form[p.inspection_id] ?? { outcome: "reconfirmed", method: "", note: "" };
        const r = p.review;
        const cl = r ? close[r.id] ?? { method: "", note: "" } : null;
        return <li key={p.inspection_id} className="rounded-xl border border-slate-200 p-3 text-sm">
          <p className="font-semibold">{p.batch_number ?? "Inspection"} · {p.quantity_kg} kg · {p.inspector_name ?? "—"}</p>
          {r ? <p className="text-xs">{r.outcome === "revoked" ? "Revoked" : "Reconfirmed"} by {r.reviewed_by_name ?? "QA"}: {r.method} — {r.note}
            {r.closed_at ? <> · closed by {r.closed_by_name ?? "management"}: {r.close_method} — {r.close_note}</> : r.outcome === "revoked" ? <b className="text-red-800"> · open: the job stays blocked</b> : null}</p> : null}
          {!r && c.can_review ? <form className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={async e => { e.preventDefault();
            if (await submit({ command: "prior_review", id: c.id, inspection_id: p.inspection_id, outcome: f.outcome, method: f.method, note: f.note }, f.outcome === "revoked" ? "Approval revoked; management alerted." : "Approval reconfirmed."))
              setForm({ ...form, [p.inspection_id]: { outcome: "reconfirmed", method: "", note: "" } }); }}>
            <label className="text-xs font-semibold">Outcome<select className={input} value={f.outcome} onChange={e => setForm({ ...form, [p.inspection_id]: { ...f, outcome: e.target.value } })}>
              <option value="reconfirmed">Re-checked — still acceptable</option><option value="revoked">Found bad — revoke</option></select></label>
            <label className="text-xs font-semibold">How it was re-checked<input required minLength={2} maxLength={120} className={input} value={f.method} onChange={e => setForm({ ...form, [p.inspection_id]: { ...f, method: e.target.value } })} /></label>
            <label className="text-xs font-semibold">Finding<input required minLength={10} maxLength={500} className={input} value={f.note} onChange={e => setForm({ ...form, [p.inspection_id]: { ...f, note: e.target.value } })} /></label>
            <div className="sm:col-span-3"><Button variant={f.outcome === "revoked" ? "danger" : "secondary"} disabled={busy}>{f.outcome === "revoked" ? "Revoke approval" : "Reconfirm approval"}</Button></div>
          </form> : null}
          {r && cl && r.can_close ? <form className="mt-2 grid gap-2 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); submit({ command: "prior_close", id: c.id, review_id: r.id, method: cl.method, note: cl.note }, "Revocation closed."); }}>
            <label className="text-xs font-semibold">Re-verification method<input required minLength={2} maxLength={120} className={input} value={cl.method} onChange={e => setClose({ ...close, [r.id]: { ...cl, method: e.target.value } })} /></label>
            <label className="text-xs font-semibold">Evidence<input required minLength={10} maxLength={500} className={input} value={cl.note} onChange={e => setClose({ ...close, [r.id]: { ...cl, note: e.target.value } })} /></label>
            <div className="sm:col-span-2"><Button disabled={busy}>Close revocation</Button></div>
          </form> : null}
        </li>;
      })}</ul>
      {note}
    </section>
  );
}

// ------------------------------------------------------------------ Remelt
export function ProposeRemeltForm({ sources }: { sources: { source_type: string; source_id: string; label: string; order_number: string | null; remaining_kg: number }[] }) {
  const { busy, submit, note } = useSubmit(remeltAction);
  const [v, setV] = useState({ key: sources[0] ? `${sources[0].source_type}:${sources[0].source_id}` : "", quantity_kg: String(sources[0]?.remaining_kg ?? ""), reason: "", evidence: "" });
  if (!sources.length) return <p className="text-sm text-slate-600">No rejected QC lots are waiting for a disposition.</p>;
  return (
    <form className={box} onSubmit={e => { e.preventDefault(); const [source_type, source_id] = v.key.split(":");
      submit({ command: "propose", source_type, source_id, quantity_kg: Number(v.quantity_kg), reason: v.reason, ...(v.evidence ? { evidence: v.evidence } : {}) }, "Request sent to the factory manager and owner."); }}>
      <h2 className="text-lg font-bold">Request remelt of rejected material</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Rejected lot<select className={input} value={v.key} onChange={e => { const s = sources.find(x => `${x.source_type}:${x.source_id}` === e.target.value); setV({ ...v, key: e.target.value, quantity_kg: String(s?.remaining_kg ?? "") }); }}>
          {sources.map(s => <option key={`${s.source_type}:${s.source_id}`} value={`${s.source_type}:${s.source_id}`}>{s.label} · {s.order_number ?? "—"} · {s.remaining_kg} kg</option>)}</select></label>
        <label className="text-sm font-semibold">Quantity (kg)<input required inputMode="decimal" className={input} value={v.quantity_kg} onChange={e => setV({ ...v, quantity_kg: e.target.value })} /></label>
      </div>
      <label className="block text-sm font-semibold">Failure reason<input required minLength={5} maxLength={500} className={input} value={v.reason} onChange={e => setV({ ...v, reason: e.target.value })} /></label>
      <label className="block text-sm font-semibold">Supporting QC report or evidence<input maxLength={500} className={input} value={v.evidence} onChange={e => setV({ ...v, evidence: e.target.value })} /></label>
      <Button disabled={busy}>Request approval</Button>{note}
    </form>
  );
}

export function RemeltRowActions({ row }: { row: RemeltRow }) {
  const { busy, submit, note } = useSubmit(remeltAction);
  const [decision, setDecision] = useState({ note: "", decision: "approve" });
  const [rec, setRec] = useState({ received_kg: String(row.quantity_kg), weighbridge_reference: "", variance_note: "" });
  const variance = Math.round((row.quantity_kg - Number(rec.received_kg || 0)) * 1000) / 1000;
  return (
    <div className="space-y-2">
      {row.can_decide ? <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); submit({ command: "decide", id: row.id, decision: decision.decision, note: decision.note }, decision.decision === "approve" ? "Approved; the foundry has the receipt task." : "Rejected."); }}>
        <label className="text-sm font-semibold">Decision<select className={input} value={decision.decision} onChange={e => setDecision({ ...decision, decision: e.target.value })}><option value="approve">Approve remelt</option><option value="reject">Reject</option></select></label>
        <label className="min-w-48 flex-1 text-sm font-semibold">Reason<input required minLength={5} maxLength={500} className={input} value={decision.note} onChange={e => setDecision({ ...decision, note: e.target.value })} /></label>
        <Button disabled={busy}>Record decision</Button></form> : null}
      {row.can_receive ? <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); submit({ command: "receive", id: row.id, received_kg: Number(rec.received_kg),
          ...(rec.weighbridge_reference ? { weighbridge_reference: rec.weighbridge_reference } : {}), ...(variance !== 0 ? { variance_note: rec.variance_note } : {}) }, "Weighed in; the scrap lot is available to the foundry."); }}>
        <label className="text-sm font-semibold">Weighed (kg)<input required inputMode="decimal" className={input} value={rec.received_kg} onChange={e => setRec({ ...rec, received_kg: e.target.value })} /></label>
        <label className="text-sm font-semibold">Weighbridge ref.<input maxLength={60} className={input} value={rec.weighbridge_reference} onChange={e => setRec({ ...rec, weighbridge_reference: e.target.value })} /></label>
        {variance !== 0 ? <label className="min-w-48 flex-1 text-sm font-semibold">Explain the {variance} kg difference<input required minLength={10} maxLength={500} className={input} value={rec.variance_note} onChange={e => setRec({ ...rec, variance_note: e.target.value })} /></label> : null}
        <Button disabled={busy}>Record receipt</Button></form> : null}
      {note}
    </div>
  );
}

// ------------------------------------------------------------------ Priority
export function PriorityRequestForm({ orderId, current }: { orderId: string; current: string | null }) {
  const { busy, submit, note } = useSubmit(priorityAction);
  const [v, setV] = useState({ to_priority: current === "urgent" ? "high" : "urgent", reason: "" });
  return (
    <form className={box} onSubmit={e => { e.preventDefault(); submit({ command: "request", order_id: orderId, to_priority: v.to_priority, reason: v.reason }, "Request sent to production planning."); }}>
      <h3 className="font-bold">Request a priority change</h3>
      <p className="text-xs text-slate-600">Current priority: {current ?? "normal"}. Production planning decides; the run order changes only when the press schedule is changed.</p>
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label className="text-sm font-semibold">New priority<select className={input} value={v.to_priority} onChange={e => setV({ ...v, to_priority: e.target.value })}>{["urgent", "high", "normal", "low"].filter(p => p !== current).map(p => <option key={p} value={p}>{p}</option>)}</select></label>
        <label className="text-sm font-semibold">Reason<input required minLength={10} maxLength={500} className={input} value={v.reason} onChange={e => setV({ ...v, reason: e.target.value })} /></label>
      </div>
      <Button disabled={busy}>Send request</Button>{note}
    </form>
  );
}

export function PriorityDecision({ row }: { row: PriorityRow }) {
  const { busy, submit, note } = useSubmit(priorityAction);
  const [v, setV] = useState({ decision: "approve", note: "" });
  if (!row.can_decide) return null;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); submit({ command: "decide", id: row.id, decision: v.decision, note: v.note }, "Decision recorded."); }}>
      <label className="text-sm font-semibold">Decision<select className={input} value={v.decision} onChange={e => setV({ ...v, decision: e.target.value })}><option value="approve">Approve</option><option value="reject">Reject</option></select></label>
      <label className="min-w-48 flex-1 text-sm font-semibold">Reason<input required minLength={5} maxLength={500} className={input} value={v.note} onChange={e => setV({ ...v, note: e.target.value })} /></label>
      <Button disabled={busy}>Record decision</Button>{note}
    </form>
  );
}
