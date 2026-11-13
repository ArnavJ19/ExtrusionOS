"use client";

// AP-089: "Copy summary" on orders, dispatches, invoices, jobs and quotations (customer-safe and internal versions, cut
// by the database for the caller's role). AP-060: share a signed, expiring order-status link; revoke it at any time.
import { useState } from "react";
import { Copy, Link2, MessageCircle } from "lucide-react";
import { autopilotAction } from "@/lib/actions/autopilot";
import { formatRecordSummary, type SummaryFacts, type SummaryKind } from "@/lib/communications/record-summary";
import { fmtDay, fmtWhen, whatsappLink } from "@/lib/order-to-cash/commands";
import { Message, Pill, Section, apWrite, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;

export function CopySummaryButton({ kind, id, canInternal }: { kind: SummaryKind; id: string; canInternal: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [audience, setAudience] = useState<"customer" | "internal">("customer");
  const [message, setMessage] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  async function build(next: "customer" | "internal") {
    setBusy(true); setMessage(null); setAudience(next);
    const result = await autopilotAction("ap_share", "summary", { kind, id, audience: next });
    setBusy(false);
    if (!result.success) { setMessage({ tone: "error", text: result.error }); return; }
    const facts = result.data as SummaryFacts;
    const summary = formatRecordSummary(facts);
    setText(summary); setPhone(facts.phone ?? null);
    try { await navigator.clipboard.writeText(summary); setMessage({ tone: "ok", text: "Copied. Paste it into WhatsApp." }); }
    catch { setMessage({ tone: "ok", text: "Select the text below and copy it." }); }
  }
  const wa = text && audience === "customer" ? whatsappLink(phone, text) : null;
  return <div className="min-w-0 space-y-2" data-testid={`copy-summary-${kind}`}>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => build("customer")} className={`${secondaryClass} inline-flex items-center gap-2`}><Copy className="h-4 w-4" aria-hidden="true" />Copy summary</button>
      {canInternal ? <button type="button" disabled={busy} onClick={() => build("internal")} className={`${secondaryClass} inline-flex items-center gap-2`}><Copy className="h-4 w-4" aria-hidden="true" />Copy internal summary</button> : null}
      {wa ? <a href={wa} target="_blank" rel="noreferrer" className={`${secondaryClass} inline-flex items-center gap-2`}><MessageCircle className="h-4 w-4" aria-hidden="true" />Open WhatsApp</a> : null}
    </div>
    <Message value={message} />
    {text ? <pre aria-label={`${audience === "internal" ? "Internal" : "Customer"} summary`} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-neutral-50 p-3 font-sans text-sm">{text}</pre> : null}
  </div>;
}

type Link = { id: string; hint: string; expires_at: string; created_at: string; created_by: string; revoked_at: string | null; revoke_reason: string | null; views: number; last_viewed_at: string | null; state: string };

export function OrderStatusLinkPanel({ orderId }: { orderId: string }) {
  const [key, setKey] = useState(0);
  const links = useApRead<Link[]>("ap_share", "links", { order_id: orderId }, [key]);
  const [days, setDays] = useState(14);
  const [created, setCreated] = useState<{ url: string; wa: string | null; expires_at: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<Note>(null);
  async function create() {
    const data = await apWrite<{ token: string; expires_at: string; order_number: string; phone: string | null; customer: string }>("ap_share", "create_link", { order_id: orderId, days }, setMessage);
    if (!data) return;
    const url = `${window.location.origin}/status/${data.token}`;
    const text = `Status of your order ${data.order_number} with Omalco Extrusion: ${url}\nThis link works until ${fmtDay(data.expires_at)}.`;
    setCreated({ url, wa: whatsappLink(data.phone, text), expires_at: data.expires_at });
    try { await navigator.clipboard.writeText(url); setMessage({ tone: "ok", text: "Link created and copied. It is shown only now." }); } catch { setMessage({ tone: "ok", text: "Link created. Copy it now; it is shown only once." }); }
    setKey(k => k + 1);
  }
  return <Section id="share-status" title="Share order status" description="A link the customer can open without signing in: lines, produced, packed and dispatched quantities, vehicle and LR. No prices, cost or notes.">
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm font-semibold">Valid for<select value={days} onChange={e => setDays(Number(e.target.value))} className={`${inputClass} mt-1 w-32`}>{[3, 7, 14, 30, 60].map(d => <option key={d} value={d}>{d} days</option>)}</select></label>
      <button type="button" onClick={create} className={`${secondaryClass} inline-flex items-center gap-2`}><Link2 className="h-4 w-4" aria-hidden="true" />Share status</button>
    </div>
    {created ? <div className="space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><p className="break-all font-mono">{created.url}</p>
      <div className="flex flex-wrap gap-2">{created.wa ? <a className={`${secondaryClass} inline-flex items-center`} href={created.wa} target="_blank" rel="noreferrer">Send on WhatsApp</a> : <span>No WhatsApp number on the customer record.</span>}</div></div> : null}
    <Message value={message} />
    {links.data?.length ? <ul className="space-y-2 text-sm">{links.data.map(l => <li key={l.id} className="rounded-xl border border-neutral-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><span>…{l.hint} · created {fmtWhen(l.created_at)} by {l.created_by} · until {fmtDay(l.expires_at)}</span><Pill value={l.state === "active" ? "open" : l.state === "revoked" ? "rejected" : "cancelled"} label={l.state} /></div>
      <p className="text-neutral-600">{l.views} view(s){l.last_viewed_at ? `, last ${fmtWhen(l.last_viewed_at)}` : ""}{l.revoke_reason ? ` · revoked: ${l.revoke_reason}` : ""}</p>
      {l.state === "active" ? revoking === l.id ? <div className="mt-2 flex flex-wrap gap-2"><input aria-label="Why revoke" className={`${inputClass} flex-1`} value={reason} onChange={e => setReason(e.target.value)} />
        <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_share", "revoke_link", { id: l.id, reason: reason.trim() }, setMessage, "Link revoked.")) { setRevoking(null); setReason(""); setKey(k => k + 1); } }}>Revoke</button></div>
        : <button type="button" className="mt-1 underline" onClick={() => setRevoking(l.id)}>Revoke</button> : null}
    </li>)}</ul> : links.data ? <p className="text-sm text-neutral-600">No links shared for this order yet.</p> : null}
  </Section>;
}
