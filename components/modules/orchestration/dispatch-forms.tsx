"use client";

// Orchestration batch 3: payment terms, finance releases and the customer dispatch update. The database decides
// clearance and records every message; nothing here sends a message by itself — staff send it from their own app.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSubmit } from "@/components/modules/orchestration/nonconforming-forms";
import { updateDeliveryStatusAction } from "@/lib/actions/dispatches";
import { dispatchCommAction, dispatchFinanceAction } from "@/lib/actions/orchestration";
import { floorText, type FloorLanguage } from "@/lib/i18n/floor";
import { CHANNEL_LABELS, composeDispatchMessage, messageLink, type DispatchFacts } from "@/lib/workflow/dispatch-orchestration";

const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const box = "space-y-2 rounded-2xl border border-slate-200 bg-white p-4";

// ------------------------------------------------------------------ Payment terms
export function TermsForm({ customers, order, lang = "en" }: { customers: { id: string; name: string }[]; order?: { id: string; number: string }; lang?: FloorLanguage }) {
  const t = floorText(lang);
  const { busy, submit, note } = useSubmit(dispatchFinanceAction);
  const [v, setV] = useState({ scope: order ? "order" : "customer", customer_id: customers[0]?.id ?? "", terms: "payment_before_dispatch", advance_percent: "30", reason: "" });
  return (
    <form className={box} lang={lang} onSubmit={e => { e.preventDefault();
      submit({ command: "terms.set", scope: v.scope, terms: v.terms, reason: v.reason,
        ...(v.scope === "customer" ? { customer_id: v.customer_id } : {}), ...(v.scope === "order" && order ? { order_id: order.id } : {}),
        ...(v.terms === "advance_part" ? { advance_percent: Number(v.advance_percent) } : {}) }, t("olo.fc.savedDone")); }}>
      <h2 className="text-lg font-bold">{order ? t("olo.fc.termsFor", { number: order.number }) : t("olo.fc.setTerms")}</h2>
      <p className="text-xs text-slate-600">{t("olo.fc.termsHelp")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {!order ? <label className="text-sm font-semibold">{t("olo.fc.appliesTo")}<select className={input} value={v.scope} onChange={e => setV({ ...v, scope: e.target.value })}>
          <option value="customer">{t("olo.fc.oneCustomer")}</option><option value="company">{t("olo.fc.scope.company")}</option></select></label> : null}
        {!order && v.scope === "customer" ? <label className="text-sm font-semibold">{t("olo.fc.customer")}<select className={input} value={v.customer_id} onChange={e => setV({ ...v, customer_id: e.target.value })}>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : null}
        <label className="text-sm font-semibold">{t("olo.fc.terms")}<select className={input} value={v.terms} onChange={e => setV({ ...v, terms: e.target.value })}>
          <option value="payment_before_dispatch">{t("olo.fc.t.payment_before_dispatch")}</option><option value="advance_part">{t("olo.fc.t.advance_part")}</option><option value="credit">{t("olo.fc.t.credit")}</option></select></label>
        {v.terms === "advance_part" ? <label className="text-sm font-semibold">{t("olo.fc.advance")}<input required inputMode="decimal" className={input} value={v.advance_percent} onChange={e => setV({ ...v, advance_percent: e.target.value })} /></label> : null}
      </div>
      <label className="block text-sm font-semibold">{t("olo.fc.reason")}<input required minLength={5} maxLength={300} className={input} value={v.reason} onChange={e => setV({ ...v, reason: e.target.value })} placeholder={t("olo.fc.reasonHint")} /></label>
      <Button disabled={busy || (v.scope === "customer" && !order && !v.customer_id)}>{t("olo.fc.saveTerms")}</Button>{note}
    </form>
  );
}

export function ClearTermsButton({ id, lang = "en" }: { id: string; lang?: FloorLanguage }) {
  const t = floorText(lang);
  const { busy, submit, note } = useSubmit(dispatchFinanceAction);
  const [reason, setReason] = useState("");
  return (
    <details className="text-sm" lang={lang}><summary className="cursor-pointer font-semibold underline">{t("olo.fc.remove")}</summary>
      <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); submit({ command: "terms.clear", id, reason }, t("olo.fc.removedDone")); }}>
        <label className="text-xs font-semibold">{t("olo.fc.reason")}<input required minLength={5} maxLength={300} className={input} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <Button variant="secondary" disabled={busy}>{t("olo.fc.removeTerms")}</Button>{note}
      </form></details>
  );
}

