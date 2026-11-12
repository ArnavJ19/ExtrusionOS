"use client";

// AP-071: quotation follow-ups (scheduled when a quotation is sent; due ones become tasks each morning with a prepared
// message; recording the result closes the step; ordered or lost stops the sequence). AP-072: floor conversion charges by
// alloy, finish and quantity band; a quotation below its floor cannot be approved for sending or sent until the owner or an
// admin approves those exact lines. Floors are internal and never shown to customers.
import { useState } from "react";
import Link from "next/link";
import { FOLLOWUP_RESULTS, FINISH_OPTIONS, type FollowupResult } from "@/lib/autopilot-batch5/commands";
import { fmtDay, fmtWhen, inr, whatsappLink } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Step = { id: string; quote_id: string; quote_number: string; customer: string; customer_id: string; step_kind: string; offset_days: number | null; due_date: string; status: string;
  result: FollowupResult | null; note: string | null; done_by: string | null; done_at: string | null; stopped_reason: string | null; quote_total: number; valid_until: string | null; owner: string;
  overdue: boolean; phone: string | null; message: string };

const stepLabel = (s: Pick<Step, "step_kind" | "offset_days">) => s.step_kind === "after_send" ? `Day ${s.offset_days} after sending` : s.step_kind === "before_expiry" ? `${s.offset_days} days before validity ends` : "Agreed follow-up";

