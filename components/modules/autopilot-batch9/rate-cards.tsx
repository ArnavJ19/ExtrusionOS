"use client";

// AP-073: rate cards from today's approved rates. Preview a customer's card (selling prices only; lines below the floor or
// without an approved rate are listed for sales, never printed), generate it in one click, or generate for every customer
// of a category after the daily rate update. Sharing is by the person: download the PDF or copy the WhatsApp text.
import { useState } from "react";
import Link from "next/link";
import { CUSTOMER_TYPES } from "@/lib/autopilot-batch9/commands";
import { rateCardWhatsApp, rateLineText, sortRateLines, type RateCard, type RateCardLine } from "@/lib/commercial/rate-card";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";
import { CustomerPicker } from "./pickers";

type Note = { tone: "ok" | "error"; text: string } | null;
type Status = { today: string; billet_rates: number; rate_updated_today: boolean; last_rate_approved_at: string | null; cards_today: number; customer_types: Record<string, number> };
type Preview = { lines: RateCardLine[]; excluded: { families: string | null; alloy: string | null; finish: string; reason: string }[]; fingerprint: string; rate_day: string; valid_until: string };
type Row = { id: string; card_number: string; customer_name: string; customer_type: string | null; rate_day: string; valid_until: string; lines: number; excluded: number; shared_channel: string | null; shared_at: string | null };

export function RateCardLines({ lines }: { lines: RateCardLine[] }) {
  return <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[520px] text-sm">
    <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Profile family</th><th className="p-2">Alloy</th><th className="p-2">Finish</th><th className="p-2 text-right">Rate / kg</th><th className="p-2 text-right">Finishing extra</th></tr></thead>
    <tbody>{sortRateLines(lines).map((l, k) => <tr key={k} className="border-t"><td className="p-2">{l.families ?? "All profiles"}</td><td className="p-2">{l.alloy ?? "As specified"}</td><td className="p-2">{l.finish_label}</td>
      <td className="p-2 text-right font-bold tabular-nums">{inr(l.rate_per_kg)}</td><td className="p-2 text-right tabular-nums">{l.finish_extra ? `${inr(l.finish_extra.rate)} ${l.finish_extra.basis === "per_sqft" ? "per sq ft" : "per metre"}` : "—"}</td></tr>)}</tbody>
  </table></div>;
}