// ------------------------------------------------------------------ Finance release
export function ReleaseForm({ dispatchId, canException, hours = 48, lang = "en" }: { dispatchId: string; canException: boolean; hours?: number; lang?: FloorLanguage }) {
  const t = floorText(lang);
  const { busy, submit, note } = useSubmit(dispatchFinanceAction);
  const [v, setV] = useState({ basis: "payment_confirmed", reference: "", note: "" });
  return (
    <form className={box} lang={lang} onSubmit={e => { e.preventDefault();
      submit({ command: "release", dispatch_id: dispatchId, basis: v.basis, note: v.note, ...(v.reference ? { reference: v.reference } : {}) }, t("olo.fc.releasedDone", { hours })); }}>
      <h2 className="text-lg font-bold">{t("olo.fc.releaseTitle")}</h2>
      <p className="text-xs text-slate-600">{t("olo.fc.releaseHelp", { hours })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">{t("olo.fc.basis")}<select className={input} value={v.basis} onChange={e => setV({ ...v, basis: e.target.value })}>
          <option value="payment_confirmed">{t("olo.fc.basisPayment")}</option>{canException ? <option value="approved_exception">{t("olo.fc.basisException")}</option> : null}</select></label>
        {v.basis === "payment_confirmed" ? <label className="text-sm font-semibold">{t("olo.fc.reference")}<input required minLength={4} maxLength={80} className={input} value={v.reference} onChange={e => setV({ ...v, reference: e.target.value })} /></label> : null}
      </div>
      <label className="block text-sm font-semibold">{t("olo.fc.basisNote")}<textarea required minLength={10} maxLength={500} rows={2} className={input} value={v.note} onChange={e => setV({ ...v, note: e.target.value })} /></label>
      <Button disabled={busy}>{t("olo.fc.recordRelease")}</Button>{note}
    </form>
  );
}

export function RevokeReleaseButton({ releaseId, lang = "en" }: { releaseId: string; lang?: FloorLanguage }) {
  const t = floorText(lang);
  const { busy, submit, note } = useSubmit(dispatchFinanceAction);
  const [reason, setReason] = useState("");
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2" lang={lang} onSubmit={e => { e.preventDefault(); submit({ command: "revoke", release_id: releaseId, reason }, t("olo.fc.withdrawnDone")); }}>
      <label className="text-xs font-semibold">{t("olo.fc.withdrawReason")}<input required minLength={5} maxLength={300} className={input} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <Button variant="secondary" disabled={busy}>{t("olo.fc.withdraw")}</Button>{note}
    </form>
  );
}

/** Review fix: a dispatch kept pending for finance clearance leaves through the normal delivery step once cleared. */
export function SendOutButton({ dispatchId, lang = "en" }: { dispatchId: string; lang?: FloorLanguage }) {
  const t = floorText(lang);
  const { busy, submit, note } = useSubmit(input => updateDeliveryStatusAction(dispatchId, String((input as { status: string }).status))
    .then(r => (r.success ? { success: true as const, data: r } : { success: false as const, error: r.error })));
  return (
    <div className={box} lang={lang}>
      <h2 className="text-lg font-bold">{t("olo.fc.sendOutTitle")}</h2>
      <p className="text-xs text-slate-600">{t("olo.fc.sendOutHelp")}</p>
      <Button disabled={busy} onClick={() => submit({ status: "dispatched" }, t("olo.fc.sentOutDone"))}>{t("olo.fc.sendOut")}</Button>{note}
    </div>
  );
}

