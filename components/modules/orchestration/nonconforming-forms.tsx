"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { containmentAction, priorityAction, remeltAction } from "@/lib/actions/orchestration";
import { floorText, type FloorLanguage } from "@/lib/i18n/floor";
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
export function OpenContainmentForm({ candidates, lang = "en" }: { candidates: { job_id: string; job_number: string | null; order_number: string | null; open_kg: number }[]; lang?: FloorLanguage }) {
  const router = useRouter();
  const t = floorText(lang);
  const { busy, submit, note } = useSubmit(containmentAction);
  const [v, setV] = useState({ job_id: candidates[0]?.job_id ?? "", scope_kg: String(candidates[0]?.open_kg ?? ""), stage: "first_stage", defect: "", defect_kind: "non_destructive", sampling_reference: "", required_samples: "" });
  if (!candidates.length) return <p className="text-sm text-slate-600">{t("olo.qc.noCandidates")}</p>;
  return (
    <form className={box} lang={lang} onSubmit={e => { e.preventDefault(); submit({ command: "open", job_id: v.job_id, scope_kg: Number(v.scope_kg), stage: v.stage, defect: v.defect, defect_kind: v.defect_kind,
      ...(v.defect_kind === "destructive" ? { sampling_reference: v.sampling_reference, required_samples: Number(v.required_samples) } : {}) },
      t("olo.qc.heldDone"), data => router.push(`/quality/containment/${(data as { id: string }).id}`)); }}>
      <h2 className="text-lg font-bold">{t("olo.qc.openTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">{t("olo.qc.job")}<select className={input} value={v.job_id} onChange={e => { const c = candidates.find(x => x.job_id === e.target.value); setV({ ...v, job_id: e.target.value, scope_kg: String(c?.open_kg ?? "") }); }}>
          {candidates.map(c => <option key={c.job_id} value={c.job_id}>{c.job_number ?? "Job"} · {c.order_number ?? "—"} · {t("olo.qc.awaiting", { kg: c.open_kg })}</option>)}</select></label>
        <label className="text-sm font-semibold">{t("olo.qc.affected")}<input required inputMode="decimal" className={input} value={v.scope_kg} onChange={e => setV({ ...v, scope_kg: e.target.value })} /></label>
        <label className="text-sm font-semibold">{t("olo.qc.stage")}<select className={input} value={v.stage} onChange={e => setV({ ...v, stage: e.target.value })}><option value="first_stage">{t("olo.qc.firstStage")}</option><option value="final">{t("olo.qc.finalStage")}</option></select></label>
        <label className="text-sm font-semibold">{t("olo.qc.howChecked")}<select className={input} value={v.defect_kind} onChange={e => setV({ ...v, defect_kind: e.target.value })}>
          <option value="non_destructive">{t("olo.qc.nonDestructive")}</option><option value="destructive">{t("olo.qc.destructive")}</option></select></label>
      </div>
      <label className="block text-sm font-semibold">{t("olo.qc.defectFound")}<textarea required minLength={5} maxLength={500} rows={2} className={input} value={v.defect} onChange={e => setV({ ...v, defect: e.target.value })} /></label>
      {v.defect_kind === "destructive" ? <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">{t("olo.qc.samplingRef")}<input required className={input} value={v.sampling_reference} onChange={e => setV({ ...v, sampling_reference: e.target.value })} /></label>
        <label className="text-sm font-semibold">{t("olo.qc.samplesRequired")}<input required inputMode="numeric" className={input} value={v.required_samples} onChange={e => setV({ ...v, required_samples: e.target.value })} /></label>
      </div> : null}
      <Button disabled={busy}>{t("olo.qc.hold")}</Button>{note}
    </form>
  );
}

export function ContainmentActions({ c, lang = "en" }: { c: ContainmentDetail; lang?: FloorLanguage }) {
  const t = floorText(lang);
  const { busy, submit, note } = useSubmit(containmentAction);
  const full = c.inspection_mode === "full_inspection";
  // The default method is stored with the result, so it stays in English like other recorded values.
  const [r, setR] = useState({ reference: "", result: "accepted", quantity_kg: "", pieces: "", method: full ? "Measured piece by piece" : "", note: "" });
  const [rel, setRel] = useState({ note: "", decision: "accept_lot" });
  const [other, setOther] = useState("");
  if (!c.can_record && !c.can_cancel) return <p className="text-sm text-slate-600">{t("olo.qc.noWrite")}</p>;
  return (
    <div className="space-y-4" lang={lang}>
      {c.can_record ? <form className={box} onSubmit={async e => { e.preventDefault();
        if (await submit({ command: "result", id: c.id, reference: r.reference, result: r.result, method: r.method, ...(r.quantity_kg ? { quantity_kg: Number(r.quantity_kg) } : {}), ...(r.pieces ? { pieces: Number(r.pieces) } : {}), ...(r.note ? { note: r.note } : {}) }, t("olo.qc.resultDone")))
          setR({ ...r, reference: "", quantity_kg: "", pieces: "", note: "" }); }}>
        <h3 className="font-bold">{t(full ? "olo.qc.recordPiece" : "olo.qc.recordSample")}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold">{t(full ? "olo.qc.piece" : "olo.qc.sample")}<input required maxLength={80} className={input} value={r.reference} onChange={e => setR({ ...r, reference: e.target.value })} /></label>
          <label className="text-sm font-semibold">{t("olo.qc.result")}<select className={input} value={r.result} onChange={e => setR({ ...r, result: e.target.value })}><option value="accepted">{t(full ? "olo.qc.accepted" : "olo.qc.pass")}</option><option value="rejected">{t(full ? "olo.qc.rejected" : "olo.qc.fail")}</option></select></label>
          {full ? <label className="text-sm font-semibold">{t("olo.qc.weight")}<input required inputMode="decimal" className={input} value={r.quantity_kg} onChange={e => setR({ ...r, quantity_kg: e.target.value })} /></label> : null}
          <label className="text-sm font-semibold">{t("olo.qc.pieces")}<input inputMode="numeric" className={input} value={r.pieces} onChange={e => setR({ ...r, pieces: e.target.value })} /></label>
        </div>
        <label className="block text-sm font-semibold">{t("olo.qc.method")}<input required maxLength={120} className={input} value={r.method} onChange={e => setR({ ...r, method: e.target.value })} /></label>
        <label className="block text-sm font-semibold">{t("olo.qc.note")}<input maxLength={500} className={input} value={r.note} onChange={e => setR({ ...r, note: e.target.value })} /></label>
        <Button disabled={busy}>{t("olo.qc.recordResult")}</Button>
      </form> : null}
      {c.can_record ? <form className={box} onSubmit={e => { e.preventDefault(); submit({ command: "release", id: c.id, note: rel.note, ...(full ? {} : { decision: rel.decision }) }, t("olo.qc.dispositionDone")); }}>
        <h3 className="font-bold">{t(full ? "olo.qc.releaseFull" : "olo.qc.releaseSampling")}</h3>
        <p className="text-xs text-slate-600">{full ? t("olo.qc.releaseFullHelp", { acc: c.recorded.unreleased_accepted_kg, rej: c.recorded.unreleased_rejected_kg })
          : t("olo.qc.releaseSamplingHelp", { pass: c.recorded.passing_samples, req: c.required_samples, fail: c.recorded.failing_samples })}</p>
        {!full ? <label className="text-sm font-semibold">{t("olo.qc.decision")}<select className={input} value={rel.decision} onChange={e => setRel({ ...rel, decision: e.target.value })}><option value="accept_lot">{t("olo.qc.acceptLot")}</option><option value="reject_lot">{t("olo.qc.rejectLot")}</option></select></label> : null}
        <label className="block text-sm font-semibold">{t("olo.qc.basis")}<textarea required minLength={10} maxLength={1000} rows={2} className={input} value={rel.note} onChange={e => setRel({ ...rel, note: e.target.value })} /></label>
        {c.suspended_approved_kg > 0 ? <p className="text-xs font-semibold text-amber-900">{t("olo.qc.suspendedNote", { kg: c.suspended_approved_kg })}</p> : null}
        <Button disabled={busy}>{t("olo.qc.recordDisposition")}</Button>
      </form> : null}
      {c.can_record && !full ? <form className={box} onSubmit={e => { e.preventDefault(); submit({ command: "switch_mode", id: c.id, note: other }, t("olo.qc.switchDone")); }}>
        <h3 className="font-bold">{t("olo.qc.switchTitle")}</h3><p className="text-xs text-slate-600">{t("olo.qc.switchHelp")}</p>
        <label className="block text-sm font-semibold">{t("olo.qc.reason")}<input required minLength={10} maxLength={500} className={input} value={other} onChange={e => setOther(e.target.value)} /></label>
        <Button variant="secondary" disabled={busy}>{t("olo.qc.switchButton")}</Button>
      </form> : null}
      {c.can_cancel ? <details className={box}><summary className="cursor-pointer text-sm font-bold">{t("olo.qc.cancelSummary")}</summary>
        <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); submit({ command: "cancel", id: c.id, reason: other }, t("olo.qc.cancelDone")); }}>
          <label className="block text-sm font-semibold">{t("olo.qc.reason")}<input required minLength={10} maxLength={300} className={input} value={other} onChange={e => setOther(e.target.value)} /></label>
          <Button variant="danger" disabled={busy}>{t("olo.qc.cancelButton")}</Button></form></details> : null}
      {note}
    </div>
  );
}