function RecordResult({ quoteId, onDone }: { quoteId: string; onDone: (text: string) => void }) {
  const [result, setResult] = useState<FollowupResult>("reached"); const [note, setNote] = useState(""); const [next, setNext] = useState(""); const [message, setMessage] = useState<Note>(null);
  return <div className="space-y-2 rounded-xl bg-neutral-50 p-3">
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="text-sm font-semibold">What happened<select className={`${inputClass} mt-1`} value={result} onChange={e => setResult(e.target.value as FollowupResult)}>{Object.entries(FOLLOWUP_RESULTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="text-sm font-semibold">Note<input className={`${inputClass} mt-1`} value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" /></label>
      {result !== "ordered" && result !== "lost" ? <label className="text-sm font-semibold">Next follow-up (optional)<input type="date" className={`${inputClass} mt-1`} value={next} onChange={e => setNext(e.target.value)} /></label> : null}
    </div>
    <button type="button" className={buttonClass} onClick={async () => {
      const payload: Record<string, unknown> = { quote_id: quoteId, result };
      if (note.trim()) payload.note = note.trim();
      if (next && result !== "ordered" && result !== "lost") payload.next_date = next;
      const r = await apWrite<{ record_outcome: boolean; next_due: string | null }>("ap_quote_sales", "record_followup", payload, setMessage);
      if (r) onDone(r.record_outcome ? "Recorded. Record why it was lost on the quotation's outcome so the reasons can be compared." : r.next_due ? `Recorded. Next follow-up ${fmtDay(r.next_due)}.` : "Recorded. No further follow-up is scheduled.");
    }}>Record result</button>
    <Message value={message} />
  </div>;
}

export function QuoteFollowupPanel({ quoteId, canRecord }: { quoteId: string; canRecord: boolean }) {
  const [key, setKey] = useState(0);
  const data = useApRead<{ open: boolean; message: string; steps: Step[]; next_due: string | null }>("ap_quote_sales", "followups", { quote_id: quoteId }, [key]);
  const [message, setMessage] = useState<Note>(null);
  const d = data.data;
  const phone = d?.steps[0]?.phone ?? null;
  const wa = d ? whatsappLink(phone, d.message) : null;
  return <Section id="followups" title="Follow-ups" description={d ? d.open ? d.next_due ? `Next follow-up ${fmtDay(d.next_due)}.` : "No follow-up scheduled; record a result to set the next one." : "This quotation is closed; follow-ups have stopped." : undefined}>
    {data.loading && !d ? <Loading what="follow-ups" /> : data.error ? <Failure text={data.error} /> : d ? <>
      {d.steps.length ? <ul className="space-y-1 text-sm">{d.steps.map(s => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
        <span>{stepLabel(s)} · {fmtDay(s.due_date)}{s.result ? ` · ${FOLLOWUP_RESULTS[s.result]}${s.note ? `: ${s.note}` : ""} (${s.done_by})` : ""}{s.stopped_reason ? ` · stopped: ${s.stopped_reason}` : ""}</span>
        <Pill value={s.status === "done" ? "posted" : s.status === "stopped" ? "cancelled" : s.overdue ? "held" : "open"} label={s.status === "task_created" ? "task raised" : s.status} /></li>)}</ul>
        : <Empty>{d.open ? "Follow-ups are scheduled when the quotation is sent; the morning run creates them." : "No follow-ups."}</Empty>}
      {d.open ? <>
        <details><summary className="cursor-pointer text-sm font-semibold">Prepared message</summary><pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-neutral-50 p-2 font-sans text-sm">{d.message}</pre></details>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryClass} onClick={async () => { try { await navigator.clipboard.writeText(d.message); setMessage({ tone: "ok", text: "Copied. Record the result once you have spoken to them." }); } catch { setMessage({ tone: "error", text: "Copy the message from the box above." }); } }}>Copy message</button>
          {wa ? <a className={`${secondaryClass} inline-flex items-center`} href={wa} target="_blank" rel="noreferrer">Open WhatsApp</a> : null}
        </div>
        {canRecord ? <RecordResult quoteId={quoteId} onDone={text => { setMessage({ tone: "ok", text }); setKey(k => k + 1); }} /> : null}
      </> : null}
      <Message value={message} />
    </> : null}
  </Section>;
}

export function FollowupQueueClient({ canSettings }: { canSettings: boolean }) {
  const [show, setShow] = useState<"due" | "upcoming">("due"); const [mine, setMine] = useState(true); const [page, setPage] = useState(1); const [key, setKey] = useState(0);
  const data = useApRead<{ rows: Step[]; total_count: number; coverage: { open: number; with_next: number } }>("ap_quote_sales", "followup_queue", { page, show, mine }, [key]);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<Note>(null);
  return <div className="space-y-4">
    <Section title="Quotation follow-ups" description={data.data ? `${data.data.coverage.with_next} of ${data.data.coverage.open} open quotation(s) have a next follow-up date.` : undefined}
      actions={<span className="flex flex-wrap gap-2"><select aria-label="Show" className={`${inputClass} w-40`} value={show} onChange={e => { setShow(e.target.value as typeof show); setPage(1); }}><option value="due">Due now</option><option value="upcoming">Upcoming</option></select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={e => { setMine(e.target.checked); setPage(1); }} />Mine only</label></span>}>
      <Message value={message} />
      {data.loading && !data.data ? <Loading what="follow-ups" /> : data.error ? <Failure text={data.error} /> : !data.data?.rows.length ? <Empty>{show === "due" ? "Nothing to follow up today." : "No upcoming follow-up."}</Empty> :
        <ul className="space-y-2">{data.data.rows.map(s => <li key={s.id} className="space-y-2 rounded-xl border border-neutral-200 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span><Link className="font-bold underline" href={`/quotes/${s.quote_id}#followups`}>{s.quote_number}</Link> · {s.customer} · {inr(s.quote_total)} · valid until {fmtDay(s.valid_until)}</span>
            <Pill value={s.overdue ? "held" : "open"} label={`${stepLabel(s)} · ${fmtDay(s.due_date)}`} /></div>
          <p className="text-neutral-600">Owner {s.owner}{s.phone ? ` · ${s.phone}` : ""}</p>
          <div className="flex flex-wrap gap-2">{whatsappLink(s.phone, s.message) ? <a className={`${secondaryClass} inline-flex items-center`} href={whatsappLink(s.phone, s.message)!} target="_blank" rel="noreferrer">Open WhatsApp</a> : null}
            <button type="button" className={secondaryClass} onClick={() => setOpen(open === s.id ? null : s.id)}>Record result</button></div>
          {open === s.id ? <RecordResult quoteId={s.quote_id} onDone={text => { setMessage({ tone: "ok", text }); setOpen(null); setKey(k => k + 1); }} /> : null}
        </li>)}</ul>}
      {data.data ? <Pager page={page} total={data.data.total_count} onPage={setPage} /> : null}
    </Section>
    {canSettings ? <FollowupSettings /> : null}
  </div>;
}

function FollowupSettings() {
  const data = useApRead<{ day_steps: number[]; before_expiry_days: number | null }>("ap_quote_sales", "followup_settings", {}, []);
  const [days, setDays] = useState<string | null>(null); const [before, setBefore] = useState<string | null>(null); const [message, setMessage] = useState<Note>(null);
  if (!data.data) return null;
  const daysValue = days ?? data.data.day_steps.join(", "), beforeValue = before ?? String(data.data.before_expiry_days ?? "");
  return <Section title="Follow-up schedule" description="Applies to quotations sent from now on; follow-ups are moved to the next factory working day.">
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="text-sm font-semibold">Days after sending<input className={`${inputClass} mt-1`} value={daysValue} onChange={e => setDays(e.target.value)} placeholder="2, 7" /></label>
      <label className="text-sm font-semibold">Days before validity ends<input inputMode="numeric" className={`${inputClass} mt-1`} value={beforeValue} onChange={e => setBefore(e.target.value)} placeholder="None" /></label>
      <div className="flex items-end"><button type="button" className={secondaryClass} onClick={async () => {
        const steps = daysValue.split(/[,\s]+/).filter(Boolean).map(Number);
        const payload: Record<string, unknown> = { day_steps: steps };
        if (beforeValue.trim()) payload.before_expiry_days = Number(beforeValue);
        await apWrite("ap_quote_sales", "save_followup_settings", payload, setMessage, "Schedule saved.");
      }}>Save schedule</button></div>
    </div>
    <Message value={message} />
  </Section>;
}

type FloorLine = { line_id: string; profile: string | null; alloy: string | null; finish: string; kg: number; conversion_per_kg: number; floor_per_kg: number | null; below: boolean };
type FloorRequest = { id: string; status: string; reason: string; revision: number; requested_by: string; requested_at: string; decided_by: string | null; decided_at: string | null; decision_note: string | null; current: boolean; can_decide: boolean };

export function QuoteFloorPanel({ quoteId, canRequest }: { quoteId: string; canRequest: boolean }) {
  const [key, setKey] = useState(0);
  const data = useApRead<{ lines: FloorLine[]; below: unknown[]; approved: boolean; quote_status: string; requests: FloorRequest[] }>("ap_quote_sales", "floor_check", { quote_id: quoteId }, [key]);
  const [reason, setReason] = useState(""); const [decide, setDecide] = useState<{ id: string; note: string } | null>(null); const [message, setMessage] = useState<Note>(null);
  const d = data.data;
  if (data.loading && !d) return <Section id="floor" title="Floor price check"><Loading what="the floor check" /></Section>;
  if (data.error) return <Section id="floor" title="Floor price check"><Failure text={data.error} /></Section>;
  if (!d || !d.lines.some(l => l.floor_per_kg !== null)) return null;
  // A waiting request for lines that have since changed cannot be approved, so it does not block a new request
  // (the new request supersedes it).
  const open = d.requests.find(r => r.status === "requested" && r.current);
  return <Section id="floor" title="Floor price check" description="Conversion charge per kg against the floor for the alloy, finish and quantity. Internal only."
    actions={d.below.length ? d.approved ? <Pill value="approved" label="Approved below floor" /> : <Pill value="held" label={`${d.below.length} line(s) below floor`} /> : <Pill value="approved" label="At or above floor" />}>
    <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="text-left text-neutral-500"><th className="py-1">Line</th><th>Quantity</th><th>Conversion</th><th>Floor</th></tr></thead>
      <tbody>{d.lines.map(l => <tr key={l.line_id} className="border-t border-neutral-100"><td className="py-2">{l.profile ?? "Profile"} · {l.alloy ?? "—"} · {l.finish.replaceAll("_", " ")}</td><td>{Number(l.kg).toLocaleString("en-IN")} kg</td>
        <td className={l.below ? "font-bold text-rose-700" : ""}>{inr(l.conversion_per_kg)}/kg</td><td>{l.floor_per_kg === null ? "No floor" : `${inr(l.floor_per_kg)}/kg`}</td></tr>)}</tbody></table></div>
    {d.below.length && !d.approved && canRequest && !open ? <div className="flex flex-wrap gap-2"><input aria-label="Why below the floor" className={`${inputClass} min-w-[14rem] flex-1`} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why this price (for example: repeat project, competitor quoted 37/kg)" />
      <button type="button" className={buttonClass} onClick={async () => { if (await apWrite("ap_quote_sales", "floor_request", { quote_id: quoteId, reason: reason.trim() }, setMessage, "Approval requested from the owner.")) { setReason(""); setKey(k => k + 1); } }}>Request approval</button></div> : null}
    {d.requests.length ? <ul className="space-y-2 text-sm">{d.requests.map(r => <li key={r.id} className="rounded-xl border border-neutral-200 p-2">
      <p><Pill value={r.status === "approved" ? "approved" : r.status === "requested" ? "held" : r.status === "rejected" ? "rejected" : "cancelled"} label={r.status} /> {r.reason} · {r.requested_by} {fmtWhen(r.requested_at)}{r.decided_by ? ` · ${r.status} by ${r.decided_by}${r.decision_note ? `: ${r.decision_note}` : ""}` : ""}{!r.current && (r.status === "approved" || r.status === "requested") ? " · lines changed since" : ""}</p>
      {r.can_decide ? decide?.id === r.id ? <div className="mt-1 flex flex-wrap gap-2"><input aria-label="Decision note" className={`${inputClass} flex-1`} value={decide.note} onChange={e => setDecide({ id: r.id, note: e.target.value })} placeholder="Note (needed to refuse)" />
        <button type="button" className={buttonClass} onClick={async () => { const out = await apWrite<{ status: string; message?: string }>("ap_quote_sales", "floor_decide", { request_id: r.id, decision: "approve", ...(decide.note.trim() ? { note: decide.note.trim() } : {}) }, setMessage);
          if (out) { setMessage(out.status === "superseded" ? { tone: "error", text: out.message ?? "The lines changed after the request; sales must request again." } : { tone: "ok", text: "Approved for these lines." }); setDecide(null); setKey(k => k + 1); } }}>Approve</button>
        <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_quote_sales", "floor_decide", { request_id: r.id, decision: "reject", ...(decide.note.trim() ? { note: decide.note.trim() } : {}) }, setMessage, "Refused.")) { setDecide(null); setKey(k => k + 1); } }}>Refuse</button></div>
        : <button type="button" className="mt-1 underline" onClick={() => setDecide({ id: r.id, note: "" })}>Decide</button> : null}
    </li>)}</ul> : null}
    <Message value={message} />
  </Section>;
}

type Floor = { id: string; alloy: string | null; finishing_type: string | null; min_kg: number; max_kg: number | null; floor_per_kg: number; status: string; reason: string; set_by: string; set_at: string };

export function FloorsClient({ canDecide }: { canDecide: boolean }) {
  const [key, setKey] = useState(0); const [page, setPage] = useState(1); const [rPage, setRPage] = useState(1);
  const floors = useApRead<{ rows: Floor[]; total_count: number; can_edit: boolean }>("ap_quote_sales", "floors", { page }, [key]);
  const requests = useApRead<{ rows: Array<{ id: string; quote_id: string; quote_number: string; customer: string; status: string; reason: string; lines: number; requested_by: string; requested_at: string; can_decide: boolean }>; total_count: number }>(
    "ap_quote_sales", "floor_requests", { page: rPage }, [key]);
  const [form, setForm] = useState({ alloy: "", finishing_type: "", min_kg: "", max_kg: "", floor_per_kg: "", reason: "" });
  const [message, setMessage] = useState<Note>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));
  return <div className="space-y-4">
    {canDecide ? <Section title="Waiting for approval">
      {requests.loading && !requests.data ? <Loading what="requests" /> : requests.error ? <Failure text={requests.error} /> : !requests.data?.rows.length ? <Empty>No quotation is waiting for a floor approval.</Empty> :
        <ul className="space-y-1 text-sm">{requests.data.rows.map(r => <li key={r.id}><Link className="font-bold underline" href={`/quotes/${r.quote_id}#floor`}>{r.quote_number}</Link> · {r.customer} · {r.lines} line(s) · {r.reason} · {r.requested_by} {fmtWhen(r.requested_at)}</li>)}</ul>}
      {requests.data ? <Pager page={rPage} total={requests.data.total_count} onPage={setRPage} /> : null}
    </Section> : null}
    {floors.data?.can_edit ? <Section title="Set a floor" description="Leave alloy or finish blank for a floor that applies to all. The most specific floor whose quantity band contains the line wins. A new floor replaces the active one with the same alloy, finish and band start.">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-sm font-semibold">Alloy<input className={`${inputClass} mt-1`} value={form.alloy} onChange={set("alloy")} placeholder="All" /></label>
        <label className="text-sm font-semibold">Finish<select className={`${inputClass} mt-1`} value={form.finishing_type} onChange={set("finishing_type")}><option value="">All</option>{FINISH_OPTIONS.map(f => <option key={f} value={f}>{f.replaceAll("_", " ")}</option>)}</select></label>
        <label className="text-sm font-semibold">From kg<input inputMode="decimal" className={`${inputClass} mt-1`} value={form.min_kg} onChange={set("min_kg")} placeholder="0" /></label>
        <label className="text-sm font-semibold">Below kg<input inputMode="decimal" className={`${inputClass} mt-1`} value={form.max_kg} onChange={set("max_kg")} placeholder="No limit" /></label>
        <label className="text-sm font-semibold">Floor ₹/kg<input inputMode="decimal" className={`${inputClass} mt-1`} value={form.floor_per_kg} onChange={set("floor_per_kg")} /></label>
        <label className="text-sm font-semibold">Reason<input className={`${inputClass} mt-1`} value={form.reason} onChange={set("reason")} /></label>
      </div>
      <button type="button" className={buttonClass} onClick={async () => {
        const payload: Record<string, unknown> = { floor_per_kg: Number(form.floor_per_kg), reason: form.reason.trim() };
        if (form.alloy.trim()) payload.alloy = form.alloy.trim().toUpperCase();
        if (form.finishing_type) payload.finishing_type = form.finishing_type;
        if (form.min_kg.trim()) payload.min_kg = Number(form.min_kg);
        if (form.max_kg.trim()) payload.max_kg = Number(form.max_kg);
        if (await apWrite("ap_quote_sales", "save_floor", payload, setMessage, "Floor saved.")) { setForm({ alloy: "", finishing_type: "", min_kg: "", max_kg: "", floor_per_kg: "", reason: "" }); setKey(k => k + 1); }
      }}>Save floor</button>
      <Message value={message} />
    </Section> : null}
    <Section title="Floor conversion charges">
      {floors.loading && !floors.data ? <Loading what="floors" /> : floors.error ? <Failure text={floors.error} /> : !floors.data?.rows.length ? <Empty>No floor set. Quotations are not checked until one is.</Empty> :
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left text-neutral-500"><th className="py-1">Alloy</th><th>Finish</th><th>Quantity</th><th>Floor</th><th>Set by</th><th /></tr></thead>
          <tbody>{floors.data.rows.map(f => <tr key={f.id} className="border-t border-neutral-100"><td className="py-2">{f.alloy ?? "All"}</td><td>{f.finishing_type?.replaceAll("_", " ") ?? "All"}</td>
            <td>{Number(f.min_kg).toLocaleString("en-IN")}{f.max_kg ? `–${Number(f.max_kg).toLocaleString("en-IN")}` : "+"} kg</td><td className="font-bold">{inr(f.floor_per_kg)}/kg</td><td>{f.set_by} · {fmtDay(f.set_at)}<span className="block text-xs text-neutral-500">{f.reason}</span></td>
            <td>{floors.data!.can_edit ? <button type="button" className="underline" onClick={async () => { if (await apWrite("ap_quote_sales", "retire_floor", { id: f.id }, setMessage, "Floor retired.")) setKey(k => k + 1); }}>Retire</button> : null}</td></tr>)}</tbody></table></div>}
      {floors.data ? <Pager page={page} total={floors.data.total_count} onPage={setPage} /> : null}
    </Section>
  </div>;
}