// ------------------------------------------------------------------ Customer dispatch update
export function CustomerUpdateComposer({ facts }: { facts: DispatchFacts }) {
  const { busy, submit, note } = useSubmit(dispatchCommAction);
  const first = facts.recipients[0];
  const [lang, setLang] = useState<"en" | "hi">("en");
  const [channel, setChannel] = useState(first?.channel ?? "whatsapp");
  const [recipient, setRecipient] = useState(first?.value ?? "");
  const [body, setBody] = useState(() => composeDispatchMessage(facts, "en"));
  const link = useMemo(() => (recipient.trim() ? messageLink(channel, recipient, body) : null), [channel, recipient, body]);
  if (!facts.can_send) return <p className="text-sm text-slate-600">{facts.dispatched_at ? "Dispatch, sales and management record customer messages." : "The customer update is sent after the material leaves the gate."}</p>;
  return (
    <form className={box} onSubmit={async e => { e.preventDefault();
      await submit({ command: "record_sent", dispatch_id: facts.dispatch_id, channel, recipient, body, language: lang }, channel === "phone_call" ? "Call recorded." : "Recorded as sent. Mark it delivered or read when the customer's app shows it."); }}>
      <h2 className="text-lg font-bold">Send the dispatch update</h2>
      <p className="text-xs text-slate-600">The text carries logistics details only — no rates or values. Open it in your app, send it, then record it here.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">Language<select className={input} value={lang} onChange={e => { const next = e.target.value as "en" | "hi"; setLang(next); setBody(composeDispatchMessage(facts, next)); }}>
          <option value="en">English</option><option value="hi">हिंदी</option></select></label>
        <label className="text-sm font-semibold">Channel<select className={input} value={channel} onChange={e => { setChannel(e.target.value); const r = facts.recipients.find(x => x.channel === e.target.value); if (r) setRecipient(r.value); }}>
          {Object.entries(CHANNEL_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
        <label className="text-sm font-semibold">{channel === "email" ? "Email" : "Phone"}<input required className={input} value={recipient} onChange={e => setRecipient(e.target.value)} list="olo-recipients" />
          <datalist id="olo-recipients">{facts.recipients.map(r => <option key={`${r.channel}:${r.value}`} value={r.value}>{r.label}</option>)}</datalist></label>
      </div>
      <label className="block text-sm font-semibold">Message<textarea required minLength={20} maxLength={2000} rows={12} className={`${input} font-mono`} value={body} onChange={e => setBody(e.target.value)} lang={lang} /></label>
      <div className="flex flex-wrap items-center gap-3">
        {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="rounded-xl border bg-white px-4 py-2 text-sm font-bold">{channel === "phone_call" ? "Call" : `Open in ${CHANNEL_LABELS[channel]}`}</a> : null}
        <Button disabled={busy}>{channel === "phone_call" ? "Record the call" : "Record as sent"}</Button>
      </div>
      {note}
    </form>
  );
}

export function MarkMessage({ id, status }: { id: string; status: string }) {
  const { busy, submit, note } = useSubmit(dispatchCommAction);
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      {status === "sent" ? <Button variant="secondary" disabled={busy} onClick={() => submit({ command: "mark", id, status: "delivered" }, "Marked delivered.")}>Delivered</Button> : null}
      <Button variant="secondary" disabled={busy} onClick={() => submit({ command: "mark", id, status: "read" }, "Marked read.")}>Read</Button>
      <label className="text-xs font-semibold">Failed — reason<input maxLength={300} className={input} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <Button variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => submit({ command: "mark", id, status: "failed", note: reason }, "Marked failed; the task re-opens.")}>Failed</Button>
      {note}
    </div>
  );
}