/** Review each approval recorded before the containment: QA reconfirms or revokes; the factory manager or owner closes a
 * revocation, or QA reverses the revoked approval in the QC ledger (Phase 4). */
export function PriorApprovalReviews({ c, lang = "en" }: { c: ContainmentDetail; lang?: FloorLanguage }) {
  const t = floorText(lang);
  const { busy, submit, note } = useSubmit(containmentAction);
  const [form, setForm] = useState<Record<string, { outcome: string; method: string; note: string }>>({});
  const [close, setClose] = useState<Record<string, { method: string; note: string }>>({});
  if (!c.prior_approvals.length) return null;
  return (
    <section className={box} lang={lang}>
      <h3 className="font-bold">{t("olo.qc.priorTitle")}</h3>
      <p className="text-xs text-slate-600">{t("olo.qc.priorHelp")}</p>
      <ul className="space-y-3">{c.prior_approvals.map(p => {
        const f = form[p.inspection_id] ?? { outcome: "reconfirmed", method: "", note: "" };
        const r = p.review;
        const cl = r ? close[r.id] ?? { method: "", note: "" } : null;
        const reversal = c.reversals.find(x => x.inspection_id === p.inspection_id);
        return <li key={p.inspection_id} className="rounded-xl border border-slate-200 p-3 text-sm">
          <p className="font-semibold">{p.batch_number ?? t("olo.rev.inspection")} · {p.quantity_kg} kg · {p.inspector_name ?? "—"}</p>
          {r ? <p className="text-xs">{t(r.outcome === "revoked" ? "olo.qc.revokedBy" : "olo.qc.reconfirmedBy", { name: r.reviewed_by_name ?? "QA", method: r.method, note: r.note })}
            {r.closed_at ? t("olo.qc.closedBy", { name: r.closed_by_name ?? "—", method: r.close_method, note: r.close_note }) : r.outcome === "revoked" ? <b className="text-red-800">{t("olo.qc.openBlocked")}</b> : null}</p> : null}
          {reversal ? <p className="mt-1 text-xs font-semibold"><Link className="underline" href={`/quality/reversals/${reversal.id}`}>{t("olo.qc.reversedAs", { number: reversal.reversal_number, kg: reversal.reversed_kg,
            as: t(reversal.reversed_as === "rejected" ? "olo.rev.as.rejected" : "olo.rev.as.rework") })}</Link></p>
            : r && r.outcome === "revoked" && !r.closed_at && c.can_reverse ? <Link className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-red-300 px-3 text-xs font-bold text-red-900" href={`/quality/reversals/new?inspection_id=${p.inspection_id}`}>{t("olo.qc.reverseLink")}</Link> : null}
          {!r && c.can_review ? <form className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={async e => { e.preventDefault();
            if (await submit({ command: "prior_review", id: c.id, inspection_id: p.inspection_id, outcome: f.outcome, method: f.method, note: f.note }, t(f.outcome === "revoked" ? "olo.qc.revokedDone" : "olo.qc.reconfirmedDone")))
              setForm({ ...form, [p.inspection_id]: { outcome: "reconfirmed", method: "", note: "" } }); }}>
            <label className="text-xs font-semibold">{t("olo.qc.outcome")}<select className={input} value={f.outcome} onChange={e => setForm({ ...form, [p.inspection_id]: { ...f, outcome: e.target.value } })}>
              <option value="reconfirmed">{t("olo.qc.stillOk")}</option><option value="revoked">{t("olo.qc.foundBad")}</option></select></label>
            <label className="text-xs font-semibold">{t("olo.qc.howRechecked")}<input required minLength={2} maxLength={120} className={input} value={f.method} onChange={e => setForm({ ...form, [p.inspection_id]: { ...f, method: e.target.value } })} /></label>
            <label className="text-xs font-semibold">{t("olo.qc.finding")}<input required minLength={10} maxLength={500} className={input} value={f.note} onChange={e => setForm({ ...form, [p.inspection_id]: { ...f, note: e.target.value } })} /></label>
            <div className="sm:col-span-3"><Button variant={f.outcome === "revoked" ? "danger" : "secondary"} disabled={busy}>{t(f.outcome === "revoked" ? "olo.qc.revoke" : "olo.qc.reconfirm")}</Button></div>
          </form> : null}
          {r && cl && r.can_close ? <form className="mt-2 grid gap-2 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); submit({ command: "prior_close", id: c.id, review_id: r.id, method: cl.method, note: cl.note }, t("olo.qc.closedDone")); }}>
            <label className="text-xs font-semibold">{t("olo.qc.reverifyMethod")}<input required minLength={2} maxLength={120} className={input} value={cl.method} onChange={e => setClose({ ...close, [r.id]: { ...cl, method: e.target.value } })} /></label>
            <label className="text-xs font-semibold">{t("olo.qc.evidence")}<input required minLength={10} maxLength={500} className={input} value={cl.note} onChange={e => setClose({ ...close, [r.id]: { ...cl, note: e.target.value } })} /></label>
            <div className="sm:col-span-2"><Button disabled={busy}>{t("olo.qc.closeRevocation")}</Button></div>
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
export function PriorityRequestForm({ orderId, current, lang = "en" }: { orderId: string; current: string | null; lang?: FloorLanguage }) {
  const t = floorText(lang);
  const { busy, submit, note } = useSubmit(priorityAction);
  const [v, setV] = useState({ to_priority: current === "urgent" ? "high" : "urgent", reason: "" });
  const label = (p: string) => (["low", "normal", "high", "urgent"].includes(p) ? t(`olo.priority.${p as "low" | "normal" | "high" | "urgent"}`) : p);
  return (
    <form className={box} lang={lang} onSubmit={e => { e.preventDefault(); submit({ command: "request", order_id: orderId, to_priority: v.to_priority, reason: v.reason }, t("olo.pr.sentDone")); }}>
      <h3 className="font-bold">{t("olo.pr.title")}</h3>
      <p className="text-xs text-slate-600">{t("olo.pr.current", { p: label(current ?? "normal") })}</p>
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label className="text-sm font-semibold">{t("olo.pr.newPriority")}<select className={input} value={v.to_priority} onChange={e => setV({ ...v, to_priority: e.target.value })}>{["urgent", "high", "normal", "low"].filter(p => p !== current).map(p => <option key={p} value={p}>{label(p)}</option>)}</select></label>
        <label className="text-sm font-semibold">{t("olo.pr.reason")}<input required minLength={10} maxLength={500} className={input} value={v.reason} onChange={e => setV({ ...v, reason: e.target.value })} /></label>
      </div>
      <Button disabled={busy}>{t("olo.pr.send")}</Button>{note}
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