export function RateCardsClient({ canMake }: { canMake: boolean }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const status = useApRead<Status>("ap_rate_card", "status", {}, [key]);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null); const [valid, setValid] = useState(0);
  const preview = useApRead<Preview>("ap_rate_card", "preview", customer ? { customer_id: customer.id, valid_days: valid } : { customer_id: "00000000-0000-4000-8000-000000000000" }, [customer?.id, valid, key]);
  const [category, setCategory] = useState("dealer"); const [busy, setBusy] = useState(false);
  const s = status.data;
  async function generate() {
    if (!customer || !preview.data) return;
    setBusy(true);
    const out = await apWrite<{ state: string; message?: string; card?: { id: string; card_number: string } }>("ap_rate_card", "generate", { customer_id: customer.id, valid_days: valid, fingerprint: preview.data.fingerprint }, setMessage);
    setBusy(false);
    if (!out) return;
    if (out.state === "generated" || out.state === "unchanged") setMessage({ tone: "ok", text: `${out.state === "generated" ? "Prepared" : "Already prepared"}: rate card ${out.card?.card_number}.` });
    else setMessage({ tone: "error", text: out.message ?? "The card could not be prepared." });
    setKey(k => k + 1);
  }
  async function generateAll() {
    setBusy(true);
    const out = await apWrite<{ generated: number; unchanged: number; not_priced: number }>("ap_rate_card", "generate_all", { customer_type: category, valid_days: valid }, setMessage);
    setBusy(false);
    if (out) { setMessage({ tone: "ok", text: `${out.generated} card(s) prepared, ${out.unchanged} already current, ${out.not_priced} could not be priced.` }); setKey(k => k + 1); }
  }
  return <div className="space-y-5">
    <Section title="Today's rates" description="Cards use today's approved billet rate, each customer's agreed conversion (or the general one) and the per-kg finishing rates.">
      {status.loading && !s ? <Loading what="today's rates" /> : status.error ? <Failure text={status.error} /> : s ? <div className="flex flex-wrap gap-4 text-sm">
        <p><b>{fmtDay(s.today)}</b> · {s.billet_rates} approved billet rate(s) in force{s.rate_updated_today ? " · updated today" : ""}</p>
        <p className="text-neutral-600">Last approved {fmtWhen(s.last_rate_approved_at)} · {s.cards_today} card(s) prepared today</p>
        <Link href="/quotes/reprice" className="font-bold underline">Daily metal-rate repricing</Link>
      </div> : null}
      {canMake ? <div className="flex flex-wrap items-end gap-2 rounded-xl bg-neutral-50 p-3">
        <label className="text-xs font-bold">Customer category<select className={`${inputClass} w-auto`} value={category} onChange={e => setCategory(e.target.value)}>
          {Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}{s?.customer_types?.[k] ? ` (${s.customer_types[k]})` : ""}</option>)}</select></label>
        <label className="text-xs font-bold">Valid for<select className={`${inputClass} w-auto`} value={valid} onChange={e => setValid(Number(e.target.value))}>
          <option value={0}>Today only</option>{[1, 2, 3, 7, 15].map(d => <option key={d} value={d}>{d} more day(s)</option>)}</select></label>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void generateAll()}>Prepare cards for all {CUSTOMER_TYPES[category as keyof typeof CUSTOMER_TYPES]?.toLowerCase()}</button>
      </div> : null}
      <Message value={message} />
    </Section>
    <Section title="One customer's card" description="Preview before preparing. Lines left off the card are listed here for sales only.">
      <CustomerPicker value={customer} onChange={setCustomer} />
      {!customer ? <Empty>Choose a customer to preview their card.</Empty> : preview.loading && !preview.data ? <Loading what="the card" /> : preview.error ? <Failure text={preview.error} /> : preview.data ? <>
        {preview.data.lines.length ? <RateCardLines lines={preview.data.lines} /> : <Empty>No line can be priced today.</Empty>}
        {preview.data.excluded.length ? <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><p className="font-bold">Left off the card (internal)</p>
          <ul className="mt-1 list-disc pl-5">{preview.data.excluded.map((e, k) => <li key={k}>{e.families ?? "All profiles"} · {e.alloy ?? "any alloy"} · {e.finish.replaceAll("_", " ")}: {e.reason}</li>)}</ul></div> : null}
        {canMake ? <button type="button" className={buttonClass} disabled={busy || !preview.data.lines.length} onClick={() => void generate()}>Prepare rate card</button> : null}
      </> : null}
    </Section>
    <RateCardList reloadKey={key} canShare={canMake} />
  </div>;
}

