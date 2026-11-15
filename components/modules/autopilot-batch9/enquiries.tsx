"use client";

// AP-008: paste a WhatsApp enquiry (or a forwarded chat export). The text is read line by line: profile code, length in
// any unit, pieces or kg, finish and shade, each line with its confidence. Unknown codes are mapped once and remembered.
// "Open as quotation" fills the normal quotation form; prices come from the quotation calculation, not from the text.
// Nothing is sent back to the customer.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { pasteEnquiryAction } from "@/lib/actions/autopilot-batch9";
import { ENQUIRY_STATUS, type EnquiryLine } from "@/lib/autopilot-batch9/commands";
import { fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";
import { CustomerPicker, ProfilePicker } from "./pickers";

type Note = { tone: "ok" | "error"; text: string } | null;
const CONF: Record<string, string> = { high: "bg-emerald-50 text-emerald-900 border-emerald-200", medium: "bg-sky-50 text-sky-950 border-sky-200", low: "bg-amber-50 text-amber-950 border-amber-300" };
const CONF_LABEL: Record<string, string> = { high: "Read with confidence", medium: "Check this line", low: "Needs you" };
const finishLabel = (f: string | null) => (f ? f.replaceAll("_", " ") : "finish not stated");

export function PasteEnquiry() {
  const router = useRouter();
  const [text, setText] = useState(""); const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  return <Section title="Paste a WhatsApp enquiry" description="Paste the message, or the text of an exported chat. The customer is found from the phone number or name when it can be; you can also choose it.">
    <textarea aria-label="Enquiry text" className="min-h-40 w-full rounded-xl border border-neutral-300 bg-white p-3 font-mono text-sm" value={text} maxLength={20000} onChange={e => setText(e.target.value)}
      placeholder={"OM-4521 6.4 mtr 200 pcs RAL 9010\n2045 mill 21 ft 100 pcs"} />
    <CustomerPicker label="Customer (optional)" value={customer} onChange={setCustomer} />
    <button type="button" className={buttonClass} disabled={busy || text.trim().length < 3} onClick={async () => {
      setBusy(true); setMessage(null);
      const out = await pasteEnquiryAction({ text, ...(customer ? { customer_id: customer.id } : {}) });
      setBusy(false);
      if (!out.success) { setMessage({ tone: "error", text: out.error }); return; }
      router.push(`/quotes/enquiries/${out.data.id}`);
    }}>{busy ? "Reading…" : "Read enquiry"}</button>
    <Message value={message} />
  </Section>;
}

type Row = { id: string; enquiry_number: string; status: string; created_at: string; customer: string | null; lines: number; high: number; unknown: number; quote_number: string | null; preview: string };
export function EnquiryList() {
  const [page, setPage] = useState(1); const [status, setStatus] = useState("draft"); const [search, setSearch] = useState(""); const [q, setQ] = useState("");
  const data = useApRead<{ rows: Row[]; total_count: number }>("ap_enquiry", "list", { page, status, ...(q ? { search: q } : {}) }, []);
  return <Section id="enquiries" title="Enquiries" description="Ten per page, newest first.">
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
      <select aria-label="Status" className={`${inputClass} w-auto`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>{[["draft", "To review"], ["quoted", "Quoted"], ["discarded", "Discarded"], ["all", "All"]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input aria-label="Search enquiries" className={`${inputClass} max-w-xs`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer, number or text" />
      <button type="submit" className={secondaryClass}>Search</button></form>
    {data.loading && !data.data ? <Loading what="enquiries" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      {data.data.rows.length ? <ul className="divide-y rounded-xl border">{data.data.rows.map(r => <li key={r.id} className="p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><p><Link className="font-bold underline" href={`/quotes/enquiries/${r.id}`}>{r.enquiry_number}</Link> · {r.customer ?? "customer not found"} · {r.high}/{r.lines} line(s) read with confidence{r.unknown ? ` · ${r.unknown} code(s) to map` : ""}{r.quote_number ? ` · ${r.quote_number}` : ""}</p>
          <Pill value={r.status === "quoted" ? "approved" : r.status === "discarded" ? "blocked" : "held"} label={ENQUIRY_STATUS[r.status] ?? r.status} /></div>
        <p className="mt-1 truncate text-xs text-neutral-500">{fmtWhen(r.created_at)} · {r.preview}</p></li>)}</ul> : <Empty>{q ? "No enquiry matches." : "No enquiry here."}</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

type Enquiry = { id: string; enquiry_number: string; status: string; raw_text: string; source: string; sender_phone: string | null; sender_name: string | null; customer: { id: string; name: string } | null;
  customer_basis: string | null; lines: EnquiryLine[]; unknown_codes: string[]; quote_id: string | null; quote_number: string | null; created_at: string; created_by_name: string | null; discarded_reason: string | null };

function MapCode({ enquiry, code, onDone }: { enquiry: Enquiry; code: string; onDone: (e: Enquiry) => void }) {
  const [profile, setProfile] = useState<{ id: string; name: string } | null>(null); const [remember, setRemember] = useState(enquiry.customer ? "customer" : "everyone"); const [message, setMessage] = useState<Note>(null);
  return <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
    <p className="text-sm font-bold">Which profile is “{code}”?</p>
    <ProfilePicker value={profile} onChange={setProfile} />
    <div className="flex flex-wrap items-end gap-2"><label className="text-xs font-bold">Remember for<select className={`${inputClass} w-auto`} value={remember} onChange={e => setRemember(e.target.value)}>
      {enquiry.customer ? <option value="customer">{enquiry.customer.name}</option> : null}<option value="everyone">Every customer</option><option value="no">This enquiry only</option></select></label>
      <button type="button" className={buttonClass} disabled={!profile} onClick={async () => { const out = await apWrite<Enquiry>("ap_enquiry", "map", { id: enquiry.id, code_key: code, profile_id: profile!.id, remember }, setMessage); if (out) onDone(out); }}>Map code</button></div>
    <Message value={message} />
  </div>;
}

export function EnquiryRecord({ id, canQuote }: { id: string; canQuote: boolean }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null); const [reason, setReason] = useState("");
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const data = useApRead<Enquiry>("ap_enquiry", "get", { id }, [key]);
  const e = data.data;
  if (data.loading && !e) return <Loading what="the enquiry" />;
  if (data.error || !e) return <Failure text={data.error ?? "Enquiry not found."} />;
  const draft = e.status === "draft";
  const high = e.lines.filter(l => l.confidence === "high").length;
  return <div className="space-y-5">
    <Section title={`Enquiry ${e.enquiry_number}`} description={`${e.source === "chat_export" ? "Chat export" : "Pasted text"} · ${fmtWhen(e.created_at)} by ${e.created_by_name ?? "sales"} · ${high} of ${e.lines.length} line(s) read with confidence`}
      actions={<Pill value={e.status === "quoted" ? "approved" : e.status === "discarded" ? "blocked" : "held"} label={ENQUIRY_STATUS[e.status] ?? e.status} />}>
      <div className="text-sm">{e.customer ? <p>Customer <b>{e.customer.name}</b> {e.customer_basis === "phone" ? "(found from the WhatsApp number)" : e.customer_basis === "name" ? "(found from the sender's name)" : "(chosen)"}</p>
        : <p className="font-bold text-amber-800">Customer not found{e.sender_phone ? ` for ${e.sender_phone}` : e.sender_name ? ` for “${e.sender_name}”` : ""}. Choose it below.</p>}</div>
      {draft ? <div className="flex flex-wrap items-end gap-2"><CustomerPicker label={e.customer ? "Change customer" : "Customer"} value={customer} onChange={setCustomer} />
        {customer ? <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_enquiry", "set_customer", { id, customer_id: customer.id }, setMessage)) { setCustomer(null); setKey(k => k + 1); } }}>Use this customer</button> : null}</div> : null}
      {e.quote_id ? <p className="text-sm">Quoted as <Link className="font-bold underline" href={`/quotes/${e.quote_id}`}>{e.quote_number}</Link>.</p> : null}
      {e.discarded_reason ? <p className="text-sm text-neutral-600">Discarded: {e.discarded_reason}</p> : null}
      <Message value={message} />
    </Section>
    <Section title="Lines read from the message" description="Green lines were read with confidence. Blue lines need a glance; amber lines need you. Every value can still be changed on the quotation.">
      <ul className="space-y-2">{e.lines.map(l => <li key={l.seq} className={`rounded-xl border p-3 text-sm ${CONF[l.confidence]}`}>
        <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">{l.text}</p><span className="text-xs font-bold">{CONF_LABEL[l.confidence]}</span></div>
        <p className="mt-1"><b>{l.profile_code ?? (l.code ? `${l.code} (unknown)` : "no code")}</b> · {l.length_m !== null ? `${Number(l.length_m.toFixed(3))} m${l.length_text ? ` (“${l.length_text}”)` : ""}` : "length not stated"} · {l.pieces !== null ? `${l.pieces} pcs` : l.kg !== null ? `${l.kg} kg` : "quantity not stated"} · {finishLabel(l.finish)}{l.shade ? ` ${l.shade}` : ""}{l.alloy ? ` · ${l.alloy}` : ""}</p>
        {l.issues.length ? <ul className="mt-1 list-disc pl-5 text-xs">{l.issues.map(i => <li key={i}>{i}</li>)}</ul> : null}
      </li>)}</ul>
      {draft ? e.unknown_codes.map(code => <MapCode key={code} enquiry={e} code={code} onDone={() => setKey(k => k + 1)} />) : null}
    </Section>
    {draft ? <Section title="Next" description="The quotation opens with these lines and today's approved rates. Save it there; the enquiry is then marked quoted.">
      <div className="flex flex-wrap gap-2">{canQuote ? (e.customer ? <Link className={buttonClass + " inline-flex items-center"} href={`/quotes/new?enquiry=${id}`}>Open as quotation</Link>
        : <span className="text-sm text-amber-800">Choose the customer to open a quotation.</span>) : <span className="text-sm text-neutral-600">An owner or admin opens the priced quotation.</span>}</div>
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-bold">Reason to discard<input className={inputClass} value={reason} onChange={ev => setReason(ev.target.value)} placeholder="Duplicate of yesterday's enquiry" /></label>
        <button type="button" className={secondaryClass} disabled={reason.trim().length < 3} onClick={async () => { if (await apWrite("ap_enquiry", "discard", { id, reason: reason.trim() }, setMessage)) setKey(k => k + 1); }}>Discard</button></div>
    </Section> : null}
    <Section title="Original message" description="Kept with the enquiry as received.">
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-neutral-50 p-3 text-xs">{e.raw_text}</pre>
    </Section>
  </div>;
}