function RateCardList({ reloadKey, canShare }: { reloadKey: number; canShare: boolean }) {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [q, setQ] = useState(""); const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<{ rows: Row[]; total_count: number }>("ap_rate_card", "list", { page, ...(q ? { search: q } : {}) }, [reloadKey, key]);
  async function copy(id: string) {
    const card = await apWrite<RateCard>("ap_rate_card", "get", { id }, setMessage);
    if (!card) return;
    try { await navigator.clipboard.writeText(rateCardWhatsApp(card)); } catch { setMessage({ tone: "error", text: "The text could not be copied. Open the card and copy it by hand." }); return; }
    if (canShare) await apWrite("ap_rate_card", "shared", { id, channel: "whatsapp" }, setMessage);
    setMessage({ tone: "ok", text: `WhatsApp text for ${card.card_number} copied. Paste it in the chat; nothing was sent.` }); setKey(k => k + 1);
  }
  return <Section id="rate-cards" title="Rate cards prepared" description="Ten per page, newest first.">
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
      <input aria-label="Search rate cards" className={`${inputClass} max-w-xs`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer or card number" />
      <button type="submit" className={secondaryClass}>Search</button></form>
    <Message value={message} />
    {data.loading && !data.data ? <Loading what="rate cards" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      {data.data.rows.length ? <ul className="divide-y rounded-xl border">{data.data.rows.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <div className="min-w-0"><Link href={`/quotes/rate-cards/${r.id}`} className="font-bold underline">{r.card_number}</Link> · {r.customer_name}
          <p className="text-xs text-neutral-500">{fmtDay(r.rate_day)}{r.valid_until !== r.rate_day ? ` to ${fmtDay(r.valid_until)}` : " only"} · {r.lines} line(s){r.excluded ? ` · ${r.excluded} left off` : ""}{r.shared_at ? ` · ${r.shared_channel === "pdf" ? "PDF downloaded" : "WhatsApp text copied"} ${fmtWhen(r.shared_at)}` : " · not shared yet"}</p></div>
        <div className="flex flex-wrap gap-2"><a className={secondaryClass + " inline-flex items-center"} href={`/api/pdf/rate-card/${r.id}`} target="_blank" rel="noreferrer"
          onClick={() => { if (canShare) void apWrite("ap_rate_card", "shared", { id: r.id, channel: "pdf" }, () => undefined).then(() => setKey(k => k + 1)); }}>PDF</a>
          <button type="button" className={secondaryClass} onClick={() => void copy(r.id)}>Copy WhatsApp text</button></div>
      </li>)}</ul> : <Empty>{q ? "No card matches." : "No rate card prepared yet."}</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

/** One card: what the customer receives, with the WhatsApp text shown for copying. */
export function RateCardRecord({ id, canShare }: { id: string; canShare: boolean }) {
  const [message, setMessage] = useState<Note>(null);
  const data = useApRead<RateCard & { id: string; excluded: Preview["excluded"]; created_by: string | null; created_at: string }>("ap_rate_card", "get", { id }, []);
  const card = data.data;
  if (data.loading && !card) return <Loading what="the rate card" />;
  if (data.error || !card) return <Failure text={data.error ?? "Rate card not found."} />;
  const text = rateCardWhatsApp(card);
  return <div className="space-y-5">
    <Section title={`Rate card ${card.card_number}`} description={`${card.customer_name} · prepared ${fmtWhen(card.created_at)} by ${card.created_by ?? "sales"}`}
      actions={<a className={buttonClass + " inline-flex items-center"} href={`/api/pdf/rate-card/${id}`} target="_blank" rel="noreferrer" onClick={() => { if (canShare) void apWrite("ap_rate_card", "shared", { id, channel: "pdf" }, () => undefined); }}>Download PDF</a>}>
      <RateCardLines lines={card.lines} />
      <p className="text-sm text-neutral-600">{card.lines.map(rateLineText).length} line(s) · GST {card.gst_percent}% extra</p>
      {card.excluded?.length ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{card.excluded.length} line(s) were left off this card (below the floor or without an approved rate). This note is not printed.</p> : null}
    </Section>
    <Section title="WhatsApp text" description="Copy and paste into the customer's chat. Nothing is sent by the system.">
      <pre className="whitespace-pre-wrap break-words rounded-xl bg-neutral-50 p-3 text-sm">{text}</pre>
      <button type="button" className={secondaryClass} onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { setMessage({ tone: "error", text: "Copy failed; select the text and copy it." }); return; }
        if (canShare) await apWrite("ap_rate_card", "shared", { id, channel: "whatsapp" }, setMessage);
        setMessage({ tone: "ok", text: "Copied. Paste it in the chat." });
      }}>Copy text</button>
      <Message value={message} />
    </Section>
  </div>;
}
